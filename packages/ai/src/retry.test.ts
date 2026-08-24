import { describe, it, expect } from "vitest";
import { retryAfterMs, isRetryable } from "./retry";

describe("retryAfterMs", () => {
  // Both serialisations show up depending on how the SDK stringifies the body.
  it("reads the quoted-object form", () => {
    expect(retryAfterMs(new Error(`{"@type":"...RetryInfo","retryDelay":"34s"}`))).toBe(34_000);
  });

  it("reads the inspected-object form", () => {
    expect(retryAfterMs(new Error("{ retryDelay: '40s' }"))).toBe(40_000);
  });

  it("handles fractional seconds by rounding up", () => {
    expect(retryAfterMs(new Error("retryDelay: '54.214194878s'"))).toBe(54_215);
  });

  it("returns null when the API didn't advise a delay", () => {
    expect(retryAfterMs(new Error("503 Service Unavailable"))).toBeNull();
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs(new Error("retryDelay: soon"))).toBeNull();
  });
});

describe("isRetryable", () => {
  it("retries rate limits, overload and transient network errors", () => {
    for (const m of ["429 Too Many Requests", "503", "model is overloaded",
      "rate limit exceeded", "ETIMEDOUT", "ECONNRESET", "fetch failed"]) {
      expect(isRetryable(new Error(m)), m).toBe(true);
    }
  });

  it("does not retry errors that will fail again identically", () => {
    for (const m of ["400 Bad Request", "API key not valid", "did not match expected schema"]) {
      expect(isRetryable(new Error(m)), m).toBe(false);
    }
  });
});
