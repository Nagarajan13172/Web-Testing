import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, RotateCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { RunStatusPill, type RunStatus } from "@/components/run-status-pill";
import { Tabs, type TabDef } from "@/components/ui/tabs";
import { TestTree, type TestRow } from "@/components/test-tree";
import { LiveRun } from "@/components/live-run";
import {
  db,
  runs,
  runSteps,
  testResults,
  repos,
  aiArtifacts,
  eq,
  asc,
} from "@webtesting/db";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

type Kind = "unit" | "integration" | "e2e" | "snapshot";
type TestRowWithKind = TestRow & { kind: Kind };

export default async function RunDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();

  const [row] = await db
    .select({
      run: runs,
      repoOwner: repos.owner,
      repoName: repos.name,
    })
    .from(runs)
    .leftJoin(repos, eq(runs.repoId, repos.id))
    .where(eq(runs.id, id))
    .limit(1);

  if (!row) notFound();

  const [steps, tests, artifacts] = await Promise.all([
    db.select().from(runSteps).where(eq(runSteps.runId, id)).orderBy(asc(runSteps.startedAt)),
    db.select().from(testResults).where(eq(testResults.runId, id)),
    db
      .select()
      .from(aiArtifacts)
      .where(eq(aiArtifacts.runId, id)),
  ]);

  const explanations: Record<string, string> = {};
  for (const a of artifacts) {
    if (a.kind !== "explanation" || !a.relatedTestId) continue;
    const content = a.content;
    if (content && typeof content === "object" && "text" in content) {
      const text = (content as { text: unknown }).text;
      if (typeof text === "string") explanations[a.relatedTestId] = text;
    }
  }

  const run = row.run;
  const repoFullName =
    row.repoOwner && row.repoName ? `${row.repoOwner}/${row.repoName}` : "—";

  const bucketed = bucketByKind(tests as unknown as TestRowWithKind[]);
  const totals = {
    unit: countOf(bucketed.unit),
    integration: countOf(bucketed.integration),
    e2e: countOf(bucketed.e2e),
  };

  const tabs: TabDef[] = [
    {
      id: "summary",
      label: "Summary",
      badge: totals.unit.failed + totals.integration.failed + totals.e2e.failed > 0
        ? { text: String(totals.unit.failed + totals.integration.failed + totals.e2e.failed), tone: "destructive" }
        : null,
    },
    { id: "unit", label: "Unit", badge: badgeFor(totals.unit) },
    { id: "integration", label: "Integration", badge: badgeFor(totals.integration) },
    { id: "e2e", label: "E2E", badge: badgeFor(totals.e2e) },
    { id: "steps", label: "Steps", badge: { text: String(steps.length), tone: "muted" } },
  ];

  const active = pickActive(sp.tab, tabs);

  return (
    <AppShell>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/runs" className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Runs
        </Link>
        <span>/</span>
        <span className="font-mono text-foreground">{id.slice(0, 8)}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{repoFullName}</h1>
            <RunStatusPill status={run.status as RunStatus} />
            <LiveRun runId={id} terminal={isTerminal(run.status)} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <Meta label="commit" value={run.commitSha.slice(0, 7)} mono />
            <Meta label="branch" value={run.branch} mono />
            <Meta label="duration" value={formatDuration(run.startedAt, run.finishedAt)} mono />
            <Meta label="triggered" value={run.triggeredBy ?? "—"} mono />
          </div>
        </div>

        <Button variant="outline" size="sm" disabled>
          <RotateCw strokeWidth={1.75} />
          Re-run
        </Button>
      </div>

      <div className="mt-8">
        <Tabs tabs={tabs} active={active} />
      </div>

      <div className="mt-6">
        {active === "summary" && (
          <SummaryView
            runId={id}
            explanations={explanations}
            failed={[
              ...bucketed.unit.filter((t) => t.status === "failed").map((t) => ({ kind: "unit" as Kind, t })),
              ...bucketed.integration.filter((t) => t.status === "failed").map((t) => ({ kind: "integration" as Kind, t })),
              ...bucketed.e2e.filter((t) => t.status === "failed").map((t) => ({ kind: "e2e" as Kind, t })),
            ]}
            steps={steps}
          />
        )}
        {active === "unit" && (
          <TestTree
            tests={bucketed.unit}
            emptyMessage="No unit tests reported in this run."
            runId={id}
            explanations={explanations}
          />
        )}
        {active === "integration" && (
          <TestTree
            tests={bucketed.integration}
            emptyMessage="No integration tests reported in this run."
            runId={id}
            explanations={explanations}
          />
        )}
        {active === "e2e" && (
          <TestTree
            tests={bucketed.e2e}
            emptyMessage="No end-to-end tests reported in this run."
            runId={id}
            explanations={explanations}
          />
        )}
        {active === "steps" && <StepsTable steps={steps} />}
      </div>
    </AppShell>
  );
}

function bucketByKind(rows: TestRowWithKind[]) {
  return {
    unit: rows.filter((r) => r.kind === "unit" || r.kind === "snapshot"),
    integration: rows.filter((r) => r.kind === "integration"),
    e2e: rows.filter((r) => r.kind === "e2e"),
  };
}

function countOf(list: TestRow[]) {
  return {
    passed: list.filter((t) => t.status === "passed").length,
    failed: list.filter((t) => t.status === "failed").length,
    skipped: list.filter((t) => t.status === "skipped").length,
    total: list.length,
  };
}

function badgeFor(c: { passed: number; failed: number; total: number }) {
  if (c.total === 0) return null;
  if (c.failed > 0) return { text: `${c.failed}`, tone: "destructive" as const };
  return { text: `${c.passed}`, tone: "success" as const };
}

function pickActive(raw: string | string[] | undefined, tabs: TabDef[]): string {
  const wanted = Array.isArray(raw) ? raw[0] : raw;
  if (wanted && tabs.some((t) => t.id === wanted)) return wanted;
  return tabs[0]?.id ?? "summary";
}

function SummaryView({
  runId,
  failed,
  steps,
  explanations,
}: {
  runId: string;
  failed: { kind: Kind; t: TestRow }[];
  steps: Awaited<ReturnType<typeof db.select.prototype.from>>;
  explanations: Record<string, string>;
}) {
  return (
    <div className="space-y-6">
      <StepSummaryStrip steps={steps as unknown as StepRow[]} />
      {failed.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/30 px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No failing tests in this run. Check individual tabs to browse passing tests.
          </p>
        </div>
      ) : (
        <div>
          <h2 className="mb-3 text-sm font-semibold tracking-tight">
            Failed tests ({failed.length})
          </h2>
          <TestTree
            tests={failed.map((f) => f.t)}
            emptyMessage=""
            runId={runId}
            explanations={explanations}
          />
        </div>
      )}
    </div>
  );
}

interface StepRow {
  id: string;
  name: string;
  kind: string | null;
  status: string;
  durationMs: number | null;
  exitCode: number | null;
}

function StepSummaryStrip({ steps }: { steps: StepRow[] }) {
  if (steps.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/30 px-6 py-6 text-center text-sm text-muted-foreground">
        No pipeline steps recorded yet.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/40 p-3">
      {steps.map((s) => (
        <span
          key={s.id}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] ${stepColor(s.status)}`}
        >
          <span aria-hidden>
            {s.status === "success" ? "✓" : s.status === "failure" ? "✗" : s.status === "running" ? "•" : "○"}
          </span>
          <span>{s.name}</span>
          {s.durationMs != null && (
            <span className="text-muted-foreground">{s.durationMs}ms</span>
          )}
        </span>
      ))}
    </div>
  );
}

function stepColor(status: string) {
  switch (status) {
    case "success": return "border-success/30 bg-success/10 text-success";
    case "failure": return "border-destructive/30 bg-destructive/10 text-destructive";
    case "running": return "border-primary/30 bg-primary/10 text-primary";
    default: return "border-border bg-muted/30 text-muted-foreground";
  }
}

function StepsTable({ steps }: { steps: StepRow[] }) {
  if (steps.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/30 px-6 py-12 text-center text-sm text-muted-foreground">
        No steps recorded.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Step</th>
            <th className="px-4 py-2.5 font-medium">Kind</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Duration</th>
            <th className="px-4 py-2.5 font-medium">Exit</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => (
            <tr key={s.id} className="border-b border-border/60 last:border-b-0">
              <td className="px-4 py-3 font-mono text-xs">{s.name}</td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{s.kind ?? "—"}</td>
              <td className="px-4 py-3"><RunStatusPill status={mapStepStatus(s.status)} /></td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {s.durationMs != null ? `${s.durationMs}ms` : "—"}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{s.exitCode ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</span>
      <span className={mono ? "font-mono text-foreground" : "text-foreground"}>{value}</span>
    </span>
  );
}

function formatDuration(start: Date | null, end: Date | null) {
  if (!start) return "—";
  const finish = end?.getTime() ?? Date.now();
  const ms = finish - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function mapStepStatus(s: string): RunStatus {
  switch (s) {
    case "queued": return "queued";
    case "running": return "running";
    case "success": return "success";
    case "failure": return "failure";
    case "skipped": return "cancelled";
    default: return "queued";
  }
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function isTerminal(status: string): boolean {
  return status === "success" || status === "failure" || status === "cancelled";
}
