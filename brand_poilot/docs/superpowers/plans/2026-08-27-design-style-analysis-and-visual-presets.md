# Design Style Analysis and Visual Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manually authored visual tokens and separate style/avatar generation choices with image-based design styles, asynchronous analysis, and one post-proposal visual preset selection, while removing `brandRules.designRules` from new operations.

**Architecture:** Keep confirmed brand reference images as the storage primitive, add design-style and analysis-job records, and convert `brand_style_presets` into a design-style plus optional-avatar combination. Extend the existing Brand Intelligence Worker with a second claim lane so no new production service is introduced. New manual generations freeze `manual-visual-selection.v2`; historical V1 generation snapshots remain readable.

**Tech Stack:** PostgreSQL migrations, TypeScript, Fastify, React/Vite, TypeBox, Vitest, Codex CLI vision input, existing worker leases and Vercel Blob upload verification.

---

## Decision Coverage

| Current decision | Authoritative source | Plan disposition | Verification |
|---|---|---|---|
| Design style and avatar are image-registration concepts | Approved 2026-08-27 conversation and design spec | Tasks 2, 4, 6 | UI tests contain no manual color/font/layout inputs and mount avatar image management |
| Style values are produced asynchronously | Approved 2026-08-27 design | Tasks 2, 3, 5 | queued/processing/ready/failed repository and worker tests |
| Preset may be saved while style is analyzing | Approved conversation | Tasks 2, 4, 6 | API and UI tests save an analyzing preset |
| Analyzing/failed preset cannot be used | Approved conversation | Tasks 4, 6, 7 | default/start/freeze rejection tests and disabled UI state |
| Default belongs to preset, not style or avatar | Approved conversation | Tasks 2, 4, 6 | only usable preset default endpoint and auto-selection tests |
| No preset in initial setup; select after proposal | Approved correction | Task 6 | `ContentProposalFlow` test asserts no preset request before proposal selection |
| Preset combines design style and optional avatar | Approved conversation | Tasks 2–7 | contract, repository, UI, and frozen V2 tests |
| Remove preset archive feature | Approved conversation | Tasks 4 and 6 | route and UI source tests contain no archive action |
| Remove operational-rule design values and stop recreating them | Approved conversation plus repository inspection | Tasks 2, 3, 4, 7 | migration JSON checks, V2 parser tests, onboarding/readiness tests |
| Preserve already frozen generation inputs, not unfrozen development drafts | Approved design plus user clarification that this is not in production | Tasks 2, 3 and 7 | frozen V1 retry fixture remains readable; V1 draft write is rejected |
| Card/Reel final planning and image creation use frozen style analysis | Earlier accepted ON quality scope plus approved design | Task 7 | focused Card/Reel/Image prompt and staging tests |
| Blog strategy is unchanged | Scope boundary from prior ON plan | Task 7 compatibility only | Blog contract test passes with V2 rules and no editorial prompt change |
| Avoid a new runtime service | Approved detailed design | Tasks 5 and 8 | release impact changes existing Brand Intelligence Worker image only |
| Existing relevant baseline failure is not hidden | Baseline run on `a77e83a` | Task 1 | focused API suite returns 24/24 pass before feature edits |

### Superseded or Excluded

- `2026-08-14-manual-brand-visual-assets.md` manually entered `visualTokens` and separate style/avatar generation controls are superseded by the approved design-style analysis and combined preset decisions.
- Existing avatar `isDefault` storage may remain, but new UI and selection logic do not read or set it. Dropping that column is excluded because it is unnecessary to the approved behavior.
- No expression-method or emphasis-angle UI, proposal schema field, duplicate-verifier model, density gate, second-scene rule, or mandatory CTA is part of this plan.
- Existing product image behavior is unchanged except for the baseline test correction in Task 1.

## Impact and Side-Effect Analysis

| Existing working behavior | Regression risk | Required containment and proof |
|---|---|---|
| Product/service selection and images | Shared manual-visual code change can break product freeze or image deletion | Preserve product V2 fields; Task 1 baseline fix; product/no-product freeze and image lifecycle tests |
| Avatar create/edit/image consistency | Combining avatar into preset can remove avatar management or mix roles | Keep avatar CRUD/upload; mount existing panel; preset stores avatar ID; Image Worker stages avatar separately |
| Proposal generation and selection | Loading preset too early can contaminate proposal input or block selection | No asset API calls before `selectProposal`; Proposal contract unchanged by this plan |
| Attachments and user image instruction | Replacing visual step can drop existing fields | Keep uploader, roles, readiness, `userImageInstruction` and finalization draft unchanged; UI/API tests |
| Card/Reel/Blog generation | `brand-rules.v2` can break parsers or remove non-design rules | V1/V2 frozen read tests; V2 required/forbidden/CTA/channel rules passed unchanged; focused worker suites |
| Retry and render-only retry | Re-resolving current preset can change a prior output | Copy the parent frozen V1/V2 payload exactly; never query current default/style on retry |
| Scheduled proposal flow | Server default injection can bypass post-proposal choice | No automatic preset injection; scheduled proposal remains proposal-only and uses the normal visual step after selection |
| Onboarding content | New style dependency can block first content before a style exists | Onboarding remains preset-free, matching its current empty style-image behavior |
| `프리셋 사용 안 함` | Hidden `designRules` fallback can still alter images | Remove all new rule-derived style reads; none means no style, by explicit user approval |
| Default preset | An analyzing default can be auto-selected or race with edits | Derived usability on every list/default/freeze; optimistic revision and database lock tests |
| Style analysis | Stale job can overwrite a newer image revision | style revision plus lease-token completion fence and stale-completion test |
| Brand Intelligence analysis | Second queue can delay existing onboarding analysis | Claim brand-analysis queue first; claim style only when empty; shared resource lease and priority test |
| Reference library | Moving references can orphan or cross-link images | Composite tenant FKs, copy-count migration checks, `on delete restrict`, no blob deletion in migration |
| DB permissions | New transaction can pass as owner but fail in app | Execute migration/job/default/freeze transactions using actual PostgreSQL application role |
| UI/API deployment order | Old bundle sends V1 while new API requires V2 | Compatible readers first, API then UI; V1 write returns refresh-required; this is development data, so no dual-write layer |
| Rollback | Old binaries cannot read V2 rows after migration | Preserve rollback images that already contain V1/V2 readers; keep migration installed; do not roll back to pre-contract binaries |

The full source-path matrix and excluded compatibility behavior are in `docs/superpowers/specs/2026-08-27-design-style-analysis-and-visual-presets-design.md`. Every Task below maps to at least one row above; no extra telemetry, fallback or migration is authorized beyond those rows.

## File Structure

- `db/migrations/093_design_style_analysis_visual_presets.sql`: design-style tables/jobs, expand-only preset conversion, grants and maintenance fence.
- `packages/brand-pilot-content-contracts/src/designStyle.ts`: closed analysis schema and parser.
- `packages/brand-pilot-content-contracts/src/snapshots.ts`: `brand-rules.v2` and V1/V2 snapshot reading.
- `packages/brand-pilot-content-contracts/src/manualVisualSelection.ts`: V2 selection/frozen contracts while retaining V1 readers.
- `apps/api/src/designStyleContracts.ts`: customer and worker request parsers.
- `apps/api/src/designStyleRepository.ts`: tenant-scoped style/preset CRUD, derived usability, jobs and revision fencing.
- `apps/api/src/manualVisualAssetsRepository.ts`: V2 freeze and legacy V1 read path.
- `apps/api/src/brandCoreContracts.ts`, `brandRulesReadiness.ts`, `brandCoreRepository.ts`, `onboardingContent.ts`: new writes use `brand-rules.v2` without design values.
- `workers/brand-pilot-brand-intelligence-worker/src/styleAnalysis*.ts`: image download/checksum, vision prompt, closed output parsing and style-job execution.
- `apps/customer-ui/src/components/brand-center/DesignStylePanel.tsx`: image-only style creation and analysis states.
- `apps/customer-ui/src/components/brand-center/VisualPresetPanel.tsx`: style plus optional avatar preset management.
- `apps/customer-ui/src/components/ai-content/ManualVisualSelectionStep.tsx`: one preset chooser after proposal selection.
- Card/Reel/Blog/Image prompt and staging files: consume V2 rules and frozen V2 visual context.

### Task 1: Restore the Relevant Clean Baseline

**Files:**
- Modify: `apps/api/src/manualVisualAssetsRepository.test.ts:55`
- Test: `apps/api/src/manualVisualAssetsRepository.test.ts`

- [ ] **Step 1: Correct the stale query mock**

The repository now performs an unlocked version-ID lookup before acquiring the canonical product-version lock. Make the test return the version for that exact first query and keep the second full-row lookup separate:

```ts
if (sql.includes("select asset.product_service_version_id") && sql.includes("where asset.id=$1")) {
  return { rows: [{ product_service_version_id: "version-1" }], rowCount: 1 };
}
if (sql.includes("select asset.id,asset.storage_artifact_id") && sql.includes("where asset.id=$1")) {
  return { rows: [{
    id: "image-1", storage_artifact_id: "artifact-1", product_service_version_id: "version-1",
    role: "hero", position: 1,
  }], rowCount: 1 };
}
```

- [ ] **Step 2: Run the exact baseline suite**

```powershell
npm test --workspace @brand-pilot/api -- --run src/manualVisualAssetsContracts.test.ts src/manualVisualAssetsRepository.test.ts src/brandCoreContracts.test.ts
```

Expected: 3 files and 24 tests pass.

- [ ] **Step 3: Commit the baseline correction**

```powershell
git add apps/api/src/manualVisualAssetsRepository.test.ts
git commit -m "test(api): align product image deletion lock mock"
```

### Task 2: Add the Database State Machine and Migrate Existing Data

**Files:**
- Create: `db/migrations/093_design_style_analysis_visual_presets.sql`
- Modify: `scripts/migrations.integration.test.mjs`
- Modify: `scripts/repository-contract.test.mjs`
- Modify: `scripts/ai-content-database-catalog.mjs`
- Modify: `scripts/ai-content-database-catalog.test.mjs`
- Modify: `scripts/ai-content-database-roles.mjs`

- [ ] **Step 1: Write failing migration contract tests**

Assert the migration creates these identities and constraints:

```sql
brand_design_styles(id,workspace_id,brand_id,name,revision,analysis_status,
  analysis_contract_version,analysis_json,analysis_sha256,analysis_error_code,
  created_by_user_id,created_at,updated_at)
brand_design_style_references(id,workspace_id,brand_id,design_style_id,
  reference_item_id,position)
brand_design_style_analysis_jobs(id,workspace_id,brand_id,design_style_id,
  style_revision,status,attempt_count,max_attempts,available_at,leased_by,
  lease_token,lease_expires_at,error_code,created_at,updated_at)
```

Also assert:

```sql
analysis_status in ('queued','processing','ready','failed')
ready => analysis_contract_version='design-style-analysis.v1'
         and analysis_json is not null and analysis_sha256 is not null
not ready => analysis_json is null and analysis_sha256 is null
unique(design_style_id,style_revision)
unique(design_style_id,reference_item_id)
unique(design_style_id,position)
```

Assert `brand_style_presets` gains nullable-then-backfilled non-null `design_style_id`, nullable `avatar_id`, and keeps one active default per brand. Assert old preset reference rows are copied to design-style references and one queued analysis job is created per migrated active preset. Preserve preset `description`/`visual_tokens_json` plus `brand_style_preset_references` as read-only rollout compatibility until a later contract migration; the new API and UI must not use them.

Assert existing `brand_rule_sets.rules_json` rows are not rewritten by 093. New readers normalize V1 to V2 in memory, while all new rule writes remain V2 without `designRules`.

Do not update `ai_content_*` frozen JSON columns.

- [ ] **Step 2: Run RED**

```powershell
node --test scripts/repository-contract.test.mjs scripts/ai-content-database-catalog.test.mjs
```

Expected: missing migration, tables, fields, catalog and ACL registrations.

- [ ] **Step 3: Implement migration with application-role grants**

Use composite ownership foreign keys for every brand-owned relation, install a canonical-name maintenance fence without mutating the sealed 075 fence catalog, and grant the application role only the operations used by the repository:

```sql
grant select,insert,update on brand_design_styles to <application_role>;
grant select,insert,update,delete on brand_design_style_references to <application_role>;
grant select,insert,update on brand_design_style_analysis_jobs to <application_role>;
```

The migration must fail if an active legacy preset has zero valid image references; do not create a falsely ready style or silently drop the preset. Report the count of unfrozen V1 development drafts before cutover, but do not add a compatibility table or convert them into hidden presets.

- [ ] **Step 4: Run migration tests including real PostgreSQL role execution**

```powershell
node --test scripts/repository-contract.test.mjs scripts/ai-content-database-catalog.test.mjs scripts/migrations.integration.test.mjs
```

Expected: migration 093 applies under the schema-owner role and the changed transactions pass under the minimum application role; a skipped PostgreSQL role test is reported as not run, not pass.

- [ ] **Step 5: Commit**

```powershell
git add db/migrations/093_design_style_analysis_visual_presets.sql scripts/migrations.integration.test.mjs scripts/repository-contract.test.mjs scripts/ai-content-database-catalog.mjs scripts/ai-content-database-catalog.test.mjs scripts/ai-content-database-roles.mjs
git commit -m "feat(db): add analyzed design styles and visual presets"
```

### Task 3: Version Shared Rules and Visual Selection Contracts

**Files:**
- Create: `packages/brand-pilot-content-contracts/src/designStyle.ts`
- Create: `packages/brand-pilot-content-contracts/src/designStyle.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/snapshots.ts`
- Modify: `packages/brand-pilot-content-contracts/src/schemas.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/manualVisualSelection.ts`
- Modify: `packages/brand-pilot-content-contracts/src/manualVisualSelection.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/index.ts`
- Modify: `packages/brand-pilot-content-contracts/src/generateArtifacts.ts`

- [ ] **Step 1: Write failing closed-contract tests**

Define `DesignStyleAnalysisV1Schema` exactly as approved in the design spec, with `additionalProperties:false`, unique trimmed strings, and bounded lists. Define rules V2 without `designRules`:

```ts
export const BrandRulesContentV2Schema = Type.Object({
  contractVersion: Type.Literal("brand-rules.v2"),
  requiredPhrases: Type.Array(RuleTextSchema, { maxItems: 20 }),
  forbiddenPhrases: Type.Array(RuleTextSchema, { maxItems: 20 }),
  exaggerationRules: Type.Array(RuleTextSchema, { maxItems: 20 }),
  ctaRules: CtaRulesSchema,
  channelRules: ChannelRulesSchema,
  autoApprovalRules: AutoApprovalRulesSchema,
}, { additionalProperties: false });
```

Define new selection and frozen shapes:

```ts
export const ManualVisualSelectionV2Schema = Type.Object({
  contractVersion: Type.Literal("manual-visual-selection.v2"),
  product: ProductSelectionSchema,
  preset: Type.Union([Type.Null(), Type.Object({
    presetId: UuidSchema,
    revision: RevisionSchema,
  }, { additionalProperties: false })]),
}, { additionalProperties: false });
```

The frozen preset contains the preset identity, ready design-style identity/revision/analysis/reference IDs, and optional avatar identity/revision/image IDs. Reject storage URLs, paths, checksums and unknown keys in public selection; retain them only in server-private materialized asset records.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/content-contracts -- --run src/designStyle.test.ts src/manualVisualSelection.test.ts src/schemas.test.ts
```

- [ ] **Step 3: Implement parsers and V1 read compatibility**

Export:

```ts
parseDesignStyleAnalysisV1(value)
parseBrandRulesContent(value) // accepts V1 or V2 for historical reads
parseBrandRulesContentV2(value) // new writes only
parseManualVisualSelection(value) // accepts V1 or V2 for reads
parseManualVisualSelectionV2(value) // new writes only
parseFrozenManualVisualSelection(value) // accepts frozen V1 or V2
```

Do not synthesize an empty `designRules` object when reading V2.

- [ ] **Step 4: Generate schemas and run GREEN**

```powershell
npm run generate --workspace @brand-pilot/content-contracts
npm run check:generated --workspace @brand-pilot/content-contracts
npm test --workspace @brand-pilot/content-contracts -- --run src/designStyle.test.ts src/manualVisualSelection.test.ts src/schemas.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add packages/brand-pilot-content-contracts
git commit -m "feat(contracts): version analyzed visual preset inputs"
```

### Task 4: Implement API Design Styles, Presets, Rules V2, and Freeze Enforcement

**Files:**
- Create: `apps/api/src/designStyleContracts.ts`
- Create: `apps/api/src/designStyleContracts.test.ts`
- Create: `apps/api/src/designStyleRepository.ts`
- Create: `apps/api/src/designStyleRepository.pglite.test.ts`
- Modify: `apps/api/src/manualVisualAssetsRepository.ts`
- Modify: `apps/api/src/manualVisualAssetsRepository.test.ts`
- Modify: `apps/api/src/brandCoreContracts.ts`
- Modify: `apps/api/src/brandCoreContracts.test.ts`
- Modify: `apps/api/src/brandRulesReadiness.ts`
- Modify: `apps/api/src/brandRulesReadinessMigration.pglite.test.ts`
- Modify: `apps/api/src/brandCoreRepository.ts`
- Modify: `apps/api/src/brandCoreRepository.test.ts`
- Modify: `apps/api/src/onboardingContent.ts`
- Modify: `apps/api/src/onboardingContent.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.brandCenterCustomer.test.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write failing customer contract and repository tests**

Use exact public inputs:

```ts
type DesignStyleInputV1 = {
  contractVersion: "design-style-input.v1";
  name: string;
  referenceItemIds: string[]; // 1..5
};
type VisualPresetInputV1 = {
  contractVersion: "visual-preset-input.v1";
  name: string;
  designStyleId: string;
  avatarId: string | null;
  isDefault: boolean;
};
```

Cover tenant ownership, reference MIME/status, optimistic revision, image-edit requeue, stale analysis completion, preset creation with queued style, default rejection unless usable, avatar-unavailable derivation, and start/freeze rejection for unusable or stale presets.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- --run src/designStyleContracts.test.ts src/designStyleRepository.pglite.test.ts src/manualVisualAssetsRepository.test.ts src/brandCoreContracts.test.ts src/onboardingContent.test.ts
```

- [ ] **Step 3: Implement authenticated customer routes**

```text
GET  /brands/:brandId/design-styles
POST /brands/:brandId/design-styles
PATCH /brands/:brandId/design-styles/:styleId
POST /brands/:brandId/design-styles/:styleId/retry
GET  /brands/:brandId/visual-presets
POST /brands/:brandId/visual-presets
PATCH /brands/:brandId/visual-presets/:presetId
POST /brands/:brandId/visual-presets/:presetId/default
```

Remove the old style-preset archive route and do not add a replacement delete/archive route in this scope. Preset list rows include:

```ts
usability: { usable: boolean; reason: null | "style_analyzing" | "style_analysis_failed" | "avatar_unavailable" };
```

- [ ] **Step 4: Make all new operational-rule writes V2**

Replace `normalizeBrandRulesV1` with `normalizeBrandRulesV2`, remove reference validation against `rules.designRules`, remove design defaults from onboarding and `BrandCenterPage.emptyRules`, and parse new saves through `parseBrandRulesContentV2`. Keep a V1 parser only at frozen snapshot read boundaries.

- [ ] **Step 5: Freeze V2 atomically at generation start**

Lock generation → preset → design style → avatar in one documented order. Require the exact selected preset revision and style `analysis_status='ready'`, then persist:

```ts
{
  contractVersion: "manual-visual-selection-frozen.v2",
  product,
  preset: {
    presetId, revision, name,
    designStyle: { designStyleId, revision, analysis, referenceItemIds },
    avatar: avatarOrNull,
  },
}
```

Return `visual_preset_not_usable` or `visual_preset_revision_stale` before planner/render work.

- [ ] **Step 6: Run GREEN and typecheck**

```powershell
npm test --workspace @brand-pilot/api -- --run src/designStyleContracts.test.ts src/designStyleRepository.pglite.test.ts src/manualVisualAssetsRepository.test.ts src/brandCoreContracts.test.ts src/brandRulesReadinessMigration.pglite.test.ts src/brandCoreRepository.test.ts src/onboardingContent.test.ts src/server.brandCenterCustomer.test.ts
npm run typecheck --workspace @brand-pilot/api
```

- [ ] **Step 7: Commit**

```powershell
git add apps/api/src
git commit -m "feat(api): manage analyzed styles and usable presets"
```

### Task 5: Add the Style-Analysis Lane to Brand Intelligence Worker

**Files:**
- Create: `workers/brand-pilot-brand-intelligence-worker/src/styleAnalysisContracts.ts`
- Create: `workers/brand-pilot-brand-intelligence-worker/src/styleAnalysisContracts.test.ts`
- Create: `workers/brand-pilot-brand-intelligence-worker/src/styleAnalysisPrompt.ts`
- Create: `workers/brand-pilot-brand-intelligence-worker/src/styleAnalysisPrompt.test.ts`
- Create: `workers/brand-pilot-brand-intelligence-worker/src/styleAnalysisWorker.ts`
- Create: `workers/brand-pilot-brand-intelligence-worker/src/styleAnalysisWorker.test.ts`
- Create: `workers/brand-pilot-brand-intelligence-worker/scripts/run-codex-style-analysis.mjs`
- Modify: `workers/brand-pilot-brand-intelligence-worker/src/client.ts`
- Modify: `workers/brand-pilot-brand-intelligence-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-brand-intelligence-worker/src/index.ts`
- Modify: `workers/brand-pilot-brand-intelligence-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-brand-intelligence-worker/Dockerfile`

- [ ] **Step 1: Write failing job and vision-runner tests**

The claim contract must bind job/style/revision/image IDs/checksums and allow only 1..5 owned PNG/JPEG/WebP images. The runner command must include every verified local path as repeated image arguments:

```js
["exec", "--ignore-user-config", "--ignore-rules", "-m", model,
 "-c", `model_reasoning_effort="${effort}"`,
 ...imagePaths.flatMap((file) => ["--image", file]),
 "--disable", "shell_tool", "--disable", "apps", "--disable", "browser_use",
 "--disable", "image_generation", "--disable", "multi_agent",
 "--output-schema", schemaFile, "--sandbox", "read-only", "-"]
```

Cover checksum mismatch, non-image MIME, oversized image, lost lease, stale completion, schema failure, cleanup on success/failure, and safe error codes without URL/path leakage.

- [ ] **Step 2: Add worker API job endpoints before runner implementation**

**Files additionally modified:**
- `apps/api/src/designStyleRepository.ts`
- `apps/api/src/httpServer.ts`
- `apps/api/src/server.brandCenterWorker.test.ts`

```text
POST /worker/design-style-analyses/claim
POST /worker/design-style-analyses/:jobId/heartbeat
POST /worker/design-style-analyses/:jobId/complete
POST /worker/design-style-analyses/:jobId/fail
```

Completion succeeds only when lease token, job status, style ID and style revision still match.

- [ ] **Step 3: Implement one-call style analysis**

Use the approved analysis schema. The prompt explicitly states:

```text
이미지에서 직접 관찰되는 시각 구조만 분석한다.
콘텐츠 사실, 제품 효익, 비교 결론, 브랜드 성과를 추론하지 않는다.
모든 이미지를 하나의 스타일 묶음으로 보고 반복되는 규칙과 변형 범위를 기록한다.
설명이나 Markdown 없이 design-style-analysis.v1 JSON 하나만 반환한다.
```

The existing watch loop tries the existing brand-analysis queue first and the style-analysis queue when no brand job is claimed. It acquires the same `codex-cli` resource lease with workload `design_style_analysis`.

- [ ] **Step 4: Run GREEN and build**

```powershell
npm test --workspace @brand-pilot/brand-intelligence-worker -- --run src/styleAnalysisContracts.test.ts src/styleAnalysisPrompt.test.ts src/styleAnalysisWorker.test.ts src/worker.test.ts
npm run build --workspace @brand-pilot/brand-intelligence-worker
```

- [ ] **Step 5: Commit**

```powershell
git add workers/brand-pilot-brand-intelligence-worker apps/api/src/designStyleRepository.ts apps/api/src/httpServer.ts apps/api/src/server.brandCenterWorker.test.ts
git commit -m "feat(worker): analyze uploaded design style images"
```

### Task 6: Replace Brand Center and Post-Proposal Visual UI

**Files:**
- Create: `apps/customer-ui/src/components/brand-center/DesignStylePanel.tsx`
- Create: `apps/customer-ui/src/components/brand-center/DesignStylePanel.test.tsx`
- Create: `apps/customer-ui/src/components/brand-center/VisualPresetPanel.tsx`
- Create: `apps/customer-ui/src/components/brand-center/VisualPresetPanel.test.tsx`
- Delete: `apps/customer-ui/src/components/brand-center/StyleReferenceImageBoard.tsx`
- Delete: `apps/customer-ui/src/components/brand-center/StyleReferenceImageBoard.test.tsx`
- Delete: `apps/customer-ui/src/components/brand-center/BrandStylePresetPanel.tsx`
- Delete: `apps/customer-ui/src/components/brand-center/BrandStylePresetPanel.test.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/AvatarLibraryPanel.tsx`
- Modify: `apps/customer-ui/src/pages/BrandCenterPage.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/BrandRulesPanel.tsx`
- Modify: `apps/customer-ui/src/features/libraries/libraryGateway.ts`
- Modify: `apps/customer-ui/src/features/libraries/libraryGateway.test.ts`
- Modify: `apps/customer-ui/src/features/brand-center/brandCenterGateway.ts`
- Modify: `apps/customer-ui/src/components/ai-content/ManualVisualSelectionStep.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ManualVisualSelectionStep.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalFlow.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalFlow.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandCenter.test.tsx`

- [ ] **Step 1: Write failing Brand Center tests**

Assert the Style tab renders exactly three sections in order: 디자인 스타일, 아바타, 프리셋. Design style form contains name and image upload only; it has no 대표 색상, 폰트 방향, 레이아웃 메모, 태그 or 설명 inputs. Show status copy:

```ts
const styleStatusLabel = {
  queued: "분석 대기 중",
  processing: "분석 중",
  ready: "사용 가능",
  failed: "분석 실패",
};
```

Assert preset save permits analyzing styles, default is disabled for them, archive controls are absent, and failed styles expose `다시 분석`.

- [ ] **Step 2: Write failing content-flow tests**

Assert initial setup does not call design-style, avatar or preset APIs. After proposal selection, load visual presets once; auto-select only a default whose `usability.usable` is true. Render analyzing/failed presets disabled with reasons, allow `프리셋 사용 안 함`, and send only V2 product plus preset ID/revision.

- [ ] **Step 3: Implement gateways and components**

Replace separate style/avatar state with:

```ts
const [visualPresets, setVisualPresets] = useState<VisualPreset[]>([]);
const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
```

Generation payload:

```ts
const manualVisualSelection = {
  contractVersion: "manual-visual-selection.v2" as const,
  product: approvedProduct?.activeVersion
    ? { productServiceId: approvedProduct.id, versionId: approvedProduct.activeVersion.id }
    : null,
  preset: selectedPreset ? { presetId: selectedPreset.id, revision: selectedPreset.revision } : null,
};
```

Remove design inputs and the lower rule-backed style image board from Brand Center. Mount `AvatarLibraryPanel` in the Style tab, but remove its default-setting control from the visible UI.

- [ ] **Step 4: Run GREEN and build**

```powershell
npm test --workspace @brand-pilot/customer-ui -- --run src/components/brand-center/DesignStylePanel.test.tsx src/components/brand-center/VisualPresetPanel.test.tsx src/__tests__/avatarLibrary.test.tsx src/components/ai-content/ManualVisualSelectionStep.test.tsx src/components/ai-content/ContentProposalFlow.test.tsx src/__tests__/brandCenter.test.tsx src/features/libraries/libraryGateway.test.ts
npm run build --workspace @brand-pilot/customer-ui
```

- [ ] **Step 5: Commit**

```powershell
git add apps/customer-ui/src
git commit -m "feat(ui): manage analyzed styles and combined presets"
```

### Task 7: Remove Design Rules from New Content and Consume Frozen Presets

**Files:**
- Modify: `apps/api/src/approvedBrandContextProvider.ts`
- Modify: `apps/api/src/aiContentSnapshotRepository.ts`
- Modify: `apps/api/src/aiContentSnapshotRepository.test.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/assetLibraryRepository.ts`
- Modify: `apps/api/src/aiContentFixedInputAssembler.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/sourceBundle.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-reel-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-blog-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-blog-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentManualAssetPromptV2Common.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentManualAssetPromptV2.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentVisualSessionRenderer.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentVisualSessionRenderer.test.ts`
- Modify: `workers/brand-pilot-image-worker/test/fixtures/manualRender.ts`

- [ ] **Step 1: Write failing no-fallback tests**

Assert new snapshot SQL never traverses `'{designRules,referenceImages}'`, new Card/Reel/Blog prompts do not contain `rules.designRules`, and the new image prompt receives style data only from frozen V2 preset. Retain one V1 historical snapshot fixture proving old queued/completed jobs still parse.

- [ ] **Step 2: Write frozen-style application tests**

Card and Reel prompt input receives:

```ts
visualPreset: frozen.preset && {
  name: frozen.preset.name,
  designStyle: frozen.preset.designStyle.analysis,
  hasAvatar: frozen.preset.avatar !== null,
}
```

The manuscript prompt uses layout, hierarchy, typography, color and `promptGuidance` only for screen composition. It states that style analysis is not factual evidence. The image worker stages the frozen design-style reference IDs and optional avatar image IDs, verifies stored checksum at download, and attaches them under distinct roles.

- [ ] **Step 3: Remove old rule consumers and implement V2 materialization**

Delete rule-derived style reference queries from `aiContentSnapshotRepository.ts`, `aiContentRepository.ts`, and `assetLibraryRepository.ts`. Do not replace them with a fallback. Blog receives V2 rule text and optional frozen visual preset but no editorial strategy changes.

- [ ] **Step 4: Run focused GREEN suites**

```powershell
npm test --workspace @brand-pilot/api -- --run src/aiContentSnapshotRepository.test.ts src/aiContentFixedInputAssembler.test.ts src/aiContentRepositoryV3Start.test.ts
npm test --workspace @brand-pilot/card-news-worker -- --run src/promptBuilder.test.ts src/worker.test.ts
npm test --workspace @brand-pilot/reel-worker -- --run src/promptBuilder.test.ts src/worker.test.ts
npm test --workspace @brand-pilot/blog-worker -- --run src/promptBuilder.test.ts
npm test --workspace @brand-pilot/image-worker -- --run src/aiContentManualAssetPromptV2.test.ts src/aiContentVisualSessionRenderer.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src workers/brand-pilot-card-news-worker workers/brand-pilot-reel-worker workers/brand-pilot-blog-worker workers/brand-pilot-image-worker
git commit -m "feat(content): consume frozen analyzed visual presets"
```

### Task 8: Release Contracts, Development Integration, and Browser QA

**Files:**
- Modify: `scripts/release-impact.mjs`
- Modify: `scripts/release-impact.test.mjs`
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `scripts/worker-cli-only-contract.test.mjs`
- Modify: `docs/operations/DEVELOPMENT_AND_RELEASE_FLOW.md`

- [ ] **Step 1: Register the changed existing services**

Map migration/API/UI/content-contract changes to API and UI; map style analysis changes to the existing Brand Intelligence Worker image; map frozen-preset consumers to Card, Reel, Image and compatibility-only Blog images. Do not create `STYLE_ANALYSIS_WORKER_IMAGE` or a new compose service.

- [ ] **Step 2: Run the proportionate pre-deployment matrix**

```powershell
npm run check:generated --workspace @brand-pilot/content-contracts
npm run typecheck --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/customer-ui
node --test scripts/repository-contract.test.mjs scripts/release-impact.test.mjs scripts/deployment-contract.test.mjs scripts/worker-cli-only-contract.test.mjs
git diff --check
```

Expected: pass. Run the migration role test from Task 2; do not substitute a PGlite-only result for PostgreSQL application-role evidence.

- [ ] **Step 3: Inspect the development deployment identity before mutation**

Record remote `main`, development release SHA, API/UI/Brand-Intelligence/Card/Reel/Blog/Image digests, dirty/hotfix state, health/ready, heartbeat and rollback digests. Stop if the running development image source differs from the expected release or an unrelated hotfix would be overwritten.

- [ ] **Step 4: Deploy only affected immutable images**

Apply migration 093, canary and promote the API, then replace the existing Brand Intelligence Worker and the listed content consumers by digest. Publish the UI build after API readiness. Do not recreate unrelated workers or scheduled jobs.

- [ ] **Step 5: Verify the integrated development browser behavior**

Using the signed-in development browser:

1. Register a design style image and capture `분석 대기 중/분석 중`.
2. Create a preset pointing to it and verify save succeeds but selection/default is blocked.
3. Wait for `사용 가능`, set it default, and verify the content initial setup still shows no preset.
4. Generate proposals, select one, verify the default preset appears only now, and generate one informational Card, one informational Reel, one marketing Card and one marketing Reel.
5. Inspect full outputs for style resemblance, avatar role, first/middle/final progression, essential facts, natural Korean and optional CTA.
6. Verify generation IDs, attempts, per-scene image calls, worker logs and no `designRules` reads in the new jobs.

- [ ] **Step 6: Report exact results and hold the Production gate**

Separate passed, failed and not-run checks. Report release SHA, changed/unchanged digests, migration checksum, application-role result, browser generation IDs, style analysis job ID/status/attempts, health/ready/heartbeat/restart/error-log evidence, and the exact per-service rollback digests. Do not deploy this development feature to Production until the user approves the integrated browser results and a fresh Production impact check.
