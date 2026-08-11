# Structured Social Scene Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate conclusion-oriented, hierarchically structured copy for Instagram card-news cards and Reel scene images without changing API, database, UI, image-worker, blog, or canonical plan contracts.

**Architecture:** Each social planner produces a worker-local v2 structured draft. The same worker validates and deterministically compiles it into the existing v1 private completion draft, so the API and every downstream consumer continue receiving the exact existing shape. Card-news and Reel implementations remain separate to keep release impact limited to their own worker images.

**Tech Stack:** TypeScript, Vitest, Node.js ESM, JSON Schema, Codex CLI structured output.

---

### Task 1: Card-news structured draft and adapter

**Files:**
- Create: `workers/brand-pilot-card-news-worker/src/structuredSceneDraft.ts`
- Create: `workers/brand-pilot-card-news-worker/src/structuredSceneDraft.test.ts`
- Create: `workers/brand-pilot-card-news-worker/scripts/card-news-plan-draft-v2.schema.json`
- Modify: `workers/brand-pilot-card-news-worker/src/editorialPlan.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/editorialPlan.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/worker.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/scripts/run-codex-card-news-v2-plan.mjs`
- Modify: `workers/brand-pilot-card-news-worker/Dockerfile`
- Modify: `workers/brand-pilot-card-news-worker/.agents/skills/card-news-creator/SKILL.md`
- Modify: `workers/brand-pilot-card-news-worker/src/productionRuntime.test.ts`
- Delete: `workers/brand-pilot-card-news-worker/scripts/card-news-plan-draft-v1.schema.json`

- [ ] **Step 1: Write parser and adapter failure tests**

Add tests that call the wished-for API:

```ts
const parsed = parseStructuredCardNewsDraft(rawDraft, input);
const compiled = compileStructuredCardNewsDraft(parsed);
expect(compiled.contractVersion).toBe("card-news-plan-draft.v1");
expect(compiled.assets[0]!.copy).toBe("롱폼은 2배\n4,000시간\n8,000시간\n최근 12개월\n신규 YPP 기준");
expect(compiled.assets[0]).not.toHaveProperty("coreMessage");
expect(compiled.assets[0]!.visualDirection).toContain("keyVisual=before_after:2");
```

Cover exact count/index/role locks, unknown and duplicate evidence/product IDs, whitespace-only headline, more than two supporting texts, more than four key-visual texts, `footnote: null`, and total compiled copy above 4,000 characters.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm test --workspace @brand-pilot/card-news-worker -- --run src/structuredSceneDraft.test.ts src/editorialPlan.test.ts
```

Expected: FAIL because the structured parser/compiler and v2 loader do not exist.

- [ ] **Step 3: Implement the minimal local parser and adapter**

Define this local shape in `structuredSceneDraft.ts` without changing the shared contracts package:

```ts
export interface StructuredSceneAssetDraft {
  index: number;
  role: string;
  coreMessage: string;
  headline: string;
  keyVisual: {
    type: "none" | "number" | "before_after" | "comparison" | "steps" | "quote";
    texts: string[];
  };
  supportingTexts: string[];
  footnote: string | null;
  visualDirection: string;
  evidenceIds: string[];
  productImageAssetIds: string[];
}
```

Validate exact keys, bounded non-whitespace strings, selected outline count/index/role, and existing allowed-ID rules. Compile display strings in the fixed order and parse the result with the existing `parseCardNewsPlanDraftV1` contract before returning it.

- [ ] **Step 4: Update the card prompt and local output schema**

Change the requested contract to `card-news-plan-draft.v2`, bump `cardNewsPlanSkillVersion` to `card-news-plan-skill.v4`, replace `copy` in the response example with the structured fields, and add the approved editorial instructions. Keep caption/hashtags/CTA, purpose branches, evidence rules, product-image rules, attachment rules, tool bans, and two-attempt repair behavior unchanged.

Use a simple fixed JSON Schema. All keys are required; optional content uses `[]` or `null`. Do not use `uniqueItems`, `if/then`, or nested conditional schemas.

- [ ] **Step 5: Update runner packaging and worker completion tests**

Make the runner select `card-news-plan-draft-v2.schema.json`, package that file in Docker, update the worker skill, and assert that `client.complete()` still receives:

```ts
{
  skillVersion: "card-news-plan-skill.v4",
  planDraft: {
    contractVersion: "card-news-plan-draft.v1",
    content: expect.any(Object),
    assets: expect.arrayContaining([
      expect.objectContaining({ copy: expect.any(String), visualDirection: expect.any(String) }),
    ]),
  },
}
```

- [ ] **Step 6: Run card-news tests and build**

Run:

```powershell
npm test --workspace @brand-pilot/card-news-worker -- --run
npm run build --workspace @brand-pilot/card-news-worker
```

Expected: all card-news tests pass and TypeScript build exits 0.

- [ ] **Step 7: Commit the card-news implementation**

Stage only `workers/brand-pilot-card-news-worker` files and commit:

```powershell
git commit -m "feat(card-news): structure scene copy before rendering"
```

### Task 2: Reel structured draft and adapter

**Files:**
- Create: `workers/brand-pilot-reel-worker/src/structuredSceneDraft.ts`
- Create: `workers/brand-pilot-reel-worker/src/structuredSceneDraft.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-reel-worker/src/contracts.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-reel-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/worker.ts`
- Modify: `workers/brand-pilot-reel-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-reel-worker/scripts/run-codex-reel-plan.mjs`
- Modify: `workers/brand-pilot-reel-worker/src/productionRuntime.test.ts`

- [ ] **Step 1: Write Reel parser and adapter failure tests**

Use the same structured fields and deterministic display order, but assert the result parses as `reel-plan-draft.v1` and retains the exact selected Reel scene count/index/role.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm test --workspace @brand-pilot/reel-worker -- --run src/structuredSceneDraft.test.ts src/contracts.test.ts
```

Expected: FAIL because the Reel v2 parser/compiler does not exist.

- [ ] **Step 3: Implement the local Reel parser and adapter**

Keep the implementation worker-local. Reuse the same field bounds and copy ordering, then validate the compiled value with existing `parseReelPlanDraftV1`. Do not move the contract into worker-runtime or the shared contracts package.

- [ ] **Step 4: Update the Reel prompt and runner schema**

Request `reel-plan-draft.v2`, bump `reelPlanSkillVersion` to `reel-plan-skill.v4`, and apply the same one-message hierarchy while preserving the Reel purpose branches, scene locks, caption/hashtags/CTA, evidence/product-image rules, network/tool bans, and repair loop.

Have `writeReelPlanDraftSchema()` write the local v2 fixed schema to `reel-plan-draft-v2.schema.json` and have `buildCodexArgs()` reference it.

- [ ] **Step 5: Prove the API completion contract remains v1**

Update worker and production runtime tests so the model output is v2 but `client.complete()` receives `reel-plan-draft.v1` with only the existing asset fields.

- [ ] **Step 6: Run Reel tests and build**

Run:

```powershell
npm test --workspace @brand-pilot/reel-worker -- --run
npm run build --workspace @brand-pilot/reel-worker
```

Expected: all Reel tests pass and TypeScript build exits 0.

- [ ] **Step 7: Commit the Reel implementation**

Stage only `workers/brand-pilot-reel-worker` files and commit:

```powershell
git commit -m "feat(reels): structure scene copy before rendering"
```

### Task 3: Cross-format regression and scope proof

**Files:**
- Test only; no production files outside the two social workers.

- [ ] **Step 1: Run both full worker suites sequentially**

```powershell
npm test --workspace @brand-pilot/card-news-worker -- --run
npm test --workspace @brand-pilot/reel-worker -- --run
```

- [ ] **Step 2: Run both builds sequentially**

```powershell
npm run build --workspace @brand-pilot/card-news-worker
npm run build --workspace @brand-pilot/reel-worker
```

- [ ] **Step 3: Verify release impact**

Pass the changed file list to `classifyChangedPaths()` and assert:

```json
{
  "api": false,
  "customerUi": false,
  "imageWorker": false,
  "blogWorker": false,
  "cardNewsWorker": true,
  "reelWorker": true,
  "buildAllServer": false,
  "migrationChanged": false,
  "verifiedScope": true
}
```

- [ ] **Step 4: Verify protected paths and diff hygiene**

Run:

```powershell
git diff --check HEAD~2..HEAD
git diff --exit-code HEAD~2..HEAD -- apps/api apps/customer-ui workers/brand-pilot-image-worker workers/brand-pilot-blog-worker packages/brand-pilot-content-contracts db
git status --short
```

Expected: no protected-path diff; status contains only the known unrelated untracked preview/pnpm files.
