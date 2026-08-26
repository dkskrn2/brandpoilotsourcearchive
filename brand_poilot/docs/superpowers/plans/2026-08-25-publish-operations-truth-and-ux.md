# Publish Operations Truth and UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing publish-management page truthful, actionable, and usable on desktop and mobile without a database migration or scheduler activation.

**Architecture:** Add a deterministic operational-status projection to the existing common `PublishItem` API, then make list and calendar consume one shared presentation layer. Keep the existing reservation repository/API and expose rescheduling for safe same-day delayed reservations. Split content selection from the sticky calendar detail and limit rendered list cards without changing the canonical data source.

**Tech Stack:** TypeScript, Fastify, React 18, Vitest, Testing Library, Playwright, existing customer UI CSS.

---

### Task 1: Add the operational-status projection

**Files:**
- Create: `apps/api/src/publishOperationalState.ts`
- Create: `apps/api/src/publishOperationalState.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/publishItemsRepository.ts`
- Test: `apps/api/src/publishItemsRepository.test.ts`

- [ ] **Step 1: Write failing projection tests** for future scheduled, today-delayed, previous-day stale, partially published, failed, result-unknown, published, and cancelled items. Freeze `now` at `2026-08-25T06:00:00.000Z` and assert exact boundaries at `2026-08-25T14:58:59.999Z` and `2026-08-25T14:59:00.000Z`.

```ts
expect(derivePublishOperationalState({
  status: "publish_queued",
  scheduledFor: "2026-08-25T02:30:00.000Z",
  targets: [{ status: "queued" }],
}, now)).toEqual({ status: "delayed_today", reason: "reserved_time_passed" });
```

- [ ] **Step 2: Run the focused tests and verify failure.**

Run: `npm test --workspace @brand-pilot/api -- publishOperationalState.test.ts publishItemsRepository.test.ts`

Expected: FAIL because `derivePublishOperationalState` and `operationalStatus` do not exist.

- [ ] **Step 3: Implement a pure projection** with the API type below. The projection must not update DB rows and must classify previous-day active reservations as `action_required` with reason `stale_reservation`, not as cancelled.

```ts
export type PublishOperationalStatus =
  | "action_required" | "upcoming" | "delayed_today"
  | "publishing" | "partially_published" | "published" | "cancelled";

export interface PublishOperationalState {
  status: PublishOperationalStatus;
  reason: "review_required" | "publish_failed" | "result_unknown"
    | "reserved_time_passed" | "stale_reservation" | "reservation_expired"
    | "future_reservation" | "publishing" | "partially_published"
    | "published" | "cancelled";
}
```

- [ ] **Step 4: Attach `operationalStatus` and `operationalReason`** to every `PublishItemDto` after `aggregatePublishState` has produced the stored-state projection. Pass one repository-level `now` value to all rows so one response cannot cross a time boundary mid-map.

- [ ] **Step 5: Re-run the focused tests.**

Expected: PASS; existing `status`, `publishStatus`, `calendarPlacement`, and source refs remain unchanged.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/publishOperationalState.ts apps/api/src/publishOperationalState.test.ts apps/api/src/types.ts apps/api/src/publishItemsRepository.ts apps/api/src/publishItemsRepository.test.ts
git commit -m "feat(publish): expose truthful operational status"
```

### Task 2: Share status, error, preview, and action presentation

**Files:**
- Create: `apps/customer-ui/src/features/publishing/publishPresentation.ts`
- Create: `apps/customer-ui/src/features/publishing/publishPresentation.test.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/components/publish/PublishManagementPreview.tsx`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/components/publish/PublishCalendar.tsx`

- [ ] **Step 1: Write failing tests** that map operational state to label/variant/class and map stable errors to user text and one allowed action.

```ts
expect(publishStatusPresentation("delayed_today")).toMatchObject({
  label: "게시 지연", tone: "warning", className: "is-delayed",
});
expect(publishErrorPresentation("oauth_required")).toEqual({
  message: "Instagram 연결이 만료되었습니다.", action: "reconnect_channel",
});
```

- [ ] **Step 2: Run tests and verify failure.**

Run: `npm test --workspace @brand-pilot/customer-ui -- publishPresentation.test.ts`

- [ ] **Step 3: Implement one presentation module** for labels, colors, accessible text, and error actions. Do not render raw `lastError`; unknown codes map to `게시 처리에 문제가 발생했습니다. 상세 로그를 확인해 주세요.` with action `inspect_result`.

- [ ] **Step 4: Correct preview semantics.** `contentStatus === "completed"` with no usable artifact must display `미리보기 없음`; only `pre_generation` may display `콘텐츠 생성 전`.

- [ ] **Step 5: Replace the duplicate list/calendar label and variant maps** with the shared functions. Calendar entry `aria-label` must include the status label.

- [ ] **Step 6: Run focused component tests.**

Run: `npm test --workspace @brand-pilot/customer-ui -- publishPresentation.test.ts PublishManagementPreview.test.tsx publishQueue.test.tsx`

Expected: PASS with no snapshot containing `instagram_publish_failed` or `oauth_required` as visible text.

- [ ] **Step 7: Commit.**

```bash
git add apps/customer-ui/src/features/publishing/publishPresentation.ts apps/customer-ui/src/features/publishing/publishPresentation.test.ts apps/customer-ui/src/types.ts apps/customer-ui/src/components/publish/PublishManagementPreview.tsx apps/customer-ui/src/pages/PublishQueuePage.tsx apps/customer-ui/src/components/publish/PublishCalendar.tsx
git commit -m "fix(publish): unify customer status presentation"
```

### Task 3: Restore safe reservation changes and valid defaults

**Files:**
- Modify: `apps/customer-ui/src/features/publishing/publishItems.ts`
- Modify: `apps/customer-ui/src/features/publishing/publishCalendar.ts`
- Modify: `apps/customer-ui/src/components/publish/PublishSchedulePanel.tsx`
- Test: `apps/customer-ui/src/features/publishing/publishItems.test.ts`
- Test: `apps/customer-ui/src/components/publish/PublishSchedulePanel.test.tsx`
- Test: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`

- [ ] **Step 1: Write failing reschedule tests.** Permit `delayed_today` only when all targets are `queued` or `scheduled`, publication progress is `none`, and the selected new time is in the future. Reject previous-day `action_required`, publishing, partial, failed, unknown, completed, and cancelled items.

- [ ] **Step 2: Write failing default-time tests** for today, a future date with a weekly preferred time, and a future date without one.

```ts
expect(defaultScheduleTime("2026-08-25", now, ["11:30"])).toBe("15:15");
expect(defaultScheduleTime("2026-08-26", now, ["09:00", "14:00"])).toBe("09:00");
```

- [ ] **Step 3: Run focused tests and verify failure.**

Run: `npm test --workspace @brand-pilot/customer-ui -- publishItems.test.ts PublishSchedulePanel.test.tsx publishQueue.test.tsx`

- [ ] **Step 4: Implement `defaultScheduleTime`.** For today, add 15 minutes and round upward to the next five-minute value. This is an initial value only; do not validate a five- or thirty-minute interval and do not reject duplicate times.

- [ ] **Step 5: Use `operationalStatus` in `canReschedulePublishItem`** and show `예약 변경` in both list and calendar for the same eligible item.

- [ ] **Step 6: Render complete Korean date/time** in the schedule dialog and slot detail, including original and effective times when different.

- [ ] **Step 7: Re-run tests and commit.**

```bash
git add apps/customer-ui/src/features/publishing/publishItems.ts apps/customer-ui/src/features/publishing/publishCalendar.ts apps/customer-ui/src/components/publish/PublishSchedulePanel.tsx apps/customer-ui/src/features/publishing/publishItems.test.ts apps/customer-ui/src/components/publish/PublishSchedulePanel.test.tsx apps/customer-ui/src/__tests__/publishQueue.test.tsx
git commit -m "fix(publish): restore safe reservation editing"
```

### Task 4: Make the list operational and bounded

**Files:**
- Modify: `apps/customer-ui/src/components/publish/publishManagementFilters.ts`
- Modify: `apps/customer-ui/src/components/publish/publishManagementFilters.test.ts`
- Create: `apps/customer-ui/src/components/publish/PublishManagementList.tsx`
- Create: `apps/customer-ui/src/components/publish/PublishManagementList.test.tsx`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`

- [ ] **Step 1: Write failing filter tests** for `action_required`, `preparing`, `upcoming`, `completed`, `cancelled`, and `all`. Assert that a previous-day queued reservation is action-required and absent from upcoming.

- [ ] **Step 2: Write a failing list test** with 306 items. The initial DOM must contain exactly 30 articles; each `더 보기` activation adds at most 30 and resetting a filter restores 30.

- [ ] **Step 3: Run tests and verify failure.**

Run: `npm test --workspace @brand-pilot/customer-ui -- publishManagementFilters.test.ts PublishManagementList.test.tsx`

- [ ] **Step 4: Extract `PublishManagementList`.** Preserve all existing review, retry, result, schedule, reschedule, and cancel callbacks. Default a URL without `status` to `action_required`; preserve explicit deep links and highlighted items even when outside the first 30.

- [x] **Step 5: Remove the legacy `정책 큐 배정` and `다음 게시 실행` customer actions.** The weekly allocator and singleton scheduler are the only automatic scheduling and publishing path; the retired fixed-policy scheduling route returns 404.

- [ ] **Step 6: Re-run tests and commit.**

```bash
git add apps/customer-ui/src/components/publish/publishManagementFilters.ts apps/customer-ui/src/components/publish/publishManagementFilters.test.ts apps/customer-ui/src/components/publish/PublishManagementList.tsx apps/customer-ui/src/components/publish/PublishManagementList.test.tsx apps/customer-ui/src/pages/PublishQueuePage.tsx
git commit -m "refactor(publish): focus the list on required work"
```

### Task 5: Separate date detail from content assignment

**Files:**
- Create: `apps/customer-ui/src/components/publish/PublishDateDetail.tsx`
- Create: `apps/customer-ui/src/components/publish/PublishDateDetail.test.tsx`
- Create: `apps/customer-ui/src/components/publish/PublishContentPickerDialog.tsx`
- Create: `apps/customer-ui/src/components/publish/PublishContentPickerDialog.test.tsx`
- Modify: `apps/customer-ui/src/components/publish/PublishCalendar.tsx`
- Modify: `apps/customer-ui/src/components/publish/ManualPublishProvisioner.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: Write failing tests** asserting that the sticky date detail contains only date schedules, selected slot details, and `콘텐츠 추가`; the 220-item content library must not render until the dialog opens.

- [ ] **Step 2: Write dialog tests** for three tabs: `기존 콘텐츠`, `새 콘텐츠`, `일괄 등록`. Assert existing search/status filters, existing Step 1 fields, catalog select boxes, and bulk row actions remain wired to their current callbacks.

- [ ] **Step 3: Run tests and verify failure.**

Run: `npm test --workspace @brand-pilot/customer-ui -- PublishDateDetail.test.tsx PublishContentPickerDialog.test.tsx ManualPublishProvisioner.test.tsx`

- [ ] **Step 4: Extract date detail and picker.** Use a wide modal (`min(960px, 100vw - 32px)`) for desktop bulk table. Keep form state in the dialog so closing without submit has no side effect.

- [ ] **Step 5: Preserve focus.** Opening focuses the dialog heading; Escape/cancel returns focus to `콘텐츠 추가`; completing Step 1 keeps the current localStorage bulk draft behavior.

- [ ] **Step 6: Re-run tests and commit.**

```bash
git add apps/customer-ui/src/components/publish/PublishDateDetail.tsx apps/customer-ui/src/components/publish/PublishDateDetail.test.tsx apps/customer-ui/src/components/publish/PublishContentPickerDialog.tsx apps/customer-ui/src/components/publish/PublishContentPickerDialog.test.tsx apps/customer-ui/src/components/publish/PublishCalendar.tsx apps/customer-ui/src/components/publish/ManualPublishProvisioner.tsx apps/customer-ui/src/styles/prototype.css
git commit -m "refactor(publish): separate schedule and content workflows"
```

### Task 6: Add status colors and mobile agenda

**Files:**
- Create: `apps/customer-ui/src/components/publish/PublishMobileAgenda.tsx`
- Create: `apps/customer-ui/src/components/publish/PublishMobileAgenda.test.tsx`
- Modify: `apps/customer-ui/src/components/publish/PublishCalendar.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Create: `apps/customer-ui/e2e/publish-queue.spec.ts`

- [ ] **Step 1: Write failing component tests** for the seven-day strip, selected-day agenda, keyboard selection, and visible text status.

- [ ] **Step 2: Add semantic calendar classes** `is-completed`, `is-upcoming`, `is-delayed`, `is-failed`, and `is-cancelled`; map them to green, blue, orange, red, and gray without relying on color alone.

- [ ] **Step 3: At widths below 640px, render `PublishMobileAgenda`** instead of the 640px-wide month grid. Do not hide any date or slot; previous/next week controls move the seven-day strip.

- [ ] **Step 4: Add Playwright checks** at 1280x720, 1024x768, and 390x844. Assert no page-level horizontal overflow, filters remain reachable, and the content picker submit area remains visible.

- [ ] **Step 5: Run customer UI verification.**

Run: `npm test --workspace @brand-pilot/customer-ui -- PublishMobileAgenda.test.tsx publishQueue.test.tsx`

Run: `npm run build --workspace @brand-pilot/customer-ui`

Run: `npm run e2e --workspace @brand-pilot/customer-ui -- publish-queue.spec.ts`

Expected: all PASS; axe reports no critical violations on list, calendar, schedule dialog, or content picker.

- [ ] **Step 6: Commit.**

```bash
git add apps/customer-ui/src/components/publish/PublishMobileAgenda.tsx apps/customer-ui/src/components/publish/PublishMobileAgenda.test.tsx apps/customer-ui/src/components/publish/PublishCalendar.tsx apps/customer-ui/src/styles/prototype.css apps/customer-ui/e2e/publish-queue.spec.ts
git commit -m "feat(publish): add responsive operational calendar"
```

### Task 7: Workstream 1 regression gate

**Files:**
- Modify only if evidence requires: `docs/operations/UBUNTU_DEPLOYMENT.md`

- [ ] **Step 1: Run impacted API tests.**

Run: `npm test --workspace @brand-pilot/api -- publishOperationalState.test.ts publishItemState.test.ts publishItemsRepository.test.ts publishItemsRepository.pglite.test.ts publishCalendarRepository.test.ts server.test.ts`

- [ ] **Step 2: Run impacted customer UI tests and build.**

Run: `npm test --workspace @brand-pilot/customer-ui -- publishItems.test.ts publishManagementFilters.test.ts PublishManagementList.test.tsx PublishSchedulePanel.test.tsx PublishDateDetail.test.tsx PublishContentPickerDialog.test.tsx PublishMobileAgenda.test.tsx publishQueue.test.tsx`

Run: `npm run build --workspace @brand-pilot/customer-ui`

- [ ] **Step 3: Inspect the diff.** It may contain API and customer UI only. It must not contain `db/migrations`, `deploy/compose.production.yml`, Caddy, worker, DM, or provider-adapter changes.

- [ ] **Step 4: Record the Workstream 1 checkpoint** in the same feature branch. Do not create, merge, or deploy an intermediate PR; continue to Workstream 2 only when the focused API/UI suites are green.

- [ ] **Step 5: Capture local browser evidence** at 1280x720, 1024x768, and 390x844 for list, calendar, reservation edit, content picker, and error states. Do not write operating data.

- [ ] **Step 6: Confirm Workstream 1 acceptance.** The known 8월 25 11:30 fixture is not ordinary upcoming, completed entries are green, raw errors are hidden, today’s reservation opens with a future time, and list initial DOM has at most 30 cards.

- [ ] **Step 7: Continue on the same branch** to Workstream 2. Do not update `state/current`, `PRODUCTION_RELEASE_SHA`, release manifests, or production services at this checkpoint.
