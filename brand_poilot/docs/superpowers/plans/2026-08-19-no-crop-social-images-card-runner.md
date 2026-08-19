# No-crop Social Images and Card Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every generated Card News and Reel pixel inside fixed delivery canvases and reject stale Card News planner commands before worker rollout.

**Architecture:** The visual-session renderer will normalize through one deterministic contain-on-canvas helper while keeping existing output dimensions and contracts. The worker rollout script will validate the live Card News env only when that worker is selected, before any container mutation.

**Tech Stack:** TypeScript, Sharp, Vitest, Bash, Node test runner.

---

### Task 1: No-crop visual-session normalization

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/aiContentVisualSessionRenderer.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentVisualSessionRenderer.test.ts`

- [ ] **Step 1: Write failing Card News and Reel edge-preservation tests**

Create asymmetric PNG fixtures with distinct borders, render each format, and assert fixed dimensions plus surviving corner colors.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx vitest run workers/brand-pilot-image-worker/src/aiContentVisualSessionRenderer.test.ts --maxWorkers=1
```

Expected: the current center-crop implementation loses edge markers.

- [ ] **Step 3: Implement deterministic contain normalization**

Replace the format branches in `normalize()` with proportional `fit: "contain"` rendering onto 1080x1080 or 1080x1920 opaque canvases. Do not add retries or alter diagnostics.

- [ ] **Step 4: Run focused GREEN tests**

Run the same Vitest command and expect all tests to pass.

### Task 2: Live Card News planner command preflight

**Files:**
- Modify: `deploy/scripts/rollout-workers.sh`
- Modify: `scripts/deployment-contract.test.mjs`

- [ ] **Step 1: Write a failing deployment-contract assertion**

Require rollout to validate the exact live `CARD_NEWS_CODEX_PLAN_COMMAND` before `ROLLOUT_MUTATED=true` and before `docker compose up`.

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
node --test scripts/deployment-contract.test.mjs
```

Expected: the assertion fails because rollout currently checks only container/image state.

- [ ] **Step 3: Add the minimal fail-closed host env validation**

When `card-news-worker-1` is in `ROLLOUT_SERVICES`, require one exact planner declaration in `$ROOT/shared/env/card-news-worker-1.env`. Abort with `card_news_planner_command_invalid` before image pulls or runtime mutation for any other state.

- [ ] **Step 4: Run deployment-contract GREEN test**

Run the same Node test command and expect it to pass.

### Task 3: Regression verification

**Files:**
- No production-file additions.

- [ ] **Step 1: Run image-worker regression suites**

```bash
npx vitest run workers/brand-pilot-image-worker/src/aiContentVisualSessionRenderer.test.ts workers/brand-pilot-image-worker/src/aiContentAssetRenderer.test.ts workers/brand-pilot-image-worker/src/reelRenderer.test.ts workers/brand-pilot-image-worker/src/aiContentFinalizer.test.ts workers/brand-pilot-image-worker/src/storage.test.ts --maxWorkers=1
```

- [ ] **Step 2: Run builds and static checks**

```bash
npm run build --workspace @brand-pilot/image-worker
node --test scripts/three-format-cutover-static-check.test.mjs scripts/deployment-contract.test.mjs
git diff --check
```

- [ ] **Step 3: Confirm release scope**

Verify the diff changes only the image worker, Card News worker rollout guard, tests, and these documents. No API, DB migration, UI, Blog, Reel planner, retry, or automatic-content source may change.

### Task 4: Production handoff (not executed without an explicit deploy request)

**Files:**
- Operational state only after approval.

- [ ] **Step 1: Back up the live Card News env**

Copy `/opt/brand-pilot/shared/env/card-news-worker-1.env` to an immutable timestamped backup and verify its checksum.

- [ ] **Step 2: Replace only the known stale planner command**

Change the exact old Deck runner declaration to the Manuscript runner. Abort rather than rewriting if the current value is not the observed stale value.

- [ ] **Step 3: Roll out only changed worker images**

Deploy Card News and Image Worker immutable digests; leave API, UI, DB, and unrelated workers untouched.

- [ ] **Step 4: Verify production behavior**

Check worker revision/digest, heartbeat, restart count, one Card News generation, and one Reel generation with non-native source aspect. Confirm Blob dimensions, complete visible edges, MP4 1080x1920, and zero new retries.
