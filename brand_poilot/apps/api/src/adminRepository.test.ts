import { describe, expect, it, vi } from "vitest";
import { createAdminRepository } from "./adminRepository";

function queryResult(rows: unknown[]) {
  return { rows, rowCount: rows.length };
}

describe("AdminRepository", () => {
  it("maps the operational overview without exposing secrets", async () => {
    const query = vi.fn(async () => queryResult([{
      active_brands: "3",
      paused_brands: "1",
      disabled_brands: "0",
      connected_channels: "4",
      attention_channels: "2",
      generation_succeeded_24h: "8",
      generation_failed_24h: "1",
      pending_review: "5",
      scheduled_publish: "2",
      publishing: "1",
      failed_publish: "1",
      dm_received_24h: "12",
      dm_replied_24h: "10",
      dm_fallback_24h: "1",
      dm_failed_24h: "1",
      wiki_succeeded_24h: "2",
      wiki_failed_24h: "0",
      online_workers: "4",
      stale_workers: "1",
      recent_errors: [{ source: "publish", id: "queue-1", code: "token_expired", occurredAt: "2026-07-19T00:00:00.000Z" }],
    }]));

    const result = await createAdminRepository({ query } as never).getOverview();

    expect(result.brands).toEqual({ active: 3, paused: 1, disabled: 0 });
    expect(result.channels).toEqual({ connected: 4, needsAttention: 2 });
    expect(result.publishing.failed).toBe(1);
    expect(result.recentErrors[0]?.code).toBe("token_expired");
    expect(JSON.stringify(result)).not.toContain("encrypted_payload");
  });

  it("returns cursor-paginated brand summaries", async () => {
    const query = vi.fn(async () => queryResult([{
      id: "11111111-1111-4111-8111-111111111111",
      workspace_id: "22222222-2222-4222-8222-222222222222",
      workspace_name: "Growthline",
      name: "Brand Pilot",
      status: "active",
      created_at: "2026-07-19T01:00:00.000Z",
      last_activity_at: "2026-07-19T02:00:00.000Z",
      owner_display_name: "관리자",
      owner_email: "admin@example.com",
      primary_category_code: "business_services",
      primary_category_name: "비즈니스·전문 서비스",
      subcategories: ["마케팅 컨설팅"],
      connected_channel_count: "2",
      dm_enabled: true,
      onboarding_completed: true,
    }]));

    const page = await createAdminRepository({ query } as never).listBrands({ limit: 30 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      name: "Brand Pilot",
      owner: { displayName: "관리자", email: "admin@example.com" },
      connectedChannelCount: 2,
      dmEnabled: true,
    });
    expect(page.nextCursor).toBeNull();
  });

  it("returns only masked channel credential metadata", async () => {
    const query = vi.fn(async () => queryResult([{
      id: "33333333-3333-4333-8333-333333333333",
      brand_id: "11111111-1111-4111-8111-111111111111",
      brand_name: "Brand Pilot",
      channel: "instagram",
      enabled: true,
      status: "connected",
      auth_mode: "facebook_login",
      account_label: "@growthline352",
      external_account_id_masked: "1789...1234",
      scopes: ["instagram_basic"],
      expires_at: null,
      last_healthy_at: "2026-07-19T01:00:00.000Z",
      last_published_at: null,
      last_error_code: null,
      last_error_message: null,
    }]));

    const page = await createAdminRepository({ query } as never).listChannels({ limit: 30 });

    expect(page.items[0]).toMatchObject({
      accountLabel: "@growthline352",
      externalAccountIdMasked: "1789...1234",
      scopes: ["instagram_basic"],
    });
    expect(JSON.stringify(page)).not.toMatch(/secret|encrypted/i);
  });

  it("lists feedback independently with admin filters", async () => {
    const query = vi.fn(async () => queryResult([{
      id: "77777777-7777-4777-8777-777777777777",
      workspace_id: "22222222-2222-4222-8222-222222222222",
      workspace_name: "Growthline",
      brand_id: "11111111-1111-4111-8111-111111111111",
      brand_name: "Brand Pilot",
      message: "결과 미리보기를 개선해 주세요.",
      status: "new",
      created_at: "2026-07-22T08:00:00.000Z",
      updated_at: "2026-07-22T08:00:00.000Z"
    }]));
    const repository = createAdminRepository({ query } as never) as ReturnType<typeof createAdminRepository> & {
      listFeedback: (input: { q?: string; status?: string; brandId?: string; limit: number }) => Promise<any>;
    };

    const page = await repository.listFeedback({
      q: "미리보기",
      status: "new",
      brandId: "11111111-1111-4111-8111-111111111111",
      limit: 30
    });

    expect(page.items[0]).toMatchObject({
      workspaceName: "Growthline",
      brandName: "Brand Pilot",
      message: "결과 미리보기를 개선해 주세요.",
      status: "new"
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("from feedback_submissions feedback"), [
      "미리보기",
      "11111111-1111-4111-8111-111111111111",
      "new",
      null,
      null,
      31
    ]);
  });

  it("lists customer support requests independently from feedback", async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => queryResult([{
      id: "88888888-8888-4888-8888-888888888888",
      workspace_id: "22222222-2222-4222-8222-222222222222",
      workspace_name: "Growthline",
      brand_id: "11111111-1111-4111-8111-111111111111",
      brand_name: "Brand Pilot",
      category: "bug",
      title: "게시 오류 문의",
      message: "캐러셀 게시가 실패합니다.",
      contact_phone: "010-1234-5678",
      contact_email: "owner@example.com",
      status: "new",
      response_message: null,
      responded_at: null,
      created_at: "2026-07-22T08:00:00.000Z",
      updated_at: "2026-07-22T08:00:00.000Z"
    }]));
    const repository = createAdminRepository({ query } as never) as ReturnType<typeof createAdminRepository> & {
      listSupportRequests: (input: { q?: string; status?: string; brandId?: string; limit: number }) => Promise<any>;
    };

    const page = await repository.listSupportRequests({ q: "캐러셀", status: "new", limit: 30 });

    expect(page.items[0]).toMatchObject({
      brandName: "Brand Pilot",
      category: "bug",
      title: "게시 오류 문의",
      contactPhone: "010-1234-5678",
      status: "new"
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("from support_requests support"), [
      "캐러셀", null, "new", null, null, 31
    ]);
    expect(String(query.mock.calls[0]?.[0])).not.toContain("feedback_submissions");
  });

  it("maps system health and worker heartbeat states", async () => {
    const query = vi.fn(async () => queryResult([{
      queue_counts: { queued: 4, running: 2, failed: 1, dead: 0 },
      workers: [
        { workerId: "dm-1", workerType: "dm", status: "online", lastHeartbeatAt: "2026-07-19T01:00:00.000Z", metadata: {} },
      ],
      leases: [{ resourceType: "codex_cli", workloadType: "dm", workerId: "dm-1", expiresAt: "2026-07-19T01:01:00.000Z" }],
      schedulers: [],
    }]));

    const result = await createAdminRepository({ query } as never).getSystemHealth();

    expect(result.database).toBe("ok");
    expect(result.queueCounts.queued).toBe(4);
    expect(result.workers[0]?.status).toBe("online");
  });

  it("returns cursor-paginated publishing rows with safe operation flags", async () => {
    const query = vi.fn(async () => queryResult([{
      id: "60000000-0000-4000-8000-000000000006",
      brand_id: "30000000-0000-4000-8000-000000000003",
      brand_name: "Brand Pilot",
      content_title: "여름 콘텐츠",
      topic_title: "여름 마케팅",
      channel: "instagram",
      delivery_format: "instagram_feed_carousel",
      output_status: "approved",
      status: "failed",
      approval_type: "manual",
      scheduled_for: null,
      published_at: null,
      queued_at: "2026-07-19T01:00:00.000Z",
      created_at: "2026-07-19T01:00:00.000Z",
      last_error: "oauth_required",
      attempt_count: "2",
      external_url: null,
      artifact_public_url: "https://cdn.example.com/card.png",
      artifact_mime_type: "image/png",
    }]));

    const page = await createAdminRepository({ query } as never).listPublishing({ limit: 30 });

    expect(page.items[0]).toMatchObject({
      brandName: "Brand Pilot",
      deliveryFormat: "instagram_feed_carousel",
      attemptCount: 2,
      canRetry: true,
      canCancel: false,
    });
  });

  it("returns publishing detail with sanitized output and attempt metadata", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("select id, attempt_number")) return queryResult([{
        id: "70000000-0000-4000-8000-000000000007",
        attempt_number: 1,
        status: "failed",
        response_metadata: { requestId: "provider-1", access_token: "do-not-return" },
        external_post_id: null,
        external_url: null,
        error_code: "oauth_required",
        error_message: "OAuth required",
        started_at: "2026-07-19T01:01:00.000Z",
        finished_at: "2026-07-19T01:02:00.000Z",
      }]);
      if (sql.includes("from review_events")) return queryResult([]);
      return queryResult([{
        id: "60000000-0000-4000-8000-000000000006",
        workspace_id: "20000000-0000-4000-8000-000000000002",
        brand_id: "30000000-0000-4000-8000-000000000003",
        brand_name: "Brand Pilot",
        channel_output_id: "50000000-0000-4000-8000-000000000005",
        content_title: "여름 콘텐츠",
        preview_title: "여름 제목",
        preview_body: "여름 본문",
        source_summary: "공개 근거",
        output_json: { cards: [{ url: "https://cdn.example.com/card.png" }], authorization: "secret" },
        block_reasons: [],
        topic_title: "여름 마케팅",
        topic_angle: "실무 팁",
        reference_url: "https://example.com/source",
        source_urls: ["https://example.com/source"],
        channel: "instagram",
        delivery_format: "instagram_feed_carousel",
        output_status: "approved",
        status: "failed",
        approval_type: "manual",
        scheduled_for: null,
        published_at: null,
        failed_at: "2026-07-19T01:02:00.000Z",
        queued_at: "2026-07-19T01:00:00.000Z",
        created_at: "2026-07-19T01:00:00.000Z",
        last_error: "oauth_required",
        artifact_id: "80000000-0000-4000-8000-000000000008",
        artifact_type: "rendered_image",
        artifact_public_url: "https://cdn.example.com/card.png",
        artifact_mime_type: "image/png",
        artifact_byte_size: "1024",
      }]);
    });

    const detail = await createAdminRepository({ query } as never).getPublishing("60000000-0000-4000-8000-000000000006");

    expect(detail).toMatchObject({ brandName: "Brand Pilot", canRetry: true, attempts: [{ attemptNumber: 1 }] });
    expect(JSON.stringify(detail)).not.toMatch(/do-not-return|authorization|access_token/i);
  });

  it("cancels a queued publish item and records an idempotent audit event", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql.replace(/\s+/g, " ").trim());
      if (sql.includes("from admin_idempotency_keys")) return queryResult([]);
      if (sql.includes("from publish_queue pq") && sql.includes("for update")) return queryResult([{
        id: "60000000-0000-4000-8000-000000000006",
        workspace_id: "20000000-0000-4000-8000-000000000002",
        brand_id: "30000000-0000-4000-8000-000000000003",
        topic_publish_group_id: "90000000-0000-4000-8000-000000000009",
        status: "queued",
        last_error: null,
        group_status: "ready",
        slot_date: null,
        slot_number: null,
        scheduled_for: null,
      }]);
      if (sql.includes("update publish_queue") && sql.includes("returning id, status, updated_at")) {
        return queryResult([{ id: "60000000-0000-4000-8000-000000000006", status: "cancelled", updated_at: "2026-07-19T03:00:00.000Z" }]);
      }
      return queryResult([]);
    });
    const pool = { connect: vi.fn(async () => ({ query, release: vi.fn() })), query: vi.fn() };

    const result = await createAdminRepository(pool as never).updatePublishingStatus({
      queueId: "60000000-0000-4000-8000-000000000006",
      action: "cancel",
      reason: "고객 요청",
      actorId: "growthline-admin",
      requestId: "44444444-4444-4444-8444-444444444444",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      requestHash: "c".repeat(64),
    });

    expect(result).toMatchObject({ status: "cancelled", replayed: false });
    expect(statements.some((sql) => sql.startsWith("insert into audit_events"))).toBe(true);
    expect(statements.some((sql) => sql.startsWith("insert into admin_idempotency_keys"))).toBe(true);
  });

  it("changes brand status once and records an admin audit event", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql.replace(/\s+/g, " ").trim());
      if (sql.includes("from admin_idempotency_keys")) return queryResult([]);
      if (sql.includes("from brands") && sql.includes("for update")) {
        return queryResult([{ id: "11111111-1111-4111-8111-111111111111", workspace_id: "22222222-2222-4222-8222-222222222222", status: "active" }]);
      }
      if (sql.includes("update brands")) {
        return queryResult([{ id: "11111111-1111-4111-8111-111111111111", status: "paused", updated_at: "2026-07-19T03:00:00.000Z" }]);
      }
      return queryResult([]);
    });
    const release = vi.fn();
    const pool = { connect: vi.fn(async () => ({ query, release })), query: vi.fn() };

    const result = await createAdminRepository(pool as never).updateBrandStatus({
      brandId: "11111111-1111-4111-8111-111111111111",
      status: "paused",
      reason: "고객 요청",
      actorId: "growthline-admin",
      requestId: "44444444-4444-4444-8444-444444444444",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      requestHash: "a".repeat(64),
    });

    expect(result).toMatchObject({ status: "paused", replayed: false });
    expect(statements.some((sql) => sql.startsWith("insert into audit_events"))).toBe(true);
    expect(statements.some((sql) => sql.startsWith("insert into admin_idempotency_keys"))).toBe(true);
    expect(statements.at(0)).toBe("begin");
    expect(statements.at(-1)).toBe("commit");
    expect(release).toHaveBeenCalledOnce();
  });

  it("replays a stored idempotent status result without updating the brand", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from admin_idempotency_keys")) {
        return queryResult([{ request_hash: "b".repeat(64), response_json: { id: "brand-1", status: "paused", updatedAt: "2026-07-19T03:00:00.000Z" } }]);
      }
      return queryResult([]);
    });
    const pool = { connect: vi.fn(async () => ({ query, release: vi.fn() })), query: vi.fn() };

    const result = await createAdminRepository(pool as never).updateBrandStatus({
      brandId: "brand-1",
      status: "paused",
      reason: "고객 요청",
      actorId: "growthline-admin",
      requestId: "44444444-4444-4444-8444-444444444444",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      requestHash: "b".repeat(64),
    });

    expect(result.replayed).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("update brands"))).toBe(false);
  });
});
