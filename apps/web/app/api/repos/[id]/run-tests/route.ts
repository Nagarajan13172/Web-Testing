import { NextResponse } from "next/server";
import { db, repos, testCases, eq, and, inArray } from "@webtesting/db";
import { requireUser } from "@/lib/auth";
import { runsQueue } from "@/lib/queue";

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

  const runnerKind = (repo.testRunnerKind as "vitest" | "playwright" | null) ?? "playwright";

  if (runnerKind === "playwright" && !repo.targetDomain) {
    return NextResponse.json(
      { error: "Set a Target Domain on this repo before running Playwright tests." },
      { status: 400 },
    );
  }

  const cases = await db
    .select({ id: testCases.id, playwrightCode: testCases.playwrightCode })
    .from(testCases)
    .where(and(eq(testCases.repoId, repo.id), inArray(testCases.id, body.testCaseIds)));

  if (cases.length === 0) {
    return NextResponse.json({ error: "no matching test cases for this repo" }, { status: 400 });
  }

  // Guard against the cross-framework mismatch: code that imports Playwright
  // when we're going to run Vitest (or vice versa) will fail in confusing ways
  // inside the container. Fail loudly here so the user is told to regenerate.
  const mismatch = cases.find((c) => isMismatched(c.playwrightCode, runnerKind));
  if (mismatch) {
    return NextResponse.json(
      {
        error:
          runnerKind === "vitest"
            ? "These test cases were generated for Playwright. Click Regenerate to produce Vitest tests."
            : "These test cases were generated for Vitest. Click Regenerate to produce Playwright tests.",
      },
      { status: 409 },
    );
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
      targetDomain: repo.targetDomain,
    },
    { removeOnComplete: 1000, removeOnFail: 1000, attempts: 1 },
  );

  return NextResponse.json({ enqueued: validIds.length, runnerKind });
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function isMismatched(code: string, runnerKind: "vitest" | "playwright"): boolean {
  if (runnerKind === "vitest") {
    return /@playwright\/test/.test(code) && !/from\s+["']vitest["']/.test(code);
  }
  // playwright runner: refuse code that's clearly a vitest spec.
  return /from\s+["']vitest["']/.test(code) && !/@playwright\/test/.test(code);
}
