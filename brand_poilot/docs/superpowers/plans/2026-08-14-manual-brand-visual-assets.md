# Manual Brand Visual Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let new manual Card, Reel, and Blog generations use an explicitly selected product/service, one named brand-style preset, and a real avatar (or none), while preserving existing model/reasoning/package behavior and adding manual-only Codex Fast execution plus generation-ID quality diagnostics.

**Architecture:** Add versioned, brand-owned style preset records and safe product-image upload ownership on top of the existing asset-library upload/session primitives. The customer selects visual inputs after proposal selection; the API validates and freezes those exact revisions into a new manual visual-selection sidecar consumed by the existing final planners and image worker. Automatic generation and old queued jobs do not read or write this contract, and existing `brandRules.designRules.referenceImages` remain stored but are never a fallback for the new manual path.

**Tech Stack:** PostgreSQL migrations, TypeScript, Fastify, React/Vite, Vitest, PGlite/PostgreSQL integration tests, Codex CLI, existing Vercel Blob asset-library pipeline.

---

## File Structure

- `db/migrations/082_manual_brand_visual_assets.sql`: new style-preset tables, product upload linkage/checksum constraints, manual visual-selection persistence, ACL/fence registration.
- `apps/api/src/manualVisualAssetsContracts.ts`: strict closed parsers for presets, product images, and manual visual selections.
- `apps/api/src/manualVisualAssetsRepository.ts`: tenant-scoped preset/product-image CRUD and frozen-selection reads.
- `apps/api/src/manualVisualAssetsUpload.ts`: product/style upload path and policy wrapper over existing asset-library upload verification.
- `apps/api/src/contentProposalJobs.ts`: origin-derived proposal execution tier exposed in claims.
- `apps/api/src/aiContentRepository.ts`: persist/freeze the selected manual visual contract at generation start.
- `packages/brand-pilot-content-contracts/src/manualVisualSelection.ts`: private versioned frozen sidecar and per-scene asset selection schemas.
- `apps/customer-ui/src/components/brand-center/BrandStylePresetPanel.tsx`: named preset management.
- `apps/customer-ui/src/components/brand-center/ProductAssetEditor.tsx`: optional product hero/detail images.
- `apps/customer-ui/src/components/ai-content/ManualVisualSelectionStep.tsx`: product summary, preset, avatar/none, attachments.
- `workers/brand-pilot-content-proposal-worker/src/codexModel.ts`: exact per-job Fast toggle.
- Card/Reel/Blog planner prompt and validation files: consume frozen business data and select valid image IDs without extra model calls.
- Image worker renderer/diagnostic files: stage only selected assets and append version/hash/ID metadata.
- `scripts/ai-content-quality-cases.mjs`: read-only six-case test manifest/report generator using the fixed The Verge URL.

## Task 1: Database Contract and Migration Registration

**Files:**
- Create: `db/migrations/082_manual_brand_visual_assets.sql`
- Modify: `scripts/migrations.integration.test.mjs`
- Modify: `scripts/repository-contract.test.mjs`
- Modify: `scripts/ai-content-database-catalog.mjs`
- Modify: `scripts/ai-content-database-catalog.test.mjs`
- Modify: `scripts/ai-content-database-roles.mjs`

- [ ] **Step 1: Write failing migration/contract tests**

Assert migration 079 creates:

```sql
brand_style_presets(
  id, workspace_id, brand_id, name, description, visual_tokens_json,
  status, revision, is_default, created_by_user_id, created_at, updated_at
)
brand_style_preset_references(
  id, workspace_id, brand_id, preset_id, reference_item_id, position
)
manual_ai_content_visual_selections(
  generation_id, workspace_id, brand_id, contract_version,
  product_service_id, product_service_version_id, style_preset_id,
  style_preset_revision, avatar_id, avatar_revision, selection_json, selection_sha256
)
```

Also assert one active default preset per brand, revision > 0, strict tenant composite foreign keys, one reference position per preset, JSON object checks, and 074/075 maintenance fence registration without modifying old migration files.

- [ ] **Step 2: Run RED**

Run:

```powershell
node --test scripts/repository-contract.test.mjs scripts/ai-content-database-catalog.test.mjs
```

Expected: failures naming missing migration/tables/catalog/ACL entries.

- [ ] **Step 3: Implement migration and registrations**

Keep old design-rule reference rows untouched. Add only new tables/constraints and product asset ownership fields needed for new uploads (`storage_artifact_id`, `checksum`, `created_by_user_id`) as nullable for historical rows; enforce them for newly confirmed manual uploads in repository code.

- [ ] **Step 4: Run GREEN**

Run the Step 2 command plus the migration integration tail when PostgreSQL is available. Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```powershell
git add db/migrations/082_manual_brand_visual_assets.sql scripts/migrations.integration.test.mjs scripts/repository-contract.test.mjs scripts/ai-content-database-catalog.mjs scripts/ai-content-database-catalog.test.mjs scripts/ai-content-database-roles.mjs
git commit -m "feat(db): add manual brand visual asset contracts"
```

## Task 2: Closed API Contracts and Safe Upload Paths

**Files:**
- Create: `apps/api/src/manualVisualAssetsContracts.ts`
- Create: `apps/api/src/manualVisualAssetsContracts.test.ts`
- Create: `apps/api/src/manualVisualAssetsUpload.ts`
- Create: `apps/api/src/manualVisualAssetsUpload.test.ts`
- Modify: `apps/api/src/assetLibraryUpload.ts`
- Modify: `apps/api/src/assetLibraryUpload.test.ts`

- [ ] **Step 1: Write failing parser and upload tests**

Define exact public inputs:

```ts
type BrandStylePresetInputV1 = {
  contractVersion: "brand-style-preset.v1";
  name: string;
  description: string;
  visualTokens: { colors: string[]; fonts: string[]; notes: string[] };
  referenceItemIds: string[]; // 1..5
  isDefault: boolean;
};

type ManualProductImageInputV1 = {
  contractVersion: "manual-product-image.v1";
  sessionId: string;
  role: "hero" | "detail";
  position: number;
};
```

Reject unknown keys, unsafe MIME, >5 MB, duplicate references, more than one hero, wrong brand/path/session, checksum/size/MIME mismatch, and non-Vercel/modified Blob URLs. Accept a product/service with zero images.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- --run src/manualVisualAssetsContracts.test.ts src/manualVisualAssetsUpload.test.ts
```

Expected: missing modules/exports.

- [ ] **Step 3: Implement minimal contracts and reuse upload verifier**

Extend `AssetLibraryUploadKind` with `product` and `style` and exact paths:

```text
brands/{brandId}/asset-library/products/{productId}/{sessionId}/{checksum}-{fileName}
스타일 프리셋 이미지는 별도 `styles` 업로드 경로를 만들지 않고 기존 reference 업로드/취소 경로를 사용한다.
```

Reuse byte streaming, checksum, size, MIME, URL, actor, expiry, replay, and cleanup checks. Do not accept caller-supplied arbitrary paths.

- [ ] **Step 4: Run GREEN and commit**

Run Step 2 plus `src/assetLibraryUpload.test.ts`, then commit the four new/modified API files.

## Task 3: Preset and Product-Image Repository/API

**Files:**
- Create: `apps/api/src/manualVisualAssetsRepository.ts`
- Create: `apps/api/src/manualVisualAssetsRepository.pglite.test.ts`
- Modify: `apps/api/src/productLibraryRepository.ts`
- Modify: `apps/api/src/productLibraryRepository.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.assetLibraryCustomer.test.ts`
- Modify: `apps/api/src/server.productLibraryCustomer.test.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write failing repository and route tests**

Cover list/create/update/default/archive presets; only active referenced `reference_items` owned by the same workspace/brand may attach. Query presets through `brand_style_preset_references` only and assert old `brand_rules.design_rules.referenceImages` never appears in SQL or output.

Cover product upload token/confirm/delete against an active draft or approved version, optional zero-image products, single hero, ordered details, and refusal to mutate images belonging to another version/brand.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- --run src/manualVisualAssetsRepository.pglite.test.ts src/productLibraryRepository.test.ts src/server.assetLibraryCustomer.test.ts src/server.productLibraryCustomer.test.ts
```

- [ ] **Step 3: Implement exact authenticated routes**

Routes:

```text
GET/POST /brands/:brandId/style-presets
PATCH/DELETE /brands/:brandId/style-presets/:presetId
POST /brands/:brandId/style-presets/:presetId/default
POST /brands/:brandId/products/:productId/images/upload-token
POST /brands/:brandId/products/:productId/images/confirm
DELETE /brands/:brandId/products/:productId/images/:imageId
```

Require normal brand membership, owner/admin for default/archive, exact request keys, and repository tenant predicates for every read/write.

- [ ] **Step 4: Run GREEN and commit**

Run Step 2 and API typecheck, then commit this task only.

## Task 4: Manual-Only Codex Fast Proposal Composition

**Files:**
- Modify: `apps/api/src/contentProposalJobs.ts`
- Modify: `apps/api/src/contentProposalJobs.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/contracts.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/codexModel.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/codexModel.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/worker.test.ts`

- [ ] **Step 1: Write failing tier tests**

Assert claim maps `ai_content_proposal_batches.origin='manual'` to `executionTier:'fast'` and every other origin to `executionTier:'standard'`. Assert Fast composition uses:

```ts
["--enable", "fast_mode", "-c", 'service_tier="fast"']
```

while both tiers keep `gpt-5.6-terra` and existing medium reasoning. Research execution and automatic/scheduled composition remain standard.

- [ ] **Step 2: Run RED, implement, run GREEN**

Run API `contentProposalJobs.test.ts` and proposal worker `contracts.test.ts`, `codexModel.test.ts`, `worker.test.ts`. No environment-wide Fast flag and no silent fallback.

- [ ] **Step 3: Commit**

Commit only proposal API/worker files.

## Task 5: Versioned Manual Visual Selection and Freeze

**Files:**
- Create: `packages/brand-pilot-content-contracts/src/manualVisualSelection.ts`
- Create: `packages/brand-pilot-content-contracts/src/manualVisualSelection.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/index.ts`
- Modify: `packages/brand-pilot-content-contracts/src/generateArtifacts.ts`
- Modify: `packages/brand-pilot-content-contracts/src/generatedArtifacts.test.ts`
- Modify: `apps/api/src/aiContentContracts.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRepositoryV3Start.test.ts`
- Modify: `apps/api/src/aiContentSnapshotRepository.ts`
- Modify: `apps/api/src/aiContentSnapshotRepository.test.ts`

- [ ] **Step 1: Write failing sidecar/freeze tests**

Use one source of truth:

```ts
type ManualVisualSelectionV1 = {
  contractVersion: "manual-visual-selection.v1";
  product: null | { productServiceId: string; versionId: string };
  stylePreset: null | { presetId: string; revision: number };
  avatar: null | { avatarId: string; revision: number };
};
```

The frozen version contains product profile + optional owned image metadata, selected preset tokens + its junction references, selected avatar metadata/images, and existing confirmed attachments. It must not contain arbitrary client URLs or old style references.

Test default preset/avatar preselection is UI behavior only; the server requires the explicit IDs/null sent at start. Test stale revision, archived object, cross-brand ID, non-frozen planner image ID, and unknown contract version fail before model/render work.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/content-contracts -- --run src/manualVisualSelection.test.ts src/generatedArtifacts.test.ts
npm test --workspace @brand-pilot/api -- --run src/aiContentRepositoryV3Start.test.ts src/aiContentSnapshotRepository.test.ts
```

- [ ] **Step 3: Implement new-manual-only persistence**

At new manual generation start, lock generation/product/version/preset/avatar rows in existing lock order, validate selection, create the immutable frozen sidecar and SHA-256, and persist it in `manual_ai_content_visual_selections`. Do not parse or execute old queued jobs through this path. Historical completed result reads remain unchanged.

- [ ] **Step 4: Generate artifacts, run GREEN, commit**

Run contract generation/check, selected tests, and API typecheck before committing.

## Task 6: Brand Center and Generation UI

**Files:**
- Create: `apps/customer-ui/src/components/brand-center/BrandStylePresetPanel.tsx`
- Create: `apps/customer-ui/src/components/brand-center/BrandStylePresetPanel.test.tsx`
- Create: `apps/customer-ui/src/components/brand-center/ProductAssetEditor.tsx`
- Create: `apps/customer-ui/src/components/brand-center/ProductAssetEditor.test.tsx`
- Create: `apps/customer-ui/src/components/ai-content/ManualVisualSelectionStep.tsx`
- Create: `apps/customer-ui/src/components/ai-content/ManualVisualSelectionStep.test.tsx`
- Modify: `apps/customer-ui/src/features/libraries/libraryGateway.ts`
- Modify: `apps/customer-ui/src/features/libraries/libraryGateway.test.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts`
- Modify: `apps/customer-ui/src/pages/BrandCenterPage.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/ProductServiceEditor.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalFlow.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalFlow.test.tsx`
- Retire from the new manual flow only: `apps/customer-ui/src/components/ai-content/ReferenceAvatarStep.tsx`

- [ ] **Step 1: Write failing UI tests**

Assert Brand Center supports named style presets with 1..5 safe reference images, default selection, avatar library access, and optional product images. Assert the proposal flow preselects the default preset/avatar, allows no style/no avatar, displays product text even with zero images, never labels a style image as an avatar, and sends only IDs/revisions/null.

Verify loading, empty, upload failure, stale selection, partial upload cleanup, archived selection, and retry states. Preserve existing URL, proposal selection, attachments, start-generation action, and accessibility labels.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/customer-ui -- --run src/features/libraries/libraryGateway.test.ts src/components/brand-center/BrandStylePresetPanel.test.tsx src/components/brand-center/ProductAssetEditor.test.tsx src/components/ai-content/ManualVisualSelectionStep.test.tsx src/components/ai-content/ContentProposalFlow.test.tsx
```

- [ ] **Step 3: Implement minimal UI and gateways**

Do not add a product-image selector in generation: selecting the product selects its approved text and available images; the final planner decides per scene. Do not import or display unlinked old style references in the preset chooser.

- [ ] **Step 4: Run GREEN, UI typecheck/build, commit**

## Task 7: Planner Selection, Image Staging, and Audit

**Files:**
- Modify Card: `workers/brand-pilot-card-news-worker/src/sourceBundle.ts`, `promptBuilder.ts`, `worker.ts` and tests.
- Modify Reel: `workers/brand-pilot-reel-worker/src/promptBuilder.ts`, `worker.ts` and tests.
- Modify Blog: `workers/brand-pilot-blog-worker/src/promptBuilder.ts`, `worker.ts` and tests.
- Modify API: `apps/api/src/aiContentPlanContracts.ts`, `apps/api/src/aiContentRenderJobs.ts` and tests.
- Modify Image: `workers/brand-pilot-image-worker/src/aiContentAssetRenderer.ts`, `aiContentAssetRenderer.test.ts`, `promptBuilder.ts`, `promptBuilder.test.ts`.

- [ ] **Step 1: Write failing planner/staging tests**

Assert all formats receive product description/features/benefits. Card/Reel can select frozen product/avatar/reference IDs per scene; Blog can use them only for a planned inline image and may produce no image. Assert selected IDs only are staged, storage metadata is projected out of model prompts, selected style tokens/references reach deterministic prompt compilation, and `package_finalize` is inserted/executed exactly once.

- [ ] **Step 2: Write failing diagnostic tests**

Extend existing editorial diagnostic JSON with only IDs/revisions/counts/hashes/versions, render duration, attempt, terminal code, worker/release revision, and explicit `not_emitted_by_runner`. Assert raw prompts, source content, storage URLs/pathnames, and checksums are absent.

- [ ] **Step 3: Run RED, implement, run GREEN**

Run focused Card/Reel/Blog/Image/API render suites. Keep the existing format-specific planner calls; do not add another model call or combine format contracts.

- [ ] **Step 4: Commit**

Commit only planner/render/diagnostic files.

## Task 8: Quality Cases, Regression Matrix, and Handoff Captures

**Files:**
- Create: `scripts/ai-content-quality-cases.mjs`
- Create: `scripts/ai-content-quality-cases.test.mjs`
- Create: `docs/operations/manual-ai-content-visual-quality.md`
- Modify: `scripts/release-impact.mjs`
- Modify: `scripts/release-impact.test.mjs`

- [ ] **Step 1: Write failing case-manifest tests**

The manifest uses exactly this source URL for every case:

```text
https://www.theverge.com/streaming/977474/youtube-partner-program-new-requirements
```

Cases: no product/style/avatar; product text/no image; product+image; style only; style+default avatar; product+image+style+avatar. The script emits a read-only JSON/HTML report linking input selections, proposal, generation ID, per-scene render, timing/attempts, and selected staged IDs. It never scores, retries, regenerates, or deploys.

- [ ] **Step 2: Run RED, implement report generator, run GREEN**

```powershell
node --test scripts/ai-content-quality-cases.test.mjs
```

- [ ] **Step 3: Run the full approved regression matrix**

Run generated-contract checks; focused API/UI/library/proposal/Card/Reel/Blog/Image tests; typechecks/builds; migration/catalog/static/release-impact tests; `git diff --check`; protected automatic-source diff checks.

- [ ] **Step 4: Local manual QA and screenshots**

Run the six cases against the local integrated API/UI. Capture selection settings, proposal, full deck, individual scene images, timing, attempts, and actual staged IDs for each case. Present captures to the user for judgment; do not apply an automated quality score.

- [ ] **Step 5: Final review and commit**

Commit report/runbook/release-scope files. Do not merge or deploy until the user approves the captured results.

## Self-Review

- Spec coverage: 1B named presets/default, 2A default avatar/change/none, 3B no old import/fallback, optional product images, product text, manual-only Fast, existing reasoning/model, one packaging run, automatic/old queue exclusions, and user-judged six-case captures are each assigned to a task.
- Placeholder scan: no TBD/TODO or undefined future behavior remains.
- Type consistency: `manual-visual-selection.v1` is the only new manual sidecar; style preset and product-image contracts are independently versioned; all later tasks reference the same IDs/revisions/null semantics.
