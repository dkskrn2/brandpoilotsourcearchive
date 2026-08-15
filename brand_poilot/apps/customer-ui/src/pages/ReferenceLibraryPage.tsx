import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { ReferenceAddMenu } from "../components/references/ReferenceAddMenu";
import { isReferenceView, ReferenceFilters } from "../components/references/ReferenceFilters";
import { InstagramTrendExplorerPanel } from "../components/references/InstagramTrendExplorerPanel";
import { useSearchParams } from "react-router-dom";
import { SavedReferenceBrandsPanel } from "../components/references/SavedReferenceBrandsPanel";
import { ExternalUrlsPanel } from "../components/references/ExternalUrlsPanel";
import { ReferenceCard } from "../components/references/ReferenceCard";
import { ReferenceDetailDialog } from "../components/references/ReferenceDetailDialog";
import { Alert } from "../components/ui/Alert";
import { EmptyState } from "../components/ui/EmptyState";
import { ListSkeleton } from "../components/ui/LoadingState";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type { ReferenceContentPurpose, ReferenceDetail, ReferenceItem, ReferencePattern } from "../types";
import type { InstagramTrendMediaTypeFilter, InstagramTrendSort } from "../types";
import { libraryGateway } from "../features/libraries/libraryGateway";
import { ReferenceUploadDialog } from "../components/references/ReferenceUploadDialog";

type ReferenceCollectionView = "all" | "saved-content" | "saved-trends" | "recent" | "favorites";

function ReferenceCollection({ view, query }: { view: ReferenceCollectionView; query: string }) {
  const [items, setItems] = useState<ReferenceItem[] | null>(null);
  const [selected, setSelected] = useState<ReferenceItem | null>(null);
  const [failed, setFailed] = useState(false);
  const [purpose, setPurpose] = useState<ReferenceContentPurpose | "all">("all");
  const copy: Record<ReferenceCollectionView, { heading: string; description: string }> = {
    all: {
      heading: "전체 레퍼런스",
      description: "저장한 자료의 미리보기와 출처 정보를 확인합니다.",
    },
    "saved-content": {
      heading: "저장한 콘텐츠",
      description: "저장한 콘텐츠의 미리보기와 출처 정보를 확인합니다.",
    },
    "saved-trends": {
      heading: "저장한 트렌드",
      description: "하트로 저장한 공개 트렌드의 미리보기와 출처 정보를 확인합니다.",
    },
    recent: {
      heading: "최근 추가한 자료",
      description: "최근 30일에 추가한 자료의 미리보기와 출처 정보를 확인합니다.",
    },
    favorites: {
      heading: "즐겨찾기",
      description: "즐겨찾기한 자료의 미리보기와 출처 정보를 확인합니다.",
    },
  };

  useEffect(() => {
    let active = true;
    setFailed(false);
    setItems(null);
    const filters = view === "saved-content"
      ? { collection: "content" as const, ...(query ? { q: query } : {}) }
      : view === "saved-trends"
        ? { collection: "trend" as const, ...(query ? { q: query } : {}) }
      : view === "recent"
        ? { recent: 30 }
        : view === "favorites"
          ? { favorite: true }
          : { collection: "all" as const, ...(query ? { q: query } : {}) };
    void api.listReferences(DEMO_BRAND_ID, filters)
      .then((rows) => { if (active) setItems(rows); })
      .catch(() => { if (active) { setItems([]); setFailed(true); } });
    return () => { active = false; };
  }, [query, view]);

  const visibleItems = useMemo(
    () => (items ?? []).filter((item) => purpose === "all" || item.contentPurpose === purpose || item.contentPurpose === "both"),
    [items, purpose],
  );
  const loadPattern = useCallback(
    (referenceId: string): Promise<ReferencePattern> => api.getReferencePattern(DEMO_BRAND_ID, referenceId),
    [],
  );
  const loadDetail = useCallback(
    (referenceId: string): Promise<ReferenceDetail> => api.getReference(DEMO_BRAND_ID, referenceId),
    [],
  );

  async function toggleFavorite(item: ReferenceItem) {
    try {
      const updated = await api.setReferenceFavorite(DEMO_BRAND_ID, item.id, !item.favorite);
      setItems((current) => current?.map((entry) => entry.id === item.id ? updated : entry) ?? null);
    } catch {
      setFailed(true);
    }
  }

  return (
    <section className="panel reference-collection" aria-labelledby="reference-collection-title">
      <div className="panel-head">
        <div><h2 id="reference-collection-title">{copy[view].heading}</h2><p className="muted">{copy[view].description}</p></div>
        <label>용도
          <select aria-label="레퍼런스 용도 필터" value={purpose} onChange={(event) => setPurpose(event.target.value as ReferenceContentPurpose | "all")}>
            <option value="all">전체</option><option value="informational">정보성</option><option value="marketing">마케팅성</option><option value="both">둘 다</option>
          </select>
        </label>
      </div>
      <div className="panel-body">
        {items === null ? <ListSkeleton rows={4} columns={4} label="레퍼런스를 불러오는 중입니다." /> : null}
        {failed ? <Alert title="레퍼런스를 불러오지 못했습니다" variant="warn">저장된 자료를 표시할 수 없습니다. 잠시 후 다시 시도해 주세요.</Alert> : null}
        {items && !failed && visibleItems.length === 0 ? <EmptyState title="조건에 맞는 레퍼런스가 없습니다" description="다른 보기나 용도 필터를 선택하세요." /> : null}
        {visibleItems.length ? <div className="reference-card-grid">{visibleItems.map((item) => (
          <ReferenceCard key={item.id} item={item} onSelect={setSelected} onFavorite={(entry) => void toggleFavorite(entry)} />
        ))}</div> : null}
      </div>
      {selected ? <ReferenceDetailDialog item={selected} onClose={() => setSelected(null)} loadDetail={loadDetail} loadPattern={loadPattern} /> : null}
    </section>
  );
}

export function ReferenceLibraryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get("view");
  const activeView = requestedView === null ? "trends" : isReferenceView(requestedView) ? requestedView : "all";
  const displayView = activeView === "add" ? "all" : activeView;
  const showsLibrarySearch = ["all", "saved-content", "saved-trends"].includes(displayView);
  const libraryQuery = searchParams.get("q")?.trim().slice(0, 200) ?? "";
  const [queryDraft, setQueryDraft] = useState(libraryQuery);
  const [uploadOpen, setUploadOpen] = useState(activeView === "add");
  const type = searchParams.get("type");
  const trendType: InstagramTrendMediaTypeFilter =
    type && ["all", "image", "carousel", "video", "reel"].includes(type)
      ? type as InstagramTrendMediaTypeFilter
      : "all";
  const sort = searchParams.get("sort");
  const trendSort: InstagramTrendSort =
    sort && ["meta", "likes", "comments"].includes(sort) ? sort as InstagramTrendSort : "meta";

  useEffect(() => {
    setUploadOpen(activeView === "add");
  }, [activeView]);

  useEffect(() => {
    setQueryDraft(libraryQuery);
  }, [libraryQuery]);

  function submitLibrarySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    const normalized = queryDraft.trim().slice(0, 200);
    if (normalized) next.set("q", normalized); else next.delete("q");
    setSearchParams(next);
  }

  return (
    <section className="content reference-library-page">
      <PageHeader
        title="레퍼런스"
        description="저장한 자료와 공개 트렌드를 한곳에서 확인합니다."
        actions={<ReferenceAddMenu onUpload={() => setUploadOpen(true)} />}
      />
      <ReferenceFilters activeView={activeView} libraryQuery={libraryQuery} />
      {showsLibrarySearch ? (
        <form className="reference-library-search" role="search" onSubmit={submitLibrarySearch}>
          <label htmlFor="reference-library-search">내 라이브러리 검색</label>
          <div>
            <input
              id="reference-library-search"
              type="search"
              value={queryDraft}
              maxLength={200}
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder="제목, 출처, 작성자 검색"
            />
            <button className="button primary" type="submit">검색</button>
          </div>
        </form>
      ) : null}
      {displayView === "trends" ? <InstagramTrendExplorerPanel initialType={trendType} initialSort={trendSort} /> : null}
      {displayView === "saved-brands" ? <SavedReferenceBrandsPanel /> : null}
      {displayView === "external-urls" ? <ExternalUrlsPanel /> : null}
      {["all", "saved-content", "saved-trends", "recent", "favorites"].includes(displayView)
        ? <ReferenceCollection view={displayView as ReferenceCollectionView} query={libraryQuery} />
        : null}
      {uploadOpen ? (
        <ReferenceUploadDialog
          brandId={DEMO_BRAND_ID}
          gateway={libraryGateway}
          onClose={() => setUploadOpen(false)}
        />
      ) : null}
    </section>
  );
}
