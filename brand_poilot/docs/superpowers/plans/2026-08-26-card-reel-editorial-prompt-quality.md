# Card/Reel Editorial Prompt Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve informational and marketing Card News/Reel Proposal and final planner prompts, preserve the existing contracts, add audited `proposal.writer.v4` lineage, and run isolated plus end-to-end text ON/OFF comparisons.

**Architecture:** Keep the existing `Research -> Proposal -> user selection -> Card Manuscript/Reel Storyboard -> render` flow. Add internal editorial-progression and payoff reasoning to the Proposal and planner prompts, relax narrative-unnecessary Evidence preservation only in the final planners, and record the Proposal behavior change through an append-only v4 lineage CHECK migration. Validate Proposal and planner changes separately before running the complete text flow; do not call the image model.

**Tech Stack:** TypeScript, Node.js 20, Vitest, TypeBox-generated JSON schemas/catalogs, PostgreSQL 16/Testcontainers, Codex CLI (`gpt-5.6-terra` Proposal and `gpt-5.6-sol` high planner runs), Bash/PowerShell deployment scripts.

---

## File map

### Prompt behavior

- Modify `workers/brand-pilot-content-proposal-worker/src/promptBuilder.ts`: add Card/Reel-only pre-editing and editorial-progression instructions without changing Blog prompt behavior.
- Modify `workers/brand-pilot-content-proposal-worker/src/promptBuilder.test.ts`: cover four purpose/format cells, soft Proposal-field de-duplication, internal progression selection, and Blog exclusion.
- Modify `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`: apply first/middle/final, Evidence-necessity, essential-information, and optional-CTA rules; remove superseded strong-Evidence preservation pressure.
- Modify `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`: assert the new rules and the deliberate absence of Scene-2 and density gates.
- Modify `workers/brand-pilot-reel-worker/src/promptBuilder.ts`: mirror Card semantics in Reel Storyboard planning without adding three-second density limits.
- Modify `workers/brand-pilot-reel-worker/src/promptBuilder.test.ts`: mirror Card coverage and preserve Reel-specific source/browser behavior.

### Version lineage

- Modify `packages/brand-pilot-content-contracts/src/catalog.ts`: advance only `CONTENT_PROPOSAL_PROMPT_VERSION` to `proposal.writer.v4`.
- Regenerate `packages/brand-pilot-content-contracts/generated/content-catalog.json`, `packages/brand-pilot-content-contracts/generated/content-prompt-binding-v1.schema.json`, and any generator-selected hash-bearing artifacts.
- Modify generated-artifact/catalog tests only where exact v3 literals or hashes are intentionally superseded.
- Create `db/migrations/091_ai_content_prompt_lineage_v4.sql`: preserve v2/v3 exact tuples and add the exact generated v4 tuple.
- Create `apps/api/src/aiContentPromptVersionMigration091.postgres.integration.test.ts`: prove v2/v3/v4 behavior with the application role.
- Modify `apps/api/src/aiContentRepositoryV3.postgres.integration.test.ts`, `scripts/migrationRunner.mjs`, `scripts/migrationRunner.test.mjs`, `scripts/content-suggestion-schema-migration.test.mjs`, `scripts/deployment-contract.test.mjs`, `scripts/repository-contract.test.mjs`, `deploy/scripts/deploy.sh`, and exact API lineage fixtures that enumerate the latest migration or current v3 tuple.

### One-off validation

- Create ignored files under `.tmp/card-reel-editorial-prompt-onoff/`; do not commit frozen source data or model outputs.
- Reuse the exact informational bundle at `C:/Users/dkskr/OneDrive/111/brand_poilot/tmp/oneoff/8eed-url-read-onoff/production-bundle.json`.
- Locate the exact frozen bundle for Production generation `743a7abc-15f8-4763-b291-bfcb89db634e` through read-only local artifacts or the existing Production inspection path. If it cannot be retrieved exactly, stop the marketing tracks and report them as blocked; do not reconstruct facts from the prior narrative.
- Create an ignored ON/OFF compiler/runner that saves Proposal isolation, planner isolation, and complete text-flow outputs for all available matrix cells.

## Task 1: Capture the immutable OFF baseline and exact test inputs

**Files:**
- Create ignored: `.tmp/card-reel-editorial-prompt-onoff/baseline.json`
- Create ignored: `.tmp/card-reel-editorial-prompt-onoff/fixtures/informational-source.json`
- Create ignored when available: `.tmp/card-reel-editorial-prompt-onoff/fixtures/marketing-source.json`
- Create ignored: `.tmp/card-reel-editorial-prompt-onoff/compile-off-prompts.mts`

- [ ] **Step 1: Record the baseline revision and current prompt versions**

Run:

```powershell
git rev-parse HEAD
rg -n "CONTENT_PROPOSAL_PROMPT_VERSION|cardNewsPlanSkillVersion|reelPlanSkillVersion" packages/brand-pilot-content-contracts/src/catalog.ts workers/brand-pilot-card-news-worker/src/promptBuilder.ts workers/brand-pilot-reel-worker/src/promptBuilder.ts
```

Expected: baseline revision `44c11333...`, Proposal `proposal.writer.v3`, Card `card-manuscript-plan-skill.v6`, and Reel `reel-storyboard-skill.v7`.

- [ ] **Step 2: Verify the informational frozen bundle identity**

Run:

```powershell
$bundle = Get-Content -LiteralPath 'C:\Users\dkskr\OneDrive\111\brand_poilot\tmp\oneoff\8eed-url-read-onoff\production-bundle.json' -Raw | ConvertFrom-Json
$bundle.input_json.generationId
$bundle.input_json.outputSettings | ConvertTo-Json -Compress
$bundle.input_json.researchEvidence.items.Count
```

Expected: the exact stored generation ID, `outputFormat=reel`, a declared purpose, and a non-empty Evidence Pool. Save the unmodified bundle under the ignored fixture directory using `Copy-Item -LiteralPath`.

- [ ] **Step 3: Locate the exact marketing frozen bundle read-only**

Search local artifacts first:

```powershell
rg -l --hidden "743a7abc-15f8-4763-b291-bfcb89db634e" 'C:\Users\dkskr\OneDrive\111\brand_poilot\tmp' '.tmp'
```

If absent, use the repository's existing read-only Production inspection mechanism to export the stored `contentGenerationInput` and frozen visual selection for that exact generation. Verify the generation ID inside the exported JSON. Do not issue an update, retry, enqueue, or generation request.

Expected: either an exact frozen bundle whose embedded generation ID matches `743a7abc-15f8-4763-b291-bfcb89db634e`, or an explicit `marketing_fixture_unavailable` stop result.

- [ ] **Step 4: Write the OFF prompt compiler before changing production prompt code**

The ignored `compile-off-prompts.mts` must import the current builders and write:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildContentProposalPrompt } from "../../workers/brand-pilot-content-proposal-worker/src/promptBuilder.ts";
import { buildCardNewsPlanPrompt } from "../../workers/brand-pilot-card-news-worker/src/promptBuilder.ts";
import { buildReelPlanPrompt } from "../../workers/brand-pilot-reel-worker/src/promptBuilder.ts";

const root = path.resolve(".tmp/card-reel-editorial-prompt-onoff");
await mkdir(path.join(root, "off"), { recursive: true });

// Load exact frozen fixtures, clone only outputFormat/purpose for the four matrix cells,
// preserve every other frozen field, and write the current Proposal/Card/Reel prompts.
// For planner-isolation prompts, write the exact frozen selected Proposal Lens and assetCount.
```

Implement explicit matrix keys `informational-card_news`, `informational-reel`, `marketing-card_news`, and `marketing-reel`. Skip marketing keys only when Step 3 produced `marketing_fixture_unavailable`.

- [ ] **Step 5: Run the OFF compiler and hash every prompt**

Run:

```powershell
npx tsx .tmp/card-reel-editorial-prompt-onoff/compile-off-prompts.mts
Get-ChildItem -LiteralPath '.tmp/card-reel-editorial-prompt-onoff/off' -File -Recurse | Get-FileHash -Algorithm SHA256 | Sort-Object Path
```

Expected: one Proposal prompt and one planner prompt per available matrix cell, with stable SHA-256 values saved to `baseline.json` alongside the revision and versions.

- [ ] **Step 6: Commit no baseline artifacts**

Run:

```powershell
git status --short
```

Expected: `.tmp` files are ignored and no tracked file changed in this task.

## Task 2: Add failing Proposal prompt tests

**Files:**
- Modify: `workers/brand-pilot-content-proposal-worker/src/promptBuilder.test.ts`

- [ ] **Step 1: Add Card/Reel pre-editing tests for both purposes**

Add a table-driven test that asserts the prompt contains these concepts for `card_news` and `reel`, informational and marketing:

```ts
it.each([
  ["card_news", "informational"],
  ["reel", "informational"],
  ["card_news", "marketing"],
  ["reel", "marketing"],
] as const)("pre-edits %s %s proposals around payoff and a fitting progression", (outputFormat, purpose) => {
  const job = compositionJob();
  job.composedInput.outputSettings = { ...job.composedInput.outputSettings, outputFormat, purpose };
  job.request.outputFormat = outputFormat;
  const prompt = buildContentProposalPrompt(job);

  expect(prompt).toContain("독자 또는 고객 상황");
  expect(prompt).toContain("끝까지 보았을 때");
  expect(prompt).toContain("전개 방식을 내부적으로 선택");
  expect(prompt).toContain("새 출력 필드나 고정 장면 공식으로 만들지 마라");
  expect(prompt).toContain("같은 내용을 표현만 바꿔 반복하지 마라");
});
```

- [ ] **Step 2: Add a soft field-role test**

Assert overlap is not forbidden and strict field-role strings are absent:

```ts
expect(prompt).toContain("일부 내용이 자연스럽게 겹칠 수 있다");
expect(prompt).not.toContain("title은 선택용 편집 관점, hook은 첫 진입 후보");
expect(prompt).not.toContain("서로 같은 문장을 반복하지 마라");
```

- [ ] **Step 3: Add Blog exclusion tests**

Extend the existing Blog test:

```ts
expect(prompt).not.toContain("독자 또는 고객 상황");
expect(prompt).not.toContain("전개 방식을 내부적으로 선택");
expect(prompt).not.toContain("중심 payoff");
```

- [ ] **Step 4: Run the focused test and verify failure**

Run:

```powershell
npm test --workspace @brand-pilot/content-proposal-worker -- --run src/promptBuilder.test.ts
```

Expected: FAIL because the new editorial pre-editing strings are not yet in the prompt.

## Task 3: Implement Proposal pre-editing minimally

**Files:**
- Modify: `workers/brand-pilot-content-proposal-worker/src/promptBuilder.ts:13-63`
- Test: `workers/brand-pilot-content-proposal-worker/src/promptBuilder.test.ts`

- [ ] **Step 1: Add a non-Blog editorial-rule block**

Create a `socialEditorialRules` array selected by `outputFormat !== "blog"`:

```ts
const socialEditorialRules = snapshot.outputSettings.outputFormat !== "blog"
  ? [
      "카드뉴스·릴스 구성안을 쓰기 전에 각 안마다 독자 또는 고객 상황, 끝까지 보았을 때 얻는 구체적인 이해·발견·판단·가치, 지금 볼 이유, 가장 강한 변화·수치·대조·사례·과정·문제·제품 판단을 내부적으로 검토하라.",
      "검토한 재료에 맞는 전개 방식을 내부적으로 선택하라. 변화·데이터·사례·문제 해결·비교·튜토리얼·오해 교정·제품 판단·브랜드 사례 흐름을 사용할 수 있지만 새 출력 필드나 고정 장면 공식으로 만들지 마라.",
      "선택한 전개 방식에 필요한 Editorial Point와 순서를 먼저 정한 뒤 기존 outline을 작성하라.",
      "세 안은 독자·고객 상황, 끝까지 볼 가치, 시작점, 중심 사실·Evidence, 전개 방식 또는 마지막 판단 중 하나 이상이 실질적으로 달라야 한다.",
      "title, hook, oneLineIntent, keyMessage는 기존 의미를 유지하고 일부 내용이 자연스럽게 겹칠 수 있다. 다만 네 필드가 같은 내용을 표현만 바꿔 반복하지 마라.",
      "outline은 최종 원고를 잠그지 않는 예상 전개이며, 각 항목은 전체 관점에 필요한 Editorial Point를 가져야 한다.",
    ]
  : [];
```

Insert `...socialEditorialRules` immediately before the existing required Proposal-field instruction. Do not alter Blog evidence-set rules or schema fields.

- [ ] **Step 2: Keep purpose-specific behavior intact**

Do not remove the existing informational question/value rules or marketing source-role chain. Add no new CTA requirement and no new Proposal field.

- [ ] **Step 3: Run focused Proposal tests**

Run:

```powershell
npm test --workspace @brand-pilot/content-proposal-worker -- --run src/promptBuilder.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit Proposal behavior**

```powershell
git add -- workers/brand-pilot-content-proposal-worker/src/promptBuilder.ts workers/brand-pilot-content-proposal-worker/src/promptBuilder.test.ts
git commit -m "feat(ai-content): pre-edit social content proposals"
```

## Task 4: Add failing Card/Reel planner tests

**Files:**
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/promptBuilder.test.ts`

- [ ] **Step 1: Replace superseded Evidence-preservation expectations**

In both test files, replace expectations for:

```ts
"강한 원문 Evidence를 Scene 수에 맞추기 위해 제외하지 마세요"
"의미상 중복되거나 원문 주제 자체와 실질적으로 무관한 Evidence만 제외"
"명백한 과적재가 있으면 Evidence 제외보다 의미상 재그룹"
```

with expectations for:

```ts
expect(prompt).toContain("선택한 중심 질문·주장·payoff");
expect(prompt).toContain("필요한 Evidence를 사용");
expect(prompt).toContain("강한 Evidence라도 선택한 Narrative에 필요하지 않으면 excludedEvidenceIds");
expect(prompt).toContain("bridge Evidence");
expect(prompt).toContain("남은 Evidence라는 이유만으로");
```

- [ ] **Step 2: Add first/middle/final and essential-information tests**

For informational and marketing prompts in both workers, assert:

```ts
expect(prompt).toContain("첫 Scene");
expect(prompt).toContain("중간 Scene");
expect(prompt).toContain("마지막 Scene");
expect(prompt).toContain("처음 제기한 관심이나 약속");
expect(prompt).toContain("Essential-information test");
expect(prompt).toContain("의미·신뢰성·범위·조건");
expect(prompt).toContain("검증·추적 정보");
```

- [ ] **Step 3: Assert deliberate absences**

```ts
expect(prompt).not.toContain("Scene-2 payoff test");
expect(prompt).not.toContain("두 번째 Scene은");
expect(prompt).not.toContain("3초 안에");
expect(prompt).not.toContain("First-glance test");
expect(prompt).not.toContain("Simplicity test");
```

Do not assert absence of the existing `Scene 2부터는 바로 앞 Scene과의 의미 관계` instruction until implementation replaces it with a semantically equivalent middle-Scene instruction.

- [ ] **Step 4: Add optional marketing CTA tests**

```ts
expect(prompt).toContain("CTA Scene은 필수가 아니며 최대 1개");
expect(prompt).toContain("payoff를 완성한 뒤 필요한 경우에만");
expect(prompt).toContain("content.cta는 후보 행동 문구");
```

- [ ] **Step 5: Run both focused suites and verify failure**

Run:

```powershell
npm test --workspace @brand-pilot/card-news-worker -- --run src/promptBuilder.test.ts
npm test --workspace @brand-pilot/reel-worker -- --run src/promptBuilder.test.ts
```

Expected: FAIL on the new Evidence, scene, essential-information, and CTA expectations.

## Task 5: Implement Card planner behavior

**Files:**
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.ts:6-145`
- Test: `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`

- [ ] **Step 1: Bump the Card skill version**

```ts
export const cardNewsPlanSkillVersion = "card-manuscript-plan-skill.v7";
```

- [ ] **Step 2: Replace Scene-2 wording with first/middle/final wording**

Use prompt instructions with these exact responsibilities:

```ts
"첫 Scene은 주제명이나 원문 제목을 반복하는 표지에 머물지 말고 콘텐츠에 맞는 주장·변화·수치·대조·질문·효익으로 중심 관심이나 약속을 세우세요.",
"중간 Scene은 특정 순번 공식을 따르지 않습니다. 각 Scene은 선택한 중심 결과에 필요한 새로운 사실·관계·해석·판단을 추가하고, 앞 Scene 또는 중심 결과와의 관계가 표시 문구에서 이해되어야 합니다.",
"마지막 Scene은 첫 Scene을 표현만 바꿔 반복하지 말고 처음 제기한 관심이나 약속에 답하는 새로운 판단·결과·의미·활용을 제공하세요.",
```

Remove the dedicated `Scene 2부터` instruction, while retaining the existing Adjacent-scene self-check for all middle/final Scenes.

- [ ] **Step 3: Replace strong-Evidence preservation pressure**

Use:

```ts
"전체 Evidence Pool을 검토하되 선택한 중심 질문·주장·payoff를 이해하거나 뒷받침하는 데 필요한 Evidence를 사용하세요.",
"강한 Evidence라도 선택한 Narrative에 필요하지 않으면 excludedEvidenceIds로 분류할 수 있습니다. Evidence가 강하거나 남았다는 이유만으로 Scene을 만들거나 다른 Point에 억지로 연결하지 마세요.",
"앞뒤 논리를 잇는 bridge Evidence가 빠지면 핵심 주장으로 건너뛰게 되는지 확인하고, 필요한 bridge Evidence를 우선하세요.",
```

Retain exact selected/excluded partition and Scene-union instructions.

- [ ] **Step 4: Add displayed-information preservation without a density gate**

```ts
"Evidence ID와 전체 출처 정보는 검증·추적 정보이며 모든 세부사항의 화면 표시 의무가 아닙니다.",
"다만 주제 정체성, 핵심 변화·주장, 결론을 직접 뒷받침하는 결정적 수치·사실·비교, 의미를 바꾸는 조건·범위·시점·적용 대상, 논리를 잇는 bridge 정보는 이해에 필요하면 headline, informationRelation, supportingTexts 또는 footnote에 보존하세요.",
"Essential-information test: 사실을 화면 문구에서 제거했을 때 주장의 의미·신뢰성·범위·조건 또는 논리적 연속성이 달라지면 그 사실을 표시 문구에 복원하세요.",
```

Do not add word, character, number, or three-second limits. Keep the existing one-primary-Editorial-Point and overload review.

- [ ] **Step 5: Make marketing CTA explicitly subordinate**

In the marketing purpose rules add:

```ts
"CTA Scene은 필수가 아니며 최대 1개입니다. 먼저 고객의 가치·적합성·조건에 대한 payoff를 완성한 뒤 필요한 경우에만 CTA를 보조로 사용하세요.",
"content.cta는 기존 계약의 후보 행동 문구이며 이를 Scene headline이나 마지막 결론으로 자동 승격하지 마세요.",
```

Keep the existing grounded non-CTA Scene requirement.

- [ ] **Step 6: Update self-check wording**

Add Reader-payoff, Topic-label, Promise-payoff, Scene-progression, Evidence-necessity, and Essential-information checks. Do not add Scene-2, First-glance, Simplicity, or density checks.

- [ ] **Step 7: Run Card tests**

Run:

```powershell
npm test --workspace @brand-pilot/card-news-worker -- --run src/promptBuilder.test.ts
npm test --workspace @brand-pilot/card-news-worker
```

Expected: PASS.

- [ ] **Step 8: Commit Card behavior**

```powershell
git add -- workers/brand-pilot-card-news-worker/src/promptBuilder.ts workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts workers/brand-pilot-card-news-worker/src/worker.test.ts
git commit -m "feat(ai-content): refine card editorial selection"
```

Include `worker.test.ts` only if its exact skill-version expectation changes.

## Task 6: Implement matching Reel planner behavior

**Files:**
- Modify: `workers/brand-pilot-reel-worker/src/promptBuilder.ts:8-234`
- Test: `workers/brand-pilot-reel-worker/src/promptBuilder.test.ts`
- Test when version asserted: `workers/brand-pilot-reel-worker/src/worker.test.ts`

- [ ] **Step 1: Bump the Reel skill version**

```ts
export const reelPlanSkillVersion = "reel-storyboard-skill.v8";
```

- [ ] **Step 2: Apply the exact same editorial semantics as Card**

Add the same first/middle/final, Evidence-necessity, essential-information, and optional-marketing-CTA instruction strings from Task 5. Preserve Reel-specific `storyNarrative`, source-browser, caption, audio/video, and output-shape behavior.

- [ ] **Step 3: Preserve the no-density decision**

Do not add `3초`, new supporting-text count limits, First-glance, or Simplicity tests. Keep existing informationRelation contract limits and the current instruction that important Scenes may have higher density.

- [ ] **Step 4: Run Reel tests**

Run:

```powershell
npm test --workspace @brand-pilot/reel-worker -- --run src/promptBuilder.test.ts
npm test --workspace @brand-pilot/reel-worker
```

Expected: PASS.

- [ ] **Step 5: Commit Reel behavior**

```powershell
git add -- workers/brand-pilot-reel-worker/src/promptBuilder.ts workers/brand-pilot-reel-worker/src/promptBuilder.test.ts workers/brand-pilot-reel-worker/src/worker.test.ts
git commit -m "feat(ai-content): refine reel editorial selection"
```

Include `worker.test.ts` only if its exact skill-version expectation changes.

## Task 7: Advance Proposal lineage and regenerate canonical artifacts

**Files:**
- Modify: `packages/brand-pilot-content-contracts/src/catalog.ts:14`
- Modify generated: `packages/brand-pilot-content-contracts/generated/*` selected by generator
- Modify tests/fixtures containing the current Proposal version/hash only when generated checks fail

- [ ] **Step 1: Write the failing version expectation**

Update the catalog test that asserts the current Proposal prompt version to expect:

```ts
expect(catalog.proposalContracts.promptVersion).toBe("proposal.writer.v4");
```

Run:

```powershell
npm test --workspace @brand-pilot/content-contracts
```

Expected: FAIL while the source constant remains v3.

- [ ] **Step 2: Advance the source constant only**

```ts
export const CONTENT_PROPOSAL_PROMPT_VERSION = "proposal.writer.v4" as const;
```

Do not change Proposal request/input/output contract versions or planner definition versions.

- [ ] **Step 3: Regenerate artifacts**

Run:

```powershell
npm run generate --workspace @brand-pilot/content-contracts
npm run check:generated --workspace @brand-pilot/content-contracts
```

Expected: generator updates the canonical catalog/hash artifacts and `check:generated` exits 0.

- [ ] **Step 4: Print and record the exact v4 tuple for the migration**

Run:

```powershell
node -e "const c=require('./packages/brand-pilot-content-contracts/generated/content-catalog.json'); console.log(JSON.stringify({promptVersion:c.proposalContracts.promptVersion,source:c.contractSourceHash,proposalSchema:c.proposalContracts.outputSchemaSha256},null,2))"
(Get-FileHash -LiteralPath 'packages/brand-pilot-content-contracts/generated/content-catalog.json' -Algorithm SHA256).Hash.ToLowerInvariant()
```

Record the three JSON values and the catalog file SHA-256 in the test evidence; do not infer them.

- [ ] **Step 5: Run content-contract and API type tests**

First identify every current-version literal before editing fixtures:

```powershell
rg -n "proposal\.writer\.v3|415ca40b3dc3616affab6642b437ecd6b148bf70f017638640e2a4f858aaf808|ecada3861313486b50e0a1475d89284f13fe4a74018207d11f205613deefb550" packages apps scripts deploy db
```

Preserve historical v3 constants in migration 087 and the v2/v3 branches of lineage regression tests. Update only fixtures representing the current catalog/contract.

```powershell
npm test --workspace @brand-pilot/content-contracts
npm run typecheck --workspace @brand-pilot/api
```

Expected: PASS after exact v4 fixture updates.

- [ ] **Step 6: Commit lineage source and generated artifacts**

```powershell
git add -- packages/brand-pilot-content-contracts apps/api/src
git commit -m "feat(ai-content): version proposal editorial prompt v4"
```

Stage only files actually changed by the version/catalog update.

## Task 8: Add the append-only v4 DB lineage migration

**Files:**
- Create: `db/migrations/091_ai_content_prompt_lineage_v4.sql`
- Create: `apps/api/src/aiContentPromptVersionMigration091.postgres.integration.test.ts`
- Modify: `apps/api/src/aiContentRepositoryV3.postgres.integration.test.ts`
- Modify: `scripts/migrationRunner.mjs`
- Modify: `scripts/migrationRunner.test.mjs`
- Modify: `scripts/content-suggestion-schema-migration.test.mjs`
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `scripts/repository-contract.test.mjs`
- Modify: `deploy/scripts/deploy.sh`

- [ ] **Step 1: Write the PostgreSQL integration test first**

Copy the structure of `aiContentPromptVersionMigration087.postgres.integration.test.ts` and define constants for the exact v2, v3, and Task 7 v4 tuples. The test must:

```ts
await insertProposalContract(application, "proposal.writer.v4", v4SourceHash, v4CatalogHash);
await insertPromptBinding(application, "proposal.writer.v4", v4SourceHash);
await expect(insertProposalContract(
  application, "proposal.writer.v4", v3SourceHash, v4CatalogHash,
)).rejects.toThrow(/ai_content_proposal_job_contracts_versions_check/);
await expect(insertPromptBinding(
  application, "proposal.writer.v3", v4SourceHash,
)).rejects.toThrow(/ai_content_generation_prompt_bindings_proposal_lineage_check/);
```

Also assert the application role still lacks UPDATE on both tables.

- [ ] **Step 2: Run the new integration test and verify failure**

Run:

```powershell
npm test --workspace @brand-pilot/api -- --run src/aiContentPromptVersionMigration091.postgres.integration.test.ts
```

Expected: FAIL because migration 091 does not exist or v4 is rejected.

- [ ] **Step 3: Create migration 091 from the v3 constraint shape**

The migration must use `NOT VALID -> VALIDATE -> drop old -> rename new` for both tables and preserve the byte-for-byte v2/v3 branches from migration 087. Add a third branch with `proposal_prompt_version='proposal.writer.v4'` and the exact source/catalog SHA-256 values printed in Task 7. For `ai_content_generation_prompt_bindings`, add the exact v4 `proposal_prompt_version + contract_source_hash` branch. Before saving, verify every hash in the final SQL matches the recorded Task 7 evidence and that `rg -n "exact|placeholder|<|>" db/migrations/091_ai_content_prompt_lineage_v4.sql` returns no output.

- [ ] **Step 4: Register migration 091 everywhere the repository enumerates migrations**

- append the filename and its exact SHA-256 to `post075SchemaMigrationChecksums`;
- make 091 the latest `POST_075_SCHEMA_MIGRATION_ID` in `deploy/scripts/deploy.sh`;
- update repository and deployment contract expected lists;
- update content-suggestion migration tests that enumerate the pending post-075 sequence;
- apply migration 091 after 087 in current-catalog API PostgreSQL fixtures;
- add tests proving 090 precedes 091 and historical checksums remain unchanged.

Compute the migration hash only after SQL is final:

```powershell
(Get-FileHash -LiteralPath 'db/migrations/091_ai_content_prompt_lineage_v4.sql' -Algorithm SHA256).Hash.ToLowerInvariant()
```

- [ ] **Step 5: Run DB and migration registration tests**

```powershell
npm test --workspace @brand-pilot/api -- --run src/aiContentPromptVersionMigration091.postgres.integration.test.ts
node --test scripts/migrationRunner.test.mjs scripts/deployment-contract.test.mjs scripts/repository-contract.test.mjs
```

Expected: PASS. The PostgreSQL test must execute with the non-owner application role for inserts.

- [ ] **Step 6: Commit the migration**

```powershell
git add -- db/migrations/091_ai_content_prompt_lineage_v4.sql apps/api/src/aiContentPromptVersionMigration091.postgres.integration.test.ts apps/api/src/aiContentRepositoryV3.postgres.integration.test.ts scripts/migrationRunner.mjs scripts/migrationRunner.test.mjs scripts/content-suggestion-schema-migration.test.mjs scripts/deployment-contract.test.mjs scripts/repository-contract.test.mjs deploy/scripts/deploy.sh
git commit -m "feat(db): allow proposal prompt lineage v4"
```

## Task 9: Compile ON prompts and validate prompt-only differences

**Files:**
- Create ignored: `.tmp/card-reel-editorial-prompt-onoff/compile-on-prompts.mts`
- Create ignored: `.tmp/card-reel-editorial-prompt-onoff/prompt-diff-summary.json`

- [ ] **Step 1: Compile ON prompts from the same frozen fixtures**

Clone the OFF compiler and change only its output directory to `on`; import the now-revised builders. Reuse the exact fixture files and matrix keys. Do not refetch or mutate inputs.

- [ ] **Step 2: Produce normalized prompt diffs**

Run:

```powershell
npx tsx .tmp/card-reel-editorial-prompt-onoff/compile-on-prompts.mts
git diff --no-index -- .tmp/card-reel-editorial-prompt-onoff/off .tmp/card-reel-editorial-prompt-onoff/on
```

Expected differences:

- Proposal prompts: social pre-editing/progression rules only, plus no frozen-input mutation.
- Card/Reel prompts: first/middle/final, Evidence necessity, essential-information, and optional CTA rules.
- No new schema keys, Scene-2 rule, density rule, image instruction, or tool permission.

- [ ] **Step 3: Add deterministic prompt validation to the ignored harness**

Validate every ON prompt with assertions equivalent to:

```ts
assert.match(prompt, /처음 제기한 관심이나 약속/);
assert.match(prompt, /Essential-information test/);
assert.doesNotMatch(prompt, /Scene-2 payoff test|3초 안에|First-glance test|Simplicity test/);
assert.equal(JSON.stringify(offFixture), JSON.stringify(onFixture));
```

For Proposal prompts, assert the new rules are absent from Blog and present in both Card/Reel purposes.

- [ ] **Step 4: Stop if non-prompt state differs**

Expected: any frozen-input, schema, model, reasoning, tool-permission, or assetCount mismatch fails the harness before a model call.

## Task 10: Run Track A Proposal isolation

**Files:**
- Create ignored outputs: `.tmp/card-reel-editorial-prompt-onoff/results/track-a/*`

- [ ] **Step 1: Run each available OFF/ON Proposal prompt once**

Invoke Codex with the operating Proposal contract:

```text
codex exec --ignore-user-config --strict-config -m gpt-5.6-terra
  --output-schema packages/brand-pilot-content-contracts/generated/content-proposal-v2.schema.json
  -c default_permissions="worker"
  -c permissions.worker.filesystem={":minimal"="deny","/codex"="deny","/codex-accounts"="deny",":workspace_roots"={"."="deny"}}
  -c permissions.worker.network.enabled=false
  --disable shell_tool --disable shell_snapshot --disable image_generation
  --skip-git-repo-check --ephemeral --json -C .tmp/card-reel-editorial-prompt-onoff/results/track-a/informational-card_news-off -
```

Feed exactly one compiled prompt through stdin. Use the same Codex account/profile and execution tier for both sides. Do not retry quality differences; only use the operating contract-repair path if schema validation fails, and record that repair.

- [ ] **Step 2: Validate Proposal outputs with the existing parser/schema**

Run the existing Proposal result parser against every output and record:

- schema validity;
- proposal count exactly three;
- each Proposal's title, hook, intent, message, Evidence IDs, assetCount, outline;
- whether any repair occurred.

- [ ] **Step 3: Write Track A comparison tables**

For each available matrix cell, report:

- meaningful differentiation among the three Proposals;
- suitability of the inferred progression;
- field repetition without enforcing artificial independence;
- unsupported promises or identity loss;
- neutral/stochastic differences.

Do not select a winner solely from hook wording.

## Task 11: Run Track B planner isolation

**Files:**
- Create ignored outputs: `.tmp/card-reel-editorial-prompt-onoff/results/track-b/*`

- [ ] **Step 1: Freeze identical Proposal Lenses**

Use the exact same valid Proposal object and `assetCount` on both sides of each pair. Prefer the original frozen selected Proposal from each production-shaped bundle; do not use ON Proposal output in this track.

- [ ] **Step 2: Run Card pairs through the operating Card runner**

Create `.tmp/card-reel-editorial-prompt-onoff/jobs/informational-card_news-off.json` with the compiled prompt string and `"allowBrowserUse": false`, then run:

```powershell
node workers/brand-pilot-card-news-worker/scripts/run-codex-card-manuscript-plan.mjs --job .tmp/card-reel-editorial-prompt-onoff/jobs/informational-card_news-off.json --output .tmp/card-reel-editorial-prompt-onoff/results/track-b/informational-card_news-off
```

Expected: one `card-manuscript-plan.json` per OFF/ON run, `gpt-5.6-sol`, reasoning high, planner permissions, no shell/image tools.

- [ ] **Step 3: Run Reel pairs through the operating Reel runner**

Create `.tmp/card-reel-editorial-prompt-onoff/jobs/informational-reel-off.json` with the compiled prompt string and `"allowBrowserUse": false`, then run:

```powershell
node workers/brand-pilot-reel-worker/scripts/run-codex-reel-plan.mjs --job .tmp/card-reel-editorial-prompt-onoff/jobs/informational-reel-off.json --output .tmp/card-reel-editorial-prompt-onoff/results/track-b/informational-reel-off
```

Expected: one `reel-plan.json` per OFF/ON run under the same operating model and permissions.

- [ ] **Step 4: Validate with existing Card/Reel parsers**

Record contract validity, selected/excluded partition, Scene Evidence union, CTA Scene count, grounded marketing Scene requirement, entity attribution, and repair count.

- [ ] **Step 5: Write Track B comparison tables**

Compare first/middle/final progression, final payoff, Evidence necessity, essential displayed facts, unrelated Evidence insertion, and CTA subordination. Explicitly check whether the Fanta AI angle still pulls `10 billion impressions` into the plan when it is not necessary.

## Task 12: Run Track C complete text flow

**Files:**
- Create ignored outputs: `.tmp/card-reel-editorial-prompt-onoff/results/track-c/*`

- [ ] **Step 1: Select one Proposal per side with a recorded rationale**

Select the Proposal that best satisfies the frozen user purpose on each side. Record concept key, title, target, central payoff, Evidence focus, and why it was selected. Do not claim OFF and ON selected lenses are identical when they are not.

- [ ] **Step 2: Compile and run the matching final planner**

Feed the selected OFF Proposal to the OFF planner and selected ON Proposal to the ON planner. Keep all non-prompt settings fixed within each format/purpose pair.

- [ ] **Step 3: Validate all outputs deterministically**

Use existing parsers and validators. Any schema, partition, attribution, or CTA-count failure is a failed result rather than a quality opinion.

- [ ] **Step 4: Produce the complete text report**

Create `.tmp/card-reel-editorial-prompt-onoff/report.md` with:

- input identity and hashes;
- baseline/ON revisions and prompt hashes;
- model, reasoning, permissions, and attempt counts;
- Track A, B, and C side-by-side tables;
- all deterministic validation results;
- qualitative evidence for each design criterion;
- regressions and stochastic uncertainty;
- missing/blocked marketing tracks if the exact frozen marketing fixture was unavailable;
- a recommendation to keep, revise, or reject each prompt rule group.

Stop before image generation, Production writes, merge, or deployment.

## Task 13: Run full verification

**Files:**
- No new files unless a verification failure exposes a scoped defect.

- [ ] **Step 1: Run affected worker and contract suites**

```powershell
npm test --workspace @brand-pilot/content-proposal-worker
npm test --workspace @brand-pilot/card-news-worker
npm test --workspace @brand-pilot/reel-worker
npm test --workspace @brand-pilot/content-contracts
```

Expected: PASS.

- [ ] **Step 2: Run API lineage/type verification**

```powershell
npm test --workspace @brand-pilot/api -- --run src/aiContentPromptVersionMigration091.postgres.integration.test.ts
npm run typecheck --workspace @brand-pilot/api
```

Expected: PASS; PostgreSQL application-role test is executed, not skipped.

- [ ] **Step 3: Run repository and deployment contract checks**

```powershell
npm run check:generated --workspace @brand-pilot/content-contracts
node --test scripts/migrationRunner.test.mjs scripts/deployment-contract.test.mjs scripts/repository-contract.test.mjs
git diff --check
```

Expected: PASS and no whitespace errors.

- [ ] **Step 4: Inspect final scope**

```powershell
git status --short
git diff --stat 44c11333..HEAD
git diff --name-only 44c11333..HEAD
```

Expected tracked scope: Proposal/Card/Reel prompt code and tests, catalog/generated lineage artifacts, API lineage fixtures/test, DB migration, migration/deployment registration, and this plan/spec history only. No UI, Image Worker, Research Worker, Blog Worker, public API schema, or Production data file changes.

- [ ] **Step 5: Keep one-off evidence untracked**

Run `git status --short --ignored .tmp/card-reel-editorial-prompt-onoff` and verify every fixture, prompt, model output, and report line is prefixed by `!!`. Do not commit `.tmp` inputs, model outputs, credentials, or Production snapshots.

## Task 14: Hand off results without merge or deployment

- [ ] **Step 1: Report implementation status and test evidence**

Include commit IDs, affected services, exact test commands/results, application-role DB result, and the ON/OFF report path.

- [ ] **Step 2: State remaining approval boundaries**

Merge, Production migration, API/worker deployment, image generation, and Production writes remain unperformed and require separate user approval.
