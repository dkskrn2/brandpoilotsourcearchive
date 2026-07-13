import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const extractAddedCheckConstraintBody = (sql, table, constraint) => {
  const match = sql.match(
    new RegExp(
      `alter\\s+table\\s+${table}\\s+add\\s+constraint\\s+${constraint}\\s+check\\s*\\(([\\s\\S]*?)\\)\\s*;`,
      "i",
    ),
  );
  assert.ok(match, `${table}.${constraint} ADD CONSTRAINT 본문이 있어야 합니다`);
  return match[1];
};

const quotedSqlValues = (sql) =>
  [...sql.matchAll(/'([^']+)'/g)].map((match) => match[1]);

const assertExactSqlValues = (body, expected) => {
  assert.deepEqual(quotedSqlValues(body).sort(), [...expected].sort());
};

const assertDeliveryBackfill = (migration, channel, deliveryFormat) => {
  assert.match(
    migration,
    new RegExp(
      `update\\s+channel_outputs\\s+set\\s+delivery_format\\s*=\\s*'${deliveryFormat}'\\s+where\\s+channel\\s*=\\s*'${channel}'\\s+and\\s+delivery_format\\s+is\\s+null`,
      "i",
    ),
  );
};

test("전달 형식 백필 계약은 기존 값을 덮어쓰는 UPDATE를 거부한다", () => {
  assert.throws(() =>
    assertDeliveryBackfill(
      "update channel_outputs set delivery_format = 'tiktok_video' where channel = 'tiktok';",
      "tiktok",
      "tiktok_video",
    ),
  );
});

test("생성 산출물은 저장소 추적에서 제외한다", async () => {
  const ignoreRules = new Set(
    (await readFile(".gitignore", "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const requiredIgnoreRules = [
    "/artifacts/",
    "/output/",
    "/workers/brand-pilot-image-worker/output/",
    "/apps/api/storage/rendered-content/",
    "*.log",
    "*.dump",
    ".vercel/",
  ];
  const overlyBroadIgnoreRules = [
    "artifacts/",
    "output/",
    "storage/rendered-content/",
  ];

  for (const rule of requiredIgnoreRules) {
    assert.ok(ignoreRules.has(rule), `${rule} 규칙이 .gitignore에 있어야 합니다`);
  }

  for (const rule of overlyBroadIgnoreRules) {
    assert.ok(
      !ignoreRules.has(rule),
      `${rule} 규칙은 범위가 넓으므로 .gitignore에 없어야 합니다`,
    );
  }
});

test("루트 패키지는 비공개 워크스페이스와 공통 빌드·테스트 명령을 정의한다", async () => {
  const packageJson = await readJson("package.json");

  assert.equal(packageJson.private, true);
  assert.deepEqual(packageJson.workspaces, ["apps/*", "workers/*"]);
  assert.equal(
    packageJson.scripts.build,
    "npm run build --workspaces --if-present",
  );
  assert.equal(
    packageJson.scripts.test,
    "npm run test --workspaces --if-present",
  );
  assert.equal(packageJson.scripts["db:migrate"], "node scripts/migrate.mjs");
});

test("루트 README는 설치·실행·데이터베이스·출시 전 안내를 제공한다", async () => {
  const readme = await readFile("README.md", "utf8");
  const requiredContent = [
    "Supabase",
    "SUPABASE_DATABASE_URL",
    "DATABASE_URL",
    "npm install",
    "npm run dev:api",
    "npm run dev:ui",
    "npm run dev:worker",
    "npm test",
    "npm run build",
    "npm run test:e2e",
    "npm run db:up",
    "docs/PRE_LAUNCH_REQUIRED.md",
    "docs/SERVER_MIGRATION_AND_LAUNCH_CHECKLIST.md",
  ];

  for (const content of requiredContent) {
    assert.ok(readme.includes(content), `README.md에 ${content} 안내가 있어야 합니다`);
  }

  assert.match(readme, /npm run db:migrate/);
  assert.match(readme, /이미 스키마가 적용됐지만 이력이 없는 Supabase/);
  assert.match(readme, /Supabase[^\n]*백업[^\n]*PITR/);
  assert.match(
    readme,
    /로컬 Docker[^\n]*SUPABASE_DATABASE_URL[^\n]*비워/,
  );
});

test("루트 README의 상대 Markdown 링크는 모두 실제 파일을 가리킨다", async () => {
  const readme = await readFile("README.md", "utf8");
  const relativeLinks = [...readme.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().split(/\s+['"]/)[0])
    .filter((link) => !/^(?:https?:|mailto:|#)/i.test(link))
    .map((link) => decodeURIComponent(link.split("#", 1)[0]));

  assert.ok(relativeLinks.length > 0, "README.md에 검사할 상대 링크가 있어야 합니다");
  await Promise.all(relativeLinks.map((link) => access(link)));
});

test("루트 README의 npm run 명령은 루트 package.json scripts와 일치한다", async () => {
  const readme = await readFile("README.md", "utf8");
  const packageJson = await readJson("package.json");
  const codeBlocks = [...readme.matchAll(/```[^\r\n]*\r?\n([\s\S]*?)```/g)]
    .map((match) => match[1])
    .join("\n");
  const documentedRootScripts = [
    ...codeBlocks.matchAll(/^\s*npm run ([\w:-]+)\s*$/gm),
  ].map((match) => match[1]);

  assert.ok(documentedRootScripts.length > 0, "README.md에 루트 npm run 명령이 있어야 합니다");
  for (const scriptName of documentedRootScripts) {
    assert.ok(
      Object.hasOwn(packageJson.scripts, scriptName),
      `README.md의 npm run ${scriptName} 명령이 루트 package.json에 있어야 합니다`,
    );
  }
});

test("독립 이미지 워커 설치 문서는 root lockfile 없이 npm install을 사용한다", async () => {
  const setupOtherPc = await readFile(
    "workers/brand-pilot-image-worker/SETUP_OTHER_PC.md",
    "utf8",
  );
  const serverChecklist = await readFile(
    "docs/SERVER_MIGRATION_AND_LAUNCH_CHECKLIST.md",
    "utf8",
  );

  for (const document of [setupOtherPc, serverChecklist]) {
    assert.doesNotMatch(document, /\bnpm ci\b/);
  }
  assert.match(setupOtherPc, /^npm install\s*$/m);
  assert.match(serverChecklist, /`npm install`/);
});

test("API 환경 예제는 Supabase URL 값을 비워 둔다", async () => {
  const envExample = await readFile("apps/api/.env.example", "utf8");
  const supabaseDatabaseUrlLine = envExample.match(
    /^SUPABASE_DATABASE_URL=.*$/m,
  )?.[0];

  assert.equal(supabaseDatabaseUrlLine, "SUPABASE_DATABASE_URL=");
});

test("이미지 워커 설정은 현재 Codex image_gen 래퍼 흐름을 설명한다", async () => {
  const [workerSetup, rendererWrapper, codexImageOutput] = await Promise.all([
    readFile("docs/IMAGE_WORKER_SETUP.md", "utf8"),
    readFile(
      "workers/brand-pilot-image-worker/scripts/run-codex-image-render.mjs",
      "utf8",
    ),
    readFile(
      "workers/brand-pilot-image-worker/src/codexImageOutput.mjs",
      "utf8",
    ),
  ]);

  assert.match(rendererWrapper, /maxImages < 1 \|\| maxImages > 5/);
  assert.match(rendererWrapper, /copyFile\(generatedImage, path\.join\(outputDir/);
  assert.match(codexImageOutput, /"generated_images"/);

  assert.doesNotMatch(workerSetup, /codex --login/);
  assert.match(workerSetup, /^codex login\s*$/m);
  assert.match(workerSetup, /image_gen/);
  assert.match(workerSetup, /one to five/);
  assert.match(workerSetup, /\$CODEX_HOME\/generated_images/);
  assert.match(workerSetup, /wrapper[^\n]*copies[^\n]*job output directory/i);
  assert.doesNotMatch(workerSetup, /slide-01\.png` through `slide-05\.png/);
});

test("API 패키지는 타입 검사와 tsup 빌드 및 배포 시작 명령을 정의한다", async () => {
  const packageJson = await readJson("apps/api/package.json");

  assert.equal(packageJson.scripts.typecheck, "tsc --noEmit");
  assert.match(packageJson.scripts.build, /tsup/);
  assert.equal(packageJson.scripts.start, "node dist/index.js");
});

test("데이터베이스 마이그레이션은 001부터 019까지 정확한 이름으로 존재한다", async () => {
  const migrationFiles = (await readdir("db/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  assert.deepEqual(migrationFiles, [
    "001_initial_schema.sql",
    "002_source_content_items.sql",
    "003_topic_rows_duplicate_policy.sql",
    "004_channel_connection_requests.sql",
    "005_content_topic_source_url_unique.sql",
    "006_image_render_jobs.sql",
    "007_kakao_auth.sql",
    "008_auto_approval_default.sql",
    "009_support_requests.sql",
    "010_remove_webflow.sql",
    "011_add_social_channels.sql",
    "012_source_crawl_runs.sql",
    "013_automation_runs.sql",
    "014_instagram_delivery_formats.sql",
    "015_delivery_format_legacy_channels.sql",
    "016_repair_topic_publish_group_schedule.sql",
    "017_preserve_topic_publish_group_status.sql",
    "018_repair_active_render_job_unique.sql",
    "019_threads_text_render_jobs.sql",
  ]);
});

test("Threads 텍스트 워커 마이그레이션은 작업 유형과 활성 작업 중복 방지를 정의한다", async () => {
  const migration = await readFile(
    "db/migrations/019_threads_text_render_jobs.sql",
    "utf8",
  );

  assert.match(migration, /'threads_text_render'/);
  assert.match(migration, /create unique index[\s\S]*on jobs\(channel_output_id\)/i);
  assert.match(migration, /status in \('queued', 'running'\)/i);
});

test("활성 이미지 렌더 작업 보정은 중복 작업을 종료한 뒤 부분 고유 인덱스를 복구한다", async () => {
  const migration = await readFile(
    "db/migrations/018_repair_active_render_job_unique.sql",
    "utf8",
  );

  assert.match(migration, /row_number\(\) over \([\s\S]*partition by channel_output_id/i);
  assert.match(migration, /where active_rank > 1/i);
  assert.match(migration, /last_error = 'superseded_by_migration_018'/i);
  assert.match(
    migration,
    /create unique index jobs_active_render_output_unique[\s\S]*on jobs\(channel_output_id\)[\s\S]*status in \('queued', 'running'\)/i,
  );
});

test("Instagram 전달 형식 마이그레이션은 형식·발행 그룹·렌더 산출물 계약을 정의한다", async () => {
  const migration = await readFile(
    "db/migrations/014_instagram_delivery_formats.sql",
    "utf8",
  );

  assert.match(
    migration,
    /alter table brand_profiles[\s\S]*add column if not exists brand_color text/i,
  );
  assert.match(migration, /create table(?: if not exists)? brand_content_formats/i);
  assert.match(
    migration,
    /create table(?: if not exists)? brand_format_rotation_states/i,
  );
  assert.match(
    migration,
    /alter table content_topics[\s\S]*add column if not exists selected_instagram_format text/i,
  );
  assert.match(
    migration,
    /alter table channel_outputs[\s\S]*add column if not exists delivery_format text/i,
  );
  assert.match(migration, /create table(?: if not exists)? topic_publish_groups/i);
  assert.match(
    migration,
    /alter table publish_queue[\s\S]*add column if not exists topic_publish_group_id uuid/i,
  );

  const deliveryFormats = [
    "instagram_feed_carousel",
    "instagram_story",
    "instagram_reel",
    "threads_text",
    "tiktok_video",
    "youtube_video",
    "x_post",
  ];
  const deliveryFormatCheck = extractAddedCheckConstraintBody(
    migration,
    "channel_outputs",
    "channel_outputs_delivery_format_check",
  );
  assertExactSqlValues(deliveryFormatCheck, deliveryFormats);
  for (const [channel, deliveryFormat] of [
    ["instagram", "instagram_feed_carousel"],
    ["threads", "threads_text"],
    ["tiktok", "tiktok_video"],
    ["youtube", "youtube_video"],
    ["x", "x_post"],
  ]) {
    assertDeliveryBackfill(migration, channel, deliveryFormat);
  }

  const jobTypes = [
    "daily_generation_enqueue",
    "source_crawl",
    "topic_select",
    "master_draft_generate",
    "channel_output_generate",
    "auto_approval_check",
    "instagram_feed_render",
    "instagram_story_render",
    "instagram_reel_render",
    "artifact_upload",
    "instagram_publish",
    "threads_publish",
    "token_health_check",
    "storage_cleanup",
  ];
  const jobsTypeCheck = extractAddedCheckConstraintBody(
    migration,
    "jobs",
    "jobs_type_check",
  );
  assertExactSqlValues(jobsTypeCheck, jobTypes);
  assert.ok(!quotedSqlValues(jobsTypeCheck).includes("instagram_render"));

  const artifactTypes = [
    "topic_upload",
    "brand_asset",
    "rendered_image",
    "generated_manifest",
    "cover_image",
    "source_archive",
    "rendered_video",
    "reel_cover",
  ];
  const storageArtifactTypeCheck = extractAddedCheckConstraintBody(
    migration,
    "storage_artifacts",
    "storage_artifacts_type_check",
  );
  assertExactSqlValues(storageArtifactTypeCheck, artifactTypes);
});

test("기존 데이터베이스 전달 형식 보정 마이그레이션은 레거시 채널을 안전하게 채운다", async () => {
  const migration = await readFile(
    "db/migrations/015_delivery_format_legacy_channels.sql",
    "utf8",
  );
  const deliveryFormats = [
    "instagram_feed_carousel",
    "instagram_story",
    "instagram_reel",
    "threads_text",
    "tiktok_video",
    "youtube_video",
    "x_post",
  ];

  for (const [channel, deliveryFormat] of [
    ["instagram", "instagram_feed_carousel"],
    ["threads", "threads_text"],
    ["tiktok", "tiktok_video"],
    ["youtube", "youtube_video"],
    ["x", "x_post"],
  ]) {
    assertDeliveryBackfill(migration, channel, deliveryFormat);
  }

  const deliveryFormatCheck = extractAddedCheckConstraintBody(
    migration,
    "channel_outputs",
    "channel_outputs_delivery_format_check",
  );
  assertExactSqlValues(deliveryFormatCheck, deliveryFormats);

  const lastBackfill = migration.lastIndexOf("set delivery_format");
  const enforceNotNull = migration.search(
    /alter\s+column\s+delivery_format\s+set\s+not\s+null/i,
  );
  assert.ok(lastBackfill >= 0 && enforceNotNull > lastBackfill);
});

test("발행 그룹 일정 보정 마이그레이션은 실제 큐 행 선택과 충돌 초기화를 정의한다", async () => {
  const migration = await readFile(
    "db/migrations/016_repair_topic_publish_group_schedule.sql",
    "utf8",
  );

  assert.match(
    migration,
    /order by\s+pq\.scheduled_for nulls last,\s+pq\.slot_date nulls last,\s+pq\.slot_number nulls last,\s+pq\.queued_at,\s+pq\.id/is,
  );
  assert.match(migration, /when count\(pq\.id\) = 0 then 'waiting'/i);
  assert.match(migration, /bool_and\(pq\.status = 'published'\)/i);
  assert.match(
    migration,
    /row_number\(\) over \(\s*partition by brand_id, slot_date, slot_number\s*order by scheduled_for nulls last, created_at, id/is,
  );
  assert.match(
    migration,
    /set\s+status = 'waiting',\s+slot_date = null,\s+slot_number = null,\s+scheduled_for = null/is,
  );
  assert.doesNotMatch(migration, /\b(?:delete from|truncate|drop table)\b/i);
});

test("발행 그룹 상태 보존 마이그레이션은 최종 상태를 한 파이프라인에서 계산하고 변경 행만 갱신한다", async () => {
  const migration = await readFile(
    "db/migrations/017_preserve_topic_publish_group_status.sql",
    "utf8",
  );

  assert.match(migration, /with\s+group_queue_rows\s+as/is);
  assert.match(migration, /group_aggregates\s+as/is);
  assert.match(migration, /schedule_candidates\s+as/is);
  assert.match(migration, /active_candidate_rankings\s+as/is);
  assert.match(migration, /final_states\s+as/is);
  assert.match(
    migration,
    /when\s+slot_position > 1\s+and aggregate_status = 'scheduled'\s+then 'waiting'/is,
  );
  assert.match(
    migration,
    /when\s+slot_position > 1\s+then null\s+else candidate_slot_date/is,
  );
  assert.match(migration, /tpg\.status is distinct from final\.status/i);
  assert.match(migration, /tpg\.slot_date is distinct from final\.slot_date/i);
  assert.match(migration, /tpg\.slot_number is distinct from final\.slot_number/i);
  assert.match(
    migration,
    /tpg\.scheduled_for is distinct from final\.scheduled_for/i,
  );
  assert.match(
    migration,
    /create unique index if not exists topic_publish_groups_active_brand_slot_unique/i,
  );
  assert.doesNotMatch(
    migration,
    /\b(?:delete from|truncate|drop table|update publish_queue|update publish_attempts)\b/i,
  );
});

test("자동 크롤링 마이그레이션과 Vercel Cron을 등록한다", async () => {
  const vercel = await readJson("apps/api/vercel.json");
  assert.deepEqual(vercel.crons, [
    { path: "/internal/cron/source-crawl", schedule: "*/15 * * * *" },
    { path: "/internal/cron/daily-generation", schedule: "0 1 * * *" },
    { path: "/internal/cron/publish-due", schedule: "*/5 * * * *" },
  ]);

  const envExample = await readFile("apps/api/.env.example", "utf8");
  assert.match(envExample, /^CRON_SECRET=$/m);
  assert.match(envExample, /^SOURCE_CRAWL_BATCH_SIZE=5$/m);
  assert.match(envExample, /^SOURCE_CRAWL_DISCOVERY_LIMIT=20$/m);
  assert.match(envExample, /^SOURCE_CRAWL_TIME_BUDGET_MS=45000$/m);
  assert.match(envExample, /^LOCAL_SCHEDULER_ENABLED=false$/m);
});

test("각 워크스페이스 패키지는 개별 package-lock.json을 두지 않는다", async () => {
  const lockfiles = [
    "apps/api/package-lock.json",
    "apps/customer-ui/package-lock.json",
    "workers/brand-pilot-image-worker/package-lock.json",
  ];

  await Promise.all(
    lockfiles.map((lockfile) =>
      assert.rejects(
        readFile(lockfile),
        (error) => error.code === "ENOENT",
        `${lockfile} 파일이 없어야 합니다`,
      ),
    ),
  );
});
