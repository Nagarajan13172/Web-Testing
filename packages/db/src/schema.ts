import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ---------- enums ---------- */

export const runStatusEnum = pgEnum("run_status", [
  "queued",
  "running",
  "success",
  "failure",
  "cancelled",
]);

export const stepStatusEnum = pgEnum("step_status", [
  "queued",
  "running",
  "success",
  "failure",
  "skipped",
]);

export const testKindEnum = pgEnum("test_kind", [
  "unit",
  "integration",
  "e2e",
  "snapshot",
]);

export const testStatusEnum = pgEnum("test_status", [
  "passed",
  "failed",
  "skipped",
]);

export const aiArtifactKindEnum = pgEnum("ai_artifact_kind", [
  "generated_test",
  "review",
  "explanation",
]);

export const testCaseStatusEnum = pgEnum("test_case_status", [
  "pending",
  "running",
  "passed",
  "failed",
]);

/* ---------- users / orgs ---------- */

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const orgs = pgTable("orgs", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ---------- repos ---------- */

export const repos = pgTable(
  "repos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    githubId: bigint("github_id", { mode: "number" }).notNull(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    installationId: bigint("installation_id", { mode: "number" }),
    targetDomain: text("target_domain"),
    framework: text("framework"),               // e.g. "vite-react", "next-app", "vue", "static", "unknown"
    testRunnerKind: text("test_runner_kind"),   // "vitest" | "playwright"
    frameworkDetectedAt: timestamp("framework_detected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    githubIdIdx: uniqueIndex("repos_github_id_idx").on(t.githubId),
    orgIdx: index("repos_org_idx").on(t.orgId),
  }),
);

export const testCases = pgTable(
  "test_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    status: testCaseStatusEnum("status").notNull().default("pending"),
    targetRoute: text("target_route"),
    expectedResult: text("expected_result"),
    playwrightCode: text("playwright_code").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastDurationMs: integer("last_duration_ms"),
    lastFailureMessage: text("last_failure_message"),
    lastFailureStack: text("last_failure_stack"),
    lastRunOutput: text("last_run_output"),
  },
  (t) => ({
    repoIdx: index("test_cases_repo_idx").on(t.repoId, t.generatedAt),
  }),
);

/* ---------- secrets vault ---------- */

export const secrets = pgTable(
  "secrets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    ciphertext: text("ciphertext").notNull(),
    nonce: text("nonce").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    repoKeyIdx: uniqueIndex("secrets_repo_key_idx").on(t.repoId, t.key),
  }),
);

/* ---------- runs ---------- */

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    commitSha: text("commit_sha").notNull(),
    branch: text("branch").notNull(),
    status: runStatusEnum("status").notNull().default("queued"),
    triggeredBy: text("triggered_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    repoIdx: index("runs_repo_idx").on(t.repoId, t.createdAt),
  }),
);

/* ---------- run_steps ---------- */

export const runSteps = pgTable(
  "run_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: testKindEnum("kind"),
    status: stepStatusEnum("status").notNull().default("queued"),
    durationMs: integer("duration_ms"),
    logUrl: text("log_url"),
    exitCode: integer("exit_code"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    runIdx: index("run_steps_run_idx").on(t.runId),
  }),
);

/* ---------- test_results ---------- */

export const testResults = pgTable(
  "test_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    kind: testKindEnum("kind").notNull(),
    file: text("file").notNull(),
    suite: text("suite"),
    name: text("name").notNull(),
    status: testStatusEnum("status").notNull(),
    durationMs: integer("duration_ms"),
    failureMessage: text("failure_message"),
    failureStack: text("failure_stack"),
  },
  (t) => ({
    runKindIdx: index("test_results_run_kind_idx").on(t.runId, t.kind),
    runStatusIdx: index("test_results_run_status_idx").on(t.runId, t.status),
  }),
);

/* ---------- coverage ---------- */

export const coverage = pgTable(
  "coverage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    file: text("file").notNull(),
    linesTotal: integer("lines_total").notNull(),
    linesCovered: integer("lines_covered").notNull(),
    pct: integer("pct").notNull(),
  },
  (t) => ({
    runIdx: index("coverage_run_idx").on(t.runId),
  }),
);

/* ---------- ai_artifacts ---------- */

export const aiArtifacts = pgTable(
  "ai_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    kind: aiArtifactKindEnum("kind").notNull(),
    contentUrl: text("content_url"),
    content: jsonb("content"),
    relatedTestId: uuid("related_test_id").references(() => testResults.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    runIdx: index("ai_artifacts_run_idx").on(t.runId),
  }),
);

/* ---------- exports ---------- */

export type User = typeof users.$inferSelect;
export type Repo = typeof repos.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunStep = typeof runSteps.$inferSelect;
export type TestResult = typeof testResults.$inferSelect;
export type TestCase = typeof testCases.$inferSelect;

export const _schema = { sql };
