# Customer Experience Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자 화면의 기본 UI를 통일하고, 트렌드 검색·아카이브·브랜드 설정·AI 콘텐츠·온보딩·Instagram 게시·DM 수동 답변의 남은 사용성 및 신뢰성 문제를 한 번에 해결한다.

**Architecture:** UI 공통 요소는 `components/ui`에 집중시키고 페이지는 상태와 업무 흐름만 관리한다. 트렌드 삭제·아카이브와 DM 실패 감사 기록은 브랜드 범위 API로 추가하며, 기존 저장·게시 데이터 구조는 유지한다. 기능별 테스트를 먼저 추가하고 마지막에 고객 UI 전체 빌드와 주요 경로 E2E를 한 번만 실행해 검증 시간을 제한한다.

**Tech Stack:** React 18, TypeScript, React Router, Lucide React, Fastify, PostgreSQL/Supabase, Vitest, Testing Library, Playwright

---

## 확정 범위

1. 브라우저 기본 파일 선택기, `select`, 스크롤바, 업로드 `progress` 외형 통일
2. Instagram 트렌드 최근 검색어 개별 삭제
3. 브랜드 설정의 섹션 순서 변경, Instagram 아코디언, 브랜드 주색 이동
4. AI 콘텐츠 생성·다운로드 잔여량을 실제 `.topbar`에 표시
5. 확정된 브랜드 분석이 없는 사용자의 최초 접속 차단 및 브랜드 분석 강제
6. AI 콘텐츠 상세에서 결과물을 먼저 표시하고 카드뉴스를 캐러셀로 표시
7. AI 콘텐츠의 Instagram Story 직접 게시 실패 추적 및 오류 표시 보강
8. 트렌드 카드 북마크와 `소스 > 아카이브` 메뉴·페이지 추가
9. AI 콘텐츠 목록을 카드형으로 변경하고 하단 성과 콘텐츠 영역 제거
10. DM 수동 답변 실패 이력 보존, 원인별 안내, 중복 발송 방지

릴스 변환 경로와 자동 게시 정책은 이번 범위에서 변경하지 않는다.

---

### Task 1: 공통 파일 업로드·진행 표시 컴포넌트

**Files:**
- Create: `apps/customer-ui/src/components/ui/FileUploadButton.tsx`
- Create: `apps/customer-ui/src/components/ui/FileUploadButton.test.tsx`
- Create: `apps/customer-ui/src/components/ui/UploadProgress.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentAttachmentUploader.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentAttachmentUploader.test.tsx`
- Modify: `apps/customer-ui/src/components/brand-intelligence/BrandEvidenceInputStep.tsx`
- Modify: `apps/customer-ui/src/pages/SourcesPage.tsx`

- [ ] **Step 1: 공통 컴포넌트의 실패 테스트 작성**

  `FileUploadButton`이 숨겨진 실제 파일 입력, 아이콘 버튼, 허용 형식, 선택 파일명·용량, 삭제 버튼을 렌더링하고 키보드/레이블 클릭으로 입력을 여는지 검사한다. `UploadProgress`는 `role="progressbar"`, `aria-valuenow`, 퍼센트 텍스트를 제공해야 한다.

- [ ] **Step 2: 테스트가 컴포넌트 부재로 실패하는지 확인**

  Run: `npm test --workspace @brand-pilot/customer-ui -- src/components/ui/FileUploadButton.test.tsx`

- [ ] **Step 3: 공통 컴포넌트 최소 구현**

  공개 API는 다음 형태로 고정한다.

  ```ts
  interface FileUploadItem {
    id: string;
    name: string;
    size: number;
    status?: "selected" | "uploading" | "uploaded";
  }

  interface FileUploadButtonProps {
    inputLabel: string;
    buttonLabel: string;
    accept: string;
    multiple?: boolean;
    disabled?: boolean;
    items?: FileUploadItem[];
    onFiles(files: File[]): void;
    onRemove?(id: string): void;
  }
  ```

  실제 `input[type=file]`은 `visually-hidden` 처리하되 포커스 가능 상태를 유지하고, 버튼 역할의 `label`에 `Upload` 아이콘을 사용한다.

- [ ] **Step 4: 노출된 기본 파일 입력 세 곳 교체**

  - AI 콘텐츠 첨부: 역할별 선택 파일과 삭제 표시, 업로드 중 `UploadProgress` 표시
  - 브랜드 분석 문서: 복수 파일명·용량·개별 삭제 표시
  - 소스 CSV: 선택 파일명 표시와 선택 해제 지원

  로고 및 DM 데이터 업로드는 이미 실제 입력을 숨기고 자체 버튼을 사용하므로 동작을 바꾸지 않는다.

- [ ] **Step 5: 컴포넌트와 기존 업로더 테스트 통과 확인**

  Run: `npm test --workspace @brand-pilot/customer-ui -- src/components/ui/FileUploadButton.test.tsx src/components/ai-content/AiContentAttachmentUploader.test.tsx`

---

### Task 2: 전역 select·스크롤바 스타일 통일

**Files:**
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Modify: `apps/customer-ui/src/__tests__/responsiveStyles.test.ts`

- [ ] **Step 1: 전역 스타일 계약 실패 테스트 작성**

  CSS에 `select:not([multiple])`의 `appearance: none`, 공통 포커스·비활성 상태, `scrollbar-width: thin`, WebKit 스크롤바 폭·thumb 규칙이 존재하는지 검사한다.

- [ ] **Step 2: 기존 CSS에서 테스트 실패 확인**

  Run: `npm test --workspace @brand-pilot/customer-ui -- src/__tests__/responsiveStyles.test.ts`

- [ ] **Step 3: 전역 스타일 구현**

  - 모든 단일 `select`에 44px 이하로 줄어들지 않는 높이, 오른쪽 화살표 여백, 동일 테두리·포커스·비활성 상태 적용
  - `html`, 모달 본문, DM 메시지 스트림, 테이블·차트 가로 스크롤에 동일한 얇은 스크롤바 적용
  - 스크롤 기능, 마우스 휠, 키보드 스크롤, 기존 체크박스·라디오 UI는 유지
  - `prefers-reduced-motion`에서는 진행 표시 애니메이션 비활성화

- [ ] **Step 4: 스타일 계약 테스트 통과 확인**

  Run: `npm test --workspace @brand-pilot/customer-ui -- src/__tests__/responsiveStyles.test.ts`

---

### Task 3: 최근 검색어 삭제 API와 UI

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/instagramTrendRepository.ts`
- Modify: `apps/api/src/instagramTrendRepository.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.test.ts`
- Modify: `apps/customer-ui/src/pages/InstagramTrendsPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/instagramTrends.test.tsx`

- [ ] **Step 1: 브랜드 범위 삭제 계약 테스트 작성**

  다음 계약을 테스트한다.

  ```http
  DELETE /brands/:brandId/instagram-trend-searches/:hashtagId
  200 { "hashtagId": "..." }
  ```

  삭제 대상은 `brand_trend_searches` 한 행뿐이다. 공유 해시태그·미디어와 이미 저장한 아카이브는 삭제하지 않는다. 다른 브랜드의 검색 기록은 삭제할 수 없어야 한다.

- [ ] **Step 2: API 테스트 실패 확인 후 repository·route 구현**

  Run: `npm test --workspace @brand-pilot/api -- src/instagramTrendRepository.test.ts src/server.test.ts`

- [ ] **Step 3: 최근 검색 태그를 태그 버튼과 삭제 아이콘으로 분리**

  `Trash2` 아이콘 버튼을 태그 오른쪽에 두고, 삭제 성공 시 `view.histories`에서 즉시 제거한다. 검색 중에는 비활성화하며 API 실패 시 기존 트렌드 오류 영역에 삭제 실패 안내를 표시한다.

- [ ] **Step 4: 프론트 테스트 통과 확인**

  Run: `npm test --workspace @brand-pilot/customer-ui -- src/__tests__/instagramTrends.test.tsx src/lib/apiClient.test.ts`

---

### Task 4: 트렌드 북마크와 아카이브

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/instagramTrendRepository.ts`
- Modify: `apps/api/src/instagramTrendRepository.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/components/trends/TrendMediaCard.tsx`
- Modify: `apps/customer-ui/src/components/trends/TrendMediaCard.test.tsx`
- Create: `apps/customer-ui/src/pages/ArchivePage.tsx`
- Create: `apps/customer-ui/src/__tests__/archive.test.tsx`
- Modify: `apps/customer-ui/src/pages/InstagramTrendsPage.tsx`
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Modify: `apps/customer-ui/src/routes.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: 아카이브 조회 계약 테스트 작성**

  ```http
  GET /brands/:brandId/instagram-trends/archive?page=1&limit=30
  200 { "items": [...], "page": 1, "limit": 30, "total": 12 }
  ```

  `brand_trend_saved_media`를 `instagram_trend_media`, `source_urls`와 조인해 저장 시각 내림차순으로 반환한다. 반환 항목은 기존 `InstagramTrendMedia` 필드와 `savedAt`을 포함한다.

- [ ] **Step 2: 조회 API 구현 및 테스트 통과**

  저장 API는 기존 `saveInstagramTrendSource`를 그대로 사용해 중복 저장을 허용하지 않는다.

- [ ] **Step 3: 카드 구조를 중첩 버튼 없는 구조로 변경**

  기존 전체 카드 `<button>`을 `<article>`로 바꾸고, 미디어 상세 버튼과 오른쪽 상단 `Bookmark` 버튼을 형제 요소로 둔다. 저장 완료 시 `BookmarkCheck`로 바꾸고 재클릭은 차단한다.

- [ ] **Step 4: 아카이브 페이지와 메뉴 추가**

  `/archive`에서 저장 미디어를 카드 그리드로 표시하고 상세 모달 및 원본 Instagram 링크를 재사용한다. 사이드바 콘텐츠 운영 그룹에서 `소스` 바로 아래에 `아카이브`를 추가한다.

- [ ] **Step 5: API·UI 테스트 통과 확인**

  Run: `npm test --workspace @brand-pilot/api -- src/instagramTrendRepository.test.ts src/server.test.ts`

  Run: `npm test --workspace @brand-pilot/customer-ui -- src/components/trends/TrendMediaCard.test.tsx src/__tests__/archive.test.tsx src/__tests__/instagramTrends.test.tsx`

---

### Task 5: 브랜드 설정 정보 구조 재배치

**Files:**
- Modify: `apps/customer-ui/src/pages/BrandSettingsPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandSettings.test.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: 섹션 순서와 저장 계약 테스트 작성**

  DOM 순서를 `브랜드 프로필 → 생성 기준 → 자동 승인 → Instagram 콘텐츠 형식 → 확정된 브랜드 정보`로 검사한다. 브랜드 주색은 프로필 안에 표시되지만 저장 요청은 기존 `updateInstagramFormats`의 `brandColor`를 계속 사용해야 한다.

- [ ] **Step 2: Instagram 콘텐츠 형식을 접근 가능한 아코디언으로 변경**

  `button[aria-expanded]`과 연결된 패널을 사용하고 기본은 펼침 상태로 둔다. 패널 내부 순서는 카드뉴스, 릴스, 스토리이며 DB의 고정 순환 순서 및 활성화 로직은 변경하지 않는다.

- [ ] **Step 3: 브랜드 주색 입력 위치 이동**

  브랜드 프로필의 로고·브랜드명 영역 다음에 주색 입력을 배치한다. `draftFormats.brandColor` 상태와 기존 저장 요청을 그대로 재사용해 DB 변경을 만들지 않는다.

- [ ] **Step 4: 브랜드 설정 테스트 통과 확인**

  Run: `npm test --workspace @brand-pilot/customer-ui -- src/__tests__/brandSettings.test.tsx src/__tests__/brandSettings.regression-1.test.tsx`

---

### Task 6: AI 콘텐츠 잔여 사용량을 topbar로 이동

**Files:**
- Create: `apps/customer-ui/src/features/ai-content/AiContentUsageContext.tsx`
- Create: `apps/customer-ui/src/features/ai-content/AiContentUsageContext.test.tsx`
- Modify: `apps/customer-ui/src/components/layout/AppShell.tsx`
- Modify: `apps/customer-ui/src/components/layout/Topbar.tsx`
- Modify: `apps/customer-ui/src/__tests__/navigation.test.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentHomePage.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentWizardPage.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentGenerationPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/aiContentHome.test.tsx`

- [ ] **Step 1: 전역 사용량 상태 테스트 작성**

  공급자는 앱 시작 시 한 번 사용량을 조회하고 `usage`, `loading`, `refresh()`를 제공한다. `Topbar`는 생성·다운로드 잔여 횟수를 표시하며 조회 실패 시 헤더 전체를 깨뜨리지 않고 사용량만 숨긴다.

- [ ] **Step 2: Provider와 Topbar 표시 구현**

  기존 `AiContentUsageSummary`를 `.topbar-actions` 앞에 배치하고 AI 콘텐츠 목록의 `PageHeader`에서는 제거한다. 생성 요청 성공 및 다운로드 성공 후 `refresh()`를 호출해 헤더 수량을 갱신한다.

- [ ] **Step 3: 사용량·내비게이션 테스트 통과 확인**

  Run: `npm test --workspace @brand-pilot/customer-ui -- src/features/ai-content/AiContentUsageContext.test.tsx src/__tests__/navigation.test.tsx src/__tests__/aiContentHome.test.tsx`

---

### Task 7: 확정 브랜드 분석 온보딩 강제

**Files:**
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/customer-ui/src/lib/brandSetup.ts`
- Modify: `apps/customer-ui/src/components/layout/BrandSetupGate.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandSetupGate.test.tsx`
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: active brand analysis 기반 상태 테스트 작성**

  기존 프로필 필드가 채워져 있어도 `brand_profiles.active_brand_analysis_id`가 없으면 `brand-profile` 단계를 완료로 판단하지 않는다. 확정 분석이 있으면 완료로 판단한다.

- [ ] **Step 2: 게이트 경로 테스트 작성**

  미완료 사용자는 일반 페이지 접근 시 `/onboarding/brand-intelligence`로 이동한다. 분석 페이지와 고객센터는 접근 가능하며 `/onboarding`은 브랜드 분석 페이지로 연결한다. `/brand-settings`를 통한 우회는 허용하지 않는다.

- [ ] **Step 3: 서버 상태와 프론트 게이트 수정**

  `legacyBrandProfileDone` 우회 조건을 제거하고 `active_brand_analysis_id`를 기준으로 완료 상태를 계산한다. 사이드바는 미완료 상태에서 브랜드 분석과 고객센터만 사용할 수 있게 표시한다.

- [ ] **Step 4: 온보딩 테스트 통과 확인**

  Run: `npm test --workspace @brand-pilot/api -- src/repository.test.ts`

  Run: `npm test --workspace @brand-pilot/customer-ui -- src/__tests__/brandSetupGate.test.tsx src/__tests__/brandIntelligenceOnboarding.test.tsx`

---

### Task 8: AI 콘텐츠 상세·목록 레이아웃

**Files:**
- Create: `apps/customer-ui/src/components/ai-content/ArtifactCarousel.tsx`
- Create: `apps/customer-ui/src/components/ai-content/ArtifactCarousel.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentArtifactPreview.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentArtifactPreview.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiGenerationOutputList.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentJobList.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentHomePage.tsx`
- Modify: `apps/customer-ui/src/__tests__/aiContentHome.test.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: 상세 화면 순서와 캐러셀 테스트 작성**

  완료 결과의 DOM 순서는 `결과 미리보기 → SNS에 바로 게시 → 다운로드/재생성`이어야 한다. 카드뉴스는 한 번에 한 장만 표시하고 이전·다음 버튼, 현재 장수, 썸네일 또는 점 표시를 제공한다. 이미지 비율은 자산의 실제 `width/height`를 사용하고 크롭하지 않는다.

- [ ] **Step 2: 캐러셀 및 상세 순서 구현**

  블로그 HTML과 마케팅 단일 이미지는 기존 미리보기 방식을 유지한다. 우클릭 저장 방지 동작도 유지한다.

- [ ] **Step 3: 작업 목록을 카드 그리드로 변경**

  각 카드는 유형, 제목, 상태, 수정일, 완료 개수, 첫 결과 썸네일을 표시하고 카드 전체 상세 링크를 제공한다. 진행 중 결과는 안정적인 비율의 플레이스홀더를 표시한다.

- [ ] **Step 4: 하단 성과 콘텐츠 제거 및 불필요 조회 제거**

  `AiContentHomePage`의 `references` 상태와 `listReferences()` 호출을 제거해 목록 초기 로딩을 줄인다.

- [ ] **Step 5: AI 콘텐츠 UI 테스트 통과 확인**

  Run: `npm test --workspace @brand-pilot/customer-ui -- src/components/ai-content/ArtifactCarousel.test.tsx src/components/ai-content/AiContentArtifactPreview.test.tsx src/components/ai-content/AiGenerationOutputList.test.tsx src/__tests__/aiContentHome.test.tsx`

---

### Task 9: Instagram Story 직접 게시 신뢰성

**Files:**
- Modify: `apps/api/src/aiContentPublish.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/customer-ui/src/features/ai-content/types.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentPublishPanel.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentPublishPanel.test.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentGenerationPage.tsx`

- [ ] **Step 1: 3장 카드뉴스의 Story 게시 계약 테스트 작성**

  `instagram_story` 선택 시 첫 번째 자산 한 장만 `output_json.story`와 `cards`에 전달되고, 연결된 Instagram 채널로 게시 큐가 생성되어 즉시 게시 호출까지 이어지는지 검사한다. Reel 변환 경로는 테스트와 구현 모두 변경하지 않는다.

- [ ] **Step 2: 게시 단계 실패 결과를 보존하는 route 테스트 작성**

  준비 단계 오류는 요청 ID와 오류 코드를 구조화 로그에 남긴다. 큐 생성 후 게시 실패는 롤백하지 않고 `targets[].status = "failed"`, `errorCode`를 반환해야 한다.

- [ ] **Step 3: 오류 코드별 UI 안내 구현**

  `channel_oauth_not_connected`, `delivery_format_asset_mismatch`, `instagram_story_publish_failed`, 권한 만료, 미디어 URL 접근 실패를 한국어로 표시한다. 실패한 Story 유형의 `다시 시도`는 같은 대상만 보내며 새 idempotency key를 사용한다.

- [ ] **Step 4: 게시 테스트 통과 확인**

  Run: `npm test --workspace @brand-pilot/api -- src/aiContentPublish.test.ts src/server.test.ts`

  Run: `npm test --workspace @brand-pilot/customer-ui -- src/components/ai-content/AiContentPublishPanel.test.tsx src/__tests__/aiContentGeneration.test.tsx`

---

### Task 10: DM 수동 답변 실패 감사 기록과 원인 표시

**Files:**
- Create: `db/migrations/053_dm_manual_delivery_audit.sql`
- Modify: `db/README.md`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.dmOperations.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.dmOperations.test.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/components/dm/DmConversationThread.tsx`
- Modify: `apps/customer-ui/src/__tests__/dmAutomation.test.tsx`

- [ ] **Step 1: 수동 발송 감사 계약 테스트 작성**

  `dm_delivery_attempts.job_id`를 수동 발송에서 nullable로 허용하고 `origin`을 `auto | manual`로 기록한다. 수동 발송은 클라이언트가 전달한 UUID idempotency key를 `dedupe_key`에 저장한다.

  ```json
  { "body": "답변 내용", "idempotencyKey": "UUID" }
  ```

- [ ] **Step 2: 성공·실패 repository 테스트 작성**

  발송 전 `prepared → sending`을 기록하고 성공 시 `sent`와 공급자 메시지 ID를 저장한다. 실패 시 `failed` 또는 `unknown`과 분류된 Meta 오류 코드를 저장한 뒤 같은 오류 코드를 API로 반환한다. 같은 idempotency key 재요청은 두 번째 메시지를 발송하지 않는다.

- [ ] **Step 3: migration과 repository 구현**

  기존 자동응답 작업의 `job_id`, dedupe, FK 동작은 유지한다. 수동 발송 실패는 자동응답 상태를 임의로 중지하지 않는다.

- [ ] **Step 4: 프론트 오류 안내 구현**

  현재 모든 예외를 `수동 답변을 전송하지 못했습니다`로 숨기는 catch를 제거하고 다음 원인을 구분한다.

  - 채널 인증 준비 안 됨
  - 토큰 만료·권한 부족
  - 24시간 메시지 응답 가능 시간 초과 또는 수신자 제한
  - Meta 일시 장애·전송 결과 불명
  - 알 수 없는 오류와 요청 ID

- [ ] **Step 5: DB·API·UI 테스트 통과 확인**

  Run: `npm run db:migrate -- --dry-run`

  Run: `npm test --workspace @brand-pilot/api -- src/repository.dmOperations.test.ts src/server.dmOperations.test.ts`

  Run: `npm test --workspace @brand-pilot/customer-ui -- src/__tests__/dmAutomation.test.tsx`

---

### Task 11: 통합 빌드와 제한된 E2E 검증

**Files:**
- Modify: `apps/customer-ui/e2e/customer-ui.spec.ts`
- Modify: `apps/customer-ui/e2e/instagram-trends.spec.ts`
- Create: `apps/customer-ui/e2e/ai-content-polish.spec.ts`

- [ ] **Step 1: 마이그레이션과 타입 빌드 확인**

  Run: `npm run db:migrate -- --dry-run`

  Expected: `applied: []`

  Run: `npm run build --workspace @brand-pilot/customer-ui`

- [ ] **Step 2: 기능별 단위 테스트 전체 실행**

  Run: `npm test --workspace @brand-pilot/customer-ui`

  Run: `npm test --workspace @brand-pilot/api`

- [ ] **Step 3: 고객 핵심 경로 E2E 한 번 실행**

  다음 경로만 실행해 과도한 검증 루프를 피한다.

  1. 미분석 계정이 브랜드 분석으로 리다이렉트됨
  2. 트렌드 최근 검색 삭제, 카드 북마크, 아카이브 확인
  3. 브랜드 설정 아코디언·주색 저장
  4. AI 콘텐츠 목록 카드와 상세 캐러셀·게시 영역 순서
  5. DM 수동 답변 오류 코드 표시

  Run: `npm run e2e --workspace @brand-pilot/customer-ui -- customer-ui.spec.ts instagram-trends.spec.ts ai-content-polish.spec.ts`

- [ ] **Step 4: 실제 연결 계정 smoke 검증**

  운영 데이터에 영향을 주지 않는 조회를 먼저 확인하고, Story/DM 실발송은 기존 Growthline 테스트 대화·콘텐츠 한 건에 한해 각각 한 번만 수행한다. 성공 시 외부 메시지/게시 ID와 DB 상태를 대조하고, 실패 시 저장된 오류 코드로 원인을 보고한다.

---

## 현재 조사 결과

- AI 콘텐츠 제품·서비스 분석 500 오류는 누락된 DB migration 051·052 적용으로 해결되었고 동일 입력이 3단계까지 진행된다.
- 대상 카드뉴스 `3fa56155-de02-4b85-81bd-c8b5053593e9`는 완료 상태, 이미지 3장, Instagram 채널과 활성 `instagram_login` 자격 증명이 존재한다.
- 현재 DB의 최근 Instagram Story 게시 기록은 모두 `published`이며 실패 행은 없다. 기존 실패는 준비 단계에서 롤백되어 역사적 원인을 복원할 수 없으므로 Task 9에서 구조화 오류 기록을 추가한다.
- 최신 DM 대화의 Instagram 채널·자격 증명·외부 계정 ID는 모두 활성 상태다. 현재 수동 답변 경로는 Meta 오류를 UI에서 모두 같은 문구로 숨기고 실패 시도도 저장하지 않아 역사적 원인을 확인할 수 없으므로 Task 10에서 감사 기록을 추가한다.
- 트렌드 북마크 저장 테이블과 `saveInstagramTrendSource`는 이미 존재하므로 새 저장 테이블은 만들지 않는다.

## 완료 기준

- 기본 파일 선택기가 사용자에게 직접 노출되지 않는다.
- 최근 검색 삭제와 북마크·아카이브가 브랜드별로 동작한다.
- 브랜드 설정 저장 계약은 유지하면서 요청한 배치로 표시된다.
- 사용량이 모든 앱 화면의 `.topbar`에서 보이고 성공 작업 후 갱신된다.
- 확정 브랜드 분석이 없으면 일반 기능에 접근할 수 없다.
- 카드뉴스 상세는 실제 이미지 캐러셀로 보이고 게시 선택은 그 아래에 있다.
- Story와 DM 실패가 원인 코드와 함께 DB·로그·UI에 남는다.
- AI 콘텐츠 목록은 카드형이며 성과 콘텐츠 섹션과 불필요한 조회가 제거된다.
- 단위 테스트, UI 빌드, 제한된 핵심 E2E가 통과한다.
