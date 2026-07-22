import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackProvider, useFeedback } from "../components/feedback/FeedbackContext";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

async function renderSupportPage(
  apiOverrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {},
  initialEntries = ["/support"],
  openFeedback = vi.fn()
) {
  const answeredRequest = {
    id: "support-answered",
    brandId: "brand-1",
    workspaceId: "workspace-1",
    category: "feature",
    title: "문의 내역 확인",
    message: "답변은 어디에서 확인하나요?",
    contactPhone: "010-1234-5678",
    contactEmail: null,
    status: "resolved",
    responseMessage: "고객센터의 문의 내역에서 확인할 수 있습니다.",
    respondedAt: "2026-07-12T01:00:00.000Z",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T01:00:00.000Z"
  };
  const api = {
    listSupportRequests: vi.fn(async () => [answeredRequest]),
    createSupportRequest: vi.fn(async () => ({
      id: "support-1",
      brandId: "brand-1",
      workspaceId: "workspace-1",
      category: "bug",
      title: "채널 연결 오류",
      message: "인스타 연결이 실패합니다.",
      contactPhone: "010-1234-5678",
      contactEmail: "user@example.com",
      status: "new",
      responseMessage: null,
      respondedAt: null,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z"
    })),
    ...apiOverrides
  };
  vi.doMock("../lib/apiClient", () => ({
    DEMO_BRAND_ID: "brand-1",
    api
  }));
  vi.doMock("../components/feedback/FeedbackContext", () => ({ FeedbackProvider, useFeedback }));
  const { SupportPage } = await import("../pages/SupportPage");
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <FeedbackProvider onOpenFeedback={openFeedback}>
        <SupportPage />
      </FeedbackProvider>
    </MemoryRouter>
  );
  return api;
}

describe("SupportPage", () => {
  it("keeps feature suggestions out of customer support", async () => {
    await renderSupportPage({}, ["/support?category=feature#support-request-form"]);
    expect(screen.getByLabelText(/문의 유형/)).not.toHaveDisplayValue("기능 건의");
    expect(screen.queryByRole("option", { name: "기능 건의" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /문의 내역 확인/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: "새로고침" })).not.toBeInTheDocument();
  });

  it("opens the feature feedback dialog from the customer center footer", async () => {
    const openFeedback = vi.fn();
    await renderSupportPage({}, ["/support"], openFeedback);

    await userEvent.click(screen.getByRole("button", { name: "기능 제안하기" }));

    expect(openFeedback).toHaveBeenCalledTimes(1);
  });

  it("shows a list skeleton while support history is loading", async () => {
    const pending = new Promise<never>(() => undefined);
    await renderSupportPage({ listSupportRequests: vi.fn(() => pending) });

    expect(screen.getByRole("status", { name: "문의 내역을 불러오는 중입니다." })).toHaveClass("skeleton-list");
    expect(screen.getByRole("heading", { name: "문의 작성" })).toBeVisible();
  });

  it("requires category, title, phone, and message before submitting", async () => {
    const api = await renderSupportPage();

    await userEvent.click(screen.getByRole("button", { name: "문의 접수" }));

    expect(await screen.findByText("문의 유형, 제목, 휴대전화 번호, 내용을 입력하세요.")).toBeVisible();
    expect(api.createSupportRequest).not.toHaveBeenCalled();
  });

  it("rejects an invalid Korean mobile phone number before submitting", async () => {
    const api = await renderSupportPage();

    await userEvent.selectOptions(screen.getByLabelText(/문의 유형/), "bug");
    await userEvent.type(screen.getByLabelText(/제목/), "채널 연결 오류");
    await userEvent.type(screen.getByLabelText(/휴대전화 번호/), "02-1234-5678");
    await userEvent.type(screen.getByLabelText(/내용/), "인스타 연결이 실패합니다.");
    await userEvent.click(screen.getByRole("button", { name: "문의 접수" }));

    expect(await screen.findByText("휴대전화 번호를 010-1234-5678 형식으로 입력하세요.")).toBeVisible();
    expect(api.createSupportRequest).not.toHaveBeenCalled();
  });

  it("submits a support request and shows received state", async () => {
    const api = await renderSupportPage();

    await userEvent.selectOptions(screen.getByLabelText(/문의 유형/), "bug");
    await userEvent.type(screen.getByLabelText(/제목/), "채널 연결 오류");
    await userEvent.type(screen.getByLabelText(/휴대전화 번호/), "01012345678");
    await userEvent.type(screen.getByLabelText(/내용/), "인스타 연결이 실패합니다.");
    await userEvent.type(screen.getByLabelText("연락 이메일"), "user@example.com");
    await userEvent.click(screen.getByRole("button", { name: "문의 접수" }));

    expect(await screen.findByText("접수됨")).toBeVisible();
    expect(api.createSupportRequest).toHaveBeenCalledWith("brand-1", {
      category: "bug",
      title: "채널 연결 오류",
      message: "인스타 연결이 실패합니다.",
      contactPhone: "010-1234-5678",
      contactEmail: "user@example.com"
    });
    expect(api.listSupportRequests).toHaveBeenCalledTimes(2);
  });

  it("keeps the newest inquiry history when an older request resolves last", async () => {
    let resolveInitialRequest!: (requests: Array<Record<string, unknown>>) => void;
    const initialRequest = new Promise<Array<Record<string, unknown>>>((resolve) => {
      resolveInitialRequest = resolve;
    });
    const freshRequest = {
      id: "support-fresh",
      brandId: "brand-1",
      workspaceId: "workspace-1",
      category: "bug",
      title: "새로 접수된 고유 문의",
      message: "새 문의 내용입니다.",
      contactPhone: "010-1234-5678",
      contactEmail: null,
      status: "new",
      responseMessage: null,
      respondedAt: null,
      createdAt: "2026-07-22T02:00:00.000Z",
      updatedAt: "2026-07-22T02:00:00.000Z"
    };
    const staleRequest = {
      ...freshRequest,
      id: "support-stale",
      title: "이전 문의 내역",
      createdAt: "2026-07-21T02:00:00.000Z",
      updatedAt: "2026-07-21T02:00:00.000Z"
    };
    const listSupportRequests = vi.fn()
      .mockImplementationOnce(() => initialRequest)
      .mockResolvedValueOnce([freshRequest]);
    await renderSupportPage({ listSupportRequests });

    expect(listSupportRequests).toHaveBeenCalledTimes(1);
    await userEvent.selectOptions(screen.getByLabelText(/문의 유형/), "bug");
    await userEvent.type(screen.getByLabelText(/제목/), "채널 연결 오류");
    await userEvent.type(screen.getByLabelText(/휴대전화 번호/), "01012345678");
    await userEvent.type(screen.getByLabelText(/내용/), "인스타 연결이 실패합니다.");
    await userEvent.click(screen.getByRole("button", { name: "문의 접수" }));

    expect(await screen.findByRole("button", { name: /새로 접수된 고유 문의/ })).toBeVisible();
    expect(listSupportRequests).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveInitialRequest([staleRequest]);
      await initialRequest;
    });

    expect(screen.getByRole("button", { name: /새로 접수된 고유 문의/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /이전 문의 내역/ })).not.toBeInTheDocument();
  });

  it("shows submitted inquiries and their answers", async () => {
    await renderSupportPage();

    expect(await screen.findByRole("heading", { name: "내 문의 내역" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /문의 내역 확인/ }));

    expect(screen.getByText("답변은 어디에서 확인하나요?")).toBeVisible();
    expect(screen.getByText("고객센터의 문의 내역에서 확인할 수 있습니다.")).toBeVisible();
  });
});
