import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

async function renderSupportPage(apiOverrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  const api = {
    createSupportRequest: vi.fn(async () => ({
      id: "support-1",
      brandId: "brand-1",
      workspaceId: "workspace-1",
      category: "bug",
      title: "채널 연결 오류",
      message: "인스타 연결이 실패합니다.",
      contactEmail: "user@example.com",
      status: "new",
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z"
    })),
    ...apiOverrides
  };
  vi.doMock("../lib/apiClient", () => ({
    DEMO_BRAND_ID: "brand-1",
    api
  }));
  const { SupportPage } = await import("../pages/SupportPage");
  render(<SupportPage />);
  return api;
}

describe("SupportPage", () => {
  it("requires category, title, and message before submitting", async () => {
    const api = await renderSupportPage();

    await userEvent.click(screen.getByRole("button", { name: "문의 접수" }));

    expect(await screen.findByText("문의 유형, 제목, 내용을 입력하세요.")).toBeVisible();
    expect(api.createSupportRequest).not.toHaveBeenCalled();
  });

  it("submits a support request and shows received state", async () => {
    const api = await renderSupportPage();

    await userEvent.selectOptions(screen.getByLabelText(/문의 유형/), "bug");
    await userEvent.type(screen.getByLabelText(/제목/), "채널 연결 오류");
    await userEvent.type(screen.getByLabelText(/내용/), "인스타 연결이 실패합니다.");
    await userEvent.type(screen.getByLabelText("연락 이메일"), "user@example.com");
    await userEvent.click(screen.getByRole("button", { name: "문의 접수" }));

    expect(await screen.findByText("접수됨")).toBeVisible();
    expect(api.createSupportRequest).toHaveBeenCalledWith("brand-1", {
      category: "bug",
      title: "채널 연결 오류",
      message: "인스타 연결이 실패합니다.",
      contactEmail: "user@example.com"
    });
  });
});
