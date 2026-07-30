export const ACTIVE_PIPELINE_MS = 20 * 60 * 1_000;
export const MAX_LOGICAL_CLI_CALLS = 8;
export const MAX_RETRY_CLI_CALLS = 2;
export const MAX_PHYSICAL_CLI_CALLS =
  MAX_LOGICAL_CLI_CALLS + MAX_RETRY_CLI_CALLS;
export const MAX_OWNED_PAGE_ATTEMPTS = 20;
export const MAX_OWNED_OFFERING_PAGES = 5;
export const MAX_FINAL_OFFERINGS = 5;
export const MAX_EXTERNAL_PAGES = 10;
export const MAX_EVIDENCE_CHARACTERS = 400_000;
export const MAX_SOURCE_CHARACTERS = 100_000;
export const MAX_SEGMENT_CHARACTERS = 20_000;

export const STAGE_BUDGET_SECONDS =
  [270, 270, 60, 60, 75, 75, 60, 15] as const;
export const STAGE_RESERVE_SECONDS =
  [615, 345, 285, 225, 150, 75, 15, 0] as const;

export function stageTimeoutMs(stageIndex: number, remainingMs: number): number {
  const cap = STAGE_BUDGET_SECONDS[stageIndex];
  const reserve = STAGE_RESERVE_SECONDS[stageIndex];
  if (cap === undefined || reserve === undefined) {
    throw new Error("brand_intelligence_stage_index_invalid");
  }
  const available = remainingMs - reserve * 1_000;
  if (available <= 0) throw new Error("analysis_deadline_exceeded");
  return Math.min(cap * 1_000, available);
}
