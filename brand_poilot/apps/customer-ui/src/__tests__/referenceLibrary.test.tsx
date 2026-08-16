import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as routeModule from "../routes";
import { ReferenceAddMenu } from "../components/references/ReferenceAddMenu";
import { ReferenceLibraryPage } from "../pages/ReferenceLibraryPage";
import { aiContentApiGateway } from "../features/ai-content/aiContentApiGateway";
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
    listReferenceChannelMedia: vi.fn(async () => ({ items: [], total: 0, refreshedAt: null, cacheState: "pending" })),
    resolveReferenceChannel: vi.fn(async () => undefined),
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
  it("opens Trend discovery first when the URL has no explicit legacy view", () => {
    installReferenceApi();
    render(<MemoryRouter initialEntries={["/references"]}><ReferenceLibraryPage /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "트렌드 찾기" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 2, name: "Instagram 트렌드 탐색" })).toBeVisible();
  });

  it("groups reference destinations into three workspaces and library filters", () => {
    render(
      <MemoryRouter initialEntries={["/references?view=all"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );

    const workspaces = within(screen.getByRole("navigation", { name: "레퍼런스 작업 공간" }));
    expect(workspaces.getAllByRole("link")).toHaveLength(3);
    expect(workspaces.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "트렌드 찾기",
      "내 라이브러리",
      "브랜드·작성자",
    ]);
    expect(workspaces.getByRole("link", { name: "내 라이브러리" })).toHaveAttribute(
      "href",
      "/references?view=all",
    );
    expect(workspaces.getByRole("link", { name: "트렌드 찾기" })).toHaveAttribute(
      "href",
      "/references?view=trends",
    );
    expect(workspaces.getByRole("link", { name: "브랜드·작성자" })).toHaveAttribute(
      "href",
      "/references?view=saved-brands",
    );
    expect(workspaces.getByRole("link", { name: "내 라이브러리" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const filters = within(screen.getByRole("navigation", { name: "내 라이브러리 필터" }));
    expect(filters.getAllByRole("link")).toHaveLength(3);
    expect(filters.getByRole("link", { name: "전체" })).toHaveAttribute("href", "/references?view=all");
    expect(filters.getByRole("link", { name: "콘텐츠" })).toHaveAttribute(
      "href",
      "/references?view=saved-content",
    );
    expect(filters.getByRole("link", { name: "트렌드" })).toHaveAttribute(
      "href",
      "/references?view=saved-trends",
    );
    expect(filters.queryByRole("link", { name: "외부 URL" })).not.toBeInTheDocument();
    expect(filters.queryByRole("link", { name: "최근 추가" })).not.toBeInTheDocument();
    expect(filters.queryByRole("link", { name: "즐겨찾기" })).not.toBeInTheDocument();
  });

  it.each([
    ["all", "전체 레퍼런스", { collection: "all" }],
    ["saved-content", "저장한 콘텐츠", { collection: "content" }],
    ["saved-trends", "저장한 트렌드", { collection: "trend" }],
    ["recent", "최근 추가한 자료", { recent: 30 }],
    ["favorites", "즐겨찾기", { favorite: true }],
  ] as const)("shows the contextual Library heading for view=%s", async (view, heading, filters) => {
    const listReferences = vi.fn(async () => []);
    installReferenceApi({ listReferences });
    const rendered = render(
      <MemoryRouter initialEntries={[`/references?view=${view}`]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    expect(screen.getByText(/출처 정보/)).toBeVisible();
    expect(screen.queryByText(/metadata/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(listReferences).toHaveBeenCalledWith(DEMO_BRAND_ID, filters);
    });

    rendered.unmount();
  });

  it("searches each saved Library collection and keeps the query between its three filters", async () => {
    const listReferences = vi.fn(async () => []);
    installReferenceApi({ listReferences });
    render(
      <MemoryRouter initialEntries={["/references?view=saved-content&q=%EC%97%AC%EB%A6%84+%EB%A3%A8%ED%8B%B4"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("searchbox", { name: "내 라이브러리 검색" })).toHaveValue("여름 루틴");
    expect(screen.getByRole("link", { name: "전체" })).toHaveAttribute(
      "href",
      "/references?view=all&q=%EC%97%AC%EB%A6%84+%EB%A3%A8%ED%8B%B4",
    );
    expect(screen.getByRole("link", { name: "트렌드" })).toHaveAttribute(
      "href",
      "/references?view=saved-trends&q=%EC%97%AC%EB%A6%84+%EB%A3%A8%ED%8B%B4",
    );
    await waitFor(() => {
      expect(listReferences).toHaveBeenCalledWith(DEMO_BRAND_ID, {
        collection: "content",
        q: "여름 루틴",
      });
    });
  });

  it.each(["external-urls", "recent", "favorites"])(
    "does not show the three-collection search on the hidden legacy view=%s",
    async (view) => {
      installReferenceApi({ listReferences: vi.fn(async () => []) });
      const rendered = render(
        <MemoryRouter initialEntries={[`/references?view=${view}&q=legacy`] }>
          <ReferenceLibraryPage />
        </MemoryRouter>,
      );

      expect(screen.queryByRole("searchbox", { name: "내 라이브러리 검색" })).not.toBeInTheDocument();
      rendered.unmount();
    },
  );

  it("offers URL and file acquisition from one page action", async () => {
    installReferenceApi({ listReferences: vi.fn(async () => []) });
    render(
      <MemoryRouter initialEntries={["/references?view=all"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole("button", { name: "자료 추가" });
    await userEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "자료 추가" });
    expect(within(menu).getByRole("menuitem", { name: "외부 URL 추가" })).toHaveAttribute(
      "href",
      "/references?view=external-urls",
    );
    await userEvent.click(within(menu).getByRole("menuitem", { name: "파일 업로드" }));
    expect(screen.queryByRole("menu", { name: "자료 추가" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "레퍼런스 파일 업로드" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(trigger).toHaveFocus();
  });

  it("closes the add menu with Escape and restores trigger focus", async () => {
    installReferenceApi({ listReferences: vi.fn(async () => []) });
    render(
      <MemoryRouter initialEntries={["/references"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole("button", { name: "자료 추가" });
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "자료 추가" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes an open add menu when its trigger is clicked again", async () => {
    render(
      <MemoryRouter>
        <ReferenceAddMenu onUpload={vi.fn()} />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole("button", { name: "자료 추가" });
    await userEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "자료 추가" })).toBeVisible();
    await userEvent.click(trigger);
    expect(screen.queryByRole("menu", { name: "자료 추가" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it.each([
    { key: "{ArrowDown}", item: "외부 URL 추가" },
    { key: "{ArrowUp}", item: "파일 업로드" },
  ])("opens the add menu from its trigger with $key and focuses $item", async ({ key, item }) => {
    render(
      <MemoryRouter>
        <ReferenceAddMenu onUpload={vi.fn()} />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole("button", { name: "자료 추가" });
    trigger.focus();
    await userEvent.keyboard(key);

    const menu = screen.getByRole("menu", { name: "자료 추가" });
    expect(within(menu).getByRole("menuitem", { name: item })).toHaveFocus();
  });

  it("moves add menu focus with arrow keys and wraps", async () => {
    render(
      <MemoryRouter>
        <ReferenceAddMenu onUpload={vi.fn()} />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "자료 추가" }));
    const first = screen.getByRole("menuitem", { name: "외부 URL 추가" });
    const last = screen.getByRole("menuitem", { name: "파일 업로드" });
    expect(first).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    expect(last).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(first).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(last).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(first).toHaveFocus();
  });

  it("moves add menu focus to its Home and End boundaries", async () => {
    render(
      <MemoryRouter>
        <ReferenceAddMenu onUpload={vi.fn()} />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: "자료 추가" }));
    const first = screen.getByRole("menuitem", { name: "외부 URL 추가" });
    const last = screen.getByRole("menuitem", { name: "파일 업로드" });

    await userEvent.keyboard("{End}");
    expect(last).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(first).toHaveFocus();
  });

  it.each([
    { direction: "forward", shift: false, target: "다음" },
    { direction: "backward", shift: true, target: "자료 추가" },
  ])("closes the add menu on Tab without blocking $direction focus movement", async ({ shift, target }) => {
    render(
      <MemoryRouter>
        <button type="button">이전</button>
        <ReferenceAddMenu onUpload={vi.fn()} />
        <button type="button">다음</button>
      </MemoryRouter>,
    );

    const trigger = screen.getByRole("button", { name: "자료 추가" });
    await userEvent.click(trigger);
    await userEvent.tab({ shift });
    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "자료 추가" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: target })).toHaveFocus();
  });

  it("closes the add menu after outside interaction and URL selection", async () => {
    installReferenceApi({ listReferences: vi.fn(async () => []) });
    render(
      <MemoryRouter initialEntries={["/references?view=all"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole("button", { name: "자료 추가" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("heading", { name: "레퍼런스" }));
    expect(screen.queryByRole("menu", { name: "자료 추가" })).not.toBeInTheDocument();

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("menuitem", { name: "외부 URL 추가" }));
    expect(screen.queryByRole("menu", { name: "자료 추가" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "외부 URL" })).toBeVisible();
  });

  it("opens upload when navigation later reaches the legacy add view", async () => {
    installReferenceApi({ listReferences: vi.fn(async () => []) });
    render(
      <MemoryRouter initialEntries={["/references?view=all"]}>
        <Link to="/references?view=add">legacy add</Link>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("dialog", { name: "레퍼런스 파일 업로드" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "legacy add" }));
    expect(await screen.findByRole("dialog", { name: "레퍼런스 파일 업로드" })).toBeVisible();
  });

  it("closes legacy add upload when navigating to the all view", async () => {
    installReferenceApi({ listReferences: vi.fn(async () => []) });
    render(
      <MemoryRouter initialEntries={["/references?view=add"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("dialog", { name: "레퍼런스 파일 업로드" })).toBeVisible();
    await userEvent.click(screen.getByRole("link", { name: "내 라이브러리" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "레퍼런스 파일 업로드" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "전체 레퍼런스" })).toBeVisible();
  });

  it("maps the legacy add view to the Library and opens upload directly", () => {
    installReferenceApi({ listReferences: vi.fn(async () => []) });
    render(
      <MemoryRouter initialEntries={["/references?view=add"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "내 라이브러리" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const filters = within(screen.getByRole("navigation", { name: "내 라이브러리 필터" }));
    expect(filters.getByRole("link", { name: "전체" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "전체 레퍼런스" })).toBeVisible();
    expect(screen.getByRole("dialog", { name: "레퍼런스 파일 업로드" })).toBeVisible();
  });

  it("embeds reusable trend panels without a Reel creation action", () => {
    const first = render(
      <MemoryRouter initialEntries={["/references?view=trends"]}><ReferenceLibraryPage /></MemoryRouter>,
    );
    expect(screen.queryByRole("navigation", { name: "내 라이브러리 필터" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "트렌드 찾기" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByText("Instagram 공개 콘텐츠").some((node) => node.classList.contains("reference-source-label"))).toBe(true);
    expect(screen.getByRole("heading", { level: 2, name: "Instagram 트렌드 탐색" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Reel 만들기/ })).not.toBeInTheDocument();
    first.unmount();

    render(
      <MemoryRouter initialEntries={["/references?view=saved-trends"]}><ReferenceLibraryPage /></MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "저장한 트렌드" })).toBeVisible();
  });

  it("keeps the legacy saved-trends URL on the searchable Library collection", async () => {
    const listReferences = vi.fn(async () => []);
    installReferenceApi({ listReferences });
    const archiveRender = render(
      <MemoryRouter initialEntries={["/references?view=saved-trends&page=2"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("조건에 맞는 레퍼런스가 없습니다")).toBeVisible();
    expect(listReferences).toHaveBeenCalledWith(DEMO_BRAND_ID, { collection: "trend" });
    archiveRender.unmount();

  });

  it("applies preserved trend filters in the discovery panel", async () => {

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
    vi.spyOn(aiContentApiGateway, "listDraftReferences").mockResolvedValue([]);
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
    await userEvent.click(await screen.findByRole("button", { name: "보관 계속" }));
    expect(referenceApi.archiveReference).toHaveBeenCalledWith(DEMO_BRAND_ID, "reference-1");
    expect(screen.queryByRole("heading", { name: "실제 크롤링 제목" })).not.toBeInTheDocument();
  });

  it("does not archive an external reference when draft-reference lookup fails and retries explicitly", async () => {
    const lookup = vi.spyOn(aiContentApiGateway, "listDraftReferences")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([{
        assetType: "reference",
        assetId: "reference-1",
        generationId: "generation-1",
        title: "진행 중 캠페인",
      }]);
    const referenceApi = installReferenceApi({
      listReferences: vi.fn(async () => [referenceItem]),
      archiveReference: vi.fn(async () => undefined),
    });
    render(
      <MemoryRouter initialEntries={["/references?view=external-urls"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "실제 크롤링 제목 삭제" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("조회하지 못해 보관을 중단");
    expect(referenceApi.archiveReference).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "참조 다시 조회" }));
    expect(await screen.findByText("진행 중 캠페인")).toBeVisible();
    expect(lookup).toHaveBeenCalledTimes(2);
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

    expect(screen.queryByRole("navigation", { name: "내 라이브러리 필터" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "브랜드·작성자" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 2, name: "브랜드·작성자" })).toBeVisible();
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
    expect(screen.getByRole("dialog", { name: "레퍼런스 파일 업로드" })).toBeVisible();
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
    expect(screen.getByRole("dialog", { name: "레퍼런스 파일 업로드" })).toBeVisible();
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
    expect(screen.getByRole("dialog", { name: "레퍼런스 파일 업로드" })).toBeVisible();
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
      resolveReferenceChannel: vi.fn(async () => created),
    });
    render(
      <MemoryRouter initialEntries={["/references?view=saved-brands"]}>
        <ReferenceLibraryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/공개 Instagram Business 또는 Creator 채널/)).toBeVisible();
    await userEvent.type(screen.getByRole("textbox", { name: "공개 Instagram 프로필" }), "@public_author");
    await userEvent.click(screen.getByRole("button", { name: "브랜드 저장" }));

    expect(referenceApi.resolveReferenceChannel).toHaveBeenCalledWith(DEMO_BRAND_ID, "@public_author");
    expect(await screen.findByRole("button", { name: "public_author 상세 보기" })).toBeVisible();
    expect(screen.queryByText(/광고 DB|상시 모니터링/)).not.toBeInTheDocument();
  });

  it("shows cached channel content and stores only media explicitly bookmarked by the user", async () => {
    const channel = {
      id: "brand-ref-1", workspaceId: "workspace-1", brandId: "brand-1", platform: "instagram",
      handle: "actual_author", displayName: "Actual Author",
      publicSourceUrl: "https://www.instagram.com/actual_author/", profileSnapshot: {}, previewUrl: null,
      providerAccountId: "ig-user-1", cacheState: "fresh", refreshedAt: "2026-08-13T03:00:00.000Z",
      lastRefreshAttemptedAt: "2026-08-13T03:00:00.000Z", lastRefreshError: null,
    };
    const cachedMedia = {
      id: "media-1", instagramMediaId: "ig-media-1", username: "actual_author",
      caption: "채널 캐시 콘텐츠", kind: "reel" as const,
      mediaUrl: null, previewUrl: null, permalink: "https://www.instagram.com/reel/example/",
      postedAt: "2026-08-12T00:00:00.000Z", likeCount: 32, commentsCount: 4,
      metaRank: 0, refreshedAt: "2026-08-13T03:00:00.000Z", isSaved: false,
      sourcePlatform: "instagram", author: { referenceBrandId: channel.id, handle: channel.handle, displayName: channel.displayName },
      metrics: { viewCount: 1200, likeCount: 32, commentsCount: 4 },
    };
    const referenceApi = installReferenceApi({
      listReferenceBrands: vi.fn(async () => [channel]),
      listReferenceChannelMedia: vi.fn(async () => ({
        items: [cachedMedia], total: 1, refreshedAt: channel.refreshedAt, cacheState: "fresh",
      })),
      listReferenceBrandItems: vi.fn(async () => []),
      saveInstagramTrendSource: vi.fn(async () => ({ alreadySaved: false })),
    });
    render(<MemoryRouter initialEntries={["/references?view=saved-brands"]}><ReferenceLibraryPage /></MemoryRouter>);

    await userEvent.click(await screen.findByRole("button", { name: "Actual Author 상세 보기" }));
    expect(await screen.findByText("채널 캐시 콘텐츠")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "@actual_author 북마크" }));
    expect(referenceApi.saveInstagramTrendSource).toHaveBeenCalledWith(DEMO_BRAND_ID, "media-1");
  });

  it("searches saved channels independently from Library and trend search", async () => {
    installReferenceApi({
      listReferenceBrands: vi.fn(async () => [
        { id: "channel-a", workspaceId: "workspace-1", brandId: "brand-1", platform: "instagram", handle: "alpha", displayName: "Alpha Studio", publicSourceUrl: "https://www.instagram.com/alpha/", profileSnapshot: {}, previewUrl: null },
        { id: "channel-b", workspaceId: "workspace-1", brandId: "brand-1", platform: "instagram", handle: "bravo", displayName: "Bravo Lab", publicSourceUrl: "https://www.instagram.com/bravo/", profileSnapshot: {}, previewUrl: null },
      ]),
    });
    render(<MemoryRouter initialEntries={["/references?view=saved-brands"]}><ReferenceLibraryPage /></MemoryRouter>);

    await screen.findByRole("button", { name: "Alpha Studio 상세 보기" });
    await userEvent.type(screen.getByRole("searchbox", { name: "채널 검색" }), "bravo");
    expect(screen.queryByRole("button", { name: "Alpha Studio 상세 보기" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bravo Lab 상세 보기" })).toBeVisible();
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
