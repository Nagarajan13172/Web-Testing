import { NextResponse } from "next/server";
import { db, runs, repos, eq, desc, and } from "@webtesting/db";
import { runsQueue } from "@/lib/queue";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

interface CreateRunBody {
  repoUrl?: string;
  repoId?: string;
  branch?: string;
  commitSha?: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as CreateRunBody | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const { org } = await requireUser();

  const branch = body.branch ?? "main";
  const commitSha = body.commitSha ?? "HEAD";

  const repo = body.repoId
    ? await loadRepoById(body.repoId, org.id)
    : body.repoUrl
      ? await materializeRepo(body.repoUrl, org.id)
      : null;

  if (!repo) {
    return NextResponse.json(
      { error: "repoId or repoUrl is required" },
      { status: 400 },
    );
  }

  const repoUrl =
    body.repoUrl ?? `https://github.com/${repo.owner}/${repo.name}`;

  const [run] = await db
    .insert(runs)
    .values({
      repoId: repo.id,
      commitSha,
      branch,
      status: "queued",
      triggeredBy: "manual",
    })
    .returning();

  if (!run) {
    return NextResponse.json({ error: "failed to insert run" }, { status: 500 });
  }

  await runsQueue.add(
    "run",
    { runId: run.id, repoUrl, branch, commitSha },
    { removeOnComplete: 1000, removeOnFail: 1000, attempts: 1 },
  );

  return NextResponse.json({ run }, { status: 201 });
}

export async function GET() {
  const { org } = await requireUser();
  const rows = await db
    .select({
      id: runs.id,
      status: runs.status,
      branch: runs.branch,
      commitSha: runs.commitSha,
      triggeredBy: runs.triggeredBy,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      createdAt: runs.createdAt,
      repoOwner: repos.owner,
      repoName: repos.name,
    })
    .from(runs)
    .leftJoin(repos, eq(runs.repoId, repos.id))
    .where(eq(repos.orgId, org.id))
    .orderBy(desc(runs.createdAt))
    .limit(50);

  return NextResponse.json({ runs: rows });
}

async function loadRepoById(repoId: string, orgId: string) {
  if (!/^[0-9a-f-]{36}$/.test(repoId)) return null;
  const [repo] = await db
    .select()
    .from(repos)
    .where(and(eq(repos.id, repoId), eq(repos.orgId, orgId)))
    .limit(1);
  return repo ?? null;
}

/**
 * Fallback for non-GitHub repo URLs (local fixtures, file://, etc.) so the
 * platform stays usable without a GitHub App install. Synthesizes a stable
 * github_id from the URL so the unique constraint still works.
 */
async function materializeRepo(repoUrl: string, orgId: string) {
  const { owner, name } = parseRepoUrl(repoUrl);
  const githubId = syntheticGithubId(owner, name);

  const existing = await db
    .select()
    .from(repos)
    .where(eq(repos.githubId, githubId))
    .limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(repos)
    .values({ orgId, githubId, owner, name, defaultBranch: "main" })
    .returning();
  return created ?? null;
}

function parseRepoUrl(url: string): { owner: string; name: string } {
  const cleaned = url.replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/");
  const match = cleaned.match(/github\.com\/([^/]+)\/([^/?#]+)/);
  if (match && match[1] && match[2]) return { owner: match[1], name: match[2] };
  return { owner: "local", name: cleaned.split("/").pop() ?? "unknown" };
}

function syntheticGithubId(owner: string, name: string): number {
  let h = 2166136261;
  for (const ch of `${owner}/${name}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
