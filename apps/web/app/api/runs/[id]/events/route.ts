import { Redis } from "ioredis";
import { requireUser, runBelongsToOrg } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return new Response("invalid run id", { status: 400 });
  }

  // Being signed in isn't enough — this streams another org's run otherwise.
  const { org } = await requireUser();
  if (!(await runBelongsToOrg(id, org.id))) {
    return new Response("not found", { status: 404 });
  }

  const channel = `run-events:${id}`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // A fresh Redis client per connection so the subscriber blocking
      // mode doesn't poison the shared connection pool.
      const sub = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

      let closed = false;
      const safeSend = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          /* controller already closed */
        }
      };

      sub.on("message", (_ch, payload) => safeSend(`data: ${payload}\n\n`));
      sub.on("error", (err) => safeSend(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`));

      await sub.subscribe(channel);

      // Initial hello so the client's `onopen` fires deterministically.
      safeSend(`: connected\n\n`);

      // SSE heartbeat — keeps proxies and idle TCP from killing the stream.
      const heartbeat = setInterval(() => safeSend(`: hb\n\n`), 15_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        sub.disconnect();
        try { controller.close(); } catch { /* noop */ }
      };

      req.signal.addEventListener("abort", cleanup);
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

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
