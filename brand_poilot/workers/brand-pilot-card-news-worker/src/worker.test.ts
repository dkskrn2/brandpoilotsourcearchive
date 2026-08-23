import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentWorkerApiError } from "@brand-pilot/worker-runtime";
import type { AiContentJob, WorkerClient } from "./contracts.js";
import { runOnce } from "./worker.js";

function client(item: AiContentJob) { return { claim: vi.fn(async () => item), heartbeat: vi.fn(async () => undefined), complete: vi.fn(async () => undefined), fail: vi.fn(async () => undefined), acquire: vi.fn(async () => ({ id: "resource-1", leaseToken: "resource-token" })), heartbeatResource: vi.fn(async () => undefined), releaseResource: vi.fn(async () => undefined) } as unknown as WorkerClient; }

afterEach(() => vi.useRealTimers());

const uid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const capturedAt = "2026-07-31T00:00:00.000Z";
const frozenManualVisualSelection = {
  contractVersion: "manual-visual-selection-frozen.v1",
  product: null,
  stylePreset: null,
  avatar: null,
} as const;

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
    researchEvidence: { contractVersion: "research-evidence.v1", decision: "searched", reason: "Current source", queries: ["tea"], capturedAt, items: [{ id: uid(7), title: "Study", url: "https://evidence.example/study", publisher: null, publishedAt: null, capturedAt, claimSummary: "Use warm water", contentHash: "c".repeat(64) }] },
    references: { selected: [reference], brandStyleImages: [style], avatarStyleImageId: uid(5), attachments: [attachment] },
    selectedProposal: {
      id: uid(9), conceptKey: "tea-guide", title: "Tea guide", informationalType: marketing ? null : "how_to", oneLineIntent: "Explain tea", differentiator: "Simple", differentiationAxes: ["question"], target: "Adults", customerContext: "Choosing tea", keyMessage: "Brew well", hook: "Better tea", selectionReason: "Useful", evidenceIds: marketing ? [] : [uid(7)], referenceIds: [uid(5)], outputFormat: "card_news", channelTargets: ["instagram"], assetCount: 3,
      outline: [{ index: 1, role: "hook", headline: "Start", purpose: "Open" }, { index: 2, role: "guide", headline: "Steps", purpose: "Explain" }, { index: 3, role: "action", headline: "Next", purpose: "Act" }],
      purposeDetails: marketing
        ? { kind: "marketing", campaignObjective: "Sales", situationAndNeed: "Afternoon focus", productId: uid(2), targetSegment: "Office workers", strengths: ["Fresh leaves"], limitations: ["Contains caffeine"], appeal: "Calm focus", buyingBarriers: ["Price"], cta: "Buy now" }
        : { kind: "informational", question: "How?", value: "Guidance", whyNow: "Better habits", learningPoints: ["Temperature"] },
    },
    userImageInstruction: "Soft light",
    outputSettings: { purpose, outputFormat: "card_news", channelTargets: ["instagram"], aspectRatio: "4:5", outputCount: 1 },
  };
}

function v3Draft(input: ReturnType<typeof v3Input>) {
  const evidenceIds = [uid(7)];
  return {
    contractVersion: "card-manuscript-plan.v1",
    content: { caption: "Tea guide", hashtags: ["tea"], cta: "Save this" },
    deckNarrative: "A useful opening followed by a practical next step.",
    evidenceSelection: { selectedEvidenceIds: evidenceIds, excludedEvidenceIds: [] },
    scenes: [
      { index: 1, editorialRole: input.product ? "cover" : "hook", purpose: "Open", coreMessage: "Open with one useful reason.", headline: "Start with a clear reason and useful context.", informationRelation: { type: "none", entries: [] }, supportingTexts: [], footnote: null, evidenceIds, productImageAssetIds: [], avatarImageAssetIds: [] },
      { index: 2, editorialRole: input.product ? "action" : "explanation", purpose: "Explain", coreMessage: "Give one practical next step.", headline: "Use the fixed facts to explain a practical next step.", informationRelation: { type: "none", entries: [] }, supportingTexts: [], footnote: null, evidenceIds, productImageAssetIds: input.product ? [uid(4)] : [], avatarImageAssetIds: [] },
      { index: 3, editorialRole: input.product ? "closing" : "analysis", purpose: "Act", coreMessage: "Close with one useful action.", headline: "Save the guide and use it next time.", informationRelation: { type: "none", entries: [] }, supportingTexts: [], footnote: null, evidenceIds, productImageAssetIds: [], avatarImageAssetIds: [] },
    ],
  };
}

function compiledV1(input: ReturnType<typeof v3Input>) {
  const source = v3Draft(input);
  return {
    contractVersion: "card-news-plan-draft.v1",
    content: source.content,
    assets: source.scenes.map((asset, offset) => ({
      index: asset.index,
      role: input.selectedProposal.outline[offset]!.role,
      copy: asset.headline,
      visualDirection: expect.any(String),
      evidenceIds: asset.evidenceIds,
      productImageAssetIds: asset.productImageAssetIds,
    })),
  };
}

function v3Job(purpose: "informational" | "marketing") {
  return {
    id: `job-v3-${purpose}`, generationId: uid(10), outputId: `output-v3-${purpose}`, workspaceId: "w", brandId: "brand-1",
    jobType: "generate", outputFormat: "card_news", status: "processing",
    payload: { contentGenerationInput: v3Input(purpose), manualVisualSelection: frozenManualVisualSelection }, leaseToken: "lease-v3",
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
    const structuredDraft = v3Draft(v3Input(purpose));
    await writeFile(path.join(dir, "card-manuscript-plan.json"), JSON.stringify(structuredDraft));
    const planner = { run: vi.fn(async () => ({ outputDir: dir, cleanup: vi.fn() })) };
    await runOnce({ workerId: "worker-1", client: api, planner });

    expect(planner.run).toHaveBeenCalledOnce();
    expect(api.complete).toHaveBeenCalledWith(item.id, {
      workerId: "worker-1", leaseToken: "lease-v3", jobType: "generate",
      skillVersion: "card-manuscript-plan-skill.v3", planDraft: compiledV1(v3Input(purpose)),
      cardManuscriptContract: expect.objectContaining({
        contractVersion: "card-manuscript-plan.v1",
        manuscriptSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        plan: structuredDraft,
      }),
    });
  });

  it.each([
    ["empty count", "card_manuscript_plan_v1_invalid", (plan: ReturnType<typeof v3Draft>) => { plan.scenes = []; }],
    ["index", "card_manuscript_plan_v1_invalid", (plan: ReturnType<typeof v3Draft>) => { plan.scenes[0]!.index = 2; }],
    ["unknown evidence", "card_manuscript_evidence_partition_invalid", (plan: ReturnType<typeof v3Draft>) => { plan.scenes[0]!.evidenceIds = [uid(99)]; }],
    ["duplicate evidence", "card_manuscript_plan_v1_invalid", (plan: ReturnType<typeof v3Draft>) => { plan.scenes[1]!.evidenceIds = [uid(7), uid(7)]; }],
    ["malformed evidence", "card_manuscript_plan_v1_invalid", (plan: ReturnType<typeof v3Draft>) => { plan.scenes[0]!.evidenceIds = ["not-a-uuid"]; }],
    ["unknown product image", "product_image_id_unknown", (plan: ReturnType<typeof v3Draft>) => { plan.scenes[0]!.productImageAssetIds = [uid(99)]; }],
    ["duplicate hashtag", "card_manuscript_plan_v1_invalid", (plan: ReturnType<typeof v3Draft>) => { plan.content.hashtags = ["tea", "tea"]; }],
    ["blank caption", "card_manuscript_plan_v1_invalid", (plan: ReturnType<typeof v3Draft>) => { plan.content.caption = "   "; }],
    ["immutable generation field", "card_manuscript_plan_v1_invalid", (plan: ReturnType<typeof v3Draft>) => { Object.assign(plan, { generationId: uid(10) }); }],
    ["attachment selection", "card_manuscript_plan_v1_invalid", (plan: ReturnType<typeof v3Draft>) => { Object.assign(plan.scenes[0]!, { attachmentIds: [uid(8)] }); }],
  ])("repairs one invalid v3 %s plan with the validator error", async (_name, expectedError, mutate) => {
    const item = v3Job("informational");
    const api = client(item);
    const invalidDir = await mkdtemp(path.join(os.tmpdir(), "card-v3-invalid-"));
    const validDir = await mkdtemp(path.join(os.tmpdir(), "card-v3-valid-"));
    const invalid = v3Draft(v3Input("informational"));
    const valid = v3Draft(v3Input("informational"));
    mutate(invalid);
    await writeFile(path.join(invalidDir, "card-manuscript-plan.json"), JSON.stringify(invalid));
    await writeFile(path.join(validDir, "card-manuscript-plan.json"), JSON.stringify(valid));
    const planner = { run: vi.fn()
      .mockResolvedValueOnce({ outputDir: invalidDir, cleanup: vi.fn() })
      .mockResolvedValueOnce({ outputDir: validDir, cleanup: vi.fn() }) };
    await runOnce({ workerId: "worker-1", client: api, planner });

    expect(planner.run).toHaveBeenCalledTimes(2);
    expect(planner.run.mock.calls[1]![1]).toContain(`card_news_plan_invalid:${expectedError}`);
    expect(api.complete).toHaveBeenCalledWith(item.id, expect.objectContaining({ planDraft: compiledV1(v3Input("informational")) }));
  });

  it("fails after one v3 repair and never queues image work locally", async () => {
    const item = v3Job("informational");
    const api = client(item);
    const firstDir = await mkdtemp(path.join(os.tmpdir(), "card-v3-invalid-"));
    const secondDir = await mkdtemp(path.join(os.tmpdir(), "card-v3-invalid-"));
    const invalid = v3Draft(v3Input("informational"));
    invalid.scenes.pop();
    await writeFile(path.join(firstDir, "card-manuscript-plan.json"), JSON.stringify(invalid));
    await writeFile(path.join(secondDir, "card-manuscript-plan.json"), JSON.stringify(invalid));
    const planner = { run: vi.fn()
      .mockResolvedValueOnce({ outputDir: firstDir, cleanup: vi.fn() })
      .mockResolvedValueOnce({ outputDir: secondDir, cleanup: vi.fn() }) };
    await runOnce({ workerId: "worker-1", client: api, planner });

    expect(planner.run).toHaveBeenCalledTimes(2);
    expect(api.complete).not.toHaveBeenCalled();
    expect(api.fail).toHaveBeenCalledWith(item.id, expect.objectContaining({ errorCode: "card_news_plan_invalid", retryable: false }));
  });

  it("does not re-plan or retry a terminal API 400 completion error", async () => {
    const item = v3Job("informational");
    const api = client(item);
    api.complete = vi.fn(async () => {
      throw new ContentWorkerApiError(400, "ai_content_plan_invalid");
    });
    const dir = await mkdtemp(path.join(os.tmpdir(), "card-v3-plan-"));
    await writeFile(path.join(dir, "card-manuscript-plan.json"), JSON.stringify(v3Draft(v3Input("informational"))));
    const planner = { run: vi.fn(async () => ({ outputDir: dir, cleanup: vi.fn() })) };

    const result = await runOnce({ workerId: "worker-1", client: api, planner });

    expect(result).toEqual({ status: "failed", jobId: item.id });
    expect(planner.run).toHaveBeenCalledOnce();
    expect(api.complete).toHaveBeenCalledOnce();
    expect(api.fail).toHaveBeenCalledWith(item.id, expect.objectContaining({
      errorCode: "ai_content_plan_invalid",
      retryable: false,
    }));
  });
});
