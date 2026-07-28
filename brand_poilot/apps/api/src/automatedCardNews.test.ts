import { describe, expect, it } from "vitest";
import { buildAutomatedCardNewsInput, enqueueAutomatedCardNews } from "./automatedCardNews.js";
import { parseContentGenerationInputV2 } from "./aiContentGenerationInput.js";

describe("automated card news input", () => {
  it("maps scheduled topic and source evidence to the shared card-news contract", () => {
    const result = buildAutomatedCardNewsInput({
      contentTopicId: "topic-1",
      brand: {
        name: "Growthline",
        categoryContext: "브랜드 콘텐츠 운영",
        primaryCustomer: "콘텐츠 담당자",
        description: "자사 자료를 근거로 콘텐츠를 운영합니다.",
        tone: "명확하고 실무적으로",
        brandColor: "파란색",
        intelligence: {
          versionId: "analysis-1",
          profile: { primaryTarget: "브랜드 콘텐츠 담당자", coreAppeal: "반복 운영 감소" },
        },
      },
      topic: {
        title: "콘텐츠 승인 지연을 줄이는 방법",
        angle: "담당자와 승인 기한을 먼저 정한다",
        targetCustomer: "콘텐츠 담당자",
        region: null,
        season: null,
        notes: "실무 체크리스트 중심",
      },
      representativeUrl: "https://example.com/service",
      sourceMaterials: [{
        sourceType: "owned",
        contentUrl: "https://example.com/service",
        content: "승인 담당자와 승인 기한을 정하면 게시 일정의 지연을 줄일 수 있습니다.",
      }],
    });

    expect(() => parseContentGenerationInputV2(result)).not.toThrow();
    expect(result).toMatchObject({
      contractVersion: "content-generation-input.v2",
      contentType: "card_news",
      subject: {
        type: "service",
        sourceUrl: "https://example.com/service",
      },
      message: {
        target: { name: "콘텐츠 담당자" },
        appeal: { title: "담당자와 승인 기한을 먼저 정한다" },
      },
      creativeDirection: {
        aspectRatio: "1:1",
        outputCount: 1,
        selectedColor: "파란색",
      },
    });
    expect(JSON.stringify(result.subject.facts)).toContain("승인 담당자");
    expect(JSON.stringify(result.brandContext.context)).toContain("https://example.com/service");
    expect(result.brandContext.context).toMatchObject({
      brandIntelligence: {
        versionId: "analysis-1",
        profile: { primaryTarget: "브랜드 콘텐츠 담당자", coreAppeal: "반복 운영 감소" },
      },
    });
  });

  it("keeps the contract valid when a topic has no public URL", () => {
    const result = buildAutomatedCardNewsInput({
      contentTopicId: "topic-without-url",
      brand: { name: "Growthline", brandColor: null },
      topic: { title: "운영 체크리스트", angle: "반복 업무 줄이기" },
      representativeUrl: null,
      sourceMaterials: [],
    });

    expect(() => parseContentGenerationInputV2(result)).not.toThrow();
    expect(result.subject.sourceUrl).toBe("urn:brand-pilot:topic:topic-without-url");
    expect(result.creativeDirection.selectedColor).toBe("#2563eb");
  });

  it.each([
    ["absent", undefined],
    ["false", { automatedContentEnabled: false }],
  ])("performs no automated writes when the feature flag is %s", async (_label, options) => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return { rows: [], rowCount: 1 };
      },
    };

    const result = await enqueueAutomatedCardNews(client, {
      workspaceId: "20000000-0000-4000-8000-000000000002",
      brandId: "30000000-0000-4000-8000-000000000003",
      contentTopicId: "topic-1",
      channelOutputId: "output-1",
      brand: { name: "Growthline", brandColor: null },
      topic: { title: "운영 체크리스트", angle: "반복 업무 줄이기" },
      representativeUrl: null,
      sourceMaterials: [],
    }, options);

    expect(result).toEqual({ mode: "disabled" });
    expect(calls).toEqual([]);
  });

  it("creates only a scheduled proposal batch when automated proposal mode is enabled", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes("insert into ai_content_proposal_batches")) {
          return { rows: [{ id: "batch-1" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
    };
    await enqueueAutomatedCardNews(client, {
      workspaceId: "20000000-0000-4000-8000-000000000002",
      brandId: "30000000-0000-4000-8000-000000000003",
      contentTopicId: "topic-1",
      channelOutputId: "output-1",
      brand: { name: "Growthline", brandColor: null },
      topic: { title: "운영 체크리스트", angle: "반복 업무 줄이기" },
      representativeUrl: "https://example.com/topic",
      sourceMaterials: [],
    }, { automatedContentEnabled: true });

    expect(calls.some(({ sql }) => sql.includes("origin") && sql.includes("'scheduled_crawl'"))).toBe(true);
    expect(calls.some(({ sql }) => sql.includes("insert into ai_content_proposal_jobs"))).toBe(true);
    expect(calls.some(({ sql }) => sql.includes("insert into ai_content_generations"))).toBe(false);
  });

  it("freezes the latest successful same-brand snapshot that triggered a scheduled proposal", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes("with candidate_sources")) {
          return {
            rows: [{
              id: "90000000-0000-4000-8000-000000000009",
              url: "https://example.com/topic",
              fetched_at: "2026-07-28T00:00:00.000Z",
              content_hash: "a".repeat(64),
              summary: "frozen evidence",
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("insert into ai_content_proposal_batches")) {
          return { rows: [{ id: "batch-1" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    await enqueueAutomatedCardNews(client, {
      workspaceId: "20000000-0000-4000-8000-000000000002",
      brandId: "30000000-0000-4000-8000-000000000003",
      contentTopicId: "topic-1",
      channelOutputId: "output-1",
      sourceSnapshotIds: ["80000000-0000-4000-8000-000000000008"],
      brand: { name: "Growthline", brandColor: null },
      topic: { title: "운영 체크리스트", angle: "반복 업무 줄이기" },
      representativeUrl: "https://example.com/topic",
      sourceMaterials: [],
    }, { automatedContentEnabled: true });

    const lookup = calls.find(({ sql }) => sql.includes("with candidate_sources"));
    expect(lookup?.sql).toContain("snapshot.workspace_id=$1");
    expect(lookup?.sql).toContain("snapshot.brand_id=$2");
    expect(lookup?.sql).toContain("order by latest.fetched_at desc,latest.id desc");
    const insert = calls.find(({ sql }) => sql.includes("insert into ai_content_proposal_batches"));
    expect(JSON.parse(String(insert?.params[4]))).toEqual([{
      sourceId: "90000000-0000-4000-8000-000000000009",
      url: "https://example.com/topic",
      crawledAt: "2026-07-28T00:00:00.000Z",
      contentHash: "a".repeat(64),
      summary: "frozen evidence",
    }]);
    expect(JSON.parse(String(insert?.params[2])).sourceSnapshotIds).toEqual([
      "90000000-0000-4000-8000-000000000009",
    ]);
  });

  it("queues stale or missing recrawls independently and never mutates an existing batch snapshot", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    let lookup = 0;
    let batchInsert = 0;
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes("with candidate_sources")) {
          lookup += 1;
          return {
            rows: [{
              id: lookup === 1 ? "80000000-0000-4000-8000-000000000008" : "90000000-0000-4000-8000-000000000009",
              url: "https://example.com/topic",
              fetched_at: "2026-07-01T00:00:00.000Z",
              content_hash: (lookup === 1 ? "a" : "b").repeat(64),
              summary: "evidence",
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("insert into ai_content_proposal_batches")) {
          batchInsert += 1;
          return batchInsert === 1
            ? { rows: [{ id: "batch-1" }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        if (sql.includes("from ai_content_proposal_batches")) {
          return { rows: [{ id: "batch-1" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    const input = {
      workspaceId: "20000000-0000-4000-8000-000000000002",
      brandId: "30000000-0000-4000-8000-000000000003",
      contentTopicId: "topic-1",
      channelOutputId: "output-1",
      sourceSnapshotIds: ["70000000-0000-4000-8000-000000000007"],
      brand: { name: "Growthline", brandColor: null },
      topic: { title: "운영 체크리스트", angle: "반복 업무 줄이기" },
      representativeUrl: "https://example.com/topic",
      sourceMaterials: [],
    };

    await enqueueAutomatedCardNews(client, input, { automatedContentEnabled: true });
    await enqueueAutomatedCardNews(client, input, { automatedContentEnabled: true });

    expect(calls.some(({ sql }) => sql.includes("insert into source_crawl_runs")
      && sql.includes("latest.fetched_at is null or latest.fetched_at < now() - interval '7 days'"))).toBe(true);
    const batchInserts = calls.filter(({ sql }) => sql.includes("insert into ai_content_proposal_batches"));
    expect(batchInserts).toHaveLength(2);
    expect(batchInserts[0]?.sql).toContain("do nothing");
    expect(batchInserts[0]?.params[4]).not.toEqual(batchInserts[1]?.params[4]);
    expect(calls.filter(({ sql }) => sql.includes("insert into ai_content_proposal_jobs"))).toHaveLength(1);
    expect(calls.some(({ sql }) => sql.includes("from ai_content_proposal_batches"))).toBe(true);
    expect(calls.some(({ sql }) => /wait|sleep/i.test(sql))).toBe(false);
  });
});
