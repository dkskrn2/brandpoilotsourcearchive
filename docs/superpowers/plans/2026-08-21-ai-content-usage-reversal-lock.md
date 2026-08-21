# AI Content Usage Reversal Lock Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seal and deploy a forward migration that lets the least-privilege application role insert valid AI-content usage reversals without ledger `UPDATE` privilege.

**Architecture:** Replace only the reversal identity trigger function in migration 084, preserving all identity validation while using an ordinary immutable-row lookup. Extend the existing ordered post-075 migration runner and deployment evidence, then verify the real repository failure paths and a direct reversal race on PostgreSQL 16 as `content_application`.

**Tech Stack:** PostgreSQL 16, PL/pgSQL, Node.js test runner, Vitest, Testcontainers, Bash deployment scripts

---

### Task 1: Pin the migration contract with failing tests

**Files:**
- Create: `brand_poilot/scripts/ai-content-usage-reversal-identity.test.mjs`
- Modify: `brand_poilot/scripts/migrationRunner.test.mjs`
- Modify: `brand_poilot/scripts/content-suggestion-schema-migration.test.mjs`

- [x] **Step 1: Write the failing migration contract test**

Require migration `084_ai_content_usage_reversal_identity_invoker.sql`, assert its replacement function retains every reservation identity comparison, remains security-invoker, and contains no `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, or `FOR KEY SHARE` clause.

- [x] **Step 2: Run the test to verify RED**

Run: `node --test scripts/ai-content-usage-reversal-identity.test.mjs`

Expected: FAIL because migration 084 is absent.

- [x] **Step 3: Extend ordered-manifest tests to expect 084**

Update the migration manifest tests so 084 must follow 083 and is the latest post-075 schema migration.

- [x] **Step 4: Run the focused tests to verify RED**

Run: `node --test scripts/ai-content-usage-reversal-identity.test.mjs scripts/migrationRunner.test.mjs scripts/content-suggestion-schema-migration.test.mjs`

Expected: FAIL only on missing 084/registry/checksum expectations.

### Task 2: Add the minimal forward migration and sealed registry entry

**Files:**
- Create: `brand_poilot/db/migrations/084_ai_content_usage_reversal_identity_invoker.sql`
- Modify: `brand_poilot/scripts/migrationRunner.mjs`

- [x] **Step 1: Create migration 084**

Use `CREATE OR REPLACE FUNCTION` inside one transaction, preserve the exact 075 validation body and search path, and remove only the row-locking clause.

- [x] **Step 2: Calculate and pin its SHA-256**

Add 084 to `fullSourceMigrationIds`, `post075SchemaMigrationIds`, and `post075SchemaMigrationChecksums`.

- [x] **Step 3: Run focused migration tests to verify GREEN**

Run: `node --test scripts/ai-content-usage-reversal-identity.test.mjs scripts/migrationRunner.test.mjs scripts/content-suggestion-schema-migration.test.mjs`

Expected: all selected tests pass.

### Task 3: Pin deployment and release impact to 084

**Files:**
- Modify: `brand_poilot/deploy/scripts/deploy.sh`
- Modify: `brand_poilot/scripts/deployment-contract.test.mjs`
- Modify: `brand_poilot/scripts/repository-contract.test.mjs`
- Modify: `brand_poilot/scripts/release-impact.mjs`
- Modify: `brand_poilot/scripts/release-impact.test.mjs`

- [x] **Step 1: Write deployment expectations for 084**

Require the API image, migration gate, evidence fixture, ordered registry, and migration-scoped release profile to recognize 084.

- [x] **Step 2: Run focused tests to verify RED**

Run: `node --test scripts/deployment-contract.test.mjs scripts/repository-contract.test.mjs scripts/release-impact.test.mjs`

Expected: FAIL because the runner/deploy pin still ends at 083.

- [x] **Step 3: Update the deployment pin and exact release classifier**

Point the post-075 schema gate to 084 and classify only the new migration plus its exact verification/tooling paths. Do not enable API-only deployment for a migration release.

- [x] **Step 4: Run focused tests to verify GREEN**

Run: `node --test scripts/deployment-contract.test.mjs scripts/repository-contract.test.mjs scripts/release-impact.test.mjs`

Expected: all selected tests pass and `migrationChanged=true` remains fail-closed for automatic production deployment.

### Task 4: Verify real application-role repository paths and concurrency

**Files:**
- Create: `brand_poilot/scripts/ai-content-usage-reversal-identity.test.mjs`

- [x] **Step 1: Apply migration 084 in a PostgreSQL 16 application-role harness**

Apply the production migration as provider `postgres` after the 075 role/bootstrap setup, then reconnect through the existing restricted `content_application` pool.

- [x] **Step 2: Assert the exact application ACL**

Assert `SELECT=true`, `INSERT=true`, `UPDATE=false`, and `DELETE=false` on `ai_content_usage_ledger` before repository failure-path tests run.

- [x] **Step 3: Add a direct concurrent reversal race**

Create one valid reservation, submit two identical-scope reversal inserts from separate application sessions, and assert one stored reversal plus one `23505` loser without any `42501` permission error.

- [x] **Step 4: Run PostgreSQL integration**

Run: `$env:RUN_AI_CONTENT_REVERSAL_POSTGRES='true'; node --test scripts/ai-content-usage-reversal-identity.test.mjs`

Expected: the original locking function fails with `42501`, migration 084 restores a valid reversal without granting `UPDATE`, and the direct race stores one reversal while the loser receives `23505`.

The existing V3 PostgreSQL integration harness could not reach its test cases because its historical 075 bootstrap fails first on the current provider-membership catalog. The dedicated harness uses the production 084 file and the exact application ACL, so the permission and concurrency boundary is still exercised without weakening that unrelated bootstrap failure.

### Task 5: Final verification and release handoff

**Files:**
- Verify all changed files only

- [x] **Step 1: Run complete focused verification**

Run migration, deployment, release-impact, repository-contract, and PostgreSQL integration suites; run `git diff --check`.

- [x] **Step 2: Inspect protected scope**

Confirm no API runtime, worker, UI, legacy migration, data backfill, or ACL grant changed.

- [ ] **Step 3: Prepare the migration-only release**

Record the new migration checksum, current production SHA/digests, rollback images, and deployment evidence path. Keep Card/Reel synchronization out of this release.
