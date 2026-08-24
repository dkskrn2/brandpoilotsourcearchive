import { describe, expect, it } from "vitest";
import {
  parseProductVisualReferenceSnapshotV1,
  parseProductVisualSourceSnapshotV1,
} from "./productVisualReferences.js";

const productId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";

describe("product visual reference private contracts", () => {
  it("accepts and clones a bounded product source snapshot", () => {
    const input = {
      contractVersion: "product-visual-source-snapshot.v1" as const,
      productServiceId: productId,
      versionId,
      kind: "product" as const,
      sourceUrls: ["https://shop.example.com/items/coffee"],
    };
    const parsed = parseProductVisualSourceSnapshotV1(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
  });

  it.each([
    ["credentials", "https://user:pass@shop.example.com/item"],
    ["fragment", "https://shop.example.com/item#secret"],
    ["non-https", "http://shop.example.com/item"],
  ])("rejects unsafe %s source URLs", (_label, sourceUrl) => {
    expect(() => parseProductVisualSourceSnapshotV1({
      contractVersion: "product-visual-source-snapshot.v1",
      productServiceId: productId,
      versionId,
      kind: "product",
      sourceUrls: [sourceUrl],
    })).toThrow("product_visual_source_snapshot_invalid");
  });

  it("requires unique source URLs", () => {
    expect(() => parseProductVisualSourceSnapshotV1({
      contractVersion: "product-visual-source-snapshot.v1",
      productServiceId: productId,
      versionId,
      kind: "product",
      sourceUrls: ["https://shop.example.com/item", "https://shop.example.com/item"],
    })).toThrow("product_visual_source_snapshot_invalid");
  });

  it("records selected and excluded URL candidates without local paths", () => {
    const parsed = parseProductVisualReferenceSnapshotV1({
      contractVersion: "product-visual-reference-snapshot.v1",
      sourceSnapshot: {
        contractVersion: "product-visual-source-snapshot.v1",
        productServiceId: productId,
        versionId,
        kind: "product",
        sourceUrls: ["https://shop.example.com/item"],
      },
      candidates: [{
        candidateId: "a".repeat(64),
        sourcePageUrl: "https://shop.example.com/item",
        imageUrl: "https://cdn.example.com/product.webp",
        discoveryMethod: "json_ld",
        mimeType: "image/webp",
        width: 1200,
        height: 1200,
        contentSha256: "b".repeat(64),
        decision: "selected",
        reason: "url_fill",
      }],
      finalReferences: [{
        sourceType: "url",
        referenceId: "a".repeat(64),
        rank: 1,
        reason: "url_fill",
      }],
    });
    expect(parsed.finalReferences).toHaveLength(1);
  });

  it("rejects more than five final product references", () => {
    expect(() => parseProductVisualReferenceSnapshotV1({
      contractVersion: "product-visual-reference-snapshot.v1",
      sourceSnapshot: null,
      candidates: [],
      finalReferences: Array.from({ length: 6 }, (_, index) => ({
        sourceType: "registered",
        referenceId: `${index + 1}`.repeat(64).slice(0, 64),
        rank: index + 1,
        reason: "registered_product_image",
      })),
    })).toThrow("product_visual_reference_snapshot_invalid");
  });
});
