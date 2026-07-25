import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DmAttentionItem, DmConversationDetail, DmConversationSummary, WikiStatus } from "../types";

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
  it("shows skeletons while conversations, messages, and Wiki data are pending", async () => {
    let resolveConversations: ((value: { items: DmConversationSummary[]; nextCursor: null }) => void) | undefined;
    const api = await renderPage({
      listDmConversations: vi.fn(() => new Promise((resolve) => { resolveConversations = resolve; })),
      getDmConversation: vi.fn(() => new Promise(() => {})),
      listKnowledgeImports: vi.fn(() => new Promise(() => {})),
      getWikiStatus: vi.fn(() => new Promise(() => {}))
    });

    expect(screen.getByRole("status", { name: "대화 목록을 불러오는 중입니다." })).toHaveClass("skeleton-list");
    resolveConversations?.({ items: [conversation], nextCursor: null });
    await userEvent.click(await screen.findByRole("button", { name: "홍길동 대화 열기" }));
    expect(screen.getByRole("status", { name: "대화 내용을 불러오는 중입니다." })).toHaveClass("skeleton-list");

    await userEvent.click(screen.getByRole("tab", { name: "자사 정보" }));
    expect(screen.getByRole("status", { name: "Wiki 상태를 불러오는 중입니다." })).toHaveClass("skeleton-list");
    expect(api.getDmConversation).toHaveBeenCalledWith("brand-1", "conversation-1");
  });

  it("opens the selected conversation and shows direction and source metadata", async () => {
    const api = await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "홍길동 대화 열기" }));

    expect(api.getDmConversation).toHaveBeenCalledWith("brand-1", "conversation-1");
    expect(await screen.findByText("@customer → @브랜드")).toBeVisible();
    expect(screen.getByText("@브랜드 → @customer")).toBeVisible();
    expect(screen.getByText("근거: 고정 안내")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "수동 답변" })).toBeInTheDocument();
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
    expect(sendManualDmReply).toHaveBeenCalledWith("brand-1", "conversation-1", "수동으로 안내드립니다.");
    resolveSend?.();
    expect(await screen.findByText("수동 답변을 전송했습니다.")).toBeVisible();
    expect(api.getDmConversation).toHaveBeenCalledTimes(2);
    expect(api.resolveDmAttentionItem).not.toHaveBeenCalled();
  });

  it.each([
    ["dm_manual_reply_channel_not_ready", null, "Instagram 채널 인증이 준비되지 않았습니다. 채널 연결 상태를 확인해 주세요."],
    ["meta_graph_401", "failed", "Instagram 연결 토큰이 만료되었거나 메시지 권한이 없습니다. 채널을 다시 연결해 주세요."],
    ["meta_graph_403", "failed", "Instagram의 24시간 응답 시간이 지났거나 Meta 앱에 Human Agent 권한이 없습니다. Human Agent 권한을 승인한 뒤 다시 시도해 주세요."],
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

  it("keeps the active Wiki visible after a failed build and distinguishes upload types", async () => {
    const api = await renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "자사 정보" }));

    expect(await screen.findByText("버전 2")).toBeVisible();
    expect(screen.getByText(/최근 Wiki 빌드 실패/)).toBeVisible();
    const productFile = new File(["name,description\n상품,설명"], "products.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText("제품 파일"), productFile);
    expect(api.importKnowledge).toHaveBeenCalledWith("brand-1", expect.objectContaining({ entryType: "product", fileName: "products.csv" }));
    expect(screen.getByRole("link", { name: "FAQ 템플릿" })).toHaveAttribute("href", "/faq-template.csv");
  });

  it("shows an inline loader while a Wiki rebuild is pending", async () => {
    const refreshWiki = vi.fn(() => new Promise(() => {}));
    await renderPage({ refreshWiki });
    await userEvent.click(screen.getByRole("tab", { name: "자사 정보" }));
    const rebuildButton = screen.getByRole("button", { name: "Wiki 다시 만들기" });
    await userEvent.click(rebuildButton);

    expect(rebuildButton).toBeDisabled();
    expect(rebuildButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Wiki 재생성 요청 중")).toBeVisible();
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
});
