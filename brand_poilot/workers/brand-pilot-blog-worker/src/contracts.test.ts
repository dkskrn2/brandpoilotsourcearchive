import { describe, expect, it } from "vitest";
import { parseBlogJob, parseBlogPlanDraftV1 } from "./contracts.js";

const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function html(imageCount = 0, evidenceId = uid(1), evidenceUrl = "https://example.com/source") {
  const body = "독자가 바로 적용할 수 있는 구체적인 판단 기준과 설명입니다. ".repeat(85);
  const images = Array.from({ length: imageCount }, (_, index) => `<img src="asset://${String(index + 1).padStart(2, "0")}" alt="핵심 내용을 설명하는 이미지 ${index + 1}">`).join("");
  return `<article><h1>좋은 글은 어떻게 구성할까요?</h1><section data-summary="true"><p>핵심부터 답합니다.</p><p>근거를 연결합니다.</p><p>실행 기준을 제시합니다.</p></section><section><h2>무엇부터 확인해야 할까요?</h2><p>${body}<a href="${evidenceUrl}" data-evidence-id="${evidenceId}">근거</a></p>${images}</section><section data-references="true"><h2>어떤 자료를 참고했나요?</h2><p>사용한 자료입니다.</p><ul><li><a href="${evidenceUrl}" data-evidence-id="${evidenceId}">Source</a></li></ul></section></article>`;
}

function draft(imageCount = 0, evidenceId = uid(1)) {
  return {
    contractVersion: "blog-plan-draft.v1",
    content: { title: "좋은 글 구조", htmlTemplate: html(imageCount, evidenceId, evidenceId === uid(2) ? "https://example.com/supplement" : "https://example.com/source"), metaTitle: "좋은 글 구조 가이드", metaDescription: "좋은 글 구조를 구체적으로 설명합니다.", usedEvidenceIds: [evidenceId] },
    imageDraft: imageCount === 0 ? null : {
      aspectRatio: "16:9",
      assets: Array.from({ length: imageCount }, (_, index) => ({ index: index + 1, role: `설명 ${index + 1}`, copy: "핵심 내용을 보여 줍니다.", visualDirection: "읽기 쉬운 정보 시각화", evidenceIds: [evidenceId], productImageAssetIds: [] })),
    },
  };
}

const input = {
  researchEvidence: { items: [{ id: uid(1), url: "https://example.com/source" }] },
  product: null,
} as never;

describe("blog worker claim contract", () => {
  const job = { id: "job", generationId: "generation", outputId: "output", workspaceId: "workspace", brandId: "brand", jobType: "generate", outputFormat: "blog", status: "processing", payload: {}, leaseToken: "lease" };
  it("accepts only exact V3 generate jobs", () => {
    expect(parseBlogJob(job)).toEqual(job);
    expect(() => parseBlogJob({ ...job, jobType: "analyze" })).toThrow("blog_job_invalid");
    expect(() => parseBlogJob({ ...job, outputFormat: "card_news" })).toThrow("blog_job_invalid");
    expect(() => parseBlogJob({ ...job, contentType: "blog" })).toThrow("blog_job_invalid");
  });
});

describe("blog creative draft contract", () => {
  it("accepts semantic HTML with no images", () => {
    expect(parseBlogPlanDraftV1(draft(), input, null)).toMatchObject({
      contractVersion: "blog-plan-draft.v1",
      imageDraft: null,
    });
  });

  it("trims non-empty metadata and rejects whitespace-only metadata", () => {
    const value = draft() as Record<string, unknown> & { content: Record<string, unknown> };
    const padded = {
      ...value,
      content: {
        ...value.content,
        title: "  좋은 글 구조  ",
        metaTitle: "  좋은 글 구조 가이드  ",
        metaDescription: "  좋은 글 구조를 설명합니다.  ",
      },
    };
    expect(parseBlogPlanDraftV1(padded, input, null).content).toMatchObject({
      title: "좋은 글 구조",
      metaTitle: "좋은 글 구조 가이드",
      metaDescription: "좋은 글 구조를 설명합니다.",
    });
    for (const field of ["title", "metaTitle", "metaDescription"] as const) {
      expect(() => parseBlogPlanDraftV1({
        ...value,
        content: { ...value.content, [field]: "   \n\t " },
      }, input, null), field).toThrow("blog_plan_draft_invalid");
    }
  });

  it("accepts one through five consecutive creative image drafts and supplemental evidence", () => {
    const supplemental = { items: [{ id: uid(2), url: "https://example.com/supplement" }] } as never;
    expect(parseBlogPlanDraftV1(draft(5, uid(2)), input, supplemental).imageDraft?.assets).toHaveLength(5);
  });

  it.each(["generationId", "storagePath", "checksum", "logoPolicy", "attachments"])(
    "rejects immutable root field %s",
    (field) => expect(() => parseBlogPlanDraftV1({ ...draft(), [field]: "forbidden" }, input, null)).toThrow("blog_plan_draft_invalid"),
  );

  it("rejects attachment selection, unknown evidence, non-consecutive assets, and placeholder drift", () => {
    const withImage = draft(1) as Record<string, unknown> & { imageDraft: { assets: Array<Record<string, unknown>> }; content: { htmlTemplate: string } };
    expect(() => parseBlogPlanDraftV1({ ...withImage, imageDraft: { ...(withImage.imageDraft), assets: [{ ...withImage.imageDraft.assets[0], attachmentIds: [uid(9)] }] } }, input, null)).toThrow("blog_plan_draft_invalid");
    expect(() => parseBlogPlanDraftV1(draft(1, uid(9)), input, null)).toThrow("blog_plan_draft_invalid");
    expect(() => parseBlogPlanDraftV1({ ...withImage, imageDraft: { ...withImage.imageDraft, assets: [{ ...withImage.imageDraft.assets[0], index: 2 }] } }, input, null)).toThrow("blog_plan_draft_invalid");
    expect(() => parseBlogPlanDraftV1({ ...withImage, content: { ...withImage.content, htmlTemplate: withImage.content.htmlTemplate.replace("asset://01", "asset://02") } }, input, null)).toThrow("blog_html_asset_placeholder_invalid");
  });

  it("accepts only frozen product image IDs for a marketing image draft", () => {
    const productImageId = uid(3);
    const marketingInput = {
      ...input,
      product: { images: [{ assetId: productImageId }] },
    } as never;
    const withImage = draft(1) as Record<string, unknown> & { imageDraft: { assets: Array<Record<string, unknown>> } };
    const withProductImage = (assetId: string) => ({
      ...withImage,
      imageDraft: {
        ...withImage.imageDraft,
        assets: [{ ...withImage.imageDraft.assets[0], productImageAssetIds: [assetId] }],
      },
    });
    expect(parseBlogPlanDraftV1(withProductImage(productImageId), marketingInput, null).imageDraft?.assets[0]?.productImageAssetIds)
      .toEqual([productImageId]);
    expect(() => parseBlogPlanDraftV1(withProductImage(uid(9)), marketingInput, null))
      .toThrow("blog_plan_draft_invalid");
  });
});
