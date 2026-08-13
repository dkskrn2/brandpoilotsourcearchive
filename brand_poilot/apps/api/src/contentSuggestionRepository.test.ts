import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import { createContentSuggestionRepository } from "./contentSuggestionRepository.js";

const batch = {
  contractVersion: "content-suggestion-batch.v1" as const,
  categoryCode: "travel_tourism",
  generationDate: "2026-08-09",
  items: [{
    subcategoryCode: "domestic_travel",
    intent: "trend" as const,
    position: 1 as const,
    title: "장마철 실내 여행 코스",
    whyNow: "비 예보와 휴가 수요가 겹칩니다.",
    contentBrief: "이동 동선 중심으로 구성합니다.",
    sources: [{
      url: "https://example.org/travel",
      title: "여행 자료",
      publisher: "예시 기관",
      publishedAt: null,
    }],
  }],
};

function result(rows: Record<string, unknown>[] = []): QueryResult {
  return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows } as QueryResult;
}

function fakePool(handler: (sql: string, params: unknown[]) => QueryResult | Promise<QueryResult>) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    statements.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    return handler(sql, params);
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = {
    query,
    connect: vi.fn(async () => client),
  } as unknown as Pool;
  return { pool, client, statements };
}

describe("content suggestion scope", () => {
  it("returns the active category and ordered active subcategories", async () => {
    const { pool } = fakePool((sql) => {
      if (sql.includes("from content_categories")) {
        return result([{ id: "category-1", code: "travel_tourism", name: "여행·관광" }]);
      }
      if (sql.includes("from content_subcategories")) {
        return result([
          { code: "domestic_travel", name: "국내여행" },
          { code: "international_travel", name: "해외여행" },
        ]);
      }
      return result();
    });
    const repository = createContentSuggestionRepository(pool);

    await expect(repository.getScope("travel_tourism", new Date("2026-08-08T16:00:00Z")))
      .resolves.toEqual({
        contractVersion: "content-suggestion-scope.v1",
        generationDate: "2026-08-09",
        timezone: "Asia/Seoul",
        category: { code: "travel_tourism", name: "여행·관광" },
        subcategories: [
          { code: "domestic_travel", name: "국내여행" },
          { code: "international_travel", name: "해외여행" },
        ],
        intents: ["informational", "trend"],
        maxItemsPerSubcategoryIntent: 2,
        maxSourcesPerItem: 3,
      });
  });

  it("hides an unavailable category", async () => {
    const { pool } = fakePool(() => result());
    const repository = createContentSuggestionRepository(pool);
    await expect(repository.getScope("travel_tourism"))
      .rejects.toThrow("content_suggestion_category_unavailable");
  });
});

describe("content suggestion publication", () => {
  it("locks and atomically publishes a validated batch", async () => {
    const { pool, statements, client } = fakePool((sql) => {
      if (sql.includes("from content_categories") && sql.includes("for share")) {
        return result([{ id: "category-1", code: "travel_tourism", name: "여행·관광" }]);
      }
      if (sql.includes("from content_subcategories")) {
        return result([{ id: "subcategory-1", code: "domestic_travel", name: "국내여행", sort_order: 1 }]);
      }
      if (sql.includes("from content_suggestion_batches") && sql.includes("for update")) return result();
      if (sql.includes("insert into content_suggestion_batches")) return result([{ id: "batch-1" }]);
      if (sql.includes("insert into content_suggestions")) return result([{ id: "item-1" }]);
      return result();
    });
    const repository = createContentSuggestionRepository(pool);

    await expect(repository.publish(batch, new Date("2026-08-09T01:00:00Z")))
      .resolves.toEqual({
        contractVersion: "content-suggestion-publish-result.v1",
        status: "published",
        batchId: "batch-1",
        savedCount: 1,
        generationDate: "2026-08-09",
      });

    expect(statements.map(({ sql }) => sql)).toEqual(expect.arrayContaining([
      "begin",
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("insert into content_suggestion_batches"),
      expect.stringContaining("insert into content_suggestions"),
      expect.stringContaining("delete from content_suggestions"),
      expect.stringContaining("update content_suggestion_batches"),
      "commit",
    ]));
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rejects a subcategory outside the active category and rolls back", async () => {
    const invalid = {
      ...batch,
      items: [{ ...batch.items[0], subcategoryCode: "hotel" }],
    };
    const { pool, statements } = fakePool((sql) => {
      if (sql.includes("from content_categories") && sql.includes("for share")) {
        return result([{ id: "category-1", code: "travel_tourism", name: "여행·관광" }]);
      }
      if (sql.includes("from content_subcategories")) {
        return result([{ id: "subcategory-1", code: "domestic_travel", name: "국내여행", sort_order: 1 }]);
      }
      return result();
    });
    const repository = createContentSuggestionRepository(pool);

    await expect(repository.publish(invalid, new Date("2026-08-09T01:00:00Z")))
      .rejects.toThrow("content_suggestion_subcategory_unavailable");
    expect(statements.some(({ sql }) => sql === "rollback")).toBe(true);
    expect(statements.some(({ sql }) => sql.includes("insert into content_suggestion"))).toBe(false);
  });

  it("rejects a stale generation date before storage", async () => {
    const { pool, statements } = fakePool(() => result());
    const repository = createContentSuggestionRepository(pool);
    await expect(repository.publish(batch, new Date("2026-08-10T01:00:00Z")))
      .rejects.toThrow("content_suggestion_generation_date_mismatch");
    expect(statements).toHaveLength(0);
  });
});

describe("brand-scoped suggestion reads", () => {
  it("prioritizes selected system subcategories up to six and keeps the rest general", async () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({
      id: `suggestion-${index + 1}`,
      subcategory_code: index < 7 ? "domestic_travel" : "international_travel",
      subcategory_name: index < 7 ? "국내여행" : "해외여행",
      subcategory_sort_order: index < 7 ? 1 : 2,
      intent: index % 2 === 0 ? "informational" : "trend",
      position: index < 4 ? 1 : 2,
      title: `주제 ${index + 1}`,
      why_now: `이유 ${index + 1}`,
      content_brief: `구성 ${index + 1}`,
      selected: index < 7,
    }));
    const { pool } = fakePool((sql) => {
      if (sql.includes("from brand_profiles profile") && sql.includes("content_categories")) {
        return result([{ id: "category-1", code: "travel_tourism", name: "여행·관광" }]);
      }
      if (sql.includes("from content_suggestion_batches")) return result([{ id: "batch-1" }]);
      if (sql.includes("from content_suggestions suggestion")) return result(rows);
      return result();
    });
    const repository = createContentSuggestionRepository(pool);

    const listed = await repository.listForBrand("brand-1");
    expect(listed.category).toEqual({ code: "travel_tourism", name: "여행·관광" });
    expect(listed.personal).toHaveLength(6);
    expect(listed.general).toHaveLength(2);
    const personalIds = new Set(listed.personal.map((entry) => entry.id));
    expect(listed.general.some((entry) => personalIds.has(entry.id))).toBe(false);
    expect(JSON.stringify(listed)).not.toContain("sources");
    expect(JSON.stringify(listed)).not.toContain("generationDate");
  });

  it("returns an empty response when the brand has no active category", async () => {
    const { pool } = fakePool(() => result());
    const repository = createContentSuggestionRepository(pool);
    await expect(repository.listForBrand("brand-1")).resolves.toEqual({
      category: null,
      personal: [],
      general: [],
    });
  });

  it("returns a single suggestion only through the brand category boundary", async () => {
    const { pool } = fakePool((sql) => sql.includes("from content_suggestions suggestion")
      ? result([{
        id: "suggestion-1",
        subcategory_code: "domestic_travel",
        subcategory_name: "국내여행",
        intent: "trend",
        title: "주제",
        why_now: "이유",
        content_brief: "구성",
      }])
      : result());
    const repository = createContentSuggestionRepository(pool);
    await expect(repository.getForBrand("brand-1", "suggestion-1")).resolves.toEqual({
      id: "suggestion-1",
      subcategoryCode: "domestic_travel",
      subcategoryName: "국내여행",
      intent: "trend",
      title: "주제",
      whyNow: "이유",
      contentBrief: "구성",
    });
  });
});
