import {
  parseContentGenerationInputV3,
  type ContentGenerationInputV3,
} from "@brand-pilot/content-contracts";
import {
  parseReelPlanDraftV1,
  type ReelPlanDraftV1,
} from "@brand-pilot/content-contracts/planner-drafts";

export interface ReelJob {
  id: string;
  generationId: string;
  outputId: string;
  workspaceId: string;
  brandId: string;
  jobType: "generate";
  outputFormat: "reel";
  status: "processing";
  payload: Record<string, unknown>;
  leaseToken: string;
}

export interface ReelClient {
  claim(workerId: string): Promise<ReelJob | null>;
  heartbeat(jobId: string, workerId: string, leaseToken: string): Promise<void>;
  complete(jobId: string, body: Record<string, unknown>): Promise<void>;
  fail(jobId: string, body: Record<string, unknown>): Promise<void>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("reel_job_invalid");
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertDuplicateFreeSubset(
  values: readonly string[],
  allowed: ReadonlySet<string>,
  duplicateCode: string,
  unknownCode: string,
): void {
  if (new Set(values).size !== values.length) throw new Error(duplicateCode);
  if (values.some((value) => !allowed.has(value))) throw new Error(unknownCode);
}

export function parseReelJob(value: unknown): ReelJob {
  const source = record(value);
  const keys = ["id", "generationId", "outputId", "workspaceId", "brandId", "jobType", "outputFormat", "status", "payload", "leaseToken"];
  if (Object.keys(source).length !== keys.length || keys.some((key) => !(key in source))
    || ![source.id, source.generationId, source.outputId, source.workspaceId, source.brandId, source.leaseToken].every(nonEmpty)
    || source.jobType !== "generate" || source.outputFormat !== "reel" || source.status !== "processing") {
    throw new Error("reel_job_invalid");
  }
  record(source.payload);
  return source as unknown as ReelJob;
}

export function parseReelInput(value: unknown, job: ReelJob): ContentGenerationInputV3 {
  const input = parseContentGenerationInputV3(value);
  if (input.generationId !== job.generationId || input.outputSettings.outputFormat !== "reel") {
    throw new Error("reel_input_invalid");
  }
  return input;
}

export function parseReelPlanDraftForInput(value: unknown, input: ContentGenerationInputV3): ReelPlanDraftV1 {
  const draft = parseReelPlanDraftV1(value);
  const hashtags = draft.content.hashtags.map((hashtag) => hashtag.trim());
  if (!draft.content.caption.trim()
    || !draft.content.cta.trim()
    || hashtags.some((hashtag) => !hashtag)) {
    throw new Error("reel_plan_draft_content_invalid");
  }
  if (new Set(hashtags).size !== hashtags.length) {
    throw new Error("reel_plan_draft_hashtag_duplicate");
  }
  const expectedCount = input.selectedProposal.assetCount;
  const outline = input.selectedProposal.outline;
  if (expectedCount === null
    || outline.length !== expectedCount
    || draft.assets.length !== expectedCount
    || draft.assets.some((asset, position) => {
      const expected = outline[position];
      return !expected || asset.index !== expected.index || asset.role !== expected.role;
    })) {
    throw new Error("reel_plan_draft_outline_mismatch");
  }
  const allowedEvidenceIds = new Set(input.researchEvidence.items.map((item) => item.id));
  const allowedProductImageIds = new Set(input.product?.images.map((image) => image.assetId) ?? []);
  for (const asset of draft.assets) {
    assertDuplicateFreeSubset(
      asset.evidenceIds,
      allowedEvidenceIds,
      "reel_plan_draft_evidence_id_duplicate",
      "reel_plan_draft_evidence_id_unknown",
    );
    assertDuplicateFreeSubset(
      asset.productImageAssetIds,
      allowedProductImageIds,
      "reel_plan_draft_product_image_id_duplicate",
      "reel_plan_draft_product_image_id_unknown",
    );
  }
  return draft;
}
