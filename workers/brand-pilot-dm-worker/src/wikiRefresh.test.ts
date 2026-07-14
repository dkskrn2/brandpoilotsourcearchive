import { describe, expect, it, vi } from "vitest";
import { refreshWiki } from "./wikiRefresh.js";

describe("Wiki refresh worker", () => {
  it("embeds FAQ and owned source chunks before replacing the active Wiki", async () => {
    const db = {
      claimWikiRefreshJob: vi.fn(async () => ({ id: "wiki-job-1", workspace_id: "workspace-1", brand_id: "brand-1", lease_token: "lease-1" })),
      getWikiSources: vi.fn(async () => [{ source_kind: "faq" as const, source_id: "source-1", title: "운영 시간", content: "질문: 운영 시간\n답변: 평일 9시부터 18시까지", content_hash: "hash" }]),
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
});
