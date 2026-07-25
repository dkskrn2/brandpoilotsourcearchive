import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiContentHomePage } from "../pages/AiContentHomePage";
import { createMockAiContentGateway, mockAiContentGateway } from "../features/ai-content/mockAiContentGateway";

afterEach(cleanup);

describe("AI content mock gateway", () => {
  it("returns deterministic usage and jobs with individual output states", async () => {
    const usage = await mockAiContentGateway.getUsage("brand-1");
    const jobs = await mockAiContentGateway.listGenerations("brand-1");

    expect(usage).toMatchObject({ generationUsed: 2, generationLimit: 5 });
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
