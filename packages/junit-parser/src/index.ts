import { XMLParser } from "fast-xml-parser";

export type TestStatus = "passed" | "failed" | "skipped";
export type TestKind = "unit" | "integration" | "e2e" | "snapshot";

export interface ParsedTest {
  file: string;
  suite: string | null;
  name: string;
  status: TestStatus;
  durationMs: number | null;
  failureMessage: string | null;
  failureStack: string | null;
}

export interface ParsedJunit {
  tests: ParsedTest[];
  totals: { passed: number; failed: number; skipped: number };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  // Keep <failure> body text addressable as `#text`.
  textNodeName: "#text",
});

export function parseJunit(xml: string): ParsedJunit {
  const tests: ParsedTest[] = [];
  if (!xml || !xml.trim()) return { tests, totals: { passed: 0, failed: 0, skipped: 0 } };

  const root = parser.parse(xml) as Record<string, unknown>;
  const suites = collectTestSuites(root);

  for (const suite of suites) {
    const suiteName = strAttr(suite, "name");
    const suiteFile = strAttr(suite, "file") ?? suiteName ?? "unknown";
    const tcs = asArray<Record<string, unknown>>(suite["testcase"]);
    for (const tc of tcs) {
      const name = strAttr(tc, "name") ?? "(unnamed)";
      const classname = strAttr(tc, "classname");
      const file = strAttr(tc, "file") ?? suiteFile;
      const time = numAttr(tc, "time");
      const hasFailure = "failure" in tc || "error" in tc;
      const hasSkipped = "skipped" in tc;
      let status: TestStatus = "passed";
      let failureMessage: string | null = null;
      let failureStack: string | null = null;

      if (hasFailure) {
        status = "failed";
        const f = (tc["failure"] ?? tc["error"]) as unknown;
        const raw = Array.isArray(f) ? f[0] : f;
        if (typeof raw === "string") {
          failureStack = raw;
        } else if (raw && typeof raw === "object") {
          const obj = raw as Record<string, unknown>;
          failureMessage = (obj["@_message"] as string) ?? null;
          failureStack = (obj["#text"] as string) ?? null;
        }
      } else if (hasSkipped) {
        status = "skipped";
      }

      tests.push({
        file: file ?? "unknown",
        suite: classname ?? suiteName ?? null,
        name,
        status,
        durationMs: time != null ? Math.round(time * 1000) : null,
        failureMessage,
        failureStack,
      });
    }
  }

  return {
    tests,
    totals: {
      passed: tests.filter((t) => t.status === "passed").length,
      failed: tests.filter((t) => t.status === "failed").length,
      skipped: tests.filter((t) => t.status === "skipped").length,
    },
  };
}

function collectTestSuites(root: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    for (const [key, val] of Object.entries(obj)) {
      if (key === "testsuite") {
        for (const suite of asArray<Record<string, unknown>>(val)) out.push(suite);
      } else if (key === "testsuites") {
        visit(val);
      }
    }
  };
  visit(root);
  return out;
}

function asArray<T>(v: unknown): T[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]) as T[];
}

function strAttr(o: Record<string, unknown>, key: string): string | null {
  const v = o[`@_${key}`];
  return typeof v === "string" ? v : null;
}

function numAttr(o: Record<string, unknown>, key: string): number | null {
  const v = o[`@_${key}`];
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
