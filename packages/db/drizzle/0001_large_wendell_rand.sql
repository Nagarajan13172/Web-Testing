CREATE TYPE "public"."test_case_status" AS ENUM('pending', 'running', 'passed', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "test_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"status" "test_case_status" DEFAULT 'pending' NOT NULL,
	"playwright_code" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_duration_ms" integer,
	"last_failure_message" text,
	"last_failure_stack" text
);
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "target_domain" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_cases_repo_idx" ON "test_cases" USING btree ("repo_id","generated_at");