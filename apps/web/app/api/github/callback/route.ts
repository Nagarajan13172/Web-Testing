import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { db, repos, eq, and, sql } from "@webtesting/db";
import { requireUser } from "@/lib/auth";
import { installationOctokit } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const installationIdStr = url.searchParams.get("installation_id");
  if (!installationIdStr) {
    return NextResponse.json({ error: "missing installation_id" }, { status: 400 });
  }

  const installationId = Number(installationIdStr);
  if (!Number.isFinite(installationId)) {
    return NextResponse.json({ error: "invalid installation_id" }, { status: 400 });
  }

  const { org } = await requireUser();

  const octokit = installationOctokit(installationId);
  const accessible = await octokit.paginate(
    "GET /installation/repositories",
    { per_page: 100 },
  ) as Array<{
    id: number;
    name: string;
    default_branch: string;
    owner: { login: string };
  }>;

  if (accessible.length === 0) {
    redirect("/dashboard?installed=1&empty=1");
  }

  const skipped: string[] = [];

  for (const r of accessible) {
    // github_id is globally unique, so a repo can only live under one org.
    // If somebody else already has it, leave it alone — silently reassigning
    // orgId here would hand another workspace's repo (and its run history)
    // to whoever installs the App next.
    const [owned] = await db
      .select({ orgId: repos.orgId })
      .from(repos)
      .where(eq(repos.githubId, r.id))
      .limit(1);
    if (owned && owned.orgId !== org.id) {
      skipped.push(`${r.owner.login}/${r.name}`);
      continue;
    }

    // Next: try to upgrade any row that was previously created via the
    // manual trigger flow (synthetic github_id, NULL installation_id).
    const existingByName = await db
      .select({ id: repos.id, githubId: repos.githubId, installationId: repos.installationId })
      .from(repos)
      .where(and(eq(repos.orgId, org.id), eq(repos.owner, r.owner.login), eq(repos.name, r.name)))
      .limit(1);

    if (existingByName[0] && existingByName[0].githubId !== r.id) {
      await db
        .update(repos)
        .set({
          githubId: r.id,
          installationId,
          defaultBranch: r.default_branch ?? "main",
        })
        .where(eq(repos.id, existingByName[0].id));
      continue;
    }

    await db
      .insert(repos)
      .values({
        orgId: org.id,
        githubId: r.id,
        owner: r.owner.login,
        name: r.name,
        defaultBranch: r.default_branch ?? "main",
        installationId,
      })
      .onConflictDoUpdate({
        target: repos.githubId,
        // orgId is deliberately NOT updated here — the guard above already
        // established this row is ours, and reassigning it on conflict is how
        // repos got transferred between workspaces.
        set: {
          installationId,
          owner: r.owner.login,
          name: r.name,
          defaultBranch: sql`COALESCE(EXCLUDED.default_branch, ${repos.defaultBranch})`,
        },
      });
  }

  if (skipped.length > 0) {
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "install skipped repos owned by another org",
        installationId,
        repos: skipped,
      }),
    );
  }

  redirect(`/dashboard?installed=1${skipped.length > 0 ? `&skipped=${skipped.length}` : ""}`);
}
