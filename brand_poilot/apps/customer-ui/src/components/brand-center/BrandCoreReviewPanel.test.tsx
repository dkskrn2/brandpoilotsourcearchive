import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BrandCoreReviewPanel } from "./BrandCoreReviewPanel";

const draft = {
  id: "draft-1",
  sourceAnalysisId: null,
  version: 2,
  status: "draft" as const,
  core: {
    contractVersion: "brand-core.v1" as const,
    summary: { oneLine: "", description: "설명" },
    audiences: [{ name: "담당자", problem: "문제", desiredOutcome: "결과" }],
    valueProposition: { primary: "가치", differentiators: [], proofPoints: [] },
    messaging: { appeals: [], tone: [], preferredPhrases: [], brandDirection: "방향", priorityMessages: [] },
  },
  evidence: [],
  reviewState: {},
  approvedAt: null,
  updatedAt: "2026-07-26T00:00:00.000Z",
};

describe("BrandCoreReviewPanel", () => {
  it("focuses the first missing required field instead of approving", async () => {
    const approve = vi.fn();
    render(<BrandCoreReviewPanel version={draft} saving={false} onChange={vi.fn()} onSave={vi.fn()} onApprove={approve} />);
    await userEvent.click(screen.getByRole("button", { name: "Brand Core 승인" }));
    expect(screen.getByRole("alert")).toHaveTextContent("필수 정보");
    expect(screen.getByLabelText("한 줄 소개")).toHaveFocus();
    expect(approve).not.toHaveBeenCalled();
  });
});
