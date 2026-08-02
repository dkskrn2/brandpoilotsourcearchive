import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AiContentReferenceSeed, InstagramTrendPage } from "../../types";
import { ContentReferenceSeedPicker } from "./ContentReferenceSeedPicker";

const referenceSeeds: AiContentReferenceSeed[] = Array.from({ length: 6 }, (_, index) => ({
  id: `${index + 1}`.repeat(8) + "-1111-4111-8111-111111111111",
  source: index % 2 ? "saved_trend" : "brand_output",
  title: `인기 레퍼런스 ${index + 1}`,
  url: `https://example.com/${index + 1}`,
  previewUrl: null,
  format: "card_news",
  primaryCategory: "뷰티",
  metrics: { exposureCount: 1000 - index, likeCount: 100 - index, commentsCount: 10 - index },
  checkedAt: "2026-07-31T00:00:00.000Z",
}));

const trendPage: InstagramTrendPage = {
  hashtag: { id: "hashtag-1", displayTag: "#뷰티", normalizedTag: "뷰티" },
  source: "meta",
  refreshed: true,
  refreshedAt: "2026-07-31T00:00:00.000Z",
  lastErrorCode: null,
  page: 1,
  pageSize: 20,
  total: 1,
  items: [{
    id: "trend-row-1",
    instagramMediaId: "media-1",
    username: "beauty",
    caption: "여름 피부 관리",
    kind: "image",
    mediaUrl: null,
    previewUrl: null,
    permalink: "https://instagram.com/p/1",
    postedAt: "2026-07-30T00:00:00.000Z",
    likeCount: 320,
    commentsCount: 12,
    metaRank: 1,
    refreshedAt: "2026-07-31T00:00:00.000Z",
    isSaved: false,
  }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderPicker(options: { saveRejects?: boolean } = {}) {
  const listReferenceSeeds = vi.fn().mockResolvedValue(referenceSeeds);
  const searchInstagramTrends = vi.fn().mockResolvedValue(trendPage);
  const saveInstagramTrendSource = options.saveRejects
    ? vi.fn().mockRejectedValue(new Error("save failed"))
    : vi.fn().mockResolvedValue({
      source: { id: "source-1" },
      referenceItemId: "77777777-7777-4777-8777-777777777777",
      alreadySaved: false,
    });
  const onChange = vi.fn();
  render(<ContentReferenceSeedPicker
    brandId="brand-1"
    format="card_news"
    selected={[]}
    onChange={onChange}
    referenceGateway={{ listReferenceSeeds }}
    trendGateway={{ searchInstagramTrends, saveInstagramTrendSource }}
  />);
  return { listReferenceSeeds, searchInstagramTrends, saveInstagramTrendSource, onChange };
}

describe("ContentReferenceSeedPicker", () => {
  it("shows the category-matched popularity order and enforces five selected items", async () => {
    const user = userEvent.setup();
    const { listReferenceSeeds, onChange } = renderPicker();

    expect(await screen.findByText("인기 레퍼런스 1")).toBeVisible();
    expect(listReferenceSeeds).toHaveBeenCalledWith("brand-1", "card_news");
    expect(screen.getAllByRole("button", { name: /레퍼런스 선택:/ }).map((button) => button.getAttribute("aria-label"))).toEqual(
      referenceSeeds.map((item) => `레퍼런스 선택: ${item.title}`),
    );

    await user.click(screen.getByRole("button", { name: "레퍼런스 선택: 인기 레퍼런스 1" }));
    expect(onChange).toHaveBeenCalledWith([{ referenceId: referenceSeeds[0].id, roles: ["planning"] }]);

    const fiveSelected = referenceSeeds.slice(0, 5).map((item) => ({ referenceId: item.id, roles: ["planning" as const] }));
    cleanup();
    render(<ContentReferenceSeedPicker
      brandId="brand-1"
      format="card_news"
      selected={fiveSelected}
      onChange={vi.fn()}
      referenceGateway={{ listReferenceSeeds: vi.fn().mockResolvedValue(referenceSeeds) }}
      trendGateway={{ searchInstagramTrends: vi.fn(), saveInstagramTrendSource: vi.fn() }}
    />);
    expect(await screen.findByRole("button", { name: "레퍼런스 선택: 인기 레퍼런스 6" })).toBeDisabled();
  });

  it("keeps at least one role and exposes planning, copy, and visual role toggles", async () => {
    const onChange = vi.fn();
    render(<ContentReferenceSeedPicker
      brandId="brand-1"
      format="card_news"
      selected={[{ referenceId: referenceSeeds[0].id, roles: ["planning"] }]}
      onChange={onChange}
      referenceGateway={{ listReferenceSeeds: vi.fn().mockResolvedValue(referenceSeeds) }}
      trendGateway={{ searchInstagramTrends: vi.fn(), saveInstagramTrendSource: vi.fn() }}
    />);

    expect(await screen.findByRole("button", { name: "기획 역할 해제" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "카피 패턴 역할 추가" })).toBeVisible();
    expect(screen.getByRole("button", { name: "비주얼 구성 역할 추가" })).toBeVisible();
  });

  it("uses trend search and immediately selects the canonical saved reference ID", async () => {
    const user = userEvent.setup();
    const { searchInstagramTrends, saveInstagramTrendSource, onChange } = renderPicker();

    await user.click(screen.getByRole("tab", { name: "트렌드 탐색" }));
    await user.type(screen.getByLabelText("트렌드 검색어"), "#뷰티");
    await user.click(screen.getByRole("button", { name: "검색" }));
    expect(await screen.findByText("여름 피부 관리")).toBeVisible();
    expect(searchInstagramTrends).toHaveBeenCalledWith("brand-1", "#뷰티");

    await user.click(screen.getByRole("button", { name: "레퍼런스로 저장하고 선택" }));
    await waitFor(() => expect(saveInstagramTrendSource).toHaveBeenCalledWith("brand-1", "media-1"));
    expect(onChange).toHaveBeenCalledWith([{
      referenceId: "77777777-7777-4777-8777-777777777777",
      roles: ["planning"],
    }]);
  });

  it("shows the same bounded role controls for a selected canonical trend reference", async () => {
    const user = userEvent.setup();
    function ControlledPicker() {
      const [selected, setSelected] = useState<Parameters<typeof ContentReferenceSeedPicker>[0]["selected"]>([]);
      return <ContentReferenceSeedPicker
        brandId="brand-1"
        format="card_news"
        selected={selected}
        onChange={setSelected}
        referenceGateway={{ listReferenceSeeds: vi.fn().mockResolvedValue(referenceSeeds) }}
        trendGateway={{
          searchInstagramTrends: vi.fn().mockResolvedValue(trendPage),
          saveInstagramTrendSource: vi.fn().mockResolvedValue({
            source: { id: "source-1" },
            referenceItemId: "77777777-7777-4777-8777-777777777777",
            alreadySaved: false,
          }),
        }}
      />;
    }
    render(<ControlledPicker />);

    await user.click(screen.getByRole("tab", { name: "트렌드 탐색" }));
    await user.type(screen.getByLabelText("트렌드 검색어"), "#뷰티");
    await user.click(screen.getByRole("button", { name: "검색" }));
    await user.click(await screen.findByRole("button", { name: "레퍼런스로 저장하고 선택" }));

    expect(await screen.findByRole("button", { name: "기획 역할 해제" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "카피 패턴 역할 추가" }));
    await user.click(screen.getByRole("button", { name: "비주얼 구성 역할 추가" }));
    expect(screen.getAllByRole("button", { name: /역할 해제/ })).toHaveLength(3);
  });

  it("propagates a trend save failure without creating a sample reference", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ saveRejects: true });

    await user.click(screen.getByRole("tab", { name: "트렌드 탐색" }));
    await user.type(screen.getByLabelText("트렌드 검색어"), "#뷰티");
    await user.click(screen.getByRole("button", { name: "검색" }));
    await user.click(await screen.findByRole("button", { name: "레퍼런스로 저장하고 선택" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("저장하지 못했습니다");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores a stale popular-reference response after brand and format change", async () => {
    const oldRequest = deferred<AiContentReferenceSeed[]>();
    const newReference = { ...referenceSeeds[0], id: "99999999-9999-4999-8999-999999999999", title: "새 브랜드 블로그" };
    const listReferenceSeeds = vi.fn((brandId: string) => brandId === "brand-old"
      ? oldRequest.promise
      : Promise.resolve([{ ...newReference, format: "blog" as const }]));
    const props = {
      selected: [],
      onChange: vi.fn(),
      referenceGateway: { listReferenceSeeds },
      trendGateway: { searchInstagramTrends: vi.fn(), saveInstagramTrendSource: vi.fn() },
    };
    const { rerender } = render(<ContentReferenceSeedPicker
      {...props}
      brandId="brand-old"
      format="card_news"
    />);

    rerender(<ContentReferenceSeedPicker {...props} brandId="brand-new" format="blog" />);
    expect(await screen.findByText("새 브랜드 블로그")).toBeVisible();
    await act(async () => { oldRequest.resolve(referenceSeeds); });

    expect(screen.queryByText("인기 레퍼런스 1")).not.toBeInTheDocument();
  });

  it("resets trend state and ignores a stale search after the brand changes", async () => {
    const oldSearch = deferred<InstagramTrendPage>();
    const searchInstagramTrends = vi.fn().mockReturnValue(oldSearch.promise);
    const props = {
      format: "card_news" as const,
      selected: [],
      onChange: vi.fn(),
      referenceGateway: { listReferenceSeeds: vi.fn().mockResolvedValue([]) },
      trendGateway: { searchInstagramTrends, saveInstagramTrendSource: vi.fn() },
    };
    const user = userEvent.setup();
    const { rerender } = render(<ContentReferenceSeedPicker {...props} brandId="brand-old" />);
    await user.click(screen.getByRole("tab", { name: "트렌드 탐색" }));
    await user.type(screen.getByLabelText("트렌드 검색어"), "#old");
    await user.click(screen.getByRole("button", { name: "검색" }));

    rerender(<ContentReferenceSeedPicker {...props} brandId="brand-new" />);
    await act(async () => { oldSearch.resolve(trendPage); });

    expect(screen.getByLabelText("트렌드 검색어")).toHaveValue("");
    expect(screen.queryByText("여름 피부 관리")).not.toBeInTheDocument();
  });

  it("ignores a saved trend from an old brand scope", async () => {
    const saveRequest = deferred<{
      source: { id: string };
      referenceItemId: string;
      alreadySaved: boolean;
    }>();
    const onChange = vi.fn();
    const props = {
      format: "card_news" as const,
      selected: [],
      onChange,
      referenceGateway: { listReferenceSeeds: vi.fn().mockResolvedValue([]) },
      trendGateway: {
        searchInstagramTrends: vi.fn().mockResolvedValue(trendPage),
        saveInstagramTrendSource: vi.fn().mockReturnValue(saveRequest.promise),
      },
    };
    const user = userEvent.setup();
    const { rerender } = render(<ContentReferenceSeedPicker {...props} brandId="brand-old" />);
    await user.click(screen.getByRole("tab", { name: "트렌드 탐색" }));
    await user.type(screen.getByLabelText("트렌드 검색어"), "#old");
    await user.click(screen.getByRole("button", { name: "검색" }));
    await user.click(await screen.findByRole("button", { name: "레퍼런스로 저장하고 선택" }));

    rerender(<ContentReferenceSeedPicker {...props} brandId="brand-new" />);
    await act(async () => {
      saveRequest.resolve({ source: { id: "source-old" }, referenceItemId: "old-reference", alreadySaved: false });
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses the latest selection bound when a trend save completes", async () => {
    const saveRequest = deferred<{
      source: { id: string };
      referenceItemId: string;
      alreadySaved: boolean;
    }>();
    const onChange = vi.fn();
    const trendGateway = {
      searchInstagramTrends: vi.fn().mockResolvedValue(trendPage),
      saveInstagramTrendSource: vi.fn().mockReturnValue(saveRequest.promise),
    };
    const referenceGateway = { listReferenceSeeds: vi.fn().mockResolvedValue([]) };
    const user = userEvent.setup();
    const { rerender } = render(<ContentReferenceSeedPicker
      brandId="brand-1"
      format="card_news"
      selected={[]}
      onChange={onChange}
      referenceGateway={referenceGateway}
      trendGateway={trendGateway}
    />);
    await user.click(screen.getByRole("tab", { name: "트렌드 탐색" }));
    await user.type(screen.getByLabelText("트렌드 검색어"), "#뷰티");
    await user.click(screen.getByRole("button", { name: "검색" }));
    await user.click(await screen.findByRole("button", { name: "레퍼런스로 저장하고 선택" }));

    rerender(<ContentReferenceSeedPicker
      brandId="brand-1"
      format="card_news"
      selected={referenceSeeds.slice(0, 5).map((item) => ({ referenceId: item.id, roles: ["planning"] }))}
      onChange={onChange}
      referenceGateway={referenceGateway}
      trendGateway={trendGateway}
    />);
    await act(async () => {
      saveRequest.resolve({ source: { id: "source-1" }, referenceItemId: "new-reference", alreadySaved: false });
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not update the parent when a trend save resolves after unmount", async () => {
    const saveRequest = deferred<{
      source: { id: string };
      referenceItemId: string;
      alreadySaved: boolean;
    }>();
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<ContentReferenceSeedPicker
      brandId="brand-1"
      format="card_news"
      selected={[]}
      onChange={onChange}
      referenceGateway={{ listReferenceSeeds: vi.fn().mockResolvedValue([]) }}
      trendGateway={{
        searchInstagramTrends: vi.fn().mockResolvedValue(trendPage),
        saveInstagramTrendSource: vi.fn().mockReturnValue(saveRequest.promise),
      }}
    />);
    await user.click(screen.getByRole("tab", { name: "트렌드 탐색" }));
    await user.type(screen.getByLabelText("트렌드 검색어"), "#뷰티");
    await user.click(screen.getByRole("button", { name: "검색" }));
    await user.click(await screen.findByRole("button", { name: "레퍼런스로 저장하고 선택" }));

    unmount();
    await act(async () => {
      saveRequest.resolve({ source: { id: "source-1" }, referenceItemId: "late-reference", alreadySaved: false });
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
