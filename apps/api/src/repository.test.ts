import { describe, expect, it, vi } from "vitest";
import { encryptCredential } from "./credentialCrypto";
import { afterEach } from "vitest";
import { createRepository } from "./repository";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const task3TestNow = new Date("2026-07-13T00:00:00.000Z");
const oneDayMs = 24 * 60 * 60 * 1000;

function useTask3TestClock() {
  vi.useFakeTimers();
  vi.setSystemTime(task3TestNow);
}

function task3CredentialExpiry(daysFromNow: number) {
  return new Date(task3TestNow.getTime() + daysFromNow * oneDayMs);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Task 4 transactional topic generation", () => {
  function generationQuery(options: {
    channels?: Array<"instagram" | "threads">;
    enabledFormats?: string[];
    lastSelectedFormat?: string | null;
    dailyTopicCount?: number;
    autoApprovalEnabled?: boolean;
  } = {}) {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values: values ?? [] });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from brands b") && sql.includes("join brand_profiles")) {
        return { rowCount: 1, rows: [{
          workspace_id: "workspace-1",
          brand_name: "Jeju Pilot",
          timezone: "Asia/Seoul",
          industry: "travel consulting",
          primary_customer: "family travelers",
          description: "Jeju route consulting",
          tone: "expert",
          default_cta: "Request consultation",
          auto_approval_enabled: options.autoApprovalEnabled ?? false
        }] };
      }
      if (isConnectedChannelQuery(sql)) return connectedChannelRows(...(options.channels ?? ["instagram", "threads"]));
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) {
        const formats = options.enabledFormats ?? ["instagram_feed_carousel", "instagram_story", "instagram_reel"];
        return { rowCount: formats.length, rows: formats.map((format) => ({ format })) };
      }
      if (sql.includes("from brand_format_rotation_states") && sql.includes("for update")) {
        return { rowCount: 1, rows: [{ last_selected_format: options.lastSelectedFormat ?? null }] };
      }
      if (sql.includes("count(*)") && sql.includes("from content_topics")) {
        return { rowCount: 1, rows: [{ topic_count: String(options.dailyTopicCount ?? 0) }] };
      }
      if (sql.includes("from content_topics ct") && sql.includes("for update") && sql.includes("skip locked")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("from topic_rows") && sql.includes("for update skip locked")) {
        return { rowCount: 1, rows: [{
          id: "topic-row-1",
          topic_title: "Jeju family route",
          topic_angle: "location-first checklist",
          target_customer: "family travelers",
          region: "Jeju",
          season: "summer",
          reference_url: "https://example.com/reference",
          notes: "Keep the route compact."
        }] };
      }
      if (sql.includes("insert into content_topics")) return { rowCount: 1, rows: [{ id: "content-topic-1" }] };
      if (sql.includes("insert into topic_publish_groups")) return { rowCount: 1, rows: [{ id: "publish-group-1" }] };
      if (sql.includes("insert into master_drafts")) return { rowCount: 1, rows: [{ id: "master-draft-1" }] };
      if (sql.includes("insert into llm_runs")) return { rowCount: 1, rows: [{ id: "llm-run-1" }] };
      if (sql.includes("insert into channel_outputs")) {
        const channel = String(values?.[4]);
        return { rowCount: 1, rows: [{ id: `output-${channel}` }] };
      }
      if (sql.includes("insert into jobs")) return { rowCount: 1, rows: [{ id: "render-job-1" }] };
      if (sql.includes("select id from brand_channels")) return { rowCount: 1, rows: [{ id: `channel-${values?.[1]}` }] };
      if (sql.includes("insert into publish_queue")) return { rowCount: 1, rows: [{ id: "queue-1" }] };
      return { rowCount: 1, rows: [] };
    });
    return { query, statements };
  }

  it("allows the fourth topic after serializing the brand and blocks the fifth", async () => {
    const now = new Date("2026-07-13T01:00:00.000Z");
    const allowed = generationQuery({ dailyTopicCount: 3, channels: ["threads"] });
    const blocked = generationQuery({ dailyTopicCount: 4, channels: ["threads"] });

    const allowedResult = await createRepository(fakePoolWithClient(allowed.query) as any).generateContent(
      "brand-1",
      now
    );
    const blockedResult = await createRepository(fakePoolWithClient(blocked.query) as any).generateContent(
      "brand-1",
      now
    );

    expect(allowedResult.processed).toBe(1);
    expect(blockedResult).toEqual({ processed: 0, created: 0, updated: 0, failed: 0, reason: "daily_topic_limit" });
    expect(blocked.statements.some(({ sql }) => sql.includes("from topic_rows"))).toBe(false);
    const brandLockIndex = allowed.statements.findIndex(({ sql }) => sql.includes("from brands b") && sql.includes("for update"));
    const countIndex = allowed.statements.findIndex(({ sql }) => sql.includes("count(*)") && sql.includes("from content_topics"));
    const topicIndex = allowed.statements.findIndex(({ sql }) => sql.includes("from topic_rows"));
    expect(brandLockIndex).toBeGreaterThanOrEqual(0);
    expect(brandLockIndex).toBeLessThan(countIndex);
    expect(countIndex).toBeLessThan(topicIndex);
    const countSql = allowed.statements[countIndex].sql;
    expect(countSql).toContain("generated_at at time zone");
    expect(countSql).not.toContain("created_at at time zone");
    const generatedUpdate = allowed.statements.find(({ sql }) => sql.includes("set status = 'generated'"));
    expect(generatedUpdate?.sql).toContain("generated_at = $2");
    expect(generatedUpdate?.values).toEqual(["content-topic-1", now]);
  });

  it.each([
    { enabled: ["instagram_feed_carousel", "instagram_story", "instagram_reel"], last: null, expected: "instagram_feed_carousel" },
    { enabled: ["instagram_feed_carousel", "instagram_reel"], last: "instagram_feed_carousel", expected: "instagram_reel" },
    { enabled: ["instagram_feed_carousel", "instagram_story", "instagram_reel"], last: "instagram_reel", expected: "instagram_feed_carousel" },
    { enabled: ["instagram_feed_carousel", "instagram_reel"], last: "instagram_story", expected: "instagram_reel" }
  ])("rotates enabled Instagram formats transactionally: $expected", async ({ enabled, last, expected }) => {
    const fixture = generationQuery({ channels: ["instagram"], enabledFormats: enabled, lastSelectedFormat: last });

    await createRepository(fakePoolWithClient(fixture.query) as any).generateContent("brand-1");

    const formatLock = fixture.statements.find(({ sql }) => sql.includes("from brand_content_formats") && sql.includes("for update"));
    const rotationLock = fixture.statements.find(({ sql }) => sql.includes("from brand_format_rotation_states") && sql.includes("for update"));
    const contentInsert = fixture.statements.find(({ sql }) => sql.includes("insert into content_topics"));
    const rotationUpdate = fixture.statements.find(({ sql }) => sql.includes("update brand_format_rotation_states"));
    expect(formatLock).toBeDefined();
    expect(rotationLock).toBeDefined();
    expect(contentInsert?.values).toContain(expected);
    expect(rotationUpdate?.values).toContain(expected);
    const jobInsert = fixture.statements.find(({ sql }) => sql.includes("insert into jobs"));
    expect(jobInsert?.values).toContain(expected === "instagram_feed_carousel"
      ? "instagram_feed_render"
      : expected === "instagram_story" ? "instagram_story_render" : "instagram_reel_render");
    expect(jobInsert?.sql).not.toContain("instagram_render");
  });

  it("creates a Threads-only topic without changing the Instagram cursor", async () => {
    const fixture = generationQuery({ channels: ["instagram", "threads"], enabledFormats: [], lastSelectedFormat: "instagram_reel" });

    const result = await createRepository(fakePoolWithClient(fixture.query) as any).generateContent("brand-1");

    expect(result).toMatchObject({ processed: 1, created: 1 });
    expect(fixture.statements.some(({ sql }) => sql.includes("update brand_format_rotation_states"))).toBe(false);
    const contentInsert = fixture.statements.find(({ sql }) => sql.includes("insert into content_topics"));
    expect(contentInsert?.values).toContain(null);
    const outputs = fixture.statements.filter(({ sql }) => sql.includes("insert into channel_outputs"));
    expect(outputs).toHaveLength(1);
    expect(outputs[0].values).toEqual(expect.arrayContaining(["threads", "threads_text"]));
  });

  it("does not consume a topic when no channel can produce output", async () => {
    const fixture = generationQuery({ channels: ["instagram"], enabledFormats: [] });

    const result = await createRepository(fakePoolWithClient(fixture.query) as any).generateContent("brand-1");

    expect(result.processed).toBe(0);
    expect(fixture.statements.some(({ sql }) => sql.includes("from topic_rows"))).toBe(false);
    expect(fixture.statements.some(({ sql }) => sql.includes("update topic_rows"))).toBe(false);
    expect(fixture.statements.some(({ sql }) => sql.includes("insert into content_topics"))).toBe(false);
    expect(fixture.statements.some(({ sql }) => sql.includes("insert into topic_publish_groups"))).toBe(false);
  });

  it("creates one waiting group and format-specific outputs without a central Instagram storyboard", async () => {
    const fixture = generationQuery({
      channels: ["instagram", "threads"],
      enabledFormats: ["instagram_feed_carousel"],
      autoApprovalEnabled: true
    });

    const result = await createRepository(fakePoolWithClient(fixture.query) as any).generateContent("brand-1");

    expect(result).toMatchObject({ processed: 1, created: 2 });
    const groups = fixture.statements.filter(({ sql }) => sql.includes("insert into topic_publish_groups"));
    expect(groups).toHaveLength(1);
    expect(groups[0].sql).toContain("'waiting'");
    const outputs = fixture.statements.filter(({ sql }) => sql.includes("insert into channel_outputs"));
    expect(outputs.map(({ values }) => [values[4], values[5]])).toEqual([
      ["instagram", "instagram_feed_carousel"],
      ["threads", "threads_text"]
    ]);
    const instagramJson = JSON.stringify(outputs[0].values);
    expect(instagramJson).not.toContain('"slides"');
    expect(instagramJson).not.toContain('"cards"');
    expect(instagramJson).not.toContain('"scenes"');
    expect(instagramJson).not.toContain('"assetCount"');
    expect(instagramJson).not.toContain('"storyboard"');
    expect(instagramJson).not.toContain('"raw_text"');
    expect(instagramJson).not.toContain('"extracted_text"');
    expect(instagramJson).not.toContain('"summary"');
    const queues = fixture.statements.filter(({ sql }) => sql.includes("insert into publish_queue"));
    expect(queues).toHaveLength(0);
    const jobs = fixture.statements.filter(({ sql }) => sql.includes("insert into jobs"));
    expect(jobs).toHaveLength(2);
    expect(jobs.some(({ values }) => values.includes("instagram_feed_render"))).toBe(true);
    expect(jobs.some(({ sql }) => sql.includes("threads_text_render"))).toBe(true);
  });

  it("omits central crawl snapshot fields and text from the render payload", async () => {
    const fixture = generationQuery({ channels: ["instagram"], enabledFormats: ["instagram_feed_carousel"] });
    fixture.query.mockImplementation((async (sql: string, values?: unknown[]) => {
      const base = generationQuery({ channels: ["instagram"], enabledFormats: ["instagram_feed_carousel"] });
      void base;
      fixture.statements.push({ sql, values: values ?? [] });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from brands b") && sql.includes("join brand_profiles")) return { rowCount: 1, rows: [{ workspace_id: "workspace-1", brand_name: "Jeju Pilot", timezone: "Asia/Seoul", auto_approval_enabled: false }] };
      if (isConnectedChannelQuery(sql)) return connectedChannelRows("instagram");
      if (sql.includes("from brand_content_formats")) return { rowCount: 1, rows: [{ format: "instagram_feed_carousel" }] };
      if (sql.includes("from brand_format_rotation_states")) return { rowCount: 1, rows: [{ last_selected_format: null }] };
      if (sql.includes("count(*)") && sql.includes("from content_topics")) return { rowCount: 1, rows: [{ topic_count: "0" }] };
      if (sql.includes("from content_topics ct") && sql.includes("for update")) return { rowCount: 0, rows: [] };
      if (sql.includes("from topic_rows")) return { rowCount: 0, rows: [] };
      if (sql.includes("from source_snapshots")) return { rowCount: 1, rows: [{ id: "snapshot-1", source_content_item_id: "item-1", content_hash: "hash-1", source_type: "owned", content_url: "https://brand.example.com/raw", content: "SECRET RAW SNAPSHOT" }] };
      if (sql.includes("insert into content_topics")) return { rowCount: 1, rows: [{ id: "content-topic-1" }] };
      if (sql.includes("insert into topic_publish_groups")) return { rowCount: 1, rows: [{ id: "publish-group-1" }] };
      if (sql.includes("insert into master_drafts")) return { rowCount: 1, rows: [{ id: "master-draft-1" }] };
      if (sql.includes("insert into llm_runs")) return { rowCount: 1, rows: [] };
      if (sql.includes("insert into channel_outputs")) return { rowCount: 1, rows: [{ id: "output-instagram" }] };
      if (sql.includes("insert into jobs")) return { rowCount: 1, rows: [] };
      return { rowCount: 1, rows: [] };
    }) as any);

    await createRepository(fakePoolWithClient(fixture.query) as any).generateContent("brand-1");

    const job = fixture.statements.find(({ sql }) => sql.includes("insert into jobs"));
    const payload = JSON.stringify(job?.values);
    expect(payload).not.toContain("SECRET RAW SNAPSHOT");
    expect(payload).not.toContain("raw_text");
    expect(payload).not.toContain("extracted_text");
    expect(payload).not.toContain('"summary"');
    expect(payload).not.toContain('"storyboard"');
    expect(payload).not.toContain('"slides"');
    expect(payload).not.toContain('"cards"');
    expect(payload).not.toContain('"scenes"');
    expect(payload).not.toContain('"assetCount"');
    const outputInsert = fixture.statements.find(({ sql }) => sql.includes("insert into channel_outputs"));
    const outputJson = String(outputInsert?.values[10]);
    for (const forbidden of ["storyboard", "slides", "cards", "scenes", "assetCount", "raw_text", "extracted_text", "summary"]) {
      expect(outputJson).not.toContain(`"${forbidden}"`);
    }
  });
});

function fakePoolWithClient(query: ReturnType<typeof vi.fn>) {
  return {
    query,
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  };
}

function isConnectedChannelQuery(sql: string) {
  return sql.includes("from brand_channels") && sql.includes("status = 'connected'");
}

function connectedChannelRows(...channels: Array<"instagram" | "threads">) {
  return { rowCount: channels.length, rows: channels.map((channel) => ({ channel })) };
}

describe("Instagram trend repository delegation", () => {
  it("delegates category reads through the focused repository", async () => {
    const query = vi.fn(async (sql: string) => {
      expect(sql).toContain("from content_categories category");
      return {
        rowCount: 1,
        rows: [{
          code: "business_professional",
          name: "비즈니스·전문 서비스",
          recommended_hashtags: ["마케팅"],
          subcategories: [{ code: "content_operations", name: "콘텐츠 운영" }],
        }],
      };
    });
    const fetchTopMedia = vi.fn();
    const repository = createRepository({ query } as any, {
      fetchInstagramHashtagTopMedia: fetchTopMedia as any,
      trendNow: () => new Date("2026-07-15T00:00:00.000Z"),
    }) as any;

    await expect(repository.listContentCategories()).resolves.toEqual([{
      code: "business_professional",
      name: "비즈니스·전문 서비스",
      recommendedHashtags: ["마케팅"],
      subcategories: [{ code: "content_operations", name: "콘텐츠 운영" }],
    }]);
    expect(fetchTopMedia).not.toHaveBeenCalled();
  });
});

function task4GenerationPolicyResult(sql: string) {
  if (sql.includes("from brand_content_formats") && sql.includes("for update")) {
    return { rowCount: 1, rows: [{ format: "instagram_feed_carousel" }] };
  }
  if (sql.includes("from brand_format_rotation_states") && sql.includes("for update")) {
    return { rowCount: 1, rows: [{ last_selected_format: null }] };
  }
  if (sql.includes("count(*)") && sql.includes("from content_topics")) {
    return { rowCount: 1, rows: [{ topic_count: "0" }] };
  }
  if (sql.includes("insert into topic_publish_groups")) {
    return { rowCount: 1, rows: [{ id: "publish-group-1" }] };
  }
  return null;
}

describe("repository", () => {
  it("builds brand UI status from persisted brand state", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        brand_id: "brand-1",
        brand_name: "Learning Brand",
        primary_category_id: "category-education",
        primary_customer: "small business owners",
        description: "Content operations brand",
        tone: "professional",
        default_cta: "Request consultation",
        main_link: "https://example.com",
        auto_approval_enabled: true,
        owned_source_count: "1",
        reference_source_count: "1",
        topic_row_count: "3",
        instagram_status: "needs_attention",
        threads_status: "connected",
        content_output_count: "2",
        content_review_count: "4",
        publish_issue_count: "1",
        channel_issue_count: "1",
        last_generated_at: "2026-07-06T01:00:00.000Z"
      }]
    }));
    const repository = createRepository({ query } as any) as any;

    const status = await repository.getBrandUiStatus("brand-1");

    expect(status.brandName).toBe("Learning Brand");
    expect(status.navigation).toEqual({
      onboardingRemaining: 1,
      contentReview: 4,
      publishIssues: 1,
      channelIssues: 1
    });
    expect(status.onboarding).toMatchObject({
      completedCount: 6,
      totalCount: 7,
      remainingCount: 1
    });
    expect(status.onboarding.steps.find((step: any) => step.id === "instagram")).toMatchObject({
      status: "needs_attention"
    });
  });

  it("encrypts channel credentials before inserting them", async () => {
    let insertedValues: unknown[] | undefined;
    const clientQuery = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("insert into channel_credentials")) {
        insertedValues = values;
        return { rowCount: 1, rows: [{ id: "credential-new" }] };
      }
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) {
        return { rowCount: 1, rows: [{ enabled: false, capability_status: "unchecked", capability_metadata: {} }] };
      }
      if (sql.includes("from brand_channels") && sql.includes("for update")) {
        return { rowCount: 1, rows: [{ id: "channel-1", workspace_id: "workspace-1", status: "needs_attention", external_account_id: null }] };
      }
      if (sql.includes("from channel_credentials") && sql.includes("for update")) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    });
    const poolQuery = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        channel: "instagram",
        status: "needs_attention",
        account_label: "@brand",
        last_healthy_at: null,
        last_published_at: null,
        last_error: null
      }]
    }));
    const pool = {
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
      query: poolQuery
    };
    const repository = createRepository(pool as any);

    await repository.saveChannelCredentials("brand-1", "instagram", {
      secretValue: "raw-token-value",
      accountLabel: "@brand"
    });

    expect(insertedValues?.[5]).not.toBe("raw-token-value");
    expect(String(insertedValues?.[5])).toMatch(/^v1:/);
  });

  it("upserts a customer channel connection request without credential secrets", async () => {
    let upsertValues: unknown[] | undefined;
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("select workspace_id from brands")) {
        return { rowCount: 1, rows: [{ workspace_id: "workspace-1" }] };
      }
      if (sql.includes("insert into channel_connection_requests")) {
        upsertValues = values;
        return {
          rowCount: 1,
          rows: [{
            id: "request-1",
            brand_id: "brand-1",
            status: "submitted",
            instagram_handle: "@brand",
            instagram_profile_url: "https://instagram.com/brand",
            facebook_page_url: "https://facebook.com/brand",
            meta_business_name: "Brand Inc",
            threads_profile_url: "https://threads.net/@brand",
            contact_name: "Kim",
            contact_email: "kim@example.com",
            has_admin_access: true,
            request_note: "Please connect Instagram first.",
            submitted_at: "2026-07-07T00:00:00.000Z",
            updated_at: "2026-07-07T00:00:00.000Z"
          }]
        };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({ query } as any);

    const request = await repository.updateChannelConnectionRequest("brand-1", {
      instagramHandle: "@brand",
      instagramProfileUrl: "https://instagram.com/brand",
      facebookPageUrl: "https://facebook.com/brand",
      metaBusinessName: "Brand Inc",
      threadsProfileUrl: "https://threads.net/@brand",
      contactName: "Kim",
      contactEmail: "kim@example.com",
      hasAdminAccess: true,
      requestNote: "Please connect Instagram first.",
      submit: true
    });

    expect(request).toMatchObject({
      id: "request-1",
      status: "submitted",
      instagramHandle: "@brand",
      hasAdminAccess: true
    });
    expect(upsertValues).toEqual(expect.arrayContaining([
      "workspace-1",
      "brand-1",
      "@brand",
      "https://instagram.com/brand",
      "kim@example.com",
      true,
      "submitted"
    ]));
    expect(upsertValues).not.toContain("Instagram Access Token");
  });

  it("stores and updates support requests", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes("select workspace_id from brands")) {
        return { rowCount: 1, rows: [{ workspace_id: "workspace-1" }] };
      }
      if (sql.includes("insert into support_requests")) {
        return {
          rowCount: 1,
          rows: [{
            id: "support-1",
            brand_id: values?.[1],
            workspace_id: values?.[0],
            category: values?.[2],
            title: values?.[3],
            message: values?.[4],
            contact_email: values?.[5],
            status: "new",
            created_at: "2026-07-11T00:00:00.000Z",
            updated_at: "2026-07-11T00:00:00.000Z"
          }]
        };
      }
      if (sql.includes("from support_requests") && sql.includes("where brand_id")) {
        return {
          rowCount: 1,
          rows: [{
            id: "support-1",
            brand_id: "brand-1",
            workspace_id: "workspace-1",
            category: "bug",
            title: "채널 연결 오류",
            message: "인스타 연결이 실패합니다.",
            contact_email: "user@example.com",
            status: "new",
            created_at: "2026-07-11T00:00:00.000Z",
            updated_at: "2026-07-11T00:00:00.000Z"
          }]
        };
      }
      if (sql.includes("update support_requests")) {
        return {
          rowCount: 1,
          rows: [{
            id: values?.[0],
            brand_id: "brand-1",
            workspace_id: "workspace-1",
            category: "bug",
            title: "채널 연결 오류",
            message: "인스타 연결이 실패합니다.",
            contact_email: "user@example.com",
            status: values?.[1],
            created_at: "2026-07-11T00:00:00.000Z",
            updated_at: "2026-07-11T00:05:00.000Z"
          }]
        };
      }
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query } as any) as any;

    const created = await repository.createSupportRequest("brand-1", {
      category: "bug",
      title: "채널 연결 오류",
      message: "인스타 연결이 실패합니다.",
      contactEmail: "user@example.com"
    });
    const list = await repository.listSupportRequests("brand-1");
    const updated = await repository.updateSupportRequestStatus("support-1", "in_progress");

    expect(created).toMatchObject({ id: "support-1", status: "new", contactEmail: "user@example.com" });
    expect(list).toEqual([expect.objectContaining({ id: "support-1", title: "채널 연결 오류" })]);
    expect(updated).toMatchObject({ id: "support-1", status: "in_progress" });
    expect(queries.some((entry) => entry.sql.includes("insert into support_requests"))).toBe(true);
    expect(queries.some((entry) => entry.sql.includes("update support_requests"))).toBe(true);
  });

  it("creates a publish queue row when a content output is approved", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.trimStart().startsWith("with updated as")) {
        return {
          rowCount: 1,
          rows: [{
            id: "output-1",
            status: "approved",
            workspace_id: "workspace-1",
            brand_id: "brand-1",
            channel: "threads",
            brand_channel_id: "brand-channel-1",
            topic_publish_group_id: "publish-group-1"
          }]
        };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    await repository.reviewContentOutput("output-1", "approve");

    expect(query).toHaveBeenCalledWith(expect.stringContaining("insert into publish_queue"), expect.any(Array));
  });

  it("skips topic rows that duplicate existing brand topic rows", async () => {
    const insertedRows: Array<{ status: string; topicKey: string }> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("select workspace_id from brands")) {
        return { rowCount: 1, rows: [{ workspace_id: "workspace-1" }] };
      }
      if (sql.includes("select topic_key") && sql.includes("from topic_rows")) {
        return { rowCount: 1, rows: [{ topic_key: "existing topic::same angle" }] };
      }
      if (sql.includes("insert into topic_uploads")) {
        return {
          rowCount: 1,
          rows: [{
            id: "upload-1",
            file_name: values?.[2],
            status: "validated",
            total_rows: values?.[3],
            valid_rows: values?.[4],
            duplicate_rows: values?.[5],
            invalid_rows: values?.[6]
          }]
        };
      }
      if (sql.includes("insert into topic_rows")) {
        insertedRows.push({ status: String(values?.[4]), topicKey: String(values?.[13]) });
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    const result = await repository.createTopicUpload("brand-1", {
      fileName: "topics.csv",
      csvText: [
        "topic_title,topic_angle",
        "Existing   Topic,Same Angle",
        "New Topic,Fresh Angle"
      ].join("\n")
    });

    expect(result).toMatchObject({ totalRows: 2, validRows: 1, duplicateRows: 1, invalidRows: 0 });
    expect(insertedRows).toEqual([
      { status: "skipped", topicKey: "existing topic::same angle" },
      { status: "uploaded", topicKey: "new topic::fresh angle" }
    ]);
  });

  it("marks topic rows with mojibake replacement text as invalid", async () => {
    const insertedRows: Array<{ status: string; validationErrors: string[] }> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("select workspace_id from brands")) {
        return { rowCount: 1, rows: [{ workspace_id: "workspace-1" }] };
      }
      if (sql.includes("select topic_key") && sql.includes("from topic_rows")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("insert into topic_uploads")) {
        return {
          rowCount: 1,
          rows: [{
            id: "upload-1",
            file_name: values?.[2],
            status: "validated",
            total_rows: values?.[3],
            valid_rows: values?.[4],
            duplicate_rows: values?.[5],
            invalid_rows: values?.[6]
          }]
        };
      }
      if (sql.includes("insert into topic_rows")) {
        insertedRows.push({
          status: String(values?.[4]),
          validationErrors: JSON.parse(String(values?.[14]))
        });
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    const result = await repository.createTopicUpload("brand-1", {
      fileName: "topics.csv",
      csvText: [
        "topic_title,topic_angle,target_customer,notes",
        "??? ???,Normal angle,Normal customer,Normal notes",
        "Valid title,Angle with \uFFFD replacement,Customer,Normal notes",
        "Valid title,Valid angle,Customer,notes with ???",
        "Valid title,Angle with ?? pair,Customer,Normal notes"
      ].join("\n")
    });

    expect(result).toMatchObject({ totalRows: 4, validRows: 0, duplicateRows: 0, invalidRows: 4 });
    expect(insertedRows).toEqual([
      { status: "invalid", validationErrors: ["topic_title_malformed_text"] },
      { status: "invalid", validationErrors: ["topic_angle_malformed_text"] },
      { status: "invalid", validationErrors: ["notes_malformed_text"] },
      { status: "invalid", validationErrors: ["topic_angle_malformed_text"] }
    ]);
  });

  it("fails topic upload when required csv headers are missing", async () => {
    const repository = createRepository(fakePoolWithClient(vi.fn()) as any);

    await expect(repository.createTopicUpload("brand-1", {
      fileName: "topics.csv",
      csvText: "title,angle\nA,B"
    })).rejects.toThrow("topic_upload_invalid_csv");
  });

  it("lists topic rows and maps database fields", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        id: "topic-row-1",
        topic_upload_id: "upload-1",
        row_number: 2,
        status: "skipped",
        topic_title: "Jeju food",
        topic_angle: "local guide",
        target_customer: "first-time travelers",
        region: "Jeju",
        season: null,
        reference_url: "https://example.com/jeju",
        priority: 10,
        notes: "avoid generic tips",
        validation_errors: ["duplicate_existing_topic"],
        created_at: new Date("2026-07-06T00:00:00.000Z"),
        used_at: null
      }]
    }));
    const repository = createRepository({ query } as any);

    const rows = await repository.listTopicRows("brand-1", "skipped");

    expect(query).toHaveBeenCalledWith(expect.stringContaining("from topic_rows"), ["brand-1", "skipped"]);
    expect(rows).toEqual([{
      id: "topic-row-1",
      uploadId: "upload-1",
      rowNumber: 2,
      status: "skipped",
      topicTitle: "Jeju food",
      topicAngle: "local guide",
      targetCustomer: "first-time travelers",
      region: "Jeju",
      season: null,
      referenceUrl: "https://example.com/jeju",
      priority: 10,
      notes: "avoid generic tips",
      validationErrors: ["duplicate_existing_topic"],
      createdAt: "2026-07-06T00:00:00.000Z",
      usedAt: null
    }]);
  });

  it("crawls enabled sources into snapshots", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://example.com/blog") {
        return new Response(`
          <html><body><main><a href="/blog/owned-page">Owned page</a></main></body></html>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (href === "https://example.com/blog/owned-page") {
        return new Response(`
          <html>
            <head><meta property="og:type" content="article"><title>Owned page</title></head>
            <body><article><p>${"Useful brand copy. ".repeat(20)}</p></article></body>
          </html>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    const contentTopicInserts: unknown[][] = [];
    let snapshotInsertValues: unknown[] | undefined;
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("from source_urls") && sql.includes("enabled = true")) {
        return {
          rowCount: 1,
          rows: [{ id: "source-1", workspace_id: "workspace-1", brand_id: "brand-1", url: "https://example.com/blog" }]
        };
      }
      if (sql.includes("insert into source_content_items")) {
        return { rowCount: 1, rows: [{ id: "content-item-1", content_url: "https://example.com/blog/owned-page", latest_content_hash: null }] };
      }
      if (sql.includes("from source_snapshots") && sql.includes("content_hash")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("insert into source_snapshots")) {
        snapshotInsertValues = values;
        return { rowCount: 1, rows: [{ id: "snapshot-1" }] };
      }
      if (sql.includes("insert into content_topics")) {
        contentTopicInserts.push(values ?? []);
        return { rowCount: 1, rows: [{ id: "content-topic-1" }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({ query } as any);

    const result = await repository.crawlSources("brand-1");

    expect(result).toMatchObject({ processed: 1, created: 1, updated: 1, failed: 0 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("insert into source_snapshots"), expect.any(Array));
    expect(snapshotInsertValues?.[6]).toBeNull();
    expect(snapshotInsertValues?.[8]).toContain("Useful brand copy.");
    expect(snapshotInsertValues?.[9]).toContain("Useful brand copy.");
    expect(contentTopicInserts).toHaveLength(1);
    expect(JSON.parse(String(contentTopicInserts[0][3]))).toMatchObject({
      source: "source_url",
      sourceContentItemId: "content-item-1",
      sourceSnapshotId: "snapshot-1",
      contentUrl: "https://example.com/blog/owned-page"
    });
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/blog", expect.any(Object));
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/blog/owned-page", expect.any(Object));
    fetchSpy.mockRestore();
  });

  it("crawls only the requested source", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://example.com/blog") {
        return new Response('<html><body><main><a href="/blog/article">Article</a></main></body></html>', {
          status: 200,
          headers: { "content-type": "text/html" }
        });
      }
      return new Response(`<html><head><meta property="og:type" content="article"><title>Article</title></head><body><article><p>${"Useful content. ".repeat(30)}</p></article></body></html>`, {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    });
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("where id = $1 and brand_id = $2")) {
        return { rowCount: 1, rows: [{ id: "source-1", workspace_id: "workspace-1", brand_id: "brand-1", url: "https://example.com/blog" }] };
      }
      if (sql.includes("insert into source_crawl_runs")) {
        return { rowCount: 1, rows: [{ id: "run-1" }] };
      }
      if (sql.includes("insert into source_content_items")) {
        return { rowCount: 1, rows: [{ id: "content-item-1" }] };
      }
      if (sql.includes("from source_snapshots") && sql.includes("content_hash")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("insert into source_snapshots")) {
        return { rowCount: 1, rows: [{ id: "snapshot-1" }] };
      }
      if (sql.includes("update source_crawl_runs")) {
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({ query } as any);

    const result = await repository.crawlSingleSource("brand-1", "source-1", "new_source");

    expect(result.sourceUrlId).toBe("source-1");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("where id = $1 and brand_id = $2"), ["source-1", "brand-1"]);
    fetchSpy.mockRestore();
  });

  it("selects only sources whose last successful snapshot is at least 72 hours old", async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rowCount: 0, rows: [] }));
    const repository = createRepository({ query } as any);

    await repository.crawlDueSources(new Date("2026-07-12T00:00:00.000Z"));

    const dueQuery = query.mock.calls.find(([sql]) => String(sql).includes("interval '72 hours'"));
    expect(dueQuery?.[0]).toContain("limit $2");
  });

  it("backfills one selected content topic per crawled source queue row after crawling completes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://example.com/blog") {
        return new Response(`
          <html><body><main><a href="/blog/owned-page">Owned page</a></main></body></html>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (href === "https://example.com/blog/owned-page") {
        return new Response(`
          <html>
            <head><meta property="og:type" content="article"><title>Owned page</title></head>
            <body><article><p>${"Useful brand copy. ".repeat(20)}</p></article></body>
          </html>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("from source_urls") && sql.includes("enabled = true")) {
        return {
          rowCount: 1,
          rows: [{ id: "source-1", workspace_id: "workspace-1", brand_id: "brand-1", url: "https://example.com/blog" }]
        };
      }
      if (sql.includes("insert into source_content_items")) {
        return { rowCount: 1, rows: [{ id: "content-item-1", content_url: "https://example.com/blog/owned-page", latest_content_hash: null }] };
      }
      if (sql.includes("from source_snapshots") && sql.includes("content_hash")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("insert into source_snapshots")) {
        return { rowCount: 1, rows: [{ id: "snapshot-1" }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({ query } as any);

    await repository.crawlSources("brand-1");

    expect(query).toHaveBeenCalledWith(expect.stringContaining("latest_source_snapshots"), ["brand-1"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("jsonb_build_object"), ["brand-1"]);
    fetchSpy.mockRestore();
  });

  it("stores all discovered article URLs while skipping seed and category pages", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://example.com/blog") {
        return new Response(`
          <html>
            <body>
              <main>
                <a href="/category/featured">Featured category</a>
                <a href="/blog/jeju-route?utm_source=newsletter#comments">Jeju route guide</a>
                <a href="/blog/jeju-food">Jeju food guide</a>
              </main>
            </body>
          </html>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (href === "https://example.com/category/featured") {
        return new Response(`
          <html>
            <head><title>Featured category</title></head>
            <body><main><a href="/blog/jeju-route">Jeju route guide</a></main></body>
          </html>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (href === "https://example.com/blog/jeju-route") {
        return new Response(`
          <html>
            <head><meta property="og:type" content="article"><title>Jeju Route Guide</title></head>
            <body><article><p>${"Useful individual article body for Jeju family routes. ".repeat(10)}</p></article></body>
          </html>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (href === "https://example.com/blog/jeju-food") {
        return new Response(`
          <html>
            <head><meta property="og:type" content="article"><title>Jeju Food Guide</title></head>
            <body><article><p>${"Useful individual article body for Jeju food routes. ".repeat(10)}</p></article></body>
          </html>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    const contentItemValues: unknown[][] = [];
    const snapshotValues: unknown[][] = [];
    let contentItemIndex = 0;
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("from source_urls") && sql.includes("enabled = true")) {
        return {
          rowCount: 1,
          rows: [{ id: "source-1", workspace_id: "workspace-1", brand_id: "brand-1", url: "https://example.com/blog" }]
        };
      }
      if (sql.includes("insert into source_content_items")) {
        contentItemIndex += 1;
        contentItemValues.push(values ?? []);
        return {
          rowCount: 1,
          rows: [{
            id: `content-item-${contentItemIndex}`,
            content_url: values?.[4],
            canonical_url: null
          }]
        };
      }
      if (sql.includes("from source_snapshots") && sql.includes("content_hash")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("insert into source_snapshots")) {
        snapshotValues.push(values ?? []);
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({ query } as any);

    const result = await repository.crawlSources("brand-1");

    expect(result).toMatchObject({ processed: 1, created: 2, updated: 2, failed: 0 });
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/blog", expect.any(Object));
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/category/featured", expect.any(Object));
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/blog/jeju-route", expect.any(Object));
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/blog/jeju-food", expect.any(Object));
    expect(contentItemValues.map((values) => values[4])).toEqual([
      "https://example.com/blog/jeju-route",
      "https://example.com/blog/jeju-food"
    ]);
    expect(snapshotValues).toHaveLength(2);
    fetchSpy.mockRestore();
  });

  it("discovers content URLs from seeds and crawls each content URL into snapshots", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://example.com/blog") {
        return new Response(`
          <html>
            <body>
              <main>
                <a href="/blog/jeju-route?utm_source=newsletter#comments">Jeju route guide</a>
              </main>
            </body>
          </html>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (href === "https://example.com/blog/jeju-route") {
        return new Response(`
          <html>
            <head><meta property="og:type" content="article"><title>Jeju Route Guide</title></head>
            <body><article><p>${"Useful individual article body for Jeju family routes. ".repeat(10)}</p></article></body>
          </html>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    const contentItemValues: unknown[][] = [];
    const snapshotValues: unknown[][] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("from source_urls") && sql.includes("enabled = true")) {
        return {
          rowCount: 1,
          rows: [{ id: "source-1", workspace_id: "workspace-1", brand_id: "brand-1", url: "https://example.com/blog" }]
        };
      }
      if (sql.includes("insert into source_content_items")) {
        contentItemValues.push(values ?? []);
        return {
          rowCount: 1,
          rows: [{
            id: "content-item-1",
            content_url: values?.[4],
            canonical_url: null
          }]
        };
      }
      if (sql.includes("from source_snapshots") && sql.includes("content_hash")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("insert into source_snapshots")) {
        snapshotValues.push(values ?? []);
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({ query } as any);

    const result = await repository.crawlSources("brand-1");

    expect(result).toMatchObject({ processed: 1, created: 1, updated: 1, failed: 0 });
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/blog", expect.any(Object));
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/blog/jeju-route", expect.any(Object));
    expect(contentItemValues).toEqual(expect.arrayContaining([
      expect.arrayContaining(["https://example.com/blog/jeju-route", "anchor", "Jeju route guide"])
    ]));
    expect(snapshotValues.some((values) => values.includes("content-item-1"))).toBe(true);
    fetchSpy.mockRestore();
  });

  it("does not insert a duplicate succeeded snapshot for the same source content hash", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://example.com/blog") {
        return new Response(`
          <html><body><main><a href="/blog/owned-page">Owned page</a></main></body></html>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (href === "https://example.com/blog/owned-page") {
        return new Response(`
          <html>
            <head><meta property="og:type" content="article"><title>Owned page</title></head>
            <body><article><p>${"Useful brand copy. ".repeat(20)}</p></article></body>
          </html>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    const snapshotInserts: unknown[][] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("from source_urls") && sql.includes("enabled = true")) {
        return {
          rowCount: 1,
          rows: [{ id: "source-1", workspace_id: "workspace-1", brand_id: "brand-1", url: "https://example.com/blog" }]
        };
      }
      if (sql.includes("insert into source_content_items")) {
        return { rowCount: 1, rows: [{ id: "content-item-1", content_url: "https://example.com/blog/owned-page", latest_content_hash: null }] };
      }
      if (sql.includes("from source_snapshots") && sql.includes("content_hash")) {
        return { rowCount: 1, rows: [{ id: "snapshot-existing" }] };
      }
      if (sql.includes("insert into source_snapshots")) {
        snapshotInserts.push(values ?? []);
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({ query } as any);

    const result = await repository.crawlSources("brand-1");

    expect(result).toMatchObject({ processed: 1, created: 0, updated: 1, failed: 0 });
    expect(snapshotInserts).toHaveLength(0);
    fetchSpy.mockRestore();
  });

  it("lists only crawled content snapshots with URL and source type for the source queue", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [
        {
          id: "snapshot-1",
          source_url_id: "source-owned",
          source_content_item_id: "content-item-1",
          source_type: "owned",
          url: "https://brand.example.com/service",
          title: "Service page",
          status: "succeeded",
          fetched_at: new Date("2026-07-06T01:00:00.000Z"),
          summary: "Owned page summary",
          error_message: null
        }
      ]
    }));
    const repository = createRepository({ query } as any);

    const snapshots = await repository.listSourceSnapshots("brand-1");

    expect(query).toHaveBeenCalledWith(expect.stringContaining("from source_snapshots"), ["brand-1"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("sci.deleted_at is null"), ["brand-1"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ss.source_content_item_id is not null"), ["brand-1"]);
    expect(snapshots).toEqual([
      {
        id: "snapshot-1",
        sourceUrlId: "source-owned",
        contentItemId: "content-item-1",
        sourceType: "owned",
        url: "https://brand.example.com/service",
        title: "Service page",
        status: "succeeded",
        fetchedAt: "2026-07-06T01:00:00.000Z",
        summary: "Owned page summary",
        errorMessage: null
      }
    ]);
  });

  it("updates and soft deletes source URLs", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("select brand_id from source_urls")) {
        return { rowCount: 1, rows: [{ brand_id: "brand-1" }] };
      }
      if (sql.includes("count(*)") && sql.includes("source_type = 'reference'")) {
        return { rowCount: 1, rows: [{ count: "0" }] };
      }
      if (sql.includes("update source_urls") && sql.includes("where id = $1 and deleted_at is null")) {
        return {
          rowCount: 1,
          rows: [{
            id: "source-1",
            brand_id: "brand-1",
            source_type: values?.[1],
            url: values?.[2],
            title: null,
            status: "active",
            enabled: true,
            last_crawled_at: null,
            last_error: null
          }]
        };
      }
      if (sql.includes("update source_urls") && sql.includes("deleted_at = now()")) {
        return { rowCount: 1, rows: [{ id: "source-1" }] };
      }
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query } as any);

    await expect(repository.updateSource("source-1", { sourceType: "reference", url: "https://example.com/report" }))
      .resolves.toMatchObject({ id: "source-1", sourceType: "reference", url: "https://example.com/report" });
    await expect(repository.deleteSource("source-1")).resolves.toEqual({ id: "source-1" });
  });

  it("rejects source URLs that are not http or https URLs", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("select workspace_id from brands")) {
        return { rowCount: 1, rows: [{ workspace_id: "workspace-1" }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({ query } as any);

    await expect(repository.createSource("brand-1", { sourceType: "owned", url: "dans" }))
      .rejects.toThrow("source_url_invalid");
    await expect(repository.updateSource("source-1", { url: "ftp://example.com/report" }))
      .rejects.toThrow("source_url_invalid");
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("insert into source_urls"), expect.any(Array));
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("update source_urls"), expect.any(Array));
  });

  it("rejects creating more than ten active reference source URLs", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("select workspace_id from brands")) {
        return { rowCount: 1, rows: [{ workspace_id: "workspace-1" }] };
      }
      if (sql.includes("count(*)") && sql.includes("source_type = 'reference'")) {
        return { rowCount: 1, rows: [{ count: "10" }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({ query } as any);

    await expect(repository.createSource("brand-1", { sourceType: "reference", url: "https://example.com/reference-11" }))
      .rejects.toThrow("source_reference_limit_exceeded");
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("insert into source_urls"), expect.any(Array));
  });

  it("rejects changing an owned source to reference when ten other reference URLs already exist", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("select brand_id from source_urls")) {
        return { rowCount: 1, rows: [{ brand_id: "brand-1" }] };
      }
      if (sql.includes("count(*)") && sql.includes("id <> $2")) {
        return { rowCount: 1, rows: [{ count: "10" }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({ query } as any);

    await expect(repository.updateSource("source-owned", { sourceType: "reference", url: "https://example.com/owned-now-reference" }))
      .rejects.toThrow("source_reference_limit_exceeded");
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("update source_urls"), expect.any(Array));
  });

  it("generates one topic into two channel outputs", async () => {
    const insertedChannels: string[] = [];
    let masterDraftValues: unknown[] | undefined;
    let contentTopicValues: unknown[] | undefined;
    const llmRunValues: unknown[][] = [];
    const sourceSnapshotQueries: string[] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.trim() === "begin" || sql.trim() === "commit" || sql.trim() === "rollback") {
        return { rowCount: 0, rows: [] };
      }
      const policyResult = task4GenerationPolicyResult(sql);
      if (policyResult) return policyResult;
      if (sql.includes("from brands b") && sql.includes("join brand_profiles")) {
        return {
          rowCount: 1,
          rows: [{
            workspace_id: "workspace-1",
            brand_name: "Learning Brand",
            default_cta: "Request consultation",
            auto_approval_enabled: true
          }]
        };
      }
      if (isConnectedChannelQuery(sql)) return connectedChannelRows("instagram", "threads");
      if (sql.includes("from topic_rows") && sql.includes("for update skip locked")) {
        return {
          rowCount: 1,
          rows: [{
            id: "topic-row-1",
            topic_title: "Jeju food route",
            topic_angle: "local-first itinerary",
            target_customer: "first-time travelers",
            region: "Jeju",
            season: "spring",
            reference_url: "https://example.com/topic-reference",
            notes: "Keep route compact."
          }]
        };
      }
      if (sql.includes("from source_snapshots")) {
        sourceSnapshotQueries.push(sql);
        return { rowCount: 1, rows: [{ id: "snapshot-1", source_type: "owned", content_url: "https://brand.example.com/faq", content: "Owned FAQ says visitors need short routes." }] };
      }
      if (sql.includes("insert into content_topics")) {
        contentTopicValues = values;
        return { rowCount: 1, rows: [{ id: "content-topic-1" }] };
      }
      if (sql.includes("insert into master_drafts")) {
        masterDraftValues = values;
        return { rowCount: 1, rows: [{ id: "master-draft-1" }] };
      }
      if (sql.includes("insert into llm_runs")) {
        llmRunValues.push(values ?? []);
        return { rowCount: 1, rows: [{ id: "llm-run-1" }] };
      }
      if (sql.includes("insert into channel_outputs")) {
        insertedChannels.push(String(values?.[4]));
        return { rowCount: 1, rows: [{ id: `output-${values?.[4]}` }] };
      }
      if (sql.includes("select id from brand_channels")) {
        return { rowCount: 1, rows: [{ id: `channel-${values?.[1]}` }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    const result = await repository.generateContent("brand-1");

    expect(result).toMatchObject({ processed: 1, created: 2, failed: 0 });
    expect(insertedChannels).toEqual(["instagram", "threads"]);
    expect(masterDraftValues).toContain("source.direct.v1");
    expect(JSON.parse(String(masterDraftValues?.[4]))).toMatchObject({
      title: "Jeju food route",
      angle: "local-first itinerary",
      representativeUrl: "https://example.com/topic-reference",
      source: "topic_table"
    });
    expect(JSON.parse(String(contentTopicValues?.[5]))).toEqual({ source: "topic_table", topicRowId: "topic-row-1" });
    expect(sourceSnapshotQueries).toHaveLength(0);
    expect(llmRunValues).toHaveLength(0);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("insert into publish_queue"), expect.any(Array));
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("'threads_text_render'"),
      expect.arrayContaining(["workspace-1", "brand-1", "output-threads"])
    );
  });

  it("does not queue an approved Instagram output before its worker artifact exists", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.trimStart().startsWith("with updated as")) {
        return {
          rowCount: 1,
          rows: [{
            id: "output-1",
            status: "approved",
            workspace_id: "workspace-1",
            brand_id: "brand-1",
            channel: "instagram",
            brand_channel_id: "brand-channel-1",
            topic_publish_group_id: "publish-group-1",
            rendered_artifact_id: null
          }]
        };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    await repository.reviewContentOutput("output-1", "approve");

    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("insert into publish_queue"), expect.any(Array));
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("insert into jobs"), expect.any(Array));
  });

  it("leaves auto-approved Instagram output queued until its worker artifact is validated", async () => {
    const queueUpdates: string[] = [];
    const publishAttempts: unknown[][] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.trim() === "begin" || sql.trim() === "commit" || sql.trim() === "rollback") {
        return { rowCount: 0, rows: [] };
      }
      const policyResult = task4GenerationPolicyResult(sql);
      if (policyResult) return policyResult;
      if (sql.includes("from brands b") && sql.includes("join brand_profiles")) {
        return {
          rowCount: 1,
          rows: [{
            workspace_id: "workspace-1",
            brand_name: "Learning Brand",
            default_cta: "Request consultation",
            auto_approval_enabled: true
          }]
        };
      }
      if (isConnectedChannelQuery(sql)) return connectedChannelRows("instagram");
      if (sql.includes("from content_topics ct") && sql.includes("for update")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("from topic_rows") && sql.includes("for update skip locked")) {
        return {
          rowCount: 1,
          rows: [{
            id: "topic-row-1",
            topic_title: "Jeju route",
            topic_angle: "compact trip",
            target_customer: "family travelers",
            region: "Jeju",
            season: "spring",
            reference_url: null,
            notes: null
          }]
        };
      }
      if (sql.includes("insert into content_topics")) {
        return { rowCount: 1, rows: [{ id: "content-topic-1" }] };
      }
      if (sql.includes("insert into master_drafts")) {
        return { rowCount: 1, rows: [{ id: "master-draft-1" }] };
      }
      if (sql.includes("insert into llm_runs")) {
        return { rowCount: 1, rows: [{ id: "llm-run-1" }] };
      }
      if (sql.includes("insert into channel_outputs")) {
        return { rowCount: 1, rows: [{ id: "output-instagram" }] };
      }
      if (sql.includes("select id from brand_channels")) {
        return { rowCount: 1, rows: [{ id: "channel-instagram" }] };
      }
      if (sql.includes("insert into publish_queue")) {
        expect(sql).toContain("returning id");
        return { rowCount: 1, rows: [{ id: "queue-instagram" }] };
      }
      if (sql.includes("update publish_queue") && sql.includes("set status = 'scheduled'")) {
        queueUpdates.push("scheduled");
        expect(values?.[0]).toBe("queue-instagram");
        return { rowCount: 1, rows: [{ id: "queue-instagram" }] };
      }
      if (sql.includes("from publish_queue pq") && sql.includes("join channel_outputs")) {
        return {
          rowCount: 1,
          rows: [{
            id: "queue-instagram",
            workspace_id: "workspace-1",
            brand_id: "brand-1",
            channel: "instagram",
            channel_output_id: "output-instagram",
            output_json: { caption: "caption" },
            rendered_manifest_url: null,
            external_account_id: null,
            encrypted_payload: null,
            attempt_count: "0"
          }]
        };
      }
      if (sql.includes("insert into publish_attempts")) {
        publishAttempts.push(values ?? []);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("update publish_queue") && sql.includes("set status = 'published'")) {
        queueUpdates.push("published");
        return { rowCount: 1, rows: [{ id: "queue-instagram", status: "published" }] };
      }
      if (sql.includes("update brand_channels")) {
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any, { instagramPublish: { enabled: false } });

    await expect(repository.generateContent("brand-1")).resolves.toMatchObject({ processed: 1, created: 1, failed: 0 });
    expect(queueUpdates).toEqual([]);
    expect(publishAttempts).toHaveLength(0);
  });

  it("generates content from crawled source snapshots when no topic rows are uploaded", async () => {
    const insertedChannels: string[] = [];
    let contentTopicValues: unknown[] | undefined;
    let imageJobPayload: Record<string, unknown> | undefined;
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.trim() === "begin" || sql.trim() === "commit" || sql.trim() === "rollback") {
        return { rowCount: 0, rows: [] };
      }
      const policyResult = task4GenerationPolicyResult(sql);
      if (policyResult) return policyResult;
      if (sql.includes("from brands b") && sql.includes("join brand_profiles")) {
        return {
          rowCount: 1,
          rows: [{
            workspace_id: "workspace-1",
            brand_name: "Jeju Pilot",
            industry: "travel consulting",
            primary_customer: "family travelers",
            description: "Jeju route consulting",
            tone: "expert",
            default_cta: "Request consultation",
            auto_approval_enabled: true
          }]
        };
      }
      if (isConnectedChannelQuery(sql)) return connectedChannelRows("instagram");
      if (sql.includes("from topic_rows") && sql.includes("for update skip locked")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("from source_snapshots")) {
        return {
          rowCount: 2,
          rows: [
            {
              id: "snapshot-1",
              source_content_item_id: "content-item-1",
              content_hash: "hash-1",
              source_type: "owned",
              content_url: "https://brand.example.com/service",
              representative_url: "https://brand.example.com/service",
              content: "Owned service page says family travelers need compact Jeju routes."
            },
            {
              id: "snapshot-2",
              source_content_item_id: "content-item-2",
              content_hash: "hash-2",
              source_type: "reference",
              content_url: "https://news.example.com/trend",
              content: "Reference article says short travel routes reduce friction."
            }
          ]
        };
      }
      if (sql.includes("insert into content_topics")) {
        contentTopicValues = values;
        return { rowCount: 1, rows: [{ id: "content-topic-1" }] };
      }
      if (sql.includes("insert into master_drafts")) return { rowCount: 1, rows: [{ id: "master-draft-1" }] };
      if (sql.includes("insert into channel_outputs")) {
        insertedChannels.push(String(values?.[4]));
        return { rowCount: 1, rows: [{ id: `output-${values?.[4]}` }] };
      }
      if (sql.includes("insert into jobs")) {
        imageJobPayload = JSON.parse(String(values?.[5]));
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("select id from brand_channels")) {
        return { rowCount: 1, rows: [{ id: `channel-${values?.[1]}` }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    const result = await repository.generateContent("brand-1");

    expect(result).toMatchObject({ processed: 1, created: 1, failed: 0 });
    expect(insertedChannels).toEqual(["instagram"]);
    expect(contentTopicValues?.[2]).toBeNull();
    expect(contentTopicValues?.[3]).toBe("크롤링 소스 기반 콘텐츠");
    expect(JSON.parse(String(contentTopicValues?.[5]))).toEqual({
      source: "source_url",
      sourceContentItemId: "content-item-1",
      sourceSnapshotId: "snapshot-1",
      contentUrl: "https://brand.example.com/service",
      representativeUrl: "https://brand.example.com/service",
      contentHash: "hash-1"
    });
    expect(imageJobPayload).toMatchObject({
      representativeUrl: "https://brand.example.com/service",
      topic: { title: "크롤링 소스 기반 콘텐츠", angle: "source_url" }
    });
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("insert into llm_runs"), expect.any(Array));
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("update topic_rows"), expect.any(Array));
  });

  it("generates the oldest selected source content topic before looking for new snapshots", async () => {
    const now = new Date("2026-07-13T01:00:00.000Z");
    const statusUpdates: unknown[][] = [];
    let imageJobPayload: Record<string, unknown> | undefined;
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.trim() === "begin" || sql.trim() === "commit" || sql.trim() === "rollback") {
        return { rowCount: 0, rows: [] };
      }
      const policyResult = task4GenerationPolicyResult(sql);
      if (policyResult) return policyResult;
      if (sql.includes("from brands b") && sql.includes("join brand_profiles")) {
        return {
          rowCount: 1,
          rows: [{
            workspace_id: "workspace-1",
            brand_name: "Jeju Pilot",
            industry: "travel consulting",
            primary_customer: "family travelers",
            description: "Jeju route consulting",
            tone: "expert",
            default_cta: "Request consultation",
            auto_approval_enabled: true
          }]
        };
      }
      if (isConnectedChannelQuery(sql)) return connectedChannelRows("instagram");
      if (sql.includes("from content_topics ct") && sql.includes("for update") && sql.includes("skip locked")) {
        return {
          rowCount: 1,
          rows: [{
            id: "content-topic-1",
            topic_row_id: null,
            title: "크롤링 기사 제목",
            angle: "source_url",
            source_context: {
              source: "source_url",
              sourceContentItemId: "content-item-1",
              sourceSnapshotId: "snapshot-1",
              contentUrl: "https://brand.example.com/service",
              contentHash: "hash-1"
            },
            topic_title: null,
            topic_angle: null,
            target_customer: null,
            region: null,
            season: null,
            reference_url: null,
            notes: null
          }]
        };
      }
      if (sql.includes("from source_snapshots ss") && sql.includes("ss.id = $1")) {
        return {
          rowCount: 1,
          rows: [{
            id: "snapshot-1",
            source_content_item_id: "content-item-1",
            content_hash: "hash-1",
            source_type: "owned",
            content_url: "https://brand.example.com/service",
            representative_url: "https://brand.example.com/service",
            content: "Owned service page says family travelers need compact Jeju routes."
          }]
        };
      }
      if (sql.includes("update content_topics") && sql.includes("set status = 'generating'")) {
        statusUpdates.push(values ?? []);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("update content_topics") && sql.includes("set status = 'generated'")) {
        statusUpdates.push(values ?? []);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("insert into master_drafts")) return { rowCount: 1, rows: [{ id: "master-draft-1" }] };
      if (sql.includes("insert into channel_outputs")) return { rowCount: 1, rows: [{ id: "output-instagram" }] };
      if (sql.includes("insert into jobs")) {
        imageJobPayload = JSON.parse(String(values?.[5]));
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("select id from brand_channels")) return { rowCount: 1, rows: [{ id: "channel-instagram" }] };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    const result = await repository.generateContent("brand-1", now);

    expect(result).toMatchObject({ processed: 1, created: 1, failed: 0 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("from content_topics ct"), ["brand-1"]);
    expect(statusUpdates).toEqual([["content-topic-1", "instagram_feed_carousel"], ["content-topic-1", now]]);
    expect(imageJobPayload).toMatchObject({
      representativeUrl: "https://brand.example.com/service",
      topic: { title: "크롤링 기사 제목", angle: "source_url" }
    });
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("insert into content_topics"), expect.any(Array));
  });


  it("stores source-direct metadata and ignores legacy central OpenAI options", async () => {
    let masterDraftValues: unknown[] | undefined;
    const llmRunValues: unknown[][] = [];
    let legacyGeneratorCalled = false;
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.trim() === "begin" || sql.trim() === "commit" || sql.trim() === "rollback") return { rowCount: 0, rows: [] };
      const policyResult = task4GenerationPolicyResult(sql);
      if (policyResult) return policyResult;
      if (sql.includes("from brands b") && sql.includes("join brand_profiles")) {
        return { rowCount: 1, rows: [{ workspace_id: "workspace-1", brand_name: "Jeju Pilot", default_cta: "Book now", auto_approval_enabled: false }] };
      }
      if (isConnectedChannelQuery(sql)) return connectedChannelRows("instagram", "threads");
      if (sql.includes("from topic_rows") && sql.includes("for update skip locked")) {
        return { rowCount: 1, rows: [{ id: "topic-row-1", topic_title: "Jeju food route", topic_angle: "local-first itinerary", target_customer: "first-time travelers" }] };
      }
      if (sql.includes("from source_snapshots")) return { rowCount: 1, rows: [{ id: "snapshot-1", summary: "Owned FAQ says visitors need short routes." }] };
      if (sql.includes("insert into content_topics")) return { rowCount: 1, rows: [{ id: "content-topic-1" }] };
      if (sql.includes("insert into master_drafts")) {
        masterDraftValues = values;
        return { rowCount: 1, rows: [{ id: "master-draft-1" }] };
      }
      if (sql.includes("insert into llm_runs")) {
        llmRunValues.push(values ?? []);
        return { rowCount: 1, rows: [{ id: "llm-run-1" }] };
      }
      if (sql.includes("insert into channel_outputs")) return { rowCount: 1, rows: [{ id: `output-${values?.[4]}` }] };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any, {
      openAi: { apiKey: "sk-test", model: "gpt-5.5", enabled: true },
      generateMasterDraft: async () => {
        legacyGeneratorCalled = true;
        throw new Error("legacy_generator_must_not_run");
      }
    } as any);

    const result = await repository.generateContent("brand-1");

    expect(result).toMatchObject({ processed: 1, created: 2, failed: 0 });
    expect(masterDraftValues).toContain("source.direct.v1");
    expect(JSON.parse(String(masterDraftValues?.[4]))).toMatchObject({
      title: "Jeju food route",
      angle: "local-first itinerary",
      source: "topic_table"
    });
    expect(legacyGeneratorCalled).toBe(false);
    expect(llmRunValues).toHaveLength(0);
  });

  it("generates channel outputs only for connected channels", async () => {
    const insertedChannels: string[] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.trim() === "begin" || sql.trim() === "commit" || sql.trim() === "rollback") return { rowCount: 0, rows: [] };
      const policyResult = task4GenerationPolicyResult(sql);
      if (policyResult) return policyResult;
      if (sql.includes("from brands b") && sql.includes("join brand_profiles")) {
        return { rowCount: 1, rows: [{ workspace_id: "workspace-1", brand_name: "Jeju Pilot", default_cta: "Book now", auto_approval_enabled: false }] };
      }
      if (isConnectedChannelQuery(sql)) return connectedChannelRows("instagram");
      if (sql.includes("from topic_rows") && sql.includes("for update skip locked")) {
        return { rowCount: 1, rows: [{ id: "topic-row-1", topic_title: "Jeju food route", topic_angle: "local-first itinerary", target_customer: "first-time travelers" }] };
      }
      if (sql.includes("from source_snapshots")) return { rowCount: 1, rows: [{ id: "snapshot-1", source_type: "owned", content_url: "https://brand.example.com/faq", content: "Owned FAQ says visitors need short routes." }] };
      if (sql.includes("insert into content_topics")) return { rowCount: 1, rows: [{ id: "content-topic-1" }] };
      if (sql.includes("insert into master_drafts")) return { rowCount: 1, rows: [{ id: "master-draft-1" }] };
      if (sql.includes("insert into llm_runs")) return { rowCount: 1, rows: [{ id: "llm-run-1" }] };
      if (sql.includes("insert into channel_outputs")) {
        insertedChannels.push(String(values?.[4]));
        return { rowCount: 1, rows: [{ id: `output-${values?.[4]}` }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    const result = await repository.generateContent("brand-1");

    expect(result).toMatchObject({ processed: 1, created: 1, failed: 0 });
    expect(insertedChannels).toEqual(["instagram"]);
  });

  it("creates an Instagram render job instead of generating images in the API", async () => {
    let storageArtifactValues: unknown[] | undefined;
    let renderedOutputValues: unknown[] | undefined;
    let imageJobPayload: Record<string, unknown> | undefined;
    let threadsJobPayload: Record<string, unknown> | undefined;
    const llmRunValues: unknown[][] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.trim() === "begin" || sql.trim() === "commit" || sql.trim() === "rollback") return { rowCount: 0, rows: [] };
      const policyResult = task4GenerationPolicyResult(sql);
      if (policyResult) return policyResult;
      if (sql.includes("from brands b") && sql.includes("join brand_profiles")) {
        return { rowCount: 1, rows: [{
          workspace_id: "workspace-1",
          brand_name: "Jeju Pilot",
          category_code: "travel_tourism",
          category_name: "여행·관광",
          subcategories: [{ type: "system", code: "travel_consulting", name: "여행 상담" }],
          primary_customer: "제주 가족 여행자",
          description: "제주 일정과 숙소 동선을 상담합니다.",
          tone: "친절하지만 과장 없는 전문가 톤",
          default_cta: "Book now",
          auto_approval_enabled: false
        }] };
      }
      if (isConnectedChannelQuery(sql)) return connectedChannelRows("instagram", "threads");
      if (sql.includes("from topic_rows") && sql.includes("for update skip locked")) {
        return { rowCount: 1, rows: [{ id: "topic-row-1", topic_title: "Jeju family stay", topic_angle: "location-first checklist", target_customer: "family travelers" }] };
      }
      if (sql.includes("from source_snapshots")) return { rowCount: 1, rows: [{ id: "snapshot-1", source_type: "owned", content_url: "https://brand.example.com/faq", content: "Owned FAQ says visitors need short routes." }] };
      if (sql.includes("insert into content_topics")) return { rowCount: 1, rows: [{ id: "content-topic-1" }] };
      if (sql.includes("insert into master_drafts")) return { rowCount: 1, rows: [{ id: "master-draft-1" }] };
      if (sql.includes("insert into llm_runs")) {
        llmRunValues.push(values ?? []);
        return { rowCount: 1, rows: [{ id: "llm-run-1" }] };
      }
      if (sql.includes("insert into channel_outputs")) return { rowCount: 1, rows: [{ id: `output-${values?.[4]}` }] };
      if (sql.includes("insert into jobs")) {
        if (sql.includes("'threads_text_render'")) {
          threadsJobPayload = JSON.parse(String(values?.[4]));
        } else {
          expect(values?.[4]).toBe("instagram_feed_render");
          imageJobPayload = JSON.parse(String(values?.[5]));
        }
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("insert into storage_artifacts")) {
        storageArtifactValues = values;
        return { rowCount: 1, rows: [{ id: "artifact-1" }] };
      }
      if (sql.includes("update channel_outputs") && sql.includes("rendered_artifact_id")) {
        renderedOutputValues = values;
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    const result = await repository.generateContent("brand-1");

    expect(result).toMatchObject({ processed: 1, created: 2, updated: 1, failed: 0 });
    expect(storageArtifactValues).toBeUndefined();
    expect(renderedOutputValues).toBeUndefined();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("insert into jobs"), expect.arrayContaining(["workspace-1", "brand-1", "output-instagram"]));
    expect(imageJobPayload).toMatchObject({
      deliveryFormat: "instagram_feed_carousel",
      promptVersion: "worker-card.v4",
      maxImages: 5,
      contentTopicId: "content-topic-1",
      representativeUrl: null,
      topic: {
        title: "Jeju family stay",
        angle: "location-first checklist",
        targetCustomer: "family travelers"
      },
      brand: {
        name: "Jeju Pilot",
        categoryContext: "여행·관광 / 여행 상담",
        description: "제주 일정과 숙소 동선을 상담합니다."
      }
    });
    expect(imageJobPayload).not.toHaveProperty("prompt");
    expect(imageJobPayload).not.toHaveProperty("outputFormat");
    expect(imageJobPayload?.storagePrefix).toMatch(
      /^brands\/brand-1\/topics\/content-topic-1\/instagram_feed_carousel\/[0-9a-f-]+$/
    );
    expect(imageJobPayload).not.toHaveProperty("slides");
    expect(threadsJobPayload).toMatchObject({
      deliveryFormat: "threads_text",
      promptVersion: "worker-threads.v1",
      representativeUrl: null,
      topic: {
        title: "Jeju family stay",
        angle: "location-first checklist",
        targetCustomer: "family travelers"
      },
      brand: { categoryContext: "여행·관광 / 여행 상담" }
    });
    expect(llmRunValues.some((values) => values.includes("channel_output") && values.includes("gpt-image-2"))).toBe(false);
  });

  it("does not create image artifacts while the worker owns rendering", async () => {
    let storageArtifactValues: unknown[] | undefined;
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.trim() === "begin" || sql.trim() === "commit" || sql.trim() === "rollback") return { rowCount: 0, rows: [] };
      const policyResult = task4GenerationPolicyResult(sql);
      if (policyResult) return policyResult;
      if (sql.includes("from brands b") && sql.includes("join brand_profiles")) {
        return { rowCount: 1, rows: [{ workspace_id: "workspace-1", brand_name: "Jeju Pilot", default_cta: "Book now", auto_approval_enabled: false }] };
      }
      if (isConnectedChannelQuery(sql)) return connectedChannelRows("instagram");
      if (sql.includes("from topic_rows") && sql.includes("for update skip locked")) {
        return { rowCount: 1, rows: [{ id: "topic-row-1", topic_title: "Jeju family stay", topic_angle: "location-first checklist", target_customer: "family travelers" }] };
      }
      if (sql.includes("from source_snapshots")) return { rowCount: 1, rows: [{ id: "snapshot-1", source_type: "owned", content_url: "https://brand.example.com/faq", content: "Owned FAQ says visitors need short routes." }] };
      if (sql.includes("insert into content_topics")) return { rowCount: 1, rows: [{ id: "content-topic-1" }] };
      if (sql.includes("insert into master_drafts")) return { rowCount: 1, rows: [{ id: "master-draft-1" }] };
      if (sql.includes("insert into llm_runs")) return { rowCount: 1, rows: [{ id: "llm-run-1" }] };
      if (sql.includes("insert into channel_outputs")) return { rowCount: 1, rows: [{ id: `output-${values?.[4]}` }] };
      if (sql.includes("insert into storage_artifacts")) {
        storageArtifactValues = values;
        return { rowCount: 1, rows: [{ id: "artifact-1" }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    const result = await repository.generateContent("brand-1");

    expect(result).toMatchObject({ processed: 1, created: 1, updated: 1, failed: 0 });
    expect(storageArtifactValues).toBeUndefined();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("insert into jobs"), expect.any(Array));
  });

  it("does not call the legacy OpenAI generator or write llm_runs", async () => {
    const llmRunValues: unknown[][] = [];
    const topicUpdates: unknown[][] = [];
    let legacyGeneratorCalled = false;
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.trim() === "begin" || sql.trim() === "commit" || sql.trim() === "rollback") return { rowCount: 0, rows: [] };
      const policyResult = task4GenerationPolicyResult(sql);
      if (policyResult) return policyResult;
      if (sql.includes("from brands b") && sql.includes("join brand_profiles")) {
        return { rowCount: 1, rows: [{ workspace_id: "workspace-1", brand_name: "Jeju Pilot", default_cta: "Book now", auto_approval_enabled: false }] };
      }
      if (isConnectedChannelQuery(sql)) return connectedChannelRows("instagram", "threads");
      if (sql.includes("from topic_rows") && sql.includes("for update skip locked")) {
        return { rowCount: 1, rows: [{ id: "topic-row-1", topic_title: "Jeju food route", topic_angle: "local-first itinerary", target_customer: "first-time travelers" }] };
      }
      if (sql.includes("from source_snapshots")) return { rowCount: 1, rows: [{ id: "snapshot-1", source_type: "owned", content_url: "https://brand.example.com/faq", content: "Owned FAQ says visitors need short routes." }] };
      if (sql.includes("insert into content_topics")) return { rowCount: 1, rows: [{ id: "content-topic-1" }] };
      if (sql.includes("insert into master_drafts")) return { rowCount: 1, rows: [{ id: "master-draft-1" }] };
      if (sql.includes("insert into llm_runs")) {
        llmRunValues.push(values ?? []);
        return { rowCount: 1, rows: [{ id: "llm-run-1" }] };
      }
      if (sql.includes("insert into channel_outputs")) {
        return { rowCount: 1, rows: [{ id: `output-${values?.[4]}` }] };
      }
      if (sql.includes("insert into jobs")) return { rowCount: 1, rows: [] };
      if (sql.includes("update topic_rows")) topicUpdates.push(values ?? []);
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any, {
      openAi: { apiKey: "sk-test", model: "gpt-5.5", enabled: true },
      generateMasterDraft: async () => {
        legacyGeneratorCalled = true;
        throw new Error("legacy_generator_must_not_run");
      }
    } as any);

    const result = await repository.generateContent("brand-1");

    expect(result).toMatchObject({ processed: 1, created: 2, failed: 0 });
    expect(legacyGeneratorCalled).toBe(false);
    expect(llmRunValues).toHaveLength(0);
    expect(topicUpdates.some((values) => values.includes("topic-row-1"))).toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("insert into master_drafts"), expect.any(Array));
  });

  it("exposes delivery format, output JSON, and source mode for real content previews", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        id: "output-story-1",
        content_id: "master-1",
        title: "Jeju Story",
        channel: "instagram",
        delivery_format: "instagram_story",
        status: "pending_review",
        preview_title: "Jeju Story",
        preview_body: "Story preview",
        output_json: { deliveryFormat: "instagram_story", sourceMode: "crawled", story: { publicUrl: "https://cdn.example.com/story.png" } },
        source_summary: "Owned source",
        block_reasons: [],
        generated_at: new Date("2026-07-13T01:00:00.000Z")
      }]
    }));
    const repository = createRepository({ query } as any);

    await expect(repository.listContentOutputs("brand-1")).resolves.toEqual([expect.objectContaining({
      id: "output-story-1",
      deliveryFormat: "instagram_story",
      outputJson: expect.objectContaining({ story: { publicUrl: "https://cdn.example.com/story.png" } }),
      sourceMode: "crawled"
    })]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("delivery_format"), ["brand-1"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("output_json"), ["brand-1"]);
  });

  it("schedules queued publish items and publishes one mock item", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("from topic_publish_groups") && sql.includes("status = 'ready'") && sql.includes("for update")) {
        return { rowCount: 1, rows: [{ id: "publish-group-1" }] };
      }
      if (sql.includes("update topic_publish_groups") && sql.includes("status = 'scheduled'")) {
        return { rowCount: 1, rows: [{ id: "publish-group-1" }] };
      }
      if (sql.includes("from publish_queue pq") && sql.includes("join channel_outputs")) {
        return {
          rowCount: 1,
          rows: [{
            id: "queue-1",
            workspace_id: "workspace-1",
            brand_id: "brand-1",
            channel: "instagram",
            channel_output_id: "output-1",
            output_json: { caption: "hello" },
            attempt_count: "0"
          }]
        };
      }
      if (sql.includes("update publish_queue") && sql.includes("returning id, status")) {
        return { rowCount: 1, rows: [{ id: values?.[0] ?? "queue-1", status: "published" }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    expect(await repository.schedulePublishQueue("brand-1")).toMatchObject({ processed: 1, updated: 1 });
    expect(await repository.publishQueueItem("queue-1")).toMatchObject({ id: "queue-1", status: "published", publishedUrl: "mock://instagram/output-1" });
  });

  describe("Task 11 topic publish group scheduling", () => {
    function schedulingFixture(groupIds: string[], occupied: Array<{ slot_date: string | Date; slot_number: number }> = []) {
      const statements: Array<{ sql: string; values: unknown[] }> = [];
      const query = vi.fn(async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values: values ?? [] });
        if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
        if (sql.includes("select id from brands") && sql.includes("for update")) {
          return { rowCount: 1, rows: [{ id: "brand-1" }] };
        }
        if (sql.includes("from topic_publish_groups") && sql.includes("status = 'ready'") && sql.includes("for update")) {
          return { rowCount: groupIds.length, rows: groupIds.map((id) => ({ id })) };
        }
        if (sql.includes("from topic_publish_groups") && sql.includes("slot_date >=")) {
          return { rowCount: occupied.length, rows: occupied };
        }
        if (sql.includes("update topic_publish_groups") && sql.includes("status = 'scheduled'")) {
          return { rowCount: 1, rows: [{ id: values?.[0] }] };
        }
        if (sql.includes("update publish_queue") && sql.includes("topic_publish_group_id")) {
          return { rowCount: 2, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      });
      return { query, statements };
    }

    it("assigns Instagram and Threads rows in one group the same timestamp and slot", async () => {
      const fixture = schedulingFixture(["publish-group-1"]);
      const repository = createRepository(fakePoolWithClient(fixture.query) as any);

      await expect(repository.schedulePublishQueue("brand-1", new Date("2026-07-13T01:00:00.000Z")))
        .resolves.toEqual({ processed: 1, created: 0, updated: 2, failed: 0 });

      const groupUpdate = fixture.statements.find(({ sql }) => sql.includes("update topic_publish_groups") && sql.includes("status = 'scheduled'"));
      const queueUpdate = fixture.statements.find(({ sql }) => sql.includes("update publish_queue") && sql.includes("topic_publish_group_id"));
      expect(groupUpdate?.values.slice(1)).toEqual(queueUpdate?.values.slice(1));
      expect(queueUpdate?.sql).toContain("where topic_publish_group_id = $1");
      expect(queueUpdate?.sql).toContain("status = 'queued'");
      expect(queueUpdate?.sql).not.toMatch(/delivery_format|output_json/);
    });

    it("counts active topic groups instead of channel rows and overflows after four groups", async () => {
      const fixture = schedulingFixture([
        "publish-group-1", "publish-group-2", "publish-group-3", "publish-group-4", "publish-group-5"
      ]);
      const repository = createRepository(fakePoolWithClient(fixture.query) as any);

      await repository.schedulePublishQueue("brand-1", new Date("2026-07-13T01:00:00.000Z"));

      const groupUpdates = fixture.statements.filter(({ sql }) => sql.includes("update topic_publish_groups") && sql.includes("status = 'scheduled'"));
      expect(groupUpdates.map(({ values }) => [values[1], values[2]])).toEqual([
        ["2026-07-13", 1], ["2026-07-13", 2], ["2026-07-13", 3], ["2026-07-13", 4], ["2026-07-14", 1]
      ]);
      expect(fixture.statements.filter(({ sql }) => sql.includes("update publish_queue") && sql.includes("topic_publish_group_id"))).toHaveLength(5);
    });

    it("normalizes PostgreSQL Date slot values before selecting the next slot", async () => {
      const fixture = schedulingFixture(
        ["publish-group-1"],
        [{ slot_date: new Date("2026-07-13T15:00:00.000Z"), slot_number: 1 }]
      );
      const repository = createRepository(fakePoolWithClient(fixture.query) as any);

      await repository.schedulePublishQueue("brand-1", new Date("2026-07-13T12:30:00.000Z"));

      const groupUpdate = fixture.statements.find(({ sql }) => (
        sql.includes("update topic_publish_groups") && sql.includes("status = 'scheduled'")
      ));
      expect(groupUpdate?.values.slice(1, 3)).toEqual(["2026-07-14", 2]);
    });

    it("makes pending outputs wait while rejected and terminal failures do not block approved siblings", async () => {
      const fixture = schedulingFixture([]);
      const repository = createRepository(fakePoolWithClient(fixture.query) as any);

      await repository.schedulePublishQueue("brand-1", new Date("2026-07-13T01:00:00.000Z"));

      const readiness = fixture.statements.find(({ sql }) => sql.includes("latest_render_jobs") && sql.includes("update topic_publish_groups"));
      expect(readiness?.sql).toContain("'pending_review', 'auto_approval_blocked', 'regenerating'");
      expect(readiness?.sql).toContain("latest_render.status in ('queued', 'running')");
      expect(readiness?.sql).toContain("co.status = 'rejected'");
      expect(readiness?.sql).toContain("latest_render.status = 'failed'");
      expect(readiness?.sql).toContain("pq.id is not null");
      expect(readiness?.sql).toContain("tpg.status in ('waiting', 'ready')");
      expect(readiness?.sql).toContain("count(pq.id) filter (where pq.status = 'queued') > 0");
    });

    it("serializes and conditionally claims group slots so concurrent calls are idempotent", async () => {
      const fixture = schedulingFixture(["publish-group-1"]);
      const repository = createRepository(fakePoolWithClient(fixture.query) as any);

      await repository.schedulePublishQueue("brand-1", new Date("2026-07-13T01:00:00.000Z"));

      const lockIndex = fixture.statements.findIndex(({ sql }) => sql.includes("select id from brands") && sql.includes("for update"));
      const claimIndex = fixture.statements.findIndex(({ sql }) => sql.includes("update topic_publish_groups") && sql.includes("status = 'scheduled'"));
      expect(fixture.statements[0]?.sql).toBe("begin");
      expect(lockIndex).toBeGreaterThan(0);
      expect(lockIndex).toBeLessThan(claimIndex);
      expect(fixture.statements[claimIndex]?.sql).toContain("where id = $1 and status = 'ready'");
      expect(fixture.statements.at(-1)?.sql).toBe("commit");
    });
  });

  it("publishes Instagram queue items through Meta when generated image manifest is available", async () => {
    const events: string[] = [];
    const publishAttempts: unknown[][] = [];
    const queueUpdates: unknown[][] = [];
    const channelUpdates: unknown[][] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("from publish_queue pq") && sql.includes("join channel_outputs")) {
        events.push("claim");
        if (sql.includes("insert into publish_attempts")) events.push("attempt-started");
        return {
          rowCount: 1,
          rows: [{
            id: "queue-1",
            workspace_id: "workspace-1",
            brand_id: "brand-1",
            channel: "instagram",
            channel_output_id: "output-1",
            output_json: {
              caption: "제주 가족여행 숙소 선택법\n\n숙소 위치와 이동 시간을 함께 확인하세요.",
              hashtags: ["#제주여행", "#가족여행", "#제주숙소", "#여행동선", "#여행준비"]
            },
            attempt_count: "0",
            rendered_manifest_url: "https://cdn.example.com/rendered-content/instagram/brand-1/output-1/manifest.json",
            external_account_id: "17890000000000000",
            encrypted_payload: encryptCredential("meta-token"),
            attempt_id: "attempt-1"
          }]
        };
      }
      if (sql.includes("insert into publish_attempts") && !sql.includes("set status = 'publishing'")) {
        events.push("attempt-started");
        publishAttempts.push(values ?? []);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("set status = 'published'")) {
        queueUpdates.push(values ?? []);
        publishAttempts.push(values ?? []);
        return { rowCount: 1, rows: [{ id: values?.[1] ?? "queue-1", status: "published" }] };
      }
      if (sql.includes("update brand_channels")) channelUpdates.push(values ?? []);
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({ query } as any, {
      instagramPublish: { enabled: true },
      fetchInstagramImageManifest: async () => ({
        images: [
          { publicUrl: "https://cdn.example.com/slide-1.png" },
          { publicUrl: "https://cdn.example.com/slide-2.png" }
        ]
      }),
      publishInstagramCarousel: async (input: {
        accessToken: string;
        instagramBusinessAccountId: string;
        imageUrls: string[];
        caption: string;
      }) => {
        events.push("provider-called");
        expect(input).toMatchObject({
          accessToken: "meta-token",
          instagramBusinessAccountId: "17890000000000000",
          imageUrls: ["https://cdn.example.com/slide-1.png", "https://cdn.example.com/slide-2.png"],
          caption: "제주 가족여행 숙소 선택법\n\n숙소 위치와 이동 시간을 함께 확인하세요.\n\n#제주여행 #가족여행 #제주숙소 #여행동선 #여행준비"
        });
        return { externalPostId: "ig-post-1", publishedUrl: null };
      }
    } as any);

    await expect(repository.publishQueueItem("queue-1")).resolves.toMatchObject({ id: "queue-1", status: "published", publishedUrl: null });
    expect(query.mock.calls[0]?.[0]).toContain("set status = 'publishing'");
    expect(query.mock.calls[0]?.[0]).toContain("where pq.id = selected.id and pq.status = 'scheduled'");
    expect(events.indexOf("attempt-started")).toBeLessThan(events.indexOf("provider-called"));
    expect(publishAttempts.some((values) => values.includes("ig-post-1"))).toBe(true);
    expect(queueUpdates.length).toBe(1);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("update brand_channels"))).toBe(true);
  });

  it("lists publish queue rows with topic and source context in one table model", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from publish_queue pq")) {
        return {
          rowCount: 1,
          rows: [{
            id: "queue-1",
            title: "Jeju family stay",
            channel: "instagram",
            status: "scheduled",
            approval_type: "manual",
            topic_publish_group_id: "publish-group-1",
            slot_date: "2026-07-07",
            slot_number: 1,
            scheduled_for: new Date("2026-07-07T02:30:00.000Z"),
            last_error: null,
            topic_title: "Family stay checklist",
            topic_angle: "location-first",
            reference_url: "https://example.com/reference",
            source_summary: "Owned FAQ says family travelers need short routes.",
            source_urls: ["https://brand.example.com/faq", "https://news.example.com/trends"],
            queued_at: new Date("2026-07-07T01:10:00.000Z")
          }]
        };
      }
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    const rows = await repository.listPublishQueue("brand-1");

    expect(query).toHaveBeenCalledWith(expect.stringContaining("left join topic_rows"), ["brand-1"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("source_urls"), ["brand-1"]);
    expect(rows).toEqual([{
      id: "queue-1",
      title: "Jeju family stay",
      channel: "instagram",
      status: "scheduled",
      approvalType: "manual",
      topicPublishGroupId: "publish-group-1",
      slotDate: "2026-07-07",
      slotNumber: 1,
      scheduledFor: "2026-07-07T02:30:00.000Z",
      lastError: null,
      sourceType: "mixed",
      sourceLabel: "Family stay checklist",
      sourceDetail: "location-first | https://example.com/reference | Owned FAQ says family travelers need short routes.",
      sourceUrls: ["https://brand.example.com/faq", "https://news.example.com/trends"],
      queuedAt: "2026-07-07T01:10:00.000Z",
      renderStatus: null
    }]);
  });

  it("lists selected source content topics as pre-LLM queued publish management rows", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      expect(values).toEqual(["brand-1"]);
      if (sql.includes("from publish_queue pq")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("from content_topics ct")) {
        return {
          rowCount: 1,
          rows: [{
            id: "topic:content-topic-1",
            title: "부동산 지고 주식 뜬다?",
            channel: "instagram",
            status: "queued",
            approval_type: "empty",
            scheduled_for: null,
            last_error: null,
            topic_title: null,
            topic_angle: null,
            reference_url: null,
            source_summary: null,
            source_urls: ["https://blog.opensurvey.co.kr/article/finance-2026-2/"],
            queued_at: new Date("2026-07-08T01:10:00.000Z")
          }]
        };
      }
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query } as any);

    const rows = await repository.listPublishQueue("brand-1");

    expect(query).toHaveBeenCalledWith(expect.stringContaining("from content_topics ct"), ["brand-1"]);
    expect(rows).toEqual([{
      id: "topic:content-topic-1",
      title: "부동산 지고 주식 뜬다?",
      channel: "instagram",
      status: "queued",
      approvalType: "empty",
      topicPublishGroupId: null,
      slotDate: null,
      slotNumber: null,
      scheduledFor: null,
      lastError: null,
      sourceType: "source_url",
      sourceLabel: "크롤링 근거",
      sourceDetail: null,
      sourceUrls: ["https://blog.opensurvey.co.kr/article/finance-2026-2/"],
      queuedAt: "2026-07-08T01:10:00.000Z",
      renderStatus: null
    }]);
  });

  it("does not list generating source content topics as pre-LLM waiting rows", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      expect(values).toEqual(["brand-1"]);
      if (sql.includes("from publish_queue pq")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("from content_topics ct")) {
        expect(sql).toContain("ct.status = 'selected'");
        expect(sql).not.toContain("'generating'");
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query } as any);

    await expect(repository.listPublishQueue("brand-1")).resolves.toEqual([]);
  });

  it("packages published queue results for bulk download", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-download-"));
    const artifactDir = path.join(storageDir, "rendered-content", "instagram", "brand-1", "output-1");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(path.join(artifactDir, "slide-01.png"), Buffer.from("image-one"));
    await writeFile(path.join(artifactDir, "manifest.json"), JSON.stringify({
      images: [{ path: "rendered-content/instagram/brand-1/output-1/slide-01.png" }]
    }));
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        id: "queue-1",
        channel: "instagram",
        published_at: new Date("2026-07-07T11:30:00.000Z"),
        title: "Jeju family stay",
        preview_title: "제주 가족 숙소 카드뉴스",
        preview_body: "위치 먼저 확인하세요.",
        source_summary: "Owned FAQ says family travelers need short routes.",
        output_json: {
          caption: "제주 가족 숙소는 위치부터 확인하세요.",
          hashtags: ["#제주여행", "#가족여행"],
          slides: [{ title: "위치 먼저" }]
        },
        artifact_public_url: "https://cdn.example.com/rendered-content/instagram/brand-1/output-1/manifest.json",
        artifact_bucket: "rendered-content",
        artifact_path: "instagram/brand-1/output-1/manifest.json",
        external_url: "https://instagram.com/p/mock"
      }]
    }));
    const repository = createRepository({ query } as any, { artifactStorageDir: storageDir });

    try {
      const packageResult = await repository.downloadPublishedResults("brand-1");

      expect(query).toHaveBeenCalledWith(expect.stringContaining("pq.status = 'published'"), ["brand-1"]);
      expect(packageResult).toMatchObject({
        fileName: expect.stringMatching(/^brand-pilot-published-results-\d{4}-\d{2}-\d{2}\.zip$/),
        mimeType: "application/zip",
        itemCount: 1
      });
      expect(packageResult.buffer.subarray(0, 2).toString("utf8")).toBe("PK");
      expect(packageResult.buffer.includes(Buffer.from("published-summary.csv"))).toBe(true);
      expect(packageResult.buffer.includes(Buffer.from("instagram/jeju-family-stay-queue-1/caption.txt"))).toBe(true);
      expect(packageResult.buffer.includes(Buffer.from("instagram/jeju-family-stay-queue-1/images/slide-01.png"))).toBe(true);
      expect(packageResult.buffer.includes(Buffer.from("제주 가족 숙소는 위치부터 확인하세요."))).toBe(true);
      expect(packageResult.buffer.includes(Buffer.from("image-one"))).toBe(true);
    } finally {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  it("loads and normalizes a queue artifact from the trusted storage URL", async () => {
    const query = vi.fn(async (_sql: string, values?: unknown[]) => {
      expect(values).toEqual(["queue-1"]);
      return {
        rowCount: 1,
        rows: [{
          id: "queue-1",
          channel: "instagram",
          published_at: new Date("2026-07-07T11:30:00.000Z"),
          title: "Jeju family stay",
          preview_title: "제주 가족 숙소 카드뉴스",
          preview_body: "위치 먼저 확인하세요.",
          source_summary: "Owned FAQ summary",
          output_json: { manifestUrl: "https://untrusted.example/manifest.json" },
          artifact_public_url: "https://trusted.example/manifest.json",
          artifact_bucket: "rendered-content",
          artifact_path: "instagram/brand-1/output-1/manifest.json",
          external_url: "https://instagram.com/p/mock"
        }]
      };
    });
    const fetchPublishArtifact = vi.fn(async () => new Response(JSON.stringify({
      deliveryFormat: "instagram_feed_carousel",
      cards: [
        { url: "https://trusted.example/card-01.png", mimeType: "image/png", width: 1080, height: 1080 },
        { url: "https://trusted.example/card-02.png", mimeType: "image/png", width: 1080, height: 1080 }
      ]
    }), { headers: { "content-type": "application/json" } }));
    const repository = createRepository({ query } as any, {
      fetchPublishArtifact,
      publishArtifactFetchTimeoutMs: 250,
      publishArtifactAllowedOrigins: ["https://trusted.example"]
    } as any);

    await expect(repository.getPublishArtifact("queue-1")).resolves.toMatchObject({
      queueId: "queue-1",
      kind: "image_gallery",
      deliveryFormat: "instagram_feed_carousel",
      assets: [{ url: "https://trusted.example/card-01.png" }, { url: "https://trusted.example/card-02.png" }]
    });
    expect(fetchPublishArtifact).toHaveBeenCalledWith(
      "https://trusted.example/manifest.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it.each([
    ["fetch failure", async () => new Response("missing", { status: 404 })],
    ["invalid JSON", async () => new Response("not-json")]
  ])("surfaces a manifest error on %s", async (_case, fetchPublishArtifact) => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        id: "queue-1",
        channel: "threads",
        published_at: null,
        title: "Text update",
        preview_title: null,
        preview_body: "Preview fallback",
        source_summary: null,
        output_json: { deliveryFormat: "threads_text", body: "Published body" },
        artifact_public_url: "https://trusted.example/missing.json",
        artifact_bucket: null,
        artifact_path: null,
        external_url: null
      }]
    }));
    const repository = createRepository({ query } as any, {
      fetchPublishArtifact: vi.fn(fetchPublishArtifact),
      publishArtifactAllowedOrigins: ["https://trusted.example"]
    } as any);

    await expect(repository.getPublishArtifact("queue-1")).rejects.toThrow("publish_artifact_manifest_unavailable");
  });

  it("falls back to output JSON when no stored manifest URL exists", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        id: "queue-1",
        channel: "threads",
        published_at: null,
        title: "Text update",
        delivery_format: "threads_text",
        preview_title: null,
        preview_body: "Preview fallback",
        source_summary: null,
        output_json: { body: "Published body" },
        artifact_public_url: null,
        artifact_bucket: null,
        artifact_path: null,
        external_url: null
      }]
    }));
    const repository = createRepository({ query } as any);

    await expect(repository.getPublishArtifact("queue-1")).resolves.toMatchObject({
      queueId: "queue-1",
      kind: "text",
      text: "Published body"
    });
  });

  it("reports a missing queue result from artifact and download lookups", async () => {
    const repository = createRepository({ query: vi.fn(async () => ({ rowCount: 0, rows: [] })) } as any);

    await expect(repository.getPublishArtifact("missing")).rejects.toThrow("publish_queue_not_found");
    await expect(repository.downloadPublishResult("missing")).rejects.toThrow("publish_queue_not_found");
  });

  it("packages only the requested queue result", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      expect(sql).toContain("where pq.id = $1");
      expect(values).toEqual(["queue-1"]);
      return {
        rowCount: 1,
        rows: [{
          id: "queue-1",
          channel: "threads",
          published_at: new Date("2026-07-07T11:30:00.000Z"),
          title: "Selected result",
          preview_title: null,
          preview_body: "Only this result",
          source_summary: "Selected source",
          output_json: { body: "Only this result" },
          artifact_public_url: null,
          artifact_bucket: null,
          artifact_path: null,
          external_url: "https://threads.example/selected"
        }]
      };
    });
    const repository = createRepository({ query } as any);

    const packageResult = await repository.downloadPublishResult("queue-1");

    expect(packageResult.itemCount).toBe(1);
    expect(packageResult.fileName).toContain("queue-1");
    expect(packageResult.buffer.includes(Buffer.from("Selected result"))).toBe(true);
    expect(packageResult.buffer.includes(Buffer.from("other-queue"))).toBe(false);
  });

  it("groups publish results by content and preserves per-channel success and failure details", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      expect(values).toEqual(["brand-1"]);
      expect(sql).toContain("from publish_queue pq");
      expect(sql).toContain("latest_attempt");
      return {
        rowCount: 3,
        rows: [
          {
            content_id: "master-1",
            content_title: "제주 가족 숙소 카드뉴스",
            generated_at: new Date("2026-07-08T01:00:00.000Z"),
            queue_id: "queue-instagram",
            channel_output_id: "output-instagram",
            channel: "instagram",
            status: "published",
            published_at: new Date("2026-07-08T02:30:00.000Z"),
            failed_at: null,
            channel_title: "인스타 카드뉴스",
            preview_title: "제주 숙소 선택 기준",
            preview_body: "캡션 내용",
            output_json: { caption: "캡션 내용", slides: [{ title: "숙소 기준" }] },
            artifact_public_url: "https://cdn.example.com/instagram/manifest.json",
            external_post_id: "ig-post-1",
            attempt_error_message: null,
            last_error: null,
            source_summary: "자사 FAQ 요약",
            topic_title: "가족 숙소 체크리스트",
            topic_angle: "위치 중심",
            reference_url: "https://example.com/reference",
            source_urls: ["https://brand.example.com/faq"]
          },
          {
            content_id: "master-1",
            content_title: "제주 가족 숙소 카드뉴스",
            generated_at: new Date("2026-07-08T01:01:00.000Z"),
            queue_id: "queue-threads",
            channel_output_id: "output-threads",
            channel: "threads",
            status: "failed",
            published_at: null,
            failed_at: new Date("2026-07-08T02:31:00.000Z"),
            channel_title: "Threads 게시글",
            preview_title: "제주 숙소 선택 기준",
            preview_body: "Threads 본문",
            output_json: { text: "Threads 본문" },
            artifact_public_url: null,
            external_post_id: null,
            attempt_error_message: "token expired",
            last_error: "publish failed",
            source_summary: "자사 FAQ 요약",
            topic_title: "가족 숙소 체크리스트",
            topic_angle: "위치 중심",
            reference_url: "https://example.com/reference",
            source_urls: ["https://brand.example.com/faq"]
          }
        ]
      };
    });
    const repository = createRepository({ query } as any);

    const results = await repository.listPublishResults("brand-1");

    expect(results).toEqual([{
      contentId: "master-1",
      title: "제주 가족 숙소 카드뉴스",
      generatedAt: "2026-07-08T01:01:00.000Z",
      sourceType: "mixed",
      sourceLabel: "가족 숙소 체크리스트",
      sourceDetail: "위치 중심 | https://example.com/reference | 자사 FAQ 요약",
      sourceUrls: ["https://brand.example.com/faq"],
      channels: [
        expect.objectContaining({
          queueId: "queue-instagram",
          channel: "instagram",
          status: "published",
          publishedAt: "2026-07-08T02:30:00.000Z",
          previewBody: "캡션 내용",
          artifactPublicUrl: "https://cdn.example.com/instagram/manifest.json",
          externalPostId: "ig-post-1",
          lastError: null
        }),
        expect.objectContaining({
          queueId: "queue-threads",
          channel: "threads",
          status: "failed",
          failedAt: "2026-07-08T02:31:00.000Z",
          previewBody: "Threads 본문",
          lastError: "token expired"
        })
      ]
    }]);
  });

  it("does not publish queue items before they are scheduled", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from publish_queue pq") && sql.includes("join channel_outputs")) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createRepository({ query } as any);

    await expect(repository.publishQueueItem("queue-1")).rejects.toThrow("publish_queue_not_publishable");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("pq.status = 'scheduled'"), ["queue-1"]);
  });

  it("ensures and lists the three default Instagram formats for a brand created after migration", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("insert into brand_content_formats")) {
        return { rowCount: 3, rows: [] };
      }
      if (sql.includes("select bp.brand_color")) {
        return {
          rowCount: 3,
          rows: [
            {
              brand_id: "brand-1",
              brand_color: "#123456",
              format: "instagram_feed_carousel",
              enabled: true,
              rotation_order: 1,
              capability_status: "available",
              capability_checked_at: null,
              capability_metadata: {},
              last_error: null
            },
            {
              brand_id: "brand-1",
              brand_color: "#123456",
              format: "instagram_story",
              enabled: false,
              rotation_order: 2,
              capability_status: "unchecked",
              capability_checked_at: null,
              capability_metadata: {
                apiVersion: "v20.0",
                scopesVerified: false,
                accessToken: "secret-token",
                encryptedPayload: "ciphertext-secret",
                token: "plain-secret",
                secret: "another-secret",
                nested: { credential: "nested-secret" }
              },
              last_error: null
            },
            {
              brand_id: "brand-1",
              brand_color: "#123456",
              format: "instagram_reel",
              enabled: false,
              rotation_order: 3,
              capability_status: "unchecked",
              capability_checked_at: null,
              capability_metadata: {},
              last_error: null
            }
          ]
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createRepository({ query } as any) as any;

    const settings = await repository.listInstagramFormats("brand-1");

    expect(settings).toEqual({
      brandId: "brand-1",
      brandColor: "#123456",
      formats: [
        expect.objectContaining({ format: "instagram_feed_carousel", enabled: true, rotationOrder: 1, capabilityStatus: "available" }),
        expect.objectContaining({ format: "instagram_story", enabled: false, rotationOrder: 2, capabilityStatus: "unchecked" }),
        expect.objectContaining({ format: "instagram_reel", enabled: false, rotationOrder: 3, capabilityStatus: "unchecked" })
      ]
    });
    const defaultInsert = query.mock.calls.find(([sql]) => String(sql).includes("insert into brand_content_formats"));
    expect(defaultInsert?.[0]).toContain("'instagram_feed_carousel', true, 1, 'available'");
    expect(defaultInsert?.[0]).toContain("'instagram_story', false, 2, 'unchecked'");
    expect(defaultInsert?.[0]).toContain("'instagram_reel', false, 3, 'unchecked'");
    expect(defaultInsert?.[0]).toContain("on conflict (brand_id, format) do nothing");
    expect(JSON.stringify(settings)).not.toContain("secret");
    expect(settings.formats[1].capabilityMetadata).toEqual({
      apiVersion: "v20.0",
      scopesVerified: false
    });
  });

  it("uses the existing brand profile not-found behavior when Instagram settings have no brand", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("insert into brand_content_formats")) return { rowCount: 0, rows: [] };
      if (sql.includes("select bp.brand_color")) return { rowCount: 0, rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createRepository({ query } as any) as any;

    await expect(repository.listInstagramFormats("missing-brand")).rejects.toThrow("brand_profile_not_found");
  });

  it("rejects Story enablement transactionally without saving brand color", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into brand_content_formats")) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) {
        return { rowCount: 1, rows: [{ enabled: false, capability_status: "available", capability_metadata: { scopesVerified: true, storyPublishVerified: false, verifiedCredentialId: "credential-1" } }] };
      }
      if (sql.includes("from brand_channels") && sql.includes("for update")) {
        return { rowCount: 1, rows: [{ id: "channel-1", status: "connected", external_account_id: "account-1" }] };
      }
      if (sql.includes("from channel_credentials") && sql.includes("for update")) {
        return { rowCount: 1, rows: [{ id: "credential-1", status: "active", scopes: ["instagram_basic", "instagram_content_publish"], expires_at: null }] };
      }
      if (sql.includes("capability_status = $3")) return { rowCount: 1, rows: [] };
      if (sql.includes("select bp.brand_color") && sql.includes("for update")) {
        return {
          rowCount: 3,
          rows: [
            { brand_id: "brand-1", brand_color: null, format: "instagram_feed_carousel", enabled: true, rotation_order: 1, capability_status: "available", capability_checked_at: null, capability_metadata: {}, last_error: null },
            { brand_id: "brand-1", brand_color: null, format: "instagram_story", enabled: false, rotation_order: 2, capability_status: "available", capability_checked_at: null, capability_metadata: { storyPublishVerified: false }, last_error: null },
            { brand_id: "brand-1", brand_color: null, format: "instagram_reel", enabled: false, rotation_order: 3, capability_status: "unchecked", capability_checked_at: null, capability_metadata: {}, last_error: null }
          ]
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createRepository(fakePoolWithClient(query) as any) as any;

    await expect(repository.updateInstagramFormats("brand-1", {
      brandColor: "  #abcdef  ",
      formats: [{ format: "instagram_story", enabled: true }]
    })).rejects.toMatchObject({ code: "story_capability_required" });

    expect(queries.some(({ sql }) => sql.includes("update brand_profiles"))).toBe(false);
    const invalidation = queries.find(({ sql }) => sql.includes("capability_status = $3"));
    expect(invalidation?.values?.[2]).toBe("needs_attention");
    expect(invalidation?.values?.[4]).toBe("story_publish_verification_required");
    expect(queries.some(({ sql }) => sql.trim() === "commit")).toBe(true);
    expect(queries.some(({ sql }) => sql.trim() === "rollback")).toBe(false);
  });

  it("trims brand color, stores empty color as null, and preserves fixed rotation order", async () => {
    let selected = 0;
    const updatedValues: unknown[][] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (["begin", "commit"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into brand_content_formats")) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) return { rowCount: 1, rows: [{ enabled: false, capability_status: "available", capability_metadata: {} }] };
      if (sql.includes("from brand_channels") && sql.includes("for update")) return { rowCount: 0, rows: [] };
      if (sql.includes("update brand_profiles")) {
        updatedValues.push(values ?? []);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("update brand_content_formats")) {
        updatedValues.push(values ?? []);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("select bp.brand_color")) {
        selected += 1;
        const brandColor = selected === 1 ? "#old" : null;
        return {
          rowCount: 3,
          rows: [
            { brand_id: "brand-1", brand_color: brandColor, format: "instagram_feed_carousel", enabled: selected === 1, rotation_order: 1, capability_status: "available", capability_checked_at: null, capability_metadata: {}, last_error: null },
            { brand_id: "brand-1", brand_color: brandColor, format: "instagram_story", enabled: false, rotation_order: 2, capability_status: "available", capability_checked_at: null, capability_metadata: { storyPublishVerified: true }, last_error: null },
            { brand_id: "brand-1", brand_color: brandColor, format: "instagram_reel", enabled: false, rotation_order: 3, capability_status: "unchecked", capability_checked_at: null, capability_metadata: {}, last_error: null }
          ]
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createRepository(fakePoolWithClient(query) as any) as any;

    const settings = await repository.updateInstagramFormats("brand-1", {
      brandColor: "   ",
      formats: [
        { format: "instagram_feed_carousel", enabled: false },
        { format: "instagram_story", enabled: false },
        { format: "instagram_reel", enabled: false }
      ]
    });

    expect(updatedValues).toContainEqual(["brand-1", null]);
    expect(updatedValues).toContainEqual(["brand-1", "instagram_feed_carousel", false]);
    expect(updatedValues).toContainEqual(["brand-1", "instagram_story", false]);
    expect(updatedValues).toContainEqual(["brand-1", "instagram_reel", false]);
    expect(settings.brandColor).toBeNull();
    expect(settings.formats.map((format: any) => format.rotationOrder)).toEqual([1, 2, 3]);
    expect(settings.formats.every((format: any) => format.enabled === false)).toBe(true);
  });

  it("rejects an overlong brand color in the repository", async () => {
    const repository = createRepository(fakePoolWithClient(vi.fn()) as any) as any;

    await expect(repository.updateInstagramFormats("brand-1", { brandColor: "x".repeat(31) }))
      .rejects.toThrow("brand_color_too_long");
  });

  it("checks Story capability locally and persists only sanitized metadata", async () => {
    let persistedValues: unknown[] = [];
    const sqlStatements: string[] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      sqlStatements.push(sql);
      if (sql.includes("insert into brand_content_formats")) return { rowCount: 0, rows: [] };
      if (sql.trim() === "begin" || sql.trim() === "commit") return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) {
        return {
          rowCount: 1,
          rows: [{
            capability_metadata: {
              scopesVerified: true,
              storyPublishVerified: true,
              verifiedCredentialId: "credential-1",
              accessToken: "secret-token",
              encryptedPayload: "secret-ciphertext"
            }
          }]
        };
      }
      if (sql.includes("from brand_channels") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "channel-1", status: "connected", external_account_id: "17890000000000000" }] };
      if (sql.includes("from channel_credentials") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "credential-1", status: "active", scopes: ["instagram_basic", "instagram_content_publish"], expires_at: null }] };
      if (sql.includes("update brand_content_formats")) {
        persistedValues = values ?? [];
        return {
          rowCount: 1,
          rows: [{
            format: "instagram_story",
            enabled: false,
            rotation_order: 2,
            capability_status: "available",
            capability_checked_at: new Date("2026-07-13T01:00:00.000Z"),
            capability_metadata: JSON.parse(String(values?.[3])),
            last_error: null
          }]
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createRepository(fakePoolWithClient(query) as any) as any;

    const capability = await repository.checkInstagramCapability("brand-1", "instagram_story");

    expect(capability).toMatchObject({
      format: "instagram_story",
      capabilityStatus: "available",
      lastError: null,
      capabilityMetadata: {
        apiVersion: "v20.0",
        requiredScopes: ["instagram_basic", "instagram_content_publish"],
        presentScopes: ["instagram_basic", "instagram_content_publish"],
        missingScopes: [],
        professionalAccountPresent: true,
        credentialStatus: "active",
        storyPublishVerified: true,
        scopesVerified: true,
        verifiedCredentialId: "credential-1"
      }
    });
    expect(JSON.stringify(persistedValues)).not.toContain("secret");
    expect(sqlStatements.join("\n")).not.toContain("encrypted_payload");
  });

  it("requires Story verification even when every technical capability check passes", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("insert into brand_content_formats")) return { rowCount: 0, rows: [] };
      if (sql.trim() === "begin" || sql.trim() === "commit") return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) {
        return {
          rowCount: 1,
          rows: [{
            capability_metadata: { scopesVerified: true, storyPublishVerified: false, verifiedCredentialId: "credential-1" }
          }]
        };
      }
      if (sql.includes("from brand_channels") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "channel-1", status: "connected", external_account_id: "17890000000000000" }] };
      if (sql.includes("from channel_credentials") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "credential-1", status: "active", scopes: ["instagram_basic", "instagram_content_publish"], expires_at: null }] };
      if (sql.includes("update brand_content_formats")) {
        return {
          rowCount: 1,
          rows: [{
            format: "instagram_story",
            enabled: false,
            rotation_order: 2,
            capability_status: "needs_attention",
            capability_checked_at: new Date("2026-07-13T01:00:00.000Z"),
            capability_metadata: JSON.parse(String(values?.[3])),
            last_error: values?.[4]
          }]
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createRepository(fakePoolWithClient(query) as any) as any;

    const capability = await repository.checkInstagramCapability("brand-1", "instagram_story");

    expect(capability).toMatchObject({
      capabilityStatus: "needs_attention",
      lastError: "story_publish_verification_required",
      capabilityMetadata: { storyPublishVerified: false }
    });
  });

  it("rejects feed and Reel capability checks with a stable unsupported code", async () => {
    const repository = createRepository({ query: vi.fn() } as any) as any;

    await expect(repository.checkInstagramCapability("brand-1", "instagram_feed_carousel"))
      .rejects.toThrow("instagram_capability_check_not_supported");
    await expect(repository.checkInstagramCapability("brand-1", "instagram_reel"))
      .rejects.toThrow("instagram_capability_check_not_supported");
  });

  it("invalidates an enabled verified Story when Instagram credentials are replaced", async () => {
    const statements: Array<{ sql: string; values?: unknown[] }> = [];
    const clientQuery = vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values });
      if (["begin", "commit"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into brand_content_formats")) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) {
        return { rowCount: 1, rows: [{ enabled: true, capability_status: "available", capability_metadata: { scopesVerified: true, storyPublishVerified: true, verifiedCredentialId: "credential-old" } }] };
      }
      if (sql.includes("from brand_channels") && sql.includes("for update")) {
        return { rowCount: 1, rows: [{ id: "channel-1", workspace_id: "workspace-1", status: "connected", external_account_id: "account-1" }] };
      }
      if (sql.includes("from channel_credentials") && sql.includes("for update")) {
        return { rowCount: 1, rows: [{ id: "credential-old", status: "active", scopes: ["instagram_basic", "instagram_content_publish"], expires_at: null }] };
      }
      if (sql.includes("update channel_credentials")) return { rowCount: 1, rows: [] };
      if (sql.includes("insert into channel_credentials")) return { rowCount: 1, rows: [{ id: "credential-new" }] };
      if (sql.includes("update brand_channels")) return { rowCount: 1, rows: [] };
      if (sql.includes("update brand_content_formats")) return { rowCount: 1, rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const pool = {
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [{ channel: "instagram", status: "connected", account_label: "@brand", last_healthy_at: null, last_published_at: null, last_error: null }]
      }))
    };
    const repository = createRepository(pool as any);

    await repository.saveChannelCredentials("brand-1", "instagram", {
      secretValue: "replacement-token",
      accountLabel: "@brand",
      externalAccountId: "account-2",
      connectionStatus: "connected",
      scopes: ["instagram_basic", "instagram_content_publish"]
    });

    const storyLock = statements.findIndex(({ sql }) => sql.includes("from brand_content_formats") && sql.includes("for update"));
    const channelLock = statements.findIndex(({ sql }) => sql.includes("from brand_channels") && sql.includes("for update"));
    const credentialLock = statements.findIndex(({ sql }) => sql.includes("from channel_credentials") && sql.includes("for update"));
    expect(storyLock).toBeGreaterThan(-1);
    expect(channelLock).toBeGreaterThan(storyLock);
    expect(credentialLock).toBeGreaterThan(channelLock);
    const invalidation = statements.find(({ sql }) => sql.includes("update brand_content_formats"));
    expect(invalidation?.sql).toContain("enabled = false");
    expect(invalidation?.sql).toContain("capability_status = 'unchecked'");
    expect(invalidation?.sql).toContain("capability_checked_at = null");
    expect(invalidation?.values).toContain("credential_changed");
    expect(JSON.stringify(invalidation?.values)).not.toContain("credential-old");
  });

  it("invalidates an enabled verified Story when Instagram channel state is checked", async () => {
    const statements: Array<{ sql: string; values?: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values });
      if (["begin", "commit"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into brand_content_formats")) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) return { rowCount: 1, rows: [{ enabled: true, capability_metadata: { scopesVerified: true, storyPublishVerified: true, verifiedCredentialId: "credential-1" } }] };
      if (sql.includes("from brand_channels") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "channel-1", status: "needs_attention", external_account_id: "account-1" }] };
      if (sql.includes("from channel_credentials") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "credential-1", status: "active", scopes: ["instagram_basic", "instagram_content_publish"], expires_at: null }] };
      if (sql.includes("update brand_content_formats")) return { rowCount: 1, rows: [] };
      if (sql.includes("update brand_channels")) return { rowCount: 1, rows: [{ channel: "instagram", status: "connected", account_label: "@brand", last_healthy_at: new Date("2026-07-13T00:00:00.000Z"), last_published_at: null, last_error: null }] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    await repository.checkChannel("brand-1", "instagram");

    expect(statements[0].sql.trim()).toBe("begin");
    const invalidation = statements.find(({ sql }) => sql.includes("update brand_content_formats"));
    expect(invalidation?.sql).toContain("enabled = false");
    expect(invalidation?.values).toContain("channel_changed");
    expect(statements.at(-1)?.sql.trim()).toBe("commit");
  });

  it("locks current Story, channel, and credential rows before enabling Story", async () => {
    useTask3TestClock();
    const statements: string[] = [];
    let settingsRead = 0;
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (["begin", "commit"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into brand_content_formats")) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) return { rowCount: 1, rows: [{ enabled: false, capability_status: "available", capability_metadata: { scopesVerified: true, storyPublishVerified: true, verifiedCredentialId: "credential-1" } }] };
      if (sql.includes("from brand_channels") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "channel-1", status: "connected", external_account_id: "account-1" }] };
      if (sql.includes("from channel_credentials") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "credential-1", status: "active", scopes: ["instagram_basic", "instagram_content_publish"], expires_at: task3CredentialExpiry(1) }] };
      if (sql.includes("update brand_content_formats")) return { rowCount: 1, rows: [] };
      if (sql.includes("select bp.brand_color")) {
        settingsRead += 1;
        return { rowCount: 3, rows: [
          { brand_id: "brand-1", brand_color: null, format: "instagram_feed_carousel", enabled: true, rotation_order: 1, capability_status: "available", capability_checked_at: null, capability_metadata: {}, last_error: null },
          { brand_id: "brand-1", brand_color: null, format: "instagram_story", enabled: settingsRead > 1, rotation_order: 2, capability_status: "available", capability_checked_at: null, capability_metadata: { scopesVerified: true, storyPublishVerified: true, verifiedCredentialId: "credential-1" }, last_error: null },
          { brand_id: "brand-1", brand_color: null, format: "instagram_reel", enabled: false, rotation_order: 3, capability_status: "unchecked", capability_checked_at: null, capability_metadata: {}, last_error: null }
        ] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    const result = await repository.updateInstagramFormats("brand-1", {
      formats: [{ format: "instagram_story", enabled: true }]
    });

    const storyLock = statements.findIndex((sql) => sql.includes("from brand_content_formats") && sql.includes("for update"));
    const channelLock = statements.findIndex((sql) => sql.includes("from brand_channels") && sql.includes("for update"));
    const credentialLock = statements.findIndex((sql) => sql.includes("from channel_credentials") && sql.includes("for update"));
    const storyUpdate = statements.findIndex((sql) => sql.includes("update brand_content_formats") && sql.includes("set enabled = $3"));
    expect([storyLock, channelLock, credentialLock].every((index) => index >= 0)).toBe(true);
    expect(storyLock).toBeLessThan(channelLock);
    expect(channelLock).toBeLessThan(credentialLock);
    expect(credentialLock).toBeLessThan(storyUpdate);
    expect(statements.join("\n")).not.toContain("encrypted_payload");
    expect(result.formats.find((format) => format.format === "instagram_story")?.enabled).toBe(true);
  });

  it("commits Story invalidation but not requested settings when the current credential is expired", async () => {
    useTask3TestClock();
    const statements: string[] = [];
    let brandColor = "#old-color";
    let reelEnabled = false;
    const story = {
      enabled: true,
      capabilityStatus: "available",
      capabilityMetadata: { scopesVerified: true, storyPublishVerified: true, verifiedCredentialId: "credential-1" } as Record<string, unknown>,
      lastError: null as string | null
    };
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push(sql);
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into brand_content_formats")) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) return { rowCount: 1, rows: [{ enabled: story.enabled, capability_status: story.capabilityStatus, capability_metadata: story.capabilityMetadata }] };
      if (sql.includes("from brand_channels") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "channel-1", status: "connected", external_account_id: "account-1" }] };
      if (sql.includes("from channel_credentials") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "credential-1", status: "active", scopes: ["instagram_basic", "instagram_content_publish"], expires_at: task3CredentialExpiry(-1) }] };
      if (sql.includes("capability_status = $3")) {
        story.enabled = values?.[2] === "available" ? story.enabled : false;
        story.capabilityStatus = String(values?.[2]);
        story.capabilityMetadata = JSON.parse(String(values?.[3]));
        story.lastError = String(values?.[4]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("update brand_profiles")) {
        brandColor = String(values?.[1]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("set enabled = $3") && values?.[1] === "instagram_reel") {
        reelEnabled = Boolean(values?.[2]);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    await expect(repository.updateInstagramFormats("brand-1", {
      brandColor: "#new-color",
      formats: [
        { format: "instagram_story", enabled: true },
        { format: "instagram_reel", enabled: true }
      ]
    })).rejects.toMatchObject({ code: "story_capability_required" });

    expect(story).toEqual({
      enabled: false,
      capabilityStatus: "needs_attention",
      capabilityMetadata: expect.objectContaining({
        credentialStatus: "expired",
        scopesVerified: false,
        storyPublishVerified: false,
        verifiedCredentialId: null
      }),
      lastError: "credential_expired"
    });
    expect(brandColor).toBe("#old-color");
    expect(reelEnabled).toBe(false);
    expect(statements.at(-1)?.trim()).toBe("commit");
    expect(statements).not.toContain("rollback");
  });

  it("checks capability transactionally and disables Story when verification is stale", async () => {
    const statements: Array<{ sql: string; values?: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values });
      if (["begin", "commit"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into brand_content_formats")) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) return { rowCount: 1, rows: [{ enabled: true, capability_metadata: { scopesVerified: true, storyPublishVerified: true, verifiedCredentialId: "credential-old" } }] };
      if (sql.includes("from brand_channels") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "channel-1", status: "connected", external_account_id: "account-1" }] };
      if (sql.includes("from channel_credentials") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "credential-new", status: "active", scopes: ["instagram_basic", "instagram_content_publish"], expires_at: null }] };
      if (sql.includes("update brand_content_formats")) return { rowCount: 1, rows: [{ format: "instagram_story", enabled: false, rotation_order: 2, capability_status: "needs_attention", capability_checked_at: new Date("2026-07-13T00:00:00.000Z"), capability_metadata: JSON.parse(String(values?.[3])), last_error: values?.[4] }] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    const result = await repository.checkInstagramCapability("brand-1", "instagram_story");

    expect(statements[0].sql.trim()).toBe("begin");
    const persistence = statements.find(({ sql }) => sql.includes("update brand_content_formats"));
    expect(persistence?.sql).toContain("enabled = case");
    expect(result).toMatchObject({ enabled: false, capabilityStatus: "needs_attention", lastError: "verified_credential_mismatch" });
    expect(statements.at(-1)?.sql.trim()).toBe("commit");
  });

  it("disables Story when an invalidating check runs after a successful enable", async () => {
    let credentialId = "credential-1";
    let storyEnabled = false;
    let phase: "update" | "check" = "update";
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (["begin", "commit"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into brand_content_formats")) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) return { rowCount: 1, rows: [{ enabled: storyEnabled, capability_status: "available", capability_metadata: { scopesVerified: true, storyPublishVerified: true, verifiedCredentialId: "credential-1" } }] };
      if (sql.includes("from brand_channels") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "channel-1", status: "connected", external_account_id: "account-1" }] };
      if (sql.includes("from channel_credentials") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: credentialId, status: "active", scopes: ["instagram_basic", "instagram_content_publish"], expires_at: null }] };
      if (sql.includes("set enabled = $3")) {
        storyEnabled = Boolean(values?.[2]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("capability_status = $3")) {
        storyEnabled = values?.[2] === "available" ? storyEnabled : false;
        return { rowCount: 1, rows: [{ format: "instagram_story", enabled: storyEnabled, rotation_order: 2, capability_status: values?.[2], capability_checked_at: new Date(), capability_metadata: JSON.parse(String(values?.[3])), last_error: values?.[4] }] };
      }
      if (sql.includes("select bp.brand_color")) return { rowCount: 3, rows: [
        { brand_id: "brand-1", brand_color: null, format: "instagram_feed_carousel", enabled: true, rotation_order: 1, capability_status: "available", capability_checked_at: null, capability_metadata: {}, last_error: null },
        { brand_id: "brand-1", brand_color: null, format: "instagram_story", enabled: storyEnabled, rotation_order: 2, capability_status: "available", capability_checked_at: null, capability_metadata: { scopesVerified: true, storyPublishVerified: true, verifiedCredentialId: "credential-1" }, last_error: null },
        { brand_id: "brand-1", brand_color: null, format: "instagram_reel", enabled: false, rotation_order: 3, capability_status: "unchecked", capability_checked_at: null, capability_metadata: {}, last_error: null }
      ] };
      throw new Error(`unexpected ${phase} query: ${sql}`);
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    await repository.updateInstagramFormats("brand-1", { formats: [{ format: "instagram_story", enabled: true }] });
    expect(storyEnabled).toBe(true);
    credentialId = "credential-2";
    phase = "check";
    const checked = await repository.checkInstagramCapability("brand-1", "instagram_story");

    expect(checked.enabled).toBe(false);
    expect(storyEnabled).toBe(false);
  });

  it("rejects Story enablement when an invalidating check completes first", async () => {
    let storyStatus = "available";
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into brand_content_formats")) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) return { rowCount: 1, rows: [{ enabled: false, capability_status: storyStatus, capability_metadata: { scopesVerified: true, storyPublishVerified: true, verifiedCredentialId: "credential-old" } }] };
      if (sql.includes("from brand_channels") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "channel-1", status: "connected", external_account_id: "account-1" }] };
      if (sql.includes("from channel_credentials") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "credential-new", status: "active", scopes: ["instagram_basic", "instagram_content_publish"], expires_at: null }] };
      if (sql.includes("capability_status = $3")) {
        storyStatus = String(values?.[2]);
        return { rowCount: 1, rows: [{ format: "instagram_story", enabled: false, rotation_order: 2, capability_status: storyStatus, capability_checked_at: new Date(), capability_metadata: JSON.parse(String(values?.[3])), last_error: values?.[4] }] };
      }
      if (sql.includes("select bp.brand_color")) return { rowCount: 3, rows: [
        { brand_id: "brand-1", brand_color: null, format: "instagram_feed_carousel", enabled: true, rotation_order: 1, capability_status: "available", capability_checked_at: null, capability_metadata: {}, last_error: null },
        { brand_id: "brand-1", brand_color: null, format: "instagram_story", enabled: false, rotation_order: 2, capability_status: storyStatus, capability_checked_at: null, capability_metadata: { scopesVerified: false, storyPublishVerified: false, verifiedCredentialId: null }, last_error: "verified_credential_mismatch" },
        { brand_id: "brand-1", brand_color: null, format: "instagram_reel", enabled: false, rotation_order: 3, capability_status: "unchecked", capability_checked_at: null, capability_metadata: {}, last_error: null }
      ] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    await repository.checkInstagramCapability("brand-1", "instagram_story");
    await expect(repository.updateInstagramFormats("brand-1", {
      formats: [{ format: "instagram_story", enabled: true }]
    })).rejects.toMatchObject({ code: "story_capability_required" });
  });

  it.each([
    {
      name: "professional account ID is missing",
      externalAccountId: "   ",
      credential: { id: "credential-1", status: "active", expires_at: task3CredentialExpiry(1) },
      expectedStatus: "needs_attention",
      expectedError: "professional_account_required"
    },
    {
      name: "credential is missing",
      externalAccountId: "account-1",
      credential: null,
      expectedStatus: "needs_attention",
      expectedError: "credential_missing"
    },
    {
      name: "credential status is invalid",
      externalAccountId: "account-1",
      credential: { id: "credential-1", status: "invalid", expires_at: null },
      expectedStatus: "needs_attention",
      expectedError: "credential_invalid"
    },
    {
      name: "credential is expired",
      externalAccountId: "account-1",
      credential: { id: "credential-1", status: "active", expires_at: task3CredentialExpiry(-1) },
      expectedStatus: "expired",
      expectedError: "credential_expired"
    },
    {
      name: "local structural state is valid",
      externalAccountId: "account-1",
      credential: { id: "credential-1", status: "active", expires_at: task3CredentialExpiry(1) },
      expectedStatus: "connected",
      expectedError: null
    }
  ])("checks Instagram channel locally when $name", async ({ externalAccountId, credential, expectedStatus, expectedError }) => {
    useTask3TestClock();
    const statements: Array<{ sql: string; values?: unknown[] }> = [];
    const previousHealthyAt = new Date("2026-07-01T00:00:00.000Z");
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values });
      if (["begin", "commit"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into brand_content_formats")) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) return { rowCount: 1, rows: [{ enabled: true, capability_status: "available", capability_metadata: { scopesVerified: true, storyPublishVerified: true, verifiedCredentialId: "credential-1" } }] };
      if (sql.includes("from brand_channels") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "channel-1", status: "needs_attention", external_account_id: externalAccountId }] };
      if (sql.includes("from channel_credentials") && sql.includes("for update")) return credential ? { rowCount: 1, rows: [credential] } : { rowCount: 0, rows: [] };
      if (sql.includes("update brand_content_formats")) return { rowCount: 1, rows: [] };
      if (sql.includes("update brand_channels")) return {
        rowCount: 1,
        rows: [{
          channel: "instagram",
          status: values?.[2],
          account_label: "@brand",
          last_healthy_at: previousHealthyAt,
          last_published_at: null,
          last_error: values?.[3]
        }]
      };
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    const result = await repository.checkChannel("brand-1", "instagram");

    expect(result).toMatchObject({
      channel: "instagram",
      status: expectedStatus,
      lastError: expectedError,
      lastHealthyAt: previousHealthyAt.toISOString()
    });
    const storyLock = statements.findIndex(({ sql }) => sql.includes("from brand_content_formats") && sql.includes("for update"));
    const channelLock = statements.findIndex(({ sql }) => sql.includes("from brand_channels") && sql.includes("for update"));
    const credentialLock = statements.findIndex(({ sql }) => sql.includes("from channel_credentials") && sql.includes("for update"));
    expect(storyLock).toBeLessThan(channelLock);
    expect(channelLock).toBeLessThan(credentialLock);
    const channelUpdate = statements.find(({ sql }) => sql.includes("update brand_channels"));
    expect(channelUpdate?.sql).not.toContain("last_healthy_at = now()");
    expect(statements.some(({ sql }) => sql.includes("update brand_content_formats") && sql.includes("enabled = false"))).toBe(true);
    expect(statements.map(({ sql }) => sql).join("\n")).not.toContain("encrypted_payload");
  });

  it("commits Story invalidation without unrelated writes for an explicitly invalid credential", async () => {
    const statements: string[] = [];
    let storyEnabled = true;
    let storyStatus = "available";
    let storyMetadata: Record<string, unknown> = { scopesVerified: true, storyPublishVerified: true, verifiedCredentialId: "credential-1" };
    let lastError: string | null = null;
    let brandColor = "#old-color";
    let reelEnabled = false;
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push(sql);
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into brand_content_formats")) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) return { rowCount: 1, rows: [{ enabled: storyEnabled, capability_status: storyStatus, capability_metadata: storyMetadata }] };
      if (sql.includes("from brand_channels") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "channel-1", status: "connected", external_account_id: "account-1" }] };
      if (sql.includes("from channel_credentials") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "credential-1", status: "invalid", scopes: ["instagram_basic", "instagram_content_publish"], expires_at: null }] };
      if (sql.includes("capability_status = $3")) {
        storyEnabled = false;
        storyStatus = String(values?.[2]);
        storyMetadata = JSON.parse(String(values?.[3]));
        lastError = String(values?.[4]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("update brand_profiles")) {
        brandColor = String(values?.[1]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("set enabled = $3") && values?.[1] === "instagram_reel") {
        reelEnabled = Boolean(values?.[2]);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    await expect(repository.updateInstagramFormats("brand-1", {
      brandColor: "#new-color",
      formats: [
        { format: "instagram_story", enabled: true },
        { format: "instagram_reel", enabled: true }
      ]
    })).rejects.toMatchObject({ code: "story_capability_required" });

    expect({ storyEnabled, storyStatus, lastError }).toEqual({ storyEnabled: false, storyStatus: "needs_attention", lastError: "credential_invalid" });
    expect(storyMetadata).toMatchObject({ scopesVerified: false, storyPublishVerified: false, verifiedCredentialId: null });
    expect(brandColor).toBe("#old-color");
    expect(reelEnabled).toBe(false);
    expect(statements.at(-1)?.trim()).toBe("commit");
    expect(statements).not.toContain("rollback");
  });

  it.each(["invalidation", "commit"] as const)("rolls back and preserves the database error when Story security %s fails", async (failurePoint) => {
    const statements: string[] = [];
    const databaseError = new Error(`database_${failurePoint}_failed`);
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.trim() === "begin" || sql.trim() === "rollback") return { rowCount: 0, rows: [] };
      if (sql.trim() === "commit") {
        if (failurePoint === "commit") throw databaseError;
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("insert into brand_content_formats")) return { rowCount: 0, rows: [] };
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) return { rowCount: 1, rows: [{ enabled: true, capability_status: "available", capability_metadata: { scopesVerified: true, storyPublishVerified: true, verifiedCredentialId: "credential-1" } }] };
      if (sql.includes("from brand_channels") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "channel-1", status: "connected", external_account_id: "account-1" }] };
      if (sql.includes("from channel_credentials") && sql.includes("for update")) return { rowCount: 1, rows: [{ id: "credential-1", status: "invalid", scopes: ["instagram_basic", "instagram_content_publish"], expires_at: null }] };
      if (sql.includes("capability_status = $3")) {
        if (failurePoint === "invalidation") throw databaseError;
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    await expect(repository.updateInstagramFormats("brand-1", {
      formats: [{ format: "instagram_story", enabled: true }]
    })).rejects.toBe(databaseError);

    expect(statements.at(-1)?.trim()).toBe("rollback");
  });
});
