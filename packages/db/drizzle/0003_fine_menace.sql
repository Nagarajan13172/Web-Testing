ALTER TABLE "repos" ADD COLUMN "framework" text;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "test_runner_kind" text;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "framework_detected_at" timestamp with time zone;