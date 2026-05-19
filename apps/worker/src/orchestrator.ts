import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  db,
  runs,
  runSteps,
  testResults,
  repos,
  and,
  eq,
} from "@webtesting/db";
import { detect } from "@webtesting/detector";
import { buildJsPipeline, type PipelineStep } from "@webtesting/runners";
import { parseJunit } from "@webtesting/junit-parser";
import type { GitPushJob } from "./queue";
import { publishRunEvent } from "./events";
import { installationAccessToken, tokenizedCloneUrl } from "./github";

const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE ?? "webtesting/node:latest";
const STEP_TIMEOUT_MS = Number(process.env.STEP_TIMEOUT_MS ?? 5 * 60_000);

export async function runJob(job: GitPushJob, log: Logger): Promise<void> {
  const { runId, repoUrl, commitSha } = job;

  await db
    .update(runs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(runs.id, runId));
  await publishRunEvent(runId, { type: "run.status", status: "running" });

  const workdir = await mkdtemp(join(tmpdir(), `webtesting-${runId}-`));
  const repoDir = join(workdir, "repo");
  let runFailed = false;

  try {
    // ---- Resolve installation token if this is a GitHub repo -------------
    const cloneTarget = await resolveCloneUrl(runId, repoUrl, log);

    // ---- Clone -----------------------------------------------------------
    const cloneStart = Date.now();
    await db.insert(runSteps).values({
      runId, name: "clone", status: "running", startedAt: new Date(cloneStart),
    });
    const cloneResult = await execHost("git", ["clone", "--depth=50", cloneTarget, repoDir], {
      timeoutMs: STEP_TIMEOUT_MS,
      log,
    });
    await finalizeStep(runId, "clone", cloneStart, cloneResult.exitCode);
    if (cloneResult.exitCode !== 0) {
      log("clone failed", { exitCode: cloneResult.exitCode });
      runFailed = true;
      return;
    }
    if (commitSha && commitSha !== "HEAD") {
      await execHost("git", ["-C", repoDir, "checkout", commitSha], {
        timeoutMs: 60_000,
        log,
      }).catch((err) => log("checkout failed (continuing)", { err: String(err) }));
    }

    // ---- Detect ----------------------------------------------------------
    const detection = detect(repoDir);
    const js = detection.stacks.find((s) => s.stack === "js");
    if (!js) {
      log("no supported stack detected — only JS/TS in this slice");
      runFailed = true;
      return;
    }
    log("detected", {
      stack: "js",
      pm: js.packageManager,
      testRunner: js.testRunner,
      typescript: js.hasTypescript,
      tests: js.testFiles.length,
    });

    // ---- Pipeline --------------------------------------------------------
    const pipeline = buildJsPipeline(js);
    for (const step of pipeline) {
      const ok = await runStepInSandbox(runId, repoDir, step, log);
      if (!ok && !step.optional) {
        runFailed = true;
        // Keep going only through "test" failures so we still record test_results.
        if (step.name !== "test") break;
      }
    }
  } finally {
    const finalStatus = runFailed ? "failure" : "success";
    await db
      .update(runs)
      .set({ status: finalStatus, finishedAt: new Date() })
      .where(eq(runs.id, runId));
    await publishRunEvent(runId, { type: "run.status", status: finalStatus });

    rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    log("cleaned up", { workdir });
  }
}

async function runStepInSandbox(
  runId: string,
  repoDir: string,
  step: PipelineStep,
  log: Logger,
): Promise<boolean> {
  const start = Date.now();
  await db.insert(runSteps).values({
    runId,
    name: step.name,
    kind: step.kind,
    status: "running",
    startedAt: new Date(start),
  });
  await publishRunEvent(runId, { type: "step.start", step: step.name, kind: step.kind });
  log("step start", { step: step.name, kind: step.kind });

  const dockerArgs = [
    "run", "--rm",
    "-v", `${repoDir}:/workspace`,
    "-w", "/workspace",
    "--memory=2g", "--cpus=2",
    "-e", "CI=true",
    SANDBOX_IMAGE,
    "sh", "-lc", step.command,
  ];

  const result = await execHost("docker", dockerArgs, {
    timeoutMs: STEP_TIMEOUT_MS,
    log,
  });

  const status: "success" | "failure" = result.exitCode === 0 ? "success" : "failure";
  const durationMs = Date.now() - start;

  await finalizeStep(runId, step.name, start, result.exitCode);
  await publishRunEvent(runId, {
    type: "step.end",
    step: step.name,
    status,
    exitCode: result.exitCode,
    durationMs,
  });
  log("step end", { step: step.name, status, exit: result.exitCode, durationMs });

  // Always try to parse JUnit if produced, even on failure.
  if (step.junitOutputFile) {
    const junitPath = join(repoDir, step.junitOutputFile);
    if (existsSync(junitPath)) {
      try {
        const xml = await readFile(junitPath, "utf8");
        const parsed = parseJunit(xml);
        if (parsed.tests.length) {
          const kind = (step.kind ?? "unit") as "unit" | "integration" | "e2e" | "snapshot";
          await db.insert(testResults).values(
            parsed.tests.map((t) => ({
              runId,
              kind,
              file: t.file,
              suite: t.suite,
              name: t.name,
              status: t.status,
              durationMs: t.durationMs ?? null,
              failureMessage: t.failureMessage,
              failureStack: t.failureStack,
            })),
          );
          await publishRunEvent(runId, {
            type: "tests.inserted",
            kind,
            passed: parsed.totals.passed,
            failed: parsed.totals.failed,
            skipped: parsed.totals.skipped,
          });
        }
        log("junit parsed", parsed.totals);
      } catch (err) {
        log("junit parse failed", { err: String(err) });
      }
    } else {
      log("junit file not found", { expected: junitPath });
    }
  }

  return status === "success";
}

async function finalizeStep(
  runId: string,
  name: string,
  startMs: number,
  exitCode: number,
) {
  await db
    .update(runSteps)
    .set({
      status: exitCode === 0 ? "success" : "failure",
      exitCode,
      durationMs: Date.now() - startMs,
      finishedAt: new Date(),
    })
    .where(and(eq(runSteps.runId, runId), eq(runSteps.name, name)));
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

export type Logger = (event: string, data?: Record<string, unknown>) => void;

/**
 * For repos installed via the GitHub App, mint a short-lived access token
 * and inject it into the clone URL so `git clone` works on private repos
 * and avoids unauthenticated rate limits. Non-GitHub URLs (file://, local
 * fixtures) pass through unchanged.
 */
async function resolveCloneUrl(runId: string, repoUrl: string, log: Logger): Promise<string> {
  if (!repoUrl.startsWith("https://github.com/")) return repoUrl;

  const [row] = await db
    .select({ installationId: repos.installationId })
    .from(runs)
    .leftJoin(repos, eq(runs.repoId, repos.id))
    .where(eq(runs.id, runId))
    .limit(1);

  const installationId = row?.installationId;
  if (!installationId) {
    log("github clone without installation — falling back to anonymous", { repoUrl });
    return repoUrl;
  }

  try {
    const token = await installationAccessToken(installationId);
    return tokenizedCloneUrl(repoUrl, token);
  } catch (err) {
    log("failed to mint installation token", { err: String(err), installationId });
    return repoUrl;
  }
}
