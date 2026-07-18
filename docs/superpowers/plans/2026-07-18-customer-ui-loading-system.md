# Customer UI Loading System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객 UI의 최초 조회, 재조회, 상세 조회, 명령 실행에 일관된 스켈레톤·오버레이·인라인 로더를 적용하고 Instagram 추천 태그를 클릭하면 즉시 검색되도록 한다.

**Architecture:** `components/ui/LoadingState.tsx`에 시각적 로딩 프리미티브를 모으고 각 페이지가 보유한 기존 비동기 상태를 이 컴포넌트로 표현한다. 최초 조회와 재조회를 구분하며 오류는 최종 실패 후에만 표시한다. 서버 API와 업무 상태값은 변경하지 않는다.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, Playwright, 기존 CSS 토큰 및 Lucide React

---

## File Structure

- Create: `apps/customer-ui/src/components/ui/LoadingState.tsx` — 공통 스켈레톤, 오버레이, 인라인 스피너
- Create: `apps/customer-ui/src/__tests__/loadingState.test.tsx` — 공통 로더 접근성과 구조 계약
- Modify: `apps/customer-ui/src/styles/prototype.css` — 로더, 검색바, 모바일, 모션 감소 스타일
- Modify: `apps/customer-ui/src/pages/InstagramTrendsPage.tsx` — 검색 UI, 추천 태그 즉시 검색, 최초·재조회 상태
- Modify: `apps/customer-ui/src/__tests__/instagramTrends.test.tsx` — 트렌드 상태 전환 회귀 테스트
- Modify: `apps/customer-ui/e2e/instagram-trends.spec.ts` — 추천 태그 E2E와 로딩 UI
- Modify: `apps/customer-ui/src/pages/DashboardPage.tsx` — 대시보드 최초 로딩 스켈레톤
- Modify: `apps/customer-ui/src/pages/OnboardingPage.tsx` — 체크리스트 최초 로딩 스켈레톤
- Modify: `apps/customer-ui/src/pages/ChannelsPage.tsx` — 채널·DM 초기 상태와 오류 분리
- Modify: `apps/customer-ui/src/pages/BillingPage.tsx` — 결제 정보 최초 로딩 스켈레톤
- Modify: `apps/customer-ui/src/pages/BrandSettingsPage.tsx` — 설정 폼 최초 로딩 스켈레톤
- Modify: `apps/customer-ui/src/components/publish/ContentArtifactDialog.tsx` — 결과물 상세 스켈레톤
- Modify: `apps/customer-ui/src/components/dm/DmConversationList.tsx` — 대화 목록 스켈레톤
- Modify: `apps/customer-ui/src/components/dm/DmConversationThread.tsx` — 대화 상세 스켈레톤
- Modify: `apps/customer-ui/src/components/dm/DmKnowledgePanel.tsx` — Wiki 패널 스켈레톤과 명령 로더
- Modify: `apps/customer-ui/src/__tests__/dashboard.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/onboarding.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/channels.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/billing.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandSettings.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/dmAutomation.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/responsiveStyles.test.ts`

### Task 1: 공통 로딩 컴포넌트와 스타일

**Files:**
- Create: `apps/customer-ui/src/components/ui/LoadingState.tsx`
- Create: `apps/customer-ui/src/__tests__/loadingState.test.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Test: `apps/customer-ui/src/__tests__/loadingState.test.tsx`
- Test: `apps/customer-ui/src/__tests__/responsiveStyles.test.ts`

- [ ] **Step 1: 공통 로더의 실패 테스트 작성**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardSkeleton, InlineSpinner, ListSkeleton, LoadingOverlay, PageSkeleton } from "../components/ui/LoadingState";

describe("loading state components", () => {
  it("exposes accessible status without leaking decorative blocks", () => {
    render(<PageSkeleton label="페이지를 불러오는 중입니다." />);
    expect(screen.getByRole("status")).toHaveAccessibleName("페이지를 불러오는 중입니다.");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("renders stable list and card placeholders", () => {
    const { rerender } = render(<ListSkeleton rows={4} columns={3} label="목록 로딩" />);
    expect(screen.getAllByTestId("skeleton-row")).toHaveLength(4);
    rerender(<CardSkeleton count={6} label="카드 로딩" />);
    expect(screen.getAllByTestId("skeleton-card")).toHaveLength(6);
  });

  it("provides overlay and inline spinner variants", () => {
    render(<><LoadingOverlay label="새로고침 중" /><InlineSpinner label="저장 중" /></>);
    expect(screen.getByRole("status", { name: "새로고침 중" })).toBeVisible();
    expect(screen.getByLabelText("저장 중")).toBeVisible();
  });
});
```

- [ ] **Step 2: 테스트를 실행해 컴포넌트 미존재 실패 확인**

Run: `npm run test --workspace @brand-pilot/customer-ui -- loadingState.test.tsx`

Expected: FAIL with `Cannot find module '../components/ui/LoadingState'`.

- [ ] **Step 3: 공통 로더 최소 구현**

```tsx
import { LoaderCircle } from "lucide-react";

interface LoadingProps {
  label: string;
  className?: string;
}

export function PageSkeleton({ label, className = "" }: LoadingProps) {
  return (
    <div className={`skeleton-page ${className}`} role="status" aria-label={label} aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="skeleton-line is-title" aria-hidden="true" />
      <div className="skeleton-metric-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <div className="skeleton-block" key={index} />)}
      </div>
      <div className="skeleton-block is-content" aria-hidden="true" />
    </div>
  );
}

export function ListSkeleton({ rows = 5, columns = 4, label }: LoadingProps & { rows?: number; columns?: number }) {
  return (
    <div className="skeleton-list" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_, row) => (
        <div className="skeleton-list__row" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} data-testid="skeleton-row" key={row} aria-hidden="true">
          {Array.from({ length: columns }, (_, column) => <span className="skeleton-line" key={column} />)}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 6, label }: LoadingProps & { count?: number }) {
  return (
    <div className="skeleton-card-grid" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-card" data-testid="skeleton-card" key={index} aria-hidden="true">
          <div className="skeleton-card__media" />
          <div className="skeleton-line" />
          <div className="skeleton-line is-short" />
        </div>
      ))}
    </div>
  );
}

export function LoadingOverlay({ label }: LoadingProps) {
  return <div className="loading-overlay" role="status" aria-label={label} aria-busy="true"><LoaderCircle aria-hidden="true" /> <span>{label}</span></div>;
}

export function InlineSpinner({ label }: LoadingProps) {
  return <LoaderCircle className="inline-spinner" aria-label={label} />;
}
```

- [ ] **Step 4: 스켈레톤 및 모션 감소 CSS 추가**

```css
.skeleton-page,
.skeleton-list,
.skeleton-card-grid { width: 100%; }
.skeleton-line,
.skeleton-block,
.skeleton-card__media {
  background: linear-gradient(90deg, #eef1f5 25%, #f7f8fa 50%, #eef1f5 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
}
.skeleton-line { display: block; min-height: 14px; border-radius: 4px; }
.skeleton-line.is-title { width: min(280px, 70%); height: 28px; margin-bottom: 20px; }
.skeleton-line.is-short { width: 62%; }
.skeleton-metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.skeleton-block { min-height: 92px; border-radius: 6px; }
.skeleton-block.is-content { min-height: 260px; margin-top: 16px; }
.skeleton-list__row { display: grid; grid-template-columns: repeat(var(--skeleton-columns, 4), minmax(0, 1fr)); gap: 16px; padding: 16px 0; }
.skeleton-card-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.skeleton-card { display: grid; gap: 10px; }
.skeleton-card__media { aspect-ratio: 1; border-radius: 6px; }
.loading-overlay { position: absolute; inset: 0; display: grid; place-content: center; gap: 8px; background: rgb(255 255 255 / 78%); z-index: 2; }
.loading-overlay svg,
.inline-spinner { animation: loading-spin .8s linear infinite; }
@keyframes skeleton-shimmer { to { background-position: -200% 0; } }
@keyframes loading-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .skeleton-line, .skeleton-block, .skeleton-card__media, .loading-overlay svg, .inline-spinner { animation: none; }
}
@media (max-width: 720px) {
  .skeleton-metric-grid, .skeleton-card-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 5: 공통 컴포넌트 테스트와 CSS 계약 테스트 통과 확인**

Run: `npm run test --workspace @brand-pilot/customer-ui -- loadingState.test.tsx responsiveStyles.test.ts`

Expected: PASS.

- [ ] **Step 6: 공통 로더 커밋**

```bash
git add apps/customer-ui/src/components/ui/LoadingState.tsx apps/customer-ui/src/__tests__/loadingState.test.tsx apps/customer-ui/src/styles/prototype.css apps/customer-ui/src/__tests__/responsiveStyles.test.ts
git commit -m "feat: add shared customer UI loading states"
```

### Task 2: Instagram 트렌드 검색 UI와 상태 전환

**Files:**
- Modify: `apps/customer-ui/src/pages/InstagramTrendsPage.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Modify: `apps/customer-ui/src/__tests__/instagramTrends.test.tsx`
- Modify: `apps/customer-ui/e2e/instagram-trends.spec.ts`

- [ ] **Step 1: 추천 태그 즉시 검색과 로더 우선순위 테스트 추가**

```tsx
it("starts one search from a recommendation and hides stale errors while pending", async () => {
  let rejectSearch: ((reason: Error) => void) | undefined;
  const api = await renderTrendPage({
    getInstagramTrends: vi.fn(async () => page([], { lastErrorCode: "instagram_trend_fetch_failed" })),
    searchInstagramTrends: vi.fn(() => new Promise((_resolve, reject) => { rejectSearch = reject; }))
  });

  const tag = await screen.findByRole("button", { name: "#여행콘텐츠" });
  await userEvent.click(tag);

  expect(api.searchInstagramTrends).toHaveBeenCalledTimes(1);
  expect(api.searchInstagramTrends).toHaveBeenCalledWith("brand-1", "여행콘텐츠");
  expect(screen.getByRole("textbox", { name: "해시태그" })).toHaveValue("#여행콘텐츠");
  expect(screen.getByRole("status", { name: "Instagram 트렌드를 불러오는 중입니다." })).toBeVisible();
  expect(screen.queryByText(trendErrorCopy.instagram_trend_fetch_failed)).not.toBeInTheDocument();
  expect(tag).toBeDisabled();

  await act(async () => rejectSearch?.(new Error("instagram_trend_fetch_failed")));
  expect(await screen.findByText(trendErrorCopy.instagram_trend_fetch_failed)).toBeVisible();
});
```

- [ ] **Step 2: 테스트를 실행해 현재 텍스트 로더와 오류 동시 표시 실패 확인**

Run: `npm run test --workspace @brand-pilot/customer-ui -- instagramTrends.test.tsx`

Expected: FAIL because the current status is plain text, recommendation buttons stay enabled, or stale error is visible.

- [ ] **Step 3: 검색바와 최초·재조회 로더 구현**

```tsx
import { Search } from "lucide-react";
import { CardSkeleton, InlineSpinner, LoadingOverlay } from "../components/ui/LoadingState";

const hasVisibleResults = visibleItems.length > 0;

<form className="trend-search-form" aria-busy={view.isSearching} onSubmit={(event) => { event.preventDefault(); void search(); }}>
  <label className="sr-only" htmlFor="trend-hashtag">해시태그</label>
  <div className="trend-search-box">
    <Search size={18} aria-hidden="true" />
    <input id="trend-hashtag" value={view.hashtag} onChange={(event) => setView((current) => ({ ...current, hashtag: event.target.value }))} placeholder="#해시태그" />
    <button className="button primary trend-search-submit" type="submit" disabled={view.isSearching}>
      {view.isSearching ? <InlineSpinner label="검색 중" /> : null}
      검색
    </button>
  </div>
</form>

{recommendedHashtags.map((hashtag) => (
  <button className="trend-tag" disabled={view.isSearching} type="button" key={hashtag} onClick={() => selectAndSearch(`#${hashtag.replace(/^#/, "")}`)}>
    #{hashtag.replace(/^#/, "")}
  </button>
))}

{!view.isSearching && view.error ? <Alert title="트렌드 탐색 상태" variant="warn">{view.error}</Alert> : null}
{view.isSearching && !hasVisibleResults ? <CardSkeleton count={6} label="Instagram 트렌드를 불러오는 중입니다." /> : null}
<div className="trend-results" aria-busy={view.isSearching && hasVisibleResults}>
  {hasVisibleResults ? (
    <div className="trend-media-grid">
      {visibleItems.map((item) => <TrendMediaCard key={item.id} media={item} onSelect={setSelectedMedia} />)}
    </div>
  ) : null}
  {view.isSearching && hasVisibleResults ? <LoadingOverlay label="Instagram 최신 데이터를 확인하는 중입니다." /> : null}
</div>
```

- [ ] **Step 4: 검색바와 태그 CSS 구현**

```css
.trend-search-form { width: 100%; }
.trend-search-box { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; min-height: 48px; border: 1px solid var(--border); border-radius: 6px; background: #fff; padding-left: 14px; }
.trend-search-box:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px rgb(37 99 235 / 12%); }
.trend-search-box input { min-width: 0; border: 0; outline: 0; box-shadow: none; }
.trend-search-submit { align-self: stretch; min-width: 92px; border-radius: 0 5px 5px 0; }
.trend-tag { min-height: 32px; border: 1px solid var(--border); border-radius: 999px; padding: 0 10px; background: #fff; color: var(--text); cursor: pointer; }
.trend-tag:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.trend-tag:disabled { opacity: .55; cursor: wait; }
.trend-results { position: relative; min-height: 120px; }
```

- [ ] **Step 5: 단위 테스트 통과 확인**

Run: `npm run test --workspace @brand-pilot/customer-ui -- instagramTrends.test.tsx`

Expected: PASS.

- [ ] **Step 6: 추천 태그 E2E 추가 및 실행**

```ts
test("searches immediately from a recommended hashtag", async ({ page }) => {
  await page.getByRole("button", { name: "#성장마케팅" }).click();
  await expect(page.getByLabel("해시태그")).toHaveValue("#성장마케팅");
  await expect(page.getByRole("button", { name: "상세 보기 @growthline352" })).toBeVisible();
  expect(browserErrors.get(page)).toEqual([]);
});
```

Run: `npm run e2e --workspace @brand-pilot/customer-ui -- instagram-trends.spec.ts`

Expected: PASS on desktop and mobile projects.

- [ ] **Step 7: 트렌드 개선 커밋**

```bash
git add apps/customer-ui/src/pages/InstagramTrendsPage.tsx apps/customer-ui/src/styles/prototype.css apps/customer-ui/src/__tests__/instagramTrends.test.tsx apps/customer-ui/e2e/instagram-trends.spec.ts
git commit -m "feat: improve Instagram trend search feedback"
```

### Task 3: 주요 페이지 최초 로딩 스켈레톤

**Files:**
- Modify: `apps/customer-ui/src/pages/DashboardPage.tsx`
- Modify: `apps/customer-ui/src/pages/OnboardingPage.tsx`
- Modify: `apps/customer-ui/src/pages/ChannelsPage.tsx`
- Modify: `apps/customer-ui/src/pages/BillingPage.tsx`
- Modify: `apps/customer-ui/src/pages/BrandSettingsPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/dashboard.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/onboarding.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/channels.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/billing.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandSettings.test.tsx`

- [ ] **Step 1: 각 페이지 로딩 상태 테스트 추가**

```tsx
expect(await screen.findByRole("status", { name: "대시보드를 불러오는 중입니다." })).toHaveClass("skeleton-page");
expect(screen.getByRole("status", { name: "온보딩 상태를 불러오는 중입니다." })).toHaveAttribute("aria-busy", "true");
expect(screen.getByRole("status", { name: "채널 연결 상태를 불러오는 중입니다." })).toBeVisible();
expect(screen.getByRole("status", { name: "결제 정보를 불러오는 중입니다." })).toBeVisible();
expect(screen.getByRole("status", { name: "브랜드 설정을 불러오는 중입니다." })).toBeVisible();
```

각 assertion은 해당 페이지 테스트 파일에 한 개씩 배치하고 API Promise를 미완료 상태로 유지한다.

- [ ] **Step 2: 페이지 테스트를 실행해 기존 텍스트·빈 화면 실패 확인**

Run:

```bash
npm run test --workspace @brand-pilot/customer-ui -- dashboard.test.tsx onboarding.test.tsx channels.test.tsx billing.test.tsx brandSettings.test.tsx
```

Expected: FAIL because the shared skeleton role/class does not exist on each page.

- [ ] **Step 3: 각 페이지에 명시적 최초 로딩 분기 적용**

```tsx
import { PageSkeleton } from "../components/ui/LoadingState";

if (loading && !data) {
  return (
    <section className="content">
      <PageSkeleton label="대시보드를 불러오는 중입니다." />
    </section>
  );
}
```

나머지 페이지는 같은 분기 구조를 사용하되 접근성 문구를 정확히 다음과 같이 지정한다.

```ts
const loadingLabels = {
  onboarding: "온보딩 상태를 불러오는 중입니다.",
  channels: "채널 연결 상태를 불러오는 중입니다.",
  billing: "결제 정보를 불러오는 중입니다.",
  brandSettings: "브랜드 설정을 불러오는 중입니다."
} as const;
```

`ChannelsPage`는 `connectionCards.length === 0`을 로딩으로 추측하지 않고 별도 상태를 둔다.

```tsx
const [channelsLoading, setChannelsLoading] = useState(true);

useEffect(() => {
  let ignore = false;
  setChannelsLoading(true);
  api.listChannels(DEMO_BRAND_ID)
    .then((items) => { if (!ignore) setConnectionCards(items); })
    .catch(() => { if (!ignore) setApiNotice("API 서버가 응답하지 않아 채널 연결 상태를 불러오지 못했습니다."); })
    .finally(() => { if (!ignore) setChannelsLoading(false); });
  return () => { ignore = true; };
}, []);
```

- [ ] **Step 4: 페이지 테스트 통과 확인**

Run:

```bash
npm run test --workspace @brand-pilot/customer-ui -- dashboard.test.tsx onboarding.test.tsx channels.test.tsx billing.test.tsx brandSettings.test.tsx
```

Expected: PASS.

- [ ] **Step 5: 페이지 로딩 커밋**

```bash
git add apps/customer-ui/src/pages/DashboardPage.tsx apps/customer-ui/src/pages/OnboardingPage.tsx apps/customer-ui/src/pages/ChannelsPage.tsx apps/customer-ui/src/pages/BillingPage.tsx apps/customer-ui/src/pages/BrandSettingsPage.tsx apps/customer-ui/src/__tests__/dashboard.test.tsx apps/customer-ui/src/__tests__/onboarding.test.tsx apps/customer-ui/src/__tests__/channels.test.tsx apps/customer-ui/src/__tests__/billing.test.tsx apps/customer-ui/src/__tests__/brandSettings.test.tsx
git commit -m "feat: add page loading skeletons"
```

### Task 4: 게시 상세와 DM 영역 스켈레톤

**Files:**
- Modify: `apps/customer-ui/src/components/publish/ContentArtifactDialog.tsx`
- Modify: `apps/customer-ui/src/components/dm/DmConversationList.tsx`
- Modify: `apps/customer-ui/src/components/dm/DmConversationThread.tsx`
- Modify: `apps/customer-ui/src/components/dm/DmKnowledgePanel.tsx`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/dmAutomation.test.tsx`

- [ ] **Step 1: 상세 및 DM 로딩 테스트 추가**

```tsx
expect(screen.getByRole("status", { name: "결과물을 불러오는 중입니다." })).toHaveClass("skeleton-list");
expect(screen.getByRole("status", { name: "대화 목록을 불러오는 중입니다." })).toBeVisible();
expect(screen.getByRole("status", { name: "대화 내용을 불러오는 중입니다." })).toBeVisible();
expect(screen.getByRole("status", { name: "Wiki 상태를 불러오는 중입니다." })).toBeVisible();
```

- [ ] **Step 2: 테스트를 실행해 평문 로딩 실패 확인**

Run: `npm run test --workspace @brand-pilot/customer-ui -- publishQueue.test.tsx dmAutomation.test.tsx`

Expected: FAIL because current loading states are plain text.

- [ ] **Step 3: 컴포넌트별 로더 적용**

```tsx
{loading ? <ListSkeleton rows={4} columns={3} label="결과물을 불러오는 중입니다." /> : null}
```

```tsx
if (loading) return <ListSkeleton rows={7} columns={1} label="대화 목록을 불러오는 중입니다." />;
```

```tsx
if (loading) return <ListSkeleton rows={5} columns={1} label="대화 내용을 불러오는 중입니다." />;
```

```tsx
{loading ? <ListSkeleton rows={3} columns={4} label="Wiki 상태를 불러오는 중입니다." /> : null}
```

- [ ] **Step 4: 대상 테스트 통과 확인**

Run: `npm run test --workspace @brand-pilot/customer-ui -- publishQueue.test.tsx dmAutomation.test.tsx`

Expected: PASS.

- [ ] **Step 5: 상세·DM 로더 커밋**

```bash
git add apps/customer-ui/src/components/publish/ContentArtifactDialog.tsx apps/customer-ui/src/components/dm/DmConversationList.tsx apps/customer-ui/src/components/dm/DmConversationThread.tsx apps/customer-ui/src/components/dm/DmKnowledgePanel.tsx apps/customer-ui/src/__tests__/publishQueue.test.tsx apps/customer-ui/src/__tests__/dmAutomation.test.tsx
git commit -m "feat: add detailed loading skeletons"
```

### Task 5: 명령 버튼 인라인 로더와 중복 실행 차단

**Files:**
- Modify: `apps/customer-ui/src/pages/BrandSettingsPage.tsx`
- Modify: `apps/customer-ui/src/components/publish/ContentArtifactDialog.tsx`
- Modify: `apps/customer-ui/src/components/dm/DmConversationThread.tsx`
- Modify: `apps/customer-ui/src/components/dm/DmKnowledgePanel.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandSettings.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/dmAutomation.test.tsx`

- [ ] **Step 1: 처리 중 버튼 테스트 추가**

```tsx
expect(screen.getByRole("button", { name: /저장/ })).toHaveAttribute("aria-busy", "true");
expect(within(screen.getByRole("button", { name: /저장/ })).getByLabelText("저장 중")).toBeVisible();
expect(screen.getByRole("button", { name: /수동 답변 전송/ })).toBeDisabled();
expect(screen.getByRole("button", { name: /Wiki 다시 만들기/ })).toHaveAttribute("aria-busy", "true");
```

- [ ] **Step 2: 테스트를 실행해 인라인 스피너 부재 실패 확인**

Run:

```bash
npm run test --workspace @brand-pilot/customer-ui -- brandSettings.test.tsx publishQueue.test.tsx dmAutomation.test.tsx
```

Expected: FAIL because the busy buttons contain text only.

- [ ] **Step 3: 버튼에 인라인 스피너와 `aria-busy` 적용**

```tsx
<button className="button primary" type="submit" disabled={isSaving} aria-busy={isSaving}>
  {isSaving ? <InlineSpinner label="저장 중" /> : null}
  저장
</button>
```

결과 저장, 수동 DM 전송, Wiki 재생성 버튼은 다음 형태로 적용한다.

```tsx
<button className="button primary" type="button" disabled={downloadLoading} aria-busy={downloadLoading} onClick={() => void download()}>
  {downloadLoading ? <InlineSpinner label="결과 저장 중" /> : null}
  저장
</button>

<button className="button primary" type="button" disabled={!body.trim() || sending} aria-busy={sending} onClick={() => void submitManualReply()}>
  {sending ? <InlineSpinner label="수동 답변 전송 중" /> : <Send size={16} aria-hidden="true" />}
  전송
</button>

<button className="button primary" type="button" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing}>
  {refreshing ? <InlineSpinner label="Wiki 재생성 요청 중" /> : <RefreshCw size={16} aria-hidden="true" />}
  Wiki 다시 만들기
</button>
```

FAQ·제품 업로드 라벨은 `aria-busy={busy}`를 추가하고 기존 `busy` 비활성화를 유지한다. 버튼 문구는 처리 전후 동일하게 유지해 폭 변화를 막는다.

- [ ] **Step 4: 대상 테스트 통과 확인**

Run:

```bash
npm run test --workspace @brand-pilot/customer-ui -- brandSettings.test.tsx publishQueue.test.tsx dmAutomation.test.tsx
```

Expected: PASS.

- [ ] **Step 5: 명령 로더 커밋**

```bash
git add apps/customer-ui/src/pages/BrandSettingsPage.tsx apps/customer-ui/src/components/publish/ContentArtifactDialog.tsx apps/customer-ui/src/components/dm/DmConversationThread.tsx apps/customer-ui/src/components/dm/DmKnowledgePanel.tsx apps/customer-ui/src/__tests__/brandSettings.test.tsx apps/customer-ui/src/__tests__/publishQueue.test.tsx apps/customer-ui/src/__tests__/dmAutomation.test.tsx
git commit -m "feat: add inline action progress"
```

### Task 6: 전체 회귀 및 실제 화면 검증

**Files:**
- Modify only if verification finds a defect in the files listed above.

- [ ] **Step 1: 전체 고객 UI 단위 테스트 실행**

Run: `npm run test --workspace @brand-pilot/customer-ui`

Expected: all customer UI tests PASS with no React state warnings.

- [ ] **Step 2: 전체 E2E 실행**

Run: `npm run test:e2e`

Expected: all desktop and mobile scenarios PASS with no console errors or horizontal overflow.

- [ ] **Step 3: 전체 빌드와 환경 계약 확인**

Run:

```bash
npm run build
npm run env:check
```

Expected: TypeScript, Vite, API, DM worker, image/content worker builds PASS and local env values match.

- [ ] **Step 4: 로그인된 로컬 화면 수동 검증**

브라우저에서 다음을 확인한다.

1. `/instagram-trends`: 추천 태그 클릭 즉시 검색, 최초 카드 스켈레톤, 기존 결과 재조회 오버레이, 실패 후 오류
2. `/dashboard`: 최초 페이지 스켈레톤 후 실제 지표
3. `/brand-settings`: 폼 스켈레톤 후 입력값, 저장 버튼 스피너
4. `/billing`: 결제 스켈레톤 후 요약
5. `/publish-queue`: 상세 팝업 스켈레톤 후 미디어
6. `/dm-automation`: 목록·상세·Wiki 스켈레톤과 명령 버튼
7. `/onboarding`, `/channels`: 로딩과 최종 오류가 동시에 보이지 않음

- [ ] **Step 5: 검증 수정이 발생한 경우 최종 커밋**

```bash
git add apps/customer-ui
git commit -m "fix: complete customer UI loading verification"
```
