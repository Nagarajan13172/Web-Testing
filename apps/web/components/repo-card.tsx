"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  Sparkles,
  Play,
  Settings,
  Link as LinkIcon,
  Save,
  ListChecks,
  ListMinus,
  ListPlus,
  TrendingUp,
  AlertTriangle,
  Search,
  Box,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TestExecutionModal } from "@/components/test-execution-modal";
import { EditCaseDialog, type EditableCase } from "@/components/edit-case-dialog";

interface InitialCase {
  id: string;
  title: string;
  description: string;
  category: string;
  status: "pending" | "running" | "passed" | "failed";
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastFailureMessage: string | null;
  targetRoute?: string | null;
  expectedResult?: string | null;
  playwrightCode?: string;
}

interface InitialPayload {
  targetDomain: string | null;
  cases: InitialCase[];
  totals: { total: number; passed: number; failed: number; running: number; pending: number };
  framework?: string | null;
  testRunnerKind?: "vitest" | "playwright" | null;
}

export interface RepoCardProps {
  repoId: string;
  repoFullName: string;
  defaultBranch: string;
  initial: InitialPayload;
  installed: boolean;
}

export function RepoCard({ repoId, repoFullName, defaultBranch, initial, installed }: RepoCardProps) {
  const [open, setOpen] = useState(initial.cases.length > 0);
  const [data, setData] = useState<InitialPayload>(initial);
  const [targetInput, setTargetInput] = useState(initial.targetDomain ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, startGen] = useTransition();
  const [genError, setGenError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [domainSaving, setDomainSaving] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalCaseIds, setModalCaseIds] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detectHint, setDetectHint] = useState<string | null>(null);
  const autoDetectedRef = useRef(false);
  const [editingCase, setEditingCase] = useState<EditableCase | null>(null);

  // Auto-detect framework the first time the user opens this card if it
  // hasn't been detected yet. No AI cost — just reads package.json.
  useEffect(() => {
    if (!open) return;
    if (autoDetectedRef.current) return;
    if (data.framework) return;
    if (!installed) return;
    autoDetectedRef.current = true;
    void detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isAnyRunning = data.cases.some((c) => c.status === "running");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isAnyRunning) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/repos/${repoId}/test-cases`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as InitialPayload;
          setData(next);
        }
      } catch {
        /* ignore transient errors */
      }
    }, 2500);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isAnyRunning, repoId]);

  async function generate() {
    setGenError(null);
    startGen(async () => {
      try {
        const res = await fetch(`/api/repos/${repoId}/generate-tests`, { method: "POST" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? `request failed: ${res.status}`);
        const refreshed = await fetch(`/api/repos/${repoId}/test-cases`, { cache: "no-store" });
        if (refreshed.ok) {
          const next = (await refreshed.json()) as InitialPayload;
          setData(next);
          if (next.targetDomain && !targetInput) setTargetInput(next.targetDomain);
          setOpen(true);
        }
      } catch (err) {
        setGenError(err instanceof Error ? err.message : "unknown error");
      }
    });
  }

  async function detect() {
    setDetectError(null);
    setDetecting(true);
    try {
      const res = await fetch(`/api/repos/${repoId}/detect`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `request failed: ${res.status}`);
      setData((d) => ({
        ...d,
        framework: json.framework,
        testRunnerKind: json.testRunnerKind,
      }));
      setDetectHint(json.hint ?? null);
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setDetecting(false);
    }
  }

  async function saveDomain() {
    setDomainError(null);
    setDomainSaving(true);
    try {
      const res = await fetch(`/api/repos/${repoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDomain: targetInput.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `request failed: ${res.status}`);
      setData((d) => ({ ...d, targetDomain: targetInput.trim() || null }));
    } catch (err) {
      setDomainError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setDomainSaving(false);
    }
  }

  function runSelected() {
    setRunError(null);
    const ids = [...selected];
    if (ids.length === 0) return;
    // Playwright runner needs a deployed URL; Vitest runs against components, no URL required.
    if (data.testRunnerKind !== "vitest" && !data.targetDomain) {
      setRunError("Set a Target Domain first.");
      return;
    }
    setModalCaseIds(ids);
    setModalOpen(true);
    setSelected(new Set());
  }

  function toggleAll() {
    if (selected.size === data.cases.length) setSelected(new Set());
    else setSelected(new Set(data.cases.map((c) => c.id)));
  }

  function toggleOne(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const passRate =
    data.totals.total === 0
      ? 0
      : Math.round((data.totals.passed / data.totals.total) * 100);

  return (
    <>
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="overflow-hidden rounded-lg border border-border bg-card/40"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 hover:bg-muted/20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
            <ListChecks className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <a
              href={`https://github.com/${repoFullName}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="block truncate font-mono text-sm font-medium text-foreground hover:text-primary"
            >
              {repoFullName}
            </a>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <span>{defaultBranch}</span>
              <span aria-hidden>·</span>
              <span>{data.totals.total} tests</span>
              {data.totals.failed > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span className="text-destructive">{data.totals.failed} failed</span>
                </>
              )}
            </div>
          </div>
        </div>

        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          strokeWidth={1.75}
        />
      </summary>

      <div className="border-t border-border/60 p-5">
        {/* Framework detection */}
        <div className="rounded-md border border-border bg-background/40 px-3 py-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/40 text-muted-foreground">
              <Box className="h-3.5 w-3.5" strokeWidth={1.75} />
            </div>
            <label className="shrink-0 text-xs font-medium text-muted-foreground">Framework</label>
            {data.framework ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-0.5 font-mono text-[11px] text-foreground">
                  {data.framework}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11px]",
                    data.testRunnerKind === "vitest"
                      ? "bg-primary/15 text-primary"
                      : "bg-warning/15 text-warning",
                  )}
                >
                  {data.testRunnerKind === "vitest" ? "Vitest runner" : "Playwright runner"}
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Not detected yet</span>
            )}
            <button
              type="button"
              onClick={detect}
              disabled={detecting}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {detecting ? (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
              ) : (
                <Search className="h-3 w-3" strokeWidth={1.75} />
              )}
              {data.framework ? "Re-detect" : "Detect framework"}
            </button>
          </div>
          {detectHint && !detectError && (
            <p className="mt-2 text-[11px] text-muted-foreground">{detectHint}</p>
          )}
          {detectError && (
            <p className="mt-2 font-mono text-[11px] text-destructive">{detectError}</p>
          )}
        </div>

        {/* Target Domain — only relevant for Playwright */}
        {data.testRunnerKind !== "vitest" && (
          <div className="mt-3 rounded-md border border-border bg-background/40 px-3 py-2">
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/40 text-muted-foreground">
                <LinkIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
              </div>
              <label className="shrink-0 text-xs font-medium text-muted-foreground">
                Target Domain
              </label>
              <input
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                placeholder="http://localhost:3000"
                className="flex-1 rounded-md border border-input bg-background px-2.5 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={saveDomain}
                disabled={domainSaving || targetInput === (data.targetDomain ?? "")}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {domainSaving ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
                ) : (
                  <Save className="h-3 w-3" strokeWidth={1.75} />
                )}
                Save
              </button>
            </div>
            {domainError && (
              <p className="mt-2 font-mono text-[11px] text-destructive">{domainError}</p>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total tests" value={data.totals.total.toString()} Icon={ListChecks} tone="muted" />
          <StatCard label="Passed" value={data.totals.passed.toString()} Icon={CheckCircle2} tone="success" />
          <StatCard label="Failed" value={data.totals.failed.toString()} Icon={XCircle} tone="destructive" />
          <StatCard label="Pass rate" value={`${passRate}%`} Icon={TrendingUp} tone="primary" />
        </div>

        {/* Body */}
        {data.cases.length === 0 ? (
          <GenerateBlock
            installed={installed}
            generating={generating}
            error={genError}
            onGenerate={generate}
          />
        ) : (
          <CaseList
            cases={data.cases}
            selected={selected}
            onToggleAll={toggleAll}
            onToggleOne={toggleOne}
            onRun={runSelected}
            onRegenerate={generate}
            onEdit={async (c) => {
              // Open the dialog immediately with what we have; then fetch the
              // full record (incl. playwrightCode, which is omitted from the
              // dashboard's initial SSR payload) and patch it in.
              setEditingCase({
                id: c.id,
                title: c.title,
                description: c.description,
                category: c.category,
                targetRoute: c.targetRoute ?? null,
                expectedResult: c.expectedResult ?? null,
                playwrightCode: c.playwrightCode ?? "",
              });
              try {
                const res = await fetch(`/api/repos/${repoId}/test-cases`, { cache: "no-store" });
                if (!res.ok) return;
                const json = (await res.json()) as {
                  cases: (InitialCase & { playwrightCode?: string })[];
                };
                const fresh = json.cases.find((x) => x.id === c.id);
                if (!fresh) return;
                setEditingCase({
                  id: fresh.id,
                  title: fresh.title,
                  description: fresh.description,
                  category: fresh.category,
                  targetRoute: fresh.targetRoute ?? null,
                  expectedResult: fresh.expectedResult ?? null,
                  playwrightCode: fresh.playwrightCode ?? "",
                });
              } catch {
                /* dialog still works with what we had */
              }
            }}
            generating={generating}
            running={running}
            runError={runError}
            targetSet={data.testRunnerKind === "vitest" || Boolean(data.targetDomain)}
          />
        )}
      </div>
    </details>

    <EditCaseDialog
      open={editingCase !== null}
      onClose={() => setEditingCase(null)}
      caseData={editingCase}
      onSaved={(updated) =>
        setData((d) => ({
          ...d,
          cases: d.cases.map((c) =>
            c.id === updated.id
              ? {
                  ...c,
                  title: updated.title,
                  description: updated.description,
                  category: updated.category,
                  targetRoute: updated.targetRoute,
                  expectedResult: updated.expectedResult,
                  playwrightCode: updated.playwrightCode ?? c.playwrightCode,
                  status: "pending" as const,
                }
              : c,
          ),
        }))
      }
    />

    <TestExecutionModal
      open={modalOpen}
      onClose={async () => {
        setModalOpen(false);
        // After closing the modal, pull the latest case state so the card
        // reflects the final pass/fail status without a full page reload.
        try {
          const res = await fetch(`/api/repos/${repoId}/test-cases`, { cache: "no-store" });
          if (res.ok) {
            const next = (await res.json()) as InitialPayload;
            setData(next);
          }
        } catch {
          /* ignore */
        }
      }}
      repoId={repoId}
      repoFullName={repoFullName}
      caseIds={modalCaseIds}
      initialTargetDomain={data.targetDomain}
    />
    </>
  );
}

/* ---------- inner pieces ---------- */

function GenerateBlock({
  installed,
  generating,
  error,
  onGenerate,
}: {
  installed: boolean;
  generating: boolean;
  error: string | null;
  onGenerate: () => void;
}) {
  return (
    <div className="mt-5 flex flex-col items-center rounded-md border border-dashed border-border bg-card/30 px-6 py-10 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background text-primary">
        <Sparkles className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <h3 className="text-sm font-semibold tracking-tight">Generate AI test cases</h3>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        Analyze this repository and generate Playwright test cases for the most important user flows.
      </p>
      {installed ? (
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          ) : (
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
          )}
          Generate test cases
        </button>
      ) : (
        <p className="mt-5 font-mono text-[11px] text-muted-foreground/70">
          Install the GitHub App on this repo first.
        </p>
      )}
      {error && (
        <p className="mt-3 max-w-sm break-words font-mono text-[11px] text-destructive">{error}</p>
      )}
    </div>
  );
}

function CaseList({
  cases,
  selected,
  onToggleAll,
  onToggleOne,
  onRun,
  onRegenerate,
  onEdit,
  generating,
  running,
  runError,
  targetSet,
}: {
  cases: InitialCase[];
  selected: Set<string>;
  onToggleAll: () => void;
  onToggleOne: (id: string) => void;
  onRun: () => void;
  onRegenerate: () => void;
  onEdit: (c: InitialCase) => void;
  generating: boolean;
  running: boolean;
  runError: string | null;
  targetSet: boolean;
}) {
  const allSelected = selected.size === cases.length && cases.length > 0;
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight text-primary">Generated test cases</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleAll}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {allSelected ? <ListMinus className="h-3 w-3" strokeWidth={1.75} /> : <ListPlus className="h-3 w-3" strokeWidth={1.75} />}
            {allSelected ? "Clear" : "Select all"}
          </button>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={generating}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
          >
            {generating ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
            ) : (
              <Sparkles className="h-3 w-3" strokeWidth={1.75} />
            )}
            Regenerate
          </button>
        </div>
      </div>

      <ul className="divide-y divide-border/60 overflow-hidden rounded-md border border-border bg-card/40">
        {cases.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-3">
            <input
              type="checkbox"
              checked={selected.has(c.id)}
              onChange={() => onToggleOne(c.id)}
              disabled={c.status === "running"}
              className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{c.title}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.description}</div>
              {c.status === "failed" && c.lastFailureMessage && (
                <div className="mt-1 truncate font-mono text-[11px] text-destructive">
                  {c.lastFailureMessage}
                </div>
              )}
            </div>
            <CategoryBadge category={c.category} />
            <StatusBadge status={c.status} />
            <button
              type="button"
              onClick={() => onEdit(c)}
              title="Edit test requirements"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <Settings className="h-3 w-3" strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between rounded-md border border-border bg-card/40 px-4 py-3">
        <div className="text-xs text-muted-foreground">
          {selected.size === 0
            ? "Select test cases to run."
            : <>Run <span className="font-mono text-foreground">{selected.size}</span> selected test case{selected.size === 1 ? "" : "s"}</>}
          {!targetSet && (
            <span className="ml-2 inline-flex items-center gap-1 text-warning">
              <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
              Set a Target Domain first
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={running || selected.size === 0 || !targetSet}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          ) : (
            <Play className="h-4 w-4" strokeWidth={1.75} />
          )}
          Run test cases
        </button>
      </div>
      {runError && (
        <p className="mt-2 font-mono text-[11px] text-destructive">{runError}</p>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  Icon,
  tone,
}: {
  label: string;
  value: string;
  Icon: typeof CheckCircle2;
  tone: "muted" | "success" | "destructive" | "primary";
}) {
  const toneClass =
    tone === "success"
      ? "text-success bg-success/10"
      : tone === "destructive"
        ? "text-destructive bg-destructive/10"
        : tone === "primary"
          ? "text-primary bg-primary/10"
          : "text-muted-foreground bg-muted/40";
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2.5">
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-0.5 font-mono text-lg font-semibold text-foreground">{value}</div>
      </div>
      <div className={cn("flex h-7 w-7 items-center justify-center rounded-md", toneClass)}>
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </div>
    </div>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex shrink-0 rounded-md border border-border bg-muted/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {category}
    </span>
  );
}

function StatusBadge({ status }: { status: "pending" | "running" | "passed" | "failed" }) {
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
        "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
        cls,
      )}
    >
      {Icon && <Icon className={cn("h-3 w-3", spinning && "animate-spin")} strokeWidth={1.75} />}
      {label}
    </span>
  );
}
