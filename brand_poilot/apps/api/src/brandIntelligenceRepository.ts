import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  parseBrandIntelligenceResult,
  type BrandAnalysisStatus,
  type BrandEvidenceDocument,
  type BrandIntelligenceResult,
} from "./brandIntelligenceContracts.js";
import {
  BRAND_CORE_FIELD_PATHS,
  mapAnalysisToBrandCoreDraft,
} from "./brandCoreContracts.js";
import { toBrandIntelligenceCommonView } from "./brandIntelligenceV2Contracts.js";
import { hashSourceUrl, normalizeSourceDomain, normalizeSourceUrl } from "./sourceUrl.js";

export interface BrandAnalysisScope { workspaceId: string; brandId: string }

export interface BrandAnalysisRecord extends BrandAnalysisScope {
  id: string;
  status: BrandAnalysisStatus;
  input: { companyName: string | null; ownedUrl: string | null; uploadIds: string[] };
  evidence: BrandEvidenceDocument[];
  result: BrandIntelligenceResult | null;
  editedResult: BrandIntelligenceResult | null;
  effectiveResult: BrandIntelligenceResult | null;
  idempotencyKey: string;
  isActive: boolean;
  leasedBy: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  pipelineVersion: number;
  contractVersion: string;
  currentStage: string | null;
  selectedPageCount: number;
  successfulPageCount: number;
  failedPageCount: number;
  requiredPageCount: number;
  completedCliStageCount: number;
  totalCliStageCount: number;
  activeStartedAt: string | null;
  deadlineAt: string | null;
  availableAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  confirmedAt: string | null;
}

export interface BrandAnalysisClaim extends BrandAnalysisRecord {
  status: "extracting" | "analyzing" | "running" | "finalizing";
  leasedBy: string;
  leaseToken: string;
  leaseExpiresAt: string;
  uploads: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    checksum: string;
    accessUrl: string;
  }>;
  executionContract: {
    ownedPageLimit: 20;
    externalPageLimit: 10;
    offeringLimit: 5;
    pipelineVersion: 2;
    promptVersion: "brand-intelligence-v2.1";
    resultContractVersion: "brand-intelligence-result.v2";
  } | null;
}

export interface BrandIntelligenceRepository {
  getBrandCompanyName?(input: BrandAnalysisScope): Promise<{
    name: string;
    state: "provisional" | "legacy_unknown" | "confirmed";
  } | null>;
  registerBrandAnalysisUpload(input: BrandAnalysisScope & {
    fileName: string; mimeType: string; byteSize: number; checksum: string;
    storagePath: string; storageUrl: string;
  }): Promise<{ id: string }>;
  requestBrandAnalysis(input: BrandAnalysisScope & {
    companyName?: string; ownedUrl: string | null; uploadIds: string[]; idempotencyKey: string;
    uploads?: Array<{
      fileName: string; mimeType: string; byteSize: number; checksum: string;
    }>;
  }): Promise<BrandAnalysisRecord>;
  beginBrandAnalysisUpload(input: BrandAnalysisScope & {
    analysisId: string; uploadId: string; storagePath: string;
    fileName: string; mimeType: string; byteSize: number; checksum: string;
  }): Promise<void>;
  completeBrandAnalysisUpload(input: BrandAnalysisScope & {
    analysisId: string; uploadId: string; storagePath: string; storageUrl: string;
  }): Promise<void>;
  startBrandAnalysis(input: BrandAnalysisScope & { analysisId: string }): Promise<BrandAnalysisRecord>;
  cleanupBrandAnalysisRuns?(): Promise<{ attempted: number; completed: number }>;
  getBrandAnalysis(input: BrandAnalysisScope & { analysisId: string }): Promise<BrandAnalysisRecord | null>;
  getOpenBrandAnalysis(input: BrandAnalysisScope): Promise<BrandAnalysisRecord | null>;
  getCurrentBrandIntelligence(input: BrandAnalysisScope): Promise<BrandAnalysisRecord | null>;
  updateBrandAnalysisDraft(input: BrandAnalysisScope & {
    analysisId: string; editedResult: BrandIntelligenceResult;
  }): Promise<BrandAnalysisRecord>;
  cancelBrandAnalysis(input: BrandAnalysisScope & { analysisId: string }): Promise<BrandAnalysisRecord>;
  retryBrandAnalysis(input: BrandAnalysisScope & { analysisId: string }): Promise<BrandAnalysisRecord>;
  confirmBrandAnalysis(input: BrandAnalysisScope & {
    analysisId: string;
    companyName?: string;
    editedResult?: BrandIntelligenceResult;
    actorUserId?: string | null;
  }): Promise<BrandAnalysisRecord>;
  claimBrandAnalysis(input: {
    workerId: string;
    leaseSeconds: number;
    supportedPipelineVersions?: readonly number[];
  }): Promise<BrandAnalysisClaim | null>;
  listBrandAnalysisUploads(input: { analysisId: string }): Promise<Array<{
    id: string; fileName: string; mimeType: string; byteSize: number; storageUrl: string;
  }>>;
  getBrandAnalysisUploadForDownload(input: {
    analysisId: string;
    uploadId: string;
  }): Promise<{ storageUrl: string; mimeType: string; byteSize: number } | null>;
  markBrandEvidenceReady(input: {
    analysisId: string; workerId: string; leaseToken: string; evidence: BrandEvidenceDocument[];
  }): Promise<BrandAnalysisClaim>;
  heartbeatBrandAnalysis(input: {
    analysisId: string; workerId: string; leaseToken: string; leaseSeconds: number;
  }): Promise<{ alive: boolean; cancelRequested: boolean; deadlineAt: string | null }>;
  progressBrandAnalysis(input: {
    analysisId: string; workerId: string; leaseToken: string;
    stage: string; attempt?: number; status?: "running" | "succeeded" | "failed" | "cancelled";
    errorCode?: string;
    logicalIndex?: number; physicalAttempt?: number;
    inputCount: number; successCount: number; failedCount: number;
    selectedPageCount?: number; successfulPageCount?: number; failedPageCount?: number;
    requiredPageCount?: number; completedCliStageCount?: number; totalCliStageCount?: number;
  }): Promise<BrandAnalysisRecord>;
  markBrandAnalysisCancelled(input: {
    analysisId: string; workerId: string; leaseToken: string;
  }): Promise<BrandAnalysisRecord>;
  completeBrandAnalysis(input: {
    analysisId: string; workerId: string; leaseToken: string;
    evidence?: BrandEvidenceDocument[]; result: BrandIntelligenceResult;
    registry?: {
      ownedFactIds: string[];
      externalSources: Array<{ sourceId: string; url: string }>;
    };
  }): Promise<BrandAnalysisRecord>;
  failBrandAnalysis(input: {
    analysisId: string; workerId: string; leaseToken: string;
    errorCode: string; errorMessage: string; retryable: boolean;
  }): Promise<BrandAnalysisRecord>;
}

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

const columns = `id, workspace_id, brand_id, status, input_json, evidence_json,
  result_json, edited_result_json, idempotency_key, is_active, leased_by, lease_token,
  lease_expires_at, attempt_count, available_at, error_code, error_message,
  created_at, updated_at, completed_at, confirmed_at, active_started_at, deadline_at,
  pipeline_version, contract_version, current_stage, selected_page_count,
  successful_page_count, failed_page_count, required_page_count,
  completed_cli_stage_count, total_cli_stage_count`;

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function json<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return (value ?? fallback) as T;
}

function normalizedEvidenceText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function assertV2EvidenceGrounding(
  result: BrandIntelligenceResult,
  evidence: BrandEvidenceDocument[],
): void {
  if (result.contractVersion !== "brand-intelligence-result.v2") return;
  const documents = new Map(evidence.map((document) => [document.sourceId, document]));
  for (const item of result.evidence) {
    if (item.sourceKind === "external") continue;
    const document = documents.get(item.sourceId);
    if (!document) throw new Error("brand_intelligence_evidence_registry_mismatch");
    const expectedKind = document.sourceType === "owned_url" ? "owned" : "upload";
    if (item.sourceKind !== expectedKind
      || (expectedKind === "owned" && item.sourceUrl !== document.sourceUrl)
      || (expectedKind === "upload" && item.sourceUrl !== null)) {
      throw new Error("brand_intelligence_evidence_registry_mismatch");
    }
    const documentText = normalizedEvidenceText([
      ...document.textBlocks.map((block) => block.text),
      ...document.tables.flatMap((table) => [
        table.headers.join("\t"),
        ...table.rows.map((row) => row.join("\t")),
      ]),
    ].join("\n"));
    if (!documentText.includes(normalizedEvidenceText(item.excerpt))) {
      throw new Error("brand_intelligence_evidence_quote_mismatch");
    }
  }
}

function mapRun(row: Record<string, unknown>): BrandAnalysisRecord {
  const input = json<{ companyName?: unknown; ownedUrl?: unknown; uploadIds?: unknown }>(row.input_json, {});
  const result = row.result_json ? parseBrandIntelligenceResult(json(row.result_json, {})) : null;
  const editedResult = row.edited_result_json
    ? parseBrandIntelligenceResult(json(row.edited_result_json, {}))
    : null;
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), brandId: String(row.brand_id),
    status: row.status as BrandAnalysisStatus,
    input: {
      companyName: typeof input.companyName === "string" ? input.companyName : null,
      ownedUrl: typeof input.ownedUrl === "string" ? input.ownedUrl : null,
      uploadIds: Array.isArray(input.uploadIds) ? input.uploadIds.map(String) : [],
    },
    evidence: json<BrandEvidenceDocument[]>(row.evidence_json, []),
    result, editedResult, effectiveResult: editedResult ?? result,
    idempotencyKey: String(row.idempotency_key), isActive: Boolean(row.is_active),
    leasedBy: row.leased_by ? String(row.leased_by) : null,
    leaseToken: row.lease_token ? String(row.lease_token) : null,
    leaseExpiresAt: iso(row.lease_expires_at), attemptCount: Number(row.attempt_count ?? 0),
    pipelineVersion: Number(row.pipeline_version ?? 1),
    contractVersion: String(row.contract_version ?? "brand-intelligence-result.v1"),
    currentStage: row.current_stage ? String(row.current_stage) : null,
    selectedPageCount: Number(row.selected_page_count ?? 0),
    successfulPageCount: Number(row.successful_page_count ?? 0),
    failedPageCount: Number(row.failed_page_count ?? 0),
    requiredPageCount: Number(row.required_page_count ?? 0),
    completedCliStageCount: Number(row.completed_cli_stage_count ?? 0),
    totalCliStageCount: Number(row.total_cli_stage_count ?? 0),
    activeStartedAt: iso(row.active_started_at),
    deadlineAt: iso(row.deadline_at),
    availableAt: iso(row.available_at)!, errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!,
    completedAt: iso(row.completed_at), confirmedAt: iso(row.confirmed_at),
  };
}

async function loadRun(client: Queryable, analysisId: string): Promise<BrandAnalysisRecord | null> {
  const found = await client.query(`select ${columns} from brand_analysis_runs where id = $1`, [analysisId]);
  return found.rowCount ? mapRun(found.rows[0] as Record<string, unknown>) : null;
}

async function loadOpenRun(client: Queryable, input: BrandAnalysisScope): Promise<BrandAnalysisRecord | null> {
  const found = await client.query(
    `select ${columns} from brand_analysis_runs
      where workspace_id = $1 and brand_id = $2
        and status in (
          'queued', 'extracting', 'analyzing', 'accepting_uploads',
          'waiting_for_resource', 'running', 'finalizing', 'review_ready',
          'cancel_requested', 'purging'
        )
      order by created_at desc, id desc limit 1`,
    [input.workspaceId, input.brandId],
  );
  return found.rowCount ? mapRun(found.rows[0] as Record<string, unknown>) : null;
}

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const value = await operation(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

function assertLease(row: Record<string, unknown> | undefined, input: {
  workerId: string; leaseToken: string;
}): asserts row is Record<string, unknown> {
  if (!row || !["extracting", "analyzing", "running", "finalizing"].includes(String(row.status))
    || String(row.leased_by ?? "") !== input.workerId
    || String(row.lease_token ?? "") !== input.leaseToken
    || !row.lease_expires_at
    || new Date(row.lease_expires_at as string | Date).getTime() <= Date.now()
    || (row.deadline_at
      && new Date(row.deadline_at as string | Date).getTime() <= Date.now())) {
    throw new Error("brand_analysis_lease_invalid");
  }
}

export function createBrandIntelligenceRepository(
  pool: Pool,
  options: {
    deleteBlobs?: (urls: string[]) => Promise<unknown>;
  } = {},
): BrandIntelligenceRepository {
  return {
    async getBrandCompanyName(input) {
      const found = await pool.query(
        `select name, company_name_state
         from brands
         where id = $1 and workspace_id = $2`,
        [input.brandId, input.workspaceId],
      );
      if (!found.rowCount) return null;
      return {
        name: String(found.rows[0]!.name),
        state: String(found.rows[0]!.company_name_state) as
          "provisional" | "legacy_unknown" | "confirmed",
      };
    },

    async registerBrandAnalysisUpload(input) {
      const inserted = await pool.query(
        `insert into brand_analysis_uploads
           (workspace_id, brand_id, file_name, mime_type, byte_size, checksum,
            storage_path, storage_url, upload_status, upload_completed_at)
         select $1, $2, $3, $4, $5, $6, $7, $8, 'uploaded', now()
          where exists (select 1 from brands where id = $2 and workspace_id = $1)
         on conflict (storage_path) do update set storage_url = excluded.storage_url
         returning id`,
        [input.workspaceId, input.brandId, input.fileName, input.mimeType, input.byteSize,
          input.checksum, input.storagePath, input.storageUrl],
      );
      if (!inserted.rowCount) throw new Error("brand_not_found");
      return { id: String(inserted.rows[0]!.id) };
    },

    async requestBrandAnalysis(input) {
      return transaction(pool, async (client) => {
        const brand = await client.query(
          "select id from brands where id = $1 and workspace_id = $2 for update",
          [input.brandId, input.workspaceId],
        );
        if (!brand.rowCount) throw new Error("brand_not_found");
        const existing = await client.query(
          `select ${columns} from brand_analysis_runs
            where brand_id = $1 and workspace_id = $2 and idempotency_key = $3`,
          [input.brandId, input.workspaceId, input.idempotencyKey],
        );
        if (existing.rowCount) return mapRun(existing.rows[0] as Record<string, unknown>);
        const open = await loadOpenRun(client, {
          workspaceId: input.workspaceId,
          brandId: input.brandId,
        });
        if (open) return open;
        if (input.uploadIds.length) {
          const selectedUploads = await client.query(
            `select count(*)::int as count, coalesce(sum(byte_size), 0)::bigint as total_bytes
             from brand_analysis_uploads
             where workspace_id = $1 and brand_id = $2
               and id = any($3::uuid[])
               and analysis_id is null and deleted_at is null`,
            [input.workspaceId, input.brandId, input.uploadIds],
          );
          const count = Number(selectedUploads.rows[0]?.count ?? 0);
          const totalBytes = Number(selectedUploads.rows[0]?.total_bytes ?? 0);
          if (count !== input.uploadIds.length) {
            throw new Error("brand_analysis_upload_not_found");
          }
          if (totalBytes > 25 * 1024 * 1024) {
            throw new Error("brand_analysis_upload_total_too_large");
          }
        }
        const id = randomUUID();
        const declaredUploads = input.uploads ?? [];
        const declaredUploadIds = declaredUploads.map(() => randomUUID());
        const selectedUploadIds = declaredUploadIds.length ? declaredUploadIds : input.uploadIds;
        const inserted = await client.query(
          `insert into brand_analysis_runs
             (id, workspace_id, brand_id, status, input_json, idempotency_key,
              pipeline_version, contract_version)
           values ($1, $2, $3, $7, $4::jsonb, $5, $6, $8)
           on conflict do nothing
           returning ${columns}`,
          [
            id,
            input.workspaceId,
            input.brandId,
            JSON.stringify({
              ...(input.companyName ? { companyName: input.companyName } : {}),
              ownedUrl: input.ownedUrl,
              uploadIds: selectedUploadIds,
            }),
            input.idempotencyKey,
            2,
            declaredUploads.length
              ? "accepting_uploads"
              : "waiting_for_resource",
            "brand-intelligence-result.v2",
          ],
        );
        if (!inserted.rowCount) {
          const raced = await client.query(
            `select ${columns} from brand_analysis_runs
              where workspace_id = $1 and brand_id = $2
                and (
                  idempotency_key = $3
                  or status in (
                    'queued', 'extracting', 'analyzing', 'accepting_uploads',
                    'waiting_for_resource', 'running', 'finalizing', 'review_ready',
                    'cancel_requested', 'purging'
                  )
                )
              order by (idempotency_key = $3) desc, created_at desc, id desc
              limit 1`,
            [input.workspaceId, input.brandId, input.idempotencyKey],
          );
          if (!raced.rowCount) throw new Error("brand_analysis_request_conflict");
          return mapRun(raced.rows[0] as Record<string, unknown>);
        }
        for (const [index, upload] of declaredUploads.entries()) {
          await client.query(
            `insert into brand_analysis_uploads (
               id, workspace_id, brand_id, analysis_id, file_name, mime_type,
               byte_size, checksum, upload_status, upload_expires_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'intent', now() + interval '30 minutes')`,
            [
              declaredUploadIds[index],
              input.workspaceId,
              input.brandId,
              id,
              upload.fileName,
              upload.mimeType,
              upload.byteSize,
              upload.checksum,
            ],
          );
        }
        if (input.uploadIds.length) {
          const attached = await client.query(
            `update brand_analysis_uploads set analysis_id = $1
              where workspace_id = $2 and brand_id = $3 and id = any($4::uuid[])
                and analysis_id is null and deleted_at is null`,
            [id, input.workspaceId, input.brandId, input.uploadIds],
          );
          if (Number(attached.rowCount) !== input.uploadIds.length) {
            throw new Error("brand_analysis_upload_not_found");
          }
        }
        return mapRun(inserted.rows[0] as Record<string, unknown>);
      });
    },

    async beginBrandAnalysisUpload(input) {
      await transaction(pool, async (client) => {
        await client.query(
          `update brand_analysis_upload_attempts
              set status = 'failed', lease_expires_at = null,
                  error_code = 'brand_analysis_upload_lease_expired'
            where analysis_id = $1 and status = 'uploading' and lease_expires_at <= now()`,
          [input.analysisId],
        );
        const found = await client.query(
          `select upload.*
             from brand_analysis_uploads upload
             join brand_analysis_runs run on run.id = upload.analysis_id
            where upload.id = $1
              and upload.analysis_id = $2
              and upload.workspace_id = $3
              and upload.brand_id = $4
              and run.status = 'accepting_uploads'
              and upload.upload_expires_at > now()
              and upload.upload_attempt_count < 3
              and upload.upload_status in ('intent', 'uploading', 'failed')
              and upload.file_name = $5
              and upload.mime_type = $6
              and upload.byte_size = $7
              and upload.checksum = $8
            for update of upload`,
          [
            input.uploadId, input.analysisId, input.workspaceId, input.brandId,
            input.fileName, input.mimeType, input.byteSize, input.checksum,
          ],
        );
        if (!found.rowCount) throw new Error("brand_analysis_upload_intent_invalid");
        const active = await client.query(
          `select upload_id, storage_path
             from brand_analysis_upload_attempts
            where analysis_id = $1 and status = 'uploading'
            for update`,
          [input.analysisId],
        );
        if (active.rowCount) {
          const sameAttempt = String(active.rows[0]!.upload_id) === input.uploadId
            && String(active.rows[0]!.storage_path) === input.storagePath;
          if (sameAttempt) return;
          throw new Error("brand_analysis_upload_in_progress");
        }
        const nextAttempt = Number(found.rows[0]!.upload_attempt_count) + 1;
        await client.query(
          `update brand_analysis_uploads
              set upload_status = 'uploading',
                  upload_attempt_count = $2,
                  storage_path = $3,
                  storage_url = null,
                  upload_completed_at = null
            where id = $1`,
          [input.uploadId, nextAttempt, input.storagePath],
        );
        await client.query(
          `insert into brand_analysis_upload_attempts
             (upload_id, analysis_id, attempt_number, storage_path, status, lease_expires_at)
           values ($1, $2, $3, $4, 'uploading', now() + interval '10 minutes')`,
          [input.uploadId, input.analysisId, nextAttempt, input.storagePath],
        );
      });
    },

    async completeBrandAnalysisUpload(input) {
      await transaction(pool, async (client) => {
        const updated = await client.query(
          `update brand_analysis_uploads upload
              set upload_status = 'uploaded',
                  storage_url = $6,
                  upload_completed_at = now()
             from brand_analysis_runs run
            where upload.id = $1
              and upload.analysis_id = $2
              and upload.workspace_id = $3
              and upload.brand_id = $4
              and upload.storage_path = $5
              and upload.upload_status = 'uploading'
              and upload.upload_expires_at > now()
              and run.id = upload.analysis_id
              and run.status = 'accepting_uploads'
            returning upload.id`,
          [
            input.uploadId,
            input.analysisId,
            input.workspaceId,
            input.brandId,
            input.storagePath,
            input.storageUrl,
          ],
        );
        if (!updated.rowCount) throw new Error("brand_analysis_upload_intent_invalid");
        const attempt = await client.query(
          `update brand_analysis_upload_attempts
              set status = 'succeeded', storage_url = $4, lease_expires_at = null,
                  completed_at = now(), error_code = null
            where upload_id = $1 and analysis_id = $2 and storage_path = $3
              and status = 'uploading'
            returning id`,
          [input.uploadId, input.analysisId, input.storagePath, input.storageUrl],
        );
        if (!attempt.rowCount) throw new Error("brand_analysis_upload_attempt_invalid");
      });
    },

    async startBrandAnalysis(input) {
      return transaction(pool, async (client) => {
        const found = await client.query(
          `select ${columns} from brand_analysis_runs
            where id = $1 and workspace_id = $2 and brand_id = $3
            for update`,
          [input.analysisId, input.workspaceId, input.brandId],
        );
        if (!found.rowCount) throw new Error("brand_analysis_not_found");
        const current = mapRun(found.rows[0] as Record<string, unknown>);
        if (current.status === "queued" || current.status === "waiting_for_resource") return current;
        if (current.status !== "accepting_uploads") throw new Error("brand_analysis_upload_state_invalid");
        const pending = await client.query(
          `select count(*)::int as count
             from brand_analysis_uploads
            where analysis_id = $1 and upload_status <> 'uploaded'`,
          [input.analysisId],
        );
        if (Number(pending.rows[0]?.count ?? 0) > 0) {
          throw new Error("brand_analysis_uploads_incomplete");
        }
        const updated = await client.query(
          `update brand_analysis_runs
              set status = case when pipeline_version = 2 then 'waiting_for_resource' else 'queued' end,
                  updated_at = now()
            where id = $1 returning ${columns}`,
          [input.analysisId],
        );
        return mapRun(updated.rows[0] as Record<string, unknown>);
      });
    },

    async cleanupBrandAnalysisRuns() {
      await pool.query(
        `update brand_analysis_runs
            set status = 'failed',
                error_code = 'analysis_deadline_exceeded',
                error_message = 'analysis deadline exceeded',
                completed_at = coalesce(completed_at, now()),
                retention_expires_at = coalesce(retention_expires_at, now() + interval '24 hours'),
                leased_by = null,
                lease_token = null,
                lease_expires_at = null,
                updated_at = now()
          where status in ('extracting', 'analyzing', 'running', 'finalizing')
            and deadline_at is not null
            and deadline_at <= now()`,
      );
      const candidates = await pool.query(
        `select distinct run.id, run.workspace_id, run.brand_id
           from brand_analysis_runs run
           left join brand_analysis_uploads upload on upload.analysis_id = run.id
          where run.status in ('purging', 'cancel_requested')
             or (run.status = 'failed' and run.retention_expires_at <= now())
             or (
               run.status = 'accepting_uploads'
               and upload.upload_expires_at <= now()
             )
          order by run.id
          limit 10`,
      );
      let completed = 0;
      for (const row of candidates.rows) {
        try {
          const result = await this.cancelBrandAnalysis({
            analysisId: String(row.id),
            workspaceId: String(row.workspace_id),
            brandId: String(row.brand_id),
          });
          if (result.status === "cancelled") completed += 1;
        } catch {
          // Durable state remains purging and the next worker pass retries.
        }
      }
      return { attempted: candidates.rows.length, completed };
    },

    async getBrandAnalysis(input) {
      const found = await pool.query(
        `select ${columns} from brand_analysis_runs
          where id = $1 and workspace_id = $2 and brand_id = $3`,
        [input.analysisId, input.workspaceId, input.brandId],
      );
      return found.rowCount ? mapRun(found.rows[0] as Record<string, unknown>) : null;
    },

    async getOpenBrandAnalysis(input) {
      return loadOpenRun(pool, input);
    },

    async getCurrentBrandIntelligence(input) {
      const found = await pool.query(
        `select ${columns},
                (select name from brands where brands.id = brand_analysis_runs.brand_id)
                  as current_company_name
           from brand_analysis_runs
          where workspace_id = $1 and brand_id = $2 and is_active
          order by confirmed_at desc limit 1`,
        [input.workspaceId, input.brandId],
      );
      if (!found.rowCount) return null;
      const current = mapRun(found.rows[0] as Record<string, unknown>);
      return {
        ...current,
        input: {
          ...current.input,
          companyName: String(found.rows[0]!.current_company_name),
        },
      };
    },

    async updateBrandAnalysisDraft(input) {
      const parsed = parseBrandIntelligenceResult(input.editedResult);
      const updated = await pool.query(
        `update brand_analysis_runs
            set edited_result_json = $4::jsonb, updated_at = now()
          where id = $1 and workspace_id = $2 and brand_id = $3 and status = 'review_ready'
          returning ${columns}`,
        [input.analysisId, input.workspaceId, input.brandId, JSON.stringify(parsed)],
      );
      if (!updated.rowCount) {
        const exists = await this.getBrandAnalysis(input);
        if (!exists) throw new Error("brand_analysis_not_found");
        throw new Error("brand_analysis_not_review_ready");
      }
      return mapRun(updated.rows[0] as Record<string, unknown>);
    },

    async cancelBrandAnalysis(input) {
      const cancellation = await transaction(pool, async (client) => {
        const found = await client.query(
          `select ${columns}
           from brand_analysis_runs
           where id = $1 and workspace_id = $2 and brand_id = $3
           for update`,
          [input.analysisId, input.workspaceId, input.brandId],
        );
        if (!found.rowCount) throw new Error("brand_analysis_not_found");
        const current = mapRun(found.rows[0] as Record<string, unknown>);
        if (current.status === "cancelled") return { run: current, urls: [] as string[] };
        if (current.status === "confirmed") {
          throw new Error("brand_analysis_confirmed_cannot_cancel");
        }
        await client.query(
          `update brand_analysis_runs
           set status = 'cancel_requested',
               leased_by = null,
               lease_token = null,
               lease_expires_at = null,
               cancel_requested_at = coalesce(cancel_requested_at, now()),
               updated_at = now()
           where id = $1
             and status <> 'cancelled'`,
          [input.analysisId],
        );
        const uploads = await client.query(
          `select storage_locator from (
             select coalesce(storage_url, storage_path) as storage_locator
               from brand_analysis_uploads
              where analysis_id = $1 and deleted_at is null
                and coalesce(storage_url, storage_path) is not null
             union
             select coalesce(storage_url, storage_path) as storage_locator
               from brand_analysis_upload_attempts
              where analysis_id = $1 and deleted_at is null
           ) locators
           where storage_locator is not null`,
          [input.analysisId],
        );
        await client.query(
          `update brand_analysis_upload_attempts
              set status = 'delete_pending', lease_expires_at = null
            where analysis_id = $1 and deleted_at is null`,
          [input.analysisId],
        );
        await client.query(
          `update brand_analysis_uploads
           set cleanup_status = 'pending'
           where analysis_id = $1 and deleted_at is null
             and coalesce(storage_url, storage_path) is not null`,
          [input.analysisId],
        );
        const purging = await client.query(
          `update brand_analysis_runs
           set status = 'purging', updated_at = now()
           where id = $1
           returning ${columns}`,
          [input.analysisId],
        );
        return {
          run: mapRun(purging.rows[0] as Record<string, unknown>),
          urls: [...new Set(uploads.rows.map((row) => String(row.storage_locator)).filter(Boolean))],
        };
      });
      if (cancellation.run.status === "cancelled") return cancellation.run;
      if (cancellation.urls.length) {
        if (!options.deleteBlobs) {
          await pool.query(
            `update brand_analysis_uploads
             set cleanup_status = 'failed'
             where analysis_id = $1 and deleted_at is null`,
            [input.analysisId],
          );
          throw new Error("brand_analysis_storage_not_configured");
        }
        try {
          await options.deleteBlobs(cancellation.urls);
        } catch (error) {
          await pool.query(
            `update brand_analysis_uploads
             set cleanup_status = 'failed'
             where analysis_id = $1 and deleted_at is null`,
            [input.analysisId],
          );
          throw error;
        }
      }
      return transaction(pool, async (client) => {
        const found = await client.query(
          `select ${columns}
           from brand_analysis_runs
           where id = $1 and workspace_id = $2 and brand_id = $3
           for update`,
          [input.analysisId, input.workspaceId, input.brandId],
        );
        if (!found.rowCount) throw new Error("brand_analysis_not_found");
        const current = mapRun(found.rows[0] as Record<string, unknown>);
        if (current.status === "cancelled") return current;
        if (current.status !== "purging" && current.status !== "cancel_requested") {
          throw new Error("brand_analysis_cancel_state_invalid");
        }
        await client.query(
          "delete from brand_analysis_uploads where analysis_id = $1",
          [input.analysisId],
        );
        const cancelled = await client.query(
          `update brand_analysis_runs
           set status = 'cancelled',
               input_json = '{}'::jsonb,
               evidence_json = '[]'::jsonb,
               result_json = null,
               edited_result_json = null,
               completed_at = coalesce(completed_at, now()),
               purged_at = coalesce(purged_at, now()),
               error_code = null,
               error_message = null,
               tombstone_expires_at = coalesce(tombstone_expires_at, now() + interval '24 hours'),
               updated_at = now()
           where id = $1
           returning ${columns}`,
          [input.analysisId],
        );
        return mapRun(cancelled.rows[0] as Record<string, unknown>);
      });
    },

    async retryBrandAnalysis(input) {
      return transaction(pool, async (client) => {
        const found = await client.query(
          `select id from brand_analysis_runs
            where id = $1 and workspace_id = $2 and brand_id = $3
              and status = 'failed'
              and (retention_expires_at is null or retention_expires_at > now())
            for update`,
          [input.analysisId, input.workspaceId, input.brandId],
        );
        if (!found.rowCount) throw new Error("brand_analysis_not_retryable");
        await client.query(
          "delete from brand_analysis_stage_runs where analysis_id = $1",
          [input.analysisId],
        );
        const updated = await client.query(
          `update brand_analysis_runs set
             status = case when pipeline_version = 2 then 'waiting_for_resource' else 'queued' end,
             current_stage = null, active_started_at = null, deadline_at = null,
             completed_at = null, retention_expires_at = null,
             error_code = null, error_message = null,
             leased_by = null, lease_token = null, lease_expires_at = null,
             attempt_count = 0,
             evidence_json = '[]'::jsonb, result_json = null, edited_result_json = null,
             selected_page_count = 0, successful_page_count = 0, failed_page_count = 0,
             required_page_count = 0, external_page_count = 0, offering_count = 0,
             completed_cli_stage_count = 0, total_cli_stage_count = 8,
             logical_call_count = 0, retry_call_count = 0, physical_cli_count = 0,
             state_version = state_version + 1, updated_at = now()
           where id = $1
           returning ${columns}`,
          [input.analysisId],
        );
        return mapRun(updated.rows[0] as Record<string, unknown>);
      });
    },

    async confirmBrandAnalysis(input) {
      return transaction(pool, async (client) => {
        const found = await client.query(
          `select ${columns} from brand_analysis_runs
            where id = $1 and workspace_id = $2 and brand_id = $3 for update`,
          [input.analysisId, input.workspaceId, input.brandId],
        );
        if (!found.rowCount) throw new Error("brand_analysis_not_found");
        const current = mapRun(found.rows[0] as Record<string, unknown>);
        if (current.status === "confirmed" && current.isActive) return current;
        if (current.status !== "review_ready" || !current.effectiveResult) {
          throw new Error("brand_analysis_not_review_ready");
        }
        const effective = parseBrandIntelligenceResult(
          input.editedResult ?? current.effectiveResult,
        );
        const common = toBrandIntelligenceCommonView(effective, input.companyName ?? current.input.companyName);
        if (!effective.companyOverview || !effective.businessDescription
          || !effective.primaryCategory || !effective.primaryTarget
          || !effective.coreAppeal
          || (effective.contractVersion === "brand-intelligence-result.v2"
            && !effective.valueProposition)) {
          throw new Error("brand_analysis_required_fields_missing");
        }
        const requestedCompanyName = input.companyName
          ?? current.input.companyName
          ?? null;
        if (requestedCompanyName) {
          const companyName = requestedCompanyName.normalize("NFKC").trim();
          if (!companyName || Array.from(companyName).length > 100
            || /[\u0000-\u001f\u007f]/.test(companyName)) {
            throw new Error("brand_analysis_company_name_invalid");
          }
          const workspaceBrands = await client.query(
            `select id, name from brands
              where workspace_id = $1 and deleted_at is null
              order by id
              for update`,
            [input.workspaceId],
          );
          const companyKey = companyName.toLocaleLowerCase("ko-KR");
          if (workspaceBrands.rows.some((brand) => (
            String(brand.id) !== input.brandId
            && String(brand.name).normalize("NFKC").trim().toLocaleLowerCase("ko-KR")
              === companyKey
          ))) {
            throw new Error("brand_analysis_company_name_conflict");
          }
          try {
            await client.query(
              `update brands
               set name = $3,
                   company_name_state = 'confirmed',
                   company_name_confirmed_at = now()
               where id = $1 and workspace_id = $2`,
              [input.brandId, input.workspaceId, companyName],
            );
          } catch (error) {
            if ((error as { code?: unknown })?.code === "23505") {
              throw new Error("brand_analysis_company_name_conflict");
            }
            throw error;
          }
        }
        if (current.input.ownedUrl) {
          const normalizedUrl = normalizeSourceUrl(current.input.ownedUrl);
          const existingSource = await client.query(
            `select id, url from source_urls
              where workspace_id = $1 and brand_id = $2 and source_type = 'owned' and deleted_at is null
              for update`,
            [input.workspaceId, input.brandId],
          );
          if (!existingSource.rowCount) {
            await client.query(
              `insert into source_urls
                 (workspace_id, brand_id, source_type, url, url_hash, domain, status, enabled)
               values ($1, $2, 'owned', $3, $4, $5, 'active', true)`,
              [
                input.workspaceId,
                input.brandId,
                normalizedUrl,
                hashSourceUrl(normalizedUrl),
                normalizeSourceDomain(normalizedUrl),
              ],
            );
          } else if (normalizeSourceUrl(String(existingSource.rows[0]!.url)) !== normalizedUrl) {
            await client.query(
              `update source_urls set
                 url = $2, url_hash = $3, domain = $4, enabled = true, status = 'active',
                 title = null, meta_description = null, last_crawled_at = null,
                 last_error = null, disabled_at = null, updated_at = now()
               where id = $1`,
              [
                existingSource.rows[0]!.id,
                normalizedUrl,
                hashSourceUrl(normalizedUrl),
                normalizeSourceDomain(normalizedUrl),
              ],
            );
          }
        }
        await client.query(
          "update brand_analysis_runs set is_active = false, updated_at = now() where brand_id = $1 and is_active",
          [input.brandId],
        );
        const profile = await client.query(
          `insert into brand_profiles
             (workspace_id, brand_id, primary_customer, description, primary_category_id, active_brand_analysis_id)
           values ($1, $2, $3, $4,
             (select id from content_categories where code = $5 or lower(name) = lower($6) limit 1), $7)
           on conflict (brand_id) do update set
             primary_customer = excluded.primary_customer,
             description = excluded.description,
             primary_category_id = excluded.primary_category_id,
             active_brand_analysis_id = excluded.active_brand_analysis_id
           returning id`,
          [input.workspaceId, input.brandId, effective.primaryTarget, effective.businessDescription,
            effective.primaryCategory.code, effective.primaryCategory.name, input.analysisId],
        );
        const profileId = String(profile.rows[0]!.id);
        const compatibilityResult = effective.contractVersion === "brand-intelligence-result.v1"
          ? effective
          : {
              contractVersion: "brand-intelligence-result.v1" as const,
              companyOverview: common.companyOverview ?? "",
              businessDescription: common.businessDescription ?? "",
              primaryCategory: common.primaryCategory!,
              subcategories: common.subcategories,
              primaryTarget: common.primaryTarget ?? "",
              differentiators: common.differentiators.join("\n"),
              coreAppeal: common.coreAppeal ?? "",
              competitors: common.competitors,
              evidence: effective.evidence
                .filter((item) => item.sourceKind !== "external")
                .map((item) => ({
                  field: item.fieldPath,
                  claim: item.claim,
                  sourceId: item.sourceId,
                  sourceUrl: item.sourceUrl,
                })),
              sourceGaps: common.sourceGaps,
            };
        const mappedCore = mapAnalysisToBrandCoreDraft(compatibilityResult);
        const approvedAt = new Date().toISOString();
        const reviewState = input.actorUserId
          ? Object.fromEntries(BRAND_CORE_FIELD_PATHS.map((fieldPath) => [
              fieldPath,
              {
                decision: "approved",
                reviewerUserId: input.actorUserId,
                reviewedAt: approvedAt,
              },
            ]))
          : {};
        await client.query(
          `update brand_core_versions set status = 'superseded', updated_at = now()
            where workspace_id = $1 and brand_id = $2 and status = 'approved'`,
          [input.workspaceId, input.brandId],
        );
        const coreVersion = await client.query(
          `insert into brand_core_versions (
             workspace_id, brand_id, source_analysis_id, version, status,
             core_json, evidence_json, review_state_json, created_by,
             created_by_user_id, approved_by_user_id, approved_at
           )
           select $1, $2, $3, coalesce(max(version), 0) + 1, 'approved',
                  $4::jsonb, $5::jsonb, $6::jsonb, 'analysis_confirm', $7, $7, $8::timestamptz
             from brand_core_versions where workspace_id = $1 and brand_id = $2
           returning id`,
          [
            input.workspaceId, input.brandId, input.analysisId,
            JSON.stringify(mappedCore.core), JSON.stringify(mappedCore.evidence),
            JSON.stringify(reviewState), input.actorUserId ?? null, approvedAt,
          ],
        );
        await client.query(
          `update brand_profiles set active_brand_core_id = $3
            where workspace_id = $1 and brand_id = $2`,
          [input.workspaceId, input.brandId, coreVersion.rows[0]!.id],
        );
        await client.query(
          "delete from brand_offerings where workspace_id = $1 and brand_id = $2",
          [input.workspaceId, input.brandId],
        );
        for (const [sortOrder, offering] of common.offerings.slice(0, 5).entries()) {
          await client.query(
            `insert into brand_offerings (
               workspace_id, brand_id, source_analysis_id, offering_type, name,
               description, target_customer, benefit, price_text, purchase_url, sort_order
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              input.workspaceId, input.brandId, input.analysisId, offering.kind,
              offering.name, offering.description, offering.target, offering.benefit,
              offering.priceText, offering.purchaseUrl, sortOrder,
            ],
          );
        }
        for (const offering of common.offerings.slice(0, 5)) {
          const existingProduct = await client.query(
            `select id from product_services
              where workspace_id = $1 and brand_id = $2 and kind = $3
                and lower(regexp_replace(trim(display_name), '[[:space:]]+', ' ', 'g'))
                  = lower(regexp_replace(trim($4), '[[:space:]]+', ' ', 'g'))
              limit 1 for update`,
            [input.workspaceId, input.brandId, offering.kind, offering.name],
          );
          if (existingProduct.rowCount) continue;
          const product = await client.query(
            `insert into product_services (workspace_id, brand_id, kind, display_name)
             values ($1, $2, $3, $4)
             returning id`,
            [input.workspaceId, input.brandId, offering.kind, offering.name],
          );
          const profile = {
            contractVersion: "product-service.v1",
            name: offering.name,
            kind: offering.kind,
            description: offering.description ?? "",
            features: [],
            benefits: offering.benefit ? [offering.benefit] : [],
            cautions: [],
            audiences: offering.target ? [{ name: offering.target }] : [],
            appealsByTarget: {},
            evergreenPurchaseInfo: offering.priceText ?? "",
            sourceUrls: offering.purchaseUrl ? [offering.purchaseUrl] : [],
          };
          const approvedVersion = await client.query(
            `insert into product_service_versions (
               workspace_id, brand_id, product_service_id, version, status,
               profile_json, evidence_json, created_by_user_id,
               approved_by_user_id, approved_at
             ) values (
               $1, $2, $3, 1, 'approved', $4::jsonb, $5::jsonb, $6, $6, now()
             )
             returning id`,
            [
              input.workspaceId,
              input.brandId,
              product.rows[0]!.id,
              JSON.stringify(profile),
              JSON.stringify(offering.sourceFactIds.map((sourceFactId) => ({ sourceFactId }))),
              input.actorUserId ?? null,
            ],
          );
          await client.query(
            "update product_services set active_version_id = $2 where id = $1",
            [product.rows[0]!.id, approvedVersion.rows[0]!.id],
          );
        }
        if (effective.contractVersion === "brand-intelligence-result.v2") {
          for (const faq of effective.faqSuggestions) {
            const normalizedQuestion = faq.question
              .normalize("NFKC")
              .trim()
              .replace(/\s+/g, " ")
              .toLocaleLowerCase("ko-KR");
            await client.query(
              `insert into knowledge_entries (
                 workspace_id, brand_id, normalized_question, entry_type,
                 question, answer, title, content, category,
                 aliases, keywords, structured_data, direct_reply_enabled,
                 enabled, last_import_id, origin, provenance_json, status,
                 created_by_user_id
               ) values (
                 $1, $2, $3, 'faq',
                 $4, $5, $4, $5, $6,
                 '{}'::text[], '{}'::text[], '{}'::jsonb, true,
                 false, null, 'manual', $7::jsonb, 'draft', $8
               )
               on conflict (brand_id, normalized_question) do nothing`,
              [
                input.workspaceId,
                input.brandId,
                normalizedQuestion,
                faq.question,
                faq.answer,
                faq.category,
                JSON.stringify({
                  source: "brand_intelligence",
                  analysisId: input.analysisId,
                  sourceFactIds: faq.sourceFactIds,
                }),
                input.actorUserId ?? null,
              ],
            );
          }
        }
        await client.query("delete from brand_profile_subcategories where brand_profile_id = $1", [profileId]);
        for (const subcategory of effective.subcategories) {
          let inserted = { rowCount: 0 as number | null };
          inserted = await client.query(
              `insert into brand_profile_subcategories
                 (workspace_id, brand_id, brand_profile_id, subcategory_id)
               select $1, $2, $3, id from content_subcategories
                where code = $4 or lower(name) = lower($5)
               on conflict do nothing`,
              [input.workspaceId, input.brandId, profileId, subcategory.code, subcategory.name],
            );
          if (!inserted.rowCount) {
            const customName = subcategory.name.normalize("NFKC").trim();
            if (Array.from(customName).length > 30) throw new Error("brand_analysis_subcategory_too_long");
            const customKey = customName.toLocaleLowerCase("ko-KR");
            await client.query(
              `insert into brand_profile_subcategories
                 (workspace_id, brand_id, brand_profile_id, custom_name, custom_key)
               values ($1, $2, $3, $4, $5)
               on conflict do nothing`,
              [input.workspaceId, input.brandId, profileId, customName, customKey],
            );
          }
        }
        const knowledgeImport = await client.query(
          `insert into knowledge_imports
             (workspace_id, brand_id, file_name, source_rows, result_json, status)
           values ($1, $2, $3, '[]'::jsonb, $4::jsonb, 'succeeded')
           returning id`,
          [
            input.workspaceId,
            input.brandId,
            `brand-intelligence-${input.analysisId}.json`,
            JSON.stringify({ analysisId: input.analysisId, source: "confirmed_brand_intelligence" }),
          ],
        );
        const knowledgeContent = [
          `기업 개요\n${effective.companyOverview}`,
          `사업 소개\n${effective.businessDescription}`,
          `대표 분야\n${effective.primaryCategory.name}`,
          `세부 분야\n${effective.subcategories.map((item) => item.name).join(", ") || "없음"}`,
          `핵심 타깃\n${effective.primaryTarget}`,
          `차별점\n${effective.differentiators}`,
          `핵심 소구점\n${effective.coreAppeal}`,
        ].join("\n\n");
        await client.query(
          `insert into knowledge_entries (
             workspace_id, brand_id, normalized_question, entry_type, title, content,
             aliases, keywords, structured_data, direct_reply_enabled, last_import_id
           ) values (
             $1, $2, '__confirmed_brand_intelligence__', 'policy', '확정된 브랜드 정보', $3,
             '{}'::text[], array['브랜드', '회사', '사업', '타깃', '차별점', '소구점'],
             $4::jsonb, false, $5
           )
           on conflict (brand_id, normalized_question) do update set
             title = excluded.title, content = excluded.content, keywords = excluded.keywords,
             structured_data = excluded.structured_data, direct_reply_enabled = false,
             enabled = true, last_import_id = excluded.last_import_id, updated_at = now()`,
          [input.workspaceId, input.brandId, knowledgeContent, JSON.stringify(effective), knowledgeImport.rows[0]!.id],
        );
        const activeBuild = await client.query(
          `select id, status from wiki_build_requests
            where workspace_id = $1 and brand_id = $2 and status in ('pending', 'building')
            limit 1 for update`,
          [input.workspaceId, input.brandId],
        );
        if (activeBuild.rowCount) {
          await client.query(
            `update wiki_build_requests set requested_revision = requested_revision + 1,
              rebuild_requested = rebuild_requested or status = 'building', updated_at = now()
              where id = $1`,
            [activeBuild.rows[0]!.id],
          );
        } else {
          await client.query(
            "insert into wiki_build_requests (workspace_id, brand_id) values ($1, $2)",
            [input.workspaceId, input.brandId],
          );
        }
        const confirmed = await client.query(
          `update brand_analysis_runs set status = 'confirmed', is_active = true,
             edited_result_json = $2::jsonb, confirmed_at = coalesce(confirmed_at, now()),
             completed_at = coalesce(completed_at, now()), updated_at = now()
           where id = $1 returning ${columns}`,
          [input.analysisId, JSON.stringify(effective)],
        );
        return mapRun(confirmed.rows[0] as Record<string, unknown>);
      });
    },

    async claimBrandAnalysis(input) {
      return transaction(pool, async (client) => {
        const supportedPipelineVersions = [...new Set(
          (input.supportedPipelineVersions ?? [1, 2])
            .filter((version) => Number.isSafeInteger(version) && version > 0),
        )];
        if (!supportedPipelineVersions.length) {
          throw new Error("brand_analysis_pipeline_versions_invalid");
        }
        const leaseToken = randomUUID();
        const claimed = await client.query(
          `with candidate as (
             select id from brand_analysis_runs
              where available_at <= now() and attempt_count < 3
                and pipeline_version = any($4::int[])
                and (status in ('queued', 'waiting_for_resource')
                  or (status in ('extracting', 'analyzing', 'running', 'finalizing')
                    and lease_expires_at <= now()
                    and (deadline_at is null or deadline_at > now())))
              order by available_at, created_at, id
              for update skip locked limit 1
           )
           update brand_analysis_runs run
              set status = case
                    when run.pipeline_version = 2 then 'running'
                    when run.status = 'queued' then 'extracting'
                    else run.status
                  end,
                  current_stage = case
                    when run.pipeline_version = 2 then coalesce(run.current_stage, 'discovering_pages')
                    else run.current_stage
                  end,
                  leased_by = $1, lease_token = $2,
                  lease_expires_at = now() + ($3 * interval '1 second'),
                  active_started_at = coalesce(run.active_started_at, now()),
                  deadline_at = coalesce(run.deadline_at, now() + interval '20 minutes'),
                  attempt_count = run.attempt_count + 1, error_code = null, error_message = null,
                  updated_at = now()
             from candidate where run.id = candidate.id
           returning run.*`,
          [input.workerId, leaseToken, input.leaseSeconds, supportedPipelineVersions],
        );
        if (!claimed.rowCount) return null;
        const run = mapRun(claimed.rows[0] as Record<string, unknown>);
        const uploads = await client.query(
          `select id, file_name, mime_type, byte_size, checksum, storage_url
             from brand_analysis_uploads
            where analysis_id = $1 and deleted_at is null and upload_status = 'uploaded'
            order by created_at, id`,
          [run.id],
        );
        return {
          ...run,
          executionContract: run.pipelineVersion === 2 ? {
            ownedPageLimit: 20,
            externalPageLimit: 10,
            offeringLimit: 5,
            pipelineVersion: 2,
            promptVersion: "brand-intelligence-v2.1",
            resultContractVersion: "brand-intelligence-result.v2",
          } : null,
          uploads: uploads.rows.map((row) => ({
            id: String(row.id),
            fileName: String(row.file_name),
            mimeType: String(row.mime_type),
            byteSize: Number(row.byte_size),
            checksum: String(row.checksum),
            accessUrl: String(row.storage_url),
          })),
        } as BrandAnalysisClaim;
      });
    },

    async listBrandAnalysisUploads(input) {
      const found = await pool.query(
        `select id, file_name, mime_type, byte_size, storage_url
          from brand_analysis_uploads
          where analysis_id = $1 and deleted_at is null and upload_status = 'uploaded'
          order by created_at, id`,
        [input.analysisId],
      );
      return found.rows.map((row) => ({
        id: String(row.id), fileName: String(row.file_name), mimeType: String(row.mime_type),
        byteSize: Number(row.byte_size), storageUrl: String(row.storage_url),
      }));
    },

    async getBrandAnalysisUploadForDownload(input) {
      const found = await pool.query(
        `select upload.storage_url, upload.mime_type, upload.byte_size
           from brand_analysis_uploads upload
           join brand_analysis_runs run on run.id = upload.analysis_id
          where upload.id = $1 and upload.analysis_id = $2
            and upload.upload_status = 'uploaded'
            and upload.deleted_at is null
            and run.status in ('running', 'finalizing')
            and run.deadline_at > now()`,
        [input.uploadId, input.analysisId],
      );
      if (!found.rowCount || !found.rows[0]!.storage_url) return null;
      return {
        storageUrl: String(found.rows[0]!.storage_url),
        mimeType: String(found.rows[0]!.mime_type),
        byteSize: Number(found.rows[0]!.byte_size),
      };
    },

    async markBrandEvidenceReady(input) {
      return transaction(pool, async (client) => {
        const found = await client.query("select * from brand_analysis_runs where id = $1 for update", [input.analysisId]);
        assertLease(found.rows[0] as Record<string, unknown> | undefined, input);
        if (String(found.rows[0]!.status) !== "extracting") throw new Error("brand_analysis_stage_invalid");
        const updated = await client.query(
          `update brand_analysis_runs set status = 'analyzing', evidence_json = $2::jsonb,
             updated_at = now() where id = $1 returning ${columns}`,
          [input.analysisId, JSON.stringify(input.evidence)],
        );
        return mapRun(updated.rows[0] as Record<string, unknown>) as BrandAnalysisClaim;
      });
    },

    async heartbeatBrandAnalysis(input) {
      const updated = await pool.query(
        `update brand_analysis_runs
            set lease_expires_at = least(
                  now() + ($4 * interval '1 second'),
                  coalesce(deadline_at, now() + ($4 * interval '1 second'))
                ),
                updated_at = now()
          where id = $1 and leased_by = $2 and lease_token = $3
            and status in ('extracting', 'analyzing', 'running', 'finalizing')
            and lease_expires_at > now()
            and deadline_at > now()`,
        [input.analysisId, input.workerId, input.leaseToken, input.leaseSeconds],
      );
      if (updated.rowCount) {
        const current = await pool.query(
          "select deadline_at from brand_analysis_runs where id = $1",
          [input.analysisId],
        );
        return { alive: true, cancelRequested: false, deadlineAt: iso(current.rows[0]?.deadline_at) };
      }
      const current = await pool.query(
        "select status, deadline_at from brand_analysis_runs where id = $1",
        [input.analysisId],
      );
      return {
        alive: false,
        cancelRequested: ["cancel_requested", "purging", "cancelled"].includes(String(current.rows[0]?.status)),
        deadlineAt: iso(current.rows[0]?.deadline_at),
      };
    },

    async progressBrandAnalysis(input) {
      return transaction(pool, async (client) => {
        const found = await client.query(
          "select * from brand_analysis_runs where id = $1 for update",
          [input.analysisId],
        );
        assertLease(found.rows[0] as Record<string, unknown> | undefined, input);
        const attempt = input.attempt ?? 1;
        const status = input.status ?? "succeeded";
        const stageKey = `${input.stage}:${attempt}`;
        const stageRun = await client.query(
          `insert into brand_analysis_stage_runs
             (analysis_id, stage_code, stage_instance_key, attempt, status, started_at,
              finished_at, duration_ms, input_count, success_count, failed_count, error_code)
           values ($1, $2, $3, $4, $5, now(),
             case when $5 = 'running' then null else now() end,
             case when $5 = 'running' then null else 0 end, $6, $7, $8, $9)
           on conflict (analysis_id, stage_instance_key) do update set
             status = excluded.status,
             finished_at = case when excluded.status = 'running' then null else now() end,
             duration_ms = case when excluded.status = 'running' then null else
               greatest(0, (extract(epoch from
                 (now() - brand_analysis_stage_runs.started_at)) * 1000)::int) end,
             input_count = excluded.input_count, success_count = excluded.success_count,
             failed_count = excluded.failed_count, error_code = excluded.error_code
           returning id`,
          [
            input.analysisId, input.stage, stageKey, attempt, status,
            input.inputCount, input.successCount, input.failedCount, input.errorCode ?? null,
          ],
        );
        if (input.logicalIndex !== undefined && input.physicalAttempt !== undefined) {
          const call = await client.query(
            `insert into brand_analysis_cli_calls
               (analysis_id, stage_run_id, logical_call_key, logical_index, status, finished_at)
             values ($1, $2, $3, $4, $5,
               case when $5 = 'running' then null else now() end)
             on conflict (analysis_id, logical_call_key) do update set
               stage_run_id = excluded.stage_run_id,
               status = excluded.status,
               finished_at = case when excluded.status = 'running' then null else now() end
             returning id`,
            [
              input.analysisId, stageRun.rows[0]!.id, input.stage,
              input.logicalIndex, status,
            ],
          );
          await client.query(
            `insert into brand_analysis_cli_attempts
               (call_id, physical_attempt, status, started_at, finished_at, duration_ms, error_code)
             values ($1, $2, $3, now(),
               case when $3 = 'running' then null else now() end,
               case when $3 = 'running' then null else 0 end, $4)
             on conflict (call_id, physical_attempt) do update set
               status = excluded.status,
               finished_at = case when excluded.status = 'running' then null else now() end,
               duration_ms = case when excluded.status = 'running' then null else
                 greatest(0, (extract(epoch from
                   (now() - brand_analysis_cli_attempts.started_at)) * 1000)::int) end,
               error_code = excluded.error_code`,
            [call.rows[0]!.id, input.physicalAttempt, status, input.errorCode ?? null],
          );
        }
        const updated = await client.query(
          `update brand_analysis_runs set
             status = case
               when $2 = 'final_audit' and status = 'running' then 'finalizing'
               else status
             end,
             current_stage = $2,
             selected_page_count = coalesce($3, selected_page_count),
             successful_page_count = coalesce($4, successful_page_count),
             failed_page_count = coalesce($5, failed_page_count),
             required_page_count = coalesce($6, required_page_count),
             completed_cli_stage_count = coalesce($7, completed_cli_stage_count),
             total_cli_stage_count = coalesce($8, total_cli_stage_count),
             logical_call_count = case when $9 then (
               select count(*)::integer from brand_analysis_cli_calls
               where analysis_id = $1 and status = 'succeeded'
             ) else logical_call_count end,
             physical_cli_count = case when $9 then (
               select count(*)::integer from brand_analysis_cli_attempts attempt
               join brand_analysis_cli_calls call on call.id = attempt.call_id
               where call.analysis_id = $1
             ) else physical_cli_count end,
             retry_call_count = case when $9 then greatest(0, (
               select count(*)::integer from brand_analysis_cli_attempts attempt
               join brand_analysis_cli_calls call on call.id = attempt.call_id
               where call.analysis_id = $1
             ) - (
               select count(*)::integer from brand_analysis_cli_calls
               where analysis_id = $1
             )) else retry_call_count end,
             state_version = state_version + 1,
             updated_at = now()
           where id = $1 returning ${columns}`,
          [
            input.analysisId, input.stage, input.selectedPageCount ?? null,
            input.successfulPageCount ?? null, input.failedPageCount ?? null,
            input.requiredPageCount ?? null, input.completedCliStageCount ?? null,
            input.totalCliStageCount ?? null, input.logicalIndex !== undefined,
          ],
        );
        return mapRun(updated.rows[0] as Record<string, unknown>);
      });
    },

    async markBrandAnalysisCancelled(input) {
      const found = await pool.query(
        `select workspace_id, brand_id from brand_analysis_runs
          where id = $1 and (leased_by = $2 or status in ('cancel_requested', 'purging', 'cancelled'))`,
        [input.analysisId, input.workerId],
      );
      if (!found.rowCount) throw new Error("brand_analysis_lease_invalid");
      return this.cancelBrandAnalysis({
        analysisId: input.analysisId,
        workspaceId: String(found.rows[0]!.workspace_id),
        brandId: String(found.rows[0]!.brand_id),
      });
    },

    async completeBrandAnalysis(input) {
      return transaction(pool, async (client) => {
        const found = await client.query("select * from brand_analysis_runs where id = $1 for update", [input.analysisId]);
        assertLease(found.rows[0] as Record<string, unknown> | undefined, input);
        const evidence = input.evidence
          ?? json<BrandEvidenceDocument[]>(found.rows[0]!.evidence_json, []);
        const pipelineVersion = Number(found.rows[0]!.pipeline_version ?? 1);
        const contractVersion = String(
          found.rows[0]!.contract_version ?? "brand-intelligence-result.v1",
        );
        if (pipelineVersion === 2
          && contractVersion !== "brand-intelligence-result.v2") {
          throw new Error("brand_intelligence_execution_contract_mismatch");
        }
        const parsed = parseBrandIntelligenceResult(input.result, pipelineVersion === 2 ? {
          ownedFactIds: input.registry?.ownedFactIds
            ? new Set(input.registry.ownedFactIds)
            : undefined,
          ownedSourceIds: new Set(evidence
            .filter((source) => source.sourceType === "owned_url")
            .map((source) => source.sourceId)),
          uploadSourceIds: new Set(evidence
            .filter((source) => source.sourceType !== "owned_url")
            .map((source) => source.sourceId)),
          externalSources: input.registry?.externalSources
            ? new Map(input.registry.externalSources.map((source) => [source.url, source.sourceId]))
            : undefined,
        } : undefined);
        if (pipelineVersion === 2
          && parsed.contractVersion !== "brand-intelligence-result.v2") {
          throw new Error("brand_intelligence_execution_contract_mismatch");
        }
        if (pipelineVersion === 2
          && (!input.registry?.ownedFactIds || !input.registry.externalSources)) {
          throw new Error("brand_intelligence_validation_registry_required");
        }
        assertV2EvidenceGrounding(parsed, evidence);
        const storedEvidence = pipelineVersion === 2
          ? evidence.map((source) => ({
              ...source,
              textBlocks: [],
              tables: [],
            }))
          : evidence;
        const updated = await client.query(
          `update brand_analysis_runs set status = 'review_ready', evidence_json = $2::jsonb,
             result_json = $3::jsonb, leased_by = null, lease_token = null, lease_expires_at = null,
             completed_at = now(), updated_at = now() where id = $1 returning ${columns}`,
          [input.analysisId, JSON.stringify(storedEvidence), JSON.stringify(parsed)],
        );
        return mapRun(updated.rows[0] as Record<string, unknown>);
      });
    },

    async failBrandAnalysis(input) {
      return transaction(pool, async (client) => {
        const found = await client.query("select * from brand_analysis_runs where id = $1 for update", [input.analysisId]);
        assertLease(found.rows[0] as Record<string, unknown> | undefined, input);
        const attempts = Number(found.rows[0]!.attempt_count ?? 0);
        const pipelineVersion = Number(found.rows[0]!.pipeline_version ?? 1);
        // V2 owns its bounded physical retries inside one staged runner. Requeueing
        // the whole run would reset that budget and could exceed the 10-call cap.
        const retry = pipelineVersion === 1 && input.retryable && attempts < 3;
        const updated = await client.query(
          `update brand_analysis_runs set status = $2,
             available_at = case when $3::boolean then now() + interval '5 minutes' else available_at end,
             leased_by = null, lease_token = null, lease_expires_at = null,
             error_code = $4, error_message = $5,
             completed_at = case when $3::boolean then completed_at else now() end,
             retention_expires_at = case when $3::boolean then retention_expires_at
               else now() + interval '24 hours' end,
             updated_at = now() where id = $1 returning ${columns}`,
          // Worker stderr/provider detail can contain prompts, URLs, or source text.
          // Persist only the allow-listed public-safe code in run-control storage.
          [input.analysisId, retry ? "queued" : "failed", retry, input.errorCode, input.errorCode],
        );
        return mapRun(updated.rows[0] as Record<string, unknown>);
      });
    },
  };
}
