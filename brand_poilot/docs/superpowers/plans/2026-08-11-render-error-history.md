# Render Error History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every worker-reported image render failure after retries without changing generation or retry behavior.

**Architecture:** Extend the existing failure request with an optional bounded diagnostic code, keep all existing error and retry fields authoritative, and append a best-effort `audit_events` record only after the existing failure transaction commits. Reuse the existing audit schema so no migration or UI change is required.

**Tech Stack:** TypeScript, PostgreSQL, Vitest, PGlite

---

### Task 1: Persist render failure attempts

**Files:**
- Modify: `apps/api/src/aiContentRenderJobs.ts`
- Modify: `apps/api/src/httpServer.ts`
- Test: `apps/api/src/aiContentRenderJobs.test.ts`
- Test: `apps/api/src/aiContentRenderJobs.pglite.test.ts`
- Test: `apps/api/src/server.aiContentRenderWorker.test.ts`

- [ ] Add failing tests proving retryable failure audit persistence, terminal replay deduplication, optional diagnostic parsing, and audit-write failure isolation.
- [ ] Run the focused API tests and confirm they fail because no failure audit event or diagnostic field exists.
- [ ] Add optional `diagnosticCode` validation and append `ai_content_render_attempt_failed` after the existing transaction commits.
- [ ] Run the focused API tests and confirm all pass.

### Task 2: Extract a safe worker diagnostic code

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/aiContentRenderClient.ts`
- Modify: `workers/brand-pilot-image-worker/src/worker.ts`
- Test: `workers/brand-pilot-image-worker/src/aiContentRenderClient.test.ts`
- Test: `workers/brand-pilot-image-worker/src/worker.test.ts`

- [ ] Add failing tests with a non-enumerable diagnostic containing an internal error code and unrelated secret-like text.
- [ ] Run focused image-worker tests and confirm the new assertions fail because `diagnosticCode` is absent.
- [ ] Extract only a bounded snake-case code from recognized diagnostic lines and pass it as the optional field without changing retry classification.
- [ ] Run focused image-worker tests and confirm all pass.

### Task 3: Regression verification

**Files:**
- Verify only; no new production files.

- [ ] Run the full API render-job and render-worker test files.
- [ ] Run the full image-worker client, renderer, and worker test files.
- [ ] Run API and image-worker TypeScript builds.
- [ ] Run `git diff --check` and verify protected UI, prompt, retry, migration, and automatic-card files have no diff.
