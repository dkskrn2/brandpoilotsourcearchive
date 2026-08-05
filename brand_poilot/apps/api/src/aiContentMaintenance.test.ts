import { describe, expect, it, vi } from "vitest";
import { assertAiContentWritable, withAiContentTransactionFence } from "./aiContentMaintenance.js";
import { enqueueAutomatedCardNews } from "./automatedCardNews.js";

describe("AI content maintenance write guard", () => {
  it("delegates to the database root guard exactly once", async () => {
    const query = vi.fn(async () => ({ rows: [{ assert_ai_content_writable: null }], rowCount: 1 }));

    await expect(assertAiContentWritable({ query } as never)).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith("select assert_ai_content_writable()");
  });

  it("preserves the stable maintenance error without translating it", async () => {
    const maintenance = Object.assign(new Error("ai_content_maintenance"), { code: "P0001" });
    const query = vi.fn(async () => { throw maintenance; });

    await expect(assertAiContentWritable({ query } as never)).rejects.toBe(maintenance);
  });

  it("is compatible only with a pre-074 database and fails closed after its marker", async () => {
    const missing = Object.assign(new Error("undefined function"), { code: "42883" });
    const before = vi.fn()
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce({ rows: [{ installed: false }] });
    await expect(assertAiContentWritable({ query: before } as never)).resolves.toBeUndefined();

    const after = vi.fn()
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce({ rows: [{ installed: true }] });
    await expect(assertAiContentWritable({ query: after } as never))
      .rejects.toThrow("ai_content_maintenance_guard_missing");
  });

  it("runs the guard immediately after BEGIN for delegated repositories", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const pool = withAiContentTransactionFence({
      connect: vi.fn(async () => client),
    } as never);
    const guardedClient = await pool.connect();

    await guardedClient.query("BEGIN");
    await guardedClient.query("insert into ai_content_proposal_jobs default values");

    expect(statements).toEqual([
      "BEGIN",
      "select assert_ai_content_writable()",
      "insert into ai_content_proposal_jobs default values",
    ]);
  });

  it("blocks an enabled automated proposal before its first source or execution write", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "select assert_ai_content_writable()") throw new Error("ai_content_maintenance");
      throw new Error(`unexpected_query:${sql}`);
    });

    await expect(enqueueAutomatedCardNews({ query }, {
      workspaceId: "10000000-0000-4000-8000-000000000001",
      brandId: "20000000-0000-4000-8000-000000000002",
      contentTopicId: "30000000-0000-4000-8000-000000000003",
      channelOutputId: "40000000-0000-4000-8000-000000000004",
      brand: { name: "Brand" },
      topic: { title: "Topic", angle: "Angle" },
      representativeUrl: null,
      sourceMaterials: [],
    }, { automatedContentEnabled: true })).rejects.toThrow("ai_content_maintenance");

    expect(query).toHaveBeenCalledTimes(1);
  });
});
