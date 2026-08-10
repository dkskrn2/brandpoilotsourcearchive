import {
  parseContentGenerationInputV3,
  parseResearchEvidenceSnapshotV1,
  type ContentGenerationInputV3,
  type ResearchEvidenceSnapshotV1,
} from "@brand-pilot/content-contracts";
import {
  parseBlogPlanDraftV1 as parseCanonicalBlogPlanDraftV1,
  type BlogPlanDraftV1,
} from "@brand-pilot/content-contracts/planner-drafts";
import { ensureEmptyBlogReferencesSection, validateBlogPlanHtml } from "./htmlValidator.js";

export interface BlogJob {
  id: string;
  generationId: string;
  outputId: string;
  workspaceId: string;
  brandId: string;
  jobType: "generate";
  outputFormat: "blog";
  status: "processing";
  payload: Record<string, unknown>;
  leaseToken: string;
}

export interface BlogClient {
  claim(workerId: string): Promise<BlogJob | null>;
  heartbeat(jobId: string, workerId: string, leaseToken: string): Promise<void>;
  complete(jobId: string, body: Record<string, unknown>): Promise<void>;
  fail(jobId: string, body: Record<string, unknown>): Promise<void>;
  completeResearch(job: BlogJob, evidence: ResearchEvidenceSnapshotV1): Promise<void>;
  acquire(workerId: string): Promise<{ id: string; leaseToken: string } | null>;
  heartbeatResource(id: string, workerId: string, leaseToken: string): Promise<void>;
  releaseResource(id: string, workerId: string, leaseToken: string): Promise<void>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("blog_job_invalid");
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseBlogJob(value: unknown): BlogJob {
  const source = record(value);
  const keys = ["id", "generationId", "outputId", "workspaceId", "brandId", "jobType", "outputFormat", "status", "payload", "leaseToken"];
  if (Object.keys(source).length !== keys.length || keys.some((key) => !(key in source))
    || ![source.id, source.generationId, source.outputId, source.workspaceId, source.brandId, source.leaseToken].every(nonEmpty)
    || source.jobType !== "generate" || source.outputFormat !== "blog" || source.status !== "processing") {
    throw new Error("blog_job_invalid");
  }
  record(source.payload);
  return source as unknown as BlogJob;
}

export function parseBlogInput(value: unknown, job: BlogJob): ContentGenerationInputV3 {
  const input = parseContentGenerationInputV3(value);
  if (input.generationId !== job.generationId || input.outputSettings.outputFormat !== "blog") {
    throw new Error("blog_input_invalid");
  }
  return input;
}

export function parseBlogResearchEvidence(value: unknown): ResearchEvidenceSnapshotV1 {
  return parseResearchEvidenceSnapshotV1(value);
}

function normalizedRequiredText(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || value.length > maxLength) throw new Error("blog_plan_draft_text_invalid");
  return normalized;
}

export function parseBlogPlanDraftV1(
  value: unknown,
  input: ContentGenerationInputV3,
  supplementalResearch?: ResearchEvidenceSnapshotV1 | null,
): BlogPlanDraftV1 {
  try {
    const plan = parseCanonicalBlogPlanDraftV1(value);
    const evidenceItems = [...input.researchEvidence.items, ...(supplementalResearch?.items ?? [])];
    const evidenceIds = new Set(evidenceItems.map((item) => item.id));
    if (
      new Set(plan.content.usedEvidenceIds).size !== plan.content.usedEvidenceIds.length
      || plan.content.usedEvidenceIds.some((id) => !evidenceIds.has(id))
    ) throw new Error("blog_plan_draft_evidence_invalid");
    const usedEvidenceIds = new Set(plan.content.usedEvidenceIds);
    const productImageAssetIds = new Set(input.product?.images.map((image) => image.assetId) ?? []);
    for (const [offset, asset] of (plan.imageDraft?.assets ?? []).entries()) {
      if (asset.index !== offset + 1) throw new Error("blog_plan_draft_asset_index_invalid");
      if (
        new Set(asset.evidenceIds).size !== asset.evidenceIds.length
        || asset.evidenceIds.some((id) => !usedEvidenceIds.has(id))
      ) throw new Error("blog_plan_draft_asset_evidence_invalid");
      if (
        new Set(asset.productImageAssetIds).size !== asset.productImageAssetIds.length
        || asset.productImageAssetIds.some((id) => !productImageAssetIds.has(id))
      ) throw new Error("blog_plan_draft_product_image_invalid");
    }
    const normalizedContent = {
      ...plan.content,
      title: normalizedRequiredText(plan.content.title, 500),
      htmlTemplate: normalizedRequiredText(plan.content.htmlTemplate, 100_000),
      metaTitle: normalizedRequiredText(plan.content.metaTitle, 500),
      metaDescription: normalizedRequiredText(plan.content.metaDescription, 2_000),
    };
    const htmlTemplate = ensureEmptyBlogReferencesSection(
      normalizedContent.htmlTemplate,
      plan.content.usedEvidenceIds.length > 0,
    );
    const normalizedPlan = { ...plan, content: { ...normalizedContent, htmlTemplate } };
    validateBlogPlanHtml(normalizedPlan.content.htmlTemplate, {
      evidenceItems,
      usedEvidenceIds: normalizedPlan.content.usedEvidenceIds,
      assetCount: normalizedPlan.imageDraft?.assets.length ?? 0,
    });
    return normalizedPlan;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("blog_html_")) throw error;
    throw new Error("blog_plan_draft_invalid");
  }
}
