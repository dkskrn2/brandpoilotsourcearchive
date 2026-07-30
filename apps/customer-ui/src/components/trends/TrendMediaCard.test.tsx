import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { InstagramTrendMedia } from "../../types";
import { TrendMediaCard } from "./TrendMediaCard";

const media: InstagramTrendMedia = {
  id: "media-1",
  instagramMediaId: "ig-1",
  username: "creator",
  caption: "caption",
  kind: "image",
  mediaUrl: "https://cdn.example.com/image.jpg",
  previewUrl: null,
  permalink: "https://www.instagram.com/p/1",
  postedAt: "2026-07-15T08:00:00.000Z",
  likeCount: 10,
  commentsCount: 2,
  metaRank: 1,
  refreshedAt: "2026-07-15T09:00:00.000Z",
  isSaved: false,
};

describe("TrendMediaCard", () => {
  it("renders sibling detail and bookmark buttons without nesting interactive controls", async () => {
    const onSelect = vi.fn();
    const onBookmark = vi.fn(async () => undefined);
    const { container } = render(<TrendMediaCard media={media} onSelect={onSelect} onBookmark={onBookmark} />);

    const card = container.querySelector("article.trend-media-card");
    expect(card).not.toBeNull();
    expect(card?.querySelector("button button")).toBeNull();
    await userEvent.click(within(card as HTMLElement).getByRole("button", { name: "상세 보기 @creator" }));
    await userEvent.click(within(card as HTMLElement).getByRole("button", { name: "@creator 북마크" }));
    expect(onSelect).toHaveBeenCalledWith(media);
    expect(onBookmark).toHaveBeenCalledWith(media);
  });

  it("shows a checked disabled bookmark for saved media", () => {
    render(<TrendMediaCard media={{ ...media, isSaved: true }} onSelect={vi.fn()} onBookmark={vi.fn()} />);
    expect(screen.getByRole("button", { name: "@creator 저장됨" })).toBeDisabled();
  });

  it("checks and disables the bookmark immediately after a successful save", async () => {
    const onBookmark = vi.fn(async () => undefined);
    render(<TrendMediaCard media={media} onSelect={vi.fn()} onBookmark={onBookmark} />);

    await userEvent.click(screen.getByRole("button", { name: "@creator 북마크" }));

    const savedButton = await screen.findByRole("button", { name: "@creator 저장됨" });
    expect(savedButton).toBeDisabled();
    await userEvent.click(savedButton);
    expect(onBookmark).toHaveBeenCalledTimes(1);
  });
});
