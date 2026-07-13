# Pre-LLM Publish Waiting Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show crawled source items in publish management as pre-LLM "대기" rows, then process one waiting row at a time into channel-specific outputs and publish queues.

**Architecture:** Use `content_topics.status = 'selected'` as the durable pre-LLM waiting queue. Crawling creates one selected topic per new source content snapshot. `generateContent()` locks one selected topic, generates its master draft, creates channel outputs for connected channels, and auto-approved channels move directly into `publish_queue`.

**Tech Stack:** TypeScript, Fastify repository layer, PostgreSQL, React, Vitest.

---

### Task 1: Source Crawl Enqueues Waiting Content

**Files:**
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/repository.ts`

- [ ] **Step 1: Write the failing repository test**

Add an assertion to the existing crawl test that a newly inserted source snapshot creates a `content_topics` row with:

```ts
expect(query).toHaveBeenCalledWith(expect.stringContaining("insert into content_topics"), expect.any(Array));
```

The inserted row must use `status = 'selected'` and `source_context` containing `source`, `sourceContentItemId`, `sourceSnapshotId`, `contentUrl`, and `contentHash`.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- repository.test.ts`

Expected: the crawl test fails because crawl currently inserts snapshots but does not enqueue `content_topics`.

- [ ] **Step 3: Implement enqueue helper**

In `apps/api/src/repository.ts`, add a local helper near the crawl code:

```ts
async function enqueueSourceContentTopic(clientOrPool, row) {
  // insert content_topics selected unless a selected/generating/generated topic already exists
}
```

Use SQL `not exists` on `content_topics.source_context` with matching source content item and content hash.

- [ ] **Step 4: Call helper after snapshot insert**

After inserting a new succeeded `source_snapshots` row, call the helper with the returned snapshot id and content metadata.

- [ ] **Step 5: Verify**

Run: `npm test -- repository.test.ts`

Expected: repository tests pass.

### Task 2: Generation Consumes Selected Content Topics

**Files:**
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/repository.ts`

- [ ] **Step 1: Write failing tests**

Update generation tests so `generateContent()` selects from `content_topics where status = 'selected' for update skip locked` before falling back to nothing. Tests must cover:

```ts
expect(query).toHaveBeenCalledWith(expect.stringContaining("from content_topics ct"), ["brand-1"]);
expect(query).toHaveBeenCalledWith(expect.stringContaining("set status = 'generating'"), ["content-topic-1"]);
expect(query).toHaveBeenCalledWith(expect.stringContaining("set status = 'generated'"), ["content-topic-1"]);
```

- [ ] **Step 2: Run failure**

Run: `npm test -- repository.test.ts`

Expected: generation tests fail because code still selects topic rows or snapshots directly.

- [ ] **Step 3: Implement selected-topic generation**

Change `generateContent()` to:

1. Load one selected `content_topics` row.
2. If it references `topic_table`, join `topic_rows`.
3. If it references `source_url`, join the latest matching source snapshot/content item.
4. Update selected topic to `generating`.
5. Generate LLM output.
6. Update topic to `generated`.
7. Auto approval continues creating `publish_queue` per generated channel.

- [ ] **Step 4: Verify**

Run: `npm test -- repository.test.ts`

Expected: repository tests pass.

### Task 3: Publish Management Lists Pre-LLM Waiting Rows

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`

- [ ] **Step 1: Add pending DTO tests**

Add a repository test that `listPublishQueue()` returns selected `content_topics` rows as `PublishQueueDto` items with:

```ts
status: "queued",
approvalType: "empty",
channel: "instagram",
sourceType: "source_url",
sourceUrls: ["https://brand.example.com/article"]
```

Use `id = "topic:<content_topic_id>"`.

- [ ] **Step 2: Add UI test**

Add a publish queue page test with a pre-LLM waiting row and no publish result channels. It must render the row as `대기` and channel state buttons must remain disabled or show no generated channel output.

- [ ] **Step 3: Implement API query union**

In `listPublishQueue()`, union generated `publish_queue` rows with selected/generating `content_topics` rows. The selected rows have no channel output yet, so use a stable placeholder channel and `approvalType = 'empty'`.

- [ ] **Step 4: Implement UI row handling**

Reuse `PublishSlot` rows for waiting items. Keep click disabled for waiting, scheduled, and publishing. Do not open content popup for pre-LLM waiting rows.

- [ ] **Step 5: Verify**

Run:

```powershell
npm test -- repository.test.ts
npm test -- publishQueue.test.tsx
```

Expected: both pass.

### Task 4: Final Verification

**Files:**
- All modified files.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
cd apps/api; npm test -- repository.test.ts
cd apps/customer-ui; npm test -- publishQueue.test.tsx sources.test.tsx
```

- [ ] **Step 2: Run builds if focused tests pass**

Run:

```powershell
cd apps/api; npm run build
cd apps/customer-ui; npm run build
```

- [ ] **Step 3: Report result**

Report changed files, state flow, and any verification gaps.
