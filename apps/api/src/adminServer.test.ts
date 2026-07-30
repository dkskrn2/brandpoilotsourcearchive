import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerAdminRoutes } from "./adminServer";
import type { AdminRepository } from "./adminTypes";

const requestId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "22222222-2222-4222-8222-222222222222";

function repository(): AdminRepository {
  return {
    getOverview: vi.fn(async () => ({
      generatedAt: "2026-07-19T00:00:00.000Z",
      brands: { active: 1, paused: 0, disabled: 0 },
      channels: { connected: 1, needsAttention: 0 },
      generation24h: { succeeded: 1, failed: 0 },
      publishing: { pendingReview: 0, scheduled: 1, publishing: 0, failed: 0 },
      dm24h: { received: 1, replied: 1, fallback: 0, failed: 0 },
      wiki24h: { succeeded: 1, failed: 0 },
      workers: { online: 2, stale: 0 },
      recentErrors: [],
    })),
    listBrands: vi.fn(async () => ({ items: [], nextCursor: null })),
    getBrand: vi.fn(async () => null),
    listChannels: vi.fn(async () => ({ items: [], nextCursor: null })),
    listFeedback: vi.fn(async () => ({ items: [], nextCursor: null })),
    listSupportRequests: vi.fn(async () => ({ items: [], nextCursor: null })),
    listPublishing: vi.fn(async () => ({ items: [], nextCursor: null })),
    getPublishing: vi.fn(async () => null),
    updatePublishingStatus: vi.fn(async (input) => ({ id: input.queueId, status: input.action === "retry" ? "queued" : "cancelled", updatedAt: "2026-07-19T00:00:00.000Z", replayed: false })),
    getSystemHealth: vi.fn(async () => ({ database: "ok" as const, checkedAt: "2026-07-19T00:00:00.000Z", queueCounts: {}, workers: [], leases: [], schedulers: [] })),
    listAuditEvents: vi.fn(async () => ({ items: [], nextCursor: null })),
    updateBrandStatus: vi.fn(async (input) => ({ id: input.brandId, status: input.status, updatedAt: "2026-07-19T00:00:00.000Z", replayed: false })),
  };
}

async function app(repo = repository(), token = "admin-secret") {
  const server = Fastify({ logger: false });
  registerAdminRoutes(server, { repository: repo, serviceToken: token });
  await server.ready();
  return server;
}

function headers(overrides: Record<string, string> = {}) {
  return {
    authorization: "Bearer admin-secret",
    "x-admin-actor-id": "growthline-admin",
    "x-request-id": requestId,
    ...overrides,
  };
}

describe("Brand Pilot Admin API", () => {
  it("rejects a request without the service token", async () => {
    const server = await app();
    const response = await server.inject({ method: "GET", url: "/admin/v1/overview" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("admin_unauthorized");
    await server.close();
  });

  it("requires the server-derived admin actor and request id", async () => {
    const server = await app();
    const response = await server.inject({
      method: "GET",
      url: "/admin/v1/overview",
      headers: { authorization: "Bearer admin-secret" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("admin_request_context_invalid");
    await server.close();
  });

  it("returns the overview in the common response envelope", async () => {
    const server = await app();
    const response = await server.inject({ method: "GET", url: "/admin/v1/overview", headers: headers() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { brands: { active: 1 } }, requestId });
    await server.close();
  });

  it("returns cursor pages for brand and channel lists", async () => {
    const repo = repository();
    const server = await app(repo);
    const brandResponse = await server.inject({ method: "GET", url: "/admin/v1/brands?limit=20", headers: headers() });
    const channelResponse = await server.inject({ method: "GET", url: "/admin/v1/channels?limit=20", headers: headers() });
    expect(brandResponse.json()).toMatchObject({ data: [], page: { nextCursor: null, hasMore: false }, requestId });
    expect(channelResponse.statusCode).toBe(200);
    expect(repo.listBrands).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
    expect(repo.listChannels).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
    await server.close();
  });

  it("returns feedback from its own admin resource", async () => {
    const repo = repository() as AdminRepository & { listFeedback: ReturnType<typeof vi.fn> };
    repo.listFeedback = vi.fn(async () => ({ items: [{
      id: "77777777-7777-4777-8777-777777777777",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      workspaceName: "Growthline",
      brandId: "11111111-1111-4111-8111-111111111111",
      brandName: "Brand Pilot",
      message: "결과 미리보기를 개선해 주세요.",
      status: "new" as const,
      createdAt: "2026-07-22T08:00:00.000Z",
      updatedAt: "2026-07-22T08:00:00.000Z"
    }], nextCursor: null }));
    const server = await app(repo);

    const response = await server.inject({
      method: "GET",
      url: "/admin/v1/feedback?q=미리보기&status=new&brandId=11111111-1111-4111-8111-111111111111&limit=20",
      headers: headers()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: [{ message: "결과 미리보기를 개선해 주세요." }] });
    expect(repo.listFeedback).toHaveBeenCalledWith(expect.objectContaining({
      q: "미리보기",
      status: "new",
      brandId: "11111111-1111-4111-8111-111111111111",
      limit: 20
    }));
    await server.close();
  });

  it("returns customer support requests from a different admin resource", async () => {
    const repo = repository() as AdminRepository & { listSupportRequests: ReturnType<typeof vi.fn> };
    repo.listSupportRequests = vi.fn(async () => ({ items: [{
      id: "88888888-8888-4888-8888-888888888888",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      workspaceName: "Growthline",
      brandId: "11111111-1111-4111-8111-111111111111",
      brandName: "Brand Pilot",
      category: "bug" as const,
      title: "게시 오류 문의",
      message: "캐러셀 게시가 실패합니다.",
      contactPhone: "010-1234-5678",
      contactEmail: "owner@example.com",
      status: "new" as const,
      responseMessage: null,
      respondedAt: null,
      createdAt: "2026-07-22T08:00:00.000Z",
      updatedAt: "2026-07-22T08:00:00.000Z"
    }], nextCursor: null }));
    const server = await app(repo);

    const response = await server.inject({
      method: "GET",
      url: "/admin/v1/support-requests?status=new&limit=20",
      headers: headers()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: [{ title: "게시 오류 문의" }] });
    expect(repo.listSupportRequests).toHaveBeenCalledWith(expect.objectContaining({ status: "new", limit: 20 }));
    await server.close();
  });

  it("returns publishing pages and a 404 for missing publishing detail", async () => {
    const repo = repository();
    const server = await app(repo);
    const page = await server.inject({ method: "GET", url: "/admin/v1/publishing?status=failed", headers: headers() });
    const detail = await server.inject({
      method: "GET",
      url: "/admin/v1/publishing/60000000-0000-4000-8000-000000000006",
      headers: headers(),
    });
    expect(page.statusCode).toBe(200);
    expect(repo.listPublishing).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(detail.statusCode).toBe(404);
    await server.close();
  });

  it("requires a reason and idempotency key for publishing operations", async () => {
    const repo = repository();
    const server = await app(repo);
    const response = await server.inject({
      method: "POST",
      url: "/admin/v1/publishing/60000000-0000-4000-8000-000000000006/retry",
      headers: headers(),
      payload: { reason: "" },
    });
    expect(response.statusCode).toBe(400);
    expect(repo.updatePublishingStatus).not.toHaveBeenCalled();
    await server.close();
  });

  it("passes an idempotent publishing cancel operation to the repository", async () => {
    const repo = repository();
    const server = await app(repo);
    const response = await server.inject({
      method: "POST",
      url: "/admin/v1/publishing/60000000-0000-4000-8000-000000000006/cancel",
      headers: headers({ "idempotency-key": idempotencyKey }),
      payload: { reason: "고객 요청" },
    });
    expect(response.statusCode).toBe(200);
    expect(repo.updatePublishingStatus).toHaveBeenCalledWith(expect.objectContaining({
      action: "cancel", reason: "고객 요청", requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    await server.close();
  });

  it("rejects invalid list filters before they reach PostgreSQL", async () => {
    const repo = repository();
    const server = await app(repo);
    const response = await server.inject({
      method: "GET",
      url: "/admin/v1/channels?brandId=not-a-uuid",
      headers: headers(),
    });
    expect(response.statusCode).toBe(400);
    expect(repo.listChannels).not.toHaveBeenCalled();
    await server.close();
  });

  it("maps the audit eventType filter to the repository contract", async () => {
    const repo = repository();
    const server = await app(repo);
    const response = await server.inject({
      method: "GET",
      url: "/admin/v1/audit-events?eventType=admin.brand_paused",
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    expect(repo.listAuditEvents).toHaveBeenCalledWith(expect.objectContaining({ status: "admin.brand_paused" }));
    await server.close();
  });

  it("returns 404 for a missing brand detail", async () => {
    const server = await app();
    const response = await server.inject({
      method: "GET",
      url: "/admin/v1/brands/33333333-3333-4333-8333-333333333333",
      headers: headers(),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("not_found");
    await server.close();
  });

  it("requires an idempotency key and reason for brand status changes", async () => {
    const server = await app();
    const response = await server.inject({
      method: "PATCH",
      url: "/admin/v1/brands/33333333-3333-4333-8333-333333333333/status",
      headers: headers(),
      payload: { status: "paused", reason: "" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
    await server.close();
  });

  it("passes a normalized hash and admin context to the status mutation", async () => {
    const repo = repository();
    const server = await app(repo);
    const response = await server.inject({
      method: "PATCH",
      url: "/admin/v1/brands/33333333-3333-4333-8333-333333333333/status",
      headers: headers({ "idempotency-key": idempotencyKey }),
      payload: { status: "paused", reason: "고객 요청" },
    });
    expect(response.statusCode).toBe(200);
    expect(repo.updateBrandStatus).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "growthline-admin",
      requestId,
      idempotencyKey,
      requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      status: "paused",
      reason: "고객 요청",
    }));
    await server.close();
  });
});
