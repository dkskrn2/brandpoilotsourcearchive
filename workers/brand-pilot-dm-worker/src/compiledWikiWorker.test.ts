import { describe, expect, it, vi } from "vitest";
import { runWikiCompilationItemOnce } from "./compiledWikiWorker.js";

const item = {
  id: "item-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  wikiVersionId: "version-1",
  itemType: "detail_page" as const,
  stableKey: "product:sku:bp-001",
  leaseToken: "lease-1",
};

const group = {
  pageType: "product" as const,
  stableKey: item.stableKey,
  sourceUnits: [{
    id: "unit-1",
    sourceKind: "product" as const,
    sourceId: "source-1",
    unitType: "product" as const,
    stableKey: item.stableKey,
    title: "Brand Pilot",
    content: "브랜드 콘텐츠 생성 서비스입니다.",
    contentHash: "hash",
    keywords: [],
    aliases: [],
    structuredData: {},
    sourceUrl: "https://www.danbammsg.co.kr/product",
    destinationUrl: "https://www.danbammsg.co.kr/product",
    sourceQuote: "브랜드 콘텐츠 생성 서비스입니다.",
    validFrom: null,
    validUntil: null,
  }],
  requiredLinkedStableKeys: [],
};

function repository(overrides: Record<string, unknown> = {}) {
  return {
    claimWikiCompilationItem: vi.fn(async () => item),
    getWikiCompilationGroup: vi.fn(async () => group),
    completeWikiCompilationItem: vi.fn(async () => undefined),
    failWikiCompilationItem: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("compiled Wiki page worker", () => {
  it("compiles one claimed page group and persists only validated output", async () => {
    const db = repository();
    const runCodex = vi.fn(async () => ({
      pageType: "product",
      stableKey: item.stableKey,
      title: "Brand Pilot",
      summary: "브랜드 콘텐츠 생성 서비스",
      sections: [{
        sectionKey: "overview",
        heading: "서비스 소개",
        body: "브랜드 콘텐츠를 생성합니다.",
        sourceUnitIds: ["unit-1"],
        destinationUrlId: "unit-1",
      }],
      links: [],
    }));

    await expect(runWikiCompilationItemOnce({
      workerId: "worker-1",
      db,
      runtimeDirectory: "runtime",
      timeoutMs: 120_000,
      runCodex,
    })).resolves.toEqual({ status: "completed", itemId: "item-1", pageType: "product" });

    expect(runCodex).toHaveBeenCalledTimes(1);
    expect(db.completeWikiCompilationItem).toHaveBeenCalledWith(item, expect.objectContaining({
      stableKey: item.stableKey,
      contentMarkdown: expect.stringContaining("서비스 소개"),
    }));
  });

  it("fails the item when Codex returns an unknown source", async () => {
    const db = repository();
    const runCodex = vi.fn(async () => ({
      pageType: "product",
      stableKey: item.stableKey,
      title: "Brand Pilot",
      summary: "브랜드 콘텐츠 생성 서비스",
      sections: [{
        sectionKey: "overview",
        heading: "서비스 소개",
        body: "브랜드 콘텐츠를 생성합니다.",
        sourceUnitIds: ["unknown"],
        destinationUrlId: null,
      }],
      links: [],
    }));

    await expect(runWikiCompilationItemOnce({
      workerId: "worker-1",
      db,
      runtimeDirectory: "runtime",
      timeoutMs: 120_000,
      runCodex,
    })).resolves.toEqual({ status: "failed", itemId: "item-1" });

    expect(db.completeWikiCompilationItem).not.toHaveBeenCalled();
    expect(db.failWikiCompilationItem).toHaveBeenCalledWith(item, "wiki_compiler_source_unit_unknown");
  });
});
