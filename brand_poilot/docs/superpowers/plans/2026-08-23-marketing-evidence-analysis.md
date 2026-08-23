# Marketing Evidence Analysis Implementation Plan

**Status:** Tasks 1-6 implemented and verified locally on 2026-08-23, including the isolated PostgreSQL 16 application-role migration check. Production-shaped one-off execution and deployment remain separately approval-gated.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the existing manual content pipeline while grounding marketing card-news and reel proposals/manuscripts in at least one researched Evidence item and preserving URL, text, and selected-reference subjects.

**Architecture:** Retain the current `Research -> Proposal -> Manuscript/Storyboard -> Render` contracts and storage. Make only internal prompt/context and validator changes: pass the already-frozen subject/reference/acquisition data into controlled research, require Evidence for non-blog marketing proposals, add marketing analysis instructions, and apply matching CTA/Evidence guards to Card Manuscript and Reel Storyboard. Migration 087 only extends the operating immutable prompt-lineage CHECK with the exact v3 tuple; it does not change columns, rows, permissions, public API shapes, image worker inputs, visual selections, blog behavior, or historical execution paths.

**Tech Stack:** TypeScript, Vitest, TypeBox contracts, existing Codex controlled-search runner.

---

### Task 1: Preserve all subject forms in controlled Research

**Files:**
- Modify: `workers/brand-pilot-worker-runtime/src/controlledSearch.ts`
- Test: `workers/brand-pilot-worker-runtime/src/controlledSearch.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/research.ts`
- Test: `workers/brand-pilot-content-proposal-worker/src/research.test.ts`

- [x] **Step 1: Write failing tests for selected-reference content and one required marketing search**

Add tests proving that:

```ts
expect(searchInput.publicResearchContext.subjectReferences).toEqual([
  { title: "선택 레퍼런스", sourceUrl: "https://example.com/reference", text: "동결된 레퍼런스 본문" },
]);
expect(searchInput.mode).toBe("required");
```

The required-mode runtime test must verify one search-enabled child invocation and a non-empty `research-evidence.v1` result for `purpose="marketing"`.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm test --workspace @brand-pilot/worker-runtime -- --run src/controlledSearch.test.ts
npm test --workspace @brand-pilot/content-proposal-worker -- --run src/research.test.ts
```

Expected: failures because marketing `required` mode and `subjectReferences` are not accepted/passed.

- [x] **Step 3: Implement the minimal internal context projection**

Extend only the internal `PublicResearchContext` with a bounded optional `subjectReferences` value and validate it as untrusted public context:

```ts
subjectReferences?: Array<{ title: string; sourceUrl: string; text: string }>;
```

In `research.ts`, project only references selected by `subject.referenceIds` and choose mode without changing blog behavior:

```ts
mode: job.request.outputFormat === "blog" && job.request.purpose === "marketing"
  ? "automatic"
  : "required",
```

Allow `purpose="marketing", mode="required"` in controlled search. Do not remove the existing automatic mode; it remains available to unchanged blog callers. Preserve the current production rule that Proposal Research ignores server-collected body text and `researchSourceAcquisition`; the CLI reads topic URLs directly.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the two commands from Step 2. Expected: PASS.

### Task 2: Require grounded marketing Proposal input and improve analysis instructions

**Files:**
- Modify: `workers/brand-pilot-content-proposal-worker/src/contracts.ts`
- Test: `workers/brand-pilot-content-proposal-worker/src/contracts.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/promptBuilder.ts`
- Test: `workers/brand-pilot-content-proposal-worker/src/promptBuilder.test.ts`

- [x] **Step 1: Write failing tests for the Evidence floor and prompt invariants**

Add tests proving:

```ts
expect(() => parseContentProposalJob(marketingCardCompositionWithNoEvidence))
  .toThrow("content_proposal_job_invalid");
expect(() => parseContentProposalJob(marketingBlogCompositionWithNoEvidence))
  .not.toThrow();
```

The prompt test must require the marketing-only reasoning rules for subject/product separation, target, job-to-be-done, buying barrier, approved value, proof, limitation, and CTA, while the informational prompt must not receive marketing-specific rules.

- [x] **Step 2: Run focused tests and verify RED**

```powershell
npm test --workspace @brand-pilot/content-proposal-worker -- --run src/contracts.test.ts src/promptBuilder.test.ts
```

Expected: the non-blog marketing zero-Evidence job is still accepted and the new analysis instructions are absent.

- [x] **Step 3: Implement the minimal Evidence floor and marketing prompt rules**

In the existing input-binding check, require non-empty searched Evidence only for `card_news` and `reel` marketing composition inputs. Keep blog behavior unchanged.

Add prompt instructions inside the existing marketing branch only:

```text
subject, selected product snapshot, and Research Evidence have separate authority roles.
Assess same entity / explicitly related entities / unrelated or unclear entities without transferring facts.
Analyze subject situation -> concrete audience -> job -> buying barrier -> approved value -> proof -> limitation -> CTA.
Generate three materially distinct Proposals without fixing that reasoning order as slide order.
```

Do not add Proposal fields, model calls, fallbacks, or product facts from search.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

### Task 3: Ground Card Manuscript marketing scenes without changing its schema

**Files:**
- Modify: `packages/brand-pilot-content-contracts/src/cardManuscriptPlan.ts`
- Test: `packages/brand-pilot-content-contracts/src/cardManuscriptPlan.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/sourceBundle.ts`
- Test: `workers/brand-pilot-card-news-worker/src/sourceBundle.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`
- Test: `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`

- [x] **Step 1: Write failing tests for marketing CTA/Evidence guards and reference subjects**

Add tests proving a marketing manuscript is rejected when it has more than one CTA or lacks any Evidence-grounded non-CTA/transition scene, and accepted when it has one grounded editorial scene plus at most one CTA. Add a source-bundle test proving only subject-selected references are projected as full `title/sourceUrl/text` subject material.

- [x] **Step 2: Run focused tests and verify RED**

```powershell
npm test --workspace @brand-pilot/content-contracts -- --run src/cardManuscriptPlan.test.ts
npm test --workspace @brand-pilot/card-news-worker -- --run src/sourceBundle.test.ts src/promptBuilder.test.ts
```

Expected: current marketing manuscripts accept all-CTA/ungrounded outputs and the bundle lacks selected-reference subject material.

- [x] **Step 3: Add minimal validation and prompt rules**

For `purpose="marketing"`, enforce:

```ts
const ctaCount = scenes.filter((scene) => scene.editorialRole.toLowerCase() === "cta").length;
const groundedEditorialScene = scenes.some((scene) =>
  !["cta", "transition"].includes(scene.editorialRole.toLowerCase())
  && scene.evidenceIds.length > 0,
);
```

Reject when `ctaCount > 1` or `groundedEditorialScene` is false. Add prompt invariants requiring at least one approved-product factual/value point and one Subject/Evidence editorial point while keeping product and subject attribution separate. Preserve current visual-input projection unchanged.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the commands from Step 2. Expected: PASS.

### Task 4: Apply matching rules to Reel Storyboard

**Files:**
- Modify: `packages/brand-pilot-content-contracts/src/reelStoryboard.ts`
- Test: `packages/brand-pilot-content-contracts/src/reelStoryboard.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/promptBuilder.ts`
- Test: `workers/brand-pilot-reel-worker/src/promptBuilder.test.ts`

- [x] **Step 1: Write failing Reel parity tests**

Add Reel Storyboard v2 tests equivalent to Task 3 and prompt tests proving full selected-reference subject material, marketing source-role separation, product/Evidence grounding, and unchanged visual inputs.

- [x] **Step 2: Run focused tests and verify RED**

```powershell
npm test --workspace @brand-pilot/content-contracts -- --run src/reelStoryboard.test.ts
npm test --workspace @brand-pilot/reel-worker -- --run src/promptBuilder.test.ts
```

Expected: Reel accepts the invalid marketing scene patterns and lacks the new source-role rules.

- [x] **Step 3: Implement the same validator and prompt semantics**

Apply the exact Card marketing CTA/Evidence predicate to Reel Storyboard v2. Project reference-subject details from the existing frozen references and add the same marketing instructions without changing `reel-storyboard.v2`, scene shape, render session, or video assembly.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the commands from Step 2. Expected: PASS.

### Task 5: Version prompt behavior and run regression matrix

**Files:**
- Modify: `packages/brand-pilot-content-contracts/src/catalog.ts`
- Generated: `packages/brand-pilot-content-contracts/generated/content-catalog.json`
- Modify: `workers/brand-pilot-content-proposal-worker/src/contracts.ts` (expected catalog hash)
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-reel-worker/src/promptBuilder.ts`
- Update tests that assert the three prompt/skill versions.
- Modify: `docs/superpowers/specs/2026-08-23-marketing-evidence-analysis-design.md`

- [x] **Step 1: Write/update version assertions before changing versions**

Require new append-only identifiers:

```ts
CONTENT_PROPOSAL_PROMPT_VERSION === "proposal.writer.v3"
cardNewsPlanSkillVersion === "card-manuscript-plan-skill.v3"
reelPlanSkillVersion === "reel-storyboard-skill.v5"
```

- [x] **Step 2: Verify version tests fail**

Run focused catalog and worker tests. Expected: current v2/v2/v4 values fail.

- [x] **Step 3: Bump versions and regenerate canonical artifacts**

Update versions, run:

```powershell
npm run generate --workspace @brand-pilot/content-contracts
```

Update the proposal worker's pinned catalog SHA to the generated SHA. Update the design status to implemented locally, not deployed.

- [x] **Step 4: Run affected regression suites**

```powershell
npm test --workspace @brand-pilot/worker-runtime
npm test --workspace @brand-pilot/content-proposal-worker
npm test --workspace @brand-pilot/content-contracts
npm test --workspace @brand-pilot/card-news-worker
npm test --workspace @brand-pilot/reel-worker
npm test --workspace @brand-pilot/blog-worker
npm run build --workspace @brand-pilot/content-proposal-worker
npm run build --workspace @brand-pilot/card-news-worker
npm run build --workspace @brand-pilot/reel-worker
git diff --check
```

Expected: all pass; no UI, DB, image worker, publishing, or automatic-content files appear in the diff.

- [x] **Step 5: Review deployment impact without deploying**

Use the final diff to report the exact changed service images. Do not merge or deploy without a new user instruction.

### Task 6: Extend the operating immutable prompt lineage

**Files:**
- Create: `db/migrations/087_ai_content_prompt_lineage_v3.sql`
- Test: `apps/api/src/aiContentPromptVersionMigration087.postgres.integration.test.ts`
- Modify: migration/deployment manifest and contract tests

- [x] Confirm the operating PostgreSQL constraints still allow only the exact v2 prompt/source/catalog lineage.
- [x] Add an append-only v2-or-v3 exact-tuple CHECK without modifying historical rows or granting UPDATE.
- [x] Pin migration 087 in the ordered migration and deployment evidence manifests.
- [x] Run the migration and application-role INSERT fixture against PostgreSQL 16, then rerun the complete affected regression suite.
