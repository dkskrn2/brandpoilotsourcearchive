import { describe, expect, it } from "vitest";
import {
  customerNavigation,
  onboardingNavigationItem,
  resolveCustomerPageTitle
} from "./navigationModel";

describe("D hybrid customer navigation model", () => {
  it("groups only implemented Release A destinations", () => {
    expect(customerNavigation.map((group) => group.label)).toEqual([
      "개요",
      "브랜드",
      "콘텐츠",
      "채널·고객",
      "설정·지원"
    ]);

    const paths = customerNavigation.flatMap((group) => group.items.map((item) => item.path));
    expect(paths).toEqual([
      "/dashboard",
      "/performance",
      "/brand-center",
      "/references",
      "/ai-content",
      "/publish-queue",
      "/channels",
      "/dm-automation",
      "/billing"
    ]);
    expect(paths).toContain("/brand-center");
    expect(paths).toContain("/references");
    expect(paths).toContain("/performance");
    expect(paths).not.toContain("/ai-content/library");
    expect(
      customerNavigation.flatMap((group) => group.items)
        .find((item) => item.label === "결제 및 구독"),
    ).toMatchObject({ path: "/billing", label: "결제 및 구독" });
  });

  it("keeps the incomplete-brand recovery destination separate", () => {
    expect(onboardingNavigationItem).toMatchObject({
      label: "브랜드 분석",
      path: "/onboarding/brand-intelligence"
    });
    expect(resolveCustomerPageTitle("/onboarding/brand-intelligence")).toBe("브랜드 분석");
  });

  it("resolves dynamic content titles without treating unknown paths as dashboard", () => {
    expect(resolveCustomerPageTitle("/ai-content/generation-1")).toBe("콘텐츠 결과");
    expect(resolveCustomerPageTitle("/publish-queue?status=failed")).toBe("게시 관리");
    expect(resolveCustomerPageTitle("/not-a-real-page")).toBeNull();
  });
});
