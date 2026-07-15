import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrandProfile, ContentCategory, InstagramFormatSettings } from "../types";

const apiProfile: BrandProfile = {
  id: "profile-1",
  brandId: "brand-1",
  name: "API 브랜드",
  primaryCategory: { code: "travel", name: "여행·관광" },
  subcategories: [{ type: "system", code: "domestic", name: "국내 여행" }, { type: "custom", code: null, name: "가족 여행" }],
  primaryCustomer: "처음 여행을 준비하는 고객",
  description: "API에서 내려온 브랜드 설명",
  tone: "담백한 전문가 톤",
  defaultCta: "상담 예약하기",
  mainLink: "https://example.com",
  autoApprovalEnabled: true,
  logoUrl: "https://cdn.example.com/logo.png"
};

const apiCategories: ContentCategory[] = [
  {
    code: "travel",
    name: "여행·관광",
    recommendedHashtags: [],
    subcategories: [
      { code: "domestic", name: "국내 여행" },
      { code: "outbound", name: "해외 여행" }
    ]
  },
  {
    code: "food",
    name: "음식·외식",
    recommendedHashtags: [],
    subcategories: [{ code: "restaurant", name: "레스토랑" }]
  }
];

const apiInstagramFormats: InstagramFormatSettings = {
  brandId: "brand-1",
  brandColor: "청록색",
  formats: [
    {
      format: "instagram_reel",
      enabled: false,
      rotationOrder: 3,
      capabilityStatus: "available",
      capabilityCheckedAt: "2026-07-13T01:00:00.000Z",
      capabilityMetadata: {},
      lastError: null
    },
    {
      format: "instagram_story",
      enabled: false,
      rotationOrder: 2,
      capabilityStatus: "unavailable",
      capabilityCheckedAt: "2026-07-13T01:00:00.000Z",
      capabilityMetadata: {},
      lastError: "story_publish_unavailable"
    },
    {
      format: "instagram_feed_carousel",
      enabled: true,
      rotationOrder: 1,
      capabilityStatus: "available",
      capabilityCheckedAt: "2026-07-13T01:00:00.000Z",
      capabilityMetadata: {},
      lastError: null
    }
  ]
};

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

async function renderBrandSettingsPage(apiOverrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  const api = {
    getBrandProfile: vi.fn(async () => apiProfile),
    updateBrandProfile: vi.fn(async (_brandId: string, profile: BrandProfile) => ({ ...apiProfile, ...profile })),
    listContentCategories: vi.fn(async () => apiCategories),
    getInstagramFormats: vi.fn(async () => apiInstagramFormats),
    updateInstagramFormats: vi.fn(async (_brandId: string, settings: InstagramFormatSettings) => ({
      ...apiInstagramFormats,
      brandColor: settings.brandColor,
      formats: apiInstagramFormats.formats.map((format) => ({
        ...format,
        enabled: settings.formats.find((candidate) => candidate.format === format.format)?.enabled ?? format.enabled
      }))
    })),
    uploadBrandLogo: vi.fn(async () => ({ ...apiProfile, logoUrl: "https://cdn.example.com/new-logo.png" })),
    deleteBrandLogo: vi.fn(async () => ({ ...apiProfile, logoUrl: null })),
    ...apiOverrides
  };
  vi.doMock("../lib/apiClient", () => ({
    DEMO_BRAND_ID: "brand-1",
    api
  }));
  const { BrandSettingsPage } = await import("../pages/BrandSettingsPage");
  render(<BrandSettingsPage />);
  return api;
}

describe("BrandSettingsPage", () => {
  it("loads brand profile from the API instead of sample data", async () => {
    await renderBrandSettingsPage();

    expect(await screen.findByDisplayValue("API 브랜드")).toBeVisible();
    expect(screen.getByLabelText("대표 분야 선택")).toHaveValue("travel");
    expect(screen.getByLabelText("핵심 고객 직접 입력")).toHaveValue("처음 여행을 준비하는 고객");
    expect(screen.queryByDisplayValue("제주 여행 상담 브랜드")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "브랜드 전체 자동 승인" })).toBeChecked();
    expect(screen.queryByText("채널별 자동 승인")).not.toBeInTheDocument();
  });

  it("loads categories independently and shows only the selected category subcategories", async () => {
    await renderBrandSettingsPage();

    const categorySelect = await screen.findByLabelText("대표 분야 선택");
    expect(categorySelect.tagName).toBe("SELECT");
    expect(within(screen.getByLabelText("세부 분야").querySelector(".subcategory-grid") as HTMLElement).getByText("국내 여행")).toBeInTheDocument();
    expect(screen.queryByText("레스토랑")).not.toBeInTheDocument();
    expect(screen.getByLabelText("핵심 고객 선택")).toBeInTheDocument();
    expect(screen.getByLabelText("핵심 고객 직접 입력")).toHaveAttribute("maxlength", "30");
  });

  it("provides contextual examples for brand profile fields", async () => {
    await renderBrandSettingsPage();

    expect(await screen.findByPlaceholderText("예: 제주의 하루 여행 상담")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("예: 제주 일정과 숙소 동선을 1:1로 상담해주는 여행 계획 서비스")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("예: 친절하고 과장 없는 전문가 톤")).toBeInTheDocument();
  });

  it("saves one brand color and global instagram format switches in fixed rotation order", async () => {
    const api = await renderBrandSettingsPage();

    const brandColor = await screen.findByLabelText("브랜드 주색");
    await userEvent.clear(brandColor);
    await userEvent.type(brandColor, "파란색");
    await userEvent.click(screen.getByRole("switch", { name: "Reel" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(api.updateInstagramFormats).toHaveBeenCalledWith("brand-1", {
      brandColor: "파란색",
      formats: [
        { format: "instagram_feed_carousel", enabled: true },
        { format: "instagram_story", enabled: false },
        { format: "instagram_reel", enabled: true }
      ]
    });
    expect(screen.getByText(/Card News → Story → Reel/)).toBeVisible();
  });

  it("shows why Story cannot be enabled", async () => {
    await renderBrandSettingsPage();

    expect(await screen.findByRole("switch", { name: "Story" })).toBeDisabled();
    expect(screen.getByText(/Meta 연결 확인이 필요합니다/)).toBeVisible();
  });

  it("allows every Instagram format to be disabled for a Threads-only brand", async () => {
    const api = await renderBrandSettingsPage();

    await userEvent.click(await screen.findByRole("switch", { name: "Card News" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(api.updateInstagramFormats).toHaveBeenCalledWith("brand-1", expect.objectContaining({
      formats: [
        { format: "instagram_feed_carousel", enabled: false },
        { format: "instagram_story", enabled: false },
        { format: "instagram_reel", enabled: false }
      ]
    }));
    expect(await screen.findByText("저장됨")).toBeVisible();
  });

  it("treats generation criteria fields as optional for brand setup completion", async () => {
    await renderBrandSettingsPage({
      getBrandProfile: vi.fn(async () => ({
        ...apiProfile,
        tone: "",
        defaultCta: "",
        mainLink: ""
      }))
    });

    expect(await screen.findByText("필수 입력 완료")).toBeInTheDocument();
    expect(screen.queryByText("필수 입력 필요")).not.toBeInTheDocument();
  });

  it("visually marks only required profile fields as required", async () => {
    await renderBrandSettingsPage();

    const requiredFields = [
      await screen.findByLabelText("브랜드명"),
      screen.getByLabelText("대표 분야 선택"),
      screen.getByLabelText("핵심 고객 선택"),
      screen.getByLabelText("제품/서비스 설명")
    ];
    requiredFields.forEach((field) => {
      expect(within(field.closest("label") as HTMLElement).getByText("필수 입력")).toBeInTheDocument();
    });

    const optionalFields = [
      screen.getByLabelText("톤앤매너"),
      screen.getByLabelText("기본 CTA"),
      screen.getByLabelText("주요 링크")
    ];
    optionalFields.forEach((field) => {
      expect(within(field.closest("label") as HTMLElement).queryByText("필수 입력")).not.toBeInTheDocument();
    });
  });

  it("enforces five selections and normalizes duplicate custom names", async () => {
    await renderBrandSettingsPage();
    const custom = await screen.findByLabelText("직접 입력 세부 분야");
    const add = screen.getByRole("button", { name: "세부 분야 추가" });
    await userEvent.type(custom, "  가족 여행  ");
    await userEvent.click(add);
    expect(await screen.findByText("이미 선택한 세부 분야입니다.")).toBeVisible();
    await userEvent.clear(custom);
    await userEvent.type(custom, "가".repeat(31));
    await userEvent.click(add);
    expect(screen.getByText("직접 입력한 세부 분야는 30자 이내로 입력하세요.")).toBeVisible();
  });

  it("confirms incompatible system selections while retaining custom selections", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderBrandSettingsPage();
    await userEvent.selectOptions(await screen.findByLabelText("대표 분야 선택"), "food");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("1개"));
    expect(screen.getByText("가족 여행")).toBeInTheDocument();
    expect(screen.queryByText("국내 여행")).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("saves an explicit category payload without industry", async () => {
    const api = await renderBrandSettingsPage();
    await userEvent.clear(await screen.findByLabelText("브랜드명"));
    await userEvent.type(screen.getByLabelText("브랜드명"), "변경 브랜드");
    await userEvent.click(await screen.findByRole("button", { name: "저장" }));
    expect(api.updateBrandProfile).toHaveBeenCalledWith("brand-1", expect.objectContaining({
      primaryCategoryCode: "travel",
      subcategories: [
        { type: "system", code: "domestic" },
        { type: "custom", name: "가족 여행" }
      ]
    }));
    expect(api.updateBrandProfile.mock.calls[0][1]).not.toHaveProperty("industry");
  });

  it("shows API failure state without sample brand data", async () => {
    await renderBrandSettingsPage({
      getBrandProfile: vi.fn(async () => {
        throw new Error("api_down");
      })
    });

    expect(await screen.findByText(/API 서버가 응답하지 않아 브랜드 설정을 불러오지 못했습니다/)).toBeVisible();
    expect(screen.queryByDisplayValue("제주 여행 상담 브랜드")).not.toBeInTheDocument();
  });

  it("does not mark changes saved when the save API fails", async () => {
    await renderBrandSettingsPage({
      updateBrandProfile: vi.fn(async () => {
        throw new Error("save_failed");
      })
    });

    const nameInput = await screen.findByLabelText("브랜드명");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "저장 실패 브랜드");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText(/API 저장에 실패했습니다/)).toBeVisible();
    expect(screen.queryByText("저장됨")).not.toBeInTheDocument();
    expect(screen.getByText("변경사항 있음")).toBeInTheDocument();
  });

  it("saves and cancels all visible brand profile fields", async () => {
    await renderBrandSettingsPage();

    const nameInput = await screen.findByLabelText("브랜드명");
    const toneInput = screen.getByLabelText("톤앤매너");
    const ctaInput = screen.getByLabelText("기본 CTA");

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "브랜드 파일럿 여행");
    await userEvent.clear(toneInput);
    await userEvent.type(toneInput, "담백하고 실무적인 톤");
    await userEvent.clear(ctaInput);
    await userEvent.type(ctaInput, "상담 예약하기");

    expect(screen.getByText("변경사항 있음")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("저장됨")).toBeInTheDocument();
    expect(screen.queryByText("변경사항 있음")).not.toBeInTheDocument();

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "취소될 브랜드명");
    await userEvent.click(screen.getByRole("button", { name: "변경 취소" }));

    expect(nameInput).toHaveValue("브랜드 파일럿 여행");
    expect(toneInput).toHaveValue("담백하고 실무적인 톤");
    expect(ctaInput).toHaveValue("상담 예약하기");
  });

  it("keeps unsaved text edits when the separately saved logo is deleted", async () => {
    const api = await renderBrandSettingsPage();
    const nameInput = await screen.findByLabelText("브랜드명");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "저장 전 브랜드명");

    await userEvent.click(screen.getByRole("button", { name: "로고 삭제" }));

    expect(api.deleteBrandLogo).toHaveBeenCalledWith("brand-1");
    expect(nameInput).toHaveValue("저장 전 브랜드명");
    expect(screen.getByText("변경사항 있음")).toBeVisible();
  });
});
