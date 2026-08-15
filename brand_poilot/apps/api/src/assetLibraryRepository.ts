import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { BrandScope } from "./brandCoreRepository.js";
import {
  parseAvatarInput,
  parseCreateAvatarInput,
  parseReferenceBrandInput,
  parseReferenceUrlInput,
  type AssetUploadInput,
  type AvatarInput,
  type CreateAvatarInput,
  type ReferenceBrandInput,
  type ReferenceFilters,
  type ReferenceUrlInput,
} from "./assetLibraryContracts.js";
import type {
  AssetLibraryUploadKind,
  AssetLibraryUploadSession,
  ConfirmedAssetLibraryUpload,
} from "./assetLibraryUpload.js";
import { hashSourceUrl, normalizeSourceDomain, normalizeSourceUrl } from "./sourceUrl.js";

export interface AvatarImage {
  id: string;
  position: number;
  representative: boolean;
  storagePath: string;
  storageUrl: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}
export interface Avatar extends BrandScope {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  status: "active" | "archived";
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  images: AvatarImage[];
}
export interface ReferenceItem extends BrandScope {
  id: string;
  kind: string;
  contentPurpose: string;
  origin: string;
  title: string;
  previewUrl: string | null;
  sourceUrl: string | null;
  format: string | null;
  metadata: Record<string, unknown>;
  favorite: boolean;
  archivedAt: string | null;
  referenceBrandId: string | null;
  sourcePlatform: "instagram" | "meta_ad_library" | null;
  sourceState: "available" | "unavailable" | null;
  createdAt: string;
  updatedAt: string;
}
export interface ReferenceDetail extends ReferenceItem {
  description: string | null;
  body: string | null;
  snapshot: {
    id: string;
    fetchedAt: string;
    metadata: Record<string, unknown>;
  } | null;
}
export interface ReferenceBrand extends BrandScope {
  id: string;
  platform: string;
  handle: string;
  displayName: string;
  publicSourceUrl: string;
  profileSnapshot: Record<string, unknown>;
  previewUrl: string | null;
}
export interface AvatarImageInput extends ConfirmedAssetLibraryUpload { representative: boolean; }

export interface AssetLibraryRepository {
  listAvatars(scope: BrandScope, includeArchived?: boolean): Promise<Avatar[]>;
  getAvatar(scope: BrandScope & { avatarId: string }): Promise<Avatar | null>;
  createAvatar(scope: BrandScope & { actorUserId: string }, input: CreateAvatarInput): Promise<Avatar>;
  updateAvatar(scope: BrandScope & { actorUserId: string; avatarId: string }, input: AvatarInput): Promise<Avatar>;
  addAvatarImage(scope: BrandScope & { actorUserId: string; avatarId: string }, image: AvatarImageInput): Promise<Avatar>;
  deleteAvatarImage(scope: BrandScope & { actorUserId: string; avatarId: string; imageId: string }): Promise<void>;
  setDefaultAvatar(scope: BrandScope & { actorUserId: string; avatarId: string }): Promise<Avatar>;
  archiveAvatar(scope: BrandScope & { actorUserId: string; avatarId: string }): Promise<void>;
  summarizeAvatars(scope: BrandScope): Promise<{ active: number; defaultAvatarId: string | null }>;
  listReferences(scope: BrandScope, filters: ReferenceFilters): Promise<ReferenceItem[]>;
  getReference(scope: BrandScope & { referenceId: string }): Promise<ReferenceDetail | null>;
  addReferenceUrl(scope: BrandScope & { actorUserId: string }, input: ReferenceUrlInput): Promise<ReferenceItem>;
  setReferenceFavorite(scope: BrandScope & { actorUserId: string; referenceId: string }, favorite: boolean): Promise<ReferenceItem>;
  archiveReference(scope: BrandScope & { actorUserId: string; referenceId: string }): Promise<void>;
  getReferencePattern(scope: BrandScope & { referenceId: string }): Promise<Record<string, unknown> | null>;
  createUploadSession(scope: BrandScope & { actorUserId: string }, kind: AssetLibraryUploadKind, upload: AssetUploadInput, avatarId?: string): Promise<AssetLibraryUploadSession>;
  getUploadSession(scope: BrandScope & { sessionId: string }, fileName: string): Promise<AssetLibraryUploadSession | null>;
  confirmAvatarUpload(
    scope: BrandScope & { actorUserId: string; avatarId: string; sessionId: string },
    upload: AvatarImageInput,
  ): Promise<{ status: "staged"; avatarId: string; sessionId: string } | { status: "attached"; avatar: Avatar }>;
  cancelAvatarUpload(
    scope: BrandScope & { actorUserId: string; avatarId: string; sessionId: string },
    cleanupBlobs: (storagePathPrefix: string, storagePath?: string) => Promise<void>,
    reason?: "user" | "expired",
  ): Promise<
    { status: "cleanup_pending"; immediateCleanup: "succeeded" | "retry_scheduled" | "already_pending" }
    | { status: "already_cancelled" }
  >;
  cleanupExpiredAvatarUploads(
    cleanupBlobs: (storagePathPrefix: string, storagePath?: string) => Promise<void>,
    limit?: number,
  ): Promise<{ scanned: number; cancelled: number; failed: Array<{ sessionId: string; error: string }> }>;
  cancelReferenceUpload(
    scope: BrandScope & { actorUserId: string; sessionId: string },
    cleanupBlobs: (storagePathPrefix: string, storagePath?: string) => Promise<void>,
    reason?: "user" | "expired",
  ): Promise<
    { status: "cleanup_pending"; immediateCleanup: "succeeded" | "retry_scheduled" | "already_pending" }
    | { status: "already_cancelled" }
  >;
  cleanupExpiredReferenceUploads(
    cleanupBlobs: (storagePathPrefix: string, storagePath?: string) => Promise<void>,
    limit?: number,
  ): Promise<{
    scanned: number;
    cancelled: number;
    preserved: number;
    failed: Array<{ sessionId: string; error: string }>;
  }>;
  confirmReferenceUpload(scope: BrandScope & { actorUserId: string; sessionId: string }, upload: ConfirmedAssetLibraryUpload): Promise<ReferenceItem>;
  listReferenceBrands(scope: BrandScope): Promise<ReferenceBrand[]>;
  createReferenceBrand(scope: BrandScope & { actorUserId: string }, input: ReferenceBrandInput): Promise<ReferenceBrand>;
  createReferenceBrandFromTrend(scope: BrandScope & { actorUserId: string; mediaId: string }): Promise<ReferenceBrand>;
  listReferenceBrandItems(scope: BrandScope & { referenceBrandId: string }): Promise<ReferenceItem[]>;
}

function iso(value: unknown): string {
  return new Date(value as string).toISOString();
}
function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}
function image(row: Record<string, unknown>): AvatarImage {
  return {
    id: String(row.id), position: Number(row.position), representative: Boolean(row.is_representative),
    storagePath: String(row.storage_path), storageUrl: String(row.storage_url),
    mimeType: String(row.mime_type), sizeBytes: Number(row.size_bytes), checksum: String(row.checksum),
  };
}
function avatar(row: Record<string, unknown>): Avatar {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), brandId: String(row.brand_id),
    name: String(row.name), description: String(row.description), isDefault: Boolean(row.is_default),
    status: row.status as Avatar["status"], createdByUserId: String(row.created_by_user_id),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    images: json<Record<string, unknown>[]>(row.images, []).map(image),
  };
}
function reference(row: Record<string, unknown>): ReferenceItem {
  const kind = String(row.kind);
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), brandId: String(row.brand_id),
    kind, contentPurpose: String(row.content_purpose), origin: String(row.origin),
    title: String(row.title), previewUrl: row.preview_url ? String(row.preview_url) : null,
    sourceUrl: row.source_url ? String(row.source_url) : null, format: row.format ? String(row.format) : null,
    metadata: json(row.metadata, {}), favorite: Boolean(row.is_favorite),
    archivedAt: row.archived_at ? iso(row.archived_at) : null,
    referenceBrandId: row.reference_brand_id ? String(row.reference_brand_id) : null,
    sourcePlatform: row.source_platform === "instagram" || row.source_platform === "meta_ad_library"
      ? row.source_platform
      : kind === "trend" ? "instagram" : kind === "meta_ad" ? "meta_ad_library" : null,
    sourceState: row.source_state === "available" || row.source_state === "unavailable"
      ? row.source_state
      : null,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}
function referenceDetail(row: Record<string, unknown>): ReferenceDetail {
  return {
    ...reference(row),
    description: row.detail_description ? String(row.detail_description) : null,
    body: row.detail_body ? String(row.detail_body) : null,
    snapshot: row.snapshot_id
      ? {
        id: String(row.snapshot_id),
        fetchedAt: iso(row.snapshot_fetched_at),
        metadata: json(row.snapshot_metadata, {}),
      }
      : null,
  };
}
function refBrand(row: Record<string, unknown>): ReferenceBrand {
  const snapshot = json<Record<string, unknown>>(row.profile_snapshot, {});
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), brandId: String(row.brand_id),
    platform: String(row.platform), handle: String(row.handle), displayName: String(row.display_name),
    publicSourceUrl: String(row.public_source_url), profileSnapshot: snapshot,
    previewUrl: typeof snapshot.profileImageUrl === "string" && snapshot.profileImageUrl ? snapshot.profileImageUrl : null,
  };
}

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await action(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "23505"
      && "constraint" in error
      && error.constraint === "brand_avatar_images_avatar_checksum_unique"
    ) {
      throw new Error("avatar_image_duplicate");
    }
    throw error;
  } finally {
    client.release();
  }
}
async function requireMember(
  client: Pick<PoolClient, "query">,
  scope: BrandScope & { actorUserId: string },
  admin = false,
): Promise<void> {
  const result = await client.query(
    `select member.role from workspace_members member
      where member.workspace_id=$1 and member.user_id=$2 and member.status='active'
        and exists (select 1 from brands where id=$3 and workspace_id=$1 and deleted_at is null)`,
    [scope.workspaceId, scope.actorUserId, scope.brandId],
  );
  if (!result.rowCount) throw new Error("asset_library_access_forbidden");
  if (admin && !["owner", "admin"].includes(String(result.rows[0].role))) {
    throw new Error("asset_library_admin_required");
  }
}
const avatarSelect = `select avatar.*,
  coalesce(jsonb_agg(to_jsonb(image) order by image.position) filter(where image.id is not null),'[]'::jsonb) images
  from brand_avatars avatar left join brand_avatar_images image
    on image.avatar_id=avatar.id and image.workspace_id=avatar.workspace_id and image.brand_id=avatar.brand_id`;

export function createAssetLibraryRepository(pool: Pool): AssetLibraryRepository {
  async function getAvatar(scope: BrandScope & { avatarId: string }, client: Pick<Pool, "query"> = pool) {
    const result = await client.query(
      `${avatarSelect} where avatar.id=$1 and avatar.workspace_id=$2 and avatar.brand_id=$3 group by avatar.id`,
      [scope.avatarId, scope.workspaceId, scope.brandId],
    );
    return result.rowCount ? avatar(result.rows[0] as Record<string, unknown>) : null;
  }
  async function getReference(scope: BrandScope & { referenceId: string }, client: Pick<Pool, "query"> = pool) {
    const result = await client.query(
      "select * from reference_items where id=$1 and workspace_id=$2 and brand_id=$3",
      [scope.referenceId, scope.workspaceId, scope.brandId],
    );
    return result.rowCount ? reference(result.rows[0] as Record<string, unknown>) : null;
  }
  async function addImage(
    client: PoolClient,
    scope: BrandScope & { actorUserId: string; avatarId: string },
    value: AvatarImageInput,
  ): Promise<void> {
    const locked = await client.query(
      "select id from brand_avatars where id=$1 and workspace_id=$2 and brand_id=$3 and status='active' for update",
      [scope.avatarId, scope.workspaceId, scope.brandId],
    );
    if (!locked.rowCount) throw new Error("avatar_not_found");
    const duplicate = await client.query(
      `select id from brand_avatar_images
        where avatar_id=$1 and workspace_id=$2 and brand_id=$3 and checksum=$4
        limit 1`,
      [scope.avatarId, scope.workspaceId, scope.brandId, value.checksum],
    );
    if (duplicate.rowCount) throw new Error("avatar_image_duplicate");
    const available = await client.query(
      `select coalesce((
         select candidate from generate_series(1,5) candidate
          where not exists (
            select 1 from brand_avatar_images image
             where image.avatar_id=$1 and image.workspace_id=$2 and image.brand_id=$3
               and image.position=candidate
          )
          order by candidate limit 1
       ),6)::int position`,
      [scope.avatarId, scope.workspaceId, scope.brandId],
    );
    const position = Number(available.rows[0]?.position ?? 6);
    if (position > 5) throw new Error("avatar_image_limit_exceeded");
    if (value.representative || position === 1) {
      await client.query(
        "update brand_avatar_images set is_representative=false where avatar_id=$1 and workspace_id=$2 and brand_id=$3",
        [scope.avatarId, scope.workspaceId, scope.brandId],
      );
    }
    await client.query(
      `insert into brand_avatar_images (
        workspace_id,brand_id,avatar_id,position,is_representative,storage_url,storage_path,
        mime_type,size_bytes,checksum,created_by_user_id
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [scope.workspaceId, scope.brandId, scope.avatarId, position, value.representative || position === 1,
        value.storageUrl, value.storagePath, value.mimeType, value.sizeBytes, value.checksum, scope.actorUserId],
    );
  }
  async function consumeSession(
    client: PoolClient,
    scope: BrandScope & { actorUserId: string; sessionId: string },
  ): Promise<Record<string, unknown>> {
    const session = await client.query(
      `select * from reference_upload_sessions
        where id=$1 and workspace_id=$2 and brand_id=$3 for update`,
      [scope.sessionId, scope.workspaceId, scope.brandId],
    );
    if (!session.rowCount) throw new Error("asset_library_upload_session_not_found");
    if (String(session.rows[0].created_by_user_id) !== scope.actorUserId) {
      throw new Error("asset_library_upload_actor_mismatch");
    }
    if (session.rows[0].cancelled_at) throw new Error("asset_library_upload_cancelled");
    if (session.rows[0].confirmed_at) throw new Error("asset_library_upload_replayed");
    if (new Date(session.rows[0].expires_at).getTime() <= Date.now()) throw new Error("asset_library_upload_expired");
    return session.rows[0] as Record<string, unknown>;
  }
  async function createReferenceBrandInner(
    client: PoolClient,
    scope: BrandScope & { actorUserId: string },
    raw: ReferenceBrandInput,
    profile: Record<string, unknown> = {},
  ): Promise<ReferenceBrand> {
    const input = parseReferenceBrandInput(raw);
    const displayName = typeof profile.displayName === "string" && profile.displayName.trim()
      ? profile.displayName.trim() : input.handle;
    const inserted = await client.query(
      `insert into reference_brands(
        workspace_id,brand_id,platform,handle,display_name,public_source_url,profile_snapshot,created_by_user_id
      ) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
      on conflict do nothing returning *`,
      [scope.workspaceId, scope.brandId, input.platform, input.handle, displayName, input.publicSourceUrl,
        JSON.stringify(profile), scope.actorUserId],
    );
    if (!inserted.rowCount) throw new Error("reference_origin_duplicate");
    const row = inserted.rows[0];
    await client.query(
      `insert into reference_items(
        workspace_id,brand_id,kind,origin,title,preview_url,source_url,format,metadata,
        reference_brand_id,created_by_user_id
      ) values($1,$2,'saved_brand',$3,$4,$5,$6,'profile',$7::jsonb,$8,$9)`,
      [scope.workspaceId, scope.brandId, displayName, displayName,
        typeof profile.profileImageUrl === "string" ? profile.profileImageUrl : null,
        input.publicSourceUrl, JSON.stringify({ platform: input.platform, handle: input.handle }),
        row.id, scope.actorUserId],
    );
    return refBrand(row as Record<string, unknown>);
  }

  return {
    async listAvatars(scope, includeArchived = false) {
      const result = await pool.query(
        `${avatarSelect} where avatar.workspace_id=$1 and avatar.brand_id=$2
          ${includeArchived ? "" : "and avatar.status='active'"} group by avatar.id
          order by avatar.is_default desc,avatar.created_at desc`,
        [scope.workspaceId, scope.brandId],
      );
      return result.rows.map((row) => avatar(row as Record<string, unknown>));
    },
    getAvatar,
    async createAvatar(scope, raw) {
      const input = parseCreateAvatarInput(raw);
      return transaction(pool, async (client) => {
        await requireMember(client, scope);
        const sessions = await client.query(
          `select * from reference_upload_sessions
            where id=any($1::uuid[]) and workspace_id=$2 and brand_id=$3 for update`,
          [input.imageSessionIds, scope.workspaceId, scope.brandId],
        );
        if (Number(sessions.rowCount ?? 0) !== input.imageSessionIds.length) {
          throw new Error("asset_library_upload_session_not_found");
        }
        const expectedPrefixes = new Map<string, string>();
        for (const row of sessions.rows) {
          const id = String(row.id);
          if (String(row.created_by_user_id) !== scope.actorUserId) {
            throw new Error("asset_library_upload_actor_mismatch");
          }
          if (row.cancelled_at) throw new Error("asset_library_upload_cancelled");
          const prefix = `brands/${scope.brandId}/asset-library/avatars/${input.avatarId}/${id}/`;
          if (String(row.storage_path_prefix) !== prefix) throw new Error("asset_library_upload_path_mismatch");
          if (!row.confirmed_at) throw new Error("asset_library_upload_not_confirmed");
          if (new Date(row.expires_at).getTime() <= Date.now()) throw new Error("asset_library_upload_expired");
          expectedPrefixes.set(id, prefix);
        }
        const artifacts = await client.query(
          `select * from storage_artifacts
            where workspace_id=$1 and brand_id=$2 and deleted_at is null
              and path like any($3::text[]) for update`,
          [scope.workspaceId, scope.brandId, [...expectedPrefixes.values()].map((prefix) => `${prefix}%`)],
        );
        const bySession = new Map<string, Record<string, unknown>>();
        for (const rawArtifact of artifacts.rows) {
          const artifact = rawArtifact as Record<string, unknown>;
          const entry = [...expectedPrefixes.entries()].find(([, prefix]) => String(artifact.path).startsWith(prefix));
          if (entry) bySession.set(entry[0], artifact);
        }
        if (bySession.size !== input.imageSessionIds.length) {
          throw new Error("asset_library_upload_artifact_not_found");
        }
        for (const row of sessions.rows) {
          const artifact = bySession.get(String(row.id))!;
          if (String(artifact.created_by_user_id) !== scope.actorUserId) {
            throw new Error("asset_library_upload_actor_mismatch");
          }
          if (String(artifact.mime_type).toLowerCase() !== String(row.expected_mime_type).toLowerCase()) {
            throw new Error("asset_library_upload_mime_mismatch");
          }
          if (Number(artifact.byte_size) !== Number(row.expected_size_bytes)) {
            throw new Error("asset_library_upload_size_mismatch");
          }
          if (String(artifact.checksum) !== String(row.expected_checksum)) {
            throw new Error("asset_library_upload_checksum_mismatch");
          }
        }
        const canonicalChecksums = input.imageSessionIds.map(
          (sessionId) => String(bySession.get(sessionId)?.checksum).toLowerCase(),
        );
        if (new Set(canonicalChecksums).size !== canonicalChecksums.length) {
          throw new Error("avatar_image_duplicate");
        }
        const created = await client.query(
          `insert into brand_avatars(id,workspace_id,brand_id,name,description,created_by_user_id)
           values($1,$2,$3,$4,$5,$6) returning id`,
          [input.avatarId, scope.workspaceId, scope.brandId, input.name, input.description, scope.actorUserId],
        );
        const avatarId = String(created.rows[0].id);
        for (const [index, sessionId] of input.imageSessionIds.entries()) {
          const session = sessions.rows.find((row) => String(row.id) === sessionId);
          const artifact = bySession.get(sessionId)!;
          await client.query(
            `insert into brand_avatar_images(
              workspace_id,brand_id,avatar_id,position,is_representative,storage_url,storage_path,
              mime_type,size_bytes,checksum,created_by_user_id
            ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [scope.workspaceId, scope.brandId, avatarId, index + 1,
              sessionId === input.representativeSessionId, artifact.public_url, artifact.path,
              session.expected_mime_type, session.expected_size_bytes, session.expected_checksum, scope.actorUserId],
          );
        }
        await client.query(
          `delete from reference_upload_sessions
            where id = any($1::uuid[]) and workspace_id=$2 and brand_id=$3`,
          [input.imageSessionIds, scope.workspaceId, scope.brandId],
        );
        return (await getAvatar({ ...scope, avatarId }, client))!;
      });
    },
    async updateAvatar(scope, raw) {
      const input = parseAvatarInput(raw);
      return transaction(pool, async (client) => {
        await requireMember(client, scope);
        const result = await client.query(
          `update brand_avatars set name=$1,description=$2
            where id=$3 and workspace_id=$4 and brand_id=$5 and status='active' returning id`,
          [input.name, input.description, scope.avatarId, scope.workspaceId, scope.brandId],
        );
        if (!result.rowCount) throw new Error("avatar_not_found");
        return (await getAvatar(scope, client))!;
      });
    },
    async addAvatarImage(scope, value) {
      return transaction(pool, async (client) => {
        await requireMember(client, scope);
        await addImage(client, scope, value);
        return (await getAvatar(scope, client))!;
      });
    },
    async deleteAvatarImage(scope) {
      await transaction(pool, async (client) => {
        await requireMember(client, scope);
        const locked = await client.query(
          "select id from brand_avatars where id=$1 and workspace_id=$2 and brand_id=$3 and status='active' for update",
          [scope.avatarId, scope.workspaceId, scope.brandId],
        );
        if (!locked.rowCount) throw new Error("avatar_not_found");
        const rows = await client.query(
          `select id,is_representative from brand_avatar_images
            where avatar_id=$1 and workspace_id=$2 and brand_id=$3 order by position for update`,
          [scope.avatarId, scope.workspaceId, scope.brandId],
        );
        if (Number(rows.rowCount ?? 0) <= 1) throw new Error("avatar_image_minimum_required");
        const selected = rows.rows.find((row) => String(row.id) === scope.imageId);
        if (!selected) throw new Error("avatar_image_not_found");
        await client.query(
          "delete from brand_avatar_images where id=$1 and workspace_id=$2 and brand_id=$3 and avatar_id=$4",
          [scope.imageId, scope.workspaceId, scope.brandId, scope.avatarId],
        );
        if (selected.is_representative) {
          const next = rows.rows.find((row) => String(row.id) !== scope.imageId)!;
          await client.query(
            "update brand_avatar_images set is_representative=true where id=$1 and workspace_id=$2 and brand_id=$3",
            [next.id, scope.workspaceId, scope.brandId],
          );
        }
      });
    },
    async setDefaultAvatar(scope) {
      return transaction(pool, async (client) => {
        await requireMember(client, scope, true);
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`avatar-default:${scope.workspaceId}:${scope.brandId}`]);
        await client.query(
          "update brand_avatars set is_default=false where workspace_id=$1 and brand_id=$2 and status='active' and is_default",
          [scope.workspaceId, scope.brandId],
        );
        const result = await client.query(
          `update brand_avatars set is_default=true
            where id=$1 and workspace_id=$2 and brand_id=$3 and status='active' returning *`,
          [scope.avatarId, scope.workspaceId, scope.brandId],
        );
        if (!result.rowCount) throw new Error("avatar_not_found");
        return avatar({ ...result.rows[0], images: [] } as Record<string, unknown>);
      });
    },
    async archiveAvatar(scope) {
      await transaction(pool, async (client) => {
        await requireMember(client, scope, true);
        const result = await client.query(
          `update brand_avatars set status='archived',is_default=false
            where id=$1 and workspace_id=$2 and brand_id=$3 and status='active'`,
          [scope.avatarId, scope.workspaceId, scope.brandId],
        );
        if (!result.rowCount) throw new Error("avatar_not_found");
      });
    },
    async summarizeAvatars(scope) {
      const result = await pool.query(
        `select count(*)::int active,
          (array_agg(id) filter(where is_default))[1] default_avatar_id
          from brand_avatars where workspace_id=$1 and brand_id=$2 and status='active'`,
        [scope.workspaceId, scope.brandId],
      );
      return {
        active: Number(result.rows[0]?.active ?? 0),
        defaultAvatarId: result.rows[0]?.default_avatar_id ? String(result.rows[0].default_avatar_id) : null,
      };
    },
    async listReferences(scope, filters) {
      const values: unknown[] = [scope.workspaceId, scope.brandId];
      const where = ["item.workspace_id=$1", "item.brand_id=$2", "item.archived_at is null"];
      const add = (sql: string, value: unknown) => { values.push(value); where.push(sql.replace("?", `$${values.length}`)); };
      const collectionKinds = {
        all: ["saved_content", "trend", "meta_ad", "external_url", "upload", "owned_performance"],
        content: ["saved_content", "external_url", "upload", "owned_performance"],
        trend: ["trend", "meta_ad"],
      } as const;
      if (filters.collection) add("item.kind = any(?::text[])", [...collectionKinds[filters.collection]]);
      if (filters.kind) add("item.kind=?", filters.kind);
      if (filters.contentFamily) add("item.metadata->>'contentFamily'=?", filters.contentFamily);
      if (filters.strategy) add("item.metadata->>'strategy'=?", filters.strategy);
      if (filters.format) add("lower(item.format)=lower(?)", filters.format);
      if (filters.origin) add("item.origin ilike '%' || ? || '%'", filters.origin);
      if (filters.favorite !== undefined) add("item.is_favorite=?", filters.favorite);
      if (filters.recent) add("item.created_at >= now() - (?::int * interval '1 day')", filters.recent);
      if (filters.q) {
        values.push(filters.q);
        const parameter = `$${values.length}`;
        where.push(`(
          item.title ilike '%' || ${parameter} || '%'
          or item.origin ilike '%' || ${parameter} || '%'
          or item.metadata->>'description' ilike '%' || ${parameter} || '%'
          or item.metadata->>'pageName' ilike '%' || ${parameter} || '%'
          or item.metadata->>'creativeBody' ilike '%' || ${parameter} || '%'
          or latest_snapshot.extracted_text ilike '%' || ${parameter} || '%'
          or author.handle ilike '%' || ${parameter} || '%'
          or author.display_name ilike '%' || ${parameter} || '%'
        )`);
      }
      const result = await pool.query(
        `select
          item.id,item.workspace_id,item.brand_id,item.kind,item.content_purpose,item.origin,
          coalesce(nullif(latest_snapshot.extracted_title,''),item.title) title,
          coalesce(
            nullif(latest_snapshot.metadata->>'ogImage',''),
            nullif(latest_snapshot.metadata->>'image',''),
            item.preview_url
          ) preview_url,
          item.source_url,item.format,item.is_favorite,item.archived_at,item.reference_brand_id,
          case when item.kind='trend' then 'instagram'
            when item.kind='meta_ad' then 'meta_ad_library' end source_platform,
          case when item.kind='meta_ad' then
            case when meta_ad.active_status='ACTIVE' then 'available' else 'unavailable' end
          end source_state,
          item.created_at,item.updated_at,
          jsonb_strip_nulls(jsonb_build_object(
            'patternAvailable',exists(
              select 1 from reference_patterns pattern
              where pattern.reference_item_id=item.id
                and pattern.workspace_id=item.workspace_id
                and pattern.brand_id=item.brand_id
            ),
            'fileName',case when item.kind='upload' then item.metadata->>'fileName' end,
            'mimeType',case when item.kind='upload' then artifact.mime_type end,
            'sizeBytes',case when item.kind='upload' then artifact.byte_size end
            ,'pageName',case when item.kind='meta_ad' then item.metadata->>'pageName' end
            ,'creativeBody',case when item.kind='meta_ad' then item.metadata->>'creativeBody' end
          )) metadata
          from reference_items item
          left join storage_artifacts artifact
            on artifact.id=item.storage_artifact_id
           and artifact.workspace_id=item.workspace_id
           and artifact.brand_id=item.brand_id
          left join reference_brands author
            on author.id=item.reference_brand_id
           and author.workspace_id=item.workspace_id
           and author.brand_id=item.brand_id
          left join brand_meta_ad_saved saved_meta_ad
            on saved_meta_ad.id=item.saved_meta_ad_id
           and saved_meta_ad.workspace_id=item.workspace_id
           and saved_meta_ad.brand_id=item.brand_id
          left join meta_ad_library_ads meta_ad on meta_ad.id=saved_meta_ad.meta_ad_id
          left join lateral (
            select snapshot.extracted_title,snapshot.extracted_text,snapshot.metadata
            from source_snapshots snapshot
            where snapshot.source_url_id=item.source_url_id
              and snapshot.workspace_id=item.workspace_id
              and snapshot.brand_id=item.brand_id
              and snapshot.status='succeeded'
            order by snapshot.fetched_at desc,snapshot.id desc
            limit 1
          ) latest_snapshot on item.source_url_id is not null
          where ${where.join(" and ")}
          order by item.created_at desc,item.id desc`,
        values,
      );
      return result.rows.map((row) => reference(row as Record<string, unknown>));
    },
    async getReference(scope) {
      const result = await pool.query(
        `select
          item.id,item.workspace_id,item.brand_id,item.kind,item.content_purpose,item.origin,
          coalesce(nullif(latest_snapshot.extracted_title,''),item.title) title,
          coalesce(
            nullif(latest_snapshot.metadata->>'ogImage',''),
            nullif(latest_snapshot.metadata->>'image',''),
            item.preview_url
          ) preview_url,
          item.source_url,item.format,item.metadata,item.is_favorite,item.archived_at,
          case when item.kind='trend' then 'instagram'
            when item.kind='meta_ad' then 'meta_ad_library' end source_platform,
          case when item.kind='meta_ad' then
            case when meta_ad.active_status='ACTIVE' then 'available' else 'unavailable' end
          end source_state,
          item.reference_brand_id,item.created_at,item.updated_at,
          coalesce(
            nullif(latest_snapshot.summary,''),
            nullif(latest_snapshot.extracted_text,''),
            nullif(item.metadata->>'creativeBody',''),
            nullif(item.metadata->>'description',''),
            nullif(source.meta_description,'')
          ) detail_description,
          coalesce(
            nullif(latest_snapshot.extracted_text,''),
            nullif(item.metadata->>'creativeBody',''),
            nullif(item.metadata->>'caption',''),
            nullif(item.metadata->>'body',''),
            nullif(item.metadata->>'description','')
          ) detail_body,
          latest_snapshot.id snapshot_id,
          latest_snapshot.fetched_at snapshot_fetched_at,
          latest_snapshot.metadata snapshot_metadata
          from reference_items item
          left join source_urls source
            on source.id=item.source_url_id
           and source.workspace_id=item.workspace_id
           and source.brand_id=item.brand_id
          left join brand_meta_ad_saved saved_meta_ad
            on saved_meta_ad.id=item.saved_meta_ad_id
           and saved_meta_ad.workspace_id=item.workspace_id
           and saved_meta_ad.brand_id=item.brand_id
          left join meta_ad_library_ads meta_ad on meta_ad.id=saved_meta_ad.meta_ad_id
          left join lateral (
            select snapshot.id,snapshot.fetched_at,snapshot.extracted_title,
              snapshot.extracted_text,snapshot.summary,snapshot.metadata
            from source_snapshots snapshot
            where snapshot.source_url_id=item.source_url_id
              and snapshot.workspace_id=item.workspace_id
              and snapshot.brand_id=item.brand_id
              and snapshot.status='succeeded'
            order by snapshot.fetched_at desc,snapshot.id desc
            limit 1
          ) latest_snapshot on item.source_url_id is not null
          where item.id=$1 and item.workspace_id=$2 and item.brand_id=$3
            and item.archived_at is null`,
        [scope.referenceId, scope.workspaceId, scope.brandId],
      );
      return result.rowCount
        ? referenceDetail(result.rows[0] as Record<string, unknown>)
        : null;
    },
    async addReferenceUrl(scope, raw) {
      const input = parseReferenceUrlInput(raw);
      const normalized = normalizeSourceUrl(input.url);
      const hash = hashSourceUrl(normalized);
      return transaction(pool, async (client) => {
        await requireMember(client, scope);
        const brand = await client.query(
          "select id from brands where id=$1 and workspace_id=$2 and deleted_at is null for update",
          [scope.brandId, scope.workspaceId],
        );
        if (!brand.rowCount) throw new Error("brand_not_found");
        const count = await client.query(
          `select count(*)::int count from source_urls where workspace_id=$1 and brand_id=$2
            and source_type='reference' and enabled and deleted_at is null and status<>'disabled'`,
          [scope.workspaceId, scope.brandId],
        );
        if (Number(count.rows[0]?.count ?? 0) >= 10) throw new Error("source_reference_limit_exceeded");
        let source = await client.query(
          `select id from source_urls where url_hash=$1 and workspace_id=$2 and brand_id=$3
            and source_type='reference' and deleted_at is null for update`,
          [hash, scope.workspaceId, scope.brandId],
        );
        if (source.rowCount) {
          const duplicate = await client.query(
            `select * from reference_items
              where source_url_id=$1 and workspace_id=$2 and brand_id=$3 for update`,
            [source.rows[0].id, scope.workspaceId, scope.brandId],
          );
          await client.query(
            `update source_urls set enabled=true,status='active',disabled_at=null,content_purpose=$1,
              url=$2,domain=$3,title=$4
              where id=$5 and workspace_id=$6 and brand_id=$7`,
            [input.contentPurpose, normalized, normalizeSourceDomain(normalized), input.title || normalized,
              source.rows[0].id, scope.workspaceId, scope.brandId],
          );
          if (duplicate.rowCount) {
            if (!duplicate.rows[0].archived_at) throw new Error("reference_origin_duplicate");
            const restored = await client.query(
              `update reference_items set archived_at=null,content_purpose=$1,origin=$2,title=$3,
                source_url=$4,format='url',
                metadata=metadata || $5::jsonb || jsonb_build_object('restoredByUserId',$6::text)
                where id=$7 and workspace_id=$8 and brand_id=$9 returning *`,
              [input.contentPurpose, normalizeSourceDomain(normalized), input.title || normalized, normalized,
                JSON.stringify({ domain: normalizeSourceDomain(normalized) }), scope.actorUserId,
                duplicate.rows[0].id, scope.workspaceId, scope.brandId],
            );
            return reference(restored.rows[0] as Record<string, unknown>);
          }
        } else {
          source = await client.query(
            `insert into source_urls(
              workspace_id,brand_id,source_type,url,url_hash,domain,title,status,enabled,content_purpose
            ) values($1,$2,'reference',$3,$4,$5,$6,'active',true,$7) returning id`,
            [scope.workspaceId, scope.brandId, normalized, hash, normalizeSourceDomain(normalized),
              input.title || normalized, input.contentPurpose],
          );
        }
        const inserted = await client.query(
          `insert into reference_items(
            workspace_id,brand_id,kind,content_purpose,origin,title,source_url,format,metadata,
            source_url_id,created_by_user_id
          ) values($1,$2,'external_url',$3,$4,$5,$6,'url',$7::jsonb,$8,$9) returning *`,
          [scope.workspaceId, scope.brandId, input.contentPurpose, normalizeSourceDomain(normalized),
            input.title || normalized, normalized, JSON.stringify({ domain: normalizeSourceDomain(normalized) }),
            source.rows[0].id, scope.actorUserId],
        );
        return reference(inserted.rows[0] as Record<string, unknown>);
      });
    },
    async setReferenceFavorite(scope, favorite) {
      return transaction(pool, async (client) => {
        await requireMember(client, scope);
        const result = await client.query(
          `update reference_items set is_favorite=$1,
            metadata=metadata || jsonb_build_object('editedByUserId',$2::text)
            where id=$3 and workspace_id=$4 and brand_id=$5 and archived_at is null returning *`,
          [favorite, scope.actorUserId, scope.referenceId, scope.workspaceId, scope.brandId],
        );
        if (!result.rowCount) throw new Error("reference_not_found");
        return reference(result.rows[0] as Record<string, unknown>);
      });
    },
    async archiveReference(scope) {
      await transaction(pool, async (client) => {
        await requireMember(client, scope, true);
        const profile = await client.query(
          `select id from brand_profiles
            where workspace_id=$1 and brand_id=$2
            for update`,
          [scope.workspaceId, scope.brandId],
        );
        if (!profile.rowCount) throw new Error("brand_not_found");
        const candidate = await client.query(
          `select id,kind,source_url_id,saved_trend_id from reference_items
            where id=$1 and workspace_id=$2 and brand_id=$3 and archived_at is null`,
          [scope.referenceId, scope.workspaceId, scope.brandId],
        );
        if (!candidate.rowCount) throw new Error("reference_not_found");
        const activeStyle = await client.query(
          `select 1
             from brand_profiles profile
             join brand_rule_sets rules
               on rules.id=profile.active_brand_rule_set_id
              and rules.workspace_id=profile.workspace_id and rules.brand_id=profile.brand_id
              and rules.status='approved'
             cross join lateral jsonb_array_elements(
               coalesce(rules.rules_json #> '{designRules,referenceImages}','[]'::jsonb)
             ) style(image)
            where profile.workspace_id=$1 and profile.brand_id=$2
              and style.image->>'referenceItemId'=$3
            limit 1`,
          [scope.workspaceId, scope.brandId, scope.referenceId],
        );
        if (activeStyle.rowCount) throw new Error("brand_style_reference_in_use");
        const savedTrendId = candidate.rows[0].saved_trend_id;
        if (savedTrendId) {
          const savedIdentity = await client.query(
            `select id,source_url_id from brand_trend_saved_media
              where id=$1 and workspace_id=$2 and brand_id=$3`,
            [savedTrendId, scope.workspaceId, scope.brandId],
          );
          if (!savedIdentity.rowCount || !savedIdentity.rows[0].source_url_id) {
            throw new Error("reference_not_found");
          }
          const sourceUrlId = savedIdentity.rows[0].source_url_id;
          const source = await client.query(
            `select id from source_urls
              where id=$1 and workspace_id=$2 and brand_id=$3
                and source_type='reference' and deleted_at is null
              for update`,
            [sourceUrlId, scope.workspaceId, scope.brandId],
          );
          if (!source.rowCount) throw new Error("reference_not_found");
          const saved = await client.query(
            `select id from brand_trend_saved_media
              where id=$1 and workspace_id=$2 and brand_id=$3 and source_url_id=$4
              for update`,
            [savedTrendId, scope.workspaceId, scope.brandId, sourceUrlId],
          );
          if (!saved.rowCount) throw new Error("reference_not_found");
          const locked = await client.query(
            `select id,kind,source_url_id,saved_trend_id from reference_items
              where id=$1 and workspace_id=$2 and brand_id=$3
                and saved_trend_id=$4 and archived_at is null
              for update`,
            [scope.referenceId, scope.workspaceId, scope.brandId, savedTrendId],
          );
          if (!locked.rowCount) throw new Error("reference_not_found");
          const archived = await client.query(
            "select archive_brand_trend_saved_reference($1,$2) as reference_item_id",
            [savedTrendId, scope.actorUserId],
          );
          if (String(archived.rows[0]?.reference_item_id ?? "") !== scope.referenceId) {
            throw new Error("reference_not_found");
          }
          const removed = await client.query(
            `delete from brand_trend_saved_media
              where id=$1 and workspace_id=$2 and brand_id=$3
              returning id`,
            [savedTrendId, scope.workspaceId, scope.brandId],
          );
          if (!removed.rowCount) throw new Error("reference_not_found");
          return;
        }
        const sourceUrlId = candidate.rows[0].source_url_id;
        if (sourceUrlId) {
          const source = await client.query(
            `select id from source_urls
              where id=$1 and workspace_id=$2 and brand_id=$3
                and source_type='reference' and deleted_at is null
              for update`,
            [sourceUrlId, scope.workspaceId, scope.brandId],
          );
          if (!source.rowCount) throw new Error("reference_not_found");
        }
        const locked = await client.query(
          `select id,kind,source_url_id,saved_trend_id from reference_items
            where id=$1 and workspace_id=$2 and brand_id=$3 and archived_at is null
            for update`,
          [scope.referenceId, scope.workspaceId, scope.brandId],
        );
        if (!locked.rowCount || locked.rows[0].saved_trend_id
          || String(locked.rows[0].source_url_id ?? "") !== String(sourceUrlId ?? "")) {
          throw new Error("reference_not_found");
        }
        const item = locked.rows[0];
        const result = await client.query(
          `update reference_items set archived_at=now(),
            metadata=metadata || jsonb_build_object('archivedByUserId',$1::text)
            where id=$2 and workspace_id=$3 and brand_id=$4 and archived_at is null`,
          [scope.actorUserId, scope.referenceId, scope.workspaceId, scope.brandId],
        );
        if (!result.rowCount) throw new Error("reference_not_found");
        if (item.source_url_id && ["external_url", "saved_content"].includes(String(item.kind))) {
          await client.query(
            `update source_urls set enabled=false,status='disabled',disabled_at=coalesce(disabled_at,now())
              where id=$1 and workspace_id=$2 and brand_id=$3 and source_type='reference'
                and deleted_at is null`,
            [item.source_url_id, scope.workspaceId, scope.brandId],
          );
        }
      });
    },
    async getReferencePattern(scope) {
      const result = await pool.query(
        `select observations,interpretation,application_ideas,do_not_copy,confidence,analysis_version,updated_at
          from reference_patterns where reference_item_id=$1 and workspace_id=$2 and brand_id=$3
          order by updated_at desc limit 1`,
        [scope.referenceId, scope.workspaceId, scope.brandId],
      );
      if (!result.rowCount) return null;
      const row = result.rows[0];
      return {
        observations: json(row.observations, []), interpretation: row.interpretation,
        applicationIdeas: json(row.application_ideas, []), doNotCopy: json(row.do_not_copy, []),
        confidence: Number(row.confidence), analysisVersion: row.analysis_version, updatedAt: iso(row.updated_at),
      };
    },
    async createUploadSession(scope, kind, upload, avatarId) {
      return transaction(pool, async (client) => {
        await requireMember(client, scope);
        if (kind === "avatar" && !avatarId) throw new Error("asset_library_upload_scope_invalid");
        const id = randomUUID();
        const nonce = randomBytes(24).toString("hex");
        const part = kind === "avatar" ? "avatars" : "references";
        const target = kind === "avatar" ? `${avatarId}/${id}` : id;
        const storagePathPrefix = `brands/${scope.brandId}/asset-library/${part}/${target}/`;
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await client.query(
          `insert into reference_upload_sessions(
            id,nonce,workspace_id,brand_id,storage_path_prefix,expected_mime_type,
            expected_size_bytes,expected_checksum,expires_at,created_by_user_id,file_name,storage_path
          ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [id, nonce, scope.workspaceId, scope.brandId, storagePathPrefix, upload.mimeType,
            upload.sizeBytes, upload.checksum, expiresAt, scope.actorUserId, upload.fileName,
            `${storagePathPrefix}${upload.checksum}-${upload.fileName.replace(/ +/g, "-")}`],
        );
        return {
          id, nonce, workspaceId: scope.workspaceId, brandId: scope.brandId, kind,
          avatarId: kind === "avatar" ? avatarId! : null,
          fileName: upload.fileName, storagePathPrefix, expectedMimeType: upload.mimeType,
          expectedSizeBytes: upload.sizeBytes, expectedChecksum: upload.checksum,
          expiresAt: expiresAt.toISOString(), confirmedAt: null,
        };
      });
    },
    async getUploadSession(scope, fileName) {
      const result = await pool.query(
        `select * from reference_upload_sessions
          where id=$1 and workspace_id=$2 and brand_id=$3 and cancelled_at is null`,
        [scope.sessionId, scope.workspaceId, scope.brandId],
      );
      if (!result.rowCount) return null;
      const row = result.rows[0];
      return {
        id: String(row.id), nonce: String(row.nonce), workspaceId: String(row.workspace_id),
        brandId: String(row.brand_id), kind: String(row.storage_path_prefix).includes("/avatars/") ? "avatar" : "reference",
        avatarId: String(row.storage_path_prefix).includes("/avatars/")
          ? String(row.storage_path_prefix).split("/avatars/")[1]?.split("/")[0] ?? null
          : null,
        fileName: row.file_name ? String(row.file_name) : fileName, storagePathPrefix: String(row.storage_path_prefix),
        expectedMimeType: String(row.expected_mime_type), expectedSizeBytes: Number(row.expected_size_bytes),
        expectedChecksum: String(row.expected_checksum), expiresAt: iso(row.expires_at),
        confirmedAt: row.confirmed_at ? iso(row.confirmed_at) : null,
      };
    },
    async confirmAvatarUpload(scope, upload) {
      return transaction(pool, async (client) => {
        await requireMember(client, scope);
        const session = await consumeSession(client, scope);
        const expectedPrefix = `brands/${scope.brandId}/asset-library/avatars/${scope.avatarId}/${scope.sessionId}/`;
        if (String(session.storage_path_prefix) !== expectedPrefix || !upload.storagePath.startsWith(expectedPrefix)) {
          throw new Error("asset_library_upload_path_mismatch");
        }
        await client.query(
          `insert into storage_artifacts(
            workspace_id,brand_id,artifact_type,bucket,path,public_url,mime_type,byte_size,checksum,created_by_user_id
          ) values($1,$2,'brand_asset','vercel-blob',$3,$4,$5,$6,$7,$8)`,
          [scope.workspaceId, scope.brandId, upload.storagePath, upload.storageUrl, upload.mimeType,
            upload.sizeBytes, upload.checksum, scope.actorUserId],
        );
        const existing = await client.query(
          "select id from brand_avatars where id=$1 and workspace_id=$2 and brand_id=$3 and status='active' for update",
          [scope.avatarId, scope.workspaceId, scope.brandId],
        );
        if (!existing.rowCount) {
          await client.query(
            `update reference_upload_sessions set confirmed_at=now()
              where id=$1 and workspace_id=$2 and brand_id=$3 and confirmed_at is null`,
            [scope.sessionId, scope.workspaceId, scope.brandId],
          );
          return { status: "staged", avatarId: scope.avatarId, sessionId: scope.sessionId };
        }
        await addImage(client, scope, upload);
        await client.query(
          "delete from reference_upload_sessions where id=$1 and workspace_id=$2 and brand_id=$3",
          [scope.sessionId, scope.workspaceId, scope.brandId],
        );
        return { status: "attached", avatar: (await getAvatar(scope, client))! };
      });
    },
    async cancelAvatarUpload(scope, cleanupBlobs, reason = "user") {
      const pending = await transaction(pool, async (client) => {
        if (reason === "user") await requireMember(client, scope);
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1,0))",
          [scope.sessionId],
        );
        const receipt = await client.query(
          `select * from avatar_upload_cancellation_receipts
            where session_id=$1 for update`,
          [scope.sessionId],
        );
        if (receipt.rowCount) {
          const row = receipt.rows[0];
          if (String(row.workspace_id) !== scope.workspaceId || String(row.brand_id) !== scope.brandId
            || String(row.avatar_id) !== scope.avatarId || String(row.created_by_user_id) !== scope.actorUserId) {
            throw new Error("asset_library_upload_session_not_found");
          }
          return row.status === "completed"
            ? { status: "already_cancelled" as const }
            : { status: "cleanup_pending" as const, immediateCleanup: "already_pending" as const };
        }
        const session = await client.query(
          `select * from reference_upload_sessions
            where id=$1 and workspace_id=$2 and brand_id=$3 for update`,
          [scope.sessionId, scope.workspaceId, scope.brandId],
        );
        if (!session.rowCount) throw new Error("asset_library_upload_session_not_found");
        const row = session.rows[0];
        if (String(row.created_by_user_id) !== scope.actorUserId) {
          throw new Error("asset_library_upload_actor_mismatch");
        }
        const expectedPrefix = `brands/${scope.brandId}/asset-library/avatars/${scope.avatarId}/${scope.sessionId}/`;
        if (String(row.storage_path_prefix) !== expectedPrefix) {
          throw new Error("asset_library_upload_session_not_found");
        }
        const artifact = await client.query(
          `select id,path from storage_artifacts
            where workspace_id=$1 and brand_id=$2 and deleted_at is null and path like $3
            for update`,
          [scope.workspaceId, scope.brandId, `${expectedPrefix}%`],
        );
        const storagePath = artifact.rowCount
          ? String(artifact.rows[0].path)
          : String(row.storage_path ?? "");
        if (storagePath && !storagePath.startsWith(expectedPrefix)) {
          throw new Error("asset_library_upload_path_mismatch");
        }
        await client.query(
          `update reference_upload_sessions set cancelled_at=now()
            where id=$1 and workspace_id=$2 and brand_id=$3 and cancelled_at is null`,
          [scope.sessionId, scope.workspaceId, scope.brandId],
        );
        await client.query(
          `insert into avatar_upload_cancellation_receipts(
            session_id,workspace_id,brand_id,avatar_id,created_by_user_id,storage_path,
            storage_path_prefix,token_expires_at,status,next_attempt_at,reason
          ) values($1,$2,$3,$4,$5,$6,$7,$8,'pending',$8 + interval '1 minute',$9)`,
          [scope.sessionId, scope.workspaceId, scope.brandId, scope.avatarId,
            scope.actorUserId, storagePath || null, expectedPrefix, row.expires_at, reason],
        );
        return {
          status: "cleanup_pending" as const,
          immediateCleanup: "succeeded" as const,
          storagePathPrefix: expectedPrefix,
          storagePath: storagePath || undefined,
        };
      });
      if (pending.status === "already_cancelled" || pending.immediateCleanup === "already_pending") {
        return pending;
      }
      try {
        await cleanupBlobs(pending.storagePathPrefix, pending.storagePath);
        return { status: "cleanup_pending", immediateCleanup: "succeeded" };
      } catch (error) {
        await pool.query(
          `update avatar_upload_cancellation_receipts
            set last_error=$2
            where session_id=$1 and status='pending'`,
          [scope.sessionId, error instanceof Error ? error.message : "unknown"],
        );
        return { status: "cleanup_pending", immediateCleanup: "retry_scheduled" };
      }
    },
    async cleanupExpiredAvatarUploads(cleanupBlobs, limit = 100) {
      const candidates = await pool.query(
        `select * from (
          select coalesce(session.id,receipt.session_id) id,
            coalesce(session.workspace_id,receipt.workspace_id) workspace_id,
            coalesce(session.brand_id,receipt.brand_id) brand_id,
            coalesce(session.created_by_user_id,receipt.created_by_user_id) created_by_user_id,
            coalesce(session.storage_path_prefix,receipt.storage_path_prefix) storage_path_prefix,
            coalesce(session.storage_path,receipt.storage_path) storage_path,
            receipt.token_expires_at expires_at,
            receipt.status receipt_status,receipt.avatar_id
          from avatar_upload_cancellation_receipts receipt
          left join reference_upload_sessions session
            on session.id=receipt.session_id
          where receipt.status='pending' and receipt.token_expires_at <= now()
            and receipt.next_attempt_at <= now()
          union all
          select session.id,session.workspace_id,session.brand_id,session.created_by_user_id,
            session.storage_path_prefix,session.storage_path,session.expires_at,
            null::text receipt_status,
            split_part(split_part(session.storage_path_prefix,'/avatars/',2),'/',1)::uuid avatar_id
          from reference_upload_sessions session
          left join avatar_upload_cancellation_receipts receipt on receipt.session_id=session.id
          where receipt.session_id is null and session.expires_at <= now()
            and session.storage_path_prefix like '%/asset-library/avatars/%'
        ) candidate order by expires_at,id limit $1`,
        [Math.max(1, Math.min(limit, 500))],
      );
      const failed: Array<{ sessionId: string; error: string }> = [];
      let cancelled = 0;
      for (const row of candidates.rows) {
        const sessionId = String(row.id);
        const avatarId = String(row.avatar_id);
        let cleanupRow = row;
        let prefix = String(row.storage_path_prefix);
        let expectedPrefix = `brands/${row.brand_id}/asset-library/avatars/${avatarId}/${sessionId}/`;
        try {
          if (prefix !== expectedPrefix) throw new Error("asset_library_upload_path_mismatch");
          if (!row.receipt_status) {
            const acquired = await transaction(pool, async (client) => {
              // Explicit cancellation takes these locks in the same order. Avatar creation only
              // takes the session lock and never waits on the advisory lock, avoiding a cycle.
              await client.query(
                "select pg_advisory_xact_lock(hashtextextended($1,0))",
                [sessionId],
              );
              const receipt = await client.query(
                `select session_id from avatar_upload_cancellation_receipts
                  where session_id=$1 for update`,
                [sessionId],
              );
              if (receipt.rowCount) return null;
              const session = await client.query(
                `select * from reference_upload_sessions
                  where id=$1 and workspace_id=$2 and brand_id=$3 for update`,
                [sessionId, row.workspace_id, row.brand_id],
              );
              // A creator that locked this session before expiry may consume it while this
              // transaction waits. A disappeared row means creation won and is a no-op.
              if (Number(session.rowCount ?? 0) !== 1) return null;
              const fresh = session.rows[0];
              if (fresh.cancelled_at || new Date(fresh.expires_at).getTime() > Date.now()) return null;
              const freshPrefix = String(fresh.storage_path_prefix);
              const freshExpectedPrefix =
                `brands/${fresh.brand_id}/asset-library/avatars/${avatarId}/${sessionId}/`;
              if (freshPrefix !== freshExpectedPrefix) {
                throw new Error("asset_library_upload_path_mismatch");
              }
              const transitioned = await client.query(
                `update reference_upload_sessions set cancelled_at=now()
                  where id=$1 and workspace_id=$2 and brand_id=$3
                    and cancelled_at is null and expires_at <= now()
                  returning *`,
                [sessionId, fresh.workspace_id, fresh.brand_id],
              );
              if (Number(transitioned.rowCount ?? 0) !== 1) return null;
              const cancelledSession = transitioned.rows[0] ?? fresh;
              const inserted = await client.query(
                `insert into avatar_upload_cancellation_receipts(
                  session_id,workspace_id,brand_id,avatar_id,created_by_user_id,storage_path,
                  storage_path_prefix,token_expires_at,status,next_attempt_at,reason
                ) values($1,$2,$3,$4,$5,$6,$7,$8,'pending',now(),'expired')
                on conflict(session_id) do nothing returning session_id`,
                [sessionId, cancelledSession.workspace_id, cancelledSession.brand_id, avatarId,
                  cancelledSession.created_by_user_id, cancelledSession.storage_path ?? null,
                  freshPrefix, cancelledSession.expires_at],
              );
              if (Number(inserted.rowCount ?? 0) !== 1) return null;
              return {
                ...row,
                workspace_id: cancelledSession.workspace_id,
                brand_id: cancelledSession.brand_id,
                created_by_user_id: cancelledSession.created_by_user_id,
                storage_path_prefix: freshPrefix,
                storage_path: cancelledSession.storage_path ?? null,
                expires_at: cancelledSession.expires_at,
              };
            });
            if (!acquired) continue;
            cleanupRow = acquired;
            prefix = String(acquired.storage_path_prefix);
            expectedPrefix =
              `brands/${acquired.brand_id}/asset-library/avatars/${avatarId}/${sessionId}/`;
            if (prefix !== expectedPrefix) throw new Error("asset_library_upload_path_mismatch");
          }
          await cleanupBlobs(prefix, cleanupRow.storage_path ? String(cleanupRow.storage_path) : undefined);
          await transaction(pool, async (client) => {
            await client.query(
              `delete from storage_artifacts
                where workspace_id=$1 and brand_id=$2 and path like $3 and deleted_at is null`,
              [cleanupRow.workspace_id, cleanupRow.brand_id, `${prefix}%`],
            );
            await client.query(
              `delete from reference_upload_sessions
                where id=$1 and workspace_id=$2 and brand_id=$3`,
              [sessionId, cleanupRow.workspace_id, cleanupRow.brand_id],
            );
            await client.query(
              `update avatar_upload_cancellation_receipts
                set status='completed',completed_at=now(),last_error=null
                where session_id=$1 and status='pending'`,
              [sessionId],
            );
          });
          cancelled += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown";
          await pool.query(
            `update avatar_upload_cancellation_receipts
              set attempt_count=attempt_count+1,last_error=$2,
                next_attempt_at=now() + make_interval(secs =>
                  least(3600,30 * power(2,least(attempt_count,7)))::integer)
              where session_id=$1 and status='pending'`,
            [sessionId, message],
          );
          failed.push({ sessionId, error: message });
        }
      }
      return { scanned: candidates.rows.length, cancelled, failed };
    },
    async cancelReferenceUpload(scope, cleanupBlobs, reason = "user") {
      const pending = await transaction(pool, async (client) => {
        if (reason === "user") await requireMember(client, scope);
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1,0))",
          [scope.sessionId],
        );
        const receipt = await client.query(
          `select * from reference_upload_cancellation_receipts
            where session_id=$1 for update`,
          [scope.sessionId],
        );
        if (receipt.rowCount) {
          const row = receipt.rows[0];
          if (String(row.workspace_id) !== scope.workspaceId || String(row.brand_id) !== scope.brandId
            || String(row.created_by_user_id) !== scope.actorUserId) {
            throw new Error("asset_library_upload_session_not_found");
          }
          return row.status === "completed"
            ? { terminal: true as const }
            : { existing: true as const };
        }
        const session = await client.query(
          `select * from reference_upload_sessions
            where id=$1 and workspace_id=$2 and brand_id=$3 for update`,
          [scope.sessionId, scope.workspaceId, scope.brandId],
        );
        if (!session.rowCount) throw new Error("asset_library_upload_session_not_found");
        const row = session.rows[0];
        if (String(row.created_by_user_id) !== scope.actorUserId) {
          throw new Error("asset_library_upload_actor_mismatch");
        }
        const expectedPrefix =
          `brands/${scope.brandId}/asset-library/references/${scope.sessionId}/`;
        if (String(row.storage_path_prefix) !== expectedPrefix) {
          throw new Error("asset_library_upload_session_not_found");
        }
        const storagePath = row.storage_path ? String(row.storage_path) : undefined;
        if (storagePath && !storagePath.startsWith(expectedPrefix)) {
          throw new Error("asset_library_upload_path_mismatch");
        }
        const transitioned = await client.query(
          `update reference_upload_sessions set cancelled_at=coalesce(cancelled_at,now())
            where id=$1 and workspace_id=$2 and brand_id=$3
              and confirmed_at is null returning *`,
          [scope.sessionId, scope.workspaceId, scope.brandId],
        );
        if (Number(transitioned.rowCount ?? 0) !== 1) {
          throw new Error("asset_library_upload_session_not_found");
        }
        await client.query(
          `insert into reference_upload_cancellation_receipts(
            session_id,workspace_id,brand_id,created_by_user_id,storage_path,
            storage_path_prefix,token_expires_at,reason,status,next_attempt_at
          ) values($1,$2,$3,$4,$5,$6,$7,$8,'pending',
            greatest($7::timestamptz + interval '1 minute',now()))
          on conflict(session_id) do nothing`,
          [scope.sessionId, scope.workspaceId, scope.brandId, scope.actorUserId,
            storagePath ?? null, expectedPrefix, row.expires_at, reason],
        );
        return { existing: false as const, prefix: expectedPrefix, storagePath };
      });
      if ("terminal" in pending) return { status: "already_cancelled" };
      if (pending.existing) {
        return { status: "cleanup_pending", immediateCleanup: "already_pending" };
      }
      try {
        await cleanupBlobs(pending.prefix, pending.storagePath);
        return { status: "cleanup_pending", immediateCleanup: "succeeded" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        await pool.query(
          `update reference_upload_cancellation_receipts
            set attempt_count=attempt_count+1,last_error=$2
            where session_id=$1 and status='pending'`,
          [scope.sessionId, message],
        );
        return { status: "cleanup_pending", immediateCleanup: "retry_scheduled" };
      }
    },
    async cleanupExpiredReferenceUploads(cleanupBlobs, limit = 100) {
      const candidates = await pool.query(
        `select session.*,receipt.status receipt_status
          from reference_upload_sessions session
          left join reference_upload_cancellation_receipts receipt
            on receipt.session_id=session.id
          where session.storage_path_prefix like '%/asset-library/references/%'
            and (
              (receipt.status='pending' and receipt.next_attempt_at <= now()
                and receipt.token_expires_at < now())
              or (receipt.session_id is null and session.cancelled_at is null
                and session.confirmed_at is null and session.expires_at <= now())
            )
          order by coalesce(receipt.next_attempt_at,session.expires_at),session.id
          limit $1`,
        [Math.max(1, Math.min(limit, 500))],
      );
      const failed: Array<{ sessionId: string; error: string }> = [];
      let cancelled = 0;
      let preserved = 0;
      for (const candidate of candidates.rows) {
        const sessionId = String(candidate.id);
        const expectedPrefix =
          `brands/${candidate.brand_id}/asset-library/references/${sessionId}/`;
        try {
          if (String(candidate.storage_path_prefix) !== expectedPrefix) {
            throw new Error("asset_library_upload_path_mismatch");
          }
          let row = candidate;
          if (candidate.receipt_status) {
            const leased = await transaction(pool, async (client) => {
              await client.query(
                "select pg_advisory_xact_lock(hashtextextended($1,0))",
                [sessionId],
              );
              const receipt = await client.query(
                `select * from reference_upload_cancellation_receipts
                  where session_id=$1 and workspace_id=$2 and brand_id=$3
                    and status='pending' and token_expires_at < now()
                    and next_attempt_at <= now()
                  for update`,
                [sessionId, candidate.workspace_id, candidate.brand_id],
              );
              if (Number(receipt.rowCount ?? 0) !== 1) return null;
              const session = await client.query(
                `select * from reference_upload_sessions
                  where id=$1 and workspace_id=$2 and brand_id=$3 for update`,
                [sessionId, candidate.workspace_id, candidate.brand_id],
              );
              if (Number(session.rowCount ?? 0) !== 1) {
                await client.query(
                  `update reference_upload_cancellation_receipts
                    set status='completed',completed_at=now(),last_error=null
                    where session_id=$1 and status='pending'`,
                  [sessionId],
                );
                return null;
              }
              const claimed = await client.query(
                `update reference_upload_cancellation_receipts
                  set next_attempt_at=now()+interval '5 minutes'
                  where session_id=$1 and status='pending'
                  returning *`,
                [sessionId],
              );
              if (Number(claimed.rowCount ?? 0) !== 1) return null;
              return { ...session.rows[0], receipt_status: "pending" };
            });
            if (!leased) continue;
            row = leased;
          } else {
            const acquired = await transaction(pool, async (client) => {
              await client.query(
                "select pg_advisory_xact_lock(hashtextextended($1,0))",
                [sessionId],
              );
              const receipt = await client.query(
                `select session_id from reference_upload_cancellation_receipts
                  where session_id=$1 for update`,
                [sessionId],
              );
              if (receipt.rowCount) return null;
              const session = await client.query(
                `select * from reference_upload_sessions
                  where id=$1 and workspace_id=$2 and brand_id=$3 for update`,
                [sessionId, candidate.workspace_id, candidate.brand_id],
              );
              if (Number(session.rowCount ?? 0) !== 1) return null;
              const fresh = session.rows[0];
              if (fresh.cancelled_at || fresh.confirmed_at
                || new Date(fresh.expires_at).getTime() > Date.now()) return null;
              if (String(fresh.storage_path_prefix) !== expectedPrefix) {
                throw new Error("asset_library_upload_path_mismatch");
              }
              const transitioned = await client.query(
                `update reference_upload_sessions set cancelled_at=now()
                  where id=$1 and workspace_id=$2 and brand_id=$3
                    and cancelled_at is null and confirmed_at is null and expires_at <= now()
                  returning *`,
                [sessionId, fresh.workspace_id, fresh.brand_id],
              );
              if (Number(transitioned.rowCount ?? 0) !== 1) return null;
              const cancelledSession = transitioned.rows[0] ?? fresh;
              const inserted = await client.query(
                `insert into reference_upload_cancellation_receipts(
                  session_id,workspace_id,brand_id,created_by_user_id,storage_path,
                  storage_path_prefix,token_expires_at,reason,status,next_attempt_at
                ) values($1,$2,$3,$4,$5,$6,$7,'expired','pending',
                  greatest($7::timestamptz + interval '1 minute',now()))
                on conflict(session_id) do nothing returning session_id`,
                [sessionId, cancelledSession.workspace_id, cancelledSession.brand_id,
                  cancelledSession.created_by_user_id, cancelledSession.storage_path ?? null,
                  expectedPrefix, cancelledSession.expires_at],
              );
              if (Number(inserted.rowCount ?? 0) !== 1) return null;
              return { ...candidate, ...cancelledSession, receipt_status: "pending" };
            });
            if (!acquired) continue;
            row = acquired;
            // A newly expired reservation enters the one-minute late-upload grace.
            continue;
          }
          const consumed = await pool.query(
            `select item.id from reference_items item
              join storage_artifacts artifact
                on artifact.id=item.storage_artifact_id
               and artifact.workspace_id=item.workspace_id
               and artifact.brand_id=item.brand_id
              where item.workspace_id=$1 and item.brand_id=$2
                and item.archived_at is null and artifact.deleted_at is null
                and artifact.path like $3
              limit 1`,
            [row.workspace_id, row.brand_id, `${expectedPrefix}%`],
          );
          if (consumed.rowCount) {
            await transaction(pool, async (client) => {
              await client.query(
                `delete from reference_upload_sessions
                  where id=$1 and workspace_id=$2 and brand_id=$3`,
                [sessionId, row.workspace_id, row.brand_id],
              );
              await client.query(
                `update reference_upload_cancellation_receipts
                  set status='completed',completed_at=now(),last_error=null
                  where session_id=$1 and status='pending'`,
                [sessionId],
              );
            });
            preserved += 1;
            continue;
          }
          await cleanupBlobs(
            expectedPrefix,
            row.storage_path ? String(row.storage_path) : undefined,
          );
          await transaction(pool, async (client) => {
            await client.query(
              `delete from storage_artifacts
                where workspace_id=$1 and brand_id=$2 and path like $3
                  and deleted_at is null`,
              [row.workspace_id, row.brand_id, `${expectedPrefix}%`],
            );
            await client.query(
              `delete from reference_upload_sessions
                where id=$1 and workspace_id=$2 and brand_id=$3`,
              [sessionId, row.workspace_id, row.brand_id],
            );
            await client.query(
              `update reference_upload_cancellation_receipts
                set status='completed',completed_at=now(),last_error=null
                where session_id=$1 and status='pending'`,
              [sessionId],
            );
          });
          cancelled += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown";
          await pool.query(
            `update reference_upload_cancellation_receipts
              set attempt_count=attempt_count+1,last_error=$2,
                next_attempt_at=now() + make_interval(secs =>
                  least(3600,30 * power(2,least(attempt_count,7)))::integer)
              where session_id=$1 and status='pending'`,
            [sessionId, message],
          );
          failed.push({ sessionId, error: message });
        }
      }
      return { scanned: candidates.rows.length, cancelled, preserved, failed };
    },
    async confirmReferenceUpload(scope, upload) {
      return transaction(pool, async (client) => {
        await requireMember(client, scope);
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1,0))",
          [scope.sessionId],
        );
        await consumeSession(client, scope);
        const artifact = await client.query(
          `insert into storage_artifacts(
            workspace_id,brand_id,artifact_type,bucket,path,public_url,mime_type,byte_size,checksum,created_by_user_id
          ) values($1,$2,'brand_asset','vercel-blob',$3,$4,$5,$6,$7,$8) returning id`,
          [scope.workspaceId, scope.brandId, upload.storagePath, upload.storageUrl, upload.mimeType,
            upload.sizeBytes, upload.checksum, scope.actorUserId],
        );
        const inserted = await client.query(
          `insert into reference_items(
            workspace_id,brand_id,kind,origin,title,preview_url,source_url,format,metadata,
            storage_artifact_id,created_by_user_id
          ) values($1,$2,'upload','Upload',$3,$4,$4,$5,$6::jsonb,$7,$8) returning *`,
          [scope.workspaceId, scope.brandId, upload.fileName,
            upload.mimeType.startsWith("image/") ? upload.storageUrl : null,
            upload.mimeType, JSON.stringify({ fileName: upload.fileName }), artifact.rows[0].id, scope.actorUserId],
        );
        await client.query(
          "delete from reference_upload_sessions where id=$1 and workspace_id=$2 and brand_id=$3",
          [scope.sessionId, scope.workspaceId, scope.brandId],
        );
        return reference(inserted.rows[0] as Record<string, unknown>);
      });
    },
    async listReferenceBrands(scope) {
      const result = await pool.query(
        `select * from reference_brands where workspace_id=$1 and brand_id=$2 order by saved_at desc`,
        [scope.workspaceId, scope.brandId],
      );
      return result.rows.map((row) => refBrand(row as Record<string, unknown>));
    },
    async createReferenceBrand(scope, input) {
      return transaction(pool, async (client) => {
        await requireMember(client, scope);
        return createReferenceBrandInner(client, scope, input);
      });
    },
    async createReferenceBrandFromTrend(scope) {
      return transaction(pool, async (client) => {
        await requireMember(client, scope);
        const found = await client.query(
          `select media.username,media.permalink,media.media_url
            from instagram_trend_media media
            where media.id=$1 and exists(
              select 1 from brand_trend_saved_media saved
              where saved.trend_media_id=media.id and saved.workspace_id=$2 and saved.brand_id=$3
            )`,
          [scope.mediaId, scope.workspaceId, scope.brandId],
        );
        if (!found.rowCount) throw new Error("instagram_trend_media_not_found");
        const username = String(found.rows[0].username ?? "").trim().replace(/^@/, "");
        if (!username) throw new Error("reference_brand_author_unavailable");
        return createReferenceBrandInner(client, scope, {
          platform: "instagram", handle: username, publicSourceUrl: `https://www.instagram.com/${username}/`,
        }, {
          displayName: username,
          // media_url is content, not a verified profile image; never expose it as profile preview.
          sourceLink: found.rows[0].permalink,
          profilePreviewAvailable: false,
        });
      });
    },
    async listReferenceBrandItems(scope) {
      const brand = await pool.query(
        "select handle from reference_brands where id=$1 and workspace_id=$2 and brand_id=$3",
        [scope.referenceBrandId, scope.workspaceId, scope.brandId],
      );
      if (!brand.rowCount) throw new Error("reference_brand_not_found");
      const result = await pool.query(
        `select
          item.id,item.workspace_id,item.brand_id,item.kind,item.content_purpose,item.origin,
          left(item.title,160) title,item.preview_url,item.source_url,item.format,
          item.is_favorite,item.archived_at,item.reference_brand_id,item.created_at,item.updated_at,
          jsonb_strip_nulls(jsonb_build_object(
            'patternAvailable',exists(
              select 1 from reference_patterns pattern
              where pattern.reference_item_id=item.id
                and pattern.workspace_id=item.workspace_id
                and pattern.brand_id=item.brand_id
            )
          )) metadata
          from reference_items item
          join brand_trend_saved_media saved
            on saved.id=item.saved_trend_id and saved.workspace_id=item.workspace_id and saved.brand_id=item.brand_id
          join instagram_trend_media media on media.id=saved.trend_media_id
          where item.workspace_id=$1 and item.brand_id=$2 and item.archived_at is null
            and lower(media.username)=lower($3)
          order by item.created_at desc`,
        [scope.workspaceId, scope.brandId, brand.rows[0].handle],
      );
      return result.rows.map((row) => reference(row as Record<string, unknown>));
    },
  };
}
