import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const supportRequest = {
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
};

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

async function renderAdminChannelsPage(apiOverrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  const api = {
    listSupportRequests: vi.fn(async () => [supportRequest]),
    updateSupportRequestStatus: vi.fn(async (_requestId: string, status: string) => ({
      ...supportRequest,
      status,
      updatedAt: "2026-07-11T00:05:00.000Z"
    })),
    ...apiOverrides
  };
  vi.doMock("../lib/apiClient", () => ({
    DEMO_BRAND_ID: "brand-1",
    api
  }));
  const { AdminChannelsPage } = await import("../pages/AdminChannelsPage");
  render(<AdminChannelsPage />);
  return api;
}

describe("AdminChannelsPage", () => {
  it("does not expose removed channel credential forms", async () => {
    await renderAdminChannelsPage();

    expect(await screen.findByRole("heading", { name: "관리자 채널" })).toBeVisible();
    expect(screen.queryByLabelText("Webflow API Token")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Webflow 매핑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저장값 연결 확인" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Meta OAuth/ })).not.toBeInTheDocument();
  });

  it("shows support requests and updates their status from the admin channel page", async () => {
    const api = await renderAdminChannelsPage();

    expect(await screen.findByText("채널 연결 오류")).toBeVisible();
    expect(screen.getByText("인스타 연결이 실패합니다.")).toBeVisible();
    expect(screen.getByText("user@example.com")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "처리중" }));
    expect(api.updateSupportRequestStatus).toHaveBeenCalledWith("support-1", "in_progress");

    await userEvent.click(screen.getByRole("button", { name: "완료" }));
    expect(api.updateSupportRequestStatus).toHaveBeenCalledWith("support-1", "resolved");
  });
});
