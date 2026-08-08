import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createRepository } from "./repository.js";

describe("repository AI-content pool isolation", () => {
  it("routes AI-content usage reads only through the dedicated content pool", async () => {
    const mainQuery = vi.fn(async () => {
      throw new Error("main_pool_must_not_receive_ai_content_sql");
    });
    const contentQuery = vi.fn(async (sql: string) => {
      expect(sql).toContain("from ai_content_usage_ledger");
      return { rows: [{ generation_count: 2, download_count: 1 }], rowCount: 1 };
    });
    const repository = createRepository(
      { query: mainQuery } as unknown as Pool,
      { aiContentPool: { query: contentQuery } as unknown as Pool },
    );

    await expect(repository.listAiContentUsage({
      workspaceId: "20000000-0000-4000-8000-000000000002",
      brandId: "30000000-0000-4000-8000-000000000003",
      usageDate: "2026-08-06",
    })).resolves.toEqual({ usageDate: "2026-08-06", generationCount: 2, downloadCount: 1 });
    expect(contentQuery).toHaveBeenCalledTimes(1);
    expect(mainQuery).not.toHaveBeenCalled();
  });
});
