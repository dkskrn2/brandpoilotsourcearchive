import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  parseContentGenerationInputV3,
  parseImageGenerationPackageV1,
} from "./aiContentV3.js";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const sha = (character: string) => character.repeat(64);
const timestamp = "2026-07-31T00:00:00.000Z";

const ownedImage = () => ({
  storageUrl: "https://cdn.example.com/image.webp",
  storagePath: "owned/image.webp",
  mimeType: "image/webp",
  checksum: sha("A"),
});

const brandCore = () => ({
  versionId: id(1),
  companyOverview: " Company ",
  businessDescription: " Business ",
  primaryCategory: " Food ",
  detailedCategory: " Tea ",
  primaryTarget: " Adults ",
  differentiator: " Fresh ",
  coreAppeal: " Calm ",
});

const brandRulesContent = () => ({
  contractVersion: "brand-rules.v1",
  requiredPhrases: [], forbiddenPhrases: [], exaggerationRules: [],
  ctaRules: { defaultCta: "", allowed: [] }, channelRules: {},
  designRules: { colors: [], fonts: [], notes: [], referenceImages: [] },
  autoApprovalRules: { enabled: false, conditions: [] },
});
const stable = (value: unknown): unknown => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]))
    : value;
const brandRules = () => ({
  versionId: id(11), version: 1, content: brandRulesContent(),
  contentSha256: createHash("sha256").update(JSON.stringify(stable(brandRulesContent()))).digest("hex"),
});

const product = () => ({
  id: id(2),
  versionId: id(3),
  kind: "product",
  name: " Tea ",
  description: " Green tea ",
  features: [" Leaves "],
  benefits: [" Calm "],
  cautions: [" Caffeine "],
  evergreenPurchaseInfo: " Buy online ",
  images: [{ assetId: id(4), role: "hero", ...ownedImage() }],
});

const reference = () => ({
  referenceItemId: id(5),
  snapshotId: id(6),
  roles: ["planning"],
  title: " Guide ",
  sourceUrl: "https://source.example.com/guide",
  capturedAt: timestamp,
  contentHash: sha("B"),
  text: " Reference text ",
  image: ownedImage(),
});

const evidenceItem = (evidenceId = id(7)) => ({
  id: evidenceId,
  title: " Study ",
  url: "https://evidence.example.com/study",
  publisher: null,
  publishedAt: null,
  capturedAt: timestamp,
  claimSummary: " Claim ",
  contentHash: sha("C"),
});

const searchedEvidence = () => ({
  contractVersion: "research-evidence.v1",
  decision: "searched",
  reason: " Useful sources ",
  queries: [" green tea "],
  capturedAt: timestamp,
  items: [evidenceItem()],
});

const styleImage = () => ({
  referenceItemId: id(5),
  description: " Soft ",
  tags: [" calm "],
  ...ownedImage(),
});

const attachment = () => ({
  id: id(8),
  role: "supporting_image",
  fileName: " tea.webp ",
  mimeType: "image/webp",
  sizeBytes: 100,
  checksum: sha("D"),
  storageUrl: "https://cdn.example.com/attachment.webp",
  storagePath: "owned/attachment.webp",
});

const informationalDetails = () => ({
  kind: "informational",
  question: " Why tea? ",
  value: " Practical guidance ",
  whyNow: " Better habits ",
  learningPoints: [" Brewing ", " Timing "],
});

const marketingDetails = () => ({
  kind: "marketing",
  campaignObjective: " Sales ",
  situationAndNeed: " Afternoon energy ",
  productId: id(2),
  targetSegment: " Office workers ",
  strengths: [" Fresh "],
  limitations: [" Contains caffeine "],
  appeal: " Calm focus ",
  buyingBarriers: [" Price "],
  cta: " Buy now ",
});

const informationalProposal = () => ({
  id: id(9),
  conceptKey: " tea-guide ",
  title: " Tea guide ",
  informationalType: "how_to",
  oneLineIntent: " Teach brewing ",
  differentiator: " Simple ",
  differentiationAxes: ["question"],
  target: " Adults ",
  customerContext: " Choosing tea ",
  keyMessage: " Tea can fit a routine ",
  hook: " Brew better ",
  selectionReason: " Useful ",
  evidenceIds: [id(7)],
  referenceIds: [id(5)],
  outputFormat: "card_news",
  channelTargets: ["instagram"],
  assetCount: 1,
  outline: [{ index: 1, role: "cover", headline: " Tea ", purpose: " Introduce " }],
  purposeDetails: informationalDetails(),
});

const references = () => ({
  selected: [reference()],
  brandStyleImages: [styleImage()],
  avatarStyleImageId: id(5),
  attachments: [attachment()],
});

const informationalInput = () => ({
  contractVersion: "content-generation-input.v3",
  generationId: id(10),
  brandCore: brandCore(),
  brandRules: brandRules(),
  subject: { kind: "reference", referenceIds: [id(5)] },
  contentInstruction: " Make it practical ",
  product: null,
  researchEvidence: searchedEvidence(),
  references: references(),
  selectedProposal: informationalProposal(),
  userImageInstruction: " Soft light ",
  outputSettings: {
    outputFormat: "card_news",
    channelTargets: ["instagram"],
    aspectRatio: "1:1",
    outputCount: 1,
    purpose: "informational",
  },
  capturedAt: timestamp,
});

const marketingInput = () => ({
  ...informationalInput(),
  subject: { kind: "topic_text", title: " Green tea offer " },
  product: product(),
  researchEvidence: {
    contractVersion: "research-evidence.v1",
    decision: "not_needed",
    reason: " Product facts suffice ",
    queries: [],
    capturedAt: timestamp,
    items: [],
  },
  selectedProposal: {
    ...informationalProposal(),
    informationalType: null,
    evidenceIds: [],
    outputFormat: "marketing_content",
    purposeDetails: marketingDetails(),
  },
  outputSettings: {
    outputFormat: "marketing_content",
    channelTargets: ["instagram"],
    aspectRatio: "1:1",
    outputCount: 1,
    purpose: "marketing",
  },
});

const logoPolicy = () => ({
  allowGeneratedLogo: false,
  allowReservedLogoArea: false,
  allowExternalReferenceLogo: false,
  allowExistingProductPackagingLogo: true,
});

const imagePackage = () => ({
  contractVersion: "image-generation-package.v1",
  generationId: id(10),
  outputFormat: "card_news",
  purpose: "informational",
  assetCount: 1,
  aspectRatio: "1:1",
  channelTargets: ["instagram"],
  assets: [{
    index: 1,
    role: "cover",
    copy: " Tea ",
    visualDirection: " Soft ",
    evidenceIds: [id(7)],
    productImageAssetIds: [],
    attachmentIds: [id(8)],
  }],
  product: null,
  references: [reference()],
  brandStyleImages: [styleImage()],
  avatarStyleImageId: id(5),
  attachments: [attachment()],
  userImageInstruction: " Soft light ",
  logoPolicy: logoPolicy(),
});

const expectFinalInvalid = (value: unknown) => {
  expect(() => parseContentGenerationInputV3(value)).toThrow("worker_ai_content_v3_invalid");
};
const expectPackageInvalid = (value: unknown) => {
  expect(() => parseImageGenerationPackageV1(value)).toThrow("worker_ai_content_v3_invalid");
};

describe("worker content-generation-input.v3", () => {
  it("accepts an approved style image with an empty description and empty tags", () => {
    const input = informationalInput();
    input.references.brandStyleImages = [{ ...styleImage(), description: "", tags: [] }];
    expect(parseContentGenerationInputV3(input).references.brandStyleImages[0]).toMatchObject({
      description: "", tags: [],
    });
  });

  it("accepts canonical informational and marketing inputs and trims bounded strings", () => {
    const informational = parseContentGenerationInputV3(informationalInput());
    const marketing = parseContentGenerationInputV3(marketingInput());
    expect(informational.contentInstruction).toBe("Make it practical");
    expect(informational.brandCore.companyOverview).toBe("Company");
    expect(marketing.product?.features).toEqual(["Leaves"]);
    expect(marketing.selectedProposal.purposeDetails).toMatchObject({
      kind: "marketing",
      strengths: ["Fresh"],
      limitations: ["Contains caffeine"],
      buyingBarriers: ["Price"],
    });
    expect(marketing.researchEvidence.decision).toBe("not_needed");
  });

  it("rejects unknown keys and stale aliases at top and nested levels", () => {
    const base = informationalInput();
    const cases = [
      { ...base, version: "content-generation-input.v3" },
      { ...base, instruction: "alias" },
      { ...base, evidence: base.researchEvidence },
      { ...base, wiki: {} },
      { ...base, outputSettings: { ...base.outputSettings, ratio: "1:1" } },
      { ...base, references: { ...base.references, style: [] } },
      { ...base, references: { ...base.references, avatar: id(5) } },
      { ...base, brandCore: { ...base.brandCore, companyName: "Alias" } },
      { ...base, selectedProposal: { ...base.selectedProposal, version: "proposal-input.v2" } },
      { ...base, selectedProposal: { ...base.selectedProposal, outline: [{ ...base.selectedProposal.outline[0], extra: true }] } },
      { ...base, references: { ...base.references, selected: [{ ...base.references.selected[0], faq: {} }] } },
    ];
    cases.forEach(expectFinalInvalid);
  });

  it("enforces product and marketing arrays with bounded trimmed elements", () => {
    const valid = parseContentGenerationInputV3(marketingInput());
    expect(valid.product?.benefits).toEqual(["Calm"]);
    for (const badProduct of [
      { ...product(), features: "Leaves" },
      { ...product(), benefits: [""] },
      { ...product(), cautions: Array.from({ length: 51 }, () => "item") },
    ]) expectFinalInvalid({ ...marketingInput(), product: badProduct });
    for (const purposeDetails of [
      { ...marketingDetails(), strengths: "Fresh" },
      { ...marketingDetails(), limitations: [""] },
      { ...marketingDetails(), buyingBarriers: Array.from({ length: 21 }, () => "barrier") },
    ]) expectFinalInvalid({
      ...marketingInput(),
      selectedProposal: { ...marketingInput().selectedProposal, purposeDetails },
    });
  });

  it("enforces trim-aware finite bounds", () => {
    const parsed = parseContentGenerationInputV3({
      ...informationalInput(),
      subject: { kind: "topic_url", requestedUrl: " https://example.com/a ", canonicalUrl: "https://example.com/a", title: null, text: " article ", contentHash: sha("E"), capturedAt: timestamp },
      contentInstruction: ` ${"x".repeat(4_000)} `,
      userImageInstruction: ` ${"y".repeat(4_000)} `,
    });
    expect(parsed.subject.kind === "topic_url" && parsed.subject.text).toBe("article");
    for (const patch of [
      { subject: { kind: "topic_text", title: "x".repeat(501) } },
      { contentInstruction: "x".repeat(4_001) },
      { userImageInstruction: "x".repeat(4_001) },
      { subject: { kind: "topic_url", requestedUrl: "https://example.com", canonicalUrl: "https://example.com", title: null, text: "x".repeat(50_001), contentHash: sha("E"), capturedAt: timestamp } },
    ]) expectFinalInvalid({ ...informationalInput(), ...patch });
  });

  it("requires calendar-valid UTC timestamps and normalized SHA-256 values", () => {
    expect(parseContentGenerationInputV3({
      ...informationalInput(),
      capturedAt: "2024-02-29T23:59:59.123Z",
      researchEvidence: { ...searchedEvidence(), items: [{ ...evidenceItem(), contentHash: sha("F") }] },
    }).researchEvidence.items[0]?.contentHash).toBe(sha("f"));
    for (const capturedAt of ["2026-07-31", "2026-07-31T09:00:00+09:00", "2026-02-30T00:00:00Z"]) {
      expectFinalInvalid({ ...informationalInput(), capturedAt });
    }
    expectFinalInvalid({ ...informationalInput(), researchEvidence: { ...searchedEvidence(), items: [{ ...evidenceItem(), contentHash: "a".repeat(63) }] } });
    expectFinalInvalid({ ...informationalInput(), researchEvidence: { ...searchedEvidence(), items: [{ ...evidenceItem(), publishedAt: "2026-07-31T09:00:00+09:00" }] } });
    expectFinalInvalid({ ...informationalInput(), researchEvidence: { ...searchedEvidence(), items: [{ ...evidenceItem(), claimSummary: "x".repeat(4_001) }] } });
    expectFinalInvalid({ ...informationalInput(), references: { ...references(), selected: [{ ...reference(), sourceUrl: "ftp://source.example.com/guide" }] } });
  });

  it("allows duplicate queries but caps query and item lists at eight", () => {
    expect(parseContentGenerationInputV3({
      ...informationalInput(),
      researchEvidence: { ...searchedEvidence(), queries: ["same", "same"] },
    }).researchEvidence.queries).toEqual(["same", "same"]);
    expect(parseContentGenerationInputV3({
      ...informationalInput(),
      researchEvidence: { ...searchedEvidence(), queries: Array.from({ length: 8 }, (_, index) => `q${index}`) },
    }).researchEvidence.queries).toHaveLength(8);
    expect(parseContentGenerationInputV3({
      ...informationalInput(),
      researchEvidence: { ...searchedEvidence(), items: Array.from({ length: 8 }, (_, index) => evidenceItem(id(100 + index))) },
      selectedProposal: { ...informationalProposal(), evidenceIds: [id(100)] },
    }).researchEvidence.items).toHaveLength(8);
    expectFinalInvalid({ ...informationalInput(), researchEvidence: { ...searchedEvidence(), queries: Array.from({ length: 9 }, (_, index) => `q${index}`) } });
    expectFinalInvalid({ ...informationalInput(), researchEvidence: { ...searchedEvidence(), items: Array.from({ length: 9 }, (_, index) => evidenceItem(id(100 + index))) } });
  });

  it("enforces informational research and purpose/product invariants", () => {
    const notNeeded = { contractVersion: "research-evidence.v1", decision: "not_needed", reason: "No search", queries: [], capturedAt: timestamp, items: [] };
    expectFinalInvalid({ ...informationalInput(), researchEvidence: notNeeded });
    expectFinalInvalid({ ...informationalInput(), product: product() });
    expectFinalInvalid({ ...marketingInput(), product: null });
    expectFinalInvalid({ ...marketingInput(), researchEvidence: { ...notNeeded, queries: ["query"] } });
    expectFinalInvalid({ ...marketingInput(), researchEvidence: { ...notNeeded, items: [evidenceItem()] } });
  });

  it("binds reference subject, proposal evidence/reference/product, avatar, format, channel, and purpose", () => {
    const base = informationalInput();
    const marketing = marketingInput();
    const cases = [
      { ...base, subject: { kind: "reference", referenceIds: [id(99)] } },
      { ...base, selectedProposal: { ...base.selectedProposal, evidenceIds: [id(99)] } },
      { ...base, selectedProposal: { ...base.selectedProposal, referenceIds: [id(99)] } },
      { ...base, references: { ...base.references, avatarStyleImageId: id(99) } },
      { ...base, selectedProposal: { ...base.selectedProposal, outputFormat: "reel" } },
      { ...base, selectedProposal: { ...base.selectedProposal, channelTargets: ["threads"] } },
      { ...base, selectedProposal: { ...base.selectedProposal, purposeDetails: marketingDetails(), informationalType: null } },
      { ...marketing, selectedProposal: { ...marketing.selectedProposal, purposeDetails: { ...marketingDetails(), productId: id(99) } } },
    ];
    cases.forEach(expectFinalInvalid);
  });

  it("enforces proposal information type and format-specific outline/count rules", () => {
    const base = informationalInput();
    expectFinalInvalid({ ...base, selectedProposal: { ...base.selectedProposal, informationalType: null } });
    expectFinalInvalid({ ...marketingInput(), selectedProposal: { ...marketingInput().selectedProposal, informationalType: "how_to" } });
    expectFinalInvalid({ ...base, selectedProposal: { ...base.selectedProposal, assetCount: 2 } });
    expectFinalInvalid({ ...base, selectedProposal: { ...base.selectedProposal, assetCount: 0 } });
    expectFinalInvalid({ ...base, selectedProposal: { ...base.selectedProposal, assetCount: 6 } });
    expectFinalInvalid({ ...base, selectedProposal: { ...base.selectedProposal, outline: [{ ...base.selectedProposal.outline[0], index: 2 }] } });
  });

  it("rejects padded informationalType enum literals in final input", () => {
    const paddedInformationalTypeInput = () => {
      const input = informationalInput();
      return {
        ...input,
        selectedProposal: { ...input.selectedProposal, informationalType: " how_to " },
      };
    };

    expectFinalInvalid(paddedInformationalTypeInput());
  });

  it("requires null ratio for a final blog and a supported ratio for every non-blog format", () => {
    const base = informationalInput();
    const blog = {
      ...base,
      selectedProposal: { ...base.selectedProposal, outputFormat: "blog", channelTargets: ["blog_export"], assetCount: null },
      outputSettings: { ...base.outputSettings, outputFormat: "blog", channelTargets: ["blog_export"], aspectRatio: null },
    };
    expect(parseContentGenerationInputV3(blog).outputSettings.aspectRatio).toBeNull();
    expectFinalInvalid({ ...blog, outputSettings: { ...blog.outputSettings, aspectRatio: "16:9" } });
    expectFinalInvalid({ ...base, outputSettings: { ...base.outputSettings, aspectRatio: null } });
    expectFinalInvalid({ ...base, outputSettings: { ...base.outputSettings, outputFormat: "reel", aspectRatio: "1:1" }, selectedProposal: { ...base.selectedProposal, outputFormat: "reel" } });
  });
});

describe("worker image-generation-package.v1", () => {
  it("parses 0-8 unique UUID evidence IDs as an exact required asset field", () => {
    const parsed = parseImageGenerationPackageV1(imagePackage());
    expect(parsed.assets[0]?.evidenceIds).toEqual([id(7)]);
    expectPackageInvalid({ ...imagePackage(), assets: [{ ...imagePackage().assets[0], evidenceIds: [id(7), id(7)] }] });
    expectPackageInvalid({ ...imagePackage(), assets: [{ ...imagePackage().assets[0], evidenceIds: ["not-a-uuid"] }] });
    expectPackageInvalid({ ...imagePackage(), assets: [{ ...imagePackage().assets[0], evidenceIds: Array.from({ length: 9 }, (_, index) => id(index + 20)) }] });
    expect(parseImageGenerationPackageV1({
      ...imagePackage(), assets: [{ ...imagePackage().assets[0], evidenceIds: [] }],
    }).assets[0]?.evidenceIds).toEqual([]);
    const { evidenceIds: _evidenceIds, ...missingEvidenceIds } = imagePackage().assets[0];
    expectPackageInvalid({ ...imagePackage(), assets: [missingEvidenceIds] });
  });
  it("accepts the canonical informational image package and trims values", () => {
    const parsed = parseImageGenerationPackageV1(imagePackage());
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0]?.copy).toBe("Tea");
    expect(parsed.logoPolicy).toEqual(logoPolicy());
  });

  it("accepts a blog image package with a nonnull supported ratio", () => {
    const parsed = parseImageGenerationPackageV1({
      ...imagePackage(),
      outputFormat: "blog",
      channelTargets: ["blog_export"],
      aspectRatio: "16:9",
    });
    expect(parsed.outputFormat).toBe("blog");
    expect(parsed.aspectRatio).toBe("16:9");
  });

  it("rejects package aliases, nested unknown keys, and invalid channel/ratio combinations", () => {
    const base = imagePackage();
    const cases = [
      { ...base, version: "image-generation-package.v1" },
      { ...base, ratio: "1:1" },
      { ...base, style: [] },
      { ...base, avatar: id(5) },
      { ...base, assets: [{ ...base.assets[0], unexpected: true }] },
      { ...base, logoPolicy: { ...base.logoPolicy, logoUrl: "https://example.com/logo.png" } },
      { ...base, aspectRatio: null },
      { ...base, outputFormat: "reel", aspectRatio: "1:1" },
      { ...base, outputFormat: "blog", channelTargets: ["instagram"], aspectRatio: "16:9" },
    ];
    cases.forEach(expectPackageInvalid);
  });

  it("enforces count, continuous indexes, unique IDs, and membership bindings", () => {
    const marketing = {
      ...imagePackage(),
      purpose: "marketing",
      product: product(),
      assets: [{ ...imagePackage().assets[0], productImageAssetIds: [id(4)] }],
    };
    expect(parseImageGenerationPackageV1(marketing).product?.id).toBe(id(2));
    for (const value of [
      { ...imagePackage(), assetCount: 0 },
      { ...imagePackage(), assetCount: 2 },
      { ...imagePackage(), assets: [{ ...imagePackage().assets[0], index: 2 }] },
      { ...marketing, assets: [{ ...marketing.assets[0], productImageAssetIds: [id(99)] }] },
      { ...marketing, assets: [{ ...marketing.assets[0], productImageAssetIds: [id(4), id(4)] }] },
      { ...marketing, assets: [{ ...marketing.assets[0], attachmentIds: [id(99)] }] },
      { ...marketing, assets: [{ ...marketing.assets[0], attachmentIds: [id(8), id(8)] }] },
      { ...imagePackage(), product: product() },
    ]) expectPackageInvalid(value);
  });

  it("requires all fixed logo flags and no aliases", () => {
    for (const key of Object.keys(logoPolicy())) {
      expectPackageInvalid({
        ...imagePackage(),
        logoPolicy: { ...logoPolicy(), [key]: !(logoPolicy() as Record<string, boolean>)[key] },
      });
    }
    expectPackageInvalid({ ...imagePackage(), logoPolicy: { allowGeneratedLogo: false } });
  });
});
