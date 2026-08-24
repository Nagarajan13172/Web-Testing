import { GoogleGenerativeAI, SchemaType, type Schema } from "@google/generative-ai";
import { sanitizeTestCode } from "./sanitize";
import { withRetry, MAX_OUTPUT_TOKENS } from "./retry";
import type { RepoContextFile } from "./generateTests";

export const TEST_REPAIR_MODEL = "gemini-2.5-flash";

export interface RepairTestInput {
  /** The spec as it was actually executed. */
  code: string;
  /** The generated case's title, for context on what the test is for. */
  testTitle: string;
  failureMessage: string | null;
  failureStack: string | null;
  /** Source of the modules the spec imports, read from the checkout. */
  sources: RepoContextFile[];
}

export interface RepairTestResult {
  code: string;
  diagnosis: string;
  usage: { inputTokens: number; outputTokens: number };
}

const SYSTEM_PROMPT = `You repair a failing Vitest + React Testing Library spec.

You are given the spec, the exact failure it produced when it ran, and the
source of the components it imports. Return a corrected spec that passes
against that source.

RULES:
- Fix the ROOT CAUSE named in the failure. Do NOT weaken the test into
  something trivially true, do not delete the assertion, and do not replace it
  with a comment. The repaired spec must still prove the same behaviour.
- Keep exactly one test()/it() call, and keep the same describe title.
- Read the component source and make assertions match what it ACTUALLY renders.
  The original spec failed because it guessed; do not guess again.
- "Found multiple elements": the same accessible name renders in more than one
  place (typically a list AND a detail panel). Scope the query to the region you
  mean with within(screen.getByRole("region", ...)) or an equivalent container
  query, or assert on something unique to the element you mean. Do not just
  switch to getAllBy* and index into it blindly.
- "Unable to find an element": the text may be split across child elements, or
  rendered only after an effect. Use expect(document.body).toHaveTextContent(...)
  for split text, and await screen.findBy* for anything asynchronous.
- Elements hidden by CSS (a media query, a utility class) are still IN the DOM.
  Asserting they are absent will fail. Assert on something the component only
  renders conditionally instead.
- Imports resolve from tests/ai/<name>.test.tsx, two directories below the repo
  root — so "../../src/...". Prefer the "@/" alias when the repo defines it.
- Return the COMPLETE file. No markdown fences.
- Keep the diagnosis to ONE short sentence; spend the output budget on the code.`;

const RESPONSE_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    // `code` is first deliberately: if the response is ever cut short, the
    // truncation lands in the prose rather than halfway through the spec.
    code: { type: SchemaType.STRING },
    diagnosis: { type: SchemaType.STRING },
  },
  required: ["code", "diagnosis"],
};

/**
 * Second pass over a spec that failed when it ran.
 *
 * Generation works from the repo's source alone, so it can only predict what a
 * component renders. This pass gets the thing generation never had: the actual
 * failure. That closes the loop on mistakes no amount of prompting prevents —
 * the model has been told at length about duplicated accessible names and still
 * produces them, but shown "Found multiple elements" for a specific query it
 * fixes it.
 */
export async function repairTest(input: RepairTestInput): Promise<RepairTestResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: TEST_REPAIR_MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // Near-zero: this is a corrective edit against a known error, not a
      // creative task. We want the obvious fix, not a novel one.
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const result = await withRetry(() => model.generateContent(buildPrompt(input)));
  const response = result.response;

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text());
  } catch (err) {
    throw new Error(`repair returned non-JSON output: ${String(err).slice(0, 200)}`);
  }
  if (!isRepairResult(parsed)) {
    throw new Error("repair output did not match expected schema");
  }
  if (!parsed.code.trim()) {
    throw new Error("repair returned an empty spec");
  }

  const usage = response.usageMetadata;
  return {
    // Same safety net as generation — a repair can reintroduce the very
    // antipatterns the sanitizers exist for.
    code: sanitizeTestCode(parsed.code),
    diagnosis: parsed.diagnosis,
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    },
  };
}

function buildPrompt(input: RepairTestInput): string {
  const lines = [
    `## Test intent`,
    input.testTitle,
    ``,
    `## Failing spec`,
    input.code,
    ``,
    `## Failure it produced`,
    input.failureMessage ?? "(no message reported)",
  ];
  if (input.failureStack) {
    lines.push(``, `## Stack`, truncate(input.failureStack, 3000));
  }
  if (input.sources.length > 0) {
    lines.push(``, `## Source of the components under test`);
    for (const f of input.sources) {
      lines.push(`--- ${f.path} ---`, truncate(f.content, 12_000));
    }
  }
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n\n... (truncated, ${s.length - max} more chars)`;
}

function isRepairResult(v: unknown): v is { code: string; diagnosis: string } {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.code === "string" && typeof o.diagnosis === "string";
}

/**
 * The local modules a spec imports, as repo-relative paths without extension.
 * Used to decide which files to hand the repair pass.
 *
 * Handles `../../src/Foo` (what the runner's layout produces) and the `@/Foo`
 * alias, which maps to `src/Foo` by React convention.
 */
export function localImportPaths(code: string): string[] {
  const out = new Set<string>();
  const re = /from\s+["'](?:\.\.\/)+([^"']+)["']|from\s+["']@\/([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m[1]) out.add(m[1].replace(/^\/+/, ""));
    else if (m[2]) out.add(`src/${m[2]}`);
  }
  return [...out];
}
