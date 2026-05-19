import { NextResponse } from "next/server";
import { db, repos, runs, eq, and, sql } from "@webtesting/db";
import { verifyWebhookSignature } from "@/lib/github";
import { runsQueue } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PushPayload {
  ref: string;
  after: string;
  repository: { id: number; full_name: string };
  installation: { id: number };
  deleted?: boolean;
}

interface InstallationReposPayload {
  action: "added" | "removed";
  installation: { id: number; account: { login: string } };
  repositories_added?: GitHubRepoShort[];
  repositories_removed?: GitHubRepoShort[];
}

interface GitHubRepoShort {
  id: number;
  name: string;
  full_name: string;
}

export async function POST(req: Request) {
  const event = req.headers.get("x-github-event");
  const signature = req.headers.get("x-hub-signature-256");
  const deliveryId = req.headers.get("x-github-delivery");

  if (!event) {
    return NextResponse.json({ error: "missing event header" }, { status: 400 });
  }

  const raw = await req.text();
  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  log("received", { event, deliveryId });

  switch (event) {
    case "ping":
      return NextResponse.json({ ok: true, pong: true });

    case "push":
      return await handlePush(payload as PushPayload);

    case "installation_repositories":
      return await handleInstallationRepositories(payload as InstallationReposPayload);

    case "installation":
      // We rely on /api/github/callback for first-install repo sync.
      return NextResponse.json({ ok: true, event });

    default:
      return NextResponse.json({ ok: true, event, note: "ignored" });
  }
}

async function handlePush(p: PushPayload) {
  if (p.deleted) {
    return NextResponse.json({ ok: true, note: "branch deleted, no run" });
  }

  const branch = p.ref?.replace(/^refs\/heads\//, "") ?? "";
  const commitSha = p.after;

  if (!commitSha || /^0+$/.test(commitSha)) {
    return NextResponse.json({ ok: true, note: "zero sha, skipping" });
  }

  const [repo] = await db
    .select()
    .from(repos)
    .where(eq(repos.githubId, p.repository.id))
    .limit(1);

  if (!repo) {
    log("push for unknown repo", { repoId: p.repository.id, fullName: p.repository.full_name });
    return NextResponse.json({ ok: true, note: "repo not installed" });
  }

  const [run] = await db
    .insert(runs)
    .values({
      repoId: repo.id,
      commitSha,
      branch,
      status: "queued",
      triggeredBy: "push",
    })
    .returning();

  if (!run) {
    return NextResponse.json({ error: "failed to create run" }, { status: 500 });
  }

  const repoUrl = `https://github.com/${repo.owner}/${repo.name}`;
  await runsQueue.add(
    "run",
    { runId: run.id, repoUrl, branch, commitSha },
    { removeOnComplete: 1000, removeOnFail: 1000, attempts: 1 },
  );

  log("enqueued", { runId: run.id, repo: `${repo.owner}/${repo.name}`, branch, sha: commitSha.slice(0, 7) });
  return NextResponse.json({ ok: true, runId: run.id });
}

async function handleInstallationRepositories(p: InstallationReposPayload) {
  const installationId = p.installation.id;
  const owner = p.installation.account.login;

  if (p.action === "added" && p.repositories_added?.length) {
    for (const r of p.repositories_added) {
      const [shortName] = r.full_name.split("/").reverse();
      const repoName = shortName ?? r.name;

      // Try to upgrade an existing manually-triggered (synthetic) row first.
      const updated = await db
        .update(repos)
        .set({ installationId, githubId: r.id })
        .where(and(eq(repos.owner, owner), eq(repos.name, repoName)))
        .returning({ id: repos.id });

      if (updated.length > 0) {
        log("upgraded existing repo row", { fullName: r.full_name, installationId });
        continue;
      }

      log("installation_repositories.added — repo not in DB yet, will materialize on next callback", {
        fullName: r.full_name,
      });
      // We can't safely create a row here because we don't know which org_id
      // to attach it to. The user's next visit to /api/github/install (or any
      // callback round-trip) will populate it.
    }
  }

  if (p.action === "removed" && p.repositories_removed?.length) {
    for (const r of p.repositories_removed) {
      await db
        .update(repos)
        .set({ installationId: null })
        .where(and(eq(repos.githubId, r.id), eq(repos.installationId, installationId)));
      log("repo removed from installation", { fullName: r.full_name });
    }
  }

  return NextResponse.json({ ok: true, action: p.action });
}

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), source: "github-webhook", event, ...data }));
}
