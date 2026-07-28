import { describe, expect, it, vi } from "vitest";
import { BlobNotFoundError } from "@vercel/blob";
import {
  parseAiContentAttachmentId,
  parseAiContentGenerationId,
  parseAiContentUploadSessionId,
  parseCancelUploadSessionInput,
  parseConfirmAttachmentInput,
  parseLegacyConfirmAttachmentInput,
} from "./aiContentContracts.js";
import {
  AI_CONTENT_ATTACHMENT_POLICY,
  AI_CONTENT_TOTAL_ATTACHMENT_LIMIT,
  AI_CONTENT_UPLOAD_SESSION_TTL_MS,
  buildAiContentAttachmentPath,
  buildAiContentUploadSessionPath,
  confirmAiContentAttachment,
  issueAiContentAttachmentToken,
  issueAiContentUploadSessionToken,
  verifyAiContentUploadSessionBlob,
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
const ids = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  brandId: "11111111-1111-4111-8111-111111111111",
  generationId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
  attemptId: "44444444-4444-4444-8444-444444444444",
  attachmentId: "55555555-5555-4555-8555-555555555555",
};

describe("AI content attachment upload policy", () => {
  it.each([
    [parseAiContentGenerationId, "not-a-generation", "ai_content_generation_id_invalid"],
    [parseAiContentAttachmentId, "not-an-attachment", "ai_content_attachment_id_invalid"],
    [parseAiContentUploadSessionId, "not-a-session", "ai_content_upload_session_id_invalid"],
  ] as const)("rejects malformed UUIDs before persistence", (parse, value, code) => {
    expect(() => parse(value)).toThrow(code);
  });

  it("parses exact session confirmation and cancellation bodies", () => {
    const body = { sessionId: ids.sessionId, nonce: "opaque-upload-nonce" };
    expect(parseConfirmAttachmentInput(body)).toEqual(body);
    expect(parseCancelUploadSessionInput(body)).toEqual(body);

    for (const extra of ["role", "checksum", "storageUrl", "storagePath", "workspaceId", "retentionDays"]) {
      expect(() => parseConfirmAttachmentInput({ ...body, [extra]: "client-controlled" })).toThrow("ai_content_invalid_body");
      expect(() => parseCancelUploadSessionInput({ ...body, [extra]: "client-controlled" })).toThrow("ai_content_invalid_body");
    }
  });

  it("retains the legacy attachment confirmation body", () => {
    const legacy = {
      ...base,
      storagePath: "brands/legacy/path",
      storageUrl: "https://test.public.blob.vercel-storage.com/brands/legacy/path",
    };
    expect(parseConfirmAttachmentInput(legacy)).toEqual(legacy);
    expect(parseLegacyConfirmAttachmentInput(legacy)).toEqual(legacy);
    expect(() => parseLegacyConfirmAttachmentInput({
      sessionId: ids.sessionId,
      nonce: "opaque-upload-nonce",
    })).toThrow("ai_content_attachment_size_invalid");
  });

  it("exports the MIME, role, and size policy used by attachment consumers", () => {
    expect(AI_CONTENT_TOTAL_ATTACHMENT_LIMIT).toBe(5);
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

  it("builds a tenant-scoped path whose upload attempt IDs prevent collisions", () => {
    const first = buildAiContentUploadSessionPath({
      ...ids,
      fileName: base.fileName,
    });
    const second = buildAiContentUploadSessionPath({
      ...ids,
      attemptId: "77777777-7777-4777-8777-777777777777",
      fileName: base.fileName,
    });
    expect(first).toBe(
      `workspaces/${ids.workspaceId}/brands/${ids.brandId}/ai-content/${ids.generationId}/attachments/${ids.sessionId}/${ids.attemptId}/${base.fileName}`,
    );
    expect(second).not.toBe(first);
  });

  it("keeps partial mixed path inputs on explicit legacy or session boundaries", () => {
    expect(buildAiContentAttachmentPath({
      brandId: ids.brandId,
      generationId: ids.generationId,
      checksum: base.checksum,
      fileName: base.fileName,
      attemptId: ids.attemptId,
    } as never)).toContain(`/attachments/${base.checksum}-${base.fileName}`);
    expect(() => buildAiContentUploadSessionPath({
      workspaceId: ids.workspaceId,
      brandId: ids.brandId,
      generationId: ids.generationId,
      sessionId: ids.sessionId,
      fileName: base.fileName,
      checksum: base.checksum,
    } as never)).toThrow("ai_content_upload_attempt_id_invalid");
  });

  it("issues a new-session token using the DB path, MIME, maximum, and expiry boundary", async () => {
    expect(AI_CONTENT_UPLOAD_SESSION_TTL_MS).toBe(10 * 60_000);
    const tokenExpiresAt = "2026-07-27T10:10:00.000Z";
    const generate = vi.fn(async (_options: any) => "session-client-token");

    for (const apiNow of [
      Date.parse("2026-07-27T09:58:00.000Z"),
      Date.parse("2026-07-27T10:02:00.000Z"),
    ]) {
      const now = vi.spyOn(Date, "now").mockReturnValue(apiNow);
      await expect(issueAiContentUploadSessionToken({
        storagePath: "db-owned/exact-path.png",
        mimeType: "image/png",
        maximumSizeInBytes: 5_000_000,
        tokenExpiresAt,
      }, { token: "read-write", generateClientToken: generate })).resolves.toEqual({
        pathname: "db-owned/exact-path.png",
        clientToken: "session-client-token",
        uploadExpiresAt: "2026-07-27T10:09:00.000Z",
      });
      now.mockRestore();
    }

    for (const [options] of generate.mock.calls) {
      expect(options).toMatchObject({
        pathname: "db-owned/exact-path.png",
        allowedContentTypes: ["image/png"],
        maximumSizeInBytes: 5_000_000,
        addRandomSuffix: false,
        allowOverwrite: false,
        validUntil: Date.parse("2026-07-27T10:09:00.000Z"),
      });
    }
  });

  it.each([
    ["invalid timestamp", "not-a-date"],
    ["no provider-before-session ordering", "1970-01-01T00:00:30.000Z"],
  ])("rejects %s from a persisted upload session", async (_case, tokenExpiresAt) => {
    await expect(issueAiContentUploadSessionToken({
      storagePath: "db-owned/exact-path.png",
      mimeType: "image/png",
      maximumSizeInBytes: 5_000_000,
      tokenExpiresAt,
    }, { token: "read-write", generateClientToken: vi.fn() })).rejects.toThrow("ai_content_upload_session_expiry_invalid");
  });

  it.each([
    ["less than the provider buffer remains", "2026-07-27T10:10:00.000Z", "2026-07-27T10:09:30.000Z"],
    ["the provider boundary has elapsed", "2026-07-27T10:10:00.000Z", "2026-07-27T10:10:01.000Z"],
  ])("rejects issuance when %s", async (_case, tokenExpiresAt, apiNow) => {
    const generate = vi.fn(async (_options: any) => "must-not-be-issued");
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse(apiNow));
    await expect(issueAiContentUploadSessionToken({
      storagePath: "db-owned/exact-path.png",
      mimeType: "image/png",
      maximumSizeInBytes: 5_000_000,
      tokenExpiresAt,
    }, { token: "read-write", generateClientToken: generate })).rejects.toThrow(
      "ai_content_upload_session_expiry_invalid",
    );
    expect(generate).not.toHaveBeenCalled();
    now.mockRestore();
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

  it("verifies a session upload by pathname and returns only provider metadata", async () => {
    const abortSignal = new AbortController().signal;
    const headBlob = vi.fn(async () => ({
      pathname: "db-owned/session.png",
      url: "https://test.public.blob.vercel-storage.com/db-owned/session.png",
      size: base.sizeBytes,
      contentType: base.mimeType,
    } as never));
    await expect(verifyAiContentUploadSessionBlob({
      storagePath: "db-owned/session.png",
      mimeType: base.mimeType,
      sizeBytes: base.sizeBytes,
    }, { token: "rw-token", abortSignal, headBlob })).resolves.toEqual({
      storagePath: "db-owned/session.png",
      storageUrl: "https://test.public.blob.vercel-storage.com/db-owned/session.png",
      mimeType: base.mimeType,
      sizeBytes: base.sizeBytes,
    });
    expect(headBlob).toHaveBeenCalledWith("db-owned/session.png", { token: "rw-token", abortSignal });
  });

  it.each([
    [{ status: 404 }, "ai_content_attachment_blob_unavailable"],
    [{ status: 429 }, "ai_content_attachment_storage_unavailable"],
    [{ status: 503 }, "ai_content_attachment_storage_unavailable"],
    [Object.assign(new Error("timed out"), { name: "TimeoutError" }), "ai_content_attachment_storage_unavailable"],
  ])("classifies provider verification failures", async (providerError, code) => {
    const headBlob = vi.fn(async () => { throw providerError; });
    await expect(verifyAiContentUploadSessionBlob({
      storagePath: "db-owned/session.png",
      mimeType: base.mimeType,
      sizeBytes: base.sizeBytes,
    }, {
      token: "rw-token",
      abortSignal: new AbortController().signal,
      headBlob,
    })).rejects.toThrow(code);
  });

  it("classifies the Vercel SDK BlobNotFoundError as blob unavailable", async () => {
    const headBlob = vi.fn(async () => { throw new BlobNotFoundError(); });
    await expect(verifyAiContentUploadSessionBlob({
      storagePath: "db-owned/session.png",
      mimeType: base.mimeType,
      sizeBytes: base.sizeBytes,
    }, {
      token: "rw-token",
      abortSignal: new AbortController().signal,
      headBlob,
    })).rejects.toThrow("ai_content_attachment_blob_unavailable");
  });

  it("rejects provider metadata mismatches for session uploads", async () => {
    const session = {
      storagePath: "db-owned/session.png",
      mimeType: base.mimeType,
      sizeBytes: base.sizeBytes,
    };
    const options = {
      token: "rw-token",
      abortSignal: new AbortController().signal,
      headBlob: vi.fn(async () => ({
        pathname: "db-owned/other.png",
        url: "https://test.public.blob.vercel-storage.com/db-owned/other.png",
        size: base.sizeBytes,
        contentType: base.mimeType,
      } as never)),
    };
    await expect(verifyAiContentUploadSessionBlob(session, options)).rejects.toThrow("ai_content_attachment_path_mismatch");
    options.headBlob.mockResolvedValueOnce({
      pathname: session.storagePath,
      url: "https://test.public.blob.vercel-storage.com/db-owned/session.png",
      size: 1,
      contentType: base.mimeType,
    } as never);
    await expect(verifyAiContentUploadSessionBlob(session, options)).rejects.toThrow("ai_content_attachment_size_mismatch");
    options.headBlob.mockResolvedValueOnce({
      pathname: session.storagePath,
      url: "https://test.public.blob.vercel-storage.com/db-owned/session.png",
      size: base.sizeBytes,
      contentType: "image/jpeg",
    } as never);
    await expect(verifyAiContentUploadSessionBlob(session, options)).rejects.toThrow("ai_content_attachment_mime_mismatch");
  });
});
