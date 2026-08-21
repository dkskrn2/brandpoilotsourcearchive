import { describe, expect, it } from "vitest";
import {
  parseReelJob,
  parseReelPlanDraftForInput,
  parseReelStoryboardSubmissionForInput,
} from "./contracts.js";

const uid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

function input() {
  return {
    outputSettings: { outputFormat: "reel", purpose: "informational" },
    researchEvidence: { items: [{ id: uid(1) }] },
    product: { images: [{ assetId: uid(2) }] },
    references: { brandStyleImages: [{ referenceItemId: uid(3), tags: ["avatar"] }] },
    selectedProposal: {
      assetCount: 2,
      outline: [
        { index: 1, role: "hook", headline: "Open", purpose: "Stop the scroll" },
        { index: 2, role: "explanation", headline: "Explain", purpose: "Deliver the answer" },
      ],
    },
  } as never;
}

function draft() {
  return {
    contractVersion: "reel-plan-draft.v1",
    content: { caption: "핵심을 설명합니다.", hashtags: ["#가이드"], cta: "저장해 두세요." },
    assets: [
      { index: 1, role: "hook", copy: "첫 장면", visualDirection: "큰 제목", evidenceIds: [uid(1)], productImageAssetIds: [uid(2)] },
      { index: 2, role: "explanation", copy: "두 번째 장면", visualDirection: "명확한 설명", evidenceIds: [uid(1)], productImageAssetIds: [uid(2)] },
    ],
  };
}

function storyboard() {
  return {
    contractVersion: "reel-storyboard.v2",
    content: { caption: "핵심을 설명합니다.", hashtags: ["#가이드"], cta: "저장해 두세요." },
    storyNarrative: "온도의 차이를 설명한 뒤 실행 순서로 이어진다.",
    evidenceSelection: { selectedEvidenceIds: [uid(1)], excludedEvidenceIds: [] },
    scenes: [
      {
        index: 1,
        editorialRole: "hook",
        purpose: "온도가 맛을 바꾼다는 사실을 알린다.",
        coreMessage: "온도 하나가 맛을 바꿉니다.",
        headline: "차 맛은 온도에서 갈립니다",
        informationRelation: { type: "number", entries: [{ role: "value", label: null, value: "80°C" }] },
        supportingTexts: ["떫은맛은 줄이고 향은 살립니다"],
        footnote: "차 종류에 따라 달라질 수 있습니다",
        evidenceIds: [uid(1)],
        productImageAssetIds: [uid(2)],
        avatarImageAssetIds: [uid(3)],
      },
      {
        index: 2,
        editorialRole: "explanation",
        purpose: "실행 순서를 안내한다.",
        coreMessage: "순서대로 따르면 됩니다.",
        headline: "세 단계로 끝내세요",
        informationRelation: { type: "steps", entries: [
          { role: "step", label: null, value: "데우기" },
          { role: "step", label: null, value: "우리기" },
          { role: "step", label: null, value: "마시기" },
        ] },
        supportingTexts: [],
        footnote: null,
        evidenceIds: [uid(1)],
        productImageAssetIds: [],
        avatarImageAssetIds: [],
      },
    ],
  };
}

describe("reel worker contract", () => {
  it("compiles the storyboard to the existing reel-plan-draft.v1 API body", () => {
    expect(parseReelStoryboardSubmissionForInput(storyboard(), input()).planDraft).toEqual({
      contractVersion: "reel-plan-draft.v1",
      content: storyboard().content,
      assets: [
        {
          index: 1,
          role: "hook",
          copy: "차 맛은 온도에서 갈립니다\n80°C\n떫은맛은 줄이고 향은 살립니다\n차 종류에 따라 달라질 수 있습니다",
          visualDirection: expect.stringContaining("image model owns composition"),
          evidenceIds: [uid(1)],
          productImageAssetIds: [uid(2)],
        },
        {
          index: 2,
          role: "explanation",
          copy: "세 단계로 끝내세요\n데우기\n우리기\n마시기",
          visualDirection: expect.stringContaining("image model owns composition"),
          evidenceIds: [uid(1)],
          productImageAssetIds: [],
        },
      ],
    });
  });

  it("rejects filler fields and inconsistent key visual structure", () => {
    expect(() => parseReelStoryboardSubmissionForInput({
      ...storyboard(),
      scenes: [{ ...storyboard().scenes[0], extraCopy: "채우기 문구" }, storyboard().scenes[1]],
    }, input())).toThrow("reel_structured_draft_invalid");
    expect(() => parseReelStoryboardSubmissionForInput({
      ...storyboard(),
      scenes: [{ ...storyboard().scenes[0], informationRelation: { type: "none", entries: [{ role: "value", label: null, value: "불필요" }] } }, storyboard().scenes[1]],
    }, input())).toThrow("reel_structured_draft_invalid");
    expect(() => parseReelStoryboardSubmissionForInput({
      ...storyboard(),
      scenes: [{ ...storyboard().scenes[0], supportingTexts: ["1", "2", "3"] }, storyboard().scenes[1]],
    }, input())).toThrow("reel_structured_draft_invalid");
  });

  it("accepts only V3 reel generate jobs", () => {
    const job = {
      id: "job-1", generationId: "generation-1", outputId: "output-1",
      workspaceId: "workspace-1", brandId: "brand-1", jobType: "generate",
      outputFormat: "reel", status: "processing", payload: {}, leaseToken: "lease-1",
    };
    expect(parseReelJob(job)).toEqual(job);
    expect(() => parseReelJob({ ...job, outputFormat: "marketing" })).toThrow("reel_job_invalid");
    expect(() => parseReelJob({ ...job, jobType: "analyze" })).toThrow("reel_job_invalid");
  });

  it("accepts only a creative reel draft and rejects immutable plan fields", () => {
    expect(parseReelPlanDraftForInput(draft(), input())).toEqual(draft());
    expect(() => parseReelPlanDraftForInput({ ...draft(), generationId: uid(9) }, input()))
      .toThrow("reel_plan_draft_v1_invalid");
    expect(() => parseReelPlanDraftForInput({
      ...draft(),
      assets: [{ ...draft().assets[0], attachmentIds: [uid(8)] }, draft().assets[1]],
    }, input())).toThrow("reel_plan_draft_v1_invalid");
  });

  it("locks the draft to the selected outline count, index, and role", () => {
    expect(() => parseReelPlanDraftForInput({ ...draft(), assets: draft().assets.slice(0, 1) }, input()))
      .toThrow("reel_plan_draft_outline_mismatch");
    expect(() => parseReelPlanDraftForInput({
      ...draft(), assets: [{ ...draft().assets[0], index: 2 }, draft().assets[1]],
    }, input())).toThrow("reel_plan_draft_outline_mismatch");
    expect(() => parseReelPlanDraftForInput({
      ...draft(), assets: [{ ...draft().assets[0], role: "different" }, draft().assets[1]],
    }, input())).toThrow("reel_plan_draft_outline_mismatch");
  });

  it("rejects unknown and duplicate evidence IDs", () => {
    expect(() => parseReelPlanDraftForInput({
      ...draft(), assets: [{ ...draft().assets[0], evidenceIds: [uid(9)] }, draft().assets[1]],
    }, input())).toThrow("reel_plan_draft_evidence_id_unknown");
    expect(() => parseReelPlanDraftForInput({
      ...draft(), assets: [{ ...draft().assets[0], evidenceIds: [uid(1), uid(1)] }, draft().assets[1]],
    }, input())).toThrow("reel_plan_draft_evidence_id_duplicate");
  });

  it("rejects unknown and duplicate product image IDs", () => {
    expect(() => parseReelPlanDraftForInput({
      ...draft(), assets: [{ ...draft().assets[0], productImageAssetIds: [uid(9)] }, draft().assets[1]],
    }, input())).toThrow("reel_plan_draft_product_image_id_unknown");
    expect(() => parseReelPlanDraftForInput({
      ...draft(), assets: [{ ...draft().assets[0], productImageAssetIds: [uid(2), uid(2)] }, draft().assets[1]],
    }, input())).toThrow("reel_plan_draft_product_image_id_duplicate");
  });

  it("rejects unknown avatar image IDs in the storyboard", () => {
    const value = storyboard();
    value.scenes[0].avatarImageAssetIds = [uid(9)];
    expect(() => parseReelStoryboardSubmissionForInput(value, input()))
      .toThrow("reel_storyboard_avatar_image_id_unknown");
  });

  it.each([
    { content: { ...draft().content, caption: "   " } },
    { content: { ...draft().content, cta: "\t" } },
    { content: { ...draft().content, hashtags: ["  "] } },
  ])("rejects whitespace-only social content %#", ({ content }) => {
    expect(() => parseReelPlanDraftForInput({ ...draft(), content }, input()))
      .toThrow("reel_plan_draft_content_invalid");
  });

  it("rejects hashtags that become duplicates after trimming without mutating valid drafts", () => {
    expect(() => parseReelPlanDraftForInput({
      ...draft(), content: { ...draft().content, hashtags: ["#가이드", "  #가이드  "] },
    }, input())).toThrow("reel_plan_draft_hashtag_duplicate");

    const valid = draft();
    valid.content.hashtags = ["  #가이드  "];
    expect(parseReelPlanDraftForInput(valid, input())).toBe(valid);
    expect(valid.content.hashtags).toEqual(["  #가이드  "]);
  });
});
