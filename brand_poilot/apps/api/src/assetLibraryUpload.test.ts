import { describe, expect, it, vi } from "vitest";
import {
  ASSET_LIBRARY_REFERENCE_POLICY,
  buildAssetLibraryPath,
  confirmAssetLibraryUpload,
  issueAssetLibraryUploadToken,
  validateAssetLibraryUpload,
} from "./assetLibraryUpload.js";

const brandId = "22222222-2222-4222-8222-222222222222";
const sessionId = "44444444-4444-4444-8444-444444444444";
const checksum = "a".repeat(64);

describe("asset library uploads", () => {
  it("uses a dedicated namespace and avatar policy", async () => {
    expect(validateAssetLibraryUpload("avatar", {
      fileName: "face.webp", mimeType: "image/webp", sizeBytes: 5 * 1024 * 1024, checksum,
    }).mimeType).toBe("image/webp");
    expect(() => validateAssetLibraryUpload("avatar", {
      fileName: "face.png", mimeType: "image/png", sizeBytes: 5 * 1024 * 1024 + 1, checksum,
    })).toThrow("asset_library_upload_size_invalid");
    expect(buildAssetLibraryPath({
      brandId, avatarId: "55555555-5555-4555-8555-555555555555",
      sessionId, kind: "avatar", checksum, fileName: "face.webp",
    })).toBe(`brands/${brandId}/asset-library/avatars/55555555-5555-4555-8555-555555555555/${sessionId}/${checksum}-face.webp`);
  });

  it("has an explicit general allowlist that excludes HTML and executables", () => {
    expect(Object.keys(ASSET_LIBRARY_REFERENCE_POLICY)).toContain("application/pdf");
    for (const mimeType of ["text/html", "application/javascript", "application/x-msdownload"]) {
      expect(() => validateAssetLibraryUpload("reference", {
        fileName: "unsafe.bin", mimeType, sizeBytes: 100, checksum,
      })).toThrow("asset_library_upload_mime_invalid");
    }
  });

  it("issues a scoped token for the exact validated path", async () => {
    const generateClientToken = vi.fn(async () => "client-token");
    const result = await issueAssetLibraryUploadToken({
      brandId, sessionId, kind: "reference",
      upload: { fileName: "brief.pdf", mimeType: "application/pdf", sizeBytes: 500, checksum },
    }, { token: "rw-token", generateClientToken });
    expect(result.pathname).toContain("/asset-library/references/");
    expect(generateClientToken).toHaveBeenCalledWith(expect.objectContaining({
      pathname: result.pathname,
      allowedContentTypes: ["application/pdf"],
      allowOverwrite: false,
    }));
  });

  it.each([
    ["nonce replay", { confirmedAt: new Date().toISOString() }, "asset_library_upload_replayed"],
    ["wrong nonce", { nonce: "different-nonce-1234" }, "asset_library_upload_nonce_mismatch"],
    ["expired session", { expiresAt: new Date(Date.now() - 1).toISOString() }, "asset_library_upload_expired"],
    ["wrong tenant path", { storagePath: `brands/99999999-9999-4999-8999-999999999999/asset-library/references/${sessionId}/${checksum}-brief.pdf` }, "asset_library_upload_path_mismatch"],
    ["MIME spoof", { mimeType: "text/plain" }, "asset_library_upload_mime_mismatch"],
  ])("rejects %s during confirm", async (_label, override, error) => {
    const expectedPath = buildAssetLibraryPath({
      brandId, sessionId, kind: "reference", checksum, fileName: "brief.pdf",
    });
    const base = {
      session: {
        id: sessionId, workspaceId: "11111111-1111-4111-8111-111111111111", brandId,
        kind: "reference" as const, nonce: "valid-nonce-123456",
        fileName: "brief.pdf", expectedMimeType: "application/pdf",
        expectedSizeBytes: 500, expectedChecksum: checksum,
        storagePathPrefix: `brands/${brandId}/asset-library/references/${sessionId}/`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(), confirmedAt: null,
      },
      nonce: "valid-nonce-123456", storagePath: expectedPath,
      storageUrl: `https://store.blob.vercel-storage.com/${expectedPath}`,
      mimeType: "application/pdf", sizeBytes: 500, checksum,
    };
    await expect(confirmAssetLibraryUpload(
      { ...base, ...override, session: { ...base.session, ...("confirmedAt" in override || "expiresAt" in override ? override : {}) } },
      { token: "rw-token", headBlob: vi.fn(async () => ({
        url: base.storageUrl, downloadUrl: base.storageUrl, pathname: expectedPath,
        size: 500, uploadedAt: new Date(), contentType: "application/pdf", contentDisposition: "inline",
        cacheControl: "public, max-age=0", etag: "etag",
      })) },
    )).rejects.toThrow(error);
  });
});
