import { describe, expect, it } from "vitest";
import {
  classifyInstagramTrendKind,
  isFreshInstagramTrendCache,
  mapMetaTopMedia,
  normalizeInstagramHashtag
} from "./instagramTrend";

describe("normalizeInstagramHashtag", () => {
  it.each([
    ["  #Brand_Name  ", { displayTag: "Brand_Name", normalizedTag: "brand_name" }],
    ["#브랜드", { displayTag: "브랜드", normalizedTag: "브랜드" }],
    ["＃ＦＯＯ", { displayTag: "FOO", normalizedTag: "foo" }],
    ["123", { displayTag: "123", normalizedTag: "123" }],
    ["가".repeat(100), { displayTag: "가".repeat(100), normalizedTag: "가".repeat(100) }]
  ])("normalizes %s", (input, expected) => {
    expect(normalizeInstagramHashtag(input)).toEqual(expected);
  });

  it.each(["", "#", "##tag", "tag name", "tag🙂", "tag/tag", "tag#other", "a".repeat(101)])(
    "rejects invalid hashtag %j",
    (input) => expect(() => normalizeInstagramHashtag(input)).toThrow("invalid_hashtag")
  );
});

describe("isFreshInstagramTrendCache", () => {
  const now = new Date("2026-07-15T00:00:00.000Z");

  it("accepts only nonnegative ages strictly below 24 hours", () => {
    expect(isFreshInstagramTrendCache(new Date("2026-07-14T12:00:00.001Z"), now)).toBe(true);
    expect(isFreshInstagramTrendCache(new Date("2026-07-15T00:00:00.000Z"), now)).toBe(true);
    expect(isFreshInstagramTrendCache(new Date("2026-07-14T00:00:00.000Z"), now)).toBe(false);
    expect(isFreshInstagramTrendCache(new Date("2026-07-15T00:00:00.001Z"), now)).toBe(false);
    expect(isFreshInstagramTrendCache(null, now)).toBe(false);
    expect(isFreshInstagramTrendCache("not-a-date", now)).toBe(false);
  });
});

describe("classifyInstagramTrendKind", () => {
  it("classifies image, carousel, reels, and other video media", () => {
    expect(classifyInstagramTrendKind("IMAGE", "https://instagram.com/p/abc")).toBe("image");
    expect(classifyInstagramTrendKind("CAROUSEL_ALBUM", "https://instagram.com/p/abc")).toBe("carousel");
    expect(classifyInstagramTrendKind("VIDEO", "https://instagram.com/reel/abc123/?x=1")).toBe("reel");
    expect(classifyInstagramTrendKind("VIDEO", "https://instagram.com/reel/abc123/extra")).toBe("video");
    expect(classifyInstagramTrendKind("VIDEO", "https://instagram.com/reels/abc123")).toBe("video");
    expect(classifyInstagramTrendKind("VIDEO", "not a url")).toBe("video");
  });
});

describe("mapMetaTopMedia", () => {
  it("maps typed fields, nullable counts, carousel preview, and contiguous ranks", () => {
    const payload = {
      data: [
        { id: "", media_type: "IMAGE", permalink: "https://instagram.com/p/bad" },
        { id: "1", media_type: "IMAGE", permalink: "https://instagram.com/p/1", username: "brand", caption: "hello", media_url: "https://cdn/1.jpg", timestamp: "2026-07-14T00:00:00Z", like_count: 3.9, comments_count: null },
        { id: "1", media_type: "VIDEO", permalink: "https://instagram.com/p/duplicate" },
        { id: "2", media_type: "CAROUSEL_ALBUM", permalink: "https://instagram.com/p/2", media_url: "https://cdn/fallback.jpg", children: { data: [{ media_url: "https://cdn/child.jpg" }, { media_url: 42 }] } },
        { id: "3", media_type: "VIDEO", permalink: "https://instagram.com/reel/reel-id", media_url: "https://cdn/reel.mp4", like_count: -1, comments_count: Infinity }
      ]
    };
    const original = structuredClone(payload);

    expect(mapMetaTopMedia(payload)).toEqual([
      {
        instagramMediaId: "1",
        username: "brand",
        caption: "hello",
        mediaType: "IMAGE",
        mediaUrl: "https://cdn/1.jpg",
        previewUrl: "https://cdn/1.jpg",
        permalink: "https://instagram.com/p/1",
        postedAt: "2026-07-14T00:00:00Z",
        likeCount: null,
        commentsCount: null,
        kind: "image",
        metaRank: 1,
        rawMetadata: expect.any(Object)
      },
      {
        instagramMediaId: "2",
        username: null,
        caption: null,
        mediaType: "CAROUSEL_ALBUM",
        mediaUrl: "https://cdn/fallback.jpg",
        previewUrl: "https://cdn/child.jpg",
        permalink: "https://instagram.com/p/2",
        postedAt: null,
        likeCount: null,
        commentsCount: null,
        kind: "carousel",
        metaRank: 2,
        rawMetadata: expect.any(Object)
      },
      {
        instagramMediaId: "3",
        username: null,
        caption: null,
        mediaType: "VIDEO",
        mediaUrl: "https://cdn/reel.mp4",
        previewUrl: "https://cdn/reel.mp4",
        permalink: "https://instagram.com/reel/reel-id",
        postedAt: null,
        likeCount: null,
        commentsCount: null,
        kind: "reel",
        metaRank: 3,
        rawMetadata: expect.any(Object)
      }
    ]);
    expect(payload).toEqual(original);
  });

  it("limits output to the first 50 valid unique rows", () => {
    const data = Array.from({ length: 51 }, (_, index) => ({
      id: String(index), media_type: "IMAGE", permalink: `https://instagram.com/p/${index}`
    }));
    const result = mapMetaTopMedia({ data });
    expect(result).toHaveLength(50);
    expect(result.at(-1)?.instagramMediaId).toBe("49");
    expect(result.at(-1)?.metaRank).toBe(50);
  });

  it("continues after a non-record row", () => {
    expect(mapMetaTopMedia({
      data: [null, { id: "after", media_type: "IMAGE", permalink: "https://instagram.com/p/after" }]
    })).toHaveLength(1);
  });

  it("uses a child thumbnail when no child has a media URL", () => {
    const [media] = mapMetaTopMedia({
      data: [{
        id: "carousel-thumbnail",
        media_type: "CAROUSEL_ALBUM",
        permalink: "https://instagram.com/p/carousel-thumbnail",
        media_url: "https://cdn/top-level.jpg",
        children: { data: [{ thumbnail_url: "https://cdn/child-thumbnail.jpg" }] }
      }]
    });
    expect(media?.previewUrl).toBe("https://cdn/child-thumbnail.jpg");
  });

  it("falls back to top-level media instead of top-level thumbnail", () => {
    const [media] = mapMetaTopMedia({
      data: [{
        id: "carousel-media",
        media_type: "CAROUSEL_ALBUM",
        permalink: "https://instagram.com/p/carousel-media",
        media_url: "https://cdn/top-level.jpg",
        thumbnail_url: "https://cdn/top-level-thumbnail.jpg",
        children: { data: [{}] }
      }]
    });
    expect(media?.previewUrl).toBe("https://cdn/top-level.jpg");
  });

  it("retains valid nonnegative integer counts", () => {
    const [media] = mapMetaTopMedia({
      data: [{
        id: "counts",
        media_type: "IMAGE",
        permalink: "https://instagram.com/p/counts",
        like_count: 0,
        comments_count: 42
      }]
    });
    expect(media?.likeCount).toBe(0);
    expect(media?.commentsCount).toBe(42);
  });

  it("skips rows with missing or blank permalinks", () => {
    expect(mapMetaTopMedia({
      data: [
        { id: "missing", media_type: "IMAGE" },
        { id: "blank", media_type: "IMAGE", permalink: "   " }
      ]
    })).toEqual([]);
  });

  it("retains representative raw metadata without mutating input", () => {
    const payload = {
      data: [{
        id: "raw",
        media_type: "CAROUSEL_ALBUM",
        permalink: "https://instagram.com/p/raw",
        caption: "source caption",
        children: { data: [{ id: "child", media_url: "https://cdn/child.jpg" }] }
      }]
    };
    const original = structuredClone(payload);

    const [media] = mapMetaTopMedia(payload);

    expect(media?.rawMetadata).toEqual(expect.objectContaining({
      id: "raw",
      caption: "source caption",
      children: { data: [{ id: "child", media_url: "https://cdn/child.jpg" }] }
    }));
    expect(payload).toEqual(original);
  });

  it("safely handles unknown payloads and invalid rows", () => {
    expect(mapMetaTopMedia(null)).toEqual([]);
    expect(mapMetaTopMedia({ data: [{ id: "x", media_type: "AUDIO", permalink: "https://x" }] })).toEqual([]);
  });
});
