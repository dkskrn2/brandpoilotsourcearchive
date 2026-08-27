# Proposal Editorial Strategy Auto-Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Proposal Worker automatically choose an appropriate expression method and emphasis angle for each Card/Reel proposal without adding user controls, output fields, validation calls, or a fixed scene formula.

**Architecture:** Add a versioned in-source editorial strategy catalog that compiles into the existing Proposal prompt. Keep `content-proposal.v2`, all field meanings, the model, reasoning level, repair allowance and parser unchanged; only advance the tracked prompt lineage to `proposal.writer.v5`. Preserve the already approved Card/Reel ON rules and marketing corrections verbatim around the new catalog block.

**Tech Stack:** TypeScript, Vitest, generated TypeBox contracts/catalog, PostgreSQL prompt-lineage migration, existing Codex Proposal Worker.

---

## Decision Coverage

| Current decision | Authoritative source | Plan disposition | Verification |
|---|---|---|---|
| Expression method and emphasis angle are not shown in setup UI | Approved conversation | Unchanged/excluded | Customer UI diff has no new controls or fields |
| Proposal Worker chooses both automatically | Approved conversation | Task 1 | prompt snapshot tests contain internal selection instruction |
| Worker may use a catalog method or free composition | Approved conversation | Task 1 | prompt includes an explicit free-composition fallback |
| Same method/angle may be reused across proposals | Approved conversation | Task 1 | prompt explicitly permits reuse and test rejects forced uniqueness wording |
| Content may not be identical or superficially similar | Approved conversation | Task 1 plus existing parser | prompt requires different starting question/evidence/message/progression/conclusion; existing fingerprint/axis tests remain |
| Do not add a verifier or validation procedure | Earlier explicit natural-copy decision and approved design | Excluded | model invocation count and parser source remain unchanged |
| Do not add proposal output fields | Earlier field-role concern and approved design | Excluded | generated `content-proposal.v2` schema hash changes only for lineage metadata, not proposal schema |
| Include informational Card/Reel and marketing Card/Reel | Approved scope | Task 1 and Task 4 | four fixture prompt/text cases |
| Blog behavior unchanged | Approved ON scope | Excluded | Blog prompt/worker files absent from diff |
| Preserve accepted ON first/middle/final, evidence, marketing and CTA rules | Approved ON implementation | Tasks 1 and 4 | exact rule assertions and operating-equivalent comparison |
| Keep model/reasoning/call/retry behavior | Approved ON implementation | Tasks 2–4 | command descriptor and invocation-count tests |

### Superseded or Excluded

- An `editorialStrategy` proposal field, UI badge, strategy DB column, separate classifier, similarity model, density gate and second-scene rule are excluded.
- Design-style analysis does not feed Proposal composition. It begins only after Proposal selection in the separate visual-preset plan.
- The current examples embedded directly in `promptBuilder.ts` are replaced by a named catalog block, but the existing editorial rules are not removed.

## Impact and Side-Effect Analysis

| Surface | Risk | Containment |
|---|---|---|
| Proposal JSON contract | New internal concepts could leak into output and fail parser | Reiterate exact existing field list and “내부적으로 선택하고 출력하지 말라”; schema unchanged test |
| Proposal diversity | Model could force all three methods to differ or merely rename the same content | Explicit reuse allowance plus substantive difference requirements; retain existing fingerprint/axis parser tests |
| Marketing grounding | Humor/empathy angle could invent customer facts or weaken evidence | Keep four accepted marketing correction rules after catalog and assert ordering/content |
| Informational accuracy | Method choice could replace the source’s main change with a generic pattern | Keep subject identity/core claim preservation rules and source-selection rules unchanged |
| Card/Reel final planner | New strategy is not persisted, so final planner must infer it from proposal | Existing hook/keyMessage/outline remain the carrier; no field-role change; full flow fixture test |
| Prompt size | Catalog can make prompt too long | Keep one concise line per method/angle and record UTF-8 byte/token estimate delta |
| Model calls and latency | A classifier or verifier could add calls | No new runner stage; invocation-count test remains one normal call plus existing single repair opportunity |
| Existing queued v4 jobs | Strict v5 worker could reject v4 claim | Before cutover require zero queued/processing v4 proposal jobs; no production compatibility layer for development data |
| API/worker mismatch window | API could enqueue v5 while v4 worker runs | Disable Proposal creation during coordinated migration/API/worker cutover, then re-enable after heartbeat |
| Accepted ON quality | Replacing the current prose could accidentally remove naturalness, evidence or CTA constraints | Exact substring tests plus four operating-equivalent text cases before browser generation |
| Other formats | Shared Proposal Worker also handles Blog | Guard catalog block with `outputFormat !== "blog"`; Blog compiled prompt byte-for-byte unchanged assertion |

## File Structure

- `workers/brand-pilot-content-proposal-worker/src/editorialStrategyCatalog.ts`: internal method/angle definitions and prompt text compiler.
- `workers/brand-pilot-content-proposal-worker/src/editorialStrategyCatalog.test.ts`: catalog completeness, boundaries and wording tests.
- `workers/brand-pilot-content-proposal-worker/src/promptBuilder.ts`: inject catalog for Card/Reel only.
- `packages/brand-pilot-content-contracts/src/catalog.ts`: prompt lineage V5 constant.
- `db/migrations/094_ai_content_prompt_lineage_v5.sql`: allow V5 prompt/binding tuple without changing proposal output schema.
- API proposal repository and migration tests: bind/enqueue/claim V5 exactly.

### Task 1: Add the Internal Strategy Catalog to Card/Reel Proposal Prompts

**Files:**
- Create: `workers/brand-pilot-content-proposal-worker/src/editorialStrategyCatalog.ts`
- Create: `workers/brand-pilot-content-proposal-worker/src/editorialStrategyCatalog.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/promptBuilder.test.ts`

- [ ] **Step 1: Write failing catalog tests**

Require these stable IDs and descriptions:

```ts
export const EXPRESSION_METHODS = [
  ["comparison_decision", "선택 기준·차이·트레이드오프를 비교해 판단을 돕는다"],
  ["problem_solution", "독자의 구체적인 문제를 밝히고 실행 가능한 해결로 전개한다"],
  ["data_interpretation", "핵심 수치·변화량·전후 차이의 의미를 해석한다"],
  ["step_tutorial", "목표 달성에 필요한 순서와 행동을 단계적으로 보여 준다"],
  ["checklist", "점검·선택·실행 항목을 빠짐없이 확인하게 한다"],
  ["myth_fact", "흔한 오해와 확인된 사실을 대조해 판단을 교정한다"],
  ["before_after", "상태·방법·결과의 변화를 전후 흐름으로 보여 준다"],
  ["case_situation", "구체적인 상황이나 사례에서 일반화 가능한 판단을 끌어낸다"],
  ["question_answer", "독자의 실제 질문을 중심으로 필요한 답과 근거를 전개한다"],
] as const;

export const EMPHASIS_ANGLES = [
  ["practicality", "바로 적용할 수 있는 실용성"],
  ["empathy", "독자가 자기 상황으로 느끼는 공감"],
  ["humor", "사실을 해치지 않는 관찰형 유머"],
  ["trust", "근거·조건·한계가 보이는 신뢰"],
  ["efficiency", "시간·과정·노력을 줄이는 효율"],
  ["economy", "비용·가치·낭비 방지 관점"],
  ["differentiation", "대안과 구분되는 핵심 차이"],
  ["risk_avoidance", "실수·오해·손실을 피하는 판단"],
  ["discovery", "몰랐던 변화나 의미를 발견하는 관점"],
] as const;
```

Tests must assert IDs never appear in the requested output field list and the compiler includes free composition, reuse allowance, and substantive-difference wording.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/content-proposal-worker -- --run src/editorialStrategyCatalog.test.ts src/promptBuilder.test.ts
```

- [ ] **Step 3: Implement the catalog compiler**

```ts
export function editorialStrategyPromptRules(): string[] {
  return [
    `표현방식 후보: ${EXPRESSION_METHODS.map(([id, description]) => `${id}=${description}`).join("; ")}.`,
    `강조 관점 후보: ${EMPHASIS_ANGLES.map(([id, description]) => `${id}=${description}`).join("; ")}.`,
    "각 안을 쓰기 전에 주제·목적·대상·Evidence에 맞는 표현방식 하나와 강조 관점 하나를 내부적으로 선택하되 새 필드로 출력하지 마라.",
    "적합한 후보가 없으면 자유 구성하라. 세 안이 같은 표현방식이나 강조 관점을 사용해도 된다.",
    "같은 조합을 쓸 때도 시작 질문, 중심 Evidence, 핵심 메시지, 전개 순서와 마지막 판단이 같은 내용의 재표현이 되지 않게 하라.",
  ];
}
```

Inject this immediately after the existing Card/Reel internal editorial-material review sentence and before marketing-specific grounding rules. Do not change Blog output.

- [ ] **Step 4: Strengthen regression assertions without changing parser behavior**

Assert the compiled prompt still contains the accepted natural Korean, source identity, marketing Evidence, Subject/Product separation, first/middle/final handoff, optional CTA and no-density/no-Scene-2 rules already tracked by the current ON implementation. Assert `parseContentProposalSetV2` source is unchanged in this task.

- [ ] **Step 5: Run GREEN and record prompt delta**

```powershell
npm test --workspace @brand-pilot/content-proposal-worker -- --run src/editorialStrategyCatalog.test.ts src/promptBuilder.test.ts src/contracts.test.ts
```

Record before/after UTF-8 bytes for informational Card, informational Reel, marketing Card, marketing Reel and Blog. Expected: four social prompts grow only by the catalog block; Blog is identical.

- [ ] **Step 6: Commit**

```powershell
git add workers/brand-pilot-content-proposal-worker/src/editorialStrategyCatalog.ts workers/brand-pilot-content-proposal-worker/src/editorialStrategyCatalog.test.ts workers/brand-pilot-content-proposal-worker/src/promptBuilder.ts workers/brand-pilot-content-proposal-worker/src/promptBuilder.test.ts
git commit -m "feat(proposals): auto-select editorial strategy and emphasis"
```

### Task 2: Advance Prompt Lineage to V5 Without Changing Proposal Schema

**Files:**
- Create: `db/migrations/094_ai_content_prompt_lineage_v5.sql`
- Create: `apps/api/src/aiContentPromptVersionMigration094.postgres.integration.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/catalog.ts`
- Modify: `packages/brand-pilot-content-contracts/src/binding.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/generateArtifacts.ts`
- Modify: `packages/brand-pilot-content-contracts/src/generatedArtifacts.test.ts`
- Modify: `scripts/migrations.integration.test.mjs`
- Modify: `scripts/repository-contract.test.mjs`

- [ ] **Step 1: Write failing lineage tests**

Set only:

```ts
export const CONTENT_PROPOSAL_PROMPT_VERSION = "proposal.writer.v5" as const;
```

Keep `content-proposal.v2`, request/base input versions, model ID and output schema unchanged. Assert generated `content-proposal-v2.schema.json` has the same SHA-256 as the V4 baseline while binding/catalog artifacts reference V5.

- [ ] **Step 2: Write migration 094 role test**

Follow migration 091’s append-only pattern. The application role may insert exactly one tuple matching V5 source/catalog/schema hashes, must reject V5 with a mismatched source or catalog hash, and must continue reading historical V4 tuples.

- [ ] **Step 3: Run RED**

```powershell
npm test --workspace @brand-pilot/content-contracts -- --run src/binding.test.ts src/generatedArtifacts.test.ts
npm test --workspace @brand-pilot/api -- --run src/aiContentPromptVersionMigration094.postgres.integration.test.ts
```

- [ ] **Step 4: Implement, generate and run GREEN**

```powershell
npm run generate --workspace @brand-pilot/content-contracts
npm run check:generated --workspace @brand-pilot/content-contracts
npm test --workspace @brand-pilot/content-contracts -- --run src/binding.test.ts src/generatedArtifacts.test.ts
npm test --workspace @brand-pilot/api -- --run src/aiContentPromptVersionMigration094.postgres.integration.test.ts
```

The PostgreSQL application-role test must execute; a skipped test is not a pass.

- [ ] **Step 5: Commit**

```powershell
git add db/migrations/094_ai_content_prompt_lineage_v5.sql apps/api/src/aiContentPromptVersionMigration094.postgres.integration.test.ts packages/brand-pilot-content-contracts scripts/migrations.integration.test.mjs scripts/repository-contract.test.mjs
git commit -m "feat(proposals): register editorial prompt lineage v5"
```

### Task 3: Bind API and Proposal Worker to V5 Exactly

**Files:**
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentProposalV2Repository.pglite.test.ts`
- Modify: `apps/api/src/aiContentProposalV2Repository.postgres.integration.test.ts`
- Modify: `apps/api/src/aiContentRepositoryV3Retry.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/contracts.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/testFixtures.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/worker.test.ts`

- [ ] **Step 1: Write failing exact-binding tests**

API enqueue must persist V5; Proposal Worker claim must reject mismatched prompt version/source/catalog/schema/command descriptor. It must accept V5 with the unchanged output schema and model. Invocation count remains one normal call plus the existing one targeted repair only after parser failure.

- [ ] **Step 2: Replace hardcoded V4 with the shared V5 constant**

In API checks, compare against `CONTENT_PROPOSAL_PROMPT_VERSION` instead of the string literal. Update fixtures and expected hashes from regenerated artifacts; do not weaken strict claim validation.

- [ ] **Step 3: Run GREEN**

```powershell
npm test --workspace @brand-pilot/api -- --run src/aiContentProposalV2Repository.pglite.test.ts src/aiContentProposalV2Repository.postgres.integration.test.ts src/aiContentRepositoryV3Retry.test.ts
npm test --workspace @brand-pilot/content-proposal-worker -- --run src/contracts.test.ts src/promptBuilder.test.ts src/worker.test.ts
npm run typecheck --workspace @brand-pilot/api
```

- [ ] **Step 4: Commit**

```powershell
git add apps/api/src workers/brand-pilot-content-proposal-worker/src
git commit -m "feat(proposals): enforce editorial prompt v5 binding"
```

### Task 4: Verify Quality and Perform the Coordinated Development Cutover

**Files:**
- Modify: `scripts/release-impact.mjs`
- Modify: `scripts/release-impact.test.mjs`
- Modify: `docs/operations/DEVELOPMENT_AND_RELEASE_FLOW.md`
- Create ignored: `.tmp/proposal-editorial-strategy-v5/report.md`

- [ ] **Step 1: Register the exact affected services**

The source change affects Content Proposal Worker, content-contract artifacts and API lineage. It does not rebuild Customer UI, Card, Reel, Blog or Image Worker solely for this plan.

- [ ] **Step 2: Compile four fixed prompts and prove the controlled delta**

Use the accepted informational and marketing fixtures for Card and Reel. Assert the only semantic addition relative to V4 is the catalog/auto-selection block and the version/hash lines. Model, reasoning, permissions, schema, source input, Evidence pool, output format and repair policy remain the same.

- [ ] **Step 3: Run four operating-equivalent text flows**

Generate informational Card/Reel and marketing Card/Reel proposals once each, validate with the unchanged `content-proposal.v2` parser, and inspect:

- method/angle fit inferred from hook/keyMessage/outline without new output fields;
- substantive difference among three proposals even if two use the same strategy;
- subject/product separation and direct Evidence use for marketing;
- natural Korean and preservation of the core change/numbers/conditions;
- no new unsupported claim, required CTA, density rule or Scene-2 formula.

Do not call Image Worker in this isolated Proposal test.

- [ ] **Step 4: Run proportionate repository verification**

```powershell
npm run check:generated --workspace @brand-pilot/content-contracts
npm test --workspace @brand-pilot/content-proposal-worker
npm test --workspace @brand-pilot/content-contracts
npm run typecheck --workspace @brand-pilot/api
node --test scripts/repository-contract.test.mjs scripts/release-impact.test.mjs scripts/deployment-contract.test.mjs
git diff --check
```

- [ ] **Step 5: Cut over without a V4/V5 mismatch window**

Because this feature is still in development, do not add a V4/V5 dual-write compatibility layer. Require zero queued/processing V4 Proposal jobs, temporarily disable Proposal creation, apply migration 094, deploy compatible API and Proposal Worker digests, verify worker heartbeat and V5 claim contract, then re-enable Proposal creation. Leave creation disabled if any step fails.

- [ ] **Step 6: Verify the integrated browser flow**

After the visual-preset plan is also implemented, use the browser for the same four content cases. Confirm setup has no strategy controls, proposals are materially distinct, preset selection appears only after proposal selection, and final Card/Reel outputs preserve the approved ON quality.

- [ ] **Step 7: Report exact evidence**

Report commit/release SHA, migration checksum/application-role result, API and Proposal Worker digests, V4 queue drain count, V5 job IDs, invocation counts, parser results, prompt byte deltas, health/ready/heartbeat/restart/error logs, and browser generation IDs. Separate failed and not-run checks.
