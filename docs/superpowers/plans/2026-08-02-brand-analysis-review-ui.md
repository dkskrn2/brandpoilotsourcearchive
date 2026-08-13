# Brand Analysis Review UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and display a UI-only redesign of the production brand-analysis review component while preserving every controlled field and callback.

**Architecture:** Keep `BrandAnalysisReviewStep` as a controlled component and add only local active-tab presentation state. Reuse the existing `categories` prop for the visual category selector, and add a development-only fixture page so the design can be inspected without API calls or production route changes.

**Tech Stack:** React 18, TypeScript, React Router 6, Vitest, Testing Library, Vite, CSS

---

### Task 1: Lock the production field contract with failing tests

**Files:**
- Modify: `brand_poilot/apps/customer-ui/src/__tests__/brandIntelligenceOnboarding.test.tsx`

- [ ] **Step 1: Add a complete v2 result fixture**

Define a `BrandIntelligenceResult` fixture containing company name support, one-line definition, overview, description, categories, primary and secondary targets, customer needs, value proposition, differentiators, core and supporting appeals, keywords, observed tone, all offering fields, competitors, evidence, and source gaps.

- [ ] **Step 2: Add a failing section-navigation test**

Render the controlled component, assert the five tab names, switch to each tab with `user.click`, and assert its complete field set. The test must verify that the product panel still exposes type, name, description, target, benefit, price, purchase URL, and deletion controls.

- [ ] **Step 3: Add a failing item-editor test**

Switch to `고객·니즈`, edit one secondary target, add an item, fill it, delete another item, and assert the latest controlled `BrandIntelligenceResult.secondaryTargets` array.

- [ ] **Step 4: Run the focused tests and verify failure**

Run:

```powershell
npm test -- --run src/__tests__/brandIntelligenceOnboarding.test.tsx
```

Expected: FAIL because the production component does not yet expose tab navigation or individual array rows.

- [ ] **Step 5: Commit the test contract**

```powershell
git add brand_poilot/apps/customer-ui/src/__tests__/brandIntelligenceOnboarding.test.tsx
git commit -m "test: define brand review ui contract"
```

### Task 2: Implement the controlled tabbed review UI

**Files:**
- Modify: `brand_poilot/apps/customer-ui/src/components/brand-intelligence/BrandAnalysisReviewStep.tsx`

- [ ] **Step 1: Add presentation-only helpers**

Add `ReviewSection`, an auto-resizing textarea helper, a narrative field, and an `EditableTextList` that accepts `label`, `items`, and `onChange`. Adding an empty item disables confirmation until it is filled or deleted; blurring an empty item removes it.

- [ ] **Step 2: Add tab navigation without changing the controlled draft**

Store only `activeSection` in local state. Use five tabs for v2 and four for v1. Each tab must use `role="tab"`, `aria-controls`, `aria-selected`, and a matching `role="tabpanel"`.

- [ ] **Step 3: Map every existing production field to a panel**

Use this exact mapping:

```text
브랜드 핵심: companyName, oneLineDefinition, companyOverview,
businessDescription, primaryCategory, subcategories
고객·니즈: primaryTarget, secondaryTargets, customerNeeds
가치·소구: valueProposition, differentiators, coreAppeal,
supportingAppeals, keywords, observedTone.summary
상품·서비스: kind, name, description, target, benefit,
priceText, purchaseUrl, add/remove actions
경쟁사: name, description, sourceUrls
```

Keep all v1 fallbacks and all current `onChange` result shapes.

- [ ] **Step 4: Preserve validation and offering limits**

Retain all current required fields, category-code validation when categories exist, the five-offering limit, and non-empty offering names. Add a blank-array-item check so a newly added row cannot be submitted.

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
npm test -- --run src/__tests__/brandIntelligenceOnboarding.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the component change**

```powershell
git add brand_poilot/apps/customer-ui/src/components/brand-intelligence/BrandAnalysisReviewStep.tsx brand_poilot/apps/customer-ui/src/__tests__/brandIntelligenceOnboarding.test.tsx
git commit -m "feat: reorganize brand analysis review ui"
```

### Task 3: Style the workspace responsively

**Files:**
- Modify: `brand_poilot/apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: Add desktop workspace styles**

Add styles for `.brand-review-shell`, `.brand-review-nav`, `.brand-review-workspace`, `.brand-review-heading`, `.brand-review-panel`, `.brand-review-list-row`, `.brand-review-offerings`, `.brand-review-competitors`, and `.brand-review-savebar`. Use existing color variables, panel borders, button classes, and focus styles.

- [ ] **Step 2: Add responsive behavior**

At the existing narrow-screen breakpoint, switch the two-column shell to one column, make the tab bar horizontally scrollable, reduce panel padding, and stack the save area. Do not introduce viewport-specific JavaScript.

- [ ] **Step 3: Run type checking and focused tests**

Run:

```powershell
npm run build
npm test -- --run src/__tests__/brandIntelligenceOnboarding.test.tsx
```

Expected: both commands exit 0.

- [ ] **Step 4: Commit the styles**

```powershell
git add brand_poilot/apps/customer-ui/src/styles/prototype.css
git commit -m "style: refine brand review workspace"
```

### Task 4: Add a development-only visual fixture

**Files:**
- Create: `brand_poilot/apps/customer-ui/src/pages/BrandAnalysisReviewPreviewPage.tsx`
- Modify: `brand_poilot/apps/customer-ui/src/routes.tsx`
- Test: `brand_poilot/apps/customer-ui/src/__tests__/brandAnalysisReviewPreview.test.tsx`

- [ ] **Step 1: Write the failing preview test**

Render `BrandAnalysisReviewPreviewPage` in a memory router and assert that it shows the production shell heading, the five review tabs, representative category options, and no save-side effect outside local state.

- [ ] **Step 2: Run the preview test and verify failure**

Run:

```powershell
npm test -- --run src/__tests__/brandAnalysisReviewPreview.test.tsx
```

Expected: FAIL because the preview page does not exist.

- [ ] **Step 3: Create the fixture page**

Create a controlled page with `useState` for company name and a complete v2 `BrandIntelligenceResult`. Pass representative `ContentCategory[]` fixtures to `BrandAnalysisReviewStep`. The confirmation callback changes only a local status message and performs no fetch, gateway, storage, or navigation operation.

- [ ] **Step 4: Register only the development route**

Import the page and add the following child-route spread:

```tsx
...(import.meta.env.DEV
  ? [{ path: "brand-analysis-review-preview", element: <BrandAnalysisReviewPreviewPage /> }]
  : []),
```

The production build must contain no reachable preview route.

- [ ] **Step 5: Run preview and routing tests**

Run:

```powershell
npm test -- --run src/__tests__/brandAnalysisReviewPreview.test.tsx src/__tests__/brandIntelligenceOnboarding.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the preview**

```powershell
git add brand_poilot/apps/customer-ui/src/pages/BrandAnalysisReviewPreviewPage.tsx brand_poilot/apps/customer-ui/src/routes.tsx brand_poilot/apps/customer-ui/src/__tests__/brandAnalysisReviewPreview.test.tsx
git commit -m "feat: add development brand review preview"
```

### Task 5: Verify and show the UI

**Files:**
- No source changes expected

- [ ] **Step 1: Run the full customer UI checks**

Run:

```powershell
npm run build
npm test
```

Expected: both commands exit 0 with no failing tests.

- [ ] **Step 2: Start the local Vite server**

Run from `brand_poilot/apps/customer-ui`:

```powershell
npm run dev -- --port 4178
```

Expected: Vite serves `http://127.0.0.1:4178`.

- [ ] **Step 3: Inspect the development preview**

Open `http://127.0.0.1:4178/brand-analysis-review-preview`, verify every tab visually, confirm the category selector and individual item rows, and verify a narrow viewport does not overflow horizontally.

- [ ] **Step 4: Hand the local preview back to the user**

Keep the preview tab open. Report that production, API calls, and save behavior were not changed or deployed.

### Task 6: Align the fixture with the live production shell

**Files:**
- Modify: `brand_poilot/apps/customer-ui/src/pages/BrandAnalysisReviewPreviewPage.tsx`
- Modify: `brand_poilot/apps/customer-ui/src/styles/prototype.css`
- Test: `brand_poilot/apps/customer-ui/src/__tests__/brandAnalysisReviewPreview.test.tsx`

- [ ] **Step 1: Change the preview test to require the production shell**

Assert the production heading `URL 입력하면 AI가 내 서비스를 분석해줘요`, the three progress controls, the `등록 자료` complementary region, the fixture URL, and the Step 2 heading. Assert that the temporary `LOCAL UI PREVIEW` heading is absent.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npm test -- --run src/__tests__/brandAnalysisReviewPreview.test.tsx
```

Expected: FAIL because the isolated preview page does not render `PreviewShell`.

- [ ] **Step 3: Wrap the fixture in the real production shell**

Import `PreviewShell` and render it with:

```tsx
<PreviewShell
  currentStep="analysis"
  sourceUrl="https://www.danbammsg.co.kr/"
  sourceFiles={[]}
  canEnterStep={(step) => step === "analysis"}
  onStepSelected={() => undefined}
>
  <section className="brand-center-preview__card-heading">
    <h2>AI 분석 결과를 확인하고 수정하세요</h2>
  </section>
  <BrandAnalysisReviewStep {...controlledFixtureProps} />
</PreviewShell>
```

Remove the independent preview header and preview-page layout wrapper. Keep confirmation local-only.

- [ ] **Step 4: Remove preview-specific outer-layout CSS**

Delete `.brand-review-preview-page` and `.brand-review-preview-header` rules. Keep only the local confirmation notice styling, scoped so it does not alter the live page.

- [ ] **Step 5: Run focused tests and production build**

Run:

```powershell
npm test -- --run src/__tests__/brandAnalysisReviewPreview.test.tsx src/__tests__/brandCenterLiveOnboarding.test.tsx
npm run build
```

Expected: tests and build exit 0, with development preview markers absent from `dist`.

- [ ] **Step 6: Reinspect the local page**

Reload `http://127.0.0.1:4178/brand-analysis-review-preview` and verify the outer shell matches the live production page at desktop and narrow widths.

### Task 7: Refine list and offering controls

**Files:**
- Modify: `brand_poilot/apps/customer-ui/src/__tests__/brandIntelligenceOnboarding.test.tsx`
- Modify: `brand_poilot/apps/customer-ui/src/components/brand-intelligence/BrandAnalysisReviewStep.tsx`
- Modify: `brand_poilot/apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: Write the failing control test**

Update the production-field test to assert that `대표 상품 1 위로 이동` and `대표 상품 1 아래로 이동` are absent, and that `대표 상품 1 삭제` is inside the offering heading. Add `brand-review-list-input` assertions for `보조 타깃 1`, `고객 니즈 1`, `차별점 1`, `보조 소구점 1`, and `핵심 키워드 1`.

- [ ] **Step 2: Verify the focused test fails**

Run:

```powershell
npm test -- --run src/__tests__/brandIntelligenceOnboarding.test.tsx
```

Expected: FAIL because reorder buttons still exist and list textareas do not carry the shared input class.

- [ ] **Step 3: Implement the minimal UI change**

Remove `onMoveUp`, `onMoveDown`, and `canMoveDown` from `OfferingEditor`. Render the delete action in `.brand-review-item-title`:

```tsx
<div className="brand-review-item-title">
  <span>{itemNumber}</span>
  <strong>{offering.kind === "product" ? "상품" : "서비스"}</strong>
  <button type="button" className="button icon-button subtle" aria-label={`대표 상품 ${itemNumber} 삭제`} onClick={onRemove}>
    <Trash2 size={16} aria-hidden="true" />
  </button>
</div>
```

Add `brand-review-list-input` to `EditableTextList` textareas and style it with the same border, radius, background, padding, font, and focus treatment used by `.field-stack textarea`.

- [ ] **Step 4: Verify and commit**

Run the focused test above, then commit the three files with `fix: refine brand review controls`.

### Task 8: Load categories in the live review flow

**Files:**
- Modify: `brand_poilot/apps/customer-ui/src/__tests__/brandCenterLiveOnboarding.test.tsx`
- Modify: `brand_poilot/apps/customer-ui/src/pages/LiveBrandCenterOnboarding.tsx`

- [ ] **Step 1: Write failing live-flow tests**

Mock `api.listContentCategories()` to return a representative category with subcategories. Resume a `review_ready` v2 analysis and assert `분석 결과 대표 분야` is a combobox and the registry subcategory checkboxes are visible. Add a rejected-category-request case and assert the existing representative-category text input remains available.

- [ ] **Step 2: Verify the tests fail**

Run:

```powershell
npm test -- --run src/__tests__/brandCenterLiveOnboarding.test.tsx
```

Expected: FAIL because `LiveResultEditor` does not receive categories.

- [ ] **Step 3: Add fail-open category loading**

Import `api` and `ContentCategory`, store `categories` in `LiveBrandCenterOnboardingState`, and load them once for the live brand:

```tsx
const [categories, setCategories] = useState<ContentCategory[]>([]);
useEffect(() => {
  let active = true;
  void api.listContentCategories()
    .then((items) => { if (active) setCategories(items); })
    .catch(() => { if (active) setCategories([]); });
  return () => { active = false; };
}, []);
```

Pass `categories` through `LiveResultEditor` to `BrandAnalysisReviewStep`.

- [ ] **Step 4: Verify and commit**

Run the focused live-flow and review tests, then commit with `feat: load categories for live brand review`.

### Task 9: Transport and validate the category registry

**Files:**
- Modify: `brand_poilot/apps/api/src/brandIntelligenceRepository.ts`
- Modify: `brand_poilot/apps/api/src/brandIntelligenceRepository.test.ts`
- Modify: `brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/contracts.ts`
- Modify: `brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/client.ts`
- Modify: `brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/worker.test.ts`

- [ ] **Step 1: Write failing repository and client tests**

Extend the claim test fixtures with two categories and their ordered subcategories. Assert the claimed job contains:

```ts
categoryRegistry: [{
  code: "marketing",
  name: "마케팅",
  subcategories: [{ code: "content", name: "콘텐츠 마케팅" }],
}]
```

Add completion cases that reject an unknown primary code, an incorrect name for a known code, and a subcategory that belongs to another primary category. Keep `{ code: null, name }` valid only for user-edited completion payloads, not worker results.

- [ ] **Step 2: Verify the focused API tests fail**

Run:

```powershell
npm test --workspace @brand-pilot/api -- --run src/brandIntelligenceRepository.test.ts
```

- [ ] **Step 3: Add the registry to the claim contract**

Add a shared structural type to the API claim and worker job:

```ts
categoryRegistry: Array<{
  code: string;
  name: string;
  subcategories: Array<{ code: string; name: string }>;
}>;
```

During `claimBrandAnalysis`, query active `content_categories` and their active `content_subcategories` ordered by `sort_order, name`, then attach the mapped registry to the claim response.

- [ ] **Step 4: Validate completion against the registry**

Before storing a worker completion, load the registry in the same transaction. Require the v2 primary `code/name` pair to match exactly and each coded subcategory to belong to that primary category. Preserve `code: null` custom subcategories only when the payload is the user-edited result passed by confirmation.

- [ ] **Step 5: Verify and commit**

Run the repository test and worker client test, then commit with `feat: attach category registry to brand analysis jobs`.

### Task 10: Constrain worker category selection

**Files:**
- Modify: `brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/worker.ts`
- Modify: `brand_poilot/workers/brand-pilot-brand-intelligence-worker/scripts/run-codex-brand-intelligence.mjs`
- Modify: `brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/runnerRetry.test.ts`
- Modify: `brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/worker.test.ts`

- [ ] **Step 1: Write the failing runner test**

Capture the brand-core stage prompt and assert it includes the exact category registry and these rules: return an exact registry `code/name` pair, choose coded subcategories only under the selected primary category, return `null` or an empty array when no match exists, and never invent `code: null` custom values.

- [ ] **Step 2: Verify the worker tests fail**

Run:

```powershell
npm test --workspace @brand-pilot/brand-intelligence-worker -- --run src/worker.test.ts src/runnerRetry.test.ts
```

- [ ] **Step 3: Pass the registry to the runner prompt**

Include `categoryRegistry: job.categoryRegistry` in `job.txt`, read it in the runner, and add it to the brand-core stage input and instructions. Do not change `BrandIntelligenceResultV2`.

- [ ] **Step 4: Run targeted verification**

Run:

```powershell
npm test --workspace @brand-pilot/brand-intelligence-worker -- --run src/worker.test.ts src/runnerRetry.test.ts
npm test --workspace @brand-pilot/api -- --run src/brandIntelligenceRepository.test.ts
npm test --workspace @brand-pilot/customer-ui -- --run src/__tests__/brandCenterLiveOnboarding.test.tsx src/__tests__/brandIntelligenceOnboarding.test.tsx src/__tests__/brandAnalysisReviewPreview.test.tsx
npm run build --workspace @brand-pilot/customer-ui
npm run build --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/brand-intelligence-worker
```

- [ ] **Step 5: Commit and update PR #97**

Commit with `feat: constrain brand analysis categories`, push `codex/brand-analysis-review-ui`, and wait for the PR checks before returning to the deployment gate.
