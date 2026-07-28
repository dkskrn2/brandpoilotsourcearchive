import type {
  AiContentType,
  ContentChannelTarget,
  ContentOrchestrationV1,
  OutputFormat,
} from "./aiContentContracts.js";

const informationalStrategies = new Set([
  "problem_solution",
  "how_to",
  "comparison",
  "faq",
  "insight",
]);
const marketingStrategies = new Set([
  "benefit",
  "social_proof",
  "brand_story",
  "cta",
]);
const informationalFormats = new Set(["card_news", "blog"]);
const marketingFormats = new Set(["single_image", "channel_text"]);
const channelTargets = new Set([
  "instagram",
  "threads",
  "x",
  "linkedin",
  "youtube",
  "tiktok",
  "blog_export",
]);
const referenceRoles = new Set([
  "planning",
  "copy_pattern",
  "visual_composition",
]);

function invalid(): never {
  throw new Error("content_orchestration_invalid");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export interface ContentGenerationStartCapability {
  channel: Exclude<ContentChannelTarget, "blog_export">;
  generationFormats: readonly OutputFormat[];
  exportModes: readonly ("image" | "html" | "text")[];
  publishModes: readonly string[];
}

export function parseContentOrchestrationV1(value: unknown): ContentOrchestrationV1 {
  const source = record(value);
  if (source.contractVersion !== "content-orchestration.v1") invalid();
  const familyMatches = source.contentFamily === "informational"
    ? informationalStrategies.has(String(source.strategy))
      && informationalFormats.has(String(source.outputFormat))
    : source.contentFamily === "marketing"
      && marketingStrategies.has(String(source.strategy))
      && marketingFormats.has(String(source.outputFormat));
  if (!familyMatches) throw new Error("content_orchestration_combination_invalid");
  const subject = record(source.subject);
  if (
    subject.mode === "brand_topic"
      ? !nonempty(subject.topic)
        || !Array.isArray(subject.wikiItemIds)
        || subject.wikiItemIds.some((item) => !nonempty(item))
      : subject.mode === "product_service"
        ? !nonempty(subject.productServiceId)
        : subject.mode === "new_subject"
          ? !nonempty(subject.subjectAnalysisId)
          : true
  ) invalid();
  const target = record(source.target);
  if (
    target.id !== null && !nonempty(target.id)
    || !target.snapshot || typeof target.snapshot !== "object"
    || Array.isArray(target.snapshot)
  ) invalid();
  if (!source.brief || typeof source.brief !== "object" || Array.isArray(source.brief)) {
    invalid();
  }
  if (
    !Array.isArray(source.channelTargets)
    || source.channelTargets.length === 0
    || source.channelTargets.some((item) => !channelTargets.has(String(item)))
  ) invalid();
  if (!Array.isArray(source.references)) invalid();
  if (source.references.length > 5) {
    throw new Error("content_orchestration_reference_limit_exceeded");
  }
  for (const value of source.references) {
    const reference = record(value);
    if (
      !nonempty(reference.referenceItemId)
      || !Array.isArray(reference.roles)
      || reference.roles.length === 0
      || reference.roles.some((role) => !referenceRoles.has(String(role)))
    ) invalid();
  }
  if (Array.isArray(source.avatar)) {
    throw new Error("content_orchestration_avatar_invalid");
  }
  if (source.avatar !== null) {
    const avatar = record(source.avatar);
    if (
      avatar.mode !== "library" && avatar.mode !== "one_time"
      || !nonempty(avatar.id)
      || !avatar.snapshot || typeof avatar.snapshot !== "object"
      || Array.isArray(avatar.snapshot)
    ) invalid();
  }
  return JSON.parse(JSON.stringify(value)) as ContentOrchestrationV1;
}

export function mapOrchestrationToWorkerType(
  input: Pick<ContentOrchestrationV1, "contentFamily" | "outputFormat">,
): AiContentType {
  if (input.outputFormat === "card_news") return "card_news";
  if (input.outputFormat === "blog") return "blog";
  return "marketing";
}

export function assertContentGenerationStartAllowed(
  input: Pick<ContentOrchestrationV1, "outputFormat" | "channelTargets">,
  capabilities: readonly ContentGenerationStartCapability[],
): void {
  const requiredExportMode = input.outputFormat === "blog"
    ? "html"
    : input.outputFormat === "channel_text"
      ? "text"
      : "image";
  for (const channel of input.channelTargets) {
    if (channel === "youtube" || channel === "tiktok") {
      throw new Error("content_orchestration_channel_unsupported");
    }
    if (channel === "blog_export") {
      if (input.outputFormat !== "blog") {
        throw new Error("content_orchestration_channel_capability_mismatch");
      }
      continue;
    }
    const capability = capabilities.find((item) => item.channel === channel);
    if (
      !capability
      || (
        !capability.generationFormats.includes(input.outputFormat)
        && !capability.exportModes.includes(requiredExportMode)
      )
    ) {
      throw new Error("content_orchestration_channel_capability_mismatch");
    }
  }
}
