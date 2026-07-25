import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrandAnalysis } from "../features/brand-intelligence/types";
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

const confirmedBrandIntelligence: BrandAnalysis = {
  id: "analysis-1",
  brandId: "brand-1",
  status: "confirmed",
  input: { ownedUrl: "https://brand.example.com", uploadIds: [] },
  result: null,
  editedResult: null,
  effectiveResult: {
    contractVersion: "brand-intelligence-result.v1",
    companyOverview: "회사 개요",
    businessDescription: "사업 소개",
    primaryCategory: { code: "travel", name: "여행·관광" },
    subcategories: [{ code: "domestic", name: "국내 여행" }],
    primaryTarget: "처음 여행을 준비하는 고객",
    differentiators: "차별점",
    coreAppeal: "소구점",
    competitors: [],
    evidence: [],
    sourceGaps: []
  },
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-07-21T00:00:00.000Z",
  updatedAt: "2026-07-21T00:00:00.000Z",
  confirmedAt: "2026-07-21T00:00:00.000Z"
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
    listSources: vi.fn(async () => [{
      id: "owned-1",
      brandId: "brand-1",
      sourceType: "owned" as const,
      url: "https://brand.example.com",
      title: "Brand home",
      status: "active",
      enabled: true,
      lastCrawledAt: null,
      lastError: null
    }]),
    ...apiOverrides
  };
  vi.doMock("../lib/apiClient", () => ({
    DEMO_BRAND_ID: "brand-1",
    api
  }));
  vi.doMock("../features/brand-intelligence/brandIntelligenceGateway", () => ({
    brandIntelligenceGateway: {
      getCurrent: vi.fn(async () => confirmedBrandIntelligence)
    }
  }));
  const { BrandSettingsPage } = await import("../pages/BrandSettingsPage");
  render(<BrandSettingsPage />);
  return api;
}

describe("BrandSettingsPage", () => {
  it("shows a page skeleton while the required settings are pending", async () => {
    await renderBrandSettingsPage({
      getBrandProfile: vi.fn(() => new Promise(() => {})),
      getInstagramFormats: vi.fn(() => new Promise(() => {}))
    });

    expect(screen.getByRole("status", { name: "브랜드 설정을 불러오는 중입니다." })).toHaveClass("skeleton-page");
  });

  it("shows the confirmed owned URL without a separate URL editor", async () => {
    const api = await renderBrandSettingsPage();

    expect(await screen.findByRole("heading", { name: "확정된 브랜드 정보" })).toBeVisible();
    expect(screen.getByText("대표 URL")).toBeVisible();
    expect(await screen.findByText("https://brand.example.com")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "자사 URL" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "자사 URL 추가" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("주요 링크")).not.toBeInTheDocument();
    expect(api).not.toHaveProperty("createSource");
  });

  it("loads brand profile from the API instead of sample data", async () => {
    await renderBrandSettingsPage();

    expect(await screen.findByDisplayValue("API 브랜드")).toBeVisible();
    expect(screen.getByLabelText("대표 분야 선택")).toHaveValue("travel");
    expect(screen.getByLabelText("핵심 고객 직접 입력")).toHaveValue("처음 여행을 준비하는 고객");
    expect(screen.queryByDisplayValue("제주 여행 상담 브랜드")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "브랜드 전체 자동 승인" })).not.toBeChecked();
    expect(screen.getByLabelText("브랜드 전체 자동 승인")).toHaveAttribute("data-state", "mixed");
    expect(screen.queryByText("채널별 자동 승인")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "검증 메시지" })).not.toBeInTheDocument();
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

  it("keeps the brand name, primary category, and primary customer in full-width rows", async () => {
    await renderBrandSettingsPage();

    const brandNameField = (await screen.findByLabelText("브랜드명")).closest("label");
    const categoryField = screen.getByLabelText("대표 분야 선택").closest("label");
    const customerField = screen.getByLabelText("핵심 고객 선택").closest("label");

    expect(brandNameField).not.toBeNull();
    expect(categoryField).not.toBeNull();
    expect(customerField).not.toBeNull();
    expect(brandNameField).toHaveClass("field", "full");
    expect(categoryField).toHaveClass("field", "full");
    expect(customerField).toHaveClass("field", "full");
    expect(brandNameField!.compareDocumentPosition(categoryField!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(categoryField!.compareDocumentPosition(customerField!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("orders settings sections and keeps the brand color in the profile", async () => {
    await renderBrandSettingsPage();

    const headings = [
      await screen.findByRole("heading", { name: "브랜드 프로필" }),
      screen.getByRole("heading", { name: "생성 기준" }),
      screen.getByRole("heading", { name: "자동 승인" }),
      screen.getByRole("heading", { name: "Instagram 콘텐츠 형식" }),
      screen.getByRole("heading", { name: "확정된 브랜드 정보" })
    ];
    headings.slice(0, -1).forEach((heading, index) => {
      expect(heading.compareDocumentPosition(headings[index + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    const profileSection = headings[0].closest("section");
    const instagramSection = headings[3].closest("section");
    expect(profileSection).not.toBeNull();
    expect(instagramSection).not.toBeNull();
    expect(within(profileSection!).getByLabelText("브랜드 주색")).toBeVisible();
    expect(within(instagramSection!).queryByLabelText("브랜드 주색")).not.toBeInTheDocument();
  });

  it("shows Instagram formats in an accessible open accordion ordered Card News, Reel, Story", async () => {
    await renderBrandSettingsPage();

    const trigger = await screen.findByRole("button", { name: /Instagram 콘텐츠 형식/ });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panelId = trigger.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId!);
    expect(panel).not.toBeNull();
    expect(panel).not.toHaveAttribute("hidden");

    const cardNews = within(panel!).getByRole("switch", { name: "Card News" });
    const reel = within(panel!).getByRole("switch", { name: "Reel" });
    const story = within(panel!).getByRole("switch", { name: "Story" });
    expect(cardNews.compareDocumentPosition(reel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reel.compareDocumentPosition(story) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveAttribute("hidden");
  });

  it("nests Instagram content formats inside the auto-approval section", async () => {
    await renderBrandSettingsPage();

    const autoApprovalSection = (await screen.findByRole("heading", { name: "자동 승인" })).closest("section");
    expect(autoApprovalSection).not.toBeNull();
    expect(within(autoApprovalSection!).getByRole("heading", { name: "Instagram" })).toBeVisible();
    expect(within(autoApprovalSection!).getByRole("heading", { name: "Instagram 콘텐츠 형식" })).toBeVisible();
    expect(within(autoApprovalSection!).getByText(/다른 채널의 콘텐츠 형식도 이 영역에 추가됩니다/)).toBeVisible();
  });

  it("shows a partial master state and enables every available Instagram format when clicked", async () => {
    await renderBrandSettingsPage();

    const master = await screen.findByRole("switch", { name: "브랜드 전체 자동 승인" });
    expect(screen.getByText("일부 켜짐")).toBeVisible();
    expect(screen.getByLabelText("브랜드 전체 자동 승인")).toHaveAttribute("data-state", "mixed");

    await userEvent.click(master);

    expect(screen.getByRole("switch", { name: "Card News" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Reel" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Story" })).not.toBeChecked();
    expect(screen.getByText("전체 켜짐")).toBeVisible();
  });

  it("turns every Instagram format off with the master switch", async () => {
    await renderBrandSettingsPage({
      getInstagramFormats: vi.fn(async () => ({
        ...apiInstagramFormats,
        formats: apiInstagramFormats.formats.map((format) => ({
          ...format,
          enabled: format.capabilityStatus === "available"
        }))
      }))
    });

    await userEvent.click(await screen.findByRole("switch", { name: "브랜드 전체 자동 승인" }));

    expect(screen.getByRole("switch", { name: "Card News" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Reel" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Story" })).not.toBeChecked();
    expect(screen.getByText("전체 꺼짐")).toBeVisible();
  });

  it("saves an auto-approval change without resending unchanged analyzed profile fields", async () => {
    const api = await renderBrandSettingsPage({
      getBrandProfile: vi.fn(async () => ({
        ...apiProfile,
        primaryCustomer: "브랜드 분석에서 생성되어 기존 직접 입력 제한보다 긴 핵심 고객 설명입니다. 자동 승인만 저장할 때 다시 검증하면 안 됩니다."
      })),
      getInstagramFormats: vi.fn(async () => ({
        ...apiInstagramFormats,
        formats: apiInstagramFormats.formats.map((format) => ({
          ...format,
          enabled: format.capabilityStatus === "available"
        }))
      }))
    });

    await userEvent.click(await screen.findByRole("switch", { name: "브랜드 전체 자동 승인" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(api.updateBrandProfile).toHaveBeenCalledWith("brand-1", { autoApprovalEnabled: false });
    expect(await screen.findByText("저장됨")).toBeVisible();
  });

  it("keeps unavailable formats off when the master switch enables available formats", async () => {
    await renderBrandSettingsPage({
      getBrandProfile: vi.fn(async () => ({ ...apiProfile, autoApprovalEnabled: false })),
      getInstagramFormats: vi.fn(async () => ({
        ...apiInstagramFormats,
        formats: apiInstagramFormats.formats.map((format) => format.format === "instagram_feed_carousel"
          ? { ...format, enabled: false, capabilityStatus: "needs_attention" as const }
          : { ...format, enabled: false })
      }))
    });

    await userEvent.click(await screen.findByRole("switch", { name: "브랜드 전체 자동 승인" }));

    expect(screen.getByRole("switch", { name: "Card News" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Card News" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Reel" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Story" })).not.toBeChecked();
  });

  it("normalizes legacy subcategory data to the five-selection limit", async () => {
    await renderBrandSettingsPage({
      getBrandProfile: vi.fn(async () => ({
        ...apiProfile,
        subcategories: Array.from({ length: 6 }, (_, index) => ({
          type: "custom" as const,
          code: null,
          name: `세부 분야 ${index + 1}`
        }))
      }))
    });

    expect(await screen.findByText("선택 5/5")).toBeVisible();
    expect(screen.queryByRole("button", { name: "세부 분야 6 제거" })).not.toBeInTheDocument();
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
    expect(screen.getByText(/Card News → Reel → Story/)).toBeVisible();
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
      screen.getByLabelText("기본 CTA")
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
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = await renderBrandSettingsPage();
    await userEvent.clear(await screen.findByLabelText("브랜드명"));
    await userEvent.type(screen.getByLabelText("브랜드명"), "변경 브랜드");
    await userEvent.selectOptions(screen.getByLabelText("대표 분야 선택"), "food");
    await userEvent.click(await screen.findByRole("button", { name: "저장" }));
    expect(api.updateBrandProfile).toHaveBeenCalledWith("brand-1", expect.objectContaining({
      primaryCategoryCode: "food",
      subcategories: [
        { type: "custom", name: "가족 여행" }
      ]
    }));
    expect(api.updateBrandProfile.mock.calls[0][1]).not.toHaveProperty("industry");
  });

  it("disables all editable controls while a profile save is pending", async () => {
    const updateBrandProfile = vi.fn(() => new Promise<BrandProfile>(() => {}));
    await renderBrandSettingsPage({ updateBrandProfile });
    const nameInput = await screen.findByLabelText("브랜드명");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "저장 중 브랜드");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(screen.getByRole("button", { name: "저장" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("브랜드 설정 저장 중")).toBeVisible();
    expect(nameInput).toBeDisabled();
    expect(screen.getByLabelText("대표 분야 선택")).toBeDisabled();
    expect(screen.getByLabelText("핵심 고객 선택")).toBeDisabled();
    expect(screen.getByLabelText("제품/서비스 설명")).toBeDisabled();
    expect(screen.getByLabelText("톤앤매너")).toBeDisabled();
    expect(screen.getByLabelText("기본 CTA")).toBeDisabled();
    expect(screen.getByLabelText("직접 입력 세부 분야")).toBeDisabled();
    expect(screen.getByRole("button", { name: "세부 분야 추가" })).toBeDisabled();
    expect(screen.getByLabelText("브랜드 주색")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Card News" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "브랜드 전체 자동 승인" })).toBeDisabled();
    expect(screen.getByLabelText("로고 이미지 선택")).toBeDisabled();
    expect(screen.getByRole("button", { name: "로고 삭제" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "변경 취소" })).toBeDisabled();
  });

  it("gives every subcategory chip a named remove action", async () => {
    await renderBrandSettingsPage();

    expect(await screen.findByRole("button", { name: "국내 여행 제거" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "가족 여행 제거" })).toBeInTheDocument();
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
