import { describe, expect, it } from "vitest";
import { parseContentGenerationInput, parseMarketingInput, parseMarketingPlanV2 } from "./contracts.js";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const capturedAt = "2026-07-31T00:00:00.000Z";

function v3Input(
  purpose: "informational" | "marketing",
  outputFormat: "reel" | "marketing_content",
) {
  const product = purpose === "marketing" ? {
    id: id(2), versionId: id(3), kind: "product", name: "Tea", description: "Green tea",
    features: ["Fresh leaves"], benefits: ["Calm focus"], cautions: ["Contains caffeine"],
    evergreenPurchaseInfo: "Available online",
    images: [{ assetId: id(4), role: "hero", storageUrl: "https://cdn.example/product.webp", storagePath: "owned/product.webp", mimeType: "image/webp", checksum: "d".repeat(64) }],
  } : null;
  const reference = {
    referenceItemId: id(5), snapshotId: id(6), roles: ["planning", "visual_composition"], title: "Reference",
    sourceUrl: "https://reference.example/item", capturedAt, contentHash: "a".repeat(64), text: "Readable composition",
    image: { storageUrl: "https://cdn.example/reference.webp", storagePath: "owned/reference.webp", mimeType: "image/webp", checksum: "b".repeat(64) },
  };
  const style = {
    referenceItemId: id(5), description: "Calm editorial style", tags: ["calm"], storageUrl: "https://cdn.example/style.webp",
    storagePath: "owned/style.webp", mimeType: "image/webp", checksum: "c".repeat(64),
  };
  const attachment = {
    id: id(8), role: "supporting_image", fileName: "support.webp", mimeType: "image/webp", sizeBytes: 128,
    checksum: "e".repeat(64), storageUrl: "https://cdn.example/support.webp", storagePath: "owned/support.webp",
  };
  return {
    contractVersion: "content-generation-input.v3", generationId: id(10), capturedAt,
    brandCore: { versionId: id(1), companyOverview: "Company", businessDescription: "Business", primaryCategory: "Food", detailedCategory: "Tea", primaryTarget: "Adults", differentiator: "Fresh", coreAppeal: "Calm" },
    subject: { kind: "topic_text", title: "Tea guide" }, contentInstruction: "Practical copy", product,
    researchEvidence: purpose === "informational"
      ? { contractVersion: "research-evidence.v1", decision: "searched", reason: "Current source", queries: ["tea"], capturedAt, items: [{ id: id(7), title: "Study", url: "https://evidence.example/study", publisher: null, publishedAt: null, capturedAt, claimSummary: "Use warm water", contentHash: "f".repeat(64) }] }
      : { contractVersion: "research-evidence.v1", decision: "not_needed", reason: "Fixed product facts suffice", queries: [], capturedAt, items: [] },
    references: { selected: [reference], brandStyleImages: [style], avatarStyleImageId: id(5), attachments: [attachment] },
    selectedProposal: {
      id: id(9), conceptKey: "tea-plan", title: "Tea plan", informationalType: purpose === "informational" ? "how_to" : null,
      oneLineIntent: "Explain tea", differentiator: "Simple", differentiationAxes: ["question"], target: "Adults",
      customerContext: "Choosing tea", keyMessage: "Brew well", hook: "Better tea", selectionReason: "Useful",
      evidenceIds: purpose === "informational" ? [id(7)] : [], referenceIds: [id(5)], outputFormat, channelTargets: ["instagram"], assetCount: 2,
      outline: [{ index: 1, role: "hook", headline: "Start", purpose: "Open" }, { index: 2, role: "detail", headline: "Steps", purpose: "Explain" }],
      purposeDetails: purpose === "informational"
        ? { kind: "informational", question: "How?", value: "Guidance", whyNow: "Better habits", learningPoints: ["Temperature"] }
        : { kind: "marketing", campaignObjective: "Conversion", situationAndNeed: "Afternoon focus", productId: id(2), targetSegment: "Office workers", strengths: ["Fresh leaves"], limitations: ["Contains caffeine"], appeal: "Calm focus", buyingBarriers: ["Price"], cta: "Buy now" },
    },
    userImageInstruction: "Soft light",
    outputSettings: { purpose, outputFormat, channelTargets: ["instagram"], aspectRatio: outputFormat === "reel" ? "9:16" : "4:5", outputCount: 1 },
  };
}

function v3Plan(input: ReturnType<typeof v3Input>) {
  return {
    contractVersion: "marketing-plan.v2", outputFormat: input.outputSettings.outputFormat,
    content: { caption: "Useful tea content", hashtags: ["tea"], cta: input.outputSettings.purpose === "marketing" ? "Buy now" : "Save this" },
    imagePackage: {
      contractVersion: "image-generation-package.v1", generationId: input.generationId, outputFormat: input.outputSettings.outputFormat,
      purpose: input.outputSettings.purpose, assetCount: 2, aspectRatio: input.outputSettings.aspectRatio, channelTargets: ["instagram"],
      assets: [
        { index: 1, role: "hook", copy: "A useful opening", visualDirection: "Vertical readable opening", evidenceIds: [], productImageAssetIds: [], attachmentIds: [] },
        { index: 2, role: "detail", copy: "A grounded detail", visualDirection: "Focused detail scene", evidenceIds: input.product ? [] : [id(7)], productImageAssetIds: input.product ? [id(4)] : [], attachmentIds: [id(8)] },
      ],
      product: structuredClone(input.product), references: structuredClone(input.references.selected), brandStyleImages: structuredClone(input.references.brandStyleImages),
      avatarStyleImageId: input.references.avatarStyleImageId, attachments: structuredClone(input.references.attachments),
      userImageInstruction: input.userImageInstruction,
      logoPolicy: { allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true },
    },
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "content-generation-input.v2",
    contentType: "marketing",
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
      prompts: ["효익과 CTA 작성"],
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
    contentFamily: "marketing",
    subject: { mode: "product_service", productServiceId: "product-1" },
    target: { id: "target-1", snapshot: { name: "타깃" } },
    strategy: "benefit",
    outputFormat: "single_image",
    channelTargets: ["instagram"],
    brief: { goal: "효익 전달" },
    references: [],
    avatar: {
      mode: "library",
      id: "avatar-1",
      snapshot: { assetUrl: "https://cdn.example/avatar.png" },
    },
    ...overrides,
  };
}

describe("marketing content generation contract", () => {
  it("preserves legacy v2 payloads without orchestration", () => {
    expect(parseContentGenerationInput(input()).orchestration).toBeNull();
  });

  it.each(["single_image", "channel_text"])(
    "validates and forwards %s orchestration",
    (outputFormat) => {
      const selected = orchestration({
        outputFormat,
        channelTargets: outputFormat === "channel_text" ? ["threads"] : ["instagram"],
      });
      const parsed = parseContentGenerationInput(input({
        orchestration: selected,
        creativeDirection: {
          ...(input().creativeDirection as Record<string, unknown>),
          contentFamily: "marketing",
          outputFormat,
        },
      }));
      expect(parsed.orchestration).toEqual(selected);
      expect(parsed.creativeDirection).toMatchObject({
        contentFamily: "marketing",
        outputFormat,
      });
    },
  );

  it("rejects informational worker mapping", () => {
    expect(() => parseContentGenerationInput(input({
      orchestration: orchestration({
        contentFamily: "informational",
        strategy: "how_to",
        outputFormat: "blog",
        avatar: null,
      }),
      creativeDirection: {
        ...(input().creativeDirection as Record<string, unknown>),
        contentFamily: "informational",
        outputFormat: "blog",
      },
    }))).toThrow("content_generation_orchestration_mismatch");
  });

  it.each(["video", "Reel", "voice", "face swap"])(
    "rejects excluded %s requests in the brief",
    (request) => {
      expect(() => parseContentGenerationInput(input({
        orchestration: orchestration({ brief: { request } }),
        creativeDirection: {
          ...(input().creativeDirection as Record<string, unknown>),
          contentFamily: "marketing",
          outputFormat: "single_image",
        },
      }))).toThrow("content_generation_video_unsupported");
    },
  );

  it.each([
    ["informational", "reel"],
    ["marketing", "reel"],
    ["informational", "marketing_content"],
    ["marketing", "marketing_content"],
  ] as const)("accepts independent v3 %s/%s routing", (purpose, outputFormat) => {
    const parsed = parseMarketingInput(v3Input(purpose, outputFormat), "marketing");
    expect(parsed.contractVersion).toBe("content-generation-input.v3");
    expect(parsed.outputSettings).toMatchObject({ purpose, outputFormat });
  });

  it("rejects an informational v3 input carrying any fixed product", () => {
    const value = v3Input("informational", "reel");
    value.product = v3Input("marketing", "reel").product;
    expect(() => parseMarketingInput(value, "marketing")).toThrow();
  });

  it("rejects a marketing v3 input without its fixed approved product", () => {
    const value = v3Input("marketing", "marketing_content");
    value.product = null;
    expect(() => parseMarketingInput(value, "marketing")).toThrow();
  });

  it("rejects v3 formats owned by another planner", () => {
    const value = v3Input("informational", "marketing_content") as Record<string, unknown>;
    value.outputSettings = { ...(value.outputSettings as Record<string, unknown>), outputFormat: "card_news" };
    value.selectedProposal = { ...(value.selectedProposal as Record<string, unknown>), outputFormat: "card_news" };
    expect(() => parseMarketingInput(value, "marketing")).toThrow("content_generation_input_type_invalid");
  });

  it("parses an exact marketing-plan.v2 with locked assets and frozen package snapshots", () => {
    const input = v3Input("informational", "reel");
    expect(parseMarketingPlanV2(v3Plan(input), input)).toEqual(v3Plan(input));
  });

  it.each([
    ["output format", (plan: ReturnType<typeof v3Plan>) => { plan.outputFormat = "marketing_content"; }],
    ["count", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.assetCount = 1; }],
    ["index", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.assets[0]!.index = 2; }],
    ["role", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.assets[1]!.role = "other"; }],
    ["no-logo", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.logoPolicy.allowGeneratedLogo = true as false; }],
    ["evidence", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.assets[1]!.evidenceIds = [id(99)]; }],
    ["product snapshot", (plan: ReturnType<typeof v3Plan>) => { if (plan.imagePackage.product) plan.imagePackage.product.name = "Changed"; }],
    ["reference snapshot", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.references = []; }],
  ])("rejects a mismatched v3 %s", (_name, mutate) => {
    const input = v3Input("marketing", "reel");
    const plan = v3Plan(input);
    mutate(plan);
    expect(() => parseMarketingPlanV2(plan, input)).toThrow("marketing_plan_invalid");
  });
});
