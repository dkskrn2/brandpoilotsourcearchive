import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  mapAnalysisToBrandCoreDraft,
  parseBrandCoreDraft,
  parseBrandEvidence,
  parseBrandReviewState,
  parseBrandRules,
} from "./brandCoreContracts.js";
import { toBrandIntelligenceV1Compatibility } from "./brandIntelligenceV2Contracts.js";
import type { BrandIntelligenceRepository } from "./brandIntelligenceRepository.js";
import type { ApiRepository } from "./types.js";
import { parseProductServiceProfile } from "./productLibraryContracts.js";
import {
  parseCreateWikiItem,
  parseResolveWikiIssue,
  parseUpdateWikiItem,
} from "./wikiManagementContracts.js";
import {
  parseFaqAliasSuggestionApply,
  parseFaqSuggestionItemUpdate,
  parseFaqSuggestionReviewAction,
} from "./faqSuggestionContracts.js";
import {
  parseAssetUploadInput,
  parseAvatarInput,
  parseCreateAvatarInput,
  parseBooleanAction,
  parseReferenceBrandInput,
  parseReferenceFilters,
  parseReferenceUrlInput,
  parseReservedAvatarId,
} from "./assetLibraryContracts.js";
import {
  confirmAssetLibraryUpload,
  cleanupAssetLibraryUploadPrefix,
  issueAssetLibraryUploadToken,
  validateAssetLibraryUpload,
  type AssetLibraryUploadKind,
} from "./assetLibraryUpload.js";

interface BrandCenterRouteOptions {
  repository: ApiRepository;
  brandIntelligenceRepository?: BrandIntelligenceRepository;
  scope(request: FastifyRequest, brandId: string): { workspaceId: string; brandId: string };
  actorUserId(request: FastifyRequest): string | null;
  assetLibraryUpload?: {
    readWriteToken: string;
    generateClientToken?: Parameters<typeof issueAssetLibraryUploadToken>[1]["generateClientToken"];
    getBlob?: Parameters<typeof confirmAssetLibraryUpload>[1]["getBlob"];
    deleteBlob?: import("./assetLibraryUpload.js").AssetLibraryDeleteOptions["deleteBlob"];
    listBlobs?: import("./assetLibraryUpload.js").AssetLibraryDeleteOptions["listBlobs"];
  };
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

function confirmBody(value: unknown) {
  const row = record(value, "asset_upload_validation_failed:root");
  const upload = parseAssetUploadInput({
    fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, checksum: row.checksum,
  });
  if (typeof row.sessionId !== "string" || typeof row.nonce !== "string"
    || typeof row.storagePath !== "string" || typeof row.storageUrl !== "string") {
    throw new Error("asset_upload_validation_failed:confirm");
  }
  return { row, upload, sessionId: row.sessionId, nonce: row.nonce, storagePath: row.storagePath, storageUrl: row.storageUrl };
}

export function registerBrandCenterRoutes(
  app: FastifyInstance,
  options: BrandCenterRouteOptions,
): void {
  const repository = options.repository;

  app.get<{ Params: { brandId: string } }>(
    "/brands/:brandId/faq-capabilities",
    async (request) => {
      if (!repository.getFaqCapabilities) throw new Error("faq_suggestion_not_configured");
      const scope = options.scope(request, request.params.brandId);
      return repository.getFaqCapabilities(scope.brandId);
    },
  );

  app.get<{ Params: { brandId: string } }>("/brands/:brandId/brand-center", async (request) => {
    if (!repository.getActive || !repository.listVersions || !repository.getActiveRules) {
      throw new Error("brand_center_not_configured");
    }
    const scope = options.scope(request, request.params.brandId);
    const [active, versions, activeRules, analysis, products, wiki, avatars] = await Promise.all([
      repository.getActive(scope),
      repository.listVersions(scope),
      repository.getActiveRules(scope),
      options.brandIntelligenceRepository?.getCurrentBrandIntelligence(scope) ?? Promise.resolve(null),
      repository.summarizeProductServices?.(scope) ?? Promise.resolve(null),
      repository.summarizeWiki?.(scope) ?? Promise.resolve(null),
      repository.summarizeAvatars?.(scope) ?? Promise.resolve(null),
    ]);
    const draft = versions.find((item) => item.status === "draft");
    const hasSource = Boolean(analysis?.input.ownedUrl || analysis?.input.uploadIds.length);
    return {
      source: { state: hasSource ? "ready" : "empty" },
      analysis: { state: analysis?.status ?? "empty" },
      brandCore: { state: active ? "approved" : draft ? "review_required" : "empty" },
      rules: { state: activeRules ? "approved" : "empty" },
      products: products
        ? {
            state: products.drafts > 0 ? "review_required" : products.active > 0 ? "approved" : "empty",
            activeCount: products.active,
            draftCount: products.drafts,
          }
        : { state: "unavailable" },
      wiki: wiki ?? { state: "unavailable" },
      avatars: avatars
        ? {
            state: avatars.active > 0 ? "ready" : "empty",
            activeCount: avatars.active,
            defaultAvatarId: avatars.defaultAvatarId,
          }
        : { state: "unavailable" },
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
        const mapped = mapAnalysisToBrandCoreDraft(
          toBrandIntelligenceV1Compatibility(analysis.effectiveResult),
        );
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

  app.post<{ Params: { brandId: string; versionId: string }; Body: unknown }>(
    "/brands/:brandId/brand-core/drafts/:versionId/approve",
    async (request, reply) => {
      if (!repository.approve) throw new Error("brand_center_not_configured");
      const scope = options.scope(request, request.params.brandId);
      const body = record(request.body);
      const approved = await repository.approve(
        {
          ...scope,
          actorUserId: requireActor(options, request),
          versionId: request.params.versionId,
        },
        { expectedUpdatedAt: ifMatch(request, body) },
      );
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

  app.get<{ Params: { brandId: string }; Querystring: { include?: string } }>(
    "/brands/:brandId/product-services",
    async (request) => {
      if (!repository.listProductServices) throw new Error("product_library_not_configured");
      const include = request.query.include?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
      return repository.listProductServices(options.scope(request, request.params.brandId), include);
    },
  );

  app.post<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/product-services",
    async (request, reply) => {
      if (!repository.createProductService) throw new Error("product_library_not_configured");
      const created = await repository.createProductService(
        { ...options.scope(request, request.params.brandId), actorUserId: requireActor(options, request) },
        parseProductServiceProfile(request.body),
      );
      reply.code(201);
      return created;
    },
  );

  app.post<{ Params: { brandId: string; analysisId: string } }>(
    "/brands/:brandId/product-services/from-analysis/:analysisId",
    async (request, reply) => {
      if (!repository.createProductServiceFromAnalysis) throw new Error("product_library_not_configured");
      const created = await repository.createProductServiceFromAnalysis({
        ...options.scope(request, request.params.brandId),
        actorUserId: requireActor(options, request),
        analysisId: request.params.analysisId,
      });
      reply.code(201);
      return created;
    },
  );

  app.get<{ Params: { brandId: string; itemId: string } }>(
    "/brands/:brandId/product-services/:itemId",
    async (request) => {
      if (!repository.getProductService) throw new Error("product_library_not_configured");
      const result = await repository.getProductService({
        ...options.scope(request, request.params.brandId),
        itemId: request.params.itemId,
      });
      if (!result) throw new Error("product_service_not_found");
      return result;
    },
  );

  app.patch<{ Params: { brandId: string; itemId: string }; Body: unknown }>(
    "/brands/:brandId/product-services/:itemId/draft",
    async (request) => {
      if (!repository.updateProductServiceDraft) throw new Error("product_library_not_configured");
      return repository.updateProductServiceDraft(
        { ...options.scope(request, request.params.brandId), actorUserId: requireActor(options, request), itemId: request.params.itemId },
        parseProductServiceProfile(request.body),
      );
    },
  );

  app.post<{ Params: { brandId: string; itemId: string } }>(
    "/brands/:brandId/wiki/items/:itemId/alias-suggestions",
    async (request, reply) => {
      if (!repository.createFaqAliasSuggestionRun) throw new Error("faq_suggestion_not_configured");
      const scope = options.scope(request, request.params.brandId);
      const capabilities = await repository.getFaqCapabilities(scope.brandId);
      if (!capabilities.suggestions) throw new Error("faq_utterance_suggestions_disabled");
      const result = await repository.createFaqAliasSuggestionRun({
        ...scope,
        actorUserId: requireActor(options, request),
        itemId: request.params.itemId,
      });
      reply.code(result.created ? 202 : 200);
      return { run: result.run };
    },
  );

  app.get<{ Params: { brandId: string; itemId: string } }>(
    "/brands/:brandId/wiki/items/:itemId/alias-suggestions/latest",
    async (request) => {
      if (!repository.getLatestFaqAliasSuggestionRun) throw new Error("faq_suggestion_not_configured");
      return {
        run: await repository.getLatestFaqAliasSuggestionRun({
          ...options.scope(request, request.params.brandId),
          itemId: request.params.itemId,
        }),
      };
    },
  );

  app.post<{
    Params: { brandId: string; itemId: string; runId: string };
    Body: unknown;
  }>(
    "/brands/:brandId/wiki/items/:itemId/alias-suggestions/:runId/apply",
    async (request) => {
      if (!repository.applyFaqAliasSuggestionRun) throw new Error("faq_suggestion_not_configured");
      const scope = options.scope(request, request.params.brandId);
      const capabilities = await repository.getFaqCapabilities(scope.brandId);
      if (!capabilities.suggestions) throw new Error("faq_utterance_suggestions_disabled");
      return repository.applyFaqAliasSuggestionRun({
        ...scope,
        actorUserId: requireActor(options, request),
        itemId: request.params.itemId,
        runId: request.params.runId,
        ...parseFaqAliasSuggestionApply(request.body),
      });
    },
  );

  app.post<{ Params: { brandId: string; itemId: string } }>(
    "/brands/:brandId/product-services/:itemId/approve",
    async (request) => {
      if (!repository.approveProductService) throw new Error("product_library_not_configured");
      return repository.approveProductService({
        ...options.scope(request, request.params.brandId),
        actorUserId: requireActor(options, request),
        itemId: request.params.itemId,
      });
    },
  );

  app.post<{ Params: { brandId: string; itemId: string } }>(
    "/brands/:brandId/product-services/:itemId/archive",
    async (request, reply) => {
      if (!repository.archiveProductService) throw new Error("product_library_not_configured");
      await repository.archiveProductService({
        ...options.scope(request, request.params.brandId),
        actorUserId: requireActor(options, request),
        itemId: request.params.itemId,
      });
      reply.code(204);
      return reply.send();
    },
  );

  app.get<{ Params: { brandId: string } }>(
    "/brands/:brandId/wiki/items",
    async (request) => {
      if (!repository.listWikiItems) throw new Error("wiki_management_not_configured");
      return repository.listWikiItems(options.scope(request, request.params.brandId));
    },
  );

  app.post<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/wiki/items",
    async (request, reply) => {
      if (!repository.createWikiItem) throw new Error("wiki_management_not_configured");
      const created = await repository.createWikiItem(
        {
          ...options.scope(request, request.params.brandId),
          actorUserId: requireActor(options, request),
        },
        parseCreateWikiItem(request.body),
      );
      reply.code(201);
      return created;
    },
  );

  app.patch<{ Params: { brandId: string; itemId: string }; Body: unknown }>(
    "/brands/:brandId/wiki/items/:itemId",
    async (request) => {
      if (!repository.updateWikiItem) throw new Error("wiki_management_not_configured");
      return repository.updateWikiItem(
        {
          ...options.scope(request, request.params.brandId),
          actorUserId: requireActor(options, request),
          itemId: request.params.itemId,
        },
        parseUpdateWikiItem(request.body),
      );
    },
  );

  app.get<{ Params: { brandId: string } }>(
    "/brands/:brandId/wiki/issues",
    async (request) => {
      if (!repository.listWikiIssues) throw new Error("wiki_management_not_configured");
      return repository.listWikiIssues(options.scope(request, request.params.brandId));
    },
  );

  app.post<{ Params: { brandId: string; issueId: string }; Body: unknown }>(
    "/brands/:brandId/wiki/issues/:issueId/resolve",
    async (request) => {
      if (!repository.resolveWikiIssue) throw new Error("wiki_management_not_configured");
      return repository.resolveWikiIssue(
        {
          ...options.scope(request, request.params.brandId),
          actorUserId: requireActor(options, request),
          issueId: request.params.issueId,
        },
        parseResolveWikiIssue(request.body),
      );
    },
  );

  app.post<{ Params: { brandId: string } }>(
    "/brands/:brandId/faq-suggestions",
    async (request, reply) => {
      if (!repository.createFaqSuggestionRun) throw new Error("faq_suggestion_not_configured");
      const scope = options.scope(request, request.params.brandId);
      const result = await repository.createFaqSuggestionRun({
        ...scope,
        actorUserId: requireActor(options, request),
      });
      reply.code(result.created ? 202 : 200);
      return { run: result.run };
    },
  );

  app.get<{ Params: { brandId: string } }>(
    "/brands/:brandId/faq-suggestions/latest",
    async (request) => {
      if (!repository.getLatestFaqSuggestionRun) throw new Error("faq_suggestion_not_configured");
      return {
        run: await repository.getLatestFaqSuggestionRun(
          options.scope(request, request.params.brandId),
        ),
      };
    },
  );

  app.get<{ Params: { brandId: string; runId: string } }>(
    "/brands/:brandId/faq-suggestions/:runId",
    async (request) => {
      if (!repository.getFaqSuggestionRun) throw new Error("faq_suggestion_not_configured");
      const run = await repository.getFaqSuggestionRun({
        ...options.scope(request, request.params.brandId),
        runId: request.params.runId,
      });
      if (!run) throw new Error("faq_suggestion_run_not_found");
      return { run };
    },
  );

  app.patch<{
    Params: { brandId: string; runId: string; itemId: string };
    Body: unknown;
  }>(
    "/brands/:brandId/faq-suggestions/:runId/items/:itemId",
    async (request) => {
      if (!repository.updateFaqSuggestionItem) throw new Error("faq_suggestion_not_configured");
      const input = parseFaqSuggestionItemUpdate(request.body);
      return {
        item: await repository.updateFaqSuggestionItem({
          ...options.scope(request, request.params.brandId),
          actorUserId: requireActor(options, request),
          runId: request.params.runId,
          itemId: request.params.itemId,
          ...input,
        }),
      };
    },
  );

  app.post<{
    Params: { brandId: string; runId: string; itemId: string };
    Body: unknown;
  }>(
    "/brands/:brandId/faq-suggestions/:runId/items/:itemId/approve",
    async (request) => {
      if (!repository.approveFaqSuggestionItem) throw new Error("faq_suggestion_not_configured");
      return repository.approveFaqSuggestionItem({
        ...options.scope(request, request.params.brandId),
        actorUserId: requireActor(options, request),
        runId: request.params.runId,
        itemId: request.params.itemId,
        ...parseFaqSuggestionReviewAction(request.body),
      });
    },
  );

  app.post<{
    Params: { brandId: string; runId: string; itemId: string };
    Body: unknown;
  }>(
    "/brands/:brandId/faq-suggestions/:runId/items/:itemId/dismiss",
    async (request) => {
      if (!repository.dismissFaqSuggestionItem) throw new Error("faq_suggestion_not_configured");
      return {
        item: await repository.dismissFaqSuggestionItem({
          ...options.scope(request, request.params.brandId),
          actorUserId: requireActor(options, request),
          runId: request.params.runId,
          itemId: request.params.itemId,
          ...parseFaqSuggestionReviewAction(request.body),
        }),
      };
    },
  );

  app.get<{ Params: { brandId: string }; Querystring: { include?: string } }>(
    "/brands/:brandId/avatars",
    async (request) => {
      if (!repository.listAvatars) throw new Error("asset_library_not_configured");
      return repository.listAvatars(
        options.scope(request, request.params.brandId),
        request.query.include?.split(",").includes("archived") ?? false,
      );
    },
  );

  app.post<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/avatars",
    async (request, reply) => {
      if (!repository.createAvatar) throw new Error("asset_library_not_configured");
      const created = await repository.createAvatar(
        { ...options.scope(request, request.params.brandId), actorUserId: requireActor(options, request) },
        parseCreateAvatarInput(request.body),
      );
      reply.code(201);
      return created;
    },
  );

  app.get<{ Params: { brandId: string; avatarId: string } }>(
    "/brands/:brandId/avatars/:avatarId",
    async (request) => {
      if (!repository.getAvatar) throw new Error("asset_library_not_configured");
      const value = await repository.getAvatar({
        ...options.scope(request, request.params.brandId), avatarId: request.params.avatarId,
      });
      if (!value) throw new Error("avatar_not_found");
      return value;
    },
  );

  app.patch<{ Params: { brandId: string; avatarId: string }; Body: unknown }>(
    "/brands/:brandId/avatars/:avatarId",
    async (request) => {
      if (!repository.updateAvatar) throw new Error("asset_library_not_configured");
      return repository.updateAvatar(
        { ...options.scope(request, request.params.brandId), actorUserId: requireActor(options, request), avatarId: request.params.avatarId },
        parseAvatarInput(request.body),
      );
    },
  );

  const uploadToken = async (
    request: FastifyRequest<{ Params: { brandId: string; avatarId?: string }; Body: unknown }>,
    kind: AssetLibraryUploadKind,
  ) => {
    if (!repository.createUploadSession) throw new Error("asset_library_not_configured");
    if (!options.assetLibraryUpload) throw new Error("asset_library_upload_storage_not_configured");
    const avatarId = kind === "avatar" ? parseReservedAvatarId(request.params.avatarId) : undefined;
    const upload = validateAssetLibraryUpload(kind, parseAssetUploadInput(request.body));
    const session = await repository.createUploadSession(
      { ...options.scope(request, request.params.brandId), actorUserId: requireActor(options, request) },
      kind,
      upload,
      avatarId,
    );
    const token = await issueAssetLibraryUploadToken({
      brandId: request.params.brandId, avatarId,
      sessionId: session.id, kind, upload, expiresAt: session.expiresAt,
    }, {
      token: options.assetLibraryUpload.readWriteToken,
      generateClientToken: options.assetLibraryUpload.generateClientToken,
    });
    return { ...token, sessionId: session.id, nonce: session.nonce, expiresAt: session.expiresAt };
  };

  app.post<{ Params: { brandId: string; avatarId: string }; Body: unknown }>(
    "/brands/:brandId/avatars/:avatarId/images/upload-token",
    async (request) => uploadToken(request, "avatar"),
  );

  app.delete<{ Params: { brandId: string; avatarId: string; sessionId: string } }>(
    "/brands/:brandId/avatars/:avatarId/images/upload-sessions/:sessionId",
    async (request) => {
      if (!repository.cancelAvatarUpload) throw new Error("asset_library_not_configured");
      if (!options.assetLibraryUpload) throw new Error("asset_library_upload_storage_not_configured");
      return repository.cancelAvatarUpload(
        {
          ...options.scope(request, request.params.brandId),
          actorUserId: requireActor(options, request),
          avatarId: request.params.avatarId,
          sessionId: request.params.sessionId,
        },
        (storagePathPrefix, storagePath) => cleanupAssetLibraryUploadPrefix(storagePathPrefix, storagePath, {
          token: options.assetLibraryUpload!.readWriteToken,
          deleteBlob: options.assetLibraryUpload!.deleteBlob,
          listBlobs: options.assetLibraryUpload!.listBlobs,
        }),
      );
    },
  );

  app.post<{ Params: { brandId: string; avatarId: string }; Body: unknown }>(
    "/brands/:brandId/avatars/:avatarId/images/confirm",
    async (request) => {
      if (!repository.getUploadSession || !repository.confirmAvatarUpload) throw new Error("asset_library_not_configured");
      if (!options.assetLibraryUpload) throw new Error("asset_library_upload_storage_not_configured");
      const parsed = confirmBody(request.body);
      const scope = options.scope(request, request.params.brandId);
      const session = await repository.getUploadSession({ ...scope, sessionId: parsed.sessionId }, parsed.upload.fileName);
      if (!session || session.kind !== "avatar" || session.avatarId !== request.params.avatarId) {
        throw new Error("asset_library_upload_session_not_found");
      }
      const confirmed = await confirmAssetLibraryUpload({
        session, nonce: parsed.nonce, storagePath: parsed.storagePath, storageUrl: parsed.storageUrl,
        mimeType: parsed.upload.mimeType, sizeBytes: parsed.upload.sizeBytes, checksum: parsed.upload.checksum,
      }, { token: options.assetLibraryUpload.readWriteToken, getBlob: options.assetLibraryUpload.getBlob });
      const representative = parsed.row.representative === true;
      return repository.confirmAvatarUpload(
        { ...scope, actorUserId: requireActor(options, request), avatarId: request.params.avatarId, sessionId: parsed.sessionId },
        { ...confirmed, representative },
      );
    },
  );

  app.delete<{ Params: { brandId: string; avatarId: string; imageId: string } }>(
    "/brands/:brandId/avatars/:avatarId/images/:imageId",
    async (request, reply) => {
      if (!repository.deleteAvatarImage) throw new Error("asset_library_not_configured");
      await repository.deleteAvatarImage({
        ...options.scope(request, request.params.brandId), actorUserId: requireActor(options, request),
        avatarId: request.params.avatarId, imageId: request.params.imageId,
      });
      reply.code(204);
      return reply.send();
    },
  );

  app.post<{ Params: { brandId: string; avatarId: string } }>(
    "/brands/:brandId/avatars/:avatarId/default",
    async (request) => {
      if (!repository.setDefaultAvatar) throw new Error("asset_library_not_configured");
      return repository.setDefaultAvatar({
        ...options.scope(request, request.params.brandId), actorUserId: requireActor(options, request), avatarId: request.params.avatarId,
      });
    },
  );

  app.post<{ Params: { brandId: string; avatarId: string } }>(
    "/brands/:brandId/avatars/:avatarId/archive",
    async (request, reply) => {
      if (!repository.archiveAvatar) throw new Error("asset_library_not_configured");
      await repository.archiveAvatar({
        ...options.scope(request, request.params.brandId), actorUserId: requireActor(options, request), avatarId: request.params.avatarId,
      });
      reply.code(204);
      return reply.send();
    },
  );

  app.get<{ Params: { brandId: string }; Querystring: Record<string, unknown> }>(
    "/brands/:brandId/references",
    async (request) => {
      if (!repository.listReferences) throw new Error("asset_library_not_configured");
      return repository.listReferences(options.scope(request, request.params.brandId), parseReferenceFilters(request.query));
    },
  );

  app.post<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/references/url",
    async (request, reply) => {
      if (!repository.addReferenceUrl) throw new Error("asset_library_not_configured");
      const value = await repository.addReferenceUrl(
        { ...options.scope(request, request.params.brandId), actorUserId: requireActor(options, request) },
        parseReferenceUrlInput(request.body),
      );
      reply.code(201);
      return value;
    },
  );

  app.post<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/references/upload-token",
    async (request) => uploadToken(request as never, "reference"),
  );

  app.delete<{ Params: { brandId: string; sessionId: string } }>(
    "/brands/:brandId/references/upload-sessions/:sessionId",
    async (request) => {
      if (!repository.cancelReferenceUpload) throw new Error("asset_library_not_configured");
      if (!options.assetLibraryUpload) throw new Error("asset_library_upload_storage_not_configured");
      return repository.cancelReferenceUpload(
        {
          ...options.scope(request, request.params.brandId),
          actorUserId: requireActor(options, request),
          sessionId: request.params.sessionId,
        },
        (storagePathPrefix, storagePath) => cleanupAssetLibraryUploadPrefix(storagePathPrefix, storagePath, {
          token: options.assetLibraryUpload!.readWriteToken,
          deleteBlob: options.assetLibraryUpload!.deleteBlob,
          listBlobs: options.assetLibraryUpload!.listBlobs,
        }),
      );
    },
  );

  app.get<{ Params: { brandId: string; referenceId: string } }>(
    "/brands/:brandId/references/:referenceId",
    async (request) => {
      if (!repository.getReference) throw new Error("asset_library_not_configured");
      const value = await repository.getReference({
        ...options.scope(request, request.params.brandId),
        referenceId: request.params.referenceId,
      });
      if (!value) throw new Error("reference_not_found");
      return value;
    },
  );

  app.post<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/references/confirm",
    async (request, reply) => {
      if (!repository.getUploadSession || !repository.confirmReferenceUpload) throw new Error("asset_library_not_configured");
      if (!options.assetLibraryUpload) throw new Error("asset_library_upload_storage_not_configured");
      const parsed = confirmBody(request.body);
      const scope = options.scope(request, request.params.brandId);
      const session = await repository.getUploadSession({ ...scope, sessionId: parsed.sessionId }, parsed.upload.fileName);
      if (!session || session.kind !== "reference") throw new Error("asset_library_upload_session_not_found");
      const confirmed = await confirmAssetLibraryUpload({
        session, nonce: parsed.nonce, storagePath: parsed.storagePath, storageUrl: parsed.storageUrl,
        mimeType: parsed.upload.mimeType, sizeBytes: parsed.upload.sizeBytes, checksum: parsed.upload.checksum,
      }, { token: options.assetLibraryUpload.readWriteToken, getBlob: options.assetLibraryUpload.getBlob });
      const value = await repository.confirmReferenceUpload(
        { ...scope, actorUserId: requireActor(options, request), sessionId: parsed.sessionId },
        confirmed,
      );
      reply.code(201);
      return value;
    },
  );

  app.post<{ Params: { brandId: string; referenceId: string }; Body: unknown }>(
    "/brands/:brandId/references/:referenceId/favorite",
    async (request) => {
      if (!repository.setReferenceFavorite) throw new Error("asset_library_not_configured");
      return repository.setReferenceFavorite(
        { ...options.scope(request, request.params.brandId), actorUserId: requireActor(options, request), referenceId: request.params.referenceId },
        parseBooleanAction(request.body, "favorite"),
      );
    },
  );

  app.post<{ Params: { brandId: string; referenceId: string } }>(
    "/brands/:brandId/references/:referenceId/archive",
    async (request, reply) => {
      if (!repository.archiveReference) throw new Error("asset_library_not_configured");
      await repository.archiveReference({
        ...options.scope(request, request.params.brandId), actorUserId: requireActor(options, request), referenceId: request.params.referenceId,
      });
      reply.code(204);
      return reply.send();
    },
  );

  app.get<{ Params: { brandId: string; referenceId: string } }>(
    "/brands/:brandId/references/:referenceId/pattern",
    async (request) => {
      if (!repository.getReferencePattern) throw new Error("asset_library_not_configured");
      const value = await repository.getReferencePattern({
        ...options.scope(request, request.params.brandId), referenceId: request.params.referenceId,
      });
      if (!value) throw new Error("reference_pattern_not_found");
      return value;
    },
  );

  app.get<{ Params: { brandId: string }; Querystring: { q?: string } }>("/brands/:brandId/reference-brands", async (request) => {
    const scope = options.scope(request, request.params.brandId);
    if (repository.listReferenceChannels) return repository.listReferenceChannels(scope, request.query.q);
    if (!repository.listReferenceBrands) throw new Error("asset_library_not_configured");
    return repository.listReferenceBrands(scope);
  });

  app.post<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/reference-brands/resolve",
    async (request, reply) => {
      if (!repository.resolveReferenceChannel) throw new Error("asset_library_not_configured");
      const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
      if (typeof body.profile !== "string" || !body.profile.trim()) {
        throw new Error("reference_channel_handle_invalid");
      }
      const value = await repository.resolveReferenceChannel(
        { ...options.scope(request, request.params.brandId), actorUserId: requireActor(options, request) },
        body.profile,
      );
      reply.code(201);
      return value;
    },
  );

  app.post<{ Params: { brandId: string }; Body: unknown }>(
    "/brands/:brandId/reference-brands",
    async (request, reply) => {
      if (!repository.createReferenceBrand) throw new Error("asset_library_not_configured");
      const value = await repository.createReferenceBrand(
        { ...options.scope(request, request.params.brandId), actorUserId: requireActor(options, request) },
        parseReferenceBrandInput(request.body),
      );
      reply.code(201);
      return value;
    },
  );

  app.post<{ Params: { brandId: string; mediaId: string } }>(
    "/brands/:brandId/reference-brands/from-trend-media/:mediaId",
    async (request, reply) => {
      if (!repository.createReferenceBrandFromTrend) throw new Error("asset_library_not_configured");
      const value = await repository.createReferenceBrandFromTrend({
        ...options.scope(request, request.params.brandId), actorUserId: requireActor(options, request), mediaId: request.params.mediaId,
      });
      reply.code(201);
      return value;
    },
  );

  app.get<{ Params: { brandId: string; referenceBrandId: string } }>(
    "/brands/:brandId/reference-brands/:referenceBrandId/media",
    async (request) => {
      if (!repository.listReferenceChannelMedia) throw new Error("asset_library_not_configured");
      return repository.listReferenceChannelMedia({
        ...options.scope(request, request.params.brandId), referenceBrandId: request.params.referenceBrandId,
      });
    },
  );

  app.get<{ Params: { brandId: string; referenceBrandId: string } }>(
    "/brands/:brandId/reference-brands/:referenceBrandId/items",
    async (request) => {
      if (!repository.listReferenceBrandItems) throw new Error("asset_library_not_configured");
      return repository.listReferenceBrandItems({
        ...options.scope(request, request.params.brandId), referenceBrandId: request.params.referenceBrandId,
      });
    },
  );
}
