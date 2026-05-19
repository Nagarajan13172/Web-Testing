import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, GitBranch } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { RunStatusPill, type RunStatus } from "@/components/run-status-pill";
import { Badge } from "@/components/ui/badge";
import { db, repos, runs, eq, and, desc } from "@webtesting/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function RepoPage({ params }: PageProps) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { org } = await requireUser();

  const [repo] = await db
    .select()
    .from(repos)
    .where(and(eq(repos.id, id), eq(repos.orgId, org.id)))
    .limit(1);

  if (!repo) notFound();

  const recent = await db
    .select({
      id: runs.id,
      status: runs.status,
      branch: runs.branch,
      commitSha: runs.commitSha,
      triggeredBy: runs.triggeredBy,
      createdAt: runs.createdAt,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
    })
    .from(runs)
    .where(eq(runs.repoId, repo.id))
    .orderBy(desc(runs.createdAt))
    .limit(20);

  const repoFullName = `${repo.owner}/${repo.name}`;
  const installed = Boolean(repo.installationId);

  return (
    <AppShell>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Repositories
        </Link>
        <span>/</span>
        <span className="font-mono text-foreground">{repoFullName}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{repoFullName}</h1>
            {installed ? (
              <Badge variant="success">Connected</Badge>
            ) : (
              <Badge variant="outline">Pending setup</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Default branch:{" "}
            <span className="font-mono text-foreground">{repo.defaultBranch}</span>
            {installed && (
              <>
                {" "}
                · Installation:{" "}
                <span className="font-mono text-foreground">#{repo.installationId}</span>
              </>
            )}
          </p>
        </div>

        {installed && (
          <div className="flex items-center gap-2">
            <a
              href={`https://github.com/${repoFullName}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              View on GitHub
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
            </a>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Manage test cases
            </Link>
          </div>
        )}
      </div>

      <div className="mt-10">
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Recent runs</h2>
        {recent.length === 0 ? (
          <EmptyRuns installed={installed} />
        ) : (
          <RunsTable rows={recent} />
        )}
      </div>
    </AppShell>
  );
}

function EmptyRuns({ installed }: { installed: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/30 px-6 py-20 text-center">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
        <GitBranch className="h-5 w-5" strokeWidth={1.5} />
      </div>

      <h2 className="text-base font-semibold tracking-tight">No push-triggered runs yet</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Push a commit to see lint, install, and typecheck results stream in. AI test cases live
        on the dashboard.
      </p>

      {!installed && (
        <p className="mt-6 font-mono text-[11px] text-muted-foreground/70">
          Install the GitHub App on this repo to receive push events.
        </p>
      )}
    </div>
  );
}

function RunsTable({
  rows,
}: {
  rows: {
    id: string;
    status: string;
    branch: string;
    commitSha: string;
    triggeredBy: string | null;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
  }[];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Branch</th>
            <th className="px-4 py-2.5 font-medium">Commit</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Duration</th>
            <th className="px-4 py-2.5 font-medium">Triggered</th>
            <th className="px-4 py-2.5 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/60 last:border-b-0 hover:bg-muted/20">
              <td className="px-4 py-3 font-mono text-xs">
                <Link href={`/runs/${r.id}`} className="hover:text-primary">
                  <GitBranch className="mr-1 inline-block h-3 w-3 align-text-bottom text-muted-foreground" strokeWidth={1.75} />
                  {r.branch}
                </Link>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {r.commitSha.slice(0, 7)}
              </td>
              <td className="px-4 py-3">
                <RunStatusPill status={r.status as RunStatus} />
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {formatDuration(r.startedAt, r.finishedAt)}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {r.triggeredBy ?? "—"}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {formatTime(r.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function formatTime(d: Date) {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return d.toISOString().split("T")[0];
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
