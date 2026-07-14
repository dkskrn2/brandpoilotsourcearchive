import { describe, expect, it, vi } from "vitest";
import { createRepository } from "./repository.js";

function fakePool(query: ReturnType<typeof vi.fn>) {
  return {
    query,
    connect: vi.fn(async () => ({ query, release: vi.fn() })),
  };
}

describe("DM Wiki repository", () => {
  it("upserts only the final valid duplicate FAQ row and queues one refresh job", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("select workspace_id from brands")) return { rowCount: 1, rows: [{ workspace_id: "workspace-1" }] };
      if (sql.includes("insert into knowledge_imports")) return {
        rowCount: 1,
        rows: [{
          id: "import-1",
          file_name: values[2],
          status: "succeeded",
          result_json: JSON.parse(String(values[4])),
          created_at: new Date("2026-07-14T00:00:00.000Z"),
        }],
      };
      if (sql.includes("insert into jobs")) return { rowCount: 1, rows: [{ id: "job-1", status: "queued" }] };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePool(query) as any);

    const result = await repository.createKnowledgeImport("brand-1", {
      fileName: "faq.csv",
      fileBase64: Buffer.from("question,answer\n운영 시간,09-18\n운영   시간,10-19\n,잘못된 행\n").toString("base64"),
    });

    expect(result).toMatchObject({ totalRows: 3, validRows: 2, duplicateRows: 1, invalidRows: 1, updatedRows: 1 });
    const entryInsert = statements.find((statement) => statement.sql.includes("insert into knowledge_entries"));
    expect(entryInsert?.values).toContain("10-19");
    expect(entryInsert?.values).not.toContain("09-18");
    const jobInsert = statements.find((statement) => statement.sql.includes("insert into jobs"));
    expect(jobInsert?.sql).toContain("'wiki_refresh'");
    expect(jobInsert?.values).toContain("brand-1");
  });
});
