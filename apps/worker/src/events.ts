import { connection } from "./queue";

export function runChannel(runId: string) {
  return `run-events:${runId}`;
}

export type RunEvent =
  | { type: "run.status"; status: "running" | "success" | "failure" }
  | { type: "step.start"; step: string; kind: string | null }
  | { type: "step.end"; step: string; status: "success" | "failure"; exitCode: number; durationMs: number }
  | { type: "tests.inserted"; kind: string; passed: number; failed: number; skipped: number };

export async function publishRunEvent(runId: string, event: RunEvent): Promise<void> {
  const payload = JSON.stringify({ ts: new Date().toISOString(), ...event });
  await connection.publish(runChannel(runId), payload);
}
