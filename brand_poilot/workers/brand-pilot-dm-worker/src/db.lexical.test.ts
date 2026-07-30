import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class LexicalPool {
    query(sql: string, values: unknown[] = []) {
      return harness.query(sql, values);
    }

    async end() {}
  },
}));

describe("compiled Wiki lexical repository", () => {
  beforeEach(() => {
    harness.query.mockReset();
  });

  it("reads the active version, Brand Core, and lexical chunks in one PostgreSQL statement", async () => {
    harness.query.mockImplementation(async (sql: string) => {
      if (sql.includes("search_brand_wiki_lexical")) {
        return {
          rowCount: 1,
          rows: [{
            wiki_version_id: "version-1",
            brand_core: { summary: "Brand Pilot" },
            page_chunk_id: "chunk-1",
            wiki_page_id: "page-1",
            page_type: "faq",
            title: "운영 시간",
            content: "평일 9시부터 18시까지 운영합니다.",
            source_link_ids: [],
            cosine_similarity: 0,
            keyword_match: 0.75,
            rrf_score: 7.25,
          }],
        };
      }
      throw new Error(`unexpected_query:${sql}`);
    });
    const { createDmWorkerDb } = await import("./db.js");
    const db = createDmWorkerDb("postgresql://lexical-test");

    await expect(db.searchCompiledWiki("workspace-1", "brand-1", "운영 시간"))
      .resolves.toEqual({
        wikiVersionId: "version-1",
        brandCore: JSON.stringify({ summary: "Brand Pilot" }),
        chunks: [{
          chunkId: "chunk-1",
          pageId: "page-1",
          pageType: "faq",
          title: "운영 시간",
          content: "평일 9시부터 18시까지 운영합니다.",
          cosineSimilarity: 0,
          keywordMatch: 0.75,
          rrfScore: 7.25,
        }],
        destinationUrls: [],
      });

    expect(harness.query).toHaveBeenCalledTimes(1);
    const [sql, values] = harness.query.mock.calls[0];
    expect(sql).toMatch(/with active_version as materialized/i);
    expect(sql).toMatch(/left join lateral search_brand_wiki_lexical/i);
    expect(values).toEqual([
      "workspace-1",
      "brand-1",
      "운영 시간",
      12,
      false,
      false,
      false,
    ]);
  });

  it.each([
    ["어떤 제품이 있나요?", [true, true, false]],
    ["어떤 서비스를 제공하나요?", [true, false, false]],
    ["자세한 제품 정보는 어디에서 확인하나요?", [true, true, true]],
  ])("passes lexical offering intent flags for %s", async (question, flags) => {
    harness.query.mockResolvedValue({
      rowCount: 1,
      rows: [{
        wiki_version_id: "version-1",
        brand_core: {},
        page_chunk_id: "chunk-1",
        wiki_page_id: "page-1",
        page_type: "product",
        title: "상품",
        content: "상품 안내",
        source_link_ids: [],
        cosine_similarity: 0,
        keyword_match: 0.5,
        rrf_score: 1,
      }],
    });
    const { createDmWorkerDb } = await import("./db.js");
    const db = createDmWorkerDb("postgresql://lexical-test");

    await db.searchCompiledWiki("workspace-1", "brand-1", question);

    expect(harness.query.mock.calls[0]?.[1]).toEqual([
      "workspace-1",
      "brand-1",
      question,
      12,
      ...flags,
    ]);
  });
});
