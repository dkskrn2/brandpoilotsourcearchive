# AI Content Progress UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 중인 AI 콘텐츠 1~3단계를 승인된 시안 구조로 개선하고 기존 render 상태에서 계산한 실제 asset 진행률을 안전하게 표시한다.

**Architecture:** 기존 wizard와 generation handler는 유지하고 표시 구조와 scoped CSS만 변경한다. API는 generation 상세 조회에서 canonical plan과 render job을 index별로 축약한 optional progress DTO만 추가하며 DB와 worker를 변경하지 않는다.

**Tech Stack:** TypeScript, React, Fastify, PostgreSQL, Vitest, Testing Library, Playwright CLI

---

### Task 1: 진행률 축약기 계약

**Files:**
- Create: `apps/api/src/aiContentGenerationProgress.ts`
- Create: `apps/api/src/aiContentGenerationProgress.test.ts`

- [ ] **Step 1: 재시도 중복과 legacy fallback 실패 테스트 작성**

```ts
expect(progressFor(plan7, [queued(1), failed(1), completed(1)])?.items).toHaveLength(7);
expect(progressFor(null, [])).toBeNull();
expect(progressFor(plan7, [completed(1), completedRetry(1)])?.completedAssets).toBe(1);
```

- [ ] **Step 2: RED 확인**

Run: `npm test --workspace @brand-pilot/api -- --run src/aiContentGenerationProgress.test.ts`

Expected: module missing으로 FAIL.

- [ ] **Step 3: 순수 축약기 구현**

계획의 index·role을 기준으로 item을 만들고 동일 index는 terminal 우선, 이후 attempt/createdAt 최신 순으로 하나만 선택한다. plan을 검증할 수 없으면 `null`을 반환한다.

- [ ] **Step 4: GREEN 확인**

Run: `npm test --workspace @brand-pilot/api -- --run src/aiContentGenerationProgress.test.ts`

Expected: PASS.

### Task 2: generation 상세 API 연결

**Files:**
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/types.ts`
- Test: `apps/api/src/aiContentRepositoryV3Runtime.test.ts`
- Test: `apps/api/src/server.aiContentV2Customer.test.ts`

- [ ] **Step 1: optional DTO와 기존 generation fallback 테스트 작성**

```ts
expect(current.progress?.completedAssets).toBe(4);
expect(legacy.progress).toBeUndefined();
```

- [ ] **Step 2: 상세 조회에만 기존 plan/render row 읽기 추가**

목록 조회 SQL은 변경하지 않는다. 상세 조회에서 plan과 generation 소유 render job만 읽고 순수 축약기에 전달한다.

- [ ] **Step 3: 응답 exact-key와 내부 payload 비노출 테스트**

`prompt`, `payload_json`, storage path, lease token이 progress에 포함되지 않는지 검증한다.

- [ ] **Step 4: API 테스트와 typecheck**

Run: `npm test --workspace @brand-pilot/api -- --run src/aiContentGenerationProgress.test.ts src/aiContentRepositoryV3Runtime.test.ts src/server.aiContentV2Customer.test.ts`

Run: `npm exec tsc --workspace @brand-pilot/api -- --noEmit`

Expected: PASS.

### Task 3: UI gateway optional progress

**Files:**
- Modify: `apps/customer-ui/src/features/ai-content/types.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`
- Test: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts`

- [ ] **Step 1: valid, absent, malformed progress RED 작성**
- [ ] **Step 2: closed parser 구현**

알 수 없는 phase/status, 중복 index, count 불일치는 progress만 버리고 generation 본문은 유지한다.

- [ ] **Step 3: focused test 실행**

Run: `npm test --workspace @brand-pilot/customer-ui -- --run src/features/ai-content/aiContentApiGateway.test.ts`

Expected: PASS.

### Task 4: 1단계 시안 구조 반영

**Files:**
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalFlow.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentFamilyStep.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentSubjectStep.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentStrategyStep.tsx`
- Modify: `apps/customer-ui/src/styles/ai-content-flow.css`
- Test: `apps/customer-ui/src/components/ai-content/ContentProposalFlow.test.tsx`

- [ ] **Step 1: 기존 request body와 호출 횟수 회귀 테스트 고정**
- [ ] **Step 2: 번호 카드, 완료 badge, 입력 요약 구조 추가**
- [ ] **Step 3: 자식 handler와 validation props가 동일함을 테스트**
- [ ] **Step 4: loading/error/marketing-product/channel-empty focused GREEN**

### Task 5: 2단계 비교·스타일 구조 반영

**Files:**
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalCard.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalComparison.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ReferenceAvatarStep.tsx`
- Modify: `apps/customer-ui/src/styles/ai-content-flow.css`
- Test: `apps/customer-ui/src/components/ai-content/ContentProposalComparison.test.tsx`
- Test: `apps/customer-ui/src/components/ai-content/ReferenceAvatarStep.test.tsx`

- [ ] **Step 1: 핵심 메시지·대상·차별점·outline 기본 노출 RED**
- [ ] **Step 2: 세 proposal 카드 동일 비교 계층 구현**
- [ ] **Step 3: 스타일은 읽기 전용 `자동 적용`, avatar만 radio인 RED/GREEN**
- [ ] **Step 4: 기존 uploader와 generate handler 1회 호출 회귀**

### Task 6: 3단계 진행 UI

**Files:**
- Create: `apps/customer-ui/src/components/ai-content/AiContentAssetProgress.tsx`
- Create: `apps/customer-ui/src/components/ai-content/AiContentAssetProgress.test.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentGenerationPage.tsx`
- Modify: `apps/customer-ui/src/styles/ai-content-flow.css`
- Test: `apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx`

- [ ] **Step 1: 4/7, item 상태, progress 없음 fallback RED**
- [ ] **Step 2: progress가 있을 때만 asset panel 렌더**
- [ ] **Step 3: progress가 없으면 기존 status/output UI byte-behavior 유지**
- [ ] **Step 4: partial failure와 finalizing 상태 GREEN**

### Task 7: 회귀·브라우저·CI 사전검증

**Files:**
- Test: `apps/customer-ui/src/**/*.test.tsx`
- Test: `apps/api/src/**/*.test.ts`

- [ ] **Step 1: API focused 및 전체 typecheck/build**
- [ ] **Step 2: customer UI focused 및 전체 test/build**
- [ ] **Step 3: release impact가 `api`와 `customerUi`만 의도대로 분류하는지 확인**
- [ ] **Step 4: 1~3단계 390/768/1440 브라우저 캡처와 console/overflow 확인**
- [ ] **Step 5: `git diff --check` 및 worker/DB/prompt 무변경 확인**

완료 조건은 테스트 완화 없이 CI와 동일한 검증 명령이 모두 통과하고, 기존 generation에서 progress가 없어도 현재 화면이 정상 동작하는 것이다.
