import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url =
  process.env.DATABASE_URL ?? "postgres://app:app@localhost:5433/webtesting";

const client = postgres(url, { max: 1 });
const db = drizzle(client);

console.log("Running migrations against", url.replace(/:[^:@/]+@/, ":***@"));

await migrate(db, { migrationsFolder: "./drizzle" });

console.log("Migrations applied.");
await client.end();
