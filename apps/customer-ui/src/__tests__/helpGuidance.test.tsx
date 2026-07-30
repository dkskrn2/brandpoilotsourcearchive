import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HelpProvider, useHelp } from "../components/help/HelpContext";
import { PageHeader } from "../components/layout/PageHeader";
import { channelGuides } from "../features/channels/channelGuides";
import { guideForPath, helpGuides } from "../features/help/helpGuides";

function HelpHarness() {
  const help = useHelp();
  return <>
    <button type="button" onClick={help?.openHelp}>도움말 열기</button>
    <PageHeader title="채널 연결" description="외부 채널을 연결합니다." />
    <div data-guide="channel-list">채널 목록</div>
    <a href="#oauth" data-guide="meta-oauth">Meta OAuth 연결</a>
    <div data-guide="channel-status">연결 상태 요약</div>
  </>;
}

describe("통합형 도움말", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  });

  it("동적 AI 콘텐츠 결과 경로에 맞는 가이드를 찾는다", () => {
    expect(guideForPath("/ai-content/generation-1")?.id).toBe("ai-content-result");
  });

  it("현재 화면 가이드와 OAuth 체크리스트를 서랍에 표시한다", () => {
    render(<MemoryRouter initialEntries={["/channels"]}><HelpProvider><HelpHarness /></HelpProvider></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "도움말 열기" }));

    expect(screen.getByRole("dialog", { name: "채널 연결" })).toBeVisible();
    expect(screen.getByText("연결 전에 확인할 정보")).toBeVisible();
    expect(screen.getByText(/트렌드 탐색까지 사용하려면/)).toBeVisible();
    expect(screen.getByRole("link", { name: /Meta Business 설정 열기/ })).toHaveAttribute("target", "_blank");
  });

  it("화면 안내를 사용자가 요청할 때만 실행한다", () => {
    render(<MemoryRouter initialEntries={["/channels"]}><HelpProvider><HelpHarness /></HelpProvider></MemoryRouter>);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /화면 안내/ }));

    expect(screen.getByRole("dialog", { name: "현재 화면 화면 안내" })).toBeVisible();
    expect(screen.getByText("1 / 4")).toBeVisible();
  });

  it("모든 화면 가이드가 데이터, 사용자 작업, 후속 결과를 설명한다", () => {
    for (const guide of helpGuides) {
      const items = guide.sections.flatMap((section) => section.items);
      const copy = [guide.summary, ...items, ...guide.tour.flatMap((step) => [step.title, step.description])].join(" ");

      expect(items.length, `${guide.id} 가이드 항목`).toBeGreaterThanOrEqual(3);
      expect(copy, `${guide.id} 가이드의 일반적인 입력 안내`).not.toContain("입력 영역");
      expect(copy, `${guide.id} 가이드의 후속 결과 안내`).toMatch(/표시|반영|저장|생성|게시|이동|확인|처리|발행|접수|다운로드/);
    }
  });

  it("AI 콘텐츠 생성 가이드가 입력값의 실제 사용처를 설명한다", () => {
    const guide = guideForPath("/ai-content/new");
    expect(guide?.tour.map((step) => step.description).join(" ")).toContain("자사 정보와 제품 URL은 사실 근거");
    expect(guide?.tour.map((step) => step.description).join(" ")).toContain("블로그는 게시 가능한 HTML");
  });

  it("채널별 연결 가이드가 OAuth 준비부터 문제 해결까지 제공한다", () => {
    for (const guide of Object.values(channelGuides)) {
      expect(guide.prerequisites.length, `${guide.channel} 준비 조건`).toBeGreaterThan(0);
      expect(guide.accountSetup.length, `${guide.channel} 계정 준비`).toBeGreaterThan(0);
      expect(guide.oauthSteps.join(" "), `${guide.channel} OAuth 절차`).toMatch(/연결|OAuth|승인/);
      expect(guide.permissions.length, `${guide.channel} 권한 설명`).toBeGreaterThan(0);
      expect(guide.completionChecks.length, `${guide.channel} 완료 확인`).toBeGreaterThan(0);
      expect(guide.troubleshooting.length, `${guide.channel} 문제 해결`).toBeGreaterThan(0);
      expect(guide.officialLinks.length, `${guide.channel} 공식 문서`).toBeGreaterThan(0);
      if (guide.serviceStatus === "preparing") {
        expect(guide.operatorNote, `${guide.channel} 준비 상태 고지`).toContain("준비 중");
      }
    }
  });
});
