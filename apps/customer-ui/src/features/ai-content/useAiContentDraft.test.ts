import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAiContentDraft } from "./useAiContentDraft";
import type { AppealSnapshot, AudienceSnapshot, SubjectAppeal, SubjectTarget } from "./types";

const target = (id: string): SubjectTarget => ({
  id,
  name: `타깃 ${id}`,
  traits: ["상황"],
  painPoints: ["문제"],
  purchaseMotivations: ["동기"],
  uspEvidence: [],
});

const appeal = (id: string, targetId: string): SubjectAppeal => ({
  id,
  targetId,
  title: `소구점 ${id}`,
  description: "설명",
  evidenceType: "product_fact",
  connectionReason: "연결 이유",
  sources: [],
});

describe("useAiContentDraft", () => {
  it("keeps the five-step draft and defaults the editable color", () => {
    const { result } = renderHook(() => useAiContentDraft("card_news"));

    expect(result.current.step).toBeLessThanOrEqual(5);
    expect(result.current.draft.brief?.selectedColor).toBe("#0057B8");
    act(() => result.current.goNext());
    act(() => result.current.goNext());
    act(() => result.current.goNext());
    act(() => result.current.goNext());
    act(() => result.current.goNext());
    expect(result.current.step).toBe(5);
  });

  it("replaces the selected target and appeal instead of accumulating them", () => {
    const { result } = renderHook(() => useAiContentDraft("marketing"));
    const firstTarget = target("target-1");
    const secondTarget = target("target-2");

    act(() => result.current.setTarget(firstTarget));
    act(() => result.current.setAppeal(appeal("appeal-1", firstTarget.id)));
    act(() => result.current.setTarget(secondTarget));
    act(() => result.current.setAppeal(appeal("appeal-2", secondTarget.id)));

    expect(result.current.draft.selectedTarget?.id).toBe("target-2");
    expect(result.current.draft.selectedAppeal?.id).toBe("appeal-2");
    expect(result.current.draft.secondaryAppeals).toEqual([]);
  });

  it("clears the appeal only when the selected target changes", () => {
    const { result } = renderHook(() => useAiContentDraft("marketing"));
    const firstTarget = target("target-1");

    act(() => result.current.setTarget(firstTarget));
    act(() => result.current.setAppeal(appeal("appeal-1", firstTarget.id)));
    act(() => result.current.setTarget({ ...firstTarget, name: "갱신된 타깃" }));
    expect(result.current.draft.selectedAppeal?.id).toBe("appeal-1");

    act(() => result.current.setTarget(target("target-2")));
    expect(result.current.draft.selectedAppeal).toBeNull();
    expect(result.current.draft.coreAppeal).toBeNull();
  });

  it("ignores an appeal that does not belong to the selected target", () => {
    const { result } = renderHook(() => useAiContentDraft("marketing"));

    act(() => result.current.setTarget(target("target-1")));
    act(() => result.current.setAppeal(appeal("wrong-appeal", "target-2")));

    expect(result.current.draft.selectedAppeal).toBeNull();
    expect(result.current.draft.coreAppeal).toBeNull();
  });

  it("maps legacy audience and appeal actions to one canonical target and appeal", () => {
    const { result } = renderHook(() => useAiContentDraft("card_news"));
    const audience: AudienceSnapshot = {
      id: "legacy-target",
      name: "기존 고객",
      situation: "상황",
      problem: "문제",
      motivation: "동기",
    };
    const coreAppeal: AppealSnapshot = {
      id: "legacy-appeal",
      title: "기존 소구점",
      description: "설명",
      evidenceType: "benefit",
    };

    act(() => result.current.setAudience(audience));
    act(() => result.current.setAppeals(coreAppeal, [{ ...coreAppeal, id: "secondary" }]));

    expect(result.current.draft.selectedTarget?.id).toBe(audience.id);
    expect(result.current.draft.selectedAppeal).toMatchObject({ id: coreAppeal.id, targetId: audience.id });
    expect(result.current.draft.secondaryAppeals).toEqual([]);
  });

  it("preserves explicit reference order and image selection", () => {
    const { result } = renderHook(() => useAiContentDraft("blog"));

    act(() => result.current.setReferences(["reference-a", "reference-b", "reference-c"]));
    act(() => result.current.reorderReference(2, 0));
    act(() => result.current.setSelectedSubjectImages(["image-2"]));

    expect(result.current.draft.referenceIds).toEqual(["reference-c", "reference-a", "reference-b"]);
    expect(result.current.draft.selectedSubjectImageIds).toEqual(["image-2"]);
  });
});
