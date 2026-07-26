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
  createdAt: string;
  updatedAt: string;
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
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), brandId: String(row.brand_id),
    kind: String(row.kind), contentPurpose: String(row.content_purpose), origin: String(row.origin),
    title: String(row.title), previewUrl: row.preview_url ? String(row.preview_url) : null,
    sourceUrl: row.source_url ? String(row.source_url) : null, format: row.format ? String(row.format) : null,
    metadata: json(row.metadata, {}), favorite: Boolean(row.is_favorite),
    archivedAt: row.archived_at ? iso(row.archived_at) : null,
    referenceBrandId: row.reference_brand_id ? String(row.reference_brand_id) : null,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
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
      if (filters.kind) add("item.kind=?", filters.kind);
      if (filters.contentFamily) add("item.metadata->>'contentFamily'=?", filters.contentFamily);
      if (filters.strategy) add("item.metadata->>'strategy'=?", filters.strategy);
      if (filters.format) add("lower(item.format)=lower(?)", filters.format);
      if (filters.origin) add("item.origin ilike '%' || ? || '%'", filters.origin);
      if (filters.favorite !== undefined) add("item.is_favorite=?", filters.favorite);
      if (filters.recent) add("item.created_at >= now() - (?::int * interval '1 day')", filters.recent);
      const result = await pool.query(
        `select item.* from reference_items item where ${where.join(" and ")} order by item.created_at desc`,
        values,
      );
      return result.rows.map((row) => reference(row as Record<string, unknown>));
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
            `select id from reference_items where source_url_id=$1 and workspace_id=$2 and brand_id=$3`,
            [source.rows[0].id, scope.workspaceId, scope.brandId],
          );
          if (duplicate.rowCount) throw new Error("reference_origin_duplicate");
          await client.query(
            `update source_urls set enabled=true,status='active',disabled_at=null,content_purpose=$1
              where id=$2 and workspace_id=$3 and brand_id=$4`,
            [input.contentPurpose, source.rows[0].id, scope.workspaceId, scope.brandId],
          );
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
        const result = await client.query(
          `update reference_items set archived_at=now(),
            metadata=metadata || jsonb_build_object('archivedByUserId',$1::text)
            where id=$2 and workspace_id=$3 and brand_id=$4 and archived_at is null`,
          [scope.actorUserId, scope.referenceId, scope.workspaceId, scope.brandId],
        );
        if (!result.rowCount) throw new Error("reference_not_found");
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
            expected_size_bytes,expected_checksum,expires_at,created_by_user_id
          ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [id, nonce, scope.workspaceId, scope.brandId, storagePathPrefix, upload.mimeType,
            upload.sizeBytes, upload.checksum, expiresAt, scope.actorUserId],
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
        `select * from reference_upload_sessions where id=$1 and workspace_id=$2 and brand_id=$3`,
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
        fileName, storagePathPrefix: String(row.storage_path_prefix),
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
    async confirmReferenceUpload(scope, upload) {
      return transaction(pool, async (client) => {
        await requireMember(client, scope);
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
        `select item.* from reference_items item
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
