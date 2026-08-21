# Instagram Hashtag Truncation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish valid generated Instagram captions by limiting the provider-bound hashtag list to the first five entries.

**Architecture:** Keep the generated content and persistence contracts unchanged. Apply a deterministic provider-bound projection inside `formatInstagramCaption`, after validating every supplied hashtag for syntax and uniqueness.

**Tech Stack:** TypeScript, Vitest, npm workspaces

---

### Task 1: Reproduce and fix the hashtag overflow

**Files:**
- Modify: `brand_poilot/apps/api/src/instagramCaption.ts`
- Test: `brand_poilot/apps/api/src/instagramCaption.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test passing seven valid unique hashtags and expecting only the first five in the formatted caption.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/api/src/instagramCaption.test.ts --maxWorkers=1`

Expected: FAIL with `instagram_caption_hashtags_invalid`.

- [ ] **Step 3: Write minimal implementation**

Validate the full normalized list as before, remove the `length > 5` rejection, and return `normalized.slice(0, 5)`.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```powershell
npx vitest run apps/api/src/instagramCaption.test.ts --maxWorkers=1
npm exec tsc -- --noEmit -p apps/api/tsconfig.json
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Review the exact diff**

Confirm only the formatter, its regression test, and these approved documentation files changed. Do not commit, merge, or deploy without a separate user request.
