# Customer Shell, Performance, Feedback, and Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 D안 기능과 확정 데이터를 보존하면서 성과·개선 UI, 헤더 없는 사이드바 셸, 간소화 문의와 문의내역, 중복 없는 온보딩 상태 흐름을 함께 배포한다.

**Architecture:** 기존 React/Fastify/PostgreSQL 계약을 재사용한다. 성과 화면과 셸은 프런트 전용 변경으로 분리하고, 신규 문의는 기존 `support_requests`에 저장한다. 브랜드 분석은 기존 confirmed 조회를 유지하면서 별도의 open workflow 조회와 partial unique index를 추가해 브랜드당 진행 중 작업을 한 건으로 제한한다.

**Tech Stack:** React 18, React Router, TypeScript, Vite, Vitest, Testing Library, Fastify, PostgreSQL/PGlite, GitHub Actions, Vercel, Ubuntu Docker/Caddy.

---

## 실행 원칙

- 기준 설계: `docs/superpowers/specs/2026-07-30-customer-shell-performance-feedback-onboarding-design.md`
- 각 Task는 짧은 focused test만 실행한다.
- 무관한 전체 테스트, 전체 migration, 실제 PostgreSQL, Playwright 묶음은 구현 중 반복하지 않는다.
- 전체 회귀와 실제 브라우저 검증은 병합·배포 직전 한 번만 실행한다.
- 성과 UI, 셸, 문의 API·컴포넌트, 온보딩 repository는 독립 에이전트가 병렬 구현할 수 있다.
- `AppShell.tsx`, `BrandCenterPage.tsx`, `routes.tsx`의 최종 조립은 한 통합 담당자만 수행한다.
- 운영 env와 비밀정보는 변경하지 않는다.

## 파일 책임 지도

| 단위 | 책임 파일 |
|---|---|
| 성과 UI | `PerformanceInsightsPage.tsx`, `components/performance/*`, `styles/performance.css` |
| 셸 | `AppShell.tsx`, `Topbar.tsx`, `Sidebar.tsx`, `SidebarBrandProfile.tsx`, `navigationModel.ts`, `styles/shell.css` |
| 문의 | `FeedbackDialog.tsx`, `SupportRequestHistory.tsx`, `apiClient.ts`, API `types.ts`, `httpServer.ts`, `repository.ts` |
| 온보딩 서버 | `brandIntelligenceRepository.ts`, `brandIntelligenceHttp.ts`, `httpServer.ts`, migration `069` |
| 온보딩 UI | `LiveBrandCenterOnboarding.tsx`, `BrandCenterPage.tsx`, brand-intelligence gateway/types |
| 최종 조립 | `AppShell.tsx`, `BrandCenterPage.tsx`, regression matrix, deploy docs/checks |

## 병렬 실행 묶음

- Stream A: Task 1–2
- Stream B: Task 3–4
- Stream C: Task 5–6
- Stream D: Task 7–9
- Task 10–11은 네 Stream이 끝난 뒤 순차 실행한다.

### Task 1: 성과·개선 정보 위계와 콘텐츠 목록

**Files:**

- Create: `apps/customer-ui/src/components/performance/PerformanceContentList.tsx`
- Modify: `apps/customer-ui/src/pages/PerformanceInsightsPage.tsx`
- Modify: `apps/customer-ui/src/components/performance/PerformanceSummary.tsx`
- Modify: `apps/customer-ui/src/components/performance/PerformanceObservationList.tsx`
- Modify: `apps/customer-ui/src/components/performance/PerformanceExperimentCards.tsx`
- Modify: `apps/customer-ui/src/styles/performance.css`
- Test: `apps/customer-ui/src/__tests__/performanceInsights.test.tsx`

- [ ] **Step 1: 화면 위계에 대한 실패 테스트를 추가한다**

`performanceInsights.test.tsx`에 다음 assertion을 추가한다.

```tsx
expect(await screen.findByRole("region", { name: "최근 30일 성과 요약" }))
  .toHaveTextContent("최근 30일");
expect(screen.getByRole("list", { name: "성과 콘텐츠" })).toBeVisible();
expect(screen.getByRole("region", { name: "측정 구간" })).toHaveTextContent("24h");
expect(screen.getByRole("button", { name: /AI 구성안 만들기/ })).toBeVisible();
```

- [ ] **Step 2: focused test가 새 assertion에서 실패하는지 확인한다**

```bash
npm run test --workspace @brand-pilot/customer-ui -- performanceInsights.test.tsx
```

예상 결과: 새 region/list 접근성 이름이 없어 FAIL.

- [ ] **Step 3: 기존 데이터만 사용해 화면을 재구성한다**

`PerformanceContentList.tsx`는 다음 입력만 받는다.

```tsx
interface PerformanceContentListProps {
  contents: PerformanceInsights["topContents"];
  onSelect(content: PerformanceInsights["topContents"][number], trigger: HTMLButtonElement): void;
}
```

`PerformanceInsightsPage`의 순서는 요약 → 관측·해석 → 성과 콘텐츠 → 측정 구간 → 다음 실험으로 고정한다. `performanceGateway`, `performanceViewModel`, API DTO는 수정하지 않는다.

- [ ] **Step 4: focused test를 다시 실행한다**

```bash
npm run test --workspace @brand-pilot/customer-ui -- performanceInsights.test.tsx performanceViewModel.test.ts
git diff --check
```

예상 결과: 두 파일 PASS, diff check clean.

- [ ] **Step 5: 커밋한다**

```bash
git add apps/customer-ui/src/pages/PerformanceInsightsPage.tsx apps/customer-ui/src/components/performance apps/customer-ui/src/styles/performance.css apps/customer-ui/src/__tests__/performanceInsights.test.tsx
git commit -m "feat(performance): improve insights hierarchy"
```

### Task 2: 성과 콘텐츠 상세 팝업 접근성

**Files:**

- Modify: `apps/customer-ui/src/components/performance/PerformanceContentDialog.tsx`
- Modify: `apps/customer-ui/src/pages/PerformanceInsightsPage.tsx`
- Create: `apps/customer-ui/src/components/performance/PerformanceContentDialog.test.tsx`

- [ ] **Step 1: 팝업 실패 테스트를 작성한다**

```tsx
expect(screen.getByRole("button", { name: "닫기" })).toHaveFocus();
fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
expect(onClose).toHaveBeenCalledTimes(1);
fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
await waitFor(() => expect(loadArtifact).toHaveBeenCalledTimes(2));
```

페이지 테스트에는 팝업을 닫은 뒤 선택했던 콘텐츠 버튼으로 포커스가 복원되는 assertion을 추가한다.

- [ ] **Step 2: 새 테스트의 실패를 확인한다**

```bash
npm run test --workspace @brand-pilot/customer-ui -- PerformanceContentDialog.test.tsx performanceInsights.test.tsx
```

예상 결과: 초기 포커스 또는 재시도 assertion에서 FAIL.

- [ ] **Step 3: 기존 `FocusTrap`을 재사용해 최소 구현한다**

- 닫기 버튼을 초기 포커스로 지정한다.
- Escape와 backdrop click을 지원한다.
- artifact 오류 시 팝업을 유지하고 `reloadKey`를 증가시켜 다시 조회한다.
- 외부 URL은 존재할 때만 `target="_blank" rel="noreferrer"`로 표시한다.
- 페이지는 마지막 trigger ref를 보관해 `onClose` 뒤 복원한다.

- [ ] **Step 4: 두 focused test만 실행한다**

```bash
npm run test --workspace @brand-pilot/customer-ui -- PerformanceContentDialog.test.tsx performanceInsights.test.tsx
git diff --check
```

- [ ] **Step 5: 커밋한다**

```bash
git add apps/customer-ui/src/components/performance/PerformanceContentDialog.tsx apps/customer-ui/src/components/performance/PerformanceContentDialog.test.tsx apps/customer-ui/src/pages/PerformanceInsightsPage.tsx apps/customer-ui/src/__tests__/performanceInsights.test.tsx
git commit -m "fix(performance): preserve accessible details"
```

### Task 3: 데스크톱 헤더 제거와 사이드바 사용량 이동

**Files:**

- Create: `apps/customer-ui/src/components/layout/SidebarUsageSummary.tsx`
- Modify: `apps/customer-ui/src/components/layout/AppShell.tsx`
- Modify: `apps/customer-ui/src/components/layout/Topbar.tsx`
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentUsageSummary.tsx`
- Modify: `apps/customer-ui/src/features/navigation/navigationModel.ts`
- Modify: `apps/customer-ui/src/styles/shell.css`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Test: `apps/customer-ui/src/__tests__/navigation.test.tsx`
- Test: `apps/customer-ui/src/__tests__/responsiveStyles.test.ts`

- [ ] **Step 1: 이동된 사용량과 breakpoint 실패 테스트를 작성한다**

```tsx
expect(screen.queryByRole("banner", { name: "데스크톱 헤더" })).not.toBeInTheDocument();
expect(screen.getByLabelText("오늘 AI 콘텐츠 잔여 사용량")).toHaveTextContent("생성 9회 남음");
expect(screen.getByLabelText("오늘 AI 콘텐츠 잔여 사용량")).toHaveTextContent("다운로드 18회 남음");
expect(screen.queryByText("준비 완료")).not.toBeInTheDocument();
```

`responsiveStyles.test.ts`는 desktop sidebar를 숨기는 breakpoint와 mobile trigger를 표시하는 breakpoint가 모두 `1080px`인지 검증한다.

- [ ] **Step 2: 두 테스트의 실패를 확인한다**

```bash
npm run test --workspace @brand-pilot/customer-ui -- navigation.test.tsx responsiveStyles.test.ts
```

- [ ] **Step 3: 데스크톱 헤더를 제거하고 모바일 최소 바만 남긴다**

- `Topbar`는 `mobile-menu-trigger`만 렌더하는 모바일 전용 bar가 된다.
- `AppShell`은 모바일 bar를 계속 렌더해 drawer 접근 경로를 보존한다.
- `SidebarUsageSummary`는 `useAiContentUsage()`의 기존 전역 상태를 읽고 `.nav`의 마지막에 배치한다.
- loading/error일 때 사이드바 전체를 막지 않고 사용량 영역만 숨긴다.
- `onboardingNavigationItem.path`를 `/onboarding/brand-intelligence`로 교체한다.
- 기존 `.nav { min-height: 0; overflow-y: auto }`를 유일한 스크롤 소유자로 유지해 세로 공간이 부족할 때 메뉴와 사용량을 스크롤한다.
- `.sidebar` 자체에는 overflow를 추가하지 않아 collapsed 프로필 메뉴가 잘리지 않게 한다.
- `981–1080px`에서도 mobile trigger가 보이도록 breakpoint를 `1080px`로 통일한다.

- [ ] **Step 4: focused test만 다시 실행한다**

```bash
npm run test --workspace @brand-pilot/customer-ui -- navigation.test.tsx responsiveStyles.test.ts
git diff --check
```

- [ ] **Step 5: 커밋한다**

```bash
git add apps/customer-ui/src/components/layout apps/customer-ui/src/components/ai-content/AiContentUsageSummary.tsx apps/customer-ui/src/features/navigation/navigationModel.ts apps/customer-ui/src/styles/shell.css apps/customer-ui/src/styles/prototype.css apps/customer-ui/src/__tests__/navigation.test.tsx apps/customer-ui/src/__tests__/responsiveStyles.test.ts
git commit -m "feat(shell): move account usage into sidebar"
```

### Task 4: 사이드바 프로필 드롭다운

**Files:**

- Modify: `apps/customer-ui/src/components/layout/SidebarBrandProfile.tsx`
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Modify: `apps/customer-ui/src/styles/shell.css`
- Test: `apps/customer-ui/src/__tests__/navigation.test.tsx`

- [ ] **Step 1: 메뉴 동작 실패 테스트를 작성한다**

```tsx
await user.click(screen.getByRole("button", { name: /계정 메뉴 열기/ }));
expect(screen.getByRole("menuitem", { name: "브랜드센터" }))
  .toHaveAttribute("href", "/brand-center");
expect(screen.getByRole("menuitem", { name: "로그아웃" })).toBeVisible();
await user.keyboard("{Escape}");
expect(screen.queryByRole("menu")).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: /계정 메뉴 열기/ })).toHaveFocus();
```

온보딩 미완료 fixture에서도 계정 메뉴와 로그아웃이 보이는 assertion을 추가한다.

- [ ] **Step 2: 실패를 확인한다**

```bash
npm run test --workspace @brand-pilot/customer-ui -- navigation.test.tsx
```

- [ ] **Step 3: 드롭다운을 구현한다**

- 프로필 wrapper를 `position:relative`로 둔다.
- trigger는 브랜드 로고·이름·chevron을 포함한다.
- 메뉴는 `NavLink` 브랜드센터와 logout button만 포함한다.
- `useAuth().logout`을 사용한다.
- 바깥 pointer down, Escape, route 변경 시 닫는다.
- 닫을 때 trigger로 포커스를 복원한다.
- collapsed sidebar에서는 아이콘/로고만 유지하고 메뉴는 sidebar 바깥으로 잘리지 않게 배치한다.
- mobile에서 메뉴 항목을 누르면 `onNavigate`로 drawer도 닫는다.

- [ ] **Step 4: focused test를 실행한다**

```bash
npm run test --workspace @brand-pilot/customer-ui -- navigation.test.tsx
git diff --check
```

- [ ] **Step 5: 커밋한다**

```bash
git add apps/customer-ui/src/components/layout/SidebarBrandProfile.tsx apps/customer-ui/src/components/layout/Sidebar.tsx apps/customer-ui/src/styles/shell.css apps/customer-ui/src/__tests__/navigation.test.tsx
git commit -m "feat(shell): add sidebar account menu"
```

### Task 5: 문의 계약을 `문의 유형 + 내용`으로 간소화

**Files:**

- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/components/feedback/FeedbackDialog.tsx`
- Modify: `apps/customer-ui/src/components/layout/AppShell.tsx`
- Modify: `apps/customer-ui/src/features/navigation/navigationModel.ts`
- Test: `apps/api/src/server.test.ts`
- Test: `apps/customer-ui/src/components/feedback/FeedbackDialog.test.tsx`
- Test: `apps/customer-ui/src/__tests__/navigation.test.tsx`

- [ ] **Step 1: API 실패 테스트를 추가한다**

새 고객 문의 body는 다음 형태다.

```ts
{
  category: "feature",
  message: "성과 화면에서 비교 기준을 선택하고 싶습니다."
}
```

테스트는 201 응답, 서버 생성 title `기능 요청`, nullable 연락처, 기존 상세 body 호환을 검증한다.

```ts
expect(repository.createSupportRequest).toHaveBeenCalledWith(brandId, {
  category: "feature",
  title: "기능 요청",
  message: "성과 화면에서 비교 기준을 선택하고 싶습니다.",
  contactPhone: null,
  contactEmail: null,
});
```

- [ ] **Step 2: 팝업 실패 테스트를 추가한다**

```tsx
await user.selectOptions(screen.getByLabelText("문의 유형"), "bug");
await user.type(screen.getByLabelText("내용"), "저장 버튼이 동작하지 않습니다.");
await user.click(screen.getByRole("button", { name: "보내기" }));
expect(onSubmit).toHaveBeenCalledWith({
  category: "bug",
  message: "저장 버튼이 동작하지 않습니다.",
});
expect(screen.queryByLabelText(/전화|이메일|제목/)).not.toBeInTheDocument();
```

- [ ] **Step 3: API와 UI 테스트의 실패를 확인한다**

```bash
npm run test --workspace @brand-pilot/api -- server.test.ts -t "support request"
npm run test --workspace @brand-pilot/customer-ui -- FeedbackDialog.test.tsx navigation.test.tsx
```

- [ ] **Step 4: 기존 support 저장소를 재사용해 구현한다**

API type을 다음처럼 확장한다.

```ts
export interface SupportRequestInput {
  category: SupportRequestCategory;
  title?: string;
  message: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
}
```

`POST /brands/:brandId/support-requests`는 title이 없으면 category label을 생성하고, contactPhone이 전달되지 않으면 null을 허용한다. 기존 DB의 `contact_phone`은 이미 nullable이므로 migration을 추가하지 않는다. 기존 title/phone body는 계속 허용한다.

`FeedbackDialog`의 submit 계약은 다음으로 변경한다.

```ts
onSubmit(input: {
  category: SupportRequestCategory;
  message: string;
}): Promise<void>;
```

예약 URL이 비어 있으면 통화 예약 카드를 렌더하지 않는다. `AppShell`은 `createFeedbackSubmission` 대신 `createSupportRequest`를 호출한다. `apiClient.ts`는 성공한 문의 생성 뒤에만 `SUPPORT_REQUESTS_CHANGED_EVENT`를 dispatch한다. 사이드바의 고객센터 항목만 `customerNavigation`에서 제거하고 `/support` route는 유지한다.

- [ ] **Step 5: focused test를 실행한다**

```bash
npm run test --workspace @brand-pilot/api -- server.test.ts -t "support request"
npm run test --workspace @brand-pilot/customer-ui -- FeedbackDialog.test.tsx navigation.test.tsx
git diff --check
```

- [ ] **Step 6: 커밋한다**

```bash
git add apps/api/src/types.ts apps/api/src/httpServer.ts apps/api/src/repository.ts apps/api/src/server.test.ts apps/customer-ui/src/types.ts apps/customer-ui/src/lib/apiClient.ts apps/customer-ui/src/components/feedback/FeedbackDialog.tsx apps/customer-ui/src/components/feedback/FeedbackDialog.test.tsx apps/customer-ui/src/components/layout/AppShell.tsx apps/customer-ui/src/features/navigation/navigationModel.ts apps/customer-ui/src/__tests__/navigation.test.tsx
git commit -m "feat(feedback): simplify customer inquiries"
```

### Task 6: 브랜드센터 공통 문의내역 컴포넌트

**Files:**

- Create: `apps/customer-ui/src/components/support/SupportRequestHistory.tsx`
- Create: `apps/customer-ui/src/components/support/SupportRequestHistory.test.tsx`
- Modify: `apps/customer-ui/src/styles/brand-center.css`

- [ ] **Step 1: 독립 컴포넌트 실패 테스트를 작성한다**

```tsx
expect(await screen.findByRole("region", { name: "문의 내역" })).toBeVisible();
await user.click(screen.getByRole("button", { name: /기능 요청/ }));
expect(screen.getByText("운영자 답변")).toBeVisible();
expect(screen.getByText("다음 배포에 반영하겠습니다.")).toBeVisible();
```

empty, loading, error, resolved 네 상태를 fixture로 검증한다.

- [ ] **Step 2: 실패를 확인한다**

```bash
npm run test --workspace @brand-pilot/customer-ui -- SupportRequestHistory.test.tsx
```

- [ ] **Step 3: 컴포넌트를 최소 구현한다**

Props는 API 의존성을 주입 가능하게 유지한다.

```ts
interface SupportRequestHistoryProps {
  brandId: string;
  listRequests?: typeof api.listSupportRequests;
  refreshToken?: number;
}
```

접수일, 문의 유형, 상태, 내용, 운영자 답변을 accordion으로 표시한다. 연락처는 신규·기존 모두 고객 화면에서 표시하지 않는다.
컴포넌트는 `SUPPORT_REQUESTS_CHANGED_EVENT`를 구독해 팝업에서 문의가 접수되면 목록을 한 번 갱신한다. 갱신 실패 시 기존 목록은 유지하고 inline warning만 표시한다.

- [ ] **Step 4: focused test를 실행한다**

```bash
npm run test --workspace @brand-pilot/customer-ui -- SupportRequestHistory.test.tsx
git diff --check
```

- [ ] **Step 5: 커밋한다**

```bash
git add apps/customer-ui/src/components/support/SupportRequestHistory.tsx apps/customer-ui/src/components/support/SupportRequestHistory.test.tsx apps/customer-ui/src/styles/brand-center.css
git commit -m "feat(brand-center): add inquiry history"
```

### Task 7: 브랜드별 open 분석 한 건을 DB와 repository에서 보장

**Files:**

- Create: `db/migrations/069_brand_analysis_one_open_workflow.sql`
- Modify: `apps/api/src/brandIntelligenceRepository.ts`
- Test: `apps/api/src/brandIntelligenceRepository.test.ts`
- Test: `scripts/migrations.integration.test.mjs`
- Test: `scripts/repository-contract.test.mjs`

- [ ] **Step 1: repository 동시성 실패 테스트를 작성한다**

서로 다른 idempotency key의 동시 요청 두 개가 같은 open run ID를 돌려주는지 검증한다.

```ts
const [first, second] = await Promise.all([
  repository.requestBrandAnalysis({ ...scope, idempotencyKey: randomUUID(), ownedUrl, uploadIds: [] }),
  repository.requestBrandAnalysis({ ...scope, idempotencyKey: randomUUID(), ownedUrl, uploadIds: [] }),
]);
expect(first.id).toBe(second.id);
expect(await countOpenRuns(scope.brandId)).toBe(1);
```

confirmed run과 open run이 동시에 조회될 수 있고 `getCurrentBrandIntelligence`는 계속 confirmed만 반환하는 assertion도 추가한다.

- [ ] **Step 2: repository test의 실패를 확인한다**

```bash
npm run test --workspace @brand-pilot/api -- brandIntelligenceRepository.test.ts
```

- [ ] **Step 3: migration을 작성한다**

```sql
begin;

with ranked as (
  select id,
         row_number() over (
           partition by brand_id
           order by created_at desc, id desc
         ) as position
  from brand_analysis_runs
  where status in ('queued', 'extracting', 'analyzing', 'review_ready')
)
update brand_analysis_runs run
set status = 'failed',
    error_code = 'brand_analysis_superseded',
    error_message = 'A newer open brand analysis was preserved.',
    leased_by = null,
    lease_token = null,
    lease_expires_at = null,
    completed_at = coalesce(run.completed_at, now()),
    updated_at = now()
from ranked
where run.id = ranked.id and ranked.position > 1;

create unique index brand_analysis_runs_one_open_per_brand_uq
  on brand_analysis_runs (brand_id)
  where status in ('queued', 'extracting', 'analyzing', 'review_ready');

commit;
```

과거 행은 삭제하지 않는다.

- [ ] **Step 4: repository에 open 조회와 재사용을 추가한다**

Interface에 다음 메서드를 추가한다.

```ts
getOpenBrandAnalysis(input: BrandAnalysisScope): Promise<BrandAnalysisRecord | null>;
```

`requestBrandAnalysis`는 brand row lock 안에서 순서대로 처리한다.

1. 같은 idempotency key 조회
2. open 상태 최신 run 조회
3. 없을 때만 insert
4. unique conflict면 open run 재조회

- [ ] **Step 5: 짧은 repository·contract 테스트를 실행한다**

```bash
npm run test --workspace @brand-pilot/api -- brandIntelligenceRepository.test.ts
node --test scripts/repository-contract.test.mjs
git diff --check
```

전체 migration integration은 이 단계에서 실행하지 않는다.

- [ ] **Step 6: 커밋한다**

```bash
git add db/migrations/069_brand_analysis_one_open_workflow.sql apps/api/src/brandIntelligenceRepository.ts apps/api/src/brandIntelligenceRepository.test.ts scripts/migrations.integration.test.mjs scripts/repository-contract.test.mjs
git commit -m "feat(onboarding): enforce one open brand analysis"
```

### Task 8: open workflow 고객 API와 gateway

**Files:**

- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.brandIntelligenceCustomer.test.ts`
- Modify: `apps/customer-ui/src/features/brand-intelligence/types.ts`
- Modify: `apps/customer-ui/src/features/brand-intelligence/brandIntelligenceGateway.ts`
- Modify: `apps/customer-ui/src/features/brand-intelligence/brandIntelligenceGateway.test.ts`

- [ ] **Step 1: API 실패 테스트를 작성한다**

```ts
const response = await app.inject({
  method: "GET",
  url: `/brands/${brandId}/brand-intelligence/workflow`,
  cookies: sessionCookie,
});
expect(response.statusCode).toBe(200);
expect(response.json()).toEqual({ workflow: expect.objectContaining({ status: "review_ready" }) });
```

다른 브랜드의 workflow가 노출되지 않는 scope assertion도 추가한다.

- [ ] **Step 2: API test의 실패를 확인한다**

```bash
npm run test --workspace @brand-pilot/api -- server.brandIntelligenceCustomer.test.ts
```

- [ ] **Step 3: 고객 endpoint와 gateway를 구현한다**

Endpoint:

```text
GET /brands/:brandId/brand-intelligence/workflow
```

Response:

```ts
{ workflow: BrandAnalysis | null }
```

기존 `GET /brand-intelligence`는 confirmed 전용 의미를 바꾸지 않는다. UI gateway에는 `getWorkflow(brandId)`를 추가한다.

- [ ] **Step 4: API와 gateway focused test를 실행한다**

```bash
npm run test --workspace @brand-pilot/api -- server.brandIntelligenceCustomer.test.ts
npm run test --workspace @brand-pilot/customer-ui -- brandIntelligenceGateway.test.ts
git diff --check
```

- [ ] **Step 5: 커밋한다**

```bash
git add apps/api/src/httpServer.ts apps/api/src/server.brandIntelligenceCustomer.test.ts apps/customer-ui/src/features/brand-intelligence/types.ts apps/customer-ui/src/features/brand-intelligence/brandIntelligenceGateway.ts apps/customer-ui/src/features/brand-intelligence/brandIntelligenceGateway.test.ts
git commit -m "feat(onboarding): expose resumable brand workflow"
```

### Task 9: 온보딩 Step 1 잠금과 서버 기반 재진입

**Files:**

- Modify: `apps/customer-ui/src/pages/LiveBrandCenterOnboarding.tsx`
- Modify: `apps/customer-ui/src/components/brand-center-preview/PreviewShell.tsx`
- Test: `apps/customer-ui/src/__tests__/brandCenterLiveOnboarding.test.tsx`

- [ ] **Step 1: 서버 bootstrap 실패 테스트를 추가한다**

다음 세 상태를 별도 테스트한다.

```tsx
gateway.getWorkflow.mockResolvedValue(reviewReadyWorkflow);
renderOnboarding();
expect(await screen.findByText("AI 분석 결과를 확인하고 수정하세요")).toBeVisible();
expect(screen.getByRole("button", { name: /1.*자료 등록/ })).toHaveAttribute("aria-disabled", "true");
```

```tsx
gateway.getWorkflow.mockResolvedValue(queuedWorkflow);
renderOnboarding();
expect(await screen.findByText("분석을 준비하고 있습니다")).toBeVisible();
expect(screen.queryByText("웹사이트 URL")).not.toBeInTheDocument();
```

```tsx
gateway.getWorkflow.mockResolvedValue(null);
renderOnboarding();
expect(await screen.findByText("웹사이트 URL")).toBeVisible();
```

- [ ] **Step 2: 기존 focused test 파일에서 실패를 확인한다**

```bash
npm run test --workspace @brand-pilot/customer-ui -- brandCenterLiveOnboarding.test.tsx
```

- [ ] **Step 3: 서버 workflow 우선 bootstrap을 구현한다**

- 최초 mount에서 `getWorkflow`를 한 번 호출한다.
- query ID가 있으면 해당 분석 조회로 권한과 상태를 확인한다.
- query가 없으면 server workflow ID를 사용한다.
- server workflow가 없을 때만 scoped localStorage pointer를 사용한다.
- open run이 있으면 sources step을 잠근다.
- pending은 기존 bounded poller로 이어간다.
- review_ready는 즉시 Step 2 draft를 연다.
- failed는 Step 1 재시작을 허용한다.
- timeout 시 pointer를 삭제하지 않는다.

`canEnter`의 sources 조건은 다음 의미로 변경한다.

```ts
if (step === "sources") return !analysisId && analysisState !== "loading";
```

- [ ] **Step 4: 이 파일만 다시 실행한다**

```bash
npm run test --workspace @brand-pilot/customer-ui -- brandCenterLiveOnboarding.test.tsx
git diff --check
```

- [ ] **Step 5: 커밋한다**

```bash
git add apps/customer-ui/src/pages/LiveBrandCenterOnboarding.tsx apps/customer-ui/src/components/brand-center-preview/PreviewShell.tsx apps/customer-ui/src/__tests__/brandCenterLiveOnboarding.test.tsx
git commit -m "feat(onboarding): resume and lock active analysis"
```

### Task 10: 브랜드센터 상태 화면과 문의내역 통합

**Files:**

- Modify: `apps/customer-ui/src/pages/BrandCenterPage.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/BrandCenterHeader.tsx`
- Modify: `apps/customer-ui/src/styles/brand-center.css`
- Modify: `apps/customer-ui/src/__tests__/brandCenter.test.tsx`

- [ ] **Step 1: 최초 온보딩과 재분석 실패 테스트를 작성한다**

최초 온보딩:

```tsx
brandIntelligenceGateway.getCurrent.mockResolvedValue(null);
brandIntelligenceGateway.getWorkflow.mockResolvedValue(null);
expect(await screen.findByRole("button", { name: "온보딩 하기" })).toBeVisible();
expect(screen.queryByRole("tablist", { name: "브랜드 센터 영역" })).not.toBeInTheDocument();
```

분석 중:

```tsx
brandIntelligenceGateway.getWorkflow.mockResolvedValue(queuedWorkflow);
expect(await screen.findByText("분석중입니다")).toBeVisible();
expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
```

검토 준비:

```tsx
brandIntelligenceGateway.getWorkflow.mockResolvedValue(reviewReadyWorkflow);
expect(await screen.findByText("분석이 완료되었습니다.")).toBeVisible();
expect(screen.getByRole("link", { name: "분석확인하기" }))
  .toHaveAttribute("href", `/onboarding/brand-intelligence?analysisId=${reviewReadyWorkflow.id}`);
```

재분석:

```tsx
brandIntelligenceGateway.getCurrent.mockResolvedValue(confirmedAnalysis);
brandIntelligenceGateway.getWorkflow.mockResolvedValue(queuedWorkflow);
expect(await screen.findByText("재분석 중입니다")).toBeVisible();
expect(screen.getByRole("tablist", { name: "브랜드 센터 영역" })).toBeVisible();
```

- [ ] **Step 2: 문의내역 공통 하단 실패 assertion을 추가한다**

브랜드 코어와 스타일 탭 모두에서 다음 region이 한 번만 존재해야 한다.

```tsx
expect(screen.getByRole("region", { name: "문의 내역" })).toBeVisible();
```

- [ ] **Step 3: 테스트 실패를 확인한다**

```bash
npm run test --workspace @brand-pilot/customer-ui -- brandCenter.test.tsx
```

- [ ] **Step 4: 상태 결정 함수를 분리해 구현한다**

페이지 내부 또는 별도 순수 함수는 다음 규칙을 사용한다.

```ts
type BrandCenterOnboardingView =
  | "not_started"
  | "initial_in_progress"
  | "initial_review_ready"
  | "ready"
  | "reanalyzing"
  | "reanalysis_review_ready"
  | "failed";
```

- confirmed가 없고 workflow가 없으면 `not_started`
- confirmed가 없고 pending이면 `initial_in_progress`
- confirmed가 없고 review_ready면 `initial_review_ready`
- confirmed가 있고 workflow가 없으면 `ready`
- confirmed가 있고 pending이면 `reanalyzing`
- confirmed가 있고 review_ready면 `reanalysis_review_ready`

초기 세 상태에서는 tablist와 탭 panel을 렌더하지 않는다. 재분석 상태에서는 기존 tablist와 확정 데이터를 유지한다. `SupportRequestHistory`는 상태가 `ready`, `reanalyzing`, `reanalysis_review_ready`일 때 탭 panel 아래 공통으로 한 번 렌더한다.

- [ ] **Step 5: focused test를 실행한다**

```bash
npm run test --workspace @brand-pilot/customer-ui -- brandCenter.test.tsx SupportRequestHistory.test.tsx
git diff --check
```

- [ ] **Step 6: 커밋한다**

```bash
git add apps/customer-ui/src/pages/BrandCenterPage.tsx apps/customer-ui/src/components/brand-center/BrandCenterHeader.tsx apps/customer-ui/src/components/support/SupportRequestHistory.tsx apps/customer-ui/src/styles/brand-center.css apps/customer-ui/src/__tests__/brandCenter.test.tsx
git commit -m "feat(brand-center): reflect onboarding workflow states"
```

### Task 11: 단일 통합 게이트와 함께 배포

**Files:**

- Modify if required: `docs/prd/brand-pilot-feature-preservation-ledger.md`
- Modify if required: `docs/operations/UBUNTU_DEPLOYMENT.md`
- Modify: relevant regression IDs only

- [ ] **Step 1: 병렬 Stream의 중복 수정과 계약을 검토한다**

```bash
git status --short
git diff origin/main...HEAD --stat
git diff --check
```

확인 항목:

- `AppShell.tsx`는 피드백 submit과 모바일 bar 변경을 모두 포함한다.
- `BrandCenterPage.tsx`는 상태 gate와 문의내역을 모두 포함한다.
- `/support` route는 유지되고 메뉴만 숨겨진다.
- 확정 분석 조회와 open workflow 조회가 섞이지 않는다.
- migration은 기존 인증/OAuth/session/workspace/brand 행을 수정하지 않는다.

- [ ] **Step 2: 변경 영역 focused test를 한 번에 실행한다**

```bash
npm run test --workspace @brand-pilot/customer-ui -- performanceInsights.test.tsx PerformanceContentDialog.test.tsx navigation.test.tsx responsiveStyles.test.ts SupportRequestHistory.test.tsx brandCenterLiveOnboarding.test.tsx brandCenter.test.tsx
npm run test --workspace @brand-pilot/api -- brandIntelligenceRepository.test.ts server.brandIntelligenceCustomer.test.ts
node --test scripts/repository-contract.test.mjs
```

예상 결과: 모두 PASS. 실패가 없으면 같은 테스트를 다시 실행하지 않는다.

- [ ] **Step 3: 정적 빌드를 한 번만 실행한다**

```bash
npm run build --workspace @brand-pilot/customer-ui
npm run typecheck --workspace @brand-pilot/api
git diff --check
```

- [ ] **Step 4: migration 최종 gate를 한 번만 실행한다**

로컬 Docker PostgreSQL만 사용한다.

```bash
npm run test:migrations
```

느린 하네스 timeout이면 기능 assertion 실패와 구분해 한 번만 보고한다. 자동 반복 실행하지 않는다.

- [ ] **Step 5: PR을 push하고 필수 CI만 확인한다**

```bash
git push -u origin codex/customer-shell-onboarding-improvements
gh pr create --base main --head codex/customer-shell-onboarding-improvements --title "feat: improve customer shell and onboarding" --fill
```

CI가 기능 실패일 때만 수정한다. timeout 또는 취소된 무관한 전체 묶음을 반복 실행하지 않는다.

- [ ] **Step 6: 병합 후 프런트와 Ubuntu 백엔드를 함께 배포한다**

- Vercel production deployment가 merge SHA를 가리키는지 확인한다.
- Ubuntu는 immutable digest image가 게시된 경우에만 기존 runbook으로 배포한다.
- 운영 env와 secrets는 변경하지 않는다.
- migration 전 인증/OAuth/session/workspace/brand row count를 기록한다.
- migration `069`는 open `brand_analysis_runs` 중복만 terminal `failed/superseded`로 바꾸고 다른 운영 데이터를 수정하지 않는다.
- primary/canary health 확인 후 전환한다.

- [ ] **Step 7: 운영 브라우저 QA를 한 번 수행한다**

확인 경로:

1. 로그인 → 사이드바 사용량과 프로필 메뉴
2. `/performance` 정보 위계와 상세 팝업
3. 피드백 문의 제출 → 브랜드센터 문의내역
4. 미온보딩 → 분석 중 → 검토 준비 → 확정
5. 분석 중 Step 1 직접 접근이 기존 workflow로 이동
6. 재분석 중 기존 브랜드센터 탭 유지
7. 981px, 1080px, 모바일 메뉴 접근

- [ ] **Step 8: 배포 결과를 커밋 또는 PR 코멘트로 기록한다**

기록에는 merge SHA, Vercel deployment, Ubuntu image digest, migration 결과, 운영 QA 결과만 포함하고 secret 원문은 포함하지 않는다.
