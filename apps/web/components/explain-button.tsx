"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Loader2, AlertTriangle, FileText, Bot } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface ExplainButtonProps {
  runId: string;
  testResultId: string;
  testName: string;
  testFile: string;
  failureMessage: string | null;
  cachedExplanation?: string | null;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "streaming"; text: string }
  | { kind: "done"; text: string; cached: boolean }
  | { kind: "error"; message: string };

export function ExplainButton(props: ExplainButtonProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>(
    props.cachedExplanation
      ? { kind: "done", text: props.cachedExplanation, cached: true }
      : { kind: "idle" },
  );

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    if (state.kind === "done" || state.kind === "streaming" || state.kind === "loading") return;

    runExplain();

    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function runExplain() {
    setState({ kind: "loading" });
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(`/api/runs/${props.runId}/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testResultId: props.testResultId }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `request failed: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("response body missing");

      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let cached = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nlnl;
        while ((nlnl = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, nlnl);
          buffer = buffer.slice(nlnl + 2);

          let eventName = "message";
          let dataLine = "";
          for (const line of raw.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
          }
          if (!dataLine) continue;

          if (eventName === "error") {
            try {
              const { message } = JSON.parse(dataLine);
              throw new Error(message);
            } catch {
              throw new Error(dataLine);
            }
          }
          if (eventName === "done") {
            try {
              const meta = JSON.parse(dataLine);
              cached = Boolean(meta.cached);
            } catch {
              /* noop */
            }
            continue;
          }
          // default "message" event
          try {
            const { delta } = JSON.parse(dataLine);
            if (typeof delta === "string") {
              text += delta;
              setState({ kind: "streaming", text });
            }
          } catch {
            /* skip malformed */
          }
        }
      }

      setState({ kind: "done", text, cached });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  const buttonHasCache = props.cachedExplanation != null;
  const isBusy = state.kind === "loading" || state.kind === "streaming";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
          buttonHasCache
            ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
            : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary",
        )}
      >
        <Sparkles className="h-3 w-3" strokeWidth={1.75} />
        {buttonHasCache ? "View explanation" : "Ask AI to explain"}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" strokeWidth={1.75} />
              AI failure explanation
            </SheetTitle>
            <SheetDescription className="font-mono text-xs">
              {props.testName}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-2 rounded-md border border-border bg-card/40 p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <FileText className="h-3 w-3" strokeWidth={1.75} />
              {props.testFile}
            </div>
            {props.failureMessage && (
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-destructive">
                {props.failureMessage}
              </pre>
            )}
          </div>

          <div className="mt-2 flex-1 overflow-y-auto">
            {state.kind === "idle" && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}

            {state.kind === "loading" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                Asking Claude…
              </div>
            )}

            {(state.kind === "streaming" || state.kind === "done") && (
              <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {state.text}
                {isBusy && <Caret />}
              </div>
            )}

            {state.kind === "error" && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <div>
                  <div className="font-semibold">Couldn&apos;t generate an explanation</div>
                  <div className="mt-1 font-mono">{state.message}</div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border/60 pt-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Gemini 2.5 Flash</span>
            {state.kind === "done" && (
              <span>{state.cached ? "Cached" : "Fresh result"}</span>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function Caret() {
  return <span className="ml-0.5 inline-block h-3.5 w-[1.5px] animate-pulse-dot bg-primary align-middle" />;
}
