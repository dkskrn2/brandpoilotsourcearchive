# Publish Subscription and Reschedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the canonical FREE 30/30 weekly plan, make the sidebar and reservation API use it, and allow safe in-place changes to future publication reservations.

**Architecture:** A forward-only migration installs the canonical plan without creating subscriptions for every brand. The repository exposes real subscription/billing data and performs an atomic slot/group/queue schedule update under the existing brand lock. Customer UI reuses one schedule panel in create or edit mode and refreshes the canonical `PublishItem[]` after mutations.

**Tech Stack:** PostgreSQL migrations, TypeScript, Fastify, React, Vitest, PGlite, application-role PostgreSQL integration tests.

---

### Task 1: Canonical FREE plan migration

**Files:**
- Create: `db/migrations/089_free_subscription_plan.sql`
- Create: `apps/api/src/publishCalendarMigration089.pglite.test.ts`
- Modify: `scripts/migrationRunner.mjs`
- Modify: `scripts/migrationRunner.test.mjs`
- Modify: `scripts/repository-contract.test.mjs`
- Modify: `scripts/deployment-contract.test.mjs`

- [x] **Step 1: Write the failing migration contract test**

Add a PGlite test that applies migration 079 and then 089, asserts the exact row `{ code: "free", name: "FREE", weekly_generation_limit: 30, weekly_publish_limit: 30, active: true }`, replays 089 successfully, and asserts a conflicting existing `free` row aborts rather than being overwritten.

- [x] **Step 2: Run the test and verify RED**

Run: `npm test --workspace @brand-pilot/api -- src/publishCalendarMigration089.pglite.test.ts`

Expected: FAIL because `089_free_subscription_plan.sql` does not exist.

- [x] **Step 3: Implement the migration**

Use a guarded insert:

```sql
do $$
begin
  if exists (select 1 from billing_plan_catalog where code='free') then
    if not exists (
      select 1 from billing_plan_catalog
      where code='free' and name='FREE'
        and weekly_generation_limit=30 and weekly_publish_limit=30 and active
    ) then raise exception 'free_subscription_plan_conflict'; end if;
  else
    insert into billing_plan_catalog(code,name,weekly_generation_limit,weekly_publish_limit,active)
    values('free','FREE',30,30,true);
  end if;
end $$;
```

Register migration 089 and its exact SHA-256 in the immutable post-075 schema migration allowlists, container contract, and latest migration deployment contract.

- [x] **Step 4: Run migration and deployment contract tests**

Run: `npm test --workspace @brand-pilot/api -- src/publishCalendarMigration089.pglite.test.ts && node --test scripts/migrationRunner.test.mjs scripts/repository-contract.test.mjs scripts/deployment-contract.test.mjs`

Expected: PASS.

- [x] **Step 5: Commit**

Commit message: `feat(db): add canonical free subscription plan`

### Task 2: Real billing summary and canonical sidebar data

**Files:**
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/customer-ui/src/components/layout/AppShell.tsx`
- Modify: `apps/customer-ui/src/components/layout/SidebarUsageSummary.tsx`
- Modify: `apps/customer-ui/src/__tests__/navigation.test.tsx`

- [x] **Step 1: Write failing API and UI tests**

API expectation:

```ts
expect(await repository.getBillingSummary(brandId)).toMatchObject({
  configured: false,
  subscription: { status: "active", planName: "FREE" },
  entitlement: { active: true, source: "subscription" },
});
```

UI expectation: the sidebar renders the billing plan name and weekly generation/publishing usage, and renders `플랜 확인 필요` instead of the daily fallback when weekly usage is unavailable.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npm test --workspace @brand-pilot/api -- src/repository.test.ts -t "billing summary" && npm test --workspace @brand-pilot/customer-ui -- src/__tests__/navigation.test.tsx`

Expected: FAIL because billing is hardcoded and sidebar falls back to daily generation usage.

- [x] **Step 3: Implement the minimal canonical reads**

Query `brand_subscriptions` joined to `billing_plan_catalog`, map active/cancel-scheduled state to the existing DTO, and leave provider/payment fields unconfigured. In the sidebar, use weekly publish-calendar usage for both generation and publishing; when it is unavailable, show a plan-check state without a fabricated remaining count.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the commands from Step 2. Expected: PASS.

- [x] **Step 5: Commit**

Commit message: `fix(ui): use canonical subscription usage in sidebar`

### Task 3: Atomic reservation reschedule repository and API

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/publishCalendarRepository.test.ts`
- Modify: `apps/api/src/publishCalendarProvisioning.pglite.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.test.ts`

- [x] **Step 1: Write failing repository tests**

Define:

```ts
rescheduleSlot(input: BrandScope & { slotId: string; scheduledFor: Date }): Promise<PublishCalendarSlotDto>;
```

Tests must prove slot-only updates before queue creation, slot/group/queue time synchronization for scheduled items, `assignment_mode='manual'`, exclusion of the existing slot from target-window quota, and rejection for past, foreign, deferred, publishing, published, failed, result-unknown, and cancelled states.

- [x] **Step 2: Run repository tests and verify RED**

Run: `npm test --workspace @brand-pilot/api -- src/publishCalendarRepository.test.ts src/publishCalendarProvisioning.pglite.test.ts -t "reschedule"`

Expected: FAIL because `rescheduleSlot` is absent.

- [x] **Step 3: Implement the transaction**

Inside the existing fenced transaction and brand advisory lock:

```ts
await subscriptionAndPublishUsage(client, input, input.scheduledFor, input.slotId);
// lock slot and linked group/queues
// reject terminal or executing states
// update slot scheduled_for and assignment_mode
// update linked group and pre-execution queues to the same KST slot_date/scheduled_for
```

Do not cancel or create slots, groups, or queues. Any SQL failure rolls back every time field.

- [x] **Step 4: Add and verify the HTTP contract**

Register `PATCH /brands/:brandId/publish-calendar/slots/:slotId/schedule`, parse one ISO timestamp, call `rescheduleSlot`, and map domain errors consistently. Add server tests for success, past time, inactive subscription, and non-editable state.

Run: `npm test --workspace @brand-pilot/api -- src/publishCalendarRepository.test.ts src/publishCalendarProvisioning.pglite.test.ts src/server.test.ts -t "reschedule|publish calendar slot schedule"`

Expected: PASS.

- [x] **Step 5: Commit**

Commit message: `feat(api): reschedule future publish slots atomically`

### Task 4: Shared create/edit schedule UI

**Files:**
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.test.ts`
- Modify: `apps/customer-ui/src/components/publish/PublishSchedulePanel.tsx`
- Modify: `apps/customer-ui/src/components/publish/PublishSchedulePanel.test.tsx`
- Modify: `apps/customer-ui/src/components/publish/PublishCalendar.tsx`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`

- [x] **Step 1: Write failing API-client and component tests**

Assert `reschedulePublishCalendarSlot(brandId, slotId, { scheduledFor })` sends PATCH. Assert edit mode initializes the existing KST date/time and renders `예약 변경`, while create mode keeps `게시 예약`.

- [x] **Step 2: Run and verify RED**

Run: `npm test --workspace @brand-pilot/customer-ui -- src/lib/apiClient.test.ts src/components/publish/PublishSchedulePanel.test.tsx src/__tests__/publishQueue.test.tsx`

Expected: FAIL because no reschedule client or edit mode exists.

- [x] **Step 3: Implement shared edit flow**

Add a mode discriminant to `PublishSchedulePanel`. List cards and calendar slot detail expose `예약 변경` only for future, non-terminal, non-executing items with a calendar slot ID. Submit PATCH in edit mode, refresh common `PublishItem[]`, dispatch the usage-changed event, and distinguish saved-success from refresh failure.

- [x] **Step 4: Run focused tests and build**

Run: `npm test --workspace @brand-pilot/customer-ui -- src/lib/apiClient.test.ts src/components/publish/PublishSchedulePanel.test.tsx src/__tests__/publishQueue.test.tsx src/__tests__/navigation.test.tsx && npm run build --workspace @brand-pilot/customer-ui`

Expected: PASS.

- [x] **Step 5: Commit**

Commit message: `feat(ui): edit future publication reservations`

### Task 5: Weekly generation enforcement integration

**Files:**
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/aiContentRepositoryV3Start.test.ts`
- Modify: `apps/api/src/server.aiContentV2Customer.test.ts`

- [x] **Step 1: Write failing weekly boundary tests**

Prove that active FREE usage 29/30 permits one new generation unit, 30/30 rejects with `generation_weekly_quota_exceeded`, and the existing daily technical limit still applies independently.

- [x] **Step 2: Run and verify RED**

Run: `npm test --workspace @brand-pilot/api -- src/aiContentRepositoryV3Start.test.ts src/server.aiContentV2Customer.test.ts -t "weekly generation quota"`

Expected: FAIL because direct generation only enforces the daily limit.

- [x] **Step 3: Enforce weekly quota in the owning generation transaction**

Read the active brand subscription and plan, derive the anchored weekly window, sum the canonical generation/reversal ledger in that transaction, and reserve only when the new quantity keeps usage at or below 30. Do not replace the daily technical cap.

- [x] **Step 4: Run affected generation and calendar tests**

Run: `npm test --workspace @brand-pilot/api -- src/aiContentRepositoryV3Start.test.ts src/server.aiContentV2Customer.test.ts src/publishCalendarRepository.test.ts src/publishCalendarProvisioning.pglite.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

Commit message: `feat(api): enforce subscription weekly generation quota`

### Task 6: Integrated verification and release preparation

**Files:**
- Modify only if evidence requires: `docs/operations/UBUNTU_DEPLOYMENT.md`

- [x] **Step 1: Run application-role PostgreSQL integration tests**

Run the migration and changed transaction suites with `RUN_POSTGRES_INTEGRATION=true`; a skipped role test is reported as unverified, not passing.

- [x] **Step 2: Run impacted test matrix**

Run API publish calendar, billing, generation quota, server contracts; customer UI publish queue, panel, navigation; migration/deployment contracts; and both production builds. Do not run DM/Wiki tests.

- [x] **Step 3: Review the complete diff**

Confirm the diff contains only migration/config, API subscription/reschedule/quota, and customer UI sidebar/publish files. Confirm no Caddy, DM, Wiki, provider adapter, or unrelated worker changes.

- [x] **Step 4: Prepare the exact GROWTHLINE subscription operation**

Produce a transaction that asserts exactly one target brand and exact `free` plan values, inserts one monthly active subscription using the application role, and aborts on any pre-existing subscription. Do not execute it before deployment preflight.

- [x] **Step 5: Run browser QA locally**

Verify actual list/calendar common data, enabled create reservation, edit-mode initial time, same-slot update, and sidebar FREE 30/30 states without mutating production.

- [x] **Step 6: Commit final verification-only adjustments**

Commit message: `test: verify publish subscription and rescheduling`
