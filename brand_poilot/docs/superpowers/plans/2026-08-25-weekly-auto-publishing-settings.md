# Weekly Automatic Publishing Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add weekly recurring schedules, channel toggles, quota-aware slot materialization, and the approved settings UI while automatic posting remains disabled in production.

**Architecture:** After explicit migration approval, store one stable row per weekday/time occurrence in an additive table and replace the allocator's runtime `slotTimes` fallback with a normalized weekly schedule. Save settings and schedule rows in one brand-scoped transaction, materialize dated slots idempotently, and expose a versioned weekly settings contract plus a dedicated master-toggle endpoint so the header cannot overwrite the full settings object. Keep the old settings endpoint isolated only for the old production UI during the non-atomic Vercel/API cutover.

**Tech Stack:** PostgreSQL, PGlite, TypeScript, Fastify, React 18, Vitest, Testing Library.

---

### Task 1: Add migration 092 and application-role permissions

**Stop gate:** An earlier requirement said to continue without another migration. The current `time[]` column cannot represent weekdays, so Task 1 requires explicit approval. If approval is denied, stop this workstream and remove weekday-specific schedules from the release instead of inventing an encoded fallback.

**Files:**
- Create: `db/migrations/092_publish_calendar_weekly_schedule.sql`
- Create: `apps/api/src/publishCalendarMigration092.pglite.test.ts`
- Create: `apps/api/src/publishCalendarMigration092.postgres.integration.test.ts`
- Modify: `scripts/migrations.integration.test.mjs`

- [ ] **Step 1: Write failing migration tests** for table shape, brand/workspace scope enforcement, day check, sort-order uniqueness, duplicate times, write-fence coverage, and application-role CRUD.

```sql
insert into publish_calendar_weekly_schedule_entries
  (id, workspace_id, brand_id, day_of_week, slot_time, sort_order)
values
  (gen_random_uuid(), $1, $2, 1, '11:30', 0),
  (gen_random_uuid(), $1, $2, 1, '11:30', 1);
```

- [ ] **Step 2: Run and verify failure.**

Run: `npm test --workspace @brand-pilot/api -- publishCalendarMigration092.pglite.test.ts`

Expected: FAIL because migration 092/table does not exist.

- [ ] **Step 3: Implement the additive migration.** Create `publish_calendar_weekly_schedule_entries` with UUID PK, separate workspace/brand FKs, `day_of_week between 1 and 7`, `slot_time time`, `sort_order >= 0`, timestamps, and unique `(brand_id, day_of_week, sort_order)`. Reuse the existing `enforce_publish_calendar_brand_scope()` trigger because `brands` has no `(workspace_id, id)` unique key for a composite FK. Register the table in the existing AI-content write-fence catalog and add the same write-fence trigger pattern. Do not create `(brand_id, day_of_week, slot_time)` uniqueness and do not drop `slot_times`.

- [ ] **Step 4: Grant exact CRUD** to the same application role used by existing publish-calendar tables. Test the complete `DELETE + INSERT + SELECT` settings transaction as that role, not as owner.

- [ ] **Step 5: Run both migration tests.**

Run: `npm test --workspace @brand-pilot/api -- publishCalendarMigration092.pglite.test.ts`

Run: `npm run test:migrations`

Expected: both PASS; PostgreSQL role test must execute, not skip.

- [ ] **Step 6: Commit.**

```bash
git add db/migrations/092_publish_calendar_weekly_schedule.sql apps/api/src/publishCalendarMigration092.pglite.test.ts apps/api/src/publishCalendarMigration092.postgres.integration.test.ts scripts/migrations.integration.test.mjs
git commit -m "feat(publish): add weekly schedule storage"
```

### Task 2: Replace runtime settings with weekly rows

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/publishCalendarRepository.test.ts`
- Modify: `apps/api/src/publishCalendarProvisioning.pglite.test.ts`

- [ ] **Step 1: Write failing repository tests** for ordered read, stable IDs, insert/update/delete in one transaction, duplicate times, tenant ID rejection, ON validation, and rollback on one invalid row.

- [ ] **Step 2: Define the contract.**

```ts
export interface PublishCalendarWeeklyScheduleEntryDto {
  id: string;
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  time: string;
  sortOrder: number;
}

export interface PublishCalendarSettingsDto {
  brandId: string;
  enabled: boolean;
  channels: Channel[];
  informationalFormat: "card_news" | "reel";
  trendFormat: "card_news" | "reel";
  weeklySchedule: PublishCalendarWeeklyScheduleEntryDto[];
  updatedAt: string | null;
}
```

- [ ] **Step 3: Implement brand-locked read/save.** Preserve IDs supplied for the same tenant; generate IDs for new rows; reject foreign IDs; delete omitted rows only in the current tenant. New runtime code must neither read nor write `slot_times`.

- [ ] **Step 4: Enforce limits.** Validate HH:mm, day 1–7, server per-day/weekly caps, supported connected channels, and `weeklySchedule.length <= weekly_publish_limit`.

- [ ] **Step 5: Run focused repository and PGlite tests.**

Run: `npm test --workspace @brand-pilot/api -- publishCalendarRepository.test.ts publishCalendarProvisioning.pglite.test.ts`

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/types.ts apps/api/src/publishCalendarRepository.ts apps/api/src/publishCalendarRepository.test.ts apps/api/src/publishCalendarProvisioning.pglite.test.ts
git commit -m "feat(publish): persist weekly automatic settings"
```

### Task 3: Add strict versioned settings and master-toggle HTTP contracts

**Files:**
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.test.ts`

- [ ] **Step 1: Write failing HTTP tests** for versioned GET/PUT `/brands/:brandId/publish-calendar/settings/weekly`, dedicated PATCH `/brands/:brandId/publish-calendar/settings/enabled`, and the unchanged legacy `/brands/:brandId/publish-calendar/settings` contract.

```json
{
  "channels": ["instagram"],
  "informationalFormat": "card_news",
  "trendFormat": "reel",
  "weeklySchedule": [
    { "id": null, "dayOfWeek": 1, "time": "11:30", "sortOrder": 0 },
    { "id": null, "dayOfWeek": 1, "time": "11:30", "sortOrder": 1 }
  ]
}
```

- [ ] **Step 2: Run and verify failure.**

Run: `npm test --workspace @brand-pilot/api -- server.test.ts`

- [ ] **Step 3: Implement strict DTO parsing.** Weekly PUT saves channels/formats/schedule without implicitly changing `enabled`; PATCH accepts exactly `{ enabled: boolean }`. OFF is always allowed; ON requires at least one connected supported channel and one schedule row. The legacy endpoint may read/write only `slot_times`; it must never create weekly rows or feed the allocator.

- [ ] **Step 4: Update customer types/client.** Add the weekly client and `setPublishCalendarEnabled`. Preserve a capability-gated legacy client branch so the staged UI still works against the old primary API; do not map legacy `slotTimes` into weekly rows.

- [ ] **Step 5: Add cutover contract tests.** Assert new UI + old API uses the legacy screen without a weekly write, old UI + new API still accepts the exact old DTO, and new UI + new API uses only the versioned weekly endpoint.

- [ ] **Step 6: Run API/client tests and commit.**

```bash
git add apps/api/src/httpServer.ts apps/api/src/server.test.ts apps/customer-ui/src/types.ts apps/customer-ui/src/lib/apiClient.ts apps/customer-ui/src/lib/apiClient.test.ts
git commit -m "feat(publish): expose weekly settings contracts"
```

### Task 4: Materialize weekly occurrences and assign daily recommendations

**Files:**
- Modify: `apps/api/src/publishCalendarAllocator.ts`
- Modify: `apps/api/src/publishCalendarAllocator.test.ts`
- Modify: `apps/api/src/publishCalendarIdempotency.ts`
- Modify: `apps/api/src/publishCalendarIdempotency.test.ts`
- Modify: `apps/api/src/publishCalendarQuota.ts`
- Modify: `apps/api/src/publishCalendarQuota.test.ts`

- [ ] **Step 1: Write failing allocator tests** for KST weekday matching, seven-day horizon, duplicate times, replay, OFF/channel OFF, deleted rows, recommendation 2 items, open extra slots, and quota exhaustion.

- [ ] **Step 2: Implement the occurrence identity.**

```ts
const idempotencyPayload = ["weekly-auto", scheduleEntry.id, kstDate] as const;
const idempotencyKey = sha256(JSON.stringify(idempotencyPayload));
```

- [ ] **Step 3: Materialize only when enabled.** Snapshot the currently enabled connected channels into each new slot. Never alter existing future slots after schedule/channel/OFF changes.

- [ ] **Step 4: Assign existing daily informational/trend recommendations** to the first open automatic slots for that KST date. Use informational/trend format preferences; leave additional slots open and never synthesize an extra topic. A recommendation created after the first allocation attempt must be attachable on a later idempotent allocation run.

- [ ] **Step 5: Count quota by publication unit.** Manual and automatic reservations share subscription-start-week availability; multiple channel targets on one slot count once; duplicate same-time rows count separately.

- [ ] **Step 6: Run focused tests and commit.**

```bash
git add apps/api/src/publishCalendarAllocator.ts apps/api/src/publishCalendarAllocator.test.ts apps/api/src/publishCalendarIdempotency.ts apps/api/src/publishCalendarIdempotency.test.ts apps/api/src/publishCalendarQuota.ts apps/api/src/publishCalendarQuota.test.ts
git commit -m "feat(publish): allocate weekly automatic slots"
```

### Task 5: Build the approved weekly settings UI

**Files:**
- Create: `apps/customer-ui/src/components/publish/AutoPublishHeaderControl.tsx`
- Create: `apps/customer-ui/src/components/publish/AutoPublishHeaderControl.test.tsx`
- Create: `apps/customer-ui/src/components/publish/WeeklyAutoPublishDialog.tsx`
- Create: `apps/customer-ui/src/components/publish/WeeklyAutoPublishDialog.test.tsx`
- Modify: `apps/customer-ui/src/components/publish/PublishCalendar.tsx`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: Write failing header tests** for master ON/OFF, server-confirmed state, failed toggle rollback, disabled ON with missing settings, and separate `수정` button.

- [ ] **Step 2: Write failing dialog tests** for channel toggles, Monday–Sunday rows, multiple times, duplicate times, add/delete/reorder, plan count, format defaults, existing-reservation notice, validation, focus return, and mobile stacking.

- [ ] **Step 3: Run and verify failure.**

Run: `npm test --workspace @brand-pilot/customer-ui -- AutoPublishHeaderControl.test.tsx WeeklyAutoPublishDialog.test.tsx publishQueue.test.tsx`

- [ ] **Step 4: Implement the header control.** Render `자동 게시`, a role=switch with ON/OFF text, and `수정`. Do not put another master switch inside the dialog.

- [ ] **Step 5: Implement the dialog** using controlled schedule rows. Display actual dates for the current week, allow duplicate times and arbitrary intervals, and disable unsupported/unconnected channels without deleting saved choices.

- [ ] **Step 6: Save server-confirmed data.** Preserve unsaved input after a failed request; closing without save changes nothing; saving explains that existing reservations remain unchanged.

- [ ] **Step 7: Run UI tests/build and commit.**

```bash
git add apps/customer-ui/src/components/publish/AutoPublishHeaderControl.tsx apps/customer-ui/src/components/publish/AutoPublishHeaderControl.test.tsx apps/customer-ui/src/components/publish/WeeklyAutoPublishDialog.tsx apps/customer-ui/src/components/publish/WeeklyAutoPublishDialog.test.tsx apps/customer-ui/src/components/publish/PublishCalendar.tsx apps/customer-ui/src/pages/PublishQueuePage.tsx apps/customer-ui/src/styles/prototype.css
git commit -m "feat(publish): add weekly automatic settings UI"
```

### Task 6: Verify the bounded transition and Workstream 2

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `docs/operations/UBUNTU_DEPLOYMENT.md`

- [ ] **Step 1: Search for runtime `slotTimes`/`slot_times` reads and writes.** The DB column may remain for rollback and the isolated legacy endpoint/client may consume it during cutover. The weekly repository, weekly endpoint, allocator, and new settings UI must not consume it.

Run: `rg -n "slotTimes|slot_times" apps/api/src apps/customer-ui/src`

Expected: matches are limited to the legacy endpoint/client, their transition tests, and migration definitions. No allocator or weekly contract match.

- [ ] **Step 2: Run impacted API suites.**

Run: `npm test --workspace @brand-pilot/api -- publishCalendarMigration092.pglite.test.ts publishCalendarRepository.test.ts publishCalendarProvisioning.pglite.test.ts publishCalendarAllocator.test.ts publishCalendarIdempotency.test.ts publishCalendarQuota.test.ts server.test.ts`

- [ ] **Step 3: Run application-role PostgreSQL integration.**

Run: `npm run test:migrations`

Expected: migration 092 role transaction executes and passes; a skip blocks release.

- [ ] **Step 4: Run customer UI tests/build.**

Run: `npm test --workspace @brand-pilot/customer-ui -- AutoPublishHeaderControl.test.tsx WeeklyAutoPublishDialog.test.tsx publishQueue.test.tsx`

Run: `npm run build --workspace @brand-pilot/customer-ui`

- [ ] **Step 5: Review the cumulative diff.** At this checkpoint it may contain Workstream 1 plus approved migration 092, API, customer UI, and directly related docs. Scheduler/Compose changes start only in Workstream 3; Caddy/provider/unrelated-worker changes remain forbidden. Because the repository release policy reports `productionDeployAllowed=false` when a migration changes, the release must follow the explicit migration-approval path rather than the ordinary automatic production path.

- [ ] **Step 6: Run a local migration/API/UI rehearsal.** Apply migration 092 only to the disposable test PostgreSQL, start the candidate API/UI locally, keep master OFF, and verify weekly settings read/write and allocator idempotency. Do not apply the migration or deploy any service to production at this checkpoint.

- [ ] **Step 7: Continue on the same branch** to Workstream 3 only after the application-role PostgreSQL test and customer UI build pass. Do not create an intermediate PR or release SHA.
