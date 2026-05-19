import { NextResponse } from "next/server";
import { db, repos, eq, and, sql, isNotNull } from "@webtesting/db";
import { requireUser } from "@/lib/auth";
import { installationOctokit } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reconcile this org's repo rows with the GitHub App installation(s) they
 * already have. Picks every distinct installationId we've seen for this org,
 * lists the installation's accessible repos, and upserts each (using the same
 * dedupe-by-name rules as the callback).
 *
 * Useful when GitHub doesn't fire a redirect after an install (e.g. when the
 * App's Setup URL isn't configured) and rows are missing or stale.
 */
export async function POST() {
  const { org } = await requireUser();

  const installations = await db
    .selectDistinct({ installationId: repos.installationId })
    .from(repos)
    .where(and(eq(repos.orgId, org.id), isNotNull(repos.installationId)));

  const ids = installations.map((r) => r.installationId).filter((x): x is number => x != null);

  if (ids.length === 0) {
    return NextResponse.json(
      {
        error:
          "No installation found for this org. Click 'Connect GitHub repo' first to install the App.",
      },
      { status: 400 },
    );
  }

  let synced = 0;
  const errors: string[] = [];

  for (const installationId of ids) {
    try {
      const octokit = installationOctokit(installationId);
      const accessible = (await octokit.paginate("GET /installation/repositories", {
        per_page: 100,
      })) as Array<{
        id: number;
        name: string;
        default_branch: string;
        owner: { login: string };
      }>;

      for (const r of accessible) {
        const existingByName = await db
          .select({ id: repos.id, githubId: repos.githubId })
          .from(repos)
          .where(
            and(eq(repos.orgId, org.id), eq(repos.owner, r.owner.login), eq(repos.name, r.name)),
          )
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
          synced++;
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
            set: {
              installationId,
              orgId: org.id,
              owner: r.owner.login,
              name: r.name,
              defaultBranch: sql`COALESCE(EXCLUDED.default_branch, ${repos.defaultBranch})`,
            },
          });
        synced++;
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return NextResponse.json({
    syncedFromInstallations: ids.length,
    reposReconciled: synced,
    errors,
  });
}
