# Brand Center Core Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브랜드센터의 승인·수정 브랜드 코어를 온보딩과 동일한 7개 항목 및 폼 디자인으로 교체한다.

**Architecture:** `brand-core.v1`에 선택적 정규 필드를 추가하고 파서가 기존 중첩 필드에서 기본값을 유도해 하위 호환한다. 현재 활성 분석과 연결된 승인 버전은 분석 결과로 보정하며, 편집 시 정규 필드와 기존 소비자용 중첩 필드를 동시에 갱신한다.

**Tech Stack:** React 18, TypeScript, Vitest, PostgreSQL JSONB

---

### Task 1: 계약과 분석 매핑

**Files:**
- Modify: `apps/api/src/brandCoreContracts.ts`
- Modify: `apps/api/src/brandCoreContracts.test.ts`
- Modify: `apps/customer-ui/src/features/brand-center/types.ts`

- [ ] 분석 매핑 결과에 `companyOverview`, `businessDescription`, `primaryCategory`, `subcategories`, `primaryTarget`, `differentiators`, `coreAppeal`이 보존되는 실패 테스트를 작성한다.
- [ ] `npm test --workspace @brand-pilot/api -- --run src/brandCoreContracts.test.ts`를 실행해 정규 필드가 없어 실패하는지 확인한다.
- [ ] API·UI 타입에 7개 선택적 정규 필드를 추가한다.
- [ ] 파서가 정규 필드를 허용하고, 없는 기존 v1은 기존 중첩 필드에서 값을 유도하도록 구현한다.
- [ ] 분석→브랜드 코어 매핑이 7개 정규 필드를 저장하도록 구현한다.
- [ ] 같은 테스트를 다시 실행해 통과를 확인한다.

### Task 2: 브랜드센터 폼

**Files:**
- Modify: `apps/customer-ui/src/components/brand-center/BrandCoreReviewPanel.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/BrandCoreReviewPanel.test.tsx`
- Modify: `apps/customer-ui/src/styles/brand-center.css`

- [ ] 7개 라벨이 렌더링되고 기존 3개 라벨과 근거 드로어가 사라지는 실패 테스트를 작성한다.
- [ ] `npm test --workspace @brand-pilot/customer-ui -- --run src/components/brand-center/BrandCoreReviewPanel.test.tsx`로 실패를 확인한다.
- [ ] 7개 필드를 온보딩형 한 열 폼으로 렌더링하고 분야 두 필드만 데스크톱 두 열로 배치한다.
- [ ] 편집 시 정규 필드와 기존 중첩 필드를 함께 갱신하고 승인 필수값 검증을 7개 항목에 맞춘다.
- [ ] 근거 드로어 렌더링만 제거하고 evidence 데이터는 유지한다.
- [ ] 대상 테스트를 다시 실행해 통과를 확인한다.

### Task 3: 현재 승인 분석 보정

**Files:**
- Modify: `apps/customer-ui/src/pages/BrandCenterPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandCenter.test.tsx`

- [ ] 현재 승인 분석과 `sourceAnalysisId`가 일치할 때 7개 값이 분석 결과로 표시되는 실패 테스트를 작성한다.
- [ ] 대상 테스트 실패를 확인한다.
- [ ] v1/v2 분석 결과를 브랜드 코어 정규 필드와 기존 중첩 필드로 변환하는 순수 함수를 추가한다.
- [ ] 현재 승인 버전 표시와 수정 초안 생성에 변환 결과를 적용한다.
- [ ] 브랜드센터 테스트를 실행해 저장·승인·충돌 복구 회귀가 없는지 확인한다.

### Task 4: 검증과 운영 배포

**Files:**
- Verify: `apps/customer-ui`
- Verify: `apps/api`

- [ ] 고객 UI 및 API 전체 테스트와 빌드를 실행한다.
- [ ] `git diff --check`와 변경 파일 목록을 확인한다.
- [ ] 변경사항을 커밋하고 원격 브랜치에 푸시한다.
- [ ] 운영 배포 절차를 실행하고 배포 완료 상태를 확인한다.
- [ ] 운영 로그인·브랜드센터·온보딩 경로의 HTTP 상태와 화면 문구를 확인한다.
