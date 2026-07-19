import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
});
