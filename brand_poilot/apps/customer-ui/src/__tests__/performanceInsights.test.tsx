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
      windows: [
        { window: "24h", sampleSize: 3, averageExposure: 317 },
        { window: "72h", sampleSize: 2, averageExposure: 280 },
        { window: "7d", sampleSize: 1, averageExposure: 240 },
      ],
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
    expect(screen.getByRole("region", { name: "최근 30일 성과 요약" })).toHaveTextContent(
      "분석 가능",
    );
    expect(screen.getByRole("region", { name: "최근 30일 성과 요약" })).toHaveTextContent(
      "최근 수집 2026. 7. 28.",
    );
    expect(screen.getByRole("article", { name: "평균 노출 317회 · 표본 3건 관측과 해석" }))
      .toHaveTextContent("평균 노출 317회 · 표본 3건");
    expect(screen.getByRole("article", { name: "평균 노출 317회 · 표본 3건 관측과 해석" }))
      .toHaveTextContent("24h 구간이 높았습니다.");
    const measurementWindows = screen.getByRole("region", { name: "측정 구간" });
    expect(measurementWindows).toHaveTextContent(
      "24시간표본 3건평균 317회",
    );
    const contentList = screen.getByRole("list", { name: "성과 콘텐츠" });
    const contentSection = contentList.closest("section");
    expect(contentSection).not.toBeNull();
    expect(
      contentSection!.compareDocumentPosition(measurementWindows)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "다음 실험" })).toBeVisible();
    expect(getArtifact).not.toHaveBeenCalled();

    const contentButton = screen.getByRole("button", { name: "좋았던 콘텐츠 상세 보기" });
    expect(contentButton).toHaveTextContent("Instagram");
    expect(contentButton).toHaveTextContent("카드뉴스");
    expect(contentButton).toHaveTextContent("600회");
    fireEvent.click(contentButton);
    await waitFor(() => expect(getArtifact).toHaveBeenCalledWith("queue-1"));
    expect(await screen.findByRole("dialog", { name: "좋았던 콘텐츠" })).toHaveTextContent("실제 콘텐츠");

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(contentButton).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "이 데이터로 AI 구성안 만들기" }));
    await waitFor(() => expect(createProposalBatch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("link", { name: "생성된 구성안 열기" }))
      .toHaveAttribute("href", "/ai-content/new?proposalBatch=batch-1");
  });
});
