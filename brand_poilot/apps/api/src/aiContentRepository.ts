import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  type AiContentManifest,
  type CompleteAiContentJobInput,
  parseRenderSemanticContractV1,
  type RenderSemanticContractV1,
  type ContentChannelV2,
  type ContentFinalizationDraftV2,
  type ContentGenerationStartV2,
  type ContentOutputFormatV2,
  type ContentPurposeV2,
  LegacyConfirmAttachmentInput,
  type FailAiContentJobInput,
  AiContentType,
} from "./aiContentContracts.js";
import {
  createContentProposalJobsRepository,
  type ContentProposalJobsRepository,
} from "./contentProposalJobs.js";
import { parseAiContentManifest } from "./aiContentManifest.js";
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
import {
  parseContentFinalizationDraftV2,
  parseProposalInputSnapshotV2,
} from "./aiContentGenerationInputV3.js";
import type { AiContentSnapshotRepository } from "./aiContentSnapshotRepository.js";
import { assembleContentPlanResultV2, parseContentPlanResultV2, type ContentPlanResultV2 } from "./aiContentPlanContracts.js";
import {
  createAiContentRenderJobsRepository,
  enqueueAiContentRenderJobs,
  resolveManualRenderTransport,
} from "./aiContentRenderJobs.js";
import { assertAiContentWritable, withAiContentTransactionFence } from "./aiContentMaintenance.js";
import {
  parseProposalBaseInputSnapshotV2 as parseCanonicalProposalBaseInputSnapshotV2,
  parseContentOrchestrationV2 as parseCanonicalContentOrchestrationV2,
  parseContentGenerationInputV3 as parseCanonicalContentGenerationInputV3,
  parseBrandRulesContentV1,
  assertPlannerPromptBinding,
  parseContentPromptBinding,
  type ContentOrchestrationV2 as CanonicalContentOrchestrationV2,
  type ContentPurpose,
  type ContentStudioOutputFormat,
  type VerifiedGeneratedContentCatalog,
} from "@brand-pilot/content-contracts";
import { compileStructuredScene } from "@brand-pilot/content-contracts/structured-scene-copy";
import {
  assembleAiContentFixedInput,
  type AiContentFixedInputSource,
} from "./aiContentFixedInputAssembler.js";
import {
  completeGenerationOperationIfTerminal,
  reverseGenerationReservationIfTerminalFailure,
} from "./aiContentGenerationOperations.js";
import {
  loadAiContentGenerationProgress,
  type AiContentGenerationProgress,
} from "./aiContentGenerationProgress.js";
import {
  canonicalProposalJson,
  proposalSha256,
  type EnqueueProposalV2Input,
  type ProposalV2CreationResult,
  type ProposalV2ReplayIdentity,
  type ProposalV2Transaction,
} from "./aiContentProposalV2Service.js";

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
  outputFormat: ContentStudioOutputFormat;
  purpose: ContentPurpose;
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
  progress?: AiContentGenerationProgress;
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
  attachments?: AiContentAttachmentRecord[];
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
  revisionCapabilities: [];
  legacyReadOnly: boolean;
  manifestVersion: "ai-content.v3" | null;
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
  jobType: "generate";
  outputFormat: ContentStudioOutputFormat;
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
  resumeInput?: CanonicalContentOrchestrationV2;
  sourceSnapshots: Record<string, unknown>[];
  status: "queued" | "building" | "ready" | "failed";
  proposals?: AiContentProposalRecord[];
  researchEvidence?: {
    items: Array<{ id: string; title: string; url: string; publisher: string | null }>;
  };
  provenance?: {
    kind: "performance_experiment";
    experimentId: string;
    evidenceVersion: string;
    snapshotCount: number;
    capturedFrom: string;
    capturedTo: string;
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
  assertAiContentWritable(): Promise<void>;
  getAiContentBrandContext(input: BrandScope): Promise<AiContentBrandContextRecord>;
  getConfirmedSubjectAnalysisBrandContext(input: BrandScope): Promise<SubjectAnalysisBrandContext>;
  listSubjectEvidenceAttachments(input: LoadSubjectEvidenceInput): Promise<SubjectEvidenceAttachment[]>;
  getSubjectAnalysisWorkerLease(input: {
    analysisId: string;
    workerId: string;
    leaseToken: string;
  }): Promise<SubjectAnalysisWorkerLease | null>;
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
  claimAiContentJob(input: { outputFormat: ContentStudioOutputFormat; workerId: string; leaseSeconds: number }): Promise<AiContentJobRecord | null>;
  heartbeatAiContentJob(input: { jobId: string; workerId: string; leaseToken: string; leaseSeconds: number }): Promise<boolean>;
  completeAiContentJob(input: CompleteAiContentJobInput): Promise<AiContentGenerationRecord>;
  failAiContentJob(input: FailAiContentJobInput): Promise<AiContentGenerationRecord>;
  claimAiContentRenderJob(input: { workerId: string; leaseSeconds: number }): ReturnType<ReturnType<typeof createAiContentRenderJobsRepository>["claim"]>;
  heartbeatAiContentRenderJob(input: import("./aiContentRenderJobs.js").RenderLeaseInput): Promise<boolean>;
  completeAiContentRenderAsset(input: import("./aiContentRenderJobs.js").RenderAssetCompletion): Promise<void>;
  completeAiContentRenderPackage(input: import("./aiContentRenderJobs.js").RenderPackageCompletion): Promise<AiContentGenerationRecord>;
  failAiContentRenderJob(input: import("./aiContentRenderJobs.js").RenderFailure): Promise<void>;
  saveAiContentOutputResearch(input: { jobId: string; outputId: string; workerId: string; leaseToken: string; evidence: Record<string, unknown> }): Promise<void>;
  retryAiContentOutput(input: AuthenticatedBrandScope & {
    outputId: string;
    contractVersion: "content-generation-retry.v1";
    idempotencyKey: string;
    reason: string;
    usageDate: string;
    dailyGenerationLimit: number;
  }): Promise<AiContentGenerationRecord>;
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

function validateRenderSemanticContract(
  input: CompleteAiContentJobInput,
  outputFormat: ContentOutputFormatV2,
  plan: ContentPlanResultV2,
  requiredForManualRender: boolean,
): RenderSemanticContractV1 | null {
  if (outputFormat === "blog") {
    if (input.renderSemanticContract !== undefined) {
      throw new Error("ai_content_render_semantic_contract_invalid");
    }
    return null;
  }
  if (!requiredForManualRender) return null;
  if (input.renderSemanticContract === undefined) {
    throw new Error("ai_content_render_semantic_contract_invalid");
  }
  const semantic = parseRenderSemanticContractV1(input.renderSemanticContract);
  if (semantic.outputFormat !== outputFormat || !plan.imagePackage
    || plan.imagePackage.outputFormat !== outputFormat
    || semantic.scenes.length !== plan.imagePackage.assets.length) {
    throw new Error("ai_content_render_semantic_contract_mismatch");
  }
  for (const [offset, scene] of semantic.scenes.entries()) {
    const asset = plan.imagePackage.assets[offset];
    if (!asset) throw new Error("ai_content_render_semantic_contract_mismatch");
    const { attachmentIds: _attachmentIds, ...assetWithoutAttachments } = asset;
    if (canonicalJson(compileStructuredScene(scene)) !== canonicalJson(assetWithoutAttachments)) {
      throw new Error("ai_content_render_semantic_contract_mismatch");
    }
  }
  return semantic;
}

function assertStoredRenderSemanticContract(
  payload: unknown,
  semantic: RenderSemanticContractV1 | null,
): void {
  const stored = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).renderSemanticContract
    : undefined;
  if (semantic === null) {
    if (stored !== undefined) throw new Error("ai_content_plan_completion_conflict");
    return;
  }
  try {
    if (canonicalJson(parseRenderSemanticContractV1(stored)) !== canonicalJson(semantic)) {
      throw new Error("ai_content_plan_completion_conflict");
    }
  } catch {
    throw new Error("ai_content_plan_completion_conflict");
  }
}

const EXPECTED_PROPOSAL_CATALOG_SHA256 = "bcb2badcc413ff85bac13364048a4fdb12d45a73592f42d662603b932500b248";
const PROPOSAL_MODEL_ID = "gpt-5.6-terra";

function loadProposalCatalog(): VerifiedGeneratedContentCatalog {
  const url = import.meta.resolve("@brand-pilot/content-contracts/generated/content-catalog.json");
  const bytes = readFileSync(fileURLToPath(url));
  const catalogSha256 = createHash("sha256").update(bytes).digest("hex");
  if (catalogSha256 !== EXPECTED_PROPOSAL_CATALOG_SHA256) {
    throw new Error("content_contract_catalog_hash_mismatch");
  }
  const catalog = JSON.parse(bytes.toString("utf8")) as VerifiedGeneratedContentCatalog;
  if (
    catalog.contractSourceHash !== "8932c7d94b89a764293c2a8913b7d30bde54319a3b6b3f7b3ff0128880628117"
    || catalog.proposalContracts.requestVersion !== "content-proposal-request.v2"
    || catalog.proposalContracts.baseInputVersion !== "proposal-base-input.v2"
    || catalog.proposalContracts.outputVersion !== "content-proposal.v2"
    || catalog.proposalContracts.promptVersion !== "proposal.writer.v2"
    || catalog.proposalContracts.outputSchemaSha256 !== "54bf063cf32926874af6b098272df08d41a9e7d7f578ee6560debe44428cf5f3"
    || catalog.researchEvidence.version !== "research-evidence.v1"
  ) {
    throw new Error("content_contract_catalog_invalid");
  }
  return catalog;
}

export interface ProposalV2Repository {
  findCommittedReplay(identity: ProposalV2ReplayIdentity): Promise<ProposalV2CreationResult | null>;
  withTransaction<T>(work: (tx: ProposalV2Transaction) => Promise<T>): Promise<T>;
  lockIdempotencyKey(tx: ProposalV2Transaction, identity: ProposalV2ReplayIdentity): Promise<void>;
  findReplay(
    tx: ProposalV2Transaction,
    identity: ProposalV2ReplayIdentity,
  ): Promise<ProposalV2CreationResult | null>;
  enqueue(tx: ProposalV2Transaction, input: EnqueueProposalV2Input): Promise<ProposalV2CreationResult>;
}

function mapProposalV2CreationResult(
  row: Record<string, unknown>,
  disposition: ProposalV2CreationResult["disposition"],
): ProposalV2CreationResult {
  return {
    disposition,
    proposalRunId: row.proposal_run_id ? String(row.proposal_run_id) : null,
    proposalBatchId: String(row.id),
    status: "proposal_pending",
  };
}

async function findProposalV2Replay(
  database: Pick<Pool | PoolClient, "query">,
  identity: ProposalV2ReplayIdentity,
  lock: boolean,
): Promise<ProposalV2CreationResult | null> {
  const result = await database.query(
    `select batch.*,run.id proposal_run_id,
            batch.created_by_user_id is not distinct from $4::uuid actor_matches,
            batch.input_snapshot_json->>'replayFingerprint' = $5 request_fingerprint_matches
       from ai_content_proposal_batches batch
       left join automated_content_proposal_runs run
         on run.proposal_batch_id=batch.id
        and run.workspace_id=batch.workspace_id and run.brand_id=batch.brand_id
      where batch.workspace_id=$1 and batch.brand_id=$2 and batch.idempotency_key=$3
      ${lock ? "for update of batch" : ""}`,
    [
      identity.workspaceId,
      identity.brandId,
      identity.idempotencyKey,
      identity.actorUserId,
      identity.replayFingerprint,
    ],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0] as Record<string, unknown>;
  if (row.actor_matches !== true || row.request_fingerprint_matches !== true) {
    throw new Error("ai_content_proposal_batch_conflict");
  }
  return mapProposalV2CreationResult(row, "replayed");
}

export function createAiContentProposalV2Repository(pool: Pool): ProposalV2Repository {
  const catalog = loadProposalCatalog();
  const commandDescriptorSha256 = proposalSha256({
    runner: "codex-exec",
    model: PROPOSAL_MODEL_ID,
    promptVersion: catalog.proposalContracts.promptVersion,
    outputSchemaSha256: catalog.proposalContracts.outputSchemaSha256,
    requestContractVersion: catalog.proposalContracts.requestVersion,
    baseInputContractVersion: catalog.proposalContracts.baseInputVersion,
    researchContractVersion: catalog.researchEvidence.version,
    proposalContractVersion: catalog.proposalContracts.outputVersion,
  });
  return {
    findCommittedReplay(identity) {
      return findProposalV2Replay(pool, identity, false);
    },
    async withTransaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assertAiContentWritable(client);
        const result = await work(client as ProposalV2Transaction);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async lockIdempotencyKey(tx, identity) {
      await tx.query(
        "select pg_advisory_xact_lock(hashtextextended($1,0))",
        [`proposal-v2:${identity.workspaceId}:${identity.brandId}:${identity.idempotencyKey}`],
      );
    },
    findReplay(tx, identity) {
      return findProposalV2Replay(tx, identity, true);
    },
    async enqueue(tx, input) {
      if (input.actorUserId !== null) {
        await assertActiveAiContentActor(tx, {
          workspaceId: input.workspaceId,
          brandId: input.brandId,
          actorUserId: input.actorUserId,
        });
      }
      const workerRequestJson = canonicalProposalJson(input.workerRequest);
      const baseInputJson = canonicalProposalJson(input.baseInput);
      const inputSnapshotJson = canonicalProposalJson({
        replayFingerprint: input.replayFingerprint,
        baseInput: input.baseInput,
        resumeInput: input.request,
      });
      const requestSha256 = proposalSha256(input.workerRequest);
      const baseInputSha256 = proposalSha256(input.baseInput);
      const created = await tx.query(
        `insert into ai_content_proposal_batches(
           workspace_id,brand_id,origin,purpose,request_json,source_snapshot_json,
           input_snapshot_json,status,idempotency_key,created_by_user_id
         ) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'queued',$8,$9::uuid)
         on conflict(workspace_id,brand_id,idempotency_key) do nothing
         returning *`,
        [
          input.workspaceId,
          input.brandId,
          input.source === "scheduled_crawl" ? "scheduled_crawl" : "manual",
          input.request.purpose,
          workerRequestJson,
          canonicalProposalJson(input.sourceSnapshots),
          inputSnapshotJson,
          input.idempotencyKey,
          input.actorUserId,
        ],
      );
      const batch = created.rows[0] as Record<string, unknown> | undefined;
      if (!batch) {
        const replay = await findProposalV2Replay(tx, input, true);
        if (!replay) throw new Error("ai_content_proposal_batch_conflict");
        return replay;
      }
      const jobResult = await tx.query(
        `insert into ai_content_proposal_jobs(workspace_id,brand_id,batch_id,status)
         values($1,$2,$3,'queued') returning id`,
        [input.workspaceId, input.brandId, batch.id],
      );
      const jobId = String(jobResult.rows[0]?.id ?? "");
      if (!jobId) throw new Error("ai_content_proposal_job_insert_failed");
      const enqueueContractSha256 = proposalSha256({
        jobId,
        batchId: String(batch.id),
        workspaceId: input.workspaceId,
        brandId: input.brandId,
        requestSha256,
        baseInputSha256,
        commandDescriptorSha256,
        contractSourceSha256: catalog.contractSourceHash,
        catalogSha256: EXPECTED_PROPOSAL_CATALOG_SHA256,
      });
      const contractResult = await tx.query<{ id: string }>(
        `insert into ai_content_proposal_job_contracts(
           job_id,batch_id,workspace_id,brand_id,request_contract_version,
           base_input_contract_version,research_contract_version,proposal_contract_version,
           proposal_prompt_version,proposal_output_schema_sha256,proposal_model_id,
           command_descriptor_sha256,request_sha256,base_input_sha256,
           contract_source_sha256,catalog_sha256,enqueue_contract_sha256
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         returning id`,
        [
          jobId,
          batch.id,
          input.workspaceId,
          input.brandId,
          catalog.proposalContracts.requestVersion,
          catalog.proposalContracts.baseInputVersion,
          catalog.researchEvidence.version,
          catalog.proposalContracts.outputVersion,
          catalog.proposalContracts.promptVersion,
          catalog.proposalContracts.outputSchemaSha256,
          PROPOSAL_MODEL_ID,
          commandDescriptorSha256,
          requestSha256,
          baseInputSha256,
          catalog.contractSourceHash,
          EXPECTED_PROPOSAL_CATALOG_SHA256,
          enqueueContractSha256,
        ],
      );
      const contractId = String(contractResult.rows[0]?.id ?? "");
      if (!contractId) throw new Error("ai_content_proposal_job_contract_insert_failed");
      if (input.performanceAudit) {
        const audit = input.performanceAudit;
        if ((audit.researchEvidence === null) !== (audit.composedInput === null)) {
          throw new Error("ai_content_proposal_performance_composition_invalid");
        }
        if (audit.researchEvidence && audit.composedInput) {
          const { contractVersion: _contractVersion, ...baseFields } = input.baseInput;
          const expectedComposition = parseProposalInputSnapshotV2({
            ...baseFields,
            contractVersion: "proposal-input.v2",
            researchEvidence: audit.researchEvidence,
          });
          if (canonicalProposalJson(expectedComposition) !== canonicalProposalJson(audit.composedInput)) {
            throw new Error("ai_content_proposal_performance_composition_mismatch");
          }
        }
        const snapshotAuditJson = canonicalProposalJson(audit.snapshotAudit);
        const auditResult = await tx.query<{ id: string }>(
          `insert into ai_content_proposal_performance_audits(
             workspace_id,brand_id,batch_id,experiment_id,experiment_definition_json,
             evidence_version,resolved_input_fingerprint_sha256,snapshot_audit_json,
             captured_from,captured_to
           ) values($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9::timestamptz,$10::timestamptz)
           returning id`,
          [
            input.workspaceId,
            input.brandId,
            batch.id,
            audit.experimentId,
            canonicalProposalJson(audit.experimentDefinition),
            audit.evidenceVersion,
            audit.resolvedInputFingerprint,
            snapshotAuditJson,
            audit.capturedFrom,
            audit.capturedTo,
          ],
        );
        const auditId = String(auditResult.rows[0]?.id ?? "");
        if (!auditId) throw new Error("ai_content_proposal_performance_audit_insert_failed");
        if (audit.researchEvidence) {
          await tx.query(
            `insert into ai_content_proposal_research_snapshots(
               workspace_id,brand_id,batch_id,evidence_json
             ) values($1,$2,$3,$4::jsonb)`,
            [
              input.workspaceId,
              input.brandId,
              batch.id,
              canonicalProposalJson(audit.researchEvidence),
            ],
          );
        }
        if (audit.composedInput) {
          const composedInputJson = canonicalProposalJson(audit.composedInput);
          await tx.query(
            `insert into ai_content_proposal_compositions(
               job_id,batch_id,contract_id,performance_audit_id,workspace_id,brand_id,
               research_evidence_json,research_evidence_set_sha256,composed_input_json,
               composed_input_sha256,final_invocation_aggregate_sha256
             ) values(
               $1,$2,$3,$4,$5,$6,
               jsonb_build_array($7::jsonb),
               encode(digest(convert_to(jsonb_build_array($7::jsonb)::text,'UTF8'),'sha256'),'hex'),
               $8::jsonb,encode(digest(convert_to(($8::jsonb)::text,'UTF8'),'sha256'),'hex'),$9
             )`,
            [
              jobId,
              batch.id,
              contractId,
              auditId,
              input.workspaceId,
              input.brandId,
              snapshotAuditJson,
              composedInputJson,
              proposalSha256({
                source: "performance_experiment",
                auditId,
                resolvedInputFingerprint: audit.resolvedInputFingerprint,
              }),
            ],
          );
        }
      }
      return {
        disposition: "created",
        proposalRunId: input.proposalRunId,
        proposalBatchId: String(batch.id),
        status: "proposal_pending",
      };
    },
  };
}

const aiContentReferenceSeedFormats = new Set<ContentOutputFormatV2>([
  "card_news",
  "blog",
  "reel",
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
  const workerRequest = object(row.request_json);
  const v2 = workerRequest.contractVersion === "content-proposal-request.v2";
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
  const baseInput = v2 ? object(inputSnapshot.baseInput) : inputSnapshot;
  let resumeInput: CanonicalContentOrchestrationV2 | undefined;
  if (v2) {
    try {
      resumeInput = parseCanonicalContentOrchestrationV2(inputSnapshot.resumeInput);
    } catch {
      throw new Error("ai_content_proposal_resume_input_invalid");
    }
  }
  const selectedReferences = Array.isArray(baseInput.references)
    ? baseInput.references.flatMap((value) => {
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
  const provenance = typeof row.performance_experiment_id === "string"
    && typeof row.performance_evidence_version === "string"
    && row.performance_captured_from
    && row.performance_captured_to
    ? {
        kind: "performance_experiment" as const,
        experimentId: row.performance_experiment_id,
        evidenceVersion: row.performance_evidence_version,
        snapshotCount: Number(row.performance_snapshot_count ?? 0),
        capturedFrom: iso(row.performance_captured_from as Date | string)!,
        capturedTo: iso(row.performance_captured_to as Date | string)!,
      }
    : undefined;
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    origin: row.origin as AiContentProposalBatchRecord["origin"],
    contentFamily: row.purpose as AiContentProposalBatchRecord["contentFamily"],
    request: v2 ? resumeInput as unknown as Record<string, unknown> : workerRequest,
    ...(resumeInput ? { resumeInput } : {}),
    sourceSnapshots: !v2 && Array.isArray(row.source_snapshot_json)
      ? row.source_snapshot_json as Record<string, unknown>[]
      : [],
    status: row.status as AiContentProposalBatchRecord["status"],
    ...(Array.isArray(row.proposals)
      ? { proposals: (row.proposals as Record<string, unknown>[]).map(mapProposal) }
      : {}),
    ...(v2 && row.evidence_json && !provenance ? { researchEvidence: { items: evidenceItems } } : {}),
    ...(provenance ? { provenance } : {}),
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
  const outputFormat = String(row.output_format) as ContentStudioOutputFormat;
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), brandId: String(row.brand_id),
    outputFormat,
    purpose: String(row.purpose) as ContentPurpose,
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
  return manifest.version === "ai-content.v3" ? "ai-content.v3" : null;
}

function mapOutput(row: Record<string, unknown>): AiContentOutputRecord {
  const manifest = object(row.artifact_manifest_json);
  const manifestVersion = normalizedOutputManifestVersion(manifest);
  const legacyReadOnly = manifestVersion !== "ai-content.v3";
  const revisionCapabilities: AiContentOutputRecord["revisionCapabilities"] = [];
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
        title: String(snapshot.title ?? snapshot.caption ?? snapshot.sourceUrl ?? snapshot.url ?? reference.reference_id),
        url: snapshot.sourceUrl
          ? String(snapshot.sourceUrl)
          : snapshot.url
            ? String(snapshot.url)
            : snapshot.permalink
              ? String(snapshot.permalink)
              : null,
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
        title: String(reference.title ?? reference.sourceUrl ?? reference.url ?? id),
        url: typeof reference.sourceUrl === "string"
          ? reference.sourceUrl
          : typeof reference.url === "string"
            ? reference.url
            : null,
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
    `select id, workspace_id, brand_id, output_format, purpose, title, status, current_stage, draft_json, analysis_json,
            generation_idempotency_key, operation_id, subject_analysis_snapshot, generation_input_snapshot, attachments_locked_at,
            subject_mode, product_service_id, orchestration_snapshot, avatar_snapshot,
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
       select reference_filter.id, jsonb_build_object('source', 'brand_output', 'title', co.title, 'outputJson', co.output_json) as snapshot
         from reference_items reference_filter
         join channel_outputs co
           on co.id = reference_filter.channel_output_id
          and co.workspace_id = reference_filter.workspace_id
          and co.brand_id = reference_filter.brand_id
        where reference_filter.workspace_id = $1 and reference_filter.brand_id = $2
          and reference_filter.archived_at is null
       union all
       select reference_filter.id, jsonb_build_object(
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
         from reference_items reference_filter
         join brand_trend_saved_media saved
           on saved.id = reference_filter.saved_trend_id
          and saved.workspace_id = reference_filter.workspace_id
          and saved.brand_id = reference_filter.brand_id
         join instagram_trend_media media on media.id = saved.trend_media_id
        where reference_filter.workspace_id = $1 and reference_filter.brand_id = $2
          and reference_filter.archived_at is null
       union all
       select reference_filter.id, jsonb_build_object('source', 'saved_url', 'url', source.url, 'title', source.title) as snapshot
         from reference_items reference_filter
         join source_urls source
           on source.id = reference_filter.source_url_id
          and source.workspace_id = reference_filter.workspace_id
          and source.brand_id = reference_filter.brand_id
        where reference_filter.workspace_id = $1 and reference_filter.brand_id = $2
          and reference_filter.archived_at is null and source.deleted_at is null
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
    outputFormat: row.output_format as ContentStudioOutputFormat,
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
    `select id, workspace_id, brand_id, output_format, purpose, title, status, current_stage, draft_json, analysis_json,
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


async function loadAiContentFixedInputSource(input: {
  client: Queryable;
  catalog: VerifiedGeneratedContentCatalog;
  snapshots: AiContentSnapshotRepository;
  startedAt: string;
  scope: AuthenticatedBrandScope;
  generation: Record<string, unknown>;
  batch: Record<string, unknown>;
  selection: Record<string, unknown>;
  finalization: ContentFinalizationDraftV2;
}): Promise<AiContentFixedInputSource> {
  const { client, scope, generation, batch, selection, finalization, snapshots } = input;
  const batchInputSnapshot = object(batch.input_snapshot_json);
  if (!isDeepStrictEqual(Object.keys(batchInputSnapshot).sort(), [
    "baseInput", "replayFingerprint", "resumeInput",
  ])) throw new Error("fixed_input_batch_contract_invalid");
  const baseInput = parseCanonicalProposalBaseInputSnapshotV2(batchInputSnapshot.baseInput);
  const proposalId = String(selection.id);
  const batchId = String(batch.id);
  const generationId = String(generation.id);
  const proposalJobId = String(selection.successful_proposal_job_id ?? "");
  const successfulAttemptId = String(selection.successful_model_attempt_id ?? "");
  const finalInvocationOrdinal = Number(selection.final_invocation_ordinal);
  if (!proposalJobId || !successfulAttemptId || ![1, 2].includes(finalInvocationOrdinal)) {
    throw new Error("fixed_input_success_lineage_mismatch");
  }

  const lineageResult = await client.query(
    `select job.id job_id,job.batch_id,job.status job_status,
            contract.id contract_id,contract.request_contract_version,
            contract.base_input_contract_version,contract.research_contract_version,
            contract.proposal_contract_version,contract.proposal_prompt_version,
            contract.proposal_output_schema_sha256,contract.proposal_model_id,
            contract.command_descriptor_sha256,contract.request_sha256,contract.base_input_sha256,
            contract.contract_source_sha256,contract.catalog_sha256,contract.enqueue_contract_sha256,
            composition.id composition_id,composition.composed_input_json,
            composition.research_evidence_set_sha256,composition.composed_input_sha256,
            composition.research_evidence_set_sha256=encode(
              digest(composition.research_evidence_json::text,'sha256'),'hex'
            ) research_evidence_set_hash_matches,
            composition.composed_input_sha256=encode(
              digest(composition.composed_input_json::text,'sha256'),'hex'
            ) composed_input_hash_matches,
            composition.final_invocation_aggregate_sha256,
            attempt.id attempt_id,attempt.composition_id,attempt.aggregate_contract_sha256,
            attempt.model_id,attempt.model_sha256,attempt.command_descriptor_sha256 attempt_command_sha256,
            attempt.proposal_output_schema_sha256 attempt_schema_sha256,
            attempt.composed_input_sha256 attempt_composed_sha256,
            event.event_type,event.invocation_ordinal,event.aggregate_contract_sha256 event_aggregate_sha256,
            event.model_sha256 event_model_sha256,event.command_descriptor_sha256 event_command_sha256,
            event.proposal_output_schema_sha256 event_schema_sha256,
            event.composed_input_sha256 event_composed_sha256,event.output_sha256,event.parser_sha256,
            event.parser_valid,research.evidence_json
       from ai_content_proposal_jobs job
       join ai_content_proposal_job_contracts contract
         on contract.job_id=job.id and contract.workspace_id=job.workspace_id and contract.brand_id=job.brand_id
       join ai_content_proposal_compositions composition
         on composition.job_id=job.id and composition.contract_id=contract.id
        and composition.workspace_id=job.workspace_id and composition.brand_id=job.brand_id
       join ai_content_proposal_model_attempts attempt
         on attempt.id=$5 and attempt.job_id=job.id and attempt.contract_id=contract.id
        and attempt.workspace_id=job.workspace_id and attempt.brand_id=job.brand_id
       join ai_content_proposal_attempt_events event
         on event.model_attempt_id=attempt.id and event.job_id=job.id
        and event.workspace_id=job.workspace_id and event.brand_id=job.brand_id
        and event.event_type='attempt_succeeded' and event.invocation_ordinal=$6
        and event.parser_valid is true
       join ai_content_proposal_research_snapshots research
         on research.batch_id=job.batch_id and research.workspace_id=job.workspace_id
        and research.brand_id=job.brand_id
      where job.id=$4 and job.batch_id=$1 and job.workspace_id=$2 and job.brand_id=$3
        and job.status='completed'`,
    [batchId, scope.workspaceId, scope.brandId, proposalJobId, successfulAttemptId, finalInvocationOrdinal],
  );
  if (lineageResult.rows.length !== 1) throw new Error("fixed_input_success_lineage_mismatch");
  const lineage = lineageResult.rows[0] as Record<string, unknown>;
  const composedInput = object(lineage.composed_input_json);
  const composedEvidence = object(composedInput.researchEvidence);
  if (!isDeepStrictEqual(lineage.evidence_json, composedEvidence)) {
    throw new Error("fixed_input_evidence_mismatch");
  }

  const referenceIds = baseInput.references.map(({ referenceItemId }) => referenceItemId);
  const referenceSnapshotIds = baseInput.references.map(({ snapshotId }) => snapshotId);
  const lockedSources = await client.query(
    `select lock_ai_content_fixed_input_sources(
       $1,$2,$3,$4,$5,$6::uuid[],$7::uuid[]
     ) locked`,
    [scope.workspaceId, scope.brandId, baseInput.brandCore.versionId,
      baseInput.product?.id ?? null, baseInput.product?.versionId ?? null,
      referenceIds, referenceSnapshotIds],
  );
  if (lockedSources.rows[0]?.locked !== true) throw new Error("fixed_input_source_lock_failed");

  const coreResult = await client.query(
    `select id,status from brand_core_versions
      where id=$3 and workspace_id=$1 and brand_id=$2 and status='approved'`,
    [scope.workspaceId, scope.brandId, baseInput.brandCore.versionId],
  );
  if (coreResult.rows.length !== 1) throw new Error("fixed_input_brand_core_unavailable");

  if (baseInput.product !== null) {
    const productResult = await client.query(
      `select item.id
         from product_services item
         join product_service_versions version
           on version.id=$4 and version.product_service_id=item.id
          and version.workspace_id=item.workspace_id and version.brand_id=item.brand_id
          and version.status='approved'
         where item.id=$3 and item.workspace_id=$1 and item.brand_id=$2 and item.status='active'`,
      [scope.workspaceId, scope.brandId, baseInput.product.id, baseInput.product.versionId],
    );
    if (productResult.rows.length !== 1) throw new Error("fixed_input_product_unavailable");
  }

  if (referenceIds.length > 0) {
    const referencesResult = await client.query(
      `select requested.reference_item_id
         from unnest($3::uuid[],$4::uuid[]) with ordinality
              requested(reference_item_id,snapshot_id,position)
         join reference_items item
           on item.id=requested.reference_item_id and item.workspace_id=$1 and item.brand_id=$2
          and item.archived_at is null
         join reference_snapshots snapshot
           on snapshot.id=requested.snapshot_id and snapshot.reference_item_id=item.id
          and snapshot.workspace_id=item.workspace_id and snapshot.brand_id=item.brand_id
        where snapshot.snapshot_json #>> '{permittedUse,modelInput}'='true'
          and snapshot.snapshot_json #>> '{permittedUse,derivativeInspiration}'='true'
        order by requested.position`,
      [scope.workspaceId, scope.brandId, referenceIds, referenceSnapshotIds],
    );
    if (referencesResult.rows.length !== referenceIds.length) {
      throw new Error("fixed_input_reference_unavailable");
    }
  }

  const rulesResult = await client.query(
    `select rules.id,rules.version,rules.status,rules.rules_json
       from brand_profiles profile
       join brand_rule_sets rules
         on rules.id=profile.active_brand_rule_set_id
        and rules.workspace_id=profile.workspace_id and rules.brand_id=profile.brand_id
        and rules.status='approved'
      where profile.workspace_id=$1 and profile.brand_id=$2`,
    [scope.workspaceId, scope.brandId],
  );
  if (rulesResult.rows.length !== 1) throw new Error("ai_content_brand_rules_required");
  const rules = rulesResult.rows[0] as Record<string, unknown>;
  let canonicalRules;
  try {
    canonicalRules = parseBrandRulesContentV1(rules.rules_json);
  } catch {
    throw new Error("ai_content_brand_rules_required");
  }
  const styleResult = await client.query(
    `select item.id reference_item_id,style.image->>'description' description,
            style.image->'tags' tags,artifact.public_url storage_url,artifact.path storage_path,
            lower(artifact.mime_type) mime_type,artifact.checksum
       from jsonb_array_elements(coalesce($3::jsonb #> '{designRules,referenceImages}','[]'::jsonb))
            with ordinality style(image,position)
       join reference_items item
         on item.id::text=style.image->>'referenceItemId'
        and item.workspace_id=$1 and item.brand_id=$2 and item.kind='upload' and item.archived_at is null
       join storage_artifacts artifact
         on artifact.id=item.storage_artifact_id and artifact.workspace_id=item.workspace_id
        and artifact.brand_id=item.brand_id and artifact.deleted_at is null
        and artifact.public_url is not null and artifact.path is not null
        and artifact.checksum ~ '^[0-9a-f]{64}$'
        and lower(artifact.mime_type) in ('image/png','image/jpeg','image/webp')
      order by style.position`,
    [scope.workspaceId, scope.brandId, JSON.stringify(canonicalRules)],
  );
  const configuredStyleCount = canonicalRules.designRules.referenceImages.length;
  if (styleResult.rows.length !== configuredStyleCount) {
    throw new Error("ai_content_brand_style_required");
  }
  const styleImages = configuredStyleCount === 0
    ? []
    : await snapshots.loadApprovedStyleImages({
      workspaceId: scope.workspaceId,
      brandId: scope.brandId,
    }, client);
  if (styleImages.length !== styleResult.rows.length
    || styleImages.some((image, index) => (
      image.referenceItemId !== String(styleResult.rows[index]?.reference_item_id ?? "")
    ))) {
    throw new Error("ai_content_brand_style_required");
  }

  const attachmentResult = finalization.attachmentIds.length === 0
    ? { rows: [] as Record<string, unknown>[] }
    : await client.query(
      `select attachment.id,attachment.role,attachment.file_name,lower(attachment.mime_type) mime_type,
              attachment.size_bytes,attachment.checksum,attachment.storage_url,attachment.storage_path
         from unnest($4::uuid[]) with ordinality requested(id,position)
         join ai_content_generation_attachments attachment
           on attachment.id=requested.id and attachment.generation_id=$1
          and attachment.workspace_id=$2 and attachment.brand_id=$3 and attachment.deleted_at is null
         join ai_content_attachment_upload_sessions upload
           on upload.id=attachment.upload_session_id and upload.workspace_id=attachment.workspace_id
          and upload.brand_id=attachment.brand_id and upload.generation_id=attachment.generation_id
          and upload.status='confirmed' and upload.confirmed_attachment_id=attachment.id
        where attachment.role in ('product_image','visual_reference','supporting_image')
          and lower(attachment.mime_type) in ('image/png','image/jpeg','image/webp')
        order by requested.position
        for update of attachment,upload`,
      [generationId, scope.workspaceId, scope.brandId, finalization.attachmentIds],
    );
  if (attachmentResult.rows.length !== finalization.attachmentIds.length) {
    throw new Error("fixed_input_attachment_unavailable");
  }
  const attachments = attachmentResult.rows.map((row) => ({
    id: String(row.id), role: String(row.role) as "product_image" | "visual_reference" | "supporting_image",
    fileName: String(row.file_name), mimeType: String(row.mime_type) as "image/png" | "image/jpeg" | "image/webp",
    sizeBytes: Number(row.size_bytes), checksum: String(row.checksum),
    storageUrl: String(row.storage_url), storagePath: String(row.storage_path),
  }));

  return {
    catalog: input.catalog,
    catalogSha256: EXPECTED_PROPOSAL_CATALOG_SHA256,
    startedAt: input.startedAt,
    scope: {
      workspaceId: scope.workspaceId,
      brandId: scope.brandId,
      actorUserId: scope.actorUserId,
    },
    draft: {
      workspaceId: scope.workspaceId, brandId: scope.brandId, generationId,
      status: "draft", deletedAt: null, origin: "proposal-v2", proposalBatchId: batchId,
      proposalId, outputFormat: String(generation.output_format) as AiContentFixedInputSource["draft"]["outputFormat"],
      purpose: String(generation.purpose) as AiContentFixedInputSource["draft"]["purpose"],
      userImageInstruction: finalization.userImageInstruction,
      brandStyleImageIds: styleImages.map(({ referenceItemId }) => referenceItemId),
      avatarStyleImageId: finalization.avatarStyleImageId,
      attachmentIds: [...finalization.attachmentIds],
    },
    batch: {
      workspaceId: scope.workspaceId, brandId: scope.brandId, id: batchId,
      status: "ready", deletedAt: null, baseInput,
    },
    selection: {
      workspaceId: scope.workspaceId, brandId: scope.brandId, id: proposalId, batchId,
      generationId, status: "selected", deletedAt: null,
      proposal: selection.proposal_json as AiContentFixedInputSource["selection"]["proposal"],
      successfulModelAttemptId: successfulAttemptId,
      successfulProposalJobId: proposalJobId,
      finalInvocationOrdinal: finalInvocationOrdinal as 1 | 2,
    },
    proposalJob: {
      workspaceId: scope.workspaceId, brandId: scope.brandId, id: proposalJobId,
      contractId: String(lineage.contract_id), batchId, status: "completed",
      request: batch.request_json as AiContentFixedInputSource["proposalJob"]["request"],
      requestContractVersion: String(lineage.request_contract_version),
      baseInputContractVersion: String(lineage.base_input_contract_version),
      researchContractVersion: String(lineage.research_contract_version),
      proposalContractVersion: String(lineage.proposal_contract_version),
      proposalPromptVersion: String(lineage.proposal_prompt_version),
      proposalOutputSchemaSha256: String(lineage.proposal_output_schema_sha256),
      proposalModelId: String(lineage.proposal_model_id),
      commandDescriptorSha256: String(lineage.command_descriptor_sha256),
      requestSha256: String(lineage.request_sha256), baseInputSha256: String(lineage.base_input_sha256),
      contractSourceSha256: String(lineage.contract_source_sha256),
      catalogSha256: String(lineage.catalog_sha256), enqueueContractSha256: String(lineage.enqueue_contract_sha256),
    },
    composition: {
      workspaceId: scope.workspaceId, brandId: scope.brandId, id: String(lineage.composition_id),
      jobId: proposalJobId, contractId: String(lineage.contract_id), batchId,
      composedInput: lineage.composed_input_json as AiContentFixedInputSource["composition"]["composedInput"],
      researchEvidenceSetSha256: String(lineage.research_evidence_set_sha256),
      researchEvidenceSetHashMatches: lineage.research_evidence_set_hash_matches === true,
      composedInputSha256: String(lineage.composed_input_sha256),
      composedInputHashMatches: lineage.composed_input_hash_matches === true,
      finalInvocationAggregateSha256: String(lineage.final_invocation_aggregate_sha256),
    },
    successfulAttempt: {
      workspaceId: scope.workspaceId, brandId: scope.brandId, id: successfulAttemptId,
      jobId: proposalJobId, contractId: String(lineage.contract_id), compositionId: String(lineage.composition_id),
      aggregateContractSha256: String(lineage.aggregate_contract_sha256), modelId: String(lineage.model_id),
      modelSha256: String(lineage.model_sha256), commandDescriptorSha256: String(lineage.attempt_command_sha256),
      proposalOutputSchemaSha256: String(lineage.attempt_schema_sha256),
      composedInputSha256: String(lineage.attempt_composed_sha256),
    },
    successEvent: {
      workspaceId: scope.workspaceId, brandId: scope.brandId, modelAttemptId: successfulAttemptId,
      jobId: proposalJobId, eventType: "attempt_succeeded",
      invocationOrdinal: finalInvocationOrdinal as 1 | 2,
      aggregateContractSha256: String(lineage.event_aggregate_sha256), modelSha256: String(lineage.event_model_sha256),
      commandDescriptorSha256: String(lineage.event_command_sha256),
      proposalOutputSchemaSha256: String(lineage.event_schema_sha256),
      composedInputSha256: String(lineage.event_composed_sha256), outputSha256: String(lineage.output_sha256),
      parserSha256: String(lineage.parser_sha256), parserValid: true,
    } as AiContentFixedInputSource["successEvent"],
    approvedBrandCore: {
      workspaceId: scope.workspaceId, brandId: scope.brandId,
      status: "approved", deletedAt: null, snapshot: baseInput.brandCore,
    },
    approvedBrandRules: {
      workspaceId: scope.workspaceId, brandId: scope.brandId, versionId: String(rules.id),
      version: Number(rules.version), status: "approved", deletedAt: null,
      content: canonicalRules,
      contentSha256: proposalSha256(canonicalRules),
    },
    approvedProduct: baseInput.product === null ? null : {
      workspaceId: scope.workspaceId, brandId: scope.brandId,
      status: "approved", deletedAt: null, snapshot: baseInput.product,
    },
    evidence: (Array.isArray(object(composedInput.researchEvidence).items)
      ? object(composedInput.researchEvidence).items as unknown[] : []).map((snapshot) => ({
      workspaceId: scope.workspaceId, brandId: scope.brandId, proposalBatchId: batchId,
      status: "frozen" as const, deletedAt: null, snapshot: snapshot as AiContentFixedInputSource["evidence"][number]["snapshot"],
    })),
    references: baseInput.references.map((snapshot) => ({
      workspaceId: scope.workspaceId, brandId: scope.brandId, proposalBatchId: batchId,
      status: "approved" as const, deletedAt: null, snapshot,
    })),
    brandStyleImages: styleImages.map((snapshot) => ({
      workspaceId: scope.workspaceId, brandId: scope.brandId, ruleSetVersionId: String(rules.id),
      status: "approved" as const, deletedAt: null, snapshot,
    })),
    attachments: attachments.map((snapshot) => ({
      workspaceId: scope.workspaceId, brandId: scope.brandId, generationId,
      status: "finalized" as const, deletedAt: null, snapshot,
    })),
  };
}

async function startAiContentGenerationV3Transaction(input: {
  pool: Pool;
  catalog: VerifiedGeneratedContentCatalog;
  snapshots: AiContentSnapshotRepository;
  command: BrandGenerationScope & AuthenticatedBrandScope & ContentGenerationStartV2 & {
    usageDate: string;
    dailyGenerationLimit: number;
  };
  now: () => Date;
}): Promise<AiContentGenerationRecord> {
  const { pool, catalog, snapshots, command, now } = input;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assertAiContentWritable(client);
    await assertActiveAiContentActor(client, command);

    const draftLookup = await scopedGeneration(client, command);
    if (!draftLookup) throw new Error("ai_content_generation_not_found");
    const draftLookupJson = object(draftLookup.draft_json);
    const proposalBatchId = String(draftLookupJson.proposalBatchId ?? "");
    const proposalId = String(draftLookupJson.proposalId ?? "");
    if (!proposalBatchId || !proposalId || draftLookupJson.origin !== "proposal-v2") {
      throw new Error("ai_content_generation_not_draft");
    }

    const batchResult = await client.query(
      `select id,workspace_id,brand_id,status,purpose,input_snapshot_json,request_json
         from ai_content_proposal_batches
        where id=$1 and workspace_id=$2 and brand_id=$3
        for update`,
      [proposalBatchId, command.workspaceId, command.brandId],
    );
    const batch = batchResult.rows[0] as Record<string, unknown> | undefined;
    const proposalResult = await client.query(
      `select id,batch_id,workspace_id,brand_id,status,generation_id,proposal_json,
              successful_model_attempt_id,successful_proposal_job_id,final_invocation_ordinal
         from ai_content_proposals
        where id=$1 and batch_id=$2 and workspace_id=$3 and brand_id=$4
        for update`,
      [proposalId, proposalBatchId, command.workspaceId, command.brandId],
    );
    const selection = proposalResult.rows[0] as Record<string, unknown> | undefined;
    const generation = await scopedGeneration(client, command, true);
    if (!batch || batch.status !== "ready" || !selection || selection.status !== "selected"
      || selection.generation_id !== command.generationId) {
      throw new Error("RESOURCE_NOT_AVAILABLE");
    }
    if (!generation) throw new Error("ai_content_generation_not_found");
    const generationDraft = object(generation.draft_json);
    if (!isDeepStrictEqual(Object.keys(generationDraft).sort(), [
      "finalization", "origin", "proposalBatchId", "proposalId",
    ]) || generationDraft.origin !== "proposal-v2"
      || generationDraft.proposalBatchId !== proposalBatchId
      || generationDraft.proposalId !== proposalId) {
      throw new Error("ai_content_generation_not_draft");
    }
    const finalization = parseContentFinalizationDraftV2(generationDraft.finalization);
    if (command.expectedFinalization
      && !isDeepStrictEqual(finalization, command.expectedFinalization)) {
      throw new Error("ai_content_finalization_changed");
    }
    const requestFingerprint = proposalSha256({
      generationId: command.generationId,
      contractVersion: command.contractVersion,
      workspaceId: command.workspaceId,
      brandId: command.brandId,
      proposalBatchId,
      proposalId,
      outputFormat: generation.output_format,
      purpose: generation.purpose,
      finalization,
    });

    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `ai-content-operation:${command.brandId}:${command.idempotencyKey}`,
    ]);
    const operationResult = await client.query(
      `select * from ai_content_generation_operations
        where brand_id=$1 and operation_key=$2
        for update`,
      [command.brandId, command.idempotencyKey],
    );
    const existingOperation = operationResult.rows[0] as Record<string, unknown> | undefined;
    if (existingOperation) {
      if (String(existingOperation.workspace_id) !== command.workspaceId
        || String(existingOperation.generation_id) !== command.generationId
        || String(existingOperation.request_fingerprint_sha256) !== requestFingerprint
        || String(generation.operation_id ?? "") !== String(existingOperation.id)
        || !["started", "completed", "failed", "reversed"].includes(String(existingOperation.status))) {
        throw new Error("ai_content_generation_start_conflict");
      }
      const replayGraph = await client.query(
        `select snapshot.input_json,snapshot.content_hash,binding.binding_json,binding.binding_sha256,
                binding.binding_sha256=encode(digest(binding.binding_json::text,'sha256'),'hex') binding_hash_matches,
                binding.selected_proposal_id,binding.proposal_job_id,
                binding.successful_model_attempt_id,binding.final_invocation_ordinal,
                binding.output_format,binding.purpose,binding.generation_input_version,
                reservation.id reservation_id,reservation.quantity,
                (select count(*)::integer from ai_content_generation_outputs output
                  where output.generation_id=$1) output_count,
                (select count(*)::integer from ai_content_generation_jobs job
                  where job.generation_id=$1 and job.job_type='generate'
                    and job.output_format=$4) job_count
           from ai_content_generation_input_snapshots snapshot
           join ai_content_generation_prompt_bindings binding
             on binding.generation_id=snapshot.generation_id
            and binding.workspace_id=snapshot.workspace_id and binding.brand_id=snapshot.brand_id
           join ai_content_usage_ledger reservation
             on reservation.operation_id=$5 and reservation.generation_id=snapshot.generation_id
            and reservation.usage_type='generation' and reservation.reservation_id=reservation.id
          where snapshot.generation_id=$1 and snapshot.workspace_id=$2 and snapshot.brand_id=$3`,
        [command.generationId, command.workspaceId, command.brandId, generation.output_format, existingOperation.id],
      );
      const replay = replayGraph.rows[0] as Record<string, unknown> | undefined;
      if (!replay || !isDeepStrictEqual(generation.generation_input_snapshot, replay.input_json)
        || proposalSha256(replay.input_json) !== replay.content_hash) {
        throw new Error("ai_content_generation_start_conflict");
      }
      let frozenInput: ReturnType<typeof parseCanonicalContentGenerationInputV3>;
      try {
        frozenInput = parseCanonicalContentGenerationInputV3(replay.input_json);
        const frozenBinding = parseContentPromptBinding(replay.binding_json);
        assertPlannerPromptBinding(frozenInput, frozenBinding);
      } catch {
        throw new Error("ai_content_generation_start_conflict");
      }
      const outputCount = frozenInput.outputSettings.outputCount;
      if (Number(replay.quantity) !== outputCount || Number(replay.output_count) !== outputCount
        || Number(replay.job_count) !== outputCount
        || replay.binding_hash_matches !== true
        || String(replay.selected_proposal_id) !== proposalId
        || String(replay.proposal_job_id) !== String(selection.successful_proposal_job_id)
        || String(replay.successful_model_attempt_id) !== String(selection.successful_model_attempt_id)
        || Number(replay.final_invocation_ordinal) !== Number(selection.final_invocation_ordinal)
        || String(replay.output_format) !== String(generation.output_format)
        || String(replay.purpose) !== String(generation.purpose)
        || String(replay.generation_input_version) !== frozenInput.contractVersion) {
        throw new Error("ai_content_generation_start_conflict");
      }
      await client.query("COMMIT");
      return mapGeneration(generation);
    }
    if (generation.operation_id !== null && generation.operation_id !== undefined) {
      throw new Error("ai_content_generation_start_conflict");
    }
    if (generation.generation_idempotency_key !== null
      || generation.generation_input_snapshot !== null
      || generation.attachments_locked_at !== null) {
      throw new Error("ai_content_generation_start_conflict");
    }
    if (generation.status !== "draft") throw new Error("ai_content_generation_not_draft");

    const startedAt = now().toISOString();
    const source = await loadAiContentFixedInputSource({
      client,
      catalog,
      snapshots,
      startedAt,
      scope: command,
      generation,
      batch,
      selection,
      finalization,
    });
    const assembly = assembleAiContentFixedInput(source);
    const outputCount = assembly.input.outputSettings.outputCount;

    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `ai-content-usage:${command.brandId}:${command.usageDate}`,
    ]);
    const usageResult = await client.query(
      `select coalesce(sum(quantity),0)::integer generation_count
         from ai_content_usage_ledger
        where workspace_id=$1 and brand_id=$2 and usage_date=$3::date
          and usage_type in ('generation','reversal')`,
      [command.workspaceId, command.brandId, command.usageDate],
    );
    if (Number(usageResult.rows[0]?.generation_count ?? 0) + outputCount > command.dailyGenerationLimit) {
      throw new Error("ai_content_limit_reached");
    }

    const operationId = randomUUID();
    const reservationId = randomUUID();
    await client.query(
      `insert into ai_content_generation_operations(
         id,workspace_id,brand_id,operation_key,request_fingerprint_sha256,generation_id,status
       ) values($1,$2,$3,$4,$5,$6,'reserved')`,
      [operationId, command.workspaceId, command.brandId, command.idempotencyKey,
        requestFingerprint, command.generationId],
    );
    await client.query(
      `insert into ai_content_usage_ledger(
         id,workspace_id,brand_id,generation_id,output_id,usage_type,quantity,usage_date,
         idempotency_key,operation_id,reservation_id,reversal_of_ledger_id
       ) values($1,$2,$3,$4,null,'generation',$5,$6::date,$7,$8,$1,null)`,
      [reservationId, command.workspaceId, command.brandId, command.generationId,
        outputCount, command.usageDate, `generation-reservation:${operationId}`, operationId],
    );
    await client.query(
      `insert into ai_content_generation_input_snapshots(
         id,workspace_id,brand_id,generation_id,input_json,content_hash
       ) values($1,$2,$3,$4,$5::jsonb,$6)`,
      [randomUUID(), command.workspaceId, command.brandId, command.generationId,
        assembly.canonicalJson, assembly.contentHash],
    );
    await client.query(
      `select create_ai_content_generation_prompt_binding($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [command.generationId, command.workspaceId, command.brandId,
        assembly.provenance.selectedProposalId, assembly.provenance.proposalJobId,
        assembly.provenance.proposalContractId, assembly.provenance.successfulModelAttemptId,
        JSON.stringify(assembly.binding)],
    );

    for (let outputIndex = 1; outputIndex <= outputCount; outputIndex += 1) {
      const outputId = randomUUID();
      await client.query(
        `insert into ai_content_generation_outputs(
           id,generation_id,workspace_id,brand_id,output_index,status
         ) values($1,$2,$3,$4,$5,'queued')`,
        [outputId, command.generationId, command.workspaceId, command.brandId, outputIndex],
      );
      if (assembly.input.outputSettings.outputFormat !== "blog") {
        await client.query(
          `insert into ai_content_output_research_snapshots(
             id,workspace_id,brand_id,generation_id,output_id,evidence_json
           ) values($1,$2,$3,$4,$5,$6::jsonb)`,
          [randomUUID(), command.workspaceId, command.brandId, command.generationId,
            outputId, JSON.stringify(assembly.input.researchEvidence)],
        );
      }
      await client.query(
        `insert into ai_content_generation_jobs(
           id,generation_id,output_id,workspace_id,brand_id,job_type,output_format,status,payload_json
         ) values($1,$2,$3,$4,$5,'generate',$6,'queued',$7::jsonb)`,
        [randomUUID(), command.generationId, outputId, command.workspaceId, command.brandId,
          assembly.input.outputSettings.outputFormat, JSON.stringify({
            generationId: command.generationId,
            outputId,
            contentGenerationInput: assembly.input,
            planningMode: "selected_proposal",
            operationId,
          })],
      );
    }

    const updatedResult = await client.query(
      `update ai_content_generations
          set status='queued',current_stage='generation',generation_idempotency_key=$4,
              operation_id=$5,generation_input_snapshot=$6::jsonb,
              attachments_locked_at=statement_timestamp(),updated_by_user_id=$7,updated_at=now()
        where id=$1 and workspace_id=$2 and brand_id=$3 and status='draft'
        returning id,workspace_id,brand_id,output_format,purpose,title,status,current_stage,
                  draft_json,analysis_json,generation_input_snapshot,operation_id,
                  attachments_locked_at,terminal_at,retryable_until,error_code,error_message,
                  created_at,updated_at,completed_at`,
      [command.generationId, command.workspaceId, command.brandId, command.idempotencyKey,
        operationId, assembly.canonicalJson, command.actorUserId],
    );
    if (updatedResult.rows.length !== 1) throw new Error("ai_content_generation_start_conflict");
    await client.query(
      "select transition_ai_content_generation_operation($1,'reserved','started')",
      [operationId],
    );
    await client.query("COMMIT");
    return mapGeneration(updatedResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function createAiContentRepository(pool: Pool, options: AiContentRepositoryOptions = {}): AiContentRepository {
  const fixedInputCatalog = loadProposalCatalog();
  const fencedPool = withAiContentTransactionFence(pool);
  const subjectRepository = createAiContentSubjectRepository(fencedPool);
  const attachmentLifecycle = createAiContentAttachmentRepository(fencedPool);
  const proposalJobs = createContentProposalJobsRepository(fencedPool);
  const renderJobs = createAiContentRenderJobsRepository(fencedPool, generationById);
  return {
    assertAiContentWritable: () => assertAiContentWritable(pool),
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


    async getAiContentProposalBatch(input) {
      const result = await pool.query(
        `select batch.*,research.evidence_json,
                performance.experiment_id::text performance_experiment_id,
                performance.evidence_version performance_evidence_version,
                coalesce(jsonb_array_length(performance.snapshot_audit_json->'snapshots'),0)
                  performance_snapshot_count,
                performance.captured_from performance_captured_from,
                performance.captured_to performance_captured_to,
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
           left join ai_content_proposal_performance_audits performance
             on performance.batch_id=batch.id
            and performance.workspace_id=batch.workspace_id
            and performance.brand_id=batch.brand_id
          where batch.id=$1 and batch.workspace_id=$2 and batch.brand_id=$3
          group by batch.id,research.evidence_json,performance.experiment_id,
                   performance.evidence_version,performance.snapshot_audit_json,
                   performance.captured_from,performance.captured_to`,
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
        await assertAiContentWritable(client);
        await assertActiveAiContentActor(client, input);
        await client.query(
          "select select_ai_content_proposal($1,$2,$3,$4) selected",
          [input.proposalId, input.workspaceId, input.brandId, input.actorUserId],
        );
        const selected = await client.query(
          `select proposal.id,proposal.batch_id,proposal.proposal_json,proposal.generation_id,
                  batch.purpose,batch.input_snapshot_json
             from ai_content_proposals proposal
             join ai_content_proposal_batches batch
               on batch.id=proposal.batch_id
              and batch.workspace_id=proposal.workspace_id
              and batch.brand_id=proposal.brand_id
            where proposal.id=$1 and proposal.workspace_id=$2 and proposal.brand_id=$3
            for update of proposal`,
          [input.proposalId, input.workspaceId, input.brandId],
        );
        const proposal = selected.rows[0] as Record<string, unknown> | undefined;
        if (!proposal) throw new Error("ai_content_proposal_not_found");
        const batchInputSnapshot = object(proposal.input_snapshot_json);
        if (!isDeepStrictEqual(Object.keys(batchInputSnapshot).sort(), [
          "baseInput", "replayFingerprint", "resumeInput",
        ]) || !/^[0-9a-f]{64}$/.test(String(batchInputSnapshot.replayFingerprint ?? ""))) {
          throw new Error("ai_content_proposal_selection_conflict");
        }
        const baseInput = parseCanonicalProposalBaseInputSnapshotV2(batchInputSnapshot.baseInput);
        const resumeInput = parseCanonicalContentOrchestrationV2(batchInputSnapshot.resumeInput);
        const proposalJson = object(proposal.proposal_json);
        const proposalId = String(proposal.id);
        const proposalBatchId = String(proposal.batch_id);
        const outputFormat = String(proposalJson.outputFormat) as ContentOutputFormatV2;
        const purpose = String(object(proposalJson.purposeDetails).kind) as ContentPurposeV2;
        if (proposalId !== input.proposalId
          || outputFormat !== baseInput.outputSettings.outputFormat
          || purpose !== baseInput.outputSettings.purpose
          || resumeInput.brandId !== input.brandId
          || resumeInput.outputSettings.outputFormat !== outputFormat
          || resumeInput.purpose !== purpose
          || purpose !== proposal.purpose) {
          throw new Error("ai_content_proposal_selection_conflict");
        }
        const expectedDraft = {
          origin: "proposal-v2",
          proposalBatchId,
          proposalId,
          finalization: {
            contractVersion: "content-finalization-draft.v2",
            avatarStyleImageId: null,
            userImageInstruction: null,
            attachmentIds: [],
          },
        };
        const selectionIdentity = `proposal-v2:${proposalBatchId}:${proposalId}:${input.idempotencyKey}`;
        if (proposal.generation_id) {
          const linked = await client.query(
            `select id,workspace_id,brand_id,output_format,purpose,title,status,current_stage,draft_json,analysis_json,
                    analysis_idempotency_key,attachments_locked_at,terminal_at,retryable_until,
                    error_code,error_message,created_at,updated_at,completed_at
               from ai_content_generations
              where id=$1 and workspace_id=$2 and brand_id=$3
              for update`,
            [proposal.generation_id, input.workspaceId, input.brandId],
          );
          const existing = linked.rows[0] as Record<string, unknown> | undefined;
          if (!existing
            || existing.status !== "draft"
            || existing.analysis_idempotency_key !== selectionIdentity
            || existing.output_format !== outputFormat
            || existing.purpose !== purpose
            || !isDeepStrictEqual(object(existing.draft_json), expectedDraft)) {
            throw new Error("ai_content_proposal_selection_conflict");
          }
          await client.query("COMMIT");
          return mapGeneration(existing);
        }
        const generationId = randomUUID();
        const created = await client.query(
          `insert into ai_content_generations (
             id,workspace_id,brand_id,title,status,current_stage,draft_json,
             analysis_json,analysis_idempotency_key,purpose,output_format,subject_mode,
             product_service_id,created_by_user_id,updated_by_user_id
           ) values ($1,$2,$3,$4,'draft','draft',$5::jsonb,'{}',$6,$7,$8,$9,$10,$11,$11)
           returning id,workspace_id,brand_id,output_format,purpose,title,status,current_stage,draft_json,analysis_json,
                     attachments_locked_at,terminal_at,retryable_until,error_code,error_message,
                     created_at,updated_at,completed_at`,
          [
            generationId,
            input.workspaceId,
            input.brandId,
            String(proposalJson.title ?? "콘텐츠 제안"),
            JSON.stringify(expectedDraft),
            selectionIdentity,
            purpose,
            outputFormat,
            null,
            null,
            input.actorUserId,
          ],
        );
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
        await assertAiContentWritable(client);
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

    async updateAiContentFinalizationDraft(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assertAiContentWritable(client);
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
            returning id,workspace_id,brand_id,output_format,purpose,title,status,current_stage,draft_json,analysis_json,
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
      return startAiContentGenerationV3Transaction({
        pool,
        catalog: fixedInputCatalog,
        snapshots,
        command: input,
        now,
      });
    },

    async listAiContentGenerations(input) {
      const result = await pool.query(
        `select id, workspace_id, brand_id, output_format, purpose, title, status, current_stage, draft_json, analysis_json,
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
      const client = await pool.connect();
      try {
        await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const row = await scopedGeneration(client, input);
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        const generation = mapGeneration(row);
        const outputs = await outputsForGenerations(client, [generation.id]);
        const evidenceSnapshot = await generationEvidenceSnapshot(client, input, row);
        const attachments = await loadGenerationAttachments(client, input);
        await client.query("COMMIT");
        const progress = await loadAiContentGenerationProgress(
          (sql, params) => client.query(sql, params),
          {
            generationId: generation.id,
            workspaceId: generation.workspaceId,
            brandId: generation.brandId,
            status: generation.status,
            createdAt: generation.createdAt,
            updatedAt: generation.updatedAt,
          },
        ).catch((progressError) => {
          console.warn("ai_content_generation_progress_unavailable", {
            generationId: generation.id,
            error: progressError instanceof Error ? progressError.message : "unknown_error",
          });
          return null;
        });
        return {
          ...generation,
          ...(evidenceSnapshot ? { evidenceSnapshot } : {}),
          ...(progress ? { progress } : {}),
          outputs: outputs.get(generation.id) ?? [],
          attachments,
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async listAiContentUsage(input) {
      const result = await pool.query(
        `select coalesce(sum(quantity) filter (where usage_type in ('generation','reversal')), 0)::integer as generation_count,
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
           ${recommendationFilter("reference_filter", cardNews ? ["card_news"] : ["reel"])}`);
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
           ${recommendationFilter("reference_filter", ["card_news"])}`);
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
           ${recommendationFilter("item", marketing ? ["reel"] : ["blog"])}`);
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
        await assertAiContentWritable(client);
        const exhausted = await client.query(
          `select id
             from ai_content_generation_jobs
             where output_format = $1 and status = 'processing'
              and job_type = 'generate' and output_id is not null
              and lease_expires_at <= clock_timestamp()
              and attempt_count >= max_attempts
            order by generation_id, output_id nulls first, id`,
           [input.outputFormat],
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
          if (job.job_type !== "generate" || !job.output_id) throw new Error("ai_content_job_contract_invalid");
          await client.query(
            `update ai_content_generation_outputs
                set status = 'failed', failure_code = 'ai_content_job_lease_exhausted',
                    failure_message = 'Worker lease expired after the final attempt', updated_at = now()
              where id = $1`,
            [job.output_id],
          );
          await recalculateGenerationStatus(client, String(job.generation_id));
          await reverseGenerationReservationIfTerminalFailure(client, String(job.generation_id));
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
             where output_format = $1 and status = 'processing'
              and job_type = 'generate' and output_id is not null
              and lease_expires_at <= clock_timestamp()
              and attempt_count < max_attempts
            order by generation_id, output_id nulls first, id`,
           [input.outputFormat],
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
             where job.output_format = $1
               and job.job_type = 'generate'
               and job.output_id is not null
              and job.status = 'queued'
              and job.available_at <= clock_timestamp()
              and job.attempt_count < job.max_attempts
            order by job.available_at, job.created_at, job.id
            limit 25`,
           [input.outputFormat],
        );
        let job: Record<string, unknown> | null = null;
        const leaseToken = randomUUID();
        for (const candidate of candidates.rows) {
          const lockedJob = await lockAiContentJobContext(client, String(candidate.id));
          if (
            lockedJob.output_format !== input.outputFormat
            || lockedJob.job_type !== "generate"
            || !lockedJob.output_id
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
        if (job.job_type !== "generate" || !job.output_id || job.output_format !== input.outputFormat) {
          throw new Error("ai_content_job_contract_invalid");
        }
        await client.query(
          "update ai_content_generation_outputs set status='planning',failure_code=null,failure_message=null,updated_at=now() where id=$1",
          [job.output_id],
        );
        await client.query(
          "update ai_content_generations set status='planning',current_stage='generation',updated_at=now() where id=$1",
          [job.generation_id],
        );
        const payload = object(job.payload_json);
        const sanitizedInput = parseCanonicalContentGenerationInputV3(
          stripContentKnowledgeData(object(payload.contentGenerationInput)),
        ) as unknown as Record<string, unknown>;
        const supplement = await client.query(
          `select evidence_json from ai_content_output_research_snapshots
            where output_id=$1 and generation_id=$2 and workspace_id=$3 and brand_id=$4`,
          [job.output_id, job.generation_id, job.workspace_id, job.brand_id],
        );
        job.payload_json = supplement.rows[0]?.evidence_json
          ? { ...payload, contentGenerationInput: sanitizedInput, supplementalResearch: supplement.rows[0].evidence_json }
          : { ...payload, contentGenerationInput: sanitizedInput };
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
        await assertAiContentWritable(client);
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
        await assertAiContentWritable(client);
        const job = await lockAiContentJobContext(client, input.jobId);
        if (job.job_type !== "generate" || !job.output_id) throw new Error("ai_content_job_contract_invalid");
        const hasPlan = "plan" in input;
        const hasPlanDraft = "planDraft" in input;
        if (job.job_type !== "generate" || !job.output_id || hasPlan === hasPlanDraft) {
          throw new Error("ai_content_job_completion_contract_mismatch");
        }
        const snapshot = await client.query(
          `select input.input_json,research.evidence_json
             from ai_content_generation_input_snapshots input
             left join ai_content_output_research_snapshots research
               on research.generation_id=input.generation_id and research.output_id=$2
            where input.generation_id=$1 and input.workspace_id=$3 and input.brand_id=$4`,
          [job.generation_id, job.output_id, job.workspace_id, job.brand_id],
        );
        if (!snapshot.rowCount) throw new Error("ai_content_generation_input_missing");
        const finalInput = parseCanonicalContentGenerationInputV3(snapshot.rows[0].input_json);
        if (finalInput.generationId !== String(job.generation_id)
          || finalInput.outputSettings.outputFormat !== job.output_format) {
          throw new Error("ai_content_generation_input_mismatch");
        }
        const plan = hasPlan
          ? parseContentPlanResultV2(input.plan, finalInput, snapshot.rows[0].evidence_json)
          : assembleContentPlanResultV2(input.planDraft, finalInput, snapshot.rows[0].evidence_json);
        const imageAssetTransport = await resolveManualRenderTransport(client, {
          generationId: String(job.generation_id),
          workspaceId: String(job.workspace_id),
          brandId: String(job.brand_id),
          selectedProposalId: finalInput.selectedProposal.id,
        });
        const renderSemanticContract = validateRenderSemanticContract(
          input,
          finalInput.outputSettings.outputFormat,
          plan,
          imageAssetTransport === "manual-v2",
        );
        if (job.status === "succeeded") {
          if (job.worker_id !== input.workerId || job.lease_token !== input.leaseToken) throw new Error("ai_content_job_lease_invalid");
          const stored = await client.query(
            "select plan_json from ai_content_generation_outputs where id=$1 and generation_id=$2 for update",
            [job.output_id, job.generation_id],
          );
          if (!stored.rows[0]?.plan_json || canonicalJson(stored.rows[0].plan_json) !== canonicalJson(plan)) {
            throw new Error("ai_content_plan_completion_conflict");
          }
          assertStoredRenderSemanticContract(job.payload_json, renderSemanticContract);
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
          imageAssetTransport, renderSemanticContract,
        });
        await client.query(
          "update ai_content_generations set status='generating',current_stage='generation',error_code=null,error_message=null,updated_at=now() where id=$1",
          [job.generation_id],
        );
        await client.query(
          `update ai_content_generation_jobs
              set status = 'succeeded', skill_version = $2, completed_at = coalesce(completed_at, now()),
                  payload_json = case when $3::jsonb is null then payload_json
                    else jsonb_set(payload_json, '{renderSemanticContract}', $3::jsonb, true) end,
                  lease_expires_at = null, error_code = null, error_message = null, updated_at = now()
            where id = $1`,
          [
            input.jobId,
            input.skillVersion,
            renderSemanticContract === null ? null : JSON.stringify(renderSemanticContract),
          ],
        );
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
        await assertAiContentWritable(client);
        const job = await lockAiContentJobContext(client, input.jobId);
        if (job.job_type !== "generate" || !job.output_id) throw new Error("ai_content_job_contract_invalid");
        if (job.status === "failed") {
          if (job.worker_id !== input.workerId || job.lease_token !== input.leaseToken) {
            throw new Error("ai_content_job_lease_invalid");
          }
          await reverseGenerationReservationIfTerminalFailure(client, String(job.generation_id));
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
        await client.query(
          `update ai_content_generation_outputs
              set status = $2, failure_code = $3, failure_message = $4, updated_at = now()
            where id = $1`,
          [job.output_id, willRetry ? "queued" : "failed", input.errorCode, input.errorMessage],
        );
        if (willRetry) {
          await client.query(
            "update ai_content_generations set status='queued',current_stage='generation',updated_at=now() where id=$1",
            [job.generation_id],
          );
        } else {
          await recalculateGenerationStatus(client, String(job.generation_id));
          await reverseGenerationReservationIfTerminalFailure(client, String(job.generation_id));
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
      if (input.contractVersion !== "content-generation-retry.v1"
        || !input.idempotencyKey.trim()
        || !input.reason.trim()
        || input.reason.length > 4_000) {
        throw new Error("ai_content_generation_retry_invalid");
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await assertAiContentWritable(client);
        await assertActiveAiContentActor(client, input);
        const outputScope = await client.query(
          `select generation_id from ai_content_generation_outputs
            where id=$1 and workspace_id=$2 and brand_id=$3`,
          [input.outputId, input.workspaceId, input.brandId],
        );
        const parentGenerationId = String(outputScope.rows[0]?.generation_id ?? "");
        if (!parentGenerationId) throw new Error("ai_content_output_not_found");
        const parentResult = await client.query(
          `select generation.*,generation.retryable_until>transaction_timestamp() retryable,
                  operation.status operation_status,operation.parent_operation_id,
                  reservation.id reservation_id,reservation.quantity reservation_quantity,
                  reversal.id reversal_id,reversal.quantity reversal_quantity,
                  snapshot.input_json,snapshot.content_hash,binding.id binding_id,binding.binding_json,
                  binding.binding_sha256,
                  binding.binding_sha256=encode(digest(binding.binding_json::text,'sha256'),'hex') binding_hash_matches,
                  binding.selected_proposal_id,binding.proposal_job_id,binding.proposal_contract_id,
                  binding.successful_model_attempt_id
             from ai_content_generations generation
             join ai_content_generation_operations operation on operation.id=generation.operation_id
             join ai_content_usage_ledger reservation
               on reservation.operation_id=operation.id and reservation.generation_id=generation.id
              and reservation.usage_type='generation' and reservation.reservation_id=reservation.id
             join ai_content_usage_ledger reversal
               on reversal.operation_id=operation.id and reversal.generation_id=generation.id
              and reversal.usage_type='reversal' and reversal.reservation_id=reservation.id
              and reversal.reversal_of_ledger_id=reservation.id
             join ai_content_generation_input_snapshots snapshot
               on snapshot.generation_id=generation.id and snapshot.workspace_id=generation.workspace_id
              and snapshot.brand_id=generation.brand_id
             join ai_content_generation_prompt_bindings binding
               on binding.generation_id=generation.id and binding.workspace_id=generation.workspace_id
              and binding.brand_id=generation.brand_id
            where generation.id=$1 and generation.workspace_id=$2 and generation.brand_id=$3
             for update of generation,operation`,
          [parentGenerationId, input.workspaceId, input.brandId],
        );
        const parent = parentResult.rows[0] as Record<string, unknown> | undefined;
        if (!parent) throw new Error("ai_content_generation_retry_parent_invalid");
        const failedOutput = await client.query(
          `select * from ai_content_generation_outputs
            where id=$1 and generation_id=$2 and workspace_id=$3 and brand_id=$4 for update`,
          [input.outputId, parentGenerationId, input.workspaceId, input.brandId],
        );
        if (!failedOutput.rows.length || failedOutput.rows[0].status !== "failed"
          || parent.status !== "failed"
          || parent.operation_status !== "reversed"
          || parent.retryable !== true
          || Number(parent.reversal_quantity) !== -Number(parent.reservation_quantity)) {
          throw new Error("ai_content_generation_retry_parent_invalid");
        }
        let parentInput: ReturnType<typeof parseCanonicalContentGenerationInputV3>;
        let parentBinding: ReturnType<typeof parseContentPromptBinding>;
        try {
          parentInput = parseCanonicalContentGenerationInputV3(parent.input_json);
          parentBinding = parseContentPromptBinding(parent.binding_json);
          assertPlannerPromptBinding(parentInput, parentBinding);
        } catch {
          throw new Error("ai_content_generation_retry_parent_invalid");
        }
        if (parentInput.generationId !== parentGenerationId
          || proposalSha256(parent.input_json) !== String(parent.content_hash)
          || parent.binding_hash_matches !== true) {
          throw new Error("ai_content_generation_retry_parent_invalid");
        }
        const requestFingerprint = proposalSha256({
          contractVersion: input.contractVersion,
          workspaceId: input.workspaceId,
          brandId: input.brandId,
          parentGenerationId,
          parentOperationId: parent.operation_id,
          parentOutputId: input.outputId,
          reason: input.reason.trim(),
        });
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
          `ai-content-operation:${input.brandId}:${input.idempotencyKey}`,
        ]);
        const existing = await client.query(
          `select operation.*,generation.generation_input_snapshot,generation.parent_generation_id,
                  generation.output_format,generation.purpose,
                  snapshot.input_json,snapshot.content_hash,
                   binding.parent_binding_id,binding.binding_json,binding.binding_sha256,
                   binding.binding_sha256=encode(digest(binding.binding_json::text,'sha256'),'hex') binding_hash_matches,
                  binding.selected_proposal_id,binding.proposal_job_id,binding.proposal_contract_id,
                  binding.successful_model_attempt_id,reservation.quantity reservation_quantity,
                  (select count(*)::integer from ai_content_generation_outputs output
                    where output.generation_id=generation.id) output_count,
                  (select count(*)::integer from ai_content_generation_jobs job
                    where job.generation_id=generation.id and job.job_type='generate'
                      and job.output_format=generation.output_format) job_count
             from ai_content_generation_operations operation
             join ai_content_generations generation on generation.id=operation.generation_id
              and generation.workspace_id=operation.workspace_id and generation.brand_id=operation.brand_id
             join ai_content_generation_input_snapshots snapshot
               on snapshot.generation_id=generation.id and snapshot.workspace_id=generation.workspace_id
              and snapshot.brand_id=generation.brand_id
             join ai_content_generation_prompt_bindings binding
               on binding.generation_id=generation.id and binding.workspace_id=generation.workspace_id
              and binding.brand_id=generation.brand_id
             join ai_content_usage_ledger reservation
               on reservation.operation_id=operation.id and reservation.generation_id=generation.id
              and reservation.usage_type='generation' and reservation.reservation_id=reservation.id
            where operation.brand_id=$1 and operation.operation_key=$2 for update of operation,generation`,
          [input.brandId, input.idempotencyKey],
        );
        const replay = existing.rows[0] as Record<string, unknown> | undefined;
        if (replay) {
          let replayInput: ReturnType<typeof parseCanonicalContentGenerationInputV3>;
          try {
            replayInput = parseCanonicalContentGenerationInputV3(replay.input_json);
            const replayBinding = parseContentPromptBinding(replay.binding_json);
            assertPlannerPromptBinding(replayInput, replayBinding);
          } catch {
            throw new Error("ai_content_generation_retry_conflict");
          }
          const { generationId: _parentGenerationId, capturedAt: _parentCapturedAt, ...parentRetrySource } = parentInput;
          const { generationId: replayGenerationId, capturedAt: _replayCapturedAt, ...replayRetrySource } = replayInput;
          if (String(replay.workspace_id) !== input.workspaceId
            || String(replay.parent_operation_id) !== String(parent.operation_id)
            || String(replay.parent_generation_id) !== parentGenerationId
            || String(replay.request_fingerprint_sha256) !== requestFingerprint
            || !["started", "completed", "failed", "reversed"].includes(String(replay.status))
            || replayGenerationId !== String(replay.generation_id)
            || !isDeepStrictEqual(parentRetrySource, replayRetrySource)
            || !isDeepStrictEqual(replay.generation_input_snapshot, replay.input_json)
            || proposalSha256(replay.input_json) !== String(replay.content_hash)
            || replay.binding_hash_matches !== true
            || String(replay.parent_binding_id) !== String(parent.binding_id)
            || String(replay.selected_proposal_id) !== String(parent.selected_proposal_id)
            || String(replay.proposal_job_id) !== String(parent.proposal_job_id)
            || String(replay.proposal_contract_id) !== String(parent.proposal_contract_id)
            || String(replay.successful_model_attempt_id) !== String(parent.successful_model_attempt_id)
            || String(replay.output_format) !== parentInput.outputSettings.outputFormat
            || String(replay.purpose) !== parentInput.outputSettings.purpose
            || Number(replay.reservation_quantity) !== replayInput.outputSettings.outputCount
            || Number(replay.output_count) !== replayInput.outputSettings.outputCount
            || Number(replay.job_count) !== replayInput.outputSettings.outputCount) {
            throw new Error("ai_content_generation_retry_conflict");
          }
          const generation = await generationById(client, String(replay.generation_id));
          await client.query("COMMIT");
          return generation;
        }
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
          `ai-content-usage:${input.brandId}:${input.usageDate}`,
        ]);
        const usage = await client.query(
          `select coalesce(sum(quantity),0)::integer generation_count from ai_content_usage_ledger
            where workspace_id=$1 and brand_id=$2 and usage_date=$3::date
              and usage_type in ('generation','reversal')`,
          [input.workspaceId, input.brandId, input.usageDate],
        );
        const outputCount = parentInput.outputSettings.outputCount;
        if (Number(usage.rows[0]?.generation_count ?? 0) + outputCount > input.dailyGenerationLimit) {
          throw new Error("ai_content_limit_reached");
        }
        const generationId = randomUUID();
        const operationId = randomUUID();
        const reservationId = randomUUID();
        const retriedInput = parseCanonicalContentGenerationInputV3({
          ...parentInput,
          generationId,
          capturedAt: new Date().toISOString(),
        });
        const retriedJson = canonicalProposalJson(retriedInput);
        const retriedHash = proposalSha256(retriedInput);
        await client.query(
          `insert into ai_content_generations(
             id,workspace_id,brand_id,output_format,purpose,title,status,current_stage,draft_json,analysis_json,
             analysis_idempotency_key,generation_idempotency_key,operation_id,parent_generation_id,generation_input_snapshot,
             attachments_locked_at,created_by_user_id,updated_by_user_id
           ) values($1,$2,$3,$4,$5,$6,'queued','generation',$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13::jsonb,
              statement_timestamp(),$14,$14)`,
          [generationId, input.workspaceId, input.brandId, parent.output_format, parent.purpose,
            parent.title, JSON.stringify({ ...object(parent.draft_json), origin: "retry-v3",
              parentGenerationId, parentOutputId: input.outputId, retryReason: input.reason.trim() }),
            JSON.stringify(object(parent.analysis_json)), `retry-v3:${parentGenerationId}:${input.idempotencyKey}`,
            input.idempotencyKey, operationId, parentGenerationId, retriedJson, input.actorUserId],
        );
        await client.query(
          `insert into ai_content_generation_operations(
             id,workspace_id,brand_id,operation_key,request_fingerprint_sha256,parent_operation_id,generation_id,status
           ) values($1,$2,$3,$4,$5,$6,$7,'reserved')`,
          [operationId, input.workspaceId, input.brandId, input.idempotencyKey, requestFingerprint,
            parent.operation_id, generationId],
        );
        await client.query(
          `insert into ai_content_usage_ledger(
             id,workspace_id,brand_id,generation_id,output_id,usage_type,quantity,usage_date,
             idempotency_key,operation_id,reservation_id,reversal_of_ledger_id
           ) values($1,$2,$3,$4,null,'generation',$5,$6::date,$7,$8,$1,null)`,
          [reservationId, input.workspaceId, input.brandId, generationId, outputCount, input.usageDate,
            `generation-reservation:${operationId}`, operationId],
        );
        await client.query(
          `insert into ai_content_generation_input_snapshots(
             id,workspace_id,brand_id,generation_id,input_json,content_hash
           ) values($1,$2,$3,$4,$5::jsonb,$6)`,
          [randomUUID(), input.workspaceId, input.brandId, generationId, retriedJson, retriedHash],
        );
        await client.query(
          "select create_ai_content_generation_prompt_binding($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
          [generationId, input.workspaceId, input.brandId, parent.selected_proposal_id,
            parent.proposal_job_id, parent.proposal_contract_id, parent.successful_model_attempt_id,
            JSON.stringify(parent.binding_json)],
        );
        const outputId = randomUUID();
        await client.query(
          `insert into ai_content_generation_outputs(
             id,generation_id,workspace_id,brand_id,output_index,status
           ) values($1,$2,$3,$4,1,'queued')`,
          [outputId, generationId, input.workspaceId, input.brandId],
        );
        if (parentInput.outputSettings.outputFormat !== "blog") {
          await client.query(
            `insert into ai_content_output_research_snapshots(
               id,workspace_id,brand_id,generation_id,output_id,evidence_json
             ) values($1,$2,$3,$4,$5,$6::jsonb)`,
            [randomUUID(), input.workspaceId, input.brandId, generationId, outputId,
              JSON.stringify(parentInput.researchEvidence)],
          );
        }
        await client.query(
          `insert into ai_content_generation_jobs(
             id,generation_id,output_id,workspace_id,brand_id,job_type,output_format,status,payload_json
           ) values($1,$2,$3,$4,$5,'generate',$6,'queued',$7::jsonb)`,
          [randomUUID(), generationId, outputId, input.workspaceId, input.brandId,
            parentInput.outputSettings.outputFormat, JSON.stringify({
              generationId, outputId, contentGenerationInput: retriedInput,
              planningMode: "selected_proposal", operationId,
            })],
        );
        await client.query(
          "select transition_ai_content_generation_operation($1,'reserved','started')",
          [operationId],
        );
        const generation = await generationById(client, generationId);
        await client.query("COMMIT");
        return generation;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

  };
}
