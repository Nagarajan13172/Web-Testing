import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  db,
  testCases,
  repos,
  runs,
  coverage,
  eq,
  inArray,
} from "@webtesting/db";
import { parseJunit } from "@webtesting/junit-parser";
import { sanitizeTestCode } from "@webtesting/ai/sanitize";
import { repairTest, localImportPaths } from "@webtesting/ai/repairTest";
import {
  execHost,
  combineOutput,
  recordStep,
  markAllFailed,
  aggregatePerCase,
  persistResults,
  type PerCaseResult,
} from "./run-shared";
import { installationAccessToken, tokenizedCloneUrl } from "./github";
import type { Logger } from "./orchestrator";

const VITEST_IMAGE = process.env.VITEST_IMAGE ?? "webtesting/node:latest";
const JOB_TIMEOUT_MS = Number(process.env.VITEST_TIMEOUT_MS ?? 15 * 60_000);

/**
 * Deliberately not `vitest.config.ts` — see writeVitestConfig.
 *
 * The `.mts` extension is load-bearing: it forces the config to be loaded as
 * ESM. With a plain `.ts` name, a repo without `"type": "module"` gets it
 * loaded through `require`, and the ESM-only `vite-tsconfig-paths` we depend on
 * then fails the whole run with "ESM file cannot be loaded by require".
 */
const VITEST_CONFIG_FILENAME = "vitest.webtesting.config.mts";

/** Printed inside the container when a dependency install fails. */
const INSTALL_FAILED_MARKER = "WEBTESTING_INSTALL_FAILED:";

/** Printed when the first install failed but the looser peer resolver worked. */
const PEER_RETRY_NOTE = "WEBTESTING_INSTALL_RETRIED_LOOSE_PEERS:";

/**
 * How many times a failing spec may be sent back to the model to be fixed
 * against its own error. Each round costs one model call per failed spec plus
 * one re-run of the suite. 0 disables repair entirely.
 */
const REPAIR_ROUNDS = Math.max(0, Number(process.env.TEST_REPAIR_ROUNDS ?? 1));

export interface RunVitestInput {
  repoId: string;
  testCaseIds: string[];
}

export async function runVitestCases(input: RunVitestInput, log: Logger): Promise<void> {
  const { repoId, testCaseIds } = input;
  log("vitest job picked up", { repoId, count: testCaseIds.length });

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

  // Create a run row so coverage data (which references runs.id) has a home.
  const [runRow] = await db
    .insert(runs)
    .values({
      repoId,
      commitSha: "HEAD",
      branch: repo.defaultBranch,
      status: "running",
      triggeredBy: "test-cases",
      startedAt: new Date(),
    })
    .returning({ id: runs.id });
  const runId = runRow!.id;
  log("run created", { runId });

  let finalStatus: "success" | "failure" = "success";

  const workdir = await mkdtemp(join(tmpdir(), "webtesting-vt-"));
  const repoDir = join(workdir, "repo");

  try {
    // ---- Clone -----------------------------------------------------------
    const repoUrl = `https://github.com/${repo.owner}/${repo.name}.git`;
    let cloneUrl = repoUrl;
    if (repo.installationId) {
      try {
        const token = await installationAccessToken(repo.installationId);
        cloneUrl = tokenizedCloneUrl(repoUrl, token);
      } catch (err) {
        log("token mint failed; cloning anonymously", { err: String(err) });
      }
    }
    log("cloning", { repo: `${repo.owner}/${repo.name}` });
    const cloneStart = Date.now();
    const cloneResult = await execHost(
      "git",
      ["clone", "--depth=1", cloneUrl, repoDir],
      { timeoutMs: 90_000, log },
    );
    await recordStep(runId, "clone", null, cloneStart, cloneResult.exitCode);
    if (cloneResult.exitCode !== 0) {
      await markAllFailed(testCaseIds, "git clone failed", combineOutput(cloneResult));
      finalStatus = "failure";
      return;
    }

    // Record the commit we actually tested — the run row is seeded with a
    // placeholder "HEAD" because the SHA isn't known until the clone lands.
    const shaResult = await execHost("git", ["-C", repoDir, "rev-parse", "HEAD"], {
      timeoutMs: 30_000,
      log,
    });
    const commitSha = shaResult.stdout.trim();
    if (shaResult.exitCode === 0 && commitSha) {
      await db.update(runs).set({ commitSha }).where(eq(runs.id, runId));
    }

    // ---- Write generated specs ------------------------------------------
    // Still "tests/ai" on disk: the generation prompt tells the model this
    // exact path so it can compute relative imports, and that can't be
    // re-verified while the model quota is exhausted. Worth renaming to
    // tests/webtesting once generation can be exercised again.
    const specsDir = join(repoDir, "tests", "ai");
    await mkdir(specsDir, { recursive: true });
    let healed = 0;
    for (const c of cases) {
      const fname = `${c.id}.test.tsx`;

      // Hand-written cases run exactly as written. The sanitizers exist to fix
      // the model's recurring mistakes; silently rewriting a person's code
      // would hide their real failure and overwrite what they typed.
      if (c.source === "manual") {
        await writeFile(join(specsDir, fname), c.playwrightCode, "utf8");
        continue;
      }

      // Defensively rewrite known AI antipatterns at runtime so older stored
      // cases (generated before the sanitizer was added) self-heal.
      const sanitized = sanitizeTestCode(c.playwrightCode);
      await writeFile(join(specsDir, fname), sanitized, "utf8");

      // Persist the rewrite. Without this the stored case keeps the broken
      // original — so the editor shows code that would fail if anyone ran or
      // exported it, even though the run itself passed.
      if (sanitized !== c.playwrightCode) {
        await db
          .update(testCases)
          .set({ playwrightCode: sanitized })
          .where(eq(testCases.id, c.id));
        healed++;
      }
    }
    if (healed > 0) log("stored code repaired", { cases: healed });

    // Write the config that points at tests/ai with a DOM env. Always written,
    // and passed to Vitest via --config below.
    await writeVitestConfig(repoDir);
    // Ensure jest-dom setup file exists so generated tests can rely on matchers.
    await ensureSetupFile(repoDir);

    // ---- Run, repair, re-run ---------------------------------------------
    const suite = await runSuite({ workdir, repoDir, runId, attempt: 1, log });

    if (!suite.parsed) {
      // Distinguish "deps never installed" from "Vitest ran but wrote nothing",
      // which are very different things to debug.
      const installFailed = suite.combinedOutput.includes(INSTALL_FAILED_MARKER);
      if (installFailed) log("dependency install failed", {});
      await markAllFailed(
        testCaseIds,
        installFailed
          ? "dependency install failed inside the sandbox — see run output"
          : "Vitest did not produce JUnit results",
        suite.combinedOutput,
      );
      finalStatus = "failure";
      return;
    }

    let parsed = suite.parsed;
    let combinedOutput = suite.combinedOutput;

    // Generation can only predict what a component renders; this pass gets the
    // actual failure and fixes against it. Bounded, and each round re-runs the
    // whole suite so the results and coverage we store stay consistent.
    for (let round = 1; round <= REPAIR_ROUNDS; round++) {
      const failedNow = [...aggregatePerCase(parsed.tests).entries()].filter(
        ([, r]) => r.status === "failed",
      );
      if (failedNow.length === 0) break;

      const repaired = await repairFailedCases({
        runId,
        repoDir,
        cases,
        failed: failedNow,
        round,
        log,
      });
      if (repaired === 0) break;

      const next = await runSuite({ workdir, repoDir, runId, attempt: round + 1, log });
      if (!next.parsed) {
        log("re-run after repair produced no results; keeping previous results", {});
        break;
      }
      parsed = next.parsed;
      combinedOutput = next.combinedOutput;
    }

    await persistResults({
      runId,
      testCaseIds,
      cases,
      parsed,
      combinedOutput,
      defaultKind: "unit",
      missingMessage:
        "no result reported by Vitest (likely a syntax error or unresolved import)",
      log,
    });

    if (parsed.totals.failed > 0) finalStatus = "failure";

    // ---- Coverage --------------------------------------------------------
    try {
      const rows = await readCoverageRows(workdir, runId);
      if (rows.length > 0) {
        await db.insert(coverage).values(rows);
        log("coverage stored", { files: rows.length });
      } else {
        log("no coverage data found");
      }
    } catch (err) {
      log("coverage parse failed", { err: String(err) });
    }
  } finally {
    rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    await db
      .update(runs)
      .set({ status: finalStatus, finishedAt: new Date() })
      .where(eq(runs.id, runId))
      .catch(() => undefined);
  }
}

interface CoverageSummary {
  [file: string]: {
    lines?: { total?: number; covered?: number; pct?: number };
  };
}

/**
 * Reads v8 coverage-summary.json from the workdir and converts it to rows
 * suitable for the `coverage` table. Skips the synthetic "total" entry — that
 * one is recomputable from the per-file rows at read time.
 */
async function readCoverageRows(
  workdir: string,
  runId: string,
): Promise<Array<{ runId: string; file: string; linesTotal: number; linesCovered: number; pct: number }>> {
  const summaryPath = join(workdir, "coverage", "coverage-summary.json");
  if (!existsSync(summaryPath)) return [];
  const text = await readFile(summaryPath, "utf8");
  const summary = JSON.parse(text) as CoverageSummary;
  const rows: Array<{ runId: string; file: string; linesTotal: number; linesCovered: number; pct: number }> = [];
  for (const [file, data] of Object.entries(summary)) {
    if (file === "total") continue;
    const lines = data.lines;
    if (!lines) continue;
    rows.push({
      runId,
      // Strip the container path prefix so the UI shows project-relative paths.
      file: file.replace(/^\/work\/repo\//, ""),
      linesTotal: lines.total ?? 0,
      linesCovered: lines.covered ?? 0,
      pct: Math.round(lines.pct ?? 0),
    });
  }
  return rows;
}

interface RunSuiteArgs {
  workdir: string;
  repoDir: string;
  runId: string;
  /** 1 for the first pass, 2+ for a re-run after repair. */
  attempt: number;
  log: Logger;
}

interface SuiteOutcome {
  /** null when Vitest produced no JUnit at all. */
  parsed: ReturnType<typeof parseJunit> | null;
  combinedOutput: string;
}

/**
 * One full pass: install, run every spec under tests/ai, collect JUnit and
 * coverage. Re-runs are cheap — node_modules lives in the mounted workdir, so
 * the install on attempt 2 is a no-op.
 */
async function runSuite(args: RunSuiteArgs): Promise<SuiteOutcome> {
  const { workdir, repoDir, runId, attempt, log } = args;
  const repoInstall = installCommands(repoDir);
  // @testing-library/dom is a peer of @testing-library/react and must be named
  // explicitly: when the repo install falls back to loose peer resolution, npm
  // stops pulling peers in automatically and react's dist/pure.js dies with
  // "Cannot find module '@testing-library/dom'" on every single spec.
  const extraDeps =
    "vitest@^2 @vitest/coverage-v8@^2 happy-dom@^15 @testing-library/react@^16 @testing-library/dom@^10 @testing-library/jest-dom@^6 @testing-library/user-event@^14 @vitejs/plugin-react@^4 vite-tsconfig-paths@^5";
  const testDepsInstall = `npm install --no-audit --no-fund -D ${extraDeps}`;

  const script = [
    `cd /work/repo`,
    installStep(repoInstall.command, "repo dependencies", repoInstall.retry),
    installStep(testDepsInstall, "test dependencies", `${testDepsInstall} --legacy-peer-deps`),
    // Diagnostic: list what we're about to run, so future failures are easier to debug.
    `echo "=== files in tests/ai ===" && ls -la /work/repo/tests/ai/ || true`,
    // Drop --dir (it double-scopes the include glob) and let the config drive discovery.
    // --config is explicit so a vitest/vite config shipped by the target repo
    // can't take precedence over ours.
    `npx vitest run --root /work/repo --config /work/repo/${VITEST_CONFIG_FILENAME} --reporter=junit --outputFile=/work/results.xml --coverage`,
  ].join(" && ");

  const dockerArgs = [
    "run", "--rm",
    "-v", `${workdir}:/work`,
    "-w", "/work/repo",
    "--memory=3g", "--cpus=2",
    "-e", "CI=true",
    VITEST_IMAGE,
    "sh", "-lc", script,
  ];

  log("docker run", { image: VITEST_IMAGE, attempt });
  const started = Date.now();
  const result = await execHost("docker", dockerArgs, { timeoutMs: JOB_TIMEOUT_MS, log });
  log("docker exit", { exitCode: result.exitCode, attempt });
  // A non-zero exit here usually just means some tests failed, which is a
  // legitimate outcome — the step status reflects that honestly.
  await recordStep(
    runId,
    attempt === 1 ? "test" : `test (after repair ${attempt - 1})`,
    "unit",
    started,
    result.exitCode,
  );

  const combinedOutput = combineOutput(result);

  const junitPath = join(workdir, "results.xml");
  let xml: string | null = null;
  if (existsSync(junitPath)) {
    xml = await readFile(junitPath, "utf8");
  } else {
    const m = result.stdout.match(/<testsuites[\s\S]*?<\/testsuites>/);
    if (m) xml = m[0];
  }
  if (!xml) return { parsed: null, combinedOutput };

  const parsed = parseJunit(xml);
  log("junit parsed", { ...parsed.totals, attempt });
  return { parsed, combinedOutput };
}

interface RepairArgs {
  runId: string;
  repoDir: string;
  cases: Array<typeof testCases.$inferSelect>;
  failed: Array<[string, PerCaseResult]>;
  round: number;
  log: Logger;
}

/**
 * Sends each failed spec back to the model along with the error it produced and
 * the source of the components it imports, then writes the corrected spec into
 * the checkout and persists it.
 *
 * Repairs are stored even if they go on to fail again: the stored case should
 * always be the code that actually ran, and the next run gets to repair against
 * a fresh, more specific error.
 *
 * Returns how many specs were actually rewritten.
 */
async function repairFailedCases(args: RepairArgs): Promise<number> {
  const { runId, repoDir, cases, failed, round, log } = args;
  const byId = new Map(cases.map((c) => [c.id, c]));
  const started = Date.now();
  let repaired = 0;

  log("repairing failed specs", { round, count: failed.length });

  for (const [caseId, res] of failed) {
    const c = byId.get(caseId);
    if (!c) continue;
    const short = caseId.slice(0, 8);

    // Never rewrite someone's own test. A failing hand-written spec is a
    // result the user asked for — replacing it with model output would
    // destroy their work and hide what they were trying to assert.
    if (c.source === "manual") {
      log("skipping repair for manual case", { case: short });
      continue;
    }
    try {
      const current = await readFile(
        join(repoDir, "tests", "ai", `${caseId}.test.tsx`),
        "utf8",
      );
      const sources = await readImportedSources(repoDir, current);
      const out = await repairTest({
        code: current,
        testTitle: c.title,
        failureMessage: res.failureMessage,
        failureStack: res.failureStack,
        sources,
      });

      if (out.code.trim() === current.trim()) {
        log("repair returned the same spec", { case: short });
        continue;
      }

      await writeFile(join(repoDir, "tests", "ai", `${caseId}.test.tsx`), out.code, "utf8");
      await db
        .update(testCases)
        .set({ playwrightCode: out.code })
        .where(eq(testCases.id, caseId));
      repaired++;
      log("repaired", {
        case: short,
        sources: sources.length,
        diagnosis: out.diagnosis.slice(0, 140),
      });
    } catch (err) {
      // One spec failing to repair must not sink the round.
      log("repair failed", { case: short, err: String(err).slice(0, 200) });
    }
  }

  await recordStep(runId, `repair ${round}`, null, started, 0);
  log("repair round done", { round, repaired });
  return repaired;
}

const SOURCE_EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js"];

/**
 * Reads the local modules a spec imports, so the repair pass can see what the
 * component actually renders rather than guessing again.
 */
async function readImportedSources(
  repoDir: string,
  code: string,
): Promise<Array<{ path: string; content: string }>> {
  const out: Array<{ path: string; content: string }> = [];
  for (const rel of localImportPaths(code)) {
    // The spec is model-written; never let a specifier walk out of the checkout.
    if (rel.includes("..") || rel.startsWith("/")) continue;
    for (const ext of SOURCE_EXTENSIONS) {
      const full = join(repoDir, rel + ext);
      if (!existsSync(full)) continue;
      try {
        out.push({ path: rel + ext, content: await readFile(full, "utf8") });
      } catch {
        /* unreadable — skip */
      }
      break;
    }
  }
  return out;
}

/**
 * Builds one install step for the container script.
 *
 * Installs are best-effort — a partial install can still produce a usable run,
 * so the step always exits 0 and the `&&` chain continues. But it must not fail
 * *silently*: on failure it prints a marker that survives into the stored run
 * output, which the runner detects to report "install failed" instead of the
 * baffling "Vitest produced no results".
 *
 * Output is routed through a file rather than piped to `tail`, because a pipe
 * would mask the install's exit status and the container's /bin/sh (dash) has
 * no `pipefail`.
 */
function installStep(command: string, label: string, retryCommand?: string): string {
  const logFile = `/tmp/install-${label.replace(/\W+/g, "-")}.log`;
  const onFailure = `tail -50 ${logFile}; echo "${INSTALL_FAILED_MARKER} ${label}"`;
  if (!retryCommand) {
    return `{ if ${command} > ${logFile} 2>&1; then tail -20 ${logFile}; else ${onFailure}; fi; }`;
  }
  return (
    `{ if ${command} > ${logFile} 2>&1; then tail -20 ${logFile}; ` +
    `elif ${retryCommand} > ${logFile} 2>&1; then echo "${PEER_RETRY_NOTE} ${label}"; tail -20 ${logFile}; ` +
    `else ${onFailure}; fi; }`
  );
}

/**
 * The install command for the repo, plus a fallback to retry with if the first
 * attempt fails.
 *
 * Modern npm aborts on any unsatisfiable peer range (ERESOLVE), which a lot of
 * real repos have — they were installed with an older npm, or with a lockfile
 * we're deliberately not honouring. Those repos aren't broken, they just need
 * the looser resolver, so a peer conflict shouldn't cost the whole run.
 */
function installCommands(repoDir: string): { command: string; retry?: string } {
  if (existsSync(join(repoDir, "pnpm-lock.yaml"))) {
    return {
      command: "pnpm install --frozen-lockfile=false",
      retry: "pnpm install --frozen-lockfile=false --no-strict-peer-dependencies",
    };
  }
  if (existsSync(join(repoDir, "yarn.lock"))) {
    // Yarn v1 treats peer mismatches as warnings, so there's nothing to loosen.
    return { command: "yarn install --frozen-lockfile=false" };
  }
  return {
    command: "npm install --no-audit --no-fund",
    retry: "npm install --no-audit --no-fund --legacy-peer-deps",
  };
}

/**
 * Writes the config Vitest runs our generated specs under.
 *
 * This is always written, never skipped. It lives under a dedicated filename
 * (not `vitest.config.ts`) for two reasons: it must not clobber a config the
 * target repo already ships, and — more importantly — a repo that ships its own
 * `vitest.config.ts` used to make us skip writing ours entirely, which left the
 * run with no `tests/ai/**` include glob, no happy-dom environment and no
 * coverage settings. Every case then came back "no result reported by Vitest".
 * The runner points Vitest at this file explicitly with `--config`.
 */
async function writeVitestConfig(repoDir: string): Promise<void> {
  const config = `import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // tsconfigPaths reads paths from the repo's tsconfig.json (e.g. "@/*": ["./src/*"])
  // and registers them as Vite aliases so component imports like "@/components/Foo" resolve.
  plugins: [react(), tsconfigPaths()],
  resolve: {
    // Hard fallback in case the repo lacks a tsconfig.json paths entry — the
    // @/ alias is by far the most common React convention.
    alias: {
      "@": "/work/repo/src",
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/ai/setup.ts"],
    include: ["tests/ai/**/*.test.{ts,tsx,js,jsx}"],
    css: false,
    pool: "forks",
    testTimeout: 10000,
    clearMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["json-summary", "json"],
      reportsDirectory: "/work/coverage",
      // Vitest defaults this to false, which silently discards the ENTIRE
      // coverage report whenever any test fails. Generated suites almost
      // always have at least one failure, so without this we never once
      // produced coverage data.
      reportOnFailure: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/**/*.d.ts",
        "tests/**",
        "**/node_modules/**",
      ],
    },
  },
  esbuild: {
    jsx: "automatic",
  },
});
`;
  await writeFile(join(repoDir, VITEST_CONFIG_FILENAME), config, "utf8");
}

async function ensureSetupFile(repoDir: string): Promise<void> {
  const setupPath = join(repoDir, "tests", "ai", "setup.ts");
  if (existsSync(setupPath)) return;
  await writeFile(setupPath, `import "@testing-library/jest-dom/vitest";\n`, "utf8");
}
