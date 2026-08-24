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

const SUPPORTED_FRAMEWORKS: Framework[] = [
  "next-app",
  "next-pages",
  "vite-react",
  "cra",
  "remix",
];

export function isSupportedFramework(f: Framework): boolean {
  return SUPPORTED_FRAMEWORKS.includes(f);
}

export interface DetectionResult {
  framework: Framework;
  testRunnerKind: TestRunnerKind;
  /** True when the platform supports running Vitest on this stack. */
  supported: boolean;
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
    return result({
      framework,
      hint: "Next.js project — Vitest covers component and hook logic.",
      packageManager,
      hasTypescript,
    });
  }

  if (has("@remix-run/react") || has("@remix-run/node")) {
    return result({
      framework: "remix",
      hint: "Remix project — Vitest covers route/component logic.",
      packageManager,
      hasTypescript,
    });
  }

  if (has("react") && (has("vite") || fileSet.has("vite.config.ts") || fileSet.has("vite.config.js"))) {
    return result({
      framework: "vite-react",
      hint: "Vite + React project — Vitest runs your components in happy-dom.",
      packageManager,
      hasTypescript,
    });
  }

  if (has("react-scripts")) {
    return result({
      framework: "cra",
      hint: "Create-React-App project — Vitest replaces the bundled Jest setup.",
      packageManager,
      hasTypescript,
    });
  }

  if (has("react")) {
    return result({
      framework: "vite-react",   // fallback: treat plain React deps as Vite-React
      hint: "React project — Vitest covers component tests.",
      packageManager,
      hasTypescript,
    });
  }

  if (has("vue")) {
    return result({
      framework: "vue",
      hint: "Vue project — this platform currently supports React projects only.",
      packageManager,
      hasTypescript,
    });
  }

  if (has("svelte") || has("@sveltejs/kit")) {
    return result({
      framework: "svelte",
      hint: "Svelte project — this platform currently supports React projects only.",
      packageManager,
      hasTypescript,
    });
  }

  if (fileSet.has("index.html") || fileSet.has("public/index.html")) {
    return result({
      framework: "static",
      hint: "Static site — no React detected. This platform currently supports React projects only.",
      packageManager,
      hasTypescript,
    });
  }

  if (pkg && (pkg as { main?: unknown }).main) {
    return result({
      framework: "node-library",
      hint: "Node library — no React detected. This platform currently supports React projects only.",
      packageManager,
      hasTypescript,
    });
  }

  return result({
    framework: "unknown",
    hint: "Couldn't detect a framework from package.json. This platform currently supports React projects only.",
    packageManager,
    hasTypescript,
  });
}

function result(input: {
  framework: Framework;
  hint: string;
  packageManager: DetectionResult["packageManager"];
  hasTypescript: boolean;
}): DetectionResult {
  const supported = isSupportedFramework(input.framework);
  return {
    framework: input.framework,
    testRunnerKind: "vitest",
    supported,
    hint: input.hint,
    packageManager: input.packageManager,
    hasTypescript: input.hasTypescript,
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
