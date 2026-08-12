# Card Deck Editorial Pipeline Implementation Plan

> Superseded runtime note (2026-08-12): the completed implementation uses the named
> `ai-content-card-deck-render-job.v1` contract for Card News and the named
> `ai-content-reel-storyboard-render-job.v1` contract for Reels. It does not retain
> the draft `render v4`/Reel v3 routing described in intermediate tasks below.
> Blog remains on its independent `ai-content-render-job.v2` image contract.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace new card-news planning and render handoff with one deck-level editorial source that preserves strong frozen facts and serves both manual and future automatic card news without adding model calls.

**Architecture:** `CardDeckEditorialPlanV1` is the sole model-authored source. Shared pure functions derive compatibility `StructuredSceneCopyV1`, legacy copy, the existing canonical card plan, and a deterministic image prompt. The API stores the authoritative deck in existing JSONB, and all deck-bound cards use render job v4 independent of manual or scheduled origin.

**Tech Stack:** TypeScript, TypeBox, Vitest, Node.js, PostgreSQL/PGlite JSONB, Codex CLI JSONL, existing content and image workers.

---

## Locked boundaries

- No UI, Blog, Reel, marketing-worker, or migration change.
- No new AI call, queue, service, or sequential image render.
- Selected proposal identity, purpose, angle, audience, format, channel, and card count stay fixed.
- Scene information allocation, headlines, purposes, evidence allocation, and layouts are final Deck decisions.
- New manual cards use only Deck v1/render v4. Future automatic selection enters the same boundary.
- Existing completed history remains readable/downloadable/publishable; old nonterminal card jobs are terminated, not translated.
- Existing Reel structured-scene/render-v3 behavior remains byte-compatible.

## File map

- Shared contract: create `packages/brand-pilot-content-contracts/src/cardDeckEditorialPlan.ts` and test; export/register/generate its schema and catalog hashes.
- Proposal: modify content-proposal worker prompt/contracts/tests for card-only evidence subsets and strong-fact rules.
- Card planner: create `sourceBundle.ts` and `deckPlan.ts`; replace the card draft-v2 schema/runner and remove the superseded card-local draft adapter.
- API: change private completion parsing/repository and render jobs to atomically store Deck v1 and enqueue/hydrate card render v4.
- Image worker: add exact v4 contract, deterministic prompt compiler, read-only staging, and honest Codex tool-argument diagnostics.
- Release: add an exact release profile only if current tooling cannot represent API + proposal + card + image.

---

### Task 1: Define Deck v1 and its compiler

**Files:**
- Create: `packages/brand-pilot-content-contracts/src/cardDeckEditorialPlan.ts`
- Create: `packages/brand-pilot-content-contracts/src/cardDeckEditorialPlan.test.ts`
- Modify: `packages/brand-pilot-content-contracts/package.json`
- Modify: `packages/brand-pilot-content-contracts/src/index.ts`
- Modify: `packages/brand-pilot-content-contracts/src/catalog.ts`
- Modify: `packages/brand-pilot-content-contracts/src/catalog.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/generateArtifacts.ts`
- Modify: `packages/brand-pilot-content-contracts/src/generatedArtifacts.test.ts`
- Generate: `packages/brand-pilot-content-contracts/generated/card-deck-editorial-plan-v1.schema.json`
- Generate: `packages/brand-pilot-content-contracts/generated/content-catalog.json`

- [ ] **Step 1: Write the failing contract test**

```ts
const deck = parseCardDeckEditorialPlanV1(deckFixture());
expect(deck.contractVersion).toBe("card-deck-editorial-plan.v1");
expect(deck.scenes.map(({ index }) => index)).toEqual([1, 2, 3, 4]);
expect(deck.scenes[1]?.keyVisual).toEqual({
  type: "before_after",
  entries: [
    { role: "before", label: "기존", value: "4,000시간" },
    { role: "after", label: "변경", value: "8,000시간" },
  ],
});
```

Also reject unknown keys, invalid scene count/index, empty visual invariants, invalid layout archetypes, invalid existing key-visual relations, duplicate IDs, and over-limit strings.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/content-contracts -- --run src/cardDeckEditorialPlan.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement exact functions**

```ts
export function parseCardDeckEditorialPlanV1(value: unknown): CardDeckEditorialPlanV1;
export function compileCardDeckSceneV1(
  plan: CardDeckEditorialPlanV1,
  scene: CardDeckSceneV1,
  compatibilityRole: string,
): StructuredSceneCopyV1;
export function compileCardDeckPlanDraftV1(
  plan: CardDeckEditorialPlanV1,
  outline: ReadonlyArray<{ index: number; role: string }>,
): CardNewsPlanDraftV1;
export function cardDeckEditorialPlanSha256(plan: CardDeckEditorialPlanV1): string;
```

Generate `visualDirection` once from deck narrative, the five visual-system fields, `editorialRole`, purpose, visual thesis, and layout archetype. Persisted compatibility `role` comes only from the outline slot at the same index.

- [ ] **Step 4: Prove one authored source**

```ts
const scene = compileCardDeckSceneV1(deck, deck.scenes[0]!, outline[0]!.role);
const draft = compileCardDeckPlanDraftV1(deck, outline);
expect(draft.assets[0]).toEqual(compileStructuredScene(scene));
expect(draft.assets[0]?.copy).toBe(flattenStructuredScene(scene));
expect(draft.assets[0]?.role).toBe(outline[0]?.role);
expect(draft.assets[0]).not.toHaveProperty("editorialRole");
```

- [ ] **Step 5: Export, generate, and verify**

```powershell
npm run generate --workspace @brand-pilot/content-contracts
npm test --workspace @brand-pilot/content-contracts -- --run src/cardDeckEditorialPlan.test.ts src/generatedArtifacts.test.ts src/catalog.test.ts src/schemas.test.ts
npm run check:generated --workspace @brand-pilot/content-contracts
npm run build --workspace @brand-pilot/content-contracts
```

- [ ] **Step 6: Commit**

```powershell
git add -- packages/brand-pilot-content-contracts
git commit -m "feat(content-contracts): define card deck editorial plan"
```

---

### Task 2: Improve card proposals without changing Blog or Reel

**Files:**
- Modify: `packages/brand-pilot-content-contracts/src/catalog.ts`
- Modify: generated catalog/binding artifacts and exact-version fixtures
- Modify: `workers/brand-pilot-content-proposal-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/contracts.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/testFixtures.ts`

- [ ] **Step 1: Write RED tests**

Require the card prompt to state that proposal evidence is representative, final Deck may use the full frozen evidence set, and newsworthy changes/numbers/applicability/timing must not become generic guidance. Accept three card proposals with different owned evidence/reference subsets; keep the same mutation invalid for Blog and Reel.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/content-proposal-worker -- --run src/promptBuilder.test.ts src/contracts.test.ts
```

- [ ] **Step 3: Make only card sets independent**

```ts
const requireSharedSets = settings.outputFormat !== "card_news";
if (
  new Set(set.proposals.map((p) => p.conceptKey)).size !== 3
  || new Set(set.proposals.map(semanticFingerprint)).size !== 3
  || (requireSharedSets && new Set(set.proposals.map((p) => sortedSet(p.evidenceIds))).size !== 1)
  || (requireSharedSets && new Set(set.proposals.map((p) => sortedSet(p.referenceIds))).size !== 1)
) fail("content_proposal_result_not_distinct");
```

Keep per-ID ownership, purpose, channel, count, index, and product checks unchanged.

- [ ] **Step 4: Bump the coordinated proposal prompt version**

Change `proposal.writer.v2` to `proposal.writer.v3`, regenerate artifacts, and update exact fixtures. Do not add a permanent v2 fallback.

- [ ] **Step 5: Run GREEN**

```powershell
npm test --workspace @brand-pilot/content-proposal-worker -- --run
npm run build --workspace @brand-pilot/content-proposal-worker
npm run check:generated --workspace @brand-pilot/content-contracts
npm test --workspace @brand-pilot/api -- --run src/contentProposalJobs.test.ts src/aiContentProposalV2Repository.pglite.test.ts src/aiContentFixedInputAssembler.test.ts
```

- [ ] **Step 6: Commit**

```powershell
git add -- packages/brand-pilot-content-contracts workers/brand-pilot-content-proposal-worker apps/api/src
git commit -m "feat(content-proposals): preserve strong card evidence"
```

---

### Task 3: Replace the card-local draft with a Deck planner

**Files:**
- Create: card worker `src/sourceBundle.ts`, `src/sourceBundle.test.ts`, `src/deckPlan.ts`, `src/deckPlan.test.ts`
- Create: `scripts/card-deck-editorial-plan-v1.schema.json`, `scripts/run-codex-card-deck-plan.mjs`
- Modify: card prompt/worker/tests, production runtime, skill, Dockerfile
- Delete after import scan: card `structuredSceneDraft.ts`, its test, `editorialPlan.ts`, old v2 schema/runner

- [ ] **Step 1: Write RED source-bundle tests**

For `topic_url`, `topic_text`, and `reference`, require exact keys `intent`, `subject`, `factualSources`, `editorialReferences`, `visualReferences`, `brandContext`. Preserve all frozen research, styles, avatar, attachments, and user image direction; exclude mutable fetches and credentials.

- [ ] **Step 2: Write RED compilation tests**

```ts
const submission = parseCardDeckSubmissionForInput(deckFixture(), input);
expect(submission.planDraft.assets).toEqual(
  submission.deckPlan.scenes.map((scene, offset) => compileStructuredScene(
    compileCardDeckSceneV1(submission.deckPlan, scene, input.selectedProposal.outline[offset]!.role),
  )),
);
```

Reject changed count/index and unknown evidence/product IDs.

- [ ] **Step 3: Run RED**

```powershell
npm test --workspace @brand-pilot/card-news-worker -- --run src/sourceBundle.test.ts src/deckPlan.test.ts src/promptBuilder.test.ts src/worker.test.ts
```

- [ ] **Step 4: Implement prompt and v6 audit version**

Fixed: proposal identity/angle/audience/purpose/format/channel/count. Advisory: outline headline/order/role/evidence. Authoritative: complete subject/research/product/references. Visual precedence: explicit user > mandatory reference/attachment > brand > subject cue > model. Add the approved editorial rules and keep values in the escaped closed JSON envelope.

- [ ] **Step 5: Replace schema/runner and remove old code**

Use a simple schema without `oneOf`, `if/then`, `uniqueItems`, or recursion; validate relations in code with the existing one repair.

```powershell
rg -n "structuredSceneDraft|editorialPlan|card-news-plan-draft-v2|run-codex-card-news-v2-plan" workers/brand-pilot-card-news-worker
```

- [ ] **Step 6: Send Deck completion**

```ts
{
  workerId, leaseToken, skillVersion: "card-news-plan-skill.v6", jobType: "generate",
  planDraft: compileCardDeckPlanDraftV1(deckPlan, input.selectedProposal.outline),
  cardDeckContract: {
    contractVersion: "card-deck-editorial-plan.v1",
    deckSha256: cardDeckEditorialPlanSha256(deckPlan),
    plan: deckPlan,
  },
}
```

Do not send old card `renderSemanticContract`; Reel retains it.

- [ ] **Step 7: Run GREEN, schema smoke, commit**

```powershell
npm test --workspace @brand-pilot/card-news-worker -- --run
npm run build --workspace @brand-pilot/card-news-worker
git add -A -- workers/brand-pilot-card-news-worker
git commit -m "feat(card-news): plan the final deck editorially"
```

Run the packaged planner once with a frozen nonproduction fixture; validate actual structured output without image generation.

---

### Task 4: Validate and persist Deck completion atomically

**Files:**
- Modify: `apps/api/src/aiContentContracts.ts`, `httpServer.ts`, `aiContentRepository.ts`, `aiContentPlanContracts.ts`
- Modify: focused route/repository/contract/PostgreSQL tests

- [ ] **Step 1: Write RED tests**

Cover exact Deck keys, rejection of old card semantic sidecar, unchanged Reel/Blog ingress, hash mismatch, compilation mismatch, equal success replay, and changed Deck with equal flattened copy conflict.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- --run src/server.aiContentWorker.test.ts src/aiContentRepositoryV3Runtime.test.ts src/aiContentRepositoryV3Contracts.test.ts
```

- [ ] **Step 3: Parse by format**

```text
card_news: planDraft + cardDeckContract required; renderSemanticContract forbidden
reel: existing planDraft/plan + renderSemanticContract unchanged
blog: existing planDraft/plan unchanged; both sidecars forbidden
```

- [ ] **Step 4: Recompile under the existing lock**

```ts
const deck = parseCardDeckEditorialPlanV1(body.cardDeckContract.plan);
if (cardDeckEditorialPlanSha256(deck) !== body.cardDeckContract.deckSha256) {
  throw new Error("ai_content_card_deck_hash_mismatch");
}
const expectedDraft = compileCardDeckPlanDraftV1(deck, finalInput.selectedProposal.outline);
if (canonicalProposalJson(expectedDraft) !== canonicalProposalJson(body.planDraft)) {
  throw new Error("ai_content_card_deck_compilation_mismatch");
}
const plan = assembleContentPlanResultV2(expectedDraft, finalInput, supplementalResearch);
```

Do not accept a worker-authored canonical card plan as a new-card alternative.

- [ ] **Step 5: Persist and replay**

In the current transaction store canonical plan, full Deck envelope, v6 skill, v4 render jobs, and current status transitions. Replay compares canonical plan and Deck and enqueues nothing twice.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- --run src/server.aiContentWorker.test.ts src/aiContentRepositoryV3Runtime.test.ts src/aiContentRepositoryV3Contracts.test.ts
npm test --workspace @brand-pilot/api -- --run src/aiContentRepositoryV3.postgres.integration.test.ts --maxWorkers=1
npm run typecheck --workspace @brand-pilot/api
git add -- apps/api/src
git commit -m "feat(ai-content): persist authoritative card decks"
```

If PostgreSQL is blocked before bodies by the known 075 bootstrap, record it and do not report those tests passed.

---

### Task 5: Route manual and scheduled Deck cards through render v4

**Files:**
- Modify: `apps/api/src/aiContentRenderJobs.ts`, its unit/PGlite tests, and V3 runtime test

- [ ] **Step 1: Write RED matrix**

Manual Deck and scheduled Deck both produce v4; new card without Deck rejects with no fallback; Reel stays v3; Blog stays unchanged.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- --run src/aiContentRenderJobs.test.ts src/aiContentRenderJobs.pglite.test.ts src/aiContentRepositoryV3Runtime.test.ts --maxWorkers=1
```

- [ ] **Step 3: Store exact v4 binding**

```ts
{
  contractVersion: "ai-content-render-job.v4",
  jobKind: "image_asset", generationId, outputId, imagePackage, assetIndex, assetKey, storagePath,
  rendererPromptVersion: "image-card-deck.v1",
  cardDeckBinding: {
    contractVersion: "card-deck-editorial-plan.v1", deckSha256, sceneIndex: assetIndex,
  },
}
```

Replace the manual-origin resolver with a format/contract resolver. Origin validates lineage but never chooses card rendering.

- [ ] **Step 4: Hydrate and verify**

Re-read Deck, hash it, select scene, derive compatibility role, compile scene/asset, and compare canonical plan. Mismatch is terminal; never v1/v2/v3 fallback.

- [ ] **Step 5: Prove retry immutability**

Claim, retryably fail, and reclaim one v4 job; Deck/current-scene/package JSON stays identical and one row exists per output/index.

- [ ] **Step 6: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- --run src/aiContentRenderJobs.test.ts src/aiContentRenderJobs.pglite.test.ts src/aiContentRepositoryV3Runtime.test.ts --maxWorkers=1
git add -- apps/api/src/aiContentRenderJobs.ts apps/api/src/aiContentRenderJobs.test.ts apps/api/src/aiContentRenderJobs.pglite.test.ts apps/api/src/aiContentRepositoryV3Runtime.test.ts
git commit -m "feat(ai-content): unify card deck render transport"
```

---

### Task 6: Compile the final image prompt and audit handoff

**Files:**
- Create: image worker `aiContentCardDeckRenderContract.ts`/test, `aiContentCardDeckPromptCompiler.ts`/test, `aiContentCardDeckAssetPrompt.ts`
- Modify: image render client/renderer/runner contract/tests, `codexImageOutput.mjs`/test, runner script, skill/runtime tests
- Modify: API render completion/audit and tests

- [ ] **Step 1: Write RED contract/compiler tests**

Reject wrong binding/hash/scene/copy/role and card prompt on Blog/Reel. Require deterministic prompt sections in this order:

```text
[GLOBAL VISUAL SYSTEM]
[SCENE PURPOSE]
[HEADLINE - VERBATIM]
[KEY VISUAL RELATION]
[VISUAL THESIS]
[LAYOUT ARCHETYPE]
[SUPPORTING TEXT - VERBATIM]
[FOOTNOTE - VERBATIM]
[REFERENCE FILES]
[RENDERING RULES]
```

Display strings occur once, `coreMessage` is nondisplay, relations and reference paths remain exact, pseudo-tags cannot escape the data envelope.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/image-worker -- --run src/aiContentCardDeckRenderContract.test.ts src/aiContentCardDeckPromptCompiler.test.ts src/aiContentRenderClient.test.ts src/aiContentAssetRenderer.test.ts src/aiContentAssetRunnerContract.test.ts
```

- [ ] **Step 3: Stage v4 read-only files**

Stage `card-deck-editorial-plan.json`, `card-deck-current-scene.json`, and `compiled-render-prompt.txt` as 0444 plus current full inputs/attachments. V1–V3/finalizer staging stays unchanged.

- [ ] **Step 4: Make Codex execute, not edit**

Trusted instructions require the full compiled prompt to be passed without summarizing/rewriting/translating/omitting; only named staged references are prepared; PNG is inspected; existing completion JSON is returned. Model data never enters instruction prose.

- [ ] **Step 5: Observe actual arguments honestly**

Capture one sanitized nonproduction JSONL fixture. Parse only the proven tool-call shape. If absent, report `not_emitted_by_runner`; never infer observed arguments from compiled prompt.

- [ ] **Step 6: Append private diagnostics**

Report Deck hash, scene index, compiled prompt version/hash, observed/not-emitted state, and nullable actual-arguments hash. Append `ai_content_card_deck_render_diagnostic` after asset success; audit failure does not roll back. Customer manifest/result JSON stays unchanged.

- [ ] **Step 7: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/image-worker -- --run src/aiContentCardDeckRenderContract.test.ts src/aiContentCardDeckPromptCompiler.test.ts src/aiContentRenderClient.test.ts src/aiContentAssetRenderer.test.ts src/aiContentAssetRunnerContract.test.ts src/codexImageOutput.test.ts src/skillContract.test.ts src/productionRuntime.test.ts
npm run build --workspace @brand-pilot/image-worker
npm test --workspace @brand-pilot/api -- --run src/aiContentRenderJobs.test.ts src/aiContentRenderJobs.pglite.test.ts --maxWorkers=1
git add -- workers/brand-pilot-image-worker apps/api/src/aiContentRenderJobs.ts apps/api/src/aiContentRenderJobs.test.ts apps/api/src/aiContentRenderJobs.pglite.test.ts
git commit -m "feat(image-worker): render deterministic card decks"
```

---

### Task 7: Prove the future automatic seam

**Files:**
- Modify tests only if missing: `apps/api/src/automatedCardNews.test.ts`, `apps/api/src/aiContentRenderJobs.test.ts`, proposal contract tests
- No expected production change: `apps/api/src/automatedCardNews.ts`, `workers/brand-pilot-marketing-worker`

- [ ] **Step 1: Test scheduled proposal compatibility**

A `scheduled_crawl` card composition under proposal v3 accepts independently selected owned representative evidence while retaining complete frozen snapshots.

- [ ] **Step 2: Test origin-independent rendering**

Identical Deck-bound state with manual/scheduled origin enqueues equal v4 payloads except identities.

- [ ] **Step 3: Test the incomplete selector stays honest**

A scheduled row without selected generation/Deck cannot fabricate a Deck or claim v4. It remains in the existing incomplete proposal state; no old automatic image renderer is invoked.

- [ ] **Step 4: Run tests and protected diff**

```powershell
npm test --workspace @brand-pilot/api -- --run src/automatedCardNews.test.ts src/aiContentRenderJobs.test.ts
npm test --workspace @brand-pilot/content-proposal-worker -- --run src/contracts.test.ts
git diff --exit-code 83e21c49eab9bda598e1a0e664c08749b11c3937 -- apps/api/src/automatedCardNews.ts workers/brand-pilot-marketing-worker
```

- [ ] **Step 5: Commit only changed tests**

```powershell
git add -- apps/api/src/automatedCardNews.test.ts apps/api/src/aiContentRenderJobs.test.ts workers/brand-pilot-content-proposal-worker/src/contracts.test.ts
git diff --cached --quiet || git commit -m "test(ai-content): bind scheduled cards to deck transport"
```

---

### Task 8: Lock release scope and run regression

**Files:**
- Modify only if necessary: `scripts/release-impact.mjs`, `scripts/release-impact.test.mjs`

- [ ] **Step 1: Write exact release-profile coverage**

`card-deck-editorial-pipeline` selects exactly API, content-proposal worker, card-news worker, and image worker. UI, Blog, Reel, marketing and migrations are false. Unexpected paths hard-stop; default classification is not weakened.

- [ ] **Step 2: Implement only if needed**

```powershell
node --test scripts/release-impact.test.mjs
```

- [ ] **Step 3: Run package suites sequentially**

```powershell
npm test --workspace @brand-pilot/content-contracts -- --run
npm run check:generated --workspace @brand-pilot/content-contracts
npm run build --workspace @brand-pilot/content-contracts
npm test --workspace @brand-pilot/content-proposal-worker -- --run
npm run build --workspace @brand-pilot/content-proposal-worker
npm test --workspace @brand-pilot/card-news-worker -- --run
npm run build --workspace @brand-pilot/card-news-worker
npm test --workspace @brand-pilot/image-worker -- --run
npm run build --workspace @brand-pilot/image-worker
```

Run sequentially because prior parallel runs exhausted C: temporary space.

- [ ] **Step 4: Run API/static checks**

```powershell
npm test --workspace @brand-pilot/api -- --run src/aiContentPlanContracts.test.ts src/server.aiContentWorker.test.ts src/aiContentRepositoryV3Runtime.test.ts src/aiContentRepositoryV3Contracts.test.ts src/aiContentRenderJobs.test.ts src/automatedCardNews.test.ts
npm test --workspace @brand-pilot/api -- --run src/aiContentRenderJobs.pglite.test.ts --maxWorkers=1
npm run typecheck --workspace @brand-pilot/api
node --test scripts/release-impact.test.mjs
git diff --check
```

- [ ] **Step 5: Prove protected sources**

```powershell
git diff --exit-code 83e21c49eab9bda598e1a0e664c08749b11c3937 -- apps/customer-ui workers/brand-pilot-blog-worker workers/brand-pilot-reel-worker apps/api/src/automatedCardNews.ts workers/brand-pilot-marketing-worker db/migrations
git status --short
```

- [ ] **Step 6: Whole-diff checklist**

Verify no second authored copy/prompt, no card outline editorial lock, no manual-origin v4 requirement, no v4 fallback, no new call/queue, no fabricated tool args, and no protected-source change.

- [ ] **Step 7: Commit release control if changed**

```powershell
git add -- scripts/release-impact.mjs scripts/release-impact.test.mjs
git diff --cached --quiet || git commit -m "test(release): scope card deck pipeline"
```

---

### Task 9: Coordinated production cutover and canary

This task requires a separate explicit deployment instruction.

- [ ] **Step 1: Establish actual production baseline**

Use production host state, immutable digests, and `release.env`; repair/create a verified bundle for the deployed baseline rather than trusting stale `PRODUCTION_RELEASE_SHA` alone.

- [ ] **Step 2: Pause card creation and inventory**

Pause manual and automatic card creation. Inventory nonterminal card proposal, generation, output, planning, and render rows. Do not touch completed history or Blog/Reel.

- [ ] **Step 3: Terminate obsolete work safely**

Use the approved maintenance/cutover mechanism. If no safe post-075 maintenance window exists, stop for a deployment decision; do not bypass write fences.

- [ ] **Step 4: Deploy exact immutable images**

```text
API
content-proposal-worker-1
card-news-worker-1
image-worker-1
```

Refuse any wider component set.

- [ ] **Step 5: Run a Growthline production canary**

Use a frozen source with strong numeric/change facts and one reference image. Verify three proposals, selected angle/count, complete evidence, one Deck call unless repaired, stored Deck v1, v4 per scene, exact copy, honest diagnostics, staged references, parallel render, download, and publication.

- [ ] **Step 6: Compare quality and latency**

Record proposal, Deck, completion, queue, image, finalization, and publication durations. Evaluate strong-fact retention, headline-only coherence, visible relation, shared visual invariants, reference influence, and absence of generic substitution.

- [ ] **Step 7: Keep rollback symmetric**

After v4 jobs exist, pause card creation and drain/terminalize them before restoring older API/workers. Never let an old image worker claim v4.

---

## Expected performance

Proposal and Deck model-call counts stay unchanged; repair remains at most one; image calls remain one per card and parallel. Added work is parsing, hashing, prompt compilation and three small staged files. There is no new round trip or serial phase.

## Self-review checklist

- [x] `editorialRole` never becomes persisted compatibility `role`.
- [x] Card count stays fixed while final scene allocation is editable.
- [x] Full frozen evidence remains available after proposal selection.
- [x] Proposal evidence is representative, not a Deck whitelist.
- [x] Manual and scheduled origins resolve to the same v4 renderer.
- [x] The broken automatic selector is not falsely declared repaired.
- [x] New Deck jobs cannot fall back to legacy card render paths.
- [x] Reel v3 and Blog remain unchanged.
- [x] Compiled and actual prompts are distinguished honestly.
- [x] No new AI call, queue, migration, or UI change.
- [x] Deployment remains separately authorized.
