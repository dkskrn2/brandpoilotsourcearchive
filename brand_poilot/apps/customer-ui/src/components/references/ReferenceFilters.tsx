import { Link } from "react-router-dom";

export const referenceViews = [
  { key: "all", label: "전체" },
  { key: "saved-brands", label: "저장한 브랜드" },
  { key: "saved-content", label: "저장한 콘텐츠" },
  { key: "trends", label: "트렌드 탐색" },
  { key: "saved-trends", label: "저장한 트렌드" },
  { key: "external-urls", label: "외부 URL" },
  { key: "recent", label: "최근 사용" },
  { key: "favorites", label: "즐겨찾기" },
  { key: "add", label: "직접 추가" },
] as const;

export type ReferenceView = (typeof referenceViews)[number]["key"];

export function isReferenceView(value: string | null): value is ReferenceView {
  return referenceViews.some((view) => view.key === value);
}

export function ReferenceFilters({ activeView }: { activeView: ReferenceView }) {
  return (
    <nav className="reference-view-nav" aria-label="레퍼런스 보기">
      {referenceViews.map((view) => (
        <Link
          className={activeView === view.key ? "tab active" : "tab"}
          aria-current={activeView === view.key ? "page" : undefined}
          key={view.key}
          to={`/references?view=${view.key}`}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  );
}
