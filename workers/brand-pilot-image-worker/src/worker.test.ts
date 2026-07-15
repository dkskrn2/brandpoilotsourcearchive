import { describe, expect, it, vi } from "vitest";
import { parseWorkerManifest } from "./manifest.js";
import type { SourceReadResult } from "./sourceReader.js";
import {
  runOnce,
  type ClaimedImageJob,
  type RenderedInstagramPackage,
  type RenderedReelMedia
} from "./worker.js";

const hashtags = ["#one", "#two", "#three", "#four", "#five"];

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
    ["ffprobe_failed:invalid_stream", "Reel probe"]
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
