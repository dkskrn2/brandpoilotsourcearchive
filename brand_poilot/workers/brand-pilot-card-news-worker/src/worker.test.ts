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
});
