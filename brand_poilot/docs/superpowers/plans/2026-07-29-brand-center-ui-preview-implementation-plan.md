# Brand Center UI Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated authenticated `/brand-center-preview` that demonstrates the approved four-step Brand Center journey with reset-on-reload local mock state.

**Architecture:** A preview-only feature owns typed fixtures, an async-shaped mock adapter, and a reducer that enforces every gate. React components consume that boundary inside the existing authenticated app shell; a dedicated stylesheet supplies the ZET-reference layout without changing `/brand-center` or production navigation.

**Tech Stack:** React 18, TypeScript 5.7, React Router 6, Vitest, Testing Library, Playwright, axe-core, Lucide React, existing customer UI CSS tokens.

---

## Scope and Working Directory

Run every command from:

```text
C:\Users\dkskr\.config\superpowers\worktrees\main\brand-pilot-d-hybrid\brand_poilot
```

Changes are limited to preview UI/tests/CSS and `routes.tsx`. Do not change API, DB,
workers, env, deploy, navigation, `BrandCenterPage.tsx`, or `/brand-center`; use no
network/blob/storage/URL persistence. Reload/remount reconstructs fresh fixtures.

Reuse authenticated child routes, shared UI/loading components and tokens, existing
Brand Center unit-test conventions, and desktop/Pixel 5 axe conventions.

## Planned Files

Create `features/brand-center-preview/{types,previewFixtures,previewReducer,
previewAdapter}.ts` and its test, the preview page/components/CSS, unit integration
test, and Playwright spec. Modify only `src/routes.tsx` outside those new files.

### Task 1: Route, Typed Fixtures, Adapter, and Reducer Gates

**Files:**

- Create: `apps/customer-ui/src/features/brand-center-preview/types.ts`
- Create: `apps/customer-ui/src/features/brand-center-preview/previewFixtures.ts`
- Create: `apps/customer-ui/src/features/brand-center-preview/previewReducer.ts`
- Create: `apps/customer-ui/src/features/brand-center-preview/previewAdapter.ts`
- Create: `apps/customer-ui/src/features/brand-center-preview/previewReducer.test.ts`
- Create: `apps/customer-ui/src/pages/BrandCenterPreviewPage.tsx`
- Modify: `apps/customer-ui/src/routes.tsx`

- [ ] **Step 1: Write the failing state-machine and route tests**

```ts
import { describe, expect, it } from "vitest";
import { router } from "../../routes";
import { createPreviewState } from "./previewFixtures";
import { canEnterStep, previewReducer } from "./previewReducer";

describe("brand center preview state", () => {
  it("returns fresh reset-on-mount fixtures", () => {
    const first = createPreviewState();
    first.sources.url = "https://changed.example";
    expect(createPreviewState().sources.url).toBe("");
  });

  it("invalidates downstream work after source changes", () => {
    const state = createPreviewState({
      currentStep: "generation",
      analysis: { state: "succeeded", error: null },
      brandCoreApproved: true,
      generation: { state: "succeeded", error: null },
    });
    const next = previewReducer(state, {
      type: "source/urlChanged", url: "https://new.example",
    });
    expect(next.analysis.state).toBe("idle");
    expect(next.brandCoreApproved).toBe(false);
    expect(next.generation.state).toBe("idle");
    expect(canEnterStep(next, "approval")).toBe(false);
  });

  it("unlocks generation only after all approvals", () => {
    let state = createPreviewState({
      currentStep: "approval",
      analysis: { state: "succeeded", error: null },
    });
    state = previewReducer(state, { type: "approval/coreApproved" });
    expect(canEnterStep(state, "generation")).toBe(false);
    state = previewReducer(state, { type: "knowledge/allApproved" });
    expect(canEnterStep(state, "generation")).toBe(true);
  });

  it("registers a direct-only authenticated child route", () => {
    const root = router.routes.find((route) => route.path === "/");
    expect(root?.children?.some((route) =>
      route.path === "brand-center-preview")).toBe(true);
  });
});
```

- [ ] **Step 2: Run RED**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- src/features/brand-center-preview/previewReducer.test.ts
```

Expected: FAIL because preview modules and route do not exist.

- [ ] **Step 3: Add the exact public types**

```ts
export type PreviewStep = "sources" | "analysis" | "approval" | "generation";
export type PreviewAsyncState = "idle" | "loading" | "succeeded" | "failed";
export type ReviewStatus = "ai_draft" | "confirmed" | "approved";
export type KnowledgeKind =
  | "faq" | "policy" | "how_to" | "guide" | "product_service";

export interface PreviewFile {
  id: string; name: string; size: number;
  status: "selected";
}
export interface PreviewBrandCore {
  oneLine: string;
  description: string;
  target: string;
  customerProblem: string;
  primaryValue: string;
  differentiators: string[];
  tone: string[];
  priorityMessages: string[];
}
export interface PreviewKnowledgeItem {
  id: string;
  kind: KnowledgeKind;
  title: string;
  content: string;
  reviewStatus: ReviewStatus;
  origin: "ai" | "user";
}
export interface PreviewState {
  currentStep: PreviewStep;
  sources: { url: string; files: PreviewFile[]; error: string | null };
  analysis: { state: PreviewAsyncState; error: string | null };
  brandCore: PreviewBrandCore;
  brandCoreApproved: boolean;
  knowledge: PreviewKnowledgeItem[];
  activeKnowledgeKind: "all" | KnowledgeKind; editingKnowledgeId: string | null;
  generation: { state: PreviewAsyncState; error: string | null };
  announcement: string;
}
```

- [ ] **Step 4: Implement fixture factories, reducer, and gate selectors**

`createPreviewState(override?: Partial<PreviewState>)` must create fresh nested objects
with `structuredClone`. The representative fixture includes a full Brand Core and one
AI draft for every `KnowledgeKind`; do not duplicate production data.

```ts
export function hasSource(state: PreviewState) {
  return Boolean(state.sources.url.trim() || state.sources.files.length);
}
export function approvalsComplete(state: PreviewState) {
  return state.brandCoreApproved
    && state.knowledge.every((item) => item.reviewStatus !== "ai_draft");
}
export function canEnterStep(state: PreviewState, step: PreviewStep) {
  if (step === "sources") return true;
  if (step === "analysis") return hasSource(state);
  if (step === "approval") return state.analysis.state === "succeeded";
  return state.analysis.state === "succeeded" && approvalsComplete(state);
}
```

Define a discriminated `PreviewAction` for source URL/files, step selection, analysis
request/success/failure, core edit/approval, knowledge tab/open/create/update/delete/
approve/all-approved, and generation request/success/failure. Source changes call one
`invalidateAfterSourceChange` helper. Core/knowledge edits reset generation and their
own approval status. `step/selected` ignores locked targets.

- [ ] **Step 5: Implement the replaceable async mock adapter**

```ts
export interface PreviewAdapter {
  analyze(): Promise<"succeeded">;
  generateCardNews(): Promise<"succeeded">;
}
export function createMockPreviewAdapter(options: {
  analysisResult?: "succeeded" | "failed";
  generationResults?: Array<"succeeded" | "failed">;
  delayMs?: number;
} = {}): PreviewAdapter {
  const queue = [...(options.generationResults ?? ["succeeded"])];
  const wait = () => new Promise((resolve) =>
    window.setTimeout(resolve, options.delayMs ?? 120));
  return {
    async analyze() {
      await wait();
      if (options.analysisResult === "failed") throw new Error("mock_analysis_failed");
      return "succeeded";
    },
    async generateCardNews() {
      await wait();
      if ((queue.shift() ?? "succeeded") === "failed") {
        throw new Error("mock_generation_failed");
      }
      return "succeeded";
    },
  };
}
```

- [ ] **Step 6: Add the minimal compilable page and route**

The page creates state only with the reducer initializer, so remount resets it:

```tsx
export function BrandCenterPreviewPage({
  adapter = createMockPreviewAdapter(),
}: { adapter?: PreviewAdapter }) {
  const [state, dispatch] = useReducer(
    previewReducer, undefined, () => createPreviewState(),
  );
  return <section className="content brand-center-preview">
    <h1>Brand Center Preview</h1>
    <p className="visually-hidden" aria-live="polite">{state.announcement}</p>
  </section>;
}
```

Import it in `routes.tsx` and add only:

```tsx
{ path: "brand-center-preview", element: <BrandCenterPreviewPage /> },
```

- [ ] **Step 7: Run GREEN and commit**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- src/features/brand-center-preview/previewReducer.test.ts
npm run build --workspace @brand-pilot/customer-ui
git add apps/customer-ui/src/features/brand-center-preview apps/customer-ui/src/pages/BrandCenterPreviewPage.tsx apps/customer-ui/src/routes.tsx
git commit -m "feat: add brand center preview state machine"
```

Expected: tests and build PASS; one focused commit.

### Task 2: ZET-Style Shell, Source Intake, and Mock Analysis

**Files:**

- Create: `apps/customer-ui/src/components/brand-center-preview/PreviewShell.tsx`
- Create: `apps/customer-ui/src/components/brand-center-preview/SourceIntakeStep.tsx`
- Create: `apps/customer-ui/src/components/brand-center-preview/AnalysisStep.tsx`
- Create: `apps/customer-ui/src/__tests__/brandCenterPreview.test.tsx`
- Create: `apps/customer-ui/src/styles/brand-center-preview.css`
- Modify: `apps/customer-ui/src/pages/BrandCenterPreviewPage.tsx`

- [ ] **Step 1: Write failing source/analysis integration tests**

```tsx
it("requires a source and unlocks review only after analysis", async () => {
  const user = userEvent.setup();
  render(<BrandCenterPreviewPage adapter={createMockPreviewAdapter({ delayMs: 0 })} />);
  expect(screen.getByRole("button", { name: "분석 시작" })).toBeDisabled();
  expect(screen.getByRole("button", { name: /3.*검토·승인/ }))
    .toHaveAttribute("aria-disabled", "true");

  await user.type(screen.getByLabelText("자사 URL"), "https://brand.example");
  await user.upload(
    screen.getByLabelText("브랜드 자료 선택"),
    new File(["brief"], "사업계획서.pdf", { type: "application/pdf" }),
  );
  expect(screen.getByText("사업계획서.pdf")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "분석 시작" }));
  expect(screen.getByRole("status", { name: "브랜드 자료 분석 중" })).toBeVisible();
  expect(await screen.findByText("AI 분석 결과")).toBeVisible();
  expect(screen.getAllByText("AI 초안").length).toBeGreaterThan(0);
});
```

Add a second exact test with an adapter whose first `analyze` rejects and second
resolves; assert failure stays on step 2, `다시 분석` succeeds, and step 3 unlocks.

- [ ] **Step 2: Run RED**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/brandCenterPreview.test.tsx
```

Expected: FAIL because shell/source/analysis components do not exist.

- [ ] **Step 3: Implement the shell and strict step progress**

Use a narrow Lucide icon rail and this fixed progress list:

```ts
const steps = [
  ["sources", "자료 등록"],
  ["analysis", "AI 분석"],
  ["approval", "검토·승인"],
  ["generation", "카드뉴스 생성"],
] as const;
```

Each progress button sets `aria-current="step"` only when current,
`aria-disabled={!canEnterStep(state, id)}`, and dispatches only when allowed. Render a
left `등록 자료 요약` card with URL and file count, a centered white main card, and the
polite live region.

- [ ] **Step 4: Implement URL/files and analysis states**

Use `FileUploadButton` exactly once:

```tsx
<FileUploadButton
  inputLabel="브랜드 자료 선택"
  buttonLabel="사업계획서·소개서 추가"
  accept=".txt,.md,.pdf,.csv,.xlsx"
  multiple
  items={state.sources.files}
  onFiles={(files) => dispatch({ type: "source/filesAdded", files })}
  onRemove={(id) => dispatch({ type: "source/fileRemoved", id })}
/>
```

Require one source and validate a non-empty URL as HTTPS. Submit dispatches
`analysis/requested`, awaits `adapter.analyze`, then dispatches success/failure.
`AnalysisStep` uses `ListSkeleton` during loading, `Alert` plus `다시 분석` on failure,
and a cyan deterministic Brand Core/knowledge summary on success. All generated groups
show `AI 초안`; `검토 시작` selects step 3.

- [ ] **Step 5: Add isolated preview CSS**

Import `../styles/brand-center-preview.css` from the preview page:

```css
.brand-center-preview {
  --preview-navy: #102a43;
  --preview-cyan: #eaf8fb;
  min-height: calc(100vh - 64px);
  padding: 28px clamp(20px, 5vw, 72px) 64px;
  background: #f7fafc;
}
.brand-preview-layout {
  display: grid;
  grid-template-columns: 58px minmax(220px, 280px) minmax(0, 860px);
  justify-content: center;
  gap: clamp(20px, 4vw, 56px);
}
.brand-preview-main-card {
  min-width: 0;
  padding: clamp(24px, 4vw, 48px);
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
}
.brand-preview-analysis-surface { padding: 24px; background: var(--preview-cyan); }
.brand-center-preview .button.primary { background: var(--preview-navy); }
```

The ZET images remain visual references only and are not copied or loaded.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/brandCenterPreview.test.tsx src/features/brand-center-preview/previewReducer.test.ts
npm run build --workspace @brand-pilot/customer-ui
git add apps/customer-ui/src/components/brand-center-preview apps/customer-ui/src/pages/BrandCenterPreviewPage.tsx apps/customer-ui/src/styles/brand-center-preview.css apps/customer-ui/src/__tests__/brandCenterPreview.test.tsx
git commit -m "feat: add brand center preview intake"
```

Expected: source, gate, loading, failure/retry tests and build PASS.

### Task 3: Full Brand Core and Unified Local Knowledge CRUD/Approval

**Files:**

- Create: `apps/customer-ui/src/components/brand-center-preview/ReviewApprovalStep.tsx`
- Create: `apps/customer-ui/src/components/brand-center-preview/BrandCorePreviewEditor.tsx`
- Create: `apps/customer-ui/src/components/brand-center-preview/KnowledgePreviewLibrary.tsx`
- Modify: `apps/customer-ui/src/features/brand-center-preview/previewReducer.ts`
- Modify: `apps/customer-ui/src/pages/BrandCenterPreviewPage.tsx`
- Modify: `apps/customer-ui/src/styles/brand-center-preview.css`
- Modify: `apps/customer-ui/src/__tests__/brandCenterPreview.test.tsx`

- [ ] **Step 1: Write failing review and CRUD tests**

```tsx
it("reviews full core and unified knowledge with trust states", async () => {
  const user = userEvent.setup();
  await renderReadyForApproval(user);
  for (const name of ["전체", "FAQ", "정책", "사용법", "가이드", "제품·서비스"]) {
    expect(screen.getByRole("tab", { name })).toBeVisible();
  }
  for (const name of ["고객 문제", "차별점", "브랜드 톤", "우선 메시지"]) {
    expect(screen.getByLabelText(name)).toBeVisible();
  }
  await user.click(screen.getByRole("button", { name: "항목 추가" }));
  expect(screen.getByRole("dialog", { name: "지식 항목 추가" })).toBeVisible();
  await user.selectOptions(screen.getByLabelText("지식 유형"), "faq");
  await user.type(screen.getByLabelText("지식 제목"), "직접 등록 질문");
  await user.type(screen.getByLabelText("지식 내용"), "직접 등록 답변");
  await user.click(screen.getByRole("button", { name: "저장" }));
  expect(screen.getByText("확정됨")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "AI 초안 모두 승인" }));
  await user.click(screen.getByRole("button", { name: "Brand Core 승인" }));
  expect(screen.getByRole("button", { name: /4.*카드뉴스 생성/ }))
    .toHaveAttribute("aria-disabled", "false");
});
```

Add a second test that opens `<제목> 편집`, saves a changed AI row, verifies step 4
locks, uses `<제목> 삭제` with `window.confirm`, closes the drawer with Escape, and
asserts focus returns to the invoking button.

- [ ] **Step 2: Run RED**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/brandCenterPreview.test.tsx
```

Expected: FAIL because review and CRUD surfaces do not exist.

- [ ] **Step 3: Implement the complete Brand Core editor**

Render labeled controls for one-line summary, description, target, customer problem,
primary value, differentiators, tone, and priority messages. Convert arrays with:

```ts
const toLines = (value: string) =>
  value.split("\n").map((line) => line.trim()).filter(Boolean);
```

Every edit dispatches `core/changed`, clears Brand Core approval, resets generation,
and announces reapproval. `Brand Core 승인` requires every scalar and at least one item
in each array, shows a field-level error, and focuses the first invalid control.

- [ ] **Step 4: Implement six tabs and local CRUD drawer**

```ts
const knowledgeTabs = [
  ["all", "전체"], ["faq", "FAQ"], ["policy", "정책"],
  ["how_to", "사용법"], ["guide", "가이드"],
  ["product_service", "제품·서비스"],
] as const;
```

Use correct `tablist/tab/tabpanel` semantics. Rows show type and `AI 초안`, `확정됨`,
or `승인됨`. The labeled dialog contains type/title/content and saves:

```ts
const item: PreviewKnowledgeItem = {
  id: existing?.id ?? crypto.randomUUID(),
  kind,
  title: title.trim(),
  content: content.trim(),
  origin: existing?.origin ?? "user",
  reviewStatus: existing?.origin === "ai" ? "ai_draft" : "confirmed",
};
dispatch({ type: existing ? "knowledge/updated" : "knowledge/created", item });
```

AI rows approve individually or via `AI 초안 모두 승인`. Delete confirms, mutates only
local state, and restores focus. Escape closes and restores focus. New user rows are
confirmed immediately. Editing an approved AI row returns it to AI draft.

- [ ] **Step 5: Compose approval and enforce the gate**

Place the complete editor and library on the cyan surface. Show:

```tsx
<span>{state.brandCoreApproved ? "Brand Core 승인됨" : "Brand Core 검토 필요"}</span>
<span>지식 초안 {state.knowledge.filter((item) =>
  item.reviewStatus === "ai_draft").length}개</span>
```

Enable `카드뉴스 만들기` only when `approvalsComplete(state)`. Never render Wiki,
Wiki build/version, worker, or execution-rule terminology.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/brandCenterPreview.test.tsx src/features/brand-center-preview/previewReducer.test.ts
npm run build --workspace @brand-pilot/customer-ui
git add apps/customer-ui/src/components/brand-center-preview apps/customer-ui/src/features/brand-center-preview/previewReducer.ts apps/customer-ui/src/pages/BrandCenterPreviewPage.tsx apps/customer-ui/src/styles/brand-center-preview.css apps/customer-ui/src/__tests__/brandCenterPreview.test.tsx
git commit -m "feat: add preview knowledge approval flow"
```

Expected: full core, six tabs, CRUD, trust states, focus, invalidation, and gate tests
PASS; build succeeds.

### Task 4: Card States, Responsive/A11y, Regression, and Browser Gate

**Files:**

- Create: `apps/customer-ui/src/components/brand-center-preview/CardGenerationStep.tsx`
- Create: `apps/customer-ui/e2e/brand-center-preview.spec.ts`
- Modify: `apps/customer-ui/src/pages/BrandCenterPreviewPage.tsx`,
  `apps/customer-ui/src/styles/brand-center-preview.css`,
  `apps/customer-ui/src/__tests__/brandCenterPreview.test.tsx`, and
  `apps/customer-ui/src/features/brand-center-preview/previewReducer.test.ts`
- Test unchanged: `apps/customer-ui/src/__tests__/brandCenter.test.tsx` and
  `apps/customer-ui/src/features/navigation/navigationModel.test.ts`

- [ ] **Step 1: Write failing generation tests**

```tsx
it("blocks completion on failure and succeeds only after retry", async () => {
  const adapter = createMockPreviewAdapter({
    delayMs: 0, generationResults: ["failed", "succeeded"],
  });
  const user = userEvent.setup();
  await renderReadyForGeneration(user, adapter);
  await user.click(screen.getByRole("button", { name: "카드뉴스 생성" }));
  expect(screen.getByRole("status", { name: "카드뉴스 생성 중" })).toBeVisible();
  expect(await screen.findByText("카드뉴스를 완성하지 못했습니다")).toBeVisible();
  expect(screen.queryByText("생성 완료")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "다시 생성" }));
  expect(await screen.findByText("생성 완료")).toBeVisible();
  expect(screen.getAllByRole("article", { name: /카드 [1-4]/ })).toHaveLength(4);
});
```

Add a reducer assertion that `generation/failed` stays failed at step 4; only
`generation/succeeded` completes.

- [ ] **Step 2: Run RED**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/brandCenterPreview.test.tsx src/features/brand-center-preview/previewReducer.test.ts
```

Expected: FAIL because card generation UI does not exist.

- [ ] **Step 3: Implement ready/loading/success/failure/retry**

Ready summarizes approved source, core, and knowledge only. Dispatch:

```ts
dispatch({ type: "generation/requested" });
try {
  await adapter.generateCardNews();
  dispatch({ type: "generation/succeeded" });
} catch {
  dispatch({
    type: "generation/failed",
    error: "카드뉴스를 완성하지 못했습니다. 승인된 정보는 유지됩니다.",
  });
}
```

Loading uses `InlineSpinner`, a named `role=status`, and disabled duplicate submission.
Success renders four deterministic square card articles and `생성 완료`. Failure shows
no completion language and offers `다시 생성`.

- [ ] **Step 4: Complete responsive/accessibility CSS**

```css
@media (max-width: 980px) {
  .brand-preview-layout { grid-template-columns: 52px minmax(0, 1fr); }
  .brand-preview-source-context, .brand-preview-main-card { grid-column: 2; }
}
@media (max-width: 640px) {
  .brand-center-preview { padding: 16px 12px 40px; }
  .brand-preview-layout { grid-template-columns: 1fr; gap: 14px; }
  .brand-preview-icon-rail { display: none; }
  .brand-preview-source-context, .brand-preview-main-card { grid-column: 1; }
  .brand-preview-progress { overflow-x: auto; }
  .brand-preview-knowledge-row { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .brand-center-preview * { transition-duration: .01ms !important; animation-duration: .01ms !important; }
}
```

Add visible focus outlines, minimum 44px targets, non-color gate labels, and no document
horizontal overflow. Keep scrolling bounded to the tab strip when necessary.

- [ ] **Step 5: Add Playwright desktop/mobile/axe coverage**

Stub only existing authenticated shell/session/status requests; preview actions make no
requests. The test flow must assert direct access, no sidebar link, locked step 4,
source→analysis→approve-all/core→generate, result, reload reset, and axe:

```ts
await page.goto("/brand-center-preview");
await expect(page.getByRole("heading", { name: "Brand Center Preview" })).toBeVisible();
await expect(page.getByRole("link", { name: "Brand Center Preview" })).toHaveCount(0);
await expect(page.getByRole("button", { name: /4.*카드뉴스 생성/ }))
  .toHaveAttribute("aria-disabled", "true");
await page.getByLabel("자사 URL").fill("https://brand.example");
await page.getByRole("button", { name: "분석 시작" }).click();
await page.getByRole("button", { name: "검토 시작" }).click();
await page.getByRole("button", { name: "AI 초안 모두 승인" }).click();
await page.getByRole("button", { name: "Brand Core 승인" }).click();
await page.getByRole("button", { name: "카드뉴스 만들기" }).click();
await page.getByRole("button", { name: "카드뉴스 생성" }).click();
const results = await new AxeBuilder({ page }).analyze();
expect(results.violations).toEqual([]);
```

On mobile also assert:

```ts
expect(await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth,
)).toBe(true);
```

- [ ] **Step 6: Run regression and browser gates**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/brandCenterPreview.test.tsx src/features/brand-center-preview/previewReducer.test.ts src/__tests__/brandCenter.test.tsx src/features/navigation/navigationModel.test.ts
npm run build --workspace @brand-pilot/customer-ui
npm run e2e --workspace @brand-pilot/customer-ui -- e2e/brand-center-preview.spec.ts
```

Expected: focused tests PASS, existing Brand Center/navigation tests PASS, build PASS,
desktop/mobile and axe PASS. Navigation retains `/brand-center` and excludes the
preview path.

- [ ] **Step 7: Run headed visual and final scope gates**

```powershell
npx playwright test e2e/brand-center-preview.spec.ts --config apps/customer-ui/playwright.config.ts --headed
git diff --check
git status --short
git diff --name-only
```

At 1440×900 and Pixel 5 confirm the narrow rail, four-step progress, source card,
centered white card, cyan editor, navy CTA, whitespace, focus, and mobile stacking.
Changed paths must match this plan; no API/DB/worker/env/deploy/navigation-model/
`BrandCenterPage.tsx` changes are allowed.

- [ ] **Step 8: Commit Task 4**

```powershell
git add apps/customer-ui/src/components/brand-center-preview/CardGenerationStep.tsx apps/customer-ui/src/features/brand-center-preview/previewReducer.test.ts apps/customer-ui/src/pages/BrandCenterPreviewPage.tsx apps/customer-ui/src/styles/brand-center-preview.css apps/customer-ui/src/__tests__/brandCenterPreview.test.tsx apps/customer-ui/e2e/brand-center-preview.spec.ts
git commit -m "feat: complete brand center preview"
```

## Final Verification

```powershell
npm run test --workspace @brand-pilot/customer-ui
npm run build --workspace @brand-pilot/customer-ui
npm run e2e --workspace @brand-pilot/customer-ui -- e2e/brand-center-preview.spec.ts
git diff --check HEAD~4..HEAD
git status --short --branch
```

Expected: all gates PASS, four focused commits, clean worktree, `/brand-center`
preserved, preview absent from sidebar, reload reset, and no backend/ops changes.

## 2026-07-29 UI simplification addendum

This single task supersedes conflicting preview-only labels, visible knowledge types,
fixture counts, and item-approval steps above.

**Scope:** UI and local mock state only. Keep knowledge CRUD and the generation gate.
Do not change API, database, migration, worker, environment, deployment, production
navigation, or Brand Center behavior.

**RED assertions:**

- A: Step 2 contains no `AI 초안` chip. Every knowledge item has an enabled content
  textarea before `검토 시작`, and an edit persists into Step 3.
- B: Policy is absent from visible types, tabs, and initial mock cards. The initial
  mock contains three FAQ items and three product/service items.
- C: Step 3 has no per-item approval control. Its only section approval controls are
  exactly `브랜드 코어 승인` and `브랜드 지식 승인`.
- D: Card generation remains disabled until both section approvals occur, then
  becomes enabled. Existing create, edit, delete, validation, focus, and reset
  behavior remains available.

**Implementation files:**

- `apps/customer-ui/src/components/brand-center-preview/AnalysisStep.tsx`
- `apps/customer-ui/src/components/brand-center-preview/BrandCorePreviewEditor.tsx`
- `apps/customer-ui/src/components/brand-center-preview/KnowledgePreviewLibrary.tsx`
- `apps/customer-ui/src/components/brand-center-preview/ReviewApprovalStep.tsx`
- `apps/customer-ui/src/features/brand-center-preview/previewFixtures.ts`
- `apps/customer-ui/src/features/brand-center-preview/previewReducer.ts`
- `apps/customer-ui/src/pages/BrandCenterPreviewPage.tsx`
- Existing preview component/reducer tests; update the focused preview E2E labels only
  if needed for the local screenshot flow.

**Execution:**

1. Add assertions A-D to existing preview tests and run them to capture expected RED.
2. Make the smallest implementation and mock changes that satisfy those assertions.
3. Run:

   ```powershell
   npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/brandCenterPreview.test.tsx src/features/brand-center-preview/previewReducer.test.ts
   npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/brandCenter.test.tsx src/features/navigation/navigationModel.test.ts
   npm run build --workspace @brand-pilot/customer-ui
   ```

4. If it fits within 30 seconds, rebuild the existing local production preview and
   capture the simplified UI screenshot.
5. Verify `git diff --check`, changed-file scope, and repository status, then commit
   implementation separately from this docs-only addendum.
