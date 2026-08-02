import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MarketingClient, MarketingJob } from "./contracts.js";
import { runOnce } from "./worker.js";

const input = {
  contractVersion: "content-generation-input.v2", contentType: "marketing", brandContext: {},
  subject: { analysisId: "a", analysisVersion: 1, analysisContractVersion: "subject-analysis.v1", analysisResult: null, type: "product", sourceUrl: "", facts: [], research: {}, selectedImages: [] },
  message: { target: { id: "t", name: "target" }, appeal: { id: "a", targetId: "t", title: "appeal" }, qualityBrief: {} },
  creativeDirection: { prompts: ["write"], brandColor: "#000", selectedColor: "#000", aspectRatio: "1:1", outputCount: 1 },
  references: [],
  attachments: [{ id: "attachment-1", generationId: "generation-1", role: "document", fileName: "brief.pdf", mimeType: "application/pdf", sizeBytes: 42, checksum: "a".repeat(64), storageUrl: "https://blob.example/brief.pdf", storagePath: "generation/brief.pdf", createdAt: "2026-07-27T00:00:00.000Z" }],
};

const uid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const capturedAt = "2026-07-31T00:00:00.000Z";
function v3Input(purpose: "informational" | "marketing", outputFormat: "reel" | "marketing_content") {
  const product = purpose === "marketing" ? {
    id: uid(2), versionId: uid(3), kind: "product", name: "Tea", description: "Green tea", features: ["Fresh"], benefits: ["Focus"], cautions: ["Caffeine"], evergreenPurchaseInfo: "Online", images: [],
  } : null;
  return {
    contractVersion: "content-generation-input.v3", generationId: uid(10), capturedAt,
    brandCore: { versionId: uid(1), companyOverview: "Company", businessDescription: "Business", primaryCategory: "Food", detailedCategory: "Tea", primaryTarget: "Adults", differentiator: "Fresh", coreAppeal: "Calm" },
    subject: { kind: "topic_text", title: "Tea guide" }, contentInstruction: "Practical", product,
    researchEvidence: purpose === "informational"
      ? { contractVersion: "research-evidence.v1", decision: "searched", reason: "Current", queries: ["tea"], capturedAt, items: [{ id: uid(7), title: "Study", url: "https://evidence.example/study", publisher: null, publishedAt: null, capturedAt, claimSummary: "Warm water", contentHash: "a".repeat(64) }] }
      : { contractVersion: "research-evidence.v1", decision: "not_needed", reason: "Fixed product", queries: [], capturedAt, items: [] },
    references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
    selectedProposal: {
      id: uid(9), conceptKey: "tea", title: "Tea", informationalType: purpose === "informational" ? "how_to" : null,
      oneLineIntent: "Explain", differentiator: "Simple", differentiationAxes: ["question"], target: "Adults", customerContext: "Choosing", keyMessage: "Brew", hook: "Better", selectionReason: "Useful",
      evidenceIds: purpose === "informational" ? [uid(7)] : [], referenceIds: [], outputFormat, channelTargets: ["instagram"], assetCount: 2,
      outline: [{ index: 1, role: "hook", headline: "Start", purpose: "Open" }, { index: 2, role: "detail", headline: "Steps", purpose: "Explain" }],
      purposeDetails: purpose === "informational"
        ? { kind: "informational", question: "How?", value: "Guide", whyNow: "Now", learningPoints: ["Step"] }
        : { kind: "marketing", campaignObjective: "Conversion", situationAndNeed: "Afternoon", productId: uid(2), targetSegment: "Workers", strengths: ["Fresh"], limitations: ["Caffeine"], appeal: "Focus", buyingBarriers: ["Price"], cta: "Buy" },
    },
    userImageInstruction: "Soft light",
    outputSettings: { purpose, outputFormat, channelTargets: ["instagram"], aspectRatio: outputFormat === "reel" ? "9:16" : "4:5", outputCount: 1 },
  };
}

function v3Plan(input: ReturnType<typeof v3Input>) {
  return {
    contractVersion: "marketing-plan.v2", outputFormat: input.outputSettings.outputFormat,
    content: { caption: "Caption", hashtags: ["tea"], cta: input.product ? "Buy" : "Save" },
    imagePackage: {
      contractVersion: "image-generation-package.v1", generationId: input.generationId, outputFormat: input.outputSettings.outputFormat,
      purpose: input.outputSettings.purpose, assetCount: 2, aspectRatio: input.outputSettings.aspectRatio, channelTargets: ["instagram"],
      assets: [
        { index: 1, role: "hook", copy: "Opening", visualDirection: "Vertical opening", evidenceIds: [], productImageAssetIds: [], attachmentIds: [] },
        { index: 2, role: "detail", copy: "Grounded detail", visualDirection: "Detail", evidenceIds: input.product ? [] : [uid(7)], productImageAssetIds: [], attachmentIds: [] },
      ], product: input.product, references: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [], userImageInstruction: input.userImageInstruction,
      logoPolicy: { allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true },
    },
  };
}

function v3Job(purpose: "informational" | "marketing", outputFormat: "reel" | "marketing_content"): MarketingJob {
  return { id: `job-${purpose}-${outputFormat}`, generationId: uid(10), outputId: "output-v3", workspaceId: "w", brandId: "b", jobType: "generate", contentType: "marketing", status: "processing", payload: { contentGenerationInput: v3Input(purpose, outputFormat) }, leaseToken: "lease" };
}

function clientFor(job: MarketingJob) {
  return { claim: vi.fn(async () => job), heartbeat: vi.fn(), complete: vi.fn(), fail: vi.fn(), acquire: vi.fn(async () => ({ id: "resource", leaseToken: "resource-lease" })), heartbeatResource: vi.fn(), releaseResource: vi.fn() } as unknown as MarketingClient;
}

describe("marketing worker attachment preflight", () => {
  it("prevents Codex execution when a snapshot blob is missing", async () => {
    const job: MarketingJob = { id: "job-1", generationId: "generation-1", outputId: "output-1", workspaceId: "w", brandId: "b", jobType: "generate", contentType: "marketing", status: "processing", payload: { contentGenerationInput: input }, leaseToken: "lease" };
    const client = { claim: vi.fn(async () => job), heartbeat: vi.fn(), complete: vi.fn(), fail: vi.fn(), acquire: vi.fn(async () => ({ id: "resource", leaseToken: "resource-lease" })), heartbeatResource: vi.fn(), releaseResource: vi.fn() } as unknown as MarketingClient;
    const runner = { run: vi.fn() };
    await runOnce({ workerId: "worker", client, runner, storage: { upload: vi.fn() }, head: vi.fn(async () => { throw Object.assign(new Error("not found"), { status: 404 }); }) });
    expect(runner.run).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith("job-1", expect.objectContaining({ errorCode: "ai_content_attachment_blob_unavailable", retryable: false }));
  });

  it("completes channel text without a generated image", async () => {
    const channelTextInput = {
      ...input,
      orchestration: {
        contractVersion: "content-orchestration.v1",
        contentFamily: "marketing",
        subject: { mode: "product_service", productServiceId: "product-1" },
        target: { id: "t", snapshot: { name: "target" } },
        strategy: "cta",
        outputFormat: "channel_text",
        channelTargets: ["threads"],
        brief: { goal: "문의 유도" },
        references: [],
        avatar: null,
      },
      creativeDirection: {
        ...input.creativeDirection,
        contentFamily: "marketing",
        outputFormat: "channel_text",
      },
      attachments: [],
    };
    const job: MarketingJob = {
      id: "job-text",
      generationId: "generation-1",
      outputId: "output-1",
      workspaceId: "w",
      brandId: "b",
      jobType: "generate",
      contentType: "marketing",
      status: "processing",
      payload: { contentGenerationInput: channelTextInput },
      leaseToken: "lease",
    };
    const client = {
      claim: vi.fn(async () => job),
      heartbeat: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      acquire: vi.fn(async () => ({ id: "resource", leaseToken: "resource-lease" })),
      heartbeatResource: vi.fn(),
      releaseResource: vi.fn(),
    } as unknown as MarketingClient;
    const storage = { upload: vi.fn(async ({ result }) => ({ manifest: { result }, manifestUrl: "https://blob.example/manifest.json" })) };
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "marketing-worker-text-"));
    await writeFile(path.join(outputDir, "content.json"), JSON.stringify({
      title: "채널 글",
      content: { headline: "혜택", body: "설명", cta: "문의", concept: "대상 → 가치" },
    }));
    await writeFile(path.join(outputDir, "channel-text.txt"), "혜택\n설명\n문의", "utf8");
    const runner = {
      run: vi.fn(async () => ({
        outputDir,
        cleanup: vi.fn(),
      })),
    };
    await runOnce({
      workerId: "worker",
      client,
      runner,
      storage,
    });
    expect(storage.upload).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ outputFormat: "channel_text", text: "혜택\n설명\n문의" }),
    }));
    expect(client.complete).toHaveBeenCalledOnce();
    expect(client.fail).not.toHaveBeenCalled();
  });

  it.each([
    ["informational", "reel"],
    ["marketing", "reel"],
    ["informational", "marketing_content"],
    ["marketing", "marketing_content"],
  ] as const)("completes only a %s/%s v3 plan without rendering or storage", async (purpose, outputFormat) => {
    const job = v3Job(purpose, outputFormat);
    const client = clientFor(job);
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "marketing-v3-plan-"));
    const expected = v3Plan(v3Input(purpose, outputFormat));
    await writeFile(path.join(outputDir, "marketing-plan.json"), JSON.stringify(expected));
    const runner = { run: vi.fn(async () => ({ outputDir, cleanup: vi.fn() })) };
    const storage = { upload: vi.fn() };

    await runOnce({ workerId: "worker", client, runner, storage });

    expect(runner.run).toHaveBeenCalledOnce();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(client.complete).toHaveBeenCalledWith(job.id, {
      workerId: "worker", leaseToken: "lease", skillVersion: expect.any(String), jobType: "generate", plan: expected,
    });
    expect(client.fail).not.toHaveBeenCalled();
  });

  it.each([
    ["count", "asset_count_mismatch", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.assetCount = 1; }],
    ["index", "asset_index_mismatch", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.assets[0]!.index = 2; }],
    ["output format", "output_format_mismatch", (plan: ReturnType<typeof v3Plan>) => { plan.outputFormat = "marketing_content"; }],
    ["no-logo", "logo_policy_mismatch", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.logoPolicy.allowGeneratedLogo = true as false; }],
    ["evidence", "evidence_id_unknown", (plan: ReturnType<typeof v3Plan>) => { plan.imagePackage.assets[1]!.evidenceIds = [uid(99)]; }],
    ["fixed product", "fixed_input_mismatch", (plan: ReturnType<typeof v3Plan>) => { if (plan.imagePackage.product) plan.imagePackage.product.name = "Changed"; }],
  ])("repairs one invalid v3 %s response using the targeted error", async (_name, errorCode, mutate) => {
    const job = v3Job("marketing", "reel");
    const client = clientFor(job);
    const invalidDir = await mkdtemp(path.join(os.tmpdir(), "marketing-v3-invalid-"));
    const validDir = await mkdtemp(path.join(os.tmpdir(), "marketing-v3-valid-"));
    const invalid = v3Plan(v3Input("marketing", "reel"));
    const valid = v3Plan(v3Input("marketing", "reel"));
    mutate(invalid);
    await writeFile(path.join(invalidDir, "marketing-plan.json"), JSON.stringify(invalid));
    await writeFile(path.join(validDir, "marketing-plan.json"), JSON.stringify(valid));
    const runner = { run: vi.fn().mockResolvedValueOnce({ outputDir: invalidDir, cleanup: vi.fn() }).mockResolvedValueOnce({ outputDir: validDir, cleanup: vi.fn() }) };
    const storage = { upload: vi.fn() };

    await runOnce({ workerId: "worker", client, runner, storage });

    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(runner.run.mock.calls[1]![1]).toContain(`marketing_plan_invalid:${errorCode}`);
    expect(client.complete).toHaveBeenCalledWith(job.id, expect.objectContaining({ plan: valid }));
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("fails after exactly one v3 repair without rendering or storage", async () => {
    const job = v3Job("informational", "marketing_content");
    const client = clientFor(job);
    const invalidDir = await mkdtemp(path.join(os.tmpdir(), "marketing-v3-invalid-"));
    const invalid = v3Plan(v3Input("informational", "marketing_content"));
    invalid.imagePackage.assetCount = 1;
    await writeFile(path.join(invalidDir, "marketing-plan.json"), JSON.stringify(invalid));
    const runner = { run: vi.fn(async () => ({ outputDir: invalidDir, cleanup: vi.fn() })) };
    const storage = { upload: vi.fn() };

    await runOnce({ workerId: "worker", client, runner, storage });

    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith(job.id, expect.objectContaining({ errorCode: "marketing_plan_invalid", retryable: false }));
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
