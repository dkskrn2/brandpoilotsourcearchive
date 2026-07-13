import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { createRepository } from "./repository.js";

type QueryResult = { rowCount: number; rows: Record<string, any>[] };

function pglitePool(database: PGlite) {
  let transactionTail = Promise.resolve();

  async function execute(sql: string, values: unknown[] = []): Promise<QueryResult> {
    const result = await database.query(sql, values as any[]);
    return {
      rowCount: result.rows.length > 0 ? result.rows.length : Number(result.affectedRows ?? 0),
      rows: result.rows as Record<string, any>[]
    };
  }

  return {
    query: execute,
    async connect() {
      let releaseTransaction: (() => void) | null = null;
      return {
        async query(sql: string, values: unknown[] = []) {
          const command = sql.trim().toLowerCase();
          if (command === "begin") {
            const previous = transactionTail;
            transactionTail = new Promise<void>((resolve) => {
              releaseTransaction = resolve;
            });
            await previous;
          }
          try {
            return await execute(sql, values);
          } finally {
            if ((command === "commit" || command === "rollback") && releaseTransaction) {
              releaseTransaction();
              releaseTransaction = null;
            }
          }
        },
        release() {}
      };
    }
  };
}

async function createMinimalGenerationSchema(database: PGlite) {
  await database.exec(`
    create table brands (
      id text primary key,
      workspace_id text not null,
      name text not null,
      timezone text not null,
      deleted_at timestamptz null
    );
    create table brand_profiles (
      brand_id text primary key,
      industry text null,
      primary_customer text null,
      description text null,
      tone text null,
      default_cta text null,
      auto_approval_enabled boolean not null default false,
      brand_color text null
    );
    create table brand_channels (
      id text primary key,
      brand_id text not null,
      channel text not null,
      status text not null,
      enabled boolean not null default true,
      deleted_at timestamptz null
    );
    create table topic_rows (
      id text primary key,
      brand_id text not null,
      topic_title text not null,
      topic_angle text not null,
      target_customer text null,
      region text null,
      season text null,
      reference_url text null,
      notes text null,
      status text not null,
      used_at timestamptz null
    );
    create table content_topics (
      id text primary key,
      workspace_id text not null,
      brand_id text not null,
      topic_row_id text null,
      title text not null,
      angle text not null,
      status text not null,
      source_context jsonb not null default '{}'::jsonb,
      selected_instagram_format text null,
      selected_at timestamptz not null,
      generated_at timestamptz null,
      error_message text null,
      created_at timestamptz not null,
      updated_at timestamptz not null default now()
    );
    create table topic_publish_groups (
      id bigint generated always as identity primary key,
      workspace_id text not null,
      brand_id text not null,
      content_topic_id text not null unique,
      status text not null
    );
    create table master_drafts (
      id bigint generated always as identity primary key,
      workspace_id text not null,
      brand_id text not null,
      content_topic_id text not null,
      status text not null,
      prompt_version text not null,
      draft_json jsonb not null,
      source_snapshot_refs jsonb not null
    );
    create table llm_runs (
      id bigint generated always as identity primary key,
      workspace_id text not null,
      brand_id text not null,
      content_topic_id text not null,
      purpose text not null,
      provider text not null,
      model text not null,
      prompt_version text not null,
      status text not null,
      input_tokens int not null,
      output_tokens int not null,
      request_metadata jsonb not null,
      response_metadata jsonb not null,
      error_message text null,
      finished_at timestamptz null
    );
    create table channel_outputs (
      id bigint generated always as identity primary key,
      workspace_id text not null,
      brand_id text not null,
      content_topic_id text not null,
      master_draft_id bigint not null,
      channel text not null,
      delivery_format text not null,
      status text not null,
      title text not null,
      preview_title text null,
      preview_body text null,
      output_json jsonb not null,
      source_summary text null,
      block_reasons jsonb not null,
      approved_at timestamptz null
    );
  `);
}

async function seedQuotaFixture(database: PGlite) {
  await database.query(
    "insert into brands (id, workspace_id, name, timezone) values ($1, $2, $3, $4)",
    ["brand-1", "workspace-1", "Quota Brand", "Asia/Seoul"]
  );
  await database.query(
    "insert into brand_profiles (brand_id, industry, primary_customer, description, tone) values ($1, $2, $3, $4, $5)",
    ["brand-1", "travel", "families", "route planning", "clear"]
  );
  await database.query(
    "insert into brand_channels (id, brand_id, channel, status, enabled) values ($1, $2, 'threads', 'connected', true)",
    ["threads-channel", "brand-1"]
  );
  await database.query(
    `insert into topic_rows (id, brand_id, topic_title, topic_angle, target_customer, status)
     values ($1, $2, $3, $4, $5, 'uploaded')`,
    ["target-row", "brand-1", "Old selected topic", "quota regression", "families"]
  );

  const generatedToday = "2026-07-13T00:15:00.000Z";
  for (let index = 1; index <= 3; index += 1) {
    await database.query(
      `insert into content_topics (
         id, workspace_id, brand_id, title, angle, status, source_context,
         selected_at, generated_at, created_at
       ) values ($1, 'workspace-1', 'brand-1', $2, 'existing', $3, '{}'::jsonb, $4, $5, $6)`,
      [
        `old-generated-${index}`,
        `Old generated ${index}`,
        index === 1 ? "selected" : "generated",
        index === 1 ? "2026-02-01T00:00:00.000Z" : "2026-01-01T00:00:00.000Z",
        generatedToday,
        "2026-01-01T00:00:00.000Z"
      ]
    );
  }

  await database.query(
    `insert into content_topics (
       id, workspace_id, brand_id, topic_row_id, title, angle, status, source_context,
       selected_at, generated_at, created_at
     ) values ($1, 'workspace-1', 'brand-1', $2, $3, $4, 'selected', $5::jsonb, $6, null, $7)`,
    [
      "old-target",
      "target-row",
      "Old selected topic",
      "quota regression",
      JSON.stringify({ source: "topic_table", topicRowId: "target-row" }),
      "2025-12-01T00:00:00.000Z",
      "2025-12-01T00:00:00.000Z"
    ]
  );

  for (let index = 1; index <= 4; index += 1) {
    await database.query(
      `insert into content_topics (
         id, workspace_id, brand_id, title, angle, status, source_context,
         selected_at, generated_at, created_at
       ) values ($1, 'workspace-1', 'brand-1', $2, 'pending', 'selected', '{}'::jsonb, $3, null, $3)`,
      [`new-pending-${index}`, `New pending ${index}`, `2026-07-13T00:0${index}:00.000Z`]
    );
  }
}

describe("daily topic quota with PGlite", () => {
  let database: PGlite | null = null;

  afterEach(async () => {
    await database?.close();
    database = null;
  });

  it("allows only one concurrent fourth generation based on generated_at in the brand timezone", async () => {
    database = await PGlite.create();
    await createMinimalGenerationSchema(database);
    await seedQuotaFixture(database);
    const repository = createRepository(pglitePool(database) as any);
    const now = new Date("2026-07-13T01:00:00.000Z");

    const results = await Promise.all([
      repository.generateContent("brand-1", now),
      repository.generateContent("brand-1", now)
    ]);

    expect(results.map((result) => result.processed).sort()).toEqual([0, 1]);
    expect(results.find((result) => result.processed === 0)?.reason).toBe("daily_topic_limit");
    const generatedCount = await database.query<{ count: number }>(
      `select count(*)::int as count
       from content_topics
       where brand_id = $1
         and (generated_at at time zone $2)::date = $3::date`,
      ["brand-1", "Asia/Seoul", "2026-07-13"]
    );
    expect(generatedCount.rows[0]?.count).toBe(4);
    const target = await database.query<{ generated_at: string | Date; status: string }>(
      "select generated_at, status from content_topics where id = 'old-target'"
    );
    expect(new Date(String(target.rows[0]?.generated_at)).toISOString()).toBe(now.toISOString());
    expect(target.rows[0]?.status).toBe("generated");
    const pendingToday = await database.query<{ count: number }>(
      "select count(*)::int as count from content_topics where id like 'new-pending-%' and generated_at is null"
    );
    expect(pendingToday.rows[0]?.count).toBe(4);
  }, 30_000);
});
