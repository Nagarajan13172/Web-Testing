import { NextResponse } from "next/server";
import { db, repos, testCases, eq, and, asc } from "@webtesting/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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

  const cases = await db
    .select({
      id: testCases.id,
      title: testCases.title,
      description: testCases.description,
      category: testCases.category,
      source: testCases.source,
      status: testCases.status,
      lastRunAt: testCases.lastRunAt,
      lastDurationMs: testCases.lastDurationMs,
      lastFailureMessage: testCases.lastFailureMessage,
      playwrightCode: testCases.playwrightCode,
      lastRunOutput: testCases.lastRunOutput,
      targetRoute: testCases.targetRoute,
      expectedResult: testCases.expectedResult,
    })
    .from(testCases)
    .where(eq(testCases.repoId, repo.id))
    .orderBy(asc(testCases.generatedAt));

  const totals = cases.reduce(
    (acc, c) => {
      acc.total++;
      if (c.status === "passed") acc.passed++;
      else if (c.status === "failed") acc.failed++;
      else if (c.status === "running") acc.running++;
      else acc.pending++;
      return acc;
    },
    { total: 0, passed: 0, failed: 0, running: 0, pending: 0 },
  );

  return NextResponse.json({
    targetDomain: repo.targetDomain,
    framework: repo.framework,
    testRunnerKind: repo.testRunnerKind,
    cases,
    totals,
  });
}

interface CreateCaseBody {
  title?: string;
  description?: string;
  category?: string;
  code?: string;
  targetRoute?: string | null;
  expectedResult?: string | null;
}

/**
 * Create a hand-written test case.
 *
 * Unlike generated cases this is stored verbatim — no sanitizer rewrites, and
 * the runner will not send it to the repair pass. What the user wrote is what
 * runs, and what they see afterwards.
 */
export async function POST(
  req: Request,
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

  const body = (await req.json().catch(() => null)) as CreateCaseBody | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const title = body.title?.trim();
  const code = body.code;
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!code || !code.trim()) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const [created] = await db
    .insert(testCases)
    .values({
      repoId: repo.id,
      title,
      description: body.description?.trim() ?? "",
      category: body.category?.trim() || "component",
      source: "manual",
      status: "pending",
      playwrightCode: code,
      targetRoute: body.targetRoute?.trim() || null,
      expectedResult: body.expectedResult?.trim() || null,
    })
    .returning();

  return NextResponse.json({ case: created }, { status: 201 });
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
