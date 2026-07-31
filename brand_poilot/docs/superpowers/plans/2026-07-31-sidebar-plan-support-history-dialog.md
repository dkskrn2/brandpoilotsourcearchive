# Sidebar Plan and Support History Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the current plan in the sidebar profile, fall back to `FREE 플랜`, and move support-request history from Brand Center into an accessible sidebar popup without changing API or DB code.

**Architecture:** `AppShell` owns one defensive billing-summary read and one support-history dialog state, then supplies both desktop and mobile `Sidebar` instances. `SupportRequestHistory` keeps its existing data behavior and gains an embedded presentation used by a focused `SupportRequestHistoryDialog`; Brand Center stops mounting the history component.

**Tech Stack:** React 18, TypeScript, React Router, Testing Library, Vitest, CSS

---

### Task 1: Sidebar profile contract

**Files:**
- Modify: `apps/customer-ui/src/__tests__/brandLogo.test.tsx`
- Modify: `apps/customer-ui/src/components/layout/SidebarBrandProfile.tsx`
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Write the failing profile-menu test**

Render `SidebarBrandProfile` with `planLabel="팀 운영"` and `onOpenSupportHistory={onOpenSupportHistory}`. Assert the profile shows `팀 운영`, the menu item labels are exactly `["브랜드센터", "플랜", "문의 내역", "로그아웃"]`, and clicking `문의 내역` closes the menu and calls both `onOpenSupportHistory` and `onNavigate`.

```tsx
const onOpenSupportHistory = vi.fn();
render(
  <MemoryRouter>
    <SidebarBrandProfile
      brandName="그로스라인"
      logoUrl={null}
      planLabel="팀 운영"
      onOpenSupportHistory={onOpenSupportHistory}
      onNavigate={onNavigate}
    />
  </MemoryRouter>,
);
expect(screen.getByText("팀 운영")).toBeVisible();
await user.click(screen.getByRole("button", { name: "그로스라인 계정 메뉴 열기" }));
expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent))
  .toEqual(["브랜드센터", "플랜", "문의 내역", "로그아웃"]);
await user.click(screen.getByRole("menuitem", { name: "문의 내역" }));
expect(onOpenSupportHistory).toHaveBeenCalledTimes(1);
expect(onNavigate).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run the focused test and verify failure**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/brandLogo.test.tsx
```

Expected: FAIL because `planLabel` and `onOpenSupportHistory` are not accepted and `문의 내역` is absent.

- [ ] **Step 3: Implement the sidebar props and action**

Add these props to `SidebarBrandProfile`:

```tsx
planLabel: string;
onOpenSupportHistory?: () => void;
```

Replace `<small>계정 메뉴</small>` with `<small>{planLabel}</small>`. Add a `문의 내역` button between `플랜` and `로그아웃`; its handler closes the account menu, invokes `onNavigate?.()`, and then invokes `onOpenSupportHistory?.()`.

Extend `Sidebar` with:

```tsx
planLabel?: string;
onOpenSupportHistory?: () => void;
```

Pass `planLabel ?? "FREE 플랜"` and `onOpenSupportHistory` to `SidebarBrandProfile`.

- [ ] **Step 4: Re-run the focused test**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/brandLogo.test.tsx
```

Expected: PASS.

### Task 2: Shell-owned plan loading and support-history dialog

**Files:**
- Create: `apps/customer-ui/src/components/support/SupportRequestHistoryDialog.tsx`
- Create: `apps/customer-ui/src/components/support/SupportRequestHistoryDialog.test.tsx`
- Modify: `apps/customer-ui/src/components/support/SupportRequestHistory.tsx`
- Modify: `apps/customer-ui/src/components/layout/AppShell.tsx`
- Modify: `apps/customer-ui/src/__tests__/navigation.test.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: Write failing shell and dialog tests**

In `navigation.test.tsx`, spy on `api.getBillingSummary` and verify:

```tsx
vi.spyOn(api, "getBillingSummary").mockResolvedValue({
  configured: true,
  subscription: {
    status: "active",
    planName: "팀 운영",
    monthlyAmount: 49000,
    currency: "KRW",
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  },
  payments: [],
});
render(<MemoryRouter><AppShell><div>페이지 내용</div></AppShell></MemoryRouter>);
expect(await screen.findByText("팀 운영")).toBeVisible();
```

Add cases where the promise rejects and where it resolves to `{}` through a runtime cast; both must retain `FREE 플랜`. Add a flow that opens the desktop account menu, clicks `문의 내역`, sees the `문의 내역` dialog, closes with `Escape`, and restores focus to the account trigger. Add the equivalent mobile flow and assert the mobile navigation is removed before the dialog is visible.

In `SupportRequestHistoryDialog.test.tsx`, render with a stubbed `listRequests`, assert one dialog heading, empty-state reuse, backdrop close, Escape close, Tab trapping, and close-button focus restoration.

- [ ] **Step 2: Run the focused tests and verify failure**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/navigation.test.tsx src/components/support/SupportRequestHistoryDialog.test.tsx
```

Expected: FAIL because the dialog and shell state do not exist.

- [ ] **Step 3: Add embedded history presentation**

Extend `SupportRequestHistoryProps` with:

```tsx
embedded?: boolean;
```

Keep the default panel markup unchanged. When `embedded` is true, render the same loading/error/list body in a `<div className="support-request-history support-request-history--embedded">` without the `SUPPORT` panel header.

- [ ] **Step 4: Implement the accessible dialog**

Create `SupportRequestHistoryDialog` with this public contract:

```tsx
interface SupportRequestHistoryDialogProps {
  brandId: string;
  onClose: () => void;
  listRequests?: typeof api.listSupportRequests;
}
```

Render a `.modal-backdrop.support-history-dialog-backdrop` and `.modal-panel.support-history-dialog`, with heading `문의 내역`, close button `문의 내역 닫기`, and `<SupportRequestHistory embedded ... />`. On mount, save the previously focused element and body overflow; focus the close button and lock scrolling. Handle `Escape`, trap `Tab` inside the panel, close on direct backdrop click, and restore focus/overflow on unmount.

- [ ] **Step 5: Implement shell state and defensive plan fallback**

In `AppShell`, initialize:

```tsx
const [planLabel, setPlanLabel] = useState("FREE 플랜");
const [supportHistoryOpen, setSupportHistoryOpen] = useState(false);
const [pendingSupportHistoryAfterMobile, setPendingSupportHistoryAfterMobile] = useState(false);
```

Load `api.getBillingSummary(DEMO_BRAND_ID)` once. Treat the response as untrusted runtime data: only use `subscription.planName` when every parent is an object, the value is a string, and `trim()` is non-empty. Ignore resolved work after unmount and keep `FREE 플랜` on any error.

Add an `openSupportHistory` callback parallel to `openFeedback`. Pass `planLabel` and `onOpenSupportHistory={openSupportHistory}` to both Sidebars. When `supportHistoryOpen`, render:

```tsx
<SupportRequestHistoryDialog
  brandId={DEMO_BRAND_ID}
  onClose={() => setSupportHistoryOpen(false)}
/>
```

- [ ] **Step 6: Add dialog-only styles**

Add CSS beside the feedback dialog:

```css
.support-history-dialog-backdrop { z-index: 90; }
.support-history-dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(760px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  padding: 0;
  overflow: hidden;
  border-radius: 24px;
}
.support-history-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 24px 28px 18px;
  border-bottom: 1px solid var(--line);
}
.support-history-dialog__body { min-height: 0; padding: 20px 28px 28px; overflow: auto; }
```

At the existing mobile breakpoint, make the panel full-screen and remove its border radius.

- [ ] **Step 7: Re-run shell, dialog, and existing history tests**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/navigation.test.tsx src/components/support/SupportRequestHistoryDialog.test.tsx src/components/support/SupportRequestHistory.test.tsx
```

Expected: PASS.

### Task 3: Remove Brand Center history mount

**Files:**
- Modify: `apps/customer-ui/src/pages/BrandCenterPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandCenter.test.tsx`

- [ ] **Step 1: Replace the obsolete Brand Center expectation**

Change the confirmed-brand test to assert:

```tsx
expect(screen.queryByRole("region", { name: "문의 내역" })).not.toBeInTheDocument();
expect(supportApi.listSupportRequests).not.toHaveBeenCalled();
```

Remove the test that expects one shared history below every confirmed tab, or convert it into an assertion that changing tabs never mounts support history.

- [ ] **Step 2: Run the Brand Center test and verify failure**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/brandCenter.test.tsx
```

Expected: FAIL because confirmed Brand Center still mounts `SupportRequestHistory`.

- [ ] **Step 3: Remove only the Brand Center mount**

Delete the `SupportRequestHistory` import and:

```tsx
{showConfirmedContent ? <SupportRequestHistory brandId={DEMO_BRAND_ID} /> : null}
```

Do not change `SupportPage`.

- [ ] **Step 4: Re-run Brand Center and Support Page tests**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/brandCenter.test.tsx src/__tests__/support.test.tsx
```

Expected: PASS.

### Task 4: Local verification and one scoped commit

**Files:**
- Verify all files listed above
- Verify: `docs/superpowers/specs/2026-07-31-sidebar-plan-support-history-dialog-design.md`
- Verify: `docs/superpowers/plans/2026-07-31-sidebar-plan-support-history-dialog.md`

- [ ] **Step 1: Run only the related test set**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/brandLogo.test.tsx src/__tests__/navigation.test.tsx src/components/support/SupportRequestHistoryDialog.test.tsx src/components/support/SupportRequestHistory.test.tsx src/__tests__/brandCenter.test.tsx src/__tests__/support.test.tsx
```

Expected: all selected tests PASS.

- [ ] **Step 2: Build the customer UI once**

```powershell
npm run build --workspace @brand-pilot/customer-ui
```

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 3: Verify the local browser**

At `http://localhost:5173/brand-center?tab=core`, confirm the profile subtitle is a plan label, the dropdown background and four actions are visible, `문의 내역` opens and closes the popup, and the Brand Center page has no bottom support-history panel. Repeat the open flow at a mobile viewport.

- [ ] **Step 4: Review the diff scope**

```powershell
git status --short
git diff --check
git diff --stat
```

Expected: only the two documents, related sidebar/shell/support components, tests, Brand Center page, and dialog CSS are changed; `git diff --check` has no output.

- [ ] **Step 5: Commit the complete UI change**

```powershell
git add brand_poilot/docs/superpowers/specs/2026-07-31-sidebar-plan-support-history-dialog-design.md brand_poilot/docs/superpowers/plans/2026-07-31-sidebar-plan-support-history-dialog.md brand_poilot/apps/customer-ui/src/components/layout/AppShell.tsx brand_poilot/apps/customer-ui/src/components/layout/Sidebar.tsx brand_poilot/apps/customer-ui/src/components/layout/SidebarBrandProfile.tsx brand_poilot/apps/customer-ui/src/components/support/SupportRequestHistory.tsx brand_poilot/apps/customer-ui/src/components/support/SupportRequestHistoryDialog.tsx brand_poilot/apps/customer-ui/src/components/support/SupportRequestHistoryDialog.test.tsx brand_poilot/apps/customer-ui/src/pages/BrandCenterPage.tsx brand_poilot/apps/customer-ui/src/styles/prototype.css brand_poilot/apps/customer-ui/src/__tests__/brandLogo.test.tsx brand_poilot/apps/customer-ui/src/__tests__/navigation.test.tsx brand_poilot/apps/customer-ui/src/__tests__/brandCenter.test.tsx
git commit -m "feat(customer-ui): move support history into account menu"
```

Expected: one commit containing only this local UI scope. Do not push or deploy.
