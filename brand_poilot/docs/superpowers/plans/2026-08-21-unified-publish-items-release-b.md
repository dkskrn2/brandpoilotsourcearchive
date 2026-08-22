# Unified Publish Items Release B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate same-time reservations and make list and calendar render one canonical publish-item collection with one shared scheduling flow.

**Architecture:** Release B starts only after Release A is fully promoted and preserved as the rollback image. Migration `086` removes the old time uniqueness and narrows generation uniqueness; the API builds one brand-scoped `PublishItem[]` read model and preserves target-level failures. The customer UI fetches that collection once, derives list/calendar placement locally and uses one fixed-source scheduling panel in both views.

**Tech Stack:** PostgreSQL, PGlite, Fastify, TypeScript, React, Vitest, Testing Library, Vite, Bash deployment gates

---

## File map

- `db/migrations/086_publish_calendar_same_time_contract.sql`: removes brand/time uniqueness and narrows generation-level uniqueness.
- Migration runner/deploy contract files: make 086 the exact Release B evidence.
- `apps/api/src/publishItemState.ts`: target aggregation, progress and calendar placement.
- `apps/api/src/publishItemsRepository.ts`: one tenant-scoped canonical read model.
- `apps/api/src/types.ts`, `apps/api/src/repository.ts`, `apps/api/src/httpServer.ts`: DTO, composition and `GET /publish-items`.
- `apps/api/src/publishCalendarRepository.ts`, `publishCalendarAllocator.ts`, `repository.ts`, `publishSchedule.ts`: remove every reservation-spacing path while preserving execution/retry timeouts.
- `apps/customer-ui/src/types.ts`, `lib/apiClient.ts`, `features/publishing/publishItems.ts`: shared client contract and derivations.
- `apps/customer-ui/src/components/publish/PublishSchedulePanel.tsx`: shared fixed-source scheduling UI.
- `PublishQueuePage.tsx`, `PublishCalendar.tsx`, `ManualPublishProvisioner.tsx`: one collection, one scheduling action, same-time settings and batch input.
- Focused API/UI/PGlite/PostgreSQL tests: mixed status, identity, quota, same-time and rollback proof.

### Task 1: Enforce Release B preconditions and add migration 086

**Files:**
- Create: `db/migrations/086_publish_calendar_same_time_contract.sql`
- Create: `apps/api/src/publishCalendarMigration086.pglite.test.ts`
- Modify: `scripts/migrationRunner.mjs`
- Modify: `scripts/migrationRunner.test.mjs`
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `deploy/scripts/deploy.sh`

- [ ] **Step 1: Start from the exact promoted Release A baseline**

```powershell
git fetch origin
$releaseASha = git rev-parse origin/main
git status --short
git show --no-patch --oneline $releaseASha
git worktree add C:\Users\dkskr\.config\superpowers\worktrees\brand_poilot\unified-publish-items-release-b -b codex/unified-publish-items-release-b $releaseASha
Set-Location C:\Users\dkskr\.config\superpowers\worktrees\brand_poilot\unified-publish-items-release-b\brand_poilot
```

Confirm `$releaseASha` equals the production Release A source SHA before the `git worktree add` command. Do not implement B on an unmerged A feature branch.

- [ ] **Step 2: Verify the remaining non-code preconditions**

Record evidence that every production API replica runs the Release A digest, migration 085 is applied, API A can allocate duplicate/near settings in a rollback fixture, and the no-key open-slot route has no caller. If a caller exists, migrate it to keyed canonical provisioning and rerun observation; do not remove the route or continue while a caller remains.

- [ ] **Step 3: Write migration RED tests**

Load 079, 085 and 086 in PGlite. Assert two active slots at the same brand/timestamp succeed, two output-level slots from one generation succeed when output IDs differ, the same output rejects, and a second generation-level slot with null output rejects.

```ts
expect(indexes).not.toContain("publish_calendar_slots_active_brand_time_unique");
expect(generationIndexDefinition).toContain("generation_output_id IS NULL");
expect(indexes).toContain("publish_calendar_slots_generation_output_unique");
```

- [ ] **Step 4: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- src/publishCalendarMigration086.pglite.test.ts
node --test scripts/migrationRunner.test.mjs scripts/deployment-contract.test.mjs
```

Expected: missing migration 086 and stale 085 deployment evidence.

- [ ] **Step 5: Create the exact contract migration**

```sql
begin;

set local lock_timeout = '5s';

drop index publish_calendar_slots_active_brand_time_unique;
drop index publish_calendar_slots_generation_unique;

create unique index publish_calendar_slots_generation_unique
  on publish_calendar_slots(brand_id,generation_id)
  where generation_id is not null
    and generation_output_id is null
    and status <> 'cancelled';

commit;
```

The migration must fail closed if either expected old index is absent. Do not modify existing rows.

- [ ] **Step 6: Register checksum and Release B evidence**

Compute SHA-256 with the exact command from Release A, append 086 after 085 in both runner arrays and set deploy evidence to 086. Update the image-required migration list and exact fixtures; preserve 077-085 history.

- [ ] **Step 7: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/publishCalendarMigration086.pglite.test.ts
node --test scripts/migrationRunner.test.mjs scripts/deployment-contract.test.mjs
git add db/migrations/086_publish_calendar_same_time_contract.sql apps/api/src/publishCalendarMigration086.pglite.test.ts scripts/migrationRunner.mjs scripts/migrationRunner.test.mjs scripts/deployment-contract.test.mjs deploy/scripts/deploy.sh
git commit -m "feat: enable same-time publish calendar slots"
```

### Task 2: Define canonical publish item state and DTOs

**Files:**
- Create: `apps/api/src/publishItemState.ts`
- Create: `apps/api/src/publishItemState.test.ts`
- Modify: `apps/api/src/types.ts`

- [ ] **Step 1: Write the mixed-target truth-table tests**

```ts
expect(aggregatePublishState(["scheduled", "deferred"])).toMatchObject({ status: "deferred" });
expect(aggregatePublishState(["cancelled", "cancelled"])).toMatchObject({ status: "cancelled", progress: "none" });
expect(aggregatePublishState(["published", "cancelled"])).toMatchObject({ status: "failed", progress: "partial" });
expect(aggregatePublishState(["published", "failed"])).toMatchObject({ status: "failed", progress: "partial" });
expect(aggregatePublishState(["published", "scheduled"])).toMatchObject({ status: "scheduled", progress: "partial" });
expect(aggregatePublishState(["published", "published"])).toMatchObject({ status: "published", progress: "complete" });
```

Add date tests for complete publish `max(publishedAt)`, active partial `min(effectiveScheduledFor)`, published+failed `max(published target time)`, unreserved eligible and hidden failed/cancelled no-date items.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- src/publishItemState.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Add exact DTO contracts**

```ts
export type PublishStatus = "unreserved" | "reserved" | "publish_queued" | "scheduled" | "deferred"
  | "publishing" | "partially_published" | "published" | "failed" | "result_unknown" | "cancelled";

export type PublishItemStatus = Exclude<PublishStatus, "unreserved">
  | "completed_unpublished" | "generating" | "pre_generation";

export interface PublishItemTargetDto {
  queueId: string;
  channelOutputId: string | null;
  channel: Channel;
  status: "queued" | "scheduled" | "publishing" | "published" | "failed" | "deferred" | "cancelled";
  scheduledFor: string | null;
  publishedAt: string | null;
  lastError: string | null;
  externalUrl: string | null;
  previewTitle: string | null;
  previewBody: string | null;
  outputJson: Record<string, unknown>;
  artifactPublicUrl: string | null;
}

export interface PublishItemDto {
  itemKey: string;
  workspaceId: string;
  brandId: string;
  title: string;
  createdAt: string;
  contentFormat: "card_news" | "reel" | null;
  channels: Channel[];
  source: { type: "topic_table" | "source_url" | "mixed" | "unknown"; label: string; detail: string | null; urls: string[] };
  targets: PublishItemTargetDto[];
  contentStatus: "pre_generation" | "generating" | "completed" | "failed";
  publishStatus: PublishStatus;
  status: PublishItemStatus;
  groupStatus: string | null;
  publicationProgress: "none" | "partial" | "complete";
  scheduledFor: string | null;
  effectiveScheduledFor: string | null;
  publishedAt: string | null;
  calendarDate: string | null;
  calendarPlacement: "dated" | "unreserved" | "hidden";
  assignmentMode: "automatic" | "manual" | "direct" | null;
  sourceRefs: { contentTopicId: string | null; proposalId: string | null; generationId: string | null; generationOutputId: string | null; calendarSlotId: string | null; topicPublishGroupId: string | null; queueIds: string[] };
  schedulable: boolean;
  scheduleBlockedReason: string | null;
  lastError: string | null;
}
```

- [ ] **Step 4: Implement the pure reducer and run GREEN**

Implement the exact priority from the approved spec: unknown, failed, cancelled-only, mixed cancelled failure, publishing, deferred, scheduled, queued, partial, published, reserved, then content lifecycle. Keep target arrays untouched.

```powershell
npm test --workspace @brand-pilot/api -- src/publishItemState.test.ts
git add apps/api/src/publishItemState.ts apps/api/src/publishItemState.test.ts apps/api/src/types.ts
git commit -m "feat: define canonical publish item state"
```

### Task 3: Build one tenant-scoped publish-items repository and route

**Files:**
- Create: `apps/api/src/publishItemsRepository.ts`
- Create: `apps/api/src/publishItemsRepository.test.ts`
- Create: `apps/api/src/publishItemsRepository.pglite.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `scripts/repository-contract.test.mjs`

- [ ] **Step 1: Write repository RED fixtures**

Create brand-scoped fixtures for: selected `content_topics` with no generation; one content topic that later owns a publish group; generation without output; two completed outputs from one generation; a calendar-linked group; a direct group; null-group legacy multi-target queues; published+failed and published+scheduled targets; no-date failed/cancelled items; and a cross-tenant row.

Assert one logical item per canonical source, no cross-tenant row and these keys:

```ts
expect(keys).toEqual(expect.arrayContaining([
  `topic:${topicId}`,
  `generation:${generationId}`,
  `output:${output1Id}`,
  `output:${output2Id}`,
]));
expect(keys.filter((key) => key === `topic:${topicId}`)).toHaveLength(1);
```

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- src/publishItemsRepository.test.ts src/publishItemsRepository.pglite.test.ts
```

Expected: missing repository module.

- [ ] **Step 3: Implement one canonical query boundary**

Export:

```ts
export interface PublishItemsRepository {
  listPublishItems(input: { workspaceId: string; brandId: string }): Promise<PublishItemDto[]>;
}
```

The query must constrain every source CTE by both workspace and brand. Use the same canonical direct unit expression introduced in Release A. Join `content_topics`, generation/output lineage, slots, groups, queue and channel outputs, then group targets by canonical unit. Do not join by unscoped UUID alone. Feed raw targets into `aggregatePublishState` and return one array sorted by `calendarDate desc nulls last`, then source creation order.

- [ ] **Step 4: Preserve source lineage and calendar placement**

Content-topic rows remain keyed by content topic after a group appears. A generation is returned only until completed outputs exist; each output then becomes a unit. `calendarPlacement` is `dated` when the date reducer returns a time, `unreserved` only when `schedulable` and date-less, otherwise `hidden`.

- [ ] **Step 5: Compose the repository and route**

Extend `ApiRepository` with `Partial<PublishItemsRepository>`, create it next to `publishCalendar` in `createRepository`, spread it into the returned repository, and register:

```ts
app.get<{ Params: { brandId: string } }>("/brands/:brandId/publish-items", async (request) => {
  if (!repository.listPublishItems) throw new Error("publish_items_not_configured");
  return repository.listPublishItems(aiContentScope(request, request.params.brandId));
});
```

Add HTTP tests for authentication, workspace scope and exact DTO pass-through.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/publishItemState.test.ts src/publishItemsRepository.test.ts src/publishItemsRepository.pglite.test.ts src/repository.test.ts src/server.test.ts
node --test scripts/repository-contract.test.mjs
git add apps/api/src/publishItemsRepository.ts apps/api/src/publishItemsRepository.test.ts apps/api/src/publishItemsRepository.pglite.test.ts apps/api/src/types.ts apps/api/src/repository.ts apps/api/src/repository.test.ts apps/api/src/httpServer.ts apps/api/src/server.test.ts scripts/repository-contract.test.mjs
git commit -m "feat: add canonical publish items api"
```

### Task 4: Make list and calendar consume the same client collection

**Files:**
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Create: `apps/customer-ui/src/features/publishing/publishItems.ts`
- Create: `apps/customer-ui/src/features/publishing/publishItems.test.ts`
- Modify: `apps/customer-ui/src/features/publishing/publishCalendar.ts`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`

- [ ] **Step 1: Write one-network-read RED tests**

Mock `listPublishItems` once and make the old queue/output/result/slot reads throw. Assert both tabs render the same `itemKey`, status and time, a dated item appears in its date cell, an unreserved item appears in the tray and a hidden failed item remains in the list only.

```ts
expect(api.listPublishItems).toHaveBeenCalledTimes(1);
expect(api.listPublishQueue).not.toHaveBeenCalled();
expect(api.listPublishCalendarSlots).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/publishQueue.test.tsx src/features/publishing/publishItems.test.ts
```

Expected: missing client method and old three-way assembly still runs.

- [ ] **Step 3: Mirror the API DTO and add one client call**

Add the exact `PublishItem`, `PublishItemTarget`, status and source-ref types matching Task 2. Add:

```ts
listPublishItems(brandId: string) {
  return request<PublishItem[]>(fetcher, `${baseUrl}/brands/${brandId}/publish-items`, { method: "GET" });
}
```

- [ ] **Step 4: Add pure list/calendar derivations**

```ts
export const listItems = (items: PublishItem[]) => [...items].sort(sortPublishItems);
export const datedItems = (items: PublishItem[]) => items.filter((item) => item.calendarPlacement === "dated");
export const unreservedItems = (items: PublishItem[]) => items.filter((item) => item.calendarPlacement === "unreserved");
```

`entryFromPublishItem` must use `calendarDate`; it must never use generation/creation time.

- [ ] **Step 5: Replace page state and initial reads**

Replace `queueRows`, `contentOutputs`, `publishResults` and `calendarSlots` as rendering sources with one `publishItems` state and one initial request. Keep calendar settings, channel connection and manual options as separate supporting reads. Refresh the same collection after schedule, cancel, retry and publish mutations. Preserve queue deep links by searching `item.targets[].queueId`.

For cancellation, use `cancelPublishCalendarSlot` when `sourceRefs.calendarSlotId` is active; otherwise use the existing queue cancel action for the selected target. Retry remains target/queue-specific. Published result and artifact actions use the selected target queue ID. Do not add a future-force-publish action.

- [ ] **Step 6: Preserve result details without a second base collection**

Build the current result dialog input from the selected item's target preview/result fields. Artifact download remains an on-demand queue action; do not restore `listPublishResults` as a page-load fallback.

- [ ] **Step 7: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/publishQueue.test.tsx src/features/publishing/publishItems.test.ts
git add apps/customer-ui/src/types.ts apps/customer-ui/src/lib/apiClient.ts apps/customer-ui/src/features/publishing/publishItems.ts apps/customer-ui/src/features/publishing/publishItems.test.ts apps/customer-ui/src/features/publishing/publishCalendar.ts apps/customer-ui/src/pages/PublishQueuePage.tsx apps/customer-ui/src/__tests__/publishQueue.test.tsx
git commit -m "feat: share publish items across list and calendar"
```

### Task 5: Use one fixed-source scheduling panel in both views

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/publishCalendarRepository.test.ts`
- Modify: `apps/api/src/publishCalendarProvisioning.pglite.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Create: `apps/customer-ui/src/components/publish/PublishSchedulePanel.tsx`
- Create: `apps/customer-ui/src/components/publish/PublishSchedulePanel.test.tsx`
- Modify: `apps/customer-ui/src/components/publish/PublishCalendar.tsx`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`

- [ ] **Step 1: Write API RED tests for all schedulable source kinds**

Cover `existing_content_topic`, `existing_generation` and `existing_output`. A selected content topic must create/get its existing `topic_publish_groups` row, create a `generation_pending` slot linked to that group and leave the topic selected for the existing generation runner. Replaying the same keyed request returns the same slot. It must not trigger provider publication.

Extend the source union exactly:

```ts
export type PublishCalendarManualSlotSourceDto =
  | { kind: "existing_content_topic"; contentTopicId: string }
  | { kind: "existing_generation"; generationId: string }
  | { kind: "existing_output"; generationOutputId: string };
```

- [ ] **Step 2: Run API RED**

```powershell
npm test --workspace @brand-pilot/api -- src/publishCalendarRepository.test.ts src/publishCalendarProvisioning.pglite.test.ts src/server.test.ts
```

Expected: `existing_content_topic` is rejected by the current exact source parser.

- [ ] **Step 3: Implement content-topic reservation without a new migration**

Under the brand lock, scope the selected content topic by workspace/brand and status `selected`, insert/get `topic_publish_groups(content_topic_id,status='waiting')`, and insert a `generation_pending` slot with that group ID. The existing content-generation runner later uses the same unique content-topic group and completion linkage. Do not alter the topic status or generate content inside the slot transaction.

- [ ] **Step 4: Write shared-panel UI RED tests**

Open `게시 설정` from a list item and an unreserved calendar item. Assert both render the same `PublishSchedulePanel`, lock the selected source/title/format, show Instagram connection and weekly availability, and submit the same `provisionPublishCalendarManualSlot` payload. Reserved, publishing, published, failed and cancelled items must not show a new schedule action.

Map server failures to fixed user messages: inactive subscription → plan guidance; weekly quota → remaining/reset guidance; past time → future-time inline alert; disconnected channel → Instagram connection guidance; format mismatch → no mutation; existing source reservation → open existing reservation detail; tenant rejection → generic not-available message. Add a mutation-success/refetch-failure case proving the panel reports saved success and does not resubmit.

- [ ] **Step 5: Run UI RED**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/components/publish/PublishSchedulePanel.test.tsx src/__tests__/publishQueue.test.tsx
```

Expected: the shared component is missing and list items have no schedule action.

- [ ] **Step 6: Implement the fixed-source panel**

`PublishSchedulePanel` receives one `PublishItem`, manual options, date/time and a submit callback. Derive the source payload from `sourceRefs` in this order: output, generation, content topic. Do not render a content selector. Load manual options/channel availability lazily when the panel opens from either list or calendar; do not keep the current calendar-only effect. On success close the panel and refresh `PublishItem[]` plus usage; on success with refresh failure show saved-success and retry-refresh messages separately.

- [ ] **Step 7: Keep new-content and bulk entry points in the calendar tray**

The tray retains `새 콘텐츠 생성` and `여러 주제 일괄 설정`. Those flows still collect DB-backed purpose, subject mode, product and format values. Existing-item scheduling always uses the fixed-source panel, so it cannot accidentally switch content.

Keep regression assertions for Seoul-today selection in the current month, first-day selection after month navigation, mobile shared calendar scrolling, keyboard tab/dialog focus restoration, cancel/retry/result actions and the existing sidebar usage summary.

- [ ] **Step 8: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/publishCalendarRepository.test.ts src/publishCalendarProvisioning.pglite.test.ts src/server.test.ts
npm test --workspace @brand-pilot/customer-ui -- src/components/publish/PublishSchedulePanel.test.tsx src/__tests__/publishQueue.test.tsx
git add apps/api/src/types.ts apps/api/src/publishCalendarRepository.ts apps/api/src/publishCalendarRepository.test.ts apps/api/src/publishCalendarProvisioning.pglite.test.ts apps/api/src/httpServer.ts apps/api/src/server.test.ts apps/customer-ui/src/types.ts apps/customer-ui/src/components/publish/PublishSchedulePanel.tsx apps/customer-ui/src/components/publish/PublishSchedulePanel.test.tsx apps/customer-ui/src/components/publish/PublishCalendar.tsx apps/customer-ui/src/pages/PublishQueuePage.tsx apps/customer-ui/src/__tests__/publishQueue.test.tsx
git commit -m "feat: share publish scheduling across views"
```

### Task 6: Remove every reservation-spacing path and no other 30-minute policy

**Files:**
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/publishCalendarRepository.test.ts`
- Modify: `apps/api/src/publishCalendarProvisioning.pglite.test.ts`
- Modify: `apps/api/src/publishCalendarAllocator.ts`
- Modify: `apps/api/src/publishCalendarAllocator.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/publishSchedule.ts`
- Modify: `apps/api/src/publishSchedule.test.ts`
- Modify: `apps/customer-ui/src/components/publish/PublishCalendar.tsx`
- Modify: `apps/customer-ui/src/components/publish/ManualPublishProvisioner.tsx`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`

- [ ] **Step 1: Write same-time RED tests for every approved path**

Prove exact same timestamp succeeds for two manual sources, two batch rows and duplicate automatic settings. Prove late calendar groups all use the current tick and slot-less ready groups all use the same next policy time. Assert each distinct publication unit consumes one quota unit and multi-target/replay do not add usage.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- src/publishCalendarRepository.test.ts src/publishCalendarProvisioning.pglite.test.ts src/publishCalendarAllocator.test.ts src/repository.test.ts src/publishSchedule.test.ts
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/publishQueue.test.tsx
```

Expected: customer validation, exact conflict, `assertSlotSpacing`, safe-time shifting or occupied policy logic fails the cases.

- [ ] **Step 3: Remove API/customer spacing validation**

Remove duplicate/30-minute checks from `validateSlotTimes`, `assertSlotSpacing`, manual exact-time conflict for keyed content sources and batch row validation. Keep future-time, subscription, quota, channel, format, tenant and source duplicate checks. The legacy no-key route is removed because Task 1 proved no caller.

- [ ] **Step 4: Remove UI spacing behavior**

Delete `slotTimesAreSpaced`, duplicate rejection, bulk 30-minute validation/messages and `행 추가 (+30분)`. A new bulk row copies the current selected time or uses the existing default; users may enter identical times.

- [ ] **Step 5: Remove automatic conflict shifting**

In the late calendar path, replace blocked-time lookup and `earliestSafePublicationTime` with `effectiveScheduledFor = scheduledFor <= now ? now : scheduledFor`. In the slot-less ready path, stop loading occupied slots and assign `nextPolicySlots(now,1)[0]` to every ready group in the transaction, with `slot_date=kstDateKey(scheduledFor)` and `slot_number=null` on group and queues. Null slot numbers intentionally avoid the existing `topic_publish_groups_active_brand_slot_unique` index while preserving historical numbered rows. Delete `nextAvailablePolicySlot`, `jitterPolicySlot` and now-unused metadata calls only after `rg` confirms no remaining caller.

- [ ] **Step 6: Preserve unrelated 30-minute semantics**

Do not change `publishing_started_at < now() - interval '30 minutes'`, provider retry intervals, performance-sync leases or any worker timing. Add a static contract assertion that these publish recovery predicates remain.

- [ ] **Step 7: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/publishCalendarRepository.test.ts src/publishCalendarProvisioning.pglite.test.ts src/publishCalendarAllocator.test.ts src/repository.test.ts src/publishSchedule.test.ts
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/publishQueue.test.tsx
git add apps/api/src/publishCalendarRepository.ts apps/api/src/publishCalendarRepository.test.ts apps/api/src/publishCalendarProvisioning.pglite.test.ts apps/api/src/publishCalendarAllocator.ts apps/api/src/publishCalendarAllocator.test.ts apps/api/src/repository.ts apps/api/src/repository.test.ts apps/api/src/publishSchedule.ts apps/api/src/publishSchedule.test.ts apps/customer-ui/src/components/publish/PublishCalendar.tsx apps/customer-ui/src/components/publish/ManualPublishProvisioner.tsx apps/customer-ui/src/__tests__/publishQueue.test.tsx
git commit -m "feat: remove publish reservation spacing"
```

### Task 7: Verify the affected release and actual PostgreSQL role

**Files:**
- Create: `apps/api/src/publishCalendarMigration086.postgres.integration.test.ts`
- Modify: only files directly required by failing affected checks.

- [ ] **Step 1: Add actual PostgreSQL contract verification**

Apply 079, 085 and 086 as schema owner, switch to the production-equivalent application role and execute: two same-time slot inserts with distinct keys; two output-level inserts from one generation; keyed replay SELECT; slot UPDATE/cancel. Assert a duplicate output rejects and ALTER/DROP are denied. A skipped test is not a pass.

- [ ] **Step 2: Run affected API verification**

```powershell
npm test --workspace @brand-pilot/api -- src/publishItemState.test.ts src/publishItemsRepository.test.ts src/publishItemsRepository.pglite.test.ts src/publishCalendarMigration086.pglite.test.ts src/publishCalendarMigration086.postgres.integration.test.ts src/publishCalendarRepository.test.ts src/publishCalendarProvisioning.pglite.test.ts src/publishCalendarAllocator.test.ts src/repository.test.ts src/server.test.ts
node --test scripts/migrationRunner.test.mjs scripts/deployment-contract.test.mjs scripts/repository-contract.test.mjs
npm run typecheck --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/api
```

Expected: every test runs and exits 0; the PostgreSQL role test is not skipped.

- [ ] **Step 3: Run affected customer UI verification**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/publishQueue.test.tsx src/__tests__/navigation.test.tsx src/features/publishing/publishItems.test.ts src/components/publish/PublishSchedulePanel.test.tsx
npm run build --workspace @brand-pilot/customer-ui
git diff --check
```

Expected: focused UI tests and production build exit 0. Do not run DM, FAQ, crawl, wiki or unrelated worker tests.

- [ ] **Step 4: Run local browser behavior checks**

Using the real local API/database fixture and authenticated customer UI, verify: one network `publish-items` read feeds both tabs; list and calendar show the same item/status/time; selected content topic, generation and output scheduling; two items at one timestamp; partial publish error visibility; mobile calendar without body overflow; keyboard focus restore and panel accessibility.

- [ ] **Step 5: Review exact scope and commit corrections**

The diff may include migration/API/customer UI/deployment/docs only. Provider and unrelated workers must be absent. Run spec and quality review, fix only P0/P1/P2 findings. Inspect `git status --short` and stage each actual corrected file by its exact name; never stage a directory. Then commit:

```powershell
git commit -m "fix: close unified publish items review"
```

Skip when no files changed.

### Task 8: Promote Release B safely and verify production

**Files:**
- No source edits during deployment.

- [ ] **Step 1: Freeze exact operating state**

Fetch remote main, record current release SHA, API source SHA/digest, UI revision, restart counts, worker digests, dirty/hotfix state and API A rollback digest. Abort if another deployment or hotfix overlaps.

- [ ] **Step 2: Capture database recovery evidence**

Record backup/PITR timestamp, migration 086 checksum, pending migration list and operator. Confirm only 086 is pending. Re-run no-key caller observation and abort if any unmigrated caller exists.

- [ ] **Step 3: Apply only migration 086**

Run the approved dry-run, apply, then dry-run again. Expected second result: empty `applied`. While API A is still live, verify calendar manual write, automatic allocation, queue schedule and due execution remain healthy with the new schema.

- [ ] **Step 4: Deploy API B by immutable digest**

Canary API B only. Verify health, ready, exact source SHA/digest, `GET /publish-items`, existing queue/result routes, same-time keyed reservation on the dedicated test brand and recent publish-related logs. Promote only when canary is clean.

- [ ] **Step 5: Deploy customer UI B**

Promote the exact tested UI revision. Do not redeploy workers. Verify the production browser with an authenticated dedicated brand: same item in list/calendar, list `게시 설정`, calendar unreserved tray, shared panel, same-time two-unit reservation, usage count +2, partial error details and successful cancel refresh.

- [ ] **Step 6: Verify late and automatic behavior**

On the dedicated test brand, confirm duplicate automatic slot settings create distinct keyed slots, replay creates no duplicates and an overdue ready slot is scheduled at the current tick rather than shifted by 30 minutes. Do not force-publish a future reservation.

- [ ] **Step 7: Monitor and decide**

Check external health/ready, API/UI revision, API restart count, scheduler heartbeat and publish-related error logs. If API/UI fails, roll back UI B and API B to Release A while leaving 086 applied. Confirm API A continues allocating duplicate/near settings beyond the existing horizon. Do not recreate removed unique indexes automatically.

- [ ] **Step 8: Report completion evidence**

Report exact production SHA/digests, migration evidence, browser cases, usage delta, health/restart/log results and rollback target. Say “배포 완료” only after the live containers and public customer URL are verified.
