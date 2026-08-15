import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository } from "./types.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const adId = "44444444-4444-4444-8444-444444444444";
const searchId = "55555555-5555-4555-8555-555555555555";
const auth = { cookie: "bp_session=session-1" };
const page = { searchId, cacheState: "fresh", errorCode: null, refreshedAt: "2026-08-13T00:00:00.000Z", items: [], nextCursor: null };

function setup(overrides: Record<string, unknown> = {}) {
  const repository = {
    searchMetaAdLibrary: vi.fn(async () => page),
    findMetaAdLibraryCache: vi.fn(async () => page),
    getMetaAdLibrarySearch: vi.fn(async () => page),
    saveMetaAdLibraryAd: vi.fn(async () => ({ savedId: "saved-1", adId, isSaved: true })),
    removeMetaAdLibraryAd: vi.fn(async () => undefined),
    runSavedMetaAdPageRefreshes: vi.fn(async () => ({ enqueued: 1, processed: 1, succeeded: 1, failed: 0, skipped: 0 })),
    ...overrides,
  } as unknown as ApiRepository;
  const kakaoAuth = {
    getSession: vi.fn(async () => ({ userId, workspaceId, workspaceName: "W", brandId, brandName: "B", displayName: "T", email: null })),
    canAccessBrand: vi.fn(async () => true),
  } as never;
  return { app: createServer({ repository, kakaoAuth, cronSecret: "cron-secret", logger: false }), repository };
}

describe("Meta Ad Library customer routes", () => {
  it("searches with an explicit mode and authenticated tenant scope", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "POST", url: `/brands/${brandId}/meta-ad-library/search`, headers: auth,
      payload: { mode: "keyword", query: " 스킨케어 " },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(page);
    expect(repository.searchMetaAdLibrary).toHaveBeenCalledWith(
      { workspaceId, brandId, actorUserId: userId },
      { mode: "keyword", query: " 스킨케어 " },
    );
    await app.close();
  });

  it("rejects implicit or malformed search modes", async () => {
    const { app, repository } = setup();
    for (const payload of [
      { query: "스킨케어" },
      { mode: "page", pageIds: ["bad-id"] },
      { mode: "keyword", query: "x" },
    ]) {
      const response = await app.inject({ method: "POST", url: `/brands/${brandId}/meta-ad-library/search`, headers: auth, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "meta_ad_library_search_invalid" });
    }
    expect(repository.searchMetaAdLibrary).not.toHaveBeenCalled();
    await app.close();
  });

  it("loads cached pages and saves or removes only within the authenticated brand", async () => {
    const { app, repository } = setup();
    expect((await app.inject({
      method: "GET",
      url: `/brands/${brandId}/meta-ad-library/cache?mode=keyword&query=%EC%97%AC%ED%96%89`,
      headers: auth,
    })).statusCode).toBe(200);
    expect(repository.findMetaAdLibraryCache).toHaveBeenCalledWith(
      { workspaceId, brandId },
      { mode: "keyword", query: "여행" },
    );
    expect((await app.inject({ method: "GET", url: `/brands/${brandId}/meta-ad-library/searches/${searchId}?cursor=29`, headers: auth })).statusCode).toBe(200);
    expect(repository.getMetaAdLibrarySearch).toHaveBeenCalledWith({ workspaceId, brandId }, searchId, "29");

    expect((await app.inject({ method: "POST", url: `/brands/${brandId}/meta-ad-library/ads/${adId}/save`, headers: auth })).statusCode).toBe(200);
    expect(repository.saveMetaAdLibraryAd).toHaveBeenCalledWith({ workspaceId, brandId, actorUserId: userId }, adId);

    expect((await app.inject({ method: "DELETE", url: `/brands/${brandId}/meta-ad-library/ads/${adId}/save`, headers: auth })).statusCode).toBe(204);
    expect(repository.removeMetaAdLibraryAd).toHaveBeenCalledWith({ workspaceId, brandId }, adId);
    await app.close();
  });

  it.each([
    ["meta_ad_library_not_configured", 503],
    ["meta_ad_library_permission_required", 403],
    ["meta_ad_library_rate_limited", 429],
  ])("maps %s without leaking provider secrets", async (code, status) => {
    const { app } = setup({ searchMetaAdLibrary: vi.fn(async () => { throw new Error(code); }) });
    const response = await app.inject({
      method: "POST", url: `/brands/${brandId}/meta-ad-library/search`, headers: auth,
      payload: { mode: "keyword", query: "스킨케어" },
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error: code });
    expect(response.body).not.toContain("token");
    await app.close();
  });

  it("protects and runs the saved advertiser Page refresh cron", async () => {
    const { app, repository } = setup();
    const unauthorized = await app.inject({ method: "POST", url: "/internal/cron/meta-ad-page-refresh" });
    expect(unauthorized.statusCode).toBe(401);
    const response = await app.inject({
      method: "POST",
      url: "/internal/cron/meta-ad-page-refresh",
      headers: { authorization: "Bearer cron-secret" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enqueued: 1, processed: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(repository.runSavedMetaAdPageRefreshes).toHaveBeenCalledWith(20);
    await app.close();
  });
});
