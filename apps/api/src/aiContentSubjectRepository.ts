import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import {
  type CreateSubjectAnalysisInput,
  type CreateSubjectPipelineInput,
  parseSubjectAnalysisResultV2,
  parseSubjectAppealResultV2,
  parseSubjectAnalysisResult,
  type SubjectAnalysisResultV1,
  type SubjectAnalysisResultV2,
  type SubjectAnalysisStatus,
  type SubjectAppeal,
  type SubjectAppealResultV2,
  type SubjectManualInput,
  type SubjectPipelineStatus,
  type SubjectTarget,
  type SubjectType,
} from "./aiContentSubjectContracts.js";

export interface SubjectBrandScope {
  workspaceId: string;
  brandId: string;
}

export interface CreateSubjectPipelineRepositoryInput extends CreateSubjectPipelineInput {
  brandContext: Record<string, unknown>;
}

export interface SubjectImageRecord {
  id: string;
  analysisId: string;
  sourceUrl: string;
  storageUrl: string;
  storagePath: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  altText: string;
  role: "product" | "service" | "logo" | "detail" | "unknown";
  selectionScore: number;
  createdAt: string;
}

export interface SubjectAnalysisRecord extends SubjectBrandScope {
  id: string;
  generationId?: string | null;
  contractVersion?: "subject-analysis.v1" | "subject-analysis.v2";
  subjectType: SubjectType;
  sourceUrl: string;
  normalizedUrl: string;
  input: SubjectManualInput & { promotionOrTerms?: string };
  brandContext?: Record<string, unknown>;
  attachmentIds?: string[];
  status: SubjectAnalysisStatus | SubjectPipelineStatus;
  facts: Array<{ key: string; value: string; sourceUrl: string }>;
  structuredData: Record<string, unknown>;
  research: Record<string, unknown>;
  analysisResult?: SubjectAnalysisResultV2 | null;
  sourceGaps?: string[];
  targets: SubjectTarget[];
  appealsByTarget: Record<string, SubjectAppeal[]>;
  selectedImageId: string | null;
  images: SubjectImageRecord[];
  analysisVersion: number;
  idempotencyKey: string;
  leasedBy: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  availableAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface SubjectAnalysisClaim extends SubjectAnalysisRecord {
  leasedBy: string;
  leaseToken: string;
  leaseExpiresAt: string;
  status: "extracting" | "researching" | "analyzing" | "generating_appeals";
  phase?: "analysis" | "appeal";
}

export interface SubjectLeaseIdentity {
  analysisId: string;
  workerId: string;
  leaseToken: string;
}

export interface SubjectExtractionImage {
  sourceUrl: string;
  storageUrl: string;
  storagePath: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  altText: string;
  role: SubjectImageRecord["role"];
  selectionScore?: number;
}

export interface SubjectExtractionCompletion extends SubjectLeaseIdentity {
  facts: SubjectAnalysisRecord["facts"];
  structuredData: Record<string, unknown>;
  images: SubjectExtractionImage[];
}

export interface SubjectAnalysisRepository {
  getCachedSubjectAnalysis(input: SubjectBrandScope & { subjectType: SubjectType; sourceUrl: string }): Promise<SubjectAnalysisRecord | null>;
  requestSubjectAnalysis(input: SubjectBrandScope & CreateSubjectAnalysisInput): Promise<SubjectAnalysisRecord>;
  requestSubjectAnalysis(input: SubjectBrandScope & CreateSubjectPipelineRepositoryInput): Promise<SubjectAnalysisRecord>;
  getSubjectAnalysis(input: SubjectBrandScope & { analysisId: string }): Promise<SubjectAnalysisRecord | null>;
  selectSubjectImage(input: SubjectBrandScope & { analysisId: string; imageId: string }): Promise<SubjectAnalysisRecord>;
  claimSubjectAnalysis(input: { workerId: string; leaseSeconds: number }): Promise<SubjectAnalysisClaim | null>;
  markSubjectExtractionComplete(input: SubjectExtractionCompletion): Promise<SubjectAnalysisClaim>;
  heartbeatSubjectAnalysis(input: SubjectLeaseIdentity & { leaseSeconds: number }): Promise<boolean>;
  completeSubjectAnalysis(input: SubjectLeaseIdentity & (SubjectAnalysisResultV1 | SubjectAnalysisResultV2)): Promise<SubjectAnalysisRecord>;
  completeSubjectAppeals(input: SubjectLeaseIdentity & SubjectAppealResultV2): Promise<SubjectAnalysisRecord>;
  regenerateSubjectAppeals(input: SubjectBrandScope & {
    analysisId: string;
    idempotencyKey: string;
  }): Promise<SubjectAnalysisRecord>;
  failSubjectAnalysis(input: SubjectLeaseIdentity & { errorCode: string; errorMessage: string; retryable: boolean }): Promise<SubjectAnalysisRecord>;
}

type Queryable = Pick<PoolClient, "query">;

interface SubjectPipelineInputEnvelope {
  manualInput: CreateSubjectPipelineInput["manualInput"];
  brandContext: Record<string, unknown>;
}

const ANALYSIS_COLUMNS = `
  id, workspace_id, brand_id, generation_id, contract_version, subject_type,
  source_url, normalized_url, input_json, attachment_ids_json, analysis_result_json,
  status, facts_json, structured_data_json, research_json, targets_json, appeals_json,
  selected_image_id, analysis_version, idempotency_key, leased_by, lease_token,
  lease_expires_at, attempt_count, available_at, error_code, error_message,
  superseded_at, created_at, updated_at, completed_at`;

export const SUBJECT_ANALYSIS_INSERT_SQL = `
  insert into ai_content_subject_analyses
    (id, workspace_id, brand_id, subject_type, source_url, normalized_url,
     input_json, status, analysis_version, idempotency_key)
  values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'queued', $8, $9)
  on conflict do nothing
  returning ${ANALYSIS_COLUMNS}`;

export const SUBJECT_PIPELINE_INSERT_SQL = `
  insert into ai_content_subject_analyses
    (id, workspace_id, brand_id, generation_id, contract_version, subject_type,
     source_url, normalized_url, input_json, attachment_ids_json, status,
     analysis_version, idempotency_key)
  values ($1, $2, $3, $4, 'subject-analysis.v2', $5, $6, $7,
          $8::jsonb, $9::jsonb, 'queued', $10, $11)
  on conflict do nothing
  returning ${ANALYSIS_COLUMNS}`;

export const SUBJECT_ANALYSIS_CLAIM_SQL = `
  with candidate as (
    select id
      from ai_content_subject_analyses
     where superseded_at is null
       and available_at <= now()
       and attempt_count < 3
       and (
         status = 'queued'
         or (
           status in ('extracting', 'researching', 'analyzing', 'generating_appeals')
           and (lease_expires_at is null or lease_expires_at <= now())
         )
       )
     order by available_at, created_at, id
     for update skip locked
     limit 1
  )
  update ai_content_subject_analyses analysis
     set status = case when analysis.status = 'queued' then 'extracting' else analysis.status end,
         leased_by = $1, lease_token = $2,
         lease_expires_at = now() + ($3 * interval '1 second'),
         attempt_count = analysis.attempt_count + 1,
         error_code = null, error_message = null, updated_at = now()
    from candidate
   where analysis.id = candidate.id
  returning analysis.*`;

function iso(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return jsonObject(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function jsonArray<T>(value: unknown): T[] {
  if (typeof value === "string") {
    try { return jsonArray<T>(JSON.parse(value)); } catch { return []; }
  }
  return Array.isArray(value) ? value as T[] : [];
}

function v2ResultContext(row: Record<string, unknown>) {
  return {
    expectedSubjectType: row.subject_type as SubjectType,
    allowedAttachmentIds: jsonArray<string>(row.attachment_ids_json),
  };
}

function pipelineInputEnvelope(value: unknown): SubjectPipelineInputEnvelope {
  const stored = jsonObject(value);
  const nestedManualInput = jsonObject(stored.manualInput);
  const manualInput = Object.keys(nestedManualInput).length ? nestedManualInput : stored;
  return {
    manualInput: {
      name: typeof manualInput.name === "string" ? manualInput.name : "",
      promotionOrTerms: typeof manualInput.promotionOrTerms === "string" ? manualInput.promotionOrTerms : "",
      description: typeof manualInput.description === "string" ? manualInput.description : "",
    },
    brandContext: jsonObject(stored.brandContext),
  };
}

export function normalizeSubjectUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("subject_analysis_source_url_invalid"); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("subject_analysis_source_url_invalid");
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || ["fbclid", "gclid"].includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\?$/, "");
}

function mapImage(row: Record<string, unknown>): SubjectImageRecord {
  return {
    id: String(row.id),
    analysisId: String(row.analysis_id),
    sourceUrl: String(row.source_url),
    storageUrl: String(row.storage_url),
    storagePath: String(row.storage_path),
    width: row.width === null || row.width === undefined ? null : Number(row.width),
    height: row.height === null || row.height === undefined ? null : Number(row.height),
    mimeType: String(row.mime_type),
    altText: row.alt_text === null || row.alt_text === undefined ? "" : String(row.alt_text),
    role: row.role as SubjectImageRecord["role"],
    selectionScore: Number(row.selection_score ?? 0),
    createdAt: iso(row.created_at)!,
  };
}

function mapAnalysis(row: Record<string, unknown>, images: SubjectImageRecord[]): SubjectAnalysisRecord {
  const contractVersion = row.contract_version === "subject-analysis.v2"
    ? "subject-analysis.v2"
    : "subject-analysis.v1";
  const storedInput = jsonObject(row.input_json);
  const pipelineInput = pipelineInputEnvelope(storedInput);
  const input = contractVersion === "subject-analysis.v2" ? pipelineInput.manualInput : storedInput;
  const analysisResultJson = jsonObject(row.analysis_result_json);
  const analysisResult = contractVersion === "subject-analysis.v2" && Object.keys(analysisResultJson).length
    ? analysisResultJson as unknown as SubjectAnalysisResultV2
    : null;
  const research = jsonObject(row.research_json);
  const promotionOrTerms = typeof input.promotionOrTerms === "string" ? input.promotionOrTerms : "";
  const promotion = contractVersion === "subject-analysis.v2"
    ? promotionOrTerms
    : typeof storedInput.promotion === "string" ? storedInput.promotion : "";
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    generationId: row.generation_id ? String(row.generation_id) : null,
    contractVersion,
    subjectType: row.subject_type as SubjectType,
    sourceUrl: row.source_url === null || row.source_url === undefined ? "" : String(row.source_url),
    normalizedUrl: row.normalized_url === null || row.normalized_url === undefined ? "" : String(row.normalized_url),
    input: {
      name: typeof input.name === "string" ? input.name : "",
      promotion,
      description: typeof input.description === "string" ? input.description : "",
      ...(contractVersion === "subject-analysis.v2" ? { promotionOrTerms } : {}),
    },
    ...(contractVersion === "subject-analysis.v2" ? {
      brandContext: pipelineInput.brandContext,
    } : {}),
    attachmentIds: jsonArray(row.attachment_ids_json),
    status: row.status as SubjectAnalysisRecord["status"],
    facts: jsonArray(row.facts_json),
    structuredData: jsonObject(row.structured_data_json),
    research,
    analysisResult,
    sourceGaps: analysisResult?.sourceGaps ?? jsonArray(research.sourceGaps),
    targets: jsonArray(row.targets_json),
    appealsByTarget: jsonObject(row.appeals_json) as Record<string, SubjectAppeal[]>,
    selectedImageId: row.selected_image_id ? String(row.selected_image_id) : null,
    images,
    analysisVersion: Number(row.analysis_version),
    idempotencyKey: String(row.idempotency_key),
    leasedBy: row.leased_by ? String(row.leased_by) : null,
    leaseToken: row.lease_token ? String(row.lease_token) : null,
    leaseExpiresAt: iso(row.lease_expires_at),
    attemptCount: Number(row.attempt_count),
    availableAt: iso(row.available_at)!,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    supersededAt: iso(row.superseded_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    completedAt: iso(row.completed_at),
  };
}

function mapClaim(row: Record<string, unknown>, images: SubjectImageRecord[]): SubjectAnalysisClaim {
  const analysis = mapAnalysis(row, images);
  return {
    ...analysis,
    leasedBy: String(row.leased_by),
    leaseToken: String(row.lease_token),
    leaseExpiresAt: iso(row.lease_expires_at)!,
    status: row.status as SubjectAnalysisClaim["status"],
    phase: row.contract_version === "subject-analysis.v2" && row.status === "generating_appeals"
      ? "appeal"
      : "analysis",
  };
}

async function loadImages(client: Queryable, analysisId: string): Promise<SubjectImageRecord[]> {
  const result = await client.query(
    `select id, analysis_id, source_url, storage_url, storage_path, width, height,
            mime_type, alt_text, role, selection_score, created_at
       from ai_content_subject_images
      where analysis_id = $1 and deleted_at is null
      order by selection_score desc, created_at, id`,
    [analysisId],
  );
  return result.rows.map((row) => mapImage(row as Record<string, unknown>));
}

async function loadAnalysis(client: Queryable, analysisId: string): Promise<SubjectAnalysisRecord | null> {
  const result = await client.query(`select ${ANALYSIS_COLUMNS} from ai_content_subject_analyses where id = $1`, [analysisId]);
  if (!result.rowCount) return null;
  return mapAnalysis(result.rows[0] as Record<string, unknown>, await loadImages(client, analysisId));
}

async function loadClaim(client: Queryable, analysisId: string): Promise<SubjectAnalysisClaim> {
  const result = await client.query(`select ${ANALYSIS_COLUMNS} from ai_content_subject_analyses where id = $1`, [analysisId]);
  return mapClaim(
    result.rows[0] as Record<string, unknown>,
    await loadImages(client, analysisId),
  );
}

function assertActiveLease(
  row: Record<string, unknown> | undefined,
  input: SubjectLeaseIdentity,
  expectedStatuses: readonly SubjectAnalysisRecord["status"][],
): asserts row is Record<string, unknown> {
  if (
    !row
    || !expectedStatuses.includes(row.status as SubjectAnalysisRecord["status"])
    || row.superseded_at
    || row.leased_by !== input.workerId
    || String(row.lease_token ?? "") !== input.leaseToken
    || !row.lease_expires_at
    || new Date(row.lease_expires_at as string | Date).getTime() <= Date.now()
  ) {
    throw new Error("subject_analysis_lease_invalid");
  }
}

async function terminalizeAndRestorePrior(
  client: Queryable,
  row: Record<string, unknown>,
  errorCode: string,
  errorMessage: string,
) {
  if (row.contract_version === "subject-analysis.v2") {
    await client.query(
      `update ai_content_subject_analyses
          set status = 'failed', leased_by = null, lease_token = null, lease_expires_at = null,
              error_code = $2, error_message = $3, completed_at = coalesce(completed_at, now()),
              updated_at = now()
        where id = $1`,
      [row.id, errorCode, errorMessage],
    );
    return;
  }
  const prior = await client.query(
    `select id
       from ai_content_subject_analyses
      where workspace_id = $1 and brand_id = $2 and subject_type = $3 and normalized_url = $4
        and generation_id is null
        and analysis_version < $5 and status in ('ready', 'partial')
      order by analysis_version desc
      limit 1
      for update`,
    [row.workspace_id, row.brand_id, row.subject_type, row.normalized_url, row.analysis_version],
  );
  await client.query(
    `update ai_content_subject_analyses
        set status = 'failed', leased_by = null, lease_token = null, lease_expires_at = null,
            error_code = $2, error_message = $3, completed_at = coalesce(completed_at, now()),
            superseded_at = case when $4::boolean then coalesce(superseded_at, now()) else superseded_at end,
            updated_at = now()
      where id = $1`,
    [row.id, errorCode, errorMessage, Boolean(prior.rowCount)],
  );
  if (prior.rowCount) {
    await client.query(
      "update ai_content_subject_analyses set superseded_at = null, updated_at = now() where id = $1",
      [prior.rows[0].id],
    );
  }
}

async function inTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function createAiContentSubjectRepository(pool: Pool): SubjectAnalysisRepository {
  return {
    async getCachedSubjectAnalysis(input) {
      const normalizedUrl = normalizeSubjectUrl(input.sourceUrl);
      const result = await pool.query(
        `select ${ANALYSIS_COLUMNS}
           from ai_content_subject_analyses
          where workspace_id = $1 and brand_id = $2 and subject_type = $3
            and normalized_url = $4 and generation_id is null and superseded_at is null
          limit 1`,
        [input.workspaceId, input.brandId, input.subjectType, normalizedUrl],
      );
      if (!result.rowCount) return null;
      const row = result.rows[0] as Record<string, unknown>;
      return mapAnalysis(row, await loadImages(pool, String(row.id)));
    },

    async requestSubjectAnalysis(input) {
      return inTransaction(pool, async (client) => {
        if ("generationId" in input) {
          const generation = await client.query(
            `select id from ai_content_generations
              where id = $1 and workspace_id = $2 and brand_id = $3
              for update`,
            [input.generationId, input.workspaceId, input.brandId],
          );
          if (!generation.rowCount) throw new Error("subject_analysis_generation_not_found");

          const duplicate = await client.query(
            `select ${ANALYSIS_COLUMNS}
               from ai_content_subject_analyses
              where workspace_id = $1 and brand_id = $2 and generation_id = $3
                and contract_version = 'subject-analysis.v2' and idempotency_key = $4
              for update`,
            [input.workspaceId, input.brandId, input.generationId, input.idempotencyKey],
          );
          if (duplicate.rowCount) {
            const row = duplicate.rows[0] as Record<string, unknown>;
            return mapAnalysis(row, await loadImages(client, String(row.id)));
          }

          const normalizedUrl = input.sourceUrl ? normalizeSubjectUrl(input.sourceUrl) : null;
          const activeResult = await client.query(
            `select ${ANALYSIS_COLUMNS}
               from ai_content_subject_analyses
              where workspace_id = $1 and brand_id = $2 and generation_id = $3
                and contract_version = 'subject-analysis.v2' and superseded_at is null
              for update`,
            [input.workspaceId, input.brandId, input.generationId],
          );
          const active = activeResult.rows[0] as Record<string, unknown> | undefined;
          if (active) {
            const storedInput = pipelineInputEnvelope(active.input_json);
            const storedAttachmentIds = jsonArray<string>(active.attachment_ids_json);
            const sameInput = active.subject_type === input.subjectType
              && (active.normalized_url ?? null) === normalizedUrl
              && storedInput.manualInput.name === input.manualInput.name
              && storedInput.manualInput.promotionOrTerms === input.manualInput.promotionOrTerms
              && storedInput.manualInput.description === input.manualInput.description
              && isDeepStrictEqual(storedInput.brandContext, input.brandContext)
              && storedAttachmentIds.length === input.attachmentIds.length
              && storedAttachmentIds.every((id, index) => id === input.attachmentIds[index]);
            if (sameInput) return mapAnalysis(active, await loadImages(client, String(active.id)));
          }

          const versionResult = await client.query(
            `select coalesce(max(analysis_version), 0)::integer as version
               from ai_content_subject_analyses
              where workspace_id = $1 and brand_id = $2 and generation_id = $3
                and contract_version = 'subject-analysis.v2'`,
            [input.workspaceId, input.brandId, input.generationId],
          );
          const analysisVersion = Number(versionResult.rows[0]?.version ?? 0) + 1;
          if (active) {
            await client.query(
              `update ai_content_subject_analyses
                  set superseded_at = now(), updated_at = now()
                where id = $1 and superseded_at is null`,
              [active.id],
            );
          }

          const id = randomUUID();
          const storedInput: SubjectPipelineInputEnvelope = {
            manualInput: input.manualInput,
            brandContext: input.brandContext,
          };
          const inserted = await client.query(
            SUBJECT_PIPELINE_INSERT_SQL,
            [id, input.workspaceId, input.brandId, input.generationId, input.subjectType,
              input.sourceUrl?.trim() ?? null, normalizedUrl, JSON.stringify(storedInput),
              JSON.stringify(input.attachmentIds), analysisVersion, input.idempotencyKey],
          );
          if (inserted.rowCount) return mapAnalysis(inserted.rows[0] as Record<string, unknown>, []);

          const conflicted = await client.query(
            `select ${ANALYSIS_COLUMNS}
               from ai_content_subject_analyses
              where workspace_id = $1 and brand_id = $2 and generation_id = $3
                and contract_version = 'subject-analysis.v2'
                and (idempotency_key = $4 or superseded_at is null)
              order by (idempotency_key = $4) desc
              limit 1`,
            [input.workspaceId, input.brandId, input.generationId, input.idempotencyKey],
          );
          if (conflicted.rowCount) {
            const row = conflicted.rows[0] as Record<string, unknown>;
            return mapAnalysis(row, await loadImages(client, String(row.id)));
          }
          throw new Error("subject_analysis_create_conflict");
        }

        const brand = await client.query(
          "select id from brands where id = $1 and workspace_id = $2 for update",
          [input.brandId, input.workspaceId],
        );
        if (!brand.rowCount) throw new Error("brand_not_found");
        const normalizedUrl = normalizeSubjectUrl(input.sourceUrl);
        const duplicate = await client.query(
          `select ${ANALYSIS_COLUMNS}
             from ai_content_subject_analyses
            where workspace_id = $1 and brand_id = $2 and idempotency_key = $3
              and generation_id is null
            for update`,
          [input.workspaceId, input.brandId, input.idempotencyKey],
        );
        if (duplicate.rowCount) {
          const row = duplicate.rows[0] as Record<string, unknown>;
          return mapAnalysis(row, await loadImages(client, String(row.id)));
        }

        const activeResult = await client.query(
          `select ${ANALYSIS_COLUMNS}
             from ai_content_subject_analyses
            where workspace_id = $1 and brand_id = $2 and subject_type = $3
              and normalized_url = $4 and generation_id is null and superseded_at is null
            for update`,
          [input.workspaceId, input.brandId, input.subjectType, normalizedUrl],
        );
        const active = activeResult.rows[0] as Record<string, unknown> | undefined;
        if (active && !input.force) {
          return mapAnalysis(active, await loadImages(client, String(active.id)));
        }

        const versionResult = await client.query(
          `select coalesce(max(analysis_version), 0)::integer as version
             from ai_content_subject_analyses
            where workspace_id = $1 and brand_id = $2 and subject_type = $3
              and normalized_url = $4 and generation_id is null`,
          [input.workspaceId, input.brandId, input.subjectType, normalizedUrl],
        );
        const analysisVersion = Number(versionResult.rows[0]?.version ?? 0) + 1;
        if (active) {
          await client.query(
            `update ai_content_subject_analyses
                set superseded_at = now(), updated_at = now()
              where id = $1 and superseded_at is null`,
            [active.id],
          );
        }

        const id = randomUUID();
        const inserted = await client.query(
          SUBJECT_ANALYSIS_INSERT_SQL,
          [id, input.workspaceId, input.brandId, input.subjectType, input.sourceUrl.trim(), normalizedUrl,
            JSON.stringify(input.manualInput), analysisVersion, input.idempotencyKey],
        );
        if (inserted.rowCount) return mapAnalysis(inserted.rows[0] as Record<string, unknown>, []);

        const conflictedIdempotency = await client.query(
          `select ${ANALYSIS_COLUMNS}
             from ai_content_subject_analyses
            where workspace_id = $1 and brand_id = $2 and idempotency_key = $3
              and generation_id is null`,
          [input.workspaceId, input.brandId, input.idempotencyKey],
        );
        if (conflictedIdempotency.rowCount) {
          const row = conflictedIdempotency.rows[0] as Record<string, unknown>;
          return mapAnalysis(row, await loadImages(client, String(row.id)));
        }

        const conflictedActive = await client.query(
          `select ${ANALYSIS_COLUMNS}
             from ai_content_subject_analyses
            where workspace_id = $1 and brand_id = $2 and subject_type = $3
              and normalized_url = $4 and generation_id is null and superseded_at is null
            limit 1`,
          [input.workspaceId, input.brandId, input.subjectType, normalizedUrl],
        );
        if (conflictedActive.rowCount) {
          const row = conflictedActive.rows[0] as Record<string, unknown>;
          return mapAnalysis(row, await loadImages(client, String(row.id)));
        }
        throw new Error("subject_analysis_create_conflict");
      });
    },

    async getSubjectAnalysis(input) {
      const result = await pool.query(
        `select ${ANALYSIS_COLUMNS}
           from ai_content_subject_analyses
          where id = $1 and workspace_id = $2 and brand_id = $3`,
        [input.analysisId, input.workspaceId, input.brandId],
      );
      if (!result.rowCount) return null;
      return mapAnalysis(result.rows[0] as Record<string, unknown>, await loadImages(pool, input.analysisId));
    },

    async selectSubjectImage(input) {
      return inTransaction(pool, async (client) => {
        const analysis = await client.query(
          `select id from ai_content_subject_analyses
            where id = $1 and workspace_id = $2 and brand_id = $3
            for update`,
          [input.analysisId, input.workspaceId, input.brandId],
        );
        if (!analysis.rowCount) throw new Error("subject_analysis_not_found");
        const image = await client.query(
          `select id from ai_content_subject_images
            where id = $1 and analysis_id = $2 and workspace_id = $3 and brand_id = $4
              and deleted_at is null`,
          [input.imageId, input.analysisId, input.workspaceId, input.brandId],
        );
        if (!image.rowCount) throw new Error("subject_analysis_image_not_found");
        await client.query(
          "update ai_content_subject_analyses set selected_image_id = $2, updated_at = now() where id = $1",
          [input.analysisId, input.imageId],
        );
        return (await loadAnalysis(client, input.analysisId))!;
      });
    },

    async claimSubjectAnalysis(input) {
      return inTransaction(pool, async (client) => {
        for (;;) {
          const exhausted = await client.query(
            `select *
               from ai_content_subject_analyses
              where superseded_at is null
                and status in ('extracting', 'researching', 'analyzing', 'generating_appeals')
                and attempt_count >= 3
                and lease_expires_at is not null and lease_expires_at <= now()
              order by lease_expires_at, created_at, id
              for update skip locked
              limit 1`,
          );
          if (!exhausted.rowCount) break;
          await terminalizeAndRestorePrior(
            client,
            exhausted.rows[0] as Record<string, unknown>,
            "subject_analysis_attempts_exhausted",
            "subject analysis lease expired after maximum attempts",
          );
        }
        const leaseToken = randomUUID();
        const result = await client.query(SUBJECT_ANALYSIS_CLAIM_SQL, [input.workerId, leaseToken, input.leaseSeconds]);
        if (!result.rowCount) return null;
        const row = result.rows[0] as Record<string, unknown>;
        return mapClaim(row, await loadImages(client, String(row.id)));
      });
    },

    async markSubjectExtractionComplete(input) {
      return inTransaction(pool, async (client) => {
        const locked = await client.query("select * from ai_content_subject_analyses where id = $1 for update", [input.analysisId]);
        const row = locked.rows[0] as Record<string, unknown> | undefined;
        assertActiveLease(row, input, ["extracting"]);
        const nextStatus = row.contract_version === "subject-analysis.v2" ? "analyzing" : "researching";
        await client.query(
          `update ai_content_subject_analyses
              set facts_json = $2::jsonb, structured_data_json = $3::jsonb,
                  status = $4, error_code = null, error_message = null, updated_at = now()
            where id = $1`,
          [input.analysisId, JSON.stringify(input.facts), JSON.stringify(input.structuredData), nextStatus],
        );
        await client.query("update ai_content_subject_images set deleted_at = now() where analysis_id = $1 and deleted_at is null", [input.analysisId]);
        for (const image of input.images) {
          await client.query(
            `insert into ai_content_subject_images
               (id, analysis_id, workspace_id, brand_id, source_url, storage_url, storage_path,
                width, height, mime_type, alt_text, role, selection_score, deleted_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, null)
             on conflict (analysis_id, source_url) do update
               set storage_url = excluded.storage_url, storage_path = excluded.storage_path,
                   width = excluded.width, height = excluded.height, mime_type = excluded.mime_type,
                   alt_text = excluded.alt_text, role = excluded.role,
                   selection_score = excluded.selection_score, deleted_at = null`,
            [randomUUID(), input.analysisId, row.workspace_id, row.brand_id, image.sourceUrl, image.storageUrl,
              image.storagePath, image.width, image.height, image.mimeType, image.altText, image.role, image.selectionScore ?? 0],
          );
        }
        await client.query(
          `update ai_content_subject_analyses analysis
              set selected_image_id = null
            where analysis.id = $1 and analysis.selected_image_id is not null
              and not exists (
                select 1 from ai_content_subject_images image
                 where image.id = analysis.selected_image_id and image.deleted_at is null
              )`,
          [input.analysisId],
        );
        return loadClaim(client, input.analysisId);
      });
    },

    async heartbeatSubjectAnalysis(input) {
      const result = await pool.query(
        `update ai_content_subject_analyses
            set lease_expires_at = now() + ($4 * interval '1 second'), updated_at = now()
          where id = $1 and leased_by = $2 and lease_token = $3
            and status in ('extracting', 'researching', 'analyzing', 'generating_appeals')
            and superseded_at is null
            and lease_expires_at > now()`,
        [input.analysisId, input.workerId, input.leaseToken, input.leaseSeconds],
      );
      return Boolean(result.rowCount);
    },

    async completeSubjectAnalysis(input) {
      const { analysisId: _analysisId, workerId: _workerId, leaseToken: _leaseToken, ...result } = input;
      if (result.contractVersion === "subject-analysis-result.v2") {
        return inTransaction(pool, async (client) => {
          const locked = await client.query(
            "select * from ai_content_subject_analyses where id = $1 for update",
            [input.analysisId],
          );
          const row = locked.rows[0] as Record<string, unknown> | undefined;
          assertActiveLease(row, input, ["analyzing"]);
          if (row.contract_version !== "subject-analysis.v2") {
            throw new Error("subject_analysis_contract_mismatch");
          }
          const parsed = parseSubjectAnalysisResultV2(result, v2ResultContext(row));
          await client.query(
            `update ai_content_subject_analyses
                set analysis_result_json = $2::jsonb, status = 'generating_appeals',
                    leased_by = null, lease_token = null, lease_expires_at = null,
                    attempt_count = 0, available_at = now(),
                    error_code = null, error_message = null, completed_at = null,
                    updated_at = now()
              where id = $1`,
            [input.analysisId, JSON.stringify(parsed)],
          );
          return (await loadAnalysis(client, input.analysisId))!;
        });
      }

      const parsed = parseSubjectAnalysisResult(result);
      return inTransaction(pool, async (client) => {
        const locked = await client.query("select * from ai_content_subject_analyses where id = $1 for update", [input.analysisId]);
        const row = locked.rows[0] as Record<string, unknown> | undefined;
        assertActiveLease(row, input, ["researching"]);
        if (parsed.recommendedImageId) {
          const image = await client.query(
            `select id from ai_content_subject_images
              where id = $1 and analysis_id = $2 and workspace_id = $3 and brand_id = $4
                and deleted_at is null`,
            [parsed.recommendedImageId, input.analysisId, row.workspace_id, row.brand_id],
          );
          if (!image.rowCount) throw new Error("subject_analysis_recommended_image_not_found");
        }
        const research = {
          contractVersion: parsed.contractVersion,
          summary: parsed.summary,
          needs: parsed.needs,
          alternatives: parsed.alternatives,
          voc: parsed.voc,
          usps: parsed.usps,
          sourceGaps: parsed.sourceGaps,
        };
        await client.query(
          `update ai_content_subject_analyses
              set research_json = $2::jsonb, targets_json = $3::jsonb, appeals_json = $4::jsonb,
                  selected_image_id = case when $5::uuid is null then selected_image_id else $5::uuid end,
                  status = $6, leased_by = null, lease_token = null, lease_expires_at = null,
                  error_code = null, error_message = null,
                  completed_at = coalesce(completed_at, now()), updated_at = now()
            where id = $1`,
          [input.analysisId, JSON.stringify(research), JSON.stringify(parsed.targets), JSON.stringify(parsed.appealsByTarget),
            parsed.recommendedImageId, parsed.sourceGaps.length ? "partial" : "ready"],
        );
        return (await loadAnalysis(client, input.analysisId))!;
      });
    },

    async completeSubjectAppeals(input) {
      const { analysisId: _analysisId, workerId: _workerId, leaseToken: _leaseToken, ...result } = input;
      return inTransaction(pool, async (client) => {
        const locked = await client.query(
          "select * from ai_content_subject_analyses where id = $1 for update",
          [input.analysisId],
        );
        const row = locked.rows[0] as Record<string, unknown> | undefined;
        assertActiveLease(row, input, ["generating_appeals"]);
        if (row.contract_version !== "subject-analysis.v2") {
          throw new Error("subject_analysis_contract_mismatch");
        }
        const context = v2ResultContext(row);
        const parsed = parseSubjectAppealResultV2(result, context);
        const analysisResult = parseSubjectAnalysisResultV2(jsonObject(row.analysis_result_json), context);
        await client.query(
          `update ai_content_subject_analyses
              set targets_json = $2::jsonb, appeals_json = $3::jsonb, status = $4,
                  leased_by = null, lease_token = null, lease_expires_at = null,
                  error_code = null, error_message = null,
                  completed_at = coalesce(completed_at, now()), updated_at = now()
            where id = $1`,
          [input.analysisId, JSON.stringify(parsed.targets), JSON.stringify(parsed.appealsByTarget),
            analysisResult.sourceGaps.length ? "partial" : "ready"],
        );
        return (await loadAnalysis(client, input.analysisId))!;
      });
    },

    async regenerateSubjectAppeals(input) {
      return inTransaction(pool, async (client) => {
        const locked = await client.query(
          `select * from ai_content_subject_analyses
            where id = $1 and workspace_id = $2 and brand_id = $3
            for update`,
          [input.analysisId, input.workspaceId, input.brandId],
        );
        const row = locked.rows[0] as Record<string, unknown> | undefined;
        if (!row || row.contract_version !== "subject-analysis.v2" || row.superseded_at) {
          throw new Error("subject_analysis_not_found");
        }
        const existingKey = await client.query(
          `select analysis_id
             from ai_content_subject_appeal_regeneration_keys
            where analysis_id = $1 and idempotency_key = $2`,
          [input.analysisId, input.idempotencyKey],
        );
        if (existingKey.rowCount) {
          return (await loadAnalysis(client, input.analysisId))!;
        }
        if (row.status !== "ready" && row.status !== "partial") {
          throw new Error("subject_analysis_appeals_regeneration_invalid");
        }
        parseSubjectAnalysisResultV2(jsonObject(row.analysis_result_json), v2ResultContext(row));
        const insertedKey = await client.query(
          `insert into ai_content_subject_appeal_regeneration_keys
             (analysis_id, idempotency_key)
           values ($1, $2)
           on conflict (analysis_id, idempotency_key) do nothing
           returning analysis_id`,
          [input.analysisId, input.idempotencyKey],
        );
        if (!insertedKey.rowCount) {
          return (await loadAnalysis(client, input.analysisId))!;
        }
        await client.query(
          `update ai_content_subject_analyses
              set status = 'generating_appeals',
                  leased_by = null, lease_token = null, lease_expires_at = null,
                  attempt_count = 0, available_at = now(),
                  error_code = null, error_message = null, completed_at = null,
                  updated_at = now()
            where id = $1`,
          [input.analysisId],
        );
        return (await loadAnalysis(client, input.analysisId))!;
      });
    },

    async failSubjectAnalysis(input) {
      return inTransaction(pool, async (client) => {
        const locked = await client.query("select * from ai_content_subject_analyses where id = $1 for update", [input.analysisId]);
        const row = locked.rows[0] as Record<string, unknown> | undefined;
        assertActiveLease(row, input, ["extracting", "researching", "analyzing", "generating_appeals"]);
        const attemptCount = Number(row.attempt_count);
        const willRetry = input.retryable && attemptCount < 3;
        if (willRetry) {
          const delaySeconds = 60 * (2 ** Math.max(0, attemptCount - 1));
          await client.query(
            `update ai_content_subject_analyses
                set status = $2, available_at = now() + ($3 * interval '1 second'),
                    leased_by = null, lease_token = null, lease_expires_at = null,
                    error_code = $4, error_message = $5, updated_at = now()
              where id = $1`,
            [input.analysisId, row.status === "extracting" ? "queued" : row.status,
              delaySeconds, input.errorCode, input.errorMessage],
          );
          return (await loadAnalysis(client, input.analysisId))!;
        }

        await terminalizeAndRestorePrior(client, row, input.errorCode, input.errorMessage);
        return (await loadAnalysis(client, input.analysisId))!;
      });
    },
  };
}
