/**
 * Retry helper shared by the model calls in this package.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const base = opts.baseDelayMs ?? 1500;
  const maxDelay = opts.maxDelayMs ?? 30_000;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetryable(err)) break;
      const backoff = base * Math.pow(2, i) + Math.random() * 400;
      // When the API tells us how long to wait, believe it. Rate-limit replies
      // carry a retryDelay (observed at 34-40s) that our backoff tops out well
      // below, so pure exponential backoff burns every attempt too early and
      // fails a call that a single longer wait would have completed.
      const advised = retryAfterMs(err);
      const delay = Math.min(Math.max(backoff, advised ?? 0), maxDelay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * The wait the API asked for, in ms, or null if it didn't say.
 *
 * Google returns this as a RetryInfo entry in the error body, which reaches us
 * as text on the error message — as `retryDelay: '34s'` or `"retryDelay":"34s"`
 * depending on how it was serialised.
 */
export function retryAfterMs(err: unknown): number | null {
  if (!err) return null;
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/retryDelay["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)s/i);
  if (!m || !m[1]) return null;
  const seconds = Number(m[1]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : null;
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
