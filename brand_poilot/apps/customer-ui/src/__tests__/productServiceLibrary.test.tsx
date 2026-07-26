import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiRequestError } from "../lib/apiClient";
import { ProductServiceLibraryPanel } from "../components/brand-center/ProductServiceLibraryPanel";

const draftVersion = {
  id: "version-draft",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  version: 1,
  status: "draft" as const,
  profile: {
    contractVersion: "product-service.v1" as const,
    name: "콘텐츠 운영",
    kind: "service" as const,
    description: "초안 설명",
    features: ["예약"],
    benefits: ["시간 절약"],
    cautions: [],
    audiences: [],
    appealsByTarget: {},
    evergreenPurchaseInfo: "월 구독",
    sourceUrls: ["https://example.com/product"],
  },
  evidence: [],
  sourceAnalysisId: "analysis-1",
  approvedAt: null,
  createdAt: "2026-07-27T00:00:00.000Z",
};

const draftItem = {
  id: "00000000-0000-4000-8000-000000000101",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  kind: "service" as const,
  displayName: "콘텐츠 운영",
  status: "draft" as const,
  activeVersionId: null,
  activeVersion: null,
  draft: draftVersion,
};

afterEach(() => cleanup());

function renderPanel(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function gateway(overrides: Record<string, unknown> = {}) {
  return {
    listProductServices: vi.fn(async () => [draftItem]),
    getProductService: vi.fn(async () => draftItem),
    createProductService: vi.fn(async () => draftItem),
    createProductServiceFromAnalysis: vi.fn(async () => draftItem),
    updateProductServiceDraft: vi.fn(async () => draftItem),
    approveProductService: vi.fn(async () => ({
      ...draftItem,
      status: "active",
      activeVersionId: draftVersion.id,
      activeVersion: { ...draftVersion, status: "approved", approvedAt: "2026-07-27T01:00:00.000Z" },
      draft: null,
    })),
    archiveProductService: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("ProductServiceLibraryPanel", () => {
  it("renders a list/detail split and only enables content and DM use for approved items", async () => {
    renderPanel(<ProductServiceLibraryPanel brandId="brand-1" gateway={gateway() as never} />);

    await userEvent.click(await screen.findByRole("button", { name: /콘텐츠 운영/ }));
    expect(screen.getByText(draftItem.id)).toBeVisible();
    const usage = screen.getByRole("group", { name: "사용 가능 범위" });
    expect(within(usage).getByText("콘텐츠 사용 불가")).toBeVisible();
    expect(within(usage).getByText("DM 사용 불가")).toBeVisible();
  });

  it("imports a real completed analysis, exposes the stable ID, then allows edit and approval", async () => {
    const api = gateway();
    renderPanel(<ProductServiceLibraryPanel brandId="brand-1" gateway={api as never} />);
    await screen.findByRole("button", { name: /콘텐츠 운영/ });

    await userEvent.click(screen.getByRole("button", { name: "새 제품·서비스" }));
    expect(screen.getByRole("link", { name: "AI 분석 열기" })).toHaveAttribute("href", "/ai-content/new");
    await userEvent.type(screen.getByRole("textbox", { name: "완료된 분석 ID" }), "analysis-real");
    await userEvent.click(screen.getByRole("button", { name: "분석 결과로 초안 만들기" }));

    await waitFor(() => expect(api.createProductServiceFromAnalysis).toHaveBeenCalledWith("brand-1", "analysis-real"));
    expect(screen.getByText(draftItem.id)).toBeVisible();
    await userEvent.clear(screen.getByRole("textbox", { name: "설명" }));
    await userEvent.type(screen.getByRole("textbox", { name: "설명" }), "검토 후 수정한 설명");
    await userEvent.click(screen.getByRole("button", { name: "보관함에 저장" }));
    expect(api.updateProductServiceDraft).toHaveBeenCalledWith(
      "brand-1",
      draftItem.id,
      expect.objectContaining({ description: "검토 후 수정한 설명" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "승인" }));
    expect(await screen.findByText("콘텐츠 사용 가능")).toBeVisible();
    expect(screen.getByText("DM 사용 가능")).toBeVisible();
  });

  it("shows deployment-order guidance instead of a generic error when the API is unavailable", async () => {
    const unavailable = new ApiRequestError({
      status: 500,
      errorCode: "product_library_not_configured",
    });
    renderPanel(<ProductServiceLibraryPanel
      brandId="brand-1"
      gateway={gateway({ listProductServices: vi.fn(async () => { throw unavailable; }) }) as never}
    />);

    expect(await screen.findByText(/서버의 제품·서비스 라이브러리 배포가 먼저 필요합니다/)).toBeVisible();
    expect(screen.getByRole("button", { name: "다시 확인" })).toBeVisible();
  });
});
