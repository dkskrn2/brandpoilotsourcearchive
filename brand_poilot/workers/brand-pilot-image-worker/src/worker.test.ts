import { describe, expect, it, vi } from "vitest";
import { parseWorkerManifest } from "./manifest.js";
import type { SourceReadResult } from "./sourceReader.js";
import {
  resolveAiContentLeaseTiming,
  runOnce,
  type ClaimedImageJob,
  type RenderedInstagramPackage,
  type RenderedReelMedia
} from "./worker.js";
import type { AiContentImageAssetJob, AiContentPackageFinalizeJob } from "./aiContentRenderClient.js";
import { createAiContentShutdownCoordinator } from "./aiContentShutdown.js";

const hashtags = ["#one", "#two", "#three", "#four", "#five"];
const qualityBrief = {
  version: "content-quality.v1",
  hook: "게시가 늦는 이유",
  readerPayoff: "승인 병목을 찾습니다",
  whyNow: "발행량 증가",
  specificClaims: ["담당자 지정", "기한 설정"],
  evidence: [
    { claim: "담당자", support: "서비스 페이지의 담당자 운영 설명입니다" },
    { claim: "기한", support: "FAQ에 명시된 승인 기한 설명입니다" }
  ],
  sourceGaps: []
};

function claimedJob(
  deliveryFormat: "instagram_feed_carousel" | "instagram_story" | "instagram_reel" = "instagram_feed_carousel"
): ClaimedImageJob {
  return {
    id: "job-1",
    leaseToken: "lease-1",
    brandId: "brand-1",
    channelOutputId: "output-1",
    payload: {
      contentTopicId: "topic-1",
      deliveryFormat,
      promptVersion: deliveryFormat === "instagram_feed_carousel"
        ? "worker-card.v4"
        : deliveryFormat === "instagram_story"
          ? "worker-story.v1"
          : "worker-reel.v3",
      representativeUrl: "https://source.example/article",
      maxImages: 5,
      topic: {
        title: "Topic",
        angle: "Useful angle",
        targetCustomer: null,
        region: null,
        season: null,
        notes: null
      },
      brand: {
        name: "Brand",
        categoryContext: null,
        primaryCustomer: null,
        description: null,
        tone: null,
        brandColor: "#112233"
      }
    }
  };
}

function workerClient(job = claimedJob()) {
  return {
    claim: vi.fn(async () => job),
    heartbeat: vi.fn(async () => ({ status: "running" })),
    complete: vi.fn(async () => ({ status: "succeeded" })),
    fail: vi.fn(async () => undefined)
  };
}

function asset(index: number, height: 1080 | 1920) {
  return {
    index,
    role: `role-${index}`,
    embeddedText: `message-${index}`,
    width: 1080,
    height
  };
}

function feedPackage(): RenderedInstagramPackage {
  return {
    manifest: parseWorkerManifest({
      deliveryFormat: "instagram_feed_carousel",
      promptVersion: "worker-card.v4",
      qualityBrief,
      selectedAssetCount: 2,
      caption: "first paragraph\n\nsecond paragraph",
      hashtags,
      cards: [asset(1, 1080), asset(2, 1080)]
    }),
    images: [
      { index: 1, bytes: Buffer.from("one"), mimeType: "image/png", width: 1080, height: 1080 },
      { index: 2, bytes: Buffer.from("two"), mimeType: "image/png", width: 1080, height: 1080 }
    ]
  };
}

function storyPackage(): RenderedInstagramPackage {
  return {
    manifest: parseWorkerManifest({
      deliveryFormat: "instagram_story",
      promptVersion: "worker-story.v1",
      qualityBrief,
      selectedAssetCount: 1,
      story: [asset(1, 1920)]
    }),
    images: [{ index: 1, bytes: Buffer.from("story"), mimeType: "image/png", width: 1080, height: 1920 }]
  };
}

function reelPackage(): RenderedInstagramPackage {
  return {
    manifest: parseWorkerManifest({
      deliveryFormat: "instagram_reel",
      promptVersion: "worker-reel.v3",
      qualityBrief,
      selectedAssetCount: 1,
      caption: "first paragraph\n\nsecond paragraph",
      hashtags,
      scenes: [asset(1, 1920)]
    }),
    images: [{ index: 1, bytes: Buffer.from("one"), mimeType: "image/png", width: 1080, height: 1920 }]
  };
}

function reelMedia(): RenderedReelMedia {
  return {
    cover: { bytes: Buffer.from("cover"), mimeType: "image/png", width: 1080, height: 1920 },
    video: {
      bytes: Buffer.from("video"),
      mimeType: "video/mp4",
      width: 1080,
      height: 1920,
      videoCodec: "h264",
      audioCodec: "aac",
      fps: 30
    }
  };
}

const fetchedSource: SourceReadResult = {
  sourceMode: "direct_url",
  fetchStatus: "fetched",
  sourceText: "representative source text"
};

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("image worker", () => {
  it("claims one Threads job only after the image queue is idle", async () => {
    const client = workerClient(null as unknown as ClaimedImageJob);
    const runTextJob = vi.fn(async () => ({ status: "completed" as const, jobId: "text-job-1" }));
    const renderer = { renderJob: vi.fn(async () => feedPackage()) };
    const storage = { upload: vi.fn(async () => ({ manifestUrl: "unused" })) };

    await expect(runOnce({ workerId: "worker-1", client, renderer, storage, runTextJob }))
      .resolves.toEqual({ status: "completed", jobId: "text-job-1" });
    expect(runTextJob).toHaveBeenCalledTimes(1);
    expect(renderer.renderJob).not.toHaveBeenCalled();
  });

  it("does not claim a Threads job while an image job is available", async () => {
    const client = workerClient();
    const runTextJob = vi.fn(async () => ({ status: "idle" as const }));
    const renderer = { renderJob: vi.fn(async () => feedPackage()) };
    const storage = { upload: vi.fn(async () => ({ manifestUrl: "https://blob.example.com/manifest.json" })) };

    await runOnce({
      workerId: "worker-1",
      client,
      renderer,
      storage,
      readSource: vi.fn(async () => fetchedSource),
      runTextJob
    });

    expect(runTextJob).not.toHaveBeenCalled();
  });

  it("reads source context, builds the prompt, renders the validated feed count, uploads, and completes with the lease", async () => {
    const client = workerClient();
    const rendered = feedPackage();
    const renderer = { renderJob: vi.fn(async () => rendered) };
    const storage = { upload: vi.fn(async () => ({ manifestUrl: "https://blob.example.com/manifest.json" })) };
    const readSource = vi.fn(async () => fetchedSource);

    const result = await runOnce({ workerId: "worker-1", client, renderer, storage, readSource });

    expect(result).toEqual({ status: "completed", jobId: "job-1" });
    expect(readSource).toHaveBeenCalledWith("https://source.example/article");
    expect(renderer.renderJob).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        prompt: expect.stringContaining('"sourceMode": "direct_url"'),
        sourceMode: "direct_url",
        fetchStatus: "fetched",
        sourceText: "representative source text"
      })
    }));
    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1" }),
      expect.objectContaining({
        manifest: expect.objectContaining({ selectedAssetCount: 2 }),
        source: fetchedSource
      })
    );
    expect(client.complete).toHaveBeenCalledWith("job-1", {
      workerId: "worker-1",
      leaseToken: "lease-1",
      manifestUrl: "https://blob.example.com/manifest.json"
    });
  });

  it("maps a legacy image job without categoryContext to 미설정 without reading industry", async () => {
    const job = claimedJob();
    delete (job.payload.brand as Record<string, unknown>).categoryContext;
    (job.payload.brand as Record<string, unknown>).industry = "legacy travel";
    const client = workerClient(job);
    let renderedJob: ClaimedImageJob | undefined;
    const renderer = { renderJob: vi.fn(async (preparedJob: ClaimedImageJob) => {
      renderedJob = preparedJob;
      return feedPackage();
    }) };
    const storage = { upload: vi.fn(async () => ({ manifestUrl: "https://blob.example.com/manifest.json" })) };

    await runOnce({
      workerId: "worker-1",
      client,
      renderer,
      storage,
      readSource: vi.fn(async () => fetchedSource)
    });

    const prompt = String(renderedJob?.payload.prompt);
    expect(prompt).toContain('"categoryContext": "미설정"');
    expect(prompt).not.toContain("legacy travel");
  });

  it("continues rendering when the representative URL is unavailable", async () => {
    const client = workerClient();
    const renderer = { renderJob: vi.fn(async () => feedPackage()) };
    const storage = { upload: vi.fn(async () => ({ manifestUrl: "https://blob.example.com/manifest.json" })) };
    const unavailable: SourceReadResult = {
      sourceMode: "url_unavailable",
      fetchStatus: "source_timeout",
      sourceText: null
    };

    await expect(runOnce({
      workerId: "worker-1",
      client,
      renderer,
      storage,
      readSource: vi.fn(async () => unavailable)
    })).resolves.toEqual({ status: "completed", jobId: "job-1" });

    expect(storage.upload).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: unavailable }));
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("accepts one 1080x1920 Story without invoking a Reel renderer", async () => {
    const client = workerClient(claimedJob("instagram_story"));
    const renderer = { renderJob: vi.fn(async () => storyPackage()) };
    const storage = { upload: vi.fn(async () => ({ manifestUrl: "https://blob.example.com/manifest.json" })) };
    const reelRenderer = { render: vi.fn(async () => reelMedia()) };

    await expect(runOnce({
      workerId: "worker-1",
      client,
      renderer,
      storage,
      reelRenderer,
      readSource: vi.fn(async () => fetchedSource)
    })).resolves.toEqual({ status: "completed", jobId: "job-1" });

    expect(reelRenderer.render).not.toHaveBeenCalled();
  });

  it("invokes the injected Reel renderer after validating one vertical image", async () => {
    const job = claimedJob("instagram_reel");
    const client = workerClient(job);
    const rendered = reelPackage();
    const media = reelMedia();
    const renderer = { renderJob: vi.fn(async () => rendered) };
    const reelRenderer = { render: vi.fn(async () => media) };
    const storage = { upload: vi.fn(async () => ({ manifestUrl: "https://blob.example.com/manifest.json" })) };

    await expect(runOnce({
      workerId: "worker-1",
      client,
      renderer,
      reelRenderer,
      storage,
      readSource: vi.fn(async () => fetchedSource)
    })).resolves.toEqual({ status: "completed", jobId: "job-1" });

    expect(reelRenderer.render).toHaveBeenCalledWith(expect.objectContaining({
      job: expect.objectContaining({ id: "job-1" }),
      scenes: rendered.images,
      manifest: expect.objectContaining({ deliveryFormat: "instagram_reel", selectedAssetCount: 1 })
    }));
    expect(storage.upload).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reel: media }));
  });

  it.each([
    ["asset_count_out_of_range", "manifest validation"],
    ["ffprobe_failed:invalid_stream", "Reel probe"],
    ["content_quality_evidence_insufficient", "quality planning"]
  ])("requeues retryable %s errors", async (message) => {
    const client = workerClient();
    const renderer = { renderJob: vi.fn(async () => { throw new Error(message); }) };
    const storage = { upload: vi.fn(async () => ({ manifestUrl: "https://blob.example.com/manifest.json" })) };

    await expect(runOnce({
      workerId: "worker-1",
      client,
      renderer,
      storage,
      readSource: vi.fn(async () => fetchedSource),
      retryDelayMs: 60_000
    })).resolves.toEqual({ status: "failed", jobId: "job-1" });

    expect(client.fail).toHaveBeenCalledWith("job-1", expect.objectContaining({
      error: message,
      retryable: true,
      retryAfterMs: 60_000
    }));
  });

  it("keeps heartbeats active through source, image, Reel, and upload work, then stops the timer", async () => {
    const sourceGate = deferred<SourceReadResult>();
    const renderGate = deferred<RenderedInstagramPackage>();
    const reelGate = deferred<RenderedReelMedia>();
    const uploadGate = deferred<{ manifestUrl: string }>();
    const client = workerClient(claimedJob("instagram_reel"));
    const renderer = { renderJob: vi.fn(() => renderGate.promise) };
    const reelRenderer = { render: vi.fn(() => reelGate.promise) };
    const storage = { upload: vi.fn(() => uploadGate.promise) };

    const running = runOnce({
      workerId: "worker-1",
      client,
      renderer,
      reelRenderer,
      storage,
      readSource: vi.fn(() => sourceGate.promise),
      heartbeatIntervalMs: 5
    });

    await wait(12);
    const afterSourceWait = client.heartbeat.mock.calls.length;
    expect(afterSourceWait).toBeGreaterThan(0);
    sourceGate.resolve(fetchedSource);
    await vi.waitFor(() => expect(renderer.renderJob).toHaveBeenCalled());

    await wait(12);
    expect(client.heartbeat.mock.calls.length).toBeGreaterThan(afterSourceWait);
    const afterRenderWait = client.heartbeat.mock.calls.length;
    renderGate.resolve(reelPackage());
    await vi.waitFor(() => expect(reelRenderer.render).toHaveBeenCalled());

    await wait(12);
    expect(client.heartbeat.mock.calls.length).toBeGreaterThan(afterRenderWait);
    const afterReelWait = client.heartbeat.mock.calls.length;
    reelGate.resolve(reelMedia());
    await vi.waitFor(() => expect(storage.upload).toHaveBeenCalled());

    await wait(12);
    expect(client.heartbeat.mock.calls.length).toBeGreaterThan(afterReelWait);
    uploadGate.resolve({ manifestUrl: "https://blob.example.com/manifest.json" });
    await expect(running).resolves.toEqual({ status: "completed", jobId: "job-1" });
    const finalHeartbeatCount = client.heartbeat.mock.calls.length;
    await wait(12);
    expect(client.heartbeat).toHaveBeenCalledTimes(finalHeartbeatCount);
  });

  it("never overlaps heartbeat requests", async () => {
    const firstHeartbeat = deferred<{ status: string }>();
    const renderGate = deferred<RenderedInstagramPackage>();
    const client = workerClient();
    client.heartbeat
      .mockImplementationOnce(() => firstHeartbeat.promise)
      .mockResolvedValue({ status: "running" });
    const renderer = { renderJob: vi.fn(() => renderGate.promise) };
    const storage = { upload: vi.fn(async () => ({ manifestUrl: "https://blob.example.com/manifest.json" })) };

    const running = runOnce({
      workerId: "worker-1",
      client,
      renderer,
      storage,
      readSource: vi.fn(async () => fetchedSource),
      heartbeatIntervalMs: 5
    });

    await wait(20);
    expect(client.heartbeat).toHaveBeenCalledTimes(1);
    firstHeartbeat.resolve({ status: "running" });
    await vi.waitFor(() => expect(client.heartbeat.mock.calls.length).toBeGreaterThan(1));
    renderGate.resolve(feedPackage());
    await expect(running).resolves.toEqual({ status: "completed", jobId: "job-1" });
  });
});

const v3id = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function v3AssetJob(): AiContentImageAssetJob {
  return {
    id: v3id(1), generationId: v3id(2), outputId: v3id(3), workspaceId: v3id(4), brandId: v3id(5),
    jobKind: "image_asset", assetIndex: 2, leaseToken: "v3-lease", attemptCount: 1,
    payload: {
      contractVersion: "ai-content-render-job.v1", jobKind: "image_asset", generationId: v3id(2), outputId: v3id(3), assetIndex: 2,
      assetKey: `${v3id(2)}:2`, storagePath: `ai-content/${v3id(5)}/${v3id(2)}/${v3id(3)}/assets/02.png`,
      imagePackage: {
        contractVersion: "image-generation-package.v1", generationId: v3id(2), outputFormat: "card_news", purpose: "informational", assetCount: 3, aspectRatio: "1:1", channelTargets: ["instagram"],
        assets: [1, 2, 3].map((index) => ({ index, role: `role-${index}`, copy: `copy-${index}`, visualDirection: `visual-${index}`, evidenceIds: [], productImageAssetIds: [], attachmentIds: [] })),
        product: null, references: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [], userImageInstruction: null,
        logoPolicy: { allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true },
      },
    },
  };
}

function v3Client(claimed: AiContentImageAssetJob | AiContentPackageFinalizeJob | null = v3AssetJob()) {
  return {
    claim: vi.fn(async () => claimed), heartbeat: vi.fn(async () => true), completeAsset: vi.fn(async () => undefined),
    completePackage: vi.fn(async () => undefined), fail: vi.fn(async () => undefined),
  };
}

describe("V3 AI content render priority", () => {
  it("falls through unchanged to the legacy image queue when V3 is empty", async () => {
    const aiContentClient = v3Client(null);
    const client = workerClient();
    const renderer = { renderJob: vi.fn(async () => feedPackage()) };
    const storage = { upload: vi.fn(async () => ({ manifestUrl: "https://blob.example/legacy.json" })) };

    await expect(runOnce({ workerId: "worker", aiContentClient, aiContentRenderer: { renderAsset: vi.fn() }, aiContentStorage: { uploadAsset: vi.fn() }, aiContentFinalizer: vi.fn(), client, renderer, storage, readSource: vi.fn(async () => fetchedSource) }))
      .resolves.toEqual({ status: "completed", jobId: "job-1" });
    expect(aiContentClient.claim).toHaveBeenCalledBefore(client.claim);
    expect(renderer.renderJob).toHaveBeenCalledTimes(1);
  });

  it("renders and uploads only the exact V3 asset index, never its successful siblings", async () => {
    const aiContentClient = v3Client();
    const aiContentRenderer = { renderAsset: vi.fn(async (job: AiContentImageAssetJob) => ({ index: job.assetIndex, bytes: Buffer.from("asset-2"), mimeType: "image/png" as const, width: 1080, height: 1080, checksum: "a".repeat(64) })) };
    const aiContentStorage = { uploadAsset: vi.fn(async (input: { path: string }) => ({ index: 2, url: "https://blob.example/02.png", storagePath: input.path, mimeType: "image/png" as const, width: 1080, height: 1080, checksum: "a".repeat(64) })) };
    const client = workerClient();

    await expect(runOnce({ workerId: "worker", aiContentClient, aiContentRenderer, aiContentStorage, aiContentFinalizer: vi.fn(), client, renderer: { renderJob: vi.fn() }, storage: { upload: vi.fn() } }))
      .resolves.toEqual({ status: "completed", jobId: v3id(1) });
    expect(aiContentRenderer.renderAsset).toHaveBeenCalledTimes(1);
    expect(aiContentRenderer.renderAsset).toHaveBeenCalledWith(expect.objectContaining({ assetIndex: 2 }), expect.any(AbortSignal));
    expect(aiContentStorage.uploadAsset).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringMatching(/\/assets\/02\.png$/), index: 2 }));
    expect(aiContentClient.completeAsset).toHaveBeenCalledWith(expect.objectContaining({ id: v3id(1) }), "worker", expect.objectContaining({ index: 2 }));
    expect(client.claim).not.toHaveBeenCalled();
  });

  it("isolates V3 failure from legacy job state", async () => {
    const aiContentClient = v3Client();
    const client = workerClient();
    await expect(runOnce({ workerId: "worker", aiContentClient, aiContentRenderer: { renderAsset: vi.fn(async () => { throw new Error("ai_content_asset_render_failed"); }) }, aiContentStorage: { uploadAsset: vi.fn() }, aiContentFinalizer: vi.fn(), client, renderer: { renderJob: vi.fn() }, storage: { upload: vi.fn() } }))
      .resolves.toEqual({ status: "failed", jobId: v3id(1) });
    expect(aiContentClient.fail).toHaveBeenCalledWith(expect.objectContaining({ id: v3id(1) }), "worker", expect.objectContaining({ errorCode: "ai_content_asset_render_failed" }));
    expect(client.fail).not.toHaveBeenCalled();
    expect(client.claim).not.toHaveBeenCalled();
  });

  it("reports only a safe diagnostic code from renderer stderr without changing retry classification", async () => {
    const aiContentClient = v3Client();
    const processError = new Error("ai_content_asset_render_failed:1");
    Object.defineProperty(processError, "diagnostic", {
      enumerable: false,
      value: "request failed\nai_content_asset_final_message_invalid\nSECRET_TOKEN=do-not-store",
    });

    await expect(runOnce({
      workerId: "worker",
      aiContentClient,
      aiContentRenderer: { renderAsset: vi.fn(async () => { throw processError; }) },
      aiContentStorage: { uploadAsset: vi.fn() },
      aiContentFinalizer: vi.fn(),
      client: workerClient(), renderer: { renderJob: vi.fn() }, storage: { upload: vi.fn() },
    })).resolves.toEqual({ status: "failed", jobId: v3id(1) });

    expect(aiContentClient.fail).toHaveBeenCalledWith(expect.anything(), "worker", {
      errorCode: "ai_content_asset_render_failed",
      errorMessage: "ai_content_asset_render_failed:1",
      diagnosticCode: "ai_content_asset_final_message_invalid",
      retryable: true,
    });
    expect(JSON.stringify(aiContentClient.fail.mock.calls[0]?.[2])).not.toContain("SECRET_TOKEN");
  });

  it("aborts the active child signal when a heartbeat loses the lease", async () => {
    const aiContentClient = v3Client();
    aiContentClient.heartbeat.mockResolvedValue(false);
    const aiContentRenderer = { renderAsset: vi.fn((_job: AiContentImageAssetJob, signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) };
    await expect(runOnce({ workerId: "worker", aiContentClient, aiContentRenderer, aiContentStorage: { uploadAsset: vi.fn() }, aiContentFinalizer: vi.fn(), client: workerClient(), renderer: { renderJob: vi.fn() }, storage: { upload: vi.fn() }, aiContentHeartbeatIntervalMs: 2 }))
      .resolves.toEqual({ status: "failed", jobId: v3id(1) });
    expect(aiContentClient.fail).not.toHaveBeenCalled();
  });
});

describe("V3 lease timing and shutdown", () => {
  it("caps heartbeats at one third of the validated lease and safely normalizes invalid configuration", () => {
    expect(resolveAiContentLeaseTiming({ leaseSeconds: 180, heartbeatIntervalMs: 60_000 })).toEqual({ leaseSeconds: 180, heartbeatIntervalMs: 60_000 });
    expect(resolveAiContentLeaseTiming({ leaseSeconds: 30, heartbeatIntervalMs: 60_000 })).toEqual({ leaseSeconds: 30, heartbeatIntervalMs: 10_000 });
    expect(resolveAiContentLeaseTiming({ leaseSeconds: 30, heartbeatIntervalMs: 100 })).toEqual({ leaseSeconds: 30, heartbeatIntervalMs: 1_000 });
    expect(resolveAiContentLeaseTiming({ leaseSeconds: Number.NaN, heartbeatIntervalMs: Number.POSITIVE_INFINITY })).toEqual({ leaseSeconds: 180, heartbeatIntervalMs: 60_000 });
  });

  it("does not claim new work when shutdown was already requested", async () => {
    const shutdown = new AbortController();
    shutdown.abort(new Error("shutdown"));
    const aiContentClient = v3Client();
    const client = workerClient();
    await expect(runOnce({ workerId: "worker", signal: shutdown.signal, aiContentClient, aiContentRenderer: { renderAsset: vi.fn() }, aiContentStorage: { uploadAsset: vi.fn() }, aiContentFinalizer: vi.fn(), client, renderer: { renderJob: vi.fn() }, storage: { upload: vi.fn() } }))
      .resolves.toEqual({ status: "idle" });
    expect(aiContentClient.claim).not.toHaveBeenCalled();
    expect(client.claim).not.toHaveBeenCalled();
  });

  it("links external shutdown to the active renderer and removes the listener without reporting a stale failure", async () => {
    const shutdown = new AbortController();
    const add = vi.spyOn(shutdown.signal, "addEventListener");
    const remove = vi.spyOn(shutdown.signal, "removeEventListener");
    const onAiContentActivityChange = vi.fn();
    const aiContentClient = v3Client();
    const aiContentRenderer = { renderAsset: vi.fn((_job: AiContentImageAssetJob, signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) };
    const running = runOnce({ workerId: "worker", signal: shutdown.signal, onAiContentActivityChange, aiContentClient, aiContentRenderer, aiContentStorage: { uploadAsset: vi.fn() }, aiContentFinalizer: vi.fn(), client: workerClient(), renderer: { renderJob: vi.fn() }, storage: { upload: vi.fn() } });
    await vi.waitFor(() => expect(aiContentRenderer.renderAsset).toHaveBeenCalled());

    shutdown.abort(new Error("shutdown"));

    await expect(running).resolves.toEqual({ status: "failed", jobId: v3id(1) });
    expect(aiContentClient.fail).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(onAiContentActivityChange.mock.calls).toEqual([[true], [false]]);
  });
});

describe("V3 process shutdown coordination", () => {
  it("immediately relays a signal while V3 is inactive, including legacy work and resource waits", () => {
    const relaySignal = vi.fn();
    const setGraceTimer = vi.fn();
    const coordinator = createAiContentShutdownCoordinator({
      graceMs: 5_000,
      relaySignal,
      setGraceTimer,
      clearGraceTimer: vi.fn(),
    });

    coordinator.handleSignal("SIGTERM");

    expect(coordinator.signal.aborted).toBe(false);
    expect(setGraceTimer).not.toHaveBeenCalled();
    expect(relaySignal).toHaveBeenCalledTimes(1);
    expect(relaySignal).toHaveBeenCalledWith("SIGTERM");
    coordinator.dispose();
  });

  it("aborts active V3 work and cancels the grace fallback after normal cleanup", () => {
    const relaySignal = vi.fn();
    const timerHandle = Symbol("grace-timer");
    const setGraceTimer = vi.fn(() => timerHandle);
    const clearGraceTimer = vi.fn();
    const coordinator = createAiContentShutdownCoordinator({
      graceMs: 5_000,
      relaySignal,
      setGraceTimer,
      clearGraceTimer,
    });
    coordinator.onAiContentActivityChange(true);

    coordinator.handleSignal("SIGINT");

    expect(coordinator.signal.aborted).toBe(true);
    expect(relaySignal).not.toHaveBeenCalled();
    expect(setGraceTimer).toHaveBeenCalledWith(expect.any(Function), 5_000);
    coordinator.onAiContentActivityChange(false);
    coordinator.dispose();
    expect(clearGraceTimer).toHaveBeenCalledTimes(1);
    expect(clearGraceTimer).toHaveBeenCalledWith(timerHandle);
  });

  it("relays the original signal when active V3 cleanup exceeds the grace period", () => {
    const relaySignal = vi.fn();
    let expireGrace: (() => void) | undefined;
    const coordinator = createAiContentShutdownCoordinator({
      graceMs: 5_000,
      relaySignal,
      setGraceTimer: vi.fn((callback) => {
        expireGrace = callback;
        return Symbol("grace-timer");
      }),
      clearGraceTimer: vi.fn(),
    });
    coordinator.onAiContentActivityChange(true);
    coordinator.handleSignal("SIGTERM");

    expireGrace?.();

    expect(relaySignal).toHaveBeenCalledTimes(1);
    expect(relaySignal).toHaveBeenCalledWith("SIGTERM");
    coordinator.dispose();
  });
});

describe("V3 transient failure classification", () => {
  it("reports a Reel FFmpeg finalizer failure as retryable without invoking image rendering or upload", async () => {
    const assetJob = v3AssetJob();
    const finalizerJob: AiContentPackageFinalizeJob = { ...assetJob, jobKind: "package_finalize", assetIndex: null, payload: { contractVersion: "ai-content-render-job.v1", jobKind: "package_finalize", generationId: assetJob.generationId, outputId: assetJob.outputId, plan: {}, finalInput: {}, supplementalResearch: null, assets: [] } };
    const aiContentClient = v3Client(finalizerJob);
    const aiContentRenderer = { renderAsset: vi.fn() };
    const aiContentStorage = { uploadAsset: vi.fn() };
    await runOnce({ workerId: "worker", aiContentClient, aiContentRenderer, aiContentStorage, aiContentFinalizer: vi.fn(async () => { throw new Error("ai_content_reel_render_failed:ffmpeg_failed"); }), client: workerClient(), renderer: { renderJob: vi.fn() }, storage: { upload: vi.fn() } });
    expect(aiContentRenderer.renderAsset).not.toHaveBeenCalled();
    expect(aiContentStorage.uploadAsset).not.toHaveBeenCalled();
    expect(aiContentClient.fail).toHaveBeenCalledWith(expect.anything(), "worker", expect.objectContaining({ errorCode: "ai_content_reel_render_failed", retryable: true }));
  });

  it("passes lease-loss cancellation into a Reel finalizer and never uploads or completes afterward", async () => {
    const assetJob = v3AssetJob();
    const finalizerJob: AiContentPackageFinalizeJob = { ...assetJob, jobKind: "package_finalize", assetIndex: null, payload: { contractVersion: "ai-content-render-job.v1", jobKind: "package_finalize", generationId: assetJob.generationId, outputId: assetJob.outputId, plan: {}, finalInput: {}, supplementalResearch: null, assets: [] } };
    const aiContentClient = v3Client(finalizerJob);
    aiContentClient.heartbeat.mockResolvedValue(false);
    const aiContentRenderer = { renderAsset: vi.fn() };
    const aiContentStorage = { uploadAsset: vi.fn() };
    const aiContentFinalizer = vi.fn((_job: AiContentPackageFinalizeJob, signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));

    await expect(runOnce({ workerId: "worker", aiContentClient, aiContentRenderer, aiContentStorage, aiContentFinalizer, client: workerClient(), renderer: { renderJob: vi.fn() }, storage: { upload: vi.fn() }, aiContentHeartbeatIntervalMs: 2 })).resolves.toEqual({ status: "failed", jobId: finalizerJob.id });
    expect(aiContentRenderer.renderAsset).not.toHaveBeenCalled();
    expect(aiContentStorage.uploadAsset).not.toHaveBeenCalled();
    expect(aiContentClient.completePackage).not.toHaveBeenCalled();
    expect(aiContentClient.fail).not.toHaveBeenCalled();
  });

  it.each([
    ["Too many requests", undefined, "Error"],
    ["request failed", "429", "Error"],
    ["service is currently not available", undefined, "BlobServiceNotAvailable"],
    ["upstream returned 503", undefined, "Error"],
    ["fetch failed", undefined, "TypeError"],
    ["socket hang up", "ECONNRESET", "Error"],
    ["connect failed", "ECONNREFUSED", "Error"],
    ["timed out", "ETIMEDOUT", "Error"],
    ["dns failed", "EAI_AGAIN", "Error"],
    ["network error", undefined, "Error"],
  ])("marks transport failure %s / %s retryable", async (message, code, name) => {
    const error = Object.assign(new Error(message), { code, name });
    const aiContentClient = v3Client();
    await runOnce({ workerId: "worker", aiContentClient, aiContentRenderer: { renderAsset: vi.fn(async () => { throw error; }) }, aiContentStorage: { uploadAsset: vi.fn() }, aiContentFinalizer: vi.fn(), client: workerClient(), renderer: { renderJob: vi.fn() }, storage: { upload: vi.fn() } });
    expect(aiContentClient.fail).toHaveBeenCalledWith(expect.anything(), "worker", expect.objectContaining({ retryable: true }));
  });

  it.each(["ai_content_asset_storage_conflict", "ai_content_owned_blob_checksum_mismatch", "worker_ai_content_v3_invalid"])("keeps deterministic failure %s terminal", async (message) => {
    const aiContentClient = v3Client();
    await runOnce({ workerId: "worker", aiContentClient, aiContentRenderer: { renderAsset: vi.fn(async () => { throw new Error(message); }) }, aiContentStorage: { uploadAsset: vi.fn() }, aiContentFinalizer: vi.fn(), client: workerClient(), renderer: { renderJob: vi.fn() }, storage: { upload: vi.fn() } });
    expect(aiContentClient.fail).toHaveBeenCalledWith(expect.anything(), "worker", expect.objectContaining({ retryable: false }));
  });
});
