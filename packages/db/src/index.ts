import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Did you start docker compose and copy .env.example to .env.local?",
  );
}

const client = postgres(url, { prepare: false });

export const db = drizzle(client, { schema });
export type Database = typeof db;

export * from "./schema";
export { eq, and, or, desc, asc, sql, inArray, notInArray, isNotNull, isNull } from "drizzle-orm";
