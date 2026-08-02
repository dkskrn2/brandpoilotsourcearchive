export interface MarketingJob { id: string; generationId: string; outputId: string | null; workspaceId: string; brandId: string; jobType: "analyze" | "generate"; contentType: "marketing"; status: "processing"; payload: Record<string, unknown>; leaseToken: string; }
export interface ContentGenerationInputV2 {
  contractVersion: "content-generation-input.v2"; contentType: "marketing"; orchestration: WorkerContentOrchestrationV1 | null; brandContext: Record<string, unknown>;
  subject: { analysisId: string; analysisVersion: number; analysisContractVersion: "subject-analysis.v1" | "subject-analysis.v2"; analysisResult: Record<string, unknown> | null; type: "product" | "service"; sourceUrl: string; facts: unknown[]; research: Record<string, unknown>; selectedImages: Array<{ id: string; url: string; role: string; altText: string }> };
  message: { target: Record<string, unknown>; appeal: Record<string, unknown>; qualityBrief: Record<string, unknown> };
  creativeDirection: { prompts: string[]; brandColor: string; selectedColor: string; aspectRatio: string; outputCount: 1 | 2 | 3; contentFamily?: "marketing"; outputFormat?: "single_image" | "channel_text" };
  references: unknown[]; attachments: AiContentAttachmentSnapshot[];
}
const asRecord = (value: unknown, code: string): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code); return value as Record<string, unknown>; };
const asText = (value: unknown, code: string): string => { if (typeof value !== "string" || !value.trim()) throw new Error(code); return value; };
export function parseContentGenerationInput(value: unknown): ContentGenerationInputV2 {
  const input = asRecord(value, "content_generation_input_invalid");
  if (input.contractVersion !== "content-generation-input.v2") throw new Error("content_generation_input_version_invalid"); if (input.contentType !== "marketing") throw new Error("content_generation_input_type_invalid");
  const subject = asRecord(input.subject, "content_generation_subject_invalid"); const message = asRecord(input.message, "content_generation_message_invalid"); const direction = asRecord(input.creativeDirection, "content_generation_direction_invalid");
  if (!Array.isArray(subject.facts) || !Array.isArray(subject.selectedImages)) throw new Error("content_generation_subject_invalid");
  const analysisVersion = Number(subject.analysisVersion); if (!Number.isInteger(analysisVersion) || analysisVersion < 1) throw new Error("content_generation_analysis_version_invalid");
  if (subject.analysisContractVersion !== "subject-analysis.v1" && subject.analysisContractVersion !== "subject-analysis.v2") throw new Error("content_generation_analysis_contract_invalid");
  if (subject.type !== "product" && subject.type !== "service") throw new Error("content_generation_subject_type_invalid");
  const analysisResult = subject.analysisResult === null ? null : asRecord(subject.analysisResult, "content_generation_analysis_result_invalid"); if (subject.analysisContractVersion === "subject-analysis.v2" && !analysisResult) throw new Error("content_generation_analysis_result_invalid");
  const selectedImages = subject.selectedImages.map((value) => { const image = asRecord(value, "content_generation_image_invalid"); return { id: asText(image.id, "content_generation_image_id_invalid"), url: asText(image.url, "content_generation_image_url_invalid"), role: asText(image.role, "content_generation_image_role_invalid"), altText: typeof image.altText === "string" ? image.altText : "" }; });
  const outputCount = direction.outputCount; if (outputCount !== 1 && outputCount !== 2 && outputCount !== 3) throw new Error("content_generation_output_count_invalid");
  if (!Array.isArray(direction.prompts)) throw new Error("content_generation_prompts_invalid"); const prompts = direction.prompts.map((value) => asText(value, "content_generation_prompt_invalid")); if (prompts.length !== outputCount) throw new Error("content_generation_prompts_count_mismatch");
  const target = asRecord(message.target, "content_generation_target_invalid"); const appeal = asRecord(message.appeal, "content_generation_appeal_invalid"); const targetId = asText(target.id, "content_generation_target_id_invalid"); asText(appeal.id, "content_generation_appeal_id_invalid"); const appealTargetId = asText(appeal.targetId, "content_generation_appeal_target_id_invalid"); if (appealTargetId !== targetId) throw new Error("content_generation_appeal_target_mismatch");
  const selectedColor = asText(direction.selectedColor, "content_generation_selected_color_invalid"); const brandColor = typeof direction.brandColor === "string" && direction.brandColor.trim() ? direction.brandColor : selectedColor;
  const orchestration = parseWorkerContentOrchestration(input.orchestration, "marketing", direction);
  return { contractVersion: "content-generation-input.v2", contentType: "marketing", orchestration, brandContext: asRecord(input.brandContext, "content_generation_brand_context_invalid"), subject: { analysisId: asText(subject.analysisId, "content_generation_analysis_id_invalid"), analysisVersion, analysisContractVersion: subject.analysisContractVersion, analysisResult, type: subject.type, sourceUrl: typeof subject.sourceUrl === "string" ? subject.sourceUrl : "", facts: subject.facts, research: asRecord(subject.research, "content_generation_research_invalid"), selectedImages }, message: { target, appeal, qualityBrief: asRecord(message.qualityBrief, "content_generation_quality_brief_invalid") }, creativeDirection: { prompts, brandColor, selectedColor, aspectRatio: asText(direction.aspectRatio, "content_generation_aspect_ratio_invalid"), outputCount, ...(orchestration ? { contentFamily: "marketing" as const, outputFormat: orchestration.outputFormat as "single_image" | "channel_text" } : {}) }, references: Array.isArray(input.references) ? input.references : [], attachments: parseAttachmentSnapshots(input.attachments) };
}
export interface MarketingClient { claim(workerId: string): Promise<MarketingJob | null>; heartbeat(jobId: string, workerId: string, token: string): Promise<void>; complete(jobId: string, body: Record<string, unknown>): Promise<void>; fail(jobId: string, body: Record<string, unknown>): Promise<void>; acquire(workerId: string): Promise<{ id: string; leaseToken: string } | null>; heartbeatResource(id: string, workerId: string, token: string): Promise<void>; releaseResource(id: string, workerId: string, token: string): Promise<void>; }
export interface MarketingDimensions { width: number; height: number; }
export interface LocalMarketingContent {
  headline: string;
  body: string;
  cta: string;
  concept: string;
}
interface LocalMarketingResultBase {
  content: LocalMarketingContent;
  title: string;
  family?: "marketing";
  strategy?: WorkerContentOrchestrationV1["strategy"];
}
export interface LocalMarketingImageResult extends LocalMarketingResultBase {
  outputFormat: "single_image";
  creative: Buffer;
  dimensions: MarketingDimensions;
}
export interface LocalMarketingTextResult extends LocalMarketingResultBase {
  outputFormat: "channel_text";
  text: string;
}
export type LocalMarketingResult = LocalMarketingImageResult | LocalMarketingTextResult;
export type MarketingGenerationInput = ContentGenerationInputV2 | ContentGenerationInputV3;

export interface MarketingPlanV2 {
  contractVersion: "marketing-plan.v2";
  outputFormat: "reel" | "marketing_content";
  content: { caption: string; hashtags: string[]; cta: string };
  imagePackage: ImageGenerationPackageV1;
}

export function parseMarketingInput(value: unknown, legacyWorkerType: unknown): MarketingGenerationInput {
  if (legacyWorkerType !== "marketing") throw new Error("content_generation_input_type_invalid");
  const source = asRecord(value, "content_generation_input_invalid");
  if (source.contractVersion !== "content-generation-input.v3") return parseContentGenerationInput(value);
  const input = parseContentGenerationInputV3(value);
  if (input.outputSettings.outputFormat !== "reel" && input.outputSettings.outputFormat !== "marketing_content") {
    throw new Error("content_generation_input_type_invalid");
  }
  return input;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!source || Object.keys(source).length !== keys.length || Object.keys(source).some((key) => !keys.includes(key))) {
    throw new Error("marketing_plan_invalid");
  }
  return source;
}

function requiredText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("marketing_plan_invalid");
  return value.trim();
}

function planMismatch(detail: string): never {
  throw new Error(`marketing_plan_invalid:${detail}`);
}

function validateAssetEvidenceIds(value: unknown, allowedEvidenceIds: Set<string>): void {
  const asset = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!asset || !Array.isArray(asset.evidenceIds) || asset.evidenceIds.length > 8
    || asset.evidenceIds.some((id) => typeof id !== "string" || !UUID.test(id))) {
    planMismatch("evidence_ids_malformed");
  }
  if (new Set(asset.evidenceIds).size !== asset.evidenceIds.length) planMismatch("evidence_id_duplicate");
  if (asset.evidenceIds.some((id) => !allowedEvidenceIds.has(id as string))) planMismatch("evidence_id_unknown");
}

export function parseMarketingPlanV2(value: unknown, input: ContentGenerationInputV3): MarketingPlanV2 {
  try {
    const source = exactObject(value, ["contractVersion", "outputFormat", "content", "imagePackage"]);
    if (source.contractVersion !== "marketing-plan.v2") throw new Error();
    if (source.outputFormat !== "reel" && source.outputFormat !== "marketing_content") planMismatch("output_format_mismatch");
    if (source.outputFormat !== input.outputSettings.outputFormat) planMismatch("output_format_mismatch");
    const contentSource = exactObject(source.content, ["caption", "hashtags", "cta"]);
    if (!Array.isArray(contentSource.hashtags) || contentSource.hashtags.length > 30) throw new Error();
    const hashtags = contentSource.hashtags.map((item) => requiredText(item, 100));
    if (new Set(hashtags).size !== hashtags.length) throw new Error();

    const rawPackage = exactObject(source.imagePackage, ["contractVersion", "generationId", "outputFormat", "purpose", "assetCount", "aspectRatio", "channelTargets", "assets", "product", "references", "brandStyleImages", "avatarStyleImageId", "attachments", "userImageInstruction", "logoPolicy"]);
    if (rawPackage.outputFormat !== source.outputFormat) planMismatch("output_format_mismatch");
    if (input.selectedProposal.assetCount === null || rawPackage.assetCount !== input.selectedProposal.assetCount) {
      planMismatch("asset_count_mismatch");
    }
    if (!Array.isArray(rawPackage.assets) || rawPackage.assets.length !== input.selectedProposal.outline.length) {
      planMismatch("asset_count_mismatch");
    }
    const allowedEvidenceIds = new Set(input.researchEvidence.items.map((item) => item.id));
    rawPackage.assets.forEach((value, offset) => {
      const asset = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
      const locked = input.selectedProposal.outline[offset];
      if (!asset || !locked || asset.index !== locked.index) planMismatch("asset_index_mismatch");
      if (asset.role !== locked.role) planMismatch("asset_role_mismatch");
      validateAssetEvidenceIds(value, allowedEvidenceIds);
    });
    const logoPolicy = rawPackage.logoPolicy && typeof rawPackage.logoPolicy === "object" && !Array.isArray(rawPackage.logoPolicy)
      ? rawPackage.logoPolicy as Record<string, unknown>
      : null;
    if (!logoPolicy
      || logoPolicy.allowGeneratedLogo !== false
      || logoPolicy.allowReservedLogoArea !== false
      || logoPolicy.allowExternalReferenceLogo !== false
      || logoPolicy.allowExistingProductPackagingLogo !== true) {
      planMismatch("logo_policy_mismatch");
    }

    const imagePackage = parseImageGenerationPackageV1(rawPackage);
    if (imagePackage.generationId !== input.generationId
      || imagePackage.outputFormat !== input.outputSettings.outputFormat
      || imagePackage.purpose !== input.outputSettings.purpose
      || imagePackage.assetCount !== input.selectedProposal.assetCount
      || imagePackage.aspectRatio !== input.outputSettings.aspectRatio
      || !isDeepStrictEqual(imagePackage.channelTargets, input.outputSettings.channelTargets)
      || !isDeepStrictEqual(imagePackage.product, input.product)
      || !isDeepStrictEqual(imagePackage.references, input.references.selected)
      || !isDeepStrictEqual(imagePackage.brandStyleImages, input.references.brandStyleImages)
      || imagePackage.avatarStyleImageId !== input.references.avatarStyleImageId
      || !isDeepStrictEqual(imagePackage.attachments, input.references.attachments)
      || imagePackage.userImageInstruction !== input.userImageInstruction
      || imagePackage.assets.some((asset, offset) => {
        const locked = input.selectedProposal.outline[offset];
        return !locked || asset.index !== locked.index || asset.role !== locked.role;
      })) {
      planMismatch("fixed_input_mismatch");
    }
    return {
      contractVersion: "marketing-plan.v2",
      outputFormat: source.outputFormat,
      content: { caption: requiredText(contentSource.caption, 20_000), hashtags, cta: requiredText(contentSource.cta, 2_000) },
      imagePackage,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("marketing_plan_invalid:")) throw error;
    throw new Error("marketing_plan_invalid");
  }
}

export async function loadMarketingPlanV2(outputDir: string, input: ContentGenerationInputV3): Promise<MarketingPlanV2> {
  const value = JSON.parse(await readFile(path.join(outputDir, "marketing-plan.json"), "utf8"));
  return parseMarketingPlanV2(value, input);
}

import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseAttachmentSnapshots,
  parseContentGenerationInputV3,
  parseImageGenerationPackageV1,
  parseWorkerContentOrchestration,
  type AiContentAttachmentSnapshot,
  type ContentGenerationInputV3,
  type ImageGenerationPackageV1,
  type WorkerContentOrchestrationV1,
} from "@brand-pilot/worker-runtime";
