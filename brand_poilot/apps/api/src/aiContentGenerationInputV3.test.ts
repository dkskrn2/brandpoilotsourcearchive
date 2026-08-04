import { describe, expect, it } from "vitest";
import {
  parseContentFinalizationDraftV2,
  parseContentGenerationStartV2,
  parseContentGenerationInputV3,
  parseContentOrchestrationV2,
  parseContentProposalSetV2,
  parseImageGenerationPackageV1,
  parseProposalInputSnapshotV2,
  parseResearchEvidenceSnapshotV1,
} from "./aiContentGenerationInputV3.js";

const id = (tail: number) => `00000000-0000-4000-8000-${String(tail).padStart(12, "0")}`;
const now = "2026-07-31T00:00:00.000Z";
const sha = (letter: string) => letter.repeat(64);
const ownedImage = () => ({
  storageUrl: "https://cdn.example.com/a.webp",
  storagePath: "owned/a.webp",
  mimeType: "image/webp",
  checksum: sha("A"),
});
const brandCore = () => ({
  versionId: id(1),
  companyOverview: " Company ",
  businessDescription: " Description ",
  primaryCategory: " Food ",
  detailedCategory: " Tea ",
  primaryTarget: " Adults ",
  differentiator: " Direct ",
  coreAppeal: " Calm ",
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
  evergreenPurchaseInfo: " Buy ",
  images: [{ assetId: id(4), role: "hero", ...ownedImage() }],
});
const evidenceItem = (itemId = id(5)) => ({
  id: itemId,
  title: " Study ",
  url: "https://source.example.com/study",
  publisher: " Source ",
  publishedAt: now,
  capturedAt: now,
  claimSummary: " A claim ",
  contentHash: sha("B"),
});
const evidence = () => ({
  contractVersion: "research-evidence.v1",
  decision: "searched",
  reason: " Needed ",
  queries: [" tea benefits "],
  capturedAt: now,
  items: [evidenceItem()],
});
const reference = (referenceItemId = id(6)) => ({
  referenceItemId,
  snapshotId: id(7),
  roles: ["planning"],
  title: " Reference ",
  sourceUrl: "https://reference.example.com",
  capturedAt: now,
  contentHash: sha("C"),
  text: " Reference text ",
  image: ownedImage(),
});
const requestSettings = () => ({
  outputFormat: "card_news",
  channelTargets: ["instagram"],
  aspectRatio: "1:1",
  outputCount: 1,
});
const finalSettings = () => ({
  outputFormat: "card_news",
  channelTargets: ["instagram"],
  aspectRatio: "1:1",
  outputCount: 1,
  purpose: "informational",
});
const informationalDetails = () => ({
  kind: "informational",
  question: " Which tea? ",
  value: " Clarity ",
  whyNow: " Summer ",
  learningPoints: [" Choose tea "],
});
const marketingDetails = () => ({
  kind: "marketing",
  campaignObjective: " Sell tea ",
  situationAndNeed: " Afternoon fatigue ",
  productId: id(2),
  targetSegment: " Adults ",
  strengths: [" Fresh "],
  limitations: [" Contains caffeine "],
  appeal: " Calm ",
  buyingBarriers: [" Price "],
  cta: " Buy now ",
});
const proposal = (conceptKey = "tea-guide") => ({
  conceptKey,
  title: " Tea guide ",
  informationalType: "how_to",
  oneLineIntent: " Teach ",
  differentiator: " Simple ",
  differentiationAxes: ["target"],
  target: ` Audience ${conceptKey} `,
  customerContext: " Choosing tea ",
  keyMessage: " Tea helps ",
  hook: " Try tea ",
  selectionReason: " Useful ",
  evidenceIds: [id(5)],
  referenceIds: [id(6)],
  outputFormat: "card_news",
  channelTargets: ["instagram"],
  assetCount: 1,
  outline: [{ index: 1, role: "cover", headline: " Tea ", purpose: " Introduce " }],
  purposeDetails: informationalDetails(),
});
const proposalSet = (...proposals: unknown[]) => ({
  contractVersion: "content-proposal.v2",
  proposals: proposals.length ? proposals : [proposal("one"), proposal("two"), proposal("three")],
});
const orchestration = () => ({
  contractVersion: "content-orchestration.v2",
  brandId: id(8),
  purpose: "informational",
  seed: { kind: "topic_text", title: " Tea " },
  contentInstruction: " Make it practical ",
  productId: null,
  outputSettings: requestSettings(),
});
const proposalInput = () => ({
  contractVersion: "proposal-input.v2",
  brandCore: brandCore(),
  subject: { kind: "topic_text", title: " Tea " },
  contentInstruction: null,
  product: null,
  references: [reference()],
  researchEvidence: evidence(),
  outputSettings: { ...requestSettings(), purpose: "informational" },
  capturedAt: now,
});
const styleImage = () => ({
  referenceItemId: id(11),
  description: " Soft ",
  tags: [" calm "],
  ...ownedImage(),
});
const attachment = () => ({
  id: id(20),
  role: "supporting_image",
  fileName: " tea.webp ",
  mimeType: "image/webp",
  sizeBytes: 100,
  checksum: sha("D"),
  storageUrl: "https://cdn.example.com/attachment.webp",
  storagePath: "owned/attachment.webp",
});
const finalInput = () => ({
  contractVersion: "content-generation-input.v3",
  generationId: id(9),
  brandCore: brandCore(),
  subject: { kind: "topic_text", title: " Tea " },
  contentInstruction: null,
  product: null,
  researchEvidence: evidence(),
  references: {
    selected: [reference()],
    brandStyleImages: [styleImage()],
    avatarStyleImageId: id(11),
    attachments: [attachment()],
  },
  selectedProposal: { id: id(10), ...proposal() },
  userImageInstruction: " Soft light ",
  outputSettings: finalSettings(),
  capturedAt: now,
});
const logoPolicy = () => ({
  allowGeneratedLogo: false,
  allowReservedLogoArea: false,
  allowExternalReferenceLogo: false,
  allowExistingProductPackagingLogo: true,
});
const imagePackage = () => ({
  contractVersion: "image-generation-package.v1",
  generationId: id(9),
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
    evidenceIds: [id(5)],
    productImageAssetIds: [],
    attachmentIds: [id(20)],
  }],
  product: null,
  references: [reference()],
  brandStyleImages: [styleImage()],
  avatarStyleImageId: id(11),
  attachments: [attachment()],
  userImageInstruction: " Soft light ",
  logoPolicy: logoPolicy(),
});

describe("ContentOrchestrationV2", () => {
  it("accepts canonical aspectRatio settings", () => {
    const parsed = parseContentOrchestrationV2({
      ...orchestration(),
      outputSettings: {
        outputFormat: "card_news",
        channelTargets: ["instagram"],
        aspectRatio: "1:1",
        outputCount: 1,
      },
    });

    expect(parsed.outputSettings.aspectRatio).toBe("1:1");
  });

  it("rejects a non-square card-news request", () => {
    expect(() => parseContentOrchestrationV2({
      ...orchestration(),
      outputSettings: { ...requestSettings(), aspectRatio: "4:5" },
    })).toThrow("content_orchestration_v2_invalid");
  });

  it("rejects the stale ratio settings alias", () => {
    const { aspectRatio: _aspectRatio, ...settingsWithoutAspectRatio } = requestSettings();

    expect(() => parseContentOrchestrationV2({
      ...orchestration(),
      outputSettings: { ...settingsWithoutAspectRatio, ratio: "1:1" },
    }))
      .toThrow("content_orchestration_v2_invalid");
  });

  it("parses a valid request and trims returned strings", () => {
    const parsed = parseContentOrchestrationV2(orchestration());
    expect(parsed.seed).toEqual({ kind: "topic_text", title: "Tea" });
    expect(parsed.contentInstruction).toBe("Make it practical");
  });

  it("rejects each forbidden client-owned top-level body from an otherwise valid request", () => {
    for (const [key, value] of [
      ["wikiItemIds", []],
      ["wikiSnapshots", []],
      ["faqData", {}],
      ["logoUrl", "https://cdn.example.com/logo.png"],
      ["brandCore", {}],
      ["product", {}],
      ["references", []],
    ] as const) {
      expect(() => parseContentOrchestrationV2({ ...orchestration(), [key]: value }), key)
        .toThrow("content_orchestration_v2_invalid");
    }
  });

  it("rejects unsafe URL schemes separately", () => {
    expect(() => parseContentOrchestrationV2({
      ...orchestration(),
      seed: { kind: "topic_url", url: "ftp://bad.example.com" },
    })).toThrow("content_orchestration_v2_invalid");
  });

  it("enforces reference seed cardinality, unique IDs, and nonempty unique valid roles", () => {
    const item = { referenceId: id(6), roles: ["planning"] };
    expect(parseContentOrchestrationV2({
      ...orchestration(),
      seed: { kind: "reference", items: [item] },
    }).seed).toEqual({ kind: "reference", items: [item] });
    for (const items of [
      [],
      Array.from({ length: 6 }, (_, index) => ({ referenceId: id(30 + index), roles: ["planning"] })),
      [item, item],
      [{ ...item, roles: [] }],
      [{ ...item, roles: ["planning", "planning"] }],
      [{ ...item, roles: ["bogus"] }],
    ]) {
      expect(() => parseContentOrchestrationV2({
        ...orchestration(),
        seed: { kind: "reference", items },
      })).toThrow("content_orchestration_v2_invalid");
    }
  });

  it("enforces one channel, outputCount 1, blog rules, and reel 9:16", () => {
    for (const outputSettings of [
      { ...requestSettings(), channelTargets: [] },
      { ...requestSettings(), channelTargets: ["instagram", "threads"] },
      { ...requestSettings(), outputCount: 2 },
      { ...requestSettings(), outputFormat: "blog", channelTargets: ["instagram"], aspectRatio: null },
      { ...requestSettings(), outputFormat: "blog", channelTargets: ["blog_export"], aspectRatio: "1:1" },
      { ...requestSettings(), outputFormat: "reel", channelTargets: ["instagram"], aspectRatio: "1:1" },
    ]) {
      expect(() => parseContentOrchestrationV2({ ...orchestration(), outputSettings }))
        .toThrow("content_orchestration_v2_invalid");
    }
    expect(parseContentOrchestrationV2({
      ...orchestration(),
      outputSettings: { outputFormat: "blog", channelTargets: ["blog_export"], aspectRatio: null, outputCount: 1 },
    }).outputSettings.outputFormat).toBe("blog");
    expect(parseContentOrchestrationV2({
      ...orchestration(),
      outputSettings: { outputFormat: "reel", channelTargets: ["instagram"], aspectRatio: "9:16", outputCount: 1 },
    }).outputSettings.aspectRatio).toBe("9:16");
  });

  it("enforces purpose/product and explicit title/instruction bounds", () => {
    expect(() => parseContentOrchestrationV2({ ...orchestration(), purpose: "marketing" }))
      .toThrow("content_orchestration_v2_invalid");
    expect(() => parseContentOrchestrationV2({
      ...orchestration(),
      purpose: "marketing",
      productId: id(2),
    })).not.toThrow();
    expect(() => parseContentOrchestrationV2({
      ...orchestration(),
      seed: { kind: "topic_text", title: "x".repeat(501) },
    })).toThrow("content_orchestration_v2_invalid");
    expect(() => parseContentOrchestrationV2({
      ...orchestration(),
      contentInstruction: "x".repeat(4_001),
    })).toThrow("content_orchestration_v2_invalid");
  });

  it("rejects recursive nested unknown keys", () => {
    expect(() => parseContentOrchestrationV2({
      ...orchestration(),
      outputSettings: { ...requestSettings(), unexpected: true },
    })).toThrow("content_orchestration_v2_invalid");
    expect(() => parseContentOrchestrationV2({
      ...orchestration(),
      seed: { kind: "topic_text", title: "Tea", unexpected: true },
    })).toThrow("content_orchestration_v2_invalid");
  });
});

describe("snapshot and proposal contracts", () => {
  it("accepts an approved marketing product without evergreen purchase information", () => {
    const value = {
      ...proposalInput(),
      outputSettings: { ...requestSettings(), purpose: "marketing" },
      product: { ...product(), evergreenPurchaseInfo: "" },
    };

    expect(parseProposalInputSnapshotV2(value).product?.evergreenPurchaseInfo).toBe("");
  });

  it("rejects cosmetically distinct proposals with no substantive target difference", () => {
    const base = { ...proposal("base"), differentiationAxes: ["target"] };

    expect(() => parseContentProposalSetV2(proposalSet(
      { ...base, conceptKey: "one", title: "First title", differentiator: "First wording" },
      { ...base, conceptKey: "two", title: "Second title", differentiator: "Second wording" },
      { ...base, conceptKey: "three", title: "Third title", differentiator: "Third wording" },
    ))).toThrow("content_orchestration_v2_invalid");
  });

  it("accepts proposals with genuinely distinct declared target values", () => {
    expect(parseContentProposalSetV2(proposalSet(
      { ...proposal("one"), differentiationAxes: ["target"], target: "New customers" },
      { ...proposal("two"), differentiationAxes: ["target"], target: "Returning customers" },
      { ...proposal("three"), differentiationAxes: ["target"], target: "Enterprise buyers" },
    )).proposals).toHaveLength(3);
  });

  it("rejects a pair collision even when the third target differs", () => {
    expect(() => parseContentProposalSetV2(proposalSet(
      { ...proposal("one"), differentiationAxes: ["target"], target: "Same audience" },
      { ...proposal("two"), differentiationAxes: ["target"], target: " Same audience " },
      { ...proposal("three"), differentiationAxes: ["target"], target: "Different audience" },
    ))).toThrow("content_orchestration_v2_invalid");
  });

  it("parses product string arrays and rejects invalid array shapes/elements", () => {
    const value = { ...proposalInput(), outputSettings: { ...requestSettings(), purpose: "marketing" }, product: product() };
    const parsed = parseProposalInputSnapshotV2(value);
    expect(parsed.product?.features).toEqual(["Leaves"]);
    expect(parsed.product?.benefits).toEqual(["Calm"]);
    expect(parsed.product?.cautions).toEqual(["Caffeine"]);
    for (const badProduct of [
      { ...product(), features: "Leaves" },
      { ...product(), benefits: [""] },
      { ...product(), cautions: [42] },
    ]) {
      expect(() => parseProposalInputSnapshotV2({ ...value, product: badProduct }))
        .toThrow("content_orchestration_v2_invalid");
    }
  });

  it("uses authoritative discriminators and rejects old aliases", () => {
    expect(parseProposalInputSnapshotV2(proposalInput()).contractVersion).toBe("proposal-input.v2");
    expect(parseContentProposalSetV2(proposalSet()).contractVersion).toBe("content-proposal.v2");
    expect(() => parseProposalInputSnapshotV2({
      ...proposalInput(),
      contractVersion: "proposal-input-snapshot.v2",
    })).toThrow("content_orchestration_v2_invalid");
    expect(() => parseContentProposalSetV2({
      ...proposalSet(),
      contractVersion: "content-proposal-set.v2",
    })).toThrow("content_orchestration_v2_invalid");
  });

  it("requires strict UTC timestamps and SHA-256 hashes while allowing duplicate queries", () => {
    const parsed = parseResearchEvidenceSnapshotV1({
      ...evidence(),
      queries: ["same", "same"],
      items: [{ ...evidenceItem(), contentHash: sha("A") }],
    });
    expect(parsed.queries).toEqual(["same", "same"]);
    expect(parsed.items[0]?.contentHash).toBe(sha("a"));
    for (const bad of [
      { ...evidence(), capturedAt: "2026-07-31" },
      { ...evidence(), capturedAt: "2026-07-31T09:00:00+09:00" },
      { ...evidence(), capturedAt: "2026-02-30T00:00:00Z" },
      { ...evidence(), items: [{ ...evidenceItem(), contentHash: "a".repeat(63) }] },
      { ...evidence(), items: [{ ...evidenceItem(), capturedAt: "not-a-date" }] },
      { ...evidence(), items: [{ ...evidenceItem(), publishedAt: "2026-07-31T09:00:00+09:00" }] },
      { ...evidence(), items: [{ ...evidenceItem(), claimSummary: "x".repeat(4_001) }] },
    ]) {
      expect(() => parseResearchEvidenceSnapshotV1(bad))
        .toThrow("content_orchestration_v2_invalid");
    }
  });

  it("enforces research query/item upper bounds and not_needed emptiness", () => {
    expect(() => parseResearchEvidenceSnapshotV1({
      ...evidence(),
      queries: Array.from({ length: 9 }, (_, index) => `q${index}`),
    })).toThrow("content_orchestration_v2_invalid");
    expect(() => parseResearchEvidenceSnapshotV1({
      ...evidence(),
      items: Array.from({ length: 9 }, (_, index) => evidenceItem(id(100 + index))),
    })).toThrow("content_orchestration_v2_invalid");
    expect(() => parseResearchEvidenceSnapshotV1({
      ...evidence(),
      decision: "not_needed",
      queries: ["query"],
      items: [],
    })).toThrow("content_orchestration_v2_invalid");
  });

  it("binds reference subjects to frozen references in proposal input", () => {
    expect(parseProposalInputSnapshotV2({
      ...proposalInput(),
      subject: { kind: "reference", referenceIds: [id(6)] },
    }).subject.kind).toBe("reference");
    expect(() => parseProposalInputSnapshotV2({
      ...proposalInput(),
      subject: { kind: "reference", referenceIds: [id(99)] },
    })).toThrow("content_orchestration_v2_invalid");
  });

  it("parses informational and marketing purposeDetails with array fields", () => {
    expect(parseContentProposalSetV2(proposalSet()).proposals[0].purposeDetails.kind)
      .toBe("informational");
    const marketing = {
      ...proposal("market-one"),
      informationalType: null,
      purposeDetails: marketingDetails(),
    };
    const parsed = parseContentProposalSetV2(proposalSet(
      marketing,
      { ...marketing, conceptKey: "market-two", target: "Returning customers" },
      { ...marketing, conceptKey: "market-three", target: "Enterprise buyers" },
    ));
    expect(parsed.proposals[0].purposeDetails).toMatchObject({
      kind: "marketing",
      strengths: ["Fresh"],
      limitations: ["Contains caffeine"],
      buyingBarriers: ["Price"],
    });
    expect(() => parseContentProposalSetV2(proposalSet(
      { ...marketing, purposeDetails: { ...marketingDetails(), strengths: "Fresh" } },
      { ...marketing, conceptKey: "market-two" },
      { ...marketing, conceptKey: "market-three" },
    ))).toThrow("content_orchestration_v2_invalid");
  });

  it("enforces exactly three unique concepts and format-specific outline/count rules", () => {
    expect(parseContentProposalSetV2(proposalSet()).proposals).toHaveLength(3);
    for (const proposals of [
      [proposal("one"), proposal("two")],
      [proposal("same"), proposal("same"), proposal("three")],
      [{ ...proposal("one"), assetCount: 0 }, proposal("two"), proposal("three")],
      [{ ...proposal("one"), assetCount: 6 }, proposal("two"), proposal("three")],
      [{ ...proposal("one"), assetCount: 2 }, proposal("two"), proposal("three")],
      [{ ...proposal("one"), outline: [{ ...proposal().outline[0], index: 2 }] }, proposal("two"), proposal("three")],
    ]) {
      expect(() => parseContentProposalSetV2(proposalSet(...proposals)))
        .toThrow("content_orchestration_v2_invalid");
    }
    const blog = {
      ...proposal("blog-one"),
      outputFormat: "blog",
      channelTargets: ["blog_export"],
      assetCount: null,
    };
    expect(parseContentProposalSetV2(proposalSet(
      blog,
      { ...blog, conceptKey: "blog-two", target: "Returning readers" },
      { ...blog, conceptKey: "blog-three", target: "Expert readers" },
    )).proposals[0].assetCount).toBeNull();
  });
});

describe("final input and image package contracts", () => {
  it("keeps existing non-square card-news snapshots readable for retry compatibility", () => {
    expect(parseContentGenerationInputV3({
      ...finalInput(),
      outputSettings: { ...finalSettings(), aspectRatio: "4:5" },
    }).outputSettings.aspectRatio).toBe("4:5");
    expect(parseImageGenerationPackageV1({
      ...imagePackage(),
      aspectRatio: "4:5",
    }).aspectRatio).toBe("4:5");
  });

  it("accepts only the narrow post-selection draft and start contracts", () => {
    const draft = {
      contractVersion: "content-finalization-draft.v2",
      avatarStyleImageId: id(11),
      userImageInstruction: "  natural editorial light  ",
      attachmentIds: [id(20)],
    };
    expect(parseContentFinalizationDraftV2(draft)).toEqual({
      ...draft,
      userImageInstruction: "natural editorial light",
    });
    expect(parseContentGenerationStartV2({
      contractVersion: "content-generation-start.v2",
      idempotencyKey: " final-start-1 ",
    })).toEqual({
      contractVersion: "content-generation-start.v2",
      idempotencyKey: "final-start-1",
    });
    for (const forbidden of ["referenceIds", "outputCount", "productId", "topic", "channelTargets", "proposalId", "logoUrl", "wikiItemIds", "faqData"]) {
      expect(() => parseContentFinalizationDraftV2({ ...draft, [forbidden]: [] }), forbidden)
        .toThrow("content_finalization_draft_v2_invalid");
      expect(() => parseContentGenerationStartV2({
        contractVersion: "content-generation-start.v2",
        idempotencyKey: "final-start-1",
        [forbidden]: [],
      }), forbidden).toThrow("content_generation_start_v2_invalid");
    }
  });

  it("allows style images that are separate from selected content references", () => {
    const parsed = parseContentGenerationInputV3(finalInput());
    expect(parsed.references.selected[0]?.referenceItemId).toBe(id(6));
    expect(parsed.references.brandStyleImages[0]?.referenceItemId).toBe(id(11));
    expect(parsed.references.avatarStyleImageId).toBe(id(11));
  });

  it("allows an empty approved style set and null avatar", () => {
    const input = finalInput();
    expect(parseContentGenerationInputV3({
      ...input,
      references: {
        ...input.references,
        brandStyleImages: [],
        avatarStyleImageId: null,
      },
    }).references).toMatchObject({
      brandStyleImages: [],
      avatarStyleImageId: null,
    });
  });

  it("accepts a registered style image with an empty description and no tags", () => {
    const input = finalInput();
    input.references.brandStyleImages = [{
      ...styleImage(),
      description: "   ",
      tags: [],
    }];

    expect(parseContentGenerationInputV3(input).references.brandStyleImages[0]).toMatchObject({
      description: "",
      tags: [],
    });
  });

  it("rejects padded informationalType enum literals in final input", () => {
    const input = finalInput();
    input.selectedProposal.informationalType = " how_to ";

    expect(() => parseContentGenerationInputV3(input))
      .toThrow("content_orchestration_v2_invalid");
  });

  it("accepts only authoritative final-input wire keys and trims normalized values", () => {
    const parsed = parseContentGenerationInputV3(finalInput());
    expect(parsed.contractVersion).toBe("content-generation-input.v3");
    expect(parsed.contentInstruction).toBeNull();
    expect(parsed.userImageInstruction).toBe("Soft light");
    expect(parsed.outputSettings.aspectRatio).toBe("1:1");
    expect(parsed.references.brandStyleImages[0]?.description).toBe("Soft");
    for (const alias of ["version", "instruction", "evidence"]) {
      expect(() => parseContentGenerationInputV3({
        ...finalInput(),
        [alias]: "alias",
      }), alias).toThrow("content_orchestration_v2_invalid");
    }
  });

  it("binds reference subjects and proposal evidence/reference subsets", () => {
    expect(parseContentGenerationInputV3({
      ...finalInput(),
      subject: { kind: "reference", referenceIds: [id(6)] },
    }).subject.kind).toBe("reference");
    for (const patch of [
      { subject: { kind: "reference", referenceIds: [id(99)] } },
      { selectedProposal: { ...finalInput().selectedProposal, evidenceIds: [id(99)] } },
      { selectedProposal: { ...finalInput().selectedProposal, referenceIds: [id(99)] } },
    ]) {
      expect(() => parseContentGenerationInputV3({ ...finalInput(), ...patch }))
        .toThrow("content_orchestration_v2_invalid");
    }
  });

  it("binds selected proposal product and output fields and enforces purpose evidence rules", () => {
    const marketingInput = {
      ...finalInput(),
      product: product(),
      researchEvidence: {
        contractVersion: "research-evidence.v1",
        decision: "not_needed",
        reason: "No research needed",
        queries: [],
        capturedAt: now,
        items: [],
      },
      selectedProposal: {
        ...finalInput().selectedProposal,
        informationalType: null,
        evidenceIds: [],
        purposeDetails: marketingDetails(),
      },
      outputSettings: { ...finalSettings(), purpose: "marketing" },
    };
    expect(parseContentGenerationInputV3(marketingInput).researchEvidence.decision).toBe("not_needed");
    for (const selectedProposal of [
      {
        ...marketingInput.selectedProposal,
        purposeDetails: { ...marketingDetails(), productId: id(99) },
      },
      { ...marketingInput.selectedProposal, outputFormat: "marketing_content" },
      { ...marketingInput.selectedProposal, channelTargets: ["threads"] },
    ]) {
      expect(() => parseContentGenerationInputV3({ ...marketingInput, selectedProposal }))
        .toThrow("content_orchestration_v2_invalid");
    }
    expect(() => parseContentGenerationInputV3({
      ...finalInput(),
      researchEvidence: marketingInput.researchEvidence,
    })).toThrow("content_orchestration_v2_invalid");
  });

  it("requires a null final aspect ratio for blog while allowing a blog proposal outline", () => {
    const blogProposal = {
      ...finalInput().selectedProposal,
      outputFormat: "blog",
      channelTargets: ["blog_export"],
      assetCount: null,
    };
    const blogInput = {
      ...finalInput(),
      selectedProposal: blogProposal,
      outputSettings: {
        ...finalSettings(),
        outputFormat: "blog",
        channelTargets: ["blog_export"],
        aspectRatio: null,
      },
    };
    expect(parseContentGenerationInputV3(blogInput).outputSettings.aspectRatio).toBeNull();
    expect(() => parseContentGenerationInputV3({
      ...blogInput,
      outputSettings: { ...blogInput.outputSettings, aspectRatio: "16:9" },
    })).toThrow("content_orchestration_v2_invalid");
  });

  it("enforces avatar membership and recursively rejects old reference aliases", () => {
    expect(() => parseContentGenerationInputV3({
      ...finalInput(),
      references: { ...finalInput().references, avatarStyleImageId: id(99) },
    })).toThrow("content_orchestration_v2_invalid");
    expect(() => parseContentGenerationInputV3({
      ...finalInput(),
      references: { ...finalInput().references, style: [] },
    })).toThrow("content_orchestration_v2_invalid");
  });

  it("requires 0-8 unique UUID evidence IDs on every image asset", () => {
    expect(parseImageGenerationPackageV1(imagePackage()).assets[0]?.evidenceIds).toEqual([id(5)]);
    expect(() => parseImageGenerationPackageV1({
      ...imagePackage(), assets: [{ ...imagePackage().assets[0], evidenceIds: [id(5), id(5)] }],
    })).toThrow("content_orchestration_v2_invalid");
    expect(() => parseImageGenerationPackageV1({
      ...imagePackage(), assets: [{ ...imagePackage().assets[0], evidenceIds: ["not-a-uuid"] }],
    })).toThrow("content_orchestration_v2_invalid");
    expect(() => parseImageGenerationPackageV1({
      ...imagePackage(), assets: [{ ...imagePackage().assets[0], evidenceIds: Array.from({ length: 9 }, (_, index) => id(index + 30)) }],
    })).toThrow("content_orchestration_v2_invalid");
    expect(parseImageGenerationPackageV1({
      ...imagePackage(), assets: [{ ...imagePackage().assets[0], evidenceIds: [] }],
    }).assets[0]?.evidenceIds).toEqual([]);
    const { evidenceIds: _evidenceIds, ...missingEvidenceIds } = imagePackage().assets[0];
    expect(() => parseImageGenerationPackageV1({ ...imagePackage(), assets: [missingEvidenceIds] }))
      .toThrow("content_orchestration_v2_invalid");
  });

  it("accepts only authoritative package keys and exact logo literals", () => {
    const parsed = parseImageGenerationPackageV1(imagePackage());
    expect(parsed.contractVersion).toBe("image-generation-package.v1");
    expect(parsed.logoPolicy).toEqual(logoPolicy());
    for (const alias of ["version", "ratio", "styleImages", "avatar", "instruction"]) {
      expect(() => parseImageGenerationPackageV1({ ...imagePackage(), [alias]: "alias" }), alias)
        .toThrow("content_orchestration_v2_invalid");
    }
    for (const key of Object.keys(logoPolicy())) {
      expect(() => parseImageGenerationPackageV1({
        ...imagePackage(),
        logoPolicy: { ...logoPolicy(), [key]: !(logoPolicy() as Record<string, boolean>)[key] },
      }), key).toThrow("content_orchestration_v2_invalid");
    }
  });

  it("enforces product-image and attachment membership", () => {
    const marketingPackage = {
      ...imagePackage(),
      purpose: "marketing",
      product: product(),
      assets: [{
        ...imagePackage().assets[0],
        productImageAssetIds: [id(4)],
        attachmentIds: [id(20)],
      }],
    };
    expect(parseImageGenerationPackageV1(marketingPackage).product?.features).toEqual(["Leaves"]);
    expect(() => parseImageGenerationPackageV1({
      ...marketingPackage,
      assets: [{ ...marketingPackage.assets[0], productImageAssetIds: [id(99)] }],
    })).toThrow("content_orchestration_v2_invalid");
    expect(() => parseImageGenerationPackageV1({
      ...marketingPackage,
      assets: [{ ...marketingPackage.assets[0], attachmentIds: [id(99)] }],
    })).toThrow("content_orchestration_v2_invalid");
  });

  it("enforces package asset count/index continuity and nested exact keys", () => {
    expect(() => parseImageGenerationPackageV1({
      ...imagePackage(),
      assetCount: 2,
    })).toThrow("content_orchestration_v2_invalid");
    expect(() => parseImageGenerationPackageV1({
      ...imagePackage(),
      assets: [{ ...imagePackage().assets[0], index: 2 }],
    })).toThrow("content_orchestration_v2_invalid");
    expect(() => parseImageGenerationPackageV1({
      ...imagePackage(),
      assets: [{ ...imagePackage().assets[0], unexpected: true }],
    })).toThrow("content_orchestration_v2_invalid");
  });

  it("accepts a blog image package with a nonnull supported aspectRatio", () => {
    const parsed = parseImageGenerationPackageV1({
      ...imagePackage(),
      outputFormat: "blog",
      channelTargets: ["blog_export"],
      aspectRatio: "16:9",
    });
    expect(parsed.outputFormat).toBe("blog");
    expect(parsed.aspectRatio).toBe("16:9");
  });
});
