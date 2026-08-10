import { describe, expect, it } from "vitest";
import { ALL_CONTENT_SCHEMAS } from "./index.js";
import { generateArtifactSet } from "./generateArtifacts.js";
import {
  parseBlogPlanDraftV1,
  parseCardNewsPlanDraftV1,
  parseContentPlanDraftV1,
  parseReelPlanDraftV1,
} from "./plannerDrafts.js";

const EVIDENCE_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_IMAGE_ID = "22222222-2222-4222-8222-222222222222";

const socialContent = {
  caption: "독자가 바로 이해할 수 있는 캡션",
  hashtags: ["#브랜드파일럿"],
  cta: "자세한 내용을 확인해 보세요.",
};

const blogContent = {
  title: "콘텐츠 제목",
  htmlTemplate: "<article><h1>콘텐츠 제목</h1><p>본문</p></article>",
  metaTitle: "검색용 제목",
  metaDescription: "검색 결과에 노출할 설명",
  usedEvidenceIds: [EVIDENCE_ID],
};

function asset(index = 1) {
  return {
    index,
    role: "hook",
    copy: "첫 장에서 전달할 핵심 문구",
    visualDirection: "모바일에서 읽기 쉬운 높은 대비의 편집 디자인",
    evidenceIds: [EVIDENCE_ID],
    productImageAssetIds: [PRODUCT_IMAGE_ID],
  };
}

const cardNewsDraft = () => ({
  contractVersion: "card-news-plan-draft.v1" as const,
  content: socialContent,
  assets: [asset()],
});

const reelDraft = () => ({
  contractVersion: "reel-plan-draft.v1" as const,
  content: socialContent,
  assets: [asset()],
});

const blogDraft = () => ({
  contractVersion: "blog-plan-draft.v1" as const,
  content: blogContent,
  imageDraft: {
    aspectRatio: "4:5" as const,
    assets: [asset()],
  },
});

const cells = [
  ["card_news", "informational", parseCardNewsPlanDraftV1, cardNewsDraft],
  ["card_news", "marketing", parseCardNewsPlanDraftV1, cardNewsDraft],
  ["blog", "informational", parseBlogPlanDraftV1, blogDraft],
  ["blog", "marketing", parseBlogPlanDraftV1, blogDraft],
  ["reel", "informational", parseReelPlanDraftV1, reelDraft],
  ["reel", "marketing", parseReelPlanDraftV1, reelDraft],
] as const;

describe("private planner draft contracts", () => {
  it.each(cells)("parses the exact %s/%s creative-only cell", (_format, _purpose, parse, fixture) => {
    const value = fixture();
    expect(parse(value)).toEqual(value);
    expect(parseContentPlanDraftV1(value)).toEqual(value);
  });

  it.each(cells)("rejects immutable root fields for %s/%s", (_format, _purpose, parse, fixture) => {
    for (const forbidden of [
      "generationId",
      "outputFormat",
      "purpose",
      "product",
      "references",
      "attachments",
      "storagePath",
      "checksum",
      "logoPolicy",
      "unknownProperty",
    ]) {
      expect(() => parse({ ...fixture(), [forbidden]: "forbidden" }), forbidden).toThrow();
    }
  });

  it.each([
    [parseCardNewsPlanDraftV1, cardNewsDraft],
    [parseReelPlanDraftV1, reelDraft],
    [parseBlogPlanDraftV1, blogDraft],
  ] as const)("rejects immutable and unknown creative asset fields", (parse, fixture) => {
    const value = fixture();
    const creativeAsset = value.contractVersion === "blog-plan-draft.v1"
      ? value.imageDraft.assets[0]
      : value.assets[0];
    for (const forbidden of ["attachmentIds", "storagePath", "checksum", "logoPolicy", "unknownProperty"]) {
      const invalidAsset = { ...creativeAsset, [forbidden]: "forbidden" };
      const invalid = value.contractVersion === "blog-plan-draft.v1"
        ? { ...value, imageDraft: { ...value.imageDraft, assets: [invalidAsset] } }
        : { ...value, assets: [invalidAsset] };
      expect(() => parse(invalid), forbidden).toThrow();
    }
  });

  it("accepts a blog without images and constrains image drafts to one through five assets", () => {
    expect(parseBlogPlanDraftV1({ ...blogDraft(), imageDraft: null }).imageDraft).toBeNull();
    expect(parseBlogPlanDraftV1({
      ...blogDraft(),
      imageDraft: { aspectRatio: "16:9", assets: Array.from({ length: 5 }, (_, index) => asset(index + 1)) },
    }).imageDraft).not.toBeNull();
    expect(() => parseBlogPlanDraftV1({
      ...blogDraft(),
      imageDraft: { aspectRatio: "16:9", assets: [] },
    })).toThrow("blog_plan_draft_v1_invalid");
    expect(() => parseBlogPlanDraftV1({
      ...blogDraft(),
      imageDraft: { aspectRatio: "16:9", assets: Array.from({ length: 6 }, (_, index) => asset(index + 1)) },
    })).toThrow("blog_plan_draft_v1_invalid");
  });

  it("constrains social drafts to one through five assets", () => {
    expect(() => parseCardNewsPlanDraftV1({ ...cardNewsDraft(), assets: [] }))
      .toThrow("card_news_plan_draft_v1_invalid");
    expect(() => parseReelPlanDraftV1({
      ...reelDraft(),
      assets: Array.from({ length: 6 }, (_, index) => asset(index + 1)),
    })).toThrow("reel_plan_draft_v1_invalid");
  });

  it("uses exact discriminators and stable parser error codes", () => {
    expect(() => parseCardNewsPlanDraftV1(reelDraft())).toThrow("card_news_plan_draft_v1_invalid");
    expect(() => parseReelPlanDraftV1(cardNewsDraft())).toThrow("reel_plan_draft_v1_invalid");
    expect(() => parseBlogPlanDraftV1(cardNewsDraft())).toThrow("blog_plan_draft_v1_invalid");
    expect(() => parseContentPlanDraftV1({ contractVersion: "unknown" }))
      .toThrow("content_plan_draft_v1_invalid");
  });

  it("does not register private drafts in canonical schemas or generated artifacts", async () => {
    expect(Object.keys(ALL_CONTENT_SCHEMAS)).not.toContain("plannerDrafts");
    expect([...await generateArtifactSet()].map(([filename]) => filename))
      .not.toContain("planner-draft-v1.schema.json");
  });
});
