# 게시관리 정방형 카드 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게시관리의 기존 테이블을 정방형 카드 그리드로 바꾸고, 내부 상태값은 유지한 채 사용자 필터를 `전체·준비 중·검토 필요·게시 예정·완료·문제`로 단순화한다.

**Architecture:** API와 DB 계약은 변경하지 않는다. `PublishQueuePage`에서 조립하는 기존 관리 행을 그대로 사용하되, 상태 그룹 매핑은 순수 함수로 분리하고 카드 미디어 추출은 기존 목록 응답의 `previewImageUrl`, `previewVideoUrl`, `outputJson`, `artifactPublicUrl`만 사용한다. 기존 상세 모달과 검토·승인·재생성·거절 핸들러는 카드 작업 버튼에 그대로 연결한다.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, CSS Grid

---

## 파일 구조

- Create: `apps/customer-ui/src/components/publish/publishManagementFilters.ts`
  - 화면 필터 정의, 내부 상태 그룹 매핑, 건수 계산을 담당한다.
- Create: `apps/customer-ui/src/components/publish/publishManagementFilters.test.ts`
  - 모든 내부 상태가 정확히 한 화면 그룹에 포함되는지 검증한다.
- Create: `apps/customer-ui/src/components/publish/PublishManagementPreview.tsx`
  - 이미지·영상·HTML·텍스트·미생성 상태의 정방형 미리보기를 담당한다.
- Create: `apps/customer-ui/src/components/publish/PublishManagementPreview.test.tsx`
  - 미디어 우선순위와 대체 상태를 검증한다.
- Modify: `apps/customer-ui/src/components/publish/TopicPublishGroup.tsx`
  - 테이블 행 출력 대신 주제 단위 정방형 카드 출력을 담당한다.
- Modify: `apps/customer-ui/src/components/publish/TopicPublishGroup.test.tsx`
  - 카드 의미 구조, 채널 요약, 기존 상세 열기 조건을 검증한다.
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
  - 테이블을 카드 그리드로 교체하고 기존 작업 핸들러를 카드에 연결한다.
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`
  - 그룹 필터, 카드 렌더링, 기존 작업 회귀를 검증한다.
- Modify: `apps/customer-ui/src/styles/prototype.css`
  - 3열·2열·1열 반응형 정방형 카드와 크롭 없는 미디어 스타일을 정의한다.
- Modify: `apps/customer-ui/src/__tests__/responsiveStyles.test.ts`
  - 카드 비율과 반응형 열 수를 검증한다.

### Task 1: 화면 상태 그룹을 순수 함수로 분리

**Files:**
- Create: `apps/customer-ui/src/components/publish/publishManagementFilters.ts`
- Create: `apps/customer-ui/src/components/publish/publishManagementFilters.test.ts`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`

- [ ] **Step 1: 모든 내부 상태의 화면 그룹을 검증하는 실패 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import {
  countPublishManagementFilters,
  matchesPublishManagementFilter,
  publishManagementFilters,
  type PublishManagementStatus
} from "./publishManagementFilters";

describe("publishManagementFilters", () => {
  const statuses: PublishManagementStatus[] = [
    "generating", "needs_review", "queued", "publish_queued", "scheduled",
    "publishing", "completed", "failed", "rejected"
  ];

  it("maps each internal status to one visible group", () => {
    const visibleGroups = publishManagementFilters.filter((filter) => filter.id !== "all");
    for (const status of statuses) {
      expect(visibleGroups.filter((filter) => matchesPublishManagementFilter(status, filter.id))).toHaveLength(1);
    }
  });

  it("counts grouped filters without losing rows", () => {
    expect(countPublishManagementFilters(statuses)).toEqual({
      all: 9,
      preparing: 2,
      needs_review: 1,
      upcoming: 3,
      completed: 1,
      issues: 2
    });
  });
});
```

- [ ] **Step 2: 단위 테스트를 실행해 모듈 부재로 실패하는지 확인**

Run: `npm test -- publishManagementFilters.test.ts`

Working directory: `apps/customer-ui`

Expected: FAIL because `./publishManagementFilters` does not exist.

- [ ] **Step 3: 상태 그룹 모듈 최소 구현**

```ts
export type PublishManagementStatus =
  | "generating"
  | "needs_review"
  | "queued"
  | "publish_queued"
  | "scheduled"
  | "publishing"
  | "completed"
  | "failed"
  | "rejected";

export type PublishManagementFilterId =
  | "all"
  | "preparing"
  | "needs_review"
  | "upcoming"
  | "completed"
  | "issues";

export const publishManagementFilters: ReadonlyArray<{ id: PublishManagementFilterId; label: string }> = [
  { id: "all", label: "전체" },
  { id: "preparing", label: "준비 중" },
  { id: "needs_review", label: "검토 필요" },
  { id: "upcoming", label: "게시 예정" },
  { id: "completed", label: "완료" },
  { id: "issues", label: "문제" }
];

const groupedStatuses: Record<Exclude<PublishManagementFilterId, "all">, ReadonlySet<PublishManagementStatus>> = {
  preparing: new Set(["generating", "queued"]),
  needs_review: new Set(["needs_review"]),
  upcoming: new Set(["publish_queued", "scheduled", "publishing"]),
  completed: new Set(["completed"]),
  issues: new Set(["failed", "rejected"])
};

export function matchesPublishManagementFilter(
  status: PublishManagementStatus,
  filter: PublishManagementFilterId
) {
  return filter === "all" || groupedStatuses[filter].has(status);
}

export function countPublishManagementFilters(statuses: PublishManagementStatus[]) {
  return Object.fromEntries(
    publishManagementFilters.map((filter) => [
      filter.id,
      statuses.filter((status) => matchesPublishManagementFilter(status, filter.id)).length
    ])
  ) as Record<PublishManagementFilterId, number>;
}
```

- [ ] **Step 4: `PublishQueuePage`의 로컬 필터 타입을 새 모듈 타입으로 교체**

```ts
import {
  countPublishManagementFilters,
  matchesPublishManagementFilter,
  publishManagementFilters,
  type PublishManagementFilterId,
  type PublishManagementStatus
} from "../components/publish/publishManagementFilters";

type ManagementStatus = PublishManagementStatus;
type ManagementFilterId = PublishManagementFilterId;
```

기존 `filters` 상수와 `Exclude<ManagementFilterId, "all">` 선언은 제거한다. 행 생성과 API 상태 해석 함수는 변경하지 않는다.

- [ ] **Step 5: 상태 그룹 테스트 통과 확인**

Run: `npm test -- publishManagementFilters.test.ts`

Working directory: `apps/customer-ui`

Expected: PASS with 2 tests.

- [ ] **Step 6: 상태 그룹만 커밋**

```powershell
git add apps/customer-ui/src/components/publish/publishManagementFilters.ts apps/customer-ui/src/components/publish/publishManagementFilters.test.ts apps/customer-ui/src/pages/PublishQueuePage.tsx
git commit -m "refactor: group publish management filters"
```

### Task 2: 목록 응답만 사용하는 정방형 미리보기 구현

**Files:**
- Create: `apps/customer-ui/src/components/publish/PublishManagementPreview.tsx`
- Create: `apps/customer-ui/src/components/publish/PublishManagementPreview.test.tsx`

- [ ] **Step 1: 이미지·영상·텍스트·미생성 미리보기 실패 테스트 작성**

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PublishManagementPreview, resolvePublishPreview } from "./PublishManagementPreview";

afterEach(cleanup);

describe("PublishManagementPreview", () => {
  it("prefers a card image and preserves its full aspect ratio", () => {
    const preview = resolvePublishPreview({
      title: "정방형 카드뉴스",
      outputJson: { cards: [{ url: "https://cdn.example/card.png", width: 1080, height: 1080 }] }
    });
    render(<PublishManagementPreview title="정방형 카드뉴스" preview={preview} />);
    expect(screen.getByRole("img", { name: "정방형 카드뉴스 미리보기" })).toHaveAttribute("src", "https://cdn.example/card.png");
  });

  it("renders video with a poster when both are available", () => {
    render(<PublishManagementPreview title="릴스" preview={{ kind: "video", url: "reel.mp4", posterUrl: "poster.jpg" }} />);
    expect(screen.getByLabelText("릴스 미리보기")).toHaveAttribute("poster", "poster.jpg");
  });

  it("shows text and pending fallbacks without requesting an artifact", () => {
    const { rerender } = render(<PublishManagementPreview title="Threads" preview={{ kind: "text", text: "짧은 본문" }} />);
    expect(screen.getByText("짧은 본문")).toBeVisible();
    rerender(<PublishManagementPreview title="생성 대기" preview={{ kind: "pending" }} />);
    expect(screen.getByText("콘텐츠 생성 전")).toBeVisible();
  });
});
```

- [ ] **Step 2: 미리보기 테스트를 실행해 컴포넌트 부재로 실패하는지 확인**

Run: `npm test -- PublishManagementPreview.test.tsx`

Working directory: `apps/customer-ui`

Expected: FAIL because `PublishManagementPreview` does not exist.

- [ ] **Step 3: 기존 목록 데이터에서 미디어를 고르는 최소 구현 작성**

```tsx
import type { ContentImageAsset, ContentOutputJson, ContentVideoAsset } from "../../types";

export type PublishCardPreview =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string; posterUrl?: string | null }
  | { kind: "text"; text: string }
  | { kind: "document" }
  | { kind: "pending" }
  | { kind: "failed" };

interface PreviewSource {
  title: string;
  previewImageUrl?: string | null;
  previewVideoUrl?: string | null;
  previewPosterUrl?: string | null;
  previewBody?: string | null;
  artifactPublicUrl?: string | null;
  outputJson?: ContentOutputJson | Record<string, unknown>;
  pending?: boolean;
  failed?: boolean;
}

function assetUrl(value: unknown) {
  return value && typeof value === "object" && "url" in value && typeof value.url === "string" ? value.url : null;
}

export function resolvePublishPreview(source: PreviewSource): PublishCardPreview {
  if (source.failed) return { kind: "failed" };
  if (source.pending) return { kind: "pending" };
  if (source.previewVideoUrl) return { kind: "video", url: source.previewVideoUrl, posterUrl: source.previewPosterUrl };
  if (source.previewImageUrl) return { kind: "image", url: source.previewImageUrl };

  const json = source.outputJson ?? {};
  const video = assetUrl((json as { video?: ContentVideoAsset }).video);
  if (video) return { kind: "video", url: video, posterUrl: assetUrl((json as { cover?: ContentImageAsset }).cover) };

  const cards = (json as { cards?: ContentImageAsset[] }).cards;
  const image = assetUrl(cards?.[0])
    ?? assetUrl((json as { story?: ContentImageAsset }).story)
    ?? assetUrl((json as { cover?: ContentImageAsset }).cover)
    ?? assetUrl((json as { scenes?: ContentImageAsset[] }).scenes?.[0]);
  if (image) return { kind: "image", url: image };
  if (source.previewBody) return { kind: "text", text: source.previewBody };
  if ((json as { html?: unknown }).html || (json as { deliveryFormat?: unknown }).deliveryFormat === "html") return { kind: "document" };
  if (source.artifactPublicUrl) return { kind: "document" };
  return { kind: "pending" };
}

export function PublishManagementPreview({ title, preview }: { title: string; preview: PublishCardPreview }) {
  if (preview.kind === "image") return <img className="publish-card__media-object" src={preview.url} alt={`${title} 미리보기`} />;
  if (preview.kind === "video") return <video className="publish-card__media-object" src={preview.url} poster={preview.posterUrl ?? undefined} aria-label={`${title} 미리보기`} muted preload="metadata" />;
  if (preview.kind === "text") return <p className="publish-card__text-preview">{preview.text}</p>;
  if (preview.kind === "document") return <div className="publish-card__placeholder">문서 콘텐츠</div>;
  if (preview.kind === "failed") return <div className="publish-card__placeholder is-failed">콘텐츠 생성 실패</div>;
  return <div className="publish-card__placeholder">콘텐츠 생성 전</div>;
}
```

- [ ] **Step 4: 미리보기 테스트 통과 확인**

Run: `npm test -- PublishManagementPreview.test.tsx`

Working directory: `apps/customer-ui`

Expected: PASS with 3 tests and no network call.

- [ ] **Step 5: 미리보기 컴포넌트만 커밋**

```powershell
git add apps/customer-ui/src/components/publish/PublishManagementPreview.tsx apps/customer-ui/src/components/publish/PublishManagementPreview.test.tsx
git commit -m "feat: add publish card previews"
```

### Task 3: 주제 그룹과 일반 행을 카드 그리드로 교체

**Files:**
- Modify: `apps/customer-ui/src/components/publish/TopicPublishGroup.tsx`
- Modify: `apps/customer-ui/src/components/publish/TopicPublishGroup.test.tsx`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`

- [ ] **Step 1: 페이지 테스트를 새 필터와 카드 의미 구조 기준으로 변경**

`publishQueue.test.tsx`에서 테이블·행을 찾는 검증을 다음 형태로 바꾼다.

```tsx
expect(screen.getByRole("region", { name: "게시 관리 통합 목록" })).toHaveClass("publish-management-grid");
expect(screen.getAllByRole("article").length).toBeGreaterThan(0);
expect(screen.getByRole("button", { name: /준비 중 1/ })).toHaveAttribute("aria-pressed", "false");
expect(screen.getByRole("button", { name: /게시 예정 1/ })).toHaveAttribute("aria-pressed", "false");
expect(screen.queryByRole("button", { name: "대기" })).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: "게시 대기" })).not.toBeInTheDocument();
```

필터 동작 테스트는 다음처럼 내부 상태 두 개가 한 그룹에 포함되는지 검증한다.

```tsx
await userEvent.click(screen.getByRole("button", { name: /준비 중/ }));
expect(screen.getByText("부동산 지고 주식 뜬다?")).toBeVisible();
expect(screen.queryByText("게시 대기 상태 콘텐츠")).not.toBeInTheDocument();

await userEvent.click(screen.getByRole("button", { name: /게시 예정/ }));
expect(screen.getByText("게시 대기 상태 콘텐츠")).toBeVisible();
expect(screen.queryByText("부동산 지고 주식 뜬다?")).not.toBeInTheDocument();
```

- [ ] **Step 2: 주제 그룹 테스트를 `<article>` 카드 기준으로 변경**

```tsx
render(<TopicPublishGroup group={group} onSelectResult={vi.fn()} />);
const card = screen.getByRole("article", { name: "멀티채널 주제" });
expect(card).toHaveClass("publish-management-card");
for (const [, , label] of channelFormats) expect(screen.getByText(label)).toBeVisible();
```

게시 완료 자식만 상세를 여는 기존 조건을 유지하는 테스트도 남긴다.

```tsx
expect(screen.getByRole("button", { name: "Instagram · 카드뉴스 상세" })).toBeEnabled();
```

- [ ] **Step 3: 변경된 페이지와 주제 그룹 테스트가 실패하는지 확인**

Run: `npm test -- publishQueue.test.tsx TopicPublishGroup.test.tsx`

Working directory: `apps/customer-ui`

Expected: FAIL because the page still renders a table and old filters.

- [ ] **Step 4: `TopicPublishGroup`을 정방형 카드로 변환**

반환 루트를 다음 의미 구조로 교체한다. `canOpenDetail`의 기존 조건인 게시 완료 결과만 상세 버튼으로 여는 동작은 유지한다.

```tsx
<article className="publish-management-card" aria-label={group.title}>
  <div className="publish-management-card__preview">
    <PublishManagementPreview title={group.title} preview={preview} />
  </div>
  <div className="publish-management-card__body">
    <div className="publish-management-card__heading">
      <strong className="publish-management-card__title">{group.title}</strong>
      <Badge variant={groupVariant}>{groupLabel}</Badge>
    </div>
    <div className="publish-management-card__meta">
      {group.items.map((item) => <span key={item.slot.id}>{formatLabel(item)}</span>)}
    </div>
    {group.scheduledFor ? <div className="row-meta">게시 예정 {formatScheduledAt(group.scheduledFor)}</div> : null}
    <div className="publish-management-card__actions">
      {group.items.map((item) => renderExistingChannelAction(item))}
    </div>
  </div>
</article>
```

그룹 대표 미리보기는 `resultChannel`이 존재하는 첫 항목을 고르고 `resolvePublishPreview`에 `outputJson`, `artifactPublicUrl`, 사전 생성 여부와 실패 여부를 전달한다. 새로운 API 요청은 추가하지 않는다.

- [ ] **Step 5: `ManagementTable`을 `ManagementCardGrid`로 교체**

필터링과 건수 계산은 다음처럼 변경한다.

```tsx
const counts = countPublishManagementFilters(rows.map((row) => row.status));
const filteredRows = rows.filter((row) => matchesPublishManagementFilter(row.status, activeFilter));
```

필터 버튼은 건수와 선택 상태를 제공한다.

```tsx
{publishManagementFilters.map((filter) => (
  <button
    key={filter.id}
    type="button"
    className={activeFilter === filter.id ? "button primary" : "button"}
    aria-pressed={activeFilter === filter.id}
    onClick={() => onFilterChange(filter.id)}
  >
    {filter.label} <span aria-hidden="true">{counts[filter.id]}</span>
  </button>
))}
```

목록은 다음 구조로 교체한다.

```tsx
<div className="publish-management-grid" role="region" aria-label="게시 관리 통합 목록">
  {filteredRows.map((row) => row.kind === "topic_group" ? (
    <TopicPublishGroup key={row.id} group={row.group} onSelectResult={onSelectResult} />
  ) : (
    <article className="publish-management-card" aria-label={row.title} key={row.id}>
      <div className="publish-management-card__preview">
        <PublishManagementPreview title={row.title} preview={previewForManagementRow(row)} />
      </div>
      <div className="publish-management-card__body">
        <div className="publish-management-card__heading">
          <strong className="publish-management-card__title">{row.title}</strong>
          <Badge variant={statusVariant(row)}>{statusLabel(row)}</Badge>
        </div>
        <div className="publish-management-card__meta">{channelAndFormatSummary(row)}</div>
        <div className="row-meta">{publishTimingSummary(row)}</div>
        <div className="publish-management-card__actions">{renderExistingRowActions(row)}</div>
      </div>
    </article>
  ))}
</div>
```

기존 `PublishChannelButtons`, `WaitingChannelButtons`, `ReviewChannelBadges`, 검토 액션의 허용 상태, 모달 상태와 API 호출은 그대로 재사용한다. 카드에는 소스 URL과 생성 근거 전문을 출력하지 않는다.

- [ ] **Step 6: 최초 로딩을 카드 스켈레톤으로 변경**

```tsx
import { CardSkeleton, InlineSpinner, ListSkeleton } from "../components/ui/LoadingState";

<section className="panel">
  <div className="panel-body">
    <CardSkeleton count={6} label="게시 관리 목록을 불러오는 중입니다." />
  </div>
</section>
```

상세 모달 내부의 `ListSkeleton`은 그대로 유지한다.

- [ ] **Step 7: 페이지와 주제 그룹 테스트 통과 확인**

Run: `npm test -- publishQueue.test.tsx TopicPublishGroup.test.tsx`

Working directory: `apps/customer-ui`

Expected: PASS; existing approve, regenerate, reject, result dialog, download tests remain green.

- [ ] **Step 8: 카드 구조와 작업 연결을 커밋**

```powershell
git add apps/customer-ui/src/pages/PublishQueuePage.tsx apps/customer-ui/src/__tests__/publishQueue.test.tsx apps/customer-ui/src/components/publish/TopicPublishGroup.tsx apps/customer-ui/src/components/publish/TopicPublishGroup.test.tsx
git commit -m "feat: render publish management cards"
```

### Task 4: 정방형 반응형 스타일과 최종 회귀 검증

**Files:**
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Modify: `apps/customer-ui/src/__tests__/responsiveStyles.test.ts`

- [ ] **Step 1: 카드 비율과 반응형 열 수의 실패 테스트 작성**

```ts
it("keeps publish management cards square across responsive layouts", () => {
  expect(css).toContain(".publish-management-card {\n  aspect-ratio: 1 / 1;");
  expect(css).toContain(".publish-management-grid {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));");

  const tablet = css.slice(css.indexOf("@media (max-width: 980px)"), css.indexOf("@media (max-width: 720px)"));
  expect(tablet).toContain(".publish-management-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }");

  const mobile = css.slice(css.indexOf("@media (max-width: 720px)"));
  expect(mobile).toContain(".publish-management-grid { grid-template-columns: 1fr; }");
});
```

- [ ] **Step 2: 반응형 스타일 테스트가 실패하는지 확인**

Run: `npm test -- responsiveStyles.test.ts`

Working directory: `apps/customer-ui`

Expected: FAIL because publish card selectors do not exist.

- [ ] **Step 3: 카드와 크롭 없는 미디어 스타일 구현**

```css
.publish-management-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.publish-management-card {
  aspect-ratio: 1 / 1;
  min-width: 0;
  overflow: hidden;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
}

.publish-management-card__preview {
  min-height: 0;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--surface-alt);
}

.publish-card__media-object {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.publish-management-card__body {
  min-width: 0;
  display: grid;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--line);
}

.publish-management-card__heading {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.publish-management-card__title {
  min-width: 0;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.publish-management-card__meta,
.publish-management-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.publish-card__text-preview,
.publish-card__placeholder {
  margin: 0;
  padding: 18px;
  overflow: hidden;
  color: var(--muted);
}

@media (max-width: 980px) {
  .publish-management-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 720px) {
  .publish-management-grid { grid-template-columns: 1fr; }
}
```

기존 `.management-table` 전용 스타일은 더 이상 다른 화면에서 사용되지 않는지 `rg -n "management-table" apps/customer-ui/src`로 확인한 뒤 제거한다. 공용 `.table` 스타일은 유지한다.

- [ ] **Step 4: 반응형 스타일 테스트와 게시관리 테스트 통과 확인**

Run: `npm test -- responsiveStyles.test.ts publishQueue.test.tsx TopicPublishGroup.test.tsx PublishManagementPreview.test.tsx publishManagementFilters.test.ts`

Working directory: `apps/customer-ui`

Expected: PASS for all selected suites.

- [ ] **Step 5: TypeScript와 프로덕션 빌드 검증**

Run: `npm run build`

Working directory: `apps/customer-ui`

Expected: TypeScript checks and Vite production build complete successfully.

- [ ] **Step 6: 전체 프론트 단위 테스트 회귀 검증**

Run: `npm test`

Working directory: `apps/customer-ui`

Expected: all customer UI test suites pass.

- [ ] **Step 7: 데스크톱과 모바일 브라우저 확인**

Run: `npm run dev -- --port 5173`

Working directory: `apps/customer-ui`

Check:

1. `http://localhost:5173/publish-queue`에서 데스크톱 3열을 확인한다.
2. 900px 폭에서 2열을 확인한다.
3. 390px 폭에서 1열을 확인한다.
4. 정방형·세로형·가로형 미디어가 잘리지 않는지 확인한다.
5. 필터, 콘텐츠 상세, 승인, 재생성, 거절, 완료 결과 열기가 기존과 동일하게 동작하는지 확인한다.
6. 브라우저 콘솔에 React key, 접근성, 네트워크 오류가 새로 발생하지 않는지 확인한다.

- [ ] **Step 8: 스타일과 최종 테스트 변경 커밋**

```powershell
git add apps/customer-ui/src/styles/prototype.css apps/customer-ui/src/__tests__/responsiveStyles.test.ts
git commit -m "style: finalize square publish cards"
```

## Self-Review

- [ ] **Spec coverage:** 여섯 필터, 정방형 카드, 크롭 없는 미디어, 기존 작업, 3·2·1열, 스켈레톤, 빈 상태와 접근성 검증이 각 Task에 포함됐는지 확인한다.
- [ ] **Placeholder scan:** 임시 표기와 불명확한 오류 처리 지시가 문서에 없는지 검색한다.
- [ ] **Type consistency:** `PublishManagementStatus`, `PublishManagementFilterId`, `PublishCardPreview`, `ManagementRow`의 이름과 속성이 모든 Task에서 일치하는지 확인한다.
- [ ] **Scope boundary:** API, DB, 게시 상태 저장, 자동 승인 정책과 게시 스케줄을 수정하는 단계가 없는지 확인한다.
