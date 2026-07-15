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
    const draft = await database.query(
      "insert into master_drafts (workspace_id, brand_id, content_topic_id, prompt_version) values ($1, $2, $3, $4) returning id",
      [workspaceId, brandId, topicId, "integration-v1"],
    );
    const outputIds = new Map();
    const queueIds = [];

    for (const fixture of queueFixtures) {
      const output = await database.query(
        "insert into channel_outputs (workspace_id, brand_id, content_topic_id, master_draft_id, channel, status, title) values ($1, $2, $3, $4, $5, 'approved', $6) returning id",
        [
          workspaceId,
          brandId,
          topicId,
          draft.rows[0].id,
          fixture.channel,
          `${title} ${fixture.channel}`,
        ],
      );
      outputIds.set(fixture.channel, output.rows[0].id);
      const queue = await database.query(
        "insert into publish_queue (workspace_id, brand_id, channel_output_id, brand_channel_id, channel, status, approval_type, slot_date, slot_number, scheduled_for, queued_at, idempotency_key) values ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9, $10, $11) returning id",
        [
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
        ],
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

  await database.query(
    "insert into jobs (workspace_id, brand_id, channel_output_id, job_type) values ($1, $2, $3, 'instagram_render')",
    [workspaceId, brandId, primary.outputIds.get("instagram")],
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

  return { brandId };
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

test("029 creates the category catalog and Instagram trend cache", async () => {
  const migrations = await loadMigrations();
  const migration029 = migrations.find(
    (migration) => migration.id === "029_instagram_hashtag_trends.sql",
  );

  assert.ok(migration029, "missing migration 029_instagram_hashtag_trends.sql");

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
      "brand_profile_subcategories_custom_name_check",
      "brand_profile_subcategories_mode_check",
      "brand_trend_saved_media_brand_id_trend_media_id_key",
      "brand_trend_saved_media_source_url_id_key",
      "brand_trend_searches_brand_id_hashtag_id_key",
      "content_categories_code_key",
      "content_subcategories_category_id_code_key",
      "instagram_trend_account_hashtags_channel_hashtag_unique",
      "instagram_trend_hashtag_media_hashtag_id_meta_rank_key",
      "instagram_trend_hashtag_media_pkey",
      "instagram_trend_hashtags_normalized_tag_key",
      "instagram_trend_media_instagram_media_id_key",
      "instagram_trend_media_raw_metadata_object_check",
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

    const schemaSmokeSql = await readFile("db/smoke/001_schema_smoke.sql", "utf8");
    await database.exec(schemaSmokeSql);
  });
});
