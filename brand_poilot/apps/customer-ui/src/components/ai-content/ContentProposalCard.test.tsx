import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentProposalRecord } from "../../features/ai-content/types";
import { ContentProposalCard } from "./ContentProposalCard";

afterEach(cleanup);

function proposal(kind: "informational" | "marketing", outputFormat: "card_news" | "blog" = "card_news") {
  return {
    id: `${kind}-proposal`,
    batchId: "batch-1",
    status: "suggested",
    generationId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    proposal: {
      conceptKey: `${kind}-concept`,
      title: kind === "informational" ? "초보자를 위한 피부 장벽 가이드" : "민감 피부 세럼 캠페인",
      informationalType: kind === "informational" ? "how_to" : null,
      oneLineIntent: "복잡한 선택을 한 번에 이해시킵니다.",
      differentiator: "성분 이름 대신 사용 상황으로 구분합니다.",
      differentiationAxes: ["situation"],
      target: "민감 피부를 처음 관리하는 고객",
      customerContext: "제품이 너무 많아 선택하기 어려운 상황",
      keyMessage: "세 단계만 지키면 됩니다.",
      hook: "많이 바를수록 좋아진다는 생각부터 내려놓으세요.",
      selectionReason: "즉시 따라 할 수 있는 순서가 명확합니다.",
      evidenceIds: ["11111111-1111-4111-8111-111111111111"],
      referenceIds: ["22222222-2222-4222-8222-222222222222"],
      outputFormat,
      channelTargets: [outputFormat === "blog" ? "blog_export" : "instagram"],
      assetCount: outputFormat === "blog" ? null : 2,
      outline: [
        { index: 1, role: "hook", headline: "피부가 보내는 신호", purpose: "문제 인식" },
        { index: 2, role: "guide", headline: "3단계 관리", purpose: "실행 안내" },
      ],
      purposeDetails: kind === "informational"
        ? {
            kind: "informational",
            question: "민감 피부는 무엇부터 바꿔야 하나요?",
            value: "오늘 바로 적용할 관리 순서",
            whyNow: "계절 변화로 자극이 늘어나는 시기",
            learningPoints: ["과한 세안 피하기", "보습 순서 지키기"],
          }
        : {
            kind: "marketing",
            campaignObjective: "첫 구매 전환",
            situationAndNeed: "자극 없이 보습하고 싶은 고객",
            productId: "33333333-3333-4333-8333-333333333333",
            targetSegment: "민감성 피부 신규 고객",
            strengths: ["저자극", "빠른 흡수"],
            limitations: ["향을 선호하면 맞지 않을 수 있음"],
            appeal: "부담 없이 매일 쓰는 세럼",
            buyingBarriers: ["효과를 바로 알기 어려움"],
            cta: "제품 상세 보기",
          },
    },
  } as unknown as ContentProposalRecord;
}

const evidence = [{
  id: "11111111-1111-4111-8111-111111111111",
  title: "피부 장벽 연구 요약",
  url: "https://evidence.example/article",
  publisher: "연구소",
}];
const references = [{
  id: "22222222-2222-4222-8222-222222222222",
  title: "인기 카드뉴스",
  preview: { url: "https://reference.example/preview.jpg", mimeType: "image/jpeg" },
}];

describe("ContentProposalCard", () => {
  it("preserves the complete legacy proposal card without replacing its V1 labels", () => {
    const legacy: ContentProposalRecord = {
      id: "legacy-proposal",
      batchId: "legacy-batch",
      status: "suggested",
      generationId: null,
      createdAt: "2026-07-28T00:00:00.000Z",
      proposal: {
        contractVersion: "content-proposal.v1",
        title: "여름 피부 관리",
        reasonToCreateNow: "자외선이 강해지는 시기입니다.",
        contentFamily: "informational",
        topic: "여름철 피부 장벽",
        target: {},
        messageStrategy: "how_to",
        hook: "세 단계만 바꿔보세요.",
        keyMessage: "순한 세안과 보습 순서가 핵심입니다.",
        evidence: [{ sourceSnapshotId: "source-1", summary: "여름철 피부 자극 자료" }],
        outline: [
          { heading: "피부 장벽 신호", purpose: "문제 인식" },
          { heading: "관리 순서", purpose: "실행 안내" },
        ],
        outputFormat: "blog",
        channelTargets: ["blog_export"],
        recommendedReferenceQuery: { strategies: ["how_to"], formats: ["blog"], tags: ["여름"] },
      },
    };

    render(<ContentProposalCard
      item={legacy}
      position={2}
      selected={false}
      evidence={[]}
      references={[]}
      onSelect={vi.fn()}
    />);

    expect(screen.getByText("방법 안내")).toBeVisible();
    expect(screen.queryByText("구성안 2")).not.toBeInTheDocument();
    expect(screen.getByText("자외선이 강해지는 시기입니다.")).toBeVisible();
    for (const label of ["주제", "훅", "핵심 메시지", "형식·채널"]) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(screen.getByText("여름철 피부 장벽")).toBeVisible();
    expect(screen.getByText("여름철 피부 자극 자료")).toBeVisible();
    expect(screen.getByText("피부 장벽 신호")).toBeVisible();
    expect(screen.getByText("문제 인식")).toBeVisible();
    expect(screen.getByRole("button", { name: "구성안 선택: 여름 피부 관리" })).toBeVisible();
  });

  it("keeps the complete informational plan in an expandable detail section", async () => {
    const user = userEvent.setup();
    render(<ContentProposalCard
      item={proposal("informational")}
      position={1}
      selected={false}
      evidence={evidence}
      references={references}
      onSelect={vi.fn()}
    />);

    expect(screen.getByRole("heading", { name: "초보자를 위한 피부 장벽 가이드" })).toBeVisible();
    expect(screen.getAllByText("복잡한 선택을 한 번에 이해시킵니다.")[0]).toBeVisible();
    await user.click(screen.getByText("구성안 상세 보기"));
    for (const label of [
      "이 안의 차별점", "기획 의도", "대상", "상황", "핵심 메시지", "훅", "선택 이유",
      "정보 유형", "독자 질문", "제공 가치", "지금 다룰 이유", "핵심 학습 포인트",
      "검색 근거", "사용 레퍼런스", "출력 형식·채널", "제안 장수", "장면별 개요",
    ]) expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByRole("link", { name: "피부 장벽 연구 요약" })).toHaveAttribute("href", "https://evidence.example/article");
    expect(screen.getByRole("link", { name: "인기 카드뉴스 미리보기" })).toHaveAttribute("href", "https://reference.example/preview.jpg");
    expect(screen.getAllByText("2장")[0]).toBeVisible();
    expect(screen.getByText("1. hook · 피부가 보내는 신호")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText(/placeholder|이미지 생성/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rationale|chain.of.thought|추론/i)).not.toBeInTheDocument();
  });

  it("shows marketing-specific fields without exposing hidden reasoning", async () => {
    const user = userEvent.setup();
    render(<ContentProposalCard
      item={proposal("marketing")}
      position={2}
      selected
      evidence={evidence}
      references={references}
      onSelect={vi.fn()}
    />);

    await user.click(screen.getByText("구성안 상세 보기"));

    for (const label of [
      "캠페인 목적", "고객 상황·니즈", "제품", "타깃 세그먼트", "강점", "한계",
      "소구점", "구매 장벽", "CTA",
    ]) expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByText("33333333-3333-4333-8333-333333333333")).toBeVisible();
    expect(screen.getByText("저자극")).toBeVisible();
    expect(screen.getByRole("button", { name: "구성안 선택: 민감 피부 세럼 캠페인" })).toHaveAttribute("aria-pressed", "true");
  });

  it("defers blog image count and shows the article outline", async () => {
    const user = userEvent.setup();
    render(<ContentProposalCard
      item={proposal("informational", "blog")}
      position={3}
      selected={false}
      evidence={evidence}
      references={references}
      onSelect={vi.fn()}
    />);

    await user.click(screen.getByText("구성안 상세 보기"));

    expect(screen.getByText("이미지는 최종 작성 중 필요할 때 결정")).toBeVisible();
    const outline = screen.getByRole("list", { name: "글 개요" });
    expect(within(outline).getByText(/피부가 보내는 신호/)).toBeVisible();
    expect(screen.queryByText("제안 장수")).not.toBeInTheDocument();
  });
});
