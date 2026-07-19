import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubjectAnalysisStep } from "./SubjectAnalysisStep";
import { createMockAiContentGateway } from "../../features/ai-content/mockAiContentGateway";
import { createInitialAiContentDraft } from "../../features/ai-content/useAiContentDraft";

afterEach(cleanup);

describe("SubjectAnalysisStep", () => {
  it("keeps service analysis manual until the user explicitly starts it", async () => {
    const user = userEvent.setup();
    const gateway = createMockAiContentGateway();
    const draft = createInitialAiContentDraft("blog");
    const onAnalysis = vi.fn();
    const onSubjectType = vi.fn();
    render(<SubjectAnalysisStep brandId="brand-demo" gateway={gateway} draft={draft} analysis={null} onSubjectType={onSubjectType} onSubjectInput={vi.fn()} onAnalysis={onAnalysis} onSelectImage={vi.fn()} />);
    expect(screen.queryByText("고객·시장 분석을 완료했습니다.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "서비스" }));
    expect(onSubjectType).toHaveBeenCalledWith("service");
    expect(onAnalysis).not.toHaveBeenCalled();
  });

  it("loads a ready cached analysis without starting a new analysis", async () => {
    const gateway = createMockAiContentGateway();
    const sourceUrl = "https://example.com/product";
    const cached = await gateway.requestSubjectAnalysis("brand-demo", { subjectType: "product", sourceUrl, manualInput: { name: "제품", promotion: "", description: "" }, idempotencyKey: "seed" });
    const request = vi.spyOn(gateway, "requestSubjectAnalysis");
    const onAnalysis = vi.fn();
    const draft = { ...createInitialAiContentDraft("card_news"), subjectType: "product" as const, subjectInput: { sourceUrl, name: "", promotion: "", description: "" } };

    render(<SubjectAnalysisStep brandId="brand-demo" gateway={gateway} draft={draft} analysis={null} onSubjectType={vi.fn()} onSubjectInput={vi.fn()} onAnalysis={onAnalysis} onSelectImage={vi.fn()} />);

    await waitFor(() => expect(onAnalysis).toHaveBeenCalledWith(expect.objectContaining({ id: cached.id, status: "ready" })));
    expect(request).not.toHaveBeenCalled();
  });

  it("debounces cache lookup and cancels the stale URL lookup", async () => {
    const gateway = createMockAiContentGateway();
    const getCached = vi.spyOn(gateway, "getCachedSubjectAnalysis");
    const request = vi.spyOn(gateway, "requestSubjectAnalysis");
    const onAnalysis = vi.fn();
    const baseDraft = createInitialAiContentDraft("card_news");
    const firstDraft = { ...baseDraft, subjectType: "product" as const, subjectInput: { ...baseDraft.subjectInput, sourceUrl: "https://example.com/first" } };
    const secondDraft = { ...firstDraft, subjectInput: { ...firstDraft.subjectInput, sourceUrl: "https://example.com/second" } };
    const view = render(<SubjectAnalysisStep brandId="brand-demo" gateway={gateway} draft={firstDraft} analysis={null} onSubjectType={vi.fn()} onSubjectInput={vi.fn()} onAnalysis={onAnalysis} onSelectImage={vi.fn()} />);

    view.rerender(<SubjectAnalysisStep brandId="brand-demo" gateway={gateway} draft={secondDraft} analysis={null} onSubjectType={vi.fn()} onSubjectInput={vi.fn()} onAnalysis={onAnalysis} onSelectImage={vi.fn()} />);

    await waitFor(() => expect(getCached).toHaveBeenCalledTimes(1));
    expect(getCached).toHaveBeenCalledWith("brand-demo", "product", "https://example.com/second");
    expect(request).not.toHaveBeenCalled();
  });
});
