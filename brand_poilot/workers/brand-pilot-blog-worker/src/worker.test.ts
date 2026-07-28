import { describe, expect, it, vi } from "vitest";
import type { BlogClient, BlogJob } from "./contracts.js";
import { runOnce } from "./worker.js";

const input = {
  contractVersion: "content-generation-input.v2", contentType: "blog", brandContext: {},
  subject: { analysisId: "a", analysisVersion: 1, analysisContractVersion: "subject-analysis.v1", analysisResult: null, type: "product", sourceUrl: "", facts: [], research: {}, selectedImages: [] },
  message: { target: { id: "t", name: "target" }, appeal: { id: "a", targetId: "t", title: "appeal" }, qualityBrief: {} },
  creativeDirection: { prompts: ["write"], brandColor: "#000", selectedColor: "#000", aspectRatio: "1:1", outputCount: 1 },
  references: [],
  attachments: [{ id: "attachment-1", generationId: "generation-1", role: "document", fileName: "brief.pdf", mimeType: "application/pdf", sizeBytes: 42, checksum: "a".repeat(64), storageUrl: "https://blob.example/brief.pdf", storagePath: "generation/brief.pdf", createdAt: "2026-07-27T00:00:00.000Z" }],
};

describe("blog worker attachment preflight", () => {
  it("prevents Codex execution when storage is transiently unavailable", async () => {
    const job: BlogJob = { id: "job-1", generationId: "generation-1", outputId: "output-1", workspaceId: "w", brandId: "b", jobType: "generate", contentType: "blog", status: "processing", payload: { contentGenerationInput: input }, leaseToken: "lease" };
    const client = { claim: vi.fn(async () => job), heartbeat: vi.fn(), complete: vi.fn(), fail: vi.fn(), acquire: vi.fn(async () => ({ id: "resource", leaseToken: "resource-lease" })), heartbeatResource: vi.fn(), releaseResource: vi.fn() } as unknown as BlogClient;
    const runner = { run: vi.fn() };
    await runOnce({ workerId: "worker", client, runner, storage: { upload: vi.fn() }, head: vi.fn(async () => { throw Object.assign(new Error("unavailable"), { status: 503 }); }) });
    expect(runner.run).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith("job-1", expect.objectContaining({ errorCode: "ai_content_attachment_storage_unavailable", retryable: true }));
  });
});
