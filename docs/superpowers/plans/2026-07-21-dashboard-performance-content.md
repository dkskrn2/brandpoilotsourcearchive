# Dashboard Performance Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 최근 30일에 성과가 수집된 모든 게시물을 통합 순위로 보여주고, 클릭 시 결과물과 게시 정보를 지연 조회하는 상세 팝업을 제공한다.

**Architecture:** 기존 `publish_queue` 대시보드 조회를 유지하되 최신 성과가 없는 행만 응답 순위에서 제외한다. 고객 UI는 기존 게시 결과물 API와 `PublishArtifactPreview`를 재사용해 상세를 클릭할 때만 결과물을 가져온다.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, PostgreSQL repository

---

### Task 1: 성과 순위 계약

**Files:**
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/repository.ts`

- [x] **Step 1: 실패 테스트 작성**

성과값이 `null`인 게시물과 `0`인 게시물을 함께 반환하는 저장소 테스트를 만들고, 순위에는 `0`인 게시물만 남는다고 단언한다.

- [x] **Step 2: 실패 확인**

Run: `npx vitest run src/repository.test.ts -t "excludes unmeasured content"`

Expected: `queue-null`이 반환되어 FAIL.

- [x] **Step 3: 최소 구현**

`publishedResult.rows`에서 `numberOrNull(row.exposure_count) !== null`인 행만 남긴 뒤 10개를 매핑한다.

- [x] **Step 4: 통과 확인**

같은 집중 테스트가 PASS인지 확인한다.

### Task 2: 성과 콘텐츠 상세 팝업

**Files:**
- Modify: `apps/customer-ui/src/__tests__/dashboard.test.tsx`
- Modify: `apps/customer-ui/src/pages/DashboardPage.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [x] **Step 1: 실패 테스트 작성**

섹션 제목, 클릭 가능한 상세 버튼, 클릭 전 결과물 API 미호출, 클릭 후 이미지·게시 정보·원본 링크 표시를 테스트한다.

- [x] **Step 2: 실패 확인**

Run: `npm test -- --run src/__tests__/dashboard.test.tsx`

Expected: 새 제목과 상세 버튼이 없어 FAIL.

- [x] **Step 3: 최소 구현**

목록 행을 버튼으로 바꾸고 선택된 콘텐츠가 있을 때만 `api.getPublishArtifact`를 호출하는 팝업을 렌더링한다. 결과물 표시는 기존 `PublishArtifactPreview`를 사용한다.

- [x] **Step 4: 반응형 스타일 적용**

데스크톱에서는 한 행에 제목과 성과를 표시하고, 모바일에서는 성과를 두 번째 줄로 이동한다. 팝업은 기존 게시 결과 상세의 반응형 레이아웃을 재사용한다.

- [x] **Step 5: 통과 확인**

Run: `npm test -- --run src/__tests__/dashboard.test.tsx`

Expected: 9 tests PASS.

### Task 3: 검증

**Files:**
- Verify: `apps/api`
- Verify: `apps/customer-ui`

- [x] **Step 1: API 빌드**

Run: `npm run build` in `apps/api`

Expected: TypeScript와 tsup 빌드 성공.

- [x] **Step 2: 고객 UI 빌드**

Run: `npm run build` in `apps/customer-ui`

Expected: TypeScript와 Vite 빌드 성공.

- [x] **Step 3: 저장소 회귀 테스트**

Run: `npx vitest run src/repository.test.ts` in `apps/api`

Expected: 전체 저장소 테스트 PASS.
