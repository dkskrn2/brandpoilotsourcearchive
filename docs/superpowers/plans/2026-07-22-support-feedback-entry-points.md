# Support Feedback Entry Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard and customer-support feature-suggestion actions open the existing shared feedback dialog while removing feature requests and manual refresh from the support form.

**Architecture:** `AppShell` continues to own the single `FeedbackDialog` instance. A small `FeedbackContext` exposes the existing open action to the sidebar and routed pages, while a shared `FeatureSuggestionBanner` guarantees that dashboard and support render the same action and presentation. Support-request data contracts remain unchanged for historical compatibility.

**Tech Stack:** React 18, TypeScript, React Context, Testing Library, Vitest, Vite

---

### Task 1: Shared feedback action and dashboard entry point

**Files:**
- Create: `apps/customer-ui/src/components/feedback/FeedbackContext.tsx`
- Create: `apps/customer-ui/src/components/feedback/FeatureSuggestionBanner.tsx`
- Modify: `apps/customer-ui/src/components/layout/AppShell.tsx`
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Modify: `apps/customer-ui/src/pages/DashboardPage.tsx`
- Test: `apps/customer-ui/src/__tests__/dashboard.test.tsx`
- Test: `apps/customer-ui/src/__tests__/navigation.test.tsx`

- [ ] **Step 1: Replace the dashboard link expectation with a failing shared-action test**

Import `FeedbackProvider` in `dashboard.test.tsx`, extend `renderDashboardPage` with an `openFeedback` argument, and wrap the page:

```tsx
import { FeedbackProvider } from "../components/feedback/FeedbackContext";

async function renderDashboardPage(
  getDashboard: ApiMock["getDashboard"] = vi.fn(async () => dashboard),
  getPublishArtifact: ApiMock["getPublishArtifact"] = vi.fn(async () => artifact),
  openFeedback = vi.fn()
) {
  const api = { getDashboard, getPublishArtifact };
  vi.doMock("../lib/apiClient", () => ({ DEMO_BRAND_ID: "brand-1", api }));
  const { DashboardPage } = await import("../pages/DashboardPage");
  render(<FeedbackProvider onOpenFeedback={openFeedback}><DashboardPage /></FeedbackProvider>);
  return api;
}
```

Replace the old link test with:

```tsx
it("opens shared feedback from the feature suggestion banner", async () => {
  const openFeedback = vi.fn();
  await renderDashboardPage(undefined, undefined, openFeedback);

  await userEvent.click(await screen.findByRole("button", { name: "기능 제안하기" }));

  expect(openFeedback).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("link", { name: "기능 제안하기" })).not.toBeInTheDocument();
});
```

In the existing navigation test, retain the desktop trigger and assert focus restoration after closing:

```tsx
const desktopFeedbackButton = screen.getByRole("button", { name: "피드백" });
fireEvent.click(desktopFeedbackButton);
expect(screen.getByRole("dialog", { name: "피드백" })).toBeVisible();
fireEvent.click(screen.getByRole("button", { name: "피드백 닫기" }));
expect(desktopFeedbackButton).toHaveFocus();
```

- [ ] **Step 2: Run the dashboard test and verify RED**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/dashboard.test.tsx -t "opens shared feedback"`

Expected: FAIL because `FeedbackContext` does not exist and the dashboard action is still a link.

- [ ] **Step 3: Add the shared context and reusable banner**

Create `FeedbackContext.tsx`:

```tsx
import { createContext, useContext, useMemo } from "react";

interface FeedbackContextValue {
  openFeedback(): void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function useFeedback() {
  return useContext(FeedbackContext);
}

export function FeedbackProvider({
  children,
  onOpenFeedback
}: {
  children: React.ReactNode;
  onOpenFeedback: () => void;
}) {
  const value = useMemo<FeedbackContextValue>(() => ({
    openFeedback: onOpenFeedback
  }), [onOpenFeedback]);

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}
```

Create `FeatureSuggestionBanner.tsx`:

```tsx
import { Lightbulb } from "lucide-react";
import { useFeedback } from "./FeedbackContext";

export function FeatureSuggestionBanner() {
  const feedback = useFeedback();

  return (
    <section className="dashboard-feature-suggestion" aria-label="기능 제안">
      <div className="dashboard-feature-suggestion__message">
        <span className="dashboard-feature-suggestion__icon" aria-hidden="true"><Lightbulb size={22} /></span>
        <p><strong>원하는 기능</strong>을 모종 팀에게 제안해 주세요.</p>
      </div>
      <button className="button primary" type="button" onClick={() => feedback?.openFeedback()}>
        기능 제안하기
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Wire the single dialog owner and all existing entry points**

In `AppShell.tsx`, change the React import and add the provider import:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { FeedbackProvider } from "../feedback/FeedbackContext";
```

Add this callback after the state declarations:

```tsx
const openFeedback = useCallback(() => setFeedbackOpen(true), []);
```

Wrap the existing `.app` div by inserting the provider immediately before its opening tag and closing the provider immediately after the div's closing tag:

```tsx
<FeedbackProvider onOpenFeedback={openFeedback}>
  <div className={`app${desktopSidebarCollapsed ? " app--sidebar-collapsed" : ""}`}>
```

```tsx
  </div>
</FeedbackProvider>
```

Replace the desktop sidebar invocation with:

```tsx
<Sidebar
  collapsed={desktopSidebarCollapsed}
  onToggleCollapsed={toggleDesktopSidebar}
/>
```

Replace the mobile sidebar invocation with:

```tsx
<Sidebar
  variant="mobile"
  onClose={() => setMobileMenuOpen(false)}
  onNavigate={() => setMobileMenuOpen(false)}
/>
```

In `Sidebar.tsx`, remove `onOpenFeedback` from the props, import `useFeedback`, and use the context after closing mobile navigation:

```tsx
import { useFeedback } from "../feedback/FeedbackContext";

const feedback = useFeedback();

onClick={() => {
  onNavigate?.();
  feedback?.openFeedback();
}}
```

In `DashboardPage.tsx`, remove `Lightbulb` from the Lucide import, import `FeatureSuggestionBanner`, and replace the existing banner section with:

```tsx
<FeatureSuggestionBanner />
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/dashboard.test.tsx src/__tests__/navigation.test.tsx`

Expected: PASS; dashboard invokes the shared action and desktop/mobile sidebar still open the single dialog.

- [ ] **Step 6: Commit the shared action**

```bash
git add apps/customer-ui/src/components/feedback/FeedbackContext.tsx apps/customer-ui/src/components/feedback/FeatureSuggestionBanner.tsx apps/customer-ui/src/components/layout/AppShell.tsx apps/customer-ui/src/components/layout/Sidebar.tsx apps/customer-ui/src/pages/DashboardPage.tsx apps/customer-ui/src/__tests__/dashboard.test.tsx apps/customer-ui/src/__tests__/navigation.test.tsx
git commit -m "feat: share feedback dialog entry points"
```

### Task 2: Customer-support cleanup and matching feature banner

**Files:**
- Modify: `apps/customer-ui/src/pages/SupportPage.tsx`
- Test: `apps/customer-ui/src/__tests__/support.test.tsx`

- [ ] **Step 1: Write failing support-page expectations**

Import `FeedbackProvider`:

```tsx
import { FeedbackProvider } from "../components/feedback/FeedbackContext";
```

Change the helper signature to:

```tsx
async function renderSupportPage(
  apiOverrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {},
  initialEntries = ["/support"],
  openFeedback = vi.fn()
) {
```

Replace the helper's current `MemoryRouter` render call with:

```tsx
render(
  <MemoryRouter initialEntries={initialEntries}>
    <FeedbackProvider onOpenFeedback={openFeedback}><SupportPage /></FeedbackProvider>
  </MemoryRouter>
);
return api;
```

Replace the preselection test with:

```tsx
it("keeps feature suggestions out of support requests", async () => {
  await renderSupportPage();

  const category = screen.getByLabelText(/문의 유형/);
  expect(category).not.toHaveDisplayValue("기능 건의");
  expect(screen.queryByRole("option", { name: "기능 건의" })).not.toBeInTheDocument();
  expect(await screen.findByText("문의 내역 확인")).toBeVisible();
  expect(screen.queryByRole("button", { name: "새로고침" })).not.toBeInTheDocument();
});

it("opens shared feedback from the support footer", async () => {
  const openFeedback = vi.fn();
  await renderSupportPage({}, ["/support"], openFeedback);

  await userEvent.click(screen.getByRole("button", { name: "기능 제안하기" }));

  expect(openFeedback).toHaveBeenCalledTimes(1);
});
```

Keep the existing submission test assertion that `listSupportRequests` is called twice; it protects initial loading and automatic post-submit refresh.

- [ ] **Step 2: Run support tests and verify RED**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/support.test.tsx`

Expected: FAIL because `기능 건의` and `새로고침` still render and the footer action is absent.

- [ ] **Step 3: Remove support-only feature routing and manual refresh**

In `SupportPage.tsx`:

- Change the React import to `useEffect, useState` and remove `useLocation`.
- Import `FeatureSuggestionBanner`.
- Remove `{ value: "feature", label: "기능 건의" }` from `categories`.
- Initialize `category` with an empty string.
- Remove the hash-scroll effect and `supportFormRef`; keep `id="support-request-form"` for the feedback dialog booking fallback.
- Change the page description to `오류, 채널 연결, 계정 문제를 접수하고 처리 상태와 답변을 확인합니다.`
- Replace the history header with `<h2>내 문의 내역</h2>` only; retain `loadSupportRequests()` for initial load and successful submission.
- Render the shared banner immediately after the inquiry form's closing `</section>`:

```tsx
<FeatureSuggestionBanner />
```

- [ ] **Step 4: Run support tests and verify GREEN**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/support.test.tsx`

Expected: PASS; the option and button are absent, the shared action opens, and automatic loading remains covered.

- [ ] **Step 5: Commit the support changes**

```bash
git add apps/customer-ui/src/pages/SupportPage.tsx apps/customer-ui/src/__tests__/support.test.tsx
git commit -m "fix: separate support requests from feedback"
```

### Task 3: Regression verification

**Files:**
- Verify only; no expected source changes

- [ ] **Step 1: Run all customer UI tests**

Run: `npm run test --workspace @brand-pilot/customer-ui`

Expected: all Vitest suites PASS with no unhandled errors.

- [ ] **Step 2: Run the customer UI production build**

Run: `npm run build --workspace @brand-pilot/customer-ui`

Expected: TypeScript checks and Vite build PASS.

- [ ] **Step 3: Inspect the scoped diff**

Run:

```bash
git diff HEAD~2 --check
git diff HEAD~2 -- apps/customer-ui/src/components/feedback/FeedbackContext.tsx apps/customer-ui/src/components/feedback/FeatureSuggestionBanner.tsx apps/customer-ui/src/components/layout/AppShell.tsx apps/customer-ui/src/components/layout/Sidebar.tsx apps/customer-ui/src/pages/DashboardPage.tsx apps/customer-ui/src/pages/SupportPage.tsx apps/customer-ui/src/__tests__/dashboard.test.tsx apps/customer-ui/src/__tests__/navigation.test.tsx apps/customer-ui/src/__tests__/support.test.tsx
```

Expected: no whitespace errors; the diff contains only the shared feedback entry-point work in the listed files.
