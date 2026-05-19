import Link from "next/link";
import { Github, FolderGit2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { RepoCard } from "@/components/repo-card";
import { SyncGitHubButton } from "@/components/sync-github-button";
import { Button } from "@/components/ui/button";
import { db, repos, testCases, eq, desc, asc } from "@webtesting/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { org } = await requireUser();

  const orgRepos = await db
    .select()
    .from(repos)
    .where(eq(repos.orgId, org.id))
    .orderBy(desc(repos.createdAt))
    .limit(50);

  const allCases =
    orgRepos.length === 0
      ? []
      : await db
          .select({
            id: testCases.id,
            repoId: testCases.repoId,
            title: testCases.title,
            description: testCases.description,
            category: testCases.category,
            status: testCases.status,
            lastRunAt: testCases.lastRunAt,
            lastDurationMs: testCases.lastDurationMs,
            lastFailureMessage: testCases.lastFailureMessage,
            targetRoute: testCases.targetRoute,
            expectedResult: testCases.expectedResult,
          })
          .from(testCases)
          .orderBy(asc(testCases.generatedAt));

  const casesByRepo = new Map<string, typeof allCases>();
  for (const c of allCases) {
    if (!casesByRepo.has(c.repoId)) casesByRepo.set(c.repoId, []);
    casesByRepo.get(c.repoId)!.push(c);
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect a GitHub repo, generate Playwright tests with AI, and run them against any
            deployment URL.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SyncGitHubButton />
          <Button asChild>
            <a href="/api/github/install">
              <Github strokeWidth={1.75} />
              Connect GitHub repo
            </a>
          </Button>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Repositories
        </h2>

        {orgRepos.length === 0 ? (
          <EmptyRepos />
        ) : (
          <div className="space-y-3">
            {orgRepos.map((r) => {
              const cases = casesByRepo.get(r.id) ?? [];
              const totals = cases.reduce(
                (acc, c) => {
                  acc.total++;
                  if (c.status === "passed") acc.passed++;
                  else if (c.status === "failed") acc.failed++;
                  else if (c.status === "running") acc.running++;
                  else acc.pending++;
                  return acc;
                },
                { total: 0, passed: 0, failed: 0, running: 0, pending: 0 },
              );
              return (
                <RepoCard
                  key={r.id}
                  repoId={r.id}
                  repoFullName={`${r.owner}/${r.name}`}
                  defaultBranch={r.defaultBranch}
                  installed={Boolean(r.installationId)}
                  initial={{
                    targetDomain: r.targetDomain,
                    framework: r.framework,
                    testRunnerKind: (r.testRunnerKind as "vitest" | "playwright" | null) ?? null,
                    cases: cases.map((c) => ({
                      id: c.id,
                      title: c.title,
                      description: c.description,
                      category: c.category,
                      status: c.status as "pending" | "running" | "passed" | "failed",
                      lastRunAt: c.lastRunAt?.toISOString() ?? null,
                      lastDurationMs: c.lastDurationMs,
                      lastFailureMessage: c.lastFailureMessage,
                      targetRoute: c.targetRoute,
                      expectedResult: c.expectedResult,
                    })),
                    totals,
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-10 text-xs text-muted-foreground">
        <Link href="/runs" className="hover:text-foreground">
          View push-triggered runs →
        </Link>
      </div>
    </AppShell>
  );
}

function EmptyRepos() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/30 px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
        <FolderGit2 className="h-5 w-5" strokeWidth={1.5} />
      </div>
      <h3 className="text-sm font-semibold tracking-tight">No repositories connected</h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Install the GitHub App on a repository to start generating and running AI test cases.
      </p>
      <Button className="mt-5" asChild>
        <a href="/api/github/install">
          <Github strokeWidth={1.75} />
          Connect GitHub repository
        </a>
      </Button>
    </div>
  );
}
