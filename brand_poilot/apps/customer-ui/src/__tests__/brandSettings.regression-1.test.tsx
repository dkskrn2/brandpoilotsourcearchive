import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("BrandSettingsPage regression", () => {
  it("uses service description instead of default CTA as a required brand input", async () => {
    vi.doMock("../lib/apiClient", () => ({
      DEMO_BRAND_ID: "brand-1",
      api: {
        getBrandProfile: vi.fn(async () => ({
          name: "브랜드",
          primaryCategory: { code: "travel", name: "여행·관광" },
          subcategories: [],
          primaryCustomer: "가족 여행자",
          description: "가족 여행 일정을 상담합니다.",
          tone: "친절한 전문가",
          defaultCta: "",
          mainLink: "",
          autoApprovalEnabled: false
        })),
        updateBrandProfile: vi.fn(),
        listSources: vi.fn(async () => [])
      }
    }));
    const { BrandSettingsPage } = await import("../pages/BrandSettingsPage");
    render(<BrandSettingsPage />);

    expect(await screen.findByText("필수 입력 완료")).toBeVisible();
  });

  it("does not show a success validation message when a required profile field is empty", async () => {
    vi.doMock("../lib/apiClient", () => ({
      DEMO_BRAND_ID: "brand-1",
      api: {
        getBrandProfile: vi.fn(async () => ({
          name: "브랜드",
          primaryCategory: { code: "travel", name: "여행·관광" },
          subcategories: [],
          primaryCustomer: "가족 여행자",
          description: "",
          tone: "친절한 전문가",
          defaultCta: "",
          mainLink: "",
          autoApprovalEnabled: false
        })),
        updateBrandProfile: vi.fn(),
        listSources: vi.fn(async () => [])
      }
    }));
    const { BrandSettingsPage } = await import("../pages/BrandSettingsPage");
    render(<BrandSettingsPage />);

    expect(await screen.findByText("필수 입력 필요")).toBeVisible();
    expect(screen.queryByText("필수 입력 완료")).not.toBeInTheDocument();
  });
});
