import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DmAttentionItem, DmConversationDetail, DmConversationSummary, InstagramDmSettings, WikiStatus } from "../types";

const conversation: DmConversationSummary = {
  id: "conversation-1",
  participant: { instagramScopedId: "scoped-123456", displayName: "홍길동", username: "customer", profileImageUrl: null },
  lastMessage: { body: "환불 절차가 궁금해요", direction: "inbound", createdAt: "2026-07-14T08:20:00.000Z" },
  automationStatus: "paused",
  attentionStatus: "open",
  openAttentionTypes: ["complaint"],
  unreadCount: 2
};

const attention: DmAttentionItem = {
  id: "attention-1",
  conversationId: conversation.id,
  type: "complaint",
  status: "open",
  originalMessage: "답변이 너무 늦어요",
  reason: "서비스 불만이 감지되었습니다.",
  autoReplyStatus: "sent",
  createdAt: "2026-07-14T08:20:00.000Z",
  resolvedAt: null
};

const detail: DmConversationDetail = {
  ...conversation,
  messages: [
    { id: "message-in", direction: "inbound", messageType: "text", body: "환불 절차가 궁금해요", decision: null, reasonCode: null, sourceLabel: null, confidence: null, deliveryStatus: null, createdAt: "2026-07-14T08:20:00.000Z" },
    { id: "message-out", direction: "outbound", messageType: "text", body: "담당자가 확인하겠습니다.", decision: "fallback", reasonCode: "complaint", sourceLabel: "고정 안내", confidence: null, deliveryStatus: "sent", createdAt: "2026-07-14T08:20:03.000Z" }
  ],
  attentionItems: [attention]
};

const wikiStatus: WikiStatus = {
  activeVersion: { id: "wiki-2", status: "active", version: 2, sourceCount: 3, documentCount: 5, knowledgeEntryCount: 12, chunkCount: 18, activatedAt: "2026-07-14T07:00:00.000Z", failedAt: null, errorMessage: null },
  latestFailedVersion: { id: "wiki-3", status: "failed", version: 3, sourceCount: 3, documentCount: 0, knowledgeEntryCount: 0, chunkCount: 0, activatedAt: null, failedAt: "2026-07-14T08:00:00.000Z", errorMessage: "embedding_failed" },
  importStats: { total: 1, succeeded: 1, failed: 0, faqRows: 10, productRows: 0 }
};

const dmSettings: InstagramDmSettings = {
  brandId: "brand-1",
  enabled: false,
  fallbackMessage: "담당자가 확인하겠습니다.",
  errorMessage: "잠시 후 다시 문의해 주세요.",
  brandCoreReady: true,
  wikiStatus: "active",
  wikiReady: true,
  messagePermissionReady: true,
  webhookStatus: "connected",
  workerStatus: "online"
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.clearAllMocks();
});

async function renderPage(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  const api = {
    listDmConversations: vi.fn(async () => ({ items: [conversation], nextCursor: null })),
    getDmConversation: vi.fn(async () => detail),
    listDmAttentionItems: vi.fn(async () => [attention]),
    resolveDmAttentionItem: vi.fn(async () => ({ conversationId: conversation.id, automationStatus: "active", attentionStatus: "resolved" })),
    sendManualDmReply: vi.fn(async () => ({
      id: "message-manual",
      direction: "outbound",
      messageType: "text",
      body: "수동으로 안내드립니다.",
      decision: null,
      reasonCode: "system_event",
      sourceLabel: null,
      confidence: null,
      deliveryStatus: "sent",
      createdAt: "2026-07-14T08:21:00.000Z"
    })),
    getInstagramDmSettings: vi.fn(async () => dmSettings),
    updateInstagramDmSettings: vi.fn(async (_brandId: string, payload: { enabled?: boolean }) => ({
      ...dmSettings,
      enabled: payload.enabled ?? dmSettings.enabled
    })),
    listKnowledgeImports: vi.fn(async () => [{ id: "import-1", entryType: "faq", fileName: "faq.csv", status: "succeeded", totalRows: 10, validRows: 9, duplicateRows: 1, invalidRows: 0, updatedRows: 9, createdAt: "2026-07-14T06:00:00.000Z" }]),
    getWikiStatus: vi.fn(async () => wikiStatus),
    importKnowledge: vi.fn(async (_brandId: string, payload: { entryType: "faq" | "product" }) => ({ id: "import-2", entryType: payload.entryType, fileName: "data.csv", status: "succeeded", totalRows: 1, validRows: 1, duplicateRows: 0, invalidRows: 0, updatedRows: 1, createdAt: "2026-07-14T09:00:00.000Z" })),
    refreshWiki: vi.fn(async () => ({ id: "wiki-job", status: "queued" })),
    ...overrides
  };
  vi.doMock("../lib/apiClient", () => ({ DEMO_BRAND_ID: "brand-1", api }));
  const { DmAutomationPage } = await import("../pages/DmAutomationPage");
  render(<DmAutomationPage />);
  return api;
}

describe("DmAutomationPage", () => {
  it("shows skeletons while readiness, conversations, and messages are pending", async () => {
    let resolveConversations: ((value: { items: DmConversationSummary[]; nextCursor: null }) => void) | undefined;
    const api = await renderPage({
      listDmConversations: vi.fn(() => new Promise((resolve) => { resolveConversations = resolve; })),
      getDmConversation: vi.fn(() => new Promise(() => {})),
      getInstagramDmSettings: vi.fn(() => new Promise(() => {}))
    });

    expect(screen.getByRole("status", { name: "DM 준비 상태를 불러오는 중입니다." })).toBeVisible();
    expect(screen.getByRole("status", { name: "대화 목록을 불러오는 중입니다." })).toHaveClass("skeleton-list");
    resolveConversations?.({ items: [conversation], nextCursor: null });
    await userEvent.click(await screen.findByRole("button", { name: "홍길동 대화 열기" }));
    expect(screen.getByRole("status", { name: "대화 내용을 불러오는 중입니다." })).toHaveClass("skeleton-list");
    expect(api.getDmConversation).toHaveBeenCalledWith("brand-1", "conversation-1");
  });

  it("shows readiness, toggles automation, and links Wiki management to Brand Center", async () => {
    const api = await renderPage();

    expect(await screen.findByRole("heading", { name: "자동답변 설정" })).toBeVisible();
    expect(screen.getByText("FAQ 답변")).toBeVisible();
    expect(screen.getByText("LLM 답변")).toBeVisible();
    expect(await screen.findByText("자동답변 준비 완료")).toBeVisible();
    expect(screen.getByRole("link", { name: /FAQ 관리/ })).toHaveAttribute("href", "/brand-center?tab=faq");
    expect(screen.getByRole("link", { name: /LLM 답변 정보 관리/ })).toHaveAttribute("href", "/brand-center?tab=knowledge");
    expect(screen.getByRole("switch", { name: "LLM 답변" })).toBeDisabled();
    expect(screen.getByText("UI 미리보기입니다. LLM 설정은 저장되지 않습니다.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Wiki 다시 만들기" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("FAQ 파일")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("switch", { name: "DM 자동답변" }));
    expect(api.updateInstagramDmSettings).toHaveBeenCalledWith("brand-1", { enabled: true });
    expect(await screen.findByText("자동답변이 켜졌습니다.")).toBeVisible();
  });

  it("refreshes blocked activation and explains that the first Wiki is building", async () => {
    const buildingSettings = {
      ...dmSettings,
      enabled: false,
      wikiReady: false,
      wikiStatus: "building",
    };
    const getInstagramDmSettings = vi.fn()
      .mockResolvedValueOnce(dmSettings)
      .mockResolvedValueOnce(buildingSettings);
    const updateInstagramDmSettings = vi.fn(async () => {
      throw { errorCode: "dm_activation_blocked" };
    });
    const api = await renderPage({ getInstagramDmSettings, updateInstagramDmSettings });

    await screen.findByText("자동답변 준비 완료");
    await userEvent.click(screen.getByRole("switch", { name: "DM 자동답변" }));

    expect(api.updateInstagramDmSettings).toHaveBeenCalledWith("brand-1", { enabled: true });
    expect(getInstagramDmSettings).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(
      "첫 Wiki를 준비하고 있습니다. 기존 설정은 꺼진 상태이며 준비가 끝난 뒤 다시 활성화할 수 있습니다.",
    )).toBeVisible();
    expect(screen.getByRole("switch", { name: "DM 자동답변" })).not.toBeChecked();
  });

  it("allows an empty Wiki activation attempt to provision the first build while staying off", async () => {
    const emptySettings = {
      ...dmSettings,
      enabled: false,
      wikiReady: false,
      wikiStatus: "empty" as const,
    };
    const buildingSettings = {
      ...emptySettings,
      wikiStatus: "building" as const,
    };
    const getInstagramDmSettings = vi.fn()
      .mockResolvedValueOnce(emptySettings)
      .mockResolvedValueOnce(buildingSettings);
    const updateInstagramDmSettings = vi.fn(async () => {
      throw { errorCode: "dm_activation_blocked" };
    });
    const api = await renderPage({ getInstagramDmSettings, updateInstagramDmSettings });

    const activation = await screen.findByRole("switch", { name: "DM 자동답변" });
    expect(activation).toBeEnabled();
    await userEvent.click(activation);

    expect(api.updateInstagramDmSettings).toHaveBeenCalledWith("brand-1", { enabled: true });
    expect(getInstagramDmSettings).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(
      "첫 Wiki를 준비하고 있습니다. 기존 설정은 꺼진 상태이며 준비가 끝난 뒤 다시 활성화할 수 있습니다.",
    )).toBeVisible();
    expect(activation).not.toBeChecked();
  });

  it("blocks activation until readiness passes and provides concrete repair links", async () => {
    const updateInstagramDmSettings = vi.fn();
    await renderPage({
      getInstagramDmSettings: vi.fn(async () => ({
        ...dmSettings,
        wikiReady: false,
        messagePermissionReady: false,
        workerStatus: "worker_offline"
      })),
      updateInstagramDmSettings
    });

    expect(await screen.findByText("자동답변을 켤 수 없습니다")).toBeVisible();
    expect(screen.getByRole("switch", { name: "DM 자동답변" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Wiki 보완하기" })).toHaveAttribute("href", "/brand-center?tab=knowledge");
    expect(screen.getByRole("link", { name: "Instagram 연결 확인" })).toHaveAttribute("href", "/channels");
    expect(updateInstagramDmSettings).not.toHaveBeenCalled();
  });

  it("blocks activation when the webhook is not connected", async () => {
    const updateInstagramDmSettings = vi.fn();
    await renderPage({
      getInstagramDmSettings: vi.fn(async () => ({
        ...dmSettings,
        webhookStatus: "needs_attention" as const,
      })),
      updateInstagramDmSettings,
    });

    expect(await screen.findByText("자동답변을 켤 수 없습니다")).toBeVisible();
    expect(screen.getByRole("switch", { name: "DM 자동답변" })).toBeDisabled();
    expect(updateInstagramDmSettings).not.toHaveBeenCalled();
  });

  it("opens the selected conversation and shows direction and source metadata", async () => {
    const api = await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "홍길동 대화 열기" }));

    expect(api.getDmConversation).toHaveBeenCalledWith("brand-1", "conversation-1");
    expect(await screen.findByText("@customer → @브랜드")).toBeVisible();
    expect(screen.getByText("@브랜드 → @customer")).toBeVisible();
    expect(screen.getByText("근거: 고정 안내")).toBeVisible();
    expect(screen.getByText("발송 완료")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "수동 답변" })).toBeInTheDocument();
  });

  it("opens the exact Wiki issue deep link for a knowledge gap", async () => {
    const knowledgeGap = { ...attention, id: "11111111-1111-4111-8111-111111111111", type: "knowledge_gap" as const };
    await renderPage({
      getDmConversation: vi.fn(async () => ({ ...detail, attentionItems: [knowledgeGap] }))
    });
    await userEvent.click(await screen.findByRole("button", { name: "홍길동 대화 열기" }));

    expect((await screen.findAllByRole("link", { name: "Wiki에서 보완" })).find((link) => link.getAttribute("href")?.includes("issue="))).toHaveAttribute(
      "href",
      "/brand-center?tab=wiki&issue=11111111-1111-4111-8111-111111111111"
    );
  });

  it("removes the conversation attention filter from the UI and resolves attention in the thread", async () => {
    const api = await renderPage();
    expect(screen.queryByRole("tab", { name: "확인 필요" })).not.toBeInTheDocument();
    const filters = screen.getByRole("group", { name: "대화 필터" });
    expect(within(filters).queryByRole("button", { name: "확인 필요" })).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: "홍길동 대화 열기" }));
    await userEvent.click(await screen.findByRole("button", { name: "확인 완료" }));
    expect(api.resolveDmAttentionItem).toHaveBeenCalledWith("attention-1");
  });

  it("sends a manual reply once and reloads the conversation without resolving attention", async () => {
    let resolveSend: (() => void) | undefined;
    const sendManualDmReply = vi.fn(() => new Promise((resolve) => {
      resolveSend = () => resolve({ id: "message-manual" });
    }));
    const api = await renderPage({ sendManualDmReply });
    await userEvent.click(await screen.findByRole("button", { name: "홍길동 대화 열기" }));

    const input = await screen.findByRole("textbox", { name: "수동 답변" });
    const sendButton = screen.getByRole("button", { name: "수동 답변 전송" });
    expect(sendButton).toBeDisabled();
    await userEvent.type(input, "수동으로 안내드립니다.");
    await userEvent.click(sendButton);

    expect(sendButton).toBeDisabled();
    expect(sendButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("수동 답변 전송 중")).toBeVisible();
    expect(sendManualDmReply).toHaveBeenCalledTimes(1);
    expect(sendManualDmReply).toHaveBeenCalledWith("brand-1", "conversation-1", "수동으로 안내드립니다.", expect.any(String));
    resolveSend?.();
    expect(await screen.findByText("수동 답변을 전송했습니다.")).toBeVisible();
    expect(api.getDmConversation).toHaveBeenCalledTimes(2);
    expect(api.resolveDmAttentionItem).not.toHaveBeenCalled();
  });

  it.each([
    ["dm_manual_reply_channel_not_ready", null, "Instagram 채널 인증이 준비되지 않았습니다. 채널 연결 상태를 확인해 주세요."],
    ["meta_graph_401", "failed", "Instagram 연결 토큰이 만료되었거나 메시지 권한이 없습니다. 채널을 다시 연결해 주세요."],
    ["meta_graph_403", "failed", "Instagram 메시지 권한이 없거나 Meta가 이 답변 전송을 허용하지 않았습니다. Instagram 채널을 다시 연결한 뒤 다시 시도해 주세요."],
    ["meta_graph_400", "failed", "Instagram의 24시간 응답 가능 시간이 지났거나 수신자에게 메시지를 보낼 수 없습니다."],
    ["meta_graph_503", "unknown", "Meta 응답을 확인하지 못해 발송 여부가 불명확합니다. 중복 발송을 피하려면 Instagram에서 먼저 확인해 주세요."],
  ] as const)("shows a Korean manual reply error for %s", async (errorCode, deliveryStatus, expectedMessage) => {
    const error = Object.assign(new Error("manual reply failed"), { errorCode, deliveryStatus, requestId: "request-123" });
    await renderPage({ sendManualDmReply: vi.fn(async () => { throw error; }) });
    await userEvent.click(await screen.findByRole("button", { name: "홍길동 대화 열기" }));
    await userEvent.type(screen.getByRole("textbox", { name: "수동 답변" }), "직접 답변");
    await userEvent.click(screen.getByRole("button", { name: "수동 답변 전송" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(expectedMessage);
  });

  it("shows the request ID for an unknown manual reply error", async () => {
    const error = Object.assign(new Error("manual reply failed"), { errorCode: "unexpected_provider_error", requestId: "request-123" });
    await renderPage({ sendManualDmReply: vi.fn(async () => { throw error; }) });
    await userEvent.click(await screen.findByRole("button", { name: "홍길동 대화 열기" }));
    await userEvent.type(screen.getByRole("textbox", { name: "수동 답변" }), "직접 답변");
    await userEvent.click(screen.getByRole("button", { name: "수동 답변 전송" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("알 수 없는 오류");
    expect(screen.getByRole("alert")).toHaveTextContent("요청 ID: request-123");
  });

  it("retries a definitely failed delivered message but not an unknown delivery", async () => {
    const failed = { ...detail.messages[1], id: "message-failed", body: "실패한 답변", deliveryStatus: "failed" as const };
    const unknown = { ...detail.messages[1], id: "message-unknown", body: "확인 중 답변", deliveryStatus: "unknown" as const };
    const api = await renderPage({
      getDmConversation: vi.fn(async () => ({ ...detail, messages: [detail.messages[0], failed, unknown] }))
    });
    await userEvent.click(await screen.findByRole("button", { name: "홍길동 대화 열기" }));

    expect(await screen.findByText("발송 실패")).toBeVisible();
    expect(screen.getByText("발송 확인 필요")).toBeVisible();
    expect(screen.queryByRole("button", { name: "확인 중 답변 다시 보내기" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "실패한 답변 다시 보내기" }));
    expect(api.sendManualDmReply).toHaveBeenCalledWith("brand-1", "conversation-1", "실패한 답변", expect.any(String));
  });

  it("uses a fresh idempotency key when retrying a stored failure after a composer failure", async () => {
    const failed = { ...detail.messages[1], id: "message-failed", body: "과거 실패 답변", deliveryStatus: "failed" as const };
    const sendManualDmReply = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("failed"), { errorCode: "meta_graph_400" }))
      .mockResolvedValueOnce({ id: "message-retry" });
    await renderPage({
      getDmConversation: vi.fn(async () => ({ ...detail, messages: [detail.messages[0], failed] })),
      sendManualDmReply
    });
    await userEvent.click(await screen.findByRole("button", { name: "홍길동 대화 열기" }));
    await userEvent.type(screen.getByRole("textbox", { name: "수동 답변" }), "새 답변");
    await userEvent.click(screen.getByRole("button", { name: "수동 답변 전송" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "과거 실패 답변 다시 보내기" }));

    expect(sendManualDmReply).toHaveBeenCalledTimes(2);
    expect(sendManualDmReply.mock.calls[0][3]).not.toBe(sendManualDmReply.mock.calls[1][3]);
  });

  it("shows an API error without rendering sample conversations", async () => {
    await renderPage({ listDmConversations: vi.fn(async () => { throw new Error("api_down"); }) });
    expect(await screen.findByText("DM 대화 목록을 불러오지 못했습니다.")).toBeVisible();
    expect(screen.queryByText("홍길동")).not.toBeInTheDocument();
  });

  it("loads the next cursor page without replacing existing conversations", async () => {
    const nextConversation = {
      ...conversation,
      id: "conversation-2",
      participant: { ...conversation.participant, displayName: "김고객", username: "customer2" }
    };
    const listDmConversations = vi.fn(async (_brandId: string, options: { cursor?: string }) => options.cursor
      ? { items: [nextConversation], nextCursor: null }
      : { items: [conversation], nextCursor: "cursor-2" });
    await renderPage({ listDmConversations });

    await userEvent.click(await screen.findByRole("button", { name: "대화 더 보기" }));

    expect(await screen.findByRole("button", { name: "김고객 대화 열기" })).toBeVisible();
    expect(screen.getByRole("button", { name: "홍길동 대화 열기" })).toBeVisible();
    expect(listDmConversations).toHaveBeenLastCalledWith("brand-1", { filter: "all", cursor: "cursor-2" });
  });

  it("searches loaded conversations without breaking server filters and pagination", async () => {
    const nextConversation = {
      ...conversation,
      id: "conversation-2",
      participant: { ...conversation.participant, displayName: "김고객", username: "customer2" }
    };
    const listDmConversations = vi.fn(async (_brandId: string, options: { filter?: string; cursor?: string }) => options.cursor
      ? { items: [nextConversation], nextCursor: null }
      : { items: [conversation], nextCursor: "cursor-2" });
    await renderPage({ listDmConversations });

    await userEvent.type(await screen.findByRole("searchbox", { name: "대화 검색" }), "김고객");
    expect(screen.queryByRole("button", { name: "홍길동 대화 열기" })).not.toBeInTheDocument();
    expect(screen.getByText("검색 결과가 없습니다")).toBeVisible();
    await userEvent.clear(screen.getByRole("searchbox", { name: "대화 검색" }));
    await userEvent.click(screen.getByRole("button", { name: "대화 더 보기" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "대화 검색" }), "김고객");
    expect(await screen.findByRole("button", { name: "김고객 대화 열기" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "불만" }));
    expect(listDmConversations).toHaveBeenLastCalledWith("brand-1", { filter: "complaint", cursor: undefined });
  });

  it("ignores a stale conversation list response that resolves after a newer filter", async () => {
    let resolveAll: ((value: { items: DmConversationSummary[]; nextCursor: null }) => void) | undefined;
    const complaintConversation = {
      ...conversation,
      id: "complaint-2",
      participant: { ...conversation.participant, displayName: "최신 고객" }
    };
    const listDmConversations = vi.fn((_brandId: string, options: { filter?: string }) => options.filter === "complaint"
      ? Promise.resolve({ items: [complaintConversation], nextCursor: null })
      : new Promise<{ items: DmConversationSummary[]; nextCursor: null }>((resolve) => { resolveAll = resolve; }));
    await renderPage({ listDmConversations });

    await userEvent.click(screen.getByRole("button", { name: "불만" }));
    expect(await screen.findByRole("button", { name: "최신 고객 대화 열기" })).toBeVisible();
    await act(async () => resolveAll?.({ items: [conversation], nextCursor: null }));
    expect(screen.queryByRole("button", { name: "홍길동 대화 열기" })).not.toBeInTheDocument();
  });

  it("keeps stale conversations visible with a retryable warning when refresh fails", async () => {
    let calls = 0;
    await renderPage({
      listDmConversations: vi.fn(async () => {
        calls += 1;
        if (calls === 1) return { items: [conversation], nextCursor: null };
        throw new Error("offline");
      })
    });
    expect(await screen.findByRole("button", { name: "홍길동 대화 열기" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "대화 새로고침" }));

    expect(await screen.findByText(/기존 대화를 표시하고 있습니다/)).toBeVisible();
    expect(screen.getByRole("button", { name: "홍길동 대화 열기" })).toBeVisible();
  });
});
