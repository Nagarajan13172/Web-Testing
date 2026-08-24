import { Worker } from "bullmq";
import { db, runs, testCases, eq, inArray } from "@webtesting/db";
import { RUNS_QUEUE, connection, type RunJob } from "./queue";
import { runJob } from "./orchestrator";
import { runVitestCases } from "./vitest-runner";

const worker = new Worker<RunJob>(
  RUNS_QUEUE,
  async (job) => {
    const isTestCases = job.data.kind === "test-cases";
    const tag = isTestCases ? "tc-" + (job.data as { repoId: string }).repoId.slice(0, 8) : (job.data as { runId: string }).runId;
    const log = (event: string, data: Record<string, unknown> = {}) =>
      console.log(JSON.stringify({ ts: new Date().toISOString(), event, job: tag, ...data }));

    if (job.data.kind === "test-cases") {
      log("test-cases picked up", {
        count: job.data.testCaseIds.length,
        runner: "vitest",
      });
      await runVitestCases(
        { repoId: job.data.repoId, testCaseIds: job.data.testCaseIds },
        log,
      );
      return;
    }

    log("git-push picked up", { repoUrl: job.data.repoUrl });
    await runJob(job.data, log);
  },
  { connection, concurrency: 1 },
);

worker.on("failed", async (job, err) => {
  if (!job) return;
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    event: "job failed",
    err: err.message,
    kind: job.data.kind ?? "git-push",
  }));

  if (job.data.kind === "test-cases") {
    await db
      .update(testCases)
      .set({
        status: "failed",
        lastRunAt: new Date(),
        lastFailureMessage: `worker error: ${err.message}`,
      })
      .where(inArray(testCases.id, job.data.testCaseIds));
  } else {
    await db
      .update(runs)
      .set({ status: "failure", finishedAt: new Date() })
      .where(eq(runs.id, job.data.runId));
  }
});

worker.on("ready", () =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "ready", queue: RUNS_QUEUE })),
);
worker.on("error", (err) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "worker error", err: err.message })),
);

const shutdown = async (signal: string) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "shutdown", signal }));
  await worker.close();
  connection.disconnect();
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
