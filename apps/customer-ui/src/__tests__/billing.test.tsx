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
  it("shows a safe unconfigured state before a monthly plan is activated", async () => {
    const api = await renderBillingPage();

    expect(await screen.findByRole("heading", { name: "결제 및 구독" })).toBeVisible();
    expect(screen.getByText("결제 설정 준비 중")).toBeVisible();
    expect(screen.getByText("구독을 시작하면 콘텐츠 자동화 기능을 사용할 수 있습니다.")).toBeVisible();
    expect(api.getBillingSummary).toHaveBeenCalledWith("brand-1");
  });
});
