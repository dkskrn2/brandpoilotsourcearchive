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

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

async function renderPage(path = "/brand-center?tab=understanding&section=core") {
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
    getRules: vi.fn(async () => ({ active: null, draft: null, versions: [] })),
    createCoreDraft: vi.fn(async () => ({ ...active, id: "draft-1", status: "draft" })),
    updateCoreDraft: vi.fn(),
    approveCoreDraft: vi.fn(),
    saveRuleDraft: vi.fn(),
    approveRules: vi.fn(),
  };
  vi.doMock("../features/brand-center/brandCenterGateway", () => ({
    brandCenterGateway: gateway,
  }));
  vi.doMock("../lib/apiClient", async (importOriginal) => ({
    ...await importOriginal<typeof import("../lib/apiClient")>(),
    DEMO_BRAND_ID: "brand-1",
    api: { listSources: vi.fn(async () => []) },
  }));
  const libraryApi = {
    listProductServices: vi.fn(async () => []),
    getProductService: vi.fn(),
    createProductService: vi.fn(),
    createProductServiceFromAnalysis: vi.fn(),
    updateProductServiceDraft: vi.fn(),
    approveProductService: vi.fn(),
    archiveProductService: vi.fn(),
    listWikiItems: vi.fn(async () => []),
    createWikiItem: vi.fn(),
    updateWikiItem: vi.fn(),
    listWikiIssues: vi.fn(async () => []),
    resolveWikiIssue: vi.fn(),
    listAvatars: vi.fn(async () => []),
    createAvatar: vi.fn(),
    updateAvatar: vi.fn(),
    uploadAvatarImage: vi.fn(),
    deleteAvatarImage: vi.fn(),
    setDefaultAvatar: vi.fn(),
    archiveAvatar: vi.fn(),
  };
  vi.doMock("../features/libraries/libraryGateway", async (importOriginal) => ({
    ...await importOriginal<typeof import("../features/libraries/libraryGateway")>(),
    libraryGateway: libraryApi,
  }));
  const { BrandCenterPage } = await import("../pages/BrandCenterPage");
  render(
    <MemoryRouter initialEntries={[path]}>
      <BrandCenterPage />
      <LocationProbe />
    </MemoryRouter>,
  );
  return { gateway, libraryApi };
}

describe("BrandCenterPage", () => {
  it("shows the approved core and enables the product, Wiki, and avatar libraries", async () => {
    await renderPage();
    expect(await screen.findByRole("heading", { name: "브랜드 센터" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("브랜드 운영을 단순하게")).toBeDisabled();
    expect(screen.getByRole("button", { name: "제품·서비스" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Wiki" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "모델·아바타" })).toBeEnabled();
  });

  it("creates a new draft without replacing the approved version", async () => {
    const { gateway } = await renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "변경 검토" }));
    await waitFor(() => expect(gateway.createCoreDraft).toHaveBeenCalledWith("brand-1", {}));
    expect(screen.getByText("승인된 버전은 유지되고 새 초안에서 변경을 검토합니다.")).toBeInTheDocument();
  });

  it("clears a malformed analysis query without calling the mutation", async () => {
    const { libraryApi } = await renderPage("/brand-center?tab=products&analysis=not-a-uuid");

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("?tab=products"));
    expect(libraryApi.createProductServiceFromAnalysis).not.toHaveBeenCalled();
  });
});
