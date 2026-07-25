import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseWorkerManifest } from "./manifest.js";
import { createBlobStorage } from "./storage.js";
import type { ClaimedImageJob, RenderedInstagramPackage } from "./worker.js";

vi.mock("@vercel/blob", () => ({ put: vi.fn() }));

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
