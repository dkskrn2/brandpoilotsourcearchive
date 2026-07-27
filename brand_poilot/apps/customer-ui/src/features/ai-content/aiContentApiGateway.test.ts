import { webcrypto } from "node:crypto";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { apiClient } from "../../lib/apiClient";
import { ApiRequestError } from "../../lib/apiClient";
import { createAiContentApiGateway } from "./aiContentApiGateway";
import type { AiContentDraft, GenerationAttachment, SubjectAnalysisInput } from "./types";

const draft: AiContentDraft = {
  type: "card_news",
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
    type: "card_news",
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

  it("creates analysis with the stable idempotency key", async () => {
    const requestJson = vi.fn(async (..._args: unknown[]) => generation());
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    await gateway.createAnalysis("brand-1", {
      type: "card_news",
      title: "여름 추천",
      draft,
      idempotencyKey: "analysis-1",
    });

    expect(requestJson).toHaveBeenCalledWith(
      "/brands/brand-1/ai-content/generations",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"idempotencyKey":"analysis-1"'),
      }),
    );
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

  it("serializes only confirmed server attachments and strips local lifecycle fields", async () => {
    const requestJson = vi.fn(async (..._args: [string, { body?: string }]) => generation());
    const gateway = createAiContentApiGateway(clientWith(requestJson));
    const confirmed = {
      ...localAttachment(),
      id: "attachment-1",
      file: undefined,
      storageUrl: "https://blob.example/product.png",
      storagePath: "confirmed/product.png",
      uploadStatus: "confirmed" as const,
      sessionId: "must-not-leak",
      nonce: "must-not-leak",
    };
    const failed = { ...localAttachment(), id: "failed-1", uploadStatus: "failed" as const };
    const pending = localAttachment();
    const localDraft = {
      ...draft,
      subjectAttachments: [confirmed, failed, pending],
      brief: { ...draft.brief!, attachments: [failed, confirmed] },
    };

    await gateway.createAnalysis("brand-1", {
      type: "card_news",
      title: "직렬화",
      draft: localDraft,
      idempotencyKey: "serialize-1",
    });

    const requestBody = requestJson.mock.calls[0]?.[1].body ?? "";
    const body = JSON.parse(requestBody);
    expect(body.draft.subjectAttachments).toEqual([{
      id: "attachment-1",
      role: "product",
      fileName: "product.png",
      mimeType: "image/png",
      size: 5,
      storageUrl: "https://blob.example/product.png",
      storagePath: "confirmed/product.png",
    }]);
    expect(body.draft.brief.attachments).toEqual(body.draft.subjectAttachments);
    expect(requestBody).not.toContain("must-not-leak");
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

  it("normalizes legacy drafts and omits secondary appeals from new writes", async () => {
    const requestJson = vi.fn()
      .mockResolvedValueOnce({
        id: "generation-legacy", brandId: "brand-1", type: "card_news", title: "레거시", status: "draft", currentStage: null,
        draft: { type: "card_news", productUrl: "https://example.com/legacy", coreAppeal: { id: "appeal-1", title: "핵심", description: "설명", evidenceType: "benefit" }, secondaryAppeals: [{ id: "appeal-2" }], referenceIds: [], brief: null },
        analysis: {}, outputs: [], createdAt: "2026-07-20T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z",
      })
      .mockResolvedValueOnce(generation("draft"));
    const gateway = createAiContentApiGateway(clientWith(requestJson));

    const normalized = await gateway.getGeneration("brand-1", "generation-legacy");
    expect(normalized.draft.subjectInput.sourceUrl).toBe("https://example.com/legacy");
    expect(normalized.draft.selectedAppeal?.id).toBe("appeal-1");
    expect(normalized.draft.appealOverridesByTarget).toEqual({});
    await gateway.updateGeneration("brand-1", "generation-1", { draft: { ...draft, secondaryAppeals: [{ id: "ignored" } as never] }, referenceIds: [] });
    const body = JSON.parse(requestJson.mock.calls[1][1].body as string);
    expect(body.draft.secondaryAppeals).toBeUndefined();
    expect(body.draft.subjectAnalysisId).toBe("analysis-1");
    expect(body.draft.appealOverridesByTarget).toEqual({});
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
});
