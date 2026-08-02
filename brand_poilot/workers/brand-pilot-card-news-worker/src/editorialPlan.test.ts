import { describe, expect, it } from "vitest";
import { buildEditorialPrompt, parseCardNewsPlanV2, parseEditorialPlan } from "./editorialPlan.js";
import type { AiContentJob } from "./contracts.js";
import type { ContentGenerationInputV3 } from "@brand-pilot/worker-runtime";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const fixedInput: ContentGenerationInputV3 = {
  contractVersion: "content-generation-input.v3", generationId: uuid(10), capturedAt: "2026-07-31T00:00:00.000Z",
  brandCore: { versionId: uuid(1), companyOverview: "Company", businessDescription: "Business", primaryCategory: "Food", detailedCategory: "Tea", primaryTarget: "Adults", differentiator: "Fresh", coreAppeal: "Calm" },
  subject: { kind: "topic_text", title: "Tea guide" }, contentInstruction: "Practical copy", product: null,
  researchEvidence: { contractVersion: "research-evidence.v1", decision: "searched", reason: "Current sources", queries: ["tea"], capturedAt: "2026-07-31T00:00:00.000Z", items: [{ id: uuid(7), title: "Study", url: "https://evidence.example/study", publisher: null, publishedAt: null, capturedAt: "2026-07-31T00:00:00.000Z", claimSummary: "Use warm water", contentHash: "c".repeat(64) }] },
  references: {
    selected: [{ referenceItemId: uuid(5), snapshotId: uuid(6), roles: ["visual_composition"], title: "Editorial reference", sourceUrl: "https://reference.example/editorial", capturedAt: "2026-07-31T00:00:00.000Z", contentHash: "b".repeat(64), text: "Use a calm information hierarchy.", image: null }],
    brandStyleImages: [{ referenceItemId: uuid(5), description: "", tags: [], storageUrl: "https://cdn.example/style.webp", storagePath: "owned/style.webp", mimeType: "image/webp", checksum: "a".repeat(64) }],
    avatarStyleImageId: uuid(5),
    attachments: [{ id: uuid(8), role: "supporting_image", fileName: "tea.webp", mimeType: "image/webp", sizeBytes: 100, checksum: "d".repeat(64), storageUrl: "https://cdn.example/attachment.webp", storagePath: "owned/attachment.webp" }],
  },
  selectedProposal: {
    id: uuid(9), conceptKey: "tea-guide", title: "Tea guide", informationalType: "how_to", oneLineIntent: "Teach brewing", differentiator: "Simple", differentiationAxes: ["question"], target: "Adults", customerContext: "Choosing tea", keyMessage: "Brew well", hook: "Better tea", selectionReason: "Useful", evidenceIds: [uuid(7)], referenceIds: [uuid(5)], outputFormat: "card_news", channelTargets: ["instagram"], assetCount: 2,
    outline: [{ index: 1, role: "hook", headline: "Start", purpose: "Open" }, { index: 2, role: "guide", headline: "Steps", purpose: "Explain" }],
    purposeDetails: { kind: "informational", question: "How?", value: "Guidance", whyNow: "Better habits", learningPoints: ["Temperature"] },
  },
  userImageInstruction: "Soft light",
  outputSettings: { purpose: "informational", outputFormat: "card_news", channelTargets: ["instagram"], aspectRatio: "4:5", outputCount: 1 },
};

function v3Plan() {
  return {
    contractVersion: "card-news-plan.v2",
    content: { caption: "Useful tea guide", hashtags: ["tea"], cta: "Save this" },
    imagePackage: {
      contractVersion: "image-generation-package.v1", generationId: fixedInput.generationId,
      outputFormat: "card_news", purpose: "informational", assetCount: 2, aspectRatio: "4:5",
      channelTargets: ["instagram"],
      assets: [
        { index: 1, role: "hook", copy: "Start with the right temperature and a clear reason.", visualDirection: "Readable opening card with a warm cup.", evidenceIds: [], productImageAssetIds: [], attachmentIds: [] },
        { index: 2, role: "guide", copy: "Use warm water and check timing without crowding the card.", visualDirection: "Two-step mobile-friendly guide.", evidenceIds: [uuid(7)], productImageAssetIds: [], attachmentIds: [uuid(8)] },
      ],
      product: null, references: fixedInput.references.selected,
      brandStyleImages: fixedInput.references.brandStyleImages, avatarStyleImageId: fixedInput.references.avatarStyleImageId,
      attachments: fixedInput.references.attachments, userImageInstruction: fixedInput.userImageInstruction,
      logoPolicy: { allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true },
    },
  };
}

const job: AiContentJob = {
  id: "job-1", generationId: "generation-1", outputId: "output-1", workspaceId: "workspace-1", brandId: "brand-1",
  jobType: "generate", contentType: "card_news", status: "processing", leaseToken: "lease-1",
  payload: {
    title: "Growthline 브랜드 콘텐츠 운영 서비스",
    draft: {
      subjectInput: { name: "Brand Pilot", description: "자사 URL과 브랜드 기준을 재사용하는 콘텐츠 운영 서비스" },
      brief: { purpose: "sales", additionalInstruction: "서비스 소개" },
    },
    contentGenerationInput: {
      contractVersion: "content-generation-input.v2", contentType: "card_news",
      brandContext: { context: { wiki: { pages: [{ title: "Brand Pilot은 어떤 서비스인가요?", summary: "검토 후 Instagram 게시까지 관리합니다.", content: "자사 URL을 근거로 콘텐츠를 생성합니다." }] } } },
      subject: { analysisId: "analysis-1", analysisVersion: 2, analysisContractVersion: "subject-analysis.v2", analysisResult: { subjectType: "service", serviceProfile: {}, productProfile: null }, type: "service", sourceUrl: "https://example.com", facts: [{ key: "description", value: "운영 흐름을 연결합니다.", sourceUrl: "https://example.com" }], research: {}, selectedImages: [] },
      message: {
        target: { id: "target-1", name: "브랜드 담당자", painPoints: ["매번 같은 설명을 반복"] },
        appeal: { id: "appeal-1", targetId: "target-1", title: "자사 자료 재사용", description: "기존 자산을 운영 기준으로 전환" },
        qualityBrief: { evidence: [{ claim: "게시 전 검토할 수 있습니다.", support: "FAQ 근거" }] },
      },
      creativeDirection: { prompts: ["서비스 소개"], brandColor: "#0057B8", selectedColor: "#0057B8", aspectRatio: "1:1", outputCount: 1 },
      references: [], attachments: [],
    },
  },
};

describe("card-news editorial plan", () => {
  it("builds a compact planning prompt with subject and evidence identifiers", () => {
    const prompt = buildEditorialPrompt(job);
    expect(prompt).toContain("editorial-plan.v1");
    expect(prompt).toContain("Growthline 브랜드 콘텐츠 운영 서비스");
    expect(prompt).not.toContain("Brand Pilot은 어떤 서비스인가요?");
    expect(prompt).toContain('"id": "subject-1"');
    expect(prompt).toContain("CTA만 담은 별도 슬라이드는 만들지 말고");
    expect(prompt).toContain("evidencePool에 없는 상황을 새로 만들지 마세요");
    expect(prompt).not.toContain("image_generation");
  });

  it("accepts a grounded 1-5 slide plan", () => {
    const plan = parseEditorialPlan({
      version: "editorial-plan.v1", intent: "service_intro", singleSubject: "Brand Pilot",
      readerQuestion: "자료를 어떻게 운영에 재사용하는가?", corePromise: "저장된 기준을 다시 사용한다.",
      slides: [
        { index: 1, role: "problem", headline: "매번 다시 설명하고 있나요?", keyMessage: "자료는 있지만 기준이 흩어져 있습니다.", evidenceIds: ["subject-1"] },
        { index: 2, role: "solution", headline: "한 번 저장하고 다시 사용합니다", keyMessage: "자사 URL과 기준을 생성에 재사용합니다.", evidenceIds: ["subject-1"] },
      ],
      cta: "자사 URL을 등록하세요", excludedTopics: ["다른 컨설팅 서비스"], referenceUses: [],
    }, new Set(["subject-1"]));
    expect(plan.slides).toHaveLength(2);
  });

  it("rejects unknown evidence and duplicate slide indexes", () => {
    const base = {
      version: "editorial-plan.v1", intent: "information", singleSubject: "Brand Pilot",
      readerQuestion: "무엇인가?", corePromise: "설명한다.", cta: null, excludedTopics: [], referenceUses: [],
    };
    expect(() => parseEditorialPlan({ ...base, slides: [{ index: 1, role: "fact", headline: "제목", keyMessage: "내용", evidenceIds: ["missing"] }] }, new Set(["subject-1"]))).toThrow("editorial_plan_evidence_invalid");
    expect(() => parseEditorialPlan({ ...base, slides: [
      { index: 1, role: "fact", headline: "제목", keyMessage: "내용", evidenceIds: [] },
      { index: 1, role: "fact", headline: "제목2", keyMessage: "내용2", evidenceIds: [] },
    ] }, new Set())).toThrow("editorial_plan_slide_index_invalid");
  });

  it("accepts a v3 plan only when count, indexes, roles and fixed image-package inputs stay sealed", () => {
    const parsed = parseCardNewsPlanV2(v3Plan(), fixedInput);
    expect(parsed.imagePackage.assets.map(({ index, role }) => ({ index, role }))).toEqual(fixedInput.selectedProposal.outline.map(({ index, role }) => ({ index, role })));
    expect(parsed.imagePackage).toMatchObject({
      assetCount: 2,
      brandStyleImages: fixedInput.references.brandStyleImages,
      avatarStyleImageId: fixedInput.references.avatarStyleImageId,
      attachments: fixedInput.references.attachments,
      userImageInstruction: fixedInput.userImageInstruction,
    });
  });

  it("rejects unknown and duplicate per-scene evidence IDs with repairable details", () => {
    const unknown = v3Plan();
    unknown.imagePackage.assets[0]!.evidenceIds = [uuid(99)];
    expect(() => parseCardNewsPlanV2(unknown, fixedInput)).toThrow("card_news_plan_invalid:evidence_id_unknown");
    const duplicate = v3Plan();
    duplicate.imagePackage.assets[1]!.evidenceIds = [uuid(7), uuid(7)];
    expect(() => parseCardNewsPlanV2(duplicate, fixedInput)).toThrow("card_news_plan_invalid:evidence_id_duplicate");
    const malformed = v3Plan();
    malformed.imagePackage.assets[1]!.evidenceIds = ["not-a-uuid"];
    expect(() => parseCardNewsPlanV2(malformed, fixedInput)).toThrow("card_news_plan_invalid:evidence_ids_malformed");
  });

  it.each([
    ["count", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.assetCount = 1; }],
    ["index", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.assets[0]!.index = 2; }],
    ["role", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.assets[0]!.role = "changed"; }],
    ["no-logo", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.logoPolicy.allowGeneratedLogo = true as false; }],
  ])("rejects a v3 plan that changes the locked %s contract", (_name, mutate) => {
    const plan = v3Plan();
    mutate(plan);
    expect(() => parseCardNewsPlanV2(plan, fixedInput)).toThrow("card_news_plan_invalid");
  });
});
