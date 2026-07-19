import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerationPromptStep } from "./GenerationPromptStep";
import { createMockAiContentGateway } from "../../features/ai-content/mockAiContentGateway";
import { createInitialAiContentDraft } from "../../features/ai-content/useAiContentDraft";

afterEach(cleanup);

describe("GenerationPromptStep", () => {
  it("uses the brand color by default and applies the first prompt to every output", async () => {
    const user = userEvent.setup();
    const onBrief = vi.fn();
    const gateway = createMockAiContentGateway();
    function Harness() {
      const [draft, setDraft] = useState(createInitialAiContentDraft("marketing"));
      return <GenerationPromptStep brandId="brand-demo" gateway={gateway} draft={draft} onBrief={(brief) => { onBrief(brief); setDraft((current) => ({ ...current, brief })); }} generationId={null} />;
    }
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText("생성 결과 수"), "3");
    const directions = screen.getAllByRole("textbox", { name: /결과 \d 지시/ });
    await user.type(directions[0], "문제 상황을 먼저 보여 주세요");
    await user.click(screen.getByRole("button", { name: "첫 지시 전체 적용" }));
    expect(onBrief).toHaveBeenLastCalledWith(expect.objectContaining({ outputDirections: ["문제 상황을 먼저 보여 주세요", "문제 상황을 먼저 보여 주세요", "문제 상황을 먼저 보여 주세요"] }));
    expect(screen.getByLabelText("브랜드 대표 색상")).toHaveValue("#0057b8");
  });
});
