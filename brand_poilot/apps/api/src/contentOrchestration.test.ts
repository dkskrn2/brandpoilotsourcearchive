import { describe, expect, it, vi } from "vitest";
import {
  assertContentGenerationStartAllowed,
  mapOrchestrationToWorkerType,
  parseContentOrchestrationV1,
  resolveContentProposalV2Input,
} from "./contentOrchestration.js";
import type {
  ApprovedBrandCoreSnapshotV2,
  ApprovedProductSnapshotV2,
  ContentOrchestrationV1,
  ContentOrchestrationV2,
  ContentSeedV2,
  FrozenReferenceSnapshotV2,
} from "./aiContentContracts.js";
import type { ChannelCapability } from "./channelCapabilities.js";
import type { ResolvedAiContentSubjectV2 } from "./aiContentSeedResolver.js";
import { parseContentOrchestrationV2 } from "./aiContentGenerationInputV3.js";

function orchestration(
  overrides: Partial<ContentOrchestrationV1> = {},
): ContentOrchestrationV1 {
  return {
    contractVersion: "content-orchestration.v1",
    contentFamily: "marketing",
    subject: {
      mode: "product_service",
      productServiceId: "product-service-version-1",
    },
    target: { id: null, snapshot: { label: "바쁜 고객" } },
    strategy: "benefit",
    outputFormat: "single_image",
    channelTargets: ["instagram"],
    brief: { goal: "제품의 검증된 효익 설명" },
    references: [{
      referenceItemId: "reference-1",
      roles: ["visual_composition"],
    }],
    avatar: null,
    ...overrides,
  };
}

describe("content orchestration", () => {
  it.each([
    ["card_news", "card_news"],
    ["blog", "blog"],
    ["single_image", "marketing"],
    ["channel_text", "marketing"],
  ] as const)("maps %s to the deterministic legacy worker type %s", (outputFormat, expected) => {
    expect(mapOrchestrationToWorkerType({
      contentFamily: "informational",
      outputFormat,
    })).toBe(expected);
    expect(mapOrchestrationToWorkerType({
      contentFamily: "marketing",
      outputFormat,
    })).toBe(expected);
  });

  it("parses a valid orchestration without promoting references into subject facts", () => {
    const parsed = parseContentOrchestrationV1(orchestration());

    expect(parsed).toEqual(orchestration());
    expect(parsed.references).toEqual([{
      referenceItemId: "reference-1",
      roles: ["visual_composition"],
    }]);
    expect(parsed.subject).toEqual({
      mode: "product_service",
      productServiceId: "product-service-version-1",
    });
    expect(parsed.subject).not.toHaveProperty("facts");
  });

  it("canonicalizes untrusted input to exact orchestration fields", () => {
    const input = {
      ...orchestration(),
      brandContext: { fabricatedFact: "외부 레퍼런스에서 승격됨" },
      subject: {
        mode: "product_service",
        productServiceId: "product-service-version-1",
        facts: [{ claim: "근거 없는 제품 사실" }],
      },
      references: [{
        referenceItemId: "reference-1",
        roles: ["planning"],
        brandContext: { copiedClaim: true },
      }],
    };

    const parsed = parseContentOrchestrationV1(input);

    expect(parsed).not.toHaveProperty("brandContext");
    expect(parsed.subject).toEqual({
      mode: "product_service",
      productServiceId: "product-service-version-1",
    });
    expect(parsed.references).toEqual([{
      referenceItemId: "reference-1",
      roles: ["planning"],
    }]);
  });

  it.each([
    { contentFamily: "informational", strategy: "benefit", outputFormat: "card_news" },
    { contentFamily: "marketing", strategy: "how_to", outputFormat: "single_image" },
    { contentFamily: "informational", strategy: "insight", outputFormat: "single_image" },
    { contentFamily: "marketing", strategy: "benefit", outputFormat: "blog" },
  ] as const)("rejects invalid family, strategy, and format combinations: %o", (invalid) => {
    expect(() => parseContentOrchestrationV1(orchestration(invalid)))
      .toThrow("content_orchestration_combination_invalid");
  });

  it("rejects a sixth external reference", () => {
    const references = Array.from({ length: 6 }, (_, index) => ({
      referenceItemId: `reference-${index + 1}`,
      roles: ["planning" as const],
    }));

    expect(() => parseContentOrchestrationV1(orchestration({ references })))
      .toThrow("content_orchestration_reference_limit_exceeded");
  });

  it("rejects duplicate roles on one reference", () => {
    expect(() => parseContentOrchestrationV1(orchestration({
      references: [{
        referenceItemId: "reference-1",
        roles: ["planning", "planning"],
      }],
    }))).toThrow("content_orchestration_reference_roles_invalid");
  });

  it("normalizes reference item identifiers", () => {
    const parsed = parseContentOrchestrationV1(orchestration({
      references: [{
        referenceItemId: "  reference-1  ",
        roles: ["planning"],
      }],
    }));

    expect(parsed.references[0]?.referenceItemId).toBe("reference-1");
  });

  it.each([
    ["reference-1", "reference-1"],
    [" reference-1", "reference-1 "],
  ])("rejects duplicate normalized reference IDs: %s / %s", (first, second) => {
    expect(() => parseContentOrchestrationV1(orchestration({
      references: [
        { referenceItemId: first, roles: ["planning"] },
        { referenceItemId: second, roles: ["copy_pattern"] },
      ],
    }))).toThrow("content_orchestration_reference_ids_invalid");
  });

  it("rejects non-JSON-safe trusted record values with a stable error", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const unsafeBriefs: Record<string, unknown>[] = [
      cyclic,
      { count: 1n },
      { missing: undefined },
    ];

    for (const brief of unsafeBriefs) {
      expect(() => parseContentOrchestrationV1(orchestration({ brief })))
        .toThrow("content_orchestration_invalid");
    }
  });

  it("detaches canonical nested values from later source mutations", () => {
    const input = orchestration({
      target: { id: null, snapshot: { nested: { label: "original" } } },
      brief: { nested: { goal: "original" } },
      references: [{
        referenceItemId: "reference-1",
        roles: ["planning"],
      }],
      avatar: {
        mode: "library",
        id: "avatar-1",
        snapshot: { nested: { asset: "original" } },
      },
    });
    const parsed = parseContentOrchestrationV1(input);

    (input.target.snapshot.nested as Record<string, unknown>).label = "mutated";
    (input.brief.nested as Record<string, unknown>).goal = "mutated";
    input.references[0]!.roles[0] = "copy_pattern";
    (input.avatar!.snapshot.nested as Record<string, unknown>).asset = "mutated";

    expect(parsed.target.snapshot).toEqual({ nested: { label: "original" } });
    expect(parsed.brief).toEqual({ nested: { goal: "original" } });
    expect(parsed.references[0]?.roles).toEqual(["planning"]);
    expect(parsed.avatar?.snapshot).toEqual({ nested: { asset: "original" } });
  });

  it("rejects two avatars at the runtime boundary", () => {
    const avatar = {
      mode: "library",
      id: "avatar-1",
      snapshot: { assetVersionId: "avatar-version-1" },
    };
    const invalid = {
      ...orchestration(),
      avatar: [avatar, { ...avatar, id: "avatar-2" }],
    };

    expect(() => parseContentOrchestrationV1(invalid))
      .toThrow("content_orchestration_avatar_invalid");
  });

  it.each([
    { ...orchestration(), contractVersion: "content-orchestration.v2" },
    { ...orchestration(), subject: { mode: "brand_topic", topic: "" } },
    { ...orchestration(), subject: { mode: "brand_topic", topic: "주제", wikiItemIds: [] } },
    { ...orchestration(), target: { id: 1, snapshot: {} } },
    { ...orchestration(), channelTargets: ["reels"] },
    { ...orchestration(), references: [{ referenceItemId: "", roles: ["planning"] }] },
    { ...orchestration(), references: [{ referenceItemId: "reference-1", roles: ["copying"] }] },
    { ...orchestration(), avatar: { mode: "library", id: "", snapshot: {} } },
  ])("rejects malformed orchestration contract fields: %o", (invalid) => {
    expect(() => parseContentOrchestrationV1(invalid))
      .toThrow("content_orchestration_invalid");
  });

  it("gates generation start by channel capability and rejects video channels", () => {
    const capabilities = [
      {
        channel: "instagram" as const,
        generationFormats: ["card_news", "single_image"] as const,
        exportModes: ["image"] as const,
        publishModes: ["instagram_feed_single"] as const,
      },
      {
        channel: "x" as const,
        generationFormats: [] as const,
        exportModes: ["text"] as const,
        publishModes: [],
      },
    ];

    expect(() => assertContentGenerationStartAllowed({
      outputFormat: "single_image",
      channelTargets: ["instagram"],
    }, capabilities)).not.toThrow();
    expect(() => assertContentGenerationStartAllowed({
      outputFormat: "channel_text",
      channelTargets: ["x"],
    }, capabilities)).not.toThrow();

    for (const channel of ["youtube", "tiktok"] as const) {
      expect(() => assertContentGenerationStartAllowed({
        outputFormat: "single_image",
        channelTargets: [channel],
      }, capabilities)).toThrow("content_orchestration_channel_unsupported");
    }
    expect(() => assertContentGenerationStartAllowed({
      outputFormat: "channel_text",
      channelTargets: ["instagram"],
    }, capabilities)).toThrow("content_orchestration_channel_capability_mismatch");
  });

  it("uses an authoritative publish mode for a publish-only channel capability", () => {
    expect(() => assertContentGenerationStartAllowed({
      outputFormat: "channel_text",
      channelTargets: ["x"],
    }, [{
      channel: "x",
      generationFormats: [],
      exportModes: [],
      publishModes: ["x_post"],
    }])).not.toThrow();

    expect(() => assertContentGenerationStartAllowed({
      outputFormat: "channel_text",
      channelTargets: ["x"],
    }, [{
      channel: "x",
      generationFormats: [],
      exportModes: [],
      publishModes: ["threads_text"],
    }])).toThrow("content_orchestration_channel_capability_mismatch");
  });

  it("requires an explicit blog export capability", () => {
    expect(() => assertContentGenerationStartAllowed({
      outputFormat: "blog",
      channelTargets: ["blog_export"],
    }, [])).toThrow("content_orchestration_channel_capability_mismatch");

    expect(() => assertContentGenerationStartAllowed({
      outputFormat: "blog",
      channelTargets: ["blog_export"],
    }, [{
      channel: "blog_export",
      generationFormats: [],
      exportModes: ["html"],
      publishModes: [],
    }])).not.toThrow();

    expect(() => assertContentGenerationStartAllowed({
      outputFormat: "single_image",
      channelTargets: ["blog_export"],
    }, [{
      channel: "blog_export",
      generationFormats: ["single_image"],
      exportModes: ["image"],
      publishModes: [],
    }])).toThrow("content_orchestration_channel_capability_mismatch");
  });
});

const v2Ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  brand: "20000000-0000-4000-8000-000000000002",
  otherBrand: "30000000-0000-4000-8000-000000000003",
  product: "40000000-0000-4000-8000-000000000004",
  referenceA: "50000000-0000-4000-8000-000000000005",
  referenceB: "50000000-0000-4000-8000-000000000006",
  coreVersion: "60000000-0000-4000-8000-000000000006",
  productVersion: "70000000-0000-4000-8000-000000000007",
  referenceSnapshotA: "80000000-0000-4000-8000-000000000008",
  referenceSnapshotB: "80000000-0000-4000-8000-000000000009",
  actor: "90000000-0000-4000-8000-000000000009",
  batch: "a0000000-0000-4000-8000-00000000000a",
};

function orchestrationV2(
  overrides: Partial<ContentOrchestrationV2> = {},
): ContentOrchestrationV2 {
  return {
    contractVersion: "content-orchestration.v2",
    brandId: v2Ids.brand,
    purpose: "informational",
    seed: { kind: "topic_text", title: "  운영 체크리스트  " },
    contentInstruction: "  실무 중심으로  ",
    productId: null,
    outputSettings: {
      outputFormat: "card_news",
      channelTargets: ["instagram"],
      aspectRatio: "1:1",
      outputCount: 1,
    },
    ...overrides,
  };
}

const approvedCoreV2: ApprovedBrandCoreSnapshotV2 = {
  versionId: v2Ids.coreVersion,
  companyOverview: "브랜드 개요",
  businessDescription: "사업 설명",
  primaryCategory: "교육",
  detailedCategory: "온라인 교육",
  primaryTarget: "초기 창업자",
  differentiator: "실전형",
  coreAppeal: "바로 적용",
};

const approvedProductV2: ApprovedProductSnapshotV2 = {
  id: v2Ids.product,
  versionId: v2Ids.productVersion,
  kind: "service",
  name: "브랜드 워크숍",
  description: "승인된 설명",
  features: ["1:1 진단"],
  benefits: ["빠른 정리"],
  cautions: ["결과는 참여도에 따라 다름"],
  evergreenPurchaseInfo: "상시 신청",
  images: [],
};

const frozenReferencesV2: FrozenReferenceSnapshotV2[] = [
  {
    referenceItemId: v2Ids.referenceA,
    snapshotId: v2Ids.referenceSnapshotA,
    roles: ["planning", "copy_pattern"],
    title: "레퍼런스 A",
    sourceUrl: "https://example.test/a",
    capturedAt: "2026-07-31T01:00:00.000Z",
    contentHash: "a".repeat(64),
    text: "동결 본문 A",
    image: null,
  },
  {
    referenceItemId: v2Ids.referenceB,
    snapshotId: v2Ids.referenceSnapshotB,
    roles: ["visual_composition"],
    title: "레퍼런스 B",
    sourceUrl: "https://example.test/b",
    capturedAt: "2026-07-31T02:00:00.000Z",
    contentHash: "b".repeat(64),
    text: "동결 본문 B",
    image: null,
  },
];

function readyCapability(
  overrides: Partial<ChannelCapability> = {},
): ChannelCapability {
  return {
    channel: "instagram",
    catalogStatus: "available",
    enabled: true,
    connectionStatus: "connected",
    canGenerate: true,
    generationFormats: ["card_news", "reel"],
    exportModes: ["image"],
    publishModes: ["instagram_feed_carousel"],
    readiness: "ready",
    reasonCode: null,
    ...overrides,
  };
}

function v2Harness() {
  const events: string[] = [];
  const loadChannelCapability = vi.fn(async () => {
    events.push("capability");
    return readyCapability();
  });
  const resolveAiContentSeed = vi.fn(async (
    seed: ContentSeedV2,
  ): Promise<ResolvedAiContentSubjectV2> => {
    events.push("resolve");
    if (seed.kind === "topic_text") return { kind: "topic_text", title: seed.title.trim() };
    if (seed.kind === "reference") {
      return { kind: "reference", referenceIds: seed.items.map((item) => item.referenceId) };
    }
    throw new Error("URL_RESOLVER_NOT_STUBBED");
  });
  const loadApprovedCore = vi.fn(async () => {
    events.push("core");
    return approvedCoreV2;
  });
  const loadApprovedProduct = vi.fn(async () => {
    events.push("product");
    return approvedProductV2;
  });
  const freezeReferences = vi.fn(async () => {
    events.push("references");
    return frozenReferencesV2;
  });
  return {
    events,
    deps: {
      loadChannelCapability,
      resolveAiContentSeed,
      snapshotRepository: {
        loadApprovedCore,
        loadApprovedProduct,
        freezeReferences,
        revalidateFrozenResources: vi.fn(),
        loadApprovedStyleImages: vi.fn(),
      },
      loadApprovedCore,
      loadApprovedProduct,
      freezeReferences,
      now: () => new Date("2026-08-01T03:00:00.000Z"),
    },
  };
}

function resolveV2(
  body: ContentOrchestrationV2,
  harness: ReturnType<typeof v2Harness>,
) {
  return resolveContentProposalV2Input(parseContentOrchestrationV2(body), {
    workspaceId: v2Ids.workspace,
    brandId: v2Ids.brand,
  }, harness.deps);
}

describe("V2 proposal input resolver", () => {
  it("builds an informational text base snapshot in dependency order without product or reference reads", async () => {
    const harness = v2Harness();

    const result = await resolveV2(orchestrationV2(), harness);

    expect(result.channelTarget).toBe("instagram");
    expect(harness.events).toEqual(["capability", "resolve", "core"]);
    expect(harness.deps.loadApprovedProduct).not.toHaveBeenCalled();
    expect(harness.deps.freezeReferences).not.toHaveBeenCalled();
    expect(result.inputSnapshot).toEqual({
      contractVersion: "proposal-base-input.v2",
      brandCore: approvedCoreV2,
      subject: { kind: "topic_text", title: "운영 체크리스트" },
      contentInstruction: "실무 중심으로",
      product: null,
      references: [],
      outputSettings: {
        outputFormat: "card_news",
        channelTargets: ["instagram"],
        aspectRatio: "1:1",
        outputCount: 1,
        purpose: "informational",
      },
      capturedAt: "2026-08-01T03:00:00.000Z",
    });
  });

  it("resolves a URL seed once and persists the exact frozen URL subject", async () => {
    const harness = v2Harness();
    const subject: ResolvedAiContentSubjectV2 = {
      kind: "topic_url",
      requestedUrl: "https://example.test/requested",
      canonicalUrl: "https://example.test/canonical",
      title: "수집 제목",
      text: "수집 본문",
      contentHash: "c".repeat(64),
      capturedAt: "2026-08-01T02:30:00.000Z",
    };
    harness.deps.resolveAiContentSeed.mockResolvedValueOnce(subject);
    const body = orchestrationV2({
      seed: { kind: "topic_url", url: "https://example.test/requested" },
    });

    const result = await resolveV2(body, harness);

    expect(harness.deps.resolveAiContentSeed).toHaveBeenCalledOnce();
    expect(harness.deps.resolveAiContentSeed).toHaveBeenCalledWith(body.seed);
    expect(result.inputSnapshot.subject).toEqual(subject);
    expect(harness.deps.freezeReferences).not.toHaveBeenCalled();
  });

  it("freezes a reference seed once with canonical IDs and roles in request order", async () => {
    const harness = v2Harness();
    const body = orchestrationV2({
      seed: {
        kind: "reference",
        items: [
          { referenceId: v2Ids.referenceA.toUpperCase(), roles: ["planning", "copy_pattern"] },
          { referenceId: v2Ids.referenceB, roles: ["visual_composition"] },
        ],
      },
    });

    const result = await resolveV2(body, harness);

    expect(harness.deps.freezeReferences).toHaveBeenCalledOnce();
    expect(harness.deps.freezeReferences).toHaveBeenCalledWith(
      { workspaceId: v2Ids.workspace, brandId: v2Ids.brand },
      [
        { referenceId: v2Ids.referenceA, roles: ["planning", "copy_pattern"] },
        { referenceId: v2Ids.referenceB, roles: ["visual_composition"] },
      ],
    );
    expect(result.inputSnapshot.references).toEqual(frozenReferencesV2);
    expect(harness.deps.loadApprovedProduct).not.toHaveBeenCalled();
  });

  it("loads the requested approved product exactly once for marketing", async () => {
    const harness = v2Harness();
    const body = orchestrationV2({ purpose: "marketing", productId: v2Ids.product });

    const result = await resolveV2(body, harness);

    expect(harness.deps.loadApprovedProduct).toHaveBeenCalledOnce();
    expect(harness.deps.loadApprovedProduct).toHaveBeenCalledWith(
      { workspaceId: v2Ids.workspace, brandId: v2Ids.brand },
      v2Ids.product,
    );
    expect(result.inputSnapshot.product).toEqual(approvedProductV2);
  });

  it.each([
    ["disabled", { enabled: false }],
    ["disconnected", { connectionStatus: "not_connected" as const }],
    ["planned", { catalogStatus: "planned" as const }],
    ["incompatible", { generationFormats: ["reel"] as ChannelCapability["generationFormats"] }],
  ])("rejects a %s remote capability before resolver and snapshots", async (_label, override) => {
    const harness = v2Harness();
    harness.deps.loadChannelCapability.mockImplementationOnce(async () => {
      harness.events.push("capability");
      return readyCapability(override);
    });

    await expect(resolveV2(orchestrationV2(), harness))
      .rejects.toThrow("content_orchestration_channel_capability_mismatch");

    expect(harness.events).toEqual(["capability"]);
    expect(harness.deps.resolveAiContentSeed).not.toHaveBeenCalled();
    expect(harness.deps.loadApprovedCore).not.toHaveBeenCalled();
  });

  it("accepts local blog_export without loading a remote capability", async () => {
    const harness = v2Harness();
    const body = orchestrationV2({
      outputSettings: {
        outputFormat: "blog",
        channelTargets: ["blog_export"],
        aspectRatio: null,
        outputCount: 1,
      },
    });

    await resolveV2(body, harness);

    expect(harness.deps.loadChannelCapability).not.toHaveBeenCalled();
    expect(harness.events).toEqual(["resolve", "core"]);
  });

  it("passes RESOURCE_NOT_AVAILABLE through without translating it", async () => {
    const harness = v2Harness();
    const unavailable = new Error("RESOURCE_NOT_AVAILABLE");
    harness.deps.loadApprovedCore.mockRejectedValueOnce(unavailable);

    await expect(resolveV2(orchestrationV2(), harness))
      .rejects.toBe(unavailable);
  });
});
