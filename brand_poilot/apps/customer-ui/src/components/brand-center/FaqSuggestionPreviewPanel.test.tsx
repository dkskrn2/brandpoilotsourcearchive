import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FaqSuggestionItem, FaqSuggestionRun } from "../../features/libraries/libraryGateway";
import { FaqSuggestionPreviewPanel } from "./FaqSuggestionPreviewPanel";

const item: FaqSuggestionItem = {
  id: "item-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  runId: "run-1",
  position: 0,
  category: "product",
  question: "제품은 어떻게 구매하나요?",
  answer: "공식 온라인 스토어에서 구매할 수 있습니다.",
  exampleUtterances: ["제품 어디서 사요?", "구매 방법 알려줘", "어디서 구매해요?"],
  evidence: [{ sourceType: "brand_core", sourceId: "source-1", label: "브랜드 코어" }],
  confidence: 0.9,
  status: "review",
  duplicateOfKnowledgeEntryId: null,
  approvedKnowledgeEntryId: null,
  reviewedByUserId: null,
  reviewedAt: null,
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
};

const reviewRun: FaqSuggestionRun = {
  id: "run-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  status: "review_ready",
  errorCode: null,
  createdByUserId: "user-1",
  startedAt: "2026-08-02T00:00:00.000Z",
  completedAt: "2026-08-02T00:01:00.000Z",
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:01:00.000Z",
  items: [item],
};

function gateway(overrides: Record<string, unknown> = {}) {
  return {
    getLatestFaqSuggestionRun: vi.fn(async () => ({ run: reviewRun })),
    getFaqSuggestionRun: vi.fn(async () => ({ run: reviewRun })),
    createFaqSuggestionRun: vi.fn(async () => ({ run: reviewRun })),
    updateFaqSuggestionItem: vi.fn(async (_brandId, _runId, _itemId, input) => ({
      item: { ...item, ...input, updatedAt: "2026-08-02T00:02:00.000Z" },
    })),
    approveFaqSuggestionItem: vi.fn(async () => ({
      item: { ...item, status: "approved" },
      wikiItem: { id: "wiki-1" },
    })),
    dismissFaqSuggestionItem: vi.fn(async () => ({
      item: { ...item, status: "dismissed" },
    })),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("FaqSuggestionPreviewPanel", () => {
  it("restores the latest review run as editable textareas", async () => {
    const api = gateway();
    render(<FaqSuggestionPreviewPanel brandId="brand-1" gateway={api as never} />);

    expect(await screen.findByDisplayValue("제품은 어떻게 구매하나요?")).toBeVisible();
    expect(screen.getByDisplayValue("공식 온라인 스토어에서 구매할 수 있습니다.").tagName)
      .toBe("TEXTAREA");
    expect(api.getLatestFaqSuggestionRun).toHaveBeenCalledWith("brand-1");
    expect(screen.queryByText(/화면 미리보기/)).not.toBeInTheDocument();
  });

  it("creates a run when there is no previous proposal", async () => {
    const api = gateway({
      getLatestFaqSuggestionRun: vi.fn(async () => ({ run: null })),
    });
    render(<FaqSuggestionPreviewPanel brandId="brand-1" gateway={api as never} />);

    const button = await screen.findByRole("button", { name: "FAQ 자동 제안" });
    await userEvent.click(button);

    expect(api.createFaqSuggestionRun).toHaveBeenCalledWith("brand-1");
    expect(await screen.findByDisplayValue("제품은 어떻게 구매하나요?")).toBeVisible();
  });

  it("polls only queued or running runs and stops at review-ready", async () => {
    vi.useFakeTimers();
    const running = { ...reviewRun, status: "running" as const, items: [] };
    const api = gateway({
      getLatestFaqSuggestionRun: vi.fn(async () => ({ run: running })),
      getFaqSuggestionRun: vi.fn(async () => ({ run: reviewRun })),
    });
    render(<FaqSuggestionPreviewPanel brandId="brand-1" gateway={api as never} />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(api.getFaqSuggestionRun).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("제품은 어떻게 구매하나요?")).toBeVisible();

    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(api.getFaqSuggestionRun).toHaveBeenCalledTimes(1);
  });

  it("saves textarea edits before approving and refreshes the FAQ list", async () => {
    const api = gateway();
    const onApproved = vi.fn();
    render(<FaqSuggestionPreviewPanel
      brandId="brand-1"
      gateway={api as never}
      onApproved={onApproved}
    />);
    const answer = await screen.findByDisplayValue(item.answer);
    await userEvent.clear(answer);
    await userEvent.type(answer, "수정한 답변입니다.");
    await userEvent.clear(screen.getByLabelText("표현 예시 1"));
    await userEvent.type(screen.getByLabelText("표현 예시 1"), "제품 구매처 알려줘");
    await userEvent.click(screen.getByRole("button", { name: "FAQ 승인" }));

    await waitFor(() => expect(api.updateFaqSuggestionItem).toHaveBeenCalledWith(
      "brand-1",
      "run-1",
      "item-1",
      {
        category: "product",
        question: item.question,
        answer: "수정한 답변입니다.",
        exampleUtterances: ["제품 구매처 알려줘", "구매 방법 알려줘", "어디서 구매해요?"],
        expectedUpdatedAt: item.updatedAt,
      },
    ));
    expect(api.approveFaqSuggestionItem).toHaveBeenCalledWith(
      "brand-1",
      "run-1",
      "item-1",
      { expectedUpdatedAt: "2026-08-02T00:02:00.000Z" },
    );
    expect(onApproved).toHaveBeenCalledWith({ id: "wiki-1" });
    expect(await screen.findByText("승인됨")).toBeVisible();
  });

  it("dismisses review items and reloads an optimistic conflict", async () => {
    const conflict = Object.assign(new Error("conflict"), { status: 409 });
    const api = gateway({
      dismissFaqSuggestionItem: vi.fn()
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce({ item: { ...item, status: "dismissed" } }),
    });
    render(<FaqSuggestionPreviewPanel brandId="brand-1" gateway={api as never} />);
    await screen.findByDisplayValue(item.question);

    await userEvent.click(screen.getByRole("button", { name: "제외" }));
    await waitFor(() => expect(api.getFaqSuggestionRun).toHaveBeenCalledWith("brand-1", "run-1"));
    expect(await screen.findByText(/최신 제안으로 다시 불러왔습니다/)).toBeVisible();
  });

  it("shows partial, failed source, and duplicate states without actionable buttons", async () => {
    const duplicate = {
      ...item,
      status: "duplicate" as const,
      duplicateOfKnowledgeEntryId: "wiki-existing",
    };
    const api = gateway({
      getLatestFaqSuggestionRun: vi.fn(async () => ({
        run: { ...reviewRun, status: "partial" as const, errorCode: "source_missing", items: [duplicate] },
      })),
    });
    render(<FaqSuggestionPreviewPanel brandId="brand-1" gateway={api as never} />);

    expect(await screen.findByText(/일부 정보가 없어/)).toBeVisible();
    expect(screen.getByText("중복됨")).toBeVisible();
    expect(screen.getByRole("button", { name: "FAQ 승인" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "제외" })).toBeDisabled();
  });

  it("explains a failed run caused by missing source information", async () => {
    const api = gateway({
      getLatestFaqSuggestionRun: vi.fn(async () => ({
        run: { ...reviewRun, status: "failed" as const, errorCode: "source_missing", items: [] },
      })),
    });
    render(<FaqSuggestionPreviewPanel brandId="brand-1" gateway={api as never} />);

    expect(await screen.findByText(/FAQ를 만들 정보가 부족합니다/)).toBeVisible();
    expect(screen.getByText("검토할 FAQ 제안이 없습니다.")).toBeVisible();
  });
});
