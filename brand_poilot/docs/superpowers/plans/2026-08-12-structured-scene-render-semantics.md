# Structured Scene Render Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve one validated structured scene source from the card-news and Reel planning CLI through the existing atomic completion transaction into the image CLI, while deriving the legacy `copy` deterministically and adding no new model call, queue, database table, or public UI/API flow.

**Architecture:** `StructuredSceneCopyV1` is the sole authored scene source. A shared content-contract function compiles it into the existing v1 asset fields, and the API requires exact equality before atomically storing the canonical plan and the authoritative full semantic envelope in the existing generation-job JSON payload. Each stored render job contains only a version/hash/index binding; claim hydration selects the current scene from the authoritative envelope, and the image worker stages it as read-only `structured-scene-copy.json`. `copy` controls exact visible characters, structured semantics control meaning and hierarchy, and `visualDirection` is subordinate presentation guidance.

**Tech Stack:** TypeScript, TypeBox, Vitest, Node.js, PostgreSQL JSONB, existing manual content workers, existing image-worker staging and Codex CLI runner.

---

## Locked scope and decisions

- Apply only to manual `card_news` and `reel` generation.
- Keep blog planning and blog supporting-image generation unchanged.
- Keep the public customer API, UI, proposal count, scene count, and model-call count unchanged.
- Keep `content-plan.json` on its current canonical `card-news-plan.v2` / `reel-plan.v2` contracts.
- Preserve both existing worker completion ingress representations (`plan` and `planDraft`). For manual card/Reel, both representations must carry and exactly match the same structured semantic envelope; do not use the legacy full-plan ingress to bypass semantic validation.
- Do not add a completion-stage endpoint, checkpoint state machine, database migration, queue, service, OCR pass, or second LLM reviewer.
- Continue using the existing atomic `/worker/ai-content-jobs/:jobId/complete` transaction.
- Store the validated full semantic envelope in the existing generation job `payload_json` for success replay.
- Store only semantic contract version, full-envelope SHA-256, and scene index in each existing render job `payload_json`; do not duplicate the scene body there.
- Use `contractVersion: "structured-scene-copy.v1"` on every persisted semantic envelope.
- Bump the producing planner audit versions to `card-news-plan-skill.v5` and `reel-plan-skill.v6`, and use `image-final-pixels.v3` only for semantic-aware card/Reel renders. Blog remains on its existing planner and `image-final-pixels.v2` contracts.
- Treat the structured scene as the only authored source. The model never writes legacy `copy` or a second legacy `visualDirection`.
- Derive legacy `copy` and legacy `visualDirection` with shared pure functions and compare exact strings in the API.
- For first-scene cover behavior, use the locked outline role and purpose as semantic prompt context; do not hard-code a `hook|cover` enum because proposal roles are currently free strings.

## Resolved user decisions

The user approved the recommended uniform relational `entries` representation for `structured-scene-copy.v1` because it keeps the Codex output schema simple while preserving relationships:

```ts
type StructuredKeyVisualV1 = {
  type: "none" | "number" | "before_after" | "comparison" | "steps" | "quote";
  entries: Array<{
    role: "value" | "before" | "after" | "left" | "right" | "step" | "quote" | "attribution";
    label: string | null;
    value: string;
  }>;
};
```

The implementation will run inline in the current task with `superpowers:executing-plans`; do not dispatch subagents.

Future named fields or new visual types such as `timeline`, `ranking`, `pros_cons`, `process`, `stat`, and `checklist` must not be added silently to the persisted v1 enum. Introduce `structured-scene-copy.v2`, add an explicit parser/renderer branch, and use a coordinated producer/API/image-worker deployment. The v1 `entries` representation remains readable for completed history and in-flight retries created under v1.

Lock the v1 relation matrix as follows. The local Codex schema remains structurally uniform; the shared worker/API parser enforces these semantic combinations after model output:

| `keyVisual.type` | Allowed ordered entries | Label rule |
| --- | --- | --- |
| `none` | exactly 0 | not applicable |
| `number` | 1–4 entries, every role is `value` | optional |
| `before_after` | exactly `before`, then `after` | optional |
| `comparison` | exactly `left`, then `right` | required on both entries |
| `steps` | 2–4 entries, every role is `step` | optional |
| `quote` | exactly `quote`, optionally followed by one `attribution` | optional |

Each entry has exact keys `role`, `label`, `value`; `label` is `null` or a trimmed string of at most 100 characters, and `value` is a trimmed non-empty string of at most 300 characters. Repeated `value` and `step` roles are allowed only within their respective types; all other duplicate or out-of-order roles are rejected. Existing outer limits stay unchanged: 1–5 scenes, at most 2 supporting texts, 8 evidence IDs, 20 product-image IDs, and 4,000 characters for compiled legacy copy.

## File map

### Shared semantic contract

- Create `packages/brand-pilot-content-contracts/src/structuredSceneCopy.ts` — TypeBox schema, parser, relation validation, deterministic flatten/compiler, and natural hierarchy builder.
- Create `packages/brand-pilot-content-contracts/src/structuredSceneCopy.test.ts` — exact relation and deterministic compilation tests.
- Modify `packages/brand-pilot-content-contracts/package.json` — export `./structured-scene-copy`.
- Modify `packages/brand-pilot-content-contracts/src/index.ts` — register the persistent schema in the canonical schema registry.
- Modify `packages/brand-pilot-content-contracts/src/catalog.ts` and focused catalog tests — register and verify the generated schema leaf.
- Modify `packages/brand-pilot-content-contracts/src/generateArtifacts.ts` — generate the persistent semantic schema artifact.
- Modify `packages/brand-pilot-content-contracts/src/generatedArtifacts.test.ts` — prove generated schema/catalog synchronization.
- Regenerate `packages/brand-pilot-content-contracts/generated/structured-scene-copy-v1.schema.json` and the generated catalog.

### Card-news and Reel planners

- Modify both local `structuredSceneDraft.ts` modules — use the shared parser/compiler and remove duplicated flatten logic.
- Modify both local CLI schema JSON files — replace `keyVisual.texts` with simple relational `keyVisual.entries`.
- Modify both prompt builders and tests — headline truth/continuity, supporting deduplication, cover promise, and type relationship rules.
- Modify both workers and tests — send the structured semantic envelope plus the deterministically compiled existing `planDraft` in the same completion request.

### API completion and render enqueue

- Modify `apps/api/src/aiContentContracts.ts` — add the internal semantic envelope to planning completion input.
- Modify `apps/api/src/httpServer.ts` — accept the exact optional `renderSemanticContract` key without changing public customer routes.
- Modify `apps/api/src/aiContentRepository.ts` — validate/compile/exact-compare, persist semantic envelope in generation-job JSON, and pass it to render enqueue in the same transaction.
- Modify `apps/api/src/aiContentRenderJobs.ts` — create a versioned social render binding and hydrate the current scene from the authoritative generation-job envelope at claim time.
- Modify focused API route, repository, render unit, and PostgreSQL/PGlite tests.

### Image worker

- Modify `workers/brand-pilot-image-worker/src/aiContentRenderClient.ts` and tests — parse the new social render payload exactly.
- Modify `workers/brand-pilot-image-worker/src/aiContentManualRenderContract.ts` and create its focused test — bind generation/output/index/role/copy/semantic scene.
- Modify `workers/brand-pilot-image-worker/src/aiContentAssetRenderer.ts` and tests — stage `inputs/structured-scene-copy.json` read-only for social jobs only.
- Modify the card/Reel v2 prompt modules, locked-copy instructions, and tests — define the exact priority among copy, semantic structure, and visual direction.

### CI/release scope

- Modify `scripts/release-impact.mjs` and `scripts/release-impact.test.mjs` — add an explicit structured-social-render release profile that accepts only this plan's allowlisted paths and selects API, image, card-news, and Reel components. Keep the default classifier conservative for shared package files.
- Do not modify customer UI, blog worker, migrations, automatic card-news source, unrelated workers, or pnpm files.

---

### Task 1: Add the shared persistent structured-scene contract

**Files:**
- Create: `packages/brand-pilot-content-contracts/src/structuredSceneCopy.ts`
- Create: `packages/brand-pilot-content-contracts/src/structuredSceneCopy.test.ts`
- Modify: `packages/brand-pilot-content-contracts/package.json`
- Modify: `packages/brand-pilot-content-contracts/src/index.ts`
- Modify: `packages/brand-pilot-content-contracts/src/catalog.ts`
- Modify: `packages/brand-pilot-content-contracts/src/catalog.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/generateArtifacts.ts`
- Modify: `packages/brand-pilot-content-contracts/src/generatedArtifacts.test.ts`
- Generate: `packages/brand-pilot-content-contracts/generated/structured-scene-copy-v1.schema.json`
- Generate: `packages/brand-pilot-content-contracts/generated/content-catalog.json`

- [ ] **Step 1: Write failing relation and deterministic compiler tests**

Cover these exact cases:

```ts
expect(compileStructuredScene(scene("before_after", [
  { role: "before", label: null, value: "4,000시간" },
  { role: "after", label: null, value: "8,000시간" },
]))).toMatchObject({
  copy: "롱폼 수익화 기준, 2배로\n4,000시간\n8,000시간",
});

expect(() => parseStructuredSceneCopyV1(scene("before_after", [
  { role: "before", label: null, value: "4,000시간" },
]))).toThrow("structured_scene_relation_invalid");

expect(() => parseStructuredSceneCopyV1(scene("none", [
  { role: "value", label: null, value: "불필요" },
]))).toThrow("structured_scene_relation_invalid");
```

Also test the locked relation matrix above, comparison labels, ordered steps, quote/attribution, whitespace normalization, footnote null, maximum two supporting texts, unknown keys, forbidden duplicate/out-of-order roles, the permitted repeated `value`/`step` roles, and total copy length.

- [ ] **Step 2: Run RED**

Run:

```powershell
npm test --workspace @brand-pilot/content-contracts -- --run src/structuredSceneCopy.test.ts
```

Expected: FAIL because the shared module/export does not exist.

- [ ] **Step 3: Implement the exact shared contract**

Use these public functions:

```ts
export function parseStructuredSceneCopyV1(value: unknown): StructuredSceneCopyV1;
export function flattenStructuredScene(scene: StructuredSceneCopyV1): string;
export function buildLegacyVisualDirection(scene: StructuredSceneCopyV1): string;
export function compileStructuredScene(scene: StructuredSceneCopyV1): {
  index: number;
  role: string;
  copy: string;
  visualDirection: string;
  evidenceIds: string[];
  productImageAssetIds: string[];
};
```

Flatten in this fixed order:

```text
headline
keyVisual entries in validated relation order, label before value when label is non-null
supportingTexts in array order
footnote when non-null
```

`buildLegacyVisualDirection(scene)` returns only `scene.visualDirection`. Natural hierarchy instructions are generated separately for the image prompt so no second visual-direction source exists.

- [ ] **Step 4: Export and generate the schema artifact**

Add:

```json
"./structured-scene-copy": "./dist/structuredSceneCopy.js"
```

Register `StructuredSceneCopyV1Schema` in `generateArtifacts.ts` as `structured-scene-copy-v1.schema.json`, run the normal generator, and require `check:generated` to pass.

- [ ] **Step 5: Run GREEN and build**

```powershell
npm test --workspace @brand-pilot/content-contracts -- --run src/structuredSceneCopy.test.ts src/generatedArtifacts.test.ts src/schemas.test.ts
npm run check:generated --workspace @brand-pilot/content-contracts
npm run build --workspace @brand-pilot/content-contracts
```

Expected: all pass; generated artifact and catalog have no unstaged drift after generation.

- [ ] **Step 6: Commit**

```powershell
git add -- packages/brand-pilot-content-contracts
git commit -m "feat(content-contracts): define structured scene semantics"
```

---

### Task 2: Make card-news and Reel use the shared source of truth

**Files:**
- Modify: `workers/brand-pilot-card-news-worker/src/structuredSceneDraft.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/structuredSceneDraft.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/scripts/card-news-plan-draft-v2.schema.json`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/worker.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/worker.test.ts`
- Modify corresponding files under `workers/brand-pilot-reel-worker/`

- [ ] **Step 1: Write failing worker tests proving one authored source**

Assert that the completion body contains both fields but that `planDraft.assets` is exactly derived:

```ts
const scene = parsedStructuredDraft.assets[0]!;
const completion = client.complete.mock.calls[0]![1];
expect(completion.planDraft.assets[0]).toEqual(compileStructuredScene(scene));
expect(completion.renderSemanticContract).toEqual({
  contractVersion: "structured-scene-copy.v1",
  outputFormat: "card_news",
  scenes: parsedStructuredDraft.assets,
});
```

Add a negative test showing that no `copy` key is accepted in model output.

- [ ] **Step 2: Run RED for both workers**

```powershell
npm test --workspace @brand-pilot/card-news-worker -- --run src/structuredSceneDraft.test.ts src/promptBuilder.test.ts src/worker.test.ts
npm test --workspace @brand-pilot/reel-worker -- --run src/contracts.test.ts src/promptBuilder.test.ts src/worker.test.ts
```

Expected: FAIL on the new keyVisual relation and completion semantic envelope.

- [ ] **Step 3: Replace duplicated flatten logic**

Import from `@brand-pilot/content-contracts/structured-scene-copy`. The outer model response remains `card-news-plan-draft.v2` or `reel-plan-draft.v2`, but every asset is parsed as `StructuredSceneCopyV1` and compiled with the shared function.

- [ ] **Step 4: Update the simple CLI schemas**

Use one fixed `entries` item schema with exact keys `role`, `label`, and `value`. Do not use `if`, `then`, `oneOf`, or conditional required fields in the model output schema. Enforce type-specific role combinations in worker code.

- [ ] **Step 5: Add the final writing rules**

Add these exact semantic requirements to both prompts:

```text
headline은 coreMessage의 축약본이어야 하며 coreMessage에 없는 사실, 수치, 효능 또는 결론을 추가하지 마세요.

supportingTexts는 headline 또는 keyVisual에 없는 새로운 정보만 제공해야 합니다.

supportingTexts를 모두 삭제해도 장면의 의미가 완전하다면 supportingTexts를 생성하지 마세요.

모든 장면의 headline만 순서대로 읽어도 콘텐츠의 핵심 흐름과 각 장면의 관계를 이해할 수 있어야 합니다. 동일한 내용을 반복하거나 서로 단절된 제목이 되지 않도록 하고 선택된 구성안의 서사 구조를 유지하세요.

첫 장면이 선택 구성안에서 표지, 도입 또는 훅 기능을 담당한다면 headline 외에 넘겨보았을 때 얻는 내용을 한 줄 이하의 supportingTexts promise로 포함할 수 있습니다.
```

- [ ] **Step 6: Run GREEN and build**

```powershell
npm test --workspace @brand-pilot/card-news-worker -- --run
npm test --workspace @brand-pilot/reel-worker -- --run
npm run build --workspace @brand-pilot/card-news-worker
npm run build --workspace @brand-pilot/reel-worker
```

Assert the emitted completion requests use the new exact audit versions:

```text
card_news -> card-news-plan-skill.v5
reel      -> reel-plan-skill.v6
```

- [ ] **Step 7: Commit**

```powershell
git add -- workers/brand-pilot-card-news-worker workers/brand-pilot-reel-worker
git commit -m "feat(content-planning): preserve structured social scenes"
```

---

### Task 3: Validate and persist semantics in the existing atomic completion transaction

**Files:**
- Modify: `apps/api/src/aiContentContracts.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Test: `apps/api/src/server.aiContentWorker.test.ts`
- Test: `apps/api/src/aiContentRepositoryV3Runtime.test.ts`
- Test: `apps/api/src/aiContentRepositoryV3.postgres.integration.test.ts`

- [ ] **Step 1: Write failing route and repository tests**

Required cases:

```text
card/reel completion without renderSemanticContract -> 400 terminal
blog completion with renderSemanticContract -> 400 terminal
unknown semantic contract version -> 400 terminal
scene count/index/role mismatch -> atomic rollback
flatten(scene) !== planDraft.asset.copy -> atomic rollback
scene visualDirection !== planDraft.asset.visualDirection -> atomic rollback
same successful completion replay with identical semantics -> idempotent success
successful replay with changed semantics but same legacy copy -> conflict
transaction fault after output update -> plan, semantic payload, and render jobs all roll back
card/reel planDraft ingress -> semantic envelope required and exact
card/reel full plan ingress -> semantic envelope required and exact
full plan with correct legacy copy but different structured meaning -> conflict/rollback
```

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- --run src/server.aiContentWorker.test.ts src/aiContentRepositoryV3Runtime.test.ts
```

Expected: FAIL because the route rejects the new exact key and the repository does not bind semantics.

- [ ] **Step 3: Extend the internal completion body**

For card/reel require:

```ts
interface RenderSemanticContractV1 {
  contractVersion: "structured-scene-copy.v1";
  outputFormat: "card_news" | "reel";
  scenes: StructuredSceneCopyV1[];
}
```

Keep blog completion byte-compatible and semantic-free.

- [ ] **Step 4: Validate exact derivation before any write**

For every scene, compare against the submitted representation selected by the existing exact XOR route:

```ts
const compiled = compileStructuredScene(scene);
assert.deepEqual(compiled, submittedPlanAssets[offset]);
```

For `planDraft`, assemble the existing canonical plan and require its `imagePackage.assets` to match the same compiled assets plus server-owned attachment IDs. For a submitted canonical `plan`, parse it with the existing canonical parser and apply the identical semantic comparison. Neither ingress may skip the shared compiler check.

- [ ] **Step 5: Persist and enqueue atomically**

Inside the existing completion transaction:

```text
output.plan_json = existing canonical plan
job.payload_json.renderSemanticContract = validated full envelope
render_jobs.payload_json.renderSemanticBinding = version + semantic hash + scene index
generation/job statuses = existing transitions
COMMIT once
```

Do not create another endpoint or transaction.

- [ ] **Step 6: Bind idempotent success replay**

When the job is already succeeded, compare both stored canonical plan and stored semantic envelope using canonical JSON. Return the existing generation only when both are identical; otherwise throw `ai_content_plan_completion_conflict`.

- [ ] **Step 7: Run GREEN, PostgreSQL tests, and typecheck**

```powershell
npm test --workspace @brand-pilot/api -- --run src/server.aiContentWorker.test.ts src/aiContentRepositoryV3Runtime.test.ts
npm test --workspace @brand-pilot/api -- --run src/aiContentRepositoryV3.postgres.integration.test.ts --maxWorkers=1
npm exec tsc --workspace @brand-pilot/api -- --noEmit
```

- [ ] **Step 8: Commit**

```powershell
git add -- apps/api/src
git commit -m "feat(ai-content): bind structured scenes to completion"
```

---

### Task 4: Version the social render payload and preserve current-scene semantics

**Files:**
- Modify: `apps/api/src/aiContentRenderJobs.ts`
- Test: `apps/api/src/aiContentRenderJobs.test.ts`
- Test: `apps/api/src/aiContentRenderJobs.pglite.test.ts`

- [ ] **Step 1: Write failing render-payload tests**

Assert that stored manual card/Reel image jobs use a new exact version and contain only an immutable semantic binding:

```ts
expect(payload).toMatchObject({
  contractVersion: "ai-content-render-job.v3",
  jobKind: "image_asset",
  rendererPromptVersion: "image-final-pixels.v3",
  renderSemanticBinding: {
    contractVersion: "structured-scene-copy.v1",
    semanticSha256: "<64 lowercase hex characters>",
    sceneIndex: 2,
  },
});
```

Assert that the hydrated claim contains the exact current scene selected from the generation-job envelope. Card/Reel use `image-final-pixels.v3`; blog render jobs remain on their existing payload and `image-final-pixels.v2` without either semantic field.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- --run src/aiContentRenderJobs.test.ts src/aiContentRenderJobs.pglite.test.ts --maxWorkers=1
```

- [ ] **Step 3: Enqueue the versioned social payload**

Hash the authoritative full envelope with canonical JSON. Store only its version/hash/current index binding in the render job, together with the existing output format, generation, output, asset index, and role bindings.

- [ ] **Step 4: Verify claim hydration and retries**

On claim, re-read the generation-job semantic envelope, verify the stored SHA-256, select the exact current scene, compile it against the canonical plan asset, and attach the hydrated current scene to the worker response. Reclaimed render jobs must return identical hydrated semantic bytes.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- --run src/aiContentRenderJobs.test.ts src/aiContentRenderJobs.pglite.test.ts --maxWorkers=1
git add -- apps/api/src/aiContentRenderJobs.ts apps/api/src/aiContentRenderJobs.test.ts apps/api/src/aiContentRenderJobs.pglite.test.ts
git commit -m "feat(ai-content): version social render semantics"
```

---

### Task 5: Stage structured semantics for the image CLI

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/aiContentRenderClient.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentRenderClient.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentManualRenderContract.ts`
- Create: `workers/brand-pilot-image-worker/src/aiContentManualRenderContract.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentAssetRenderer.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentAssetRenderer.test.ts`

- [ ] **Step 1: Write failing strict-parser and staging tests**

Required cases:

```text
valid card/Reel v3 render payload accepted
card/Reel semantic payload with image-final-pixels.v2 rejected
blog payload with image-final-pixels.v3 rejected
unknown/extra semantic key rejected
semantic generation/output/index/role mismatch rejected
flatten(scene) != currentAsset.copy rejected before child process
scene.visualDirection != currentAsset.visualDirection rejected
structured-scene-copy.json exists and is mode 0444 for social jobs
structured-scene-copy.json is absent for blog jobs
coreMessage is present in JSON but marked non-display in prompt contract
```

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/image-worker -- --run src/aiContentRenderClient.test.ts src/aiContentManualRenderContract.test.ts src/aiContentAssetRenderer.test.ts
```

- [ ] **Step 3: Parse and bind with the shared contract**

Use `parseStructuredSceneCopyV1()` and `compileStructuredScene()` from the shared package. Never trust the render payload merely because API created it; validate again at the worker boundary.

- [ ] **Step 4: Stage one read-only file**

Write:

```json
{
  "contractVersion": "structured-scene-copy.v1",
  "scene": {}
}
```

to `inputs/structured-scene-copy.json` with the same atomic read-only writer used for other staged JSON files.

- [ ] **Step 5: Run GREEN and build**

```powershell
npm test --workspace @brand-pilot/image-worker -- --run src/aiContentRenderClient.test.ts src/aiContentManualRenderContract.test.ts src/aiContentAssetRenderer.test.ts
npm run build --workspace @brand-pilot/image-worker
```

- [ ] **Step 6: Commit**

```powershell
git add -- workers/brand-pilot-image-worker
git commit -m "feat(image-worker): stage structured scene semantics"
```

---

### Task 6: Teach only the card/Reel image prompts the semantic priority

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/aiContentLockedSocialCopyPrompt.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentCardAssetPromptV2.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentReelAssetPromptV2.ts`
- Modify focused prompt and skill contract tests.

- [ ] **Step 1: Write failing prompt tests**

Require these exact concepts:

```text
copy = exact visible characters
structured scene = semantic roles and relationships
visualDirection = subordinate presentation guidance
structured scene wins when visualDirection conflicts
coreMessage must never be displayed
keyVisual may be visually equal to or stronger than headline
supportingTexts use lower hierarchy
footnote is the smallest readable hierarchy
```

Also require the prompt to reference `inputs/structured-scene-copy.json` and keep all model-authored values inside the existing escaped closed data files rather than interpolating them into instructions.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/image-worker -- --run src/aiContentManualAssetPromptV2.test.ts src/skillContract.test.ts
```

- [ ] **Step 3: Implement fixed instructions only**

Add fixed trusted prose. Do not interpolate headline, core message, labels, values, or visualDirection into the instruction region. The image CLI reads those values from the staged JSON files.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/image-worker -- --run src/aiContentManualAssetPromptV2.test.ts src/skillContract.test.ts
git add -- workers/brand-pilot-image-worker
git commit -m "feat(image-prompts): honor structured scene hierarchy"
```

---

### Task 7: Lock CI impact and run the full regression matrix

**Files:**
- Modify: `scripts/release-impact.mjs`
- Modify: `scripts/release-impact.test.mjs`

- [ ] **Step 1: Write a failing explicit-profile test**

Add a profile such as `structured-social-render-semantics`. When every changed path is inside the exact allowlist for Tasks 1–7, expect exactly:

```ts
["api", "cardNewsWorker", "imageWorker", "reelWorker"]
```

and require `customerUi`, `blogWorker`, automatic card-news, DM/wiki, intelligence, and subject-analysis components to remain false.

Also require the profile to reject unknown or extra paths instead of silently widening or ignoring them. The normal default classifier remains conservative; do not globally classify shared files such as `package.json`, `generateArtifacts.ts`, or `src/index.ts` as social-only.

- [ ] **Step 2: Run RED and implement the explicit profile**

```powershell
node --test scripts/release-impact.test.mjs
```

Add only the exact implementation/test/generated paths in this plan to the profile allowlist. The deployment manifest must record the selected profile and hard-stop when the actual diff contains anything outside the allowlist.

- [ ] **Step 3: Run all focused tests and builds**

```powershell
npm test --workspace @brand-pilot/content-contracts -- --run
npm test --workspace @brand-pilot/card-news-worker -- --run
npm test --workspace @brand-pilot/reel-worker -- --run
npm test --workspace @brand-pilot/image-worker -- --run src/aiContentRenderClient.test.ts src/aiContentManualRenderContract.test.ts src/aiContentAssetRenderer.test.ts src/aiContentManualAssetPromptV2.test.ts src/skillContract.test.ts
npm test --workspace @brand-pilot/api -- --run src/server.aiContentWorker.test.ts src/aiContentRepositoryV3Runtime.test.ts src/aiContentRenderJobs.test.ts
npm run check:generated --workspace @brand-pilot/content-contracts
npm run build --workspace @brand-pilot/card-news-worker
npm run build --workspace @brand-pilot/reel-worker
npm run build --workspace @brand-pilot/image-worker
npm exec tsc --workspace @brand-pilot/api -- --noEmit
node --test scripts/release-impact.test.mjs
git diff --check
```

- [ ] **Step 4: Prove protected paths stayed unchanged**

Require zero diff under:

```text
apps/customer-ui
workers/brand-pilot-blog-worker
apps/api/src/automatedCardNews.ts
workers/brand-pilot-marketing-worker
db/migrations
```

- [ ] **Step 5: Run one real CLI schema smoke per social format**

Use a fixed non-production fixture to invoke the actual card and Reel planning commands once. Confirm the Codex/OpenAI structured-output layer accepts the simple schema and the local parser accepts the result. Do not invoke image generation in this schema smoke.

- [ ] **Step 6: Commit**

```powershell
git add -- scripts/release-impact.mjs scripts/release-impact.test.mjs
git commit -m "test(release): scope structured scene consumers"
```

---

### Task 8: Coordinated deployment and production canary

This task requires a separate explicit user instruction to deploy.

- [ ] **Step 1: Pre-deploy inventory**

Confirm no nonterminal manual card/Reel planning jobs or social render jobs remain. The user previously authorized discarding obsolete pending manual work; do not modify completed history.

- [ ] **Step 2: Deploy as one coordinated semantic-contract release**

Deploy only:

```text
API
card-news worker
Reel worker
image worker
```

Do not deploy UI, blog, unrelated workers, or migrations.

Use the verified `structured-social-render-semantics` release profile. Refuse deployment if the produced component set is wider or narrower than these four components.

- [ ] **Step 3: Run one production card-news canary and one production Reel canary**

For each canary verify:

```text
one planning CLI call unless the existing one repair is genuinely needed
stored structured-scene-copy.v1 contract
flattened copy exact equality
one version/hash/index binding per stored render job and one hydrated current-scene envelope per claimed job
structured-scene-copy.json staged
no coreMessage displayed
keyVisual relationship reflected in layout
no unexpected replan or duplicate render job
normal final download/manifest completion
```

- [ ] **Step 4: Compare runtime latency**

Record proposal, planning, API completion, render queue wait, image generation, and finalization durations against the latest comparable production generation. The change is accepted only if no new external call appears and any latency difference is limited to structured output/prompt-size variance rather than a new process.

---

## Expected runtime impact

The runtime call graph remains unchanged:

```text
proposal CLI count: unchanged
planning CLI count: unchanged
repair count: unchanged, maximum one
image CLI count: unchanged, one per planned scene
database transaction count: unchanged
render job count: unchanged
queue count: unchanged
```

New work is bounded parsing, string joining, canonical JSON comparison, hashing, and one small staged JSON file. The structured output and image prompt are slightly larger, so model latency can vary by a few seconds, but the design does not add a process capable of turning an approximately eight-minute generation into a materially longer multi-stage flow.

## Self-review checklist

- Every reviewer requirement maps to Tasks 1–6.
- The plan contains no new completion-stage endpoint or database migration.
- The plan preserves one authored source and exact derivation.
- The plan accounts for response-loss success replay in the existing atomic completion path.
- The plan does not hard-code free-form proposal role strings.
- The plan keeps blog, UI, automated card-news, and unrelated workers out of scope.
- The plan includes actual Codex schema smoke testing before deployment.
- The plan requires explicit user approval before deployment.
