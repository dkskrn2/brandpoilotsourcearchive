import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  billingComparisonGroups,
  billingFaqs,
  billingPlans,
} from "../features/billing/billingPricingContent";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

async function renderBillingPage(getBillingSummary = vi.fn(async () => ({
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
}))) {
  const api = {
    getBillingSummary
  };
  vi.doMock("../lib/apiClient", () => ({ DEMO_BRAND_ID: "brand-1", api }));

  const { BillingPage } = await import("../pages/BillingPage");
  render(<MemoryRouter><BillingPage /></MemoryRouter>);
  return api;
}

describe("BillingPage", () => {
  it("shows a page skeleton while billing data is pending", async () => {
    await renderBillingPage(vi.fn(() => new Promise(() => {})));

    expect(await screen.findByRole("heading", {
      level: 1,
      name: "운영 범위에 맞는 플랜을 선택하세요.",
    })).toBeVisible();
    expect(screen.getByText("추천 플랜")).toBeVisible();
    expect(screen.getByRole("heading", { name: "플랜별 운영 범위" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "자주 묻는 질문" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "맞춤 운영" })).toBeVisible();
    for (const name of [
      "운영 시작 상담",
      "팀 운영 상담",
      "확장 운영 상담",
      "맞춤 운영 상담",
      "운영 범위 상담",
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", "/support");
    }
    expect(screen.getByRole("status", { name: "결제 정보를 불러오는 중입니다." })).toHaveClass("skeleton-page");
  });

  it("keeps pricing visible when the billing summary fails", async () => {
    await renderBillingPage(vi.fn(async () => {
      throw new Error("failed");
    }));

    expect(await screen.findByRole("heading", {
      name: "운영 범위에 맞는 플랜을 선택하세요.",
    })).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "결제 정보를 불러오지 못했습니다.",
    );
  });

  it("shows the billing sections without collecting raw card details before Toss is connected", async () => {
    const api = await renderBillingPage();

    expect(await screen.findByRole("heading", { name: "결제 및 구독" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "청구" })).toBeVisible();
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

describe("billing pricing canonical content", () => {
  it("preserves plans, comparison rows, and FAQ parity", () => {
    expect(billingPlans.map((plan) => plan.name)).toEqual([
      "운영 시작", "팀 운영", "확장 운영",
    ]);
    expect(billingPlans.find((plan) => plan.name === "팀 운영")?.recommended)
      .toBe(true);
    expect(billingComparisonGroups.map((group) => group.label)).toEqual([
      "기본 운영", "검토와 발행", "확장 범위",
    ]);
    expect(billingComparisonGroups.flatMap((group) => group.rows)).toHaveLength(9);
    expect(billingFaqs).toHaveLength(5);
  });
});
