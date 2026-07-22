# Trend Archive and Search UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bookmark removal and recent-search deletion immediate, reversible on failure, tenant-safe, and idempotent.

**Architecture:** Delete only the brand-scoped saved-media relation and retain reference sources. Keep server writes authoritative while using optimistic client state with item-scoped pending sets and exact rollback snapshots.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Fastify, PostgreSQL.

---

### Task 1: Brand-scoped idempotent bookmark removal API

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/instagramTrendRepository.ts`
- Modify: `apps/api/src/instagramTrendRepository.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.test.ts`

- [ ] Write failing repository tests: matching brand/media deletes one `brand_trend_saved_media` row; a second call returns `removed:false`; another brand cannot delete it; `source_urls` is never updated or deleted.
- [ ] Run `npm test --workspace @brand-pilot/api -- instagramTrendRepository.test.ts`; expect the method to be missing.
- [ ] Add `removeInstagramTrendSource(brandId, mediaId)` using one `DELETE ... WHERE brand_id=$1 AND trend_media_id=$2 RETURNING trend_media_id` and return `{mediaId, removed}`.
- [ ] Add `DELETE /brands/:brandId/instagram-trends/:mediaId/save-source` through the existing authorization wrapper and client method.
- [ ] Add server/client contract tests for removed true, removed false, and tenant scope.
- [ ] Run targeted API tests and API typecheck; expect success.

### Task 2: Controlled bookmark state and archive rollback

**Files:**
- Modify: `apps/customer-ui/src/components/trends/TrendMediaCard.tsx`
- Modify: `apps/customer-ui/src/components/trends/TrendMediaCard.test.tsx`
- Modify: `apps/customer-ui/src/components/trends/TrendMediaDetailDialog.tsx`
- Modify: `apps/customer-ui/src/pages/ArchivePage.tsx`
- Modify: `apps/customer-ui/src/__tests__/archive.test.tsx`
- Modify: `apps/customer-ui/src/pages/InstagramTrendsPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/instagramTrends.test.tsx`

- [ ] Write a failing card test proving `media.isSaved=false` immediately renders the unchecked icon after a rerender.
- [ ] Remove duplicated internal saved state; keep only item-scoped pending/error state and call a parent `onBookmarkToggle(media, nextSaved)` callback.
- [ ] Add failing archive tests for immediate removal before the DELETE resolves, exact item/total rollback on rejection, detail-dialog synchronization, and removal of the last item on page 2 navigating to page 1.
- [ ] Implement functional optimistic updates with a rollback snapshot containing item, index, total, and page.
- [ ] Keep regular trend search cards able to save and unsave without refetching the full page.
- [ ] Run card, archive, and trends tests; expect success.

### Task 3: Concurrent optimistic recent-search deletion

**Files:**
- Modify: `apps/customer-ui/src/pages/InstagramTrendsPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/instagramTrends.test.tsx`

- [ ] Write failing tests using deferred promises: the chip disappears before resolution; two chips can delete concurrently; rejecting one restores only that chip at its original order.
- [ ] Replace `deletingHistoryId` with `Set<string>`, capture `{history,index}` per request, and restore by index only when that request fails.
- [ ] Replace `Trash2` with `X`, retaining `최근 검색 #태그 삭제` as the accessible label.
- [ ] Run `npm test --workspace @brand-pilot/customer-ui -- instagramTrends.test.tsx`; expect success.

### Task 4: Plan B verification

- [ ] Run targeted API and UI tests from Tasks 1-3.
- [ ] Run `npm run build --workspace @brand-pilot/api` and `npm run build --workspace @brand-pilot/customer-ui`.
- [ ] Verify no query scans beyond the existing `(brand_id, trend_media_id)` unique key and `(brand_id, hashtag_id)` key.

## Failure modes

- Cross-brand delete: repository predicate prevents deletion and tests prove tenant isolation.
- Repeated DELETE: returns `removed:false` without an error so client retries remain safe.
- Concurrent optimistic deletes: each request owns its rollback snapshot; only failed items return in original order.
- Last archive item removed: page is corrected to the previous valid page rather than showing a false empty archive.

## NOT in scope

- Deleting `source_urls` or snapshots when a bookmark is removed.
- Rebuilding all trend results after every toggle.
- Adding React Query or upgrading React for optimistic state.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | CLEAR | Tenant-safe idempotent delete, concurrent rollback, page correction |

**UNRESOLVED:** 0

**VERDICT:** ENG CLEARED — ready to implement after Plan A.
