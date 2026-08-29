CREATE TYPE "public"."test_case_source" AS ENUM('ai', 'manual');--> statement-breakpoint
ALTER TABLE "test_cases" ADD COLUMN "source" "test_case_source" DEFAULT 'ai' NOT NULL;