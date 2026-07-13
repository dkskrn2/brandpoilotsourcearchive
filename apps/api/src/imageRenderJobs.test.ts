import { describe, expect, it, vi } from "vitest";
import {
  buildImageRenderJobPayload,
  parseImageRenderJobResult,
  validateImageRenderJobResultAssets
} from "./imageRenderJobs";

const topic = {
  title: "제주 가족여행 숙소 선택법",
  angle: "이동 동선 중심 숙소 선택",
  targetCustomer: "아이와 제주를 여행하는 가족",
  region: "제주",
  season: null,
  notes: null
};

const brand = {
  name: "제주 여행 연구소",
  industry: "여행 상담",
  primaryCustomer: "제주 가족 여행자",
  description: "제주 일정과 숙소 동선을 상담합니다.",
  tone: "친절하지만 과장 없는 전문가 톤",
  brandColor: "파란색"
};

const hashtags = ["#제주여행", "#가족여행", "#제주숙소", "#여행동선", "#여행준비"];

function pngAsset(index: number, role: string, width: number, height: number, name: string) {
  return {
    index,
    role,
    url: `https://blob.example.com/rendered-content/instagram/brand-1/output-1/job-1/${name}`,
    mimeType: "image/png",
    width,
    height
  };
}

function commonResult(selectedAssetCount: number) {
  return {
    jobId: "job-1",
    channelOutputId: "output-1",
    model: "fixture",
    sourceMode: "direct_url",
    fetchStatus: "fetched",
    selectedAssetCount,
    validation: { passed: true }
  } as const;
}

function feedResultWith(count: number) {
  return {
    ...commonResult(count),
    deliveryFormat: "instagram_feed_carousel",
    promptVersion: "worker-card.v4",
    title: "숙소 후기보다 먼저 볼 것",
    caption: "가족여행은 숙소 평점보다 이동 동선이 중요합니다.",
    hashtags,
    cards: Array.from({ length: count }, (_, index) => pngAsset(
      index + 1,
      `role-${index + 1}`,
      1080,
      1080,
      `card-${String(index + 1).padStart(2, "0")}.png`
    ))
  };
}

describe("image render job contract", () => {
  it.each([
    ["instagram_feed_carousel", "worker-card.v4"],
    ["instagram_story", "worker-story.v1"],
    ["instagram_reel", "worker-reel.v1"]
  ] as const)("creates the minimal %s payload", (deliveryFormat, promptVersion) => {
    const payload = buildImageRenderJobPayload({
      deliveryFormat,
      topic,
      brand,
      crawlContentUrl: "https://brand.example.com/articles/jeju-route",
      referenceUrl: "https://reference.example.com/jeju"
    });

    expect(payload).toEqual({
      deliveryFormat,
      promptVersion,
      topic,
      brand,
      representativeUrl: "https://brand.example.com/articles/jeju-route",
      maxImages: 5
    });
    expect(JSON.stringify(payload)).not.toMatch(/rawText|raw_text|extractedText|extracted_text/);
  });

  it("falls back to one valid topic reference URL", () => {
    const payload = buildImageRenderJobPayload({
      deliveryFormat: "instagram_story",
      topic,
      brand,
      crawlContentUrl: "file:///private/crawl.txt",
      referenceUrl: "http://reference.example.com/story"
    });

    expect(payload.representativeUrl).toBe("http://reference.example.com/story");
  });

  it("accepts a valid feed result", () => {
    const result = parseImageRenderJobResult(feedResultWith(2), {
      jobId: "job-1",
      channelOutputId: "output-1",
      deliveryFormat: "instagram_feed_carousel"
    });

    expect(result.deliveryFormat).toBe("instagram_feed_carousel");
    if (result.deliveryFormat !== "instagram_feed_carousel") throw new Error("unexpected_format");
    expect(result.cards).toHaveLength(2);
    expect(result.hashtags).toEqual(hashtags);
  });

  it("accepts exactly one vertical Story image", () => {
    const result = parseImageRenderJobResult({
      ...commonResult(1),
      deliveryFormat: "instagram_story",
      promptVersion: "worker-story.v1",
      story: pngAsset(1, "story", 1080, 1920, "story.png")
    });

    expect(result).toMatchObject({
      deliveryFormat: "instagram_story",
      selectedAssetCount: 1,
      story: { width: 1080, height: 1920, mimeType: "image/png" }
    });
  });

  it("accepts vertical Reel scenes, cover, and H.264/AAC MP4", () => {
    const result = parseImageRenderJobResult({
      ...commonResult(2),
      deliveryFormat: "instagram_reel",
      promptVersion: "worker-reel.v1",
      scenes: [
        pngAsset(1, "hook", 1080, 1920, "scene-01.png"),
        pngAsset(2, "proof", 1080, 1920, "scene-02.png")
      ],
      cover: {
        url: "https://blob.example.com/rendered-content/instagram/brand-1/output-1/job-1/cover.png",
        mimeType: "image/png",
        width: 1080,
        height: 1920
      },
      video: {
        url: "https://blob.example.com/rendered-content/instagram/brand-1/output-1/job-1/reel.mp4",
        mimeType: "video/mp4",
        width: 1080,
        height: 1920,
        videoCodec: "h264",
        audioCodec: "aac",
        fps: 30
      }
    });

    expect(result).toMatchObject({
      deliveryFormat: "instagram_reel",
      selectedAssetCount: 2,
      video: { videoCodec: "h264", audioCodec: "aac", fps: 30 }
    });
  });

  it("rejects a reel result without video and cover", () => {
    expect(() => parseImageRenderJobResult({
      deliveryFormat: "instagram_reel",
      promptVersion: "worker-reel.v1",
      sourceMode: "direct_url",
      fetchStatus: "fetched",
      selectedAssetCount: 2,
      validation: { passed: true },
      scenes: [
        { url: "https://blob.example.com/1.png", role: "hook" },
        { url: "https://blob.example.com/2.png", role: "proof" }
      ]
    })).toThrow("reel_video_required");
  });

  it("rejects more than five carousel cards", () => {
    expect(() => parseImageRenderJobResult(feedResultWith(6))).toThrow("asset_count_out_of_range");
  });

  it("rejects duplicate roles and worker results that did not pass validation", () => {
    const duplicateRoles = feedResultWith(2);
    duplicateRoles.cards[1].role = " ROLE-1 ";
    expect(() => parseImageRenderJobResult(duplicateRoles)).toThrow("asset_role_duplicate");

    expect(() => parseImageRenderJobResult({
      ...feedResultWith(1),
      validation: { passed: false }
    })).toThrow("worker_validation_required");
  });

  it("keeps every accepted asset under the manifest prefix with the expected MIME type", async () => {
    const result = parseImageRenderJobResult(feedResultWith(1));
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 200,
      headers: { "content-type": "image/png" }
    }));

    await expect(validateImageRenderJobResultAssets({
      manifestUrl: "https://blob.example.com/rendered-content/instagram/brand-1/output-1/job-1/manifest.json",
      storagePrefix: "rendered-content/instagram/brand-1/output-1/job-1",
      result,
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await expect(validateImageRenderJobResultAssets({
      manifestUrl: "https://blob.example.com/other/manifest.json",
      storagePrefix: "rendered-content/instagram/brand-1/output-1/job-1",
      result,
      fetchImpl: fetchImpl as typeof fetch
    })).rejects.toThrow("image_manifest_path_invalid");

    const wrongFileName = parseImageRenderJobResult(feedResultWith(1));
    if (wrongFileName.deliveryFormat !== "instagram_feed_carousel") throw new Error("unexpected_format");
    wrongFileName.cards[0].url = "https://blob.example.com/rendered-content/instagram/brand-1/output-1/job-1/arbitrary.png";
    await expect(validateImageRenderJobResultAssets({
      manifestUrl: "https://blob.example.com/rendered-content/instagram/brand-1/output-1/job-1/manifest.json",
      storagePrefix: "rendered-content/instagram/brand-1/output-1/job-1",
      result: wrongFileName,
      fetchImpl: fetchImpl as typeof fetch
    })).rejects.toThrow("image_manifest_asset_path_invalid");
  });
});
