import { describe, expect, it } from "vitest";
import { parseCardNewsInput, parseContentGenerationInput } from "./contracts.js";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const timestamp = "2026-07-31T00:00:00.000Z";

function v3Input(purpose: "informational" | "marketing" = "informational") {
  const marketing = purpose === "marketing";
  const product = marketing ? {
    id: id(2), versionId: id(3), kind: "product", name: "Tea", description: "Green tea",
    features: ["Fresh leaves"], benefits: ["Calm focus"], cautions: ["Contains caffeine"],
    evergreenPurchaseInfo: "Available online", images: [],
  } : null;
  return {
    contractVersion: "content-generation-input.v3",
    generationId: id(10),
    brandCore: {
      versionId: id(1), companyOverview: "Company", businessDescription: "Business",
      primaryCategory: "Food", detailedCategory: "Tea", primaryTarget: "Adults",
      differentiator: "Fresh", coreAppeal: "Calm",
    },
    subject: { kind: "topic_text", title: "Tea guide" },
    contentInstruction: "Make it practical",
    product,
    researchEvidence: marketing ? {
      contractVersion: "research-evidence.v1", decision: "not_needed", reason: "Product facts suffice",
      queries: [], capturedAt: timestamp, items: [],
    } : {
      contractVersion: "research-evidence.v1", decision: "searched", reason: "Current guidance",
      queries: ["tea guide"], capturedAt: timestamp,
      items: [{ id: id(7), title: "Study", url: "https://evidence.example/study", publisher: null, publishedAt: null, capturedAt: timestamp, claimSummary: "Brew carefully", contentHash: "c".repeat(64) }],
    },
    references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
    selectedProposal: {
      id: id(9), conceptKey: "tea-guide", title: "Tea guide", informationalType: marketing ? null : "how_to",
      oneLineIntent: "Teach brewing", differentiator: "Simple", differentiationAxes: ["question"],
      target: "Adults", customerContext: "Choosing tea", keyMessage: "Brew well", hook: "Better tea",
      selectionReason: "Useful", evidenceIds: marketing ? [] : [id(7)], referenceIds: [],
      outputFormat: "card_news", channelTargets: ["instagram"], assetCount: 2,
      outline: [
        { index: 1, role: "hook", headline: "Start", purpose: "Open" },
        { index: 2, role: "guide", headline: "Steps", purpose: "Explain" },
      ],
      purposeDetails: marketing ? {
        kind: "marketing", campaignObjective: "Sales", situationAndNeed: "Afternoon focus", productId: id(2),
        targetSegment: "Office workers", strengths: ["Fresh leaves"], limitations: ["Contains caffeine"],
        appeal: "Calm focus", buyingBarriers: ["Price"], cta: "Buy now",
      } : {
        kind: "informational", question: "How to brew?", value: "Practical guidance", whyNow: "Better habits",
        learningPoints: ["Temperature", "Timing"],
      },
    },
    userImageInstruction: "Soft light",
    outputSettings: { purpose, outputFormat: "card_news", channelTargets: ["instagram"], aspectRatio: "4:5", outputCount: 1 },
    capturedAt: timestamp,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "content-generation-input.v2",
    contentType: "card_news",
    brandContext: {},
    subject: {
      analysisId: "analysis-1",
      analysisVersion: 1,
      analysisContractVersion: "subject-analysis.v1",
      analysisResult: null,
      type: "product",
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
      prompts: ["정보를 쉽게 설명"],
      brandColor: "#111111",
      selectedColor: "#111111",
      aspectRatio: "1:1",
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
    strategy: "how_to",
    outputFormat: "card_news",
    channelTargets: ["instagram"],
    brief: { goal: "쉽게 설명" },
    references: [],
    avatar: null,
    ...overrides,
  };
}

describe("card-news content generation contract", () => {
  it("preserves legacy v2 payloads without orchestration", () => {
    expect(parseContentGenerationInput(input()).orchestration).toBeNull();
  });

  it("validates and forwards deterministic orchestration", () => {
    const parsed = parseContentGenerationInput(input({
      orchestration: orchestration(),
      creativeDirection: {
        ...(input().creativeDirection as Record<string, unknown>),
        contentFamily: "informational",
        outputFormat: "card_news",
      },
    }));
    expect(parsed.orchestration).toEqual(orchestration());
    expect(parsed.creativeDirection).toMatchObject({
      contentFamily: "informational",
      outputFormat: "card_news",
    });
  });

  it("rejects legacy Wiki identifiers at the worker contract boundary", () => {
    expect(() => parseContentGenerationInput(input({
      orchestration: orchestration({
        subject: { mode: "brand_topic", topic: "주제", wikiItemIds: ["wiki-1"] },
      }),
      creativeDirection: {
        ...(input().creativeDirection as Record<string, unknown>),
        contentFamily: "informational",
        outputFormat: "card_news",
      },
    }))).toThrow("content_generation_orchestration_invalid");
  });

  it("rejects mismatched family or output format", () => {
    expect(() => parseContentGenerationInput(input({
      orchestration: orchestration(),
      creativeDirection: {
        ...(input().creativeDirection as Record<string, unknown>),
        contentFamily: "marketing",
        outputFormat: "card_news",
      },
    }))).toThrow("content_generation_orchestration_mismatch");
  });

  it("rejects excluded user-facing media requests in the brief", () => {
    expect(() => parseContentGenerationInput(input({
      orchestration: orchestration({ brief: { request: "제품 Reel video 제작" } }),
      creativeDirection: {
        ...(input().creativeDirection as Record<string, unknown>),
        contentFamily: "informational",
        outputFormat: "card_news",
      },
    }))).toThrow("content_generation_video_unsupported");
  });

  it.each(["informational", "marketing"] as const)("accepts %s v3 card-news input", (purpose) => {
    const parsed = parseCardNewsInput(v3Input(purpose), "card_news");
    expect(parsed.contractVersion).toBe("content-generation-input.v3");
    expect(parsed.outputSettings).toMatchObject({ purpose, outputFormat: "card_news" });
  });

  it("rejects v3 inputs routed to a non-card-news legacy worker type", () => {
    expect(() => parseCardNewsInput(v3Input(), "marketing")).toThrow("content_generation_input_type_invalid");
  });

  it("rejects a v3 non-card-news output even when the envelope is otherwise valid", () => {
    const value = v3Input() as Record<string, unknown>;
    const proposal = value.selectedProposal as Record<string, unknown>;
    value.outputSettings = { ...(value.outputSettings as Record<string, unknown>), outputFormat: "marketing_content" };
    value.selectedProposal = { ...proposal, outputFormat: "marketing_content" };
    expect(() => parseCardNewsInput(value, "card_news")).toThrow("content_generation_input_type_invalid");
  });
});
