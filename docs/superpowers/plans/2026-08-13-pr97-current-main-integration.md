# PR 97 Current Main Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reapply every onboarding change from PR #97 to current production `main` while preserving current routes, API behavior outside brand intelligence, and all changes landed after the old PR base.

**Architecture:** Start from `4c9ff35d2f47691e5d72cb9f0ecf05f9e5014306` in a global isolated worktree. Replay the 17 non-merge commits from PR #97 in their original order, resolve conflicts against current `main` by keeping the current file and integrating only the PR #97 hunk, then verify the resulting diff is limited to PR #97's onboarding files plus this plan. Do not merge, push, or deploy until all targeted and neighboring regression checks pass.

**Tech Stack:** Git, React 18, TypeScript, React Router 6, Vitest, Vite, Node.js API and brand-intelligence worker

---

### Task 1: Establish the current-production baseline

**Files:**
- No source changes

- [ ] Install dependencies with `npm ci` from `brand_poilot`.
- [ ] Run the current customer UI onboarding tests:
  `npx vitest run src/__tests__/brandIntelligenceOnboarding.test.tsx src/__tests__/brandCenterLiveOnboarding.test.tsx src/__tests__/brandCenterRouting.test.tsx`.
- [ ] Run the current API brand-intelligence tests:
  `npx vitest run src/brandIntelligenceRepository.test.ts src/server.brandIntelligenceWorker.test.ts`.
- [ ] Run the current worker tests:
  `npx vitest run src/client.test.ts src/worker.test.ts`.
- [ ] Stop if any baseline test fails for a code reason.

### Task 2: Replay PR #97 without its stale merge commit

**Files:**
- Modify only the 20 paths listed by PR #97 and this plan.

- [ ] Cherry-pick commits `4a85b27` through `b8ea33a` in original order. Exclude merge commit `954b925` because it merges the old `main` and would reintroduce stale repository state.
- [ ] At each conflict, inspect all three stages. Keep the current `main` file as the base and manually add only the PR #97 behavior.
- [ ] For `routes.tsx`, preserve every current import and route. Add only the development-only `BrandAnalysisReviewPreviewPage` import and `/brand-analysis-review-preview` registration guarded by `import.meta.env.DEV`.
- [ ] For `brandIntelligenceRepository.ts` and its tests, preserve current unrelated API behavior and insert only category-registry claim/completion validation.
- [ ] After each resolved conflict run `git diff --check` before continuing the cherry-pick.

### Task 3: Verify the exact PR #97 behavior

**Files:**
- Test the customer UI, API and `brand-pilot-brand-intelligence-worker` paths changed by PR #97.

- [ ] Run customer UI tests for review tabs, live onboarding category loading, route preservation and development preview.
- [ ] Run API repository and worker-server tests for registry transport and invalid category rejection.
- [ ] Run brand-intelligence worker client and worker tests for category registry propagation.
- [ ] Run customer UI, API and brand-intelligence worker production builds.
- [ ] If a regression is found, add a failing test first, verify the failure, implement the smallest correction, and rerun the affected suite.

### Task 4: Prove no unrelated function was changed

**Files:**
- No additional source changes expected

- [ ] Compare `git diff --name-status 4c9ff35...HEAD` against the 20 PR #97 paths and this plan. Stop if any other path appears.
- [ ] Compare current `routes.tsx` with `4c9ff35` and prove all pre-existing routes remain present.
- [ ] Compare files added after `18f2846`, especially `contentSuggestionHttp.ts` and its test, and prove they are byte-identical to `4c9ff35`.
- [ ] Run the neighboring customer UI and API regression suites affected by route or repository imports.
- [ ] Review the complete diff against `4c9ff35`; do not rely on the old PR review.

### Task 5: Prepare a reviewable PR without deploying

**Files:**
- No source changes expected

- [ ] Fetch `codex-deploy/main` again and stop if it moved; rebase only after reviewing new overlap.
- [ ] Run fresh focused tests and builds, then verify `git status`, `git diff --check` and the exact changed-file allowlist.
- [ ] Push `codex/onboarding-pr97-current` and open a draft PR describing UI, API and onboarding worker scope, no DB migration, and no other worker changes.
- [ ] Wait for CI and preview checks. Do not merge or deploy.
- [ ] Report any remaining conflict or unrelated impact to the user for a separate production-deploy decision.
