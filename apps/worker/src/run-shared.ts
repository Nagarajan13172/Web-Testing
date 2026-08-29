import { spawn } from "node:child_process";
import {
  db,
  testCases,
  runSteps,
  testResults,
  eq,
  inArray,
} from "@webtesting/db";
import type { parseJunit } from "@webtesting/junit-parser";
import type { Logger } from "./orchestrator";

/**
 * Machinery shared by the runners.
 *
 * The two are quite different jobs — Vitest mounts components from a checkout,
 * Playwright drives a deployed URL and needs no checkout at all — but what they
 * do with the results is identical: map JUnit back to test cases, write the
 * per-case outcome, and leave the run detail page something to show.
 */

export type TestKind = "unit" | "integration" | "e2e" | "snapshot";

export interface PerCaseResult {
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  failureMessage: string | null;
  failureStack: string | null;
}

export interface ExecOptions {
  timeoutMs: number;
  log: Logger;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function execHost(cmd: string, args: string[], opts: ExecOptions): Promise<ExecResult> {
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

export function combineOutput(r: { stdout: string; stderr: string; exitCode: number }): string {
  const sections: string[] = [];
  if (r.stdout.trim()) sections.push(`--- stdout ---\n${r.stdout.trim()}`);
  if (r.stderr.trim()) sections.push(`--- stderr ---\n${r.stderr.trim()}`);
  sections.push(`--- exit code: ${r.exitCode} ---`);
  return sections.join("\n\n");
}

/**
 * Records one pipeline step against the run so the run detail page has
 * something to show. `exitCode` drives the status — non-zero is a failure.
 */
export async function recordStep(
  runId: string,
  name: string,
  kind: TestKind | null,
  startedAtMs: number,
  exitCode: number,
): Promise<void> {
  await db.insert(runSteps).values({
    runId,
    name,
    kind,
    status: exitCode === 0 ? "success" : "failure",
    durationMs: Date.now() - startedAtMs,
    exitCode,
    startedAt: new Date(startedAtMs),
    finishedAt: new Date(),
  });
}

/**
 * Specs are written as `<test_case.id>.<ext>`, so the JUnit file path is how a
 * reported test maps back to the case that produced it. Both runners use the
 * same naming, differing only in extension (.test.tsx vs .spec.ts).
 */
export function caseIdFromFile(file: string | null): string | null {
  const fileName = (file ?? "").split("/").pop() ?? "";
  const m = fileName.match(/^([0-9a-f-]{36})\.(?:test|spec)\.(?:t|j)sx?$/);
  return m && m[1] ? m[1] : null;
}

/** Maps a case's category onto the run's test_kind enum. */
export function testKindFor(category: string | undefined, fallback: TestKind): TestKind {
  if (category === "integration") return "integration";
  return fallback;
}

export function aggregatePerCase(
  tests: ReturnType<typeof parseJunit>["tests"],
): Map<string, PerCaseResult> {
  const out = new Map<string, PerCaseResult>();
  for (const t of tests) {
    const caseId = caseIdFromFile(t.file);
    if (!caseId) continue;
    const prev = out.get(caseId);
    // Any failing test in a file fails the case it came from.
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

export async function markAllFailed(
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

export interface PersistArgs {
  runId: string;
  testCaseIds: string[];
  cases: Array<typeof testCases.$inferSelect>;
  parsed: ReturnType<typeof parseJunit>;
  combinedOutput: string;
  /** test_kind for cases whose category doesn't imply one. */
  defaultKind: TestKind;
  /** What to say about a case the runner never reported on. */
  missingMessage: string;
  log: Logger;
}

/**
 * Writes a run's outcome: the per-case status the dashboard reads, and the
 * test_results rows the run detail page and the explain button read.
 */
export async function persistResults(args: PersistArgs): Promise<Map<string, PerCaseResult>> {
  const { runId, testCaseIds, cases, parsed, combinedOutput, defaultKind, missingMessage, log } = args;

  const perCase = aggregatePerCase(parsed.tests);
  const seen = new Set(perCase.keys());
  const caseById = new Map(cases.map((c) => [c.id, c]));

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
          lastFailureMessage: missingMessage,
          lastRunOutput: combinedOutput,
        })
        .where(inArray(testCases.id, missing));
    }
  });

  const rows = parsed.tests.map((t) => {
    const caseId = caseIdFromFile(t.file);
    const c = caseId ? caseById.get(caseId) : undefined;
    return {
      runId,
      kind: testKindFor(c?.category, defaultKind),
      file: t.file || "unknown",
      // The on-disk filename is a UUID, so surface the case title instead —
      // it's what the dashboard shows and the only human-readable handle.
      suite: c?.title ?? t.suite,
      name: t.name,
      status: t.status,
      durationMs: t.durationMs,
      failureMessage: t.failureMessage,
      failureStack: t.failureStack,
    };
  });
  if (rows.length > 0) {
    await db.insert(testResults).values(rows);
    log("test results stored", { count: rows.length });
  }

  return perCase;
}
