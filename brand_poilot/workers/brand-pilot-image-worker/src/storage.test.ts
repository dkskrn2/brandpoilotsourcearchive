import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";
import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { parseWorkerManifest } from "./manifest.js";
import { createAiContentBlobStorage, createBlobStorage } from "./storage.js";
import type { ClaimedImageJob, RenderedInstagramPackage } from "./worker.js";

vi.mock("@vercel/blob", () => ({ get: vi.fn(), put: vi.fn() }));

const hashtags = ["#one", "#two", "#three", "#four", "#five"];

function checksum(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function job(deliveryFormat: "instagram_feed_carousel" | "instagram_story" | "instagram_reel"): ClaimedImageJob {
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
      representativeUrl: "https://source.example.com/article",
      maxImages: 5
    }
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

function renderedFeed(): RenderedInstagramPackage {
  const one = Buffer.from("feed-one");
  const two = Buffer.from("feed-two");
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
      { index: 1, bytes: one, mimeType: "image/png", width: 1080, height: 1080 },
      { index: 2, bytes: two, mimeType: "image/png", width: 1080, height: 1080 }
    ],
    source: { sourceMode: "direct_url", fetchStatus: "fetched", sourceText: "source text" }
  };
}

describe("Blob image storage", () => {
  beforeEach(() => {
    vi.mocked(put).mockReset();
    vi.mocked(put).mockImplementation(async (pathname: string) => ({
      url: `https://blob.example.com/${pathname}`,
      downloadUrl: `https://blob.example.com/${pathname}?download=1`,
      pathname,
      etag: `etag-${pathname}`,
      contentType: pathname.endsWith(".png")
        ? "image/png"
        : pathname.endsWith(".mp4")
          ? "video/mp4"
          : "application/json",
      contentDisposition: "inline"
    }));
  });

  it("uploads feed cards to the exact topic path and stores a central-parser-compatible manifest", async () => {
    const storage = createBlobStorage({ token: "blob-token", model: "codex-imagegen" });
    const rendered = renderedFeed();

    const result = await storage.upload(job("instagram_feed_carousel"), rendered);

    const prefix = "brands/brand-1/topics/topic-1/instagram_feed_carousel/job-1";
    expect(result.manifestUrl).toBe(`https://blob.example.com/${prefix}/manifest.json`);
    expect(vi.mocked(put).mock.calls.map(([pathname]) => pathname)).toEqual([
      `${prefix}/card-01.png`,
      `${prefix}/card-02.png`,
      `${prefix}/manifest.json`
    ]);
    const manifest = JSON.parse(String(vi.mocked(put).mock.calls[2][1]));
    expect(manifest).toMatchObject({
      jobId: "job-1",
      channelOutputId: "output-1",
      deliveryFormat: "instagram_feed_carousel",
      promptVersion: "worker-card.v4",
      representativeUrl: "https://source.example.com/article",
      sourceMode: "direct_url",
      fetchStatus: "fetched",
      selectedAssetCount: 2,
      validation: { passed: true },
      caption: "first paragraph\n\nsecond paragraph",
      hashtags
    });
    expect(manifest.cards).toEqual([
      expect.objectContaining({
        index: 1,
        role: "role-1",
        url: `https://blob.example.com/${prefix}/card-01.png`,
        mimeType: "image/png",
        width: 1080,
        height: 1080,
        checksum: checksum(Buffer.from("feed-one"))
      }),
      expect.objectContaining({
        index: 2,
        role: "role-2",
        checksum: checksum(Buffer.from("feed-two"))
      })
    ]);
  });

  it("uploads exactly one vertical Story as story.png", async () => {
    const storage = createBlobStorage({ token: "blob-token", model: "codex-imagegen" });
    const bytes = Buffer.from("story");
    const rendered: RenderedInstagramPackage = {
      manifest: parseWorkerManifest({
        deliveryFormat: "instagram_story",
        promptVersion: "worker-story.v1",
        selectedAssetCount: 1,
        story: [asset(1, 1920)]
      }),
      images: [{ index: 1, bytes, mimeType: "image/png", width: 1080, height: 1920 }],
      source: { sourceMode: "url_unavailable", fetchStatus: "source_timeout", sourceText: null }
    };

    await storage.upload(job("instagram_story"), rendered);

    const prefix = "brands/brand-1/topics/topic-1/instagram_story/job-1";
    expect(vi.mocked(put).mock.calls.map(([pathname]) => pathname)).toEqual([
      `${prefix}/story.png`,
      `${prefix}/manifest.json`
    ]);
    const manifest = JSON.parse(String(vi.mocked(put).mock.calls[1][1]));
    expect(manifest).toMatchObject({
      deliveryFormat: "instagram_story",
      sourceMode: "url_unavailable",
      fetchStatus: "source_timeout",
      selectedAssetCount: 1,
      story: {
        index: 1,
        role: "role-1",
        width: 1080,
        height: 1920,
        checksum: checksum(bytes)
      }
    });
    expect(manifest.caption).toBeUndefined();
    expect(manifest.hashtags).toBeUndefined();
  });

  it("uploads Reel scenes, cover, video, and their verified metadata", async () => {
    const storage = createBlobStorage({ token: "blob-token", model: "codex-imagegen" });
    const scene = Buffer.from("scene");
    const cover = Buffer.from("cover");
    const video = Buffer.from("video");
    const rendered = {
      manifest: parseWorkerManifest({
        deliveryFormat: "instagram_reel",
        promptVersion: "worker-reel.v3",
        selectedAssetCount: 1,
        caption: "first paragraph\n\nsecond paragraph",
        hashtags,
        scenes: [asset(1, 1920)]
      }),
      images: [{ index: 1, bytes: scene, mimeType: "image/png" as const, width: 1080 as const, height: 1920 as const }],
      source: { sourceMode: "topic_only" as const, fetchStatus: "no_source_url" as const, sourceText: null },
      reel: {
        cover: { bytes: cover, mimeType: "image/png" as const, width: 1080 as const, height: 1920 as const },
        video: {
          bytes: video,
          mimeType: "video/mp4" as const,
          width: 1080 as const,
          height: 1920 as const,
          videoCodec: "h264" as const,
          audioCodec: "aac" as const,
          fps: 30 as const
        }
      }
    };

    await storage.upload(job("instagram_reel"), rendered);

    const prefix = "brands/brand-1/topics/topic-1/instagram_reel/job-1";
    expect(vi.mocked(put).mock.calls.map(([pathname]) => pathname)).toEqual([
      `${prefix}/scene-01.png`,
      `${prefix}/cover.png`,
      `${prefix}/reel.mp4`,
      `${prefix}/manifest.json`
    ]);
    const manifest = JSON.parse(String(vi.mocked(put).mock.calls[3][1]));
    expect(manifest.scenes[0]).toMatchObject({ role: "role-1", checksum: checksum(scene) });
    expect(manifest.cover).toMatchObject({
      url: `https://blob.example.com/${prefix}/cover.png`,
      mimeType: "image/png",
      width: 1080,
      height: 1920,
      checksum: checksum(cover)
    });
    expect(manifest.video).toMatchObject({
      url: `https://blob.example.com/${prefix}/reel.mp4`,
      mimeType: "video/mp4",
      width: 1080,
      height: 1920,
      videoCodec: "h264",
      audioCodec: "aac",
      fps: 30,
      checksum: checksum(video)
    });
  });

  it("requires contentTopicId before making any Blob call", async () => {
    const storage = createBlobStorage({ token: "blob-token", model: "codex-imagegen" });
    const invalidJob = job("instagram_feed_carousel");
    delete invalidJob.payload.contentTopicId;

    await expect(storage.upload(invalidJob, renderedFeed()))
      .rejects.toThrow("blob_upload_failed:image_job_contentTopicId_required");
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects duplicate normalized image bytes before making any Blob call", async () => {
    const storage = createBlobStorage({ token: "blob-token", model: "codex-imagegen" });
    const rendered = renderedFeed();
    rendered.images[1].bytes = rendered.images[0].bytes;

    await expect(storage.upload(job("instagram_feed_carousel"), rendered))
      .rejects.toThrow("blob_upload_failed:asset_checksum_duplicate");
    expect(put).not.toHaveBeenCalled();
  });

  it("classifies Blob failures as worker upload errors", async () => {
    vi.mocked(put).mockRejectedValueOnce(new Error("Access denied"));
    const storage = createBlobStorage({ token: "blob-token", model: "codex-imagegen" });

    await expect(storage.upload(job("instagram_feed_carousel"), renderedFeed()))
      .rejects.toThrow("blob_upload_failed:Access denied");
  });
});

describe("V3 AI content Blob storage", () => {
  beforeEach(() => {
    vi.mocked(get).mockReset();
    vi.mocked(put).mockReset();
    vi.mocked(put).mockImplementation(async (pathname: string) => ({
      url: `https://blob.example.com/${pathname}`, downloadUrl: `https://blob.example.com/${pathname}?download=1`, pathname,
      etag: "etag", contentType: pathname.endsWith(".png") ? "image/png" : "application/json", contentDisposition: "inline",
    }));
  });

  it("reads only by owned pathname and idempotently reuses identical asset bytes", async () => {
    const bytes = await sharp({ create: { width: 1080, height: 1350, channels: 4, background: "white" } }).png().toBuffer();
    vi.mocked(get).mockImplementation(async () => ({ statusCode: 200, stream: new Blob([bytes]).stream(), headers: new Headers(), blob: { url: "https://blob.example.com/path", downloadUrl: "https://blob.example.com/path?download=1", pathname: "path", contentType: "image/png", size: bytes.length, uploadedAt: new Date() } } as never));
    const storage = createAiContentBlobStorage({ token: "token" });

    await expect(storage.readOwned("owned/input.png")).resolves.toEqual(bytes);
    await expect(storage.uploadAsset({ path: "path", bytes, index: 2, width: 1080, height: 1350 })).resolves.toMatchObject({ index: 2, url: "https://blob.example.com/path", storagePath: "path", checksum: checksum(bytes) });
    expect(get).toHaveBeenCalledWith("owned/input.png", expect.objectContaining({ token: "token", access: "public", useCache: false }));
    expect(put).not.toHaveBeenCalled();
  });

  it("normalizes legacy image metadata before a constrained owned read", async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: "white" } }).jpeg().toBuffer();
    vi.mocked(get).mockResolvedValue({
      statusCode: 200,
      stream: new Blob([bytes]).stream(),
      headers: new Headers(),
      blob: { url: "https://blob.example.com/input", downloadUrl: "", pathname: "owned/input.jpg", contentType: "IMAGE/JPG; charset=binary", size: bytes.length, uploadedAt: new Date() },
    } as never);
    const storage = createAiContentBlobStorage({ token: "token" });

    await expect(storage.readOwned("owned/input.jpg", {
      maxBytes: 5_000_000,
      expectedSizeBytes: bytes.length,
      expectedContentType: "image/jpeg",
    })).resolves.toEqual(bytes);
  });

  it("rejects a declared attachment above 5 MB before Blob lookup even if the caller supplies a larger maximum", async () => {
    const storage = createAiContentBlobStorage({ token: "token" });

    await expect(storage.readOwned("owned/input.png", {
      maxBytes: 6_000_000,
      expectedSizeBytes: 5_000_001,
      expectedContentType: "image/png",
    })).rejects.toThrow("ai_content_owned_blob_size_limit_exceeded");
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects oversized Blob metadata before accessing or consuming the stream", async () => {
    const streamAccess = vi.fn(() => { throw new Error("stream_must_not_be_accessed"); });
    const result = {
      statusCode: 200,
      get stream() { return streamAccess(); },
      headers: new Headers(),
      blob: { url: "https://blob.example.com/input", downloadUrl: "", pathname: "owned/input.png", contentType: "image/png", size: 5_000_001, uploadedAt: new Date() },
    };
    vi.mocked(get).mockResolvedValue(result as never);
    const storage = createAiContentBlobStorage({ token: "token" });

    await expect(storage.readOwned("owned/input.png", {
      maxBytes: 5_000_000,
      expectedSizeBytes: 1,
      expectedContentType: "image/png",
    })).rejects.toThrow("ai_content_owned_blob_size_limit_exceeded");
    expect(streamAccess).not.toHaveBeenCalled();
  });

  it.each([
    ["metadata size", { size: 4, contentType: "image/png" }, "ai_content_owned_blob_size_mismatch"],
    ["metadata content type", { size: 3, contentType: "image/webp" }, "ai_content_owned_blob_content_type_mismatch"],
  ])("rejects a constrained owned read with mismatched %s before reading bytes", async (_label, metadata, code) => {
    const streamAccess = vi.fn(() => { throw new Error("stream_must_not_be_accessed"); });
    vi.mocked(get).mockResolvedValue({
      statusCode: 200,
      get stream() { return streamAccess(); },
      headers: new Headers(),
      blob: { url: "https://blob.example.com/input", downloadUrl: "", pathname: "owned/input.png", ...metadata, uploadedAt: new Date() },
    } as never);
    const storage = createAiContentBlobStorage({ token: "token" });

    await expect(storage.readOwned("owned/input.png", {
      maxBytes: 5_000_000,
      expectedSizeBytes: 3,
      expectedContentType: "image/png",
    })).rejects.toThrow(code);
    expect(streamAccess).not.toHaveBeenCalled();
  });

  it("refuses to overwrite a deterministic asset when existing bytes differ", async () => {
    const existing = Buffer.from("existing");
    vi.mocked(get).mockResolvedValue({ statusCode: 200, stream: new Blob([existing]).stream(), headers: new Headers(), blob: { url: "https://blob.example.com/path", downloadUrl: "", pathname: "path", contentType: "image/png", size: existing.length, uploadedAt: new Date() } } as never);
    const storage = createAiContentBlobStorage({ token: "token" });

    await expect(storage.uploadAsset({ path: "path", bytes: Buffer.from("different"), index: 1, width: 1080, height: 1080 }))
      .rejects.toThrow("ai_content_asset_storage_conflict");
    expect(put).not.toHaveBeenCalled();
  });

  it("uploads absent assets without overwrite and returns immutable metadata", async () => {
    vi.mocked(get).mockResolvedValue(null);
    const bytes = Buffer.from("new");
    const storage = createAiContentBlobStorage({ token: "token" });
    await expect(storage.uploadAsset({ path: "ai-content/b/g/o/assets/02.png", bytes, index: 2, width: 1920, height: 1080 })).resolves.toMatchObject({ index: 2, width: 1920, height: 1080, checksum: checksum(bytes) });
    expect(put).toHaveBeenCalledWith("ai-content/b/g/o/assets/02.png", bytes, expect.objectContaining({ allowOverwrite: false, addRandomSuffix: false, contentType: "image/png" }));
  });

  it("uploads deterministic MP4 bytes and only reuses an identical existing video", async () => {
    const bytes = Buffer.from("silent-mp4");
    vi.mocked(get).mockResolvedValueOnce(null);
    const storage = createAiContentBlobStorage({ token: "token" });
    const video = { path: "ai-content/b/g/o/reel.mp4", bytes, width: 1080 as const, height: 1920 as const, durationSeconds: 8, videoCodec: "h264" as const, audioCodec: null, fps: 30 as const };
    await expect(storage.uploadVideo(video)).resolves.toMatchObject({
      url: "https://blob.example.com/ai-content/b/g/o/reel.mp4", checksum: checksum(bytes)
    });
    expect(put).toHaveBeenCalledWith("ai-content/b/g/o/reel.mp4", bytes, expect.objectContaining({ allowOverwrite: false, addRandomSuffix: false, contentType: "video/mp4" }));

    vi.mocked(get).mockResolvedValueOnce({ statusCode: 200, stream: new Blob([Buffer.from("different")]).stream(), headers: new Headers(), blob: { url: "https://blob.example.com/ai-content/b/g/o/reel.mp4", downloadUrl: "", pathname: "ai-content/b/g/o/reel.mp4", contentType: "video/mp4", size: 9, uploadedAt: new Date() } } as never);
    await expect(storage.uploadVideo(video)).rejects.toThrow("ai_content_package_storage_conflict");
  });

  it("recovers an identical canonical MP4 when a concurrent create wins after the initial miss", async () => {
    const bytes = Buffer.from("silent-mp4");
    const blob = { url: "https://blob.example.com/ai-content/b/g/o/reel.mp4", downloadUrl: "", pathname: "ai-content/b/g/o/reel.mp4", contentType: "video/mp4", size: bytes.length, uploadedAt: new Date() };
    vi.mocked(get).mockResolvedValueOnce(null).mockResolvedValueOnce({ statusCode: 200, stream: new Blob([bytes]).stream(), headers: new Headers(), blob } as never);
    vi.mocked(put).mockRejectedValueOnce(Object.assign(new Error("already exists"), { status: 409 }));
    const storage = createAiContentBlobStorage({ token: "token" });
    const video = { path: blob.pathname, bytes, width: 1080 as const, height: 1920 as const, durationSeconds: 8, videoCodec: "h264" as const, audioCodec: null, fps: 30 as const };

    await expect(storage.uploadVideo(video)).resolves.toEqual({ url: blob.url, checksum: checksum(bytes) });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("rejects a different canonical MP4 when a concurrent create wins after the initial miss", async () => {
    const bytes = Buffer.from("silent-mp4");
    const existing = Buffer.from("different");
    const blob = { url: "https://blob.example.com/reel.mp4", downloadUrl: "", pathname: "ai-content/b/g/o/reel.mp4", contentType: "video/mp4", size: existing.length, uploadedAt: new Date() };
    vi.mocked(get).mockResolvedValueOnce(null).mockResolvedValueOnce({ statusCode: 200, stream: new Blob([existing]).stream(), headers: new Headers(), blob } as never);
    vi.mocked(put).mockRejectedValueOnce(Object.assign(new Error("already exists"), { status: 409 }));
    const storage = createAiContentBlobStorage({ token: "token" });
    const video = { path: blob.pathname, bytes, width: 1080 as const, height: 1920 as const, durationSeconds: 8, videoCodec: "h264" as const, audioCodec: null, fps: 30 as const };

    await expect(storage.uploadVideo(video)).rejects.toThrow("ai_content_package_storage_conflict");
  });

  it.each([
    ["non-conflict put error", Object.assign(new Error("permission denied"), { status: 403 }), false],
    ["conflict without a canonical blob", Object.assign(new Error("already exists"), { status: 409 }), true]
  ])("rethrows the original %s", async (_name, failure, secondRead) => {
    const bytes = Buffer.from("silent-mp4");
    vi.mocked(get).mockResolvedValue(null);
    vi.mocked(put).mockRejectedValueOnce(failure);
    const storage = createAiContentBlobStorage({ token: "token" });
    const video = { path: "ai-content/b/g/o/reel.mp4", bytes, width: 1080 as const, height: 1920 as const, durationSeconds: 8, videoCodec: "h264" as const, audioCodec: null, fps: 30 as const };

    await expect(storage.uploadVideo(video)).rejects.toBe(failure);
    expect(get).toHaveBeenCalledTimes(secondRead ? 2 : 1);
  });
});
