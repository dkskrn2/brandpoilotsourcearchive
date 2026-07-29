import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../../lib/apiClient";
import {
  ANALYSIS_POLL_DEADLINE_MS,
  ANALYSIS_POLL_MAX_REQUESTS,
  ANALYSIS_REQUEST_TIMEOUT_MS,
  isRetryableAnalysisPollError,
  nextAnalysisPollDelay,
} from "./boundedAnalysisPoller";

describe("bounded analysis poll policy", () => {
  it("uses deterministic exponential delays capped at fifteen seconds", () => {
    expect(nextAnalysisPollDelay(0, () => 0)).toBe(2_000);
    expect(nextAnalysisPollDelay(1, () => 0)).toBe(4_000);
    expect(nextAnalysisPollDelay(2, () => 0)).toBe(8_000);
    expect(nextAnalysisPollDelay(3, () => 0)).toBe(15_000);
    expect(nextAnalysisPollDelay(9, () => 1)).toBe(18_000);
  });

  it("bounds requests, elapsed time, and each request", () => {
    expect(ANALYSIS_POLL_MAX_REQUESTS).toBe(63);
    expect(ANALYSIS_POLL_DEADLINE_MS).toBe(15 * 60_000);
    expect(ANALYSIS_REQUEST_TIMEOUT_MS).toBe(15_000);
  });

  it.each([408, 429, 500, 502, 503])(
    "retries HTTP %s responses",
    (status) => {
      expect(isRetryableAnalysisPollError(new ApiRequestError({
        status,
        errorCode: null,
      }))).toBe(true);
    },
  );

  it.each([400, 401, 403, 404, 409, 422])(
    "does not retry terminal HTTP %s responses",
    (status) => {
      expect(isRetryableAnalysisPollError(new ApiRequestError({
        status,
        errorCode: null,
      }))).toBe(false);
    },
  );

  it("retries network and gateway timeout errors only", () => {
    expect(isRetryableAnalysisPollError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryableAnalysisPollError(
      Object.assign(new Error("request timed out"), { code: "brand_analysis_poll_timeout" }),
    )).toBe(true);
    expect(isRetryableAnalysisPollError(new Error("unexpected"))).toBe(false);
    expect(isRetryableAnalysisPollError(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    )).toBe(false);
  });
});
