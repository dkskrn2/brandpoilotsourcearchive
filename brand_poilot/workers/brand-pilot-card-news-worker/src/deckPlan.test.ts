import { describe, expect, it } from "vitest";
import { compileCardDeckPlanDraftV1, compileCardDeckSceneV1 } from "@brand-pilot/content-contracts/card-deck-editorial-plan";
import { compileStructuredScene } from "@brand-pilot/content-contracts/structured-scene-copy";
import { parseCardDeckSubmissionForInput } from "./deckPlan.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function input() {
  return {
    selectedProposal: {
      assetCount: 3,
      outline: [
        { index: 1, role: "hook" },
        { index: 2, role: "comparison" },
        { index: 3, role: "action" },
      ],
    },
    researchEvidence: { items: [{ id: id(1) }, { id: id(2) }] },
    product: { images: [{ assetId: id(3) }] },
    references: { brandStyleImages: [{ referenceItemId: id(4), tags: ["avatar"] }] },
  } as never;
}

function deck() {
  return {
    contractVersion: "card-deck-editorial-plan.v1",
    content: { caption: "변경 기준 정리", hashtags: ["youtube"], cta: "저장하세요" },
    deckNarrative: "발표에서 비교와 행동으로 이어진다.",
    visualSystem: {
      paletteDirection: "white red black", typographyDirection: "large Korean type", graphicLanguage: "editorial infographic",
      imageryDirection: "numbers first", invariants: ["same margins", "same card number"],
    },
    scenes: [1, 2, 3].map((index) => ({
      index,
      editorialRole: index === 1 ? "cover" : index === 2 ? "comparison" : "action",
      purpose: `목적 ${index}`,
      coreMessage: `핵심 ${index}`,
      headline: `결론 ${index}`,
      keyVisual: index === 2
        ? { type: "before_after", entries: [{ role: "before", label: "기존", value: "4,000" }, { role: "after", label: "변경", value: "8,000" }] }
        : { type: "none", entries: [] },
      supportingTexts: [], footnote: null,
      visualThesis: `시각 논지 ${index}`,
      layoutArchetype: index === 2 ? "before_after" : "editorial_freeform",
      evidenceIds: [id(index === 3 ? 2 : 1)],
      productImageAssetIds: index === 3 ? [id(3)] : [],
      avatarImageAssetIds: index === 1 ? [id(4)] : [],
    })),
  };
}

describe("card deck submission", () => {
  it("derives the compatibility plan from the single deck source", () => {
    const frozenInput = input();
    const submission = parseCardDeckSubmissionForInput(deck(), frozenInput);

    expect(submission.planDraft).toEqual(compileCardDeckPlanDraftV1(submission.deckPlan, frozenInput.selectedProposal.outline));
    expect(submission.planDraft.assets).toEqual(submission.deckPlan.scenes.map((scene, offset) =>
      compileStructuredScene(compileCardDeckSceneV1(
        submission.deckPlan,
        scene,
        frozenInput.selectedProposal.outline[offset]!.role,
      )),
    ));
    expect(submission.cardDeckContract.deckSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["count", (value: any) => value.scenes.push({ ...structuredClone(value.scenes[2]), index: 4 }), "asset_count_mismatch"],
    ["index", (value: any) => { value.scenes[0].index = 2; }, "card_deck_editorial_plan_invalid"],
    ["unknown evidence", (value: any) => { value.scenes[0].evidenceIds = [id(99)]; }, "evidence_id_unknown"],
    ["unknown product", (value: any) => { value.scenes[0].productImageAssetIds = [id(99)]; }, "product_image_id_unknown"],
    ["unknown avatar", (value: any) => { value.scenes[0].avatarImageAssetIds = [id(99)]; }, "avatar_image_id_unknown"],
  ])("rejects %s", (_name, mutate, error) => {
    const value = deck();
    mutate(value);
    expect(() => parseCardDeckSubmissionForInput(value, input())).toThrow(`card_news_plan_invalid:${error}`);
  });
});
