import { describe, expect, it } from "vitest";
import { buildBlogPlanPrompt, buildPrompt } from "./promptBuilder.js";
import { parseContentGenerationInput } from "./contracts.js";

const job = {
  id: "j", generationId: "g", outputId: "o", workspaceId: "w", brandId: "b", jobType: "generate" as const,
  contentType: "blog" as const, status: "processing" as const, leaseToken: "l",
  payload: { contentGenerationInput: {
    contractVersion: "content-generation-input.v2", contentType: "blog", brandContext: { name: "브랜드" },
    subject: { analysisId: "analysis-1", analysisVersion: 2, analysisContractVersion: "subject-analysis.v2", analysisResult: { subjectType: "service", serviceSubtype: "saas", serviceProfile: { customerProblem: ["수동 처리"] }, productProfile: null }, type: "service", sourceUrl: "https://example.com/service", facts: [{ claim: "검증된 사실" }], research: { claims: [{ sourceUrl: "https://research.example" }] }, selectedImages: [{ id: "img-1", url: "https://cdn.example/image.png", role: "product", altText: "제품" }] },
    message: { target: { id: "target-1" }, appeal: { id: "appeal-1", targetId: "target-1" }, qualityBrief: { readerPayoff: "이해" } },
    creativeDirection: { prompts: ["첫 번째 블로그 지시"], brandColor: "#0057B8", selectedColor: "#0F766E", aspectRatio: "16:9", outputCount: 1 },
    references: [{ previewUrl: "https://cdn.example/reference.png" }], attachments: [],
  } },
};

const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const v3Input = {
  contractVersion: "content-generation-input.v3" as const, generationId: uid(1),
  brandCore: { versionId: uid(2), companyOverview: "Overview", businessDescription: "Business", primaryCategory: "Category", detailedCategory: "Detail", primaryTarget: "Reader", differentiator: "Clear", coreAppeal: "Useful" },
  brandRules: { versionId: uid(11), version: 1, content: { contractVersion: "brand-rules.v1", requiredPhrases: [], forbiddenPhrases: [], exaggerationRules: [], ctaRules: { defaultCta: "", allowed: [] }, channelRules: {}, designRules: { colors: [], fonts: [], notes: [], referenceImages: [] }, autoApprovalRules: { enabled: false, conditions: [] } }, contentSha256: "67b61ecaeab23a876527fa4148e4046c2721084306d79b60bfec4f96956ba84b" },
  subject: { kind: "topic_text" as const, title: "좋은 글 구조" }, contentInstruction: "구체적으로 작성",
  product: null,
  researchEvidence: { contractVersion: "research-evidence.v1" as const, decision: "searched" as const, reason: "Evidence", queries: ["query"], capturedAt: "2026-07-31T00:00:00.000Z", items: [{ id: uid(5), title: "Source", url: "https://example.com/source", publisher: null, publishedAt: null, capturedAt: "2026-07-31T00:00:00.000Z", claimSummary: "Claim", contentHash: "a".repeat(64) }] },
  references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
  selectedProposal: { id: uid(6), conceptKey: "guide", title: "Guide", informationalType: "how_to" as const, oneLineIntent: "Explain", differentiator: "Direct", differentiationAxes: ["question"], target: "Reader", customerContext: "Need answer", keyMessage: "Answer", hook: "Question", selectionReason: "Useful", evidenceIds: [uid(5)], referenceIds: [], outputFormat: "blog" as const, channelTargets: ["blog_export"] as ["blog_export"], assetCount: null, outline: [{ index: 1, role: "article", headline: "Structure", purpose: "Guide" }], purposeDetails: { kind: "informational" as const, question: "What?", value: "Answer", whyNow: "Now", learningPoints: ["Point"] } },
  userImageInstruction: "Clean editorial", outputSettings: { purpose: "informational" as const, outputFormat: "blog" as const, channelTargets: ["blog_export"] as ["blog_export"], aspectRatio: null, outputCount: 1 as const }, capturedAt: "2026-07-31T00:00:00.000Z",
};

describe("blog prompt", () => {
  it("carries hook-only revision constraints into the prompt", () => {
    const prompt = buildPrompt({
      ...job,
      payload: {
        ...job.payload,
        revision: {
          contractVersion: "ai-content-revision.v1",
          action: "regenerate_hook",
          idempotencyKey: "revision-hook-1",
          cardIndex: null,
          previousManifest: { type: "blog", assets: [] },
          previousContent: { title: "기존 제목", summary: "기존 요약" },
        },
      },
    });

    expect(prompt).toContain("부분 재생성 계약");
    expect(prompt).toContain("첫 훅만");
  });

  it("requires v2 grounded semantic SEO writing", () => {
    const prompt = buildPrompt(job);
    expect(prompt).toContain("content-generation-input.v2");
    expect(prompt).toContain('"serviceSubtype": "saas"');
    expect(prompt).toContain('"analysisVersion": 2');
    expect(prompt).toContain("제품·서비스 프로필, subtype, 대안, 장벽과 VOC");
    expect(prompt).toContain("subject.facts만 제품·서비스의 사실 근거");
    expect(prompt).toContain("subject.research는 출처가 포함된 시장 맥락");
    expect(prompt).toContain("message.qualityBrief.sourceGaps");
    expect(prompt).toContain("message.target 1개와 message.appeal 1개");
    expect(prompt).toContain("creativeDirection.selectedColor");
    expect(prompt).toContain("공개 웹 검색을 수행하지 마세요");
    expect(prompt).toContain("semantic HTML");
    expect(prompt).toContain("0~5장");
    expect(prompt).toContain("설명해야 이해가 분명히 좋아지는 경우");
    expect(prompt).toContain('"prompts": [\n      "첫 번째 블로그 지시"');
  });

  it("rejects an appeal that does not belong to the selected target", () => {
    const input = job.payload.contentGenerationInput;
    expect(() => buildPrompt({ ...job, payload: { contentGenerationInput: { ...input, message: { ...input.message, appeal: { id: "appeal-1", targetId: "other" } } } } })).toThrow("content_generation_appeal_target_mismatch");
  });

  it("rejects attachment snapshots with missing structural fields", () => {
    const input = job.payload.contentGenerationInput;
    expect(() => parseContentGenerationInput({
      ...input,
      attachments: [{ id: "attachment-1" }],
    })).toThrow("content_generation_attachment_invalid");
  });

  it("uses informational orchestration priority and keeps avatar out of factual direction", () => {
    const input = job.payload.contentGenerationInput;
    const prompt = buildPrompt({
      ...job,
      payload: {
        contentGenerationInput: {
          ...input,
          orchestration: {
            contractVersion: "content-orchestration.v1",
            contentFamily: "informational",
            subject: { mode: "brand_topic", topic: "FAQ" },
            target: { id: "target-1", snapshot: { name: "초보 고객" } },
            strategy: "faq",
            outputFormat: "blog",
            channelTargets: ["blog_export"],
            brief: { goal: "질문 해결" },
            references: [{ referenceItemId: "reference-1", roles: ["copy_pattern"] }],
            avatar: {
              mode: "one_time",
              id: "avatar-1",
              snapshot: { assetUrl: "https://cdn.example/avatar.png" },
            },
          },
          creativeDirection: {
            ...input.creativeDirection,
            contentFamily: "informational",
            outputFormat: "blog",
          },
        },
      },
    });
    expect(prompt).toContain("승인 Brand Core");
    expect(prompt).toContain("승인 제품·서비스");
    expect(prompt).toContain("사용자가 확정한 target, strategy, brief");
    expect(prompt).toContain("교육·문제 해결·가이드 톤");
    expect(prompt).toContain("원문 문장을 그대로 복제하지 마세요");
    const promptData = JSON.parse(prompt.split("작업 데이터(JSON):\n")[1]!);
    expect(promptData.visualDirection.avatar.snapshot.assetUrl).toBe("https://cdn.example/avatar.png");
    expect(promptData.factualDirection).not.toHaveProperty("avatar");
  });

  it("builds a v3 HTML writer prompt without Wiki, FAQ, logos, or experience-story instructions", () => {
    const prompt = buildBlogPlanPrompt({ ...job, payload: { contentGenerationInput: v3Input } }, v3Input, null);
    expect(prompt).toContain("blog-plan.v2");
    expect(prompt).toContain("3,000~10,000자");
    expect(prompt).toContain("정확히 3개");
    expect(prompt).toContain("300자 이하");
    expect(prompt).toContain("SEO");
    expect(prompt).toContain("GEO");
    expect(prompt).toContain("data-evidence-id");
    expect(prompt).toContain("0~5개");
    expect(prompt).toContain("로고를 생성하거나 배치하지 마세요");
    expect(prompt).toContain("contentInstruction");
    expect(prompt).toContain("제품 사실은 input.product");
    expect(prompt).toContain("input.brandRules.content");
    expect(prompt).toContain('"contractVersion": "brand-rules.v1"');
    expect(prompt).toContain("title 500자");
    expect(prompt).toContain("metaTitle 500자");
    expect(prompt).toContain("metaDescription 2,000자");
    expect(prompt).not.toMatch(/경험담|가상 경험|합성 경험|1인칭 체험/);
    expect(prompt).not.toMatch(/wiki|faq/i);
  });

  it("includes frozen supplement and targeted validation errors in repair prompts", () => {
    const supplemental = { ...v3Input.researchEvidence, items: [{ ...v3Input.researchEvidence.items[0]!, id: uid(7), url: "https://example.com/supplement" }] };
    const prompt = buildBlogPlanPrompt({ ...job, payload: { contentGenerationInput: v3Input } }, v3Input, supplemental, ["blog_html_summary_invalid", "blog_html_length_invalid"]);
    expect(prompt).toContain(uid(7));
    expect(prompt).toContain("blog_html_summary_invalid");
    expect(prompt).toContain("blog_html_length_invalid");
    expect(prompt).toContain("이 오류만 보정");
  });
});
