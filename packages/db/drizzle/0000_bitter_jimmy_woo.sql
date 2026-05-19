CREATE TYPE "public"."ai_artifact_kind" AS ENUM('generated_test', 'review', 'explanation');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'success', 'failure', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('queued', 'running', 'success', 'failure', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."test_kind" AS ENUM('unit', 'integration', 'e2e', 'snapshot');--> statement-breakpoint
CREATE TYPE "public"."test_status" AS ENUM('passed', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" "ai_artifact_kind" NOT NULL,
	"content_url" text,
	"content" jsonb,
	"related_test_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coverage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"file" text NOT NULL,
	"lines_total" integer NOT NULL,
	"lines_covered" integer NOT NULL,
	"pct" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"github_id" bigint NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"installation_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "test_kind",
	"status" "step_status" DEFAULT 'queued' NOT NULL,
	"duration_ms" integer,
	"log_url" text,
	"exit_code" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"branch" text NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"triggered_by" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"key" text NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "test_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" "test_kind" NOT NULL,
	"file" text NOT NULL,
	"suite" text,
	"name" text NOT NULL,
	"status" "test_status" NOT NULL,
	"duration_ms" integer,
	"failure_message" text,
	"failure_stack" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_related_test_id_test_results_id_fk" FOREIGN KEY ("related_test_id") REFERENCES "public"."test_results"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coverage" ADD CONSTRAINT "coverage_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orgs" ADD CONSTRAINT "orgs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repos" ADD CONSTRAINT "repos_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runs" ADD CONSTRAINT "runs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "secrets" ADD CONSTRAINT "secrets_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "test_results" ADD CONSTRAINT "test_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_artifacts_run_idx" ON "ai_artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coverage_run_idx" ON "coverage" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repos_github_id_idx" ON "repos" USING btree ("github_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repos_org_idx" ON "repos" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_steps_run_idx" ON "run_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_repo_idx" ON "runs" USING btree ("repo_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "secrets_repo_key_idx" ON "secrets" USING btree ("repo_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_results_run_kind_idx" ON "test_results" USING btree ("run_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_results_run_status_idx" ON "test_results" USING btree ("run_id","status");