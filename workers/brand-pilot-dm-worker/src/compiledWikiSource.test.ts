import { describe, expect, it, vi } from "vitest";
import { runCompiledWikiSourceItemOnce } from "./compiledWikiSource.js";

const item = {
  id: "item-1",
  workspace_id: "workspace-1",
  brand_id: "brand-1",
  wiki_version_id: "version-1",
  source_kind: "product" as const,
  source_id: "11111111-1111-4111-8111-111111111111",
};

function db(overrides: Record<string, unknown> = {}) {
  return {
    claimWikiBuildItem: vi.fn(async () => item),
    getWikiBuildSource: vi.fn(async () => ({
      source_kind: "product" as const,
      source_id: item.source_id,
      title: "Brand Pilot",
      content: "브랜드 콘텐츠 생성 서비스입니다.",
      content_hash: "source-hash",
      aliases: [],
      keywords: ["콘텐츠"],
      structured_data: {
        sku: "BP-001",
        productUrl: "https://www.danbammsg.co.kr/product",
      },
      source_url: null,
    })),
    completeWikiSourceItem: vi.fn(async () => ({ collectionComplete: false })),
    failWikiBuildItem: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("compiled Wiki source collection", () => {
  it("stores direct product data as source units without embedding", async () => {
    const repository = db();

    await expect(runCompiledWikiSourceItemOnce({
      workerId: "worker-1",
      db: repository,
      curatorPromptVersion: "curator-v1",
      embeddingModel: "text-embedding-3-small",
      embeddingVersion: "v1",
      runtimeDirectory: "runtime",
      runCodex: vi.fn(),
    })).resolves.toEqual({ status: "completed", itemId: "item-1", unitCount: 1, collectionComplete: false });

    expect(repository.completeWikiSourceItem).toHaveBeenCalledWith(item, [expect.objectContaining({
      stableKey: "product:sku:bp-001",
      destinationUrl: "https://www.danbammsg.co.kr/product",
    })]);
  });

  it("curates an owned source and stores canonical source URLs", async () => {
    const ownedItem = { ...item, source_kind: "owned_snapshot" as const };
    const repository = db({
      claimWikiBuildItem: vi.fn(async () => ownedItem),
      getWikiBuildSource: vi.fn(async () => ({
        source_kind: "owned_snapshot" as const,
        source_id: ownedItem.source_id,
        title: "서비스 안내",
        content: "콘텐츠 운영 서비스는 자사 자료를 바탕으로 게시물을 생성합니다. ".repeat(4),
        content_hash: "snapshot-hash",
        aliases: [],
        keywords: [],
        structured_data: {},
        source_url: "https://www.danbammsg.co.kr/service#top",
      })),
    });
    const runCodex = vi.fn(async () => ({
      units: [{
        unitType: "service",
        title: "콘텐츠 운영 서비스",
        content: "자사 자료 기반 콘텐츠 운영 서비스입니다.",
        keywords: ["콘텐츠 운영"],
        aliases: [],
        sourceQuote: "콘텐츠 운영 서비스는 자사 자료를 바탕으로 게시물을 생성합니다.",
        validFrom: null,
        validUntil: null,
        structuredData: {},
      }],
    }));

    await runCompiledWikiSourceItemOnce({
      workerId: "worker-1",
      db: repository,
      curatorPromptVersion: "curator-v1",
      embeddingModel: "text-embedding-3-small",
      embeddingVersion: "v1",
      runtimeDirectory: "runtime",
      runCodex,
    });

    expect(repository.completeWikiSourceItem).toHaveBeenCalledWith(ownedItem, [expect.objectContaining({
      unitType: "service",
      sourceUrl: "https://www.danbammsg.co.kr/service",
      destinationUrl: "https://www.danbammsg.co.kr/service",
    })]);
  });

  it("records a failed source item without activating a partial Wiki", async () => {
    const repository = db({
      getWikiBuildSource: vi.fn(async () => { throw new Error("wiki_build_source_not_found"); }),
    });

    await expect(runCompiledWikiSourceItemOnce({
      workerId: "worker-1",
      db: repository,
      curatorPromptVersion: "curator-v1",
      embeddingModel: "text-embedding-3-small",
      embeddingVersion: "v1",
      runtimeDirectory: "runtime",
      runCodex: vi.fn(),
    })).resolves.toEqual({ status: "failed", itemId: "item-1" });

    expect(repository.completeWikiSourceItem).not.toHaveBeenCalled();
    expect(repository.failWikiBuildItem).toHaveBeenCalledWith(item, "wiki_build_source_not_found");
  });
});
