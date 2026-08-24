import type { Octokit } from "@octokit/rest";
import type { RepoContextFile } from "@webtesting/ai";

/**
 * Files we always try to fetch when reading a repo for AI context.
 * Other files are picked up via heuristics from the tree.
 */
const ALWAYS_FETCH = [
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "README.md",
];

const COMPONENT_HINTS = [
  "src/App.tsx",
  "src/App.jsx",
  "src/App.js",
  "src/main.tsx",
  "src/main.jsx",
  "src/index.tsx",
  "src/index.jsx",
  "src/routes.tsx",
  "src/routes.ts",
  "app/page.tsx",
  "app/layout.tsx",
  "pages/_app.tsx",
  "pages/_app.jsx",
  "pages/index.tsx",
  "pages/index.jsx",
];

const MAX_TREE_ENTRIES = 600;
const MAX_FILES = 50;
const MAX_FILE_BYTES = 30_000;

export interface RepoSnapshot {
  defaultBranch: string;
  headSha: string;
  fileTree: string[];
  files: RepoContextFile[];
}

/**
 * Pull a compact snapshot of a repo: tree + key files. Bounded so the AI
 * context stays reasonable even on large repos.
 */
export async function snapshotRepo(
  octokit: Octokit,
  owner: string,
  name: string,
): Promise<RepoSnapshot> {
  const { data: repoMeta } = await octokit.rest.repos.get({ owner, repo: name });
  const defaultBranch = repoMeta.default_branch;

  const { data: ref } = await octokit.rest.git.getRef({
    owner,
    repo: name,
    ref: `heads/${defaultBranch}`,
  });
  const headSha = ref.object.sha;

  const { data: tree } = await octokit.rest.git.getTree({
    owner,
    repo: name,
    tree_sha: headSha,
    recursive: "true",
  });

  const fileTree = (tree.tree ?? [])
    .filter((e) => e.type === "blob" && e.path)
    .map((e) => e.path as string)
    .filter(notNoise)
    .slice(0, MAX_TREE_ENTRIES);

  const candidates = pickCandidates(fileTree);
  const files: RepoContextFile[] = [];

  for (const path of candidates) {
    if (files.length >= MAX_FILES) break;
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo: name,
        path,
        ref: headSha,
      });
      if (Array.isArray(data) || data.type !== "file" || !("content" in data)) continue;
      const buf = Buffer.from(data.content, data.encoding as BufferEncoding);
      if (buf.length > MAX_FILE_BYTES) continue;
      files.push({ path, content: buf.toString("utf8") });
    } catch {
      // 404s / binary content / etc. — skip silently
    }
  }

  return { defaultBranch, headSha, fileTree, files };
}

function pickCandidates(tree: string[]): string[] {
  const set = new Set<string>();
  for (const p of ALWAYS_FETCH) if (tree.includes(p)) set.add(p);
  for (const p of COMPONENT_HINTS) if (tree.includes(p)) set.add(p);

  // Up to 12 page/route files
  const pages = tree
    .filter((p) => /^(src\/)?(pages|app|routes)\/.+\.(tsx?|jsx?)$/.test(p))
    .slice(0, 12);
  for (const p of pages) set.add(p);

  // Up to 25 component files — the AI needs to read enough source to produce
  // assertions that match the actual rendered text (not abbreviated guesses).
  const components = tree
    .filter((p) => /^(src\/)?components\/.+\.(tsx?|jsx?)$/.test(p))
    .slice(0, 25);
  for (const p of components) set.add(p);

  return [...set];
}

function notNoise(p: string): boolean {
  return !(
    p.startsWith("node_modules/") ||
    p.startsWith(".next/") ||
    p.startsWith("dist/") ||
    p.startsWith("build/") ||
    p.startsWith(".git/") ||
    p.startsWith("coverage/") ||
    p.endsWith(".lock") ||
    p.endsWith(".png") ||
    p.endsWith(".jpg") ||
    p.endsWith(".jpeg") ||
    p.endsWith(".gif") ||
    p.endsWith(".webp") ||
    p.endsWith(".ico") ||
    p.endsWith(".woff") ||
    p.endsWith(".woff2")
  );
}

