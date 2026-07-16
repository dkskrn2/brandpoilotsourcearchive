import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { loadMigrations } from "./migrationRunner.mjs";

const legacyInstagramDeliveryChecksum =
  "7e45bc297cf35128368700b49f34974690d699198e465ecfb608ac9922cb1882";
const legacyInstagramDeliverySql = await readFile(
  "scripts/fixtures/014_instagram_delivery_formats.legacy.sql",
  "utf8",
);
assert.equal(
  createHash("sha256").update(legacyInstagramDeliverySql).digest("hex"),
  legacyInstagramDeliveryChecksum,
);

const withDatabase = async (callback) => {
  const database = await PGlite.create({ extensions: { pgcrypto } });
  try {
    return await callback(database);
  } finally {
    await database.close();
  }
};

const runMigrationRange = async (database, migrations, firstId, lastId) => {
  for (const migration of migrations) {
    if (migration.id >= firstId && migration.id <= lastId) {
      if (
        migration.sql.startsWith("-- requires: pgvector")
        || migration.id === "027_wiki_search_v2.sql"
      ) continue;
      await database.exec(migration.sql);
    }
  }
};

const insertPublishingFixture = async (database) => {
  const deliveryFormatColumn = await database.query(`
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'channel_outputs'
      and column_name = 'delivery_format'
  `);
  const deliveryFormatRequired =
    deliveryFormatColumn.rows[0]?.is_nullable === "NO";
  const topicPublishGroupColumn = await database.query(`
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'publish_queue'
      and column_name = 'topic_publish_group_id'
  `);
  const topicPublishGroupRequired =
    topicPublishGroupColumn.rows[0]?.is_nullable === "NO";

  const workspace = await database.query(
    "insert into workspaces (name, slug) values ($1, $2) returning id",
    ["Migration Test", `migration-${randomUUID()}`],
  );
  const workspaceId = workspace.rows[0].id;
  const brand = await database.query(
    "insert into brands (workspace_id, name) values ($1, $2) returning id",
    [workspaceId, "Migration Brand"],
  );
  const brandId = brand.rows[0].id;
  await database.query(
    "insert into brand_profiles (workspace_id, brand_id) values ($1, $2)",
    [workspaceId, brandId],
  );

  const brandChannels = new Map();
  for (const channel of ["instagram", "threads"]) {
    const result = await database.query(
      "insert into brand_channels (workspace_id, brand_id, channel, status) values ($1, $2, $3, 'connected') returning id",
      [workspaceId, brandId, channel],
    );
    brandChannels.set(channel, result.rows[0].id);
  }

  const createTopic = async (title, queueFixtures) => {
    const topic = await database.query(
      "insert into content_topics (workspace_id, brand_id, title, angle) values ($1, $2, $3, $4) returning id",
      [workspaceId, brandId, title, `${title} angle`],
    );
    const topicId = topic.rows[0].id;
    const topicPublishGroupId = topicPublishGroupRequired
      ? (
          await database.query(
            "insert into topic_publish_groups (workspace_id, brand_id, content_topic_id) values ($1, $2, $3) returning id",
            [workspaceId, brandId, topicId],
          )
        ).rows[0].id
      : null;
    const draft = await database.query(
      "insert into master_drafts (workspace_id, brand_id, content_topic_id, prompt_version) values ($1, $2, $3, $4) returning id",
      [workspaceId, brandId, topicId, "integration-v1"],
    );
    const outputIds = new Map();
    const queueIds = [];

    for (const fixture of queueFixtures) {
      const outputValues = [
        workspaceId,
        brandId,
        topicId,
        draft.rows[0].id,
        fixture.channel,
        `${title} ${fixture.channel}`,
      ];
      const output = deliveryFormatRequired
        ? await database.query(
            "insert into channel_outputs (workspace_id, brand_id, content_topic_id, master_draft_id, channel, status, title, delivery_format) values ($1, $2, $3, $4, $5, 'approved', $6, $7) returning id",
            [
              ...outputValues,
              fixture.channel === "instagram"
                ? "instagram_feed_carousel"
                : "threads_text",
            ],
          )
        : await database.query(
            "insert into channel_outputs (workspace_id, brand_id, content_topic_id, master_draft_id, channel, status, title) values ($1, $2, $3, $4, $5, 'approved', $6) returning id",
            outputValues,
      );
      outputIds.set(fixture.channel, output.rows[0].id);
      const queueValues = [
        workspaceId,
        brandId,
        output.rows[0].id,
        brandChannels.get(fixture.channel),
        fixture.channel,
        fixture.status ?? "scheduled",
        fixture.slotDate,
        fixture.slotNumber,
        fixture.scheduledFor,
        fixture.queuedAt,
        `${title}-${fixture.channel}-${randomUUID()}`,
      ];
      const queue = topicPublishGroupRequired
        ? await database.query(
            "insert into publish_queue (workspace_id, brand_id, channel_output_id, brand_channel_id, channel, status, approval_type, slot_date, slot_number, scheduled_for, queued_at, idempotency_key, topic_publish_group_id) values ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9, $10, $11, $12) returning id",
            [...queueValues, topicPublishGroupId],
          )
        : await database.query(
            "insert into publish_queue (workspace_id, brand_id, channel_output_id, brand_channel_id, channel, status, approval_type, slot_date, slot_number, scheduled_for, queued_at, idempotency_key) values ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9, $10, $11) returning id",
            queueValues,
          );
      queueIds.push(queue.rows[0].id);
      if (fixture.createPublishAttempt) {
        await database.query(
          "insert into publish_attempts (workspace_id, brand_id, publish_queue_id, attempt_number, status) values ($1, $2, $3, 1, 'succeeded')",
          [workspaceId, brandId, queue.rows[0].id],
        );
      }
    }

    return { topicId, outputIds, queueIds };
  };

  const primary = await createTopic("Primary topic", [
    {
      channel: "instagram",
      slotDate: "2026-02-02",
      slotNumber: 4,
      scheduledFor: "2026-01-01T00:00:00.000Z",
      queuedAt: "2026-01-03T00:00:00.000Z",
    },
    {
      channel: "threads",
      slotDate: "2026-01-01",
      slotNumber: 1,
      scheduledFor: "2026-01-02T00:00:00.000Z",
      queuedAt: "2026-01-02T00:00:00.000Z",
    },
  ]);
  await createTopic("Duplicate topic", [
    {
      channel: "instagram",
      status: "published",
      slotDate: "2026-01-15",
      slotNumber: 2,
      scheduledFor: "2025-12-31T00:00:00.000Z",
      queuedAt: "2026-01-03T00:00:00.000Z",
      createPublishAttempt: true,
    },
    {
      channel: "threads",
      slotDate: "2026-02-02",
      slotNumber: 4,
      scheduledFor: "2026-01-05T00:00:00.000Z",
      queuedAt: "2026-01-04T00:00:00.000Z",
    },
  ]);

  const jobsTypeConstraint = await database.query(`
    select pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'jobs'::regclass
      and conname = 'jobs_type_check'
  `);
  const instagramRenderJobType = jobsTypeConstraint.rows[0]?.definition.includes(
    "'instagram_feed_render'",
  )
    ? "instagram_feed_render"
    : "instagram_render";
  await database.query(
    "insert into jobs (workspace_id, brand_id, channel_output_id, job_type) values ($1, $2, $3, $4)",
    [
      workspaceId,
      brandId,
      primary.outputIds.get("instagram"),
      instagramRenderJobType,
    ],
  );
  await database.query(
    "insert into storage_artifacts (workspace_id, brand_id, artifact_type, bucket, path) values ($1, $2, 'rendered_image', $3, $4)",
    [
      workspaceId,
      brandId,
      "migration-test",
      `rendered/${randomUUID()}.png`,
    ],
  );

  return {
    workspaceId,
    brandId,
    channelOutputId: primary.outputIds.get("instagram"),
    publishQueueId: primary.queueIds[0],
  };
};

const readConstraintValues = async (database, table, constraint) => {
  const result = await database.query(
    "select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = to_regclass($1) and conname = $2",
    [table, constraint],
  );
  assert.equal(result.rows.length, 1);
  return [...result.rows[0].definition.matchAll(/'([^']+)'::text/g)]
    .map((match) => match[1])
    .sort();
};

const readSnapshot = async (database, brandId) => {
  const brandFormats = await database.query(
    "select format, enabled, rotation_order, capability_status from brand_content_formats where brand_id = $1 order by rotation_order",
    [brandId],
  );
  const rotationState = await database.query(
    "select count(*)::int as count, count(*) filter (where last_selected_format is null)::int as null_count from brand_format_rotation_states where brand_id = $1",
    [brandId],
  );
  const selectedFormatColumn = await database.query(
    "select count(*)::int as count from information_schema.columns where table_name = 'content_topics' and column_name = 'selected_instagram_format'",
  );
  const groups = await database.query(
    `select
       topics.title,
       groups.status,
       to_char(groups.slot_date, 'YYYY-MM-DD') as slot_date,
       groups.slot_number,
       to_char(groups.scheduled_for at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as scheduled_for
     from topic_publish_groups groups
     join content_topics topics on topics.id = groups.content_topic_id
     order by topics.title`,
  );
  const queueLinks = await database.query(
    "select count(*)::int as queue_count, count(topic_publish_group_id)::int as linked_count, count(distinct topic_publish_group_id)::int as group_count from publish_queue",
  );
  const jobRows = await database.query(
    "select job_type, count(*)::int as count from jobs group by job_type order by job_type",
  );
  const renderIndexes = await database.query(
    `select
       index_class.relname as name,
       index_data.indisunique as is_unique,
       regexp_replace(pg_get_expr(index_data.indpred, index_data.indrelid), '\\s+', ' ', 'g') as predicate
     from pg_index index_data
     join pg_class index_class on index_class.oid = index_data.indexrelid
     where index_data.indrelid = 'jobs'::regclass
       and index_class.relname in (
         'jobs_render_output_idx',
         'jobs_active_render_output_unique',
         'jobs_threads_text_render_output_idx',
         'jobs_active_threads_text_render_output_unique'
       )
     order by index_class.relname`,
  );
  const artifactRows = await database.query(
    "select artifact_type, count(*)::int as count from storage_artifacts group by artifact_type order by artifact_type",
  );
  const attemptRows = await database.query(
    "select count(*)::int as count from publish_attempts",
  );

  return {
    deliveryConstraint: await readConstraintValues(
      database,
      "channel_outputs",
      "channel_outputs_delivery_format_check",
    ),
    brandFormats: brandFormats.rows,
    rotationState: rotationState.rows[0],
    selectedFormatColumn: selectedFormatColumn.rows[0],
    selectedFormatConstraint: await readConstraintValues(
      database,
      "content_topics",
      "content_topics_selected_instagram_format_check",
    ),
    groups: groups.rows,
    queueLinks: queueLinks.rows[0],
    jobsConstraint: await readConstraintValues(database, "jobs", "jobs_type_check"),
    jobRows: jobRows.rows,
    renderIndexes: renderIndexes.rows,
    artifactsConstraint: await readConstraintValues(
      database,
      "storage_artifacts",
      "storage_artifacts_type_check",
    ),
    artifactRows: artifactRows.rows,
    attemptRows: attemptRows.rows[0],
  };
};

const readGroupUpdatedAt = async (database) => {
  const result = await database.query(
    `select topics.title, groups.updated_at::text as updated_at
     from topic_publish_groups groups
     join content_topics topics on topics.id = groups.content_topic_id
     order by topics.title`,
  );
  return result.rows;
};

test("fresh and authentic legacy paths converge after migration 019", async (context) => {
  const migrations = await loadMigrations();
  let freshSnapshot;

  await context.test("fresh path executes migrations 001-019", async () => {
    freshSnapshot = await withDatabase(async (database) => {
      await runMigrationRange(
        database,
        migrations,
        "001_initial_schema.sql",
        "013_automation_runs.sql",
      );
      const fixture = await insertPublishingFixture(database);
      await runMigrationRange(
        database,
        migrations,
        "014_instagram_delivery_formats.sql",
        "019_threads_text_render_jobs.sql",
      );
      const snapshot = await readSnapshot(database, fixture.brandId);
      const migration017 = migrations.find(
        (migration) => migration.id === "017_preserve_topic_publish_group_status.sql",
      );
      if (migration017) {
        const updatedAtBefore = await readGroupUpdatedAt(database);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await database.exec(migration017.sql);
        assert.deepEqual(await readGroupUpdatedAt(database), updatedAtBefore);
        assert.deepEqual(await readSnapshot(database, fixture.brandId), snapshot);
      }
      return snapshot;
    });
  });

  await context.test(
    "legacy path executes the authentic 014 fixture followed by 015 through 019",
    async () => {
      const legacySnapshot = await withDatabase(async (database) => {
        await runMigrationRange(
          database,
          migrations,
          "001_initial_schema.sql",
          "013_automation_runs.sql",
        );
        const fixture = await insertPublishingFixture(database);
        await database.exec(legacyInstagramDeliverySql);
        await runMigrationRange(
          database,
          migrations,
          "015_delivery_format_legacy_channels.sql",
          "019_threads_text_render_jobs.sql",
        );
        return readSnapshot(database, fixture.brandId);
      });

      assert.deepEqual(legacySnapshot, freshSnapshot);
    },
  );

  assert.deepEqual(freshSnapshot.groups, [
    {
      title: "Duplicate topic",
      status: "partially_published",
      slot_date: null,
      slot_number: null,
      scheduled_for: null,
    },
    {
      title: "Primary topic",
      status: "scheduled",
      slot_date: "2026-02-02",
      slot_number: 4,
      scheduled_for: "2026-01-01T00:00:00Z",
    },
  ]);
  assert.deepEqual(freshSnapshot.queueLinks, {
    queue_count: 4,
    linked_count: 4,
    group_count: 2,
  });
  assert.deepEqual(freshSnapshot.attemptRows, { count: 1 });
  assert.ok(freshSnapshot.jobsConstraint.includes("threads_text_render"));
  assert.ok(freshSnapshot.renderIndexes.some(({ name }) => name === "jobs_threads_text_render_output_idx"));
  assert.ok(freshSnapshot.renderIndexes.some(({ name, is_unique }) => (
    name === "jobs_active_threads_text_render_output_unique" && is_unique
  )));
});

test("DM Wiki core migration runs in PGlite and pgvector migration is explicitly deferred", async () => {
  const migrations = await loadMigrations();
  const coreMigration = migrations.find((migration) => migration.id === "020_dm_wiki_core.sql");
  const vectorMigration = migrations.find((migration) => migration.id === "021_dm_wiki_pgvector.sql");
  const instagramLoginMigration = migrations.find((migration) => migration.id === "022_instagram_login_auth_mode.sql");

  assert.ok(coreMigration);
  assert.ok(vectorMigration);
  assert.ok(instagramLoginMigration);
  assert.match(vectorMigration.sql, /^-- requires: pgvector/);
  assert.match(vectorMigration.sql, /vector\(1536\)/);
  assert.match(vectorMigration.sql, /using hnsw/);
  assert.match(vectorMigration.sql, /search_brand_wiki/);

  await withDatabase(async (database) => {
    await runMigrationRange(database, migrations, "001_initial_schema.sql", "022_instagram_login_auth_mode.sql");
    const tables = await database.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('knowledge_imports', 'knowledge_entries', 'wiki_documents', 'wiki_chunks', 'instagram_dm_settings', 'instagram_dm_conversations', 'instagram_dm_messages', 'unanswered_questions', 'worker_instances') order by table_name",
    );
    assert.equal(tables.rows.length, 9);
    const jobsConstraint = await readConstraintValues(database, "jobs", "jobs_type_check");
    assert.ok(jobsConstraint.includes("wiki_refresh"));
    assert.ok(jobsConstraint.includes("instagram_dm_reply"));
    const authMode = await database.query("select column_name from information_schema.columns where table_name = 'channel_credentials' and column_name = 'auth_mode'");
    assert.equal(authMode.rows.length, 1);
  });
});

test("brand profile logo migration adds nullable storage columns and remains idempotent", async () => {
  const migrations = await loadMigrations();
  const initialMigration = migrations.find((migration) => migration.id === "001_initial_schema.sql");
  const logoMigration = migrations.find((migration) => migration.id === "028_brand_profile_logo.sql");

  assert.ok(initialMigration);
  assert.ok(logoMigration);

  await withDatabase(async (database) => {
    await database.exec(initialMigration.sql);
    await database.exec(logoMigration.sql);
    await database.exec(logoMigration.sql);

    const columns = await database.query(
      `select column_name, is_nullable
       from information_schema.columns
       where table_name = 'brand_profiles'
         and column_name in ('logo_url', 'logo_storage_path')
       order by column_name`,
    );
    assert.deepEqual(columns.rows, [
      { column_name: "logo_storage_path", is_nullable: "YES" },
      { column_name: "logo_url", is_nullable: "YES" },
    ]);
  });
});

test("029-031 migrations satisfy the expanded schema smoke contract", async () => {
  const migrations = await loadMigrations();
  const migration029 = migrations.find(
    (migration) => migration.id === "029_instagram_hashtag_trends.sql",
  );
  const migration030 = migrations.find(
    (migration) => migration.id === "030_multichannel_foundation.sql",
  );
  const migration031 = migrations.find(
    (migration) => migration.id === "031_content_performance_dashboard.sql",
  );

  assert.ok(migration029, "missing migration 029_instagram_hashtag_trends.sql");
  assert.ok(migration030, "missing migration 030_multichannel_foundation.sql");
  assert.ok(migration031, "missing migration 031_content_performance_dashboard.sql");

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "028_brand_profile_logo.sql",
    );

    const legacyProfiles = [];
    for (const industry of ["금융 및 보험업", "서비스", "여행 서비스"]) {
      const workspace = await database.query(
        "insert into workspaces (name, slug) values ($1, $2) returning id",
        [`Legacy ${industry}`, `legacy-${randomUUID()}`],
      );
      const brand = await database.query(
        "insert into brands (workspace_id, name) values ($1, $2) returning id",
        [workspace.rows[0].id, `Legacy ${industry}`],
      );
      const profile = await database.query(
        "insert into brand_profiles (workspace_id, brand_id, industry) values ($1, $2, $3) returning id",
        [workspace.rows[0].id, brand.rows[0].id, industry],
      );
      legacyProfiles.push({ id: profile.rows[0].id, industry });
    }

    await database.exec(migration029.sql);

    const counts = await database.query(`
      select
        (select count(*)::int from content_categories where active) as categories,
        (select count(*)::int from content_subcategories where active) as subcategories,
        (select count(*)::int from content_category_hashtags where active) as hashtags
    `);
    assert.deepEqual(counts.rows[0], {
      categories: 15,
      subcategories: 105,
      hashtags: 45,
    });

    const invalidSeedDistribution = await database.query(`
      select category.code
      from content_categories category
      left join content_subcategories subcategory
        on subcategory.category_id = category.id and subcategory.active
      left join content_category_hashtags hashtag
        on hashtag.category_id = category.id and hashtag.active
      where category.active
      group by category.code
      having count(distinct subcategory.id) <> 7
        or count(distinct hashtag.id) <> 3
    `);
    assert.deepEqual(invalidSeedDistribution.rows, []);

    const columns = await database.query(`
      select column_name
      from information_schema.columns
      where table_name = 'brand_profiles'
        and column_name in ('industry', 'primary_category_id')
      order by column_name
    `);
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      ["industry", "primary_category_id"],
    );

    const expectedTables = [
      "brand_profile_subcategories",
      "brand_trend_saved_media",
      "brand_trend_searches",
      "content_categories",
      "content_category_hashtags",
      "content_subcategories",
      "instagram_trend_account_hashtags",
      "instagram_trend_hashtag_media",
      "instagram_trend_hashtags",
      "instagram_trend_media",
    ];
    const tables = await database.query(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name = any($1::text[])
       order by table_name`,
      [expectedTables],
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      expectedTables,
    );

    const expectedIndexes = [
      "brand_profile_subcategories_brand_idx",
      "brand_profile_subcategories_custom_unique",
      "brand_profile_subcategories_system_unique",
      "brand_trend_saved_media_brand_idx",
      "brand_trend_searches_brand_searched_idx",
      "content_category_hashtags_unique",
      "instagram_trend_account_hashtags_channel_quota_idx",
    ];
    const indexes = await database.query(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and indexname = any($1::text[])
       order by indexname`,
      [expectedIndexes],
    );
    assert.deepEqual(
      indexes.rows.map((row) => row.indexname),
      expectedIndexes,
    );

    const expectedConstraints = [
      "brand_channels_tenant_identity_unique",
      "brand_profile_subcategories_custom_name_check",
      "brand_profile_subcategories_mode_check",
      "brand_profile_subcategories_profile_owner_fkey",
      "brand_profiles_tenant_identity_unique",
      "brand_trend_saved_media_brand_id_trend_media_id_key",
      "brand_trend_saved_media_source_owner_fkey",
      "brand_trend_saved_media_source_url_id_key",
      "brand_trend_searches_brand_id_hashtag_id_key",
      "brand_trend_searches_brand_owner_fkey",
      "brand_trend_searches_search_count_check",
      "brands_tenant_identity_unique",
      "content_categories_code_key",
      "content_subcategories_category_id_code_key",
      "instagram_trend_account_hashtags_channel_hashtag_unique",
      "instagram_trend_account_hashtags_channel_owner_fkey",
      "instagram_trend_hashtag_media_hashtag_id_meta_rank_key",
      "instagram_trend_hashtag_media_meta_rank_check",
      "instagram_trend_hashtag_media_pkey",
      "instagram_trend_hashtags_normalized_tag_key",
      "instagram_trend_media_comments_count_check",
      "instagram_trend_media_instagram_media_id_key",
      "instagram_trend_media_like_count_check",
      "instagram_trend_media_media_type_check",
      "instagram_trend_media_raw_metadata_object_check",
      "source_urls_tenant_identity_unique",
    ];
    const constraints = await database.query(
      `select conname
       from pg_constraint
       where conname = any($1::text[])
       order by conname`,
      [expectedConstraints],
    );
    assert.deepEqual(
      constraints.rows.map((row) => row.conname),
      expectedConstraints,
    );

    const backfill = await database.query(
      `select profile.industry, category.code as category_code
       from brand_profiles profile
       left join content_categories category on category.id = profile.primary_category_id
       where profile.id = any($1::uuid[])
       order by profile.industry`,
      [legacyProfiles.map((profile) => profile.id)],
    );
    assert.deepEqual(backfill.rows, [
      { industry: "금융 및 보험업", category_code: "finance_insurance" },
      { industry: "서비스", category_code: null },
      { industry: "여행 서비스", category_code: null },
    ]);

    const fixture = await database.query(`
      with workspace as (
        insert into workspaces (name, slug)
        values ('Trend Test', 'trend-test-${randomUUID()}')
        returning id
      ), brand as (
        insert into brands (workspace_id, name)
        select id, 'Trend Test' from workspace
        returning id, workspace_id
      ), profile as (
        insert into brand_profiles (workspace_id, brand_id)
        select workspace_id, id from brand
        returning id, workspace_id, brand_id
      )
      select profile.id as profile_id,
             profile.workspace_id,
             profile.brand_id,
             subcategory.id as subcategory_id
      from profile
      cross join content_subcategories subcategory
      order by subcategory.sort_order, subcategory.id
      limit 1
    `);
    const fixtureRow = fixture.rows[0];

    const otherWorkspace = await database.query(
      "insert into workspaces (name, slug) values ('Other Tenant', $1) returning id",
      [`other-tenant-${randomUUID()}`],
    );
    const otherBrand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Other Brand') returning id",
      [otherWorkspace.rows[0].id],
    );
    const otherProfile = await database.query(
      `insert into brand_profiles (workspace_id, brand_id)
       values ($1, $2) returning id`,
      [otherWorkspace.rows[0].id, otherBrand.rows[0].id],
    );
    const otherChannel = await database.query(
      `insert into brand_channels (workspace_id, brand_id, channel)
       values ($1, $2, 'instagram') returning id`,
      [otherWorkspace.rows[0].id, otherBrand.rows[0].id],
    );
    const otherSource = await database.query(
      `insert into source_urls
         (workspace_id, brand_id, source_type, url, url_hash)
       values ($1, $2, 'reference', $3, $4) returning id`,
      [
        otherWorkspace.rows[0].id,
        otherBrand.rows[0].id,
        `https://example.com/${randomUUID()}`,
        randomUUID(),
      ],
    );

    await assert.rejects(
      database.query(
        `insert into brand_profile_subcategories
           (workspace_id, brand_id, brand_profile_id, subcategory_id)
         values ($1, $2, $3, $4)`,
        [
          fixtureRow.workspace_id,
          fixtureRow.brand_id,
          otherProfile.rows[0].id,
          fixtureRow.subcategory_id,
        ],
      ),
      /brand_profile_subcategories_profile_owner_fkey/,
    );

    await database.query(
      `insert into brand_profile_subcategories
         (workspace_id, brand_id, brand_profile_id, subcategory_id)
       values ($1, $2, $3, $4)`,
      [
        fixtureRow.workspace_id,
        fixtureRow.brand_id,
        fixtureRow.profile_id,
        fixtureRow.subcategory_id,
      ],
    );
    await database.query(
      `insert into brand_profile_subcategories
         (workspace_id, brand_id, brand_profile_id, custom_name, custom_key)
       values ($1, $2, $3, '직접 입력', '직접 입력')`,
      [fixtureRow.workspace_id, fixtureRow.brand_id, fixtureRow.profile_id],
    );

    await assert.rejects(
      database.query(
        `insert into brand_profile_subcategories
           (workspace_id, brand_id, brand_profile_id, subcategory_id, custom_name, custom_key)
         values ($1, $2, $3, $4, '잘못된 입력', '잘못된 입력')`,
        [
          fixtureRow.workspace_id,
          fixtureRow.brand_id,
          fixtureRow.profile_id,
          fixtureRow.subcategory_id,
        ],
      ),
      /brand_profile_subcategories_mode_check/,
    );
    await assert.rejects(
      database.query(
        `insert into brand_profile_subcategories
           (workspace_id, brand_id, brand_profile_id)
         values ($1, $2, $3)`,
        [fixtureRow.workspace_id, fixtureRow.brand_id, fixtureRow.profile_id],
      ),
      /brand_profile_subcategories_mode_check/,
    );
    await assert.rejects(
      database.query(
        `insert into brand_profile_subcategories
           (workspace_id, brand_id, brand_profile_id, custom_name, custom_key)
         values ($1, $2, $3, '   ', 'blank')`,
        [fixtureRow.workspace_id, fixtureRow.brand_id, fixtureRow.profile_id],
      ),
      /brand_profile_subcategories_custom_name_check/,
    );
    await assert.rejects(
      database.query(
        `insert into brand_profile_subcategories
           (workspace_id, brand_id, brand_profile_id, custom_name, custom_key)
         values ($1, $2, $3, $4, 'too-long')`,
        [
          fixtureRow.workspace_id,
          fixtureRow.brand_id,
          fixtureRow.profile_id,
          "x".repeat(31),
        ],
      ),
      /brand_profile_subcategories_custom_name_check/,
    );

    const hashtag = await database.query(
      `insert into instagram_trend_hashtags (normalized_tag, display_tag)
       values ('trendtest', 'trendtest') returning id`,
    );
    const firstMedia = await database.query(
      `insert into instagram_trend_media
         (instagram_media_id, media_type, permalink, last_fetched_at)
       values ('meta-media-1', 'IMAGE', 'https://instagram.com/p/1', now())
       returning id`,
    );
    await assert.rejects(
      database.query(
        `insert into brand_trend_searches
           (workspace_id, brand_id, hashtag_id, last_searched_at)
         values ($1, $2, $3, now())`,
        [
          fixtureRow.workspace_id,
          otherBrand.rows[0].id,
          hashtag.rows[0].id,
        ],
      ),
      /brand_trend_searches_brand_owner_fkey/,
    );
    await assert.rejects(
      database.query(
        `insert into instagram_trend_account_hashtags
           (workspace_id, brand_id, brand_channel_id, hashtag_id,
            quota_window_started_at, last_meta_queried_at)
         values ($1, $2, $3, $4, now(), now())`,
        [
          fixtureRow.workspace_id,
          fixtureRow.brand_id,
          otherChannel.rows[0].id,
          hashtag.rows[0].id,
        ],
      ),
      /instagram_trend_account_hashtags_channel_owner_fkey/,
    );
    await assert.rejects(
      database.query(
        `insert into brand_trend_saved_media
           (workspace_id, brand_id, trend_media_id, source_url_id)
         values ($1, $2, $3, $4)`,
        [
          fixtureRow.workspace_id,
          fixtureRow.brand_id,
          firstMedia.rows[0].id,
          otherSource.rows[0].id,
        ],
      ),
      /brand_trend_saved_media_source_owner_fkey/,
    );
    await assert.rejects(
      database.query(
        `insert into instagram_trend_media
           (instagram_media_id, media_type, permalink, last_fetched_at)
         values ('meta-invalid-type', 'STORY', 'https://instagram.com/p/type', now())`,
      ),
      /instagram_trend_media_media_type_check/,
    );
    await assert.rejects(
      database.query(
        `insert into instagram_trend_media
           (instagram_media_id, media_type, permalink, like_count, last_fetched_at)
         values ('meta-negative-likes', 'IMAGE', 'https://instagram.com/p/likes', -1, now())`,
      ),
      /instagram_trend_media_like_count_check/,
    );
    await assert.rejects(
      database.query(
        `insert into instagram_trend_media
           (instagram_media_id, media_type, permalink, comments_count, last_fetched_at)
         values ('meta-negative-comments', 'IMAGE', 'https://instagram.com/p/comments', -1, now())`,
      ),
      /instagram_trend_media_comments_count_check/,
    );
    await assert.rejects(
      database.query(
        `insert into instagram_trend_media
           (instagram_media_id, media_type, permalink, last_fetched_at)
         values ('meta-media-1', 'VIDEO', 'https://instagram.com/p/duplicate', now())`,
      ),
      /instagram_trend_media_instagram_media_id_key/,
    );

    const secondMedia = await database.query(
      `insert into instagram_trend_media
         (instagram_media_id, media_type, permalink, last_fetched_at)
       values ('meta-media-2', 'VIDEO', 'https://instagram.com/p/2', now())
       returning id`,
    );
    await database.query(
      `insert into instagram_trend_hashtag_media
         (hashtag_id, media_id, meta_rank, first_seen_at, last_seen_at)
       values ($1, $2, 1, now(), now())`,
      [hashtag.rows[0].id, firstMedia.rows[0].id],
    );
    await assert.rejects(
      database.query(
        `insert into instagram_trend_hashtag_media
           (hashtag_id, media_id, meta_rank, first_seen_at, last_seen_at)
         values ($1, $2, 1, now(), now())`,
        [hashtag.rows[0].id, secondMedia.rows[0].id],
      ),
      /instagram_trend_hashtag_media_hashtag_id_meta_rank_key/,
    );
    for (const invalidRank of [0, 51]) {
      await assert.rejects(
        database.query(
          `insert into instagram_trend_hashtag_media
             (hashtag_id, media_id, meta_rank, first_seen_at, last_seen_at)
           values ($1, $2, $3, now(), now())`,
          [hashtag.rows[0].id, secondMedia.rows[0].id, invalidRank],
        ),
        /instagram_trend_hashtag_media_meta_rank_check/,
      );
    }

    for (const invalidSearchCount of [0, -1]) {
      await assert.rejects(
        database.query(
          `insert into brand_trend_searches
             (workspace_id, brand_id, hashtag_id, last_searched_at, search_count)
           values ($1, $2, $3, now(), $4)`,
          [
            fixtureRow.workspace_id,
            fixtureRow.brand_id,
            hashtag.rows[0].id,
            invalidSearchCount,
          ],
        ),
        /brand_trend_searches_search_count_check/,
      );
    }

    await database.exec(migration030.sql);
    await database.exec(migration030.sql);
    await database.exec(migration031.sql);

    const schemaSmokeSql = await readFile("db/smoke/001_schema_smoke.sql", "utf8");
    for (const constraint of [
      "instagram_trend_media_like_count_check",
      "instagram_trend_media_comments_count_check",
      "instagram_trend_hashtag_media_meta_rank_check",
      "brand_trend_searches_search_count_check",
      "instagram_trend_media_media_type_check",
      "brand_profile_subcategories_custom_name_check",
    ]) {
      assert.match(schemaSmokeSql, new RegExp(`'${constraint}'`));
    }
    await database.exec(schemaSmokeSql);
  });
});

test("031 creates the content performance dashboard schema", async () => {
  const migrations = await loadMigrations();
  const migration031 = migrations.find(
    (migration) => migration.id === "031_content_performance_dashboard.sql",
  );

  assert.ok(migration031, "missing migration 031_content_performance_dashboard.sql");
  assert.match(migration031.sql, /create table content_performance_snapshots/i);
  assert.match(migration031.sql, /unique\s*\(publish_queue_id, snapshot_date\)/i);
  assert.match(migration031.sql, /create table performance_sync_runs/i);
  assert.match(migration031.sql, /unique\s*\(brand_id, channel, run_date\)/i);
  assert.match(migration031.sql, /channel_outputs_performance_identity_unique/i);
  assert.match(migration031.sql, /publish_queue_performance_identity_unique/i);
  assert.match(migration031.sql, /content_performance_snapshots_publish_queue_owner_fkey/i);
  assert.match(migration031.sql, /content_performance_snapshots_channel_output_owner_fkey/i);
  assert.match(migration031.sql, /brand_id uuid not null references brands\(id\)/i);
  assert.doesNotMatch(migration031.sql, /performance_sync_runs_brand_owner_fkey/i);

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "031_content_performance_dashboard.sql",
    );

    const tables = await database.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('content_performance_snapshots', 'performance_sync_runs')
      order by table_name
    `);
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      ["content_performance_snapshots", "performance_sync_runs"],
    );

    const columns = await database.query(`
      select table_name, column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('content_performance_snapshots', 'performance_sync_runs')
      order by table_name, column_name
    `);
    assert.deepEqual(columns.rows, [
      { table_name: "content_performance_snapshots", column_name: "brand_id", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "channel", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "channel_output_id", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "collected_at", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "created_at", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "exposure_count", is_nullable: "YES" },
      { table_name: "content_performance_snapshots", column_name: "external_post_id", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "id", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "publish_queue_id", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "raw_metrics", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "snapshot_date", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "updated_at", is_nullable: "NO" },
      { table_name: "content_performance_snapshots", column_name: "workspace_id", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "brand_id", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "channel", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "completed_at", is_nullable: "YES" },
      { table_name: "performance_sync_runs", column_name: "created_at", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "error_summary", is_nullable: "YES" },
      { table_name: "performance_sync_runs", column_name: "failure_count", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "id", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "run_date", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "started_at", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "status", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "success_count", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "target_count", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "updated_at", is_nullable: "NO" },
      { table_name: "performance_sync_runs", column_name: "workspace_id", is_nullable: "NO" },
    ]);

    const indexColumns = await database.query(`
      select array_agg(attribute.attname::text order by key.ordinality) as columns
      from pg_class index_class
      join pg_index index_data on index_data.indexrelid = index_class.oid
      cross join lateral unnest(index_data.indkey) with ordinality as key(attnum, ordinality)
      join pg_attribute attribute
        on attribute.attrelid = index_data.indrelid
       and attribute.attnum = key.attnum
      where index_class.relname = 'content_performance_brand_channel_date_idx'
      group by index_class.oid
    `);
    assert.deepEqual(indexColumns.rows, [
      { columns: ["brand_id", "channel", "snapshot_date"] },
    ]);

    assert.deepEqual(
      await readConstraintValues(
        database,
        "content_performance_snapshots",
        "content_performance_snapshots_channel_check",
      ),
      ["instagram", "linkedin", "threads", "tiktok", "webflow", "x", "youtube"],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "performance_sync_runs",
        "performance_sync_runs_channel_check",
      ),
      ["instagram", "linkedin", "threads", "tiktok", "webflow", "x", "youtube"],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "performance_sync_runs",
        "performance_sync_runs_status_check",
      ),
      ["completed", "failed", "not_configured", "partially_failed", "running"],
    );

    const exposureConstraint = await database.query(
      "select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'content_performance_snapshots'::regclass and conname = 'content_performance_snapshots_exposure_count_check'",
    );
    assert.equal(exposureConstraint.rows.length, 1);
    assert.match(exposureConstraint.rows[0].definition, /exposure_count >= 0/);

    const ownershipConstraints = await database.query(`
      select conname
      from pg_constraint
      where conname in (
        'channel_outputs_performance_identity_unique',
        'publish_queue_performance_identity_unique',
        'content_performance_snapshots_publish_queue_owner_fkey',
        'content_performance_snapshots_channel_output_owner_fkey'
      )
      order by conname
    `);
    assert.deepEqual(
      ownershipConstraints.rows.map((row) => row.conname),
      [
        "channel_outputs_performance_identity_unique",
        "content_performance_snapshots_channel_output_owner_fkey",
        "content_performance_snapshots_publish_queue_owner_fkey",
        "publish_queue_performance_identity_unique",
      ],
    );

    const firstFixture = await insertPublishingFixture(database);
    const secondFixture = await insertPublishingFixture(database);

    await assert.rejects(
      database.query(
        `insert into content_performance_snapshots
           (workspace_id, brand_id, channel, publish_queue_id, channel_output_id,
            external_post_id, snapshot_date, raw_metrics, collected_at)
         values ($1, $2, 'instagram', $3, $4, 'cross-tenant', '2026-07-16', '{}', now())`,
        [
          firstFixture.workspaceId,
          firstFixture.brandId,
          secondFixture.publishQueueId,
          secondFixture.channelOutputId,
        ],
      ),
      /content_performance_snapshots_publish_queue_owner_fkey/,
    );

    await database.query(
      `update publish_queue
       set workspace_id = $1,
           brand_id = $2,
           brand_channel_id = (
             select id from brand_channels
             where brand_id = $2 and channel = 'instagram'
           )
       where id = $3`,
      [
        firstFixture.workspaceId,
        firstFixture.brandId,
        secondFixture.publishQueueId,
      ],
    );
    await assert.rejects(
      database.query(
        `insert into content_performance_snapshots
           (workspace_id, brand_id, channel, publish_queue_id, channel_output_id,
            external_post_id, snapshot_date, raw_metrics, collected_at)
         values ($1, $2, 'instagram', $3, $4, 'cross-output', '2026-07-16', '{}', now())`,
        [
          firstFixture.workspaceId,
          firstFixture.brandId,
          secondFixture.publishQueueId,
          secondFixture.channelOutputId,
        ],
      ),
      /content_performance_snapshots_channel_output_owner_fkey/,
    );

    await assert.rejects(
      database.query(
        `insert into performance_sync_runs
           (workspace_id, brand_id, channel, run_date, status,
            target_count, success_count, failure_count)
         values ($1, $2, 'instagram', '2026-07-16', 'completed', 2, 2, 1)`,
        [firstFixture.workspaceId, firstFixture.brandId],
      ),
      /performance_sync_runs_counts_check/,
    );
  });
});

test("029 remains inside the migration runner transaction", async () => {
  const migrations = await loadMigrations();
  const initialMigration = migrations.find(
    (migration) => migration.id === "001_initial_schema.sql",
  );
  const migration029 = migrations.find(
    (migration) => migration.id === "029_instagram_hashtag_trends.sql",
  );

  assert.ok(initialMigration);
  assert.ok(migration029);

  await withDatabase(async (database) => {
    await database.exec(initialMigration.sql);
    await database.exec("begin");
    await database.exec(migration029.sql);

    const insideTransaction = await database.query(
      "select to_regclass('public.content_categories')::text as relation",
    );
    assert.equal(insideTransaction.rows[0].relation, "content_categories");

    await database.exec("rollback");

    const afterRollback = await database.query(
      "select to_regclass('public.content_categories')::text as relation",
    );
    assert.equal(afterRollback.rows[0].relation, null);
  });

  assert.doesNotMatch(migration029.sql, /^\s*(?:begin|commit)\s*;/im);
});

test("032 creates the brand-scoped compiled Wiki core in PGlite", async () => {
  const migrations = await loadMigrations();
  const coreMigration = migrations.find(
    (migration) => migration.id === "032_compounding_wiki_core.sql",
  );
  const vectorMigration = migrations.find(
    (migration) => migration.id === "033_compounding_wiki_pgvector.sql",
  );

  assert.ok(coreMigration, "missing migration 032_compounding_wiki_core.sql");
  assert.ok(vectorMigration, "missing migration 033_compounding_wiki_pgvector.sql");
  assert.match(vectorMigration.sql, /^-- requires: pgvector/);
  assert.match(
    vectorMigration.sql,
    /jsonb_typeof\(section -> 'sourceUnitIds'\) <> 'array'/i,
  );
  assert.doesNotMatch(vectorMigration.sql, /section\.value/);
  assert.doesNotMatch(vectorMigration.sql, /chunk\.embedding is null/);

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "032_compounding_wiki_core.sql",
    );

    const tables = await database.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'wiki_build_requests', 'wiki_source_units', 'wiki_pages',
          'wiki_page_sources', 'wiki_page_links', 'wiki_page_chunks',
          'wiki_compilation_items', 'wiki_retrieval_runs',
          'wiki_maintenance_runs', 'wiki_issues'
        )
      order by table_name
    `);
    assert.equal(tables.rows.length, 10);

    const versionColumns = await database.query(`
      select column_name, is_nullable
      from information_schema.columns
      where table_name = 'wiki_versions'
        and column_name = 'build_stage'
    `);
    assert.deepEqual(versionColumns.rows, [
      { column_name: "build_stage", is_nullable: "YES" },
    ]);
    assert.deepEqual(
      await readConstraintValues(
        database,
        "wiki_versions",
        "wiki_versions_status_check",
      ),
      ["active", "building", "failed", "ready", "superseded"],
    );

    const chunkEmbedding = await database.query(`
      select column_name
      from information_schema.columns
      where table_name = 'wiki_page_chunks'
        and column_name = 'embedding'
    `);
    assert.equal(chunkEmbedding.rows.length, 0);

    const workspace = await database.query(
      "insert into workspaces (name, slug) values ('Compiled Wiki', $1) returning id",
      [`compiled-wiki-${randomUUID()}`],
    );
    const firstBrand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'First') returning id",
      [workspace.rows[0].id],
    );
    const secondBrand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Second') returning id",
      [workspace.rows[0].id],
    );
    const version = await database.query(
      `insert into wiki_versions (workspace_id, brand_id, status, build_stage)
       values ($1, $2, 'building', 'collecting') returning id`,
      [workspace.rows[0].id, firstBrand.rows[0].id],
    );

    await database.query(
      `insert into wiki_build_requests
         (workspace_id, brand_id, requested_revision, status, quiet_until)
       values ($1, $2, 1, 'pending', now())`,
      [workspace.rows[0].id, firstBrand.rows[0].id],
    );
    await assert.rejects(
      database.query(
        `insert into wiki_build_requests
           (workspace_id, brand_id, requested_revision, status, quiet_until)
         values ($1, $2, 2, 'building', now())`,
        [workspace.rows[0].id, firstBrand.rows[0].id],
      ),
      /wiki_build_requests_brand_active_unique/,
    );

    await database.query(
      `insert into wiki_pages
         (workspace_id, brand_id, wiki_version_id, page_type, stable_key,
          title, content_json)
       values ($1, $2, $3, 'brand_overview', 'brand', 'Brand',
               '{"sections": []}')`,
      [workspace.rows[0].id, firstBrand.rows[0].id, version.rows[0].id],
    );
    await assert.rejects(
      database.query(
        `insert into wiki_pages
           (workspace_id, brand_id, wiki_version_id, page_type, stable_key,
            title, content_json)
         values ($1, $2, $3, 'brand_overview', 'brand', 'Duplicate',
                 '{"sections": []}')`,
        [workspace.rows[0].id, firstBrand.rows[0].id, version.rows[0].id],
      ),
      /wiki_pages_version_stable_key_unique/,
    );
    await assert.rejects(
      database.query(
        `insert into wiki_pages
           (workspace_id, brand_id, wiki_version_id, page_type, stable_key,
            title, content_json)
         values ($1, $2, $3, 'catalog', 'catalog', 'Wrong owner',
                 '{"sections": []}')`,
        [workspace.rows[0].id, secondBrand.rows[0].id, version.rows[0].id],
      ),
      /wiki_pages_version_ownership_fk/,
    );

    await assert.rejects(
      database.query(
        `insert into wiki_compilation_items
           (workspace_id, brand_id, wiki_version_id, item_type, stable_key,
            idempotency_key, status)
         values ($1, $2, $3, 'brand_core_pages', 'brand-core',
                 'version-1:brand-core', 'processing')`,
        [workspace.rows[0].id, firstBrand.rows[0].id, version.rows[0].id],
      ),
      /wiki_compilation_items_lease_check/,
    );
  });
});

test("036 hardens performance ownership and compiled Wiki activation", async () => {
  const migrations = await loadMigrations();
  const hardeningMigration = migrations.find(
    (migration) =>
      migration.id === "036_harden_performance_and_wiki_activation.sql",
  );

  assert.ok(
    hardeningMigration,
    "missing migration 036_harden_performance_and_wiki_activation.sql",
  );
  assert.match(
    hardeningMigration.sql,
    /drop constraint if exists performance_sync_runs_brand_id_fkey/i,
  );
  assert.match(
    hardeningMigration.sql,
    /foreign key \(brand_id, workspace_id\)\s+references brands\(id, workspace_id\)[\s\S]*not valid/i,
  );
  assert.match(
    hardeningMigration.sql,
    /validate constraint performance_sync_runs_brand_owner_fkey/i,
  );
  assert.match(
    hardeningMigration.sql,
    /jsonb_typeof\(section\.value\)\s+is distinct from 'object'/i,
  );
  assert.match(
    hardeningMigration.sql,
    /jsonb_typeof\(section\.value\s*->\s*'sourceUnitIds'\)\s+is distinct from 'array'/i,
  );
  assert.match(
    hardeningMigration.sql,
    /when\s+jsonb_array_length\(section\.value\s*->\s*'sourceUnitIds'\)\s*=\s*0\s+then true/i,
  );
  assert.match(
    hardeningMigration.sql,
    /from wiki_page_chunks chunk\s+where chunk\.wiki_version_id = p_wiki_version_id\s+and chunk\.enabled\s+and chunk\.embedding is null/i,
  );

  const activationStart = hardeningMigration.sql.indexOf(
    "create or replace function activate_compiled_wiki_version",
  );
  assert.ok(activationStart > 0);
  const ownershipSql = hardeningMigration.sql.slice(0, activationStart);

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "035_remove_webflow_and_split_content_status.sql",
    );

    const firstWorkspace = await database.query(
      "insert into workspaces (name, slug) values ('First Tenant', $1) returning id",
      [`first-tenant-${randomUUID()}`],
    );
    const firstBrand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'First Brand') returning id",
      [firstWorkspace.rows[0].id],
    );
    const secondWorkspace = await database.query(
      "insert into workspaces (name, slug) values ('Second Tenant', $1) returning id",
      [`second-tenant-${randomUUID()}`],
    );
    const secondBrand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Second Brand') returning id",
      [secondWorkspace.rows[0].id],
    );

    await database.exec("begin");
    await database.query(
      `insert into performance_sync_runs
         (workspace_id, brand_id, channel, run_date, status)
       values ($1, $2, 'instagram', '2026-07-17', 'running')`,
      [firstWorkspace.rows[0].id, secondBrand.rows[0].id],
    );
    await assert.rejects(
      database.exec(ownershipSql),
      /performance_sync_runs_brand_owner_fkey/,
    );
    await database.exec("rollback");

    await database.exec(ownershipSql);
    await database.exec(ownershipSql);

    await assert.rejects(
      database.query(
        `insert into performance_sync_runs
           (workspace_id, brand_id, channel, run_date, status)
         values ($1, $2, 'instagram', '2026-07-17', 'running')`,
        [firstWorkspace.rows[0].id, secondBrand.rows[0].id],
      ),
      /performance_sync_runs_brand_owner_fkey/,
    );
    await database.query(
      `insert into performance_sync_runs
         (workspace_id, brand_id, channel, run_date, status)
       values ($1, $2, 'instagram', '2026-07-17', 'running')`,
      [firstWorkspace.rows[0].id, firstBrand.rows[0].id],
    );
  });
});

test("034 creates expiring cross-process worker resource leases", async () => {
  const migrations = await loadMigrations();

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "034_worker_resource_limits.sql",
    );

    const table = await database.query(
      "select to_regclass('public.worker_resource_leases')::text as relation",
    );
    assert.equal(table.rows[0].relation, "worker_resource_leases");

    await database.query(
      `insert into worker_resource_leases
         (resource_type, workload_type, worker_id, expires_at)
       values ('codex_cli', 'dm', 'dm-worker-1', now() + interval '45 seconds')`,
    );
    await assert.rejects(
      database.query(
        `insert into worker_resource_leases
           (resource_type, workload_type, worker_id, expires_at)
         values ('codex_cli', 'dm', 'dm-worker-1', now() + interval '45 seconds')`,
      ),
      /worker_resource_leases_resource_type_worker_id_key/,
    );
    await assert.rejects(
      database.query(
        `insert into worker_resource_leases
           (resource_type, workload_type, worker_id, expires_at)
         values ('codex_cli', 'invalid', 'invalid-worker', now() + interval '45 seconds')`,
      ),
      /worker_resource_leases_workload_check/,
    );
  });
});

test("035 removes Webflow runtime data and separates pending generation state", async () => {
  const migrations = await loadMigrations();
  const migration035 = migrations.find(
    (migration) =>
      migration.id === "035_remove_webflow_and_split_content_status.sql",
  );

  assert.ok(
    migration035,
    "missing migration 035_remove_webflow_and_split_content_status.sql",
  );

  await withDatabase(async (database) => {
    await runMigrationRange(
      database,
      migrations,
      "001_initial_schema.sql",
      "034_worker_resource_limits.sql",
    );

    const workspace = await database.query(
      "insert into workspaces (name, slug) values ('Webflow Removal', $1) returning id",
      [`webflow-removal-${randomUUID()}`],
    );
    const workspaceId = workspace.rows[0].id;
    const brand = await database.query(
      "insert into brands (workspace_id, name) values ($1, 'Migration Brand') returning id",
      [workspaceId],
    );
    const brandId = brand.rows[0].id;
    const brandChannels = await database.query(
      `insert into brand_channels
         (workspace_id, brand_id, channel, status, account_label)
       values
         ($1, $2, 'instagram', 'connected', 'Instagram'),
         ($1, $2, 'webflow', 'connected', 'Webflow')
       returning id, channel`,
      [workspaceId, brandId],
    );
    const brandChannelIds = new Map(
      brandChannels.rows.map((row) => [row.channel, row.id]),
    );

    const credential = await database.query(
      `insert into channel_credentials
         (workspace_id, brand_id, brand_channel_id, provider, credential_type,
          encrypted_payload)
       values ($1, $2, $3, 'webflow', 'api_token', 'integration-fixture')
       returning id`,
      [workspaceId, brandId, brandChannelIds.get("webflow")],
    );
    const topic = await database.query(
      `insert into content_topics (workspace_id, brand_id, title, angle)
       values ($1, $2, 'Migration topic', 'Migration angle')
       returning id`,
      [workspaceId, brandId],
    );
    const topicId = topic.rows[0].id;
    const publishGroup = await database.query(
      `insert into topic_publish_groups
         (workspace_id, brand_id, content_topic_id)
       values ($1, $2, $3)
       returning id`,
      [workspaceId, brandId, topicId],
    );
    const draft = await database.query(
      `insert into master_drafts
         (workspace_id, brand_id, content_topic_id, prompt_version)
       values ($1, $2, $3, 'migration-035')
       returning id`,
      [workspaceId, brandId, topicId],
    );
    const draftId = draft.rows[0].id;
    const webflowOutput = await database.query(
      `insert into channel_outputs
         (workspace_id, brand_id, content_topic_id, master_draft_id, channel,
          status, title, delivery_format)
       values ($1, $2, $3, $4, 'webflow', 'approved', 'Webflow output',
               'webflow_article')
       returning id`,
      [workspaceId, brandId, topicId, draftId],
    );
    const webflowOutputId = webflowOutput.rows[0].id;
    const pendingInstagramOutput = await database.query(
      `insert into channel_outputs
         (workspace_id, brand_id, content_topic_id, master_draft_id, channel,
          status, title, delivery_format, output_json, block_reasons)
       values ($1, $2, $3, $4, 'instagram', 'auto_approval_blocked',
               'Pending Instagram output', 'instagram_feed_carousel',
               '{"generationState":"pending","artifactStatus":"pending"}',
               '["instagram_artifact_pending","policy_violation"]')
       returning id`,
      [workspaceId, brandId, topicId, draftId],
    );
    const pendingInstagramOutputId = pendingInstagramOutput.rows[0].id;

    const blockedTopic = await database.query(
      `insert into content_topics (workspace_id, brand_id, title, angle)
       values ($1, $2, 'Blocked topic', 'Blocked angle')
       returning id`,
      [workspaceId, brandId],
    );
    const blockedDraft = await database.query(
      `insert into master_drafts
         (workspace_id, brand_id, content_topic_id, prompt_version)
       values ($1, $2, $3, 'migration-035')
       returning id`,
      [workspaceId, brandId, blockedTopic.rows[0].id],
    );
    const blockedInstagramOutput = await database.query(
      `insert into channel_outputs
         (workspace_id, brand_id, content_topic_id, master_draft_id, channel,
          status, title, delivery_format, output_json, block_reasons)
       values ($1, $2, $3, $4, 'instagram', 'auto_approval_blocked',
               'Blocked Instagram output', 'instagram_feed_carousel',
               '{"generationState":"ready","artifactStatus":"ready"}',
               '["policy_violation"]')
       returning id`,
      [workspaceId, brandId, blockedTopic.rows[0].id, blockedDraft.rows[0].id],
    );

    const slot = await database.query(
      `insert into publish_slots
         (workspace_id, brand_id, channel, slot_number, base_time)
       values ($1, $2, 'webflow', 1, '09:00')
       returning id`,
      [workspaceId, brandId],
    );
    const queue = await database.query(
      `insert into publish_queue
         (workspace_id, brand_id, channel_output_id, brand_channel_id, channel,
          status, approval_type, queued_at, idempotency_key,
          topic_publish_group_id)
       values ($1, $2, $3, $4, 'webflow', 'published', 'manual', now(), $5, $6)
       returning id`,
      [
        workspaceId,
        brandId,
        webflowOutputId,
        brandChannelIds.get("webflow"),
        `webflow-${randomUUID()}`,
        publishGroup.rows[0].id,
      ],
    );
    const queueId = queue.rows[0].id;
    const attempt = await database.query(
      `insert into publish_attempts
         (workspace_id, brand_id, publish_queue_id, attempt_number, status)
       values ($1, $2, $3, 1, 'succeeded')
       returning id`,
      [workspaceId, brandId, queueId],
    );
    const job = await database.query(
      `insert into jobs
         (workspace_id, brand_id, channel_output_id, job_type, status)
       values ($1, $2, $3, 'channel_output_generate', 'succeeded')
       returning id`,
      [workspaceId, brandId, webflowOutputId],
    );
    const reviewEvent = await database.query(
      `insert into review_events
         (workspace_id, brand_id, channel_output_id, actor_type, event_type)
       values ($1, $2, $3, 'system', 'status_changed')
       returning id`,
      [workspaceId, brandId, webflowOutputId],
    );
    const snapshot = await database.query(
      `insert into content_performance_snapshots
         (workspace_id, brand_id, channel, publish_queue_id, channel_output_id,
          external_post_id, snapshot_date, exposure_count, collected_at)
       values ($1, $2, 'webflow', $3, $4, 'webflow-post', '2026-07-16', 10, now())
       returning id`,
      [workspaceId, brandId, queueId, webflowOutputId],
    );
    const syncRun = await database.query(
      `insert into performance_sync_runs
         (workspace_id, brand_id, channel, run_date, status, target_count,
          success_count, failure_count)
       values ($1, $2, 'webflow', '2026-07-16', 'completed', 1, 1, 0)
       returning id`,
      [workspaceId, brandId],
    );

    await database.exec(migration035.sql);
    await database.exec(migration035.sql);

    for (const [table, id] of [
      ["content_performance_snapshots", snapshot.rows[0].id],
      ["performance_sync_runs", syncRun.rows[0].id],
      ["publish_attempts", attempt.rows[0].id],
      ["publish_queue", queueId],
      ["publish_slots", slot.rows[0].id],
      ["jobs", job.rows[0].id],
      ["review_events", reviewEvent.rows[0].id],
      ["channel_outputs", webflowOutputId],
      ["channel_credentials", credential.rows[0].id],
      ["brand_channels", brandChannelIds.get("webflow")],
    ]) {
      const result = await database.query(
        `select count(*)::int as count from ${table} where id = $1`,
        [id],
      );
      assert.equal(result.rows[0].count, 0, `${table} Webflow row remains`);
    }

    const migratedPendingOutput = await database.query(
      `select status, block_reasons
       from channel_outputs
       where id = $1`,
      [pendingInstagramOutputId],
    );
    assert.deepEqual(migratedPendingOutput.rows, [
      { status: "generating", block_reasons: ["policy_violation"] },
    ]);
    const preservedBlockedOutput = await database.query(
      `select status, block_reasons
       from channel_outputs
       where id = $1`,
      [blockedInstagramOutput.rows[0].id],
    );
    assert.deepEqual(preservedBlockedOutput.rows, [
      {
        status: "auto_approval_blocked",
        block_reasons: ["policy_violation"],
      },
    ]);

    const defaultTopic = await database.query(
      `insert into content_topics (workspace_id, brand_id, title, angle)
       values ($1, $2, 'Default status topic', 'Default status angle')
       returning id`,
      [workspaceId, brandId],
    );
    const defaultDraft = await database.query(
      `insert into master_drafts
         (workspace_id, brand_id, content_topic_id, prompt_version)
       values ($1, $2, $3, 'migration-035')
       returning id`,
      [workspaceId, brandId, defaultTopic.rows[0].id],
    );
    const defaultOutput = await database.query(
      `insert into channel_outputs
         (workspace_id, brand_id, content_topic_id, master_draft_id, channel,
          title, delivery_format)
       values ($1, $2, $3, $4, 'instagram', 'Default status output',
               'instagram_feed_carousel')
       returning status`,
      [workspaceId, brandId, defaultTopic.rows[0].id, defaultDraft.rows[0].id],
    );
    assert.equal(defaultOutput.rows[0].status, "generating");

    const supportedChannels = [
      "instagram",
      "linkedin",
      "threads",
      "tiktok",
      "x",
      "youtube",
    ];
    for (const [table, constraint] of [
      ["brand_channels", "brand_channels_channel_check"],
      ["channel_outputs", "channel_outputs_channel_check"],
      ["publish_slots", "publish_slots_channel_check"],
      ["publish_queue", "publish_queue_channel_check"],
      [
        "content_performance_snapshots",
        "content_performance_snapshots_channel_check",
      ],
      ["performance_sync_runs", "performance_sync_runs_channel_check"],
    ]) {
      assert.deepEqual(
        await readConstraintValues(database, table, constraint),
        supportedChannels,
      );
    }
    assert.deepEqual(
      await readConstraintValues(
        database,
        "channel_credentials",
        "channel_credentials_provider_check",
      ),
      ["google", "linkedin", "meta", "tiktok", "x"],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "channel_outputs",
        "channel_outputs_delivery_format_check",
      ),
      [
        "instagram_feed_carousel",
        "instagram_reel",
        "instagram_story",
        "linkedin_post",
        "threads_text",
        "tiktok_video",
        "x_post",
        "youtube_short",
        "youtube_video",
      ],
    );
    assert.deepEqual(
      await readConstraintValues(
        database,
        "channel_outputs",
        "channel_outputs_status_check",
      ),
      [
        "approved",
        "auto_approval_blocked",
        "auto_approved",
        "generating",
        "generation_failed",
        "pending_review",
        "regenerated",
        "regenerating",
        "rejected",
      ],
    );

    await assert.rejects(
      database.query(
        `insert into brand_channels (workspace_id, brand_id, channel)
         values ($1, $2, 'webflow')`,
        [workspaceId, brandId],
      ),
      /brand_channels_channel_check/,
    );
  });
});
