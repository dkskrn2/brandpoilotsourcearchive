import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { ContentOutput, PublishArtifact, PublishCalendarSlot, PublishResult, PublishSlot } from "../types";

const prototypeCss = readFileSync("src/styles/prototype.css", "utf8");
const publishCalendarSource = readFileSync("src/components/publish/PublishCalendar.tsx", "utf8");

const queueRows: PublishSlot[] = [
  {
    id: "queue-topic",
    channel: "instagram",
    time: "11:35",
    title: "제주 가족 숙소 카드뉴스",
    approvalType: "manual",
    status: "scheduled",
    sourceType: "mixed",
    sourceLabel: "가족 숙소 체크리스트",
    sourceDetail: "위치 중심 | https://example.com/reference | 자사 FAQ 요약",
    sourceUrls: ["https://brand.example.com/faq"],
    queuedAt: "2026-07-07T01:10:00.000Z",
    lastError: null
  },
  {
    id: "queue-waiting",
    channel: "threads",
    time: "대기",
    title: "정책 배정 대기 콘텐츠",
    approvalType: "auto",
    status: "queued",
    sourceType: "topic_table",
    sourceLabel: "대기 주제",
    sourceDetail: null,
    sourceUrls: [],
    queuedAt: "2026-07-07T01:15:00.000Z",
    lastError: null
  },
  {
    id: "queue-published",
    channel: "instagram",
    time: "20:31",
    title: "완료된 카드뉴스",
    approvalType: "manual",
    status: "published",
    sourceType: "topic_table",
    sourceLabel: "완료 주제",
    sourceDetail: "정방형 카드뉴스",
    sourceUrls: ["https://brand.example.com/story"],
    queuedAt: "2026-07-07T01:30:00.000Z",
    lastError: null
  }
];

const groupedQueueRows = [{
  id: "queue-instagram",
  channel: "instagram",
  time: "11:30",
  title: "제주 가족 숙소 카드뉴스",
  approvalType: "manual",
  status: "published",
  topicPublishGroupId: "publish-group-1",
  slotDate: "2026-07-14",
  slotNumber: 1,
  scheduledFor: "2026-07-14T02:30:00.000Z",
  sourceType: "mixed",
  sourceLabel: "가족 숙소 체크리스트",
  sourceDetail: "위치 중심 | 자사 FAQ 요약",
  sourceUrls: ["https://brand.example.com/faq"],
  queuedAt: "2026-07-14T01:10:00.000Z",
  lastError: null
}, {
  id: "queue-threads",
  channel: "threads",
  time: "11:30",
  title: "제주 가족 숙소 카드뉴스",
  approvalType: "manual",
  status: "failed",
  topicPublishGroupId: "publish-group-1",
  slotDate: "2026-07-14",
  slotNumber: 1,
  scheduledFor: "2026-07-14T02:30:00.000Z",
  sourceType: "mixed",
  sourceLabel: "가족 숙소 체크리스트",
  sourceDetail: "위치 중심 | 자사 FAQ 요약",
  sourceUrls: ["https://brand.example.com/faq"],
  queuedAt: "2026-07-14T01:10:00.000Z",
  lastError: "Threads access token expired"
}] as unknown as PublishSlot[];

const legacyQueueRows = [{
  ...groupedQueueRows[0],
  id: "legacy-output-instagram",
  topicPublishGroupId: null
}, {
  ...groupedQueueRows[0],
  id: "legacy-output-threads",
  channel: "threads",
  topicPublishGroupId: null
}] as PublishSlot[];

const reviewOutputs: ContentOutput[] = [{
  id: "output-review",
  contentId: "master-review",
  title: "검토할 인스타 콘텐츠",
  channel: "instagram",
  status: "pending_review",
  topicId: "topic-1",
  generatedAt: "2026-07-08T01:00:00.000Z",
  sourceSummary: "자사 FAQ 요약",
  previewTitle: "제주 숙소 선택 기준",
  previewBody: "캡션 내용",
  outputJson: {
    generationState: "completed",
    artifactStatus: "ready",
    deliveryFormat: "instagram_feed_carousel"
  }
}, {
  id: "output-blocked",
  contentId: "master-blocked",
  title: "차단된 Threads 콘텐츠",
  channel: "threads",
  status: "auto_approval_blocked",
  topicId: "topic-2",
  generatedAt: "2026-07-08T01:05:00.000Z",
  sourceSummary: "외부 참고 URL 요약",
  previewTitle: "차단 미리보기",
  previewBody: "Threads 본문",
  blockReasons: ["외부 참고 URL 의존도가 높습니다."]
}, {
  id: "output-generating",
  contentId: "master-generating",
  title: "생성 중인 X 콘텐츠",
  channel: "x",
  status: "generating" as ContentOutput["status"],
  topicId: "topic-3",
  generatedAt: "2026-07-08T01:10:00.000Z",
  sourceSummary: "주제 정보",
  previewTitle: "생성 중",
  previewBody: ""
}, {
  id: "output-generation-failed",
  contentId: "master-generation-failed",
  title: "생성 실패한 LinkedIn 콘텐츠",
  channel: "linkedin",
  status: "generation_failed" as ContentOutput["status"],
  topicId: "topic-4",
  generatedAt: "2026-07-08T01:15:00.000Z",
  sourceSummary: "자사 서비스 페이지",
  previewTitle: "생성 실패",
  previewBody: "",
  outputJson: {
    generationError: {
      code: "text_render_failed",
      message: "provider token=secret-value",
      failedAt: "2026-07-08T01:16:00.000Z"
    }
  }
}];

const publishResults: PublishResult[] = [{
  contentId: "master-1",
  title: "제주 가족 숙소 카드뉴스",
  generatedAt: "2026-07-08T01:00:00.000Z",
  sourceType: "mixed",
  sourceLabel: "가족 숙소 체크리스트",
  sourceDetail: "위치 중심 | 자사 FAQ 요약",
  sourceUrls: ["https://brand.example.com/faq"],
  channels: [{
    queueId: "queue-instagram",
    channelOutputId: "output-instagram",
    channel: "instagram",
    status: "published",
    publishedAt: "2026-07-08T02:30:00.000Z",
    failedAt: null,
    title: "인스타 카드뉴스",
    previewTitle: "제주 숙소 선택 기준",
    previewBody: "캡션 내용",
    outputJson: { deliveryFormat: "instagram_reel", caption: "캡션 내용", slides: [{ title: "숙소 기준" }] },
    artifactPublicUrl: "https://cdn.example.com/instagram/manifest.json",
    externalPostId: "ig-post-1",
    externalUrl: "https://instagram.com/reel/ig-post-1",
    lastError: null,
    sourceSummary: "자사 FAQ 요약"
  }, {
    queueId: "queue-threads",
    channelOutputId: "output-threads",
    channel: "threads",
    status: "failed",
    publishedAt: null,
    failedAt: "2026-07-08T02:31:00.000Z",
    title: "Threads 게시글",
    previewTitle: "제주 숙소 선택 기준",
    previewBody: "Threads 본문",
    outputJson: { deliveryFormat: "threads_text", text: "Threads 본문" },
    artifactPublicUrl: null,
    externalPostId: null,
    externalUrl: null,
    lastError: "token expired",
    sourceSummary: "자사 FAQ 요약"
  }]
}, {
  contentId: "master-2",
  title: "게시 대기 상태 콘텐츠",
  generatedAt: "2026-07-08T02:00:00.000Z",
  sourceType: "source_url",
  sourceLabel: "크롤링 근거",
  sourceDetail: "외부 참고 요약",
  sourceUrls: ["https://example.com/reference"],
  channels: [{
    queueId: "queue-instagram-waiting",
    channelOutputId: "output-instagram-waiting",
    channel: "instagram",
    status: "queued",
    publishedAt: null,
    failedAt: null,
    title: "대기 인스타 카드뉴스",
    previewTitle: "대기 미리보기",
    previewBody: "대기 본문",
    outputJson: { caption: "대기 본문" },
    artifactPublicUrl: null,
    externalPostId: null,
    externalUrl: null,
    lastError: null,
    sourceSummary: "외부 참고 요약"
  }, {
    queueId: "queue-threads-publishing",
    channelOutputId: "output-threads-publishing",
    channel: "threads",
    status: "publishing",
    publishedAt: null,
    failedAt: null,
    title: "게시 중 Threads",
    previewTitle: "게시 중 미리보기",
    previewBody: "게시 중 본문",
    outputJson: { text: "게시 중 본문" },
    artifactPublicUrl: null,
    externalPostId: null,
    externalUrl: null,
    lastError: null,
    sourceSummary: "외부 참고 요약"
  }]
}];

const imageArtifact: PublishArtifact = {
  queueId: "queue-instagram",
  kind: "image_gallery",
  deliveryFormat: "instagram_feed_carousel",
  assets: [{
    url: "https://cdn.example.com/card-01.png",
    fileName: "card-01.png",
    mimeType: "image/png",
    width: 1080,
    height: 1080
  }, {
    url: "https://cdn.example.com/card-02.png",
    fileName: "card-02.png",
    mimeType: "image/png",
    width: 1080,
    height: 1080
  }],
  posterUrl: null,
  html: null,
  text: null
};

const preLlmQueueRows: PublishSlot[] = [{
  id: "topic:content-topic-1",
  channel: "instagram",
  time: "대기",
  title: "부동산 지고 주식 뜬다?",
  approvalType: "empty",
  status: "queued",
  sourceType: "source_url",
  sourceLabel: "크롤링 근거",
  sourceDetail: null,
  sourceUrls: ["https://blog.opensurvey.co.kr/article/finance-2026-2/"],
  queuedAt: "2026-07-08T01:10:00.000Z",
  lastError: null
}];

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/publish-queue");
  vi.resetModules();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function renderPublishQueuePage(apiOverrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  const api = {
    listContentOutputs: vi.fn(async () => []),
    reviewContentOutput: vi.fn(async (outputId: string, action: "approve" | "reject" | "regenerate") => ({
      id: outputId,
      status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "regenerating"
    })),
    generateContent: vi.fn(async () => ({ processed: 1, created: 3, updated: 1, failed: 0 })),
    listPublishQueue: vi.fn(async () => []),
    listPublishResults: vi.fn(async () => []),
    getContentOutputArtifact: vi.fn(async () => ({ ...imageArtifact, queueId: "output-review" })),
    getPublishArtifact: vi.fn(async () => imageArtifact),
    downloadPublishResult: vi.fn(async () => ({
      fileName: "queue-result.zip",
      blob: new Blob(["queue-zip-content"], { type: "application/zip" })
    })),
    schedulePublishQueue: vi.fn(async () => ({ processed: 2, created: 0, updated: 2, failed: 0 })),
    publishQueueItem: vi.fn(async () => ({ id: "queue-topic", status: "published", publishedUrl: "mock://instagram/queue-topic" })),
    retryPublishQueueItem: vi.fn(async () => ({ id: "queue-threads", status: "queued" })),
    cancelPublishQueueItem: vi.fn(async () => ({ id: "queue-topic", status: "cancelled" })),
    ...apiOverrides
  };
  vi.doMock("../lib/apiClient", () => ({
    DEMO_BRAND_ID: "brand-1",
    api
  }));
  const { PublishQueuePage } = await import("../pages/PublishQueuePage");
  await act(async () => {
    render(<PublishQueuePage />);
  });
  return api;
}

describe("PublishQueuePage", () => {
  it("keeps calendar reads isolated until the calendar tab is selected", async () => {
    const listChannels = vi.fn(async () => []);
    const getPublishCalendarSettings = vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null }));
    const listPublishCalendarSlots = vi.fn(async () => []);
    await renderPublishQueuePage({ listChannels, getPublishCalendarSettings, listPublishCalendarSlots });

    await screen.findByRole("region", { name: "게시 관리 통합 목록" });
    expect(listChannels).not.toHaveBeenCalled();
    expect(getPublishCalendarSettings).not.toHaveBeenCalled();
    expect(listPublishCalendarSlots).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    await screen.findByRole("grid", { name: "게시 캘린더" });
    expect(listChannels).toHaveBeenCalledWith("brand-1");
    expect(getPublishCalendarSettings).toHaveBeenCalledWith("brand-1");
    expect(listPublishCalendarSlots).toHaveBeenCalled();
  });

  it("shows an accessible calendar-slot loading state before rendering empty controls", async () => {
    const pendingSlots = new Promise<PublishCalendarSlot[]>(() => undefined);
    await renderPublishQueuePage({
      listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]),
      getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })),
      listPublishCalendarSlots: vi.fn(() => pendingSlots)
    });
    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    expect(await screen.findByRole("status", { name: "캘린더 슬롯을 불러오는 중입니다." })).toBeVisible();
    expect(screen.queryByRole("button", { name: "수동 슬롯 추가" })).not.toBeInTheDocument();
  });

  it("clears prior-month slots and manual controls while the next month loads", async () => {
    const previousSlot: PublishCalendarSlot = { id: "previous-slot", workspaceId: "w", brandId: "brand-1", scheduledFor: "2026-08-15T02:30:00.000Z", assignmentMode: "manual", status: "scheduled", recommendationKind: null, contentFormat: "card_news", channels: ["instagram"], contentSuggestionId: null, proposalId: null, generationId: null, generationOutputId: null, topicPublishGroupId: null, title: "이전 달 예약", lastError: null, updatedAt: "2026-08-14T00:00:00.000Z" };
    const pendingNextMonth = new Promise<PublishCalendarSlot[]>(() => undefined);
    const listPublishCalendarSlots = vi.fn()
      .mockResolvedValueOnce([previousSlot])
      .mockImplementationOnce(() => pendingNextMonth);
    await renderPublishQueuePage({
      listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]),
      getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })),
      listPublishCalendarSlots
    });

    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    expect(await screen.findByRole("button", { name: "이전 달 예약 슬롯 상세 보기" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "다음 달" }));

    expect(await screen.findByRole("status", { name: "캘린더 슬롯을 불러오는 중입니다." })).toBeVisible();
    expect(screen.queryByRole("button", { name: "이전 달 예약 슬롯 상세 보기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "수동 슬롯 추가" })).not.toBeInTheDocument();
  });

  it("keeps loaded slots visible when settings are unavailable and blocks a writable settings form", async () => {
    const slot: PublishCalendarSlot = { id: "slot-settings-fail", workspaceId: "w", brandId: "brand-1", scheduledFor: "2026-08-15T02:30:00.000Z", assignmentMode: "manual", status: "open", recommendationKind: null, contentFormat: "card_news", channels: ["instagram"], contentSuggestionId: null, proposalId: null, generationId: null, generationOutputId: null, topicPublishGroupId: null, title: "보존된 예약", lastError: null, updatedAt: "2026-08-14T00:00:00.000Z" };
    await renderPublishQueuePage({
      listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]),
      getPublishCalendarSettings: vi.fn(async () => { throw new Error("settings_down"); }),
      listPublishCalendarSlots: vi.fn(async () => [slot])
    });
    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    expect(await screen.findByRole("button", { name: "보존된 예약 슬롯 상세 보기" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "자동 게시 설정" }));
    const dialog = screen.getByRole("dialog", { name: "자동 게시 설정" });
    expect(within(dialog).getByText("설정을 불러온 뒤에만 변경할 수 있습니다.")).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "설정 저장" })).not.toBeInTheDocument();
  });

  it("keeps failed settings saves open and reports the server error", async () => {
    await renderPublishQueuePage({
      listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]),
      getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })),
      listPublishCalendarSlots: vi.fn(async () => []),
      savePublishCalendarSettings: vi.fn(async () => { throw new Error("save_down"); })
    });
    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    await userEvent.click(screen.getByRole("button", { name: "자동 게시 설정" }));
    await userEvent.click(screen.getByRole("button", { name: "설정 저장" }));
    const dialog = await screen.findByRole("dialog", { name: "자동 게시 설정" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("자동 게시 설정을 저장하지 못했습니다.");
  });

  it("uses arrow-key tabs with a labelled tabpanel", async () => {
    await renderPublishQueuePage();
    const listTab = screen.getByRole("tab", { name: "목록" });
    expect(listTab).toHaveAttribute("aria-controls", "publish-view-panel");
    listTab.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "캘린더" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "publish-view-tab-calendar");
  });

  it("refreshes the operating list after cancelling a calendar slot", async () => {
    const slot: PublishCalendarSlot = { id: "cancel-slot", workspaceId: "w", brandId: "brand-1", scheduledFor: "2026-08-15T02:30:00.000Z", assignmentMode: "manual", status: "scheduled", recommendationKind: null, contentFormat: "card_news", channels: ["instagram"], contentSuggestionId: null, proposalId: null, generationId: null, generationOutputId: null, topicPublishGroupId: null, title: "취소할 슬롯", lastError: null, updatedAt: "2026-08-14T00:00:00.000Z" };
    const listPublishQueue = vi.fn(async () => []);
    const listPublishResults = vi.fn(async () => []);
    await renderPublishQueuePage({ listPublishQueue, listPublishResults, listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]), getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })), listPublishCalendarSlots: vi.fn(async () => [slot]), cancelPublishCalendarSlot: vi.fn(async () => ({ ...slot, status: "cancelled" })) });
    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "취소할 슬롯 슬롯 상세 보기" }));
    await userEvent.click(screen.getByRole("button", { name: "슬롯 취소" }));
    await screen.findByText("게시 슬롯을 취소했습니다.");
    expect(listPublishQueue).toHaveBeenCalledTimes(2);
    expect(listPublishResults).toHaveBeenCalledTimes(2);
  });

  it("keeps the existing list as the default and switches to the calendar view", async () => {
    await renderPublishQueuePage();

    expect(await screen.findByRole("region", { name: "게시 관리 통합 목록" })).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));

    expect(screen.getByRole("grid", { name: "게시 캘린더" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "게시 관리 통합 목록" })).not.toBeInTheDocument();
  });

  it("shows the backend-provided trend assignment and format in an automatic slot detail", async () => {
    const slot: PublishCalendarSlot = {
      id: "calendar-trend", workspaceId: "workspace-1", brandId: "brand-1", scheduledFor: "2026-08-15T02:30:00.000Z",
      assignmentMode: "automatic", status: "proposal_assigned", recommendationKind: "trend", contentFormat: "reel", channels: ["instagram"],
      contentSuggestionId: "suggestion-1", proposalId: null, generationId: null, generationOutputId: null, topicPublishGroupId: null,
      title: "이번 주 트렌드", lastError: null, updatedAt: "2026-08-14T00:00:00.000Z"
    };
    await renderPublishQueuePage({
      listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]),
      getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: true, channels: ["instagram"], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })),
      listPublishCalendarSlots: vi.fn(async () => [slot])
    });

    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "이번 주 트렌드 슬롯 상세 보기" }));

    const detail = screen.getByRole("complementary", { name: "이번 주 트렌드 슬롯 상세" });
    expect(within(detail).getByText("트렌드성 추천")).toBeVisible();
    expect(within(detail).getByText("릴스")).toBeVisible();
  });

  it("offers only UUID-backed topic groups when assigning an open calendar slot", async () => {
    const slot: PublishCalendarSlot = {
      id: "calendar-open", workspaceId: "workspace-1", brandId: "brand-1", scheduledFor: "2026-08-15T02:30:00.000Z",
      assignmentMode: "manual", status: "open", recommendationKind: null, contentFormat: "card_news", channels: ["instagram"],
      contentSuggestionId: null, proposalId: null, generationId: null, generationOutputId: null, topicPublishGroupId: null,
      title: null, lastError: null, updatedAt: "2026-08-14T00:00:00.000Z"
    };
    const topicPublishGroupId = "5e6a1b07-6e1a-4e8e-b0a5-8d8e6ef7b123";
    const assignPublishCalendarSlot = vi.fn(async () => ({ ...slot, status: "content_assigned", topicPublishGroupId, title: "제주 가족 숙소 카드뉴스" }));
    await renderPublishQueuePage({
      listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]),
      getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })),
      listPublishCalendarSlots: vi.fn(async () => [slot]),
      listPublishQueue: vi.fn(async () => [{ ...groupedQueueRows[0], status: "queued", topicPublishGroupId }, { ...legacyQueueRows[0], status: "queued", title: "이전 방식 콘텐츠" }]),
      assignPublishCalendarSlot
    });

    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "수동 배정 대기 슬롯 상세 보기" }));
    const selector = screen.getByLabelText("배정할 콘텐츠");
    expect(within(selector).getByRole("option", { name: "제주 가족 숙소 카드뉴스" })).toHaveValue(topicPublishGroupId);
    expect(within(selector).queryByRole("option", { name: "이전 방식 콘텐츠" })).not.toBeInTheDocument();
    await userEvent.selectOptions(selector, topicPublishGroupId);
    await userEvent.click(screen.getByRole("button", { name: "선택 콘텐츠 배정" }));

    expect(assignPublishCalendarSlot).toHaveBeenCalledWith("brand-1", "calendar-open", { topicPublishGroupId, title: "제주 가족 숙소 카드뉴스" });
  });

  it("resets the selected assignment when another open slot is selected and after assignment succeeds", async () => {
    const slot = (id: string, title: string): PublishCalendarSlot => ({ id, workspaceId: "workspace-1", brandId: "brand-1", scheduledFor: "2026-08-15T02:30:00.000Z", assignmentMode: "manual", status: "open", recommendationKind: null, contentFormat: "card_news", channels: ["instagram"], contentSuggestionId: null, proposalId: null, generationId: null, generationOutputId: null, topicPublishGroupId: null, title, lastError: null, updatedAt: "2026-08-14T00:00:00.000Z" });
    const topicPublishGroupId = "5e6a1b07-6e1a-4e8e-b0a5-8d8e6ef7b123";
    const slotA = slot("calendar-open-a", "슬롯 A");
    const slotB = slot("calendar-open-b", "슬롯 B");
    const assignPublishCalendarSlot = vi.fn(async () => ({ ...slotA, title: "슬롯 A", topicPublishGroupId }));
    await renderPublishQueuePage({
      listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]),
      getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })),
      listPublishCalendarSlots: vi.fn(async () => [slotA, slotB]),
      listPublishQueue: vi.fn(async () => [{ ...groupedQueueRows[0], status: "queued", topicPublishGroupId }]),
      assignPublishCalendarSlot
    });

    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "슬롯 A 슬롯 상세 보기" }));
    await userEvent.selectOptions(screen.getByLabelText("배정할 콘텐츠"), topicPublishGroupId);
    await userEvent.click(screen.getByRole("button", { name: "슬롯 B 슬롯 상세 보기" }));
    expect(screen.getByLabelText("배정할 콘텐츠")).toHaveValue("");

    await userEvent.click(screen.getByRole("button", { name: "슬롯 A 슬롯 상세 보기" }));
    await userEvent.selectOptions(screen.getByLabelText("배정할 콘텐츠"), topicPublishGroupId);
    await userEvent.click(screen.getByRole("button", { name: "선택 콘텐츠 배정" }));
    await screen.findByText("선택한 콘텐츠를 슬롯에 배정했습니다.");
    expect(screen.getByLabelText("배정할 콘텐츠")).toHaveValue("");
  });

  it("saves automatic Instagram settings with selected recommendation formats and slot times", async () => {
    const savePublishCalendarSettings = vi.fn(async (_brandId: string, input: Record<string, unknown>) => ({ brandId: "brand-1", ...input, updatedAt: null }));
    await renderPublishQueuePage({
      listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]),
      getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })),
      listPublishCalendarSlots: vi.fn(async () => []),
      savePublishCalendarSettings
    });

    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    await userEvent.click(screen.getByRole("button", { name: "자동 게시 설정" }));
    await userEvent.click(screen.getByRole("switch", { name: /사용 안 함/ }));
    await userEvent.click(within(screen.getByRole("group", { name: "정보성 추천 형식" })).getByRole("radio", { name: "릴스" }));
    const slotTimes = screen.getByRole("dialog", { name: "자동 게시 설정" }).querySelector<HTMLInputElement>('input[aria-label="게시 시간"]')!;
    await userEvent.clear(slotTimes);
    await userEvent.type(slotTimes, "09:00, 18:00");
    await userEvent.click(screen.getByRole("button", { name: "설정 저장" }));

    expect(savePublishCalendarSettings).toHaveBeenCalledWith("brand-1", {
      enabled: true, channels: ["instagram"], informationalFormat: "reel", trendFormat: "reel", slotTimes: ["09:00", "18:00"]
    });
  });

  it("creates a manual Instagram-only slot from the selected date", async () => {
    const createPublishCalendarSlot = vi.fn(async (_brandId: string, input: Record<string, unknown>) => ({
      id: "manual-slot", workspaceId: "workspace-1", brandId: "brand-1", assignmentMode: "manual", status: "open", recommendationKind: null,
      contentSuggestionId: null, proposalId: null, generationId: null, generationOutputId: null, topicPublishGroupId: null, title: null, lastError: null, updatedAt: "2026-08-14T00:00:00.000Z", ...input
    }));
    await renderPublishQueuePage({
      listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]),
      getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })),
      listPublishCalendarSlots: vi.fn(async () => []),
      createPublishCalendarSlot
    });

    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    await userEvent.click(screen.getByRole("button", { name: "다음 달" }));
    await screen.findByRole("button", { name: "수동 슬롯 추가" });
    await userEvent.clear(screen.getByLabelText("수동 게시 시간"));
    await userEvent.type(screen.getByLabelText("수동 게시 시간"), "15:20");
    await userEvent.selectOptions(screen.getByLabelText("수동 콘텐츠 형식"), "reel");
    await userEvent.click(screen.getByRole("button", { name: "수동 슬롯 추가" }));

    expect(createPublishCalendarSlot).toHaveBeenCalledWith("brand-1", expect.objectContaining({ contentFormat: "reel", channels: ["instagram"], scheduledFor: expect.stringMatching(/T06:20:00\.000Z$/) }));
  });

  it("blocks creation of a manual slot at a known past date and time", async () => {
    const createPublishCalendarSlot = vi.fn();
    await renderPublishQueuePage({
      listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]),
      getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })),
      listPublishCalendarSlots: vi.fn(async () => []),
      createPublishCalendarSlot
    });

    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "이전 달" }));
    const createButton = await screen.findByRole("button", { name: "수동 슬롯 추가" });
    expect(screen.getByText("과거 시각에는 수동 슬롯을 추가할 수 없습니다.")).toBeVisible();
    expect(createButton).toBeDisabled();
    await userEvent.click(createButton);
    expect(createPublishCalendarSlot).not.toHaveBeenCalled();
  });

  it("revalidates a manual slot at click time when a once-future selection has become past", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-15T00:00:00+09:00"));
    const createPublishCalendarSlot = vi.fn(async (_brandId: string, input: Record<string, unknown>) => ({ id: "unexpected-manual-slot", workspaceId: "workspace-1", brandId: "brand-1", assignmentMode: "manual", status: "open", recommendationKind: null, contentSuggestionId: null, proposalId: null, generationId: null, generationOutputId: null, topicPublishGroupId: null, title: null, lastError: null, updatedAt: "2026-08-14T00:00:00.000Z", ...input }));
    await renderPublishQueuePage({
      listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]),
      getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })),
      listPublishCalendarSlots: vi.fn(async () => []),
      createPublishCalendarSlot
    });

    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "다음 달" }));
    const createButton = await screen.findByRole("button", { name: "수동 슬롯 추가" });
    expect(createButton).toBeEnabled();
    now.mockReturnValue(Date.parse("2026-09-01T12:00:00+09:00"));
    await userEvent.click(createButton);

    expect(createPublishCalendarSlot).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("선택한 게시 시각이 이미 지났습니다. 미래 시각을 선택해 주세요.");
  });

  it("defines a single-column calendar and detail panel for narrow screens", () => {
    const narrowRules = prototypeCss.slice(prototypeCss.indexOf("@media (max-width: 980px)"));
    expect(narrowRules).toContain(".publish-calendar-layout { grid-template-columns: 1fr; }");
  });

  it("keeps mobile weekday labels and cells in one shared calendar scroll container", async () => {
    await renderPublishQueuePage({ listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]), getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })), listPublishCalendarSlots: vi.fn(async () => []) });
    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    const scroller = await screen.findByRole("region", { name: "게시 캘린더 스크롤" });
    expect(within(scroller).getByRole("grid", { name: "게시 캘린더" })).toBeVisible();
    expect(prototypeCss).toContain(".publish-calendar-scroll { overflow-x: auto; }");
    expect(prototypeCss).toContain(".publish-calendar-weekdays, .publish-calendar-grid { min-width: 640px; }");
    expect(publishCalendarSource).toContain('className="publish-calendar-scroll"');
  });

  it("restores focus to the settings trigger after Escape, cancel, and successful save", async () => {
    await renderPublishQueuePage({
      listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]),
      getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })),
      listPublishCalendarSlots: vi.fn(async () => []),
      savePublishCalendarSettings: vi.fn(async (_brandId: string, input: Record<string, unknown>) => ({ brandId: "brand-1", ...input, updatedAt: null }))
    });
    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    const trigger = await screen.findByRole("button", { name: "자동 게시 설정" });

    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "설정 저장" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "자동 게시 설정" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("renders grouped status filters and a card region", async () => {
    await renderPublishQueuePage();

    expect(await screen.findByRole("region", { name: "게시 관리 통합 목록" })).toHaveClass(
      "publish-management-grid"
    );
    for (const label of ["전체", "준비 중", "검토 필요", "게시 예정", "완료", "문제"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label} \\d+$`) })).toHaveAttribute(
        "aria-pressed"
      );
    }
    expect(screen.queryByRole("button", { name: "대기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "게시 대기" })).not.toBeInTheDocument();
  });

  it("shows a card skeleton while the initial management data is loading", async () => {
    const pending = new Promise<never>(() => undefined);
    await renderPublishQueuePage({
      listPublishQueue: vi.fn(() => pending),
      listContentOutputs: vi.fn(() => pending),
      listPublishResults: vi.fn(() => pending)
    });

    expect(screen.getByRole("status", { name: "게시 관리 목록을 불러오는 중입니다." })).toHaveClass("skeleton-card-grid");
    expect(screen.queryByRole("region", { name: "게시 관리 통합 목록" })).not.toBeInTheDocument();
  });

  it("previews generated review content and labels unfinished content as unavailable", async () => {
    const api = await renderPublishQueuePage({ listContentOutputs: vi.fn(async () => reviewOutputs) });

    await userEvent.click(await screen.findByRole("button", { name: /^검토 필요 \d+$/ }));
    const generatedCard = screen.getByRole("article", { name: "검토할 인스타 콘텐츠" });
    await userEvent.click(within(generatedCard).getByRole("button", { name: "콘텐츠 보기" }));

    const dialog = screen.getByRole("dialog", { name: "생성 콘텐츠 상세" });
    expect(await within(dialog).findByRole("img", { name: "card-01.png" })).toBeVisible();
    expect(api.getContentOutputArtifact).toHaveBeenCalledWith("output-review");

    await userEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    await userEvent.click(screen.getByRole("button", { name: /^전체 \d+$/ }));
    const generatingCard = screen.getByRole("article", { name: "생성 중인 X 콘텐츠" });
    expect(within(generatingCard).getByText("콘텐츠 미생성")).toBeVisible();
    expect(within(generatingCard).queryByRole("button", { name: "콘텐츠 보기" })).not.toBeInTheDocument();
  });

  it("shows publish states for every channel present in a result", async () => {
    const channels = (["instagram", "threads", "x", "linkedin", "youtube", "tiktok"] as const).map((channel, index) => ({
      ...publishResults[1].channels[0],
      queueId: `queue-${channel}`,
      channelOutputId: `output-${channel}`,
      channel,
      status: "queued" as const,
      title: `${channel} output`,
      outputJson: { deliveryFormat: ["instagram_feed_carousel", "threads_text", "x_post", "linkedin_post", "youtube_short", "tiktok_video"][index] }
    }));
    await renderPublishQueuePage({
      listPublishResults: vi.fn(async () => [{ ...publishResults[1], contentId: "master-six", channels }])
    });

    for (const label of ["Instagram", "Threads", "X", "LinkedIn", "YouTube", "TikTok"]) {
      expect(await screen.findByRole("button", { name: `${label} 게시 대기` })).toBeVisible();
    }
  });

  it("renders multiple formats for the same channel without duplicate React keys", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const firstChannel = publishResults[1].channels[0];
    const channels = [
      { ...firstChannel, queueId: "queue-instagram-feed", channelOutputId: "output-instagram-feed" },
      { ...firstChannel, queueId: "queue-instagram-reel", channelOutputId: "output-instagram-reel" }
    ];

    try {
      await renderPublishQueuePage({
        listPublishResults: vi.fn(async () => [{ ...publishResults[1], contentId: "master-two-instagram-formats", channels }])
      });

      expect(await screen.findAllByRole("button", { name: "Instagram 게시 대기" })).toHaveLength(2);
      expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("shows one scheduled time per topic and independent child channel formats", async () => {
    await renderPublishQueuePage({
      listPublishQueue: vi.fn(async () => groupedQueueRows),
      listPublishResults: vi.fn(async () => publishResults)
    });

    expect(await screen.findByText("Instagram · Reel")).toBeVisible();
    expect(screen.getByText("Threads · 텍스트")).toBeVisible();
    expect(screen.getByRole("article", { name: "제주 가족 숙소 카드뉴스" })).toHaveTextContent("7월 14일 11:30");
    expect(screen.getAllByText("제주 가족 숙소 카드뉴스")).toHaveLength(1);
    const cards = screen.getByRole("region", { name: "게시 관리 통합 목록" });
    expect(cards).toHaveClass("publish-management-grid");
    expect(within(cards).getByText("게시 완료")).toBeVisible();
    expect(within(cards).getAllByText("실패")).toHaveLength(2);
    expect(screen.getByText("Threads access token expired")).toBeVisible();
    expect(screen.queryByRole("link", { name: "결과물 다운로드" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "게시물 열기" })).toHaveAttribute(
      "href",
      "https://instagram.com/reel/ig-post-1"
    );
  });

  it("selects only a published child result without hiding its failed sibling", async () => {
    await renderPublishQueuePage({
      listPublishQueue: vi.fn(async () => groupedQueueRows),
      listPublishResults: vi.fn(async () => publishResults)
    });

    await userEvent.click(await screen.findByRole("button", { name: "Instagram · Reel 상세" }));
    expect(screen.getByRole("dialog", { name: "업로드 콘텐츠 상세" })).toBeVisible();
    expect(screen.getByText("Threads access token expired")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Threads · 텍스트 상세" })).not.toBeInTheDocument();
  });

  it("keeps legacy rows without a topic group independently keyed", async () => {
    await renderPublishQueuePage({ listPublishQueue: vi.fn(async () => legacyQueueRows) });

    const legacyCards = await screen.findAllByRole("article", { name: "제주 가족 숙소 카드뉴스" });
    expect(legacyCards).toHaveLength(2);
    for (const card of legacyCards) expect(card).toHaveTextContent("7월 14일 11:30");
  });

  it("shows one publish card grid instead of channel-separated panels", async () => {
    await renderPublishQueuePage({
      listContentOutputs: vi.fn(async () => reviewOutputs),
      listPublishQueue: vi.fn(async () => queueRows),
      listPublishResults: vi.fn(async () => publishResults)
    });

    expect(screen.getByRole("heading", { name: "게시 관리" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /완료 결과물 다운로드/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "검토 필요" })).not.toBeInTheDocument();
    expect(await screen.findByText("검토할 인스타 콘텐츠")).toBeVisible();
    expect(screen.getByText("차단된 Threads 콘텐츠")).toBeVisible();
    expect(screen.getByText("제주 가족 숙소 카드뉴스")).toBeVisible();
    expect(screen.getByText("게시 대기 상태 콘텐츠")).toBeVisible();
    const cards = screen.getByRole("region", { name: "게시 관리 통합 목록" });
    expect(within(cards).getAllByRole("article").length).toBeGreaterThan(0);
    expect(within(cards).queryByText("https://brand.example.com/faq")).not.toBeInTheDocument();
    expect(within(cards).getByRole("button", { name: "Instagram 성공" })).toBeVisible();
    expect(within(cards).getByRole("button", { name: "Threads 실패" })).toBeVisible();
    expect(within(cards).queryByRole("button", { name: /Webflow/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Instagram 게시 관리 목록이 비어 있습니다")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Instagram" })).not.toBeInTheDocument();
  });

  it("shows each channel's actual published time on its card", async () => {
    await renderPublishQueuePage({
      listPublishQueue: vi.fn(async () => []),
      listPublishResults: vi.fn(async () => publishResults)
    });

    const cards = await screen.findByRole("region", { name: "게시 관리 통합 목록" });
    const publishedCard = within(cards).getByRole("article", { name: "제주 가족 숙소 카드뉴스" });
    const expectedPublishedAt = new Date("2026-07-08T02:30:00.000Z").toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    expect(within(publishedCard).getByText(`Instagram ${expectedPublishedAt}`)).toBeVisible();

    const queuedCard = within(cards).getByRole("article", { name: "게시 대기 상태 콘텐츠" });
    expect(within(queuedCard).getByText("-")).toBeVisible();
  });

  it("moves content review actions into publish management", async () => {
    const api = await renderPublishQueuePage({ listContentOutputs: vi.fn(async () => reviewOutputs) });

    expect(await screen.findByText("검토할 인스타 콘텐츠")).toBeVisible();
    expect(screen.getByText("Instagram 검토 필요")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "승인" }));

    expect(api.reviewContentOutput).toHaveBeenCalledWith("output-review", "approve");
    expect(await screen.findByText("게시 관리 목록에 등록했습니다.")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: /^검토 필요 \d+$/ }));
    expect(screen.getByText("차단된 Threads 콘텐츠")).toBeVisible();
  });

  it("renders generation lifecycle rows with only API-valid actions", async () => {
    await renderPublishQueuePage({ listContentOutputs: vi.fn(async () => reviewOutputs) });

    const cards = await screen.findByRole("region", { name: "게시 관리 통합 목록" });
    const generating = within(cards).getByRole("article", { name: "생성 중인 X 콘텐츠" });
    expect(within(generating).getByText("X 생성 중")).toBeVisible();
    expect(within(generating).queryByRole("button", { name: /승인|재생성|거절/ })).not.toBeInTheDocument();

    const failed = within(cards).getByRole("article", { name: "생성 실패한 LinkedIn 콘텐츠" });
    expect(within(failed).getByText("LinkedIn 생성 실패")).toBeVisible();
    expect(within(failed).getByText("콘텐츠 생성 실패")).toBeVisible();
    expect(within(failed).queryByText(/secret-value/)).not.toBeInTheDocument();
    expect(within(failed).queryByRole("button", { name: /^승인$/ })).not.toBeInTheDocument();
    expect(within(failed).queryByRole("button", { name: "재생성" })).not.toBeInTheDocument();
    expect(within(failed).getByRole("button", { name: "거절" })).toBeVisible();
  });

  it("classifies rejected and generating outputs as generating when none are actionable", async () => {
    const mixedOutputs: ContentOutput[] = [{
      ...reviewOutputs[0],
      id: "output-rejected-mixed",
      contentId: "master-mixed",
      title: "혼합 생성 상태",
      status: "rejected"
    }, {
      ...reviewOutputs[0],
      id: "output-generating-mixed",
      contentId: "master-mixed",
      title: "혼합 생성 상태",
      channel: "threads",
      status: "generating"
    }];
    await renderPublishQueuePage({ listContentOutputs: vi.fn(async () => mixedOutputs) });

    const card = await screen.findByRole("article", { name: "혼합 생성 상태" });
    expect(within(card).getByText("생성 중")).toBeVisible();
    expect(within(card).queryByRole("button", { name: /승인|재생성|거절/ })).not.toBeInTheDocument();
  });

  it("disables grouped actions while a review request is pending", async () => {
    let resolveReview: ((value: { id: string; status: ContentOutput["status"] }) => void) | undefined;
    await renderPublishQueuePage({
      listContentOutputs: vi.fn(async () => [reviewOutputs[0]]),
      reviewContentOutput: vi.fn(() => new Promise((resolve) => { resolveReview = resolve; }))
    });
    const row = await screen.findByRole("article", { name: "검토할 인스타 콘텐츠" });

    await userEvent.click(within(row).getByRole("button", { name: "승인" }));

    expect(within(row).getByRole("button", { name: "승인" })).toBeDisabled();
    expect(within(row).getByRole("button", { name: "재생성" })).toBeDisabled();
    expect(within(row).getByRole("button", { name: "거절" })).toBeDisabled();

    await act(async () => resolveReview?.({ id: "output-review", status: "approved" }));
    expect(await screen.findByText("게시 관리 목록에 등록했습니다.")).toBeVisible();
  });

  it("refreshes server state when only part of a grouped review succeeds", async () => {
    const groupedOutputs = [
      { ...reviewOutputs[0], contentId: "master-partial", title: "부분 처리 검토" },
      { ...reviewOutputs[1], contentId: "master-partial", title: "부분 처리 검토" }
    ];
    const listContentOutputs = vi.fn()
      .mockResolvedValueOnce(groupedOutputs)
      .mockResolvedValueOnce([{ ...groupedOutputs[1], status: "auto_approval_blocked" }]);
    const reviewContentOutput = vi.fn(async (outputId: string) => {
      if (outputId === "output-blocked") throw new Error("temporary_failure");
      return { id: outputId, status: "approved" };
    });
    await renderPublishQueuePage({ listContentOutputs, reviewContentOutput });

    const row = await screen.findByRole("article", { name: "부분 처리 검토" });
    await userEvent.click(within(row).getByRole("button", { name: "수동 승인" }));

    expect(listContentOutputs).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/일부 검토 결과를 저장하지 못했습니다/)).toBeVisible();
  });

  it("does not report a saved group review as failed when only refresh fails", async () => {
    const listContentOutputs = vi.fn()
      .mockResolvedValueOnce([reviewOutputs[0]])
      .mockRejectedValueOnce(new Error("refresh_failed"));
    await renderPublishQueuePage({ listContentOutputs });
    const row = await screen.findByRole("article", { name: "검토할 인스타 콘텐츠" });

    await userEvent.click(within(row).getByRole("button", { name: "승인" }));

    expect(await screen.findByText(/검토 결과는 저장했지만 목록을 새로고침하지 못했습니다/)).toBeVisible();
    expect(screen.queryByText(/^승인 처리에 실패했습니다/)).not.toBeInTheDocument();
  });

  it("loads the actual artifact and displays only populated upload metadata", async () => {
    const api = await renderPublishQueuePage({ listPublishResults: vi.fn(async () => publishResults) });

    expect(await screen.findByText("제주 가족 숙소 카드뉴스")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Instagram 성공" }));
    const dialog = screen.getByRole("dialog", { name: "업로드 콘텐츠 상세" });
    expect(dialog).toBeVisible();
    expect(await within(dialog).findByRole("img", { name: "card-01.png" })).toBeVisible();
    expect(api.getPublishArtifact).toHaveBeenCalledWith("queue-instagram");
    expect(within(dialog).queryByText("저장된 채널 출력")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Instagram")).toBeVisible();
    expect(within(dialog).getByText("카드뉴스")).toBeVisible();
    expect(within(dialog).getByText("ig-post-1")).toBeVisible();
    expect(within(dialog).getByText("자사 FAQ 요약")).toBeVisible();
    expect(within(dialog).queryByText("실패 시각")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("오류 사유")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "원본 게시물 열기" })).toHaveAttribute(
      "href",
      "https://instagram.com/reel/ig-post-1"
    );

    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await userEvent.click(screen.getByRole("button", { name: "Threads 실패" }));
    expect(screen.getByRole("dialog", { name: "업로드 콘텐츠 상세" })).toBeVisible();
    expect(await screen.findByText("token expired")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.getByRole("button", { name: "Instagram 게시 대기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Threads 게시 중" })).toBeDisabled();
  });

  it("shows artifact loading and retryable error states", async () => {
    let resolveArtifact: ((value: PublishArtifact) => void) | undefined;
    const getPublishArtifact = vi.fn()
      .mockImplementationOnce(() => new Promise<PublishArtifact>((resolve) => {
        resolveArtifact = resolve;
      }))
      .mockRejectedValueOnce(new Error("manifest_invalid"))
      .mockResolvedValueOnce(imageArtifact);
    await renderPublishQueuePage({
      listPublishResults: vi.fn(async () => publishResults),
      getPublishArtifact
    });

    await userEvent.click(await screen.findByRole("button", { name: "Instagram 성공" }));
    expect(screen.getByRole("status", { name: "결과물을 불러오는 중입니다." })).toHaveClass("skeleton-list");
    await act(async () => resolveArtifact?.(imageArtifact));
    expect(await screen.findByRole("img", { name: "card-01.png" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await userEvent.click(screen.getByRole("button", { name: "Instagram 성공" }));
    expect(await screen.findByText("결과물을 불러오지 못했습니다.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("img", { name: "card-01.png" })).toBeVisible();
    expect(getPublishArtifact).toHaveBeenCalledTimes(3);
  });

  it("downloads the selected queue ZIP from the dialog", async () => {
    const downloadPublishResult = vi.fn(async () => ({
      fileName: "queue-instagram.zip",
      blob: new Blob(["queue zip"], { type: "application/zip" })
    }));
    const createObjectURL = vi.fn(() => "blob:queue-result");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const api = await renderPublishQueuePage({
      listPublishResults: vi.fn(async () => publishResults),
      downloadPublishResult
    });

    await userEvent.click(await screen.findByRole("button", { name: "Instagram 성공" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(api.downloadPublishResult).toHaveBeenCalledWith("queue-instagram");
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:queue-result");
    expect(screen.getByText("게시 결과 저장을 시작했습니다.")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "업로드 콘텐츠 상세" })).toBeVisible();
  });

  it("keeps the save label stable and shows an inline loader while downloading", async () => {
    await renderPublishQueuePage({
      listPublishResults: vi.fn(async () => publishResults),
      downloadPublishResult: vi.fn(() => new Promise(() => {}))
    });

    await userEvent.click(await screen.findByRole("button", { name: "Instagram 성공" }));
    const saveButton = await screen.findByRole("button", { name: "저장" });
    await userEvent.click(saveButton);

    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("게시 결과 저장 중")).toBeVisible();
  });

  it("keeps the dialog open and reports ordinary download failures", async () => {
    await renderPublishQueuePage({
      listPublishResults: vi.fn(async () => publishResults),
      downloadPublishResult: vi.fn(async () => {
        throw new Error("network_down");
      })
    });

    await userEvent.click(await screen.findByRole("button", { name: "Instagram 성공" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("게시 결과 저장에 실패했습니다. 잠시 후 다시 시도하세요.")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "업로드 콘텐츠 상세" })).toBeVisible();
  });

  it("shows an entitlement-ready notice for future 403 download responses", async () => {
    await renderPublishQueuePage({
      listPublishResults: vi.fn(async () => publishResults),
      downloadPublishResult: vi.fn(async () => {
        throw new Error("API request failed: 403:download_entitlement_required");
      })
    });

    await userEvent.click(await screen.findByRole("button", { name: "Instagram 성공" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("이 결과를 저장하려면 다운로드 권한이 필요합니다. 결제 페이지에서 이용 권한을 확인하세요.")).toBeVisible();
  });

  it("keeps Save available when a video preview fails to load", async () => {
    const videoArtifact: PublishArtifact = {
      queueId: "queue-instagram",
      kind: "video",
      deliveryFormat: "instagram_reel",
      assets: [{
        url: "https://cdn.example.com/result.mp4",
        fileName: "result.mp4",
        mimeType: "video/mp4",
        width: 1080,
        height: 1920
      }],
      posterUrl: null,
      html: null,
      text: null
    };
    await renderPublishQueuePage({
      listPublishResults: vi.fn(async () => publishResults),
      getPublishArtifact: vi.fn(async () => videoArtifact)
    });

    await userEvent.click(await screen.findByRole("button", { name: "Instagram 성공" }));
    const preview = await screen.findByTestId("publish-artifact-preview");
    fireEvent.error(preview.querySelector("video") as HTMLVideoElement);

    expect(screen.getByText("동영상을 재생할 수 없습니다. 결과 파일을 저장해 확인하세요.")).toBeVisible();
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
  });

  it("keeps long upload metadata inside the dialog scroll body", async () => {
    const longSourceSummary = Array.from({ length: 80 }, (_, index) => `생성 근거 ${index + 1}`).join("\n");
    const resultsWithLongMetadata: PublishResult[] = [{
      ...publishResults[0],
      channels: publishResults[0].channels.map((channel) => ({ ...channel, sourceSummary: longSourceSummary }))
    }];
    await renderPublishQueuePage({ listPublishResults: vi.fn(async () => resultsWithLongMetadata) });

    await userEvent.click(await screen.findByRole("button", { name: "Instagram 성공" }));
    const dialog = screen.getByRole("dialog", { name: "업로드 콘텐츠 상세" });
    const scrollBody = dialog.querySelector(".publish-result-dialog__body");
    const metadata = within(dialog).getByLabelText("업로드 정보");

    expect(scrollBody).toHaveClass("publish-result-dialog__scroll");
    expect(metadata).toHaveTextContent("생성 근거 1");
    expect(metadata).toHaveTextContent("생성 근거 80");
  });

  it("defines a responsive single-column publish result body", () => {
    const desktopBreakpoint = prototypeCss.indexOf("@media (max-width: 980px)");
    const responsiveRules = prototypeCss.slice(
      desktopBreakpoint,
      prototypeCss.indexOf("@media (max-width: 720px)", desktopBreakpoint)
    );

    expect(responsiveRules).toContain(".publish-result-dialog__body { grid-template-columns: 1fr; }");
  });

  it("shows pre-LLM source queue items as waiting rows without generated channel output", async () => {
    await renderPublishQueuePage({ listPublishQueue: vi.fn(async () => preLlmQueueRows) });

    expect(await screen.findByText("부동산 지고 주식 뜬다?")).toBeVisible();
    const cards = screen.getByRole("region", { name: "게시 관리 통합 목록" });
    expect(within(cards).getByText("대기")).toBeVisible();
    expect(within(cards).queryByText("https://blog.opensurvey.co.kr/article/finance-2026-2/")).not.toBeInTheDocument();
    expect(within(cards).getByRole("button", { name: "Instagram 생성 전" })).toBeDisabled();
    expect(screen.queryByRole("dialog", { name: "업로드 콘텐츠 상세" })).not.toBeInTheDocument();
  });

  it("keeps generated publish queue items out of the pre-LLM waiting filter", async () => {
    await renderPublishQueuePage({ listPublishResults: vi.fn(async () => publishResults) });

    await screen.findByText("게시 대기 상태 콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: /^준비 중 \d+$/ }));

    expect(screen.queryByText("게시 대기 상태 콘텐츠")).not.toBeInTheDocument();
    expect(screen.getByText("게시 관리 목록이 비어 있습니다")).toBeVisible();
  });

  it("shows queued publish results as publish waiting and avoids duplicate evidence text", async () => {
    await renderPublishQueuePage({ listPublishResults: vi.fn(async () => publishResults) });

    await screen.findByText("게시 대기 상태 콘텐츠");
    const cards = screen.getByRole("region", { name: "게시 관리 통합 목록" });
    expect(within(cards).getByRole("button", { name: "Instagram 게시 대기" })).toBeDisabled();
    expect(within(cards).queryByText("외부 참고 요약")).not.toBeInTheDocument();
  });

  it("filters the card grid by grouped status", async () => {
    await renderPublishQueuePage({ listPublishResults: vi.fn(async () => publishResults) });

    await screen.findByText("제주 가족 숙소 카드뉴스");
    await userEvent.click(screen.getByRole("button", { name: /^문제 \d+$/ }));

    expect(screen.getByText("제주 가족 숙소 카드뉴스")).toBeVisible();
    expect(screen.queryByText("게시 대기 상태 콘텐츠")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Threads 실패" })).toBeVisible();
  });

  it("keeps a deep-linked queue result visible across filters and focuses it", async () => {
    window.history.replaceState({}, "", "/publish-queue?status=issues&queueId=queue-instagram-waiting");
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });

    await renderPublishQueuePage({ listPublishResults: vi.fn(async () => publishResults) });

    const card = await screen.findByRole("article", { name: "게시 대기 상태 콘텐츠" });
    expect(card).toHaveAttribute("data-publish-deep-link", "true");
    expect(card).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("shows reconcile instead of retry for an unknown publish result", async () => {
    const unknownRows: PublishSlot[] = [{
      ...groupedQueueRows[1],
      id: "queue-unknown",
      status: "failed",
      lastError: "publish_delivery_unknown"
    }];
    const api = await renderPublishQueuePage({ listPublishQueue: vi.fn(async () => unknownRows) });

    expect(await screen.findByText("결과 확인 필요")).toBeVisible();
    expect(screen.getByText("publish_delivery_unknown")).toBeVisible();
    expect(screen.queryByRole("button", { name: "재시도" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "게시 결과 확인" }));
    expect(api.publishQueueItem).not.toHaveBeenCalled();
    expect(api.listPublishQueue).toHaveBeenCalledTimes(2);
  });

  it("shows server retry reasons and only enables retry for allowed failures", async () => {
    const failures: PublishSlot[] = [{
      ...groupedQueueRows[1],
      id: "queue-retryable",
      lastError: "oauth_required"
    }, {
      ...groupedQueueRows[1],
      id: "queue-forbidden",
      topicPublishGroupId: "publish-group-2",
      title: "재시도 금지 콘텐츠",
      lastError: "invalid_media"
    }];
    const api = await renderPublishQueuePage({ listPublishQueue: vi.fn(async () => failures) });

    expect(await screen.findByText("oauth_required")).toBeVisible();
    expect(screen.getByText("invalid_media")).toBeVisible();
    expect(screen.getByText("서버가 이 실패의 재시도를 허용하지 않습니다.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "재시도" }));
    expect(api.retryPublishQueueItem).toHaveBeenCalledWith("queue-retryable");
  });

  it("keeps the current list and warns when a recovery refresh fails", async () => {
    const listPublishQueue = vi.fn()
      .mockResolvedValueOnce([{
        ...groupedQueueRows[1],
        id: "queue-unknown",
        status: "failed",
        lastError: "publish_delivery_unknown"
      }])
      .mockRejectedValueOnce(new Error("refresh_failed"));
    await renderPublishQueuePage({ listPublishQueue });

    await screen.findByText("제주 가족 숙소 카드뉴스");
    await userEvent.click(screen.getByRole("button", { name: "게시 결과 확인" }));

    expect(await screen.findByText("목록을 새로고침하지 못해 기존 상태를 표시합니다.")).toBeVisible();
    expect(screen.getByText("제주 가족 숙소 카드뉴스")).toBeVisible();
  });

  it("allows cancellation only before publishing starts", async () => {
    const cancellable = [{
      ...groupedQueueRows[0],
      id: "queue-cancellable",
      title: "취소 가능한 예약",
      status: "scheduled"
    }] as PublishSlot[];
    const api = await renderPublishQueuePage({
      listPublishQueue: vi.fn(async () => cancellable),
      listPublishResults: vi.fn(async () => publishResults)
    });

    await screen.findByText("게시 대기 상태 콘텐츠");
    const scheduled = screen.getByRole("article", { name: "취소 가능한 예약" });
    await userEvent.click(within(scheduled).getByRole("button", { name: "예약 취소" }));

    expect(api.cancelPublishQueueItem).toHaveBeenCalledWith("queue-cancellable");
    const publishing = screen.getByRole("article", { name: "게시 대기 상태 콘텐츠" });
    expect(within(publishing).queryByRole("button", { name: "예약 취소" })).not.toBeInTheDocument();
  });

  it("does not show sample queue items when the API is unavailable", async () => {
    await renderPublishQueuePage({
      listPublishQueue: vi.fn(async () => {
        throw new Error("api_down");
      })
    });

    expect(await screen.findByText(/API 서버가 응답하지 않아 게시 관리 목록을 불러오지 못했습니다/)).toBeVisible();
    expect(screen.queryByText("초보자를 위한 여행 3박")).not.toBeInTheDocument();
    expect(screen.getByText("게시 관리 목록이 비어 있습니다")).toBeVisible();
  });

  it("does not run publish when there is no publishable target", async () => {
    const api = await renderPublishQueuePage({ listPublishQueue: vi.fn(async () => []) });

    await userEvent.click(screen.getByRole("button", { name: "다음 게시 실행" }));

    expect(api.publishQueueItem).not.toHaveBeenCalled();
    expect(screen.getByText("게시할 예약 콘텐츠가 없습니다.")).toBeVisible();
  });

  it("does not publish queued items before the scheduler assigns a slot", async () => {
    const queuedOnly: PublishSlot[] = [{
      id: "queue-waiting",
      channel: "instagram",
      time: "대기",
      title: "정책 배정 대기 콘텐츠",
      approvalType: "auto",
      status: "queued",
      sourceType: "topic_table",
      sourceLabel: "대기 주제",
      sourceDetail: null,
      sourceUrls: [],
      queuedAt: "2026-07-07T01:15:00.000Z",
      lastError: null
    }];
    const api = await renderPublishQueuePage({ listPublishQueue: vi.fn(async () => queuedOnly) });

    await userEvent.click(screen.getByRole("button", { name: "다음 게시 실행" }));

    expect(api.publishQueueItem).not.toHaveBeenCalled();
    expect(screen.getByText("게시할 예약 콘텐츠가 없습니다.")).toBeVisible();
  });
});
