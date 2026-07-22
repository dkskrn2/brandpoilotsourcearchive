import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  parseBrandIntelligenceResult,
  type BrandAnalysisStatus,
  type BrandEvidenceDocument,
  type BrandIntelligenceResultV1,
} from "./brandIntelligenceContracts.js";
import { hashSourceUrl, normalizeSourceDomain, normalizeSourceUrl } from "./sourceUrl.js";

export interface BrandAnalysisScope { workspaceId: string; brandId: string }

export interface BrandAnalysisRecord extends BrandAnalysisScope {
  id: string;
  status: BrandAnalysisStatus;
  input: { ownedUrl: string | null; uploadIds: string[] };
  evidence: BrandEvidenceDocument[];
  result: BrandIntelligenceResultV1 | null;
  editedResult: BrandIntelligenceResultV1 | null;
  effectiveResult: BrandIntelligenceResultV1 | null;
  idempotencyKey: string;
  isActive: boolean;
  leasedBy: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  availableAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  confirmedAt: string | null;
}

export interface BrandAnalysisClaim extends BrandAnalysisRecord {
  status: "extracting" | "analyzing";
  leasedBy: string;
  leaseToken: string;
  leaseExpiresAt: string;
}

export interface BrandIntelligenceRepository {
  registerBrandAnalysisUpload(input: BrandAnalysisScope & {
    fileName: string; mimeType: string; byteSize: number; checksum: string;
    storagePath: string; storageUrl: string;
  }): Promise<{ id: string }>;
  requestBrandAnalysis(input: BrandAnalysisScope & {
    ownedUrl: string | null; uploadIds: string[]; idempotencyKey: string;
  }): Promise<BrandAnalysisRecord>;
  getBrandAnalysis(input: BrandAnalysisScope & { analysisId: string }): Promise<BrandAnalysisRecord | null>;
  getCurrentBrandIntelligence(input: BrandAnalysisScope): Promise<BrandAnalysisRecord | null>;
  updateBrandAnalysisDraft(input: BrandAnalysisScope & {
    analysisId: string; editedResult: BrandIntelligenceResultV1;
  }): Promise<BrandAnalysisRecord>;
  confirmBrandAnalysis(input: BrandAnalysisScope & { analysisId: string }): Promise<BrandAnalysisRecord>;
  claimBrandAnalysis(input: { workerId: string; leaseSeconds: number }): Promise<BrandAnalysisClaim | null>;
  listBrandAnalysisUploads(input: { analysisId: string }): Promise<Array<{
    id: string; fileName: string; mimeType: string; byteSize: number; storageUrl: string;
  }>>;
  markBrandEvidenceReady(input: {
    analysisId: string; workerId: string; leaseToken: string; evidence: BrandEvidenceDocument[];
  }): Promise<BrandAnalysisClaim>;
  heartbeatBrandAnalysis(input: {
    analysisId: string; workerId: string; leaseToken: string; leaseSeconds: number;
  }): Promise<boolean>;
  completeBrandAnalysis(input: {
    analysisId: string; workerId: string; leaseToken: string;
    evidence?: BrandEvidenceDocument[]; result: BrandIntelligenceResultV1;
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
  created_at, updated_at, completed_at, confirmed_at`;

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

function mapRun(row: Record<string, unknown>): BrandAnalysisRecord {
  const input = json<{ ownedUrl?: unknown; uploadIds?: unknown }>(row.input_json, {});
  const result = row.result_json ? parseBrandIntelligenceResult(json(row.result_json, {})) : null;
  const editedResult = row.edited_result_json
    ? parseBrandIntelligenceResult(json(row.edited_result_json, {}))
    : null;
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), brandId: String(row.brand_id),
    status: row.status as BrandAnalysisStatus,
    input: {
      ownedUrl: typeof input.ownedUrl === "string" ? input.ownedUrl : null,
      uploadIds: Array.isArray(input.uploadIds) ? input.uploadIds.map(String) : [],
    },
    evidence: json<BrandEvidenceDocument[]>(row.evidence_json, []),
    result, editedResult, effectiveResult: editedResult ?? result,
    idempotencyKey: String(row.idempotency_key), isActive: Boolean(row.is_active),
    leasedBy: row.leased_by ? String(row.leased_by) : null,
    leaseToken: row.lease_token ? String(row.lease_token) : null,
    leaseExpiresAt: iso(row.lease_expires_at), attemptCount: Number(row.attempt_count ?? 0),
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
  if (!row || !["extracting", "analyzing"].includes(String(row.status))
    || String(row.leased_by ?? "") !== input.workerId
    || String(row.lease_token ?? "") !== input.leaseToken
    || !row.lease_expires_at
    || new Date(row.lease_expires_at as string | Date).getTime() <= Date.now()) {
    throw new Error("brand_analysis_lease_invalid");
  }
}

export function createBrandIntelligenceRepository(pool: Pool): BrandIntelligenceRepository {
  return {
    async registerBrandAnalysisUpload(input) {
      const inserted = await pool.query(
        `insert into brand_analysis_uploads
           (workspace_id, brand_id, file_name, mime_type, byte_size, checksum,
            storage_path, storage_url)
         select $1, $2, $3, $4, $5, $6, $7, $8
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
        const id = randomUUID();
        const inserted = await client.query(
          `insert into brand_analysis_runs
             (id, workspace_id, brand_id, status, input_json, idempotency_key)
           values ($1, $2, $3, 'queued', $4::jsonb, $5)
           returning ${columns}`,
          [id, input.workspaceId, input.brandId, JSON.stringify({ ownedUrl: input.ownedUrl, uploadIds: input.uploadIds }), input.idempotencyKey],
        );
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

    async getBrandAnalysis(input) {
      const found = await pool.query(
        `select ${columns} from brand_analysis_runs
          where id = $1 and workspace_id = $2 and brand_id = $3`,
        [input.analysisId, input.workspaceId, input.brandId],
      );
      return found.rowCount ? mapRun(found.rows[0] as Record<string, unknown>) : null;
    },

    async getCurrentBrandIntelligence(input) {
      const found = await pool.query(
        `select ${columns} from brand_analysis_runs
          where workspace_id = $1 and brand_id = $2 and is_active
          order by confirmed_at desc limit 1`,
        [input.workspaceId, input.brandId],
      );
      return found.rowCount ? mapRun(found.rows[0] as Record<string, unknown>) : null;
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
        const effective = parseBrandIntelligenceResult(current.effectiveResult);
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
        const leaseToken = randomUUID();
        const claimed = await client.query(
          `with candidate as (
             select id from brand_analysis_runs
              where available_at <= now() and attempt_count < 3
                and (status = 'queued' or (status in ('extracting', 'analyzing') and lease_expires_at <= now()))
              order by available_at, created_at, id
              for update skip locked limit 1
           )
           update brand_analysis_runs run
              set status = case when run.status = 'queued' then 'extracting' else run.status end,
                  leased_by = $1, lease_token = $2,
                  lease_expires_at = now() + ($3 * interval '1 second'),
                  attempt_count = run.attempt_count + 1, error_code = null, error_message = null,
                  updated_at = now()
             from candidate where run.id = candidate.id
           returning run.*`,
          [input.workerId, leaseToken, input.leaseSeconds],
        );
        return claimed.rowCount ? mapRun(claimed.rows[0] as Record<string, unknown>) as BrandAnalysisClaim : null;
      });
    },

    async listBrandAnalysisUploads(input) {
      const found = await pool.query(
        `select id, file_name, mime_type, byte_size, storage_url
           from brand_analysis_uploads
          where analysis_id = $1 and deleted_at is null
          order by created_at, id`,
        [input.analysisId],
      );
      return found.rows.map((row) => ({
        id: String(row.id), fileName: String(row.file_name), mimeType: String(row.mime_type),
        byteSize: Number(row.byte_size), storageUrl: String(row.storage_url),
      }));
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
        `update brand_analysis_runs set lease_expires_at = now() + ($4 * interval '1 second'), updated_at = now()
          where id = $1 and leased_by = $2 and lease_token = $3
            and status in ('extracting', 'analyzing') and lease_expires_at > now()`,
        [input.analysisId, input.workerId, input.leaseToken, input.leaseSeconds],
      );
      return Boolean(updated.rowCount);
    },

    async completeBrandAnalysis(input) {
      const parsed = parseBrandIntelligenceResult(input.result);
      return transaction(pool, async (client) => {
        const found = await client.query("select * from brand_analysis_runs where id = $1 for update", [input.analysisId]);
        assertLease(found.rows[0] as Record<string, unknown> | undefined, input);
        const updated = await client.query(
          `update brand_analysis_runs set status = 'review_ready', evidence_json = $2::jsonb,
             result_json = $3::jsonb, leased_by = null, lease_token = null, lease_expires_at = null,
             completed_at = now(), updated_at = now() where id = $1 returning ${columns}`,
          [input.analysisId, JSON.stringify(input.evidence ?? json<BrandEvidenceDocument[]>(found.rows[0]!.evidence_json, [])), JSON.stringify(parsed)],
        );
        return mapRun(updated.rows[0] as Record<string, unknown>);
      });
    },

    async failBrandAnalysis(input) {
      return transaction(pool, async (client) => {
        const found = await client.query("select * from brand_analysis_runs where id = $1 for update", [input.analysisId]);
        assertLease(found.rows[0] as Record<string, unknown> | undefined, input);
        const attempts = Number(found.rows[0]!.attempt_count ?? 0);
        const retry = input.retryable && attempts < 3;
        const updated = await client.query(
          `update brand_analysis_runs set status = $2,
             available_at = case when $3::boolean then now() + interval '5 minutes' else available_at end,
             leased_by = null, lease_token = null, lease_expires_at = null,
             error_code = $4, error_message = $5,
             completed_at = case when $3::boolean then completed_at else now() end,
             updated_at = now() where id = $1 returning ${columns}`,
          [input.analysisId, retry ? "queued" : "failed", retry, input.errorCode, input.errorMessage],
        );
        return mapRun(updated.rows[0] as Record<string, unknown>);
      });
    },
  };
}
