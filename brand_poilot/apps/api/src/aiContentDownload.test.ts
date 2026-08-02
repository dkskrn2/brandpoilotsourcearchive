import { describe, expect, it, vi } from "vitest";
import { createAiContentDownloadRepository } from "./aiContentDownload.js";

const output = {
  id: "33333333-3333-4333-8333-333333333333",
  generation_id: "22222222-2222-4222-8222-222222222222",
  output_index: 1,
  type: "card_news",
  title: "여름 추천",
  status: "completed",
  artifact_manifest_json: {
    version: "ai-content.v1",
    type: "card_news",
    title: "여름 추천",
    assets: [{ role: "slide", url: "https://test.public.blob.vercel-storage.com/slide-01.png", fileName: "slide-01.png", mimeType: "image/png", width: 1080, height: 1080, index: 1 }],
    content: { caption: "여름 준비", hashtags: ["여름"], cta: "저장해 두세요." },
  },
  content_json: { caption: "여름 준비", hashtags: ["여름"] },
};

const secondOutput = {
  ...output,
  id: "44444444-4444-4444-8444-444444444444",
  output_index: 2,
  title: "가을 추천",
};

function setup() {
  const keys = new Set<string>();
  let ledgerInserts = 0;
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/select count\(\*\).*ai_content_usage_ledger/s.test(sql)) return { rows: [{ count: keys.size }] };
      if (/select idempotency_key from ai_content_usage_ledger/s.test(sql)) return { rows: [...keys].map((idempotency_key) => ({ idempotency_key })) };
      if (/insert into ai_content_usage_ledger/s.test(sql)) { keys.add(String(params?.[5])); ledgerInserts += 1; return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(async () => ({ rows: [output] })),
    connect: vi.fn(async () => client),
  };
  const fetchImpl = vi.fn(async () => new Response(Buffer.from("png"), { status: 200, headers: { "content-length": "3", "content-type": "image/png" } }));
  return { repository: createAiContentDownloadRepository(pool as never, { fetchImpl: fetchImpl as typeof fetch }), client, fetchImpl, ledgerInserts: () => ledgerInserts };
}

describe("createAiContentDownloadRepository", () => {
  it("builds a ZIP and records a new download only once", async () => {
    const { repository, client, ledgerInserts } = setup();
    const input = { workspaceId: "workspace-1", brandId: "brand-1", outputId: output.id, usageDate: "2026-07-18", dailyDownloadLimit: 20 };

    const first = await repository.downloadAiContentOutput(input);
    const second = await repository.downloadAiContentOutput(input);

    expect(first.mimeType).toBe("application/zip");
    expect(first.buffer.subarray(0, 2).toString()).toBe("PK");
    expect(second.itemCount).toBe(1);
    expect(ledgerInserts()).toBe(1);
    const lockIndex = client.query.mock.calls.findIndex(([sql]) => String(sql).includes("pg_advisory_xact_lock"));
    const countIndex = client.query.mock.calls.findIndex(([sql]) => /select count\(\*\).*ai_content_usage_ledger/s.test(String(sql)));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(countIndex);
  });

  it("rejects an output that is not completed", async () => {
    const { repository } = setup();
    output.status = "queued";
    await expect(repository.downloadAiContentOutput({ workspaceId: "workspace-1", brandId: "brand-1", outputId: output.id, usageDate: "2026-07-18", dailyDownloadLimit: 20 })).rejects.toThrow("ai_content_output_not_completed");
    output.status = "completed";
  });

  it("does not alter usage or downloaded state when ZIP construction fails", async () => {
    const { client, fetchImpl, ledgerInserts } = setup();
    const pool = {
      query: vi.fn(async () => ({ rows: [output] })),
      connect: vi.fn(async () => client),
    };
    const repository = createAiContentDownloadRepository(pool as never, {
      fetchImpl: fetchImpl as typeof fetch,
      zipBuilder: () => {
        throw new Error("zip_build_failed");
      },
    });

    await expect(repository.downloadAiContentOutput({
      workspaceId: "workspace-1",
      brandId: "brand-1",
      outputId: output.id,
      usageDate: "2026-07-18",
      dailyDownloadLimit: 20,
    })).rejects.toThrow("zip_build_failed");

    expect(ledgerInserts()).toBe(0);
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("update ai_content_generation_outputs"),
      expect.anything(),
    );
  });

  it("serializes concurrent downloads so only the twentieth new result is charged", async () => {
    const keys = new Set(Array.from({ length: 19 }, (_, index) => `existing:${index}`));
    let lockTail = Promise.resolve();
    let updatedOutputs = 0;
    const pool = {
      query: vi.fn(async (_sql: string, params?: unknown[]) => ({
        rows: [params?.[0] === secondOutput.id ? secondOutput : output],
      })),
      connect: vi.fn(async () => {
        let releaseLock: (() => void) | null = null;
        return {
          query: vi.fn(async (sql: string, params?: unknown[]) => {
            if (sql === "BEGIN") return { rows: [], rowCount: 0 };
            if (sql.includes("pg_advisory_xact_lock")) {
              const previous = lockTail;
              lockTail = new Promise<void>((resolve) => { releaseLock = resolve; });
              await previous;
              return { rows: [], rowCount: 1 };
            }
            if (/select count\(\*\).*ai_content_usage_ledger/s.test(sql)) return { rows: [{ count: keys.size }] };
            if (/select idempotency_key from ai_content_usage_ledger/s.test(sql)) {
              return { rows: [...keys].filter((key) => (params?.[2] as string[]).includes(key)).map((idempotency_key) => ({ idempotency_key })) };
            }
            if (/insert into ai_content_usage_ledger/s.test(sql)) {
              keys.add(String(params?.[5]));
              return { rows: [], rowCount: 1 };
            }
            if (sql.includes("update ai_content_generation_outputs")) {
              updatedOutputs += 1;
              return { rows: [], rowCount: 1 };
            }
            if (sql === "COMMIT" || sql === "ROLLBACK") {
              releaseLock?.();
              releaseLock = null;
              return { rows: [], rowCount: 0 };
            }
            return { rows: [], rowCount: 0 };
          }),
          release: vi.fn(),
        };
      }),
    };
    const repository = createAiContentDownloadRepository(pool as never, {
      fetchImpl: vi.fn(async () => new Response(Buffer.from("png"), { status: 200 })) as never,
    });
    const common = {
      workspaceId: "workspace-1",
      brandId: "brand-1",
      usageDate: "2026-07-18",
      dailyDownloadLimit: 20,
    };

    const results = await Promise.allSettled([
      repository.downloadAiContentOutput({ ...common, outputId: output.id }),
      repository.downloadAiContentOutput({ ...common, outputId: secondOutput.id }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ message: "ai_content_download_limit_reached" }) }),
    ]);
    expect(keys.size).toBe(20);
    expect(updatedOutputs).toBe(1);
  });

  it("packages a v2 blog with HTML and zero or optional inline images from its owned prefix", async () => {
    const entriesByCall: string[][] = [];
    const v2Blog = {
      ...output,
      type: "blog",
      artifact_manifest_json: {
        version: "ai-content.v2",
        type: "blog",
        purpose: "informational",
        outputFormat: "blog",
        title: "검색형 블로그",
        assets: [{
          role: "html",
          index: 1,
          url: `https://assets.public.blob.vercel-storage.com/ai-content/brand-1/${output.generation_id}/${output.id}/content.html`,
          fileName: "content.html",
          mimeType: "text/html",
        }],
        content: { title: "검색형 블로그", html: "<article><h1>검색형 블로그</h1></article>" },
      },
      content_json: { title: "검색형 블로그", html: "<article><h1>검색형 블로그</h1></article>" },
    };
    const { client } = setup();
    const pool = {
      query: vi.fn(async () => ({ rows: [v2Blog] })),
      connect: vi.fn(async () => client),
    };
    const repository = createAiContentDownloadRepository(pool as never, {
      fetchImpl: vi.fn(async () => new Response(Buffer.from("html"), { status: 200 })) as never,
      zipBuilder: (entries) => {
        entriesByCall.push(entries.map((entry) => entry.name));
        return Buffer.from("zip");
      },
    });

    await repository.downloadAiContentOutput({ workspaceId: "workspace-1", brandId: "brand-1", outputId: output.id, usageDate: "2026-08-01", dailyDownloadLimit: 20 });
    expect(entriesByCall[0]).toEqual(expect.arrayContaining([
      expect.stringMatching(/manifest\.json$/),
      expect.stringMatching(/content\.json$/),
      expect.stringMatching(/content\.html$/),
    ]));
    expect(entriesByCall[0]?.filter((name) => name.endsWith(".png"))).toHaveLength(0);

    v2Blog.artifact_manifest_json.assets.push({
      role: "inline",
      index: 1,
      url: `https://assets.public.blob.vercel-storage.com/ai-content/brand-1/${output.generation_id}/${output.id}/assets/01.png`,
      fileName: "inline-01.png",
      mimeType: "image/png",
      width: 1200,
      height: 800,
    } as never);
    await repository.downloadAiContentOutput({ workspaceId: "workspace-1", brandId: "brand-1", outputId: output.id, usageDate: "2026-08-01", dailyDownloadLimit: 20 });
    expect(entriesByCall[1]).toEqual(expect.arrayContaining([expect.stringMatching(/inline-01\.png$/)]));
  });

  it("packages v2 reel scenes and the final MP4 while retaining the first scene as the cover asset", async () => {
    const names: string[] = [];
    const v2Reel = {
      ...output,
      type: "marketing",
      artifact_manifest_json: {
        version: "ai-content.v2",
        type: "marketing",
        purpose: "marketing",
        outputFormat: "reel",
        title: "릴스",
        assets: [
          { role: "scene", index: 1, url: `https://assets.public.blob.vercel-storage.com/ai-content/brand-1/${output.generation_id}/${output.id}/assets/01.png`, fileName: "scene-01.png", mimeType: "image/png", width: 1080, height: 1920 },
          { role: "scene", index: 2, url: `https://assets.public.blob.vercel-storage.com/ai-content/brand-1/${output.generation_id}/${output.id}/assets/02.png`, fileName: "scene-02.png", mimeType: "image/png", width: 1080, height: 1920 },
          { role: "video", index: 1, url: `https://assets.public.blob.vercel-storage.com/ai-content/brand-1/${output.generation_id}/${output.id}/reel.mp4`, fileName: "reel.mp4", mimeType: "video/mp4", width: 1080, height: 1920, durationSeconds: 8, videoCodec: "h264", fps: 30, audioCodec: null },
        ],
        content: { caption: "릴스" },
      },
    };
    const { client } = setup();
    const repository = createAiContentDownloadRepository({
      query: vi.fn(async () => ({ rows: [v2Reel] })),
      connect: vi.fn(async () => client),
    } as never, {
      fetchImpl: vi.fn(async () => new Response(Buffer.from("asset"), { status: 200 })) as never,
      zipBuilder: (entries) => { names.push(...entries.map((entry) => entry.name)); return Buffer.from("zip"); },
    });

    await repository.downloadAiContentOutput({ workspaceId: "workspace-1", brandId: "brand-1", outputId: output.id, usageDate: "2026-08-01", dailyDownloadLimit: 20 });

    expect(names).toEqual(expect.arrayContaining([
      expect.stringMatching(/scene-01\.png$/),
      expect.stringMatching(/scene-02\.png$/),
      expect.stringMatching(/reel\.mp4$/),
    ]));
  });

  it("rejects a v2 asset outside the scoped deterministic brand, generation, and output prefix", async () => {
    const foreign = {
      ...output,
      artifact_manifest_json: {
        version: "ai-content.v2",
        type: "card_news",
        purpose: "informational",
        outputFormat: "card_news",
        title: "외부 자산",
        assets: [{ role: "slide", index: 1, url: `https://assets.public.blob.vercel-storage.com/ai-content/other-brand/${output.generation_id}/${output.id}/assets/01.png`, fileName: "slide-01.png", mimeType: "image/png", width: 1080, height: 1080 }],
        content: { caption: "외부" },
      },
    };
    const { client } = setup();
    const fetchImpl = vi.fn();
    const repository = createAiContentDownloadRepository({
      query: vi.fn(async () => ({ rows: [foreign] })),
      connect: vi.fn(async () => client),
    } as never, { fetchImpl: fetchImpl as never });

    await expect(repository.downloadAiContentOutput({ workspaceId: "workspace-1", brandId: "brand-1", outputId: output.id, usageDate: "2026-08-01", dailyDownloadLimit: 20 }))
      .rejects.toThrow("ai_content_download_asset_path_invalid");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
