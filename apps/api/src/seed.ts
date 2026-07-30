import "dotenv/config";
import { createPool } from "./db.js";

export const seedIds = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  brandId: "00000000-0000-4000-8000-000000000100",
  instagramChannelId: "00000000-0000-4000-8000-000000001001",
  threadsChannelId: "00000000-0000-4000-8000-000000001002",
  tiktokChannelId: "00000000-0000-4000-8000-000000001003",
  youtubeChannelId: "00000000-0000-4000-8000-000000001004",
  xChannelId: "00000000-0000-4000-8000-000000001005",
  linkedinChannelId: "00000000-0000-4000-8000-000000001006",
  ownedSourceId: "00000000-0000-4000-8000-000000002001",
  referenceSourceId: "00000000-0000-4000-8000-000000002002",
  topicUploadId: "00000000-0000-4000-8000-000000003001",
  topicRowId: "00000000-0000-4000-8000-000000003002",
  contentTopicId: "00000000-0000-4000-8000-000000004001",
  masterDraftId: "00000000-0000-4000-8000-000000004002",
  instagramOutputId: "00000000-0000-4000-8000-000000005001",
  threadsOutputId: "00000000-0000-4000-8000-000000005003",
  publishQueueId: "00000000-0000-4000-8000-000000006001"
};

const pool = createPool();

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("begin");

    await client.query(
      `insert into app_users (id, email, display_name, status)
       values ($1, 'pilot@example.com', 'Pilot User', 'active')
       on conflict (id) do update set email = excluded.email, display_name = excluded.display_name`,
      [seedIds.userId]
    );

    await client.query(
      `insert into workspaces (id, name, slug, status, created_by_user_id)
      values ($1, '모종 Demo', 'brand-pilot-demo', 'active', $2)
       on conflict (id) do update set name = excluded.name, slug = excluded.slug`,
      [seedIds.workspaceId, seedIds.userId]
    );

    await client.query(
      `insert into workspace_members (workspace_id, user_id, role, status)
       values ($1, $2, 'owner', 'active')
       on conflict (workspace_id, user_id) do update set role = excluded.role, status = excluded.status`,
      [seedIds.workspaceId, seedIds.userId]
    );

    await client.query(
      `insert into brands (id, workspace_id, name, status, timezone, created_by_user_id)
       values ($1, $2, '제주 여행 상담 브랜드', 'active', 'Asia/Seoul', $3)
       on conflict (id) do nothing`,
      [seedIds.brandId, seedIds.workspaceId, seedIds.userId]
    );

    await client.query(
      `insert into brand_profiles (
         workspace_id, brand_id, primary_category_id, primary_customer, description, tone,
         forbidden_terms, default_cta, main_link, auto_approval_enabled
       )
       values (
         $1, $2, (select id from content_categories where code = 'travel_tourism'), '일본 여행을 처음 준비하는 20-40대',
         '제주와 일본 여행 일정을 상담하고 숙소, 이동, 예산 정보를 정리해주는 여행 브랜드입니다.',
         '친절하지만 과장하지 않는 전문가 톤', '[]'::jsonb, '무료 상담 신청하기', 'https://example.com', true
       )
       on conflict (brand_id)
       do nothing`,
      [seedIds.workspaceId, seedIds.brandId]
    );

    const channels = [
      [seedIds.instagramChannelId, "instagram", "not_connected", "연결 전", true, null],
      [seedIds.threadsChannelId, "threads", "not_connected", "연결 전", true, null],
      [seedIds.xChannelId, "x", "not_connected", "연결 전", false, null],
      [seedIds.linkedinChannelId, "linkedin", "not_connected", "연결 전", false, null],
      [seedIds.youtubeChannelId, "youtube", "not_connected", "연결 전", false, null],
      [seedIds.tiktokChannelId, "tiktok", "not_connected", "연결 전", false, null]
    ];
    for (const [id, channel, status, accountLabel, enabled, lastError] of channels) {
      await client.query(
        `insert into brand_channels (id, workspace_id, brand_id, channel, status, account_label, enabled, last_error)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (brand_id, channel) where deleted_at is null
         do nothing`,
        [id, seedIds.workspaceId, seedIds.brandId, channel, status, accountLabel, enabled, lastError]
      );
    }

    await client.query("commit");
  console.log(`Seeded 모종 demo brand ${seedIds.brandId}`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await seed();
