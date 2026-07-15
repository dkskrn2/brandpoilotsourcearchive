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
      if (migration.sql.startsWith("-- requires: pgvector")) continue;
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
