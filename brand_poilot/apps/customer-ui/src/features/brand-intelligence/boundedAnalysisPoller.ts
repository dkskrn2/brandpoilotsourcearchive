import { ApiRequestError } from "../../lib/apiClient";

export const ANALYSIS_POLL_MAX_REQUESTS = 6_000;
export const ANALYSIS_POLL_DEADLINE_MS = 24 * 60 * 60_000;
export const ANALYSIS_REQUEST_TIMEOUT_MS = 15_000;
export const ANALYSIS_POLL_TIMEOUT_ERROR_CODE = "brand_analysis_poll_timeout";

const BASE_DELAYS_MS = [2_000, 4_000, 8_000, 15_000] as const;

export function nextAnalysisPollDelay(
  attempt: number,
  random = Math.random,
) {
  const base = BASE_DELAYS_MS[Math.min(attempt, BASE_DELAYS_MS.length - 1)]!;
  return Math.round(base * (1 + 0.2 * random()));
}

export function isRetryableAnalysisPollError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return error.status === 408
      || error.status === 429
      || (error.status >= 500 && error.status < 600);
  }
  if (error instanceof TypeError) return true;
  return error instanceof Error
    && "code" in error
    && error.code === ANALYSIS_POLL_TIMEOUT_ERROR_CODE;
}
