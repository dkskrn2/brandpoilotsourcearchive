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

  it("classifies deployment-order, scoped lookup, and retryable failures stably", () => {
    expect(classifyLibraryError(new ApiRequestError({
      status: 500,
      errorCode: "wiki_management_not_configured",
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
