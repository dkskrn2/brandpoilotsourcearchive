import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackProvider, useFeedback } from "../components/feedback/FeedbackContext";
import type { Dashboard, PublishArtifact } from "../types";
import type { ContentSuggestionList } from "../features/content-suggestions/contentSuggestionGateway";

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

const suggestion = (id: string, title: string) => ({
  id,
  subcategoryCode: id.startsWith("personal") ? "skin-care" : "makeup",
  subcategoryName: id.startsWith("personal") ? "스킨케어" : "메이크업",
  intent: id.endsWith("trend") ? "trend" as const : "informational" as const,
  title,
  whyNow: "지금 고객의 관심이 커지고 있습니다.",
  contentBrief: `${title}를 브랜드 관점에서 설명합니다.`,
});

function Location() {
  return <span data-testid="dashboard-location">{useLocation().search}</span>;
}

async function renderDashboardPage(
  getDashboard: ApiMock["getDashboard"] = vi.fn(async () => dashboard),
  getPublishArtifact: ApiMock["getPublishArtifact"] = vi.fn(async () => artifact),
  openFeedback = vi.fn(),
  suggestionList: ContentSuggestionList | Error = { category: null, personal: [], general: [] },
  suggestionRetryList: ContentSuggestionList = { category: null, personal: [], general: [] },
) {
  const api = { getDashboard, getPublishArtifact };
  vi.doMock("../lib/apiClient", () => ({
    DEMO_BRAND_ID: "brand-1",
    api,
    apiClient: vi.fn(() => ({})),
  }));
  vi.doMock("../components/feedback/FeedbackContext", () => ({ FeedbackProvider, useFeedback }));
  const { DashboardPage } = await import("../pages/DashboardPage");
  const suggestionGateway = {
    list: vi.fn(async () => {
      if (suggestionList instanceof Error && suggestionGateway.list.mock.calls.length === 1) throw suggestionList;
      if (suggestionList instanceof Error) return suggestionRetryList;
      return suggestionList;
    }),
    get: vi.fn(),
  };
  render(
    <MemoryRouter>
      <FeedbackProvider onOpenFeedback={openFeedback}>
        <DashboardPage brandId="brand-1" suggestionGateway={suggestionGateway} />
        <Location />
      </FeedbackProvider>
    </MemoryRouter>
  );
  return Object.assign(api, { suggestionGateway });
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("DashboardPage", () => {
  it("shows at most six personal-first suggestions and opens the existing content flow", async () => {
    const user = userEvent.setup();
    const suggestionList: ContentSuggestionList = {
      category: { code: "beauty", name: "뷰티" },
      personal: [
        suggestion("personal-1", "내 스킨케어 주제"),
        suggestion("personal-2-trend", "내 트렌드 주제"),
      ],
      general: [
        suggestion("general-1", "일반 주제 1"),
        suggestion("general-2", "일반 주제 2"),
        suggestion("general-3", "일반 주제 3"),
        suggestion("general-4", "일반 주제 4"),
        suggestion("general-5", "일반 주제 5"),
      ],
    };
    await renderDashboardPage(undefined, undefined, undefined, suggestionList);

    const section = await screen.findByRole("region", { name: "오늘의 콘텐츠 추천" });
    expect(within(section).getAllByRole("article")).toHaveLength(6);
    expect(within(section).getByText("내 스킨케어 주제")).toBeVisible();
    expect(within(section).getByText("일반 주제 4")).toBeVisible();
    expect(within(section).queryByText("일반 주제 5")).not.toBeInTheDocument();
    expect(within(section).queryByText(/내 세부분야 추천|출처|\d{4}[.-]\d{1,2}[.-]\d{1,2}/)).not.toBeInTheDocument();

    const firstCard = within(section).getByText("내 스킨케어 주제").closest("article")!;
    const createButton = within(firstCard).getByRole("button", { name: "AI 콘텐츠로 만들기" });
    expect(createButton).toHaveClass("button", "primary");
    await user.click(createButton);
    expect(screen.getByTestId("dashboard-location")).toHaveTextContent("?view=today&suggestionId=personal-1");
  });

  it("keeps the dashboard available and retries failed recommendations", async () => {
    const user = userEvent.setup();
    const retryList: ContentSuggestionList = {
      category: { code: "beauty", name: "뷰티" },
      personal: [suggestion("personal-retry", "다시 불러온 추천")],
      general: [],
    };
    const result = await renderDashboardPage(
      undefined,
      undefined,
      undefined,
      new Error("suggestions_unavailable"),
      retryList,
    );

    expect(await screen.findByRole("heading", { name: "오늘의 운영 현황" })).toBeVisible();
    const section = await screen.findByRole("region", { name: "오늘의 콘텐츠 추천" });
    expect(within(section).getByRole("alert")).toHaveTextContent("오늘의 콘텐츠 추천을 불러오지 못했습니다");
    await user.click(within(section).getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("다시 불러온 추천")).toBeVisible();
    expect(result.suggestionGateway.list).toHaveBeenCalledTimes(2);
  });

  it("uses the global line token for suggestion cards rendered outside the wizard", () => {
    const css = readFileSync("src/styles/content-wizard.css", "utf8");
    expect(css).toMatch(/\.content-suggestion-card\s*\{[\s\S]*?border:\s*1px solid var\(--bp-color-line\)/);
  });

  it("shows the recent 30-day operational summary and performance sections", async () => {
    const api = await renderDashboardPage();

    expect(await screen.findByRole("heading", { name: "오늘의 운영 현황" })).toBeVisible();
    expect(screen.getByText("최근 30일 · 2026. 7. 16. 기준")).toBeVisible();
    expect(screen.getByRole("link", { name: "콘텐츠 만들기" })).toHaveAttribute("href", "/ai-content/new");
    expect(screen.getByRole("link", { name: "브랜드 검토하기" })).toHaveAttribute(
      "href",
      "/brand-center?tab=understanding&section=core",
    );
    const summary = screen.getByLabelText("최근 30일 요약");
    expect(within(summary).getByText("발행 완료")).toBeVisible();
    expect(within(summary).getByText("12건")).toBeVisible();
    expect(within(summary).getByText("8,430회")).toBeVisible();
    expect(within(summary).getByText("3건")).toBeVisible();
    expect(within(summary).getByText("1건")).toBeVisible();
    expect(screen.getByRole("heading", { name: "오늘의 우선 작업" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "오늘의 사용량" })).toBeVisible();
    expect(screen.getByText("사용량 데이터를 불러올 수 없습니다.")).toBeVisible();
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
    await user.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog", { name: "여름 캠페인 운영 가이드" })).not.toBeInTheDocument();
    expect(detailButton).toHaveFocus();
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

    expect(await screen.findByRole("heading", { name: "오늘의 운영 현황" })).toBeVisible();
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

    expect(await screen.findByRole("heading", { name: "오늘의 운영 현황" })).toBeVisible();
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
