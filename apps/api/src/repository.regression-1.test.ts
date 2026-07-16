import { describe, expect, it, vi } from "vitest";
import { encryptCredential } from "./credentialCrypto";
import { MetaGraphRequestError } from "./metaGraph";
import { createRepository } from "./repository";

function fakePoolWithClient(query: ReturnType<typeof vi.fn>) {
  return {
    query,
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  };
}

function connectedInstagram() {
  return { rowCount: 1, rows: [{ channel: "instagram" }] };
}

describe("repository regressions", () => {
  it("counts only active review lifecycle outputs in the sidebar", async () => {
    let statusQuery = "";
    const query = vi.fn(async (sql: string) => {
      statusQuery = sql;
      return {
        rowCount: 1,
        rows: [{
          brand_id: "brand-1",
          brand_name: "Brand",
          auto_approval_enabled: false,
          owned_source_count: "0",
          reference_source_count: "0",
          topic_row_count: "0",
          instagram_status: "not_connected",
          threads_status: "not_connected",
          content_output_count: "0",
          content_review_count: "0",
          publish_issue_count: "0",
          channel_issue_count: "3",
          last_generated_at: null
        }]
      };
    });
    const repository = createRepository({ query } as any);

    await repository.getBrandUiStatus("brand-1");

    expect(statusQuery).toContain("co.status <> 'regenerated'");
    expect(statusQuery).toContain("co.status in ('pending_review', 'auto_approval_blocked', 'generation_failed')");
    expect(statusQuery.match(/content_review_count/)?.[0]).toBe("content_review_count");
  });

  it("counts channel issues across exactly the six runtime channels", async () => {
    let statusQuery = "";
    const query = vi.fn(async (sql: string) => {
      statusQuery = sql;
      return {
        rowCount: 1,
        rows: [{
          brand_id: "brand-1",
          brand_name: "Brand",
          auto_approval_enabled: false,
          owned_source_count: "0",
          reference_source_count: "0",
          topic_row_count: "0",
          instagram_status: "not_connected",
          threads_status: "not_connected",
          content_output_count: "0",
          content_review_count: "0",
          publish_issue_count: "0",
          channel_issue_count: "0",
          last_generated_at: null
        }]
      };
    });
    const repository = createRepository({ query } as any);

    await repository.getBrandUiStatus("brand-1");

    expect(statusQuery).toContain(
      "bc.channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok')"
    );
  });

  it("counts generating and review dashboard states by the API lifecycle", async () => {
    let workflowQuery = "";
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("dashboard_workflow")) {
        workflowQuery = sql;
        return {
          rowCount: 1,
          rows: [{
            queued_topics: "0",
            generating: "0",
            pending_review: "0",
            scheduled_or_published: "0",
            pending_review_count: "0",
            failed_publish_count: "0"
          }]
        };
      }
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query } as any);

    await repository.getDashboard("brand-1");

    expect(workflowQuery).toContain("status in ('generating', 'regenerating')) as generating");
    expect(workflowQuery).toContain("status in ('pending_review', 'auto_approval_blocked', 'generation_failed')) as pending_review");
    expect(workflowQuery).toContain("status in ('pending_review', 'auto_approval_blocked', 'generation_failed')) as pending_review_count");
    expect(workflowQuery).not.toContain("'regenerated'");
  });

  it("limits scheduled or published dashboard workflow counts to the recent 30-day window", async () => {
    let workflowQuery = "";
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("dashboard_workflow")) {
        workflowQuery = sql;
        return { rowCount: 1, rows: [{}] };
      }
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query } as any);

    await repository.getDashboard("brand-1");

    expect(workflowQuery).toContain("coalesce(published_at, scheduled_for, updated_at) >= (($2::date - interval '29 days')::timestamp at time zone 'Asia/Seoul')");
    expect(workflowQuery).toContain("coalesce(published_at, scheduled_for, updated_at) < (($2::date + interval '1 day')::timestamp at time zone 'Asia/Seoul')");
  });

  it("maps dashboard attention diagnostics to fixed customer-safe messages", async () => {
    const rawDiagnostic = "provider token=secret-value upstream stack trace";
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("dashboard_workflow")) return { rowCount: 1, rows: [{}] };
      if (sql.includes("dashboard_attention")) {
        return {
          rowCount: 4,
          rows: [
            { type: "publish_failed", channel: "instagram", message: rawDiagnostic },
            { type: "channel_error", channel: "threads", message: rawDiagnostic },
            { type: "sync_failed", channel: "linkedin", message: rawDiagnostic },
            { type: "stale_sync", channel: "youtube", message: rawDiagnostic }
          ]
        };
      }
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({ query } as any);

    const dashboard = await repository.getDashboard("brand-1");

    expect(dashboard.attentionItems).toEqual([
      { type: "publish_failed", channel: "instagram", message: "게시 처리에 실패했습니다. 채널 연결과 게시 설정을 확인해 주세요." },
      { type: "channel_error", channel: "threads", message: "채널 연결 상태를 확인해 주세요." },
      { type: "sync_failed", channel: "linkedin", message: "채널 성과 일부를 수집하지 못했습니다." },
      { type: "stale_sync", channel: "youtube", message: "채널 성과 수집 상태를 확인해 주세요." }
    ]);
    expect(JSON.stringify(dashboard)).not.toContain(rawDiagnostic);
  });

  it("regenerates Threads through a replacement output and text render job", async () => {
    const statements: Array<{ sql: string; values?: unknown[] }> = [];
    const outputRow = {
      id: "output-threads-old",
      status: "regenerating",
      workspace_id: "workspace-1",
      brand_id: "brand-1",
      content_topic_id: "topic-1",
      master_draft_id: "draft-1",
      channel: "threads",
      delivery_format: "threads_text",
      title: "Threads title",
      output_json: { deliveryFormat: "threads_text", representativeUrl: "https://brand.example/source" },
      source_summary: "Brand source",
      rendered_artifact_id: null,
      brand_channel_id: "brand-channel-threads",
      topic_publish_group_id: "group-1",
      brand_name: "Brand",
      category_code: "business",
      category_name: "Business",
      subcategories: [],
      primary_customer: "Operators",
      description: "Brand description",
      tone: "Professional",
      brand_color: "#112233",
      draft_json: {},
      topic_title: "Topic title",
      topic_angle: "Topic angle",
      target_customer: "Operators",
      region: null,
      season: null,
      reference_url: "https://reference.example/post",
      notes: "Keep concise",
      crawl_content_url: "https://brand.example/source"
    };
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values });
      if (sql.trim() === "begin" || sql.trim() === "commit" || sql.trim() === "rollback") return { rowCount: 0, rows: [] };
      if (sql.includes("select channel from channel_outputs")) return { rowCount: 1, rows: [{ channel: "threads" }] };
      if (sql.trimStart().startsWith("with updated as")) return { rowCount: 1, rows: [outputRow] };
      if (sql.includes("update topic_publish_groups")) return { rowCount: 1, rows: [{ id: "group-1" }] };
      if (sql.includes("insert into channel_outputs")) return { rowCount: 1, rows: [{ id: "output-threads-new" }] };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    const result = await repository.reviewContentOutput("output-threads-old", "regenerate", "Try again");

    expect(result).toEqual({ id: "output-threads-new", status: "generating" });
    expect(statements.some(({ sql }) => sql.includes("set status = 'regenerated'"))).toBe(true);
    expect(statements.find(({ sql }) => sql.includes("update topic_publish_groups"))?.sql).toContain("status <> 'publishing'");
    const replacement = statements.find(({ sql }) => sql.includes("insert into channel_outputs"));
    expect(replacement?.values?.[4]).toBe("threads");
    expect(replacement?.values?.[5]).toBe("threads_text");
    expect(JSON.parse(String(replacement?.values?.[9]))).toMatchObject({
      deliveryFormat: "threads_text",
      artifactKind: "text",
      generationState: "pending"
    });
    const job = statements.find(({ sql }) => sql.includes("threads_text_render"));
    expect(job?.values?.[3]).toBe("output-threads-new");
    expect(JSON.parse(String(job?.values?.[4]))).toMatchObject({ topic: { title: "Topic title", angle: "Topic angle" } });
  });

  it("rejects unsupported regeneration before mutating output state or writing an event", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes("select channel from channel_outputs")) return { rowCount: 1, rows: [{ channel: "x" }] };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    await expect(repository.reviewContentOutput("output-x", "regenerate"))
      .rejects.toThrow("content_output_regeneration_not_supported");

    expect(statements.some((sql) => sql.trimStart().startsWith("with updated as"))).toBe(false);
    expect(statements.some((sql) => sql.includes("insert into review_events"))).toBe(false);
    expect(statements.some((sql) => sql.includes("set status = 'regenerated'"))).toBe(false);
  });

  it("normalizes nullable profile text fields for the customer form contract", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        profile_id: "profile-1",
        brand_id: "brand-1",
        brand_name: "Brand",
        category_code: "business_professional",
        category_name: "비즈니스·전문 서비스",
        subcategories: [
          { type: "system", code: "marketing_consulting", name: "마케팅 컨설팅", createdAt: "2026-01-01" },
          { type: "custom", code: null, name: "세일즈 메시지 설계", createdAt: "2026-01-02" }
        ],
        primary_customer: null,
        description: null,
        tone: null,
        default_cta: null,
        main_link: null,
        auto_approval_enabled: false
      }]
    }));
    const repository = createRepository({ query } as any);

    await expect(repository.getBrandProfile("brand-1")).resolves.toMatchObject({
      primaryCategory: { code: "business_professional", name: "비즈니스·전문 서비스" },
      subcategories: [
        { type: "system", code: "marketing_consulting", name: "마케팅 컨설팅" },
        { type: "custom", code: null, name: "세일즈 메시지 설계" }
      ],
      primaryCustomer: "",
      description: "",
      tone: "",
      defaultCta: "",
      mainLink: ""
    });
  });

  it("does not block Instagram automation on optional source types and channels", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        brand_id: "brand-1",
        brand_name: "Brand",
        primary_category_id: "category-1",
        primary_customer: "가족 여행자",
        description: "여행 상담",
        tone: "전문가",
        auto_approval_enabled: true,
        owned_source_count: "0",
        reference_source_count: "1",
        topic_row_count: "0",
        instagram_status: "connected",
        threads_status: "not_connected",
        content_output_count: "0",
        content_review_count: "0",
        publish_issue_count: "0",
        channel_issue_count: "2",
        last_generated_at: null
      }]
    }));
    const repository = createRepository({ query } as any);

    const status = await repository.getBrandUiStatus("brand-1");

    expect(status.onboarding.remainingCount).toBe(0);
    expect(status.onboarding.steps.find((step) => step.id === "owned-url")?.status).toBe("pending");
    expect(status.onboarding.steps.find((step) => step.id === "threads")?.status).toBe("pending");
  });

  it("treats generation criteria as optional for brand profile onboarding completion", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        brand_id: "brand-1",
        brand_name: "Brand",
        primary_category_id: "category-1",
        primary_customer: "가족 여행자",
        description: "여행 상담",
        tone: null,
        auto_approval_enabled: true,
        owned_source_count: "0",
        reference_source_count: "0",
        topic_row_count: "0",
        instagram_status: "not_connected",
        threads_status: "not_connected",
        content_output_count: "0",
        content_review_count: "0",
        publish_issue_count: "0",
        channel_issue_count: "0",
        last_generated_at: null
      }]
    }));
    const repository = createRepository({ query } as any);

    const status = await repository.getBrandUiStatus("brand-1");

    expect(status.onboarding.steps.find((step) => step.id === "brand-profile")?.status).toBe("completed");
  });

  it("keeps Instagram generating until the image worker artifact exists", async () => {
    const outputStatuses: string[] = [];
    const queueInserts: unknown[][] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.trim() === "begin" || sql.trim() === "commit" || sql.trim() === "rollback") {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("from brands b") && sql.includes("join brand_profiles")) {
        return {
          rowCount: 1,
          rows: [{
            workspace_id: "workspace-1",
            brand_name: "Brand",
            auto_approval_enabled: true,
            default_cta: null
          }]
        };
      }
      if (sql.includes("from brand_channels") && sql.includes("enabled = true")) {
        return connectedInstagram();
      }
      if (sql.includes("from brand_content_formats") && sql.includes("for update")) {
        return { rowCount: 1, rows: [{ format: "instagram_feed_carousel" }] };
      }
      if (sql.includes("from brand_format_rotation_states") && sql.includes("for update")) {
        return { rowCount: 1, rows: [{ last_selected_format: null }] };
      }
      if (sql.includes("count(*)") && sql.includes("from content_topics")) {
        return { rowCount: 1, rows: [{ topic_count: "0" }] };
      }
      if (sql.includes("from content_topics ct") && sql.includes("for update")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("from topic_rows") && sql.includes("for update skip locked")) {
        return {
          rowCount: 1,
          rows: [{
            id: "topic-row-1",
            topic_title: "여행 준비",
            topic_angle: "체크리스트",
            target_customer: "가족 여행자"
          }]
        };
      }
      if (sql.includes("insert into content_topics")) {
        return { rowCount: 1, rows: [{ id: "content-topic-1" }] };
      }
      if (sql.includes("insert into topic_publish_groups")) {
        return { rowCount: 1, rows: [{ id: "publish-group-1" }] };
      }
      if (sql.includes("insert into master_drafts")) {
        return { rowCount: 1, rows: [{ id: "master-draft-1" }] };
      }
      if (sql.includes("insert into llm_runs")) {
        return { rowCount: 1, rows: [{ id: "llm-run-1" }] };
      }
      if (sql.includes("insert into channel_outputs")) {
        outputStatuses.push(String(values?.[6]));
        return { rowCount: 1, rows: [{ id: "output-instagram" }] };
      }
      if (sql.includes("select id from brand_channels")) {
        return { rowCount: 1, rows: [{ id: "channel-instagram" }] };
      }
      if (sql.includes("insert into publish_queue")) {
        queueInserts.push(values ?? []);
        return { rowCount: 1, rows: [{ id: "queue-instagram" }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePoolWithClient(query) as any);

    await repository.generateContent("brand-1");

    expect(outputStatuses).toEqual(["generating"]);
    expect(queueInserts).toHaveLength(0);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("insert into jobs"),
      expect.arrayContaining(["instagram_feed_render"])
    );
  });

  it("dispatches repository publication by the channel output delivery format and manifest", async () => {
    const publishInstagramOutput = vi.fn(async () => ({ externalPostId: "reel-post", publishedUrl: null }));
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from publish_queue pq") && sql.includes("join channel_outputs")) {
        return { rowCount: 1, rows: [{
          id: "queue-1",
          workspace_id: "workspace-1",
          brand_id: "brand-1",
          channel: "instagram",
          channel_output_id: "output-1",
          delivery_format: "instagram_reel",
          output_json: { caption: "Reel caption", hashtags: ["#brand"] },
          rendered_manifest_url: "https://cdn.example.com/manifest.json",
          external_account_id: "account-1",
          encrypted_payload: encryptCredential("meta-token"),
          credential_id: "credential-1",
          attempt_id: "attempt-1"
        }] };
      }
      if (sql.includes("set status = 'published'")) {
        return { rowCount: 1, rows: [{ id: "queue-1", status: "published" }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({ query } as any, {
      instagramPublish: { enabled: true },
      fetchInstagramImageManifest: async () => ({
        deliveryFormat: "instagram_reel",
        video: { url: "https://cdn.example.com/reel.mp4" }
      }),
      publishInstagramOutput
    } as any);

    await repository.publishQueueItem("queue-1");

    expect(String(query.mock.calls[0]?.[0])).toContain("co.delivery_format");
    expect(publishInstagramOutput).toHaveBeenCalledWith(expect.objectContaining({
      deliveryFormat: "instagram_reel",
      videoUrl: "https://cdn.example.com/reel.mp4",
      caption: "Reel caption\n\n#brand"
    }));
  });

  it("stores transient classification and reschedules only 429 or 5xx failures", async () => {
    const failureUpdates: Array<{ sql: string; values?: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("from publish_queue pq") && sql.includes("join channel_outputs")) {
        return { rowCount: 1, rows: [{
          id: "queue-1",
          workspace_id: "workspace-1",
          brand_id: "brand-1",
          channel: "instagram",
          channel_output_id: "output-1",
          delivery_format: "instagram_reel",
          output_json: {},
          rendered_manifest_url: "https://cdn.example.com/manifest.json",
          external_account_id: "account-1",
          encrypted_payload: encryptCredential("meta-token"),
          credential_id: "credential-1",
          attempt_id: "attempt-1"
        }] };
      }
      if (sql.includes("failed_attempt")) failureUpdates.push({ sql, values });
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({ query } as any, {
      instagramPublish: { enabled: true },
      fetchInstagramImageManifest: async () => ({ video: { url: "https://cdn.example.com/reel.mp4" } }),
      publishInstagramOutput: async () => { throw new MetaGraphRequestError({ status: 429 }); }
    } as any);

    await expect(repository.publishQueueItem("queue-1")).rejects.toThrow("meta_graph_request_failed:429");

    expect(failureUpdates[0]?.sql).toContain("error_code = $3");
    expect(failureUpdates[0]?.sql).toContain("then 'scheduled'");
    expect(failureUpdates[0]?.values).toEqual(expect.arrayContaining(["meta_rate_limited", true]));
  });

  it("marks the brand channel needs_attention for token failures without leaking provider details", async () => {
    const statements: Array<{ sql: string; values?: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values });
      if (sql.includes("from publish_queue pq") && sql.includes("join channel_outputs")) {
        return { rowCount: 1, rows: [{
          id: "queue-1",
          workspace_id: "workspace-1",
          brand_id: "brand-1",
          channel: "instagram",
          channel_output_id: "output-1",
          delivery_format: "instagram_reel",
          output_json: {},
          rendered_manifest_url: "https://cdn.example.com/manifest.json",
          external_account_id: "account-1",
          encrypted_payload: encryptCredential("meta-token"),
          credential_id: "credential-1",
          attempt_id: "attempt-1"
        }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({ query } as any, {
      instagramPublish: { enabled: true },
      fetchInstagramImageManifest: async () => ({ video: { url: "https://cdn.example.com/reel.mp4" } }),
      publishInstagramOutput: async () => { throw new MetaGraphRequestError({ status: 400, code: 190 }); }
    } as any);

    await expect(repository.publishQueueItem("queue-1")).rejects.toThrow("meta_graph_request_failed:400");

    const channelUpdate = statements.find(({ sql }) => sql.includes("update brand_channels") && sql.includes("needs_attention"));
    expect(channelUpdate?.values).toEqual(expect.arrayContaining(["meta_token_invalid"]));
    expect(JSON.stringify(statements)).not.toContain("meta-token");
  });
});
