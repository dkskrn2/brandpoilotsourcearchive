import { describe, expect, it } from "vitest";
import { buildEditorialPrompt, parseEditorialPlan } from "./editorialPlan.js";
import type { AiContentJob } from "./contracts.js";

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
    expect(prompt).toContain("Brand Pilot은 어떤 서비스인가요?");
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
        { index: 2, role: "solution", headline: "한 번 저장하고 다시 사용합니다", keyMessage: "자사 URL과 기준을 생성에 재사용합니다.", evidenceIds: ["wiki-1"] },
      ],
      cta: "자사 URL을 등록하세요", excludedTopics: ["다른 컨설팅 서비스"], referenceUses: [],
    }, new Set(["subject-1", "wiki-1"]));
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
});
