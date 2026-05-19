import type { Octokit } from "@octokit/rest";

export type Framework =
  | "next-app"
  | "next-pages"
  | "vite-react"
  | "cra"
  | "remix"
  | "vue"
  | "svelte"
  | "static"
  | "node-library"
  | "unknown";

export type TestRunnerKind = "vitest" | "playwright";

export interface DetectionResult {
  framework: Framework;
  testRunnerKind: TestRunnerKind;
  hint: string;            // human-readable explanation
  packageManager: "pnpm" | "npm" | "yarn";
  hasTypescript: boolean;
}

/**
 * Reads package.json + a few key files from the repo and infers the framework.
 * Pure inspection — no AI call, deterministic.
 */
export async function detectFramework(
  octokit: Octokit,
  owner: string,
  name: string,
): Promise<DetectionResult> {
  const pkg = await fetchJson(octokit, owner, name, "package.json");
  const tree = await fetchTree(octokit, owner, name);
  const fileSet = new Set(tree);

  const deps = combineDeps(pkg);
  const has = (k: string) => Object.prototype.hasOwnProperty.call(deps, k);

  const hasTypescript = has("typescript") || fileSet.has("tsconfig.json");

  const packageManager = fileSet.has("pnpm-lock.yaml")
    ? "pnpm"
    : fileSet.has("yarn.lock")
      ? "yarn"
      : "npm";

  // Order matters — more specific frameworks first.
  if (has("next")) {
    const framework: Framework = fileSet.has("app/page.tsx") || fileSet.has("src/app/page.tsx") || fileSet.has("app/layout.tsx")
      ? "next-app"
      : "next-pages";
    return {
      framework,
      testRunnerKind: "vitest",
      hint: "Next.js project — Vitest is the right runner for component logic. Use Playwright separately for full-page flows.",
      packageManager,
      hasTypescript,
    };
  }

  if (has("@remix-run/react") || has("@remix-run/node")) {
    return {
      framework: "remix",
      testRunnerKind: "vitest",
      hint: "Remix project — Vitest covers route/component logic.",
      packageManager,
      hasTypescript,
    };
  }

  if (has("react") && (has("vite") || fileSet.has("vite.config.ts") || fileSet.has("vite.config.js"))) {
    return {
      framework: "vite-react",
      testRunnerKind: "vitest",
      hint: "Vite + React project — Vitest runs in Node and tests components directly. No Target Domain needed.",
      packageManager,
      hasTypescript,
    };
  }

  if (has("react-scripts")) {
    return {
      framework: "cra",
      testRunnerKind: "vitest",
      hint: "Create-React-App project — Vitest can replace the bundled Jest setup.",
      packageManager,
      hasTypescript,
    };
  }

  if (has("react")) {
    return {
      framework: "vite-react",   // fallback: assume vite-style for plain React deps
      testRunnerKind: "vitest",
      hint: "React library/project — Vitest covers component tests.",
      packageManager,
      hasTypescript,
    };
  }

  if (has("vue")) {
    return {
      framework: "vue",
      testRunnerKind: "vitest",
      hint: "Vue project — Vitest with @vue/test-utils.",
      packageManager,
      hasTypescript,
    };
  }

  if (has("svelte") || has("@sveltejs/kit")) {
    return {
      framework: "svelte",
      testRunnerKind: "vitest",
      hint: "Svelte project — Vitest is the default runner.",
      packageManager,
      hasTypescript,
    };
  }

  // No frontend framework detected. Is there an index.html or other web entry?
  if (fileSet.has("index.html") || fileSet.has("public/index.html")) {
    return {
      framework: "static",
      testRunnerKind: "playwright",
      hint: "Static / multi-page site — Playwright will exercise it against the Target Domain.",
      packageManager,
      hasTypescript,
    };
  }

  if (pkg && (pkg as { main?: unknown }).main) {
    return {
      framework: "node-library",
      testRunnerKind: "vitest",
      hint: "Node library — Vitest runs the unit tests.",
      packageManager,
      hasTypescript,
    };
  }

  return {
    framework: "unknown",
    testRunnerKind: "playwright",
    hint: "Couldn't infer the framework from package.json. Falling back to Playwright against the Target Domain.",
    packageManager,
    hasTypescript,
  };
}

async function fetchJson(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return null;
    const buf = Buffer.from(data.content, data.encoding as BufferEncoding);
    return JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchTree(octokit: Octokit, owner: string, repo: string): Promise<string[]> {
  try {
    const { data: meta } = await octokit.rest.repos.get({ owner, repo });
    const { data: tree } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: meta.default_branch,
      recursive: "true",
    });
    return (tree.tree ?? []).map((e) => e.path ?? "").filter(Boolean) as string[];
  } catch {
    return [];
  }
}

function combineDeps(pkg: Record<string, unknown> | null): Record<string, string> {
  if (!pkg) return {};
  const out: Record<string, string> = {};
  for (const key of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const obj = pkg[key];
    if (obj && typeof obj === "object") Object.assign(out, obj);
  }
  return out;
}
