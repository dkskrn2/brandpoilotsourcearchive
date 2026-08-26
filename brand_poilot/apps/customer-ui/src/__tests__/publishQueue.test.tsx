import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiContentGateway, AiContentGeneration } from "../features/ai-content/types";
import type { PublishArtifact, PublishItem, PublishItemTarget } from "../types";

const artifact: PublishArtifact = {
  queueId: "queue-1",
  kind: "image",
  deliveryFormat: "instagram_feed_carousel",
  assets: [],
  posterUrl: null,
  html: null,
  text: null
};

const manualOptions = {
  purposes: [{ value: "informational" as const, label: "정보성" }],
  subjectModes: [{ value: "topic_text" as const, label: "직접 입력", requiredField: "topicText" as const }],
  channels: [{ value: "instagram" as const, label: "Instagram", formats: [{ value: "card_news" as const, label: "카드뉴스" }, { value: "reel" as const, label: "릴스" }] }],
  products: [], suggestions: [], references: [],
  usage: {
    startsAt: "2099-08-20T00:00:00.000Z", endsAt: "2099-08-27T00:00:00.000Z",
    generation: { limit: 10, succeeded: 1, reserved: 0, remaining: 9, additionalAvailable: 9 },
    publishing: { limit: 7, succeeded: 1, reserved: 2, remaining: 6, additionalAvailable: 4 },
  },
};

const weeklySettings = {
  brandId: "brand-1",
  enabled: false,
  channels: ["instagram" as const],
  informationalFormat: "card_news" as const,
  trendFormat: "reel" as const,
  weeklySchedule: [{ id: "40000000-0000-4000-8000-000000000001", dayOfWeek: 1 as const, time: "11:17", sortOrder: 0 }],
  updatedAt: "2026-08-26T00:00:00.000Z",
};

const connectedInstagram = {
  type: "instagram" as const,
  label: "Instagram",
  enabled: true,
  oauthState: "connected" as const,
  status: "connected" as const,
  accountLabel: "@brand",
  lastHealthyAt: "2026-08-26T00:00:00.000Z",
  lastPublishedAt: "",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function target(overrides: Partial<PublishItemTarget> = {}): PublishItemTarget {
  return {
    queueId: "queue-1", channelOutputId: "channel-output-1", channel: "instagram", status: "scheduled",
    scheduledFor: "2026-08-23T02:30:00.000Z", publishedAt: null, failedAt: null, lastError: null, externalPostId: null, externalUrl: null,
    previewTitle: "SNS 마케팅", previewBody: "사장님을 위한 SNS 마케팅 본문", outputJson: {}, artifactPublicUrl: null, sourceSummary: "사장님 콘텐츠",
    ...overrides
  };
}

function item(overrides: Partial<PublishItem> = {}): PublishItem {
  return {
    itemKey: "output:dated", workspaceId: "workspace-1", brandId: "brand-1", title: "예약된 SNS 마케팅",
    createdAt: "2026-08-20T00:00:00.000Z", contentFormat: "card_news", channels: ["instagram"],
    source: { type: "topic_table", label: "주제표", detail: "사장님 콘텐츠", urls: [] }, targets: [target()],
    reviewTargets: [],
    contentStatus: "completed", publishStatus: "scheduled", status: "scheduled", operationalStatus: "upcoming", operationalReason: "future_reservation", groupStatus: "ready", publicationProgress: "none",
    scheduledFor: "2026-08-23T02:30:00.000Z", effectiveScheduledFor: "2026-08-23T02:30:00.000Z", publishedAt: null,
    calendarDate: "2026-08-23T02:30:00.000Z", calendarPlacement: "dated", assignmentMode: "manual",
    sourceRefs: { contentTopicId: null, proposalId: null, generationId: null, generationOutputId: "output-1", calendarSlotId: "slot-1", topicPublishGroupId: null, queueIds: ["queue-1"] },
    schedulable: false, scheduleBlockedReason: "already_reserved", lastError: null,
    ...overrides
  };
}

function reviewTarget(overrides: Partial<PublishItem["reviewTargets"][number]> = {}): PublishItem["reviewTargets"][number] {
  return {
    channelOutputId: "review-instagram", channel: "instagram", deliveryFormat: "instagram_feed_carousel", status: "pending_review",
    previewTitle: "검토", previewBody: "본문", outputJson: {}, sourceSummary: null, blockReasons: [], generatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/publish-queue");
  vi.resetModules();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function renderPage(
  overrides: Record<string, ReturnType<typeof vi.fn>> = {},
  generationGateway: Pick<AiContentGateway, "listGenerations"> = { listGenerations: vi.fn(async () => []) },
  useUrlDefault = false,
) {
  if (!useUrlDefault && !new URLSearchParams(window.location.search).has("status")) {
    const query = new URLSearchParams(window.location.search);
    query.set("status", "all");
    window.history.replaceState({}, "", `${window.location.pathname}?${query}`);
  }
  const api = {
    listPublishItems: vi.fn(async () => [] as PublishItem[]),
    listChannels: vi.fn(async () => []),
    getChannelCapabilities: vi.fn(async () => [{ channel: "instagram" as const, catalogStatus: "available" as const, enabled: true, connectionStatus: "connected" as const, canGenerate: true, generationFormats: ["card_news" as const], exportModes: ["image" as const], publishModes: ["instagram_feed_carousel" as const], readiness: "ready" as const, reasonCode: null }]),
    getPublishCalendarWeeklySettings: vi.fn(async () => null),
    savePublishCalendarWeeklySettings: vi.fn(async (_brandId: string, payload: Record<string, unknown>) => ({ ...weeklySettings, ...payload })),
    setPublishCalendarEnabled: vi.fn(async (_brandId: string, enabled: boolean) => ({ ...weeklySettings, enabled })),
    getPublishCalendarUsage: vi.fn(async () => manualOptions.usage),
    getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })),
    getPublishCalendarManualOptions: vi.fn(async () => { throw new Error("not_configured"); }),
    listPublishCalendarContentCandidates: vi.fn(async () => ({ items: [] })),
    provisionPublishCalendarManualSlot: vi.fn(async () => ({ id: "slot-new" })),
    reschedulePublishCalendarSlot: vi.fn(async () => ({ id: "slot-1", scheduledFor: "2099-08-24T01:10:00.000Z" })),
    provisionPublishCalendarManualSlotsBatch: vi.fn(async () => ({ slots: [] })),
    assignPublishCalendarSlot: vi.fn(async () => ({ id: "slot-1" })),
    cancelPublishCalendarSlot: vi.fn(async () => ({ id: "slot-1", status: "cancelled" })),
    savePublishCalendarSettings: vi.fn(async (_brandId: string, payload: Record<string, unknown>) => ({ brandId: "brand-1", updatedAt: "2026-08-23T00:00:00.000Z", ...payload })),
    generateContent: vi.fn(async () => ({ processed: 1, created: 1, updated: 0, failed: 0 })),
    retryPublishQueueItem: vi.fn(async () => ({ id: "queue-1", status: "queued" })),
    cancelPublishQueueItem: vi.fn(async () => ({ id: "queue-1", status: "cancelled" })),
    reviewContentOutput: vi.fn(async (outputId: string, action: string) => ({ id: outputId, status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "regenerating" })),
    getContentOutputArtifact: vi.fn(async () => ({ ...artifact, queueId: "review-output" })),
    getPublishArtifact: vi.fn(async () => artifact),
    downloadPublishResult: vi.fn(async () => ({ fileName: "result.zip", blob: new Blob(["result"], { type: "application/zip" }) })),
    ...overrides
  };
  vi.doMock("../lib/apiClient", async (importOriginal) => ({
    ...await importOriginal<typeof import("../lib/apiClient")>(),
    DEMO_BRAND_ID: "brand-1",
    api,
  }));
  const { PublishQueuePage } = await import("../pages/PublishQueuePage");
  await act(async () => { render(<PublishQueuePage generationGateway={generationGateway} />); });
  return api;
}

describe("PublishQueuePage canonical collection", () => {
  it("defaults a URL without status to required work", async () => {
    const required = item({ itemKey: "required", title: "처리할 게시", operationalStatus: "action_required", operationalReason: "stale_reservation" });
    const upcoming = item({ itemKey: "upcoming", title: "나중 게시", operationalStatus: "upcoming", operationalReason: "future_reservation" });

    await renderPage({ listPublishItems: vi.fn(async () => [required, upcoming]) }, undefined, true);

    expect(await screen.findByRole("article", { name: "처리할 게시" })).toBeVisible();
    expect(screen.queryByRole("article", { name: "나중 게시" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /처리 필요/ })).toHaveAttribute("aria-pressed", "true");
  });

  it.each([
    ["needs_review", "검토할 콘텐츠", "게시 실패 콘텐츠", "검토 대기 1"],
    ["failed", "게시 실패 콘텐츠", "검토할 콘텐츠", "게시 실패 1"],
  ])("preserves the precise semantics of the active %s legacy link", async (status, visibleTitle, hiddenTitle, selectedLabel) => {
    window.history.replaceState({}, "", `/publish-queue?status=${status}`);
    const review = item({
      itemKey: "legacy:review",
      title: "검토할 콘텐츠",
      targets: [],
      reviewTargets: [reviewTarget()],
      status: "completed_unpublished",
      publishStatus: "unreserved",
      operationalStatus: "action_required",
      operationalReason: "review_required",
      scheduledFor: null,
      effectiveScheduledFor: null,
      calendarDate: null,
      calendarPlacement: "unreserved",
    });
    const failed = item({
      itemKey: "legacy:failed",
      title: "게시 실패 콘텐츠",
      status: "failed",
      publishStatus: "failed",
      operationalStatus: "action_required",
      operationalReason: "publish_failed",
      targets: [target({ status: "failed", lastError: "provider_not_implemented" })],
    });

    await renderPage({ listPublishItems: vi.fn(async () => [review, failed]) });

    expect(await screen.findByRole("article", { name: visibleTitle })).toBeVisible();
    expect(screen.queryByRole("article", { name: hiddenTitle })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
    expect(screen.getByRole("button", { name: selectedLabel, pressed: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "처리 필요 2" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "전체 2" }));
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "전체 2", pressed: true })).toBeVisible();
    expect(screen.queryByRole("button", { name: selectedLabel })).not.toBeInTheDocument();
  });

  it("keeps the selected list filter after visiting the calendar", async () => {
    const published = item({
      itemKey: "filter:published",
      title: "완료 콘텐츠",
      status: "published",
      publishStatus: "published",
      operationalStatus: "published",
      operationalReason: "published",
      publicationProgress: "complete",
      targets: [target({ status: "published", publishedAt: "2026-08-23T03:00:00.000Z" })],
    });
    const upcoming = item({ itemKey: "filter:upcoming", title: "예정 콘텐츠" });
    await renderPage({ listPublishItems: vi.fn(async () => [published, upcoming]) });

    await userEvent.click(await screen.findByRole("button", { name: /완료 1/ }));
    expect(screen.getByRole("article", { name: "완료 콘텐츠" })).toBeVisible();
    expect(screen.queryByRole("article", { name: "예정 콘텐츠" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    await userEvent.click(screen.getByRole("tab", { name: "목록" }));

    expect(screen.getByRole("button", { name: /완료 1/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("article", { name: "완료 콘텐츠" })).toBeVisible();
    expect(screen.queryByRole("article", { name: "예정 콘텐츠" })).not.toBeInTheDocument();
  });

  it("uses one collection for both views and never calls retired base reads", async () => {
    const items = [
      item(),
      item({ itemKey: "topic:unreserved", title: "미예약 사장님 콘텐츠", targets: [], contentStatus: "pre_generation", publishStatus: "unreserved", status: "pre_generation", scheduledFor: null, effectiveScheduledFor: null, calendarDate: null, calendarPlacement: "unreserved", sourceRefs: { contentTopicId: "topic-1", proposalId: null, generationId: null, generationOutputId: null, calendarSlotId: null, topicPublishGroupId: null, queueIds: [] }, schedulable: true, scheduleBlockedReason: null }),
      item({ itemKey: "generation:hidden", title: "숨김 실패 콘텐츠", targets: [], contentStatus: "failed", publishStatus: "failed", status: "failed", scheduledFor: null, effectiveScheduledFor: null, calendarDate: null, calendarPlacement: "hidden", sourceRefs: { contentTopicId: null, proposalId: null, generationId: "generation-1", generationOutputId: null, calendarSlotId: null, topicPublishGroupId: null, queueIds: [] }, lastError: "generation_failed" })
    ];
    const oldRead = vi.fn(async () => { throw new Error("retired_read"); });
    const api = await renderPage({ listPublishItems: vi.fn(async () => items), listPublishQueue: oldRead, listContentOutputs: oldRead, listPublishResults: oldRead, listPublishCalendarSlots: oldRead });

    const listCard = await screen.findByRole("article", { name: "예약된 SNS 마케팅" });
    expect(listCard).toHaveAttribute("data-item-key", "output:dated");
    expect(within(listCard).getByText("게시 예정")).toBeVisible();
    expect(screen.getByRole("article", { name: "숨김 실패 콘텐츠" })).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    expect(await screen.findByRole("button", { name: "예약된 SNS 마케팅 게시 예정 슬롯 상세 보기" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "미예약 콘텐츠 보관함" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "콘텐츠 추가" }));
    expect(within(screen.getByRole("region", { name: "미예약 콘텐츠 보관함" })).getByText("미예약 사장님 콘텐츠")).toBeVisible();
    expect(screen.queryByText("숨김 실패 콘텐츠")).not.toBeInTheDocument();
    expect(api.listPublishItems).toHaveBeenCalledTimes(1);
    expect(oldRead).not.toHaveBeenCalled();
  });

  it("keeps the calendar unreserved tray compact with search, status filtering, and progressive reveal", async () => {
    const unreserved = Array.from({ length: 8 }, (_, index) => item({
      itemKey: `topic:unreserved-${index + 1}`,
      title: index === 7 ? "여덟 번째 생성 중 콘텐츠" : `${index + 1}번째 미예약 콘텐츠`,
      targets: [],
      contentStatus: index === 7 ? "generating" : "pre_generation",
      publishStatus: "unreserved",
      status: index === 7 ? "generating" : "pre_generation",
      scheduledFor: null,
      effectiveScheduledFor: null,
      calendarDate: null,
      calendarPlacement: "unreserved",
      sourceRefs: { contentTopicId: `topic-${index + 1}`, proposalId: null, generationId: null, generationOutputId: null, calendarSlotId: null, topicPublishGroupId: null, queueIds: [] },
      schedulable: true,
      scheduleBlockedReason: null,
    }));
    await renderPage({ listPublishItems: vi.fn(async () => unreserved) });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(screen.getByRole("button", { name: "콘텐츠 추가" }));
    const tray = await screen.findByRole("region", { name: "미예약 콘텐츠 보관함" });
    const search = within(tray).getByRole("searchbox", { name: "미예약 콘텐츠 검색" });
    const status = within(tray).getByRole("combobox", { name: "미예약 콘텐츠 상태" });

    expect(within(tray).getAllByRole("article")).toHaveLength(6);
    expect(within(tray).getAllByRole("article")[0]).toHaveClass("publish-calendar-unreserved__item");
    expect(within(tray).queryByText("여덟 번째 생성 중 콘텐츠")).not.toBeInTheDocument();
    await userEvent.click(within(tray).getByRole("button", { name: "더 보기 (2개)" }));
    expect(within(tray).getAllByRole("article")).toHaveLength(8);

    await userEvent.clear(search);
    await userEvent.type(search, "여덟 번째");
    expect(within(tray).getAllByRole("article")).toHaveLength(1);
    expect(within(tray).getByText("여덟 번째 생성 중 콘텐츠")).toBeVisible();

    await userEvent.clear(search);
    await userEvent.selectOptions(status, "generating");
    expect(within(tray).getAllByRole("article")).toHaveLength(1);
    expect(within(tray).getByText("여덟 번째 생성 중 콘텐츠")).toBeVisible();
  });

  it("shows a thumbnail only when an unreserved item has generated media", async () => {
    const generated = item({
      itemKey: "output:generated-thumbnail",
      title: "생성 완료 카드뉴스",
      targets: [],
      reviewTargets: [reviewTarget({ status: "approved", outputJson: { cards: [{ url: "https://cdn.example.com/card-1.webp" }] } })],
      contentStatus: "completed",
      publishStatus: "unreserved",
      status: "completed_unpublished",
      scheduledFor: null,
      effectiveScheduledFor: null,
      calendarDate: null,
      calendarPlacement: "unreserved",
      schedulable: true,
      scheduleBlockedReason: null,
    });
    const pending = item({
      itemKey: "topic:pending-thumbnail",
      title: "생성 전 콘텐츠",
      targets: [],
      reviewTargets: [],
      contentStatus: "pre_generation",
      publishStatus: "unreserved",
      status: "pre_generation",
      scheduledFor: null,
      effectiveScheduledFor: null,
      calendarDate: null,
      calendarPlacement: "unreserved",
      schedulable: true,
      scheduleBlockedReason: null,
    });
    await renderPage({ listPublishItems: vi.fn(async () => [generated, pending]) });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(screen.getByRole("button", { name: "콘텐츠 추가" }));
    const tray = await screen.findByRole("region", { name: "미예약 콘텐츠 보관함" });
    expect(within(tray).getByRole("img", { name: "생성 완료 카드뉴스 미리보기" })).toHaveAttribute("src", "https://cdn.example.com/card-1.webp");
    expect(within(within(tray).getByRole("article", { name: "생성 전 콘텐츠" })).queryByRole("img")).not.toBeInTheDocument();
  });

  it("loads a generated output artifact for an unreserved item whose publish DTO has no media", async () => {
    const generated = item({
      itemKey: "output:generated-artifact-thumbnail",
      title: "생성 결과 카드뉴스",
      targets: [],
      reviewTargets: [],
      contentStatus: "completed",
      publishStatus: "unreserved",
      status: "completed_unpublished",
      scheduledFor: null,
      effectiveScheduledFor: null,
      calendarDate: null,
      calendarPlacement: "unreserved",
      sourceRefs: { ...item().sourceRefs, generationId: "generation-thumbnail", generationOutputId: "output-thumbnail", calendarSlotId: null, queueIds: [] },
      schedulable: true,
      scheduleBlockedReason: null,
    });
    const listGenerations = vi.fn(async () => [{
      id: "generation-thumbnail",
      outputs: [{
        id: "output-thumbnail",
        status: "completed",
        artifact: {
          queueId: "output-thumbnail",
          kind: "image_gallery",
          deliveryFormat: "instagram_feed_carousel",
          assets: [{ url: "https://cdn.example.com/generated-card.webp", fileName: "card.webp", mimeType: "image/webp", width: 1080, height: 1350 }],
          posterUrl: null,
          html: null,
          text: null,
        },
      }],
    }] as AiContentGeneration[]);
    await renderPage({ listPublishItems: vi.fn(async () => [generated]) }, { listGenerations });

    expect(listGenerations).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(screen.getByRole("button", { name: "콘텐츠 추가" }));
    const tray = await screen.findByRole("region", { name: "미예약 콘텐츠 보관함" });
    expect(await within(tray).findByRole("img", { name: "생성 결과 카드뉴스 미리보기" })).toHaveAttribute("src", "https://cdn.example.com/generated-card.webp");
    expect(listGenerations).toHaveBeenCalledTimes(1);
    expect(listGenerations).toHaveBeenCalledWith("brand-1");
  });

  it("loads generated media for a reserved item and shows it in the selected calendar detail", async () => {
    const reserved = item({
      itemKey: "output:reserved-thumbnail",
      title: "예약된 생성 카드뉴스",
      scheduledFor: "2026-08-29T02:30:00.000Z",
      effectiveScheduledFor: "2026-08-29T02:30:00.000Z",
      calendarDate: "2026-08-29T02:30:00.000Z",
      sourceRefs: { ...item().sourceRefs, generationId: "generation-reserved", generationOutputId: "output-reserved" },
    });
    const listGenerations = vi.fn(async () => [{
      id: "generation-reserved",
      outputs: [{
        id: "output-reserved",
        status: "completed",
        artifact: {
          queueId: "output-reserved",
          kind: "image_gallery",
          deliveryFormat: "instagram_feed_carousel",
          assets: [{ url: "https://cdn.example.com/reserved-card.webp", fileName: "card.webp", mimeType: "image/webp", width: 1080, height: 1350 }],
          posterUrl: null,
          html: null,
          text: null,
        },
      }],
    }] as AiContentGeneration[]);
    await renderPage({ listPublishItems: vi.fn(async () => [reserved]) }, { listGenerations });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "예약된 생성 카드뉴스 게시 예정 슬롯 상세 보기" }));

    expect(await screen.findByRole("img", { name: "예약된 생성 카드뉴스 미리보기" })).toHaveAttribute("src", "https://cdn.example.com/reserved-card.webp");
    expect(listGenerations).toHaveBeenCalledTimes(1);
    expect(listGenerations).toHaveBeenCalledWith("brand-1");
  });

  it("shows the common-list skeleton and fail-closed empty state", async () => {
    let reject!: (reason: Error) => void;
    const pending = new Promise<PublishItem[]>((_resolve, nextReject) => { reject = nextReject; });
    await renderPage({ listPublishItems: vi.fn(() => pending) });
    expect(screen.getByLabelText("게시 관리 목록을 불러오는 중입니다.")).toBeVisible();
    reject(new Error("api_down"));
    expect(await screen.findByText("API 서버가 응답하지 않아 게시 관리 목록을 불러오지 못했습니다.")).toBeVisible();
    expect(screen.getByText("게시 관리 목록이 비어 있습니다")).toBeVisible();
  });

  it("loads calendar support data only after switching views", async () => {
    const api = await renderPage({ listPublishItems: vi.fn(async () => [item()]) });
    await screen.findByRole("article", { name: "예약된 SNS 마케팅" });
    expect(api.listChannels).not.toHaveBeenCalled();
    expect(api.getChannelCapabilities).not.toHaveBeenCalled();
    expect(api.getPublishCalendarWeeklySettings).not.toHaveBeenCalled();
    expect(api.getPublishCalendarSettings).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    await waitFor(() => expect(api.listChannels).toHaveBeenCalledWith("brand-1"));
    expect(api.getChannelCapabilities).toHaveBeenCalledWith("brand-1");
    expect(api.getPublishCalendarWeeklySettings).toHaveBeenCalledWith("brand-1");
    expect(api.getPublishCalendarSettings).toHaveBeenCalledWith("brand-1");
  });

  it("uses the weekly read, dedicated confirmed toggle, usage, and weekly save without touching legacy writes", async () => {
    const getPublishCalendarSettings = vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news" as const, trendFormat: "reel" as const, slotTimes: ["11:30"], updatedAt: null }));
    const savePublishCalendarSettings = vi.fn();
    const setPublishCalendarEnabled = vi.fn(async (_brandId: string, enabled: boolean) => ({ ...weeklySettings, enabled }));
    const savePublishCalendarWeeklySettings = vi.fn(async (_brandId: string, payload: Record<string, unknown>) => ({ ...weeklySettings, ...payload }));
    const api = await renderPage({
      listChannels: vi.fn(async () => [connectedInstagram]),
      getPublishCalendarWeeklySettings: vi.fn(async () => weeklySettings),
      getPublishCalendarSettings,
      getPublishCalendarUsage: vi.fn(async () => manualOptions.usage),
      setPublishCalendarEnabled,
      savePublishCalendarWeeklySettings,
      savePublishCalendarSettings,
    });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    const offSwitch = await screen.findByRole("switch", { name: "자동 게시 OFF" });
    expect(offSwitch).toHaveAttribute("aria-checked", "false");
    expect(getPublishCalendarSettings).not.toHaveBeenCalled();
    expect(api.getPublishCalendarUsage).toHaveBeenCalledWith("brand-1");

    await userEvent.click(offSwitch);
    await waitFor(() => expect(screen.getByRole("switch", { name: "자동 게시 ON" })).toHaveAttribute("aria-checked", "true"));
    expect(setPublishCalendarEnabled).toHaveBeenCalledWith("brand-1", true);

    await userEvent.click(screen.getByRole("button", { name: "자동 게시 수정" }));
    const dialog = await screen.findByRole("dialog", { name: "주간 자동 게시 설정" });
    expect(within(dialog).queryByRole("switch")).not.toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText("월요일 1번째 게시 시간"));
    await userEvent.type(within(dialog).getByLabelText("월요일 1번째 게시 시간"), "11:43");
    await userEvent.click(within(dialog).getByRole("button", { name: "설정 저장" }));

    await waitFor(() => expect(savePublishCalendarWeeklySettings).toHaveBeenCalledWith("brand-1", expect.objectContaining({
      weeklySchedule: [expect.objectContaining({ time: "11:43" })],
    })));
    expect(savePublishCalendarWeeklySettings.mock.calls[0][1]).not.toHaveProperty("enabled");
    expect(savePublishCalendarSettings).not.toHaveBeenCalled();
  });

  it("keeps the confirmed weekly state and reports a safe error when the dedicated toggle fails", async () => {
    const setPublishCalendarEnabled = vi.fn(async () => { throw new Error("provider detail must stay private"); });
    await renderPage({
      listChannels: vi.fn(async () => [connectedInstagram]),
      getPublishCalendarWeeklySettings: vi.fn(async () => weeklySettings),
      getPublishCalendarUsage: vi.fn(async () => manualOptions.usage),
      setPublishCalendarEnabled,
    });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("switch", { name: "자동 게시 OFF" }));

    expect(await screen.findByRole("switch", { name: "자동 게시 OFF" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("alert")).toHaveTextContent("자동 게시 상태를 변경하지 못했습니다. 잠시 후 다시 시도하세요.");
    expect(screen.queryByText(/provider detail/)).not.toBeInTheDocument();
  });

  it("does not invent OFF after a weekly read failure and retries the strict weekly read", async () => {
    const getPublishCalendarWeeklySettings = vi.fn()
      .mockRejectedValueOnce(new Error("temporary read failure"))
      .mockResolvedValueOnce({ ...weeklySettings, enabled: true });
    await renderPage({
      listChannels: vi.fn(async () => [connectedInstagram]),
      getPublishCalendarWeeklySettings,
      getPublishCalendarUsage: vi.fn(async () => manualOptions.usage),
    });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    expect(await screen.findByText("자동 게시 상태 확인 불가")).toBeVisible();
    expect(screen.queryByRole("switch", { name: /자동 게시 (ON|OFF)/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "자동 게시 다시 시도" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "자동 게시 ON" })).toBeVisible());
    expect(getPublishCalendarWeeklySettings).toHaveBeenCalledTimes(2);
  });

  it("retries a non-404 weekly settings failure inside the edit surface", async () => {
    const getPublishCalendarWeeklySettings = vi.fn()
      .mockRejectedValueOnce(new Error("temporary read failure"))
      .mockResolvedValueOnce(weeklySettings);
    await renderPage({
      listChannels: vi.fn(async () => [connectedInstagram]),
      getPublishCalendarWeeklySettings,
      getPublishCalendarUsage: vi.fn(async () => manualOptions.usage),
    });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "수정" }));
    const unavailable = await screen.findByRole("dialog", { name: "자동 게시 설정" });
    await userEvent.click(within(unavailable).getByRole("button", { name: "주간 설정 다시 시도" }));

    expect(getPublishCalendarWeeklySettings).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("dialog", { name: "주간 자동 게시 설정" })).toBeVisible();
  });

  it("retries only the legacy endpoint inside the edit surface after weekly 404 and legacy read failure", async () => {
    const getPublishCalendarWeeklySettings = vi.fn(async () => null);
    const getPublishCalendarSettings = vi.fn()
      .mockRejectedValueOnce(new Error("legacy read failure"))
      .mockResolvedValueOnce({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null });
    await renderPage({ getPublishCalendarWeeklySettings, getPublishCalendarSettings });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "자동 게시 설정" }));
    const unavailable = await screen.findByRole("dialog", { name: "자동 게시 설정" });
    await userEvent.click(within(unavailable).getByRole("button", { name: "자동 게시 설정 다시 시도" }));

    expect(getPublishCalendarWeeklySettings).toHaveBeenCalledTimes(1);
    expect(getPublishCalendarSettings).toHaveBeenCalledTimes(2);
    expect(within(await screen.findByRole("dialog", { name: "자동 게시 설정" })).getByRole("button", { name: "설정 저장" })).toBeVisible();
  });

  it("shows metadata checking and failure states without inventing disconnected or unsupported channels", async () => {
    let rejectChannels!: (reason: Error) => void;
    const channelsPending = new Promise<never>((_resolve, reject) => { rejectChannels = reject; });
    await renderPage({
      getPublishCalendarWeeklySettings: vi.fn(async () => weeklySettings),
      listChannels: vi.fn(() => channelsPending),
      getChannelCapabilities: vi.fn(() => new Promise(() => {})),
    });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    expect(await screen.findByText("자동 게시 사용 조건을 확인하는 중입니다.")).toBeVisible();
    expect(screen.queryByRole("switch", { name: /자동 게시 (ON|OFF)/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/미연결|자동 게시 미지원/)).not.toBeInTheDocument();

    rejectChannels(new Error("channels_down"));
    expect(await screen.findByText("게시 채널 정보를 확인하지 못했습니다.")).toBeVisible();
    expect(screen.getByRole("button", { name: "자동 게시 정보 다시 시도" })).toBeVisible();
    expect(screen.queryByRole("switch", { name: /자동 게시 (ON|OFF)/ })).not.toBeInTheDocument();
  });

  it("does not refetch weekly support data when only the displayed month changes", async () => {
    const api = await renderPage({
      getPublishCalendarWeeklySettings: vi.fn(async () => weeklySettings),
      listChannels: vi.fn(async () => [connectedInstagram]),
      getPublishCalendarUsage: vi.fn(async () => manualOptions.usage),
    });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await screen.findByRole("switch", { name: "자동 게시 OFF" });
    await userEvent.click(screen.getByRole("button", { name: "다음 달" }));

    expect(api.getPublishCalendarWeeklySettings).toHaveBeenCalledTimes(1);
    expect(api.listChannels).toHaveBeenCalledTimes(1);
    expect(api.getChannelCapabilities).toHaveBeenCalledTimes(1);
    expect(api.getPublishCalendarUsage).toHaveBeenCalledTimes(1);
  });

  it("keeps a confirmed toggle mutation when an older weekly GET resolves later", async () => {
    let resolveStale!: (value: typeof weeklySettings) => void;
    const staleRead = new Promise<typeof weeklySettings>((resolve) => { resolveStale = resolve; });
    const getPublishCalendarWeeklySettings = vi.fn()
      .mockResolvedValueOnce({ ...weeklySettings, enabled: true })
      .mockImplementationOnce(() => staleRead);
    const listChannels = vi.fn()
      .mockRejectedValueOnce(new Error("channels_down"))
      .mockResolvedValueOnce([connectedInstagram]);
    const setPublishCalendarEnabled = vi.fn(async () => ({ ...weeklySettings, enabled: false }));
    await renderPage({
      getPublishCalendarWeeklySettings,
      listChannels,
      getPublishCalendarUsage: vi.fn(async () => manualOptions.usage),
      setPublishCalendarEnabled,
    });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    expect(await screen.findByRole("switch", { name: "자동 게시 ON" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "자동 게시 정보 다시 시도" }));
    await waitFor(() => expect(listChannels).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole("switch", { name: "자동 게시 ON" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "자동 게시 OFF" })).toBeVisible());

    resolveStale({ ...weeklySettings, enabled: true });
    await act(async () => { await staleRead; });
    expect(screen.getByRole("switch", { name: "자동 게시 OFF" })).toBeVisible();
  });

  it("keeps a confirmed configuration save when an older weekly GET resolves later", async () => {
    let resolveStale!: (value: typeof weeklySettings) => void;
    const staleRead = new Promise<typeof weeklySettings>((resolve) => { resolveStale = resolve; });
    const getPublishCalendarWeeklySettings = vi.fn()
      .mockResolvedValueOnce(weeklySettings)
      .mockImplementationOnce(() => staleRead);
    const listChannels = vi.fn()
      .mockRejectedValueOnce(new Error("channels_down"))
      .mockResolvedValueOnce([connectedInstagram]);
    const saved = { ...weeklySettings, weeklySchedule: [{ ...weeklySettings.weeklySchedule[0], time: "12:34" }] };
    const savePublishCalendarWeeklySettings = vi.fn(async () => saved);
    await renderPage({
      getPublishCalendarWeeklySettings,
      listChannels,
      getPublishCalendarUsage: vi.fn(async () => manualOptions.usage),
      savePublishCalendarWeeklySettings,
    });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "자동 게시 수정" }));
    const dialog = await screen.findByRole("dialog", { name: "주간 자동 게시 설정" });
    expect(within(dialog).getByRole("button", { name: "설정 저장" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button", { name: "게시 채널 다시 시도" }));
    await waitFor(() => expect(listChannels).toHaveBeenCalledTimes(2));
    await userEvent.clear(within(dialog).getByLabelText("월요일 1번째 게시 시간"));
    await userEvent.type(within(dialog).getByLabelText("월요일 1번째 게시 시간"), "12:34");
    await userEvent.click(within(dialog).getByRole("button", { name: "설정 저장" }));
    await waitFor(() => expect(savePublishCalendarWeeklySettings).toHaveBeenCalledTimes(1));

    resolveStale(weeklySettings);
    await act(async () => { await staleRead; });
    await userEvent.click(screen.getByRole("button", { name: "자동 게시 수정" }));
    expect(within(await screen.findByRole("dialog", { name: "주간 자동 게시 설정" })).getByLabelText("월요일 1번째 게시 시간")).toHaveValue("12:34");
  });

  it.each(["mutation-first", "get-first"] as const)("keeps a confirmed toggle when a retry GET starts during PATCH and completes %s", async (order) => {
    const mutation = deferred<typeof weeklySettings>();
    const retryRead = deferred<typeof weeklySettings>();
    const getPublishCalendarWeeklySettings = vi.fn()
      .mockResolvedValueOnce({ ...weeklySettings, enabled: true })
      .mockRejectedValueOnce(new Error("weekly refresh failed"))
      .mockImplementationOnce(() => retryRead.promise);
    const listChannels = vi.fn()
      .mockRejectedValueOnce(new Error("channels down"))
      .mockResolvedValue([connectedInstagram]);
    const setPublishCalendarEnabled = vi.fn(() => mutation.promise);
    await renderPage({
      getPublishCalendarWeeklySettings,
      listChannels,
      getPublishCalendarUsage: vi.fn(async () => manualOptions.usage),
      setPublishCalendarEnabled,
    });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "자동 게시 정보 다시 시도" }));
    expect(await screen.findByRole("button", { name: "자동 게시 다시 시도" })).toBeVisible();
    await userEvent.click(screen.getByRole("switch", { name: "자동 게시 ON" }));
    await waitFor(() => expect(setPublishCalendarEnabled).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "자동 게시 다시 시도" }));
    await waitFor(() => expect(getPublishCalendarWeeklySettings).toHaveBeenCalledTimes(3));

    if (order === "mutation-first") {
      mutation.resolve({ ...weeklySettings, enabled: false });
      await waitFor(() => expect(screen.getByRole("switch", { name: "자동 게시 OFF" })).toBeVisible());
      retryRead.resolve({ ...weeklySettings, enabled: true });
      await act(async () => { await retryRead.promise; });
    } else {
      retryRead.resolve({ ...weeklySettings, enabled: true });
      await act(async () => { await retryRead.promise; });
      mutation.resolve({ ...weeklySettings, enabled: false });
      await act(async () => { await mutation.promise; });
    }

    expect(screen.getByRole("switch", { name: "자동 게시 OFF" })).toBeVisible();
  });

  it.each(["mutation-first", "get-first"] as const)("keeps a confirmed configuration when a retry GET starts during PUT and completes %s", async (order) => {
    const mutation = deferred<typeof weeklySettings>();
    const retryRead = deferred<typeof weeklySettings>();
    const getPublishCalendarWeeklySettings = vi.fn()
      .mockResolvedValueOnce({ ...weeklySettings, enabled: true })
      .mockRejectedValueOnce(new Error("weekly refresh failed"))
      .mockImplementationOnce(() => retryRead.promise);
    const listChannels = vi.fn()
      .mockRejectedValueOnce(new Error("channels down"))
      .mockResolvedValue([connectedInstagram]);
    const savePublishCalendarWeeklySettings = vi.fn(() => mutation.promise);
    await renderPage({
      getPublishCalendarWeeklySettings,
      listChannels,
      getPublishCalendarUsage: vi.fn(async () => manualOptions.usage),
      savePublishCalendarWeeklySettings,
    });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "자동 게시 정보 다시 시도" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "자동 게시 다시 시도" })).toBeVisible());
    await userEvent.click(screen.getByRole("button", { name: "자동 게시 수정" }));
    const dialog = await screen.findByRole("dialog", { name: "주간 자동 게시 설정" });
    await userEvent.clear(within(dialog).getByLabelText("월요일 1번째 게시 시간"));
    await userEvent.type(within(dialog).getByLabelText("월요일 1번째 게시 시간"), "12:34");
    await userEvent.click(within(dialog).getByRole("button", { name: "설정 저장" }));
    await waitFor(() => expect(savePublishCalendarWeeklySettings).toHaveBeenCalledTimes(1));
    await userEvent.click(within(dialog).getByRole("button", { name: "주간 설정 다시 시도" }));
    await waitFor(() => expect(getPublishCalendarWeeklySettings).toHaveBeenCalledTimes(3));

    const saved = { ...weeklySettings, enabled: true, weeklySchedule: [{ ...weeklySettings.weeklySchedule[0], time: "12:34" }] };
    if (order === "mutation-first") {
      mutation.resolve(saved);
      await act(async () => { await mutation.promise; });
      retryRead.resolve(weeklySettings);
      await act(async () => { await retryRead.promise; });
    } else {
      retryRead.resolve(weeklySettings);
      await act(async () => { await retryRead.promise; });
      mutation.resolve(saved);
      await act(async () => { await mutation.promise; });
    }

    await userEvent.click(await screen.findByRole("button", { name: "자동 게시 수정" }));
    expect(within(await screen.findByRole("dialog", { name: "주간 자동 게시 설정" })).getByLabelText("월요일 1번째 게시 시간")).toHaveValue("12:34");
  });

  it("maps the stable incomplete settings error from PUT to an actionable Korean fallback", async () => {
    await renderPage({
      getPublishCalendarWeeklySettings: vi.fn(async () => ({ ...weeklySettings, enabled: true })),
      listChannels: vi.fn(async () => [connectedInstagram]),
      getPublishCalendarUsage: vi.fn(async () => manualOptions.usage),
      savePublishCalendarWeeklySettings: vi.fn(async () => { throw { errorCode: "publish_calendar_settings_incomplete" }; }),
    });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "자동 게시 수정" }));
    const dialog = await screen.findByRole("dialog", { name: "주간 자동 게시 설정" });
    await userEvent.click(within(dialog).getByRole("button", { name: "설정 저장" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("자동 게시를 켠 상태로 저장하려면 주간 일정과 게시 가능한 연결 채널을 각각 한 개 이상 설정해 주세요.");
  });

  it("maps the stable incomplete settings error from PATCH to an actionable Korean fallback", async () => {
    await renderPage({
      getPublishCalendarWeeklySettings: vi.fn(async () => weeklySettings),
      listChannels: vi.fn(async () => [connectedInstagram]),
      getPublishCalendarUsage: vi.fn(async () => manualOptions.usage),
      setPublishCalendarEnabled: vi.fn(async () => { throw { errorCode: "publish_calendar_settings_incomplete" }; }),
    });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("switch", { name: "자동 게시 OFF" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("자동 게시를 켠 상태로 저장하려면 주간 일정과 게시 가능한 연결 채널을 각각 한 개 이상 설정해 주세요.");
  });

  it("renders the legacy settings path after weekly 404 and never performs a weekly write", async () => {
    const savePublishCalendarWeeklySettings = vi.fn();
    const setPublishCalendarEnabled = vi.fn();
    const savePublishCalendarSettings = vi.fn(async (_brandId: string, payload: Record<string, unknown>) => ({ brandId: "brand-1", updatedAt: null, ...payload }));
    await renderPage({
      getPublishCalendarWeeklySettings: vi.fn(async () => null),
      getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: false, channels: [], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })),
      savePublishCalendarWeeklySettings,
      setPublishCalendarEnabled,
      savePublishCalendarSettings,
    });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    expect(await screen.findByRole("button", { name: "자동 게시 설정" })).toBeVisible();
    expect(screen.queryByRole("switch", { name: /자동 게시 (ON|OFF)/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "자동 게시 설정" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "자동 게시 설정" })).getByRole("button", { name: "설정 저장" }));

    await waitFor(() => expect(savePublishCalendarSettings).toHaveBeenCalledTimes(1));
    expect(savePublishCalendarWeeklySettings).not.toHaveBeenCalled();
    expect(setPublishCalendarEnabled).not.toHaveBeenCalled();
  });

  it("opens the same fixed-source schedule panel lazily from the list", async () => {
    const schedulable = item({ status: "completed_unpublished", publishStatus: "unreserved", calendarDate: null, calendarPlacement: "unreserved", scheduledFor: null, effectiveScheduledFor: null, targets: [], schedulable: true, scheduleBlockedReason: null });
    const getPublishCalendarManualOptions = vi.fn(async () => manualOptions);
    const provisionPublishCalendarManualSlot = vi.fn(async (_brandId: string, _payload: unknown) => ({ id: "slot-new" }));
    const scheduled = item({ itemKey: schedulable.itemKey, title: schedulable.title });
    const listPublishItems = vi.fn().mockResolvedValueOnce([schedulable]).mockResolvedValueOnce([scheduled]);
    await renderPage({ getPublishCalendarManualOptions, provisionPublishCalendarManualSlot, listPublishItems });

    expect(getPublishCalendarManualOptions).not.toHaveBeenCalled();
    const scheduleButton = await screen.findByRole("button", { name: "게시 설정" });
    await userEvent.click(scheduleButton);
    expect(await screen.findByRole("dialog", { name: "예약된 SNS 마케팅 게시 설정" })).toHaveClass("publish-schedule-panel");
    expect(getPublishCalendarManualOptions).toHaveBeenCalledTimes(1);
    await userEvent.clear(screen.getByLabelText("게시 날짜"));
    await userEvent.type(screen.getByLabelText("게시 날짜"), "2099-08-24");
    await userEvent.clear(screen.getByLabelText("게시 시간"));
    await userEvent.type(screen.getByLabelText("게시 시간"), "10:10");
    await userEvent.click(screen.getByRole("button", { name: "게시 예약" }));

    await waitFor(() => expect(provisionPublishCalendarManualSlot).toHaveBeenCalledTimes(1));
    expect(provisionPublishCalendarManualSlot.mock.calls[0][1]).toMatchObject({
      source: { kind: "existing_output", generationOutputId: "output-1" },
      contentFormat: "card_news", channel: "instagram", scheduledFor: "2099-08-24T01:10:00.000Z",
    });
    expect(await screen.findByText("게시 예약을 저장했습니다.")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("article", { name: "예약된 SNS 마케팅" })).toHaveFocus());
  });

  it("offers the same delayed-today reservation change from the list card and calendar detail", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-24T00:00:00.000Z"));
    const reserved = item({
      operationalStatus: "delayed_today",
      operationalReason: "reserved_time_passed",
      status: "deferred",
      publishStatus: "deferred",
      scheduledFor: "2026-08-23T23:30:00.000Z",
      effectiveScheduledFor: "2026-08-23T23:45:00.000Z",
      calendarDate: "2026-08-23T23:45:00.000Z",
      groupStatus: "scheduled",
      sourceRefs: { ...item().sourceRefs, topicPublishGroupId: "group-1" },
      targets: [target({ status: "scheduled", scheduledFor: "2026-08-23T23:30:00.000Z" })],
    });
    const listPublishItems = vi.fn(async () => [reserved]);
    const reschedulePublishCalendarSlot = vi.fn(async () => ({ id: "slot-1" }));
    const api = await renderPage({ listPublishItems, reschedulePublishCalendarSlot });

    const card = await screen.findByRole("article", { name: "예약된 SNS 마케팅" });
    await userEvent.click(within(card).getByRole("button", { name: "예약 변경" }));
    expect(await screen.findByRole("dialog", { name: "예약된 SNS 마케팅 예약 변경" })).toBeVisible();
    expect(api.getPublishCalendarManualOptions).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText("게시 날짜"));
    await userEvent.type(screen.getByLabelText("게시 날짜"), "2026-08-30");
    await userEvent.clear(screen.getByLabelText("게시 시간"));
    await userEvent.type(screen.getByLabelText("게시 시간"), "10:10");
    await userEvent.click(within(screen.getByRole("dialog", { name: "예약된 SNS 마케팅 예약 변경" })).getByRole("button", { name: "예약 변경" }));

    await waitFor(() => expect(reschedulePublishCalendarSlot).toHaveBeenCalledWith(
      "brand-1", "slot-1", { scheduledFor: "2026-08-30T01:10:00.000Z" },
    ));
    expect(await screen.findByText("예약 시간을 변경했습니다.")).toBeVisible();

    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "예약된 SNS 마케팅 게시 지연 슬롯 상세 보기" }));
    await userEvent.click(screen.getByRole("button", { name: "예약 변경" }));
    expect(await screen.findByRole("dialog", { name: "예약된 SNS 마케팅 예약 변경" })).toBeVisible();
  });

  it("hides reservation changes for mixed queued and scheduled targets in both views", async () => {
    const mixed = item({
      groupStatus: "scheduled",
      sourceRefs: { ...item().sourceRefs, topicPublishGroupId: "group-1", queueIds: ["queue-1", "queue-2"] },
      targets: [
        target({ queueId: "queue-1", status: "queued" }),
        target({ queueId: "queue-2", channelOutputId: "channel-output-2", status: "scheduled" }),
      ],
    });
    await renderPage({ listPublishItems: vi.fn(async () => [mixed]) });

    const card = await screen.findByRole("article", { name: "예약된 SNS 마케팅" });
    expect(within(card).queryByRole("button", { name: "예약 변경" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "예약된 SNS 마케팅 게시 예정 슬롯 상세 보기" }));
    expect(screen.queryByRole("button", { name: "예약 변경" })).not.toBeInTheDocument();
  });

  it("uses saved preferred times when a new reservation date changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-25T06:00:00.000Z"));
    const schedulable = item({ status: "completed_unpublished", publishStatus: "unreserved", calendarDate: null, calendarPlacement: "unreserved", scheduledFor: null, effectiveScheduledFor: null, targets: [], schedulable: true, scheduleBlockedReason: null });
    await renderPage({
      listPublishItems: vi.fn(async () => [schedulable]),
      getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: true, channels: ["instagram"], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["14:00", "09:00"], updatedAt: null })),
      getPublishCalendarManualOptions: vi.fn(async () => manualOptions),
    });
    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(screen.getByRole("button", { name: "자동 게시 설정" }));
    expect(await screen.findByRole("dialog", { name: "자동 게시 설정" })).toBeVisible();
    expect(screen.getByLabelText("게시 시간")).toHaveValue("14:00, 09:00");
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await userEvent.click(screen.getByRole("button", { name: "콘텐츠 추가" }));
    await userEvent.click(within(screen.getByRole("region", { name: "미예약 콘텐츠 보관함" })).getByRole("button", { name: "게시 설정" }));
    await userEvent.clear(screen.getByLabelText("게시 날짜"));
    await userEvent.type(screen.getByLabelText("게시 날짜"), "2026-08-26");

    expect(screen.getByLabelText("게시 시간")).toHaveValue("09:00");
  });

  it("ignores a stale manual-options response after selecting another item", async () => {
    const firstItem = item({
      itemKey: "output:first",
      title: "첫 번째 카드뉴스",
      status: "completed_unpublished",
      publishStatus: "unreserved",
      calendarDate: null,
      calendarPlacement: "unreserved",
      scheduledFor: null,
      effectiveScheduledFor: null,
      targets: [],
      schedulable: true,
      scheduleBlockedReason: null,
      sourceRefs: { ...item().sourceRefs, generationOutputId: "output-first", calendarSlotId: null, queueIds: [] },
    });
    const secondItem = item({
      itemKey: "output:second",
      title: "두 번째 릴스",
      contentFormat: "reel",
      status: "completed_unpublished",
      publishStatus: "unreserved",
      calendarDate: null,
      calendarPlacement: "unreserved",
      scheduledFor: null,
      effectiveScheduledFor: null,
      targets: [],
      schedulable: true,
      scheduleBlockedReason: null,
      sourceRefs: { ...item().sourceRefs, generationOutputId: "output-second", calendarSlotId: null, queueIds: [] },
    });
    let resolveFirst!: (value: typeof manualOptions) => void;
    let resolveSecond!: (value: typeof manualOptions) => void;
    const firstOptions = { ...manualOptions, usage: { ...manualOptions.usage, publishing: { ...manualOptions.usage.publishing, additionalAvailable: 1 } } };
    const secondOptions = { ...manualOptions, usage: { ...manualOptions.usage, publishing: { ...manualOptions.usage.publishing, additionalAvailable: 3 } } };
    const getPublishCalendarManualOptions = vi.fn()
      .mockImplementationOnce(() => new Promise<typeof manualOptions>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<typeof manualOptions>((resolve) => { resolveSecond = resolve; }));
    await renderPage({ getPublishCalendarManualOptions, listPublishItems: vi.fn(async () => [firstItem, secondItem]) });

    await userEvent.click(within(await screen.findByRole("article", { name: "첫 번째 카드뉴스" })).getByRole("button", { name: "게시 설정" }));
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await userEvent.click(within(screen.getByRole("article", { name: "두 번째 릴스" })).getByRole("button", { name: "게시 설정" }));

    await act(async () => { resolveSecond(secondOptions); });
    expect(await screen.findByRole("dialog", { name: "두 번째 릴스 게시 설정" })).toBeVisible();
    expect(screen.getByText("이번 주 추가 예약 가능 3건 · 게시 한도 7건")).toBeVisible();

    await act(async () => { resolveFirst(firstOptions); });
    expect(screen.getByRole("dialog", { name: "두 번째 릴스 게시 설정" })).toBeVisible();
    expect(screen.getByText("이번 주 추가 예약 가능 3건 · 게시 한도 7건")).toBeVisible();
    expect(screen.queryByText("이번 주 추가 예약 가능 1건 · 게시 한도 7건")).not.toBeInTheDocument();
  });

  it("opens the same fixed-source schedule panel from the calendar unreserved tray", async () => {
    const schedulable = item({ status: "completed_unpublished", publishStatus: "unreserved", calendarDate: null, calendarPlacement: "unreserved", scheduledFor: null, effectiveScheduledFor: null, targets: [], schedulable: true, scheduleBlockedReason: null });
    const getPublishCalendarManualOptions = vi.fn(async () => manualOptions);
    const provisionPublishCalendarManualSlot = vi.fn(async (_brandId: string, _payload: unknown) => ({ id: "slot-new" }));
    await renderPage({ getPublishCalendarManualOptions, provisionPublishCalendarManualSlot, listPublishItems: vi.fn(async () => [schedulable]) });
    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    const contentTrigger = screen.getByRole("button", { name: "콘텐츠 추가" });
    await userEvent.click(contentTrigger);
    const tray = await screen.findByRole("region", { name: "미예약 콘텐츠 보관함" });
    await userEvent.click(within(tray).getByRole("button", { name: "게시 설정" }));

    const scheduleDialog = await screen.findByRole("dialog", { name: "예약된 SNS 마케팅 게시 설정" });
    expect(scheduleDialog).toHaveClass("publish-schedule-panel");
    expect(screen.queryByRole("combobox", { name: "게시할 콘텐츠" })).not.toBeInTheDocument();
    expect(getPublishCalendarManualOptions).toHaveBeenCalledTimes(2);
    await userEvent.click(within(scheduleDialog).getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(contentTrigger).toHaveFocus());
  });

  it("never offers a new schedule action for non-schedulable publish states", async () => {
    const states = ["reserved", "publishing", "published", "failed", "cancelled"] as const;
    const items = states.map((status, index) => item({ itemKey: `state:${status}`, title: `상태 ${status}`, status, publishStatus: status, schedulable: true, calendarPlacement: "unreserved", calendarDate: null, sourceRefs: { ...item().sourceRefs, generationOutputId: `output-${index}` } }));
    await renderPage({ listPublishItems: vi.fn(async () => items) });
    expect(await screen.findByRole("article", { name: "상태 reserved" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "게시 설정" })).not.toBeInTheDocument();
  });

  it("does not offer reservation changes for action-required, unsafe delayed, publishing, partial, failed, unknown, completed, or cancelled items", async () => {
    const future = "2099-08-23T02:30:00.000Z";
    const blocked = [
      item({ itemKey: "past", title: "지난 예약", operationalStatus: "action_required", operationalReason: "stale_reservation", scheduledFor: "2026-08-01T02:30:00.000Z", effectiveScheduledFor: "2026-08-01T02:30:00.000Z", calendarDate: "2026-08-01T02:30:00.000Z" }),
      item({ itemKey: "deferred", title: "재시도 중", operationalStatus: "delayed_today", operationalReason: "reserved_time_passed", status: "deferred", publishStatus: "deferred", scheduledFor: future, effectiveScheduledFor: future, calendarDate: future, targets: [target({ status: "deferred", scheduledFor: future })] }),
      item({ itemKey: "publishing", title: "게시 중", operationalStatus: "publishing", operationalReason: "publishing", status: "publishing", publishStatus: "publishing", scheduledFor: future, effectiveScheduledFor: future, calendarDate: future, targets: [target({ status: "publishing", scheduledFor: future })] }),
      item({ itemKey: "partial", title: "일부 게시", operationalStatus: "partially_published", operationalReason: "partially_published", status: "partially_published", publishStatus: "partially_published", publicationProgress: "partial", scheduledFor: future, effectiveScheduledFor: future, calendarDate: future }),
      item({ itemKey: "review", title: "검토 필요", operationalStatus: "action_required", operationalReason: "review_required", scheduledFor: future, effectiveScheduledFor: future, calendarDate: future }),
      item({ itemKey: "failed", title: "게시 실패", operationalStatus: "action_required", operationalReason: "publish_failed", status: "failed", publishStatus: "failed", scheduledFor: future, effectiveScheduledFor: future, calendarDate: future, targets: [target({ status: "failed", scheduledFor: future })] }),
      item({ itemKey: "unknown", title: "결과 확인 필요", operationalStatus: "action_required", operationalReason: "result_unknown", status: "result_unknown", publishStatus: "result_unknown", scheduledFor: future, effectiveScheduledFor: future, calendarDate: future }),
      item({ itemKey: "published", title: "게시 완료", operationalStatus: "published", operationalReason: "published", status: "published", publishStatus: "published", publicationProgress: "complete", scheduledFor: future, effectiveScheduledFor: future, calendarDate: future, targets: [target({ status: "published", scheduledFor: future })] }),
      item({ itemKey: "cancelled", title: "예약 취소", operationalStatus: "cancelled", operationalReason: "cancelled", status: "cancelled", publishStatus: "cancelled", scheduledFor: future, effectiveScheduledFor: future, calendarDate: future, targets: [target({ status: "cancelled", scheduledFor: future })] }),
    ];
    await renderPage({ listPublishItems: vi.fn(async () => blocked) });

    expect(await screen.findByRole("article", { name: "지난 예약" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "예약 변경" })).not.toBeInTheDocument();
  });

  it("closes after a saved reservation and reports refresh failure without resubmitting", async () => {
    const schedulable = item({ status: "completed_unpublished", publishStatus: "unreserved", calendarDate: null, calendarPlacement: "unreserved", scheduledFor: null, effectiveScheduledFor: null, targets: [], schedulable: true, scheduleBlockedReason: null });
    const listPublishItems = vi.fn().mockResolvedValueOnce([schedulable]).mockRejectedValueOnce(new Error("refresh failed"));
    const provisionPublishCalendarManualSlot = vi.fn(async (_brandId: string, _payload: unknown) => ({ id: "slot-new" }));
    await renderPage({ getPublishCalendarManualOptions: vi.fn(async () => manualOptions), provisionPublishCalendarManualSlot, listPublishItems });
    await userEvent.click(await screen.findByRole("button", { name: "게시 설정" }));
    await userEvent.clear(screen.getByLabelText("게시 날짜"));
    await userEvent.type(screen.getByLabelText("게시 날짜"), "2099-08-24");
    await userEvent.click(screen.getByRole("button", { name: "게시 예약" }));

    expect(await screen.findByText("게시 예약은 저장했지만 목록을 새로고침하지 못했습니다. 새로고침 후 다시 확인하세요.")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "예약된 SNS 마케팅 게시 설정" })).not.toBeInTheDocument();
    expect(provisionPublishCalendarManualSlot).toHaveBeenCalledTimes(1);
  });

  it("opens the existing calendar reservation when a stale unreserved item is already scheduled", async () => {
    const stale = item({ status: "completed_unpublished", publishStatus: "unreserved", calendarDate: null, calendarPlacement: "unreserved", scheduledFor: null, effectiveScheduledFor: null, targets: [], schedulable: true, scheduleBlockedReason: null });
    const reserved = item({
      scheduledFor: "2099-09-01T02:30:00.000Z",
      effectiveScheduledFor: "2099-09-01T02:30:00.000Z",
      calendarDate: "2099-09-01T02:30:00.000Z",
    });
    const listPublishItems = vi.fn().mockResolvedValueOnce([stale]).mockResolvedValueOnce([reserved]);
    const alreadyScheduled = Object.assign(new Error("conflict"), { errorCode: "publish_calendar_content_already_scheduled" });
    await renderPage({ getPublishCalendarManualOptions: vi.fn(async () => manualOptions), provisionPublishCalendarManualSlot: vi.fn(async () => Promise.reject(alreadyScheduled)), listPublishItems });
    await userEvent.click(await screen.findByRole("button", { name: "게시 설정" }));
    await userEvent.clear(screen.getByLabelText("게시 날짜"));
    await userEvent.type(screen.getByLabelText("게시 날짜"), "2099-08-24");
    await userEvent.click(screen.getByRole("button", { name: "게시 예약" }));

    expect(await screen.findByRole("tab", { name: "캘린더", selected: true })).toBeVisible();
    expect(screen.getByRole("heading", { name: "2099년 09월" })).toBeVisible();
    expect(await screen.findByLabelText("예약된 SNS 마케팅 슬롯 상세")).toBeVisible();
    expect(screen.getByText("이미 예약된 콘텐츠의 기존 예약 상세를 엽니다.")).toBeVisible();
  });

  it("selects Seoul today in the current month and the first day after month navigation", async () => {
    await renderPage({ listPublishItems: vi.fn(async () => []) });
    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const day = Number(parts.find((part) => part.type === "day")?.value);
    expect(await screen.findByLabelText(`${month}월 ${day}일 게시 일정`)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "다음 달" }));
    const nextMonth = month === 12 ? 1 : month + 1;
    expect(await screen.findByLabelText(`${nextMonth}월 1일 게시 일정`)).toBeVisible();
  });

  it("loads DB-backed new-content and bulk fields only when the calendar tray opens", async () => {
    const getPublishCalendarManualOptions = vi.fn(async () => ({ ...manualOptions, products: [{ value: "product-1", label: "사장님 마케팅 패키지" }] }));
    await renderPage({ getPublishCalendarManualOptions, listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]), listPublishItems: vi.fn(async () => []) });
    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    expect(getPublishCalendarManualOptions).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "콘텐츠 추가" }));
    await waitFor(() => expect(getPublishCalendarManualOptions).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("tab", { name: "새 콘텐츠" }));
    expect(await screen.findByRole("combobox", { name: "콘텐츠 목적" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "주제 방식" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "콘텐츠 형식" })).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "일괄 등록" }));
    expect(screen.getByRole("table", { name: "일괄 주제 설정" })).toBeVisible();
  });

  it("explains that a subscription plan is required when manual options are unavailable", async () => {
    const inactiveSubscription = Object.assign(new Error("inactive subscription"), {
      errorCode: "publish_calendar_subscription_inactive",
    });
    await renderPage({
      getPublishCalendarManualOptions: vi.fn(async () => Promise.reject(inactiveSubscription)),
      listPublishItems: vi.fn(async () => []),
    });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(screen.getByRole("button", { name: "콘텐츠 추가" }));
    await userEvent.click(screen.getByRole("tab", { name: "새 콘텐츠" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("게시 예약을 사용하려면 구독 플랜을 확인해 주세요.");
    expect(screen.queryByText("게시 설정 선택 항목을 불러오지 못했습니다.")).not.toBeInTheDocument();
  });

  it("keeps an unavailable settings dialog read-only and restores trigger focus", async () => {
    await renderPage({
      listPublishItems: vi.fn(async () => [item()]),
      getPublishCalendarSettings: vi.fn(async () => { throw new Error("settings_down"); })
    });
    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    const trigger = await screen.findByRole("button", { name: "자동 게시 설정" });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "자동 게시 설정" });
    expect(within(dialog).getByText("설정을 불러온 뒤에만 변경할 수 있습니다.")).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "설정 저장" })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("saves duplicate and nearby automatic publish times", async () => {
    const savePublishCalendarSettings = vi.fn(async (_brandId: string, payload: Record<string, unknown>) => ({ brandId: "brand-1", updatedAt: "2026-08-23T00:00:00.000Z", ...payload }));
    await renderPage({
      listPublishItems: vi.fn(async () => []),
      listChannels: vi.fn(async () => [{ type: "instagram", enabled: true, status: "connected" }]),
      getPublishCalendarSettings: vi.fn(async () => ({ brandId: "brand-1", enabled: true, channels: ["instagram"], informationalFormat: "card_news", trendFormat: "reel", slotTimes: ["11:30"], updatedAt: null })),
      savePublishCalendarSettings
    });

    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "자동 게시 설정" }));
    const dialog = await screen.findByRole("dialog", { name: "자동 게시 설정" });
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "게시 시간" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "게시 시간" }), "11:30, 11:30, 11:45");
    await userEvent.click(within(dialog).getByRole("button", { name: "설정 저장" }));

    await waitFor(() => expect(savePublishCalendarSettings).toHaveBeenCalledWith("brand-1", expect.objectContaining({
      slotTimes: ["11:30", "11:30", "11:45"]
    })));
    expect(screen.queryByText(/30분 간격/)).not.toBeInTheDocument();
  });

  it("keeps keyboard tab navigation and the labelled tabpanel", async () => {
    await renderPage();
    const listTab = await screen.findByRole("tab", { name: "목록" });
    listTab.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "캘린더" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "publish-view-tab-calendar");
  });

  it("uses calendar slot id for calendar cancellation and refreshes common collection", async () => {
    const listPublishItems = vi.fn(async () => [item()]);
    const api = await renderPage({ listPublishItems });
    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));
    await userEvent.click(await screen.findByRole("button", { name: "예약된 SNS 마케팅 게시 예정 슬롯 상세 보기" }));
    await userEvent.click(screen.getByRole("button", { name: "슬롯 취소" }));
    await waitFor(() => expect(api.cancelPublishCalendarSlot).toHaveBeenCalledWith("brand-1", "slot-1"));
    expect(listPublishItems).toHaveBeenCalledTimes(2);
    expect(api.cancelPublishQueueItem).not.toHaveBeenCalled();
  });

  it("uses calendar slot id from the list even when one target makes the aggregate status failed", async () => {
    const linked = item({
      status: "failed",
      publishStatus: "failed",
      calendarDate: null,
      calendarPlacement: "hidden",
      targets: [
        target({ queueId: "queue-failed", status: "failed", scheduledFor: null, lastError: "threads_failed" }),
        target({ queueId: "queue-scheduled", channel: "threads", status: "scheduled" }),
      ],
    });
    const listPublishItems = vi.fn(async () => [linked]);
    const api = await renderPage({ listPublishItems });
    await userEvent.click(await screen.findByRole("button", { name: "예약 취소" }));
    await waitFor(() => expect(api.cancelPublishCalendarSlot).toHaveBeenCalledWith("brand-1", "slot-1"));
    expect(api.cancelPublishQueueItem).not.toHaveBeenCalled();
    expect(listPublishItems).toHaveBeenCalledTimes(2);
  });

  it("keeps calendar placement separate from original, effective and published times", async () => {
    const deferred = item({ title: "지연 예약", status: "deferred", operationalStatus: "delayed_today", operationalReason: "reserved_time_passed", publishStatus: "deferred", scheduledFor: "2026-08-23T02:30:00.000Z", effectiveScheduledFor: "2026-08-23T03:00:00.000Z", calendarDate: "2026-08-23T03:00:00.000Z", targets: [target({ status: "deferred", scheduledFor: "2026-08-23T02:30:00.000Z" })] });
    const published = item({ itemKey: "output:published", title: "게시 완료", status: "published", operationalStatus: "published", operationalReason: "published", publishStatus: "published", publicationProgress: "complete", scheduledFor: "2026-08-22T02:30:00.000Z", effectiveScheduledFor: "2026-08-22T03:00:00.000Z", publishedAt: "2026-08-23T04:00:00.000Z", calendarDate: "2026-08-23T04:00:00.000Z", sourceRefs: { contentTopicId: null, proposalId: null, generationId: null, generationOutputId: "output-published", calendarSlotId: "slot-published", topicPublishGroupId: null, queueIds: ["queue-published"] }, targets: [target({ queueId: "queue-published", status: "published", scheduledFor: "2026-08-22T02:30:00.000Z", publishedAt: "2026-08-23T04:00:00.000Z" })] });
    await renderPage({ listPublishItems: vi.fn(async () => [deferred, published]) });
    const deferredCard = await screen.findByRole("article", { name: "지연 예약" });
    expect(within(deferredCard).getByText("원래 예약 2026년 8월 23일 일요일 11:30")).toBeVisible();
    expect(within(deferredCard).getByText("실제 실행 예정 2026년 8월 23일 일요일 12:00")).toBeVisible();
    await userEvent.click(await screen.findByRole("tab", { name: "캘린더" }));

    await userEvent.click(await screen.findByRole("button", { name: "지연 예약 게시 지연 슬롯 상세 보기" }));
    expect(screen.getByText("원래 예약 시각")).toBeVisible();
    expect(screen.getByText("지연 후 실제 게시 예정")).toBeVisible();
    expect(screen.getByText("원래 예약 시각").parentElement?.textContent).toBe("원래 예약 시각2026년 8월 23일 일요일 11:30");
    expect(screen.getByText("지연 후 실제 게시 예정").parentElement?.textContent).toBe("지연 후 실제 게시 예정2026년 8월 23일 일요일 12:00");
    await userEvent.click(screen.getByRole("button", { name: "전체 일정 보기" }));
    await userEvent.click(screen.getByRole("button", { name: "게시 완료 게시 완료 슬롯 상세 보기" }));
    expect(screen.getByText("게시 완료 시각")).toBeVisible();
    expect(screen.queryByText("원래 예약 시각")).not.toBeInTheDocument();
  });

  it("keeps queue-specific cancellation and retry behavior", async () => {
    const cancellable = item({ itemKey: "direct:cancel", sourceRefs: { contentTopicId: null, proposalId: null, generationId: null, generationOutputId: "output-1", calendarSlotId: null, topicPublishGroupId: null, queueIds: ["queue-cancel"] }, targets: [target({ queueId: "queue-cancel", status: "scheduled" })] });
    const retryable = item({ itemKey: "direct:retry", title: "재시도 콘텐츠", status: "failed", operationalStatus: "action_required", operationalReason: "publish_failed", publishStatus: "failed", calendarPlacement: "hidden", calendarDate: null, scheduledFor: null, effectiveScheduledFor: null, sourceRefs: { contentTopicId: null, proposalId: null, generationId: null, generationOutputId: "output-2", calendarSlotId: null, topicPublishGroupId: null, queueIds: ["queue-retry"] }, targets: [target({ queueId: "queue-retry", status: "failed", scheduledFor: null, lastError: "provider_not_implemented" })], lastError: "provider_not_implemented" });
    const nonRetryable = item({ itemKey: "direct:no-retry", title: "재시도 불가 콘텐츠", status: "failed", operationalStatus: "action_required", operationalReason: "publish_failed", publishStatus: "failed", calendarPlacement: "hidden", calendarDate: null, scheduledFor: null, effectiveScheduledFor: null, sourceRefs: { contentTopicId: null, proposalId: null, generationId: null, generationOutputId: "output-3", calendarSlotId: null, topicPublishGroupId: null, queueIds: ["queue-no-retry"] }, targets: [target({ queueId: "queue-no-retry", status: "failed", scheduledFor: null, lastError: "instagram_publish_failed" })], lastError: "instagram_publish_failed" });
    const listPublishItems = vi.fn(async () => [cancellable, retryable, nonRetryable]);
    const api = await renderPage({ listPublishItems });

    await userEvent.click(await screen.findByRole("button", { name: "예약 취소" }));
    await waitFor(() => expect(api.cancelPublishQueueItem).toHaveBeenCalledWith("queue-cancel"));
    const retryableCard = screen.getByRole("article", { name: "재시도 콘텐츠" });
    expect(within(retryableCard).getByText("이 채널은 아직 자동 게시를 지원하지 않습니다.")).toBeVisible();
    expect(within(retryableCard).getByRole("button", { name: "재시도" })).toBeVisible();
    const nonRetryableCard = screen.getByRole("article", { name: "재시도 불가 콘텐츠" });
    expect(within(nonRetryableCard).getByText("Instagram 게시에 실패했습니다. 잠시 후 다시 시도해 주세요.")).toBeVisible();
    expect(within(nonRetryableCard).queryByRole("button", { name: "재시도" })).not.toBeInTheDocument();
    expect(within(nonRetryableCard).queryByText("instagram_publish_failed")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "재시도" }));
    await waitFor(() => expect(api.retryPublishQueueItem).toHaveBeenCalledWith("queue-retry"));
    expect(listPublishItems).toHaveBeenCalledTimes(3);
  });

  it("preserves partial multi-channel results and blocks cancellation after publishing starts", async () => {
    const mixed = item({
      status: "failed", publishStatus: "failed", publicationProgress: "partial", lastError: "threads_failed",
      targets: [
        target({ queueId: "queue-instagram", status: "published", publishedAt: "2026-08-23T03:00:00.000Z" }),
        target({ queueId: "queue-threads", channel: "threads", channelOutputId: "threads-output", status: "failed", scheduledFor: null, failedAt: "2026-08-23T03:05:00.000Z", lastError: "threads_failed" })
      ]
    });
    const publishing = item({ itemKey: "output:publishing", title: "게시 중 콘텐츠", status: "publishing", publishStatus: "publishing", targets: [target({ queueId: "queue-publishing", status: "publishing" })] });
    const publishedAndScheduled = item({
      itemKey: "output:partial-active",
      title: "일부 게시 후 예약",
      status: "scheduled",
      publishStatus: "scheduled",
      publicationProgress: "partial",
      targets: [
        target({ queueId: "queue-published", status: "published", publishedAt: "2026-08-23T03:00:00.000Z" }),
        target({ queueId: "queue-still-scheduled", channel: "threads", status: "scheduled" }),
      ],
    });
    await renderPage({ listPublishItems: vi.fn(async () => [mixed, publishing, publishedAndScheduled]) });

    const mixedCard = await screen.findByRole("article", { name: "예약된 SNS 마케팅" });
    expect(within(mixedCard).getByRole("button", { name: "Instagram 성공" })).toBeVisible();
    expect(within(mixedCard).getByRole("button", { name: "Threads 실패" })).toBeVisible();
    expect(within(screen.getByRole("article", { name: "게시 중 콘텐츠" })).queryByRole("button", { name: "예약 취소" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "일부 게시 후 예약" })).queryByRole("button", { name: "예약 취소" })).not.toBeInTheDocument();
  });

  it("preserves grouped content review, partial success and content detail", async () => {
    const reviewTargets: PublishItem["reviewTargets"] = [
      { channelOutputId: "review-instagram", channel: "instagram", deliveryFormat: "instagram_feed_carousel", status: "pending_review", previewTitle: "Instagram 검토", previewBody: "검토 본문", outputJson: {}, sourceSummary: "검토 근거", blockReasons: [], generatedAt: "2026-08-22T00:00:00.000Z" },
      { channelOutputId: "review-threads", channel: "threads", deliveryFormat: "threads_text", status: "pending_review", previewTitle: "Threads 검토", previewBody: "Threads 본문", outputJson: {}, sourceSummary: "검토 근거", blockReasons: [], generatedAt: "2026-08-22T00:00:00.000Z" }
    ];
    const reviewItem = item({ itemKey: "draft:review", title: "검토할 콘텐츠", targets: [], reviewTargets, publishStatus: "unreserved", status: "completed_unpublished", scheduledFor: null, effectiveScheduledFor: null, calendarDate: null, calendarPlacement: "hidden", sourceRefs: { contentTopicId: "topic-review", proposalId: null, generationId: null, generationOutputId: null, calendarSlotId: null, topicPublishGroupId: null, queueIds: [] }, schedulable: false, scheduleBlockedReason: "content_not_schedulable" });
    const reviewContentOutput = vi.fn()
      .mockResolvedValueOnce({ id: "review-instagram", status: "approved" })
      .mockRejectedValueOnce(new Error("threads_failed"));
    const api = await renderPage({ listPublishItems: vi.fn(async () => [reviewItem]), reviewContentOutput });

    await userEvent.click((await screen.findAllByRole("button", { name: "콘텐츠 보기" }))[0]);
    expect(await screen.findByRole("dialog", { name: "생성 콘텐츠 상세" })).toBeVisible();
    expect(api.getContentOutputArtifact).toHaveBeenCalledWith("review-instagram");
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await userEvent.click(screen.getByRole("button", { name: "승인" }));
    expect(await screen.findByText("일부 검토 결과를 저장하지 못했습니다. 성공 1개, 실패 1개입니다.")).toBeVisible();
    expect(reviewContentOutput).toHaveBeenCalledTimes(2);
  });

  it("separates saved review success from a common-list refresh failure", async () => {
    const reviewTarget: PublishItem["reviewTargets"][number] = { channelOutputId: "review-one", channel: "instagram", deliveryFormat: "instagram_feed_carousel", status: "pending_review", previewTitle: "검토", previewBody: "본문", outputJson: {}, sourceSummary: null, blockReasons: [], generatedAt: "2026-08-22T00:00:00.000Z" };
    const reviewItem = item({ itemKey: "draft:refresh", title: "새로고침 실패 검토", targets: [], reviewTargets: [reviewTarget], publishStatus: "unreserved", status: "completed_unpublished", scheduledFor: null, effectiveScheduledFor: null, calendarDate: null, calendarPlacement: "hidden", schedulable: false });
    const listPublishItems = vi.fn().mockResolvedValueOnce([reviewItem]).mockRejectedValueOnce(new Error("refresh_failed"));
    await renderPage({ listPublishItems });

    await userEvent.click(await screen.findByRole("button", { name: "승인" }));
    expect(await screen.findByText("검토 결과는 저장했지만 목록을 새로고침하지 못했습니다. 잠시 후 다시 확인하세요.")).toBeVisible();
  });

  it("reports partial review failure together with a common-list refresh failure", async () => {
    const reviewItem = item({ itemKey: "review:combined-failure", title: "복합 실패 검토", status: "completed_unpublished", publishStatus: "unreserved", calendarDate: null, calendarPlacement: "unreserved", targets: [], reviewTargets: [reviewTarget(), reviewTarget({ channelOutputId: "review-threads", channel: "threads" })] });
    const listPublishItems = vi.fn().mockResolvedValueOnce([reviewItem]).mockRejectedValueOnce(new Error("refresh failed"));
    const reviewContentOutput = vi.fn(async (outputId: string) => outputId === "review-threads" ? Promise.reject(new Error("review failed")) : { id: outputId, status: "approved" });
    await renderPage({ listPublishItems, reviewContentOutput });

    await userEvent.click(await screen.findByRole("button", { name: "승인" }));
    expect(await screen.findByText("일부 검토 결과를 저장하지 못했습니다. 성공 1개, 실패 1개이며 목록 새로고침도 실패했습니다. 잠시 후 다시 확인하세요.")).toBeVisible();
  });

  it("builds result details from selected target and loads artifact on demand", async () => {
    const published = item({ status: "published", publishStatus: "published", publicationProgress: "complete", publishedAt: "2026-08-23T03:00:00.000Z", calendarDate: "2026-08-23T03:00:00.000Z", targets: [target({ status: "published", publishedAt: "2026-08-23T03:00:00.000Z", externalPostId: "instagram/post-123", externalUrl: "https://instagram.example/post" })] });
    const api = await renderPage({ listPublishItems: vi.fn(async () => [published]) });

    await userEvent.click(await screen.findByRole("button", { name: "Instagram 성공" }));
    const dialog = await screen.findByRole("dialog", { name: "업로드 콘텐츠 상세" });
    expect(within(dialog).getByText("사장님 콘텐츠")).toBeVisible();
    expect(within(dialog).getByText("post-123")).toBeVisible();
    expect(within(dialog).getByRole("link", { name: "원본 URL 열기" })).toHaveAttribute("href", "https://instagram.example/post");
    expect(api.getPublishArtifact).toHaveBeenCalledWith("queue-1");
  });

  it("keeps artifact loading failures retryable and reports download failures inline", async () => {
    const published = item({ status: "published", publishStatus: "published", publicationProgress: "complete", publishedAt: "2026-08-23T03:00:00.000Z", calendarDate: "2026-08-23T03:00:00.000Z", targets: [target({ status: "published", publishedAt: "2026-08-23T03:00:00.000Z" })] });
    const getPublishArtifact = vi.fn().mockRejectedValueOnce(new Error("artifact_down")).mockResolvedValueOnce(artifact);
    const api = await renderPage({ listPublishItems: vi.fn(async () => [published]), getPublishArtifact, downloadPublishResult: vi.fn(async () => { throw new Error("download_down"); }) });
    await userEvent.click(await screen.findByRole("button", { name: "Instagram 성공" }));
    expect(await screen.findByText("결과물을 불러오지 못했습니다.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(getPublishArtifact).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "저장" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("게시 결과 저장에 실패했습니다. 잠시 후 다시 시도하세요.")).toBeVisible();
    expect(api.downloadPublishResult).toHaveBeenCalledWith("queue-1");
  });

  it("keeps queue deep links visible and focused across filters", async () => {
    window.history.replaceState({}, "", "/publish-queue?queueId=queue-1&status=failed");
    await renderPage({ listPublishItems: vi.fn(async () => [item()]) });
    const card = await screen.findByRole("article", { name: "예약된 SNS 마케팅" });
    await waitFor(() => expect(card).toHaveFocus());
    expect(card).toHaveAttribute("data-publish-deep-link", "true");
  });

  it("does not expose legacy queue scheduling or direct publish operations", async () => {
    await renderPage({ listPublishItems: vi.fn(async () => [item()]) });
    await screen.findByRole("article", { name: "예약된 SNS 마케팅" });
    expect(screen.queryByText("운영 도구")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "정책 큐 배정" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다음 게시 실행" })).not.toBeInTheDocument();
  });
});
