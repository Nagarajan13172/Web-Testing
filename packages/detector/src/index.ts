import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type Stack = "js" | "python" | "java" | "go";
export type TestRunner = "vitest" | "jest" | "none";
export type TestKind = "unit" | "integration" | "e2e" | "snapshot";

export interface TestFile {
  path: string;
  kind: TestKind;
}

export interface JsDetection {
  stack: "js";
  packageManager: "pnpm" | "npm" | "yarn";
  testRunner: TestRunner;
  hasTypescript: boolean;
  hasEslint: boolean;
  testFiles: TestFile[];
}

export interface DetectionResult {
  stacks: JsDetection[];
}

export function detect(repoDir: string): DetectionResult {
  const stacks: JsDetection[] = [];
  const js = detectJs(repoDir);
  if (js) stacks.push(js);
  return { stacks };
}

function detectJs(repoDir: string): JsDetection | null {
  const pkgPath = join(repoDir, "package.json");
  if (!existsSync(pkgPath)) return null;

  let pkg: Record<string, unknown> = {};
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  const deps = combineDeps(pkg);
  const testRunner: TestRunner = "vitest" in deps
    ? "vitest"
    : "jest" in deps
      ? "jest"
      : "none";

  const packageManager = existsSync(join(repoDir, "pnpm-lock.yaml"))
    ? "pnpm"
    : existsSync(join(repoDir, "yarn.lock"))
      ? "yarn"
      : "npm";

  const hasTypescript = "typescript" in deps || existsSync(join(repoDir, "tsconfig.json"));
  const hasEslint = "eslint" in deps || existsSync(join(repoDir, ".eslintrc")) ||
    existsSync(join(repoDir, ".eslintrc.js")) || existsSync(join(repoDir, ".eslintrc.cjs")) ||
    existsSync(join(repoDir, ".eslintrc.json")) || existsSync(join(repoDir, "eslint.config.js")) ||
    existsSync(join(repoDir, "eslint.config.mjs"));

  return {
    stack: "js",
    packageManager,
    testRunner,
    hasTypescript,
    hasEslint,
    testFiles: findTestFiles(repoDir, repoDir),
  };
}

function combineDeps(pkg: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const obj = pkg[key];
    if (obj && typeof obj === "object") Object.assign(out, obj);
  }
  return out;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "out",
  ".cache",
]);

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/;

function findTestFiles(
  root: string,
  dir: string,
  depth = 0,
  out: TestFile[] = [],
): TestFile[] {
  if (depth > 8) return out;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) {
      findTestFiles(root, full, depth + 1, out);
    } else if (s.isFile() && TEST_FILE_RE.test(entry)) {
      const rel = relative(root, full);
      out.push({ path: rel, kind: classifyTest(rel) });
    }
  }
  return out;
}

function classifyTest(filePath: string): TestKind {
  const lower = filePath.toLowerCase();
  if (/[/\\]e2e[/\\]/.test(lower) || /\.e2e\./.test(lower)) return "e2e";
  if (/[/\\]integration[/\\]/.test(lower) || /\.integration\./.test(lower)) return "integration";
  if (lower.includes("__snapshots__")) return "snapshot";
  return "unit";
}
