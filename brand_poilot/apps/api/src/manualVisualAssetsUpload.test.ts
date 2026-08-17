import { describe, expect, it } from "vitest";
import {
  buildManualVisualAssetPath,
  validateManualVisualAssetUpload,
} from "./manualVisualAssetsUpload.js";

const brandId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const checksum = "a".repeat(64);

describe("manual visual asset uploads", () => {
  it("uses an exact product owner/session path", () => {
    expect(buildManualVisualAssetPath({
      kind: "product",
      brandId,
      ownerId,
      sessionId,
      checksum,
      fileName: "reference image.webp",
    })).toBe(`brands/${brandId}/asset-library/products/${ownerId}/${sessionId}/${checksum}-reference-image.webp`);
  });

  it("does not expose an unused style upload namespace", () => {
    expect(() => buildManualVisualAssetPath({
      kind: "style" as never, brandId, ownerId, sessionId, checksum, fileName: "style.webp",
    })).toThrow("asset_library_upload_scope_invalid");
  });

  it("allows only safe image bytes up to 5 MB", () => {
    expect(validateManualVisualAssetUpload("product", {
      fileName: "hero.webp",
      mimeType: "image/webp",
      sizeBytes: 5 * 1024 * 1024,
      checksum,
    }).mimeType).toBe("image/webp");
    expect(() => validateManualVisualAssetUpload("product", {
      fileName: "brief.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      checksum,
    })).toThrow("asset_library_upload_mime_invalid");
    expect(() => validateManualVisualAssetUpload("product", {
      fileName: "large.png",
      mimeType: "image/png",
      sizeBytes: 5 * 1024 * 1024 + 1,
      checksum,
    })).toThrow("asset_library_upload_size_invalid");
  });
});
