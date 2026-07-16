# Customer UI Content and DM Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 콘텐츠 검토를 게시 관리로 통합하고, 자사 URL·전역 Top 버튼·DM 수동응답과 화면 정리를 기존 데이터 및 상태 정책을 유지하면서 제공한다.

**Architecture:** 게시 결과 미리보기를 공용 팝업 컴포넌트로 분리하고 검토 전 콘텐츠용 artifact 조회 API를 추가한다. 자사 URL 관리는 브랜드 설정의 독립 컴포넌트로 이동하며 기존 source API를 그대로 사용한다. DM 수동응답은 중앙 API가 기존 Meta 전송 어댑터를 호출하고 성공한 발신 메시지만 저장하되 대화 자동화 상태는 수정하지 않는다.

**Tech Stack:** React 19, React Router, TypeScript, Fastify, PostgreSQL, Vitest, Testing Library

---

### Task 1: 콘텐츠 검토를 게시 관리로 통합

**Files:**
- Create: `apps/customer-ui/src/components/publish/ContentArtifactDialog.tsx`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Modify: `apps/customer-ui/src/routes.tsx`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/types.ts`
- Test: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`
- Test: `apps/customer-ui/src/__tests__/navigation.test.tsx`
- Test: `apps/api/src/server.test.ts`
- Test: `apps/api/src/repository.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

  `/content`가 검토 필요 게시 관리로 이동하고, 검토 대상 결과물이 생성됐을 때만 `콘텐츠 보기` 버튼과 공용 팝업이 보이는 테스트를 추가한다. 생성 중이며 artifact가 없는 행은 `콘텐츠 미생성`만 표시해야 한다.

- [ ] **Step 2: 검토 대상 artifact API 테스트 작성**

  `GET /content-outputs/:outputId/artifact`가 `channel_outputs.output_json`, `rendered_artifact_id`, `storage_artifacts.public_url`을 이용해 `PublishArtifactDto`를 반환하고 출력이 없으면 `content_output_artifact_not_ready`를 반환하는 테스트를 추가한다.

- [ ] **Step 3: 공용 artifact 로더 구현**

  저장소에서 게시 큐와 채널 출력이 같은 `normalizePublishArtifact` 흐름을 사용하도록 내부 로더를 분리한다. 새 API는 출력 ID만 받고 게시 큐 생성 여부와 무관하게 결과물을 읽는다.

- [ ] **Step 4: 공용 팝업 구현**

  `ContentArtifactDialog`는 이미지 갤러리, 이미지, 영상, HTML, 텍스트를 `PublishArtifactPreview`로 표시하고 로딩·실패·내부 스크롤을 처리한다. 완료 결과만 다운로드 액션을 전달받고 검토 대상 팝업에는 승인·재생성·거절 액션을 전달한다.

- [ ] **Step 5: 메뉴와 라우트 제거**

  사이드바 `콘텐츠 검토` 항목과 카운트 매핑을 제거한다. `ContentPage` import와 직접 라우트를 제거하고 `/content`는 `<Navigate to="/publish-queue?status=needs_review" replace />`로 남긴다.

- [ ] **Step 6: 집중 테스트 실행**

  Run: `npm test --workspace @brand-pilot/customer-ui -- publishQueue.test.tsx navigation.test.tsx`
  Run: `npm test --workspace @brand-pilot/api -- server.test.ts repository.test.ts`
  Expected: 모든 관련 테스트 통과

### Task 2: 자사 URL 관리를 브랜드 설정으로 이동

**Files:**
- Create: `apps/customer-ui/src/components/brand/OwnedSourceSettings.tsx`
- Modify: `apps/customer-ui/src/pages/BrandSettingsPage.tsx`
- Modify: `apps/customer-ui/src/pages/SourcesPage.tsx`
- Modify: `apps/api/src/repository.ts`
- Test: `apps/customer-ui/src/__tests__/brandSettings.test.tsx`
- Test: `apps/customer-ui/src/__tests__/sources.test.tsx`
- Test: `apps/api/src/repository.regression-1.test.ts`

- [ ] **Step 1: 위치 이동 실패 테스트 작성**

  브랜드 설정에 자사 URL 추가·수정·비활성화·삭제·재크롤링 조작이 있고 소스 화면에는 자사 URL 탭과 입력창이 없는 테스트를 작성한다. 참고 URL과 크롤링 이력은 소스 화면에 남아야 한다.

- [ ] **Step 2: 자사 URL 설정 컴포넌트 구현**

  `OwnedSourceSettings`가 `listSources`, `createSource`, `updateSource`, `deleteSource`, `retrySource`를 기존 계약으로 호출하고 저장 성공 후 목록을 다시 읽는다. URL 중복·형식 오류·초기 크롤링 실패 문구는 기존 소스 화면과 동일하게 유지한다.

- [ ] **Step 3: 화면 재배치**

  브랜드 설정 하단에 자사 URL 패널을 추가한다. 소스 화면의 자사 URL 탭과 입력 상태를 제거하고 참고 URL·크롤링 이력·주제표만 유지한다.

- [ ] **Step 4: 온보딩 경로 수정**

  API 온보딩 응답의 자사 URL 단계 경로를 `/brand-settings`로 변경하고 회귀 테스트를 갱신한다.

- [ ] **Step 5: 집중 테스트 실행**

  Run: `npm test --workspace @brand-pilot/customer-ui -- brandSettings.test.tsx sources.test.tsx`
  Run: `npm test --workspace @brand-pilot/api -- repository.regression-1.test.ts`
  Expected: 모든 관련 테스트 통과

### Task 3: 전역 Top 버튼 추가

**Files:**
- Create: `apps/customer-ui/src/components/layout/ScrollToTopButton.tsx`
- Modify: `apps/customer-ui/src/components/layout/AppShell.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Test: `apps/customer-ui/src/__tests__/navigation.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

  스크롤 위치가 임계값을 넘으면 `맨 위로` 아이콘 버튼이 나타나고 클릭 시 `window.scrollTo({ top: 0, behavior: "smooth" })`가 호출되는 테스트를 작성한다.

- [ ] **Step 2: 전역 컴포넌트 구현**

  `ScrollToTopButton`에서 passive scroll listener를 등록하고 unmount 시 해제한다. AppShell에 한 번만 배치해 로그인 이외의 모든 화면에 적용한다.

- [ ] **Step 3: 반응형 스타일 구현**

  40px 정사각 아이콘 버튼을 우측 하단에 고정하고 모바일에서는 하단 안전 여백을 확보한다. Lucide `ArrowUp` 아이콘과 `title`, `aria-label`을 제공한다.

- [ ] **Step 4: 집중 테스트 실행**

  Run: `npm test --workspace @brand-pilot/customer-ui -- navigation.test.tsx`
  Expected: Top 버튼 및 기존 내비게이션 테스트 통과

### Task 4: DM 화면 정리와 수동응답 추가

**Files:**
- Modify: `apps/customer-ui/src/pages/DmAutomationPage.tsx`
- Modify: `apps/customer-ui/src/components/dm/DmConversationThread.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/types.ts`
- Test: `apps/customer-ui/src/__tests__/dmAutomation.test.tsx`
- Test: `apps/customer-ui/src/lib/apiClient.test.ts`
- Test: `apps/api/src/server.dmOperations.test.ts`
- Test: `apps/api/src/repository.dmOperations.test.ts`

- [ ] **Step 1: UI 실패 테스트 작성**

  상단 `확인 필요` 탭이 없고 대화 목록의 `확인 필요` 필터는 남아 있는지 확인한다. 수동응답 입력·전송 성공 후 대화 상세 재조회, 빈 입력 차단, 전송 중 중복 클릭 차단을 테스트한다.

- [ ] **Step 2: API 실패 테스트 작성**

  `POST /brands/:brandId/dm/conversations/:conversationId/messages`가 `{ body }`를 검증하고, 다른 브랜드 대화 접근을 거부하며, 성공 시 저장된 outbound 메시지를 반환하는 테스트를 작성한다.

- [ ] **Step 3: 저장소 수동응답 구현**

  대화·브랜드·Instagram 채널·활성 credential을 조회하고 기존 `sendInstagramDirectMessage` 어댑터를 호출한다. 성공한 provider message ID만 `instagram_dm_messages`에 `direction='outbound'`, `decision='manual'`, `reason_code='system_event'`로 저장한다. `automation_status`와 `attention_status`는 갱신하지 않는다.

- [ ] **Step 4: API와 입력 오류 매핑 구현**

  본문은 trim 후 1~1000자로 제한한다. 권한·토큰 오류와 모호한 전송 오류를 안정된 오류 코드로 반환하며 서버는 자동 재전송하지 않는다.

- [ ] **Step 5: DM UI 구현**

  상단 확인 필요 섹션과 관련 로딩 상태를 제거한다. 대화 상세 하단에 textarea와 전송 버튼을 추가하고 성공 시 상세·목록을 갱신한다. 수동응답은 확인 완료를 자동 실행하지 않는다.

- [ ] **Step 6: sticky 대화 목록 구현**

  데스크톱에서 대화 레이아웃 높이를 viewport 기준으로 제한하고 목록을 `position: sticky; top: 80px`와 내부 스크롤로 처리한다. 모바일 미디어 쿼리에서는 sticky와 고정 높이를 해제한다.

- [ ] **Step 7: 집중 테스트 실행**

  Run: `npm test --workspace @brand-pilot/customer-ui -- dmAutomation.test.tsx apiClient.test.ts`
  Run: `npm test --workspace @brand-pilot/api -- server.dmOperations.test.ts repository.dmOperations.test.ts`
  Expected: 모든 관련 테스트 통과

### Task 5: 생성 결과에서 참고 URL 비노출

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-image-worker/src/threadsPrompt.ts`
- Test: `workers/brand-pilot-image-worker/src/promptBuilder.test.ts`
- Test: `workers/brand-pilot-image-worker/src/threadsPrompt.test.ts`

- [ ] **Step 1: 프롬프트 계약 실패 테스트 작성**

  Instagram과 Threads 프롬프트가 URL 원문을 내부 맥락으로 포함하면서도 게시 본문, 캡션, 이미지 문구에 참고 URL·출처 URL을 출력하지 말라는 한국어 규칙을 포함하는지 테스트한다.

- [ ] **Step 2: 최소 프롬프트 변경**

  두 프롬프트의 공통 규칙에 게시 결과 URL 비노출 문장만 추가한다. URL 제거기, 정규식 후처리, URL 검출 실패 처리는 추가하지 않는다.

- [ ] **Step 3: 워커 테스트 실행**

  Run: `npm test --workspace @brand-pilot/image-worker -- promptBuilder.test.ts threadsPrompt.test.ts`
  Expected: 프롬프트 계약 테스트 통과

### Task 6: 통합 검증과 문서 갱신

**Files:**
- Modify: `docs/architecture/BRAND_PILOT_RUNTIME_ARCHITECTURE.md` 또는 현재 활성 런타임 아키텍처 문서
- Modify: `docs/superpowers/specs/2026-07-16-customer-ui-content-dm-consolidation-design.md` only if implementation details differ

- [ ] **Step 1: 전체 정적 검증**

  Run: `npm test`
  Run: `npm run build`
  Run: `npm run test:migrations`
  Run: `npm run test:contract`
  Run: `git diff --check`
  Expected: 모두 성공

- [ ] **Step 2: 브라우저 검증**

  `/publish-queue`, `/brand-settings`, `/sources`, `/dm-automation`을 데스크톱과 모바일에서 확인한다. 팝업 스크롤, 결과물 없는 행, sticky 목록, 수동응답, Top 버튼이 겹치지 않아야 한다.

- [ ] **Step 3: Wiki 회귀 확인**

  Growthline 활성 Wiki의 FAQ 8개와 제품 3개가 유지되는지 읽기 전용 쿼리로 확인한다. 이벤트 유형은 생성하거나 마이그레이션하지 않는다.

- [ ] **Step 4: 범위별 선별 커밋**

  기존 미커밋 DM·Wiki·워커 변경을 포함하지 않도록 각 task의 관련 hunk만 스테이징한다. 커밋 전 `git diff --cached --check`와 `git diff --cached --name-status`를 확인한다.
