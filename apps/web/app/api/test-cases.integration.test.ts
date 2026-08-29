import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db, repos, testCases, orgs, users, eq, and } from "@webtesting/db";

/**
 * Clerk can't be driven headlessly, so requireUser is stubbed to resolve to a
 * throwaway org created below. Everything else — routing, validation, the SQL
 * these handlers run — is exercised for real.
 */
const ctx: { orgId: string; otherOrgId: string; repoId: string; otherRepoId: string } = {
  orgId: "", otherOrgId: "", repoId: "", otherRepoId: "",
};

vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({
    user: { id: "test-user" },
    org: { id: ctx.orgId, name: "test", ownerId: "test-user" },
  }),
}));

const { POST, GET } = await import("./repos/[id]/test-cases/route");
const { DELETE, PATCH } = await import("./test-cases/[id]/route");

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

let userId = "";

beforeAll(async () => {
  const [u] = await db.insert(users)
    .values({ clerkId: `test_${Date.now()}`, email: "t@example.com" }).returning();
  userId = u!.id;
  const [o1] = await db.insert(orgs).values({ name: "mine", ownerId: userId }).returning();
  const [o2] = await db.insert(orgs).values({ name: "theirs", ownerId: userId }).returning();
  ctx.orgId = o1!.id;
  ctx.otherOrgId = o2!.id;

  const [r1] = await db.insert(repos).values({
    orgId: ctx.orgId, githubId: -1000001, owner: "t", name: "mine", defaultBranch: "main",
  }).returning();
  const [r2] = await db.insert(repos).values({
    orgId: ctx.otherOrgId, githubId: -1000002, owner: "t", name: "theirs", defaultBranch: "main",
  }).returning();
  ctx.repoId = r1!.id;
  ctx.otherRepoId = r2!.id;
});

afterAll(async () => {
  await db.delete(repos).where(eq(repos.orgId, ctx.orgId));
  await db.delete(repos).where(eq(repos.orgId, ctx.otherOrgId));
  await db.delete(orgs).where(eq(orgs.ownerId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

const SPEC = `import { it, expect } from "vitest";\nit("works", () => expect(1).toBe(1));\n`;

describe("POST /api/repos/[id]/test-cases", () => {
  it("creates a case marked manual and returns 201", async () => {
    const res = await POST(post({ title: "My case", description: "d", code: SPEC }), params(ctx.repoId));
    expect(res.status).toBe(201);
    const { case: created } = await res.json();
    expect(created.source).toBe("manual");
    expect(created.status).toBe("pending");
    // Stored verbatim — this is the whole contract of a hand-written case.
    expect(created.playwrightCode).toBe(SPEC);
  });

  it("stores the code exactly, including patterns the sanitizer rewrites for AI cases", async () => {
    const wrongDepth = `import Foo from "../src/Foo";\n`;
    const res = await POST(post({ title: "verbatim", code: wrongDepth }), params(ctx.repoId));
    expect(res.status).toBe(201);
    const [row] = await db.select().from(testCases).where(eq(testCases.id, (await res.json()).case.id));
    expect(row!.playwrightCode).toBe(wrongDepth);
  });

  it("rejects a missing title and a missing body of code", async () => {
    expect((await POST(post({ code: SPEC }), params(ctx.repoId))).status).toBe(400);
    expect((await POST(post({ title: "no code" }), params(ctx.repoId))).status).toBe(400);
    expect((await POST(post({ title: "blank", code: "   " }), params(ctx.repoId))).status).toBe(400);
  });

  it("refuses a repo belonging to another org", async () => {
    const res = await POST(post({ title: "x", code: SPEC }), params(ctx.otherRepoId));
    expect(res.status).toBe(404);
  });

  it("rejects a malformed repo id", async () => {
    expect((await POST(post({ title: "x", code: SPEC }), params("not-a-uuid"))).status).toBe(400);
  });
});

describe("GET /api/repos/[id]/test-cases", () => {
  it("returns source so the UI can tell hand-written cases apart", async () => {
    const res = await GET(new Request("http://localhost/x"), params(ctx.repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cases.length).toBeGreaterThan(0);
    expect(body.cases.every((c: { source: string }) => c.source === "manual")).toBe(true);
  });
});

describe("DELETE /api/test-cases/[id]", () => {
  it("removes the caller's own case", async () => {
    const created = (await (await POST(post({ title: "doomed", code: SPEC }), params(ctx.repoId))).json()).case;
    const res = await DELETE(new Request("http://localhost/x"), params(created.id));
    expect(res.status).toBe(200);
    const rows = await db.select().from(testCases).where(eq(testCases.id, created.id));
    expect(rows).toHaveLength(0);
  });

  it("refuses a case owned by another org, and leaves it in place", async () => {
    const [foreign] = await db.insert(testCases).values({
      repoId: ctx.otherRepoId, title: "theirs", description: "", category: "component",
      source: "manual", playwrightCode: SPEC,
    }).returning();
    const res = await DELETE(new Request("http://localhost/x"), params(foreign!.id));
    expect(res.status).toBe(404);
    const still = await db.select().from(testCases).where(eq(testCases.id, foreign!.id));
    expect(still).toHaveLength(1);
  });
});

describe("PATCH /api/test-cases/[id]", () => {
  it("edits a manual case without changing its source", async () => {
    const created = (await (await POST(post({ title: "before", code: SPEC }), params(ctx.repoId))).json()).case;
    const res = await PATCH(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "after" }),
      }),
      params(created.id),
    );
    expect(res.status).toBe(200);
    const [row] = await db.select().from(testCases).where(eq(testCases.id, created.id));
    expect(row!.title).toBe("after");
    expect(row!.source).toBe("manual");
  });
});

describe("regeneration scoping", () => {
  it("deletes generated cases and preserves hand-written ones", async () => {
    await db.insert(testCases).values([
      { repoId: ctx.repoId, title: "gen", description: "", category: "component",
        source: "ai", playwrightCode: SPEC },
    ]);
    const before = await db.select().from(testCases).where(eq(testCases.repoId, ctx.repoId));
    expect(before.some((c) => c.source === "ai")).toBe(true);

    // The predicate generate-tests and detect use.
    await db.delete(testCases)
      .where(and(eq(testCases.repoId, ctx.repoId), eq(testCases.source, "ai")));

    const after = await db.select().from(testCases).where(eq(testCases.repoId, ctx.repoId));
    expect(after.filter((c) => c.source === "ai")).toHaveLength(0);
    expect(after.filter((c) => c.source === "manual").length).toBeGreaterThan(0);
  });
});
