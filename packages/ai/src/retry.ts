/**
 * Retry helper shared by the model calls in this package.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const base = opts.baseDelayMs ?? 1500;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetryable(err)) break;
      const delay = base * Math.pow(2, i) + Math.random() * 400;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export function isRetryable(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("service unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("high demand") ||
    msg.includes("rate limit") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  );
}

/**
 * Ceiling for a single structured-output call.
 *
 * `maxOutputTokens` on the 2.5 models is a budget for thinking tokens AND the
 * response together. Thinking regularly runs to five figures on these tasks
 * (23.5k on one observed repair), so a budget sized for the JSON alone gets
 * spent before the model emits anything and the response comes back as
 * truncated, unparseable JSON — with `finishReason: STOP`, not MAX_TOKENS, so
 * it reads like a malformed reply rather than an exhausted budget.
 */
export const MAX_OUTPUT_TOKENS = 24_576;
