import { transform } from "esbuild";

export type SpecValidation = { ok: true } | { ok: false; message: string };

/**
 * Checks that a hand-written spec parses as TSX.
 *
 * A spec that doesn't parse is guaranteed to fail, but without this the author
 * only finds out after a clone, an install and a container run — about half a
 * minute to be told about a missing bracket. esbuild parses it in a millisecond
 * and can say which line.
 *
 * This is a syntax check only. It deliberately says nothing about whether
 * imports resolve or assertions hold: those are the run's job, and failing them
 * is a legitimate result rather than a malformed submission.
 */
export async function validateSpec(code: string): Promise<SpecValidation> {
  if (!code.trim()) return { ok: false, message: "the spec is empty" };
  try {
    await transform(code, { loader: "tsx", format: "esm" });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: formatEsbuildError(err) };
  }
}

interface EsbuildError {
  errors?: Array<{ text?: string; location?: { line?: number; column?: number } | null }>;
}

function formatEsbuildError(err: unknown): string {
  const errors = (err as EsbuildError)?.errors;
  const first = Array.isArray(errors) ? errors[0] : undefined;
  if (first?.text) {
    const line = first.location?.line;
    return line ? `line ${line}: ${first.text}` : first.text;
  }
  return err instanceof Error ? err.message : "could not parse the spec";
}
