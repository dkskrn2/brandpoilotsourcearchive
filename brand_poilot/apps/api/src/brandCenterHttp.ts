import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  mapAnalysisToBrandCoreDraft,
  parseBrandCoreDraft,
  parseBrandEvidence,
  parseBrandReviewState,
  parseBrandRules,
} from "./brandCoreContracts.js";
import type { BrandIntelligenceRepository } from "./brandIntelligenceRepository.js";
import type { ApiRepository } from "./types.js";

interface BrandCenterRouteOptions {
  repository: ApiRepository;
  brandIntelligenceRepository?: BrandIntelligenceRepository;
  scope(request: FastifyRequest, brandId: string): { workspaceId: string; brandId: string };
  actorUserId(request: FastifyRequest): string | null;
}

function record(value: unknown, code = "brand_core_validation_failed:root"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function requireActor(options: BrandCenterRouteOptions, request: FastifyRequest): string {
  const actorUserId = options.actorUserId(request);
  if (!actorUserId) throw new Error("authentication_required");
  return actorUserId;
}

function etag(value: string): string {
  return `"${value}"`;
}

function ifMatch(request: FastifyRequest, body: Record<string, unknown>): string {
  const header = request.headers["if-match"];
  const raw = typeof header === "string"
    ? header
    : typeof body.expectedUpdatedAt === "string"
      ? body.expectedUpdatedAt
      : "";
  const normalized = raw.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  if (!normalized) throw new Error("brand_core_version_conflict");
  return normalized;
}

export function registerBrandCenterRoutes(
  app: FastifyInstance,
  options: BrandCenterRouteOptions,
): void {
  const repository = options.repository;

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/brand-center", async (request) => {
    if (!repository.getActive || !repository.listVersions || !repository.getActiveRules) {
      throw new Error("brand_center_not_configured");
    }
    const scope = options.scope(request, request.params.brandId);
    const [active, versions, activeRules, analysis] = await Promise.all([
      repository.getActive(scope),
      repository.listVersions(scope),
      repository.getActiveRules(scope),
      options.brandIntelligenceRepository?.getCurrentBrandIntelligence(scope) ?? Promise.resolve(null),
    ]);
    const draft = versions.find((item) => item.status === "draft");
    const hasSource = Boolean(analysis?.input.ownedUrl || analysis?.input.uploadIds.length);
    return {
      source: { state: hasSource ? "ready" : "empty" },
      analysis: { state: analysis?.status ?? "empty" },
      brandCore: { state: active ? "approved" : draft ? "review_required" : "empty" },
      rules: { state: activeRules ? "approved" : "empty" },
      products: { state: "unavailable" },
      wiki: { state: "unavailable" },
      avatars: { state: "unavailable" },
    };
  });

  app.get<{ Params: { brandId: string } }>(
    "/brands/:brandId/brand-core",
    async (request, reply) => {
      if (!repository.getActive || !repository.listVersions) throw new Error("brand_center_not_configured");
      const scope = options.scope(request, request.params.brandId);
      const [active, versions] = await Promise.all([
        repository.getActive(scope),
        repository.listVersions(scope),
      ]);
      const draft = versions.find((item) => item.status === "draft") ?? null;
      const current = draft ?? active;
      if (current) reply.header("etag", etag(current.updatedAt));
      return { active, draft, versions };
    },
  );

  app.post<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/brand-core/drafts",
    async (request, reply) => {
      if (!repository.createDraft || !repository.getActive) throw new Error("brand_center_not_configured");
      const scope = options.scope(request, request.params.brandId);
      const actorUserId = requireActor(options, request);
      const body = record(request.body);
      const sourceAnalysisId = body.sourceAnalysisId === null || body.sourceAnalysisId === undefined
        ? null
        : String(body.sourceAnalysisId);
      let core;
      let evidence;
      let reviewState;
      if (body.core !== undefined) {
        core = parseBrandCoreDraft(body.core);
        evidence = parseBrandEvidence(body.evidence ?? []);
        reviewState = body.reviewState === undefined
          ? undefined
          : parseBrandReviewState(body.reviewState);
      } else if (sourceAnalysisId) {
        if (!options.brandIntelligenceRepository) throw new Error("brand_intelligence_not_configured");
        const analysis = await options.brandIntelligenceRepository.getBrandAnalysis({
          ...scope,
          analysisId: sourceAnalysisId,
        });
        if (!analysis?.effectiveResult) throw new Error("brand_analysis_not_found");
        const mapped = mapAnalysisToBrandCoreDraft(analysis.effectiveResult);
        ({ core, evidence, reviewState } = mapped);
      } else {
        const active = await repository.getActive(scope);
        if (!active) throw new Error("brand_core_not_found");
        core = active.core;
        evidence = active.evidence;
        reviewState = active.reviewState;
      }
      const draft = await repository.createDraft(
        { ...scope, actorUserId },
        { core, evidence, reviewState, sourceAnalysisId },
      );
      reply.header("etag", etag(draft.updatedAt));
      return draft;
    },
  );

  app.patch<{ Params: { brandId: string; versionId: string }; Body: unknown }>(
    "/brands/:brandId/brand-core/drafts/:versionId",
    async (request, reply) => {
      if (!repository.updateDraft) throw new Error("brand_center_not_configured");
      const scope = options.scope(request, request.params.brandId);
      const actorUserId = requireActor(options, request);
      const body = record(request.body);
      const updated = await repository.updateDraft(
        { ...scope, actorUserId, versionId: request.params.versionId },
        {
          core: parseBrandCoreDraft(body.core),
          evidence: parseBrandEvidence(body.evidence ?? []),
          reviewState: parseBrandReviewState(body.reviewState ?? {}),
          expectedUpdatedAt: ifMatch(request, body),
        },
      );
      reply.header("etag", etag(updated.updatedAt));
      return updated;
    },
  );

  app.post<{ Params: { brandId: string; versionId: string } }>(
    "/brands/:brandId/brand-core/drafts/:versionId/approve",
    async (request, reply) => {
      if (!repository.approve) throw new Error("brand_center_not_configured");
      const scope = options.scope(request, request.params.brandId);
      const approved = await repository.approve({
        ...scope,
        actorUserId: requireActor(options, request),
        versionId: request.params.versionId,
      });
      reply.header("etag", etag(approved.updatedAt));
      return approved;
    },
  );

  app.get<{ Params: { brandId: string } }>(
    "/brands/:brandId/brand-rules",
    async (request) => {
      if (!repository.getActiveRules || !repository.listRuleSets) {
        throw new Error("brand_center_not_configured");
      }
      const scope = options.scope(request, request.params.brandId);
      const [active, versions] = await Promise.all([
        repository.getActiveRules(scope),
        repository.listRuleSets(scope),
      ]);
      return {
        active,
        draft: versions.find((item) => item.status === "draft") ?? null,
        versions,
      };
    },
  );

  app.put<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/brand-rules/draft",
    async (request) => {
      if (!repository.saveRuleDraft) throw new Error("brand_center_not_configured");
      const scope = options.scope(request, request.params.brandId);
      return repository.saveRuleDraft(
        { ...scope, actorUserId: requireActor(options, request) },
        parseBrandRules(request.body),
      );
    },
  );

  app.post<{ Params: { brandId: string; ruleSetId: string } }>(
    "/brands/:brandId/brand-rules/:ruleSetId/approve",
    async (request) => {
      if (!repository.approveRules) throw new Error("brand_center_not_configured");
      const scope = options.scope(request, request.params.brandId);
      return repository.approveRules({
        ...scope,
        actorUserId: requireActor(options, request),
        ruleSetId: request.params.ruleSetId,
      });
    },
  );
}
