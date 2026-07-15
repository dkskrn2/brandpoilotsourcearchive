import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BrandSetupGate } from "../components/layout/BrandSetupGate";
import { Sidebar } from "../components/layout/Sidebar";
import { BrandStatusProvider } from "../lib/brandStatus";
import type { BrandUiStatus } from "../types";

const incompleteStatus: BrandUiStatus = {
  brandId: "brand-1",
  brandName: "내 브랜드",
  logoUrl: null,
  lastGeneratedAt: null,
  navigation: {
    onboardingRemaining: 3,
    contentReview: 0,
    publishIssues: 0,
    channelIssues: 0
  },
  onboarding: {
    completedCount: 0,
    totalCount: 8,
    remainingCount: 3,
    steps: [
      { id: "brand-profile", title: "브랜드 정보", description: "입력 필요", actionLabel: "설정", path: "/brand-settings", status: "pending" }
    ]
  }
};

const completeStatus: BrandUiStatus = {
  ...incompleteStatus,
  navigation: {
    ...incompleteStatus.navigation,
    onboardingRemaining: 0
  },
  onboarding: {
    ...incompleteStatus.onboarding,
    completedCount: 1,
    remainingCount: 0,
    steps: [
      { id: "brand-profile", title: "브랜드 정보", description: "입력됨", actionLabel: "설정", path: "/brand-settings", status: "completed" }
    ]
  }
};

function renderGate(status: BrandUiStatus, initialPath = "/sources") {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <BrandStatusProvider initialStatus={status}>
        <Routes>
          <Route element={<BrandSetupGate />}>
            <Route path="/onboarding" element={<div>온보딩 화면</div>} />
            <Route path="/sources" element={<div>소스 화면</div>} />
            <Route path="/brand-settings" element={<div>브랜드 설정 화면</div>} />
            <Route path="/support" element={<div>고객센터 화면</div>} />
          </Route>
        </Routes>
      </BrandStatusProvider>
    </MemoryRouter>
  );
}

describe("brand setup gating", () => {
  it("redirects direct access to other pages until brand settings are complete", () => {
    renderGate(incompleteStatus, "/sources");

    expect(screen.queryByText("소스 화면")).not.toBeInTheDocument();
    expect(screen.getByText("브랜드 설정 화면")).toBeInTheDocument();
  });

  it("allows other pages after brand settings are complete", () => {
    renderGate(completeStatus, "/sources");

    expect(screen.getByText("소스 화면")).toBeInTheDocument();
  });

  it("allows onboarding before brand settings are complete", () => {
    renderGate(incompleteStatus, "/onboarding");

    expect(screen.getByText("온보딩 화면")).toBeInTheDocument();
  });

  it("allows support before brand settings are complete", () => {
    renderGate(incompleteStatus, "/support");

    expect(screen.getByText("고객센터 화면")).toBeInTheDocument();
  });

  it("disables sidebar links except onboarding and brand settings before brand settings are complete", () => {
    render(
      <MemoryRouter>
        <BrandStatusProvider initialStatus={incompleteStatus}>
          <Sidebar />
        </BrandStatusProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: /온보딩/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "브랜드 설정" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /고객센터/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /게시 관리/ })).not.toBeInTheDocument();
    expect(screen.getByText("게시 관리").closest("[aria-disabled='true']")).toBeInTheDocument();
  });
});
