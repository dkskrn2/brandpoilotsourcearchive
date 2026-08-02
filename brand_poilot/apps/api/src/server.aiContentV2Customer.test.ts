import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import { resolveAiContentSeed } from "./aiContentSeedResolver.js";
import type { ContentOrchestrationV2, ContentOutputFormatV2, ContentSeedV2 } from "./aiContentContracts.js";
import type { AiContentProposalBatchRecord } from "./aiContentRepository.js";
import type { AiContentSnapshotRepository } from "./aiContentSnapshotRepository.js";
import type { ChannelCapability } from "./channelCapabilities.js";
import type { ContentProposalOrchestrationV2Dependencies } from "./contentOrchestration.js";
import type { ApiRepository } from "./types.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const otherBrandId = "33333333-3333-4333-8333-333333333333";
const actorUserId = "44444444-4444-4444-8444-444444444444";
const batchId = "55555555-5555-4555-8555-555555555555";
const productId = "66666666-6666-4666-8666-666666666666";
const productVersionId = "77777777-7777-4777-8777-777777777777";
const coreVersionId = "88888888-8888-4888-8888-888888888888";
const referenceId = "99999999-9999-4999-8999-999999999999";
const referenceSnapshotId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const seedId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const auth = { cookie: "bp_session=session-1", "idempotency-key": "proposal-v2-1" };
const generationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const core = {
  versionId: coreVersionId,
  companyOverview: "브랜드 코어의 긴 회사 소개",
  businessDescription: "브랜드 코어의 긴 사업 설명",
  primaryCategory: "마케팅",
  detailedCategory: "콘텐츠 마케팅",
  primaryTarget: "브랜드 담당자",
  differentiator: "검증된 운영 데이터",
  coreAppeal: "빠른 실행",
};

const product = {
  id: productId,
  versionId: productVersionId,
  kind: "service" as const,
  name: "콘텐츠 운영 서비스",
  description: "승인된 제품의 긴 설명",
  features: ["운영 자동화"],
  benefits: ["시간 절약"],
  cautions: ["승인 필요"],
  evergreenPurchaseInfo: "상시 문의",
  images: [],
};

const frozenReference = {
  referenceItemId: referenceId,
  snapshotId: referenceSnapshotId,
  roles: ["planning" as const],
  title: "승인 레퍼런스",
  sourceUrl: "https://example.test/reference",
  capturedAt: "2026-08-01T00:00:00.000Z",
  contentHash: "a".repeat(64),
  text: "동결된 레퍼런스의 긴 본문",
  image: null,
};

function v2Body(overrides: Partial<ContentOrchestrationV2> = {}): ContentOrchestrationV2 {
  return {
    contractVersion: "content-orchestration.v2",
    brandId,
    purpose: "informational",
    seed: { kind: "topic_text", title: "운영 체크리스트" },
    contentInstruction: "실무 중심으로",
    productId: null,
    outputSettings: {
      outputFormat: "card_news",
      channelTargets: ["instagram"],
      aspectRatio: "4:5",
      outputCount: 1,
    },
    ...overrides,
  };
}

function readyCapability(overrides: Partial<ChannelCapability> = {}): ChannelCapability {
  return {
    channel: "instagram",
    catalogStatus: "available",
    enabled: true,
    connectionStatus: "connected",
    canGenerate: true,
    generationFormats: ["card_news", "reel", "marketing_content"],
    exportModes: ["image"],
    publishModes: ["instagram_feed_carousel"],
    readiness: "ready",
    reasonCode: null,
    ...overrides,
  };
}

function batch(input: { workspaceId: string; brandId: string; purpose: "informational" | "marketing" }): AiContentProposalBatchRecord {
  return {
    id: batchId,
    workspaceId: input.workspaceId,
    brandId: input.brandId,
    origin: "manual",
    contentFamily: input.purpose,
    request: {},
    sourceSnapshots: [],
    status: "queued",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-01T03:00:00.000Z",
    updatedAt: "2026-08-01T03:00:00.000Z",
  };
}

type SetupOverrides = {
  allowed?: boolean;
  capability?: ChannelCapability | null;
  crawlUrl?: (url: string) => Promise<{
    finalUrl: string;
    title: string | null;
    text: string;
    contentHash: string;
    rawText: string;
    httpStatus: number;
    canonicalUrl: string | null;
    metaDescription: string | null;
  }>;
  core?: typeof core;
  loadApprovedCore?: AiContentSnapshotRepository["loadApprovedCore"];
  loadApprovedProduct?: AiContentSnapshotRepository["loadApprovedProduct"];
  freezeReferences?: AiContentSnapshotRepository["freezeReferences"];
  referenceSeeds?: Awaited<ReturnType<ApiRepository["listAiContentReferenceSeeds"]>>;
};

function setup(overrides: SetupOverrides = {}) {
  const legacyCreate = vi.fn();
  const listAiContentReferenceSeeds = vi.fn(async () => overrides.referenceSeeds ?? []);
  const repository = {
    health: vi.fn(async () => ({
      database: "ok" as const,
      operations: {
        activeDmEnabled: false,
        dmWorker: "offline" as const,
        wikiWorker: "offline" as const,
        contentProposalWorker: "online" as const,
      },
    })),
    createAiContentProposalBatch: legacyCreate,
    listAiContentReferenceSeeds,
    updateAiContentFinalizationDraft: vi.fn(async (input) => ({ id: input.generationId, status: "draft" })),
    startAiContentGenerationV3: vi.fn(async (input) => ({ id: input.generationId, status: "queued" })),
    listAiContentUsage: vi.fn(async () => ({ usageDate: "2026-08-01", generationCount: 0, downloadCount: 0 })),
  } as unknown as ApiRepository;
  const kakaoAuth = {
    getSession: vi.fn(async () => ({
      userId: actorUserId,
      workspaceId,
      workspaceName: "Workspace",
      brandId,
      brandName: "Brand",
      displayName: "Tester",
      email: null,
    })),
    canAccessBrand: vi.fn(async () => overrides.allowed ?? true),
  };
  const crawlUrl = vi.fn(overrides.crawlUrl ?? (async (url: string) => ({
    finalUrl: url,
    title: "수집 제목",
    text: "수집된 본문",
    contentHash: "ignored-by-resolver",
    rawText: "<main>수집된 본문</main>",
    httpStatus: 200,
    canonicalUrl: null,
    metaDescription: null,
  })));
  const loadChannelCapability = vi.fn(async () => overrides.capability === undefined
    ? readyCapability()
    : overrides.capability);
  const loadApprovedCore = vi.fn(overrides.loadApprovedCore ?? (async () => overrides.core ?? core));
  const loadApprovedProduct = vi.fn(overrides.loadApprovedProduct ?? (async () => product));
  const freezeReferences = vi.fn(overrides.freezeReferences ?? (async () => [frozenReference]));
  const snapshotRepository: AiContentSnapshotRepository = {
    loadApprovedCore,
    loadApprovedProduct,
    freezeReferences,
    revalidateFrozenResources: vi.fn(),
    loadApprovedStyleImages: vi.fn(async () => []),
  };
  const resolveSeed = vi.fn((seed: ContentSeedV2) => resolveAiContentSeed(seed, {
    crawlUrl: crawlUrl as never,
    now: () => new Date("2026-08-01T02:00:00.000Z"),
  }));
  const createAiContentProposalBatchV2 = vi.fn(async (input) => batch(input));
  const getAiContentProposalBatchV2Replay = vi.fn(async () => null);
  const dependencies: ContentProposalOrchestrationV2Dependencies = {
    getAiContentProposalBatchV2Replay,
    loadChannelCapability,
    resolveAiContentSeed: resolveSeed,
    snapshotRepository,
    createAiContentProposalBatchV2,
    now: () => new Date("2026-08-01T03:00:00.000Z"),
  };
  const app = createServer({
    repository,
    kakaoAuth: kakaoAuth as never,
    aiContentProposalV2: dependencies,
    readinessPolicy: {
      schedulerEnabled: false,
      publishingEnabled: false,
      contentProposalsEnabled: true,
    },
    logger: false,
  });
  return {
    app,
    repository,
    kakaoAuth,
    dependencies,
    legacyCreate,
    crawlUrl,
    loadChannelCapability,
    resolveSeed,
    loadApprovedCore,
    loadApprovedProduct,
    freezeReferences,
    createAiContentProposalBatchV2,
    listAiContentReferenceSeeds,
  };
}

async function postV2(app: ReturnType<typeof createServer>, payload: object = v2Body()) {
  return app.inject({
    method: "POST",
    url: `/brands/${brandId}/ai-content/proposal-batches`,
    headers: auth,
    payload,
  });
}

describe("V2 customer proposal batches", () => {
  it.each([
    ["card_news", "informational", null, "4:5"],
    ["reel", "informational", null, "9:16"],
    ["marketing_content", "marketing", productId, "1:1"],
  ] as const)("creates a connected Instagram %s batch", async (outputFormat, purpose, selectedProductId, aspectRatio) => {
    const harness = setup();
    const response = await postV2(harness.app, v2Body({
      purpose,
      productId: selectedProductId,
      outputSettings: { outputFormat, channelTargets: ["instagram"], aspectRatio, outputCount: 1 },
    }));

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ batchId, status: "queued" });
    expect(harness.createAiContentProposalBatchV2).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      brandId,
      actorUserId,
      idempotencyKey: "proposal-v2-1",
      purpose,
      outputFormat,
      channelTarget: "instagram",
    }));
    if (purpose === "informational") expect(harness.loadApprovedProduct).not.toHaveBeenCalled();
    else expect(harness.loadApprovedProduct).toHaveBeenCalledWith({ workspaceId, brandId }, productId);
    expect(Object.keys(response.json())).toEqual(["batchId", "status"]);
    expect(response.body).not.toContain(core.companyOverview);
    expect(response.body).not.toContain(product.description);
    await harness.app.close();
  }, 15_000);

  it("creates a local blog_export batch without a remote capability read", async () => {
    const harness = setup({ capability: null });
    const response = await postV2(harness.app, v2Body({
      outputSettings: { outputFormat: "blog", channelTargets: ["blog_export"], aspectRatio: null, outputCount: 1 },
    }));

    expect(response.statusCode).toBe(202);
    expect(harness.loadChannelCapability).not.toHaveBeenCalled();
    expect(harness.createAiContentProposalBatchV2).toHaveBeenCalledOnce();
    await harness.app.close();
  });

  it.each([
    ["informational product", { productId }],
    ["marketing without product", { purpose: "marketing", productId: null }],
    ["referenceIds mixed with topic", { referenceIds: [referenceId] }],
    ["wiki item IDs", { wikiItemIds: [referenceId] }],
    ["FAQ data", { faqData: [{ question: "Q", answer: "A" }] }],
    ["logo URL", { logoUrl: "https://example.test/logo.png" }],
    ["two channel targets", { outputSettings: { outputFormat: "card_news", channelTargets: ["instagram", "threads"], aspectRatio: "4:5", outputCount: 1 } }],
    ["output count two", { outputSettings: { outputFormat: "card_news", channelTargets: ["instagram"], aspectRatio: "4:5", outputCount: 2 } }],
    ["route/body brand mismatch", { brandId: otherBrandId }],
  ])("rejects %s before any V2 side effect", async (_case, changes) => {
    const harness = setup();
    const response = await postV2(harness.app, { ...v2Body(), ...changes });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "content_orchestration_v2_invalid" });
    expect(harness.loadChannelCapability).not.toHaveBeenCalled();
    expect(harness.resolveSeed).not.toHaveBeenCalled();
    expect(harness.loadApprovedCore).not.toHaveBeenCalled();
    expect(harness.loadApprovedProduct).not.toHaveBeenCalled();
    expect(harness.freezeReferences).not.toHaveBeenCalled();
    expect(harness.createAiContentProposalBatchV2).not.toHaveBeenCalled();
    expect(harness.legacyCreate).not.toHaveBeenCalled();
    await harness.app.close();
  });

  it("rejects an unknown explicit contract version instead of falling through to V1", async () => {
    const harness = setup();
    const response = await postV2(harness.app, { ...v2Body(), contractVersion: "content-orchestration.v3" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "ai_content_proposal_contract_version_unsupported" });
    expect(harness.legacyCreate).not.toHaveBeenCalled();
    expect(harness.createAiContentProposalBatchV2).not.toHaveBeenCalled();
    await harness.app.close();
  });

  it.each([
    ["disabled", readyCapability({ enabled: false })],
    ["not connected", readyCapability({ connectionStatus: "not_connected", readiness: "needs_connection" })],
    ["planned", readyCapability({ catalogStatus: "planned" })],
    ["incompatible", readyCapability({ generationFormats: ["reel"] })],
  ])("rejects a %s channel before crawler and snapshot reads", async (_case, capability) => {
    const harness = setup({ capability });
    const response = await postV2(harness.app, v2Body({ seed: { kind: "topic_url", url: "https://example.test/topic" } }));

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "content_orchestration_channel_capability_mismatch" });
    expect(harness.crawlUrl).not.toHaveBeenCalled();
    expect(harness.loadApprovedCore).not.toHaveBeenCalled();
    expect(harness.createAiContentProposalBatchV2).not.toHaveBeenCalled();
    await harness.app.close();
  });

  it("persists the safely resolved URL snapshot but never echoes crawled text", async () => {
    const harness = setup({
      crawlUrl: async () => ({
        finalUrl: "https://example.test/canonical",
        title: "수집 제목",
        text: "민감한 수집 본문",
        contentHash: "ignored",
        rawText: "<main>민감한 수집 본문</main>",
        httpStatus: 200,
        canonicalUrl: null,
        metaDescription: null,
      }),
    });
    const response = await postV2(harness.app, v2Body({ seed: { kind: "topic_url", url: "https://example.test/original" } }));

    expect(response.statusCode).toBe(202);
    expect(harness.crawlUrl).toHaveBeenCalledWith("https://example.test/original");
    expect(harness.createAiContentProposalBatchV2).toHaveBeenCalledWith(expect.objectContaining({
      inputSnapshot: expect.objectContaining({
        subject: expect.objectContaining({
          kind: "topic_url",
          canonicalUrl: "https://example.test/canonical",
          text: "민감한 수집 본문",
        }),
      }),
    }));
    expect(response.body).not.toContain("민감한 수집 본문");
    await harness.app.close();
  });

  it("returns a stable crawl error without creating a batch", async () => {
    const harness = setup({ crawlUrl: async () => { throw new Error("private crawler failure"); } });
    const response = await postV2(harness.app, v2Body({ seed: { kind: "topic_url", url: "https://example.test/topic" } }));

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "ai_content_seed_resolution_failed" });
    expect(response.body).not.toContain("private crawler failure");
    expect(harness.createAiContentProposalBatchV2).not.toHaveBeenCalled();
    await harness.app.close();
  });

  it("freezes approved active references and persists only the internal snapshot", async () => {
    const harness = setup();
    const response = await postV2(harness.app, v2Body({
      seed: { kind: "reference", items: [{ referenceId, roles: ["planning"] }] },
    }));

    expect(response.statusCode).toBe(202);
    expect(harness.freezeReferences).toHaveBeenCalledWith(
      { workspaceId, brandId },
      [{ referenceId, roles: ["planning"] }],
    );
    expect(harness.createAiContentProposalBatchV2).toHaveBeenCalledWith(expect.objectContaining({
      inputSnapshot: expect.objectContaining({ references: [frozenReference] }),
    }));
    expect(response.body).not.toContain(frozenReference.text);
    await harness.app.close();
  });

  it.each([
    ["other-brand product", "product"],
    ["inactive product", "product"],
    ["unapproved product version", "product"],
    ["other-brand reference", "reference"],
    ["archived reference", "reference"],
  ] as const)("maps an unavailable %s to the uniform public error", async (_case, resource) => {
    const unavailable = async () => { throw new Error("RESOURCE_NOT_AVAILABLE"); };
    const harness = setup(resource === "product"
      ? { loadApprovedProduct: unavailable }
      : { freezeReferences: unavailable });
    const body = resource === "product"
      ? v2Body({ purpose: "marketing", productId, outputSettings: { outputFormat: "marketing_content", channelTargets: ["instagram"], aspectRatio: "1:1", outputCount: 1 } })
      : v2Body({ seed: { kind: "reference", items: [{ referenceId, roles: ["planning"] }] } });
    const response = await postV2(harness.app, body);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "RESOURCE_NOT_AVAILABLE" });
    expect(harness.createAiContentProposalBatchV2).not.toHaveBeenCalled();
    await harness.app.close();
  });
});

describe("V2 finalization customer boundary", () => {
  it.each([
    ["PATCH", { contractVersion: "content-finalization-draft.v99" }],
    ["POST", { contractVersion: "content-generation-start.v99" }],
  ] as const)("rejects an unknown explicit %s contract instead of falling back to legacy", async (method, payload) => {
    const harness = setup();
    const response = await harness.app.inject({
      method,
      url: `/brands/${brandId}/ai-content/generations/${generationId}${method === "POST" ? "/generate" : ""}`,
      headers: auth,
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "ai_content_contract_version_unsupported" });
    expect(harness.repository.updateAiContentFinalizationDraft).not.toHaveBeenCalled();
    expect(harness.repository.startAiContentGenerationV3).not.toHaveBeenCalled();
    await harness.app.close();
  });

  it("accepts only the narrow finalization draft and delegates the trusted values", async () => {
    const harness = setup();
    const body = {
      contractVersion: "content-finalization-draft.v2",
      avatarStyleImageId: null,
      userImageInstruction: "editorial light",
      attachmentIds: [],
    };
    const response = await harness.app.inject({
      method: "PATCH",
      url: `/brands/${brandId}/ai-content/generations/${generationId}`,
      headers: auth,
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(harness.repository.updateAiContentFinalizationDraft).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      actorUserId,
      generationId,
      draft: body,
    });
    await harness.app.close();
  });

  it.each(["referenceIds", "outputCount", "productId", "topic", "channelTargets", "proposalId", "wikiItemIds", "faqData", "logoUrl"])(
    "rejects post-selection field %s before a repository write",
    async (field) => {
      const harness = setup();
      const response = await harness.app.inject({
        method: "PATCH",
        url: `/brands/${brandId}/ai-content/generations/${generationId}`,
        headers: auth,
        payload: {
          contractVersion: "content-finalization-draft.v2",
          avatarStyleImageId: null,
          userImageInstruction: null,
          attachmentIds: [],
          [field]: [],
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "content_finalization_draft_v2_invalid" });
      expect(harness.repository.updateAiContentFinalizationDraft).not.toHaveBeenCalled();
      await harness.app.close();
    },
  );

  it("starts V3 with one sealed output and no client-controlled output count or references", async () => {
    const harness = setup();
    const response = await harness.app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/generate`,
      headers: auth,
      payload: {
        contractVersion: "content-generation-start.v2",
        idempotencyKey: "start-v3-1",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(harness.repository.startAiContentGenerationV3).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        brandId,
        actorUserId,
        generationId,
        contractVersion: "content-generation-start.v2",
        idempotencyKey: "start-v3-1",
      }),
      harness.dependencies.snapshotRepository,
    );
    expect(harness.repository.startAiContentGeneration).toBeUndefined();
    await harness.app.close();
  });

  it("allows the same V3 idempotency key to replay after quota is exhausted but rejects a different key", async () => {
    const harness = setup();
    vi.mocked(harness.repository.listAiContentUsage).mockResolvedValue({
      usageDate: "2026-08-01",
      generationCount: 10,
      downloadCount: 0,
    });
    vi.mocked(harness.repository.startAiContentGenerationV3).mockImplementation(async (input) => {
      if (input.idempotencyKey !== "same-final-start") throw new Error("ai_content_limit_reached");
      return { id: input.generationId, status: "queued" } as never;
    });

    const replay = await harness.app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/generate`,
      headers: auth,
      payload: {
        contractVersion: "content-generation-start.v2",
        idempotencyKey: "same-final-start",
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ id: generationId });

    const different = await harness.app.inject({
      method: "POST",
      url: `/brands/${brandId}/ai-content/generations/${generationId}/generate`,
      headers: auth,
      payload: {
        contractVersion: "content-generation-start.v2",
        idempotencyKey: "different-final-start",
      },
    });
    expect(different.statusCode).toBe(429);
    expect(different.json()).toEqual({ error: "ai_content_limit_reached" });
    expect(harness.repository.startAiContentGenerationV3).toHaveBeenCalledTimes(2);
    expect(harness.repository.listAiContentUsage).not.toHaveBeenCalled();
    await harness.app.close();
  });
});

describe("customer reference seed route", () => {
  const seeds = [
    {
      id: seedId,
      source: "saved_trend" as const,
      title: "인기 릴스",
      url: "https://instagram.example/reel/1",
      previewUrl: "https://cdn.example/reel.jpg",
      format: "reel" as const,
      primaryCategory: "마케팅",
      metrics: { exposureCount: 1000, likeCount: 120, commentsCount: 8 },
      checkedAt: "2026-07-31T00:00:00.000Z",
    },
    {
      id: referenceId,
      source: "saved_url" as const,
      title: "두 번째 소재",
      url: "https://example.test/two",
      previewUrl: null,
      format: "reel" as const,
      primaryCategory: "마케팅",
      metrics: { exposureCount: null, likeCount: 10, commentsCount: 2 },
      checkedAt: null,
    },
  ];

  it("uses only the approved server category and preserves repository popularity order", async () => {
    const harness = setup({ referenceSeeds: seeds });
    const response = await harness.app.inject({
      method: "GET",
      url: `/brands/${brandId}/ai-content/reference-seeds?format=reel`,
      headers: { cookie: auth.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(seeds);
    expect(harness.loadApprovedCore).toHaveBeenCalledWith({ workspaceId, brandId });
    expect(harness.listAiContentReferenceSeeds).toHaveBeenCalledWith({
      workspaceId,
      brandId,
      primaryCategory: "마케팅",
      format: "reel",
      limit: 20,
    });
    expect(response.body).not.toContain(core.companyOverview);
    expect(response.body).not.toContain("wiki");
    expect(response.body).not.toContain("faqData");
    expect(response.body).not.toContain("logoUrl");
    await harness.app.close();
  });

  it.each(["card_news", "blog", "reel", "marketing_content"] as ContentOutputFormatV2[])(
    "accepts the exact %s format and allows an empty result",
    async (format) => {
      const harness = setup();
      const response = await harness.app.inject({
        method: "GET",
        url: `/brands/${brandId}/ai-content/reference-seeds?format=${format}`,
        headers: { cookie: auth.cookie },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
      await harness.app.close();
    },
  );

  it("passes an empty approved primary category to the repository zero-result behavior", async () => {
    const harness = setup({ core: { ...core, primaryCategory: "" } });
    const response = await harness.app.inject({
      method: "GET",
      url: `/brands/${brandId}/ai-content/reference-seeds?format=blog`,
      headers: { cookie: auth.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
    expect(harness.listAiContentReferenceSeeds).toHaveBeenCalledWith(expect.objectContaining({ primaryCategory: "" }));
    await harness.app.close();
  });

  it.each([
    ["missing format", ""],
    ["invalid format", "?format=story"],
    ["client category", "?format=reel&category=retail"],
    ["unknown query field", "?format=reel&limit=50"],
  ])("rejects %s before core and seed reads", async (_case, query) => {
    const harness = setup();
    const response = await harness.app.inject({
      method: "GET",
      url: `/brands/${brandId}/ai-content/reference-seeds${query}`,
      headers: { cookie: auth.cookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "ai_content_reference_seed_query_invalid" });
    expect(harness.loadApprovedCore).not.toHaveBeenCalled();
    expect(harness.listAiContentReferenceSeeds).not.toHaveBeenCalled();
    await harness.app.close();
  });

  it("maps a missing approved core to the same resource privacy error", async () => {
    const harness = setup({ loadApprovedCore: async () => { throw new Error("RESOURCE_NOT_AVAILABLE"); } });
    const response = await harness.app.inject({
      method: "GET",
      url: `/brands/${brandId}/ai-content/reference-seeds?format=blog`,
      headers: { cookie: auth.cookie },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "RESOURCE_NOT_AVAILABLE" });
    expect(harness.listAiContentReferenceSeeds).not.toHaveBeenCalled();
    await harness.app.close();
  });

  it("rejects cross-brand access before any repository read", async () => {
    const harness = setup({ allowed: false });
    const response = await harness.app.inject({
      method: "GET",
      url: `/brands/${brandId}/ai-content/reference-seeds?format=blog`,
      headers: { cookie: auth.cookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "workspace_access_denied" });
    expect(harness.loadApprovedCore).not.toHaveBeenCalled();
    expect(harness.listAiContentReferenceSeeds).not.toHaveBeenCalled();
    await harness.app.close();
  });
});
