import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  type AiContentManifest,
  type CompleteAiContentJobInput,
  ConfirmAttachmentInput,
  type FailAiContentJobInput,
  AiContentType,
  CreateAiContentAnalysisInput,
  StartAiContentGenerationInput,
  UpdateAiContentDraftInput,
} from "./aiContentContracts.js";
import { parseAiContentManifest } from "./aiContentManifest.js";
import { parseContentQualityBrief } from "./contentQualityBrief.js";
import { buildContentGenerationInput, parseContentGenerationInputV2, type ContentGenerationInputV2 } from "./aiContentGenerationInput.js";
import { createAiContentSubjectRepository } from "./aiContentSubjectRepository.js";
import type { ConfirmedBrandIntelligence } from "./brandIntelligenceProvider.js";

export interface BrandScope {
  workspaceId: string;
  brandId: string;
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
  subjectAnalysisSnapshot?: ContentGenerationInputV2;
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
}

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

export interface AiContentAttachmentRecord {
  id: string;
  generationId: string;
  role: ConfirmAttachmentInput["role"];
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  storageUrl: string;
  storagePath: string;
  createdAt: string;
}

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

export interface AiContentRepository {
  getAiContentBrandContext(input: BrandScope): Promise<AiContentBrandContextRecord>;
  getConfirmedSubjectAnalysisBrandContext(input: BrandScope): Promise<SubjectAnalysisBrandContext>;
  createAiContentAnalysis(input: BrandScope & CreateAiContentAnalysisInput): Promise<AiContentGenerationRecord>;
  updateAiContentDraft(input: BrandGenerationScope & UpdateAiContentDraftInput): Promise<AiContentGenerationRecord>;
  startAiContentGeneration(input: BrandGenerationScope & StartAiContentGenerationInput & {
    usageDate: string;
    dailyGenerationLimit: number;
  }): Promise<AiContentGenerationRecord>;
  listAiContentGenerations(input: BrandScope): Promise<AiContentGenerationRecord[]>;
  getAiContentGeneration(input: BrandGenerationScope): Promise<AiContentGenerationRecord | null>;
  listAiContentUsage(input: BrandScope & { usageDate: string }): Promise<AiContentUsageRecord>;
  listAiContentReferences(input: BrandScope & { type?: AiContentType }): Promise<AiContentReferenceRecord[]>;
  listBrandAudiences(input: BrandScope): Promise<AudienceRecord[]>;
  saveBrandAudience(input: SaveAudienceInput): Promise<AudienceRecord>;
  listBrandAppeals(input: BrandScope): Promise<AppealRecord[]>;
  saveBrandAppeal(input: SaveAppealInput): Promise<AppealRecord>;
  confirmAiContentAttachment(input: BrandGenerationScope & ConfirmAttachmentInput): Promise<AiContentAttachmentRecord>;
  claimAiContentJob(input: { contentType: AiContentType; workerId: string; leaseSeconds: number }): Promise<AiContentJobRecord | null>;
  heartbeatAiContentJob(input: { jobId: string; workerId: string; leaseToken: string; leaseSeconds: number }): Promise<boolean>;
  completeAiContentJob(input: CompleteAiContentJobInput): Promise<AiContentGenerationRecord>;
  failAiContentJob(input: FailAiContentJobInput): Promise<AiContentGenerationRecord>;
  retryAiContentOutput(input: BrandScope & { outputId: string }): Promise<AiContentGenerationRecord>;
}

interface AiContentRepositoryOptions {
  deleteAttachments?: (urls: string[]) => Promise<void>;
  brandIntelligenceProvider?: {
    getConfirmed(input: BrandScope): Promise<ConfirmedBrandIntelligence | null>;
  };
}

type Queryable = Pick<PoolClient, "query">;

function iso(value: unknown) {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  return new Date(value).toISOString();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

  const wikiResult = await client.query(
    `select version.id, coalesce(version.activated_at, version.completed_at, version.updated_at) as wiki_updated_at,
            coalesce(jsonb_agg(jsonb_build_object(
              'type', page.page_type,
              'title', page.title,
              'summary', page.summary,
              'content', left(page.content_markdown, 6000),
              'structuredData', page.structured_data
            ) order by page.is_core desc, page.page_type, page.title)
              filter (where page.id is not null), '[]'::jsonb) as pages
       from wiki_versions version
       left join lateral (
         select candidate.*
           from wiki_pages candidate
          where candidate.workspace_id = version.workspace_id and candidate.brand_id = version.brand_id
            and candidate.wiki_version_id = version.id and candidate.is_active
          order by candidate.is_core desc, candidate.updated_at desc
          limit 12
       ) page on true
      where version.workspace_id = $1 and version.brand_id = $2 and version.status = 'active'
      group by version.id, version.activated_at, version.completed_at, version.updated_at
      order by version.activated_at desc nulls last, version.updated_at desc
      limit 1`,
    [input.workspaceId, input.brandId],
  );
  const wiki = wikiResult.rows[0] as Record<string, unknown> | undefined;
  const pages = Array.isArray(wiki?.pages) ? wiki.pages as Array<Record<string, unknown>> : [];
  const coreSummary = pages.find((page) => page.type === "brand_overview")?.summary
    ?? pages.find((page) => typeof page.summary === "string" && page.summary.trim())?.summary
    ?? null;
  const ownedUrl = brand.owned_url ? String(brand.owned_url) : null;
  const wikiVersionId = wiki?.id ? String(wiki.id) : null;
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
    ready: provider ? Boolean(confirmed) : Boolean(ownedUrl && wikiVersionId && pages.length),
    brandName: String(brand.name),
    ownedUrl,
    sourceStatus: brand.source_status ? String(brand.source_status) : null,
    lastCrawledAt: iso(brand.last_crawled_at),
    wikiVersionId,
    wikiUpdatedAt: iso(wiki?.wiki_updated_at),
    summary: typeof coreSummary === "string" ? coreSummary : null,
    pageCount: pages.length,
    brandIntelligenceVersionId: confirmed?.versionId ?? null,
    context: {
      brand: { name: String(brand.name), ...profile },
      brandIntelligence: confirmed ? {
        versionId: confirmed.versionId,
        confirmedAt: confirmed.confirmedAt,
        profile: confirmed.profile,
      } : null,
      ownedSource: ownedUrl ? { url: ownedUrl, status: brand.source_status ?? null, lastCrawledAt: iso(brand.last_crawled_at) } : null,
      wiki: wikiVersionId ? { versionId: wikiVersionId, updatedAt: iso(wiki?.wiki_updated_at), pages } : null,
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
    subjectAnalysisSnapshot: row.subject_analysis_snapshot ? parseContentGenerationInputV2(row.subject_analysis_snapshot) : undefined,
  };
}

function mapOutput(row: Record<string, unknown>): AiContentOutputRecord {
  return {
    id: String(row.id), generationId: String(row.generation_id), outputIndex: Number(row.output_index),
    title: row.title ? String(row.title) : null, status: row.status as AiContentOutputRecord["status"],
    content: object(row.content_json), manifest: object(row.artifact_manifest_json), manifestUrl: row.manifest_url ? String(row.manifest_url) : null,
    failureCode: row.failure_code ? String(row.failure_code) : null, failureMessage: row.failure_message ? String(row.failure_message) : null,
    downloadedAt: iso(row.downloaded_at), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!, completedAt: iso(row.completed_at),
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
            generation_idempotency_key, subject_analysis_snapshot, error_code, error_message, created_at, updated_at, completed_at
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
            error_code, error_message, created_at, updated_at, completed_at
       from ai_content_generations where id = $1`,
    [generationId],
  );
  if (!result.rowCount) throw new Error("ai_content_generation_not_found");
  return mapGeneration(result.rows[0]);
}

async function recalculateGenerationStatus(client: Queryable, generationId: string) {
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
            updated_at = now()
      where id = $1`,
    [generationId, status, terminal ? "completed" : "generation", terminal],
  );
}

async function deleteCompletedGenerationAttachments(
  pool: Pool,
  generation: AiContentGenerationRecord,
  deleteAttachments?: (urls: string[]) => Promise<void>,
) {
  if (generation.status !== "completed" || !deleteAttachments) return;
  const attachments = await pool.query(
    `select id, storage_url
       from ai_content_generation_attachments
      where generation_id = $1 and workspace_id = $2 and brand_id = $3 and deleted_at is null`,
    [generation.id, generation.workspaceId, generation.brandId],
  );
  if (!attachments.rowCount) return;
  try {
    await deleteAttachments(attachments.rows.map((row) => String(row.storage_url)));
  } catch {
    return;
  }
  await pool.query(
    `update ai_content_generation_attachments
        set deleted_at = now()
      where generation_id = $1 and workspace_id = $2 and brand_id = $3
        and id = any($4::uuid[]) and deleted_at is null`,
    [generation.id, generation.workspaceId, generation.brandId, attachments.rows.map((row) => String(row.id))],
  );
}

export function createAiContentRepository(pool: Pool, options: AiContentRepositoryOptions = {}): AiContentRepository {
  const subjectRepository = createAiContentSubjectRepository(pool);
  return {
    getAiContentBrandContext(input) {
      return loadAiContentBrandContext(pool, input, options.brandIntelligenceProvider);
    },

    getConfirmedSubjectAnalysisBrandContext(input) {
      return loadConfirmedSubjectAnalysisBrandContext(pool, input, options.brandIntelligenceProvider);
    },

    async createAiContentAnalysis(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query(
    `select id, workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json, generation_idempotency_key,
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
        const draft: Record<string, unknown> = { ...object(input.draft), origin: "manual" };
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
          wikiVersionId: brandContext?.wikiVersionId,
          wikiUpdatedAt: brandContext?.wikiUpdatedAt,
          pageCount: brandContext?.pageCount,
          brandIntelligenceVersionId: brandContext?.brandIntelligenceVersionId,
        } : {};
        const created = await client.query(
          `insert into ai_content_generations
             (workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json, analysis_idempotency_key)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
           on conflict (brand_id, analysis_idempotency_key) do nothing
           returning id, workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json,
                     error_code, error_message, created_at, updated_at, completed_at`,
          [input.workspaceId, input.brandId, input.type, input.title, initialStatus, initialStage, JSON.stringify(draft), JSON.stringify(initialAnalysis), input.idempotencyKey],
        );
        const generation = created.rows[0] as Record<string, unknown> | undefined;
        if (!generation) {
          const conflicted = await client.query(
            `select id, workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json,
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

    async updateAiContentDraft(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const generation = await scopedGeneration(client, input, true);
        if (!generation) throw new Error("ai_content_generation_not_found");
        const updated = await client.query(
          `update ai_content_generations set draft_json = $4::jsonb, updated_at = now()
            where id = $1 and workspace_id = $2 and brand_id = $3
            returning id, workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json,
                      error_code, error_message, created_at, updated_at, completed_at`,
          [input.generationId, input.workspaceId, input.brandId, JSON.stringify({ ...object(input.draft), origin: "manual" })],
        );
        await snapshotReferences(client, input, [...new Set(input.referenceIds)]);
        await client.query("COMMIT");
        return mapGeneration(updated.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK"); throw error;
      } finally { client.release(); }
    },

    async startAiContentGeneration(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await scopedGeneration(client, input, true);
        if (!current) throw new Error("ai_content_generation_not_found");
        if (current.generation_idempotency_key === input.idempotencyKey) {
          await client.query("COMMIT");
          return mapGeneration(current);
        }
        if (current.status !== "analysis_ready") throw new Error("ai_content_generation_not_analysis_ready");
        const draft = object(current.draft_json);
        const subjectFlow = draft.subjectAnalysisId !== undefined
          || draft.subjectType === "product"
          || draft.subjectType === "service"
          || draft.selectedTarget !== undefined
          || draft.selectedAppeal !== undefined;
        const usesOwnedContext = draft.analysisSource === "owned";
        const brandContext = usesOwnedContext
          ? await loadAiContentBrandContext(client, input, options.brandIntelligenceProvider)
          : null;
        if (usesOwnedContext && options.brandIntelligenceProvider && !brandContext?.brandIntelligenceVersionId) {
          throw new Error("brand_intelligence_required");
        }
        if (usesOwnedContext && !options.brandIntelligenceProvider && !brandContext?.ownedUrl) {
          throw new Error("ai_content_owned_source_required");
        }
        const waitForOwnedContext = Boolean(usesOwnedContext && !brandContext?.ready);
        if (waitForOwnedContext) {
          await client.query(
            `insert into wiki_build_requests (
               workspace_id, brand_id, requested_revision, status, quiet_until
             ) values ($1::uuid, $2::uuid, 1, 'pending', now())
             on conflict (workspace_id, brand_id)
             where status in ('pending', 'building')
             do update set
               requested_revision = wiki_build_requests.requested_revision + 1,
               rebuild_requested = wiki_build_requests.rebuild_requested or wiki_build_requests.status = 'building',
               quiet_until = now(), updated_at = now()`,
            [input.workspaceId, input.brandId],
          );
        }
        const generationInput = subjectFlow
          ? await buildContentGenerationInput(
            {
              getBrandContext: (scope) => loadAiContentBrandContext(client, scope, options.brandIntelligenceProvider),
              getSubjectAnalysis: (scope) => subjectRepository.getSubjectAnalysis(scope),
              getReferences: (scope) => loadGenerationReferences(client, scope),
              getAttachments: (scope) => loadGenerationAttachments(client, scope),
            },
            mapGeneration(current),
            { outputCount: input.outputCount },
          )
          : null;
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `ai-content-usage:${input.brandId}:${input.usageDate}`,
        ]);
        const updated = await client.query(
          `update ai_content_generations
              set status = 'analyzing', current_stage = $5, generation_idempotency_key = $4,
                  subject_analysis_snapshot = coalesce(subject_analysis_snapshot, $6::jsonb), updated_at = now()
            where id = $1 and workspace_id = $2 and brand_id = $3 and status = 'analysis_ready'
            returning id, workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json,
                      error_code, error_message, created_at, updated_at, completed_at`,
          [input.generationId, input.workspaceId, input.brandId, input.idempotencyKey, waitForOwnedContext ? "owned_context" : "analysis", generationInput ? JSON.stringify(generationInput) : null],
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
             'waitForOwnedContext', $5::boolean
           ))
           on conflict do nothing`,
          [input.generationId, input.workspaceId, input.brandId, generation.type, waitForOwnedContext],
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
        await client.query("ROLLBACK"); throw error;
      } finally { client.release(); }
    },

    async listAiContentGenerations(input) {
      const result = await pool.query(
        `select id, workspace_id, brand_id, type, title, status, current_stage, draft_json, analysis_json,
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
      return { ...generation, outputs: outputs.get(generation.id) ?? [] };
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
      if (cardNews || marketing) queries.push(`
        select co.id, 'brand_output' as source, co.title, null::text as url, null::text as preview_url,
               jsonb_build_object('exposureCount', performance.exposure_count) as metrics, performance.collected_at as checked_at
          from channel_outputs co
          left join lateral (select exposure_count, collected_at from content_performance_snapshots cps
            where cps.channel_output_id = co.id order by cps.snapshot_date desc limit 1) performance on true
         where co.workspace_id = $1 and co.brand_id = $2 and co.status in ('approved', 'auto_approved')
           ${cardNews ? "and co.delivery_format = 'instagram_feed_carousel'" : "and performance.exposure_count is not null"}`);
      if (cardNews) queries.push(`
        select saved.id, 'saved_trend' as source, coalesce(media.caption, media.username, 'Instagram reference') as title,
               media.permalink as url, media.media_url as preview_url,
               jsonb_build_object('likeCount', media.like_count, 'commentsCount', media.comments_count) as metrics,
               media.last_fetched_at as checked_at
          from brand_trend_saved_media saved join instagram_trend_media media on media.id = saved.trend_media_id
         where saved.workspace_id = $1 and saved.brand_id = $2`);
      if (blog || marketing) queries.push(`
        select source.id, 'saved_url' as source, coalesce(snapshot.extracted_title, source.title, source.url) as title,
               source.url, null::text as preview_url, '{}'::jsonb as metrics, snapshot.fetched_at as checked_at
          from source_urls source join lateral (select * from source_snapshots ss where ss.source_url_id = source.id
            and ss.status = 'succeeded' order by ss.fetched_at desc limit 1) snapshot on true
         where source.workspace_id = $1 and source.brand_id = $2 and source.source_type = 'reference' and source.deleted_at is null`);
      if (!queries.length) return [];
      const result = await pool.query(
        `select * from (${queries.join(" union all ")}) reference_rows
          order by case when greatest(
            coalesce((metrics->>'exposureCount')::bigint, 0),
            coalesce((metrics->>'likeCount')::bigint, 0),
            coalesce((metrics->>'commentsCount')::bigint, 0)
          ) > 0 then 0 else 1 end, checked_at desc nulls last`,
        [input.workspaceId, input.brandId],
      );
      return result.rows.map((row) => ({ id: String(row.id), source: row.source, title: String(row.title), url: row.url ?? null, previewUrl: row.preview_url ?? null, metrics: object(row.metrics), checkedAt: iso(row.checked_at) }));
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
      const generation = await scopedGeneration(pool, input);
      if (!generation) throw new Error("ai_content_generation_not_found");
      const result = await pool.query(
        `insert into ai_content_generation_attachments
           (generation_id, workspace_id, brand_id, role, file_name, mime_type, size_bytes, checksum, storage_url, storage_path)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (generation_id, storage_path) do update
           set storage_url = excluded.storage_url
         returning id, generation_id, role, file_name, mime_type, size_bytes, checksum, storage_url, storage_path, created_at`,
        [input.generationId, input.workspaceId, input.brandId, input.role, input.fileName, input.mimeType, input.sizeBytes, input.checksum, input.storageUrl, input.storagePath],
      );
      return mapAttachment(result.rows[0]);
    },

    async claimAiContentJob(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const exhausted = await client.query(
          `update ai_content_generation_jobs
              set status = 'failed', worker_id = null, lease_token = null, lease_expires_at = null,
                  error_code = 'ai_content_job_lease_exhausted', error_message = 'Worker lease expired after the final attempt', updated_at = now()
            where content_type = $1 and status = 'processing' and lease_expires_at < now() and attempt_count >= max_attempts
          returning generation_id, output_id, job_type`,
          [input.contentType],
        );
        for (const expired of exhausted.rows) {
          if (expired.job_type === "analyze") {
            await client.query(
              `update ai_content_generations
                  set status = 'failed', error_code = 'ai_content_job_lease_exhausted',
                      error_message = 'Worker lease expired after the final attempt', updated_at = now()
                where id = $1`,
              [expired.generation_id],
            );
          } else {
            await client.query(
              `update ai_content_generation_outputs
                  set status = 'failed', failure_code = 'ai_content_job_lease_exhausted',
                      failure_message = 'Worker lease expired after the final attempt', updated_at = now()
                where id = $1`,
              [expired.output_id],
            );
            await recalculateGenerationStatus(client, String(expired.generation_id));
          }
          await markLinkedScheduledCardNewsFailed(
            client,
            String(expired.generation_id),
            expired.output_id ? String(expired.output_id) : null,
            "ai_content_job_lease_exhausted",
            "Worker lease expired after the final attempt",
          );
        }
        await client.query(
          `update ai_content_generation_jobs
              set status = 'queued', worker_id = null, lease_token = null, lease_expires_at = null,
                  available_at = now(), error_code = 'ai_content_job_lease_expired', error_message = null, updated_at = now()
            where content_type = $1 and status = 'processing' and lease_expires_at < now() and attempt_count < max_attempts`,
          [input.contentType],
        );
        const leaseToken = randomUUID();
        const claimed = await client.query(
          `with candidate as (
             select job.id from ai_content_generation_jobs job
              where job.content_type = $1 and job.status = 'queued' and job.available_at <= now() and job.attempt_count < job.max_attempts
                and (
                  coalesce((job.payload_json->>'waitForOwnedContext')::boolean, false) = false
                  or exists (
                    select 1
                      from wiki_versions version
                     where version.workspace_id = job.workspace_id and version.brand_id = job.brand_id
                       and version.status = 'active'
                       and exists (
                         select 1 from wiki_pages page
                          where page.wiki_version_id = version.id and page.workspace_id = job.workspace_id
                            and page.brand_id = job.brand_id and page.is_active
                       )
                  )
                )
              order by available_at, created_at
              for update skip locked
              limit 1
           )
           update ai_content_generation_jobs job
              set status = 'processing', worker_id = $2, lease_token = $3,
                  lease_expires_at = now() + ($4::text || ' seconds')::interval,
                  last_heartbeat_at = now(), attempt_count = attempt_count + 1,
                  error_code = null, error_message = null, updated_at = now()
             from candidate where job.id = candidate.id
           returning job.*`,
          [input.contentType, input.workerId, leaseToken, input.leaseSeconds],
        );
        if (!claimed.rowCount) {
          await client.query("COMMIT");
          return null;
        }
        const job = claimed.rows[0] as Record<string, unknown>;
        if (job.job_type === "generate" && job.output_id) {
          await client.query(
            "update ai_content_generation_outputs set status = 'generating', failure_code = null, failure_message = null, updated_at = now() where id = $1",
            [job.output_id],
          );
          await client.query(
            "update ai_content_generations set status = 'generating', current_stage = 'generation', updated_at = now() where id = $1",
            [job.generation_id],
          );
        }
        const context = await client.query(
          `select generation.draft_json, generation.analysis_json, generation.subject_analysis_snapshot,
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
          contentGenerationInput: contextRow.subject_analysis_snapshot
            ? parseContentGenerationInputV2(contextRow.subject_analysis_snapshot)
            : undefined,
        };
        await client.query("COMMIT");
        return mapJob(job);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async heartbeatAiContentJob(input) {
      const result = await pool.query(
        `update ai_content_generation_jobs
            set lease_expires_at = now() + ($4::text || ' seconds')::interval,
                last_heartbeat_at = now(), updated_at = now()
          where id = $1 and status = 'processing' and worker_id = $2 and lease_token = $3 and lease_expires_at > now()
          returning id`,
        [input.jobId, input.workerId, input.leaseToken, input.leaseSeconds],
      );
      return Boolean(result.rowCount);
    },

    async completeAiContentJob(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query(
          "select * from ai_content_generation_jobs where id = $1 for update",
          [input.jobId],
        );
        const job = locked.rows[0] as Record<string, unknown> | undefined;
        if (!job) throw new Error("ai_content_job_not_found");
        if (job.status === "succeeded") {
          if (job.worker_id !== input.workerId || job.lease_token !== input.leaseToken) throw new Error("ai_content_job_lease_invalid");
          const generation = await generationById(client, String(job.generation_id));
          await client.query("COMMIT");
          await deleteCompletedGenerationAttachments(pool, generation, options.deleteAttachments);
          return generation;
        }
        if (
          job.status !== "processing"
          || job.worker_id !== input.workerId
          || job.lease_token !== input.leaseToken
          || !job.lease_expires_at
          || new Date(String(job.lease_expires_at)).getTime() <= Date.now()
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
                    subject_analysis_snapshot = case
                      when subject_analysis_snapshot->>'contractVersion' = 'content-generation-input.v2'
                        then jsonb_set(subject_analysis_snapshot, '{message,qualityBrief}', $5::jsonb, true)
                      else subject_analysis_snapshot
                    end,
                    status = $3, current_stage = $4,
                    error_code = null, error_message = null, updated_at = now()
              where id = $1`,
            [
              job.generation_id,
              JSON.stringify(normalizedAnalysis),
              finalizeGeneration ? "queued" : "analysis_ready",
              finalizeGeneration ? "generation" : "analysis_ready",
              JSON.stringify(qualityBrief),
            ],
          );
          if (finalizeGeneration) {
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
                 values ($1, $2, $3, $4, 'generate', $5, 'queued', jsonb_build_object('generationId', $1::uuid, 'outputId', $2::uuid))
                 on conflict do nothing`,
                [job.generation_id, output.id, job.workspace_id, job.brand_id, job.content_type],
              );
            }
          }
        } else {
          let requestedDimensions: { width: number; height: number } | undefined;
          if (job.content_type === "marketing" || job.content_type === "card_news") {
            const generationDraft = await client.query(
              "select draft_json from ai_content_generations where id = $1",
              [job.generation_id],
            );
            requestedDimensions = requestedDimensionsFromDraft(generationDraft.rows[0]?.draft_json);
          }
          const manifest = parseAiContentManifest(job.content_type as AiContentType, input.manifest, requestedDimensions) as AiContentManifest;
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
        if (input.jobType === "generate") await recalculateGenerationStatus(client, String(job.generation_id));
        const generation = await generationById(client, String(job.generation_id));
        await client.query("COMMIT");
        await deleteCompletedGenerationAttachments(pool, generation, options.deleteAttachments);
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
        const locked = await client.query("select * from ai_content_generation_jobs where id = $1 for update", [input.jobId]);
        const job = locked.rows[0] as Record<string, unknown> | undefined;
        if (!job) throw new Error("ai_content_job_not_found");
        if (job.status === "failed" || (job.status === "queued" && job.error_code === input.errorCode)) {
          const generation = await generationById(client, String(job.generation_id));
          await client.query("COMMIT");
          return generation;
        }
        if (
          job.status !== "processing"
          || job.worker_id !== input.workerId
          || job.lease_token !== input.leaseToken
          || !job.lease_expires_at
          || new Date(String(job.lease_expires_at)).getTime() <= Date.now()
        ) {
          throw new Error("ai_content_job_lease_invalid");
        }
        const willRetry = input.retryable && Number(job.attempt_count) < Number(job.max_attempts);
        await client.query(
          `update ai_content_generation_jobs
              set status = $2, available_at = case when $2 = 'queued' then now() + interval '60 seconds' else available_at end,
                  worker_id = null, lease_token = null, lease_expires_at = null,
                  error_code = $3, error_message = $4, completed_at = case when $2 = 'failed' then now() else null end,
                  updated_at = now()
            where id = $1`,
          [input.jobId, willRetry ? "queued" : "failed", input.errorCode, input.errorMessage],
        );
        if (job.job_type === "analyze") {
          await client.query(
            `update ai_content_generations
                set status = $2, current_stage = 'analysis', error_code = $3, error_message = $4, updated_at = now()
              where id = $1`,
            [job.generation_id, willRetry ? "analyzing" : "failed", input.errorCode, input.errorMessage],
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
        if (output.status !== "failed") throw new Error("ai_content_output_not_failed");
        await client.query(
          `update ai_content_generation_outputs
              set status = 'queued', failure_code = null, failure_message = null, completed_at = null, updated_at = now()
            where id = $1`,
          [input.outputId],
        );
        await client.query(
          `insert into ai_content_generation_jobs
             (generation_id, output_id, workspace_id, brand_id, job_type, content_type, status, payload_json)
           values ($1, $2, $3, $4, 'generate', $5, 'queued', jsonb_build_object(
             'generationId', $1::uuid,
             'outputId', $2::uuid,
             'contentGenerationInput', coalesce((select subject_analysis_snapshot from ai_content_generations where id = $1), '{}'::jsonb)
           ))`,
          [output.generation_id, input.outputId, input.workspaceId, input.brandId, output.type],
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
  };
}
