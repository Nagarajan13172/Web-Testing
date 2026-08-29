import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The db package reads DATABASE_URL at import time and vitest doesn't load
 * .env.local the way `next dev` does, so seed it here.
 *
 * Deliberately a small parser rather than dotenv/loadEnv: neither is a direct
 * dependency of this package, and all we need are the simple single-line values
 * (DATABASE_URL, REDIS_URL). Lines opening a multi-line quoted value — the
 * GitHub App private key — are skipped rather than half-parsed.
 */
function loadLocalEnv(): void {
  let raw: string;
  try {
    raw = readFileSync(fileURLToPath(new URL("./.env.local", import.meta.url)), "utf8");
  } catch {
    return; // CI may inject the environment directly.
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m || !m[1]) continue;
    const value = (m[2] ?? "").trim();
    // An opening quote with no closing quote on the same line starts a block.
    if (/^["'](?:[^"']|$)*$/.test(value)) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = value.replace(/^(["'])(.*)\1$/, "$2");
    }
  }
}
loadLocalEnv();

/**
 * Integration tests for the route handlers.
 *
 * These run against the real local Postgres rather than a mock: the behaviour
 * worth protecting is which rows a request creates, deletes and is allowed to
 * see, and a mocked database would assert nothing about that. Clerk is the one
 * thing stubbed, since its dev-browser handshake can't be driven headlessly.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    // Route handlers share one Postgres; parallel files would race on cleanup.
    fileParallelism: false,
  },
});
