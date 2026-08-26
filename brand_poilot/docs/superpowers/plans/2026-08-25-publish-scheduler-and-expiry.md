# Publish Scheduler and Expiry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute due publishing once per minute and expire unstarted targets at 23:59 KST through one observable, independently deployable scheduler service.

**Architecture:** A dependency-free, credential-minimal singleton worker calls primary-only internal API endpoints and owns overlap prevention and heartbeat. The API performs expiry and queue claims in a short locked DB transaction, commits, then performs bounded provider calls outside the transaction. The worker also invokes the existing idempotent calendar allocator on an explicit catch-up cadence after daily recommendations. Canary remains non-mutating; scheduler activation is the final gated deployment step.

**Tech Stack:** Node.js 20 ESM for the dependency-free scheduler, TypeScript/Fastify/Vitest for the API, PostgreSQL advisory locks, Docker Compose, Ubuntu deployment scripts, Node test runner.

---

### Task 1: Make expiry and due claims one short locked API transaction

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

- [ ] **Step 3: Acquire one transaction-level PostgreSQL advisory lock** only for expiry, due selection, and atomic queue claims. If not acquired, return `{ acquired: false, ...zeroCounts }` without selecting or mutating queues. Commit before any provider HTTP call; never keep a DB transaction open while waiting for Meta.

- [ ] **Step 4: Expire before due selection.** From `23:59:00.000` KST, cancel only targets that have not entered publishing/published; preserve started/completed targets; cancel slot/group only when no target started; store `reservation_expired_at_2359_kst`.

- [ ] **Step 5: Queue same-day delayed content immediately.** Before 23:59, when content becomes ready after its original time, preserve the slot's original scheduled time and atomically claim a bounded fair batch. Keep original/effective timestamps in distinct fields or projections; do not overwrite history merely to make a queue row due.

- [ ] **Step 6: Dispatch outside the transaction with explicit bounds.** Process at most the configured batch size with configured concurrency, preserve brand fairness, and rely on the existing `publishQueueItemInternal` claim/result-recovery contract. Test two same-time reservations, ten brands, slow provider polling, and a second tick while the first batch is active.

- [ ] **Step 7: Run focused API tests and commit.**

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

- [ ] **Step 2: Replace mutation-by-GET with authenticated `POST /internal/cron/publish-due`** and add authenticated `GET /internal/cron/publish-due/preview`. Preview returns allocation, expiry, due candidate IDs/counts and performs no UPDATE/provider call. Remove the old GET mutation only after confirming no operating caller exists.

- [ ] **Step 3: Add instance-role fencing.** Add `API_INSTANCE_ROLE=primary` and `API_INSTANCE_ROLE=canary` explicitly to the corresponding Compose services and runtime config. Primary accepts execute; canary accepts preview but returns 409 `publish_scheduler_primary_only` for execute. Do not infer the role from hostname and do not enable `LOCAL_SCHEDULER_ENABLED` in either API container.

- [ ] **Step 4: Keep allocation separately observable.** Preserve authenticated `POST /internal/cron/publish-calendar-allocate`; preview reports its candidate counts. Route tests must prove canary rejects both allocation and due mutation while allowing both previews.

- [ ] **Step 5: Run server tests and commit.**

```bash
git add apps/api/src/httpServer.ts apps/api/src/server.test.ts apps/api/src/index.ts
git commit -m "feat(publish): fence scheduler execution to primary"
```

### Task 3: Build the credential-minimal singleton scheduler

**Files:**
- Create: `workers/brand-pilot-publish-scheduler/src/index.mjs`
- Create: `workers/brand-pilot-publish-scheduler/src/scheduler.mjs`
- Create: `workers/brand-pilot-publish-scheduler/src/scheduler.test.mjs`
- Create: `workers/brand-pilot-publish-scheduler/src/healthcheck.mjs`
- Create: `workers/brand-pilot-publish-scheduler/Dockerfile`

- [ ] **Step 1: Write failing worker tests** using Node's built-in test runner and a fake clock/fetch for 60-second due ticks, allocation cadence/catch-up, no-overlap, timeout, 401, 409 primary fencing, 5xx recovery, successful heartbeat, and graceful SIGTERM.

- [ ] **Step 2: Implement fixed configuration.** Use dependency-free Node ESM so adding the worker does not change the root workspace lockfile and trigger unrelated image rebuilds. Read only `PRIMARY_API_INTERNAL_URL`, `CRON_SECRET_FILE`, `PUBLISH_TICK_MS=60000`, `PUBLISH_TIMEOUT_MS`, and the fixed allocation schedule. Reject an HTTP URL whose hostname is not the Compose primary service name. Never accept DB, Meta, Blob, or Codex credentials.

- [ ] **Step 3: Implement non-overlapping ticks.** If one due request is running, log `publish_tick_skipped_overlap`; otherwise call primary `POST /internal/cron/publish-due` with bearer secret. Invoke `POST /internal/cron/publish-calendar-allocate` on the documented post-recommendation KST cadence and once as catch-up after a missed window; both operations are idempotent. Log counts/status only, never secret or response bodies containing customer text.

- [ ] **Step 4: Expose local health.** Atomically write a heartbeat JSON file in `/tmp` after each successful due tick. The healthcheck validates schema, timestamp, and an in-flight allowance derived from the configured provider timeout; it must not restart a healthy worker merely because one bounded provider batch legitimately takes longer than 180 seconds.

- [ ] **Step 5: Run worker tests/build and commit.**

Run: `node --test workers/brand-pilot-publish-scheduler/src/scheduler.test.mjs`

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
- Modify: `scripts/release-impact.mjs`
- Modify: `scripts/release-impact.test.mjs`
- Modify: `scripts/assemble-release-manifest.mjs`
- Modify: `scripts/assemble-release-manifest.test.mjs`
- Modify: `scripts/incremental-cicd-contract.test.mjs`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `deploy/scripts/deploy.sh`
- Modify: `deploy/scripts/rollback.sh`
- Modify: `deploy/scripts/lib.sh`
- Modify: `scripts/deployment-contract.test.mjs`

- [ ] **Step 1: Write failing deployment-contract tests** requiring immutable `PUBLISH_SCHEDULER_IMAGE@sha256`, exactly one replica, explicit primary role/URL, read-only root filesystem, no DB/provider secret mounts, and independent deploy/rollback selection. Release-impact tests must prove API/UI/scheduler changes preserve every unrelated worker digest.

- [ ] **Step 2: Add `publish-scheduler-1` behind an explicit profile.** Keep it stopped during normal API/UI deployment. The current repository has `CRON_SECRET` only in the API env file, not a scheduler-only secret file. Add a preflighted `/opt/brand-pilot/shared/secrets/cron-secret` provisioning step with mode 0600 and mount only that file read-only. Use `cap_drop: ALL`, `no-new-privileges`, `read_only`, tmpfs `/tmp`, healthcheck, and restart unless-stopped.

- [ ] **Step 3: Build/publish its own immutable image.** Add `publishScheduler` to the release-impact component set and `PUBLISH_SCHEDULER_IMAGE` to the manifest assembler/preservation contracts. Do not reuse or replace unrelated worker image keys, do not let the new worker path or lockfile classify as all-server impact, and do not force manifest drift repair for disabled Wiki.

- [ ] **Step 4: Add targeted deploy/rollback commands** that change only `publish-scheduler-1`. A scheduler deploy must reject `latest`, a digest without revision label, or a release SHA different from current API primary.

- [ ] **Step 5: Run deployment tests and commit.**

Run: `npm run test:deployment`

```bash
git add deploy/compose.production.yml deploy/release.env.example deploy/env/publish-scheduler.env.example ../.github/workflows/publish-brand-pilot-server-images.yml scripts/release-impact.mjs scripts/release-impact.test.mjs scripts/assemble-release-manifest.mjs scripts/assemble-release-manifest.test.mjs scripts/incremental-cicd-contract.test.mjs deploy/scripts/preflight.sh deploy/scripts/deploy.sh deploy/scripts/rollback.sh deploy/scripts/lib.sh scripts/deployment-contract.test.mjs
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
git add docs/operations/UBUNTU_DEPLOYMENT.md docs/operations/PUBLISH_SCHEDULER.md scripts/publish-scheduler-smoke.mjs scripts/publish-scheduler-smoke.test.mjs scripts/release-impact.mjs scripts/release-impact.test.mjs
git commit -m "docs(publish): add scheduler activation gates"
```

### Task 6: Single-release full gate and production activation

**Files:**
- No new files; change source only if verification exposes a proven defect.

- [ ] **Step 1: Run impacted API, scheduler, deployment, and migration regression.**

Run: `npm test --workspace @brand-pilot/api -- publishDueRun.test.ts repository.test.ts server.test.ts publishCalendarAllocator.test.ts publishCalendarQuota.test.ts`

Run: `node --test workers/brand-pilot-publish-scheduler/src/scheduler.test.mjs`

Run: `npm run test:deployment`

Run: `npm run test:migrations`

- [ ] **Step 2: Create one cumulative PR** containing Workstreams 1–3: publish API/UI, migration 092, the new scheduler worker, exact Compose/release keys, deployment contracts, and related docs. No Caddy, DM, Wiki, provider adapter, automatic-response setting, or unrelated worker change is allowed.

- [ ] **Step 3: Run one server-image CI/CD release build** from the merged main SHA. Confirm API and scheduler images carry that SHA, every image is immutable, and the release bundle preserves unchanged service digests. Confirm Vercel created a staged UI build for the same SHA and did not auto-assign production domains; if auto-assignment is still enabled, stop because UI can become live before migration/API.

- [ ] **Step 4: Apply the single release in a fixed order.** Reconfirm the production baseline and zero unexpected hotfix/digest drift, apply explicitly approved migration 092, deploy API canary, verify `/health`, `/ready`, allocation/due previews and no mutation, and test the staged UI against canary. Promote API primary, then promote the already-built UI deployment to the production domain without rebuilding it.

- [ ] **Step 5: Verify UI before activation.** Confirm status truth, reservation change, bounded list, content picker, responsive agenda, master OFF, channel controls, and weekly settings read/write. Deploy the scheduler digest from the same release but keep its profile stopped.

- [ ] **Step 6: Run the final preview gate.** Compare exact due/expired candidate IDs and counts with read-only DB evidence, current subscription-week quota, and provider readiness. Any unexpected candidate stops the single deployment before scheduler activation; it does not trigger another CI/CD run.

- [ ] **Step 7: Start exactly one scheduler.** Observe three successful ticks, heartbeat age, zero overlap, provider attempts, recent errors, and API restart count. Verify future work stays `게시 예정`, same-day waiting work is orange `게시 지연`, successful work is green, and expired unstarted work becomes gray with the 23:59 reason.

- [ ] **Step 8: Respect actual release-state semantics.** Existing `promote.sh` atomically writes `state/current` when API primary is promoted, before scheduler activation. Verify that write immediately. Update GitHub `PRODUCTION_RELEASE_SHA` only after scheduler and customer checks pass. If a later gate fails, stop scheduler first, roll back the UI alias and API primary so existing tooling restores `state/current`, preserve migration 092, and never delete or rewrite a customer reservation.
