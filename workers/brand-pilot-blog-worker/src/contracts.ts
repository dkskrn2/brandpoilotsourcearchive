export interface BlogJob { id: string; generationId: string; outputId: string | null; workspaceId: string; brandId: string; jobType: "analyze" | "generate"; contentType: "blog"; status: "processing"; payload: Record<string, unknown>; leaseToken: string; }
export interface ContentGenerationInputV2 {
  contractVersion: "content-generation-input.v2"; contentType: "blog"; brandContext: Record<string, unknown>;
  subject: { facts: unknown[]; research: Record<string, unknown>; selectedImages: Array<{ id: string; url: string; role: string; altText: string }> };
  message: { target: Record<string, unknown>; appeal: Record<string, unknown>; qualityBrief: Record<string, unknown> };
  creativeDirection: { prompts: string[]; brandColor: string; selectedColor: string; aspectRatio: string; outputCount: 1 | 2 | 3 };
  references: unknown[]; attachments: unknown[];
}
const asRecord = (value: unknown, code: string): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code); return value as Record<string, unknown>; };
const asText = (value: unknown, code: string): string => { if (typeof value !== "string" || !value.trim()) throw new Error(code); return value; };
export function parseContentGenerationInput(value: unknown): ContentGenerationInputV2 {
  const input = asRecord(value, "content_generation_input_invalid");
  if (input.contractVersion !== "content-generation-input.v2") throw new Error("content_generation_input_version_invalid");
  if (input.contentType !== "blog") throw new Error("content_generation_input_type_invalid");
  const subject = asRecord(input.subject, "content_generation_subject_invalid"); const message = asRecord(input.message, "content_generation_message_invalid"); const direction = asRecord(input.creativeDirection, "content_generation_direction_invalid");
  if (!Array.isArray(subject.facts)) throw new Error("content_generation_facts_invalid"); if (!Array.isArray(subject.selectedImages)) throw new Error("content_generation_images_invalid");
  const selectedImages = subject.selectedImages.map((value) => { const image = asRecord(value, "content_generation_image_invalid"); return { id: asText(image.id, "content_generation_image_id_invalid"), url: asText(image.url, "content_generation_image_url_invalid"), role: asText(image.role, "content_generation_image_role_invalid"), altText: typeof image.altText === "string" ? image.altText : "" }; });
  const outputCount = direction.outputCount; if (outputCount !== 1 && outputCount !== 2 && outputCount !== 3) throw new Error("content_generation_output_count_invalid");
  if (!Array.isArray(direction.prompts)) throw new Error("content_generation_prompts_invalid"); const prompts = direction.prompts.map((value) => asText(value, "content_generation_prompt_invalid")); if (prompts.length !== outputCount) throw new Error("content_generation_prompts_count_mismatch");
  const target = asRecord(message.target, "content_generation_target_invalid"); const appeal = asRecord(message.appeal, "content_generation_appeal_invalid"); const targetId = asText(target.id, "content_generation_target_id_invalid"); asText(appeal.id, "content_generation_appeal_id_invalid"); const appealTargetId = asText(appeal.targetId, "content_generation_appeal_target_id_invalid"); if (appealTargetId !== targetId) throw new Error("content_generation_appeal_target_mismatch");
  return { contractVersion: "content-generation-input.v2", contentType: "blog", brandContext: asRecord(input.brandContext, "content_generation_brand_context_invalid"), subject: { facts: subject.facts, research: asRecord(subject.research, "content_generation_research_invalid"), selectedImages }, message: { target, appeal, qualityBrief: asRecord(message.qualityBrief, "content_generation_quality_brief_invalid") }, creativeDirection: { prompts, brandColor: asText(direction.brandColor, "content_generation_brand_color_invalid"), selectedColor: asText(direction.selectedColor, "content_generation_selected_color_invalid"), aspectRatio: asText(direction.aspectRatio, "content_generation_aspect_ratio_invalid"), outputCount }, references: Array.isArray(input.references) ? input.references : [], attachments: Array.isArray(input.attachments) ? input.attachments : [] };
}
export interface BlogClient { claim(workerId: string): Promise<BlogJob | null>; heartbeat(jobId: string, workerId: string, token: string): Promise<void>; complete(jobId: string, body: Record<string, unknown>): Promise<void>; fail(jobId: string, body: Record<string, unknown>): Promise<void>; acquire(workerId: string): Promise<{ id: string; leaseToken: string } | null>; heartbeatResource(id: string, workerId: string, token: string): Promise<void>; releaseResource(id: string, workerId: string, token: string): Promise<void>; }
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
