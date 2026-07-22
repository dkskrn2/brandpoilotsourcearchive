# Multi-channel Publishing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add X, Threads, YouTube, TikTok, and LinkedIn as brand-selectable content channels that support generation contracts, review, queueing, preview, and download before real OAuth publishing is connected.

**Architecture:** Keep `brand_channels` as the per-brand activation and connection record. Add one canonical channel/delivery-format catalog shared by generation, API validation, and UI labels. Content outputs remain channel-specific records under one topic; approved outputs enter the existing publish queue, while publisher adapters report `oauth_required` without making external calls until provider credentials are implemented.

**Tech Stack:** PostgreSQL migrations, Fastify/TypeScript API, React/Vite customer UI, Vitest.

---

### Task 1: Extend the persistent channel contract

**Files:**
- Create: `db/migrations/030_multichannel_foundation.sql`
- Modify: `db/smoke/001_schema_smoke.sql`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/customer-ui/src/types.ts`

- [x] Add `linkedin` to channel checks for `brand_channels`, `channel_outputs`, `publish_slots`, and `publish_queue`.
- [x] Add `linkedin_post` and `youtube_short` to the delivery-format check while preserving existing values.
- [x] Insert missing channel rows for every active brand without duplicating existing rows.
- [x] Extend API and UI channel/delivery-format unions and add `enabled` and OAuth state to channel DTOs.
- [x] Run schema and type tests.

### Task 2: Add channel catalog and activation API

**Files:**
- Create: `apps/api/src/channelCatalog.ts`
- Create: `apps/api/src/channelCatalog.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/types.ts`

- [x] Define channel labels, delivery formats, artifact kinds, and OAuth provider metadata in a typed catalog.
- [x] Return all six channels in stable display order with `enabled`, `status`, and `oauthState`.
- [x] Add `PATCH /brands/:brandId/channels/:channel` accepting only `{ enabled: boolean }`.
- [x] Keep disabled channels out of generation while retaining their history.
- [x] Ensure health checks never mark an uncredentialed channel connected.

### Task 3: Add provider-neutral publisher adapters

**Files:**
- Create: `apps/api/src/publishAdapters.ts`
- Create: `apps/api/src/publishAdapters.test.ts`
- Modify: `apps/api/src/repository.ts`

- [x] Define an adapter interface with `validate`, `publish`, and normalized result/error contracts.
- [x] Register the existing Instagram publisher through the adapter boundary.
- [x] Register Threads, X, LinkedIn, YouTube, and TikTok stubs that return `oauth_required` without external requests.
- [x] Persist the normalized failure in `publish_attempts` and leave the queue recoverable rather than claiming publication succeeded.

### Task 4: Generate channel output records for enabled channels

**Files:**
- Modify: `apps/api/src/topicPublishGroups.ts`
- Modify: `apps/api/src/topicPublishGroups.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`

- [x] Base readiness on enabled channels so creation and download work before OAuth.
- [x] Create one output per enabled channel for the selected topic.
- [x] Use formats `threads_text`, `x_post`, `linkedin_post`, `youtube_short`, and `tiktok_video`.
- [x] Store a stable output JSON contract containing topic, representative URL, artifact kind, generation state, and channel constraints.
- [x] Keep generated outputs reviewable; approval creates exactly one queue row through the existing idempotent constraint.

### Task 5: Connect the customer UI

**Files:**
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/pages/ChannelsPage.tsx`
- Modify: `apps/customer-ui/src/pages/ContentPage.tsx`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/__tests__/channels.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`

- [x] Add a single activation switch to every channel card.
- [x] Show connection state separately from activation state and label unavailable OAuth actions as `연결 준비 중`.
- [x] Render text, image, video, and HTML output previews from the shared output contract.
- [x] Keep download available for generated artifacts and clearly disable it while generation is pending.
- [x] Preserve the current unified publish-management table and filters.

### Task 6: Verification

**Files:**
- Modify: `README.md`

- [x] Run focused API and UI tests for channels, generation readiness, review queueing, adapters, and preview mapping.
- [x] Run TypeScript builds for API, UI, and workers.
- [x] Run `npm run env:check` and confirm secrets remain ignored.
- [x] Document that external OAuth and real provider publishing remain intentionally disabled for the five added channels.
