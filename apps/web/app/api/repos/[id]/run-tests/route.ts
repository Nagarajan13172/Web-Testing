import { NextResponse } from "next/server";
import { db, repos, testCases, eq, and, inArray } from "@webtesting/db";
import { requireUser } from "@/lib/auth";
import { runsQueue } from "@/lib/queue";
import { isSupportedFramework } from "@/lib/framework-detect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RunTestsBody {
  testCaseIds?: string[];
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "invalid repo id" }, { status: 400 });
  }

  const { org } = await requireUser();
  const body = (await req.json().catch(() => null)) as RunTestsBody | null;

  if (!body?.testCaseIds || body.testCaseIds.length === 0) {
    return NextResponse.json({ error: "testCaseIds is required" }, { status: 400 });
  }
  if (!body.testCaseIds.every(isUuid)) {
    return NextResponse.json({ error: "invalid testCaseIds" }, { status: 400 });
  }

  const [repo] = await db
    .select()
    .from(repos)
    .where(and(eq(repos.id, id), eq(repos.orgId, org.id)))
    .limit(1);
  if (!repo) return NextResponse.json({ error: "repo not found" }, { status: 404 });

  const runnerKind = repo.testRunnerKind === "playwright" ? "playwright" : "vitest";

  // Vitest mounts the repo's own components, so the stack has to be one we can
  // build. Playwright only drives a URL over HTTP — the app could be written in
  // anything — so the framework gate doesn't apply to it.
  if (runnerKind === "vitest" && (!repo.framework || !isSupportedFramework(repo.framework as never))) {
    return NextResponse.json(
      {
        error: "Only React projects are supported for component tests. Switch this repo to end-to-end tests to run against a deployed URL.",
        framework: repo.framework,
      },
      { status: 400 },
    );
  }

  if (runnerKind === "playwright" && !repo.targetDomain) {
    return NextResponse.json(
      { error: "Set the deployed URL for this repo before running end-to-end tests." },
      { status: 400 },
    );
  }

  const cases = await db
    .select({ id: testCases.id })
    .from(testCases)
    .where(and(eq(testCases.repoId, repo.id), inArray(testCases.id, body.testCaseIds)));

  if (cases.length === 0) {
    return NextResponse.json({ error: "no matching test cases for this repo" }, { status: 400 });
  }

  const validIds = cases.map((c) => c.id);

  await db
    .update(testCases)
    .set({ status: "running" })
    .where(inArray(testCases.id, validIds));

  await runsQueue.add(
    "test-cases",
    {
      kind: "test-cases",
      repoId: repo.id,
      testCaseIds: validIds,
      runnerKind,
    },
    { removeOnComplete: 1000, removeOnFail: 1000, attempts: 1 },
  );

  return NextResponse.json({ enqueued: validIds.length, runnerKind });
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
