import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");
const publishWorkflowPath = "../.github/workflows/publish-brand-pilot-server-images.yml";
const baselineRecoveryWorkflowPath = "../.github/workflows/recover-brand-pilot-production-baseline.yml";
const ubuntuRunbookPath = "docs/operations/UBUNTU_DEPLOYMENT.md";
const oauthCutoverRunbookPath = "docs/operations/OAUTH_CUTOVER.md";
const previewAuthRunbookPath = "docs/operations/VERCEL_PREVIEW_AUTH.md";
const ubuntuBootstrapPath = "deploy/scripts/bootstrap-ubuntu.sh";
const legacyReleaseSha = "02aa2bcae3f66d494f16a26bec9055cac17464f9";
const deploymentArtifacts = [
  ".dockerignore",
  "apps/api/Dockerfile",
  "workers/brand-pilot-dm-worker/Dockerfile",
  "workers/brand-pilot-content-proposal-worker/Dockerfile",
  "workers/brand-pilot-brand-intelligence-worker/Dockerfile",
  "workers/brand-pilot-subject-analysis-worker/Dockerfile",
  "workers/brand-pilot-image-worker/Dockerfile",
  "workers/brand-pilot-card-news-worker/Dockerfile",
  "workers/brand-pilot-blog-worker/Dockerfile",
  "workers/brand-pilot-reel-worker/Dockerfile",
  "workers/brand-pilot-publish-scheduler/Dockerfile",
  "deploy/compose.production.yml",
  "deploy/Caddyfile",
  "deploy/Caddyfile.canary",
  "deploy/release.env.example",
  "deploy/env/api.env.example",
  "deploy/env/dm-worker.env.example",
  "deploy/env/wiki-worker.env.example",
  "deploy/env/content-proposal-worker.env.example",
  "deploy/env/brand-intelligence-worker.env.example",
  "deploy/env/subject-analysis-worker.env.example",
  "deploy/env/image-worker.env.example",
  "deploy/env/card-news-worker.env.example",
  "deploy/env/blog-worker.env.example",
  "deploy/env/reel-worker.env.example",
  "deploy/env/publish-scheduler.env.example",
  "deploy/scripts/preflight.sh",
  "deploy/scripts/preflight-ai-content.sh",
  "deploy/scripts/stage-ai-content-release.sh",
  "deploy/scripts/rollout-ai-content-cutover.sh",
  "deploy/scripts/collect-ai-content-backend-evidence.sh",
  "deploy/scripts/deploy.sh",
  "deploy/scripts/rollout-workers.sh",
  "deploy/scripts/lib.sh",
  "deploy/scripts/verify-canary.sh",
  "deploy/scripts/promote.sh",
  "deploy/scripts/rollback.sh",
  "deploy/scripts/backup-state.sh",
  "deploy/scripts/restore-state.sh",
  ubuntuRunbookPath,
  oauthCutoverRunbookPath,
  ubuntuBootstrapPath,
];

const deploymentScripts = [
  "deploy/scripts/lib.sh",
  "deploy/scripts/preflight.sh",
  "deploy/scripts/preflight-ai-content.sh",
  "deploy/scripts/stage-ai-content-release.sh",
  "deploy/scripts/rollout-ai-content-cutover.sh",
  "deploy/scripts/collect-ai-content-backend-evidence.sh",
  "deploy/scripts/deploy.sh",
  "deploy/scripts/rollout-workers.sh",
  "deploy/scripts/verify-canary.sh",
  "deploy/scripts/promote.sh",
  "deploy/scripts/rollback.sh",
  "deploy/scripts/backup-state.sh",
  "deploy/scripts/restore-state.sh",
  ubuntuBootstrapPath,
];

test("cutover API image contains ordered migrations through weekly schedule storage 092", () => {
  const dockerfile = read("apps/api/Dockerfile");
  const migrate = read("scripts/migrate.mjs");
  const runner = read("scripts/migrationRunner.mjs");
  const migration074 = read("db/migrations/074_ai_content_maintenance_write_fence.sql");
  assert.match(dockerfile, /db\/migrations/);
  assert.match(dockerfile, /scripts\/migrationRunner\.mjs/);
  assert.match(dockerfile, /scripts\/migrate\.mjs/);
  assert.match(dockerfile, /scripts\/databaseTls\.mjs/);
  assert.match(dockerfile, /RUN chmod -R a\+rX \/app/);
  assert.equal(existsSync("db/migrations/074_ai_content_maintenance_write_fence.sql"), true);
  assert.equal(existsSync("db/migrations/075_ai_content_three_format_cutover.sql"), true);
  assert.equal(existsSync("db/migrations/076_manual_content_generation_brand_rules.sql"), true);
  assert.equal(existsSync("db/migrations/077_content_suggestion_batches.sql"), true);
  assert.equal(existsSync("db/migrations/078_faq_utterance_matching.sql"), true);
  assert.equal(existsSync("db/migrations/079_publish_calendar_runtime.sql"), true);
  assert.equal(existsSync("db/migrations/080_reference_channel_archive.sql"), true);
  assert.equal(existsSync("db/migrations/081_meta_ad_library_references.sql"), true);
  assert.equal(existsSync("db/migrations/082_manual_brand_visual_assets.sql"), true);
  assert.equal(existsSync("db/migrations/083_manual_visual_selection_write_fence_invoker.sql"), true);
  assert.equal(existsSync("db/migrations/084_ai_content_usage_reversal_identity_invoker.sql"), true);
  assert.equal(existsSync("db/migrations/085_publish_calendar_idempotency_expand.sql"), true);
  assert.equal(existsSync("db/migrations/086_publish_calendar_same_time_contract.sql"), true);
  assert.equal(existsSync("db/migrations/087_ai_content_prompt_lineage_v3.sql"), true);
  assert.equal(existsSync("db/migrations/088_onboarding_product_image_imports.sql"), true);
  assert.equal(existsSync("db/migrations/089_free_subscription_plan.sql"), true);
  assert.equal(existsSync("db/migrations/090_existing_brand_free_subscriptions.sql"), true);
  assert.equal(existsSync("db/migrations/091_ai_content_prompt_lineage_v4.sql"), true);
  assert.equal(existsSync("db/migrations/092_publish_calendar_weekly_schedule.sql"), true);
  assert.match(migrate, /AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_FILE/);
  assert.match(migrate, /AI_CONTENT_074_PROVIDER_ATTESTATION_PUBLIC_KEY_FILE/);
  assert.doesNotMatch(migrate, /readFile\([^\n]*(?:PRIVATE|SIGNING)|createPrivateKey|AI_CONTENT_074_(?:AUTHORIZATION|PROVIDER_ATTESTATION)_KEY_FILE/);
  assert.doesNotMatch(runner, /createPrivateKey|createSign|\bsign\s*\(/);
  assert.match(runner, /bootstrap_role_membership_catalog_v2/);
  assert.match(runner, /set_option[\s\S]*inherit_option[\s\S]*admin_option/);
  assert.match(migration074, /current_setting\('role',\s*true\)/);
  assert.equal(existsSync("scripts/ai-content-074.postgres.integration.test.mjs"), true);
  const postgresHarness = read("scripts/ai-content-074.postgres.integration.test.mjs");
  assert.match(postgresHarness, /from\s+["']@testcontainers\/postgresql["']/);
  assert.match(postgresHarness, /new\s+PostgreSqlContainer\(["']postgres:16-alpine["']\)/);
  assert.doesNotMatch(postgresHarness, /AI_CONTENT_074_(?:REAL_POSTGRES_URL|ENABLE_REAL_POSTGRES_TESTS)/);
  assert.doesNotMatch(postgresHarness, /\bt\.skip\s*\(|\bskip\s*:/);
  assert.match(postgresHarness, /assert\.match\([^\n]*version[^\n]*PostgreSQL 16\\\./);
  assert.match(postgresHarness, /requires an empty disposable database/);
  assert.match(postgresHarness, /to_regclass\('public\.workspaces'\)/);
  assert.match(postgresHarness, /finally\s*\{[\s\S]*Promise\.allSettled[\s\S]*container\.stop\(\)[\s\S]*AggregateError/);
  assert.match(postgresHarness, /AI_CONTENT_074_BULK_DML_MAX_OVERHEAD_RATIO/);
  assert.match(postgresHarness, /migration.*schema_owner/is);
  assert.match(postgresHarness, /disable trigger|drop trigger|ai_content_ddl_allowlist|ai_content_bootstrap_state|ai_content_maintenance_state|ai_content_cutovers/is);
  assert.match(postgresHarness, /allowlisted.*ddl.*succeed|positive.*allowlist/is);
  assert.match(postgresHarness, /rogue.*schema.*owner|schema.*owner.*rogue/is);
  assert.doesNotMatch(postgresHarness, /with\s+set\s+true\s*,/i);
  assert.match(postgresHarness, /create index public\.ai_content_074_arbitrary_index/i);
  for (const classifier of ["whole_relation", "legacy_automated_topic", "scheduled_proposal_refresh",
    "legacy_content_job", "ai_content_generated_artifact", "ai_content_scheduled_publish",
    "ai_content_publish_attempt", "daily_generation_automation"]) {
    assert.match(postgresHarness, new RegExp(classifier));
  }
  assert.match(postgresHarness, /perBranchThreshold|maxObservedRatio/);
});

test("deployment applies or verifies the pinned post-075 data migration before canary mutation", () => {
  const deploy = read("deploy/scripts/deploy.sh");
  assert.match(deploy, /076_manual_content_generation_brand_rules\.sql/);
  assert.match(deploy, /da42c957d4307d58c1f37f5d508c8a1f14836727080d6290e4b0537e43167604/);
  assert.match(deploy, /AI_CONTENT_POST_075_PROVIDER_DATABASE_URL_FILE/);
  assert.match(deploy, /scripts\/migrate\.mjs --post-075-data/);
  assert.match(deploy, /post-075-data-migration-evidence\.v1/);
  const migrationGate = deploy.lastIndexOf("run_post_075_data_migration_gate");
  const transition = deploy.indexOf("begin_transition");
  const canary = deploy.indexOf('"${compose[@]}" up -d --no-deps');
  assert.ok(migrationGate >= 0 && migrationGate < transition && transition < canary);
});

test("deployment applies the ordered post-075 schemas through weekly schedule storage 092 before canary mutation", () => {
  const deploy = read("deploy/scripts/deploy.sh");
  const runner = read("scripts/migrationRunner.mjs");
  assert.match(runner, /077_content_suggestion_batches\.sql/);
  assert.match(runner, /3b178464c5ae5c4e220428e0752ab3e79a2ca06b5b2b23f1e89c34e983e63f76/);
  assert.match(runner, /078_faq_utterance_matching\.sql/);
  assert.match(runner, /a2c481f4ea5aba0430668d8e87d236f0a301a695cbecb4874400de0896aecde5/);
  assert.match(runner, /079_publish_calendar_runtime\.sql/);
  assert.match(runner, /c46ffafa578f6c1f8bb353f4e7bc94d16033416dd5a6aa730cf81119e6e6ef61/);
  assert.match(runner, /080_reference_channel_archive\.sql/);
  assert.match(runner, /9067430f0e8fbc6d52455ef5fcf712820fe405e4fca0e51835b6cd0552ce7fe0/);
  assert.match(runner, /081_meta_ad_library_references\.sql/);
  assert.match(runner, /232f4ee76b7812b0a9399ee3124b4542e5c6f01c0d5d37ecb786b0b41c25f9ef/);
  assert.match(runner, /082_manual_brand_visual_assets\.sql/);
  assert.match(runner, /9285dbc36d5dc17d33c0d53545e69bc3deb800679ef2409d2727e83dc5230b1e/);
  assert.match(runner, /083_manual_visual_selection_write_fence_invoker\.sql/);
  assert.match(runner, /d2a788802e460ab1815f4e859616dc0e9a702f6cb45d0f6578b7fba4a6a74296/);
  assert.match(runner, /084_ai_content_usage_reversal_identity_invoker\.sql/);
  assert.match(runner, /31938a77b6b2b278b608e32de48cc463ceda24b7c96622b0662aacc3c0978f12/);
  assert.match(runner, /085_publish_calendar_idempotency_expand\.sql/);
  assert.match(runner, /1601035eee057da39cac63c6e9a187fcd3331d590414005d2971a943306d22de/);
  assert.match(runner, /086_publish_calendar_same_time_contract\.sql/);
  assert.match(runner, /89b5e23a3535ca4d8c11eb8ebd274317cc414bd482d70b93bb0b6f2c379b0abb/);
  assert.match(runner, /087_ai_content_prompt_lineage_v3\.sql/);
  assert.match(runner, /bb5c9cbc2b78654e7bbdd988af929b634671cc2e794cbd46b8cf5c9fd5d5b359/);
  assert.match(runner, /088_onboarding_product_image_imports\.sql/);
  assert.match(runner, /a83e1adecd9df47980051328c2a6bde13a3c0c58a6636f21462d77800299374c/);
  assert.match(runner, /089_free_subscription_plan\.sql/);
  assert.match(runner, /fd58a829eb658b0ac650e033a5edd085ec452a6eb0420251c60abcd51231267a/);
  assert.match(runner, /090_existing_brand_free_subscriptions\.sql/);
  assert.match(runner, /8134f35d21f72f7418b5502bb5cfb10c8f296f147788bcd8b539d6d930588552/);
  assert.match(runner, /091_ai_content_prompt_lineage_v4\.sql/);
  assert.match(runner, /05696c55ee959cd80ef7cdf30fcb07e93e0579da515042ebd8e8aafb9cde5e10/);
  assert.match(runner, /092_publish_calendar_weekly_schedule\.sql/);
  assert.match(runner, /c1bf905666ce4dabac137c0522fa0dc0300f574eda6d1e9648283f00b2af4d2b/);
  assert.match(deploy, /POST_075_SCHEMA_MIGRATION_ID="092_publish_calendar_weekly_schedule\.sql"/);
  assert.match(deploy, /POST_075_SCHEMA_MIGRATION_SHA256="c1bf905666ce4dabac137c0522fa0dc0300f574eda6d1e9648283f00b2af4d2b"/);
  assert.match(deploy, /scripts\/migrate\.mjs --post-075-schema/);
  assert.match(deploy, /post-075-schema-migration-evidence\.v1/);
  const dataGate = deploy.lastIndexOf("run_post_075_data_migration_gate");
  const schemaGate = deploy.lastIndexOf("run_post_075_schema_migration_gate");
  const transition = deploy.indexOf("begin_transition");
  const canary = deploy.indexOf('"${compose[@]}" up -d --no-deps');
  assert.ok(dataGate >= 0 && dataGate < schemaGate && schemaGate < transition && transition < canary);
});

test("publish calendar catalog permits the canonical FREE plan when 079 and 089 are applied together", () => {
  const runner = read("scripts/migrationRunner.mjs");
  assert.match(
    runner,
    /requireEmptyPlanCatalog:\s*pendingSchemaMigrations\.some\(\s*\(\{ id \}\) => id === "079_publish_calendar_runtime\.sql",\s*\)\s*&&\s*!pendingSchemaMigrations\.some\(\s*\(\{ id \}\) => id === "089_free_subscription_plan\.sql",\s*\)/,
  );
});

test("FAQ schema migration fails fast instead of waiting indefinitely on live locks", () => {
  const migration = read("db/migrations/078_faq_utterance_matching.sql");
  assert.match(migration, /set local lock_timeout = '5s'/i);
  assert.match(migration, /set local statement_timeout = '60s'/i);
  assert.match(migration, /faq_suggestion_items_example_utterances_count_check[\s\S]*cardinality\(example_utterances\) = 0 or cardinality\(example_utterances\) between 3 and 8/i);
  assert.match(migration, /faq_alias_suggestion_results_count_check[\s\S]*cardinality\(example_utterances\) between 3 and 8/i);
});

test("publish calendar schema fails fast while adding the existing topic group tenant key", () => {
  const migration = read("db/migrations/079_publish_calendar_runtime.sql");
  assert.match(migration, /begin;\s*set local lock_timeout = '5s';\s*set local statement_timeout = '60s';/i);
  assert.match(migration, /alter table topic_publish_groups[\s\S]*topic_publish_groups_tenant_identity_unique/i);
});

test("publish calendar idempotency expansion fails fast on live schema locks", () => {
  const migration = read("db/migrations/085_publish_calendar_idempotency_expand.sql");
  assert.match(migration, /begin;\s*set local lock_timeout = '5s';\s*set local statement_timeout = '60s';/i);
});

test("publish calendar same-time contract is fail-closed DDL with no row modifications", () => {
  const migration = read("db/migrations/086_publish_calendar_same_time_contract.sql");
  assert.equal(migration, [
    "begin;",
    "",
    "set local lock_timeout = '5s';",
    "",
    "drop index publish_calendar_slots_active_brand_time_unique;",
    "",
    "drop index publish_calendar_slots_generation_unique;",
    "",
    "create unique index publish_calendar_slots_generation_unique",
    "  on publish_calendar_slots(brand_id,generation_id)",
    "  where generation_id is not null and generation_output_id is null and status <> 'cancelled';",
    "",
    "commit;",
    "",
  ].join("\n"));
  assert.doesNotMatch(migration, /\bif\s+exists\b/i);
  assert.doesNotMatch(migration, /\b(?:insert|update|delete|merge|truncate)\b/i);
});

test("AI content prompt lineage migration is bounded and preserves exact v2/v3 tuples", () => {
  const migration = read("db/migrations/087_ai_content_prompt_lineage_v3.sql");
  assert.match(migration, /begin;\s*set local lock_timeout = '5s';\s*set local statement_timeout = '60s';/i);
  assert.match(migration, /proposal_prompt_version = 'proposal\.writer\.v2'[\s\S]*contract_source_sha256 = '02760a[0-9a-f]+'[\s\S]*catalog_sha256 = '41ac04[0-9a-f]+'/i);
  assert.match(migration, /proposal_prompt_version = 'proposal\.writer\.v3'[\s\S]*contract_source_sha256 = 'ecada3[0-9a-f]+'[\s\S]*catalog_sha256 = '415ca4[0-9a-f]+'/i);
  assert.match(migration, /ai_content_generation_prompt_bindings_proposal_lineage_check/i);
  assert.doesNotMatch(migration, /\b(?:insert|update|delete|merge|truncate)\b/i);
});

test("onboarding product image import migration is bounded and grants only the required job-table mutations", () => {
  const migration = read("db/migrations/088_onboarding_product_image_imports.sql");
  assert.match(migration, /begin;\s*set local lock_timeout = '5s';\s*set local statement_timeout = '60s';/i);
  assert.match(migration, /create table public\.product_service_image_import_jobs/i);
  assert.match(migration, /product_service_versions_import_job_identity_unique[\s\S]*unique \(id,product_service_id,workspace_id,brand_id\)/i);
  assert.match(migration, /foreign key \(product_service_version_id,product_service_id,workspace_id,brand_id\)[\s\S]*references public\.product_service_versions\(id,product_service_id,workspace_id,brand_id\)/i);
  assert.match(migration, /unique \(product_service_version_id\)/i);
  assert.match(migration, /jsonb_array_length\(source_urls_json\) between 1 and 5/i);
  assert.match(migration, /jsonb_path_query_array\(source_urls_json,'\$\[\*\] \? \(@ like_regex "\^https:\/\/"\)'\)=source_urls_json/i);
  assert.match(migration, /alter table public\.product_service_image_import_jobs owner to/i);
  assert.match(migration, /revoke all on table public\.product_service_image_import_jobs from public/i);
  assert.match(migration, /grant select,insert,update on table public\.product_service_image_import_jobs/i);
  assert.doesNotMatch(migration, /grant [^;]*delete[^;]*product_service_image_import_jobs/i);
  assert.match(migration, /commit;\s*$/i);
});

test("FREE subscription plan migration is bounded and refuses conflicting operator data", () => {
  const migration = read("db/migrations/089_free_subscription_plan.sql");
  assert.match(migration, /begin;\s*set local lock_timeout = '5s';\s*set local statement_timeout = '60s';/i);
  assert.match(migration, /code\s*=\s*'free'[\s\S]*name\s*=\s*'FREE'[\s\S]*weekly_generation_limit\s*=\s*30[\s\S]*weekly_publish_limit\s*=\s*30/i);
  assert.match(migration, /raise exception 'free_subscription_plan_conflict'/i);
  assert.doesNotMatch(migration, /on conflict[\s\S]*do update/i);
});

test("existing-brand FREE subscription migration is bounded and never rewrites an existing subscription", () => {
  const migration = read("db/migrations/090_existing_brand_free_subscriptions.sql");
  assert.match(migration, /begin;\s*set local lock_timeout = '5s';\s*set local statement_timeout = '60s';/i);
  assert.match(migration, /insert into brand_subscriptions/i);
  assert.match(migration, /brand\.deleted_at is null[\s\S]*subscription\.brand_id is null/i);
  assert.match(migration, /subscription_started_at \+ interval '1 month'/i);
  assert.doesNotMatch(migration, /\b(?:update|delete|merge|truncate)\b/i);
  assert.doesNotMatch(migration, /on conflict[\s\S]*do update/i);
});

test("AI content prompt lineage v4 migration is append-only and preserves v2/v3 branches", () => {
  const migration = read("db/migrations/091_ai_content_prompt_lineage_v4.sql");
  assert.match(migration, /begin;\s*set local lock_timeout = '5s';\s*set local statement_timeout = '60s';/i);
  assert.match(migration, /proposal_prompt_version = 'proposal\.writer\.v2'[\s\S]*contract_source_sha256 = '02760a[0-9a-f]+'[\s\S]*catalog_sha256 = '41ac04[0-9a-f]+'/i);
  assert.match(migration, /proposal_prompt_version = 'proposal\.writer\.v3'[\s\S]*contract_source_sha256 = 'ecada3[0-9a-f]+'[\s\S]*catalog_sha256 = '415ca4[0-9a-f]+'/i);
  assert.match(migration, /proposal_prompt_version = 'proposal\.writer\.v4'[\s\S]*contract_source_sha256 = 'e607bb[0-9a-f]+'[\s\S]*catalog_sha256 = '6d983b[0-9a-f]+'/i);
  assert.match(migration, /not valid[\s\S]*validate constraint[\s\S]*drop constraint[\s\S]*rename constraint/i);
  assert.doesNotMatch(migration, /\b(?:insert|update|delete|merge|truncate)\b/i);
});

test("weekly schedule migration scrubs provider default ACLs before granting exact application CRUD", () => {
  const migration = read("db/migrations/092_publish_calendar_weekly_schedule.sql");
  const runner = read("scripts/migrationRunner.mjs");
  assert.match(migration, /aclexplode\s*\(\s*coalesce\s*\(\s*relation\.relacl\s*,\s*acldefault\s*\(\s*'r'\s*,\s*relation\.relowner\s*\)\s*\)\s*\)/i);
  assert.match(migration, /if\s+acl_grantee\.grantee\s*=\s*0\s+then[\s\S]*revoke all on table public\.publish_calendar_weekly_schedule_entries from public/i);
  assert.doesNotMatch(migration, /acl_grantee\.grantee_role_name\s*=\s*'PUBLIC'/i);
  assert.match(migration, /format\(\s*'revoke all on table public\.publish_calendar_weekly_schedule_entries from %I'/i);
  assert.match(migration, /grant select,insert,update,delete on public\.publish_calendar_weekly_schedule_entries to %I/i);
  assert.doesNotMatch(migration, /publish_calendar_weekly_(?:schema_owner|application|acl_leak)/i);
  assert.match(runner, /weekly_schedule_unexpected_acl_count/);
  assert.match(runner, /sealed\.weekly_schedule_unexpected_acl_count\s*!==\s*0/);
});

test("FAQ runbook excludes Wiki without permanently disabling generic Wiki rollouts", () => {
  const rollout = read("deploy/scripts/rollout-workers.sh");
  const runbook = read("docs/operations/faq-utterance-matching-rollout.md");
  assert.match(rollout, /WORKER_ROLLOUT_EXCLUDED_SERVICES="\$\{WORKER_ROLLOUT_EXCLUDED_SERVICES:-\}"/);
  assert.match(rollout, /case "\$WORKER_ROLLOUT_EXCLUDED_SERVICES"[\s\S]*""\) ;;[\s\S]*wiki-worker-1\) ;;[\s\S]*worker_rollout_exclusion_invalid/);
  assert.match(runbook, /export WORKER_ROLLOUT_EXCLUDED_SERVICES=wiki-worker-1/);
  assert.match(rollout, /WIKI_WORKER_IMAGE[\s\S]*continue/);
});

test("Card News rollout rejects a stale live planner command before pulling or mutating workers", () => {
  const rollout = read("deploy/scripts/rollout-workers.sh");
  assert.match(rollout, /CARD_NEWS_CODEX_PLAN_COMMAND=node scripts\/run-codex-card-manuscript-plan\.mjs --job "\{\{jobFile\}\}" --output "\{\{outputDir\}\}"/);
  assert.match(rollout, /grep -Ec '\^CARD_NEWS_CODEX_PLAN_COMMAND='/);
  assert.match(rollout, /grep -Fxc -- "\$expected_card_news_planner_command"/);
  assert.match(rollout, /fail "card_news_planner_command_invalid"/);
  const validation = rollout.indexOf('fail "card_news_planner_command_invalid"');
  const candidatePull = rollout.indexOf('docker pull --quiet "${CANDIDATE_IMAGES[$image_key]}"');
  const mutation = rollout.indexOf("ROLLOUT_MUTATED=true");
  assert.ok(validation >= 0 && validation < candidatePull && candidatePull < mutation);
});

test("stored schema evidence never replaces a fresh live database verification", () => {
  const deploy = read("deploy/scripts/deploy.sh");
  const gate = deploy.slice(
    deploy.indexOf("run_post_075_schema_migration_gate()"),
    deploy.indexOf("run_cutover_preflight()"),
  );
  assert.match(gate, /validate_post_075_schema_migration_evidence/);
  assert.match(gate, /scripts\/migrate\.mjs --post-075-schema/);
  assert.doesNotMatch(gate, /validate_post_075_schema_migration_evidence "\$evidence_file"\s*\n\s*return/);
  assert.match(gate, /output="\$\(docker run[\s\S]*scripts\/migrate\.mjs --post-075-schema\)"/);
  assert.match(gate, /atomic_write "\$evidence_file" "\$\{output\}"/);
  assert.equal((gate.match(/validate_post_075_schema_migration_evidence "\$evidence_file"/g) ?? []).length, 1);
  assert.ok(gate.indexOf("/app/scripts/migrate.mjs --post-075-schema")
    < gate.indexOf('validate_post_075_schema_migration_evidence "$evidence_file"'));
});

test("cutover API image contains both ordered migrations in an actual no-network container", {
  skip: process.env.RUN_DOCKER_FENCE_IMAGE_INSPECTION !== "1",
}, () => {
  const tag = `brand-pilot-fence-contract:${process.pid}`;
  const build = spawnSync("docker", ["build", "--file", "apps/api/Dockerfile", "--tag", tag, "."], {
    encoding: "utf8",
    timeout: 15 * 60_000,
  });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  try {
    const script = [
      "const fs=require('node:fs');",
      "const required=['/app/db/migrations/074_ai_content_maintenance_write_fence.sql','/app/db/migrations/075_ai_content_three_format_cutover.sql','/app/db/migrations/076_manual_content_generation_brand_rules.sql','/app/db/migrations/077_content_suggestion_batches.sql','/app/db/migrations/078_faq_utterance_matching.sql','/app/db/migrations/079_publish_calendar_runtime.sql','/app/db/migrations/080_reference_channel_archive.sql','/app/db/migrations/081_meta_ad_library_references.sql','/app/db/migrations/082_manual_brand_visual_assets.sql','/app/db/migrations/083_manual_visual_selection_write_fence_invoker.sql','/app/db/migrations/084_ai_content_usage_reversal_identity_invoker.sql','/app/db/migrations/085_publish_calendar_idempotency_expand.sql','/app/db/migrations/086_publish_calendar_same_time_contract.sql','/app/db/migrations/087_ai_content_prompt_lineage_v3.sql','/app/db/migrations/088_onboarding_product_image_imports.sql','/app/db/migrations/089_free_subscription_plan.sql','/app/db/migrations/090_existing_brand_free_subscriptions.sql','/app/db/migrations/091_ai_content_prompt_lineage_v4.sql','/app/db/migrations/092_publish_calendar_weekly_schedule.sql','/app/scripts/migrationRunner.mjs','/app/scripts/migrate.mjs','/app/scripts/databaseTls.mjs'];",
      "for(const path of required)if(!fs.existsSync(path))throw new Error('missing:'+path);",
    ].join("");
    const inspect = spawnSync("docker", ["run", "--rm", "--network", "none", "--entrypoint", "node", tag, "-e", script], {
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(inspect.status, 0, `${inspect.stdout}\n${inspect.stderr}`);
  } finally {
    spawnSync("docker", ["image", "rm", "--force", tag], { encoding: "utf8", timeout: 60_000 });
  }
});

test("Task 10 canary is read-only, authenticated, and proves safe feature flags", () => {
  const verify = read("deploy/scripts/verify-canary.sh");
  for (const marker of [
    "/health",
    "/ready",
    "cors_allowed",
    "cors_denied",
    "secure_cookie",
    "/auth/meta/dev-complete",
    "/auth/me",
    "/brand-core",
    "/product-services",
    "/wiki/status",
    "/ai-content/usage",
    "/channels/capabilities",
    "features.scheduler",
    "features.publishing",
    "features.dm",
    "CANARY_SESSION_COOKIE_FILE",
    "CANARY_BRAND_ID",
  ]) {
    assert.ok(verify.includes(marker), `canary verifier missing ${marker}`);
  }
  assert.match(verify, /require_file_mode_600/);
  assert.match(verify, /Secure/);
  assert.match(verify, /HttpOnly/);
  assert.match(verify, /SameSite=Lax/);
  assert.doesNotMatch(verify, /--request\s+(?:POST|PUT|PATCH|DELETE)|\s-X\s*(?:POST|PUT|PATCH|DELETE)/i);
  assert.doesNotMatch(
    verify,
    /--request\s+(?:POST|PUT|PATCH|DELETE)|\/(?:generate|download|publish|send-message|reply)(?:[/?"]|$)/i,
  );
});

test("Task 10 backup metadata excludes secret plaintext and binds promotion state", () => {
  const backup = read("deploy/scripts/backup-state.sh");
  const promote = read("deploy/scripts/promote.sh");
  for (const marker of [
    "PROVIDER_BACKUP_ID",
    "CADDY_BACKUP_ID",
    "CADDY_DATA_SHA256",
    "CURRENT_RELEASE_SHA",
    "CURRENT_IMAGE_DIGEST",
    "RELEASE_MANIFEST_SHA256",
    "EXTERNAL_ENV_SHA256",
  ]) {
    assert.ok(backup.includes(marker), `backup metadata missing ${marker}`);
  }
  assert.match(backup, /flock -n 9/);
  assert.match(backup, /reconcile_transition_or_fail/);
  assert.doesNotMatch(backup, /\b(?:cp|tar|zip|rsync)\b[^\n]*(?:api\.env|env\/|caddy\/data)/i);
  assert.doesNotMatch(backup, /(?:DATABASE_URL|CREDENTIAL_ENCRYPTION_KEY|CLIENT_SECRET|ACCESS_TOKEN)=/);
  assert.match(promote, /PROMOTION_BACKUP_METADATA/);
  assert.match(promote, /validate_promotion_backup_metadata/);
  assert.match(promote, /CURRENT_RELEASE_SHA/);
  assert.match(promote, /CURRENT_IMAGE_DIGEST/);
});

test("Task 10 restore is test-database-only and verifies schema and row counts", () => {
  const restore = read("deploy/scripts/restore-state.sh");
  for (const marker of [
    "--test-database-url-file",
    "--backup-metadata",
    "--expected-schema-version",
    "--row-count-manifest",
    "RESTORE_REHEARSAL_TEST_ONLY",
    "restore_target_database_must_be_test_only",
    "schema_version_mismatch",
    "row_count_mismatch",
    "provider_backup_id",
  ]) {
    assert.ok(restore.includes(marker), `restore contract missing ${marker}`);
  }
  assert.match(restore, /require_file_mode_600/);
  assert.match(restore, /flock -n 9/);
  assert.doesNotMatch(restore, /\beval\b|\bsource\b[^\n]*(?:DATABASE|ENV|metadata)/i);
});

test("Task 10 rollback uses immutable prior digest and documents immediate triggers", () => {
  const rollback = read("deploy/scripts/rollback.sh");
  const runbook = read(ubuntuRunbookPath);
  assert.match(rollback, /OCI_REVISION/);
  assert.match(rollback, /@sha256:/);
  assert.match(rollback, /API_ENV_FILE/);
  assert.match(rollback, /rollback_external_env_mismatch/);
  for (const phrase of [
    "OAuth repeated failure",
    "credential decryption failure",
    "duplicate DM or publish",
    "API interruption longer than 5 minutes",
    "migration mismatch",
    "never runs paid AI generation",
    "never sends a real DM",
    "never publishes to a real SNS channel",
  ]) {
    assert.ok(runbook.includes(phrase), `Ubuntu runbook missing: ${phrase}`);
  }
});

function indentation(line) {
  return line.match(/^ */)[0].length;
}

function parseComposeServices(compose) {
  const lines = compose.split(/\r?\n/);
  const servicesIndex = lines.findIndex((line) => /^services:\s*(?:#.*)?$/.test(line));
  assert.notEqual(servicesIndex, -1, "compose services marker is missing");

  const servicesIndent = indentation(lines[servicesIndex]);
  const sectionEnd = lines.findIndex((line, index) => (
    index > servicesIndex
    && line.trim()
    && !line.trimStart().startsWith("#")
    && indentation(line) <= servicesIndent
  ));
  const end = sectionEnd === -1 ? lines.length : sectionEnd;
  const candidates = lines
    .map((line, index) => ({ line, index, indent: indentation(line) }))
    .slice(servicesIndex + 1, end)
    .filter(({ line, indent }) => (
      indent > servicesIndent
      && /^ *[A-Za-z0-9_.-]+:\s*(?:#.*)?$/.test(line)
    ));
  assert.ok(candidates.length, "compose services block has no service markers");

  const serviceIndent = Math.min(...candidates.map(({ indent }) => indent));
  const markers = candidates.filter(({ indent }) => indent === serviceIndent);
  const services = new Map();
  for (const [position, marker] of markers.entries()) {
    const name = marker.line.trim().split(":", 1)[0];
    const next = markers[position + 1]?.index ?? end;
    services.set(name, {
      indent: serviceIndent,
      text: lines.slice(marker.index, next).join("\n"),
    });
  }
  return services;
}

function parseServiceList(block, key) {
  const lines = block.text.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => (
    indentation(line) > block.indent
    && new RegExp(`^ *${key}:\\s*(?:#.*)?$`).test(line)
  ));
  if (markerIndex === -1) return [];

  const markerIndent = indentation(lines[markerIndex]);
  const values = [];
  for (const line of lines.slice(markerIndex + 1)) {
    if (line.trim() && indentation(line) <= markerIndent) break;
    const item = line.match(/^ *-\s+(.+?)\s*$/);
    if (item) values.push(item[1]);
  }
  return values;
}

function parseWorkflowJob(workflow, name) {
  const lines = workflow.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(markerIndex, -1, `workflow job ${name} is missing`);
  const nextJobIndex = lines.findIndex((line, index) => (
    index > markerIndex && /^ {2}[A-Za-z0-9_-]+:$/.test(line)
  ));
  return lines.slice(markerIndex, nextJobIndex === -1 ? lines.length : nextJobIndex).join("\n");
}

function assertComposeTopology(compose) {
  const services = parseComposeServices(compose);
  assert.ok(services.has("api-primary"), "compose api-primary service marker is missing");
  assert.ok(services.has("api-canary"), "compose api-canary service marker is missing");
  assert.ok(services.has("caddy"), "compose caddy service marker is missing");
  for (const [name, block] of services) {
    if (name === "caddy") continue;
    const hasPorts = block.text.split(/\r?\n/).slice(1).some((line) => (
      indentation(line) > block.indent
      && /^ *ports\s*:/.test(line)
    ));
    assert.equal(hasPorts, false, `${name} service must not define host ports`);
  }
  return services;
}

function hasCaddyLogDirective(caddy) {
  return caddy.split(/\r?\n/).some((line) => {
    const directive = line.trim();
    return Boolean(directive) && !directive.startsWith("#") && /^log(?:\s|$)/.test(directive);
  });
}

function hasShellTracing(script) {
  return script.split(/\r?\n/).some((rawLine) => {
    const line = rawLine.trim();
    if (!line) return false;
    if (line.startsWith("#!")) {
      const tokens = line.split(/\s+/);
      const shellIndex = tokens.findIndex((token) => /(?:^|\/)(?:ba)?sh$/.test(token));
      return shellIndex !== -1 && tokens.slice(shellIndex + 1).some(
        (token) => /^-[A-Za-z]*x[A-Za-z]*$/.test(token) || token === "--xtrace",
      );
    }
    if (line.startsWith("#")) return false;
    const command = line.replace(/\s+#.*$/, "");
    if (/^set\s+-[A-Za-z]*x[A-Za-z]*(?=\s|;|&&|\|\||$)/.test(command)) return true;
    if (/^set\b[^;&|]*(?:^|\s)-o\s+xtrace(?=\s|;|&&|\|\||$)/.test(command)) return true;
    return /^(?:(?:exec|command|sudo)\s+)*(?:env(?:\s+\S+)*\s+)?(?:\S*\/)?bash\s+(?:-[A-Za-z]*x[A-Za-z]*|--xtrace)(?=\s|;|&&|\|\||$)/.test(command);
  });
}

test("production deployment artifacts exist", () => {
  const missing = deploymentArtifacts.filter((path) => !existsSync(path));
  assert.equal(
    missing.length,
    0,
    `missing deployment artifacts:\n${missing.map((path) => `- ${path}`).join("\n")}`,
  );
});

test("preview auth runbook uses one stable origin and an opaque OAuth destination", () => {
  assert.equal(existsSync(previewAuthRunbookPath), true, "preview auth runbook is missing");
  const runbook = read(previewAuthRunbookPath);
  for (const phrase of [
    "https://staging-app.danbammsg.co.kr",
    "AUTH_PREVIEW_FRONTEND_URL=https://staging-app.danbammsg.co.kr",
    "VITE_API_BASE_URL=https://api.danbammsg.co.kr",
    "VITE_AUTH_DESTINATION=preview",
    "destination=preview",
    "CORS_ALLOWED_ORIGINS=https://app.danbammsg.co.kr,https://www.danbammsg.co.kr,https://staging-app.danbammsg.co.kr",
    "Do not use a generated `*.vercel.app` URL",
    "Do not attach the stable alias to an unreviewed pull request",
    "No Ubuntu host or Vercel project is changed by this repository commit",
  ]) {
    assert.ok(runbook.includes(phrase), `preview auth runbook missing: ${phrase}`);
  }
});

test("Ubuntu runbook fixes the initial API/Caddy and gated worker scope with stable public integration URLs", () => {
  const runbook = read(ubuntuRunbookPath);
  for (const phrase of [
    "API + Caddy:",
    "no external customers",
    "Vercel API",
    "48 hours",
    "LM Studio",
    "Tailscale",
    "private SSH",
    "never public ingress",
    "VITE_API_BASE_URL=https://api.danbammsg.co.kr",
    "https://api.danbammsg.co.kr/auth/kakao/callback",
    "https://api.danbammsg.co.kr/auth/meta/callback",
    "https://api.danbammsg.co.kr/auth/meta/trends/callback",
    "https://api.danbammsg.co.kr/webhooks/meta/instagram",
    "CREDENTIAL_ENCRYPTION_KEY",
    "no blanket key reissue",
    "Do not copy",
  ]) {
    assert.ok(runbook.includes(phrase), `Ubuntu runbook missing: ${phrase}`);
  }
  assert.match(runbook, /no\s+db:migrate/i);
  assert.match(runbook, /worker.*scheduler.*publication/i);
  assert.match(runbook, /rotate only.*exposed.*revoked.*provider-required/i);
});

test("Ubuntu runbook provides private SSH, firewall, Docker, and network prerequisite commands", () => {
  const runbook = read(ubuntuRunbookPath);
  for (const command of [
    "curl -fsSL https://tailscale.com/install.sh | sh",
    "sudo tailscale up --hostname=brand-pilot-ubuntu",
    "sudo adduser --disabled-password --gecos \"\" bpdeploy",
    "ssh-keygen -t ed25519 -a 100",
    "PermitRootLogin no",
    "PasswordAuthentication no",
    "KbdInteractiveAuthentication no",
    "PubkeyAuthentication yes",
    "AllowUsers bpdeploy",
    "sudo sshd -t",
    "sudo systemctl reload ssh",
    "sudo ufw allow in on tailscale0 to any port 22 proto tcp",
    "sudo ufw allow 80/tcp",
    "sudo ufw allow 443/tcp",
    "https://download.docker.com/linux/ubuntu/gpg",
    "docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin",
    "docker run --rm hello-world",
    "sudo ./deploy/scripts/bootstrap-ubuntu.sh",
  ]) {
    assert.ok(runbook.includes(command), `Ubuntu runbook missing command: ${command}`);
  }
  for (const phrase of [
    "Ubuntu 24.04",
    "amd64",
    "static LAN IP",
    "CGNAT",
    "dynamic public IP",
    "DDNS",
    "ACME",
    "never forward TCP 22",
    "root-equivalent",
    "new SSH session",
    "host fingerprint",
    "authorized_keys",
    "No exit node",
    "No Funnel",
    "router forwards only TCP 80/443",
  ]) {
    assert.ok(runbook.includes(phrase), `Ubuntu runbook missing: ${phrase}`);
  }
  assert.match(runbook, /ssh -i .*brand-pilot-ubuntu.*bpdeploy@<TAILSCALE_IP_OR_NAME>/);
});

test("Ubuntu runbook separates the Tailscale management plane from public DNS and ingress", () => {
  const runbook = read(ubuntuRunbookPath);
  const normalizedRunbook = runbook.replace(/\s+/g, " ");
  const deploymentBoundary = [
    runbook,
    read("deploy/compose.production.yml"),
    read("deploy/Caddyfile"),
    read("deploy/Caddyfile.canary"),
    ...deploymentScripts.map(read),
  ].join("\n");

  for (const phrase of [
    "management plane only",
    "`brand-pilot-dev-windows`",
    "`brand-pilot-ubuntu`",
    "`tailscale status`",
    "Do not hard-code Tailscale IP addresses",
    "public OAuth and webhook DNS must never resolve to a Tailscale IP",
    "`api.danbammsg.co.kr` and `canary-api.danbammsg.co.kr`",
    "public Ubuntu IPv4",
    "working public Ubuntu IPv6",
    "`app.danbammsg.co.kr` remains a Vercel custom domain",
    "never TCP 22, 4000, or 5432",
    "port 4000 is Docker-internal `expose` only",
    "Before public DNS propagation",
    "After public DNS propagation",
  ]) {
    assert.ok(
      normalizedRunbook.includes(phrase),
      `Ubuntu runbook missing network boundary detail: ${phrase}`,
    );
  }

  for (const command of [
    "tailscale status",
    "sudo ufw allow in on tailscale0 to any port 22 proto tcp",
    "sudo ufw deny 22/tcp",
    "sudo ufw deny 4000/tcp",
    "sudo ufw deny 5432/tcp",
    "curl --resolve canary-api.danbammsg.co.kr:443:<PUBLIC_IPV4>",
    "curl --fail https://canary-api.danbammsg.co.kr/health",
    "curl --fail https://canary-api.danbammsg.co.kr/ready",
  ]) {
    assert.ok(runbook.includes(command), `Ubuntu runbook missing network command: ${command}`);
  }
  assert.doesNotMatch(
    deploymentBoundary,
    /100\.90\.110\.88|100\.106\.196\.48/,
    "deployment docs and automation must not pin current Tailscale addresses",
  );
});

test("Ubuntu runbook is command-ready for env, artifact integrity, canary, rollback, and cutover", () => {
  const runbook = read(ubuntuRunbookPath);
  for (const phrase of [
    "/opt/brand-pilot/shared/env/api.env",
    "chmod 600",
    "DB_POOL_MAX=3",
    "DB_SSL_CA_BASE64",
    "LOCAL_SCHEDULER_ENABLED=false",
    "INSTAGRAM_PUBLISH_ENABLED=false",
    "least privilege",
    "GHCR",
    "exact commit",
    "exact SHA",
    "release.env.sha256",
    "release-integrity.sha256",
    "API_IMAGE",
    "CADDY_IMAGE",
    "canary-api.danbammsg.co.kr",
    "TTL 300",
    "api-primary",
    "api-canary",
    "caddy",
    "state/candidate",
    "state/previous",
    "1.1.1.1",
    "8.8.8.8",
    "60 minutes",
    "scheduler",
    "publication",
    "no database migration",
    "Incremental Codex worker activation",
  ]) {
    assert.ok(runbook.includes(phrase), `Ubuntu runbook missing: ${phrase}`);
  }
  for (const command of [
    "./scripts/deploy.sh /opt/brand-pilot/incoming/release.env --phase canary",
    "./scripts/verify-canary.sh https://canary-api.danbammsg.co.kr https://app.danbammsg.co.kr",
    "./scripts/rollback.sh --release \"$candidate_sha\" --phase canary",
    "./scripts/promote.sh --prepare",
    "./scripts/promote.sh --commit --dns-cutover-confirmed",
    "./scripts/rollback.sh --previous --phase production",
    "curl --fail https://canary-api.danbammsg.co.kr/health",
    "curl --fail https://canary-api.danbammsg.co.kr/ready",
    "docker compose",
    "config --quiet",
  ]) {
    assert.ok(runbook.includes(command), `Ubuntu runbook missing command: ${command}`);
  }
  assert.doesNotMatch(runbook, /docker compose config(?!\s+--quiet)/);
});

test("Ubuntu runbook documents the fail-closed first TLS cutover and recovery sequence", () => {
  const runbook = read(ubuntuRunbookPath);
  const normalizedRunbook = runbook.replace(/\s+/g, " ");

  for (const phrase of [
    "Caddyfile.canary",
    "does not request a certificate for `api.danbammsg.co.kr`",
    "`--prepare` starts and health-checks `api-primary`",
    "does not change Caddy, poll an external URL, or mutate",
    "`--commit` without `--dns-cutover-confirmed` fails before Docker",
    "waits for the primary TLS `/ready` response before",
    "restores the canary-only Caddy configuration",
  ]) {
    assert.ok(
      normalizedRunbook.includes(phrase),
      `Ubuntu runbook missing cutover detail: ${phrase}`,
    );
  }

  const prepareIndex = runbook.indexOf("./scripts/promote.sh --prepare");
  const firstResolverIndex = runbook.indexOf("dig +short api.danbammsg.co.kr @1.1.1.1");
  const secondResolverIndex = runbook.indexOf("dig +short api.danbammsg.co.kr @8.8.8.8");
  const commitIndex = runbook.indexOf(
    "./scripts/promote.sh --commit --dns-cutover-confirmed",
  );
  assert.ok(prepareIndex >= 0, "runbook must prepare the primary");
  assert.ok(firstResolverIndex > prepareIndex, "DNS must change after primary prewarm");
  assert.ok(secondResolverIndex > firstResolverIndex, "both public resolvers must be checked");
  assert.ok(commitIndex > secondResolverIndex, "confirmed commit must follow resolver checks");

  assert.match(
    runbook,
    /After reconnecting over Tailscale:\s*```bash\s*cd \/opt\/brand-pilot\/repo\/brand_poilot\/deploy/,
  );
  assert.ok(
    normalizedRunbook.includes(
      "On the trusted operator machine, use Git Bash or WSL for these POSIX commands:",
    ),
    "artifact commands must name the required Windows shell",
  );
  assert.match(runbook, /sudo rm -f \/tmp\/bootstrap-ubuntu\.sh/);
  assert.doesNotMatch(runbook, /(?<!sudo )rm -f \/tmp\/bootstrap-ubuntu\.sh/);
});

test("Ubuntu runbook documents candidate-bound offline preparation and transactional commit", () => {
  const runbook = read(ubuntuRunbookPath);
  const normalizedRunbook = runbook.replace(/\s+/g, " ");

  for (const phrase of [
    "`--prepare` pulls and preloads both `api-primary` and `caddy`",
    "`org.opencontainers.image.revision`",
    "`--network none`",
    "`state/prepared`",
    "`RELEASE_SHA`",
    "`API_IMAGE` and `CADDY_IMAGE` digests",
    "`release-integrity.sha256`",
    "`CANARY_HOST` and `PRIMARY_HOST` must be different",
    "`--commit --dns-cutover-confirmed` requires a valid candidate-bound `state/prepared` proof",
    "`--pull never`",
    "does not contact the registry",
    "external primary TLS `/ready`",
    "transactionally",
    "`error=recovery_failed`",
    "restored endpoint does not pass readiness",
  ]) {
    assert.ok(
      normalizedRunbook.includes(phrase),
      `Ubuntu runbook missing offline promotion detail: ${phrase}`,
    );
  }
});

test("Ubuntu runbook documents durable transition recovery and host invariants", () => {
  const runbook = read(ubuntuRunbookPath);
  const normalizedRunbook = runbook.replace(/\s+/g, " ");

  for (const phrase of [
    "`deploy.sh`, `preflight.sh`, `promote.sh`, and `rollback.sh`",
    "acquire `state/deploy.lock` before",
    "`state/transition.journal`",
    "`state/current`, `state/candidate`, `state/previous`, and `state/prepared`",
    "first promotion recovery restores `Caddyfile.canary` and removes `api-primary`",
    "mode 600",
    "leaves `state/transition.journal` in place",
    "`error=recovery_failed` and exits with status 70",
    "must not delete `state/transition.journal` manually",
    "`CANARY_HOST` and `PRIMARY_HOST` must each match between the current and candidate releases",
    "`state/prepared` is never restored from the journal",
    "removes `state/prepared` fail-closed",
    "rerun `./scripts/promote.sh --prepare` before commit",
    "Canary rollback also invalidates `state/prepared`",
    "every locked entrypoint reports `error=recovery_failed` and exits with status 70",
    "`deploy.sh`, `promote.sh`, `rollback.sh`, and journal reconciliation enforce the same host pair",
    "Production rollback requires an existing current or candidate runtime state",
  ]) {
    assert.ok(
      normalizedRunbook.includes(phrase),
      `Ubuntu runbook missing transition recovery detail: ${phrase}`,
    );
  }

  assert.match(
    runbook,
    /\.\/scripts\/preflight\.sh "\/opt\/brand-pilot\/releases\/<VERIFIED_RELEASE_SHA>\/release\.env"/,
  );
  assert.match(
    runbook,
    /stat -c '%U %a %n' \/opt\/brand-pilot\/state\/transition\.journal/,
  );
  assert.doesNotMatch(
    normalizedRunbook,
    /restores the journaled `state\/current`, `state\/candidate`, `state\/previous`, and `state\/prepared` snapshot/,
  );
});

test("Ubuntu runbook separates administrator and bpdeploy permissions and protects incoming artifacts", () => {
  const runbook = read(ubuntuRunbookPath);
  const bpdeployHeadings = [...runbook.matchAll(/^#{2,4} \[bpdeploy Tailscale SSH\].*$/gm)];
  const administratorHeadings = [
    ...runbook.matchAll(/^#{2,4} \[Ubuntu 관리자 콘솔\/기존 sudo 관리자\].*$/gm),
  ];
  assert.ok(bpdeployHeadings.length >= 4, "expected explicit bpdeploy operator sections");
  assert.ok(administratorHeadings.length >= 4, "expected explicit administrator sections");
  assert.match(runbook, /bpdeploy has no sudo by design/i);
  assert.match(runbook, /do not grant.*broad sudo/i);

  const headingPattern = /^#{2,4} /gm;
  for (const heading of bpdeployHeadings) {
    headingPattern.lastIndex = heading.index + heading[0].length;
    const nextHeading = headingPattern.exec(runbook);
    const block = runbook.slice(heading.index, nextHeading?.index ?? runbook.length);
    assert.doesNotMatch(
      block,
      /\bsudo(?:edit)?\b/,
      `bpdeploy section must not contain sudo: ${heading[0]}`,
    );
  }

  const envHeading = bpdeployHeadings.find((heading) => heading[0].includes("api.env"));
  assert.ok(envHeading, "expected a bpdeploy api.env section");
  headingPattern.lastIndex = envHeading.index + envHeading[0].length;
  const nextEnvHeading = headingPattern.exec(runbook);
  const envBlock = runbook.slice(envHeading.index, nextEnvHeading?.index ?? runbook.length);
  assert.match(envBlock, /install -m 0600[^]*api\.env\.example[^]*api\.env/);
  assert.match(envBlock, /\bchmod 600 [^\n]*api\.env/);
  assert.match(envBlock, /\bstat -c [^\n]*api\.env/);
  assert.doesNotMatch(envBlock, /\bchown\b/);

  const artifactHeading = bpdeployHeadings.find((heading) =>
    heading[0].includes("release artifact"),
  );
  assert.ok(artifactHeading, "expected a bpdeploy release artifact section");
  headingPattern.lastIndex = artifactHeading.index + artifactHeading[0].length;
  const nextArtifactHeading = headingPattern.exec(runbook);
  const artifactBlock = runbook.slice(
    artifactHeading.index,
    nextArtifactHeading?.index ?? runbook.length,
  );
  const chmodCommand =
    "chmod 600 /opt/brand-pilot/incoming/release.env /opt/brand-pilot/incoming/release.env.sha256";
  const statCommand = "stat -c '%U %a %n'";
  assert.ok(artifactBlock.includes(chmodCommand), "incoming artifacts must become mode 600");
  assert.ok(artifactBlock.includes(statCommand), "incoming artifact owner/mode must be shown");
  assert.match(artifactBlock, /bpdeploy 600/);
  assert.ok(
    artifactBlock.indexOf(chmodCommand) < artifactBlock.indexOf(statCommand) &&
      artifactBlock.indexOf(statCommand) < artifactBlock.indexOf("sha256sum --check"),
    "chmod and owner/mode verification must precede checksum verification",
  );
});

test("Ubuntu bootstrap is strict, root-only, idempotent, and creates safe owned paths", () => {
  const script = read(ubuntuBootstrapPath);
  assert.match(script, /^#!\/usr\/bin\/env bash\nset -Eeuo pipefail\n/);
  assert.equal(hasShellTracing(script), false);
  assert.match(script, /\bEUID\b[\s\S]*root_required/);
  assert.match(script, /\/etc\/os-release/);
  assert.match(script, /VERSION_ID[\s\S]*24\\?\.04|24\\?\.04[\s\S]*VERSION_ID/);
  assert.match(script, /dpkg --print-architecture[\s\S]*amd64/);
  assert.match(script, /id -u bpdeploy/);
  assert.match(script, /ROOT="\/opt\/brand-pilot"/);
  assert.match(script, /realpath -m/);
  assert.match(script, /-L/);
  for (const path of ["repo", "incoming", "releases"]) {
    assert.match(script, new RegExp(`install -d -m 0750[^\\n]*\\$ROOT/${path}`));
  }
  for (const path of ["state", "shared", "shared/env", "shared/codex"]) {
    assert.match(script, new RegExp(`install -d -m 0700[^\\n]*\\$ROOT/${path}`));
  }
  assert.match(script, /-o bpdeploy -g bpdeploy/);
  assert.doesNotMatch(script, /\b(?:touch|cat|printf)\b[^\n]*(?:api\.env|secret|credential)/i);
  const bash = findBash();
  assert.ok(bash, "Bash is required for Ubuntu bootstrap syntax validation");
  const syntax = spawnSync(bash, ["-n", ubuntuBootstrapPath], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("only Caddy publishes host ports", () => {
  const compose = read("deploy/compose.production.yml");
  const services = assertComposeTopology(compose);
  const primaryBlock = services.get("api-primary").text;
  const canaryBlock = services.get("api-canary").text;
  const caddyBlock = services.get("caddy").text;
  for (const apiBlock of [primaryBlock, canaryBlock]) {
    assert.match(apiBlock, /LOCAL_SCHEDULER_ENABLED:\s*"false"/);
    assert.doesNotMatch(apiBlock, /^\s+INSTAGRAM_PUBLISH_ENABLED:/m);
    assert.match(apiBlock, /^ {4}expose:\s*\r?\n {6}- "4000"$/m);
  }
  for (const [name, service] of services) {
    if (!/^(?:dm-worker|wiki-worker)/.test(name)) continue;
    assert.match(
      service.text,
      /^\s{4}profiles:/m,
      `first-deploy topology must keep ${name} behind an explicit profile`,
    );
  }
  assert.match(
    primaryBlock,
    /\$\{PRIMARY_API_IMAGE:-\$\{API_IMAGE:\?API_IMAGE is required\}\}/,
  );
  assert.match(
    canaryBlock,
    /\$\{CANDIDATE_API_IMAGE:-\$\{API_IMAGE:\?API_IMAGE is required\}\}/,
  );
  assert.match(caddyBlock, /"80:80"/);
  assert.match(caddyBlock, /"443:443"/);
});

test("production keeps publish scheduling external and every API local scheduler disabled", () => {
  const compose = read("deploy/compose.production.yml");
  const services = assertComposeTopology(compose);

  for (const serviceName of ["api-primary", "api-canary"]) {
    assert.equal(
      services.get(serviceName).text.match(/LOCAL_SCHEDULER_ENABLED:\s*"false"/g)?.length,
      1,
      `${serviceName} must explicitly disable its local scheduler`,
    );
  }
  assert.equal(
    services.get("api-primary").text.match(/^\s+API_INSTANCE_ROLE:\s+primary\s*$/gm)?.length,
    1,
    "api-primary must have the explicit primary scheduler role",
  );
  assert.equal(
    services.get("api-canary").text.match(/^\s+API_INSTANCE_ROLE:\s+canary\s*$/gm)?.length,
    1,
    "api-canary must have the explicit canary scheduler role",
  );
  for (const [serviceName, service] of services) {
    assert.doesNotMatch(
      service.text,
      /^\s+LOCAL_SCHEDULER_ENABLED:\s*"?true"?\s*$/m,
      `${serviceName} must not enable the local scheduler`,
    );
    const lines = service.text.split(/\r?\n/);
    const commandStart = lines.findIndex((line) => (
      indentation(line) === service.indent + 2 && line.trimStart().startsWith("command:")
    ));
    if (commandStart === -1) continue;
    const nextPropertyOffset = lines.slice(commandStart + 1).findIndex((line) => (
      line.trim() && indentation(line) <= service.indent + 2
    ));
    const commandEnd = nextPropertyOffset === -1
      ? lines.length : commandStart + 1 + nextPropertyOffset;
    const commandBlock = lines.slice(commandStart, commandEnd).join("\n");
    assert.doesNotMatch(
      commandBlock,
      /publish|calendar/i,
      `${serviceName} must not define a local publish/calendar runner command`,
    );
  }
});

test("publish scheduler is an isolated hardened singleton profile with only its cron secret", () => {
  const compose = read("deploy/compose.production.yml");
  const services = assertComposeTopology(compose);
  const scheduler = services.get("publish-scheduler-1")?.text ?? "";
  const envExample = read("deploy/env/publish-scheduler.env.example");
  const releaseExample = read("deploy/release.env.example");
  const dockerfile = read("workers/brand-pilot-publish-scheduler/Dockerfile");

  assert.match(scheduler, /^ {4}profiles:\s*\r?\n {6}- "publish-scheduler"$/m);
  assert.equal(compose.match(/^ {2}publish-scheduler-\d+:$/gm)?.length, 1);
  assert.match(scheduler, /image: \$\{PUBLISH_SCHEDULER_IMAGE:\?PUBLISH_SCHEDULER_IMAGE is required\}/);
  assert.match(scheduler, /PRIMARY_API_INTERNAL_URL: http:\/\/api-primary:4000/);
  assert.match(scheduler, /CRON_SECRET_FILE: \/run\/secrets\/cron-secret/);
  assert.match(scheduler, /PUBLISH_TICK_MS: "60000"/);
  assert.match(scheduler, /PUBLISH_TIMEOUT_MS: "240000"/);
  assert.match(scheduler, /read_only: true/);
  assert.match(scheduler, /cap_drop:\s*\r?\n\s+- ALL/);
  assert.match(scheduler, /no-new-privileges:true/);
  assert.match(scheduler, /tmpfs:\s*\r?\n\s+- \/tmp:/);
  assert.match(scheduler, /restart: unless-stopped/);
  assert.match(scheduler, /healthcheck:/);
  assert.equal(scheduler.match(/\/run\/secrets\//g)?.length, 2, "only env and mount may name cron secret");
  assert.match(scheduler, /\/opt\/brand-pilot\/shared\/secrets\/cron-secret\}:\/run\/secrets\/cron-secret:ro/);
  assert.doesNotMatch(scheduler, /DATABASE|SUPABASE|META_|BLOB|CODEX_(?:HOME|ACCOUNT)|auth\.json/i);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(envExample, /^PRIMARY_API_INTERNAL_URL=http:\/\/api-primary:4000$/m);
  assert.match(envExample, /^CRON_SECRET_FILE=\/run\/secrets\/cron-secret$/m);
  assert.match(envExample, /^PUBLISH_TICK_MS=60000$/m);
  assert.match(envExample, /^PUBLISH_TIMEOUT_MS=240000$/m);
  assert.doesNotMatch(envExample, /CRON_SECRET=|DATABASE|SUPABASE|META_|BLOB|CODEX/i);
  assert.match(releaseExample, /^PUBLISH_SCHEDULER_IMAGE=required-at-deploy-time$/m);
  assert.match(releaseExample, /^PUBLISH_SCHEDULER_SOURCE_SHA=required-at-deploy-time$/m);
  assert.match(releaseExample, /^PUBLISH_SCHEDULER_CHANGED=true-or-false$/m);
});

test("scheduler release tooling provisions one 0600 secret and targets no unrelated service", () => {
  const preflight = read("deploy/scripts/preflight.sh");
  const deploy = read("deploy/scripts/deploy.sh");
  const rollback = read("deploy/scripts/rollback.sh");
  const lib = read("deploy/scripts/lib.sh");

  assert.match(lib, /shared\/secrets\/cron-secret/);
  assert.match(preflight, /require_publish_scheduler_secret/);
  assert.match(preflight, /require_publish_scheduler_environment_file/);
  assert.match(preflight, /require_file_mode_600[^\n]*CRON_SECRET_FILE/);
  assert.match(preflight, /status_ok "publish_scheduler_secret"/);
  assert.match(lib, /PUBLISH_SCHEDULER_IMAGE/);
  assert.match(lib, /publish_scheduler_image_revision_mismatch/);
  assert.match(lib, /publish_scheduler_release_sha_mismatch/);
  assert.match(lib, /publish_scheduler_environment_unknown_key/);
  assert.match(lib, /publish-scheduler-1/);
  assert.match(deploy, /--component[\s\S]*publish-scheduler/);
  assert.match(rollback, /--component[\s\S]*publish-scheduler/);
  assert.match(lib, /pull publish-scheduler-1/);
  assert.match(lib, /up -d --no-deps --pull never --force-recreate --wait[\s\S]*publish-scheduler-1/);
  assert.match(lib, /stop --timeout 30 publish-scheduler-1/);
  assert.match(lib, /rm -f publish-scheduler-1/);
  const deployBranch = deploy.match(/if \[\[ "\$DEPLOY_MODE" == "publish-scheduler" \]\]; then([\s\S]*?)\nfi/)?.[1] ?? "";
  const rollbackBranch = rollback.match(/if \[\[ "\$ROLLBACK_MODE" == "publish-scheduler" \]\]; then([\s\S]*?)\nfi/)?.[1] ?? "";
  assert.doesNotMatch(deployBranch, /reconcile_transition|enforce_ai_content|api-primary|api-canary|caddy/);
  assert.doesNotMatch(rollbackBranch, /reconcile_transition|enforce_ai_content|api-primary|api-canary|caddy/);
  assert.match(deployBranch, /transition\.journal/);
  assert.match(rollbackBranch, /transition\.journal/);
  assert.match(lib, /publish-scheduler-transition\.journal/);
  assert.match(lib, /publish-scheduler-previous/);
  assert.match(lib, /PRIOR_ACTIVE/);
  assert.match(lib, /PRIOR_IMAGE/);
  assert.match(lib, /PRIOR_REVISION/);
  assert.match(lib, /restore_publish_scheduler_snapshot/);
  assert.match(lib, /publish_scheduler_transition_stale/);
  assert.match(lib, /trap [^\n]*publish_scheduler/);
  assert.doesNotMatch(rollback, /disable_publish_scheduler_release/);
  assert.match(rollback, /--component[^\n]*publish-scheduler[^\n]*--previous/);
  assert.match(rollback, /rollback_publish_scheduler_release/);
});

test("scheduler transition contract preserves disabled and active snapshots without unrelated mutations", () => {
  const lib = read("deploy/scripts/lib.sh");
  const section = (start, end) => lib.slice(lib.indexOf(`${start}() {`), lib.indexOf(`${end}() {`));
  const deployFunction = section("deploy_publish_scheduler_release", "rollback_publish_scheduler_release");
  const rollbackFunction = section("rollback_publish_scheduler_release", "verify_release_image_revision");
  const applyFunction = section("apply_publish_scheduler_snapshot", "restore_publish_scheduler_snapshot");

  assert.match(deployFunction, /inspect_publish_scheduler_runtime/);
  assert.match(deployFunction, /write_publish_scheduler_state[^\n]*deploy/);
  assert.match(deployFunction, /restore_publish_scheduler_snapshot/);
  assert.match(deployFunction, /remove_state_file "\$transition"/);
  assert.match(rollbackFunction, /expected_active/);
  assert.match(rollbackFunction, /expected_image/);
  assert.match(rollbackFunction, /expected_revision/);
  assert.match(rollbackFunction, /restore_publish_scheduler_snapshot/);
  assert.match(rollbackFunction, /remove_state_file "\$previous"/);
  assert.match(applyFunction, /if \[\[ "\$active" == "true" \]\]/);
  assert.match(applyFunction, /PUBLISH_SCHEDULER_IMAGE="\$image"/);
  assert.match(applyFunction, /stop --timeout 30 publish-scheduler-1/);
  assert.match(applyFunction, /rm -f publish-scheduler-1/);
  assert.ok(deployFunction.indexOf("inspect_publish_scheduler_runtime") < deployFunction.indexOf("pull publish-scheduler-1"));
  assert.ok(deployFunction.indexOf("inspect_publish_scheduler_runtime") < deployFunction.indexOf("write_publish_scheduler_state"));
  assert.ok(rollbackFunction.indexOf("inspect_publish_scheduler_runtime") < rollbackFunction.indexOf("write_publish_scheduler_state"));
  for (const source of [deployFunction, rollbackFunction, applyFunction]) {
    assert.doesNotMatch(source, /\b(?:api-canary|caddy|dm-worker|wiki-worker)\b.*(?:up|stop|rm|restart)/);
    assert.doesNotMatch(source, /mapfile[^\n]*< </);
  }
});

test("scheduler ps failures propagate before disabled-state mutation", () => {
  const libPath = bashPath("deploy/scripts/lib.sh");
  const bash = findBash();
  const common = `source '${libPath}'\n` +
    `docker() { printf 'docker-call=%s\\n' "$*" >&2; if [[ "$1" == compose && "$*" == *" ps "* ]]; then return 23; fi; return 0; }\n`;
  for (const invocation of [
    `inspect_publish_scheduler_runtime /release`,
    `apply_publish_scheduler_snapshot /release 10 false NONE NONE`,
  ]) {
    const result = spawnSync(bash, ["-lc", `${common}${invocation}`], { encoding: "utf8" });
    assert.notEqual(result.status, 0, invocation);
    const calls = result.stderr;
    assert.match(calls, / ps /);
    assert.doesNotMatch(calls, / (?:up|stop|rm|restart) /);
  }
});

test("Instagram publication is enabled from shared API env with exact safe contracts", () => {
  const envExample = read("deploy/env/api.env.example");
  const compose = read("deploy/compose.production.yml");
  const services = assertComposeTopology(compose);
  const preflight = read("deploy/scripts/preflight.sh");
  const verify = read("deploy/scripts/verify-canary.sh");

  assert.equal(envExample.match(/^INSTAGRAM_PUBLISH_ENABLED=true$/gm)?.length, 1);
  assert.equal(envExample.match(/^INSTAGRAM_PUBLISH_ENABLED=/gm)?.length, 1);
  for (const service of ["api-primary", "api-canary"]) {
    assert.doesNotMatch(services.get(service).text, /^\s+INSTAGRAM_PUBLISH_ENABLED:/m);
  }
  assert.match(
    preflight,
    /require_exact_boolean\s+"INSTAGRAM_PUBLISH_ENABLED"\s+"true"\s+"\$API_ENV_FILE"/,
  );
  assert.match(
    preflight,
    /require_exact_boolean\s+"LOCAL_SCHEDULER_ENABLED"\s+"false"\s+"\$API_ENV_FILE"/,
  );
  assert.match(verify, /\.features\.publishing\s*==\s*"enabled"/);
  assert.match(verify, /\.features\.scheduler\s*==\s*"disabled"/);
  assert.match(verify, /tr -d '\\r'/);
  for (const capabilityContract of [
    /\.channel\s*==\s*"instagram"/,
    /\.enabled\s*==\s*true/,
    /\.connectionStatus\s*==\s*"connected"/,
    /\.readiness\s*==\s*"ready"/,
    /\.reasonCode\s*==\s*null/,
    /index\("card_news"\)/,
    /index\("instagram_feed_single"\)/,
    /index\("instagram_feed_carousel"\)/,
  ]) {
    assert.match(verify, capabilityContract);
  }
});

test("publication preflight accepts one exact true and rejects unsafe variants", () => {
  const bash = findBash();
  assert.ok(bash, "Bash is required for the publication flag contract");
  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-publication-flag-"));
  const apiEnv = join(fixture, "api.env");
  const run = (contents) => {
    writeFileSync(apiEnv, contents, { mode: 0o600 });
    return spawnSync(bash, [
      "-c",
      'source "$1"; require_exact_boolean "INSTAGRAM_PUBLISH_ENABLED" "true" "$2"',
      "_",
      bashPath("deploy/scripts/lib.sh"),
      bashPath(apiEnv),
    ], { cwd: process.cwd(), encoding: "utf8" });
  };

  try {
    assert.equal(run("INSTAGRAM_PUBLISH_ENABLED=true\n").status, 0);
    for (const unsafe of [
      "INSTAGRAM_PUBLISH_ENABLED=false\n",
      "LOCAL_SCHEDULER_ENABLED=false\n",
      "INSTAGRAM_PUBLISH_ENABLED=true\nINSTAGRAM_PUBLISH_ENABLED=true\n",
      "INSTAGRAM_PUBLISH_ENABLED=TRUE\n",
    ]) {
      const result = run(unsafe);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /error=safe_runtime_flag_invalid/);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("Proposal prompt cutover mode admits only the coordinated kill-switch state", () => {
  const bash = findBash();
  assert.ok(bash, "Bash is required for the Proposal cutover flag contract");
  const preflight = read("deploy/scripts/preflight.sh");
  const caseBlock = preflight.match(
    /case "\$\{AI_CONTENT_PROPOSAL_PROMPT_CUTOVER_MODE:-false\}" in[\s\S]*?^esac$/m,
  )?.[0];
  assert.ok(caseBlock, "preflight must define the Proposal prompt cutover mode branch");

  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-proposal-cutover-"));
  const apiEnv = join(fixture, "api.env");
  const harness = join(fixture, "proposal-cutover.sh");
  writeFileSync(harness, [
    "#!/usr/bin/env bash",
    "set -Eeuo pipefail",
    'source "$1"',
    'API_ENV_FILE="$2"',
    caseBlock,
    "",
  ].join("\n"), { mode: 0o700 });

  const run = ({ mode, enabled: proposalEnabled }) => {
    writeFileSync(apiEnv, `CONTENT_PROPOSALS_ENABLED=${proposalEnabled}\n`, { mode: 0o600 });
    const env = { ...process.env };
    delete env.AI_CONTENT_PROPOSAL_PROMPT_CUTOVER_MODE;
    if (mode !== undefined) env.AI_CONTENT_PROPOSAL_PROMPT_CUTOVER_MODE = mode;
    return spawnSync(bash, [bashPath(harness), bashPath("deploy/scripts/lib.sh"), bashPath(apiEnv)], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    });
  };

  try {
    assert.equal(run({ enabled: "true" }).status, 0);
    assert.notEqual(run({ enabled: "false" }).status, 0);
    assert.equal(run({ mode: "true", enabled: "false" }).status, 0);
    assert.notEqual(run({ mode: "true", enabled: "true" }).status, 0);
    const invalidMode = run({ mode: "other", enabled: "false" });
    assert.notEqual(invalidMode.status, 0);
    assert.match(invalidMode.stderr, /error=proposal_prompt_cutover_mode_invalid/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("optional workers use dedicated profiles, identities, env files, and hardened containers", () => {
  const compose = read("deploy/compose.production.yml");
  const services = assertComposeTopology(compose);
  const expected = new Map([
    ["dm-worker-1", {
      profile: "dm-worker-1",
      image: "DM_WORKER_IMAGE",
      env: "DM_WORKER_1_ENV_FILE",
      identity: "WORKER_ID: dm-worker-1",
    }],
    ["dm-worker-2", {
      profile: "dm-worker-2",
      image: "DM_WORKER_IMAGE",
      env: "DM_WORKER_2_ENV_FILE",
      identity: "WORKER_ID: dm-worker-2",
    }],
    ["wiki-worker-1", {
      profile: "wiki-worker-1",
      image: "WIKI_WORKER_IMAGE",
      env: "WIKI_WORKER_1_ENV_FILE",
      identity: "WORKER_ID: wiki-worker-1",
    }],
    ["content-proposal-worker-1", {
      profile: "content-proposal-worker-1",
      image: "CONTENT_PROPOSAL_WORKER_IMAGE",
      env: "CONTENT_PROPOSAL_WORKER_1_ENV_FILE",
      identity: "WORKER_ID: content-proposal-worker-1",
    }],
    ["brand-intelligence-worker-1", {
      profile: "brand-intelligence-worker-1",
      image: "BRAND_INTELLIGENCE_WORKER_IMAGE",
      env: "BRAND_INTELLIGENCE_WORKER_1_ENV_FILE",
      identity: "BRAND_INTELLIGENCE_WORKER_ID: brand-intelligence-worker-1",
    }],
    ["subject-analysis-worker-1", {
      profile: "subject-analysis-worker-1",
      image: "SUBJECT_ANALYSIS_WORKER_IMAGE",
      env: "SUBJECT_ANALYSIS_WORKER_1_ENV_FILE",
      identity: "SUBJECT_ANALYSIS_WORKER_ID: subject-analysis-worker-1",
    }],
    ["image-worker-1", {
      profile: "image-worker-1",
      image: "IMAGE_WORKER_IMAGE",
      env: "IMAGE_WORKER_1_ENV_FILE",
      identity: "WORKER_ID: image-worker-1",
    }],
    ["card-news-worker-1", {
      profile: "card-news-worker-1",
      image: "CARD_NEWS_WORKER_IMAGE",
      env: "CARD_NEWS_WORKER_1_ENV_FILE",
      identity: "CARD_NEWS_WORKER_ID: card-news-worker-1",
    }],
    ["blog-worker-1", {
      profile: "blog-worker-1",
      image: "BLOG_WORKER_IMAGE",
      env: "BLOG_WORKER_1_ENV_FILE",
      identity: "BLOG_WORKER_ID: blog-worker-1",
    }],
    ["reel-worker-1", {
      profile: "reel-worker-1",
      image: "REEL_WORKER_IMAGE",
      env: "REEL_WORKER_1_ENV_FILE",
      identity: "REEL_WORKER_ID: reel-worker-1",
    }],
  ]);

  for (const [name, contract] of expected) {
    const block = services.get(name);
    assert.ok(block, `${name} service is missing`);
    assert.deepEqual(parseServiceList(block, "profiles"), [`"${contract.profile}"`]);
    assert.match(block.text, new RegExp(`\\$\\{${contract.image}:\\?`));
    assert.match(block.text, new RegExp(`\\$\\{${contract.env}:-/opt/brand-pilot/shared/env/`));
    assert.ok(block.text.includes(contract.identity), `${name} must have a unique stable WORKER_ID`);
    assert.match(block.text, /^ {4}read_only:\s+true$/m);
    assert.ok(
      parseServiceList(block, "tmpfs").includes(
        name === "brand-intelligence-worker-1"
          ? "/tmp:size=512m,mode=1777"
          : "/tmp:size=64m,mode=1777",
      ),
      `${name} must keep temporary workspaces on bounded tmpfs`,
    );
    assert.deepEqual(parseServiceList(block, "cap_drop"), ["ALL"]);
    assert.deepEqual(parseServiceList(block, "security_opt"), [
      "no-new-privileges:true",
      "apparmor=runc",
      "seccomp=unconfined",
      "systempaths=unconfined",
    ]);
    assert.match(block.text, /driver:\s+json-file/);
    assert.match(block.text, /max-size:\s+10m/);
    assert.match(block.text, /max-file:\s+"5"/);
    assert.doesNotMatch(block.text, /API_ENV_FILE|api\.env/);
  }

});

test("worker env examples keep service credentials separate and rollout flags fail closed", () => {
  const apiEnv = read("deploy/env/api.env.example");
  assert.match(apiEnv, /^AUTOMATED_CONTENT_ENABLED=false$/m);
  assert.match(apiEnv, /^CONTENT_PROPOSALS_ENABLED=true$/m);

  const dmEnv = read("deploy/env/dm-worker.env.example");
  const wikiEnv = read("deploy/env/wiki-worker.env.example");
  const proposalEnv = read("deploy/env/content-proposal-worker.env.example");
  assert.match(dmEnv, /^DM_WORKER_DATABASE_URL=required-at-deploy-time$/m);
  assert.match(dmEnv, /^WORKER_API_TOKEN=required-at-deploy-time$/m);
  assert.match(wikiEnv, /^DM_WORKER_DATABASE_URL=required-at-deploy-time$/m);
  assert.match(wikiEnv, /^WORKER_API_TOKEN=required-at-deploy-time$/m);
  assert.match(proposalEnv, /^CONTENT_PROPOSAL_WORKER_API_TOKEN=required-at-deploy-time$/m);
  for (const env of [dmEnv, wikiEnv, proposalEnv]) {
    assert.doesNotMatch(env, /API_SERVICE_TOKEN|ADMIN_SERVICE_TOKEN|CRON_SECRET/);
  }
});

test("Task 6 gives every CLI worker an isolated explicit Compose profile and writable shared login", () => {
  const compose = read("deploy/compose.production.yml");
  const services = assertComposeTopology(compose);
  const expected = new Map([
    ["dm-worker-1", ["DM_WORKER_IMAGE", "DM_WORKER_1_ENV_FILE", "WORKER_ID: dm-worker-1"]],
    ["dm-worker-2", ["DM_WORKER_IMAGE", "DM_WORKER_2_ENV_FILE", "WORKER_ID: dm-worker-2"]],
    ["wiki-worker-1", ["WIKI_WORKER_IMAGE", "WIKI_WORKER_1_ENV_FILE", "WORKER_ID: wiki-worker-1"]],
    ["content-proposal-worker-1", [
      "CONTENT_PROPOSAL_WORKER_IMAGE",
      "CONTENT_PROPOSAL_WORKER_1_ENV_FILE",
      "CONTENT_PROPOSAL_WORKER_ID: content-proposal-worker-1",
    ]],
    ["brand-intelligence-worker-1", [
      "BRAND_INTELLIGENCE_WORKER_IMAGE",
      "BRAND_INTELLIGENCE_WORKER_1_ENV_FILE",
      "BRAND_INTELLIGENCE_WORKER_ID: brand-intelligence-worker-1",
    ]],
    ["subject-analysis-worker-1", [
      "SUBJECT_ANALYSIS_WORKER_IMAGE",
      "SUBJECT_ANALYSIS_WORKER_1_ENV_FILE",
      "SUBJECT_ANALYSIS_WORKER_ID: subject-analysis-worker-1",
    ]],
    ["image-worker-1", ["IMAGE_WORKER_IMAGE", "IMAGE_WORKER_1_ENV_FILE", "WORKER_ID: image-worker-1"]],
    ["card-news-worker-1", [
      "CARD_NEWS_WORKER_IMAGE",
      "CARD_NEWS_WORKER_1_ENV_FILE",
      "CARD_NEWS_WORKER_ID: card-news-worker-1",
    ]],
    ["blog-worker-1", ["BLOG_WORKER_IMAGE", "BLOG_WORKER_1_ENV_FILE", "BLOG_WORKER_ID: blog-worker-1"]],
    ["reel-worker-1", [
      "REEL_WORKER_IMAGE",
      "REEL_WORKER_1_ENV_FILE",
      "REEL_WORKER_ID: reel-worker-1",
    ]],
  ]);
  const runtimeUser =
    '"${CODEX_RUNTIME_UID:?CODEX_RUNTIME_UID is required}:${CODEX_RUNTIME_GID:?CODEX_RUNTIME_GID is required}"';
  const codexMount = "${CODEX_HOME_PATH:-/opt/brand-pilot/shared/codex}:/codex";
  const accountPoolMount =
    "${CODEX_ACCOUNT_POOL_ROOT_PATH:-/opt/brand-pilot/shared/codex-accounts}:/codex-accounts";
  const primaryAccountMount =
    "${CODEX_ACCOUNT_POOL_ROOT_PATH:-/opt/brand-pilot/shared/codex-accounts}/primary:/codex-accounts/primary";
  const pooledServices = new Set([
    "content-proposal-worker-1",
    "image-worker-1",
    "card-news-worker-1",
    "blog-worker-1",
    "reel-worker-1",
  ]);

  for (const [name, [image, envFile, identity]] of expected) {
    const block = services.get(name);
    assert.ok(block, `${name} service is missing`);
    assert.deepEqual(parseServiceList(block, "profiles"), [`"${name}"`]);
    assert.match(block.text, new RegExp(`\\$\\{${image}:\\?${image} is required\\}`));
    assert.match(block.text, new RegExp(`\\$\\{${envFile}:-/opt/brand-pilot/shared/env/`));
    assert.ok(block.text.includes(identity), `${name} must have a stable identity`);
    if (pooledServices.has(name)) {
      assert.match(block.text, /^ {6}CODEX_HOME:\s+\/codex-accounts\/primary$/m);
      assert.match(block.text, /^ {6}CODEX_ACCOUNT_POOL_ROOT:\s+\/codex-accounts$/m);
      assert.match(block.text, /^ {6}CODEX_ACCOUNT_PROFILES:\s+primary,secondary$/m);
    } else if (name === "brand-intelligence-worker-1") {
      assert.match(block.text, /^ {6}CODEX_HOME:\s+\/codex-accounts\/primary$/m);
      assert.doesNotMatch(block.text, /^ {6}CODEX_ACCOUNT_(?:POOL_ROOT|PROFILES):/m);
    } else {
      assert.match(block.text, /^ {6}CODEX_HOME:\s+\/codex$/m);
      assert.doesNotMatch(block.text, /CODEX_ACCOUNT_PROFILES|:\/codex-accounts/);
    }
    assert.match(block.text, new RegExp(`^ {4}user:\\s+${runtimeUser.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
    assert.deepEqual(
      parseServiceList(block, "volumes"),
      [pooledServices.has(name)
        ? accountPoolMount
        : name === "brand-intelligence-worker-1"
          ? primaryAccountMount
          : codexMount],
    );
    assert.match(block.text, /^ {4}read_only:\s+true$/m);
    assert.deepEqual(parseServiceList(block, "cap_drop"), ["ALL"]);
    assert.deepEqual(parseServiceList(block, "security_opt"), [
      "no-new-privileges:true",
      "apparmor=runc",
      "seccomp=unconfined",
      "systempaths=unconfined",
    ]);
    assert.ok(
      parseServiceList(block, "tmpfs").some((entry) => entry.startsWith("/tmp:")),
      `${name} must keep job workspaces on bounded tmpfs`,
    );
    assert.doesNotMatch(
      block.text,
      /OPENAI_API_KEY|OPENAI_BASE_URL|OPENAI_(?:EMBEDDING_)?MODEL|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY/i,
    );
  }

  for (const serviceName of [
    "image-worker-1",
    "card-news-worker-1",
    "blog-worker-1",
    "reel-worker-1",
  ]) {
    const imageTmpfs = parseServiceList(services.get(serviceName), "tmpfs");
    assert.ok(
      ["primary", "secondary"].every((profile) => imageTmpfs.some((entry) => (
        entry.startsWith(`/codex-accounts/${profile}/generated_images:`)
        && /(?:^|,)size=[^,]+/.test(entry)
        && /(?:^|,)mode=0700(?:,|$)/.test(entry)
        && entry.includes("uid=${CODEX_RUNTIME_UID")
        && entry.includes("gid=${CODEX_RUNTIME_GID")
      ))),
      `${serviceName} must isolate generated images from both persisted account homes`,
    );
  }
});

test("Task 6 release plumbing validates every immutable worker image and the persistent Codex login", () => {
  const releaseExample = read("deploy/release.env.example");
  const lib = read("deploy/scripts/lib.sh");
  const preflight = read("deploy/scripts/preflight.sh");
  const deploy = read("deploy/scripts/deploy.sh");
  const bootstrap = read(ubuntuBootstrapPath);
  const workerImageKeys = [
    "DM_WORKER_IMAGE",
    "WIKI_WORKER_IMAGE",
    "CONTENT_PROPOSAL_WORKER_IMAGE",
    "BRAND_INTELLIGENCE_WORKER_IMAGE",
    "SUBJECT_ANALYSIS_WORKER_IMAGE",
    "IMAGE_WORKER_IMAGE",
    "CARD_NEWS_WORKER_IMAGE",
    "BLOG_WORKER_IMAGE",
    "REEL_WORKER_IMAGE",
  ];

  for (const key of workerImageKeys) {
    assert.match(releaseExample, new RegExp(`^${key}=required-at-deploy-time$`, "m"));
    assert.ok(lib.includes(key), `release parser missing ${key}`);
    assert.ok(preflight.includes(key), `preflight missing ${key}`);
  }
  assert.match(lib, /for required_image_key in[\s\S]*require_digest_image/);
  assert.match(preflight, /verify_release_image_revision/);
  assert.match(preflight, /docker pull[\s\S]*--/);
  assert.match(deploy, /verify_release_image_revision[\s\S]*CANDIDATE_API_IMAGE/);
  assert.match(preflight, /COMPOSE_PROFILES[\s\S]*first_deploy_worker_profiles_forbidden/);

  assert.match(bootstrap, /managed_paths=\([\s\S]*"\$ROOT\/shared\/codex-accounts\/primary"[\s\S]*"\$ROOT\/shared\/codex-accounts\/secondary"/);
  assert.match(bootstrap, /install -d -m 0700 -o bpdeploy -g bpdeploy "\$ROOT\/shared\/codex-accounts\/primary"/);
  assert.match(bootstrap, /install -d -m 0700 -o bpdeploy -g bpdeploy "\$ROOT\/shared\/codex-accounts\/secondary"/);
  assert.doesNotMatch(bootstrap, /(?:cp|mv|ln|cat|touch|printf)[^\n]*auth\.json/);

  assert.match(preflight, /CODEX_ACCOUNT_POOL_ROOT_PATH="\$ROOT\/shared\/codex-accounts"/);
  assert.match(preflight, /codex_account_pool_missing/);
  assert.match(preflight, /codex_account_pool_mode_invalid/);
  assert.match(preflight, /codex_account_pool_owner_invalid/);
  assert.match(preflight, /for profile in primary secondary/);
  assert.match(preflight, /auth_file="\$profile_home\/auth\.json"/);
  assert.match(preflight, /auth_file_symlink_forbidden|! -L "\$auth_file"/);
  assert.match(preflight, /require_file_mode_600 "\$auth_file" "bpdeploy"/);
  assert.match(preflight, /CODEX_RUNTIME_UID=.*id -u bpdeploy/);
  assert.match(preflight, /CODEX_RUNTIME_GID=.*id -g bpdeploy/);
  assert.match(preflight, /timeout[\s\S]*docker run[\s\S]*--pull never[\s\S]*--user[\s\S]*CODEX_HOME=\/codex[\s\S]*codex login status/);
  assert.match(preflight, /codex login status[\s\S]*>\/dev\/null 2>&1/);
  assert.doesNotMatch(preflight, /(?:cat|sed|awk|grep|head|tail|less|more)[^\n]*auth\.json/);

  const runtimeStart = preflight.indexOf("CODEX_WORKER_IMAGE_KEYS=(");
  const runtimeEnd = preflight.indexOf('status_ok "codex_sandbox_policy"');
  assert.ok(runtimeStart >= 0, "preflight must enumerate release images that execute Codex");
  assert.ok(runtimeEnd > runtimeStart, "preflight must complete the offline Codex sandbox probe");
  const runtimeBlock = preflight.slice(runtimeStart, runtimeEnd);
  for (const key of [
    "DM_WORKER_IMAGE",
    "CONTENT_PROPOSAL_WORKER_IMAGE",
    "BRAND_INTELLIGENCE_WORKER_IMAGE",
    "SUBJECT_ANALYSIS_WORKER_IMAGE",
    "IMAGE_WORKER_IMAGE",
    "CARD_NEWS_WORKER_IMAGE",
    "BLOG_WORKER_IMAGE",
    "REEL_WORKER_IMAGE",
  ]) {
    assert.ok(runtimeBlock.includes(key), `Codex runtime preflight missing ${key}`);
  }
  assert.match(runtimeBlock, /codex --version 2>\/dev\/null/);
  assert.match(runtimeBlock, /codex-cli 0\.145\.0/);
  assert.match(runtimeBlock, /command -v bwrap >\/dev\/null 2>&1/);
  assert.match(runtimeBlock, /--network none/);
  assert.match(runtimeBlock, />\/dev\/null 2>&1[\s\S]*fail "codex_worker_runtime_invalid"/);
  assert.match(runtimeBlock, /permissions\.worker\.filesystem=\{":minimal"="read","\/codex"="deny",":workspace_roots"=\{"\."="write"\}\}/);
  assert.match(runtimeBlock, /permissions\.worker\.network\.enabled=false/);
  assert.match(runtimeBlock, /--security-opt apparmor=runc/);
  assert.match(runtimeBlock, /--security-opt seccomp=unconfined/);
  assert.match(runtimeBlock, /--security-opt systempaths=unconfined/);
  assert.match(runtimeBlock, /sandbox[\s\\]*--permission-profile worker[\s\\]*-C \/workspace[\s\\]*--/);
  assert.doesNotMatch(runtimeBlock, /sandbox[\s\\]+linux/);
  assert.match(runtimeBlock, /\/bin\/sh -c ": <\/codex\/auth\.json"/);
  assert.match(runtimeBlock, /codex-preflight-write-probe/);
  assert.match(runtimeBlock, />\/dev\/null 2>&1[\s\S]*fail "codex_sandbox_policy_probe_failed"/);
});

test("Task 6 deployment env examples expose only real worker settings and never direct model API credentials", () => {
  const localEnvCheck = read("scripts/check-local-env.mjs");
  assert.match(localEnvCheck, /"card-news-worker": \["cardNewsWorker", "CARD_NEWS_CODEX_PLAN_COMMAND"\]/);
  assert.match(localEnvCheck, /"blog-worker": \["blogWorker", "BLOG_CODEX_PLAN_COMMAND"\]/);
  assert.doesNotMatch(localEnvCheck, /"(?:CARD_NEWS|BLOG)_CODEX_COMMAND"/);
  const expected = new Map([
    ["deploy/env/dm-worker.env.example", ["DM_CODEX_MODEL", "DM_CLI_TIMEOUT_MS"]],
    ["deploy/env/wiki-worker.env.example", ["WIKI_CODEX_MODEL", "WIKI_CODEX_TIMEOUT_MS"]],
    ["deploy/env/content-proposal-worker.env.example", [
      "CONTENT_PROPOSAL_CODEX_COMMAND",
      "CONTENT_PROPOSAL_CODEX_TIMEOUT_MS",
    ]],
    ["deploy/env/brand-intelligence-worker.env.example", [
      "BRAND_INTELLIGENCE_CODEX_COMMAND",
      "BRAND_INTELLIGENCE_CODEX_MODEL",
      "BRAND_INTELLIGENCE_CODEX_TIMEOUT_MS",
    ]],
    ["deploy/env/subject-analysis-worker.env.example", [
      "SUBJECT_ANALYSIS_CODEX_COMMAND",
      "SUBJECT_ANALYSIS_CODEX_MODEL",
      "SUBJECT_ANALYSIS_CODEX_TIMEOUT_MS",
    ]],
    ["deploy/env/image-worker.env.example", ["IMAGE_RENDER_COMMAND", "IMAGE_MODEL", "IMAGE_JOB_TIMEOUT_MS"]],
    ["deploy/env/card-news-worker.env.example", [
      "CARD_NEWS_CODEX_PLAN_COMMAND",
      "CARD_NEWS_CODEX_PLAN_TIMEOUT_MS",
    ]],
    ["deploy/env/blog-worker.env.example", ["BLOG_CODEX_PLAN_COMMAND", "BLOG_CODEX_PLAN_TIMEOUT_MS"]],
    ["deploy/env/reel-worker.env.example", ["REEL_CODEX_PLAN_COMMAND", "REEL_CODEX_PLAN_TIMEOUT_MS"]],
  ]);

  for (const [path, requiredKeys] of expected) {
    assert.equal(existsSync(path), true, `${path} is missing`);
    const env = read(path);
    assert.match(env, /^BRAND_PILOT_API_URL=https:\/\/api\.danbammsg\.co\.kr$/m);
    for (const key of requiredKeys) {
      assert.match(env, new RegExp(`^${key}=\\S.+$`, "m"), `${path} missing ${key}`);
    }
    assert.doesNotMatch(
      env,
      /OPENAI_API_KEY|OPENAI_BASE_URL|OPENAI_(?:EMBEDDING_)?MODEL|AZURE_OPENAI|ANTHROPIC_API_KEY|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY/i,
      `${path} must not configure a direct or proxied model API`,
    );
  }
});

test("Task 6 CI maps every worker Dockerfile into the affected-image matrix", () => {
  const workflow = read(publishWorkflowPath);
  const expected = [
    ["brandIntelligenceWorker", "brand-pilot-brand-intelligence-worker", "BRAND_INTELLIGENCE_WORKER_IMAGE"],
    ["subjectAnalysisWorker", "brand-pilot-subject-analysis-worker", "SUBJECT_ANALYSIS_WORKER_IMAGE"],
    ["imageWorker", "brand-pilot-image-worker", "IMAGE_WORKER_IMAGE"],
    ["cardNewsWorker", "brand-pilot-card-news-worker", "CARD_NEWS_WORKER_IMAGE"],
    ["blogWorker", "brand-pilot-blog-worker", "BLOG_WORKER_IMAGE"],
    ["reelWorker", "brand-pilot-reel-worker", "REEL_WORKER_IMAGE"],
  ];

  for (const [component, directory, imageKey] of expected) {
    assert.match(
      workflow,
      new RegExp(`component: "${component}"[^\\n]*dockerfile: "workers/${directory}/Dockerfile"[^\\n]*imageKeys: \\["${imageKey}"\\]`),
    );
  }
  assert.match(workflow, /dmWikiWorker[^\n]*DM_WORKER_IMAGE[^\n]*WIKI_WORKER_IMAGE/);
  assert.doesNotMatch(workflow, /marketingWorker|brand-pilot-marketing-worker|MARKETING_WORKER_IMAGE/);
  assert.match(workflow, /org\.opencontainers\.image\.revision=\$\{\{ github\.sha \}\}/);
});

test("all CLI worker images install the pinned Codex runtime and run real entrypoints as non-root users", () => {
  const workers = new Map([
    ["dm", {
      path: "workers/brand-pilot-dm-worker/Dockerfile",
      entrypoint: /workers\/brand-pilot-dm-worker\/dist\/index\.js/,
      assets: [
        /workers\/brand-pilot-dm-worker\/runtime/,
        /packages\/brand-pilot-content-contracts\/package\.json/,
        /packages\/brand-pilot-content-contracts\/dist/,
        /packages\/brand-pilot-content-contracts\/generated/,
      ],
    }],
    ["content proposal", {
      path: "workers/brand-pilot-content-proposal-worker/Dockerfile",
      entrypoint: /workers\/brand-pilot-content-proposal-worker\/dist\/main\.js/,
      assets: [],
    }],
    ["brand intelligence", {
      path: "workers/brand-pilot-brand-intelligence-worker/Dockerfile",
      entrypoint: /workers\/brand-pilot-brand-intelligence-worker\/dist\/index\.js/,
      assets: [/run-codex-brand-intelligence\.mjs/, /brand-intelligence\/SKILL\.md/],
    }],
    ["subject analysis", {
      path: "workers/brand-pilot-subject-analysis-worker/Dockerfile",
      entrypoint: /workers\/brand-pilot-subject-analysis-worker\/dist\/index\.js/,
      assets: [
        /packages\/brand-pilot-content-contracts\/package\.json/,
        /packages\/brand-pilot-content-contracts\/dist/,
        /packages\/brand-pilot-content-contracts\/generated/,
        /run-codex-subject-analysis\.mjs/,
        /subject-analysis\/SKILL\.md/,
      ],
    }],
    ["image", {
      path: "workers/brand-pilot-image-worker/Dockerfile",
      entrypoint: /workers\/brand-pilot-image-worker\/dist\/index\.js/,
      assets: [
        /render-reel\.py/,
        /image-render\/SKILL\.md/,
        /threads-text\/SKILL\.md/,
        /assets\/mixkit-a-very-happy-christmas-897\.mp3/,
      ],
    }],
    ["card news", {
      path: "workers/brand-pilot-card-news-worker/Dockerfile",
      entrypoint: /workers\/brand-pilot-card-news-worker\/dist\/index\.js/,
      assets: [/brand-pilot-content-contracts\/generated/, /card-news-creator\/SKILL\.md/],
    }],
    ["blog", {
      path: "workers/brand-pilot-blog-worker/Dockerfile",
      entrypoint: /workers\/brand-pilot-blog-worker\/dist\/index\.js/,
      assets: [/run-codex-blog-v2-plan\.mjs/, /blog-writer\/SKILL\.md/],
    }],
    ["reel", {
      path: "workers/brand-pilot-reel-worker/Dockerfile",
      entrypoint: /workers\/brand-pilot-reel-worker\/dist\/index\.js/,
      assets: [/run-codex-reel-plan\.mjs/],
    }],
  ]);

  for (const [name, contract] of workers) {
    const dockerfile = read(contract.path);
    assert.match(dockerfile, /^FROM node:22-bookworm-slim AS build$/m);
    assert.match(dockerfile, /^FROM node:22-bookworm-slim AS runtime$/m);
    assert.match(dockerfile, /^USER node$/m);
    assert.match(dockerfile, /ca-certificates/, `${name} must trust normal HTTPS certificates`);
    assert.match(dockerfile, /@openai\/codex@0\.145\.0/, `${name} must pin the Codex CLI`);
    if (["content proposal", "image", "card news", "blog", "reel"].includes(name)) {
      assert.match(dockerfile, /CODEX_HOME=\/codex-accounts\/primary/, `${name} must default to the primary profile`);
      assert.match(dockerfile, /CODEX_ACCOUNT_PROFILES=primary,secondary/, `${name} must declare the account pool`);
    } else if (name === "brand intelligence") {
      assert.match(dockerfile, /CODEX_HOME=\/codex-accounts\/primary/, `${name} must use the authenticated primary profile`);
      assert.doesNotMatch(dockerfile, /CODEX_ACCOUNT_POOL_ROOT|CODEX_ACCOUNT_PROFILES/);
    } else {
      assert.match(dockerfile, /CODEX_HOME=\/codex(?:\s|$)/, `${name} must isolate the shared auth home`);
    }
    assert.match(dockerfile, contract.entrypoint, `${name} must run its compiled entrypoint`);
    for (const asset of contract.assets) {
      assert.match(dockerfile, asset, `${name} is missing runtime asset ${asset}`);
    }
    assert.doesNotMatch(dockerfile, /OPENAI_API_KEY|docker\.sock/);
  }

  const imageDockerfile = read(workers.get("image").path);
  assert.match(imageDockerfile, /python3/);
  assert.match(imageDockerfile, /ffmpeg/);
  assert.match(imageDockerfile, /PYTHON=python3/);
  assert.match(imageDockerfile, /714baa43f1c04e8ca77a8268825ea7e68e958917f5f5fe4c656d83811e1d0c98/);
  assert.match(imageDockerfile, /sha256sum -c/);
  assert.doesNotMatch(imageDockerfile, /tsx\/esm\/api|src\/[A-Za-z0-9_.-]+\.ts/);
});

test("brand intelligence image preserves workspace dependencies and invokes Playwright without a pruned bin shim", () => {
  const dockerfile = read("workers/brand-pilot-brand-intelligence-worker/Dockerfile");

  for (const runtimeAsset of [
    "packages/brand-pilot-content-contracts/package.json",
    "packages/brand-pilot-content-contracts/dist",
    "packages/brand-pilot-content-contracts/generated",
  ]) {
    assert.match(
      dockerfile,
      new RegExp(`/app/${runtimeAsset.replaceAll("/", "\\/")}`),
      `the runtime image must include ${runtimeAsset} for the shared worker runtime`,
    );
  }
  assert.match(
    dockerfile,
    /npm prune --omit=dev --workspaces/,
    "workspace production dependencies such as Playwright must survive the build-stage prune",
  );
  assert.match(
    dockerfile,
    /node node_modules\/playwright\/cli\.js install --with-deps chromium/,
    "the image must invoke Playwright directly because npm prune removes its .bin shim",
  );
  assert.doesNotMatch(dockerfile, /npx playwright install/);
});

test("shared worker runtime is emitted for production and CLI children use explicit execution boundaries", () => {
  const runtimePackage = JSON.parse(read("workers/brand-pilot-worker-runtime/package.json"));
  const runtimeTsconfig = JSON.parse(read("workers/brand-pilot-worker-runtime/tsconfig.json"));
  const runtimeSource = read("workers/brand-pilot-worker-runtime/src/index.ts");

  assert.equal(runtimePackage.exports, "./dist/index.js");
  assert.equal(runtimePackage.types, "./dist/index.d.ts");
  assert.match(runtimePackage.scripts.build, /\btsc\b/);
  assert.doesNotMatch(runtimePackage.scripts.build, /--noEmit/);
  assert.equal(runtimeTsconfig.compilerOptions.outDir, "dist");
  assert.equal(runtimeTsconfig.compilerOptions.declaration, true);
  assert.match(runtimeSource, /\bcwd\b/);
  assert.match(runtimeSource, /\benv\b/);
  assert.doesNotMatch(runtimeSource, /shell:\s*true/);
});

test("preflight forbids worker profiles on the first deploy and fixes activation order", () => {
  const preflight = read("deploy/scripts/preflight.sh");
  assert.match(preflight, /COMPOSE_PROFILES/);
  assert.match(preflight, /first_deploy_worker_profiles_forbidden/);
  assert.match(
    preflight,
    /WIKI_ACTIVE_VERSION[\s\S]*DM_WORKER_1_HEARTBEAT[\s\S]*DM_WORKER_1_LEASE[\s\S]*REMOTE_WORKER_LEASE_EXPIRED[\s\S]*DM_WORKER_2/,
  );
});

test("Task 8 fixes every shared env path and preflight permission contract", () => {
  const compose = read("deploy/compose.production.yml");
  const preflight = read("deploy/scripts/preflight.sh");
  const runbook = read(ubuntuRunbookPath);
  const expectedEnvPaths = [
    "/opt/brand-pilot/shared/env/api.env",
    "/opt/brand-pilot/shared/env/dm-worker-1.env",
    "/opt/brand-pilot/shared/env/dm-worker-2.env",
    "/opt/brand-pilot/shared/env/wiki-worker-1.env",
    "/opt/brand-pilot/shared/env/content-proposal-worker-1.env",
  ];

  for (const path of expectedEnvPaths) {
    assert.ok(compose.includes(path), `compose missing fixed env path: ${path}`);
    assert.ok(preflight.includes(path.split("/").at(-1)), `preflight missing env file: ${path}`);
    assert.ok(runbook.includes(path), `Ubuntu runbook missing env path: ${path}`);
  }
  assert.match(preflight, /shared\/env[\s\S]*required_directory_mode_invalid/);
  assert.match(preflight, /shared\/env[\s\S]*required_directory_owner_invalid/);
  for (const variable of [
    "API_ENV_FILE",
    "DM_WORKER_1_ENV_FILE",
    "DM_WORKER_2_ENV_FILE",
    "WIKI_WORKER_1_ENV_FILE",
    "CONTENT_PROPOSAL_WORKER_1_ENV_FILE",
  ]) {
    assert.match(
      preflight,
      new RegExp(`require_file_mode_600 "\\$${variable}" "bpdeploy"`),
      `preflight must validate ${variable}`,
    );
  }
  assert.match(runbook, /shared\/env[^]*mode 700[^]*bpdeploy/i);
});

test("content proposal worker authentication is present in the API operator contract", () => {
  const apiEnv = read("deploy/env/api.env.example");
  const ubuntuRunbook = read(ubuntuRunbookPath);
  assert.match(
    apiEnv,
    /^CONTENT_PROPOSAL_WORKER_API_TOKEN=required-at-deploy-time$/m,
  );
  assert.match(
    ubuntuRunbook,
    /WORKER_API_TOKEN ADMIN_SERVICE_TOKEN CONTENT_PROPOSAL_WORKER_API_TOKEN/,
  );
});

test("content suggestion MCP requires external OAuth resource configuration", () => {
  const apiEnv = read("deploy/env/api.env.example");
  const preflight = read("deploy/scripts/preflight.sh");
  const runtimeConfig = read("apps/api/src/runtimeConfig.ts");
  const http = read("apps/api/src/contentSuggestionHttp.ts");
  for (const key of [
    "CONTENT_SUGGESTION_OAUTH_ISSUER",
    "CONTENT_SUGGESTION_OAUTH_JWKS_URI",
    "CONTENT_SUGGESTION_OAUTH_RESOURCE",
  ]) {
    assert.match(apiEnv, new RegExp(`^${key}=https://`, "m"));
    assert.match(preflight, new RegExp(key));
    assert.match(runtimeConfig, new RegExp(`"${key}"`));
  }
  assert.match(apiEnv, /^CONTENT_SUGGESTION_OAUTH_AUDIENCE=authenticated$/m);
  assert.match(preflight, /CONTENT_SUGGESTION_OAUTH_AUDIENCE/);
  assert.match(preflight, /CONTENT_SUGGESTION_OAUTH_AUDIENCE_VALUE" == "authenticated"/);
  assert.doesNotMatch(preflight, /CONTENT_SUGGESTION_OAUTH_AUDIENCE_VALUE" == "\$CONTENT_SUGGESTION_OAUTH_RESOURCE_VALUE"/);
  assert.match(runtimeConfig, /"CONTENT_SUGGESTION_OAUTH_AUDIENCE"/);
  assert.match(apiEnv, /^CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS=[0-9a-f-]+$/m);
  assert.match(preflight, /oauth_subject_declaration_count/);
  assert.match(preflight, /\[0-9a-fA-F\]\{8\}-\[0-9a-fA-F\]\{4\}-\[0-9a-fA-F\]\{4\}-\[0-9a-fA-F\]\{4\}-\[0-9a-fA-F\]\{12\}/);
  assert.match(preflight, /declare -A oauth_seen_subjects/);
  assert.match(runtimeConfig, /"CONTENT_SUGGESTION_OAUTH_ALLOWED_SUBJECTS"/);
  assert.match(http, /\.well-known\/oauth-protected-resource/);
  assert.match(http, /bodyLimit:\s*1024\s*\*\s*1024/);
  assert.doesNotMatch(apiEnv, /CONTENT_SUGGESTION_PLUGIN_TOKEN/);
});

test("preflight rejects missing or mismatched content proposal worker tokens without leaking them", () => {
  const bash = findBash();
  assert.ok(bash, "Bash is required for the shared secret contract");
  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-shared-secret-"));
  const apiEnv = join(fixture, "api.env");
  const workerEnv = join(fixture, "content-proposal-worker-1.env");
  const run = () => spawnSync(bash, [
    "-c",
    'source "$1"; require_matching_env_secret CONTENT_PROPOSAL_WORKER_API_TOKEN "$2" "$3"',
    "_",
    bashPath("deploy/scripts/lib.sh"),
    bashPath(apiEnv),
    bashPath(workerEnv),
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  try {
    for (const [apiContents, workerContents] of [
      ["OTHER=value\n", "CONTENT_PROPOSAL_WORKER_API_TOKEN=worker-only\n"],
      ["CONTENT_PROPOSAL_WORKER_API_TOKEN=api-only\n", "OTHER=value\n"],
    ]) {
      writeFileSync(apiEnv, apiContents);
      writeFileSync(workerEnv, workerContents);
      const missing = run();
      assert.notEqual(missing.status, 0);
      assert.match(missing.stderr, /shared_secret_missing/);
      assert.doesNotMatch(missing.stderr, /api-only|worker-only/);
    }

    writeFileSync(apiEnv, "CONTENT_PROPOSAL_WORKER_API_TOKEN=required-at-deploy-time\n");
    writeFileSync(workerEnv, "CONTENT_PROPOSAL_WORKER_API_TOKEN=required-at-deploy-time\n");
    const placeholder = run();
    assert.notEqual(placeholder.status, 0);
    assert.match(placeholder.stderr, /shared_secret_missing/);

    writeFileSync(apiEnv, "CONTENT_PROPOSAL_WORKER_API_TOKEN=api-secret-value\n");
    writeFileSync(workerEnv, "CONTENT_PROPOSAL_WORKER_API_TOKEN=worker-secret-value\n");
    const mismatch = run();
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /shared_secret_mismatch/);
    assert.doesNotMatch(mismatch.stderr, /api-secret-value|worker-secret-value/);

    writeFileSync(apiEnv, "CONTENT_PROPOSAL_WORKER_API_TOKEN=matching-secret-value\n");
    writeFileSync(workerEnv, "CONTENT_PROPOSAL_WORKER_API_TOKEN=matching-secret-value\n");
    const matching = run();
    assert.equal(matching.status, 0, matching.stderr);

    const preflight = read("deploy/scripts/preflight.sh");
    assert.match(
      preflight,
      /require_matching_env_secret[\s\\]+"CONTENT_PROPOSAL_WORKER_API_TOKEN"[\s\\]+"\$API_ENV_FILE"[\s\\]+"\$CONTENT_PROPOSAL_WORKER_1_ENV_FILE"/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("preflight rejects reuse of the general worker token for content proposals without leaking it", () => {
  const bash = findBash();
  assert.ok(bash, "Bash is required for the shared secret contract");
  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-distinct-secret-"));
  const apiEnv = join(fixture, "api.env");
  const reusedSecret = "must-not-appear-reused-worker-secret";
  try {
    writeFileSync(
      apiEnv,
      [
        `WORKER_API_TOKEN=${reusedSecret}`,
        `CONTENT_PROPOSAL_WORKER_API_TOKEN=${reusedSecret}`,
        "",
      ].join("\n"),
    );
    const result = spawnSync(bash, [
      "-c",
      'source "$1"; require_distinct_env_secrets "$2" WORKER_API_TOKEN CONTENT_PROPOSAL_WORKER_API_TOKEN',
      "_",
      bashPath("deploy/scripts/lib.sh"),
      bashPath(apiEnv),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /shared_secret_reuse/);
    assert.doesNotMatch(result.stderr, new RegExp(reusedSecret));

    const preflight = read("deploy/scripts/preflight.sh");
    assert.match(
      preflight,
      /require_distinct_env_secrets[\s\\]+"\$API_ENV_FILE"[\s\\]+"WORKER_API_TOKEN"[\s\\]+"CONTENT_PROPOSAL_WORKER_API_TOKEN"/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("preflight accepts metadata-free ss output only for the exclusive current-stack Caddy owner", () => {
  const bash = findBash();
  assert.ok(bash, "Bash is required for the public port ownership contract");
  const listeners = [
    "LISTEN 0 4096 0.0.0.0:80 0.0.0.0:*",
    "LISTEN 0 4096 0.0.0.0:443 0.0.0.0:*",
    "LISTEN 0 4096 [::]:80 [::]:*",
    "LISTEN 0 4096 [::]:443 [::]:*",
  ].join("\n");
  const validCaddy = [
    "caddy-id|brand-pilot-caddy-1|brand-pilot|caddy|",
    "0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp",
  ].join("");
  const run = (dockerRows) => spawnSync(bash, [
    "-c",
    'source "$1"; source "$2"; validate_public_port_ownership "$3" "$4"',
    "_",
    bashPath("deploy/scripts/lib.sh"),
    bashPath("deploy/scripts/check-public-ports.sh"),
    listeners,
    dockerRows,
  ], { cwd: process.cwd(), encoding: "utf8" });

  const accepted = run(validCaddy);
  assert.equal(accepted.status, 0, accepted.stderr);

  for (const invalid of [
    validCaddy.replace("|brand-pilot|", "|other-project|"),
    validCaddy.replace("|caddy|", "||"),
    validCaddy.replace(":443->443/tcp", ":444->443/tcp"),
    `${validCaddy}, 0.0.0.0:8080->8080/tcp`,
    `${validCaddy}, 127.0.0.1:80->8080/tcp`,
    `${validCaddy}\nother-id|other-caddy|other-project|caddy|0.0.0.0:80->80/tcp`,
    `${validCaddy}\nduplicate-id|brand-pilot-caddy-2|brand-pilot|caddy|0.0.0.0:80->80/tcp`,
  ]) {
    assert.notEqual(run(invalid).status, 0, `unexpectedly accepted: ${invalid}`);
  }
});

function runSharedSecretHelper(apiContents, workerContents, command) {
  const bash = findBash();
  assert.ok(bash, "Bash is required for the shared secret contract");
  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-secret-parser-"));
  const apiEnv = join(fixture, "api.env");
  const workerEnv = join(fixture, "content-proposal-worker-1.env");
  try {
    writeFileSync(apiEnv, apiContents);
    writeFileSync(workerEnv, workerContents);
    return spawnSync(bash, [
      "-c",
      `source "$1"; ${command}`,
      "_",
      bashPath("deploy/scripts/lib.sh"),
      bashPath(apiEnv),
      bashPath(workerEnv),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test("shared secret parser rejects a duplicate key followed by an empty value", () => {
  const result = runSharedSecretHelper(
    [
      "WORKER_API_TOKEN=general-token",
      "CONTENT_PROPOSAL_WORKER_API_TOKEN=proposal-token",
      "CONTENT_PROPOSAL_WORKER_API_TOKEN=",
      "",
    ].join("\n"),
    "CONTENT_PROPOSAL_WORKER_API_TOKEN=proposal-token\n",
    'require_distinct_env_secrets "$2" WORKER_API_TOKEN CONTENT_PROPOSAL_WORKER_API_TOKEN',
  );
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /general-token|proposal-token/);
});

test("shared secret parser rejects a whitespace-only value", () => {
  const result = runSharedSecretHelper(
    "CONTENT_PROPOSAL_WORKER_API_TOKEN=   \n",
    "CONTENT_PROPOSAL_WORKER_API_TOKEN=   \n",
    'require_matching_env_secret CONTENT_PROPOSAL_WORKER_API_TOKEN "$2" "$3"',
  );
  assert.notEqual(result.status, 0);
});

test("shared secret parser rejects quoted and unquoted equivalent values", () => {
  const result = runSharedSecretHelper(
    [
      "WORKER_API_TOKEN=shared-token",
      'CONTENT_PROPOSAL_WORKER_API_TOKEN="shared-token"',
      "",
    ].join("\n"),
    'CONTENT_PROPOSAL_WORKER_API_TOKEN="shared-token"\n',
    'require_distinct_env_secrets "$2" WORKER_API_TOKEN CONTENT_PROPOSAL_WORKER_API_TOKEN',
  );
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /shared-token/);
});

test("shared secret parser accepts canonical unquoted special characters", () => {
  const specialToken = "AbC+/=_:.@%-123";
  const result = runSharedSecretHelper(
    [
      "WORKER_API_TOKEN=general-token",
      `CONTENT_PROPOSAL_WORKER_API_TOKEN=${specialToken}`,
      "",
    ].join("\n"),
    `CONTENT_PROPOSAL_WORKER_API_TOKEN=${specialToken}\n`,
    'require_matching_env_secret CONTENT_PROPOSAL_WORKER_API_TOKEN "$2" "$3"; '
      + 'require_distinct_env_secrets "$2" WORKER_API_TOKEN CONTENT_PROPOSAL_WORKER_API_TOKEN',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /general-token|AbC/);
});

test("shared secret parser ignores an exact key mentioned in a comment", () => {
  const result = runSharedSecretHelper(
    [
      "CONTENT_PROPOSAL_WORKER_API_TOKEN=canonical-secret",
      "# Rotate CONTENT_PROPOSAL_WORKER_API_TOKEN through the approved procedure.",
      "",
    ].join("\n"),
    "CONTENT_PROPOSAL_WORKER_API_TOKEN=canonical-secret\n",
    'require_matching_env_secret CONTENT_PROPOSAL_WORKER_API_TOKEN "$2" "$3"',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /canonical-secret/);
});

test("shared secret parser ignores a longer near-match key", () => {
  const result = runSharedSecretHelper(
    [
      "CONTENT_PROPOSAL_WORKER_API_TOKEN=canonical-secret",
      "CONTENT_PROPOSAL_WORKER_API_TOKEN_BACKUP=backup-secret",
      "",
    ].join("\n"),
    "CONTENT_PROPOSAL_WORKER_API_TOKEN=canonical-secret\n",
    'require_matching_env_secret CONTENT_PROPOSAL_WORKER_API_TOKEN "$2" "$3"',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /canonical-secret|backup-secret/,
  );
});

for (const [declarationName, alternateDeclaration] of [
  ["export declaration", "export CONTENT_PROPOSAL_WORKER_API_TOKEN=exported-secret"],
  ["leading-space declaration", " CONTENT_PROPOSAL_WORKER_API_TOKEN =spaced-secret"],
  ["colon declaration", "CONTENT_PROPOSAL_WORKER_API_TOKEN: colon-secret"],
  ["bare declaration", "CONTENT_PROPOSAL_WORKER_API_TOKEN"],
]) {
  test(`shared secret parser rejects a canonical line combined with an ${declarationName}`, () => {
    const result = runSharedSecretHelper(
      [
        "CONTENT_PROPOSAL_WORKER_API_TOKEN=canonical-secret",
        alternateDeclaration,
        "",
      ].join("\n"),
      "CONTENT_PROPOSAL_WORKER_API_TOKEN=canonical-secret\n",
      'require_matching_env_secret CONTENT_PROPOSAL_WORKER_API_TOKEN "$2" "$3"',
    );
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /canonical-secret|exported-secret|spaced-secret|colon-secret|CONTENT_PROPOSAL_WORKER_API_TOKEN[:=]/,
    );
  });
}

test("Task 8 release replacement cannot mutate shared env files", () => {
  const replacementScripts = [
    "deploy/scripts/deploy.sh",
    "deploy/scripts/promote.sh",
    "deploy/scripts/rollback.sh",
  ].map(read).join("\n");

  const sharedEnvTarget =
    /shared\/env|(?:API|DM_WORKER_1|DM_WORKER_2|WIKI_WORKER_1|CONTENT_PROPOSAL_WORKER_1)_ENV_FILE/;
  const sharedEnvMutations = replacementScripts
    .split(/\r?\n/)
    .filter((line) =>
      sharedEnvTarget.test(line)
      && (
        /\b(?:rm|mv|cp|install|touch|truncate|chmod|chown|tee)\b/.test(line)
        || /\bsed\b[^#\n]*\s-i(?:\s|$)/.test(line)
        || /(?:^|[^<])>{1,2}\s*["']?\$\{?(?:API|DM_WORKER_1|DM_WORKER_2|WIKI_WORKER_1|CONTENT_PROPOSAL_WORKER_1)_ENV_FILE/.test(line)
      ),
    );
  assert.deepEqual(
    sharedEnvMutations,
    [],
    "release replacement scripts must not create, modify, or delete shared env targets",
  );
  const runbook = read(ubuntuRunbookPath);
  assert.match(runbook, /image[^]*release[^]*(?:never|must not)[^]*(?:create|modify|delete)[^]*shared env/i);
});

test("Task 8 pins OAuth cutover, frontend origin, and secret lifecycle", () => {
  assert.equal(existsSync(oauthCutoverRunbookPath), true, "OAuth cutover runbook is missing");
  const runbook = read(oauthCutoverRunbookPath);
  const apiEnv = read("deploy/env/api.env.example");
  const fixedValues = [
    "https://api.danbammsg.co.kr/auth/kakao/callback",
    "https://api.danbammsg.co.kr/auth/meta/callback",
    "https://api.danbammsg.co.kr/auth/meta/trends/callback",
    "https://api.danbammsg.co.kr/webhooks/meta/instagram",
    "https://app.danbammsg.co.kr",
  ];
  for (const value of fixedValues) {
    assert.ok(runbook.includes(value), `OAuth runbook missing: ${value}`);
    assert.ok(apiEnv.includes(value), `API env example missing: ${value}`);
  }
  for (const phrase of [
    "add the new callback before removing the old callback",
    "NEVER arbitrarily rotate `CREDENTIAL_ENCRYPTION_KEY`",
    "Kakao REST key",
    "Meta app ID",
    "webhook verify token",
    "Supabase",
    "Blob token",
    "worker/admin/cron",
    "suspected exposure",
    "arbitrary origin",
    "login",
    "cancel",
    "state mismatch",
    "token decryption",
    "must not log secrets",
  ]) {
    assert.ok(runbook.includes(phrase), `OAuth runbook missing policy: ${phrase}`);
  }
  assert.match(apiEnv, /^AUTH_FRONTEND_URL=https:\/\/app\.danbammsg\.co\.kr$/m);
  assert.match(apiEnv, /^CORS_ALLOWED_ORIGINS=https:\/\/app\.danbammsg\.co\.kr$/m);
});

test("release images are digest pinned and Caddy checks readiness", () => {
  const compose = read("deploy/compose.production.yml");
  const caddy = read("deploy/Caddyfile");
  assert.match(
    compose,
    /\$\{PRIMARY_API_IMAGE:-\$\{API_IMAGE:\?API_IMAGE is required\}\}/,
  );
  assert.match(
    compose,
    /\$\{CANDIDATE_API_IMAGE:-\$\{API_IMAGE:\?API_IMAGE is required\}\}/,
  );
  assert.match(compose, /CADDY_IMAGE:\?CADDY_IMAGE/);
  assert.match(compose, /CANARY_HOST:\?CANARY_HOST/);
  assert.match(compose, /PRIMARY_HOST:\?PRIMARY_HOST/);
  assert.match(caddy, /\{\$CANARY_HOST\}/);
  assert.match(caddy, /\{\$PRIMARY_HOST\}/);
  assert.match(caddy, /\/ready/);
  assert.equal(hasCaddyLogDirective(caddy), false, "Caddy access logging must remain disabled");
});

test("Caddy container has only the capabilities and writable mounts it needs", () => {
  const compose = read("deploy/compose.production.yml");
  const services = assertComposeTopology(compose);
  const apiBlocks = [services.get("api-primary"), services.get("api-canary")];
  const caddyBlock = services.get("caddy");

  assert.match(caddyBlock.text, /^ {4}read_only:\s+true$/m);
  assert.deepEqual(parseServiceList(caddyBlock, "cap_drop"), ["ALL"]);
  assert.deepEqual(parseServiceList(caddyBlock, "cap_add"), ["NET_BIND_SERVICE"]);
  assert.deepEqual(parseServiceList(caddyBlock, "security_opt"), ["no-new-privileges:true"]);
  assert.deepEqual(parseServiceList(caddyBlock, "tmpfs"), ["/tmp:size=64m,mode=1777"]);
  assert.deepEqual(parseServiceList(caddyBlock, "volumes"), [
    "${CADDYFILE_PATH:-./Caddyfile}:/etc/caddy/Caddyfile:ro",
    "caddy_data:/data",
    "caddy_config:/config",
  ]);
  for (const apiBlock of apiBlocks) {
    assert.deepEqual(parseServiceList(apiBlock, "cap_add"), []);
    assert.deepEqual(parseServiceList(apiBlock, "volumes"), [
      "${AI_CONTENT_APPLICATION_DATABASE_URL_FILE:-/opt/brand-pilot/shared/secrets/ai-content-application-database-url}:/run/secrets/ai_content_application_database_url:ro",
    ]);
  }

  const writableMounts = parseServiceList(caddyBlock, "volumes")
    .filter((mount) => !mount.endsWith(":ro"));
  assert.deepEqual(writableMounts, ["caddy_data:/data", "caddy_config:/config"]);
});

test("Caddy routes canary and primary hosts to isolated API services", () => {
  const caddy = read("deploy/Caddyfile");
  assert.match(caddy, /\{\$CANARY_HOST\}[\s\S]*reverse_proxy api-canary:4000/);
  assert.match(caddy, /\{\$PRIMARY_HOST\}[\s\S]*reverse_proxy api-primary:4000/);
  assert.doesNotMatch(caddy, /\{\$CANARY_HOST\},\s*\{\$PRIMARY_HOST\}/);
});

test("canary Caddy configuration requests TLS only for the canary host", () => {
  const caddy = read("deploy/Caddyfile.canary");
  assert.match(caddy, /\{\$CANARY_HOST\}[\s\S]*reverse_proxy api-canary:4000/);
  assert.doesNotMatch(caddy, /PRIMARY_HOST|api-primary/);
  assert.match(caddy, /tls \{\$ACME_EMAIL\}/);
  assert.match(caddy, /encode zstd gzip/);
  assert.match(caddy, /Strict-Transport-Security/);
  assert.equal(hasCaddyLogDirective(caddy), false);
});

test("Caddy applies baseline browser security headers without access logging", () => {
  const caddy = read("deploy/Caddyfile");
  assert.match(caddy, /^\s*header\s+\{$/m);
  assert.match(caddy, /Strict-Transport-Security\s+"max-age=31536000; includeSubDomains"/);
  assert.match(caddy, /X-Content-Type-Options\s+"nosniff"/);
  assert.match(caddy, /X-Frame-Options\s+"DENY"/);
  assert.match(caddy, /Referrer-Policy\s+"strict-origin-when-cross-origin"/);
  assert.equal(hasCaddyLogDirective(caddy), false, "Caddy access logging must remain disabled");
});

test("Caddy enforces HTTPS, bounded requests, and upstream timeouts on both edges", () => {
  for (const path of ["deploy/Caddyfile", "deploy/Caddyfile.canary"]) {
    const caddy = read(path);
    assert.match(caddy, /tls \{\$ACME_EMAIL\}/, `${path} must use ACME TLS`);
    assert.match(
      caddy,
      /Strict-Transport-Security\s+"max-age=31536000; includeSubDomains"/,
      `${path} must send HSTS`,
    );
    assert.match(caddy, /request_body\s*\{[\s\S]*max_size 32MB[\s\S]*\}/);
    assert.match(caddy, /timeouts\s*\{[\s\S]*read_body 30s[\s\S]*read_header 10s/);
    assert.match(caddy, /timeouts\s*\{[\s\S]*write 60s[\s\S]*idle 2m/);
    assert.match(
      caddy,
      /transport http\s*\{[\s\S]*dial_timeout 5s[\s\S]*response_header_timeout 30s/,
    );
    assert.doesNotMatch(caddy, /http:\/\/\{\$(?:CANARY|PRIMARY)_HOST\}/);
  }
});

test("deployment scripts never enable shell tracing", () => {
  for (const path of deploymentScripts) {
    assert.equal(hasShellTracing(read(path)), false, `${path} enables shell tracing`);
  }
});

test("all deployment scripts use Bash strict mode", () => {
  for (const path of deploymentScripts) {
    assert.match(read(path), /^#!\/usr\/bin\/env bash\nset -Eeuo pipefail\n/);
  }
});

test("deploy and rollback serialize changes and validate Compose before pull or up", () => {
  for (const path of ["deploy/scripts/deploy.sh", "deploy/scripts/rollback.sh"]) {
    const script = read(path);
    assert.match(script, /flock/);
    const configIndex = script.indexOf("config --quiet");
    const pullIndex = script.indexOf(" pull");
    const upIndex = script.indexOf(" up");
    assert.ok(configIndex >= 0, `${path} omits compose config --quiet`);
    assert.ok(pullIndex > configIndex, `${path} pulls before validating Compose`);
    assert.ok(upIndex > configIndex, `${path} starts containers before validating Compose`);
  }
});

test("rollback acquires its lock before resolving mutable previous state", () => {
  const rollback = read("deploy/scripts/rollback.sh");
  const lockIndex = rollback.indexOf("flock -n 9");
  const previousStateIndex = rollback.indexOf('load_required_state_sha "$ROOT/state/previous"');
  assert.ok(lockIndex >= 0);
  assert.ok(previousStateIndex > lockIndex);
});

test("release and state contracts are digest-pinned and atomic", () => {
  const lib = read("deploy/scripts/lib.sh");
  const deploy = read("deploy/scripts/deploy.sh");
  const promote = read("deploy/scripts/promote.sh");
  const rollback = read("deploy/scripts/rollback.sh");
  assert.match(lib, /@sha256:/);
  assert.match(lib, /\[a-f0-9\]\{64\}/);
  assert.match(lib, /mktemp/);
  assert.match(lib, /chmod/);
  assert.match(lib, /\bmv\b/);
  assert.match(deploy, /atomic_write[\s\S]*state\/candidate/);
  assert.match(promote, /atomic_write[\s\S]*state\/previous/);
  assert.match(promote, /atomic_write[\s\S]*state\/current/);
  assert.match(rollback, /atomic_write[\s\S]*state\/current/);
});

test("release manifests are parsed without source or eval and preflight is fail-closed", () => {
  const lib = read("deploy/scripts/lib.sh");
  const preflight = read("deploy/scripts/preflight.sh");
  for (const path of deploymentScripts) {
    assert.doesNotMatch(read(path), /\beval\b/);
  }
  assert.doesNotMatch(preflight, /source\s+["']?\$MANIFEST/);
  assert.match(lib, /manifest_unknown_key/);
  assert.match(lib, /manifest_duplicate_key/);
  for (const key of [
    "RELEASE_SCHEMA", "RELEASE_SHA", "API_IMAGE",
    "DM_WORKER_IMAGE", "WIKI_WORKER_IMAGE", "CONTENT_PROPOSAL_WORKER_IMAGE",
    "BRAND_INTELLIGENCE_WORKER_IMAGE", "SUBJECT_ANALYSIS_WORKER_IMAGE", "IMAGE_WORKER_IMAGE",
    "CARD_NEWS_WORKER_IMAGE", "BLOG_WORKER_IMAGE", "REEL_WORKER_IMAGE",
    "CADDY_IMAGE", "CANARY_HOST", "PRIMARY_HOST", "ACME_EMAIL", "API_ENV_FILE",
  ]) {
    assert.ok(lib.includes(key), `manifest parser omits ${key}`);
  }
  assert.match(lib, /\$\{prefix\}_SOURCE_SHA/);
  assert.match(lib, /\$\{prefix\}_CHANGED/);
  assert.match(preflight, /VERSION_ID=.*24\\?\.04|24\\?\.04.*VERSION_ID/);
  assert.match(preflight, /dpkg --print-architecture/);
  assert.match(preflight, /COMPOSE_MINOR >= 24/);
  assert.match(preflight, /NTPSynchronized/);
  assert.match(preflight, /10 \* 1024 \* 1024/);
  assert.match(preflight, /\/var\/lib\/docker/);
  assert.match(preflight, /sport = :80 or sport = :443/);
  assert.match(preflight, /"bpdeploy"/);
  assert.match(preflight, /LOCAL_SCHEDULER_ENABLED/);
  assert.match(preflight, /INSTAGRAM_PUBLISH_ENABLED/);
  assert.match(preflight, /config --quiet/);
});

test("release validation accepts signed schema-1 layouts while requiring the full candidate layout", () => {
  const bash = findBash();
  assert.ok(bash, "Bash is required for the legacy release contract");
  const run = (sha) => spawnSync(bash, [
    "-c",
    'source "$1"; release_file_specs "/opt/brand-pilot/releases/$2" "$3"',
    "_",
    bashPath("deploy/scripts/lib.sh"),
    sha,
    "legacy-current",
  ], { cwd: process.cwd(), encoding: "utf8" });
  const legacy = run("02aa2bcae3f66d494f16a26bec9055cac17464f9");
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.doesNotMatch(legacy.stdout, /backup-state\.sh|restore-state\.sh/);
  for (const required of ["release.env", "compose.production.yml", "scripts/lib.sh", "scripts/deploy.sh"]) {
    assert.match(legacy.stdout, new RegExp(required.replace(".", "\\.")));
  }
  const candidateLegacy = spawnSync(bash, [
    "-c",
    'source "$1"; release_file_specs "/opt/brand-pilot/releases/$2"',
    "_",
    bashPath("deploy/scripts/lib.sh"),
    "02aa2bcae3f66d494f16a26bec9055cac17464f9",
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.match(candidateLegacy.stdout, /scripts\/backup-state\.sh/);
  assert.match(candidateLegacy.stdout, /scripts\/restore-state\.sh/);
  const lib = read("deploy/scripts/lib.sh");
  assert.match(
    lib,
    /readonly LEGACY_RELEASE_SHA="02aa2bcae3f66d494f16a26bec9055cac17464f9"/,
  );
  assert.match(
    lib,
    /validate_state_release_directory\(\)[\s\S]*validation_role="candidate"[\s\S]*RELEASE_SCHEMA=\[12\][\s\S]*validation_role="legacy-current"/,
  );
  assert.match(lib, /release-integrity\.sha256/);
  assert.match(lib, /scripts\/rollout-workers\.sh[\s\S]*scripts\/backup-state\.sh[\s\S]*scripts\/restore-state\.sh/);
  assert.match(
    lib,
    /validate_state_release_directory "\$root" "\$\{TRANSITION_JOURNAL\[TO_RELEASE\]\}"[\s\S]*validate_state_release_directory "\$root" "\$from_current"[\s\S]*validate_state_release_directory "\$root" "\$from_candidate"/,
  );
  const promote = read("deploy/scripts/promote.sh");
  assert.match(
    promote,
    /validate_state_release_directory "\$ROOT" "\$ORIGINAL_PREVIOUS_SHA"/,
    "promotion must accept a signed schema-1 release referenced by state/previous",
  );
  const current = run("95a975bf263756fbc13fb6ac16b1a3962e303d8e");
  assert.equal(current.status, 0, current.stderr);
  assert.doesNotMatch(current.stdout, /rollout-workers\.sh|backup-state\.sh|restore-state\.sh/);
});

test("the approved attachment retry rollout enables upload sessions without scheduling GC", () => {
  const flag = "AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED";
  const envExample = read("deploy/env/api.env.example");
  const compose = read("deploy/compose.production.yml");
  const services = assertComposeTopology(compose);
  const preflight = read("deploy/scripts/preflight.sh");

  assert.equal(envExample.match(new RegExp(`^${flag}=true$`, "gm"))?.length, 1);
  for (const service of ["api-primary", "api-canary"]) {
    assert.match(
      services.get(service).text,
      new RegExp(`^\\s+${flag}:\\s+["']true["']\\s*$`, "m"),
    );
  }
  assert.match(
    preflight,
    new RegExp(`require_exact_boolean\\s+"${flag}"\\s+"true"\\s+"\\$API_ENV_FILE"`),
  );
  for (const path of deploymentScripts) {
    assert.doesNotMatch(read(path), /\/internal\/cron\/ai-content-attachment-gc/);
  }
});

test("the attachment lifecycle history and unscheduled GC controls remain documented", () => {
  const flag = "AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED";
  const envExample = read("deploy/env/api.env.example");
  const compose = read("deploy/compose.production.yml");
  const services = assertComposeTopology(compose);
  const preflight = read("deploy/scripts/preflight.sh");
  const runbook = read(ubuntuRunbookPath);
  const normalizedRunbook = runbook.replace(/\s+/g, " ");
  const ledger = read("docs/prd/brand-pilot-feature-preservation-ledger.md");

  assert.equal(
    envExample.match(new RegExp(`^${flag}=true$`, "gm"))?.length,
    1,
    "reviewed API env example must contain one exact true attachment-session flag",
  );
  for (const service of ["api-primary", "api-canary"]) {
    assert.match(
      services.get(service).text,
      new RegExp(`^\\s+${flag}:\\s+["']true["']\\s*$`, "m"),
      `${service} must force the attachment-session flag true`,
    );
  }
  assert.match(
    preflight,
    new RegExp(`require_exact_boolean\\s+"${flag}"\\s+"true"\\s+"\\$API_ENV_FILE"`),
  );
  assert.ok(
    runbook.match(new RegExp(`${flag}=false`, "g"))?.length >= 4,
    "runbook must retain the flag in fixed controls, safe values, final evidence, and dark-launch checks",
  );

  for (const phrase of [
    `${flag}=false`,
    "/internal/cron/ai-content-attachment-gc",
    "implemented-but-not-scheduled",
    "later Operations/rollout approval",
    "full legacy-token TTL drain",
    "oldestEligiblePendingAgeSeconds",
    "deadLetterCount",
    "five consecutive scheduled runs",
    "forward-only",
    "flag OFF",
    "cleanup obligations remain",
  ]) {
    assert.ok(normalizedRunbook.includes(phrase), `Ubuntu runbook missing: ${phrase}`);
  }
  for (const phrase of [
    "콘텐츠 첨부 총 5개",
    "PNG/JPEG 각 5MB",
    "활성 중복 경고",
    "fresh upload attempt",
    "immutable worker snapshot",
    "15-day retry boundary",
    "draft preservation on storage failure",
    "npm run test:deployment",
  ]) {
    assert.ok(ledger.includes(phrase), `preservation ledger missing: ${phrase}`);
  }

  for (const path of deploymentScripts) {
    assert.doesNotMatch(
      read(path),
      /\/internal\/cron\/ai-content-attachment-gc/,
      `${path} must not invoke attachment GC`,
    );
  }
  assert.doesNotMatch(compose, /(?:systemd|\.service\b|\.timer\b)/i);
  const trackedOperationalFiles = spawnSync(
    "git",
    ["ls-files", "-z", "--", "apps/api/.env.example", "deploy"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(trackedOperationalFiles.status, 0, trackedOperationalFiles.stderr);
  const operationalPaths = trackedOperationalFiles.stdout.split("\0").filter(Boolean);
  const trackedWorkflowFiles = spawnSync(
    "git",
    ["ls-files", "-z", "--", ":(top).github"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(trackedWorkflowFiles.status, 0, trackedWorkflowFiles.stderr);
  const workflowPaths = trackedWorkflowFiles.stdout
    .split("\0")
    .filter(Boolean)
    .map((path) => resolve(path));
  assert.ok([...operationalPaths, ...workflowPaths].length > 0);
  assert.equal(
    operationalPaths.some((path) => /\.(?:service|timer)$/.test(path)),
    false,
    "first rollout must not check in an attachment lifecycle systemd unit",
  );
});

test("canary verification and promotion keep bounded explicit contracts", () => {
  const verify = read("deploy/scripts/verify-canary.sh");
  const promote = read("deploy/scripts/promote.sh");
  assert.match(verify, /\/health/);
  assert.match(verify, /\/ready/);
  assert.match(verify, /cors_allowed/);
  assert.match(verify, /cors_denied/);
  assert.match(verify, /dev-complete/);
  assert.match(verify, /"404"/);
  assert.match(promote, /--prepare/);
  assert.match(promote, /--commit/);
  assert.match(promote, /--dns-cutover-confirmed/);
  assert.match(promote, /CANARY_HOST/);
  assert.match(promote, /PRIMARY_HOST/);
  assert.match(promote, /flock/);
  assert.match(promote, /\[\[\s+"\$CURRENT_SHA"\s+!=\s+"\$CANDIDATE_SHA"\s+\]\]/);
  assert.match(promote, /rm -f -- "\$ROOT\/state\/candidate"/);
});

test("deployment phases target only their isolated API service", () => {
  const deploy = read("deploy/scripts/deploy.sh");
  const promote = read("deploy/scripts/promote.sh");
  const rollback = read("deploy/scripts/rollback.sh");
  assert.match(deploy, /up[\s\S]*api-canary/);
  assert.doesNotMatch(deploy, /up[^\n]*api-primary/);
  assert.match(promote, /up[\s\S]{0,160}api-primary/);
  assert.doesNotMatch(promote, /up[^\n]*api-canary/);
  assert.match(rollback, /PHASE[\s\S]*api-canary/);
  assert.match(rollback, /PHASE[\s\S]*api-primary/);
});

test("installed releases and state are regular immutable verified files", () => {
  const lib = read("deploy/scripts/lib.sh");
  const deploy = read("deploy/scripts/deploy.sh");
  assert.match(lib, /release-integrity\.sha256/);
  assert.match(lib, /644 Caddyfile\.canary/);
  assert.match(lib, /generate_release_integrity/);
  assert.match(lib, /validate_release_integrity/);
  assert.match(lib, /!\s+-L/);
  assert.match(lib, /require_secure_state_file/);
  assert.match(deploy, /generate_release_integrity/);
  assert.match(deploy, /Caddyfile\.canary/);
  assert.match(deploy, /validate_release_directory/);
});

test("CI publishing has main-only publishing, PR verification, and narrow permissions", () => {
  const workflow = read(publishWorkflowPath);
  const verifyJob = parseWorkflowJob(workflow, "verify");
  const publishJob = parseWorkflowJob(workflow, "publish");
  assert.match(workflow, /^name: Publish Brand Pilot server images$/m);
  assert.match(workflow, /^ {2}pull_request:\n {4}branches: \[main\]/m);
  assert.match(workflow, /^ {2}push:\n {4}branches: \[main\]/m);
  assert.doesNotMatch(workflow, /instagram-production-base-hotfix/);
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf("\njobs:")), /packages: write/);
  assert.match(verifyJob, /^ {4}permissions:\n {6}contents: read$/m);
  assert.doesNotMatch(verifyJob, /packages: write|docker\/login-action|docker\/build-push-action/);
  assert.match(publishJob, /^ {4}needs: \[impact, verify\]$/m);
  assert.match(publishJob, /github\.ref == 'refs\/heads\/main'/);
  assert.match(publishJob, /^ {4}permissions:\n {6}contents: read\n {6}packages: write$/m);
  assert.match(verifyJob, /^ {4}runs-on: ubuntu-24\.04$/m);
  assert.match(publishJob, /^ {4}runs-on: ubuntu-24\.04$/m);
  assert.doesNotMatch(workflow, /^\s+(?:checks|deployments|id-token|issues|pull-requests):\s+write$/m);
});

test("CI publishing verifies release tooling plus only affected workspaces", () => {
  const workflow = read(publishWorkflowPath);
  const verifyJob = parseWorkflowJob(workflow, "verify");
  assert.match(verifyJob, /uses: actions\/checkout@[0-9a-f]{40}\s+# v4\.4\.0[\s\S]*persist-credentials: false/);
  assert.match(verifyJob, /uses: actions\/setup-node@[0-9a-f]{40}\s+# v4\.4\.0[\s\S]*node-version: 22\.23\.1[\s\S]*cache: npm[\s\S]*cache-dependency-path: brand_poilot\/package-lock\.json/);
  assert.match(verifyJob, /name: Install\n {8}working-directory: brand_poilot\n {8}run: npm ci/);
  for (const command of [
    "node --test scripts/release-impact.test.mjs",
    "node --test scripts/assemble-release-manifest.test.mjs",
    "npm run test:contract",
    "shellcheck --exclude=SC1091,SC2016,SC2034,SC2317 deploy/scripts/*.sh",
    "npm run test:deployment",
  ]) {
    assert.ok(verifyJob.includes(command), `verify job missing ${command}`);
  }
  assert.match(verifyJob, /if: fromJSON\(needs\.impact\.outputs\.components\)\.api[\s\S]*npm run pretest --workspace @brand-pilot\/api[\s\S]*npm exec --workspace @brand-pilot\/api -- vitest run[\s\S]*src\/server\.contentProposalWorker\.test\.ts[\s\S]*--maxWorkers=4/);
  for (const testFile of [
    "src/publishCalendarIdempotency.test.ts",
    "src/publishCalendarRepository.test.ts",
    "src/publishCalendarProvisioning.pglite.test.ts",
    "src/publishCalendarMigration086.pglite.test.ts",
    "src/publishCalendarAllocator.test.ts",
    "src/publishItemsRepository.test.ts",
    "src/publishItemsRepository.pglite.test.ts",
    "src/publishItemState.test.ts",
    "src/publishSchedule.test.ts",
  ]) {
    assert.ok(verifyJob.includes(testFile), `API verify job missing ${testFile}`);
  }
  for (const focusedCommand of [
    'src/repository.test.ts --testNamePattern "Task 4 transactional topic generation|Task 11 topic publish group scheduling|preserves non-reservation recovery, lease, and provider retry timing|composes the tenant-scoped canonical publish items repository"',
    'src/server.test.ts --testNamePattern "scopes calendar routes|returns canonical publish items|requires authentication and brand access before listing canonical publish items|removes the legacy no-key calendar slot creation route|returns brand-scoped authoritative manual calendar options|lists scoped calendar content candidates|provisions a content-backed manual slot|provisions a validated manual slot batch|returns a conflict when a manual batch exceeds the plan generation quota"',
  ]) {
    assert.ok(verifyJob.includes(focusedCommand), `API verify job missing focused command: ${focusedCommand}`);
  }
  assert.doesNotMatch(verifyJob, /npm run test --workspace @brand-pilot\/api/);
  assert.match(verifyJob, /if: needs\.impact\.outputs\.migration_changed == 'true'[\s\S]*npm run test:migrations/);
  for (const command of [
    "node --test scripts/migrate.test.mjs",
    "node --test scripts/migrationRunner.test.mjs",
    "node --test scripts/ai-content-three-format-cutover.postgres.integration.test.mjs",
    "AI_CONTENT_074_ENFORCE_BENCHMARK=false node --test scripts/ai-content-074.postgres.integration.test.mjs",
    "npm exec --workspace @brand-pilot/api -- vitest run src/publishCalendarMigration086.postgres.integration.test.ts",
    "npm exec --workspace @brand-pilot/api -- vitest run src/publishCalendarMigration092.postgres.integration.test.ts",
  ]) {
    assert.ok(verifyJob.includes(command), `migration verify job missing ${command}`);
  }
  assert.doesNotMatch(verifyJob, /ai-content-074\.postgres\.integration\.test\.mjs[^\n]*--test-name-pattern/);
  assert.doesNotMatch(
    verifyJob,
    /publishCalendarMigration092\.postgres\.integration\.test\.ts[^\n]*(?:\|\|\s*true|--passWithNoTests)/,
  );
});

test("CI publishing uses an affected linux-amd64 matrix with immutable metadata and cache", () => {
  const workflow = read(publishWorkflowPath);
  const publishJob = parseWorkflowJob(workflow, "publish");
  assert.match(publishJob, /uses: actions\/checkout@[0-9a-f]{40}\s+# v4\.4\.0[\s\S]*persist-credentials: false/);
  assert.match(publishJob, /uses: docker\/setup-buildx-action@[0-9a-f]{40}\s+# v3\.12\.0/);
  assert.match(publishJob, /uses: docker\/login-action@[0-9a-f]{40}\s+# v3\.7\.0[\s\S]*registry: \$\{\{ env\.REGISTRY \}\}[\s\S]*username: \$\{\{ github\.actor \}\}[\s\S]*password: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(publishJob, /matrix: \$\{\{ fromJSON\(needs\.impact\.outputs\.matrix\) \}\}/);
  assert.match(publishJob, /uses: docker\/build-push-action@[0-9a-f]{40}\s+# v6\.19\.2[\s\S]*context: brand_poilot[\s\S]*file: brand_poilot\/\$\{\{ matrix\.dockerfile \}\}[\s\S]*platforms: linux\/amd64[\s\S]*push: true/);
  assert.match(publishJob, /cache-from: type=gha/);
  assert.match(publishJob, /cache-to: type=gha,mode=max/);
  assert.match(publishJob, /org\.opencontainers\.image\.revision=\$\{\{ github\.sha \}\}/);
  assert.match(publishJob, /org\.opencontainers\.image\.source=https:\/\/github\.com\/\$\{\{ github\.repository \}\}/);
});

test("CI publishing pins every third-party action to its verified commit", () => {
  const workflow = read(publishWorkflowPath);
  const expected = new Map([
    ["actions/checkout", "11d5960a326750d5838078e36cf38b85af677262"],
    ["actions/setup-node", "49933ea5288caeca8642d1e84afbd3f7d6820020"],
    ["docker/setup-buildx-action", "8d2750c68a42422c14e847fe6c8ac0403b4cbd6f"],
    ["docker/login-action", "c94ce9fb468520275223c153574b00df6fe4bcc9"],
    ["docker/build-push-action", "10e90e3645eae34f1e60eeb005ba3a3d33f178e8"],
    ["actions/upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02"],
    ["actions/download-artifact", "d3f86a106a0bac45b974a628896c90dbdf5c8093"],
  ]);
  const uses = [...workflow.matchAll(/^\s*(?:-\s+)?uses:\s+([^@\s]+)@([^\s#]+)\s+#\s+(v\d+\.\d+\.\d+)$/gm)];
  assert.ok(uses.length >= 8);
  for (const [, action, revision] of uses) {
    assert.equal(revision, expected.get(action), `${action} is not pinned to the verified SHA`);
  }
  assert.doesNotMatch(workflow, /^\s*(?:-\s+)?uses:\s+\S+@v\d+(?:\s|$)/m);
});

test("CI release manifest remains schema 3, assembled from digests, and checksummed", () => {
  const workflow = read(publishWorkflowPath);
  assert.match(workflow, /assemble-release-manifest\.mjs/);
  assert.match(workflow, /grep -Fx 'RELEASE_SCHEMA=3' release\.env/);
  assert.doesNotMatch(workflow, /grep -Fx 'RELEASE_SCHEMA=2' release\.env/);
  assert.match(workflow, /IMAGE_DIGEST.*sha256:\[0-9a-f\]\{64\}/);
  assert.match(workflow, /sha256sum release\.env > release\.env\.sha256/);
  assert.match(workflow, /release-bundle-\$GITHUB_SHA\.tar\.gz/);
});

test("production baseline recovery is manual, pinned, read-only, and provenance-bound", () => {
  assert.equal(existsSync(baselineRecoveryWorkflowPath), true);
  const recovery = read(baselineRecoveryWorkflowPath);
  assert.match(recovery, /^name: Recover Brand Pilot production baseline$/m);
  assert.match(recovery, /^ {2}workflow_dispatch:\n {4}inputs:/m);
  for (const input of [
    "expected_release_sha",
    "expected_api_digest",
    "expected_release_env_sha256",
    "expected_release_integrity_sha256",
  ]) {
    assert.match(recovery, new RegExp(`^ {6}${input}:$`, "m"));
  }
  assert.match(recovery, /^ {4}environment: Production$/m);
  assert.match(recovery, /validate_release_directory "\$release_dir" candidate/);
  assert.match(recovery, /state\/current/);
  assert.match(recovery, /brand-pilot-api-primary-1/);
  assert.match(recovery, /brand-pilot-api-canary-1/);
  assert.match(recovery, /runs-on: \[self-hosted, Windows, X64, brand-pilot-recovery\]/);
  assert.match(recovery, /\/c\/Windows\/System32\/OpenSSH\/ssh\.exe/);
  assert.match(recovery, /recovery_archive_member_invalid/);
  assert.match(recovery, /recovery_archive_member_duplicate/);
  assert.match(recovery, /recovery_archive_file_set_invalid/);
  assert.match(recovery, /target\.open\("xb"\)/);
  assert.match(recovery, /baseline-recovery-provenance\.json/);
  assert.match(recovery, /workflowRunId: process\.env\.GITHUB_RUN_ID/);
  assert.match(recovery, /workflowHeadSha: process\.env\.GITHUB_SHA/);
  assert.match(recovery, /brand-pilot-release-\$\{\{ inputs\.expected_release_sha \}\}/);
  assert.match(recovery, /uses: actions\/upload-artifact@[0-9a-f]{40}\s+# v4\.6\.2/);
  assert.doesNotMatch(
    recovery,
    /docker compose[^\n]*(?:up|down|restart|stop|rm)|\b(?:promote|rollback|deploy)\.sh\b|\b(?:rm|mv|cp|install|chmod|chown)\b[^\n]*\/opt\/brand-pilot/,
  );
});

test("normal publishing accepts recovery artifacts only from the successful recovery workflow", () => {
  const workflow = read(publishWorkflowPath);
  assert.match(workflow, /recover-brand-pilot-production-baseline\.yml/);
  assert.match(workflow, /baseline-recovery-provenance\.json/);
  assert.match(workflow, /brand-pilot-baseline-recovery\.v1/);
  assert.match(workflow, /\.conclusion == "success"/);
  assert.match(workflow, /\.event == "workflow_dispatch"/);
  assert.match(workflow, /\.head_branch == "main"/);
  assert.match(workflow, /\.path == "\.github\/workflows\/recover-brand-pilot-production-baseline\.yml"/);
  assert.match(workflow, /provenance\.workflowRunId !== process\.env\.RECOVERY_RUN_ID/);
  assert.match(workflow, /provenance\.workflowHeadSha !== process\.env\.RECOVERY_WORKFLOW_HEAD_SHA/);
  assert.match(workflow, /production_manifest_recovery_provenance_invalid/);
  assert.doesNotMatch(workflow, /artifacts\?name=brand-pilot-release-/);
});

test("normal publishing prefers a trusted recovery artifact over a stale publish artifact", () => {
  const workflow = read(publishWorkflowPath);
  const manifestJob = parseWorkflowJob(workflow, "manifest");
  const recoveryLookup = manifestJob.indexOf("actions/workflows/recover-brand-pilot-production-baseline.yml/runs");
  const publishLookup = manifestJob.indexOf("actions/workflows/publish-brand-pilot-server-images.yml/runs");

  assert.ok(recoveryLookup >= 0, "recovery artifact lookup is missing");
  assert.ok(publishLookup >= 0, "publish artifact lookup is missing");
  assert.ok(recoveryLookup < publishLookup, "stale publish artifacts must not override a recovered operating baseline");
});

test("CI publishing uploads a complete bundle and keeps production mutation credential gated", () => {
  const workflow = read(publishWorkflowPath);
  const manifestJob = parseWorkflowJob(workflow, "manifest");
  const deployJob = parseWorkflowJob(workflow, "deploy");
  assert.match(manifestJob, /name: brand-pilot-release-\$\{\{ github\.sha \}\}/);
  assert.match(manifestJob, /brand_poilot\/release-bundle-\$\{\{ github\.sha \}\}\.tar\.gz/);
  assert.match(deployJob, /vars\.BRAND_PILOT_CD_ENABLED == 'true'/);
  assert.match(deployJob, /group: brand-pilot-production[\s\S]*cancel-in-progress: false/);
  assert.match(deployJob, /cd_credentials_missing/);
  assert.doesNotMatch(workflow, /npm run db:migrate|\bpsql\b/);
});

function findBash() {
  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
      ]
    : ["/usr/bin/bash", "/bin/bash"];
  return candidates.find(existsSync);
}

function bashPath(path) {
  const absolute = resolve(path).replaceAll("\\", "/");
  if (process.platform !== "win32") return absolute;
  return absolute.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function writeReleaseManifest(directory, overrides = {}, extraLines = []) {
  mkdirSync(directory, { recursive: true });
  const digest = "a".repeat(64);
  const values = {
    RELEASE_SCHEMA: "3",
    RELEASE_SHA: "1".repeat(40),
    API_IMAGE: `ghcr.io/dkskrn2/brand-pilot-api@sha256:${digest}`,
    PUBLISH_SCHEDULER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-publish-scheduler@sha256:${digest}`,
    DM_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-dm-worker@sha256:${digest}`,
    WIKI_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-wiki-worker@sha256:${digest}`,
    CONTENT_PROPOSAL_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-content-proposal-worker@sha256:${digest}`,
    BRAND_INTELLIGENCE_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-brand-intelligence-worker@sha256:${digest}`,
    SUBJECT_ANALYSIS_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-subject-analysis-worker@sha256:${digest}`,
    IMAGE_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-image-worker@sha256:${digest}`,
    CARD_NEWS_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-card-news-worker@sha256:${digest}`,
    BLOG_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-blog-worker@sha256:${digest}`,
    REEL_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-reel-worker@sha256:${digest}`,
    CADDY_IMAGE: `docker.io/library/caddy@sha256:${digest}`,
    CANARY_HOST: "canary-api.danbammsg.co.kr",
    PRIMARY_HOST: "api.danbammsg.co.kr",
    ACME_EMAIL: "ops@danbammsg.co.kr",
    API_ENV_FILE: "/opt/brand-pilot/shared/env/api.env",
    ...overrides,
  };
  if (values.RELEASE_SCHEMA === "2" || values.RELEASE_SCHEMA === "3") {
    for (const imageKey of [
      "API_IMAGE",
      "PUBLISH_SCHEDULER_IMAGE",
      "DM_WORKER_IMAGE",
      "WIKI_WORKER_IMAGE",
      "CONTENT_PROPOSAL_WORKER_IMAGE",
      "BRAND_INTELLIGENCE_WORKER_IMAGE",
      "SUBJECT_ANALYSIS_WORKER_IMAGE",
      "IMAGE_WORKER_IMAGE",
      "CARD_NEWS_WORKER_IMAGE",
      "BLOG_WORKER_IMAGE",
      "REEL_WORKER_IMAGE",
    ]) {
      const prefix = imageKey.slice(0, -"_IMAGE".length);
      values[`${prefix}_SOURCE_SHA`] ??= values.RELEASE_SHA;
      values[`${prefix}_CHANGED`] ??= "true";
    }
  }
  const manifest = join(directory, "release.env");
  const contents = [
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    ...extraLines,
    "",
  ].join("\n");
  writeFileSync(manifest, contents, { mode: 0o600 });
  chmodSync(manifest, 0o600);
  const checksum = createHash("sha256").update(contents).digest("hex");
  writeFileSync(`${manifest}.sha256`, `${checksum}  release.env\n`, { mode: 0o600 });
  chmodSync(`${manifest}.sha256`, 0o600);
  return manifest;
}

function seedRelease(
  root,
  sha,
  apiEnvFile,
  overrides = {},
  { legacyFileSet = false } = {},
) {
  const releaseDirectory = join(root, "releases", sha);
  const digestCharacter = sha[0] === "1" ? "a" : sha[0] === "2" ? "b" : "c";
  const digest = digestCharacter.repeat(64);
  writeReleaseManifest(releaseDirectory, {
    RELEASE_SHA: sha,
    API_IMAGE: `ghcr.io/dkskrn2/brand-pilot-api@sha256:${digest}`,
    PUBLISH_SCHEDULER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-publish-scheduler@sha256:${digest}`,
    DM_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-dm-worker@sha256:${digest}`,
    WIKI_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-wiki-worker@sha256:${digest}`,
    CONTENT_PROPOSAL_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-content-proposal-worker@sha256:${digest}`,
    BRAND_INTELLIGENCE_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-brand-intelligence-worker@sha256:${digest}`,
    SUBJECT_ANALYSIS_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-subject-analysis-worker@sha256:${digest}`,
    IMAGE_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-image-worker@sha256:${digest}`,
    CARD_NEWS_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-card-news-worker@sha256:${digest}`,
    BLOG_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-blog-worker@sha256:${digest}`,
    REEL_WORKER_IMAGE: `ghcr.io/dkskrn2/brand-pilot-reel-worker@sha256:${digest}`,
    CADDY_IMAGE: `docker.io/library/caddy@sha256:${digest}`,
    API_ENV_FILE: apiEnvFile,
    ...overrides,
  });
  copyFileSync("deploy/compose.production.yml", join(releaseDirectory, "compose.production.yml"));
  copyFileSync("deploy/Caddyfile", join(releaseDirectory, "Caddyfile"));
  copyFileSync("deploy/Caddyfile.canary", join(releaseDirectory, "Caddyfile.canary"));
  mkdirSync(join(releaseDirectory, "scripts"), { recursive: true });
  const releaseScripts = [
    "lib.sh",
    "preflight.sh",
    "deploy.sh",
    "verify-canary.sh",
    "promote.sh",
    "rollback.sh",
    ...(legacyFileSet ? [] : [
      "rollout-workers.sh",
      "backup-state.sh",
      "restore-state.sh",
      "ai-content-cutover.sh",
      "verify-ai-content-cutover.sh",
      "stage-ai-content-release.sh",
      "preflight-ai-content.sh",
      "rollout-ai-content-cutover.sh",
      "collect-ai-content-backend-evidence.sh",
    ]),
  ];
  for (const name of releaseScripts) {
    copyFileSync(join("deploy", "scripts", name), join(releaseDirectory, "scripts", name));
    chmodSync(join(releaseDirectory, "scripts", name), 0o755);
  }
  const specs = [
    [0o600, "release.env"],
    [0o600, "release.env.sha256"],
    [0o644, "compose.production.yml"],
    [0o644, "Caddyfile"],
    [0o644, "Caddyfile.canary"],
    ...["lib.sh", "preflight.sh", "deploy.sh", "verify-canary.sh", "promote.sh", "rollback.sh"]
      .map((name) => [0o755, `scripts/${name}`]),
    ...(legacyFileSet
      ? []
      : [
          [0o755, "scripts/rollout-workers.sh"],
          [0o755, "scripts/backup-state.sh"],
          [0o755, "scripts/restore-state.sh"],
          [0o755, "scripts/ai-content-cutover.sh"],
          [0o755, "scripts/verify-ai-content-cutover.sh"],
          [0o755, "scripts/stage-ai-content-release.sh"],
          [0o755, "scripts/preflight-ai-content.sh"],
          [0o755, "scripts/rollout-ai-content-cutover.sh"],
          [0o755, "scripts/collect-ai-content-backend-evidence.sh"],
        ]),
  ];
  const integrity = specs.map(([mode, relative]) => {
    chmodSync(join(releaseDirectory, relative), mode);
    const checksum = createHash("sha256").update(readFileSync(join(releaseDirectory, relative))).digest("hex");
    return `${checksum}  ${mode.toString(8)}  ${relative}`;
  }).join("\n") + "\n";
  writeFileSync(join(releaseDirectory, "release-integrity.sha256"), integrity, { mode: 0o600 });
  chmodSync(join(releaseDirectory, "release-integrity.sha256"), 0o600);
  return releaseDirectory;
}

function writeTransitionJournal(root, values) {
  const journal = join(root, "state", "transition.journal");
  const contents = [
    "JOURNAL_SCHEMA=1",
    `OPERATION=${values.operation}`,
    `DEPLOYMENT_PHASE=${values.deploymentPhase}`,
    `TRANSITION_PHASE=${values.transitionPhase ?? "runtime_mutation"}`,
    `FROM_CURRENT=${values.fromCurrent ?? "NONE"}`,
    `FROM_CANDIDATE=${values.fromCandidate ?? "NONE"}`,
    `FROM_PREVIOUS=${values.fromPrevious ?? "NONE"}`,
    `FROM_PREPARED=${values.fromPrepared ?? "0"}`,
    `TO_RELEASE=${values.toRelease}`,
    "",
  ].join("\n");
  writeFileSync(journal, contents, { mode: 0o600 });
  chmodSync(journal, 0o600);
  return journal;
}

function dockerMockScript() {
  return `#!/usr/bin/env bash
printf 'PRIMARY_API_IMAGE=%s CANDIDATE_API_IMAGE=%s CADDY_IMAGE=%s CADDYFILE_PATH=%s %s\\n' "\${PRIMARY_API_IMAGE:-}" "\${CANDIDATE_API_IMAGE:-}" "\${CADDY_IMAGE:-}" "\${CADDYFILE_PATH:-}" "$*" >> "$DOCKER_LOG"
if [[ -n "\${EVENT_LOG:-}" ]]; then printf 'docker %s\\n' "$*" >> "$EVENT_LOG"; fi
if [[ "$*" == *"/app/scripts/ai-content-cutover-floor-probe.mjs"* ]]; then
  printf '%s\\n' "\${AI_CONTENT_FLOOR_MARKER_FOR_TEST:-false}"
  exit 0
fi
if [[ "$*" == *"/app/scripts/migrate.mjs --post-075-schema"* ]]; then
  printf '{\n  "post075SchemaMigration": {\n    "contractVersion": "post-075-schema-migration-evidence.v1",\n    "providerRoleName": "postgres",\n    "migrationId": "092_publish_calendar_weekly_schedule.sql",\n    "migrationSha256": "%s",\n    "status": "already_applied"\n  }\n}\n' "$POST_075_SCHEMA_SHA_FOR_TEST"
  exit 0
fi
if [[ "$1 $2" == "image inspect" ]]; then
  case "\${@: -1}" in
    *@sha256:a*) printf '%s\\n' "$(printf '1%.0s' {1..40})" ;;
    *@sha256:b*) printf '%s\\n' "$(printf '2%.0s' {1..40})" ;;
    *@sha256:c*) printf '%s\\n' "$(printf '3%.0s' {1..40})" ;;
    *) printf '%s\\n' "$RELEASE_SHA_FOR_TEST" ;;
  esac
fi
if [[ "$*" == *" up -d "* ]]; then
  count=0
  [[ ! -f "$DOCKER_UP_COUNT_FILE" ]] || count="$(cat "$DOCKER_UP_COUNT_FILE")"
  count=$((count + 1))
  printf '%s\\n' "$count" > "$DOCKER_UP_COUNT_FILE"
  if (( count <= DOCKER_UP_FAILURES )); then exit 42; fi
  if [[ -n "\${DOCKER_FAIL_UP_SERVICE:-}" && "$*" == *"\${DOCKER_FAIL_UP_SERVICE}"* ]]; then
    service_count_file="\${DOCKER_UP_COUNT_FILE}.\${DOCKER_FAIL_UP_SERVICE}"
    service_count=0
    [[ ! -f "$service_count_file" ]] || service_count="$(cat "$service_count_file")"
    service_count=$((service_count + 1))
    printf '%s\\n' "$service_count" > "$service_count_file"
    if (( service_count <= \${DOCKER_FAIL_UP_TIMES:-1} )); then exit 43; fi
  fi
  if [[ -n "\${DOCKER_KILL_SWITCH:-}" && -f "$DOCKER_KILL_SWITCH" &&
    -n "\${DOCKER_KILL_UP_SERVICE:-}" && "$*" == *"\${DOCKER_KILL_UP_SERVICE}"* ]]; then
    rm -f -- "$DOCKER_KILL_SWITCH"
    kill -KILL "$PPID"
    sleep 1
  fi
fi
exit 0
`;
}

function statMockScript() {
  return `#!/usr/bin/env bash
if [[ "$*" == *"%U"* ]]; then
  printf 'bpdeploy\\n'
  exit 0
fi
path="\${@: -1}"
case "$path" in
  */post-075-data-migrations|*/post-075-schema-migrations) printf '700\\n' ;;
  */scripts/*.sh) printf '755\\n' ;;
  */compose.production.yml|*/Caddyfile|*/Caddyfile.canary) printf '644\\n' ;;
  *) printf '600\\n' ;;
esac
`;
}

function bashFixtureCommand() {
  return `export PATH="$1:/usr/bin:/bin"
stat() {
  if [[ "$*" == *"%U"* ]]; then
    printf 'bpdeploy\\n'
    return 0
  fi
  path="\${@: -1}"
  case "$path" in
    */post-075-data-migrations|*/post-075-schema-migrations) printf '700\\n' ;;
    */scripts/*.sh) printf '755\\n' ;;
    */compose.production.yml|*/Caddyfile|*/Caddyfile.canary) printf '644\\n' ;;
    *) printf '600\\n' ;;
  esac
}
export -f stat
shift
exec bash "$@"`;
}

function runDeployFixture({
  overrides = {},
  extraLines = [],
  curlSucceeds = false,
  dockerUpFailures = 0,
  dockerFailUpService = "",
  currentSha = "2".repeat(40),
  currentManifestOverrides = {},
  corruptCurrent = false,
  previousCandidateSha = null,
  previousCandidateManifestOverrides = {},
  corruptCandidate = false,
} = {}) {
  const bash = findBash();
  assert.ok(bash, "Bash is required for disposable deployment tests");
  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-deploy-"));
  const root = join(fixture, "root");
  const incoming = join(fixture, "incoming");
  const mocks = join(fixture, "bin");
  mkdirSync(join(root, "state"), { recursive: true });
  const post075State = join(root, "state", "post-075-data-migrations");
  mkdirSync(post075State, { recursive: true, mode: 0o700 });
  writeFileSync(join(post075State, "076_manual_content_generation_brand_rules.sql.json"), `${JSON.stringify({
    post075DataMigration: {
      contractVersion: "post-075-data-migration-evidence.v1",
      providerRoleName: "postgres",
      migrationId: "076_manual_content_generation_brand_rules.sql",
      migrationSha256: "da42c957d4307d58c1f37f5d508c8a1f14836727080d6290e4b0537e43167604",
      status: "already_applied",
    },
  }, null, 2)}\n`, { mode: 0o600 });
  const post075SchemaState = join(root, "state", "post-075-schema-migrations");
  mkdirSync(post075SchemaState, { recursive: true, mode: 0o700 });
  writeFileSync(join(post075SchemaState, "085_publish_calendar_idempotency_expand.sql.json"), `${JSON.stringify({
    post075SchemaMigration: {
      contractVersion: "post-075-schema-migration-evidence.v1",
      providerRoleName: "postgres",
      migrationId: "085_publish_calendar_idempotency_expand.sql",
      migrationSha256: "1601035eee057da39cac63c6e9a187fcd3331d590414005d2971a943306d22de",
      status: "already_applied",
    },
  }, null, 2)}\n`, { mode: 0o600 });
  mkdirSync(join(root, "shared", "env"), { recursive: true });
  writeFileSync(join(root, "shared", "env", "api.env"), "TEST_ONLY=true\nDB_SSL_CA_BASE64=dGVzdA==\n", { mode: 0o600 });
  chmodSync(join(root, "shared", "env", "api.env"), 0o600);
  const providerDatabaseUrlFile = join(root, "shared", "provider-admin-database-url");
  writeFileSync(providerDatabaseUrlFile, "postgresql://postgres:test@database.example/postgres\n", { mode: 0o600 });
  chmodSync(providerDatabaseUrlFile, 0o600);
  mkdirSync(mocks, { recursive: true });
  const manifest = writeReleaseManifest(incoming, {
    API_ENV_FILE: `${bashPath(root)}/shared/env/api.env`,
    ...overrides,
  }, extraLines);
  const dockerLog = join(fixture, "docker.log");
  const preflightLog = join(fixture, "preflight.log");
  const dockerUpCountFile = join(fixture, "docker-up-count");
  writeExecutable(join(mocks, "flock"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(join(mocks, "stat"), statMockScript());
  writeExecutable(join(mocks, "docker"), dockerMockScript());
  writeExecutable(join(mocks, "curl"), curlSucceeds
    ? "#!/usr/bin/env bash\nexit 0\n"
    : "#!/usr/bin/env bash\nexit 22\n");
  const preflight = join(fixture, "preflight");
  writeExecutable(
    preflight,
    "#!/usr/bin/env bash\nprintf '%s\\n' \"${CADDYFILE_PATH:-}\" > \"$PREFLIGHT_LOG\"\n",
  );
  if (corruptCurrent) {
    writeFileSync(join(root, "state", "current"), "not-a-release\n", { mode: 0o600 });
  } else if (currentSha) {
    seedRelease(
      root,
      currentSha,
      `${bashPath(root)}/shared/env/api.env`,
      currentManifestOverrides,
    );
    writeFileSync(join(root, "state", "current"), `${currentSha}\n`, { mode: 0o600 });
  }
  if (previousCandidateSha) {
    seedRelease(
      root,
      previousCandidateSha,
      `${bashPath(root)}/shared/env/api.env`,
      previousCandidateManifestOverrides,
    );
    writeFileSync(
      join(root, "state", "candidate"),
      `${previousCandidateSha}\n`,
      { mode: 0o600 },
    );
  } else if (corruptCandidate) {
    writeFileSync(join(root, "state", "candidate"), "not-a-release\n", { mode: 0o600 });
  }

  const result = spawnSync(bash, [
    "-c",
    bashFixtureCommand(),
    "_",
    bashPath(mocks),
    bashPath("deploy/scripts/deploy.sh"),
    bashPath(manifest),
    "--phase",
    "canary",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      BRAND_PILOT_ROOT: bashPath(root),
      PREFLIGHT_SCRIPT: bashPath(preflight),
      PREFLIGHT_LOG: bashPath(preflightLog),
      READY_TIMEOUT_SECONDS: "1",
      DOCKER_LOG: bashPath(dockerLog),
      DOCKER_UP_COUNT_FILE: bashPath(dockerUpCountFile),
      DOCKER_UP_FAILURES: String(dockerUpFailures),
      DOCKER_FAIL_UP_SERVICE: dockerFailUpService,
      DOCKER_FAIL_UP_TIMES: "1",
      RELEASE_SHA_FOR_TEST: "1".repeat(40),
      AI_CONTENT_POST_075_PROVIDER_DATABASE_URL_FILE: bashPath(providerDatabaseUrlFile),
      POST_075_SCHEMA_SHA_FOR_TEST: "c1bf905666ce4dabac137c0522fa0dc0300f574eda6d1e9648283f00b2af4d2b",
    },
  });
  return { fixture, root, dockerLog, preflightLog, result, candidateSha: "1".repeat(40) };
}

function runRollbackFixture({
  dockerUpFailures = 1,
  phase = "canary",
  curlSucceeds = true,
  failStateMove = "",
  current = true,
  candidate = true,
  currentManifestOverrides = {},
  candidateManifestOverrides = {},
  targetManifestOverrides = {},
  preparedContents = "",
} = {}) {
  const bash = findBash();
  assert.ok(bash, "Bash is required for disposable rollback tests");
  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-rollback-"));
  const root = join(fixture, "root");
  const mocks = join(fixture, "bin");
  const currentSha = "2".repeat(40);
  const targetSha = "1".repeat(40);
  const apiEnvFile = `${bashPath(root)}/shared/env/api.env`;
  mkdirSync(join(root, "state"), { recursive: true });
  mkdirSync(join(root, "shared", "env"), { recursive: true });
  writeFileSync(join(root, "shared", "env", "api.env"), "TEST_ONLY=true\nDB_SSL_CA_BASE64=dGVzdA==\n", { mode: 0o600 });
  chmodSync(join(root, "shared", "env", "api.env"), 0o600);
  mkdirSync(mocks, { recursive: true });
  const candidateSha = "3".repeat(40);
  if (current) {
    seedRelease(root, currentSha, apiEnvFile, currentManifestOverrides);
    writeFileSync(join(root, "state", "current"), `${currentSha}\n`, { mode: 0o600 });
  }
  seedRelease(root, targetSha, apiEnvFile, targetManifestOverrides);
  if (candidate) {
    seedRelease(root, candidateSha, apiEnvFile, candidateManifestOverrides);
    writeFileSync(join(root, "state", "candidate"), `${candidateSha}\n`, { mode: 0o600 });
  }
  if (preparedContents) {
    writeFileSync(join(root, "state", "prepared"), preparedContents, { mode: 0o600 });
  }
  const dockerLog = join(fixture, "docker.log");
  const dockerUpCountFile = join(fixture, "docker-up-count");
  writeExecutable(join(mocks, "flock"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(join(mocks, "stat"), statMockScript());
  writeExecutable(join(mocks, "docker"), dockerMockScript());
  if (failStateMove) {
    writeExecutable(join(mocks, "mv"), `#!/usr/bin/env bash
if [[ "\${@: -1}" == */state/${failStateMove} ]]; then exit 73; fi
exec /usr/bin/mv "$@"
`);
  }
  writeExecutable(
    join(mocks, "curl"),
    curlSucceeds ? "#!/usr/bin/env bash\nexit 0\n" : "#!/usr/bin/env bash\nexit 22\n",
  );
  const result = spawnSync(bash, [
    "-c",
    bashFixtureCommand(),
    "_",
    bashPath(mocks),
    bashPath("deploy/scripts/rollback.sh"),
    "--release",
    targetSha,
    "--phase",
    phase,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      BRAND_PILOT_ROOT: bashPath(root),
      READY_TIMEOUT_SECONDS: "1",
      DOCKER_LOG: bashPath(dockerLog),
      DOCKER_UP_COUNT_FILE: bashPath(dockerUpCountFile),
      DOCKER_UP_FAILURES: String(dockerUpFailures),
      RELEASE_SHA_FOR_TEST: targetSha,
    },
  });
  return { fixture, root, dockerLog, result, currentSha, targetSha };
}

function runPromotionFixture({
  current = true,
  initialCurrentSha = "2".repeat(40),
  currentLegacyFileSet = false,
  dockerFailUpService = "",
  dockerFailUpTimes = 1,
  dockerUpFailures = 0,
  curlSucceeds = true,
  failStateMove = "",
  failStateRemove = "",
  candidateManifestOverrides = {},
  currentManifestOverrides = {},
  dockerKillUpService = "caddy",
} = {}) {
  const bash = findBash();
  assert.ok(bash, "Bash is required for disposable promotion tests");
  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-promote-"));
  const root = join(fixture, "root");
  const mocks = join(fixture, "bin");
  const candidateSha = "1".repeat(40);
  const currentSha = initialCurrentSha;
  const apiEnvFile = `${bashPath(root)}/shared/env/api.env`;
  mkdirSync(join(root, "state"), { recursive: true });
  mkdirSync(mocks, { recursive: true });
  mkdirSync(join(root, "shared", "env"), { recursive: true });
  writeFileSync(join(root, "shared", "env", "api.env"), "TEST_ONLY=true\nDB_SSL_CA_BASE64=dGVzdA==\n", { mode: 0o600 });
  chmodSync(join(root, "shared", "env", "api.env"), 0o600);
  seedRelease(root, candidateSha, apiEnvFile, candidateManifestOverrides);
  writeFileSync(join(root, "state", "candidate"), `${candidateSha}\n`, { mode: 0o600 });
  writeFileSync(join(root, "state", "deploy.lock"), "", { mode: 0o600 });
  if (current) {
    seedRelease(
      root,
      currentSha,
      apiEnvFile,
      currentManifestOverrides,
      { legacyFileSet: currentLegacyFileSet },
    );
    writeFileSync(join(root, "state", "current"), `${currentSha}\n`, { mode: 0o600 });
  }
  const backupMetadata = join(root, "state", "promotion-backup.env");
  const candidateManifest = join(root, "releases", candidateSha, "release.env");
  const manifestChecksum = createHash("sha256").update(readFileSync(candidateManifest)).digest("hex");
  const envChecksum = createHash("sha256")
    .update(readFileSync(join(root, "shared", "env", "api.env")))
    .digest("hex");
  const currentDigestCharacter = currentSha[0] === "1"
    ? "a"
    : currentSha[0] === "2"
      ? "b"
      : "c";
  const currentDigest = current
    ? `ghcr.io/dkskrn2/brand-pilot-api@sha256:${currentDigestCharacter.repeat(64)}`
    : "NONE";
  writeFileSync(
    backupMetadata,
    [
      "BACKUP_SCHEMA=1",
      "PROVIDER_BACKUP_ID=test-provider-backup",
      "CADDY_BACKUP_ID=test-caddy-backup",
      `CADDY_DATA_SHA256=${"d".repeat(64)}`,
      `CURRENT_RELEASE_SHA=${current ? currentSha : "NONE"}`,
      `CURRENT_IMAGE_DIGEST=${currentDigest}`,
      `CANDIDATE_RELEASE_SHA=${candidateSha}`,
      `RELEASE_MANIFEST_SHA256=${manifestChecksum}`,
      `EXTERNAL_ENV_SHA256=${envChecksum}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  chmodSync(backupMetadata, 0o600);
  const curlLog = join(fixture, "curl.log");
  const dockerLog = join(fixture, "docker.log");
  const eventLog = join(fixture, "events.log");
  const dockerUpCountFile = join(fixture, "docker-up-count");
  const dockerKillSwitch = join(fixture, "docker-kill-switch");
  writeExecutable(join(mocks, "flock"), "#!/usr/bin/env bash\nexit 0\n");
  writeExecutable(join(mocks, "stat"), statMockScript());
  writeExecutable(join(mocks, "docker"), dockerMockScript());
  if (failStateMove) {
    writeExecutable(join(mocks, "mv"), `#!/usr/bin/env bash
if [[ "\${@: -1}" == */state/${failStateMove} ]]; then exit 73; fi
exec /usr/bin/mv "$@"
`);
  }
  if (failStateRemove) {
    writeExecutable(join(mocks, "rm"), `#!/usr/bin/env bash
if [[ "\${@: -1}" == */state/${failStateRemove} ]]; then exit 74; fi
exec /usr/bin/rm "$@"
`);
  }
  writeExecutable(join(mocks, "curl"), curlSucceeds ? `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CURL_LOG"
printf 'curl %s\\n' "$*" >> "$EVENT_LOG"
exit 0
` : `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CURL_LOG"
printf 'curl %s\\n' "$*" >> "$EVENT_LOG"
exit 22
`);
  const run = (...args) => spawnSync(bash, [
    "-c",
    bashFixtureCommand(),
    "_",
    bashPath(mocks),
    bashPath("deploy/scripts/promote.sh"),
    ...args,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      BRAND_PILOT_ROOT: bashPath(root),
      READY_TIMEOUT_SECONDS: "1",
      CURL_LOG: bashPath(curlLog),
      DOCKER_LOG: bashPath(dockerLog),
      EVENT_LOG: bashPath(eventLog),
      DOCKER_UP_COUNT_FILE: bashPath(dockerUpCountFile),
      DOCKER_UP_FAILURES: String(dockerUpFailures),
      DOCKER_FAIL_UP_SERVICE: dockerFailUpService,
      DOCKER_FAIL_UP_TIMES: String(dockerFailUpTimes),
      RELEASE_SHA_FOR_TEST: candidateSha,
      DOCKER_KILL_SWITCH: bashPath(dockerKillSwitch),
      DOCKER_KILL_UP_SERVICE: dockerKillUpService,
      PROMOTION_BACKUP_METADATA: bashPath(backupMetadata),
    },
  });
  const rollbackPrevious = () => spawnSync(bash, [
    "-c",
    bashFixtureCommand(),
    "_",
    bashPath(mocks),
    bashPath("deploy/scripts/rollback.sh"),
    "--previous",
    "--phase",
    "production",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      BRAND_PILOT_ROOT: bashPath(root),
      READY_TIMEOUT_SECONDS: "1",
      CURL_LOG: bashPath(curlLog),
      DOCKER_LOG: bashPath(dockerLog),
      EVENT_LOG: bashPath(eventLog),
      DOCKER_UP_COUNT_FILE: bashPath(dockerUpCountFile),
      DOCKER_UP_FAILURES: "0",
      RELEASE_SHA_FOR_TEST: currentSha,
    },
  });
  const prepare = () => {
    const result = run("--prepare");
    if (result.status === 0) {
      for (const path of [curlLog, dockerLog, eventLog, dockerUpCountFile]) {
        rmSync(path, { force: true });
      }
    }
    return result;
  };
  return {
    fixture,
    root,
    curlLog,
    dockerLog,
    eventLog,
    run,
    rollbackPrevious,
    prepare,
    candidateSha,
    currentSha,
    dockerKillSwitch,
  };
}

test("manifest parser rejects tag-only images, unknown keys, and duplicate keys before Compose up", () => {
  const fixtures = [
    runDeployFixture({ overrides: { API_IMAGE: "ghcr.io/dkskrn2/brand-pilot-api:latest" } }),
    runDeployFixture({ extraLines: ["UNEXPECTED_KEY=value"] }),
    runDeployFixture({ extraLines: ["RELEASE_SHA=2".padEnd(52, "2")] }),
    runDeployFixture({ overrides: { API_ENV_FILE: "/opt/brand-pilot/${UNSAFE}/api.env" } }),
  ];
  try {
    for (const fixture of fixtures) {
      assert.notEqual(fixture.result.status, 0, fixture.result.stdout);
      const dockerLog = existsSync(fixture.dockerLog) ? readFileSync(fixture.dockerLog, "utf8") : "";
      assert.doesNotMatch(dockerLog, /\bcompose\b.*\bup\b/);
    }
    assert.match(fixtures[0].result.stderr, /image_must_be_digest_pinned/);
    assert.match(fixtures[1].result.stderr, /manifest_unknown_key/);
    assert.match(fixtures[2].result.stderr, /manifest_duplicate_key/);
    assert.match(fixtures[3].result.stderr, /manifest_api_env_file_invalid/);
  } finally {
    for (const fixture of fixtures) rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a failed canary stops the candidate and leaves current unchanged", () => {
  const fixture = runDeployFixture();
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.equal(readFileSync(join(fixture.root, "state", "current"), "utf8"), `${"2".repeat(40)}\n`);
    assert.equal(existsSync(join(fixture.root, "state", "candidate")), false);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\/app\/scripts\/migrate\.mjs --post-075-schema/);
    assert.match(dockerLog, /\bcompose\b.*\bconfig --quiet\b/);
    assert.match(dockerLog, /\bcompose\b.*\bpull\b/);
    assert.match(dockerLog, /\bcompose\b.*\bup\b/);
    assert.match(dockerLog, /\bstop api-canary\b/);
    assert.match(dockerLog, /\brm -f api-canary\b/);
    assert.doesNotMatch(dockerLog, /\b(up|stop|rm)\b[^\n]*caddy/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a partial canary up failure removes candidate and leaves current unchanged", () => {
  const fixture = runDeployFixture({ curlSucceeds: true, dockerUpFailures: 1 });
  try {
    assert.notEqual(fixture.result.status, 0);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bcompose\b.*\bup\b/);
    assert.match(dockerLog, /\bstop api-canary\b/);
    assert.match(dockerLog, /\brm -f api-canary\b/);
    assert.doesNotMatch(dockerLog, /\bup -d\b[^\n]*caddy/);
    assert.equal(readFileSync(join(fixture.root, "state", "current"), "utf8"), `${"2".repeat(40)}\n`);
    assert.equal(existsSync(join(fixture.root, "state", "candidate")), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a partial candidate up failure removes only candidate and leaves exact current untouched", () => {
  const currentSha = "2".repeat(40);
  const fixture = runDeployFixture({
    curlSucceeds: true,
    dockerUpFailures: 1,
    currentSha,
  });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.equal(readFileSync(join(fixture.root, "state", "current"), "utf8"), `${currentSha}\n`);
    assert.equal(existsSync(join(fixture.root, "state", "candidate")), false);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    const upLines = dockerLog.split(/\r?\n/).filter((line) => /\bup -d\b/.test(line));
    assert.equal(upLines.length, 1, dockerLog);
    assert.match(upLines[0], new RegExp(`/releases/${"1".repeat(40)}/`));
    assert.match(dockerLog, /\bstop api-canary\b/);
    assert.doesNotMatch(dockerLog, /\b(up|stop|rm)\b[^\n]*api-primary/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a canary deploy with current never recreates or stops api-primary", () => {
  const currentSha = "2".repeat(40);
  const fixture = runDeployFixture({ curlSucceeds: true, currentSha });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bup\b[^\n]*api-canary/);
    assert.doesNotMatch(dockerLog, /\b(up|stop|rm)\b[^\n]*api-primary/);
    assert.doesNotMatch(dockerLog, /\b(pull|up|stop|rm)\b[^\n]*caddy/);
    assert.equal(readFileSync(join(fixture.root, "state", "current"), "utf8"), `${currentSha}\n`);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${"1".repeat(40)}\n`,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a corrupt previous candidate aborts before any Compose action", () => {
  const fixture = runDeployFixture({
    curlSucceeds: true,
    currentSha: "2".repeat(40),
    corruptCandidate: true,
  });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.match(fixture.result.stderr, /state_(sha|file)_invalid|release_sha_invalid/);
    assert.equal(existsSync(fixture.dockerLog), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a new canary readiness failure restores the exact previous candidate runtime and state", () => {
  const previousCandidateSha = "3".repeat(40);
  const fixture = runDeployFixture({
    currentSha: "2".repeat(40),
    previousCandidateSha,
  });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${previousCandidateSha}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    const upLines = dockerLog.split(/\r?\n/).filter((line) => /\bup -d\b/.test(line));
    assert.equal(upLines.length, 2, dockerLog);
    assert.match(upLines[0], new RegExp(`/releases/${"1".repeat(40)}/`));
    assert.match(upLines[1], new RegExp(`/releases/${previousCandidateSha}/`));
    assert.match(
      upLines[1],
      new RegExp(`CANDIDATE_API_IMAGE=.*@sha256:${"c".repeat(64)}`),
    );
    assert.doesNotMatch(dockerLog, /\b(pull|up|stop|rm)\b[^\n]*caddy/);
    assert.doesNotMatch(dockerLog, /\b(up|stop|rm)\b[^\n]*api-primary/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a partial new-canary up failure restores the previous candidate without changing state", () => {
  const previousCandidateSha = "3".repeat(40);
  const fixture = runDeployFixture({
    curlSucceeds: true,
    dockerUpFailures: 1,
    currentSha: "2".repeat(40),
    previousCandidateSha,
  });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${previousCandidateSha}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    const upLines = dockerLog.split(/\r?\n/).filter((line) => /\bup -d\b/.test(line));
    assert.equal(upLines.length, 2, dockerLog);
    assert.match(upLines[1], new RegExp(`/releases/${previousCandidateSha}/`));
    assert.doesNotMatch(dockerLog, /\b(pull|up|stop|rm)\b[^\n]*caddy/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a successful new canary atomically replaces previous candidate state without touching Caddy", () => {
  const previousCandidateSha = "3".repeat(40);
  const fixture = runDeployFixture({
    curlSucceeds: true,
    currentSha: "2".repeat(40),
    previousCandidateSha,
  });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    assert.equal(existsSync(join(fixture.root, "state", "previous")), false);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bup -d\b[^\n]*api-canary/);
    assert.doesNotMatch(dockerLog, /\b(pull|up|stop|rm)\b[^\n]*caddy/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a corrupt current state aborts before any Compose action", () => {
  const fixture = runDeployFixture({ curlSucceeds: true, corruptCurrent: true });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.match(fixture.result.stderr, /state_(sha|file)_invalid|release_sha_invalid/);
    assert.equal(existsSync(fixture.dockerLog), false);
    assert.equal(existsSync(join(fixture.root, "state", "candidate")), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a partial rollback up failure preserves state and restores current", () => {
  const fixture = runRollbackFixture();
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${"3".repeat(40)}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    const upLines = dockerLog.split(/\r?\n/).filter((line) => /\bup -d\b/.test(line));
    assert.equal(upLines.length, 2, dockerLog);
    assert.match(upLines[0], new RegExp(`/releases/${fixture.targetSha}/`));
    assert.match(upLines[1], new RegExp(`/releases/${"3".repeat(40)}/`));
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("canary rollback changes only api-canary and records the serving candidate", () => {
  const fixture = runRollbackFixture({ dockerUpFailures: 0 });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bup\b[^\n]*api-canary/);
    assert.doesNotMatch(dockerLog, /\b(up|stop|rm)\b[^\n]*api-primary/);
    assert.doesNotMatch(dockerLog, /\b(pull|up|stop|rm)\b[^\n]*caddy/);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.targetSha}\n`,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("production rollback applies the complete target primary and Caddy release", () => {
  const fixture = runRollbackFixture({ dockerUpFailures: 0, phase: "production" });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bpull\b[^\n]*api-primary caddy/);
    const upLines = dockerLog.split(/\r?\n/).filter((line) => /\bup -d\b/.test(line));
    assert.equal(upLines.length, 1, dockerLog);
    assert.match(
      upLines[0],
      new RegExp(`/releases/${fixture.targetSha}/.*api-primary caddy`),
    );
    assert.match(
      upLines[0],
      new RegExp(`CADDYFILE_PATH=.*/releases/${fixture.targetSha}/Caddyfile\\b`),
    );
    assert.match(upLines[0], new RegExp(`CADDY_IMAGE=.*@sha256:${"a".repeat(64)}`));
    assert.doesNotMatch(dockerLog, /\b(up|stop|rm)\b[^\n]*api-canary/);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.targetSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "previous"), "utf8"),
      `${fixture.currentSha}\n`,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("failed rollback current write restores runtime and the complete old state", () => {
  const fixture = runRollbackFixture({
    dockerUpFailures: 0,
    phase: "production",
    failStateMove: "current",
  });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.match(fixture.result.stderr, /atomic_write_failed/);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(existsSync(join(fixture.root, "state", "previous")), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${"3".repeat(40)}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, new RegExp(`/releases/${fixture.currentSha}/.*api-primary`));
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

for (const failure of [
  { name: "partial up", dockerUpFailures: 1, curlSucceeds: true },
  { name: "readiness", dockerUpFailures: 0, curlSucceeds: false },
]) {
  test(`production rollback ${failure.name} failure restores exact current primary and Caddy`, () => {
    const fixture = runRollbackFixture({
      phase: "production",
      dockerUpFailures: failure.dockerUpFailures,
      curlSucceeds: failure.curlSucceeds,
    });
    try {
      assert.notEqual(fixture.result.status, 0);
      assert.equal(
        readFileSync(join(fixture.root, "state", "current"), "utf8"),
        `${fixture.currentSha}\n`,
      );
      assert.equal(
        readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
        `${"3".repeat(40)}\n`,
      );
      const dockerLog = readFileSync(fixture.dockerLog, "utf8");
      const upLines = dockerLog.split(/\r?\n/).filter((line) => /\bup -d\b/.test(line));
      assert.equal(upLines.length, 3, dockerLog);
      assert.match(
        upLines[0],
        new RegExp(`/releases/${fixture.targetSha}/.*api-primary caddy`),
      );
      assert.match(
        upLines[1],
        new RegExp(`/releases/${fixture.currentSha}/.*api-primary`),
      );
      assert.match(
        upLines[0],
        new RegExp(`CADDYFILE_PATH=.*/releases/${fixture.targetSha}/Caddyfile\\b`),
      );
      assert.match(
        upLines[2],
        new RegExp(`CADDYFILE_PATH=.*/releases/${fixture.currentSha}/Caddyfile\\b`),
      );
      assert.match(upLines[0], new RegExp(`CADDY_IMAGE=.*@sha256:${"a".repeat(64)}`));
      assert.match(upLines[2], new RegExp(`CADDY_IMAGE=.*@sha256:${"b".repeat(64)}`));
    } finally {
      rmSync(fixture.fixture, { recursive: true, force: true });
    }
  });
}

test("later promotion prepare preloads and validates without replacing runtime or release state", () => {
  const fixture = runPromotionFixture();
  try {
    const prepare = fixture.run("--prepare");
    assert.equal(prepare.status, 0, prepare.stderr);
    assert.equal(existsSync(fixture.curlLog), false);
    const dockerLog = existsSync(fixture.dockerLog) ? readFileSync(fixture.dockerLog, "utf8") : "";
    assert.match(dockerLog, /\bpull\b[^\n]*api-primary caddy/);
    assert.match(dockerLog, /\brun\b[^\n]*--network none[^\n]*\bvalidate\b/);
    assert.doesNotMatch(
      dockerLog,
      /\bcompose\b[^\n]*\b(up|stop|rm)\b[^\n]*(api-primary|api-canary|caddy)/,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    assert.deepEqual(
      readdirSync(join(fixture.root, "state")).sort(),
      ["candidate", "current", "deploy.lock", "prepared", "promotion-backup.env"],
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("first promotion prepare preloads both images and prewarms only primary", () => {
  const fixture = runPromotionFixture({ current: false });
  try {
    const prepare = fixture.run("--prepare");
    assert.equal(prepare.status, 0, prepare.stderr);
    assert.equal(existsSync(fixture.curlLog), false);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bup -d\b[^\n]*--wait[^\n]*api-primary/);
    assert.match(dockerLog, /\bpull\b[^\n]*api-primary caddy/);
    assert.doesNotMatch(dockerLog, /\bcompose\b[^\n]*\b(up|stop|rm)\b[^\n]*caddy/);
    assert.doesNotMatch(dockerLog, /\b(up|stop|rm)\b[^\n]*api-canary/);
    assert.equal(existsSync(join(fixture.root, "state", "current")), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    assert.deepEqual(
      readdirSync(join(fixture.root, "state")).sort(),
      ["candidate", "deploy.lock", "prepared", "promotion-backup.env"],
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("failed first promotion prepare removes only prewarmed primary and preserves candidate", () => {
  const fixture = runPromotionFixture({ current: false, dockerUpFailures: 1 });
  try {
    const prepare = fixture.run("--prepare");
    assert.notEqual(prepare.status, 0);
    assert.match(readFileSync(fixture.dockerLog, "utf8"), /\bstop api-primary\b/);
    assert.match(readFileSync(fixture.dockerLog, "utf8"), /\brm -f api-primary\b/);
    assert.equal(existsSync(join(fixture.root, "state", "current")), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("promotion commit requires explicit DNS cutover confirmation before Docker", () => {
  const fixture = runPromotionFixture();
  try {
    const commit = fixture.run("--commit");
    assert.notEqual(commit.status, 0);
    assert.match(commit.stderr, /dns_cutover_confirmation_required/);
    assert.equal(existsSync(fixture.dockerLog), false);
    assert.equal(existsSync(fixture.curlLog), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("confirmed promotion applies production Caddy before polling primary and mutating state", () => {
  const fixture = runPromotionFixture();
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.equal(commit.status, 0, commit.stderr);
    const curlLog = readFileSync(fixture.curlLog, "utf8");
    assert.match(curlLog, /https:\/\/api\.danbammsg\.co\.kr\/ready/);
    assert.doesNotMatch(curlLog, /canary-api\.danbammsg\.co\.kr/);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bup\b[^\n]*api-primary/);
    assert.doesNotMatch(dockerLog, /\bup\b[^\n]*api-canary/);
    assert.doesNotMatch(dockerLog, /\bcompose\b[^\n]*\s+pull(?:\s|$)/);
    assert.match(dockerLog, /\bup\b[^\n]*--pull never[^\n]*api-primary/);
    assert.match(dockerLog, /\bup\b[^\n]*--pull never[^\n]*caddy/);
    assert.match(dockerLog, /\bup\b[^\n]*caddy/);
    const caddyUp = dockerLog.split(/\r?\n/).find((line) => /\bup -d\b[^\n]*caddy/.test(line));
    assert.ok(caddyUp, dockerLog);
    assert.match(
      caddyUp,
      new RegExp(`CADDYFILE_PATH=.*/releases/${fixture.candidateSha}/Caddyfile\\b`),
    );
    assert.doesNotMatch(caddyUp, /Caddyfile\.canary/);
    const events = readFileSync(fixture.eventLog, "utf8");
    assert.ok(
      events.indexOf("docker compose") < events.indexOf("curl "),
      events,
    );
    assert.ok(
      events.lastIndexOf(" caddy") < events.indexOf("curl "),
      events,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "previous"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    assert.equal(existsSync(join(fixture.root, "state", "candidate")), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("roll-forward floor rejects a legacy current release before promotion", () => {
  const fixture = runPromotionFixture({
    initialCurrentSha: legacyReleaseSha,
    currentLegacyFileSet: true,
  });
  try {
    const prepare = fixture.prepare();
    assert.notEqual(prepare.status, 0);
    assert.match(prepare.stderr, /manifest_unknown_key|release_schema_invalid/);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${legacyReleaseSha}\n`,
    );
    assert.equal(existsSync(join(fixture.root, "state", "previous")), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a failed promotion restores the exact current primary and Caddy release", () => {
  const fixture = runPromotionFixture({ dockerFailUpService: "caddy" });
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(commit.status, 0);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    const upLines = dockerLog.split(/\r?\n/).filter((line) => /\bup -d\b/.test(line));
    assert.equal(upLines.length, 4, dockerLog);
    assert.match(upLines[0], new RegExp(`/releases/${fixture.candidateSha}/.*api-primary`));
    assert.match(upLines[1], new RegExp(`/releases/${fixture.candidateSha}/.*caddy`));
    assert.match(
      upLines[2],
      new RegExp(`/releases/${fixture.currentSha}/.*api-primary`),
    );
    assert.match(
      upLines[3],
      new RegExp(`PRIMARY_API_IMAGE=.*@sha256:${"b".repeat(64)}`),
    );
    assert.match(
      readFileSync(fixture.curlLog, "utf8"),
      /--resolve api\.danbammsg\.co\.kr:443:127\.0\.0\.1/,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a failed first promotion leaves candidate and no current state", () => {
  const fixture = runPromotionFixture({ current: false, dockerFailUpService: "caddy" });
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(commit.status, 0);
    assert.equal(existsSync(join(fixture.root, "state", "current")), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bstop api-primary\b/);
    assert.match(dockerLog, /\brm -f api-primary\b/);
    assert.doesNotMatch(dockerLog, /\b(stop|rm)\b[^\n]*api-canary/);
    const caddyRestore = dockerLog.split(/\r?\n/).findLast(
      (line) => /\bup -d\b[^\n]*caddy/.test(line),
    );
    assert.ok(caddyRestore, dockerLog);
    assert.match(caddyRestore, /CADDYFILE_PATH=.*Caddyfile\.canary/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("mutated or symlinked immutable release files are rejected before promotion network access", (t) => {
  const mutated = runPromotionFixture();
  try {
    writeFileSync(
      join(mutated.root, "releases", mutated.candidateSha, "Caddyfile.canary"),
      "mutated\n",
    );
    const result = mutated.run("--prepare");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release_integrity/);
    assert.equal(existsSync(mutated.curlLog), false);
  } finally {
    rmSync(mutated.fixture, { recursive: true, force: true });
  }

  const linked = runPromotionFixture();
  const caddyPath = join(linked.root, "releases", linked.candidateSha, "Caddyfile");
  const targetPath = join(linked.fixture, "outside-Caddyfile");
  try {
    writeFileSync(targetPath, "outside\n");
    unlinkSync(caddyPath);
    try {
      symlinkSync(targetPath, caddyPath);
    } catch (error) {
      if (error?.code === "EPERM") {
        t.diagnostic("file symlink creation unavailable on this Windows host");
        return;
      }
      throw error;
    }
    const result = linked.run("--prepare");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release_(file|integrity).*invalid|release_symlink_forbidden/);
    assert.equal(existsSync(linked.curlLog), false);
  } finally {
    rmSync(linked.fixture, { recursive: true, force: true });
  }
});

test("a successful canary atomically records candidate while preserving current", () => {
  const fixture = runDeployFixture({ curlSucceeds: true });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.equal(readFileSync(join(fixture.root, "state", "candidate"), "utf8"), `${"1".repeat(40)}\n`);
    assert.equal(readFileSync(join(fixture.root, "state", "current"), "utf8"), `${"2".repeat(40)}\n`);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.doesNotMatch(dockerLog, /\b(pull|up|stop|rm)\b[^\n]*caddy/);
    assert.match(
      readFileSync(fixture.preflightLog, "utf8"),
      new RegExp(`/releases/${"1".repeat(40)}/Caddyfile\\b`),
    );
    assert.deepEqual(
      readdirSync(join(fixture.root, "state")).sort(),
      [
        "candidate",
        "current",
        "deploy.lock",
        "post-075-data-migrations",
        "post-075-schema-migrations",
      ],
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("atomic_write leaves a complete state file and no temporary siblings", () => {
  const bash = findBash();
  assert.ok(bash, "Bash is required for disposable deployment tests");
  const fixture = mkdtempSync(join(tmpdir(), "brand-pilot-state-"));
  const destination = join(fixture, "candidate");
  try {
    const result = spawnSync(bash, [
      "-c",
      'source "$1"; atomic_write "$2" "$3"$\'\\n\' 600',
      "_",
      bashPath("deploy/scripts/lib.sh"),
      bashPath(destination),
      "1".repeat(40),
    ], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(destination, "utf8"), `${"1".repeat(40)}\n`);
    assert.deepEqual(readdirSync(fixture), ["candidate"]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("manifest rejects identical canary and primary hosts after the floor probe and before Compose", () => {
  const fixture = runDeployFixture({
    overrides: {
      CANARY_HOST: "api.danbammsg.co.kr",
      PRIMARY_HOST: "api.danbammsg.co.kr",
    },
  });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.match(fixture.result.stderr, /manifest_hosts_must_differ/);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /ai-content-cutover-floor-probe\.mjs/);
    assert.doesNotMatch(dockerLog, /\bcompose\b|\bup -d\b/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("promotion commit requires a candidate-bound prepared proof after the floor probe and before Compose", () => {
  const fixture = runPromotionFixture();
  try {
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(commit.status, 0);
    assert.match(commit.stderr, /promotion_not_prepared/);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /ai-content-cutover-floor-probe\.mjs/);
    assert.doesNotMatch(dockerLog, /\bcompose\b|\bup -d\b/);
    assert.equal(existsSync(fixture.curlLog), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("promotion rejects a stale or tampered prepared proof after the floor probe and before Compose", () => {
  const fixture = runPromotionFixture();
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    writeFileSync(
      join(fixture.root, "state", "prepared"),
      `RELEASE_SHA=${fixture.candidateSha}\nPREPARATION_FINGERPRINT=${"0".repeat(64)}\n`,
      { mode: 0o600 },
    );
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(commit.status, 0);
    assert.match(commit.stderr, /promotion_prepared_proof_mismatch/);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /ai-content-cutover-floor-probe\.mjs/);
    assert.doesNotMatch(dockerLog, /\bcompose\b|\bup -d\b/);
    assert.equal(existsSync(fixture.curlLog), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("failed current state write restores runtime and leaves old state truthful", () => {
  const fixture = runPromotionFixture({ failStateMove: "current" });
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(commit.status, 0);
    assert.match(commit.stderr, /atomic_write_failed/);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    assert.equal(existsSync(join(fixture.root, "state", "previous")), false);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, new RegExp(`/releases/${fixture.currentSha}/.*api-primary`));
    assert.match(
      readFileSync(fixture.curlLog, "utf8"),
      /--resolve api\.danbammsg\.co\.kr:443:127\.0\.0\.1/,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("failed candidate cleanup restores the journaled pre-transition state", () => {
  const fixture = runPromotionFixture({ failStateRemove: "candidate" });
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(commit.status, 0);
    assert.match(commit.stderr, /candidate_state_cleanup_failed/);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(
      dockerLog,
      new RegExp(`/releases/${fixture.currentSha}/.*\\bup -d\\b`),
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("restoration failure is explicit and preserves the old state truth", () => {
  const fixture = runPromotionFixture({
    dockerFailUpService: "caddy",
    dockerFailUpTimes: 2,
  });
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.equal(commit.status, 70);
    assert.match(commit.stderr, /error=recovery_failed/);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("prepare preloads both images, validates production Caddy offline, and records proof", () => {
  const fixture = runPromotionFixture();
  try {
    const prepare = fixture.run("--prepare");
    assert.equal(prepare.status, 0, prepare.stderr);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /\bpull\b[^\n]*api-primary caddy/);
    assert.match(
      dockerLog,
      /\brun\b[^\n]*--pull never[^\n]*--network none[^\n]*Caddyfile[^\n]*\bvalidate\b/,
    );
    const proofPath = join(fixture.root, "state", "prepared");
    assert.equal(existsSync(proofPath), true);
    const proof = readFileSync(proofPath, "utf8");
    assert.match(proof, new RegExp(`^RELEASE_SHA=${fixture.candidateSha}$`, "m"));
    assert.match(proof, /^PREPARATION_FINGERPRINT=[a-f0-9]{64}$/m);
    assert.equal(existsSync(fixture.curlLog), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("recovery paths never suppress Docker restoration failures", () => {
  for (const path of [
    "deploy/scripts/deploy.sh",
    "deploy/scripts/promote.sh",
    "deploy/scripts/rollback.sh",
  ]) {
    assert.doesNotMatch(read(path), /docker[\s\S]{0,240}\|\|\s*true/, path);
  }
  const lib = read("deploy/scripts/lib.sh");
  assert.match(
    lib,
    /reconcile_transition_or_fail[\s\S]*error=recovery_failed[\s\S]*exit 70/,
  );
  assert.match(read("deploy/scripts/promote.sh"), /reconcile_transition_or_fail/);
  assert.match(read("deploy/scripts/rollback.sh"), /reconcile_transition_or_fail/);
});

test("compose topology rejects missing markers and ports on any non-Caddy service", () => {
  assert.throws(
    () => assertComposeTopology(`services:
  api-primary:
    image: api
  worker:
    image: worker
  caddy:
    image: caddy
`),
    /api-canary/,
  );
  assert.throws(
    () => assertComposeTopology(`services:
  api-primary:
    image: api
  api-canary:
    image: api
`),
    /caddy/,
  );
  assert.throws(
    () => assertComposeTopology(`services:
  api-primary:
    image: api
  api-canary:
    image: api
  worker:
    image: worker
    ports:
      - "9000:9000"
  caddy:
    image: caddy
    ports:
      - "80:80"
`),
    /worker.*ports/,
  );
  assert.throws(
    () => assertComposeTopology(`services:
  api-primary:
    image: api
  api-canary:
    image: api
  worker:
    image: worker
    ports: ["9000:9000"]
  caddy:
    image: caddy
`),
    /worker.*ports/,
  );
  assert.doesNotThrow(() => assertComposeTopology(`services:
  api-primary:
    image: api
    # ports:
  api-canary:
    image: api
    # ports:
  worker:
    image: worker
  caddy:
    image: caddy
    ports:
      - "80:80"
`));
});

test("Caddy log detection catches directives but not comments or longer words", () => {
  assert.equal(hasCaddyLogDirective("# log {\nlogger example\n"), false);
  assert.equal(hasCaddyLogDirective("log\n"), true);
  assert.equal(hasCaddyLogDirective("  log default\n"), true);
  assert.equal(hasCaddyLogDirective("log {\n  output stdout\n}\n"), true);
});

test("shell tracing detection covers common activation forms without matching comments", () => {
  for (const script of [
    "set -x\n",
    "set -x; echo unsafe\n",
    "set -eux\n",
    "set -eux || exit 1\n",
    "set -o xtrace\n",
    "set -o xtrace && echo unsafe\n",
    "#!/usr/bin/env -S bash -x\n",
    "#!/bin/bash --xtrace\n",
    "bash -x deploy.sh\n",
    "bash -x; echo unsafe\n",
    "bash --xtrace deploy.sh\n",
  ]) {
    assert.equal(hasShellTracing(script), true, script);
  }
  assert.equal(hasShellTracing("# set -x\necho safe # bash -x deploy.sh\nset +x\n"), false);
});

test("transition journal is durable and reconciled by every locked deployment entrypoint", () => {
  const lib = read("deploy/scripts/lib.sh");
  assert.match(lib, /transition\.journal/);
  assert.match(lib, /reconcile_transition/);
  assert.match(lib, /sync\s+-f/);
  for (const path of [
    "deploy/scripts/deploy.sh",
    "deploy/scripts/promote.sh",
    "deploy/scripts/rollback.sh",
    "deploy/scripts/preflight.sh",
  ]) {
    const script = read(path);
    const lockIndex = script.indexOf("flock -n 9");
    const reconcileIndex = script.indexOf("reconcile_transition");
    assert.ok(lockIndex >= 0, `${path} must acquire deploy.lock`);
    assert.ok(reconcileIndex > lockIndex, `${path} must reconcile after acquiring deploy.lock`);
  }
});

test("promotion rejects current and candidate host drift after the floor probe and before Compose or state mutation", () => {
  const fixture = runPromotionFixture({
    currentManifestOverrides: {
      CANARY_HOST: "old-canary-api.danbammsg.co.kr",
    },
  });
  try {
    const result = fixture.run("--prepare");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /promotion_hosts_mismatch/);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /ai-content-cutover-floor-probe\.mjs/);
    assert.doesNotMatch(dockerLog, /\bcompose\b|\bup -d\b/);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("an abrupt promotion exit after runtime activation is recovered on the next entrypoint", () => {
  const fixture = runPromotionFixture();
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    writeFileSync(fixture.dockerKillSwitch, "kill\n");
    const killed = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(killed.status, 0);
    assert.equal(existsSync(join(fixture.root, "state", "transition.journal")), true);

    const recovered = fixture.run("--prepare");
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(existsSync(join(fixture.root, "state", "transition.journal")), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, new RegExp(`/releases/${fixture.currentSha}/.*api-primary`));
    assert.match(dockerLog, new RegExp(`/releases/${fixture.currentSha}/.*caddy`));
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a partial promotion state write is rolled back from its durable journal", () => {
  const fixture = runPromotionFixture();
  const journal = join(fixture.root, "state", "transition.journal");
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    writeFileSync(
      journal,
      [
        "JOURNAL_SCHEMA=1",
        "OPERATION=promote",
        "DEPLOYMENT_PHASE=production",
        "TRANSITION_PHASE=state_mutation",
        `FROM_CURRENT=${fixture.currentSha}`,
        `FROM_CANDIDATE=${fixture.candidateSha}`,
        "FROM_PREVIOUS=NONE",
        "FROM_PREPARED=1",
        `TO_RELEASE=${fixture.candidateSha}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    chmodSync(journal, 0o600);
    writeFileSync(join(fixture.root, "state", "previous"), `${fixture.currentSha}\n`, { mode: 0o600 });
    writeFileSync(join(fixture.root, "state", "current"), `${fixture.candidateSha}\n`, { mode: 0o600 });

    const recovered = fixture.run("--prepare");
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(existsSync(journal), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(existsSync(join(fixture.root, "state", "previous")), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a first-promotion journal restores canary-only Caddy and removes primary", () => {
  const fixture = runPromotionFixture({ current: false });
  const journal = join(fixture.root, "state", "transition.journal");
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    writeFileSync(
      journal,
      [
        "JOURNAL_SCHEMA=1",
        "OPERATION=promote",
        "DEPLOYMENT_PHASE=production",
        "TRANSITION_PHASE=runtime_mutation",
        "FROM_CURRENT=NONE",
        `FROM_CANDIDATE=${fixture.candidateSha}`,
        "FROM_PREVIOUS=NONE",
        "FROM_PREPARED=1",
        `TO_RELEASE=${fixture.candidateSha}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    chmodSync(journal, 0o600);

    const recovered = fixture.run("--prepare");
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(existsSync(journal), false);
    assert.equal(existsSync(join(fixture.root, "state", "current")), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "candidate"), "utf8"),
      `${fixture.candidateSha}\n`,
    );
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /CADDYFILE_PATH=.*Caddyfile\.canary[^\n]*\bup -d\b[^\n]*caddy/);
    assert.match(dockerLog, /\bstop api-primary\b/);
    assert.match(dockerLog, /\brm -f api-primary\b/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("a production rollback journal restores the prior current runtime and exact state", () => {
  const fixture = runPromotionFixture();
  const journal = join(fixture.root, "state", "transition.journal");
  try {
    writeFileSync(
      journal,
      [
        "JOURNAL_SCHEMA=1",
        "OPERATION=rollback",
        "DEPLOYMENT_PHASE=production",
        "TRANSITION_PHASE=state_mutation",
        `FROM_CURRENT=${fixture.currentSha}`,
        `FROM_CANDIDATE=${fixture.candidateSha}`,
        "FROM_PREVIOUS=NONE",
        "FROM_PREPARED=0",
        `TO_RELEASE=${fixture.candidateSha}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    chmodSync(journal, 0o600);
    writeFileSync(join(fixture.root, "state", "current"), `${fixture.candidateSha}\n`, { mode: 0o600 });
    writeFileSync(join(fixture.root, "state", "previous"), `${fixture.currentSha}\n`, { mode: 0o600 });

    const recovered = fixture.run("--prepare");
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(existsSync(journal), false);
    assert.equal(
      readFileSync(join(fixture.root, "state", "current"), "utf8"),
      `${fixture.currentSha}\n`,
    );
    assert.equal(existsSync(join(fixture.root, "state", "previous")), false);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, new RegExp(`/releases/${fixture.currentSha}/.*api-primary`));
    assert.match(dockerLog, new RegExp(`/releases/${fixture.currentSha}/.*caddy`));
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("all locked deployment entrypoints convert reconciliation failure to status 70", () => {
  for (const path of [
    "deploy/scripts/deploy.sh",
    "deploy/scripts/promote.sh",
    "deploy/scripts/rollback.sh",
    "deploy/scripts/preflight.sh",
  ]) {
    const script = read(path);
    const lockIndex = script.indexOf("flock -n 9");
    const reconcileIndex = script.indexOf("reconcile_transition_or_fail");
    assert.ok(lockIndex >= 0, `${path} must acquire deploy.lock`);
    assert.ok(
      reconcileIndex > lockIndex,
      `${path} must fail closed through reconcile_transition_or_fail after locking`,
    );
  }
  assert.match(
    read("deploy/scripts/lib.sh"),
    /reconcile_transition_or_fail[\s\S]*error=recovery_failed[\s\S]*exit 70/,
  );
});

test("deploy rejects host drift against current or resident candidate before Docker", () => {
  const currentSha = "2".repeat(40);
  const previousCandidateSha = "3".repeat(40);
  const fixtures = [
    runDeployFixture({
      currentSha,
      overrides: { CANARY_HOST: "new-canary-api.danbammsg.co.kr" },
    }),
    runDeployFixture({
      previousCandidateSha,
      overrides: { PRIMARY_HOST: "new-api.danbammsg.co.kr" },
    }),
  ];
  try {
    for (const fixture of fixtures) {
      assert.notEqual(fixture.result.status, 0);
      assert.match(fixture.result.stderr, /release_hosts_mismatch/);
      const dockerLog = readFileSync(fixture.dockerLog, "utf8");
      assert.match(dockerLog, /ai-content-cutover-floor-probe\.mjs/);
      assert.doesNotMatch(dockerLog, /\bcompose\b|\bup -d\b/);
    }
  } finally {
    for (const fixture of fixtures) {
      rmSync(fixture.fixture, { recursive: true, force: true });
    }
  }
});

test("rollback rejects target host drift and empty production state before Docker", () => {
  const drift = runRollbackFixture({
    dockerUpFailures: 0,
    phase: "production",
    targetManifestOverrides: { PRIMARY_HOST: "old-api.danbammsg.co.kr" },
  });
  const empty = runRollbackFixture({
    dockerUpFailures: 0,
    phase: "production",
    current: false,
    candidate: false,
  });
  try {
    assert.notEqual(drift.result.status, 0);
    assert.match(drift.result.stderr, /release_hosts_mismatch/);
    const driftDockerLog = readFileSync(drift.dockerLog, "utf8");
    assert.match(driftDockerLog, /ai-content-cutover-floor-probe\.mjs/);
    assert.doesNotMatch(driftDockerLog, /\bcompose\b|\bup -d\b/);
    assert.notEqual(empty.result.status, 0);
    assert.match(empty.result.stderr, /ai_content_cutover_floor_query_failed/);
    assert.equal(existsSync(empty.dockerLog), false);
  } finally {
    rmSync(drift.fixture, { recursive: true, force: true });
    rmSync(empty.fixture, { recursive: true, force: true });
  }
});

test("repeated first promotion prepare preserves the exact old proof on abrupt failure", () => {
  const fixture = runPromotionFixture({
    current: false,
    dockerKillUpService: "api-primary",
  });
  try {
    const first = fixture.prepare();
    assert.equal(first.status, 0, first.stderr);
    const proofPath = join(fixture.root, "state", "prepared");
    const originalProof = readFileSync(proofPath);
    writeFileSync(fixture.dockerKillSwitch, "kill\n");

    const killed = fixture.run("--prepare");
    assert.notEqual(killed.status, 0);
    assert.equal(existsSync(proofPath), true);
    assert.deepEqual(readFileSync(proofPath), originalProof);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("successful canary rollback invalidates any candidate-bound prepared proof", () => {
  const fixture = runRollbackFixture({
    dockerUpFailures: 0,
    phase: "canary",
    preparedContents: "stale-candidate-proof\n",
  });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.equal(existsSync(join(fixture.root, "state", "prepared")), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("interrupted transition recovery clears rather than rebinds a stale prepared proof", () => {
  const fixture = runPromotionFixture();
  const staleCandidateSha = "3".repeat(40);
  try {
    const prepare = fixture.prepare();
    assert.equal(prepare.status, 0, prepare.stderr);
    seedRelease(
      fixture.root,
      staleCandidateSha,
      `${bashPath(fixture.root)}/shared/env/api.env`,
    );
    writeFileSync(
      join(fixture.root, "state", "candidate"),
      `${staleCandidateSha}\n`,
      { mode: 0o600 },
    );
    writeTransitionJournal(fixture.root, {
      operation: "rollback",
      deploymentPhase: "canary",
      fromCurrent: fixture.currentSha,
      fromCandidate: staleCandidateSha,
      fromPrepared: "1",
      toRelease: staleCandidateSha,
    });

    const commit = fixture.run("--commit", "--dns-cutover-confirmed");
    assert.notEqual(commit.status, 0);
    assert.match(commit.stderr, /promotion_backup_candidate_mismatch/);
    assert.equal(existsSync(join(fixture.root, "state", "prepared")), false);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});

test("reconciliation rejects journaled host drift after the floor probe and retains the journal before Compose", () => {
  const fixture = runPromotionFixture({
    currentManifestOverrides: {
      CANARY_HOST: "old-canary-api.danbammsg.co.kr",
    },
  });
  try {
    const journal = writeTransitionJournal(fixture.root, {
      operation: "promote",
      deploymentPhase: "production",
      fromCurrent: fixture.currentSha,
      fromCandidate: fixture.candidateSha,
      fromPrepared: "0",
      toRelease: fixture.candidateSha,
    });
    const result = fixture.run("--prepare");
    assert.equal(result.status, 70);
    assert.match(result.stderr, /error=recovery_failed/);
    assert.equal(existsSync(journal), true);
    const dockerLog = readFileSync(fixture.dockerLog, "utf8");
    assert.match(dockerLog, /ai-content-cutover-floor-probe\.mjs/);
    assert.doesNotMatch(dockerLog, /\bcompose\b|\bup -d\b/);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});
