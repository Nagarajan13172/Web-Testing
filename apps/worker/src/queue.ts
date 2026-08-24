import { Redis } from "ioredis";

export const RUNS_QUEUE = "runs";

export interface GitPushJob {
  kind?: "git-push";
  runId: string;
  repoUrl: string;
  branch: string;
  commitSha: string;
}

export interface TestCasesJob {
  kind: "test-cases";
  repoId: string;
  testCaseIds: string[];
  runnerKind: "vitest";
}

export type RunJob = GitPushJob | TestCasesJob;

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});
