import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const RUNS_QUEUE = "runs";

export type RunJob =
  | {
      kind?: "git-push";
      runId: string;
      repoUrl: string;
      branch: string;
      commitSha: string;
    }
  | {
      kind: "test-cases";
      repoId: string;
      testCaseIds: string[];
      runnerKind: "vitest" | "playwright";
      targetDomain?: string | null;
    };

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const globalForRedis = globalThis as unknown as {
  __webtesting_redis?: Redis;
  __webtesting_runs_queue?: Queue<RunJob>;
};

export const connection =
  globalForRedis.__webtesting_redis ??
  new Redis(redisUrl, { maxRetriesPerRequest: null });

export const runsQueue =
  globalForRedis.__webtesting_runs_queue ??
  new Queue<RunJob>(RUNS_QUEUE, { connection });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.__webtesting_redis = connection;
  globalForRedis.__webtesting_runs_queue = runsQueue;
}
