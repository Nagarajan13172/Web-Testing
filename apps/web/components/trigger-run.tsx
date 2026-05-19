"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TriggerRun() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState("https://github.com/octocat/Hello-World");
  const [branch, setBranch] = useState("main");
  const [commitSha, setCommitSha] = useState("HEAD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, branch, commitSha }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `request failed: ${res.status}`);
      }
      const { run } = await res.json();
      router.push(`/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-border bg-card/40 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Trigger a run</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Enqueue a job manually. Worker will pick it up and walk the run row through
            queued &rarr; running &rarr; success.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_140px_140px]">
        <Field label="Repository URL">
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
        <Field label="Branch">
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
        <Field label="Commit">
          <input
            value={commitSha}
            onChange={(e) => setCommitSha(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center justify-end">
        <Button type="submit" disabled={busy || !repoUrl}>
          {busy ? (
            <Loader2 className="animate-spin" strokeWidth={1.75} />
          ) : (
            <Play strokeWidth={1.75} />
          )}
          {busy ? "Enqueueing…" : "Run"}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
