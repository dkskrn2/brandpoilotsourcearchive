import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as routeModule from "../routes";
import { ReferenceLibraryPage } from "../pages/ReferenceLibraryPage";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import { libraryGateway } from "../features/libraries/libraryGateway";

const originalLibraryGateway = { ...libraryGateway };

const referenceItem = {
  id: "reference-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  kind: "external_url",
  contentPurpose: "informational",
  origin: "example.com",
  title: "실제 크롤링 제목",
  previewUrl: "https://cdn.example.com/og.jpg",
  sourceUrl: "https://example.com/report",
  format: "url",
  metadata: {
    patternAvailable: true,
  },
  favorite: true,
  archivedAt: null,
  referenceBrandId: null,
  createdAt: "2026-07-20T01:00:00.000Z",
  updatedAt: "2026-07-20T01:00:00.000Z",
};
const referenceDetail = {
  ...referenceItem,
  description: "마지막 성공 크롤링에서 보관한 실제 요약",
  body: "실제 추출 본문",
  snapshot: {
    id: "snapshot-1",
    fetchedAt: "2026-07-20T01:30:00.000Z",
    metadata: { ogImage: "https://cdn.example.com/og.jpg" },
  },
};

function installReferenceApi(overrides: Record<string, unknown> = {}) {
  Object.assign(api as unknown as Record<string, unknown>, {
    listReferences: vi.fn(async () => [referenceItem]),
    getReference: vi.fn(async () => referenceDetail),
    setReferenceFavorite: vi.fn(async () => ({ ...referenceItem, favorite: false })),
    archiveReference: vi.fn(async () => undefined),
    getReferencePattern: vi.fn(async () => ({
      observations: ["제목에 문제를 먼저 제시함"],
      interpretation: "문제 중심 구성이 관심을 모은 것으로 해석됩니다.",
      applicationIdeas: ["우리 제품의 실제 고객 질문으로 시작"],
      doNotCopy: ["원문의 문장과 고유한 비유"],
      confidence: 0.72,
      analysisVersion: "v1",
      updatedAt: "2026-07-20T02:00:00.000Z",
    })),
    addReferenceUrl: vi.fn(async () => referenceItem),
    listReferenceBrands: vi.fn(async () => []),
    listReferenceBrandItems: vi.fn(async () => []),
    createReferenceBrand: vi.fn(async () => undefined),
    ...overrides,
  });
  return api as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="location">{location.pathname}{location.search}</output>;
}

function renderRedirect(
  initialEntry: string,
  componentName: "LegacyInstagramTrendsRedirect" | "LegacyArchiveRedirect" | "LegacySourcesRedirect",
) {
  const Redirect = (routeModule as unknown as Record<string, React.ComponentType>)[componentName];
  expect(Redirect, `${componentName} export`).toBeTypeOf("function");
  if (!Redirect) return;
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/instagram-trends" element={<Redirect />} />
        <Route path="/archive" element={<Redirect />} />
        <Route path="/sources" element={<Redirect />} />
        <Route path="/references" element={<LocationProbe />} />
        <Route path="/brand-center" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.assign(libraryGateway, originalLibraryGateway);
});

describe("ReferenceLibraryPage", () => {
  it("uses the fixed view keys and customer labels", () => {
    render(<MemoryRouter initialEntries={["/references"]}><ReferenceLibraryPage /></MemoryRouter>);

    const expected = [
      ["전체", "all"],
      ["저장한 브랜드", "saved-brands"],
      ["저장한 콘텐츠", "saved-content"],
      ["트렌드 탐색", "trends"],
      ["저장한 트렌드", "saved-trends"],
      ["외부 URL", "external-urls"],
      ["최근 사용", "recent"],
      ["즐겨찾기", "favorites"],
      ["직접 추가", "add"],
    ];
    for (const [label, view] of expected) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", `/references?view=${view}`);
    }
  });

  it("embeds reusable trend panels without a Reel creation action", () => {
    const first = render(
      <MemoryRouter initialEntries={["/references?view=trends"]}><ReferenceLibraryPage /></MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Instagram 트렌드 탐색" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Reel 만들기/ })).not.toBeInTheDocument();
    first.unmount();

    render(
      <MemoryRouter initialEntries={["/references?view=saved-trends"]}><ReferenceLibraryPage /></MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "저장한 트렌드" })).toBeVisible();
  });

  it("applies preserved archive pagination and trend filters in the canonical panels", async () => {
    const listInstagramTrendArchive = vi.fn(async () => ({ items: [], page: 2, limit: 30, total: 0 }));
    installReferenceApi({ listInstagramTrendArchive });
    const archiveRender = render(
      <MemoryRouter initialEntries={["/references?view=saved-trends&page=2"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("저장한 트렌드가 없습니다.")).toBeVisible();
    expect(listInstagramTrendArchive).toHaveBeenCalledWith(DEMO_BRAND_ID, { page: 2, limit: 30 });
    archiveRender.unmount();

    installReferenceApi({
      listChannels: vi.fn(async () => [{
        type: "instagram", label: "Instagram", enabled: true, oauthState: "connected",
        status: "connected", accountLabel: "@brand", lastHealthyAt: null, lastPublishedAt: null,
      }]),
      listContentCategories: vi.fn(async () => []),
      getBrandProfile: vi.fn(async () => null),
      getInstagramTrendConnection: vi.fn(async () => ({
        status: "connected", accountLabel: "@brand", instagramBusinessAccountId: "ig-1",
        scopes: [], expiresAt: null, lastErrorCode: null,
      })),
      listInstagramTrendSearches: vi.fn(async () => []),
    });
    render(
      <MemoryRouter initialEntries={["/references?view=trends&type=reel&sort=comments"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: "릴스" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "정렬" })).toHaveValue("comments");
  });

  it("renders only real reference metadata and lazily loads stored pattern detail", async () => {
    const referenceApi = installReferenceApi();
    render(<MemoryRouter initialEntries={["/references?view=all"]}><ReferenceLibraryPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "실제 크롤링 제목" })).toBeVisible();
    const cardContent = screen.getByRole("button", { name: "실제 크롤링 제목 상세 보기" });
    expect(screen.getByText("example.com")).toBeVisible();
    expect(screen.getByText("URL")).toBeVisible();
    expect(within(cardContent).getByText("정보성")).toBeVisible();
    expect(screen.getByText("패턴 있음")).toBeVisible();
    expect(screen.getByRole("img", { name: "실제 크롤링 제목 미리보기" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/og.jpg",
    );
    expect(screen.queryByText("마지막 성공 크롤링에서 보관한 실제 요약")).not.toBeInTheDocument();
    expect(referenceApi.getReference).not.toHaveBeenCalled();
    expect(referenceApi.getReferencePattern).not.toHaveBeenCalled();

    const card = cardContent;
    await userEvent.click(card);

    expect(await screen.findByRole("dialog", { name: "레퍼런스 상세" })).toBeVisible();
    expect(screen.getByText("마지막 성공 크롤링에서 보관한 실제 요약")).toBeVisible();
    expect(referenceApi.getReference).toHaveBeenCalledWith(DEMO_BRAND_ID, "reference-1");
    expect(await screen.findByRole("heading", { name: "관찰 사실" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "AI 해석" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "우리 브랜드 적용" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "모방하지 않을 요소" })).toBeVisible();
    expect(screen.getByRole("link", { name: "원본 보기" })).toHaveAttribute("href", referenceItem.sourceUrl);
    expect(screen.queryByRole("button", { name: /콘텐츠로 사용/ })).not.toBeInTheDocument();
    expect(referenceApi.getReferencePattern).toHaveBeenCalledWith(DEMO_BRAND_ID, "reference-1");

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(card).toHaveFocus();
  });

  it("requires a content purpose when adding an external URL", async () => {
    const referenceApi = installReferenceApi({ listReferences: vi.fn(async () => []) });
    render(
      <MemoryRouter initialEntries={["/references?view=external-urls"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByRole("textbox", { name: "외부 URL" }), "https://example.com/new");
    await userEvent.click(screen.getByRole("button", { name: "URL 추가" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("용도를 선택해 주세요");
    expect(referenceApi.addReferenceUrl).not.toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "콘텐츠 용도" }), "marketing");
    await userEvent.click(screen.getByRole("button", { name: "URL 추가" }));
    expect(referenceApi.addReferenceUrl).toHaveBeenCalledWith(DEMO_BRAND_ID, {
      url: "https://example.com/new",
      title: "",
      contentPurpose: "marketing",
    });
  });

  it("filters, opens, and archives external URL references through the reference API", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const marketingItem = {
      ...referenceItem,
      id: "reference-2",
      title: "마케팅 사례",
      sourceUrl: "https://example.com/campaign",
      contentPurpose: "marketing",
    };
    const referenceApi = installReferenceApi({
      listReferences: vi.fn(async () => [referenceItem, marketingItem]),
      archiveReference: vi.fn(async () => undefined),
    });
    render(
      <MemoryRouter initialEntries={["/references?view=external-urls"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "실제 크롤링 제목" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "마케팅 사례" })).toBeVisible();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "외부 URL 용도 필터" }), "informational");
    expect(screen.queryByRole("heading", { name: "마케팅 사례" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "실제 크롤링 제목 상세 보기" }));
    expect(await screen.findByText("마지막 성공 크롤링에서 보관한 실제 요약")).toBeVisible();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: "실제 크롤링 제목 삭제" }));
    expect(referenceApi.archiveReference).toHaveBeenCalledWith(DEMO_BRAND_ID, "reference-1");
    expect(screen.queryByRole("heading", { name: "실제 크롤링 제목" })).not.toBeInTheDocument();
  });

  it("shows only saved public brands and groups their actual saved items in a lazy dialog", async () => {
    const referenceApi = installReferenceApi({
      listReferenceBrands: vi.fn(async () => [{
        id: "brand-ref-1",
        workspaceId: "workspace-1",
        brandId: "brand-1",
        platform: "instagram",
        handle: "actual_author",
        displayName: "Actual Author",
        publicSourceUrl: "https://www.instagram.com/actual_author/",
        profileSnapshot: { capturedAt: "2026-07-19T00:00:00.000Z" },
        previewUrl: null,
      }]),
      listReferenceBrandItems: vi.fn(async () => [{
        ...referenceItem,
        id: "saved-content-1",
        kind: "saved_content",
        title: "실제로 저장한 콘텐츠",
        referenceBrandId: "brand-ref-1",
      }]),
    });
    render(
      <MemoryRouter initialEntries={["/references?view=saved-brands"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );

    const brandButton = await screen.findByRole("button", { name: "Actual Author 상세 보기" });
    expect(brandButton).toBeVisible();
    expect(referenceApi.listReferenceBrandItems).not.toHaveBeenCalled();
    await userEvent.click(brandButton);
    expect(await screen.findByText("실제로 저장한 콘텐츠")).toBeVisible();
    expect(referenceApi.listReferenceBrandItems).toHaveBeenCalledWith(DEMO_BRAND_ID, "brand-ref-1");
    expect(screen.getByRole("link", { name: "공개 프로필 원본 보기" })).toHaveAttribute(
      "href",
      "https://www.instagram.com/actual_author/",
    );
    const itemButton = screen.getByRole("button", { name: "실제로 저장한 콘텐츠 상세 보기" });
    await userEvent.click(itemButton);
    expect(await screen.findByRole("dialog", { name: "레퍼런스 상세" })).toBeVisible();
    expect(referenceApi.getReference).toHaveBeenCalledWith(DEMO_BRAND_ID, "saved-content-1");
    await userEvent.keyboard("{Escape}");
    expect(itemButton).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Actual Author" })).not.toBeInTheDocument();
    expect(brandButton).toHaveFocus();
  });

  it("always shows favorite state on read-only reference cards", async () => {
    installReferenceApi();
    render(
      <MemoryRouter initialEntries={["/references?view=external-urls"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("즐겨찾기됨")).toBeVisible();
  });

  it("uploads supported files with real metadata and rejects duplicate bytes", async () => {
    const uploadedReference = {
      ...referenceItem,
      id: "upload-1",
      kind: "upload",
      title: "evidence.png",
      previewUrl: "https://store.blob.vercel-storage.com/evidence.png",
      sourceUrl: "https://store.blob.vercel-storage.com/evidence.png",
      format: "image/png",
      metadata: {
        patternAvailable: false,
        fileName: "evidence.png",
        mimeType: "image/png",
        sizeBytes: 5,
      },
      favorite: false,
    };
    installReferenceApi({ listReferences: vi.fn(async () => []) });
    const hashReferenceFile = vi.fn(async () => "same-checksum");
    const uploadReferenceFile = vi.fn(async (_brandId, _file, options) => {
      options.onSession?.("session-1");
      options.onProgress?.(60);
      options.onProgress?.(100);
      return { sessionId: "session-1", reference: uploadedReference };
    });
    Object.assign(libraryGateway, {
      hashReferenceFile,
      uploadReferenceFile,
      cancelReferenceUpload: vi.fn(async () => ({
        status: "cleanup_pending",
        immediateCleanup: "succeeded",
      })),
    });
    render(
      <MemoryRouter initialEntries={["/references?view=add"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );
    const launch = screen.getByRole("button", { name: "파일 업로드" });
    await userEvent.click(launch);
    expect(screen.getByRole("dialog", { name: "레퍼런스 파일 업로드" })).toBeVisible();
    const first = new File(["image"], "evidence.png", { type: "image/png" });
    const duplicate = new File(["image"], "copy.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("레퍼런스 파일 선택"), [first, duplicate]);
    await waitFor(() => expect(hashReferenceFile).toHaveBeenCalledTimes(2));
    expect(uploadReferenceFile).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "업로드 확인" }));

    expect(await screen.findByRole("img", { name: "evidence.png 미리보기" })).toHaveAttribute(
      "src",
      uploadedReference.previewUrl,
    );
    expect(screen.getByText("image/png · 5 B")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("내용이 같은 파일");
    expect(uploadReferenceFile).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog", { name: "레퍼런스 파일 업로드" })).not.toBeInTheDocument();
    expect(launch).toHaveFocus();
  });

  it("cancels an unconsumed session before retrying a failed upload", async () => {
    installReferenceApi({ listReferences: vi.fn(async () => []) });
    const uploadedReference = {
      ...referenceItem,
      id: "upload-retry",
      kind: "upload",
      title: "retry.pdf",
      format: "application/pdf",
      previewUrl: null,
      metadata: { patternAvailable: false, fileName: "retry.pdf", mimeType: "application/pdf", sizeBytes: 5 },
      favorite: false,
    };
    const uploadReferenceFile = vi.fn()
      .mockImplementationOnce(async (_brandId, _file, options) => {
        options.onSession?.("failed-session");
        throw new Error("transfer_failed");
      })
      .mockResolvedValueOnce({ sessionId: "new-session", reference: uploadedReference });
    const cancelReferenceUpload = vi.fn(async () => ({
      status: "cleanup_pending",
      immediateCleanup: "succeeded",
    }));
    Object.assign(libraryGateway, {
      hashReferenceFile: vi.fn(async () => "retry-checksum"),
      uploadReferenceFile,
      cancelReferenceUpload,
    });
    render(
      <MemoryRouter initialEntries={["/references?view=add"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "파일 업로드" }));
    await userEvent.upload(
      screen.getByLabelText("레퍼런스 파일 선택"),
      new File(["brief"], "retry.pdf", { type: "application/pdf" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "업로드 확인" }));
    await userEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
    expect(cancelReferenceUpload).toHaveBeenCalledWith(DEMO_BRAND_ID, "failed-session");
    expect(await screen.findByText("업로드 완료")).toBeVisible();
  });

  it("cancels an in-flight reference reservation when removed", async () => {
    installReferenceApi({ listReferences: vi.fn(async () => []) });
    let exposeSession!: () => void;
    const sessionReady = new Promise<void>((resolve) => { exposeSession = resolve; });
    const uploadReferenceFile = vi.fn(async (_brandId, _file, options) => {
      options.onSession?.("pending-session");
      exposeSession();
      return new Promise(() => undefined);
    });
    const cancelReferenceUpload = vi.fn(async () => ({
      status: "cleanup_pending",
      immediateCleanup: "succeeded",
    }));
    Object.assign(libraryGateway, {
      hashReferenceFile: vi.fn(async () => "pending-checksum"),
      uploadReferenceFile,
      cancelReferenceUpload,
    });
    render(
      <MemoryRouter initialEntries={["/references?view=add"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "파일 업로드" }));
    await userEvent.upload(
      screen.getByLabelText("레퍼런스 파일 선택"),
      new File(["brief"], "pending.pdf", { type: "application/pdf" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "업로드 확인" }));
    await sessionReady;
    await userEvent.click(screen.getByRole("button", { name: "pending.pdf 제거" }));
    await waitFor(() => {
      expect(cancelReferenceUpload).toHaveBeenCalledWith(DEMO_BRAND_ID, "pending-session");
    });
    expect(screen.queryByLabelText("pending.pdf 파일")).not.toBeInTheDocument();
  });

  it("cancels an in-flight reference reservation when the add view closes", async () => {
    installReferenceApi({ listReferences: vi.fn(async () => []) });
    let exposeSession!: () => void;
    const sessionReady = new Promise<void>((resolve) => { exposeSession = resolve; });
    const cancelReferenceUpload = vi.fn(async () => ({
      status: "cleanup_pending",
      immediateCleanup: "succeeded",
    }));
    Object.assign(libraryGateway, {
      hashReferenceFile: vi.fn(async () => "unmount-checksum"),
      uploadReferenceFile: vi.fn(async (_brandId, _file, options) => {
        options.onSession?.("unmount-session");
        exposeSession();
        return new Promise(() => undefined);
      }),
      cancelReferenceUpload,
    });
    const rendered = render(
      <MemoryRouter initialEntries={["/references?view=add"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "파일 업로드" }));
    await userEvent.upload(
      screen.getByLabelText("레퍼런스 파일 선택"),
      new File(["brief"], "unmount.pdf", { type: "application/pdf" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "업로드 확인" }));
    await sessionReady;
    rendered.unmount();
    await waitFor(() => {
      expect(cancelReferenceUpload).toHaveBeenCalledWith(DEMO_BRAND_ID, "unmount-session");
    });
  });

  it("adds a saved brand only from an explicit public Instagram handle or profile URL", async () => {
    const created = {
      id: "brand-ref-2",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      platform: "instagram",
      handle: "public_author",
      displayName: "public_author",
      publicSourceUrl: "https://www.instagram.com/public_author/",
      profileSnapshot: {},
      previewUrl: null,
    };
    const referenceApi = installReferenceApi({
      listReferenceBrands: vi.fn(async () => []),
      createReferenceBrand: vi.fn(async () => created),
    });
    render(
      <MemoryRouter initialEntries={["/references?view=saved-brands"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/공개 Instagram 프로필 URL 또는 handle/)).toBeVisible();
    await userEvent.type(screen.getByRole("textbox", { name: "공개 Instagram 프로필" }), "@public_author");
    await userEvent.click(screen.getByRole("button", { name: "브랜드 저장" }));

    expect(referenceApi.createReferenceBrand).toHaveBeenCalledWith(DEMO_BRAND_ID, {
      platform: "instagram",
      handle: "public_author",
      publicSourceUrl: "",
    });
    expect(await screen.findByRole("button", { name: "public_author 상세 보기" })).toBeVisible();
    expect(screen.queryByText(/광고 DB|상시 모니터링/)).not.toBeInTheDocument();
  });

  it("preserves OAuth and filter query when redirecting the legacy trend route", () => {
    renderRedirect(
      "/instagram-trends?meta_trends=connected&type=reel&sort=comments",
      "LegacyInstagramTrendsRedirect",
    );
    expect(screen.getByLabelText("location")).toHaveTextContent(
      "/references?meta_trends=connected&type=reel&sort=comments&view=trends",
    );
  });

  it("preserves archive pagination and filters in the saved-trends redirect", () => {
    renderRedirect("/archive?page=2&format=reel", "LegacyArchiveRedirect");
    expect(screen.getByLabelText("location")).toHaveTextContent(
      "/references?page=2&format=reel&view=saved-trends",
    );
  });

  it("routes legacy source URLs by ownership and preserves non-conflicting query", () => {
    renderRedirect("/sources?tab=reference&page=2", "LegacySourcesRedirect");
    expect(screen.getByLabelText("location")).toHaveTextContent(
      "/references?page=2&view=external-urls",
    );
    cleanup();

    renderRedirect("/sources?tab=queue&status=failed", "LegacySourcesRedirect");
    expect(screen.getByLabelText("location")).toHaveTextContent(
      "/brand-center?status=failed&tab=understanding&section=sources",
    );
  });
});
