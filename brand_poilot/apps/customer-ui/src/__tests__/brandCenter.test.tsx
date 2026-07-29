import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

const active = {
  id: "core-1",
  sourceAnalysisId: "analysis-1",
  version: 1,
  status: "approved" as const,
  core: {
    contractVersion: "brand-core.v1" as const,
    summary: { oneLine: "브랜드 운영을 단순하게", description: "승인된 브랜드 설명" },
    audiences: [{ name: "브랜드 담당자", problem: "시간 부족", desiredOutcome: "일관된 운영" }],
    valueProposition: {
      primary: "반복 업무 절감",
      differentiators: ["승인 정보 사용"],
      proofPoints: ["검토 흐름"],
    },
    messaging: {
      appeals: ["업무 절감"],
      tone: ["명확함"],
      preferredPhrases: ["근거를 바탕으로"],
      brandDirection: "과장 없는 운영",
      priorityMessages: ["승인 정보 사용"],
    },
  },
  evidence: [],
  reviewState: {},
  approvedAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
};

const persistedDraft = {
  ...active,
  id: "draft-2",
  version: 2,
  status: "draft" as const,
  core: {
    ...active.core,
    summary: { ...active.core.summary, oneLine: "저장된 수정 초안" },
  },
  approvedAt: null,
  updatedAt: "2026-07-27T00:00:00.000Z",
};

const superseded = {
  ...active,
  id: "core-0",
  version: 0,
  status: "superseded" as const,
  core: {
    ...active.core,
    summary: { ...active.core.summary, oneLine: "이전 브랜드 코어" },
  },
  approvedAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

const activeRules = {
  id: "rules-1",
  version: 1,
  status: "approved" as const,
  rules: {
    contractVersion: "brand-rules.v1" as const,
    requiredPhrases: [],
    forbiddenPhrases: [],
    exaggerationRules: [],
    ctaRules: { defaultCta: "", allowed: [] },
    channelRules: {},
    designRules: {
      colors: ["#174A3A", "#F4EFE5"],
      fonts: ["명확한 산세리프 중심"],
      notes: ["절제된 제품 중심 이미지"],
      referenceImages: [{
        referenceItemId: "11111111-1111-4111-8111-111111111111",
        description: "차분한 자연광",
        tags: ["제품", "차분함"],
      }],
    },
    autoApprovalRules: { enabled: false, conditions: [] },
  },
  approvedAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
};

const faqItem = {
  id: "wiki-faq-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  itemType: "faq" as const,
  title: "배송은 얼마나 걸리나요?",
  content: "영업일 기준 2~3일입니다.",
  status: "active" as const,
  origin: "manual" as const,
  provenance: {},
  createdByUserId: "user-1",
  approvedByUserId: "user-1",
  approvedAt: "2026-07-26T00:00:00.000Z",
  sourceKind: "faq" as const,
  sourceId: "wiki-faq-1",
  activeVersionId: "wiki-version-1",
  lastBuiltAt: "2026-07-26T00:00:00.000Z",
  buildStatus: "active" as const,
};

const approvedProductVersion = {
  id: "product-version-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  productServiceId: "product-1",
  version: 1,
  status: "approved" as const,
  profile: {
    contractVersion: "product-service.v1" as const,
    name: "콘텐츠 운영",
    kind: "service" as const,
    description: "승인된 설명",
    features: ["예약"],
    benefits: ["시간 절약"],
    cautions: [],
    audiences: [],
    appealsByTarget: {},
    evergreenPurchaseInfo: "월 구독",
    sourceUrls: ["https://example.com/product"],
  },
  evidence: [],
  sourceAnalysisId: null,
  approvedAt: "2026-07-26T00:00:00.000Z",
  createdAt: "2026-07-26T00:00:00.000Z",
};

const approvedProduct = {
  id: "product-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  kind: "service" as const,
  displayName: "콘텐츠 운영",
  status: "active" as const,
  activeVersionId: approvedProductVersion.id,
  activeVersion: approvedProductVersion,
  draft: null,
};

const intelligenceResult = {
  contractVersion: "brand-intelligence-result.v1" as const,
  companyOverview: "승인된 기업 개요",
  businessDescription: "승인된 사업 소개",
  primaryCategory: { code: "service", name: "서비스" },
  subcategories: [],
  primaryTarget: "브랜드 담당자",
  differentiators: "승인 기반 운영",
  coreAppeal: "일관된 콘텐츠",
  competitors: [],
  evidence: [],
  sourceGaps: [],
};

const confirmedAnalysis = {
  id: "11111111-1111-4111-8111-111111111111",
  brandId: "brand-1",
  status: "confirmed" as const,
  input: { ownedUrl: "https://brand.example", uploadIds: [] },
  result: intelligenceResult,
  editedResult: null,
  effectiveResult: intelligenceResult,
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:01:00.000Z",
  confirmedAt: "2026-07-29T00:01:00.000Z",
};

const queuedWorkflow = {
  ...confirmedAnalysis,
  id: "22222222-2222-4222-8222-222222222222",
  status: "queued" as const,
  result: null,
  effectiveResult: null,
  confirmedAt: null,
};

const reviewReadyWorkflow = {
  ...confirmedAnalysis,
  id: "33333333-3333-4333-8333-333333333333",
  status: "review_ready" as const,
  confirmedAt: null,
};

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

async function renderPage(
  path = "/brand-center?tab=understanding&section=core",
  gatewayOverrides: Record<string, unknown> = {},
  libraryOverrides: Record<string, unknown> = {},
  intelligenceOverrides: Record<string, unknown> = {},
) {
  const gateway = {
    getSummary: vi.fn(async () => ({
      source: { state: "ready" },
      analysis: { state: "confirmed" },
      brandCore: { state: "approved" },
      rules: { state: "empty" },
      products: { state: "unavailable" },
      wiki: { state: "unavailable" },
      avatars: { state: "unavailable" },
    })),
    getCore: vi.fn(async () => ({ active, draft: null, versions: [active] })),
    getRules: vi.fn(async () => ({ active: activeRules, draft: null, versions: [activeRules] })),
    createCoreDraft: vi.fn(async () => ({ ...active, id: "draft-1", status: "draft" })),
    updateCoreDraft: vi.fn(),
    approveCoreDraft: vi.fn(),
    saveRuleDraft: vi.fn(async (_brandId, rules) => ({
      ...activeRules,
      id: "rules-draft-1",
      status: "draft" as const,
      rules,
    })),
    approveRules: vi.fn(),
    ...gatewayOverrides,
  };
  vi.doMock("../features/brand-center/brandCenterGateway", () => ({
    brandCenterGateway: gateway,
  }));
  const supportApi = {
    listSources: vi.fn(async () => []),
    listSupportRequests: vi.fn(async () => []),
  };
  vi.doMock("../lib/apiClient", async (importOriginal) => ({
    ...await importOriginal<typeof import("../lib/apiClient")>(),
    DEMO_BRAND_ID: "brand-1",
    api: supportApi,
  }));
  const intelligenceGateway = {
    getCurrent: vi.fn(async () => confirmedAnalysis),
    getWorkflow: vi.fn(async () => null),
    ...intelligenceOverrides,
  };
  vi.doMock("../features/brand-intelligence/brandIntelligenceGateway", () => ({
    brandIntelligenceGateway: intelligenceGateway,
  }));
  const libraryApi = {
    listProductServices: vi.fn(async () => []),
    getProductService: vi.fn(),
    createProductService: vi.fn(),
    createProductServiceFromAnalysis: vi.fn(),
    updateProductServiceDraft: vi.fn(),
    approveProductService: vi.fn(),
    archiveProductService: vi.fn(),
    listWikiItems: vi.fn(async () => [faqItem]),
    createWikiItem: vi.fn(async (_brandId, input) => ({
      ...faqItem,
      id: "wiki-new",
      itemType: input.itemType,
      title: input.title,
      content: input.content,
      status: "draft" as const,
      buildStatus: "draft" as const,
    })),
    updateWikiItem: vi.fn(async (_brandId, _itemId, input) => ({
      ...faqItem,
      ...input,
    })),
    listWikiIssues: vi.fn(async () => []),
    resolveWikiIssue: vi.fn(),
    getReference: vi.fn(async () => ({
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      kind: "upload",
      contentPurpose: "both",
      origin: "Upload",
      title: "calm-product.png",
      previewUrl: "https://blob.example/calm-product.png",
      sourceUrl: "https://blob.example/calm-product.png",
      format: "image/png",
      metadata: { mimeType: "image/png" },
      favorite: false,
      archivedAt: null,
      referenceBrandId: null,
      description: null,
      body: null,
      snapshot: null,
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
    })),
    uploadReferenceFile: vi.fn(),
    cancelReferenceUpload: vi.fn(),
    listAvatars: vi.fn(async () => []),
    createAvatar: vi.fn(),
    updateAvatar: vi.fn(),
    uploadAvatarImage: vi.fn(),
    deleteAvatarImage: vi.fn(),
    setDefaultAvatar: vi.fn(),
    archiveAvatar: vi.fn(),
    ...libraryOverrides,
  };
  vi.doMock("../features/libraries/libraryGateway", async (importOriginal) => ({
    ...await importOriginal<typeof import("../features/libraries/libraryGateway")>(),
    libraryGateway: libraryApi,
  }));
  const { BrandCenterPage } = await import("../pages/BrandCenterPage");
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <BrandCenterPage />
      <LocationProbe />
    </MemoryRouter>,
  );
  return { gateway, intelligenceGateway, libraryApi, supportApi, ...view };
}

function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

function emptyBrandCenterOverrides() {
  return {
    getSummary: vi.fn(async () => ({
      source: { state: "empty" },
      analysis: { state: "empty" },
      brandCore: { state: "empty" },
      rules: { state: "empty" },
      products: { state: "unavailable" },
      wiki: { state: "unavailable" },
      avatars: { state: "unavailable" },
    })),
    getCore: vi.fn(async () => ({ active: null, draft: null, versions: [] })),
  };
}

describe("BrandCenterPage", () => {
  it("hides the tabs and starts onboarding when no confirmed analysis or workflow exists", async () => {
    await renderPage(
      "/brand-center?tab=core",
      emptyBrandCenterOverrides(),
      {},
      {
        getCurrent: vi.fn(async () => null),
        getWorkflow: vi.fn(async () => null),
      },
    );

    expect(await screen.findByRole("link", { name: "온보딩 하기" }))
      .toHaveAttribute("href", "/onboarding/brand-intelligence");
    expect(screen.queryByRole("tablist", { name: "브랜드 센터 영역" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "문의 내역" })).not.toBeInTheDocument();
  });

  it("hides the tabs while the initial analysis is pending", async () => {
    await renderPage(
      "/brand-center?tab=core",
      emptyBrandCenterOverrides(),
      {},
      {
        getCurrent: vi.fn(async () => null),
        getWorkflow: vi.fn(async () => queuedWorkflow),
      },
    );

    expect(await screen.findByText("분석중입니다")).toBeVisible();
    expect(screen.queryByRole("tablist", { name: "브랜드 센터 영역" }))
      .not.toBeInTheDocument();
  });

  it("hides the tabs and links to the initial analysis review", async () => {
    await renderPage(
      "/brand-center?tab=core",
      emptyBrandCenterOverrides(),
      {},
      {
        getCurrent: vi.fn(async () => null),
        getWorkflow: vi.fn(async () => reviewReadyWorkflow),
      },
    );

    expect(await screen.findByText("분석이 완료되었습니다.")).toBeVisible();
    expect(screen.getByRole("link", { name: "분석확인하기" })).toHaveAttribute(
      "href",
      `/onboarding/brand-intelligence?analysisId=${reviewReadyWorkflow.id}`,
    );
    expect(screen.queryByRole("tablist", { name: "브랜드 센터 영역" }))
      .not.toBeInTheDocument();
  });

  it("keeps legacy approved brand content visible without an intelligence run", async () => {
    const { supportApi } = await renderPage(
      "/brand-center?tab=core",
      {},
      {},
      {
        getCurrent: vi.fn(async () => null),
        getWorkflow: vi.fn(async () => null),
      },
    );

    expect(await screen.findByRole("tablist", { name: "브랜드 센터 영역" })).toBeVisible();
    expect(screen.getByDisplayValue("브랜드 운영을 단순하게")).toBeDisabled();
    expect(screen.getByRole("region", { name: "문의 내역" })).toBeVisible();
    expect(supportApi.listSupportRequests).toHaveBeenCalledTimes(1);
  });

  it("treats an open workflow as reanalysis for a legacy approved brand", async () => {
    await renderPage(
      "/brand-center?tab=core",
      {},
      {},
      {
        getCurrent: vi.fn(async () => null),
        getWorkflow: vi.fn(async () => queuedWorkflow),
      },
    );

    expect(await screen.findByText("재분석 중입니다")).toBeVisible();
    expect(screen.queryByText("분석중입니다")).not.toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "브랜드 센터 영역" })).toBeVisible();
  });

  it("treats a ready workflow as reanalysis review for a legacy approved brand", async () => {
    await renderPage(
      "/brand-center?tab=core",
      {},
      {},
      {
        getCurrent: vi.fn(async () => null),
        getWorkflow: vi.fn(async () => reviewReadyWorkflow),
      },
    );

    expect(await screen.findByText("재분석 결과를 확인하세요")).toBeVisible();
    expect(screen.queryByText("분석이 완료되었습니다.")).not.toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "브랜드 센터 영역" })).toBeVisible();
  });

  it("keeps confirmed tabs visible while reanalysis is pending", async () => {
    await renderPage(
      "/brand-center?tab=core",
      {},
      {},
      {
        getCurrent: vi.fn(async () => confirmedAnalysis),
        getWorkflow: vi.fn(async () => queuedWorkflow),
      },
    );

    expect(await screen.findByText("재분석 중입니다")).toBeVisible();
    expect(screen.getByRole("tablist", { name: "브랜드 센터 영역" })).toBeVisible();
  });

  it("keeps confirmed tabs visible and links to a ready reanalysis", async () => {
    await renderPage(
      "/brand-center?tab=core",
      {},
      {},
      {
        getCurrent: vi.fn(async () => confirmedAnalysis),
        getWorkflow: vi.fn(async () => reviewReadyWorkflow),
      },
    );

    expect(await screen.findByText("재분석 결과를 확인하세요")).toBeVisible();
    expect(screen.getByRole("link", { name: "분석확인하기" })).toHaveAttribute(
      "href",
      `/onboarding/brand-intelligence?analysisId=${reviewReadyWorkflow.id}`,
    );
    expect(screen.getByRole("tablist", { name: "브랜드 센터 영역" })).toBeVisible();
  });

  it("mounts one shared support history below every confirmed tab panel", async () => {
    const { supportApi } = await renderPage("/brand-center?tab=core");

    expect(await screen.findByRole("region", { name: "문의 내역" })).toBeVisible();
    expect(screen.getAllByRole("region", { name: "문의 내역" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("tab", { name: "스타일" }));
    expect(screen.getAllByRole("region", { name: "문의 내역" })).toHaveLength(1);
    expect(supportApi.listSupportRequests).toHaveBeenCalledTimes(1);
  });

  it("shows the approved core with the final customer-facing tab order", async () => {
    await renderPage();
    expect(await screen.findByRole("heading", { name: "브랜드 센터" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("브랜드 운영을 단순하게")).toBeDisabled();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "브랜드 코어",
      "FAQ",
      "이용 방법",
      "가이드",
      "제품·서비스",
      "스타일",
    ]);
    expect(screen.queryByRole("button", { name: "변경 검토" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Wiki" })).not.toBeInTheDocument();
  });

  it("uses reference images instead of the avatar library as the customer-facing style panel", async () => {
    const { gateway, libraryApi } = await renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: "스타일" }));
    expect(await screen.findByRole("heading", { name: "디자인 스타일" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "차분한 자연광" }))
      .toHaveAttribute("src", "https://blob.example/calm-product.png");
    expect(screen.queryByText("모델·아바타")).not.toBeInTheDocument();
    expect(libraryApi.listAvatars).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "스타일 이미지 수정" }));
    const description = screen.getByRole("textbox", { name: "이미지 설명" });
    await userEvent.clear(description);
    await userEvent.type(description, "밝고 선명한 자연광");
    await userEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));

    await waitFor(() => expect(gateway.saveRuleDraft).toHaveBeenCalledWith(
      "brand-1",
      expect.objectContaining({
        designRules: expect.objectContaining({
          colors: ["#174A3A", "#F4EFE5"],
          referenceImages: [{
            referenceItemId: "11111111-1111-4111-8111-111111111111",
            description: "밝고 선명한 자연광",
            tags: ["제품", "차분함"],
          }],
        }),
      }),
    ));
    expect(await screen.findByText("디자인 스타일을 저장했습니다.")).toBeInTheDocument();
  });

  it("loads real FAQ items and requires explicit edit and save", async () => {
    const { libraryApi } = await renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: "FAQ" }));

    await userEvent.click(await screen.findByRole("button", {
      name: /배송은 얼마나 걸리나요/,
    }));
    expect(screen.getByRole("textbox", { name: "제목" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "수정" }));
    const content = screen.getByRole("textbox", { name: "내용" });
    await userEvent.clear(content);
    await userEvent.type(content, "영업일 기준 1~2일입니다.");
    expect(libraryApi.updateWikiItem).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(libraryApi.updateWikiItem).toHaveBeenCalledWith(
      "brand-1",
      "wiki-faq-1",
      { title: "배송은 얼마나 걸리나요?", content: "영업일 기준 1~2일입니다." },
    ));
    expect(await screen.findByText("FAQ를 저장했습니다.")).toBeInTheDocument();
  });

  it("blocks tab changes when a knowledge edit is dirty and supports cancel", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderPage();
    await userEvent.click(await screen.findByRole("tab", { name: "FAQ" }));
    await userEvent.click(await screen.findByRole("button", {
      name: /배송은 얼마나 걸리나요/,
    }));
    await userEvent.click(screen.getByRole("button", { name: "수정" }));
    await userEvent.type(screen.getByRole("textbox", { name: "내용" }), " 수정");
    await userEvent.click(screen.getByRole("tab", { name: "가이드" }));

    expect(confirm).toHaveBeenCalledWith("저장하지 않은 변경이 있습니다. 이동할까요?");
    expect(screen.getByRole("tab", { name: "FAQ" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("textbox", { name: "내용" }))
      .toHaveValue("영업일 기준 2~3일입니다.");
  });

  it("routes legacy Wiki issue links to the guide improvement control", async () => {
    const issueId = "11111111-1111-4111-8111-111111111111";
    const issue = {
      id: issueId,
      workspaceId: "workspace-1",
      brandId: "brand-1",
      issueType: "knowledge_gap",
      severity: "warning" as const,
      status: "open" as const,
      question: "배송 정책을 확인해 주세요",
      detail: {},
      sourceKind: null,
      sourceId: null,
      activeVersionId: "wiki-version-1",
      lastBuiltAt: "2026-07-26T00:00:00.000Z",
      buildStatus: "active" as const,
      resolvedAt: null,
    };
    await renderPage(
      `/brand-center?tab=wiki&issue=${issueId}`,
      {},
      { listWikiIssues: vi.fn(async () => [issue]) },
    );

    expect(await screen.findByRole("tab", { name: "가이드" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("location")).toHaveTextContent(`tab=guide&issue=${issueId}`);
    expect(await screen.findByRole("group", { name: "가이드 보조 메뉴" })).toBeVisible();
    expect(await screen.findByRole("region", { name: "지식 개선 상세" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.getByTestId("location")).not.toHaveTextContent("issue=");
  });

  it("creates an editable core draft only after the user chooses to edit", async () => {
    const { gateway } = await renderPage();
    expect(await screen.findByDisplayValue("브랜드 운영을 단순하게")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "브랜드 코어 수정" }));
    await waitFor(() => expect(gateway.createCoreDraft).toHaveBeenCalledWith(
      "brand-1",
      expect.objectContaining({ core: active.core }),
    ));
    expect(screen.getByDisplayValue("브랜드 운영을 단순하게")).toBeEnabled();
  });

  it("marks core edits dirty and lets the user cancel a guarded tab change", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "브랜드 코어 수정" }));
    const oneLine = screen.getByRole("textbox", { name: "한 줄 소개" });
    await userEvent.clear(oneLine);
    await userEvent.type(oneLine, "아직 저장하지 않은 코어");
    expect(screen.getByText("저장하지 않은 변경")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "FAQ" }));
    expect(confirm).toHaveBeenCalledWith("저장하지 않은 변경이 있습니다. 이동할까요?");
    expect(screen.getByRole("tab", { name: "브랜드 코어" })).toHaveAttribute("aria-selected", "true");
  });

  it("cancels back to the persisted draft without sending an update", async () => {
    const getCore = vi.fn(async () => ({
      active,
      draft: persistedDraft,
      versions: [persistedDraft, active],
    }));
    const updateCoreDraft = vi.fn();
    await renderPage("/brand-center?tab=core", { getCore, updateCoreDraft });

    expect(await screen.findByDisplayValue("브랜드 운영을 단순하게")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "브랜드 코어 수정" }));
    const oneLine = screen.getByRole("textbox", { name: "한 줄 소개" });
    expect(oneLine).toHaveValue("저장된 수정 초안");
    await userEvent.clear(oneLine);
    await userEvent.type(oneLine, "버릴 수정");
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(updateCoreDraft).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "브랜드 코어 수정" }));
    expect(screen.getByRole("textbox", { name: "한 줄 소개" })).toHaveValue("저장된 수정 초안");
  });

  it("saves with the persisted concurrency token and returns to view mode", async () => {
    const getCore = vi.fn(async () => ({
      active,
      draft: persistedDraft,
      versions: [persistedDraft, active],
    }));
    const updateCoreDraft = vi.fn(async (
      _brandId: string,
      _versionId: string,
      input: { core: typeof active.core },
    ) => ({
      ...persistedDraft,
      core: input.core,
      updatedAt: "2026-07-28T00:00:00.000Z",
    }));
    await renderPage("/brand-center?tab=core", { getCore, updateCoreDraft });

    await userEvent.click(await screen.findByRole("button", { name: "브랜드 코어 수정" }));
    const oneLine = screen.getByRole("textbox", { name: "한 줄 소개" });
    await userEvent.clear(oneLine);
    await userEvent.type(oneLine, "저장된 최신 코어");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(updateCoreDraft).toHaveBeenCalledWith(
      "brand-1",
      persistedDraft.id,
      expect.objectContaining({
        core: expect.objectContaining({
          summary: expect.objectContaining({ oneLine: "저장된 최신 코어" }),
        }),
        expectedUpdatedAt: persistedDraft.updatedAt,
      }),
    ));
    expect(screen.getByDisplayValue("저장된 최신 코어")).toBeDisabled();
    expect(await screen.findByText("브랜드 코어를 저장했습니다.")).toBeInTheDocument();
  });

  it("refreshes revision history after approval so the prior active core is superseded", async () => {
    const approvedDraft = {
      ...persistedDraft,
      status: "approved" as const,
      approvedAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    };
    const previousActive = {
      ...active,
      status: "superseded" as const,
    };
    const getCore = vi.fn()
      .mockResolvedValueOnce({
        active,
        draft: persistedDraft,
        versions: [persistedDraft, active],
      })
      .mockResolvedValueOnce({
        active: approvedDraft,
        draft: null,
        versions: [approvedDraft, previousActive],
      });
    const approveCoreDraft = vi.fn(async () => approvedDraft);
    await renderPage("/brand-center?tab=core", { getCore, approveCoreDraft });

    await userEvent.click(await screen.findByRole("button", { name: "브랜드 코어 수정" }));
    await userEvent.click(screen.getByRole("button", { name: "Brand Core 승인" }));

    await waitFor(() => expect(getCore).toHaveBeenCalledTimes(2));
    expect(approveCoreDraft).toHaveBeenCalledWith(
      "brand-1",
      persistedDraft.id,
      persistedDraft.updatedAt,
    );
    await userEvent.click(await screen.findByRole("button", { name: "버전 1 · 대체됨" }));
    expect(screen.getByDisplayValue("브랜드 운영을 단순하게")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "브랜드 코어 수정" })).not.toBeInTheDocument();
  });

  it("keeps stale edits visible and offers a conflict action", async () => {
    const conflict = Object.assign(new Error("conflict"), {
      errorCode: "brand_core_version_conflict",
    });
    const updateCoreDraft = vi.fn(async () => { throw conflict; });
    await renderPage("/brand-center?tab=core", {
      getCore: vi.fn(async () => ({
        active,
        draft: persistedDraft,
        versions: [persistedDraft, active],
      })),
      updateCoreDraft,
    });

    await userEvent.click(await screen.findByRole("button", { name: "브랜드 코어 수정" }));
    const oneLine = screen.getByRole("textbox", { name: "한 줄 소개" });
    await userEvent.clear(oneLine);
    await userEvent.type(oneLine, "충돌해도 남을 수정");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByRole("button", { name: "서버 버전 확인" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "한 줄 소개" })).toHaveValue("충돌해도 남을 수정");
    expect(screen.getByText("저장하지 않은 변경")).toBeInTheDocument();
  });

  it("loads a separate current server snapshot for conflict comparison without replacing local edits", async () => {
    const serverDraft = {
      ...persistedDraft,
      core: {
        ...persistedDraft.core,
        summary: {
          ...persistedDraft.core.summary,
          oneLine: "서버에서 갱신된 최신 초안",
        },
      },
      updatedAt: "2026-07-29T01:00:00.000Z",
    };
    const getCore = vi.fn()
      .mockResolvedValueOnce({
        active,
        draft: persistedDraft,
        versions: [persistedDraft, active],
      })
      .mockResolvedValueOnce({
        active,
        draft: serverDraft,
        versions: [serverDraft, active],
      });
    const conflict = Object.assign(new Error("conflict"), {
      errorCode: "brand_core_version_conflict",
    });
    const updateCoreDraft = vi.fn(async () => { throw conflict; });
    await renderPage("/brand-center?tab=core", { getCore, updateCoreDraft });

    await userEvent.click(await screen.findByRole("button", { name: "브랜드 코어 수정" }));
    const oneLine = screen.getByRole("textbox", { name: "한 줄 소개" });
    await userEvent.clear(oneLine);
    await userEvent.type(oneLine, "내가 계속 편집 중인 초안");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await userEvent.click(await screen.findByRole("button", { name: "서버 버전 확인" }));

    await waitFor(() => expect(getCore).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("서버에서 갱신된 최신 초안")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "한 줄 소개" }))
      .toHaveValue("내가 계속 편집 중인 초안");
    expect(screen.getByText("저장하지 않은 변경")).toBeInTheDocument();
  });

  it("shows superseded history read-only without overwriting the current draft", async () => {
    await renderPage("/brand-center?tab=core", {
      getCore: vi.fn(async () => ({
        active,
        draft: persistedDraft,
        versions: [persistedDraft, active, superseded],
      })),
    });

    await userEvent.click(await screen.findByRole("button", { name: "브랜드 코어 수정" }));
    const oneLine = screen.getByRole("textbox", { name: "한 줄 소개" });
    await userEvent.clear(oneLine);
    await userEvent.type(oneLine, "아직 저장하지 않은 현재 초안");
    await userEvent.click(screen.getByRole("button", { name: "버전 0 · 대체됨" }));
    expect(screen.getByDisplayValue("이전 브랜드 코어")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "브랜드 코어 수정" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "수정 초안 버전 2" }));
    expect(screen.getByDisplayValue("아직 저장하지 않은 현재 초안")).toBeEnabled();
  });

  it("edits operational rules without dropping fields and shares the page dirty guard", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const saveRuleDraft = vi.fn(async (_brandId: string, rules: typeof activeRules.rules) => ({
      ...activeRules,
      id: "rules-draft-1",
      status: "draft" as const,
      rules,
    }));
    const approveRules = vi.fn(async () => ({
      ...activeRules,
      id: "rules-draft-1",
    }));
    await renderPage("/brand-center?tab=core", { saveRuleDraft, approveRules });

    await userEvent.click(await screen.findByRole("button", { name: "운영 규칙" }));
    expect(screen.getByRole("heading", { name: "운영 규칙" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "반드시 포함할 문구" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "규칙 수정" }));
    await userEvent.type(screen.getByRole("textbox", { name: "반드시 포함할 문구" }), "근거 기반");
    await userEvent.click(screen.getByRole("tab", { name: "FAQ" }));
    expect(confirm).toHaveBeenCalledWith("저장하지 않은 변경이 있습니다. 이동할까요?");
    expect(screen.getByRole("tab", { name: "브랜드 코어" })).toHaveAttribute("aria-selected", "true");

    await userEvent.click(screen.getByRole("button", { name: "규칙 취소" }));
    expect(screen.getByRole("textbox", { name: "반드시 포함할 문구" })).toHaveValue("");
    expect(saveRuleDraft).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "규칙 수정" }));
    await userEvent.type(screen.getByRole("textbox", { name: "반드시 포함할 문구" }), "근거 기반");
    await userEvent.click(screen.getByRole("button", { name: "규칙 저장" }));

    await waitFor(() => expect(saveRuleDraft).toHaveBeenCalledWith(
      "brand-1",
      {
        ...activeRules.rules,
        requiredPhrases: ["근거 기반"],
      },
    ));
    expect(screen.getByRole("textbox", { name: "반드시 포함할 문구" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "규칙 승인" }));
    await waitFor(() => expect(approveRules).toHaveBeenCalledWith("brand-1", "rules-draft-1"));
  });

  it("guards dirty product edits from tab navigation and beforeunload", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderPage(
      "/brand-center?tab=products",
      {},
      { listProductServices: vi.fn(async () => [approvedProduct]) },
    );

    await userEvent.click(await screen.findByRole("button", { name: /콘텐츠 운영/ }));
    await userEvent.click(screen.getByRole("button", { name: "수정" }));
    await userEvent.type(screen.getByRole("textbox", { name: "설명" }), " 수정");

    await userEvent.click(screen.getByRole("tab", { name: "제품·서비스" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "설명" })).toHaveValue("승인된 설명 수정");
    expect(dispatchBeforeUnload()).toHaveProperty("defaultPrevented", true);

    confirm.mockReturnValue(false);
    await userEvent.click(screen.getByRole("tab", { name: "FAQ" }));
    expect(confirm).toHaveBeenCalledWith("저장하지 않은 변경이 있습니다. 이동할까요?");
    expect(screen.getByRole("tab", { name: "제품·서비스" })).toHaveAttribute("aria-selected", "true");

    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole("tab", { name: "FAQ" }));
    expect(screen.getByRole("tab", { name: "FAQ" })).toHaveAttribute("aria-selected", "true");
    expect(dispatchBeforeUnload()).toHaveProperty("defaultPrevented", false);
  });

  it("clears the product dirty guard after cancel, save, and unmount", async () => {
    const nextDraft = {
      ...approvedProductVersion,
      id: "product-version-2",
      version: 2,
      status: "draft" as const,
      profile: { ...approvedProductVersion.profile, description: "저장된 수정" },
      approvedAt: null,
    };
    const updateProductServiceDraft = vi.fn(async () => ({
      ...approvedProduct,
      draft: nextDraft,
    }));
    const view = await renderPage(
      "/brand-center?tab=products",
      {},
      {
        listProductServices: vi.fn(async () => [approvedProduct]),
        updateProductServiceDraft,
      },
    );

    await userEvent.click(await screen.findByRole("button", { name: /콘텐츠 운영/ }));
    await userEvent.click(screen.getByRole("button", { name: "수정" }));
    await userEvent.type(screen.getByRole("textbox", { name: "설명" }), " 취소할 수정");
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(dispatchBeforeUnload()).toHaveProperty("defaultPrevented", false);

    await userEvent.click(screen.getByRole("button", { name: "수정" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "설명" }));
    await userEvent.type(screen.getByRole("textbox", { name: "설명" }), "저장된 수정");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(updateProductServiceDraft).toHaveBeenCalled());
    expect(dispatchBeforeUnload()).toHaveProperty("defaultPrevented", false);

    await userEvent.click(screen.getByRole("button", { name: "수정" }));
    await userEvent.type(screen.getByRole("textbox", { name: "설명" }), " 다시 수정");
    expect(dispatchBeforeUnload()).toHaveProperty("defaultPrevented", true);
    view.unmount();
    expect(dispatchBeforeUnload()).toHaveProperty("defaultPrevented", false);
  });

  it("clears a malformed analysis query without calling the mutation", async () => {
    const { libraryApi } = await renderPage("/brand-center?tab=products&analysis=not-a-uuid");

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("?tab=products"));
    expect(libraryApi.createProductServiceFromAnalysis).not.toHaveBeenCalled();
  });

  it("retries a failed core save without reloading or discarding the local edit", async () => {
    const updateCoreDraft = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockImplementationOnce(async (
        _brandId: string,
        _versionId: string,
        input: { core: typeof active.core },
      ) => ({ ...persistedDraft, core: input.core, updatedAt: "2026-07-29T02:00:00.000Z" }));
    const getCore = vi.fn(async () => ({
      active,
      draft: persistedDraft,
      versions: [persistedDraft, active],
    }));
    await renderPage("/brand-center?tab=core", { getCore, updateCoreDraft });

    await userEvent.click(await screen.findByRole("button", { name: "브랜드 코어 수정" }));
    const oneLine = screen.getByRole("textbox", { name: "한 줄 소개" });
    await userEvent.clear(oneLine);
    await userEvent.type(oneLine, "재시도에도 남는 수정");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await userEvent.click(await screen.findByRole("button", { name: "다시 시도" }));

    await waitFor(() => expect(updateCoreDraft).toHaveBeenCalledTimes(2));
    expect(getCore).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("재시도에도 남는 수정")).toBeDisabled();
    expect(screen.queryByText("초안을 저장하지 못했습니다.")).not.toBeInTheDocument();
  });

  it("keeps summary and core usable when operational rules fail independently", async () => {
    const getRules = vi.fn()
      .mockRejectedValueOnce(new Error("rules unavailable"))
      .mockResolvedValueOnce({ active: activeRules, draft: null, versions: [activeRules] });
    const { gateway } = await renderPage("/brand-center?tab=core", { getRules });

    expect(await screen.findByRole("heading", { name: "브랜드 센터" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("브랜드 운영을 단순하게")).toBeDisabled();
    expect(screen.getByText("운영 규칙을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "운영 규칙" })).toBeDisabled();
    await userEvent.click(screen.getByRole("tab", { name: "스타일" }));
    expect(screen.queryByRole("button", { name: "스타일 이미지 수정" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "스타일 정보를 불러올 수 없습니다" }))
      .toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "운영 규칙 다시 시도" }));
    await waitFor(() => expect(getRules).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole("tab", { name: "브랜드 코어" }));
    expect(gateway.getSummary).toHaveBeenCalledTimes(1);
    expect(gateway.getCore).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("운영 규칙을 불러오지 못했습니다.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "운영 규칙" })).toBeEnabled();
  });

  it("confirms AI reanalysis when dirty and clears the local draft before navigating", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderPage("/brand-center?tab=core", {
      getCore: vi.fn(async () => ({
        active,
        draft: persistedDraft,
        versions: [persistedDraft, active],
      })),
    });
    await userEvent.click(await screen.findByRole("button", { name: "브랜드 코어 수정" }));
    const oneLine = screen.getByRole("textbox", { name: "한 줄 소개" });
    await userEvent.clear(oneLine);
    await userEvent.type(oneLine, "재분석 전에 버릴 수정");

    await userEvent.click(screen.getByRole("button", { name: "AI 재분석" }));
    expect(confirm).toHaveBeenCalledWith("저장하지 않은 변경이 있습니다. 재분석을 시작할까요?");
    expect(screen.getByTestId("location")).toHaveTextContent("?tab=core");
    expect(oneLine).toHaveValue("재분석 전에 버릴 수정");

    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "AI 재분석" }));
    expect(screen.getByTestId("location")).toHaveTextContent("?from=brand-center");
    expect(screen.getByRole("textbox", { name: "한 줄 소개" })).toHaveValue("저장된 수정 초안");
  });

  it("approves a dirty draft with the updated token returned by the preceding save", async () => {
    const savedDraft = {
      ...persistedDraft,
      core: {
        ...persistedDraft.core,
        summary: { ...persistedDraft.core.summary, oneLine: "저장 후 즉시 승인" },
      },
      updatedAt: "2026-07-29T03:00:00.000Z",
    };
    const updateCoreDraft = vi.fn(async () => savedDraft);
    const approveCoreDraft = vi.fn(async () => ({
      ...savedDraft,
      status: "approved" as const,
      approvedAt: "2026-07-29T03:01:00.000Z",
    }));
    await renderPage("/brand-center?tab=core", {
      getCore: vi.fn(async () => ({
        active,
        draft: persistedDraft,
        versions: [persistedDraft, active],
      })),
      updateCoreDraft,
      approveCoreDraft,
    });

    await userEvent.click(await screen.findByRole("button", { name: "브랜드 코어 수정" }));
    const oneLine = screen.getByRole("textbox", { name: "한 줄 소개" });
    await userEvent.clear(oneLine);
    await userEvent.type(oneLine, "저장 후 즉시 승인");
    await userEvent.click(screen.getByRole("button", { name: "Brand Core 승인" }));

    await waitFor(() => expect(approveCoreDraft).toHaveBeenCalledWith(
      "brand-1",
      persistedDraft.id,
      savedDraft.updatedAt,
    ));
  });

  it("routes a stale approval to the server-version conflict comparison", async () => {
    const conflict = Object.assign(new Error("conflict"), {
      errorCode: "brand_core_version_conflict",
    });
    const approveCoreDraft = vi.fn(async () => { throw conflict; });
    await renderPage("/brand-center?tab=core", {
      getCore: vi.fn(async () => ({
        active,
        draft: persistedDraft,
        versions: [persistedDraft, active],
      })),
      approveCoreDraft,
    });

    await userEvent.click(await screen.findByRole("button", { name: "브랜드 코어 수정" }));
    await userEvent.click(screen.getByRole("button", { name: "Brand Core 승인" }));

    expect(await screen.findByRole("button", { name: "서버 버전 확인" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  });

  it("clears failed mutation retries when core or rule edits are cancelled", async () => {
    const updateCoreDraft = vi.fn(async () => { throw new Error("save failed"); });
    const saveRuleDraft = vi.fn(async () => { throw new Error("rule save failed"); });
    await renderPage("/brand-center?tab=core", {
      getCore: vi.fn(async () => ({
        active,
        draft: persistedDraft,
        versions: [persistedDraft, active],
      })),
      updateCoreDraft,
      saveRuleDraft,
    });

    await userEvent.click(await screen.findByRole("button", { name: "브랜드 코어 수정" }));
    await userEvent.type(screen.getByRole("textbox", { name: "한 줄 소개" }), " 실패");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("초안을 저장하지 못했습니다.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByText("초안을 저장하지 못했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "운영 규칙" }));
    await userEvent.click(screen.getByRole("button", { name: "규칙 수정" }));
    await userEvent.type(screen.getByRole("textbox", { name: "반드시 포함할 문구" }), "새 규칙");
    await userEvent.click(screen.getByRole("button", { name: "규칙 저장" }));
    expect(await screen.findByText("운영 규칙을 저장하지 못했습니다.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "규칙 취소" }));
    expect(screen.queryByText("운영 규칙을 저장하지 못했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  });

  it("does not let an initial-load retry silently discard edits from successful sections", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const getSummary = vi.fn()
      .mockRejectedValueOnce(new Error("summary unavailable"))
      .mockResolvedValueOnce({
        source: { state: "ready" },
        analysis: { state: "confirmed" },
        brandCore: { state: "draft" },
        rules: { state: "approved" },
        products: { state: "unavailable" },
        wiki: { state: "unavailable" },
        avatars: { state: "unavailable" },
      });
    const getCore = vi.fn(async () => ({
      active,
      draft: persistedDraft,
      versions: [persistedDraft, active],
    }));
    await renderPage("/brand-center?tab=core", { getSummary, getCore });

    await userEvent.click(await screen.findByRole("button", { name: "브랜드 코어 수정" }));
    const oneLine = screen.getByRole("textbox", { name: "한 줄 소개" });
    await userEvent.clear(oneLine);
    await userEvent.type(oneLine, "초기 재시도에도 남는 수정");
    await userEvent.click(screen.getByRole("button", { name: "초기 정보 다시 시도" }));

    expect(confirm).toHaveBeenCalledWith("저장하지 않은 변경이 있습니다. 다시 불러올까요?");
    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(getCore).toHaveBeenCalledTimes(1);
    expect(oneLine).toHaveValue("초기 재시도에도 남는 수정");
  });
});
