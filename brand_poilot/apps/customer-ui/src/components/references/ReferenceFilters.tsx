import { Compass, LibraryBig, UsersRound } from "lucide-react";
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

export type ReferenceWorkspace = "library" | "discover" | "sources";

export function isReferenceView(value: string | null): value is ReferenceView {
  return referenceViews.some((view) => view.key === value);
}

export function referenceWorkspaceForView(view: ReferenceView): ReferenceWorkspace {
  if (view === "trends") return "discover";
  if (view === "saved-brands") return "sources";
  return "library";
}

const referenceWorkspaces = [
  { key: "discover", label: "트렌드 찾기", view: "trends", icon: Compass },
  { key: "library", label: "내 라이브러리", view: "all", icon: LibraryBig },
  { key: "sources", label: "브랜드·작성자", view: "saved-brands", icon: UsersRound },
] as const;

const libraryFilters = [
  { key: "all", label: "전체" },
  { key: "saved-content", label: "콘텐츠" },
  { key: "saved-trends", label: "트렌드" },
] as const;

function referenceHref(view: ReferenceView, query: string) {
  const params = new URLSearchParams({ view });
  if (query) params.set("q", query);
  return `/references?${params.toString()}`;
}

export function ReferenceFilters({ activeView, libraryQuery = "" }: { activeView: ReferenceView; libraryQuery?: string }) {
  const activeWorkspace = referenceWorkspaceForView(activeView);

  return (
    <div className="reference-navigation">
      <nav className="reference-view-nav reference-workspace-nav" aria-label="레퍼런스 작업 공간">
        {referenceWorkspaces.map((workspace) => {
          const Icon = workspace.icon;
          const isActive = activeWorkspace === workspace.key;
          return (
            <Link
              className={isActive ? "reference-workspace-link is-active" : "reference-workspace-link"}
              aria-current={isActive ? "page" : undefined}
              key={workspace.key}
              to={workspace.key === "library" ? referenceHref(workspace.view, libraryQuery) : `/references?view=${workspace.view}`}
            >
              <Icon size={20} aria-hidden="true" />
              {workspace.label}
            </Link>
          );
        })}
      </nav>

      {activeWorkspace === "library" ? (
        <div className="reference-library-toolbar">
          <nav className="reference-library-nav" aria-label="내 라이브러리 필터">
            {libraryFilters.map((filter) => {
              const isActive = activeView === filter.key || (activeView === "add" && filter.key === "all");
              return (
                <Link
                  key={filter.key}
                  className={isActive ? "reference-library-link is-active" : "reference-library-link"}
                  aria-current={isActive ? "page" : undefined}
                  to={referenceHref(filter.key, libraryQuery)}
                >
                  {filter.label}
                </Link>
              );
            })}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
