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

const approved = {
  ...draft,
  id: "approved-1",
  version: 1,
  status: "approved" as const,
  approvedAt: "2026-07-25T00:00:00.000Z",
  core: {
    ...draft.core,
    summary: { oneLine: "승인된 한 줄", description: "승인된 설명" },
  },
};

describe("BrandCoreReviewPanel", () => {
  it("keeps an approved revision read-only until edit is requested", async () => {
    const edit = vi.fn();
    render(<BrandCoreReviewPanel
      version={approved}
      editing={false}
      saving={false}
      dirty={false}
      onChange={vi.fn()}
      onSave={vi.fn()}
      onApprove={vi.fn()}
      onEdit={edit}
      onCancel={vi.fn()}
    />);

    expect(screen.getByLabelText("한 줄 소개")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "브랜드 코어 수정" }));
    expect(edit).toHaveBeenCalledOnce();
  });

  it("keeps a superseded revision read-only without offering edit", () => {
    render(<BrandCoreReviewPanel
      version={{ ...approved, id: "old-1", status: "superseded" }}
      editing={false}
      saving={false}
      dirty={false}
      onChange={vi.fn()}
      onSave={vi.fn()}
      onApprove={vi.fn()}
      onEdit={vi.fn()}
      onCancel={vi.fn()}
    />);

    expect(screen.getByLabelText("한 줄 소개")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "브랜드 코어 수정" })).not.toBeInTheDocument();
  });

  it("focuses the first missing required field instead of approving", async () => {
    const approve = vi.fn();
    render(<BrandCoreReviewPanel
      version={draft}
      editing
      saving={false}
      dirty
      onChange={vi.fn()}
      onSave={vi.fn()}
      onApprove={approve}
      onEdit={vi.fn()}
      onCancel={vi.fn()}
    />);
    await userEvent.click(screen.getByRole("button", { name: "Brand Core 승인" }));
    expect(screen.getByRole("alert")).toHaveTextContent("필수 정보");
    expect(screen.getByLabelText("한 줄 소개")).toHaveFocus();
    expect(approve).not.toHaveBeenCalled();
  });
});
