import { NextResponse } from "next/server";
import { db, testCases, repos, eq, and } from "@webtesting/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PatchBody {
  title?: string;
  description?: string;
  targetRoute?: string | null;
  expectedResult?: string | null;
  category?: string;
  playwrightCode?: string;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const { org } = await requireUser();
  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // Authorize via the repo->org chain.
  const [row] = await db
    .select({ caseId: testCases.id })
    .from(testCases)
    .innerJoin(repos, eq(testCases.repoId, repos.id))
    .where(and(eq(testCases.id, id), eq(repos.orgId, org.id)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "test case not found" }, { status: 404 });

  const update: Partial<typeof testCases.$inferInsert> = {};
  if (typeof body.title === "string" && body.title.trim()) update.title = body.title.trim();
  if (typeof body.description === "string") update.description = body.description.trim();
  if (typeof body.category === "string" && body.category.trim()) update.category = body.category.trim();
  if (body.targetRoute !== undefined) {
    update.targetRoute = body.targetRoute === null ? null : String(body.targetRoute).trim() || null;
  }
  if (body.expectedResult !== undefined) {
    update.expectedResult = body.expectedResult === null ? null : String(body.expectedResult).trim() || null;
  }
  if (typeof body.playwrightCode === "string" && body.playwrightCode.trim()) {
    update.playwrightCode = body.playwrightCode;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  // The reference platform mentions clearing pre-generated scripts when
  // requirements change. We reset status to "pending" so the user knows the
  // case needs re-running (and the stale failure context disappears).
  update.status = "pending";
  update.lastFailureMessage = null;
  update.lastFailureStack = null;

  const [updated] = await db
    .update(testCases)
    .set(update)
    .where(eq(testCases.id, id))
    .returning();

  return NextResponse.json({ case: updated });
}

/** Remove a single test case. Generated cases are also removable — regenerating
 *  replaces them anyway, and a case nobody wants shouldn't be un-deletable. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const { org } = await requireUser();

  // Authorize via the repo->org chain before touching anything.
  const [row] = await db
    .select({ caseId: testCases.id })
    .from(testCases)
    .innerJoin(repos, eq(testCases.repoId, repos.id))
    .where(and(eq(testCases.id, id), eq(repos.orgId, org.id)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "test case not found" }, { status: 404 });

  await db.delete(testCases).where(eq(testCases.id, id));
  return NextResponse.json({ deleted: id });
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
