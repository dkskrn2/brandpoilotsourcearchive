import { describe, expect, it, vi } from "vitest";
import { refreshWiki } from "./wikiRefresh.js";

describe("Wiki refresh worker", () => {
  it("embeds FAQ and owned source chunks before replacing the active Wiki", async () => {
    const db = {
      claimWikiRefreshJob: vi.fn(async () => ({ id: "wiki-job-1", workspace_id: "workspace-1", brand_id: "brand-1", lease_token: "lease-1" })),
      getWikiSources: vi.fn(async () => [{ source_kind: "faq" as const, source_id: "source-1", title: "운영 시간", content: "질문: 운영 시간\n답변: 평일 9시부터 18시까지", content_hash: "hash" }]),
      getExistingEmbeddings: vi.fn(async () => []),
      replaceWiki: vi.fn(async () => undefined),
      completeWikiRefreshJob: vi.fn(async () => undefined),
      failWikiRefreshJob: vi.fn(async () => undefined),
    };
    await expect(refreshWiki({
      workerId: "worker-1", db, apiKey: "key", model: "text-embedding-3-small",
      embed: vi.fn(async () => [0.1, 0.2]),
    })).resolves.toMatchObject({ status: "completed", chunkCount: 1 });
    expect(db.replaceWiki).toHaveBeenCalledWith("workspace-1", "brand-1", [expect.objectContaining({ chunks: [expect.objectContaining({ embedding_model: "text-embedding-3-small" })] })]);
  });

  it("reuses an embedding for an unchanged chunk with the same model version", async () => {
    const db = {
      claimWikiRefreshJob: vi.fn(async () => ({ id: "wiki-job-1", workspace_id: "workspace-1", brand_id: "brand-1", lease_token: "lease-1" })),
      getWikiSources: vi.fn(async () => [{ source_kind: "faq" as const, source_id: "source-1", title: "운영 시간", content: "질문: 운영 시간\n답변: 평일 9시부터 18시까지", content_hash: "hash" }]),
      getExistingEmbeddings: vi.fn(async () => [{
        content_hash: "48ab492d870dc0f0611527b116e0df1d090facd63735ec3182a6e6ee9970e4ea",
        embedding: "[0.3,0.4]",
        embedding_model: "text-embedding-3-small",
        embedding_version: "v1",
      }]),
      replaceWiki: vi.fn(async () => undefined),
      completeWikiRefreshJob: vi.fn(async () => undefined),
      failWikiRefreshJob: vi.fn(async () => undefined),
    };
    const embed = vi.fn(async () => [0.1, 0.2]);

    await expect(refreshWiki({ workerId: "worker-1", db, apiKey: "key", model: "text-embedding-3-small", embed })).resolves.toMatchObject({ status: "completed" });

    expect(embed).not.toHaveBeenCalled();
    expect(db.replaceWiki).toHaveBeenCalledWith("workspace-1", "brand-1", [expect.objectContaining({
      chunks: [expect.objectContaining({ embedding: "[0.3,0.4]" })],
    })]);
  });
});
