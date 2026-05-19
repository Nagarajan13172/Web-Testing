import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  db,
  testCases,
  repos,
  eq,
  inArray,
} from "@webtesting/db";
import { parseJunit } from "@webtesting/junit-parser";
import { installationAccessToken, tokenizedCloneUrl } from "./github";
import type { Logger } from "./orchestrator";

const VITEST_IMAGE = process.env.VITEST_IMAGE ?? "webtesting/node:latest";
const JOB_TIMEOUT_MS = Number(process.env.VITEST_TIMEOUT_MS ?? 15 * 60_000);

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
    const cloneResult = await execHost(
      "git",
      ["clone", "--depth=1", cloneUrl, repoDir],
      { timeoutMs: 90_000, log },
    );
    if (cloneResult.exitCode !== 0) {
      await markAllFailed(testCaseIds, "git clone failed", combineOutput(cloneResult));
      return;
    }

    // ---- Write generated specs ------------------------------------------
    const aiTestsDir = join(repoDir, "tests", "ai");
    await mkdir(aiTestsDir, { recursive: true });
    for (const c of cases) {
      const fname = `${c.id}.test.tsx`;
      // Defensively rewrite known AI antipatterns at runtime so older stored
      // cases (generated before the sanitizer was added) self-heal.
      const sanitized = sanitizeTestCode(c.playwrightCode);
      await writeFile(join(aiTestsDir, fname), sanitized, "utf8");
    }

    // Make sure there's a vitest config that points at tests/ai with a DOM env.
    await ensureVitestConfig(repoDir);
    // Ensure jest-dom setup file exists so generated tests can rely on matchers.
    await ensureSetupFile(repoDir);

    // ---- Run docker: install deps + vitest -------------------------------
    const installCmd = installCommand(repoDir);
    const extraDeps =
      "vitest@^2 happy-dom@^15 @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/user-event@^14 @vitejs/plugin-react@^4 vite-tsconfig-paths@^5";

    const script = [
      `cd /work/repo`,
      `${installCmd} 2>&1 | tail -50 || true`,
      `npm install --silent --no-audit --no-fund -D ${extraDeps} || true`,
      // Diagnostic: list what we're about to run, so future failures are easier to debug.
      `echo "=== files in tests/ai ===" && ls -la /work/repo/tests/ai/ || true`,
      // Drop --dir (it double-scopes the include glob) and let the config drive discovery.
      `npx vitest run --root /work/repo --reporter=junit --outputFile=/work/results.xml`,
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

    log("docker run", { image: VITEST_IMAGE });
    const result = await execHost("docker", dockerArgs, { timeoutMs: JOB_TIMEOUT_MS, log });
    log("docker exit", { exitCode: result.exitCode });

    const combinedOutput = combineOutput(result);

    // ---- Parse JUnit -----------------------------------------------------
    const junitPath = join(workdir, "results.xml");
    let xml: string | null = null;
    if (existsSync(junitPath)) {
      xml = await readFile(junitPath, "utf8");
    } else {
      const m = result.stdout.match(/<testsuites[\s\S]*?<\/testsuites>/);
      if (m) xml = m[0];
    }

    if (!xml) {
      await markAllFailed(testCaseIds, "Vitest did not produce JUnit results", combinedOutput);
      return;
    }

    const parsed = parseJunit(xml);
    log("junit parsed", parsed.totals);

    const perCase = aggregatePerCase(parsed.tests);
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
      const missing = testCaseIds.filter((id) => !seen.has(id));
      if (missing.length > 0) {
        await tx
          .update(testCases)
          .set({
            status: "failed",
            lastRunAt: new Date(),
            lastFailureMessage:
              "no result reported by Vitest (likely a syntax error or unresolved import)",
            lastRunOutput: combinedOutput,
          })
          .where(inArray(testCases.id, missing));
      }
    });
  } finally {
    rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function markAllFailed(
  ids: string[],
  message: string,
  output: string,
): Promise<void> {
  await db
    .update(testCases)
    .set({
      status: "failed",
      lastRunAt: new Date(),
      lastFailureMessage: message,
      lastRunOutput: output,
    })
    .where(inArray(testCases.id, ids));
}

function installCommand(repoDir: string): string {
  if (existsSync(join(repoDir, "pnpm-lock.yaml"))) return "pnpm install --frozen-lockfile=false";
  if (existsSync(join(repoDir, "yarn.lock"))) return "yarn install --frozen-lockfile=false";
  return "npm install --no-audit --no-fund";
}

async function ensureVitestConfig(repoDir: string): Promise<void> {
  const candidates = [
    "vitest.config.ts",
    "vitest.config.js",
    "vitest.config.mts",
    "vitest.config.mjs",
  ];
  if (candidates.some((c) => existsSync(join(repoDir, c)))) return;

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
  },
  esbuild: {
    jsx: "automatic",
  },
});
`;
  await writeFile(join(repoDir, "vitest.config.ts"), config, "utf8");
}

async function ensureSetupFile(repoDir: string): Promise<void> {
  const setupPath = join(repoDir, "tests", "ai", "setup.ts");
  if (existsSync(setupPath)) return;
  await writeFile(setupPath, `import "@testing-library/jest-dom/vitest";\n`, "utf8");
}

interface PerCaseResult {
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  failureMessage: string | null;
  failureStack: string | null;
}

function aggregatePerCase(
  tests: ReturnType<typeof parseJunit>["tests"],
): Map<string, PerCaseResult> {
  const out = new Map<string, PerCaseResult>();
  for (const t of tests) {
    const fileName = (t.file ?? "").split("/").pop() ?? "";
    const m = fileName.match(/^([0-9a-f-]{36})\.test\.(?:t|j)sx?$/);
    if (!m || !m[1]) continue;
    const caseId = m[1];
    const prev = out.get(caseId);
    const status =
      prev?.status === "failed" || t.status === "failed"
        ? "failed"
        : prev?.status === "passed" || t.status === "passed"
          ? "passed"
          : t.status;
    out.set(caseId, {
      status,
      durationMs: (prev?.durationMs ?? 0) + (t.durationMs ?? 0),
      failureMessage: t.status === "failed" ? t.failureMessage : prev?.failureMessage ?? null,
      failureStack: t.status === "failed" ? t.failureStack : prev?.failureStack ?? null,
    });
  }
  return out;
}

/**
 * Apply all known AI-antipattern rewrites in order.
 */
function sanitizeTestCode(code: string): string {
  let out = sanitizeNestedRouter(code);
  out = sanitizeGetByText(out);
  return out;
}

/**
 * Rewrite `expect(screen.getByText(X)).toBeInTheDocument()` to
 * `expect(document.body).toHaveTextContent(X)`.
 *
 * `getByText` matches text that lives entirely in a single element. The AI
 * keeps using it for content that's actually split across elements (a styled
 * span inside a heading, for example), which produces "Unable to find an
 * element with the text" failures even when the rendered DOM contains the
 * expected words. `toHaveTextContent` walks the subtree, which is what the
 * AI actually means.
 */
function sanitizeGetByText(code: string): string {
  // Conservative match: only handle the explicit toBeInTheDocument assertion
  // form. We leave standalone getByText() calls alone — they might be used
  // for click handlers etc.
  return code.replace(
    /expect\s*\(\s*screen\.getByText\s*\(\s*([^)]+?)\s*\)\s*\)\s*\.toBeInTheDocument\s*\(\s*\)/g,
    "expect(document.body).toHaveTextContent($1)",
  );
}

/**
 * Detect and rewrite `render(<MemoryRouter|BrowserRouter|HashRouter ...><App /></...>)`
 * — a recurring AI mistake. `App.tsx` usually mounts its own Router; wrapping
 * <App /> in another Router throws "You cannot render a <Router> inside another <Router>".
 *
 * MemoryRouter with initialEntries → push the route via window.history first, then render <App />.
 * BrowserRouter / HashRouter wrapping <App /> → unwrap (App brings its own router).
 *
 * Kept in sync with packages/ai/src/generateTests.ts to defend even on cases
 * generated before that sanitizer was added.
 */
function sanitizeNestedRouter(code: string): string {
  const memoryRe =
    /render\s*\(\s*<MemoryRouter\b([^>]*)>\s*<App\s*\/>\s*<\/MemoryRouter>\s*\)\s*;?/gs;
  let out = code.replace(memoryRe, (_match, attrs: string) => {
    const route = extractInitialRoute(attrs) ?? "/";
    return `window.history.pushState({}, "", ${JSON.stringify(route)}); render(<App />);`;
  });
  out = out.replace(
    /render\s*\(\s*<(BrowserRouter|HashRouter)\b[^>]*>\s*<App\s*\/>\s*<\/\1>\s*\)\s*;?/gs,
    "render(<App />);",
  );
  return out;
}

function extractInitialRoute(attrs: string): string | null {
  const m = attrs.match(/initialEntries\s*=\s*\{\s*\[\s*["'`]([^"'`]+)["'`]/);
  return m && m[1] ? m[1] : null;
}

function combineOutput(r: { stdout: string; stderr: string; exitCode: number }): string {
  const sections: string[] = [];
  if (r.stdout.trim()) sections.push(`--- stdout ---\n${r.stdout.trim()}`);
  if (r.stderr.trim()) sections.push(`--- stderr ---\n${r.stderr.trim()}`);
  sections.push(`--- exit code: ${r.exitCode} ---`);
  return sections.join("\n\n");
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
