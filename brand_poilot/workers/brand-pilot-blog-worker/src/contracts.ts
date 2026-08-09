import {
  parseBlogPlanV2 as parseCanonicalBlogPlanV2,
  parseContentGenerationInputV3,
  parseResearchEvidenceSnapshotV1,
  type BlogPlanV2,
  type ContentGenerationInputV3,
  type ResearchEvidenceSnapshotV1,
} from "@brand-pilot/content-contracts";
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

export function parseBlogPlanV2(
  value: unknown,
  input: ContentGenerationInputV3,
  supplementalResearch?: ResearchEvidenceSnapshotV1 | null,
): BlogPlanV2 {
  try {
    const plan = parseCanonicalBlogPlanV2(value);
    const evidenceItems = [...input.researchEvidence.items, ...(supplementalResearch?.items ?? [])];
    const evidenceIds = new Set(evidenceItems.map((item) => item.id));
    if (plan.imagePackage && (
      plan.imagePackage.generationId !== input.generationId
      || plan.imagePackage.outputFormat !== "blog"
      || plan.imagePackage.purpose !== input.outputSettings.purpose
      || plan.imagePackage.channelTargets[0] !== input.outputSettings.channelTargets[0]
      || plan.imagePackage.assets.some((asset) => asset.evidenceIds.some((id) => !evidenceIds.has(id)))
    )) throw new Error("blog_plan_binding_invalid");
    const htmlTemplate = ensureEmptyBlogReferencesSection(
      plan.content.htmlTemplate,
      plan.content.usedEvidenceIds.length > 0,
    );
    const normalizedPlan = htmlTemplate === plan.content.htmlTemplate
      ? plan
      : { ...plan, content: { ...plan.content, htmlTemplate } };
    validateBlogPlanHtml(normalizedPlan.content.htmlTemplate, {
      evidenceItems,
      usedEvidenceIds: normalizedPlan.content.usedEvidenceIds,
      assetCount: normalizedPlan.imagePackage?.assetCount ?? 0,
    });
    return normalizedPlan;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("blog_html_")) throw error;
    throw new Error("blog_plan_invalid");
  }
}
