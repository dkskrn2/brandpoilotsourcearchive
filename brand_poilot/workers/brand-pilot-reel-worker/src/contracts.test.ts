import { describe, expect, it } from "vitest";
import { parseReelJob, parseReelPlanDraftForInput } from "./contracts.js";

const uid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

function input() {
  return {
    outputSettings: { outputFormat: "reel", purpose: "informational" },
    researchEvidence: { items: [{ id: uid(1) }] },
    product: { images: [{ assetId: uid(2) }] },
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

describe("reel worker contract", () => {
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
