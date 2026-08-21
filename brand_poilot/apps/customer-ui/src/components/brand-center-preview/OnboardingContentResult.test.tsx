import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { OnboardingContentState } from "../../features/brand-intelligence/onboardingContentGateway";
import { OnboardingContentResult } from "./OnboardingContentResult";

const base: OnboardingContentState = {
  state: "completed",
  proposalBatchId: "batch-1",
  generationId: "generation-1",
  title: "첫 카드뉴스",
  progress: null,
  outputs: [],
  errorCode: null,
  errorMessage: null,
};

describe("OnboardingContentResult", () => {
  it("shows generation progress while onboarding content runs", () => {
    render(<MemoryRouter><OnboardingContentResult
      state={{ ...base, state: "generating" }} generation={null} channels={[]} channelStatus="loading"
    /></MemoryRouter>);
    expect(screen.getByText("첫 카드뉴스를 만들고 있습니다")).toBeVisible();
    expect(screen.getByText("콘텐츠 설정")).toBeVisible();
    expect(screen.getByText("구성안·스타일")).toBeVisible();
    expect(screen.getByText("콘텐츠 생성")).toBeVisible();
    expect(screen.getByText("결과 확인")).toBeVisible();
    expect(screen.getByText("콘텐츠 생성").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("첫 카드뉴스를 만들고 있습니다").closest("div.onboarding-content-result__progress"))
      .toHaveAttribute("aria-live", "polite");
  });

  it("asks for Instagram login and returns to onboarding when disconnected", () => {
    render(<MemoryRouter><OnboardingContentResult
      state={base}
      generation={null}
      channelStatus="ready"
      channels={[{
        type: "instagram", label: "Instagram", enabled: false,
        oauthState: "not_connected", status: "not_connected", accountLabel: "",
        lastHealthyAt: "", lastPublishedAt: "",
      }]}
    /></MemoryRouter>);
    expect(screen.getByText("게시하려면 먼저 Instagram 로그인이 필요합니다.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Instagram 로그인" }).getAttribute("href"))
      .toContain("returnTo=%2Fonboarding%2Fbrand-intelligence");
  });

  it("links the completed connected result to publishing", () => {
    render(<MemoryRouter><OnboardingContentResult
      state={base}
      generation={null}
      channelStatus="ready"
      channels={[{
        type: "instagram", label: "Instagram", enabled: true,
        oauthState: "connected", status: "connected", accountLabel: "@brand",
        lastHealthyAt: "", lastPublishedAt: "",
      }]}
    /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "게시하러 가기" }))
      .toHaveAttribute("href", "/ai-content/generation-1");
  });

  it("does not expose publishing for a disabled Instagram channel", () => {
    render(<MemoryRouter><OnboardingContentResult
      state={base}
      generation={null}
      channelStatus="ready"
      channels={[{
        type: "instagram", label: "Instagram", enabled: false,
        oauthState: "connected", status: "connected", accountLabel: "@brand",
        lastHealthyAt: "", lastPublishedAt: "",
      }]}
    /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "게시하러 가기" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Instagram 로그인" })).toBeVisible();
  });

  it("does not offer OAuth until the Instagram connection check succeeds", () => {
    render(<MemoryRouter><OnboardingContentResult
      state={base} generation={null} channels={[]} channelStatus="loading"
    /></MemoryRouter>);
    expect(screen.getByText("Instagram 연결 상태를 확인하고 있습니다.")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Instagram 로그인" })).not.toBeInTheDocument();
  });

  it("shows a retryable message when the Instagram connection check fails", () => {
    render(<MemoryRouter><OnboardingContentResult
      state={base} generation={null} channels={[]} channelStatus="failed"
    /></MemoryRouter>);
    expect(screen.getByText(/Instagram 연결 상태를 확인하지 못했습니다/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Instagram 로그인" })).not.toBeInTheDocument();
  });
});
