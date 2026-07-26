# D Hybrid Operations Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 생성 결과를 변경·검토·보완, 채널 등록, 직접·예약 게시, Instagram DM 고객응대, 성과·개선, 지원으로 연결하면서 기존 운영·복구 기능을 보존한다.

**Architecture:** 생성 결과는 기존 generation/output와 publish queue를 canonical record로 유지한다. `/channels`는 catalog, 연결 상태, 변환/export/API publish capability를 분리해 제공한다. DM은 외부 reference를 제외하고 active Brand Core, 승인 제품·서비스, active Wiki만 조회한다. 성과 화면은 기존 dashboard/performance snapshots를 읽어 관측·해석·다음 실험을 분리한다.

**Tech Stack:** React, Fastify, PostgreSQL, Instagram Graph API adapters, DM/Wiki workers, Vitest, Testing Library, Playwright.

---

**Prerequisite:** `2026-07-24-d-hybrid-channel-capability-implementation-plan.md`와 콘텐츠 생성 계획을 먼저 완료한다. 이 문서는 이미 확정된 channel capability를 결과 게시 화면에서 소비한다.

## Task 1: 게시·DM·성과·지원 기준선 고정

**Files:**

- Modify: `apps/api/src/aiContentPublish.test.ts`
- Modify: `apps/api/src/publishSchedule.test.ts`
- Modify: `apps/api/src/instagramPublisher.regression-1.test.ts`
- Modify: `apps/api/src/repository.dmOperations.test.ts`
- Modify: `apps/api/src/repository.dmDelivery.test.ts`
- Modify: `apps/api/src/repository.dmWiki.test.ts`
- Modify: `apps/api/src/contentPerformance.test.ts`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/channels.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/dmAutomation.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/support.test.tsx`

- [ ] 아래 기존 동작을 fixture와 테스트 이름으로 고정한다.
  - Instagram feed/carousel/static Story 직접 게시
  - 예약 slot, cancel, bounded retry, result unknown 복구
  - 중복 게시 방지 idempotency key
  - DM webhook challenge/signature, event dedupe
  - FAQ exact match, Wiki retrieval, 수동 답변, 상담 전환
  - DM 일시정지·재개, delivery unknown, rate limit, 순차 처리
  - 24h/72h/7d performance snapshot
  - 고객센터 입력·상태·답변, 피드백 별도 저장
- [ ] 영상/Reel 과거 데이터는 읽을 수 있지만 신규 action fixture에는 넣지 않는다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- aiContentPublish.test.ts publishSchedule.test.ts instagramPublisher.regression-1.test.ts repository.dmOperations.test.ts repository.dmDelivery.test.ts repository.dmWiki.test.ts contentPerformance.test.ts
npm run test --workspace @brand-pilot/customer-ui -- publishQueue.test.tsx channels.test.tsx dmAutomation.test.tsx support.test.tsx
```

예상 결과: 현재 기준선이 통과한다.

## Task 2: 변경·검토·보완 결과 화면 완성

**Files:**

- Modify: `apps/customer-ui/src/pages/AiContentGenerationPage.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentArtifactPreview.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentPublishPanel.tsx`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentPublishTargets.ts`
- Modify: `apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentPublishPanel.test.tsx`

- [ ] 상위 phase label을 `변경·검토·보완`으로 표시하고 아래 tabs를 제공한다.
  - 기획 근거
  - 카피
  - 완성본
  - 게시
- [ ] 기획 근거는 선택 proposal과 실제 URL/reference snapshot을 보여준다.
- [ ] 카피는 hook, 핵심 메시지, 본문, CTA, caption/hashtags를 artifact 종류에 맞게 제공한다.
- [ ] 변경 action은 저장 가능한 text edit과 worker가 지원하는 부분 재생성을 구분한다.
- [ ] 완성본은 개별·선택 ZIP·전체 ZIP을 유지한다.
- [ ] 다운로드 후 usage를 refresh하고 같은 결과 재다운로드는 비차감 안내를 유지한다.
- [ ] 게시 tab은 capability가 있는 target만 enable한다.
- [ ] text-only/blog export에는 Instagram 게시 버튼을 억지로 붙이지 않는다.
- [ ] 성공한 `queueId`는 `/publish-queue?queueId=...` 링크로 연결한다.
- [ ] 과거 Reel result는 읽기 전용으로 렌더링하고 재생성·신규 게시 action을 숨긴다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- aiContentGeneration.test.tsx AiContentPublishPanel.test.tsx aiContentPublishTargets.test.ts AiContentArtifactPreview.test.tsx ArtifactCarousel.test.tsx
```

예상 결과: 결과 검토와 게시가 한 흐름이며 unsupported action이 보이지 않는다.

## Task 3: 게시 큐 deep link와 복구 UX 연결

**Files:**

- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/components/publish/PublishManagementPreview.tsx`
- Modify: `apps/customer-ui/src/components/publish/TopicPublishGroup.tsx`
- Modify: `apps/customer-ui/src/components/publish/publishManagementFilters.ts`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`
- Modify: `apps/api/src/aiContentPublish.ts`
- Modify: `apps/api/src/aiContentPublish.test.ts`

- [ ] `queueId` query가 있으면 해당 row를 filter 결과에 포함하고 강조·scroll·focus한다.
- [ ] group별 needs review, scheduled, publishing, published, failed, result unknown 상태를 구분한다.
- [ ] retry 가능한 상태와 금지 상태를 서버가 반환한 reason으로 표시한다.
- [ ] result unknown은 단순 실패 재시도로 중복 게시하지 않고 verify/reconcile action을 제공한다.
- [ ] cancel은 아직 게시되지 않은 허용 상태에서만 가능하다.
- [ ] static Story와 feed/carousel을 유지하고 신규 Reel action은 없다.
- [ ] artifact dialog는 open 시에만 큰 파일을 lazy load한다.
- [ ] API 실패 시 현재 list를 유지할 수 있으면 stale warning을 표시한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- aiContentPublish.test.ts publishSchedule.test.ts
npm run test --workspace @brand-pilot/customer-ui -- publishQueue.test.tsx PublishManagementPreview.test.tsx TopicPublishGroup.test.tsx
```

예상 결과: 생성 결과에서 게시 시도·복구까지 동일 queue ID로 추적된다.

- [ ] 구현 커밋:

```bash
git add apps/customer-ui/src/pages/AiContentGenerationPage.tsx apps/customer-ui/src/pages/PublishQueuePage.tsx apps/customer-ui/src/components/ai-content apps/customer-ui/src/components/publish apps/customer-ui/src/features/ai-content apps/customer-ui/src/__tests__ apps/api/src/aiContentPublish*
git commit -m "feat(operations): connect review results and publishing"
```

## Task 4: DM 지식 경계와 readiness 고도화

**Files:**

- Modify: `apps/api/src/dmTypes.ts`
- Modify: `apps/api/src/dmTypes.test.ts`
- Modify: `apps/api/src/dmPolicy.ts`
- Modify: `apps/api/src/dmPolicy.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.dmWiki.test.ts`
- Modify: `apps/api/src/server.dmOperations.test.ts`
- Modify: `workers/brand-pilot-dm-worker/src/compiledWikiSource.ts`
- Modify: `workers/brand-pilot-dm-worker/src/knowledgeNormalizer.ts`
- Modify: `workers/brand-pilot-dm-worker/src/worker.test.ts`

- [ ] DM retrieval source 우선순위를 고정한다.

```text
정확 일치 활성 FAQ
  > 승인 제품·서비스
  > 승인 Brand Core
  > active compiled Wiki
  > knowledge gap / 상담 전환
```

- [ ] `reference_items`, trend caption, 외부 reference URL은 DM 사실 검색 corpus에서 제외한다.
- [ ] 새 Brand Core 또는 제품 draft는 승인 전 DM에 반영하지 않는다.
- [ ] API와 DM worker는 공통 approved Brand Context provider/serialized snapshot을 사용하고 legacy `brand_profiles`의 승인 필드나 `__confirmed_brand_intelligence__` synthetic Wiki projection을 검색하지 않는다.
- [ ] readiness는 channel permission, webhook, DM worker heartbeat, active Brand Core, active Wiki 상태를 함께 본다.
- [ ] Wiki가 stale이면 마지막 active version 사용 여부와 경고를 명시한다.
- [ ] 지식 부족은 추측 답변 대신 knowledge gap item과 상담 필요 상태를 만든다.
- [ ] 사람의 수동 답변 이후 pause/resume 규칙을 유지한다.
- [ ] delivery idempotency, unknown reconciliation, rate limit, message merge, per-conversation ordering을 다시 검증한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- dmTypes.test.ts dmPolicy.test.ts repository.dmWiki.test.ts repository.dmOperations.test.ts repository.dmDelivery.test.ts server.dmOperations.test.ts server.dmWebhook.test.ts
npm run test --workspace @brand-pilot/dm-worker
```

예상 결과: 외부 영감 자료가 고객 답변 사실로 사용되지 않고 기존 안전·복구 동작이 유지된다.

## Task 5: Instagram 고객응대 화면을 대화 중심으로 정리

**Files:**

- Modify: `apps/customer-ui/src/pages/DmAutomationPage.tsx`
- Modify: `apps/customer-ui/src/components/dm/DmConversationList.tsx`
- Modify: `apps/customer-ui/src/components/dm/DmConversationThread.tsx`
- Modify: `apps/customer-ui/src/components/dm/DmAttentionPanel.tsx`
- Modify: `apps/customer-ui/src/components/dm/DmKnowledgePanel.tsx`
- Modify: `apps/customer-ui/src/__tests__/dmAutomation.test.tsx`

- [ ] 화면은 readiness/ON-OFF, 대화 목록, thread, 수동 답변, 상담 필요 처리를 중심으로 구성한다.
- [ ] Wiki upload/import/edit UI는 브랜드 센터 Wiki로 이동하고 DM 화면에는 상태와 `Wiki에서 보완` 링크만 남긴다.
- [ ] knowledge gap에서 `/brand-center?tab=wiki&issue=<uuid>` deep link를 연다.
- [ ] search/filter/pagination, latest-request race 방지를 유지한다.
- [ ] manual delivery 상태와 실패 재시도를 실제 API 상태로 표시한다.
- [ ] 자동답변 ON은 readiness를 통과하지 못하면 차단하고 구체적인 해결 링크를 제공한다.
- [ ] empty/loading/error/stale를 각각 테스트한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- dmAutomation.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

예상 결과: Wiki 기능은 사라진 것이 아니라 브랜드 센터로 이동하고 DM 운영 기능은 전부 보존된다.

- [ ] 구현 커밋:

```bash
git add apps/api/src/dm* apps/api/src/repository.ts apps/api/src/repository.dm* apps/api/src/server.dm* workers/brand-pilot-dm-worker apps/customer-ui/src/pages/DmAutomationPage.tsx apps/customer-ui/src/components/dm apps/customer-ui/src/__tests__/dmAutomation.test.tsx
git commit -m "feat(dm): ground customer replies in approved brand knowledge"
```

## Task 6: 성과·개선 페이지 분리

**Files:**

- Create: `apps/api/src/performanceInsights.ts`
- Create: `apps/api/src/performanceInsights.test.ts`
- Create: `apps/api/src/server.performanceInsightsCustomer.test.ts`
- Modify: `apps/api/src/contentPerformance.ts`
- Modify: `apps/api/src/contentPerformance.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Create: `apps/customer-ui/src/pages/PerformanceInsightsPage.tsx`
- Create: `apps/customer-ui/src/components/performance/PerformanceSummary.tsx`
- Create: `apps/customer-ui/src/components/performance/PerformanceObservationList.tsx`
- Create: `apps/customer-ui/src/components/performance/PerformanceExperimentCards.tsx`
- Create: `apps/customer-ui/src/components/performance/PerformanceContentDialog.tsx`
- Create: `apps/customer-ui/src/features/performance/performanceViewModel.ts`
- Create: `apps/customer-ui/src/features/performance/performanceViewModel.test.ts`
- Create: `apps/customer-ui/src/features/performance/performanceGateway.ts`
- Create: `apps/customer-ui/src/features/performance/performanceGateway.test.ts`
- Create: `apps/customer-ui/src/styles/performance.css`
- Create: `apps/customer-ui/src/__tests__/performanceInsights.test.tsx`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/routes.tsx`
- Modify: `apps/customer-ui/src/features/navigation/navigationModel.ts`
- Modify: `apps/customer-ui/src/features/help/helpGuides.ts`
- Modify: `apps/customer-ui/src/pages/DashboardPage.tsx`
- Modify: `apps/customer-ui/src/main.tsx`
- Modify: `apps/customer-ui/src/__tests__/helpGuidance.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/navigation.test.tsx`

- [ ] 기존 30일 dashboard 응답은 대시보드 요약에 유지하고, 상세 화면용 `GET /brands/:brandId/performance/insights?period=30d`를 추가한다.
- [ ] 새 endpoint는 기존 24h/72h/7d snapshot을 aggregate해 `summary`, `windows`, `observations`, `experiments`, `sampleSize`, `lastCollectedAt`을 반환한다.
- [ ] 다른 brand의 snapshot ID가 observation/experiment evidence에 섞이지 않게 tenant scope를 검증한다.
- [ ] 데이터를 세 층으로 분리한다.
  - 관측: 실제 metric과 sample size
  - 해석: 규칙 기반 또는 AI가 해석한 경향, confidence
  - 다음 실험: 사용자가 승인하면 proposal setup으로 전달되는 suggestion
- [ ] 표본이 부족하면 개선 결론 대신 `데이터 부족`을 표시한다.
- [ ] 다음 실험은 자동 generation/publish를 하지 않는다. 사용자가 `이 데이터로 AI 구성안 만들기`를 누르면 검증된 performance snapshot ID를 `POST /brands/:brandId/ai-content/proposal-batches`에 보내고, 생성된 opaque batch ID로 `/ai-content/new?proposalBatch=<uuid>`를 연다.
- [ ] `proposalBatch`는 서버에서 현재 brand 소유권과 status를 검증하고 reload 후에도 같은 proposal selection phase를 복원한다. invalid/다른 brand ID는 setup empty state와 오류 안내로 돌아간다.
- [ ] strategy, format, hook, appeal 비교는 generation orchestration metadata가 있는 결과부터 제공한다.
- [ ] 기존 top content artifact dialog는 open 시에만 lazy load한다.
- [ ] 대시보드에는 요약과 `성과 자세히 보기`만 남긴다.
- [ ] 같은 commit에서 sidebar에 `/performance`의 `성과·개선` 항목을 추가하고 navigation test를 갱신한다.
- [ ] `performance.css`를 page layer 뒤에 import하고 desktop/tablet/mobile grid, dialog, loading/empty/error/stale 스타일과 reduced-motion을 검증한다.
- [ ] `/performance` help guide와 observation/interpretation/experiment 구분 안내를 같은 commit에 추가한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- performanceInsights.test.ts server.performanceInsightsCustomer.test.ts contentPerformance.test.ts
npm run test --workspace @brand-pilot/customer-ui -- performanceGateway.test.ts performanceViewModel.test.ts performanceInsights.test.tsx dashboard.test.tsx helpGuidance.test.tsx navigation.test.tsx responsiveStyles.test.ts
```

예상 결과: 관측값과 AI 해석을 사용자가 혼동하지 않는다.

- [ ] 구현 커밋:

```bash
git add apps/api/src/performanceInsights* apps/api/src/server.performanceInsightsCustomer.test.ts apps/api/src/contentPerformance* apps/api/src/httpServer.ts apps/customer-ui/src/pages/PerformanceInsightsPage.tsx apps/customer-ui/src/components/performance apps/customer-ui/src/features/performance apps/customer-ui/src/features/navigation/navigationModel.ts apps/customer-ui/src/features/help/helpGuides.ts apps/customer-ui/src/lib/apiClient.ts apps/customer-ui/src/types.ts apps/customer-ui/src/pages/DashboardPage.tsx apps/customer-ui/src/styles/performance.css apps/customer-ui/src/routes.tsx apps/customer-ui/src/main.tsx apps/customer-ui/src/__tests__/performanceInsights.test.tsx apps/customer-ui/src/__tests__/helpGuidance.test.tsx apps/customer-ui/src/__tests__/navigation.test.tsx
git commit -m "feat(performance): add performance and improvement workspace"
```

## Task 7: 고객센터·피드백·도움말 위치 회귀

**Files:**

- Modify: `apps/customer-ui/src/pages/SupportPage.tsx`
- Modify: `apps/customer-ui/src/components/feedback/FeatureSuggestionBanner.tsx`
- Modify: `apps/customer-ui/src/components/feedback/FeedbackDialog.tsx`
- Modify: `apps/customer-ui/src/features/help/helpGuides.ts`
- Modify: `apps/customer-ui/src/__tests__/support.test.tsx`
- Modify: `apps/customer-ui/src/components/feedback/FeedbackDialog.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/helpGuidance.test.tsx`

- [ ] 고객센터 문의 유형은 오류·채널·계정·기타만 보인다.
- [ ] legacy `feature` 값은 기존 row 읽기 호환만 유지한다.
- [ ] 고객센터 상단 새로고침 action은 다시 추가하지 않는다.
- [ ] sidebar, dashboard, 고객센터 하단의 기능 제안은 같은 feedback dialog/API를 연다.
- [ ] feedback 1–2000자, 성공 후 중복 제출 방지, 실패 후 입력 보존을 유지한다.
- [ ] 브랜드 센터·레퍼런스·성과·콘텐츠 help guide는 각 기능 계획이 같은 릴리스에서 소유한다. 이 task는 `/support`와 공통 feedback/help entry의 경로 회귀만 맡는다.
- [ ] coachmark는 사용자가 눌렀을 때만 시작하고 중단·재실행할 수 있다.
- [ ] 동적 generation result path가 올바른 guide로 매핑되는지 테스트한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- support.test.tsx FeedbackDialog.test.tsx helpGuidance.test.tsx
```

예상 결과: 디자인 개편 중 작은 지원 기능이 누락되지 않는다.

- [ ] 구현 커밋:

```bash
git add apps/customer-ui/src/pages/SupportPage.tsx apps/customer-ui/src/components/feedback apps/customer-ui/src/features/help/helpGuides.ts apps/customer-ui/src/__tests__/support.test.tsx apps/customer-ui/src/__tests__/helpGuidance.test.tsx
git commit -m "fix(support): preserve feedback and help entry points"
```

## Task 8: 운영 통합 E2E

**Files:**

- Create: `apps/customer-ui/e2e/d-hybrid-operations.spec.ts`
- Modify: `apps/customer-ui/e2e/ai-content-runtime.spec.ts`
- Modify: `apps/customer-ui/e2e/customer-ui.spec.ts`

- [ ] 다음 연결 시나리오를 검증한다.
  1. `/channels`에서 Instagram capability와 다른 catalog 상태 확인
  2. 콘텐츠 결과 → feed/static Story 게시 → queue ID deep link
  3. 예약 → cancel
  4. failed → bounded retry
  5. result unknown → reconcile, 중복 게시 없음
  6. DM knowledge gap → `/brand-center?tab=wiki&issue=<uuid>` → same-brand issue detail focus → 보완
  7. 수동 답변 → 자동응답 pause/resume
  8. 성과 관측 → 다음 실험 → content proposal setup
  9. dashboard/support/sidebar의 동일 feedback dialog
- [ ] 테스트 fixture는 실제 schema를 사용하고 외부 Meta 호출은 adapter 경계에서 stub한다.
- [ ] 실행:

```bash
npm run e2e --workspace @brand-pilot/customer-ui -- d-hybrid-operations.spec.ts ai-content-runtime.spec.ts customer-ui.spec.ts
npm run test --workspace @brand-pilot/api
npm run test --workspace @brand-pilot/dm-worker
npm run test --workspace @brand-pilot/customer-ui
npm run build
```

예상 결과: 생성 이후의 실제 운영 사이클과 기존 복구 경로가 함께 통과한다.

- [ ] 최종 커밋:

```bash
git add apps/customer-ui/e2e
git commit -m "test(operations): verify review publish dm and performance flow"
```
