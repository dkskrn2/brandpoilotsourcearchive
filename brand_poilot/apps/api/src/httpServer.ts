import cors from "@fastify/cors";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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
import { isDmAutomationReady, parseDmWorkerResult } from "./dmTypes.js";
import { normalizeInstagramHashtag } from "./instagramTrend.js";
import { StoryCapabilityRequiredError } from "./repository.js";
import type { ApiRepository, BrandProfileInput, Channel, DmAttentionType, DmConversationFilter, InstagramDeliveryFormat, InstagramFormatSettingsInput, InstagramTrendMediaTypeFilter, InstagramTrendPageDto, InstagramTrendSort, SourceType, SubjectAnalysisRepositoryV2, SupportRequestCategory, SupportRequestStatus } from "./types.js";
import type { AiContentAttachmentLifecycleRepository } from "./aiContentAttachmentRepository.js";
import type { AiContentCopyField, AiContentRevisionAction } from "./aiContentRepository.js";
import {
  runAiContentAttachmentGc,
  type DeleteAiContentAttachmentBlob,
  type AiContentAttachmentGcRunResult,
} from "./aiContentAttachmentGc.js";
import type { AiContentAttachmentGcRepository } from "./aiContentAttachmentGcRepository.js";
import {
  parseContentProposalResult,
  type ContentProposalJobsRepository,
} from "./contentProposalJobs.js";
import {
  parseContentFinalizationDraftV2,
  parseContentGenerationStartV2,
  parseContentProposalSetV2,
  parseResearchEvidenceSnapshotV1,
} from "./aiContentGenerationInputV3.js";
import { createKakaoAuthStore, type KakaoProfile } from "./kakaoAuth.js";
import { brandLogoRequestBodyLimit, type BrandLogoService } from "./brandLogo.js";
import { channelNames } from "./channelCatalog.js";
import { buildChannelCapabilities } from "./channelCapabilities.js";
import type { AiContentProposalV2Service } from "./aiContentProposalV2Service.js";
import type { AiContentSnapshotRepository } from "./aiContentSnapshotRepository.js";
import {
  parseAttachmentUploadTokenInput,
  parseAiContentAttachmentId,
  parseAiContentGenerationId,
  parseCancelUploadSessionInput,
  parseConfirmAttachmentInput,
  parseCreateAiContentAnalysisInput,
  parseStartAiContentGenerationInput,
  parseUpdateAiContentDraftInput,
  parseV3AttachmentUploadTokenInput,
  type AiContentType,
  type CompleteAiContentJobInput,
  type ContentChannelTarget,
  type ContentOutputFormatV2,
  type ContentProposalRequestV1,
  type FailAiContentJobInput,
} from "./aiContentContracts.js";
import { parseAiContentManifest } from "./aiContentManifest.js";
import { parseAiContentPublishRequest } from "./aiContentPublishTargets.js";
import {
  confirmAiContentAttachment,
  AI_CONTENT_ATTACHMENT_POLICY,
  AI_CONTENT_ATTACHMENT_POLICY_V3,
  issueValidatedAiContentAttachmentToken,
  issueAiContentUploadSessionToken,
  validateAiContentAttachment,
  validateAiContentAttachmentV3,
  verifyAiContentAttachmentBlob,
  verifyAiContentUploadSessionBlob,
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
  parseBrandEvidenceDocuments,
  parseBrandAnalysisWorkerClaimInput,
  parseBrandAnalysisWorkerLeaseInput,
  parseBrandIntelligenceResult,
} from "./brandIntelligenceContracts.js";
import type {
  BrandAnalysisRecord,
  BrandIntelligenceRepository,
} from "./brandIntelligenceRepository.js";
import {
  issueBrandAnalysisUploadToken,
  verifyBrandAnalysisUpload,
} from "./brandAnalysisUpload.js";
import { registerBrandCenterRoutes } from "./brandCenterHttp.js";
import type { ApiHttpRuntimePolicy } from "./runtimeConfig.js";
import { assessApiReadiness } from "./runtime.js";

export type { ApiHttpRuntimePolicy } from "./runtimeConfig.js";

const channels = new Set<string>(channelNames);
const sourceTypes = new Set(["owned", "reference"]);
const creatableSupportRequestCategories = new Set(["bug", "feature", "channel", "account", "other"]);
const supportRequestCategoryTitles: Record<SupportRequestCategory, string> = {
  bug: "오류",
  feature: "기능 요청",
  channel: "채널",
  account: "계정",
  other: "기타"
};
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
  instagram_trend_not_found: [404, "instagram_trend_not_found"],
  instagram_hashtag_not_found: [200, "instagram_hashtag_not_found"]
};
const defaultDevBrandId = "00000000-0000-4000-8000-000000000100";
const maxBrandProfileShortFieldLength = 30;
const kakaoStateCookiePrefix = "bp_kakao_state_";
const instagramLoginStateCookie = "bp_instagram_login_state";
const instagramLoginBindingCookie = "bp_instagram_login_binding";
const instagramTrendStateCookie = "bp_instagram_trend_state";
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const workerResourceWorkloads = new Set(["dm", "wiki", "content", "onboarding", "faq"]);
const contentTypeByWorkerSlug = {
  "card-news": "card_news",
  blog: "blog",
  marketing: "marketing",
} as const;

type InstagramLoginCallbackFailureReason =
  | "account_mapping_failed"
  | "authentication_required"
  | "connection_failed"
  | "invalid_callback"
  | "token_exchange_failed";

function instagramLoginCallbackUrl(
  frontendUrl: string,
  outcome: "connected" | "cancelled" | "failed",
  reason?: InstagramLoginCallbackFailureReason,
) {
  const url = new URL("/channels", frontendUrl);
  url.searchParams.set("instagram", outcome);
  if (outcome === "failed") url.searchParams.set("reason", reason ?? "connection_failed");
  return url.toString();
}

interface CreateServerOptions {
  repository: ApiRepository;
  aiContentProposalV2?: {
    service: AiContentProposalV2Service;
    snapshotRepository: AiContentSnapshotRepository;
  };
  workerApiToken?: string;
  contentProposalWorkerApiToken?: string;
  cronSecret?: string;
  kakaoAuth?: ReturnType<typeof createKakaoAuthStore>;
  kakao?: { restApiKey: string; clientSecret?: string; redirectUri: string; frontendUrl: string };
  instagramLogin?: { appId: string; appSecret: string; redirectUri: string; frontendUrl: string };
  facebookLogin?: { appId: string; appSecret: string; redirectUri: string; frontendUrl: string };
  metaWebhook?: { appSecret: string; verifyToken: string };
  brandLogoService?: BrandLogoService;
  aiContentUpload?: {
    readWriteToken: string;
    uploadSessionsEnabled?: boolean;
    generateClientToken?: AiContentTokenOptions["generateClientToken"];
    headBlob?: import("./aiContentUpload.js").AiContentBlobVerificationOptions["headBlob"];
  };
  aiContentAttachmentGc?: {
    deleteBlob: DeleteAiContentAttachmentBlob;
    workerId?: string;
    runGc?: typeof runAiContentAttachmentGc;
  };
  assetLibraryUpload?: {
    readWriteToken: string;
    generateClientToken?: import("./assetLibraryUpload.js").AssetLibraryTokenOptions["generateClientToken"];
    getBlob?: import("./assetLibraryUpload.js").AssetLibraryBlobOptions["getBlob"];
    deleteBlob?: import("./assetLibraryUpload.js").AssetLibraryDeleteOptions["deleteBlob"];
    listBlobs?: import("./assetLibraryUpload.js").AssetLibraryDeleteOptions["listBlobs"];
  };
  aiContentLimits?: { dailyGenerationLimit: number; dailyDownloadLimit: number };
  subjectAnalysis?: AiContentSubjectRuntime;
  brandIntelligenceRepository?: BrandIntelligenceRepository;
  brandAnalysisUpload?: {
    readWriteToken: string;
    generateClientToken?: import("./brandAnalysisUpload.js").BrandAnalysisUploadTokenOptions["generateClientToken"];
    headBlob?: typeof import("@vercel/blob").head;
  };
  runtimePolicy?: ApiHttpRuntimePolicy;
  readinessPolicy?: {
    schedulerEnabled: boolean;
    publishingEnabled: boolean;
    contentProposalsEnabled: boolean;
    dmWorkersEnabled?: boolean;
  };
  logger?: boolean | FastifyLoggerOptions;
}

type AiContentUploadRouteRepository = Pick<
  AiContentAttachmentLifecycleRepository,
  | "assertAiContentAttachmentUploadMutable"
  | "createAiContentUploadSession"
  | "failAiContentUploadSession"
  | "confirmAiContentUploadSession"
  | "cancelAiContentUploadSession"
  | "confirmLegacyAiContentAttachment"
>;

const aiContentUploadRouteRepositoryMethods = [
  "assertAiContentAttachmentUploadMutable",
  "createAiContentUploadSession",
  "failAiContentUploadSession",
  "confirmAiContentUploadSession",
  "cancelAiContentUploadSession",
  "confirmLegacyAiContentAttachment",
] as const satisfies readonly (keyof AiContentUploadRouteRepository)[];

type AuthSession = Awaited<ReturnType<NonNullable<CreateServerOptions["kakaoAuth"]>["getSession"]>>;

interface InstagramLoginBinding {
  version: 1;
  mode: "session" | "development";
  stateDigest: string;
  sessionDigest: string | null;
  identityDigest: string;
}

function keyedDigest(secret: string, label: string, value: string) {
  return createHmac("sha256", secret).update(`${label}\0${value}`).digest("base64url");
}

function instagramLoginIdentity(session: NonNullable<AuthSession>) {
  return `${session.userId}\0${session.workspaceId}\0${session.brandId}`;
}

function encodeInstagramLoginBinding(input: {
  appSecret: string;
  state: string;
  sessionToken: string | null;
  session: AuthSession;
  developmentBrandId: string;
}) {
  const binding: InstagramLoginBinding = {
    version: 1,
    mode: input.session ? "session" : "development",
    stateDigest: keyedDigest(input.appSecret, "state", input.state),
    sessionDigest: input.sessionToken
      ? keyedDigest(input.appSecret, "session", input.sessionToken)
      : null,
    identityDigest: keyedDigest(
      input.appSecret,
      "identity",
      input.session
        ? instagramLoginIdentity(input.session)
        : `development\0${input.developmentBrandId}`,
    ),
  };
  const payload = Buffer.from(JSON.stringify(binding)).toString("base64url");
  const signature = keyedDigest(input.appSecret, "binding", payload);
  return `${payload}.${signature}`;
}

function decodeInstagramLoginBinding(value: string | null, appSecret: string): InstagramLoginBinding | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!matchesOpaqueSecret(signature, keyedDigest(appSecret, "binding", payload))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<InstagramLoginBinding>;
    if (
      parsed.version !== 1
      || (parsed.mode !== "session" && parsed.mode !== "development")
      || typeof parsed.stateDigest !== "string"
      || (typeof parsed.sessionDigest !== "string" && parsed.sessionDigest !== null)
      || typeof parsed.identityDigest !== "string"
    ) {
      return null;
    }
    return parsed as InstagramLoginBinding;
  } catch {
    return null;
  }
}

function clearInstagramLoginCookies(secure: boolean) {
  return [
    cookie(instagramLoginStateCookie, "", 0, secure),
    cookie(instagramLoginBindingCookie, "", 0, secure),
  ];
}

function aiContentScope(request: FastifyRequest, brandId: string) {
  const session = (request as { aiContentSession?: AuthSession }).aiContentSession;
  const workspaceId = session?.workspaceId ?? process.env.BRAND_PILOT_DEV_WORKSPACE_ID;
  if (!workspaceId) throw new Error("authentication_required");
  return { workspaceId, brandId };
}

function aiContentActorUserId(request: FastifyRequest): string | null {
  const session = (request as { aiContentSession?: AuthSession }).aiContentSession;
  return session?.userId ?? process.env.BRAND_PILOT_DEV_USER_ID ?? null;
}

function requiredAiContentActorUserId(request: FastifyRequest): string {
  const actorUserId = aiContentActorUserId(request);
  if (!actorUserId) throw new Error("authentication_required");
  return actorUserId;
}

function positiveLimit(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function requiredAiContentField(value: unknown, code: string, maxLength = 500) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) throw new Error(code);
  return value.trim();
}

function assertExactAiContentWorkerBody(value: Record<string, unknown>, allowed: readonly string[], code: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(code);
}

function parseAiContentRevisionInput(value: unknown): {
  action: AiContentRevisionAction;
  cardIndex?: number;
  idempotencyKey: string;
} {
  if (!isObject(value)) throw new Error("ai_content_revision_input_invalid");
  const allowed = new Set(["action", "cardIndex", "idempotencyKey"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("ai_content_revision_input_invalid");
  }
  const action = value.action;
  if (!["regenerate_hook", "regenerate_copy", "regenerate_card"].includes(String(action))) {
    throw new Error("ai_content_revision_action_invalid");
  }
  const idempotencyKey = requiredAiContentField(
    value.idempotencyKey,
    "ai_content_idempotency_key_invalid",
    200,
  );
  if (action === "regenerate_card") {
    if (!Number.isSafeInteger(value.cardIndex) || Number(value.cardIndex) < 1) {
      throw new Error("ai_content_revision_card_index_invalid");
    }
    return {
      action,
      cardIndex: Number(value.cardIndex),
      idempotencyKey,
    };
  }
  if (value.cardIndex !== undefined) throw new Error("ai_content_revision_card_index_invalid");
  return { action: action as AiContentRevisionAction, idempotencyKey };
}

const aiContentCopyFields = new Set<AiContentCopyField>([
  "hook",
  "keyMessage",
  "body",
  "cta",
  "caption",
  "hashtags",
]);

function parseAiContentCopyInput(value: unknown): {
  fields: Partial<Record<AiContentCopyField, string | string[]>>;
  idempotencyKey: string;
} {
  if (!isObject(value) || !isObject(value.fields)) throw new Error("ai_content_copy_input_invalid");
  const idempotencyKey = requiredAiContentField(
    value.idempotencyKey,
    "ai_content_idempotency_key_invalid",
    200,
  );
  const entries = Object.entries(value.fields);
  if (!entries.length || entries.some(([field]) => !aiContentCopyFields.has(field as AiContentCopyField))) {
    throw new Error("ai_content_copy_fields_invalid");
  }
  const fields: Partial<Record<AiContentCopyField, string | string[]>> = {};
  for (const [field, raw] of entries) {
    if (field === "hashtags") {
      if (!Array.isArray(raw) || raw.length > 30
        || raw.some((tag) => typeof tag !== "string" || tag.length > 100)) {
        throw new Error("ai_content_copy_fields_invalid");
      }
      fields.hashtags = raw;
    } else {
      if (typeof raw !== "string" || raw.length > 20_000) throw new Error("ai_content_copy_fields_invalid");
      fields[field as Exclude<AiContentCopyField, "hashtags">] = raw;
    }
  }
  return { fields, idempotencyKey };
}

function parseAiContentBrandId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("ai_content_brand_id_invalid");
  }
  return value.toLowerCase();
}

function parseAiContentUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new Error(code);
  return value.toLowerCase();
}

const contentChannelTargets: readonly ContentChannelTarget[] = [
  "instagram",
  "threads",
  "x",
  "linkedin",
  "youtube",
  "tiktok",
  "blog_export",
];

function parseContentProposalRequest(value: unknown): ContentProposalRequestV1 {
  if (!isObject(value)) throw new Error("ai_content_proposal_request_invalid");
  if (value.contractVersion !== "content-proposal-request.v1"
    || !["informational", "marketing"].includes(String(value.contentFamily))
    || !isObject(value.subjectInput)
    || !Array.isArray(value.channelTargets)
    || value.channelTargets.length === 0
    || value.channelTargets.some((item) => !contentChannelTargets.includes(item as ContentChannelTarget))
    || new Set(value.channelTargets).size !== value.channelTargets.length
    || !Array.isArray(value.outputFormats)
    || value.outputFormats.length === 0
    || value.outputFormats.some((item) => !["card_news", "blog", "single_image", "channel_text"].includes(String(item)))
    || !Array.isArray(value.sourceSnapshotIds)
    || value.sourceSnapshotIds.some((id) => typeof id !== "string" || !uuidPattern.test(id))
    || !Array.isArray(value.performanceSnapshotIds)
    || value.performanceSnapshotIds.some((id) => typeof id !== "string" || !uuidPattern.test(id))) {
    throw new Error("ai_content_proposal_request_invalid");
  }
  return {
    contractVersion: "content-proposal-request.v1",
    contentFamily: value.contentFamily as ContentProposalRequestV1["contentFamily"],
    subjectInput: value.subjectInput,
    channelTargets: value.channelTargets as ContentChannelTarget[],
    outputFormats: value.outputFormats as ContentProposalRequestV1["outputFormats"],
    sourceSnapshotIds: value.sourceSnapshotIds.map((id) => String(id).toLowerCase()),
    performanceSnapshotIds: value.performanceSnapshotIds.map((id) => String(id).toLowerCase()),
  };
}

async function validateAiContentLifecycleBrand(request: FastifyRequest) {
  const { brandId } = request.params as { brandId: string };
  parseAiContentBrandId(brandId);
}

function requireAiContentUploadRouteRepository(
  repository: ApiRepository,
): AiContentUploadRouteRepository {
  const source = repository as unknown as Record<string, unknown>;
  if (aiContentUploadRouteRepositoryMethods.some((method) => typeof source[method] !== "function")) {
    throw new Error("ai_content_upload_repository_not_configured");
  }
  return repository as ApiRepository & AiContentUploadRouteRepository;
}

const aiContentAttachmentGcRepositoryMethods = [
  "prepareAiContentAttachmentGc",
  "claimAiContentAttachmentDeletionJobs",
  "beginAiContentAttachmentDeletionAttempt",
  "releaseUnstartedAiContentAttachmentDeletions",
  "completeAiContentAttachmentDeletion",
  "failAiContentAttachmentDeletion",
  "getAiContentAttachmentGcMetrics",
] as const satisfies readonly (keyof AiContentAttachmentGcRepository)[];

function asAiContentAttachmentGcRepository(
  repository: ApiRepository,
): AiContentAttachmentGcRepository | null {
  const source = repository as unknown as Record<string, unknown>;
  return aiContentAttachmentGcRepositoryMethods.every((method) => typeof source[method] === "function")
    ? repository as ApiRepository & AiContentAttachmentGcRepository
    : null;
}

function requireContentProposalJobsRepository(repository: ApiRepository): ContentProposalJobsRepository {
  const candidate = repository as ApiRepository & Partial<ContentProposalJobsRepository>;
  if (!candidate.claimContentProposalJob
    || !candidate.heartbeatContentProposalJob
    || !candidate.completeContentProposalJob
    || !candidate.failContentProposalJob) {
    throw new Error("content_proposal_repository_not_configured");
  }
  return candidate as ContentProposalJobsRepository;
}

type AiContentRenderWorkerRepository = Required<Pick<ApiRepository,
  "claimAiContentRenderJob"
  | "heartbeatAiContentRenderJob"
  | "completeAiContentRenderAsset"
  | "completeAiContentRenderPackage"
  | "failAiContentRenderJob"
  | "saveAiContentOutputResearch"
>>;

function requireAiContentRenderWorkerRepository(repository: ApiRepository): AiContentRenderWorkerRepository {
  const candidate = repository as ApiRepository & Partial<AiContentRenderWorkerRepository>;
  const methods = [
    "claimAiContentRenderJob",
    "heartbeatAiContentRenderJob",
    "completeAiContentRenderAsset",
    "completeAiContentRenderPackage",
    "failAiContentRenderJob",
    "saveAiContentOutputResearch",
  ] as const;
  if (methods.some((method) => typeof candidate[method] !== "function")) {
    throw new Error("ai_content_render_repository_not_configured");
  }
  return candidate as AiContentRenderWorkerRepository;
}

type ContentProposalCustomerRepository = Required<Pick<ApiRepository,
  "createAiContentProposalBatch"
  | "getAiContentProposalBatch"
  | "listAiContentProposals"
  | "selectAiContentProposal"
  | "dismissAiContentProposal"
  | "listAiContentDraftReferences"
>>;

function requireContentProposalCustomerRepository(
  repository: ApiRepository,
): ContentProposalCustomerRepository {
  const candidate = repository as ApiRepository & Partial<ContentProposalCustomerRepository>;
  const methods = [
    "createAiContentProposalBatch",
    "getAiContentProposalBatch",
    "listAiContentProposals",
    "selectAiContentProposal",
    "dismissAiContentProposal",
    "listAiContentDraftReferences",
  ] as const;
  if (methods.some((method) => typeof candidate[method] !== "function")) {
    throw new Error("content_proposal_repository_not_configured");
  }
  return candidate as ContentProposalCustomerRepository;
}

function safeAiContentAttachmentGcResult(
  result: AiContentAttachmentGcRunResult,
): AiContentAttachmentGcRunResult {
  return {
    sessions: {
      scanned: result.sessions.scanned,
      claimed: result.sessions.claimed,
      confirmed: result.sessions.confirmed,
      expired: result.sessions.expired,
    },
    deletions: {
      claimed: result.deletions.claimed,
      started: result.deletions.started,
      succeeded: result.deletions.succeeded,
      failed: result.deletions.failed,
      retried: result.deletions.retried,
      releasedUnstarted: result.deletions.releasedUnstarted,
    },
    leasesReclaimed: result.leasesReclaimed,
    eligibleQueueDepth: result.eligibleQueueDepth,
    oldestEligiblePendingAgeSeconds: result.oldestEligiblePendingAgeSeconds,
    heldJobCount: result.heldJobCount,
    oldestHeldAgeSeconds: result.oldestHeldAgeSeconds,
    holdReasonCounts: { ...result.holdReasonCounts },
    attemptCountBuckets: { ...result.attemptCountBuckets },
    deadLetterCount: result.deadLetterCount,
    durationMs: result.durationMs,
    providerErrorCategories: { ...result.providerErrorCategories },
  };
}

export function parseAiContentAttachmentGcRequestBody(
  value: unknown,
): { batchSize: number } {
  if (value === undefined) return { batchSize: 25 };
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error("ai_content_attachment_gc_request_body_invalid");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => key !== "batchSize")) {
    throw new Error("ai_content_attachment_gc_request_body_invalid");
  }
  if (keys.length === 0) return { batchSize: 25 };
  const { batchSize } = value as { batchSize?: unknown };
  if (!Number.isInteger(batchSize) || Number(batchSize) < 1 || Number(batchSize) > 100) {
    throw new Error("ai_content_attachment_gc_batch_size_invalid");
  }
  return { batchSize: Number(batchSize) };
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

export function asCreatableSupportRequestCategory(value: unknown): SupportRequestCategory | null {
  return typeof value === "string" && creatableSupportRequestCategories.has(value) ? (value as SupportRequestCategory) : null;
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

function matchesOpaqueSecret(candidate: string | null | undefined, expected: string | null | undefined) {
  if (!candidate || !expected) return false;
  const candidateDigest = createHash("sha256").update(candidate).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

function sessionCookie(value: string, maxAge: number, secure: boolean) {
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

function publicBrandAnalysisError(errorCode: string | null) {
  switch (errorCode) {
    case "brand_analysis_owned_page_success_threshold_not_met":
      return "자사 사이트에서 필요한 수의 중요 페이지를 읽지 못했습니다. URL을 확인한 뒤 다시 시도해 주세요.";
    case "analysis_deadline_exceeded":
    case "brand_intelligence_codex_timeout":
    case "brand_intelligence_stage_timeout":
      return "최대 분석 시간 20분을 초과했습니다. 잠시 후 다시 시도해 주세요.";
    case "scanned_pdf_not_supported":
      return "텍스트가 없는 스캔 PDF는 분석할 수 없습니다.";
    default:
      return errorCode ? "브랜드 분석을 완료하지 못했습니다. 입력을 확인한 뒤 다시 시도해 주세요." : null;
  }
}

function toPublicBrandAnalysis(analysis: BrandAnalysisRecord | null) {
  if (!analysis) return null;
  const {
    evidence: _evidence,
    leasedBy: _leasedBy,
    leaseToken: _leaseToken,
    leaseExpiresAt: _leaseExpiresAt,
    idempotencyKey: _idempotencyKey,
    workspaceId: _workspaceId,
    attemptCount: _attemptCount,
    ...publicAnalysis
  } = analysis;
  return {
    ...publicAnalysis,
    errorMessage: analysis.status === "failed"
      ? publicBrandAnalysisError(analysis.errorCode)
      : null,
  };
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
  { repository, aiContentProposalV2, workerApiToken, contentProposalWorkerApiToken, cronSecret, kakaoAuth, kakao, instagramLogin, facebookLogin, metaWebhook, brandLogoService, aiContentUpload, aiContentAttachmentGc, assetLibraryUpload, aiContentLimits, subjectAnalysis, brandIntelligenceRepository, brandAnalysisUpload, runtimePolicy, readinessPolicy, logger }: CreateServerOptions,
  app: FastifyInstance = Fastify(createFastifyOptions(logger))
) {
  const aiContentAttachmentRepository = aiContentUpload
    ? requireAiContentUploadRouteRepository(repository)
    : null;
  const httpPolicy: ApiHttpRuntimePolicy = runtimePolicy ?? {
    cookieSecure: false,
    corsAllowedOrigins: [],
    devAuthEnabled: false,
  };
  const corsAllowedOrigins = new Set(httpPolicy.corsAllowedOrigins);
  const subjectRepository = repository as ApiRepository & SubjectAnalysisRepository & SubjectAnalysisRepositoryV2;
  const maintenanceRepository = repository as ApiRepository & {
    assertAiContentWritable?: () => Promise<void>;
  };
  void app.register(cors, {
    origin: (origin, callback) => callback(null, origin !== undefined && corsAllowedOrigins.has(origin)),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  app.setErrorHandler((error, request, reply) => {
    const message = error instanceof Error ? error.message : "unknown_error";
    if (message === "ai_content_maintenance") {
      reply.code(503).send({ error: message });
      return;
    }
    if (message === "worker_resource_lease_invalid") {
      reply.code(409).send({ error: message });
      return;
    }
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
    if (message === "publishing_disabled") {
      reply.code(503).send({ error: "publishing_disabled" });
      return;
    }
    if (message === "RESOURCE_NOT_AVAILABLE") {
      reply.code(404).send({ error: message });
      return;
    }
    if (message === "content_proposal_v2_not_configured") {
      reply.code(503).send({ error: message });
      return;
    }
    if (message === "content_proposals_disabled" || message === "content_proposal_worker_not_ready") {
      reply.code(503).send({ error: message });
      return;
    }
    if (message === "performance_evidence_stale") {
      reply.code(412).send({ error: message });
      return;
    }
    if (message === "performance_proposal_request_invalid"
      || message === "performance_evidence_version_required"
      || message === "performance_evidence_version_invalid"
      || message === "performance_experiment_invalid") {
      reply.code(400).send({ error: message });
      return;
    }
    if (message === "performance_experiment_not_available") {
      reply.code(409).send({ error: message });
      return;
    }
    if (message.startsWith("content_orchestration_")) {
      reply.code(400).send({ error: message });
      return;
    }
    if (message === "content_finalization_draft_v2_invalid"
      || message === "content_generation_start_v2_invalid") {
      reply.code(400).send({ error: message });
      return;
    }
    if (message === "ai_content_contract_version_unsupported"
      || message === "ai_content_v3_contract_required") {
      reply.code(400).send({ error: message });
      return;
    }
    if (message.startsWith("brand_core_validation_failed:")) {
      reply.code(400).send({
        error: "brand_core_validation_failed",
        field: message.slice("brand_core_validation_failed:".length),
      });
      return;
    }
    if (message === "brand_style_reference_invalid") {
      reply.code(400).send({ error: message });
      return;
    }
    if (message.startsWith("product_service_validation_failed:")) {
      reply.code(400).send({
        error: "product_service_validation_failed",
        field: message.slice("product_service_validation_failed:".length),
      });
      return;
    }
    if (message.startsWith("avatar_validation_failed:")
      || message.startsWith("reference_validation_failed:")
      || message.startsWith("reference_filter_invalid:")
      || message.startsWith("reference_brand_validation_failed:")
      || message.startsWith("asset_upload_validation_failed:")) {
      const separator = message.indexOf(":");
      reply.code(400).send({ error: message.slice(0, separator), field: message.slice(separator + 1) });
      return;
    }
    if (message === "asset_library_admin_required" || message === "asset_library_access_forbidden") {
      reply.code(403).send({ error: message });
      return;
    }
    if (message === "asset_library_not_configured" || message === "asset_library_upload_storage_not_configured") {
      reply.code(503).send({ error: message });
      return;
    }
    if (message === "asset_library_blob_delete_failed") {
      reply.code(503).send({ error: message });
      return;
    }
    if (message.startsWith("asset_library_upload_") || message === "avatar_image_limit_exceeded"
      || message === "avatar_image_minimum_required" || message === "avatar_image_duplicate"
      || message === "reference_origin_duplicate"
      || message === "reference_brand_author_unavailable") {
      const conflict = message === "asset_library_upload_replayed" || message === "reference_origin_duplicate"
        || message === "avatar_image_limit_exceeded" || message === "avatar_image_minimum_required"
        || message === "avatar_image_duplicate";
      reply.code(conflict ? 409 : 400).send({ error: message });
      return;
    }
    if (message === "brand_core_approval_forbidden" || message === "brand_core_access_forbidden") {
      reply.code(403).send({ error: message });
      return;
    }
    if (message === "product_service_approval_forbidden" || message === "product_service_access_forbidden") {
      reply.code(403).send({ error: message });
      return;
    }
    if (message === "faq_suggestion_approval_forbidden" || message === "faq_suggestion_access_forbidden") {
      reply.code(403).send({ error: message });
      return;
    }
    if (message === "wiki_item_approval_forbidden" || message === "wiki_item_access_forbidden"
      || message === "wiki_issue_resolution_forbidden") {
      reply.code(403).send({ error: message });
      return;
    }
    if ([
      "brand_core_not_draft",
      "brand_core_version_conflict",
      "brand_rules_not_draft",
      "brand_rules_version_conflict",
      "wiki_issue_not_open",
      "wiki_issue_source_ineligible",
      "faq_suggestion_sources_missing",
      "faq_suggestion_item_conflict",
    ].includes(message)) {
      reply.code(409).send({ error: message });
      return;
    }
    if (message === "brand_center_not_configured" || message === "product_library_not_configured"
      || message === "wiki_management_not_configured" || message === "faq_suggestion_not_configured") {
      reply.code(503).send({ error: message });
      return;
    }
    if (message.startsWith("wiki_item_validation_failed:") || message.startsWith("wiki_issue_validation_failed:")) {
      const separator = message.indexOf(":");
      reply.code(400).send({ error: message.slice(0, separator), field: message.slice(separator + 1) });
      return;
    }
    if (message.startsWith("faq_suggestion_validation_failed:")) {
      const separator = message.indexOf(":");
      reply.code(400).send({ error: message.slice(0, separator), field: message.slice(separator + 1) });
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
    if (message === "dm_manual_reply_channel_not_ready") {
      reply.code(409).send({ error: message, deliveryStatus: null, requestId: request.id });
      return;
    }
    if (message === "dm_manual_reply_idempotency_conflict") {
      reply.code(409).send({ error: message, deliveryStatus: "failed", requestId: request.id });
      return;
    }
    const manualReplyFailure = /^dm_manual_reply_(failed|unknown):(.+)$/.exec(message);
    if (manualReplyFailure) {
      reply.code(502).send({
        error: manualReplyFailure[2],
        deliveryStatus: manualReplyFailure[1],
        requestId: request.id,
      });
      return;
    }
    if (message === "brand_color_too_long") {
      reply.code(400).send({ error: message });
      return;
    }
    if (message.startsWith("brand_analysis_") || message.startsWith("brand_intelligence_")
      || message === "scanned_pdf_not_supported") {
      const conflict = [
        "brand_analysis_not_review_ready",
        "brand_analysis_lease_invalid",
        "brand_analysis_company_name_conflict",
        "brand_analysis_not_retryable",
        "brand_analysis_confirmed_cannot_cancel",
        "brand_analysis_upload_state_invalid",
        "brand_analysis_uploads_incomplete",
        "brand_analysis_cancel_state_invalid",
      ].includes(message);
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
      } else if (
        message === "ai_content_proposal_not_found"
        || message === "ai_content_proposal_batch_not_found"
        || message === "ai_content_generation_not_found"
      ) {
        reply.code(404).send({ error: message });
      } else if (
        message === "ai_content_attachment_storage_not_configured"
        || message === "ai_content_attachment_storage_unavailable"
        || message === "ai_content_attachment_verification_timeout"
      ) {
        reply.code(503).send({ error: message });
      } else if (
        message === "ai_content_upload_session_expired"
        || message === "ai_content_attachment_retention_expired"
      ) {
        reply.code(410).send({ error: message });
      } else if (
        message === "ai_content_attachment_blob_unavailable"
        || message === "ai_content_attachment_path_mismatch"
        || message === "ai_content_attachment_size_mismatch"
        || message === "ai_content_attachment_mime_mismatch"
        || message === "ai_content_attachment_url_mismatch"
      ) {
        reply.code(422).send({ error: message });
      } else if (
        message === "ai_content_generation_not_analysis_ready"
        || message === "ai_content_publish_target_unsupported"
        || message === "ai_content_attachment_limit_exceeded"
        || message === "ai_content_attachments_locked"
        || message === "ai_content_attachment_upload_in_progress"
        || message === "ai_content_proposal_batch_not_ready"
        || message === "ai_content_proposal_already_selected"
        || message === "ai_content_proposal_not_selectable"
        || message === "ai_content_proposal_not_dismissible"
        || message.endsWith("_conflict")
      ) {
        reply.code(409).send({ error: message });
      } else {
        reply.code(400).send({ error: message });
      }
      return;
    }
    if (message === "content_proposals_disabled" || message === "content_proposal_worker_not_ready") {
      reply.code(503).send({ error: message });
      return;
    }
    if (message.startsWith("content_proposal_")) {
      const status = message === "content_proposal_job_not_found"
        ? 404
        : message === "content_proposal_job_lease_invalid" || message.endsWith("_conflict")
          ? 409
          : 400;
      reply.code(status).send({ error: message });
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
    const route = request.routeOptions.url ?? "";
    const method = request.method.toUpperCase();
    const aiContentMutation = (
      (["POST", "PUT", "PATCH", "DELETE"].includes(method) && route.includes("/ai-content"))
      || (method === "POST" && route === "/brands/:brandId/content-generation/run")
      || (method === "GET" && route === "/internal/cron/daily-generation")
      || (method === "POST" && route === "/internal/cron/ai-content-attachment-gc")
      || (method === "GET" && (
        route === "/brands/:brandId/ai-content/outputs/:outputId/download"
        || route === "/brands/:brandId/ai-content/generations/:generationId/download"
      ))
      || (["POST", "PUT", "PATCH", "DELETE"].includes(method) && route.startsWith("/worker/ai-content-"))
    );
    if (maintenanceRepository.assertAiContentWritable
      && aiContentMutation) {
      await maintenanceRepository.assertAiContentWritable();
    }
    if (!kakaoAuth || route === "/health" || route === "/ready" || request.url.startsWith("/auth/") || request.url.startsWith("/admin/v1/") || request.url.startsWith("/webhooks/") || request.url.startsWith("/worker/") || request.url.startsWith("/workers/") || request.url.startsWith("/internal/cron/")) return;
    const token = readCookie(request.headers.cookie, "bp_session");
    const session = token ? await kakaoAuth.getSession(token) : null;
    if (!session) {
      reply.code(401).send({ error: "authentication_required" });
      return reply;
    }
    (request as typeof request & { aiContentSession?: AuthSession }).aiContentSession = session;
    const params = request.params as Record<string, string>;
    const brandId = params.brandId;
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
    return { ok: true };
  });

  app.get("/ready", async (_request, reply) => {
    try {
      const health = await repository.health();
      const readiness = assessApiReadiness({
        database: health.database,
        schedulerEnabled: readinessPolicy?.schedulerEnabled ?? false,
        publishingEnabled: readinessPolicy?.publishingEnabled ?? false,
        dmWorkersEnabled: readinessPolicy?.dmWorkersEnabled ?? false,
        activeDmEnabled: health.operations?.activeDmEnabled ?? false,
        dmWorker: health.operations?.dmWorker ?? "offline",
        wikiWorker: health.operations?.wikiWorker ?? "offline",
        contentProposalsEnabled: readinessPolicy?.contentProposalsEnabled ?? false,
        contentProposalWorker: health.operations?.contentProposalWorker ?? "offline",
      });
      reply.code(readiness.statusCode);
      return readiness.body;
    } catch {
      const readiness = assessApiReadiness({
        database: "error",
        schedulerEnabled: readinessPolicy?.schedulerEnabled ?? false,
        publishingEnabled: readinessPolicy?.publishingEnabled ?? false,
        dmWorkersEnabled: readinessPolicy?.dmWorkersEnabled ?? false,
        activeDmEnabled: false,
        dmWorker: "offline",
        wikiWorker: "offline",
        contentProposalsEnabled: readinessPolicy?.contentProposalsEnabled ?? false,
        contentProposalWorker: "offline",
      });
      reply.code(readiness.statusCode);
      return readiness.body;
    }
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

  app.get("/internal/cron/avatar-upload-cleanup", async (request, reply) => {
    if (!matchesBearerSecret(request.headers.authorization, cronSecret)) {
      reply.code(401);
      return { error: "cron_unauthorized" };
    }
    if (!repository.cleanupExpiredAvatarUploads
      || !repository.cleanupExpiredReferenceUploads
      || !assetLibraryUpload) {
      throw new Error("asset_library_not_configured");
    }
    const { cleanupAssetLibraryUploadPrefix } = await import("./assetLibraryUpload.js");
    const result = await repository.cleanupExpiredAvatarUploads(
      (storagePathPrefix, storagePath) => cleanupAssetLibraryUploadPrefix(storagePathPrefix, storagePath, {
        token: assetLibraryUpload.readWriteToken,
        deleteBlob: assetLibraryUpload.deleteBlob,
        listBlobs: assetLibraryUpload.listBlobs,
      }),
    );
    if (result.failed.length) {
      request.log.error({ event: "avatar_upload_cleanup_partial_failure", ...result });
    }
    const referenceResult = await repository.cleanupExpiredReferenceUploads(
      (storagePathPrefix, storagePath) => cleanupAssetLibraryUploadPrefix(storagePathPrefix, storagePath, {
        token: assetLibraryUpload.readWriteToken,
        deleteBlob: assetLibraryUpload.deleteBlob,
        listBlobs: assetLibraryUpload.listBlobs,
      }),
    );
    if (referenceResult.failed.length) {
      request.log.error({ event: "reference_upload_cleanup_partial_failure", ...referenceResult });
    }
    return result;
  });

  app.post("/internal/cron/ai-content-attachment-gc", async (request, reply) => {
    if (!matchesBearerSecret(request.headers.authorization, cronSecret)) {
      reply.code(401);
      return { error: "cron_unauthorized" };
    }
    const gcRepository = asAiContentAttachmentGcRepository(repository);
    if (!aiContentAttachmentGc || !gcRepository) {
      reply.code(503);
      return { error: "ai_content_attachment_gc_not_configured" };
    }
    let body: { batchSize: number };
    try {
      body = parseAiContentAttachmentGcRequestBody(request.body);
    } catch (error) {
      reply.code(400);
      const code = error instanceof Error
        && (
          error.message === "ai_content_attachment_gc_request_body_invalid"
          || error.message === "ai_content_attachment_gc_batch_size_invalid"
        )
        ? error.message
        : "ai_content_attachment_gc_request_body_invalid";
      return {
        error: code,
      };
    }
    const unsafeResult: AiContentAttachmentGcRunResult = await (
      aiContentAttachmentGc.runGc ?? runAiContentAttachmentGc
    )(gcRepository, {
      workerId: aiContentAttachmentGc.workerId ?? "api-cron",
      batchSize: body.batchSize,
      deleteBlob: aiContentAttachmentGc.deleteBlob,
    });
    const result = safeAiContentAttachmentGcResult(unsafeResult);
    request.log.info({ event: "ai_content_attachment_gc_completed", ...result });
    return result;
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

  app.get<{ Querystring: { destination?: string } }>("/auth/kakao/login", async (request, reply) => {
    if (!kakao?.restApiKey || !kakao.redirectUri) {
      reply.code(503);
      return { error: "kakao_auth_not_configured" };
    }
    const destination = request.query.destination ?? "primary";
    if (
      (destination !== "primary" && destination !== "preview")
      || (destination === "preview" && !httpPolicy.previewFrontendOrigin)
    ) {
      reply.code(400);
      return { error: "kakao_login_destination_invalid" };
    }
    const state = crypto.randomUUID();
    reply.header(
      "set-cookie",
      cookie(
        `${kakaoStateCookiePrefix}${state}`,
        destination === "preview" ? "preview" : "1",
        600,
        httpPolicy.cookieSecure,
      ),
    );
    const url = new URL("https://kauth.kakao.com/oauth/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", kakao.restApiKey);
    url.searchParams.set("redirect_uri", kakao.redirectUri);
    url.searchParams.set("state", state);
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/auth/kakao/callback", async (request, reply) => {
    const primaryFrontendUrl = kakao?.frontendUrl ?? "http://localhost:5173";
    if (!kakaoAuth || !kakao?.restApiKey || !kakao.redirectUri) {
      request.log.warn({ event: "kakao_callback_failed", reason: "configuration_missing" }, "kakao_callback_failed");
      return reply.redirect(`${primaryFrontendUrl}/login?error=kakao_configuration_missing`);
    }
    const stateCookieName = request.query.state ? kakaoStateCookieName(request.query.state) : null;
    const stateCookie = stateCookieName ? readCookie(request.headers.cookie, stateCookieName) : null;
    const frontendUrl = stateCookie === "preview" && httpPolicy.previewFrontendOrigin
      ? httpPolicy.previewFrontendOrigin
      : primaryFrontendUrl;
    if (request.query.error || !request.query.code) {
      request.log.warn({ event: "kakao_callback_failed", reason: "authorization_denied", kakaoError: request.query.error ?? null }, "kakao_callback_failed");
      return reply.redirect(`${frontendUrl}/login?error=kakao_authorization_denied`);
    }
    // Supports an in-flight login initiated before the per-attempt cookie rollout.
    const legacyStateMatches = request.query.state !== undefined && readCookie(request.headers.cookie, "bp_kakao_state") === request.query.state;
    const stateCookieMatches = stateCookie === "1"
      || (stateCookie === "preview" && Boolean(httpPolicy.previewFrontendOrigin));
    if (!request.query.state || (!stateCookieMatches && !legacyStateMatches)) {
      request.log.warn({ event: "kakao_callback_failed", reason: "state_mismatch" }, "kakao_callback_failed");
      return reply.redirect(`${frontendUrl}/login?error=kakao_state_mismatch`);
    }
    const clearStateCookie = cookie(
      legacyStateMatches ? "bp_kakao_state" : stateCookieName!,
      "",
      0,
      httpPolicy.cookieSecure
    );
    const tokenBody = new URLSearchParams({ grant_type: "authorization_code", client_id: kakao.restApiKey, redirect_uri: kakao.redirectUri, code: request.query.code });
    if (kakao.clientSecret) tokenBody.set("client_secret", kakao.clientSecret);
    const tokenResponse = await fetch("https://kauth.kakao.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" }, body: tokenBody });
    const tokenPayload = await tokenResponse.json() as Record<string, unknown>;
    if (!tokenResponse.ok || typeof tokenPayload.access_token !== "string") {
      request.log.warn({ event: "kakao_callback_failed", reason: "token_exchange_failed", status: tokenResponse.status }, "kakao_callback_failed");
      reply.header("set-cookie", clearStateCookie);
      return reply.redirect(`${frontendUrl}/login?error=kakao_token_exchange_failed`);
    }
    const profileResponse = await fetch("https://kapi.kakao.com/v2/user/me", { headers: { authorization: `Bearer ${tokenPayload.access_token}` } });
    const profilePayload = await profileResponse.json() as Record<string, unknown>;
    const account = isObject(profilePayload.kakao_account) ? profilePayload.kakao_account : {};
    const properties = isObject(profilePayload.properties) ? profilePayload.properties : {};
    if (!profileResponse.ok || (typeof profilePayload.id !== "number" && typeof profilePayload.id !== "string")) {
      request.log.warn({ event: "kakao_callback_failed", reason: "profile_fetch_failed", status: profileResponse.status }, "kakao_callback_failed");
      reply.header("set-cookie", clearStateCookie);
      return reply.redirect(`${frontendUrl}/login?error=kakao_profile_fetch_failed`);
    }
    const profile: KakaoProfile = { subject: String(profilePayload.id), nickname: typeof properties.nickname === "string" ? properties.nickname : null, email: typeof account.email === "string" ? account.email : null };
    const session = await kakaoAuth.createOrLoadUser(profile);
    const sessionToken = await kakaoAuth.createSession(session.userId);
    reply.header("set-cookie", [sessionCookie(sessionToken, 60 * 60 * 24 * 7, httpPolicy.cookieSecure), clearStateCookie]);
    return reply.redirect(`${frontendUrl}/onboarding/brand-intelligence`);
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = readCookie(request.headers.cookie, "bp_session");
    if (token && kakaoAuth) await kakaoAuth.revokeSession(token);
    reply.header("set-cookie", [
      sessionCookie("", 0, httpPolicy.cookieSecure),
      ...clearInstagramLoginCookies(httpPolicy.cookieSecure),
    ]);
    return { ok: true };
  });

  app.get("/auth/meta/start", async (request, reply) => {
    if (!instagramLogin?.appId || !instagramLogin.appSecret || !instagramLogin.redirectUri) {
      reply.code(503);
      return { error: "instagram_login_not_configured" };
    }
    const state = randomUUID();
    let session: AuthSession = null;
    let sessionToken: string | null = null;
    const developmentBrandId = process.env.BRAND_PILOT_DEV_BRAND_ID ?? defaultDevBrandId;
    if (kakaoAuth) {
      sessionToken = readCookie(request.headers.cookie, "bp_session");
      session = sessionToken ? await kakaoAuth.getSession(sessionToken) : null;
      if (!session || !await kakaoAuth.canAccessBrand(session.userId, session.brandId)) {
        reply.code(401);
        return { error: "authentication_required" };
      }
    }
    const binding = encodeInstagramLoginBinding({
      appSecret: instagramLogin.appSecret,
      state,
      sessionToken,
      session,
      developmentBrandId,
    });
    reply.header("set-cookie", [
      cookie(instagramLoginStateCookie, state, 10 * 60, httpPolicy.cookieSecure),
      cookie(instagramLoginBindingCookie, binding, 10 * 60, httpPolicy.cookieSecure),
    ]);
    return reply.redirect(buildInstagramLoginAuthorizeUrl({
      appId: instagramLogin.appId,
      redirectUri: instagramLogin.redirectUri,
      state,
    }));
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>("/auth/meta/callback", async (request, reply) => {
    const clearPending = clearInstagramLoginCookies(httpPolicy.cookieSecure);
    if (!instagramLogin?.appId || !instagramLogin.appSecret || !instagramLogin.redirectUri) {
      reply.header("set-cookie", clearPending).code(503);
      return { error: "instagram_login_not_configured" };
    }
    const storedState = readCookie(request.headers.cookie, instagramLoginStateCookie);
    if (!matchesOpaqueSecret(request.query.state, storedState)) {
      return reply.redirect(instagramLoginCallbackUrl(
        instagramLogin.frontendUrl,
        "failed",
        "invalid_callback",
      ));
    }
    const binding = decodeInstagramLoginBinding(
      readCookie(request.headers.cookie, instagramLoginBindingCookie),
      instagramLogin.appSecret,
    );
    if (
      !binding
      || !matchesOpaqueSecret(
        binding.stateDigest,
        keyedDigest(instagramLogin.appSecret, "state", request.query.state!),
      )
    ) {
      return reply.redirect(instagramLoginCallbackUrl(
        instagramLogin.frontendUrl,
        "failed",
        "invalid_callback",
      ));
    }
    let brandId = process.env.BRAND_PILOT_DEV_BRAND_ID ?? defaultDevBrandId;
    if (kakaoAuth) {
      const currentSessionToken = readCookie(request.headers.cookie, "bp_session");
      const currentSession = currentSessionToken
        ? await kakaoAuth.getSession(currentSessionToken)
        : null;
      const sessionMatches = binding.mode === "session"
        && currentSession
        && matchesOpaqueSecret(
          binding.sessionDigest,
          keyedDigest(instagramLogin.appSecret, "session", currentSessionToken!),
        )
        && matchesOpaqueSecret(
          binding.identityDigest,
          keyedDigest(
            instagramLogin.appSecret,
            "identity",
            instagramLoginIdentity(currentSession),
          ),
        );
      const authorized = sessionMatches
        ? await kakaoAuth.canAccessBrand(currentSession.userId, currentSession.brandId)
        : false;
      if (!sessionMatches || !authorized) {
        reply.header("set-cookie", clearPending);
        return reply.redirect(instagramLoginCallbackUrl(
          instagramLogin.frontendUrl,
          "failed",
          "invalid_callback",
        ));
      }
      brandId = currentSession.brandId;
    } else {
      const developmentMatches = binding.mode === "development"
        && binding.sessionDigest === null
        && matchesOpaqueSecret(
          binding.identityDigest,
          keyedDigest(instagramLogin.appSecret, "identity", `development\0${brandId}`),
        );
      if (!developmentMatches) {
        return reply.redirect(instagramLoginCallbackUrl(
          instagramLogin.frontendUrl,
          "failed",
          "invalid_callback",
        ));
      }
    }
    reply.header("set-cookie", clearPending);
    if (request.query.error) {
      return reply.redirect(instagramLoginCallbackUrl(instagramLogin.frontendUrl, "cancelled"));
    }
    if (!request.query.code) {
      return reply.redirect(instagramLoginCallbackUrl(
        instagramLogin.frontendUrl,
        "failed",
        "invalid_callback",
      ));
    }
    let failureReason: InstagramLoginCallbackFailureReason = "token_exchange_failed";
    try {
      const token = await exchangeInstagramLoginCode({
        code: request.query.code,
        appId: instagramLogin.appId,
        appSecret: instagramLogin.appSecret,
        redirectUri: instagramLogin.redirectUri,
      });
      failureReason = "account_mapping_failed";
      const connection = await resolveInstagramLoginConnection({ accessToken: token.accessToken });
      failureReason = "connection_failed";
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
      return reply.redirect(instagramLoginCallbackUrl(instagramLogin.frontendUrl, "connected"));
    } catch (error) {
      request.log.warn({ event: "instagram_login_callback_failed", errorCode: safeInternalErrorCode(error) }, "instagram_login_callback_failed");
      return reply.redirect(instagramLoginCallbackUrl(
        instagramLogin.frontendUrl,
        "failed",
        failureReason,
      ));
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
    if (!httpPolicy.devAuthEnabled) {
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
    reply.header("set-cookie", cookie(instagramTrendStateCookie, state, 10 * 60, httpPolicy.cookieSecure));
    return reply.redirect(buildFacebookLoginAuthorizeUrl({
      appId: facebookLogin.appId,
      redirectUri: facebookLogin.redirectUri,
      state,
    }));
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>("/auth/meta/trends/callback", async (request, reply) => {
    const clearState = cookie(instagramTrendStateCookie, "", 0, httpPolicy.cookieSecure);
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

  app.post<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/performance-experiments/proposal-batches",
    async (request, reply) => {
      if (!aiContentProposalV2) throw new Error("content_proposal_v2_not_configured");
      if (!isObject(request.body)
        || Object.keys(request.body).sort().join(",") !== "evidenceVersion,experimentId"
        || typeof request.body.experimentId !== "string"
        || typeof request.body.evidenceVersion !== "string") {
        throw new Error("performance_proposal_request_invalid");
      }
      const scope = aiContentScope(request, request.params.brandId);
      const result = await aiContentProposalV2.service.create({
        source: "performance_experiment",
        workspaceId: scope.workspaceId,
        brandId: scope.brandId,
        actorUserId: requiredAiContentActorUserId(request),
        experimentId: request.body.experimentId,
        evidenceVersion: request.body.evidenceVersion,
      });
      reply.code(202);
      return { batchId: result.proposalBatchId, status: "queued" };
    },
  );

  app.get<{ Params: { brandId: string }; Querystring: { period?: string } }>(
    "/brands/:brandId/performance/insights",
    async (request, reply) => {
      if (request.query.period && request.query.period !== "30d") {
        reply.code(400);
        return { error: "performance_insights_period_invalid" };
      }
      if (!repository.getPerformanceInsights) throw new Error("performance_insights_repository_not_configured");
      return repository.getPerformanceInsights(request.params.brandId);
    },
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

  app.get<{
    Params: { brandId: string };
    Querystring: { page?: unknown; limit?: unknown };
  }>("/brands/:brandId/instagram-trends/archive", async (request, reply) => {
    const page = request.query.page === undefined ? 1 : Number(request.query.page);
    const limit = request.query.limit === undefined ? 30 : Number(request.query.limit);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      reply.code(400);
      return { error: "invalid_instagram_trend_archive_page" };
    }
    return repository.listInstagramTrendArchive(request.params.brandId, { page, limit });
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

  app.delete<{
    Params: { brandId: string; mediaId: string };
  }>("/brands/:brandId/instagram-trends/:mediaId/save-source", async (request, reply) => {
    return instagramTrendResponse(
      reply,
      () => repository.removeInstagramTrendSource(
        request.params.brandId,
        request.params.mediaId,
        aiContentActorUserId(request),
      )
    );
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/instagram-trend-searches", async (request) => {
    return repository.listInstagramTrendSearches(request.params.brandId);
  });

  app.delete<{ Params: { brandId: string; hashtagId: string } }>("/brands/:brandId/instagram-trend-searches/:hashtagId", async (request, reply) => {
    return instagramTrendResponse(
      reply,
      () => repository.deleteInstagramTrendSearch(request.params.brandId, request.params.hashtagId)
    );
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
      () => repository.saveInstagramTrendSource(
        request.params.brandId,
        request.params.mediaId,
        aiContentActorUserId(request),
      )
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

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/channels/capabilities", async (request) => {
    const channels = await repository.listChannels(request.params.brandId);
    const instagramSettings = await repository.listInstagramFormats(request.params.brandId);
    const instagramContext = await repository.getInstagramChannelCapabilityContext(request.params.brandId);
    return buildChannelCapabilities({
      channels,
      instagramFormats: instagramSettings.formats,
      instagramContext,
    });
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
    const category = asCreatableSupportRequestCategory(request.body.category);
    const providedTitle = typeof request.body.title === "string" ? request.body.title.trim() : "";
    const message = typeof request.body.message === "string" ? request.body.message.trim() : "";
    if (!category || message.length === 0) {
      reply.code(400);
      return { error: "support_request_required_fields" };
    }
    const title = providedTitle || supportRequestCategoryTitles[category];
    const contactPhone = normalizeSupportContactPhone(request.body.contactPhone);
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

  app.post<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/feedback", async (request, reply) => {
    const message = isObject(request.body) && typeof request.body.message === "string"
      ? request.body.message.trim()
      : "";
    if (!message) {
      reply.code(400);
      return { error: "feedback_message_required" };
    }
    if (message.length > 2000) {
      reply.code(400);
      return { error: "feedback_message_too_long" };
    }
    const feedback = await repository.createFeedbackSubmission(request.params.brandId, { message });
    reply.code(201);
    return feedback;
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
    const settings = await repository.getInstagramDmSettings(request.params.brandId);
    const webhookConfigured = Boolean(metaWebhook?.appSecret && metaWebhook.verifyToken);
    return {
      ...settings,
      webhookStatus: webhookConfigured ? "connected" as const : "needs_attention" as const,
    };
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
      if (body.enabled === true) {
        let current = await repository.getInstagramDmSettings(request.params.brandId);
        if (current.wikiStatus === "empty" || current.wikiStatus === "failed") {
          const provisioning = await repository.ensureInitialWikiBuild?.(request.params.brandId);
          if (provisioning && provisioning.state !== "already_active") {
            reply.code(409);
            return { error: "dm_activation_blocked" };
          }
          current = await repository.getInstagramDmSettings(request.params.brandId);
        }
        if (!isDmAutomationReady({
          ...current,
          webhookStatus: metaWebhook?.appSecret && metaWebhook.verifyToken
            ? "connected"
            : "needs_attention",
        })) {
          reply.code(409);
          return { error: "dm_activation_blocked" };
        }
      }
      const settings = await repository.updateInstagramDmSettings(request.params.brandId, {
        enabled: body.enabled as boolean | undefined,
        fallbackMessage: body.fallbackMessage as string | undefined,
        errorMessage: body.errorMessage as string | undefined,
      });
      return {
        ...settings,
        webhookStatus: metaWebhook?.appSecret && metaWebhook.verifyToken
          ? "connected" as const
          : "needs_attention" as const,
      };
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

  registerBrandCenterRoutes(app, {
    repository,
    brandIntelligenceRepository,
    scope: aiContentScope,
    actorUserId: aiContentActorUserId,
    assetLibraryUpload,
  });

  app.get<{ Params: { brandId: string } }>(
    "/brands/:brandId/brand-intelligence",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      return {
        intelligence: toPublicBrandAnalysis(
          await brandIntelligenceRepository.getCurrentBrandIntelligence(
            aiContentScope(request, request.params.brandId),
          ),
        ),
      };
    },
  );

  app.get<{ Params: { brandId: string } }>(
    "/brands/:brandId/brand-intelligence/workflow",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      return {
        workflow: toPublicBrandAnalysis(
          await brandIntelligenceRepository.getOpenBrandAnalysis(
            aiContentScope(request, request.params.brandId),
          ),
        ),
      };
    },
  );

  app.get<{ Params: { brandId: string } }>(
    "/brands/:brandId/brand-intelligence/onboarding",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      const scope = aiContentScope(request, request.params.brandId);
      const [company, activeAnalysis] = await Promise.all([
        brandIntelligenceRepository.getBrandCompanyName?.(scope) ?? null,
        brandIntelligenceRepository.getOpenBrandAnalysis(scope),
      ]);
      return {
        companyName: company && company.state !== "provisional" ? company.name : "",
        companyNameState: company?.state ?? "provisional",
        activeAnalysis: toPublicBrandAnalysis(activeAnalysis),
      };
    },
  );

  app.post<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/brand-analyses",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      const parsed = parseCreateBrandAnalysisInput(request.body);
      return toPublicBrandAnalysis(await brandIntelligenceRepository.requestBrandAnalysis({
        ...aiContentScope(request, request.params.brandId),
        ...parsed,
      }));
    },
  );

  app.get<{ Params: { brandId: string; analysisId: string } }>(
    "/brands/:brandId/brand-analyses/:analysisId",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      const analysis = await brandIntelligenceRepository.getBrandAnalysis({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
      });
      if (!analysis) throw new Error("brand_analysis_not_found");
      return toPublicBrandAnalysis(analysis);
    },
  );

  app.post<{ Params: { brandId: string; analysisId: string } }>(
    "/brands/:brandId/brand-analyses/:analysisId/cancel",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      return toPublicBrandAnalysis(await brandIntelligenceRepository.cancelBrandAnalysis({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
      }));
    },
  );

  app.post<{ Params: { brandId: string; analysisId: string } }>(
    "/brands/:brandId/brand-analyses/:analysisId/retry",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      return toPublicBrandAnalysis(await brandIntelligenceRepository.retryBrandAnalysis({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
      }));
    },
  );

  app.patch<{ Params: { brandId: string; analysisId: string }; Body: unknown }>(
    "/brands/:brandId/brand-analyses/:analysisId/draft",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      return toPublicBrandAnalysis(await brandIntelligenceRepository.updateBrandAnalysisDraft({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
        ...parseEditBrandAnalysisInput(request.body),
      }));
    },
  );

  app.post<{
    Params: { brandId: string; analysisId: string };
    Body: Record<string, unknown>;
  }>(
    "/brands/:brandId/brand-analyses/:analysisId/confirm",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      const companyName = requiredAiContentField(
        request.body.companyName,
        "brand_analysis_company_name_required",
        100,
      ).normalize("NFKC").trim();
      const editedResult = request.body.editedResult === undefined
        ? undefined
        : parseBrandIntelligenceResult(request.body.editedResult);
      return toPublicBrandAnalysis(await brandIntelligenceRepository.confirmBrandAnalysis({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
        companyName,
        editedResult,
        actorUserId: aiContentActorUserId(request),
      }));
    },
  );

  app.post<{
    Params: { brandId: string; analysisId: string; uploadId: string };
    Body: Record<string, unknown>;
  }>(
    "/brands/:brandId/brand-analyses/:analysisId/uploads/:uploadId/token",
    async (request) => {
      if (!brandIntelligenceRepository || !brandAnalysisUpload) {
        throw new Error("brand_analysis_storage_not_configured");
      }
      const file = {
        fileName: requiredAiContentField(request.body.fileName, "brand_analysis_file_name_invalid", 160),
        mimeType: requiredAiContentField(request.body.mimeType, "brand_analysis_file_type_invalid", 200),
        byteSize: Number(request.body.byteSize),
        checksum: requiredAiContentField(request.body.checksum, "brand_analysis_checksum_invalid", 64).toLowerCase(),
      };
      const token = await issueBrandAnalysisUploadToken({
        brandId: request.params.brandId,
        uploadSessionId: request.params.analysisId,
        file,
      }, {
        token: brandAnalysisUpload.readWriteToken,
        generateClientToken: brandAnalysisUpload.generateClientToken,
      });
      await brandIntelligenceRepository.beginBrandAnalysisUpload({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
        uploadId: request.params.uploadId,
        storagePath: token.pathname,
        ...file,
      });
      return token;
    },
  );

  app.post<{
    Params: { brandId: string; analysisId: string; uploadId: string };
    Body: Record<string, unknown>;
  }>(
    "/brands/:brandId/brand-analyses/:analysisId/uploads/:uploadId/confirm",
    async (request) => {
      if (!brandIntelligenceRepository || !brandAnalysisUpload) {
        throw new Error("brand_analysis_storage_not_configured");
      }
      const verified = await verifyBrandAnalysisUpload({
        brandId: request.params.brandId,
        uploadSessionId: request.params.analysisId,
        file: {
          fileName: requiredAiContentField(request.body.fileName, "brand_analysis_file_name_invalid", 160),
          mimeType: requiredAiContentField(request.body.mimeType, "brand_analysis_file_type_invalid", 200),
          byteSize: Number(request.body.byteSize),
          checksum: requiredAiContentField(request.body.checksum, "brand_analysis_checksum_invalid", 64),
        },
        storagePath: requiredAiContentField(request.body.storagePath, "brand_analysis_upload_path_invalid", 2_000),
        storageUrl: requiredAiContentField(request.body.storageUrl, "brand_analysis_upload_url_invalid", 2_000),
      }, {
        token: brandAnalysisUpload.readWriteToken,
        headBlob: brandAnalysisUpload.headBlob,
      });
      await brandIntelligenceRepository.completeBrandAnalysisUpload({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
        uploadId: request.params.uploadId,
        storagePath: verified.storagePath,
        storageUrl: verified.storageUrl,
      });
      return { id: request.params.uploadId };
    },
  );

  app.post<{ Params: { brandId: string; analysisId: string } }>(
    "/brands/:brandId/brand-analyses/:analysisId/start",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      return toPublicBrandAnalysis(await brandIntelligenceRepository.startBrandAnalysis({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
      }));
    },
  );

  app.post<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/brand-intelligence/analyses",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      return toPublicBrandAnalysis(await brandIntelligenceRepository.requestBrandAnalysis({
        ...aiContentScope(request, request.params.brandId),
        ...parseCreateBrandAnalysisInput(request.body),
      }));
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
      return toPublicBrandAnalysis(analysis);
    },
  );

  app.patch<{ Params: { brandId: string; analysisId: string }; Body: unknown }>(
    "/brands/:brandId/brand-intelligence/analyses/:analysisId",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      return toPublicBrandAnalysis(await brandIntelligenceRepository.updateBrandAnalysisDraft({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
        ...parseEditBrandAnalysisInput(request.body),
      }));
    },
  );

  app.post<{ Params: { brandId: string; analysisId: string } }>(
    "/brands/:brandId/brand-intelligence/analyses/:analysisId/confirm",
    async (request) => {
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      return toPublicBrandAnalysis(await brandIntelligenceRepository.confirmBrandAnalysis({
        ...aiContentScope(request, request.params.brandId),
        analysisId: request.params.analysisId,
        actorUserId: aiContentActorUserId(request),
      }));
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

  app.post<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/proposal-batches",
    async (request, reply) => {
      if (isObject(request.body) && request.body.contractVersion === "content-orchestration.v2") {
        if (!aiContentProposalV2) throw new Error("content_proposal_v2_not_configured");
        const scope = aiContentScope(request, request.params.brandId);
        const result = await aiContentProposalV2.service.create({
          source: "manual",
          workspaceId: scope.workspaceId,
          brandId: scope.brandId,
          actorUserId: requiredAiContentActorUserId(request),
          request: request.body as never,
          idempotencyKey: requiredAiContentField(
            request.headers["idempotency-key"],
            "ai_content_idempotency_key_invalid",
            200,
          ),
        });
        reply.code(202);
        return { batchId: result.proposalBatchId, status: "queued" };
      }
      if (isObject(request.body) && Object.prototype.hasOwnProperty.call(request.body, "contractVersion")) {
        throw new Error("ai_content_proposal_contract_version_unsupported");
      }
      if (!(readinessPolicy?.contentProposalsEnabled ?? false)) {
        reply.code(503);
        return { error: "content_proposals_disabled" };
      }
      const health = await repository.health().catch(() => null);
      if (health?.operations?.contentProposalWorker !== "online") {
        reply.code(503);
        return { error: "content_proposal_worker_not_ready" };
      }
      const batch = await requireContentProposalCustomerRepository(repository).createAiContentProposalBatch({
        ...aiContentScope(request, request.params.brandId),
        actorUserId: requiredAiContentActorUserId(request),
        origin: "manual",
        idempotencyKey: requiredAiContentField(
          isObject(request.body) ? request.body.idempotencyKey : undefined,
          "ai_content_idempotency_key_invalid",
          200,
        ),
        request: parseContentProposalRequest(isObject(request.body) ? request.body.request : undefined),
      });
      reply.code(202);
      return { batchId: batch.id, status: batch.status };
    },
  );

  app.get<{
    Params: { brandId: string };
    Querystring: Record<string, unknown>;
  }>(
    "/brands/:brandId/ai-content/reference-seeds",
    async (request) => {
      const queryKeys = Object.keys(request.query);
      const format = request.query.format;
      if (
        queryKeys.length !== 1
        || queryKeys[0] !== "format"
        || typeof format !== "string"
        || !(["card_news", "blog", "reel"] as const).includes(
          format as "card_news" | "blog" | "reel",
        )
      ) {
        throw new Error("ai_content_reference_seed_query_invalid");
      }
      if (!aiContentProposalV2) throw new Error("content_proposal_v2_not_configured");
      const scope = aiContentScope(request, request.params.brandId);
      const approvedCore = await aiContentProposalV2.snapshotRepository.loadApprovedCore(scope);
      return repository.listAiContentReferenceSeeds({
        ...scope,
        primaryCategory: approvedCore.primaryCategory,
        format: format as ContentOutputFormatV2,
        limit: 20,
      });
    },
  );

  app.get<{ Params: { brandId: string; batchId: string } }>(
    "/brands/:brandId/ai-content/proposal-batches/:batchId",
    async (request) => {
      const batch = await requireContentProposalCustomerRepository(repository).getAiContentProposalBatch({
        ...aiContentScope(request, request.params.brandId),
        batchId: parseAiContentUuid(request.params.batchId, "ai_content_proposal_batch_id_invalid"),
      });
      if (!batch) throw new Error("ai_content_proposal_batch_not_found");
      return batch;
    },
  );

  app.get<{ Params: { brandId: string }; Querystring: { status?: string } }>(
    "/brands/:brandId/ai-content/proposals",
    async (request) => {
      const status = request.query.status ?? "suggested";
      if (!["suggested", "selected", "dismissed"].includes(status)) {
        throw new Error("ai_content_proposal_status_invalid");
      }
      return requireContentProposalCustomerRepository(repository).listAiContentProposals({
        ...aiContentScope(request, request.params.brandId),
        status: status as "suggested" | "selected" | "dismissed",
      });
    },
  );

  app.post<{ Params: { brandId: string; proposalId: string }; Body: Record<string, unknown> }>(
    "/brands/:brandId/ai-content/proposals/:proposalId/select",
    async (request) => {
      try {
        return await requireContentProposalCustomerRepository(repository).selectAiContentProposal({
          ...aiContentScope(request, request.params.brandId),
          actorUserId: requiredAiContentActorUserId(request),
          proposalId: parseAiContentUuid(request.params.proposalId, "ai_content_proposal_id_invalid"),
          idempotencyKey: requiredAiContentField(
            request.body?.idempotencyKey,
            "ai_content_idempotency_key_invalid",
            200,
          ),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const mapped: Record<string, string> = {
          proposal_not_found: "ai_content_proposal_not_found",
          proposal_batch_not_ready: "ai_content_proposal_batch_not_ready",
          proposal_already_selected: "ai_content_proposal_already_selected",
          proposal_not_selectable: "ai_content_proposal_not_selectable",
        };
        if (mapped[message]) throw new Error(mapped[message]);
        throw error;
      }
    },
  );

  app.post<{ Params: { brandId: string; proposalId: string } }>(
    "/brands/:brandId/ai-content/proposals/:proposalId/dismiss",
    async (request) => requireContentProposalCustomerRepository(repository).dismissAiContentProposal({
      ...aiContentScope(request, request.params.brandId),
      actorUserId: requiredAiContentActorUserId(request),
      proposalId: parseAiContentUuid(request.params.proposalId, "ai_content_proposal_id_invalid"),
    }),
  );

  app.get<{
    Params: { brandId: string };
    Querystring: { assetType?: string; assetId?: string };
  }>(
    "/brands/:brandId/ai-content/draft-references",
    async (request) => {
      if (!["reference", "avatar", "product_service", "wiki"].includes(String(request.query.assetType))) {
        throw new Error("ai_content_asset_type_invalid");
      }
      return requireContentProposalCustomerRepository(repository).listAiContentDraftReferences({
        ...aiContentScope(request, request.params.brandId),
        assetType: request.query.assetType as "reference" | "avatar" | "product_service" | "wiki",
        assetId: parseAiContentUuid(request.query.assetId, "ai_content_asset_id_invalid"),
      });
    },
  );

  app.post<{ Params: { brandId: string }; Body: unknown }>("/brands/:brandId/ai-content/generations", async (request) => {
    const scope = aiContentScope(request, request.params.brandId);
    return repository.createAiContentAnalysis({
      ...scope,
      actorUserId: requiredAiContentActorUserId(request),
      ...parseCreateAiContentAnalysisInput(request.body),
    });
  });

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/ai-content/brand-context", async (request) => {
    return repository.getAiContentBrandContext(aiContentScope(request, request.params.brandId));
  });

  app.patch<{ Params: { brandId: string; generationId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/generations/:generationId",
    async (request) => {
      const scope = aiContentScope(request, request.params.brandId);
      if (isObject(request.body)
        && request.body.contractVersion === "content-finalization-draft.v2") {
        return repository.updateAiContentFinalizationDraft({
          ...scope,
          generationId: parseAiContentGenerationId(request.params.generationId),
          actorUserId: requiredAiContentActorUserId(request),
          draft: parseContentFinalizationDraftV2(request.body),
        });
      }
      if (isObject(request.body)
        && Object.prototype.hasOwnProperty.call(request.body, "contractVersion")) {
        throw new Error("ai_content_contract_version_unsupported");
      }
      return repository.updateAiContentDraft({
        ...scope,
        generationId: request.params.generationId,
        actorUserId: requiredAiContentActorUserId(request),
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
      if (isObject(request.body)
        && request.body.contractVersion === "content-generation-start.v2") {
        if (!aiContentProposalV2) throw new Error("content_proposal_v2_not_configured");
        const start = parseContentGenerationStartV2(request.body);
        return repository.startAiContentGenerationV3({
          ...scope,
          generationId: parseAiContentGenerationId(request.params.generationId),
          actorUserId: requiredAiContentActorUserId(request),
          usageDate,
          dailyGenerationLimit: limits.dailyGenerationLimit,
          ...start,
        }, aiContentProposalV2.snapshotRepository);
      }
      if (isObject(request.body)
        && Object.prototype.hasOwnProperty.call(request.body, "contractVersion")) {
        throw new Error("ai_content_contract_version_unsupported");
      }
      const usage = await repository.listAiContentUsage({ ...scope, usageDate });
      if (usage.generationCount >= limits.dailyGenerationLimit) throw new Error("ai_content_limit_reached");
      return repository.startAiContentGeneration({
        ...scope,
        generationId: request.params.generationId,
        actorUserId: requiredAiContentActorUserId(request),
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

  app.post<{ Params: { brandId: string; outputId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/outputs/:outputId/revisions",
    async (request) => repository.reviseAiContentOutput({
      ...aiContentScope(request, request.params.brandId),
      outputId: request.params.outputId,
      ...parseAiContentRevisionInput(request.body),
    }),
  );

  app.put<{ Params: { brandId: string; outputId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/outputs/:outputId/copy",
    async (request) => repository.saveAiContentOutputCopy({
      ...aiContentScope(request, request.params.brandId),
      outputId: request.params.outputId,
      ...parseAiContentCopyInput(request.body),
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
        } catch (error) {
          if (error instanceof Error && error.message === "publishing_disabled") throw error;
          const storedResult = await repository.getAiContentPublishQueueResult({
            ...scope,
            queueId: target.queueId,
          });
          const errorCode = storedResult.errorCode ?? safeInternalErrorCode(error);
          request.log.warn({
            event: "ai_content_publish_target_failed",
            requestId: request.id,
            outputId: request.params.outputId,
            queueId: target.queueId,
            channel: target.channel,
            deliveryFormat: target.deliveryFormat,
            errorCode,
          }, "ai_content_publish_target_failed");
          targets.push({ ...storedResult, errorCode });
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

  app.get<{
    Params: { brandId: string };
    Querystring: { type?: string; strategies?: string; formats?: string; tags?: string };
  }>(
    "/brands/:brandId/ai-content/references",
    async (request) => {
      const type = request.query.type;
      if (type !== undefined && !["card_news", "blog", "marketing"].includes(type)) {
        throw new Error("ai_content_type_invalid");
      }
      const parseFilter = (raw: string | undefined, allowed?: ReadonlySet<string>) => {
        if (!raw) return [];
        const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
        if (
          values.length > 30
          || new Set(values).size !== values.length
          || values.some((value) => value.length > 80 || allowed && !allowed.has(value))
        ) throw new Error("ai_content_reference_filter_invalid");
        return values;
      };
      return repository.listAiContentReferences({
        ...aiContentScope(request, request.params.brandId),
        type: type as AiContentType | undefined,
        strategies: parseFilter(request.query.strategies, new Set([
          "problem_solution", "how_to", "comparison", "faq", "insight",
          "benefit", "social_proof", "brand_story", "cta",
        ])),
        formats: parseFilter(request.query.formats, new Set(["card_news", "blog", "single_image", "channel_text"])),
        tags: parseFilter(request.query.tags),
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

  if (aiContentAttachmentRepository) {
  app.post<{ Params: { brandId: string; generationId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/generations/:generationId/attachments/token",
    { preValidation: validateAiContentLifecycleBrand },
    async (request) => {
      const brandId = parseAiContentBrandId(request.params.brandId);
      const generationId = parseAiContentGenerationId(request.params.generationId);
      const scope = aiContentScope(request, brandId);
      if (isObject(request.body)
        && Object.prototype.hasOwnProperty.call(request.body, "contractVersion")
        && request.body.contractVersion !== "ai-content-attachment-upload.v3") {
        throw new Error("ai_content_contract_version_unsupported");
      }
      const attachment = isObject(request.body)
        && request.body.contractVersion === "ai-content-attachment-upload.v3"
        ? validateAiContentAttachmentV3(parseV3AttachmentUploadTokenInput(request.body))
        : validateAiContentAttachment(parseAttachmentUploadTokenInput(request.body));
      const tokenOptions = {
        token: aiContentUpload?.readWriteToken ?? "",
        generateClientToken: aiContentUpload?.generateClientToken,
      };
      if (!aiContentUpload?.uploadSessionsEnabled) {
        // Legacy issuance cannot reserve capacity before the provider call. An abandoned
        // Blob is therefore undiscoverable until upload-session issuance is enabled.
        await aiContentAttachmentRepository.assertAiContentAttachmentUploadMutable({ ...scope, generationId });
        return issueValidatedAiContentAttachmentToken({
          brandId,
          generationId,
          attachment,
        }, tokenOptions);
      }
      const createdByUserId = aiContentActorUserId(request);
      if (!createdByUserId) throw new Error("authentication_required");
      const session = await aiContentAttachmentRepository.createAiContentUploadSession({
        ...scope,
        generationId,
        createdByUserId,
        attachment,
      });
      try {
        const token = await issueAiContentUploadSessionToken({
          storagePath: session.storagePath,
          mimeType: session.mimeType,
          maximumSizeInBytes: session.role in AI_CONTENT_ATTACHMENT_POLICY_V3
            ? AI_CONTENT_ATTACHMENT_POLICY_V3[session.role as keyof typeof AI_CONTENT_ATTACHMENT_POLICY_V3][session.mimeType]!
            : AI_CONTENT_ATTACHMENT_POLICY[session.role as keyof typeof AI_CONTENT_ATTACHMENT_POLICY][session.mimeType]!,
          tokenExpiresAt: session.tokenExpiresAt,
        }, tokenOptions);
        return {
          contractVersion: "ai-content-attachment-upload.v2",
          sessionId: session.id,
          nonce: session.nonce,
          pathname: token.pathname,
          clientToken: token.clientToken,
          uploadExpiresAt: token.uploadExpiresAt,
          sessionExpiresAt: session.tokenExpiresAt,
        };
      } catch (error) {
        const errorCode = error instanceof Error
          ? error.message
          : "ai_content_attachment_storage_unavailable";
        try {
          await aiContentAttachmentRepository.failAiContentUploadSession({
            ...scope,
            generationId,
            sessionId: session.id,
            createdByUserId,
            errorCode,
          });
        } catch {
          request.log.warn({
            event: "ai_content_upload_session_compensation_failed",
            requestId: request.id,
            errorCode: "database_compensation_failed",
          }, "ai_content_upload_session_compensation_failed");
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { brandId: string; generationId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/generations/:generationId/attachments/confirm",
    { preValidation: validateAiContentLifecycleBrand },
    async (request) => {
      const brandId = parseAiContentBrandId(request.params.brandId);
      const generationId = parseAiContentGenerationId(request.params.generationId);
      const scope = aiContentScope(request, brandId);
      const parsed = parseConfirmAttachmentInput(request.body);
      if ("sessionId" in parsed) {
        const createdByUserId = aiContentActorUserId(request);
        if (!createdByUserId) throw new Error("authentication_required");
        return aiContentAttachmentRepository.confirmAiContentUploadSession({
          ...scope,
          generationId,
          sessionId: parsed.sessionId,
          nonce: parsed.nonce,
          createdByUserId,
        }, (session, abortSignal) => verifyAiContentUploadSessionBlob(session, {
          token: aiContentUpload?.readWriteToken ?? "",
          headBlob: aiContentUpload?.headBlob,
          abortSignal,
        }));
      }
      const generation = await repository.getAiContentGeneration({ ...scope, generationId });
      if (!generation) throw new Error("ai_content_generation_not_found");
      const confirmed = confirmAiContentAttachment({
        brandId,
        generationId,
        attachment: parsed,
        storagePath: parsed.storagePath,
        storageUrl: parsed.storageUrl,
      });
      const verified = await verifyAiContentAttachmentBlob(confirmed, {
        token: aiContentUpload?.readWriteToken ?? "",
        headBlob: aiContentUpload?.headBlob,
      });
      return aiContentAttachmentRepository.confirmLegacyAiContentAttachment({ ...scope, generationId, ...verified });
    },
  );

  app.post<{ Params: { brandId: string; generationId: string }; Body: unknown }>(
    "/brands/:brandId/ai-content/generations/:generationId/attachments/cancel",
    { preValidation: validateAiContentLifecycleBrand },
    async (request) => {
      const brandId = parseAiContentBrandId(request.params.brandId);
      const generationId = parseAiContentGenerationId(request.params.generationId);
      const scope = aiContentScope(request, brandId);
      const createdByUserId = aiContentActorUserId(request);
      if (!createdByUserId) throw new Error("authentication_required");
      const parsed = parseCancelUploadSessionInput(request.body);
      return aiContentAttachmentRepository.cancelAiContentUploadSession({
        ...scope,
        generationId,
        sessionId: parsed.sessionId,
        nonce: parsed.nonce,
        createdByUserId,
      });
    },
  );
  }

  app.delete<{ Params: { brandId: string; generationId: string; attachmentId: string } }>(
    "/brands/:brandId/ai-content/generations/:generationId/attachments/:attachmentId",
    { preValidation: validateAiContentLifecycleBrand },
    async (request) => {
      const brandId = parseAiContentBrandId(request.params.brandId);
      return repository.removeAiContentAttachment({
        ...aiContentScope(request, brandId),
        generationId: parseAiContentGenerationId(request.params.generationId),
        attachmentId: parseAiContentAttachmentId(request.params.attachmentId),
      });
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
    Body: { body?: unknown; idempotencyKey?: unknown };
  }>("/brands/:brandId/dm/conversations/:conversationId/messages", async (request, reply) => {
    const body = typeof request.body?.body === "string" ? request.body.body.trim() : "";
    const idempotencyKey = typeof request.body?.idempotencyKey === "string" ? request.body.idempotencyKey : "";
    if (!uuidPattern.test(request.params.conversationId) || !uuidPattern.test(idempotencyKey) || body.length < 1 || body.length > 1000) {
      reply.code(400);
      return { error: "dm_manual_reply_invalid" };
    }
    return repository.sendManualDmReply(request.params.brandId, request.params.conversationId, body, idempotencyKey);
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

  app.post<{ Params: { queueId: string } }>("/publish-queue/:queueId/cancel", async (request, reply) => {
    try {
      return await repository.cancelPublishQueueItem(request.params.queueId);
    } catch (error) {
      if (error instanceof Error && error.message === "publish_queue_not_cancellable") {
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

  function authenticateContentProposalWorker(authorization: string | undefined, reply: FastifyReply) {
    const token = contentProposalWorkerApiToken;
    if (!token) {
      reply.code(503).send({ error: "worker_api_not_configured" });
      return false;
    }
    if (authorization !== `Bearer ${token}`) {
      reply.code(401).send({ error: "worker_api_unauthorized" });
      return false;
    }
    return true;
  }

  app.post<{ Body: Record<string, unknown> }>(
    "/worker/content-proposal-jobs/heartbeat",
    async (request, reply) => {
      if (!authenticateContentProposalWorker(request.headers.authorization, reply)) return;
      const workerId = requiredAiContentField(
        request.body?.workerId,
        "content_proposal_worker_id_required",
        200,
      );
      return repository.heartbeatContentProposalWorker(workerId);
    },
  );

  app.post("/worker/brand-analyses/cleanup", async (request, reply) => {
    if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
    if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
    return brandIntelligenceRepository.cleanupBrandAnalysisRuns?.()
      ?? { attempted: 0, completed: 0 };
  });

  app.post<{ Body: unknown }>("/worker/brand-analyses/claim", async (request, reply) => {
    if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
    if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
    const job = await brandIntelligenceRepository.claimBrandAnalysis(
      parseBrandAnalysisWorkerClaimInput(request.body),
    );
    if (!job || !workerApiToken) return { job };
    const expiresAt = Math.min(
      Date.now() + 10 * 60 * 1_000,
      job.deadlineAt ? new Date(job.deadlineAt).getTime() : Number.POSITIVE_INFINITY,
    );
    const origin = `${request.protocol}://${request.headers.host}`;
    return {
      job: {
        ...job,
        uploads: job.uploads.map((upload) => {
          const payload = `${job.id}:${upload.id}:${expiresAt}`;
          const signature = createHmac("sha256", workerApiToken).update(payload).digest("hex");
          return {
            ...upload,
            accessUrl: `${origin}/worker/brand-analyses/${job.id}/uploads/${upload.id}`
              + `?expires=${expiresAt}&signature=${signature}`,
          };
        }),
      },
    };
  });

  app.get<{
    Params: { analysisId: string; uploadId: string };
    Querystring: { expires?: string; signature?: string };
  }>("/worker/brand-analyses/:analysisId/uploads/:uploadId", async (request, reply) => {
    if (!workerApiToken || !brandIntelligenceRepository) {
      reply.code(503);
      return { error: "brand_intelligence_not_configured" };
    }
    const expiresAt = Number(request.query.expires);
    const signature = request.query.signature ?? "";
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()
      || expiresAt > Date.now() + 10 * 60 * 1_000
      || !/^[a-f0-9]{64}$/.test(signature)) {
      reply.code(401);
      return { error: "brand_analysis_upload_access_invalid" };
    }
    const payload = `${request.params.analysisId}:${request.params.uploadId}:${expiresAt}`;
    const expected = createHmac("sha256", workerApiToken).update(payload).digest();
    const supplied = Buffer.from(signature, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      reply.code(401);
      return { error: "brand_analysis_upload_access_invalid" };
    }
    const upload = await brandIntelligenceRepository.getBrandAnalysisUploadForDownload({
      analysisId: request.params.analysisId,
      uploadId: request.params.uploadId,
    });
    if (!upload) {
      reply.code(404);
      return { error: "brand_analysis_upload_not_found" };
    }
    const response = await fetch(upload.storageUrl, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("brand_analysis_upload_download_failed");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== upload.byteSize || bytes.length > 10 * 1024 * 1024) {
      throw new Error("brand_analysis_upload_size_mismatch");
    }
    reply.header("content-type", upload.mimeType);
    reply.header("content-length", String(bytes.length));
    return reply.send(bytes);
  });

  app.post<{ Params: { analysisId: string }; Body: Record<string, unknown> }>(
    "/worker/brand-analyses/:analysisId/heartbeat",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      const lease = parseBrandAnalysisWorkerLeaseInput(request.body);
      const heartbeat = await brandIntelligenceRepository.heartbeatBrandAnalysis({
        analysisId: request.params.analysisId, ...lease,
      });
      const heartbeatAlive = typeof heartbeat === "boolean" ? heartbeat : heartbeat.alive;
      const cancelRequested = typeof heartbeat === "boolean" ? false : heartbeat.cancelRequested;
      const leaseExpiresAt = typeof heartbeat === "boolean" ? null : heartbeat.leaseExpiresAt;
      const deadlineAt = typeof heartbeat === "boolean" ? null : heartbeat.deadlineAt;
      if (!heartbeatAlive) {
        reply.code(409);
        return {
          error: cancelRequested
            ? "brand_analysis_cancel_requested"
            : "brand_analysis_lease_invalid",
          cancelRequested,
          leaseExpiresAt,
          deadlineAt,
        };
      }
      return { ok: true, cancelRequested: false, leaseExpiresAt, deadlineAt };
    },
  );

  app.post<{ Params: { analysisId: string }; Body: Record<string, unknown> }>(
    "/worker/brand-analyses/:analysisId/progress",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      const lease = parseBrandAnalysisWorkerLeaseInput({
        workerId: request.body.workerId,
        leaseToken: request.body.leaseToken,
        leaseSeconds: request.body.leaseSeconds,
      });
      const stageStatus = request.body.status === undefined
        ? undefined
        : requiredAiContentField(request.body.status, "brand_analysis_stage_status_invalid", 20);
      if (stageStatus !== undefined
        && !["running", "succeeded", "failed", "cancelled"].includes(stageStatus)) {
        throw new Error("brand_analysis_stage_status_invalid");
      }
      const progressNumbers = [
        request.body.inputCount ?? 0,
        request.body.successCount ?? 0,
        request.body.failedCount ?? 0,
        request.body.selectedPageCount ?? 0,
        request.body.successfulPageCount ?? 0,
        request.body.failedPageCount ?? 0,
        request.body.requiredPageCount ?? 0,
        request.body.completedCliStageCount ?? 0,
        request.body.totalCliStageCount ?? 0,
      ].map(Number);
      if (progressNumbers.some((value) => !Number.isSafeInteger(value) || value < 0)) {
        throw new Error("brand_analysis_progress_count_invalid");
      }
      const attempt = request.body.attempt === undefined ? undefined : Number(request.body.attempt);
      const logicalIndex = request.body.logicalIndex === undefined
        ? undefined
        : Number(request.body.logicalIndex);
      const physicalAttempt = request.body.physicalAttempt === undefined
        ? undefined
        : Number(request.body.physicalAttempt);
      const selectedPageCount = request.body.selectedPageCount === undefined
        ? undefined
        : Number(request.body.selectedPageCount);
      const successfulPageCount = request.body.successfulPageCount === undefined
        ? undefined
        : Number(request.body.successfulPageCount);
      const failedPageCount = request.body.failedPageCount === undefined
        ? undefined
        : Number(request.body.failedPageCount);
      const requiredPageCount = request.body.requiredPageCount === undefined
        ? undefined
        : Number(request.body.requiredPageCount);
      const completedCliStageCount = request.body.completedCliStageCount === undefined
        ? undefined
        : Number(request.body.completedCliStageCount);
      const totalCliStageCount = request.body.totalCliStageCount === undefined
        ? undefined
        : Number(request.body.totalCliStageCount);
      const errorCode = request.body.errorCode === undefined
        ? undefined
        : requiredAiContentField(request.body.errorCode, "brand_analysis_error_code_invalid", 120);
      if (errorCode !== undefined && !/^[a-z0-9_]+$/.test(errorCode)) {
        throw new Error("brand_analysis_error_code_invalid");
      }
      if ([attempt, logicalIndex, physicalAttempt].some(
        (value) => value !== undefined && !Number.isSafeInteger(value),
      )
        || (attempt !== undefined && (attempt < 1 || attempt > 3))
        || (logicalIndex !== undefined && (logicalIndex < 1 || logicalIndex > 8))
        || (physicalAttempt !== undefined && (physicalAttempt < 1 || physicalAttempt > 3))
        || (selectedPageCount !== undefined && selectedPageCount > 20)
        || (successfulPageCount !== undefined && successfulPageCount > (selectedPageCount ?? 20))
        || (failedPageCount !== undefined
          && failedPageCount > (selectedPageCount ?? 20))
        || (successfulPageCount !== undefined && failedPageCount !== undefined
          && selectedPageCount !== undefined
          && successfulPageCount + failedPageCount > selectedPageCount)
        || (requiredPageCount !== undefined && requiredPageCount > 10)
        || (totalCliStageCount !== undefined && totalCliStageCount > 8)
        || (completedCliStageCount !== undefined
          && completedCliStageCount > (totalCliStageCount ?? 8))) {
        throw new Error("brand_analysis_progress_count_invalid");
      }
      return brandIntelligenceRepository.progressBrandAnalysis({
        analysisId: request.params.analysisId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        stage: requiredAiContentField(request.body.stage, "brand_analysis_stage_invalid", 100),
        attempt,
        status: stageStatus as "running" | "succeeded" | "failed" | "cancelled" | undefined,
        errorCode,
        logicalIndex,
        physicalAttempt,
        inputCount: Number(request.body.inputCount ?? 0),
        successCount: Number(request.body.successCount ?? 0),
        failedCount: Number(request.body.failedCount ?? 0),
        selectedPageCount,
        successfulPageCount,
        failedPageCount,
        requiredPageCount,
        completedCliStageCount,
        totalCliStageCount,
      });
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
      const evidence = parseBrandEvidenceDocuments(request.body.evidence ?? []);
      const rawRegistry = request.body.registry;
      if (rawRegistry !== undefined && (!isObject(rawRegistry)
        || !Array.isArray(rawRegistry.ownedFactIds)
        || !Array.isArray(rawRegistry.externalSources)
        || rawRegistry.ownedFactIds.length > 2_000
        || rawRegistry.externalSources.length > 10)) {
          throw new Error("brand_intelligence_validation_registry_invalid");
      }
      const registry = rawRegistry && isObject(rawRegistry) ? {
        ownedFactIds: (rawRegistry.ownedFactIds as unknown[]).map((value) => (
          requiredAiContentField(value, "brand_intelligence_validation_registry_invalid", 200)
        )),
        externalSources: (rawRegistry.externalSources as unknown[]).map((value) => {
          if (!isObject(value)) throw new Error("brand_intelligence_validation_registry_invalid");
          const sourceId = requiredAiContentField(
            value.sourceId,
            "brand_intelligence_validation_registry_invalid",
            2_200,
          );
          const url = requiredAiContentField(
            value.url,
            "brand_intelligence_validation_registry_invalid",
            2_048,
          );
          if (sourceId !== `external:${url}`) {
            throw new Error("brand_intelligence_validation_registry_invalid");
          }
          return { sourceId, url };
        }),
      } : undefined;
      return brandIntelligenceRepository.completeBrandAnalysis({
        analysisId: request.params.analysisId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        evidence,
        result: request.body.result as never,
        registry,
      });
    },
  );

  app.post<{ Params: { analysisId: string }; Body: Record<string, unknown> }>(
    "/worker/brand-analyses/:analysisId/cancelled",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      if (!brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
      const lease = parseBrandAnalysisWorkerLeaseInput(request.body);
      return brandIntelligenceRepository.markBrandAnalysisCancelled({
        analysisId: request.params.analysisId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
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
        const result = parseSubjectAnalysisResultV2(rawResult, {
          expectedSubjectType: activeLease.subjectType,
          allowedAttachmentIds: activeLease.attachmentIds,
        });
        return subjectRepository.completeSubjectAnalysis({ ...identity, ...result });
      }
      if (rawResult.contractVersion !== "subject-appeal-result.v2" || rawResult.phase !== "appeal") {
        throw new Error("subject_analysis_completion_phase_mismatch");
      }
      const result = parseSubjectAppealResultV2(rawResult, {
        expectedSubjectType: activeLease.subjectType,
        allowedAttachmentIds: activeLease.attachmentIds,
      });
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

  app.post<{ Body: Record<string, unknown> }>(
    "/worker/content-proposal-jobs/claim",
    async (request, reply) => {
      if (!authenticateContentProposalWorker(request.headers.authorization, reply)) return;
      const workerId = requiredAiContentField(
        request.body?.workerId,
        "content_proposal_worker_id_required",
        200,
      );
      const leaseSeconds = Number(request.body?.leaseSeconds ?? 180);
      if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) {
        throw new Error("content_proposal_lease_seconds_invalid");
      }
      return {
        job: await requireContentProposalJobsRepository(repository)
          .claimContentProposalJob({ workerId, leaseSeconds }),
      };
    },
  );

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>(
    "/worker/content-proposal-jobs/:jobId/heartbeat",
    async (request, reply) => {
      if (!authenticateContentProposalWorker(request.headers.authorization, reply)) return;
      const jobId = parseAiContentUuid(
        request.params.jobId,
        "content_proposal_job_id_invalid",
      );
      const leaseToken = parseAiContentUuid(
        request.body?.leaseToken,
        "content_proposal_lease_token_invalid",
      );
      const leaseSeconds = Number(request.body?.leaseSeconds ?? 180);
      if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) {
        throw new Error("content_proposal_lease_seconds_invalid");
      }
      const alive = await requireContentProposalJobsRepository(repository).heartbeatContentProposalJob({
        jobId,
        workerId: requiredAiContentField(
          request.body?.workerId,
          "content_proposal_worker_id_required",
          200,
        ),
        leaseToken,
        leaseSeconds,
      });
      if (!alive) throw new Error("content_proposal_job_lease_invalid");
      return { id: jobId, status: "processing" };
    },
  );

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>(
    "/worker/content-proposal-jobs/:jobId/research-complete",
    async (request, reply) => {
      if (!authenticateContentProposalWorker(request.headers.authorization, reply)) return;
      const bodyKeys = Object.keys(request.body ?? {}).sort();
      if (bodyKeys.join("\0") !== ["evidence", "leaseToken", "workerId"].join("\0")) {
        throw new Error("content_proposal_research_invalid");
      }
      const jobId = parseAiContentUuid(
        request.params.jobId,
        "content_proposal_job_id_invalid",
      );
      const leaseToken = parseAiContentUuid(
        request.body.leaseToken,
        "content_proposal_lease_token_invalid",
      );
      let evidence;
      try { evidence = parseResearchEvidenceSnapshotV1(request.body.evidence); }
      catch { throw new Error("content_proposal_research_invalid"); }
      return requireContentProposalJobsRepository(repository).completeContentProposalResearch({
        jobId,
        workerId: requiredAiContentField(
          request.body.workerId,
          "content_proposal_worker_id_required",
          200,
        ),
        leaseToken,
        evidence,
      });
    },
  );

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>(
    "/worker/content-proposal-jobs/:jobId/complete",
    async (request, reply) => {
      if (!authenticateContentProposalWorker(request.headers.authorization, reply)) return;
      const jobId = parseAiContentUuid(
        request.params.jobId,
        "content_proposal_job_id_invalid",
      );
      const leaseToken = parseAiContentUuid(
        request.body?.leaseToken,
        "content_proposal_lease_token_invalid",
      );
      const identity = {
        jobId,
        workerId: requiredAiContentField(
          request.body?.workerId,
          "content_proposal_worker_id_required",
          200,
        ),
        leaseToken,
      };
      if (Object.prototype.hasOwnProperty.call(request.body, "proposalSet")) {
        const bodyKeys = Object.keys(request.body).sort();
        if (bodyKeys.join("\0") !== ["leaseToken", "proposalSet", "workerId"].join("\0")) {
          throw new Error("content_proposal_result_invalid");
        }
        let proposalSet;
        try { proposalSet = parseContentProposalSetV2(request.body.proposalSet); }
        catch { throw new Error("content_proposal_result_invalid"); }
        return requireContentProposalJobsRepository(repository).completeContentProposalJob({
          ...identity,
          proposalSet,
        });
      }
      if (!Array.isArray(request.body?.proposals)) throw new Error("content_proposal_result_invalid");
      const proposals = parseContentProposalResult(request.body.proposals);
      return requireContentProposalJobsRepository(repository).completeContentProposalJob({
        ...identity,
        proposals,
      });
    },
  );

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>(
    "/worker/content-proposal-jobs/:jobId/fail",
    async (request, reply) => {
      if (!authenticateContentProposalWorker(request.headers.authorization, reply)) return;
      const jobId = parseAiContentUuid(
        request.params.jobId,
        "content_proposal_job_id_invalid",
      );
      const leaseToken = parseAiContentUuid(
        request.body?.leaseToken,
        "content_proposal_lease_token_invalid",
      );
      if (typeof request.body?.retryable !== "boolean") {
        throw new Error("content_proposal_retryable_invalid");
      }
      return requireContentProposalJobsRepository(repository).failContentProposalJob({
        jobId,
        workerId: requiredAiContentField(
          request.body?.workerId,
          "content_proposal_worker_id_required",
          200,
        ),
        leaseToken,
        errorCode: requiredAiContentField(
          request.body?.errorCode,
          "content_proposal_error_code_invalid",
          120,
        ),
        errorMessage: requiredAiContentField(
          request.body?.errorMessage,
          "content_proposal_error_message_invalid",
          2_000,
        ),
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
        if (isObject(body.plan)) {
          assertExactAiContentWorkerBody(body, ["workerId", "leaseToken", "skillVersion", "jobType", "plan"], "ai_content_plan_completion_invalid");
          completion = { ...common, jobType: "generate", plan: body.plan as never };
        } else {
          if (!isObject(body.manifest)) throw new Error("ai_content_manifest_invalid");
          const manifestType = body.manifest.type;
          if (!['card_news', 'blog', 'marketing'].includes(String(manifestType))) throw new Error("ai_content_type_invalid");
          completion = {
            ...common,
            jobType: "generate",
            manifest: parseAiContentManifest(manifestType as AiContentType, body.manifest),
            manifestUrl: requiredAiContentField(body.manifestUrl, "ai_content_manifest_url_invalid", 2_000),
          };
        }
      } else {
        throw new Error("ai_content_job_type_invalid");
      }
      return repository.completeAiContentJob(completion);
    },
  );

  app.post<{ Body: Record<string, unknown> }>(
    "/worker/ai-content-render-jobs/claim",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      const renderRepository = requireAiContentRenderWorkerRepository(repository);
      assertExactAiContentWorkerBody(request.body ?? {}, ["workerId", "leaseSeconds"], "ai_content_render_claim_invalid");
      const workerId = requiredAiContentField(request.body?.workerId, "ai_content_worker_id_required", 200);
      const leaseSeconds = Number(request.body?.leaseSeconds ?? 180);
      if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 300) throw new Error("ai_content_lease_seconds_invalid");
      return { job: await renderRepository.claimAiContentRenderJob({ workerId, leaseSeconds }) };
    },
  );

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>(
    "/worker/ai-content-render-jobs/:jobId/heartbeat",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      const renderRepository = requireAiContentRenderWorkerRepository(repository);
      assertExactAiContentWorkerBody(request.body ?? {}, ["workerId", "leaseToken", "leaseSeconds"], "ai_content_render_heartbeat_invalid");
      const workerId = requiredAiContentField(request.body?.workerId, "ai_content_worker_id_required", 200);
      const leaseToken = requiredAiContentField(request.body?.leaseToken, "ai_content_lease_token_required", 200);
      const leaseSeconds = Number(request.body?.leaseSeconds ?? 180);
      if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 300) throw new Error("ai_content_lease_seconds_invalid");
      const alive = await renderRepository.heartbeatAiContentRenderJob({ jobId: request.params.jobId, workerId, leaseToken, leaseSeconds });
      if (!alive) { reply.code(409); return { error: "ai_content_render_job_lease_invalid" }; }
      return { id: request.params.jobId, status: "processing" };
    },
  );

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>(
    "/worker/ai-content-render-jobs/:jobId/complete",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      const renderRepository = requireAiContentRenderWorkerRepository(repository);
      const body = request.body ?? {};
      const identity = {
        jobId: request.params.jobId,
        workerId: requiredAiContentField(body.workerId, "ai_content_worker_id_required", 200),
        leaseToken: requiredAiContentField(body.leaseToken, "ai_content_lease_token_required", 200),
      };
      if (body.jobKind === "image_asset") {
        assertExactAiContentWorkerBody(body, ["workerId", "leaseToken", "jobKind", "asset"], "ai_content_render_completion_invalid");
        if (!isObject(body.asset)) throw new Error("ai_content_render_asset_invalid");
        await renderRepository.completeAiContentRenderAsset({ ...identity, jobKind: "image_asset", asset: body.asset as never });
        return { id: request.params.jobId, status: "succeeded" };
      }
      if (body.jobKind === "package_finalize") {
        assertExactAiContentWorkerBody(body, ["workerId", "leaseToken", "jobKind", "manifest", "manifestUrl"], "ai_content_render_completion_invalid");
        if (!isObject(body.manifest)) throw new Error("ai_content_manifest_invalid");
        return renderRepository.completeAiContentRenderPackage({
          ...identity, jobKind: "package_finalize", manifest: body.manifest as never,
          manifestUrl: requiredAiContentField(body.manifestUrl, "ai_content_manifest_url_invalid", 2_000),
        });
      }
      throw new Error("ai_content_render_job_kind_invalid");
    },
  );

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>(
    "/worker/ai-content-render-jobs/:jobId/fail",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      const renderRepository = requireAiContentRenderWorkerRepository(repository);
      const body = request.body ?? {};
      assertExactAiContentWorkerBody(body, ["workerId", "leaseToken", "errorCode", "errorMessage", "retryable"], "ai_content_render_failure_invalid");
      if (typeof body.retryable !== "boolean") throw new Error("ai_content_retryable_invalid");
      await renderRepository.failAiContentRenderJob({
        jobId: request.params.jobId,
        workerId: requiredAiContentField(body.workerId, "ai_content_worker_id_required", 200),
        leaseToken: requiredAiContentField(body.leaseToken, "ai_content_lease_token_required", 200),
        errorCode: requiredAiContentField(body.errorCode, "ai_content_error_code_invalid", 120),
        errorMessage: requiredAiContentField(body.errorMessage, "ai_content_error_message_invalid", 2_000),
        retryable: body.retryable,
      });
      return { id: request.params.jobId, status: "accepted" };
    },
  );

  app.post<{ Params: { jobId: string }; Body: Record<string, unknown> }>(
    "/worker/ai-content-jobs/:jobId/research-complete",
    async (request, reply) => {
      if (!authenticateAiContentWorker(request.headers.authorization, reply)) return;
      const renderRepository = requireAiContentRenderWorkerRepository(repository);
      const body = request.body ?? {};
      assertExactAiContentWorkerBody(body, ["workerId", "leaseToken", "outputId", "evidence"], "ai_content_research_completion_invalid");
      if (!isObject(body.evidence)) throw new Error("ai_content_research_snapshot_invalid");
      await renderRepository.saveAiContentOutputResearch({
        jobId: request.params.jobId,
        outputId: requiredAiContentField(body.outputId, "ai_content_output_id_required", 200),
        workerId: requiredAiContentField(body.workerId, "ai_content_worker_id_required", 200),
        leaseToken: requiredAiContentField(body.leaseToken, "ai_content_lease_token_required", 200),
        evidence: body.evidence,
      });
      return { id: request.params.jobId, status: "stored" };
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
      request.body.workload as "dm" | "wiki" | "content" | "onboarding" | "faq",
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
