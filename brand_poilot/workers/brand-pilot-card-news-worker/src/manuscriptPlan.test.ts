import { describe, expect, it } from "vitest";
import { compileCardManuscriptPlanDraftV1 } from "@brand-pilot/content-contracts/card-manuscript-plan";
import { parseCardManuscriptSubmissionForInput } from "./manuscriptPlan.js";

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
    outputSettings: { outputFormat: "card_news", purpose: "informational" },
    researchEvidence: { items: [{ id: id(1) }, { id: id(2) }] },
    product: { images: [{ assetId: id(3) }] },
    references: { brandStyleImages: [{ referenceItemId: id(4), tags: ["avatar"] }] },
  } as never;
}

function manuscript() {
  return {
    contractVersion: "card-manuscript-plan.v1",
    content: { caption: "변경 기준 정리", hashtags: ["youtube"], cta: "저장하세요" },
    deckNarrative: "발표에서 비교와 행동으로 이어진다.",
    evidenceSelection: { selectedEvidenceIds: [id(1), id(2)], excludedEvidenceIds: [] },
    scenes: [1, 2, 3].map((index) => ({
      index,
      editorialRole: index === 1 ? "cover" : index === 2 ? "comparison" : "action",
      purpose: `목적 ${index}`,
      coreMessage: `핵심 ${index}`,
      headline: `결론 ${index}`,
      informationRelation: index === 2
        ? { type: "before_after", entries: [{ role: "before", label: "기존", value: "4,000" }, { role: "after", label: "변경", value: "8,000" }] }
        : { type: "none", entries: [] },
      supportingTexts: [], footnote: null,
      evidenceIds: [id(index === 3 ? 2 : 1)],
      productImageAssetIds: index === 3 ? [id(3)] : [],
      avatarImageAssetIds: index === 1 ? [id(4)] : [],
    })),
  };
}

describe("card manuscript submission", () => {
  it("derives the compatibility draft deterministically from the manuscript source", () => {
    const frozenInput = input();
    const submission = parseCardManuscriptSubmissionForInput(manuscript(), frozenInput);

    expect(submission.planDraft).toEqual(compileCardManuscriptPlanDraftV1(
      submission.manuscriptPlan,
      frozenInput.selectedProposal.outline,
    ));
    expect(submission.cardManuscriptContract.manuscriptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(submission.manuscriptPlan)).not.toContain("visualSystem");
    expect(JSON.stringify(submission.manuscriptPlan)).not.toContain("layoutArchetype");
    expect(JSON.stringify(submission.manuscriptPlan)).not.toContain("visualThesis");
  });

  it.each([
    ["count", (value: any) => value.scenes.push({ ...structuredClone(value.scenes[2]), index: 4 }), "card_manuscript_plan_v1_invalid"],
    ["unknown evidence", (value: any) => { value.scenes[0].evidenceIds = [id(99)]; }, "card_manuscript_evidence_partition_invalid"],
    ["unknown product", (value: any) => { value.scenes[0].productImageAssetIds = [id(99)]; }, "product_image_id_unknown"],
    ["unknown avatar", (value: any) => { value.scenes[0].avatarImageAssetIds = [id(99)]; }, "avatar_image_id_unknown"],
  ])("rejects %s", (_name, mutate, error) => {
    const value = manuscript();
    mutate(value);
    expect(() => parseCardManuscriptSubmissionForInput(value, input())).toThrow(`card_news_plan_invalid:${error}`);
  });
});
