import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { runWikiBuildItemOnce, type WikiBuildDocument } from "./wikiRefresh.js";

const item = {
  id: "item-1",
  workspace_id: "workspace-1",
  brand_id: "brand-1",
  wiki_version_id: "version-1",
  source_kind: "faq" as const,
  source_id: "source-1",
};

function wikiDb(overrides: Record<string, unknown> = {}) {
  return {
    claimWikiBuildItem: vi.fn(async () => item),
    getWikiBuildSource: vi.fn(async () => ({
      source_kind: "faq" as const,
      source_id: "source-1",
      title: "운영 시간",
      content: "질문: 운영 시간\n\n답변: 평일 9시부터 18시까지",
      content_hash: "source-hash",
      aliases: ["영업 시간"],
      keywords: ["운영"],
      structured_data: {},
      source_url: null,
    })),
    getExistingEmbeddings: vi.fn(async () => []),
    completeWikiBuildItem: vi.fn(async (_item: unknown, _document: unknown) => ({ activated: true })),
    failWikiBuildItem: vi.fn(async (_item: unknown, _error: string) => undefined),
    ...overrides,
  };
}

const baseInput = {
  workerId: "worker-1",
  apiKey: "key",
  embeddingModel: "text-embedding-3-small",
  embeddingVersion: "embedding-v1",
  curatorPromptVersion: "curator-v1",
  runtimeDirectory: "runtime",
};

describe("Wiki build item worker", () => {
  it("turns an atomic knowledge entry into one chunk without calling the curator", async () => {
    const db = wikiDb();
    const embed = vi.fn(async () => [0.1, 0.2]);
    const runCodex = vi.fn();

    await expect(runWikiBuildItemOnce({ ...baseInput, db, embed, runCodex })).resolves.toMatchObject({
      status: "completed",
      itemId: "item-1",
      chunkCount: 1,
      activated: true,
    });

    expect(runCodex).not.toHaveBeenCalled();
    expect(db.completeWikiBuildItem).toHaveBeenCalledWith(item, expect.objectContaining({
      wiki_version_id: "version-1",
      source_kind: "faq",
      is_active: false,
      normalized_json: {
        units: [expect.objectContaining({ unitType: "faq", title: "운영 시간" })],
      },
      chunks: [expect.objectContaining({
        chunk_index: 0,
        embedding_model: "text-embedding-3-small",
        embedding_version: "embedding-v1",
      })],
    }));
  });

  it("normalizes and curates an owned snapshot, chunking only a long guide section", async () => {
    const sourceQuote = "배송 일정은 결제 완료 시점과 배송 지역에 따라 달라집니다.";
    const db = wikiDb({
      claimWikiBuildItem: vi.fn(async () => ({ ...item, source_kind: "owned_snapshot" as const })),
      getWikiBuildSource: vi.fn(async () => ({
        source_kind: "owned_snapshot" as const,
        source_id: "source-1",
        title: "배송 안내",
        content: `# 배송 안내\r\n\r\n${sourceQuote}\r\n\r\n${"상세 배송 정보입니다. ".repeat(20)}`,
        content_hash: "snapshot-hash",
        aliases: [],
        keywords: [],
        structured_data: {},
        source_url: "https://example.com/shipping",
      })),
    });
    const longContent = "가".repeat(900);
    const runCodex = vi.fn(async ({ prompt }: { prompt: string }) => {
      expect(prompt).not.toContain("\r");
      expect(prompt).toContain(sourceQuote);
      return {
        units: [
          {
            unitType: "fact",
            title: "긴 단일 사실",
            content: longContent,
            keywords: [],
            aliases: [],
            sourceQuote,
            validFrom: null,
            validUntil: null,
            structuredData: {},
          },
          {
            unitType: "guide_section",
            title: "긴 배송 가이드",
            content: longContent,
            keywords: [],
            aliases: [],
            sourceQuote,
            validFrom: null,
            validUntil: null,
            structuredData: {},
          },
        ],
      };
    });

    const result = await runWikiBuildItemOnce({
      ...baseInput,
      db,
      embed: vi.fn(async () => [0.1]),
      runCodex,
    });

    expect(result).toMatchObject({ status: "completed", chunkCount: 3 });
    const document = db.completeWikiBuildItem.mock.calls[0]?.[1] as WikiBuildDocument;
    expect(document.chunks).toHaveLength(3);
    expect(document.chunks.filter((chunk: { unit_type: string }) => chunk.unit_type === "fact")).toHaveLength(1);
    expect(document.chunks.filter((chunk: { unit_type: string }) => chunk.unit_type === "guide_section")).toHaveLength(2);
  });

  it("reuses embeddings only when hash, model, embedding version, and curator prompt version all match", async () => {
    const matchingHash = crypto.createHash("sha256")
      .update("질문: 운영 시간\n\n답변: 평일 9시부터 18시까지")
      .digest("hex");
    const db = wikiDb({
      getExistingEmbeddings: vi.fn(async () => [
        {
          content_hash: matchingHash,
          embedding: "[0.3,0.4]",
          embedding_model: "text-embedding-3-small",
          embedding_version: "embedding-v1",
          curator_prompt_version: "old-curator",
        },
        {
          content_hash: matchingHash,
          embedding: "[0.5,0.6]",
          embedding_model: "text-embedding-3-small",
          embedding_version: "embedding-v1",
          curator_prompt_version: "curator-v1",
        },
      ]),
    });
    const embed = vi.fn(async () => [0.1, 0.2]);

    await runWikiBuildItemOnce({ ...baseInput, db, embed, runCodex: vi.fn() });

    expect(embed).not.toHaveBeenCalled();
    expect(db.completeWikiBuildItem).toHaveBeenCalledWith(item, expect.objectContaining({
      chunks: [expect.objectContaining({ embedding: "[0.5,0.6]" })],
    }));
  });

  it("fails the building version when owned-source curation fails", async () => {
    const claimed = { ...item, source_kind: "owned_snapshot" as const };
    const db = wikiDb({
      claimWikiBuildItem: vi.fn(async () => claimed),
      getWikiBuildSource: vi.fn(async () => ({
        source_kind: "owned_snapshot" as const,
        source_id: "source-1",
        title: "배송 안내",
        content: "배송 정책에 대한 충분히 긴 원문입니다. ".repeat(12),
        content_hash: "snapshot-hash",
        aliases: [],
        keywords: [],
        structured_data: {},
        source_url: "https://example.com/shipping",
      })),
    });

    await expect(runWikiBuildItemOnce({
      ...baseInput,
      curatorTimeoutMs: 30_000,
      db,
      embed: vi.fn(),
      runCodex: vi.fn(async () => { throw new Error("codex_timeout"); }),
    })).resolves.toEqual({ status: "failed", itemId: "item-1" });

    expect(db.completeWikiBuildItem).not.toHaveBeenCalled();
    expect(db.failWikiBuildItem).toHaveBeenCalledWith(claimed, "codex_timeout");
  });
});
