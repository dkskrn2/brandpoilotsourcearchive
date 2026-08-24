# Card Attachment Reference Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep registered product images and generation-scoped attachments available to image generation without allowing attachment IDs in `productImageAssetIds`.

**Architecture:** Preserve the existing data contracts and image-worker staging. Clarify the card manuscript prompt so the model treats registered product images as scene bindings and attachments as separately delivered reference files, while retaining strict validator rejection.

**Tech Stack:** TypeScript, Vitest, npm workspaces

---

### Task 1: Reproduce and lock the ID namespace behavior

**Files:**
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`
- Verify: `workers/brand-pilot-card-news-worker/src/manuscriptPlan.test.ts`

- [ ] Add a prompt regression test with no registered product images and one `product_image` attachment. Assert that the prompt says attachment IDs cannot be used in `productImageAssetIds`, says the attachments are delivered separately, and retains the attachment in the creative context.
- [ ] Add a prompt regression test with a registered image and a product attachment. Assert that the registered asset ID appears under `availableImages` and the attachment ID appears only under `visualReferences.attachments`.
- [ ] Run `npm test --workspace @brand-pilot/card-news-worker -- --run src/promptBuilder.test.ts` and confirm the new assertions fail because the namespace instructions are missing.

### Task 2: Implement the minimal prompt correction

**Files:**
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/worker.test.ts`

- [ ] Replace the ambiguous image-selection sentence with explicit registered-image and attachment namespace rules.
- [ ] State that `product_image` attachments are separately delivered product-appearance references for relevant scenes and do not belong in `productImageAssetIds`.
- [ ] Bump `cardNewsPlanSkillVersion` from `card-manuscript-plan-skill.v3` to `card-manuscript-plan-skill.v4` and update exact-version assertions.
- [ ] Run the prompt test and confirm it passes.

### Task 3: Verify regressions and scope

**Files:**
- Verify: `workers/brand-pilot-card-news-worker/src/sourceBundle.test.ts`
- Verify: `workers/brand-pilot-card-news-worker/src/manuscriptPlan.test.ts`
- Verify: `workers/brand-pilot-card-news-worker/src/worker.test.ts`

- [ ] Run all card-news worker tests.
- [ ] Run the card-news worker production build.
- [ ] Run `git diff --check`.
- [ ] Confirm the final diff contains no API, DB, image-worker, Reel, Blog, or publishing changes.
