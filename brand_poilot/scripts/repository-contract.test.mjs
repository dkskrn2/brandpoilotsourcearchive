import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
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

test("AI 콘텐츠 저장소 계약은 중앙 ApiRepository에 모두 노출된다", async () => {
  const types = await readFile("apps/api/src/types.ts", "utf8");
  const requiredMethods = [
    "getAiContentBrandContext",
    "updateAiContentFinalizationDraft",
    "startAiContentGenerationV3",
    "listAiContentGenerations",
    "getAiContentGeneration",
    "listAiContentUsage",
    "listAiContentReferences",
    "listBrandAudiences",
    "saveBrandAudience",
    "listBrandAppeals",
    "saveBrandAppeal",
    "confirmAiContentAttachment",
    "claimAiContentJob",
    "heartbeatAiContentJob",
    "completeAiContentJob",
    "failAiContentJob",
    "retryAiContentOutput",
    "downloadAiContentOutput",
    "downloadAiContentGeneration",
    "prepareAiContentPublish",
  ];

  for (const method of requiredMethods) {
    assert.match(types, new RegExp(`\\b${method}\\s*\\(`), `ApiRepository에 필수 ${method} 메서드가 있어야 합니다`);
  }
  const repository = await readFile("apps/api/src/repository.ts", "utf8");
  const publisher = await readFile("apps/api/src/aiContentPublish.ts", "utf8");
  for (const source of [types, repository, publisher]) {
    assert.doesNotMatch(source, /\bsendAiContentToPublish\s*\(/, "사용하지 않는 중복 publish 진입점은 제거되어야 합니다");
  }
});

test("공통 게시 항목은 하나의 tenant-scoped repository와 route만 사용한다", async () => {
  const [types, repository, publishItems, server] = await Promise.all([
    readFile("apps/api/src/types.ts", "utf8"),
    readFile("apps/api/src/repository.ts", "utf8"),
    readFile("apps/api/src/publishItemsRepository.ts", "utf8"),
    readFile("apps/api/src/httpServer.ts", "utf8"),
  ]);

  assert.match(types, /Partial<import\("\.\/publishItemsRepository\.js"\)\.PublishItemsRepository>/);
  assert.match(repository, /createPublishItemsRepository\(pool\)/);
  assert.match(repository, /\.\.\.publishItems/);
  assert.match(server, /"\/brands\/:brandId\/publish-items"/);
  assert.match(server, /repository\.listPublishItems\(aiContentScope\(request, request\.params\.brandId\)\)/);
  assert.match(publishItems, /topic\.workspace_id=\$1::uuid and topic\.brand_id=\$2::uuid/);
  assert.match(publishItems, /queue\.workspace_id=\$1::uuid and queue\.brand_id=\$2::uuid/);
  assert.doesNotMatch(server, /publish-items[^\n]*listPublishQueue/);
});

test("브랜드 분석 저장소는 open workflow 조회와 보존형 중복 정리를 계약으로 고정한다", async () => {
  const [repository, migration] = await Promise.all([
    readFile("apps/api/src/brandIntelligenceRepository.ts", "utf8"),
    readFile("db/migrations/069_brand_analysis_one_open_workflow.sql", "utf8"),
  ]);

  assert.match(repository, /getOpenBrandAnalysis\(input:\s*BrandAnalysisScope\)/);
  assert.match(
    migration,
    /begin;\s*lock table brand_analysis_runs in share row exclusive mode;\s*with ranked as/i,
  );
  assert.match(migration, /row_number\(\)\s+over/i);
  assert.match(migration, /status\s*=\s*'failed'/i);
  assert.match(migration, /error_code\s*=\s*'brand_analysis_superseded'/i);
  assert.match(
    migration,
    /create unique index brand_analysis_runs_one_open_per_brand_uq[\s\S]*where status in \('queued', 'extracting', 'analyzing', 'review_ready'\)/i,
  );
  assert.doesNotMatch(migration, /delete\s+from\s+brand_analysis_runs/i);
});

test("AI 콘텐츠 생성 쓰기 계약은 인증 actor를 필수로 요구한다", async () => {
  const repository = await readFile("apps/api/src/aiContentRepository.ts", "utf8");
  const types = await readFile("apps/api/src/types.ts", "utf8");
  for (const source of [repository, types]) {
    assert.doesNotMatch(source, /createAiContentAnalysis\(input:[^;]*actorUserId\?:/);
    assert.doesNotMatch(source, /updateAiContentDraft\(input:[^;]*actorUserId\?:/);
    assert.doesNotMatch(source, /startAiContentGeneration\(input:[^;]*actorUserId\?:/);
  }
  assert.match(repository, /interface AuthenticatedBrandScope extends BrandScope\s*\{\s*actorUserId: string;/);
});

test("관리자 API는 별도 namespace와 server-only credential 계약을 사용한다", async () => {
  const [server, index, envExample, adminTypes] = await Promise.all([
    readFile("apps/api/src/adminServer.ts", "utf8"),
    readFile("apps/api/src/index.ts", "utf8"),
    readFile("apps/api/.env.example", "utf8"),
    readFile("apps/api/src/adminTypes.ts", "utf8"),
  ]);

  assert.match(server, /prefix:\s*"\/admin\/v1"/);
  assert.match(index, /process\.env\.ADMIN_SERVICE_TOKEN/);
  assert.match(envExample, /^ADMIN_SERVICE_TOKEN=$/m);
  assert.doesNotMatch(adminTypes, /encryptedPayload|encrypted_payload|secretValue|accessToken|refreshToken/);
});

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
  assert.deepEqual(packageJson.workspaces, ["packages/*", "apps/*", "workers/*"]);
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

test("데이터베이스 마이그레이션 registry는 게시 캘린더 079부터 prompt lineage 091까지 순서대로 포함한다", async () => {
  const migrationFiles = (await readdir("db/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const reservedProgramMigrations = migrationFiles.filter(
    (file) => file.startsWith("059_") || file.startsWith("060_"),
  );
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
    "020_dm_wiki_core.sql",
    "021_dm_wiki_pgvector.sql",
    "022_instagram_login_auth_mode.sql",
    "023_wiki_include_disabled_owned_sources.sql",
    "024_wiki_index_all_owned_pages.sql",
    "025_dm_conversation_operations.sql",
    "026_wiki_versions_and_knowledge_items.sql",
    "027_wiki_search_v2.sql",
    "028_brand_profile_logo.sql",
    "029_instagram_hashtag_trends.sql",
    "030_multichannel_foundation.sql",
    "031_content_performance_dashboard.sql",
    "032_compounding_wiki_core.sql",
    "033_compounding_wiki_pgvector.sql",
    "034_worker_resource_limits.sql",
    "035_remove_webflow_and_split_content_status.sql",
    "036_harden_performance_and_wiki_activation.sql",
    "037_repair_orphaned_generation_outputs.sql",
    "038_fail_exhausted_generation_jobs.sql",
    "039_instagram_trend_connections.sql",
    "040_restore_support_requests.sql",
    "041_instagram_trend_page_optional.sql",
    "042_single_owned_source.sql",
    "043_support_request_responses.sql",
    "044_ai_content_studio_runtime.sql",
    "045_admin_api_foundation.sql",
    "046_content_quality_learning.sql",
    "047_ai_content_subject_analysis.sql",
    "048_ai_content_direct_social_publishing.sql",
    "049_brand_intelligence_onboarding.sql",
    "050_support_request_contact_phone.sql",
    "051_ai_content_subject_pipeline_v2.sql",
    "052_ai_content_subject_appeal_regeneration_keys.sql",
    "053_dm_manual_delivery_audit.sql",
    "054_feedback_submissions.sql",
    "055_brand_core_and_rules.sql",
    "056_product_service_library.sql",
    "057_wiki_source_kinds.sql",
    "058_avatar_and_reference_libraries.sql",
    ...reservedProgramMigrations,
    "061_avatar_image_checksum_uniqueness.sql",
    "062_avatar_upload_cancellation.sql",
    "063_avatar_upload_finalization.sql",
    "064_reference_upload_finalization.sql",
    "065_ai_content_attachment_upload_sessions.sql",
    "066_ai_content_analyzed_subject_orchestration.sql",
    "067_wiki_refresh_outbox.sql",
    "068_brand_core_one_draft.sql",
    "069_brand_analysis_one_open_workflow.sql",
    "070_remove_embedding_runtime.sql",
    "071_brand_intelligence_onboarding_worker_v2.sql",
    "072_faq_suggestion_worker.sql",
    "073_ai_content_generation_v2_render_pipeline.sql",
    "073a_legacy_trigger_function_search_path.sql",
    "074_ai_content_maintenance_write_fence.sql",
    "075_ai_content_three_format_cutover.sql",
    "076_manual_content_generation_brand_rules.sql",
    "077_content_suggestion_batches.sql",
    "078_faq_utterance_matching.sql",
    "079_publish_calendar_runtime.sql",
    "080_reference_channel_archive.sql",
    "081_meta_ad_library_references.sql",
    "082_manual_brand_visual_assets.sql",
    "083_manual_visual_selection_write_fence_invoker.sql",
    "084_ai_content_usage_reversal_identity_invoker.sql",
    "085_publish_calendar_idempotency_expand.sql",
    "086_publish_calendar_same_time_contract.sql",
    "087_ai_content_prompt_lineage_v3.sql",
    "088_onboarding_product_image_imports.sql",
    "089_free_subscription_plan.sql",
    "090_existing_brand_free_subscriptions.sql",
    "091_ai_content_prompt_lineage_v4.sql",
  ]);
  assert.ok(reservedProgramMigrations.filter((file) => file.startsWith("059_")).length <= 1);
  assert.ok(reservedProgramMigrations.filter((file) => file.startsWith("060_")).length <= 1);
  if (reservedProgramMigrations.some((file) => file.startsWith("060_"))) {
    assert.ok(reservedProgramMigrations.includes("060_content_orchestration.sql"));
  }
});

test("066 extends orchestration with immutable analyzed-subject snapshots", async () => {
  const migration = await readFile(
    "db/migrations/066_ai_content_analyzed_subject_orchestration.sql",
    "utf8",
  );
  assert.match(migration, /create\s+table\s+if\s+not\s+exists\s+ai_content_analyzed_subject_snapshots/i);
  assert.match(migration, /analyzed_subject_snapshot_immutable/i);
  assert.match(migration, /kind'\s*=\s*'analyzed_subject'/i);
  assert.match(migration, /analysis\.status\s+in\s*\('ready','partial'\)/i);
  assert.match(migration, /analysis\.workspace_id=sealed\.workspace_id/i);
  assert.match(migration, /analysis\.brand_id=sealed\.brand_id/i);
  assert.match(migration, /add\s+column\s+if\s+not\s+exists\s+created_by_user_id\s+uuid/i);
  assert.match(migration, /foreign\s+key\s*\(workspace_id,created_by_user_id\)/i);
  assert.match(migration, /foreign\s+key\s*\(workspace_id,updated_by_user_id\)/i);
});

test("065 defines the parent-independent AI attachment lifecycle contract", async () => {
  const migration = await readFile(
    "db/migrations/065_ai_content_attachment_upload_sessions.sql",
    "utf8",
  );

  for (const table of [
    "ai_content_attachment_upload_sessions",
    "ai_content_attachment_deletion_jobs",
  ]) {
    assert.match(migration, new RegExp(`create\\s+table\\s+${table}`, "i"));
  }
  for (const column of [
    "attachments_locked_at",
    "generation_input_snapshot",
    "terminal_at",
    "retryable_until",
    "upload_session_id",
    "deletion_reason",
    "physical_delete_status",
    "physically_deleted_at",
  ]) {
    assert.match(migration, new RegExp(`\\b${column}\\b`, "i"));
  }
  assert.match(
    migration,
    /ai_content_attachment_upload_sessions_actor_fk[\s\S]*on delete no action[\s\S]*deferrable initially deferred/i,
  );
  assert.match(
    migration,
    /create unique index ai_content_attachment_upload_sessions_storage_path_uq[\s\S]*where not is_legacy_backfill/i,
  );
  assert.match(
    migration,
    /create table ai_content_attachment_storage_path_guards[\s\S]*storage_path text primary key/i,
  );
  assert.match(
    migration,
    /insert into ai_content_attachment_storage_path_guards[\s\S]*on conflict \(storage_path\) do update/i,
  );
  assert.match(
    migration,
    /nonlegacy_session_count = 0[\s\S]*excluded\.nonlegacy_session_count = 0[\s\S]*legacy_session_count = 0/i,
  );
  assert.match(
    migration,
    /ai_content_attachment_upload_sessions_generation_fk_idx[\s\S]*generation_id[\s\S]*workspace_id[\s\S]*brand_id/i,
  );
  assert.match(
    migration,
    /ai_content_attachment_upload_sessions_actor_fk_idx[\s\S]*workspace_id, created_by_user_id[\s\S]*where created_by_user_id is not null/i,
  );
  assert.match(
    migration,
    /old\.status <> 'pending'[\s\S]*confirmed_attachment_id[\s\S]*last_error_code[\s\S]*is_legacy_backfill[\s\S]*transition_invalid/i,
  );
  assert.doesNotMatch(
    migration,
    /old\.status <> 'pending'[\s\S]*new\.storage_url is distinct from old\.storage_url[\s\S]*transition_invalid/i,
  );
  assert.match(
    migration,
    /atomic schema change and data backfill[\s\S]*Operations must approve row counts[\s\S]*maintenance window/i,
  );
  assert.match(migration, /deferrable\s+initially\s+deferred[\s\S]*on delete no action/i);
  assert.match(migration, /created_by_user_id is not null[\s\S]*is_legacy_backfill[\s\S]*confirmed_attachment_id is not null/i);
  assert.match(migration, /before delete[\s\S]*ai_content_generation_attachments/i);
  assert.match(migration, /before delete[\s\S]*ai_content_attachment_upload_sessions/i);
  assert.match(migration, /on conflict[\s\S]*do nothing/i);
  assert.match(migration, /contentGenerationInput/);
  assert.match(migration, /attachmentSnapshotMissingIds/);
  assert.doesNotMatch(
    migration,
    /alter\s+table\s+ai_content_generation_attachments[\s\S]*add\s+column\s+(?:attempt|retry|lease|last_error)/i,
  );
});

test("063 keeps cancelled sessions pending through token expiry and schedules fair retries", async () => {
  const migration = await readFile("db/migrations/063_avatar_upload_finalization.sql", "utf8");
  assert.match(migration, /reference_upload_sessions[\s\S]*cancelled_at/i);
  assert.match(migration, /avatar_upload_cancellation_receipts[\s\S]*token_expires_at/i);
  assert.match(migration, /avatar_upload_cancellation_receipts[\s\S]*next_attempt_at/i);
  assert.match(migration, /status[\s\S]*pending[\s\S]*completed/i);
});

test("064 defines an independently scoped and fairly retried reference upload finalizer", async () => {
  const migration = await readFile("db/migrations/064_reference_upload_finalization.sql", "utf8");
  assert.match(migration, /create\s+table\s+if\s+not\s+exists\s+reference_upload_cancellation_receipts/i);
  for (const column of [
    "session_id", "workspace_id", "brand_id", "created_by_user_id",
    "storage_path", "storage_path_prefix", "token_expires_at", "status",
    "next_attempt_at", "attempt_count", "last_error",
  ]) {
    assert.match(migration, new RegExp(`\\b${column}\\b`, "i"));
  }
  assert.match(migration, /reason[\s\S]*'user'[\s\S]*'expired'/i);
  assert.match(migration, /reference_upload_cancellation_receipts_due_idx/i);
  assert.match(migration, /where\s+status\s*=\s*'pending'/i);
  assert.doesNotMatch(migration, /\bavatar_id\b/i);
});

test("062는 exact-path avatar cancellation receipt와 expiry cleanup index를 정의한다", async () => {
  const migration = await readFile("db/migrations/062_avatar_upload_cancellation.sql", "utf8");
  assert.match(migration, /add\s+column\s+if\s+not\s+exists\s+storage_path\s+text/i);
  assert.match(migration, /create\s+table\s+if\s+not\s+exists\s+avatar_upload_cancellation_receipts/i);
  assert.match(migration, /session_id\s+uuid\s+primary\s+key/i);
  assert.match(migration, /reason\s+text\s+not\s+null\s+check\s*\(\s*reason\s+in\s*\(\s*'user',\s*'expired'\s*\)/i);
  assert.match(migration, /reference_upload_sessions_avatar_expiry_cleanup_idx/i);
});

test("058은 avatar와 typed-origin reference library 계약을 정의한다", async () => {
  const migration = await readFile(
    "db/migrations/058_avatar_and_reference_libraries.sql",
    "utf8",
  );

  for (const table of [
    "brand_avatars",
    "brand_avatar_images",
    "reference_brands",
    "reference_items",
    "reference_item_source_url_provenance",
    "reference_upload_sessions",
    "reference_patterns",
  ]) {
    assert.match(migration, new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${table}\\b`, "i"));
  }

  assert.match(migration, /kind\s+in\s*\(\s*'saved_brand',\s*'saved_content',\s*'trend',\s*'external_url',\s*'upload',\s*'owned_performance'\s*\)/i);
  assert.match(migration, /content_purpose\s+in\s*\(\s*'informational',\s*'marketing',\s*'both'\s*\)/i);
  assert.match(migration, /num_nonnulls\s*\(\s*reference_brand_id,\s*source_url_id,\s*saved_trend_id,\s*channel_output_id,\s*storage_artifact_id\s*\)\s*=\s*1/i);
  assert.doesNotMatch(migration, /\borigin_id\s+uuid\b/i);
  assert.doesNotMatch(migration, /\b(likeness|consent)\b/i);
  assert.match(migration, /brand_avatar_images_mime_type_check[\s\S]*'image\/png'[\s\S]*'image\/jpeg'[\s\S]*'image\/webp'/i);
  assert.match(migration, /brand_avatar_images_size_check[\s\S]*5242880/i);
  assert.match(migration, /create\s+table\s+if\s+not\s+exists\s+brand_avatars\s*\([\s\S]*?created_by_user_id\s+uuid\s+not\s+null/i);
  assert.match(migration, /create\s+table\s+if\s+not\s+exists\s+brand_avatar_images\s*\([\s\S]*?created_by_user_id\s+uuid\s+not\s+null/i);
  assert.match(migration, /brand_avatars_one_active_default/i);
  assert.match(migration, /brand_avatar_images_one_representative/i);
  assert.match(migration, /create\s+(?:or\s+replace\s+)?function[\s\S]*brand_avatar[\s\S]*image_count[\s\S]*representative_count/i);
  assert.match(migration, /create\s+constraint\s+trigger[\s\S]*deferrable\s+initially\s+deferred/i);
  assert.match(migration, /reference_items_saved_trend_origin_unique/i);
  assert.match(migration, /insert\s+into\s+reference_item_source_url_provenance/i);
  assert.match(migration, /from\s+brand_trend_saved_media/i);
  assert.match(migration, /source_type\s*=\s*'reference'/i);
  assert.match(migration, /not\s+exists\s*\([\s\S]*brand_trend_saved_media/i);
});

test("060은 tenant-safe content orchestration과 재현 가능한 snapshot 계약을 정의한다", async () => {
  const [migration, attachmentMigration, aiContentRepository, crawlerRepository] = await Promise.all([
    readFile("db/migrations/060_content_orchestration.sql", "utf8"),
    readFile("db/migrations/065_ai_content_attachment_upload_sessions.sql", "utf8"),
    readFile("apps/api/src/aiContentRepository.ts", "utf8"),
    readFile("apps/api/src/repository.ts", "utf8"),
  ]);

  for (const column of [
    "content_family",
    "output_format",
    "subject_mode",
    "product_service_id",
    "orchestration_snapshot",
    "avatar_snapshot",
  ]) {
    assert.match(migration, new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\b`, "i"));
  }
  assert.match(migration, /content_family[\s\S]*'informational'[\s\S]*'marketing'/i);
  assert.match(migration, /output_format[\s\S]*'card_news'[\s\S]*'blog'[\s\S]*'single_image'[\s\S]*'channel_text'/i);
  assert.match(migration, /subject_mode[\s\S]*'brand_topic'[\s\S]*'product_service'[\s\S]*'new_subject'/i);
  assert.match(migration, /when\s+type\s*=\s*'card_news'\s+then\s+'informational'/i);
  assert.match(migration, /when\s+type\s*=\s*'marketing'\s+then\s+'single_image'/i);

  assert.match(migration, /add\s+column\s+if\s+not\s+exists\s+reference_item_id\s+uuid/i);
  assert.match(migration, /add\s+column\s+if\s+not\s+exists\s+roles_json\s+jsonb/i);
  assert.match(migration, /jsonb_array_length\s*\(\s*value\s*\)\s+between\s+1\s+and\s+3/i);
  for (const role of ["planning", "copy_pattern", "visual_composition"]) {
    assert.match(migration, new RegExp(`'${role}'`, "i"));
  }
  assert.match(migration, /where\s+reference_item_id\s+is\s+not\s+null/i);
  assert.match(migration, /ai_content_generation_reference_migration_audits/i);
  assert.doesNotMatch(migration, /\b(?:truncate|delete\s+from\s+ai_content_generation_references)\b/i);

  for (const table of [
    "ai_content_proposal_batches",
    "ai_content_proposals",
    "ai_content_proposal_jobs",
    "ai_content_approved_proposal_versions",
    "ai_content_generation_briefs",
    "ai_content_create_idempotency_records",
    "reference_snapshots",
    "reference_pattern_versions",
    "ai_content_wiki_version_snapshots",
    "ai_content_one_time_avatar_receipts",
    "ai_content_one_time_avatar_revocations",
  ]) {
    assert.match(migration, new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${table}\\b`, "i"));
  }
  assert.match(migration, /origin[\s\S]*'manual'[\s\S]*'scheduled_crawl'/i);
  assert.match(migration, /status[\s\S]*'queued'[\s\S]*'building'[\s\S]*'ready'[\s\S]*'failed'/i);
  assert.match(migration, /position[\s\S]*between\s+1\s+and\s+3/i);
  assert.match(migration, /where\s+status\s*=\s*'selected'/i);
  assert.match(migration, /for\s+update/i);
  assert.match(migration, /set\s+status\s*=\s*'dismissed'/i);
  assert.match(migration, /dismissed_by_user_id/i);
  assert.match(migration, /dismissed_at/i);
  assert.match(migration, /lease_expires_at/i);
  assert.match(migration, /attempt_count[\s\S]*max_attempts/i);
  assert.doesNotMatch(migration, /ai_content_proposal_jobs[\s\S]*\bpayload_json\b/i);

  for (const key of [
    "sourceId",
    "url",
    "crawledAt",
    "contentHash",
    "summary",
    "brandCoreVersionId",
    "approvedProposalVersionId",
    "approvedProposalSnapshot",
    "ruleSetVersionId",
    "subject",
    "wikiSnapshots",
    "proposalId",
    "snapshotId",
    "patternVersionId",
    "assetVersionId",
    "promptDefinitionVersions",
  ]) {
    assert.match(migration, new RegExp(key, "i"));
  }
  assert.match(migration, /source_urls_content_purpose_idx/i);
  assert.match(migration, /reference_items_brand_purpose_active_idx/i);
  assert.match(migration, /idempotency_conflict/i);
  assert.match(migration, /reference_snapshot_immutable/i);
  assert.match(migration, /reference_pattern_version_immutable/i);
  assert.match(migration, /wiki_version_snapshot_immutable/i);
  assert.match(migration, /ai_content_actor_is_active/i);
  assert.match(migration, /one_time_avatar_receipt_invalid/i);
  assert.match(migration, /one_time_avatar_receipt_immutable/i);
  assert.match(migration, /one_time_avatar_revocation_immutable/i);
  assert.match(migration, /revoke_ai_content_one_time_avatar_receipt/i);
  assert.match(migration, /one_time_avatar_receipt_revoked/i);
  assert.doesNotMatch(migration, /ai_content_attachment_upload_sessions/i);
  assert.doesNotMatch(migration, /ai_content_generation_attachments/i);
  assert.match(
    migration,
    /from\s+ai_content_proposal_batches\s+batch[\s\S]*?for\s+update;[\s\S]*?from\s+ai_content_proposals\s+proposal[\s\S]*?for\s+update;/i,
  );
  assert.match(attachmentMigration, /seal_ai_content_one_time_avatar_receipt_from_upload/i);
  assert.match(
    attachmentMigration,
    /revoke_ai_content_one_time_avatar_on_attachment_unavailable/i,
  );
  assert.match(
    attachmentMigration,
    /from ai_content_one_time_avatar_receipts receipt[\s\S]*join ai_content_generation_attachments attachment[\s\S]*attachment\.generation_id = receipt\.generation_id[\s\S]*attachment\.workspace_id = receipt\.workspace_id[\s\S]*attachment\.brand_id = receipt\.brand_id[\s\S]*attachment\.id = receipt\.id[\s\S]*attachment\.storage_path = receipt\.storage_path[\s\S]*attachment\.deleted_at is not null[\s\S]*attachment\.physical_delete_status <> 'none'/i,
  );
  assert.match(migration, /proposal_generation_family_mismatch/i);
  assert.match(migration, /generation_canonical_mapping_missing/i);
  assert.match(migration, /ai_content_versioned_snapshot_is_valid/i);
  assert.match(migration, /approved_proposal_versions_json_identity_check/i);
  assert.match(migration, /generation_briefs_json_identity_check/i);
  assert.match(migration, /actor_user_id[\s\S]*operation[\s\S]*client_request_id[\s\S]*normalized_payload_hash/i);
  assert.doesNotMatch(migration, /'ruleSetId'/);
  assert.doesNotMatch(migration, /'referenceSnapshots'/);
  assert.doesNotMatch(migration, /'imageSnapshots'/);
  assert.match(aiContentRepository, /reference_items[\s\S]*content_purpose/i);
  assert.match(crawlerRepository, /enqueueSourceContentTopic[\s\S]*contentPurpose[\s\S]*source\.content_purpose/i);
  assert.doesNotMatch(
    crawlerRepository,
    /content_purpose\s+in\s*\(\s*'informational',\s*'marketing',\s*'both'\s*\)/i,
  );
});

test("content orchestration PostgreSQL command portably enables its integration tests", async () => {
  const [packageJson, runner] = await Promise.all([
    readJson("apps/api/package.json"),
    readFile("scripts/run-content-orchestration-postgres-tests.mjs", "utf8"),
  ]);
  assert.equal(
    packageJson.scripts["test:content-orchestration-postgres"],
    "node ../../scripts/run-content-orchestration-postgres-tests.mjs",
  );
  assert.match(runner, /RUN_POSTGRES_INTEGRATION:\s*"true"/);
  assert.match(runner, /contentOrchestrationRepository\.postgres\.integration\.test\.ts/);
  assert.match(runner, /--maxWorkers=1/);
});

test("061은 대표 이미지를 우선 보존하고 avatar별 checksum 중복을 차단한다", async () => {
  const [migration, programRegistry] = await Promise.all([
    readFile("db/migrations/061_avatar_image_checksum_uniqueness.sql", "utf8"),
    readFile(
      "docs/superpowers/specs/2026-07-25-d-hybrid-internal-ai-reference-onboarding-design.md",
      "utf8",
    ),
  ]);

  assert.match(programRegistry, /\|\s*059\s*\|\s*reference snapshot,\s*usage policy,[^|]+\|\s*Libraries\s*\|/i);
  assert.match(programRegistry, /\|\s*060\s*\|\s*proposal batch,[^|]+GenerationBrief[^|]+\|\s*Content Creation\s*\|/i);
  assert.match(migration, /depends\s+on:\s+058_avatar_and_reference_libraries\.sql\s+only/i);
  assert.match(migration, /array_agg\s*\(\s*id\s+order\s+by\s+is_representative\s+desc,\s*position\s+asc,\s*created_at\s+asc,\s*id\s+asc\s*\)/i);
  assert.match(migration, /min\s*\(\s*position\s*\)\s+as\s+retained_position/i);
  assert.match(migration, /delete\s+from\s+brand_avatar_images[\s\S]*image\.id\s*<>\s*survivor\.survivor_id/i);
  assert.match(migration, /update\s+brand_avatar_images[\s\S]*set\s+position\s*=\s*survivor\.retained_position/i);
  assert.match(migration, /set\s+constraints\s+brand_avatar_images_commit_state\s+immediate/i);
  assert.match(
    migration,
    /create\s+unique\s+index\s+if\s+not\s+exists\s+brand_avatar_images_avatar_checksum_unique\s+on\s+brand_avatar_images\s*\(\s*avatar_id,\s*checksum\s*\)/i,
  );
});

test("057은 Wiki source kind를 schema와 API/worker 계약 전체에서 일치시킨다", async () => {
  const [migration, apiWiki, compiledTypes, compiledSource] = await Promise.all([
    readFile("db/migrations/057_wiki_source_kinds.sql", "utf8"),
    readFile("apps/api/src/wiki.ts", "utf8"),
    readFile("workers/brand-pilot-dm-worker/src/compiledWikiTypes.ts", "utf8"),
    readFile("workers/brand-pilot-dm-worker/src/compiledWikiSource.ts", "utf8"),
  ]);
  const sourceKinds = [
    "faq",
    "product",
    "product_service",
    "service",
    "policy",
    "guide",
    "owned_snapshot",
  ];

  for (const [table, constraint] of [
    ["wiki_build_items", "wiki_build_items_source_kind_check"],
    ["wiki_documents", "wiki_documents_source_kind_check"],
    ["wiki_source_units", "wiki_source_units_source_kind_check"],
  ]) {
    assertExactSqlValues(
      extractAddedCheckConstraintBody(migration, table, constraint),
      sourceKinds,
    );
  }

  const expectedUnion = sourceKinds.map((kind) => `"${kind}"`).join(" | ");
  for (const [name, source] of [
    ["API Wiki", apiWiki],
    ["compiled Wiki types", compiledTypes],
  ]) {
    assert.ok(
      source.includes(`export type WikiSourceKind = ${expectedUnion};`),
      `${name} WikiSourceKind must match migration 057`,
    );
  }
  assert.match(compiledTypes, /export function parseWikiSourceKind/);
  assert.match(compiledSource, /directWikiUnitType\(source\)/);
});

test("적용된 기존 마이그레이션은 원본 체크섬을 유지한다", async () => {
  const expectedChecksums = new Map([
    [
      "db/migrations/031_content_performance_dashboard.sql",
      "8517fe3cfe469065387c9e20d5165a9daa6932ba4a0ef3d19c0c53b5e5c0a015",
    ],
    [
      "db/migrations/033_compounding_wiki_pgvector.sql",
      "9cd196aad1b9dcc1e7b1bbd5d47c16343cd04e5652f5ca376ff16eb5d8dd405b",
    ],
    [
      "db/migrations/055_brand_core_and_rules.sql",
      "0e5159e9c0f7ad031fabfeb2ed7973cbb1c670e8b64bf723419031a0f4ab311b",
    ],
    [
      "db/migrations/056_product_service_library.sql",
      "3b3c9f6887d3f396c106a4a95cea6e4aa321c5dac0784c16a45fe2356a2b1b74",
    ],
    [
      "db/migrations/057_wiki_source_kinds.sql",
      "77773df7091ae962faf1de4d073d7819ba34a991d23d1d4e1d6d4bb1958f2aaa",
    ],
  ]);

  for (const [path, expectedChecksum] of expectedChecksums) {
    const migration = await readFile(path);
    assert.equal(createHash("sha256").update(migration).digest("hex"), expectedChecksum);
  }
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

test("자동 크롤링은 지원하지 않는 Vercel Cron 대신 외부 또는 로컬 스케줄러를 사용한다", async () => {
  const vercel = await readJson("apps/api/vercel.json");
  assert.equal(vercel.crons, undefined);

  const envExample = await readFile("apps/api/.env.example", "utf8");
  assert.match(envExample, /^CRON_SECRET=$/m);
  assert.match(envExample, /^SOURCE_CRAWL_BATCH_SIZE=5$/m);
  assert.match(envExample, /^SOURCE_CRAWL_DISCOVERY_LIMIT=20$/m);
  assert.match(envExample, /^SOURCE_CRAWL_TIME_BUDGET_MS=45000$/m);
  assert.match(envExample, /^LOCAL_SCHEDULER_ENABLED=false$/m);
});

test("게시 실행은 인증된 GET cron 경로를 유지하고 로컬 runner로 대체되지 않는다", async () => {
  const [httpServer, index, envExample] = await Promise.all([
    readFile("apps/api/src/httpServer.ts", "utf8"),
    readFile("apps/api/src/index.ts", "utf8"),
    readFile("deploy/env/api.env.example", "utf8"),
  ]);

  assert.match(envExample, /^LOCAL_SCHEDULER_ENABLED=false$/m);
  assert.match(
    index,
    /if\s*\(runtimeConfig\.schedulerEnabled\)\s*\{\s*startLocalScheduler\(repository\);/s,
    "the existing local scheduler must remain explicitly opt-in",
  );
  assert.equal(
    [...index.matchAll(/\bstartLocalScheduler\s*\(\s*repository\s*\)/g)].length,
    1,
    "no additional local publishing runner may replace the managed cron caller",
  );
  const routeStart = httpServer.search(/app\.get\(\s*["']\/internal\/cron\/publish-due["']/);
  assert.notEqual(routeStart, -1, "GET /internal/cron/publish-due must remain registered");
  const sourceAfterRouteStart = httpServer.slice(routeStart + 1);
  const nextRouteOffset = sourceAfterRouteStart.search(
    /\n\s*app\.(?:get|post|put|patch|delete)\b/,
  );
  assert.notEqual(nextRouteOffset, -1, "publish-due handler must be bounded by the next route");
  const routeHandler = httpServer.slice(routeStart, routeStart + 1 + nextRouteOffset);
  const authenticationIndex = routeHandler.indexOf("matchesBearerSecret(");
  const unauthorizedIndex = routeHandler.indexOf("reply.code(401)");
  const publishingIndex = routeHandler.indexOf("repository.runDuePublishing(");

  assert.notEqual(authenticationIndex, -1, "publish-due must check the cron bearer secret");
  assert.ok(
    unauthorizedIndex > authenticationIndex && unauthorizedIndex < publishingIndex,
    "publish-due must return 401 on failed authentication before publishing",
  );
  assert.ok(
    publishingIndex > authenticationIndex,
    "publish-due must authenticate before running due publishing",
  );
  assert.equal(
    /app\.post\(\s*["']\/internal\/cron\/publish-due["']/.test(httpServer),
    false,
    "publish-due must not be replaced with a POST trigger",
  );
});

test("legacy 콘텐츠 smoke는 제거된 V1 경로를 호출하지 않고 fail-closed 한다", async () => {
  const smoke = await readFile("scripts/ai-content-smoke.mjs", "utf8");
  assert.match(smoke, /ai_content_smoke_replaced_by_authenticated_browser_canary/);
  assert.match(smoke, /zero_writes/);
  assert.doesNotMatch(smoke, /content-orchestration\.v1|analysis_ready|ai-content\.v1|marketing-worker/);
});

test("subject smoke도 legacy generation host를 만들지 않고 fail-closed 한다", async () => {
  const smoke = await readFile("scripts/ai-content-subject-smoke.mjs", "utf8");
  assert.match(smoke, /subject_smoke_generation_id_required/);
  assert.match(smoke, /existing proposal-v2 generation/);
  assert.match(smoke, /zero_writes/);
  assert.doesNotMatch(smoke, /method:\s*"POST"[\s\S]{0,300}?\/ai-content\/generations|analysis_ready|ai-content\.v1/);
});

test("D-hybrid 브라우저 사양은 계획의 13개 흐름과 영상 생성 차단을 명시한다", async () => {
  const e2e = await readFile("apps/customer-ui/e2e/d-hybrid-content-wizard.spec.ts", "utf8");
  for (const marker of [
    "accordion-lazy-load",
    "informational-url-evidence",
    "marketing-reference-preview",
    "brand-topic-card-news",
    "saved-product-blog-reference-roles",
    "new-product-single-image-avatar",
    "channel-text-no-image-job",
    "reload-resume-selection",
    "usage-limit-double-submit",
    "channel-capability-refresh",
    "reference-seed-resume",
    "performance-proposal-tenant-guard",
    "scheduled-proposal-review-dismiss",
  ]) {
    assert.match(e2e, new RegExp(marker));
  }
  assert.match(e2e, /video|reel/i);
  assert.match(e2e, /not\.toHaveBeenCalled|toHaveCount\(0\)|requests.*0/i);
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

test("Instagram 해시태그 운영 문서는 Meta 출시 전제와 제한된 롤백을 명시한다", async () => {
  const operations = await readFile(
    "docs/operations/INSTAGRAM_HASHTAG_TRENDS.md",
    "utf8",
  );
  for (const required of [
    "Instagram Public Content Access",
    "Advanced Access",
    "connected Professional Instagram account",
    "rolling seven-day 30 unique hashtag limit",
    "no access token in browser/network responses",
    "disable only the sidebar/route",
    "category data",
  ]) {
    assert.match(operations, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});

test("Instagram trend smoke 계약은 비밀값 없는 순차 호출과 재귀 JSON 검사를 정의한다", async () => {
  const smoke = await readFile("scripts/instagram-trend-smoke.mjs", "utf8");
  for (const variable of [
    "BRAND_PILOT_API_URL",
    "BRAND_PILOT_SESSION_COOKIE",
    "BRAND_PILOT_SMOKE_BRAND_ID",
    "BRAND_PILOT_SMOKE_HASHTAG",
  ]) {
    assert.match(smoke, new RegExp(`process\\.env\\.${variable}`));
  }
  assert.match(smoke, /items\.length\s*<=\s*50/);
  assert.match(smoke, /secondSearch\.source,\s*["']cache["']/);
  assert.match(smoke, /secondSearch\.refreshed,\s*false/);
  assert.match(smoke, /secondSave\.alreadySaved,\s*true/);
  assert.match(smoke, /(?:token|secret|credential)/i);
  assert.match(smoke, /Object\.entries\s*\(/);
  assert.match(smoke, /HEAD|GET/);

  const search = smoke.indexOf("/instagram-trends/search");
  const page = smoke.indexOf("/instagram-trends?", search);
  const save = smoke.indexOf("/save-source", page);
  assert.ok(search >= 0 && page > search && save > page);
  assert.match(smoke, /method:\s*["']POST["']/g);
});

test("루트 패키지는 Instagram trend smoke 명령을 정의한다", async () => {
  const packageJson = await readJson("package.json");
  assert.equal(
    packageJson.scripts["smoke:instagram-trends"],
    "node scripts/instagram-trend-smoke.mjs",
  );
});

test("Instagram trend smoke는 비-2xx secret payload를 출력하지 않는다", async () => {
  const secret = "server-secret-must-not-escape";
  const server = createServer((_request, response) => {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: secret }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await assert.rejects(
      execFileAsync(process.execPath, ["scripts/instagram-trend-smoke.mjs"], {
        env: {
          ...process.env,
          BRAND_PILOT_API_URL: `http://127.0.0.1:${address.port}`,
          BRAND_PILOT_SESSION_COOKIE: "bp_session=contract-test",
          BRAND_PILOT_SMOKE_BRAND_ID: "brand-1",
          BRAND_PILOT_SMOKE_HASHTAG: "contract-test",
        },
      }),
      (error) => {
        const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
        assert.doesNotMatch(output, new RegExp(secret));
        assert.match(output, /request_failed: POST status=500/);
        return true;
      },
    );
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("Instagram trend smoke는 세션 쿠키를 비보안 원격 API로 보내지 않는다", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/instagram-trend-smoke.mjs"], {
      env: {
        ...process.env,
        BRAND_PILOT_API_URL: "http://example.com",
        BRAND_PILOT_SESSION_COOKIE: "bp_session=must-not-be-sent",
        BRAND_PILOT_SMOKE_BRAND_ID: "brand-smoke",
        BRAND_PILOT_SMOKE_HASHTAG: "콘텐츠마케팅",
      },
    }),
    (error) => {
      assert.match(error.stderr, /invalid_environment: BRAND_PILOT_API_URL/);
      assert.doesNotMatch(error.stderr, /must-not-be-sent/);
      return true;
    },
  );
});
