import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { RunStatusPill, type RunStatus } from "@/components/run-status-pill";
import { db, runs, repos, eq, desc } from "@webtesting/db";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const rows = await db
    .select({
      id: runs.id,
      status: runs.status,
      branch: runs.branch,
      commitSha: runs.commitSha,
      triggeredBy: runs.triggeredBy,
      createdAt: runs.createdAt,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      repoOwner: repos.owner,
      repoName: repos.name,
    })
    .from(runs)
    .leftJoin(repos, eq(runs.repoId, repos.id))
    .orderBy(desc(runs.createdAt))
    .limit(100);

  return (
    <AppShell>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The last 100 runs across all repositories.
        </p>
      </div>

      <div className="mt-8 overflow-hidden rounded-lg border border-border bg-card/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Repository</th>
              <th className="px-4 py-2.5 font-medium">Branch</th>
              <th className="px-4 py-2.5 font-medium">Commit</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Duration</th>
              <th className="px-4 py-2.5 font-medium">Triggered</th>
              <th className="px-4 py-2.5 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-sm text-muted-foreground">
                  No runs yet. Trigger one from the{" "}
                  <Link href="/dashboard" className="text-primary hover:underline">
                    dashboard
                  </Link>
                  .
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border/60 last:border-b-0 hover:bg-muted/20"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/runs/${r.id}`}
                    className="font-mono text-xs text-foreground hover:text-primary"
                  >
                    {r.repoOwner ?? "—"}/{r.repoName ?? "—"}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.branch}</td>
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
    </AppShell>
  );
}

function formatTime(d: Date) {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return d.toISOString().split("T")[0];
}

function formatDuration(start: Date | null, end: Date | null) {
  if (!start) return "—";
  const finish = end?.getTime() ?? Date.now();
  const ms = finish - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
