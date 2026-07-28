# Reference Library Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete secure reference uploads, real lazy reference detail, accessible saved-brand details, and visible favorite state.

**Architecture:** Add a reference-specific receipt/finalizer beside the avatar lifecycle, keeping confirm/cancel serialized and forward-only. Split repository list summaries from tenant-scoped detail reads, then use a dedicated gateway/uploader and one accessible detail dialog across collections.

**Tech Stack:** PostgreSQL migrations, Fastify, TypeScript, Vitest, React Testing Library, React, Vercel Blob client.

---

### Task 1: Reference upload cancellation and finalization

**Files:**
- Create: `db/migrations/064_reference_upload_finalization.sql`
- Modify: `scripts/repository-contract.test.mjs`
- Modify: `scripts/migrations.integration.test.mjs`
- Modify: `apps/api/src/assetLibraryUpload.test.ts`
- Modify: `apps/api/src/assetLibraryUpload.ts`
- Modify: `apps/api/src/assetLibraryRepository.test.ts`
- Modify: `apps/api/src/assetLibraryRepository.ts`

- [ ] **Step 1: Write failing migration and prefix tests**

Assert that migration 064 defines a reference-only receipt with tenant, brand,
actor, exact prefix, nullable path, expiry, retry/fairness fields and index. Assert
`cleanupAssetLibraryUploadPrefix(".../references/<session>/", ...)` accepts only an
exact reference reservation prefix.

- [ ] **Step 2: Run tests and verify RED**

Run:
`node --test scripts/repository-contract.test.mjs && npm run test --workspace @brand-pilot/api -- assetLibraryUpload.test.ts`

Expected: failure because 064 and reference prefix cleanup do not exist.

- [ ] **Step 3: Add migration and independently validated reference prefix cleanup**

Use a new `reference_upload_cancellation_receipts` table. Do not alter 059/060 or
make avatar receipt columns polymorphic.

- [ ] **Step 4: Write failing repository lifecycle tests**

Cover scope/actor mismatch, cancel idempotency, token-expiry grace, late prefix
cleanup, pathless legacy rows, bounded fair selection, confirm/cancel ordering, and
preservation when a storage artifact is already consumed by a reference item.

- [ ] **Step 5: Run repository tests and verify RED**

Run:
`npm run test --workspace @brand-pilot/api -- assetLibraryRepository.test.ts`

Expected: failure because reference cancel/finalizer methods are absent.

- [ ] **Step 6: Implement minimal repository lifecycle**

Add `cancelReferenceUpload` and `cleanupExpiredReferenceUploads`. Acquire the session
advisory lock before the row lock in cancel, finalizer, and reference confirm. Delay
blob cleanup until after token expiry and preserve consumed artifacts.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:
`npm run test --workspace @brand-pilot/api -- assetLibraryUpload.test.ts assetLibraryRepository.test.ts`

Expected: all focused lifecycle tests pass.

- [ ] **Step 8: Commit lifecycle checkpoint**

```bash
git add db/migrations/064_reference_upload_finalization.sql scripts/repository-contract.test.mjs scripts/migrations.integration.test.mjs apps/api/src/assetLibraryUpload.ts apps/api/src/assetLibraryUpload.test.ts apps/api/src/assetLibraryRepository.ts apps/api/src/assetLibraryRepository.test.ts
git commit -m "fix(libraries): finalize reference upload sessions"
```

### Task 2: Summary/detail API and real snapshots

**Files:**
- Modify: `apps/api/src/assetLibraryRepository.test.ts`
- Modify: `apps/api/src/assetLibraryRepository.pglite.test.ts`
- Modify: `apps/api/src/assetLibraryRepository.ts`
- Modify: `apps/api/src/server.assetLibraryCustomer.test.ts`
- Modify: `apps/api/src/brandCenterHttp.ts`
- Modify: `apps/api/src/httpServer.ts`

- [ ] **Step 1: Write failing repository/API tests**

Assert list results exclude full caption/body/analysis, detail is scoped by workspace
and brand, and latest successful snapshots use `extracted_title`, `summary` then
`extracted_text`, and real snapshot metadata. Assert legacy `metadata.description`
and stored source URL remain fallbacks. Assert GET executes no update.

- [ ] **Step 2: Run tests and verify RED**

Run:
`npm run test --workspace @brand-pilot/api -- assetLibraryRepository.test.ts assetLibraryRepository.pglite.test.ts server.assetLibraryCustomer.test.ts`

Expected: detail repository/route are missing and list exposes unrestricted metadata.

- [ ] **Step 3: Implement summary projection and read-only detail**

Add `getReference` to the repository and `GET
/brands/:brandId/references/:referenceId`. Use lateral joins for the latest successful
snapshot and pattern existence. Keep GET read-only. Add a contract test documenting
that normalized retained snapshots must be written by crawl/maintenance, not detail.

- [ ] **Step 4: Add reference cancellation HTTP and cleanup cron**

Expose `DELETE /brands/:brandId/references/upload-sessions/:sessionId` and invoke the
reference finalizer from the authenticated cleanup endpoint.

- [ ] **Step 5: Run focused API tests and verify GREEN**

Run:
`npm run test --workspace @brand-pilot/api -- assetLibraryRepository.test.ts assetLibraryRepository.pglite.test.ts server.assetLibraryCustomer.test.ts`

Expected: all focused API tests pass.

- [ ] **Step 6: Commit API checkpoint**

```bash
git add apps/api/src/assetLibraryRepository.ts apps/api/src/assetLibraryRepository.test.ts apps/api/src/assetLibraryRepository.pglite.test.ts apps/api/src/brandCenterHttp.ts apps/api/src/httpServer.ts apps/api/src/server.assetLibraryCustomer.test.ts
git commit -m "feat(libraries): add lazy reference detail API"
```

### Task 3: Direct upload and corrected card/dialog behavior

**Files:**
- Modify: `apps/customer-ui/src/features/libraries/libraryGateway.test.ts`
- Modify: `apps/customer-ui/src/features/libraries/libraryGateway.ts`
- Create: `apps/customer-ui/src/components/references/ReferenceFileUploader.tsx`
- Modify: `apps/customer-ui/src/components/references/ReferenceCard.tsx`
- Modify: `apps/customer-ui/src/components/references/ReferenceDetailDialog.tsx`
- Modify: `apps/customer-ui/src/components/references/ReferenceBrandDetailDialog.tsx`
- Modify: `apps/customer-ui/src/components/references/SavedReferenceBrandsPanel.tsx`
- Modify: `apps/customer-ui/src/components/references/ExternalUrlsPanel.tsx`
- Modify: `apps/customer-ui/src/pages/ReferenceLibraryPage.tsx`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/__tests__/referenceLibrary.test.tsx`
- Modify: `apps/customer-ui/src/styles/references.css`

- [ ] **Step 1: Write failing gateway tests**

Specify hash → token → blob → confirm, progress/session callbacks, reference-session
cancel, supported MIME policy, and duplicate checksum behavior.

- [ ] **Step 2: Run gateway tests and verify RED**

Run:
`npm run test --workspace @brand-pilot/customer-ui -- libraryGateway.test.ts`

Expected: reference upload gateway methods are missing.

- [ ] **Step 3: Implement the minimal reference gateway**

Reuse only generic hashing/blob transport primitives. Use reference endpoints and
reference policy; do not route reference cancellation through avatar methods.

- [ ] **Step 4: Write failing component tests**

Cover progress, actual image/file metadata, duplicate rejection, retry/remove,
dialog/unmount cancellation, confirmation, lazy detail request, saved-brand card
detail, Escape/focus trap/restore, and favorite state without a callback.

- [ ] **Step 5: Run component tests and verify RED**

Run:
`npm run test --workspace @brand-pilot/customer-ui -- referenceLibrary.test.tsx`

Expected: direct upload, lazy detail, saved-brand detail selection, and read-only
favorite label are absent.

- [ ] **Step 6: Implement uploader and shared lazy detail flow**

Keep failed cleanup entries visible/retryable. Fetch `getReference` only when the
dialog opens. Give saved-brand item cards a real selection handler. Always render
favorite state; mutate only where a safe callback exists.

- [ ] **Step 7: Run focused UI tests and verify GREEN**

Run:
`npm run test --workspace @brand-pilot/customer-ui -- libraryGateway.test.ts referenceLibrary.test.tsx instagramTrends.test.tsx archive.test.tsx sources.test.tsx helpGuidance.test.tsx navigation.test.tsx`

Expected: all focused UI tests pass.

- [ ] **Step 8: Commit UI checkpoint**

```bash
git add apps/customer-ui/src/features/libraries apps/customer-ui/src/components/references apps/customer-ui/src/pages/ReferenceLibraryPage.tsx apps/customer-ui/src/lib/apiClient.ts apps/customer-ui/src/types.ts apps/customer-ui/src/__tests__/referenceLibrary.test.tsx apps/customer-ui/src/styles/references.css
git commit -m "fix(libraries): complete reference upload and detail UX"
```

### Task 4: Final verification

- [ ] Run focused API and UI suites.
- [ ] Run `node --test scripts/migrations.integration.test.mjs`.
- [ ] Run `npm run test:contract`.
- [ ] Run API and customer UI builds.
- [ ] Run `git diff --check`, inspect commits/status, and report exact evidence.
