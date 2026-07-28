import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiContentHomePage } from "../pages/AiContentHomePage";
import { createMockAiContentGateway, mockAiContentGateway } from "../features/ai-content/mockAiContentGateway";

afterEach(cleanup);

describe("AI content mock gateway", () => {
  it("returns deterministic usage and jobs with individual output states", async () => {
    const usage = await mockAiContentGateway.getUsage("brand-1");
    const jobs = await mockAiContentGateway.listGenerations("brand-1");

    expect(usage).toMatchObject({ generationUsed: 2, generationLimit: 10, newDownloadLimit: 20 });
    expect(jobs.map((job) => job.status)).toEqual(expect.arrayContaining(["generating", "completed", "partial_failed"]));
    expect(jobs.flatMap((job) => job.outputs).length).toBeGreaterThan(0);
  });

  it("returns an existing normalized audience and appeal instead of saving a duplicate", async () => {
    const gateway = createMockAiContentGateway();
    const audience = await gateway.saveAudiencePreset("brand-1", {
      name: "  2030   직장인 ",
      situation: "퇴근 후 콘텐츠를 준비함",
      problem: "운영 시간이 부족함",
      motivation: "꾸준한 게시"
    });
    const duplicateAudience = await gateway.saveAudiencePreset("brand-1", {
      name: "2030 직장인",
      situation: " 퇴근 후 콘텐츠를 준비함 ",
      problem: "운영 시간이 부족함",
      motivation: "꾸준한 게시"
    });
    const appeal = await gateway.saveAppealPreset("brand-1", {
      title: " 운영 시간 절약 ",
      description: "승인만으로 게시를 준비합니다.",
      evidenceType: "benefit"
    });
    const duplicateAppeal = await gateway.saveAppealPreset("brand-1", {
      title: "운영   시간 절약",
      description: "승인만으로 게시를 준비합니다.",
      evidenceType: "benefit"
    });

    expect(duplicateAudience.id).toBe(audience.id);
    expect(await gateway.listAudiencePresets("brand-1")).toHaveLength(1);
    expect(duplicateAppeal.id).toBe(appeal.id);
    expect(await gateway.listAppealPresets("brand-1")).toHaveLength(1);
  });

  it("rejects retrying an output that has not failed", async () => {
    const gateway = createMockAiContentGateway();
    await expect(gateway.retryOutput("brand-1", "output-blog", "다시 생성")).rejects.toThrow("ai_content_output_not_failed");
  });
});

describe("AiContentHomePage", () => {
  it("keeps existing generation history available when only the proposal inbox request fails", async () => {
    const gateway = createMockAiContentGateway();
    vi.spyOn(gateway, "listSuggestedProposals").mockRejectedValue(new Error("proposal_inbox_unavailable"));

    render(<MemoryRouter><AiContentHomePage gateway={gateway} brandId="brand-demo" /></MemoryRouter>);

    expect(await screen.findByRole("region", { name: "AI 콘텐츠 작업" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows scheduled AI proposals and dismisses one only after confirmation", async () => {
    const gateway = createMockAiContentGateway();
    vi.spyOn(gateway, "listSuggestedProposals").mockResolvedValue([{
      id: "proposal-1",
      batchId: "11111111-1111-4111-8111-111111111111",
      proposal: {
        contractVersion: "content-proposal.v1", title: "지금 검토할 여름 가이드",
        reasonToCreateNow: "새 crawl 근거가 준비됐습니다.", contentFamily: "informational",
        topic: "여름 관리", target: {}, messageStrategy: "how_to", hook: "세 단계로 끝내세요",
        keyMessage: "단순한 관리", evidence: [{ sourceSnapshotId: "snapshot-1", summary: "7월 브랜드 가이드" }],
        outline: [], outputFormat: "blog", channelTargets: ["blog_export"],
        recommendedReferenceQuery: { strategies: ["how_to"], formats: ["blog"], tags: ["여름"] },
      },
      status: "suggested", generationId: null, createdAt: "2026-07-28T00:00:00.000Z",
    }]);
    const dismiss = vi.spyOn(gateway, "dismissProposal");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<MemoryRouter><AiContentHomePage gateway={gateway} brandId="brand-demo" /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "검토할 AI 제안" })).toBeVisible();
    expect(screen.getByRole("link", { name: /지금 검토할 여름 가이드/ })).toHaveAttribute(
      "href",
      "/ai-content/new?proposalBatch=11111111-1111-4111-8111-111111111111",
    );
    fireEvent.click(screen.getByRole("button", { name: "제안 닫기: 지금 검토할 여름 가이드" }));
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith("brand-demo", "proposal-1"));
    expect(screen.queryByText("지금 검토할 여름 가이드")).not.toBeInTheDocument();
  });

  it("shows the primary content action and recent jobs as cards without the performance section", async () => {
    render(
      <MemoryRouter>
        <AiContentHomePage gateway={mockAiContentGateway} />
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "AI 콘텐츠 생성" })).toBeVisible();
    expect(screen.getByRole("link", { name: "새 콘텐츠 만들기" })).toHaveAttribute("href", "/ai-content/new");
    expect(screen.queryByLabelText("오늘 AI 콘텐츠 잔여 사용량")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "오늘 사용량" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "무엇을 만들까요?" })).not.toBeInTheDocument();

    const jobs = screen.getByRole("region", { name: "AI 콘텐츠 작업" });
    expect(within(jobs).getByText("생성 중")).toBeVisible();
    expect(within(jobs).getByText(/5 \/ 5단계 · 프롬프트·생성/)).toBeVisible();
    expect(within(jobs).getByText("부분 실패")).toBeVisible();
    expect(within(jobs).getByRole("link", { name: /부분 실패.*상세 보기/ })).toHaveAttribute("href", "/ai-content/generation-partial");
    expect(screen.queryByRole("heading", { name: "성과가 좋았던 콘텐츠" })).not.toBeInTheDocument();
    expect(within(jobs).getAllByRole("listitem")[0]).toHaveClass("ai-content-job-card");
  });

  it("uses the whole job card as a link and shows the first result thumbnail", async () => {
    render(
      <MemoryRouter>
        <AiContentHomePage gateway={mockAiContentGateway} />
      </MemoryRouter>
    );

    const cardLink = await screen.findByRole("link", { name: "여름 추천 카드뉴스 완료 상세 보기" });
    expect(cardLink).toHaveClass("ai-content-job-card__link");
    expect(within(cardLink).getByText("여름 추천 카드뉴스")).toBeVisible();
    expect(within(cardLink).getByText("완료")).toBeVisible();
    expect(within(cardLink).getByRole("img", { name: "여름 추천 카드뉴스 첫 결과 미리보기" })).toHaveAttribute(
      "src",
      "https://picsum.photos/seed/card-news-preview/1200/1200"
    );
    expect(within(cardLink).getByTestId("job-card-media")).toHaveStyle({ aspectRatio: "4 / 3" });
  });

  it("keeps a fixed-ratio placeholder while a job is in progress", async () => {
    render(
      <MemoryRouter>
        <AiContentHomePage gateway={mockAiContentGateway} />
      </MemoryRouter>
    );

    const cardLink = await screen.findByRole("link", { name: "여름 캠페인 카드뉴스 생성 중 상세 보기" });
    const media = within(cardLink).getByTestId("job-card-media");
    expect(media).toHaveStyle({ aspectRatio: "4 / 3" });
    expect(within(media).getByText("결과 준비 중")).toBeVisible();
    expect(within(cardLink).queryByRole("img")).not.toBeInTheDocument();
  });

  it("filters jobs by content type", async () => {
    render(
      <MemoryRouter>
        <AiContentHomePage gateway={mockAiContentGateway} />
      </MemoryRouter>
    );

    await screen.findByRole("heading", { name: "AI 콘텐츠 생성" });
    fireEvent.click(screen.getByRole("button", { name: "블로그" }));

    const jobs = screen.getByRole("region", { name: "AI 콘텐츠 작업" });
    expect(within(jobs).getByText("고객이 저장하는 운영 가이드")).toBeVisible();
    expect(within(jobs).queryByText("여름 캠페인 카드뉴스")).not.toBeInTheDocument();
  });
});
