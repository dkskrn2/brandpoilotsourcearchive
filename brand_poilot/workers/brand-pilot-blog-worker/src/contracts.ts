export interface BlogJob { id: string; generationId: string; outputId: string | null; workspaceId: string; brandId: string; jobType: "analyze" | "generate"; contentType: "blog"; status: "processing"; payload: Record<string, unknown>; leaseToken: string; }
export interface ContentGenerationInputV2 {
  contractVersion: "content-generation-input.v2"; contentType: "blog"; orchestration: WorkerContentOrchestrationV1 | null; brandContext: Record<string, unknown>;
  subject: { analysisId: string; analysisVersion: number; analysisContractVersion: "subject-analysis.v1" | "subject-analysis.v2"; analysisResult: Record<string, unknown> | null; type: "product" | "service"; sourceUrl: string; facts: unknown[]; research: Record<string, unknown>; selectedImages: Array<{ id: string; url: string; role: string; altText: string }> };
  message: { target: Record<string, unknown>; appeal: Record<string, unknown>; qualityBrief: Record<string, unknown> };
  creativeDirection: { prompts: string[]; brandColor: string; selectedColor: string; aspectRatio: string; outputCount: 1 | 2 | 3; contentFamily?: "informational"; outputFormat?: "blog" };
  references: unknown[]; attachments: AiContentAttachmentSnapshot[];
}
export type BlogGenerationInput = ContentGenerationInputV2 | ContentGenerationInputV3;
const asRecord = (value: unknown, code: string): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code); return value as Record<string, unknown>; };
const asText = (value: unknown, code: string): string => { if (typeof value !== "string" || !value.trim()) throw new Error(code); return value; };
export function parseContentGenerationInput(value: unknown): ContentGenerationInputV2 {
  const input = asRecord(value, "content_generation_input_invalid");
  if (input.contractVersion !== "content-generation-input.v2") throw new Error("content_generation_input_version_invalid");
  if (input.contentType !== "blog") throw new Error("content_generation_input_type_invalid");
  const subject = asRecord(input.subject, "content_generation_subject_invalid"); const message = asRecord(input.message, "content_generation_message_invalid"); const direction = asRecord(input.creativeDirection, "content_generation_direction_invalid");
  if (!Array.isArray(subject.facts)) throw new Error("content_generation_facts_invalid"); if (!Array.isArray(subject.selectedImages)) throw new Error("content_generation_images_invalid");
  const analysisVersion = Number(subject.analysisVersion); if (!Number.isInteger(analysisVersion) || analysisVersion < 1) throw new Error("content_generation_analysis_version_invalid");
  if (subject.analysisContractVersion !== "subject-analysis.v1" && subject.analysisContractVersion !== "subject-analysis.v2") throw new Error("content_generation_analysis_contract_invalid");
  if (subject.type !== "product" && subject.type !== "service") throw new Error("content_generation_subject_type_invalid");
  const analysisResult = subject.analysisResult === null ? null : asRecord(subject.analysisResult, "content_generation_analysis_result_invalid"); if (subject.analysisContractVersion === "subject-analysis.v2" && !analysisResult) throw new Error("content_generation_analysis_result_invalid");
  const selectedImages = subject.selectedImages.map((value) => { const image = asRecord(value, "content_generation_image_invalid"); return { id: asText(image.id, "content_generation_image_id_invalid"), url: asText(image.url, "content_generation_image_url_invalid"), role: asText(image.role, "content_generation_image_role_invalid"), altText: typeof image.altText === "string" ? image.altText : "" }; });
  const outputCount = direction.outputCount; if (outputCount !== 1 && outputCount !== 2 && outputCount !== 3) throw new Error("content_generation_output_count_invalid");
  if (!Array.isArray(direction.prompts)) throw new Error("content_generation_prompts_invalid"); const prompts = direction.prompts.map((value) => asText(value, "content_generation_prompt_invalid")); if (prompts.length !== outputCount) throw new Error("content_generation_prompts_count_mismatch");
  const target = asRecord(message.target, "content_generation_target_invalid"); const appeal = asRecord(message.appeal, "content_generation_appeal_invalid"); const targetId = asText(target.id, "content_generation_target_id_invalid"); asText(appeal.id, "content_generation_appeal_id_invalid"); const appealTargetId = asText(appeal.targetId, "content_generation_appeal_target_id_invalid"); if (appealTargetId !== targetId) throw new Error("content_generation_appeal_target_mismatch");
  const selectedColor = asText(direction.selectedColor, "content_generation_selected_color_invalid"); const brandColor = typeof direction.brandColor === "string" && direction.brandColor.trim() ? direction.brandColor : selectedColor;
  const orchestration = parseWorkerContentOrchestration(input.orchestration, "blog", direction);
  return { contractVersion: "content-generation-input.v2", contentType: "blog", orchestration, brandContext: asRecord(input.brandContext, "content_generation_brand_context_invalid"), subject: { analysisId: asText(subject.analysisId, "content_generation_analysis_id_invalid"), analysisVersion, analysisContractVersion: subject.analysisContractVersion, analysisResult, type: subject.type, sourceUrl: typeof subject.sourceUrl === "string" ? subject.sourceUrl : "", facts: subject.facts, research: asRecord(subject.research, "content_generation_research_invalid"), selectedImages }, message: { target, appeal, qualityBrief: asRecord(message.qualityBrief, "content_generation_quality_brief_invalid") }, creativeDirection: { prompts, brandColor, selectedColor, aspectRatio: asText(direction.aspectRatio, "content_generation_aspect_ratio_invalid"), outputCount, ...(orchestration ? { contentFamily: "informational" as const, outputFormat: "blog" as const } : {}) }, references: Array.isArray(input.references) ? input.references : [], attachments: parseAttachmentSnapshots(input.attachments) };
}
export function parseBlogInput(value: unknown, legacyWorkerType: unknown): BlogGenerationInput {
  if (legacyWorkerType !== "blog") throw new Error("content_generation_input_type_invalid");
  const source = asRecord(value, "content_generation_input_invalid");
  if (source.contractVersion !== "content-generation-input.v3") return parseContentGenerationInput(value);
  const outputSettings = asRecord(source.outputSettings, "content_generation_input_invalid");
  if (outputSettings.outputFormat !== "blog") throw new Error("content_generation_input_type_invalid");
  const input = parseContentGenerationInputV3(value);
  if (input.outputSettings.outputFormat !== "blog") throw new Error("content_generation_input_type_invalid");
  return input;
}

export interface BlogClient { claim(workerId: string): Promise<BlogJob | null>; heartbeat(jobId: string, workerId: string, token: string): Promise<void>; complete(jobId: string, body: Record<string, unknown>): Promise<void>; completeResearch(job: BlogJob, evidence: ResearchEvidenceSnapshotV1): Promise<void>; fail(jobId: string, body: Record<string, unknown>): Promise<void>; acquire(workerId: string): Promise<{ id: string; leaseToken: string } | null>; heartbeatResource(id: string, workerId: string, token: string): Promise<void>; releaseResource(id: string, workerId: string, token: string): Promise<void>; }
export interface LocalBlogImage {
  fileName: string;
  bytes: Buffer;
  width: number;
  height: number;
}

export interface LocalBlogResult {
  metadata: { title: string; summary: string; metaTitle: string; metaDescription: string; coverAlt?: string; sections?: unknown[] };
  html: string;
  cover: Buffer;
  inlineImages: LocalBlogImage[];
}
export interface BlogPlanV2 {
  contractVersion: "blog-plan.v2";
  content: { title: string; htmlTemplate: string; metaTitle: string; metaDescription: string; usedEvidenceIds: string[] };
  imagePackage: ImageGenerationPackageV1 | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const source = asRecord(value, "blog_plan_invalid");
  if (Object.keys(source).length !== keys.length || Object.keys(source).some((key) => !keys.includes(key))) throw new Error("blog_plan_invalid");
  return source;
}
function boundedText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("blog_plan_invalid");
  return value.trim();
}
export function parseBlogResearchEvidence(value: unknown): ResearchEvidenceSnapshotV1 {
  const source = exactObject(value, ["contractVersion", "decision", "reason", "queries", "capturedAt", "items"]);
  if (source.contractVersion !== "research-evidence.v1" || (source.decision !== "searched" && source.decision !== "not_needed")) throw new Error("blog_research_invalid");
  if (!Array.isArray(source.queries) || source.queries.length > 4 || !Array.isArray(source.items) || source.items.length > 8) throw new Error("blog_research_invalid");
  const queries = source.queries.map((item) => boundedText(item, 500));
  const capturedAt = boundedText(source.capturedAt, 100); if (Number.isNaN(Date.parse(capturedAt))) throw new Error("blog_research_invalid");
  const items = source.items.map((item) => {
    const entry = exactObject(item, ["id", "title", "url", "publisher", "publishedAt", "capturedAt", "claimSummary", "contentHash"]);
    if (typeof entry.id !== "string" || !UUID.test(entry.id) || typeof entry.contentHash !== "string" || !SHA256.test(entry.contentHash)) throw new Error("blog_research_invalid");
    let url: URL; try { url = new URL(boundedText(entry.url, 2_000)); } catch { throw new Error("blog_research_invalid"); }
    if (url.protocol !== "https:") throw new Error("blog_research_invalid");
    const itemCapturedAt = boundedText(entry.capturedAt, 100); if (Number.isNaN(Date.parse(itemCapturedAt))) throw new Error("blog_research_invalid");
    const publishedAt = entry.publishedAt === null ? null : boundedText(entry.publishedAt, 100);
    if (publishedAt !== null && Number.isNaN(Date.parse(publishedAt))) throw new Error("blog_research_invalid");
    return { id: entry.id, title: boundedText(entry.title, 500), url: url.toString(), publisher: entry.publisher === null ? null : boundedText(entry.publisher, 500), publishedAt, capturedAt: itemCapturedAt, claimSummary: boundedText(entry.claimSummary, 4_000), contentHash: entry.contentHash };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length || new Set(items.map((item) => item.url)).size !== items.length) throw new Error("blog_research_invalid");
  if (source.decision === "not_needed" && (queries.length || items.length)) throw new Error("blog_research_invalid");
  return { contractVersion: "research-evidence.v1", decision: source.decision, reason: boundedText(source.reason, 4_000), queries, capturedAt, items };
}

export function parseBlogPlanV2(value: unknown, input: ContentGenerationInputV3, supplementalResearch?: unknown): BlogPlanV2 {
  try {
    const source = exactObject(value, ["contractVersion", "content", "imagePackage"]);
    if (source.contractVersion !== "blog-plan.v2") throw new Error();
    const content = exactObject(source.content, ["title", "htmlTemplate", "metaTitle", "metaDescription", "usedEvidenceIds"]);
    if (!Array.isArray(content.usedEvidenceIds) || content.usedEvidenceIds.length > 16 || content.usedEvidenceIds.some((id) => typeof id !== "string" || !UUID.test(id)) || new Set(content.usedEvidenceIds).size !== content.usedEvidenceIds.length) throw new Error();
    const supplement = supplementalResearch === undefined || supplementalResearch === null ? null : parseBlogResearchEvidence(supplementalResearch);
    const evidenceItems = [...input.researchEvidence.items, ...(supplement?.items ?? [])];
    const evidenceIds = new Set(evidenceItems.map((item) => item.id));
    if ((content.usedEvidenceIds as string[]).some((id) => !evidenceIds.has(id))) throw new Error();
    const usedEvidenceIds = new Set(content.usedEvidenceIds as string[]);
    const imagePackage = source.imagePackage === null ? null : parseImageGenerationPackageV1(source.imagePackage);
    if (imagePackage && (
      imagePackage.generationId !== input.generationId
      || imagePackage.outputFormat !== "blog"
      || imagePackage.purpose !== input.outputSettings.purpose
      || !isDeepStrictEqual(imagePackage.channelTargets, input.outputSettings.channelTargets)
      || !isDeepStrictEqual(imagePackage.product, input.product)
      || !isDeepStrictEqual(imagePackage.references, input.references.selected)
      || !isDeepStrictEqual(imagePackage.brandStyleImages, input.references.brandStyleImages)
      || imagePackage.avatarStyleImageId !== input.references.avatarStyleImageId
      || !isDeepStrictEqual(imagePackage.attachments, input.references.attachments)
      || imagePackage.userImageInstruction !== input.userImageInstruction
      || imagePackage.assets.some((asset) => asset.evidenceIds.some((id) => !usedEvidenceIds.has(id)))
    )) throw new Error();
    const htmlTemplate = boundedText(content.htmlTemplate, 100_000);
    validateBlogPlanHtml(htmlTemplate, { evidenceItems, usedEvidenceIds: content.usedEvidenceIds as string[], assetCount: imagePackage?.assetCount ?? 0 });
    return { contractVersion: "blog-plan.v2", content: { title: boundedText(content.title, 500), htmlTemplate, metaTitle: boundedText(content.metaTitle, 500), metaDescription: boundedText(content.metaDescription, 2_000), usedEvidenceIds: content.usedEvidenceIds as string[] }, imagePackage };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("blog_html_")) throw error;
    throw new Error("blog_plan_invalid");
  }
}

import { isDeepStrictEqual } from "node:util";
import { parseAttachmentSnapshots, parseContentGenerationInputV3, parseImageGenerationPackageV1, parseWorkerContentOrchestration, type AiContentAttachmentSnapshot, type ContentGenerationInputV3, type ImageGenerationPackageV1, type ResearchEvidenceSnapshotV1, type WorkerContentOrchestrationV1 } from "@brand-pilot/worker-runtime";
import { validateBlogPlanHtml } from "./htmlValidator.js";
