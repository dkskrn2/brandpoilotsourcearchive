import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const avatarId = "44444444-4444-4444-8444-444444444444";
const referenceId = "55555555-5555-4555-8555-555555555555";
const sessionId = "66666666-6666-4666-8666-666666666666";
const presetId = "77777777-7777-4777-8777-777777777777";
const productId = "88888888-8888-4888-8888-888888888888";
const versionId = "99999999-9999-4999-8999-999999999999";
const uploadBytes = Buffer.alloc(100, 7);
const checksum = createHash("sha256").update(uploadBytes).digest("hex");
const auth = { cookie: "bp_session=session-1" };
const uploaded = {
  fileName: "face.webp", mimeType: "image/webp", sizeBytes: 100, checksum,
  storagePath: `brands/${brandId}/asset-library/avatars/${avatarId}/${sessionId}/${checksum}-face.webp`,
  storageUrl: `https://store.blob.vercel-storage.com/brands/${brandId}/asset-library/avatars/${avatarId}/${sessionId}/${checksum}-face.webp`,
};
const avatar = {
  id: avatarId, workspaceId, brandId, name: "모델", description: "", isDefault: false,
  status: "active" as const, createdByUserId: userId,
  createdAt: "2026-07-27T00:00:00.000Z", updatedAt: "2026-07-27T00:00:00.000Z", images: [],
};

function setup(overrides: Partial<ApiRepository> = {}) {
  const repository = {
    health: vi.fn(async () => ({ database: "ok" as const })),
    getActive: vi.fn(async () => null), listVersions: vi.fn(async () => []),
    getActiveRules: vi.fn(async () => null), listRuleSets: vi.fn(async () => []),
    listAvatars: vi.fn(async () => [avatar]), getAvatar: vi.fn(async () => avatar),
    getProductService: vi.fn(async () => ({ id: productId, activeVersion: { id: versionId }, draft: null })),
    createAvatar: vi.fn(async () => avatar), updateAvatar: vi.fn(async () => avatar),
    addAvatarImage: vi.fn(async () => avatar), deleteAvatarImage: vi.fn(async () => undefined),
    setDefaultAvatar: vi.fn(async () => ({ ...avatar, isDefault: true })),
    archiveAvatar: vi.fn(async () => undefined), summarizeAvatars: vi.fn(async () => ({ active: 1, defaultAvatarId: null })),
    listReferences: vi.fn(async () => []), addReferenceUrl: vi.fn(async () => ({ id: referenceId })),
    getReference: vi.fn(async () => ({ id: referenceId, title: "Real detail" })),
    setReferenceFavorite: vi.fn(async () => ({ id: referenceId })), archiveReference: vi.fn(async () => undefined),
    getReferencePattern: vi.fn(async () => ({ observations: ["강한 대비"] })),
    createUploadSession: vi.fn(async (_scope, kind) => ({
      id: sessionId, nonce: "valid-nonce-123456", workspaceId, brandId, kind,
      avatarId: kind === "avatar" ? avatarId : null,
      productId: kind === "product" ? productId : null,
      fileName: "face.webp", storagePathPrefix: kind === "avatar"
        ? `brands/${brandId}/asset-library/avatars/${avatarId}/${sessionId}/`
        : kind === "product"
          ? `brands/${brandId}/asset-library/products/${productId}/${sessionId}/`
          : `brands/${brandId}/asset-library/references/${sessionId}/`,
      expectedMimeType: "image/webp", expectedSizeBytes: 100, expectedChecksum: checksum,
      expiresAt: new Date(Date.now() + 60_000).toISOString(), confirmedAt: null,
    })),
    getUploadSession: vi.fn(async () => ({
      id: sessionId, nonce: "valid-nonce-123456", workspaceId, brandId, kind: "avatar" as const,
      avatarId,
      fileName: "face.webp", storagePathPrefix: `brands/${brandId}/asset-library/avatars/${avatarId}/${sessionId}/`,
      expectedMimeType: "image/webp", expectedSizeBytes: 100, expectedChecksum: checksum,
      expiresAt: new Date(Date.now() + 60_000).toISOString(), confirmedAt: null,
    })),
    confirmAvatarUpload: vi.fn(async () => ({ status: "staged" as const, avatarId, sessionId })),
    cancelAvatarUpload: vi.fn(async () => ({
      status: "cleanup_pending" as const,
      immediateCleanup: "succeeded" as const,
    })),
    cleanupExpiredAvatarUploads: vi.fn(async () => ({ scanned: 0, cancelled: 0, failed: [] })),
    cancelReferenceUpload: vi.fn(async () => ({
      status: "cleanup_pending" as const,
      immediateCleanup: "succeeded" as const,
    })),
    cancelProductUpload: vi.fn(async () => ({
      status: "cleanup_pending" as const,
      immediateCleanup: "succeeded" as const,
    })),
    cleanupExpiredReferenceUploads: vi.fn(async () => ({
      scanned: 0, cancelled: 0, preserved: 0, failed: [],
    })),
    confirmReferenceUpload: vi.fn(async () => ({ id: referenceId })),
    listReferenceBrands: vi.fn(async () => []), createReferenceBrand: vi.fn(async () => ({ id: referenceId })),
    createReferenceBrandFromTrend: vi.fn(async () => ({ id: referenceId })),
    listReferenceBrandItems: vi.fn(async () => []),
    listReferenceChannels: vi.fn(async () => []),
    resolveReferenceChannel: vi.fn(async () => ({ id: referenceId })),
    listReferenceChannelMedia: vi.fn(async () => ({ items: [], total: 0, refreshedAt: null, cacheState: "pending" as const })),
    listBrandStylePresets: vi.fn(async () => []),
    createBrandStylePreset: vi.fn(async (_scope, input) => ({ id: presetId, revision: 1, ...input })),
    updateBrandStylePreset: vi.fn(async (_scope, input) => ({ id: presetId, revision: 2, ...input })),
    setDefaultBrandStylePreset: vi.fn(async () => ({ id: presetId, revision: 2, isDefault: true })),
    archiveBrandStylePreset: vi.fn(async () => undefined),
    listProductServiceImageAssets: vi.fn(async () => []),
    confirmProductServiceImageAsset: vi.fn(async (_scope, upload) => ({
      id: referenceId, workspaceId, brandId, productServiceId: productId, versionId,
      storageArtifactId: avatarId, role: "hero" as const, position: 1,
      mimeType: upload.mimeType, sizeBytes: upload.sizeBytes,
    })),
    getProductServiceImageAsset: vi.fn(async () => ({
      id: referenceId, workspaceId, brandId, productServiceId: productId, versionId,
      storageArtifactId: avatarId, role: "hero" as const, position: 1,
      mimeType: "image/webp", sizeBytes: 100,
      storagePath: `brands/${brandId}/asset-library/products/${productId}/${sessionId}/${checksum}-face.webp`,
    })),
    deleteProductServiceImageAsset: vi.fn(async () => ({ deleteBlob: true })),
    ...overrides,
  } as unknown as ApiRepository;
  const kakaoAuth = {
    getSession: vi.fn(async () => ({ userId, workspaceId, workspaceName: "W", brandId, brandName: "B", displayName: "T", email: null })),
    canAccessBrand: vi.fn(async () => true),
  } as never;
  const getBlob = vi.fn(async () => ({
    statusCode: 200 as const,
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(uploadBytes);
        controller.close();
      },
    }),
    headers: new Headers(),
    blob: {
      url: uploaded.storageUrl, downloadUrl: `${uploaded.storageUrl}?download=1`,
      pathname: uploaded.storagePath, size: uploadBytes.length,
      uploadedAt: new Date(), contentType: "image/webp", contentDisposition: "inline",
      cacheControl: "public, max-age=0", etag: "etag",
    },
  }));
  const generateClientToken = vi.fn(async () => "client-token");
  const deleteBlob = vi.fn(async () => undefined);
  const listBlobs = vi.fn(async () => ({ blobs: [], hasMore: false }));
  return {
    app: createServer({
      repository, kakaoAuth, logger: false, cronSecret: "cron-secret",
      assetLibraryUpload: {
        readWriteToken: "rw-token", getBlob, generateClientToken, deleteBlob,
        listBlobs: listBlobs as never,
      },
    }),
    repository, getBlob, deleteBlob, listBlobs,
  };
}

describe("asset library customer routes", () => {
  it("manages closed named style presets with explicit revision CAS", async () => {
    const { app, repository } = setup();
    const payload = {
      contractVersion: "brand-style-preset.v1",
      name: "Editorial Red",
      description: "Newsroom hierarchy",
      visualTokens: { colors: ["#ff0000"], fonts: ["Pretendard"], notes: ["Red emphasis"] },
      referenceItemIds: [referenceId],
      isDefault: true,
    };
    expect((await app.inject({ method: "GET", url: `/brands/${brandId}/style-presets`, headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/brands/${brandId}/style-presets`, headers: auth, payload })).statusCode).toBe(201);
    expect((await app.inject({
      method: "PATCH", url: `/brands/${brandId}/style-presets/${presetId}`,
      headers: { ...auth, "if-match": '"1"' }, payload: { ...payload, name: "Updated" },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "PATCH", url: `/brands/${brandId}/style-presets/${presetId}`, headers: auth, payload,
    })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/brands/${brandId}/style-presets/${presetId}/default`, headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/brands/${brandId}/style-presets/${presetId}`, headers: auth })).statusCode).toBe(204);
    expect(repository.createBrandStylePreset).toHaveBeenCalledWith({ workspaceId, brandId, actorUserId: userId }, payload);
    expect(repository.updateBrandStylePreset).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId, presetId, expectedRevision: 1 },
      { ...payload, name: "Updated" },
    );
    await app.close();
  });

  it("issues, confirms, lists and deletes a scoped optional product image", async () => {
    const productPath = `brands/${brandId}/asset-library/products/${productId}/${sessionId}/${checksum}-face.webp`;
    const productUrl = `https://store.blob.vercel-storage.com/${productPath}`;
    const getUploadSession = vi.fn(async () => ({
      id: sessionId, nonce: "valid-nonce-123456", workspaceId, brandId, kind: "product" as const,
      productId, fileName: "face.webp",
      storagePathPrefix: `brands/${brandId}/asset-library/products/${productId}/${sessionId}/`,
      expectedMimeType: "image/webp", expectedSizeBytes: 100, expectedChecksum: checksum,
      expiresAt: new Date(Date.now() + 60_000).toISOString(), confirmedAt: null,
    }));
    const { app, repository, getBlob, deleteBlob } = setup({ getUploadSession });
    getBlob.mockResolvedValueOnce({
      statusCode: 200 as const,
      stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(uploadBytes); controller.close(); } }),
      headers: new Headers(),
      blob: {
        url: productUrl, downloadUrl: `${productUrl}?download=1`, pathname: productPath,
        size: uploadBytes.length, uploadedAt: new Date(), contentType: "image/webp",
        contentDisposition: "inline", cacheControl: "public, max-age=0", etag: "etag",
      },
    });
    const token = await app.inject({
      method: "POST", url: `/brands/${brandId}/products/${productId}/images/upload-token`, headers: auth,
      payload: { versionId, fileName: "face.webp", mimeType: "image/webp", sizeBytes: 100, checksum },
    });
    expect(token.statusCode).toBe(200);
    expect(token.json().pathname).toBe(productPath);
    const confirmed = await app.inject({
      method: "POST", url: `/brands/${brandId}/products/${productId}/images/confirm`, headers: auth,
      payload: {
        versionId, role: "hero", position: 1, sessionId, nonce: "valid-nonce-123456",
        fileName: "face.webp", mimeType: "image/webp", sizeBytes: 100, checksum,
        storagePath: productPath, storageUrl: productUrl,
      },
    });
    expect(confirmed.statusCode).toBe(201);
    expect((await app.inject({
      method: "GET", url: `/brands/${brandId}/products/${productId}/versions/${versionId}/images`, headers: auth,
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "DELETE", url: `/brands/${brandId}/products/${productId}/images/${referenceId}`, headers: auth,
    })).statusCode).toBe(204);
    expect(repository.confirmProductServiceImageAsset).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId, productServiceId: productId, versionId, sessionId, role: "hero", position: 1 },
      expect.objectContaining({ storagePath: productPath, checksum }),
    );
    expect(repository.deleteProductServiceImageAsset).toHaveBeenCalledTimes(1);
    const databaseDeleteOrder = vi.mocked(repository.deleteProductServiceImageAsset!).mock.invocationCallOrder[0];
    const blobDeleteOrder = deleteBlob.mock.invocationCallOrder[0];
    expect(databaseDeleteOrder).toBeDefined();
    expect(blobDeleteOrder).toBeDefined();
    expect(databaseDeleteOrder!).toBeLessThan(blobDeleteOrder!);
    await app.close();
  });

  it("returns and explicitly retries an onboarding product image import", async () => {
    const getProductImageImportStatus = vi.fn(async () => ({
      status: "failed" as const, attemptCount: 3, errorCode: "fetch_failed", updatedAt: "2026-08-24T00:00:00.000Z",
    }));
    const retryProductImageImportJob = vi.fn(async () => ({
      status: "pending" as const, attemptCount: 0, errorCode: null, updatedAt: "2026-08-24T00:01:00.000Z",
    }));
    const { app } = setup({ getProductImageImportStatus, retryProductImageImportJob });
    const status = await app.inject({
      method: "GET", headers: auth,
      url: `/brands/${brandId}/products/${productId}/versions/${versionId}/image-import`,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().status).toBe("failed");
    const retry = await app.inject({
      method: "POST", headers: auth,
      url: `/brands/${brandId}/products/${productId}/versions/${versionId}/image-import/retry`,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().status).toBe("pending");
    expect(retryProductImageImportJob).toHaveBeenCalledWith({ workspaceId, brandId, productServiceId: productId, versionId });
    await app.close();
  });

  it("cancels an unconfirmed product upload using the authenticated product scope", async () => {
    const { app, repository } = setup();
    const cancelled = await app.inject({
      method: "DELETE",
      url: `/brands/${brandId}/products/${productId}/images/upload-sessions/${sessionId}`,
      headers: auth,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(repository.cancelProductUpload).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId, productId, sessionId },
      expect.any(Function),
    );
    await app.close();
  });

  it("keeps a deleted product image removed when provider blob cleanup fails", async () => {
    const { app, repository, deleteBlob } = setup();
    deleteBlob.mockRejectedValueOnce(new Error("provider_delete_failed"));
    const deleted = await app.inject({
      method: "DELETE",
      url: `/brands/${brandId}/products/${productId}/images/${referenceId}`,
      headers: auth,
    });
    expect(deleted.statusCode).toBe(204);
    expect(repository.deleteProductServiceImageAsset).toHaveBeenCalledTimes(1);
    const databaseDeleteOrder = vi.mocked(repository.deleteProductServiceImageAsset!).mock.invocationCallOrder[0];
    const blobDeleteOrder = deleteBlob.mock.invocationCallOrder[0];
    expect(databaseDeleteOrder).toBeDefined();
    expect(blobDeleteOrder).toBeDefined();
    expect(databaseDeleteOrder!).toBeLessThan(blobDeleteOrder!);
    await app.close();
  });

  it("does not delete the physical product blob while another version still references it", async () => {
    const deleteProductServiceImageAsset = vi.fn(async () => ({ deleteBlob: false })) as never;
    const { app, deleteBlob } = setup({ deleteProductServiceImageAsset });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/brands/${brandId}/products/${productId}/images/${referenceId}`,
      headers: auth,
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleteBlob).not.toHaveBeenCalled();
    await app.close();
  });

  it("lists, creates, edits, defaults, and archives avatars with the authenticated actor", async () => {
    const { app, repository } = setup();
    expect((await app.inject({ method: "GET", url: `/brands/${brandId}/avatars`, headers: auth })).statusCode).toBe(200);
    const created = await app.inject({
      method: "POST", url: `/brands/${brandId}/avatars`, headers: auth,
      payload: {
        avatarId, name: " 모델 ", description: "",
        imageSessionIds: [sessionId], representativeSessionId: sessionId,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(repository.createAvatar).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId },
      {
        avatarId, name: "모델", description: "",
        imageSessionIds: [sessionId], representativeSessionId: sessionId,
      },
    );
    expect((await app.inject({
      method: "GET", url: `/brands/${brandId}/avatars/${avatarId}`, headers: auth,
    })).statusCode).toBe(200);
    await app.inject({ method: "PATCH", url: `/brands/${brandId}/avatars/${avatarId}`, headers: auth, payload: { name: "수정", description: "" } });
    expect((await app.inject({
      method: "DELETE", url: `/brands/${brandId}/avatars/${avatarId}/images/${referenceId}`, headers: auth,
    })).statusCode).toBe(204);
    await app.inject({ method: "POST", url: `/brands/${brandId}/avatars/${avatarId}/default`, headers: auth });
    await app.inject({ method: "POST", url: `/brands/${brandId}/avatars/${avatarId}/archive`, headers: auth });
    expect(repository.updateAvatar).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId, avatarId }, { name: "수정", description: "" },
    );
    expect(repository.setDefaultAvatar).toHaveBeenCalledWith({ workspaceId, brandId, actorUserId: userId, avatarId });
    expect(repository.archiveAvatar).toHaveBeenCalledWith({ workspaceId, brandId, actorUserId: userId, avatarId });
    await app.close();
  });

  it("issues and confirms a dedicated avatar upload session", async () => {
    const { app, repository } = setup();
    const token = await app.inject({
      method: "POST", url: `/brands/${brandId}/avatars/${avatarId}/images/upload-token`, headers: auth,
      payload: { fileName: "face.webp", mimeType: "image/webp", sizeBytes: 100, checksum },
    });
    expect(token.statusCode).toBe(200);
    expect(token.json().pathname).toContain("/asset-library/avatars/");
    expect(token.json().nonce).toBe("valid-nonce-123456");
    expect(repository.createUploadSession).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId },
      "avatar",
      { fileName: "face.webp", mimeType: "image/webp", sizeBytes: 100, checksum },
      avatarId,
    );
    const confirmed = await app.inject({
      method: "POST", url: `/brands/${brandId}/avatars/${avatarId}/images/confirm`, headers: auth,
      payload: { sessionId, nonce: "valid-nonce-123456", ...uploaded, representative: false },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toEqual({ status: "staged", avatarId, sessionId });
    expect(repository.confirmAvatarUpload).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId, avatarId, sessionId },
      { ...uploaded, representative: false },
    );
    await app.close();
  });

  it("cancels an avatar upload with authenticated tenant, actor, and reserved-avatar scope", async () => {
    const { app, repository, deleteBlob } = setup();
    const response = await app.inject({
      method: "DELETE",
      url: `/brands/${brandId}/avatars/${avatarId}/images/upload-sessions/${sessionId}`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "cleanup_pending", immediateCleanup: "succeeded" });
    expect(repository.cancelAvatarUpload).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId, avatarId, sessionId },
      expect.any(Function),
    );
    const cleanup = (repository.cancelAvatarUpload as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    const prefix = `brands/${brandId}/asset-library/avatars/${avatarId}/${sessionId}/`;
    await cleanup(prefix, uploaded.storagePath);
    expect(deleteBlob).toHaveBeenCalledWith(uploaded.storagePath, expect.objectContaining({ token: "rw-token" }));
    await app.close();
  });

  it("cancels a reference upload with authenticated tenant and actor scope", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "DELETE",
      url: `/brands/${brandId}/references/upload-sessions/${sessionId}`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "cleanup_pending", immediateCleanup: "succeeded" });
    expect(repository.cancelReferenceUpload).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId, sessionId },
      expect.any(Function),
    );
    await app.close();
  });

  it("runs abandoned avatar and reference cleanup only through the authenticated cron route", async () => {
    const cleanupExpiredAvatarUploads = vi.fn(async () => ({
      scanned: 2,
      cancelled: 1,
      failed: [{ sessionId, error: "asset_library_blob_delete_failed" }],
    }));
    const cleanupExpiredReferenceUploads = vi.fn(async () => ({
      scanned: 1, cancelled: 1, preserved: 0, failed: [],
    }));
    const { app } = setup({ cleanupExpiredAvatarUploads, cleanupExpiredReferenceUploads });
    expect((await app.inject({
      method: "GET", url: "/internal/cron/avatar-upload-cleanup",
    })).statusCode).toBe(401);
    const response = await app.inject({
      method: "GET",
      url: "/internal/cron/avatar-upload-cleanup",
      headers: { authorization: "Bearer cron-secret" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      scanned: 2, cancelled: 1,
      failed: [{ sessionId, error: "asset_library_blob_delete_failed" }],
    });
    expect(cleanupExpiredAvatarUploads).toHaveBeenCalledWith(expect.any(Function));
    expect(cleanupExpiredReferenceUploads).toHaveBeenCalledWith(expect.any(Function));
    await app.close();
  });

  it("maps duplicate avatar image bytes to a stable conflict response", async () => {
    const { app } = setup({
      createAvatar: vi.fn(async () => {
        throw new Error("avatar_image_duplicate");
      }),
    });
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/avatars`,
      headers: auth,
      payload: {
        avatarId,
        name: "중복 모델",
        description: "",
        imageSessionIds: [sessionId],
        representativeSessionId: sessionId,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "avatar_image_duplicate" });
    await app.close();
  });

  it("maps an existing-avatar duplicate confirmation to the same stable conflict response", async () => {
    const { app } = setup({
      confirmAvatarUpload: vi.fn(async () => {
        throw new Error("avatar_image_duplicate");
      }),
    });
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/avatars/${avatarId}/images/confirm`,
      headers: auth,
      payload: {
        sessionId,
        nonce: "valid-nonce-123456",
        ...uploaded,
        representative: false,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "avatar_image_duplicate" });
    await app.close();
  });

  it("does not persist a caller Blob hostname that differs from the provider canonical URL", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST", url: `/brands/${brandId}/avatars/${avatarId}/images/confirm`, headers: auth,
      payload: {
        sessionId, nonce: "valid-nonce-123456", ...uploaded,
        storageUrl: `https://attacker.blob.vercel-storage.com/${uploaded.storagePath}`,
        representative: false,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "asset_library_upload_url_mismatch" });
    expect(repository.confirmAvatarUpload).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects an invalid reserved avatar ID before creating an upload session", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST", url: `/brands/${brandId}/avatars/not-a-uuid/images/upload-token`, headers: auth,
      payload: { fileName: "face.webp", mimeType: "image/webp", sizeBytes: 100, checksum },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "asset_library_upload_scope_invalid" });
    expect(repository.createUploadSession).not.toHaveBeenCalled();
    await app.close();
  });

  it("passes all reference filters and exposes patterns only on the dedicated endpoint", async () => {
    const { app, repository } = setup();
    const listed = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/references?kind=trend&collection=content&q=${encodeURIComponent(" 여름 루틴 ")}&contentFamily=blog&strategy=educational&format=reel&origin=acme&favorite=true&recent=30`,
      headers: auth,
    });
    expect(listed.statusCode).toBe(200);
    expect(repository.listReferences).toHaveBeenCalledWith({ workspaceId, brandId }, {
      kind: "trend", collection: "content", q: "여름 루틴", contentFamily: "blog", strategy: "educational", format: "reel",
      origin: "acme", favorite: true, recent: 30,
    });
    expect(listed.json()).toEqual([]);
    const detail = await app.inject({
      method: "GET", url: `/brands/${brandId}/references/${referenceId}`, headers: auth,
    });
    expect(detail.json()).toEqual({ id: referenceId, title: "Real detail" });
    expect(repository.getReference).toHaveBeenCalledWith({ workspaceId, brandId, referenceId });
    const pattern = await app.inject({
      method: "GET", url: `/brands/${brandId}/references/${referenceId}/pattern`, headers: auth,
    });
    expect(pattern.json()).toEqual({ observations: ["강한 대비"] });
    await app.close();
  });

  it("supports URL, favorite, archive, and real saved reference-brand routes", async () => {
    const { app, repository } = setup();
    expect((await app.inject({
      method: "POST", url: `/brands/${brandId}/references/url`, headers: auth,
      payload: { url: "https://example.com/a", contentPurpose: "both", title: "A" },
    })).statusCode).toBe(201);
    const uploadToken = await app.inject({
      method: "POST", url: `/brands/${brandId}/references/upload-token`, headers: auth,
      payload: { fileName: "face.webp", mimeType: "image/webp", sizeBytes: 100, checksum },
    });
    expect(uploadToken.statusCode).toBe(200);
    expect(uploadToken.json().pathname).toContain("/asset-library/references/");
    await app.inject({
      method: "POST", url: `/brands/${brandId}/references/${referenceId}/favorite`, headers: auth,
      payload: { favorite: true },
    });
    await app.inject({ method: "POST", url: `/brands/${brandId}/references/${referenceId}/archive`, headers: auth });
    await app.inject({
      method: "POST", url: `/brands/${brandId}/reference-brands`, headers: auth,
      payload: { platform: "instagram", handle: "@acme" },
    });
    expect((await app.inject({
      method: "GET", url: `/brands/${brandId}/reference-brands`, headers: auth,
    })).statusCode).toBe(200);
    await app.inject({
      method: "POST", url: `/brands/${brandId}/reference-brands/from-trend-media/${referenceId}`, headers: auth,
    });
    await app.inject({
      method: "GET", url: `/brands/${brandId}/reference-brands/${referenceId}/items`, headers: auth,
    });
    expect(repository.createReferenceBrandFromTrend).toHaveBeenCalledWith({
      workspaceId, brandId, actorUserId: userId, mediaId: referenceId,
    });
    expect(repository.listReferenceBrandItems).toHaveBeenCalledWith({
      workspaceId, brandId, referenceBrandId: referenceId,
    });
    await app.close();
  });

  it("maps member archive rejection to a stable forbidden response", async () => {
    const { app } = setup({ archiveReference: vi.fn(async () => { throw new Error("asset_library_admin_required"); }) });
    const response = await app.inject({
      method: "POST", url: `/brands/${brandId}/references/${referenceId}/archive`, headers: auth,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "asset_library_admin_required" });
    await app.close();
  });

  it("returns a client error instead of inventing a reference-brand author", async () => {
    const { app } = setup({
      createReferenceBrandFromTrend: vi.fn(async () => {
        throw new Error("reference_brand_author_unavailable");
      }),
    });
    const response = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/reference-brands/from-trend-media/${referenceId}`,
      headers: auth,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "reference_brand_author_unavailable" });
    await app.close();
  });

  it("resolves an Instagram channel and reads its tenant-scoped cached media", async () => {
    const { app, repository } = setup();
    const resolved = await app.inject({
      method: "POST",
      url: `/brands/${brandId}/reference-brands/resolve`,
      headers: auth,
      payload: { profile: "https://www.instagram.com/acme/" },
    });
    expect(resolved.statusCode).toBe(201);
    expect(repository.resolveReferenceChannel).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId },
      "https://www.instagram.com/acme/",
    );

    const media = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/reference-brands/${referenceId}/media`,
      headers: auth,
    });
    expect(media.statusCode).toBe(200);
    expect(repository.listReferenceChannelMedia).toHaveBeenCalledWith({
      workspaceId, brandId, referenceBrandId: referenceId,
    });
    await app.close();
  });
});
