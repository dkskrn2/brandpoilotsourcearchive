import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { isReferenceView, ReferenceFilters } from "../components/references/ReferenceFilters";
import { InstagramTrendExplorerPanel } from "../components/references/InstagramTrendExplorerPanel";
import { SavedTrendReferencesPanel } from "../components/references/SavedTrendReferencesPanel";
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

function ReferenceCollection({ view }: { view: "all" | "saved-content" | "recent" | "favorites" }) {
  const [items, setItems] = useState<ReferenceItem[] | null>(null);
  const [selected, setSelected] = useState<ReferenceItem | null>(null);
  const [failed, setFailed] = useState(false);
  const [purpose, setPurpose] = useState<ReferenceContentPurpose | "all">("all");

  useEffect(() => {
    let active = true;
    setFailed(false);
    setItems(null);
    const filters = view === "saved-content"
      ? { kind: "saved_content" }
      : view === "recent"
        ? { recent: 30 }
        : view === "favorites"
          ? { favorite: true }
          : {};
    void api.listReferences(DEMO_BRAND_ID, filters)
      .then((rows) => { if (active) setItems(rows); })
      .catch(() => { if (active) { setItems([]); setFailed(true); } });
    return () => { active = false; };
  }, [view]);

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
        <div><h2 id="reference-collection-title">저장된 레퍼런스</h2><p className="muted">카드에는 보관된 미리보기와 출처 metadata만 먼저 표시합니다.</p></div>
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

function DirectReferenceAddPanel() {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head"><h2>직접 추가</h2></div>
      <div className="panel-body">
        <p className="muted">파일 내용 확인 후 안전한 업로드 세션으로 보관합니다. 진행 중인 파일을 제거하면 예약된 업로드도 정리합니다.</p>
        <button className="button primary" type="button" onClick={() => setOpen(true)}>파일 업로드</button>
      </div>
      {open ? (
        <ReferenceUploadDialog
          brandId={DEMO_BRAND_ID}
          gateway={libraryGateway}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

export function ReferenceLibraryPage() {
  const [searchParams] = useSearchParams();
  const requestedView = searchParams.get("view");
  const activeView = isReferenceView(requestedView) ? requestedView : "all";
  const requestedPage = Number(searchParams.get("page"));
  const archivePage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const type = searchParams.get("type");
  const trendType: InstagramTrendMediaTypeFilter =
    type && ["all", "image", "carousel", "video", "reel"].includes(type)
      ? type as InstagramTrendMediaTypeFilter
      : "all";
  const sort = searchParams.get("sort");
  const trendSort: InstagramTrendSort =
    sort && ["meta", "likes", "comments"].includes(sort) ? sort as InstagramTrendSort : "meta";
  return (
    <section className="content reference-library-page">
      <PageHeader title="레퍼런스" description="저장한 자료와 공개 트렌드를 한곳에서 확인합니다." />
      <ReferenceFilters activeView={activeView} />
      {activeView === "trends" ? <InstagramTrendExplorerPanel initialType={trendType} initialSort={trendSort} /> : null}
      {activeView === "saved-trends" ? <SavedTrendReferencesPanel initialPage={archivePage} /> : null}
      {activeView === "saved-brands" ? <SavedReferenceBrandsPanel /> : null}
      {activeView === "external-urls" ? <ExternalUrlsPanel /> : null}
      {activeView === "add" ? <DirectReferenceAddPanel /> : null}
      {["all", "saved-content", "recent", "favorites"].includes(activeView)
        ? <ReferenceCollection view={activeView as "all" | "saved-content" | "recent" | "favorites"} />
        : null}
    </section>
  );
}
