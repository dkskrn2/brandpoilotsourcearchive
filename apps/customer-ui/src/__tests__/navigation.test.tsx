import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Sidebar } from "../components/layout/Sidebar";
import { Topbar } from "../components/layout/Topbar";
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
  it("renders customer IA without dashboard and includes admin channel setup", () => {
    render(
      <MemoryRouter>
        <BrandStatusProvider initialStatus={completeStatus}>
          <Sidebar />
        </BrandStatusProvider>
      </MemoryRouter>
    );

    expect(screen.queryByRole("link", { name: /온보딩/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /콘텐츠 검토/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /게시 관리/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /소스/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /트렌드 탐색/ })).toHaveAttribute("href", "/instagram-trends");
    expect(screen.getByRole("link", { name: /^채널$/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "브랜드 설정" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "결제 및 구독" })).toHaveAttribute(
      "href",
      "https://www.danbammsg.co.kr/product/pricing"
    );
    expect(screen.getByRole("link", { name: /고객센터/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /관리자 채널/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /대시보드/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "API 브랜드 브랜드 설정 열기" })).toHaveAttribute("href", "/brand-settings");
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

    expect(screen.getAllByText("API 브랜드")).toHaveLength(2);
    expect(screen.getByText("2개 항목 필요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /온보딩\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /콘텐츠 검토\s*4/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /게시 관리\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /채널\s*3/ })).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "고객 메뉴" });
    const linkLabels = within(nav).getAllByRole("link").map((link) => link.textContent?.replace(/\s+/g, " ").trim());
    expect(linkLabels.at(-1)).toMatch(/^온보딩\s*2$/);
  });
});
