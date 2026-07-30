# Runtime Reliability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DM, publishing, scheduler, workers, authentication, crawling, and repository contracts fail safely without cross-brand routing, duplicate side effects, or permanently stuck work.

**Architecture:** Keep the existing PostgreSQL lease and queue model, but make ambiguous external side effects terminal and recover stale internal work through idempotent database transitions. Add client-side request locks as UX protection while enforcing state transitions on the API as the authoritative guard.

**Tech Stack:** TypeScript, Fastify, React, PostgreSQL, Vitest, Node test runner

---

### Task 1: DM routing and delivery idempotency

**Files:**
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/instagramMessaging.ts`
- Test: `apps/api/src/repository.dmWebhook.test.ts`
- Test: `apps/api/src/instagramMessaging.test.ts`

- [ ] Add failing tests for ambiguous Instagram recipient ownership and transient send errors.
- [ ] Require exactly one active brand channel for a webhook recipient.
- [ ] Remove automatic retries around side-effectful DM sends.
- [ ] Run the focused DM tests.

### Task 2: Publishing finalization and duplicate prevention

**Files:**
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/metaGraph.ts`
- Test: `apps/api/src/repository.test.ts`
- Test: `apps/api/src/metaGraph.test.ts`

- [ ] Add failing tests for external success followed by database finalization failure.
- [ ] Store provider identifiers before final queue transition and reconcile stale publishing rows.
- [ ] Treat ambiguous provider 5xx responses as terminal manual-attention failures.
- [ ] Run focused publishing tests.

### Task 3: Scheduler and worker recovery

**Files:**
- Modify: `apps/api/src/scheduler.ts`
- Modify: `apps/api/src/contentPerformance.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `workers/brand-pilot-image-worker/src/renderer.ts`
- Modify: `workers/brand-pilot-image-worker/src/index.ts`
- Modify: `workers/brand-pilot-dm-worker/src/db.ts`
- Test: corresponding `*.test.ts` files

- [ ] Add timeout tests for performance collection and scheduler isolation.
- [ ] Add image command timeout and stale max-attempt cleanup.
- [ ] Requeue stale Wiki build items and fail exhausted items/versions.
- [ ] Run scheduler and worker tests.

### Task 4: Signup, authentication, and review actions

**Files:**
- Modify: `apps/api/src/kakaoAuth.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/lib/auth.tsx`
- Modify: `apps/customer-ui/src/pages/ContentPage.tsx`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Test: corresponding API and UI tests

- [ ] Add Webflow to new-brand channel creation.
- [ ] Distinguish 401 from temporary API failures in the authentication gate.
- [ ] Enforce compare-and-set review transitions in the API.
- [ ] Disable repeated review actions while requests are in flight.

### Task 5: Crawler and contracts

**Files:**
- Modify: `apps/api/src/sourceCrawler.ts`
- Modify: `apps/api/src/sourceCrawler.test.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `scripts/repository-contract.test.mjs`

- [ ] Reject oversized declared and streamed crawler responses.
- [ ] Revalidate DNS immediately before each request and pin production requests to validated addresses.
- [ ] Update channel and migration contracts to include Webflow and migration 031.
- [ ] Run API, UI, worker, contract, and build verification.
