# Customer Sidebar Menu Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the customer sidebar by purpose without changing navigation behavior, and remove the obsolete customer-side admin channel screen.

**Architecture:** Keep the navigation source in `Sidebar.tsx`, but replace the flat array with labeled groups whose items still use the existing badge, lock, internal link, and external link rendering. Remove the temporary admin route and its customer-facing references because administration belongs to the separate Growthline admin console.

**Tech Stack:** React 18, React Router 6, TypeScript, Vitest, Testing Library, CSS

---

### Task 1: Lock the grouped navigation contract

**Files:**
- Modify: `apps/customer-ui/src/__tests__/navigation.test.tsx`

- [ ] Add assertions for `개요`, `콘텐츠 운영`, `채널·고객`, `설정·지원` and their ordered links.
- [ ] Add an incomplete-onboarding assertion for the conditional `시작 준비` group.
- [ ] Assert that `관리자 채널` and `/admin/channels` are absent.
- [ ] Run `npm test -- --run src/__tests__/navigation.test.tsx` and confirm the new assertions fail against the flat menu.

### Task 2: Implement menu groups without changing link behavior

**Files:**
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] Replace the flat navigation array with labeled groups.
- [ ] Filter hidden onboarding items before rendering and omit empty groups.
- [ ] Reuse the existing badge, lock, internal `NavLink`, and external anchor behavior for every item.
- [ ] Add restrained group-label styling for desktop and responsive group layout for mobile.
- [ ] Run `npm test -- --run src/__tests__/navigation.test.tsx` and confirm it passes.

### Task 3: Remove the temporary customer admin screen

**Files:**
- Delete: `apps/customer-ui/src/pages/AdminChannelsPage.tsx`
- Delete: `apps/customer-ui/src/__tests__/adminChannels.test.tsx`
- Modify: `apps/customer-ui/src/routes.tsx`
- Modify: `apps/customer-ui/src/features/help/helpGuides.ts`
- Modify: `apps/customer-ui/src/pages/SupportPage.tsx`
- Modify: `apps/customer-ui/e2e/customer-ui.spec.ts`

- [ ] Remove the admin page import and `/admin/channels` route.
- [ ] Remove its help guide and E2E navigation coverage.
- [ ] Replace the customer-center copy that references the temporary admin screen.
- [ ] Search the customer UI for `admin/channels` and `관리자 채널`; expect no remaining customer references.

### Task 4: Verify the customer UI

**Files:**
- Verify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Verify: `apps/customer-ui/src/routes.tsx`
- Verify: `apps/customer-ui/src/styles/prototype.css`

- [ ] Run the navigation, support, onboarding, and brand setup gate tests.
- [ ] Run `npm run build` in `apps/customer-ui`.
- [ ] Run `git diff --check` and inspect the focused diff for unintended functional changes.
