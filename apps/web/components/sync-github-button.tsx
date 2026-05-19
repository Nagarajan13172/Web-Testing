"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

type State =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "done"; reposReconciled: number; installations: number }
  | { kind: "error"; message: string };

export function SyncGitHubButton({ className }: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });

  async function run() {
    setState({ kind: "syncing" });
    try {
      const res = await fetch("/api/github/sync", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `request failed: ${res.status}`);
      setState({
        kind: "done",
        reposReconciled: json.reposReconciled ?? 0,
        installations: json.syncedFromInstallations ?? 0,
      });
      router.refresh();
      setTimeout(() => setState({ kind: "idle" }), 4000);
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "unknown error",
      });
      setTimeout(() => setState({ kind: "idle" }), 6000);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={state.kind === "syncing"}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60",
          className,
        )}
        title="Re-sync the list of repos from your GitHub App installation"
      >
        {state.kind === "syncing" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
        Sync from GitHub
      </button>

      {state.kind === "done" && (
        <span className="inline-flex items-center gap-1 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          {state.reposReconciled} repo{state.reposReconciled === 1 ? "" : "s"} synced
        </span>
      )}
      {state.kind === "error" && (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />
          {state.message}
        </span>
      )}
    </div>
  );
}
