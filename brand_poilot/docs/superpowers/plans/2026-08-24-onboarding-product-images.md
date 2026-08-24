# Onboarding Product Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the existing product/service manual image library, automatically import product images after onboarding confirmation, inherit images across product version edits, and use registered/attached/URL images in Card News and Reel generation without changing manuscript or public generation contracts.

**Architecture:** Existing `product_service_assets` and `storage_artifacts` remain the permanent source of product images. Onboarding confirmation enqueues a product-only durable import job after creating an approved product version; the existing Image Worker claims that job, applies the same bounded URL extraction rules as content generation, uploads selected images to Vercel Blob, and completes the job through an internal API transaction. Service offerings never enqueue automatic imports, while their existing manual upload/list/delete path remains available. Content generation keeps the already-implemented private optional URL sidecar as a best-effort fallback after attached and registered images.

**Tech Stack:** TypeScript, Fastify, PostgreSQL migrations, React/Vite, Vitest/PGlite/Testcontainers, Vercel Blob, existing Image Worker HTTP lease model.

## Current implementation status

Implemented locally:

- Product-only onboarding import job, strict worker API, bounded extraction, permanent Blob registration, audit, retry/status UI.
- Existing manual image upload/list/delete remains available for products and services.
- Product version drafts inherit asset links without copying Blob bytes; imports finishing after draft creation also link only newly imported assets into that draft.
- Shared artifact deletion removes the physical Blob only after the final product-version link is deleted.
- Card News and Reel preserve the priority attachment > registered product image > temporary URL image with a five-reference cap; Blog is unchanged.
- Migration 088 is registered in the sealed migration runner, checksum registry, API image contract, and pre-canary deployment gate.

Verified locally:

- Focused API, PGlite, worker, contracts, and UI tests pass sequentially.
- API typecheck, Image Worker build, Customer UI production build, migration/deployment static contracts, and diff whitespace checks pass.

Not yet verified or changed:

- The minimum-role PostgreSQL integration test is implemented but not executed because Docker/production-equivalent PostgreSQL is unavailable in this workspace. A skipped test is not treated as a pass.
- The production manual-upload failure is confirmed to occur during browser-to-Vercel-Blob `put`, before API confirm. The provider's exact error response is still unavailable, so no speculative storage fallback or integrity relaxation was added. The UI only distinguishes upload-stage and confirm-stage failures.
- Authenticated browser end-to-end scenarios, merge, and production deployment have not run.

---

### Task 1: Preserve images when a new product/service draft version is created

**Files:**
- Modify: `apps/api/src/productLibraryRepository.ts`
- Test: `apps/api/src/productLibraryRepository.pglite.test.ts`
- Test: `apps/api/src/productLibraryRepository.test.ts`

- [ ] Write a failing PGlite test that creates an approved version with two asset links, calls `updateProductServiceDraft`, and expects the new draft to contain two links to the same `storage_artifact_id` values with the same role/order.
- [ ] Run `npm test --workspace @brand-pilot/api -- productLibraryRepository.pglite.test.ts` and confirm the new test fails because the draft has no image links.
- [ ] Change only the no-existing-draft branch to insert the draft and copy active-version asset link rows in the same product row lock transaction. Do not copy Blob bytes.
- [ ] Run the focused repository tests and confirm they pass.

### Task 2: Make deletion safe for shared version image links

**Files:**
- Modify: `apps/api/src/manualVisualAssetsRepository.ts`
- Modify: `apps/api/src/brandCenterHttp.ts`
- Test: `apps/api/src/manualVisualAssetsRepository.pglite.test.ts`
- Test: `apps/api/src/server.assetLibraryCustomer.test.ts`

- [ ] Write a failing test with two version links to one `storage_artifact_id`; deleting one link must not mark the artifact deleted or request Blob deletion.
- [ ] Write a failing test showing deletion of the final link marks the artifact deleted and requests exactly one Blob deletion.
- [ ] Run both focused tests and confirm the expected failures.
- [ ] Lock the owning product version before sibling asset rows, delete/reorder links, and return whether the removed artifact has any remaining live asset references.
- [ ] Update the HTTP route to delete the physical Blob only for the final live reference.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Add the durable product-only onboarding import job

**Files:**
- Create: `db/migrations/088_onboarding_product_image_imports.sql`
- Modify: `apps/api/src/brandIntelligenceRepository.ts`
- Create: `apps/api/src/productImageImportRepository.ts`
- Test: `apps/api/src/brandIntelligenceRepository.test.ts`
- Test: `apps/api/src/productImageImportRepository.pglite.test.ts`
- Modify: `scripts/ai-content-database-roles.mjs`

- [ ] Write a failing onboarding confirmation test: a new `product` with HTTPS `purchaseUrl` creates one pending import job bound to the approved version; a `service`, a product without URL, and a duplicate existing product create no job.
- [ ] Write failing repository tests for claim/lease heartbeat/complete/fail/retry and one-job-per-version idempotency.
- [ ] Run the focused tests and confirm failures are due to the absent migration/repository.
- [ ] Add the append-only migration with tenant/version ownership FKs, bounded `source_urls_json`, status/lease/attempt fields, selection audit JSON, error code, unique version identity, claim index, application-role grants, and schema-owner ownership.
- [ ] Enqueue only product jobs from the same onboarding confirmation transaction after the approved version is created. Keep network and Blob I/O outside that transaction.
- [ ] Implement claim/lease state transitions with `FOR UPDATE SKIP LOCKED`, bounded retries, and deterministic idempotency.
- [ ] Run migration, onboarding, PGlite, and application-role PostgreSQL tests.

### Task 4: Add internal API worker endpoints and strict payload validation

**Files:**
- Create: `apps/api/src/productImageImportContracts.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/repository.ts`
- Test: `apps/api/src/server.productImageImportWorker.test.ts`

- [ ] Write failing HTTP tests for authenticated claim, heartbeat, complete, fail, malformed source URL, cross-tenant product/version binding, stale lease, and more than five selected images.
- [ ] Run the HTTP test and verify expected failures.
- [ ] Add worker-token-protected endpoints under `/worker/product-image-import-jobs/*`; do not expose them to customer authentication routes.
- [ ] Strictly validate image URL/size/MIME/checksum/role/position and job lease identity before repository mutations.
- [ ] Run the focused HTTP and repository tests.

### Task 5: Reuse Image Worker extraction rules for permanent onboarding imports

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/productVisualReferenceAcquisition.ts`
- Create: `workers/brand-pilot-image-worker/src/productImageImportClient.ts`
- Create: `workers/brand-pilot-image-worker/src/productImageImportWorker.ts`
- Modify: `workers/brand-pilot-image-worker/src/worker.ts`
- Modify: `workers/brand-pilot-image-worker/src/index.ts`
- Test: `workers/brand-pilot-image-worker/src/productImageImportWorker.test.ts`
- Test: `workers/brand-pilot-image-worker/src/worker.test.ts`

- [ ] Write failing tests that a claimed product job extracts independent candidates, excludes logo/icon/banner/related-product/tiny/extreme-ratio images, content-hash deduplicates, uploads at most five, and completes with selected/excluded audit reasons.
- [ ] Write failing tests that a service job is rejected, a no-image page completes without product assets, and lease loss aborts downloads/uploads.
- [ ] Run focused tests and verify expected failures.
- [ ] Refactor only the minimum reusable acquisition output needed by temporary visual-session and permanent import paths.
- [ ] Upload immutable hash-addressed product images to the existing product asset namespace; make retries idempotent and clean only blobs that were uploaded but not linked.
- [ ] Add the import queue after AI render work in the existing worker loop without changing Card/Reel job priority or image generation behavior.
- [ ] Run Image Worker tests/build.

### Task 6: Insert imported assets transactionally and serialize all mutations

**Files:**
- Modify: `apps/api/src/productImageImportRepository.ts`
- Modify: `apps/api/src/manualVisualAssetsRepository.ts`
- Test: `apps/api/src/productImageImportRepository.postgres.integration.test.ts`
- Test: `apps/api/src/manualVisualAssetsRepository.pglite.test.ts`

- [ ] Write a failing concurrency test where manual confirm and auto import target the same version; the committed state must have at most five unique positions and exactly one hero.
- [ ] Write a failing retry test where uploaded hash/path is submitted twice; the second completion must not create duplicate artifacts or asset links.
- [ ] Run the tests and confirm expected failures.
- [ ] Standardize lock order as product version row, then asset rows, then storage artifact/link mutations for manual confirm, auto complete, and delete.
- [ ] Fill only remaining positions up to five, dedupe by checksum and storage artifact, keep an existing hero, and mark the job succeeded even when zero new links are needed.
- [ ] Run integration tests as the minimum-privilege application role, not database owner.

### Task 7: Expose import status and preserve manual CRUD for products and services

**Files:**
- Modify: `apps/api/src/productLibraryRepository.ts`
- Modify: `apps/api/src/brandCenterHttp.ts`
- Modify: `apps/customer-ui/src/features/libraries/libraryGateway.ts`
- Modify: `apps/customer-ui/src/components/brand-center/ProductServiceImageManager.tsx`
- Test: `apps/customer-ui/src/components/brand-center/ProductServiceImageManager.test.tsx`
- Test: `apps/customer-ui/src/features/libraries/libraryGateway.test.ts`

- [ ] Write failing UI tests for pending/running/succeeded/failed product import state, explicit retry, and no auto-import state for services while their manual upload button remains enabled.
- [ ] Write a failing gateway test for status and retry endpoints.
- [ ] Run the focused UI tests and confirm expected failures.
- [ ] Return optional import status with product/version data and add an idempotent retry endpoint restricted to product versions with source URLs.
- [ ] Render non-blocking status/retry controls without removing current list/upload/delete behavior.
- [ ] Run UI tests and production build.

### Task 8: Diagnose and fix the current manual upload failure at the actual failing boundary

**Files:**
- Modify only after reproduction: `apps/customer-ui/src/features/libraries/libraryGateway.ts`, `apps/customer-ui/src/components/brand-center/ProductServiceImageManager.tsx`, `apps/api/src/assetLibraryUpload.ts`, or `apps/api/src/brandCenterHttp.ts`
- Test: matching gateway/API/provider test file

- [ ] Capture the failed production/local browser request and distinguish client Blob `put` from API `/images/confirm` failure; record stage, HTTP status, and stable error code without logging tokens or file bytes.
- [ ] Write one failing regression test for the confirmed root cause and run it to RED.
- [ ] Apply the smallest root-cause fix. Do not add a proxy-upload fallback or weaken Blob integrity checks without separate user approval.
- [ ] Show the exact error code in the Brand Center while keeping user-friendly guidance; add structured server logging at the failing boundary.
- [ ] Re-run the exact browser upload, list, representative order, and delete flow for both a product and a service.

### Task 9: Integrate the existing Card/Reel URL-reference branch with registered images

**Files:**
- Existing commit scope under `apps/api/src/aiContent*`, `packages/brand-pilot-content-contracts/src/productVisualReferences.ts`, and `workers/brand-pilot-image-worker/src/*Visual*`

- [ ] Confirm the rebased private sidecar remains optional and no public render/manuscript/DB contract changed.
- [ ] Add/adjust regression fixtures proving priority `new product-image attachment > registered product image > URL extraction`, product-reference cap five, URL fetch skip when capacity is full, and no duplicate checksum across registered/URL candidates.
- [ ] Verify Card News and Reel use identical reference inputs while Blog remains unchanged.
- [ ] Run contracts, API, Image Worker, Card/Reel regression tests and builds.

### Task 10: Final verification and deployment handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-08-24-onboarding-product-images.md` checkbox state only

- [ ] Run `git diff --check` and inspect diff for unrelated UI, Research, Proposal, publishing, Blog, Subject Analysis, or DB changes.
- [ ] Run migration tests and minimum-role PostgreSQL integration tests with no skips.
- [ ] Run API, Customer UI, content contracts, and Image Worker builds/tests.
- [ ] Run browser scenario: onboarding product confirmation → import completes → Brand Center images visible/editable → selected product freezes images → one Card News and one Reel render claim contains the references.
- [ ] Confirm a service offering receives no automatic import but manual upload/list/delete still works.
- [ ] Recheck `codex-deploy/main`, actual production SHA/digests, dirty worktrees, and active hotfixes before merge/deployment.
- [ ] Stop and show verification results. Do not merge or deploy until the user approves the final combined release.
