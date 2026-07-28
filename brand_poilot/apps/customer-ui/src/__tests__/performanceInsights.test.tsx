import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("PerformanceInsightsPage", () => {
  it("shows separate evidence layers, lazy-loads artifacts, and opens the proposal selection phase", async () => {
    const getInsights = vi.fn(async () => ({
      period: "30d",
      summary: { dataStatus: "sufficient", measuredContentCount: 3, totalExposure: 950 },
      windows: [{ window: "24h", sampleSize: 3, averageExposure: 317 }],
      observations: [{
        id: "average-exposure",
        kind: "observation",
        label: "평균 노출",
        metric: { name: "평균 노출", value: 317, unit: "회", sampleSize: 3 },
        evidenceSnapshotIds: ["snapshot-1"],
        interpretation: { kind: "interpretation", statement: "24h 구간이 높았습니다.", confidence: "medium" },
      }],
      experiments: [{
        id: "experiment-1",
        kind: "experiment",
        title: "성과 패턴 재사용",
        hypothesis: "초기 노출을 개선합니다.",
        contentFamily: "informational",
        channelTargets: ["instagram"],
        outputFormats: ["card_news"],
        performanceSnapshotIds: ["snapshot-1"],
      }],
      sampleSize: 3,
      lastCollectedAt: "2026-07-28T03:00:00.000Z",
      topContents: [{
        publishQueueId: "queue-1",
        title: "좋았던 콘텐츠",
        channel: "instagram",
        deliveryFormat: "instagram_feed_carousel",
        exposureCount: 600,
        snapshotId: "snapshot-1",
        externalUrl: null,
      }],
    }));
    const getArtifact = vi.fn(async () => ({ kind: "text", text: "실제 콘텐츠", assets: [] }));
    const createProposalBatch = vi.fn(async () => ({ batchId: "batch-1", status: "queued" }));
    vi.doMock("../features/performance/performanceGateway", () => ({
      performanceGateway: { getInsights, getArtifact, createProposalBatch },
    }));
    vi.doMock("../lib/apiClient", () => ({ DEMO_BRAND_ID: "brand-1" }));
    const { PerformanceInsightsPage } = await import("../pages/PerformanceInsightsPage");

    render(<MemoryRouter><PerformanceInsightsPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "성과·개선" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "관측" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "해석" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "다음 실험" })).toBeVisible();
    expect(getArtifact).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "좋았던 콘텐츠 상세 보기" }));
    await waitFor(() => expect(getArtifact).toHaveBeenCalledWith("queue-1"));
    expect(await screen.findByRole("dialog", { name: "좋았던 콘텐츠" })).toHaveTextContent("실제 콘텐츠");

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.click(screen.getByRole("button", { name: "이 데이터로 AI 구성안 만들기" }));
    await waitFor(() => expect(createProposalBatch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("link", { name: "생성된 구성안 열기" }))
      .toHaveAttribute("href", "/ai-content/new?proposalBatch=batch-1");
  });
});
