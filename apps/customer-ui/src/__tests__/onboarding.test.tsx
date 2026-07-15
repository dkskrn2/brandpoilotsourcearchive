import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { BrandStatusProvider } from "../lib/brandStatus";
import { OnboardingPage } from "../pages/OnboardingPage";

describe("OnboardingPage", () => {
  it("shows every checklist item included in the API progress count", () => {
    render(
      <MemoryRouter>
        <BrandStatusProvider initialStatus={{
          brandId: "brand-1",
          brandName: "API 브랜드",
          logoUrl: null,
          lastGeneratedAt: null,
          navigation: {
            onboardingRemaining: 2,
            contentReview: 4,
            publishIssues: 1,
            channelIssues: 2
          },
          onboarding: {
            completedCount: 5,
            totalCount: 7,
            remainingCount: 2,
            steps: [
              { id: "brand-profile", title: "브랜드 정보", description: "입력됨", actionLabel: "설정", path: "/brand-settings", status: "completed" },
              { id: "owned-url", title: "자사 URL", description: "등록됨", actionLabel: "소스", path: "/sources", status: "completed" },
              { id: "reference-url", title: "참고 URL", description: "등록됨", actionLabel: "소스", path: "/sources", status: "completed" },
              { id: "topic-table", title: "주제표", description: "업로드됨", actionLabel: "주제 큐", path: "/sources", status: "completed" },
              { id: "first-content", title: "첫 콘텐츠 생성", description: "생성됨", actionLabel: "게시 관리", path: "/publish-queue", status: "completed" },
              { id: "instagram", title: "Instagram 연결", description: "확인 필요", actionLabel: "확인", path: "/channels", status: "needs_attention" },
              { id: "threads", title: "Threads 연결", description: "연결 필요", actionLabel: "연결", path: "/channels", status: "pending" }
            ]
          }
        }}>
          <OnboardingPage />
        </BrandStatusProvider>
      </MemoryRouter>
    );

    expect(screen.getByText("5 / 7 완료")).toBeInTheDocument();

    const checklist = screen.getByRole("list", { name: "온보딩 체크리스트" });
    expect(within(checklist).getAllByRole("listitem")).toHaveLength(7);
    expect(within(checklist).getAllByText("완료")).toHaveLength(5);
    expect(within(checklist).getByText("!")).toHaveClass("check-dot", "is-incomplete");
    expect(within(checklist).getByText("·")).toHaveClass("check-dot", "is-incomplete");
    expect(within(checklist).getAllByText("✓")[0]).not.toHaveClass("is-incomplete");
    expect(screen.queryByRole("heading", { name: "진행 요약" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "현재 차단 사유" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "다음 실행" })).not.toBeInTheDocument();
    expect(screen.queryByText("자동 승인 정책")).not.toBeInTheDocument();
  });
});
