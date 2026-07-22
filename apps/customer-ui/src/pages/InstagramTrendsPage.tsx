import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { TrendMediaCard } from "../components/trends/TrendMediaCard";
import { TrendMediaDetailDialog } from "../components/trends/TrendMediaDetailDialog";
import { Alert } from "../components/ui/Alert";
import { EmptyState } from "../components/ui/EmptyState";
import { InlineSpinner, LoadingOverlay, PageSkeleton } from "../components/ui/LoadingState";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type {
  BrandProfile,
  ChannelConnection,
  ContentCategory,
  InstagramTrendMedia,
  InstagramTrendConnection,
  InstagramTrendMediaTypeFilter,
  InstagramTrendPage,
  InstagramTrendSearchHistory,
  InstagramTrendSort
} from "../types";

export const trendErrorCopy = {
  instagram_connection_required: "Instagram 채널을 먼저 연결하세요.",
  instagram_trend_connection_required: "트렌드 검색용 Meta 권한 연결이 필요합니다.",
  instagram_trend_reconnect_required: "트렌드 검색용 Meta 연결이 만료되었습니다. 다시 연결하세요.",
  meta_instagram_account_link_required: "Instagram 전문 계정을 Facebook Page에 연결하고 Meta Business에서 계정 로그인을 완료한 뒤 다시 연결하세요.",
  instagram_reconnect_required: "Instagram 연결이 만료되었습니다. 채널에서 다시 연결하세요.",
  instagram_permission_required: "공개 해시태그 검색 권한이 필요합니다. 채널 연결을 확인하세요.",
  hashtag_search_limit_reached: "이 Instagram 계정은 최근 7일 동안 검색 가능한 고유 해시태그 30개를 모두 사용했습니다.",
  invalid_hashtag: "공백과 이모지 없이 해시태그를 입력하세요.",
  instagram_trend_fetch_failed: "Instagram 최신 데이터를 가져오지 못했습니다. 저장된 결과가 있으면 그대로 표시합니다."
} as const;

type ViewState = {
  hashtag: string;
  submittedHashtag: string;
  type: InstagramTrendMediaTypeFilter;
  sort: InstagramTrendSort;
  page: number;
  result: InstagramTrendPage | null;
  histories: InstagramTrendSearchHistory[];
  isSearching: boolean;
  isLoadingResults: boolean;
  error: string | null;
};

const filterOptions: Array<{ value: InstagramTrendMediaTypeFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "image", label: "이미지" },
  { value: "carousel", label: "캐러셀" },
  { value: "video", label: "영상" },
  { value: "reel", label: "릴스" }
];

type TrendErrorCode = keyof typeof trendErrorCopy;
const metaBusinessInstagramSettingsUrl = "https://business.facebook.com/latest/settings/instagram_account";

function trendOauthStartUrl() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
  return import.meta.env.VITE_META_TRENDS_CONNECT_URL
    ?? `${apiBaseUrl}/auth/meta/trends/start`;
}

function errorCode(error: unknown): TrendErrorCode {
  const message = error instanceof Error ? error.message : "";
  return (Object.keys(trendErrorCopy) as TrendErrorCode[]).find((code) => message.includes(code)) ?? "instagram_trend_fetch_failed";
}

function normalizedHashtag(value: string) {
  return value.trim().replace(/^#/, "");
}

function isInstagramConnected(channels: ChannelConnection[]) {
  return channels.some((channel) => channel.type === "instagram" && channel.status === "connected");
}

function recommendedHashtag(value: string) {
  return value
    .normalize("NFKC")
    .replace(/^#/, "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_]/gu, "");
}

function recommendationsForBrand(profile: BrandProfile | null, categories: ContentCategory[]) {
  const selectedCategory = categories.find((category) => category.code === profile?.primaryCategory?.code);
  const candidates = selectedCategory
    ? [...(profile?.subcategories.map((subcategory) => subcategory.name) ?? []), ...selectedCategory.recommendedHashtags]
    : categories.flatMap((category) => category.recommendedHashtags);
  return Array.from(new Set(candidates.map(recommendedHashtag).filter(Boolean))).slice(0, 6);
}

function applyLocalTrendView(
  result: InstagramTrendPage | null,
  type: InstagramTrendMediaTypeFilter,
  sort: InstagramTrendSort,
) {
  if (!result) return null;
  const items = (type === "all" ? result.items : result.items.filter((item) => item.kind === type)).slice();
  if (sort === "likes") items.sort((left, right) => (right.likeCount ?? 0) - (left.likeCount ?? 0));
  if (sort === "comments") items.sort((left, right) => (right.commentsCount ?? 0) - (left.commentsCount ?? 0));
  if (sort === "meta") items.sort((left, right) => left.metaRank - right.metaRank);
  return { ...result, page: 1, total: items.length, items };
}

export function InstagramTrendsPage() {
  const resultRequestId = useRef(0);
  const [channels, setChannels] = useState<ChannelConnection[]>([]);
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [brandProfile, setBrandProfile] = useState<BrandProfile | null>(null);
  const [trendConnection, setTrendConnection] = useState<InstagramTrendConnection | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<InstagramTrendMedia | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [deletingHistoryIds, setDeletingHistoryIds] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<ViewState>({
    hashtag: "",
    submittedHashtag: "",
    type: "all",
    sort: "meta",
    page: 1,
    result: null,
    histories: [],
    isSearching: false,
    isLoadingResults: false,
    error: null
  });

  useEffect(() => {
    let ignore = false;
    const requests = [
      api.listChannels(DEMO_BRAND_ID).then((items) => { if (!ignore) setChannels(items); }).catch(() => { if (!ignore) setChannels([]); }),
      api.listContentCategories().then((items) => { if (!ignore) setCategories(items); }).catch(() => { if (!ignore) setCategories([]); }),
      api.getBrandProfile(DEMO_BRAND_ID).then((profile) => { if (!ignore) setBrandProfile(profile); }).catch(() => { if (!ignore) setBrandProfile(null); }),
      api.getInstagramTrendConnection(DEMO_BRAND_ID).then((connection) => { if (!ignore) setTrendConnection(connection); }).catch(() => { if (!ignore) setTrendConnection({ status: "not_connected", accountLabel: null, instagramBusinessAccountId: null, scopes: [], expiresAt: null, lastErrorCode: null }); }),
      api.listInstagramTrendSearches(DEMO_BRAND_ID).then((items) => { if (!ignore) setView((current) => ({ ...current, histories: items })); }).catch(() => undefined)
    ];
    void Promise.allSettled(requests).then(() => { if (!ignore) setInitialLoading(false); });
    return () => { ignore = true; };
  }, []);

  const connected = isInstagramConnected(channels);
  const trendConnected = trendConnection?.status === "connected";
  const accountLinkRequired = new URLSearchParams(window.location.search).get("meta_trends") === "account_link_required";
  const recommendedHashtags = useMemo(() => recommendationsForBrand(brandProfile, categories), [brandProfile, categories]);
  const displayedResult = useMemo(
    () => applyLocalTrendView(view.result, view.type, view.sort),
    [view.result, view.type, view.sort],
  );
  const visibleItems = displayedResult?.items.slice(0, 20) ?? [];
  const hasVisibleResults = visibleItems.length > 0;
  const hasNextPage = Boolean(displayedResult && displayedResult.page * 20 < displayedResult.total);

  async function loadPage(
    hashtag: string,
    pageNumber: number,
    type = view.type,
    sort = view.sort,
    requestId = ++resultRequestId.current
  ) {
    try {
      const result = await api.getInstagramTrends(DEMO_BRAND_ID, { hashtag, type, sort, page: pageNumber });
      if (requestId !== resultRequestId.current) return null;
      setView((current) => ({ ...current, page: pageNumber, result, error: result.lastErrorCode ? trendErrorCopy[errorCode(new Error(result.lastErrorCode))] : null }));
      return result;
    } catch (error) {
      if (requestId !== resultRequestId.current) return null;
      setView((current) => ({ ...current, error: trendErrorCopy[errorCode(error)] }));
      return null;
    }
  }

  async function search(selectedHashtag = view.hashtag) {
    if (view.isSearching) return;
    const hashtag = normalizedHashtag(selectedHashtag);
    if (!hashtag) {
      setView((current) => ({ ...current, error: trendErrorCopy.invalid_hashtag }));
      return;
    }
    const requestId = ++resultRequestId.current;
    let refreshApplied = false;
    setView((current) => ({ ...current, submittedHashtag: hashtag, page: 1, isSearching: true, isLoadingResults: true, error: null }));
    const cachedPromise = api.getInstagramTrends(DEMO_BRAND_ID, { hashtag, type: view.type, sort: view.sort, page: 1 })
      .then((cached) => {
        if (requestId === resultRequestId.current && !refreshApplied) {
          setView((current) => ({ ...current, page: 1, result: cached, error: cached.lastErrorCode ? trendErrorCopy[errorCode(new Error(cached.lastErrorCode))] : null }));
        }
        return cached;
      })
      .catch(() => null);
    const refreshPromise = api.searchInstagramTrends(DEMO_BRAND_ID, hashtag);
    try {
      const refreshed = await refreshPromise;
      if (requestId !== resultRequestId.current) return;
      refreshApplied = true;
      setView((current) => ({ ...current, result: refreshed, page: 1, error: refreshed.lastErrorCode ? trendErrorCopy[errorCode(new Error(refreshed.lastErrorCode))] : null }));
      api.listInstagramTrendSearches(DEMO_BRAND_ID).then((items) => setView((current) => ({ ...current, histories: items }))).catch(() => undefined);
    } catch (error) {
      const cached = await cachedPromise;
      if (requestId !== resultRequestId.current) return;
      setView((current) => ({ ...current, result: cached ?? current.result, error: trendErrorCopy[errorCode(error)] }));
    } finally {
      if (requestId === resultRequestId.current) setView((current) => ({ ...current, isSearching: false, isLoadingResults: false }));
    }
  }

  function selectAndSearch(hashtag: string) {
    if (view.isSearching) return;
    setView((current) => ({ ...current, hashtag }));
    void search(hashtag);
  }

  async function deleteHistory(hashtagId: string) {
    if (view.isSearching || deletingHistoryIds.has(hashtagId)) return;
    const historyIndex = view.histories.findIndex((history) => history.hashtagId === hashtagId);
    const removedHistory = view.histories[historyIndex];
    if (!removedHistory) return;
    setDeletingHistoryIds((current) => new Set(current).add(hashtagId));
    setView((current) => ({
      ...current,
      error: null,
      histories: current.histories.filter((history) => history.hashtagId !== hashtagId)
    }));
    try {
      await api.deleteInstagramTrendSearch(DEMO_BRAND_ID, hashtagId);
    } catch {
      setView((current) => {
        if (current.histories.some((history) => history.hashtagId === hashtagId)) {
          return { ...current, error: "최근 검색어를 삭제하지 못했습니다. 다시 시도해 주세요." };
        }
        const histories = [...current.histories];
        histories.splice(Math.min(historyIndex, histories.length), 0, removedHistory);
        return { ...current, histories, error: "최근 검색어를 삭제하지 못했습니다. 다시 시도해 주세요." };
      });
    } finally {
      setDeletingHistoryIds((current) => {
        const next = new Set(current);
        next.delete(hashtagId);
        return next;
      });
    }
  }

  async function changeFilter(type: InstagramTrendMediaTypeFilter) {
    const requestId = ++resultRequestId.current;
    setView((current) => ({ ...current, type, page: 1, isLoadingResults: Boolean(view.submittedHashtag) }));
    if (view.submittedHashtag) await loadPage(view.submittedHashtag, 1, type, view.sort, requestId);
    if (requestId === resultRequestId.current) setView((current) => ({ ...current, isLoadingResults: false }));
  }

  async function changeSort(sort: InstagramTrendSort) {
    const requestId = ++resultRequestId.current;
    setView((current) => ({ ...current, sort, page: 1, isLoadingResults: Boolean(view.submittedHashtag) }));
    if (view.submittedHashtag) await loadPage(view.submittedHashtag, 1, view.type, sort, requestId);
    if (requestId === resultRequestId.current) setView((current) => ({ ...current, isLoadingResults: false }));
  }

  async function nextPage() {
    if (!view.submittedHashtag || !hasNextPage) return;
    const requestId = ++resultRequestId.current;
    setView((current) => ({ ...current, isLoadingResults: true }));
    await loadPage(view.submittedHashtag, view.page + 1, view.type, view.sort, requestId);
    if (requestId === resultRequestId.current) setView((current) => ({ ...current, isLoadingResults: false }));
  }

  async function bookmarkMedia(media: InstagramTrendMedia) {
    await api.saveInstagramTrendSource(DEMO_BRAND_ID, media.id);
    setView((current) => ({
      ...current,
      result: current.result ? { ...current.result, items: current.result.items.map((item) => item.id === media.id ? { ...item, isSaved: true } : item) } : null,
    }));
    setSelectedMedia((current) => current?.id === media.id ? { ...current, isSaved: true } : current);
  }

  async function unbookmarkMedia(media: InstagramTrendMedia) {
    await api.removeInstagramTrendSource(DEMO_BRAND_ID, media.id);
    setView((current) => ({
      ...current,
      result: current.result ? { ...current.result, items: current.result.items.map((item) => item.id === media.id ? { ...item, isSaved: false } : item) } : null,
    }));
    setSelectedMedia((current) => current?.id === media.id ? { ...current, isSaved: false } : current);
  }

  return (
    <section className="content trend-page">
      <PageHeader title="Instagram 트렌드 탐색" description="공개 Instagram 해시태그 결과를 확인하고 콘텐츠 참고 소스로 저장합니다." />
      {initialLoading ? (
        <PageSkeleton label="트렌드 탐색을 준비하는 중입니다." />
      ) : !connected ? (
        <section className="panel"><div className="panel-body"><Alert title="Instagram 연결 필요" variant="warn">{trendErrorCopy.instagram_connection_required} <a className="button" href="/channels">채널에서 연결하기</a></Alert></div></section>
      ) : !trendConnected ? (
        <section className="panel"><div className="panel-body"><Alert title="트렌드용 Meta 연결 필요" variant="warn">
          {accountLinkRequired
            ? trendErrorCopy.meta_instagram_account_link_required
            : trendConnection?.status === "expired" || trendConnection?.status === "needs_attention"
            ? trendErrorCopy.instagram_trend_reconnect_required
            : trendErrorCopy.instagram_trend_connection_required}{" "}
          {accountLinkRequired ? (
            <span className="trend-connection-actions">
              <a className="button" href={metaBusinessInstagramSettingsUrl} target="_blank" rel="noreferrer">Meta Business에서 설정</a>
              <a className="button" href={trendOauthStartUrl()}>설정 완료 후 다시 연결</a>
            </span>
          ) : <a className="button" href={trendOauthStartUrl()}>Meta 권한 연결</a>}
        </Alert></div></section>
      ) : (
        <>
          <section className="panel trend-search-panel">
            <div className="panel-body grid">
              <form className="trend-search-form" aria-busy={view.isLoadingResults} onSubmit={(event) => { event.preventDefault(); void search(); }}>
                <div className="trend-search-box">
                  <Search size={18} aria-hidden="true" />
                  <label className="visually-hidden" htmlFor="trend-hashtag">해시태그</label>
                  <input id="trend-hashtag" value={view.hashtag} onChange={(event) => setView((current) => ({ ...current, hashtag: event.target.value }))} placeholder="#해시태그" />
                  <button className="button primary trend-search-submit" type="submit" aria-label="검색" disabled={view.isSearching}>
                    {view.isSearching ? <InlineSpinner label="검색 중" /> : null}
                    <span>검색</span>
                  </button>
                </div>
              </form>
              <div className="trend-history-row">
                <span className="muted">추천</span>
                {recommendedHashtags.map((hashtag) => (
                  <button className="trend-tag" disabled={view.isSearching} type="button" key={hashtag} onClick={() => selectAndSearch(`#${hashtag.replace(/^#/, "")}`)}>#{hashtag.replace(/^#/, "")}</button>
                ))}
              </div>
              {view.histories.length > 0 ? <div className="trend-history-row"><span className="muted">최근</span>{view.histories.slice(0, 6).map((history) => <span className="trend-history-tag" key={history.hashtagId}><button className="trend-tag" disabled={view.isSearching} type="button" onClick={() => selectAndSearch(history.displayTag)}>{history.displayTag}</button><button className="trend-history-delete" type="button" disabled={view.isSearching || deletingHistoryIds.has(history.hashtagId)} aria-label={`최근 검색 ${history.displayTag} 삭제`} title="최근 검색 삭제" onClick={() => void deleteHistory(history.hashtagId)}><X size={14} aria-hidden="true" /></button></span>)}</div> : null}
              <span className="muted small">마지막 새로고침: {view.result?.refreshedAt ? new Date(view.result.refreshedAt).toLocaleString("ko-KR") : "-"}</span>
            </div>
          </section>
          {!view.isLoadingResults && view.error ? <Alert title="트렌드 탐색 상태" variant="warn">{view.error}</Alert> : null}
          <div className="trend-controls" aria-label="트렌드 결과 필터">
            <div className="trend-filter-group" role="group" aria-label="미디어 유형">
              {filterOptions.map((option) => <button className="tab" type="button" key={option.value} disabled={view.isSearching} aria-pressed={view.type === option.value} onClick={() => void changeFilter(option.value)}>{option.label}</button>)}
            </div>
            <label className="trend-sort">정렬<select aria-label="정렬" disabled={view.isSearching} value={view.sort} onChange={(event) => void changeSort(event.target.value as InstagramTrendSort)}><option value="meta">Meta 추천순</option><option value="likes">좋아요순</option><option value="comments">댓글순</option></select></label>
          </div>
          {view.isLoadingResults && !hasVisibleResults ? <div className="trend-results trend-results--loading"><LoadingOverlay label="최신 Instagram 데이터를 확인하는 중입니다." /></div> : null}
          {!view.isLoadingResults && view.submittedHashtag && view.result && !hasVisibleResults ? <EmptyState title="검색 결과가 없습니다." description="다른 해시태그를 검색해 보세요." /> : null}
          {hasVisibleResults ? <div className="trend-results">
            <div className="trend-media-grid">{visibleItems.map((item) => <TrendMediaCard key={item.id} media={item} onSelect={setSelectedMedia} onBookmark={bookmarkMedia} onUnbookmark={unbookmarkMedia} />)}</div>
            {hasNextPage ? <div className="trend-pagination"><button className="button" type="button" disabled={view.isSearching} onClick={() => void nextPage()}>다음 20개</button></div> : null}
            {view.isLoadingResults ? <LoadingOverlay label="최신 Instagram 데이터를 확인하는 중입니다." /> : null}
          </div> : null}
          {selectedMedia ? <TrendMediaDetailDialog media={selectedMedia} onClose={() => setSelectedMedia(null)} onSave={() => api.saveInstagramTrendSource(DEMO_BRAND_ID, selectedMedia.id)} /> : null}
        </>
      )}
    </section>
  );
}
