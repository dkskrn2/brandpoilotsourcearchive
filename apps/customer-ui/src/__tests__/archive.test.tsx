import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstagramTrendArchivePage, InstagramTrendMedia } from "../types";

const savedMedia: InstagramTrendMedia & { savedAt: string } = {
  id: "media-1",
  instagramMediaId: "ig-1",
  username: "archive_creator",
  caption: "저장한 트렌드 캡션",
  kind: "image",
  mediaUrl: "https://cdn.example.com/archive.jpg",
  previewUrl: null,
  permalink: "https://www.instagram.com/p/archive-1",
  postedAt: "2026-07-15T08:00:00.000Z",
  likeCount: 12,
  commentsCount: 3,
  metaRank: 0,
  refreshedAt: "2026-07-15T09:00:00.000Z",
  isSaved: true,
  savedAt: "2026-07-22T01:00:00.000Z",
};

async function renderArchive(page: InstagramTrendArchivePage, overrides: {
  listInstagramTrendArchive?: ReturnType<typeof vi.fn>;
  removeInstagramTrendSource?: ReturnType<typeof vi.fn>;
} = {}) {
  const listInstagramTrendArchive = overrides.listInstagramTrendArchive ?? vi.fn(async () => page);
  const saveInstagramTrendSource = vi.fn(async () => ({ source: { id: "source-1" }, alreadySaved: true }));
  const removeInstagramTrendSource = overrides.removeInstagramTrendSource ?? vi.fn(async () => ({ mediaId: "media-1", removed: true }));
  vi.doMock("../lib/apiClient", () => ({
    DEMO_BRAND_ID: "brand-1",
    api: { listInstagramTrendArchive, saveInstagramTrendSource, removeInstagramTrendSource },
  }));
  const { ArchivePage } = await import("../pages/ArchivePage");
  render(<ArchivePage />);
  return { listInstagramTrendArchive, saveInstagramTrendSource, removeInstagramTrendSource };
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("ArchivePage", () => {
  it("shows saved trend cards and reuses the detail dialog with the original Instagram link", async () => {
    const api = await renderArchive({ items: [savedMedia], page: 1, limit: 30, total: 31 });

    expect(await screen.findByRole("heading", { name: "아카이브" })).toBeVisible();
    expect(api.listInstagramTrendArchive).toHaveBeenCalledWith("brand-1", { page: 1, limit: 30 });
    expect(screen.getByRole("button", { name: "@archive_creator 저장됨" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "상세 보기 @archive_creator" }));
    const dialog = screen.getByRole("dialog", { name: "Instagram 트렌드 상세" });
    expect(within(dialog).getByText("저장한 트렌드 캡션")).toBeVisible();
    expect(within(dialog).getByRole("link", { name: "Instagram에서 보기" })).toHaveAttribute("href", savedMedia.permalink);
  });

  it("removes a saved card immediately and calls the brand-scoped delete API", async () => {
    const api = await renderArchive({ items: [savedMedia], page: 1, limit: 30, total: 1 });

    await userEvent.click(await screen.findByRole("button", { name: "@archive_creator 저장됨" }));

    expect(screen.queryByRole("button", { name: "상세 보기 @archive_creator" })).not.toBeInTheDocument();
    expect(api.removeInstagramTrendSource).toHaveBeenCalledWith("brand-1", "media-1");
  });

  it("restores the card when unbookmarking fails", async () => {
    let rejectRemoval: ((reason: Error) => void) | undefined;
    await renderArchive(
      { items: [savedMedia], page: 1, limit: 30, total: 1 },
      { removeInstagramTrendSource: vi.fn(() => new Promise((_resolve, reject) => { rejectRemoval = reject; })) }
    );

    await userEvent.click(await screen.findByRole("button", { name: "@archive_creator 저장됨" }));
    expect(screen.queryByRole("button", { name: "상세 보기 @archive_creator" })).not.toBeInTheDocument();
    rejectRemoval?.(new Error("network_error"));

    expect(await screen.findByRole("button", { name: "상세 보기 @archive_creator" })).toBeVisible();
    expect(screen.getByText("잠시 후 다시 시도해 주세요.")).toBeVisible();
  });

  it("loads the previous page after removing the last item on a later page", async () => {
    const previousPage = { items: [savedMedia], page: 1, limit: 30, total: 30 };
    const lastPageItem = { ...savedMedia, id: "media-31", instagramMediaId: "ig-31", username: "archive_creator31" };
    const listInstagramTrendArchive = vi.fn()
      .mockResolvedValueOnce({ items: [savedMedia], page: 1, limit: 30, total: 31 })
      .mockResolvedValueOnce({ items: [lastPageItem], page: 2, limit: 30, total: 31 })
      .mockResolvedValueOnce(previousPage);
    await renderArchive(previousPage, { listInstagramTrendArchive });

    await userEvent.click(await screen.findByRole("button", { name: "다음 30개" }));
    await userEvent.click(await screen.findByRole("button", { name: "@archive_creator31 저장됨" }));

    await waitFor(() => expect(listInstagramTrendArchive).toHaveBeenLastCalledWith("brand-1", { page: 1, limit: 30 }));
  });

  it("requests the next archive page", async () => {
    const api = await renderArchive({ items: [savedMedia], page: 1, limit: 30, total: 31 });

    await userEvent.click(await screen.findByRole("button", { name: "다음 30개" }));

    expect(api.listInstagramTrendArchive).toHaveBeenLastCalledWith("brand-1", { page: 2, limit: 30 });
  });
});
