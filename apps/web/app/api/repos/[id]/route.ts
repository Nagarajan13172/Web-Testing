import { NextResponse } from "next/server";
import { db, repos, eq, and } from "@webtesting/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PatchBody {
  targetDomain?: string | null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "invalid repo id" }, { status: 400 });
  }

  const { org } = await requireUser();
  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const update: { targetDomain?: string | null } = {};

  if (body.targetDomain !== undefined) {
    if (body.targetDomain === null || body.targetDomain.trim() === "") {
      update.targetDomain = null;
    } else {
      const trimmed = body.targetDomain.trim();
      if (!/^https?:\/\//i.test(trimmed)) {
        return NextResponse.json(
          { error: "targetDomain must start with http:// or https://" },
          { status: 400 },
        );
      }
      update.targetDomain = trimmed;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(repos)
    .set(update)
    .where(and(eq(repos.id, id), eq(repos.orgId, org.id)))
    .returning();

  if (!updated) return NextResponse.json({ error: "repo not found" }, { status: 404 });

  return NextResponse.json({ repo: updated });
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
