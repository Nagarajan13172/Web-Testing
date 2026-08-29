import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, testCases, repos, runs, eq, inArray } from "@webtesting/db";
import { parseJunit } from "@webtesting/junit-parser";
import type { Logger } from "./orchestrator";
import {
  execHost,
  combineOutput,
  recordStep,
  markAllFailed,
  persistResults,
} from "./run-shared";

const PLAYWRIGHT_IMAGE =
  process.env.PLAYWRIGHT_IMAGE ?? "mcr.microsoft.com/playwright:v1.50.0-noble";

// A first run pulls a ~3.4GB image and installs @playwright/test inside the
// container before anything executes, so the ceiling is generous.
const JOB_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_TIMEOUT_MS ?? 15 * 60_000);

const PLAYWRIGHT_VERSION = "1.50.0";

export interface RunPlaywrightInput {
  repoId: string;
  testCaseIds: string[];
}

/**
 * Runs end-to-end specs against a deployed application.
 *
 * Unlike the Vitest runner this never clones the repo: these tests drive a
 * running app over HTTP, so the only input that matters is the target URL. That
 * also means there is no coverage to collect — the code under test is executing
 * somewhere else entirely.
 */
export async function runPlaywrightCases(
  input: RunPlaywrightInput,
  log: Logger,
): Promise<void> {
  const { repoId, testCaseIds } = input;
  log("playwright job picked up", { repoId, count: testCaseIds.length });

  const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
  if (!repo) {
    log("repo not found", { repoId });
    return;
  }

  const cases = await db.select().from(testCases).where(inArray(testCases.id, testCaseIds));
  if (cases.length === 0) {
    log("no cases matched", { ids: testCaseIds });
    return;
  }

  if (!repo.targetDomain) {
    // Without somewhere to point the browser there is nothing to test, and
    // saying so is far more useful than a wall of Playwright connection errors.
    await markAllFailed(
      testCaseIds,
      "no target URL set for this repo — add the deployed URL before running end-to-end tests",
      "",
    );
    return;
  }

  const [runRow] = await db
    .insert(runs)
    .values({
      repoId,
      commitSha: "deployed",
      branch: repo.defaultBranch,
      status: "running",
      triggeredBy: "test-cases",
      startedAt: new Date(),
    })
    .returning({ id: runs.id });
  const runId = runRow!.id;
  log("run created", { runId, target: repo.targetDomain });

  let finalStatus: "success" | "failure" = "success";
  const workdir = await mkdtemp(join(tmpdir(), "webtesting-pw-"));

  try {
    const specsDir = join(workdir, "tests");
    await mkdir(specsDir, { recursive: true });
    for (const c of cases) {
      // E2E specs are stored and run verbatim. The sanitizers exist for the
      // Vitest path's import-depth and RTL query mistakes, none of which apply
      // to a spec that only talks to a page over HTTP.
      await writeFile(join(specsDir, `${c.id}.spec.ts`), c.playwrightCode, "utf8");
    }

    const reachableUrl = makeContainerReachable(repo.targetDomain);
    await writeConfig(workdir);
    await writeFile(
      join(workdir, "package.json"),
      JSON.stringify({ name: "webtesting-e2e", private: true }, null, 2),
      "utf8",
    );

    const dockerArgs = [
      "run", "--rm",
      "-v", `${workdir}:/work`,
      "-w", "/work",
      "-e", `BASE_URL=${reachableUrl}`,
      // Lets a spec reach a dev server running on the host.
      "--add-host=host.docker.internal:host-gateway",
      PLAYWRIGHT_IMAGE,
      "sh", "-lc",
      // No --reporter on the CLI: it overrides the config's outputFile and
      // Playwright then prints JUnit to stdout instead of writing results.xml.
      `npm install --silent --no-audit --no-fund @playwright/test@${PLAYWRIGHT_VERSION} && npx playwright test`,
    ];

    log("docker run", { image: PLAYWRIGHT_IMAGE, baseURL: reachableUrl });
    const started = Date.now();
    const result = await execHost("docker", dockerArgs, { timeoutMs: JOB_TIMEOUT_MS, log });
    log("docker exit", { exitCode: result.exitCode });
    await recordStep(runId, "e2e", "e2e", started, result.exitCode);

    const combined = combineOutput(result);

    const junitPath = join(workdir, "results.xml");
    let xml: string | null = null;
    if (existsSync(junitPath)) {
      xml = await readFile(junitPath, "utf8");
    } else {
      const m = result.stdout.match(/<testsuites[\s\S]*?<\/testsuites>/);
      if (m) xml = m[0];
    }

    if (!xml) {
      await markAllFailed(testCaseIds, "Playwright did not produce JUnit results", combined);
      finalStatus = "failure";
      return;
    }

    const parsed = parseJunit(xml);
    log("junit parsed", parsed.totals);

    await persistResults({
      runId,
      testCaseIds,
      cases,
      parsed,
      combinedOutput: combined,
      defaultKind: "e2e",
      missingMessage:
        "no result reported by Playwright (likely a syntax error in the spec, or the target URL was unreachable)",
      log,
    });

    if (parsed.totals.failed > 0) finalStatus = "failure";

    const shots = await countArtifacts(join(workdir, "artifacts"));
    if (shots > 0) log("failure artifacts captured", { files: shots });
  } finally {
    rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    await db
      .update(runs)
      .set({ status: finalStatus, finishedAt: new Date() })
      .where(eq(runs.id, runId))
      .catch(() => undefined);
  }
}

async function writeConfig(workdir: string): Promise<void> {
  await writeFile(
    join(workdir, "playwright.config.ts"),
    `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  retries: 0,
  reporter: [["junit", { outputFile: "results.xml" }]],
  outputDir: "./artifacts",
  use: {
    baseURL: process.env.BASE_URL,
    ignoreHTTPSErrors: true,
    // Evidence for a failing run, kept only when something actually fails so a
    // green suite doesn't write hundreds of megabytes of video.
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
});
`,
    "utf8",
  );
}

/** Counts files Playwright left behind for failures (screenshots, traces, video). */
async function countArtifacts(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries.filter((e) => e.isFile()).length;
  } catch {
    return 0;
  }
}

/**
 * Containers can't reach the host's loopback, so a target pointing at localhost
 * is rewritten to host.docker.internal. Without this, testing against a local
 * dev server fails with a connection refused that looks like the app is down.
 */
export function makeContainerReachable(url: string): string {
  return url
    .replace(/\/\/localhost(?=[:/]|$)/, "//host.docker.internal")
    .replace(/\/\/127\.0\.0\.1(?=[:/]|$)/, "//host.docker.internal");
}
