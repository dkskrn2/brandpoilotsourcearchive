import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentOutput } from "../types";

const outputs: ContentOutput[] = [
  {
    id: "output-feed",
    contentId: "content-1",
    title: "제주 가족 여행 카드뉴스",
    channel: "instagram",
    deliveryFormat: "instagram_feed_carousel",
    sourceMode: "direct_url",
    status: "pending_review",
    topicId: "topic-1",
    generatedAt: "2026-07-13T01:00:00.000Z",
    sourceSummary: "자사 FAQ와 여행 주제표",
    previewTitle: "아이와 함께 가기 좋은 제주 여행",
    previewBody: "첫 문단입니다.\n\n둘째 문단입니다."
  },
  {
    id: "output-story",
    contentId: "content-1",
    title: "제주 가족 여행 Story",
    channel: "instagram",
    deliveryFormat: "instagram_story",
    sourceMode: "topic_only",
    status: "auto_approval_blocked",
    topicId: "topic-1",
    generatedAt: "2026-07-13T01:00:00.000Z",
    sourceSummary: "자사 FAQ와 여행 주제표",
    previewTitle: "제주 가족 여행 Story",
    previewBody: "세로형 스토리 1장 구성",
    previewImageUrl: "https://cdn.example.com/story.png",
    blockReasons: ["외부 참고 URL 의존도가 높습니다."]
  },
  {
    id: "output-reel",
    contentId: "content-1",
    title: "제주 가족 여행 Reel",
    channel: "instagram",
    deliveryFormat: "instagram_reel",
    sourceMode: "url_unavailable",
    status: "pending_review",
    topicId: "topic-1",
    generatedAt: "2026-07-13T01:00:00.000Z",
    sourceSummary: "여행 주제표",
    previewTitle: "제주 가족 여행 Reel",
    previewBody: "세로형 릴 3개 장면 구성",
    previewVideoUrl: "https://cdn.example.com/reel.mp4",
    previewPosterUrl: "https://cdn.example.com/cover.png",
    durationSeconds: 8.5
  }
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function renderContentPage(apiOverrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  const api = {
    listContentOutputs: vi.fn(async () => outputs),
    reviewContentOutput: vi.fn(async (id: string, action: "approve" | "reject" | "regenerate") => ({
      id,
      status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "regenerating"
    })),
    ...apiOverrides
  };
  vi.doMock("../lib/apiClient", () => ({ DEMO_BRAND_ID: "brand-1", api }));
  const { ContentPage } = await import("../pages/ContentPage");
  render(<ContentPage />);
  return api;
}

describe("ContentPage", () => {
  it("shows API-backed channel outputs and automatic approval block reasons", async () => {
    await renderContentPage();

    expect(await screen.findByRole("heading", { name: "콘텐츠 검토" })).toBeVisible();
    expect(screen.getByText("제주 가족 여행 카드뉴스")).toBeVisible();
    expect(screen.getByText("외부 참고 URL 의존도가 높습니다.")).toBeVisible();
    expect(screen.getAllByText(/Instagram/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Story/).length).toBeGreaterThan(0);
  });

  it("renders feed, Story, and Reel previews with format and source metadata", async () => {
    await renderContentPage();

    expect(await screen.findByLabelText("Instagram 정방형 카드뉴스 미리보기")).toBeVisible();
    expect(screen.getByRole("img", { name: "Instagram Story 미리보기: 제주 가족 여행 Story" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/story.png"
    );
    const reel = screen.getByLabelText("Instagram Reel 미리보기: 제주 가족 여행 Reel");
    expect(reel).toHaveAttribute("controls");
    expect(reel).toHaveAttribute("preload", "metadata");
    expect(reel).toHaveAttribute("poster", "https://cdn.example.com/cover.png");
    expect(screen.getByText("길이 0:09")).toBeVisible();
    expect(screen.getByText("직접 URL")).toBeVisible();
    expect(screen.getByText("주제 정보")).toBeVisible();
    expect(screen.getByText("URL 사용 불가")).toBeVisible();
  });

  it("persists review actions through the API and refreshes the status", async () => {
    const api = await renderContentPage();
    await screen.findByText("제주 가족 여행 카드뉴스");

    await userEvent.click(screen.getByRole("button", { name: "승인 Card News" }));

    expect(api.reviewContentOutput).toHaveBeenCalledWith("output-feed", "approve", undefined);
    expect(await screen.findByText("승인됨")).toBeVisible();
  });

  it("regenerates the current output without replacing its delivery format", async () => {
    const api = await renderContentPage();
    const storyHeading = await screen.findByRole("heading", { name: "제주 가족 여행 Story" });
    const storyArticle = storyHeading.closest("article") as HTMLElement;

    await userEvent.type(within(storyArticle).getByLabelText("Instagram Story 재생성 사유"), "문구를 간결하게");
    await userEvent.click(within(storyArticle).getByRole("button", { name: "재생성" }));

    expect(api.reviewContentOutput).toHaveBeenCalledWith("output-story", "regenerate", "문구를 간결하게");
    expect(storyArticle).toHaveTextContent("Story");
    expect(await screen.findByText("재생성 중")).toBeVisible();
  });

  it("shows an API error without an empty or sample content fallback", async () => {
    await renderContentPage({
      listContentOutputs: vi.fn(async () => {
        throw new Error("api_down");
      })
    });

    expect(await screen.findByText(/콘텐츠 검토 목록을 불러오지 못했습니다/)).toBeVisible();
    expect(screen.queryByText("검토할 콘텐츠가 없습니다")).not.toBeInTheDocument();
    expect(screen.queryByText("제주 가족 여행 카드뉴스")).not.toBeInTheDocument();
  });
});
