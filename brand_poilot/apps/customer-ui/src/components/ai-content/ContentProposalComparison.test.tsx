import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentProposalRecord } from "../../features/ai-content/types";
import { ContentProposalComparison } from "./ContentProposalComparison";

afterEach(cleanup);

const proposals = Array.from({ length: 3 }, (_, index) => ({
  id: `proposal-${index + 1}`,
  batchId: "batch-1",
  status: "suggested",
  generationId: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  proposal: {
    conceptKey: `concept-${index + 1}`,
    title: `서로 다른 구성안 ${index + 1}`,
    informationalType: "checklist",
    oneLineIntent: "한 줄 의도",
    differentiator: `동적 차별점 ${index + 1}`,
    differentiationAxes: [index === 0 ? "target" : index === 1 ? "question" : "narrative"],
    target: `타깃 ${index + 1}`,
    customerContext: `상황 ${index + 1}`,
    keyMessage: `메시지 ${index + 1}`,
    hook: `훅 ${index + 1}`,
    selectionReason: `선택 이유 ${index + 1}`,
    evidenceIds: [],
    referenceIds: [],
    outputFormat: "card_news",
    channelTargets: ["instagram"],
    assetCount: 1,
    outline: [{ index: 1, role: "single", headline: `장면 ${index + 1}`, purpose: "압축 전달" }],
    purposeDetails: { kind: "informational", question: "질문", value: "가치", whyNow: "지금", learningPoints: ["학습"] },
  },
})) as unknown as ContentProposalRecord[];

describe("ContentProposalComparison", () => {
  it("renders exactly three numbered choices while preserving each server differentiator", () => {
    render(<ContentProposalComparison
      proposals={proposals}
      selectedId={null}
      evidence={[]}
      references={[]}
      onSelect={vi.fn()}
    />);

    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByText("구성안 1")).toBeVisible();
    expect(screen.getByText("구성안 2")).toBeVisible();
    expect(screen.getByText("구성안 3")).toBeVisible();
    expect(screen.getByText("동적 차별점 1")).toBeVisible();
    expect(screen.getByText("동적 차별점 2")).toBeVisible();
    expect(screen.getByText("동적 차별점 3")).toBeVisible();
    expect(screen.queryByText(/안 A|안 B|안 C/)).not.toBeInTheDocument();
  });
});
