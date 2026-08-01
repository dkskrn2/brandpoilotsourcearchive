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
  [270, 270, 60, 60, 75, 75, 60, 60] as const;
export const STAGE_RESERVE_SECONDS =
  [660, 390, 330, 270, 195, 120, 60, 0] as const;

export function codexProcessTimeoutMs(configuredValue: string | undefined): number {
  const configuredMs = Number(configuredValue ?? ACTIVE_PIPELINE_MS);
  if (!Number.isFinite(configuredMs)) return ACTIVE_PIPELINE_MS;
  return Math.max(ACTIVE_PIPELINE_MS, Math.floor(configuredMs));
}

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
