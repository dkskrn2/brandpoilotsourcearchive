# Billing Onboarding Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users with an incomplete brand profile to open Billing from the sidebar or by navigating directly to `/billing`.

**Architecture:** The existing `isBrandSetupPath()` helper is the single allowlist used by both `Sidebar` and `BrandSetupGate`. Add `/billing` to that allowlist so both navigation paths change together while all other protected product pages remain locked.

**Tech Stack:** React 18, React Router 6, TypeScript, Vitest, Testing Library

---

### Task 1: Allow Billing through the brand setup gate

**Files:**
- Modify: `apps/customer-ui/src/__tests__/brandSetupGate.test.tsx`
- Modify: `apps/customer-ui/src/lib/brandSetup.ts`

- [ ] **Step 1: Write failing direct-access and sidebar tests**

Add the Billing route to `renderGate()`:

```tsx
<Route path="/billing" element={<div>결제 및 구독 화면</div>} />
```

Add a direct-access test:

```tsx
it("allows billing before brand settings are complete", () => {
  renderGate(incompleteStatus, "/billing");

  expect(screen.getByText("결제 및 구독 화면")).toBeInTheDocument();
});
```

Extend the existing incomplete-onboarding sidebar test:

```tsx
expect(screen.getByRole("link", { name: /결제 및 구독/ })).toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/brandSetupGate.test.tsx
```

Expected: FAIL because `/billing` redirects to brand settings and its sidebar item renders with `aria-disabled="true"`.

- [ ] **Step 3: Add Billing to the setup-path allowlist**

Change `isBrandSetupPath()` in `apps/customer-ui/src/lib/brandSetup.ts` to:

```ts
export function isBrandSetupPath(pathname: string) {
  return pathname === "/onboarding"
    || pathname === "/brand-settings"
    || pathname === "/billing"
    || pathname === "/support";
}
```

- [ ] **Step 4: Run focused and full customer UI verification**

Run:

```powershell
npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/brandSetupGate.test.tsx
npm run test --workspace @brand-pilot/customer-ui
npm run build --workspace @brand-pilot/customer-ui
```

Expected: focused tests PASS, full customer UI tests PASS, and the production build completes successfully.

- [ ] **Step 5: Commit the implementation**

```powershell
git add -- apps/customer-ui/src/__tests__/brandSetupGate.test.tsx apps/customer-ui/src/lib/brandSetup.ts docs/superpowers/plans/2026-07-31-billing-onboarding-access.md
git commit -m "fix: allow billing before onboarding completes"
```
