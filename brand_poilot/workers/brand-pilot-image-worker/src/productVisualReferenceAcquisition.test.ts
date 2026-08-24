import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { acquireProductUrlReferences, extractProductImageCandidates, selectProductReferenceBudget } from "./productVisualReferenceAcquisition.js";

describe("product visual reference acquisition", () => {
  it("prefers Product JSON-LD and product gallery while excluding logo and related products", () => {
    const html = `
      <html><head>
        <meta property="og:image" content="/fallback.jpg">
        <script type="application/ld+json">{
          "@type":"Product","image":["/original-a.jpg","https://cdn.example/original-b.webp"]
        }</script>
      </head><body>
        <img class="site-logo" src="/logo.png">
        <div class="product-gallery"><img data-src="/gallery-large.jpg" src="/thumb.jpg"></div>
        <section class="related-products"><img src="/other-product.jpg"></section>
      </body></html>`;
    expect(extractProductImageCandidates(html, "https://shop.example/item/1")).toEqual([
      { sourcePageUrl: "https://shop.example/item/1", imageUrl: "https://shop.example/original-a.jpg", discoveryMethod: "json_ld" },
      { sourcePageUrl: "https://shop.example/item/1", imageUrl: "https://cdn.example/original-b.webp", discoveryMethod: "json_ld" },
      { sourcePageUrl: "https://shop.example/item/1", imageUrl: "https://shop.example/gallery-large.jpg", discoveryMethod: "product_gallery" },
      { sourcePageUrl: "https://shop.example/item/1", imageUrl: "https://shop.example/fallback.jpg", discoveryMethod: "open_graph" },
    ]);
  });

  it("uses product attachments, then registered images, then URL slots up to five", () => {
    expect(selectProductReferenceBudget({
      attachmentIds: ["a1", "a2"],
      registeredIds: ["r1", "r2", "r3", "r4"],
    })).toEqual({
      attachmentIds: ["a1", "a2"],
      registeredIds: ["r1", "r2", "r3"],
      urlSlots: 0,
    });
    expect(selectProductReferenceBudget({
      attachmentIds: ["a1"],
      registeredIds: ["r1", "r2"],
    })).toEqual({ attachmentIds: ["a1"], registeredIds: ["r1", "r2"], urlSlots: 2 });
  });

  it("deduplicates IDs without changing priority order", () => {
    expect(selectProductReferenceBudget({
      attachmentIds: ["a1", "a1"],
      registeredIds: ["r1", "r1"],
    })).toEqual({ attachmentIds: ["a1"], registeredIds: ["r1"], urlSlots: 3 });
  });

  it("excludes small and duplicate images before filling the bounded URL slots", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "product-visual-test-"));
    try {
      const small = await sharp({ create: { width: 100, height: 100, channels: 3, background: "red" } }).png().toBuffer();
      const first = await sharp({ create: { width: 600, height: 600, channels: 3, background: "green" } }).png().toBuffer();
      const second = await sharp({ create: { width: 700, height: 700, channels: 3, background: "blue" } }).png().toBuffer();
      const html = `<script type="application/ld+json">${JSON.stringify({
        "@type": "Product",
        image: ["https://cdn.example/small.png", "https://cdn.example/first.png", "https://cdn.example/duplicate.png", "https://cdn.example/second.png"],
      })}</script>`;
      const readResource = async (url: string) => {
        if (url.includes("shop.example")) return { status: "fetched" as const, finalUrl: url, mimeType: "text/html", bytes: new TextEncoder().encode(html) };
        const bytes = url.includes("small") ? small : url.includes("second") ? second : first;
        return { status: "fetched" as const, finalUrl: url, mimeType: "image/png", bytes };
      };
      const result = await acquireProductUrlReferences({
        snapshot: {
          contractVersion: "product-visual-source-snapshot.v1",
          productServiceId: "10000000-0000-4000-8000-000000000001",
          versionId: "10000000-0000-4000-8000-000000000002",
          kind: "product",
          sourceUrls: ["https://shop.example/item"],
        },
        slots: 2,
        inputDir: directory,
        readResource: readResource as never,
      });
      expect(result.references.map(({ candidate }) => candidate.imageUrl)).toEqual([
        "https://cdn.example/first.png", "https://cdn.example/second.png",
      ]);
      expect(result.events.map(({ reason }) => reason)).toEqual([
        "image_too_small_or_invalid", "url_fill", "duplicate_content", "url_fill",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
