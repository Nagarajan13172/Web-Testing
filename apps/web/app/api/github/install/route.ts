import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { installUrl } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await requireUser();
  redirect(installUrl(user.id));
}
