import { describe, expect, it } from "vitest";
import { parseBlogInput, parseBlogPlanV2, parseContentGenerationInput } from "./contracts.js";

const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = "a".repeat(64);

function v3Input(purpose: "informational" | "marketing" = "informational") {
  return {
    contractVersion: "content-generation-input.v3", generationId: uid(1),
    brandCore: { versionId: uid(2), companyOverview: "Overview", businessDescription: "Business", primaryCategory: "Category", detailedCategory: "Detail", primaryTarget: "Reader", differentiator: "Clear", coreAppeal: "Useful" },
    subject: { kind: "topic_text", title: "좋은 글 구조" }, contentInstruction: "구체적으로 작성",
    product: purpose === "marketing" ? { id: uid(3), versionId: uid(4), kind: "service", name: "Service", description: "Description", features: ["Feature"], benefits: ["Benefit"], cautions: ["Caution"], evergreenPurchaseInfo: "Contact", images: [] } : null,
    researchEvidence: { contractVersion: "research-evidence.v1", decision: "searched", reason: "Evidence", queries: ["query"], capturedAt: "2026-07-31T00:00:00.000Z", items: [{ id: uid(5), title: "Source", url: "https://example.com/source", publisher: "Publisher", publishedAt: null, capturedAt: "2026-07-31T00:00:00.000Z", claimSummary: "Claim", contentHash: sha }] },
    references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
    selectedProposal: { id: uid(6), conceptKey: "guide", title: "Guide", informationalType: purpose === "informational" ? "how_to" : null, oneLineIntent: "Explain", differentiator: "Direct", differentiationAxes: ["question"], target: "Reader", customerContext: "Need answer", keyMessage: "Answer", hook: "Question", selectionReason: "Useful", evidenceIds: [uid(5)], referenceIds: [], outputFormat: "blog", channelTargets: ["blog_export"], assetCount: null, outline: [{ index: 1, role: "article", headline: "Structure", purpose: "Guide" }], purposeDetails: purpose === "informational" ? { kind: "informational", question: "What?", value: "Answer", whyNow: "Now", learningPoints: ["Point"] } : { kind: "marketing", campaignObjective: "Convert", situationAndNeed: "Need", productId: uid(3), targetSegment: "Reader", strengths: ["Strong"], limitations: ["Limit"], appeal: "Appeal", buyingBarriers: ["Barrier"], cta: "Act" } },
    userImageInstruction: "Clean editorial", outputSettings: { purpose, outputFormat: "blog", channelTargets: ["blog_export"], aspectRatio: null, outputCount: 1 }, capturedAt: "2026-07-31T00:00:00.000Z",
  };
}

function validHtml(evidence = true) {
  const body = "독자가 바로 이해할 수 있는 구체적인 설명입니다. ".repeat(120);
  const link = evidence ? `<a href="https://example.com/source" data-evidence-id="${uid(5)}">근거</a>` : "";
  const refs = evidence ? `<section data-references="true"><h2>어떤 자료를 참고했나요?</h2><p>사용한 근거입니다.</p><ul><li><a href="https://example.com/source" data-evidence-id="${uid(5)}">Source</a></li></ul></section>` : "";
  return `<article><h1>좋은 글은 어떻게 구성할까요?</h1><section data-summary="true"><p>핵심을 먼저 설명합니다.</p><p>근거와 구조를 연결합니다.</p><p>바로 적용할 기준을 제시합니다.</p></section><section><h2>무엇부터 확인해야 할까요?</h2><p>${body}${link}</p></section>${refs}</article>`;
}

function imagePackage(count = 2) {
  return {
    contractVersion: "image-generation-package.v1", generationId: uid(1), outputFormat: "blog", purpose: "informational", assetCount: count,
    aspectRatio: "16:9", channelTargets: ["blog_export"],
    assets: Array.from({ length: count }, (_, offset) => ({ index: offset + 1, role: offset ? "explanation" : "cover", copy: `Copy ${offset + 1}`, visualDirection: `Visual ${offset + 1}`, evidenceIds: [uid(5)], productImageAssetIds: [], attachmentIds: [] })),
    product: null, references: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [], userImageInstruction: "Clean editorial",
    logoPolicy: { allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true },
  };
}

const supplemental = { contractVersion: "research-evidence.v1", decision: "searched", reason: "Supplement", queries: ["supplement"], capturedAt: "2026-07-31T01:00:00.000Z", items: [{ id: uid(7), title: "Supplement", url: "https://example.com/supplement", publisher: null, publishedAt: null, capturedAt: "2026-07-31T01:00:00.000Z", claimSummary: "Supplement claim", contentHash: "b".repeat(64) }] };

function input(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "content-generation-input.v2",
    contentType: "blog",
    brandContext: {},
    subject: {
      analysisId: "analysis-1",
      analysisVersion: 1,
      analysisContractVersion: "subject-analysis.v1",
      analysisResult: null,
      type: "service",
      sourceUrl: "",
      facts: [],
      research: {},
      selectedImages: [],
    },
    message: {
      target: { id: "target-1" },
      appeal: { id: "appeal-1", targetId: "target-1" },
      qualityBrief: {},
    },
    creativeDirection: {
      prompts: ["가이드 작성"],
      brandColor: "#111111",
      selectedColor: "#111111",
      aspectRatio: "16:9",
      outputCount: 1,
    },
    references: [],
    attachments: [],
    ...overrides,
  };
}

function orchestration(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "content-orchestration.v1",
    contentFamily: "informational",
    subject: { mode: "brand_topic", topic: "주제" },
    target: { id: "target-1", snapshot: { name: "타깃" } },
    strategy: "faq",
    outputFormat: "blog",
    channelTargets: ["blog_export"],
    brief: { goal: "질문 해결" },
    references: [],
    avatar: null,
    ...overrides,
  };
}

describe("blog content generation contract", () => {
  it("preserves legacy v2 payloads without orchestration", () => {
    expect(parseContentGenerationInput(input()).orchestration).toBeNull();
  });

  it("validates and forwards deterministic orchestration", () => {
    const parsed = parseContentGenerationInput(input({
      orchestration: orchestration(),
      creativeDirection: {
        ...(input().creativeDirection as Record<string, unknown>),
        contentFamily: "informational",
        outputFormat: "blog",
      },
    }));
    expect(parsed.orchestration).toEqual(orchestration());
    expect(parsed.creativeDirection).toMatchObject({
      contentFamily: "informational",
      outputFormat: "blog",
    });
  });

  it("rejects a worker mapping mismatch", () => {
    expect(() => parseContentGenerationInput(input({
      orchestration: orchestration({ outputFormat: "card_news" }),
      creativeDirection: {
        ...(input().creativeDirection as Record<string, unknown>),
        contentFamily: "informational",
        outputFormat: "card_news",
      },
    }))).toThrow("content_generation_orchestration_mismatch");
  });

  it("rejects excluded voice requests in the brief", () => {
    expect(() => parseContentGenerationInput(input({
      orchestration: orchestration({ brief: { request: "voice clone" } }),
      creativeDirection: {
        ...(input().creativeDirection as Record<string, unknown>),
        contentFamily: "informational",
        outputFormat: "blog",
      },
    }))).toThrow("content_generation_video_unsupported");
  });

  it("dispatches v3 blog input without changing legacy v2 parsing", () => {
    expect(parseBlogInput(v3Input(), "blog").contractVersion).toBe("content-generation-input.v3");
    expect(() => parseBlogInput({ ...v3Input(), outputSettings: { ...v3Input().outputSettings, outputFormat: "card_news" } }, "blog")).toThrow("content_generation_input_type_invalid");
  });

  it("parses an exact HTML-only blog plan with frozen evidence", () => {
    const parsed = parseBlogPlanV2({
      contractVersion: "blog-plan.v2",
      content: { title: "좋은 글 구조", htmlTemplate: validHtml(), metaTitle: "좋은 글 구조 가이드", metaDescription: "좋은 글 구조를 단계별로 설명합니다.", usedEvidenceIds: [uid(5)] },
      imagePackage: null,
    }, v3Input());
    expect(parsed.imagePackage).toBeNull();
    expect(parsed.content.usedEvidenceIds).toEqual([uid(5)]);
  });

  it("rejects unknown evidence and fixed image package drift", () => {
    const inputV3 = v3Input();
    expect(() => parseBlogPlanV2({
      contractVersion: "blog-plan.v2",
      content: { title: "Title", htmlTemplate: validHtml(false), metaTitle: "Meta", metaDescription: "Description", usedEvidenceIds: [uid(99)] },
      imagePackage: null,
    }, inputV3)).toThrow("blog_plan_invalid");
  });

  it("accepts optional continuous image assets and rejects fixed package drift", () => {
    const inputV3 = v3Input();
    const htmlWithImages = validHtml().replace("</p></section><section data-references", '<img src="asset://01" alt="첫 번째 설명 이미지"><img src="asset://02" alt="두 번째 설명 이미지"></p></section><section data-references');
    const plan = { contractVersion: "blog-plan.v2", content: { title: "Title", htmlTemplate: htmlWithImages, metaTitle: "Meta", metaDescription: "Description", usedEvidenceIds: [uid(5)] }, imagePackage: imagePackage() };
    expect(parseBlogPlanV2(plan, inputV3).imagePackage?.assets.map((asset) => asset.evidenceIds)).toEqual([[uid(5)], [uid(5)]]);
    expect(() => parseBlogPlanV2({ ...plan, imagePackage: { ...imagePackage(), userImageInstruction: "drift" } }, inputV3)).toThrow("blog_plan_invalid");
    expect(() => parseBlogPlanV2({ ...plan, imagePackage: { ...imagePackage(), assets: [{ ...imagePackage().assets[0], evidenceIds: [uid(99)] }, imagePackage().assets[1]] } }, inputV3)).toThrow("blog_plan_invalid");
  });

  it("allows supplemental image evidence only when the article declares it as used", () => {
    const inputV3 = v3Input();
    const baseLink = `<a href="https://example.com/source" data-evidence-id="${uid(5)}">근거</a>`;
    const baseReferenceLink = `<a href="https://example.com/source" data-evidence-id="${uid(5)}">Source</a>`;
    const supplementLink = `<a href="https://example.com/supplement" data-evidence-id="${uid(7)}">보충 근거</a>`;
    const htmlTemplate = validHtml().replace(baseLink, `${baseLink}${supplementLink}`).replace(baseReferenceLink, `${baseReferenceLink}${supplementLink}`).replace("</p></section><section data-references", '<img src="asset://01" alt="첫 번째 설명 이미지"><img src="asset://02" alt="두 번째 설명 이미지"></p></section><section data-references');
    const pkg = imagePackage(); pkg.assets[0]!.evidenceIds = [uid(7)];
    const plan = { contractVersion: "blog-plan.v2", content: { title: "Title", htmlTemplate, metaTitle: "Meta", metaDescription: "Description", usedEvidenceIds: [uid(5), uid(7)] }, imagePackage: pkg };
    expect(parseBlogPlanV2(plan, inputV3, supplemental).imagePackage?.assets[0]?.evidenceIds).toEqual([uid(7)]);
    const withoutSupplementUse = { ...plan, content: { ...plan.content, htmlTemplate: validHtml().replace("</p></section><section data-references", '<img src="asset://01" alt="첫 번째 설명 이미지"><img src="asset://02" alt="두 번째 설명 이미지"></p></section><section data-references'), usedEvidenceIds: [uid(5)] } };
    expect(() => parseBlogPlanV2(withoutSupplementUse, inputV3, supplemental)).toThrow("blog_plan_invalid");
    pkg.assets[0]!.evidenceIds = [uid(99)];
    expect(() => parseBlogPlanV2({ ...plan, imagePackage: pkg }, inputV3, supplemental)).toThrow("blog_plan_invalid");
  });

  it("enforces the API-authoritative blog metadata boundaries", () => {
    const base = { contractVersion: "blog-plan.v2", content: { title: "T", htmlTemplate: validHtml(), metaTitle: "M", metaDescription: "D", usedEvidenceIds: [uid(5)] }, imagePackage: null };
    for (const [field, limit] of [["title", 500], ["metaTitle", 500], ["metaDescription", 2_000]] as const) {
      expect(() => parseBlogPlanV2({ ...base, content: { ...base.content, [field]: "가".repeat(limit) } }, v3Input())).not.toThrow();
      expect(() => parseBlogPlanV2({ ...base, content: { ...base.content, [field]: "가".repeat(limit + 1) } }, v3Input())).toThrow("blog_plan_invalid");
    }
  });
});
