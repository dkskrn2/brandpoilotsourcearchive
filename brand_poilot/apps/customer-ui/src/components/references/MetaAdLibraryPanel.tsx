import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, DEMO_BRAND_ID } from "../../lib/apiClient";
import type { ContentCategory, MetaAdLibraryItem, MetaAdLibrarySearchPage, MetaAdSearchInput } from "../../types";
import { Alert } from "../ui/Alert";
import { EmptyState } from "../ui/EmptyState";
import { InlineSpinner } from "../ui/LoadingState";
import { MetaAdCard } from "./MetaAdCard";

type SearchMode = MetaAdSearchInput["mode"];

const errorCopy: Record<string, string> = {
  meta_ad_library_not_configured: "Meta 광고 라이브러리 연결 정보가 설정되지 않았습니다.",
  meta_ad_library_permission_required: "Meta 광고 라이브러리 조회 권한이 필요합니다.",
  meta_ad_library_reconnect_required: "Meta 광고 라이브러리 연결이 만료되었습니다. 다시 연결해 주세요.",
  meta_ad_library_rate_limited: "Meta 호출 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
  meta_ad_library_fetch_failed: "Meta 광고를 가져오지 못했습니다. 저장된 결과가 있으면 그대로 표시합니다.",
};

function messageFor(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return Object.entries(errorCopy).find(([code]) => message.includes(code))?.[1] ?? errorCopy.meta_ad_library_fetch_failed;
}

function pageIds(value: string) {
  return Array.from(new Set(value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)));
}

export function MetaAdLibraryPanel({ active }: { active: boolean }) {
  const initialized = useRef(false);
  const resultRequestId = useRef(0);
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [categoryCode, setCategoryCode] = useState("");
  const [mode, setMode] = useState<SearchMode>("keyword");
  const [keyword, setKeyword] = useState("");
  const [pageIdInput, setPageIdInput] = useState("");
  const [result, setResult] = useState<MetaAdLibrarySearchPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function settlePending(page: MetaAdLibrarySearchPage, requestId: number) {
    let current = page;
    for (let attempt = 0; attempt < 120 && current.cacheState === "pending"; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      if (requestId !== resultRequestId.current) return current;
      current = await api.getMetaAdLibrarySearch(DEMO_BRAND_ID, current.searchId);
      if (requestId === resultRequestId.current) setResult(current);
    }
    if (current.cacheState === "pending" && requestId === resultRequestId.current) {
      setError("결과 준비가 지연되고 있습니다. 잠시 후 다시 검색해 주세요.");
    }
    return current;
  }

  useEffect(() => {
    if (!active || initialized.current) return;
    initialized.current = true;
    let ignore = false;
    void Promise.all([api.listContentCategories(), api.getBrandProfile(DEMO_BRAND_ID)])
      .then(async ([availableCategories, profile]) => {
        if (ignore) return;
        setCategories(availableCategories);
        const primary = profile.primaryCategory;
        if (!primary) return;
        setCategoryCode(primary.code);
        setKeyword(primary.name);
        try {
          const cached = await api.findMetaAdLibraryCache(DEMO_BRAND_ID, { mode: "keyword", query: primary.name });
          if (!ignore && cached) {
            const requestId = ++resultRequestId.current;
            setResult(cached);
            if (cached.cacheState === "pending") void settlePending(cached, requestId).catch((pendingError) => setError(messageFor(pendingError)));
          }
        } catch (cacheError) {
          if (!ignore) setError(messageFor(cacheError));
        }
      })
      .catch((loadError) => { if (!ignore) setError(messageFor(loadError)); });
    return () => { ignore = true; };
  }, [active]);

  async function selectCategory(nextCode: string) {
    const requestId = ++resultRequestId.current;
    setCategoryCode(nextCode);
    const category = categories.find((item) => item.code === nextCode);
    const nextKeyword = category?.name ?? "";
    setMode("keyword");
    setKeyword(nextKeyword);
    setResult(null);
    setError(null);
    setSearched(false);
    if (!nextKeyword) return;
    try {
      const cached = await api.findMetaAdLibraryCache(DEMO_BRAND_ID, { mode: "keyword", query: nextKeyword });
      if (cached && requestId === resultRequestId.current) {
        setResult(cached);
        if (cached.cacheState === "pending") void settlePending(cached, requestId).catch((pendingError) => setError(messageFor(pendingError)));
      }
    } catch (cacheError) {
      setError(messageFor(cacheError));
    }
  }

  async function search() {
    if (loading) return;
    const input: MetaAdSearchInput = mode === "keyword"
      ? { mode: "keyword", query: keyword.trim() }
      : { mode: "page", pageIds: pageIds(pageIdInput) };
    if ((input.mode === "keyword" && input.query.length < 2) || (input.mode === "page" && input.pageIds.length === 0)) {
      setError(input.mode === "keyword" ? "두 글자 이상의 광고 키워드를 입력하세요." : "광고주 Page ID를 입력하세요.");
      return;
    }
    setLoading(true);
    const requestId = ++resultRequestId.current;
    setSearched(true);
    setError(null);
    try {
      const found = await api.searchMetaAdLibrary(DEMO_BRAND_ID, input);
      if (requestId !== resultRequestId.current) return;
      setResult(found);
      if (found.cacheState === "pending") void settlePending(found, requestId).catch((pendingError) => setError(messageFor(pendingError)));
    } catch (searchError) {
      setError(messageFor(searchError));
    } finally {
      setLoading(false);
    }
  }

  function updateSaved(adId: string, isSaved: boolean) {
    setResult((current) => current ? {
      ...current,
      items: current.items.map((item) => item.id === adId ? { ...item, isSaved } : item),
    } : current);
  }

  async function save(ad: MetaAdLibraryItem) {
    await api.saveMetaAdLibraryAd(DEMO_BRAND_ID, ad.id);
    updateSaved(ad.id, true);
  }

  async function remove(ad: MetaAdLibraryItem) {
    await api.removeMetaAdLibraryAd(DEMO_BRAND_ID, ad.id);
    updateSaved(ad.id, false);
  }

  async function loadMore() {
    if (!result?.nextCursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const next = await api.getMetaAdLibrarySearch(DEMO_BRAND_ID, result.searchId, result.nextCursor);
      setResult((current) => current ? {
        ...next,
        items: [...current.items, ...next.items.filter((item) => !current.items.some((existing) => existing.id === item.id))],
      } : next);
    } catch (loadError) {
      setError(messageFor(loadError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="meta-ad-library" aria-labelledby="meta-ad-library-title">
      <div className="panel-head">
        <div>
          <p className="reference-source-label">Meta 광고 라이브러리</p>
          <h2 id="meta-ad-library-title">Meta 광고 찾기</h2>
          <p className="muted">한국에서 현재 게재 중인 공개 광고를 공식 Meta API로 조회합니다.</p>
        </div>
      </div>
      <section className="panel meta-ad-search-panel">
        <div className="panel-body grid">
          <label className="trend-category-select">분야
            <select aria-label="분야" value={categoryCode} onChange={(event) => void selectCategory(event.target.value)}>
              <option value="">분야 선택</option>
              {categories.map((category) => <option key={category.code} value={category.code}>{category.name}</option>)}
            </select>
          </label>
          <div className="meta-ad-mode-switch" role="group" aria-label="Meta 광고 검색 기준">
            <button type="button" className="tab" aria-pressed={mode === "keyword"} onClick={() => setMode("keyword")}>키워드</button>
            <button type="button" className="tab" aria-pressed={mode === "page"} onClick={() => setMode("page")}>광고주 Page ID</button>
          </div>
          <form className="meta-ad-search-form" onSubmit={(event) => { event.preventDefault(); void search(); }}>
            <Search size={18} aria-hidden="true" />
            {mode === "keyword" ? (
              <label>광고 키워드<input aria-label="광고 키워드" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="예: 여행" /></label>
            ) : (
              <label>광고주 Page ID<input aria-label="광고주 Page ID" value={pageIdInput} onChange={(event) => setPageIdInput(event.target.value)} placeholder="쉼표로 여러 ID 입력" /></label>
            )}
            <button className="button primary" type="submit" aria-label="Meta 광고 검색" disabled={loading}>
              {loading ? <InlineSpinner label="검색 중" /> : null}<span>검색</span>
            </button>
          </form>
          <p className="muted small">분야 선택은 현재 화면에만 적용되며 브랜드 설정은 변경하지 않습니다. 검색 버튼을 눌러야 Meta API를 호출합니다.</p>
        </div>
      </section>
      {error ? <Alert title="Meta 광고 탐색 상태" variant="warn">{error}</Alert> : null}
      {result?.cacheState === "stale" ? <Alert title="저장된 결과 표시" variant="warn">최신 조회에 실패해 이전에 저장된 결과를 표시합니다.</Alert> : null}
      {result?.cacheState === "pending" ? <p role="status" className="muted">같은 검색의 최신 결과를 불러오는 중입니다.</p> : null}
      {result?.items.length ? (
        <div className="meta-ad-grid">
          {result.items.map((ad) => <MetaAdCard key={ad.id} ad={ad} onSave={save} onRemove={remove} />)}
        </div>
      ) : searched && !loading && !error && result?.cacheState !== "pending" ? (
        <EmptyState title="검색 결과가 없습니다." description="다른 키워드나 광고주 Page ID로 검색해 보세요." />
      ) : null}
      {result?.nextCursor ? <button className="button meta-ad-load-more" type="button" disabled={loading} onClick={() => void loadMore()}>광고 더 보기</button> : null}
    </section>
  );
}
