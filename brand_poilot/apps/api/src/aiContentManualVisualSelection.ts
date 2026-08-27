import {
  type ApprovedProductSnapshotV2,
} from "@brand-pilot/content-contracts";
import {
  parseFrozenManualVisualSelection,
  parseFrozenManualVisualSelectionV1,
  parseFrozenManualVisualSelectionV2,
  parseManualVisualSelection,
  parseManualVisualSelectionV1,
  parseManualVisualSelectionV2,
  type FrozenManualVisualSelection,
  type FrozenManualVisualSelectionV1,
  type FrozenManualVisualSelectionV2,
  type ManualVisualSelection,
  type ManualVisualSelectionV1,
  type ManualVisualSelectionV2,
} from "@brand-pilot/content-contracts/manual-visual-selection";
import {
  parseProductVisualSourceSnapshotV1,
  type ProductVisualSourceSnapshotV1,
} from "@brand-pilot/content-contracts/product-visual-references";
import type { FrozenStyleImageV2 } from "./aiContentContracts.js";
import { parseProductServiceProfile } from "./productLibraryContracts.js";
import { proposalSha256 } from "./aiContentProposalV2Service.js";

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface ManualVisualSelectionScope {
  workspaceId: string;
  brandId: string;
  generationId: string;
}

export interface PreparedManualVisualSelection {
  frozen: FrozenManualVisualSelection;
  selectionSha256: string;
  alreadyFrozen: boolean;
}

export interface MaterializedManualVisualAssets {
  product: ApprovedProductSnapshotV2 | null;
  brandStyleImages: FrozenStyleImageV2[];
  avatarStyleImageId: string | null;
}

function safeProductSourceUrls(sourceUrls: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const value of sourceUrls) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) continue;
      unique.add(parsed.toString());
      if (unique.size === 5) break;
    } catch {
      // An unavailable product page must not make content generation fail.
    }
  }
  return [...unique];
}

export async function loadFrozenProductVisualSourceSnapshot(
  client: Queryable,
  scope: ManualVisualSelectionScope,
  raw: FrozenManualVisualSelection,
): Promise<ProductVisualSourceSnapshotV1 | null> {
  const selection = parseFrozenManualVisualSelection(raw);
  if (!selection.product) return null;
  const selected = await client.query(
    `select item.kind,version.profile_json
       from product_services item
       join product_service_versions version
         on version.id=$2 and version.product_service_id=item.id
        and version.workspace_id=item.workspace_id and version.brand_id=item.brand_id
      where item.id=$1 and item.workspace_id=$3 and item.brand_id=$4
        and item.status='active' and item.active_version_id=version.id
        and version.status='approved'`,
    [selection.product.productServiceId, selection.product.versionId, scope.workspaceId, scope.brandId],
  );
  const row = selected.rows[0];
  if (!row || String(row.kind) !== selection.product.kind) unavailable();
  const profile = parseProductServiceProfile(json(row.profile_json));
  if (profile.kind !== selection.product.kind) unavailable();
  const sourceUrls = safeProductSourceUrls(profile.sourceUrls);
  if (sourceUrls.length === 0) return null;
  return parseProductVisualSourceSnapshotV1({
    contractVersion: "product-visual-source-snapshot.v1",
    productServiceId: selection.product.productServiceId,
    versionId: selection.product.versionId,
    kind: selection.product.kind,
    sourceUrls,
  });
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function unavailable(): never { throw new Error("manual_visual_selection_unavailable"); }

function exactIds(rows: any[], key: string, expected: readonly string[]): void {
  if (rows.length !== expected.length
    || rows.some((row, index) => String(row[key]) !== expected[index])) unavailable();
}

async function materializeFrozenManualVisualAssetsV1(
  client: Queryable,
  scope: ManualVisualSelectionScope,
  raw: FrozenManualVisualSelectionV1,
): Promise<MaterializedManualVisualAssets> {
  const selection = parseFrozenManualVisualSelectionV1(raw);
  let product: ApprovedProductSnapshotV2 | null = null;
  if (selection.product !== null) {
    const ids = selection.product.images.map(({ assetId }) => assetId);
    const assets = ids.length === 0 ? { rows: [] as any[] } : await client.query(
      `select asset.id,asset.role,asset.position,asset.storage_url,asset.storage_path,
              lower(asset.mime_type) mime_type,asset.checksum
         from product_service_assets asset
        where asset.id=any($1::uuid[]) and asset.product_service_id=$2
          and asset.product_service_version_id=$3 and asset.workspace_id=$4 and asset.brand_id=$5
          and asset.storage_url is not null and asset.storage_path is not null
          and asset.checksum ~ '^[0-9a-f]{64}$'
          and lower(asset.mime_type) in ('image/png','image/jpeg','image/webp')
        order by asset.position`,
      [ids, selection.product.productServiceId, selection.product.versionId, scope.workspaceId, scope.brandId],
    );
    exactIds(assets.rows, "id", ids);
    product = {
      id: selection.product.productServiceId,
      versionId: selection.product.versionId,
      kind: selection.product.kind,
      name: selection.product.name,
      description: selection.product.description,
      features: selection.product.features,
      benefits: selection.product.benefits,
      cautions: selection.product.cautions,
      evergreenPurchaseInfo: selection.product.evergreenPurchaseInfo,
      images: assets.rows.map((asset) => ({
        assetId: String(asset.id), role: asset.role as "hero" | "detail",
        storageUrl: String(asset.storage_url), storagePath: String(asset.storage_path),
        mimeType: String(asset.mime_type) as "image/png" | "image/jpeg" | "image/webp",
        checksum: String(asset.checksum),
      })),
    };
  }

  const brandStyleImages: FrozenStyleImageV2[] = [];
  if (selection.stylePreset !== null) {
    const ids = selection.stylePreset.referenceItemIds;
    const references = await client.query(
      `select requested.id reference_item_id,item.title,
              artifact.public_url storage_url,artifact.path storage_path,
              lower(artifact.mime_type) mime_type,artifact.checksum
         from unnest($1::uuid[]) with ordinality requested(id,position)
         join reference_items item
           on item.id=requested.id and item.workspace_id=$2 and item.brand_id=$3
          and item.archived_at is null and item.storage_artifact_id is not null
         join storage_artifacts artifact
           on artifact.id=item.storage_artifact_id and artifact.workspace_id=item.workspace_id
          and artifact.brand_id=item.brand_id and artifact.deleted_at is null
          and artifact.public_url is not null and artifact.path is not null
          and artifact.checksum ~ '^[0-9a-f]{64}$'
          and lower(artifact.mime_type) in ('image/png','image/jpeg','image/webp')
        order by requested.position`,
      [ids, scope.workspaceId, scope.brandId],
    );
    exactIds(references.rows, "reference_item_id", ids);
    brandStyleImages.push(...references.rows.map((reference) => ({
      referenceItemId: String(reference.reference_item_id),
      description: [String(reference.title ?? "").trim(), selection.stylePreset!.description.trim()]
        .filter(Boolean).join(" — "),
      tags: ["style-preset"], storageUrl: String(reference.storage_url),
      storagePath: String(reference.storage_path),
      mimeType: String(reference.mime_type) as "image/png" | "image/jpeg" | "image/webp",
      checksum: String(reference.checksum),
    })));
  }

  let avatarStyleImageId: string | null = null;
  if (selection.avatar !== null) {
    const ids = selection.avatar.imageAssetIds;
    const images = await client.query(
      `select image.id,image.position,image.is_representative,image.storage_url,image.storage_path,
              lower(image.mime_type) mime_type,image.checksum
         from brand_avatar_images image
        where image.id=any($1::uuid[]) and image.avatar_id=$2
          and image.workspace_id=$3 and image.brand_id=$4
          and image.checksum ~ '^[0-9a-f]{64}$'
          and lower(image.mime_type) in ('image/png','image/jpeg','image/webp')
        order by image.position`,
      [ids, selection.avatar.avatarId, scope.workspaceId, scope.brandId],
    );
    exactIds(images.rows, "id", ids);
    const representatives = images.rows.filter((image) => image.is_representative === true);
    if (representatives.length !== 1) unavailable();
    avatarStyleImageId = String(representatives[0].id);
    brandStyleImages.push(...images.rows.map((image) => ({
      referenceItemId: String(image.id),
      description: [selection.avatar!.name.trim(), selection.avatar!.description.trim()]
        .filter(Boolean).join(" — "),
      tags: ["avatar"], storageUrl: String(image.storage_url), storagePath: String(image.storage_path),
      mimeType: String(image.mime_type) as "image/png" | "image/jpeg" | "image/webp",
      checksum: String(image.checksum),
    })));
  }
  if (new Set(brandStyleImages.map(({ referenceItemId }) => referenceItemId)).size !== brandStyleImages.length) {
    unavailable();
  }
  return { product, brandStyleImages, avatarStyleImageId };
}

async function materializeFrozenManualVisualAssetsV2(
  client: Queryable,
  scope: ManualVisualSelectionScope,
  raw: FrozenManualVisualSelectionV2,
): Promise<MaterializedManualVisualAssets> {
  const selection = parseFrozenManualVisualSelectionV2(raw);
  const productOnly = await materializeFrozenManualVisualAssetsV1(client, scope, {
    contractVersion: "manual-visual-selection-frozen.v1",
    product: selection.product,
    stylePreset: null,
    avatar: null,
  });
  const brandStyleImages: FrozenStyleImageV2[] = [];
  if (selection.preset) {
    const referenceIds = selection.preset.designStyle.referenceItemIds;
    const references = await client.query(
      `select requested.id reference_item_id,item.title,artifact.public_url storage_url,
              artifact.path storage_path,lower(artifact.mime_type) mime_type,artifact.checksum
         from unnest($1::uuid[]) with ordinality requested(id,position)
         join reference_items item on item.id=requested.id and item.workspace_id=$2 and item.brand_id=$3
          and item.archived_at is null and item.storage_artifact_id is not null
         join storage_artifacts artifact on artifact.id=item.storage_artifact_id
          and artifact.workspace_id=item.workspace_id and artifact.brand_id=item.brand_id
          and artifact.deleted_at is null and artifact.public_url is not null and artifact.path is not null
          and artifact.checksum ~ '^[0-9a-f]{64}$'
          and lower(artifact.mime_type) in ('image/png','image/jpeg','image/webp')
        order by requested.position`,
      [referenceIds, scope.workspaceId, scope.brandId],
    );
    exactIds(references.rows, "reference_item_id", referenceIds);
    brandStyleImages.push(...references.rows.map((reference) => ({
      referenceItemId: String(reference.reference_item_id),
      description: [String(reference.title ?? "").trim(), selection.preset!.name].filter(Boolean).join(" — "),
      tags: ["design-style"], storageUrl: String(reference.storage_url), storagePath: String(reference.storage_path),
      mimeType: String(reference.mime_type) as "image/png" | "image/jpeg" | "image/webp",
      checksum: String(reference.checksum),
    })));
    if (selection.preset.avatar) {
      const avatar = selection.preset.avatar;
      const images = await client.query(
        `select id,position,is_representative,storage_url,storage_path,lower(mime_type) mime_type,checksum
           from brand_avatar_images where id=any($1::uuid[]) and avatar_id=$2
            and workspace_id=$3 and brand_id=$4 order by position`,
        [avatar.imageAssetIds, avatar.avatarId, scope.workspaceId, scope.brandId],
      );
      exactIds(images.rows, "id", avatar.imageAssetIds);
      brandStyleImages.push(...images.rows.map((image) => ({
        referenceItemId: String(image.id), description: [avatar.name, avatar.description].filter(Boolean).join(" — "),
        tags: ["avatar"], storageUrl: String(image.storage_url), storagePath: String(image.storage_path),
        mimeType: String(image.mime_type) as "image/png" | "image/jpeg" | "image/webp", checksum: String(image.checksum),
      })));
      const representative = images.rows.filter((image) => image.is_representative === true);
      if (representative.length !== 1) unavailable();
      return { product: productOnly.product, brandStyleImages, avatarStyleImageId: String(representative[0].id) };
    }
  }
  return { product: productOnly.product, brandStyleImages, avatarStyleImageId: null };
}

export async function materializeFrozenManualVisualAssets(
  client: Queryable,
  scope: ManualVisualSelectionScope,
  raw: FrozenManualVisualSelection,
): Promise<MaterializedManualVisualAssets> {
  return raw.contractVersion === "manual-visual-selection-frozen.v1"
    ? materializeFrozenManualVisualAssetsV1(client, scope, raw)
    : materializeFrozenManualVisualAssetsV2(client, scope, raw);
}

async function resolveFrozenV1(
  client: Queryable,
  scope: ManualVisualSelectionScope,
  raw: ManualVisualSelectionV1,
): Promise<FrozenManualVisualSelectionV1> {
  const selection = parseManualVisualSelectionV1(raw);
  let product: FrozenManualVisualSelectionV1["product"] = null;
  if (selection.product) {
    const selected = await client.query(
      `select item.id,item.kind,item.display_name,item.status,item.active_version_id,
              version.id version_id,version.status version_status,version.profile_json
         from product_services item
         join product_service_versions version
           on version.id=$2 and version.product_service_id=item.id
          and version.workspace_id=item.workspace_id and version.brand_id=item.brand_id
        where item.id=$1 and item.workspace_id=$3 and item.brand_id=$4`,
      [selection.product.productServiceId, selection.product.versionId, scope.workspaceId, scope.brandId],
    );
    const row = selected.rows[0];
    if (!row || row.status !== "active" || row.version_status !== "approved"
      || String(row.active_version_id) !== selection.product.versionId) unavailable();
    const profile = parseProductServiceProfile(json(row.profile_json));
    const assets = await client.query(
      `select id,role,position from product_service_assets
        where product_service_id=$1 and product_service_version_id=$2
          and workspace_id=$3 and brand_id=$4
        order by position`,
      [selection.product.productServiceId, selection.product.versionId, scope.workspaceId, scope.brandId],
    );
    const confirmed = await client.query(
      `select item.status,item.active_version_id,version.status version_status
         from product_services item
         join product_service_versions version
           on version.id=$2 and version.product_service_id=item.id
          and version.workspace_id=item.workspace_id and version.brand_id=item.brand_id
        where item.id=$1 and item.workspace_id=$3 and item.brand_id=$4`,
      [selection.product.productServiceId, selection.product.versionId, scope.workspaceId, scope.brandId],
    );
    const confirmedRow = confirmed.rows[0];
    if (!confirmedRow || confirmedRow.status !== "active" || confirmedRow.version_status !== "approved"
      || String(confirmedRow.active_version_id) !== selection.product.versionId) unavailable();
    product = {
      productServiceId: selection.product.productServiceId,
      versionId: selection.product.versionId,
      kind: profile.kind,
      name: profile.name,
      description: profile.description,
      features: profile.features,
      benefits: profile.benefits,
      cautions: profile.cautions,
      evergreenPurchaseInfo: profile.evergreenPurchaseInfo,
      images: assets.rows.map((asset) => ({
        assetId: String(asset.id), role: asset.role as "hero" | "detail", position: Number(asset.position),
      })),
    };
  }

  try {
    return parseFrozenManualVisualSelectionV1({
      contractVersion: "manual-visual-selection-frozen.v1",
      product,
      stylePreset: null,
      avatar: null,
    });
  } catch { return unavailable(); }
}

async function resolveFrozenV2(
  client: Queryable,
  scope: ManualVisualSelectionScope,
  raw: ManualVisualSelectionV2,
): Promise<FrozenManualVisualSelectionV2> {
  const selection = parseManualVisualSelectionV2(raw);
  const productOnly = await resolveFrozenV1(client, scope, {
    contractVersion: "manual-visual-selection.v1",
    product: selection.product,
    stylePreset: null,
    avatar: null,
  });
  let preset: FrozenManualVisualSelectionV2["preset"] = null;
  if (selection.preset) {
    const selected = await client.query(
      `select preset.id,preset.revision,preset.name,preset.design_style_id,preset.avatar_id,
              style.revision style_revision,style.analysis_status,style.analysis_json
         from brand_style_presets preset
         join brand_design_styles style on style.id=preset.design_style_id
          and style.workspace_id=preset.workspace_id and style.brand_id=preset.brand_id
        where preset.id=$1 and preset.workspace_id=$2 and preset.brand_id=$3 and preset.status='active'
        for update of preset,style`,
      [selection.preset.presetId, scope.workspaceId, scope.brandId],
    );
    const row = selected.rows[0];
    if (!row) throw new Error("visual_preset_not_usable");
    if (Number(row.revision) !== selection.preset.revision) throw new Error("visual_preset_revision_stale");
    if (row.analysis_status !== "ready" || !row.analysis_json) throw new Error("visual_preset_not_usable");
    const references = await client.query(
      `select reference_item_id from brand_design_style_references
        where design_style_id=$1 and workspace_id=$2 and brand_id=$3 order by position`,
      [row.design_style_id, scope.workspaceId, scope.brandId],
    );
    if (references.rows.length < 1) throw new Error("visual_preset_not_usable");
    let avatar: NonNullable<FrozenManualVisualSelectionV2["preset"]>["avatar"] = null;
    if (row.avatar_id) {
      const selectedAvatar = await client.query(
        `select id,revision,name,description,status from brand_avatars
          where id=$1 and workspace_id=$2 and brand_id=$3 for update`,
        [row.avatar_id, scope.workspaceId, scope.brandId],
      );
      const avatarRow = selectedAvatar.rows[0];
      if (!avatarRow || avatarRow.status !== "active") throw new Error("visual_preset_not_usable");
      const images = await client.query(
        `select id from brand_avatar_images where avatar_id=$1 and workspace_id=$2 and brand_id=$3 order by position`,
        [row.avatar_id, scope.workspaceId, scope.brandId],
      );
      if (images.rows.length < 1) throw new Error("visual_preset_not_usable");
      avatar = {
        avatarId: String(avatarRow.id), revision: Number(avatarRow.revision), name: String(avatarRow.name),
        description: String(avatarRow.description ?? ""), imageAssetIds: images.rows.map((image) => String(image.id)),
      };
    }
    preset = {
      presetId: selection.preset.presetId, revision: selection.preset.revision, name: String(row.name),
      designStyle: {
        designStyleId: String(row.design_style_id), revision: Number(row.style_revision),
        analysis: json(row.analysis_json), referenceItemIds: references.rows.map((reference) => String(reference.reference_item_id)),
      },
      avatar,
    };
  }
  try {
    return parseFrozenManualVisualSelectionV2({
      contractVersion: "manual-visual-selection-frozen.v2", product: productOnly.product, preset,
    });
  } catch { return unavailable(); }
}

async function resolveFrozen(
  client: Queryable,
  scope: ManualVisualSelectionScope,
  selection: ManualVisualSelection,
): Promise<FrozenManualVisualSelection> {
  if (selection.contractVersion === "manual-visual-selection.v1") unavailable();
  return resolveFrozenV2(client, scope, selection);
}

export async function saveManualVisualSelection(
  client: Queryable,
  scope: ManualVisualSelectionScope,
  raw: ManualVisualSelectionV2,
): Promise<ManualVisualSelectionV2> {
  const selection = parseManualVisualSelectionV2(raw);
  await resolveFrozen(client, scope, selection);
  const selectionSha256 = proposalSha256(selection);
  const saved = await client.query(
    `insert into manual_ai_content_visual_selections(
       generation_id,workspace_id,brand_id,contract_version,
       product_service_id,product_service_version_id,style_preset_id,style_preset_revision,
       avatar_id,avatar_revision,selection_json,selection_sha256
     ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
     on conflict(generation_id) do update set
       product_service_id=excluded.product_service_id,
       product_service_version_id=excluded.product_service_version_id,
       style_preset_id=excluded.style_preset_id,
       style_preset_revision=excluded.style_preset_revision,
       avatar_id=excluded.avatar_id,avatar_revision=excluded.avatar_revision,
       selection_json=excluded.selection_json,selection_sha256=excluded.selection_sha256
     where manual_ai_content_visual_selections.workspace_id=excluded.workspace_id
       and manual_ai_content_visual_selections.brand_id=excluded.brand_id
       and manual_ai_content_visual_selections.frozen_json is null
     returning selection_json,selection_sha256,frozen_json,frozen_sha256`,
    [scope.generationId, scope.workspaceId, scope.brandId, selection.contractVersion,
      selection.product?.productServiceId ?? null, selection.product?.versionId ?? null,
      selection.preset?.presetId ?? null, selection.preset?.revision ?? null,
      null, null,
      JSON.stringify(selection), selectionSha256],
  );
  if (Number(saved.rowCount ?? 0) !== 1) throw new Error("manual_visual_selection_locked");
  return parseManualVisualSelectionV2(json(saved.rows[0].selection_json));
}

export async function prepareManualVisualSelection(
  client: Queryable,
  scope: ManualVisualSelectionScope,
): Promise<PreparedManualVisualSelection> {
  const locked = await client.query(
    `select selection_json,selection_sha256,frozen_json,frozen_sha256
       from manual_ai_content_visual_selections
      where generation_id=$1 and workspace_id=$2 and brand_id=$3 for update`,
    [scope.generationId, scope.workspaceId, scope.brandId],
  );
  const row = locked.rows[0];
  if (!row) throw new Error("manual_visual_selection_missing");
  const selection = parseManualVisualSelection(json(row.selection_json));
  if (proposalSha256(selection) !== String(row.selection_sha256)) unavailable();
  if (row.frozen_json !== null && row.frozen_json !== undefined) {
    const frozen = parseFrozenManualVisualSelection(json(row.frozen_json));
    if (proposalSha256(frozen) !== String(row.frozen_sha256)) unavailable();
    return { frozen, selectionSha256: String(row.selection_sha256), alreadyFrozen: true };
  }
  const frozen = await resolveFrozen(client, scope, selection);
  return { frozen, selectionSha256: String(row.selection_sha256), alreadyFrozen: false };
}

export async function sealManualVisualSelection(
  client: Queryable,
  scope: ManualVisualSelectionScope,
  prepared: PreparedManualVisualSelection,
): Promise<FrozenManualVisualSelection> {
  if (prepared.alreadyFrozen) return prepared.frozen;
  const frozen = prepared.frozen;
  const frozenSha256 = proposalSha256(frozen);
  const updated = await client.query(
    `update manual_ai_content_visual_selections
        set frozen_json=$4::jsonb,frozen_sha256=$5,frozen_at=now()
      where generation_id=$1 and workspace_id=$2 and brand_id=$3
        and frozen_json is null and selection_sha256=$6
      returning selection_json,selection_sha256,frozen_json,frozen_sha256`,
    [scope.generationId, scope.workspaceId, scope.brandId,
      JSON.stringify(frozen), frozenSha256, prepared.selectionSha256],
  );
  if (Number(updated.rowCount ?? 0) !== 1) throw new Error("manual_visual_selection_conflict");
  return frozen;
}

export async function freezeManualVisualSelection(
  client: Queryable,
  scope: ManualVisualSelectionScope,
): Promise<FrozenManualVisualSelection> {
  return sealManualVisualSelection(client, scope, await prepareManualVisualSelection(client, scope));
}
