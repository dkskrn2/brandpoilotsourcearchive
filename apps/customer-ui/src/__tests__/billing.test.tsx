import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

async function renderBillingPage() {
  const api = {
    getBillingSummary: vi.fn(async () => ({
      configured: false,
      subscription: {
        status: "none",
        planName: null,
        monthlyAmount: null,
        currency: "KRW",
        currentPeriodEnd: null,
        nextBillingAt: null,
        cancelAtPeriodEnd: false,
        suspensionReason: null
      },
      entitlement: { active: false, source: null, expiresAt: null },
      paymentMethod: null,
      payments: []
    }))
  };
  vi.doMock("../lib/apiClient", () => ({ DEMO_BRAND_ID: "brand-1", api }));

  const { BillingPage } = await import("../pages/BillingPage");
  render(<BillingPage />);
  return api;
}

describe("BillingPage", () => {
  it("shows the billing sections without collecting raw card details before Toss is connected", async () => {
    const api = await renderBillingPage();

    expect(await screen.findByRole("heading", { name: "결제 및 구독" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "청구" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "청구 내역" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "결제 정보" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "결제 방법" })).toBeVisible();
    expect(screen.getByText("등록된 결제수단이 없습니다.")).toBeVisible();
    expect(screen.getByText("토스페이먼츠 연동 후 사용할 수 있습니다.")).toBeVisible();
    expect(screen.getByRole("button", { name: "구독 시작" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "편집" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "새로 추가" })).toBeDisabled();
    expect(screen.queryByLabelText(/카드번호|유효기간|CVC|카드 비밀번호/)).not.toBeInTheDocument();
    expect(api.getBillingSummary).toHaveBeenCalledWith("brand-1");
  });
});
