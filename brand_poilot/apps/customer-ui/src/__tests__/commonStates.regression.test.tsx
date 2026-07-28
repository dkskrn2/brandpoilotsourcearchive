import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeatureSuggestionBanner } from "../components/feedback/FeatureSuggestionBanner";
import { FeedbackProvider } from "../components/feedback/FeedbackContext";
import { Sidebar } from "../components/layout/Sidebar";
import { EmptyState } from "../components/ui/EmptyState";
import { ListSkeleton } from "../components/ui/LoadingState";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("common customer states", () => {
  it("uses the same feedback provider for sidebar and page suggestions", async () => {
    const openFeedback = vi.fn();
    render(
      <MemoryRouter>
        <FeedbackProvider onOpenFeedback={openFeedback}>
          <Sidebar />
          <FeatureSuggestionBanner />
        </FeedbackProvider>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "피드백" }));
    await userEvent.click(screen.getByRole("button", { name: "기능 제안하기" }));

    expect(openFeedback).toHaveBeenCalledTimes(2);
  });

  it("keeps loading skeletons and empty results distinguishable", () => {
    const { rerender } = render(<ListSkeleton rows={3} columns={2} label="목록을 불러오는 중입니다." />);
    expect(screen.getByRole("status", { name: "목록을 불러오는 중입니다." })).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByTestId("skeleton-row")).toHaveLength(3);

    rerender(<EmptyState title="결과 없음" description="조건을 바꿔 다시 확인하세요." />);
    expect(screen.getByRole("heading", { name: "결과 없음" })).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a retryable API error and never replaces it with sample channel success", async () => {
    const listChannels = vi.fn()
      .mockRejectedValueOnce(new Error("api unavailable"))
      .mockResolvedValueOnce([]);
    const getChannelCapabilities = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    vi.doMock("../lib/apiClient", () => ({
      DEMO_BRAND_ID: "brand-1",
      api: {
        listChannels,
        getChannelCapabilities,
        getInstagramDmSettings: vi.fn(async () => null),
        updateInstagramDmSettings: vi.fn(),
        updateChannelEnabled: vi.fn(),
      },
    }));
    const { ChannelsPage } = await import("../pages/ChannelsPage");

    render(<ChannelsPage />);

    expect(await screen.findByRole("alert", { name: "채널 지원 범위를 불러오지 못했습니다" })).toBeVisible();
    expect(screen.queryByText("Meta OAuth")).not.toBeInTheDocument();
    expect(screen.queryByText("모두 연결됨")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByText("상태 없음")).toBeVisible();
    expect(screen.queryByRole("alert", { name: "채널 지원 범위를 불러오지 못했습니다" })).not.toBeInTheDocument();
    expect(listChannels).toHaveBeenCalledTimes(2);
  });
});
