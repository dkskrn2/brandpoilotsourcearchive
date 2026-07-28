import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { router } from "../routes";
import { Sidebar } from "../components/layout/Sidebar";
import { Topbar } from "../components/layout/Topbar";
import { ScrollToTopButton } from "../components/layout/ScrollToTopButton";
import { AppShell } from "../components/layout/AppShell";
import { BrandStatusProvider } from "../lib/brandStatus";
import type { BrandUiStatus } from "../types";

const completeStatus: BrandUiStatus = {
  brandId: "brand-1",
  brandName: "API 브랜드",
  logoUrl: "https://cdn.example.com/logo.png",
  lastGeneratedAt: null,
  navigation: {
    onboardingRemaining: 0,
    contentReview: 0,
    publishIssues: 0,
    channelIssues: 0
  },
  onboarding: {
    completedCount: 1,
    totalCount: 1,
    remainingCount: 0,
    steps: [
      { id: "brand-profile", title: "브랜드 정보", description: "입력됨", actionLabel: "설정", path: "/brand-settings", status: "completed" }
    ]
  }
};

describe("AppShell navigation", () => {
  it("opens feedback from desktop and mobile sidebar actions", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <AppShell><div>페이지 내용</div></AppShell>
      </MemoryRouter>
    );

    const desktopFeedbackTrigger = screen.getByRole("button", { name: "피드백" });
    desktopFeedbackTrigger.focus();
    fireEvent.click(desktopFeedbackTrigger);
    expect(screen.getByRole("dialog", { name: "피드백" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "피드백 닫기" }));
    expect(desktopFeedbackTrigger).toHaveFocus();

    const mobileMenuTrigger = screen.getByRole("button", { name: "전체 메뉴 열기" });
    fireEvent.click(mobileMenuTrigger);
    const mobileMenu = screen.getByRole("dialog", { name: "전체 메뉴" });
    fireEvent.click(within(mobileMenu).getByRole("button", { name: "피드백" }));
    expect(screen.queryByRole("dialog", { name: "전체 메뉴" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "피드백" })).toBeVisible();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "의견" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "피드백 닫기" }));
    await waitFor(() => expect(mobileMenuTrigger).toHaveFocus());
    unmount();
  });

  it("opens mobile navigation as a full-screen menu and closes it with Escape", async () => {
    render(
      <MemoryRouter>
        <AppShell><div>페이지 내용</div></AppShell>
      </MemoryRouter>
    );

    const openButton = screen.getByRole("button", { name: "전체 메뉴 열기" });
    fireEvent.click(openButton);

    expect(openButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "전체 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "전체 메뉴 닫기" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "전체 메뉴" })).not.toBeInTheDocument();
    expect(openButton).toHaveFocus();
  });

  it("keeps Tab focus inside the mobile navigation until Escape restores its trigger", () => {
    render(
      <MemoryRouter>
        <AppShell><button type="button">페이지 뒤 버튼</button></AppShell>
      </MemoryRouter>
    );

    const openButton = screen.getByRole("button", { name: "전체 메뉴 열기" });
    fireEvent.click(openButton);
    const mobileMenu = screen.getByRole("dialog", { name: "전체 메뉴" });
    const focusable = [...mobileMenu.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)")];
    focusable.at(-1)?.focus();
    fireEvent.keyDown(mobileMenu, { key: "Tab" });
    expect(mobileMenu).toContainElement(document.activeElement as HTMLElement);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(openButton).toHaveFocus();
  });

  it("shows the current page and keeps the account menu keyboard accessible", () => {
    render(
      <MemoryRouter initialEntries={["/ai-content"]}>
        <AppShell><div>페이지 내용</div></AppShell>
      </MemoryRouter>
    );

    expect(within(screen.getByRole("banner")).getByText("콘텐츠 생성")).toHaveClass("topbar-page-title");
    const accountTrigger = screen.getByRole("button", { name: "모종 계정 메뉴 열기" });
    fireEvent.click(accountTrigger);
    expect(accountTrigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "로그아웃" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(accountTrigger).toHaveFocus();
  });

  it("shows a global scroll-to-top button after scrolling and returns smoothly to the top", () => {
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 500 });
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
    render(<ScrollToTopButton />);

    fireEvent.scroll(window);
    screen.getByRole("button", { name: "맨 위로" }).click();

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("renders the grouped customer navigation without admin entries", () => {
    render(
      <MemoryRouter>
        <BrandStatusProvider initialStatus={completeStatus}>
          <Sidebar />
        </BrandStatusProvider>
      </MemoryRouter>
    );

    expect(screen.queryByRole("link", { name: /브랜드 분석/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "시작 준비" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "모종 AD" })).toHaveAttribute(
      "src",
      "/assets/brand/mojong-ad-logo.png"
    );
    expect(screen.getByRole("link", { name: /대시보드/ })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: /성과·개선/ })).toHaveAttribute("href", "/performance");
    expect(screen.queryByRole("link", { name: /콘텐츠 검토/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /게시 관리/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^원본 자료$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "레퍼런스" })).toHaveAttribute("href", "/references");
    expect(screen.queryByRole("link", { name: /레퍼런스 보관함/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /트렌드 탐색/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^채널$/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "브랜드 센터" })).toHaveAttribute("href", "/brand-center");
    expect(screen.getByRole("link", { name: "결제 및 구독" })).toHaveAttribute(
      "href",
      "https://www.danbammsg.co.kr/product/pricing"
    );
    expect(screen.getByRole("link", { name: /고객센터/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /관리자 채널/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "API 브랜드 브랜드 센터 열기" })).toHaveAttribute("href", "/brand-center");

    const overview = screen.getByRole("region", { name: "개요" });
    const brand = screen.getByRole("region", { name: "브랜드" });
    const contentOperations = screen.getByRole("region", { name: "콘텐츠" });
    const channelCustomers = screen.getByRole("region", { name: "채널·고객" });
    const settingsSupport = screen.getByRole("region", { name: "설정·지원" });
    expect(within(overview).getAllByRole("link").map((link) => link.textContent?.trim())).toEqual(["대시보드", "성과·개선"]);
    expect(within(brand).getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "브랜드 센터", "레퍼런스"
    ]);
    expect(within(contentOperations).getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "콘텐츠 생성", "게시 관리"
    ]);
    expect(within(channelCustomers).getAllByRole("link").map((link) => link.textContent?.trim())).toEqual(["채널", "Instagram 고객응대"]);
    expect(within(settingsSupport).getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "결제 및 구독", "고객센터"
    ]);

    const nav = screen.getByRole("navigation", { name: "고객 메뉴" });
    const links = within(nav).getAllByRole("link");
    expect(links.every((link) => link.querySelector("[data-nav-icon]"))).toBe(true);
    expect(links[0]).toHaveTextContent("대시보드");
    expect(links[1]).toHaveTextContent("성과·개선");
    expect(links[2]).toHaveTextContent("브랜드 센터");
    expect(links[2]).toHaveAttribute("href", "/brand-center");
  });

  it("persists the collapsed desktop sidebar across remounts", () => {
    localStorage.removeItem("mojong:desktop-sidebar:v1");
    const firstRender = render(
      <MemoryRouter>
        <AppShell><div>페이지 내용</div></AppShell>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "사이드바 접기" }));
    expect(screen.getByRole("complementary")).toHaveClass("sidebar--collapsed");
    expect(localStorage.getItem("mojong:desktop-sidebar:v1")).toBe("collapsed");

    firstRender.unmount();
    render(
      <MemoryRouter>
        <AppShell><div>페이지 내용</div></AppShell>
      </MemoryRouter>
    );

    expect(screen.getByRole("complementary")).toHaveClass("sidebar--collapsed");
    expect(screen.getByRole("button", { name: "사이드바 펼치기" })).toHaveAttribute("aria-expanded", "false");
    localStorage.removeItem("mojong:desktop-sidebar:v1");
  });

  it("keeps menu names accessible when collapsed badges are visible", () => {
    render(
      <MemoryRouter>
        <BrandStatusProvider initialStatus={{
          ...completeStatus,
          navigation: { ...completeStatus.navigation, publishIssues: 1, channelIssues: 3 }
        }}>
          <Sidebar collapsed />
        </BrandStatusProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "게시 관리" })).toHaveAttribute("href", "/publish-queue");
    expect(screen.getByRole("link", { name: "채널" })).toHaveAttribute("href", "/channels");
    expect(screen.getByRole("button", { name: "피드백" })).toBeInTheDocument();
  });

  it("uses the dashboard as the authenticated index route", () => {
    const appRoute = router.routes.find((route) => route.path === "/");
    const indexRoute = appRoute?.children?.find((route) => route.index);
    const dashboardRoute = appRoute?.children?.find((route) => route.path === "dashboard");

    expect(indexRoute && "element" in indexRoute ? indexRoute.element : null)
      .toMatchObject({ props: { to: "/dashboard", replace: true } });
    expect(dashboardRoute && "element" in dashboardRoute ? dashboardRoute.element : null).toBeTruthy();
    expect(appRoute?.children?.find((route) => route.path === "ai-content")).toBeTruthy();
    expect(appRoute?.children?.find((route) => route.path === "performance")).toBeTruthy();
    expect(appRoute?.children?.find((route) => route.path === "ai-content/new")).toBeTruthy();
    expect(appRoute?.children?.find((route) => route.path === "ai-content/:generationId")).toBeTruthy();
    expect(appRoute?.children?.find((route) => route.path === "references")).toBeTruthy();
    expect(appRoute?.children?.find((route) => route.path === "archive")).toBeTruthy();
    expect(appRoute?.children?.find((route) => route.path === "admin/channels")).toBeFalsy();
  });

  it("redirects the legacy content review route to the review filter in publish management", () => {
    const appRoute = router.routes.find((route) => route.path === "/");
    const contentRoute = appRoute?.children?.find((route) => route.path === "content");

    expect(contentRoute && "element" in contentRoute ? contentRoute.element : null)
      .toMatchObject({ props: { to: "/publish-queue?status=needs_review", replace: true } });
  });

  it("renders shell counters from brand UI status", () => {
    render(
      <MemoryRouter>
        <BrandStatusProvider initialStatus={{
          brandId: "brand-1",
          brandName: "API 브랜드",
          logoUrl: null,
          lastGeneratedAt: "2026-07-06T01:00:00.000Z",
          navigation: {
            onboardingRemaining: 2,
            contentReview: 4,
            publishIssues: 1,
            channelIssues: 3
          },
          onboarding: {
            completedCount: 7,
            totalCount: 9,
            remainingCount: 2,
            steps: []
          }
        }}>
          <Sidebar />
          <Topbar />
        </BrandStatusProvider>
      </MemoryRouter>
    );

    expect(screen.getAllByText("API 브랜드")).toHaveLength(3);
    expect(screen.getByText("2개 항목 필요")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "API 브랜드 계정 메뉴 열기" }));
    expect(screen.getByRole("menuitem", { name: "로그아웃" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /브랜드 분석\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "시작 준비" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /콘텐츠 검토/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /게시 관리\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /채널\s*3/ })).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "고객 메뉴" });
    const linkLabels = within(nav).getAllByRole("link").map((link) => link.textContent?.replace(/\s+/g, " ").trim());
    expect(linkLabels.at(-1)).toMatch(/^브랜드 분석\s*2$/);
  });
});
