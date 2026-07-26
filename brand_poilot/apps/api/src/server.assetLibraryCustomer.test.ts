import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const avatarId = "44444444-4444-4444-8444-444444444444";
const referenceId = "55555555-5555-4555-8555-555555555555";
const sessionId = "66666666-6666-4666-8666-666666666666";
const checksum = "a".repeat(64);
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
    createAvatar: vi.fn(async () => avatar), updateAvatar: vi.fn(async () => avatar),
    addAvatarImage: vi.fn(async () => avatar), deleteAvatarImage: vi.fn(async () => undefined),
    setDefaultAvatar: vi.fn(async () => ({ ...avatar, isDefault: true })),
    archiveAvatar: vi.fn(async () => undefined), summarizeAvatars: vi.fn(async () => ({ active: 1, defaultAvatarId: null })),
    listReferences: vi.fn(async () => []), addReferenceUrl: vi.fn(async () => ({ id: referenceId })),
    setReferenceFavorite: vi.fn(async () => ({ id: referenceId })), archiveReference: vi.fn(async () => undefined),
    getReferencePattern: vi.fn(async () => ({ observations: ["강한 대비"] })),
    createUploadSession: vi.fn(async (_scope, kind) => ({
      id: sessionId, nonce: "valid-nonce-123456", workspaceId, brandId, kind,
      avatarId: kind === "avatar" ? avatarId : null,
      fileName: "face.webp", storagePathPrefix: kind === "avatar"
        ? `brands/${brandId}/asset-library/avatars/${avatarId}/${sessionId}/`
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
    confirmReferenceUpload: vi.fn(async () => ({ id: referenceId })),
    listReferenceBrands: vi.fn(async () => []), createReferenceBrand: vi.fn(async () => ({ id: referenceId })),
    createReferenceBrandFromTrend: vi.fn(async () => ({ id: referenceId })),
    listReferenceBrandItems: vi.fn(async () => []),
    ...overrides,
  } as unknown as ApiRepository;
  const kakaoAuth = {
    getSession: vi.fn(async () => ({ userId, workspaceId, workspaceName: "W", brandId, brandName: "B", displayName: "T", email: null })),
    canAccessBrand: vi.fn(async () => true),
  } as never;
  const headBlob = vi.fn(async () => ({
    url: uploaded.storageUrl, downloadUrl: uploaded.storageUrl, pathname: uploaded.storagePath,
    size: 100, uploadedAt: new Date(), contentType: "image/webp", contentDisposition: "inline",
    cacheControl: "public, max-age=0", etag: "etag",
  }));
  const generateClientToken = vi.fn(async () => "client-token");
  return {
    app: createServer({
      repository, kakaoAuth, logger: false,
      assetLibraryUpload: { readWriteToken: "rw-token", headBlob, generateClientToken },
    }),
    repository, headBlob,
  };
}

describe("asset library customer routes", () => {
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
      url: `/brands/${brandId}/references?kind=trend&contentFamily=blog&strategy=educational&format=reel&origin=acme&favorite=true&recent=30`,
      headers: auth,
    });
    expect(listed.statusCode).toBe(200);
    expect(repository.listReferences).toHaveBeenCalledWith({ workspaceId, brandId }, {
      kind: "trend", contentFamily: "blog", strategy: "educational", format: "reel",
      origin: "acme", favorite: true, recent: 30,
    });
    expect(listed.json()).toEqual([]);
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
});
