# Publish Calendar Safe Operating Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Every behavior change follows red-green-refactor.

**Goal:** Integrate the approved publish calendar into production source SHA `d9827a28f1ea66a4bb9b731466645f327606ca6b`, preserve the operating publish queue, and release the backend/database before the customer UI.

**Architecture:** `publish_calendar_slots` is the reservation ledger, while the existing `/internal/cron/publish-due` route remains the only scheduled/cron production queue trigger. Calendar allocation is a separate authenticated cron route. The calendar schema is additive migration `079_publish_calendar_runtime.sql`, after operating migrations 077 and 078. The first release contains schema/API/runtime only. The second release contains UI and sidebar changes after the API is live and verified.

**Tech Stack:** PostgreSQL, PGlite, Fastify, TypeScript, React, Vitest, Node test runner, GitHub Actions, Docker Compose, Vercel

---

### Task 1: Freeze the operating baseline and integration contract

**Files:**
- Create: `docs/superpowers/specs/2026-08-14-publish-calendar-operating-integration-design.md`
- Test: `scripts/migrationRunner.test.mjs`
- Test: `scripts/deployment-contract.test.mjs`
- Test: `scripts/repository-contract.test.mjs`

- [ ] Record exact operating SHA, preserved publish-due route, production-disabled local scheduler, backend-first release order, and rollback boundary.
- [ ] Add failing tests that require migration order 077 suggestions, 078 FAQ matching, 079 publish calendar.
- [ ] Add a contract test proving the operating `GET /internal/cron/publish-due` remains registered and no production local runner is enabled.
- [ ] Run the focused tests and capture the expected failures before integration code.

### Task 2: Integrate the calendar schema and migration runner as migration 079

**Files:**
- Create: `db/migrations/079_publish_calendar_runtime.sql`
- Modify: `scripts/migrationRunner.mjs`
- Modify: `scripts/migrate.mjs`
- Modify: `scripts/migrationRunner.test.mjs`
- Modify: `scripts/content-suggestion-schema-migration.test.mjs`
- Modify: `scripts/post075DataMigration.postgres.integration.test.mjs`
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `deploy/scripts/deploy.sh`
- Test: `apps/api/src/publishCalendarMigration.pglite.test.ts`

- [ ] Preserve the operating 078 validation logic, then append calendar migration 079 and its checksum.
- [ ] Keep every schema change additive and compatible with the operating API image.
- [ ] Update deployment evidence to name and hash migration 079 without deleting evidence for prior migrations.
- [ ] Run migration, deployment-contract, and PGlite tests until green.

### Task 3: Integrate calendar API, subscription quota, and queue linkage

**Files:**
- Create/Modify: `apps/api/src/publishCalendar*.ts`
- Modify: `apps/api/src/aiContentPublish.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/types.ts`
- Test: corresponding API test files

- [ ] Preserve current asynchronous direct Reel/card-news publishing and the existing publish-due route.
- [ ] Link suggestions to the existing generation flow and prepare publish queues automatically after generation output is ready.
- [ ] Enforce active subscription, weekly generation/publish limits, channel state, due time, slot channel, and content format at mutation and execution boundaries.
- [ ] Keep automatic publishing settings disabled by default and retain reservations when generation is not ready.
- [ ] Remove unused duplicate queue entry points without removing operating recovery actions.
- [ ] Run focused API tests after each behavior change, then the complete API suite and build.

### Task 4: Restrict the first calendar release to implemented Instagram delivery

**Files:**
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/httpServer.ts`
- Test: `apps/api/src/publishCalendarRepository.test.ts`
- Test: `apps/api/src/server.test.ts`

- [ ] Add failing tests for rejecting Threads, X, LinkedIn, YouTube, and TikTok calendar settings and manual slots.
- [ ] Accept only connected, enabled Instagram channels until their adapters exist.
- [ ] Verify current non-calendar channel features remain unchanged.

### Task 5: Build and review backend-only release A

**Files:**
- Modify: operational docs and release notes only as required

- [ ] Keep all customer UI calendar files out of release A.
- [ ] Run contract, migration, API, typecheck, build, diff-check, and release-impact verification from a clean tree.
- [ ] Perform spec-compliance review and code-quality review on the exact release commit.
- [ ] Push `codex/publish-calendar-backend-safe` and create a PR against production `main`.
- [ ] Wait for CI and verify the PR commit is a descendant of operating SHA `d9827a...`.

### Task 6: Apply production migration and deploy backend safely

**Files:**
- No source changes during deployment

- [ ] Verify current production main SHA, deployed API digest, worker digests, restart counts, and dirty/hotfix state.
- [ ] Capture provider database backup metadata and preserve the previous API digest for rollback.
- [ ] Verify every active brand has a valid plan catalog row and active subscription, or prove there are no active brands.
- [ ] Apply only migration 079 with migration evidence and re-run schema verification.
- [ ] Deploy only the API image by immutable digest to canary, verify health/ready and calendar endpoints, then promote.
- [ ] Leave workers and the operating publish-due trigger unchanged.

### Task 7: Integrate and release customer UI B

**Files:**
- Create/Modify: `apps/customer-ui/src/components/publish/*`
- Create/Modify: `apps/customer-ui/src/features/publishing/*`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: sidebar usage files and tests
- Modify: `apps/customer-ui/src/styles/publish-calendar.css`

- [ ] Add the calendar/list switch while preserving all operating queue actions, filters, deep links, and partial-failure behavior.
- [ ] Show selected slot details in the right panel and retain reservations when generation/publish is unavailable.
- [ ] Limit settings and manual slots to connected Instagram channels.
- [ ] Show `게시 N건 남음`, reservation/additional availability, and generation availability in the existing sidebar usage area without another provider or progress bar.
- [ ] Run the complete customer UI suite, production build, responsive browser checks, accessibility checks, and an operating-list regression pass.
- [ ] Create and merge release B only after release A production verification is green.

### Task 8: Register allocation schedule and verify production end to end

**Files:**
- Modify deployment configuration only if an existing managed scheduler contract exists

- [ ] Register the authenticated daily allocation caller after the existing recommendation job, without modifying `/internal/cron/publish-due`.
- [ ] Verify allocator idempotency, automatic settings default-off behavior, and an enabled test brand's suggestion-to-slot flow.
- [ ] Verify health, ready, API/UI revisions, immutable digests, restart counts, queue heartbeat, recent error logs, and Vercel production status.
- [ ] Save deployment evidence and rollback instructions. Report completion only after the live containers and public URL are verified.
