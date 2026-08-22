import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_CONTENT_MANIFEST_VERSION,
  CONTENT_FORMAT_CATALOG,
  CONTENT_GENERATION_INPUT_VERSION,
  CONTENT_ORCHESTRATION_VERSION,
  CONTENT_PROPOSAL_CONTRACT_VERSIONS,
  IMAGE_GENERATION_PACKAGE_VERSION,
  RESEARCH_EVIDENCE_VERSION,
} from "./catalog.js";
import { ALL_CONTENT_SCHEMAS } from "./index.js";
import { parseContentOrchestrationV2 } from "./orchestration.js";
import {
  parseContentProposalRequestV2,
  parseContentProposalSetV2,
  parseProposalBaseInputSnapshotV2,
  parseProposalInputSnapshotV2,
  parseResearchEvidenceSnapshotV1,
} from "./proposal.js";
import {
  parseContentGenerationInputV3,
  parseImageGenerationPackageV1,
} from "./generation.js";
import {
  PlanContractVersionSchema,
  parseBlogPlanV2,
  parseCardNewsPlanV2,
  parseReelPlanV2,
} from "./plans.js";
import { parseAiContentManifestV3 } from "./manifest.js";

const UUIDS = {
  brand: "00000000-0000-4000-8000-000000000001",
  product: "00000000-0000-4000-8000-000000000002",
  brandVersion: "00000000-0000-4000-8000-000000000010",
  brandRulesVersion: "00000000-0000-4000-8000-000000000012",
  productVersion: "00000000-0000-4000-8000-000000000011",
  generation: "00000000-0000-4000-8000-000000000020",
  selectedProposal: "00000000-0000-4000-8000-000000000021",
  evidence: "00000000-0000-4000-8000-000000000030",
} as const;

const validCells = [
  ["card_news", "informational"], ["card_news", "marketing"],
  ["blog", "informational"], ["blog", "marketing"],
  ["reel", "informational"], ["reel", "marketing"],
] as const;

function orchestration(outputFormat: (typeof validCells)[number][0], purpose: (typeof validCells)[number][1]) {
  return {
    contractVersion: CONTENT_ORCHESTRATION_VERSION,
    brandId: UUIDS.brand,
    purpose,
    seed: { kind: "topic_text", title: "검증 주제" },
    contentInstruction: null,
    productId: purpose === "marketing" ? UUIDS.product : null,
    outputSettings: {
      outputFormat,
      channelTargets: [outputFormat === "blog" ? "blog_export" : "instagram"],
      aspectRatio: outputFormat === "blog" ? null : outputFormat === "reel" ? "9:16" : "1:1",
      outputCount: 1,
    },
  };
}

const brandCore = {
  versionId: UUIDS.brandVersion,
  companyOverview: "브랜드 개요",
  businessDescription: "사업 설명",
  primaryCategory: "테크",
  detailedCategory: "생산성",
  primaryTarget: "실무자",
  differentiator: "검증된 자동화",
  coreAppeal: "빠른 실행",
};

const brandRules = {
  versionId: UUIDS.brandRulesVersion,
  version: 1,
  content: {
    contractVersion: "brand-rules.v1",
    requiredPhrases: ["정확한 정보"],
    forbiddenPhrases: ["무조건"],
    exaggerationRules: ["검증되지 않은 최상급 금지"],
    ctaRules: { defaultCta: "더 알아보기", allowed: ["더 알아보기"] },
    channelRules: { instagram: ["짧은 문장"] },
    designRules: {
      colors: ["#ffffff"],
      fonts: ["Pretendard"],
      notes: ["충분한 여백"],
      referenceImages: [],
    },
    autoApprovalRules: { enabled: false, conditions: [] },
  },
  contentSha256: "c".repeat(64),
};

const product = {
  id: UUIDS.product,
  versionId: UUIDS.productVersion,
  kind: "product",
  name: "검증 상품",
  description: "상품 설명",
  features: ["기능"],
  benefits: ["효과"],
  cautions: [],
  evergreenPurchaseInfo: "",
  images: [],
};

const researchEvidence = {
  contractVersion: RESEARCH_EVIDENCE_VERSION,
  decision: "searched",
  reason: "근거 검증",
  queries: ["검증 검색어"],
  capturedAt: "2026-08-05T00:00:00.000Z",
  items: [{
    id: UUIDS.evidence,
    title: "검증 근거",
    url: "https://example.com/evidence",
    publisher: null,
    publishedAt: null,
    capturedAt: "2026-08-05T00:00:00.000Z",
    claimSummary: "검증된 주장",
    contentHash: "b".repeat(64),
  }],
};

function proposal(outputFormat: "card_news" | "blog" | "reel", purpose: "informational" | "marketing", suffix = 1) {
  return {
    conceptKey: `concept-${suffix}`,
    title: `제안 ${suffix}`,
    informationalType: purpose === "informational" ? "how_to" : null,
    oneLineIntent: "의도를 전달한다",
    differentiator: `차별점 ${suffix}`,
    differentiationAxes: ["narrative"],
    target: "실무자",
    customerContext: "검증이 필요한 상황",
    keyMessage: "검증된 메시지",
    hook: `훅 ${suffix}`,
    selectionReason: "선정 이유",
    evidenceIds: purpose === "informational" ? [UUIDS.evidence] : [],
    referenceIds: [],
    outputFormat,
    channelTargets: [outputFormat === "blog" ? "blog_export" : "instagram"],
    assetCount: outputFormat === "blog" ? null : 1,
    outline: [{ index: 1, role: outputFormat === "reel" ? "scene" : "slide", headline: "핵심", purpose: "설명" }],
    purposeDetails: purpose === "informational" ? {
      kind: "informational",
      question: "무엇을 검증하는가?",
      value: "검증 방법을 배운다",
      whyNow: "지금 필요하다",
      learningPoints: ["검증 단계"],
    } : {
      kind: "marketing",
      campaignObjective: "전환",
      situationAndNeed: "업무 개선 필요",
      productId: UUIDS.product,
      targetSegment: "실무자",
      strengths: ["빠름"],
      limitations: [],
      appeal: "검증된 효율",
      buyingBarriers: [],
      cta: "확인하기",
    },
  };
}

function outputSettings(outputFormat: "card_news" | "blog" | "reel", purpose: "informational" | "marketing") {
  return {
    outputFormat,
    channelTargets: [outputFormat === "blog" ? "blog_export" : "instagram"],
    aspectRatio: outputFormat === "blog" ? null : outputFormat === "reel" ? "9:16" : "1:1",
    outputCount: 1,
    purpose,
  };
}

function generationInput(outputFormat: "card_news" | "blog" | "reel" = "card_news", purpose: "informational" | "marketing" = "informational") {
  return {
    contractVersion: CONTENT_GENERATION_INPUT_VERSION,
    generationId: UUIDS.generation,
    brandCore,
    brandRules,
    subject: { kind: "topic_text", title: "검증 주제" },
    contentInstruction: null,
    product: purpose === "marketing" ? product : null,
    researchEvidence,
    references: {
      selected: [],
      brandStyleImages: [],
      avatarStyleImageId: null,
      attachments: [],
    },
    selectedProposal: { id: UUIDS.selectedProposal, ...proposal(outputFormat, purpose) },
    userImageInstruction: null,
    outputSettings: outputSettings(outputFormat, purpose),
    capturedAt: "2026-08-05T00:00:00.000Z",
  };
}

function imagePackage(outputFormat: "card_news" | "reel" = "card_news", purpose: "informational" | "marketing" = "informational") {
  return {
    contractVersion: IMAGE_GENERATION_PACKAGE_VERSION,
    generationId: UUIDS.generation,
    outputFormat,
    purpose,
    assetCount: 1,
    aspectRatio: outputFormat === "reel" ? "9:16" : "1:1",
    channelTargets: ["instagram"],
    assets: [{
      index: 1,
      role: outputFormat === "reel" ? "scene" : "slide",
      copy: "카피",
      visualDirection: "비주얼 방향",
      evidenceIds: purpose === "informational" ? [UUIDS.evidence] : [],
      productImageAssetIds: [],
      attachmentIds: [],
    }],
    product: purpose === "marketing" ? product : null,
    references: [],
    brandStyleImages: [],
    avatarStyleImageId: null,
    attachments: [],
    userImageInstruction: null,
    logoPolicy: {
      allowGeneratedLogo: false,
      allowReservedLogoArea: false,
      allowExternalReferenceLogo: false,
      allowExistingProductPackagingLogo: true,
    },
  };
}

function proposalRequest() {
  return {
    contractVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.request,
    purpose: "informational",
    outputFormat: "card_news",
    channelTargets: ["instagram"],
    requestFingerprint: "a".repeat(64),
  };
}

function proposalBase() {
  return {
    contractVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.baseInput,
    brandCore,
    subject: { kind: "topic_text", title: "검증 주제" },
    contentInstruction: null,
    product: null,
    references: [],
    outputSettings: outputSettings("card_news", "informational"),
    capturedAt: "2026-08-05T00:00:00.000Z",
  };
}

function proposalComposed() {
  const { contractVersion: _version, ...shared } = proposalBase();
  return {
    contractVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.composedInput,
    ...shared,
    researchEvidence,
  };
}

function proposalSet() {
  return {
    contractVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.output,
    proposals: [proposal("card_news", "informational", 1), proposal("card_news", "informational", 2), proposal("card_news", "informational", 3)],
  };
}

const cardPlan = {
  contractVersion: CONTENT_FORMAT_CATALOG.card_news.planContractVersion,
  content: { caption: "캡션", hashtags: ["#검증"], cta: "저장하기" },
  imagePackage: imagePackage("card_news"),
};

const blogPlan = {
  contractVersion: CONTENT_FORMAT_CATALOG.blog.planContractVersion,
  content: {
    title: "블로그 제목",
    htmlTemplate: "<article>검증 본문</article>",
    metaTitle: "메타 제목",
    metaDescription: "메타 설명",
    usedEvidenceIds: [UUIDS.evidence],
  },
  imagePackage: null,
};

const reelPlan = {
  contractVersion: CONTENT_FORMAT_CATALOG.reel.planContractVersion,
  outputFormat: "reel",
  content: { caption: "릴스 캡션", hashtags: ["#검증"], cta: "확인하기" },
  imagePackage: imagePackage("reel"),
};

const manifest = {
  version: AI_CONTENT_MANIFEST_VERSION,
  outputFormat: "card_news",
  purpose: "informational",
  title: "최종 콘텐츠",
  assets: [{
    role: "slide",
    index: 1,
    url: "https://example.com/slide.png",
    fileName: "slide-01.png",
    mimeType: "image/png",
    width: 1080,
    height: 1080,
  }],
  content: { caption: "캡션", hashtags: ["#검증"], cta: "저장하기" },
};

type SchemaRecord = Record<string, unknown>;

function visit(value: unknown, path: string, callback: (schema: SchemaRecord, path: string) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => visit(child, `${path}[${index}]`, callback));
    return;
  }
  const record = value as SchemaRecord;
  callback(record, path);
  for (const [key, child] of Object.entries(record)) visit(child, path ? `${path}.${key}` : key, callback);
}

function findUntypedConstPaths(value: unknown): string[] {
  const paths: string[] = [];
  visit(value, "", (schema, path) => {
    if (Object.hasOwn(schema, "const") && !Object.hasOwn(schema, "type")) paths.push(path);
  });
  return paths;
}

function findObjectsAllowingAdditionalProperties(value: unknown): string[] {
  const paths: string[] = [];
  visit(value, "", (schema, path) => {
    if (schema.type === "object" && schema.additionalProperties !== false) paths.push(path);
  });
  return paths;
}

function findOptionalStructuredOutputProperties(value: unknown): string[] {
  const paths: string[] = [];
  visit(value, "", (schema, path) => {
    if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object") return;
    const properties = Object.keys(schema.properties as SchemaRecord).sort();
    const required = Array.isArray(schema.required) ? [...schema.required].map(String).sort() : [];
    if (JSON.stringify(properties) !== JSON.stringify(required)) paths.push(path);
  });
  return paths;
}

function providerProblems(value: unknown) {
  const serialized = JSON.stringify(value);
  return {
    hasOneOf: serialized.includes('"oneOf"'),
    hasUniqueItems: serialized.includes('"uniqueItems"'),
    untypedConstPaths: findUntypedConstPaths(value),
    openObjectPaths: findObjectsAllowingAdditionalProperties(value),
    optionalPropertyPaths: findOptionalStructuredOutputProperties(value),
  };
}

describe("canonical content schemas", () => {
  it.each(validCells)("accepts %s/%s", (outputFormat, purpose) => {
    expect(parseContentOrchestrationV2(orchestration(outputFormat, purpose)))
      .toMatchObject({ purpose, outputSettings: { outputFormat } });
  });

  it("ships provider-compatible generated schemas", () => {
    const serialized = JSON.stringify(ALL_CONTENT_SCHEMAS);
    expect(serialized).not.toContain('"oneOf"');
    expect(serialized).not.toContain('"uniqueItems"');
    expect(findUntypedConstPaths(ALL_CONTENT_SCHEMAS)).toEqual([]);
    expect(findObjectsAllowingAdditionalProperties(ALL_CONTENT_SCHEMAS)).toEqual([]);
    expect(findOptionalStructuredOutputProperties(ALL_CONTENT_SCHEMAS)).toEqual([]);
  });

  it("incident_invalid_json_schema rejects the captured legacy schema and accepts canonical schemas/parsers", () => {
    const fixtureBytes = readFileSync(new URL("./fixtures/legacy-invalid-json-schema.fixture.json", import.meta.url));
    expect(createHash("sha256").update(fixtureBytes).digest("hex"))
      .toBe("0c5ba953e43fd6b58291736fbc8270a3e6f3bdfdd7c21bc56d3581da59c234c2");
    const legacySchema = JSON.parse(fixtureBytes.toString("utf8")) as unknown;
    const legacyProblems = providerProblems(legacySchema);
    expect(legacyProblems.untypedConstPaths).toEqual(expect.arrayContaining([
      "properties.contractVersion",
      "$defs.logoPolicy.properties.allowGeneratedLogo",
      "$defs.imagePackage.properties.contractVersion",
    ]));
    expect(legacyProblems.untypedConstPaths.length).toBeGreaterThan(0);
    expect(providerProblems(ALL_CONTENT_SCHEMAS)).toEqual({
      hasOneOf: false,
      hasUniqueItems: false,
      untypedConstPaths: [],
      openObjectPaths: [],
      optionalPropertyPaths: [],
    });

    expect(parseContentOrchestrationV2(orchestration("card_news", "informational"))).toBeTruthy();
    expect(parseContentProposalRequestV2(proposalRequest())).toBeTruthy();
    expect(parseProposalBaseInputSnapshotV2(proposalBase())).toBeTruthy();
    expect(parseProposalInputSnapshotV2(proposalComposed())).toBeTruthy();
    expect(parseResearchEvidenceSnapshotV1(researchEvidence)).toBeTruthy();
    expect(parseContentProposalSetV2(proposalSet())).toBeTruthy();
    expect(parseContentGenerationInputV3(generationInput())).toBeTruthy();
    expect(parseImageGenerationPackageV1(imagePackage())).toBeTruthy();
    expect(parseCardNewsPlanV2(cardPlan)).toBeTruthy();
    expect(parseBlogPlanV2(blogPlan)).toBeTruthy();
    expect(parseReelPlanV2(reelPlan)).toBeTruthy();
    expect(parseAiContentManifestV3(manifest)).toBeTruthy();
  });

  it("exposes the exact catalog plan literals", () => {
    expect(PlanContractVersionSchema.anyOf.map((schema) => schema.const)).toEqual([
      CONTENT_FORMAT_CATALOG.card_news.planContractVersion,
      CONTENT_FORMAT_CATALOG.blog.planContractVersion,
      CONTENT_FORMAT_CATALOG.reel.planContractVersion,
    ]);
    expect(parseCardNewsPlanV2(cardPlan).contractVersion).toBe("card-news-plan.v2");
    expect(parseBlogPlanV2(blogPlan).contractVersion).toBe("blog-plan.v2");
    expect(parseReelPlanV2(reelPlan).contractVersion).toBe("reel-plan.v2");
    expect(() => parseReelPlanV2({ ...reelPlan, contractVersion: "marketing-plan.v2" }))
      .toThrow("reel_plan_v2_invalid");
    expect(() => parseReelPlanV2({ ...reelPlan, outputFormat: "marketing_content" }))
      .toThrow("reel_plan_v2_invalid");
  });

  it("requires an exact approved brand-rules.v1 snapshot in generation V3", () => {
    expect(parseContentGenerationInputV3(generationInput()).brandRules).toEqual(brandRules);
    const { brandRules: _missing, ...withoutRules } = generationInput();
    expect(() => parseContentGenerationInputV3(withoutRules)).toThrow("content_generation_input_v3_invalid");
    expect(() => parseContentGenerationInputV3({
      ...generationInput(),
      brandRules: { ...brandRules, legacyRules: true },
    })).toThrow("content_generation_input_v3_invalid");
  });

  it.each([
    ["orchestration", parseContentOrchestrationV2, orchestration("card_news", "informational"), "content-orchestration.v1"],
    ["generation", parseContentGenerationInputV3, generationInput(), "content-generation-input.v2"],
    ["image package", parseImageGenerationPackageV1, imagePackage(), "image-generation-package.v0"],
    ["card plan", parseCardNewsPlanV2, cardPlan, "card-news-plan.v1"],
    ["blog plan", parseBlogPlanV2, blogPlan, "blog-plan.v1"],
    ["reel plan", parseReelPlanV2, reelPlan, "marketing-plan.v2"],
    ["manifest", parseAiContentManifestV3, manifest, "ai-content.v2"],
  ] as const)("rejects omitted, unknown, and legacy %s versions", (_name, parser, value, legacyVersion) => {
    const { contractVersion, version, ...withoutVersion } = value as Record<string, unknown>;
    const versionKey = Object.hasOwn(value, "version") ? "version" : "contractVersion";
    expect(contractVersion ?? version).toBeTruthy();
    expect(() => parser(withoutVersion)).toThrow();
    expect(() => parser({ ...value, [versionKey]: "unknown.contract.v999" })).toThrow();
    expect(() => parser({ ...value, [versionKey]: legacyVersion })).toThrow();
  });

  it.each(["marketing_content", "single_image", "channel_text", "marketing"])(
    "rejects retired schema format %s",
    (outputFormat) => {
      expect(() => parseContentGenerationInputV3({
        ...generationInput(),
        outputSettings: { ...generationInput().outputSettings, outputFormat },
      })).toThrow("content_generation_input_v3_invalid");
      expect(() => parseAiContentManifestV3({ ...manifest, outputFormat }))
        .toThrow("ai_content_manifest_v3_invalid");
    },
  );

  it("requires exact closed V3 manifest asset and content variants", () => {
    expect(() => parseAiContentManifestV3({ ...manifest, type: "card_news" }))
      .toThrow("ai_content_manifest_v3_invalid");
    expect(() => parseAiContentManifestV3({
      ...manifest,
      assets: [{ ...manifest.assets[0], durationSeconds: null }],
    })).toThrow("ai_content_manifest_v3_invalid");
    expect(parseAiContentManifestV3({
      ...manifest,
      outputFormat: "blog",
      assets: [{ role: "html", index: 1, url: "https://example.com/content.html", fileName: "content.html", mimeType: "text/html" }],
      content: { title: "제목", summary: "요약", html: "<article>본문</article>", metaTitle: "메타", metaDescription: "설명" },
    })).toBeTruthy();
    expect(parseAiContentManifestV3({
      ...manifest,
      outputFormat: "reel",
      assets: [{
        role: "video", index: 1, url: "https://example.com/reel.mp4", fileName: "reel.mp4",
        mimeType: "video/mp4", width: 1080, height: 1920, durationSeconds: 4,
        videoCodec: "h264", fps: 30, audioCodec: null,
      }],
    })).toBeTruthy();
    expect(parseAiContentManifestV3({
      ...manifest,
      outputFormat: "reel",
      assets: [{
        role: "video", index: 1, url: "https://example.com/reel-with-bgm.mp4", fileName: "reel.mp4",
        mimeType: "video/mp4", width: 1080, height: 1920, durationSeconds: 3,
        videoCodec: "h264", fps: 30, audioCodec: "aac",
      }],
    })).toBeTruthy();
  });
});
