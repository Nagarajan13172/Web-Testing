import { NextResponse } from "next/server";
import { db, repos, testCases, eq, and } from "@webtesting/db";
import { requireUser } from "@/lib/auth";
import { installationOctokit } from "@/lib/github";
import { detectFramework } from "@/lib/framework-detect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "invalid repo id" }, { status: 400 });
  }

  const { org } = await requireUser();

  const [repo] = await db
    .select()
    .from(repos)
    .where(and(eq(repos.id, id), eq(repos.orgId, org.id)))
    .limit(1);
  if (!repo) return NextResponse.json({ error: "repo not found" }, { status: 404 });
  if (!repo.installationId) {
    return NextResponse.json(
      { error: "Install the GitHub App on this repo first." },
      { status: 400 },
    );
  }

  const octokit = installationOctokit(repo.installationId);
  let detection;
  try {
    detection = await detectFramework(octokit, repo.owner, repo.name);
  } catch (err) {
    return NextResponse.json(
      { error: `failed to detect: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  // Only persist runner kind for supported (React) frameworks. For everything
  // else, store the framework value so the UI can show what was detected, but
  // leave testRunnerKind null — generate/run-tests use that as a gate.
  const update: Partial<typeof repos.$inferInsert> = {
    framework: detection.framework,
    frameworkDetectedAt: new Date(),
  };
  if (detection.supported) {
    update.testRunnerKind = detection.testRunnerKind;
  } else {
    update.testRunnerKind = null;
  }

  // Wipe stale cases if we've moved from supported → unsupported (they no
  // longer make sense) or vice-versa.
  const wasSupported = repo.testRunnerKind != null;
  let clearedCount = 0;
  if (wasSupported !== detection.supported) {
    const deleted = await db
      .delete(testCases)
      .where(eq(testCases.repoId, repo.id))
      .returning({ id: testCases.id });
    clearedCount = deleted.length;
  }

  await db
    .update(repos)
    .set(update)
    .where(eq(repos.id, repo.id));

  return NextResponse.json({
    framework: detection.framework,
    supported: detection.supported,
    testRunnerKind: detection.supported ? detection.testRunnerKind : null,
    hint: detection.hint,
    packageManager: detection.packageManager,
    hasTypescript: detection.hasTypescript,
    clearedCases: clearedCount,
  });
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
