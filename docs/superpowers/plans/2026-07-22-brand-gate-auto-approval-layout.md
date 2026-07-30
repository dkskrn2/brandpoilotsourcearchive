# Brand Gate and Auto-Approval Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the first-use brand-analysis gate and place Instagram content formats inside auto-approval settings without changing API behavior.

**Architecture:** Preserve the existing `active_brand_analysis_id` completion rule and support escape route. Move existing format markup into the auto-approval panel in place; do not introduce a generic channel abstraction until another channel has format settings.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library.

---

### Task 1: Brand-analysis gate regression coverage

**Files:**
- Modify: `apps/customer-ui/src/__tests__/brandSetupGate.test.tsx`
- Modify: `apps/api/src/repository.regression-1.test.ts`

- [ ] Add failing/confirming cases for no active analysis redirecting from `/`, `/ai-content`, `/archive`, and `/dm-automation`; `/onboarding/brand-intelligence` and `/support` remain accessible.
- [ ] Add API regression assertions that profile text without `active_brand_analysis_id` is incomplete and an active analysis is complete.
- [ ] Run the two targeted tests; if they already pass, record this task as verification-only and do not change production gate code.

### Task 2: Nest Instagram formats inside auto approval

**Files:**
- Modify: `apps/customer-ui/src/pages/BrandSettingsPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandSettings.test.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] Write a failing DOM-structure test asserting the `Instagram 콘텐츠 형식` region is inside the `자동 승인` section and presents 카드뉴스 → 릴스 → 스토리.
- [ ] Move the existing accordion markup inside the auto-approval panel without changing `draftFormats`, capability rules, switches, or payload construction.
- [ ] Add an explicit Instagram channel heading and descriptive copy that future channels will appear as sibling sections.
- [ ] Keep save behavior and API calls unchanged; add a regression assertion for the exact formats payload.
- [ ] Run `npm test --workspace @brand-pilot/customer-ui -- brandSettings.test.tsx brandSettings.regression-1.test.tsx`; expect success.

### Task 3: Plan C verification

- [ ] Run targeted gate/settings tests.
- [ ] Run `npm run build --workspace @brand-pilot/customer-ui`.
- [ ] Verify keyboard navigation and mobile layout of the nested accordion.
- [ ] Record profile/formats atomic saving as deferred existing debt; do not expand this layout change into a new transactional endpoint.

## NOT in scope

- Threads and TikTok format controls: no current format contract exists.
- Transactional profile-plus-format save: pre-existing partial-success risk, unrelated to nesting markup.
- Removing `/support` from the gate allowlist: users need a recovery path during onboarding.

## What already exists

- `BrandSetupGate` and `active_brand_analysis_id` already enforce the requested first-use analysis rule; this plan adds regression coverage rather than a second gate.
- Instagram format state, capability checks, switches, and save payload already exist; this plan moves markup without rebuilding the data flow.

## Failure modes

- Status request unavailable: the existing loading/error behavior remains unchanged.
- One format is unavailable: existing capability-based disabled state remains visible inside the new hierarchy.
- Profile save and format save partially succeed: existing notice remains; transactional saving is explicitly deferred.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | CLEAR | Gate escape route retained, no premature channel abstraction, payload unchanged |

**UNRESOLVED:** 0

**VERDICT:** ENG CLEARED — ready to implement after Plan B.
