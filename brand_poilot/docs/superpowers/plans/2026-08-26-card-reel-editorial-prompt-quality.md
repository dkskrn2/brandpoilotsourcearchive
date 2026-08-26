# Card/Reel Editorial Prompt Quality Implementation Plan

> **Execution approval (2026-08-26):** The user approved option 1A: promote the complete corrected ON behavior to Production while preserving the current architecture and output quality direction. The accepted evidence is `.tmp/card-reel-editorial-prompt-onoff/IMAGE-REPORT.md`. Implementation must reproduce the corrected ON prompt semantics, not the earlier pre-retest ON draft.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the accepted informational and marketing Card News/Reel ON behavior to Production, add natural Korean user-visible copy guidance, preserve the existing contracts and render structure, and record audited `proposal.writer.v4` lineage.

**Architecture:** Keep the existing `Research -> Proposal -> user selection -> Card Manuscript/Reel Storyboard -> render` flow. Port the exact corrected ON semantics into the Proposal/Card/Reel prompt builders: editorial progression and payoff reasoning, subject/product/brand authority separation, directly relevant marketing Evidence binding, narrative-necessary Evidence selection, first/middle/final Scene editing, optional CTA use, and natural Korean user-visible copy. Add no runtime quality judge, post-processing model, retry, output field, or image-worker change. Record the Proposal behavior change through an append-only v4 lineage CHECK migration.

**Tech Stack:** TypeScript, Node.js 20, Vitest, TypeBox-generated JSON schemas/catalogs, PostgreSQL 16/Testcontainers, Codex CLI (`gpt-5.6-terra` Proposal and `gpt-5.6-sol` high planner runs), Bash/PowerShell deployment scripts.

---

## Accepted ON source of truth

The accepted behavior is the corrected operating-container retest recorded in `.tmp/card-reel-editorial-prompt-onoff/IMAGE-REPORT.md`: four decks, 18 Scene images, one image call per Scene, zero image retries, Card `1080x1080`, and Reel `1080x1920`. The implementation must include all four marketing corrections that were added after the first ON/OFF report:

1. Every marketing Proposal uses at least one directly relevant Research Evidence item and exposes that item’s actual `claimSummary` meaning in the Proposal; an ID alone is not compliance.
2. Subject, Product, Brand Core, References, and Research Evidence keep separate authority. A product subject is not rewritten as an unrelated Brand Core service case, and no unstated relationship is invented.
3. Every marketing Proposal preserves `purposeDetails.kind="marketing"` and the exact frozen `product.id`.
4. The final marketing planner preserves directly relevant Evidence supporting the selected Proposal in a non-CTA Scene even when approved product facts alone can complete the purchase explanation; it never transfers that Evidence into proof of product performance.

The later natural-copy decision is additive prompt guidance for user-visible Card/Reel fields. It is not a fifth runtime validator, a separate rewrite pass, a model call, a retry, or a schema change.

## Change boundaries

- No public API request/response shape, table, column, output contract, UI, image prompt, image-worker code, image size, scene count, model, reasoning effort, or tool-permission change.
- The only DB change is append-only Proposal prompt-lineage permission for the exact v4 tuple. There is no data rewrite, backfill, or deletion.
- API source changes only its exact generated-catalog/hash expectations; deployment tooling supplies the cutover support. Business payloads and endpoints remain unchanged.
- Card/Reel skill versions advance because their prompt behavior changes. Existing queued Card/Reel jobs are not bound to the old skill version and can be completed by the new workers.
- Proposal jobs are different: each queued job is bound to its Proposal prompt version. A v3 worker rejects v4 jobs and a v4 worker rejects v3 jobs, so Production rollout requires the Proposal-only maintenance sequence in Task 12.

```text
Research snapshot
      |
      v
Proposal API + Proposal Worker  -- proposal.writer.v4 --> 3 Proposal choices
      |                                                   |
      | user selection                                    v
      +------------------------------------------> frozen Proposal Lens
                                                          |
                                      +-------------------+-------------------+
                                      |                                       |
                                      v                                       v
                         Card Worker skill.v7                    Reel Worker skill.v8
                                      |                                       |
                                      +-------------------+-------------------+
                                                          |
                                                          v
                                          unchanged Image Worker / D2pp
```

### Engineering review result

- Architecture confidence: 9/10. The content architecture stays unchanged; the mixed v3/v4 Proposal interval is handled by a disabled-create/drain/swap/re-enable sequence instead of a compatibility layer.
- Code-quality confidence: 9/10. Prompt rules remain local to their owning workers. Card/Reel wording is deliberately mirrored and protected by equivalent tests rather than moved into a new cross-worker abstraction.
- Test confidence: 9/10 before an authorized Production sample. Existing accepted evidence covers four decks and 18 images; implementation adds source-equivalence, PostgreSQL application-role, mixed-version drain, deployment-contract, and operating-container verification.
- Performance confidence: 9/10. There is no extra model/image call or retry. Only prompt input length increases, and Task 10 records the actual byte/token delta before release.
- Remaining human input: choose the short Proposal-only transition window and, if desired, authorize the final real Production generation. All implementation, test, digest, migration, rollout, and evidence work is agent-executable.

## File map

### Prompt behavior

- Modify `workers/brand-pilot-content-proposal-worker/src/promptBuilder.ts`: add Card/Reel-only pre-editing and editorial-progression instructions; for marketing, bind every offered angle to directly relevant Evidence, prohibit invented Subject/Product/Brand Core relationships, and preserve exact marketing purpose/product identity; do not change Blog prompt behavior.
- Modify `workers/brand-pilot-content-proposal-worker/src/promptBuilder.test.ts`: cover four purpose/format cells, soft Proposal-field de-duplication, internal progression selection, all three corrected marketing Proposal rules, and Blog exclusion.
- Modify `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`: apply first/middle/final, Evidence-necessity, essential-information, optional-CTA, directly relevant marketing Evidence preservation, and natural user-visible copy rules; remove superseded strong-Evidence preservation pressure.
- Modify `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`: assert the new rules and the deliberate absence of Scene-2, density, and natural-copy validation gates.
- Modify `workers/brand-pilot-reel-worker/src/promptBuilder.ts`: mirror Card semantics in Reel Storyboard planning without adding three-second density limits or changing Reel media behavior.
- Modify `workers/brand-pilot-reel-worker/src/promptBuilder.test.ts`: mirror Card coverage and preserve Reel-specific source/browser behavior.

### Version lineage

- Modify `packages/brand-pilot-content-contracts/src/catalog.ts`: advance only `CONTENT_PROPOSAL_PROMPT_VERSION` to `proposal.writer.v4`.
- Regenerate `packages/brand-pilot-content-contracts/generated/content-catalog.json`, `packages/brand-pilot-content-contracts/generated/content-prompt-binding-v1.schema.json`, and any generator-selected hash-bearing artifacts.
- Modify generated-artifact/catalog tests only where exact v3 literals or hashes are intentionally superseded.
- Modify `apps/api/src/aiContentRepository.ts`: advance the exact current Proposal catalog/source/prompt hash assertions while preserving historical v3 fixtures.
- Modify `workers/brand-pilot-content-proposal-worker/src/contracts.ts`: advance the exact generated-catalog hash expected by the v4 worker.
- Create `db/migrations/091_ai_content_prompt_lineage_v4.sql`: preserve v2/v3 exact tuples and add the exact generated v4 tuple.
- Create `apps/api/src/aiContentPromptVersionMigration091.postgres.integration.test.ts`: prove v2/v3/v4 behavior with the application role.
- Modify `apps/api/src/aiContentProposalV2Repository.postgres.integration.test.ts`: prove the v4 API can drain an already stored v3 job without rewriting its lineage.
- Modify `apps/api/src/aiContentRepositoryV3.postgres.integration.test.ts`, `scripts/migrationRunner.mjs`, `scripts/migrationRunner.test.mjs`, `scripts/content-suggestion-schema-migration.test.mjs`, `scripts/deployment-contract.test.mjs`, `scripts/repository-contract.test.mjs`, `deploy/scripts/deploy.sh`, and exact API lineage fixtures that enumerate the latest migration or current v3 tuple.

### Scoped release and cutover

- Modify `scripts/release-impact.mjs` and `scripts/release-impact.test.mjs`: add an explicit one-release `card-reel-editorial-prompt-quality` profile that classifies Proposal prompt-lineage-only contract files as API/Proposal-worker impact, while Card/Reel source changes still rebuild those two workers. Do not weaken the default classification or rebuild/redeploy Blog or Image Worker solely because the Proposal prompt version changed.
- Modify `deploy/scripts/preflight.sh` and `scripts/deployment-contract.test.mjs`: permit `CONTENT_PROPOSALS_ENABLED=false` only when the operator supplies exact `AI_CONTENT_PROPOSAL_PROMPT_CUTOVER_MODE=true`; retain `true` as the ordinary fail-closed requirement.
- Modify `docs/operations/DEVELOPMENT_AND_RELEASE_FLOW.md`: document the v3-drain/v4-enable sequence, abort conditions, and rollback rule.

### One-off validation

- Keep all frozen source data, prompts, model outputs, images, and comparison artifacts ignored under `.tmp/card-reel-editorial-prompt-onoff/`.
- Reuse the exact informational and marketing fixtures referenced by the accepted report, including Production generation `743a7abc-15f8-4763-b291-bfcb89db634e`; do not refetch or reconstruct either fixture.
- Reuse the completed ON/OFF compiler/runner artifacts. Add only the implemented-source manifest/report required by Tasks 1 and 10.

The pre-implementation ON/OFF and corrected marketing retest are complete. Reuse their immutable hashes, prompts, results, and operating-container metadata under `.tmp/card-reel-editorial-prompt-onoff/`; do not rerun the superseded pre-retest matrix as implementation work. Post-implementation verification may prove that the shipped prompt matches the accepted ON semantics, but it must not add a validator or acceptance stage to the Product’s runtime execution path.

## Task 1: Freeze the already accepted validation evidence

**Files:**
- Read only: `.tmp/card-reel-editorial-prompt-onoff/IMAGE-REPORT.md`
- Read only: `.tmp/card-reel-editorial-prompt-onoff/REPORT.md`
- Read only: the prompt, result, manifest, hash, and container-metadata files referenced by `IMAGE-REPORT.md`

- [ ] **Step 1: Verify the accepted report points to complete corrected artifacts**

Confirm that all four matrix cells are present, all 18 Scene images are listed, every image invocation has one audit record, and the report identifies the corrected marketing ON prompt/result hashes. Do not substitute the earlier ON draft from `REPORT.md`.

- [ ] **Step 2: Record the accepted hashes in implementation evidence**

Create an ignored `accepted-on-manifest.json` containing the implementation-start Git SHA plus only paths, SHA-256 values, generation IDs, model/reasoning settings, container image digests, call counts, retry counts, and dimensions already proven by the accepted report. Do not copy credentials or Production data into a tracked file.

- [ ] **Step 3: Do not rerun the completed OFF matrix**

The purpose of later verification is source equivalence and Production-path safety, not another search for a better prompt. Any new output is compared to the accepted behavior; it does not silently redefine ON.

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

- [ ] **Step 3: Add corrected marketing Proposal tests**

For marketing Card News and Reel, assert all three accepted corrections from the operating-container retest:

```ts
expect(prompt).toContain("최소 1개의 직접 관련 Research Evidence ID");
expect(prompt).toContain("의무 충족 표식이 아니다");
expect(prompt).toContain("claimSummary");
expect(prompt).toContain("Subject, Product, Brand Core");
expect(prompt).toContain("명시하지 않은 관계를 새로 만들지 마라");
expect(prompt).toContain("purposeDetails.kind가 marketing");
expect(prompt).toContain("productId가 입력 product.id와 정확히 같은지");
```

Use a marketing fixture with a frozen product and non-empty Evidence Pool. Also assert these marketing-only instructions are absent from informational and Blog prompts.

- [ ] **Step 4: Add Blog exclusion tests**

Extend the existing Blog test:

```ts
expect(prompt).not.toContain("독자 또는 고객 상황");
expect(prompt).not.toContain("전개 방식을 내부적으로 선택");
expect(prompt).not.toContain("중심 payoff");
```

- [ ] **Step 5: Run the focused test and verify failure**

Run:

```powershell
npm test --workspace @brand-pilot/content-proposal-worker -- --run src/promptBuilder.test.ts
```

Expected: FAIL because the new editorial pre-editing and corrected marketing-binding strings are not yet in the prompt.

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

- [ ] **Step 3: Add the corrected marketing-only rule block**

Append these rules only when `purpose === "marketing"` and `outputFormat !== "blog"`:

```ts
const correctedMarketingEditorialRules = snapshot.outputSettings.purpose === "marketing"
  && snapshot.outputSettings.outputFormat !== "blog"
  ? [
      "각 안은 최소 1개의 직접 관련 Research Evidence ID를 evidenceIds에 포함해야 한다. evidenceIds는 의무 충족 표식이 아니다. 선택한 각 Evidence의 claimSummary가 target, customerContext, hook, keyMessage, oneLineIntent, outline 또는 selectionReason 중 적어도 하나의 구체적 의미로 드러나야 하며, 제품 자체가 그 Evidence를 입증한 것처럼 인과를 과장하지 마라. Evidence가 주제·대상·제품 판단 또는 제안한 효익을 직접 뒷받침하지 않으면 그 근거가 없는 관점·대상·상황·효익을 제안하지 마라.",
      "Subject, Product, Brand Core, References와 Research Evidence가 명시하지 않은 관계를 새로 만들지 마라. 특히 제품 주제를 서로 무관한 브랜드의 제품·서비스 사례, 성과 또는 고객 획득 방식으로 바꾸거나 연결하지 마라.",
      "제출 직전에 세 안 모두 purposeDetails.kind가 marketing이고 purposeDetails.productId가 입력 product.id와 정확히 같은지 확인하라. informational purposeDetails를 반환하거나 productId를 누락한 안은 현재 응답 안에서 수정한 뒤 제출하라.",
    ]
  : [];
```

Insert the block before the required output-field instruction. This is prompt content inside the existing single Proposal call. Do not add a new validator, model call, repair attempt, or output field. Keep the existing deterministic contract checks for purpose kind and product ID unchanged.

- [ ] **Step 4: Run focused Proposal tests**

Run:

```powershell
npm test --workspace @brand-pilot/content-proposal-worker -- --run src/promptBuilder.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Proposal behavior**

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

- [ ] **Step 5: Add corrected marketing Evidence and natural-copy tests**

For marketing prompts in both workers, assert the fourth correction proven by the retest:

```ts
expect(prompt).toContain("선택한 Proposal의 target, customerContext, angle 또는 핵심 판단");
expect(prompt).toContain("직접 뒷받침하는 Research Evidence");
expect(prompt).toContain("비-CTA Scene에 보존");
expect(prompt).toContain("제품 성과나 효능의 근거로 전이하지 마세요");
```

For informational and marketing prompts in both workers, assert the natural-copy block applies to all user-visible manuscript fields without adding an acceptance gate:

```ts
expect(prompt).toContain("headline, informationRelation, supportingTexts, footnote, content.caption, content.cta");
expect(prompt).toContain("구체적인 주체와 행동");
expect(prompt).toContain("익숙하고 자연스러운 한국어 어순");
expect(prompt).toContain("절대 금칙어가 아니라 반복 습관의 예시");
expect(prompt).toContain("같은 어미·문장 길이·문장 구조를 기계적으로 반복하지 마세요");
expect(prompt).toContain("고유명사·수치·조건·출처 단서·법적 고지·제품 사실은 보존");
expect(prompt).not.toContain("Natural-copy test");
expect(prompt).not.toContain("AI 말투 점수");
```

- [ ] **Step 6: Run both focused suites and verify failure**

Run:

```powershell
npm test --workspace @brand-pilot/card-news-worker -- --run src/promptBuilder.test.ts
npm test --workspace @brand-pilot/reel-worker -- --run src/promptBuilder.test.ts
```

Expected: FAIL on the new Evidence, scene, essential-information, CTA, corrected marketing-binding, and natural-copy expectations.

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

- [ ] **Step 6: Preserve directly relevant marketing Evidence in a non-CTA Scene**

Add the exact accepted retest behavior to the marketing purpose rules:

```ts
"선택한 Proposal의 target, customerContext, angle 또는 핵심 판단을 직접 뒷받침하는 Research Evidence를 식별하세요. 제품 사실만으로 구매 설명이 가능하더라도 그 Evidence를 제외하지 말고 실제 claimSummary를 사용한 비-CTA Scene에 보존하세요. 단, Evidence를 제품 성과나 효능의 근거로 전이하지 마세요."
```

This narrows the general Evidence-necessity rule only for Evidence already used to justify the selected marketing Proposal. It does not restore the superseded rule that every strong or remaining Evidence item must be displayed.

- [ ] **Step 7: Add natural Korean user-visible copy guidance**

Add one compact block after factual and purpose rules, before field-specific headline/supporting-text instructions:

```ts
"headline, informationRelation의 label·value, supportingTexts, footnote, content.caption, content.cta처럼 사용자가 실제로 읽는 문구에는 승인된 브랜드 규칙과 콘텐츠 목적을 먼저 적용하세요.",
"사용자 표시 문구는 추상명사와 보고서식 표현보다 구체적인 주체와 행동, 익숙하고 자연스러운 한국어 어순을 우선하세요.",
"~해야 합니다, ~할 수 있습니다, ~의 근거가 됐습니다, 핵심은 ~입니다, 확인해 보세요 같은 틀을 더 직접적인 문장으로 쓸 수 있는데도 여러 장면에서 습관적으로 반복하지 마세요. 이 표현들은 절대 금칙어가 아니라 반복 습관의 예시입니다.",
"모든 장면에서 같은 어미·문장 길이·문장 구조를 기계적으로 반복하지 마세요. 의미 없는 요약, 앞 문장의 재설명, 과장된 전환, 정보가 늘지 않는 억지 삼단 나열은 덜어내세요.",
"자연스럽게 보이기 위해 반말·속어·과장된 친근함이나 하나의 고정 화자를 강제하지 마세요. 고유명사·수치·조건·출처 단서·법적 고지·제품 사실은 의미를 바꾸거나 누락하지 마세요."
```

Do not apply this requirement to internal-only `purpose`, `coreMessage`, `deckNarrative`, or `storyNarrative`. Add no naturalness scorer, separate rewrite pass, runtime validator, repair attempt, or self-check gate.

- [ ] **Step 8: Update existing editorial self-check wording**

Add Reader-payoff, Topic-label, Promise-payoff, Scene-progression, Evidence-necessity, and Essential-information checks. Do not add Scene-2, First-glance, Simplicity, or density checks.

- [ ] **Step 9: Run Card tests**

Run:

```powershell
npm test --workspace @brand-pilot/card-news-worker -- --run src/promptBuilder.test.ts
npm test --workspace @brand-pilot/card-news-worker
```

Expected: PASS.

- [ ] **Step 10: Commit Card behavior**

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

Add the same first/middle/final, Evidence-necessity, essential-information, optional-marketing-CTA, directly relevant marketing Evidence, and natural user-visible copy instruction strings from Task 5. Preserve Reel-specific `storyNarrative`, source-browser, caption, audio/video, and output-shape behavior.

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
- Modify: `apps/api/src/aiContentRepository.ts:727-748`
- Modify: `workers/brand-pilot-content-proposal-worker/src/contracts.ts:35-52`
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

- [ ] **Step 5: Update exact current-catalog consumers from generated values**

Use only the values printed in Step 4:

- set `EXPECTED_PROPOSAL_CATALOG_SHA256` and the exact source/prompt/schema assertions in `apps/api/src/aiContentRepository.ts` to the generated v4 tuple;
- set `EXPECTED_CATALOG_SHA256` in `workers/brand-pilot-content-proposal-worker/src/contracts.ts` to the same catalog file hash;
- preserve the v3 values in migration 087 and historical v3 test branches;
- add or update tests that replace the generated catalog with a different hash/tuple and prove both processes still fail closed;
- add a Proposal-worker contract test that changes an otherwise valid claimed job to `proposal.writer.v3` and expects `content_proposal_claim_contract_mismatch`. This proves the worker itself is not dual-version and makes the Task 12 drain mandatory.

- [ ] **Step 6: Run content-contract, Proposal-worker, and API type tests**

First identify every current-version literal before editing fixtures:

```powershell
rg -n "proposal\.writer\.v3|415ca40b3dc3616affab6642b437ecd6b148bf70f017638640e2a4f858aaf808|ecada3861313486b50e0a1475d89284f13fe4a74018207d11f205613deefb550" packages apps scripts deploy db
```

Preserve historical v3 constants in migration 087 and the v2/v3 branches of lineage regression tests. Update only fixtures representing the current catalog/contract.

```powershell
npm test --workspace @brand-pilot/content-contracts
npm test --workspace @brand-pilot/content-proposal-worker -- --run src/contracts.test.ts
npm run typecheck --workspace @brand-pilot/api
```

Expected: PASS after exact v4 fixture updates.

- [ ] **Step 7: Commit lineage source and generated artifacts**

```powershell
git add -- packages/brand-pilot-content-contracts apps/api/src/aiContentRepository.ts workers/brand-pilot-content-proposal-worker/src/contracts.ts workers/brand-pilot-content-proposal-worker/src/contracts.test.ts
git commit -m "feat(ai-content): version proposal editorial prompt v4"
```

Stage only files actually changed by the version/catalog update.

## Task 8: Add the append-only v4 DB lineage migration

**Files:**
- Create: `db/migrations/091_ai_content_prompt_lineage_v4.sql`
- Create: `apps/api/src/aiContentPromptVersionMigration091.postgres.integration.test.ts`
- Modify: `apps/api/src/aiContentProposalV2Repository.postgres.integration.test.ts`
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

Add a repository integration case that creates a valid stored v3 Proposal job/contract, runs the current v4 API repository claim and completion path, and proves:

- the returned claim keeps `proposalPromptVersion="proposal.writer.v3"`;
- the stored v3 contract hashes are not rewritten;
- a valid v3 worker completion reaches `completed`;
- the same current API enqueues new jobs only with v4.

This is the executable proof that the old v3 worker can drain historical jobs after the v4 API is promoted with new Proposal creation disabled.

- [ ] **Step 2: Run the new integration test and verify failure**

Run:

```powershell
npm test --workspace @brand-pilot/api -- --run src/aiContentPromptVersionMigration091.postgres.integration.test.ts
```

Run the mixed-version drain test separately:

```powershell
npm test --workspace @brand-pilot/api -- --run src/aiContentProposalV2Repository.postgres.integration.test.ts
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
npm test --workspace @brand-pilot/api -- --run src/aiContentPromptVersionMigration091.postgres.integration.test.ts src/aiContentProposalV2Repository.postgres.integration.test.ts
node --test scripts/migrationRunner.test.mjs scripts/deployment-contract.test.mjs scripts/repository-contract.test.mjs
```

Expected: PASS. The PostgreSQL test must execute with the non-owner application role for inserts.

- [ ] **Step 6: Commit the migration**

```powershell
git add -- db/migrations/091_ai_content_prompt_lineage_v4.sql apps/api/src/aiContentPromptVersionMigration091.postgres.integration.test.ts apps/api/src/aiContentProposalV2Repository.postgres.integration.test.ts apps/api/src/aiContentRepositoryV3.postgres.integration.test.ts scripts/migrationRunner.mjs scripts/migrationRunner.test.mjs scripts/content-suggestion-schema-migration.test.mjs scripts/deployment-contract.test.mjs scripts/repository-contract.test.mjs deploy/scripts/deploy.sh
git commit -m "feat(db): allow proposal prompt lineage v4"
```

## Task 9: Keep the release impact and Proposal cutover scoped

**Files:**
- Modify: `scripts/release-impact.mjs`
- Modify: `scripts/release-impact.test.mjs`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `docs/operations/DEVELOPMENT_AND_RELEASE_FLOW.md`

- [ ] **Step 1: Add failing tests for a dedicated scoped release profile**

Export a new profile name `card-reel-editorial-prompt-quality`. Under that explicit profile, add one test where the changed files are only the Proposal lineage source/generated files and assert the enabled components are exactly `api` and `contentProposalWorker`. Add a second test with the final prompt files and assert exactly `api`, `contentProposalWorker`, `cardNewsWorker`, and `reelWorker`; `blogWorker` and `imageWorker` must remain false. Add a default-profile regression test proving the same `catalog.ts` path still retains its existing broad fail-safe classification.

- [ ] **Step 2: Classify Proposal-lineage-only paths only inside that profile**

Add an exact path set for:

```text
packages/brand-pilot-content-contracts/src/catalog.ts
packages/brand-pilot-content-contracts/generated/content-catalog.json
packages/brand-pilot-content-contracts/generated/content-prompt-binding-v1.schema.json
```

When one of these paths changes under the explicit editorial profile, mark only API and Content Proposal Worker. Keep the existing default and every other scoped profile unchanged, so a future unrelated edit to `catalog.ts` still fails broad. Keep the broad all-consumer classification for every other content-contract source/schema change in the new profile. If the generator changes another file in Task 7, inspect its consumers before adding it to the narrow set; do not suppress a real runtime dependency.

- [ ] **Step 3: Add a failing preflight test for explicit Proposal maintenance**

Cover all cases:

```text
mode absent + CONTENT_PROPOSALS_ENABLED=true  -> pass
mode absent + CONTENT_PROPOSALS_ENABLED=false -> fail
mode=true   + CONTENT_PROPOSALS_ENABLED=false -> pass
mode=true   + CONTENT_PROPOSALS_ENABLED=true  -> fail
mode=other                                    -> fail
```

- [ ] **Step 4: Implement the fail-closed preflight branch**

In `deploy/scripts/preflight.sh`, replace only the fixed Proposal flag check with:

```bash
case "${AI_CONTENT_PROPOSAL_PROMPT_CUTOVER_MODE:-false}" in
  false) require_exact_boolean "CONTENT_PROPOSALS_ENABLED" "true" "$API_ENV_FILE" ;;
  true) require_exact_boolean "CONTENT_PROPOSALS_ENABLED" "false" "$API_ENV_FILE" ;;
  *) fail "proposal_prompt_cutover_mode_invalid" ;;
esac
```

Do not weaken any other production flag. This mode changes no API behavior by itself; it only permits the existing Proposal kill switch to be false during the coordinated v3/v4 transition.

- [ ] **Step 5: Document the exact operator sequence and abort boundary**

Document Task 12’s order and require the release-impact invocation to name `card-reel-editorial-prompt-quality` explicitly. State that an aborted rollout leaves `CONTENT_PROPOSALS_ENABLED=false` until a compatible API/Proposal-worker pair is restored and verified. Never re-enable merely because a script exited.

- [ ] **Step 6: Run and commit the scoped deployment tests**

```powershell
node --test scripts/release-impact.test.mjs scripts/deployment-contract.test.mjs
git add -- scripts/release-impact.mjs scripts/release-impact.test.mjs deploy/scripts/preflight.sh scripts/deployment-contract.test.mjs docs/operations/DEVELOPMENT_AND_RELEASE_FLOW.md
git commit -m "chore(deploy): fence proposal prompt v4 cutover"
```

## Task 10: Prove the implemented source matches the accepted corrected ON

**Files:**
- Create ignored: `.tmp/card-reel-editorial-prompt-onoff/implemented-on-manifest.json`
- Create ignored: `.tmp/card-reel-editorial-prompt-onoff/implemented-on-report.md`
- Reuse ignored accepted fixtures, jobs, prompts, results, and image outputs referenced by `IMAGE-REPORT.md`

- [ ] **Step 1: Compile all four prompts from tracked Production builders**

Use the exact frozen informational and marketing inputs from the accepted report. Compile Proposal and final-planner prompts for informational Card, informational Reel, marketing Card, and marketing Reel. Assert the input JSON hashes, product ID, selected Proposal Lens, Evidence Pool, `assetCount`, model, reasoning, permissions, and browser setting are unchanged.

- [ ] **Step 2: Compare source prompt semantics against corrected ON**

Require the tracked prompts to contain every accepted corrected rule and the approved natural-copy block. Diff against the accepted corrected ON prompt after normalizing only generated contract-version/hash lines. Fail if the tracked prompt adds a schema field, Scene-2 rule, density gate, image instruction, tool permission, retry, or runtime naturalness check.

- [ ] **Step 3: Record prompt-size impact**

Record UTF-8 bytes and estimated tokens for each accepted/tracked prompt. The expected runtime delta is prompt input only: model-call count, retry policy, image-call count, and render dimensions remain identical. Investigate only if a runner input limit is approached; do not introduce an arbitrary density or copy limit.

- [ ] **Step 4: Run the four tracked-source text flows in operating-equivalent containers**

Run Proposal inside the operating Proposal container environment and Card/Reel inside their operating planner container environments. Use exactly one normal attempt per stage; allow only the existing schema-repair path and record it. Validate with the unchanged Production parsers and require all four flows to pass.

- [ ] **Step 5: Re-render the 18 Scene images through the operating Image Worker**

Feed the four new validated planner outputs to the unchanged image worker one Scene at a time. Require 18 output PNGs, 18 audited image calls, zero image retries, Card `1080x1080`, and Reel `1080x1920`. This is release verification, not a new application runtime gate.

- [ ] **Step 6: Compare quality without redefining ON**

The report must confirm the four marketing corrections, first/middle/final progression, optional CTA behavior, visible essential facts, and natural Korean user-visible copy. Record stochastic differences separately. If the new natural-copy guidance causes fact loss, entity confusion, or a contract failure, revise only that prompt block and repeat this task; do not add a validator/model pass.

## Task 11: Run full pre-deployment verification

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
npm test --workspace @brand-pilot/api -- --run src/aiContentPromptVersionMigration091.postgres.integration.test.ts src/aiContentProposalV2Repository.postgres.integration.test.ts
npm run typecheck --workspace @brand-pilot/api
```

Expected: PASS; PostgreSQL application-role test is executed, not skipped.

- [ ] **Step 3: Run repository and deployment contract checks**

```powershell
npm run check:generated --workspace @brand-pilot/content-contracts
node --test scripts/migrationRunner.test.mjs scripts/deployment-contract.test.mjs scripts/repository-contract.test.mjs scripts/release-impact.test.mjs
git diff --check
```

Expected: PASS and no whitespace errors.

- [ ] **Step 4: Inspect final scope**

```powershell
git status --short
$implementationBaseSha = (Get-Content -LiteralPath '.tmp/card-reel-editorial-prompt-onoff/accepted-on-manifest.json' -Raw | ConvertFrom-Json).implementationStartGitSha
git diff --stat "$implementationBaseSha..HEAD"
git diff --name-only "$implementationBaseSha..HEAD"
```

Expected tracked scope: Proposal/Card/Reel prompt code and tests, catalog/generated lineage artifacts, API/Proposal exact lineage consumers, DB migration, migration/deployment registration, scoped release-impact/preflight/docs changes, and this plan/spec history only. No UI, Image Worker source, Research Worker, Blog Worker source, public API schema, or Production data file changes.

- [ ] **Step 5: Keep one-off evidence untracked**

Run `git status --short --ignored .tmp/card-reel-editorial-prompt-onoff` and verify every fixture, prompt, model output, and report line is prefixed by `!!`. Do not commit `.tmp` inputs, model outputs, credentials, or Production snapshots.

## Task 12: Deploy option 1A with a Proposal-only v3/v4 transition window

**Affected runtime services:** API, Content Proposal Worker, Card News Worker, Reel Worker. Image Worker and Blog Worker keep their current verified digests and are not recreated.

- [ ] **Step 1: Establish exact Production and rollback identities**

Before mutation, fetch remote `main`, record the release commit, current Production release SHA, actual running image digests, dirty worktree/hotfix state, worker restart counts, and current `/health` and `/ready`. Preserve the current API/Proposal/Card/Reel digests as per-service rollback targets. Stop if the running source/digest differs from the expected current release or an unrelated hotfix would be overwritten.

- [ ] **Step 2: Build and publish only affected immutable images**

Build API, Content Proposal Worker, Card News Worker, and Reel Worker from the exact release commit. Pin all four by digest in the release manifest. Reuse the current Image Worker and Blog Worker digest entries. Verify the embedded source revision of every candidate image before deployment.

- [ ] **Step 3: Enter Proposal prompt cutover mode without changing the running v3 primary yet**

Atomically change the shared API env’s single `CONTENT_PROPOSALS_ENABLED` line from `true` to `false`, preserving owner and mode `0600`. Run deploy/preflight with `AI_CONTENT_PROPOSAL_PROMPT_CUTOVER_MODE=true`. The currently running v3 API retains its already loaded `true` value until promotion, so existing behavior continues during canary preparation.

- [ ] **Step 4: Apply migration 091 and deploy the v4 API canary**

Run the normal candidate deployment. Require migration evidence for exact `091` ID/SHA and verify the candidate API advertises `contentProposals=disabled`. Exercise read-only health/contracts only; do not enqueue a v4 Proposal while the v3 worker is active.

- [ ] **Step 5: Promote the v4 API with Proposal creation still disabled**

Promote with `AI_CONTENT_PROPOSAL_PROMPT_CUTOVER_MODE=true`. Verify the new primary is healthy, ready, on the candidate API digest, and returns the expected disabled response for a non-mutating Proposal-readiness probe. At this point new Proposal writes are unavailable; other API functions remain live.

- [ ] **Step 6: Drain every v3 Proposal job through the still-running v3 worker**

The v4 API claim/completion path accepts stored historical v3 job contracts, while the v3 worker continues to enforce v3. Poll a read-only status count until both are zero:

```sql
select status,count(*)::integer
from public.ai_content_proposal_jobs
where status in ('queued','processing')
group by status order by status;
```

Also require zero unexpired Proposal leases. Do not cancel, rewrite, relabel, or migrate queued jobs. If a v3 job cannot reach a terminal state through its existing retry policy, stop and investigate that exact job before replacing the worker.

- [ ] **Step 7: Replace the changed workers**

After the v3 Proposal queue and leases are zero, stop the old Proposal worker and run the scoped worker rollout. Require the changed-service set to be exactly Content Proposal, Card News, and Reel; Image and Blog must not be in the recreate command. Verify each new service’s digest, running state, fresh boot heartbeat, and restart count. Keep Proposal creation disabled throughout this step.

- [ ] **Step 8: Re-enable Proposal creation only after the v4 pair is proven compatible**

Atomically restore `CONTENT_PROPOSALS_ENABLED=true`, run ordinary preflight without cutover mode, and recreate every ordinary API instance so the flag is loaded consistently. Require API `/health`, `/ready`, `features.contentProposals=enabled`, and a fresh v4 Proposal-worker heartbeat before considering the transition window closed.

- [ ] **Step 9: Apply the fail-closed abort rule**

If migration, API promotion, drain, worker rollout, heartbeat, or API re-enable verification fails, leave Proposal creation disabled. Restore only the affected services to a compatible pair: v4 API with v4 Proposal worker, or—only after all v4-bound jobs are drained—v3 API with v3 Proposal worker. Migration 091 remains because it is append-only and still permits v2/v3 tuples.

## Task 13: Verify the real Production path and rollback readiness

- [ ] **Step 1: Verify deployed identity and DB lineage read-only**

Confirm the external API revision, all four changed image digests, unchanged Image/Blog digests, migration 091 checksum, exact v4 Proposal contract/binding tuple, worker heartbeats, restart counts, and recent error logs. Check for `content_proposal_claim_contract_mismatch`, schema/parser failures, retries, and render errors.

- [ ] **Step 2: Run only an authorized Production generation**

If the user has supplied or approved a real Production test subject, run one complete API/DB/queue path and inspect its generation ID, Proposal lineage `proposal.writer.v4`, Card/Reel skill version, attempt count, selected/excluded Evidence, Scene outputs, image-call audits, and final media. Do not create synthetic Production customer data solely to satisfy this step. If no Production write is authorized, report this step as not run and do not describe the operating-container test as a Production-path sample.

- [ ] **Step 3: Compare the Production result to accepted behavior**

Require unchanged schemas and render dimensions, directly relevant marketing Evidence where applicable, separated Subject/Product attribution, correct marketing product ID, first/middle/final payoff, optional CTA use, and natural user-visible Korean. Quality comparison is evidence for rollout acceptance, not a runtime validator or retry trigger.

- [ ] **Step 4: Prove rollback is executable**

Record the commands and fixed digests for restoring only API, Content Proposal Worker, Card News Worker, and Reel Worker. Before any v4-to-v3 rollback, set Proposal creation false and drain all queued/processing v4 Proposal jobs with the v4 worker; an old v3 worker must never be started against v4-bound jobs. Keep migration 091 installed.

## Task 14: Hand off the completed Production result

- [ ] **Step 1: Report implementation and release evidence**

Include commit IDs, release SHA, affected and deliberately unchanged services, exact test commands/results, application-role DB result, accepted/retest report paths, image counts/retries, deployed digests, health/readiness, heartbeat/restart/log results, and any authorized Production generation ID.

- [ ] **Step 2: Separate passed, failed, and not-run evidence**

Do not call the rollout complete until the real Production containers and external health checks pass. If the authorized Production generation in Task 13 was not run, state that explicitly while reporting the pre-deployment operating-container result separately.
