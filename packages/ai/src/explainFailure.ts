import { GoogleGenerativeAI } from "@google/generative-ai";

export interface ExplainFailureInput {
  testName: string;
  testFile: string;
  failureMessage: string | null;
  failureStack: string | null;
  repoFullName?: string | null;
}

export interface ExplainResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

const SYSTEM_PROMPT = `You are a senior engineer triaging a failing test.

Given the test name, file, failure message, and stack trace, explain in 2-4 sentences:
1. The most likely root cause.
2. A concrete next step to fix it.

Be specific. Reference symbols and line numbers from the stack when present.
Do not hedge — pick the most likely explanation.
Do not restate the failure message verbatim.
Plain prose, no markdown headings or bullet lists.`;

export const EXPLAIN_FAILURE_MODEL = "gemini-2.5-flash";

/**
 * Streams an explanation for a failing test. Yields text deltas as they arrive
 * and invokes `onDone` with the full text + usage once complete.
 */
export async function* streamExplainFailure(
  input: ExplainFailureInput,
  onDone?: (result: ExplainResult) => void,
): AsyncGenerator<string, void, void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: EXPLAIN_FAILURE_MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.4,
    },
  });

  const userPrompt = buildPrompt(input);
  const result = await model.generateContentStream(userPrompt);

  let collected = "";
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      collected += text;
      yield text;
    }
  }

  if (onDone) {
    const final = await result.response;
    const usage = final.usageMetadata;
    onDone({
      text: collected,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    });
  }
}

function buildPrompt(input: ExplainFailureInput): string {
  const lines: string[] = [];
  if (input.repoFullName) lines.push(`Repository: ${input.repoFullName}`);
  lines.push(`Test: ${input.testName}`);
  lines.push(`File: ${input.testFile}`);
  lines.push("");
  lines.push("Failure message:");
  lines.push(input.failureMessage?.trim() || "(none)");
  if (input.failureStack?.trim()) {
    lines.push("");
    lines.push("Stack trace:");
    lines.push(input.failureStack.trim().slice(0, 4000));
  }
  return lines.join("\n");
}
