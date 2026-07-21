import cors from "@fastify/cors";
import { randomUUID, timingSafeEqual } from "node:crypto";
import Fastify, { LogController, type FastifyReply } from "fastify";
import rawBody from "fastify-raw-body";
import type { FastifyLoggerOptions } from "fastify/types/logger";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { instagramFormats } from "./instagramFormats.js";
import { sanitizeInstagramCapabilityMetadata } from "./instagramCapabilities.js";
import { resolveInstagramConnection } from "./metaGraph.js";
import { buildFacebookLoginAuthorizeUrl, exchangeFacebookLoginCode, instagramTrendFacebookScopes } from "./facebookLoginGraph.js";
import { buildInstagramLoginAuthorizeUrl, exchangeInstagramLoginCode, instagramLoginScopes, resolveInstagramLoginConnection, subscribeInstagramMessagingWebhooks } from "./instagramLoginGraph.js";
import { parseInstagramMessagingEvents, verifyInstagramSignature } from "./instagramWebhook.js";
import { parseDmWorkerResult } from "./dmTypes.js";
import { normalizeInstagramHashtag } from "./instagramTrend.js";
import { StoryCapabilityRequiredError } from "./repository.js";
import type { ApiRepository, BrandProfileInput, Channel, DmAttentionType, DmConversationFilter, InstagramDeliveryFormat, InstagramFormatSettingsInput, InstagramTrendMediaTypeFilter, InstagramTrendPageDto, InstagramTrendSort, SourceType, SubjectAnalysisRepositoryV2, SupportRequestCategory, SupportRequestStatus } from "./types.js";
import { createKakaoAuthStore, type KakaoProfile } from "./kakaoAuth.js";
import { brandLogoRequestBodyLimit, type BrandLogoService } from "./brandLogo.js";
import { channelNames } from "./channelCatalog.js";
import {
  parseAttachmentUploadTokenInput,
  parseConfirmAttachmentInput,
  parseCreateAiContentAnalysisInput,
  parseStartAiContentGenerationInput,
  parseUpdateAiContentDraftInput,
  type AiContentType,
  type CompleteAiContentJobInput,
  type FailAiContentJobInput,
} from "./aiContentContracts.js";
import { parseAiContentManifest } from "./aiContentManifest.js";
import { parseAiContentPublishRequest } from "./aiContentPublishTargets.js";
import {
  confirmAiContentAttachment,
  issueAiContentAttachmentToken,
  verifyAiContentAttachmentBlob,
  type AiContentTokenOptions,
} from "./aiContentUpload.js";
import { kstDateKey } from "./publishSchedule.js";
import {
  parseCreateSubjectAnalysisInput,
  parseCreateSubjectPipelineInput,
  parseReanalyzeSubjectAnalysisInput,
  parseSubjectAnalysisResult,
  parseSubjectAnalysisResultV2,
  parseSubjectAppealResultV2,
  parseSubjectAnalysisSelectionInput,
  parseSubjectWorkerClaimInput,
  parseSubjectWorkerLeaseInput,
} from "./aiContentSubjectContracts.js";
import { claimAndPrepareSubjectAnalysis, type AiContentSubjectRuntime } from "./aiContentSubjectHttp.js";
import type { SubjectAnalysisRecord, SubjectAnalysisRepository } from "./aiContentSubjectRepository.js";
import {
  parseCreateBrandAnalysisInput,
  parseEditBrandAnalysisInput,
  parseBrandAnalysisWorkerClaimInput,
  parseBrandAnalysisWorkerLeaseInput,
  parseBrandIntelligenceResult,
} from "./brandIntelligenceContracts.js";
import type { BrandIntelligenceRepository } from "./brandIntelligenceRepository.js";
import {
  issueBrandAnalysisUploadToken,
  verifyBrandAnalysisUpload,
} from "./brandAnalysisUpload.js";
import { claimAndPrepareBrandAnalysis, type BrandIntelligenceRuntime } from "./brandIntelligenceHttp.js";

const channels = new Set<string>(channelNames);
const sourceTypes = new Set(["owned", "reference"]);
const supportRequestCategories = new Set(["bug", "feature", "channel", "account", "other"]);
const supportRequestStatuses = new Set(["new", "in_progress", "resolved"]);
const topicRowStatuses = new Set(["uploaded", "queued", "used", "skipped", "invalid", "failed", "disabled"]);
const dmConversationFilters = new Set<DmConversationFilter>(["all", "attention", "complaint", "unanswered", "error"]);
const dmAttentionTypes = new Set<DmAttentionType>(["restricted_action", "complaint", "knowledge_gap", "delivery_unknown", "processing_error"]);
const instagramFormatSet = new Set<string>(instagramFormats);
const instagramTrendMediaTypes = new Set<InstagramTrendMediaTypeFilter>(["all", "reel", "video", "image", "carousel"]);
const instagramTrendSorts = new Set<InstagramTrendSort>(["meta", "likes", "comments"]);
const instagramTrendHttpErrors: Record<string, [number, string]> = {
  invalid_hashtag: [400, "invalid_hashtag"],
  instagram_connection_required: [409, "instagram_connection_required"],
  instagram_trend_connection_required: [409, "instagram_trend_connection_required"],
  instagram_trend_reconnect_required: [409, "instagram_trend_reconnect_required"],
  instagram_reconnect_required: [409, "instagram_reconnect_required"],
  instagram_permission_required: [409, "instagram_permission_required"],
  hashtag_search_limit_reached: [429, "hashtag_search_limit_reached"],
  instagram_trend_fetch_failed: [502, "instagram_trend_fetch_failed"],
  instagram_hashtag_not_found: [200, "instagram_hashtag_not_found"]
};
const defaultDevBrandId = "00000000-0000-4000-8000-000000000100";
const maxBrandProfileShortFieldLength = 30;
const kakaoStateCookiePrefix = "bp_kakao_state_";
const instagramLoginStateCookie = "bp_instagram_login_state";
const instagramTrendStateCookie = "bp_instagram_trend_state";
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const workerResourceWorkloads = new Set(["dm", "wiki", "content"]);
const contentTypeByWorkerSlug = {
  "card-news": "card_news",
  blog: "blog",
  marketing: "marketing",
} as const;

interface CreateServerOptions {
  repository: ApiRepository;
  workerApiToken?: string;
  cronSecret?: string;
  kakaoAuth?: ReturnType<typeof createKakaoAuthStore>;
  kakao?: { restApiKey: string; clientSecret?: string; redirectUri: string; frontendUrl: string };
  instagramLogin?: { appId: string; appSecret: string; redirectUri: string; frontendUrl: string };
  facebookLogin?: { appId: string; appSecret: string; redirectUri: string; frontendUrl: string };
  metaWebhook?: { appSecret: string; verifyToken: string };
  brandLogoService?: BrandLogoService;
  aiContentUpload?: {
    readWriteToken: string;
    generateClientToken?: AiContentTokenOptions["generateClientToken"];
    headBlob?: import("./aiContentUpload.js").AiContentBlobVerificationOptions["headBlob"];
  };
  aiContentLimits?: { dailyGenerationLimit: number; dailyDownloadLimit: number };
  subjectAnalysis?: AiContentSubjectRuntime;
  brandIntelligenceRepository?: BrandIntelligenceRepository;
  brandAnalysisUpload?: {
    readWriteToken: string;
    generateClientToken?: import("./brandAnalysisUpload.js").BrandAnalysisUploadTokenOptions["generateClientToken"];
    headBlob?: typeof import("@vercel/blob").head;
  };
  brandIntelligence?: BrandIntelligenceRuntime;
  logger?: boolean | FastifyLoggerOptions;
}

type AuthSession = Awaited<ReturnType<NonNullable<CreateServerOptions["kakaoAuth"]>["getSession"]>>;

function aiContentScope(request: FastifyRequest, brandId: string) {
  const session = (request as { aiContentSession?: AuthSession }).aiContentSession;
  const workspaceId = session?.workspaceId ?? process.env.BRAND_PILOT_DEV_WORKSPACE_ID;
  if (!workspaceId) throw new Error("authentication_required");
  return { workspaceId, brandId };
}

function positiveLimit(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function requiredAiContentField(value: unknown, code: string, maxLength = 500) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) throw new Error(code);
  return value.trim();
}

function asChannel(value: string): Channel {
  if (!channels.has(value)) {
    throw new Error("invalid_channel");
  }
  return value as Channel;
}

function asSourceType(value: unknown): SourceType | null {
  return typeof value === "string" && sourceTypes.has(value) ? (value as SourceType) : null;
}

function asSupportRequestCategory(value: unknown): SupportRequestCategory | null {
  return typeof value === "string" && supportRequestCategories.has(value) ? (value as SupportRequestCategory) : null;
}

function asSupportRequestStatus(value: unknown): SupportRequestStatus | null {
  return typeof value === "string" && supportRequestStatuses.has(value) ? (value as SupportRequestStatus) : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCustomerSubjectAnalysisInput(value: unknown) {
  if (isObject(value) && value.contractVersion === "subject-analysis.v2") {
    const { contractVersion: _contractVersion, ...pipelineInput } = value;
    return {
      contractVersion: "subject-analysis.v2" as const,
      input: parseCreateSubjectPipelineInput(pipelineInput),
    };
  }
  return {
    contractVersion: "subject-analysis.v1" as const,
    input: parseCreateSubjectAnalysisInput(value),
  };
}

function customerSubjectAnalysisResponse(analysis: SubjectAnalysisRecord) {
  if (analysis.contractVersion !== "subject-analysis.v2") return analysis;
  return {
    id: analysis.id,
    generationId: analysis.generationId,
    contractVersion: analysis.contractVersion,
    status: analysis.status,
    analysisVersion: analysis.analysisVersion,
    targets: analysis.targets,
    appealsByTarget: analysis.appealsByTarget,
    sourceGaps: analysis.sourceGaps,
  };
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function normalizeSupportContactPhone(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const digits = value.trim().replace(/[\s-]/g, "");
  if (!/^010\d{8}$/.test(digits)) return undefined;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function hasOverlongBrandProfileShortField(value: Record<string, unknown>) {
  return [value.primaryCustomer].some(
    (field) => typeof field === "string" && field.length > maxBrandProfileShortFieldLength
  );
}

function validateBrandProfileInput(value: Record<string, unknown>):
  | { input: BrandProfileInput; error?: never }
  | { input?: never; error: string } {
  if (Object.prototype.hasOwnProperty.call(value, "industry")) return { error: "industry_not_supported" };
  if (hasOverlongBrandProfileShortField(value)) return { error: "brand_profile_field_too_long" };
  const input: BrandProfileInput = {};
  for (const key of ["name", "primaryCustomer", "description", "tone", "defaultCta", "mainLink"] as const) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      if (typeof value[key] !== "string") return { error: "invalid_body" };
      input[key] = value[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "autoApprovalEnabled")) {
    if (typeof value.autoApprovalEnabled !== "boolean") return { error: "invalid_body" };
    input.autoApprovalEnabled = value.autoApprovalEnabled;
  }
  if (Object.prototype.hasOwnProperty.call(value, "primaryCategoryCode")) {
    if (value.primaryCategoryCode !== null && (typeof value.primaryCategoryCode !== "string" || !value.primaryCategoryCode.trim())) {
      return { error: "invalid_primary_category" };
    }
    input.primaryCategoryCode = value.primaryCategoryCode === null ? null : value.primaryCategoryCode.trim();
  }
  if (Object.prototype.hasOwnProperty.call(value, "subcategories")) {
    if (!Array.isArray(value.subcategories)) return { error: "invalid_subcategory" };
    input.subcategories = [];
    for (const item of value.subcategories) {
      if (!isObject(item)) return { error: "invalid_subcategory" };
      if (item.type === "system" && typeof item.code === "string" && item.code.trim()) {
        input.subcategories.push({ type: "system", code: item.code.trim() });
      } else if (item.type === "custom" && typeof item.name === "string") {
        input.subcategories.push({ type: "custom", name: item.name });
      } else {
        return { error: "invalid_subcategory" };
      }
    }
  }
  return { input };
}

function validateInstagramFormatSettings(value: unknown):
  | { input: InstagramFormatSettingsInput; error?: never }
  | { input?: never; error: string } {
  if (!isObject(value)) return { error: "invalid_body" };
  if (Object.prototype.hasOwnProperty.call(value, "rotationOrder")) {
    return { error: "instagram_rotation_order_read_only" };
  }

  const input: InstagramFormatSettingsInput = {};
  let hasEffectiveChange = false;
  if (Object.prototype.hasOwnProperty.call(value, "brandColor")) {
    if (value.brandColor !== null && typeof value.brandColor !== "string") {
      return { error: "invalid_brand_color" };
    }
    const brandColor = typeof value.brandColor === "string" ? value.brandColor.trim() || null : null;
    if (brandColor && brandColor.length > 30) return { error: "brand_color_too_long" };
    input.brandColor = brandColor;
    hasEffectiveChange = true;
  }

  if (Object.prototype.hasOwnProperty.call(value, "formats")) {
    if (!Array.isArray(value.formats)) return { error: "invalid_instagram_formats" };
    const seen = new Set<string>();
    const formats: NonNullable<InstagramFormatSettingsInput["formats"]> = [];
    for (const item of value.formats) {
      if (!isObject(item)) return { error: "invalid_instagram_formats" };
      if (Object.prototype.hasOwnProperty.call(item, "rotationOrder")) {
        return { error: "instagram_rotation_order_read_only" };
      }
      if (typeof item.format !== "string" || !instagramFormatSet.has(item.format)) {
        return { error: "invalid_instagram_format" };
      }
      if (typeof item.enabled !== "boolean") return { error: "invalid_instagram_formats" };
      if (seen.has(item.format)) return { error: "duplicate_instagram_format" };
      seen.add(item.format);
      formats.push({ format: item.format as InstagramDeliveryFormat, enabled: item.enabled });
    }
    if (formats.length > 0) {
      input.formats = formats;
      hasEffectiveChange = true;
    }
  }

  return hasEffectiveChange ? { input } : { error: "instagram_formats_update_required" };
}

function tokenPreview(token: string) {
  if (token.length <= 10) {
    return `${token.slice(0, 2)}...${token.slice(-2)}`;
  }
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function expiresAtFromSeconds(value: unknown) {
  if (typeof value !== "string") return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function htmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readCookie(header: string | undefined, name: string) {
  return header?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

function cookie(name: string, value: string, maxAge: number, secure = false, sameSite: "Lax" | "None" = "Lax") {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function sessionCookie(value: string, maxAge: number) {
  const secure = process.env.VERCEL === "1";
  return cookie("bp_session", value, maxAge, secure, secure ? "None" : "Lax");
}

function kakaoStateCookieName(state: string) {
  return uuidPattern.test(state) ? `${kakaoStateCookiePrefix}${state}` : null;
}

function hasRequiredTopicHeaders(csvText: string) {
  const headerLine = csvText.split(/\r?\n/).find((line) => line.trim().length > 0);
  if (!headerLine) return false;
  const headers = headerLine.split(",").map((header) => header.trim());
  return headers.includes("topic_title") && headers.includes("topic_angle");
}

function isSourceDuplicateError(error: unknown) {
  return isObject(error) &&
    error.code === "23505" &&
    error.constraint === "source_urls_brand_type_hash_active_unique";
}

function isOwnedSourceLimitError(error: unknown) {
  return isObject(error) &&
    error.code === "23505" &&
    error.constraint === "source_urls_brand_owned_single_active_unique";
}

function safeInternalErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  const match = /^([a-z][a-z0-9_]*)/.exec(message);
  return match?.[1] ?? "unclassified_error";
}

function requiredHashtag(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function emptyInstagramTrendPage(hashtag: string, page = 1): InstagramTrendPageDto {
  const normalized = normalizeInstagramHashtag(hashtag);
  return {
    hashtag: { id: "", displayTag: normalized.displayTag, normalizedTag: normalized.normalizedTag },
    source: "meta",
    refreshed: false,
    refreshedAt: null,
    lastErrorCode: "instagram_hashtag_not_found",
    page,
    pageSize: 20,
    total: 0,
    items: []
  };
}

async function instagramTrendResponse<T>(
  reply: FastifyReply,
  operation: () => Promise<T>,
  hashtag?: string,
  page = 1
): Promise<T | InstagramTrendPageDto | { error: string }> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message === "instagram_hashtag_not_found" && hashtag) {
      return emptyInstagramTrendPage(hashtag, page);
    }
    const mapped = instagramTrendHttpErrors[message];
    if (!mapped || message === "instagram_hashtag_not_found") throw error;
    reply.code(mapped[0]);
    return { error: mapped[1] };
  }
}

function matchesBearerSecret(header: string | undefined, secret: string | undefined) {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const candidate = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function createFastifyOptions(logger?: boolean | FastifyLoggerOptions) {
  return {
    logger: logger ?? process.env.NODE_ENV !== "test",
    logController: new LogController({ disableRequestLogging: true })
  };
}

export function createServer(
  { repository, workerApiToken, cronSecret, kakaoAuth, kakao, instagramLogin, facebookLogin, metaWebhook, brandLogoService, aiContentUpload, aiContentLimits, subjectAnalysis, brandIntelligenceRepository, brandAnalysisUpload, brandIntelligence, logger }: CreateServerOptions,
  app: FastifyInstance = Fastify(createFastifyOptions(logger))
) {
  const subjectRepository = repository as ApiRepository & SubjectAnalysisRepository & SubjectAnalysisRepositoryV2;
  void app.register(cors, { origin: true, credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] });

  app.setErrorHandler((error, request, reply) => {
    const message = error instanceof Error ? error.message : "unknown_error";
    if ((error as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      const errorCode = request.routeOptions.url === "/brands/:brandId/logo"
        ? "brand_logo_request_too_large"
        : "request_body_too_large";
      reply.code(413).send({ error: errorCode });
      return;
    }
    if (message === "invalid_channel") {
      reply.code(400).send({ error: "invalid_channel" });
      return;
    }
    if (message.endsWith("_not_found")) {
      reply.code(404).send({ error: message });
      return;
    }
    if (message === "topic_upload_invalid_csv" || message === "faq_upload_invalid_file" || message === "knowledge_upload_invalid_file") {
      reply.code(400).send({ error: message });
      return;
    }
    if (message === "source_update_required") {
      reply.code(400).send({ error: message });
      return;
    }
    if (message === "source_url_invalid") {
      reply.code(400).send({ error: message });
      return;
    }
    if (message === "source_reference_limit_exceeded") {
      reply.code(400).send({ error: message });
      return;
    }
    if (message === "source_owned_limit_exceeded" || isOwnedSourceLimitError(error)) {
      reply.code(409).send({ error: "source_owned_limit_exceeded" });
      return;
    }
    if (message === "channel_authentication_required") {
      reply.code(409).send({ error: message });
      return;
    }
    if (message === "dm_cursor_invalid") {
      reply.code(400).send({ error: message });
      return;
    }
    if (message === "brand_color_too_long") {
      reply.code(400).send({ error: message });
      return;
    }
    if (message.startsWith("brand_analysis_") || message.startsWith("brand_intelligence_")
      || message === "scanned_pdf_not_supported") {
      const conflict = ["brand_analysis_not_review_ready", "brand_analysis_lease_invalid"].includes(message);
      const unavailable = message === "brand_analysis_storage_not_configured";
      reply.code(conflict ? 409 : unavailable ? 503 : 400).send({ error: message });
      return;
    }
    if ([
      "invalid_primary_category",
      "invalid_subcategory",
      "subcategory_category_mismatch",
      "too_many_subcategories",
      "duplicate_subcategory",
      "brand_subcategory_too_long"
    ].includes(message)) {
      reply.code(400).send({ error: message });
      return;
    }
    if (["brand_logo_invalid_file", "brand_logo_unsupported_type", "brand_logo_file_too_large"].includes(message)) {
      reply.code(400).send({ error: message });
      return;
    }
    if (message === "brand_logo_storage_not_configured") {
      reply.code(503).send({ error: message });
      return;
    }
    if (["brand_logo_storage_upload_failed", "brand_logo_storage_delete_failed"].includes(message)) {
      reply.code(502).send({ error: message });
      return;
    }
    if (message === "publish_artifact_manifest_unavailable") {
      reply.code(502).send({ error: message });
      return;
    }
    if (message === "content_output_artifact_not_ready") {
      reply.code(409).send({ error: message });
      return;
    }
    if (message === "content_output_not_found") {
      reply.code(404).send({ error: message });
      return;
    }
    if (message === "authentication_required") {
      reply.code(401).send({ error: message });
      return;
    }
    if (message.startsWith("subject_analysis_") || message.startsWith("subject_image_")) {
      const status = message === "subject_image_storage_not_configured"
        ? 503
        : message === "subject_analysis_lease_invalid" || message.endsWith("_conflict")
          ? 409
          : 400;
      reply.code(status).send({ error: message });
      return;
    }
    if (message.startsWith("ai_content_")) {
      if (message === "ai_content_limit_reached") {
        reply.code(429).send({ error: message });
      } else if (message === "ai_content_attachment_storage_not_configured") {
        reply.code(503).send({ error: message });
      } else if (
        message === "ai_content_generation_not_analysis_ready"
        || message === "ai_content_publish_target_unsupported"
        || message.endsWith("_conflict")
      ) {
        reply.code(409).send({ error: message });
      } else {
        reply.code(400).send({ error: message });
      }
      return;
    }
    if (message === "channel_oauth_not_connected" || message === "delivery_format_asset_mismatch") {
      reply.code(409).send({ error: message });
      return;
    }
    if (error instanceof StoryCapabilityRequiredError || message === "story_capability_required") {
      reply.code(409).send({ error: "story_capability_required" });
      return;
    }
    if (isSourceDuplicateError(error)) {
      reply.code(409).send({ error: "source_url_duplicate" });
      return;
    }
    request.log.error({
      event: "request_failed",
      errorCode: safeInternalErrorCode(error),
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url ?? request.url.split("?", 1)[0]
    }, "request_failed");
    reply.code(500).send({ error: "internal_error" });
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!kakaoAuth || request.url.startsWith("/health") || request.url.startsWith("/auth/") || request.url.startsWith("/admin/v1/") || request.url.startsWith("/webhooks/") || request.url.startsWith("/worker/") || request.url.startsWith("/workers/") || request.url.startsWith("/internal/cron/")) return;
    const token = readCookie(request.headers.cookie, "bp_session");
    const session = token ? await kakaoAuth.getSession(token) : null;
    if (!session) {
      reply.code(401).send({ error: "authentication_required" });
      return reply;
    }
    (request as typeof request & { aiContentSession?: AuthSession }).aiContentSession = session;
    const params = request.params as Record<string, string>;
    const brandId = params.brandId;
    const route = request.routeOptions.url;
    const permitted = brandId
      ? await kakaoAuth.canAccessBrand(session.userId, brandId)
      : params.sourceId
        ? await kakaoAuth.canAccessResource(session.userId, "source_urls", params.sourceId)
        : params.outputId
          ? await kakaoAuth.canAccessResource(session.userId, "content_outputs", params.outputId)
          : params.queueId
            ? await kakaoAuth.canAccessResource(session.userId, "publish_queue", params.queueId)
            : params.requestId
              ? await kakaoAuth.canAccessResource(session.userId, "support_requests", params.requestId)
            : params.attentionId
              ? await kakaoAuth.canAccessResource(session.userId, "dm_attention_items", params.attentionId)
            : route === "/health" || route === "/content-categories";
    if (!permitted) {
      reply.code(403).send({ error: "workspace_access_denied" });
      return reply;
    }
  });

  app.get("/health", async () => {
    const health = await repository.health();
    return { ok: true, database: health.database };
  });

  app.register(async (webhookApp) => {
    await webhookApp.register(rawBody, { field: "rawBody", global: false, encoding: false, runFirst: true });

    webhookApp.get<{
      Querystring: { "hub.mode"?: string; "hub.verify_token"?: string; "hub.challenge"?: string };
    }>("/webhooks/meta/instagram", async (request, reply) => {
      if (
        !metaWebhook?.verifyToken
        || request.query["hub.mode"] !== "subscribe"
        || request.query["hub.verify_token"] !== metaWebhook.verifyToken
        || !request.query["hub.challenge"]
      ) {
        reply.code(403);
        return { error: "webhook_verification_failed" };
      }
      reply.type("text/plain");
      return request.query["hub.challenge"];
    });

    webhookApp.post<{ Body: unknown }>("/webhooks/meta/instagram", { config: { rawBody: true } }, async (request, reply) => {
      if (!metaWebhook?.appSecret) {
        reply.code(503);
        return { error: "webhook_not_configured" };
      }
      const signature = Array.isArray(request.headers["x-hub-signature-256"])
        ? request.headers["x-hub-signature-256"][0]
        : request.headers["x-hub-signature-256"];
      const raw = request.rawBody;
      if (!Buffer.isBuffer(raw) || !verifyInstagramSignature(raw, signature, metaWebhook.appSecret)) {
        reply.code(403);
        return { error: "webhook_signature_invalid" };
      }
      const events = parseInstagramMessagingEvents(request.body);
      const outcomes: string[] = [];
      for (const event of events) {
        const result = await repository.receiveInstagramWebhookMessage(event);
        outcomes.push(result.status);
      }
      request.log.info({
        event: "instagram_webhook_processed",
        received: events.length,
        outcomes,
        recipientIds: [...new Set(events.map((event) => event.recipientId))],
      }, "instagram_webhook_processed");
      return { ok: true, received: events.length, outcomes };
    });
  });

  app.get("/internal/cron/source-crawl", async (request, reply) => {
    if (!matchesBearerSecret(request.headers.authorization, cronSecret)) {
      reply.code(401);
      return { error: "cron_unauthorized" };
    }
    return repository.crawlDueSources(new Date());
  });

  app.get("/internal/cron/daily-generation", async (request, reply) => {
    if (!matchesBearerSecret(request.headers.authorization, cronSecret)) {
      reply.code(401);
      return { error: "cron_unauthorized" };
    }
    return repository.runDailyGeneration(new Date());
  });

  app.get("/internal/cron/publish-due", async (request, reply) => {
    if (!matchesBearerSecret(request.headers.authorization, cronSecret)) {
      reply.code(401);
      return { error: "cron_unauthorized" };
    }
    return repository.runDuePublishing(new Date());
  });

  app.get("/auth/me", async (request, reply) => {
    if (!kakaoAuth) return { user: null };
    const token = readCookie(request.headers.cookie, "bp_session");
    const session = token ? await kakaoAuth.getSession(token) : null;
    if (!session) {
      reply.code(401);
      return { error: "authentication_required" };
    }
    return { user: { id: session.userId, displayName: session.displayName, email: session.email }, workspace: { id: session.workspaceId, name: session.workspaceName }, brand: { id: session.brandId, name: session.brandName } };
  });

  app.get("/auth/kakao/login", async (request, reply) => {
    if (!kakao?.restApiKey || !kakao.redirectUri) {
      reply.code(503);
      return { error: "kakao_auth_not_configured" };
    }
    const state = crypto.randomUUID();
    reply.header("set-cookie", cookie(`${kakaoStateCookiePrefix}${state}`, "1", 600, process.env.VERCEL === "1"));
    const url = new URL("https://kauth.kakao.com/oauth/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", kakao.restApiKey);
    url.searchParams.set("redirect_uri", kakao.redirectUri);
    url.searchParams.set("state", state);
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/auth/kakao/callback", async (request, reply) => {
    const frontendUrl = kakao?.frontendUrl ?? "http://localhost:5173";
    if (!kakaoAuth || !kakao?.restApiKey || !kakao.redirectUri) {
      request.log.warn({ event: "kakao_callback_failed", reason: "configuration_missing" }, "kakao_callback_failed");
      return reply.redirect(`${frontendUrl}/login?error=kakao_configuration_missing`);
    }
    if (request.query.error || !request.query.code) {
      request.log.warn({ event: "kakao_callback_failed", reason: "authorization_denied", kakaoError: request.query.error ?? null }, "kakao_callback_failed");
      return reply.redirect(`${frontendUrl}/login?error=kakao_authorization_denied`);
    }
    const stateCookieName = request.query.state ? kakaoStateCookieName(request.query.state) : null;
    const stateCookie = stateCookieName ? readCookie(request.headers.cookie, stateCookieName) : null;
    // Supports an in-flight login initiated before the per-attempt cookie rollout.
    const legacyStateMatches = request.query.state !== undefined && readCookie(request.headers.cookie, "bp_kakao_state") === request.query.state;
    if (!request.query.state || (stateCookie !== "1" && !legacyStateMatches)) {
      request.log.warn({ event: "kakao_callback_failed", reason: "state_mismatch" }, "kakao_callback_failed");
      return reply.redirect(`${frontendUrl}/login?error=kakao_state_mismatch`);
    }
    const clearStateCookie = cookie(
      legacyStateMatches ? "bp_kakao_state" : stateCookieName!,
      "",
      0,
      process.env.VERCEL === "1"
    );
    const tokenBody = new URLSearchParams({ grant_type: "authorization_code", client_id: kakao.restApiKey, redirect_uri: kakao.redirectUri, code: request.query.code });
    if (kakao.clientSecret) tokenBody.set("client_secret", kakao.clientSecret);
    const tokenResponse = await fetch("https://kauth.kakao.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" }, body: tokenBody });
    const tokenPayload = await tokenResponse.json() as Record<string, unknown>;
    if (!tokenResponse.ok || typeof tokenPayload.access_token !== "string") {
      request.log.warn({ event: "kakao_callback_failed", reason: "token_exchange_failed", status: tokenResponse.status }, "kakao_callback_failed");
      reply.header("set-cookie", clearStateCookie);
      return reply.redirect(`${kakao.frontendUrl}/login?error=kakao_token_exchange_failed`);
    }
    const profileResponse = await fetch("https://kapi.kakao.com/v2/user/me", { headers: { authorization: `Bearer ${tokenPayload.access_token}` } });
    const profilePayload = await profileResponse.json() as Record<string, unknown>;
    const account = isObject(profilePayload.kakao_account) ? profilePayload.kakao_account : {};
    const properties = isObject(profilePayload.properties) ? profilePayload.properties : {};
    if (!profileResponse.ok || (typeof profilePayload.id !== "number" && typeof profilePayload.id !== "string")) {
      request.log.warn({ event: "kakao_callback_failed", reason: "profile_fetch_failed", status: profileResponse.status }, "kakao_callback_failed");
      reply.header("set-cookie", clearStateCookie);
      return reply.redirect(`${kakao.frontendUrl}/login?error=kakao_profile_fetch_failed`);
    }
    const profile: KakaoProfile = { subject: String(profilePayload.id), nickname: typeof properties.nickname === "string" ? properties.nickname : null, email: typeof account.email === "string" ? account.email : null };
    const session = await kakaoAuth.createOrLoadUser(profile);
    const sessionToken = await kakaoAuth.createSession(session.userId);
    reply.header("set-cookie", [sessionCookie(sessionToken, 60 * 60 * 24 * 7), clearStateCookie]);
    return reply.redirect(`${kakao.frontendUrl}/onboarding`);
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = readCookie(request.headers.cookie, "bp_session");
    if (token && kakaoAuth) await kakaoAuth.revokeSession(token);
    reply.header("set-cookie", sessionCookie("", 0));
    return { ok: true };
  });

  app.get("/auth/meta/start", async (request, reply) => {
    if (!instagramLogin?.appId || !instagramLogin.appSecret || !instagramLogin.redirectUri) {
      reply.code(503);
      return { error: "instagram_login_not_configured" };
    }
    if (kakaoAuth) {
      const token = readCookie(request.headers.cookie, "bp_session");
      const session = token ? await kakaoAuth.getSession(token) : null;
      if (!session) {
        reply.code(401);
        return { error: "authentication_required" };
      }
    }
    const state = randomUUID();
    reply.header("set-cookie", cookie(instagramLoginStateCookie, state, 10 * 60, process.env.VERCEL === "1"));
    return reply.redirect(buildInstagramLoginAuthorizeUrl({
      appId: instagramLogin.appId,
      redirectUri: instagramLogin.redirectUri,
      state,
    }));
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>("/auth/meta/callback", async (request, reply) => {
    const clearState = cookie(instagramLoginStateCookie, "", 0, process.env.VERCEL === "1");
    if (!instagramLogin?.appId || !instagramLogin.appSecret || !instagramLogin.redirectUri) {
      reply.header("set-cookie", clearState).code(503);
      return { error: "instagram_login_not_configured" };
    }
    if (request.query.error) {
      reply.header("set-cookie", clearState).code(400);
      return { error: request.query.error, errorDescription: request.query.error_description ?? null };
    }
    if (!request.query.code || request.query.state !== readCookie(request.headers.cookie, instagramLoginStateCookie)) {
      reply.header("set-cookie", clearState).code(400);
      return { error: "meta_oauth_state_invalid" };
    }
    let brandId = process.env.BRAND_PILOT_DEV_BRAND_ID ?? defaultDevBrandId;
    if (kakaoAuth) {
      const token = readCookie(request.headers.cookie, "bp_session");
      const session = token ? await kakaoAuth.getSession(token) : null;
      if (!session) {
        reply.header("set-cookie", clearState).code(401);
        return { error: "authentication_required" };
      }
      brandId = session.brandId;
    }
    try {
      const token = await exchangeInstagramLoginCode({
        code: request.query.code,
        appId: instagramLogin.appId,
        appSecret: instagramLogin.appSecret,
        redirectUri: instagramLogin.redirectUri,
      });
      const connection = await resolveInstagramLoginConnection({ accessToken: token.accessToken });
      await subscribeInstagramMessagingWebhooks({
        accessToken: token.accessToken,
        instagramBusinessAccountId: connection.instagramBusinessAccountId,
      });
      const accountLabel = connection.instagramUsername
        ? `@${connection.instagramUsername}`
        : "Instagram professional account";
      await repository.saveChannelCredentials(brandId, "instagram", {
        accountLabel,
        connectionStatus: "connected",
        credentialType: "oauth",
        externalAccountId: connection.instagramBusinessAccountId,
        expiresAt: token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000).toISOString() : null,
        maskedDisplay: tokenPreview(token.accessToken),
        provider: "meta",
        scopes: [...instagramLoginScopes],
        secretValue: token.accessToken,
        authMode: "instagram_login",
      });
      reply.header("set-cookie", clearState);
      return reply.redirect(`${instagramLogin.frontendUrl}/channels?instagram=connected`);
    } catch (error) {
      request.log.warn({ event: "instagram_login_callback_failed", errorCode: safeInternalErrorCode(error) }, "instagram_login_callback_failed");
      reply.header("set-cookie", clearState).code(400);
      return { error: "meta_instagram_connection_failed" };
    }
  });

  app.get<{
    Querystring: {
      access_token?: string;
      brand_id?: string;
      channel?: string;
      error?: string;
      error_description?: string;
      expires_in?: string;
      status?: string;
      token_type?: string;
    }
  }>("/auth/meta/dev-complete", async (request, reply) => {
    if (process.env.VERCEL === "1") {
      reply.code(404);
      return { error: "not_found" };
    }
    if (request.query.status === "error" || request.query.error) {
      reply.code(400);
      return {
        error: request.query.error ?? "meta_oauth_error",
        errorDescription: request.query.error_description ?? null
      };
    }

    const accessToken = request.query.access_token;
    if (!accessToken) {
      reply.code(400);
      return { error: "missing_access_token" };
    }

    const channel: Channel = request.query.channel === "threads" ? "threads" : "instagram";
    let brandId = request.query.brand_id ?? process.env.BRAND_PILOT_DEV_BRAND_ID ?? defaultDevBrandId;
    if (kakaoAuth) {
      const token = readCookie(request.headers.cookie, "bp_session");
      const session = token ? await kakaoAuth.getSession(token) : null;
      if (!session) {
        reply.code(401);
        return { error: "authentication_required" };
      }
      brandId = session.brandId;
    }
    let accountLabel = "Meta OAuth";
    let credentialToken = accessToken;
    let externalAccountId = "meta-oauth-dev";
    let scopes: string[] = [];
    let connectionStatus: "connected" | "needs_attention" = "needs_attention";

    if (channel === "instagram") {
      try {
        const connection = await resolveInstagramConnection({ accessToken });
        credentialToken = connection.accessToken;
        externalAccountId = connection.instagramBusinessAccountId;
        accountLabel = connection.instagramUsername
          ? `@${connection.instagramUsername}`
          : connection.pageName ?? "Instagram Business Account";
        scopes = connection.scopes;
        connectionStatus = "connected";
      } catch (error) {
        reply.code(400);
        return {
          error: "meta_instagram_connection_failed",
          errorDescription: error instanceof Error ? error.message : "unknown_error"
        };
      }
    }

    const maskedDisplay = tokenPreview(credentialToken);
    await repository.saveChannelCredentials(brandId, channel, {
      accountLabel,
      connectionStatus,
      credentialType: "oauth",
      externalAccountId,
      expiresAt: expiresAtFromSeconds(request.query.expires_in),
      maskedDisplay,
      provider: "meta",
      scopes,
      secretValue: credentialToken,
      authMode: "facebook_login"
    });

    reply.type("text/html; charset=utf-8");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>모종 Meta OAuth</title>
</head>
<body>
  <h1>Meta OAuth token received</h1>
  <p>모종 local API stored the ${htmlEscape(channel)} credential for ${htmlEscape(brandId)}.</p>
  <p>Connected account: ${htmlEscape(accountLabel)} (${htmlEscape(externalAccountId)})</p>
  <p>Token preview: ${htmlEscape(maskedDisplay)}</p>
  <p>You can close this tab and return to 모종.</p>
</body>
</html>`;
  });

  app.get("/auth/meta/trends/start", async (request, reply) => {
    if (!facebookLogin?.appId || !facebookLogin.appSecret || !facebookLogin.redirectUri) {
      reply.code(503);
      return { error: "instagram_trend_login_not_configured" };
    }
    if (kakaoAuth) {
      const token = readCookie(request.headers.cookie, "bp_session");
      const session = token ? await kakaoAuth.getSession(token) : null;
      if (!session) {
        reply.code(401);
        return { error: "authentication_required" };
      }
    }
    const state = randomUUID();
    reply.header("set-cookie", cookie(instagramTrendStateCookie, state, 10 * 60, process.env.VERCEL === "1"));
    return reply.redirect(buildFacebookLoginAuthorizeUrl({
      appId: facebookLogin.appId,
      redirectUri: facebookLogin.redirectUri,
      state,
    }));
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>("/auth/meta/trends/callback", async (request, reply) => {
    const clearState = cookie(instagramTrendStateCookie, "", 0, process.env.VERCEL === "1");
    if (!facebookLogin?.appId || !facebookLogin.appSecret || !facebookLogin.redirectUri) {
      reply.header("set-cookie", clearState).code(503);
      return { error: "instagram_trend_login_not_configured" };
    }
    if (request.query.error) {
      reply.header("set-cookie", clearState);
      return reply.redirect(`${facebookLogin.frontendUrl}/instagram-trends?meta_trends=denied`);
    }
    if (!request.query.code || request.query.state !== readCookie(request.headers.cookie, instagramTrendStateCookie)) {
      reply.header("set-cookie", clearState).code(400);
      return { error: "meta_oauth_state_invalid" };
    }
    let brandId = process.env.BRAND_PILOT_DEV_BRAND_ID ?? defaultDevBrandId;
    if (kakaoAuth) {
      const token = readCookie(request.headers.cookie, "bp_session");
      const session = token ? await kakaoAuth.getSession(token) : null;
      if (!session) {
        reply.header("set-cookie", clearState).code(401);
        return { error: "authentication_required" };
      }
      brandId = session.brandId;
    }
    try {
      const token = await exchangeFacebookLoginCode({
        code: request.query.code,
        appId: facebookLogin.appId,
        appSecret: facebookLogin.appSecret,
        redirectUri: facebookLogin.redirectUri,
      });
      const instagramIdentity = await repository.getInstagramChannelIdentity(brandId);
      const connection = await resolveInstagramConnection({
        accessToken: token.accessToken,
        expectedInstagramBusinessAccountId: instagramIdentity.externalAccountId,
      });
      const missingScopes = instagramTrendFacebookScopes.filter((scope) => !connection.scopes.includes(scope));
      if (missingScopes.length > 0) throw new Error("instagram_permission_required");
      await repository.saveInstagramTrendCredentials(brandId, {
        accountLabel: connection.instagramUsername ? `@${connection.instagramUsername}` : connection.pageName,
        accessToken: connection.accessToken,
        expiresAt: token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000).toISOString() : null,
        facebookPageId: connection.pageId,
        instagramBusinessAccountId: connection.instagramBusinessAccountId,
        maskedDisplay: tokenPreview(connection.accessToken),
        scopes: connection.scopes,
      });
      reply.header("set-cookie", clearState);
      return reply.redirect(`${facebookLogin.frontendUrl}/instagram-trends?meta_trends=connected`);
      } catch (error) {
        const errorCode = safeInternalErrorCode(error);
        request.log.warn({ event: "instagram_trend_login_callback_failed", errorCode }, "instagram_trend_login_callback_failed");
        reply.header("set-cookie", clearState);
        const oauthResult = errorCode === "instagram_permission_required"
          ? "permission_required"
          : errorCode === "meta_instagram_business_account_not_found"
            ? "account_link_required"
            : "error";
        return reply.redirect(`${facebookLogin.frontendUrl}/instagram-trends?meta_trends=${oauthResult}`);
      }
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/ui-status", async (request) => {
    return repository.getBrandUiStatus(request.params.brandId);
  });

  app.get<{ Params: { brandId: string }; Querystring: { period?: string } }>(
    "/brands/:brandId/dashboard",
    async (request, reply) => {
      if (request.query.period && request.query.period !== "30d") {
        reply.code(400);
        return { error: "dashboard_period_invalid" };
      }
      return repository.getDashboard(request.params.brandId);
    }
  );

  app.get("/content-categories", async () => {
    return repository.listContentCategories();
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/instagram-trends/connection", async (request) => {
    return repository.getInstagramTrendConnection(request.params.brandId);
  });

  app.get<{
    Params: { brandId: string };
    Querystring: { hashtag?: unknown; type?: unknown; sort?: unknown; page?: unknown };
  }>("/brands/:brandId/instagram-trends", async (request, reply) => {
    const hashtag = requiredHashtag(request.query.hashtag);
    if (!hashtag) {
      reply.code(400);
      return { error: "invalid_hashtag" };
    }
    const type = request.query.type === undefined ? "all" : request.query.type;
    if (typeof type !== "string" || !instagramTrendMediaTypes.has(type as InstagramTrendMediaTypeFilter)) {
      reply.code(400);
      return { error: "invalid_instagram_trend_type" };
    }
    const sort = request.query.sort === undefined ? "meta" : request.query.sort;
    if (typeof sort !== "string" || !instagramTrendSorts.has(sort as InstagramTrendSort)) {
      reply.code(400);
      return { error: "invalid_instagram_trend_sort" };
    }
    const page = request.query.page === undefined ? 1 : Number(request.query.page);
    if (!Number.isInteger(page) || page < 1) {
      reply.code(400);
      return { error: "invalid_instagram_trend_page" };
    }
    return instagramTrendResponse(
      reply,
      () => repository.listInstagramTrends(request.params.brandId, {
        hashtag,
        type: type as InstagramTrendMediaTypeFilter,
        sort: sort as InstagramTrendSort,
        page
      }),
      hashtag,
      page
    );
  });

  app.post<{
    Params: { brandId: string };
    Body: Record<string, unknown>;
  }>("/brands/:brandId/instagram-trends/search", async (request, reply) => {
    const hashtag = isObject(request.body) ? requiredHashtag(request.body.hashtag) : null;
    if (!hashtag) {
      reply.code(400);
      return { error: "invalid_hashtag" };
    }
    return instagramTrendResponse(
      reply,
      () => repository.searchInstagramTrends(request.params.brandId, { hashtag }),
      hashtag
    );
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/instagram-trend-searches", async (request) => {
    return repository.listInstagramTrendSearches(request.params.brandId);
  });

  app.put<{
    Params: { brandId: string; hashtagId: string };
    Body: Record<string, unknown>;
  }>("/brands/:brandId/instagram-trend-searches/:hashtagId/favorite", async (request, reply) => {
    if (!isObject(request.body) || typeof request.body.isFavorite !== "boolean") {
      reply.code(400);
      return { error: "invalid_is_favorite" };
    }
    return instagramTrendResponse(
      reply,
      () => repository.setInstagramTrendFavorite(request.params.brandId, request.params.hashtagId, {
        isFavorite: request.body.isFavorite as boolean
      })
    );
  });

  app.post<{
    Params: { brandId: string; mediaId: string };
  }>("/brands/:brandId/instagram-trends/:mediaId/save-source", async (request, reply) => {
    return instagramTrendResponse(
      reply,
      () => repository.saveInstagramTrendSource(request.params.brandId, request.params.mediaId)
    );
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/billing/summary", async (request) => {
    return repository.getBillingSummary(request.params.brandId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/profile", async (request) => {
    return repository.getBrandProfile(request.params.brandId);
  });

  app.put<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/profile", async (request, reply) => {
    if (!isObject(request.body)) {
      reply.code(400);
      return { error: "invalid_body" };
    }
    const validated = validateBrandProfileInput(request.body);
    if (validated.error) {
      reply.code(400);
      return { error: validated.error };
    }
    return repository.updateBrandProfile(request.params.brandId, validated.input!);
  });

  app.post<{ Params: { brandId: string }; Body: Record<string, unknown> }>(
    "/brands/:brandId/logo",
    { bodyLimit: brandLogoRequestBodyLimit },
    async (request, reply) => {
    if (!isObject(request.body)
      || typeof request.body.fileName !== "string"
      || typeof request.body.mimeType !== "string"
      || typeof request.body.fileBase64 !== "string") {
      reply.code(400);
      return { error: "invalid_body" };
    }
    if (!brandLogoService) throw new Error("brand_logo_storage_not_configured");
    return brandLogoService.upload(request.params.brandId, {
      fileName: request.body.fileName,
      mimeType: request.body.mimeType,
      fileBase64: request.body.fileBase64
    });
    }
  );

  app.delete<{ Params: { brandId: string } }>("/brands/:brandId/logo", async (request) => {
    if (!brandLogoService) throw new Error("brand_logo_storage_not_configured");
    return brandLogoService.remove(request.params.brandId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/instagram-formats", async (request) => {
    const settings = await repository.listInstagramFormats(request.params.brandId);
    return {
      ...settings,
      formats: settings.formats.map((format) => ({
        ...format,
        capabilityMetadata: sanitizeInstagramCapabilityMetadata(format.capabilityMetadata)
      }))
    };
  });

  app.put<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/instagram-formats", async (request, reply) => {
    const validation = validateInstagramFormatSettings(request.body);
    if ("error" in validation) {
      reply.code(400);
      return { error: validation.error };
    }
    return repository.updateInstagramFormats(request.params.brandId, validation.input);
  });

  app.post<{ Params: { brandId: string; format: string } }>("/brands/:brandId/instagram-formats/:format/check", async (request, reply) => {
    if (!instagramFormatSet.has(request.params.format)) {
      reply.code(400);
      return { error: "invalid_instagram_format" };
    }
    if (request.params.format !== "instagram_story") {
      reply.code(400);
      return { error: "instagram_capability_check_not_supported" };
    }
    return repository.checkInstagramCapability(request.params.brandId, "instagram_story");
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/sources", async (request) => {
    return repository.listSources(request.params.brandId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/source-snapshots", async (request) => {
    return repository.listSourceSnapshots(request.params.brandId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/source-crawl-runs", async (request) => {
    return repository.listSourceCrawlRuns(request.params.brandId);
  });

  app.post<{ Params: { brandId: string } }>("/brands/:brandId/sources/crawl", async (request) => {
    return repository.crawlSources(request.params.brandId);
  });

  app.post<{ Params: { brandId: string; sourceId: string } }>("/brands/:brandId/sources/:sourceId/crawl", async (request) => {
    return repository.crawlSingleSource(request.params.brandId, request.params.sourceId, "manual");
  });

  app.post<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/sources", async (request, reply) => {
    const sourceType = asSourceType(request.body?.sourceType);
    if (!sourceType || typeof request.body?.url !== "string" || request.body.url.trim().length === 0) {
      reply.code(400);
      return { error: "source_type_and_url_required" };
    }
    const source = await repository.createSourceWithInitialCrawl(request.params.brandId, { sourceType, url: request.body.url });
    reply.code(201);
    return source;
  });

  app.put<{ Params: { sourceId: string }; Body: Record<string, unknown> }>("/sources/:sourceId", async (request, reply) => {
    if (!isObject(request.body)) {
      reply.code(400);
      return { error: "invalid_body" };
    }
    const sourceType = request.body.sourceType === undefined ? undefined : asSourceType(request.body.sourceType) ?? undefined;
    if (request.body.sourceType !== undefined && !sourceType) {
      reply.code(400);
      return { error: "invalid_source_type" };
    }
    if (request.body.url !== undefined && (typeof request.body.url !== "string" || request.body.url.trim().length === 0)) {
      reply.code(400);
      return { error: "invalid_url" };
    }
    if (request.body.enabled !== undefined && typeof request.body.enabled !== "boolean") {
      reply.code(400);
      return { error: "invalid_source_enabled" };
    }
    return repository.updateSource(request.params.sourceId, {
      sourceType,
      url: typeof request.body.url === "string" ? request.body.url : undefined,
      enabled: typeof request.body.enabled === "boolean" ? request.body.enabled : undefined
    });
  });

  app.delete<{ Params: { sourceId: string } }>("/sources/:sourceId", async (request) => {
    return repository.deleteSource(request.params.sourceId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/channels", async (request) => {
    return repository.listChannels(request.params.brandId);
  });

  app.patch<{ Params: { brandId: string; channel: string }; Body: unknown }>(
    "/brands/:brandId/channels/:channel",
    async (request, reply) => {
      const channel = asChannel(request.params.channel);
      if (!isObject(request.body)) {
        reply.code(400);
        return { error: "invalid_body" };
      }
      const keys = Object.keys(request.body);
      if (keys.length !== 1 || keys[0] !== "enabled") {
        reply.code(400);
        return { error: keys.includes("enabled") ? "invalid_channel_activation_body" : "invalid_channel_enabled" };
      }
      if (typeof request.body.enabled !== "boolean") {
        reply.code(400);
        return { error: "invalid_channel_enabled" };
      }
      return repository.updateChannelEnabled(request.params.brandId, channel, request.body.enabled);
    }
  );

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/channel-connection-request", async (request) => {
    return repository.getChannelConnectionRequest(request.params.brandId);
  });

  app.put<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/channel-connection-request", async (request, reply) => {
    if (!isObject(request.body)) {
      reply.code(400);
      return { error: "invalid_body" };
    }
    return repository.updateChannelConnectionRequest(request.params.brandId, {
      instagramHandle: optionalString(request.body.instagramHandle),
      instagramProfileUrl: optionalString(request.body.instagramProfileUrl),
      facebookPageUrl: optionalString(request.body.facebookPageUrl),
      metaBusinessName: optionalString(request.body.metaBusinessName),
      threadsProfileUrl: optionalString(request.body.threadsProfileUrl),
      contactName: optionalString(request.body.contactName),
      contactEmail: optionalString(request.body.contactEmail),
      hasAdminAccess: request.body.hasAdminAccess === true,
      requestNote: optionalString(request.body.requestNote),
      submit: request.body.submit === true
    });
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/support-requests", async (request) => {
    return repository.listSupportRequests(request.params.brandId);
  });

  app.post<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/support-requests", async (request, reply) => {
    if (!isObject(request.body)) {
      reply.code(400);
      return { error: "invalid_body" };
    }
    const category = asSupportRequestCategory(request.body.category);
    const title = typeof request.body.title === "string" ? request.body.title.trim() : "";
    const message = typeof request.body.message === "string" ? request.body.message.trim() : "";
    if (!category || title.length === 0 || message.length === 0) {
      reply.code(400);
      return { error: "support_request_required_fields" };
    }
    const contactPhone = normalizeSupportContactPhone(request.body.contactPhone);
    if (contactPhone === null) {
      reply.code(400);
      return { error: "support_contact_phone_required" };
    }
    if (contactPhone === undefined) {
      reply.code(400);
      return { error: "invalid_support_contact_phone" };
    }
    const supportRequest = await repository.createSupportRequest(request.params.brandId, {
      category,
      title,
      message,
      contactPhone,
      contactEmail: optionalString(request.body.contactEmail)
    });
    reply.code(201);
    return supportRequest;
  });

  app.patch<{ Params: { requestId: string }; Body: Record<string, unknown> }>("/support-requests/:requestId", async (request, reply) => {
    if (!isObject(request.body)) {
      reply.code(400);
      return { error: "invalid_body" };
    }
    const status = asSupportRequestStatus(request.body.status);
    if (!status) {
      reply.code(400);
      return { error: "invalid_support_request_status" };
    }
    return repository.updateSupportRequestStatus(request.params.requestId, status);
  });

  app.post<{ Params: { requestId: string }; Body: Record<string, unknown> }>("/support-requests/:requestId/response", async (request, reply) => {
    const responseMessage = isObject(request.body) && typeof request.body.responseMessage === "string"
      ? request.body.responseMessage.trim()
      : "";
    if (!responseMessage) {
      reply.code(400);
      return { error: "support_response_required" };
    }
    return repository.respondToSupportRequest(request.params.requestId, responseMessage);
  });

  app.put<{ Params: { brandId: string; channel: string }; Body: Record<string, unknown> }>(
    "/brands/:brandId/channels/:channel/credentials",
    async (request, reply) => {
      const channel = asChannel(request.params.channel);
      if (channel !== "instagram" && channel !== "threads") {
        reply.code(400);
        return { error: "channel_credentials_not_supported" };
      }
      if (typeof request.body?.secretValue !== "string" || request.body.secretValue.trim().length === 0) {
        reply.code(400);
        return { error: "secret_value_required" };
      }
      return repository.saveChannelCredentials(request.params.brandId, channel, {
        secretValue: request.body.secretValue,
        accountLabel: typeof request.body.accountLabel === "string" ? request.body.accountLabel : undefined,
        externalAccountId: typeof request.body.externalAccountId === "string" ? request.body.externalAccountId : undefined,
        maskedDisplay: typeof request.body.maskedDisplay === "string" ? request.body.maskedDisplay : undefined,
        provider: request.body.provider === "meta" ? "meta" : undefined,
        credentialType: request.body.credentialType === "api_token" ? "api_token" : request.body.credentialType === "oauth" ? "oauth" : undefined,
        scopes: Array.isArray(request.body.scopes) ? request.body.scopes.filter((item): item is string => typeof item === "string") : undefined,
        expiresAt: typeof request.body.expiresAt === "string" ? request.body.expiresAt : null
      });
    }
  );

  app.post<{ Params: { brandId: string; channel: string } }>("/brands/:brandId/channels/:channel/check", async (request) => {
    const channel = asChannel(request.params.channel);
    return repository.checkChannel(request.params.brandId, channel);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/instagram-dm/settings", async (request) => {
    return repository.getInstagramDmSettings(request.params.brandId);
  });

  app.put<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/instagram-dm/settings", async (request, reply) => {
    const body = request.body;
    if (
      (body.enabled !== undefined && typeof body.enabled !== "boolean")
      || (body.fallbackMessage !== undefined && typeof body.fallbackMessage !== "string")
      || (body.errorMessage !== undefined && typeof body.errorMessage !== "string")
    ) {
      reply.code(400);
      return { error: "invalid_dm_settings" };
    }
    try {
      return await repository.updateInstagramDmSettings(request.params.brandId, {
        enabled: body.enabled as boolean | undefined,
        fallbackMessage: body.fallbackMessage as string | undefined,
        errorMessage: body.errorMessage as string | undefined,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "dm_activation_blocked") {
        reply.code(409);
        return { error: error.message };
      }
      throw error;
    }
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/instagram-dm/history", async (request) => {
    return repository.listInstagramDmHistory(request.params.brandId);
  });

  app.get<{ Params: { brandId: string }; Querystring: { subjectType?: string; sourceUrl?: string } }>(
    "/brands/:brandId/ai-content/subject-analyses/cache",
    async (request) => {
      const parsed = parseCreateSubjectAnalysisInput({
        subjectType: request.query.subjectType,
        sourceUrl: request.query.sourceUrl,
        manualInput: {},
        idempotencyKey: "cache-lookup",
      });
      const analysis = await subjectRepository.getCachedSubjectAnalysis({
        ...aiContentScope(request, request.params.brandId),
        subjectType: parsed.subjectType,
        sourceUrl: parsed.sourceUrl,
      });
      if (!analysis || (analysis.status !== "ready" && analysis.status !== "partial")) {
        throw new Error("subject_analysis_not_found");
      }
      return analysis;
    },
  );

  app.get<{ Params: { brandId: string } }>(
    "/brands/:brandId/brand-intelligence",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      return {
        intelligence: await brandIntelligenceRepository.getCurrentBrandIntelligence(
          aiContentScope(request, request.params.brandId),
        ),
      };
    },
  );

  app.post<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/brand-intelligence/analyses",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      return brandIntelligenceRepository.requestBrandAnalysis({
        ...aiContentScope(request, request.params.brandId),
        ...parseCreateBrandAnalysisInput(request.body),
      });
    },
  );

  app.get<{ Params: { brandId: string; analysisId: string } }>(
    "/brands/:brandId/brand-intelligence/analyses/:analysisId",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      const analysis = await brandIntelligenceRepository.getBrandAnalysis({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
      });
      if (!analysis) throw new Error("brand_analysis_not_found");
      return analysis;
    },
  );

  app.patch<{ Params: { brandId: string; analysisId: string }; Body: unknown }>(
    "/brands/:brandId/brand-intelligence/analyses/:analysisId",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      return brandIntelligenceRepository.updateBrandAnalysisDraft({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
        ...parseEditBrandAnalysisInput(request.body),
      });
    },
  );

  app.post<{ Params: { brandId: string; analysisId: string } }>(
    "/brands/:brandId/brand-intelligence/analyses/:analysisId/confirm",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      return brandIntelligenceRepository.confirmBrandAnalysis({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
      });
    },
  );

  app.post<{ Params: { brandId: string }; Body: Record<string, unknown> }>(
    "/brands/:brandId/brand-intelligence/uploads/token",
    async (request) => {
      if (!brandAnalysisUpload) throw new Error("brand_analysis_storage_not_configured");
      const uploadSessionId = requiredAiContentField(
        request.body.uploadSessionId,
        "brand_analysis_upload_session_invalid",
        100,
      );
      if (!uuidPattern.test(uploadSessionId)) throw new Error("brand_analysis_upload_session_invalid");
      return issueBrandAnalysisUploadToken({
        brandId: request.params.brandId,
        uploadSessionId,
        file: {
          fileName: requiredAiContentField(request.body.fileName, "brand_analysis_file_name_invalid", 160),
          mimeType: requiredAiContentField(request.body.mimeType, "brand_analysis_file_type_invalid", 200),
          byteSize: Number(request.body.byteSize),
          checksum: requiredAiContentField(request.body.checksum, "brand_analysis_checksum_invalid", 64),
        },
      }, {
        token: brandAnalysisUpload.readWriteToken,
        generateClientToken: brandAnalysisUpload.generateClientToken,
      });
    },
  );

  app.post<{ Params: { brandId: string }; Body: Record<string, unknown> }>(
    "/brands/:brandId/brand-intelligence/uploads/confirm",
    async (request) => {
      if (!brandIntelligenceRepository || !brandAnalysisUpload) {
        throw new Error("brand_analysis_storage_not_configured");
      }
      const uploadSessionId = requiredAiContentField(request.body.uploadSessionId, "brand_analysis_upload_session_invalid", 100);
      if (!uuidPattern.test(uploadSessionId)) throw new Error("brand_analysis_upload_session_invalid");
      const verified = await verifyBrandAnalysisUpload({
        brandId: request.params.brandId,
        uploadSessionId,
        file: {
          fileName: requiredAiContentField(request.body.fileName, "brand_analysis_file_name_invalid", 160),
          mimeType: requiredAiContentField(request.body.mimeType, "brand_analysis_file_type_invalid", 200),
          byteSize: Number(request.body.byteSize),
          checksum: requiredAiContentField(request.body.checksum, "brand_analysis_checksum_invalid", 64),
        },
        storagePath: requiredAiContentField(request.body.storagePath, "brand_analysis_upload_path_invalid", 2_000),
        storageUrl: requiredAiContentField(request.body.storageUrl, "brand_analysis_upload_url_invalid", 2_000),
      }, { token: brandAnalysisUpload.readWriteToken, headBlob: brandAnalysisUpload.headBlob });
      return brandIntelligenceRepository.registerBrandAnalysisUpload({
        ...aiContentScope(request, request.params.brandId),
        fileName: verified.fileName,
        mimeType: verified.mimeType,
        byteSize: verified.byteSize,
        checksum: verified.checksum,
        storagePath: verified.storagePath,
        storageUrl: verified.storageUrl,
      });
    },
  );

  app.post<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/subject-analyses",
    async (request, reply) => {
      const scope = aiContentScope(request, request.params.brandId);
      const parsed = parseCustomerSubjectAnalysisInput(request.body);
      let analysis: SubjectAnalysisRecord;
      if (parsed.contractVersion === "subject-analysis.v2") {
        if (!repository.getConfirmedSubjectAnalysisBrandContext) {
          throw new Error("subject_analysis_brand_context_required");
        }
        const v2Request = {
          ...scope,
          contractVersion: parsed.contractVersion,
          ...parsed.input,
          brandContext: await repository.getConfirmedSubjectAnalysisBrandContext(scope),
        };
        analysis = await subjectRepository.requestSubjectAnalysis(v2Request);
      } else {
        analysis = await subjectRepository.requestSubjectAnalysis({ ...scope, ...parsed.input });
      }
      reply.code(analysis.status === "ready" || analysis.status === "partial" ? 200 : 202);
      return customerSubjectAnalysisResponse(analysis);
    },
  );

  app.get<{ Params: { brandId: string; analysisId: string } }>(
    "/brands/:brandId/ai-content/subject-analyses/:analysisId",
    async (request) => {
      const analysis = await subjectRepository.getSubjectAnalysis({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
      });
      if (!analysis) throw new Error("subject_analysis_not_found");
      return customerSubjectAnalysisResponse(analysis);
    },
  );

  app.post<{ Params: { brandId: string; analysisId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/subject-analyses/:analysisId/appeals/regenerate",
    async (request, reply) => {
      const { idempotencyKey } = parseReanalyzeSubjectAnalysisInput(request.body);
      const analysis = await subjectRepository.regenerateSubjectAppeals({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
        idempotencyKey,
      });
      reply.code(analysis.status === "ready" || analysis.status === "partial" ? 200 : 202);
      return customerSubjectAnalysisResponse(analysis);
    },
  );

  app.post<{ Params: { brandId: string; analysisId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/subject-analyses/:analysisId/reanalyze",
    async (request, reply) => {
      const scope = aiContentScope(request, request.params.brandId);
      const current = await subjectRepository.getSubjectAnalysis({ ...scope, analysisId: request.params.analysisId });
      if (!current) throw new Error("subject_analysis_not_found");
      if (current.contractVersion === "subject-analysis.v2") {
        reply.code(400);
        return {
          error: "subject_analysis_v2_reanalyze_unsupported",
          supportedActions: ["generation_scoped_post", "appeals_regenerate"],
        };
      }
      const { idempotencyKey } = parseReanalyzeSubjectAnalysisInput(request.body);
      const analysis = await subjectRepository.requestSubjectAnalysis({
        ...scope,
        subjectType: current.subjectType,
        sourceUrl: current.sourceUrl,
        manualInput: current.input,
        idempotencyKey,
        force: true,
      });
      reply.code(analysis.status === "ready" || analysis.status === "partial" ? 200 : 202);
      return analysis;
    },
  );

  app.patch<{ Params: { brandId: string; analysisId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/subject-analyses/:analysisId/selection",
    async (request) => customerSubjectAnalysisResponse(
      await subjectRepository.selectSubjectImage({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
        ...parseSubjectAnalysisSelectionInput(request.body),
      }),
    ),
  );

  app.post<{ Params: { brandId: string }; Body: unknown }>("/brands/:brandId/ai-content/generations", async (request) => {
    const scope = aiContentScope(request, request.params.brandId);
    return repository.createAiContentAnalysis({ ...scope, ...parseCreateAiContentAnalysisInput(request.body) });
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/ai-content/brand-context", async (request) => {
    return repository.getAiContentBrandContext(aiContentScope(request, request.params.brandId));
  });

  app.patch<{ Params: { brandId: string; generationId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/generations/:generationId",
    async (request) => {
      const scope = aiContentScope(request, request.params.brandId);
      return repository.updateAiContentDraft({
        ...scope,
        generationId: request.params.generationId,
        ...parseUpdateAiContentDraftInput(request.body),
      });
    },
  );

  app.post<{ Params: { brandId: string; generationId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/generations/:generationId/generate",
    async (request) => {
      const scope = aiContentScope(request, request.params.brandId);
      const usageDate = kstDateKey(new Date());
      const limits = {
        dailyGenerationLimit: positiveLimit(aiContentLimits?.dailyGenerationLimit, 10),
        dailyDownloadLimit: positiveLimit(aiContentLimits?.dailyDownloadLimit, 20),
      };
      const usage = await repository.listAiContentUsage({ ...scope, usageDate });
      if (usage.generationCount >= limits.dailyGenerationLimit) throw new Error("ai_content_limit_reached");
      return repository.startAiContentGeneration({
        ...scope,
        generationId: request.params.generationId,
        usageDate,
        dailyGenerationLimit: limits.dailyGenerationLimit,
        ...parseStartAiContentGenerationInput(request.body),
      });
    },
  );

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/ai-content/generations", async (request) => {
    return repository.listAiContentGenerations(aiContentScope(request, request.params.brandId));
  });

  app.get<{ Params: { brandId: string; generationId: string } }>(
    "/brands/:brandId/ai-content/generations/:generationId",
    async (request) => {
      const generation = await repository.getAiContentGeneration({
        ...aiContentScope(request, request.params.brandId),
        generationId: request.params.generationId,
      });
      if (!generation) throw new Error("ai_content_generation_not_found");
      return generation;
    },
  );

  app.post<{ Params: { brandId: string; outputId: string } }>(
    "/brands/:brandId/ai-content/outputs/:outputId/retry",
    async (request) => repository.retryAiContentOutput({
      ...aiContentScope(request, request.params.brandId),
      outputId: request.params.outputId,
    }),
  );

  app.get<{ Params: { brandId: string; outputId: string } }>(
    "/brands/:brandId/ai-content/outputs/:outputId/download",
    async (request, reply) => {
      const packageResult = await repository.downloadAiContentOutput({
        ...aiContentScope(request, request.params.brandId),
        outputId: request.params.outputId,
        usageDate: kstDateKey(new Date()),
        dailyDownloadLimit: positiveLimit(aiContentLimits?.dailyDownloadLimit, 20),
      });
      reply.header("content-type", packageResult.mimeType);
      reply.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(packageResult.fileName)}`);
      return reply.send(packageResult.buffer);
    },
  );

  app.post<{ Params: { brandId: string; outputId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/outputs/:outputId/publish",
    async (request) => {
      const publishInput = parseAiContentPublishRequest(request.body);
      const scope = aiContentScope(request, request.params.brandId);
      const prepared = await repository.prepareAiContentPublish({
        ...scope,
        outputId: request.params.outputId,
        ...publishInput,
      });
      const targets = [];
      for (const target of prepared.targets) {
        if (!target.queueId) {
          targets.push(target);
          continue;
        }
        try {
          const published = await repository.publishQueueItem(target.queueId);
          targets.push({
            ...target,
            status: published.status,
            publishedUrl: published.publishedUrl,
            errorCode: null,
          });
        } catch {
          targets.push(await repository.getAiContentPublishQueueResult({
            ...scope,
            queueId: target.queueId,
          }));
        }
      }
      return { outputId: request.params.outputId, publishGroupId: prepared.publishGroupId, targets };
    },
  );

  app.get<{ Params: { brandId: string; generationId: string }; Querystring: { outputIds?: string } }>(
    "/brands/:brandId/ai-content/generations/:generationId/download",
    async (request, reply) => {
      const outputIds = request.query.outputIds?.split(",").map((value) => value.trim()).filter(Boolean);
      if (outputIds?.some((value) => !/^[0-9a-f-]{36}$/i.test(value))) throw new Error("ai_content_output_id_invalid");
      const packageResult = await repository.downloadAiContentGeneration({
        ...aiContentScope(request, request.params.brandId),
        generationId: request.params.generationId,
        outputIds,
        usageDate: kstDateKey(new Date()),
        dailyDownloadLimit: positiveLimit(aiContentLimits?.dailyDownloadLimit, 20),
      });
      reply.header("content-type", packageResult.mimeType);
      reply.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(packageResult.fileName)}`);
      return reply.send(packageResult.buffer);
    },
  );

  app.get<{ Params: { brandId: string }; Querystring: { date?: string } }>(
    "/brands/:brandId/ai-content/usage",
    async (request) => {
      const usageDate = request.query.date ?? kstDateKey(new Date());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(usageDate)) throw new Error("ai_content_usage_date_invalid");
      const usage = await repository.listAiContentUsage({
        ...aiContentScope(request, request.params.brandId),
        usageDate,
      });
      return {
        ...usage,
        dailyGenerationLimit: positiveLimit(aiContentLimits?.dailyGenerationLimit, 10),
        dailyDownloadLimit: positiveLimit(aiContentLimits?.dailyDownloadLimit, 20),
      };
    },
  );

  app.get<{ Params: { brandId: string }; Querystring: { type?: string } }>(
    "/brands/:brandId/ai-content/references",
    async (request) => {
      const type = request.query.type;
      if (type !== undefined && !["card_news", "blog", "marketing"].includes(type)) {
        throw new Error("ai_content_type_invalid");
      }
      return repository.listAiContentReferences({
        ...aiContentScope(request, request.params.brandId),
        type: type as AiContentType | undefined,
      });
    },
  );

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/ai-content/audiences", async (request) => {
    return repository.listBrandAudiences(aiContentScope(request, request.params.brandId));
  });

  app.post<{ Params: { brandId: string }; Body: unknown }>("/brands/:brandId/ai-content/audiences", async (request) => {
    const body = isObject(request.body) ? request.body : {};
    return repository.saveBrandAudience({
      ...aiContentScope(request, request.params.brandId),
      name: requiredAiContentField(body.name, "ai_content_audience_name_invalid", 120),
      situation: requiredAiContentField(body.situation, "ai_content_audience_situation_invalid", 1_000),
      problem: requiredAiContentField(body.problem, "ai_content_audience_problem_invalid", 1_000),
      motivation: requiredAiContentField(body.motivation, "ai_content_audience_motivation_invalid", 1_000),
    });
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/ai-content/appeals", async (request) => {
    return repository.listBrandAppeals(aiContentScope(request, request.params.brandId));
  });

  app.post<{ Params: { brandId: string }; Body: unknown }>("/brands/:brandId/ai-content/appeals", async (request) => {
    const body = isObject(request.body) ? request.body : {};
    const evidenceType = requiredAiContentField(body.evidenceType, "ai_content_appeal_evidence_type_invalid", 20);
    if (!["fact", "benefit", "price", "trust", "emotion"].includes(evidenceType)) {
      throw new Error("ai_content_appeal_evidence_type_invalid");
    }
    return repository.saveBrandAppeal({
      ...aiContentScope(request, request.params.brandId),
      title: requiredAiContentField(body.title, "ai_content_appeal_title_invalid", 160),
      description: requiredAiContentField(body.description, "ai_content_appeal_description_invalid", 2_000),
      evidenceType: evidenceType as "fact" | "benefit" | "price" | "trust" | "emotion",
    });
  });

  app.post<{ Params: { brandId: string; generationId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/generations/:generationId/attachments/token",
    async (request) => {
      const scope = aiContentScope(request, request.params.brandId);
      const generation = await repository.getAiContentGeneration({ ...scope, generationId: request.params.generationId });
      if (!generation) throw new Error("ai_content_generation_not_found");
      return issueAiContentAttachmentToken({
        brandId: request.params.brandId,
        generationId: request.params.generationId,
        attachment: parseAttachmentUploadTokenInput(request.body),
      }, {
        token: aiContentUpload?.readWriteToken ?? "",
        generateClientToken: aiContentUpload?.generateClientToken,
      });
    },
  );

  app.post<{ Params: { brandId: string; generationId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/generations/:generationId/attachments/confirm",
    async (request) => {
      const scope = aiContentScope(request, request.params.brandId);
      const generation = await repository.getAiContentGeneration({ ...scope, generationId: request.params.generationId });
      if (!generation) throw new Error("ai_content_generation_not_found");
      const parsed = parseConfirmAttachmentInput(request.body);
      const confirmed = confirmAiContentAttachment({
        brandId: request.params.brandId,
        generationId: request.params.generationId,
        attachment: parsed,
        storagePath: parsed.storagePath,
        storageUrl: parsed.storageUrl,
      });
      const verified = await verifyAiContentAttachmentBlob(confirmed, {
        token: aiContentUpload?.readWriteToken ?? "",
        headBlob: aiContentUpload?.headBlob,
      });
      return repository.confirmAiContentAttachment({ ...scope, generationId: request.params.generationId, ...verified });
    },
  );

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/content-outputs", async (request) => {
    return repository.listContentOutputs(request.params.brandId);
  });

  app.post<{ Params: { brandId: string } }>("/brands/:brandId/content-generation/run", async (request) => {
    return repository.generateContent(request.params.brandId);
  });

  app.post<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/topic-uploads", async (request, reply) => {
    if (
      typeof request.body?.fileName !== "string" ||
      request.body.fileName.trim().length === 0 ||
      typeof request.body.csvText !== "string" ||
      request.body.csvText.trim().length === 0
    ) {
      reply.code(400);
      return { error: "topic_upload_file_and_csv_required" };
    }
    if (!hasRequiredTopicHeaders(request.body.csvText)) {
      reply.code(400);
      return { error: "topic_upload_invalid_csv" };
    }
    const upload = await repository.createTopicUpload(request.params.brandId, {
      fileName: request.body.fileName,
      csvText: request.body.csvText
    });
    reply.code(201);
    return upload;
  });

  app.post<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/knowledge-imports", async (request, reply) => {
    const entryType = request.body?.entryType ?? "faq";
    if (entryType !== "faq" && entryType !== "product") {
      reply.code(400);
      return { error: "knowledge_import_entry_type_invalid" };
    }
    if (
      typeof request.body?.fileName !== "string" ||
      request.body.fileName.trim().length === 0 ||
      typeof request.body.fileBase64 !== "string" ||
      request.body.fileBase64.trim().length === 0
    ) {
      reply.code(400);
      return { error: "faq_upload_file_required" };
    }
    const imported = await repository.createKnowledgeImport(request.params.brandId, {
      entryType,
      fileName: request.body.fileName,
      fileBase64: request.body.fileBase64,
    });
    reply.code(201);
    return imported;
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/knowledge-imports", async (request) => {
    return repository.listKnowledgeImports(request.params.brandId);
  });

  app.post<{ Params: { brandId: string } }>("/brands/:brandId/wiki/refresh", async (request, reply) => {
    const job = await repository.enqueueWikiRefresh(request.params.brandId);
    reply.code(202);
    return job;
  });

  app.get<{
    Params: { brandId: string };
    Querystring: { filter?: string; cursor?: string; limit?: string };
  }>("/brands/:brandId/dm/conversations", async (request, reply) => {
    const filter = request.query.filter ?? "all";
    const limit = request.query.limit === undefined ? 20 : Number(request.query.limit);
    if (!dmConversationFilters.has(filter as DmConversationFilter) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      reply.code(400);
      return { error: "dm_conversation_query_invalid" };
    }
    return repository.listDmConversations(request.params.brandId, {
      filter: filter as DmConversationFilter,
      cursor: request.query.cursor,
      limit,
    });
  });

  app.get<{ Params: { brandId: string; conversationId: string } }>(
    "/brands/:brandId/dm/conversations/:conversationId",
    async (request, reply) => {
      if (!uuidPattern.test(request.params.conversationId)) {
        reply.code(400);
        return { error: "dm_conversation_id_invalid" };
      }
      return repository.getDmConversation(request.params.brandId, request.params.conversationId);
    },
  );

  app.post<{
    Params: { brandId: string; conversationId: string };
    Body: { body?: unknown };
  }>("/brands/:brandId/dm/conversations/:conversationId/messages", async (request, reply) => {
    const body = typeof request.body?.body === "string" ? request.body.body.trim() : "";
    if (!uuidPattern.test(request.params.conversationId) || body.length < 1 || body.length > 1000) {
      reply.code(400);
      return { error: "dm_manual_reply_invalid" };
    }
    return repository.sendManualDmReply(request.params.brandId, request.params.conversationId, body);
  });

  app.get<{
    Params: { brandId: string };
    Querystring: { type?: string };
  }>("/brands/:brandId/dm/attention-items", async (request, reply) => {
    const type = request.query.type;
    if (type && !dmAttentionTypes.has(type as DmAttentionType)) {
      reply.code(400);
      return { error: "dm_attention_type_invalid" };
    }
    return repository.listDmAttentionItems(request.params.brandId, type as DmAttentionType | undefined);
  });

  app.patch<{
    Params: { attentionId: string };
    Body: Record<string, unknown>;
  }>("/dm/attention-items/:attentionId", async (request, reply) => {
    if (!uuidPattern.test(request.params.attentionId) || request.body?.status !== "resolved") {
      reply.code(400);
      return { error: "dm_attention_resolution_invalid" };
    }
    return repository.resolveDmAttentionItem(request.params.attentionId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/wiki/status", async (request) => {
    return repository.getWikiStatus(request.params.brandId);
  });

  app.get<{ Params: { brandId: string }; Querystring: { status?: string } }>("/brands/:brandId/topic-rows", async (request, reply) => {
    const status = typeof request.query.status === "string" ? request.query.status : undefined;
    if (status && !topicRowStatuses.has(status)) {
      reply.code(400);
      return { error: "invalid_topic_row_status" };
    }
    return repository.listTopicRows(request.params.brandId, status);
  });

  app.post<{ Params: { outputId: string }; Body: Record<string, unknown> }>("/content-outputs/:outputId/review", async (request, reply) => {
    const action = request.body?.action;
    if (action !== "approve" && action !== "reject" && action !== "regenerate") {
      reply.code(400);
      return { error: "valid_review_action_required" };
    }
    try {
      return await repository.reviewContentOutput(
        request.params.outputId,
        action,
        typeof request.body.reason === "string" ? request.body.reason : undefined
      );
    } catch (error) {
      if (error instanceof Error && [
        "content_output_artifact_not_ready",
        "content_output_not_reviewable",
      ].includes(error.message)) {
        reply.code(409);
        return { error: error.message };
      }
      throw error;
    }
  });

  app.get<{ Params: { outputId: string } }>("/content-outputs/:outputId/artifact", async (request) => {
    return repository.getContentOutputArtifact(request.params.outputId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/publish-queue", async (request) => {
    return repository.listPublishQueue(request.params.brandId);
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/publish-results", async (request) => {
    return repository.listPublishResults(request.params.brandId);
  });

  app.get<{ Params: { queueId: string } }>("/publish-queue/:queueId/artifacts", async (request) => {
    return repository.getPublishArtifact(request.params.queueId);
  });

  app.get<{ Params: { queueId: string } }>("/publish-queue/:queueId/download", async (request, reply) => {
    const packageResult = await repository.downloadPublishResult(request.params.queueId);
    reply
      .header("content-type", packageResult.mimeType)
      .header("content-disposition", `attachment; filename="${packageResult.fileName}"`)
      .header("x-published-result-count", String(packageResult.itemCount));
    return reply.send(packageResult.buffer);
  });

  app.post<{ Params: { brandId: string } }>("/brands/:brandId/publish-queue/schedule", async (request) => {
    return repository.schedulePublishQueue(request.params.brandId);
  });

  app.post<{ Params: { queueId: string } }>("/publish-queue/:queueId/publish", async (request) => {
    return repository.publishQueueItem(request.params.queueId);
  });

  app.post<{ Params: { queueId: string } }>("/publish-queue/:queueId/retry", async (request, reply) => {
    try {
      return await repository.retryPublishQueueItem(request.params.queueId);
    } catch (error) {
      if (error instanceof Error && error.message === "publish_queue_not_retryable") {
        reply.code(409);
        return { error: error.message };
      }
      throw error;
    }
  });

  function assertWorkerAuthentication(authorization: string | undefined) {
    if (!workerApiToken) throw new Error("worker_api_not_configured");
    if (authorization !== `Bearer ${workerApiToken}`) throw new Error("worker_api_unauthorized");
  }

  function authenticateAiContentWorker(authorization: string | undefined, reply: FastifyReply) {
    try {
      assertWorkerAuthentication(authorization);
      return true;
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401).send({
        error: error instanceof Error ? error.message : "worker_api_unauthorized",
      });
      return false;
    }
  }

  app.post<{ Body: unknown }>("/worker/brand-analyses/claim", async (request, reply) => {
    if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
    if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
    return {
      job: await claimAndPrepareBrandAnalysis(
        brandIntelligenceRepository,
        parseBrandAnalysisWorkerClaimInput(request.body),
        brandIntelligence,
      ),
    };
  });

  app.post<{ Params: { analysisId: string }; Body: Record<string, unknown> }>(
    "/worker/brand-analyses/:analysisId/heartbeat",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      const lease = parseBrandAnalysisWorkerLeaseInput(request.body);
      const alive = await brandIntelligenceRepository.heartbeatBrandAnalysis({
        analysisId: request.params.analysisId, ...lease,
      });
      if (!alive) {
        reply.code(409);
        return { error: "brand_analysis_lease_invalid" };
      }
      return { ok: true };
    },
  );

  app.post<{ Params: { analysisId: string }; Body: Record<string, unknown> }>(
    "/worker/brand-analyses/:analysisId/complete",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      const lease = parseBrandAnalysisWorkerLeaseInput({
        workerId: request.body.workerId,
        leaseToken: request.body.leaseToken,
        leaseSeconds: request.body.leaseSeconds,
      });
      return brandIntelligenceRepository.completeBrandAnalysis({
        analysisId: request.params.analysisId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        result: parseBrandIntelligenceResult(request.body.result),
      });
    },
  );

  app.post<{ Params: { analysisId: string }; Body: Record<string, unknown> }>(
    "/worker/brand-analyses/:analysisId/fail",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      const lease = parseBrandAnalysisWorkerLeaseInput({
        workerId: request.body.workerId,
        leaseToken: request.body.leaseToken,
        leaseSeconds: request.body.leaseSeconds,
      });
      if (typeof request.body.retryable !== "boolean") throw new Error("brand_analysis_retryable_invalid");
      return brandIntelligenceRepository.failBrandAnalysis({
        analysisId: request.params.analysisId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        errorCode: requiredAiContentField(request.body.errorCode, "brand_analysis_error_code_invalid", 120),
        errorMessage: requiredAiContentField(request.body.errorMessage, "brand_analysis_error_message_invalid", 2_000),
        retryable: request.body.retryable,
      });
    },
  );

  app.post<{ Body: unknown }>("/worker/ai-content-subject-analyses/claim", async (request, reply) => {
    if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
    const job = await claimAndPrepareSubjectAnalysis(subjectRepository, parseSubjectWorkerClaimInput(request.body), subjectAnalysis);
    return { job };
  });

  app.post<{ Params: { analysisId: string }; Body: Record<string, unknown> }>(
    "/worker/ai-content-subject-analyses/:analysisId/heartbeat",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      const lease = parseSubjectWorkerLeaseInput({
        workerId: request.body.workerId,
        leaseToken: request.body.leaseToken,
        leaseSeconds: request.body.leaseSeconds,
      });
      const ok = await subjectRepository.heartbeatSubjectAnalysis({ analysisId: request.params.analysisId, ...lease });
      if (!ok) {
        reply.code(409);
        return { error: "subject_analysis_lease_invalid" };
      }
      return { ok: true };
    },
  );

  app.post<{ Params: { analysisId: string }; Body: Record<string, unknown> }>(
    "/worker/ai-content-subject-analyses/:analysisId/extraction-complete",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      const lease = parseSubjectWorkerLeaseInput({
        workerId: request.body.workerId,
        leaseToken: request.body.leaseToken,
        leaseSeconds: request.body.leaseSeconds,
      });
      if (!Array.isArray(request.body.facts) || !Array.isArray(request.body.images)
        || !isObject(request.body.structuredData)) throw new Error("subject_analysis_extraction_invalid");
      return subjectRepository.markSubjectExtractionComplete({
        analysisId: request.params.analysisId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        facts: request.body.facts as never,
        structuredData: request.body.structuredData,
        images: request.body.images as never,
      });
    },
  );

  app.post<{ Params: { analysisId: string }; Body: Record<string, unknown> }>(
    "/worker/ai-content-subject-analyses/:analysisId/complete",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      const lease = parseSubjectWorkerLeaseInput({
        workerId: request.body.workerId,
        leaseToken: request.body.leaseToken,
        leaseSeconds: request.body.leaseSeconds,
      });
      const identity = {
        analysisId: request.params.analysisId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
      };
      if (!repository.getSubjectAnalysisWorkerLease) {
        throw new Error("subject_analysis_worker_lease_repository_not_configured");
      }
      const activeLease = await repository.getSubjectAnalysisWorkerLease(identity);
      if (!activeLease) throw new Error("subject_analysis_lease_invalid");
      const rawResult = isObject(request.body.result) ? request.body.result : {};
      if (activeLease.contractVersion === "subject-analysis.v1") {
        if (rawResult.contractVersion !== "subject-analysis-result.v1") {
          throw new Error("subject_analysis_completion_phase_mismatch");
        }
        const result = parseSubjectAnalysisResult(rawResult);
        return subjectRepository.completeSubjectAnalysis({ ...identity, ...result });
      }
      if (activeLease.phase === "analysis") {
        if (rawResult.contractVersion !== "subject-analysis-result.v2" || rawResult.phase !== "analysis") {
          throw new Error("subject_analysis_completion_phase_mismatch");
        }
        const result = parseSubjectAnalysisResultV2(rawResult);
        return subjectRepository.completeSubjectAnalysis({ ...identity, ...result });
      }
      if (rawResult.contractVersion !== "subject-appeal-result.v2" || rawResult.phase !== "appeal") {
        throw new Error("subject_analysis_completion_phase_mismatch");
      }
      const result = parseSubjectAppealResultV2(rawResult);
      return subjectRepository.completeSubjectAppeals({ ...identity, ...result });
    },
  );

  app.post<{ Params: { analysisId: string }; Body: Record<string, unknown> }>(
    "/worker/ai-content-subject-analyses/:analysisId/fail",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      const lease = parseSubjectWorkerLeaseInput({
        workerId: request.body.workerId,
        leaseToken: request.body.leaseToken,
        leaseSeconds: request.body.leaseSeconds,
      });
      if (typeof request.body.retryable !== "boolean") throw new Error("subject_analysis_retryable_invalid");
      return subjectRepository.failSubjectAnalysis({
        analysisId: request.params.analysisId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        errorCode: requiredAiContentField(request.body.errorCode, "subject_analysis_error_code_invalid", 120),
        errorMessage: requiredAiContentField(request.body.errorMessage, "subject_analysis_error_message_invalid", 2_000),
        retryable: request.body.retryable,
      });
    },
  );

  app.post<{ Params: { contentType: string }; Body: Record<string, unknown> }>(
    "/worker/ai-content-jobs/:contentType/claim",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      const contentType = contentTypeByWorkerSlug[request.params.contentType as keyof typeof contentTypeByWorkerSlug];
      if (!contentType) {
        reply.code(404);
        return { error: "ai_content_worker_type_not_found" };
      }
      const workerId = requiredAiContentField(request.body?.workerId, "ai_content_worker_id_required", 200);
      const leaseSeconds = Number(request.body?.leaseSeconds ?? 180);
      if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) {
        reply.code(400);
        return { error: "ai_content_lease_seconds_invalid" };
      }
      return { job: await repository.claimAiContentJob({ contentType, workerId, leaseSeconds }) };
    },
  );

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>(
    "/worker/ai-content-jobs/:jobId/heartbeat",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      const workerId = requiredAiContentField(request.body?.workerId, "ai_content_worker_id_required", 200);
      const leaseToken = requiredAiContentField(request.body?.leaseToken, "ai_content_lease_token_required", 200);
      const leaseSeconds = Number(request.body?.leaseSeconds ?? 180);
      if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) {
        reply.code(400);
        return { error: "ai_content_lease_seconds_invalid" };
      }
      const alive = await repository.heartbeatAiContentJob({ jobId: request.params.jobId, workerId, leaseToken, leaseSeconds });
      if (!alive) {
        reply.code(409);
        return { error: "ai_content_job_lease_invalid" };
      }
      return { id: request.params.jobId, status: "processing" };
    },
  );

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>(
    "/worker/ai-content-jobs/:jobId/complete",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      const body = request.body ?? {};
      const common = {
        jobId: request.params.jobId,
        workerId: requiredAiContentField(body.workerId, "ai_content_worker_id_required", 200),
        leaseToken: requiredAiContentField(body.leaseToken, "ai_content_lease_token_required", 200),
        skillVersion: requiredAiContentField(body.skillVersion, "ai_content_skill_version_required", 100),
      };
      let completion: CompleteAiContentJobInput;
      if (body.jobType === "analyze") {
        if (!isObject(body.analysisJson) || Object.keys(body.analysisJson).length === 0) {
          throw new Error("ai_content_analysis_result_invalid");
        }
        completion = { ...common, jobType: "analyze", analysisJson: body.analysisJson };
      } else if (body.jobType === "generate") {
        if (!isObject(body.manifest)) throw new Error("ai_content_manifest_invalid");
        const manifestType = body.manifest.type;
        if (!['card_news', 'blog', 'marketing'].includes(String(manifestType))) throw new Error("ai_content_type_invalid");
        completion = {
          ...common,
          jobType: "generate",
          manifest: parseAiContentManifest(manifestType as AiContentType, body.manifest),
          manifestUrl: requiredAiContentField(body.manifestUrl, "ai_content_manifest_url_invalid", 2_000),
        };
      } else {
        throw new Error("ai_content_job_type_invalid");
      }
      return repository.completeAiContentJob(completion);
    },
  );

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>(
    "/worker/ai-content-jobs/:jobId/fail",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      const body = request.body ?? {};
      if (typeof body.retryable !== "boolean") throw new Error("ai_content_retryable_invalid");
      const failure: FailAiContentJobInput = {
        jobId: request.params.jobId,
        workerId: requiredAiContentField(body.workerId, "ai_content_worker_id_required", 200),
        leaseToken: requiredAiContentField(body.leaseToken, "ai_content_lease_token_required", 200),
        errorCode: requiredAiContentField(body.errorCode, "ai_content_error_code_invalid", 120),
        errorMessage: requiredAiContentField(body.errorMessage, "ai_content_error_message_invalid", 2_000),
        retryable: body.retryable,
      };
      return repository.failAiContentJob(failure);
    },
  );

  app.post<{ Params: { resourceType: string }; Body: Record<string, unknown> }>("/worker/resources/:resourceType/acquire", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (
      request.params.resourceType !== "codex-cli"
      || typeof request.body?.workerId !== "string"
      || !request.body.workerId.trim()
      || typeof request.body?.workload !== "string"
      || !workerResourceWorkloads.has(request.body.workload)
    ) {
      reply.code(400);
      return { error: "worker_resource_request_invalid" };
    }
    const lease = await repository.acquireWorkerResourceLease(
      "codex_cli",
      request.body.workerId.trim(),
      request.body.workload as "dm" | "wiki" | "content",
    );
    if (!lease) {
      reply.code(204);
      return reply.send();
    }
    return lease;
  });

  app.post<{ Params: { resourceType: string; leaseId: string }; Body: Record<string, unknown> }>("/worker/resources/:resourceType/:leaseId/heartbeat", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (request.params.resourceType !== "codex-cli" || typeof request.body?.workerId !== "string" || typeof request.body?.leaseToken !== "string") {
      reply.code(400);
      return { error: "worker_resource_lease_fields_required" };
    }
    return repository.heartbeatWorkerResourceLease(request.params.leaseId, request.body.workerId, request.body.leaseToken);
  });

  app.post<{ Params: { resourceType: string; leaseId: string }; Body: Record<string, unknown> }>("/worker/resources/:resourceType/:leaseId/release", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (request.params.resourceType !== "codex-cli" || typeof request.body?.workerId !== "string" || typeof request.body?.leaseToken !== "string") {
      reply.code(400);
      return { error: "worker_resource_lease_fields_required" };
    }
    return repository.releaseWorkerResourceLease(request.params.leaseId, request.body.workerId, request.body.leaseToken);
  });

  app.post<{ Body: Record<string, unknown> }>("/worker/image-jobs/claim", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || request.body.workerId.trim().length === 0) {
      reply.code(400);
      return { error: "worker_id_required" };
    }
    const job = await repository.claimImageRenderJob(request.body.workerId.trim());
    if (!job) {
      reply.code(204);
      return reply.send();
    }
    return job;
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/worker/image-jobs/:jobId/heartbeat", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || typeof request.body?.leaseToken !== "string") {
      reply.code(400);
      return { error: "worker_id_and_lease_token_required" };
    }
    return repository.heartbeatImageRenderJob(request.params.jobId, request.body.workerId, request.body.leaseToken);
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/worker/image-jobs/:jobId/complete", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || typeof request.body?.leaseToken !== "string" || typeof request.body?.manifestUrl !== "string") {
      reply.code(400);
      return { error: "worker_completion_fields_required" };
    }
    return repository.completeImageRenderJob(request.params.jobId, {
      workerId: request.body.workerId,
      leaseToken: request.body.leaseToken,
      manifestUrl: request.body.manifestUrl
    });
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/worker/image-jobs/:jobId/fail", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (
      typeof request.body?.workerId !== "string" ||
      typeof request.body?.leaseToken !== "string" ||
      typeof request.body?.error !== "string" ||
      typeof request.body?.retryable !== "boolean" ||
      typeof request.body?.retryAfterMs !== "number"
    ) {
      reply.code(400);
      return { error: "worker_failure_fields_required" };
    }
    return repository.failImageRenderJob(request.params.jobId, {
      workerId: request.body.workerId,
      leaseToken: request.body.leaseToken,
      error: request.body.error,
      retryable: request.body.retryable,
      retryAfterMs: request.body.retryAfterMs
    });
  });

  app.post<{ Body: Record<string, unknown> }>("/worker/text-jobs/claim", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || request.body.workerId.trim().length === 0) {
      reply.code(400);
      return { error: "worker_id_required" };
    }
    const job = await repository.claimTextRenderJob(request.body.workerId.trim());
    if (!job) {
      reply.code(204);
      return reply.send();
    }
    return job;
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/worker/text-jobs/:jobId/heartbeat", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || typeof request.body?.leaseToken !== "string") {
      reply.code(400);
      return { error: "worker_id_and_lease_token_required" };
    }
    return repository.heartbeatTextRenderJob(request.params.jobId, request.body.workerId, request.body.leaseToken);
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/worker/text-jobs/:jobId/complete", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (
      typeof request.body?.workerId !== "string"
      || typeof request.body?.leaseToken !== "string"
      || !isObject(request.body?.result)
    ) {
      reply.code(400);
      return { error: "worker_completion_fields_required" };
    }
    return repository.completeTextRenderJob(request.params.jobId, {
      workerId: request.body.workerId,
      leaseToken: request.body.leaseToken,
      result: request.body.result
    });
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/worker/text-jobs/:jobId/fail", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (
      typeof request.body?.workerId !== "string"
      || typeof request.body?.leaseToken !== "string"
      || typeof request.body?.error !== "string"
      || typeof request.body?.retryable !== "boolean"
      || typeof request.body?.retryAfterMs !== "number"
    ) {
      reply.code(400);
      return { error: "worker_failure_fields_required" };
    }
    return repository.failTextRenderJob(request.params.jobId, {
      workerId: request.body.workerId,
      leaseToken: request.body.leaseToken,
      error: request.body.error,
      retryable: request.body.retryable,
      retryAfterMs: request.body.retryAfterMs
    });
  });

  app.post<{ Body: Record<string, unknown> }>("/worker/dm-jobs/claim", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || request.body.workerId.trim().length === 0) {
      reply.code(400);
      return { error: "worker_id_required" };
    }
    const job = await repository.claimDmReplyJob(request.body.workerId.trim());
    if (!job) {
      reply.code(204);
      return reply.send();
    }
    return job;
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/worker/dm-jobs/:jobId/heartbeat", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || typeof request.body?.leaseToken !== "string") {
      reply.code(400);
      return { error: "worker_id_and_lease_token_required" };
    }
    return repository.heartbeatDmReplyJob(request.params.jobId, request.body.workerId, request.body.leaseToken);
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/worker/dm-jobs/:jobId/complete", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || typeof request.body?.leaseToken !== "string") {
      reply.code(400);
      return { error: "worker_completion_fields_required" };
    }
    try {
      return await repository.completeDmReplyJob(request.params.jobId, {
        workerId: request.body.workerId,
        leaseToken: request.body.leaseToken,
        result: parseDmWorkerResult(request.body.result),
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("dm_")) {
        reply.code(400);
        return { error: error.message };
      }
      throw error;
    }
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/worker/dm-jobs/:jobId/fail", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (
      typeof request.body?.workerId !== "string"
      || typeof request.body?.leaseToken !== "string"
      || typeof request.body?.error !== "string"
      || typeof request.body?.retryable !== "boolean"
      || typeof request.body?.retryAfterMs !== "number"
    ) {
      reply.code(400);
      return { error: "worker_failure_fields_required" };
    }
    return repository.failDmReplyJob(request.params.jobId, {
      workerId: request.body.workerId,
      leaseToken: request.body.leaseToken,
      error: request.body.error,
      retryable: request.body.retryable,
      retryAfterMs: request.body.retryAfterMs,
    });
  });

  app.post<{ Body: Record<string, unknown> }>("/worker/dm-jobs/heartbeat", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || request.body.workerId.trim().length === 0) {
      reply.code(400);
      return { error: "worker_id_required" };
    }
    return repository.heartbeatDmWorker(request.body.workerId.trim());
  });

  app.post<{ Body: Record<string, unknown> }>("/workers/dm/profile-jobs/claim", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || !request.body.workerId.trim()) {
      reply.code(400);
      return { error: "worker_id_required" };
    }
    const job = await repository.claimDmProfileRefreshJob(request.body.workerId.trim());
    if (!job) {
      reply.code(204);
      return reply.send();
    }
    return job;
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/workers/dm/profile-jobs/:jobId/run", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (typeof request.body?.workerId !== "string" || typeof request.body?.leaseToken !== "string") {
      reply.code(400);
      return { error: "worker_id_and_lease_token_required" };
    }
    return repository.runDmProfileRefreshJob(request.params.jobId, {
      workerId: request.body.workerId,
      leaseToken: request.body.leaseToken,
    });
  });

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>("/workers/dm/profile-jobs/:jobId/fail", async (request, reply) => {
    try {
      assertWorkerAuthentication(request.headers.authorization);
    } catch (error) {
      reply.code(error instanceof Error && error.message === "worker_api_not_configured" ? 503 : 401);
      return { error: error instanceof Error ? error.message : "worker_api_unauthorized" };
    }
    if (
      typeof request.body?.workerId !== "string"
      || typeof request.body?.leaseToken !== "string"
      || typeof request.body?.error !== "string"
      || typeof request.body?.retryable !== "boolean"
      || typeof request.body?.retryAfterMs !== "number"
    ) {
      reply.code(400);
      return { error: "worker_failure_fields_required" };
    }
    return repository.failDmProfileRefreshJob(request.params.jobId, {
      workerId: request.body.workerId,
      leaseToken: request.body.leaseToken,
      error: request.body.error,
      retryable: request.body.retryable,
      retryAfterMs: request.body.retryAfterMs,
    });
  });

  return app;
}
