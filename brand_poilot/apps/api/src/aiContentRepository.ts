import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  type AiContentManifest,
  type CompleteAiContentJobInput,
  type ContentChannelV2,
  type ContentFinalizationDraftV2,
  type ContentGenerationStartV2,
  type ContentProposalRequestV1,
  type ContentOutputFormatV2,
  type ContentPurposeV2,
  LegacyConfirmAttachmentInput,
  type FailAiContentJobInput,
  AiContentType,
  CreateAiContentAnalysisInput,
  StartAiContentGenerationInput,
  UpdateAiContentDraftInput,
} from "./aiContentContracts.js";
import {
  createContentProposalJobsRepository,
  type ContentProposalJobsRepository,
} from "./contentProposalJobs.js";
import { parseAiContentManifest } from "./aiContentManifest.js";
import { mapOrchestrationToWorkerType, parseContentOrchestrationV1 } from "./contentOrchestration.js";
import { parseContentQualityBrief } from "./contentQualityBrief.js";
import { buildContentGenerationInput, parseContentGenerationInputV2, stripContentKnowledgeData, type ContentGenerationInputV2 } from "./aiContentGenerationInput.js";
import { createAiContentSubjectRepository } from "./aiContentSubjectRepository.js";
import type { LoadSubjectEvidenceInput, SubjectEvidenceAttachment } from "./aiContentSubjectEvidence.js";
import type { AiContentAttachmentSnapshot } from "./aiContentSubjectContracts.js";
import type { ConfirmedBrandIntelligence } from "./brandIntelligenceProvider.js";
import {
  createAiContentAttachmentRepository,
  type AiContentAttachmentLifecycleRepository,
} from "./aiContentAttachmentRepository.js";
import type { ProposalBaseInputSnapshotV2 } from "./contentOrchestration.js";
import {
  parseContentFinalizationDraftV2,
  parseContentGenerationInputV3,
  parseProposalInputSnapshotV2,
} from "./aiContentGenerationInputV3.js";
import type { AiContentSnapshotRepository } from "./aiContentSnapshotRepository.js";
import { parseContentPlanResultV2 } from "./aiContentPlanContracts.js";
import {
  createAiContentRenderJobsRepository,
  enqueueAiContentRenderJobs,
} from "./aiContentRenderJobs.js";

export interface BrandScope {
  workspaceId: string;
  brandId: string;
}

export interface AuthenticatedBrandScope extends BrandScope {
  actorUserId: string;
}

export interface BrandGenerationScope extends BrandScope {
  generationId: string;
}

export interface AiContentGenerationRecord {
  id: string;
  workspaceId: string;
  brandId: string;
  type: AiContentType;
  title: string;
  status: string;
  currentStage: string | null;
  draft: Record<string, unknown>;
  analysis: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  attachmentsLockedAt: string | null;
  terminalAt: string | null;
  retryableUntil: string | null;
  evidenceSnapshot?: {
    orchestration: Record<string, unknown>;
    generationInput: Record<string, unknown>;
    references: Array<{
      id: string;
      title: string;
      url: string | null;
      previewUrl: string | null;
      roles: string[];
    }>;
    avatar: Record<string, unknown> | null;
    proposal: Record<string, unknown> | null;
  };
  outputs?: AiContentOutputRecord[];
}

export interface AiContentOutputRecord {
  id: string;
  generationId: string;
  outputIndex: number;
  title: string | null;
  status: "queued" | "planning" | "generating" | "completed" | "failed";
  content: Record<string, unknown>;
  manifest: Record<string, unknown>;
  manifestUrl: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  downloadedAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  revisionCapabilities: Array<"save_copy" | "regenerate_hook" | "regenerate_copy" | "regenerate_card">;
  legacyReadOnly: boolean;
  manifestVersion: "ai-content.v1" | "ai-content.v2" | null;
}

export type AiContentRevisionAction = "regenerate_hook" | "regenerate_copy" | "regenerate_card";
export type AiContentCopyField = "hook" | "keyMessage" | "body" | "cta" | "caption" | "hashtags";

export interface AiContentUsageRecord {
  usageDate: string;
  generationCount: number;
  downloadCount: number;
}

export interface AiContentBrandContextRecord {
  ready: boolean;
  brandName: string;
  ownedUrl: string | null;
  sourceStatus: string | null;
  lastCrawledAt: string | null;
  wikiVersionId: string | null;
  wikiUpdatedAt: string | null;
  summary: string | null;
  pageCount: number;
  context: Record<string, unknown>;
  brandIntelligenceVersionId?: string | null;
}

export interface SubjectAnalysisBrandContext {
  brandName: string;
  companyOverview: string;
  businessDescription: string;
  primaryCategory: { code: string | null; name: string };
  subcategories: Array<{ code: string | null; name: string }>;
  primaryTarget: string;
  differentiators: string;
  coreAppeal: string;
  brandColor: string | null;
  brandIntelligenceVersionId: string;
  confirmedAt: string;
}

export interface SubjectAnalysisWorkerLease {
  analysisId: string;
  contractVersion: "subject-analysis.v1" | "subject-analysis.v2";
  phase: "analysis" | "appeal";
  subjectType: "product" | "service";
  attachmentIds: string[];
}

export interface AiContentAttachmentRecord extends AiContentAttachmentSnapshot {}

export interface AiContentJobRecord {
  id: string;
  generationId: string;
  outputId: string | null;
  workspaceId: string;
  brandId: string;
  jobType: "analyze" | "generate";
  contentType: AiContentType;
  status: "queued" | "processing" | "succeeded" | "failed";
  payload: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
  workerId: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  availableAt: string;
}

export interface AiContentReferenceRecord {
  id: string;
  source: "brand_output" | "saved_trend" | "saved_url";
  title: string;
  url: string | null;
  previewUrl: string | null;
  metrics: Record<string, unknown>;
  checkedAt: string | null;
}

export interface AiContentReferenceSeedRecord {
  id: string;
  source: AiContentReferenceRecord["source"];
  title: string;
  url: string | null;
  previewUrl: string | null;
  format: ContentOutputFormatV2;
  primaryCategory: string;
  metrics: {
    exposureCount: number | null;
    likeCount: number | null;
    commentsCount: number | null;
  };
  checkedAt: string | null;
}

export interface AiContentProposalBatchRecord {
  id: string;
  workspaceId: string;
  brandId: string;
  origin: "manual" | "scheduled_crawl";
  contentFamily: "informational" | "marketing";
  request: Record<string, unknown>;
  sourceSnapshots: Record<string, unknown>[];
  status: "queued" | "building" | "ready" | "failed";
  proposals?: AiContentProposalRecord[];
  researchEvidence?: {
    items: Array<{ id: string; title: string; url: string; publisher: string | null }>;
  };
  selectedReferences?: Array<{
    id: string;
    title: string;
    preview: { url: string | null; mimeType: string | null };
  }>;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiContentProposalRecord {
  id: string;
  batchId: string;
  proposal: Record<string, unknown>;
  status: "suggested" | "selected" | "dismissed";
  generationId: string | null;
  createdAt: string;
}

export interface CreateAiContentProposalBatchV2Input extends AuthenticatedBrandScope {
  origin: "manual" | "scheduled_crawl";
  idempotencyKey: string;
  requestFingerprint: string;
  purpose: ContentPurposeV2;
  outputFormat: ContentOutputFormatV2;
  channelTarget: ContentChannelV2;
  inputSnapshot: ProposalBaseInputSnapshotV2;
}

export interface AiContentDraftReferenceRecord {
  assetType: "reference" | "avatar" | "product_service" | "wiki";
  assetId: string;
  generationId: string;
  title: string;
}

export interface AudienceRecord {
  id: string;
  name: string;
  situation: string;
  problem: string;
  motivation: string;
  useCount: number;
  lastUsedAt: string | null;
}

export interface AppealRecord {
  id: string;
  title: string;
  description: string;
  evidenceType: "fact" | "benefit" | "price" | "trust" | "emotion";
  useCount: number;
  lastUsedAt: string | null;
}

export interface SaveAudienceInput extends BrandScope {
  name: string;
  situation: string;
  problem: string;
  motivation: string;
}

export interface SaveAppealInput extends BrandScope {
  title: string;
  description: string;
  evidenceType: AppealRecord["evidenceType"];
}

export interface AiContentRepository extends AiContentAttachmentLifecycleRepository, ContentProposalJobsRepository {
  getAiContentBrandContext(input: BrandScope): Promise<AiContentBrandContextRecord>;
  getConfirmedSubjectAnalysisBrandContext(input: BrandScope): Promise<SubjectAnalysisBrandContext>;
  listSubjectEvidenceAttachments(input: LoadSubjectEvidenceInput): Promise<SubjectEvidenceAttachment[]>;
  getSubjectAnalysisWorkerLease(input: {
    analysisId: string;
    workerId: string;
    leaseToken: string;
  }): Promise<SubjectAnalysisWorkerLease | null>;
  createAiContentAnalysis(input: AuthenticatedBrandScope & CreateAiContentAnalysisInput): Promise<AiContentGenerationRecord>;
  updateAiContentDraft(input: BrandGenerationScope & AuthenticatedBrandScope & UpdateAiContentDraftInput): Promise<AiContentGenerationRecord>;
  updateAiContentFinalizationDraft(input: BrandGenerationScope & AuthenticatedBrandScope & {
    draft: ContentFinalizationDraftV2;
  }): Promise<AiContentGenerationRecord>;
  startAiContentGenerationV3(
    input: BrandGenerationScope & AuthenticatedBrandScope & ContentGenerationStartV2 & {
      usageDate: string;
      dailyGenerationLimit: number;
    },
    snapshots: AiContentSnapshotRepository,
    now?: () => Date,
  ): Promise<AiContentGenerationRecord>;
  startAiContentGeneration(input: BrandGenerationScope & StartAiContentGenerationInput & {
    actorUserId: string;
    usageDate: string;
    dailyGenerationLimit: number;
  }): Promise<AiContentGenerationRecord>;
  listAiContentGenerations(input: BrandScope): Promise<AiContentGenerationRecord[]>;
  getAiContentGeneration(input: BrandGenerationScope): Promise<AiContentGenerationRecord | null>;
  listAiContentUsage(input: BrandScope & { usageDate: string }): Promise<AiContentUsageRecord>;
  listAiContentReferences(input: BrandScope & {
    type?: AiContentType;
    strategies?: string[];
    formats?: string[];
    tags?: string[];
  }): Promise<AiContentReferenceRecord[]>;
  listAiContentReferenceSeeds(input: BrandScope & {
    primaryCategory: string;
    format: ContentOutputFormatV2;
    limit: number;
  }): Promise<AiContentReferenceSeedRecord[]>;
  listBrandAudiences(input: BrandScope): Promise<AudienceRecord[]>;
  saveBrandAudience(input: SaveAudienceInput): Promise<AudienceRecord>;
  listBrandAppeals(input: BrandScope): Promise<AppealRecord[]>;
  saveBrandAppeal(input: SaveAppealInput): Promise<AppealRecord>;
  confirmAiContentAttachment(input: BrandGenerationScope & LegacyConfirmAttachmentInput): Promise<AiContentAttachmentRecord>;
  removeAiContentAttachment(input: BrandGenerationScope & { attachmentId: string }): Promise<{ id: string }>;
  claimAiContentJob(input: { contentType: AiContentType; workerId: string; leaseSeconds: number }): Promise<AiContentJobRecord | null>;
  heartbeatAiContentJob(input: { jobId: string; workerId: string; leaseToken: string; leaseSeconds: number }): Promise<boolean>;
  completeAiContentJob(input: CompleteAiContentJobInput): Promise<AiContentGenerationRecord>;
  failAiContentJob(input: FailAiContentJobInput): Promise<AiContentGenerationRecord>;
  claimAiContentRenderJob(input: { workerId: string; leaseSeconds: number }): ReturnType<ReturnType<typeof createAiContentRenderJobsRepository>["claim"]>;
  heartbeatAiContentRenderJob(input: import("./aiContentRenderJobs.js").RenderLeaseInput): Promise<boolean>;
  completeAiContentRenderAsset(input: import("./aiContentRenderJobs.js").RenderAssetCompletion): Promise<void>;
  completeAiContentRenderPackage(input: import("./aiContentRenderJobs.js").RenderPackageCompletion): Promise<AiContentGenerationRecord>;
  failAiContentRenderJob(input: import("./aiContentRenderJobs.js").RenderFailure): Promise<void>;
  saveAiContentOutputResearch(input: { jobId: string; outputId: string; workerId: string; leaseToken: string; evidence: Record<string, unknown> }): Promise<void>;
  retryAiContentOutput(input: BrandScope & { outputId: string }): Promise<AiContentGenerationRecord>;
  reviseAiContentOutput(input: BrandScope & {
    outputId: string;
    action: AiContentRevisionAction;
    cardIndex?: number;
    idempotencyKey: string;
  }): Promise<AiContentGenerationRecord>;
  saveAiContentOutputCopy(input: BrandScope & {
    outputId: string;
    fields: Partial<Record<AiContentCopyField, string | string[]>>;
    idempotencyKey: string;
  }): Promise<AiContentGenerationRecord>;
  createAiContentProposalBatch(input: AuthenticatedBrandScope & {
    actorUserId: string;
    origin: "manual" | "scheduled_crawl";
    idempotencyKey: string;
    request: ContentProposalRequestV1;
  }): Promise<AiContentProposalBatchRecord>;
  createAiContentProposalBatchV2(
    input: CreateAiContentProposalBatchV2Input,
  ): Promise<AiContentProposalBatchRecord>;
  getAiContentProposalBatchV2Replay(input: AuthenticatedBrandScope & {
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<AiContentProposalBatchRecord | null>;
  getAiContentProposalBatch(input: BrandScope & { batchId: string }): Promise<AiContentProposalBatchRecord | null>;
  listAiContentProposals(input: BrandScope & { status: "suggested" | "selected" | "dismissed" }): Promise<AiContentProposalRecord[]>;
  selectAiContentProposal(input: AuthenticatedBrandScope & {
    actorUserId: string;
    proposalId: string;
    idempotencyKey: string;
  }): Promise<AiContentGenerationRecord>;
  dismissAiContentProposal(input: AuthenticatedBrandScope & {
    actorUserId: string;
    proposalId: string;
  }): Promise<AiContentProposalRecord>;
  listAiContentDraftReferences(input: BrandScope & {
    assetType: "reference" | "avatar" | "product_service" | "wiki";
    assetId: string;
  }): Promise<AiContentDraftReferenceRecord[]>;
}

interface AiContentRepositoryOptions {
  brandIntelligenceProvider?: {
    getConfirmed(input: BrandScope): Promise<ConfirmedBrandIntelligence | null>;
  };
}

type Queryable = Pick<PoolClient, "query">;

async function assertActiveAiContentActor(
  client: Queryable,
  input: { workspaceId: string; brandId: string; actorUserId: string },
): Promise<void> {
  if (!input.actorUserId) throw new Error("ai_content_actor_required");
  const result = await client.query(
    `select 1
       from workspace_members member
       join brands brand on brand.workspace_id=member.workspace_id
      where member.workspace_id=$1 and member.user_id=$2
        and member.status='active' and member.deleted_at is null
        and brand.id=$3 and brand.workspace_id=$1`,
    [input.workspaceId, input.actorUserId, input.brandId],
  );
  if (!result.rowCount) throw new Error("ai_content_actor_forbidden");
}

function iso(value: unknown) {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  return new Date(value).toISOString();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function canonicalJson(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  };
  return JSON.stringify(normalize(value));
}

const aiContentReferenceSeedFormats = new Set<ContentOutputFormatV2>([
  "card_news",
  "blog",
  "reel",
  "marketing_content",
]);

function normalizedReferenceSeedCategory(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function referenceSeedMetric(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function mapAiContentReferenceSeed(
  row: Record<string, unknown>,
  input: BrandScope & { primaryCategory: string; format: ContentOutputFormatV2 },
): AiContentReferenceSeedRecord | null {
  if (
    String(row.workspace_id) !== input.workspaceId
    || String(row.brand_id) !== input.brandId
    || row.archived_at !== null && row.archived_at !== undefined
    || row.source_availability !== "available"
    || typeof row.primary_category !== "string"
    || normalizedReferenceSeedCategory(row.primary_category) !== input.primaryCategory
    || row.format !== input.format
  ) return null;
  const exposureCount = referenceSeedMetric(row.exposure_count);
  const likeCount = referenceSeedMetric(row.like_count);
  const commentsCount = referenceSeedMetric(row.comments_count);
  if (exposureCount === null && likeCount === null && commentsCount === null) return null;
  if (row.source !== "brand_output" && row.source !== "saved_trend" && row.source !== "saved_url") return null;
  return {
    id: String(row.id),
    source: row.source,
    title: String(row.title),
    url: row.url ? String(row.url) : null,
    previewUrl: row.preview_url ? String(row.preview_url) : null,
    format: input.format,
    primaryCategory: row.primary_category.trim(),
    metrics: { exposureCount, likeCount, commentsCount },
    checkedAt: iso(row.checked_at),
  };
}

function compareAiContentReferenceSeeds(
  left: AiContentReferenceSeedRecord,
  right: AiContentReferenceSeedRecord,
): number {
  for (const metric of ["exposureCount", "likeCount", "commentsCount"] as const) {
    const difference = (right.metrics[metric] ?? -1) - (left.metrics[metric] ?? -1);
    if (difference !== 0) return difference;
  }
  const leftTime = left.checkedAt ? Date.parse(left.checkedAt) : Number.NEGATIVE_INFINITY;
  const rightTime = right.checkedAt ? Date.parse(right.checkedAt) : Number.NEGATIVE_INFINITY;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return left.id.localeCompare(right.id);
}

function canonicalSubjectColumns(orchestration: ReturnType<typeof parseContentOrchestrationV1>): {
  subjectMode: "brand_topic" | "product_service" | "new_subject";
  productServiceId: string | null;
} {
  return {
    subjectMode: orchestration.subject.mode,
    productServiceId: orchestration.subject.mode === "product_service"
      ? orchestration.subject.productServiceId
      : null,
  };
}

function mapProposal(row: Record<string, unknown>): AiContentProposalRecord {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    proposal: object(row.proposal_json),
    status: row.status as AiContentProposalRecord["status"],
    generationId: row.generation_id ? String(row.generation_id) : null,
    createdAt: iso(row.created_at) ?? "",
  };
}

function mapProposalBatch(row: Record<string, unknown>): AiContentProposalBatchRecord {
  const request = object(row.request_json);
  const v2 = request.contractVersion === "content-proposal-request.v2";
  const rawEvidence = object(row.evidence_json);
  const evidenceItems = Array.isArray(rawEvidence.items)
    ? rawEvidence.items.flatMap((value) => {
        const item = object(value);
        return typeof item.id === "string"
          && typeof item.title === "string"
          && typeof item.url === "string"
          ? [{
              id: item.id,
              title: item.title,
              url: item.url,
              publisher: typeof item.publisher === "string" ? item.publisher : null,
            }]
          : [];
      })
    : [];
  const inputSnapshot = object(row.input_snapshot_json);
  const selectedReferences = Array.isArray(inputSnapshot.references)
    ? inputSnapshot.references.flatMap((value) => {
        const reference = object(value);
        if (typeof reference.referenceItemId !== "string" || typeof reference.title !== "string") return [];
        const image = object(reference.image);
        return [{
          id: reference.referenceItemId,
          title: reference.title,
          preview: {
            url: typeof image.storageUrl === "string" ? image.storageUrl : null,
            mimeType: typeof image.mimeType === "string" ? image.mimeType : null,
          },
        }];
      })
    : [];
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    origin: row.origin as AiContentProposalBatchRecord["origin"],
    contentFamily: row.content_family as AiContentProposalBatchRecord["contentFamily"],
    request,
    sourceSnapshots: Array.isArray(row.source_snapshot_json)
      ? row.source_snapshot_json as Record<string, unknown>[]
      : [],
    status: row.status as AiContentProposalBatchRecord["status"],
    ...(Array.isArray(row.proposals)
      ? { proposals: (row.proposals as Record<string, unknown>[]).map(mapProposal) }
      : {}),
    ...(v2 && row.evidence_json ? { researchEvidence: { items: evidenceItems } } : {}),
    ...(v2 ? { selectedReferences } : {}),
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: iso(row.created_at) ?? "",
    updatedAt: iso(row.updated_at) ?? "",
  };
}

function attachmentDraftPortion(value: unknown): Record<string, unknown> {
  const draft = object(value);
  return Object.fromEntries(
    Object.entries(draft)
      .filter(([key]) => key.toLowerCase().includes("attachment"))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function loadAiContentBrandContext(
  client: Queryable,
  input: BrandScope,
  provider?: AiContentRepositoryOptions["brandIntelligenceProvider"],
): Promise<AiContentBrandContextRecord> {
  const brandResult = await client.query(
    `select brand.name,
            profile.industry, profile.primary_customer, profile.description, profile.tone,
            profile.forbidden_terms, profile.default_cta, profile.main_link, profile.brand_color,
            owned.url as owned_url, owned.status as source_status, owned.last_crawled_at
       from brands brand
       left join brand_profiles profile
         on profile.brand_id = brand.id and profile.workspace_id = brand.workspace_id
       left join lateral (
         select source.url, source.status, source.last_crawled_at
           from source_urls source
          where source.workspace_id = brand.workspace_id and source.brand_id = brand.id
            and source.source_type = 'owned' and source.deleted_at is null and source.enabled
          order by source.updated_at desc
          limit 1
       ) owned on true
      where brand.id = $1 and brand.workspace_id = $2 and brand.deleted_at is null`,
    [input.brandId, input.workspaceId],
  );
  const brand = brandResult.rows[0] as Record<string, unknown> | undefined;
  if (!brand) throw new Error("brand_not_found");

  const ownedUrl = brand.owned_url ? String(brand.owned_url) : null;
  const confirmed = provider ? await provider.getConfirmed(input) : null;
  const profile = {
    industry: confirmed?.profile.primaryCategory.name ?? brand.industry ?? null,
    primaryCustomer: confirmed?.profile.primaryTarget ?? brand.primary_customer ?? null,
    description: confirmed?.profile.businessDescription ?? brand.description ?? null,
    tone: brand.tone ?? null,
    forbiddenTerms: Array.isArray(brand.forbidden_terms) ? brand.forbidden_terms : [],
    defaultCta: brand.default_cta ?? null,
    mainLink: brand.main_link ?? null,
    brandColor: brand.brand_color ?? null,
  };
  return {
    ready: provider ? Boolean(confirmed) : Boolean(ownedUrl),
    brandName: String(brand.name),
    ownedUrl,
    sourceStatus: brand.source_status ? String(brand.source_status) : null,
    lastCrawledAt: iso(brand.last_crawled_at),
    wikiVersionId: null,
    wikiUpdatedAt: null,
    summary: confirmed?.profile.companyOverview ?? confirmed?.profile.businessDescription ?? (typeof brand.description === "string" ? brand.description : null),
    pageCount: 0,
    brandIntelligenceVersionId: confirmed?.versionId ?? null,
    context: {
      brand: { name: String(brand.name), ...profile },
      brandIntelligence: confirmed ? {
        versionId: confirmed.versionId,
        confirmedAt: confirmed.confirmedAt,
        profile: confirmed.profile,
        result: confirmed.result ?? confirmed.profile,
      } : null,
      ownedSource: ownedUrl ? { url: ownedUrl, status: brand.source_status ?? null, lastCrawledAt: iso(brand.last_crawled_at) } : null,
    },
  };
}

async function loadConfirmedSubjectAnalysisBrandContext(
  client: Queryable,
  input: BrandScope,
  provider?: AiContentRepositoryOptions["brandIntelligenceProvider"],
): Promise<SubjectAnalysisBrandContext> {
  const context = await loadAiContentBrandContext(client, input, provider);
  const intelligence = object(context.context.brandIntelligence);
  const profile = intelligence.profile as ConfirmedBrandIntelligence["profile"] | undefined;
  if (!context.brandIntelligenceVersionId || !profile || typeof intelligence.confirmedAt !== "string") {
    throw new Error("subject_analysis_brand_context_required");
  }
  const brand = object(context.context.brand);
  return {
    brandName: context.brandName,
    companyOverview: profile.companyOverview,
    businessDescription: profile.businessDescription,
    primaryCategory: profile.primaryCategory,
    subcategories: profile.subcategories,
    primaryTarget: profile.primaryTarget,
    differentiators: profile.differentiators,
    coreAppeal: profile.coreAppeal,
    brandColor: typeof brand.brandColor === "string" ? brand.brandColor : null,
    brandIntelligenceVersionId: context.brandIntelligenceVersionId,
    confirmedAt: intelligence.confirmedAt,
  };
}

async function bridgeScheduledCardNewsCompletion(
  client: Queryable,
  outputId: string,
  manifest: AiContentManifest,
  manifestUrl: string,
) {
  if (manifest.type !== "card_news") return;
  const linked = await client.query(
    `select channel_output.id, channel_output.workspace_id, channel_output.brand_id,
            channel_output.content_topic_id, channel_output.channel, channel_output.delivery_format,
            channel_output.status, channel_output.title, channel_output.output_json,
            topic_group.id as topic_publish_group_id,
            brand_channel.id as brand_channel_id,
            profile.auto_approval_enabled
       from channel_outputs channel_output
       join topic_publish_groups topic_group on topic_group.content_topic_id = channel_output.content_topic_id
       join brand_channels brand_channel
         on brand_channel.brand_id = channel_output.brand_id
        and brand_channel.channel = channel_output.channel
        and brand_channel.deleted_at is null
       join brand_profiles profile on profile.brand_id = channel_output.brand_id
      where channel_output.ai_content_generation_output_id = $1
        and channel_output.delivery_format = 'instagram_feed_carousel'
      for update of channel_output`,
    [outputId],
  );
  const row = linked.rows[0] as Record<string, unknown> | undefined;
  if (!row) return;

  const artifactUrl = new URL(manifestUrl);
  const artifactPath = decodeURIComponent(artifactUrl.pathname).replace(/^\/+/, "");
  const artifact = await client.query(
    `insert into storage_artifacts (workspace_id, brand_id, artifact_type, bucket, path, public_url, mime_type, byte_size)
     values ($1, $2, 'generated_manifest', 'vercel-blob', $3, $4, 'application/json', 0)
     on conflict (bucket, path) do update set public_url = excluded.public_url
     returning id`,
    [row.workspace_id, row.brand_id, artifactPath, manifestUrl],
  );
  const content = object(manifest.content);
  const cards = manifest.assets.map((asset) => ({
    index: asset.index,
    role: asset.role,
    embeddedText: "",
    url: asset.url,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
  }));
  const currentStatus = String(row.status ?? "generating");
  const autoApprovalEnabled = row.auto_approval_enabled === true;
  const nextStatus = currentStatus === "generating"
    ? autoApprovalEnabled ? "auto_approved" : "pending_review"
    : currentStatus;
  const outputJson = {
    ...object(row.output_json),
    deliveryFormat: "instagram_feed_carousel",
    generationState: "completed",
    artifactStatus: "ready",
    cards,
    caption: content.caption,
    hashtags: Array.isArray(content.hashtags) ? content.hashtags : [],
    cta: content.cta,
  };
  await client.query(
    `update channel_outputs
        set title = $2, preview_title = $2, preview_body = $3,
            output_json = $4::jsonb, rendered_artifact_id = $5, status = $6,
            approved_at = case when status = 'generating' and $6 = 'auto_approved' then now() else approved_at end,
            block_reasons = coalesce(block_reasons, '[]'::jsonb), updated_at = now()
      where id = $1`,
    [row.id, manifest.title, `카드뉴스 ${cards.length}장 구성`, JSON.stringify(outputJson), artifact.rows[0]?.id, nextStatus],
  );

  const approvalType = currentStatus === "approved"
    ? "manual"
    : currentStatus === "generating" && autoApprovalEnabled ? "auto" : null;
  if (approvalType) {
    await client.query(
      `insert into publish_queue (
         workspace_id, brand_id, channel_output_id, topic_publish_group_id,
         brand_channel_id, channel, approval_type, idempotency_key
       ) values ($1, $2, $3, $4, $5, 'instagram', $6, $7)
       on conflict (channel_output_id) do nothing`,
      [
        row.workspace_id,
        row.brand_id,
        row.id,
        row.topic_publish_group_id,
        row.brand_channel_id,
        approvalType,
        `${approvalType}:${row.id}`,
      ],
    );
  }
}

async function markLinkedScheduledCardNewsFailed(
  client: Queryable,
  generationId: string,
  outputId: string | null,
  errorCode: string,
  errorMessage: string,
) {
  await client.query(
    `update channel_outputs
        set status = 'generation_failed',
            output_json = jsonb_set(
              coalesce(output_json, '{}'::jsonb),
              '{generationError}',
              jsonb_build_object('code', $3::text, 'message', $4::text, 'failedAt', now()),
              true
            ),
            block_reasons = case
              when coalesce(block_reasons, '[]'::jsonb) ? 'generation_failed' then block_reasons
              else coalesce(block_reasons, '[]'::jsonb) || '["generation_failed"]'::jsonb
            end,
            updated_at = now()
      where status = 'generating'
        and ai_content_generation_output_id in (
          select output.id
            from ai_content_generation_outputs output
           where output.generation_id = $1
             and ($2::uuid is null or output.id = $2::uuid)
        )`,
    [generationId, outputId, errorCode, errorMessage],
  );
}

function requestedDimensionsFromDraft(value: unknown) {
  const draft = object(value);
  const brief = object(draft.brief);
  switch (brief.aspectRatio) {
    case "4:5": return { width: 1080, height: 1350 };
    case "9:16": return { width: 1080, height: 1920 };
    case "16:9": return { width: 1920, height: 1080 };
    default: return { width: 1080, height: 1080 };
  }
}

function mapGeneration(row: Record<string, unknown>): AiContentGenerationRecord {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), brandId: String(row.brand_id), type: row.type as AiContentType,
    title: String(row.title), status: String(row.status), currentStage: row.current_stage ? String(row.current_stage) : null,
    draft: object(row.draft_json), analysis: object(row.analysis_json), errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null, createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!, completedAt: iso(row.completed_at),
    attachmentsLockedAt: iso(row.attachments_locked_at),
    terminalAt: iso(row.terminal_at),
    retryableUntil: iso(row.retryable_until),
  };
}

function normalizedOutputManifestVersion(
  manifest: Record<string, unknown>,
): AiContentOutputRecord["manifestVersion"] {
  if (manifest.version === "ai-content.v1" || manifest.version === "ai-content.v2") return manifest.version;
  if (Object.prototype.hasOwnProperty.call(manifest, "version")) return null;
  const knownLegacyType = manifest.type === "card_news" || manifest.type === "blog" || manifest.type === "marketing";
  const knownLegacyDelivery = manifest.deliveryFormat === "instagram_feed_carousel"
    || manifest.deliveryFormat === "instagram_story"
    || manifest.deliveryFormat === "instagram_reel";
  return knownLegacyType || knownLegacyDelivery ? "ai-content.v1" : null;
}

function mapOutput(row: Record<string, unknown>): AiContentOutputRecord {
  const manifest = object(row.artifact_manifest_json);
  const manifestVersion = normalizedOutputManifestVersion(manifest);
  const legacyReadOnly = manifestVersion === "ai-content.v1"
    && (manifest.deliveryFormat === "instagram_reel" || manifest.outputFormat === "reel");
  const manifestType = String(manifest.type ?? manifest.outputFormat ?? "");
  const revisionCapabilities: AiContentOutputRecord["revisionCapabilities"] = legacyReadOnly
    ? []
    : manifestType === "card_news"
      ? ["save_copy", "regenerate_hook", "regenerate_copy", "regenerate_card"]
      : ["blog", "marketing", "single_image", "channel_text"].includes(manifestType)
        ? ["save_copy", "regenerate_hook", "regenerate_copy"]
        : [];
  return {
    id: String(row.id), generationId: String(row.generation_id), outputIndex: Number(row.output_index),
    title: row.title ? String(row.title) : null, status: row.status as AiContentOutputRecord["status"],
    content: object(row.content_json), manifest, manifestUrl: row.manifest_url ? String(row.manifest_url) : null,
    failureCode: row.failure_code ? String(row.failure_code) : null, failureMessage: row.failure_message ? String(row.failure_message) : null,
    downloadedAt: iso(row.downloaded_at), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!, completedAt: iso(row.completed_at),
    revisionCapabilities,
    legacyReadOnly,
    manifestVersion,
  };
}

const copyFieldsByFormat: Record<string, ReadonlySet<AiContentCopyField>> = {
  card_news: new Set(["hook", "keyMessage", "body", "cta", "caption", "hashtags"]),
  blog: new Set(["hook", "keyMessage", "body", "cta"]),
  marketing: new Set(["hook", "keyMessage", "body", "cta", "caption", "hashtags"]),
  single_image: new Set(["hook", "keyMessage", "body", "cta", "caption", "hashtags"]),
  channel_text: new Set(["hook", "keyMessage", "body", "cta", "caption", "hashtags"]),
};

function editableCopyFields(
  manifest: Record<string, unknown>,
  fields: Partial<Record<AiContentCopyField, string | string[]>>,
) {
  const format = String(manifest.type ?? manifest.outputFormat ?? "");
  const allowed = copyFieldsByFormat[format];
  if (!allowed) throw new Error("ai_content_copy_edit_unsupported");
  const entries = Object.entries(fields) as Array<[AiContentCopyField, string | string[]]>;
  if (!entries.length || entries.some(([field]) => !allowed.has(field))) {
    throw new Error("ai_content_copy_fields_invalid");
  }
  return Object.fromEntries(entries);
}

function mergeRevisionManifest(
  generatedManifest: AiContentManifest,
  revisionValue: unknown,
): AiContentManifest {
  const revision = object(revisionValue);
  if (revision.contractVersion !== "ai-content-revision.v1") return generatedManifest;
  const previousManifest = object(revision.previousManifest);
  const previousAssets = Array.isArray(previousManifest.assets) ? previousManifest.assets : [];
  if (revision.action === "regenerate_card") {
    const cardIndex = Number(revision.cardIndex);
    const generatedAssets = Array.isArray(generatedManifest.assets) ? generatedManifest.assets : [];
    const replacement = generatedAssets.find((asset, index) =>
      Number(object(asset).index ?? index + 1) === cardIndex);
    if (!replacement) throw new Error("ai_content_revision_card_result_missing");
    return {
      ...generatedManifest,
      ...previousManifest,
      assets: previousAssets.map((asset, index) =>
        Number(object(asset).index ?? index + 1) === cardIndex ? replacement : asset),
      content: object(revision.previousContent),
    } as unknown as AiContentManifest;
  }
  if (revision.action === "regenerate_hook" || revision.action === "regenerate_copy") {
    return {
      ...generatedManifest,
      ...(previousAssets.length ? { assets: previousAssets } : {}),
    } as unknown as AiContentManifest;
  }
  throw new Error("ai_content_revision_invalid");
}

function publicGenerationInputSnapshot(value: unknown): Record<string, unknown> {
  const source = object(value);
  const result: Record<string, unknown> = {};
  if (source.contractVersion === "content-generation-input.v3") {
    for (const key of [
      "contractVersion",
      "generationId",
      "brandCore",
      "subject",
      "contentInstruction",
      "researchEvidence",
      "selectedProposal",
      "userImageInstruction",
      "outputSettings",
      "capturedAt",
    ]) {
      if (source[key] !== undefined) result[key] = source[key];
    }
    const product = object(source.product);
    if (Object.keys(product).length) {
      const { images: _images, ...publicProduct } = product;
      result.product = publicProduct;
    } else if (source.product === null) {
      result.product = null;
    }
    return result;
  }
  for (const key of [
    "contractVersion",
    "contentType",
    "orchestration",
    "subject",
    "message",
    "creativeDirection",
  ]) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

async function generationEvidenceSnapshot(
  client: Queryable,
  input: BrandGenerationScope,
  row: Record<string, unknown>,
): Promise<NonNullable<AiContentGenerationRecord["evidenceSnapshot"]> | undefined> {
  const orchestration = object(row.orchestration_snapshot);
  let generationInputSource = row.generation_input_snapshot;
  if (Object.keys(object(generationInputSource)).length === 0) {
    const immutableInput = await client.query(
      `select input_json
         from ai_content_generation_input_snapshots
        where generation_id = $1 and workspace_id = $2 and brand_id = $3`,
      [input.generationId, input.workspaceId, input.brandId],
    );
    generationInputSource = immutableInput.rows[0]?.input_json;
  }
  const rawGenerationInput = object(generationInputSource);
  const generationInput = publicGenerationInputSnapshot(rawGenerationInput);
  const inputReferences = object(rawGenerationInput.references);
  const avatarStyleImageId = typeof inputReferences.avatarStyleImageId === "string"
    ? inputReferences.avatarStyleImageId
    : null;
  const storedAvatar = object(row.avatar_snapshot);
  const avatarSource = Object.keys(storedAvatar).length
    ? storedAvatar
    : avatarStyleImageId ? { id: avatarStyleImageId } : {};
  const storedProposal = object(orchestration.approvedProposalSnapshot);
  const proposalSource = Object.keys(storedProposal).length
    ? storedProposal
    : object(rawGenerationInput.selectedProposal);
  const references = await client.query(
    `select reference_id, reference_snapshot_json, roles_json
       from ai_content_generation_references
      where generation_id = $1 and workspace_id = $2 and brand_id = $3
      order by position`,
    [input.generationId, input.workspaceId, input.brandId],
  );
  if (
    Object.keys(orchestration).length === 0
    && Object.keys(generationInput).length === 0
    && Object.keys(avatarSource).length === 0
    && references.rows.length === 0
  ) {
    return undefined;
  }
  const frozenReferences = references.rows.length
    ? references.rows.map((reference) => {
      const snapshot = object(reference.reference_snapshot_json);
      return {
        id: String(reference.reference_id),
        title: String(snapshot.title ?? snapshot.caption ?? snapshot.url ?? reference.reference_id),
        url: snapshot.url ? String(snapshot.url) : snapshot.permalink ? String(snapshot.permalink) : null,
        previewUrl: snapshot.previewUrl ? String(snapshot.previewUrl) : snapshot.mediaUrl ? String(snapshot.mediaUrl) : null,
        roles: Array.isArray(reference.roles_json)
          ? reference.roles_json.filter((role: unknown): role is string => typeof role === "string")
          : [],
      };
    })
    : (Array.isArray(inputReferences.selected) ? inputReferences.selected : []).flatMap((value) => {
      const reference = object(value);
      const id = reference.referenceItemId ?? reference.id;
      if (typeof id !== "string") return [];
      return [{
        id,
        title: String(reference.title ?? reference.url ?? id),
        url: typeof reference.url === "string" ? reference.url : null,
        previewUrl: null,
        roles: Array.isArray(reference.roles)
          ? reference.roles.filter((role: unknown): role is string => typeof role === "string")
          : [],
      }];
    });
  return {
    orchestration,
    generationInput,
    references: frozenReferences,
    avatar: Object.keys(avatarSource).length ? avatarSource : null,
    proposal: Object.keys(proposalSource).length ? proposalSource : null,
  };
}

async function outputsForGenerations(client: Queryable, generationIds: string[]) {
  if (!generationIds.length) return new Map<string, AiContentOutputRecord[]>();
  const result = await client.query(
    `select id, generation_id, output_index, title, status, content_json, artifact_manifest_json, manifest_url,
            failure_code, failure_message, downloaded_at, created_at, updated_at, completed_at
       from ai_content_generation_outputs where generation_id = any($1::uuid[]) order by generation_id, output_index`,
    [generationIds],
  );
  const grouped = new Map<string, AiContentOutputRecord[]>();
  for (const item of result.rows.map(mapOutput)) grouped.set(item.generationId, [...(grouped.get(item.generationId) ?? []), item]);
  return grouped;
}

async function scopedGeneration(client: Queryable, input: BrandGenerationScope, lock = false) {
  const result = await client.query(
    `select id, workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json,
            generation_idempotency_key, subject_analysis_snapshot, generation_input_snapshot, attachments_locked_at,
            content_family, output_format, subject_mode, product_service_id, orchestration_snapshot, avatar_snapshot,
            terminal_at, retryable_until, error_code, error_message, created_at, updated_at, completed_at
       from ai_content_generations
      where id = $1 and workspace_id = $2 and brand_id = $3${lock ? " for update" : ""}`,
    [input.generationId, input.workspaceId, input.brandId],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

async function loadGenerationAttachments(client: Queryable, input: BrandGenerationScope): Promise<AiContentAttachmentRecord[]> {
  const result = await client.query(
    `select id, generation_id, role, file_name, mime_type, size_bytes, checksum, storage_url, storage_path, created_at
       from ai_content_generation_attachments
      where generation_id = $1 and workspace_id = $2 and brand_id = $3 and deleted_at is null
      order by created_at, id`,
    [input.generationId, input.workspaceId, input.brandId],
  );
  return result.rows.map((row) => mapAttachment(row as Record<string, unknown>));
}

async function loadGenerationReferences(client: Queryable, input: BrandGenerationScope & { referenceIds: string[] }): Promise<AiContentReferenceRecord[]> {
  if (!input.referenceIds.length) return [];
  const result = await client.query(
    `select reference_id, reference_snapshot_json
       from ai_content_generation_references
      where generation_id = $1 and workspace_id = $2 and brand_id = $3
      order by position`,
    [input.generationId, input.workspaceId, input.brandId],
  );
  const rows = new Map(result.rows.map((row) => [String(row.reference_id), object(row.reference_snapshot_json)]));
  if (input.referenceIds.some((id) => !rows.has(id))) throw new Error("ai_content_reference_not_found");
  return input.referenceIds.map((id) => {
    const snapshot = rows.get(id)!;
    const source = snapshot.source === "brand_output" || snapshot.source === "saved_trend" || snapshot.source === "saved_url" ? snapshot.source : "saved_url";
    return {
      id,
      source,
      title: String(snapshot.title ?? snapshot.caption ?? snapshot.permalink ?? snapshot.url ?? id),
      url: snapshot.url ? String(snapshot.url) : snapshot.permalink ? String(snapshot.permalink) : null,
      previewUrl: snapshot.previewUrl ? String(snapshot.previewUrl) : null,
      metrics: { likeCount: snapshot.likeCount ?? null, commentsCount: snapshot.commentsCount ?? null },
      checkedAt: null,
    };
  });
}

async function snapshotReferences(client: Queryable, input: BrandGenerationScope, referenceIds: string[]) {
  await client.query(
    "delete from ai_content_generation_references where generation_id = $1 and workspace_id = $2 and brand_id = $3",
    [input.generationId, input.workspaceId, input.brandId],
  );
  const snapshotRows = referenceIds.length === 0 ? [] : (await client.query(
    `select id, snapshot from (
       select co.id, jsonb_build_object('source', 'brand_output', 'title', co.title, 'outputJson', co.output_json) as snapshot
         from channel_outputs co where co.workspace_id = $1 and co.brand_id = $2
       union all
       select saved.id, jsonb_build_object(
         'source', 'saved_trend',
         'permalink', media.permalink,
         'caption', media.caption,
         'username', media.username,
         'mediaType', media.media_type,
         'mediaUrl', media.media_url,
         'previewUrl', coalesce(media.raw_metadata->>'_previewUrl', media.media_url),
         'postedAt', media.posted_at,
         'likeCount', media.like_count,
         'commentsCount', media.comments_count
       ) as snapshot
         from brand_trend_saved_media saved join instagram_trend_media media on media.id = saved.trend_media_id
        where saved.workspace_id = $1 and saved.brand_id = $2
       union all
       select source.id, jsonb_build_object('source', 'saved_url', 'url', source.url, 'title', source.title) as snapshot
         from source_urls source where source.workspace_id = $1 and source.brand_id = $2 and source.deleted_at is null
     ) reference_rows where id = any($3::uuid[])`,
    [input.workspaceId, input.brandId, referenceIds],
  )).rows;
  const byId = new Map(snapshotRows.map((row) => [String(row.id), object(row.snapshot)]));
  if (byId.size !== referenceIds.length) throw new Error("ai_content_reference_not_found");
  for (const [index, referenceId] of referenceIds.entries()) {
    await client.query(
      `insert into ai_content_generation_references
         (generation_id, reference_id, workspace_id, brand_id, position, reference_snapshot_json)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [input.generationId, referenceId, input.workspaceId, input.brandId, index + 1, JSON.stringify(byId.get(referenceId))],
    );
  }
}

async function snapshotCanonicalReferences(
  client: Queryable,
  input: BrandGenerationScope,
  references: Array<{ referenceItemId: string; roles: string[] }>,
) {
  await client.query(
    "delete from ai_content_generation_references where generation_id=$1 and workspace_id=$2 and brand_id=$3",
    [input.generationId, input.workspaceId, input.brandId],
  );
  for (const [index, reference] of references.entries()) {
    const selected = await client.query(
      `select item.id, snapshot.id snapshot_id, snapshot.snapshot_json,
              pattern.id pattern_version_id
         from reference_items item
         join lateral (
           select * from reference_snapshots candidate
            where candidate.reference_item_id=item.id
              and candidate.workspace_id=item.workspace_id
              and candidate.brand_id=item.brand_id
            order by candidate.version desc limit 1
         ) snapshot on true
         join lateral (
           select * from reference_pattern_versions candidate
            where candidate.reference_item_id=item.id
              and candidate.reference_snapshot_id=snapshot.id
              and candidate.workspace_id=item.workspace_id
              and candidate.brand_id=item.brand_id
            order by candidate.version desc limit 1
         ) pattern on true
        where item.id=$1 and item.workspace_id=$2 and item.brand_id=$3
          and item.archived_at is null`,
      [reference.referenceItemId, input.workspaceId, input.brandId],
    );
    const row = selected.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error("ai_content_reference_not_found");
    await client.query(
      `insert into ai_content_generation_references (
         generation_id,reference_id,workspace_id,brand_id,position,reference_snapshot_json,
         reference_item_id,reference_snapshot_id,pattern_version_id,roles_json
       ) values ($1,$2,$3,$4,$5,$6::jsonb,$2,$7,$8,$9::jsonb)`,
      [
        input.generationId,
        reference.referenceItemId,
        input.workspaceId,
        input.brandId,
        index + 1,
        JSON.stringify(row.snapshot_json),
        row.snapshot_id,
        row.pattern_version_id,
        JSON.stringify(reference.roles),
      ],
    );
  }
}

function mapAudience(row: Record<string, unknown>): AudienceRecord {
  return { id: String(row.id), name: String(row.name), situation: String(row.situation), problem: String(row.problem), motivation: String(row.motivation), useCount: Number(row.use_count), lastUsedAt: iso(row.last_used_at) };
}

function mapAppeal(row: Record<string, unknown>): AppealRecord {
  return { id: String(row.id), title: String(row.title), description: String(row.description), evidenceType: row.evidence_type as AppealRecord["evidenceType"], useCount: Number(row.use_count), lastUsedAt: iso(row.last_used_at) };
}

function mapAttachment(row: Record<string, unknown>): AiContentAttachmentRecord {
  return {
    id: String(row.id),
    generationId: String(row.generation_id),
    role: row.role as AiContentAttachmentRecord["role"],
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    checksum: String(row.checksum),
    storageUrl: String(row.storage_url),
    storagePath: String(row.storage_path),
    createdAt: iso(row.created_at)!,
  };
}

function mapSubjectEvidenceAttachment(row: Record<string, unknown>): SubjectEvidenceAttachment {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    generationId: String(row.generation_id),
    role: row.role as SubjectEvidenceAttachment["role"],
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    checksum: String(row.checksum),
    storageUrl: String(row.storage_url),
    storagePath: String(row.storage_path),
    createdAt: iso(row.created_at)!,
    deletedAt: iso(row.deleted_at),
  };
}

function mapJob(row: Record<string, unknown>): AiContentJobRecord {
  return {
    id: String(row.id),
    generationId: String(row.generation_id),
    outputId: row.output_id ? String(row.output_id) : null,
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    jobType: row.job_type as AiContentJobRecord["jobType"],
    contentType: row.content_type as AiContentType,
    status: row.status as AiContentJobRecord["status"],
    payload: object(row.payload_json),
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    workerId: row.worker_id ? String(row.worker_id) : null,
    leaseToken: row.lease_token ? String(row.lease_token) : null,
    leaseExpiresAt: iso(row.lease_expires_at),
    availableAt: iso(row.available_at)!,
  };
}

async function generationById(client: Queryable, generationId: string) {
  const result = await client.query(
    `select id, workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json,
            attachments_locked_at, terminal_at, retryable_until,
            error_code, error_message, created_at, updated_at, completed_at
       from ai_content_generations where id = $1`,
    [generationId],
  );
  if (!result.rowCount) throw new Error("ai_content_generation_not_found");
  return mapGeneration(result.rows[0]);
}

async function lockAiContentJobContext(client: Queryable, jobId: string) {
  const lookup = await client.query(
    `select generation_id, output_id
       from ai_content_generation_jobs
      where id = $1`,
    [jobId],
  );
  const expected = lookup.rows[0] as Record<string, unknown> | undefined;
  if (!expected) throw new Error("ai_content_job_not_found");
  const generationId = String(expected.generation_id);
  const outputId = expected.output_id ? String(expected.output_id) : null;

  const generation = await client.query(
    `select id
       from ai_content_generations
      where id = $1
      for update`,
    [generationId],
  );
  if (!generation.rowCount) throw new Error("ai_content_job_not_found");

  if (outputId) {
    const output = await client.query(
      `select id, generation_id
         from ai_content_generation_outputs
        where id = $1
        for update`,
      [outputId],
    );
    if (
      !output.rowCount
      || String(output.rows[0]?.generation_id) !== generationId
    ) {
      throw new Error("ai_content_job_not_found");
    }
  }

  const locked = await client.query(
    `select *,
            lease_expires_at <= clock_timestamp() as lease_expired,
            available_at <= clock_timestamp() as available
       from ai_content_generation_jobs
      where id = $1
      for update`,
    [jobId],
  );
  const job = locked.rows[0] as Record<string, unknown> | undefined;
  if (
    !job
    || String(job.generation_id) !== generationId
    || (job.output_id ? String(job.output_id) : null) !== outputId
  ) {
    throw new Error("ai_content_job_not_found");
  }
  return job;
}

async function recalculateGenerationStatus(client: Queryable, generationId: string) {
  const generation = await client.query(
    `select id
       from ai_content_generations
      where id = $1
      for update`,
    [generationId],
  );
  if (!generation.rowCount) throw new Error("ai_content_generation_not_found");
  const counts = await client.query(
    `select count(*)::integer as total,
            count(*) filter (where status = 'completed')::integer as completed,
            count(*) filter (where status = 'failed')::integer as failed
       from ai_content_generation_outputs where generation_id = $1`,
    [generationId],
  );
  const total = Number(counts.rows[0]?.total ?? 0);
  const completed = Number(counts.rows[0]?.completed ?? 0);
  const failed = Number(counts.rows[0]?.failed ?? 0);
  const terminal = total > 0 && completed + failed === total;
  const status = completed === total && total > 0
    ? "completed"
    : failed === total && total > 0
      ? "failed"
      : terminal
        ? "partial_failed"
        : "generating";
  await client.query(
    `update ai_content_generations
        set status = $2, current_stage = $3,
            completed_at = case when $4 then coalesce(completed_at, now()) else null end,
            terminal_at = case
              when $4::boolean and status not in ('completed','partial_failed','failed')
                then statement_timestamp()
              else terminal_at
            end,
            retryable_until = case
              when $4::boolean and status not in ('completed','partial_failed','failed')
                then statement_timestamp() + interval '15 days'
              else retryable_until
            end,
            updated_at = now()
      where id = $1`,
    [generationId, status, terminal ? "completed" : "generation", terminal],
  );
}

function generationInputForWorker(
  snapshot: unknown,
  analysisJson: unknown,
  jobType: unknown,
): ContentGenerationInputV2 | undefined {
  if (!snapshot) return undefined;
  const parsed = parseContentGenerationInputV2(snapshot);
  if (jobType !== "generate") return parsed;
  const finalBrief = object(analysisJson).qualityBrief;
  if (!finalBrief || typeof finalBrief !== "object" || Array.isArray(finalBrief)) return parsed;
  return {
    ...parsed,
    message: { ...parsed.message, qualityBrief: object(finalBrief) },
  };
}

export function createAiContentRepository(pool: Pool, options: AiContentRepositoryOptions = {}): AiContentRepository {
  const subjectRepository = createAiContentSubjectRepository(pool);
  const attachmentLifecycle = createAiContentAttachmentRepository(pool);
  const proposalJobs = createContentProposalJobsRepository(pool);
  const renderJobs = createAiContentRenderJobsRepository(pool, generationById);
  return {
    ...attachmentLifecycle,
    ...proposalJobs,
    claimAiContentRenderJob: renderJobs.claim,
    heartbeatAiContentRenderJob: renderJobs.heartbeat,
    completeAiContentRenderAsset: renderJobs.completeAsset,
    completeAiContentRenderPackage: renderJobs.completePackage,
    failAiContentRenderJob: renderJobs.fail,
    saveAiContentOutputResearch: renderJobs.saveOutputResearch,
    getAiContentBrandContext(input) {
      return loadAiContentBrandContext(pool, input, options.brandIntelligenceProvider);
    },

    getConfirmedSubjectAnalysisBrandContext(input) {
      return loadConfirmedSubjectAnalysisBrandContext(pool, input, options.brandIntelligenceProvider);
    },

    async listSubjectEvidenceAttachments(input) {
      if (input.attachmentIds.length === 0) return [];
      const result = await pool.query(
        `select id, workspace_id, brand_id, generation_id, role, file_name, mime_type,
                size_bytes, checksum, storage_url, storage_path, created_at, deleted_at
           from ai_content_generation_attachments
          where generation_id = $1 and workspace_id = $2 and brand_id = $3
            and id = any($4::uuid[]) and deleted_at is null
          order by created_at, id`,
        [input.generationId, input.workspaceId, input.brandId, input.attachmentIds],
      );
      return result.rows.map((row) => mapSubjectEvidenceAttachment(row as Record<string, unknown>));
    },

    async getSubjectAnalysisWorkerLease(input) {
      const result = await pool.query(
        `select id, contract_version, status, subject_type, attachment_ids_json
           from ai_content_subject_analyses
          where id = $1 and leased_by = $2 and lease_token = $3
            and lease_expires_at > now() and superseded_at is null
            and status in ('extracting', 'researching', 'analyzing', 'generating_appeals')`,
        [input.analysisId, input.workerId, input.leaseToken],
      );
      if (!result.rowCount) return null;
      const row = result.rows[0] as Record<string, unknown>;
      const contractVersion = row.contract_version === "subject-analysis.v2"
        ? "subject-analysis.v2"
        : "subject-analysis.v1";
      return {
        analysisId: String(row.id),
        contractVersion,
        subjectType: row.subject_type as SubjectAnalysisWorkerLease["subjectType"],
        attachmentIds: Array.isArray(row.attachment_ids_json)
          ? row.attachment_ids_json.map(String)
          : [],
        phase: contractVersion === "subject-analysis.v2" && row.status === "generating_appeals"
          ? "appeal"
          : "analysis",
      };
    },

    async createAiContentAnalysis(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assertActiveAiContentActor(client, input);
        const existing = await client.query(
    `select id, workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json, generation_idempotency_key,
                  attachments_locked_at, terminal_at, retryable_until,
                  error_code, error_message, created_at, updated_at, completed_at
             from ai_content_generations
            where workspace_id = $1 and brand_id = $2 and analysis_idempotency_key = $3
            for update`,
          [input.workspaceId, input.brandId, input.idempotencyKey],
        );
        if (existing.rowCount) {
          await client.query("COMMIT");
          return mapGeneration(existing.rows[0]);
        }
        const draft: Record<string, unknown> = {
          ...object(input.draft),
          ...(input.orchestration ? { orchestration: input.orchestration } : {}),
          origin: "manual",
        };
        const usesOwnedContext = draft.analysisSource === "owned";
        const usesCompletedSubjectAnalysis = typeof draft.subjectAnalysisId === "string"
          && draft.subjectAnalysisId.trim().length > 0;
        const analysisAlreadyReady = usesOwnedContext || usesCompletedSubjectAnalysis;
        const brandContext = usesOwnedContext
          ? await loadAiContentBrandContext(client, input, options.brandIntelligenceProvider)
          : null;
        if (usesOwnedContext && options.brandIntelligenceProvider && !brandContext?.brandIntelligenceVersionId) {
          throw new Error("brand_intelligence_required");
        }
        const initialStatus = analysisAlreadyReady ? "analysis_ready" : "analyzing";
        const initialStage = analysisAlreadyReady ? "analysis_ready" : "analysis";
        const initialAnalysis = usesOwnedContext ? {
          source: "owned",
          contextReady: Boolean(brandContext?.ready),
          summary: brandContext?.summary,
          ownedUrl: brandContext?.ownedUrl,
          lastCrawledAt: brandContext?.lastCrawledAt,
          brandIntelligenceVersionId: brandContext?.brandIntelligenceVersionId,
        } : {};
        const contentFamily = input.type === "marketing" ? "marketing" : "informational";
        const outputFormat = input.type === "marketing" ? "single_image" : input.type;
        const productServiceId = typeof draft.productServiceId === "string"
          && draft.productServiceId.trim().length > 0
          ? draft.productServiceId.trim()
          : null;
        const subjectMode = productServiceId
          ? "product_service"
          : usesCompletedSubjectAnalysis
            ? "new_subject"
            : "brand_topic";
        const created = await client.query(
          `insert into ai_content_generations
             (workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json,
              analysis_idempotency_key, content_family, output_format, subject_mode, product_service_id,
              created_by_user_id, updated_by_user_id)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14, $14)
           on conflict (brand_id, analysis_idempotency_key) do nothing
           returning id, workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json,
                     attachments_locked_at, terminal_at, retryable_until,
                     error_code, error_message, created_at, updated_at, completed_at`,
          [
            input.workspaceId,
            input.brandId,
            input.type,
            input.title,
            initialStatus,
            initialStage,
            JSON.stringify(draft),
            JSON.stringify(initialAnalysis),
            input.idempotencyKey,
            contentFamily,
            outputFormat,
            subjectMode,
            productServiceId,
            input.actorUserId,
          ],
        );
        const generation = created.rows[0] as Record<string, unknown> | undefined;
        if (!generation) {
          const conflicted = await client.query(
            `select id, workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json,
                    attachments_locked_at, terminal_at, retryable_until,
                    error_code, error_message, created_at, updated_at, completed_at
               from ai_content_generations where workspace_id = $1 and brand_id = $2 and analysis_idempotency_key = $3`,
            [input.workspaceId, input.brandId, input.idempotencyKey],
          );
          if (!conflicted.rowCount) throw new Error("ai_content_analysis_create_conflict");
          await client.query("COMMIT");
          return mapGeneration(conflicted.rows[0]);
        }
        if (!analysisAlreadyReady) {
          await client.query(
            `insert into ai_content_generation_jobs
               (generation_id, workspace_id, brand_id, job_type, content_type, status, payload_json)
             values ($1, $2, $3, 'analyze', $4, 'queued', jsonb_build_object('generationId', $1::uuid))
             on conflict do nothing`,
            [generation.id, input.workspaceId, input.brandId, input.type],
          );
        }
        await client.query("COMMIT");
        return mapGeneration(generation);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async createAiContentProposalBatch(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assertActiveAiContentActor(client, input);
        const replay = await client.query(
          `select *,
                  (request_json - 'performanceEvidence') = $4::jsonb request_matches
             from ai_content_proposal_batches
            where workspace_id=$1 and brand_id=$2 and idempotency_key=$3
            for update`,
          [
            input.workspaceId,
            input.brandId,
            input.idempotencyKey,
            JSON.stringify(input.request),
          ],
        );
        if (replay.rowCount) {
          const batch = replay.rows[0] as Record<string, unknown>;
          if (batch.request_matches !== true) {
            throw new Error("ai_content_proposal_batch_conflict");
          }
          await client.query("COMMIT");
          return mapProposalBatch(batch);
        }
        const sourceIds = [...new Set(input.request.sourceSnapshotIds)];
        const sources = sourceIds.length
          ? await client.query(
              `select snapshot.id, snapshot.source_url_id, source.url,
                      snapshot.fetched_at, snapshot.content_hash,
                      coalesce(snapshot.summary, left(snapshot.extracted_text, 2000), '') summary
                 from source_urls source
                 join source_snapshots snapshot on snapshot.source_url_id=source.id
                where source.workspace_id=$1 and source.brand_id=$2
                  and source.deleted_at is null and source.enabled=true
                  and snapshot.workspace_id=$1 and snapshot.brand_id=$2
                  and snapshot.status='succeeded'
                  and snapshot.id=any($3::uuid[])
                  and not exists (
                    select 1 from source_snapshots newer
                     where newer.source_url_id=snapshot.source_url_id
                       and newer.status='succeeded'
                       and (newer.fetched_at,newer.id) > (snapshot.fetched_at,snapshot.id)
                  )
                order by snapshot.id`,
              [input.workspaceId, input.brandId, sourceIds],
            )
          : { rows: [], rowCount: 0 };
        if (Number(sources.rowCount) !== sourceIds.length) {
          throw new Error("ai_content_source_snapshot_invalid");
        }
        const performanceIds = [...new Set(input.request.performanceSnapshotIds)];
        const performance = performanceIds.length
          ? await client.query(
              `select performance.id, performance.snapshot_date,
                      performance.raw_metrics, performance.collected_at,
                      performance.channel_output_id
                 from content_performance_snapshots performance
                 join channel_outputs output
                   on output.id=performance.channel_output_id
                  and output.workspace_id=performance.workspace_id
                  and output.brand_id=performance.brand_id
                  and output.channel=performance.channel
                where performance.workspace_id=$1 and performance.brand_id=$2
                  and performance.id=any($3::uuid[])
                  and performance.collected_at is not null
                  and output.status in ('published','completed')
                order by performance.id`,
              [input.workspaceId, input.brandId, performanceIds],
            )
          : { rows: [], rowCount: 0 };
        if (Number(performance.rowCount) !== performanceIds.length) {
          throw new Error("ai_content_performance_snapshot_invalid");
        }
        const sourceSnapshots = sources.rows.map((row) => ({
          sourceId: String(row.id),
          url: String(row.url),
          crawledAt: iso(row.fetched_at),
          contentHash: String(row.content_hash),
          summary: String(row.summary ?? ""),
        }));
        const requestSnapshot = {
          ...input.request,
          performanceEvidence: performance.rows.map((row) => ({
            snapshotId: String(row.id),
            channelOutputId: String(row.channel_output_id ?? ""),
            snapshotDate: String(row.snapshot_date),
            metrics: object(row.raw_metrics),
            collectedAt: iso(row.collected_at),
          })),
        };
        await client.query(
          `insert into source_crawl_runs (
             workspace_id,brand_id,source_url_id,run_key,trigger,status
           )
           select source.workspace_id,source.brand_id,source.id,
                  'proposal-refresh:' || source.id::text || ':' || current_date::text,
                  'manual','queued'
             from source_urls source
             left join lateral (
               select fetched_at from source_snapshots snapshot
                where snapshot.source_url_id=source.id and snapshot.status='succeeded'
                order by fetched_at desc limit 1
             ) latest on true
            where source.workspace_id=$1 and source.brand_id=$2
              and source.enabled=true and source.deleted_at is null
              and (latest.fetched_at is null or latest.fetched_at < now() - interval '7 days')
           on conflict (run_key) do nothing`,
          [input.workspaceId, input.brandId],
        );
        const created = await client.query(
          `insert into ai_content_proposal_batches (
             workspace_id,brand_id,origin,content_family,request_json,
             source_snapshot_json,status,idempotency_key,created_by_user_id
           ) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'queued',$7,$8)
           on conflict (workspace_id,brand_id,idempotency_key) do nothing
           returning *`,
          [
            input.workspaceId,
            input.brandId,
            input.origin,
            input.request.contentFamily,
            JSON.stringify(requestSnapshot),
            JSON.stringify(sourceSnapshots),
            input.idempotencyKey,
            input.actorUserId,
          ],
        );
        let batch = created.rows[0] as Record<string, unknown> | undefined;
        if (!batch) {
          const existing = await client.query(
            `select * from ai_content_proposal_batches
              where workspace_id=$1 and brand_id=$2 and idempotency_key=$3
                and (request_json - 'performanceEvidence')=$4::jsonb
              for update`,
            [
              input.workspaceId,
              input.brandId,
              input.idempotencyKey,
              JSON.stringify(input.request),
            ],
          );
          batch = existing.rows[0];
          if (!batch) {
            throw new Error("ai_content_proposal_batch_conflict");
          }
        }
        if (created.rowCount) {
          await client.query(
            `insert into ai_content_proposal_jobs (workspace_id,brand_id,batch_id,status)
             values ($1,$2,$3,'queued')`,
            [input.workspaceId, input.brandId, batch.id],
          );
        }
        await client.query("COMMIT");
        return mapProposalBatch(batch);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async getAiContentProposalBatchV2Replay(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assertActiveAiContentActor(client, input);
        const replay = await client.query(
          `select *,
                  created_by_user_id = $4 actor_matches,
                  request_json->>'requestFingerprint' = $5 request_fingerprint_matches
             from ai_content_proposal_batches
            where workspace_id=$1 and brand_id=$2 and idempotency_key=$3
            for update`,
          [
            input.workspaceId,
            input.brandId,
            input.idempotencyKey,
            input.actorUserId,
            input.requestFingerprint,
          ],
        );
        if (!replay.rowCount) {
          await client.query("COMMIT");
          return null;
        }
        const batch = replay.rows[0] as Record<string, unknown>;
        if (batch.actor_matches !== true || batch.request_fingerprint_matches !== true) {
          throw new Error("ai_content_proposal_batch_conflict");
        }
        await client.query("COMMIT");
        return mapProposalBatch(batch);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async createAiContentProposalBatchV2(input) {
      const client = await pool.connect();
      const request = {
        contractVersion: "content-proposal-request.v2",
        purpose: input.purpose,
        outputFormat: input.outputFormat,
        channelTargets: [input.channelTarget],
        requestFingerprint: input.requestFingerprint,
      };
      try {
        await client.query("BEGIN");
        const requestJson = JSON.stringify(request);
        const inputSnapshotJson = JSON.stringify(input.inputSnapshot);
        await assertActiveAiContentActor(client, input);
        const replay = await client.query(
          `select *,
                  created_by_user_id = $4 actor_matches,
                  request_json->>'requestFingerprint' = $5 request_fingerprint_matches
             from ai_content_proposal_batches
            where workspace_id=$1 and brand_id=$2 and idempotency_key=$3
            for update`,
          [
            input.workspaceId,
            input.brandId,
            input.idempotencyKey,
            input.actorUserId,
            input.requestFingerprint,
          ],
        );
        if (replay.rowCount) {
          const batch = replay.rows[0] as Record<string, unknown>;
          if (batch.actor_matches !== true || batch.request_fingerprint_matches !== true) {
            throw new Error("ai_content_proposal_batch_conflict");
          }
          await client.query("COMMIT");
          return mapProposalBatch(batch);
        }

        const created = await client.query(
          `insert into ai_content_proposal_batches (
             workspace_id,brand_id,origin,content_family,request_json,
             source_snapshot_json,input_snapshot_json,status,idempotency_key,created_by_user_id
           ) values ($1,$2,$3,$4,$5::jsonb,'[]'::jsonb,$6::jsonb,'queued',$7,$8)
           on conflict (workspace_id,brand_id,idempotency_key) do nothing
           returning *`,
          [
            input.workspaceId,
            input.brandId,
            input.origin,
            input.purpose,
            requestJson,
            inputSnapshotJson,
            input.idempotencyKey,
            input.actorUserId,
          ],
        );
        let batch = created.rows[0] as Record<string, unknown> | undefined;
        if (!batch) {
          const existing = await client.query(
            `select *,
                    created_by_user_id = $4 actor_matches,
                    request_json->>'requestFingerprint' = $5 request_fingerprint_matches
               from ai_content_proposal_batches
              where workspace_id=$1 and brand_id=$2 and idempotency_key=$3
              for update`,
            [
              input.workspaceId,
              input.brandId,
              input.idempotencyKey,
              input.actorUserId,
              input.requestFingerprint,
            ],
          );
          batch = existing.rows[0] as Record<string, unknown> | undefined;
          if (
            !batch
            || batch.actor_matches !== true
            || batch.request_fingerprint_matches !== true
          ) {
            throw new Error("ai_content_proposal_batch_conflict");
          }
        } else {
          await client.query(
            `insert into ai_content_proposal_jobs (workspace_id,brand_id,batch_id,status)
             values ($1,$2,$3,'queued')`,
            [input.workspaceId, input.brandId, batch.id],
          );
        }
        await client.query("COMMIT");
        return mapProposalBatch(batch);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async getAiContentProposalBatch(input) {
      const result = await pool.query(
        `select batch.*,research.evidence_json,
                coalesce(jsonb_agg(to_jsonb(proposal) order by proposal.position)
                  filter (where proposal.id is not null),'[]'::jsonb) proposals
           from ai_content_proposal_batches batch
           left join ai_content_proposals proposal
             on proposal.batch_id=batch.id
            and proposal.workspace_id=batch.workspace_id
            and proposal.brand_id=batch.brand_id
           left join ai_content_proposal_research_snapshots research
             on research.batch_id=batch.id
            and research.workspace_id=batch.workspace_id
            and research.brand_id=batch.brand_id
          where batch.id=$1 and batch.workspace_id=$2 and batch.brand_id=$3
          group by batch.id,research.evidence_json`,
        [input.batchId, input.workspaceId, input.brandId],
      );
      return result.rowCount ? mapProposalBatch(result.rows[0]) : null;
    },

    async listAiContentProposals(input) {
      const result = await pool.query(
        `select proposal.*
           from ai_content_proposals proposal
           join ai_content_proposal_batches batch
             on batch.id=proposal.batch_id
            and batch.workspace_id=proposal.workspace_id
            and batch.brand_id=proposal.brand_id
          where proposal.workspace_id=$1 and proposal.brand_id=$2
            and proposal.status=$3
            and batch.origin='scheduled_crawl'
          order by proposal.created_at desc,proposal.id`,
        [input.workspaceId, input.brandId, input.status],
      );
      return result.rows.map(mapProposal);
    },

    async selectAiContentProposal(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assertActiveAiContentActor(client, input);
        await client.query(
          "select select_ai_content_proposal($1,$2,$3,$4) selected",
          [input.proposalId, input.workspaceId, input.brandId, input.actorUserId],
        );
        const selected = await client.query(
          `select proposal.id,proposal.proposal_json,proposal.generation_id,
                  batch.content_family,batch.input_snapshot_json,
                  research.evidence_json
             from ai_content_proposals proposal
             join ai_content_proposal_batches batch
               on batch.id=proposal.batch_id
              and batch.workspace_id=proposal.workspace_id
              and batch.brand_id=proposal.brand_id
             left join ai_content_proposal_research_snapshots research
               on research.batch_id=batch.id
              and research.workspace_id=batch.workspace_id
              and research.brand_id=batch.brand_id
            where proposal.id=$1 and proposal.workspace_id=$2 and proposal.brand_id=$3
            for update of proposal`,
          [input.proposalId, input.workspaceId, input.brandId],
        );
        const proposal = selected.rows[0] as Record<string, unknown> | undefined;
        if (!proposal) throw new Error("ai_content_proposal_not_found");
        const baseSnapshot = object(proposal.input_snapshot_json);
        const isV2Selection = baseSnapshot.contractVersion === "proposal-base-input.v2"
          || baseSnapshot.contractVersion === "proposal-input.v2";
        const proposalInput = isV2Selection
          ? parseProposalInputSnapshotV2(baseSnapshot.contractVersion === "proposal-input.v2"
            ? baseSnapshot
            : {
              ...baseSnapshot,
              contractVersion: "proposal-input.v2",
              researchEvidence: proposal.evidence_json,
            })
          : null;
        if (proposal.generation_id) {
          const linked = await client.query(
            `select id,workspace_id,brand_id,type,title,status,current_stage,draft_json,analysis_json,
                    analysis_idempotency_key,attachments_locked_at,terminal_at,retryable_until,
                    error_code,error_message,created_at,updated_at,completed_at
               from ai_content_generations
              where id=$1 and workspace_id=$2 and brand_id=$3
              for update`,
            [proposal.generation_id, input.workspaceId, input.brandId],
          );
          const existing = linked.rows[0] as Record<string, unknown> | undefined;
          const existingDraft = object(existing?.draft_json);
          if (!existing
            || existing.status !== "draft"
            || existing.analysis_idempotency_key !== `proposal:${input.proposalId}:${input.idempotencyKey}`
            || (existingDraft.origin !== "proposal" && existingDraft.origin !== "proposal-v2")
            || existingDraft.proposalId !== input.proposalId) {
            throw new Error("ai_content_proposal_selection_conflict");
          }
          await client.query("COMMIT");
          return mapGeneration(existing);
        }
        const proposalJson = object(proposal.proposal_json);
        const outputFormat = String(proposalJson.outputFormat ?? "blog");
        const type: AiContentType = outputFormat === "card_news"
          ? "card_news"
          : outputFormat === "blog"
            ? "blog"
            : "marketing";
        const generationId = randomUUID();
        const approvedVersionId = randomUUID();
        const approvedAt = new Date().toISOString();
        const approvedSnapshot = {
          contractVersion: "approved-proposal.v1",
          sourceProposalId: input.proposalId,
          revision: 1,
          effectiveProposal: proposalJson,
          editPatch: [],
          validationResultId: `proposal-selection:${input.idempotencyKey}`,
          approvedBy: input.actorUserId,
          approvedAt,
        };
        const created = await client.query(
          `insert into ai_content_generations (
             id,workspace_id,brand_id,type,title,status,current_stage,draft_json,
             analysis_json,analysis_idempotency_key,content_family,output_format,subject_mode,
             product_service_id,created_by_user_id,updated_by_user_id
           ) values ($1,$2,$3,$4,$5,'draft','draft',$6::jsonb,'{}',$7,$8,$9,$10,$11,$12,$12)
           returning id,workspace_id,brand_id,type,title,status,current_stage,draft_json,analysis_json,
                     attachments_locked_at,terminal_at,retryable_until,error_code,error_message,
                     created_at,updated_at,completed_at`,
          [
            generationId,
            input.workspaceId,
            input.brandId,
            type,
            String(proposalJson.title ?? "콘텐츠 제안"),
            JSON.stringify({
              origin: isV2Selection ? "proposal-v2" : "proposal",
              proposalId: input.proposalId,
              approvedProposalVersionId: approvedVersionId,
              ...(isV2Selection ? {
                finalization: {
                  contractVersion: "content-finalization-draft.v2",
                  avatarStyleImageId: null,
                  userImageInstruction: null,
                  attachmentIds: [],
                },
              } : {}),
            }),
            `proposal:${input.proposalId}:${input.idempotencyKey}`,
            proposal.content_family,
            outputFormat,
            null,
            null,
            input.actorUserId,
          ],
        );
        await client.query(
          `insert into ai_content_approved_proposal_versions (
             id,workspace_id,brand_id,proposal_id,revision,approved_proposal_snapshot,
             validation_result_id,approved_by_user_id,approved_at
           ) values ($1,$2,$3,$4,1,$5::jsonb,$6,$7,$8::timestamptz)`,
          [
            approvedVersionId,
            input.workspaceId,
            input.brandId,
            input.proposalId,
            JSON.stringify(approvedSnapshot),
            approvedSnapshot.validationResultId,
            input.actorUserId,
            approvedAt,
          ],
        );
        if (proposalInput) {
          const referenceIds = proposalInput.references.map((reference) => reference.referenceItemId);
          const snapshotIds = proposalInput.references.map((reference) => reference.snapshotId);
          const canonical = referenceIds.length === 0
            ? { rows: [], rowCount: 0 }
            : await client.query(
              `select requested.reference_item_id,requested.reference_snapshot_id,
                      snapshot.snapshot_json,pattern.id pattern_version_id
                 from unnest($3::uuid[],$4::uuid[]) with ordinality
                      as requested(reference_item_id,reference_snapshot_id,position)
                 join reference_items item
                   on item.id=requested.reference_item_id
                  and item.workspace_id=$1 and item.brand_id=$2
                  and item.archived_at is null
                 join reference_snapshots snapshot
                   on snapshot.id=requested.reference_snapshot_id
                  and snapshot.reference_item_id=requested.reference_item_id
                  and snapshot.workspace_id=$1 and snapshot.brand_id=$2
                 join lateral (
                   select version.id
                     from reference_pattern_versions version
                    where version.reference_item_id=snapshot.reference_item_id
                      and version.reference_snapshot_id=snapshot.id
                      and version.workspace_id=snapshot.workspace_id
                      and version.brand_id=snapshot.brand_id
                    order by version.version desc
                    limit 1
                 ) pattern on true
                where snapshot.snapshot_json #>> '{permittedUse,modelInput}'='true'
                  and snapshot.snapshot_json #>> '{permittedUse,derivativeInspiration}'='true'
                order by requested.position`,
              [input.workspaceId, input.brandId, referenceIds, snapshotIds],
            );
          if (canonical.rows.length !== proposalInput.references.length) {
            throw new Error("RESOURCE_NOT_AVAILABLE");
          }
          const byItemId = new Map(canonical.rows.map((row) => [String(row.reference_item_id), row]));
          for (const [index, reference] of proposalInput.references.entries()) {
            const row = byItemId.get(reference.referenceItemId) as Record<string, unknown> | undefined;
            if (!row || String(row.reference_snapshot_id) !== reference.snapshotId) {
              throw new Error("RESOURCE_NOT_AVAILABLE");
            }
            await client.query(
              `insert into ai_content_generation_references (
                 generation_id,reference_id,workspace_id,brand_id,position,reference_snapshot_json,
                 reference_item_id,reference_snapshot_id,pattern_version_id,roles_json
               ) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb)`,
              [
                generationId,
                reference.referenceItemId,
                input.workspaceId,
                input.brandId,
                index + 1,
                JSON.stringify(row.snapshot_json),
                reference.referenceItemId,
                reference.snapshotId,
                String(row.pattern_version_id),
                JSON.stringify(reference.roles),
              ],
            );
          }
        }
        await client.query(
          `update ai_content_proposals
              set generation_id=$2,updated_at=now()
            where id=$1 and workspace_id=$3 and brand_id=$4 and status='selected'`,
          [input.proposalId, generationId, input.workspaceId, input.brandId],
        );
        await client.query("COMMIT");
        return mapGeneration(created.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async dismissAiContentProposal(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assertActiveAiContentActor(client, input);
        const dismissed = await client.query(
          `update ai_content_proposals
              set status='dismissed',dismissed_by_user_id=$4,dismissed_at=now(),updated_at=now()
            where id=$1 and workspace_id=$2 and brand_id=$3 and status='suggested'
            returning *`,
          [input.proposalId, input.workspaceId, input.brandId, input.actorUserId],
        );
        if (!dismissed.rowCount) throw new Error("ai_content_proposal_not_dismissible");
        await client.query("COMMIT");
        return mapProposal(dismissed.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async listAiContentDraftReferences(input) {
      const result = await pool.query(
        `select reference.asset_type,reference.asset_id,reference.generation_id,reference.title
           from (
             select 'reference'::text asset_type,selected.reference_item_id::text asset_id,
                    generation.id::text generation_id,generation.title
               from ai_content_generations generation
               join ai_content_generation_references selected
                 on selected.generation_id=generation.id
                and selected.workspace_id=generation.workspace_id
                and selected.brand_id=generation.brand_id
               join reference_items item
                 on item.id=selected.reference_item_id
                and item.workspace_id=selected.workspace_id
                and item.brand_id=selected.brand_id
                and item.archived_at is null
              where selected.reference_item_id is not null
             union all
              select 'avatar',avatar.id::text,generation.id::text,generation.title
                from ai_content_generations generation
                join brand_avatars avatar
                  on avatar.id::text=generation.draft_json->'orchestration'->'avatar'->>'id'
                 and avatar.workspace_id=generation.workspace_id
                 and avatar.brand_id=generation.brand_id
                 and avatar.status='active'
               where exists (
                 select 1
                   from brand_avatar_images image
                  where image.avatar_id=avatar.id
                    and image.workspace_id=avatar.workspace_id
                    and image.brand_id=avatar.brand_id
               )
             union all
              select 'product_service',product.id::text,generation.id::text,generation.title
                from ai_content_generations generation
                join product_services product
                  on product.id::text=generation.draft_json->'orchestration'->'subject'->>'productServiceId'
                 and product.workspace_id=generation.workspace_id
                 and product.brand_id=generation.brand_id
                 and product.status='active'
                join product_service_versions version
                  on version.id=product.active_version_id
                 and version.workspace_id=product.workspace_id
                 and version.brand_id=product.brand_id
                 and version.product_service_id=product.id
                 and version.status='approved'
               where generation.draft_json->'orchestration'->'subject'->>'mode'='product_service'
             union all
              select 'wiki',version.id::text,generation.id::text,generation.title
                from ai_content_generations generation
                cross join lateral jsonb_array_elements_text(
                  coalesce(generation.draft_json->'orchestration'->'subject'->'wikiItemIds','[]'::jsonb)
                ) wiki(item)
                join wiki_versions version
                  on version.id::text=wiki.item
                 and version.workspace_id=generation.workspace_id
                 and version.brand_id=generation.brand_id
                 and version.status='active'
           ) reference
           join ai_content_generations generation on generation.id=reference.generation_id::uuid
          where generation.workspace_id=$1 and generation.brand_id=$2
             and generation.status in ('draft','analysis_ready')
             and generation.attachments_locked_at is null
             and generation.orchestration_snapshot is null
            and reference.asset_type=$3 and reference.asset_id=$4
          order by generation.updated_at desc`,
        [input.workspaceId, input.brandId, input.assetType, input.assetId],
      );
      return result.rows.map((row) => ({
        assetType: row.asset_type,
        assetId: String(row.asset_id),
        generationId: String(row.generation_id),
        title: String(row.title),
      }));
    },

    async updateAiContentDraft(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assertActiveAiContentActor(client, input);
        const generation = await scopedGeneration(client, input, true);
        if (!generation) throw new Error("ai_content_generation_not_found");
        if (object(generation.draft_json).origin === "proposal-v2") {
          throw new Error("ai_content_v3_contract_required");
        }
        const orchestration = input.orchestration
          ? parseContentOrchestrationV1(input.orchestration)
          : null;
        const subjectColumns = orchestration
          ? canonicalSubjectColumns(orchestration)
          : {
              subjectMode: generation.subject_mode ?? null,
              productServiceId: generation.product_service_id ?? null,
            };
        if (
          generation.attachments_locked_at
          && !isDeepStrictEqual(
            attachmentDraftPortion(generation.draft_json),
            attachmentDraftPortion(input.draft),
          )
        ) {
          throw new Error("ai_content_attachments_locked");
        }
        const updated = await client.query(
          `update ai_content_generations
              set draft_json = $4::jsonb,
                  subject_mode = $5,
                  product_service_id = $6,
                  updated_by_user_id = $7,
                  updated_at = now()
            where id = $1 and workspace_id = $2 and brand_id = $3
            returning id, workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json,
                      attachments_locked_at, terminal_at, retryable_until,
                      error_code, error_message, created_at, updated_at, completed_at`,
          [
            input.generationId,
            input.workspaceId,
            input.brandId,
            JSON.stringify({
              ...object(input.draft),
              ...(orchestration ? { orchestration } : {}),
              origin: "manual",
            }),
            subjectColumns.subjectMode,
            subjectColumns.productServiceId,
            input.actorUserId,
          ],
        );
        if (orchestration) {
          const canonicalIds = orchestration.references.map((reference) => reference.referenceItemId);
          if (!isDeepStrictEqual(canonicalIds, input.referenceIds)) {
            throw new Error("ai_content_reference_ids_mismatch");
          }
          await snapshotCanonicalReferences(client, input, orchestration.references);
        } else {
          await snapshotReferences(client, input, [...new Set(input.referenceIds)]);
        }
        await client.query("COMMIT");
        return mapGeneration(updated.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK"); throw error;
      } finally { client.release(); }
    },

    async updateAiContentFinalizationDraft(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assertActiveAiContentActor(client, input);
        const generation = await scopedGeneration(client, input, true);
        if (!generation) throw new Error("ai_content_generation_not_found");
        const currentDraft = object(generation.draft_json);
        if (generation.status !== "draft" || currentDraft.origin !== "proposal-v2") {
          throw new Error("ai_content_generation_not_draft");
        }
        if (generation.attachments_locked_at) throw new Error("ai_content_attachments_locked");
        const attachmentIds = input.draft.attachmentIds;
        if (attachmentIds.length > 0) {
          const attachments = await client.query(
            `select id
               from ai_content_generation_attachments
              where generation_id=$1 and workspace_id=$2 and brand_id=$3
                and id=any($4::uuid[]) and deleted_at is null
                and role in ('product_image','visual_reference','supporting_image')
                and lower(mime_type) in ('image/png','image/jpeg','image/webp')
              for share`,
            [input.generationId, input.workspaceId, input.brandId, attachmentIds],
          );
          const found = new Set(attachments.rows.map((row) => String(row.id)));
          if (found.size !== attachmentIds.length || attachmentIds.some((id) => !found.has(id))) {
            throw new Error("RESOURCE_NOT_AVAILABLE");
          }
        }
        const nextDraft = {
          ...currentDraft,
          finalization: input.draft,
        };
        const updated = await client.query(
          `update ai_content_generations
              set draft_json=$4::jsonb,updated_by_user_id=$5,updated_at=now()
            where id=$1 and workspace_id=$2 and brand_id=$3
            returning id,workspace_id,brand_id,type,title,status,current_stage,draft_json,analysis_json,
                      attachments_locked_at,terminal_at,retryable_until,error_code,error_message,
                      created_at,updated_at,completed_at`,
          [input.generationId, input.workspaceId, input.brandId, JSON.stringify(nextDraft), input.actorUserId],
        );
        await client.query("COMMIT");
        return mapGeneration(updated.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async startAiContentGenerationV3(input, snapshots, now = () => new Date()) {
      await assertActiveAiContentActor(pool, input);
      const initial = await scopedGeneration(pool, input);
      if (!initial) throw new Error("ai_content_generation_not_found");
      const initialDraft = object(initial.draft_json);
      if (initialDraft.origin !== "proposal-v2") {
        throw new Error("ai_content_generation_not_draft");
      }
      const initialProposalId = String(initialDraft.proposalId ?? "");
      if (!initialProposalId) throw new Error("RESOURCE_NOT_AVAILABLE");
      const ancestry = await pool.query(
        `select proposal.id proposal_id,proposal.batch_id
           from ai_content_proposals proposal
           join ai_content_proposal_batches batch
             on batch.id=proposal.batch_id
            and batch.workspace_id=proposal.workspace_id
            and batch.brand_id=proposal.brand_id
          where proposal.id=$1 and proposal.workspace_id=$2 and proposal.brand_id=$3`,
        [initialProposalId, input.workspaceId, input.brandId],
      );
      const ancestryRow = ancestry.rows[0] as Record<string, unknown> | undefined;
      if (!ancestryRow) throw new Error("RESOURCE_NOT_AVAILABLE");
      const batchId = String(ancestryRow.batch_id ?? "");
      if (!batchId) throw new Error("RESOURCE_NOT_AVAILABLE");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assertActiveAiContentActor(client, input);
        const lockedBatch = await client.query(
          `select batch.id,batch.status
             from ai_content_proposal_batches batch
            where batch.id=$1 and batch.workspace_id=$2 and batch.brand_id=$3
            for update`,
          [batchId, input.workspaceId, input.brandId],
        );
        const batch = lockedBatch.rows[0] as Record<string, unknown> | undefined;
        const lockedProposal = await client.query(
          `select proposal.id,proposal.batch_id,proposal.status,proposal.generation_id
             from ai_content_proposals proposal
            where proposal.id=$1 and proposal.workspace_id=$2 and proposal.brand_id=$3
              and proposal.batch_id=$4
            for update`,
          [initialProposalId, input.workspaceId, input.brandId, batchId],
        );
        const selectedProposal = lockedProposal.rows[0] as Record<string, unknown> | undefined;
        const generation = await scopedGeneration(client, input, true);
        if (!generation) throw new Error("ai_content_generation_not_found");
        const generationDraft = object(generation.draft_json);
        if (generationDraft.origin !== "proposal-v2") {
          throw new Error("ai_content_generation_not_draft");
        }
        const proposalId = String(generationDraft.proposalId ?? "");
        const approvedProposalVersionId = String(generationDraft.approvedProposalVersionId ?? "");
        if (!batch
          || batch.status !== "ready"
          || !selectedProposal
          || selectedProposal.status !== "selected"
          || String(selectedProposal.batch_id ?? "") !== batchId
          || String(selectedProposal.generation_id ?? "") !== input.generationId
          || proposalId !== initialProposalId) {
          throw new Error("RESOURCE_NOT_AVAILABLE");
        }
        const approvedLink = await client.query(
          `select approved.id
             from ai_content_approved_proposal_versions approved
            where approved.id=$1 and approved.workspace_id=$2 and approved.brand_id=$3
              and approved.proposal_id=$4
            for update`,
          [approvedProposalVersionId, input.workspaceId, input.brandId, proposalId],
        );
        if (!approvedLink.rowCount) throw new Error("RESOURCE_NOT_AVAILABLE");
        if (generation.generation_idempotency_key === input.idempotencyKey) {
          await client.query("COMMIT");
          return mapGeneration(generation);
        }
        if (generation.status !== "draft") {
          throw new Error("ai_content_generation_not_draft");
        }
        const finalization = parseContentFinalizationDraftV2(generationDraft.finalization);
        const frozen = await client.query(
          `select proposal.proposal_json,batch.input_snapshot_json,research.evidence_json,
                  approved.approved_proposal_snapshot
             from ai_content_proposals proposal
             join ai_content_proposal_batches batch
               on batch.id=proposal.batch_id
              and batch.workspace_id=proposal.workspace_id
              and batch.brand_id=proposal.brand_id
             join ai_content_proposal_research_snapshots research
               on research.batch_id=batch.id
              and research.workspace_id=batch.workspace_id
              and research.brand_id=batch.brand_id
             join ai_content_approved_proposal_versions approved
               on approved.id=$4
              and approved.proposal_id=proposal.id
              and approved.workspace_id=proposal.workspace_id
              and approved.brand_id=proposal.brand_id
            where proposal.id=$1 and proposal.workspace_id=$2 and proposal.brand_id=$3
              and proposal.status='selected' and proposal.generation_id=$5
              and batch.status='ready'
            for update of proposal,batch,approved`,
          [proposalId, input.workspaceId, input.brandId, approvedProposalVersionId, input.generationId],
        );
        const source = frozen.rows[0] as Record<string, unknown> | undefined;
        if (!source) throw new Error("RESOURCE_NOT_AVAILABLE");
        const approved = object(source.approved_proposal_snapshot);
        if (!isDeepStrictEqual(object(approved.effectiveProposal), object(source.proposal_json))) {
          throw new Error("ai_content_proposal_selection_conflict");
        }
        const baseSnapshot = object(source.input_snapshot_json);
        const proposalInput = parseProposalInputSnapshotV2({
          ...baseSnapshot,
          contractVersion: "proposal-input.v2",
          researchEvidence: source.evidence_json,
        });
        const scope = { workspaceId: input.workspaceId, brandId: input.brandId };
        await snapshots.revalidateFrozenResources({
          scope,
          coreVersionId: proposalInput.brandCore.versionId,
          product: proposalInput.product,
          references: proposalInput.references,
          database: client,
        });
        const brandStyleImages = await snapshots.loadApprovedStyleImages(scope, client);
        if (finalization.avatarStyleImageId !== null
          && !brandStyleImages.some(({ referenceItemId }) => referenceItemId === finalization.avatarStyleImageId)) {
          throw new Error("RESOURCE_NOT_AVAILABLE");
        }
        const attachmentRows = finalization.attachmentIds.length === 0
          ? { rows: [], rowCount: 0 }
          : await client.query(
            `select id,role,file_name,mime_type,size_bytes,checksum,storage_url,storage_path
               from ai_content_generation_attachments
              where generation_id=$1 and workspace_id=$2 and brand_id=$3
                and id=any($4::uuid[]) and deleted_at is null
                and role in ('product_image','visual_reference','supporting_image')
                and lower(mime_type) in ('image/png','image/jpeg','image/webp')
              for share`,
            [input.generationId, input.workspaceId, input.brandId, finalization.attachmentIds],
          );
        const attachmentById = new Map(attachmentRows.rows.map((row) => [String(row.id), row]));
        if (attachmentById.size !== finalization.attachmentIds.length
          || finalization.attachmentIds.some((id) => !attachmentById.has(id))) {
          throw new Error("RESOURCE_NOT_AVAILABLE");
        }
        const attachments = finalization.attachmentIds.map((id) => {
          const row = attachmentById.get(id)!;
          return {
            id,
            role: String(row.role),
            fileName: String(row.file_name),
            mimeType: String(row.mime_type).toLowerCase(),
            sizeBytes: Number(row.size_bytes),
            checksum: String(row.checksum),
            storageUrl: String(row.storage_url),
            storagePath: String(row.storage_path),
          };
        });
        const finalInput = parseContentGenerationInputV3({
          contractVersion: "content-generation-input.v3",
          generationId: input.generationId,
          brandCore: proposalInput.brandCore,
          subject: proposalInput.subject,
          contentInstruction: proposalInput.contentInstruction,
          product: proposalInput.product,
          researchEvidence: proposalInput.researchEvidence,
          references: {
            selected: proposalInput.references,
            brandStyleImages,
            avatarStyleImageId: finalization.avatarStyleImageId,
            attachments,
          },
          selectedProposal: { id: proposalId, ...object(source.proposal_json) },
          userImageInstruction: finalization.userImageInstruction,
          outputSettings: proposalInput.outputSettings,
          capturedAt: now().toISOString(),
        });
        const serialized = canonicalJson(finalInput);
        const contentHash = createHash("sha256").update(serialized).digest("hex");
        const existingSnapshot = await client.query(
          `select input_json,content_hash
             from ai_content_generation_input_snapshots
            where generation_id=$1 and workspace_id=$2 and brand_id=$3
            for update`,
          [input.generationId, input.workspaceId, input.brandId],
        );
        if (existingSnapshot.rowCount) {
          const existing = existingSnapshot.rows[0] as Record<string, unknown>;
          if (String(existing.content_hash) !== contentHash || canonicalJson(existing.input_json) !== serialized) {
            throw new Error("ai_content_generation_input_conflict");
          }
        } else {
          await client.query(
            `insert into ai_content_generation_input_snapshots (
               id,workspace_id,brand_id,generation_id,input_json,content_hash
             ) values ($1,$2,$3,$4,$5::jsonb,$6)`,
            [randomUUID(), input.workspaceId, input.brandId, input.generationId, serialized, contentHash],
          );
        }
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
          `ai-content-usage:${input.brandId}:${input.usageDate}`,
        ]);
        const usage = await client.query(
          `select coalesce(sum(quantity),0)::integer generation_count
             from ai_content_usage_ledger
            where workspace_id=$1 and brand_id=$2 and usage_date=$3::date
              and usage_type in ('generation','reversal')`,
          [input.workspaceId, input.brandId, input.usageDate],
        );
        if (Number(usage.rows[0]?.generation_count ?? 0) + 1 > input.dailyGenerationLimit) {
          throw new Error("ai_content_limit_reached");
        }
        const output = await client.query(
          `insert into ai_content_generation_outputs (
             generation_id,workspace_id,brand_id,output_index,status
           ) values ($1,$2,$3,1,'queued')
           on conflict (generation_id,output_index) do update set generation_id=excluded.generation_id
           returning id`,
          [input.generationId, input.workspaceId, input.brandId],
        );
        const outputId = String(output.rows[0]?.id ?? "");
        if (!outputId) throw new Error("ai_content_generation_output_conflict");
        if (finalInput.outputSettings.outputFormat !== "blog") {
          await client.query(
            `insert into ai_content_output_research_snapshots (
               id,workspace_id,brand_id,generation_id,output_id,evidence_json
             ) values ($1,$2,$3,$4,$5,$6::jsonb)
             on conflict (output_id) do nothing`,
            [randomUUID(), input.workspaceId, input.brandId, input.generationId, outputId,
              JSON.stringify(proposalInput.researchEvidence)],
          );
        }
        await client.query(
          `insert into ai_content_generation_jobs (
             generation_id,output_id,workspace_id,brand_id,job_type,content_type,status,payload_json
           ) values ($1,$2,$3,$4,'generate',$5,'queued',$6::jsonb)
           on conflict do nothing`,
          [input.generationId, outputId, input.workspaceId, input.brandId, generation.type,
            JSON.stringify({
              generationId: input.generationId,
              outputId,
              contentGenerationInput: finalInput,
              planningMode: "selected_proposal",
              usageDate: input.usageDate,
              usageIdempotencyKey: `generation:${input.generationId}:${input.idempotencyKey}`,
            })],
        );
        const updated = await client.query(
          `update ai_content_generations
              set status='queued',current_stage='generation',generation_idempotency_key=$4,
                  attachments_locked_at=statement_timestamp(),updated_by_user_id=$5,updated_at=now()
            where id=$1 and workspace_id=$2 and brand_id=$3
            returning id,workspace_id,brand_id,type,title,status,current_stage,draft_json,analysis_json,
                      attachments_locked_at,terminal_at,retryable_until,error_code,error_message,
                      created_at,updated_at,completed_at`,
          [input.generationId, input.workspaceId, input.brandId, input.idempotencyKey, input.actorUserId],
        );
        await client.query("COMMIT");
        return mapGeneration(updated.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async startAiContentGeneration(input) {
      await assertActiveAiContentActor(pool, input);
      const initial = await scopedGeneration(pool, input);
      if (!initial) throw new Error("ai_content_generation_not_found");
      if (object(initial.draft_json).origin === "proposal-v2") {
        throw new Error("ai_content_v3_contract_required");
      }
      const isInitialReplay = initial.generation_idempotency_key === input.idempotencyKey;
      if (isInitialReplay) {
        return mapGeneration(initial);
      }
      const initialDraft = object(initial.draft_json);
      const canonical = initialDraft.orchestration !== undefined;
      if (initial.status !== "analysis_ready"
        && !(canonical && initial.status === "draft")) {
        throw new Error("ai_content_generation_not_analysis_ready");
      }
      const initiallyUsesOwnedContext = initialDraft.analysisSource === "owned";
      const confirmedBrandIntelligence = initiallyUsesOwnedContext && options.brandIntelligenceProvider
        ? await options.brandIntelligenceProvider.getConfirmed(input)
        : undefined;
      const transactionBrandIntelligenceProvider = initiallyUsesOwnedContext && options.brandIntelligenceProvider
        ? {
            getConfirmed: async () => confirmedBrandIntelligence ?? null,
          }
        : undefined;
      const client = await pool.connect();
      let transactionOpen = false;
      try {
        await client.query("BEGIN");
        transactionOpen = true;
        await assertActiveAiContentActor(client, input);
        const current = await scopedGeneration(client, input, true);
        if (!current) throw new Error("ai_content_generation_not_found");
        if (object(current.draft_json).origin === "proposal-v2") {
          throw new Error("ai_content_v3_contract_required");
        }
        if (current.generation_idempotency_key === input.idempotencyKey) {
          await client.query("COMMIT");
          return mapGeneration(current);
        }
        if (current.status !== "analysis_ready" && !(canonical && current.status === "draft")) {
          throw new Error("ai_content_generation_not_analysis_ready");
        }
        if (JSON.stringify(object(current.draft_json)) !== JSON.stringify(initialDraft)) {
          throw new Error("ai_content_generation_start_conflict");
        }
        if (canonical) {
          const orchestration = parseContentOrchestrationV1(initialDraft.orchestration);
          const subjectColumns = canonicalSubjectColumns(orchestration);
          if (current.subject_mode !== subjectColumns.subjectMode
            || (current.product_service_id ? String(current.product_service_id) : null)
              !== subjectColumns.productServiceId) {
            throw new Error("ai_content_subject_mapping_mismatch");
          }
          if (mapOrchestrationToWorkerType(orchestration) !== current.type) {
            throw new Error("ai_content_type_mapping_mismatch");
          }
          await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
            `ai-content-usage:${input.brandId}:${input.usageDate}`,
          ]);
          const usage = await client.query(
            `select coalesce(sum(quantity),0)::integer generation_count
               from ai_content_usage_ledger
              where workspace_id=$1 and brand_id=$2 and usage_date=$3::date
                and usage_type in ('generation','reversal')`,
            [input.workspaceId, input.brandId, input.usageDate],
          );
          if (Number(usage.rows[0]?.generation_count ?? 0) + input.outputCount > input.dailyGenerationLimit) {
            throw new Error("ai_content_limit_reached");
          }
          const proposalId = String(initialDraft.proposalId ?? "");
          const approvedProposalVersionId = String(initialDraft.approvedProposalVersionId ?? "");
          const versions = await client.query(
            `select profile.active_brand_core_id brand_core_version_id,
                    profile.active_brand_rule_set_id rule_set_version_id,
                    approved.approved_proposal_snapshot
               from brand_profiles profile
               join brand_core_versions core
                 on core.id=profile.active_brand_core_id
                and core.workspace_id=profile.workspace_id and core.brand_id=profile.brand_id
                and core.status='approved'
               join brand_rule_sets rules
                 on rules.id=profile.active_brand_rule_set_id
                and rules.workspace_id=profile.workspace_id and rules.brand_id=profile.brand_id
                and rules.status='approved'
               join ai_content_approved_proposal_versions approved
                 on approved.id=$4 and approved.workspace_id=profile.workspace_id
                and approved.brand_id=profile.brand_id and approved.proposal_id=$3
               join ai_content_proposals proposal
                 on proposal.id=approved.proposal_id
                and proposal.workspace_id=approved.workspace_id and proposal.brand_id=approved.brand_id
                and proposal.status='selected' and proposal.generation_id=$5
               join ai_content_proposal_batches batch
                 on batch.id=proposal.batch_id and batch.workspace_id=proposal.workspace_id
                and batch.brand_id=proposal.brand_id and batch.status='ready'
                and batch.content_family=$6
              where profile.workspace_id=$1 and profile.brand_id=$2`,
            [
              input.workspaceId,
              input.brandId,
              proposalId,
              approvedProposalVersionId,
              input.generationId,
              orchestration.contentFamily,
            ],
          );
          const version = versions.rows[0] as Record<string, unknown> | undefined;
          if (!version) throw new Error("ai_content_orchestration_versions_invalid");

          let subject: Record<string, unknown>;
          if (orchestration.subject.mode === "product_service") {
            const product = await client.query(
              `select product.id item_id,product.display_name title,version.id,version.version,
                      version.profile_json::text body,
                      encode(digest(version.profile_json::text,'sha256'),'hex') content_hash,
                      version.approved_at captured_at
                 from product_services product
                 join product_service_versions version
                   on version.id=product.active_version_id
                  and version.workspace_id=product.workspace_id and version.brand_id=product.brand_id
                  and version.product_service_id=product.id and version.status='approved'
                where product.id=$1 and product.workspace_id=$2 and product.brand_id=$3
                  and product.status='active'`,
              [orchestration.subject.productServiceId, input.workspaceId, input.brandId],
            );
            const item = product.rows[0] as Record<string, unknown> | undefined;
            if (!item) throw new Error("ai_content_product_service_not_found");
            subject = {
              kind: "approved_product_service",
              itemId: String(item.item_id),
              version: {
                kind: "product_service",
                id: String(item.id),
                version: Number(item.version),
                title: String(item.title),
                body: String(item.body),
                contentHash: String(item.content_hash),
                capturedAt: iso(item.captured_at),
                stale: false,
                trustLevel: "approved",
                purpose: orchestration.contentFamily,
              },
            };
          } else if (orchestration.subject.mode === "brand_topic") {
            subject = {
              kind: "brand_topic",
              topic: orchestration.subject.topic,
              brandCoreEvidenceIds: [],
            };
          } else {
            const analyzed = await client.query(
              `select analysis.id,analysis.analysis_version,analysis.contract_version,
                      analysis.subject_type,analysis.source_url,analysis.normalized_url,
                      analysis.input_json,analysis.facts_json,analysis.research_json,
                      analysis.analysis_result_json,
                      coalesce(analysis.completed_at,analysis.updated_at) captured_at,
                      coalesce(jsonb_agg(jsonb_build_object(
                        'id',image.id::text,'sourceUrl',image.source_url,
                        'storageUrl',image.storage_url,'width',image.width,'height',image.height,
                        'mimeType',image.mime_type,'altText',image.alt_text,'role',image.role
                      ) order by image.id) filter (where image.id is not null),'[]'::jsonb)
                        selected_images
                 from ai_content_subject_analyses analysis
                 left join ai_content_subject_images image
                   on image.analysis_id=analysis.id
                  and image.workspace_id=analysis.workspace_id
                  and image.brand_id=analysis.brand_id
                  and image.deleted_at is null
                  and (
                    image.id=analysis.selected_image_id
                    or image.id::text=any(
                      select jsonb_array_elements_text(analysis.attachment_ids_json)
                    )
                  )
                where analysis.id=$1 and analysis.workspace_id=$2 and analysis.brand_id=$3
                  and analysis.status in ('ready','partial')
                  and analysis.superseded_at is null
                group by analysis.id
                for share of analysis`,
              [orchestration.subject.subjectAnalysisId, input.workspaceId, input.brandId],
            );
            const analysis = analyzed.rows[0] as Record<string, unknown> | undefined;
            if (!analysis) throw new Error("ai_content_subject_analysis_not_ready");
            const snapshotId = randomUUID();
            const analyzedSnapshot = {
              contractVersion: "analyzed-subject-snapshot.v1",
              snapshotId,
              analysisId: String(analysis.id),
              analysisVersion: Number(analysis.analysis_version),
              analysisContractVersion: String(analysis.contract_version),
              subjectType: String(analysis.subject_type),
              source: {
                sourceUrl: analysis.source_url ? String(analysis.source_url) : "",
                normalizedUrl: analysis.normalized_url ? String(analysis.normalized_url) : "",
                input: object(analysis.input_json),
              },
              facts: Array.isArray(analysis.facts_json) ? analysis.facts_json : [],
              research: object(analysis.research_json),
              analysisResult: object(analysis.analysis_result_json),
              selectedImages: Array.isArray(analysis.selected_images) ? analysis.selected_images : [],
              capturedAt: iso(analysis.captured_at),
            };
            const sealed = await client.query(
              `insert into ai_content_analyzed_subject_snapshots (
                 id,workspace_id,brand_id,analysis_id,snapshot_json
               ) values ($1,$2,$3,$4,$5::jsonb)
               on conflict (analysis_id) do nothing
               returning id,snapshot_json`,
              [
                snapshotId,
                input.workspaceId,
                input.brandId,
                analysis.id,
                JSON.stringify(analyzedSnapshot),
              ],
            );
            let sealedId: string = snapshotId;
            let sealedSnapshot = analyzedSnapshot;
            if (!sealed.rowCount) {
              const existing = await client.query(
                `select id,snapshot_json
                   from ai_content_analyzed_subject_snapshots
                  where analysis_id=$1 and workspace_id=$2 and brand_id=$3`,
                [analysis.id, input.workspaceId, input.brandId],
              );
              if (!existing.rowCount) throw new Error("ai_content_subject_snapshot_conflict");
              sealedId = String(existing.rows[0]?.id);
              sealedSnapshot = existing.rows[0]?.snapshot_json;
            }
            subject = {
              kind: "analyzed_subject",
              analysisId: String(analysis.id),
              snapshotId: sealedId,
              snapshot: sealedSnapshot,
            };
          }

          const references = await client.query(
            `select reference_item_id item_id,reference_snapshot_id snapshot_id,
                    pattern_version_id,roles_json
               from ai_content_generation_references
              where generation_id=$1 and workspace_id=$2 and brand_id=$3
                and reference_item_id is not null
              order by position`,
            [input.generationId, input.workspaceId, input.brandId],
          );
          let avatar: Record<string, unknown> | null = null;
          if (orchestration.avatar) {
            if (orchestration.avatar.mode === "one_time") {
              const selectedReceipt = await client.query(
                `select receipt.id,receipt.upload_session_id,receipt.object_hash,receipt.mime_type
                   from ai_content_one_time_avatar_receipts receipt
                  where receipt.id=$1 and receipt.generation_id=$2
                    and receipt.workspace_id=$3 and receipt.brand_id=$4
                    and receipt.created_by_user_id=$5 and receipt.confirmed_at is not null`,
                [
                  orchestration.avatar.id,
                  input.generationId,
                  input.workspaceId,
                  input.brandId,
                  input.actorUserId,
                ],
              );
              const selected = selectedReceipt.rows[0] as Record<string, unknown> | undefined;
              if (!selected) throw new Error("ai_content_one_time_avatar_receipt_not_found");
              avatar = {
                id: String(selected.upload_session_id),
                assetVersionId: String(selected.id),
                objectHash: String(selected.object_hash),
                mime: String(selected.mime_type),
                provenance: "one_time",
              };
            } else {
            const selectedAvatar = await client.query(
              `select avatar.id,image.id asset_version_id,image.checksum object_hash,image.mime_type
                 from brand_avatars avatar
                 join brand_avatar_images image
                   on image.avatar_id=avatar.id and image.workspace_id=avatar.workspace_id
                  and image.brand_id=avatar.brand_id
                where avatar.id=$1 and avatar.workspace_id=$2 and avatar.brand_id=$3
                  and avatar.status='active'
                order by image.created_at desc limit 1`,
              [orchestration.avatar.id, input.workspaceId, input.brandId],
            );
            const selected = selectedAvatar.rows[0] as Record<string, unknown> | undefined;
            if (!selected) throw new Error("ai_content_avatar_not_found");
            avatar = {
              id: String(selected.id),
              assetVersionId: String(selected.asset_version_id),
              objectHash: String(selected.object_hash),
              mime: String(selected.mime_type),
              provenance: "library",
            };
            }
          }
          const frozen = {
            contractVersion: "generation-brief.v1",
            proposalId,
            approvedProposalVersionId,
            approvedProposalSnapshot: version.approved_proposal_snapshot,
            brandCoreVersionId: String(version.brand_core_version_id),
            ruleSetVersionId: String(version.rule_set_version_id),
            subject,
            references: references.rows.map((row) => ({
              itemId: String(row.item_id),
              snapshotId: String(row.snapshot_id),
              patternVersionId: String(row.pattern_version_id),
              roles: row.roles_json,
            })),
            avatar,
            outputFormat: orchestration.outputFormat,
            channels: orchestration.channelTargets,
            promptDefinitionVersions: { generation: "content-generation.v2" },
          };
          await client.query(
            "select start_ai_content_orchestration($1,$2,$3,$4::jsonb,$5::jsonb,$6) id",
            [
              input.generationId,
              input.workspaceId,
              input.brandId,
              JSON.stringify(frozen),
              JSON.stringify(avatar),
              input.actorUserId,
            ],
          );
          const outputIds: string[] = [];
          for (let index = 1; index <= input.outputCount; index += 1) {
            const output = await client.query(
              `insert into ai_content_generation_outputs (
                 generation_id,workspace_id,brand_id,output_index,status
               ) values ($1,$2,$3,$4,'queued') returning id`,
              [input.generationId, input.workspaceId, input.brandId, index],
            );
            outputIds.push(String(output.rows[0]?.id));
          }
          await client.query(
            `insert into ai_content_generation_jobs (
               generation_id,workspace_id,brand_id,job_type,content_type,status,payload_json
             ) values ($1,$2,$3,'analyze',$4,'queued',$5::jsonb)`,
            [
              input.generationId,
              input.workspaceId,
              input.brandId,
              current.type,
              JSON.stringify({
                generationId: input.generationId,
                finalizeGeneration: true,
                orchestrationSnapshot: frozen,
                outputIds,
              }),
            ],
          );
          await client.query(
            `insert into ai_content_usage_ledger (
               workspace_id,brand_id,generation_id,usage_type,quantity,usage_date,idempotency_key
             ) values ($1,$2,$3,'generation',$4,$5::date,$6)`,
            [
              input.workspaceId,
              input.brandId,
              input.generationId,
              input.outputCount,
              input.usageDate,
              `generation:${input.generationId}:${input.idempotencyKey}`,
            ],
          );
          const updated = await client.query(
            `update ai_content_generations
                set status='queued',current_stage='generation',generation_idempotency_key=$4,
                    attachments_locked_at=statement_timestamp(),
                    updated_by_user_id=$5,updated_at=now()
              where id=$1 and workspace_id=$2 and brand_id=$3
              returning id,workspace_id,brand_id,type,title,status,current_stage,draft_json,analysis_json,
                        attachments_locked_at,terminal_at,retryable_until,error_code,error_message,
                        created_at,updated_at,completed_at`,
            [input.generationId, input.workspaceId, input.brandId, input.idempotencyKey, input.actorUserId],
          );
          await client.query("COMMIT");
          return mapGeneration(updated.rows[0]);
        }
        const pendingUpload = await client.query(
          `select id
             from ai_content_attachment_upload_sessions
            where generation_id = $1 and workspace_id = $2 and brand_id = $3
              and status = 'pending' and token_expires_at > statement_timestamp()
            limit 1`,
          [input.generationId, input.workspaceId, input.brandId],
        );
        if (pendingUpload.rowCount) throw new Error("ai_content_attachment_upload_in_progress");
        const draft = object(current.draft_json);
        const subjectFlow = draft.subjectAnalysisId !== undefined
          || draft.subjectType === "product"
          || draft.subjectType === "service"
          || draft.selectedTarget !== undefined
          || draft.selectedAppeal !== undefined;
        const usesOwnedContext = draft.analysisSource === "owned";
        const brandContext = usesOwnedContext
          ? await loadAiContentBrandContext(client, input, transactionBrandIntelligenceProvider)
          : null;
        if (usesOwnedContext && options.brandIntelligenceProvider && !brandContext?.brandIntelligenceVersionId) {
          throw new Error("brand_intelligence_required");
        }
        if (usesOwnedContext && !options.brandIntelligenceProvider && !brandContext?.ownedUrl) {
          throw new Error("ai_content_owned_source_required");
        }
        const waitForOwnedContext = false;
        const generationInput = subjectFlow
          ? await buildContentGenerationInput(
            {
              getBrandContext: (scope) => loadAiContentBrandContext(client, scope, transactionBrandIntelligenceProvider),
              getSubjectAnalysis: (scope) => subjectRepository.getSubjectAnalysis(scope),
              getReferences: (scope) => loadGenerationReferences(client, scope),
              getAttachments: (scope) => loadGenerationAttachments(client, scope),
            },
            {
              ...mapGeneration(current),
              subjectAnalysisSnapshot: current.subject_analysis_snapshot,
            },
            {
              outputCount: input.outputCount,
              ...(current.generation_input_snapshot
                ? { existingSnapshot: current.generation_input_snapshot }
                : {}),
            },
          )
          : null;
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `ai-content-usage:${input.brandId}:${input.usageDate}`,
        ]);
        const updated = await client.query(
          `update ai_content_generations
              set status = 'analyzing', current_stage = $5, generation_idempotency_key = $4,
                  generation_input_snapshot = $6::jsonb,
                  subject_analysis_snapshot = coalesce(subject_analysis_snapshot, $6::jsonb),
                  attachments_locked_at = statement_timestamp(),
                  updated_by_user_id = coalesce($7, updated_by_user_id), updated_at = now()
            where id = $1 and workspace_id = $2 and brand_id = $3 and status = 'analysis_ready'
            returning id, workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json,
                      attachments_locked_at, terminal_at, retryable_until,
                      error_code, error_message, created_at, updated_at, completed_at`,
          [input.generationId, input.workspaceId, input.brandId, input.idempotencyKey, waitForOwnedContext ? "owned_context" : "analysis", generationInput ? JSON.stringify(generationInput) : null, input.actorUserId],
        );
        const generation = updated.rows[0] as Record<string, unknown> | undefined;
        if (!generation) throw new Error("ai_content_generation_start_conflict");
        const usage = await client.query(
          `select coalesce(sum(quantity), 0)::integer as generation_count
             from ai_content_usage_ledger
            where workspace_id = $1 and brand_id = $2 and usage_date = $3::date and usage_type in ('generation', 'reversal')`,
          [input.workspaceId, input.brandId, input.usageDate],
        );
        if (Number(usage.rows[0]?.generation_count ?? 0) + input.outputCount > input.dailyGenerationLimit) {
          throw new Error("ai_content_limit_reached");
        }
        for (let index = 1; index <= input.outputCount; index += 1) {
          await client.query(
            `insert into ai_content_generation_outputs
               (generation_id, workspace_id, brand_id, output_index, status)
             values ($1, $2, $3, $4, 'queued')
             returning id`,
            [input.generationId, input.workspaceId, input.brandId, index],
          );
        }
        await client.query(
          `insert into ai_content_generation_jobs
             (generation_id, workspace_id, brand_id, job_type, content_type, status, payload_json)
           values ($1, $2, $3, 'analyze', $4, 'queued', jsonb_build_object(
             'generationId', $1::uuid,
             'finalizeGeneration', true,
             'waitForOwnedContext', $5::boolean,
             'contentGenerationInput', $6::jsonb
           ))
           on conflict do nothing`,
          [input.generationId, input.workspaceId, input.brandId, generation.type, waitForOwnedContext,
            generationInput ? JSON.stringify(generationInput) : null],
        );
        await client.query(
          `insert into ai_content_usage_ledger
             (workspace_id, brand_id, generation_id, usage_type, quantity, usage_date, idempotency_key)
           values ($1, $2, $3, 'generation', $4, $5::date, $6)
           on conflict (brand_id, idempotency_key) do nothing`,
          [input.workspaceId, input.brandId, input.generationId, input.outputCount, input.usageDate, `generation:${input.generationId}:${input.idempotencyKey}`],
        );
        await client.query("COMMIT");
        return mapGeneration(generation);
      } catch (error) {
        if (transactionOpen) await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async listAiContentGenerations(input) {
      const result = await pool.query(
        `select id, workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json,
                attachments_locked_at, terminal_at, retryable_until,
                error_code, error_message, created_at, updated_at, completed_at
           from ai_content_generations
          where workspace_id = $1 and brand_id = $2
            and coalesce(draft_json->>'origin', '') <> 'scheduled_automation'
          order by created_at desc`,
        [input.workspaceId, input.brandId],
      );
      const generations = result.rows.map(mapGeneration);
      const outputs = await outputsForGenerations(pool, generations.map((item) => item.id));
      return generations.map((item) => ({ ...item, outputs: outputs.get(item.id) ?? [] }));
    },

    async getAiContentGeneration(input) {
      const row = await scopedGeneration(pool, input);
      if (!row) return null;
      const generation = mapGeneration(row);
      const outputs = await outputsForGenerations(pool, [generation.id]);
      const evidenceSnapshot = await generationEvidenceSnapshot(pool, input, row);
      return {
        ...generation,
        ...(evidenceSnapshot ? { evidenceSnapshot } : {}),
        outputs: outputs.get(generation.id) ?? [],
      };
    },

    async listAiContentUsage(input) {
      const result = await pool.query(
        `select coalesce(sum(quantity) filter (where usage_type = 'generation'), 0)::integer as generation_count,
                coalesce(sum(quantity) filter (where usage_type = 'new_download'), 0)::integer as download_count
           from ai_content_usage_ledger where workspace_id = $1 and brand_id = $2 and usage_date = $3::date`,
        [input.workspaceId, input.brandId, input.usageDate],
      );
      const row = result.rows[0] ?? {};
      return { usageDate: input.usageDate, generationCount: Number(row.generation_count ?? 0), downloadCount: Number(row.download_count ?? 0) };
    },

    async listAiContentReferences(input) {
      const cardNews = input.type === undefined || input.type === "card_news";
      const marketing = input.type === "marketing";
      const blog = input.type === "blog";
      const queries: string[] = [];
      const recommendationFilter = (
        alias: string,
        supportedFormats: string[],
      ) => `
           and ${alias}.workspace_id = $1 and ${alias}.brand_id = $2
           and ${alias}.archived_at is null
           and coalesce((
             select canonical_snapshot.snapshot_json->>'sourceAvailability'
               from reference_snapshots canonical_snapshot
              where canonical_snapshot.reference_item_id=${alias}.id
                and canonical_snapshot.workspace_id=${alias}.workspace_id
                and canonical_snapshot.brand_id=${alias}.brand_id
              order by canonical_snapshot.version desc
              limit 1
           ), 'available') = 'available'
           and (
             cardinality($3::text[]) = 0
             or coalesce(${alias}.metadata->'strategies', '[]'::jsonb) ?| $3::text[]
           )
           and (
             cardinality($4::text[]) = 0
             or $4::text[] && array[${supportedFormats.map((format) => `'${format}'`).join(",")}]::text[]
           )
           and (
             cardinality($5::text[]) = 0
             or coalesce(${alias}.metadata->'tags', '[]'::jsonb) ?| $5::text[]
             or exists (
               select 1 from unnest($5::text[]) recommended_tag
                where concat_ws(' ', ${alias}.title, ${alias}.origin, ${alias}.metadata::text)
                      ilike '%' || recommended_tag || '%'
             )
           )`;
      if (cardNews || marketing) queries.push(`
        select reference_filter.id, 'brand_output' as source, co.title, null::text as url, null::text as preview_url,
               jsonb_build_object('exposureCount', performance.exposure_count) as metrics, performance.collected_at as checked_at
          from channel_outputs co
          join reference_items reference_filter
            on reference_filter.channel_output_id=co.id
           and reference_filter.workspace_id=co.workspace_id
           and reference_filter.brand_id=co.brand_id
          left join lateral (select exposure_count, collected_at from content_performance_snapshots cps
            where cps.channel_output_id = co.id order by cps.snapshot_date desc limit 1) performance on true
         where co.workspace_id = $1 and co.brand_id = $2 and co.status in ('approved', 'auto_approved')
           ${cardNews ? "and co.delivery_format = 'instagram_feed_carousel'" : "and performance.exposure_count is not null"}
           ${recommendationFilter("reference_filter", cardNews ? ["card_news"] : ["single_image", "marketing"])}`);
      if (cardNews) queries.push(`
        select reference_filter.id, 'saved_trend' as source, coalesce(media.caption, media.username, 'Instagram reference') as title,
               media.permalink as url, media.media_url as preview_url,
               jsonb_build_object('likeCount', media.like_count, 'commentsCount', media.comments_count) as metrics,
               media.last_fetched_at as checked_at
          from brand_trend_saved_media saved join instagram_trend_media media on media.id = saved.trend_media_id
          join reference_items reference_filter
            on reference_filter.saved_trend_id=saved.id
           and reference_filter.workspace_id=saved.workspace_id
           and reference_filter.brand_id=saved.brand_id
         where saved.workspace_id = $1 and saved.brand_id = $2
           ${recommendationFilter("reference_filter", ["card_news", "single_image"])}`);
      if (blog || marketing) queries.push(`
        select item.id, 'saved_url' as source, coalesce(snapshot.extracted_title, source.title, source.url) as title,
               source.url, null::text as preview_url, '{}'::jsonb as metrics, snapshot.fetched_at as checked_at
          from reference_items item
          join source_urls source
            on source.id = item.source_url_id
           and source.workspace_id = item.workspace_id
           and source.brand_id = item.brand_id
          join lateral (select * from source_snapshots ss where ss.source_url_id = source.id
            and ss.status = 'succeeded' order by ss.fetched_at desc limit 1) snapshot on true
         where item.workspace_id = $1 and item.brand_id = $2
           and item.archived_at is null
           and item.content_purpose in ('${marketing ? "marketing" : "informational"}', 'both')
           and source.source_type = 'reference' and source.deleted_at is null
           ${recommendationFilter("item", marketing ? ["single_image", "marketing"] : ["blog"])}`);
      if (!queries.length) return [];
      const result = await pool.query(
        `select * from (${queries.join(" union all ")}) reference_rows
          order by case when greatest(
            coalesce((metrics->>'exposureCount')::bigint, 0),
            coalesce((metrics->>'likeCount')::bigint, 0),
            coalesce((metrics->>'commentsCount')::bigint, 0)
          ) > 0 then 0 else 1 end, checked_at desc nulls last`,
        [
          input.workspaceId,
          input.brandId,
          input.strategies ?? [],
          input.formats ?? [],
          input.tags ?? [],
        ],
      );
      return result.rows.map((row) => ({ id: String(row.id), source: row.source, title: String(row.title), url: row.url ?? null, previewUrl: row.preview_url ?? null, metrics: object(row.metrics), checkedAt: iso(row.checked_at) }));
    },

    async listAiContentReferenceSeeds(input) {
      const primaryCategory = normalizedReferenceSeedCategory(input.primaryCategory);
      if (!primaryCategory) return [];
      if (!aiContentReferenceSeedFormats.has(input.format)) {
        throw new Error("ai_content_reference_seed_format_invalid");
      }
      const limit = Math.min(50, Math.max(1, Math.trunc(input.limit) || 1));
      const result = await pool.query(
        `with reference_seed_candidates as (
           select item.id,item.workspace_id,item.brand_id,item.archived_at,
                  latest_snapshot.snapshot_json->>'sourceAvailability' as source_availability,
                  case
                    when item.channel_output_id is not null then 'brand_output'
                    when item.saved_trend_id is not null then 'saved_trend'
                    else 'saved_url'
                  end as source,
                  item.title,coalesce(item.source_url,media.permalink) as url,item.preview_url,
                  case
                    when lower(regexp_replace(trim(item.metadata->>'primaryCategory'),'\\s+',' ','g'))=$3
                      then nullif(item.metadata->>'primaryCategory','')
                    when lower(regexp_replace(trim(latest_pattern.pattern_json->>'primaryCategory'),'\\s+',' ','g'))=$3
                      then nullif(latest_pattern.pattern_json->>'primaryCategory','')
                    else null
                  end as primary_category,
                  case
                    when lower(coalesce(
                      nullif(item.metadata->>'outputFormat',''),
                      nullif(latest_pattern.pattern_json->>'outputFormat',''),
                      nullif(performance.content_features->>'format',''),
                      nullif(item.format,'')
                    )) = $4 then $4
                    when $4='card_news' and channel_output.delivery_format='instagram_feed_carousel' then 'card_news'
                    when $4='card_news' and lower(media.media_type)='carousel_album' then 'card_news'
                    when $4='reel' and lower(media.raw_metadata->>'_trendKind')='reel' then 'reel'
                    else null
                  end as format,
                  performance.exposure_count,
                  media.like_count,media.comments_count,
                  coalesce(performance.collected_at,media.last_fetched_at,latest_snapshot.captured_at,item.created_at) as checked_at
             from reference_items item
             join lateral (
               select snapshot.id,snapshot.captured_at,snapshot.snapshot_json
                 from reference_snapshots snapshot
                where snapshot.reference_item_id=item.id
                  and snapshot.workspace_id=item.workspace_id
                  and snapshot.brand_id=item.brand_id
                order by snapshot.version desc
                limit 1
             ) latest_snapshot on true
             left join lateral (
               select pattern.pattern_json
                 from reference_pattern_versions pattern
                where pattern.reference_item_id=item.id
                  and pattern.reference_snapshot_id=latest_snapshot.id
                  and pattern.workspace_id=item.workspace_id
                  and pattern.brand_id=item.brand_id
                order by pattern.version desc
                limit 1
             ) latest_pattern on true
             left join channel_outputs channel_output
               on channel_output.id=item.channel_output_id
              and channel_output.workspace_id=item.workspace_id
              and channel_output.brand_id=item.brand_id
             -- exposure_count is the persisted provider-normalized exposure value (currently Meta views).
             left join lateral (
               select snapshot.exposure_count,snapshot.content_features,snapshot.collected_at
                 from content_performance_snapshots snapshot
                where snapshot.channel_output_id=channel_output.id
                  and snapshot.workspace_id=item.workspace_id
                  and snapshot.brand_id=item.brand_id
                order by snapshot.snapshot_date desc,snapshot.collected_at desc
                limit 1
             ) performance on true
             left join brand_trend_saved_media saved
               on saved.id=item.saved_trend_id
              and saved.workspace_id=item.workspace_id
              and saved.brand_id=item.brand_id
             left join instagram_trend_media media on media.id=saved.trend_media_id
            where item.workspace_id = $1
              and item.brand_id = $2
              and item.archived_at is null
         ), eligible_reference_seeds as (
           select * from reference_seed_candidates
            where source_availability='available'
              and primary_category is not null
              and lower(regexp_replace(trim(primary_category),'\\s+',' ','g'))=$3
              and format=$4
              and (exposure_count is not null or like_count is not null or comments_count is not null)
         )
         select * from eligible_reference_seeds
          order by exposure_count desc nulls last,
                   like_count desc nulls last,
                   comments_count desc nulls last,
                   checked_at desc nulls last,
                   id asc
          limit $5`,
        [input.workspaceId, input.brandId, primaryCategory, input.format, limit],
      );
      return result.rows
        .map((row) => mapAiContentReferenceSeed(row as Record<string, unknown>, {
          workspaceId: input.workspaceId,
          brandId: input.brandId,
          primaryCategory,
          format: input.format,
        }))
        .filter((row): row is AiContentReferenceSeedRecord => row !== null)
        .sort(compareAiContentReferenceSeeds)
        .slice(0, limit);
    },

    async listBrandAudiences(input) {
      const result = await pool.query("select id, name, situation, problem, motivation, use_count, last_used_at from brand_audiences where workspace_id = $1 and brand_id = $2 order by last_used_at desc nulls last, created_at desc", [input.workspaceId, input.brandId]);
      return result.rows.map(mapAudience);
    },
    async saveBrandAudience(input) {
      const result = await pool.query(
        `insert into brand_audiences (workspace_id, brand_id, name, situation, problem, motivation)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (brand_id, name) do update set situation = excluded.situation, problem = excluded.problem, motivation = excluded.motivation, updated_at = now()
         returning id, name, situation, problem, motivation, use_count, last_used_at`,
        [input.workspaceId, input.brandId, input.name, input.situation, input.problem, input.motivation],
      );
      return mapAudience(result.rows[0]);
    },
    async listBrandAppeals(input) {
      const result = await pool.query("select id, title, description, evidence_type, use_count, last_used_at from brand_appeals where workspace_id = $1 and brand_id = $2 order by last_used_at desc nulls last, created_at desc", [input.workspaceId, input.brandId]);
      return result.rows.map(mapAppeal);
    },
    async saveBrandAppeal(input) {
      const result = await pool.query(
        `insert into brand_appeals (workspace_id, brand_id, title, description, evidence_type)
         values ($1, $2, $3, $4, $5)
         on conflict (brand_id, title) do update set description = excluded.description, evidence_type = excluded.evidence_type, updated_at = now()
         returning id, title, description, evidence_type, use_count, last_used_at`,
        [input.workspaceId, input.brandId, input.title, input.description, input.evidenceType],
      );
      return mapAppeal(result.rows[0]);
    },
    async confirmAiContentAttachment(input) {
      return attachmentLifecycle.confirmLegacyAiContentAttachment(input);
    },

    async claimAiContentJob(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const exhausted = await client.query(
          `select id
             from ai_content_generation_jobs
            where content_type = $1 and status = 'processing'
              and lease_expires_at <= clock_timestamp()
              and attempt_count >= max_attempts
            order by generation_id, output_id nulls first, id`,
          [input.contentType],
        );
        for (const expired of exhausted.rows) {
          const job = await lockAiContentJobContext(client, String(expired.id));
          if (
            job.status !== "processing"
            || !job.lease_expires_at
            || job.lease_expired !== true
            || Number(job.attempt_count) < Number(job.max_attempts)
          ) {
            continue;
          }
          await client.query(
            `update ai_content_generation_jobs
                set status = 'failed', worker_id = null, lease_token = null, lease_expires_at = null,
                    error_code = 'ai_content_job_lease_exhausted',
                    error_message = 'Worker lease expired after the final attempt', updated_at = now()
              where id = $1`,
            [job.id],
          );
          if (job.job_type === "analyze") {
            await client.query(
              `update ai_content_generations
                  set status = 'failed', error_code = 'ai_content_job_lease_exhausted',
                      error_message = 'Worker lease expired after the final attempt',
                      terminal_at = case
                        when status not in ('completed','partial_failed','failed') then statement_timestamp()
                        else terminal_at
                      end,
                      retryable_until = case
                        when status not in ('completed','partial_failed','failed')
                          then statement_timestamp() + interval '15 days'
                        else retryable_until
                      end,
                      updated_at = now()
                where id = $1`,
              [job.generation_id],
            );
          } else {
            await client.query(
              `update ai_content_generation_outputs
                  set status = 'failed', failure_code = 'ai_content_job_lease_exhausted',
                      failure_message = 'Worker lease expired after the final attempt', updated_at = now()
                where id = $1`,
              [job.output_id],
            );
            await recalculateGenerationStatus(client, String(job.generation_id));
          }
          await markLinkedScheduledCardNewsFailed(
            client,
            String(job.generation_id),
            job.output_id ? String(job.output_id) : null,
            "ai_content_job_lease_exhausted",
            "Worker lease expired after the final attempt",
          );
        }
        const retryableExpired = await client.query(
          `select id
             from ai_content_generation_jobs
            where content_type = $1 and status = 'processing'
              and lease_expires_at <= clock_timestamp()
              and attempt_count < max_attempts
            order by generation_id, output_id nulls first, id`,
          [input.contentType],
        );
        for (const expired of retryableExpired.rows) {
          const job = await lockAiContentJobContext(client, String(expired.id));
          if (
            job.status !== "processing"
            || !job.lease_expires_at
            || job.lease_expired !== true
            || Number(job.attempt_count) >= Number(job.max_attempts)
          ) {
            continue;
          }
          await client.query(
            `update ai_content_generation_jobs
                set status = 'queued', worker_id = null, lease_token = null, lease_expires_at = null,
                    available_at = now(), error_code = 'ai_content_job_lease_expired',
                    error_message = null, updated_at = now()
              where id = $1`,
            [job.id],
          );
        }
        const candidates = await client.query(
          `select job.id
             from ai_content_generation_jobs job
            where job.content_type = $1
              and job.status = 'queued'
              and job.available_at <= clock_timestamp()
              and job.attempt_count < job.max_attempts
            order by job.available_at, job.created_at, job.id
            limit 25`,
          [input.contentType],
        );
        let job: Record<string, unknown> | null = null;
        const leaseToken = randomUUID();
        for (const candidate of candidates.rows) {
          const lockedJob = await lockAiContentJobContext(client, String(candidate.id));
          if (
            lockedJob.content_type !== input.contentType
            || lockedJob.status !== "queued"
            || lockedJob.available !== true
            || Number(lockedJob.attempt_count) >= Number(lockedJob.max_attempts)
          ) {
            continue;
          }
          const claimed = await client.query(
            `update ai_content_generation_jobs
                set status = 'processing', worker_id = $2, lease_token = $3,
                    lease_expires_at = clock_timestamp() + ($4::text || ' seconds')::interval,
                    last_heartbeat_at = clock_timestamp(), attempt_count = attempt_count + 1,
                    error_code = null, error_message = null, updated_at = now()
              where id = $1
                and status = 'queued'
                and available_at <= clock_timestamp()
                and attempt_count < max_attempts
            returning *`,
            [lockedJob.id, input.workerId, leaseToken, input.leaseSeconds],
          );
          if (claimed.rowCount) {
            job = claimed.rows[0] as Record<string, unknown>;
            break;
          }
        }
        if (!job) {
          await client.query("COMMIT");
          return null;
        }
        if (job.job_type === "generate" && job.output_id) {
          const inputVersion = await client.query(
            `select input_json->>'contractVersion' as contract_version
               from ai_content_generation_input_snapshots
              where generation_id=$1 and workspace_id=$2 and brand_id=$3`,
            [job.generation_id, job.workspace_id, job.brand_id],
          );
          const planningV3 = inputVersion.rows[0]?.contract_version === "content-generation-input.v3";
          await client.query(
            "update ai_content_generation_outputs set status = $2, failure_code = null, failure_message = null, updated_at = now() where id = $1",
            [job.output_id, planningV3 ? "planning" : "generating"],
          );
          await client.query(
            "update ai_content_generations set status = $2, current_stage = 'generation', updated_at = now() where id = $1",
            [job.generation_id, planningV3 ? "planning" : "generating"],
          );
        }
        if (job.job_type === "generate") {
          const payload = object(job.payload_json);
          const queuedInput = object(payload.contentGenerationInput);
          const strippedInput = stripContentKnowledgeData(queuedInput) as Record<string, unknown>;
          let sanitizedInput: Record<string, unknown>;
          if (queuedInput.contractVersion === "content-generation-input.v3") {
            sanitizedInput = parseContentGenerationInputV3(strippedInput) as unknown as Record<string, unknown>;
          } else {
            parseContentGenerationInputV2(strippedInput);
            sanitizedInput = strippedInput;
          }
          const supplement = job.output_id ? await client.query(
            `select evidence_json from ai_content_output_research_snapshots
              where output_id=$1 and generation_id=$2 and workspace_id=$3 and brand_id=$4`,
            [job.output_id, job.generation_id, job.workspace_id, job.brand_id],
          ) : { rows: [] };
          if (supplement.rows[0]?.evidence_json) {
            job.payload_json = {
              ...payload,
              contentGenerationInput: sanitizedInput,
              supplementalResearch: supplement.rows[0].evidence_json,
            };
          } else {
            job.payload_json = { ...payload, contentGenerationInput: sanitizedInput };
          }
          await client.query("COMMIT");
          return mapJob(job);
        }
        const context = await client.query(
          `select generation.draft_json, generation.analysis_json,
                  coalesce(generation.generation_input_snapshot, generation.subject_analysis_snapshot) as generation_input_snapshot,
                  generation.title as generation_title,
                  generation.type as generation_type, output.output_index,
                  coalesce((select jsonb_agg(reference.reference_snapshot_json order by reference.position)
                              from ai_content_generation_references reference where reference.generation_id = generation.id), '[]'::jsonb) as reference_snapshots,
                  coalesce((select jsonb_agg(jsonb_build_object(
                    'role', attachment.role, 'fileName', attachment.file_name, 'mimeType', attachment.mime_type,
                    'sizeBytes', attachment.size_bytes, 'checksum', attachment.checksum, 'url', attachment.storage_url
                  ) order by attachment.created_at)
                              from ai_content_generation_attachments attachment
                             where attachment.generation_id = generation.id and attachment.deleted_at is null), '[]'::jsonb) as attachments
             from ai_content_generations generation
             left join ai_content_generation_outputs output on output.id = $2
            where generation.id = $1`,
          [job.generation_id, job.output_id],
        );
        const contextRow = context.rows[0] ?? {};
        const brandContext = await loadAiContentBrandContext(client, {
          workspaceId: String(job.workspace_id),
          brandId: String(job.brand_id),
        }, options.brandIntelligenceProvider);
        job.payload_json = {
          ...object(job.payload_json),
          title: contextRow.generation_title,
          draft: object(contextRow.draft_json),
          analysis: object(contextRow.analysis_json),
          outputIndex: contextRow.output_index ?? null,
          references: Array.isArray(contextRow.reference_snapshots) ? contextRow.reference_snapshots : [],
          attachments: Array.isArray(contextRow.attachments) ? contextRow.attachments : [],
          brandContext: brandContext.context,
          contentGenerationInput: generationInputForWorker(
            contextRow.generation_input_snapshot,
            contextRow.analysis_json,
            job.job_type,
          ),
        };
        await client.query("COMMIT");
        return mapJob(job);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async heartbeatAiContentJob(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query(
          `select id
             from ai_content_generation_jobs
            where id = $1 and status = 'processing'
              and worker_id = $2 and lease_token = $3
            for update`,
          [input.jobId, input.workerId, input.leaseToken],
        );
        if (!locked.rowCount) {
          await client.query("COMMIT");
          return false;
        }
        const result = await client.query(
          `update ai_content_generation_jobs
              set (lease_expires_at, last_heartbeat_at) = (
                    select heartbeat.at + ($4::text || ' seconds')::interval,
                           heartbeat.at
                      from (select clock_timestamp() as at) heartbeat
                  ),
                  updated_at = now()
            where id = $1 and status = 'processing' and worker_id = $2 and lease_token = $3
              and lease_expires_at > clock_timestamp()
            returning id`,
          [input.jobId, input.workerId, input.leaseToken, input.leaseSeconds],
        );
        await client.query("COMMIT");
        return Boolean(result.rowCount);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async completeAiContentJob(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const job = await lockAiContentJobContext(client, input.jobId);
        if (job.job_type === "generate" && input.jobType === "generate") {
          const inputVersion = await client.query(
            `select input_json->>'contractVersion' as contract_version
               from ai_content_generation_input_snapshots
              where generation_id=$1 and workspace_id=$2 and brand_id=$3`,
            [job.generation_id, job.workspace_id, job.brand_id],
          );
          const requiresPlan = inputVersion.rows[0]?.contract_version === "content-generation-input.v3";
          if (requiresPlan !== ("plan" in input)) {
            throw new Error("ai_content_job_completion_contract_mismatch");
          }
        }
        if (job.status === "succeeded") {
          if (job.worker_id !== input.workerId || job.lease_token !== input.leaseToken) throw new Error("ai_content_job_lease_invalid");
          if (input.jobType === "generate" && "plan" in input) {
            const snapshot = await client.query(
              `select input.input_json,research.evidence_json
                 from ai_content_generation_input_snapshots input
                 left join ai_content_output_research_snapshots research
                   on research.generation_id=input.generation_id and research.output_id=$2
                where input.generation_id=$1 and input.workspace_id=$3 and input.brand_id=$4`,
              [job.generation_id, job.output_id, job.workspace_id, job.brand_id],
            );
            if (!snapshot.rowCount) throw new Error("ai_content_generation_input_missing");
            const finalInput = parseContentGenerationInputV3(snapshot.rows[0].input_json);
            const replayedPlan = parseContentPlanResultV2(input.plan, finalInput, snapshot.rows[0].evidence_json);
            const stored = await client.query(
              "select plan_json from ai_content_generation_outputs where id=$1 and generation_id=$2 for update",
              [job.output_id, job.generation_id],
            );
            if (!stored.rows[0]?.plan_json || canonicalJson(stored.rows[0].plan_json) !== canonicalJson(replayedPlan)) {
              throw new Error("ai_content_plan_completion_conflict");
            }
          }
          const generation = await generationById(client, String(job.generation_id));
          await client.query("COMMIT");
          return generation;
        }
        if (
          job.status !== "processing"
          || job.worker_id !== input.workerId
          || job.lease_token !== input.leaseToken
          || !job.lease_expires_at
          || job.lease_expired === true
        ) {
          throw new Error("ai_content_job_lease_invalid");
        }
        if (job.job_type !== input.jobType) throw new Error("ai_content_job_type_mismatch");
        if (input.jobType === "analyze") {
          if (!input.analysisJson || Object.keys(input.analysisJson).length === 0) throw new Error("ai_content_analysis_result_invalid");
          const qualityBrief = parseContentQualityBrief(input.analysisJson.qualityBrief ?? input.analysisJson);
          const normalizedAnalysis = { ...input.analysisJson, qualityBrief };
          const finalizeGeneration = object(job.payload_json).finalizeGeneration === true;
          await client.query(
            `update ai_content_generations
                set analysis_json = analysis_json || $2::jsonb,
                    status = $3, current_stage = $4,
                    error_code = null, error_message = null, updated_at = now()
              where id = $1`,
            [
              job.generation_id,
              JSON.stringify(normalizedAnalysis),
              finalizeGeneration ? "queued" : "analysis_ready",
              finalizeGeneration ? "generation" : "analysis_ready",
            ],
          );
          if (finalizeGeneration) {
            const storedInput = await client.query(
              `select coalesce(generation_input_snapshot, subject_analysis_snapshot) as generation_input_snapshot
                 from ai_content_generations
                where id = $1`,
              [job.generation_id],
            );
            const baseInput = parseContentGenerationInputV2(
              storedInput.rows[0]?.generation_input_snapshot,
            );
            const finalizedInput = parseContentGenerationInputV2({
              ...baseInput,
              message: {
                ...baseInput.message,
                qualityBrief,
              },
            });
            const outputs = await client.query(
              `select id
                 from ai_content_generation_outputs
                where generation_id = $1 and workspace_id = $2 and brand_id = $3 and status = 'queued'
                order by output_index`,
              [job.generation_id, job.workspace_id, job.brand_id],
            );
            for (const output of outputs.rows) {
              await client.query(
                `insert into ai_content_generation_jobs
                   (generation_id, output_id, workspace_id, brand_id, job_type, content_type, status, payload_json)
                 values ($1, $2, $3, $4, 'generate', $5, 'queued', $6::jsonb)
                 on conflict do nothing`,
                [
                  job.generation_id,
                  output.id,
                  job.workspace_id,
                  job.brand_id,
                  job.content_type,
                  JSON.stringify({
                    generationId: job.generation_id,
                    outputId: output.id,
                    contentGenerationInput: finalizedInput,
                  }),
                ],
              );
            }
          }
        } else if ("plan" in input) {
          if (!job.output_id) throw new Error("ai_content_plan_output_missing");
          const snapshot = await client.query(
            `select input_json from ai_content_generation_input_snapshots
              where generation_id=$1 and workspace_id=$2 and brand_id=$3 for share`,
            [job.generation_id, job.workspace_id, job.brand_id],
          );
          if (!snapshot.rowCount) throw new Error("ai_content_generation_input_missing");
          const finalInput = parseContentGenerationInputV3(snapshot.rows[0].input_json);
          if (finalInput.generationId !== String(job.generation_id)) throw new Error("ai_content_generation_input_mismatch");
          const supplement = await client.query(
            `select evidence_json from ai_content_output_research_snapshots
              where output_id=$1 and generation_id=$2 and workspace_id=$3 and brand_id=$4`,
            [job.output_id, job.generation_id, job.workspace_id, job.brand_id],
          );
          const plan = parseContentPlanResultV2(input.plan, finalInput, supplement.rows[0]?.evidence_json);
          const output = await client.query(
            `select plan_json from ai_content_generation_outputs
              where id=$1 and generation_id=$2 and workspace_id=$3 and brand_id=$4 for update`,
            [job.output_id, job.generation_id, job.workspace_id, job.brand_id],
          );
          if (!output.rowCount) throw new Error("ai_content_plan_output_missing");
          if (output.rows[0].plan_json && canonicalJson(output.rows[0].plan_json) !== canonicalJson(plan)) {
            throw new Error("ai_content_plan_completion_conflict");
          }
          await client.query(
            `update ai_content_generation_outputs
                set plan_json=coalesce(plan_json,$2::jsonb),status='generating',
                    failure_code=null,failure_message=null,updated_at=now()
              where id=$1`,
            [job.output_id, JSON.stringify(plan)],
          );
          await enqueueAiContentRenderJobs(client, {
            workspaceId: String(job.workspace_id), brandId: String(job.brand_id),
            generationId: String(job.generation_id), outputId: String(job.output_id), plan, finalInput,
          });
          await client.query(
            "update ai_content_generations set status='generating',current_stage='generation',error_code=null,error_message=null,updated_at=now() where id=$1",
            [job.generation_id],
          );
        } else {
          let requestedDimensions: { width: number; height: number } | undefined;
          if (job.content_type === "marketing" || job.content_type === "card_news") {
            const generationDraft = await client.query(
              "select draft_json from ai_content_generations where id = $1",
              [job.generation_id],
            );
            requestedDimensions = requestedDimensionsFromDraft(generationDraft.rows[0]?.draft_json);
          }
          const generatedManifest = parseAiContentManifest(
            job.content_type as AiContentType,
            input.manifest,
            requestedDimensions,
          ) as AiContentManifest;
          const manifest = parseAiContentManifest(
            job.content_type as AiContentType,
            mergeRevisionManifest(generatedManifest, object(job.payload_json).revision),
            requestedDimensions,
          ) as AiContentManifest;
          let manifestUrl: URL;
          try { manifestUrl = new URL(input.manifestUrl); } catch { throw new Error("ai_content_manifest_url_invalid"); }
          if (manifestUrl.protocol !== "https:") throw new Error("ai_content_manifest_url_invalid");
          await client.query(
            `update ai_content_generation_outputs
                set title = $2, status = 'completed', content_json = $3::jsonb,
                    artifact_manifest_json = $4::jsonb, manifest_url = $5,
                    failure_code = null, failure_message = null, completed_at = coalesce(completed_at, now()), updated_at = now()
              where id = $1`,
            [job.output_id, manifest.title, JSON.stringify(manifest.content), JSON.stringify(manifest), input.manifestUrl],
          );
          await bridgeScheduledCardNewsCompletion(client, String(job.output_id), manifest, input.manifestUrl);
        }
        await client.query(
          `update ai_content_generation_jobs
              set status = 'succeeded', skill_version = $2, completed_at = coalesce(completed_at, now()),
                  lease_expires_at = null, error_code = null, error_message = null, updated_at = now()
            where id = $1`,
          [input.jobId, input.skillVersion],
        );
        if (input.jobType === "generate" && !("plan" in input)) await recalculateGenerationStatus(client, String(job.generation_id));
        const generation = await generationById(client, String(job.generation_id));
        await client.query("COMMIT");
        return generation;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async failAiContentJob(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const job = await lockAiContentJobContext(client, input.jobId);
        if (job.status === "failed") {
          if (job.worker_id !== input.workerId || job.lease_token !== input.leaseToken) {
            throw new Error("ai_content_job_lease_invalid");
          }
          const generation = await generationById(client, String(job.generation_id));
          await client.query("COMMIT");
          return generation;
        }
        if (job.status === "queued" && job.error_code === input.errorCode) {
          const generation = await generationById(client, String(job.generation_id));
          await client.query("COMMIT");
          return generation;
        }
        if (
          job.status !== "processing"
          || job.worker_id !== input.workerId
          || job.lease_token !== input.leaseToken
          || !job.lease_expires_at
          || job.lease_expired === true
        ) {
          throw new Error("ai_content_job_lease_invalid");
        }
        const willRetry = input.retryable && Number(job.attempt_count) < Number(job.max_attempts);
        await client.query(
          `update ai_content_generation_jobs
              set status = $2, available_at = case when $2 = 'queued' then now() + interval '60 seconds' else available_at end,
                  worker_id = case when $2 = 'failed' then worker_id else null end,
                  lease_token = case when $2 = 'failed' then lease_token else null end,
                  lease_expires_at = null,
                  error_code = $3, error_message = $4, completed_at = case when $2 = 'failed' then now() else null end,
                  updated_at = now()
            where id = $1`,
          [input.jobId, willRetry ? "queued" : "failed", input.errorCode, input.errorMessage],
        );
        if (job.job_type === "analyze") {
          await client.query(
            `update ai_content_generations
                set status = $2, current_stage = 'analysis', error_code = $3, error_message = $4,
                    terminal_at = case
                      when not $5::boolean and status not in ('completed','partial_failed','failed')
                        then statement_timestamp()
                      else terminal_at
                    end,
                    retryable_until = case
                      when not $5::boolean and status not in ('completed','partial_failed','failed')
                        then statement_timestamp() + interval '15 days'
                      else retryable_until
                    end,
                    updated_at = now()
              where id = $1`,
            [job.generation_id, willRetry ? "analyzing" : "failed", input.errorCode, input.errorMessage, willRetry],
          );
        } else {
          await client.query(
            `update ai_content_generation_outputs
                set status = $2, failure_code = $3, failure_message = $4, updated_at = now()
              where id = $1`,
            [job.output_id, willRetry ? "queued" : "failed", input.errorCode, input.errorMessage],
          );
          if (willRetry) {
            await client.query(
              "update ai_content_generations set status = 'queued', current_stage = 'generation', updated_at = now() where id = $1",
              [job.generation_id],
            );
          } else {
            await recalculateGenerationStatus(client, String(job.generation_id));
          }
        }
        if (!willRetry) {
          await markLinkedScheduledCardNewsFailed(
            client,
            String(job.generation_id),
            job.output_id ? String(job.output_id) : null,
            input.errorCode,
            input.errorMessage,
          );
        }
        const generation = await generationById(client, String(job.generation_id));
        await client.query("COMMIT");
        return generation;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async retryAiContentOutput(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const outputScope = await client.query(
          `select generation_id
             from ai_content_generation_outputs
            where id = $1 and workspace_id = $2 and brand_id = $3`,
          [input.outputId, input.workspaceId, input.brandId],
        );
        if (!outputScope.rowCount) throw new Error("ai_content_output_not_found");
        const generationId = String(outputScope.rows[0]?.generation_id);
        const generationResult = await client.query(
          `select id, retryable_until,
                  retryable_until > transaction_timestamp() as retryable
             from ai_content_generations
            where id = $1 and workspace_id = $2 and brand_id = $3
            for update`,
          [generationId, input.workspaceId, input.brandId],
        );
        if (!generationResult.rowCount) throw new Error("ai_content_output_not_found");
        const outputResult = await client.query(
          `select output.*, generation.type
             from ai_content_generation_outputs output
             join ai_content_generations generation on generation.id = output.generation_id
            where output.id = $1 and output.workspace_id = $2 and output.brand_id = $3
              and output.generation_id = $4
            for update of output`,
          [input.outputId, input.workspaceId, input.brandId, generationId],
        );
        const output = outputResult.rows[0] as Record<string, unknown> | undefined;
        if (!output) throw new Error("ai_content_output_not_found");
        if (output.status !== "failed") throw new Error("ai_content_output_not_failed");
        if (generationResult.rows[0]?.retryable !== true) {
          throw new Error("ai_content_attachment_retention_expired");
        }
        if (output.plan_json) {
          const failedRenderJobs = await client.query(
            `select id from ai_content_generation_render_jobs
              where output_id=$1 and generation_id=$2 and workspace_id=$3 and brand_id=$4 and status='failed'
              for update`,
            [input.outputId, generationId, input.workspaceId, input.brandId],
          );
          if (!failedRenderJobs.rowCount) throw new Error("ai_content_render_retry_not_available");
          await client.query(
            `update ai_content_generation_render_jobs
                set status='queued',attempt_count=0,result_json=null,available_at=now(),
                    worker_id=null,lease_token=null,lease_expires_at=null,error_code=null,error_message=null,
                    completed_at=null,updated_at=now()
              where output_id=$1 and generation_id=$2 and workspace_id=$3 and brand_id=$4 and status='failed'`,
            [input.outputId, generationId, input.workspaceId, input.brandId],
          );
          await client.query(
            `update ai_content_generation_outputs set status='generating',failure_code=null,failure_message=null,
                    completed_at=null,updated_at=now() where id=$1`,
            [input.outputId],
          );
          await client.query(
            `update ai_content_generations set status='generating',current_stage='generation',completed_at=null,
                    error_code=null,error_message=null,updated_at=now() where id=$1`,
            [generationId],
          );
          const generation = await generationById(client, generationId);
          await client.query("COMMIT");
          return generation;
        }
        const version = await client.query(
          `select input_json->>'contractVersion' as contract_version
             from ai_content_generation_input_snapshots
            where generation_id=$1 and workspace_id=$2 and brand_id=$3`,
          [generationId, input.workspaceId, input.brandId],
        );
        if (version.rows[0]?.contract_version === "content-generation-input.v3") {
          const reset = await client.query(
            `update ai_content_generation_jobs
                set status='queued',attempt_count=0,available_at=now(),worker_id=null,lease_token=null,
                    lease_expires_at=null,error_code=null,error_message=null,completed_at=null,updated_at=now()
              where id=(select id from ai_content_generation_jobs
                         where output_id=$1 and workspace_id=$2 and brand_id=$3
                           and job_type='generate' and status='failed'
                         order by created_at desc,id desc for update limit 1)
              returning id`,
            [input.outputId, input.workspaceId, input.brandId],
          );
          if (!reset.rowCount) throw new Error("ai_content_planner_retry_not_available");
          await client.query(
            `update ai_content_generation_outputs set status='planning',failure_code=null,failure_message=null,
                    completed_at=null,updated_at=now() where id=$1`,
            [input.outputId],
          );
          await client.query(
            `update ai_content_generations set status='planning',current_stage='generation',completed_at=null,
                    error_code=null,error_message=null,updated_at=now() where id=$1`,
            [generationId],
          );
          const generation = await generationById(client, generationId);
          await client.query("COMMIT");
          return generation;
        }
        const previousGenerateJob = await client.query(
          `select payload_json
             from ai_content_generation_jobs
            where output_id = $1 and workspace_id = $2 and brand_id = $3
              and job_type = 'generate' and status = 'failed'
            order by created_at desc, id desc
            for update
            limit 1`,
          [input.outputId, input.workspaceId, input.brandId],
        );
        const previousPayload = object(previousGenerateJob.rows[0]?.payload_json);
        let retryPayload = previousPayload.contentGenerationInput
          ? previousPayload
          : null;
        if (!retryPayload) {
          const legacySnapshot = await client.query(
            `select generation_input_snapshot, analysis_json
               from ai_content_generations
              where id = $1 and workspace_id = $2 and brand_id = $3`,
            [output.generation_id, input.workspaceId, input.brandId],
          );
          retryPayload = {
            generationId: output.generation_id,
            outputId: input.outputId,
            contentGenerationInput: generationInputForWorker(
              legacySnapshot.rows[0]?.generation_input_snapshot,
              legacySnapshot.rows[0]?.analysis_json,
              "generate",
            ) ?? {},
          };
        }
        const contentGenerationInput = object(retryPayload.contentGenerationInput);
        const attachments = Array.isArray(contentGenerationInput.attachments)
          ? contentGenerationInput.attachments
          : [];
        const snapshotPaths = attachments.flatMap((attachment) => {
          const storagePath = object(attachment).storagePath;
          return typeof storagePath === "string" && storagePath ? [storagePath] : [];
        });
        if (snapshotPaths.length) {
          const committedDeletion = await client.query(
            `select id, status
               from ai_content_attachment_deletion_jobs
              where workspace_id = $1
                and storage_path = any($2::text[])
                and status in ('deleting', 'deleted')
              order by storage_path, id
              for update`,
            [input.workspaceId, snapshotPaths],
          );
          if (committedDeletion.rowCount) {
            throw new Error("ai_content_attachment_retention_expired");
          }
        }
        await client.query(
          `update ai_content_generation_outputs
              set status = 'queued', failure_code = null, failure_message = null, completed_at = null, updated_at = now()
            where id = $1`,
          [input.outputId],
        );
        await client.query(
          `insert into ai_content_generation_jobs
             (generation_id, output_id, workspace_id, brand_id, job_type, content_type, status, payload_json)
           values ($1, $2, $3, $4, 'generate', $5, 'queued', $6::jsonb)`,
          [
            output.generation_id,
            input.outputId,
            input.workspaceId,
            input.brandId,
            output.type,
            JSON.stringify(retryPayload),
          ],
        );
        await client.query(
          `update ai_content_generations
              set status = 'queued', current_stage = 'generation', completed_at = null,
                  error_code = null, error_message = null, updated_at = now()
            where id = $1`,
          [output.generation_id],
        );
        const generation = await generationById(client, String(output.generation_id));
        await client.query("COMMIT");
        return generation;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async reviseAiContentOutput(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const outputScope = await client.query(
          `select generation_id
             from ai_content_generation_outputs
            where id = $1 and workspace_id = $2 and brand_id = $3`,
          [input.outputId, input.workspaceId, input.brandId],
        );
        if (!outputScope.rowCount) throw new Error("ai_content_output_not_found");
        const generationId = String(outputScope.rows[0]?.generation_id);
        const generationResult = await client.query(
          `select id
             from ai_content_generations
            where id = $1 and workspace_id = $2 and brand_id = $3
            for update`,
          [generationId, input.workspaceId, input.brandId],
        );
        if (!generationResult.rowCount) throw new Error("ai_content_output_not_found");
        const outputResult = await client.query(
          `select output.*, generation.type
             from ai_content_generation_outputs output
             join ai_content_generations generation on generation.id = output.generation_id
            where output.id = $1 and output.workspace_id = $2 and output.brand_id = $3
              and output.generation_id = $4
            for update of output`,
          [input.outputId, input.workspaceId, input.brandId, generationId],
        );
        const output = outputResult.rows[0] as Record<string, unknown> | undefined;
        if (!output) throw new Error("ai_content_output_not_found");
        const duplicate = await client.query(
          `select id
             from ai_content_generation_jobs
            where output_id = $1 and workspace_id = $2 and brand_id = $3
              and payload_json #>> '{revision,idempotencyKey}' = $4
            for update
            limit 1`,
          [input.outputId, input.workspaceId, input.brandId, input.idempotencyKey],
        );
        if (duplicate.rowCount) {
          const generation = await generationById(client, generationId);
          await client.query("COMMIT");
          return {
            ...generation,
            outputs: [mapOutput({
              ...output,
              output_index: output.output_index ?? 1,
              content_json: output.content_json ?? {},
              artifact_manifest_json: output.artifact_manifest_json ?? {},
              created_at: output.created_at ?? new Date(0),
              updated_at: output.updated_at ?? new Date(0),
            })],
          };
        }
        if (output.status !== "completed") throw new Error("ai_content_output_not_completed");

        const manifest = object(output.artifact_manifest_json);
        const capabilities = mapOutput({
          ...output,
          output_index: output.output_index ?? 1,
          content_json: output.content_json ?? {},
          artifact_manifest_json: manifest,
          created_at: output.created_at ?? new Date(0),
          updated_at: output.updated_at ?? new Date(0),
        }).revisionCapabilities;
        if (!capabilities.includes(input.action)) throw new Error("ai_content_revision_unsupported");
        if (input.action === "regenerate_card") {
          if (!Number.isSafeInteger(input.cardIndex) || Number(input.cardIndex) < 1) {
            throw new Error("ai_content_revision_card_index_invalid");
          }
          const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
          if (!assets.some((asset, index) => Number(object(asset).index ?? index + 1) === input.cardIndex)) {
            throw new Error("ai_content_revision_card_index_invalid");
          }
        } else if (input.cardIndex !== undefined) {
          throw new Error("ai_content_revision_card_index_invalid");
        }

        const active = await client.query(
          `select id
             from ai_content_generation_jobs
            where output_id = $1 and workspace_id = $2 and brand_id = $3
              and job_type = 'generate' and status in ('queued', 'processing')
            for update
            limit 1`,
          [input.outputId, input.workspaceId, input.brandId],
        );
        if (active.rowCount) throw new Error("ai_content_revision_conflict");

        const previousGenerateJob = await client.query(
          `select payload_json
             from ai_content_generation_jobs
            where output_id = $1 and workspace_id = $2 and brand_id = $3
              and job_type = 'generate'
              and payload_json ? 'contentGenerationInput'
            order by created_at desc, id desc
            for update
            limit 1`,
          [input.outputId, input.workspaceId, input.brandId],
        );
        const previousPayload = object(previousGenerateJob.rows[0]?.payload_json);
        if (!previousPayload.contentGenerationInput) throw new Error("ai_content_revision_snapshot_missing");
        const revisionPayload = {
          ...previousPayload,
          revision: {
            contractVersion: "ai-content-revision.v1",
            action: input.action,
            idempotencyKey: input.idempotencyKey,
            cardIndex: input.action === "regenerate_card" ? input.cardIndex : null,
            previousManifest: manifest,
            previousContent: object(output.content_json),
          },
        };
        await client.query(
          `update ai_content_generation_outputs
              set status = 'queued', failure_code = null, failure_message = null,
                  completed_at = null, updated_at = now()
            where id = $1 and generation_id = $2 and workspace_id = $3 and brand_id = $4`,
          [input.outputId, generationId, input.workspaceId, input.brandId],
        );
        await client.query(
          `insert into ai_content_generation_jobs
             (generation_id, output_id, workspace_id, brand_id, job_type, content_type, status, payload_json)
           values ($1, $2, $3, $4, 'generate', $5, 'queued', $6::jsonb)`,
          [
            generationId,
            input.outputId,
            input.workspaceId,
            input.brandId,
            output.type,
            JSON.stringify(revisionPayload),
          ],
        );
        await client.query(
          `update ai_content_generations
              set status = 'queued', current_stage = 'generation', completed_at = null,
                  error_code = null, error_message = null, updated_at = now()
            where id = $1 and workspace_id = $2 and brand_id = $3`,
          [generationId, input.workspaceId, input.brandId],
        );
        const generation = await generationById(client, generationId);
        await client.query("COMMIT");
        return {
          ...generation,
          outputs: [mapOutput({
            ...output,
            status: "queued",
            output_index: output.output_index ?? 1,
            content_json: output.content_json ?? {},
            artifact_manifest_json: output.artifact_manifest_json ?? {},
            completed_at: null,
            created_at: output.created_at ?? new Date(0),
            updated_at: new Date(),
          })],
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async saveAiContentOutputCopy(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const outputResult = await client.query(
          `select output.*, generation.type
             from ai_content_generation_outputs output
             join ai_content_generations generation on generation.id = output.generation_id
            where output.id = $1 and output.workspace_id = $2 and output.brand_id = $3
            for update of output`,
          [input.outputId, input.workspaceId, input.brandId],
        );
        const output = outputResult.rows[0] as Record<string, unknown> | undefined;
        if (!output) throw new Error("ai_content_output_not_found");
        if (output.status !== "completed") throw new Error("ai_content_output_not_completed");

        const manifest = object(output.artifact_manifest_json);
        const mapped = mapOutput({
          ...output,
          output_index: output.output_index ?? 1,
          content_json: output.content_json ?? {},
          artifact_manifest_json: manifest,
          created_at: output.created_at ?? new Date(0),
          updated_at: output.updated_at ?? new Date(0),
        });
        if (mapped.legacyReadOnly || !mapped.revisionCapabilities.includes("save_copy")) {
          throw new Error("ai_content_copy_edit_unsupported");
        }
        const fields = editableCopyFields(manifest, input.fields);
        const requestHash = createHash("sha256").update(JSON.stringify(fields)).digest("hex");
        const priorEdit = object(manifest.copyEdit);
        if (priorEdit.idempotencyKey === input.idempotencyKey) {
          if (priorEdit.requestHash !== requestHash) throw new Error("ai_content_copy_idempotency_conflict");
          const generation = await generationById(client, String(output.generation_id));
          await client.query("COMMIT");
          return { ...generation, outputs: [mapped] };
        }

        const content = { ...object(output.content_json), ...fields };
        const nextManifest = {
          ...manifest,
          content: { ...object(manifest.content), ...fields },
          copyEdit: { idempotencyKey: input.idempotencyKey, requestHash },
        };
        await client.query(
          `update ai_content_generation_outputs
              set content_json = $2::jsonb, artifact_manifest_json = $3::jsonb, updated_at = now()
            where id = $1 and workspace_id = $4 and brand_id = $5`,
          [
            input.outputId,
            JSON.stringify(content),
            JSON.stringify(nextManifest),
            input.workspaceId,
            input.brandId,
          ],
        );
        const generation = await generationById(client, String(output.generation_id));
        await client.query("COMMIT");
        return {
          ...generation,
          outputs: [mapOutput({
            ...output,
            content_json: content,
            artifact_manifest_json: nextManifest,
            updated_at: new Date(),
          })],
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
