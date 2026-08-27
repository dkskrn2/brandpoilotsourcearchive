import type { Pool, PoolClient } from "pg";
import { createHash } from "node:crypto";
import { parseDesignStyleAnalysisV1, type DesignStyleAnalysisV1 } from "@brand-pilot/content-contracts";
import type { BrandScope } from "./brandCoreRepository.js";
import {
  parseDesignStyleInput,
  parseVisualPresetInput,
  type DesignStyleInputV1,
  type VisualPresetInputV1,
} from "./designStyleContracts.js";

export type DesignStyleStatus = "queued" | "processing" | "ready" | "failed";
export interface DesignStyle extends BrandScope {
  id: string; name: string; revision: number; analysisStatus: DesignStyleStatus;
  analysisContractVersion: "design-style-analysis.v1" | null;
  analysis: DesignStyleAnalysisV1 | null; analysisSha256: string | null;
  analysisErrorCode: string | null; referenceItemIds: string[];
  createdAt: string; updatedAt: string;
}
export type VisualPresetUsability =
  | { usable: true; reason: null }
  | { usable: false; reason: "style_analyzing" | "style_analysis_failed" | "avatar_unavailable" };
export interface VisualPreset extends BrandScope {
  id: string; name: string; designStyleId: string; avatarId: string | null;
  revision: number; isDefault: boolean; usability: VisualPresetUsability;
  createdAt: string; updatedAt: string;
}

export interface DesignStyleAnalysisClaim {
  jobId: string; workspaceId: string; brandId: string; designStyleId: string; styleRevision: number;
  leaseToken: string; leaseExpiresAt: string;
  images: Array<{ referenceItemId: string; storageUrl: string; storagePath: string; mimeType: string; sizeBytes: number; checksum: string }>;
}

export interface DesignStyleRepository {
  listDesignStyles(scope: BrandScope): Promise<DesignStyle[]>;
  createDesignStyle(scope: BrandScope & { actorUserId: string }, input: DesignStyleInputV1): Promise<DesignStyle>;
  updateDesignStyle(scope: BrandScope & { actorUserId: string; styleId: string; expectedRevision: number }, input: DesignStyleInputV1): Promise<DesignStyle>;
  retryDesignStyleAnalysis(scope: BrandScope & { actorUserId: string; styleId: string }): Promise<DesignStyle>;
  listVisualPresets(scope: BrandScope): Promise<VisualPreset[]>;
  createVisualPreset(scope: BrandScope & { actorUserId: string }, input: VisualPresetInputV1): Promise<VisualPreset>;
  updateVisualPreset(scope: BrandScope & { actorUserId: string; presetId: string; expectedRevision: number }, input: VisualPresetInputV1): Promise<VisualPreset>;
  setDefaultVisualPreset(scope: BrandScope & { actorUserId: string; presetId: string }): Promise<VisualPreset>;
  claimDesignStyleAnalysis(workerId: string, leaseSeconds: number): Promise<DesignStyleAnalysisClaim | null>;
  heartbeatDesignStyleAnalysis(input: { jobId: string; workerId: string; leaseToken: string; leaseSeconds: number }): Promise<boolean>;
  completeDesignStyleAnalysis(input: { jobId: string; workerId: string; leaseToken: string; designStyleId: string; styleRevision: number; analysis: unknown; analysisSha256: string }): Promise<boolean>;
  failDesignStyleAnalysis(input: { jobId: string; workerId: string; leaseToken: string; errorCode: string; retryable: boolean }): Promise<boolean>;
}

function iso(value: unknown): string { return new Date(value as string).toISOString(); }
function json<T>(value: unknown): T { return (typeof value === "string" ? JSON.parse(value) : value) as T; }
function style(row: Record<string, unknown>): DesignStyle {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), brandId: String(row.brand_id), name: String(row.name),
    revision: Number(row.revision), analysisStatus: row.analysis_status as DesignStyleStatus,
    analysisContractVersion: row.analysis_contract_version as DesignStyle["analysisContractVersion"],
    analysis: row.analysis_json ? parseDesignStyleAnalysisV1(json(row.analysis_json)) : null,
    analysisSha256: row.analysis_sha256 ? String(row.analysis_sha256) : null,
    analysisErrorCode: row.analysis_error_code ? String(row.analysis_error_code) : null,
    referenceItemIds: json<unknown[]>(row.reference_item_ids ?? []).map(String),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}
function usability(row: Record<string, unknown>): VisualPresetUsability {
  if (row.analysis_status === "failed") return { usable: false, reason: "style_analysis_failed" };
  if (row.analysis_status !== "ready") return { usable: false, reason: "style_analyzing" };
  if (row.avatar_id && (!row.avatar_active || Number(row.avatar_image_count) < 1)) {
    return { usable: false, reason: "avatar_unavailable" };
  }
  return { usable: true, reason: null };
}
function preset(row: Record<string, unknown>): VisualPreset {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), brandId: String(row.brand_id), name: String(row.name),
    designStyleId: String(row.design_style_id), avatarId: row.avatar_id ? String(row.avatar_id) : null,
    revision: Number(row.revision), isDefault: Boolean(row.is_default), usability: usability(row),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}
async function tx<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query("begin"); const result = await action(client); await client.query("commit"); return result; }
  catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
async function member(client: Pick<PoolClient, "query">, scope: BrandScope & { actorUserId: string }, admin = false): Promise<void> {
  const result = await client.query(
    `select member.role from workspace_members member
      where member.workspace_id=$1 and member.user_id=$2 and member.status='active'
        and exists(select 1 from brands where id=$3 and workspace_id=$1 and deleted_at is null)`,
    [scope.workspaceId, scope.actorUserId, scope.brandId],
  );
  if (!result.rowCount) throw new Error("design_style_access_forbidden");
  if (admin && !["owner", "admin"].includes(String(result.rows[0].role))) throw new Error("design_style_admin_required");
}
async function validateReferences(client: Pick<PoolClient, "query">, scope: BrandScope, ids: string[]): Promise<void> {
  const result = await client.query(
    `select item.id from reference_items item join storage_artifacts artifact
       on artifact.id=item.storage_artifact_id and artifact.workspace_id=item.workspace_id and artifact.brand_id=item.brand_id
      where item.id=any($1::uuid[]) and item.workspace_id=$2 and item.brand_id=$3 and item.archived_at is null
        and artifact.deleted_at is null and artifact.public_url is not null and artifact.path is not null
        and artifact.checksum ~ '^[0-9a-f]{64}$' and lower(artifact.mime_type) in ('image/png','image/jpeg','image/webp')
      for share of item,artifact`,
    [ids, scope.workspaceId, scope.brandId],
  );
  if (Number(result.rowCount ?? 0) !== ids.length) throw new Error("design_style_reference_invalid");
}

const styleSelect = `select style.*,
  coalesce(jsonb_agg(reference.reference_item_id order by reference.position)
    filter(where reference.id is not null),'[]'::jsonb) reference_item_ids
from brand_design_styles style left join brand_design_style_references reference
 on reference.design_style_id=style.id and reference.workspace_id=style.workspace_id and reference.brand_id=style.brand_id`;
const presetSelect = `select preset.*,style.analysis_status,
  coalesce(avatar.status='active',false) avatar_active,
  (select count(*) from brand_avatar_images image where image.avatar_id=avatar.id) avatar_image_count
from brand_style_presets preset join brand_design_styles style
 on style.id=preset.design_style_id and style.workspace_id=preset.workspace_id and style.brand_id=preset.brand_id
left join brand_avatars avatar on avatar.id=preset.avatar_id and avatar.workspace_id=preset.workspace_id and avatar.brand_id=preset.brand_id`;

export function createDesignStyleRepository(pool: Pool): DesignStyleRepository {
  const getStyle = async (scope: BrandScope & { styleId: string }, queryable: Pick<Pool, "query"> = pool) => {
    const result = await queryable.query(`${styleSelect} where style.id=$1 and style.workspace_id=$2 and style.brand_id=$3 group by style.id`, [scope.styleId, scope.workspaceId, scope.brandId]);
    return result.rowCount ? style(result.rows[0] as Record<string, unknown>) : null;
  };
  const getPreset = async (scope: BrandScope & { presetId: string }, queryable: Pick<Pool, "query"> = pool) => {
    const result = await queryable.query(`${presetSelect} where preset.id=$1 and preset.workspace_id=$2 and preset.brand_id=$3 and preset.status='active'`, [scope.presetId, scope.workspaceId, scope.brandId]);
    return result.rowCount ? preset(result.rows[0] as Record<string, unknown>) : null;
  };
  const validatePresetLinks = async (client: PoolClient, scope: BrandScope, input: VisualPresetInputV1) => {
    const result = await client.query(
      `select style.analysis_status,
        ($4::uuid is null or exists(select 1 from brand_avatars avatar where avatar.id=$4 and avatar.workspace_id=$2 and avatar.brand_id=$3 and avatar.status='active' and exists(select 1 from brand_avatar_images image where image.avatar_id=avatar.id))) avatar_ok
       from brand_design_styles style where style.id=$1 and style.workspace_id=$2 and style.brand_id=$3 for share`,
      [input.designStyleId, scope.workspaceId, scope.brandId, input.avatarId],
    );
    if (!result.rowCount) throw new Error("design_style_not_found");
    if (!result.rows[0].avatar_ok) throw new Error("avatar_unavailable");
    return String(result.rows[0].analysis_status);
  };
  return {
    async listDesignStyles(scope) {
      const result = await pool.query(`${styleSelect} where style.workspace_id=$1 and style.brand_id=$2 group by style.id order by style.updated_at desc`, [scope.workspaceId, scope.brandId]);
      return result.rows.map((row) => style(row as Record<string, unknown>));
    },
    async createDesignStyle(scope, raw) {
      const input = parseDesignStyleInput(raw);
      return tx(pool, async (client) => {
        await member(client, scope); await validateReferences(client, scope, input.referenceItemIds);
        const created = await client.query(`insert into brand_design_styles(workspace_id,brand_id,name,created_by_user_id) values($1,$2,$3,$4) returning id,revision`, [scope.workspaceId, scope.brandId, input.name, scope.actorUserId]);
        const styleId = String(created.rows[0].id);
        for (const [index, id] of input.referenceItemIds.entries()) await client.query(`insert into brand_design_style_references(workspace_id,brand_id,design_style_id,reference_item_id,position) values($1,$2,$3,$4,$5)`, [scope.workspaceId, scope.brandId, styleId, id, index + 1]);
        await client.query(`insert into brand_design_style_analysis_jobs(workspace_id,brand_id,design_style_id,style_revision) values($1,$2,$3,$4)`, [scope.workspaceId, scope.brandId, styleId, Number(created.rows[0].revision)]);
        return (await getStyle({ ...scope, styleId }, client))!;
      });
    },
    async updateDesignStyle(scope, raw) {
      const input = parseDesignStyleInput(raw);
      return tx(pool, async (client) => {
        await member(client, scope); await validateReferences(client, scope, input.referenceItemIds);
        const locked = await client.query(`select id,revision from brand_design_styles where id=$1 and workspace_id=$2 and brand_id=$3 and revision=$4 for update`, [scope.styleId, scope.workspaceId, scope.brandId, scope.expectedRevision]);
        if (!locked.rowCount) throw new Error("design_style_revision_stale");
        const current = await client.query(`select reference_item_id from brand_design_style_references where design_style_id=$1 order by position`, [scope.styleId]);
        const changed = JSON.stringify(current.rows.map((row) => String(row.reference_item_id))) !== JSON.stringify(input.referenceItemIds);
        if (changed) {
          await client.query(`update brand_design_styles set name=$1,revision=revision+1,analysis_status='queued',analysis_contract_version=null,analysis_json=null,analysis_sha256=null,analysis_error_code=null where id=$2 and workspace_id=$3 and brand_id=$4`, [input.name, scope.styleId, scope.workspaceId, scope.brandId]);
          await client.query(`delete from brand_design_style_references where design_style_id=$1 and workspace_id=$2 and brand_id=$3`, [scope.styleId, scope.workspaceId, scope.brandId]);
          for (const [index, id] of input.referenceItemIds.entries()) await client.query(`insert into brand_design_style_references(workspace_id,brand_id,design_style_id,reference_item_id,position) values($1,$2,$3,$4,$5)`, [scope.workspaceId, scope.brandId, scope.styleId, id, index + 1]);
          await client.query(`insert into brand_design_style_analysis_jobs(workspace_id,brand_id,design_style_id,style_revision) select workspace_id,brand_id,id,revision from brand_design_styles where id=$1`, [scope.styleId]);
        } else await client.query(`update brand_design_styles set name=$1 where id=$2 and workspace_id=$3 and brand_id=$4`, [input.name, scope.styleId, scope.workspaceId, scope.brandId]);
        return (await getStyle(scope, client))!;
      });
    },
    async retryDesignStyleAnalysis(scope) {
      return tx(pool, async (client) => {
        await member(client, scope);
        const reset = await client.query(`update brand_design_styles set analysis_status='queued',analysis_error_code=null where id=$1 and workspace_id=$2 and brand_id=$3 and analysis_status='failed' returning revision`, [scope.styleId, scope.workspaceId, scope.brandId]);
        if (!reset.rowCount) throw new Error("design_style_retry_unavailable");
        await client.query(`update brand_design_style_analysis_jobs set status='queued',attempt_count=0,available_at=now(),leased_by=null,lease_token=null,lease_expires_at=null,error_code=null where design_style_id=$1 and style_revision=$2`, [scope.styleId, reset.rows[0].revision]);
        return (await getStyle(scope, client))!;
      });
    },
    async listVisualPresets(scope) {
      const result = await pool.query(`${presetSelect} where preset.workspace_id=$1 and preset.brand_id=$2 and preset.status='active' order by preset.is_default desc,preset.updated_at desc`, [scope.workspaceId, scope.brandId]);
      return result.rows.map((row) => preset(row as Record<string, unknown>));
    },
    async createVisualPreset(scope, raw) {
      const input = parseVisualPresetInput(raw);
      return tx(pool, async (client) => {
        await member(client, scope); const status = await validatePresetLinks(client, scope, input);
        if (input.isDefault && status !== "ready") throw new Error("visual_preset_not_usable");
        if (input.isDefault) { await member(client, scope, true); await client.query(`update brand_style_presets set is_default=false where workspace_id=$1 and brand_id=$2 and is_default`, [scope.workspaceId, scope.brandId]); }
        const created = await client.query(`insert into brand_style_presets(workspace_id,brand_id,name,design_style_id,avatar_id,is_default,created_by_user_id) values($1,$2,$3,$4,$5,$6,$7) returning id`, [scope.workspaceId, scope.brandId, input.name, input.designStyleId, input.avatarId, input.isDefault, scope.actorUserId]);
        return (await getPreset({ ...scope, presetId: String(created.rows[0].id) }, client))!;
      });
    },
    async updateVisualPreset(scope, raw) {
      const input = parseVisualPresetInput(raw);
      return tx(pool, async (client) => {
        await member(client, scope);
        const locked = await client.query(`select id,is_default,design_style_id from brand_style_presets where id=$1 and workspace_id=$2 and brand_id=$3 and revision=$4 and status='active' for update`, [scope.presetId, scope.workspaceId, scope.brandId, scope.expectedRevision]);
        if (!locked.rowCount) throw new Error("visual_preset_revision_stale");
        const currentDefault = Boolean(locked.rows[0].is_default);
        const status = await validatePresetLinks(client, scope, input);
        const keepsExistingDefaultStyle = currentDefault && input.isDefault
          && String(locked.rows[0].design_style_id) === input.designStyleId;
        if (input.isDefault && status !== "ready" && !keepsExistingDefaultStyle) {
          throw new Error("visual_preset_not_usable");
        }
        if (currentDefault !== input.isDefault) await member(client, scope, true);
        if (input.isDefault && !currentDefault) await client.query(`update brand_style_presets set is_default=false where workspace_id=$1 and brand_id=$2 and id<>$3 and is_default`, [scope.workspaceId, scope.brandId, scope.presetId]);
        await client.query(`update brand_style_presets set name=$1,design_style_id=$2,avatar_id=$3,is_default=$4,revision=revision+1 where id=$5 and workspace_id=$6 and brand_id=$7`, [input.name, input.designStyleId, input.avatarId, input.isDefault, scope.presetId, scope.workspaceId, scope.brandId]);
        return (await getPreset(scope, client))!;
      });
    },
    async setDefaultVisualPreset(scope) {
      return tx(pool, async (client) => {
        await member(client, scope, true); const current = await getPreset(scope, client);
        if (!current) throw new Error("visual_preset_not_found");
        if (!current.usability.usable) throw new Error("visual_preset_not_usable");
        await client.query(`update brand_style_presets set is_default=false where workspace_id=$1 and brand_id=$2 and is_default`, [scope.workspaceId, scope.brandId]);
        await client.query(`update brand_style_presets set is_default=true,revision=revision+1 where id=$1 and workspace_id=$2 and brand_id=$3`, [scope.presetId, scope.workspaceId, scope.brandId]);
        return (await getPreset(scope, client))!;
      });
    },
    async claimDesignStyleAnalysis(workerId, leaseSeconds) {
      return tx(pool, async (client) => {
        const claimed = await client.query(`with candidate as (select id from brand_design_style_analysis_jobs where status='queued' and available_at<=now() order by available_at,created_at for update skip locked limit 1) update brand_design_style_analysis_jobs job set status='processing',attempt_count=attempt_count+1,leased_by=$1,lease_token=gen_random_uuid(),lease_expires_at=now()+($2||' seconds')::interval from candidate where job.id=candidate.id returning job.*`, [workerId, leaseSeconds]);
        if (!claimed.rowCount) return null;
        const job = claimed.rows[0];
        await client.query(`update brand_design_styles set analysis_status='processing' where id=$1 and revision=$2 and analysis_status='queued'`, [job.design_style_id, job.style_revision]);
        const images = await client.query(`select reference.reference_item_id,artifact.public_url storage_url,artifact.path storage_path,artifact.mime_type,artifact.byte_size,artifact.checksum from brand_design_style_references reference join reference_items item on item.id=reference.reference_item_id and item.workspace_id=reference.workspace_id and item.brand_id=reference.brand_id join storage_artifacts artifact on artifact.id=item.storage_artifact_id and artifact.workspace_id=item.workspace_id and artifact.brand_id=item.brand_id where reference.design_style_id=$1 order by reference.position`, [job.design_style_id]);
        return { jobId: String(job.id), workspaceId: String(job.workspace_id), brandId: String(job.brand_id), designStyleId: String(job.design_style_id), styleRevision: Number(job.style_revision), leaseToken: String(job.lease_token), leaseExpiresAt: iso(job.lease_expires_at), images: images.rows.map((row) => ({ referenceItemId: String(row.reference_item_id), storageUrl: String(row.storage_url), storagePath: String(row.storage_path), mimeType: String(row.mime_type), sizeBytes: Number(row.byte_size), checksum: String(row.checksum) })) };
      });
    },
    async heartbeatDesignStyleAnalysis(input) {
      const result = await pool.query(`update brand_design_style_analysis_jobs set lease_expires_at=now()+($4||' seconds')::interval where id=$1 and leased_by=$2 and lease_token=$3 and status='processing' and lease_expires_at>now()`, [input.jobId, input.workerId, input.leaseToken, input.leaseSeconds]); return Number(result.rowCount) === 1;
    },
    async completeDesignStyleAnalysis(input) {
      const analysis = parseDesignStyleAnalysisV1(input.analysis);
      const computedSha256 = createHash("sha256").update(JSON.stringify(analysis)).digest("hex");
      if (computedSha256 !== input.analysisSha256) throw new Error("design_style_analysis_hash_mismatch");
      return tx(pool, async (client) => {
        const job = await client.query(`update brand_design_style_analysis_jobs set status='succeeded',leased_by=null,lease_token=null,lease_expires_at=null,error_code=null where id=$1 and leased_by=$2 and lease_token=$3 and status='processing' and design_style_id=$4 and style_revision=$5 and lease_expires_at>now() returning workspace_id,brand_id`, [input.jobId, input.workerId, input.leaseToken, input.designStyleId, input.styleRevision]);
        if (!job.rowCount) return false;
        const updated = await client.query(`update brand_design_styles set analysis_status='ready',analysis_contract_version='design-style-analysis.v1',analysis_json=$1::jsonb,analysis_sha256=$2,analysis_error_code=null where id=$3 and revision=$4 and analysis_status='processing'`, [JSON.stringify(analysis), input.analysisSha256, input.designStyleId, input.styleRevision]);
        return Number(updated.rowCount) === 1;
      });
    },
    async failDesignStyleAnalysis(input) {
      return tx(pool, async (client) => {
        const job = await client.query(`select * from brand_design_style_analysis_jobs where id=$1 and leased_by=$2 and lease_token=$3 and status='processing' and lease_expires_at>now() for update`, [input.jobId, input.workerId, input.leaseToken]);
        if (!job.rowCount) return false;
        const retry = input.retryable && Number(job.rows[0].attempt_count) < Number(job.rows[0].max_attempts);
        await client.query(`update brand_design_style_analysis_jobs set status=$1,available_at=case when $1='queued' then now()+interval '30 seconds' else available_at end,leased_by=null,lease_token=null,lease_expires_at=null,error_code=$2 where id=$3`, [retry ? "queued" : "failed", input.errorCode, input.jobId]);
        await client.query(`update brand_design_styles set analysis_status=$1,analysis_error_code=$2 where id=$3 and revision=$4`, [retry ? "queued" : "failed", input.errorCode, job.rows[0].design_style_id, job.rows[0].style_revision]);
        return true;
      });
    },
  };
}
