import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackProvider, useFeedback } from "../components/feedback/FeedbackContext";
import type { Dashboard, PublishArtifact } from "../types";

const dashboard: Dashboard = {
  period: "30d",
  generatedAt: "2026-07-16T04:00:00.000Z",
  lastCollectedAt: "2026-07-16T03:00:00.000Z",
  summary: {
    publishedCount: 12,
    exposureCount: 8430,
    pendingReviewCount: 3,
    failedPublishCount: 1
  },
  workflow: {
    queuedTopics: 8,
    generating: 2,
    pendingReview: 3,
    scheduledOrPublished: 12
  },
  dailyExposure: [
    { date: "2026-07-15", channels: { instagram: 1200, threads: 80 } },
    { date: "2026-07-16", channels: { instagram: 1650 } }
  ],
  channelPerformance: [
    {
      channel: "instagram",
      connectionStatus: "connected",
      publishedCount: 9,
      exposureCount: 8300,
      lastCollectedAt: "2026-07-16T03:00:00.000Z",
      syncStatus: "completed"
    },
    {
      channel: "threads",
      connectionStatus: "connected",
      publishedCount: 3,
      exposureCount: 130,
      lastCollectedAt: "2026-07-16T03:00:00.000Z",
      syncStatus: "partially_failed"
    },
    {
      channel: "linkedin",
      connectionStatus: "not_connected",
      publishedCount: 0,
      exposureCount: null,
      lastCollectedAt: null,
      syncStatus: "not_configured"
    }
  ],
  topContents: [{
    publishQueueId: "queue-1",
    title: "여름 캠페인 운영 가이드",
    channel: "instagram",
    deliveryFormat: "instagram_feed_carousel",
    publishedAt: "2026-07-15T08:00:00.000Z",
    exposureCount: 3400,
    externalUrl: "https://instagram.com/p/post-1"
  }],
  attentionItems: [{
    type: "sync_failed",
    channel: "threads",
    message: "provider token=secret-value upstream stack trace"
  }]
};

const artifact: PublishArtifact = {
  queueId: "queue-1",
  kind: "image_gallery",
  deliveryFormat: "instagram_feed_carousel",
  assets: [{
    url: "https://cdn.example.com/card-1.png",
    fileName: "card-1.png",
    mimeType: "image/png",
    width: 1080,
    height: 1080
  }],
  posterUrl: null,
  html: null,
  text: null
};

type ApiMock = {
  getDashboard: ReturnType<typeof vi.fn>;
  getPublishArtifact: ReturnType<typeof vi.fn>;
};

async function renderDashboardPage(
  getDashboard: ApiMock["getDashboard"] = vi.fn(async () => dashboard),
  getPublishArtifact: ApiMock["getPublishArtifact"] = vi.fn(async () => artifact),
  openFeedback = vi.fn()
) {
  const api = { getDashboard, getPublishArtifact };
  vi.doMock("../lib/apiClient", () => ({ DEMO_BRAND_ID: "brand-1", api }));
  vi.doMock("../components/feedback/FeedbackContext", () => ({ FeedbackProvider, useFeedback }));
  const { DashboardPage } = await import("../pages/DashboardPage");
  render(
    <FeedbackProvider onOpenFeedback={openFeedback}>
      <DashboardPage />
    </FeedbackProvider>
  );
  return api;
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("DashboardPage", () => {
  it("shows the recent 30-day operational summary and performance sections", async () => {
    const api = await renderDashboardPage();

    expect(await screen.findByRole("heading", { name: "전체 현황" })).toBeVisible();
    expect(screen.getByText("최근 30일 · 2026. 7. 16. 기준")).toBeVisible();
    const summary = screen.getByLabelText("최근 30일 요약");
    expect(within(summary).getByText("발행 완료")).toBeVisible();
    expect(within(summary).getByText("12건")).toBeVisible();
    expect(within(summary).getByText("8,430회")).toBeVisible();
    expect(within(summary).getByText("3건")).toBeVisible();
    expect(within(summary).getByText("1건")).toBeVisible();
    expect(screen.getByRole("heading", { name: "현재 콘텐츠 운영 흐름" })).toBeVisible();
    expect(screen.getByRole("img", { name: /2026년 7월 15일.*1,280회.*2026년 7월 16일.*1,650회/ })).toBeVisible();
    expect(screen.getByRole("heading", { name: "채널별 성과" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "성과가 좋았던 콘텐츠" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "확인 필요" })).toBeVisible();
    expect(screen.getByText("여름 캠페인 운영 가이드")).toBeVisible();
    expect(api.getDashboard).toHaveBeenCalledWith("brand-1");
  });

  it("opens shared feedback from the feature suggestion banner", async () => {
    const user = userEvent.setup();
    const openFeedback = vi.fn();
    await renderDashboardPage(undefined, undefined, openFeedback);

    await user.click(await screen.findByRole("button", { name: "기능 제안하기" }));

    expect(openFeedback).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: "기능 제안하기" })).not.toBeInTheDocument();
  });

  it("loads and shows a published artifact only after opening its performance detail", async () => {
    const user = userEvent.setup();
    const api = await renderDashboardPage();

    const detailButton = await screen.findByRole("button", { name: "여름 캠페인 운영 가이드 상세 보기" });
    expect(api.getPublishArtifact).not.toHaveBeenCalled();

    await user.click(detailButton);

    expect(api.getPublishArtifact).toHaveBeenCalledWith("queue-1");
    const dialog = await screen.findByRole("dialog", { name: "여름 캠페인 운영 가이드" });
    expect(within(dialog).getByTestId("artifact-primary-image")).toHaveAttribute("src", "https://cdn.example.com/card-1.png");
    expect(within(dialog).getByText("Instagram")).toBeVisible();
    expect(within(dialog).getByText("카드뉴스")).toBeVisible();
    expect(within(dialog).getByText("3,400회")).toBeVisible();
    expect(within(dialog).getByRole("link", { name: "원본 게시물 보기" })).toHaveAttribute(
      "href",
      "https://instagram.com/p/post-1"
    );
  });

  it("renders distinct channel exposure series and only legends channels with data", async () => {
    await renderDashboardPage();

    const chart = await screen.findByRole("img", {
      name: /2026년 7월 15일.*합계 1,280회.*Instagram 1,200회.*Threads 80회/
    });
    expect(chart.querySelectorAll(".dashboard-chart__bar.is-instagram")).toHaveLength(2);
    expect(chart.querySelectorAll(".dashboard-chart__bar.is-threads")).toHaveLength(1);

    const legend = screen.getByRole("list", { name: "조회·노출 채널 범례" });
    expect(within(legend).getByText("Instagram")).toBeVisible();
    expect(within(legend).getByText("Threads")).toBeVisible();
    expect(within(legend).queryByText("LinkedIn")).not.toBeInTheDocument();
  });

  it("keeps honest no-data labels for disconnected and uncollected channels", async () => {
    await renderDashboardPage(vi.fn(async () => ({
      ...dashboard,
      summary: { ...dashboard.summary, exposureCount: null },
      channelPerformance: dashboard.channelPerformance.map((item) => (
        item.channel === "instagram" ? { ...item, exposureCount: null } : item
      )),
      topContents: [{ ...dashboard.topContents[0], exposureCount: null }]
    })));

    expect(await screen.findByRole("heading", { name: "전체 현황" })).toBeVisible();
    expect(screen.getByLabelText("최근 30일 요약")).toHaveTextContent("데이터 없음");
    const linkedin = screen.getByRole("row", { name: /LinkedIn/ });
    expect(linkedin).toHaveTextContent("연결 전");
    expect(linkedin).not.toHaveTextContent(/\d+[회건]/);
    expect(screen.getAllByText("데이터 없음").length).toBeGreaterThan(1);
  });

  it("shows successful channel data together with partial-failure attention", async () => {
    await renderDashboardPage();

    const instagram = await screen.findByRole("row", { name: /Instagram/ });
    expect(instagram).toHaveTextContent("8,300회");
    expect(screen.queryByText(/Webflow/i)).not.toBeInTheDocument();
    expect(screen.getByText("채널 성과 일부를 수집하지 못했습니다.")).toBeVisible();
    expect(screen.queryByText(/secret-value|stack trace/i)).not.toBeInTheDocument();
  });

  it("shows the same channel attention only once", async () => {
    await renderDashboardPage(vi.fn(async () => ({
      ...dashboard,
      attentionItems: [
        ...dashboard.attentionItems,
        { ...dashboard.attentionItems[0] }
      ]
    })));

    expect(await screen.findByRole("heading", { name: "전체 현황" })).toBeVisible();
    expect(screen.getAllByText("채널 성과 일부를 수집하지 못했습니다.")).toHaveLength(1);
  });

  it("keeps the owned customer UI runtime limited to six channels", () => {
    const runtimeFiles = [
      "src/types.ts",
      "src/pages/PublishQueuePage.tsx",
      "src/pages/DashboardPage.tsx",
      "src/components/publish/TopicPublishGroup.tsx",
      "src/lib/apiClient.ts",
      "src/styles/prototype.css"
    ];

    for (const file of runtimeFiles) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/webflow/i);
    }
  });

  it("shows explicit empty states without inventing figures", async () => {
    await renderDashboardPage(vi.fn(async () => ({
      ...dashboard,
      lastCollectedAt: null,
      summary: { publishedCount: 0, exposureCount: null, pendingReviewCount: 0, failedPublishCount: 0 },
      workflow: { queuedTopics: 0, generating: 0, pendingReview: 0, scheduledOrPublished: 0 },
      dailyExposure: [],
      channelPerformance: [],
      topContents: [],
      attentionItems: []
    })));

    expect(await screen.findByText("표시할 일별 조회·노출 데이터가 없습니다.")).toBeVisible();
    expect(screen.getByText("표시할 채널 성과가 없습니다.")).toBeVisible();
    expect(screen.getByText("최근 30일에 성과가 수집된 콘텐츠가 없습니다.")).toBeVisible();
    expect(screen.getByText("현재 확인할 항목이 없습니다.")).toBeVisible();
    expect(screen.getByText(/아직 수집되지 않음/)).toBeVisible();
  });

  it("shows loading and retryable error states", async () => {
    let rejectRequest: ((reason: Error) => void) | undefined;
    await renderDashboardPage(vi.fn(() => new Promise((_resolve, reject) => { rejectRequest = reject; })));

    expect(await screen.findByRole("status", { name: "대시보드를 불러오는 중입니다." })).toHaveClass("skeleton-page");
    await act(async () => rejectRequest?.(new Error("network_error")));
    expect(await screen.findByRole("alert")).toHaveTextContent("대시보드를 불러오지 못했습니다.");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeVisible();
  });
});
