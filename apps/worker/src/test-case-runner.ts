import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, testCases, eq, inArray } from "@webtesting/db";
import { parseJunit } from "@webtesting/junit-parser";
import type { Logger } from "./orchestrator";

const PLAYWRIGHT_IMAGE =
  process.env.PLAYWRIGHT_IMAGE ?? "mcr.microsoft.com/playwright:v1.50.0-noble";

// First-time runs need to pull the ~1.5GB Playwright image, then npm-install
// @playwright/test inside the container before any tests execute. Bump the
// ceiling so the first run on a fresh machine doesn't get killed.
const JOB_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_TIMEOUT_MS ?? 15 * 60_000);

export interface RunTestCasesInput {
  testCaseIds: string[];
  targetDomain: string;
}

export async function runTestCases(input: RunTestCasesInput, log: Logger): Promise<void> {
  const { testCaseIds, targetDomain } = input;
  log("test-cases job picked up", { count: testCaseIds.length, targetDomain });

  const cases = await db
    .select()
    .from(testCases)
    .where(inArray(testCases.id, testCaseIds));

  if (cases.length === 0) {
    log("no cases matched", { ids: testCaseIds });
    return;
  }

  const workdir = await mkdtemp(join(tmpdir(), "webtesting-tc-"));
  const testsDir = join(workdir, "tests");
  await mkdir(testsDir, { recursive: true });

  // Map test_case.id -> filename so we can match JUnit output back to the row.
  for (const c of cases) {
    const fname = `${c.id}.spec.ts`;
    await writeFile(join(testsDir, fname), c.playwrightCode, "utf8");
  }

  const reachableUrl = makeContainerReachable(targetDomain);

  await writeFile(
    join(workdir, "playwright.config.ts"),
    `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  retries: 0,
  reporter: [["junit", { outputFile: "results.xml" }]],
  use: {
    baseURL: process.env.BASE_URL,
    ignoreHTTPSErrors: true,
  },
});
`,
    "utf8",
  );

  await writeFile(
    join(workdir, "package.json"),
    JSON.stringify(
      { name: "webtesting-tc", private: true, dependencies: {} },
      null,
      2,
    ),
    "utf8",
  );

  const dockerArgs = [
    "run", "--rm",
    "-v", `${workdir}:/work`,
    "-w", "/work",
    "-e", `BASE_URL=${reachableUrl}`,
    "--add-host=host.docker.internal:host-gateway",
    PLAYWRIGHT_IMAGE,
    "sh", "-lc",
    // Don't pass --reporter on the CLI — that overrides the outputFile in
    // playwright.config.ts and Playwright dumps JUnit to stdout instead of
    // writing results.xml, leaving the worker with nothing to parse.
    "npm install --silent --no-audit --no-fund @playwright/test@1.50.0 && npx playwright test",
  ];

  log("docker run", { image: PLAYWRIGHT_IMAGE, baseURL: reachableUrl });
  const result = await execHost("docker", dockerArgs, { timeoutMs: JOB_TIMEOUT_MS, log });
  log("docker exit", { exitCode: result.exitCode });

  // Combined output we'll attach to every case in the batch so the UI can show it.
  const combinedOutput = combineOutput(result.stdout, result.stderr, result.exitCode);

  const junitPath = join(workdir, "results.xml");
  let xml: string | null = null;
  if (existsSync(junitPath)) {
    xml = await readFile(junitPath, "utf8");
  } else {
    // Fallback: some Playwright versions / CLI overrides print JUnit to stdout
    // instead of writing the file. Extract the <testsuites ...> block.
    const m = result.stdout.match(/<testsuites[\s\S]*?<\/testsuites>/);
    if (m) xml = m[0];
  }

  if (!xml) {
    const tail = (result.stderr || result.stdout || "").slice(-2000);
    await db
      .update(testCases)
      .set({
        status: "failed",
        lastRunAt: new Date(),
        lastFailureMessage: "Playwright did not produce JUnit results",
        lastFailureStack: tail || null,
        lastRunOutput: combinedOutput,
      })
      .where(inArray(testCases.id, testCaseIds));
    rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    return;
  }

  const parsed = parseJunit(xml);
  log("junit parsed", parsed.totals);

  // Aggregate results per test_case_id (file name = "<id>.spec.ts").
  const perCase = new Map<
    string,
    { status: "passed" | "failed" | "skipped"; durationMs: number; failureMessage: string | null; failureStack: string | null }
  >();

  for (const t of parsed.tests) {
    const fileName = (t.file ?? "").split("/").pop() ?? "";
    const match = fileName.match(/^([0-9a-f-]{36})\.spec\.ts$/);
    if (!match || !match[1]) continue;
    const caseId = match[1];

    const prev = perCase.get(caseId);
    // If any test in the file failed, the case is failed. Otherwise passed/skipped.
    const status =
      prev?.status === "failed" || t.status === "failed"
        ? "failed"
        : prev?.status === "passed" || t.status === "passed"
          ? "passed"
          : t.status;
    const durationMs = (prev?.durationMs ?? 0) + (t.durationMs ?? 0);
    const failureMessage = t.status === "failed" ? t.failureMessage : prev?.failureMessage ?? null;
    const failureStack = t.status === "failed" ? t.failureStack : prev?.failureStack ?? null;
    perCase.set(caseId, { status, durationMs, failureMessage, failureStack });
  }

  const seen = new Set(perCase.keys());

  await db.transaction(async (tx) => {
    for (const [caseId, r] of perCase.entries()) {
      await tx
        .update(testCases)
        .set({
          status: r.status === "skipped" ? "pending" : r.status,
          lastRunAt: new Date(),
          lastDurationMs: r.durationMs,
          lastFailureMessage: r.failureMessage,
          lastFailureStack: r.failureStack,
          lastRunOutput: combinedOutput,
        })
        .where(eq(testCases.id, caseId));
    }

    // Any case we expected results for but didn't get (Playwright didn't run it) — mark failed
    const missing = testCaseIds.filter((id) => !seen.has(id));
    if (missing.length > 0) {
      await tx
        .update(testCases)
        .set({
          status: "failed",
          lastRunAt: new Date(),
          lastFailureMessage: "no result reported by Playwright (probably a syntax error in the generated spec)",
          lastRunOutput: combinedOutput,
        })
        .where(inArray(testCases.id, missing));
    }
  });

  rm(workdir, { recursive: true, force: true }).catch(() => undefined);
}

function combineOutput(stdout: string, stderr: string, exitCode: number): string {
  const sections: string[] = [];
  if (stdout.trim()) sections.push(`--- stdout ---\n${stdout.trim()}`);
  if (stderr.trim()) sections.push(`--- stderr ---\n${stderr.trim()}`);
  sections.push(`--- exit code: ${exitCode} ---`);
  return sections.join("\n\n");
}

/**
 * Docker containers can't reach the host's loopback directly. Rewrite
 * localhost / 127.0.0.1 to host.docker.internal so Playwright in the
 * container can hit the user's dev server.
 */
function makeContainerReachable(url: string): string {
  return url
    .replace(/\/\/localhost(?=[:/]|$)/, "//host.docker.internal")
    .replace(/\/\/127\.0\.0\.1(?=[:/]|$)/, "//host.docker.internal");
}

interface ExecOptions {
  timeoutMs: number;
  log: Logger;
}

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function execHost(cmd: string, args: string[], opts: ExecOptions): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      opts.log("timeout — killing", { cmd, args: args.slice(0, 3) });
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}
