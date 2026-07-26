import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../lib/apiClient";
import { classifyLibraryError, createLibraryGateway } from "./libraryGateway";

describe("library gateway", () => {
  it("uses the product-service lifecycle endpoints with typed payloads", async () => {
    const requestJson = vi.fn().mockResolvedValue({});
    const gateway = createLibraryGateway({ requestJson } as never);
    const profile = {
      contractVersion: "product-service.v1" as const,
      name: "Brand Pilot",
      kind: "service" as const,
      description: "브랜드 운영 서비스",
      features: ["분석"],
      benefits: ["일관성"],
      cautions: [],
      audiences: [],
      appealsByTarget: {},
      evergreenPurchaseInfo: "월 구독",
      sourceUrls: ["https://example.com/service"],
    };

    await gateway.listProductServices("brand-1");
    await gateway.createProductService("brand-1", profile);
    await gateway.createProductServiceFromAnalysis("brand-1", "analysis-1");
    await gateway.updateProductServiceDraft("brand-1", "item-1", profile);
    await gateway.approveProductService("brand-1", "item-1");

    expect(requestJson).toHaveBeenNthCalledWith(1, "/brands/brand-1/product-services", { method: "GET" });
    expect(requestJson).toHaveBeenNthCalledWith(2, "/brands/brand-1/product-services", {
      method: "POST",
      body: JSON.stringify(profile),
    });
    expect(requestJson).toHaveBeenNthCalledWith(
      3,
      "/brands/brand-1/product-services/from-analysis/analysis-1",
      { method: "POST" },
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      4,
      "/brands/brand-1/product-services/item-1/draft",
      { method: "PATCH", body: JSON.stringify(profile) },
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      5,
      "/brands/brand-1/product-services/item-1/approve",
      { method: "POST" },
    );
  });

  it("uses the Wiki item and issue endpoints", async () => {
    const requestJson = vi.fn().mockResolvedValue({});
    const gateway = createLibraryGateway({ requestJson } as never);

    await gateway.listWikiItems("brand-1");
    await gateway.createWikiItem("brand-1", {
      contractVersion: "wiki-item.v1",
      itemType: "faq",
      title: "배송",
      content: "영업일 기준 2일입니다.",
      provenance: { input: "manual" },
    });
    await gateway.updateWikiItem("brand-1", "item-1", { status: "active" });
    await gateway.listWikiIssues("brand-1");
    await gateway.resolveWikiIssue("brand-1", "issue-1", {
      sourceKind: "faq",
      sourceId: "00000000-0000-4000-8000-000000000201",
    });

    expect(requestJson).toHaveBeenNthCalledWith(1, "/brands/brand-1/wiki/items", { method: "GET" });
    expect(requestJson).toHaveBeenNthCalledWith(
      3,
      "/brands/brand-1/wiki/items/item-1",
      { method: "PATCH", body: JSON.stringify({ status: "active" }) },
    );
    expect(requestJson).toHaveBeenNthCalledWith(4, "/brands/brand-1/wiki/issues", { method: "GET" });
    expect(requestJson).toHaveBeenNthCalledWith(
      5,
      "/brands/brand-1/wiki/issues/issue-1/resolve",
      {
        method: "POST",
        body: JSON.stringify({
          sourceKind: "faq",
          sourceId: "00000000-0000-4000-8000-000000000201",
        }),
      },
    );
  });

  it("uses the reserved avatar lifecycle and staged upload session endpoints", async () => {
    const token = {
      pathname: "brands/brand-1/asset-library/avatars/avatar-1/session-1/checksum-face.png",
      clientToken: "client-token",
      sessionId: "session-1",
      nonce: "nonce-1",
      expiresAt: "2026-07-27T01:00:00.000Z",
    };
    const requestJson = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(token)
      .mockResolvedValueOnce({ status: "staged", avatarId: "avatar-1", sessionId: "session-1" })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(undefined);
    const blobPut = vi.fn(async () => ({ url: `https://store.blob.vercel-storage.com/${token.pathname}` }));
    const gateway = createLibraryGateway({ requestJson } as never, blobPut as never);
    const file = new File(["image"], "face.png", { type: "image/png" });
    const progress = vi.fn();

    await gateway.listAvatars("brand-1");
    const staged = await gateway.uploadAvatarImage("brand-1", "avatar-1", file, progress);
    await gateway.createAvatar("brand-1", {
      avatarId: "avatar-1",
      name: "민지",
      description: "",
      imageSessionIds: [staged.sessionId],
      representativeSessionId: staged.sessionId,
    });
    await gateway.setDefaultAvatar("brand-1", "avatar-1");
    await gateway.archiveAvatar("brand-1", "avatar-1");

    expect(requestJson).toHaveBeenNthCalledWith(1, "/brands/brand-1/avatars", { method: "GET" });
    expect(requestJson).toHaveBeenNthCalledWith(
      2,
      "/brands/brand-1/avatars/avatar-1/images/upload-token",
      {
        method: "POST",
        body: expect.stringContaining('"fileName":"face.png"'),
      },
    );
    expect(blobPut).toHaveBeenCalledWith(
      token.pathname,
      file,
      expect.objectContaining({ token: "client-token", contentType: "image/png" }),
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      3,
      "/brands/brand-1/avatars/avatar-1/images/confirm",
      {
        method: "POST",
        body: expect.stringContaining('"sessionId":"session-1"'),
      },
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      4,
      "/brands/brand-1/avatars",
      expect.objectContaining({ method: "POST" }),
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      5,
      "/brands/brand-1/avatars/avatar-1/default",
      { method: "POST" },
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      6,
      "/brands/brand-1/avatars/avatar-1/archive",
      { method: "POST" },
    );
    expect(progress).toHaveBeenCalledWith(100);
  });

  it("reports avatar cancellation as cleanup-pending until token expiry", async () => {
    const pending = { status: "cleanup_pending" as const, immediateCleanup: "retry_scheduled" as const };
    const requestJson = vi.fn(async () => pending);
    const gateway = createLibraryGateway({ requestJson } as never);
    await expect(gateway.cancelAvatarUpload("brand-1", "avatar-1", "session-1"))
      .resolves.toEqual(pending);
    expect(requestJson).toHaveBeenCalledWith(
      "/brands/brand-1/avatars/avatar-1/images/upload-sessions/session-1",
      { method: "DELETE" },
    );
  });

  it("classifies deployment-order, scoped lookup, and retryable failures stably", () => {
    expect(classifyLibraryError(new ApiRequestError({
      status: 500,
      errorCode: "wiki_management_not_configured",
    }))).toBe("unavailable");
    expect(classifyLibraryError(new ApiRequestError({
      status: 500,
      errorCode: "asset_library_not_configured",
    }))).toBe("unavailable");
    expect(classifyLibraryError(new ApiRequestError({
      status: 404,
      errorCode: "product_service_not_found",
    }))).toBe("not_found");
    expect(classifyLibraryError(new ApiRequestError({
      status: 403,
      errorCode: "brand_scope_forbidden",
    }))).toBe("forbidden");
    expect(classifyLibraryError(new TypeError("Failed to fetch"))).toBe("retryable");
  });

  it("treats a missing legacy list route as unavailable without hiding true item 404s", () => {
    expect(classifyLibraryError(new ApiRequestError({
      status: 404,
      errorCode: null,
    }), "collection")).toBe("unavailable");
    expect(classifyLibraryError(new ApiRequestError({
      status: 404,
      errorCode: "product_service_not_found",
    }), "item")).toBe("not_found");
  });
});
