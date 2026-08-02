# FAQ Suggestion Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build an isolated FAQ suggestion lane that creates grounded FAQ proposals, restores review state, and activates only user-approved items in the existing FAQ store.

**Architecture:** Add faq_suggestion_runs and faq_suggestion_items as the queue and review source of truth. The customer API owns run creation and review actions; brand-pilot-dm-worker gains a dedicated faq mode that claims runs directly from PostgreSQL, executes a strict CLI contract, and stores validated proposals. Approved items are inserted into knowledge_entries without triggering a Wiki build, so the existing exact FAQ path can use them immediately.

**Tech Stack:** PostgreSQL migrations, Fastify, TypeScript, Vitest, PGlite, React, Vite, existing Codex CLI worker runtime.

---

## File map

### Create

- db/migrations/072_faq_suggestion_worker.sql: run/item tables and worker constraints.
- apps/api/src/faqSuggestionContracts.ts: API DTOs and mutation parsers.
- apps/api/src/faqSuggestionContracts.test.ts: contract tests.
- apps/api/src/faqSuggestionRepository.ts: create/read/edit/approve/dismiss persistence.
- apps/api/src/faqSuggestionRepository.pglite.test.ts: persistence and tenant tests.
- apps/api/src/server.faqSuggestionsCustomer.test.ts: customer route tests.
- workers/brand-pilot-dm-worker/src/faqSuggestionContracts.ts: CLI result contract.
- workers/brand-pilot-dm-worker/src/faqSuggestionContracts.test.ts: strict validation tests.
- workers/brand-pilot-dm-worker/src/faqSuggestionWorker.ts: one-cycle FAQ worker.
- workers/brand-pilot-dm-worker/src/faqSuggestionWorker.test.ts: worker tests.
- workers/brand-pilot-dm-worker/src/faqSuggestionDb.test.ts: lease and retry tests.

### Modify

- apps/api/src/types.ts and apps/api/src/repository.ts: compose the focused repository.
- apps/api/src/brandCenterHttp.ts and apps/api/src/httpServer.ts: customer endpoints and error mapping.
- apps/api/src/workerResources.ts and related tests: add faq workload.
- workers/brand-pilot-dm-worker/src/db.ts: FAQ run leases and source loading.
- workers/brand-pilot-dm-worker/src/workerMode.ts and tests: dedicated faq mode.
- workers/brand-pilot-dm-worker/src/resourceLease.ts: faq resource workload.
- workers/brand-pilot-dm-worker/src/index.ts and package scripts: select the FAQ lane.
- apps/customer-ui/src/features/libraries/libraryGateway.ts and tests: API client methods.
- apps/customer-ui/src/components/brand-center/FaqSuggestionPreviewPanel.tsx and tests: real server state.
- apps/customer-ui/src/components/brand-center/KnowledgeCategoryEditorPanel.tsx: refresh FAQ list after approval.
- apps/customer-ui/src/__tests__/brandCenter.test.tsx: integrated regression.

## Task 0: Preserve the approved UI and sync the latest base

**Files:**
- Commit the already reviewed customer UI files.
- Do not edit backend implementation files.

- [x] **Step 1: Re-run the approved UI tests**

Run:

~~~powershell
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/dmAutomation.test.tsx src/__tests__/channels.test.tsx src/components/brand-center/FaqSuggestionPreviewPanel.test.tsx src/components/brand-center/AutoResponseKnowledgePanel.test.tsx src/__tests__/brandCenter.test.tsx src/__tests__/brandCenterVisualContracts.test.ts
~~~

Expected: every selected test file passes.

- [x] **Step 2: Inspect and commit only the approved UI**

Run:

~~~powershell
git diff --check
git status --short
git add -- apps/customer-ui/src/__tests__/brandCenter.test.tsx apps/customer-ui/src/__tests__/brandCenterVisualContracts.test.ts apps/customer-ui/src/__tests__/channels.test.tsx apps/customer-ui/src/__tests__/dmAutomation.test.tsx apps/customer-ui/src/components/brand-center/AutoResponseKnowledgePanel.tsx apps/customer-ui/src/components/brand-center/AutoResponseKnowledgePanel.test.tsx apps/customer-ui/src/components/brand-center/FaqSuggestionPreviewPanel.tsx apps/customer-ui/src/components/brand-center/FaqSuggestionPreviewPanel.test.tsx apps/customer-ui/src/components/brand-center/KnowledgeCategoryEditorPanel.tsx apps/customer-ui/src/pages/ChannelsPage.tsx apps/customer-ui/src/pages/DmAutomationPage.tsx apps/customer-ui/src/styles/brand-center.css apps/customer-ui/src/styles/prototype.css docs/superpowers/plans/2026-08-01-instagram-dm-faq-llm-ui-preview.md
git commit -m "feat(customer-ui): preview FAQ and LLM controls"
~~~

Expected: the approved UI is one local commit and no backend file is staged.

- [x] **Step 3: Rebase onto the latest remote main**

Run:

~~~powershell
git fetch origin
git rebase origin/main
~~~

Expected: the documentation and UI commits replay cleanly. If Git reports a conflict, stop before editing and inspect the exact conflicted files; do not use reset, checkout, or an old source copy.

- [x] **Step 4: Verify the rebased baseline**

Run:

~~~powershell
git status --short --branch
npm test --workspace @brand-pilot/customer-ui -- src/components/brand-center/FaqSuggestionPreviewPanel.test.tsx src/__tests__/dmAutomation.test.tsx src/__tests__/channels.test.tsx
~~~

Expected: the branch is based on origin/main and selected UI tests pass.

## Task 1: Add the FAQ schema and API contracts

**Files:**
- Create db/migrations/072_faq_suggestion_worker.sql.
- Create apps/api/src/faqSuggestionContracts.ts.
- Create apps/api/src/faqSuggestionContracts.test.ts.

- [x] **Step 1: Write failing contract tests**

~~~typescript
it("accepts a complete review edit", () => {
  expect(parseFaqSuggestionItemUpdate({
    category: "product",
    question: "제품은 어떻게 구매하나요?",
    answer: "공식 온라인 스토어에서 구매할 수 있습니다.",
    expectedUpdatedAt: "2026-08-02T00:00:00.000Z",
  })).toEqual({
    category: "product",
    question: "제품은 어떻게 구매하나요?",
    answer: "공식 온라인 스토어에서 구매할 수 있습니다.",
    expectedUpdatedAt: "2026-08-02T00:00:00.000Z",
  });
});

it("requires optimistic concurrency", () => {
  expect(() => parseFaqSuggestionReviewAction({}))
    .toThrow("faq_suggestion_validation_failed:expectedUpdatedAt");
});
~~~

Also reject unknown categories, question over 500 characters, answer over 2,000 characters, invalid timestamps, arrays, and unknown root fields.

- [x] **Step 2: Run tests to verify RED**

~~~powershell
npm test --workspace @brand-pilot/api -- src/faqSuggestionContracts.test.ts
~~~

Expected: FAIL because the module is missing.

- [x] **Step 3: Implement strict DTOs and parsers**

~~~typescript
export const faqSuggestionCategories = [
  "service", "product", "price_payment", "location_visit", "hours",
  "shipping", "exchange_refund", "reservation_usage", "account_membership", "other",
] as const;

export type FaqSuggestionCategory = typeof faqSuggestionCategories[number];
export type FaqSuggestionRunStatus =
  | "queued" | "running" | "review_ready" | "partial" | "failed" | "completed";
export type FaqSuggestionItemStatus =
  | "review" | "approved" | "dismissed" | "duplicate";

export interface FaqSuggestionEvidenceDto {
  sourceType: "brand_core" | "product_service" | "owned_snapshot" | "document" | "faq";
  sourceId: string;
  label: string;
}

export interface FaqSuggestionItemUpdate {
  category: FaqSuggestionCategory;
  question: string;
  answer: string;
  expectedUpdatedAt: string;
}
~~~

Implement parseFaqSuggestionItemUpdate and parseFaqSuggestionReviewAction with exact field allowlists.

- [x] **Step 4: Add migration 072**

Create faq_suggestion_runs with:
- composite workspace/brand ownership
- statuses queued, running, review_ready, partial, failed, completed
- input fingerprint and source snapshot JSON
- attempt count, available time, lease owner/token/expiry
- actor, start, completion, create, update timestamps
- one queued/running run per workspace and brand
- claim index for queued/running rows
- lease consistency constraint

Create faq_suggestion_items with:
- composite run ownership
- position, category, question, answer, evidence JSON, confidence
- statuses review, approved, dismissed, duplicate
- duplicate and approved knowledge entry references
- reviewer and review timestamp
- question 1–500, answer 1–2,000, evidence 1–5, confidence 0–1
- unique run/position

Extend constraints exactly:

~~~sql
alter table worker_instances drop constraint if exists worker_instances_type_check;
alter table worker_instances add constraint worker_instances_type_check
  check (worker_type in ('image','dm','faq'));

alter table worker_resource_leases drop constraint if exists worker_resource_leases_workload_check;
alter table worker_resource_leases add constraint worker_resource_leases_workload_check
  check (workload_type in ('dm','wiki','content','onboarding','faq'));
~~~

Add set_updated_at triggers for both tables.

- [x] **Step 5: Verify and commit**

~~~powershell
npm test --workspace @brand-pilot/api -- src/faqSuggestionContracts.test.ts
npm run test:migrations
git add -- db/migrations/072_faq_suggestion_worker.sql apps/api/src/faqSuggestionContracts.ts apps/api/src/faqSuggestionContracts.test.ts scripts/migrations.integration.test.mjs
git commit -m "feat(api): define FAQ suggestion contracts"
~~~

Expected: tests pass and only Task 1 files are committed.

## Task 2: Implement the customer FAQ repository

**Files:**
- Create apps/api/src/faqSuggestionRepository.ts.
- Create apps/api/src/faqSuggestionRepository.pglite.test.ts.
- Modify apps/api/src/types.ts.
- Modify apps/api/src/repository.ts.

- [x] **Step 1: Write failing PGlite tests**

~~~typescript
it("reuses the active run", async () => {
  const first = await repository.createFaqSuggestionRun({ workspaceId, brandId, actorUserId });
  const second = await repository.createFaqSuggestionRun({ workspaceId, brandId, actorUserId });
  expect(second.run.id).toBe(first.run.id);
  expect(second.created).toBe(false);
});

it("keeps review items out of knowledge_entries", async () => {
  await repository.updateFaqSuggestionItem({
    workspaceId, brandId, actorUserId, runId, itemId,
    category: "shipping",
    question: "배송은 언제 시작하나요?",
    answer: "결제 후 안내된 일정에 발송합니다.",
    expectedUpdatedAt,
  });
  const rows = await database.query(
    "select id from knowledge_entries where provenance_json->>'source' = 'faq_suggestion'",
  );
  expect(rows.rowCount).toBe(0);
});

it("approves edited text without a Wiki build", async () => {
  const approved = await repository.approveFaqSuggestionItem({
    workspaceId, brandId, actorUserId, runId, itemId, expectedUpdatedAt,
  });
  expect(approved.item.status).toBe("approved");
  const builds = await database.query(
    "select id from wiki_build_requests where brand_id = $1", [brandId],
  );
  expect(builds.rowCount).toBe(0);
});
~~~

Also test two workspaces, source-less brands, optimistic conflict, duplicate normalized question, idempotent approve/dismiss, and run completion when all items are terminal.

- [x] **Step 2: Run tests to verify RED**

~~~powershell
npm test --workspace @brand-pilot/api -- src/faqSuggestionRepository.pglite.test.ts
~~~

Expected: FAIL because the repository does not exist.

- [x] **Step 3: Define and compose the repository**

~~~typescript
export interface FaqSuggestionRepository {
  createFaqSuggestionRun(input: BrandActorScope):
    Promise<{ run: FaqSuggestionRunDto; created: boolean }>;
  getLatestFaqSuggestionRun(input: BrandScope):
    Promise<FaqSuggestionRunDto | null>;
  getFaqSuggestionRun(input: BrandScope & { runId: string }):
    Promise<FaqSuggestionRunDto | null>;
  updateFaqSuggestionItem(input: BrandActorScope & {
    runId: string; itemId: string;
  } & FaqSuggestionItemUpdate): Promise<FaqSuggestionItemDto>;
  approveFaqSuggestionItem(input: BrandActorScope & {
    runId: string; itemId: string;
  } & FaqSuggestionReviewAction): Promise<{
    item: FaqSuggestionItemDto;
    wikiItem: WikiManagementItem | null;
  }>;
  dismissFaqSuggestionItem(input: BrandActorScope & {
    runId: string; itemId: string;
  } & FaqSuggestionReviewAction): Promise<FaqSuggestionItemDto>;
}
~~~

Extend ApiRepository with Partial<FaqSuggestionRepository>, instantiate createFaqSuggestionRepository(pool), and spread it into createRepository.

- [x] **Step 4: Implement input snapshots**

Within one transaction:
1. validate active workspace membership and brand ownership
2. read the approved brand_core_versions row
3. read active approved product_service_versions
4. read the latest succeeded enabled owned source_snapshots with non-empty extracted text
5. read active compiled wiki_source_units for processed policy/guide/document sources, excluding duplicate owned snapshots
6. read active FAQ knowledge_entries
7. sort descriptors by source type and ID
8. hash each canonical payload and then the complete descriptor list with SHA-256
9. reject an empty list with faq_suggestion_sources_missing
10. insert a run or return the current queued/running run on partial unique conflict

Store descriptors and hashes, not full source content, in source_snapshot_json.

- [x] **Step 5: Implement review actions**

Normalize questions with NFKC, whitespace collapse, trim, and Korean lowercase. Approval must lock run and item, enforce expectedUpdatedAt, check all existing FAQ normalized questions, and either:
- mark the item duplicate with the existing FAQ ID, or
- insert an active knowledge_entries FAQ using the edited text

The insert uses origin manual, status active, enabled true, direct_reply_enabled true, approval actor, and:

~~~json
{
  "source": "faq_suggestion",
  "runId": "uuid",
  "itemId": "uuid",
  "evidence": []
}
~~~

Do not call enqueueImmediateWikiBuild and do not insert wiki_build_requests or wiki_refresh_outbox.

- [x] **Step 6: Verify and commit**

~~~powershell
npm test --workspace @brand-pilot/api -- src/faqSuggestionRepository.pglite.test.ts src/repository.dmWiki.pglite.test.ts src/libraryTrustBoundary.test.ts
git add -- apps/api/src/faqSuggestionRepository.ts apps/api/src/faqSuggestionRepository.pglite.test.ts apps/api/src/types.ts apps/api/src/repository.ts
git commit -m "feat(api): persist FAQ suggestion reviews"
~~~

Expected: all focused tests pass.

## Task 3: Add authenticated customer endpoints

**Files:**
- Create apps/api/src/server.faqSuggestionsCustomer.test.ts.
- Modify apps/api/src/brandCenterHttp.ts.
- Modify apps/api/src/httpServer.ts.

- [x] **Step 1: Write failing route tests**

Cover:

~~~text
POST  /brands/:brandId/faq-suggestions
GET   /brands/:brandId/faq-suggestions/latest
GET   /brands/:brandId/faq-suggestions/:runId
PATCH /brands/:brandId/faq-suggestions/:runId/items/:itemId
POST  /brands/:brandId/faq-suggestions/:runId/items/:itemId/approve
POST  /brands/:brandId/faq-suggestions/:runId/items/:itemId/dismiss
~~~

Assert workspaceId, brandId, actorUserId, 202 for new runs, 200 for reused runs, a null latest run, 404 for inaccessible rows, 409 for source missing/conflict, and 403 for approval rejection.

- [x] **Step 2: Verify RED**

~~~powershell
npm test --workspace @brand-pilot/api -- src/server.faqSuggestionsCustomer.test.ts
~~~

Expected: FAIL with route not found.

- [x] **Step 3: Register routes and error mapping**

Use requireActor for create, edit, approve, and dismiss. Parse every mutation body before repository calls.

Return:
- create: status 202 or 200 plus { run }
- reads: { run }
- approve: { item, wikiItem }
- edit/dismiss: { item }

Map:
- faq_suggestion_sources_missing and faq_suggestion_item_conflict to 409
- run/item not found to 404
- access/approval forbidden to 403
- validation failures to 400

- [x] **Step 4: Verify and commit**

~~~powershell
npm test --workspace @brand-pilot/api -- src/server.faqSuggestionsCustomer.test.ts src/server.wikiManagementCustomer.test.ts
git add -- apps/api/src/server.faqSuggestionsCustomer.test.ts apps/api/src/brandCenterHttp.ts apps/api/src/httpServer.ts
git commit -m "feat(api): expose FAQ suggestion endpoints"
~~~

Expected: both suites pass.

## Task 4: Implement strict worker contracts and DB leases

**Files:**
- Create workers/brand-pilot-dm-worker/src/faqSuggestionContracts.ts.
- Create workers/brand-pilot-dm-worker/src/faqSuggestionContracts.test.ts.
- Create workers/brand-pilot-dm-worker/src/faqSuggestionDb.test.ts.
- Modify workers/brand-pilot-dm-worker/src/db.ts.

- [x] **Step 1: Write failing contract tests**

~~~typescript
expect(() => validateFaqSuggestionResult(
  { contractVersion: "wrong", suggestions: [] }, input,
)).toThrow("faq_suggestion_result_contract_invalid");

expect(() => validateFaqSuggestionResult(
  resultWithUnknownSource, input,
)).toThrow("faq_suggestion_evidence_not_provided");

expect(() => validateFaqSuggestionResult(
  resultWithRawUrl, input,
)).toThrow("faq_suggestion_answer_url_forbidden");

expect(() => validateFaqSuggestionResult(
  resultWith21Items, input,
)).toThrow("faq_suggestion_limit_exceeded");
~~~

Also reject unknown fields, invalid categories, empty evidence, invalid confidence, and duplicate evidence IDs after normalization.

- [x] **Step 2: Verify RED**

~~~powershell
npm test --workspace @brand-pilot/dm-worker -- src/faqSuggestionContracts.test.ts
~~~

Expected: FAIL because the module is missing.

- [x] **Step 3: Implement worker contracts**

Define faq-suggestion-input.v1 and faq-suggestion-result.v1. validateFaqSuggestionResult returns sanitized values, accepts 1–20 suggestions, accepts 1–5 evidence entries, and allows only source type/ID pairs supplied in the input.

Return both valid suggestions and rejected item codes so mixed results can become partial. A top-level contract error or a result with zero valid suggestions fails the whole run. An individual invalid source ID, category, length, or evidence list rejects only that item when at least one other item is valid.

- [x] **Step 4: Write failing DB tests**

Assert:
- claim uses for update skip locked
- expired running leases are reclaimable
- source reload uses workspace and brand
- changed content hash fails before CLI
- heartbeat requires worker ID and lease token
- completion inserts items and clears the lease atomically
- retry delays are 5, 30, and 120 seconds
- attempt exhaustion ends in failed
- worker heartbeat uses worker_type faq

- [x] **Step 5: Verify RED**

~~~powershell
npm test --workspace @brand-pilot/dm-worker -- src/faqSuggestionDb.test.ts
~~~

Expected: FAIL because FAQ DB methods are missing.

- [x] **Step 6: Implement DB methods**

~~~typescript
claimFaqSuggestionRun(workerId: string): Promise<FaqSuggestionWorkerInput | null>;
heartbeatFaqSuggestionRun(
  runId: string, workerId: string, leaseToken: string,
): Promise<void>;
completeFaqSuggestionRun(
  runId: string, workerId: string, leaseToken: string,
  result: FaqSuggestionWorkerResult,
): Promise<void>;
failFaqSuggestionRun(
  runId: string, workerId: string, leaseToken: string,
  errorCode: string, retryable: boolean,
): Promise<void>;
heartbeatFaqSuggestionWorker(workerId: string): Promise<void>;
~~~

Claim increments attempt_count, assigns a 60-second lease, reloads frozen sources, verifies hashes, and returns the CLI input. Completion requires run ID, worker ID, and lease token. Partial status is used only when at least one item is valid.

- [x] **Step 7: Verify and commit**

~~~powershell
npm test --workspace @brand-pilot/dm-worker -- src/faqSuggestionContracts.test.ts src/faqSuggestionDb.test.ts src/db.transaction.test.ts
git add -- workers/brand-pilot-dm-worker/src/faqSuggestionContracts.ts workers/brand-pilot-dm-worker/src/faqSuggestionContracts.test.ts workers/brand-pilot-dm-worker/src/faqSuggestionDb.test.ts workers/brand-pilot-dm-worker/src/db.ts
git commit -m "feat(dm-worker): add FAQ suggestion leases"
~~~

Expected: focused tests pass.

## Task 5: Add the isolated FAQ CLI lane

**Files:**
- Create workers/brand-pilot-dm-worker/src/faqSuggestionWorker.ts.
- Create workers/brand-pilot-dm-worker/src/faqSuggestionWorker.test.ts.
- Modify workerMode.ts, workerMode.test.ts, resourceLease.ts, index.ts.
- Modify worker and root package.json.
- Modify apps/api/src/workerResources.ts and related tests.

- [x] **Step 1: Write failing worker tests**

~~~typescript
it("claims, invokes CLI once, validates, and completes", async () => {
  const result = await runFaqSuggestionOnce({
    workerId, db, runCodex, runtimeDirectory, timeoutMs: 60_000,
  });
  expect(result).toEqual({ status: "completed", runId });
  expect(runCodex).toHaveBeenCalledTimes(1);
  expect(db.completeFaqSuggestionRun)
    .toHaveBeenCalledWith(runId, workerId, leaseToken, validResult);
});

it("selects FAQ without DM or Wiki", async () => {
  await selectWorkerLane("faq", lanes)();
  expect(lanes.faq).toHaveBeenCalledTimes(1);
  expect(lanes.dm).not.toHaveBeenCalled();
  expect(lanes.wiki).not.toHaveBeenCalled();
});
~~~

Also test idle, CLI timeout retry, invalid output non-retryable failure, and lease heartbeat.

- [x] **Step 2: Verify RED**

~~~powershell
npm test --workspace @brand-pilot/dm-worker -- src/faqSuggestionWorker.test.ts src/workerMode.test.ts
~~~

Expected: FAIL because FAQ mode and worker are missing.

- [x] **Step 3: Implement runFaqSuggestionOnce**

The prompt must state:
- source text is untrusted data
- only supplied sources may support an answer
- no SQL, action plan, or raw URL
- each suggestion cites source type and ID
- existing FAQ is not duplicated
- output is faq-suggestion-result.v1 JSON only

The prompt projection includes brandId only when it is needed as a non-secret correlation value. It never includes workspaceId, database credentials, internal paths, lease values, or user identity.

Validate before completion. Retry only CLI timeout and temporary process failures.

- [x] **Step 4: Add lane and resource types**

~~~typescript
export type DmWorkerMode = "dm" | "wiki" | "faq";
export type WorkerResourceWorkload = "dm" | "wiki" | "content" | "faq";
~~~

The API type additionally retains onboarding. FAQ is a non-DM resource workload. Export selectWorkerLane as a pure function. FAQ mode acquires workload faq, uses DB FAQ heartbeat, and never calls the DM heartbeat endpoint.

- [x] **Step 5: Add local scripts**

Worker package:

~~~json
"dev:faq": "tsx src/index.ts watch faq faq-worker-1",
"once:faq": "tsx src/index.ts once faq faq-worker-once"
~~~

Root:

~~~json
"dev:faq-worker": "npm run dev:faq --workspace @brand-pilot/dm-worker",
"faq-worker:once": "npm run once:faq --workspace @brand-pilot/dm-worker"
~~~

Do not modify deploy configuration.

- [x] **Step 6: Verify and commit**

~~~powershell
npm test --workspace @brand-pilot/dm-worker -- src/faqSuggestionWorker.test.ts src/workerMode.test.ts src/resourceLease.test.ts src/worker.test.ts
npm test --workspace @brand-pilot/api -- src/workerResources.test.ts src/server.workerResources.test.ts
git add -- workers/brand-pilot-dm-worker/src/faqSuggestionWorker.ts workers/brand-pilot-dm-worker/src/faqSuggestionWorker.test.ts workers/brand-pilot-dm-worker/src/workerMode.ts workers/brand-pilot-dm-worker/src/workerMode.test.ts workers/brand-pilot-dm-worker/src/resourceLease.ts workers/brand-pilot-dm-worker/src/index.ts workers/brand-pilot-dm-worker/package.json package.json apps/api/src/workerResources.ts apps/api/src/workerResources.test.ts apps/api/src/server.workerResources.test.ts
git commit -m "feat(dm-worker): run isolated FAQ suggestion lane"
~~~

Expected: worker and resource tests pass.

## Task 6: Add the customer UI gateway

**Files:**
- Modify apps/customer-ui/src/features/libraries/libraryGateway.ts.
- Modify apps/customer-ui/src/features/libraries/libraryGateway.test.ts.

- [x] **Step 1: Write failing gateway tests**

Call and assert method, path, and body for:
- createFaqSuggestionRun
- getLatestFaqSuggestionRun
- getFaqSuggestionRun
- updateFaqSuggestionItem
- approveFaqSuggestionItem
- dismissFaqSuggestionItem

- [x] **Step 2: Verify RED**

~~~powershell
npm test --workspace @brand-pilot/customer-ui -- src/features/libraries/libraryGateway.test.ts
~~~

Expected: FAIL because methods are missing.

- [x] **Step 3: Add DTOs and methods**

Mirror the API unions exactly. The update method sends category, question, answer, expectedUpdatedAt. Approve/dismiss send expectedUpdatedAt only.

- [x] **Step 4: Verify and commit**

~~~powershell
npm test --workspace @brand-pilot/customer-ui -- src/features/libraries/libraryGateway.test.ts
git add -- apps/customer-ui/src/features/libraries/libraryGateway.ts apps/customer-ui/src/features/libraries/libraryGateway.test.ts
git commit -m "feat(customer-ui): add FAQ suggestion gateway"
~~~

Expected: PASS.

## Task 7: Replace the preview with real server state

**Files:**
- Modify FaqSuggestionPreviewPanel.tsx and its test.
- Modify KnowledgeCategoryEditorPanel.tsx.
- Modify apps/customer-ui/src/__tests__/brandCenter.test.tsx.

- [x] **Step 1: Write failing component behavior tests**

~~~typescript
it("restores the latest review run", async () => {
  render(
    <FaqSuggestionPreviewPanel
      brandId="brand-1"
      gateway={gateway}
      onApproved={onApproved}
    />,
  );
  expect(await screen.findByDisplayValue("제품은 어떻게 구매하나요?"))
    .toBeVisible();
  expect(gateway.getLatestFaqSuggestionRun)
    .toHaveBeenCalledWith("brand-1");
});

it("polls only while queued or running", async () => {
  vi.useFakeTimers();
  gateway.getLatestFaqSuggestionRun
    .mockResolvedValueOnce({ run: runningRun });
  gateway.getFaqSuggestionRun
    .mockResolvedValueOnce({ run: reviewReadyRun });
  renderPanel();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(gateway.getFaqSuggestionRun).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
~~~

Also test edit-before-approve, dismiss, source missing, partial, failed, duplicate, optimistic conflict reload, polling cleanup, and disabled buttons.

- [x] **Step 2: Verify RED**

~~~powershell
npm test --workspace @brand-pilot/customer-ui -- src/components/brand-center/FaqSuggestionPreviewPanel.test.tsx
~~~

Expected: FAIL because the component still uses local fixtures.

- [x] **Step 3: Implement server state without changing approved layout**

Props:

~~~typescript
interface FaqSuggestionPanelProps {
  brandId: string;
  gateway?: Pick<typeof libraryGateway,
    | "createFaqSuggestionRun"
    | "getLatestFaqSuggestionRun"
    | "getFaqSuggestionRun"
    | "updateFaqSuggestionItem"
    | "approveFaqSuggestionItem"
    | "dismissFaqSuggestionItem">;
  onApproved(): void;
}
~~~

Use a draft map keyed by item ID for immediate textarea editing. Persist the full edited item with expectedUpdatedAt before approval. Poll every 2 seconds only for queued/running and stop on terminal state or unmount. Replace the preview-only notice with server status messages.

- [x] **Step 4: Refresh the existing FAQ list after approval**

Pass a refresh callback/key from KnowledgeCategoryEditorPanel to WikiLibraryPanel. Do not remount the entire Brand Center page or discard unsaved manual edits.

- [x] **Step 5: Verify and commit**

~~~powershell
npm test --workspace @brand-pilot/customer-ui -- src/components/brand-center/FaqSuggestionPreviewPanel.test.tsx src/features/libraries/libraryGateway.test.ts src/__tests__/brandCenter.test.tsx src/__tests__/brandCenterVisualContracts.test.ts
git add -- apps/customer-ui/src/components/brand-center/FaqSuggestionPreviewPanel.tsx apps/customer-ui/src/components/brand-center/FaqSuggestionPreviewPanel.test.tsx apps/customer-ui/src/components/brand-center/KnowledgeCategoryEditorPanel.tsx apps/customer-ui/src/__tests__/brandCenter.test.tsx
git commit -m "feat(customer-ui): connect FAQ suggestion reviews"
~~~

Expected: component and Brand Center tests pass.

## Task 8: Full regression and local verification

**Files:**
- Change only files required by failures caused by Tasks 1–7.
- Update this plan's checkboxes during execution.

- [x] **Step 1: Run focused suites**

~~~powershell
npm test --workspace @brand-pilot/api -- src/faqSuggestionContracts.test.ts src/faqSuggestionRepository.pglite.test.ts src/server.faqSuggestionsCustomer.test.ts src/server.wikiManagementCustomer.test.ts src/repository.dmWiki.pglite.test.ts src/repository.dmWebhook.test.ts src/repository.dmOperations.test.ts
npm test --workspace @brand-pilot/dm-worker -- src/faqSuggestionContracts.test.ts src/faqSuggestionDb.test.ts src/faqSuggestionWorker.test.ts src/workerMode.test.ts src/worker.test.ts
npm test --workspace @brand-pilot/customer-ui -- src/components/brand-center/FaqSuggestionPreviewPanel.test.tsx src/features/libraries/libraryGateway.test.ts src/__tests__/brandCenter.test.tsx src/__tests__/dmAutomation.test.tsx src/__tests__/channels.test.tsx
~~~

Expected: PASS.

- [x] **Step 2: Run full verification**

The root aggregate test command exceeded its 10-minute process limit after the API suite. Each workspace was then run independently with sufficient time: 3,125 tests passed and 31 were skipped, with no failures. The full build, 47 contract tests, and 54 migration integration tests exited 0.

~~~powershell
npm test
npm run build
npm run test:contract
npm run test:migrations
~~~

Expected: every command exits 0.

- [ ] **Step 3: Verify the local UI flow**

Blocked for live browser execution because the local API at `localhost:4000` was unavailable. The latest UI was served separately from this worktree and reached the authentication gate. The create/restore/poll/edit/dismiss/approve/list-refresh flow is covered by component and PGlite integration tests; no real DM or operating database was used.

Using local non-production services:
1. create an FAQ run
2. reload the page and confirm state restoration
3. edit one proposal
4. dismiss one proposal
5. approve one proposal
6. confirm the approved FAQ appears in the existing list
7. confirm no wiki_build_requests row was created
8. open the DM page and verify manual reply UI without sending a real DM

- [x] **Step 4: Check local DB invariants**

Verified against the isolated PGlite integration database: review edits create no `knowledge_entries`; approval creates one active, enabled, direct-reply FAQ with `faq_suggestion` provenance; dismissals and duplicates create none; approval creates no `wiki_build_requests` or `wiki_refresh_outbox` row.

~~~sql
select status, count(*) from faq_suggestion_runs group by status;
select status, count(*) from faq_suggestion_items group by status;
select id, status, enabled, direct_reply_enabled, provenance_json
from knowledge_entries
where provenance_json->>'source' = 'faq_suggestion';
~~~

Expected: only approved proposals exist in knowledge_entries.

- [x] **Step 5: Confirm deployment scope stayed untouched**

~~~powershell
git diff --check
git status --short --branch
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- deploy render.yaml docker-compose.yml
~~~

Expected: no deployment file change, push, or operating DB action.

- [x] **Step 6: Record verification**

~~~powershell
git add -- docs/superpowers/plans/2026-08-02-faq-suggestion-worker.md
git commit -m "docs: record FAQ suggestion verification"
~~~

## Implementation boundaries

- Do not call PG MCP from runtime.
- Do not modify the onboarding worker package.
- Do not change find_direct_faq_exact or semantic matching thresholds.
- Do not enable LLM replies or create a Wiki build from FAQ approval.
- Do not send a real Instagram DM during verification.
- Do not push, create a PR, merge, deploy, or run an operating DB migration without a new explicit user request.
