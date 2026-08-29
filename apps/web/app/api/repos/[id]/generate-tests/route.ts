import { NextResponse } from "next/server";
import { db, repos, testCases, eq, and } from "@webtesting/db";
import { generateTests } from "@webtesting/ai";
import { requireUser } from "@/lib/auth";
import { installationOctokit } from "@/lib/github";
import { snapshotRepo } from "@/lib/github-pr";
import { detectFramework, isSupportedFramework } from "@/lib/framework-detect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
      { error: "Install the GitHub App on this repo before generating tests." },
      { status: 400 },
    );
  }
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY is not set" }, { status: 503 });
  }

  const octokit = installationOctokit(repo.installationId);

  // Detect framework if not already cached. The platform only supports React
  // projects right now — reject anything else with a clear message.
  let framework = repo.framework;
  let hint: string | null = null;
  if (!framework || !repo.testRunnerKind) {
    try {
      const detected = await detectFramework(octokit, repo.owner, repo.name);
      framework = detected.framework;
      hint = detected.hint;
      await db
        .update(repos)
        .set({
          framework,
          testRunnerKind: detected.supported ? "vitest" : null,
          frameworkDetectedAt: new Date(),
        })
        .where(eq(repos.id, repo.id));
    } catch (err) {
      return NextResponse.json(
        { error: `failed to detect framework: ${errMsg(err)}` },
        { status: 502 },
      );
    }
  }

  if (!framework || !isSupportedFramework(framework as never)) {
    return NextResponse.json(
      {
        error: "Only React projects are supported right now.",
        framework,
        hint: hint ?? "Detected a non-React project.",
      },
      { status: 400 },
    );
  }

  let snapshot;
  try {
    snapshot = await snapshotRepo(octokit, repo.owner, repo.name);
  } catch (err) {
    return NextResponse.json(
      { error: `failed to read repo: ${errMsg(err)}` },
      { status: 502 },
    );
  }

  let generated;
  try {
    generated = await generateTests({
      repoFullName: `${repo.owner}/${repo.name}`,
      runnerKind: "vitest",
      framework,
      fileTree: snapshot.fileTree,
      files: snapshot.files,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `AI generation failed: ${errMsg(err)}` },
      { status: 502 },
    );
  }

  if (generated.testCases.length === 0) {
    return NextResponse.json({ error: "AI returned no test cases" }, { status: 502 });
  }

  // Replace prior GENERATED cases for this repo with the new set. Manually
  // written cases are the user's work and must survive a regenerate.
  await db.transaction(async (tx) => {
    await tx
      .delete(testCases)
      .where(and(eq(testCases.repoId, repo.id), eq(testCases.source, "ai")));
    await tx.insert(testCases).values(
      generated.testCases.map((tc) => ({
        repoId: repo.id,
        title: tc.title,
        description: tc.description,
        category: tc.category,
        playwrightCode: tc.code,
        status: "pending" as const,
      })),
    );
  });

  return NextResponse.json({
    framework: generated.framework,
    baseURL: generated.baseURL,
    plan: generated.plan,
    count: generated.testCases.length,
    usage: generated.usage,
  });
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
