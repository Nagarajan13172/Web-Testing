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

export interface CreateTestsPRInput {
  octokit: Octokit;
  owner: string;
  name: string;
  defaultBranch: string;
  headSha: string;
  branchName: string;
  files: { path: string; content: string }[];
  prTitle: string;
  prBody: string;
}

/**
 * Commits the generated files to a new branch and opens a PR against the
 * repo's default branch. If the branch already exists from a prior run we
 * force-push a new tree on top of the current default-branch head.
 */
export async function createTestsPR(input: CreateTestsPRInput): Promise<{ prUrl: string; prNumber: number }> {
  const { octokit, owner, name, defaultBranch, headSha, branchName, files, prTitle, prBody } = input;

  // Create blobs in parallel.
  const blobs = await Promise.all(
    files.map(async (f) => {
      const { data } = await octokit.rest.git.createBlob({
        owner,
        repo: name,
        content: f.content,
        encoding: "utf-8",
      });
      return { path: f.path, sha: data.sha };
    }),
  );

  const { data: tree } = await octokit.rest.git.createTree({
    owner,
    repo: name,
    base_tree: headSha,
    tree: blobs.map((b) => ({
      path: b.path,
      mode: "100644",
      type: "blob",
      sha: b.sha,
    })),
  });

  const { data: commit } = await octokit.rest.git.createCommit({
    owner,
    repo: name,
    message: prTitle,
    tree: tree.sha,
    parents: [headSha],
  });

  const branchRef = `refs/heads/${branchName}`;
  try {
    await octokit.rest.git.createRef({ owner, repo: name, ref: branchRef, sha: commit.sha });
  } catch (err) {
    if (isRefExistsError(err)) {
      await octokit.rest.git.updateRef({
        owner,
        repo: name,
        ref: `heads/${branchName}`,
        sha: commit.sha,
        force: true,
      });
    } else {
      throw err;
    }
  }

  // Reuse an open PR with the same head if one exists; otherwise create.
  const { data: existingPRs } = await octokit.rest.pulls.list({
    owner,
    repo: name,
    head: `${owner}:${branchName}`,
    state: "open",
  });
  if (existingPRs[0]) {
    return { prUrl: existingPRs[0].html_url, prNumber: existingPRs[0].number };
  }

  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo: name,
    head: branchName,
    base: defaultBranch,
    title: prTitle,
    body: prBody,
  });
  return { prUrl: pr.html_url, prNumber: pr.number };
}

function isRefExistsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: number }).status;
  return status === 422;
}
