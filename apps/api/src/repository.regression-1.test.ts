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
  it("counts regenerating outputs as content requiring review", async () => {
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

    expect(statusQuery).toContain("'regenerating'");
    expect(statusQuery).not.toContain("'regenerated'");
  });

  it("normalizes nullable profile text fields for the customer form contract", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        profile_id: "profile-1",
        brand_id: "brand-1",
        brand_name: "Brand",
        industry: null,
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
      industry: "",
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
        industry: "여행",
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
        industry: "여행",
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

  it("blocks Instagram auto approval until the image worker artifact exists", async () => {
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
      if (sql.includes("from brand_channels") && sql.includes("status = 'connected'")) {
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
      if (sql.includes("update channel_outputs") && sql.includes("auto_approval_blocked")) {
        outputStatuses.push("auto_approval_blocked");
        return { rowCount: 1, rows: [] };
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

    expect(outputStatuses).toContain("auto_approval_blocked");
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
