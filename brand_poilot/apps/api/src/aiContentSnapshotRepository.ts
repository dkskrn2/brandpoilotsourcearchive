import type {
  ApprovedBrandCoreSnapshotV2,
  ApprovedProductSnapshotV2,
  ContentReferenceRoleV2,
  FrozenReferenceSnapshotV2,
  FrozenStyleImageV2,
  GeneratedImageMimeTypeV2,
} from "./aiContentContracts.js";
import { parseBrandRulesContent } from "@brand-pilot/content-contracts";
import type { AiContentSnapshotBlob } from "./aiContentSnapshotBlob.js";
import type { BrandScope } from "./brandCoreRepository.js";

export type ReferenceRoleV2 = ContentReferenceRoleV2;
export type FrozenStyleImageSnapshotV1 = FrozenStyleImageV2;

export interface AiContentSnapshotRepository {
  assertApprovedBrandRulesAvailable(scope: BrandScope): Promise<void>;
  loadApprovedCore(scope: BrandScope): Promise<ApprovedBrandCoreSnapshotV2>;
  loadApprovedProduct(scope: BrandScope, productId: string): Promise<ApprovedProductSnapshotV2>;
  freezeReferences(
    scope: BrandScope,
    selected: Array<{ referenceId: string; roles: ReferenceRoleV2[] }>,
  ): Promise<FrozenReferenceSnapshotV2[]>;
  revalidateFrozenResources(input: {
    scope: BrandScope;
    coreVersionId: string;
    product: ApprovedProductSnapshotV2 | null;
    references: FrozenReferenceSnapshotV2[];
    database?: AiContentSnapshotQueryable;
  }): Promise<void>;
  loadApprovedStyleImages(
    scope: BrandScope,
    database?: AiContentSnapshotQueryable,
  ): Promise<FrozenStyleImageSnapshotV1[]>;
}

export interface AiContentSnapshotQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

export interface AiContentSnapshotQueryable {
  query(sql: string, params?: unknown[]): Promise<AiContentSnapshotQueryResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const ROLES = new Set<ReferenceRoleV2>(["planning", "copy_pattern", "visual_composition"]);
const IMAGE_MIMES = new Set<GeneratedImageMimeTypeV2>(["image/png", "image/jpeg", "image/webp"]);

function unavailable(): never {
  throw new Error("RESOURCE_NOT_AVAILABLE");
}

function brandRulesRequired(): never {
  throw new Error("ai_content_brand_rules_required");
}

function brandStyleRequired(): never {
  throw new Error("ai_content_brand_style_required");
}

function uuid(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID.test(normalized)) unavailable();
  return normalized;
}

function validatedScope(scope: BrandScope): BrandScope {
  return { workspaceId: uuid(scope.workspaceId), brandId: uuid(scope.brandId) };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return object(JSON.parse(value));
    } catch {
      unavailable();
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) unavailable();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function texts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function iso(value: unknown): string {
  if (typeof value !== "string" && !(value instanceof Date)) unavailable();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) unavailable();
  return date.toISOString();
}

function imageMime(value: unknown): GeneratedImageMimeTypeV2 | null {
  const normalized = text(value).toLowerCase() as GeneratedImageMimeTypeV2;
  return IMAGE_MIMES.has(normalized) ? normalized : null;
}

function sha256(value: unknown): string | null {
  const normalized = text(value).toLowerCase();
  return SHA256.test(normalized) ? normalized : null;
}

function validateSelection(
  selected: Array<{ referenceId: string; roles: ReferenceRoleV2[] }>,
): Array<{ referenceId: string; roles: ReferenceRoleV2[] }> {
  const seen = new Set<string>();
  return selected.map((entry) => {
    const referenceId = uuid(entry.referenceId);
    if (seen.has(referenceId) || !Array.isArray(entry.roles) || entry.roles.length === 0) unavailable();
    seen.add(referenceId);
    const roles = entry.roles.map((role) => {
      if (!ROLES.has(role)) unavailable();
      return role;
    });
    if (new Set(roles).size !== roles.length) unavailable();
    return { referenceId, roles };
  });
}

function coreSnapshot(row: Record<string, unknown>): ApprovedBrandCoreSnapshotV2 {
  const core = object(row.core_json);
  const category = object(core.primaryCategory ?? {});
  const subcategories = Array.isArray(core.subcategories)
    ? core.subcategories.map((item) => text(object(item).name)).filter(Boolean)
    : [];
  return {
    versionId: uuid(String(row.version_id)),
    companyOverview: text(core.companyOverview),
    businessDescription: text(core.businessDescription),
    primaryCategory: text(category.name),
    detailedCategory: subcategories.join(", "),
    primaryTarget: text(core.primaryTarget),
    differentiator: texts(core.differentiators).join("; "),
    coreAppeal: text(core.coreAppeal),
  };
}

function productProfile(row: Record<string, unknown>) {
  const profile = object(row.profile_json);
  const kind = row.item_kind;
  if (kind !== "product" && kind !== "service") unavailable();
  return {
    id: uuid(String(row.item_id)),
    versionId: uuid(String(row.version_id)),
    kind,
    name: text(profile.name),
    description: text(profile.description),
    features: texts(profile.features),
    benefits: texts(profile.benefits),
    cautions: texts(profile.cautions),
    evergreenPurchaseInfo: text(profile.evergreenPurchaseInfo),
  } as const;
}

function referencePayload(row: Record<string, unknown>) {
  const snapshot = object(row.snapshot_json);
  const content = object(snapshot.content);
  const referenceItemId = uuid(String(row.reference_item_id));
  const snapshotId = uuid(String(row.snapshot_id));
  if (uuid(String(snapshot.itemId)) !== referenceItemId || uuid(String(snapshot.snapshotId)) !== snapshotId) {
    unavailable();
  }
  const contentHash = sha256(snapshot.contentHash);
  if (!contentHash) unavailable();
  return {
    referenceItemId,
    snapshotId,
    title: text(snapshot.title) || text(content.title),
    sourceUrl: text(snapshot.sourceUrl),
    capturedAt: iso(snapshot.capturedAt),
    contentHash,
    text: text(content.text) || text(content.caption),
  };
}

export function createAiContentSnapshotRepository(
  database: AiContentSnapshotQueryable,
  blob: AiContentSnapshotBlob,
): AiContentSnapshotRepository {
  return {
    async assertApprovedBrandRulesAvailable(inputScope) {
      const scope = validatedScope(inputScope);
      const loaded = await database.query(
        `select rules.rules_json
           from brand_profiles profile
           join brand_rule_sets rules
             on rules.id = profile.active_brand_rule_set_id
            and rules.workspace_id = profile.workspace_id
            and rules.brand_id = profile.brand_id
            and rules.status = 'approved'
          where profile.workspace_id = $1
            and profile.brand_id = $2
            and profile.active_brand_rule_set_id is not null`,
        [scope.workspaceId, scope.brandId],
      );
      if (loaded.rows.length !== 1) brandRulesRequired();
      let rules;
      try {
        rules = parseBrandRulesContent(loaded.rows[0]!.rules_json);
      } catch {
        brandRulesRequired();
      }
      void rules;
    },

    async loadApprovedCore(inputScope) {
      const scope = validatedScope(inputScope);
      const loaded = await database.query(
        `select core.id as version_id, core.core_json
           from brand_profiles profile
           join brand_core_versions core
             on core.id = profile.active_brand_core_id
            and core.workspace_id = profile.workspace_id
            and core.brand_id = profile.brand_id
            and core.status = 'approved'
          where profile.workspace_id = $1
            and profile.brand_id = $2
            and profile.active_brand_core_id is not null`,
        [scope.workspaceId, scope.brandId],
      );
      if (loaded.rows.length !== 1) unavailable();
      return coreSnapshot(loaded.rows[0]!);
    },

    async loadApprovedProduct(inputScope, inputProductId) {
      const scope = validatedScope(inputScope);
      const productId = uuid(inputProductId);
      const loaded = await database.query(
        `select item.id as item_id, item.kind as item_kind,
                version.id as version_id, version.profile_json,
                asset.id as asset_id, asset.role as asset_role,
                asset.storage_path, asset.mime_type,
                null::text as asset_checksum
           from product_services item
           join product_service_versions version
             on version.id = item.active_version_id
            and version.product_service_id = item.id
            and version.workspace_id = item.workspace_id
            and version.brand_id = item.brand_id
            and version.status = 'approved'
           left join product_service_assets asset
             on asset.product_service_id = item.id
            and asset.product_service_version_id = version.id
            and asset.workspace_id = item.workspace_id
            and asset.brand_id = item.brand_id
            and asset.role in ('hero', 'detail')
            and asset.storage_path is not null
            and lower(asset.mime_type) in ('image/png', 'image/jpeg', 'image/webp')
          where item.id = $3
            and item.workspace_id = $1
            and item.brand_id = $2
            and item.status = 'active'
          order by asset.position nulls last, asset.id`,
        [scope.workspaceId, scope.brandId, productId],
      );
      if (loaded.rows.length === 0) unavailable();
      const profile = productProfile(loaded.rows[0]!);
      const images: ApprovedProductSnapshotV2["images"] = [];
      for (const row of loaded.rows) {
        if (row.asset_role !== "hero" && row.asset_role !== "detail") continue;
        const sourceStoragePath = text(row.storage_path);
        const mimeType = imageMime(row.mime_type);
        if (!row.asset_id || !sourceStoragePath || !mimeType) continue;
        const frozen = await blob.freezeOwnedImage({
          brandId: scope.brandId,
          sourceStoragePath,
          mimeType,
          expectedChecksum: sha256(row.asset_checksum),
        });
        images.push({
          assetId: uuid(String(row.asset_id)),
          role: row.asset_role,
          ...frozen,
        });
      }
      return { ...profile, images };
    },

    async freezeReferences(inputScope, inputSelected) {
      const scope = validatedScope(inputScope);
      const selected = validateSelection(inputSelected);
      if (selected.length === 0) return [];
      const referenceIds = selected.map(({ referenceId }) => referenceId);
      const loaded = await database.query(
        `select item.id as reference_item_id,
                snapshot.id as snapshot_id,
                snapshot.snapshot_json,
                coalesce(media_artifact.path, item_artifact.path) as immutable_storage_path,
                coalesce(media_artifact.mime_type, item_artifact.mime_type) as immutable_mime_type,
                coalesce(media_artifact.checksum, item_artifact.checksum) as immutable_checksum
           from reference_items item
           join lateral (
             select candidate.*
               from reference_snapshots candidate
              where candidate.reference_item_id = item.id
                and candidate.workspace_id = item.workspace_id
                and candidate.brand_id = item.brand_id
              order by candidate.version desc
              limit 1
           ) snapshot on true
           left join storage_artifacts item_artifact
             on item_artifact.id = item.storage_artifact_id
            and item_artifact.workspace_id = item.workspace_id
            and item_artifact.brand_id = item.brand_id
            and item_artifact.deleted_at is null
            and item_artifact.path is not null
            and lower(item_artifact.mime_type) in ('image/png', 'image/jpeg', 'image/webp')
           left join storage_artifacts media_artifact
             on media_artifact.workspace_id = item.workspace_id
            and media_artifact.brand_id = item.brand_id
            and media_artifact.path = nullif(snapshot.snapshot_json #>> '{media,storagePath}', '')
            and media_artifact.deleted_at is null
            and lower(media_artifact.mime_type) in ('image/png', 'image/jpeg', 'image/webp')
          where item.workspace_id = $1
            and item.brand_id = $2
            and item.id = any($3::uuid[])
            and item.archived_at is null
            and snapshot.snapshot_json #>> '{permittedUse,modelInput}' = 'true'
            and snapshot.snapshot_json #>> '{permittedUse,derivativeInspiration}' = 'true'`,
        [scope.workspaceId, scope.brandId, referenceIds],
      );
      if (loaded.rows.length !== selected.length) unavailable();
      const byId = new Map(loaded.rows.map((row) => [uuid(String(row.reference_item_id)), row]));
      const frozen: FrozenReferenceSnapshotV2[] = [];
      for (const selection of selected) {
        const row = byId.get(selection.referenceId);
        if (!row) unavailable();
        const payload = referencePayload(row);
        const sourceStoragePath = text(row.immutable_storage_path);
        const mimeType = imageMime(row.immutable_mime_type);
        const checksum = sha256(row.immutable_checksum);
        const image = sourceStoragePath && mimeType && checksum
          ? await blob.freezeOwnedImage({
            brandId: scope.brandId,
            sourceStoragePath,
            mimeType,
            expectedChecksum: checksum,
          })
          : null;
        frozen.push({ ...payload, roles: [...selection.roles], image });
      }
      return frozen;
    },

    async revalidateFrozenResources(input) {
      const scope = validatedScope(input.scope);
      const coreVersionId = uuid(input.coreVersionId);
      const queryable = input.database ?? database;
      const core = await queryable.query(
        `select true as eligible
           from brand_core_versions core
          where core.workspace_id = $1
            and core.brand_id = $2
            and core.id = $3
            and core.status = 'approved'
          for share`,
        [scope.workspaceId, scope.brandId, coreVersionId],
      );
      if (core.rows.length !== 1) unavailable();

      if (input.product !== null) {
        const product = await queryable.query(
          `select true as eligible
             from product_services item
             join product_service_versions version
               on version.product_service_id = item.id
              and version.workspace_id = item.workspace_id
              and version.brand_id = item.brand_id
              and version.status = 'approved'
            where item.workspace_id = $1
              and item.brand_id = $2
              and item.id = $3
              and version.id = $4
              and item.status = 'active'
            for share of item,version`,
          [scope.workspaceId, scope.brandId, uuid(input.product.id), uuid(input.product.versionId)],
        );
        if (product.rows.length !== 1) unavailable();
      }

      if (input.references.length > 0) {
        const selected = validateSelection(input.references.map((reference) => ({
          referenceId: reference.referenceItemId,
          roles: reference.roles,
        })));
        const snapshotIds = input.references.map((reference) => uuid(reference.snapshotId));
        const references = await queryable.query(
          `select requested.reference_item_id
             from unnest($3::uuid[], $4::uuid[])
                    as requested(reference_item_id, snapshot_id)
             join reference_items item
               on item.id = requested.reference_item_id
             join reference_snapshots snapshot
               on snapshot.reference_item_id = item.id
              and snapshot.id = requested.snapshot_id
              and snapshot.workspace_id = item.workspace_id
              and snapshot.brand_id = item.brand_id
            where item.workspace_id = $1
              and item.brand_id = $2
              and item.archived_at is null
              and snapshot.snapshot_json #>> '{permittedUse,modelInput}' = 'true'
              and snapshot.snapshot_json #>> '{permittedUse,derivativeInspiration}' = 'true'
            for share of item,snapshot`,
          [scope.workspaceId, scope.brandId, selected.map(({ referenceId }) => referenceId), snapshotIds],
        );
        if (references.rows.length !== input.references.length) unavailable();
      }
    },

    async loadApprovedStyleImages(inputScope, databaseOverride) {
      void validatedScope(inputScope); void databaseOverride; return [];
    },
  };
}
