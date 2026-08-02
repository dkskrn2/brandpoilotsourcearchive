import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { AiContentJob, WorkerClient } from "./contracts.js";
import { runOnce } from "./worker.js";

function job(jobType: "analyze" | "generate"): AiContentJob {
  const payload = jobType === "generate" ? { contentGenerationInput: {
    contractVersion: "content-generation-input.v2",
    contentType: "card_news",
    subject: { analysisId: "analysis-1", analysisVersion: 2, analysisContractVersion: "subject-analysis.v2", analysisResult: { subjectType: "product", productProfile: {}, serviceProfile: null }, type: "product", sourceUrl: "https://example.com/product", facts: [{ claim: "검증된 사실" }], research: {}, selectedImages: [] },
    message: { target: { id: "target-1", name: "고객" }, appeal: { id: "appeal-1", targetId: "target-1", title: "장점" }, qualityBrief: {} },
    creativeDirection: { prompts: ["4:5 카드뉴스"], brandColor: "#0057B8", selectedColor: "#0057B8", aspectRatio: "4:5", outputCount: 1 },
    brandContext: {}, references: [], attachments: [],
  } } : {};
  return { id: "job-1", generationId: "generation-1", outputId: jobType === "generate" ? "output-1" : null, workspaceId: "w", brandId: "brand-1", jobType, contentType: "card_news", status: "processing", payload, leaseToken: "lease-1" };
}
function client(item: AiContentJob) { return { claim: vi.fn(async () => item), heartbeat: vi.fn(), complete: vi.fn(), fail: vi.fn(), acquire: vi.fn(async () => ({ id: "resource-1", leaseToken: "resource-token" })), heartbeatResource: vi.fn(), releaseResource: vi.fn() } as unknown as WorkerClient; }

const uid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const capturedAt = "2026-07-31T00:00:00.000Z";

function v3Input(purpose: "informational" | "marketing") {
  const marketing = purpose === "marketing";
  const reference = { referenceItemId: uid(5), snapshotId: uid(6), roles: ["visual_composition"], title: "Editorial reference", sourceUrl: "https://reference.example/editorial", capturedAt, contentHash: "b".repeat(64), text: "Calm hierarchy", image: null };
  const style = { referenceItemId: uid(5), description: "Uploaded editorial style", tags: ["calm"], storageUrl: "https://cdn.example/style.webp", storagePath: "owned/style.webp", mimeType: "image/webp", checksum: "a".repeat(64) };
  const attachment = { id: uid(8), role: "supporting_image", fileName: "tea.webp", mimeType: "image/webp", sizeBytes: 100, checksum: "d".repeat(64), storageUrl: "https://cdn.example/attachment.webp", storagePath: "owned/attachment.webp" };
  const product = marketing ? { id: uid(2), versionId: uid(3), kind: "product", name: "Tea", description: "Green tea", features: ["Fresh leaves"], benefits: ["Calm focus"], cautions: ["Contains caffeine"], evergreenPurchaseInfo: "Available online", images: [{ assetId: uid(4), role: "hero", storageUrl: "https://cdn.example/product.webp", storagePath: "owned/product.webp", mimeType: "image/webp", checksum: "e".repeat(64) }] } : null;
  return {
    contractVersion: "content-generation-input.v3", generationId: uid(10), capturedAt,
    brandCore: { versionId: uid(1), companyOverview: "Company", businessDescription: "Business", primaryCategory: "Food", detailedCategory: "Tea", primaryTarget: "Adults", differentiator: "Fresh", coreAppeal: "Calm" },
    subject: { kind: "topic_text", title: "Tea guide" }, contentInstruction: "Practical copy", product,
    researchEvidence: marketing
      ? { contractVersion: "research-evidence.v1", decision: "not_needed", reason: "Product facts suffice", queries: [], capturedAt, items: [] }
      : { contractVersion: "research-evidence.v1", decision: "searched", reason: "Current source", queries: ["tea"], capturedAt, items: [{ id: uid(7), title: "Study", url: "https://evidence.example/study", publisher: null, publishedAt: null, capturedAt, claimSummary: "Use warm water", contentHash: "c".repeat(64) }] },
    references: { selected: [reference], brandStyleImages: [style], avatarStyleImageId: uid(5), attachments: [attachment] },
    selectedProposal: {
      id: uid(9), conceptKey: "tea-guide", title: "Tea guide", informationalType: marketing ? null : "how_to", oneLineIntent: "Explain tea", differentiator: "Simple", differentiationAxes: ["question"], target: "Adults", customerContext: "Choosing tea", keyMessage: "Brew well", hook: "Better tea", selectionReason: "Useful", evidenceIds: marketing ? [] : [uid(7)], referenceIds: [uid(5)], outputFormat: "card_news", channelTargets: ["instagram"], assetCount: 2,
      outline: [{ index: 1, role: "hook", headline: "Start", purpose: "Open" }, { index: 2, role: "guide", headline: "Steps", purpose: "Explain" }],
      purposeDetails: marketing
        ? { kind: "marketing", campaignObjective: "Sales", situationAndNeed: "Afternoon focus", productId: uid(2), targetSegment: "Office workers", strengths: ["Fresh leaves"], limitations: ["Contains caffeine"], appeal: "Calm focus", buyingBarriers: ["Price"], cta: "Buy now" }
        : { kind: "informational", question: "How?", value: "Guidance", whyNow: "Better habits", learningPoints: ["Temperature"] },
    },
    userImageInstruction: "Soft light",
    outputSettings: { purpose, outputFormat: "card_news", channelTargets: ["instagram"], aspectRatio: "4:5", outputCount: 1 },
  };
}

function v3Plan(input: ReturnType<typeof v3Input>) {
  return {
    contractVersion: "card-news-plan.v2",
    content: { caption: "Tea guide", hashtags: ["tea"], cta: "Save this" },
    imagePackage: {
      contractVersion: "image-generation-package.v1", generationId: input.generationId,
      outputFormat: "card_news", purpose: input.outputSettings.purpose, assetCount: 2, aspectRatio: "4:5",
      channelTargets: ["instagram"],
      assets: [
        { index: 1, role: "hook", copy: "Start with a clear reason and useful context.", visualDirection: "Readable opening card.", evidenceIds: [], productImageAssetIds: [], attachmentIds: [] },
        { index: 2, role: "guide", copy: "Use the fixed facts to explain a practical next step.", visualDirection: "Mobile-friendly two-step guide.", evidenceIds: input.product ? [] : [uid(7)], productImageAssetIds: input.product ? [uid(4)] : [], attachmentIds: [uid(8)] },
      ],
      product: input.product, references: input.references.selected, brandStyleImages: input.references.brandStyleImages,
      avatarStyleImageId: input.references.avatarStyleImageId, attachments: input.references.attachments,
      userImageInstruction: input.userImageInstruction,
      logoPolicy: { allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true },
    },
  };
}

function v3Job(purpose: "informational" | "marketing") {
  return {
    id: `job-v3-${purpose}`, generationId: uid(10), outputId: `output-v3-${purpose}`, workspaceId: "w", brandId: "brand-1",
    jobType: "generate", contentType: "card_news", status: "processing",
    payload: { contentGenerationInput: v3Input(purpose) }, leaseToken: "lease-v3",
  } as AiContentJob;
}

describe("card-news worker", () => {
  it("completes an analysis and releases the resource", async () => {
    const api = client(job("analyze"));
    const dir = await mkdtemp(path.join(os.tmpdir(), "card-analysis-"));
    await writeFile(path.join(dir, "analysis.json"), JSON.stringify({ audience: "초보 대표" }));
    await runOnce({ workerId: "worker-1", client: api, planner: { run: vi.fn() }, runner: { run: vi.fn(async () => ({ outputDir: dir, cleanup: vi.fn() })) }, storage: { upload: vi.fn() } });
    expect(api.complete).toHaveBeenCalledWith("job-1", expect.objectContaining({ jobType: "analyze" }));
    expect(api.releaseResource).toHaveBeenCalledOnce();
  });

  it("uploads and completes generated slides", async () => {
    const api = client(job("generate"));
    const dir = await mkdtemp(path.join(os.tmpdir(), "card-generate-"));
    const planDir = await mkdtemp(path.join(os.tmpdir(), "card-plan-"));
    await writeFile(path.join(planDir, "editorial-plan.json"), JSON.stringify({
      version: "editorial-plan.v1", intent: "information", singleSubject: "검증된 주제", readerQuestion: "무엇인가?", corePromise: "검증된 사실을 설명합니다.",
      slides: [{ index: 1, role: "fact", headline: "제목", keyMessage: "내용", evidenceIds: ["subject-1"] }],
      cta: null, excludedTopics: [], referenceUses: [],
    }));
    await writeFile(path.join(dir, "content.json"), JSON.stringify({ title: "제목", content: { caption: "본문", hashtags: [], cta: "저장" } }));
    await writeFile(path.join(dir, "slide-01.png"), await sharp({ create: { width: 1000, height: 1250, channels: 3, background: "#fff" } }).png().toBuffer());
    const storage = { upload: vi.fn(async () => ({ manifest: { type: "card_news" }, manifestUrl: "https://blob/manifest.json" })) };
    await runOnce({
      workerId: "worker-1", client: api,
      planner: { run: vi.fn(async () => ({ outputDir: planDir, cleanup: vi.fn() })) },
      runner: { run: vi.fn(async () => ({ outputDir: dir, cleanup: vi.fn() })) }, storage: storage as never,
    });
    expect(storage.upload).toHaveBeenCalledOnce();
    expect(api.complete).toHaveBeenCalledWith("job-1", expect.objectContaining({ jobType: "generate" }));
  });

  it("does not retry deterministic output contract failures", async () => {
    const item = { ...job("generate"), outputId: null };
    const api = client(item);

    await runOnce({
      workerId: "worker-1",
      client: api,
      planner: { run: vi.fn() },
      runner: { run: vi.fn() },
      storage: { upload: vi.fn() },
    });

    expect(api.fail).toHaveBeenCalledWith("job-1", expect.objectContaining({
      errorCode: "card_news_output_id_required",
      retryable: false,
    }));
  });

  it("preflights attachment blobs before either Codex command", async () => {
    const item = job("generate");
    const input = item.payload.contentGenerationInput as Record<string, unknown>;
    input.attachments = [{
      id: "attachment-1", generationId: "generation-1", role: "document",
      fileName: "brief.pdf", mimeType: "application/pdf", sizeBytes: 42,
      checksum: "a".repeat(64), storageUrl: "https://blob.example/brief.pdf",
      storagePath: "generation/brief.pdf", createdAt: "2026-07-27T00:00:00.000Z",
    }];
    const api = client(item);
    const planner = { run: vi.fn() };
    const runner = { run: vi.fn() };
    await runOnce({
      workerId: "worker-1", client: api, planner, runner,
      storage: { upload: vi.fn() },
      head: vi.fn(async () => { throw Object.assign(new Error("not found"), { status: 404 }); }),
    });
    expect(planner.run).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
    expect(api.fail).toHaveBeenCalledWith("job-1", expect.objectContaining({
      errorCode: "ai_content_attachment_blob_unavailable",
      retryable: false,
    }));
  });

  it.each(["informational", "marketing"] as const)("completes a %s v3 plan without rendering or uploading images", async (purpose) => {
    const item = v3Job(purpose);
    const api = client(item);
    const dir = await mkdtemp(path.join(os.tmpdir(), "card-v3-plan-"));
    const expectedPlan = v3Plan(v3Input(purpose));
    await writeFile(path.join(dir, "card-news-plan.json"), JSON.stringify(expectedPlan));
    const planner = { run: vi.fn(async () => ({ outputDir: dir, cleanup: vi.fn() })) };
    const runner = { run: vi.fn() };
    const storage = { upload: vi.fn() };

    await runOnce({ workerId: "worker-1", client: api, planner, runner, storage });

    expect(planner.run).toHaveBeenCalledOnce();
    expect(runner.run).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(api.complete).toHaveBeenCalledWith(item.id, {
      workerId: "worker-1", leaseToken: "lease-v3", jobType: "generate",
      skillVersion: expect.any(String), plan: expectedPlan,
    });
  });

  it.each([
    ["count", "asset_count_mismatch", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.assetCount = 1; }],
    ["index", "asset_index_mismatch", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.assets[0]!.index = 2; }],
    ["no-logo", "logo_policy_mismatch", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.logoPolicy.allowGeneratedLogo = true as false; }],
    ["unknown evidence", "evidence_id_unknown", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.assets[0]!.evidenceIds = [uid(99)]; }],
    ["duplicate evidence", "evidence_id_duplicate", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.assets[1]!.evidenceIds = [uid(7), uid(7)]; }],
    ["malformed evidence", "evidence_ids_malformed", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.assets[0]!.evidenceIds = ["not-a-uuid"]; }],
  ])("repairs one invalid v3 %s plan with the validator error", async (_name, expectedError, mutate) => {
    const item = v3Job("informational");
    const api = client(item);
    const invalidDir = await mkdtemp(path.join(os.tmpdir(), "card-v3-invalid-"));
    const validDir = await mkdtemp(path.join(os.tmpdir(), "card-v3-valid-"));
    const invalid = v3Plan(v3Input("informational"));
    const valid = v3Plan(v3Input("informational"));
    mutate(invalid);
    await writeFile(path.join(invalidDir, "card-news-plan.json"), JSON.stringify(invalid));
    await writeFile(path.join(validDir, "card-news-plan.json"), JSON.stringify(valid));
    const planner = { run: vi.fn()
      .mockResolvedValueOnce({ outputDir: invalidDir, cleanup: vi.fn() })
      .mockResolvedValueOnce({ outputDir: validDir, cleanup: vi.fn() }) };
    const runner = { run: vi.fn() };
    const storage = { upload: vi.fn() };

    await runOnce({ workerId: "worker-1", client: api, planner, runner, storage });

    expect(planner.run).toHaveBeenCalledTimes(2);
    expect(planner.run.mock.calls[1]![1]).toContain(`card_news_plan_invalid:${expectedError}`);
    expect(api.complete).toHaveBeenCalledWith(item.id, expect.objectContaining({ plan: valid }));
    expect(runner.run).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("fails after one v3 repair and never queues image work locally", async () => {
    const item = v3Job("informational");
    const api = client(item);
    const firstDir = await mkdtemp(path.join(os.tmpdir(), "card-v3-invalid-"));
    const secondDir = await mkdtemp(path.join(os.tmpdir(), "card-v3-invalid-"));
    const invalid = v3Plan(v3Input("informational"));
    invalid.imagePackage.assetCount = 1;
    await writeFile(path.join(firstDir, "card-news-plan.json"), JSON.stringify(invalid));
    await writeFile(path.join(secondDir, "card-news-plan.json"), JSON.stringify(invalid));
    const planner = { run: vi.fn()
      .mockResolvedValueOnce({ outputDir: firstDir, cleanup: vi.fn() })
      .mockResolvedValueOnce({ outputDir: secondDir, cleanup: vi.fn() }) };
    const runner = { run: vi.fn() };
    const storage = { upload: vi.fn() };

    await runOnce({ workerId: "worker-1", client: api, planner, runner, storage });

    expect(planner.run).toHaveBeenCalledTimes(2);
    expect(api.complete).not.toHaveBeenCalled();
    expect(api.fail).toHaveBeenCalledWith(item.id, expect.objectContaining({ errorCode: "card_news_plan_invalid", retryable: false }));
    expect(runner.run).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
