# Card Manuscript and Shared Visual Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production Research를 independent-Claim Evidence와 수집 완전성 기반 보충 조사로 보강하고, 새 수동 카드뉴스를 디자인 필드 없는 `card-manuscript-plan.v1`로 전환하며, 카드뉴스와 릴스 모두 콘텐츠 1건당 하나의 공유 Codex context에서 장면별 `image_generation`을 순차 실행하되 브랜드 스타일 이미지를 우선 시각 기준으로 사용한다.

**Architecture:** 카드뉴스의 의미 원본은 `CardManuscriptPlanV1` 하나이며 기존 Deck 계약으로 되돌아가는 호환 경로를 만들지 않는다. API는 기존 `ai_content_generation_render_jobs`의 장면별 행을 유지하되 같은 Card/Reel output의 모든 이미지 행을 한 트랜잭션에서 묶어 임대하고, Image Worker는 참조 파일을 한 번 stage한 뒤 한 Codex 실행에서 장면 수만큼 순차 생성한다. 릴스는 현재 `reel-storyboard.v1` 의미·원고 계약과 영상 finalizer를 유지하되, 렌더 prompt에서는 storyboard의 디자인 결정 필드를 권위로 사용하지 않고 카드와 동일한 브랜드 스타일 우선·단일 매체·표시문구 allowlist 정책을 적용한다.

**Tech Stack:** TypeScript, TypeBox, Vitest, PostgreSQL/PGlite, Fastify, Node.js Codex runner, `gpt-5.6-terra`, `gpt-image-2`.

---

## 범위와 비범위

이번 구현에 포함한다.

- 새 수동 카드뉴스의 `card-deck-editorial-plan.v1` 제거와 `card-manuscript-plan.v1` hard cutover
- Proposal = Editorial Lens, 전체 frozen Research Evidence Pool = 사실 원천
- Evidence 1개 = 독립 Claim 1개, 동일 URL의 서로 다른 Claim 허용, 최대 8개는 Claim 제한
- source acquisition completeness를 새 manual Card/Reel proposal job의 private sidecar로 동결
- 원문 수집이 불완전하면 기존 Research invocation 안에서 실제 audited supplemental query 필수
- `informationRelation.related_facts`를 포함한 의미 관계 검증
- Card/Reel output 단위 batch claim, group heartbeat, atomic group completion/failure
- Card/Reel 공통 visual-session policy
- 브랜드 스타일 참조가 있으면 해당 이미지가 primary visual reference
- 브랜드 스타일 참조가 없으면 이미지 모델이 한 번 자유롭게 주 매체를 선택하고 전체 장면에서 유지
- 장면별 composition은 달라도 주 매체는 바꾸지 않음
- prompt와 display allowlist는 locked copy와 필수 브랜드 문구 외 새 설명 문구를 허용하지 않음
- 페이지 번호 생성 금지 문구 유지, 번호가 생겨도 OCR·재시도·실패 없음
- Card/Reel 각 장면별 이미지 호출 수는 기존과 동일하게 1회

이번 구현에서 제외한다.

- Proposal 재생성 구조 변경
- 릴스 원고 계약인 `reel-storyboard.v1` 교체 또는 필드 삭제
- 블로그, UI, 게시, 다운로드, 자동 콘텐츠 생성, DB migration
- 보조 Codex 계정, 이전 생성 이미지의 reference 재사용, OCR 품질 판정, 이미지 재시도 추가
- D2-double-prime에서 우연히 나온 `editorial illustration`의 기본값 고정

릴스의 기존 `visualSystem`, `visualThesis`, `layoutArchetype`은 이번에 DB/원고 계약에서 삭제하지 않는다. 다만 새 visual-session projection에는 포함하지 않아 이미지 렌더 디자인 권위가 되지 않는다. 릴스 원고 계약 자체를 단순화하는 작업은 별도 승인 범위다.

## 파일 구조

새 파일:

- `packages/brand-pilot-content-contracts/src/researchSourceAcquisition.ts`: API/Proposal Worker가 함께 쓰는 private `research-source-acquisition.v1` exact parser
- `packages/brand-pilot-content-contracts/src/researchSourceAcquisition.test.ts`: acquisition 상태·키·URL/hash 경계 테스트
- `packages/brand-pilot-content-contracts/src/cardManuscriptPlan.ts`: 카드 Manuscript schema, parser, evidence 검증, deterministic projection
- `packages/brand-pilot-content-contracts/src/cardManuscriptPlanNode.ts`: canonical SHA-256
- `packages/brand-pilot-content-contracts/src/cardManuscriptPlan.test.ts`: 계약·projection 테스트
- `packages/brand-pilot-content-contracts/src/visualRenderSession.ts`: Card/Reel 공통 output-scoped visual session projection
- `packages/brand-pilot-content-contracts/src/visualRenderSession.test.ts`: reference precedence·표시문구·매체 정책 테스트
- `workers/brand-pilot-card-news-worker/src/manuscriptPlan.ts`: planner 결과 로드·검증·projection
- `workers/brand-pilot-card-news-worker/src/manuscriptPlan.test.ts`: worker 경계 테스트
- `workers/brand-pilot-card-news-worker/scripts/run-codex-card-manuscript-plan.mjs`: Manuscript planner runner
- `workers/brand-pilot-card-news-worker/scripts/card-manuscript-plan-v1.schema.json`: provider output용 packaged schema
- `workers/brand-pilot-image-worker/src/aiContentVisualSessionPromptCompiler.ts`: format-neutral session prompt와 장면 prompt compiler
- `workers/brand-pilot-image-worker/src/aiContentVisualSessionPromptCompiler.test.ts`: Card/Reel prompt 보존 테스트
- `workers/brand-pilot-image-worker/src/aiContentVisualSessionRenderer.ts`: 참조 1회 stage, Codex 1회, N개 PNG 반환
- `workers/brand-pilot-image-worker/src/aiContentVisualSessionRenderer.test.ts`: 순차 호출·lease abort·출력 검증
- `workers/brand-pilot-image-worker/src/aiContentVisualSessionRunnerContract.ts`: exact scene-indexed runner input/output parser
- `workers/brand-pilot-image-worker/src/aiContentVisualSessionRunnerContract.test.ts`: missing/duplicate/extra scene 및 tool-call audit 테스트

수정 파일:

- `packages/brand-pilot-content-contracts/package.json`
- `packages/brand-pilot-content-contracts/src/index.ts`
- `packages/brand-pilot-content-contracts/src/generateArtifacts.ts`
- `workers/brand-pilot-card-news-worker/src/contracts.ts`
- `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`
- `workers/brand-pilot-card-news-worker/src/sourceBundle.ts`
- `workers/brand-pilot-card-news-worker/src/worker.ts`
- `workers/brand-pilot-card-news-worker/src/worker.test.ts`
- `workers/brand-pilot-card-news-worker/src/index.ts`
- `workers/brand-pilot-card-news-worker/src/productionRuntime.test.ts`
- `workers/brand-pilot-card-news-worker/src/codexAccountFailover.test.ts`
- `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`
- `workers/brand-pilot-card-news-worker/Dockerfile`
- `workers/brand-pilot-card-news-worker/.env.example`
- `workers/brand-pilot-card-news-worker/.agents/skills/card-news-creator/SKILL.md`
- `workers/brand-pilot-content-proposal-worker/src/contracts.ts`
- `workers/brand-pilot-content-proposal-worker/src/client.ts`
- `workers/brand-pilot-content-proposal-worker/src/research.ts`
- `workers/brand-pilot-content-proposal-worker/src/research.test.ts`
- `workers/brand-pilot-content-proposal-worker/src/worker.test.ts`
- `workers/brand-pilot-worker-runtime/src/controlledSearch.ts`
- `workers/brand-pilot-worker-runtime/src/controlledSearch.test.ts`
- `workers/brand-pilot-image-worker/src/aiContentRenderClient.ts`
- `workers/brand-pilot-image-worker/src/aiContentRenderClient.test.ts`
- `workers/brand-pilot-image-worker/src/aiContentAssetRenderer.ts`
- `workers/brand-pilot-image-worker/src/aiContentAssetRenderer.test.ts`
- `workers/brand-pilot-image-worker/src/aiContentAssetRunnerContract.ts`
- `workers/brand-pilot-image-worker/src/aiContentAssetRunnerContract.test.ts`
- `workers/brand-pilot-image-worker/src/productionRuntime.test.ts`
- `workers/brand-pilot-image-worker/src/skillContract.test.ts`
- `workers/brand-pilot-image-worker/test/fixtures/manualRender.ts`
- `workers/brand-pilot-image-worker/src/worker.ts`
- `workers/brand-pilot-image-worker/src/worker.test.ts`
- `workers/brand-pilot-image-worker/scripts/run-codex-ai-content-asset.mjs`
- `workers/brand-pilot-image-worker/.codex/skills/image-render/SKILL.md`
- `apps/api/src/aiContentContracts.ts`
- `apps/api/src/aiContentSeedResolver.ts`
- `apps/api/src/aiContentSeedResolver.test.ts`
- `apps/api/src/contentOrchestration.ts`
- `apps/api/src/contentOrchestration.test.ts`
- `apps/api/src/contentProposalJobs.ts`
- `apps/api/src/contentProposalJobs.test.ts`
- `apps/api/src/aiContentPlanContracts.ts`
- `apps/api/src/aiContentRenderJobs.ts`
- `apps/api/src/aiContentRenderJobs.pglite.test.ts`
- `apps/api/src/aiContentRenderJobs.test.ts`
- `apps/api/src/aiContentRepository.ts`
- `apps/api/src/httpServer.ts`
- `apps/api/src/server.aiContentWorker.test.ts`
- `apps/api/src/server.aiContentRenderWorker.test.ts`
- `scripts/three-format-cutover-static-check.mjs`
- `scripts/three-format-cutover-static-check.test.mjs`
- `scripts/release-impact.mjs`
- `scripts/release-impact.test.mjs`
- `scripts/incremental-cicd-contract.test.mjs`
- `scripts/canonical-format-schema-runtime.test.mjs`
- `scripts/content-account-pool-deployment.test.mjs`
- `deploy/env/card-news-worker.env.example`

제거 파일:

- `packages/brand-pilot-content-contracts/src/cardDeckEditorialPlan.ts`
- `packages/brand-pilot-content-contracts/src/cardDeckEditorialPlanNode.ts`
- `packages/brand-pilot-content-contracts/src/cardDeckEditorialPlan.test.ts`
- `workers/brand-pilot-card-news-worker/src/deckPlan.ts`
- `workers/brand-pilot-card-news-worker/src/deckPlan.test.ts`
- `workers/brand-pilot-card-news-worker/scripts/run-codex-card-deck-plan.mjs`
- `workers/brand-pilot-card-news-worker/scripts/card-deck-editorial-plan-v1.schema.json`
- `workers/brand-pilot-image-worker/src/aiContentCardDeckPromptCompiler.ts`
- `workers/brand-pilot-image-worker/src/aiContentCardDeckPromptCompiler.test.ts`
- `workers/brand-pilot-image-worker/src/aiContentCardDeckRenderContract.ts`
- `workers/brand-pilot-image-worker/src/aiContentCardDeckRenderContract.test.ts`

## Task 0: Production Research independent-Claim cutover

**Files:**
- Create: `packages/brand-pilot-content-contracts/src/researchSourceAcquisition.ts`
- Create: `packages/brand-pilot-content-contracts/src/researchSourceAcquisition.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/index.ts`
- Modify: `packages/brand-pilot-content-contracts/src/generateArtifacts.ts`
- Modify: `packages/brand-pilot-content-contracts/package.json`
- Modify: `apps/api/src/aiContentSeedResolver.ts`
- Modify: `apps/api/src/aiContentSeedResolver.test.ts`
- Modify: `apps/api/src/contentOrchestration.ts`
- Modify: `apps/api/src/contentOrchestration.test.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/contentProposalJobs.ts`
- Modify: `apps/api/src/contentProposalJobs.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/client.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/research.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/research.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-worker-runtime/src/controlledSearch.ts`
- Modify: `workers/brand-pilot-worker-runtime/src/controlledSearch.test.ts`

- [ ] **Step 1: source acquisition sidecar RED 작성**

`aiContentSeedResolver` fixture에서 정상 본문, 잘린 본문, metadata fallback, 402/403/429,
network/parser indeterminate, topic text/reference를 각각 다음 exact 상태로 고정한다.

```ts
expect(result.researchSourceAcquisition).toEqual({
  contractVersion: "research-source-acquisition.v1",
  status: "partial_body",
  requestedUrl,
  canonicalUrl,
  contentHash,
  capturedAt,
});
```

본문 fallback 문구를 파싱해 상태를 추론하는 구현은 금지한다. 상태는 resolver의 실제 분기에서 직접
만든다.

- [ ] **Step 2: 새 manual Card/Reel proposal job envelope 동결 RED 작성**

새 manual proposal batch의 `input_snapshot_json`이 정확히
`baseInput`, `replayFingerprint`, `resumeInput`, `researchSourceAcquisition` 네 키를 가지며 같은
sidecar가 leased Research claim까지 value-exact 전달되는지 검증한다. Historical completed row의
세 키 envelope는 read/history에서만 계속 읽고, 새 Research claim은 sidecar 없는 queued row를 받지
않는다. Sidecar는 customer DTO와 Proposal model prompt에는 직접 노출하지 않는다. Markerless
scheduled/automatic job은 이 branch에 들어오지 않으며 해당 별도 경로의 Evidence semantics를 이번
변경으로 바꾸지 않는다.

- [ ] **Step 3: 동일 URL 복수 Claim RED 작성**

같은 URL에서 서로 다른 `claimSummary` 4개를 반환하는 controlled-search fixture를 실행한다.

```ts
expect(result.items).toHaveLength(4);
expect(new Set(result.items.map((item) => item.url))).toHaveLength(1);
expect(new Set(result.items.map((item) => item.id))).toHaveLength(4);
```

같은 URL과 같은 normalized claim은 1개로 dedupe하고, 다른 Claim은 유지한다. 최대 8은 Claim
개수에 적용한다. URL fetch/open dedupe는 유지한다.

Claim dedupe key는 tracking parameter를 제거한 canonical URL과 `NFC -> trim -> whitespace
collapse`만 적용한 `claimSummary`의 조합이다. 기존 `contentHash`는 API의 exact 검증과 호환되도록
변경하지 않는다. 의미 유사도·keyword heuristic·한 URL당 1개 제한은 추가하지 않는다.

- [ ] **Step 4: 불완전 수집 supplemental query RED 작성**

`partial_body`, `metadata_only`, `access_failed`, `indeterminate` 각각에서 실제 Codex audit에
search action + nonempty query가 없으면 `controlled_search_supplemental_required`로 실패해야 한다.
모델 최종 JSON에만 임의 query가 있어도 실패한다. 반대로 audit에서 실행된 query가 있으면 결과의
`researchEvidence.queries`는 모델이 다시 쓴 문자열이 아니라 audited query 문자열로 저장된다.
`complete_body`와 `not_applicable`은 이 추가 query 의무만 면제하며 기존 informational Evidence
요건은 유지한다.

- [ ] **Step 5: 한 invocation에서 primary Claim + supplemental Claim 생성 GREEN 구현**

Research prompt에 available frozen source title/body/URLs와 acquisition sidecar를 닫힌 untrusted data
envelope로 전달한다. 한 번의 기존 search-enabled Codex invocation에서:

1. 이용 가능한 원문에서 독립 Claim들을 추출하고,
2. acquisition이 불완전하면 supplemental query를 실제 실행하며,
3. primary/supplemental source의 독립 Claim을 합쳐 claim identity로 dedupe하고,
4. 정보 가치가 높은 Claim을 최대 8개로 제한한다.

특정 URL, 수치, 카드 구성은 prompt/test에 하드코딩하지 않는다. 추가 모델 호출이나 Proposal
재생성은 없다. 최대 50,000자 frozen body는 기존 snapshot limit 안에서만 전달하며 외부 본문은
instruction 영역에 보간하지 않는다. pseudo-tag, `&`, U+2028/U+2029, 지시문 형태의 원문이 닫힌
escaped envelope를 벗어나지 않는 prompt-injection RED를 포함한다.

topic-text/reference acquisition은 `not_applicable`이지만 정보 입력이 비어 있다는 뜻은 아니다.
현재 사용자가 선택해 동결한 subject text와 reference text가 사실 원천으로 쓰이는 경로라면 한 번만
bounded untrusted source context에 투영한다. 이미지 reference의 픽셀만으로 새로운 factual Claim을
추론하지 않는다. 같은 본문을 여러 envelope/key에 중복 복제하지 않는다.

`ControlledSearchInput`의 private 실행 모드는 sidecar가 있는 새 manual Card/Reel job에서만
`evidenceGranularity: "independent_claim"`을 사용한다. Markerless scheduled/automatic caller는 현재
기본 동작을 유지하여 별도 자동 생성 작업을 침범하지 않는다.

권위 gate는 worker payload만 신뢰하지 않고 서버가 잠근 `batch.origin === "manual"`, exact supported
sidecar, `outputFormat in {card_news,reel}`을 모두 확인한다. Sidecar가 없거나 unsupported/null/orphan
state인 새 manual row는 legacy branch로 우회하지 않고 fail closed한다. API와 Proposal Worker는 같은
`researchSourceAcquisition.ts` parser를 import하며 parser를 각 패키지에 복제하지 않는다.

- [ ] **Step 6: Research focused GREEN 확인**

Run:

```bash
npx vitest run packages/brand-pilot-content-contracts/src/researchSourceAcquisition.test.ts apps/api/src/aiContentSeedResolver.test.ts apps/api/src/contentOrchestration.test.ts apps/api/src/contentProposalJobs.test.ts
npx vitest run workers/brand-pilot-worker-runtime/src/controlledSearch.test.ts workers/brand-pilot-content-proposal-worker/src/research.test.ts workers/brand-pilot-content-proposal-worker/src/worker.test.ts
```

Expected: 동일 URL 복수 Claim, exact sidecar propagation, audited supplemental query, old completed
read regression이 모두 PASS.

- [ ] **Step 7: DB·계약 경계 확인**

`research-evidence.v1` item shape와 Proposal/customer contract version은 변경하지 않는다. JSONB 저장은
이미 URL uniqueness를 강제하지 않으며 acquisition sidecar는 기존 batch input JSON에 저장하므로 DB
migration을 만들지 않는다. `git diff -- db/migrations`가 비어 있어야 한다.

Sidecar는 canonical content catalog/source hash에 등록하지 않고 `generateArtifacts.ts`의
private-sidecar 제외 목록에 추가한다. `check:generated` 후 `generated/content-catalog.json`과 DB에
고정된 contract hash가 byte-identical이어야 한다.

`input_snapshot_json`의 exact reader를 전수 수정한다. 새 manual proposal job은 4-key envelope만,
historical completed/read path와 markerless scheduled/automatic path는 기존 3-key envelope만 허용한다.
selection, reselection, generation start, fixed-input lineage, completed history fixture를 각각 추가한다.
한 reader라도 새 sidecar를 unknown key로 거부하거나 old queued row를 새 Research에 lease하면 실패다.

- [ ] **Step 8: Research cutover 커밋**

```bash
git add packages/brand-pilot-content-contracts/src packages/brand-pilot-content-contracts/package.json apps/api/src workers/brand-pilot-content-proposal-worker/src workers/brand-pilot-worker-runtime/src
git commit -m "fix(research): preserve independent source claims"
```

## Task 1: Card Manuscript 계약과 deterministic projection

**Files:**
- Create: `packages/brand-pilot-content-contracts/src/cardManuscriptPlan.ts`
- Create: `packages/brand-pilot-content-contracts/src/cardManuscriptPlanNode.ts`
- Create: `packages/brand-pilot-content-contracts/src/cardManuscriptPlan.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/index.ts`
- Modify: `packages/brand-pilot-content-contracts/package.json`

- [ ] **Step 1: evidence partition과 relation 의미를 고정하는 실패 테스트 작성**

```ts
it("requires the selected evidence to equal the exact union of scene evidence", () => {
  expect(() => parseCardManuscriptPlanV1(manuscript({
    evidenceSelection: { selectedEvidenceIds: [evidenceA], excludedEvidenceIds: [evidenceB] },
    scenes: [scene({ evidenceIds: [] })],
  }), frozenInput([evidenceA, evidenceB]))).toThrow("card_manuscript_evidence_partition_invalid");
});

it("flattens related facts without converting the typed manuscript relation", () => {
  const source = manuscript({
    scenes: [scene({ informationRelation: {
      type: "related_facts",
      entries: [
        { role: "adoption", label: "도입", value: "80%" },
        { role: "gap", label: "격차", value: "3.2%p" },
      ],
    } })],
  });
  const result = compileCardManuscriptPlanDraftV1(source, outline);
  expect(source.scenes[0]!.informationRelation.type).toBe("related_facts");
  expect(result.assets[0]!.copy).toContain("80%\n격차\n3.2%p");
  expect(result.assets[0]!.visualDirection).toBe(CARD_MANUSCRIPT_COMPATIBILITY_VISUAL_DIRECTION);
});
```

- [ ] **Step 2: RED 확인**

Run: `npx vitest run packages/brand-pilot-content-contracts/src/cardManuscriptPlan.test.ts`

Expected: FAIL because `cardManuscriptPlan.ts` and exported functions do not exist.

- [ ] **Step 3: exact parser와 projection 구현**

```ts
export type CardManuscriptPlanV1 = {
  contractVersion: "card-manuscript-plan.v1";
  content: { caption: string; hashtags: string[]; cta: string };
  deckNarrative: string;
  evidenceSelection: { selectedEvidenceIds: string[]; excludedEvidenceIds: string[] };
  scenes: Array<{
    index: number;
    editorialRole: CardEditorialRoleV1;
    purpose: string;
    coreMessage: string;
    headline: string;
    informationRelation: CardInformationRelationV1;
    supportingTexts: string[];
    footnote: string | null;
    evidenceIds: string[];
    productImageAssetIds: string[];
    avatarImageAssetIds: string[];
  }>;
};

export function compileCardManuscriptPlanDraftV1(
  manuscript: CardManuscriptPlanV1,
  outline: ReadonlyArray<{ index: number; role: string }>,
): CardNewsPlanDraftV1 {
  return parseCardNewsPlanDraftV1({
    contractVersion: "card-news-plan-draft.v1",
    content: manuscript.content,
    assets: manuscript.scenes.map((scene, offset) => ({
      index: scene.index,
      role: outline[offset]!.role,
      copy: flattenCardManuscriptScene(scene),
      visualDirection: CARD_MANUSCRIPT_COMPATIBILITY_VISUAL_DIRECTION,
      evidenceIds: [...scene.evidenceIds],
      productImageAssetIds: [...scene.productImageAssetIds],
    })),
  });
}
```

Parser는 pool partition, scene union, informational role evidence, 순차 index, 중복 headline/coreMessage, relation shape를 모두 검증한다. `before_after`/`comparison`의 의미 판단은 prompt 규칙이며 keyword heuristic이나 두 번째 모델 판정을 추가하지 않는다.
`related_facts` 타입은 Manuscript와 visual session에 그대로 남고 기존 canonical plan schema에는 추가하지 않는다.
`scenes.length`는 selected Proposal outline 길이와 정확히 같고 index는 1..N, Card 장수는 현재 계약의
1..5를 유지한다. selected/excluded/scene evidence ID는 각 배열 안에서도 중복을 거부한다.

Card Manuscript와 Visual Session은 public canonical catalog가 아니라 private sidecar다. package export는
추가하지만 `src/catalog.ts`, `generated/content-catalog.json`, DB에 고정된 catalog/source hash는 바꾸지
않는다. `generateArtifacts.ts` 제외 목록과 `generatedArtifacts.test.ts`는 두 sidecar가 해시 입력에서
제외됨을 고정한다.

- [ ] **Step 4: GREEN과 generated contract build 확인**

Run: `npx vitest run packages/brand-pilot-content-contracts/src/cardManuscriptPlan.test.ts && npm run build --workspace @brand-pilot/content-contracts`

Expected: new test file PASS; contracts build exits 0; `npm run check:generated` leaves the canonical
catalog and source hash unchanged.

- [ ] **Step 5: 계약 변경만 커밋**

```bash
git add packages/brand-pilot-content-contracts
git commit -m "feat(content): add card manuscript contract"
```

## Task 2: Card News Worker를 Manuscript planner로 hard cutover

**Files:**
- Create: `workers/brand-pilot-card-news-worker/src/manuscriptPlan.ts`
- Create: `workers/brand-pilot-card-news-worker/src/manuscriptPlan.test.ts`
- Create: `workers/brand-pilot-card-news-worker/scripts/run-codex-card-manuscript-plan.mjs`
- Create: `workers/brand-pilot-card-news-worker/scripts/card-manuscript-plan-v1.schema.json`
- Modify: `workers/brand-pilot-card-news-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/sourceBundle.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/worker.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/index.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/productionRuntime.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/codexAccountFailover.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/Dockerfile`
- Modify: `workers/brand-pilot-card-news-worker/.env.example`
- Modify: `workers/brand-pilot-card-news-worker/.agents/skills/card-news-creator/SKILL.md`
- Remove: `workers/brand-pilot-card-news-worker/src/deckPlan.ts`
- Remove: `workers/brand-pilot-card-news-worker/src/deckPlan.test.ts`
- Remove: `workers/brand-pilot-card-news-worker/scripts/run-codex-card-deck-plan.mjs`
- Remove: `workers/brand-pilot-card-news-worker/scripts/card-deck-editorial-plan-v1.schema.json`

- [ ] **Step 1: full Evidence Pool과 Proposal Lens 경계를 검증하는 실패 테스트 작성**

```ts
expect(prompt).toContain("Proposal is an Editorial Lens, not an evidence whitelist");
expect(prompt).toContain("Review and partition every Research Evidence Pool item before writing deckNarrative");
expect(prompt).toContain("related_facts");
expect(prompt).not.toContain("visualSystem");
expect(prompt).not.toContain("layoutArchetype");
expect(prompt).not.toContain("visualThesis");
expect(sourceBundle.researchEvidence.items).toEqual(frozenInput.researchEvidence.items);
```

- [ ] **Step 2: RED 확인**

Run: `npx vitest run workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts workers/brand-pilot-card-news-worker/src/manuscriptPlan.test.ts workers/brand-pilot-card-news-worker/src/worker.test.ts`

Expected: FAIL on manuscript contract/runner expectations.

- [ ] **Step 3: planner prompt와 loader를 Manuscript 단일 경로로 교체**

```ts
const manuscript = parseCardManuscriptPlanV1(modelOutput, frozenInput);
const planDraft = compileCardManuscriptPlanDraftV1(
  manuscript,
  frozenInput.selectedProposal.outline,
);
return {
  planDraft,
  cardManuscriptContract: {
    contractVersion: "card-manuscript-plan.v1",
    manuscriptSha256: cardManuscriptPlanSha256(manuscript),
    plan: manuscript,
  },
};
```

Prompt에는 evidence information-value, scene advancement, editorial guidance 허용, 새 사실 금지, relation 의미 규칙을 넣는다. 기존 repair 1회만 유지한다. 스타일·제품·아바타·첨부의 기존 선택과 frozen ID는 유지하되 planner가 브랜드 스타일을 디자인 시스템 문장으로 변환하지 못하게 한다.

`src/index.ts`, Dockerfile, local/production env command, runtime packaging test를 같은 커밋에서 새
runner/schema로 전환한다. 삭제한 Deck command가 운영 env override로 남으면 worker가 시작 전에
실패하므로 배포 전 실제 env 값을 읽어 확인하는 정적/운영 gate를 둔다.

- [ ] **Step 4: GREEN 확인**

Run: `npx vitest run workers/brand-pilot-card-news-worker/src && npm run build --workspace @brand-pilot/card-news-worker`

Expected: Card worker tests PASS; build exits 0.

- [ ] **Step 5: Card worker hard cutover 커밋**

```bash
git add workers/brand-pilot-card-news-worker
git commit -m "feat(card): replace deck planner with manuscript"
```

## Task 3: API의 Manuscript 검증과 canonical plan 저장

**Files:**
- Modify: `apps/api/src/aiContentContracts.ts`
- Modify: `apps/api/src/aiContentPlanContracts.ts`
- Modify: `apps/api/src/aiContentPlanContracts.test.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRepositoryV3Runtime.test.ts`
- Modify: `apps/api/src/server.aiContentWorker.test.ts`

- [ ] **Step 1: 다른 draft·hash·evidence allocation을 enqueue 전에 거부하는 실패 테스트 작성**

```ts
await expect(repository.completeAiContentJob({
  ...completion,
  planDraft: changedDraft,
  cardManuscriptContract: validContract,
})).rejects.toThrow("ai_content_card_manuscript_projection_mismatch");
expect(enqueueRenderJobs).not.toHaveBeenCalled();
```

- [ ] **Step 2: RED 확인**

Run: `npx vitest run apps/api/src/aiContentPlanContracts.test.ts apps/api/src/aiContentRepositoryV3Runtime.test.ts apps/api/src/server.aiContentWorker.test.ts`

Expected: FAIL because completion still accepts Deck binding.

- [ ] **Step 3: API가 Manuscript에서 draft를 독립 재계산하도록 구현**

```ts
const manuscript = parseCardManuscriptPlanV1(input.cardManuscriptContract.plan, frozenInput);
const manuscriptSha256 = cardManuscriptPlanSha256(manuscript);
if (manuscriptSha256 !== input.cardManuscriptContract.manuscriptSha256) invalid();
const projectedDraft = compileCardManuscriptPlanDraftV1(manuscript, frozenInput.selectedProposal.outline);
if (!deepEqual(projectedDraft, input.planDraft)) {
  throw new Error("ai_content_card_manuscript_projection_mismatch");
}
```

고객 API 응답, DB column, canonical `card-news-plan.v2`, manifest, 다운로드, 게시 계약은 바꾸지 않는다.

- [ ] **Step 4: GREEN 확인**

Run: `npx vitest run apps/api/src/aiContentPlanContracts.test.ts apps/api/src/aiContentRepositoryV3Runtime.test.ts apps/api/src/server.aiContentWorker.test.ts && npm run typecheck --workspace @brand-pilot/api`

Expected: focused API tests PASS; typecheck exits 0.

- [ ] **Step 5: API manuscript boundary 커밋**

```bash
git add apps/api/src/aiContentContracts.ts apps/api/src/aiContentPlanContracts.ts apps/api/src/aiContentPlanContracts.test.ts apps/api/src/aiContentRepository.ts apps/api/src/aiContentRepositoryV3Runtime.test.ts apps/api/src/server.aiContentWorker.test.ts
git commit -m "feat(api): validate card manuscript completion"
```

## Task 4: Card/Reel 공통 Visual Session 계약

**Files:**
- Create: `packages/brand-pilot-content-contracts/src/visualRenderSession.ts`
- Create: `packages/brand-pilot-content-contracts/src/visualRenderSession.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/index.ts`
- Modify: `packages/brand-pilot-content-contracts/package.json`

- [ ] **Step 1: 브랜드 스타일 우선과 free-once 정책 실패 테스트 작성**

```ts
expect(projectVisualRenderSession(cardInputWithStyle)).toMatchObject({
  contractVersion: "ai-content-visual-session.v1",
  outputFormat: "card_news",
  primaryMediumPolicy: {
    mode: "brand_style_reference",
    styleReferenceIds: [styleId],
  },
});
expect(projectVisualRenderSession(reelInputWithoutStyle).primaryMediumPolicy).toEqual({
  mode: "free_once",
  styleReferenceIds: [],
});
expect(JSON.stringify(projectVisualRenderSession(reelInputWithVisualSystem)))
  .not.toContain("paletteDirection");
expect(JSON.stringify(projectVisualRenderSession(reelInputWithVisualSystem)))
  .not.toContain("layoutArchetype");
```

- [ ] **Step 2: RED 확인**

Run: `npx vitest run packages/brand-pilot-content-contracts/src/visualRenderSession.test.ts`

Expected: FAIL because visual-session projection does not exist.

- [ ] **Step 3: format-neutral projection 구현**

```ts
export type AiContentVisualSessionV1 = {
  contractVersion: "ai-content-visual-session.v1";
  outputFormat: "card_news" | "reel";
  source: { contractVersion: "card-manuscript-plan.v1" | "reel-storyboard.v1"; sha256: string };
  narrative: string;
  primaryMediumPolicy: {
    mode: "brand_style_reference" | "free_once";
    styleReferenceIds: string[];
  };
  scenes: Array<{
    index: number;
    editorialContext: { editorialRole: string; purpose: string; coreMessage: string };
    lockedDisplay: {
      headline: string;
      relation: { type: string; entries: Array<{ role: string; label: string | null; value: string }> };
      supportingTexts: string[];
      footnote: string | null;
    };
    referenceBindings: {
      productImageAssetIds: string[];
      avatarImageAssetIds: string[];
    };
  }>;
};
```

Card는 Manuscript를 투영한다. Reel은 `storyNarrative`, 장면 원고, semantic keyVisual만 투영하며 `visualSystem`, `visualThesis`, `layoutArchetype`은 투영하지 않는다. `editorial illustration` 문자열이나 다른 medium 기본값을 계약에 넣지 않는다.
제품·아바타 ID는 현재 장면에 허용된 frozen ID만 투영하고 API가 image package ownership/union과
exact 대조한다. 기존 attachments는 현행대로 모든 장면에 제공한다. 아바타·제품·보조 이미지는
content reference이며 avatar-tagged style image만 존재하는 경우 `brand_style_reference`로 승격하지
않는다. 승인된 non-avatar brand-style reference만 primary-medium authority가 된다.

- [ ] **Step 4: GREEN 확인**

Run: `npx vitest run packages/brand-pilot-content-contracts/src/visualRenderSession.test.ts && npm run build --workspace @brand-pilot/content-contracts`

Expected: tests PASS; build exits 0.

- [ ] **Step 5: visual session contract 커밋**

```bash
git add packages/brand-pilot-content-contracts
git commit -m "feat(content): define shared visual render session"
```

## Task 5: API output 단위 batch lease와 원자 완료

**Files:**
- Modify: `apps/api/src/aiContentRenderJobs.ts`
- Modify: `apps/api/src/aiContentRenderJobs.pglite.test.ts`
- Modify: `apps/api/src/aiContentRenderJobs.test.ts`
- Create: `apps/api/src/aiContentRenderJobs.postgres.integration.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.aiContentRenderWorker.test.ts`

- [ ] **Step 1: 같은 output의 모든 Card/Reel asset을 LIMIT 이전에 묶는 실패 테스트 작성**

```ts
const batch = await repository.claim({
  workerId: "image-1",
  leaseSeconds: 120,
  capabilities: ["ai-content-visual-session.v1"],
});
expect(batch).toMatchObject({ kind: "visual_session", outputFormat: "reel" });
expect(batch.jobs.map((job) => job.assetIndex)).toEqual([1, 2, 3, 4, 5]);
expect(new Set(batch.jobs.map((job) => job.outputId))).toEqual(new Set([outputId]));
```

동시 claim 두 개를 실행해 한 쪽만 전체 batch를 얻고 다른 쪽은 같은 output의 어떤 장면도 얻지 못하는
테스트를 추가한다. PGlite는 상태 전이 회귀에 사용하고 `FOR UPDATE SKIP LOCKED` 경합은 실제
PostgreSQL 두 client integration으로 검증한다. Blog `image_asset`과 `package_finalize`는 기존
single-job claim 결과를 유지한다.

- [ ] **Step 2: RED 확인**

Run: `npx vitest run apps/api/src/aiContentRenderJobs.pglite.test.ts apps/api/src/server.aiContentRenderWorker.test.ts`

Expected: FAIL because claim returns only one render job.

- [ ] **Step 3: batch claim·heartbeat·complete·fail 구현**

```ts
type AiContentVisualSessionLease = {
  kind: "visual_session";
  outputId: string;
  outputFormat: "card_news" | "reel";
  visualSession: AiContentVisualSessionV1;
  jobs: Array<AiContentRenderJob & { jobKind: "image_asset"; assetIndex: number }>;
};
```

Claim transaction은 candidate output 하나를 선택하고 expected asset count와 queued rows가 정확히 일치할 때만 모든 row를 `processing`으로 갱신한다. 각 row의 기존 lease token을 유지하며 batch heartbeat는 전 행이 같은 worker·unexpired token일 때만 전부 연장한다. Batch complete는 모든 asset 결과를 검증한 뒤 한 transaction에서 전 행을 `succeeded`로 전환한다. Batch fail도 전 행을 한 transaction에서 `retryable=false`, stable code `ai_content_visual_session_failed`로 정산한다. 고객 route와 DB schema는 변경하지 않는다.

Batch route body는 `outputId`, `workerId`, ordered
`jobs: [{jobId, assetIndex, leaseToken}]`, exact request-body hash를 가진다. 서버는 token vector의 exact
set equality, 중복/누락/unknown token, 동일 workspace/brand/generation/output, expected index 1..N을
검증한다. heartbeat/complete/fail은 전 token이 유효할 때만 한 트랜잭션에서 처리하고 하나라도
stale이면 409 및 mutation 0이다. 같은 completion body replay는 idempotent success, 다른 body/hash는
409이다. `package_finalize`는 batch route에 들어오지 않는다.

잠금 순서는 모든 batch method에서 generation -> output -> image jobs(`ORDER BY asset_index`)로
고정한다. candidate는 개별 job `LIMIT`가 아니라 eligible output을 먼저 고른 뒤 전체 행을 잠근다.
Batch-aware expiry가 generic row expiry보다 먼저 실행되고 visual-session row는 generic 개별 requeue
sweep에서 제외된다.

Batch expiry는 개별 row 재queue를 금지한다. 같은 visual-session binding의 processing row 중 하나라도
lease를 잃거나 worker가 종료되면 전체 batch를 terminal fail로 정산한다. 이미 성공한 로컬 scene을
새 worker/session이 이어받거나 새 context와 혼합하지 않는다.

- [ ] **Step 4: lease race와 rollback GREEN 확인**

Run: `npx vitest run apps/api/src/aiContentRenderJobs.pglite.test.ts apps/api/src/server.aiContentRenderWorker.test.ts && npx vitest run apps/api/src/aiContentRenderJobs.postgres.integration.test.ts`

Expected: batch race, stale token, wrong worker, incomplete asset set, duplicate completion, Blog single-job regression all PASS.

- [ ] **Step 5: API render batching 커밋**

```bash
git add apps/api/src/aiContentRenderJobs.ts apps/api/src/aiContentRenderJobs.test.ts apps/api/src/aiContentRenderJobs.pglite.test.ts apps/api/src/aiContentRenderJobs.postgres.integration.test.ts apps/api/src/httpServer.ts apps/api/src/server.aiContentRenderWorker.test.ts
git commit -m "feat(api): lease card and reel renders by output"
```

## Task 6: Image Worker batch client와 group heartbeat

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/aiContentRenderClient.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentRenderClient.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/worker.ts`
- Modify: `workers/brand-pilot-image-worker/src/worker.test.ts`

- [ ] **Step 1: batch claim과 모든 lease heartbeat 실패 테스트 작성**

```ts
expect(await client.claim("worker-1", 120)).toMatchObject({
  kind: "visual_session",
  jobs: [{ assetIndex: 1 }, { assetIndex: 2 }],
});
expect(fetchImpl).toHaveBeenCalledWith(
  expect.stringContaining("/worker/ai-content-render-jobs/claim"),
  expect.objectContaining({ body: expect.stringContaining("ai-content-visual-session.v1") }),
);
```

- [ ] **Step 2: RED 확인**

Run: `npx vitest run workers/brand-pilot-image-worker/src/aiContentRenderClient.test.ts workers/brand-pilot-image-worker/src/worker.test.ts`

Expected: FAIL on batch response parsing and group execution.

- [ ] **Step 3: batch transport와 abort 연결 구현**

```ts
export type AiContentVisualSessionCompletion = {
  outputId: string;
  jobs: Array<{ jobId: string; assetIndex: number; leaseToken: string }>;
  assets: AiContentRenderedAsset[];
  diagnostics: AiContentEditorialRenderDiagnostic[];
  bodySha256: string;
};

export interface AiContentRenderClient {
  claim(workerId: string, leaseSeconds: number): Promise<AiContentRenderClaim | null>;
  heartbeatBatch(batch: AiContentVisualSessionLease, workerId: string, leaseSeconds: number): Promise<boolean>;
  completeBatch(
    batch: AiContentVisualSessionLease,
    workerId: string,
    completion: AiContentVisualSessionCompletion,
  ): Promise<void>;
  failBatch(batch: AiContentVisualSessionLease, workerId: string, input: AiContentRenderFailure): Promise<void>;
}
```

`AiContentVisualSessionCompletion`은 ordered lease-token vector, exact assets, per-scene diagnostics,
canonical body hash를 한 객체로 묶는다. API route와 client가 같은 parser를 사용하며 diagnostics를
완료 뒤 별도 요청으로 append하지 않는다.

Heartbeat 하나라도 false이면 shared AbortController를 abort하여 남은 `image_generation` 호출, 업로드, complete를 모두 중단한다. 이 경우 `failBatch`를 stale lease로 강행하지 않고 API의 batch-aware expiry settlement에 맡긴다. Blog와 package-finalize single-job 분기는 기존 로직을 그대로 사용한다.

`completeBatch`는 canonical serialization한 동일 body만 initial + bounded transport retry로 재전송한다.
응답 유실 전 commit된 경우 idempotent 200을 받고, commit 전 transport 실패는 동일 body로만 다시
시도한다. 이 replay는 Codex/image generation/upload를 호출하지 않는다. `failBatch`는 success를
덮지 못하고 stale/committed completion과 경합하면 409/mutation 0이다.

- [ ] **Step 4: GREEN 확인**

Run: `npx vitest run workers/brand-pilot-image-worker/src/aiContentRenderClient.test.ts workers/brand-pilot-image-worker/src/worker.test.ts`

Expected: Card/Reel group path and Blog/package existing path PASS.

- [ ] **Step 5: worker transport 커밋**

```bash
git add workers/brand-pilot-image-worker/src/aiContentRenderClient.ts workers/brand-pilot-image-worker/src/aiContentRenderClient.test.ts workers/brand-pilot-image-worker/src/worker.ts workers/brand-pilot-image-worker/src/worker.test.ts
git commit -m "feat(image): consume output-scoped render leases"
```

## Task 7: Shared Codex context와 locked-copy prompt

**Files:**
- Create: `workers/brand-pilot-image-worker/src/aiContentVisualSessionPromptCompiler.ts`
- Create: `workers/brand-pilot-image-worker/src/aiContentVisualSessionPromptCompiler.test.ts`
- Create: `workers/brand-pilot-image-worker/src/aiContentVisualSessionRenderer.ts`
- Create: `workers/brand-pilot-image-worker/src/aiContentVisualSessionRenderer.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentAssetRenderer.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentAssetRenderer.test.ts`
- Create: `workers/brand-pilot-image-worker/src/aiContentVisualSessionRunnerContract.ts`
- Create: `workers/brand-pilot-image-worker/src/aiContentVisualSessionRunnerContract.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentAssetRunnerContract.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentAssetRunnerContract.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/productionRuntime.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/skillContract.test.ts`
- Modify: `workers/brand-pilot-image-worker/test/fixtures/manualRender.ts`
- Modify: `workers/brand-pilot-image-worker/scripts/run-codex-ai-content-asset.mjs`
- Modify: `workers/brand-pilot-image-worker/.codex/skills/image-render/SKILL.md`
- Remove: `workers/brand-pilot-image-worker/src/aiContentCardDeckPromptCompiler.ts`
- Remove: `workers/brand-pilot-image-worker/src/aiContentCardDeckPromptCompiler.test.ts`
- Remove: `workers/brand-pilot-image-worker/src/aiContentCardDeckRenderContract.ts`
- Remove: `workers/brand-pilot-image-worker/src/aiContentCardDeckRenderContract.test.ts`

- [ ] **Step 1: D2-double-prime 정책을 Card/Reel 공통으로 고정하는 실패 테스트 작성**

```ts
expect(cardPrompt).toContain("Use the approved brand-style reference files as the primary visual medium authority");
expect(reelPrompt).toContain("Choose one primary visual medium once for this complete output");
expect(cardPrompt).toContain("Vary composition without changing the primary medium");
expect(reelPrompt).toContain("Do not add explanatory text, paraphrases, speech bubbles, sticker copy, pseudo-UI labels, or decorative English");
expect(cardPrompt).not.toContain("Use editorial illustration");
expect(reelPrompt).not.toContain("GLOBAL VISUAL SYSTEM");
expect(reelPrompt).not.toContain("layoutArchetype");
```

- [ ] **Step 2: 한 runner invocation과 N개 ordered output 실패 테스트 작성**

```ts
await renderer.renderSession(batch, signal);
expect(runCodex).toHaveBeenCalledTimes(1);
expect(runCodex).toHaveBeenCalledWith(expect.objectContaining({ maxImages: 5 }), signal);
expect(imageGenerationAudit.map((entry) => entry.assetIndex)).toEqual([1, 2, 3, 4, 5]);
expect(imageGenerationAudit.every((entry) => entry.referencedPriorOutput === false)).toBe(true);
expect(renderDiagnostics.every((entry) => entry.compiledPromptVersion === "image-visual-session.v1"))
  .toBe(true);
```

중간 scene 실패 경계도 같은 RED에 포함한다.

```ts
await expect(renderer.renderSession(failAtScene3, signal)).rejects.toMatchObject({
  code: "ai_content_visual_session_failed",
  retryable: false,
});
expect(imageGenerationAudit.map((entry) => entry.assetIndex)).toEqual([1, 2, 3]);
expect(upload).not.toHaveBeenCalled();
expect(runCodex).toHaveBeenCalledTimes(1);
```

성공 scene 1~2는 임시 파일일 뿐이며 재사용하지 않는다. scene 4~N은 호출하지 않는다. worker는
새 Codex session을 만들지 않고 전체 batch를 terminal fail한다.

- [ ] **Step 3: RED 확인**

Run: `npx vitest run workers/brand-pilot-image-worker/src/aiContentVisualSessionPromptCompiler.test.ts workers/brand-pilot-image-worker/src/aiContentVisualSessionRenderer.test.ts workers/brand-pilot-image-worker/src/aiContentAssetRenderer.test.ts`

Expected: FAIL because production renderer starts one Codex process per scene.

- [ ] **Step 4: base prompt와 ordered scene blocks 구현**

```ts
const visibleTextAllowlist = scene.lockedDisplay.relation.entries.flatMap((entry) => [
  ...(entry.label === null ? [] : [entry.label]),
  entry.value,
]);

return [
  section("CONTENT NARRATIVE - NON-DISPLAY", session.narrative),
  section("COMPLETE EDITORIAL CONTEXT - NON-DISPLAY", editorialContext(session.scenes)),
  section("PRIMARY MEDIUM POLICY", session.primaryMediumPolicy),
  section("REFERENCE PRECEDENCE", referencePrecedence),
  ...session.scenes.map((scene) => section(`SCENE ${scene.index} - GENERATE IN ORDER`, {
    currentScene: scene,
    visibleTextAllowlist: currentSceneDisplayStrings(scene, mandatoryBrandText),
  })),
  section("GLOBAL EXECUTION RULES", executionRules),
].join("\n\n");
```

`brand_style_reference` 모드에서는 style files를 primary visual authority로 명시한다. `free_once` 모드에서는 특정 매체명을 제시하지 않고 첫 장면 전에 한 주 매체를 선택해 기억하도록 한다. relation type은 semantic grouping이지 layout 지시가 아니며, 반복 relation은 composition만 바꿀 수 있다. 이전 장면 PNG는 다음 장면의 reference 목록에 추가하지 않는다.
각 scene prompt/tool call에는 해당 scene의 `referenceBindings`에 있는 제품·아바타만 허용하고,
attachments는 현행대로 공통 staged reference로 유지한다. 명시 사용자 지시와 mandatory brand rules는
prompt에 한 번만 포함하며 제품/아바타/attachment를 primary visual medium으로 오인시키지 않는다.

- [ ] **Step 5: multi-image runner와 결과 검증 구현**

Runner는 기존 `maxImages` 1~5 경계를 사용하되 한 Codex thread에서 scene index 순서대로 `image_generation`을 정확히 한 번씩 호출하도록 skill을 변경한다. manifest는 모든 index를 정확히 한 번 포함해야 하며 누락·중복·순서 불일치·크기 불일치는 fail한다. 번호나 OCR 결과는 검사하지 않는다.

새 `ai-content-visual-session-render.v1` runner input/output은 expected scene index와 결과 파일을
명시적으로 묶는다. 파일 mtime 정렬로 장면을 추정하지 않는다. Codex 0.145의 `exec --json`은 native
image-generation extension lifecycle을 노출하지 않으므로 JSONL을 근거로 삼지 않는다. 대신
Image Worker가 패키징한 trusted project hook을 `codex_hooks`로 활성화해 실제 PreToolUse/PostToolUse의
tool-use ID, arguments, scene binding, start/end를 기록한다. 각 tool prompt 첫 줄의 exact scene token을
검증하고 tool-use ID와 `${toolUseId}.png`를 직접 결속한다. 같은 scene의 두 번째 호출, 예상보다 많은
호출, 앞 호출 완료 전 다음 호출, 이전 생성 이미지 참조는 PreToolUse에서 차단한다. 실패한 호출에는
PostToolUse가 없으므로 audit이 incomplete로 끝나며 남은 scene/output 전체를 terminal failure로 만든다.
hook lifecycle을 제공하지 않는 runtime은 no-retry를 시스템 보장이라고 표시하지 않고 배포를 차단한다.

모든 PNG가 생성·검증되기 전에는 upload와 DB success 전환을 시작하지 않는다. 중간 생성 실패는
남은 호출을 중단하고 임시 결과를 폐기한다. 모든 upload가 끝난 뒤 exact `completeBatch` transport
응답만 유실된 경우에는 동일 completion body만 bounded replay하며 image generation은 재실행하지
않는다. 전체-session 자동 재생성, 성공 scene 재사용, partial success publish는 구현하지 않는다.

기존 editorial render diagnostic은 장면마다 유지한다. 모든 장면은 같은
`compiledSessionPromptSha256`를 기록하고, 장면 block SHA와 source contract/hash/index를 각각
기록한다. runner가 실제 tool arguments를 내보내면 기존 방식으로 SHA-256만 저장하고,
내보내지 않으면 `actualToolArgumentsObservation: "not_emitted_by_runner"`를 사실대로 기록한다.
실제 인자를 관찰하지 못한 상태를 prompt와 동일하다고 추정하지 않는다.
진단 값은 `completeBatch` exact body에 포함해 asset 성공 전환과 같은 DB transaction에 기록한다.
완료 후 별도 append 호출에 의존하지 않는다.

모든 PNG 검증 뒤 upload를 시작하되 N번째 upload 또는 DB completion이 실패하면 앞서 업로드된
unreferenced Blob이 남을 수 있다. 현재 존재하지 않는 cleanup 정책이 처리한다고 주장하지 않는다.
이번 무-migration 범위에서는 이를 audit/metric으로 기록하고 자동 이미지 재시도는 하지 않는다.

- [ ] **Step 6: GREEN 확인**

Run: `npx vitest run workers/brand-pilot-image-worker/src/aiContentVisualSessionPromptCompiler.test.ts workers/brand-pilot-image-worker/src/aiContentVisualSessionRenderer.test.ts workers/brand-pilot-image-worker/src/aiContentAssetRenderer.test.ts workers/brand-pilot-image-worker/src/worker.test.ts && npm run build --workspace @brand-pilot/image-worker`

Expected: all focused tests PASS; image worker build exits 0.

- [ ] **Step 7: shared visual session 커밋**

```bash
git add workers/brand-pilot-image-worker
git commit -m "feat(image): render card and reel in shared visual sessions"
```

## Task 8: Reel 회귀 경계와 영상 finalization 보존

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/aiContentReelStoryboardPromptCompiler.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentFinalizer.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/reelRenderer.test.ts`
- Modify: `apps/api/src/aiContentRenderJobs.pglite.test.ts`

- [ ] **Step 1: Reel semantic source와 finalizer 불변 테스트 작성**

```ts
expect(batch.visualSession.source.contractVersion).toBe("reel-storyboard.v1");
expect(batch.visualSession.scenes.map((scene) => scene.lockedDisplay.headline))
  .toEqual(storyboard.scenes.map((scene) => scene.headline));
expect(finalized.cover.checksum).toBe(renderedAssets[0]!.checksum);
expect(finalized.scenes).toHaveLength(storyboard.scenes.length);
```

- [ ] **Step 2: Reel prompt에서 디자인 필드가 사라지는 RED 확인**

Run: `npx vitest run workers/brand-pilot-image-worker/src/aiContentReelStoryboardPromptCompiler.test.ts workers/brand-pilot-image-worker/src/aiContentFinalizer.test.ts workers/brand-pilot-image-worker/src/reelRenderer.test.ts`

Expected before implementation: FAIL because current compiler emits `GLOBAL VISUAL SYSTEM`, `VISUAL THESIS`, and `LAYOUT ARCHETYPE`.

- [ ] **Step 3: Reel을 공통 session compiler에 연결하고 기존 finalizer 유지**

Reel Worker가 작성한 headline, keyVisual relation, supportingTexts, footnote, evidence/product/avatar IDs는 그대로 보존한다. Image Worker 입력에서만 visual-system fields를 제거한다. 9:16 scene PNG, 4초 slot, 첫 scene cover, MP4 probe, manifest/storage 경로는 변경하지 않는다.

- [ ] **Step 4: Reel GREEN 확인**

Run: `npx vitest run workers/brand-pilot-image-worker/src/aiContentReelStoryboardPromptCompiler.test.ts workers/brand-pilot-image-worker/src/aiContentFinalizer.test.ts workers/brand-pilot-image-worker/src/reelRenderer.test.ts apps/api/src/aiContentRenderJobs.pglite.test.ts`

Expected: Reel copy/hash binding, batch rendering, first-scene cover, video finalization all PASS.

- [ ] **Step 5: Reel render-policy 커밋**

```bash
git add workers/brand-pilot-image-worker/src apps/api/src/aiContentRenderJobs.pglite.test.ts
git commit -m "fix(reel): apply shared medium render policy"
```

## Task 9: Private sidecars, removed Deck files, static deployment scope

**Files:**
- Modify: `packages/brand-pilot-content-contracts/src/generateArtifacts.ts`
- Modify: `packages/brand-pilot-content-contracts/src/generatedArtifacts.test.ts`
- Modify: `packages/brand-pilot-content-contracts/package.json`
- Modify: `scripts/three-format-cutover-static-check.mjs`
- Modify: `scripts/three-format-cutover-static-check.test.mjs`
- Modify: `scripts/release-impact.mjs`
- Modify: `scripts/release-impact.test.mjs`
- Modify: `scripts/incremental-cicd-contract.test.mjs`
- Modify: `scripts/canonical-format-schema-runtime.test.mjs`
- Modify: `scripts/content-account-pool-deployment.test.mjs`
- Modify: `deploy/env/card-news-worker.env.example`
- Modify: `workers/brand-pilot-card-news-worker/Dockerfile`
- Modify: `workers/brand-pilot-card-news-worker/.env.example`
- Modify: `workers/brand-pilot-card-news-worker/src/index.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/productionRuntime.test.ts`

- [ ] **Step 1: removed Deck runner/schema와 exact service scope 실패 테스트 작성**

```ts
expect(requiredProductionFiles).toContain("workers/brand-pilot-card-news-worker/scripts/run-codex-card-manuscript-plan.mjs");
expect(requiredProductionFiles).not.toContain("run-codex-card-deck-plan.mjs");
expect(impact.enabled).toEqual(["api", "contentProposalWorker", "cardNewsWorker", "imageWorker"]);
expect(impact.customerUi).toBe(false);
expect(impact.migration).toBe(false);
```

Reel Worker source가 바뀌지 않으므로 deploy target에 Reel Worker를 넣지 않는다. Reel 동작 변경은 API/Image Worker의 render path에서 적용된다. Research runtime 변경은 Content Proposal Worker 이미지에만 반영하며 같은 shared runtime을 사용하는 무관 worker를 재배포하지 않는다.

- [ ] **Step 2: RED 확인**

Run: `node --test scripts/three-format-cutover-static-check.test.mjs scripts/release-impact.test.mjs scripts/incremental-cicd-contract.test.mjs scripts/canonical-format-schema-runtime.test.mjs scripts/content-account-pool-deployment.test.mjs`

Expected: FAIL on old Deck artifact/command expectations and unknown new paths.

- [ ] **Step 3: private-sidecar exclusion과 release classifier 수정**

`researchSourceAcquisition`, `cardManuscriptPlan`/Node, `visualRenderSession`을 package export하되
`generateArtifacts.ts`의 private exclusion list에 추가한다. `src/catalog.ts`,
`generated/content-catalog.json`, DB-pinned catalog/source hash는 변경하지 않는다.

Run: `npm run check:generated --workspace @brand-pilot/content-contracts`

Expected: exit 0 and canonical generated files/hash have zero diff.

- [ ] **Step 4: generated/static GREEN 확인**

Run: `npm run check:generated --workspace @brand-pilot/content-contracts && node --test scripts/three-format-cutover-static-check.test.mjs scripts/release-impact.test.mjs scripts/incremental-cicd-contract.test.mjs scripts/canonical-format-schema-runtime.test.mjs scripts/content-account-pool-deployment.test.mjs`

Expected: generated check exits 0; static tests PASS; changed path profile selects exactly API,
Content Proposal Worker, Card News Worker, and Image Worker only.

`rg`로 active runtime/packaging/env에서 `card-deck-editorial-plan`,
`run-codex-card-deck-plan`, `ai-content-card-deck-render-job`, `cardDeckBinding`,
`cardDeckCurrentScene`, `image-card-deck`이 0건임을 확인한다. 완료 history fixture와 문서상의 명시적
과거 설명만 예외다. 실제 운영 Card Worker env override도 배포 gate에서 새 manuscript command와
schema path인지 읽기 전용으로 증명한다.

- [ ] **Step 5: tooling 커밋**

```bash
git add packages/brand-pilot-content-contracts scripts deploy/env/card-news-worker.env.example workers/brand-pilot-card-news-worker/Dockerfile workers/brand-pilot-card-news-worker/.env.example workers/brand-pilot-card-news-worker/src/index.ts workers/brand-pilot-card-news-worker/src/productionRuntime.test.ts
git commit -m "chore(release): cut over card manuscript artifacts"
```

## Task 10: 전체 회귀, 성능 계측, protected diff

**Files:**
- Modify only if a failing in-scope assertion proves an implementation defect in Tasks 1-9.

- [ ] **Step 1: focused suites 순차 실행**

```bash
npm test --workspace @brand-pilot/content-contracts
npm test --workspace @brand-pilot/worker-runtime
npm test --workspace @brand-pilot/content-proposal-worker
npm test --workspace @brand-pilot/card-news-worker
npm test --workspace @brand-pilot/image-worker
npx vitest run apps/api/src/aiContentPlanContracts.test.ts apps/api/src/aiContentRepositoryV3Runtime.test.ts apps/api/src/server.aiContentWorker.test.ts apps/api/src/server.aiContentRenderWorker.test.ts apps/api/src/aiContentRenderJobs.test.ts apps/api/src/aiContentRenderJobs.pglite.test.ts apps/api/src/aiContentRenderJobs.postgres.integration.test.ts
```

Expected: all selected files PASS; no skipped newly added Card/Reel session test.

- [ ] **Step 2: builds/typechecks 실행**

```bash
npm run check:generated --workspace @brand-pilot/content-contracts
npm run build --workspace @brand-pilot/content-contracts
npm run build --workspace @brand-pilot/worker-runtime
npm run build --workspace @brand-pilot/content-proposal-worker
npm run build --workspace @brand-pilot/card-news-worker
npm run build --workspace @brand-pilot/image-worker
npm run typecheck --workspace @brand-pilot/api
```

Expected: all commands exit 0.

- [ ] **Step 3: protected scope 확인**

```bash
git diff --exit-code -- apps/customer-ui workers/brand-pilot-blog-worker workers/brand-pilot-marketing-worker apps/api/src/automatedCardNews.ts db/migrations
git diff --check
```

Expected: first command has no output; `git diff --check` exits 0.

- [ ] **Step 4: local deterministic timing audit**

Card 5장 fixture와 Reel 5장 fixture에서 다음 event를 기록한다.

```ts
type VisualSessionTiming = {
  stageReferencesMs: number;
  codexStartupMs: number;
  sceneGenerationMs: number[];
  uploadMs: number;
  completeMs: number;
};
```

테스트는 호출 횟수 Card=5, Reel=5, Codex process Card=1, Reel=1을 단언한다. 실제 model latency는 테스트 성공 조건으로 두지 않는다.
현재 production의 단일 Image Worker에서는 process startup/staging 중복 제거로 단축될 가능성이
있지만 이를 보장하지 않는다. 전체-session timeout은 기존 단일 asset 20분 값을 무심코 재사용하지
않고 N-scene 예산을 명시해 경계 테스트한다. 향후 worker 수평 확장 시 장면별 병렬성을 잃는 trade-off도
timing 결과에 기록한다.

- [ ] **Step 5: 전체 구현 커밋 상태 확인**

```bash
git status --short
git log --oneline -10
```

Expected: 계획 문서 외 의도하지 않은 untracked/staged 파일 없음; Tasks 1-9의 scoped commits 존재.

## Task 11: 운영 배포 전 승인 게이트

**Files:**
- No source changes.

- [ ] **Step 1: 현재 운영 기준선과 hotfix 확인**

운영 `RELEASE_SHA`, API/Content Proposal/Card/Image digest, restart count, health/ready, 원격 `main`, 로컬 HEAD를 기록한다. 다른 운영 hotfix가 현재 브랜치에 없으면 배포를 중단하고 먼저 병합한다.

- [ ] **Step 2: 새 작업 생성 정지와 nonterminal inventory**

새 수동 Card/Reel 생성 진입을 정지한다. `card-deck-editorial-plan.v1`, 새 Manuscript, `reel-storyboard.v1`의 queued/processing render rows를 output 단위로 조회한다. 과거 Deck 및 mixed render rows는 새 경로에 연결하지 않고 종료한다. 기존 완료 결과는 변경하지 않는다.

직접 SQL 수정으로 종료하지 않는다. 배포 전에 승인된 scoped dry-run/apply 도구가 없다면
nonterminal Deck row가 정확히 0건인 것을 필수 전제조건으로 삼고 1건이라도 있으면 배포를 중단한다.
종료 도구를 새로 만드는 것은 별도 운영 승인 범위다.

- [ ] **Step 3: 사용자에게 배포 범위와 성능 trade-off 승인 요청**

배포 대상은 API, Content Proposal Worker, Card News Worker, Image Worker다. 미배포 대상은 UI, DB migration, Reel Worker, Blog Worker, automatic/marketing workers다. Research 모델 호출 수와 이미지 호출 수는 늘지 않지만 불완전 원문은 같은 Research invocation 안에서 supplemental search 시간이 추가될 수 있고, 장면 생성이 순차화되어 이미지 단계가 느려질 수 있다는 점과 rollback 시 새 Research/Manuscript 작업을 먼저 정리해야 한다는 점을 명시한다.

- [ ] **Step 4: 승인 후에만 coordinated deploy 실행**

이 계획 문서 작성은 배포 승인이 아니다. 별도 승인 후 immutable digest, rollback digest, canary API, changed workers only 원칙으로 배포한다.

- [ ] **Step 5: 운영 Research canary 2경계 검증**

한 건으로 두 분기를 우연히 동시에 만족한다고 가정하지 않는다. 같은 URL 복수 Claim을 검증하는
정보가 풍부한 수동 건 1개와 incomplete acquisition supplemental query를 검증하는 통제된 수동 건
1개를 사용한다. 운영 비용 때문에 두 번째 건을 실행하지 않기로 별도 승인하면 incomplete branch는
실제 PostgreSQL/integration 증거로 대체하고 운영 검증 미실행을 명시한다.

- 같은 원문 URL에서 독립 Claim이 둘 이상 존재하는 fixture/case에서는 같은 URL·서로 다른 Evidence
  ID와 claimSummary가 실제 `researchEvidence.items`에 보존되는지 확인한다.
- 원문이 `partial_body`, `metadata_only`, `access_failed`, 또는 `indeterminate`인 승인된 canary
  case에서는 실제 audited supplemental query가 실행되고 그 query가 저장된
  `researchEvidence.queries`와 일치하는지 확인한다.
- 모델 최종 JSON에만 query가 있고 tool audit에 없는 상태, 빈 Evidence, 중복 Claim, markerless
  automatic job 진입이 없는지 확인한다.
- canary 결과의 acquisition sidecar, actual query, Evidence IDs/URLs/claim summaries를 캡처해 사용자
  확인 자료로 남긴다.

- [ ] **Step 6: 운영 Card/Reel 각 1건 검증**

Card와 Reel 각각 brand-style reference 있음/없음 중 승인된 두 케이스를 생성한다. 저장된 timing·compiled prompt·actual tool arguments·결과 이미지를 캡처해 다음을 사용자에게 보여준다.

- brand-style reference가 있을 때 해당 시각 언어가 우선되었는지
- reference가 없을 때 특정 매체가 하드코딩되지 않고 Deck/Reel 내부에서 하나로 유지됐는지
- composition은 장면별로 달라졌는지
- locked copy 핵심 의미·수치가 보존됐는지 수동으로 확인하되 문자 단위 OCR pass/fail로 판정하지
  않는지
- 원고 밖 설명 문구나 페이지 번호가 재시도를 유발하지 않았는지

운영 결과 품질 평가는 사용자가 수행하며, 자동 모델 judge나 자동 재생성은 추가하지 않는다.

## 구현 완료 조건

- 새 Proposal Research는 Evidence를 URL이 아니라 independent Claim으로 보존하고 동일 URL의 서로
  다른 Claim을 유지한다.
- incomplete acquisition은 audited supplemental query 없이는 Evidence snapshot을 commit하지 않으며,
  저장된 `queries`는 실제 실행 audit에서 온다.
- Research Evidence item/customer 계약과 DB schema는 변경하지 않는다.
- Research acquisition, Card Manuscript, Visual Session은 private sidecar로 export하되 canonical
  catalog/source hash와 generated catalog에는 변화가 없다.
- 새 수동 카드뉴스는 Manuscript 단일 경로만 사용하고 Deck reader/fallback이 없다.
- Card Manuscript의 selected/excluded evidence partition과 scene union이 정확히 일치한다.
- Card와 Reel 각각 한 output이 한 Codex process와 ordered N회 image call을 사용한다.
- Runner는 scene index를 명시적으로 결속하고 live tool-event audit으로 장면당 1회 호출과 실패 후
  중단을 실제로 강제한다. 이를 관찰할 수 없는 runtime은 배포하지 않는다.
- Batch API는 exact lease-token vector, 한 lock order, whole-output expiry, atomic completion과
  same-body completion replay만 허용한다.
- 중간 scene 실패는 성공 scene 재사용·전체 자동 재생성 없이 해당 output 전체를 nonretryable fail하고,
  completion 응답 유실만 동일 HTTP body로 replay한다.
- 장면별 이미지 호출 수가 늘지 않고 previous scene image reference가 없다.
- 브랜드 스타일 이미지가 있으면 primary visual reference, 없으면 free-once coherent medium이다.
- 제품·아바타는 장면별 frozen binding을 유지하고 attachments는 현행 all-scene reference를 유지하며,
  avatar-only reference는 brand-style medium authority가 아니다.
- `editorial illustration` 또는 다른 매체가 기본값으로 하드코딩되지 않는다.
- composition 다양성이 medium 변경으로 구현되지 않는다.
- prompt/계약은 허용된 locked copy·relation label/value·필수 브랜드 문구 외 새 표시 텍스트를
  요구하거나 허용하지 않는다. 실제 생성 픽셀의 문자 단위 일치는 자동 보장·OCR 판정하지 않는다.
- 페이지 번호는 금지 문구만 있으며 OCR·재시도·실패 조건이 아니다.
- Reel 원고, 9:16 scene, first-scene cover, 4초 slot, MP4 finalizer가 유지된다.
- Blog, UI, publishing, automatic generation, DB migration에 diff가 없다.
- partial upload orphan은 성공 결과로 재사용하지 않고 audit/metric에 남기며, 존재하지 않는 cleanup
  정책이 처리한다고 주장하지 않는다.
- 배포는 별도 사용자 승인 전에는 실행하지 않는다.
