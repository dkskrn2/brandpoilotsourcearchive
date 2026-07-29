import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUPPORT_REQUESTS_CHANGED_EVENT } from "../../lib/apiClient";
import type { SupportRequest } from "../../types";
import { SupportRequestHistory } from "./SupportRequestHistory";

afterEach(cleanup);

const resolvedRequest: SupportRequest = {
  id: "support-1",
  brandId: "brand-1",
  workspaceId: "workspace-1",
  category: "feature",
  title: "기능 요청",
  message: "비교 기준을 추가해 주세요.",
  contactPhone: "010-1234-5678",
  contactEmail: "hidden@example.com",
  status: "resolved",
  responseMessage: "다음 배포에 반영하겠습니다.",
  respondedAt: "2026-07-30T02:00:00.000Z",
  createdAt: "2026-07-30T01:00:00.000Z",
  updatedAt: "2026-07-30T02:00:00.000Z"
};

describe("SupportRequestHistory", () => {
  it("shows loading and empty states", async () => {
    let resolveRequests!: (requests: SupportRequest[]) => void;
    const listRequests = vi.fn(() => new Promise<SupportRequest[]>((resolve) => {
      resolveRequests = resolve;
    }));
    render(<SupportRequestHistory brandId="brand-1" listRequests={listRequests} />);

    expect(screen.getByRole("region", { name: "문의 내역" })).toBeVisible();
    expect(screen.getByRole("status", { name: "문의 내역을 불러오는 중입니다." })).toBeVisible();

    await act(async () => resolveRequests([]));
    expect(await screen.findByText("접수한 문의가 없습니다.")).toBeVisible();
  });

  it("retries an initial load failure without blocking the section", async () => {
    const listRequests = vi.fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce([]);
    render(<SupportRequestHistory brandId="brand-1" listRequests={listRequests} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("문의 내역을 불러오지 못했습니다.");
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByText("접수한 문의가 없습니다.")).toBeVisible();
    expect(listRequests).toHaveBeenCalledTimes(2);
  });

  it("shows inquiry details and the operator response without contact fields", async () => {
    render(
      <SupportRequestHistory
        brandId="brand-1"
        listRequests={vi.fn(async () => [resolvedRequest])}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: /기능 요청/ }));

    expect(screen.getByText("문의 내용")).toBeVisible();
    expect(screen.getByText("비교 기준을 추가해 주세요.")).toBeVisible();
    expect(screen.getByText("운영자 답변")).toBeVisible();
    expect(screen.getByText("다음 배포에 반영하겠습니다.")).toBeVisible();
    expect(screen.queryByText(/010-1234-5678|hidden@example.com/)).not.toBeInTheDocument();
  });

  it("keeps the current list and warns inline when an event refresh fails", async () => {
    const listRequests = vi.fn()
      .mockResolvedValueOnce([resolvedRequest])
      .mockRejectedValueOnce(new Error("refresh failure"));
    render(<SupportRequestHistory brandId="brand-1" listRequests={listRequests} />);
    expect(await screen.findByRole("button", { name: /기능 요청/ })).toBeVisible();

    act(() => {
      window.dispatchEvent(new Event(SUPPORT_REQUESTS_CHANGED_EVENT));
    });

    await waitFor(() => expect(listRequests).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("status")).toHaveTextContent("최신 문의 내역을 불러오지 못했습니다.");
    expect(screen.getByRole("button", { name: /기능 요청/ })).toBeVisible();
  });

  it("clears the prior brand list when the next brand load fails", async () => {
    let rejectNextBrand!: (error: Error) => void;
    const listRequests = vi.fn((brandId: string) => {
      if (brandId === "brand-1") return Promise.resolve([resolvedRequest]);
      return new Promise<SupportRequest[]>((_, reject) => {
        rejectNextBrand = reject;
      });
    });
    const { rerender } = render(
      <SupportRequestHistory brandId="brand-1" listRequests={listRequests} />,
    );
    expect(await screen.findByRole("button", { name: /기능 요청/ })).toBeVisible();

    rerender(<SupportRequestHistory brandId="brand-2" listRequests={listRequests} />);

    expect(screen.queryByRole("button", { name: /기능 요청/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "문의 내역을 불러오는 중입니다." })).toBeVisible();

    await act(async () => rejectNextBrand(new Error("brand-2 failure")));

    expect(await screen.findByRole("alert")).toHaveTextContent("문의 내역을 불러오지 못했습니다.");
    expect(screen.queryByRole("button", { name: /기능 요청/ })).not.toBeInTheDocument();
    expect(screen.queryByText("최신 문의 내역을 불러오지 못했습니다.")).not.toBeInTheDocument();
  });
});
