import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { TrendMediaCard } from "../components/trends/TrendMediaCard";
import { TrendMediaDetailDialog } from "../components/trends/TrendMediaDetailDialog";
import { Alert } from "../components/ui/Alert";
import { EmptyState } from "../components/ui/EmptyState";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type {
  ChannelConnection,
  ContentCategory,
  InstagramTrendMedia,
  InstagramTrendMediaTypeFilter,
  InstagramTrendPage,
  InstagramTrendSearchHistory,
  InstagramTrendSort
} from "../types";

export const trendErrorCopy = {
  instagram_connection_required: "Instagram 채널을 먼저 연결하세요.",
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

export function InstagramTrendsPage() {
  const [channels, setChannels] = useState<ChannelConnection[]>([]);
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<InstagramTrendMedia | null>(null);
  const [view, setView] = useState<ViewState>({
    hashtag: "",
    submittedHashtag: "",
    type: "all",
    sort: "meta",
    page: 1,
    result: null,
    histories: [],
    isSearching: false,
    error: null
  });

  useEffect(() => {
    let ignore = false;
    api.listChannels(DEMO_BRAND_ID).then((items) => { if (!ignore) setChannels(items); }).catch(() => { if (!ignore) setChannels([]); });
    api.listContentCategories().then((items) => { if (!ignore) setCategories(items); }).catch(() => { if (!ignore) setCategories([]); });
    api.listInstagramTrendSearches(DEMO_BRAND_ID).then((items) => { if (!ignore) setView((current) => ({ ...current, histories: items })); }).catch(() => undefined);
    return () => { ignore = true; };
  }, []);

  const connected = isInstagramConnected(channels);
  const visibleItems = useMemo(() => view.result?.items.slice(0, 20) ?? [], [view.result]);
  const hasNextPage = Boolean(view.result && view.result.page * 20 < view.result.total);

  async function loadPage(hashtag: string, pageNumber: number, type = view.type, sort = view.sort) {
    try {
      const result = await api.getInstagramTrends(DEMO_BRAND_ID, { hashtag, type, sort, page: pageNumber });
      setView((current) => ({ ...current, page: pageNumber, result, error: result.lastErrorCode ? trendErrorCopy[errorCode(new Error(result.lastErrorCode))] : null }));
      return result;
    } catch (error) {
      setView((current) => ({ ...current, error: trendErrorCopy[errorCode(error)] }));
      return null;
    }
  }

  async function search() {
    const hashtag = normalizedHashtag(view.hashtag);
    if (!hashtag) {
      setView((current) => ({ ...current, error: trendErrorCopy.invalid_hashtag }));
      return;
    }
    setView((current) => ({ ...current, submittedHashtag: hashtag, page: 1, isSearching: true, error: null }));
    const cached = await loadPage(hashtag, 1);
    try {
      const refreshed = await api.searchInstagramTrends(DEMO_BRAND_ID, hashtag);
      setView((current) => ({ ...current, result: refreshed, page: 1, error: refreshed.lastErrorCode ? trendErrorCopy[errorCode(new Error(refreshed.lastErrorCode))] : null }));
      api.listInstagramTrendSearches(DEMO_BRAND_ID).then((items) => setView((current) => ({ ...current, histories: items }))).catch(() => undefined);
    } catch (error) {
      setView((current) => ({ ...current, result: cached ?? current.result, error: trendErrorCopy[errorCode(error)] }));
    } finally {
      setView((current) => ({ ...current, isSearching: false }));
    }
  }

  async function changeFilter(type: InstagramTrendMediaTypeFilter) {
    setView((current) => ({ ...current, type, page: 1 }));
    if (view.submittedHashtag) await loadPage(view.submittedHashtag, 1, type, view.sort);
  }

  async function changeSort(sort: InstagramTrendSort) {
    setView((current) => ({ ...current, sort, page: 1 }));
    if (view.submittedHashtag) await loadPage(view.submittedHashtag, 1, view.type, sort);
  }

  async function nextPage() {
    if (!view.submittedHashtag || !hasNextPage) return;
    await loadPage(view.submittedHashtag, view.page + 1);
  }

  return (
    <section className="content trend-page">
      <PageHeader title="Instagram 트렌드 탐색" description="공개 Instagram 해시태그 결과를 확인하고 콘텐츠 참고 소스로 저장합니다." />
      {!connected ? (
        <section className="panel"><div className="panel-body"><Alert title="Instagram 연결 필요" variant="warn">{trendErrorCopy.instagram_connection_required} <a className="button" href="/channels">채널에서 연결하기</a></Alert></div></section>
      ) : (
        <>
          <section className="panel trend-search-panel">
            <div className="panel-body grid">
              <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void search(); }}>
                <label className="sr-only" htmlFor="trend-hashtag">해시태그</label>
                <input id="trend-hashtag" value={view.hashtag} onChange={(event) => setView((current) => ({ ...current, hashtag: event.target.value }))} placeholder="#해시태그" />
                <button className="button primary" type="submit" disabled={view.isSearching}>검색</button>
              </form>
              <div className="trend-history-row">
                <span className="muted">추천</span>
                {categories.flatMap((category) => category.recommendedHashtags).slice(0, 6).map((hashtag) => (
                  <button className="trend-text-action" type="button" key={hashtag} onClick={() => setView((current) => ({ ...current, hashtag: `#${hashtag.replace(/^#/, "")}` }))}>#{hashtag.replace(/^#/, "")}</button>
                ))}
              </div>
              {view.histories.length > 0 ? <div className="trend-history-row"><span className="muted">최근</span>{view.histories.slice(0, 6).map((history) => <button className="trend-text-action" key={history.hashtagId} type="button" onClick={() => setView((current) => ({ ...current, hashtag: history.displayTag }))}>{history.displayTag}</button>)}</div> : null}
              <span className="muted small">마지막 새로고침: {view.result?.refreshedAt ? new Date(view.result.refreshedAt).toLocaleString("ko-KR") : "-"}</span>
            </div>
          </section>
          {view.error ? <Alert title="트렌드 탐색 상태" variant="warn">{view.error}</Alert> : null}
          {view.isSearching ? <div className="trend-loading" role="status">최신 Instagram 데이터를 확인하는 중입니다.</div> : null}
          <div className="trend-controls" aria-label="트렌드 결과 필터">
            <div className="trend-filter-group" role="group" aria-label="미디어 유형">
              {filterOptions.map((option) => <button className="tab" type="button" key={option.value} aria-pressed={view.type === option.value} onClick={() => void changeFilter(option.value)}>{option.label}</button>)}
            </div>
            <label className="trend-sort">정렬<select aria-label="정렬" value={view.sort} onChange={(event) => void changeSort(event.target.value as InstagramTrendSort)}><option value="meta">Meta 추천순</option><option value="likes">좋아요순</option><option value="comments">댓글순</option></select></label>
          </div>
          {view.submittedHashtag && view.result && visibleItems.length === 0 ? <EmptyState title="검색 결과가 없습니다." description="다른 해시태그를 검색해 보세요." /> : null}
          {visibleItems.length > 0 ? <>
            <div className="trend-media-grid">{visibleItems.map((item) => <TrendMediaCard key={item.id} media={item} onSelect={setSelectedMedia} />)}</div>
            {hasNextPage ? <div className="trend-pagination"><button className="button" type="button" onClick={() => void nextPage()}>다음 20개</button></div> : null}
          </> : null}
          {selectedMedia ? <TrendMediaDetailDialog media={selectedMedia} onClose={() => setSelectedMedia(null)} onSave={() => api.saveInstagramTrendSource(DEMO_BRAND_ID, selectedMedia.id)} /> : null}
        </>
      )}
    </section>
  );
}
