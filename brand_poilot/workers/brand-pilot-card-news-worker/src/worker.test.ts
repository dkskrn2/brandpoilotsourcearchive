import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiContentJob, WorkerClient } from "./contracts.js";
import { runOnce } from "./worker.js";

function client(item: AiContentJob) { return { claim: vi.fn(async () => item), heartbeat: vi.fn(async () => undefined), complete: vi.fn(async () => undefined), fail: vi.fn(async () => undefined), acquire: vi.fn(async () => ({ id: "resource-1", leaseToken: "resource-token" })), heartbeatResource: vi.fn(async () => undefined), releaseResource: vi.fn(async () => undefined) } as unknown as WorkerClient; }

afterEach(() => vi.useRealTimers());

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
    brandRules: { versionId: uid(11), version: 1, content: { contractVersion: "brand-rules.v1", requiredPhrases: [], forbiddenPhrases: [], exaggerationRules: [], ctaRules: { defaultCta: "", allowed: [] }, channelRules: {}, designRules: { colors: [], fonts: [], notes: [], referenceImages: [] }, autoApprovalRules: { enabled: false, conditions: [] } }, contentSha256: "f".repeat(64) },
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
    jobType: "generate", outputFormat: "card_news", status: "processing",
    payload: { contentGenerationInput: v3Input(purpose) }, leaseToken: "lease-v3",
  } as AiContentJob;
}

describe("card-news worker", () => {
  it("cancels planning and publishes no terminal result after the job lease is lost", async () => {
    vi.useFakeTimers();
    const item = v3Job("informational");
    const api = client(item);
    api.heartbeat = vi.fn(async () => { throw new Error("worker_api_failed:409"); });
    const planner = { run: vi.fn((_job: AiContentJob, _prompt: string, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) };

    const running = runOnce({ workerId: "worker-1", client: api, planner });
    await vi.waitFor(() => expect(planner.run).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await running;

    expect(result).toEqual({ status: "lease_lost", jobId: item.id });
    expect(api.complete).not.toHaveBeenCalled();
    expect(api.fail).not.toHaveBeenCalled();
  });

  it.each(["informational", "marketing"] as const)("completes a %s v3 plan without rendering or uploading images", async (purpose) => {
    const item = v3Job(purpose);
    const api = client(item);
    const dir = await mkdtemp(path.join(os.tmpdir(), "card-v3-plan-"));
    const expectedPlan = v3Plan(v3Input(purpose));
    await writeFile(path.join(dir, "card-news-plan.json"), JSON.stringify(expectedPlan));
    const planner = { run: vi.fn(async () => ({ outputDir: dir, cleanup: vi.fn() })) };
    await runOnce({ workerId: "worker-1", client: api, planner });

    expect(planner.run).toHaveBeenCalledOnce();
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
    await runOnce({ workerId: "worker-1", client: api, planner });

    expect(planner.run).toHaveBeenCalledTimes(2);
    expect(planner.run.mock.calls[1]![1]).toContain(`card_news_plan_invalid:${expectedError}`);
    expect(api.complete).toHaveBeenCalledWith(item.id, expect.objectContaining({ plan: valid }));
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
    await runOnce({ workerId: "worker-1", client: api, planner });

    expect(planner.run).toHaveBeenCalledTimes(2);
    expect(api.complete).not.toHaveBeenCalled();
    expect(api.fail).toHaveBeenCalledWith(item.id, expect.objectContaining({ errorCode: "card_news_plan_invalid", retryable: false }));
  });
});
