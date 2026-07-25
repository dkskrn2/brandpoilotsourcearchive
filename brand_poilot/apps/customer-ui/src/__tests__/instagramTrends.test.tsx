import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelConnection, ContentCategory, InstagramTrendMedia, InstagramTrendPage } from "../types";

const connectedInstagram: ChannelConnection = {
  type: "instagram",
  label: "Instagram",
  enabled: true,
  oauthState: "connected",
  status: "connected",
  accountLabel: "@brand",
  lastHealthyAt: "2026-07-15T09:00:00.000Z",
  lastPublishedAt: "-"
};

const categories: ContentCategory[] = [{
  code: "travel",
  name: "여행",
  recommendedHashtags: ["여행콘텐츠", "제주여행"],
  subcategories: []
}];

function media(index: number, overrides: Partial<InstagramTrendMedia> = {}): InstagramTrendMedia {
  return {
    id: `media-${index}`,
    instagramMediaId: `ig-${index}`,
    username: `creator${index}`,
    caption: `캡션 ${index}`,
    kind: "image",
    mediaUrl: `https://cdn.example.com/${index}.jpg`,
    previewUrl: null,
    permalink: `https://www.instagram.com/p/${index}`,
    postedAt: "2026-07-15T08:00:00.000Z",
    likeCount: index,
    commentsCount: index + 1,
    metaRank: index,
    refreshedAt: "2026-07-15T09:00:00.000Z",
    isSaved: false,
    ...overrides
  };
}

function page(items: InstagramTrendMedia[], overrides: Partial<InstagramTrendPage> = {}): InstagramTrendPage {
  return {
    hashtag: { id: "hashtag-1", displayTag: "#여행콘텐츠", normalizedTag: "여행콘텐츠" },
    source: "cache",
    refreshed: false,
    refreshedAt: "2026-07-15T09:00:00.000Z",
    lastErrorCode: null,
    page: 1,
    pageSize: 20,
    total: items.length,
    items,
    ...overrides
  };
}

type ApiMock = Record<string, ReturnType<typeof vi.fn>>;

async function renderTrendPage(overrides: Partial<ApiMock> = {}) {
  const api: ApiMock = {
    listChannels: vi.fn(async () => [connectedInstagram]),
    listContentCategories: vi.fn(async () => categories),
    getInstagramTrendConnection: vi.fn(async () => ({
      status: "connected",
      accountLabel: "@brand",
      instagramBusinessAccountId: "ig-1",
      scopes: ["instagram_basic"],
      expiresAt: null,
      lastErrorCode: null
    })),
    getBrandProfile: vi.fn(async () => ({
      primaryCategory: { code: "travel", name: "여행" },
      subcategories: []
    })),
    listInstagramTrendSearches: vi.fn(async () => []),
    deleteInstagramTrendSearch: vi.fn(async (_brandId: string, hashtagId: string) => ({ hashtagId })),
    getInstagramTrends: vi.fn(async () => page([])),
    searchInstagramTrends: vi.fn(async () => page([])),
    saveInstagramTrendSource: vi.fn(async (_brandId: string, mediaId: string) => ({
      source: {
        id: `source-${mediaId}`,
        brandId: "brand-1",
        sourceType: "reference",
        url: `https://www.instagram.com/p/${mediaId}`,
        title: null,
        status: "active",
        enabled: true,
        lastCrawledAt: null,
        lastError: null
      },
      alreadySaved: false
    })),
    ...overrides
  };
  vi.doMock("../lib/apiClient", () => ({ DEMO_BRAND_ID: "brand-1", api }));
  const { InstagramTrendsPage } = await import("../pages/InstagramTrendsPage");
  render(<InstagramTrendsPage />);
  return api;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("InstagramTrendsPage", () => {
  it("shows a page skeleton while channel and trend connection state is loading", async () => {
    const pending = new Promise<never>(() => undefined);
    await renderTrendPage({
      listChannels: vi.fn(() => pending),
      listContentCategories: vi.fn(() => pending),
      getBrandProfile: vi.fn(() => pending),
      getInstagramTrendConnection: vi.fn(() => pending),
      listInstagramTrendSearches: vi.fn(() => pending)
    });

    expect(screen.getByRole("status", { name: "트렌드 탐색을 준비하는 중입니다." })).toHaveClass("skeleton-page");
    expect(screen.queryByRole("textbox", { name: "해시태그" })).not.toBeInTheDocument();
  });

  it("keeps the accessible hashtag label visually hidden inside the unified search field", async () => {
    await renderTrendPage();

    expect(await screen.findByText("해시태그", { selector: "label" })).toHaveClass("visually-hidden");
  });

  it("shows the disconnected Instagram state with a channels action", async () => {
    await renderTrendPage({
      listChannels: vi.fn(async () => [{ ...connectedInstagram, status: "not_connected" }])
    });

    expect(await screen.findByText("Instagram 채널을 먼저 연결하세요.")).toBeVisible();
    expect(screen.getByRole("link", { name: "채널에서 연결하기" })).toHaveAttribute("href", "/channels");
  });

  it("requests a separate Meta connection when hashtag search permission is missing", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");
    vi.stubEnv("VITE_META_TRENDS_CONNECT_URL", "https://api.example.com/auth/meta/trends/start");
    await renderTrendPage({
      getInstagramTrendConnection: vi.fn(async () => ({
        status: "not_connected",
        accountLabel: null,
        instagramBusinessAccountId: null,
        scopes: [],
        expiresAt: null,
        lastErrorCode: null
      }))
    });

    expect(await screen.findByText("트렌드 검색용 Meta 권한 연결이 필요합니다.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Meta 권한 연결" })).toHaveAttribute("href", "https://api.example.com/auth/meta/trends/start");
    expect(screen.queryByRole("textbox", { name: "해시태그" })).not.toBeInTheDocument();
  });

  it("uses the configured Meta OAuth server even when the data API is local", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:4000");
    vi.stubEnv("VITE_META_TRENDS_CONNECT_URL", "https://api.example.com/auth/meta/trends/start");
    await renderTrendPage({
      getInstagramTrendConnection: vi.fn(async () => ({
        status: "not_connected",
        accountLabel: null,
        instagramBusinessAccountId: null,
        scopes: [],
        expiresAt: null,
        lastErrorCode: null
      }))
    });

    expect(await screen.findByRole("link", { name: "Meta 권한 연결" })).toHaveAttribute(
      "href",
      "https://api.example.com/auth/meta/trends/start"
    );
  });

  it("explains how to repair a Page and Instagram account link failure", async () => {
    window.history.replaceState({}, "", "/instagram-trends?meta_trends=account_link_required");
    await renderTrendPage({
      getInstagramTrendConnection: vi.fn(async () => ({
        status: "not_connected",
        accountLabel: null,
        instagramBusinessAccountId: null,
        scopes: [],
        expiresAt: null,
        lastErrorCode: null
      }))
    });

    expect(await screen.findByText("Instagram 전문 계정을 Facebook Page에 연결하고 Meta Business에서 계정 로그인을 완료한 뒤 다시 연결하세요.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Meta Business에서 설정" })).toHaveAttribute(
      "href",
      "https://business.facebook.com/latest/settings/instagram_account"
    );
    expect(screen.getByRole("link", { name: "Meta Business에서 설정" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "설정 완료 후 다시 연결" })).toBeVisible();
    window.history.replaceState({}, "", "/instagram-trends");
  });

  it("searches immediately when a recommended hashtag is clicked", async () => {
    const result = page([media(1)]);
    const api = await renderTrendPage({
      getInstagramTrends: vi.fn(async () => result),
      searchInstagramTrends: vi.fn(async () => result)
    });
    const input = await screen.findByRole("textbox", { name: "해시태그" });

    await userEvent.click(screen.getByRole("button", { name: "#여행콘텐츠" }));

    expect(input).toHaveValue("#여행콘텐츠");
    expect(api.getInstagramTrends).toHaveBeenCalledWith("brand-1", expect.objectContaining({ hashtag: "여행콘텐츠", page: 1 }));
    expect(api.searchInstagramTrends).toHaveBeenCalledWith("brand-1", "여행콘텐츠");
    expect(await screen.findByText("@creator1")).toBeVisible();
  });

  it("searches immediately when a recent hashtag is clicked", async () => {
    const result = page([media(2)]);
    const api = await renderTrendPage({
      listInstagramTrendSearches: vi.fn(async () => [{
        hashtagId: "hashtag-1",
        displayTag: "#최근마케팅",
        normalizedTag: "최근마케팅",
        searchedAt: "2026-07-15T09:00:00.000Z"
      }]),
      getInstagramTrends: vi.fn(async () => result),
      searchInstagramTrends: vi.fn(async () => result)
    });

    await userEvent.click(await screen.findByRole("button", { name: "#최근마케팅" }));

    expect(api.getInstagramTrends).toHaveBeenCalledWith("brand-1", expect.objectContaining({ hashtag: "최근마케팅", page: 1 }));
    expect(api.searchInstagramTrends).toHaveBeenCalledWith("brand-1", "최근마케팅");
  });

  it("deletes one recent search without running it", async () => {
    const api = await renderTrendPage({
      listInstagramTrendSearches: vi.fn(async () => [{
        hashtagId: "hashtag-1",
        displayTag: "#최근마케팅",
        isFavorite: false,
        lastSearchedAt: "2026-07-15T09:00:00.000Z",
        searchCount: 1
      }])
    });

    await userEvent.click(await screen.findByRole("button", { name: "최근 검색 #최근마케팅 삭제" }));

    expect(api.deleteInstagramTrendSearch).toHaveBeenCalledWith("brand-1", "hashtag-1");
    expect(screen.queryByRole("button", { name: "#최근마케팅" })).not.toBeInTheDocument();
    expect(api.searchInstagramTrends).not.toHaveBeenCalled();
  });

  it("hides a recent search before the delete request resolves", async () => {
    let resolveDelete: (() => void) | undefined;
    await renderTrendPage({
      listInstagramTrendSearches: vi.fn(async () => [{
        hashtagId: "hashtag-1", displayTag: "#즉시삭제", isFavorite: false,
        lastSearchedAt: "2026-07-15T09:00:00.000Z", searchCount: 1,
      }]),
      deleteInstagramTrendSearch: vi.fn(() => new Promise<{ hashtagId: string }>((resolve) => {
        resolveDelete = () => resolve({ hashtagId: "hashtag-1" });
      })),
    });

    await userEvent.click(await screen.findByRole("button", { name: "최근 검색 #즉시삭제 삭제" }));
    expect(screen.queryByRole("button", { name: "#즉시삭제" })).not.toBeInTheDocument();
    resolveDelete?.();
  });

  it("keeps a recent search and shows the trend error area when deletion fails", async () => {
    await renderTrendPage({
      listInstagramTrendSearches: vi.fn(async () => [{
        hashtagId: "hashtag-1",
        displayTag: "#최근마케팅",
        isFavorite: false,
        lastSearchedAt: "2026-07-15T09:00:00.000Z",
        searchCount: 1
      }]),
      deleteInstagramTrendSearch: vi.fn(async () => { throw new Error("network_error"); })
    });

    await userEvent.click(await screen.findByRole("button", { name: "최근 검색 #최근마케팅 삭제" }));

    expect(await screen.findByText("최근 검색어를 삭제하지 못했습니다. 다시 시도해 주세요.")).toBeVisible();
    expect(screen.getByRole("button", { name: "#최근마케팅" })).toBeVisible();
  });

  it("allows concurrent recent-search deletes and restores only the failed item", async () => {
    let rejectFirst: ((reason: Error) => void) | undefined;
    let resolveSecond: ((value: { hashtagId: string }) => void) | undefined;
    await renderTrendPage({
      listInstagramTrendSearches: vi.fn(async () => [
        { hashtagId: "hashtag-1", displayTag: "#첫번째", isFavorite: false, lastSearchedAt: "2026-07-15T09:00:00.000Z", searchCount: 1 },
        { hashtagId: "hashtag-2", displayTag: "#두번째", isFavorite: false, lastSearchedAt: "2026-07-15T08:00:00.000Z", searchCount: 1 },
      ]),
      deleteInstagramTrendSearch: vi.fn((_brandId: string, hashtagId: string) => new Promise<{ hashtagId: string }>((resolve, reject) => {
        if (hashtagId === "hashtag-1") rejectFirst = reject;
        else resolveSecond = resolve;
      })),
    });

    await userEvent.click(await screen.findByRole("button", { name: "최근 검색 #첫번째 삭제" }));
    await userEvent.click(screen.getByRole("button", { name: "최근 검색 #두번째 삭제" }));
    expect(screen.queryByRole("button", { name: "#첫번째" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "#두번째" })).not.toBeInTheDocument();

    await act(async () => {
      resolveSecond?.({ hashtagId: "hashtag-2" });
      rejectFirst?.(new Error("network_error"));
    });

    expect(await screen.findByRole("button", { name: "#첫번째" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "#두번째" })).not.toBeInTheDocument();
  });

  it("shows a loader and hides stale errors while a recommended search is pending", async () => {
    let rejectSearch: ((reason: Error) => void) | undefined;
    const api = await renderTrendPage({
      getInstagramTrends: vi.fn(async () => page([], { lastErrorCode: "instagram_trend_fetch_failed" })),
      searchInstagramTrends: vi.fn(() => new Promise<InstagramTrendPage>((_resolve, reject) => { rejectSearch = reject; }))
    });

    const tag = await screen.findByRole("button", { name: "#여행콘텐츠" });
    await userEvent.click(tag);

    expect(api.searchInstagramTrends).toHaveBeenCalledTimes(1);
    expect(api.searchInstagramTrends).toHaveBeenCalledWith("brand-1", "여행콘텐츠");
    expect(screen.getByRole("textbox", { name: "해시태그" })).toHaveValue("#여행콘텐츠");
    expect(screen.getByRole("status", { name: "최신 Instagram 데이터를 확인하는 중입니다." })).toBeVisible();
    expect(screen.queryByText("Instagram 최신 데이터를 가져오지 못했습니다. 저장된 결과가 있으면 그대로 표시합니다.")).not.toBeInTheDocument();
    expect(tag).toBeDisabled();
    expect(screen.getByRole("button", { name: "검색" })).toBeDisabled();

    await act(async () => rejectSearch?.(new Error("instagram_trend_fetch_failed")));
    expect(await screen.findByText("Instagram 최신 데이터를 가져오지 못했습니다. 저장된 결과가 있으면 그대로 표시합니다.")).toBeVisible();
  });

  it("rebuilds recommendations from the brand's selected primary and detailed categories", async () => {
    await renderTrendPage({
      getBrandProfile: vi.fn(async () => ({
        primaryCategory: { code: "business", name: "비즈니스" },
        subcategories: [{ type: "system", code: "marketing_consulting", name: "마케팅 컨설팅" }]
      })),
      listContentCategories: vi.fn(async () => ([
        ...categories,
        {
          code: "business",
          name: "비즈니스",
          recommendedHashtags: ["마케팅", "브랜딩"],
          subcategories: [{ code: "marketing_consulting", name: "마케팅 컨설팅" }]
        }
      ]))
    });

    expect(await screen.findByRole("button", { name: "#마케팅컨설팅" })).toBeVisible();
    expect(screen.getByRole("button", { name: "#마케팅" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "#여행콘텐츠" })).not.toBeInTheDocument();
  });

  it("renders cached rows while the search refresh is pending", async () => {
    let resolveSearch: ((result: InstagramTrendPage) => void) | undefined;
    const cached = page([media(1)]);
    const api = await renderTrendPage({
      getInstagramTrends: vi.fn(async () => cached),
      searchInstagramTrends: vi.fn(() => new Promise<InstagramTrendPage>((resolve) => { resolveSearch = resolve; }))
    });

    const input = await screen.findByRole("textbox", { name: "해시태그" });
    await userEvent.type(input, "#여행콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));

    expect(api.getInstagramTrends).toHaveBeenCalledWith("brand-1", expect.objectContaining({ hashtag: "여행콘텐츠", page: 1 }));
    expect(api.searchInstagramTrends).toHaveBeenCalledWith("brand-1", "여행콘텐츠");
    expect(await screen.findByText("@creator1")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("최신 Instagram 데이터를 확인하는 중입니다.");

    await act(async () => resolveSearch?.(page([media(2)], { source: "meta", refreshed: true })));
    expect(await screen.findByText("@creator2")).toBeVisible();
    expect(screen.queryByText("@creator1")).not.toBeInTheDocument();
  });

  it("starts the Meta refresh without waiting for the cached query", async () => {
    let resolveCached: ((result: InstagramTrendPage) => void) | undefined;
    const searchInstagramTrends = vi.fn(async () => page([media(2)], { source: "meta", refreshed: true }));
    await renderTrendPage({
      getInstagramTrends: vi.fn(() => new Promise<InstagramTrendPage>((resolve) => { resolveCached = resolve; })),
      searchInstagramTrends
    });

    await userEvent.type(await screen.findByRole("textbox", { name: "해시태그" }), "여행콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));

    expect(searchInstagramTrends).toHaveBeenCalledWith("brand-1", "여행콘텐츠");
    await act(async () => resolveCached?.(page([media(1)])));
    expect(await screen.findByText("@creator2")).toBeVisible();
  });

  it("keeps stale rows and shows a non-blocking error when refresh fails", async () => {
    const cached = page([media(1)]);
    const api = await renderTrendPage({
      getInstagramTrends: vi.fn(async () => cached),
      searchInstagramTrends: vi.fn(async () => { throw new Error("instagram_trend_fetch_failed"); })
    });
    const input = await screen.findByRole("textbox", { name: "해시태그" });
    await userEvent.type(input, "여행콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));

    expect(await screen.findByText("@creator1")).toBeVisible();
    expect(await screen.findByText("Instagram 최신 데이터를 가져오지 못했습니다. 저장된 결과가 있으면 그대로 표시합니다.")).toBeVisible();
    expect(api.searchInstagramTrends).toHaveBeenCalledTimes(1);
  });

  it("supports every media filter and sort", async () => {
    const seeded = page([media(1)]);
    const api = await renderTrendPage({
      getInstagramTrends: vi.fn(async () => seeded),
      searchInstagramTrends: vi.fn(async () => seeded)
    });
    const input = await screen.findByRole("textbox", { name: "해시태그" });
    await userEvent.type(input, "여행콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    await screen.findByText("@creator1");

    for (const filter of ["전체", "이미지", "캐러셀", "영상", "릴스"]) {
      await userEvent.click(screen.getByRole("button", { name: filter }));
    }
    const sort = screen.getByRole("combobox", { name: "정렬" });
    for (const value of ["meta", "likes", "comments"]) {
      await userEvent.selectOptions(sort, value);
    }

    expect(api.getInstagramTrends).toHaveBeenCalledWith("brand-1", expect.objectContaining({ type: "reel", sort: "comments" }));
  });

  it("shows a result loader while a media filter is loading", async () => {
    let resolveImage: ((result: InstagramTrendPage) => void) | undefined;
    const seeded = page([media(1)]);
    const getInstagramTrends = vi.fn(async (_brandId: string, query: { type: string }) => {
      if (query.type === "image") return new Promise<InstagramTrendPage>((resolve) => { resolveImage = resolve; });
      return seeded;
    });
    await renderTrendPage({ getInstagramTrends, searchInstagramTrends: vi.fn(async () => seeded) });
    await userEvent.type(await screen.findByRole("textbox", { name: "해시태그" }), "여행콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    await screen.findByText("@creator1");

    await userEvent.click(screen.getByRole("button", { name: "이미지" }));

    expect(screen.getByRole("status")).toHaveTextContent("최신 Instagram 데이터를 확인하는 중입니다.");
    await act(async () => resolveImage?.(page([media(2)])));
    expect(await screen.findByText("@creator2")).toBeVisible();
  });

  it("does not let an older filter response replace the latest selection", async () => {
    let resolveImage: ((result: InstagramTrendPage) => void) | undefined;
    let resolveReel: ((result: InstagramTrendPage) => void) | undefined;
    const seeded = page([media(1)]);
    const getInstagramTrends = vi.fn(async (_brandId: string, query: { type: string }) => {
      if (query.type === "image") return new Promise<InstagramTrendPage>((resolve) => { resolveImage = resolve; });
      if (query.type === "reel") return new Promise<InstagramTrendPage>((resolve) => { resolveReel = resolve; });
      return seeded;
    });
    await renderTrendPage({ getInstagramTrends, searchInstagramTrends: vi.fn(async () => seeded) });
    await userEvent.type(await screen.findByRole("textbox", { name: "해시태그" }), "여행콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    await screen.findByText("@creator1");

    await userEvent.click(screen.getByRole("button", { name: "이미지" }));
    await userEvent.click(screen.getByRole("button", { name: "릴스" }));
    await act(async () => resolveReel?.(page([media(3, { kind: "reel" })])));
    expect(await screen.findByText("@creator3")).toBeVisible();
    await act(async () => resolveImage?.(page([media(2, { kind: "image" })])));

    expect(screen.getByText("@creator3")).toBeVisible();
    expect(screen.queryByText("@creator2")).not.toBeInTheDocument();
  });

  it("shows 20 client rows and requests the next page from the database", async () => {
    const firstPage = page(Array.from({ length: 21 }, (_, index) => media(index + 1)), { total: 21 });
    const secondPage = page([media(22)], { page: 2, total: 22 });
    const getInstagramTrends = vi.fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);
    const api = await renderTrendPage({ getInstagramTrends, searchInstagramTrends: vi.fn(async () => firstPage) });
    const input = await screen.findByRole("textbox", { name: "해시태그" });
    await userEvent.type(input, "여행콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));

    expect((await screen.findAllByRole("button", { name: /상세 보기/ })).length).toBe(20);
    await userEvent.click(screen.getByRole("button", { name: "다음 20개" }));
    expect(api.getInstagramTrends).toHaveBeenLastCalledWith("brand-1", expect.objectContaining({ page: 2 }));
    expect(api.searchInstagramTrends).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("@creator22")).toBeVisible();
  });

  it("opens media details and saves a source idempotently", async () => {
    const item = media(1, { kind: "carousel", caption: "상세 캡션", likeCount: null });
    const api = await renderTrendPage({ getInstagramTrends: vi.fn(async () => page([item])), searchInstagramTrends: vi.fn(async () => page([item])) });
    const input = await screen.findByRole("textbox", { name: "해시태그" });
    await userEvent.type(input, "여행콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    await userEvent.click(await screen.findByRole("button", { name: "상세 보기 @creator1" }));

    const dialog = screen.getByRole("dialog", { name: "Instagram 트렌드 상세" });
    expect(within(dialog).getByText("상세 캡션")).toBeVisible();
    expect(within(dialog).queryByText(/좋아요/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Instagram에서 보기" })).toHaveAttribute("target", "_blank");
    expect(within(dialog).getByRole("link", { name: "Instagram에서 보기" })).toHaveAttribute("rel", "noreferrer");

    await userEvent.click(within(dialog).getByRole("button", { name: "참고 소스로 저장" }));
    expect(await within(dialog).findByRole("button", { name: "저장됨" })).toBeDisabled();
    expect(api.saveInstagramTrendSource).toHaveBeenCalledWith("brand-1", "media-1");
  });

  it("does not present a fabricated author when Meta omits the username", async () => {
    const item = media(1, { username: null });
    await renderTrendPage({
      getInstagramTrends: vi.fn(async () => page([item])),
      searchInstagramTrends: vi.fn(async () => page([item]))
    });
    await userEvent.type(await screen.findByRole("textbox", { name: "해시태그" }), "여행콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));

    const card = await screen.findByRole("button", { name: "Instagram 인기 콘텐츠 상세 보기" });
    expect(within(card).getByText("Instagram 인기 콘텐츠")).toBeVisible();
    expect(screen.queryByText("@알 수 없음")).not.toBeInTheDocument();

    await userEvent.click(card);
    expect(within(screen.getByRole("dialog", { name: "Instagram 트렌드 상세" })).getByText("Instagram 인기 콘텐츠 · 이미지")).toBeVisible();
  });

  it("shows a retryable error when saving a source fails", async () => {
    const item = media(1);
    await renderTrendPage({
      getInstagramTrends: vi.fn(async () => page([item])),
      searchInstagramTrends: vi.fn(async () => page([item])),
      saveInstagramTrendSource: vi.fn(async () => { throw new Error("network_error"); })
    });
    await userEvent.type(await screen.findByRole("textbox", { name: "해시태그" }), "여행콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    await userEvent.click(await screen.findByRole("button", { name: "상세 보기 @creator1" }));
    const dialog = screen.getByRole("dialog", { name: "Instagram 트렌드 상세" });

    await userEvent.click(within(dialog).getByRole("button", { name: "참고 소스로 저장" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("참고 소스로 저장하지 못했습니다. 다시 시도하세요.");
    expect(within(dialog).getByRole("button", { name: "참고 소스로 저장" })).toBeEnabled();
  });

  it("keeps keyboard focus inside the detail dialog and restores it on close", async () => {
    const item = media(1);
    await renderTrendPage({
      getInstagramTrends: vi.fn(async () => page([item])),
      searchInstagramTrends: vi.fn(async () => page([item]))
    });
    await userEvent.type(await screen.findByRole("textbox", { name: "해시태그" }), "여행콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    const card = await screen.findByRole("button", { name: "상세 보기 @creator1" });
    await userEvent.click(card);
    const dialog = screen.getByRole("dialog", { name: "Instagram 트렌드 상세" });
    const saveButton = within(dialog).getByRole("button", { name: "참고 소스로 저장" });
    saveButton.focus();

    await userEvent.tab();
    expect(within(dialog).getByRole("button", { name: "닫기" })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(card).toHaveFocus();
  });

  it("falls back when media fails or is expired", async () => {
    const item = media(1, { mediaUrl: null, previewUrl: null, kind: "reel" });
    await renderTrendPage({ getInstagramTrends: vi.fn(async () => page([item])), searchInstagramTrends: vi.fn(async () => page([item])) });
    const input = await screen.findByRole("textbox", { name: "해시태그" });
    await userEvent.type(input, "여행콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));

    expect(await screen.findByText("미리보기를 사용할 수 없습니다.")).toBeVisible();
    expect(screen.getByText("Instagram에서 원본을 확인하세요.")).toBeVisible();
  });

  it("shows a retry-safe fallback after a media preview load error", async () => {
    const item = media(1, { mediaUrl: "https://cdn.example.com/expired.jpg", previewUrl: null, kind: "image" });
    await renderTrendPage({ getInstagramTrends: vi.fn(async () => page([item])), searchInstagramTrends: vi.fn(async () => page([item])) });
    const input = await screen.findByRole("textbox", { name: "해시태그" });
    await userEvent.type(input, "여행콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));

    const broken = await screen.findByRole("img", { name: "@creator1 미디어 미리보기" });
    fireEvent.error(broken);
    expect(await screen.findByText("미디어 미리보기를 불러오지 못했습니다.")).toBeVisible();
  });

  it("applies the selected media filter to stale rows when the filtered cache is unavailable", async () => {
    const mixed = page([
      media(1, { kind: "image" }),
      media(2, { kind: "carousel" }),
    ]);
    const getInstagramTrends = vi.fn()
      .mockResolvedValueOnce(mixed)
      .mockRejectedValueOnce(new Error("instagram_hashtag_not_found"));
    await renderTrendPage({
      getInstagramTrends,
      searchInstagramTrends: vi.fn(async () => mixed),
    });

    await userEvent.type(await screen.findByRole("textbox", { name: "해시태그" }), "여행콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(await screen.findByText("@creator2")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "이미지" }));

    expect(await screen.findByText("@creator1")).toBeVisible();
    expect(screen.queryByText("@creator2")).not.toBeInTheDocument();
  });

  it("maps empty and stable API errors to customer copy", async () => {
    const errorCases = [
      ["instagram_trend_connection_required", "트렌드 검색용 Meta 권한 연결이 필요합니다."],
      ["instagram_trend_reconnect_required", "트렌드 검색용 Meta 연결이 만료되었습니다. 다시 연결하세요."],
      ["instagram_reconnect_required", "Instagram 연결이 만료되었습니다. 채널에서 다시 연결하세요."],
      ["instagram_permission_required", "공개 해시태그 검색 권한이 필요합니다. 채널 연결을 확인하세요."],
      ["hashtag_search_limit_reached", "이 Instagram 계정은 최근 7일 동안 검색 가능한 고유 해시태그 30개를 모두 사용했습니다."],
      ["invalid_hashtag", "공백과 이모지 없이 해시태그를 입력하세요."]
    ] as const;

    await renderTrendPage({ getInstagramTrends: vi.fn(async () => page([])) });
    const input = await screen.findByRole("textbox", { name: "해시태그" });
    await userEvent.type(input, "여행콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(await screen.findByText("검색 결과가 없습니다.")).toBeVisible();

    for (const [code, copy] of errorCases) {
      cleanup();
      vi.resetModules();
      const api = await renderTrendPage({
        getInstagramTrends: vi.fn(async () => { throw new Error(code); }),
        searchInstagramTrends: vi.fn(async () => { throw new Error(code); })
      });
      const nextInput = await screen.findByRole("textbox", { name: "해시태그" });
      await userEvent.type(nextInput, "여행콘텐츠");
      await userEvent.click(screen.getByRole("button", { name: "검색" }));
      expect(await screen.findByText(copy)).toBeVisible();
      expect(api.getInstagramTrends).toHaveBeenCalled();
    }
  });
});
