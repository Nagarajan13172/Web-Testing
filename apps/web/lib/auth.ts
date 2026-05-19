import { auth, currentUser } from "@clerk/nextjs/server";
import { db, users, orgs, eq, type User } from "@webtesting/db";

export interface RequireUserResult {
  user: User;
  org: { id: string; name: string; ownerId: string };
}

/**
 * Resolves the signed-in Clerk user to a row in our `users` table,
 * creating it (and a personal org) on first sight. Middleware guarantees
 * the route is authenticated, so a missing userId here is a programming
 * error.
 */
export async function requireUser(): Promise<RequireUserResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("requireUser called on a public route");

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);

  let user: User;
  if (existing[0]) {
    user = existing[0];
  } else {
    const cu = await currentUser();
    const email = cu?.emailAddresses[0]?.emailAddress ?? `${userId}@local`;
    const [created] = await db.insert(users).values({ clerkId: userId, email }).returning();
    if (!created) throw new Error("failed to create user row");
    user = created;
  }

  const orgExisting = await db
    .select()
    .from(orgs)
    .where(eq(orgs.ownerId, user.id))
    .limit(1);

  if (orgExisting[0]) return { user, org: orgExisting[0] };

  const [createdOrg] = await db.insert(orgs).values({ name: "personal", ownerId: user.id }).returning();
  if (!createdOrg) throw new Error("failed to create org row");
  return { user, org: createdOrg };
}
