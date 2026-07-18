# AI Content Studio Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authenticated React screens and mock interactions for Brand Pilot's six-step AI content studio without connecting a real API, database, LLM, image model, storage, billing, or publishing backend.

**Architecture:** Keep AI content creation in a dedicated frontend feature boundary instead of reusing the automatic-operation `channel_outputs` domain. A typed in-memory mock gateway supplies usage, presets, references, jobs, and outputs; pages consume that gateway so a later API client can replace it without rewriting UI components. Existing `AppShell`, loading components, and `PublishArtifactPreview` remain the shared shell and preview primitives.

**Tech Stack:** React 18, TypeScript, React Router 6, Vitest, Testing Library, lucide-react, existing `prototype.css` design tokens.

---

## File Structure

**Create**

- `apps/customer-ui/src/features/ai-content/types.ts`: AI studio draft, preset, reference, job, output, usage, and gateway contracts.
- `apps/customer-ui/src/features/ai-content/mockAiContentGateway.ts`: deterministic screen-only data and mock mutations.
- `apps/customer-ui/src/features/ai-content/useAiContentDraft.ts`: six-step draft state and validation.
- `apps/customer-ui/src/components/ai-content/AiContentUsageSummary.tsx`: generation and new-download usage.
- `apps/customer-ui/src/components/ai-content/AiContentJobList.tsx`: progress, success, partial failure, and failure rows.
- `apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx`: step indicator and step-specific controls.
- `apps/customer-ui/src/components/ai-content/SavedAudienceAppealLibrary.tsx`: reusable brand target and appeal presets.
- `apps/customer-ui/src/components/ai-content/ReferencePicker.tsx`: reference filters and selected-reference tray.
- `apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx`: per-output preview, retry, download, and publish gating.
- `apps/customer-ui/src/pages/AiContentHomePage.tsx`: studio home.
- `apps/customer-ui/src/pages/AiContentWizardPage.tsx`: six-step flow.
- `apps/customer-ui/src/pages/AiContentGenerationPage.tsx`: job and output detail.
- `apps/customer-ui/src/__tests__/aiContentHome.test.tsx`: home, usage, and navigation tests.
- `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`: step, preset, reference, and attachment tests.
- `apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx`: result state, retry, download, and publish gating tests.

**Modify**

- `apps/customer-ui/src/routes.tsx`: add three authenticated routes.
- `apps/customer-ui/src/components/layout/Sidebar.tsx`: add `AI 콘텐츠 생성` customer navigation.
- `apps/customer-ui/src/__tests__/navigation.test.tsx`: assert new navigation and routes.
- `apps/customer-ui/src/styles/prototype.css`: desktop, tablet, mobile, state, and accessibility styles.

---

### Task 1: Define the screen-only domain contract

**Files:**
- Create: `apps/customer-ui/src/features/ai-content/types.ts`
- Create: `apps/customer-ui/src/features/ai-content/mockAiContentGateway.ts`
- Test: `apps/customer-ui/src/__tests__/aiContentHome.test.tsx`

- [ ] **Step 1: Write the failing mock contract test**

```tsx
import { describe, expect, it } from "vitest";
import { mockAiContentGateway } from "../features/ai-content/mockAiContentGateway";

describe("AI content mock gateway", () => {
  it("returns usage and jobs with individual output states", async () => {
    const usage = await mockAiContentGateway.getUsage("brand-1");
    const jobs = await mockAiContentGateway.listGenerations("brand-1");

    expect(usage).toMatchObject({ generationUsed: 2, generationLimit: 5 });
    expect(jobs.some((job) => job.status === "partial_failed")).toBe(true);
    expect(jobs.flatMap((job) => job.outputs).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npm run test --workspace @brand-pilot/customer-ui -- aiContentHome.test.tsx`

Expected: FAIL because `mockAiContentGateway` does not exist.

- [ ] **Step 3: Add explicit types and gateway methods**

Define these unions and interfaces in `types.ts`:

```ts
export type AiContentType = "card_news" | "blog" | "marketing";
export type AiGenerationStatus = "draft" | "analyzing" | "planning" | "generating" | "completed" | "partial_failed" | "failed";
export type AiOutputStatus = "queued" | "planning" | "generating" | "completed" | "failed";

export interface AiContentUsage {
  generationUsed: number;
  generationLimit: number;
  newDownloadUsed: number;
  newDownloadLimit: number;
  resetsAt: string;
}

export interface AudiencePreset {
  id: string;
  name: string;
  situation: string;
  problem: string;
  motivation: string;
  useCount: number;
  lastUsedAt: string | null;
}

export interface AppealPreset {
  id: string;
  title: string;
  description: string;
  evidenceType: "fact" | "benefit" | "price" | "trust" | "emotion";
  useCount: number;
  lastUsedAt: string | null;
}

export type AudienceSnapshot = Pick<AudiencePreset, "id" | "name" | "situation" | "problem" | "motivation">;
export type AppealSnapshot = Pick<AppealPreset, "id" | "title" | "description" | "evidenceType">;

export interface AiContentReference {
  id: string;
  title: string;
  previewUrl: string | null;
  source: "owned" | "api" | "saved_trend" | "uploaded";
  format: "card_news" | "image" | "reel" | "blog" | "marketing";
  primaryCategory: string | null;
  subcategory: string | null;
  appealIds: string[];
  comparableMetric: { label: string; value: number } | null;
}

export interface GenerationAttachment {
  id: string;
  role: "product" | "person" | "scale" | "visual_reference" | "document";
  fileName: string;
  mimeType: string;
  size: number;
}

export interface GenerationBrief {
  purpose: "sales" | "awareness" | "information" | "event";
  emphasis: string;
  cta: string;
  additionalInstruction: string;
  attachments: GenerationAttachment[];
  aspectRatio: "1:1" | "4:5" | "9:16";
  outputCount: 1 | 2 | 3;
  outputDirections: string[];
}

export interface AiContentDraft {
  type: AiContentType | null;
  analysisSource: "owned" | "product_url" | null;
  productUrl: string;
  selectedAnalysisImageIds: string[];
  audience: AudienceSnapshot | null;
  coreAppeal: AppealSnapshot | null;
  secondaryAppeals: AppealSnapshot[];
  referenceIds: string[];
  brief: GenerationBrief | null;
}

export interface AiGenerationOutput {
  id: string;
  generationId: string;
  title: string;
  status: AiOutputStatus;
  artifact: import("../../types").PublishArtifact | null;
  failureReason: string | null;
  downloadedAt: string | null;
}

export interface AiContentGeneration {
  id: string;
  brandId: string;
  title: string;
  type: AiContentType;
  status: AiGenerationStatus;
  currentStep: number;
  draft: AiContentDraft;
  outputs: AiGenerationOutput[];
  createdAt: string;
  updatedAt: string;
}
```

Add the gateway contract with these required methods:

```ts
export interface AiContentGateway {
  getUsage(brandId: string): Promise<AiContentUsage>;
  listGenerations(brandId: string): Promise<AiContentGeneration[]>;
  getGeneration(generationId: string): Promise<AiContentGeneration>;
  listAudiencePresets(brandId: string): Promise<AudiencePreset[]>;
  saveAudiencePreset(brandId: string, input: Omit<AudiencePreset, "id" | "useCount" | "lastUsedAt">): Promise<AudiencePreset>;
  listAppealPresets(brandId: string): Promise<AppealPreset[]>;
  saveAppealPreset(brandId: string, input: Omit<AppealPreset, "id" | "useCount" | "lastUsedAt">): Promise<AppealPreset>;
  listReferences(brandId: string): Promise<AiContentReference[]>;
  retryOutput(outputId: string, reason: string): Promise<AiGenerationOutput>;
}
```

Implement deterministic mock values, including one generating job, one completed job, and one partial-failure job. Duplicate preset saves must return the existing normalized item rather than adding another item.

- [ ] **Step 4: Run the contract test**

Run: `npm run test --workspace @brand-pilot/customer-ui -- aiContentHome.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/customer-ui/src/features/ai-content apps/customer-ui/src/__tests__/aiContentHome.test.tsx
git commit -m "feat: add AI content studio mock contracts"
```

### Task 2: Add routes, navigation, and studio home

**Files:**
- Create: `apps/customer-ui/src/pages/AiContentHomePage.tsx`
- Create: `apps/customer-ui/src/components/ai-content/AiContentUsageSummary.tsx`
- Create: `apps/customer-ui/src/components/ai-content/AiContentJobList.tsx`
- Modify: `apps/customer-ui/src/routes.tsx`
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Modify: `apps/customer-ui/src/__tests__/navigation.test.tsx`
- Test: `apps/customer-ui/src/__tests__/aiContentHome.test.tsx`

- [ ] **Step 1: Add failing navigation and home assertions**

Assert that the sidebar link resolves to `/ai-content`, all three type buttons resolve to `/ai-content/new?type=...`, usage is visible, and the partial failure row exposes `상세 보기`.

```tsx
expect(screen.getByRole("link", { name: "AI 콘텐츠 생성" })).toHaveAttribute("href", "/ai-content");
expect(await screen.findByText("오늘 사용량")).toBeVisible();
expect(screen.getByRole("link", { name: "카드뉴스 만들기" })).toHaveAttribute("href", "/ai-content/new?type=card_news");
expect(screen.getByText("부분 실패")).toBeVisible();
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm run test --workspace @brand-pilot/customer-ui -- navigation.test.tsx aiContentHome.test.tsx`

Expected: FAIL because the route and page do not exist.

- [ ] **Step 3: Implement the authenticated routes and home hierarchy**

Add these route children:

```tsx
{ path: "ai-content", element: <AiContentHomePage /> },
{ path: "ai-content/new", element: <AiContentWizardPage /> },
{ path: "ai-content/:generationId", element: <AiContentGenerationPage /> }
```

Place `AI 콘텐츠 생성` after `대시보드` in the customer navigation. The home must show, in order: page heading and primary create action, usage, content type choices, active/recent jobs, and same-channel/format performance references. Use `PageSkeleton` while mock promises resolve.

- [ ] **Step 4: Run focused tests**

Run: `npm run test --workspace @brand-pilot/customer-ui -- navigation.test.tsx aiContentHome.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/customer-ui/src/routes.tsx apps/customer-ui/src/components/layout/Sidebar.tsx apps/customer-ui/src/components/ai-content apps/customer-ui/src/pages/AiContentHomePage.tsx apps/customer-ui/src/__tests__/navigation.test.tsx apps/customer-ui/src/__tests__/aiContentHome.test.tsx
git commit -m "feat: add AI content studio home"
```

### Task 3: Build the wizard shell and product analysis step

**Files:**
- Create: `apps/customer-ui/src/features/ai-content/useAiContentDraft.ts`
- Create: `apps/customer-ui/src/pages/AiContentWizardPage.tsx`
- Create: `apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx`
- Test: `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`

- [ ] **Step 1: Write failing step-navigation tests**

Test that the query-string type preselects Step 1, required values disable `다음`, previous values survive back navigation, product URL is optional, and `분석 상세 보기` reveals internal evidence without placing the URL in output copy.

```tsx
expect(screen.getByText("1 / 6")).toBeVisible();
expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
await user.click(screen.getByRole("button", { name: "자사 정보만 사용" }));
expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm run test --workspace @brand-pilot/customer-ui -- aiContentWizard.test.tsx`

Expected: FAIL because the wizard page does not exist.

- [ ] **Step 3: Implement draft state and validation**

The hook must expose immutable state and these actions:

```ts
type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

interface AiContentDraftActions {
  setType(type: AiContentType): void;
  setAnalysisSource(source: "owned" | "product_url"): void;
  setProductUrl(url: string): void;
  setSelectedAnalysisImages(ids: string[]): void;
  setAudience(snapshot: AudienceSnapshot): void;
  setAppeals(core: AppealSnapshot, secondary: AppealSnapshot[]): void;
  setReferences(ids: string[]): void;
  reorderReference(from: number, to: number): void;
  setBrief(brief: GenerationBrief): void;
  goNext(): void;
  goBack(): void;
}
```

Step 2 must render analysis loading, success, and failure mock controls. The detail disclosure shows USP, customer problem, motivation, alternatives, and internal evidence links. Use visible labels instead of placeholders as labels.

- [ ] **Step 4: Run the wizard tests**

Run: `npm run test --workspace @brand-pilot/customer-ui -- aiContentWizard.test.tsx`

Expected: PASS for Steps 1 and 2.

- [ ] **Step 5: Commit**

```powershell
git add apps/customer-ui/src/features/ai-content/useAiContentDraft.ts apps/customer-ui/src/pages/AiContentWizardPage.tsx apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx apps/customer-ui/src/__tests__/aiContentWizard.test.tsx
git commit -m "feat: add AI content analysis wizard"
```

### Task 4: Add reusable target and appeal presets

**Files:**
- Create: `apps/customer-ui/src/components/ai-content/SavedAudienceAppealLibrary.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx`
- Modify: `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`

- [ ] **Step 1: Add failing preset interaction tests**

Cover `AI 추천 / 저장한 타깃`, manual target creation, saving, selecting it in a second draft, core/secondary appeal assignment, and duplicate prevention.

```tsx
await user.click(screen.getByRole("button", { name: "선택한 타깃 저장" }));
await user.click(screen.getByRole("tab", { name: "저장한 타깃" }));
expect(screen.getByRole("button", { name: /2030 직장인/ })).toBeVisible();
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm run test --workspace @brand-pilot/customer-ui -- aiContentWizard.test.tsx`

Expected: FAIL because the preset library is absent.

- [ ] **Step 3: Implement brand-scoped preset selection**

Use tabs with `role="tablist"`, `role="tab"`, and `aria-selected`. Saving copies the candidate into the mock gateway; selecting copies a snapshot into the current draft. Core/secondary role belongs only to the draft, never to the saved appeal. Editing or deleting a preset must not mutate snapshots already selected in the current generation.

- [ ] **Step 4: Run the focused test**

Run: `npm run test --workspace @brand-pilot/customer-ui -- aiContentWizard.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/customer-ui/src/components/ai-content/SavedAudienceAppealLibrary.tsx apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx apps/customer-ui/src/__tests__/aiContentWizard.test.tsx
git commit -m "feat: reuse saved audiences and appeals"
```

### Task 5: Add the reference library and selected tray

**Files:**
- Create: `apps/customer-ui/src/components/ai-content/ReferencePicker.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx`
- Modify: `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`

- [ ] **Step 1: Add failing reference tests**

Test category, appeal, search, saved, and upload tabs; type/source filters; maximum five selections; removal; keyboard reorder; and advancing with zero references.

```tsx
expect(screen.getByText("선택한 레퍼런스 0 / 5")).toBeVisible();
expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
await user.click(screen.getByRole("button", { name: "레퍼런스 선택: 자체 콘텐츠 1" }));
expect(screen.getByText("선택한 레퍼런스 1 / 5")).toBeVisible();
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm run test --workspace @brand-pilot/customer-ui -- aiContentWizard.test.tsx`

Expected: FAIL because `ReferencePicker` does not exist.

- [ ] **Step 3: Implement the library and responsive selected tray**

Desktop uses a sticky secondary column. Mobile moves the tray below filters and above results. Reorder buttons must be named `앞으로 이동` and `뒤로 이동`; drag-and-drop may be added later but cannot be the only control. Each reference card displays preview, source, format, category, and comparable performance only when available.

- [ ] **Step 4: Run the focused test**

Run: `npm run test --workspace @brand-pilot/customer-ui -- aiContentWizard.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/customer-ui/src/components/ai-content/ReferencePicker.tsx apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx apps/customer-ui/src/__tests__/aiContentWizard.test.tsx
git commit -m "feat: add AI content reference picker"
```

### Task 6: Add the generation brief, attachment roles, and quota preview

**Files:**
- Modify: `apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx`
- Modify: `apps/customer-ui/src/features/ai-content/useAiContentDraft.ts`
- Modify: `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`

- [ ] **Step 1: Add failing brief tests**

Cover visible labels, required purpose, attachment type/size/count errors, product/person/scale/visual roles, marketing output count 1–3, optional per-output directions, and estimated successful-output usage.

```tsx
expect(screen.getByLabelText("목적")).toBeVisible();
expect(screen.getByLabelText("크기·비율 참고 이미지")).toBeVisible();
await user.selectOptions(screen.getByLabelText("결과 개수"), "3");
expect(screen.getByText("예상 생성 사용량 3회")).toBeVisible();
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm run test --workspace @brand-pilot/customer-ui -- aiContentWizard.test.tsx`

Expected: FAIL on missing brief controls.

- [ ] **Step 3: Implement Step 5 contracts**

Accept PNG, JPEG, WebP, and PDF; reject files over 10MB, more than five total files, or duplicate name/size pairs. Card news displays one set with worker-decided 1–5 slides, blog displays one article plus cover, and marketing enables output count and per-output direction fields. Do not render a model selector.

- [ ] **Step 4: Run the focused test**

Run: `npm run test --workspace @brand-pilot/customer-ui -- aiContentWizard.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx apps/customer-ui/src/features/ai-content/useAiContentDraft.ts apps/customer-ui/src/__tests__/aiContentWizard.test.tsx
git commit -m "feat: add AI content generation brief"
```

### Task 7: Add result detail, partial retry, download contracts, and publishing gate

**Files:**
- Create: `apps/customer-ui/src/pages/AiContentGenerationPage.tsx`
- Create: `apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx`
- Test: `apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx`

- [ ] **Step 1: Write failing result tests**

Test image gallery, HTML, image-plus-copy previews, per-output status, failed-only retry with reason, individual/all download labels, and connected/disconnected Instagram states.

```tsx
expect(await screen.findByText("2 / 3개 완료")).toBeVisible();
expect(screen.getByRole("button", { name: "결과 3 다시 생성" })).toBeVisible();
expect(screen.getByRole("button", { name: "전체 다운로드" })).toBeVisible();
expect(screen.getByRole("button", { name: "게시 관리로 보내기" })).toBeDisabled();
expect(screen.getByText("Instagram 채널 연결 필요")).toBeVisible();
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm run test --workspace @brand-pilot/customer-ui -- aiContentGeneration.test.tsx`

Expected: FAIL because the generation page is absent.

- [ ] **Step 3: Implement output adaptation and actions**

Adapt every completed output to existing `PublishArtifact` using the output ID as the preview key. Present these download labels without starting real downloads:

```ts
const downloadContracts = {
  card_news: ["PNG 이미지", "캡션·해시태그 TXT", "전체 ZIP"],
  blog: ["HTML", "대표 이미지", "전체 ZIP"],
  marketing: ["PNG", "카피 TXT", "선택 결과 ZIP", "전체 ZIP"]
} as const;
```

Retry requires a non-empty reason and updates only the selected mock output. The publish button is rendered only for card news; it is enabled only when the mock Instagram connection is `connected`, otherwise link to `/channels`.

- [ ] **Step 4: Run the result test**

Run: `npm run test --workspace @brand-pilot/customer-ui -- aiContentGeneration.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/customer-ui/src/pages/AiContentGenerationPage.tsx apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx
git commit -m "feat: add AI content generation results"
```

### Task 8: Apply responsive, loading, empty, error, and accessibility states

**Files:**
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Modify: `apps/customer-ui/src/__tests__/aiContentHome.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/responsiveStyles.test.ts`

- [ ] **Step 1: Add failing state and stylesheet tests**

Cover page skeletons, warm empty-state actions, analysis failure, generation failure, quota reached, 44px minimum interactive targets, mobile step summary, and sticky desktop reference tray becoming static on mobile.

```tsx
expect(screen.getByRole("status", { name: "AI 콘텐츠를 불러오는 중입니다." })).toHaveClass("skeleton-page");
expect(screen.getByRole("link", { name: "자사 정보 등록" })).toHaveAttribute("href", "/brand-settings");
```

- [ ] **Step 2: Run tests and verify failures**

Run: `npm run test --workspace @brand-pilot/customer-ui -- aiContentHome.test.tsx aiContentWizard.test.tsx aiContentGeneration.test.tsx responsiveStyles.test.ts`

Expected: FAIL on missing responsive/state rules.

- [ ] **Step 3: Implement intentional responsive behavior**

At widths below 900px, collapse secondary columns below the primary workspace. At widths below 640px, show `현재 단계 / 6` plus the current name instead of six labels, make action bars sticky at the viewport bottom without covering content, and use a single-column reference grid. Preserve focus outlines, `aria-live="polite"` for progress, and text labels in addition to status colors.

- [ ] **Step 4: Run focused tests and build**

Run: `npm run test --workspace @brand-pilot/customer-ui -- aiContentHome.test.tsx aiContentWizard.test.tsx aiContentGeneration.test.tsx responsiveStyles.test.ts`

Expected: PASS.

Run: `npm run build --workspace @brand-pilot/customer-ui`

Expected: TypeScript and Vite build succeed.

- [ ] **Step 5: Commit**

```powershell
git add apps/customer-ui/src/styles/prototype.css apps/customer-ui/src/__tests__
git commit -m "fix: complete AI content studio states"
```

### Task 9: Run browser acceptance checks

**Files:**
- Create: `apps/customer-ui/e2e/ai-content-studio.spec.ts`

- [ ] **Step 1: Write the Playwright journey**

The test must sign in using the existing test fixture, open `/ai-content`, start card news, complete all six steps without a reference, verify a saved target can be selected in a second run, and inspect a partial-failure generation detail.

```ts
test("completes the screen-only AI content journey", async ({ page }) => {
  await page.goto("/ai-content");
  await page.getByRole("link", { name: "카드뉴스 만들기" }).click();
  await expect(page.getByText("1 / 6")).toBeVisible();
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?" })).toBeVisible();
});
```

- [ ] **Step 2: Run component tests and build once**

Run: `npm run test --workspace @brand-pilot/customer-ui`

Expected: all customer UI tests pass.

Run: `npm run build --workspace @brand-pilot/customer-ui`

Expected: build succeeds.

- [ ] **Step 3: Run the focused E2E test**

Run: `npm run e2e --workspace @brand-pilot/customer-ui -- ai-content-studio.spec.ts`

Expected: desktop Chromium journey passes.

- [ ] **Step 4: Inspect desktop and mobile screenshots**

Use 1440x900 and 390x844 viewports. Verify there is no horizontal overflow, sticky controls do not cover content, selected references remain visible, and long Korean labels wrap instead of overlapping.

- [ ] **Step 5: Commit**

```powershell
git add apps/customer-ui/e2e/ai-content-studio.spec.ts
git commit -m "test: cover AI content studio journey"
```

---

## Completion Criteria

- The three AI content routes render inside authenticated `AppShell`.
- Card news, blog, and marketing flows complete using mock data.
- Saved brand targets and appeals can be reused without mutating past snapshots.
- References are optional, limited to five, removable, and reorderable.
- Product analysis summary and internal detail evidence are both available.
- Generation jobs show progress, completion, partial failure, and failure.
- Failed outputs can be retried independently with a reason.
- Output preview and download labels follow the fixed format contracts.
- Publishing is available only for connected-Instagram card news.
- Desktop and mobile tests, customer UI tests, and build pass.
- No API, database, LLM, image, storage, payment, or real publishing call is introduced in this plan.
