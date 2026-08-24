import { NextResponse } from "next/server";
import {
  db,
  testResults,
  runs,
  repos,
  aiArtifacts,
  eq,
  and,
} from "@webtesting/db";
import { streamExplainFailure, EXPLAIN_FAILURE_MODEL } from "@webtesting/ai";
import { requireUser, runBelongsToOrg } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExplainBody {
  testResultId: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: runId } = await params;
  if (!isUuid(runId)) return NextResponse.json({ error: "invalid run id" }, { status: 400 });

  // Without this, any signed-in user can explain any run's failures — leaking
  // test names and stack traces, and spending our model quota doing it.
  const { org } = await requireUser();
  if (!(await runBelongsToOrg(runId, org.id))) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as ExplainBody | null;
  if (!body?.testResultId || !isUuid(body.testResultId)) {
    return NextResponse.json({ error: "testResultId is required" }, { status: 400 });
  }

  const [tr] = await db
    .select()
    .from(testResults)
    .where(eq(testResults.id, body.testResultId))
    .limit(1);
  if (!tr) return NextResponse.json({ error: "test result not found" }, { status: 404 });
  if (tr.runId !== runId) {
    return NextResponse.json({ error: "test result does not belong to this run" }, { status: 400 });
  }
  if (tr.status !== "failed") {
    return NextResponse.json({ error: "test did not fail" }, { status: 400 });
  }

  const [cached] = await db
    .select()
    .from(aiArtifacts)
    .where(
      and(
        eq(aiArtifacts.runId, runId),
        eq(aiArtifacts.kind, "explanation"),
        eq(aiArtifacts.relatedTestId, tr.id),
      ),
    )
    .limit(1);

  const encoder = new TextEncoder();

  if (cached?.content && isExplanationContent(cached.content)) {
    const cachedText = cached.content.text;
    return sseResponse((controller) => {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ delta: cachedText })}\n\n`),
      );
      controller.enqueue(
        encoder.encode(`event: done\ndata: ${JSON.stringify({ cached: true })}\n\n`),
      );
      controller.close();
    });
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not set on the server" },
      { status: 503 },
    );
  }

  const [repoRow] = await db
    .select({ owner: repos.owner, name: repos.name })
    .from(runs)
    .leftJoin(repos, eq(runs.repoId, repos.id))
    .where(eq(runs.id, runId))
    .limit(1);

  const repoFullName =
    repoRow?.owner && repoRow?.name ? `${repoRow.owner}/${repoRow.name}` : null;

  const stream = new ReadableStream({
    async start(controller) {
      let collected = "";
      let aborted = false;

      const safeSend = (data: string) => {
        if (aborted) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          /* client gone */
        }
      };

      const cleanup = () => {
        aborted = true;
        try { controller.close(); } catch { /* noop */ }
      };
      req.signal.addEventListener("abort", cleanup);

      try {
        for await (const chunk of streamExplainFailure({
          testName: tr.name,
          testFile: tr.file,
          failureMessage: tr.failureMessage,
          failureStack: tr.failureStack,
          repoFullName,
        })) {
          collected += chunk;
          safeSend(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
        }

        if (!aborted && collected.trim()) {
          await db.insert(aiArtifacts).values({
            runId,
            kind: "explanation",
            relatedTestId: tr.id,
            content: { text: collected, model: EXPLAIN_FAILURE_MODEL },
          });
        }

        safeSend(`event: done\ndata: ${JSON.stringify({ cached: false })}\n\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        safeSend(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
      } finally {
        cleanup();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function sseResponse(starter: (controller: ReadableStreamDefaultController) => void) {
  return new Response(
    new ReadableStream({
      start: starter,
    }),
    {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    },
  );
}

function isExplanationContent(c: unknown): c is { text: string; model?: string } {
  return (
    !!c && typeof c === "object" && "text" in c && typeof (c as { text: unknown }).text === "string"
  );
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
