"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
  Code2,
  RefreshCw,
  AlertTriangle,
  PlayCircle,
  Play,
  Link as LinkIcon,
} from "lucide-react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
} from "@/components/ui/modal";
import { cn } from "@/lib/utils";

export interface ExecutionCase {
  id: string;
  title: string;
  description: string;
  category: string;
  status: "pending" | "running" | "passed" | "failed";
  playwrightCode?: string;
  lastFailureMessage?: string | null;
  lastRunOutput?: string | null;
  lastDurationMs?: number | null;
}

interface Payload {
  targetDomain: string | null;
  cases: ExecutionCase[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  repoId: string;
  repoFullName: string;
  caseIds: string[];
  initialTargetDomain: string | null;
}

export function TestExecutionModal({
  open,
  onClose,
  repoId,
  repoFullName,
  caseIds,
  initialTargetDomain,
}: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset to preview state every time the modal opens.
  useEffect(() => {
    if (!open) {
      setStarted(false);
      setStarting(false);
      setStartError(null);
      setPolling(false);
    }
  }, [open]);

  // Initial fetch on open so we have code + status to preview before Start.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/repos/${repoId}/test-cases`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { cases: ExecutionCase[]; targetDomain: string | null };
        if (cancelled) return;
        const filtered = json.cases.filter((c) => caseIds.includes(c.id));
        setData({ cases: filtered, targetDomain: json.targetDomain });
        if (!selectedId && filtered[0]) setSelectedId(filtered[0].id);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, repoId, caseIds.join(",")]);

  // Polling starts only once execution has been kicked off.
  useEffect(() => {
    if (!open || !started) return;
    let cancelled = false;
    async function refresh() {
      try {
        const res = await fetch(`/api/repos/${repoId}/test-cases`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { cases: ExecutionCase[]; targetDomain: string | null };
        if (cancelled) return;
        const filtered = json.cases.filter((c) => caseIds.includes(c.id));
        setData({ cases: filtered, targetDomain: json.targetDomain });
      } catch {
        /* ignore */
      }
    }
    setPolling(true);
    pollRef.current = setInterval(refresh, 2500);
    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, started, repoId, caseIds.join(",")]);

  async function startExecution() {
    setStartError(null);
    setStarting(true);
    try {
      const res = await fetch(`/api/repos/${repoId}/run-tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testCaseIds: caseIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `request failed: ${res.status}`);
      setStarted(true);
      // Flip local cases to "running" so the user sees immediate feedback before the next poll.
      setData((d) =>
        d
          ? {
              ...d,
              cases: d.cases.map((c) => ({ ...c, status: "running" as const })),
            }
          : d,
      );
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setStarting(false);
    }
  }

  // Stop polling once nothing is actively running.
  useEffect(() => {
    if (!data) return;
    const anyRunning = data.cases.some((c) => c.status === "running");
    if (!anyRunning && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      setPolling(false);
    }
  }, [data]);

  const selectedCase = useMemo(
    () => data?.cases.find((c) => c.id === selectedId) ?? null,
    [data, selectedId],
  );

  const targetDomain = data?.targetDomain ?? initialTargetDomain;

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}>
      <ModalContent className="max-h-[90vh] overflow-hidden">
        <ModalHeader>
          <ModalTitle className="flex items-center gap-2">
            <PlayCircle className="h-4 w-4 text-primary" strokeWidth={1.75} />
            Cloud test runner
          </ModalTitle>
          <ModalDescription>
            Running automation scripts in an isolated Playwright container against{" "}
            <span className="font-mono text-foreground">{repoFullName}</span>.
          </ModalDescription>
        </ModalHeader>

        {/* Target URL row */}
        <div className="rounded-md border border-border bg-card/40 px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
            <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
              Target
            </span>
            <span className="font-mono text-foreground">{targetDomain ?? "—"}</span>
            {polling && (
              <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-primary">
                <RefreshCw className="h-3 w-3 animate-spin" strokeWidth={1.75} />
                Polling…
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr] overflow-hidden">
          {/* Execution queue */}
          <div className="overflow-y-auto rounded-md border border-border bg-card/40 max-h-[60vh]">
            <div className="border-b border-border bg-muted/30 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Execution queue
            </div>
            {!data ? (
              <QueueSkeleton count={caseIds.length} />
            ) : (
              <ul className="divide-y divide-border/60">
                {data.cases.map((c) => (
                  <li
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(c.id)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelectedId(c.id)}
                    className={cn(
                      "cursor-pointer px-3 py-2.5 transition-colors hover:bg-muted/20",
                      selectedId === c.id && "bg-primary/5",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-foreground">
                          {c.title}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <CategoryBadge category={c.category} />
                          <StatusBadge status={c.status} />
                        </div>
                      </div>
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 text-muted-foreground/60",
                          selectedId === c.id && "text-foreground",
                        )}
                        strokeWidth={1.75}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Detail panel */}
          <div className="overflow-y-auto max-h-[60vh] pr-1">
            {!selectedCase ? (
              <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border bg-card/30 px-6 py-12 text-center text-xs text-muted-foreground">
                Select a test case from the queue.
              </div>
            ) : (
              <CaseDetail c={selectedCase} />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
          <div className="flex flex-col gap-1">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {!started ? (
                <span>
                  Ready to execute · <span className="text-foreground">{caseIds.length}</span> test
                  case{caseIds.length === 1 ? "" : "s"} queued
                </span>
              ) : data ? (
                <>
                  {data.cases.filter((c) => c.status === "passed").length} passed ·{" "}
                  {data.cases.filter((c) => c.status === "failed").length} failed ·{" "}
                  {data.cases.filter((c) => c.status === "running").length} running
                </>
              ) : null}
            </div>
            {startError && (
              <div className="font-mono text-[11px] text-destructive">{startError}</div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
            >
              {started ? "Close & refresh status" : "Cancel"}
            </button>
            {!started && (
              <button
                type="button"
                onClick={startExecution}
                disabled={starting || !data || data.cases.length === 0}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {starting ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                ) : (
                  <Play className="h-4 w-4" strokeWidth={1.75} />
                )}
                Start execution
              </button>
            )}
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}

function CaseDetail({ c }: { c: ExecutionCase }) {
  const failed = c.status === "failed";
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{c.title}</h3>
          <StatusBadge status={c.status} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>
        <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <CategoryBadge category={c.category} />
          {c.lastDurationMs != null && (
            <span className="rounded-md bg-muted/40 px-1.5 py-0.5">{c.lastDurationMs}ms</span>
          )}
        </div>
      </div>

      {failed && c.lastFailureMessage && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
            Failure
          </div>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-destructive">
            {c.lastFailureMessage}
          </pre>
        </div>
      )}

      <Section title="Generated Playwright code" Icon={Code2}>
        <CodeBlock>
          {c.playwrightCode?.trim() || "// no code available"}
        </CodeBlock>
      </Section>

      <Section title="Console output" Icon={Terminal}>
        {c.status === "running" ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" strokeWidth={1.75} />
            Container running… output will appear when the run finishes.
          </div>
        ) : c.lastRunOutput ? (
          <CodeBlock>{c.lastRunOutput.slice(-4000)}</CodeBlock>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-card/30 px-3 py-3 text-xs text-muted-foreground">
            No output captured yet. Run this test case to see Playwright&apos;s output here.
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  Icon,
  children,
}: {
  title: string;
  Icon: typeof Code2;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" strokeWidth={1.75} />
        {title}
      </div>
      {children}
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-md border border-border bg-[#0c0c10] p-3 font-mono text-[11px] leading-relaxed text-emerald-200">
      <code>{children}</code>
    </pre>
  );
}

function QueueSkeleton({ count }: { count: number }) {
  return (
    <ul className="divide-y divide-border/60">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="px-3 py-3">
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted/40" />
          <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-muted/30" />
        </li>
      ))}
    </ul>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex shrink-0 rounded-md border border-border bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {category}
    </span>
  );
}

function StatusBadge({ status }: { status: ExecutionCase["status"] }) {
  const map = {
    pending: { label: "Pending", cls: "bg-muted text-muted-foreground", Icon: null as null | typeof Loader2 },
    running: { label: "Running", cls: "bg-primary/15 text-primary", Icon: Loader2 },
    passed: { label: "Passed", cls: "bg-success/15 text-success", Icon: CheckCircle2 },
    failed: { label: "Failed", cls: "bg-destructive/15 text-destructive", Icon: XCircle },
  } as const;
  const { label, cls, Icon } = map[status];
  const spinning = status === "running";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
        cls,
      )}
    >
      {Icon && <Icon className={cn("h-2.5 w-2.5", spinning && "animate-spin")} strokeWidth={2} />}
      {label}
    </span>
  );
}
