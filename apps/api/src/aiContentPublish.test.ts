import { describe, expect, it, vi } from "vitest";
import { createAiContentPublishRepository } from "./aiContentPublish.js";
import { extractManifestImageUrls } from "./repository.js";

const manifestUrl = "https://assets.public.blob.vercel-storage.com/ai-content/manifest.json";
const manifest = {
  version: "ai-content.v1",
  type: "card_news",
  title: "여름 운영 체크리스트",
  assets: [
    { role: "slide", index: 1, url: "https://assets.public.blob.vercel-storage.com/1.png", fileName: "1.png", mimeType: "image/png", width: 1080, height: 1080 },
    { role: "slide", index: 2, url: "https://assets.public.blob.vercel-storage.com/2.png", fileName: "2.png", mimeType: "image/png", width: 1080, height: 1080 },
  ],
  content: { caption: "여름 운영 전에 확인할 내용입니다.", hashtags: ["#여름운영"], cta: "저장해 두세요." },
};

const input = {
  workspaceId: "workspace-1",
  brandId: "brand-1",
  outputId: "output-1",
  idempotencyKey: "b4b74082-8a44-46d6-91b6-3e3bd7e26be0",
  targets: [
    { channel: "instagram", deliveryFormat: "instagram_feed_carousel" },
    { channel: "instagram", deliveryFormat: "instagram_story" },
  ] as const,
};

function setup(options: {
  connected?: boolean;
  type?: "card_news" | "blog" | "marketing";
  status?: string;
  manifestUrl?: string;
  existingFormats?: string[];
  existingWithoutQueueFormats?: string[];
  existingStatus?: string;
  existingIdempotencyKey?: string;
} = {}) {
  const statements: string[] = [];
  let outputInsert = 0;
  const existing = new Set(options.existingFormats ?? []);
  const existingWithoutQueue = new Set(options.existingWithoutQueueFormats ?? []);
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    statements.push(sql);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: 0, rows: [] };
    if (sql.includes("from ai_content_generation_outputs output")) return { rowCount: 1, rows: [{
      id: "output-1",
      status: options.status ?? "completed",
      artifact_manifest_json: manifest,
      manifest_url: options.manifestUrl ?? manifestUrl,
      type: options.type ?? "card_news",
      title: manifest.title,
      draft_json: {},
    }] };
    if (sql.includes("from brand_channels channel")) return options.connected === false
      ? { rowCount: 0, rows: [] }
      : { rowCount: 1, rows: [{ id: "channel-instagram", channel: "instagram" }] };
    if (sql.includes("from content_topics topic") && sql.includes("aiContentOutputId")) return { rowCount: 0, rows: [] };
    if (sql.includes("insert into content_topics")) return { rowCount: 1, rows: [{ id: "topic-1" }] };
    if (sql.includes("insert into master_drafts")) return { rowCount: 1, rows: [{ id: "master-1" }] };
    if (sql.includes("insert into topic_publish_groups")) return { rowCount: 1, rows: [{ id: "publish-group-1" }] };
    if (sql.includes("insert into storage_artifacts")) return { rowCount: 1, rows: [{ id: "artifact-1" }] };
    if (sql.includes("from brands brand") && sql.includes("join brand_profiles profile")) return { rowCount: 1, rows: [{
      brand_name: "Growthline",
      category_context: "마케팅",
      primary_customer: "콘텐츠 운영 담당자",
      description: "브랜드 콘텐츠 운영 서비스",
      tone: "명확하고 실용적",
      brand_color: "#0b5fff",
    }] };
    if (sql.includes("from channel_outputs channel_output") && sql.includes("delivery_format = $2")) {
      const format = String(params[1]);
      if (existingWithoutQueue.has(format)) return { rowCount: 1, rows: [{
        channel_output_id: `existing-${format}`,
        queue_id: null,
        queue_status: null,
        published_url: null,
        last_error: null,
      }] };
      return existing.has(format)
        ? { rowCount: 1, rows: [{
          channel_output_id: `existing-${format}`,
          queue_id: `existing-queue-${format}`,
          queue_status: options.existingStatus ?? "published",
          idempotency_key: options.existingIdempotencyKey ?? `ai-content:output-1:instagram:${format}:older-request`,
          published_url: `https://instagram.example/${format}`,
          last_error: null,
        }] }
        : { rowCount: 0, rows: [] };
    }
    if (sql.includes("insert into channel_outputs")) {
      outputInsert += 1;
      return { rowCount: 1, rows: [{ id: `channel-output-${outputInsert}` }] };
    }
    if (sql.includes("insert into publish_queue")) {
      const format = String(params[6]).split(":").at(-2);
      return { rowCount: 1, rows: [{ id: `queue-${format}`, status: "scheduled" }] };
    }
    if (sql.includes("update publish_queue") && sql.includes("status = 'scheduled'")) {
      return { rowCount: 1, rows: [{ id: String(params[0]), status: "scheduled" }] };
    }
    if (sql.includes("insert into jobs")) return { rowCount: 1, rows: [{ id: "reel-job-1" }] };
    if (sql.includes("from publish_queue pq") && sql.includes("where pq.id = $1")) return { rowCount: 1, rows: [{
      queue_id: "queue-story",
      channel_output_id: "channel-output-story",
      channel: "instagram",
      delivery_format: "instagram_story",
      status: "scheduled",
      last_error: null,
      published_url: null,
    }] };
    throw new Error(`unexpected_query:${sql}`);
  });
  const release = vi.fn();
  const repository = createAiContentPublishRepository({
    connect: vi.fn(async () => ({ query, release })),
    query,
  } as never);
  return { repository, query, statements, release };
}

describe("AI content direct publishing", () => {
  it("creates one shared draft and one scheduled queue per target", async () => {
    const { repository, statements } = setup();
    await expect(repository.prepareAiContentPublish(input)).resolves.toMatchObject({
      publishGroupId: "publish-group-1",
      targets: [
        { deliveryFormat: "instagram_feed_carousel", queueId: "queue-instagram_feed_carousel", status: "scheduled" },
        { deliveryFormat: "instagram_story", queueId: "queue-instagram_story", status: "scheduled" },
      ],
    });
    expect(statements.filter((sql) => sql.includes("insert into content_topics"))).toHaveLength(1);
    expect(statements.filter((sql) => sql.includes("insert into channel_outputs"))).toHaveLength(2);
    expect(statements.filter((sql) => sql.includes("insert into publish_queue"))).toHaveLength(2);
    expect(statements.some((sql) => sql.includes("'approved'"))).toBe(true);
    const channelLookup = statements.find((sql) => sql.includes("from brand_channels channel"));
    expect(channelLookup).toContain("credential.expires_at is null");
    expect(channelLookup).toContain("credential.expires_at > now()");
  });

  it("reuses an existing target while creating a new target", async () => {
    const { repository, statements } = setup({ existingFormats: ["instagram_feed_carousel"] });
    const result = await repository.prepareAiContentPublish(input);
    expect(result.targets[0]).toMatchObject({ status: "published", queueId: "existing-queue-instagram_feed_carousel" });
    expect(result.targets[1]).toMatchObject({ status: "scheduled", queueId: "queue-instagram_story" });
    expect(statements.filter((sql) => sql.includes("insert into channel_outputs"))).toHaveLength(1);
  });

  it("creates only the missing queue when a prior attempt already stored the channel output", async () => {
    const { repository, statements, query } = setup({ existingWithoutQueueFormats: ["instagram_feed_carousel"] });
    const result = await repository.prepareAiContentPublish({ ...input, targets: [input.targets[0]] });

    expect(result.targets[0]).toMatchObject({
      channelOutputId: "existing-instagram_feed_carousel",
      status: "scheduled",
    });
    expect(statements.filter((sql) => sql.includes("insert into channel_outputs"))).toHaveLength(0);
    const queueCall = query.mock.calls.find(([sql]) => String(sql).includes("insert into publish_queue"));
    expect(queueCall?.[1]?.[2]).toBe("existing-instagram_feed_carousel");
  });

  it("requeues the existing failed queue when a new idempotency key retries a target", async () => {
    const { repository, statements, query } = setup({
      existingFormats: ["instagram_story"],
      existingStatus: "failed",
      existingIdempotencyKey: "ai-content:output-1:instagram:instagram_story:older-request",
    });

    const result = await repository.prepareAiContentPublish({ ...input, targets: [input.targets[1]] });

    expect(result.targets[0]).toMatchObject({
      channelOutputId: "existing-instagram_story",
      queueId: "existing-queue-instagram_story",
      status: "scheduled",
    });
    expect(statements.filter((sql) => sql.includes("insert into channel_outputs"))).toHaveLength(0);
    expect(statements.filter((sql) => sql.includes("insert into publish_queue"))).toHaveLength(0);
    const queueCall = query.mock.calls.find(([sql]) => String(sql).includes("update publish_queue") && String(sql).includes("status = 'scheduled'"));
    expect(queueCall?.[1]).toEqual([
      "existing-queue-instagram_story",
      expect.stringContaining(input.idempotencyKey),
    ]);
  });

  it("returns the same failed target when the idempotency key is repeated", async () => {
    const currentKey = `ai-content:output-1:instagram:instagram_story:${input.idempotencyKey}`;
    const { repository, statements } = setup({
      existingFormats: ["instagram_story"],
      existingStatus: "failed",
      existingIdempotencyKey: currentKey,
    });

    const result = await repository.prepareAiContentPublish({ ...input, targets: [input.targets[1]] });

    expect(result.targets[0]).toMatchObject({
      queueId: "existing-queue-instagram_story",
      status: "failed",
    });
    expect(statements.filter((sql) => sql.includes("insert into publish_queue"))).toHaveLength(0);
  });

  it("queues reel rendering before publishing an image result as a reel", async () => {
    const { repository, statements } = setup();
    const result = await repository.prepareAiContentPublish({
      ...input,
      targets: [{ channel: "instagram", deliveryFormat: "instagram_reel" }],
    });

    expect(result.targets[0]).toMatchObject({
      deliveryFormat: "instagram_reel",
      queueId: null,
      status: "rendering",
    });
    expect(statements.filter((sql) => sql.includes("insert into jobs"))).toHaveLength(1);
    expect(statements.filter((sql) => sql.includes("insert into publish_queue"))).toHaveLength(0);
  });

  it.each([
    [{ status: "queued" }, "ai_content_output_not_completed"],
    [{ connected: false }, "channel_oauth_not_connected"],
    [{ manifestUrl: "https://example.com/manifest.json" }, "ai_content_manifest_url_invalid"],
  ] as const)("rejects invalid direct publishing", async (options, error) => {
    const { repository, statements } = setup(options);
    await expect(repository.prepareAiContentPublish(input)).rejects.toThrow(error);
    expect(statements).toContain("ROLLBACK");
  });

  it("returns a brand-scoped queue result", async () => {
    const { repository } = setup();
    await expect(repository.getAiContentPublishQueueResult({
      workspaceId: "workspace-1",
      brandId: "brand-1",
      queueId: "queue-story",
    })).resolves.toEqual({
      channel: "instagram",
      channelOutputId: "channel-output-story",
      deliveryFormat: "instagram_story",
      queueId: "queue-story",
      status: "scheduled",
      publishedUrl: null,
      errorCode: null,
    });
  });

  it("lets the Instagram publisher read ai-content.v1 image assets", () => {
    expect(extractManifestImageUrls(manifest)).toEqual(manifest.assets.map((asset) => asset.url));
  });
});
