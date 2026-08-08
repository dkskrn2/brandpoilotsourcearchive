# Three-Format Content Workers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make content-proposal, card-news, blog, reel, and image workers consume the canonical contracts; route purpose inside each format planner; remove every active marketing/V1 branch; and emit only `ai-content.v3` Studio manifests.

**Architecture:** The contract package—not worker-runtime or worker-local JSON—is the contract authority. Card-news, blog, and reel are V3-only planning workers. Each chooses one explicit informational/marketing prompt block and always invokes `gpt-5.6-terra`. Image-worker remains the shared built-in image/render/finalization service and preserves the separate Instagram Story/Reel delivery namespace.

**Tech Stack:** TypeScript, Vitest, Codex CLI, `gpt-5.6-terra`, built-in `gpt-image-2`, FFmpeg/ffprobe, Docker.

**Scope rule:** Run only content-proposal, card-news, blog, reel, image-worker, canonical-contract, and directly related API tests. Never start or test DM, Wiki, FAQ, profile, customer-support, brand-intelligence, or subject-analysis workers.

---

## Task 1: Prepare worker-runtime for consumer-first contract extraction

**Files:**

- Modify: `workers/brand-pilot-worker-runtime/package.json`
- Modify: `workers/brand-pilot-worker-runtime/src/controlledSearch.ts`
- Modify: `workers/brand-pilot-worker-runtime/src/controlledSearch.test.ts`
- Modify: `package-lock.json`

- [ ] **Step 1: Write a RED direct-import test**

Require `controlledSearch.ts` to import `ContentPurpose` and `ResearchEvidenceSnapshotV1` directly from `@brand-pilot/content-contracts`, with the current controlled-search behavior unchanged. Do not delete the temporary `aiContentV3.ts` façade yet: Tasks 2–6 still have live consumers, and deleting it now makes this task's build fail.

- [ ] **Step 2: Prove RED**

```powershell
npm test --workspace @brand-pilot/worker-runtime -- src/controlledSearch.test.ts
```

- [ ] **Step 3: Add the direct dependency and run GREEN**

Add canonical-contract `pretest` and `prebuild` lifecycle steps while preserving existing scripts, so clean-checkout tests/builds create the ignored canonical `dist/` first. The final façade deletion and all-worker direct-dependency assertion occur only in Task 7 after every consumer has migrated.

```powershell
npm install
npm test --workspace @brand-pilot/worker-runtime -- src/controlledSearch.test.ts
npm run build --workspace @brand-pilot/worker-runtime
git add workers/brand-pilot-worker-runtime/package.json workers/brand-pilot-worker-runtime/src/controlledSearch.ts workers/brand-pilot-worker-runtime/src/controlledSearch.test.ts package-lock.json
git commit -m "refactor(runtime): import controlled search contracts directly"
```

## Task 2: Make content-proposal-worker Proposal V2-only

**Files:**

- Modify: `workers/brand-pilot-content-proposal-worker/package.json`
- Modify: `workers/brand-pilot-content-proposal-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/contracts.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/worker.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/client.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/client.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/research.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/research.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/codexModel.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/codexModel.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/Dockerfile`
- Modify: `package-lock.json`

- [ ] **Step 1: Write RED protocol and schema-resolution tests**

Reject V1 jobs/results, absent `contractVersion`, retired formats, malformed proposals, any local output schema, or claim/audit drift. Client/worker tests distinguish a research lease from a model-invocation attempt: `research_required` has a research-attempt identity but no composed hash, model-attempt number, invocation ordinal, or call budget; `composition_ready` has the immutable model-attempt identity and all request/base/composed/output versions, proposal prompt, model, command descriptor, output-schema/composed-input/catalog/source/aggregate hashes. Reject any stage/hash mismatch before spawning Codex. Assert research crash/reclaim consumes zero model calls, one model repair call only after parser-invalid ordinal 1, and final canonical semantic parsing.

- [ ] **Step 2: Prove RED**

```powershell
npm test --workspace @brand-pilot/content-proposal-worker -- src/contracts.test.ts src/codexModel.test.ts src/promptBuilder.test.ts src/worker.test.ts src/client.test.ts
```

- [ ] **Step 3: Resolve the canonical Proposal V2 schema**

```ts
const proposalSchema = fileURLToPath(import.meta.resolve(
  "@brand-pilot/content-contracts/generated/content-proposal-v2.schema.json",
));
```

Pass it with `--output-schema`; keep controlled proposal research but directly import only the canonical `parseContentProposalRequestV2`, `parseProposalBaseInputSnapshotV2`, `parseProposalInputSnapshotV2`, `parseResearchEvidenceSnapshotV1`, and `parseContentProposalSetV2` boundaries/types. Delete worker-local duplicates rather than aliasing them. The V2-only claim DTO is a closed discriminator union. On `research_required`, it carries the immutable enqueue contract and research lease only; the worker performs the approved controlled search, submits canonical evidence to the authenticated research-complete boundary, and terminates/releases that research lease. The API atomically seals the exclusive composition and returns the persisted job to `queued`; it does not hand an impossible model-attempt header back across the research lease. A separate claim derives the `composition_ready` DTO only when that exclusive composition exists, and atomically creates/returns the immutable model-attempt header plus server-composed payload/final aggregate hash. Queued jobs without a composition remain research-claimable; queued jobs with one cannot re-enter research. The worker never constructs or hashes ProposalInput V2 itself. A research completion or composition race/replay returns the identical sealed row; mismatch stops before the model. Tests crash/reclaim before and after research submission and prove no model attempt/cost is consumed until the separate composition-ready claim.

Before each Codex spawn, the worker calls the authenticated invocation-start boundary with the same lease token and explicit ordinal; the API append-only event records `invocation_started` and verified aggregate contract hash. The worker heartbeats that attempt, then records the invocation terminal event with the same lease token and model/command/schema/composed/aggregate hashes plus transcript/output/parser hashes. Ordinal 1 is the initial call. Ordinal 2 is the one repair call and is authorized only after ordinal 1 completed with parser-invalid output under the same contract; a third call or repair after an indeterminate call is forbidden. A definitely pre-start lease failure may requeue without consuming a call. After `invocation_started`, crash/lease expiry/unknown external outcome appends or is reconciled as `invocation_indeterminate`, moves the API job/batch to terminal `manual_review_required`, and makes it non-claimable; this worker can never reclaim or spawn again for that job. Any user-approved retry is a new operation/job/budget. Final successful/definite-failure completion appends the attempt terminal event. Tests inject lease loss/crash before and after each start/spawn/output/event/complete, proving at-most one call per ordinal, at most two calls per definite parser-invalid attempt, post-start claim/spawn count zero, stale-token zero mutation, exact replay, and no unaudited repair.

Add canonical-contract `pretest` and `prebuild` lifecycle steps to this worker package before running its tests/build; do not rely on a previously generated ignored `dist/` directory.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm install
npm test --workspace @brand-pilot/content-proposal-worker
npm run build --workspace @brand-pilot/content-proposal-worker
git add -- workers/brand-pilot-content-proposal-worker/package.json workers/brand-pilot-content-proposal-worker/src/contracts.ts workers/brand-pilot-content-proposal-worker/src/contracts.test.ts workers/brand-pilot-content-proposal-worker/src/promptBuilder.ts workers/brand-pilot-content-proposal-worker/src/promptBuilder.test.ts workers/brand-pilot-content-proposal-worker/src/worker.ts workers/brand-pilot-content-proposal-worker/src/worker.test.ts workers/brand-pilot-content-proposal-worker/src/client.ts workers/brand-pilot-content-proposal-worker/src/client.test.ts workers/brand-pilot-content-proposal-worker/src/research.ts workers/brand-pilot-content-proposal-worker/src/research.test.ts workers/brand-pilot-content-proposal-worker/src/codexModel.ts workers/brand-pilot-content-proposal-worker/src/codexModel.test.ts workers/brand-pilot-content-proposal-worker/Dockerfile package-lock.json
git commit -m "refactor(proposal-worker): remove proposal v1 runtime"
```

## Task 3: Make card-news a V3-only, purpose-routed planner

**Required sub-skill for this task:** Read and use `superpowers:writing-skills` before changing the card-news worker skill.

**Files:**

- Delete: `workers/brand-pilot-card-news-worker/src/storage.ts`
- Delete: `workers/brand-pilot-card-news-worker/src/manifest.ts`
- Delete: `workers/brand-pilot-card-news-worker/src/manifest.test.ts`
- Delete: `workers/brand-pilot-card-news-worker/src/editorialPlan.ts`
- Delete: `workers/brand-pilot-card-news-worker/src/editorialPlan.test.ts`
- Delete: `workers/brand-pilot-card-news-worker/scripts/run-codex-card-news.mjs`
- Delete: `workers/brand-pilot-card-news-worker/scripts/run-codex-card-news-plan.mjs`
- Delete: `workers/brand-pilot-card-news-worker/scripts/editorial-plan.schema.json`
- Delete: `workers/brand-pilot-card-news-worker/scripts/card-news-plan-v2.schema.json`
- Modify: `workers/brand-pilot-card-news-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/contracts.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/worker.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/client.ts`
- Create: `workers/brand-pilot-card-news-worker/src/client.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/index.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/productionRuntime.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/scripts/run-codex-card-news-v2-plan.mjs`
- Modify: `workers/brand-pilot-card-news-worker/package.json`
- Modify: `workers/brand-pilot-card-news-worker/.env.example`
- Modify: `workers/brand-pilot-card-news-worker/README.md`
- Modify: `workers/brand-pilot-card-news-worker/.agents/skills/card-news-creator/SKILL.md`
- Modify: `workers/brand-pilot-card-news-worker/Dockerfile`
- Modify: `package-lock.json`

- [ ] **Step 1: Write RED two-cell prompt-isolation tests for card-news**

Use unique markers for the two card-news purpose cells and four independent card-news format-policy markers. Assert selected purpose marker present, opposite marker absent, all format markers present, frozen evidence/product invariant, `outputFormat = card_news`, canonical binding, and `--model gpt-5.6-terra` before `exec`. The informational card-news block must explicitly require education/problem solving/comparison/checklist/Q&A/useful insight, frozen evidence for factual or time-sensitive claims, only save/share/question CTAs, and preservation of limitations/evidence gaps; it must explicitly prohibit product promotion, purchase pressure, sales claims, and purchase CTAs. The marketing card-news block must use only approved product facts, connect a verified strength to the target/situation/barrier/campaign objective, retain limitations/barriers, and may use a conversion CTA; it must explicitly prohibit invented price, performance, testimonial, urgency, discount, or guarantee claims. Independently of purpose, card-news must own and test (1) explicit cover/body/closing slide hierarchy, (2) a square `1:1` package/asset structure, (3) bounded mobile-readable per-slide copy density, and (4) a separate caption rule that does not duplicate every slide verbatim. Card-news owns all of this prose rather than importing a generic shared marketing or format policy.

Run the focused command now and record the expected prompt-marker/model RED before implementation:

```powershell
npm test --workspace @brand-pilot/card-news-worker -- src/contracts.test.ts src/promptBuilder.test.ts src/worker.test.ts src/productionRuntime.test.ts src/client.test.ts
```

- [ ] **Step 2: Remove analyze/V2/render/storage paths and implement the purpose switch**

```ts
function selectPurposeRules(purpose: ContentPurpose): readonly string[] {
  switch (purpose) {
    case "informational": return CARD_NEWS_INFORMATIONAL_RULES;
    case "marketing": return CARD_NEWS_MARKETING_RULES;
  }
}
```

The planner returns only `card-news-plan.v2`; its parser enforces the slide hierarchy, square package, copy-density, and caption structure before image execution. Image generation/storage/finalization belongs to image-worker. Add canonical-contract `pretest`/`prebuild` lifecycle steps to the package.

- [ ] **Step 3: Run GREEN and commit**

```powershell
npm install
npm test --workspace @brand-pilot/card-news-worker -- src/contracts.test.ts src/promptBuilder.test.ts src/worker.test.ts src/productionRuntime.test.ts src/client.test.ts
npm run build --workspace @brand-pilot/card-news-worker
git add -- workers/brand-pilot-card-news-worker/src/storage.ts workers/brand-pilot-card-news-worker/src/manifest.ts workers/brand-pilot-card-news-worker/src/manifest.test.ts workers/brand-pilot-card-news-worker/src/editorialPlan.ts workers/brand-pilot-card-news-worker/src/editorialPlan.test.ts workers/brand-pilot-card-news-worker/scripts/run-codex-card-news.mjs workers/brand-pilot-card-news-worker/scripts/run-codex-card-news-plan.mjs workers/brand-pilot-card-news-worker/scripts/editorial-plan.schema.json workers/brand-pilot-card-news-worker/scripts/card-news-plan-v2.schema.json workers/brand-pilot-card-news-worker/src/contracts.ts workers/brand-pilot-card-news-worker/src/contracts.test.ts workers/brand-pilot-card-news-worker/src/worker.ts workers/brand-pilot-card-news-worker/src/worker.test.ts workers/brand-pilot-card-news-worker/src/promptBuilder.ts workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts workers/brand-pilot-card-news-worker/src/client.ts workers/brand-pilot-card-news-worker/src/client.test.ts workers/brand-pilot-card-news-worker/src/index.ts workers/brand-pilot-card-news-worker/src/productionRuntime.test.ts workers/brand-pilot-card-news-worker/scripts/run-codex-card-news-v2-plan.mjs workers/brand-pilot-card-news-worker/package.json workers/brand-pilot-card-news-worker/.env.example workers/brand-pilot-card-news-worker/README.md workers/brand-pilot-card-news-worker/.agents/skills/card-news-creator/SKILL.md workers/brand-pilot-card-news-worker/Dockerfile package-lock.json
git commit -m "refactor(card-news): make planner v3 only and purpose routed"
```

## Task 4: Make blog a V3-only, purpose-routed planner

**Required sub-skill for this task:** Read and use `superpowers:writing-skills` before changing the blog worker skill.

**Files:**

- Delete: `workers/brand-pilot-blog-worker/src/storage.ts`
- Delete: `workers/brand-pilot-blog-worker/src/storage.test.ts`
- Delete: `workers/brand-pilot-blog-worker/src/manifest.ts`
- Delete: `workers/brand-pilot-blog-worker/src/manifest.test.ts`
- Delete: `workers/brand-pilot-blog-worker/src/research.ts`
- Delete: `workers/brand-pilot-blog-worker/src/research.test.ts`
- Delete: `workers/brand-pilot-blog-worker/scripts/run-codex-blog.mjs`
- Delete: `workers/brand-pilot-blog-worker/scripts/blog-plan-v2.schema.json`
- Modify: `workers/brand-pilot-blog-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-blog-worker/src/contracts.test.ts`
- Modify: `workers/brand-pilot-blog-worker/src/worker.ts`
- Modify: `workers/brand-pilot-blog-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-blog-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-blog-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-blog-worker/src/client.ts`
- Create: `workers/brand-pilot-blog-worker/src/client.test.ts`
- Modify: `workers/brand-pilot-blog-worker/src/index.ts`
- Modify: `workers/brand-pilot-blog-worker/src/productionRuntime.test.ts`
- Modify: `workers/brand-pilot-blog-worker/scripts/run-codex-blog-v2-plan.mjs`
- Modify: `workers/brand-pilot-blog-worker/package.json`
- Modify: `workers/brand-pilot-blog-worker/.env.example`
- Modify: `workers/brand-pilot-blog-worker/README.md`
- Modify: `workers/brand-pilot-blog-worker/.agents/skills/blog-writer/SKILL.md`
- Modify: `workers/brand-pilot-blog-worker/Dockerfile`
- Modify: `package-lock.json`

- [ ] **Step 1: Preserve the pre-existing schema/runtime test intent before deletion**

Inspect the dirty diff. Move its no-`oneOf`, no-`uniqueItems`, and typed-`const` assertions to the Phase 1 canonical artifact tests before deleting `scripts/blog-plan-v2.schema.json`; retain equivalent production-runtime coverage. Never overwrite or discard the existing edit.

- [ ] **Step 2: Write RED purpose/model tests and implement**

Blog owns separate informational and marketing prose plus search intent, semantic HTML, evidence links, metadata, inline-image necessity, and readability. Its informational block explicitly requires education/problem solving/comparison/checklist/Q&A/useful insight, frozen evidence for factual or time-sensitive claims, only save/share/question CTAs, and preservation of limitations/evidence gaps; it explicitly prohibits product promotion, purchase pressure, sales claims, and purchase CTAs. Its marketing block uses only approved product facts, connects a verified strength to the target/situation/barrier/campaign objective, retains limitations/barriers, allows a conversion CTA, and explicitly prohibits invented price, performance, testimonial, urgency, discount, or guarantee claims. Blog owns this prose independently of card-news/reel. Remove supplemental live research; inputs are already frozen. Keep `htmlValidator.ts` and its tests. Resolve canonical `blog-plan-v2.schema.json`, add explicit `--model gpt-5.6-terra` before `exec`, and add canonical-contract `pretest`/`prebuild` lifecycle steps.

Run the focused command before implementation and record the expected purpose/model RED:

```powershell
npm test --workspace @brand-pilot/blog-worker -- src/contracts.test.ts src/promptBuilder.test.ts src/worker.test.ts src/productionRuntime.test.ts src/htmlValidator.test.ts src/client.test.ts
```

- [ ] **Step 3: Run GREEN and commit**

```powershell
npm install
npm test --workspace @brand-pilot/blog-worker -- src/contracts.test.ts src/promptBuilder.test.ts src/worker.test.ts src/productionRuntime.test.ts src/htmlValidator.test.ts src/client.test.ts
npm run build --workspace @brand-pilot/blog-worker
git add -- workers/brand-pilot-blog-worker/src/storage.ts workers/brand-pilot-blog-worker/src/storage.test.ts workers/brand-pilot-blog-worker/src/manifest.ts workers/brand-pilot-blog-worker/src/manifest.test.ts workers/brand-pilot-blog-worker/src/research.ts workers/brand-pilot-blog-worker/src/research.test.ts workers/brand-pilot-blog-worker/scripts/run-codex-blog.mjs workers/brand-pilot-blog-worker/scripts/blog-plan-v2.schema.json workers/brand-pilot-blog-worker/src/contracts.ts workers/brand-pilot-blog-worker/src/contracts.test.ts workers/brand-pilot-blog-worker/src/worker.ts workers/brand-pilot-blog-worker/src/worker.test.ts workers/brand-pilot-blog-worker/src/promptBuilder.ts workers/brand-pilot-blog-worker/src/promptBuilder.test.ts workers/brand-pilot-blog-worker/src/client.ts workers/brand-pilot-blog-worker/src/client.test.ts workers/brand-pilot-blog-worker/src/index.ts workers/brand-pilot-blog-worker/src/productionRuntime.test.ts workers/brand-pilot-blog-worker/scripts/run-codex-blog-v2-plan.mjs workers/brand-pilot-blog-worker/package.json workers/brand-pilot-blog-worker/.env.example workers/brand-pilot-blog-worker/README.md workers/brand-pilot-blog-worker/.agents/skills/blog-writer/SKILL.md workers/brand-pilot-blog-worker/Dockerfile package-lock.json
git commit -m "refactor(blog): make planner v3 only and purpose routed"
```

## Task 5: Replace marketing-worker with reel-worker—without an alias

**Required sub-skill for this task:** Read and use `superpowers:writing-skills` before modifying the renamed worker's `SKILL.md`.

**Files:**

- Rename: `workers/brand-pilot-marketing-worker` → `workers/brand-pilot-reel-worker`
- Rename: `workers/brand-pilot-reel-worker/.agents/skills/marketing-creative/SKILL.md` → `workers/brand-pilot-reel-worker/.agents/skills/reel-planner/SKILL.md`
- Rename: `workers/brand-pilot-reel-worker/scripts/run-codex-marketing-v2-plan.mjs` → `workers/brand-pilot-reel-worker/scripts/run-codex-reel-v2-plan.mjs`
- Delete: `workers/brand-pilot-reel-worker/src/storage.ts`
- Delete: `workers/brand-pilot-reel-worker/src/storage.test.ts`
- Delete: `workers/brand-pilot-reel-worker/src/manifest.ts`
- Delete: `workers/brand-pilot-reel-worker/src/manifest.test.ts`
- Delete: `workers/brand-pilot-reel-worker/scripts/run-codex-marketing.mjs`
- Delete: `workers/brand-pilot-reel-worker/scripts/marketing-plan-v2.schema.json`
- Modify: `workers/brand-pilot-reel-worker/package.json`
- Modify: `workers/brand-pilot-reel-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-reel-worker/src/contracts.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/worker.ts`
- Modify: `workers/brand-pilot-reel-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-reel-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/client.ts`
- Create: `workers/brand-pilot-reel-worker/src/client.test.ts`
- Create: `workers/brand-pilot-reel-worker/src/reelCutover.contract.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/resourceLease.ts`
- Modify: `workers/brand-pilot-reel-worker/src/index.ts`
- Modify: `workers/brand-pilot-reel-worker/src/productionRuntime.test.ts`
- Modify: `workers/brand-pilot-reel-worker/.env.example`
- Modify: `workers/brand-pilot-reel-worker/README.md`
- Modify: `workers/brand-pilot-reel-worker/Dockerfile`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Preserve the dirty marketing schema/runtime assertions**

Move their typed-`const`/provider-schema intent into canonical reel schema tests and equivalent reel production-runtime tests. Then remove the local schema; do not keep commented-out code.

- [ ] **Step 2: Perform the mechanical rename, then write RED narrowing tests**

First record the exact dirty-file diff/hashes and build one HEAD-to-final manifest from `git ls-files workers/brand-pilot-marketing-worker`: every old tracked path is a deletion; retained files are additions under the reel prefix; the skill and runner have explicit final-path overrides; planned removals have no destination; and both new tests are explicit additions. Seal the path map and expected destination hashes before the first move. Then perform the one outer directory move plus the two exact nested file moves and change the moved package name to `@brand-pilot/reel-worker`; run `npm install --ignore-scripts` so npm recognizes the renamed workspace. Do not alter behavior or delete the preserved dirty assertions yet. Before commit, mechanically compare `git diff --cached --no-renames --name-status` with that single HEAD-to-final manifest plus root package/lock modifications and abort on any missing old path, missing final path, hash mismatch, intermediate path, or extra file.

```powershell
git mv workers/brand-pilot-marketing-worker workers/brand-pilot-reel-worker
New-Item -ItemType Directory -Force workers/brand-pilot-reel-worker/.agents/skills/reel-planner | Out-Null
git mv workers/brand-pilot-reel-worker/.agents/skills/marketing-creative/SKILL.md workers/brand-pilot-reel-worker/.agents/skills/reel-planner/SKILL.md
git mv workers/brand-pilot-reel-worker/scripts/run-codex-marketing-v2-plan.mjs workers/brand-pilot-reel-worker/scripts/run-codex-reel-v2-plan.mjs
npm install --ignore-scripts
```

Create `reelCutover.contract.test.ts` and `client.test.ts` under the moved directory. The cutover test statically checks the active renamed package/source/Dockerfile/skill/runner and the client test uses fake fetch only; neither starts a worker or model. Require `@brand-pilot/reel-worker`, default ID `reel-worker-1`, `REEL_*`, only `reel-plan.v2`, only the `reel` claim, and `gpt-5.6-terra`. It must find behavioral RED from old names/branches—not a missing-workspace error:

```powershell
npm test --workspace @brand-pilot/reel-worker -- src/reelCutover.contract.test.ts src/client.test.ts
```

Expected: FAIL on still-active `Marketing*`, `marketing-plan.v2`, `MARKETING_WORKER_*`, `MARKETING_CODEX_*`, old package/worker/runner/skill names, or non-reel contract behavior. The valid purpose `marketing` and reel-owned policy identifiers such as `REEL_MARKETING_RULES` must pass; rejection-fixture literals alone are allowed only in explicitly named fixture objects. Add both positive and negative static-scan fixtures so the retired namespace guard cannot reject the approved purpose policy.

- [ ] **Step 3: Implement reel-only contracts and prompt policies**

Reel owns 9:16 scenes, hook-to-payoff sequence, per-scene copy, caption, hashtags, and CTA. Its informational block explicitly requires education/problem solving/comparison/checklist/Q&A/useful insight, frozen evidence for factual or time-sensitive claims, only save/share/question CTAs, and preservation of limitations/evidence gaps; it explicitly prohibits product promotion, purchase pressure, sales claims, and purchase CTAs. Its marketing block uses only approved product facts, connects a verified strength to the target/situation/barrier/campaign objective, retains limitations/barriers, allows a conversion CTA, and explicitly prohibits invented price, performance, testimonial, urgency, discount, or guarantee claims. Reel owns this prose independently of card-news/blog. Purpose never changes queue or model. Add canonical-contract `pretest`/`prebuild` lifecycle steps. Before GREEN, run a scoped active-source absence scan only for retired runtime namespaces/symbols: `Marketing[A-Z]|marketing_plan_invalid|codex_marketing_|marketing_worker_failed|marketing-plan\.json|MARKETING_WORKER_|MARKETING_CODEX_|@brand-pilot/marketing-worker|brand-pilot-marketing-worker|run-codex-marketing`; valid purpose-policy identifiers are not banned.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm install
$legacyReelRuntimeHits = rg -n "Marketing[A-Z]|marketing_plan_invalid|codex_marketing_|marketing_worker_failed|marketing-plan\.json|MARKETING_WORKER_|MARKETING_CODEX_|@brand-pilot/marketing-worker|brand-pilot-marketing-worker|run-codex-marketing" workers/brand-pilot-reel-worker/src workers/brand-pilot-reel-worker/scripts workers/brand-pilot-reel-worker/package.json workers/brand-pilot-reel-worker/.env.example
if ($LASTEXITCODE -eq 0) { throw "retired_marketing_runtime_identifier_found`n$legacyReelRuntimeHits" }
if ($LASTEXITCODE -ne 1) { throw "retired_marketing_runtime_scan_failed" }
npm test --workspace @brand-pilot/reel-worker -- src/reelCutover.contract.test.ts src/contracts.test.ts src/promptBuilder.test.ts src/worker.test.ts src/productionRuntime.test.ts src/client.test.ts
npm run build --workspace @brand-pilot/reel-worker
git add -- workers/brand-pilot-reel-worker/.agents/skills/reel-planner/SKILL.md workers/brand-pilot-reel-worker/scripts/run-codex-reel-v2-plan.mjs workers/brand-pilot-reel-worker/src/storage.ts workers/brand-pilot-reel-worker/src/storage.test.ts workers/brand-pilot-reel-worker/src/manifest.ts workers/brand-pilot-reel-worker/src/manifest.test.ts workers/brand-pilot-reel-worker/scripts/run-codex-marketing.mjs workers/brand-pilot-reel-worker/scripts/marketing-plan-v2.schema.json workers/brand-pilot-reel-worker/package.json workers/brand-pilot-reel-worker/src/contracts.ts workers/brand-pilot-reel-worker/src/contracts.test.ts workers/brand-pilot-reel-worker/src/worker.ts workers/brand-pilot-reel-worker/src/worker.test.ts workers/brand-pilot-reel-worker/src/promptBuilder.ts workers/brand-pilot-reel-worker/src/promptBuilder.test.ts workers/brand-pilot-reel-worker/src/client.ts workers/brand-pilot-reel-worker/src/client.test.ts workers/brand-pilot-reel-worker/src/reelCutover.contract.test.ts workers/brand-pilot-reel-worker/src/resourceLease.ts workers/brand-pilot-reel-worker/src/index.ts workers/brand-pilot-reel-worker/src/productionRuntime.test.ts workers/brand-pilot-reel-worker/.env.example workers/brand-pilot-reel-worker/README.md workers/brand-pilot-reel-worker/Dockerfile package.json package-lock.json
git diff --cached --no-renames --name-status
git commit -m "refactor(reel): replace marketing worker with reel planner"
```

## Task 6: Emit and validate exact `ai-content.v3` Studio manifests

**Files:**

- Modify: `workers/brand-pilot-image-worker/package.json`
- Modify: `workers/brand-pilot-image-worker/src/aiContentRenderClient.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentRenderClient.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentAssetPrompt.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentAssetPrompt.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentAssetRenderer.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentAssetRenderer.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentFinalizer.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentFinalizer.test.ts`
- Create: `workers/brand-pilot-image-worker/src/aiContentStudioManifest.ts`
- Create: `workers/brand-pilot-image-worker/src/aiContentStudioManifest.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/manifest.ts`
- Modify: `workers/brand-pilot-image-worker/src/manifest.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/productionRuntime.test.ts`
- Modify: `workers/brand-pilot-image-worker/Dockerfile`
- Modify: `package-lock.json`

- [ ] **Step 1: Re-read `workers/brand-pilot-image-worker/AGENTS.md`**

This task must continue using built-in image generation and must not add an external image API or `OPENAI_API_KEY`.

- [ ] **Step 2: Write RED Studio/delivery namespace tests**

Card/blog/reel manifests use `version: "ai-content.v3"`, `outputFormat`, frozen purpose, title/assets/content, and no `type`. Reject an added `type`, `marketing_content`, wrong plan version, purpose mismatch, package mismatch, or asset-count mismatch before child/render execution. Assert the built-in image model remains exactly `gpt-image-2` in all six Studio cells and no external image API/credential path is introduced.

Keep delivery parser fixtures for `instagram_story`, `instagram_reel`, `worker-story.v1`, and `worker-reel.v3` unchanged. Keep `reelRenderer`/FFmpeg/ffprobe behavior.

Run the focused tests now and record the expected V3/model/binding RED before implementation:

```powershell
npm test --workspace @brand-pilot/image-worker -- src/aiContentFinalizer.test.ts src/aiContentStudioManifest.test.ts src/aiContentAssetPrompt.test.ts src/aiContentAssetRenderer.test.ts src/aiContentRenderClient.test.ts src/manifest.test.ts src/reelRenderer.test.ts src/productionRuntime.test.ts
```

- [ ] **Step 3: Implement exhaustive Studio finalization**

Parse the format-specific canonical plan, validate plan/input/package/manifest binding, use an exhaustive asset switch, and upload the exact V3 manifest. Add canonical-contract `pretest`/`prebuild` lifecycle steps to image-worker. Do not globally replace the word `reel` or alter trend-media classification.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm install
npm test --workspace @brand-pilot/image-worker -- src/aiContentFinalizer.test.ts src/aiContentStudioManifest.test.ts src/aiContentAssetPrompt.test.ts src/aiContentAssetRenderer.test.ts src/aiContentRenderClient.test.ts src/manifest.test.ts src/reelRenderer.test.ts src/productionRuntime.test.ts
npm test --workspace @brand-pilot/api -- src/repository.imageWorker.test.ts src/channelCatalog.test.ts src/channelCapabilities.test.ts
npm run build --workspace @brand-pilot/image-worker
git add -- workers/brand-pilot-image-worker/package.json workers/brand-pilot-image-worker/src/aiContentRenderClient.ts workers/brand-pilot-image-worker/src/aiContentRenderClient.test.ts workers/brand-pilot-image-worker/src/aiContentAssetPrompt.ts workers/brand-pilot-image-worker/src/aiContentAssetPrompt.test.ts workers/brand-pilot-image-worker/src/aiContentAssetRenderer.ts workers/brand-pilot-image-worker/src/aiContentAssetRenderer.test.ts workers/brand-pilot-image-worker/src/aiContentFinalizer.ts workers/brand-pilot-image-worker/src/aiContentFinalizer.test.ts workers/brand-pilot-image-worker/src/aiContentStudioManifest.ts workers/brand-pilot-image-worker/src/aiContentStudioManifest.test.ts workers/brand-pilot-image-worker/src/manifest.ts workers/brand-pilot-image-worker/src/manifest.test.ts workers/brand-pilot-image-worker/src/productionRuntime.test.ts workers/brand-pilot-image-worker/Dockerfile package-lock.json
git commit -m "feat(image-worker): emit and validate ai-content v3"
```

## Task 7: Remove the temporary façade and put canonical contracts in every runtime

**Files:**

- Modify: `apps/api/Dockerfile`
- Modify: `apps/api/package.json`
- Modify: `apps/customer-ui/package.json`
- Modify: `workers/brand-pilot-content-proposal-worker/Dockerfile`
- Modify: `workers/brand-pilot-content-proposal-worker/package.json`
- Modify: `workers/brand-pilot-card-news-worker/Dockerfile`
- Modify: `workers/brand-pilot-card-news-worker/package.json`
- Modify: `workers/brand-pilot-blog-worker/Dockerfile`
- Modify: `workers/brand-pilot-blog-worker/package.json`
- Modify: `workers/brand-pilot-reel-worker/Dockerfile`
- Modify: `workers/brand-pilot-reel-worker/package.json`
- Modify: `workers/brand-pilot-image-worker/Dockerfile`
- Modify: `workers/brand-pilot-image-worker/package.json`
- Delete: `workers/brand-pilot-worker-runtime/src/aiContentV3.ts`
- Delete: `workers/brand-pilot-worker-runtime/src/aiContentV3.test.ts`
- Modify: `workers/brand-pilot-worker-runtime/src/index.ts`
- Modify: `workers/brand-pilot-worker-runtime/src/index.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/ai-content-contract.test.mjs`

- [ ] **Step 1: Write RED Docker/static ownership guards**

Expand the content-only guard from Phase 3 to the five content-worker roots, worker-runtime's contract boundary, and the affected content Dockerfiles only. Require package metadata, `dist`, and `generated` in every affected content image; reject worker-local plan schemas, local contract unions, retired values, format fallbacks, marketing package/scripts, and a consumer build before the canonical package build. Now that Tasks 2–6 migrated every consumer, require worker-runtime to export process/search/resource helpers but no content schema, union, parser, plan, manifest, or default, and require every API/UI/content worker to depend directly on `@brand-pilot/content-contracts`. Do not import or run the broad repository/CLI-only suites, which contain unrelated worker assertions.

Run the focused guard and record RED for the still-present façade, marketing path, local schemas, and missing Docker lifecycle guarantees:

```powershell
node --test scripts/ai-content-contract.test.mjs
```

- [ ] **Step 2: Update Docker build contexts and root scripts**

Delete `worker-runtime/src/aiContentV3.ts` and its tests/re-exports only now, then build worker-runtime to prove no consumer remains. Delete local schema `COPY` lines. Replace root marketing scripts with reel scripts. Add exact root script `"contracts:check": "npm run build --workspace @brand-pilot/content-contracts && npm run check:generated --workspace @brand-pilot/content-contracts"`; no later command relies on an undefined alias. Ensure API, UI, worker-runtime, and all five content-worker packages have lifecycle scripts that build canonical contracts before their own `test`/`build`, preserving any existing pretest behavior. Docker stages build the canonical workspace before consumers and copy its `dist` plus `generated`; clean-checkout CI must not depend on ignored artifacts. Deployment/Compose/env/release keys remain Phase 5 work and may not be left runnable under both names.

- [ ] **Step 3: Run GREEN and spot-check content images only**

```powershell
npm run contracts:check
node --test scripts/ai-content-contract.test.mjs
npm run build --workspace @brand-pilot/content-contracts
npm test --workspace @brand-pilot/worker-runtime -- src/controlledSearch.test.ts src/index.test.ts
npm run build --workspace @brand-pilot/worker-runtime
npm run build --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/content-proposal-worker
npm run build --workspace @brand-pilot/card-news-worker
npm run build --workspace @brand-pilot/blog-worker
npm run build --workspace @brand-pilot/reel-worker
npm run build --workspace @brand-pilot/image-worker
```

Build only the affected API/content-worker Dockerfiles. In each image assert the canonical catalog and required plan schema exist.

- [ ] **Step 4: Commit**

```powershell
git add -- apps/api/Dockerfile apps/api/package.json apps/customer-ui/package.json workers/brand-pilot-content-proposal-worker/Dockerfile workers/brand-pilot-content-proposal-worker/package.json workers/brand-pilot-card-news-worker/Dockerfile workers/brand-pilot-card-news-worker/package.json workers/brand-pilot-blog-worker/Dockerfile workers/brand-pilot-blog-worker/package.json workers/brand-pilot-reel-worker/Dockerfile workers/brand-pilot-reel-worker/package.json workers/brand-pilot-image-worker/Dockerfile workers/brand-pilot-image-worker/package.json workers/brand-pilot-worker-runtime/src/aiContentV3.ts workers/brand-pilot-worker-runtime/src/aiContentV3.test.ts workers/brand-pilot-worker-runtime/src/index.ts workers/brand-pilot-worker-runtime/src/index.test.ts package.json package-lock.json scripts/ai-content-contract.test.mjs
git commit -m "test(contracts): enforce worker contract ownership"
```

## Task 8: Run the deterministic content harness and prepare the one approved preflight gate

**Files:**

- Create: `scripts/ai-content-three-format-harness.mjs`
- Create: `scripts/ai-content-three-format-harness.test.mjs`
- Create: `scripts/ai-content-proposal-schema-preflight.mjs`
- Create: `scripts/ai-content-proposal-schema-preflight.test.mjs`
- Modify: `scripts/ai-content-smoke.mjs`
- Modify: `scripts/ai-content-subject-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write RED deterministic six-cell harness tests**

For every `{card_news|blog|reel} × {informational|marketing}` cell, one integrated fake-backed fixture must traverse the complete boundary chain without shortcuts:

```text
UI request → exact ContentOrchestrationV2 parser
→ common Proposal V2 service/frozen input → exactly three proposals
→ selected proposal → draft-only generation
→ atomic start (V3 + binding + reservation + first job)
→ exact format claim → selected purpose prompt
→ format plan parser → gpt-image-2 image package/render
→ exact ai-content.v3 manifest parser/result label
```

The test fixture uses the production adapters/repositories behind deterministic in-memory/PGlite ports, not six disconnected object parsers. Assert exact queue, selected marker present/opposite absent, product/evidence/selection invariants, final `outputCount=1`, plan-derived asset count matching image package/render/manifest, `gpt-5.6-terra`, literal prompt versions, plan version, `gpt-image-2`, reservation identity, image package, `ai-content.v3`, both Korean format and purpose labels (including failed-result UI), failure classification, retry binding, heartbeat/shutdown/lease-loss behavior, and no format fallback or delivery namespace regression. For the two known incident IDs, add reel-specific deterministic reproductions that fail under the captured old mapping and pass through reel-only routing after the change.

- [ ] **Step 2: Prove the harness RED**

```powershell
node --test scripts/ai-content-three-format-harness.test.mjs
```

Expected: the integrated production boundary wiring/harness entry point is absent or still reaches a legacy route.

- [ ] **Step 3: Implement the harness and repeat without real model calls**

Run each fixture 20 times, each adapter replay/concurrency scenario 20 times, and the targeted suite from three fresh processes. The harness uses deterministic fake runners and starts no unrelated worker.

Rewrite `scripts/ai-content-smoke.mjs` as a thin canonical three-format harness entry point with no V1 create path, legacy `type`, or marketing worker mapping. Narrow `scripts/ai-content-subject-smoke.mjs` to its independent subject-analysis smoke only: remove its legacy content-generation phase and all card/blog/marketing worker selection. Do not run that subject smoke in this cutover.

- [ ] **Step 4: Write and prove RED schema-only preflight tests without a model call**

The unit test uses a fake child process and proves `--execute-once` resolves the production content-proposal-worker command/model plus the exact generated Proposal V2 output schema. Its required identity is `{preflightCandidateSha, contentProposalWorkerImageDigest, contractSourceHash, catalogSha256, proposalSchemaSha256, proposalWorkerTreeSha, commandDescriptorSha256, model, callBudget: 1}`. `preflightCandidateSha` is the source candidate on which the single call is authorized; reviewed descendant releases may reference this identity only under Phase 5's byte-identity reuse rule. The fixed ignored state root is `artifacts/ai-content-cutover/075_ai_content_three_format_cutover/proposal-v2-preflight/`. Every journal file is mode `0600`, created with `O_CREAT|O_EXCL`, fsynced, and followed by a parent-directory fsync; nothing is overwritten or deleted.

Run the fake-child test now and require RED before adding the preflight implementation:

```powershell
node --test scripts/ai-content-proposal-schema-preflight.test.mjs
```

Expected: the crash-safe preflight state machine/identity boundary does not yet exist. The fake child is the only child used here; no model is called.

- [ ] **Step 5: Implement and dry-test the schema-only preflight without a model call**

Use an append-only hash chain: `claim.json` (`claimed`) → `started.json` (`invocation_started`) → `completed.json` (`invocation_completed`, output/transcript hashes and canonical parser projection only) → `evidence.json` (`passed`) → `phase5-transfer.json` (`sealed`). Capture stdout/stderr in exclusive append-only transcript files without secrets. Create/fsync `started.json` before spawning the child. State is exact: no files=`unclaimed`; claim only=`claimed_incomplete`; started without a recoverable completed output=`invocation_indeterminate`; completed without evidence=`completed_unsealed`; valid evidence=`passed`; any order/hash drift=`corrupt`. Only `unclaimed` may invoke. `--finalize-existing` may parse a complete recorded transcript and append missing completed/evidence journals but cannot import or call the spawn adapter; indeterminate/corrupt state permanently blocks that candidate. `--verify-evidence` and `--export-phase5` are likewise model-incapable and recompute all hashes.

Because the external model side effect has no idempotency key, claim/start journaling proves at-most-one invocation attempt; only a valid `passed` chain proves exactly one completed model call. Never claim crash-recoverable exactly-once when state is indeterminate. Unit tests run two concurrent executes and inject crashes before/after every journal/output boundary; child-spawn count is at most one, finalize/export spawn count is zero, and model/schema/command/candidate drift fails closed. The completed projection is only `{contractVersion:"content-proposal.v2", proposalCount:3, parser:"passed"}` plus hashes/times. The gate creates no proposal, generation, DB row, image, HTML, or video. Do not invoke the real model in this task and do not add card/blog/reel preflight modes.

- [ ] **Step 6: Run GREEN and commit harnesses**

```powershell
node --test scripts/ai-content-three-format-harness.test.mjs scripts/ai-content-proposal-schema-preflight.test.mjs
git add scripts/ai-content-three-format-harness.mjs scripts/ai-content-three-format-harness.test.mjs scripts/ai-content-proposal-schema-preflight.mjs scripts/ai-content-proposal-schema-preflight.test.mjs scripts/ai-content-smoke.mjs scripts/ai-content-subject-smoke.mjs package.json
git commit -m "test(content): add three-format worker harness"
```

## Phase 4 verification

Run only:

```powershell
npm run contracts:check
npm test --workspace @brand-pilot/content-contracts
npm test --workspace @brand-pilot/content-proposal-worker
npm test --workspace @brand-pilot/card-news-worker
npm test --workspace @brand-pilot/blog-worker
npm test --workspace @brand-pilot/reel-worker
npm test --workspace @brand-pilot/image-worker -- src/aiContentFinalizer.test.ts src/aiContentStudioManifest.test.ts src/aiContentAssetPrompt.test.ts src/aiContentAssetRenderer.test.ts src/aiContentRenderClient.test.ts src/manifest.test.ts src/reelRenderer.test.ts src/productionRuntime.test.ts
node --test scripts/ai-content-three-format-harness.test.mjs
```

Do not run the real model in Phase 4. The one schema-only Proposal V2 invocation is deferred to Phase 5 Task 7, after the immutable candidate SHA, proposal-worker image digest, catalog hash, schema hash, worker tree hash, and command descriptor all exist. Phase 4 finishes only when the fake-child crash/recovery suite proves at-most-one attempt and fail-closed indeterminate handling. Production six-cell and migrated-writer canaries later make separately authorized content-generation model calls; they are not schema-only preflights and never enter this preflight call counter. Record that no unrelated worker was started or tested. This phase is not independently deployable.
