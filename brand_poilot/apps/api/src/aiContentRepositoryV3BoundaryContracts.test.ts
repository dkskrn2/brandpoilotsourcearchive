import { describe, expect, it, vi } from "vitest";
import { createAiContentRepository } from "./aiContentRepository.js";

const ids = {
  workspace: "20000000-0000-4000-8000-000000000001",
  brand: "20000000-0000-4000-8000-000000000002",
  actor: "20000000-0000-4000-8000-000000000003",
  generation: "20000000-0000-4000-8000-000000000004",
  output: "20000000-0000-4000-8000-000000000005",
  proposal: "20000000-0000-4000-8000-000000000006",
  reference: "20000000-0000-4000-8000-000000000007",
} as const;

type Repository = ReturnType<typeof createAiContentRepository>;

const scope = { workspaceId: ids.workspace, brandId: ids.brand };

const writeCases = [
  {
    label: "V3 start",
    invoke: (repository: Repository, actorUserId: string) => repository.startAiContentGenerationV3({
      ...scope,
      generationId: ids.generation,
      actorUserId,
      contractVersion: "content-generation-start.v2",
      idempotencyKey: "start-boundary-1",
      usageDate: "2026-08-06",
      dailyGenerationLimit: 10,
    }, {} as never),
  },
  {
    label: "V3 retry",
    invoke: (repository: Repository, actorUserId: string) => repository.retryAiContentOutput({
      ...scope,
      outputId: ids.output,
      actorUserId,
      contractVersion: "content-generation-retry.v1",
      idempotencyKey: "retry-boundary-1",
      reason: "생성 실패 재시도",
      usageDate: "2026-08-06",
      dailyGenerationLimit: 10,
    }),
  },
  {
    label: "proposal selection",
    invoke: (repository: Repository, actorUserId: string) => repository.selectAiContentProposal({
      ...scope,
      proposalId: ids.proposal,
      actorUserId,
      idempotencyKey: "selection-boundary-1",
    }),
  },
  {
    label: "finalization",
    invoke: (repository: Repository, actorUserId: string) => repository.updateAiContentFinalizationDraft({
      ...scope,
      generationId: ids.generation,
      actorUserId,
      draft: {
        contractVersion: "content-finalization-draft.v2",
        avatarStyleImageId: null,
        userImageInstruction: null,
        attachmentIds: [],
      },
    }),
  },
] as const;

function transactionHarness(mode: "maintenance" | "forbidden") {
  const statements: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      statements.push(sql);
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql === "select assert_ai_content_writable()") {
        if (mode === "maintenance") throw new Error("ai_content_maintenance");
        return { rows: [{ ok: true }], rowCount: 1 };
      }
      if (sql.includes("from workspace_members member")) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected_repository_lookup:${sql}`);
    }),
    release: vi.fn(),
  };
  return {
    statements,
    repository: createAiContentRepository({ connect: async () => client, query: client.query } as never),
  };
}

const mutations = (statements: string[]) => statements.filter((sql) => (
  /\b(?:insert|update|delete)\b/i.test(sql)
));

describe("AI content V3 repository maintenance and authorization boundary", () => {
  it.each(writeCases)("blocks $label at the transaction guard with zero mutation", async ({ invoke }) => {
    const run = transactionHarness("maintenance");

    await expect(invoke(run.repository, ids.actor)).rejects.toThrow(/^ai_content_maintenance$/);

    expect(run.statements).toEqual([
      "BEGIN",
      "select assert_ai_content_writable()",
      "ROLLBACK",
    ]);
    expect(mutations(run.statements)).toEqual([]);
  });

  it.each(writeCases)("rejects an unauthorized actor before any $label replay or resource lookup", async ({ invoke }) => {
    const run = transactionHarness("forbidden");

    await expect(invoke(run.repository, ids.actor)).rejects.toThrow(/^ai_content_actor_forbidden$/);

    expect(run.statements[0]).toBe("BEGIN");
    expect(run.statements[1]).toBe("select assert_ai_content_writable()");
    expect(run.statements[2]).toContain("from workspace_members member");
    expect(run.statements.at(-1)).toBe("ROLLBACK");
    expect(run.statements).toHaveLength(4);
    expect(mutations(run.statements)).toEqual([]);
  });

  it.each(writeCases)("rejects a missing actor after the guard and before any $label lookup", async ({ invoke }) => {
    const run = transactionHarness("forbidden");

    await expect(invoke(run.repository, "")).rejects.toThrow(/^ai_content_actor_required$/);

    expect(run.statements).toEqual([
      "BEGIN",
      "select assert_ai_content_writable()",
      "ROLLBACK",
    ]);
    expect(mutations(run.statements)).toEqual([]);
  });
});

const referenceRow = {
  id: ids.reference,
  source: "saved_url",
  title: "검증된 레퍼런스",
  url: "https://example.com/reference",
  preview_url: null,
  metrics: {},
  checked_at: "2026-08-06T00:00:00.000Z",
};

describe("AI content live reference picker read contract", () => {
  it.each([
    ["matching blog format", ["blog"], true],
    ["mismatched reel format", ["reel"], false],
  ] as const)("uses canonical reference_items.id for %s", async (_label, formats, shouldMatch) => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return shouldMatch
        ? { rows: [referenceRow], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    });

    const result = await createAiContentRepository({ query } as never).listAiContentReferences({
      ...scope,
      type: "blog",
      strategies: ["how_to"],
      formats: [...formats],
      tags: ["운영"],
    });

    expect(result.map((item) => item.id)).toEqual(shouldMatch ? [ids.reference] : []);
    const call = calls[0]!;
    expect(call.params).toEqual([
      ids.workspace,
      ids.brand,
      ["how_to"],
      [...formats],
      ["운영"],
    ]);
    expect(call.sql).toContain("select item.id, 'saved_url' as source");
    expect(call.sql).not.toContain("select source.id, 'saved_url' as source");
    expect(call.sql).toContain("item.workspace_id = $1");
    expect(call.sql).toContain("item.brand_id = $2");
    expect(call.sql).toContain("canonical_snapshot.reference_item_id=item.id");
    expect(call.sql).toContain("canonical_snapshot.workspace_id=item.workspace_id");
    expect(call.sql).toContain("canonical_snapshot.brand_id=item.brand_id");
    expect(call.sql).toContain("snapshot_json->>'sourceAvailability'");
    expect(call.sql).toContain("'available') = 'available'");
    expect(call.sql).toContain("item.content_purpose in ('informational', 'both')");
    expect(call.sql).toContain("$4::text[] && array['blog']::text[]");
  });

  it("keeps reel marketing references tenant-scoped, available, purpose-matched, and format-compatible", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    });

    await createAiContentRepository({ query } as never).listAiContentReferences({
      ...scope,
      type: "marketing",
      formats: ["blog"],
    });

    const call = calls[0]!;
    expect(call.params).toEqual([ids.workspace, ids.brand, [], ["blog"], []]);
    expect(call.sql).toContain("select reference_filter.id, 'brand_output' as source");
    expect(call.sql).toContain("select item.id, 'saved_url' as source");
    expect(call.sql).not.toContain("select co.id, 'brand_output' as source");
    expect(call.sql).not.toContain("select source.id, 'saved_url' as source");
    expect(call.sql).toContain("reference_filter.workspace_id = $1");
    expect(call.sql).toContain("reference_filter.brand_id = $2");
    expect(call.sql).toContain("item.content_purpose in ('marketing', 'both')");
    expect(call.sql.match(/\$4::text\[\] && array\['reel'\]::text\[\]/g)).toHaveLength(2);
    expect(call.sql.match(/snapshot_json->>'sourceAvailability'/g)).toHaveLength(2);
  });
});
