# URL Source Manuscript Evidence Relaxation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Card News and Reel planners directly inspect topic URLs while allowing original-source factual scenes without unrelated Evidence IDs.

**Architecture:** Keep the existing planner and render contracts. Conditionally enable browser/network from the frozen job subject kind, update both planner prompts with the same source-authority rule, remove only the informational per-scene Evidence requirement, and preserve all Evidence partition and marketing safeguards.

**Tech Stack:** TypeScript, Node.js Codex runners, TypeBox contracts, Vitest, npm workspaces

---

### Task 1: Contract behavior

**Files:**
- Modify: `packages/brand-pilot-content-contracts/src/cardManuscriptPlan.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/reelStoryboard.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/cardManuscriptPlan.ts`
- Modify: `packages/brand-pilot-content-contracts/src/reelStoryboard.ts`
- Modify: `workers/brand-pilot-reel-worker/src/contracts.ts`

- [ ] Add tests proving informational factual Scenes may have empty `evidenceIds` while selected/scene-union partition checks still reject mismatches.
- [ ] Run the two contract tests and confirm RED with `*_scene_evidence_required`.
- [ ] Remove only the informational per-Scene Evidence requirement and the now-dead Reel error forwarding token.
- [ ] Re-run the contract tests and confirm GREEN; verify marketing structure tests remain green.

### Task 2: Card News URL-aware planner

**Files:**
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/productionRuntime.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/worker.ts`
- Modify: `workers/brand-pilot-card-news-worker/scripts/run-codex-card-manuscript-plan.mjs`
- Modify: `workers/brand-pilot-card-news-worker/.agents/skills/card-news-creator/SKILL.md`

- [ ] Add RED tests for direct requested/canonical URL reading, combined source authority, Evidence-only-when-used, and topic-url-only browser/network permissions.
- [ ] Pass `allowBrowserUse` in the immutable local planner job payload from `input.subject.kind === "topic_url"`.
- [ ] Make `buildCodexArgs(outputDir, allowBrowserUse)` enable `browser_use` and network only for URL work, and keep shell/image/plugins disabled.
- [ ] Make `buildCodexPrompt(prompt, allowBrowserUse)` allow direct web reading only for URL work and retain the no-web rule otherwise.
- [ ] Replace the factual Evidence-required Prompt rule with: Evidence IDs only when their Claim is used; original `subject.text`/direct URL facts may use an empty Evidence list.
- [ ] Bump `cardManuscriptPlanSkillVersion` and update worker expectations.
- [ ] Run Card News tests and confirm GREEN.

### Task 3: Reel URL-aware planner

**Files:**
- Modify: `workers/brand-pilot-reel-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/productionRuntime.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-reel-worker/src/worker.ts`
- Modify: `workers/brand-pilot-reel-worker/scripts/run-codex-reel-plan.mjs`

- [ ] Add the same RED source-authority and conditional-runtime tests as Card News.
- [ ] Pass `allowBrowserUse` from the frozen Reel input subject kind.
- [ ] Enable browser/network only for URL jobs and keep non-URL jobs fully offline.
- [ ] Apply the same Evidence-only-when-used Prompt rule and bump `reelPlanSkillVersion`.
- [ ] Run Reel tests and confirm GREEN.

### Task 4: Render invariants and regression

**Files:**
- Verify unchanged: `workers/brand-pilot-image-worker/src/aiContentVisualRenderPolicy.mjs`
- Verify unchanged: `workers/brand-pilot-image-worker/src/visualSessionImageAudit.test.ts`
- Verify unchanged: `workers/brand-pilot-image-worker/src/aiContentVisualSessionPromptCompiler.test.ts`

- [ ] Run image-worker tests proving previous Scene reference, generated output reference, and `num_last_images_to_include` remain forbidden.
- [ ] Confirm the shared medium/font and per-Scene composition freedom policy remains present without a policy version/hash change.
- [ ] Run Card News, Reel, content-contracts tests, typechecks/builds, and `git diff --check`.
- [ ] Review the final diff for DB/API/UI/image-worker source changes; expected result is none. Record that the API image still requires deployment because it consumes the changed shared validator.
- [ ] Deploy in compatibility order only after approval: API canary/primary first, then Card News Worker and Reel Worker. Do not deploy the workers against the old API validator.

### Task 5: Scoped release impact

**Files:**
- Modify: `scripts/release-impact.mjs`
- Modify: `scripts/release-impact.test.mjs`

- [ ] Add a RED regression fixture for this exact URL-aware Card/Reel change set.
- [ ] Classify the changed Manuscript/Storyboard validators as `API + Card News Worker + Reel Worker` consumers only.
- [ ] Accept the new design documents and Reel worker entrypoint without widening to unrelated server images.
- [ ] Prove the profile is verified, migration-free, production-deployable, and selects no other worker.
