"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";

type Connectivity = "idle" | "connecting" | "live" | "reconnecting";

export function LiveRun({ runId, terminal }: { runId: string; terminal: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<Connectivity>(terminal ? "idle" : "connecting");

  useEffect(() => {
    if (terminal) {
      setState("idle");
      return;
    }

    setState("connecting");
    const es = new EventSource(`/api/runs/${runId}/events`);

    es.addEventListener("open", () => setState("live"));

    es.addEventListener("message", () => {
      // We don't need the payload — refresh the server tree, which re-queries
      // Postgres and re-renders the page with the latest run/step/tests data.
      router.refresh();
    });

    es.addEventListener("error", () => {
      // The browser auto-reconnects EventSource. Just reflect the state.
      setState("reconnecting");
    });

    return () => {
      es.close();
    };
  }, [runId, terminal, router]);

  return <LiveBadge state={state} />;
}

function LiveBadge({ state }: { state: Connectivity }) {
  if (state === "idle") return null;

  const label =
    state === "live"
      ? "Live"
      : state === "connecting"
        ? "Connecting…"
        : "Reconnecting…";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        state === "live"
          ? "border-success/30 bg-success/10 text-success"
          : "border-border bg-muted/30 text-muted-foreground",
      )}
      aria-live="polite"
    >
      <Radio
        className={cn("h-3 w-3", state === "live" && "animate-pulse-dot")}
        strokeWidth={1.75}
      />
      {label}
    </span>
  );
}
