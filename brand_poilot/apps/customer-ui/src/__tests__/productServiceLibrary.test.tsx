import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
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

const approvedVersion = {
  ...draftVersion,
  id: "version-approved",
  status: "approved" as const,
  approvedAt: "2026-07-27T01:00:00.000Z",
};

const approvedItem = {
  ...draftItem,
  status: "active" as const,
  activeVersionId: approvedVersion.id,
  activeVersion: approvedVersion,
  draft: null,
};

const analysisIdA = "00000000-0000-4000-8000-000000000401";
const analysisIdB = "00000000-0000-4000-8000-000000000402";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

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
  it("keeps an approved item read-only until explicit edit and supports cancel", async () => {
    const onDirtyChange = vi.fn();
    const api = gateway({ listProductServices: vi.fn(async () => [approvedItem]) });
    renderPanel(
      <ProductServiceLibraryPanel
        brandId="brand-1"
        gateway={api as never}
        onDirtyChange={onDirtyChange}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: /콘텐츠 운영/ }));
    expect(screen.getByRole("textbox", { name: "설명" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "수정" }));
    await userEvent.type(screen.getByRole("textbox", { name: "설명" }), " 수정");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("textbox", { name: "설명" })).toHaveValue("초안 설명");
    expect(api.updateProductServiceDraft).not.toHaveBeenCalled();
  });

  it("reopens an approved item with a persisted next draft in view mode", async () => {
    const persistedDraft = {
      ...draftVersion,
      id: "version-persisted-draft",
      version: 2,
      profile: { ...draftVersion.profile, description: "저장된 다음 리비전" },
    };
    const api = gateway({
      listProductServices: vi.fn(async () => [{
        ...approvedItem,
        draft: persistedDraft,
      }]),
    });
    renderPanel(<ProductServiceLibraryPanel brandId="brand-1" gateway={api as never} />);

    await userEvent.click(await screen.findByRole("button", { name: /콘텐츠 운영/ }));
    expect(screen.getByRole("textbox", { name: "설명" })).toHaveValue("저장된 다음 리비전");
    expect(screen.getByRole("textbox", { name: "설명" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "수정" }));
    expect(screen.getByRole("textbox", { name: "설명" })).toBeEnabled();
  });

  it("saves the next draft without changing the active revision, then returns to view before approval", async () => {
    const nextDraft = {
      ...draftVersion,
      id: "version-next-draft",
      version: 2,
      profile: { ...draftVersion.profile, description: "다음 리비전 설명" },
    };
    const savedItem = {
      ...approvedItem,
      activeVersionId: approvedVersion.id,
      activeVersion: approvedVersion,
      draft: nextDraft,
    };
    const approvedNextItem = {
      ...savedItem,
      activeVersionId: nextDraft.id,
      activeVersion: {
        ...nextDraft,
        status: "approved" as const,
        approvedAt: "2026-07-27T02:00:00.000Z",
      },
      draft: null,
    };
    const api = gateway({
      listProductServices: vi.fn(async () => [approvedItem]),
      updateProductServiceDraft: vi.fn(async () => savedItem),
      approveProductService: vi.fn(async () => approvedNextItem),
    });
    renderPanel(<ProductServiceLibraryPanel brandId="brand-1" gateway={api as never} />);

    await userEvent.click(await screen.findByRole("button", { name: /콘텐츠 운영/ }));
    await userEvent.click(screen.getByRole("button", { name: "수정" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "설명" }));
    await userEvent.type(screen.getByRole("textbox", { name: "설명" }), "다음 리비전 설명");
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(api.updateProductServiceDraft).toHaveBeenCalledWith(
      "brand-1",
      approvedItem.id,
      expect.objectContaining({ description: "다음 리비전 설명" }),
    );
    expect(api.approveProductService).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "설명" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "설명" })).toHaveValue("다음 리비전 설명");
    expect(screen.getByRole("button", { name: "수정" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "승인" }));
    expect(api.approveProductService).toHaveBeenCalledWith("brand-1", approvedItem.id);
    expect(await screen.findByText("콘텐츠 사용 가능")).toBeVisible();
  });

  it("blocks approval while a persisted draft has unsaved edits", async () => {
    const api = gateway();
    renderPanel(<ProductServiceLibraryPanel brandId="brand-1" gateway={api as never} />);

    await userEvent.click(await screen.findByRole("button", { name: /콘텐츠 운영/ }));
    await userEvent.type(screen.getByRole("textbox", { name: "설명" }), " 수정");

    expect(screen.getByRole("button", { name: "승인" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "승인" }));
    expect(api.approveProductService).not.toHaveBeenCalled();
  });

  it("renders a list/detail split and only enables content and DM use for approved items", async () => {
    renderPanel(<ProductServiceLibraryPanel brandId="brand-1" gateway={gateway() as never} />);

    await userEvent.click(await screen.findByRole("button", { name: /콘텐츠 운영/ }));
    expect(screen.getByText(draftItem.id)).toBeVisible();
    const usage = screen.getByRole("group", { name: "사용 가능 범위" });
    expect(within(usage).getByText("콘텐츠 사용 불가")).toBeVisible();
    expect(within(usage).getByText("DM 사용 불가")).toBeVisible();
  });

  it("keeps draft-only items visible after the collection reloads", async () => {
    const listProductServices = vi.fn(async () => [draftItem]);
    const api = gateway({ listProductServices });
    const first = renderPanel(
      <ProductServiceLibraryPanel brandId="brand-1" gateway={api as never} />,
    );

    expect(await screen.findByRole("button", { name: /콘텐츠 운영/ })).toBeVisible();
    first.unmount();

    renderPanel(<ProductServiceLibraryPanel brandId="brand-1" gateway={api as never} />);
    expect(await screen.findByRole("button", { name: /콘텐츠 운영/ })).toBeVisible();
    expect(listProductServices).toHaveBeenCalledTimes(2);
  });

  it("does not route product analysis through the retired content-generation wizard", async () => {
    const api = gateway();
    renderPanel(<ProductServiceLibraryPanel brandId="brand-1" gateway={api as never} />);
    await screen.findByRole("button", { name: /콘텐츠 운영/ });

    await userEvent.click(screen.getByRole("button", { name: "새 제품·서비스" }));
    expect(screen.getByRole("button", { name: "AI 분석 준비 중" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "AI 분석 열기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "완료된 분석 ID" })).not.toBeInTheDocument();
    expect(screen.getByText(/제품·서비스 전용 분석 경로를 준비 중입니다/)).toBeVisible();
  });

  it("returns a newly created manual draft to view mode after saving", async () => {
    const api = gateway();
    renderPanel(<ProductServiceLibraryPanel brandId="brand-1" gateway={api as never} />);
    await screen.findByRole("button", { name: /콘텐츠 운영/ });

    await userEvent.click(screen.getByRole("button", { name: "새 제품·서비스" }));
    await userEvent.click(screen.getByRole("button", { name: "AI 없이 직접 입력" }));
    await userEvent.type(screen.getByRole("textbox", { name: "이름" }), "콘텐츠 운영");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(api.createProductService).toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "이름" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "수정" })).toBeVisible();
  });

  it("automatically consumes the completed analysis return, then allows edit and approval", async () => {
    const api = gateway();
    const onAnalysisConsumed = vi.fn();
    renderPanel(<ProductServiceLibraryPanel
      brandId="brand-1"
      gateway={api as never}
      initialAnalysisId={analysisIdA}
      onAnalysisConsumed={onAnalysisConsumed}
    />);

    await waitFor(() => expect(api.createProductServiceFromAnalysis).toHaveBeenCalledWith("brand-1", analysisIdA));
    expect(onAnalysisConsumed).toHaveBeenCalled();
    expect(screen.getByText(draftItem.id)).toBeVisible();
    await userEvent.clear(screen.getByRole("textbox", { name: "설명" }));
    await userEvent.type(screen.getByRole("textbox", { name: "설명" }), "검토 후 수정한 설명");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
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

  it("shows deployment guidance when an older server returns 404 for the list route", async () => {
    const missingRoute = new ApiRequestError({ status: 404, errorCode: null });
    renderPanel(<ProductServiceLibraryPanel
      brandId="brand-1"
      gateway={gateway({ listProductServices: vi.fn(async () => { throw missingRoute; }) }) as never}
    />);

    expect(await screen.findByText(/서버의 제품·서비스 라이브러리 배포가 먼저 필요합니다/)).toBeVisible();
  });

  it("suppresses rapid retries for the same in-flight analysis", async () => {
    const retry = deferred<typeof draftItem>();
    const createProductServiceFromAnalysis = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockImplementationOnce(() => retry.promise);
    const api = gateway({ createProductServiceFromAnalysis });
    renderPanel(<ProductServiceLibraryPanel brandId="brand-1" gateway={api as never} initialAnalysisId={analysisIdA} />);

    const retryButton = await screen.findByRole("button", { name: "다시 시도" });
    await userEvent.click(retryButton);
    expect(retryButton).toBeDisabled();
    await userEvent.click(retryButton);
    expect(createProductServiceFromAnalysis).toHaveBeenCalledTimes(2);
    retry.resolve(draftItem);
  });

  it("ignores a stale late failure after a newer analysis succeeds", async () => {
    const first = deferred<typeof draftItem>();
    const createProductServiceFromAnalysis = vi.fn((_brandId: string, analysisId: string) => (
      analysisId === analysisIdA ? first.promise : Promise.resolve(draftItem)
    ));
    const api = gateway({ createProductServiceFromAnalysis });

    function RaceHarness() {
      const [analysisId, setAnalysisId] = useState(analysisIdA);
      return <>
        <button type="button" onClick={() => setAnalysisId(analysisIdB)}>새 분석으로 전환</button>
        <ProductServiceLibraryPanel brandId="brand-1" gateway={api as never} initialAnalysisId={analysisId} />
      </>;
    }

    renderPanel(<RaceHarness />);
    await waitFor(() => expect(createProductServiceFromAnalysis).toHaveBeenCalledWith("brand-1", analysisIdA));
    await userEvent.click(screen.getByRole("button", { name: "새 분석으로 전환" }));
    await waitFor(() => expect(createProductServiceFromAnalysis).toHaveBeenCalledWith("brand-1", analysisIdB));
    expect(await screen.findByText(draftItem.id)).toBeVisible();

    await act(async () => {
      first.reject(new Error("late failure"));
      await first.promise.catch(() => undefined);
    });
    expect(screen.queryByText(/분석 결과를 가져오지 못했습니다/)).not.toBeInTheDocument();
    expect(createProductServiceFromAnalysis).toHaveBeenCalledTimes(2);
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a pending analysis import that %s after unmount",
    async (outcome) => {
      const pendingImport = deferred<typeof draftItem>();
      const restoreParentUrl = vi.fn();
      const api = gateway({
        createProductServiceFromAnalysis: vi.fn(() => pendingImport.promise),
      });

      const { unmount } = renderPanel(
        <ProductServiceLibraryPanel
          brandId="brand-1"
          gateway={api as never}
          initialAnalysisId={analysisIdA}
          onAnalysisConsumed={restoreParentUrl}
        />,
      );

      await waitFor(() =>
        expect(api.createProductServiceFromAnalysis).toHaveBeenCalledWith("brand-1", analysisIdA),
      );
      unmount();

      await act(async () => {
        if (outcome === "resolve") {
          pendingImport.resolve(draftItem);
        } else {
          pendingImport.reject(new Error("late import failure"));
        }
        await pendingImport.promise.catch(() => undefined);
      });

      expect(restoreParentUrl).not.toHaveBeenCalled();
    },
  );
});
