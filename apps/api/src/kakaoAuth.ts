import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";

export interface AuthSession {
  userId: string;
  displayName: string | null;
  email: string | null;
  workspaceId: string;
  workspaceName: string;
  brandId: string;
  brandName: string;
}

export interface KakaoProfile {
  subject: string;
  nickname: string | null;
  email: string | null;
}

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function workspaceSlug() {
  return `workspace-${randomBytes(10).toString("hex")}`;
}

function mapAuthSession(row: Record<string, unknown>): AuthSession {
  return {
    userId: String(row.user_id),
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    email: typeof row.email === "string" ? row.email : null,
    workspaceId: String(row.workspace_id),
    workspaceName: String(row.workspace_name),
    brandId: String(row.brand_id),
    brandName: String(row.brand_name)
  };
}

async function ensureBrandChannels(
  queryable: Pick<Pool, "query">,
  input: { workspaceId: string; brandId: string }
) {
  await queryable.query(
    `insert into brand_channels (workspace_id, brand_id, channel, status, account_label, enabled)
     values
       ($1, $2, 'instagram', 'not_connected', '연결 전', true),
       ($1, $2, 'threads', 'not_connected', '연결 전', true),
       ($1, $2, 'x', 'not_connected', '연결 전', false),
       ($1, $2, 'linkedin', 'not_connected', '연결 전', false),
       ($1, $2, 'youtube', 'not_connected', '연결 전', false),
       ($1, $2, 'tiktok', 'not_connected', '연결 전', false)
     on conflict (brand_id, channel) where deleted_at is null do nothing`,
    [input.workspaceId, input.brandId]
  );
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function createKakaoAuthStore(pool: Pool) {
  return {
    async createOrLoadUser(profile: KakaoProfile) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const existing = await client.query(
          `select u.id as user_id, u.display_name, u.email, w.id as workspace_id, w.name as workspace_name, b.id as brand_id, b.name as brand_name
           from user_identities i join app_users u on u.id = i.user_id
           join workspace_members wm on wm.user_id = u.id and wm.status = 'active' and wm.deleted_at is null
           join workspaces w on w.id = wm.workspace_id and w.deleted_at is null
           join brands b on b.workspace_id = w.id and b.deleted_at is null
           where i.provider = 'kakao' and i.provider_subject = $1 and u.deleted_at is null
           order by b.created_at asc limit 1`,
          [profile.subject]
        );
        if (existing.rowCount) {
          await client.query("commit");
          return mapAuthSession(existing.rows[0]);
        }
        const user = await client.query(
          `insert into app_users (email, display_name) values ($1, $2) returning id, display_name, email`,
          [profile.email, profile.nickname]
        );
        const userId = user.rows[0].id;
        await client.query("insert into user_identities (user_id, provider, provider_subject) values ($1, 'kakao', $2)", [userId, profile.subject]);
        const workspace = await client.query(
          `insert into workspaces (name, slug, created_by_user_id) values ($1, $2, $3) returning id, name`,
          [`${profile.nickname || "새 사용자"}의 Brand Pilot`, workspaceSlug(), userId]
        );
        const workspaceId = workspace.rows[0].id;
        await client.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, userId]);
        const brand = await client.query(
          `insert into brands (workspace_id, name, created_by_user_id) values ($1, '내 브랜드', $2) returning id, name`,
          [workspaceId, userId]
        );
        await client.query(
          "insert into brand_profiles (workspace_id, brand_id, auto_approval_enabled) values ($1, $2, true)",
          [workspaceId, brand.rows[0].id]
        );
        await ensureBrandChannels(client as Pick<Pool, "query">, { workspaceId, brandId: brand.rows[0].id });
        await client.query("commit");
        return {
          userId,
          displayName: user.rows[0].display_name,
          email: user.rows[0].email,
          workspaceId,
          workspaceName: workspace.rows[0].name,
          brandId: brand.rows[0].id,
          brandName: brand.rows[0].name
        } satisfies AuthSession;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async createSession(userId: string) {
      const token = createSessionToken();
      await pool.query("insert into user_sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '7 days')", [userId, tokenHash(token)]);
      return token;
    },
    async getSession(token: string): Promise<AuthSession | null> {
      const result = await pool.query(
        `select u.id as user_id, u.display_name, u.email, w.id as workspace_id, w.name as workspace_name, b.id as brand_id, b.name as brand_name
         from user_sessions s join app_users u on u.id = s.user_id
         join workspace_members wm on wm.user_id = u.id and wm.status = 'active' and wm.deleted_at is null
         join workspaces w on w.id = wm.workspace_id and w.deleted_at is null
         join brands b on b.workspace_id = w.id and b.deleted_at is null
         where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.deleted_at is null
         order by b.created_at asc limit 1`,
        [tokenHash(token)]
      );
      if (!result.rowCount) return null;
      return mapAuthSession(result.rows[0]);
    },
    async revokeSession(token: string) {
      await pool.query("update user_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null", [tokenHash(token)]);
    },
    async canAccessBrand(userId: string, brandId: string) {
      const result = await pool.query(
        `select 1 from brands b join workspace_members wm on wm.workspace_id = b.workspace_id
         where b.id = $1 and b.deleted_at is null and wm.user_id = $2 and wm.status = 'active' and wm.deleted_at is null`,
        [brandId, userId]
      );
      return Boolean(result.rowCount);
    },
    async canAccessResource(userId: string, table: "source_urls" | "content_outputs" | "publish_queue" | "support_requests" | "dm_attention_items", resourceId: string) {
      const result = await pool.query(
        `select 1 from ${table} resource join workspace_members wm on wm.workspace_id = resource.workspace_id
         where resource.id = $1 and wm.user_id = $2 and wm.status = 'active' and wm.deleted_at is null`,
        [resourceId, userId]
      );
      return Boolean(result.rowCount);
    }
  };
}
