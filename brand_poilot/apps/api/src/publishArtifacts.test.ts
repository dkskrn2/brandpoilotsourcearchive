import { describe, expect, it } from "vitest";
import { normalizePublishArtifact } from "./publishArtifacts";

describe("normalizePublishArtifact", () => {
  it("normalizes a card manifest as an image gallery", () => {
    expect(normalizePublishArtifact({
      manifest: {
        deliveryFormat: "instagram_feed_carousel",
        cards: [
          { url: "https://cdn.example/card-01.png", mimeType: "image/png", width: 1080, height: 1080 },
          { publicUrl: "https://cdn.example/card-02.png", width: 1080, height: 1080 }
        ]
      },
      outputJson: { caption: "Gallery caption" },
      fallbackTitle: "Result"
    })).toEqual({
      kind: "image_gallery",
      deliveryFormat: "instagram_feed_carousel",
      assets: [
        {
          url: "https://cdn.example/card-01.png",
          fileName: "card-01.png",
          mimeType: "image/png",
          width: 1080,
          height: 1080
        },
        {
          url: "https://cdn.example/card-02.png",
          fileName: "card-02.png",
          mimeType: "image/png",
          width: 1080,
          height: 1080
        }
      ],
      posterUrl: null,
      html: null,
      text: null
    });
  });

  it("normalizes a Story-shaped manifest as one image", () => {
    expect(normalizePublishArtifact({
      manifest: {
        deliveryFormat: "instagram_story",
        story: {
          url: "https://cdn.example/story.png",
          mimeType: "image/png",
          width: 1080,
          height: 1920
        }
      },
      outputJson: {},
      fallbackTitle: "Story"
    })).toMatchObject({
      kind: "image",
      deliveryFormat: "instagram_story",
      assets: [{ url: "https://cdn.example/story.png", fileName: "story.png", mimeType: "image/png" }],
      posterUrl: null,
      html: null,
      text: null
    });
  });

  it("normalizes video and cover without depending on a channel", () => {
    expect(normalizePublishArtifact({
      manifest: {
        deliveryFormat: "short_form_video",
        video: { url: "https://cdn.example/result.mp4", mimeType: "video/mp4", width: 1080, height: 1920 },
        cover: { url: "https://cdn.example/cover.png", mimeType: "image/png", width: 1080, height: 1920 }
      },
      outputJson: {},
      fallbackTitle: "Video"
    })).toEqual({
      kind: "video",
      deliveryFormat: "short_form_video",
      assets: [{
        url: "https://cdn.example/result.mp4",
        fileName: "result.mp4",
        mimeType: "video/mp4",
        width: 1080,
        height: 1920
      }],
      posterUrl: "https://cdn.example/cover.png",
      html: null,
      text: null
    });
  });

  it("normalizes inline HTML and an HTML file", () => {
    expect(normalizePublishArtifact({
      manifest: { deliveryFormat: "web_article", html: "<article>Hello</article>" },
      outputJson: {},
      fallbackTitle: "Article"
    })).toMatchObject({ kind: "html", assets: [], html: "<article>Hello</article>", text: null });

    expect(normalizePublishArtifact({
      manifest: { assets: [{ url: "https://cdn.example/article.html", mimeType: "text/html" }] },
      outputJson: {},
      fallbackTitle: "Article"
    })).toMatchObject({
      kind: "html",
      assets: [{ url: "https://cdn.example/article.html", fileName: "article.html", mimeType: "text/html" }],
      html: null,
      text: null
    });
  });

  it("falls back to output JSON for text", () => {
    expect(normalizePublishArtifact({
      manifest: null,
      outputJson: JSON.stringify({ deliveryFormat: "threads_text", body: "A useful update." }),
      fallbackTitle: "Update"
    })).toEqual({
      kind: "text",
      deliveryFormat: "threads_text",
      assets: [],
      posterUrl: null,
      html: null,
      text: "A useful update."
    });
  });

  it("preserves generic assets alongside text content", () => {
    expect(normalizePublishArtifact({
      manifest: {
        assets: [{ url: "https://cdn.example/source-data.bin", mimeType: "application/octet-stream" }]
      },
      outputJson: { deliveryFormat: "text_with_attachment", body: "Published copy" },
      fallbackTitle: "Update"
    })).toEqual({
      kind: "text",
      deliveryFormat: "text_with_attachment",
      assets: [{
        url: "https://cdn.example/source-data.bin",
        fileName: "source-data.bin",
        mimeType: "application/octet-stream",
        width: null,
        height: null
      }],
      posterUrl: null,
      html: null,
      text: "Published copy"
    });
  });

  it("preserves usable links and fallback text for an unknown shape", () => {
    expect(normalizePublishArtifact({
      manifest: { assets: [{ url: "https://cdn.example/archive.bin", mimeType: "application/octet-stream" }] },
      outputJson: { title: "Provider export" },
      fallbackTitle: "Result"
    })).toEqual({
      kind: "unknown",
      deliveryFormat: null,
      assets: [{
        url: "https://cdn.example/archive.bin",
        fileName: "archive.bin",
        mimeType: "application/octet-stream",
        width: null,
        height: null
      }],
      posterUrl: null,
      html: null,
      text: "Provider export"
    });
  });

  it("resolves relative browser assets and rejects unsafe or cross-origin URLs", () => {
    expect(normalizePublishArtifact({
      manifest: {
        images: [
          { url: "media/card.png", mimeType: "image/png" },
          { url: "https://other.example/card.png", mimeType: "image/png" },
          { url: "file:///private/card.png", mimeType: "image/png" }
        ]
      },
      outputJson: {},
      fallbackTitle: "Result",
      manifestUrl: "https://cdn.example/results/manifest.json",
      allowedRemoteOrigins: ["https://cdn.example"]
    })).toMatchObject({
      kind: "image",
      assets: [{ url: "https://cdn.example/results/media/card.png" }]
    });
  });
});
