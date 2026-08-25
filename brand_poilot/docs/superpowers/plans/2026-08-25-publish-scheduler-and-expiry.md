# Publish Scheduler and Expiry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute due publishing once per minute and expire unstarted targets at 23:59 KST through one observable, independently deployable scheduler service.

**Architecture:** A credential-minimal singleton worker calls the primary API internal cron endpoint and owns overlap prevention and heartbeat. The API owns all DB/provider decisions inside a global advisory lock and processes expiry before due publication. Canary remains non-mutating; scheduler activation is the final gated deployment step.

**Tech Stack:** Node.js 20, TypeScript, Fastify, PostgreSQL advisory locks, Docker Compose, Ubuntu deployment scripts, Vitest.

---

### Task 1: Make expiry and due selection one locked API transaction

**Files:**
- Create: `apps/api/src/publishDueRun.ts`
- Create: `apps/api/src/publishDueRun.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/types.ts`

- [ ] **Step 1: Write failing boundary tests** for 23:58:59.999, 23:59:00.000, all-unstarted, partially published, publishing, failed-after-start, and provider-result-unknown targets.

- [ ] **Step 2: Define the run result.**

```ts
export interface PublishDueRunResult {
  acquired: boolean;
  expiredTargets: number;
  expiredSlots: number;
  dueQueued: number;
  published: number;
  failed: number;
  resultUnknown: number;
}
```

- [ ] **Step 3: Acquire one PostgreSQL advisory lock** at run start. If not acquired, return `{ acquired: false, ...zeroCounts }` without selecting or mutating queues.

- [ ] **Step 4: Expire before due selection.** From `23:59:00.000` KST, cancel only targets that have not entered publishing/published; preserve started/completed targets; cancel slot/group only when no target started; store `reservation_expired_at_2359_kst`.

- [ ] **Step 5: Queue same-day delayed content immediately.** Before 23:59, when content becomes ready after its original time, preserve `scheduled_for` and set only the effective queue time to `now`.

- [ ] **Step 6: Run focused API tests and commit.**

```bash
git add apps/api/src/publishDueRun.ts apps/api/src/publishDueRun.test.ts apps/api/src/repository.ts apps/api/src/repository.test.ts apps/api/src/types.ts
git commit -m "feat(publish): lock due runs and expire reservations"
```

### Task 2: Expose dry-run and authenticated execution safely

**Files:**
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write failing route tests** for unauthenticated rejection, dry-run read-only counts, execution counts, lock contention, and no canary mutation.

- [ ] **Step 2: Keep `GET /internal/cron/publish-due` authenticated** and add `GET /internal/cron/publish-due/preview` with the same secret. Preview returns candidate IDs/counts and performs no UPDATE/provider call.

- [ ] **Step 3: Add instance-role fencing.** The primary API accepts execute; canary accepts preview but returns 409 `publish_scheduler_primary_only` for execute. Do not enable `LOCAL_SCHEDULER_ENABLED` in either API container.

- [ ] **Step 4: Run server tests and commit.**

```bash
git add apps/api/src/httpServer.ts apps/api/src/server.test.ts apps/api/src/index.ts
git commit -m "feat(publish): fence scheduler execution to primary"
```

### Task 3: Build the credential-minimal singleton scheduler

**Files:**
- Create: `workers/brand-pilot-publish-scheduler/package.json`
- Create: `workers/brand-pilot-publish-scheduler/tsconfig.json`
- Create: `workers/brand-pilot-publish-scheduler/src/index.ts`
- Create: `workers/brand-pilot-publish-scheduler/src/scheduler.ts`
- Create: `workers/brand-pilot-publish-scheduler/src/scheduler.test.ts`
- Create: `workers/brand-pilot-publish-scheduler/Dockerfile`

- [ ] **Step 1: Write failing worker tests** using a fake clock/fetch for 60-second ticks, no-overlap, timeout, 401, 5xx recovery, successful heartbeat, and graceful SIGTERM.

- [ ] **Step 2: Implement fixed configuration.** Read only `PRIMARY_API_INTERNAL_URL`, `CRON_SECRET_FILE`, `PUBLISH_TICK_MS=60000`, and `PUBLISH_TIMEOUT_MS`. Reject an HTTP URL whose hostname is not the Compose primary service name. Never accept DB, Meta, Blob, or Codex credentials.

- [ ] **Step 3: Implement non-overlapping ticks.** If one request is running, log `publish_tick_skipped_overlap`; otherwise call primary `/internal/cron/publish-due` with bearer secret. Log counts and status, never secret or response bodies containing customer text.

- [ ] **Step 4: Expose local health.** The container health command must fail when the last successful tick is older than 180 seconds after startup grace.

- [ ] **Step 5: Run worker tests/build and commit.**

Run: `npm test --workspace @brand-pilot/publish-scheduler`

Run: `npm run build --workspace @brand-pilot/publish-scheduler`

```bash
git add workers/brand-pilot-publish-scheduler
git commit -m "feat(publish): add singleton publish scheduler"
```

### Task 4: Add an independently pinned production service

**Files:**
- Modify: `deploy/compose.production.yml`
- Modify: `deploy/release.env.example`
- Create: `deploy/env/publish-scheduler.env.example`
- Modify: `../.github/workflows/publish-brand-pilot-server-images.yml`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `deploy/scripts/deploy.sh`
- Modify: `deploy/scripts/rollback.sh`
- Modify: `scripts/deployment-contract.test.mjs`

- [ ] **Step 1: Write failing deployment-contract tests** requiring immutable `PUBLISH_SCHEDULER_IMAGE@sha256`, exactly one replica, primary-only URL, read-only root filesystem, no DB/provider secret mounts, and independent deploy/rollback selection.

- [ ] **Step 2: Add `publish-scheduler-1` behind an explicit profile.** Keep it stopped during normal API/UI deployment. Mount only the existing root-owned cron secret read-only; use `cap_drop: ALL`, `no-new-privileges`, `read_only`, tmpfs `/tmp`, healthcheck, and restart unless-stopped.

- [ ] **Step 3: Build/publish its own immutable image.** Do not reuse or replace unrelated worker image keys and do not force manifest drift repair for disabled Wiki.

- [ ] **Step 4: Add targeted deploy/rollback commands** that change only `publish-scheduler-1`. A scheduler deploy must reject `latest`, a digest without revision label, or a release SHA different from current API primary.

- [ ] **Step 5: Run deployment tests and commit.**

Run: `npm run test:deployment`

```bash
git add deploy/compose.production.yml deploy/release.env.example deploy/env/publish-scheduler.env.example ../.github/workflows/publish-brand-pilot-server-images.yml deploy/scripts/preflight.sh deploy/scripts/deploy.sh deploy/scripts/rollback.sh scripts/deployment-contract.test.mjs
git commit -m "build(publish): deploy scheduler independently"
```

### Task 5: Document and test activation/rollback

**Files:**
- Modify: `docs/operations/UBUNTU_DEPLOYMENT.md`
- Create: `docs/operations/PUBLISH_SCHEDULER.md`
- Create: `scripts/publish-scheduler-smoke.mjs`
- Create: `scripts/publish-scheduler-smoke.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the smoke-test contract.** Preview must report counts without mutation; one authenticated execution must advance only known due candidates; the next execution must be idempotent; heartbeat must update; no canary call may occur.

- [ ] **Step 2: Document activation order:** baseline/digest check → preview → backup identifiers → start one scheduler → observe three successful ticks → verify target row/attempt/provider result → verify health/ready/restarts → update release state.

- [ ] **Step 3: Document stop conditions:** unexpected candidate, quota mismatch, provider result unknown, duplicate attempt, stale heartbeat, restart loop, canary mutation, or any unrelated service digest change.

- [ ] **Step 4: Document rollback:** stop only scheduler first, restore its previous digest/disabled profile, leave API/UI/DB and completed reservations intact, then diagnose.

- [ ] **Step 5: Run smoke contract tests and commit.**

Run: `node --test scripts/publish-scheduler-smoke.test.mjs`

```bash
git add docs/operations/UBUNTU_DEPLOYMENT.md docs/operations/PUBLISH_SCHEDULER.md scripts/publish-scheduler-smoke.mjs scripts/publish-scheduler-smoke.test.mjs package.json
git commit -m "docs(publish): add scheduler activation gates"
```

### Task 6: Release C full gate and production activation

**Files:**
- No new files; change source only if verification exposes a proven defect.

- [ ] **Step 1: Run impacted API, scheduler, deployment, and migration regression.**

Run: `npm test --workspace @brand-pilot/api -- publishDueRun.test.ts repository.test.ts server.test.ts publishCalendarAllocator.test.ts publishCalendarQuota.test.ts`

Run: `npm test --workspace @brand-pilot/publish-scheduler`

Run: `npm run test:deployment`

Run: `npm run test:migrations`

- [ ] **Step 2: Create the Release C PR.** Diff may contain API publishing transaction, new scheduler worker, its exact Compose/release keys, deployment contract, and scheduler docs only. No UI, migration, Caddy, DM, Wiki, or unrelated worker change is allowed.

- [ ] **Step 3: Deploy API canary with execution fenced.** Verify `/health`, `/ready`, preview, revision, restart count, and no publication mutation.

- [ ] **Step 4: Promote API primary.** Re-run preview and compare exact candidate IDs/counts with DB read-only evidence and current weekly quota. If any candidate is unexpected, stop without starting scheduler.

- [ ] **Step 5: Deploy scheduler digest but keep profile stopped.** Verify image revision and no unrelated service digest changed.

- [ ] **Step 6: Start exactly one scheduler.** Observe three successful ticks, heartbeat age, zero overlap, provider attempts, recent errors, and API restart count.

- [ ] **Step 7: Verify customer app.** Due work leaves `게시 예정`, same-day waiting work is orange `게시 지연`, successful work is green, expired unstarted work becomes gray with the 23:59 reason.

- [ ] **Step 8: Update `state/current` and `PRODUCTION_RELEASE_SHA`** only after scheduler and customer checks pass. Failure rolls back scheduler first and only the API if its transaction is proven defective.
