# Predeploy Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the confirmed DB/API/CI deployment blockers without changing the approved design-style, preset, or Proposal V5 product behavior.

**Architecture:** Keep migration 093 expand-only and preserve the legacy preset junction as read-only rollout data. Normalize only recognized historical Brand Rules V1 rows in memory, keep all new writes V2, align stale tests with the approved V2 write contract, and make the existing Brand Intelligence style-analysis lane fail closed on stalled downloads.

**Tech Stack:** PostgreSQL 16, TypeScript, Fastify, Vitest, Node test runner, GitHub Actions.

---

## Decision Coverage

| Current decision | Authoritative source | Plan disposition | Verification |
|---|---|---|---|
| Legacy preset references remain read-only during rolling deploy | Approved design-style plan lines 152 and 177; predeploy review | Task 1 | ACL contract plus PostgreSQL application-role test |
| Historical V1 Brand Rules are read-compatible without rewriting stored rows; new writes remain V2 | Approved plan line 154 and user approval | Task 2 | Existing failing historical-rule repository tests plus stored-version assertion |
| New manual visual selections and onboarding authorities write V2 only | Approved design/spec and current implementation | Task 3 | API boundary and Proposal service tests use V2; frozen V1 read fixtures remain |
| Removed Brand Rules design images must not reappear | User-approved design-style separation | Task 3 | Snapshot tests assert no Brand Rules style-image dependency |
| Required CI must exercise the changed DB/API contracts | Predeploy review and operations guide | Task 4 | Deployment contract asserts exact new commands |
| Style downloads cannot hold the shared worker lane indefinitely | Verified implementation necessity from `styleAnalysisWorker.ts` | Task 5 | stalled-fetch timeout and cleanup test |
| No new API version, table, service, compatibility write path, or production deployment | User-approved scope | Excluded | source diff and release-impact checks |

### Superseded or Excluded

- Do not restore V1 customer writes; old UI must refresh during rollout.
- Do not restore `brandRules.designRules` as a generation source.
- Do not add migration 095: migration 093 is not deployed and is corrected before release.
- Do not deploy until all deterministic failures and external CI billing blockage are cleared.

## File Structure

- `db/migrations/093_design_style_analysis_visual_presets.sql`: convert the retained legacy junction to SELECT-only application access.
- `scripts/ai-content-database-roles.mjs` and `scripts/migrationRunner.mjs`: keep bootstrap and post-migration ACL expectations identical.
- `apps/api/src/brandCoreRepository.ts`: historical V1 in-memory normalization only.
- Existing API and script tests: replace stale removed-write expectations while retaining V1 frozen-read coverage.
- `.github/workflows/publish-brand-pilot-server-images.yml`: run the new contract and PostgreSQL tests.
- `workers/brand-pilot-brand-intelligence-worker/src/styleAnalysisWorker.ts`: bounded download and non-overlapping heartbeat.

### Task 1: Repair legacy preset ACL consistency

**Files:**
- Modify: `scripts/manual-visual-assets-contract.test.mjs`
- Modify: `db/migrations/093_design_style_analysis_visual_presets.sql`
- Modify: `scripts/ai-content-database-roles.mjs`
- Modify: `scripts/migrationRunner.mjs`

- [x] **Step 1: Tighten the failing ACL test**

Assert that the application catalog contains `brand_style_preset_references` with exactly `SELECT`, and migration 093 revokes write privileges before granting SELECT.

- [x] **Step 2: Run RED**

Run: `node --test scripts/manual-visual-assets-contract.test.mjs`

Expected: FAIL because the relation is absent and the migration leaves legacy CRUD access.

- [x] **Step 3: Implement the minimum ACL alignment**

Add `applicationRelationGrant("brand_style_preset_references", ["SELECT"])`, make migration 093 revoke application writes and grant SELECT, and update the post-migration verifier to require SELECT=true and INSERT/UPDATE/DELETE=false.

- [x] **Step 4: Run GREEN**

Run the manual visual contract, database-role tests, migration runner tests, and the real PostgreSQL application-role integration test.

### Task 2: Restore historical Brand Rules read compatibility

**Files:**
- Modify: `apps/api/src/brandCoreRepository.ts`
- Test: `apps/api/src/brandCoreRepository.test.ts`

- [x] **Step 1: Use the existing deterministic failures as RED**

Run the two tests for an invalid active legacy rule set and missing `referenceImages`.

Expected: both FAIL with `brand_rules_content_v1_invalid`.

- [x] **Step 2: Implement recognized-V1 in-memory normalization**

At `mapHistoricalRule`, reject unknown versions but normalize known V1 legacy fields with existing profile defaults, convert the result to V2 in memory, and never update `brand_rule_sets`.

- [x] **Step 3: Run GREEN**

Run `brandCoreRepository.test.ts`, `brandCoreContracts.test.ts`, and `approvedBrandContextProvider.test.ts` with one worker.

### Task 3: Align stale tests with approved V2 writes

**Files:**
- Modify: `apps/api/src/server.aiContentV2Customer.test.ts`
- Modify: `apps/api/src/aiContentProposalV2Service.test.ts`
- Modify: `apps/api/src/aiContentSnapshotRepository.test.ts`
- Modify: `scripts/manual-visual-assets-contract.test.mjs`

- [x] **Step 1: Preserve the observed RED output**

Re-run the six deterministic failures and confirm each fails only because it asserts removed V1-write or Brand Rules design-image behavior.

- [x] **Step 2: Update fixtures and expectations**

Use `manual-visual-selection.v2` for new PUTs, `brand-rules.v2` for onboarding authority, expect Brand Rules style image loading to be empty, and make migration-chain tests locate migration 083 by ID instead of assuming it is the final migration.

- [x] **Step 3: Run GREEN**

Run all four files serially and retain existing frozen V1 read tests unchanged.

### Task 4: Close CI coverage gaps

**Files:**
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `.github/workflows/publish-brand-pilot-server-images.yml`

- [x] **Step 1: Write RED deployment-contract assertions**

Require CI commands for `manual-visual-assets-contract.test.mjs`, migration 094 PostgreSQL integration, design-style contracts/repository/server tests, and style-analysis worker tests.

- [x] **Step 2: Run RED**

Run: `npm run test:deployment`

Expected: FAIL because the workflow omits those commands.

- [x] **Step 3: Add exact CI commands**

Add the missing tests to the existing migration/API/Brand Intelligence verification sections without creating a new service or workflow.

- [x] **Step 4: Run the changed deployment assertion GREEN**

Run the changed deployment assertion plus release-impact and incremental-CI contract tests. The complete Windows `test:deployment` suite was stopped after more than 15 minutes while it was still progressing through isolated Git Bash deployment simulations; the required Linux CI check remains the authoritative full-suite gate.

### Task 5: Bound style image downloads

**Files:**
- Modify: `workers/brand-pilot-brand-intelligence-worker/src/styleAnalysisWorker.test.ts`
- Modify: `workers/brand-pilot-brand-intelligence-worker/src/styleAnalysisWorker.ts`

- [x] **Step 1: Write RED worker tests**

Add one test where fetch never resolves and must abort within a configurable download timeout, plus one test proving heartbeat requests do not overlap.

- [x] **Step 2: Run RED**

Run the style-analysis worker test file and confirm timeout/overlap assertions fail.

- [x] **Step 3: Implement bounded download and heartbeat**

Combine the job signal with `AbortSignal.timeout(downloadTimeoutMs)` for fetch and body reading, and add an in-flight guard matching the existing brand-analysis worker pattern.

- [x] **Step 4: Run GREEN**

Run the style-analysis tests and the full Brand Intelligence Worker suite serially.

### Task 6: Final predeploy verification

**Files:**
- Verification only.

- [x] Run content contracts, focused API and customer UI tests, affected worker tests, root and migration contracts, PostgreSQL application-role tests, builds, and `git diff --check`.
- [x] Confirm the worktree contains only approved changes and no migration 095, new API version, new worker service, or production mutation.
- [x] Recheck PR status; do not deploy while GitHub Actions billing prevents required CI from running.

PR #225 points at remediation commit `9981b787`, but the required `impact` job was not started because GitHub reported failed account payments or an exhausted spending limit. `verify`, `publish`, and `deploy` were therefore skipped.
