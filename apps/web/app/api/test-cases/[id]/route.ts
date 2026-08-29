import { NextResponse } from "next/server";
import { db, testCases, repos, eq, and } from "@webtesting/db";
import { requireUser } from "@/lib/auth";
import { validateSpec } from "@/lib/validate-spec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PatchBody {
  title?: string;
  description?: string;
  targetRoute?: string | null;
  expectedResult?: string | null;
  category?: string;
  playwrightCode?: string;
  /** Only "manual" is accepted — see the handler. */
  source?: "manual";
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
    const syntax = await validateSpec(body.playwrightCode);
    if (!syntax.ok) {
      return NextResponse.json(
        { error: `spec does not parse — ${syntax.message}` },
        { status: 400 },
      );
    }
    update.playwrightCode = body.playwrightCode;
  }

  // Adopting a generated case marks it as yours: from then on it is never
  // rewritten by the sanitizers, never sent to the repair pass, and never
  // deleted by Regenerate. Only ai -> manual is allowed; the reverse would
  // quietly re-expose hand-written work to all three.
  if (body.source === "manual") {
    update.source = "manual";
  } else if (body.source !== undefined) {
    return NextResponse.json(
      { error: "source can only be changed to \"manual\"" },
      { status: 400 },
    );
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  // Changing what a case asserts invalidates its last result, so reset it to
  // pending and drop the stale failure. Adopting a case changes only who owns
  // it — the spec and its result are untouched, so a passing case must not be
  // knocked back to pending for it.
  const requirementsChanged = Object.keys(update).some((k) => k !== "source");
  if (requirementsChanged) {
    update.status = "pending";
    update.lastFailureMessage = null;
    update.lastFailureStack = null;
  }

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
