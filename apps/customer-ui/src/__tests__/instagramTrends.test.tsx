import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelConnection, ContentCategory, InstagramTrendMedia, InstagramTrendPage } from "../types";

const connectedInstagram: ChannelConnection = {
  type: "instagram",
  label: "Instagram",
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
    listInstagramTrendSearches: vi.fn(async () => []),
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
  vi.resetModules();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("InstagramTrendsPage", () => {
  it("shows the disconnected Instagram state with a channels action", async () => {
    await renderTrendPage({
      listChannels: vi.fn(async () => [{ ...connectedInstagram, status: "not_connected" }])
    });

    expect(await screen.findByText("Instagram 채널을 먼저 연결하세요.")).toBeVisible();
    expect(screen.getByRole("link", { name: "채널에서 연결하기" })).toHaveAttribute("href", "/channels");
  });

  it("fills a recommended hashtag without searching", async () => {
    const api = await renderTrendPage();
    const input = await screen.findByRole("textbox", { name: "해시태그" });

    await userEvent.click(screen.getByRole("button", { name: "#여행콘텐츠" }));

    expect(input).toHaveValue("#여행콘텐츠");
    expect(api.getInstagramTrends).not.toHaveBeenCalled();
    expect(api.searchInstagramTrends).not.toHaveBeenCalled();
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

  it("maps empty and stable API errors to customer copy", async () => {
    const errorCases = [
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
