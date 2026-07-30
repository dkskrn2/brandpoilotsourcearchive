import { describe, expect, it, vi } from "vitest";
import { buildContentGenerationInput, parseContentGenerationInputV2 } from "./aiContentGenerationInput.js";
import type { SubjectAnalysisRecord } from "./aiContentSubjectRepository.js";

const analysis: SubjectAnalysisRecord = {
  id: "analysis-1", workspaceId: "workspace-1", brandId: "brand-1", subjectType: "product" as const,
  contractVersion: "subject-analysis.v2",
  sourceUrl: "https://example.com/product", normalizedUrl: "https://example.com/product",
  input: { name: "상품", promotion: "", description: "상품 설명" }, status: "ready" as const,
  facts: [{ key: "name", value: "상품", sourceUrl: "https://example.com/product" }], structuredData: {}, research: { voc: [] },
  analysisResult: {
    contractVersion: "subject-analysis-result.v2", phase: "analysis", subjectType: "product", summary: "상품 분석",
    verifiedFacts: [], voc: [], alternatives: [], barriers: [], serviceProfile: null, serviceSubtype: null, sourceGaps: [],
    productProfile: { name: "상품", category: "생활", specifications: [], materials: [], options: [], price: "", discountsAndPromotions: [], shipping: [], returns: [], functions: [], useContexts: [], purchaseBarriers: [], reviewPatterns: { recurringSatisfaction: [], recurringComplaints: [] }, productImageCandidates: [], detailImageCandidates: [] },
  },
  targets: [{ id: "target-1", name: "실용적인 고객", traits: ["바쁜 사람"], painPoints: ["시간 부족"], purchaseMotivations: ["간편함"], uspEvidence: [] }, { id: "target-2", name: "비교 고객", traits: [], painPoints: [], purchaseMotivations: [], uspEvidence: [] }, { id: "target-3", name: "관심 고객", traits: [], painPoints: [], purchaseMotivations: [], uspEvidence: [] }],
  appealsByTarget: { "target-1": [{ id: "appeal-1", targetId: "target-1", title: "빠른 시작", description: "쉽게 시작", evidenceType: "product_fact" as const, connectionReason: "상품 근거", sources: [] }] },
  selectedImageId: "image-1", images: [{ id: "image-1", analysisId: "analysis-1", sourceUrl: "https://example.com/product.png", storageUrl: "https://blob.example/product.png", storagePath: "subjects/1.png", width: 1024, height: 1024, mimeType: "image/png", altText: "상품", role: "product" as const, selectionScore: 1, createdAt: "2026-07-20T00:00:00.000Z" }],
  analysisVersion: 2, idempotencyKey: "analysis-key", leasedBy: null, leaseToken: null, leaseExpiresAt: null, attemptCount: 1, availableAt: "2026-07-20T00:00:00.000Z", errorCode: null, errorMessage: null, supersededAt: null, createdAt: "2026-07-20T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z", completedAt: "2026-07-20T00:00:00.000Z",
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    getBrandContext: vi.fn(async () => ({ ready: true, brandName: "Growthline", ownedUrl: "https://example.com", sourceStatus: "crawled", lastCrawledAt: null, wikiVersionId: "wiki-1", wikiUpdatedAt: null, summary: "브랜드", pageCount: 1, context: { brand: { name: "Growthline", brandColor: "#0057B8" } } })),
    getSubjectAnalysis: vi.fn(async () => analysis),
    getReferences: vi.fn(async ({ referenceIds }: { referenceIds: string[] }) => referenceIds.map((id) => ({ id, source: "saved_trend" as const, title: id, url: `https://instagram.com/${id}`, previewUrl: null, metrics: {}, checkedAt: null }))),
    getAttachments: vi.fn(async () => [{ id: "attachment-1", generationId: "generation-1", role: "visual_reference" as const, fileName: "ref.png", mimeType: "image/png", sizeBytes: 10, checksum: "a", storageUrl: "https://blob.example/ref.png", storagePath: "generation/ref.png", createdAt: "2026-07-20T00:00:00.000Z" }]),
    ...overrides,
  };
}

function generation(draft: Record<string, unknown> = {}) {
  return { id: "generation-1", workspaceId: "workspace-1", brandId: "brand-1", type: "card_news" as const, draft: {
    subjectAnalysisId: "analysis-1", selectedSubjectImageIds: ["image-1"], selectedTarget: analysis.targets[0], selectedAppeal: analysis.appealsByTarget["target-1"][0], referenceIds: ["ref-2", "ref-1"],
    brief: { selectedColor: "#0F766E", aspectRatio: "1:1", outputCount: 2, outputDirections: ["정보를 쉽게 전달"] }, ...draft,
  } };
}

describe("content-generation-input.v2", () => {
  it("freezes one target, one connected appeal, selected images, references, and edited color", async () => {
    const envelope = await buildContentGenerationInput(deps(), generation(), { outputCount: 2 });
    expect(envelope.contractVersion).toBe("content-generation-input.v2");
    expect(envelope.message.target.id).toBe("target-1");
    expect(envelope.message.appeal.targetId).toBe("target-1");
    expect(envelope.creativeDirection.selectedColor).toBe("#0F766E");
    expect(envelope.references.map((item) => item.id)).toEqual(["ref-2", "ref-1"]);
    expect(envelope.subject.selectedImages.map((item) => item.id)).toEqual(["image-1"]);
    expect(envelope.subject.analysisContractVersion).toBe("subject-analysis.v2");
    expect(envelope.subject.analysisResult).toEqual(analysis.analysisResult);
    expect(envelope.attachments[0].role).toBe("visual_reference");
    expect(envelope.creativeDirection.prompts).toHaveLength(2);
    expect(envelope.creativeDirection.prompts[0]).toContain("정보를 쉽게 전달");
    expect(envelope.creativeDirection.prompts[1]).toContain("결과 2");
  });

  it("freezes a user-added appeal override instead of requiring the original appeal list", async () => {
    const customAppeal = {
      ...analysis.appealsByTarget["target-1"][0],
      id: "appeal-custom",
      title: "직접 수정한 소구점",
      description: "사용자가 확정한 설명",
    };
    const envelope = await buildContentGenerationInput(deps(), generation({
      selectedAppeal: customAppeal,
      appealOverridesByTarget: { "target-1": [customAppeal] },
    }));

    expect(envelope.message.appeal).toEqual(customAppeal);
  });

  it("allows a manually added target when its manually added appeal is present in overrides", async () => {
    const customTarget = { id: "custom-target-1", name: "직접 입력 타깃", traits: ["직접 입력"], painPoints: ["수동 업무"], purchaseMotivations: ["시간 절약"], uspEvidence: [] };
    const customAppeal = { ...analysis.appealsByTarget["target-1"][0], id: "custom-appeal-1", targetId: customTarget.id, title: "직접 입력 소구점" };
    const envelope = await buildContentGenerationInput(deps(), generation({
      selectedTarget: customTarget,
      selectedAppeal: customAppeal,
      appealOverridesByTarget: { [customTarget.id]: [customAppeal] },
    }));

    expect(envelope.message).toMatchObject({ target: customTarget, appeal: customAppeal });
  });

  it("keeps legacy v1 subject records compatible without a v2 analysis result", async () => {
    const legacy = { ...analysis, contractVersion: "subject-analysis.v1" as const, analysisResult: null };
    const envelope = await buildContentGenerationInput(
      deps({ getSubjectAnalysis: vi.fn(async () => legacy) }),
      generation(),
    );

    expect(envelope.subject.analysisContractVersion).toBe("subject-analysis.v1");
    expect(envelope.subject.analysisResult).toBeNull();
  });

  it("builds a v2 snapshot from attachments and manual input when no source URL was supplied", async () => {
    const attachmentOnly = { ...analysis, sourceUrl: "", normalizedUrl: "" };
    const envelope = await buildContentGenerationInput(
      deps({ getSubjectAnalysis: vi.fn(async () => attachmentOnly) }),
      generation(),
    );

    expect(envelope.subject.sourceUrl).toBe("");
    expect(envelope.attachments).toHaveLength(1);
  });

  it("merges global brief fields into each output prompt", async () => {
    const envelope = await buildContentGenerationInput(deps(), generation({
      brief: {
        purpose: "information",
        emphasis: "휴대성",
        cta: "제품 확인",
        additionalInstruction: "가격을 만들지 마세요",
        selectedColor: "#0F766E",
        aspectRatio: "1:1",
        outputCount: 1,
        outputDirections: ["공감형 질문으로 시작"],
      },
    }), { outputCount: 1 });

    expect(envelope.creativeDirection.prompts).toEqual([
      "공감형 질문으로 시작\npurpose: information\nemphasis: 휴대성\ncta: 제품 확인\nadditionalInstruction: 가격을 만들지 마세요",
    ]);
  });

  it("allows partial analysis but rejects non-terminal analysis", async () => {
    const partial = { ...analysis, status: "partial" as const };
    await expect(buildContentGenerationInput(deps({ getSubjectAnalysis: vi.fn(async () => partial) }), generation())).resolves.toMatchObject({ subject: { analysisVersion: 2 } });
    await expect(buildContentGenerationInput(deps({ getSubjectAnalysis: vi.fn(async () => ({ ...analysis, status: "researching" as const })) }), generation())).rejects.toThrow("ai_content_subject_analysis_not_ready");
  });

  it("requires a product image and a connected appeal before usage can be touched", async () => {
    await expect(buildContentGenerationInput(deps({ getAttachments: vi.fn(async () => []), getSubjectAnalysis: vi.fn(async () => ({ ...analysis, selectedImageId: null, images: [] })) }), generation({ selectedSubjectImageIds: [] }))).rejects.toThrow("ai_content_subject_image_required");
    await expect(buildContentGenerationInput(deps(), generation({ selectedAppeal: { ...analysis.appealsByTarget["target-1"][0], targetId: "target-2" } }))).rejects.toThrow("ai_content_appeal_target_mismatch");
  });

  it("reuses and validates an immutable snapshot without consulting newer analysis", async () => {
    const first = await buildContentGenerationInput(deps(), generation(), { outputCount: 1 });
    const newer = { ...analysis, analysisVersion: 99, status: "failed" as const };
    const snapshot = await buildContentGenerationInput(deps({ getSubjectAnalysis: vi.fn(async () => newer) }), generation({ subjectAnalysisId: "analysis-2" }), { existingSnapshot: first });
    expect(snapshot.subject.analysisVersion).toBe(2);
    expect(parseContentGenerationInputV2(snapshot).creativeDirection.outputCount).toBe(1);
  });

  it("removes analysis-only raw page text from new and reused worker input", async () => {
    const withRawPageText = {
      ...analysis,
      facts: [
        ...analysis.facts,
        { key: "visible_text", value: "페이지 원문 전체", sourceUrl: analysis.sourceUrl },
      ],
    };
    const envelope = await buildContentGenerationInput(deps({ getSubjectAnalysis: vi.fn(async () => withRawPageText) }), generation(), { outputCount: 1 });
    expect(envelope.subject.facts).toEqual(analysis.facts);

    const reparsed = parseContentGenerationInputV2({
      ...envelope,
      subject: { ...envelope.subject, facts: withRawPageText.facts },
    });
    expect(reparsed.subject.facts).toEqual(analysis.facts);
  });

  it("rejects a snapshot with a mismatched target and appeal", () => {
    expect(() => parseContentGenerationInputV2({ contractVersion: "content-generation-input.v2", contentType: "card_news", subject: { analysisId: "a", analysisVersion: 1, type: "product", sourceUrl: "https://example.com", facts: [], research: {}, selectedImages: [] }, message: { target: { id: "target-1", name: "타깃" }, appeal: { id: "appeal-1", targetId: "target-2", title: "소구점" }, qualityBrief: {} }, creativeDirection: { prompts: [], brandColor: "#0057B8", selectedColor: "#0057B8", aspectRatio: "1:1", outputCount: 1 }, brandContext: {}, references: [], attachments: [] })).toThrow("ai_content_appeal_target_mismatch");
  });
});
