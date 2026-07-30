import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminRepository } from "./adminRepository";

let database: PGlite | undefined;

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  const migrationDirectory = resolve(process.cwd(), "../../db/migrations");
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(resolve(migrationDirectory, file), "utf8");
    if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
    await database.exec(sql);
  }

  await database.exec(`
    insert into app_users (id, email, display_name)
      values ('10000000-0000-4000-8000-000000000001', 'admin@example.com', '관리자');
    insert into workspaces (id, name, slug, created_by_user_id)
      values ('20000000-0000-4000-8000-000000000002', 'Growthline', 'growthline', '10000000-0000-4000-8000-000000000001');
    insert into workspace_members (workspace_id, user_id, role)
      values ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'owner');
    insert into brands (id, workspace_id, name)
      values ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'Brand Pilot');
    insert into brand_profiles (workspace_id, brand_id, primary_customer)
      values ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '브랜드 운영자');
    insert into brand_channels (id, workspace_id, brand_id, channel, status, account_label, enabled)
      values ('40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 'instagram', 'not_connected', '연결 전', false);
    insert into instagram_dm_settings (workspace_id, brand_id, enabled)
      values ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', false)
      on conflict (brand_id) do update set enabled = excluded.enabled;
    insert into content_topics (id, workspace_id, brand_id, title, angle, status)
      values ('50000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '관리자 게시 테스트', '실무 팁', 'generated');
    insert into master_drafts (id, workspace_id, brand_id, content_topic_id, status, prompt_version)
      values ('60000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000005', 'generated', 'test.v1');
    insert into channel_outputs (id, workspace_id, brand_id, content_topic_id, master_draft_id, channel, delivery_format, status, title, output_json)
      values ('70000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000006', 'instagram', 'instagram_feed_carousel', 'approved', '관리자 게시 테스트', '{"cards":[]}');
    insert into topic_publish_groups (id, workspace_id, brand_id, content_topic_id, status)
      values ('80000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000005', 'ready');
    insert into publish_queue (id, workspace_id, brand_id, channel_output_id, topic_publish_group_id, brand_channel_id, channel, status, approval_type, idempotency_key)
      values ('90000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000007', '80000000-0000-4000-8000-000000000008', '40000000-0000-4000-8000-000000000004', 'instagram', 'queued', 'manual', 'admin-publishing-test');
  `);
}, 30_000);

afterAll(async () => {
  await database?.close();
});

describe("AdminRepository PostgreSQL schema contract", () => {
  it("executes overview, brand, channel, publishing, and system queries against the migrated schema", async () => {
    const repository = createAdminRepository(database as never);

    const overview = await repository.getOverview();
    const brands = await repository.listBrands({ limit: 30 });
    const channels = await repository.listChannels({ limit: 30 });
    const publishing = await repository.listPublishing({ limit: 30 });
    const publishingDetail = await repository.getPublishing("90000000-0000-4000-8000-000000000009");
    const system = await repository.getSystemHealth();

    expect(overview.brands.active).toBe(1);
    expect(brands.items[0]?.name).toBe("Brand Pilot");
    expect(channels.items.length).toBeGreaterThan(0);
    expect(publishing.items[0]?.contentTitle).toBe("관리자 게시 테스트");
    expect(publishingDetail?.canCancel).toBe(true);
    expect(system.database).toBe("ok");
  }, 30_000);
});
