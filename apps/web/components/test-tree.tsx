import { CheckCircle2, XCircle, MinusCircle, ChevronDown } from "lucide-react";
import { ExplainButton } from "@/components/explain-button";
import { cn } from "@/lib/utils";

export interface TestRow {
  id: string;
  file: string;
  suite: string | null;
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number | null;
  failureMessage: string | null;
  failureStack: string | null;
}

interface TestTreeProps {
  tests: TestRow[];
  emptyMessage: string;
  runId?: string;
  explanations?: Record<string, string>;
}

export function TestTree({ tests, emptyMessage, runId, explanations }: TestTreeProps) {
  if (tests.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/30 px-6 py-12 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  const byFile = groupBy(tests, (t) => t.file);
  const files = [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-2">
      {files.map(([file, list]) => {
        const failed = list.filter((t) => t.status === "failed").length;
        const passed = list.filter((t) => t.status === "passed").length;
        const skipped = list.filter((t) => t.status === "skipped").length;
        const hasFail = failed > 0;
        return (
          <details
            key={file}
            open={hasFail}
            className="group overflow-hidden rounded-lg border border-border bg-card/40"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-2.5 hover:bg-muted/30">
              <div className="flex min-w-0 items-center gap-2">
                <ChevronDown
                  className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-0 [&:not(:where(.group[open] &))]:-rotate-90"
                  strokeWidth={1.75}
                />
                <span className="truncate font-mono text-xs">{file}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
                {passed > 0 && <span className="text-success">{passed} passed</span>}
                {failed > 0 && <span className="text-destructive">{failed} failed</span>}
                {skipped > 0 && <span className="text-muted-foreground">{skipped} skipped</span>}
              </div>
            </summary>
            <div className="divide-y divide-border/60 border-t border-border/60">
              {list
                .slice()
                .sort((a, b) => (a.status === "failed" ? -1 : b.status === "failed" ? 1 : 0))
                .map((t) => (
                  <TestRowItem
                    key={t.id}
                    test={t}
                    runId={runId}
                    explanation={explanations?.[t.id] ?? null}
                  />
                ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function TestRowItem({
  test,
  runId,
  explanation,
}: {
  test: TestRow;
  runId?: string;
  explanation: string | null;
}) {
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-start gap-3">
        <StatusIcon status={test.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {test.suite && (
              <span className="font-mono text-[11px] text-muted-foreground">{test.suite} ›</span>
            )}
            <span className="text-sm">{test.name}</span>
          </div>
          {test.failureMessage && (
            <pre className="mt-2 overflow-x-auto rounded-md border border-destructive/30 bg-destructive/5 p-3 font-mono text-[11px] leading-relaxed text-destructive">
              {test.failureMessage}
            </pre>
          )}
          {test.failureStack && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                Stack trace
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {test.failureStack}
              </pre>
            </details>
          )}
          {test.status === "failed" && runId && (
            <div className="mt-3">
              <ExplainButton
                runId={runId}
                testResultId={test.id}
                testName={test.name}
                testFile={test.file}
                failureMessage={test.failureMessage}
                cachedExplanation={explanation}
              />
            </div>
          )}
        </div>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {test.durationMs != null ? `${test.durationMs}ms` : "—"}
        </span>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: "passed" | "failed" | "skipped" }) {
  const map = {
    passed: { Icon: CheckCircle2, cls: "text-success" },
    failed: { Icon: XCircle, cls: "text-destructive" },
    skipped: { Icon: MinusCircle, cls: "text-muted-foreground" },
  } as const;
  const { Icon, cls } = map[status];
  return <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", cls)} strokeWidth={1.75} />;
}

function groupBy<T, K>(arr: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of arr) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}
