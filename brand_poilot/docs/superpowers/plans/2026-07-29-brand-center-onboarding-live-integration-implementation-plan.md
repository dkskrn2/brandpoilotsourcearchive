# Brand Center and Onboarding Live Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved live onboarding and six-tab Brand Center by reusing the existing analysis, revision, Wiki, product, reference-upload, and worker systems without removing legacy data or capabilities.

**Architecture:** The canonical routes keep their existing repositories and gateways. A bounded client poller controls onboarding status requests; the Brand Center composes revision-aware Core, category-filtered Wiki, product draft, and confirmed-reference image panels. Wiki provisioning stays outside onboarding: Instagram enable requests the first immediate build, while later product/service changes coalesce through the existing `wiki_build_requests.quiet_until` mechanism.

**Tech Stack:** React 18, TypeScript, React Router, Fastify, PostgreSQL/PGlite, Vercel Blob client uploads, Vitest, Testing Library, Playwright, Docker PostgreSQL.

---

## Scope and execution rules

- Worktree:
  `C:\Users\dkskr\.config\superpowers\worktrees\main\brand-pilot-d-hybrid\brand_poilot`
- Starting branch: `codex/brand-center-onboarding-screen`
- Starting committed HEAD: `db9d08a9466031f2bb9137bc2bf0de439a402377`
- Design authority:
  `docs/superpowers/specs/2026-07-29-brand-center-onboarding-live-integration-design.md`
- Never use `git reset --hard`, bulk `git restore .`, or delete the worktree.
- Never stage by directory while unrelated dirty files exist. Every commit command
  in this plan names exact files.
- `BrandCenterPage.tsx`, `brandCenter.test.tsx`, and
  `features/brand-center/types.ts` contain interrupted changes for multiple
  tasks. Until Task 5 has reconciled all remaining Style hunks, stage these
  mixed files with `git add -p -- <path>` and inspect `git diff --cached`;
  never stage the whole mixed file.
- Do not edit production environment files, Ubuntu configuration, secrets, OAuth
  configuration, or deployed data.
- Each implementation task starts with a failing test and ends with its own
  focused verification and commit.
- A task is not complete until its focused tests pass and `git diff --check`
  reports no errors.

## File responsibility map

| File | Responsibility |
| --- | --- |
| `apps/customer-ui/src/pages/LiveBrandCenterOnboarding.tsx` | Onboarding steps, resume lifecycle, and poller integration |
| `apps/customer-ui/src/features/brand-intelligence/boundedAnalysisPoller.ts` | Pure delay, retry, deadline, and request-budget policy |
| `apps/customer-ui/src/features/brand-intelligence/brandIntelligenceGateway.ts` | Abortable analysis GET |
| `apps/customer-ui/src/pages/BrandCenterPage.tsx` | Six-tab route composition and cross-panel dirty guard |
| `apps/customer-ui/src/components/brand-center/BrandCoreReviewPanel.tsx` | Core view/edit/revision actions |
| `apps/customer-ui/src/components/brand-center/BrandRulesPanel.tsx` | Preserved secondary operational rules |
| `apps/customer-ui/src/components/brand-center/KnowledgeCategoryEditorPanel.tsx` | Category-scoped Wiki workspace using existing Wiki editor behavior |
| `apps/customer-ui/src/components/brand-center/WikiLibraryPanel.tsx` | Preserved policy, issues, imports, and build-status controls |
| `apps/customer-ui/src/components/brand-center/ProductServiceEditor.tsx` | Product/service revision view/edit/save/cancel |
| `apps/customer-ui/src/components/brand-center/StyleReferenceImageBoard.tsx` | Confirmed style image uploads and board editing |
| `apps/api/src/brandCoreContracts.ts` | `referenceImages` JSON contract |
| `apps/api/src/brandCoreRepository.ts` | Same-brand confirmed image validation and rule persistence |
| `apps/api/src/repository.ts` | Instagram provisioning and Wiki scheduling policy |
| `workers/brand-pilot-dm-worker/src/db.ts` | Existing build/activation and 03:00 KST maintenance invariants |

### Task 0: Snapshot and reconcile the interrupted dirty patch

**Files:**
- Inspect: all paths reported by `git status --short`
- Preserve externally: the binary diff and the two untracked component files
- Do not modify production code in this task

- [ ] **Step 1: Record the exact starting state**

Run from the worktree:

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --cached --name-only
```

Expected:

- branch is `codex/brand-center-onboarding-screen`;
- HEAD begins with `db9d08a`;
- cached output is empty;
- 12 modified files and two untracked Brand Center components are visible.

- [ ] **Step 2: Save a recoverable binary patch outside the worktree**

```powershell
$snapshot = Join-Path $env:TEMP "brand-center-interrupted-db9d08a.patch"
git diff --binary | Set-Content -LiteralPath $snapshot -Encoding utf8
Get-FileHash -Algorithm SHA256 -LiteralPath $snapshot
```

Expected: the patch exists under the current user's temporary directory and has
a non-empty SHA-256 hash.

- [ ] **Step 3: Save the untracked sources outside the worktree**

```powershell
$snapshotDir = Join-Path $env:TEMP "brand-center-interrupted-db9d08a"
New-Item -ItemType Directory -Force -Path $snapshotDir | Out-Null
Copy-Item -LiteralPath "apps/customer-ui/src/components/brand-center/DesignStylePanel.tsx" -Destination $snapshotDir
Copy-Item -LiteralPath "apps/customer-ui/src/components/brand-center/KnowledgeCategoryEditorPanel.tsx" -Destination $snapshotDir
Get-ChildItem -LiteralPath $snapshotDir
```

Expected: both source files are listed. This is a safety copy, not a source of
truth after implementation starts.

- [ ] **Step 4: Classify without reverting**

Run:

```powershell
git diff --stat
git diff -- apps/api/src/brandCoreContracts.ts apps/customer-ui/src/features/brand-center/types.ts apps/customer-ui/src/pages/BrandCenterPage.tsx
git diff -- apps/customer-ui/src/components/brand-center/BrandCoreReviewPanel.tsx apps/customer-ui/src/components/brand-center/ProductServiceEditor.tsx apps/customer-ui/src/features/libraries/libraryGateway.ts
```

Expected classification:

- salvage Core edit/cancel and Product draft/view changes;
- replace text-style additions with `referenceImages`;
- adapt the category panel while preserving the existing `WikiLibraryPanel`
  policy/issues/build functions;
- no file is reverted wholesale.

- [ ] **Step 5: Verify the snapshot task changed no tracked source**

```powershell
git status --short
git diff --check
```

Expected: the same 12 modified and two untracked source paths remain and the diff
check passes. Task 0 creates no commit.

### Task 1: Implement bounded onboarding polling and resume cleanup

**Files:**
- Create: `apps/customer-ui/src/features/brand-intelligence/boundedAnalysisPoller.ts`
- Create: `apps/customer-ui/src/features/brand-intelligence/boundedAnalysisPoller.test.ts`
- Create: `apps/customer-ui/src/features/brand-intelligence/brandIntelligenceGateway.test.ts`
- Modify: `apps/customer-ui/src/features/brand-intelligence/types.ts`
- Modify: `apps/customer-ui/src/features/brand-intelligence/brandIntelligenceGateway.ts`
- Modify: `apps/customer-ui/src/pages/LiveBrandCenterOnboarding.tsx`
- Modify: `apps/customer-ui/src/pages/BrandCenterPreviewPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandCenterLiveOnboarding.test.tsx`
- Modify: `apps/api/src/server.brandIntelligenceCustomer.test.ts`

- [ ] **Step 1: Write pure poll-policy failures**

Create tests that lock the approved policy:

```ts
expect(nextAnalysisPollDelay(0, () => 0)).toBe(2_000);
expect(nextAnalysisPollDelay(1, () => 0)).toBe(4_000);
expect(nextAnalysisPollDelay(2, () => 0)).toBe(8_000);
expect(nextAnalysisPollDelay(3, () => 0)).toBe(15_000);
expect(nextAnalysisPollDelay(9, () => 1)).toBe(18_000);
expect(ANALYSIS_POLL_MAX_REQUESTS).toBe(63);
expect(ANALYSIS_POLL_DEADLINE_MS).toBe(15 * 60_000);
expect(ANALYSIS_REQUEST_TIMEOUT_MS).toBe(15_000);
```

Also test that retry classification returns true only for network/timeout, 408,
429, and 5xx results.

- [ ] **Step 2: Run the pure test and verify RED**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- boundedAnalysisPoller.test.ts
```

Expected: FAIL because `boundedAnalysisPoller.ts` and its exports do not exist.

- [ ] **Step 3: Implement the pure polling contract**

Create these exports:

```ts
export const ANALYSIS_POLL_MAX_REQUESTS = 63;
export const ANALYSIS_POLL_DEADLINE_MS = 15 * 60_000;
export const ANALYSIS_REQUEST_TIMEOUT_MS = 15_000;

const BASE_DELAYS_MS = [2_000, 4_000, 8_000, 15_000] as const;

export function nextAnalysisPollDelay(attempt: number, random = Math.random) {
  const base = BASE_DELAYS_MS[Math.min(attempt, BASE_DELAYS_MS.length - 1)]!;
  return Math.round(base * (1 + 0.2 * random()));
}
```

Define `isRetryableAnalysisPollError(error)` against `ApiRequestError.status`
and the gateway timeout error code. Do not put React state or timers in this
pure file.

- [ ] **Step 4: Make the analysis gateway abortable**

Change the interface and implementation consistently:

```ts
getAnalysis(
  brandId: string,
  analysisId: string,
  signal?: AbortSignal,
): Promise<BrandAnalysis>;
```

Forward `signal` in the GET `RequestInit`. Add a gateway test that asserts the
same `AbortSignal` object reaches `requestJson`.

- [ ] **Step 5: Write live-loop RED tests**

Expand `brandCenterLiveOnboarding.test.tsx` with fake-timer tests for:

- exact 2/4/8/15-second scheduling with deterministic jitter;
- 63-request and 15-minute termination;
- no second GET while the first promise is unresolved;
- 15-second hung-request abort;
- hidden-tab timer cancellation and visible-tab delayed resume;
- unmount abort;
- retryable 500 versus terminal 400;
- stale 404 pointer cleanup;
- server `failed` pointer cleanup;
- `confirmed` pointer cleanup;
- transient/budget-exhausted pointer retention;
- query identifier precedence and scoped localStorage isolation.

Use a gateway mock that records each received signal and exposes deferred
promises; do not assert by sleeping real time.

- [ ] **Step 6: Run live-loop tests and verify RED**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- brandCenterLiveOnboarding.test.tsx brandIntelligenceGateway.test.ts
```

Expected: FAIL on fixed two-second scheduling, missing abort signals, and stale
pointer behavior.

- [ ] **Step 7: Integrate the bounded loop**

In `LiveBrandCenterOnboarding`:

- keep one timer and one active `AbortController` per effect;
- count completed request attempts;
- compare `Date.now()` with the run deadline;
- pause on `document.hidden`;
- retry only through `isRetryableAnalysisPollError`;
- use one `clearResumePointer()` function for query, localStorage, and state;
- preserve the pointer for review, transient errors, and budget exhaustion;
- preserve the complete Step 2 draft during polling changes.

Remove the test-only `pollIntervalMs` prop from
`BrandCenterPreviewPage`/`LiveBrandCenterOnboarding`; tests control timers and
the exported delay policy instead.

- [ ] **Step 8: Preserve every hidden Step 2 field**

Extend the existing save assertion:

```ts
expect(api.updateDraft).toHaveBeenCalledWith(
  "brand-1",
  "analysis-1",
  expect.objectContaining({
    primaryCategory: { code: "software", name: "소프트웨어" },
    subcategories: [{ code: "brand-ops", name: "브랜드 운영" }],
    competitors: result.competitors,
    evidence: result.evidence,
    sourceGaps: result.sourceGaps,
  }),
);
```

Keep assertions that category code, competitors, source gaps, and evidence
links do not appear in the DOM.

- [ ] **Step 9: Lock the existing stale-analysis 404**

Add an API test:

```ts
expect(response.statusCode).toBe(404);
expect(response.json()).toEqual({ error: "brand_analysis_not_found" });
```

Do not change repository ownership checks or the response for malformed UUIDs.
The global `*_not_found` handler in `httpServer.ts` already returns 404, so
this step adds the missing regression test and does not change production HTTP
code.

- [ ] **Step 10: Run Task 1 verification**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- boundedAnalysisPoller.test.ts brandIntelligenceGateway.test.ts brandCenterLiveOnboarding.test.tsx
npm run test --workspace @brand-pilot/api -- server.brandIntelligenceCustomer.test.ts
npm run build --workspace @brand-pilot/customer-ui
npm run typecheck --workspace @brand-pilot/api
git diff --check
```

Expected: all focused tests, customer build, API typecheck, and diff check pass.

- [ ] **Step 11: Commit only Task 1**

```powershell
git add -- apps/customer-ui/src/features/brand-intelligence/boundedAnalysisPoller.ts apps/customer-ui/src/features/brand-intelligence/boundedAnalysisPoller.test.ts apps/customer-ui/src/features/brand-intelligence/brandIntelligenceGateway.test.ts apps/customer-ui/src/features/brand-intelligence/types.ts apps/customer-ui/src/features/brand-intelligence/brandIntelligenceGateway.ts apps/customer-ui/src/pages/LiveBrandCenterOnboarding.tsx apps/customer-ui/src/pages/BrandCenterPreviewPage.tsx apps/customer-ui/src/__tests__/brandCenterLiveOnboarding.test.tsx apps/api/src/server.brandIntelligenceCustomer.test.ts
git commit -m "fix(onboarding): bound live analysis polling"
```

### Task 2: Complete Core revisions and preserve operational rules

**Files:**
- Modify: `apps/customer-ui/src/pages/BrandCenterPage.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/BrandCoreReviewPanel.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/BrandCoreReviewPanel.test.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/BrandRulesPanel.tsx`
- Modify: `apps/customer-ui/src/features/brand-center/brandCenterGateway.test.ts`
- Modify: `apps/customer-ui/src/__tests__/brandCenter.test.tsx`
- Modify: `apps/api/src/brandCoreRepository.test.ts`
- Modify: `apps/api/src/brandCoreRepository.pglite.test.ts`
- Modify: `apps/api/src/server.brandCenterCustomer.test.ts`

- [ ] **Step 1: Write Core view/edit/history RED tests**

Add UI tests that prove:

- approved Core fields are disabled in view mode;
- `브랜드 코어 수정` calls `createCoreDraft`;
- editing changes the shared dirty flag;
- cancel restores the persisted draft without calling update;
- save sends `expectedUpdatedAt`;
- conflict keeps the edited fields and shows a conflict action;
- selecting a superseded revision is read-only;
- switching tabs while dirty can be cancelled;
- save success returns to view mode with a saved notice.

Add a repository regression proving the returned `versions` are descending and
that creating a draft never changes the active approved pointer.

- [ ] **Step 2: Run Core tests and verify RED**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- brandCenter.test.tsx BrandCoreReviewPanel.test.tsx brandCenterGateway.test.ts
npm run test --workspace @brand-pilot/api -- brandCoreRepository.test.ts brandCoreRepository.pglite.test.ts server.brandCenterCustomer.test.ts
```

Expected: UI tests fail on missing revision selection/consistent edit state;
repository regressions remain green or expose an ordering defect.

- [ ] **Step 3: Implement the Core state model**

Use the existing gateway methods:

```ts
getCore(brandId)
createCoreDraft(brandId, input)
updateCoreDraft(brandId, versionId, input)
approveCoreDraft(brandId, versionId)
```

Keep these invariants:

- `workspace.active` is never edited in place;
- `workspace.draft` is the only editable revision;
- cancel clones the persisted draft;
- history selection does not overwrite the current draft;
- approval remains owner/admin-only in the repository.

- [ ] **Step 4: Mount Brand Rules as a Core secondary control**

Add a `운영 규칙` disclosure/secondary navigation inside Core and render the
existing `BrandRulesPanel`. Preserve all existing rule fields:

```ts
requiredPhrases
forbiddenPhrases
exaggerationRules
ctaRules
channelRules
designRules.colors
designRules.fonts
designRules.notes
autoApprovalRules
```

Style image references added in Task 5 must be merged, not replace these
fields. Rule edit/save/cancel/approve participates in the page dirty guard.

- [ ] **Step 5: Run Task 2 verification**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- brandCenter.test.tsx BrandCoreReviewPanel.test.tsx brandCenterGateway.test.ts
npm run test --workspace @brand-pilot/api -- brandCoreContracts.test.ts brandCoreRepository.test.ts brandCoreRepository.pglite.test.ts server.brandCenterCustomer.test.ts
npm run build --workspace @brand-pilot/customer-ui
git diff --check
```

Expected: all focused tests and build pass.

- [ ] **Step 6: Commit only Task 2**

```powershell
git add -- apps/customer-ui/src/components/brand-center/BrandCoreReviewPanel.tsx apps/customer-ui/src/components/brand-center/BrandCoreReviewPanel.test.tsx apps/customer-ui/src/components/brand-center/BrandRulesPanel.tsx apps/customer-ui/src/features/brand-center/brandCenterGateway.test.ts apps/api/src/brandCoreRepository.test.ts apps/api/src/brandCoreRepository.pglite.test.ts apps/api/src/server.brandCenterCustomer.test.ts
git add -p -- apps/customer-ui/src/pages/BrandCenterPage.tsx apps/customer-ui/src/__tests__/brandCenter.test.tsx
git diff --cached --name-only
git diff --cached
git commit -m "feat(brand-center): complete core revision editing"
```

Expected cached diff: Core/history/rules hunks only; no knowledge panel,
product editor, `DesignStylePanel`, or text-style contract hunk.

### Task 3: Connect category Wiki CRUD and preserve policy/issues/build controls

**Files:**
- Modify: `apps/customer-ui/src/components/brand-center/KnowledgeCategoryEditorPanel.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/WikiItemEditor.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/WikiLibraryPanel.tsx`
- Modify: `apps/customer-ui/src/pages/BrandCenterPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandCenter.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/wikiLibrary.test.tsx`
- Modify: `apps/api/src/wikiManagementContracts.test.ts`
- Modify: `apps/api/src/server.wikiManagementCustomer.test.ts`
- Modify: `apps/api/src/repository.dmWiki.test.ts`
- Modify: `apps/api/src/repository.dmWiki.pglite.test.ts`

- [ ] **Step 1: Write category and preservation RED tests**

Cover:

- FAQ tab lists only FAQ manual entries;
- how-to tab lists the `how_to` management projection;
- guide tab lists guides and exposes a `정책` secondary filter;
- create starts in edit mode and saves a draft;
- existing entries open read-only and require explicit edit;
- dirty cancel restores title/content without PATCH;
- activate sends `{ status: "active" }`;
- deactivate sends `{ status: "inactive" }`;
- product/service projections remain read-only with a product deep link;
- build status and last successful version are visible;
- issues can be opened, linked, and remain `pending_build` until active build;
- failed build keeps the previous active version visible.

- [ ] **Step 2: Run Wiki tests and verify RED**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- brandCenter.test.tsx wikiLibrary.test.tsx
npm run test --workspace @brand-pilot/api -- wikiManagementContracts.test.ts server.wikiManagementCustomer.test.ts repository.dmWiki.test.ts repository.dmWiki.pglite.test.ts
```

Expected: canonical category tests fail because the interrupted component only
saves drafts and omits policy/issues/build controls.

- [ ] **Step 3: Reuse the existing Wiki editor contract**

Do not create a second Wiki CRUD gateway. Adapt
`KnowledgeCategoryEditorPanel` to compose the existing behaviors from
`WikiItemEditor` and `WikiLibraryPanel`:

```ts
type CanonicalKnowledgeTab = "faq" | "how_to" | "guide";
type GuideSecondaryFilter = "guide" | "policy" | "issues";
```

Pass an explicit allowed item type for creation. Preserve the `how_to`
management type even though its persisted source kind is `guide`.

- [ ] **Step 4: Add consistent edit/dirty/save/cancel**

Move `WikiItemEditor` from always-editable fields to the shared state model:

```ts
type EditorMode = "view" | "edit" | "create";
```

Save title/content as draft. Activation and deactivation remain separate
buttons and owner/admin errors remain visible. Deactivation is the only removal
operation; do not add DELETE.

- [ ] **Step 5: Preserve issues, imports, and build status**

Keep the existing:

- `listWikiIssues`/`resolveWikiIssue`;
- knowledge import summaries;
- manual refresh action;
- `getWikiStatus`;
- active/stale/failed status;
- focus restoration for issue details.

Expose these from the guide tab as secondary controls instead of restoring a
top-level Wiki tab.

- [ ] **Step 6: Run Task 3 verification**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- brandCenter.test.tsx wikiLibrary.test.tsx
npm run test --workspace @brand-pilot/api -- wikiManagementContracts.test.ts server.wikiManagementCustomer.test.ts repository.dmWiki.test.ts repository.dmWiki.pglite.test.ts
npm run build --workspace @brand-pilot/customer-ui
git diff --check
```

Expected: all focused tests and build pass.

- [ ] **Step 7: Commit only Task 3**

```powershell
git add -- apps/customer-ui/src/components/brand-center/KnowledgeCategoryEditorPanel.tsx apps/customer-ui/src/components/brand-center/WikiItemEditor.tsx apps/customer-ui/src/components/brand-center/WikiLibraryPanel.tsx apps/customer-ui/src/__tests__/wikiLibrary.test.tsx apps/api/src/wikiManagementContracts.test.ts apps/api/src/server.wikiManagementCustomer.test.ts apps/api/src/repository.dmWiki.test.ts apps/api/src/repository.dmWiki.pglite.test.ts
git add -p -- apps/customer-ui/src/pages/BrandCenterPage.tsx apps/customer-ui/src/__tests__/brandCenter.test.tsx
git diff --cached --name-only
git diff --cached
git commit -m "feat(brand-center): connect knowledge category editing"
```

Expected cached diff: FAQ/how-to/guide/policy/issues/build hunks only; no
product or Style hunk.

### Task 4: Finish product/service draft revision UX

**Files:**
- Modify: `apps/customer-ui/src/features/libraries/libraryGateway.ts`
- Modify: `apps/customer-ui/src/features/libraries/libraryGateway.test.ts`
- Modify: `apps/customer-ui/src/components/brand-center/ProductServiceLibraryPanel.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/ProductServiceEditor.tsx`
- Modify: `apps/customer-ui/src/__tests__/productServiceLibrary.test.tsx`
- Modify: `apps/api/src/productLibraryContracts.test.ts`
- Modify: `apps/api/src/productLibraryRepository.test.ts`
- Modify: `apps/api/src/productLibraryRepository.pglite.test.ts`
- Modify: `apps/api/src/server.productLibraryCustomer.test.ts`
- Modify: `apps/api/src/libraryTrustBoundary.test.ts`

- [ ] **Step 1: Write product revision RED tests**

Cover:

- list request is exactly `/product-services?include=draft`;
- draft-only items remain visible after reload;
- approved item fields are disabled until `수정`;
- edit opens or creates the next draft without changing active version;
- dirty state reaches the Brand Center tab guard;
- cancel restores the persisted version without a network write;
- save PATCHes the draft and returns to view;
- approval supersedes the old approved revision and changes the active pointer;
- archive remains a soft archive;
- Wiki enqueue failure cannot roll back product approval.

- [ ] **Step 2: Run product tests and verify RED**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- productServiceLibrary.test.tsx libraryGateway.test.ts
npm run test --workspace @brand-pilot/api -- productLibraryContracts.test.ts productLibraryRepository.test.ts productLibraryRepository.pglite.test.ts server.productLibraryCustomer.test.ts libraryTrustBoundary.test.ts
```

Expected: view/edit/cancel or draft-only reload tests fail before reconciliation.

- [ ] **Step 3: Reconcile the interrupted Product editor**

Keep:

```ts
const editable = creating || editing;
const dirty = editable
  && JSON.stringify(profile) !== JSON.stringify(persistedProfile);
```

Ensure approval is unavailable while unsaved edits exist. Save first, then
approve the persisted draft in a separate explicit action. Reset
`onDirtyChange(false)` on unmount and item switch.

- [ ] **Step 4: Run Task 4 verification**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- productServiceLibrary.test.tsx libraryGateway.test.ts
npm run test --workspace @brand-pilot/api -- productLibraryContracts.test.ts productLibraryRepository.test.ts productLibraryRepository.pglite.test.ts server.productLibraryCustomer.test.ts libraryTrustBoundary.test.ts
npm run build --workspace @brand-pilot/customer-ui
git diff --check
```

Expected: all focused tests and build pass.

- [ ] **Step 5: Commit only Task 4**

```powershell
git add -- apps/customer-ui/src/features/libraries/libraryGateway.ts apps/customer-ui/src/features/libraries/libraryGateway.test.ts apps/customer-ui/src/components/brand-center/ProductServiceLibraryPanel.tsx apps/customer-ui/src/components/brand-center/ProductServiceEditor.tsx apps/customer-ui/src/__tests__/productServiceLibrary.test.tsx apps/api/src/productLibraryContracts.test.ts apps/api/src/productLibraryRepository.test.ts apps/api/src/productLibraryRepository.pglite.test.ts apps/api/src/server.productLibraryCustomer.test.ts apps/api/src/libraryTrustBoundary.test.ts
git commit -m "feat(brand-center): complete product revision editing"
```

### Task 5: Replace text Style with confirmed reference images

**Files:**
- Create: `apps/customer-ui/src/components/brand-center/StyleReferenceImageBoard.tsx`
- Create: `apps/customer-ui/src/components/brand-center/StyleReferenceImageBoard.test.tsx`
- Delete: `apps/customer-ui/src/components/brand-center/DesignStylePanel.tsx`
- Modify: `apps/customer-ui/src/pages/BrandCenterPage.tsx`
- Modify: `apps/customer-ui/src/features/brand-center/types.ts`
- Modify: `apps/customer-ui/src/features/libraries/libraryGateway.ts`
- Modify: `apps/customer-ui/src/features/libraries/libraryGateway.test.ts`
- Modify: `apps/customer-ui/src/__tests__/brandCenter.test.tsx`
- Modify: `apps/api/src/brandCoreContracts.ts`
- Modify: `apps/api/src/brandCoreContracts.test.ts`
- Modify: `apps/api/src/brandCoreRepository.ts`
- Modify: `apps/api/src/brandCoreRepository.test.ts`
- Modify: `apps/api/src/brandCoreRepository.pglite.test.ts`
- Modify: `apps/api/src/server.brandCenterCustomer.test.ts`
- Test: `apps/api/src/assetLibraryUpload.test.ts`
- Test: `apps/api/src/assetLibraryRepository.test.ts`
- Test: `apps/api/src/assetLibraryRepository.pglite.test.ts`
- Test: `apps/api/src/server.assetLibraryCustomer.test.ts`

- [ ] **Step 1: Write the rule-contract RED test**

Define the expected additive type:

```ts
interface BrandStyleReferenceImage {
  referenceItemId: string;
  description: string;
  tags: string[];
}
```

Test:

- missing `referenceImages` defaults to `[]`;
- 0–5 entries pass;
- six entries fail;
- duplicate identifier fails;
- invalid UUID fails;
- description over 240 characters fails;
- more than 10 tags or a tag over 40 characters fails;
- unknown image-entry key fails;
- existing colors/fonts/notes remain unchanged.

- [ ] **Step 2: Run contract tests and verify RED**

```powershell
npm run test --workspace @brand-pilot/api -- brandCoreContracts.test.ts
```

Expected: FAIL because `referenceImages` is not a recognized design rule key.

- [ ] **Step 3: Implement the additive JSON contract**

Use this exact shape in API and customer types:

```ts
designRules: {
  colors: string[];
  fonts: string[];
  notes: string[];
  referenceImages: BrandStyleReferenceImage[];
}
```

Retain any other already-canonical design-rule keys. Remove the interrupted
`imageMoods`, `layoutPreferences`, `prohibitedStyles`, and `referenceUrls`
additions because they were never approved. Parse legacy rows without
`referenceImages` as an empty array. Do not add a database migration.

- [ ] **Step 4: Write repository ownership RED tests**

Use PGlite fixtures for:

- same-brand confirmed PNG/JPEG/WebP reference succeeds;
- cross-brand and cross-workspace identifiers fail;
- archived reference fails;
- non-upload reference fails;
- PDF/text confirmed references fail;
- repeated identifier fails before write;
- update preserves required phrases, CTA, channel, color, font, note, and
  auto-approval rules.

- [ ] **Step 5: Run repository tests and verify RED**

```powershell
npm run test --workspace @brand-pilot/api -- brandCoreRepository.test.ts brandCoreRepository.pglite.test.ts server.brandCenterCustomer.test.ts
```

Expected: FAIL because saveRuleDraft does not resolve reference ownership/MIME.

- [ ] **Step 6: Validate references in the rule repository**

Before writing a draft, query every unique identifier with workspace and brand
scope. Require:

```text
reference_items.kind = 'upload'
reference_items.archived_at is null
storage artifact MIME in image/png, image/jpeg, image/webp
```

Reject the whole draft if any identifier is missing or invalid. The JSON stores
only the identifier, description, and tags.

- [ ] **Step 7: Write Style board RED tests**

Cover:

- view mode shows confirmed previews;
- edit enables drag/drop and file picker;
- accept is exactly `.png,.jpg,.jpeg,.webp`;
- client rejects non-image and files over 5 MiB before reservation;
- each accepted file calls `uploadReferenceFile`;
- local object URL may render only while uploading and is revoked;
- save is disabled until every board entry is confirmed;
- at most five entries;
- optional description/tags edit;
- select and detach update dirty state;
- cancel restores persisted identifiers and does not archive;
- failed upload cancellation calls `cancelReferenceUpload`;
- save sends canonical reference identifiers and never a blob/object URL;
- avatar gateway methods are never called.

- [ ] **Step 8: Run Style UI tests and verify RED**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- StyleReferenceImageBoard.test.tsx brandCenter.test.tsx libraryGateway.test.ts
```

Expected: FAIL because the current Style surface is a text form.

- [ ] **Step 9: Implement the Style board with existing upload lifecycle**

Reuse:

```ts
libraryGateway.uploadReferenceFile(brandId, file, {
  signal,
  onSession,
  onProgress,
})
libraryGateway.cancelReferenceUpload(brandId, sessionId)
```

Keep the generic endpoint policy unchanged. Add a Style-specific exported
client validator that accepts only PNG/JPEG/WebP up to 5 MiB. Saving calls
`brandCenterGateway.saveRuleDraft` with a merge over the current full rules
object.

- [ ] **Step 10: Prove existing reference upload security remains green**

```powershell
npm run test --workspace @brand-pilot/api -- assetLibraryUpload.test.ts assetLibraryRepository.test.ts assetLibraryRepository.pglite.test.ts server.assetLibraryCustomer.test.ts
npm run test --workspace @brand-pilot/customer-ui -- referenceLibrary.test.tsx libraryGateway.test.ts
```

Expected: existing session, checksum, nonce, replay, cancellation, and GC tests
all pass.

- [ ] **Step 11: Run Task 5 verification**

```powershell
npm run test --workspace @brand-pilot/api -- brandCoreContracts.test.ts brandCoreRepository.test.ts brandCoreRepository.pglite.test.ts server.brandCenterCustomer.test.ts assetLibraryUpload.test.ts assetLibraryRepository.test.ts assetLibraryRepository.pglite.test.ts server.assetLibraryCustomer.test.ts
npm run test --workspace @brand-pilot/customer-ui -- StyleReferenceImageBoard.test.tsx brandCenter.test.tsx referenceLibrary.test.tsx libraryGateway.test.ts
npm run build --workspace @brand-pilot/customer-ui
npm run typecheck --workspace @brand-pilot/api
git diff --check
```

Expected: all focused tests, builds, and checks pass.

- [ ] **Step 12: Commit only Task 5**

```powershell
git add -- apps/customer-ui/src/components/brand-center/StyleReferenceImageBoard.tsx apps/customer-ui/src/components/brand-center/StyleReferenceImageBoard.test.tsx apps/customer-ui/src/components/brand-center/DesignStylePanel.tsx apps/customer-ui/src/features/brand-center/types.ts apps/customer-ui/src/features/libraries/libraryGateway.ts apps/customer-ui/src/features/libraries/libraryGateway.test.ts apps/api/src/brandCoreContracts.ts apps/api/src/brandCoreContracts.test.ts apps/api/src/brandCoreRepository.ts apps/api/src/brandCoreRepository.test.ts apps/api/src/brandCoreRepository.pglite.test.ts apps/api/src/server.brandCenterCustomer.test.ts
git add -p -- apps/customer-ui/src/pages/BrandCenterPage.tsx apps/customer-ui/src/__tests__/brandCenter.test.tsx
git diff --cached --name-only
git diff --cached
git commit -m "feat(brand-center): add style reference image board"
```

Expected cached diff: the confirmed-image board and rule-contract replacement;
no unverified integration/QA styling hunk.

### Task 6: Provision the first Wiki and coalesce later product refreshes

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/repository.dmWiki.test.ts`
- Modify: `apps/api/src/repository.dmWiki.pglite.test.ts`
- Modify: `apps/api/src/server.dmOperations.test.ts`
- Modify: `apps/api/src/brandIntelligenceRepository.test.ts`
- Modify: `apps/api/src/productLibraryRepository.ts`
- Modify: `apps/api/src/productLibraryRepository.test.ts`
- Modify: `workers/brand-pilot-dm-worker/src/db.transaction.test.ts`
- Modify: `workers/brand-pilot-dm-worker/src/wikiMaintenance.test.ts`
- Modify: `apps/customer-ui/src/pages/DmAutomationPage.tsx`
- Modify: `apps/customer-ui/src/pages/ChannelsPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/dmAutomation.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/channels.test.tsx`

- [ ] **Step 1: Write first-enable provisioning RED tests**

API/repository cases:

- enabling with no active Wiki idempotently inserts one immediate pending
  `wiki_build_request`;
- DM remains disabled;
- response is the existing 409 activation block and the following settings GET
  reports `wikiStatus=building`;
- repeated enable while pending does not create a second active request;
- after a valid active Wiki exists, the same enable request passes the final
  Brand Core/Wiki/permission/webhook/worker gate;
- onboarding confirmation does not insert a Wiki build request.

- [ ] **Step 2: Run provisioning tests and verify RED**

```powershell
npm run test --workspace @brand-pilot/api -- repository.dmWiki.test.ts repository.dmWiki.pglite.test.ts server.dmOperations.test.ts brandIntelligenceRepository.test.ts
```

Expected: no-Wiki enable is blocked without first provisioning a build.

- [ ] **Step 3: Add an idempotent provisioning operation**

Add a repository method with one responsibility:

```ts
ensureInitialWikiBuild(brandId: string): Promise<{
  state: "already_active" | "already_pending" | "enqueued";
}>;
```

When an enable request has `wikiStatus` equal to `empty` or `failed`, call this
method before the final readiness check. Keep the setting disabled and return
the current blocked response until a valid active Wiki exists. Do not create a
pending-enable column or bypass `isDmAutomationReady`.

- [ ] **Step 4: Write 03:00 KST coalescing RED tests**

Freeze time around KST boundaries and assert:

```text
02:59 KST approval → quiet_until 03:00 the same day
03:01 KST approval → quiet_until 03:00 the next day
multiple approvals → one pending request, requested_revision increments
first Wiki absent → immediate provisioning remains immediate
failed scheduled build → prior active Wiki remains active
```

Also assert product approval commits even if Wiki enqueue is unavailable.

- [ ] **Step 5: Run scheduling tests and verify RED**

```powershell
npm run test --workspace @brand-pilot/api -- productLibraryRepository.test.ts repository.dmWiki.test.ts repository.dmWiki.pglite.test.ts
```

Expected: current product approval schedules immediately instead of the next
03:00 KST boundary.

- [ ] **Step 6: Implement explicit scheduling policies**

Keep one `wiki_build_requests` row per active brand request. Use separate
repository helpers:

```ts
enqueueImmediateWikiBuild(scope, reason)
enqueueNextKstWikiBuild(scope, reason)
```

`enqueueNextKstWikiBuild` computes the next 03:00 Asia/Seoul timestamp in SQL,
increments `requested_revision`, and preserves `rebuild_requested` when a build
is already running. Manual Wiki activation uses immediate scheduling; later
product/service approval uses next-KST scheduling.

- [ ] **Step 7: Preserve activation and maintenance transactions**

Run and, where necessary, extend tests proving:

- `activate_compiled_wiki_version` commits before issue resolution;
- activation failure rolls back and preserves prior active Wiki;
- 03:00 maintenance still requires at least five knowledge-gap/low-confidence
  retrievals;
- maintenance runs at most once per brand/day;
- maintenance remains distinct from product dirty scheduling.

- [ ] **Step 8: Show provisioning state in customer UI**

When enable returns `dm_activation_blocked`, both DM entry surfaces refresh the
settings. If that read reports `wikiStatus=building`, they show:

```text
첫 Wiki를 준비하고 있습니다. 기존 설정은 꺼진 상태이며 준비가 끝난 뒤 다시 활성화할 수 있습니다.
```

Refresh readiness through the existing settings fetch. Do not add an automatic
toggle or change OAuth state.

- [ ] **Step 9: Run Task 6 verification**

```powershell
npm run test --workspace @brand-pilot/api -- repository.dmWiki.test.ts repository.dmWiki.pglite.test.ts server.dmOperations.test.ts productLibraryRepository.test.ts brandIntelligenceRepository.test.ts
npm run test --workspace @brand-pilot/dm-worker -- db.transaction.test.ts wikiMaintenance.test.ts compiledWikiFinalize.test.ts
npm run test --workspace @brand-pilot/customer-ui -- dmAutomation.test.tsx channels.test.tsx
npm run typecheck --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/dm-worker
git diff --check
```

Expected: focused API, worker, and UI tests pass.

- [ ] **Step 10: Commit only Task 6**

```powershell
git add -- apps/api/src/types.ts apps/api/src/repository.ts apps/api/src/httpServer.ts apps/api/src/repository.dmWiki.test.ts apps/api/src/repository.dmWiki.pglite.test.ts apps/api/src/server.dmOperations.test.ts apps/api/src/brandIntelligenceRepository.test.ts apps/api/src/productLibraryRepository.ts apps/api/src/productLibraryRepository.test.ts workers/brand-pilot-dm-worker/src/db.transaction.test.ts workers/brand-pilot-dm-worker/src/wikiMaintenance.test.ts apps/customer-ui/src/pages/DmAutomationPage.tsx apps/customer-ui/src/pages/ChannelsPage.tsx apps/customer-ui/src/__tests__/dmAutomation.test.tsx apps/customer-ui/src/__tests__/channels.test.tsx
git commit -m "feat(wiki): provision and schedule brand knowledge"
```

### Task 7: Integrate the six-tab experience and run browser QA

**Files:**
- Modify: `apps/customer-ui/src/pages/BrandCenterPage.tsx`
- Modify: `apps/customer-ui/src/styles/brand-center.css`
- Modify: `apps/customer-ui/src/styles/brand-center-preview.css`
- Modify: `apps/customer-ui/src/__tests__/brandCenter.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandCenterRouting.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandCenterLiveOnboarding.test.tsx`
- Create: `apps/customer-ui/e2e/brand-center-live-integration.spec.ts`
- Modify: `docs/superpowers/plans/2026-07-24-d-hybrid-regression-rollout-implementation-plan.md`

- [ ] **Step 1: Write route and full-flow RED tests**

Lock:

```ts
expect(tabNames).toEqual([
  "브랜드 코어",
  "FAQ",
  "이용 방법",
  "가이드",
  "제품·서비스",
  "스타일",
]);
```

Test invalid-tab normalization, refresh persistence, dirty navigation guard,
and that `AvatarLibraryPanel` is not mounted while its route/API source files
remain present.

Create a Playwright flow that:

1. uploads/requests an analysis through mocked local API responses;
2. observes bounded status progress;
3. edits category/subcategory names;
4. confirms the complete payload;
5. opens each of the six Brand Center tabs;
6. exercises one save/cancel cycle in Core, FAQ, product, and Style;
7. verifies policy/issues as secondary guide controls;
8. verifies keyboard focus, mobile layout, and no horizontal overflow.

- [ ] **Step 2: Run route tests and verify RED**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- brandCenter.test.tsx brandCenterRouting.test.tsx brandCenterLiveOnboarding.test.tsx
```

Expected: any remaining tab label, secondary-control, or dirty-state mismatch
fails.

- [ ] **Step 3: Finish shared presentation states**

Update CSS for:

- six-tab desktop and horizontally scrollable mobile navigation;
- shared saving/saved/error/dirty affordances;
- revision list and secondary controls;
- image-board drop zone and five-card grid;
- visible keyboard focus;
- reduced motion;
- 320 px viewport without document-level horizontal overflow.

Do not reintroduce avatar UI or the text Style questionnaire.

- [ ] **Step 4: Run focused customer regression**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- brandCenterLiveOnboarding.test.tsx boundedAnalysisPoller.test.ts brandCenter.test.tsx brandCenterRouting.test.tsx BrandCoreReviewPanel.test.tsx wikiLibrary.test.tsx productServiceLibrary.test.tsx StyleReferenceImageBoard.test.tsx referenceLibrary.test.tsx dmAutomation.test.tsx channels.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

Expected: all focused customer tests and build pass.

- [ ] **Step 5: Run API, worker, contract, and migration gates**

Use local Docker PostgreSQL only:

```powershell
npm run db:up
npm run test --workspace @brand-pilot/api
npm run test --workspace @brand-pilot/dm-worker
npm run test:contract
npm run test:migrations
npm run typecheck --workspace @brand-pilot/api
git diff --check
```

Expected: all suites pass. This plan adds no structural migration, so the
migration count remains unchanged and verifies backward parsing of legacy rule
JSON.

- [ ] **Step 6: Run local Playwright QA**

Start the local API and customer UI with development environment values only,
then run:

```powershell
npm run e2e --workspace @brand-pilot/customer-ui -- brand-center-live-integration.spec.ts
```

Expected:

- desktop and mobile projects pass;
- no repeated unbounded analysis GETs;
- no console errors;
- all six tabs render;
- image previews come from confirmed reference URLs;
- cancel does not persist;
- dirty navigation warning appears once.

- [ ] **Step 7: Update the regression matrix**

Add executable references for:

- bounded onboarding polling;
- hidden legacy payload preservation;
- six-tab feature preservation;
- Style reference-image trust boundary;
- first-Wiki provisioning;
- next-03:00 product coalescing;
- avatar backend preservation while unmounted.

Do not mark Ubuntu deployment or production browser QA complete in this task.

- [ ] **Step 8: Commit integration and QA only**

```powershell
git add -- apps/customer-ui/src/pages/BrandCenterPage.tsx apps/customer-ui/src/styles/brand-center.css apps/customer-ui/src/styles/brand-center-preview.css apps/customer-ui/src/__tests__/brandCenter.test.tsx apps/customer-ui/src/__tests__/brandCenterRouting.test.tsx apps/customer-ui/src/__tests__/brandCenterLiveOnboarding.test.tsx apps/customer-ui/e2e/brand-center-live-integration.spec.ts docs/superpowers/plans/2026-07-24-d-hybrid-regression-rollout-implementation-plan.md
git commit -m "test(brand-center): verify live integration"
```

## Final pre-deployment gate

- [ ] Confirm `git status --short` contains no accidental generated files.
- [ ] Confirm every implementation commit contains only its task paths.
- [ ] Run `git diff origin/main...HEAD --check`.
- [ ] Re-run customer build, API typecheck, repository contracts, migrations,
  and the live integration Playwright test from a clean process state.
- [ ] Verify account, OAuth, session, permission, workspace, and brand tables
  have no destructive migration in the branch.
- [ ] Verify no production environment or secret file is changed.
- [ ] Review the final diff against
  `2026-07-29-brand-center-onboarding-live-integration-design.md`.
- [ ] Only after these checks, hand the branch to the separate PR,
  deployment, OAuth-preservation, Ubuntu rollout, and production browser-QA
  workflow.
