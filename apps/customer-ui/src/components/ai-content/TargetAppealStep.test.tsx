import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TargetAppealStep } from "./TargetAppealStep";
import { createMockAiContentGateway } from "../../features/ai-content/mockAiContentGateway";
import type { AiContentDraft, AiContentGateway, SubjectAnalysis } from "../../features/ai-content/types";
import { createInitialAiContentDraft, useAiContentDraft } from "../../features/ai-content/useAiContentDraft";

afterEach(cleanup);

async function analysisFixture() {
  return createMockAiContentGateway().requestSubjectAnalysis("brand-demo", {
    subjectType: "product",
    sourceUrl: "https://example.com/product",
    manualInput: { name: "제품", promotion: "", description: "" },
    idempotencyKey: "test",
  });
}

function selectedDraft(analysis: SubjectAnalysis): AiContentDraft {
  return {
    ...createInitialAiContentDraft("card_news"),
    selectedTarget: analysis.targets[0],
    selectedAppeal: analysis.appealsByTarget[analysis.targets[0].id][0],
  };
}

function renderStep({
  analysis,
  draft = selectedDraft(analysis),
  gateway = createMockAiContentGateway(),
}: {
  analysis: SubjectAnalysis;
  draft?: AiContentDraft;
  gateway?: AiContentGateway;
}) {
  const callbacks = {
    onTarget: vi.fn(),
    onAppeal: vi.fn(),
    onAppealsChange: vi.fn(),
    onResetAppeals: vi.fn(),
    onAnalysis: vi.fn(),
  };
  render(
    <TargetAppealStep
      analysis={analysis}
      draft={draft}
      gateway={gateway}
      brandId="brand-demo"
      {...callbacks}
    />,
  );
  return callbacks;
}

describe("TargetAppealStep", () => {
  it("renders exactly three recommendations and replaces the selected appeal", async () => {
    const user = userEvent.setup();
    const analysis = await analysisFixture();
    const callbacks = renderStep({ analysis });

    expect(screen.getAllByRole("radio").filter((item) => item.getAttribute("name") === "subject-target")).toHaveLength(3);
    await user.click(screen.getByRole("radio", { name: /1-1 타깃에 맞는 소구점/ }));
    await user.click(screen.getByRole("radio", { name: /1-2 타깃에 맞는 소구점/ }));

    expect(callbacks.onAppeal).toHaveBeenLastCalledWith(expect.objectContaining({ id: "target-1-appeal-2" }));
  });

  it("stores edits in overrides and immediately refreshes the selected appeal snapshot", () => {
    const sourceAppeal = {
      id: "appeal-1",
      targetId: "target-1",
      title: "원본 제목",
      description: "원본 설명",
      evidenceType: "product_fact" as const,
      connectionReason: "근거",
      sources: [],
    };
    const { result } = renderHook(() => useAiContentDraft("card_news"));

    act(() => result.current.setTarget({ id: "target-1", name: "타깃", traits: [], painPoints: [], purchaseMotivations: [], uspEvidence: [] }));
    act(() => result.current.setAppeal(sourceAppeal));
    act(() => result.current.setAppealsForTarget("target-1", [{ ...sourceAppeal, title: "수정 제목", description: "수정 설명" }]));

    expect(sourceAppeal).toMatchObject({ title: "원본 제목", description: "원본 설명" });
    expect(result.current.draft.appealOverridesByTarget["target-1"][0]).toMatchObject({ title: "수정 제목", description: "수정 설명" });
    expect(result.current.draft.selectedAppeal).toMatchObject({ title: "수정 제목", description: "수정 설명" });
  });

  it("edits appeal fields through labelled controls", async () => {
    const user = userEvent.setup();
    const analysis = await analysisFixture();
    const callbacks = renderStep({ analysis });
    const appeal = analysis.appealsByTarget[analysis.targets[0].id][0];

    const editButton = screen.getByRole("button", { name: `소구점 편집: ${appeal.title}` });
    expect(editButton).toHaveAttribute("title", `소구점 편집: ${appeal.title}`);
    await user.click(editButton);
    await user.clear(screen.getByLabelText("소구점 제목 편집"));
    await user.type(screen.getByLabelText("소구점 제목 편집"), "수정 제목");
    await user.clear(screen.getByLabelText("소구점 설명 편집"));
    await user.type(screen.getByLabelText("소구점 설명 편집"), "수정 설명");

    expect(callbacks.onAppealsChange).toHaveBeenLastCalledWith(
      analysis.targets[0].id,
      expect.arrayContaining([expect.objectContaining({ id: appeal.id, title: "수정 제목", description: "수정 설명" })]),
    );
  });

  it("auto-selects a manually added appeal", async () => {
    const user = userEvent.setup();
    const analysis = await analysisFixture();
    const callbacks = renderStep({ analysis });

    await user.type(screen.getByLabelText("직접 입력 소구점 제목"), "직접 만든 제목");
    await user.type(screen.getByLabelText("직접 입력 소구점 설명"), "직접 만든 설명");
    await user.click(screen.getByRole("button", { name: "이 소구점 선택" }));

    expect(callbacks.onAppealsChange).toHaveBeenCalledWith(
      analysis.targets[0].id,
      expect.arrayContaining([expect.objectContaining({ title: "직접 만든 제목" })]),
    );
    expect(callbacks.onAppeal).toHaveBeenCalledWith(expect.objectContaining({ title: "직접 만든 제목", targetId: analysis.targets[0].id }));
  });

  it("deletes an unselected appeal without clearing selection and clears a deleted selection", async () => {
    const user = userEvent.setup();
    const analysis = await analysisFixture();
    const draft = selectedDraft(analysis);
    const selected = draft.selectedAppeal!;
    const unselected = analysis.appealsByTarget[analysis.targets[0].id][1];
    const callbacks = renderStep({ analysis, draft });

    const deleteButton = screen.getByRole("button", { name: `소구점 삭제: ${unselected.title}` });
    expect(deleteButton).toHaveAttribute("title", `소구점 삭제: ${unselected.title}`);
    await user.click(deleteButton);
    expect(callbacks.onAppeal).not.toHaveBeenCalledWith(null);
    expect(callbacks.onAppealsChange).toHaveBeenLastCalledWith(
      analysis.targets[0].id,
      [expect.objectContaining({ id: selected.id })],
    );

    await user.click(screen.getByRole("button", { name: `소구점 삭제: ${selected.title}` }));
    expect(callbacks.onAppeal).toHaveBeenLastCalledWith(null);
  });

  it("calls appeal regeneration once, blocks duplicate clicks, and replaces recommendations when ready", async () => {
    const user = userEvent.setup();
    const analysis = await analysisFixture();
    let resolveRegeneration!: (value: SubjectAnalysis) => void;
    const regenerated = {
      ...analysis,
      appealsByTarget: {
        ...analysis.appealsByTarget,
        [analysis.targets[0].id]: [{
          ...analysis.appealsByTarget[analysis.targets[0].id][0],
          id: "regenerated-appeal",
          title: "새 추천 소구점",
        }],
      },
    };
    const gateway = createMockAiContentGateway();
    const regenerate = vi.spyOn(gateway, "regenerateSubjectAppeals").mockImplementation(() => new Promise((resolve) => {
      resolveRegeneration = resolve;
    }));
    const callbacks = renderStep({
      analysis,
      draft: { ...selectedDraft(analysis), appealOverridesByTarget: { [analysis.targets[0].id]: [{ ...analysis.appealsByTarget[analysis.targets[0].id][0], title: "사용자 수정" }] } },
      gateway,
    });

    const button = screen.getByRole("button", { name: "소구점 다시 만들기" });
    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);
    expect(regenerate).toHaveBeenCalledTimes(1);

    resolveRegeneration(regenerated);
    expect(await screen.findByText("새 추천 소구점")).toBeVisible();
    expect(screen.queryByText("사용자 수정")).not.toBeInTheDocument();
    expect(callbacks.onResetAppeals).toHaveBeenCalledWith(analysis.targets[0].id);
    expect(callbacks.onAppeal).toHaveBeenCalledWith(null);
    expect(callbacks.onAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      facts: analysis.facts,
      research: analysis.research,
      targets: analysis.targets,
      appealsByTarget: regenerated.appealsByTarget,
    }));
  });
});
