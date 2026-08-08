import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReelClient, ReelJob } from "./contracts.js";
import { runOnce } from "./worker.js";

const uid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

function reelInput() {
  return {
    contractVersion: "content-generation-input.v3",
    generationId: uid(1),
    brandCore: { versionId: uid(2), companyOverview: "Overview", businessDescription: "Business", primaryCategory: "Category", detailedCategory: "Detail", primaryTarget: "Reader", differentiator: "Clear", coreAppeal: "Useful" },
    brandRules: { versionId: uid(3), version: 1, content: { contractVersion: "brand-rules.v1", requiredPhrases: [], forbiddenPhrases: [], exaggerationRules: [], ctaRules: { defaultCta: "", allowed: [] }, channelRules: {}, designRules: { colors: [], fonts: [], notes: [], referenceImages: [] }, autoApprovalRules: { enabled: false, conditions: [] } }, contentSha256: "c".repeat(64) },
    subject: { kind: "topic_text", title: "Reel guide" },
    contentInstruction: null,
    product: null,
    researchEvidence: { contractVersion: "research-evidence.v1", decision: "searched", reason: "Evidence", queries: ["query"], capturedAt: "2026-08-05T00:00:00.000Z", items: [{ id: uid(4), title: "Source", url: "https://example.com/source", publisher: null, publishedAt: null, capturedAt: "2026-08-05T00:00:00.000Z", claimSummary: "Claim", contentHash: "b".repeat(64) }] },
    references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
    selectedProposal: { id: uid(5), conceptKey: "guide", title: "Guide", informationalType: "how_to", oneLineIntent: "Explain", differentiator: "Direct", differentiationAxes: ["question"], target: "Reader", customerContext: "Need answer", keyMessage: "Answer", hook: "Question", selectionReason: "Useful", evidenceIds: [uid(4)], referenceIds: [], outputFormat: "reel", channelTargets: ["instagram"], assetCount: 1, outline: [{ index: 1, role: "scene", headline: "Open", purpose: "Explain" }], purposeDetails: { kind: "informational", question: "What?", value: "Answer", whyNow: "Now", learningPoints: ["Point"] } },
    userImageInstruction: null,
    outputSettings: { purpose: "informational", outputFormat: "reel", channelTargets: ["instagram"], aspectRatio: "9:16", outputCount: 1 },
    capturedAt: "2026-08-05T00:00:00.000Z",
  };
}

function job(): ReelJob {
  return { id: "job-reel", generationId: uid(1), outputId: uid(6), workspaceId: "workspace", brandId: "brand", jobType: "generate", outputFormat: "reel", status: "processing", payload: { contentGenerationInput: reelInput() }, leaseToken: "lease" };
}

function reelPlan() {
  return {
    contractVersion: "reel-plan.v2",
    outputFormat: "reel",
    content: { caption: "Useful caption", hashtags: ["guide"], cta: "Save" },
    imagePackage: {
      contractVersion: "image-generation-package.v1",
      generationId: uid(1),
      outputFormat: "reel",
      purpose: "informational",
      assetCount: 1,
      aspectRatio: "9:16",
      channelTargets: ["instagram"],
      assets: [{ index: 1, role: "scene", copy: "Explain the fixed evidence clearly.", visualDirection: "Vertical editorial scene.", evidenceIds: [uid(4)], productImageAssetIds: [], attachmentIds: [] }],
      product: null,
      references: [],
      brandStyleImages: [],
      avatarStyleImageId: null,
      attachments: [],
      userImageInstruction: null,
      logoPolicy: { allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true },
    },
  };
}

const temporary: string[] = [];
async function output(plan: Record<string, unknown>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reel-worker-test-"));
  temporary.push(dir);
  await writeFile(path.join(dir, "reel-plan.json"), JSON.stringify(plan));
  return { outputDir: dir, cleanup: vi.fn(async () => rm(dir, { recursive: true, force: true })) };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("reel worker", () => {
  it("completes the exact reel plan body, cleans output, and stops heartbeat", async () => {
    vi.useFakeTimers();
    const item = job();
    const client = { claim: vi.fn(async () => item), heartbeat: vi.fn(), complete: vi.fn(), fail: vi.fn() } as unknown as ReelClient;
    const run = await output(reelPlan());
    const planner = { run: vi.fn(async () => run) };

    const result = await runOnce({ workerId: "worker", client, planner });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(result).toEqual({ status: "completed", jobId: item.id });
    expect(client.complete).toHaveBeenCalledWith(item.id, {
      workerId: "worker",
      leaseToken: "lease",
      skillVersion: expect.any(String),
      jobType: "generate",
      plan: reelPlan(),
    });
    expect(client.fail).not.toHaveBeenCalled();
    expect(client.heartbeat).not.toHaveBeenCalled();
    expect(run.cleanup).toHaveBeenCalledOnce();
  });

  it("repairs one invalid plan and completes the valid replacement", async () => {
    const item = job();
    const client = { claim: vi.fn(async () => item), heartbeat: vi.fn(), complete: vi.fn(), fail: vi.fn() } as unknown as ReelClient;
    const invalid = reelPlan();
    invalid.imagePackage.assetCount = 2;
    const first = await output(invalid);
    const second = await output(reelPlan());
    const planner = { run: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) };

    await runOnce({ workerId: "worker", client, planner });

    expect(planner.run).toHaveBeenCalledTimes(2);
    expect(planner.run.mock.calls[1]?.[1]).toContain("reel_plan_input_mismatch");
    expect(client.complete).toHaveBeenCalledWith(item.id, expect.objectContaining({ plan: reelPlan() }));
    expect(first.cleanup).toHaveBeenCalledOnce();
    expect(second.cleanup).toHaveBeenCalledOnce();
  });

  it("classifies two invalid plans as a permanent failure", async () => {
    const item = job();
    const client = { claim: vi.fn(async () => item), heartbeat: vi.fn(), complete: vi.fn(), fail: vi.fn() } as unknown as ReelClient;
    const invalid = reelPlan();
    invalid.imagePackage.assetCount = 2;
    const planner = { run: vi.fn().mockResolvedValueOnce(await output(invalid)).mockResolvedValueOnce(await output(invalid)) };

    const result = await runOnce({ workerId: "worker", client, planner });

    expect(result).toEqual({ status: "failed", jobId: item.id });
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith(item.id, expect.objectContaining({ errorCode: "reel_plan_input_mismatch", retryable: false }));
  });

  it("classifies a transient runner failure as retryable", async () => {
    const item = job();
    const client = { claim: vi.fn(async () => item), heartbeat: vi.fn(), complete: vi.fn(), fail: vi.fn() } as unknown as ReelClient;
    const planner = { run: vi.fn(async () => { throw new Error("codex_reel_failed:1"); }) };

    const result = await runOnce({ workerId: "worker", client, planner });

    expect(result).toEqual({ status: "failed", jobId: item.id });
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith(item.id, expect.objectContaining({ errorCode: "codex_reel_failed", retryable: true }));
  });

  it("cancels planning and publishes no terminal result after the job lease is lost", async () => {
    vi.useFakeTimers();
    const item = job();
    const client = { claim: vi.fn(async () => item), heartbeat: vi.fn(async () => { throw new Error("worker_api_failed:409"); }), complete: vi.fn(), fail: vi.fn() } as unknown as ReelClient;
    const planner = { run: vi.fn((_job: ReelJob, _prompt: string, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) };

    const running = runOnce({ workerId: "worker", client, planner });
    await vi.waitFor(() => expect(planner.run).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await running;

    expect(result).toEqual({ status: "lease_lost", jobId: item.id });
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("cancels planning without terminal publication during shutdown", async () => {
    const item = job();
    const controller = new AbortController();
    const client = { claim: vi.fn(async () => item), heartbeat: vi.fn(), complete: vi.fn(), fail: vi.fn() } as unknown as ReelClient;
    const planner = { run: vi.fn((_job: ReelJob, _prompt: string, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) };

    const running = runOnce({ workerId: "worker", client, planner, shutdownSignal: controller.signal });
    await vi.waitFor(() => expect(planner.run).toHaveBeenCalledOnce());
    controller.abort();
    const result = await running;

    expect(result).toEqual({ status: "cancelled", jobId: item.id });
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).not.toHaveBeenCalled();
  });
});
