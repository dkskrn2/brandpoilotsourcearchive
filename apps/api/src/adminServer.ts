import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AdminIdempotencyConflictError, AdminStateConflictError } from "./adminRepository.js";
import type { AdminListInput, AdminRepository } from "./adminTypes.js";

interface AdminRouteOptions {
  repository: AdminRepository;
  serviceToken: string;
}

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function header(request: FastifyRequest, name: string) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function matchesToken(authorization: string | undefined, expectedToken: string) {
  if (!expectedToken || !authorization?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function requestContext(request: FastifyRequest) {
  return {
    actorId: header(request, "x-admin-actor-id")!,
    requestId: header(request, "x-request-id")!,
  };
}

function listInput(query: Record<string, unknown>): AdminListInput {
  const limit = query.limit === undefined ? 30 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("validation_error");
  const optional = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
  const q = optional(query.q);
  const brandId = optional(query.brandId);
  if ((q && q.length > 100) || (brandId && !uuidPattern.test(brandId))) throw new Error("validation_error");
  return {
    q, status: optional(query.status) ?? optional(query.eventType), brandId,
    channel: optional(query.channel), cursor: optional(query.cursor), limit,
  };
}

function envelope(data: unknown, requestId: string) {
  return { data, requestId };
}

function pageEnvelope(page: { items: unknown[]; nextCursor: string | null }, requestId: string) {
  return { data: page.items, page: { nextCursor: page.nextCursor, hasMore: page.nextCursor !== null }, requestId };
}

export function registerAdminRoutes(app: FastifyInstance, options: AdminRouteOptions) {
  void app.register(async (admin) => {
    admin.addHook("onRequest", async (request, reply) => {
      if (!matchesToken(header(request, "authorization"), options.serviceToken)) {
        reply.code(401).send({ error: { code: "admin_unauthorized", message: "관리자 API 인증에 실패했습니다.", details: {} }, requestId: header(request, "x-request-id") ?? null });
        return reply;
      }
      const actorId = header(request, "x-admin-actor-id");
      const requestId = header(request, "x-request-id");
      if (!actorId?.trim() || actorId.length > 200 || !requestId || !uuidPattern.test(requestId)) {
        reply.code(400).send({ error: { code: "admin_request_context_invalid", message: "관리자 요청 정보가 올바르지 않습니다.", details: {} }, requestId: requestId ?? null });
        return reply;
      }
    });

    admin.setErrorHandler((error, request, reply) => {
      const requestId = header(request, "x-request-id") ?? null;
      const code = error instanceof Error ? error.message : "internal_error";
      if (error instanceof AdminIdempotencyConflictError) {
        reply.code(409).send({ error: { code: "idempotency_conflict", message: "같은 멱등성 키에 다른 요청이 사용되었습니다.", details: {} }, requestId });
      } else if (error instanceof AdminStateConflictError) {
        reply.code(409).send({ error: { code: "state_conflict", message: "현재 상태에서는 요청한 작업을 실행할 수 없습니다.", details: {} }, requestId });
      } else if (code === "admin_brand_not_found") {
        reply.code(404).send({ error: { code: "not_found", message: "브랜드를 찾을 수 없습니다.", details: {} }, requestId });
      } else if (code === "admin_publish_not_found") {
        reply.code(404).send({ error: { code: "not_found", message: "게시 항목을 찾을 수 없습니다.", details: {} }, requestId });
      } else if (code === "validation_error" || code === "admin_cursor_invalid") {
        reply.code(400).send({ error: { code: "validation_error", message: "요청 값이 올바르지 않습니다.", details: {} }, requestId });
      } else {
        request.log.error({ err: error, requestId }, "admin_api_request_failed");
        reply.code(500).send({ error: { code: "internal_error", message: "관리자 요청 처리 중 오류가 발생했습니다.", details: {} }, requestId });
      }
    });

    admin.get("/overview", async (request) => envelope(await options.repository.getOverview(), requestContext(request).requestId));

    admin.get<{ Querystring: Record<string, unknown> }>("/brands", async (request) =>
      pageEnvelope(await options.repository.listBrands(listInput(request.query)), requestContext(request).requestId));

    admin.get<{ Params: { brandId: string } }>("/brands/:brandId", async (request, reply) => {
      if (!uuidPattern.test(request.params.brandId)) throw new Error("validation_error");
      const brand = await options.repository.getBrand(request.params.brandId);
      if (!brand) {
        reply.code(404);
        return { error: { code: "not_found", message: "브랜드를 찾을 수 없습니다.", details: {} }, requestId: requestContext(request).requestId };
      }
      return envelope(brand, requestContext(request).requestId);
    });

    admin.patch<{ Params: { brandId: string }; Body: Record<string, unknown> }>("/brands/:brandId/status", async (request) => {
      const { actorId, requestId } = requestContext(request);
      const idempotencyKey = header(request, "idempotency-key");
      const status = request.body?.status;
      const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : "";
      if (!uuidPattern.test(request.params.brandId) || !idempotencyKey || !uuidPattern.test(idempotencyKey)
        || (status !== "active" && status !== "paused") || !reason || reason.length > 500) {
        throw new Error("validation_error");
      }
      const requestHash = createHash("sha256").update(JSON.stringify({ reason, status })).digest("hex");
      const result = await options.repository.updateBrandStatus({
        brandId: request.params.brandId, status, reason, actorId, requestId, idempotencyKey, requestHash,
      });
      return envelope(result, requestId);
    });

    admin.get<{ Querystring: Record<string, unknown> }>("/channels", async (request) =>
      pageEnvelope(await options.repository.listChannels(listInput(request.query)), requestContext(request).requestId));

    admin.get<{ Querystring: Record<string, unknown> }>("/feedback", async (request) =>
      pageEnvelope(await options.repository.listFeedback(listInput(request.query)), requestContext(request).requestId));

    admin.get<{ Querystring: Record<string, unknown> }>("/support-requests", async (request) =>
      pageEnvelope(await options.repository.listSupportRequests(listInput(request.query)), requestContext(request).requestId));

    admin.get<{ Querystring: Record<string, unknown> }>("/publishing", async (request) =>
      pageEnvelope(await options.repository.listPublishing(listInput(request.query)), requestContext(request).requestId));

    admin.get<{ Params: { queueId: string } }>("/publishing/:queueId", async (request, reply) => {
      if (!uuidPattern.test(request.params.queueId)) throw new Error("validation_error");
      const item = await options.repository.getPublishing(request.params.queueId);
      if (!item) {
        reply.code(404);
        return { error: { code: "not_found", message: "게시 항목을 찾을 수 없습니다.", details: {} }, requestId: requestContext(request).requestId };
      }
      return envelope(item, requestContext(request).requestId);
    });

    admin.post<{ Params: { queueId: string; action: string }; Body: Record<string, unknown> }>("/publishing/:queueId/:action", async (request) => {
      const { actorId, requestId } = requestContext(request);
      const idempotencyKey = header(request, "idempotency-key");
      const action = request.params.action;
      const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : "";
      if (!uuidPattern.test(request.params.queueId) || !idempotencyKey || !uuidPattern.test(idempotencyKey)
        || (action !== "retry" && action !== "cancel") || !reason || reason.length > 500) {
        throw new Error("validation_error");
      }
      const requestHash = createHash("sha256").update(JSON.stringify({ action, reason })).digest("hex");
      return envelope(await options.repository.updatePublishingStatus({
        queueId: request.params.queueId, action, reason, actorId, requestId, idempotencyKey, requestHash,
      }), requestId);
    });

    admin.get("/system/health", async (request) => envelope(await options.repository.getSystemHealth(), requestContext(request).requestId));

    admin.get("/system/workers", async (request) => {
      const health = await options.repository.getSystemHealth();
      return envelope(health.workers, requestContext(request).requestId);
    });

    admin.get<{ Querystring: Record<string, unknown> }>("/audit-events", async (request) =>
      pageEnvelope(await options.repository.listAuditEvents(listInput(request.query)), requestContext(request).requestId));
  }, { prefix: "/admin/v1" });
}
