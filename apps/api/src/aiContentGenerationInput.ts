import type {
  AiContentAttachmentRecord,
  AiContentBrandContextRecord,
  AiContentGenerationRecord,
  AiContentReferenceRecord,
} from "./aiContentRepository.js";
import type { AiContentType } from "./aiContentContracts.js";
import type { SubjectAnalysisRecord, SubjectBrandScope } from "./aiContentSubjectRepository.js";
import type { SubjectTarget, SubjectAppeal } from "./aiContentSubjectContracts.js";

export interface ContentGenerationInputV2 {
  contractVersion: "content-generation-input.v2";
  contentType: AiContentType;
  brandContext: AiContentBrandContextRecord;
  subject: {
    analysisId: string;
    analysisVersion: number;
    type: "product" | "service";
    sourceUrl: string;
    facts: unknown[];
    research: Record<string, unknown>;
    selectedImages: Array<{ id: string; url: string; role: string; altText: string }>;
  };
  message: {
    target: SubjectTarget;
    appeal: SubjectAppeal;
    qualityBrief: Record<string, unknown>;
  };
  creativeDirection: {
    prompts: string[];
    brandColor: string;
    selectedColor: string;
    aspectRatio: string;
    outputCount: 1 | 2 | 3;
  };
  references: AiContentReferenceRecord[];
  attachments: AiContentAttachmentRecord[];
}

export interface ContentGenerationInputDependencies {
  getBrandContext(input: SubjectBrandScope): Promise<AiContentBrandContextRecord>;
  getSubjectAnalysis(input: SubjectBrandScope & { analysisId: string }): Promise<SubjectAnalysisRecord | null>;
  getReferences(input: SubjectBrandScope & { generationId: string; referenceIds: string[]; type: AiContentType }): Promise<AiContentReferenceRecord[]>;
  getAttachments(input: SubjectBrandScope & { generationId: string }): Promise<AiContentAttachmentRecord[]>;
}

export interface ContentGenerationInputGeneration extends Pick<AiContentGenerationRecord, "id" | "workspaceId" | "brandId" | "type" | "draft"> {
  subjectAnalysisSnapshot?: unknown;
}

export interface BuildContentGenerationInputOptions {
  outputCount?: 1 | 2 | 3;
  existingSnapshot?: unknown;
}

function fail(code: string): never {
  throw new Error(code);
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function text(value: unknown, code: string, allowEmpty = false): string {
  if (typeof value !== "string") fail(code);
  const normalized = value.trim();
  if (!allowEmpty && !normalized) fail(code);
  return normalized;
}

function outputCount(value: unknown): 1 | 2 | 3 {
  if (value !== 1 && value !== 2 && value !== 3) fail("ai_content_output_count_invalid");
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function target(value: unknown): SubjectTarget {
  const source = object(value, "ai_content_target_required");
  text(source.id, "ai_content_target_required");
  text(source.name, "ai_content_target_required");
  return clone(source as unknown as SubjectTarget);
}

function appeal(value: unknown): SubjectAppeal {
  const source = object(value, "ai_content_appeal_required");
  text(source.id, "ai_content_appeal_required");
  text(source.targetId, "ai_content_appeal_required");
  text(source.title, "ai_content_appeal_required");
  return clone(source as unknown as SubjectAppeal);
}

function draftObject(generation: ContentGenerationInputGeneration): Record<string, unknown> {
  return object(generation.draft, "ai_content_subject_analysis_required");
}

function selectedImageIds(draft: Record<string, unknown>, analysis: SubjectAnalysisRecord): string[] {
  const raw = Array.isArray(draft.selectedSubjectImageIds)
    ? draft.selectedSubjectImageIds
    : Array.isArray(draft.selectedAnalysisImageIds) ? draft.selectedAnalysisImageIds : [];
  const ids = raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim());
  if (!ids.length && analysis.selectedImageId) ids.push(analysis.selectedImageId);
  return [...new Set(ids)];
}

function qualityBrief(draft: Record<string, unknown>): Record<string, unknown> {
  return clone(object(draft.brief ?? draft.qualityBrief ?? {}, "ai_content_quality_brief_invalid"));
}

function promptsFromBrief(brief: Record<string, unknown>): string[] {
  const prompts: string[] = [];
  const directions = Array.isArray(brief.outputDirections) ? brief.outputDirections : [];
  prompts.push(...directions.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()));
  for (const key of ["purpose", "emphasis", "cta", "additionalInstruction"]) {
    if (typeof brief[key] === "string" && brief[key].trim()) prompts.push(brief[key].trim());
  }
  return [...new Set(prompts)];
}

function brandColor(context: AiContentBrandContextRecord): string {
  const brand = context.context.brand;
  const color = brand && typeof brand === "object" && !Array.isArray(brand)
    ? (brand as Record<string, unknown>).brandColor
    : null;
  return typeof color === "string" && color.trim() ? color.trim() : "";
}

export function parseContentGenerationInputV2(value: unknown): ContentGenerationInputV2 {
  const source = object(value, "ai_content_generation_input_invalid");
  if (source.contractVersion !== "content-generation-input.v2") fail("ai_content_generation_contract_version_invalid");
  if (source.contentType !== "card_news" && source.contentType !== "blog" && source.contentType !== "marketing") fail("ai_content_type_invalid");
  const subject = object(source.subject, "ai_content_subject_analysis_required");
  if (subject.type !== "product" && subject.type !== "service") fail("ai_content_subject_type_invalid");
  const message = object(source.message, "ai_content_target_required");
  const selectedTarget = target(message.target);
  const selectedAppeal = appeal(message.appeal);
  if (selectedAppeal.targetId !== selectedTarget.id) fail("ai_content_appeal_target_mismatch");
  const selectedImages = Array.isArray(subject.selectedImages) ? subject.selectedImages : fail("ai_content_subject_image_required");
  const direction = object(source.creativeDirection, "ai_content_quality_brief_invalid");
  const selectedColor = text(direction.selectedColor, "ai_content_selected_color_invalid");
  const brandColorValue = text(direction.brandColor, "ai_content_brand_color_invalid", true);
  const references = Array.isArray(source.references) ? source.references : fail("ai_content_references_invalid");
  const attachments = Array.isArray(source.attachments) ? source.attachments : fail("ai_content_attachments_invalid");
  return clone({
    contractVersion: "content-generation-input.v2",
    contentType: source.contentType,
    brandContext: object(source.brandContext, "ai_content_brand_context_invalid") as unknown as AiContentBrandContextRecord,
    subject: {
      analysisId: text(subject.analysisId, "ai_content_subject_analysis_required"),
      analysisVersion: Number(subject.analysisVersion),
      type: subject.type,
      sourceUrl: text(subject.sourceUrl, "ai_content_subject_source_required"),
      facts: subject.facts as unknown[],
      research: object(subject.research, "ai_content_subject_research_invalid"),
      selectedImages: selectedImages as ContentGenerationInputV2["subject"]["selectedImages"],
    },
    message: { target: selectedTarget, appeal: selectedAppeal, qualityBrief: object(message.qualityBrief, "ai_content_quality_brief_invalid") },
    creativeDirection: {
      prompts: Array.isArray(direction.prompts) ? direction.prompts as string[] : [],
      brandColor: brandColorValue,
      selectedColor,
      aspectRatio: text(direction.aspectRatio, "ai_content_aspect_ratio_invalid"),
      outputCount: outputCount(direction.outputCount),
    },
    references: references as AiContentReferenceRecord[],
    attachments: attachments as AiContentAttachmentRecord[],
  });
}

export async function buildContentGenerationInput(
  dependencies: ContentGenerationInputDependencies,
  generation: ContentGenerationInputGeneration,
  options: BuildContentGenerationInputOptions = {},
): Promise<ContentGenerationInputV2> {
  if (options.existingSnapshot !== undefined) return parseContentGenerationInputV2(options.existingSnapshot);
  if (generation.subjectAnalysisSnapshot !== undefined && generation.subjectAnalysisSnapshot !== null) {
    return parseContentGenerationInputV2(generation.subjectAnalysisSnapshot);
  }

  const draft = draftObject(generation);
  const analysisId = typeof draft.subjectAnalysisId === "string" ? draft.subjectAnalysisId.trim() : "";
  if (!analysisId) fail("ai_content_subject_analysis_required");
  const analysis = await dependencies.getSubjectAnalysis({ workspaceId: generation.workspaceId, brandId: generation.brandId, analysisId });
  if (!analysis) fail("ai_content_subject_analysis_required");
  if (analysis.status !== "ready" && analysis.status !== "partial") fail("ai_content_subject_analysis_not_ready");

  const selectedTarget = target(draft.selectedTarget);
  if (!analysis.targets.some((item) => item.id === selectedTarget.id)) fail("ai_content_target_required");
  const selectedAppeal = appeal(draft.selectedAppeal);
  if (selectedAppeal.targetId !== selectedTarget.id) fail("ai_content_appeal_target_mismatch");
  const availableAppeals = analysis.appealsByTarget[selectedTarget.id] ?? [];
  if (!availableAppeals.some((item) => item.id === selectedAppeal.id)) fail("ai_content_appeal_required");

  const requestedImageIds = selectedImageIds(draft, analysis);
  const images = analysis.images.filter((image) => requestedImageIds.includes(image.id));
  if (requestedImageIds.length !== images.length) fail("ai_content_subject_image_required");
  const brief = qualityBrief(draft);
  const attachments = await dependencies.getAttachments({ workspaceId: generation.workspaceId, brandId: generation.brandId, generationId: generation.id });
  const hasProductImage = images.some((image) => image.role === "product") || attachments.some((item) => item.role === "product");
  const hasServiceVisual = images.some((image) => image.role === "service") || attachments.some((item) => item.role === "product" || item.role === "visual_reference");
  if (analysis.subjectType === "product" && !hasProductImage) fail("ai_content_subject_image_required");
  if (analysis.subjectType === "service" && images.length === 0 && !hasServiceVisual) fail("ai_content_subject_image_required");

  const brandContext = await dependencies.getBrandContext({ workspaceId: generation.workspaceId, brandId: generation.brandId });
  const references = await dependencies.getReferences({
    workspaceId: generation.workspaceId,
    brandId: generation.brandId,
    generationId: generation.id,
    type: generation.type,
    referenceIds: Array.isArray(draft.referenceIds) ? draft.referenceIds.filter((value): value is string => typeof value === "string") : [],
  });
  const briefColor = typeof brief.selectedColor === "string" && brief.selectedColor.trim() ? brief.selectedColor.trim() : brandColor(brandContext);
  if (!briefColor) fail("ai_content_selected_color_invalid");
  const result: ContentGenerationInputV2 = {
    contractVersion: "content-generation-input.v2",
    contentType: generation.type,
    brandContext: clone(brandContext),
    subject: {
      analysisId: analysis.id,
      analysisVersion: analysis.analysisVersion,
      type: analysis.subjectType,
      sourceUrl: analysis.sourceUrl,
      facts: clone(analysis.facts),
      research: clone(analysis.research),
      selectedImages: images.map((image) => ({ id: image.id, url: image.storageUrl, role: image.role, altText: image.altText })),
    },
    message: { target: selectedTarget, appeal: selectedAppeal, qualityBrief: brief },
    creativeDirection: {
      prompts: promptsFromBrief(brief),
      brandColor: brandColor(brandContext),
      selectedColor: briefColor,
      aspectRatio: typeof brief.aspectRatio === "string" ? brief.aspectRatio : "1:1",
      outputCount: options.outputCount ?? outputCount(brief.outputCount ?? 1),
    },
    references: clone(references),
    attachments: clone(attachments),
  };
  return parseContentGenerationInputV2(result);
}
