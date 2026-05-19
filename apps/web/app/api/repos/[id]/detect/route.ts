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

  // If the runner kind is changing, existing test cases are written for the
  // wrong framework (Vitest can't run Playwright code and vice-versa).
  // Wipe them so the UI's empty-state forces a fresh Generate.
  const runnerChanged =
    repo.testRunnerKind != null && repo.testRunnerKind !== detection.testRunnerKind;
  let clearedCount = 0;
  if (runnerChanged) {
    const deleted = await db
      .delete(testCases)
      .where(eq(testCases.repoId, repo.id))
      .returning({ id: testCases.id });
    clearedCount = deleted.length;
  }

  await db
    .update(repos)
    .set({
      framework: detection.framework,
      testRunnerKind: detection.testRunnerKind,
      frameworkDetectedAt: new Date(),
    })
    .where(eq(repos.id, repo.id));

  return NextResponse.json({
    framework: detection.framework,
    testRunnerKind: detection.testRunnerKind,
    hint: detection.hint,
    packageManager: detection.packageManager,
    hasTypescript: detection.hasTypescript,
    clearedCases: clearedCount,
    runnerChanged,
  });
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
