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
});
