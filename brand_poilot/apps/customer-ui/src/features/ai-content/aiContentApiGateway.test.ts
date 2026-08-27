import { webcrypto } from "node:crypto";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { apiClient } from "../../lib/apiClient";
import { ApiRequestError } from "../../lib/apiClient";
import { contentGenerationFieldError, createAiContentApiGateway } from "./aiContentApiGateway";
import type { AiContentDraft, GenerationAttachment, SubjectAnalysisInput } from "./types";

const draft: AiContentDraft = {
  subjectType: "product",
  subjectInput: { sourceUrl: "https://example.com/product", name: "제품", promotion: "", description: "" },
  subjectAnalysisId: "analysis-1",
  subjectAnalysisVersion: 1,
  appealOverridesByTarget: {},
  selectedSubjectImageIds: ["image-1"],
  selectedTarget: null,
  selectedAppeal: null,
  brief: { purpose: "information", emphasis: "", cta: "", additionalInstruction: "", selectedColor: "#0057B8", attachments: [], aspectRatio: "1:1", outputCount: 1, outputDirections: [""] },
  analysisSource: "owned",
  productUrl: "https://example.com/product",
  selectedAnalysisImageIds: ["image-1"],
  audience: null,
  coreAppeal: null,
  secondaryAppeals: [],
  referenceIds: [],
};

function generation(status = "analyzing") {
  return {
    id: "generation-1",
    brandId: "brand-1",
    outputFormat: "card_news",
    purpose: "informational",
    title: "여름 추천",
    status,
    currentStage: "analysis",
    draft,
    analysis: {},
    outputs: [],
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

function clientWith(requestJson: ReturnType<typeof vi.fn>) {
  return { requestJson } as unknown as ReturnType<typeof apiClient>;
}

function localAttachment(): GenerationAttachment {
  const file = new File(["image"], "product.png", { type: "image/png" });
  return {
    id: "local-product",
    role: "product",
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    file,
    uploadStatus: "pending",
  };
}

describe("createAiContentApiGateway", () => {
  it("reads the persisted AI content publish queue result from the brand-scoped route", async () => {
    const stored = {
      channel: "instagram",
      deliveryFormat: "instagram_reel",
      channelOutputId: "channel-output-reel",
      queueId: "queue-reel",
      status: "published",
      publishedUrl: "https://instagram.example/reel",
      errorCode: null,
    };
    const requestJson = vi.fn().mockResolvedValue(stored);
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.getPublishQueueResult("brand-1", "queue-reel")).resolves.toEqual(stored);
    expect(requestJson).toHaveBeenCalledWith(
      "/brands/brand-1/ai-content/publish-queue/queue-reel",
      { method: "GET" },
    );
  });

  it("accepts the manual V2 proposal batch resume contract returned by the API", async () => {
    const request = {
      contractVersion: "content-orchestration.v2" as const,
      brandId: "brand-1",
      purpose: "informational" as const,
      seed: { kind: "topic_url" as const, url: "https://example.com/article" },
      contentInstruction: null,
      productId: null,
      outputSettings: {
        outputFormat: "reel" as const,
        channelTargets: ["instagram"] as ["instagram"],
        aspectRatio: "9:16" as const,
        outputCount: 1 as const,
      },
    };
    const requestJson = vi.fn().mockResolvedValue({
      id: "batch-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      origin: "manual",
      contentFamily: "informational",
      request,
      sourceSnapshots: [],
      status: "queued",
      proposals: [],
      researchEvidence: { items: [] },
      selectedReferences: [],
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-08-09T00:30:51.542Z",
      updatedAt: "2026-08-09T00:30:51.542Z",
    });
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.getProposalBatch("brand-1", "batch-1"))
      .resolves.toMatchObject({ request, status: "queued", contentFamily: "informational" });
  });

  it("rejects the worker-internal V2 request contract at the customer batch boundary", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      id: "batch-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      origin: "manual",
      contentFamily: "informational",
      request: { contractVersion: "content-proposal-request.v2" },
      sourceSnapshots: [],
      status: "queued",
      proposals: [],
      researchEvidence: { items: [] },
      selectedReferences: [],
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-08-09T00:30:51.542Z",
      updatedAt: "2026-08-09T00:30:51.542Z",
    });
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.getProposalBatch("brand-1", "batch-1"))
      .rejects.toThrow("ai_content_proposal_batch_response_invalid");
  });

  it("calls the proposal batch, inbox, selection, dismissal, and draft-reference contracts", async () => {
    const batch = {
      id: "batch-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      origin: "manual",
      contentFamily: "informational",
      request: {
        contractVersion: "content-orchestration.v2",
        brandId: "brand-1",
        purpose: "informational",
        seed: { kind: "topic_text", title: "여름 관리" },
        contentInstruction: null,
        productId: null,
        outputSettings: {
          outputFormat: "blog",
          channelTargets: ["blog_export"],
          aspectRatio: null,
          outputCount: 1,
        },
      },
      sourceSnapshots: [],
      status: "queued",
      proposals: [],
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
    };
    const proposal = {
      id: "proposal-1",
      batchId: "batch-1",
      proposal: {
        contractVersion: "content-proposal.v1",
        title: "여름 관리",
        reasonToCreateNow: "지금 필요한 정보",
        contentFamily: "informational",
        topic: "여름 관리",
        target: {},
        messageStrategy: "how_to",
        hook: "더운 날에도 편안하게",
        keyMessage: "세 단계로 관리하세요",
        evidence: [],
        outline: [],
        outputFormat: "blog",
        channelTargets: ["blog_export"],
        recommendedReferenceQuery: { strategies: ["how_to"], formats: ["blog"], tags: ["여름"] },
      },
      status: "suggested",
      generationId: null,
      createdAt: "2026-07-28T00:00:00.000Z",
    };
    const requestJson = vi.fn()
      .mockResolvedValueOnce({ batchId: "batch-1", status: "queued" })
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([proposal])
      .mockResolvedValueOnce(generation("analyzing"))
      .mockResolvedValueOnce(proposal)
      .mockResolvedValueOnce([{ assetType: "reference", assetId: "ref-1", generationId: "generation-1", title: "초안" }]);
    const listAiContentReferenceSeeds = vi.fn().mockResolvedValue([]);
    const gateway = createAiContentApiGateway({
      ...clientWith(requestJson),
      listAiContentReferenceSeeds,
    });
    const request = {
      contractVersion: "content-orchestration.v2" as const,
      brandId: "brand-1",
      purpose: "informational" as const,
      seed: {
        kind: "reference" as const,
        items: [{ referenceId: "reference-1", roles: ["planning" as const] }],
      },
      contentInstruction: "근거를 간결하게",
      productId: null,
      outputSettings: {
        outputFormat: "blog" as const,
        channelTargets: ["blog_export"] as ["blog_export"],
        aspectRatio: null,
        outputCount: 1 as const,
      },
    };

    await expect(gateway.createProposalBatch("brand-1", { idempotencyKey: "batch-key", request }))
      .resolves.toEqual({ batchId: "batch-1", status: "queued" });
    await gateway.getProposalBatch("brand-1", "batch-1");
    await gateway.listSuggestedProposals("brand-1");
    await gateway.selectProposal("brand-1", "proposal-1", "select-key");
    await gateway.dismissProposal("brand-1", "proposal-1");
    await gateway.listDraftReferences("brand-1", "reference", "ref-1");
    await gateway.listReferenceSeeds("brand-1", "blog");

    expect(requestJson.mock.calls).toEqual([
      ["/brands/brand-1/ai-content/proposal-batches", {
        method: "POST",
        headers: { "Idempotency-Key": "batch-key" },
        body: JSON.stringify(request),
      }],
      ["/brands/brand-1/ai-content/proposal-batches/batch-1", { method: "GET" }],
      ["/brands/brand-1/ai-content/proposals?status=suggested", { method: "GET" }],
      ["/brands/brand-1/ai-content/proposals/proposal-1/select", { method: "POST", body: JSON.stringify({ idempotencyKey: "select-key" }) }],
      ["/brands/brand-1/ai-content/proposals/proposal-1/dismiss", { method: "POST" }],
      ["/brands/brand-1/ai-content/draft-references?assetType=reference&assetId=ref-1", { method: "GET" }],
    ]);
    expect(listAiContentReferenceSeeds).toHaveBeenCalledWith("brand-1", "blog");
    expect(JSON.stringify(request)).not.toMatch(/wiki|faq|logo|companyOverview|productDescription/i);
  });

  it("keeps the subject analysis input identical to the v2 customer contract", () => {
    expectTypeOf<SubjectAnalysisInput>().toEqualTypeOf<{
      generationId: string;
      subjectType: "product" | "service";
      sourceUrl: string | null;
      attachmentIds: string[];
      manualInput: {
        name: string;
        promotionOrTerms: string;
        description: string;
      };
      idempotencyKey: string;
    }>();
  });

  it("normalizes terminal generation statuses to wizard step 5", async () => {
    const requestJson = vi.fn(async () => generation("completed"));
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    const result = await gateway.getGeneration("brand-1", "generation-1");

    expect(result.currentStep).toBe(5);
  });

  it("maps attachment lifecycle timestamps without changing existing generation fields", async () => {
    const requestJson = vi.fn(async () => ({
      ...generation("partial_failed"),
      attachmentsLockedAt: "2026-07-18T01:00:00.000Z",
      terminalAt: "2026-07-18T02:00:00.000Z",
      retryableUntil: "2026-08-02T02:00:00.000Z",
    }));
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.getGeneration("brand-1", "generation-1")).resolves.toMatchObject({
      status: "partial_failed",
      currentStep: 5,
      attachmentsLockedAt: "2026-07-18T01:00:00.000Z",
      terminalAt: "2026-07-18T02:00:00.000Z",
      retryableUntil: "2026-08-02T02:00:00.000Z",
    });
  });

  it("maps a valid optional asset progress snapshot", async () => {
    const requestJson = vi.fn(async () => ({
      ...generation("generating"),
      progress: {
        phase: "rendering",
        totalAssets: 2,
        completedAssets: 1,
        failedAssets: 0,
        items: [
          { index: 1, role: "cover", status: "completed" },
          { index: 2, role: "detail", status: "processing" },
        ],
        startedAt: "2026-08-11T00:00:00.000Z",
        updatedAt: "2026-08-11T00:04:00.000Z",
      },
    }));

    await expect(createAiContentApiGateway(clientWith(requestJson)).getGeneration("brand-1", "generation-1"))
      .resolves.toMatchObject({ progress: { totalAssets: 2, completedAssets: 1 } });
  });

  it("drops only malformed progress while preserving the generation", async () => {
    const requestJson = vi.fn(async () => ({
      ...generation("generating"),
      progress: {
        phase: "rendering", totalAssets: 2, completedAssets: 2, failedAssets: 0,
        items: [
          { index: 1, role: "cover", status: "completed" },
          { index: 1, role: "duplicate", status: "completed" },
        ],
        startedAt: null, updatedAt: "2026-08-11T00:04:00.000Z",
      },
    }));

    const result = await createAiContentApiGateway(clientWith(requestJson)).getGeneration("brand-1", "generation-1");
    expect(result.status).toBe("generating");
    expect(result.progress).toBeNull();
  });

  it("rejects a retry response that does not contain exactly one child output", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
    const requestJson = vi.fn().mockResolvedValueOnce({ ...generation("queued"), outputs: undefined });
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.retryOutput("brand-1", "output-1", "다시 생성"))
      .rejects.toThrow("ai_content_generation_retry_response_invalid");
    expect(requestJson.mock.calls).toEqual([
      ["/brands/brand-1/ai-content/outputs/output-1/retry", {
        method: "POST",
        body: JSON.stringify({
          contractVersion: "content-generation-retry.v1",
          idempotencyKey: "11111111-1111-4111-8111-111111111111",
          reason: "다시 생성",
        }),
      }],
    ]);
  });

  it.each(["queued", "planning", "generating"] as const)(
    "accepts a retry child that already advanced to %s before the response is parsed",
    async (status) => {
      const child = {
        ...generation(status),
        outputs: [{
          id: "output-child",
          generationId: "generation-1",
          outputIndex: 1,
          title: null,
          status,
          content: {},
          manifest: {},
          manifestUrl: null,
          failureCode: null,
          failureMessage: null,
          downloadedAt: null,
        }],
      };
      const gateway = createAiContentApiGateway(clientWith(vi.fn().mockResolvedValueOnce(child)));

      await expect(gateway.retryOutput("brand-1", "output-1", "다시 생성"))
        .resolves.toMatchObject({ id: "generation-1", outputs: [{ status }] });
    },
  );

  it("maps missing legacy lifecycle timestamps to null", async () => {
    const requestJson = vi.fn(async () => generation("failed"));
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.getGeneration("brand-1", "generation-1")).resolves.toMatchObject({
      status: "failed",
      attachmentsLockedAt: null,
      terminalAt: null,
      retryableUntil: null,
    });
  });

  it("preserves the frozen orchestration snapshot returned in the generation draft", async () => {
    const orchestration = {
      contractVersion: "content-orchestration.v1" as const,
      contentFamily: "informational" as const,
      subject: { mode: "brand_topic" as const, topic: "여름 피부 관리" },
      target: { id: "target-1", snapshot: { name: "민감성 피부 고객" } },
      strategy: "how_to" as const,
      outputFormat: "card_news" as const,
      channelTargets: ["instagram" as const],
      brief: { instruction: "세 단계로 설명" },
      references: [{ referenceItemId: "reference-1", roles: ["planning" as const, "copy_pattern" as const] }],
      avatar: {
        mode: "library" as const,
        id: "avatar-1",
        snapshot: { name: "브랜드 모델", representativeImageUrl: "https://cdn.example/avatar.png" },
      },
    };
    const requestJson = vi.fn(async () => ({
      ...generation("completed"),
      draft: { ...draft, orchestration },
    }));
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.getGeneration("brand-1", "generation-1")).resolves.toMatchObject({
      draft: { orchestration },
    });
  });

  it("rehydrates only confirmed server attachment records", async () => {
    const confirmed = {
      id: "attachment-1",
      role: "product" as const,
      fileName: "product.png",
      mimeType: "image/png",
      size: 5,
      storageUrl: "https://blob.example/product.png",
      storagePath: "confirmed/product.png",
      sessionId: "must-not-rehydrate",
      nonce: "must-not-rehydrate",
    };
    const requestJson = vi.fn(async () => ({
      ...generation("draft"),
      draft: {
        ...draft,
        subjectAttachments: [confirmed, { ...confirmed, id: "pending-1", storageUrl: undefined, storagePath: undefined }],
        brief: { ...draft.brief!, attachments: [{ ...confirmed, id: "failed-1", storageUrl: undefined, storagePath: undefined }, confirmed] },
      },
    }));
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    const result = await gateway.getGeneration("brand-1", "generation-1");

    const { sessionId: _sessionId, nonce: _nonce, ...serverRecord } = confirmed;
    expect(result.draft.subjectAttachments).toEqual([{ ...serverRecord, uploadStatus: "confirmed" }]);
    expect(result.draft.brief?.attachments).toEqual([{ ...serverRecord, uploadStatus: "confirmed" }]);
  });

  it.each([
    ["content_orchestration_channel_unsupported", { phase: "setup", field: "channelTargets" }],
    ["ai_content_seed_resolution_failed", { phase: "setup", field: "subject" }],
    ["ai_content_reference_not_found", { phase: "proposal_selection", field: "references" }],
    ["content_orchestration_avatar_invalid", { phase: "proposal_selection", field: "avatar" }],
    ["ai_content_output_count_invalid", { phase: "generating", field: "outputCount" }],
  ])("maps server validation %s back to its phase and field", (errorCode, expected) => {
    expect(contentGenerationFieldError(new ApiRequestError({ status: 422, errorCode })))
      .toMatchObject(expected);
  });

  it("uses the server field path and phase before error-code heuristics", () => {
    expect(contentGenerationFieldError(new ApiRequestError({
      status: 422,
      errorCode: "content_orchestration_invalid",
      fieldPath: "orchestration.avatar.id",
      details: { phase: "proposal_selection" },
    }))).toEqual({
      phase: "proposal_selection",
      field: "avatar",
      errorCode: "content_orchestration_invalid",
    });
  });

  it("maps frozen generation evidence without falling back to mutable libraries", async () => {
    const requestJson = vi.fn(async () => ({
      ...generation("completed"),
      evidenceSnapshot: {
        orchestration: {
          contractVersion: "generation-brief.v1",
          proposalId: "proposal-1",
          approvedProposalSnapshot: { title: "동결된 구현안", hook: "동결된 훅" },
          references: [{ itemId: "reference-1", roles: ["planning"] }],
          avatar: { id: "avatar-1", objectHash: "avatar-hash" },
        },
        generationInput: {
          contentType: "card_news",
          subject: { analysisId: "analysis-1", facts: [{ key: "benefit", value: "편안함" }] },
          message: { target: { id: "target-1", name: "고객" }, qualityBrief: { hook: "동결된 훅" } },
          creativeDirection: { outputCount: 1 },
        },
        references: [{ id: "reference-1", title: "동결된 레퍼런스", url: "https://example.com/reference", roles: ["planning"] }],
        avatar: { id: "avatar-1", objectHash: "avatar-hash" },
        proposal: { title: "동결된 구현안", hook: "동결된 훅" },
      },
    }));
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.getGeneration("brand-1", "generation-1")).resolves.toMatchObject({
      evidenceSnapshot: {
        proposal: { title: "동결된 구현안", hook: "동결된 훅" },
        references: [{ id: "reference-1", title: "동결된 레퍼런스" }],
        avatar: { id: "avatar-1", objectHash: "avatar-hash" },
      },
    });
    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["card_news", "informational", "image_gallery", true],
    ["card_news", "marketing", "image_gallery", true],
    ["blog", "informational", "html", false],
    ["blog", "marketing", "html", false],
    ["reel", "informational", "video", true],
    ["reel", "marketing", "video", true],
  ] as const)(
    "maps active V3 %s/%s results from manifest content and final columns",
    async (outputFormat, purpose, artifactKind, publishSupported) => {
    const asset = (role: string, index: number, mimeType = "image/png") => ({
      role,
      index,
      url: `https://cdn.example.com/${role}-${index}.${mimeType === "video/mp4" ? "mp4" : mimeType === "text/html" ? "html" : "png"}`,
      fileName: `${role}-${index}`,
      mimeType,
      ...(mimeType === "image/png" ? { width: 1080, height: role === "scene" ? 1920 : 1080 } : {}),
    });
    const assets = outputFormat === "card_news"
      ? [asset("slide", 1)]
      : outputFormat === "blog"
        ? [asset("html", 1, "text/html"), asset("inline", 1)]
        : [
            asset("scene", 1),
            { ...asset("video", 1, "video/mp4"), width: 1080, height: 1920, durationSeconds: 3, videoCodec: "h264", fps: 30, audioCodec: "aac" },
          ];
    const manifestContent = outputFormat === "blog"
      ? { title: "V3 블로그", summary: "V3 요약", html: "<article><h1>V3 블로그</h1></article>", metaTitle: "V3", metaDescription: "V3 설명" }
      : { caption: `V3 ${purpose}`, hashtags: ["#v3"], cta: "확인" };
    const requestJson = vi.fn(async () => ({
      ...generation("completed"),
      outputFormat,
      purpose,
      outputs: [{
      id: `output-${outputFormat}-${purpose}`,
      generationId: "generation-1",
      outputIndex: 1,
      title: null,
      status: "completed",
      content: { caption: "stale API content", html: "<p>stale</p>" },
      manifest: {
        version: "ai-content.v3",
        outputFormat,
        purpose,
        title: `V3 ${outputFormat}`,
        assets,
        content: manifestContent,
      },
      manifestUrl: null,
      failureCode: null,
      failureMessage: null,
      downloadedAt: null,
      }],
    }));

    const result = await createAiContentApiGateway(clientWith(requestJson)).getGeneration("brand-1", "generation-1");

    expect(result).toMatchObject({ outputFormat, purpose });
    expect(result).not.toHaveProperty("type");
    expect(result.outputs[0]).toMatchObject({
      title: `V3 ${outputFormat}`,
      manifestVersion: "ai-content.v3",
      outputFormat,
      publishSupported,
      artifact: { kind: artifactKind },
    });
    expect(result.outputs[0]).not.toHaveProperty("copy");
    expect(result.outputs[0]?.artifact?.text).toContain(outputFormat === "blog" ? "V3 블로그" : `V3 ${purpose}`);
    if (outputFormat === "blog") expect(result.outputs[0]?.artifact?.html).toBe(manifestContent.html);
  });

  it.each([
    ["ai-content.v2", "card_news", "informational"],
    ["ai-content.v3", "marketing_content", "marketing"],
    ["ai-content.v3", "card_news", "sales"],
  ])("rejects non-active result contract %s/%s/%s", async (version, outputFormat, purpose) => {
    const requestJson = vi.fn(async () => ({
      ...generation("completed"),
      outputFormat: "card_news",
      purpose: "informational",
      outputs: [{
        id: "output-invalid",
        generationId: "generation-1",
        outputIndex: 1,
        title: "invalid",
        status: "completed",
        content: {},
        manifest: { version, outputFormat, purpose, title: "invalid", assets: [], content: {} },
        manifestUrl: null,
        failureCode: null,
        failureMessage: null,
        downloadedAt: null,
      }],
    }));

    await expect(createAiContentApiGateway(clientWith(requestJson)).getGeneration("brand-1", "generation-1"))
      .rejects.toThrow("ai_content_output_manifest_invalid");
  });

  it("propagates API failures instead of returning sample content", async () => {
    const requestJson = vi.fn(async () => { throw new Error("API request failed: 503"); });
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.listGenerations("brand-1")).rejects.toThrow("API request failed: 503");
  });

  it("maps channel API fields before evaluating OAuth publish availability", async () => {
    const requestJson = vi.fn(async () => [{
      channel: "instagram",
      enabled: true,
      oauthState: "connected",
      status: "connected",
      accountLabel: "@growthline352",
      lastHealthyAt: "2026-07-21T00:00:00.000Z",
      lastPublishedAt: null,
      lastError: null,
    }]);
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.listChannels("brand-1")).resolves.toEqual([
      expect.objectContaining({
        type: "instagram",
        label: "Instagram",
        enabled: true,
        oauthState: "connected",
        status: "connected",
        accountLabel: "@growthline352",
      }),
    ]);
  });

  it("keeps the requested type on each reference result", async () => {
    const requestJson = vi.fn(async () => [{
      id: "reference-1",
      source: "saved_trend",
      title: "저장한 콘텐츠",
      url: "https://example.com/reference",
      previewUrl: "https://example.com/preview.png",
      metrics: { views: 300 },
    }]);
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.listReferences("brand-1", "marketing")).resolves.toEqual([
      expect.objectContaining({ id: "reference-1", format: "marketing", source: "saved_trend" }),
    ]);
  });

  it("uses the API client's strict reference-seed parser", async () => {
    const requestJson = vi.fn();
    const listAiContentReferenceSeeds = vi.fn().mockResolvedValue([{
      id: "11111111-1111-4111-8111-111111111111",
      source: "brand_output",
      title: "인기 콘텐츠",
      url: null,
      previewUrl: null,
      format: "card_news",
      primaryCategory: "뷰티",
      metrics: { exposureCount: 10, likeCount: 2, commentsCount: 1 },
      checkedAt: null,
    }]);
    const gateway = createAiContentApiGateway({
      ...clientWith(requestJson),
      listAiContentReferenceSeeds,
    });

    await expect(gateway.listReferenceSeeds("brand-1", "card_news")).resolves.toHaveLength(1);
    expect(listAiContentReferenceSeeds).toHaveBeenCalledWith("brand-1", "card_news");
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("uses the legacy metadata confirm body for a legacy token", async () => {
    if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
    const requestJson = vi.fn()
      .mockResolvedValueOnce({ pathname: "brands/brand-1/generation-1/product.png", clientToken: "client-token" })
      .mockResolvedValueOnce({ id: "attachment-1" });
    const blobPut = vi.fn(async () => ({ url: "https://test.public.blob.vercel-storage.com/brands/brand-1/generation-1/product.png" }));
    const gateway = createAiContentApiGateway(clientWith(requestJson), blobPut as never);
    const attachment = localAttachment();

    await expect(gateway.uploadAttachment("brand-1", "generation-1", attachment))
      .resolves.toMatchObject({ id: "attachment-1", storagePath: "brands/brand-1/generation-1/product.png", uploadStatus: "confirmed" });

    expect(blobPut).toHaveBeenCalledWith(
      "brands/brand-1/generation-1/product.png",
      attachment.file,
      expect.objectContaining({ token: "client-token", contentType: "image/png" }),
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      2,
      "/brands/brand-1/ai-content/generations/generation-1/attachments/confirm",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"storagePath":"brands/brand-1/generation-1/product.png"'),
      }),
    );
  });

  it("uses only the session pair for a v2 confirm", async () => {
    if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
    const requestJson = vi.fn()
      .mockResolvedValueOnce({
        contractVersion: "ai-content-attachment-upload.v2",
        sessionId: "session-1",
        nonce: "nonce-1",
        pathname: "attempts/session-1/product.png",
        clientToken: "client-token",
      })
      .mockResolvedValueOnce({ id: "attachment-1", storageUrl: "https://blob.example/product.png", storagePath: "attempts/session-1/product.png" });
    const blobPut = vi.fn(async () => ({ url: "https://blob.example/product.png" }));
    const gateway = createAiContentApiGateway(clientWith(requestJson), blobPut as never);

    await gateway.uploadAttachment("brand-1", "generation-1", localAttachment());

    expect(JSON.parse(requestJson.mock.calls[1][1].body)).toEqual({ sessionId: "session-1", nonce: "nonce-1" });
  });

  it.each([
    new Error("connection reset"),
    new ApiRequestError({ status: 503, errorCode: "ai_content_attachment_storage_unavailable" }),
  ])("replays one ambiguous transport/5xx v2 confirm with the identical body without uploading twice", async (confirmError) => {
    if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
    const requestJson = vi.fn()
      .mockResolvedValueOnce({ sessionId: "session-1", nonce: "nonce-1", pathname: "attempts/session-1/product.png", clientToken: "client-token" })
      .mockRejectedValueOnce(confirmError)
      .mockResolvedValueOnce({ id: "attachment-1", storageUrl: "https://blob.example/product.png", storagePath: "attempts/session-1/product.png" });
    const blobPut = vi.fn(async () => ({ url: "https://blob.example/product.png" }));
    const gateway = createAiContentApiGateway(clientWith(requestJson), blobPut as never);

    await expect(gateway.uploadAttachment("brand-1", "generation-1", localAttachment())).resolves.toMatchObject({ id: "attachment-1" });

    expect(blobPut).toHaveBeenCalledTimes(1);
    expect(requestJson).toHaveBeenCalledTimes(3);
    expect(requestJson.mock.calls[1][1].body).toBe(requestJson.mock.calls[2][1].body);
  });

  it("does not retry an explicit 4xx confirm", async () => {
    if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
    const rejection = new ApiRequestError({ status: 409, errorCode: "ai_content_upload_confirmation_conflict" });
    const requestJson = vi.fn()
      .mockResolvedValueOnce({ sessionId: "session-1", nonce: "nonce-1", pathname: "attempts/session-1/product.png", clientToken: "client-token" })
      .mockRejectedValueOnce(rejection);
    const blobPut = vi.fn(async () => ({ url: "https://blob.example/product.png" }));
    const gateway = createAiContentApiGateway(clientWith(requestJson), blobPut as never);

    await expect(gateway.uploadAttachment("brand-1", "generation-1", localAttachment())).rejects.toBe(rejection);

    expect(blobPut).toHaveBeenCalledTimes(1);
    expect(requestJson).toHaveBeenCalledTimes(2);
  });

  it.each([409, 422])("does not retry an explicit %i confirm even when delivery status is unknown", async (status) => {
    if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
    const rejection = new ApiRequestError({
      status,
      errorCode: "ai_content_upload_confirmation_conflict",
      deliveryStatus: "unknown",
    });
    const requestJson = vi.fn()
      .mockResolvedValueOnce({ sessionId: "session-1", nonce: "nonce-1", pathname: "attempts/session-1/product.png", clientToken: "client-token" })
      .mockRejectedValueOnce(rejection);
    const blobPut = vi.fn(async () => ({ url: "https://blob.example/product.png" }));
    const gateway = createAiContentApiGateway(clientWith(requestJson), blobPut as never);

    await expect(gateway.uploadAttachment("brand-1", "generation-1", localAttachment())).rejects.toBe(rejection);

    expect(blobPut).toHaveBeenCalledTimes(1);
    expect(requestJson).toHaveBeenCalledTimes(2);
  });

  it("best-effort cancels a v2 session after a definite Blob put failure and preserves the original error", async () => {
    if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
    const storageError = new Error("blob put failed");
    const requestJson = vi.fn()
      .mockResolvedValueOnce({ sessionId: "session-1", nonce: "nonce-1", pathname: "attempts/session-1/product.png", clientToken: "client-token" })
      .mockRejectedValueOnce(new Error("cancel failed"));
    const blobPut = vi.fn(async () => { throw storageError; });
    const gateway = createAiContentApiGateway(clientWith(requestJson), blobPut as never);

    await expect(gateway.uploadAttachment("brand-1", "generation-1", localAttachment())).rejects.toBe(storageError);

    expect(requestJson).toHaveBeenNthCalledWith(
      2,
      "/brands/brand-1/ai-content/generations/generation-1/attachments/cancel",
      { method: "POST", body: JSON.stringify({ sessionId: "session-1", nonce: "nonce-1" }) },
    );
  });

  it("removes a confirmed attachment through the generation-scoped endpoint", async () => {
    const requestJson = vi.fn(async () => ({ id: "attachment-1" }));
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.removeAttachment("brand-1", "generation-1", "attachment-1")).resolves.toBeUndefined();

    expect(requestJson).toHaveBeenCalledWith(
      "/brands/brand-1/ai-content/generations/generation-1/attachments/attachment-1",
      { method: "DELETE" },
    );
  });

  it("requests the generation-scoped v2 subject pipeline contract", async () => {
    const requestJson = vi.fn(async () => ({
      id: "analysis-1",
      generationId: "generation-1",
      contractVersion: "subject-analysis.v2",
      status: "extracting",
      analysisVersion: 1,
      targets: [],
      appealsByTarget: {},
      sourceGaps: [],
    }));
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    const result = await gateway.requestSubjectAnalysis("brand-1", {
      generationId: "generation-1",
      subjectType: "service",
      sourceUrl: null,
      attachmentIds: ["attachment-1"],
      manualInput: { name: "운영 대행", promotionOrTerms: "월 단위", description: "채널 운영" },
      idempotencyKey: "subject-v2-1",
    } as never);

    expect(result).toMatchObject({ id: "analysis-1", generationId: "generation-1", status: "extracting" });
    expect(requestJson).toHaveBeenCalledWith(
      "/brands/brand-1/ai-content/subject-analyses",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          contractVersion: "subject-analysis.v2",
          generationId: "generation-1",
          subjectType: "service",
          sourceUrl: null,
          attachmentIds: ["attachment-1"],
          manualInput: { name: "운영 대행", promotionOrTerms: "월 단위", description: "채널 운영" },
          idempotencyKey: "subject-v2-1",
        }),
      }),
    );
  });

  it("rejects legacy-shaped subject requests before calling the API", async () => {
    const requestJson = vi.fn();
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.requestSubjectAnalysis("brand-1", {
      subjectType: "product",
      sourceUrl: "https://example.com/product",
      manualInput: { name: "제품", promotion: "할인", description: "설명" },
      idempotencyKey: "legacy-request",
    } as never)).rejects.toThrow("subject_analysis_v2_input_required");
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("requests appeal regeneration with an idempotency key", async () => {
    const requestJson = vi.fn(async () => ({
      id: "analysis-1",
      status: "generating_appeals",
      analysisVersion: 1,
      targets: [],
      appealsByTarget: {},
    }));
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await gateway.regenerateSubjectAppeals("brand-1", "analysis-1", "appeal-regeneration-1");

    expect(requestJson).toHaveBeenCalledWith(
      "/brands/brand-1/ai-content/subject-analyses/analysis-1/appeals/regenerate",
      { method: "POST", body: JSON.stringify({ idempotencyKey: "appeal-regeneration-1" }) },
    );
  });

  it("calls the subject analysis cache, request, polling, reanalysis, and image selection APIs", async () => {
    const analysis = {
      id: "analysis-1", workspaceId: "workspace-1", brandId: "brand-1", subjectType: "product", sourceUrl: "https://example.com/product", normalizedUrl: "https://example.com/product",
      input: { name: "제품", promotion: "", description: "" }, status: "ready", facts: [], structuredData: {}, research: {},
      targets: [{ id: "target-1" }, { id: "target-2" }, { id: "target-3" }], appealsByTarget: {}, selectedImageId: "image-1", images: [], analysisVersion: 1,
      errorCode: null, errorMessage: null, createdAt: "2026-07-20T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z", completedAt: "2026-07-20T00:00:00.000Z",
    };
    const requestJson = vi.fn().mockResolvedValue(analysis);
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await gateway.getCachedSubjectAnalysis("brand-1", "product", "https://example.com/product");
    await gateway.requestSubjectAnalysis("brand-1", { generationId: "generation-1", subjectType: "product", sourceUrl: "https://example.com/product", attachmentIds: [], manualInput: { name: "제품", promotionOrTerms: "", description: "" }, idempotencyKey: "request-1" });
    await gateway.getSubjectAnalysis("brand-1", "analysis-1");
    await gateway.reanalyzeSubject("brand-1", "analysis-1", "reanalyze-1");
    await gateway.selectSubjectImage("brand-1", "analysis-1", "image-1");

    expect(requestJson).toHaveBeenNthCalledWith(1, expect.stringContaining("subject-analyses/cache?"), expect.objectContaining({ method: "GET" }));
    expect(requestJson).toHaveBeenNthCalledWith(2, "/brands/brand-1/ai-content/subject-analyses", expect.objectContaining({ method: "POST", body: expect.stringContaining('"idempotencyKey":"request-1"') }));
    expect(requestJson).toHaveBeenNthCalledWith(4, "/brands/brand-1/ai-content/subject-analyses/analysis-1/reanalyze", expect.objectContaining({ method: "POST" }));
    expect(requestJson).toHaveBeenNthCalledWith(5, "/brands/brand-1/ai-content/subject-analyses/analysis-1/selection", expect.objectContaining({ method: "PATCH" }));
  });

  it("serializes the V2 finalization draft and start body without sealed inputs", async () => {
    const requestJson = vi.fn().mockResolvedValue(generation("draft"));
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await gateway.updateFinalizationDraft!("brand-1", "generation-1", {
      contractVersion: "content-finalization-draft.v2",
      avatarStyleImageId: "11111111-1111-4111-8111-111111111111",
      userImageInstruction: "밝고 정돈된 편집 디자인",
      attachmentIds: ["22222222-2222-4222-8222-222222222222"],
    });
    await gateway.startGenerationV2!("brand-1", "generation-1", "final-key");

    const draftBody = JSON.parse(requestJson.mock.calls[0]![1].body as string);
    const startBody = JSON.parse(requestJson.mock.calls[1]![1].body as string);
    expect(draftBody).toEqual({
      contractVersion: "content-finalization-draft.v2",
      avatarStyleImageId: "11111111-1111-4111-8111-111111111111",
      userImageInstruction: "밝고 정돈된 편집 디자인",
      attachmentIds: ["22222222-2222-4222-8222-222222222222"],
    });
    expect(startBody).toEqual({
      idempotencyKey: "final-key",
      contractVersion: "content-generation-start.v2",
    });
    expect(JSON.stringify(startBody)).not.toMatch(/outputCount|wiki|faq|logo|avatarSnapshot|referenceIds|product|proposal/i);
  });

  it("reads and updates the closed manual visual selection sidecar", async () => {
    const selection = {
      contractVersion: "manual-visual-selection.v2" as const,
      product: null,
      preset: { presetId: "preset-1", revision: 3 },
    };
    const requestJson = vi.fn().mockResolvedValue(selection);
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.getManualVisualSelection!("brand-1", "generation-1")).resolves.toEqual(selection);
    await expect(gateway.updateManualVisualSelection!("brand-1", "generation-1", selection)).resolves.toEqual(selection);

    expect(requestJson).toHaveBeenNthCalledWith(1, "/brands/brand-1/ai-content/generations/generation-1/visual-selection", { method: "GET" });
    expect(requestJson).toHaveBeenNthCalledWith(2, "/brands/brand-1/ai-content/generations/generation-1/visual-selection", {
      method: "PUT", body: JSON.stringify(selection),
    });
  });

  it("marks V3 image attachment token requests with the exact finalization role", async () => {
    if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
    const requestJson = vi.fn()
      .mockResolvedValueOnce({ pathname: "owned/supporting.webp", clientToken: "client-token" })
      .mockResolvedValueOnce({ id: "attachment-1", storageUrl: "https://blob.example/supporting.webp", storagePath: "owned/supporting.webp" });
    const blobPut = vi.fn(async () => ({ url: "https://blob.example/supporting.webp" }));
    const gateway = createAiContentApiGateway(clientWith(requestJson), blobPut as never);
    const file = new File(["image"], "supporting.webp", { type: "image/webp" });

    await gateway.uploadAttachment("brand-1", "generation-1", {
      id: "local-supporting",
      role: "supporting_image",
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      file,
      uploadStatus: "pending",
    } as never);

    expect(JSON.parse(requestJson.mock.calls[0]![1].body as string)).toEqual({
      contractVersion: "ai-content-attachment-upload.v3",
      role: "supporting_image",
      fileName: "supporting.webp",
      mimeType: "image/webp",
      sizeBytes: file.size,
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("rejects a malformed V2 proposal batch response instead of rendering partial cards", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      id: "batch-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      origin: "manual",
      contentFamily: "informational",
      request: {
        contractVersion: "content-orchestration.v2",
        brandId: "brand-1",
        purpose: "informational",
        seed: { kind: "topic_text", title: "피부 장벽" },
        contentInstruction: null,
        productId: null,
        outputSettings: {
          outputFormat: "card_news",
          channelTargets: ["instagram"],
          aspectRatio: "1:1",
          outputCount: 1,
        },
      },
      sourceSnapshots: [],
      status: "ready",
      proposals: [{ id: "proposal-1", proposal: { title: "불완전한 안" } }],
      researchEvidence: { items: [] },
      selectedReferences: [],
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.getProposalBatch("brand-1", "batch-1"))
      .rejects.toThrow("ai_content_proposal_batch_response_invalid");
  });

  it("rejects a retired proposal contract on a manual batch instead of entering the automated-card fallback", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      id: "batch-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      origin: "manual",
      contentFamily: "informational",
      request: { contractVersion: "content-proposal-request.v1" },
      sourceSnapshots: [],
      status: "queued",
      proposals: [],
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.getProposalBatch("brand-1", "batch-1"))
      .rejects.toThrow("ai_content_proposal_batch_response_invalid");
  });

  it("rejects an unknown V2 proposal channel target before casting the tuple", async () => {
    const proposal = {
      conceptKey: "concept-a",
      title: "피부 장벽 가이드",
      informationalType: "how_to",
      oneLineIntent: "관리 순서를 안내합니다.",
      differentiator: "상황별 순서로 설명합니다.",
      differentiationAxes: ["situation"],
      target: "민감 피부 고객",
      customerContext: "관리법을 찾는 상황",
      keyMessage: "세 단계로 관리하세요.",
      hook: "첫 단계부터 바꿔보세요.",
      selectionReason: "바로 실천할 수 있습니다.",
      evidenceIds: [],
      referenceIds: [],
      outputFormat: "card_news",
      channelTargets: ["email"],
      assetCount: 1,
      outline: [{ index: 1, role: "guide", headline: "관리 순서", purpose: "실행 안내" }],
      purposeDetails: {
        kind: "informational",
        question: "무엇부터 관리해야 하나요?",
        value: "실천 순서",
        whyNow: "계절이 바뀌는 시기",
        learningPoints: ["순한 세안"],
      },
    };
    const requestJson = vi.fn().mockResolvedValue({
      id: "batch-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      origin: "manual",
      contentFamily: "informational",
      request: {
        contractVersion: "content-orchestration.v2",
        brandId: "brand-1",
        purpose: "informational",
        seed: { kind: "topic_text", title: "피부 장벽" },
        contentInstruction: null,
        productId: null,
        outputSettings: {
          outputFormat: "card_news",
          channelTargets: ["instagram"],
          aspectRatio: "1:1",
          outputCount: 1,
        },
      },
      sourceSnapshots: [],
      status: "building",
      proposals: [{
        id: "proposal-1",
        batchId: "batch-1",
        proposal,
        status: "suggested",
        generationId: null,
        createdAt: "2026-08-01T00:00:00.000Z",
      }],
      researchEvidence: { items: [] },
      selectedReferences: [],
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await expect(gateway.getProposalBatch("brand-1", "batch-1"))
      .rejects.toThrow("ai_content_proposal_batch_response_invalid");
  });
});
