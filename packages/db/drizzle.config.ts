import { defineConfig } from "drizzle-kit";

const url =
  process.env.DATABASE_URL ?? "postgres://app:app@localhost:5433/webtesting";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
});
