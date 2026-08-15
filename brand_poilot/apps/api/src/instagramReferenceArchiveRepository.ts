import type { Pool, PoolClient } from "pg";
import type { BrandScope } from "./brandCoreRepository.js";
import {
  fetchInstagramBusinessDiscovery,
  normalizeInstagramHandle,
  type InstagramBusinessDiscoveryMedia,
  type InstagramBusinessDiscoveryResult,
} from "./instagramBusinessDiscoveryMeta.js";
import type { InstagramTrendMediaDto } from "./types.js";

type CacheState = "pending" | "fresh" | "stale" | "ineligible";

export interface ReferenceChannelDto extends BrandScope {
  id: string;
  platform: "instagram";
  handle: string;
  displayName: string;
  publicSourceUrl: string;
  profileSnapshot: Record<string, unknown>;
  previewUrl: string | null;
  providerAccountId: string | null;
  cacheState: CacheState;
  refreshedAt: string | null;
  lastRefreshAttemptedAt: string | null;
  lastRefreshError: string | null;
}

export interface ReferenceChannelMediaDto extends InstagramTrendMediaDto {
  sourcePlatform: "instagram";
  author: {
    referenceBrandId: string;
    handle: string;
    displayName: string;
  };
  metrics: {
    viewCount: number | null;
    likeCount: number | null;
    commentsCount: number | null;
  };
}

export interface ReferenceChannelMediaPageDto {
  items: ReferenceChannelMediaDto[];
  total: number;
  refreshedAt: string | null;
  cacheState: CacheState;
}

export interface InstagramReferenceArchiveRepository {
  listReferenceChannels(scope: BrandScope, query?: string): Promise<ReferenceChannelDto[]>;
  resolveReferenceChannel(
    scope: BrandScope & { actorUserId: string },
    profile: string,
  ): Promise<ReferenceChannelDto>;
  listReferenceChannelMedia(
    scope: BrandScope & { referenceBrandId: string },
  ): Promise<ReferenceChannelMediaPageDto>;
}

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

function nullableIso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nullableCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function json(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function channel(row: Record<string, unknown>): ReferenceChannelDto {
  const profileSnapshot = json(row.profile_snapshot);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    platform: "instagram",
    handle: String(row.handle),
    displayName: String(row.display_name),
    publicSourceUrl: String(row.public_source_url),
    profileSnapshot,
    previewUrl: typeof profileSnapshot.profileImageUrl === "string" ? profileSnapshot.profileImageUrl : null,
    providerAccountId: row.provider_account_id ? String(row.provider_account_id) : null,
    cacheState: (row.refresh_status ?? "pending") as CacheState,
    refreshedAt: nullableIso(row.refreshed_at),
    lastRefreshAttemptedAt: nullableIso(row.last_refresh_attempted_at),
    lastRefreshError: row.last_refresh_error ? String(row.last_refresh_error) : null,
  };
}

function mediaKind(mediaType: unknown, permalink: unknown): InstagramTrendMediaDto["kind"] {
  if (mediaType === "IMAGE") return "image";
  if (mediaType === "CAROUSEL_ALBUM") return "carousel";
  return /\/reel\/[^/]+\/?$/i.test(String(permalink)) ? "reel" : "video";
}

function channelMedia(row: Record<string, unknown>): ReferenceChannelMediaDto {
  const refreshedAt = nullableIso(row.last_fetched_at) ?? new Date(0).toISOString();
  const likeCount = nullableCount(row.like_count);
  const commentsCount = nullableCount(row.comments_count);
  return {
    id: String(row.id),
    instagramMediaId: String(row.instagram_media_id),
    username: row.username ? String(row.username) : null,
    caption: row.caption ? String(row.caption) : null,
    kind: mediaKind(row.media_type, row.permalink),
    mediaUrl: row.media_url ? String(row.media_url) : null,
    previewUrl: row.media_url ? String(row.media_url) : null,
    permalink: String(row.permalink),
    postedAt: nullableIso(row.posted_at),
    likeCount,
    commentsCount,
    metaRank: 0,
    refreshedAt,
    isSaved: Boolean(row.is_saved),
    sourcePlatform: "instagram",
    author: {
      referenceBrandId: String(row.reference_brand_id),
      handle: String(row.handle),
      displayName: String(row.display_name),
    },
    metrics: {
      viewCount: nullableCount(row.view_count),
      likeCount,
      commentsCount,
    },
  };
}

function observedDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
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

async function requireConnection(
  queryable: Queryable,
  scope: BrandScope & { actorUserId: string },
): Promise<{ igUserId: string; encryptedPayload: string }> {
  const result = await queryable.query(
    `select trend.instagram_business_account_id,trend.encrypted_payload,trend.status,trend.expires_at
     from brands brand
     join workspace_members member
       on member.workspace_id=brand.workspace_id and member.user_id=$3
     join instagram_trend_connections trend
       on trend.workspace_id=brand.workspace_id and trend.brand_id=brand.id
     where brand.workspace_id=$1 and brand.id=$2 and brand.deleted_at is null
     limit 1`,
    [scope.workspaceId, scope.brandId, scope.actorUserId],
  );
  if (!result.rowCount) throw new Error("instagram_trend_connection_required");
  const row = result.rows[0] as Record<string, unknown>;
  if (row.status !== "connected" || (row.expires_at && new Date(row.expires_at as string) <= new Date())) {
    throw new Error("instagram_trend_reconnect_required");
  }
  return {
    igUserId: String(row.instagram_business_account_id),
    encryptedPayload: String(row.encrypted_payload),
  };
}

function profileSnapshot(result: InstagramBusinessDiscoveryResult): Record<string, unknown> {
  return {
    source: "business_discovery",
    biography: result.profile.biography,
    followersCount: result.profile.followersCount,
    mediaCount: result.profile.mediaCount,
    website: result.profile.website,
  };
}

async function upsertMedia(
  client: PoolClient,
  item: InstagramBusinessDiscoveryMedia,
  fetchedAt: Date,
): Promise<string> {
  const result = await client.query(
    `insert into instagram_trend_media(
       instagram_media_id,username,caption,media_type,media_url,permalink,posted_at,
       like_count,comments_count,last_fetched_at,raw_metadata,updated_at
     ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$10)
     on conflict(instagram_media_id) do update set
       username=coalesce(nullif(excluded.username,''),instagram_trend_media.username),
       caption=excluded.caption,media_type=excluded.media_type,media_url=excluded.media_url,
       permalink=excluded.permalink,posted_at=excluded.posted_at,like_count=excluded.like_count,
       comments_count=excluded.comments_count,last_fetched_at=excluded.last_fetched_at,
       raw_metadata=instagram_trend_media.raw_metadata || excluded.raw_metadata,updated_at=excluded.updated_at
     returning id`,
    [
      item.providerMediaId, item.username, item.caption, item.mediaType, item.mediaUrl,
      item.permalink, item.timestamp, item.likeCount, item.commentsCount, fetchedAt,
      JSON.stringify({ source: "business_discovery", viewCount: item.viewCount }),
    ],
  );
  return String(result.rows[0].id);
}

export function createInstagramReferenceArchiveRepository(input: {
  pool: Pool;
  decryptCredential: (encrypted: string) => string;
  fetchBusinessDiscovery?: typeof fetchInstagramBusinessDiscovery;
  now?: () => Date;
}): InstagramReferenceArchiveRepository {
  const fetchBusinessDiscovery = input.fetchBusinessDiscovery ?? fetchInstagramBusinessDiscovery;
  const now = input.now ?? (() => new Date());

  return {
    async listReferenceChannels(scope, query) {
      const q = query?.trim() ?? "";
      const result = await input.pool.query(
        `select * from reference_brands
         where workspace_id=$1 and brand_id=$2 and lower(platform)='instagram'
           and ($3='' or handle ilike '%' || $3 || '%' or display_name ilike '%' || $3 || '%')
         order by saved_at desc`,
        [scope.workspaceId, scope.brandId, q],
      );
      return result.rows.map((row) => channel(row as Record<string, unknown>));
    },

    async resolveReferenceChannel(scope, rawProfile) {
      const username = normalizeInstagramHandle(rawProfile);
      const connection = await requireConnection(input.pool, scope);
      const fetchedAt = now();
      const discovery = await fetchBusinessDiscovery({
        igUserId: connection.igUserId,
        accessToken: input.decryptCredential(connection.encryptedPayload),
        username,
      });

      return transaction(input.pool, async (client) => {
        const existing = await client.query(
          `select * from reference_brands
           where workspace_id=$1 and brand_id=$2 and lower(platform)='instagram'
             and (provider_account_id=$3 or lower(handle)=lower($4))
           order by (provider_account_id=$3) desc
           for update`,
          [scope.workspaceId, scope.brandId, discovery.profile.providerAccountId, discovery.profile.username],
        );
        if (existing.rows.length > 1 && new Set(existing.rows.map((row) => String(row.id))).size > 1) {
          throw new Error("reference_channel_identity_conflict");
        }

        let referenceBrandId: string;
        if (existing.rowCount) {
          referenceBrandId = String(existing.rows[0].id);
          await client.query(
            `update reference_brands set
               provider_account_id=$4,handle=$5,display_name=$5,public_source_url=$6,
               profile_snapshot=$7::jsonb,refresh_status='fresh',refreshed_at=$8,
               last_refresh_attempted_at=$8,last_refresh_error=null,updated_at=$8
             where id=$1 and workspace_id=$2 and brand_id=$3`,
            [referenceBrandId, scope.workspaceId, scope.brandId, discovery.profile.providerAccountId,
              discovery.profile.username, `https://www.instagram.com/${discovery.profile.username}/`,
              JSON.stringify(profileSnapshot(discovery)), fetchedAt],
          );
        } else {
          const inserted = await client.query(
            `insert into reference_brands(
               workspace_id,brand_id,platform,handle,display_name,public_source_url,profile_snapshot,
               provider_account_id,refresh_status,refreshed_at,last_refresh_attempted_at,created_by_user_id
             ) values($1,$2,'instagram',$3,$3,$4,$5::jsonb,$6,'fresh',$7,$7,$8)
             returning id`,
            [scope.workspaceId, scope.brandId, discovery.profile.username,
              `https://www.instagram.com/${discovery.profile.username}/`, JSON.stringify(profileSnapshot(discovery)),
              discovery.profile.providerAccountId, fetchedAt, scope.actorUserId],
          );
          referenceBrandId = String(inserted.rows[0].id);
          await client.query(
            `insert into reference_items(
               workspace_id,brand_id,kind,origin,title,source_url,format,metadata,
               reference_brand_id,created_by_user_id
             ) values($1,$2,'saved_brand','Instagram',$3,$4,'profile',$5::jsonb,$6,$7)`,
            [scope.workspaceId, scope.brandId, discovery.profile.username,
              `https://www.instagram.com/${discovery.profile.username}/`,
              JSON.stringify({ platform: "instagram", handle: discovery.profile.username }),
              referenceBrandId, scope.actorUserId],
          );
        }

        await client.query(
          `update reference_brand_media set is_current=false,updated_at=$4
           where workspace_id=$1 and brand_id=$2 and reference_brand_id=$3 and is_current`,
          [scope.workspaceId, scope.brandId, referenceBrandId, fetchedAt],
        );

        const mediaIds: Array<{ id: string; item: InstagramBusinessDiscoveryMedia }> = [];
        for (const item of discovery.media.slice(0, 25)) {
          const trendMediaId = await upsertMedia(client, item, fetchedAt);
          mediaIds.push({ id: trendMediaId, item });
          await client.query(
            `insert into reference_brand_media(
               workspace_id,brand_id,reference_brand_id,trend_media_id,first_seen_at,last_seen_at,is_current,updated_at
             ) values($1,$2,$3,$4,$5,$5,true,$5)
             on conflict(workspace_id,brand_id,reference_brand_id,trend_media_id) do update set
               last_seen_at=excluded.last_seen_at,is_current=true,updated_at=excluded.updated_at`,
            [scope.workspaceId, scope.brandId, referenceBrandId, trendMediaId, fetchedAt],
          );
        }

        const date = observedDate(fetchedAt);
        await client.query(
          `insert into reference_brand_metric_observations(
             workspace_id,brand_id,reference_brand_id,observed_date,observed_at,followers_count,media_count
           ) values($1,$2,$3,$4,$5,$6,$7)
           on conflict(workspace_id,brand_id,reference_brand_id,observed_date) do update set
             observed_at=excluded.observed_at,followers_count=excluded.followers_count,media_count=excluded.media_count`,
          [scope.workspaceId, scope.brandId, referenceBrandId, date, fetchedAt,
            discovery.profile.followersCount, discovery.profile.mediaCount],
        );
        for (const media of mediaIds) {
          await client.query(
            `insert into reference_media_metric_observations(
               workspace_id,brand_id,reference_brand_id,trend_media_id,observed_date,observed_at,
               view_count,like_count,comments_count
             ) values($1,$2,$3,$4,$5,$6,$7,$8,$9)
             on conflict(workspace_id,brand_id,reference_brand_id,trend_media_id,observed_date) do update set
               observed_at=excluded.observed_at,view_count=excluded.view_count,
               like_count=excluded.like_count,comments_count=excluded.comments_count`,
            [scope.workspaceId, scope.brandId, referenceBrandId, media.id, date, fetchedAt,
              media.item.viewCount, media.item.likeCount, media.item.commentsCount],
          );
        }

        const saved = await client.query(
          `select * from reference_brands where id=$1 and workspace_id=$2 and brand_id=$3`,
          [referenceBrandId, scope.workspaceId, scope.brandId],
        );
        return channel(saved.rows[0] as Record<string, unknown>);
      });
    },

    async listReferenceChannelMedia(scope) {
      const result = await input.pool.query(
        `select media.*,relation.reference_brand_id,brand.handle,brand.display_name,
                brand.refreshed_at,brand.refresh_status,
                observation.view_count,
                (saved.id is not null) is_saved,
                count(*) over() total_count
         from reference_brand_media relation
         join reference_brands brand
           on brand.id=relation.reference_brand_id and brand.workspace_id=relation.workspace_id
          and brand.brand_id=relation.brand_id
         join instagram_trend_media media on media.id=relation.trend_media_id
         left join brand_trend_saved_media saved
           on saved.workspace_id=relation.workspace_id and saved.brand_id=relation.brand_id
          and saved.trend_media_id=media.id
         left join lateral(
           select metric.view_count
           from reference_media_metric_observations metric
           where metric.workspace_id=relation.workspace_id and metric.brand_id=relation.brand_id
             and metric.reference_brand_id=relation.reference_brand_id and metric.trend_media_id=media.id
           order by metric.observed_at desc limit 1
         ) observation on true
         where relation.workspace_id=$1 and relation.brand_id=$2
           and relation.reference_brand_id=$3 and relation.is_current
         order by media.posted_at desc nulls last,media.id`,
        [scope.workspaceId, scope.brandId, scope.referenceBrandId],
      );
      const first = result.rows[0] as Record<string, unknown> | undefined;
      return {
        items: result.rows.map((row) => channelMedia(row as Record<string, unknown>)),
        total: Number(first?.total_count ?? 0),
        refreshedAt: nullableIso(first?.refreshed_at),
        cacheState: (first?.refresh_status ?? "pending") as CacheState,
      };
    },
  };
}
