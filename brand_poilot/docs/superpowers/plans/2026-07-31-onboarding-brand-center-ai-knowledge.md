# Onboarding Brand Center AI Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** URL·문서만 받는 온보딩이 회사명·대표 제품·서비스·FAQ를 제안하고, 사용자가 확정한 정보를 브랜드센터와 Instagram DM 자동응답의 공통 지식으로 사용하게 한다.

**Architecture:** 기존 `brand-intelligence-result.v2`를 호환 확장하고 추가 CLI 호출 없이 회사명·FAQ를 추출한다. `brand_offerings`는 분석 스냅샷으로 유지하되 신규 항목만 기존 canonical `product_services`와 `knowledge_entries`로 투영하며, 브랜드센터의 AI 자동응답 지식 화면은 이 확정 데이터를 읽기 전용으로 보여준다.

**Tech Stack:** TypeScript, React, Fastify, PostgreSQL, Vitest, Testing Library, Codex CLI worker

---

## 사용자 요구사항 추적표

| 확정 요구사항 | 구현 위치 | 완료 기준 |
|---|---|---|
| 브랜드센터 `이용 방법` 완전 제거 | Task 5 | 탭·패널 렌더링이 제거되고 기존 `?tab=how_to` 링크는 FAQ로 이동 |
| 온보딩 대표 상품·서비스 최대 5개를 브랜드센터 `제품·서비스`에 자동 추가 | Task 2, Task 4 | 워커 결과 최대 5개를 confirm 시 `product_services` 승인 항목으로 추가하고 제품·서비스 탭과 DM 지식에서 조회 |
| FAQ 탭을 제품·서비스 바로 뒤로 이동 | Task 5 | 탭 순서가 `브랜드 코어 → 제품·서비스 → FAQ → AI 자동응답 지식 → 스타일`과 정확히 일치 |
| `가이드` 탭을 `AI 자동응답 지식`으로 변경 | Task 5 | 가이드 탭·편집 화면 대신 새 이름의 읽기 전용 패널 표시 |
| AI 자동응답 지식은 브랜드 코어·제품·FAQ를 불러와 사용하고 내부에서 따로 등록하지 않음 | Task 4, Task 5 | 확정 Brand Core, 승인 제품·서비스, 활성 FAQ만 표시하며 새 등록·수정·삭제·가져오기·재생성 동작이 없음 |
| FAQ는 FAQ 탭에서 수정하고 자동응답이 수정된 활성값을 사용 | Task 4, Task 5 | FAQ 편집·활성화는 FAQ 탭에만 있고 활성 `knowledge_entries`가 자동응답 지식과 직접 FAQ 응답에 반영 |
| 재분석은 사용자가 수정한 FAQ·제품을 보존하고 새 제안만 추가 | Task 4 | 동일 정규화 질문 또는 동일 유형·제품명이 있으면 기존 행을 덮어쓰지 않음 |

## 변경 파일 구조

- 워커 계약·검증:
  - `workers/brand-pilot-brand-intelligence-worker/src/contracts.ts`
  - `workers/brand-pilot-brand-intelligence-worker/src/result.ts`
  - `workers/brand-pilot-brand-intelligence-worker/src/client.ts`
  - `workers/brand-pilot-brand-intelligence-worker/scripts/run-codex-brand-intelligence.mjs`
- API 계약·확정 투영:
  - `apps/api/src/brandIntelligenceV2Contracts.ts`
  - `apps/api/src/brandIntelligenceContracts.ts`
  - `apps/api/src/brandIntelligenceRepository.ts`
  - `apps/api/src/httpServer.ts`
  - Create: `apps/api/src/brandIntelligenceConfirmationProjection.ts`
- 온보딩 UI:
  - `apps/customer-ui/src/components/brand-intelligence/BrandEvidenceInputStep.tsx`
  - `apps/customer-ui/src/components/brand-intelligence/BrandAnalysisProgressStep.tsx`
  - `apps/customer-ui/src/pages/LiveBrandCenterOnboarding.tsx`
  - `apps/customer-ui/src/pages/BrandIntelligenceOnboardingPage.tsx`
  - `apps/customer-ui/src/features/brand-intelligence/types.ts`
  - `apps/customer-ui/src/features/brand-intelligence/brandIntelligenceGateway.ts`
- 브랜드센터 UI:
  - `apps/customer-ui/src/pages/BrandCenterPage.tsx`
  - Create: `apps/customer-ui/src/components/brand-center/AutoResponseKnowledgePanel.tsx`
  - `apps/customer-ui/src/styles/brand-center.css`

새 DB migration은 만들지 않는다. 기존 JSONB, `brand_offerings`, `product_services`, `product_service_versions`, `knowledge_entries`를 재사용한다.

### Task 1: 회사명·FAQ 제안 결과 계약 확장

**Files:**
- Modify: `workers/brand-pilot-brand-intelligence-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-brand-intelligence-worker/src/result.ts`
- Modify: `apps/api/src/brandIntelligenceV2Contracts.ts`
- Create: `workers/brand-pilot-brand-intelligence-worker/src/result.test.ts`
- Test: `apps/api/src/brandIntelligenceV2Contracts.test.ts`
- Modify: `apps/customer-ui/src/features/brand-intelligence/types.ts`

- [ ] **Step 1: 확장 계약을 요구하는 실패 테스트 작성**

```ts
const result = parseBrandIntelligenceResult(v2({
  companyNameSuggestion: { name: "그로스라인", sourceFactIds: ["fact-company"] },
  faqSuggestions: [{
    question: "서비스 가격은 어떻게 확인하나요?",
    answer: "상담 후 범위에 따라 안내합니다.",
    category: "price",
    sourceFactIds: ["fact-price"],
  }],
}), registry(["fact-company", "fact-price"]));

expect(result.companyNameSuggestion?.name).toBe("그로스라인");
expect(result.faqSuggestions).toHaveLength(1);
expect(() => parseBrandIntelligenceResult(v2({
  faqSuggestions: [{
    question: "가격은?",
    answer: "문의하세요.",
    category: "price",
    sourceFactIds: ["invented"],
  }],
}), registry([]))).toThrow("brand_intelligence_faq_registry_mismatch");
```

- [ ] **Step 2: 계약 테스트 실패 확인**

Run:

```powershell
npm test --workspace @brand-pilot/brand-intelligence-worker -- src/result.test.ts
npm test --workspace @brand-pilot/api -- src/brandIntelligenceV2Contracts.test.ts
```

Expected: 새 필드가 strict parser에 없거나 fact registry 검증이 없어 FAIL.

- [ ] **Step 3: 워커·API·UI 공통 타입 추가**

```ts
export interface CompanyNameSuggestionV2 {
  name: string;
  sourceFactIds: string[];
}

export interface FaqSuggestionV2 {
  question: string;
  answer: string;
  category: "service" | "product" | "price" | "location" | "operation" | "other";
  sourceFactIds: string[];
}
```

기존 `BrandIntelligenceResultV2`에 `companyNameSuggestion: CompanyNameSuggestionV2 | null`과 `faqSuggestions: FaqSuggestionV2[]` 두 속성을 추가한다. Parser는 FAQ 최대 20개, 질문 300자, 답변 4,000자, 회사명 100자로 제한하고 모든 `sourceFactIds`가 owned fact registry에 존재하는지 검사한다.

- [ ] **Step 4: 계약 테스트 통과 확인**

Run:

```powershell
npm test --workspace @brand-pilot/brand-intelligence-worker -- src/result.test.ts
npm test --workspace @brand-pilot/api -- src/brandIntelligenceV2Contracts.test.ts
```

Expected: PASS.

- [ ] **Step 5: 계약 변경 커밋**

```powershell
git add brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/contracts.ts brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/result.ts brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/result.test.ts brand_poilot/apps/api/src/brandIntelligenceV2Contracts.ts brand_poilot/apps/api/src/brandIntelligenceV2Contracts.test.ts brand_poilot/apps/customer-ui/src/features/brand-intelligence/types.ts
git commit -m "feat: extend onboarding intelligence suggestions"
```

### Task 2: 추가 CLI 호출 없이 회사명·FAQ 추출

**Files:**
- Modify: `workers/brand-pilot-brand-intelligence-worker/scripts/run-codex-brand-intelligence.mjs`
- Modify: `workers/brand-pilot-brand-intelligence-worker/src/client.ts`
- Test: `workers/brand-pilot-brand-intelligence-worker/src/stageContracts.test.ts`
- Test: `workers/brand-pilot-brand-intelligence-worker/src/worker.test.ts`

- [ ] **Step 1: 추출 결과와 호출 수 실패 테스트 작성**

```ts
expect(finalResult).toMatchObject({
  companyNameSuggestion: {
    name: "그로스라인",
    sourceFactIds: ["fact-company"],
  },
  faqSuggestions: [{
    question: expect.any(String),
    answer: expect.any(String),
    category: "service",
    sourceFactIds: ["fact-service"],
  }],
});
expect(invokeCodex).toHaveBeenCalledTimes(8);
```

- [ ] **Step 2: 워커 테스트 실패 확인**

Run:

```powershell
npm test --workspace @brand-pilot/brand-intelligence-worker -- src/stageContracts.test.ts src/worker.test.ts
```

Expected: 회사명·FAQ 제안이 없어 FAIL.

- [ ] **Step 3: 기존 대표 상품·서비스 단계 출력 확장**

Stage 4가 다음 형식 하나를 반환하도록 프롬프트와 검증을 변경한다.

```json
{
  "companyNameSuggestion": {
    "name": "근거에서 확인한 회사명",
    "sourceFactIds": ["fact-company"]
  },
  "offerings": [],
  "faqSuggestions": [{
    "question": "고객이 실제로 물을 질문",
    "answer": "자사 근거로만 작성한 답변",
    "category": "service",
    "sourceFactIds": ["fact-service"]
  }]
}
```

후속 브랜드 코어·외부 조사 단계에는 `job.companyName ?? companyNameSuggestion?.name ?? null`을 전달한다. 최종 감사 입력에도 두 필드를 포함하고, 등록되지 않은 fact ID가 있으면 결과를 거부한다. `client.ts`의 claim 검사는 입력 회사명이 없어도 v2 실행을 허용한다.

- [ ] **Step 4: 워커 테스트와 빌드 통과 확인**

Run:

```powershell
npm test --workspace @brand-pilot/brand-intelligence-worker -- src/stageContracts.test.ts src/worker.test.ts
npm run build --workspace @brand-pilot/brand-intelligence-worker
```

Expected: PASS, CLI 호출 수 8회 유지.

- [ ] **Step 5: 워커 변경 커밋**

```powershell
git add brand_poilot/workers/brand-pilot-brand-intelligence-worker/scripts/run-codex-brand-intelligence.mjs brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/client.ts brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/stageContracts.test.ts brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/worker.test.ts
git commit -m "feat: infer onboarding company and FAQ suggestions"
```

### Task 3: 회사명 없는 분석 시작과 결과 확인

**Files:**
- Modify: `apps/api/src/brandIntelligenceContracts.ts`
- Modify: `apps/api/src/brandIntelligenceRepository.ts`
- Modify: `apps/api/src/httpServer.ts`
- Test: `apps/api/src/server.brandIntelligenceWorker.test.ts`
- Modify: `apps/customer-ui/src/components/brand-intelligence/BrandEvidenceInputStep.tsx`
- Modify: `apps/customer-ui/src/components/brand-intelligence/BrandAnalysisProgressStep.tsx`
- Modify: `apps/customer-ui/src/pages/LiveBrandCenterOnboarding.tsx`
- Modify: `apps/customer-ui/src/pages/BrandIntelligenceOnboardingPage.tsx`
- Modify: `apps/customer-ui/src/features/brand-intelligence/brandIntelligenceGateway.ts`
- Test: `apps/customer-ui/src/components/brand-intelligence/BrandEvidenceInputStep.test.tsx`
- Test: `apps/customer-ui/src/__tests__/brandCenterLiveOnboarding.test.tsx`

- [ ] **Step 1: 회사명 없는 입력과 제안 표시 실패 테스트 작성**

```tsx
render(<BrandEvidenceInputStep busy={false} error={null} onSubmit={onSubmit} />);
expect(screen.queryByRole("textbox", { name: "회사명" })).not.toBeInTheDocument();
await user.type(screen.getByRole("textbox", { name: "자사 URL" }), "https://brand.example");
await user.click(screen.getByRole("button", { name: "분석 시작" }));
expect(onSubmit).toHaveBeenCalledWith({ ownedUrl: "https://brand.example", files: [] });
```

API 테스트는 `POST /brands/:brandId/brand-analyses`에 회사명 없이 URL만 보내고 `pipelineVersion: 2`, `resultContractVersion: "brand-intelligence-result.v2"`를 기대한다.

- [ ] **Step 2: API·UI 테스트 실패 확인**

Run:

```powershell
npm test --workspace @brand-pilot/api -- src/server.brandIntelligenceWorker.test.ts
npm test --workspace @brand-pilot/customer-ui -- src/components/brand-intelligence/BrandEvidenceInputStep.test.tsx src/__tests__/brandCenterLiveOnboarding.test.tsx
```

Expected: API가 회사명 필수 오류를 반환하고 UI에 회사명 입력이 남아 있어 FAIL.

- [ ] **Step 3: 분석 생성에서 회사명 필수 조건 제거**

`httpServer.ts`의 분석 생성 route에서 `brand_analysis_company_name_required` 검사를 제거한다. `brandIntelligenceRepository.ts`는 신규 분석을 입력 회사명과 무관하게 다음 값으로 생성한다.

```ts
{
  pipelineVersion: 2,
  status: uploads.length ? "accepting_uploads" : "waiting_for_resource",
  resultContractVersion: "brand-intelligence-result.v2",
}
```

최종 confirm route의 회사명 필수 검사는 유지한다.

- [ ] **Step 4: 자료 등록 UI와 결과 초기값 변경**

`BrandEvidenceInputStep`의 제출 계약을 다음으로 축소한다.

```ts
onSubmit(input: { ownedUrl: string | null; files: File[] }): Promise<void>;
```

회사명 상태·입력·검증·설명 문구를 제거한다. 분석 완료 시 페이지 상태는 다음 우선순위로 회사명을 채운다.

```ts
setCompanyName(
  analysis.editedResult?.companyNameSuggestion?.name
  ?? analysis.result?.companyNameSuggestion?.name
  ?? "",
);
```

진행 화면에서는 회사명을 표시하지 않는다. 결과 확인 화면의 회사명 필드와 최종 confirm 검증은 유지한다.

- [ ] **Step 5: API·UI 테스트와 빌드 통과 확인**

Run:

```powershell
npm test --workspace @brand-pilot/api -- src/server.brandIntelligenceWorker.test.ts
npm test --workspace @brand-pilot/customer-ui -- src/components/brand-intelligence/BrandEvidenceInputStep.test.tsx src/__tests__/brandCenterLiveOnboarding.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

Expected: PASS.

- [ ] **Step 6: 온보딩 입력 변경 커밋**

```powershell
git add brand_poilot/apps/api/src/brandIntelligenceContracts.ts brand_poilot/apps/api/src/brandIntelligenceRepository.ts brand_poilot/apps/api/src/httpServer.ts brand_poilot/apps/api/src/server.brandIntelligenceWorker.test.ts brand_poilot/apps/customer-ui/src/components/brand-intelligence/BrandEvidenceInputStep.tsx brand_poilot/apps/customer-ui/src/components/brand-intelligence/BrandAnalysisProgressStep.tsx brand_poilot/apps/customer-ui/src/pages/LiveBrandCenterOnboarding.tsx brand_poilot/apps/customer-ui/src/pages/BrandIntelligenceOnboardingPage.tsx brand_poilot/apps/customer-ui/src/features/brand-intelligence/brandIntelligenceGateway.ts brand_poilot/apps/customer-ui/src/components/brand-intelligence/BrandEvidenceInputStep.test.tsx brand_poilot/apps/customer-ui/src/__tests__/brandCenterLiveOnboarding.test.tsx
git commit -m "feat: collect onboarding evidence without company input"
```

### Task 4: 확정 상품·FAQ를 기존 canonical 저장소에 투영

**Files:**
- Create: `apps/api/src/brandIntelligenceConfirmationProjection.ts`
- Modify: `apps/api/src/brandIntelligenceRepository.ts`
- Test: `apps/api/src/brandIntelligenceRepository.test.ts`
- Test: `apps/api/src/repository.dmWiki.pglite.test.ts`

- [ ] **Step 1: 중복 방지와 사용자 수정 보존 실패 테스트 작성**

```ts
await confirm(firstAnalysis);
await editFaq("서비스 비용은?", "사용자가 수정한 답변");
await editProduct("진단 컨설팅", "사용자가 수정한 설명");
await confirm(secondAnalysisWithSameAndNewSuggestions);

expect(await faq("서비스 비용은?")).toMatchObject({
  answer: "사용자가 수정한 답변",
});
expect(await faq("상담 위치는 어디인가요?")).toBeTruthy();
expect(await product("진단 컨설팅")).toMatchObject({
  description: "사용자가 수정한 설명",
});
expect(await product("문의 자동화 구축")).toBeTruthy();
```

- [ ] **Step 2: repository 테스트 실패 확인**

Run:

```powershell
npm test --workspace @brand-pilot/api -- src/brandIntelligenceRepository.test.ts src/repository.dmWiki.pglite.test.ts
```

Expected: `brand_offerings`만 저장되고 FAQ·제품 canonical 행이 없어 FAIL.

- [ ] **Step 3: 확정 투영 helper 구현**

`brandIntelligenceConfirmationProjection.ts`는 한 트랜잭션 client를 받아 다음 두 함수를 제공한다.

```ts
export async function projectOfferings(
  client: Queryable,
  scope: ConfirmationScope,
  offerings: BrandOfferingV2[],
): Promise<void>;

export async function mergeFaqSuggestions(
  client: Queryable,
  scope: ConfirmationScope,
  suggestions: FaqSuggestionV2[],
): Promise<void>;
```

제품·서비스는 `kind + NFKC/공백 정리된 이름`이 같은 활성 항목이 있으면 건너뛴다. 없는 항목은 `product_services`와 승인 상태의 `product_service_versions`를 만들고 `active_version_id`를 연결한다.

FAQ는 다음 원칙으로 삽입한다.

```sql
insert into knowledge_entries (
  workspace_id, brand_id, entry_type, normalized_question,
  question, answer, title, content, structured_data,
  direct_reply_enabled, enabled, origin, provenance_json, status
) values (
  $1, $2, 'faq', $3,
  $4, $5, $4, $5, $6::jsonb,
  true, false, 'manual', $7::jsonb, 'draft'
)
on conflict (brand_id, normalized_question) do nothing;
```

`structured_data`에는 category와 sourceFactIds, `provenance_json`에는 `source: "brand_intelligence"`와 analysisId를 기록한다.

- [ ] **Step 4: confirm 트랜잭션에 helper 연결**

`brand_offerings` 스냅샷 저장 직후 `projectOfferings`와 `mergeFaqSuggestions`를 호출한다. 기존 confirm 말미의 Wiki build request coalescing을 그대로 사용해 재생성 요청은 한 번만 만든다.

- [ ] **Step 5: repository 테스트 통과 확인**

Run:

```powershell
npm test --workspace @brand-pilot/api -- src/brandIntelligenceRepository.test.ts src/repository.dmWiki.pglite.test.ts
npm run build --workspace @brand-pilot/api
```

Expected: 기존 수정값 유지, 새 항목만 추가, 제품 최대 5개 투영, PASS.

- [ ] **Step 6: 확정 투영 변경 커밋**

```powershell
git add brand_poilot/apps/api/src/brandIntelligenceConfirmationProjection.ts brand_poilot/apps/api/src/brandIntelligenceRepository.ts brand_poilot/apps/api/src/brandIntelligenceRepository.test.ts brand_poilot/apps/api/src/repository.dmWiki.pglite.test.ts
git commit -m "feat: project confirmed onboarding knowledge"
```

### Task 5: 브랜드센터 탭과 읽기 전용 자동응답 지식 화면

**Files:**
- Modify: `apps/customer-ui/src/pages/BrandCenterPage.tsx`
- Create: `apps/customer-ui/src/components/brand-center/AutoResponseKnowledgePanel.tsx`
- Create: `apps/customer-ui/src/components/brand-center/AutoResponseKnowledgePanel.test.tsx`
- Modify: `apps/customer-ui/src/styles/brand-center.css`
- Test: `apps/customer-ui/src/__tests__/brandCenter.test.tsx`

- [ ] **Step 1: 탭 순서와 읽기 전용 동작 실패 테스트 작성**

```tsx
expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
  "브랜드 코어",
  "제품·서비스",
  "FAQ",
  "AI 자동응답 지식",
  "스타일",
]);
expect(screen.queryByRole("tab", { name: "이용 방법" })).not.toBeInTheDocument();

await user.click(screen.getByRole("tab", { name: "AI 자동응답 지식" }));
expect(screen.getByText("활성 FAQ")).toBeVisible();
expect(screen.getByText("승인된 제품·서비스")).toBeVisible();
expect(screen.queryByRole("button", { name: /새|등록|수정|삭제|가져오기|재생성/ })).not.toBeInTheDocument();
```

- [ ] **Step 2: UI 테스트 실패 확인**

Run:

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/brandCenter.test.tsx src/components/brand-center/AutoResponseKnowledgePanel.test.tsx
```

Expected: 기존 이용 방법·가이드 탭과 쓰기 화면 때문에 FAIL.

- [ ] **Step 3: 탭 정의와 레거시 쿼리 매핑 변경**

```ts
type BrandCenterTab = "core" | "products" | "faq" | "knowledge" | "style";

const brandTabs = [
  { id: "core", label: "브랜드 코어" },
  { id: "products", label: "제품·서비스" },
  { id: "faq", label: "FAQ" },
  { id: "knowledge", label: "AI 자동응답 지식" },
  { id: "style", label: "스타일" },
] satisfies Array<{ id: BrandCenterTab; label: string }>;
```

`guide`와 `wiki` query는 `knowledge`, `how_to` query는 `faq`로 매핑한다. FAQ에는 기존 `KnowledgeCategoryEditorPanel kind="faq"`를 유지한다.

- [ ] **Step 4: 읽기 전용 패널 구현**

`AutoResponseKnowledgePanel`은 현재 승인된 Brand Core와 `libraryGateway.listWikiItems` 결과를 받아 다음 세 영역만 렌더링한다.

```ts
const activeFaq = items.filter(
  (item) => item.sourceKind === "faq" && item.status === "active",
);
const approvedProducts = items.filter(
  (item) => item.sourceKind === "product_service" && item.status === "read_only",
);
```

Brand Core는 `BrandCenterPage`의 `visibleVersion.core`를 전달해 7개 확정 필드를 표시한다. 패널에는 입력 요소와 mutation callback을 두지 않고, 각 영역에 원본 관리 탭으로 이동하는 링크만 제공한다.

- [ ] **Step 5: UI 테스트와 빌드 통과 확인**

Run:

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/brandCenter.test.tsx src/components/brand-center/AutoResponseKnowledgePanel.test.tsx src/__tests__/wikiLibrary.test.tsx src/__tests__/productServiceLibrary.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

Expected: 새 순서, 이용 방법 제거, FAQ 편집 유지, 자동응답 지식 쓰기 기능 없음, PASS.

- [ ] **Step 6: 브랜드센터 변경 커밋**

```powershell
git add brand_poilot/apps/customer-ui/src/pages/BrandCenterPage.tsx brand_poilot/apps/customer-ui/src/components/brand-center/AutoResponseKnowledgePanel.tsx brand_poilot/apps/customer-ui/src/components/brand-center/AutoResponseKnowledgePanel.test.tsx brand_poilot/apps/customer-ui/src/styles/brand-center.css brand_poilot/apps/customer-ui/src/__tests__/brandCenter.test.tsx
git commit -m "feat: align brand center AI response knowledge"
```

### Task 6: 직접 영향 범위 검증과 배포

**Files:**
- Verify only; no unrelated source changes

- [ ] **Step 1: 변경 파일 diff와 금지 회귀 확인**

Run:

```powershell
git diff --check HEAD~4..HEAD
git diff --name-only HEAD~4..HEAD
rg -n "회사명을 입력하세요|이용 방법|title=\"가이드\"" brand_poilot/apps/customer-ui/src/components/brand-intelligence brand_poilot/apps/customer-ui/src/pages/BrandCenterPage.tsx
```

Expected: diff 오류 없음. 자료 등록 회사명 필수 문구와 브랜드센터 이용 방법·가이드 탭 렌더링 없음.

- [ ] **Step 2: 관련 테스트만 한 번에 실행**

Run:

```powershell
npm test --workspace @brand-pilot/brand-intelligence-worker -- src/result.test.ts src/stageContracts.test.ts src/worker.test.ts
npm test --workspace @brand-pilot/api -- src/brandIntelligenceV2Contracts.test.ts src/server.brandIntelligenceWorker.test.ts src/brandIntelligenceRepository.test.ts src/repository.dmWiki.pglite.test.ts
npm test --workspace @brand-pilot/customer-ui -- src/components/brand-intelligence/BrandEvidenceInputStep.test.tsx src/__tests__/brandCenterLiveOnboarding.test.tsx src/__tests__/brandCenter.test.tsx src/components/brand-center/AutoResponseKnowledgePanel.test.tsx src/__tests__/wikiLibrary.test.tsx src/__tests__/productServiceLibrary.test.tsx
```

Expected: 모두 PASS.

- [ ] **Step 3: 변경 패키지만 빌드**

Run:

```powershell
npm run build --workspace @brand-pilot/brand-intelligence-worker
npm run build --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/customer-ui
```

Expected: 세 빌드 모두 exit code 0.

- [ ] **Step 4: API·워커를 같은 릴리스로 canary 배포**

API와 브랜드 인텔리전스 워커 이미지가 같은 `RELEASE_SHA`를 가리키는지 release manifest에서 확인한다. canary에서 다음 한 건만 검증한다.

```text
URL 또는 문서 등록
→ 회사명 없이 queued/running 진입
→ companyNameSuggestion, offerings, faqSuggestions 포함 결과 완료
→ 회사명 수정 후 confirm
→ 제품·서비스와 FAQ 초안 생성
```

Expected: 분석 결과 계약 불일치와 worker retry 없음.

- [ ] **Step 5: UI 배포 후 운영 스모크**

운영에서 다음 항목만 확인한다.

```text
/login 200
자료 등록 화면 회사명 입력 없음
브랜드센터 탭 5개와 순서 일치
제품·서비스에 온보딩 확정 항목 표시
FAQ 수정 가능
AI 자동응답 지식에 등록·수정 버튼 없음
```

Expected: 모든 항목 정상. Wiki 이미지·콘텐츠 생성·채널 페이지 등 무관 기능은 재게시하거나 전면 테스트하지 않는다.

## Self-Review

- Spec coverage: 회사명 입력 제거, AI 회사명 제안, 대표 제품·서비스 연결, FAQ 생성·보존, 탭 재배치, 이용 방법 제거, 읽기 전용 자동응답 지식, 직접 영향 테스트와 배포를 Task 1~6이 모두 포함한다.
- Placeholder scan: 미정 상태로 남긴 구현 지시나 빈 단계가 없다.
- Type consistency: `companyNameSuggestion`, `faqSuggestions`, `FaqSuggestionV2`, `knowledge` tab ID를 워커·API·UI 전 단계에서 동일하게 사용한다.
- Scope control: 새 DB migration, 새 FAQ 저장소, 새 CLI 호출, 무관 페이지 수정은 포함하지 않는다.
