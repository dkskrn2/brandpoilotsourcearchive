import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentWorkerApiError } from "@brand-pilot/worker-runtime";
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

function reelDraft() {
  return {
    contractVersion: "reel-plan-draft.v2",
    content: { caption: "Useful caption", hashtags: ["guide"], cta: "Save" },
    assets: [{
      index: 1,
      role: "scene",
      coreMessage: "Explain the fixed evidence clearly.",
      headline: "Use the verified process",
      keyVisual: { type: "none", texts: [] },
      supportingTexts: ["Explain the fixed evidence clearly."],
      footnote: null,
      visualDirection: "Vertical editorial scene.",
      evidenceIds: [uid(4)],
      productImageAssetIds: [],
    }],
  };
}

function compiledDraft() {
  return {
    contractVersion: "reel-plan-draft.v1",
    content: reelDraft().content,
    assets: [{
      index: 1,
      role: "scene",
      copy: "Use the verified process\nExplain the fixed evidence clearly.",
      visualDirection: "정보 위계(서버 고정): headline=1; keyVisual=none:0; supportingTexts=1; footnote=0\nVertical editorial scene.",
      evidenceIds: [uid(4)],
      productImageAssetIds: [],
    }],
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
    const run = await output(reelDraft());
    const planner = { run: vi.fn(async () => run) };

    const result = await runOnce({ workerId: "worker", client, planner });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(result).toEqual({ status: "completed", jobId: item.id });
    expect(client.complete).toHaveBeenCalledWith(item.id, {
      workerId: "worker",
      leaseToken: "lease",
      skillVersion: "reel-plan-skill.v5",
      jobType: "generate",
      planDraft: compiledDraft(),
    });
    expect(client.fail).not.toHaveBeenCalled();
    expect(client.heartbeat).not.toHaveBeenCalled();
    expect(run.cleanup).toHaveBeenCalledOnce();
  });

  it("repairs one invalid plan and completes the valid replacement", async () => {
    const item = job();
    const client = { claim: vi.fn(async () => item), heartbeat: vi.fn(), complete: vi.fn(), fail: vi.fn() } as unknown as ReelClient;
    const invalid = reelDraft();
    invalid.assets[0]!.role = "wrong-role";
    const first = await output(invalid);
    const second = await output(reelDraft());
    const planner = { run: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) };

    await runOnce({ workerId: "worker", client, planner });

    expect(planner.run).toHaveBeenCalledTimes(2);
    expect(planner.run.mock.calls[1]?.[1]).toContain("reel_plan_draft_outline_mismatch");
    expect(client.complete).toHaveBeenCalledWith(item.id, expect.objectContaining({ planDraft: compiledDraft() }));
    expect(first.cleanup).toHaveBeenCalledOnce();
    expect(second.cleanup).toHaveBeenCalledOnce();
  });

  it("classifies two invalid plans as a permanent failure", async () => {
    const item = job();
    const client = { claim: vi.fn(async () => item), heartbeat: vi.fn(), complete: vi.fn(), fail: vi.fn() } as unknown as ReelClient;
    const invalid = reelDraft();
    invalid.assets[0]!.role = "wrong-role";
    const planner = { run: vi.fn().mockResolvedValueOnce(await output(invalid)).mockResolvedValueOnce(await output(invalid)) };

    const result = await runOnce({ workerId: "worker", client, planner });

    expect(result).toEqual({ status: "failed", jobId: item.id });
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith(item.id, expect.objectContaining({ errorCode: "reel_plan_draft_outline_mismatch", retryable: false }));
  });

  it("does not call the planner again when API completion fails", async () => {
    const item = job();
    const client = {
      claim: vi.fn(async () => item), heartbeat: vi.fn(),
      complete: vi.fn(async () => { throw new ContentWorkerApiError(400, "ai_content_plan_invalid"); }), fail: vi.fn(),
    } as unknown as ReelClient;
    const planner = { run: vi.fn(async () => output(reelDraft())) };

    const result = await runOnce({ workerId: "worker", client, planner });

    expect(result).toEqual({ status: "failed", jobId: item.id });
    expect(planner.run).toHaveBeenCalledOnce();
    expect(client.complete).toHaveBeenCalledOnce();
    expect(client.fail).toHaveBeenCalledWith(item.id, expect.objectContaining({
      errorCode: "ai_content_plan_invalid",
      retryable: false,
    }));
  });

  it.each([
    ["429", new ContentWorkerApiError(429, "rate_limited")],
    ["503 maintenance", new ContentWorkerApiError(503, "ai_content_maintenance")],
    ["network", new TypeError("fetch failed")],
  ])("replays the identical completion body after a transient %s error without re-planning", async (_name, completionError) => {
    vi.useFakeTimers();
    const item = job();
    const client = {
      claim: vi.fn(async () => item), heartbeat: vi.fn(),
      complete: vi.fn().mockRejectedValueOnce(completionError).mockResolvedValueOnce(undefined), fail: vi.fn(),
    } as unknown as ReelClient;
    const planner = { run: vi.fn(async () => output(reelDraft())) };

    const running = runOnce({ workerId: "worker", client, planner });
    await vi.waitFor(() => expect(client.complete).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(250);
    const result = await running;

    expect(result).toEqual({ status: "completed", jobId: item.id });
    expect(planner.run).toHaveBeenCalledOnce();
    expect(client.complete).toHaveBeenCalledTimes(2);
    expect(client.complete.mock.calls[1]?.[1]).toBe(client.complete.mock.calls[0]?.[1]);
    expect(client.fail).not.toHaveBeenCalled();
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
