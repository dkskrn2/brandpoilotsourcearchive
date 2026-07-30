# Webflow Removal and Content Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Webflow를 런타임과 운영 DB에서 물리 삭제하고 콘텐츠 생성·검토·실패 상태를 분리한다.

**Architecture:** `channel_outputs.status`를 사용자 콘텐츠 생명주기의 원본으로 유지하되 `generating`과 `generation_failed`를 추가한다. `jobs.status`는 워커 실행과 재시도의 원본으로 유지하고, 워커 완료·최종 실패 트랜잭션에서 결과물 상태를 함께 전환한다. Webflow는 신규 마이그레이션에서 참조 데이터를 삭제한 후 모든 현재 채널 제약과 런타임 카탈로그에서 제거한다.

**Tech Stack:** PostgreSQL/Supabase, TypeScript, Fastify, React, Vitest, PGlite, npm workspaces

---

## File Map

- `db/migrations/035_remove_webflow_and_split_content_status.sql`: Webflow 물리 삭제, CHECK 제약 재정의, 기존 상태 변환
- `scripts/migrations.integration.test.mjs`: 035 마이그레이션 데이터 삭제·상태 변환 검증
- `scripts/repository-contract.test.mjs`: 마이그레이션 목록 및 채널 계약 검증
- `apps/api/src/channelCatalog.ts`: 지원 채널의 단일 런타임 카탈로그
- `apps/api/src/types.ts`: API 채널·delivery format·결과물 상태 계약
- `apps/api/src/instagramFormats.ts`: 채널별 delivery format 계약
- `apps/api/src/kakaoAuth.ts`: 신규 브랜드 기본 채널 생성
- `apps/api/src/contentPerformance.ts`: 성과 수집 지원 채널
- `apps/api/src/publishAdapters.ts`: 게시 어댑터 지원 채널
- `apps/api/src/repository.ts`: 콘텐츠 생성·검토·집계·워커 완료·실패 상태 전환
- `apps/customer-ui/src/types.ts`: 프론트 채널·상태 계약
- `apps/customer-ui/src/pages/ContentPage.tsx`: 생성·실패·검토 상태 UI
- `apps/customer-ui/src/pages/PublishQueuePage.tsx`: 채널 목록과 주제 그룹 상태 UI
- `apps/customer-ui/src/pages/DashboardPage.tsx`: 채널·성과 표시
- `apps/customer-ui/src/components/publish/TopicPublishGroup.tsx`: 채널·format 표시
- `apps/customer-ui/src/lib/apiClient.ts`: 채널 라벨 계약
- `apps/customer-ui/src/styles/prototype.css`: Webflow 전용 스타일 제거
- `docs/ARCHITECTURE.md`: 현재 지원 채널과 상태 생명주기
- `docs/specs/BRAND_PILOT_MANAGED_CONTENT_AUTOMATION_MVP.md`: 현재 제품 범위

### Task 1: Add the destructive migration contract

**Files:**
- Create: `db/migrations/035_remove_webflow_and_split_content_status.sql`
- Modify: `scripts/migrations.integration.test.mjs`
- Modify: `scripts/repository-contract.test.mjs`

- [ ] **Step 1: Write a failing migration integration test**

035 실행 전 Webflow 채널·출력·큐·성과 행과 pending 상태의 Instagram 출력을 삽입한다. 실행 후 아래를 검증한다.

```js
assert.equal(await scalar(db, "select count(*) from brand_channels where channel = 'webflow'"), 0);
assert.equal(await scalar(db, "select count(*) from channel_outputs where channel = 'webflow'"), 0);
assert.equal(await scalar(db, "select count(*) from publish_queue where channel = 'webflow'"), 0);
assert.equal(await scalar(db, "select count(*) from content_performance_snapshots where channel = 'webflow'"), 0);
assert.equal(await scalar(db, "select count(*) from performance_sync_runs where channel = 'webflow'"), 0);
assert.equal(await scalar(db, "select count(*) from channel_outputs where id = $1 and status = 'generating'", [instagramOutputId]), 1);
await assert.rejects(() => db.query("insert into brand_channels (...) values (..., 'webflow', ...)"));
```

- [ ] **Step 2: Run the migration test and verify RED**

Run: `npm run test:migrations`

Expected: FAIL because migration 035 and the new status constraint do not exist.

- [ ] **Step 3: Implement migration 035**

Delete Webflow rows in dependency order, then redefine constraints.

```sql
delete from content_performance_snapshots where channel = 'webflow';
delete from performance_sync_runs where channel = 'webflow';
delete from publish_attempts pa using publish_queue pq
where pa.publish_queue_id = pq.id and pq.channel = 'webflow';
delete from publish_queue where channel = 'webflow';
delete from publish_slots where channel = 'webflow';
delete from jobs where channel_output_id in (
  select id from channel_outputs where channel = 'webflow'
);
delete from channel_outputs where channel = 'webflow';
delete from channel_credentials cc using brand_channels bc
where cc.brand_channel_id = bc.id and bc.channel = 'webflow';
delete from brand_channels where channel = 'webflow';
```

Allowed channels become `instagram`, `threads`, `x`, `linkedin`, `youtube`, `tiktok`. Allowed credential providers become `meta`, `x`, `linkedin`, `google`, `tiktok`. Remove `webflow_article` from the delivery format constraint.

Add `generating` and `generation_failed` to `channel_outputs_status_check`, set the default to `generating`, and convert legacy pending rows:

```sql
update channel_outputs
set status = 'generating',
    block_reasons = coalesce((
      select jsonb_agg(reason)
      from jsonb_array_elements_text(block_reasons) reason
      where reason not like '%\_pending' escape '\'
    ), '[]'::jsonb),
    updated_at = now()
where status = 'auto_approval_blocked'
  and (
    output_json ->> 'generationState' = 'pending'
    or output_json ->> 'artifactStatus' = 'pending'
    or exists (
      select 1 from jsonb_array_elements_text(block_reasons) reason
      where reason like '%\_pending' escape '\'
    )
  );
```

- [ ] **Step 4: Update the migration contract list**

Add `035_remove_webflow_and_split_content_status.sql` after migration 034 in `scripts/repository-contract.test.mjs`.

- [ ] **Step 5: Run migration tests and verify GREEN**

Run: `npm run test:migrations && npm run test:contract`

Expected: all migration and repository contract tests pass.

- [ ] **Step 6: Commit Task 1**

```powershell
git add db/migrations/035_remove_webflow_and_split_content_status.sql scripts/migrations.integration.test.mjs scripts/repository-contract.test.mjs
git commit -m "db: remove Webflow and split content states"
```

### Task 2: Remove Webflow from runtime channel contracts

**Files:**
- Modify: `apps/api/src/channelCatalog.ts`
- Modify: `apps/api/src/channelCatalog.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/instagramFormats.ts`
- Modify: `apps/api/src/instagramFormats.test.ts`
- Modify: `apps/api/src/kakaoAuth.ts`
- Modify: `apps/api/src/kakaoAuth.test.ts`
- Modify: `apps/api/src/contentPerformance.ts`
- Modify: `apps/api/src/contentPerformance.test.ts`
- Modify: `apps/api/src/publishAdapters.ts`
- Modify: `apps/api/src/publishAdapters.test.ts`

- [ ] **Step 1: Change tests to require a Webflow-free catalog**

```ts
expect(channelNames).toEqual([
  "instagram", "threads", "x", "linkedin", "youtube", "tiktok"
]);
expect(channelCatalog.some((entry) => entry.channel === "webflow")).toBe(false);
expect(channelInsert).not.toContain("'webflow'");
```

Remove Webflow from performance and publish adapter parameterized tests.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test --workspace @brand-pilot/api -- --run src/channelCatalog.test.ts src/instagramFormats.test.ts src/kakaoAuth.test.ts src/contentPerformance.test.ts src/publishAdapters.test.ts
```

Expected: FAIL because Webflow is still in the source contracts.

- [ ] **Step 3: Remove Webflow from API source contracts**

Use these unions:

```ts
export type Channel = "instagram" | "threads" | "x" | "linkedin" | "youtube" | "tiktok";
export type OAuthProvider = "meta" | "x" | "linkedin" | "google" | "tiktok";
```

Remove `webflow_article`, the Webflow catalog entry, deferred performance adapter, publish adapter branch, and Kakao onboarding insert.

- [ ] **Step 4: Run focused tests and API typecheck**

Run:

```powershell
npm test --workspace @brand-pilot/api -- --run src/channelCatalog.test.ts src/instagramFormats.test.ts src/kakaoAuth.test.ts src/contentPerformance.test.ts src/publishAdapters.test.ts
npm run typecheck --workspace @brand-pilot/api
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 5: Commit Task 2**

```powershell
git add apps/api/src/channelCatalog.ts apps/api/src/channelCatalog.test.ts apps/api/src/types.ts apps/api/src/instagramFormats.ts apps/api/src/instagramFormats.test.ts apps/api/src/kakaoAuth.ts apps/api/src/kakaoAuth.test.ts apps/api/src/contentPerformance.ts apps/api/src/contentPerformance.test.ts apps/api/src/publishAdapters.ts apps/api/src/publishAdapters.test.ts
git commit -m "refactor: remove Webflow channel contracts"
```

### Task 3: Split content generation and review states

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/repository.regression-1.test.ts`
- Modify: `apps/api/src/repository.imageWorker.test.ts`
- Modify: `apps/api/src/repository.textWorker.test.ts`

- [ ] **Step 1: Write failing generation-state tests**

Change generation expectations from `auto_approval_blocked` to `generating`:

```ts
expect(insertedOutputStatuses).toEqual(["generating", "generating"]);
expect(insertedBlockReasons).toEqual([[], []]);
```

Add worker completion cases:

```ts
it.each([
  { outputStatus: "generating", autoApprovalEnabled: true, expectedStatus: "auto_approved" },
  { outputStatus: "generating", autoApprovalEnabled: false, expectedStatus: "pending_review" }
])("moves a completed generated output to the review lifecycle", ...);
```

- [ ] **Step 2: Run focused repository tests and verify RED**

Run:

```powershell
npm test --workspace @brand-pilot/api -- --run src/repository.test.ts src/repository.regression-1.test.ts src/repository.imageWorker.test.ts src/repository.textWorker.test.ts
```

Expected: FAIL on old `auto_approval_blocked` creation and transition assumptions.

- [ ] **Step 3: Implement the new output lifecycle**

Add API status types:

```ts
type ContentOutputStatus =
  | "generating"
  | "generation_failed"
  | "pending_review"
  | "auto_approval_blocked"
  | "approved"
  | "auto_approved"
  | "rejected"
  | "regenerating"
  | "regenerated";
```

In `generateContent`, create outputs with `status: "generating"` and `blockReasons: []`. Preserve `generationState: "pending"` in `output_json`.

In image and Threads completion, transition from `generating`:

```ts
const nextOutputStatus = outputStatus === "generating"
  ? row.auto_approval_enabled ? "auto_approved" : "pending_review"
  : outputStatus;
```

Use `outputStatus === "generating" && row.auto_approval_enabled` when deriving automatic approval and remove old pending block-reason subtraction.

- [ ] **Step 4: Restrict review actions by status**

- Approve: `pending_review`, `auto_approval_blocked`
- Regenerate: `pending_review`, `auto_approval_blocked`, `generation_failed`
- Reject: `pending_review`, `auto_approval_blocked`, `generation_failed`
- Never allow manual actions for `generating`, `regenerating`, `regenerated`

Add repository tests for `generation_failed` regeneration and rejection, and for approval rejection.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 3 focused test command.

Expected: all focused repository tests pass.

- [ ] **Step 6: Commit Task 3**

```powershell
git add apps/api/src/types.ts apps/api/src/repository.ts apps/api/src/repository.test.ts apps/api/src/repository.regression-1.test.ts apps/api/src/repository.imageWorker.test.ts apps/api/src/repository.textWorker.test.ts
git commit -m "feat: separate generation and review states"
```

### Task 4: Mark terminal worker failures on outputs

**Files:**
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.imageWorker.test.ts`
- Modify: `apps/api/src/repository.textWorker.test.ts`

- [ ] **Step 1: Write failing retry and terminal failure tests**

```ts
expect(retryableOutputUpdate).toBeUndefined();
expect(terminalOutputUpdate).toMatchObject({
  status: "generation_failed",
  blockReasons: ["generation_failed"]
});
```

Verify `output_json.generationError` contains `code`, truncated `message`, and ISO `failedAt`.

- [ ] **Step 2: Run focused worker repository tests and verify RED**

Run:

```powershell
npm test --workspace @brand-pilot/api -- --run src/repository.imageWorker.test.ts src/repository.textWorker.test.ts
```

Expected: FAIL because fail methods currently update only `jobs`.

- [ ] **Step 3: Update fail methods atomically**

Use a transaction or writable CTE that returns `channel_output_id` from the failed job. When retry remains available, leave the output as `generating`. When the next job status is `failed`, update the output:

```sql
update channel_outputs
set status = 'generation_failed',
    output_json = jsonb_set(
      output_json,
      '{generationError}',
      jsonb_build_object('code', $code, 'message', $message, 'failedAt', now()),
      true
    ),
    block_reasons = case
      when block_reasons ? 'generation_failed' then block_reasons
      else block_reasons || '["generation_failed"]'::jsonb
    end,
    updated_at = now()
where id = $channel_output_id;
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 4 focused command.

Expected: retry and terminal failure tests pass.

- [ ] **Step 5: Commit Task 4**

```powershell
git add apps/api/src/repository.ts apps/api/src/repository.imageWorker.test.ts apps/api/src/repository.textWorker.test.ts
git commit -m "fix: expose terminal content generation failures"
```

### Task 5: Update frontend state rendering and counts

**Files:**
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/pages/ContentPage.tsx`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/pages/DashboardPage.tsx`
- Modify: `apps/customer-ui/src/components/publish/TopicPublishGroup.tsx`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Modify: `apps/customer-ui/src/__tests__/content.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/dashboard.test.tsx`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.regression-1.test.ts`

- [ ] **Step 1: Write failing UI and aggregate tests**

```ts
expect(screen.getByText("생성 중")).toBeVisible();
expect(screen.queryByRole("button", { name: /^승인/ })).not.toBeInTheDocument();
expect(screen.getByText("생성 실패")).toBeVisible();
expect(screen.getByRole("button", { name: "재생성" })).toBeVisible();
expect(screen.queryByText("Webflow")).not.toBeInTheDocument();
```

Repository UI status test must require:

```sql
content_review_count: status in ('pending_review', 'auto_approval_blocked', 'generation_failed')
generating: status in ('generating', 'regenerating')
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test --workspace @brand-pilot/customer-ui -- --run src/__tests__/content.test.tsx src/__tests__/publishQueue.test.tsx src/__tests__/dashboard.test.tsx
npm test --workspace @brand-pilot/api -- --run src/repository.regression-1.test.ts
```

Expected: FAIL on missing states, Webflow labels, and old count queries.

- [ ] **Step 3: Implement frontend states and remove Webflow**

Use the full status union from Task 3. Add badge metadata:

```ts
generating: { label: "생성 중", variant: "info" },
generation_failed: { label: "생성 실패", variant: "bad" }
```

`generating` shows no review actions. `generation_failed` shows error information and only regenerate/reject. Keep the unknown-state fallback.

Remove Webflow from channel labels, channel ordering, format labels, dashboard rows, publish group labels, API labels, and `.is-webflow` CSS.

- [ ] **Step 4: Update API aggregates**

Separate review and generating counts in `getUiStatus` and dashboard workflow SQL. Exclude `regenerated` from active counts.

- [ ] **Step 5: Run focused tests, UI typecheck, and build**

Run:

```powershell
npm test --workspace @brand-pilot/customer-ui -- --run src/__tests__/content.test.tsx src/__tests__/publishQueue.test.tsx src/__tests__/dashboard.test.tsx
npm test --workspace @brand-pilot/api -- --run src/repository.regression-1.test.ts
npm run build --workspace @brand-pilot/customer-ui
```

Expected: all tests and build pass.

- [ ] **Step 6: Commit Task 5**

```powershell
git add apps/customer-ui/src apps/api/src/repository.ts apps/api/src/repository.regression-1.test.ts
git commit -m "feat: show content generation lifecycle"
```

### Task 6: Apply and verify the operating database migration

**Files:**
- Modify only through migration runner; do not hand-edit database rows

- [ ] **Step 1: Capture non-secret pre-migration counts**

Record counts grouped by channel and status for `brand_channels`, `channel_outputs`, `publish_queue`, `content_performance_snapshots`, and `performance_sync_runs`. Do not print credentials or row content.

- [ ] **Step 2: Apply migration 035**

Run: `npm run db:migrate`

Expected: `035_remove_webflow_and_split_content_status.sql` appears once in `schema_migrations`.

- [ ] **Step 3: Verify post-migration invariants**

Expected:

- Webflow rows: zero in every runtime table
- Current pending Instagram and Threads outputs: `generating`
- Current true auto-approval blocks: unchanged
- Non-Webflow published outputs and queue rows: unchanged
- Inserting Webflow into constrained runtime tables fails

### Task 7: Update active documentation and run final verification

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/specs/BRAND_PILOT_MANAGED_CONTENT_AUTOMATION_MVP.md`
- Modify: `README.md`

- [ ] **Step 1: Update current documentation**

Document supported channels as Instagram, Threads, X, LinkedIn, YouTube, and TikTok. Mark Webflow unsupported and removed. Add the new content output state table and worker transition rules.

- [ ] **Step 2: Scan runtime source for Webflow remnants**

Run:

```powershell
rg -n -i "webflow" apps workers db/migrations/035_remove_webflow_and_split_content_status.sql README.md docs/ARCHITECTURE.md docs/specs/BRAND_PILOT_MANAGED_CONTENT_AUTOMATION_MVP.md
```

Expected: only migration deletion clauses and explicit removal-history notes remain. No runtime source reference remains.

- [ ] **Step 3: Run complete verification**

Run:

```powershell
npm test --workspace @brand-pilot/api
npm test --workspace @brand-pilot/customer-ui
npm test --workspace @brand-pilot/image-worker
npm run build --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/customer-ui
npm run build --workspace @brand-pilot/image-worker
npm run test:migrations
npm run test:contract
git diff --check
```

Expected: all tests and builds pass with no whitespace errors.

- [ ] **Step 4: Verify the real local UI**

Open `http://localhost:5173/content`, `http://localhost:5173/publish-queue`, `http://localhost:5173/dashboard`, and `http://localhost:5173/channels`.

Expected:

- no Webflow UI
- no console errors
- generation items use `생성 중`
- failed items use `생성 실패`
- sidebar review count excludes generating items

- [ ] **Step 5: Commit documentation and residual contract updates**

```powershell
git add README.md docs/ARCHITECTURE.md docs/specs/BRAND_PILOT_MANAGED_CONTENT_AUTOMATION_MVP.md
git commit -m "docs: remove Webflow from active architecture"
```
