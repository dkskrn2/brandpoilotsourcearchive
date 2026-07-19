import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  type CreateSubjectAnalysisInput,
  parseSubjectAnalysisResult,
  type SubjectAnalysisResultV1,
  type SubjectAnalysisStatus,
  type SubjectAppeal,
  type SubjectManualInput,
  type SubjectTarget,
  type SubjectType,
} from "./aiContentSubjectContracts.js";

export interface SubjectBrandScope {
  workspaceId: string;
  brandId: string;
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
  subjectType: SubjectType;
  sourceUrl: string;
  normalizedUrl: string;
  input: SubjectManualInput;
  status: SubjectAnalysisStatus;
  facts: Array<{ key: string; value: string; sourceUrl: string }>;
  structuredData: Record<string, unknown>;
  research: Record<string, unknown>;
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
  status: "extracting" | "researching";
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
  getSubjectAnalysis(input: SubjectBrandScope & { analysisId: string }): Promise<SubjectAnalysisRecord | null>;
  selectSubjectImage(input: SubjectBrandScope & { analysisId: string; imageId: string }): Promise<SubjectAnalysisRecord>;
  claimSubjectAnalysis(input: { workerId: string; leaseSeconds: number }): Promise<SubjectAnalysisClaim | null>;
  markSubjectExtractionComplete(input: SubjectExtractionCompletion): Promise<SubjectAnalysisClaim>;
  heartbeatSubjectAnalysis(input: SubjectLeaseIdentity & { leaseSeconds: number }): Promise<boolean>;
  completeSubjectAnalysis(input: SubjectLeaseIdentity & SubjectAnalysisResultV1): Promise<SubjectAnalysisRecord>;
  failSubjectAnalysis(input: SubjectLeaseIdentity & { errorCode: string; errorMessage: string; retryable: boolean }): Promise<SubjectAnalysisRecord>;
}

type Queryable = Pick<PoolClient, "query">;

const ANALYSIS_COLUMNS = `
  id, workspace_id, brand_id, subject_type, source_url, normalized_url, input_json,
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

export const SUBJECT_ANALYSIS_CLAIM_SQL = `
  with candidate as (
    select id
      from ai_content_subject_analyses
     where superseded_at is null
       and available_at <= now()
       and attempt_count < 3
       and (
         status = 'queued'
         or (status in ('extracting', 'researching') and (lease_expires_at is null or lease_expires_at <= now()))
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
  const input = jsonObject(row.input_json);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    subjectType: row.subject_type as SubjectType,
    sourceUrl: String(row.source_url),
    normalizedUrl: String(row.normalized_url),
    input: {
      name: typeof input.name === "string" ? input.name : "",
      promotion: typeof input.promotion === "string" ? input.promotion : "",
      description: typeof input.description === "string" ? input.description : "",
    },
    status: row.status as SubjectAnalysisStatus,
    facts: jsonArray(row.facts_json),
    structuredData: jsonObject(row.structured_data_json),
    research: jsonObject(row.research_json),
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

function assertActiveLease(
  row: Record<string, unknown> | undefined,
  input: SubjectLeaseIdentity,
  expectedStatuses: readonly SubjectAnalysisStatus[],
): asserts row is Record<string, unknown> {
  if (
    !row
    || !expectedStatuses.includes(row.status as SubjectAnalysisStatus)
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
  const prior = await client.query(
    `select id
       from ai_content_subject_analyses
      where workspace_id = $1 and brand_id = $2 and subject_type = $3 and normalized_url = $4
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
            and normalized_url = $4 and superseded_at is null
          limit 1`,
        [input.workspaceId, input.brandId, input.subjectType, normalizedUrl],
      );
      if (!result.rowCount) return null;
      const row = result.rows[0] as Record<string, unknown>;
      return mapAnalysis(row, await loadImages(pool, String(row.id)));
    },

    async requestSubjectAnalysis(input) {
      return inTransaction(pool, async (client) => {
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
              and normalized_url = $4 and superseded_at is null
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
            where workspace_id = $1 and brand_id = $2 and subject_type = $3 and normalized_url = $4`,
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
            where workspace_id = $1 and brand_id = $2 and idempotency_key = $3`,
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
              and normalized_url = $4 and superseded_at is null
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
                and status in ('extracting', 'researching')
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
        return mapAnalysis(row, await loadImages(client, String(row.id))) as SubjectAnalysisClaim;
      });
    },

    async markSubjectExtractionComplete(input) {
      return inTransaction(pool, async (client) => {
        const locked = await client.query("select * from ai_content_subject_analyses where id = $1 for update", [input.analysisId]);
        const row = locked.rows[0] as Record<string, unknown> | undefined;
        assertActiveLease(row, input, ["extracting"]);
        await client.query(
          `update ai_content_subject_analyses
              set facts_json = $2::jsonb, structured_data_json = $3::jsonb,
                  status = 'researching', error_code = null, error_message = null, updated_at = now()
            where id = $1`,
          [input.analysisId, JSON.stringify(input.facts), JSON.stringify(input.structuredData)],
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
        return (await loadAnalysis(client, input.analysisId)) as SubjectAnalysisClaim;
      });
    },

    async heartbeatSubjectAnalysis(input) {
      const result = await pool.query(
        `update ai_content_subject_analyses
            set lease_expires_at = now() + ($4 * interval '1 second'), updated_at = now()
          where id = $1 and leased_by = $2 and lease_token = $3
            and status in ('extracting', 'researching') and superseded_at is null
            and lease_expires_at > now()`,
        [input.analysisId, input.workerId, input.leaseToken, input.leaseSeconds],
      );
      return Boolean(result.rowCount);
    },

    async completeSubjectAnalysis(input) {
      const { analysisId: _analysisId, workerId: _workerId, leaseToken: _leaseToken, ...result } = input;
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

    async failSubjectAnalysis(input) {
      return inTransaction(pool, async (client) => {
        const locked = await client.query("select * from ai_content_subject_analyses where id = $1 for update", [input.analysisId]);
        const row = locked.rows[0] as Record<string, unknown> | undefined;
        assertActiveLease(row, input, ["extracting", "researching"]);
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
            [input.analysisId, row.status === "extracting" ? "queued" : "researching", delaySeconds, input.errorCode, input.errorMessage],
          );
          return (await loadAnalysis(client, input.analysisId))!;
        }

        await terminalizeAndRestorePrior(client, row, input.errorCode, input.errorMessage);
        return (await loadAnalysis(client, input.analysisId))!;
      });
    },
  };
}
