import type { Pool, PoolClient } from "pg";
import { parseProductServiceProfile, type ProductServiceProfileV1 } from "./productLibraryContracts.js";
import type { BrandScope } from "./brandCoreRepository.js";

export interface ProductServiceVersion extends BrandScope {
  id: string;
  productServiceId: string;
  sourceAnalysisId: string | null;
  version: number;
  status: "draft" | "approved" | "superseded";
  profile: ProductServiceProfileV1;
  evidence: unknown[];
  approvedAt: string | null;
  updatedAt: string;
}

export interface ProductServiceItem extends BrandScope {
  id: string;
  kind: "product" | "service";
  displayName: string;
  status: "active" | "archived";
  activeVersionId: string | null;
  activeVersion: ProductServiceVersion | null;
  draft: ProductServiceVersion | null;
}

export interface ProductLibraryRepository {
  listProductServices(scope: BrandScope, include?: string[]): Promise<ProductServiceItem[]>;
  getProductService(scope: BrandScope & { itemId: string }): Promise<ProductServiceItem | null>;
  createProductService(scope: BrandScope & { actorUserId: string }, profile: ProductServiceProfileV1): Promise<ProductServiceItem>;
  createProductServiceFromAnalysis(scope: BrandScope & { actorUserId: string; analysisId: string }): Promise<ProductServiceItem>;
  updateProductServiceDraft(scope: BrandScope & { actorUserId: string; itemId: string }, profile: ProductServiceProfileV1): Promise<ProductServiceItem>;
  approveProductService(scope: BrandScope & { actorUserId: string; itemId: string }): Promise<ProductServiceItem>;
  archiveProductService(scope: BrandScope & { actorUserId: string; itemId: string }): Promise<void>;
  summarizeProductServices(scope: BrandScope): Promise<{ active: number; drafts: number }>;
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function version(row: Record<string, unknown> | null): ProductServiceVersion | null {
  if (!row?.version_id) return null;
  return {
    id: String(row.version_id), workspaceId: String(row.workspace_id), brandId: String(row.brand_id),
    productServiceId: String(row.id), sourceAnalysisId: row.source_analysis_id ? String(row.source_analysis_id) : null,
    version: Number(row.version), status: row.version_status as ProductServiceVersion["status"],
    profile: parseProductServiceProfile(json(row.profile_json)), evidence: json<unknown[]>(row.evidence_json ?? []),
    approvedAt: row.approved_at ? new Date(row.approved_at as string).toISOString() : null,
    updatedAt: new Date(row.version_updated_at as string).toISOString(),
  };
}

function item(row: Record<string, unknown>): ProductServiceItem {
  const active = row.active_profile_json ? version({ ...row, version_id: row.active_version_id_join, version: row.active_version_number, version_status: "approved", profile_json: row.active_profile_json, evidence_json: row.active_evidence_json, approved_at: row.active_approved_at, version_updated_at: row.active_updated_at }) : null;
  const draft = row.draft_id ? version({ ...row, version_id: row.draft_id, version: row.draft_version, version_status: "draft", profile_json: row.draft_profile_json, evidence_json: row.draft_evidence_json, approved_at: null, version_updated_at: row.draft_updated_at }) : null;
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), brandId: String(row.brand_id),
    kind: row.kind as ProductServiceItem["kind"], displayName: String(row.display_name),
    status: row.status as ProductServiceItem["status"], activeVersionId: row.active_version_id ? String(row.active_version_id) : null,
    activeVersion: active, draft,
  };
}

const selectItem = `select item.*,
  active.id active_version_id_join, active.version active_version_number,
  active.profile_json active_profile_json, active.evidence_json active_evidence_json,
  active.approved_at active_approved_at, active.updated_at active_updated_at,
  draft.id draft_id, draft.version draft_version, draft.profile_json draft_profile_json,
  draft.evidence_json draft_evidence_json, draft.updated_at draft_updated_at
from product_services item
left join product_service_versions active on active.id = item.active_version_id
left join lateral (
  select * from product_service_versions candidate
  where candidate.product_service_id = item.id and candidate.workspace_id = item.workspace_id
    and candidate.brand_id = item.brand_id and candidate.status = 'draft'
  order by candidate.version desc limit 1
) draft on true`;

async function member(client: Pick<PoolClient, "query">, scope: BrandScope & { actorUserId: string }, approval = false) {
  const result = await client.query(
    `select role from workspace_members where workspace_id=$1 and user_id=$2 and status='active'
      and exists (select 1 from brands where id=$3 and workspace_id=$1)`,
    [scope.workspaceId, scope.actorUserId, scope.brandId],
  );
  if (!result.rowCount) throw new Error("product_service_access_forbidden");
  if (approval && !["owner", "admin"].includes(String(result.rows[0].role))) throw new Error("product_service_approval_forbidden");
}

async function tx<T>(pool: Pool, action: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try { await client.query("begin"); const result = await action(client); await client.query("commit"); return result; }
  catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

export function createProductLibraryRepository(pool: Pool): ProductLibraryRepository {
  async function get(scope: BrandScope & { itemId: string }, client: Pick<Pool, "query"> = pool) {
    const result = await client.query(`${selectItem} where item.id=$1 and item.workspace_id=$2 and item.brand_id=$3`, [scope.itemId, scope.workspaceId, scope.brandId]);
    return result.rowCount ? item(result.rows[0] as Record<string, unknown>) : null;
  }
  return {
    async listProductServices(scope, include = []) {
      const includeArchived = include.includes("archived");
      const includeDraft = include.includes("draft");
      const result = await pool.query(`${selectItem} where item.workspace_id=$1 and item.brand_id=$2 ${includeArchived ? "" : "and item.status='active'"} order by item.updated_at desc`, [scope.workspaceId, scope.brandId]);
      return result.rows.map((row) => item(row as Record<string, unknown>)).filter((value) => includeDraft || value.activeVersion);
    },
    getProductService: get,
    async createProductService(scope, raw) {
      const profile = parseProductServiceProfile(raw);
      return tx(pool, async (client) => {
        await member(client, scope);
        const created = await client.query(
          `insert into product_services(workspace_id,brand_id,kind,display_name)
           values($1,$2,$3,$4) returning id`,
          [scope.workspaceId, scope.brandId, profile.kind, profile.name],
        );
        await client.query(
          `insert into product_service_versions(workspace_id,brand_id,product_service_id,version,status,profile_json,created_by_user_id)
           values($1,$2,$3,1,'draft',$4,$5)`,
          [scope.workspaceId, scope.brandId, created.rows[0].id, JSON.stringify(profile), scope.actorUserId],
        );
        return (await get({ ...scope, itemId: created.rows[0].id }, client))!;
      });
    },
    async createProductServiceFromAnalysis(scope) {
      return tx(pool, async (client) => {
        await member(client, scope);
        const existing = await client.query(
          `${selectItem} join product_service_versions mapped on mapped.product_service_id=item.id
            where mapped.source_analysis_id=$1 and item.workspace_id=$2 and item.brand_id=$3 limit 1`,
          [scope.analysisId, scope.workspaceId, scope.brandId],
        );
        if (existing.rowCount) return item(existing.rows[0] as Record<string, unknown>);
        const analysis = await client.query(
          `select * from ai_content_subject_analyses where id=$1 and workspace_id=$2 and brand_id=$3
            and status in ('ready','partial')`,
          [scope.analysisId, scope.workspaceId, scope.brandId],
        );
        if (!analysis.rowCount) throw new Error("subject_analysis_not_found");
        const row = analysis.rows[0];
        const structured = json<Record<string, unknown>>(row.structured_data_json ?? {});
        const profile = parseProductServiceProfile({
          contractVersion: "product-service.v1",
          name: String(structured.name ?? structured.title ?? new URL(String(row.source_url)).hostname),
          kind: row.subject_type,
          description: String(structured.description ?? ""),
          features: Array.isArray(structured.features) ? structured.features : [],
          benefits: Array.isArray(structured.benefits) ? structured.benefits : [],
          cautions: [],
          audiences: json(row.targets_json ?? []),
          appealsByTarget: json(row.appeals_json ?? {}),
          evergreenPurchaseInfo: "",
          sourceUrls: [String(row.source_url)],
        });
        const created = await client.query(`insert into product_services(workspace_id,brand_id,kind,display_name) values($1,$2,$3,$4) returning id`, [scope.workspaceId, scope.brandId, profile.kind, profile.name]);
        await client.query(
          `insert into product_service_versions(workspace_id,brand_id,product_service_id,source_analysis_id,version,status,profile_json,evidence_json,created_by_user_id)
           values($1,$2,$3,$4,1,'draft',$5,$6,$7)`,
          [scope.workspaceId, scope.brandId, created.rows[0].id, scope.analysisId, JSON.stringify(profile), JSON.stringify(json(row.facts_json ?? [])), scope.actorUserId],
        );
        return (await get({ ...scope, itemId: created.rows[0].id }, client))!;
      });
    },
    async updateProductServiceDraft(scope, raw) {
      const profile = parseProductServiceProfile(raw);
      return tx(pool, async (client) => {
        await member(client, scope);
        const locked = await client.query("select id from product_services where id=$1 and workspace_id=$2 and brand_id=$3 for update", [scope.itemId, scope.workspaceId, scope.brandId]);
        if (!locked.rowCount) throw new Error("product_service_not_found");
        const updated = await client.query(
          `update product_service_versions set profile_json=$1,updated_at=now()
            where product_service_id=$2 and workspace_id=$3 and brand_id=$4 and status='draft' returning id`,
          [JSON.stringify(profile), scope.itemId, scope.workspaceId, scope.brandId],
        );
        if (!updated.rowCount) {
          await client.query(
            `insert into product_service_versions(workspace_id,brand_id,product_service_id,version,status,profile_json,created_by_user_id)
             select $1,$2,$3,coalesce(max(version),0)+1,'draft',$4,$5 from product_service_versions
             where product_service_id=$3 and workspace_id=$1 and brand_id=$2`,
            [scope.workspaceId, scope.brandId, scope.itemId, JSON.stringify(profile), scope.actorUserId],
          );
        }
        await client.query("update product_services set display_name=$1,kind=$2 where id=$3", [profile.name, profile.kind, scope.itemId]);
        return (await get(scope, client))!;
      });
    },
    async approveProductService(scope) {
      return tx(pool, async (client) => {
        await member(client, scope, true);
        await client.query("select id from product_services where id=$1 and workspace_id=$2 and brand_id=$3 for update", [scope.itemId, scope.workspaceId, scope.brandId]);
        const draft = await client.query(
          `select id from product_service_versions where product_service_id=$1 and workspace_id=$2 and brand_id=$3 and status='draft' order by version desc limit 1`,
          [scope.itemId, scope.workspaceId, scope.brandId],
        );
        if (!draft.rowCount) throw new Error("product_service_draft_not_found");
        await client.query(`update product_service_versions set status='superseded' where product_service_id=$1 and workspace_id=$2 and brand_id=$3 and status='approved'`, [scope.itemId, scope.workspaceId, scope.brandId]);
        await client.query(`update product_service_versions set status='approved',approved_by_user_id=$1,approved_at=now() where id=$2`, [scope.actorUserId, draft.rows[0].id]);
        await client.query(`update product_services set active_version_id=$1,status='active' where id=$2`, [draft.rows[0].id, scope.itemId]);
        return (await get(scope, client))!;
      });
    },
    async archiveProductService(scope) {
      await tx(pool, async (client) => {
        await member(client, scope, true);
        const result = await client.query(`update product_services set status='archived' where id=$1 and workspace_id=$2 and brand_id=$3`, [scope.itemId, scope.workspaceId, scope.brandId]);
        if (!result.rowCount) throw new Error("product_service_not_found");
      });
    },
    async summarizeProductServices(scope) {
      const result = await pool.query(
        `select count(*) filter(where item.status='active' and item.active_version_id is not null)::int active,
                count(*) filter(where version.status='draft')::int drafts
           from product_services item left join product_service_versions version on version.product_service_id=item.id
          where item.workspace_id=$1 and item.brand_id=$2`,
        [scope.workspaceId, scope.brandId],
      );
      return { active: Number(result.rows[0]?.active ?? 0), drafts: Number(result.rows[0]?.drafts ?? 0) };
    },
  };
}
