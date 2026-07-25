import { describe, expect, it, vi } from "vitest";
import { chunkCompiledWikiPage, runWikiFinalizeOnce } from "./compiledWikiFinalize.js";

const item = {
  id: "item-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  wikiVersionId: "version-1",
  leaseToken: "lease-1",
};

const pages = [{
  id: "page-1",
  pageType: "brand_overview" as const,
  stableKey: "brand-overview",
  title: "브랜드 소개",
  summary: "브랜드 요약",
  contentMarkdown: "## 소개\n\n브랜드 설명",
  contentHash: "page-hash",
  promptVersion: "v1",
}, {
  id: "page-2",
  pageType: "catalog" as const,
  stableKey: "catalog",
  title: "서비스 목록",
  summary: "서비스 요약",
  contentMarkdown: "## 서비스\n\nBrand Pilot",
  contentHash: "catalog-hash",
  promptVersion: "v1",
}];

describe("compiled Wiki finalization", () => {
  it("keeps compact pages as one chunk and only splits long guides", () => {
    expect(chunkCompiledWikiPage(pages[0])).toHaveLength(1);
    const guide = {
      ...pages[0],
      pageType: "guide" as const,
      contentMarkdown: "가".repeat(1_500),
    };
    const chunks = chunkCompiledWikiPage(guide);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= 800)).toBe(true);
  });

  it("embeds missing chunks and completes a ready version without activating it", async () => {
    const db = {
      claimWikiValidationItem: vi.fn(async () => item),
      getWikiPagesForFinalization: vi.fn(async () => pages),
      getReusablePageEmbeddings: vi.fn(async () => []),
      completeWikiValidationItem: vi.fn(async () => undefined),
      failWikiValidationItem: vi.fn(async () => undefined),
    };
    const embed = vi.fn(async () => Array.from({ length: 1536 }, () => 0.1));

    await expect(runWikiFinalizeOnce({
      workerId: "worker-1",
      db,
      apiKey: "key",
      embeddingModel: "text-embedding-3-small",
      embeddingVersion: "v1",
      embed,
    })).resolves.toEqual({ status: "ready", itemId: "item-1", chunkCount: 2 });

    expect(embed).toHaveBeenCalledTimes(2);
    expect(db.completeWikiValidationItem).toHaveBeenCalledTimes(1);
  });

  it("reuses a matching embedding", async () => {
    const db = {
      claimWikiValidationItem: vi.fn(async () => item),
      getWikiPagesForFinalization: vi.fn(async () => pages.slice(0, 1)),
      getReusablePageEmbeddings: vi.fn(async (_brandId: string, hashes: string[]) => [{
        contentHash: hashes[0],
        embedding: Array.from({ length: 1536 }, () => 0.2),
      }]),
      completeWikiValidationItem: vi.fn(async () => undefined),
      failWikiValidationItem: vi.fn(async () => undefined),
    };
    const embed = vi.fn();
    await runWikiFinalizeOnce({
      workerId: "worker-1",
      db,
      apiKey: "key",
      embeddingModel: "text-embedding-3-small",
      embeddingVersion: "v1",
      embed,
    });
    expect(embed).not.toHaveBeenCalled();
  });
});
