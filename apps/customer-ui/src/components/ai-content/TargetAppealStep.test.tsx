import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TargetAppealStep } from "./TargetAppealStep";
import { createMockAiContentGateway } from "../../features/ai-content/mockAiContentGateway";
import type { SubjectAnalysis } from "../../features/ai-content/types";
import { createInitialAiContentDraft } from "../../features/ai-content/useAiContentDraft";

afterEach(cleanup);

describe("TargetAppealStep", () => {
  it("renders exactly three recommendations and replaces the selected appeal", async () => {
    const user = userEvent.setup();
    const gateway = createMockAiContentGateway();
    const analysis = await gateway.requestSubjectAnalysis("brand-demo", { subjectType: "product", sourceUrl: "https://example.com/product", manualInput: { name: "제품", promotion: "", description: "" }, idempotencyKey: "test" });
    const onTarget = vi.fn();
    const onAppeal = vi.fn();
    render(<TargetAppealStep analysis={analysis} draft={{ ...createInitialAiContentDraft("card_news"), selectedTarget: analysis.targets[0] }} onTarget={onTarget} onAppeal={onAppeal} />);
    expect(screen.getAllByRole("radio").filter((item) => item.getAttribute("name") === "subject-target")).toHaveLength(3);
    await user.click(screen.getByRole("radio", { name: /1-1 타깃에 맞는 소구점/ }));
    await user.click(screen.getByRole("radio", { name: /1-2 타깃에 맞는 소구점/ }));
    expect(onAppeal).toHaveBeenLastCalledWith(expect.objectContaining({ id: "target-1-appeal-2" }));
  });
});
