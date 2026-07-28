# D Hybrid Shell and Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** D 하이브리드의 공통 사이드바 셸과 A형 대시보드를 실제 Brand Pilot 데이터와 기존 공통 기능 위에 구현한다.

**Architecture:** 공통 색상·간격·상태 토큰을 별도 CSS 계층으로 만들고, 메뉴 정의를 순수 데이터 모듈로 분리한다. `AppShell`은 데스크톱 238/78px 사이드바, 64px topbar, 모바일 drawer, 피드백·도움말·사용량을 조율한다. 대시보드는 기존 `/dashboard` 응답을 뷰 모델로 변환해 KPI, 우선 작업, 사용량, 성과를 렌더링하며 가짜 데이터를 만들지 않는다.

**Tech Stack:** React, React Router, TypeScript, CSS, Vitest, Testing Library, Playwright.

---

## Task 1: 현재 셸 동작을 회귀 테스트로 고정

**Files:**

- Modify: `apps/customer-ui/src/__tests__/navigation.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/responsiveStyles.test.ts`
- Modify: `apps/customer-ui/src/__tests__/helpGuidance.test.tsx`
- Modify: `apps/customer-ui/src/components/feedback/FeedbackDialog.test.tsx`

- [ ] 기존 테스트 fixture를 공통 `renderWithRouter`와 실제 `BrandStatusProvider` 응답 형식으로 정리한다.
- [ ] 아래 동작을 먼저 테스트한다.
  - `mojong:desktop-sidebar:v1` 값이 `collapsed`이면 축소 상태로 시작한다.
  - 토글 후 localStorage 값과 `aria-expanded`가 함께 바뀐다.
  - 모바일 drawer는 Escape로 닫히고 메뉴 버튼으로 focus가 돌아온다.
  - 피드백 버튼은 데스크톱·모바일에서 같은 `FeedbackDialog`를 연다.
  - 도움말은 현재 경로의 가이드를 열고 강제 coachmark를 시작하지 않는다.
  - 브랜드 준비 전에도 `/support`와 `/onboarding/brand-intelligence`는 접근할 수 있다.
  - account/logout action이 셸 개편 뒤에도 실제 logout handler를 호출하고 로그인 화면으로 돌아간다.

테스트 예시:

```tsx
it("restores focus after closing the mobile navigation", async () => {
  const user = userEvent.setup();
  renderApp("/dashboard", { viewport: "mobile" });
  const opener = screen.getByRole("button", { name: "전체 메뉴 열기" });
  await user.click(opener);
  await user.keyboard("{Escape}");
  expect(opener).toHaveFocus();
});
```

- [ ] 실패 확인:

```bash
npm run test --workspace @brand-pilot/customer-ui -- navigation.test.tsx responsiveStyles.test.ts helpGuidance.test.tsx
```

예상 결과: 새 D안 메뉴명·drawer focus trap·토큰 규칙 테스트가 아직 구현되지 않아 실패한다.

## Task 2: D 하이브리드 디자인 토큰과 CSS 계층 추가

**Files:**

- Create: `apps/customer-ui/src/styles/tokens.css`
- Create: `apps/customer-ui/src/styles/shell.css`
- Create: `apps/customer-ui/src/styles/dashboard.css`
- Modify: `apps/customer-ui/src/main.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Modify: `apps/customer-ui/src/__tests__/responsiveStyles.test.ts`

- [ ] `tokens.css`에 승인 색상과 크기를 semantic token으로 정의한다.

```css
:root {
  --bp-color-sidebar: #102822;
  --bp-color-sidebar-raised: #15342d;
  --bp-color-primary: #2f6b55;
  --bp-color-primary-strong: #3d7b63;
  --bp-color-ai: #315cbe;
  --bp-color-human-review: #c96454;
  --bp-color-canvas: #f7f4ed;
  --bp-color-paper: #fffdfa;
  --bp-color-ink: #17221e;
  --bp-color-muted: #66736d;
  --bp-color-line: #dedfd8;
  --bp-color-line-strong: #c9ccc4;
  --bp-sidebar-width: 238px;
  --bp-sidebar-collapsed-width: 78px;
  --bp-topbar-height: 64px;
  --bp-radius-sm: 7px;
  --bp-radius-md: 10px;
  --bp-radius-lg: 15px;
}
```

- [ ] `main.tsx`가 `tokens.css → prototype.css → shell.css → dashboard.css` 순서로 가져오게 한다. 새 D 선택자가 기존 `.sidebar`, `.topbar`, dashboard 규칙 뒤에서 확실히 이기게 한다.
- [ ] 가능하면 네 파일을 `@layer tokens, legacy, shell, pages;`로 선언해 import 위치가 바뀌어도 cascade 순서가 유지되게 한다.
- [ ] `prototype.css`에 남아 있는 전역 색상은 즉시 전부 옮기지 말고, 새 셸과 대시보드 선택자만 semantic token으로 교체한다.
- [ ] desktop 기본, `@media (max-width: 1080px)`, `760px`, `470px` 규칙을 추가한다.
- [ ] 14px 미만 본문, 44px 미만 핵심 클릭 대상, 수평 overflow를 검출하는 문자열 테스트를 추가한다.
- [ ] Playwright 또는 JSDOM computed-style 회귀에서 sidebar width/background, topbar height/sticky, dashboard grid가 legacy CSS에 덮이지 않는지 검증한다.
- [ ] reduced motion 규칙을 추가한다.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
```

- [ ] 테스트:

```bash
npm run test --workspace @brand-pilot/customer-ui -- responsiveStyles.test.ts
npm run build --workspace @brand-pilot/customer-ui
```

예상 결과: CSS 계약 테스트와 TypeScript/Vite 빌드가 통과한다.

- [ ] 구현 커밋:

```bash
git add apps/customer-ui/src/styles apps/customer-ui/src/main.tsx apps/customer-ui/src/__tests__/responsiveStyles.test.ts
git commit -m "feat(ui): add d-hybrid design tokens"
```

## Task 3: 메뉴 모델을 분리하고 구현된 목적지만 노출

**Files:**

- Create: `apps/customer-ui/src/features/navigation/navigationModel.ts`
- Create: `apps/customer-ui/src/features/navigation/navigationModel.test.ts`
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Modify: `apps/customer-ui/src/routes.tsx`
- Modify: `apps/customer-ui/src/features/help/helpGuides.ts`
- Modify: `apps/customer-ui/src/__tests__/navigation.test.tsx`

- [ ] Release A에서는 새 명칭과 그룹을 적용하되 아직 만들지 않은 화면으로 링크하지 않는다.

```ts
export const customerNavigation = [
  { id: "overview", label: "개요", items: [
    { label: "대시보드", path: "/dashboard" },
  ] },
  { id: "brand", label: "브랜드", items: [
    { label: "브랜드 센터", path: "/brand-settings" },
    { label: "원본 자료", path: "/sources" },
    { label: "트렌드 탐색", path: "/instagram-trends" },
    { label: "레퍼런스 보관함", path: "/archive" },
  ] },
  { id: "content", label: "콘텐츠", items: [
    { label: "콘텐츠 생성", path: "/ai-content" },
    { label: "게시 관리", path: "/publish-queue" },
    { label: "채널", path: "/channels" },
  ] },
  { id: "customer", label: "채널·고객", items: [
    { label: "Instagram 고객응대", path: "/dm-automation" },
  ] },
  { id: "support", label: "설정·지원", items: [
    { label: "결제 및 구독", path: "https://www.danbammsg.co.kr/product/pricing" },
    { label: "고객센터", path: "/support" },
  ] },
] as const;
```

- [ ] `/brand-center`, `/references`, `/performance`는 해당 상세 계획에서 실제 page와 test가 생기는 commit에만 navigation model을 전환한다. 생성 결과 목록은 기존 `/ai-content`가 계속 맡으므로 owner 없는 `/ai-content/library` 경로는 만들지 않는다.
- [ ] 브랜드 준비가 끝나지 않은 사용자에게는 Release A 동안 조건부 `시작 준비 > 브랜드 분석` 항목을 유지해 `/onboarding/brand-intelligence`로 돌아갈 수 있게 한다. Brand Center commit에서 journey/브랜드 센터 링크로 대체하는 회귀 테스트를 둔다.
- [ ] 전환 후에도 아래 legacy 경로는 삭제하지 않고 새 canonical 경로로 redirect한다.

| 기존 경로 | 새 경로 |
|---|---|
| `/brand-settings` | `/brand-center?tab=understanding&section=core` |
| `/sources` | `/brand-center?tab=understanding&section=sources` |
| `/onboarding` | `/onboarding/brand-intelligence` |
| `/archive` | `/references?view=saved-trends` |
| `/instagram-trends` | `/references?view=trends` |
| `/content` | `/publish-queue?status=needs_review` |

- [ ] 동적 콘텐츠 상세 `/ai-content/:generationId`와 기존 query string은 유지한다.
- [ ] page-title resolver는 `/ai-content/:generationId`, canonical tab/query route, 알 수 없는 path를 테스트해 topbar가 잘못된 고정 제목을 표시하지 않게 한다.
- [ ] 새 메뉴가 숨기는 기능이 API 삭제로 이어지지 않는지 navigation test에 회귀 항목을 추가한다.
- [ ] Release A 준비 게이트는 현재 허용 경로를 유지하고, Brand Center page가 생기는 commit에서 `/brand-center`를 추가한다.
- [ ] 테스트:

```bash
npm run test --workspace @brand-pilot/customer-ui -- navigationModel.test.ts navigation.test.tsx brandSetupGate.test.tsx
```

예상 결과: 메뉴 순서, 라벨, badge, redirect, 준비 게이트가 모두 통과한다.

## Task 4: AppShell focus·drawer·collapse 완성

**Files:**

- Modify: `apps/customer-ui/src/components/layout/AppShell.tsx`
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Modify: `apps/customer-ui/src/components/layout/Topbar.tsx`
- Create: `apps/customer-ui/src/components/ui/FocusTrap.tsx`
- Create: `apps/customer-ui/src/components/ui/FocusTrap.test.tsx`
- Modify: `apps/customer-ui/src/styles/shell.css`
- Modify: `apps/customer-ui/src/__tests__/navigation.test.tsx`

- [ ] 현재 mobile drawer의 Escape 처리에 focus trap을 추가한다.
- [ ] drawer가 열릴 때 첫 유효 메뉴에 focus하고 Tab/Shift+Tab을 내부에서 순환시킨다.
- [ ] 피드백·도움말을 모바일 drawer에서 열면 drawer가 완전히 닫힌 뒤 dialog/drawer가 열리게 한다.
- [ ] collapse 시 라벨은 시각적으로 숨기되 각 링크의 accessible name과 tooltip을 유지한다.
- [ ] sidebar brand profile, 피드백, 도움말은 축소 상태에서도 각각 독립적인 44px 버튼으로 남긴다.
- [ ] topbar에는 현재 페이지명, AI 생성·신규 다운로드 잔여량, mobile menu trigger와 account menu를 표시한다. account menu에 기존 로그아웃 action을 보존하고 키보드 open/close/focus restore를 지원한다.
- [ ] prototype의 `통합안 D` badge와 설명 footer는 구현하지 않는다.
- [ ] 테스트:

```bash
npm run test --workspace @brand-pilot/customer-ui -- FocusTrap.test.tsx navigation.test.tsx helpGuidance.test.tsx FeedbackDialog.test.tsx
```

예상 결과: 키보드만으로 메뉴, 도움말, 피드백을 열고 닫은 뒤 원래 위치로 돌아온다.

- [ ] 구현 커밋:

```bash
git add apps/customer-ui/src/components/layout apps/customer-ui/src/components/ui/FocusTrap* apps/customer-ui/src/features/navigation apps/customer-ui/src/features/help/helpGuides.ts apps/customer-ui/src/routes.tsx apps/customer-ui/src/styles/shell.css apps/customer-ui/src/__tests__/navigation.test.tsx
git commit -m "feat(ui): implement d-hybrid application shell"
```

## Task 5: 대시보드 응답을 운영 뷰 모델로 변환

**Files:**

- Create: `apps/customer-ui/src/features/dashboard/dashboardViewModel.ts`
- Create: `apps/customer-ui/src/features/dashboard/dashboardViewModel.test.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/pages/DashboardPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/dashboard.test.tsx`

- [ ] 현재 `Dashboard` 응답의 수치를 다음 네 영역으로만 재구성한다.
  - KPI: 발행 완료, 조회·노출, 검토 필요, 게시 실패
  - 오늘의 우선 작업: 브랜드 검토, 생성 결과 검토, 채널 오류, DM 상담 필요
  - 사용량: AI 생성 10회, 신규 다운로드 20회와 reset 시각
  - 최근 성과: top content와 실제 수집 시각
- [ ] 우선 작업은 위험도와 실행 가능성으로 정렬한다.
- [ ] view model 입력은 기존 세 응답을 명시적으로 조합한다.

```ts
interface DashboardViewModelInput {
  dashboard: Dashboard;
  brandStatus: BrandUiStatus | null;
  usage: AiContentUsage | null;
}
```

```ts
export type DashboardPriorityKind =
  | "brand_review"
  | "content_review"
  | "publish_failure"
  | "channel_attention"
  | "dm_attention";

export interface DashboardPriority {
  kind: DashboardPriorityKind;
  severity: "critical" | "warning" | "info";
  count: number;
  href: string;
  actionLabel: string;
}
```

- [ ] `brand_review`는 `BrandUiStatus.navigation.onboardingRemaining`에서만 만들고 status 응답이 없으면 숨기거나 unavailable로 둔다. `dm_attention`은 현재 어떤 응답에도 없으므로 0으로 가장하지 않고 unavailable/hide 처리한다.
- [ ] priority href를 고정한다.
  - `brand_review` → Release A `/brand-settings`, Brand Center commit 이후 `/brand-center?tab=understanding&section=core`
  - `content_review` → `/ai-content`
  - `publish_failure` → `/publish-queue?status=failed`
  - `channel_attention` → `/channels`
  - `dm_attention` → `/dm-automation` 단, 실제 count source가 생긴 뒤에만 표시
- [ ] 모든 KPI는 값과 설명을 함께 제공하고, 카드 자체를 클릭 가능하게 만들 경우 실제 링크만 사용한다.
- [ ] `formatLabels`에서 Reel/TikTok/Shorts는 기존 과거 데이터 표시용으로만 유지하고 생성 CTA로 연결하지 않는다.
- [ ] 실패·stale·empty fixture를 추가한다.
- [ ] 테스트:

```bash
npm run test --workspace @brand-pilot/customer-ui -- dashboardViewModel.test.ts dashboard.test.tsx
```

예상 결과: 실제 응답이 D안 카드로 변환되고, 누락 데이터는 가짜 값 대신 `데이터 없음`으로 표시된다.

## Task 6: A형 대시보드 레이아웃 구현

**Files:**

- Create: `apps/customer-ui/src/components/dashboard/DashboardKpiGrid.tsx`
- Create: `apps/customer-ui/src/components/dashboard/DashboardPriorityList.tsx`
- Create: `apps/customer-ui/src/components/dashboard/DashboardUsageCard.tsx`
- Create: `apps/customer-ui/src/components/dashboard/DashboardPerformancePanel.tsx`
- Modify: `apps/customer-ui/src/pages/DashboardPage.tsx`
- Modify: `apps/customer-ui/src/styles/dashboard.css`
- Modify: `apps/customer-ui/src/__tests__/dashboard.test.tsx`

- [ ] 페이지 상단 CTA를 `콘텐츠 만들기`와 `브랜드 검토하기`로 둔다.
- [ ] CTA href는 `콘텐츠 만들기 → /ai-content/new`, `브랜드 검토하기 → Release A /brand-settings`로 고정하고 Brand Center commit에서 후자만 canonical `/brand-center?tab=understanding&section=core`로 전환한다.
- [ ] 4개 KPI grid 아래를 desktop 2열, tablet/mobile 1열로 구성한다.
- [ ] 우선 작업은 상태 badge, 설명, count, 명시적 action을 갖는다.
- [ ] 사용량 막대는 서버의 `generationUsed/Limit`, `newDownloadUsed/Limit` 값만 사용한다.
- [ ] 기존 30일 SVG 차트와 콘텐츠 상세 dialog는 보존하되 새 `최근 성과` panel 안으로 이동한다.
- [ ] 성과 dialog에 focus trap과 focus restore를 적용한다.
- [ ] 피드백 배너는 페이지 하단에서 기존 공통 dialog를 연다.
- [ ] 이미지·avatar·날짜를 mockup 값으로 복사하지 않는다.
- [ ] 테스트:

```bash
npm run test --workspace @brand-pilot/customer-ui -- dashboard.test.tsx helpGuidance.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

예상 결과: 기존 성과 상세와 피드백 동작을 보존한 채 새 레이아웃 테스트와 빌드가 통과한다.

- [ ] 구현 커밋:

```bash
git add apps/customer-ui/src/components/dashboard apps/customer-ui/src/features/dashboard apps/customer-ui/src/pages/DashboardPage.tsx apps/customer-ui/src/types.ts apps/customer-ui/src/styles/dashboard.css apps/customer-ui/src/__tests__/dashboard.test.tsx
git commit -m "feat(dashboard): compose operational home"
```

## Task 7: 데스크톱·모바일 브라우저 수용 테스트

**Files:**

- Modify: `apps/customer-ui/e2e/customer-ui.spec.ts`
- Create: `apps/customer-ui/e2e/d-hybrid-shell-dashboard.spec.ts`

- [ ] Playwright API fixture가 dashboard, usage, brand status, feedback 저장 응답을 제공하게 한다.
- [ ] 1440×1000에서 sidebar 238px, collapsed 78px, topbar 64px를 검증한다.
- [ ] 390×844에서 hamburger, drawer, Escape, focus restore, body scroll lock을 검증한다.
- [ ] 대시보드 → `/ai-content/new`, 대시보드 → Release A `/brand-settings` CTA를 검증한다. Brand Center 계획은 같은 test를 canonical `/brand-center?tab=understanding&section=core`로 갱신한다.
- [ ] API 실패 시 skeleton이 사라지고 error/retry가 보이며 샘플 KPI가 나타나지 않는지 검증한다.
- [ ] screenshot은 fixture 데이터와 고정 timezone으로만 찍고 픽셀 수치가 아닌 구조적 회귀에 사용한다.
- [ ] 실행:

```bash
npm run e2e --workspace @brand-pilot/customer-ui -- d-hybrid-shell-dashboard.spec.ts
npm run test --workspace @brand-pilot/customer-ui
npm run build --workspace @brand-pilot/customer-ui
```

예상 결과: desktop/mobile 시나리오와 전체 고객 UI 테스트가 통과한다.

- [ ] 최종 커밋:

```bash
git add apps/customer-ui/e2e
git commit -m "test(ui): cover d-hybrid shell and dashboard"
```
