# Brand Pilot Admin Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe Brand Pilot administrator workflow for inspecting generated content and publish attempts, retrying explicitly retryable failures, and cancelling work that has not started publishing.

**Architecture:** Extend the separate `AdminRepository` and `/admin/v1` namespace instead of exposing the customer repository. The Growthline Next.js administrator remains a server-only API client; previews use stored public artifacts and sanitized output data, while every mutation is transactional, idempotent, and audited.

**Tech Stack:** TypeScript, Fastify 5, PostgreSQL, Next.js 16 App Router, React Server Components, Server Actions, Vitest, Node test runner, Playwright.

---

### Task 1: Add publishing read models

**Files:**
- Modify: `apps/api/src/adminTypes.ts`
- Modify: `apps/api/src/adminRepository.ts`
- Modify: `apps/api/src/adminRepository.test.ts`
- Modify: `apps/api/src/adminRepository.pglite.test.ts`
- Modify: `apps/api/src/adminServer.ts`
- Modify: `apps/api/src/adminServer.test.ts`

- [ ] Add DTOs for list rows, detail, artifacts, attempts, and source metadata.
- [ ] Write failing route and repository tests for filtered cursor listing and one queue detail.
- [ ] Implement `GET /admin/v1/publishing` and `GET /admin/v1/publishing/:queueId`.
- [ ] Sanitize attempt metadata and expose only public artifact URLs, MIME type, dimensions, byte size, and non-secret provider results.
- [ ] Run focused repository, route, and PGlite tests.

### Task 2: Add safe publish operations

**Files:**
- Modify: `apps/api/src/adminTypes.ts`
- Modify: `apps/api/src/adminRepository.ts`
- Modify: `apps/api/src/adminRepository.test.ts`
- Modify: `apps/api/src/adminServer.ts`
- Modify: `apps/api/src/adminServer.test.ts`

- [ ] Write failing tests for missing reason/idempotency key, invalid states, idempotency replay, retry, cancel, and audit rows.
- [ ] Implement retry only for `failed` rows allowed by the existing publish retry policy.
- [ ] Implement cancel only for `queued`, `scheduled`, or `deferred`; never cancel `publishing` or `published`.
- [ ] Record `admin.publish_retried` or `admin.publish_cancelled` in the same transaction as the state change and idempotency result.
- [ ] Run focused API tests and typecheck.

### Task 3: Add Growthline publishing screens

**Files:**
- Modify: `components/brand-pilot-admin-shell.tsx`
- Modify: `lib/brand-pilot-admin.ts`
- Modify: `app/admin/brand-pilot/actions.ts`
- Create: `app/admin/brand-pilot/publishing/page.tsx`
- Create: `app/admin/brand-pilot/publishing/[queueId]/page.tsx`
- Modify: `app/globals.css`
- Modify: `tests/brand-pilot-admin.test.js`

- [ ] Write failing contract tests for the publishing navigation, list, detail, and protected server actions.
- [ ] Add server-only client DTOs and API functions.
- [ ] Build the filterable list with brand, topic, channel, format, status, schedule, attempts, and error.
- [ ] Build the detail page with image/video/HTML/text preview, sanitized metadata, source references, review state, and attempt history.
- [ ] Add reason-required retry/cancel actions and isolated API error/empty states.
- [ ] Add responsive styles with previews constrained by aspect ratio and local table scrolling.

### Task 4: Verify end to end

**Files:**
- Verify: `apps/api/src/adminRepository.ts`
- Verify: `apps/api/src/adminServer.ts`
- Verify: `app/admin/brand-pilot/publishing/page.tsx`
- Verify: `app/admin/brand-pilot/publishing/[queueId]/page.tsx`

- [ ] Run API focused tests, PGlite integration, contract tests, typecheck, and build.
- [ ] Run Growthline tests, lint, and production build.
- [ ] Use Playwright to open list/detail on desktop and mobile and confirm no console errors or global overflow.
- [ ] Exercise one safe retry or cancel only when an eligible queue row exists; otherwise verify the disabled operation state without mutating data.
- [ ] Confirm service tokens and credential payloads are absent from browser responses and rendered text.
