import { describe, expect, it, vi } from "vitest";
import {
  AI_CONTENT_ATTACHMENT_POLICY,
  buildAiContentAttachmentPath,
  confirmAiContentAttachment,
  issueAiContentAttachmentToken,
  verifyAiContentAttachmentBlob,
  validateAiContentAttachment
} from "./aiContentUpload.js";

const base = {
  role: "product" as const,
  fileName: "product-photo.png",
  mimeType: "image/png",
  sizeBytes: 5_000_000,
  checksum: "a".repeat(64)
};

describe("AI content attachment upload policy", () => {
  it("exports the MIME, role, and size policy used by attachment consumers", () => {
    expect(AI_CONTENT_ATTACHMENT_POLICY.product).toEqual({
      "image/png": 5_000_000,
      "image/jpeg": 5_000_000,
    });
    expect(AI_CONTENT_ATTACHMENT_POLICY.document).toMatchObject({
      "application/pdf": 10_000_000,
      "text/plain": 5_000_000,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": 10_000_000,
    });
  });

  it.each([
    ["product", "image/png", 5_000_000, true],
    ["person", "image/jpeg", 5_000_000, true],
    ["scale", "image/png", 5_000_001, false],
    ["visual_reference", "image/jpeg", 5_000_001, false],
    ["document", "application/pdf", 10_000_000, true],
    ["document", "text/plain", 5_000_000, true],
    ["document", "text/markdown", 5_000_000, true],
    ["document", "text/csv", 5_000_000, true],
    ["document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 10_000_000, true],
    ["document", "text/plain", 5_000_001, false],
    ["document", "application/pdf", 10_000_001, false],
    ["document", "application/x-msdownload", 1_000, false],
  ] as const)("validates %s attachments with MIME %s and %d bytes", (role, mimeType, sizeBytes, allowed) => {
    const action = () => validateAiContentAttachment({ ...base, role, mimeType, sizeBytes });
    allowed ? expect(action).not.toThrow() : expect(action).toThrow();
  });

  it.each([
    ["document", "image/png"],
    ["product", "application/pdf"],
    ["person", "text/plain"],
    ["scale", "text/markdown"],
    ["visual_reference", "text/csv"],
    ["product", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ] as const)("rejects role %s with MIME %s", (role, mimeType) => {
    expect(() => validateAiContentAttachment({ ...base, role, mimeType })).toThrow("ai_content_attachment_role_mime_invalid");
  });

  it("rejects unknown roles, unsafe names, and invalid checksums", () => {
    expect(() => validateAiContentAttachment({ ...base, role: "unknown" as never })).toThrow("ai_content_attachment_role_invalid");
    expect(() => validateAiContentAttachment({ ...base, fileName: "../secret.png" })).toThrow("ai_content_attachment_file_name_invalid");
    expect(() => validateAiContentAttachment({ ...base, checksum: "not-a-sha256" })).toThrow("ai_content_attachment_checksum_invalid");
  });

  it("builds a deterministic server-owned path", () => {
    expect(buildAiContentAttachmentPath({
      brandId: "11111111-1111-4111-8111-111111111111",
      generationId: "22222222-2222-4222-8222-222222222222",
      checksum: base.checksum,
      fileName: base.fileName
    })).toBe("brands/11111111-1111-4111-8111-111111111111/ai-content/22222222-2222-4222-8222-222222222222/attachments/" + "a".repeat(64) + "-product-photo.png");
  });

  it("issues a token constrained to the computed path", async () => {
    const generate = vi.fn(async (options: any) => {
      expect(options.pathname).toContain("/attachments/");
      expect(options.allowedContentTypes).toEqual(["image/png"]);
      expect(options.maximumSizeInBytes).toBe(5_000_000);
      expect(options.addRandomSuffix).toBe(false);
      expect(options.allowOverwrite).toBe(false);
      return "client-token";
    });
    const result = await issueAiContentAttachmentToken({ brandId: "11111111-1111-4111-8111-111111111111", generationId: "22222222-2222-4222-8222-222222222222", attachment: base }, { token: "read-write", generateClientToken: generate });
    expect(result.clientToken).toBe("client-token");
    expect(generate).toHaveBeenCalledOnce();
  });

  it("rejects token issuance when Blob storage is not configured", async () => {
    await expect(issueAiContentAttachmentToken({
      brandId: "11111111-1111-4111-8111-111111111111",
      generationId: "22222222-2222-4222-8222-222222222222",
      attachment: base,
    }, { token: "" })).rejects.toThrow("ai_content_attachment_storage_not_configured");
  });

  it("confirms only the exact server-owned path and URL", () => {
    const path = buildAiContentAttachmentPath({ brandId: "11111111-1111-4111-8111-111111111111", generationId: "22222222-2222-4222-8222-222222222222", checksum: base.checksum, fileName: base.fileName });
    const confirmed = confirmAiContentAttachment({ brandId: "11111111-1111-4111-8111-111111111111", generationId: "22222222-2222-4222-8222-222222222222", attachment: base, storagePath: path, storageUrl: `https://blob.vercel-storage.com/${path}` });
    expect(confirmed.storagePath).toBe(path);
    expect(() => confirmAiContentAttachment({ brandId: "11111111-1111-4111-8111-111111111111", generationId: "22222222-2222-4222-8222-222222222222", attachment: base, storagePath: `${path}/other`, storageUrl: `https://blob.vercel-storage.com/${path}` })).toThrow("ai_content_attachment_path_mismatch");
    expect(() => confirmAiContentAttachment({ brandId: "11111111-1111-4111-8111-111111111111", generationId: "22222222-2222-4222-8222-222222222222", attachment: base, storagePath: path, storageUrl: `https://blob.vercel-storage.com/brands/other/${path}` })).toThrow("ai_content_attachment_url_mismatch");
    expect(() => confirmAiContentAttachment({ brandId: "11111111-1111-4111-8111-111111111111", generationId: "22222222-2222-4222-8222-222222222222", attachment: base, storagePath: path, storageUrl: `https://evil.example/${path}` })).toThrow("ai_content_attachment_url_mismatch");
  });

  it("verifies the uploaded Blob exists with the confirmed path, size, and MIME", async () => {
    const path = buildAiContentAttachmentPath({ brandId: "11111111-1111-4111-8111-111111111111", generationId: "22222222-2222-4222-8222-222222222222", checksum: base.checksum, fileName: base.fileName });
    const confirmed = confirmAiContentAttachment({ brandId: "11111111-1111-4111-8111-111111111111", generationId: "22222222-2222-4222-8222-222222222222", attachment: base, storagePath: path, storageUrl: `https://test.public.blob.vercel-storage.com/${path}` });
    const headBlob = vi.fn(async () => ({ pathname: path, size: base.sizeBytes, contentType: base.mimeType } as never));
    await expect(verifyAiContentAttachmentBlob(confirmed, { token: "rw-token", headBlob })).resolves.toEqual(confirmed);
    headBlob.mockResolvedValueOnce({ pathname: path, size: 1, contentType: base.mimeType } as never);
    await expect(verifyAiContentAttachmentBlob(confirmed, { token: "rw-token", headBlob })).rejects.toThrow("ai_content_attachment_size_mismatch");
  });
});
