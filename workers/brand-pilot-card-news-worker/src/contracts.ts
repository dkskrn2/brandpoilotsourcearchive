export interface AiContentJob {
  id: string;
  generationId: string;
  outputId: string | null;
  workspaceId: string;
  brandId: string;
  jobType: "analyze" | "generate";
  contentType: "card_news";
  status: "processing";
  payload: Record<string, unknown>;
  leaseToken: string;
}

export type CardNewsAspectRatio = "1:1" | "4:5" | "16:9" | "9:16";

export interface ContentGenerationInputV2 {
  contractVersion: "content-generation-input.v2";
  contentType: "card_news";
  brandContext: Record<string, unknown>;
  subject: {
    analysisId: string;
    analysisVersion: number;
    analysisContractVersion: "subject-analysis.v1" | "subject-analysis.v2";
    analysisResult: Record<string, unknown> | null;
    type: "product" | "service";
    sourceUrl: string;
    facts: unknown[];
    research: Record<string, unknown>;
    selectedImages: Array<{ id: string; url: string; role: string; altText: string }>;
  };
  message: { target: Record<string, unknown>; appeal: Record<string, unknown>; qualityBrief: Record<string, unknown> };
  creativeDirection: { prompts: string[]; brandColor: string; selectedColor: string; aspectRatio: CardNewsAspectRatio; outputCount: 1 | 2 | 3 };
  references: unknown[];
  attachments: unknown[];
}

const asRecord = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
};
const asText = (value: unknown, code: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value;
};
const asAspectRatio = (value: unknown): CardNewsAspectRatio => {
  if (value !== "1:1" && value !== "4:5" && value !== "16:9" && value !== "9:16") {
    throw new Error("content_generation_aspect_ratio_invalid");
  }
  return value;
};

export function parseContentGenerationInput(value: unknown): ContentGenerationInputV2 {
  const input = asRecord(value, "content_generation_input_invalid");
  if (input.contractVersion !== "content-generation-input.v2") throw new Error("content_generation_input_version_invalid");
  if (input.contentType !== "card_news") throw new Error("content_generation_input_type_invalid");
  const subject = asRecord(input.subject, "content_generation_subject_invalid");
  const message = asRecord(input.message, "content_generation_message_invalid");
  const direction = asRecord(input.creativeDirection, "content_generation_direction_invalid");
  if (!Array.isArray(subject.facts)) throw new Error("content_generation_facts_invalid");
  if (!Array.isArray(subject.selectedImages)) throw new Error("content_generation_images_invalid");
  const analysisVersion = Number(subject.analysisVersion);
  if (!Number.isInteger(analysisVersion) || analysisVersion < 1) throw new Error("content_generation_analysis_version_invalid");
  if (subject.analysisContractVersion !== "subject-analysis.v1" && subject.analysisContractVersion !== "subject-analysis.v2") throw new Error("content_generation_analysis_contract_invalid");
  if (subject.type !== "product" && subject.type !== "service") throw new Error("content_generation_subject_type_invalid");
  const analysisResult = subject.analysisResult === null
    ? null
    : asRecord(subject.analysisResult, "content_generation_analysis_result_invalid");
  if (subject.analysisContractVersion === "subject-analysis.v2" && !analysisResult) throw new Error("content_generation_analysis_result_invalid");
  const selectedImages = subject.selectedImages.map((value) => {
    const image = asRecord(value, "content_generation_image_invalid");
    return { id: asText(image.id, "content_generation_image_id_invalid"), url: asText(image.url, "content_generation_image_url_invalid"), role: asText(image.role, "content_generation_image_role_invalid"), altText: typeof image.altText === "string" ? image.altText : "" };
  });
  const outputCount = direction.outputCount;
  if (outputCount !== 1 && outputCount !== 2 && outputCount !== 3) throw new Error("content_generation_output_count_invalid");
  if (!Array.isArray(direction.prompts)) throw new Error("content_generation_prompts_invalid");
  const prompts = direction.prompts.map((value) => asText(value, "content_generation_prompt_invalid"));
  if (prompts.length !== outputCount) throw new Error("content_generation_prompts_count_mismatch");
  const target = asRecord(message.target, "content_generation_target_invalid");
  const appeal = asRecord(message.appeal, "content_generation_appeal_invalid");
  const targetId = asText(target.id, "content_generation_target_id_invalid");
  asText(appeal.id, "content_generation_appeal_id_invalid");
  const appealTargetId = asText(appeal.targetId, "content_generation_appeal_target_id_invalid");
  if (appealTargetId !== targetId) throw new Error("content_generation_appeal_target_mismatch");
  const selectedColor = asText(direction.selectedColor, "content_generation_selected_color_invalid");
  const brandColor = typeof direction.brandColor === "string" && direction.brandColor.trim()
    ? direction.brandColor
    : selectedColor;
  return {
    contractVersion: "content-generation-input.v2", contentType: "card_news",
    brandContext: asRecord(input.brandContext, "content_generation_brand_context_invalid"),
    subject: {
      analysisId: asText(subject.analysisId, "content_generation_analysis_id_invalid"),
      analysisVersion,
      analysisContractVersion: subject.analysisContractVersion,
      analysisResult,
      type: subject.type,
      sourceUrl: typeof subject.sourceUrl === "string" ? subject.sourceUrl : "",
      facts: subject.facts,
      research: asRecord(subject.research, "content_generation_research_invalid"),
      selectedImages,
    },
    message: { target, appeal, qualityBrief: asRecord(message.qualityBrief, "content_generation_quality_brief_invalid") },
    creativeDirection: { prompts, brandColor, selectedColor, aspectRatio: asAspectRatio(direction.aspectRatio), outputCount },
    references: Array.isArray(input.references) ? input.references : [], attachments: Array.isArray(input.attachments) ? input.attachments : [],
  };
}

export interface CardNewsAsset {
  role: "slide";
  fileName: string;
  mimeType: "image/png";
  width: number;
  height: number;
  index: number;
  bytes: Buffer;
}

export interface CardNewsManifest {
  version: "ai-content.v1";
  type: "card_news";
  title: string;
  assets: Array<Omit<CardNewsAsset, "bytes"> & { url: string }>;
  content: { caption: string; hashtags: string[]; cta: string };
}

export interface LocalCardNewsResult {
  manifest: Omit<CardNewsManifest, "assets"> & { assets: Array<Omit<CardNewsAsset, "bytes">> };
  assets: CardNewsAsset[];
}

export interface WorkerClient {
  claim(workerId: string): Promise<AiContentJob | null>;
  heartbeat(jobId: string, workerId: string, leaseToken: string): Promise<void>;
  complete(jobId: string, body: Record<string, unknown>): Promise<void>;
  fail(jobId: string, body: Record<string, unknown>): Promise<void>;
  acquire(workerId: string): Promise<{ id: string; leaseToken: string } | null>;
  heartbeatResource(id: string, workerId: string, leaseToken: string): Promise<void>;
  releaseResource(id: string, workerId: string, leaseToken: string): Promise<void>;
}
