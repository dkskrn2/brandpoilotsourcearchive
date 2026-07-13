import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentOutput, PublishResult, PublishSlot } from "../types";

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
  previewBody: "캡션 내용"
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
    downloadPublishedResults: vi.fn(async () => ({
      fileName: "brand-pilot-published-results.zip",
      blob: new Blob(["zip-content"], { type: "application/zip" })
    })),
    schedulePublishQueue: vi.fn(async () => ({ processed: 2, created: 0, updated: 2, failed: 0 })),
    publishQueueItem: vi.fn(async () => ({ id: "queue-topic", status: "published", publishedUrl: "mock://instagram/queue-topic" })),
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
  it("shows one scheduled time per topic and independent child channel formats", async () => {
    await renderPublishQueuePage({
      listPublishQueue: vi.fn(async () => groupedQueueRows),
      listPublishResults: vi.fn(async () => publishResults)
    });

    expect(await screen.findByText("Instagram · Reel")).toBeVisible();
    expect(screen.getByText("Threads · 텍스트")).toBeVisible();
    expect(screen.getAllByText("7월 14일 11:30")).toHaveLength(1);
    expect(screen.getAllByText("제주 가족 숙소 카드뉴스")).toHaveLength(1);
    const table = screen.getByRole("table", { name: "게시 관리 통합 목록" });
    expect(within(table).getByText("게시 완료")).toBeVisible();
    expect(within(table).getByText("실패")).toBeVisible();
    expect(screen.getByText("Threads access token expired")).toBeVisible();
    expect(screen.getByRole("link", { name: "결과물 다운로드" })).toHaveAttribute(
      "href",
      "https://cdn.example.com/instagram/manifest.json"
    );
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

    expect(await screen.findAllByText("제주 가족 숙소 카드뉴스")).toHaveLength(2);
    expect(screen.getAllByText("7월 14일 11:30")).toHaveLength(2);
  });

  it("shows one publish queue table instead of channel-separated panels", async () => {
    await renderPublishQueuePage({
      listContentOutputs: vi.fn(async () => reviewOutputs),
      listPublishQueue: vi.fn(async () => queueRows),
      listPublishResults: vi.fn(async () => publishResults)
    });

    expect(screen.getByRole("heading", { name: "게시 관리" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "완료 결과물 다운로드 (1)" })).toBeEnabled();
    expect(screen.queryByRole("tab", { name: "검토 필요" })).not.toBeInTheDocument();
    expect(await screen.findByText("검토할 인스타 콘텐츠")).toBeVisible();
    expect(screen.getByText("차단된 Threads 콘텐츠")).toBeVisible();
    expect(screen.getByText("제주 가족 숙소 카드뉴스")).toBeVisible();
    expect(screen.getByText("게시 대기 상태 콘텐츠")).toBeVisible();
    expect(screen.getByText("가족 숙소 체크리스트")).toBeVisible();
    const table = screen.getByRole("table", { name: "게시 관리 통합 목록" });
    expect(within(table).getByRole("columnheader", { name: "소스 구분" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "생성 근거" })).toBeInTheDocument();
    expect(within(table).getByText("주제표+크롤링")).toBeVisible();
    expect(within(table).getByText("크롤링")).toBeVisible();
    expect(within(table).getAllByText(/자사 FAQ 요약/).length).toBeGreaterThan(0);
    expect(within(table).getAllByText("https://brand.example.com/faq").length).toBeGreaterThan(0);
    expect(within(table).getByRole("button", { name: "Instagram 성공" })).toBeVisible();
    expect(within(table).getByRole("button", { name: "Threads 실패" })).toBeVisible();
    expect(within(table).queryByRole("button", { name: /Webflow/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Instagram 게시 관리 목록이 비어 있습니다")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Instagram" })).not.toBeInTheDocument();
  });

  it("moves content review actions into publish management", async () => {
    const api = await renderPublishQueuePage({ listContentOutputs: vi.fn(async () => reviewOutputs) });

    expect(await screen.findByText("검토할 인스타 콘텐츠")).toBeVisible();
    expect(screen.getByText("Instagram 검토 필요")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "승인" }));

    expect(api.reviewContentOutput).toHaveBeenCalledWith("output-review", "approve");
    expect(await screen.findByText("게시 관리 목록에 등록했습니다.")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "검토 필요" }));
    expect(screen.getByText("외부 참고 URL 의존도가 높습니다.")).toBeVisible();
  });

  it("shows completed channel results in a modal and disables pending statuses", async () => {
    await renderPublishQueuePage({ listPublishResults: vi.fn(async () => publishResults) });

    expect(await screen.findByText("제주 가족 숙소 카드뉴스")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Instagram 성공" }));
    expect(screen.getByRole("dialog", { name: "업로드 콘텐츠 상세" })).toBeVisible();
    expect(screen.getByText("캡션 내용")).toBeVisible();
    expect(screen.getByText("https://cdn.example.com/instagram/manifest.json")).toBeVisible();
    expect(screen.getByText("ig-post-1")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await userEvent.click(screen.getByRole("button", { name: "Threads 실패" }));
    expect(screen.getByRole("dialog", { name: "업로드 콘텐츠 상세" })).toBeVisible();
    expect(screen.getByText("token expired")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.getByRole("button", { name: "Instagram 게시 대기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Threads 게시 중" })).toBeDisabled();
  });

  it("shows pre-LLM source queue items as waiting rows without generated channel output", async () => {
    await renderPublishQueuePage({ listPublishQueue: vi.fn(async () => preLlmQueueRows) });

    expect(await screen.findByText("부동산 지고 주식 뜬다?")).toBeVisible();
    const table = screen.getByRole("table", { name: "게시 관리 통합 목록" });
    expect(within(table).getByText("대기")).toBeVisible();
    expect(within(table).getByText("크롤링 근거")).toBeVisible();
    expect(within(table).getByText("https://blog.opensurvey.co.kr/article/finance-2026-2/")).toBeVisible();
    expect(within(table).getByRole("button", { name: "Instagram 생성 전" })).toBeDisabled();
    expect(screen.queryByRole("dialog", { name: "업로드 콘텐츠 상세" })).not.toBeInTheDocument();
  });

  it("keeps generated publish queue items out of the pre-LLM waiting filter", async () => {
    await renderPublishQueuePage({ listPublishResults: vi.fn(async () => publishResults) });

    await screen.findByText("게시 대기 상태 콘텐츠");
    await userEvent.click(screen.getByRole("button", { name: "대기" }));

    expect(screen.queryByText("게시 대기 상태 콘텐츠")).not.toBeInTheDocument();
    expect(screen.getByText("게시 관리 목록이 비어 있습니다")).toBeVisible();
  });

  it("shows queued publish results as publish waiting and avoids duplicate evidence text", async () => {
    await renderPublishQueuePage({ listPublishResults: vi.fn(async () => publishResults) });

    await screen.findByText("게시 대기 상태 콘텐츠");
    expect(screen.getByText("게시 대기")).toBeVisible();
    const table = screen.getByRole("table", { name: "게시 관리 통합 목록" });
    expect(within(table).getByRole("button", { name: "Instagram 게시 대기" })).toBeDisabled();
    expect(within(table).getAllByText("외부 참고 요약")).toHaveLength(1);
  });

  it("downloads published results in one package", async () => {
    const downloadPublishedResults = vi.fn(async () => ({
      fileName: "published-results.zip",
      blob: new Blob(["zip-content"], { type: "application/zip" })
    }));
    const createObjectURL = vi.fn(() => "blob:published-results");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const api = await renderPublishQueuePage({
      listPublishQueue: vi.fn(async () => queueRows),
      downloadPublishedResults
    });

    await userEvent.click(await screen.findByRole("button", { name: "완료 결과물 다운로드 (1)" }));

    expect(api.downloadPublishedResults).toHaveBeenCalledWith("brand-1");
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:published-results");
    expect(screen.getByText("발송 완료 결과물 1건 다운로드를 시작했습니다.")).toBeVisible();
  });

  it("disables result download when there are no published rows", async () => {
    const unpublishedRows = queueRows.filter((row) => row.status !== "published");

    await renderPublishQueuePage({ listPublishQueue: vi.fn(async () => unpublishedRows) });

    expect(await screen.findByRole("button", { name: "완료 결과물 다운로드 (0)" })).toBeDisabled();
  });

  it("filters the single table by queue status", async () => {
    await renderPublishQueuePage({ listPublishResults: vi.fn(async () => publishResults) });

    await screen.findByText("제주 가족 숙소 카드뉴스");
    await userEvent.click(screen.getByRole("button", { name: "실패" }));

    expect(screen.getByText("제주 가족 숙소 카드뉴스")).toBeVisible();
    expect(screen.queryByText("게시 대기 상태 콘텐츠")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Threads 실패" })).toBeVisible();
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

    await screen.findByRole("button", { name: "완료 결과물 다운로드 (0)" });
    await userEvent.click(screen.getByRole("button", { name: "다음 게시 실행" }));

    expect(api.publishQueueItem).not.toHaveBeenCalled();
    expect(screen.getByText("게시할 예약 콘텐츠가 없습니다.")).toBeVisible();
  });
});
