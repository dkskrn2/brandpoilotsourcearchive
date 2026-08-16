# Publish Calendar Manual Content Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before any completion claim.

**Goal:** Replace empty manual calendar slots with atomic content-backed scheduling, add existing/in-progress/new-content choices and batch Step-1 topic entry, and automatically publish late-ready content at the earliest 30-minute-safe time.

**Architecture:** `publish_calendar_slots` remains the reservation ledger. A brand-scoped options/candidate query supplies authoritative selectors. New orchestration methods create a slot and its generation/output/draft lineage under one advisory lock. Existing content generation and canonical publish preparation are reused. Late-ready content is rescheduled through the existing publish queue rather than dispatched directly.

**Tech Stack:** PostgreSQL, PGlite, Fastify, TypeScript, React, Vitest, Testing Library

---

### Task 1: Freeze the manual provisioning contracts

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Test: `apps/customer-ui/src/lib/apiClient.test.ts`
- Test: `scripts/repository-contract.test.mjs`

- [ ] Add shared DTO shapes for manual options, existing candidates, discriminated single provisioning input, batch rows, row errors, and late scheduling metadata.
- [ ] Keep IDs explicit: generationId, generationOutputId, topicPublishGroupId, proposalId and contentSuggestionId are not interchangeable.
- [ ] Add transport RED tests for exact GET/POST paths, query scope, request bodies, and error mapping.
- [ ] Add API client methods without changing unrelated publishing or DM contracts.
- [ ] Run only the affected contract and API client tests to GREEN.

### Task 2: Build the authoritative manual-options query

**Files:**
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/httpServer.ts`
- Test: `apps/api/src/publishCalendarRepository.test.ts`
- Test: `apps/api/src/server.test.ts`
- Test: `apps/api/src/publishCalendarRepository.pglite.test.ts`

- [ ] Write RED tests requiring brand-scoped approved products, active suggestions, usable references, connected/enabled channels, and adapter-compatible formats.
- [ ] Return server catalog labels for purpose and subject mode instead of hardcoding UI options.
- [ ] Exclude DB values that exist but are not currently usable by the connected channel or active plan.
- [ ] Fail closed on unavailable option sources; do not synthesize writable defaults.
- [ ] Register authenticated `GET /brands/:brandId/publish-calendar/manual-options` with cross-workspace denial tests.
- [ ] Run the focused repository and server tests to GREEN.

### Task 3: Add existing generation/output candidates

**Files:**
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/httpServer.ts`
- Test: `apps/api/src/publishCalendarRepository.pglite.test.ts`
- Test: `apps/api/src/server.test.ts`

- [ ] Add RED PGlite cases for generating content, pending-review output, approved output, published output, rejected output, and an output already linked to another active slot.
- [ ] Query candidates by workspace and brand; never accept caller-supplied ownership.
- [ ] Return assignable and blockedReason so UI display cannot broaden server eligibility.
- [ ] Preserve an existing topic publish group instead of creating a duplicate.
- [ ] Add authenticated candidate endpoint and validate pagination/filter input.
- [ ] Run only candidate repository/server tests to GREEN.

### Task 4: Implement atomic single manual provisioning

**Files:**
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/types.ts`
- Test: `apps/api/src/publishCalendarRepository.test.ts`
- Test: `apps/api/src/publishCalendarRepository.pglite.test.ts`
- Test: `apps/api/src/server.test.ts`

- [ ] Write RED tests for each persisted source kind: existing_generation and existing_output. New content must first use the existing proposal-selection flow to become an existing_generation.
- [ ] Acquire `publish-calendar:<brandId>` advisory lock before future-time, quota, spacing, lineage, and insert checks.
- [ ] Validate exact format/channel ownership and reject duplicate active-slot linkage.
- [ ] Create slot and existing lineage link atomically; a failure must leave no empty slot. A previously created generation draft remains a recoverable candidate.
- [ ] Use client idempotency key to make request replay return the same slot.
- [ ] Do not create or dispatch a publish queue until a publishable output exists.
- [ ] Add customer route `POST /brands/:brandId/publish-calendar/manual-slots`.
- [ ] Run single-provisioning PGlite and server tests to GREEN.

### Task 5: Enforce 30-minute spacing in every slot writer

**Files:**
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/publishCalendarAllocator.ts`
- Test: `apps/api/src/publishCalendarRepository.pglite.test.ts`
- Test: `apps/api/src/publishCalendarAllocator.test.ts`

- [ ] Add RED tests for 29:59 conflict, exactly 30:00 allowed, existing manual/automatic conflicts, cancelled-slot exclusion, and concurrent inserts.
- [ ] Put the spacing predicate under the same brand advisory lock as quota reservation.
- [ ] Make automatic allocation choose sequential safe times rather than placing every item at one time.
- [ ] Preserve idempotent allocator replay and brand failure isolation.
- [ ] Run the two affected suites to GREEN.

### Task 6: Implement atomic batch Step-1 registration

**Files:**
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/types.ts`
- Test: `apps/api/src/publishCalendarRepository.pglite.test.ts`
- Test: `apps/api/src/server.test.ts`

- [ ] Write RED cases for valid mixed rows, invalid select IDs, URL validation, missing marketing product, intra-batch spacing, collision with an existing slot, publish quota overflow, generation availability overflow, duplicate client row ID, and replay.
- [ ] Validate all rows first and return client row IDs with precise errors.
- [ ] Persist all rows or none under one brand lock and transaction.
- [ ] Alternate card_news/reel only when the user chooses auto-mix; never silently replace an explicit format.
- [ ] Accept only canonical generation IDs produced by the existing proposal flow; do not create another draft format in calendar code.
- [ ] Register `POST /brands/:brandId/publish-calendar/manual-slots/batch`.
- [ ] Run only batch repository/server tests to GREEN.

### Task 7: Carry slot context through the existing generation flow

**Files:**
- Modify: `apps/customer-ui/src/pages/AiContentWizardPage.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalFlow.tsx`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentPublish.ts`
- Modify: `apps/api/src/repository.ts`
- Test: `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`
- Test: `apps/api/src/aiContentPublish.test.ts`
- Test: `apps/api/src/aiContentPublish.pglite.test.ts`

- [ ] Add RED tests for opening the existing generator with slotId and prefilled Step-1 values.
- [ ] Preserve pending date/time UI context through proposal selection, then provision the slot only after the canonical generation ID exists; do not invent a calendar-only generation path.
- [ ] On completion, bind the exact output to the exact slot and call canonical publish preparation once.
- [ ] Preserve generation success if publish preparation fails; record bounded publish_delayed state.
- [ ] Verify multi-output generations cannot bind or delay another output's slot.
- [ ] Run only AI content/calendar linkage suites to GREEN.

### Task 8: Schedule late-ready content automatically

**Files:**
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/aiContentPublish.ts`
- Modify: `apps/api/src/repository.ts`
- Test: `apps/api/src/publishCalendarRepository.pglite.test.ts`
- Test: `apps/api/src/aiContentPublish.pglite.test.ts`
- Test: `apps/api/src/repository.publishPolicy.pglite.test.ts`

- [ ] Add RED PGlite cases for immediate-safe scheduling, conflict with the next reservation, recent actual publication, multiple blocked intervals, replay, concurrency, and subscription/channel invalidation.
- [ ] Calculate earliest-safe-time from now, last actual publication, and all active reservation exclusion windows.
- [ ] Preserve existing reservations and move only the delayed slot's effective publish time.
- [ ] Preserve slot.scheduled_for as the original reservation and update only the linked queue scheduled_for; never invoke provider dispatch from the generation callback.
- [ ] Let the existing authenticated publish-due runner perform the actual publish.
- [ ] Preserve one reservation unit and avoid quota double counting on reschedule.
- [ ] Run only late scheduling, linkage and execution-policy suites to GREEN.

### Task 9: Replace the manual slot UI with content-backed choices

**Files:**
- Modify: `apps/customer-ui/src/components/publish/PublishCalendar.tsx`
- Create: `apps/customer-ui/src/components/publish/ManualPublishProvisioner.tsx`
- Create: `apps/customer-ui/src/components/publish/ExistingContentPicker.tsx`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Test: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`

- [ ] Write RED tests proving the old time/format-only submit is unavailable.
- [ ] Add the four source choices and lazy-load only the selected option's data.
- [ ] Render generation and output candidates with blocked reasons and exact status.
- [ ] Render new-content Step-1 fields from manual-options response.
- [ ] On success select the new slot, refresh usage, and provide `콘텐츠 생성 계속하기`.
- [ ] Preserve calendar loading/error isolation, list view, focus restoration, keyboard behavior and mobile detail scrolling.
- [ ] Run publishQueue/navigation focused tests to GREEN.

### Task 10: Build the batch topic table

**Files:**
- Create: `apps/customer-ui/src/components/publish/BatchTopicTable.tsx`
- Modify: `apps/customer-ui/src/components/publish/ManualPublishProvisioner.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Test: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`

- [ ] Write RED tests for API-backed select values, conditional topic/URL/product cells, row add/clone/delete, multi-line paste, bulk column apply, auto-mix, and 30-minute distribution.
- [ ] Keep stable client row IDs so server errors map to the correct row after edits.
- [ ] Show local validation immediately but treat server response as authoritative.
- [ ] Keep failed submission rows and selections intact.
- [ ] Show separate existing/new generation/publish reservation counts before submit.
- [ ] Add responsive table scrolling without separating headers from the scroll container.
- [ ] Run the focused UI suite to GREEN.

### Task 11: Show posting lifecycle and late schedule details

**Files:**
- Modify: `apps/customer-ui/src/components/publish/PublishCalendar.tsx`
- Modify: `apps/customer-ui/src/features/publishing/publishCalendar.ts`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Test: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`

- [ ] Add status labels for generation setup, generation, review, ready, scheduled, delayed, publishing, published, failed and cancelled.
- [ ] Show original reservation and effective late publish time separately.
- [ ] Show automatic late-publish explanation and do not ask for manual rescheduling.
- [ ] Preserve cancel semantics and refresh usage after create/replace/cancel.
- [ ] Run publish calendar UI tests to GREEN.

### Task 12: Remove the empty customer manual-slot path

**Files:**
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `scripts/repository-contract.test.mjs`
- Test: `apps/api/src/server.test.ts`
- Test: `apps/customer-ui/src/lib/apiClient.test.ts`

- [ ] Add a contract test that customer manual creation requires a content source.
- [ ] Remove the old UI client method that creates a content-less slot.
- [ ] Remove the old public empty-slot request shape after the coordinated UI/API release boundary is ready.
- [ ] Keep internal createSlot composition for allocator/orchestration; do not create a second queue implementation.
- [ ] Verify no unused wrapper or bypass remains.

### Task 13: Impact-only regression and browser verification

**Files:**
- Modify tests only if an observed regression needs a fixture correction

- [ ] Run affected API tests: calendar repository/allocator, AI completion linkage, publish preparation, publish policy, cancel and authenticated calendar routes.
- [ ] Run affected customer UI tests: publishQueue, navigation, AI content slot-context continuation and API client transport.
- [ ] Run API and customer UI typecheck/build.
- [ ] Do not run unrelated DM, FAQ, crawl, wiki or worker suites.
- [ ] Start the real local stack and verify desktop/mobile flows in a browser: each source kind, batch validation, month loading, slot detail, cancel, delayed status and focus/keyboard behavior.
- [ ] Run spec-compliance and code-quality review on the exact diff.

### Task 14: Prepare release without deploying

**Files:**
- Modify release notes only if required

- [ ] Rebase/merge from the final operating main only after the other in-progress deployment completes.
- [ ] Confirm the current production SHA, API/UI revisions, DB migration state and deployed digests before creating the release PR.
- [ ] Ensure the diff contains only calendar, AI-generation linkage and affected tests/docs.
- [ ] Record rollback boundaries for API and UI; do not change unrelated workers.
- [ ] Stop before merge/deployment and request explicit deployment authorization.
