import "dotenv/config";
import Fastify from "fastify";
import {
  BlobNotFoundError,
  del as deleteBlob,
  get as getBlob,
  head as headBlob,
  put as putBlob,
} from "@vercel/blob";
import {
  assertDatabaseIdentity,
  createPool,
  createPoolForUrl,
  readDatabaseUrlSecret,
} from "./db.js";
import { createRepository, loadPerformanceInsightSnapshots } from "./repository.js";
import { resolveServerHost } from "./runtime.js";
import { createFastifyOptions, createServer } from "./httpServer.js";
import { createServerlessHandler } from "./serverlessHandler.js";
import { createKakaoAuthStore } from "./kakaoAuth.js";
import { startLocalScheduler } from "./scheduler.js";
import { createBrandLogoService, createPostgresBrandLogoStore, createSupabaseBrandLogoStorage } from "./brandLogo.js";
import { createAdminRepository } from "./adminRepository.js";
import { registerAdminRoutes } from "./adminServer.js";
import { createBrandIntelligenceRepository } from "./brandIntelligenceRepository.js";
import { loadApiRuntimeConfig } from "./runtimeConfig.js";
import { createShutdown, logShutdownFailure } from "./shutdown.js";
import { createAiContentSnapshotBlob, type AiContentSnapshotStorage } from "./aiContentSnapshotBlob.js";
import { createAiContentSnapshotRepository } from "./aiContentSnapshotRepository.js";
import { resolveAiContentSeed } from "./aiContentSeedResolver.js";
import { crawlSourceUrl } from "./sourceCrawler.js";
import { buildChannelCapabilities } from "./channelCapabilities.js";
import { parseProposalBaseInputSnapshotV2 } from "@brand-pilot/content-contracts";
import { createAiContentProposalV2Repository } from "./aiContentRepository.js";
import { createAiContentProposalV2Service } from "./aiContentProposalV2Service.js";
import { resolveContentProposalV2Input } from "./contentOrchestration.js";
import { parseContentOrchestrationV2 } from "./aiContentGenerationInputV3.js";
import { createPerformanceProposalAdapter } from "./performanceProposalAdapter.js";
import { createContentSuggestionRepository } from "./contentSuggestionRepository.js";
import { createContentSuggestionOAuthTokenVerifier } from "./contentSuggestionOAuth.js";

const runtimeConfig = loadApiRuntimeConfig();
const port = Number(process.env.PORT ?? 4000);
const host = resolveServerHost();
const pool = createPool(runtimeConfig.db);
const aiContentPool = runtimeConfig.aiContentDatabaseUrlFile
  ? createPoolForUrl(
      readDatabaseUrlSecret(runtimeConfig.aiContentDatabaseUrlFile),
      runtimeConfig.db,
    )
  : pool;
if (runtimeConfig.aiContentDatabaseUrlFile) {
  await assertDatabaseIdentity(aiContentPool, "content_application");
}
const blobReadWriteToken = process.env.BLOB_READ_WRITE_TOKEN ?? "";
const repository = createRepository(pool, {
  aiContentPool,
  instagramPublish: {
    enabled: runtimeConfig.instagramPublishEnabled,
  },
  faqMatching: runtimeConfig.faqMatching,
  faqMatchTelemetry: (event) => console.info(event.event, event),
});
const ownedBlobPath = (value: string) => {
  const normalized = value.trim();
  if (
    !normalized
    || /^https?:\/\//i.test(normalized)
    || /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)
    || normalized.startsWith("/")
    || normalized.includes("\\")
    || normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("RESOURCE_NOT_AVAILABLE");
  }
  return normalized;
};
const snapshotStorage: AiContentSnapshotStorage = {
  async stat(storagePath) {
    const pathname = ownedBlobPath(storagePath);
    try {
      const metadata = await headBlob(pathname, {
        token: blobReadWriteToken,
        abortSignal: AbortSignal.timeout(15_000),
      });
      if (metadata.pathname !== pathname) throw new Error("RESOURCE_NOT_AVAILABLE");
      return {
        storageUrl: metadata.url,
        storagePath: metadata.pathname,
        sizeBytes: metadata.size,
      };
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  },
  async read(storagePath, { maxBytes }) {
    const pathname = ownedBlobPath(storagePath);
    const result = await getBlob(pathname, {
      token: blobReadWriteToken,
      access: "public",
      useCache: false,
      abortSignal: AbortSignal.timeout(15_000),
    });
    if (
      !result
      || result.statusCode !== 200
      || result.blob.pathname !== pathname
      || result.blob.size > maxBytes
    ) {
      throw new Error("RESOURCE_NOT_AVAILABLE");
    }
    return (async function* boundedOwnedBlob() {
      const reader = result.stream.getReader();
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            throw new Error("RESOURCE_NOT_AVAILABLE");
          }
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    })();
  },
  async put(storagePath, bytes, { contentType }) {
    const pathname = ownedBlobPath(storagePath);
    const stored = await putBlob(pathname, Buffer.from(bytes), {
      token: blobReadWriteToken,
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    if (stored.pathname !== pathname) throw new Error("RESOURCE_NOT_AVAILABLE");
    return { storageUrl: stored.url, storagePath: stored.pathname, sizeBytes: bytes.byteLength };
  },
};
const aiContentSnapshotBlob = createAiContentSnapshotBlob(snapshotStorage);
const aiContentSnapshotRepository = createAiContentSnapshotRepository(aiContentPool, aiContentSnapshotBlob);
const proposalV2Repository = createAiContentProposalV2Repository(aiContentPool);
const proposalV2Resolution = {
  async loadChannelCapability(scope: { brandId: string }, channel: Parameters<typeof buildChannelCapabilities>[0]["channels"][number]["channel"]) {
    const [channels, instagramSettings, instagramContext] = await Promise.all([
      repository.listChannels(scope.brandId),
      repository.listInstagramFormats(scope.brandId),
      repository.getInstagramChannelCapabilityContext(scope.brandId),
    ]);
    return buildChannelCapabilities({
      channels,
      instagramFormats: instagramSettings.formats,
      instagramContext,
    }).find((capability) => capability.channel === channel) ?? null;
  },
  resolveAiContentSeed: (seed: Parameters<typeof resolveAiContentSeed>[0]) => resolveAiContentSeed(seed, {
    crawlUrl: crawlSourceUrl,
    now: () => new Date(),
  }),
  now: () => new Date(),
};
const resolveProposalBaseInput = async (
  rawRequest: unknown,
  scope: { workspaceId: string; brandId: string },
  tx: Parameters<typeof createAiContentSnapshotRepository>[0],
) => {
  const request = parseContentOrchestrationV2(rawRequest);
  const resolved = await resolveContentProposalV2Input(
    request,
    scope,
    {
      ...proposalV2Resolution,
      snapshotRepository: createAiContentSnapshotRepository(tx, aiContentSnapshotBlob),
    },
  );
  return parseProposalBaseInputSnapshotV2(resolved.inputSnapshot);
};
const performanceProposalAdapter = createPerformanceProposalAdapter({
  loadSnapshots: (scope, tx) => loadPerformanceInsightSnapshots(tx, scope),
  resolveBaseInput: (request, scope, tx) => resolveProposalBaseInput(request, scope, tx),
});
const aiContentProposalV2Service = createAiContentProposalV2Service({
  ...proposalV2Repository,
  async assertReady() {
    if (!runtimeConfig.readiness.contentProposalsEnabled) {
      throw new Error("content_proposals_disabled");
    }
    const health = await repository.health().catch(() => null);
    if (health?.operations?.contentProposalWorker !== "online") {
      throw new Error("content_proposal_worker_not_ready");
    }
  },
  async resolve(command, tx) {
    if (command.source === "performance_experiment") {
      return performanceProposalAdapter.resolve(command, tx);
    }
    const request = parseContentOrchestrationV2(command.request);
    const baseInput = await resolveProposalBaseInput(
      request,
      { workspaceId: command.workspaceId, brandId: command.brandId },
      tx,
    );
    return {
      request: command.request,
      baseInput,
      sourceSnapshots: [],
    };
  },
});
const aiContentProposalV2 = {
  service: aiContentProposalV2Service,
  snapshotRepository: aiContentSnapshotRepository,
};
const adminRepository = createAdminRepository(pool);
const brandIntelligenceRepository = createBrandIntelligenceRepository(pool, {
  deleteBlobs: (urls) => deleteBlob(urls, { token: blobReadWriteToken }),
});
const brandLogoService = createBrandLogoService({
  storage: createSupabaseBrandLogoStorage(),
  store: createPostgresBrandLogoStore(pool, (brandId) => repository.getBrandProfile(brandId))
});
const contentSuggestionRepository = createContentSuggestionRepository(pool);
const serverOptions: Parameters<typeof createServer>[0] & {
  runtimePolicy: typeof runtimeConfig.http;
} = {
    runtimePolicy: runtimeConfig.http,
    readinessPolicy: runtimeConfig.readiness,
    repository,
    contentSuggestions: {
      repository: contentSuggestionRepository,
      ...(runtimeConfig.contentSuggestionOAuth ? {
        oauth: {
          config: runtimeConfig.contentSuggestionOAuth,
          verifier: createContentSuggestionOAuthTokenVerifier(
            runtimeConfig.contentSuggestionOAuth,
          ),
        },
      } : {}),
    },
    aiContentProposalV2,
    brandLogoService,
    workerApiToken: process.env.WORKER_API_TOKEN,
    contentProposalWorkerApiToken: process.env.CONTENT_PROPOSAL_WORKER_API_TOKEN,
    cronSecret: process.env.CRON_SECRET,
    kakaoAuth: createKakaoAuthStore(pool),
    kakao: {
      restApiKey: process.env.KAKAO_REST_API_KEY ?? "",
      clientSecret: process.env.KAKAO_CLIENT_SECRET,
      redirectUri: process.env.KAKAO_REDIRECT_URI ?? "",
      frontendUrl: process.env.AUTH_FRONTEND_URL ?? "http://localhost:5173"
    },
    instagramLogin: {
      appId: process.env.META_INSTAGRAM_APP_ID ?? process.env.META_APP_ID ?? "",
      appSecret: process.env.META_INSTAGRAM_APP_SECRET ?? process.env.META_APP_SECRET ?? "",
      redirectUri: process.env.META_OAUTH_REDIRECT_URI ?? "",
      frontendUrl: process.env.AUTH_FRONTEND_URL ?? "http://localhost:5173"
    },
    facebookLogin: {
      appId: process.env.META_APP_ID ?? "",
      appSecret: process.env.META_APP_SECRET ?? "",
      redirectUri: process.env.META_TRENDS_OAUTH_REDIRECT_URI
        ?? "http://localhost:4000/auth/meta/trends/callback",
      frontendUrl: process.env.AUTH_FRONTEND_URL ?? "http://localhost:5173"
    },
    metaWebhook: {
      appSecrets: [process.env.META_APP_SECRET ?? "", process.env.META_INSTAGRAM_APP_SECRET ?? ""],
      verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? ""
    },
    aiContentUpload: {
      readWriteToken: blobReadWriteToken,
      uploadSessionsEnabled: runtimeConfig.aiContentAttachmentUploadSessionsEnabled,
    },
    aiContentAttachmentGc: {
      deleteBlob: (urlOrPath, { abortSignal }) =>
        deleteBlob(urlOrPath, { token: blobReadWriteToken, abortSignal }),
    },
    assetLibraryUpload: {
      readWriteToken: blobReadWriteToken
    },
    aiContentLimits: {
      dailyGenerationLimit: Number(process.env.AI_CONTENT_DAILY_GENERATION_LIMIT ?? 10),
      dailyDownloadLimit: Number(process.env.AI_CONTENT_DAILY_DOWNLOAD_LIMIT ?? 20)
    },
    brandIntelligenceRepository,
    brandAnalysisUpload: {
      readWriteToken: blobReadWriteToken,
    },
    subjectAnalysis: {
      archiveImage: blobReadWriteToken
        ? async (image) => {
            const extension = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType.split("/")[1] ?? "bin";
            const pathname = `brands/${image.brandId}/subject-analyses/${image.analysisId}/${image.index}.${extension}`;
            const uploaded = await putBlob(pathname, Buffer.from(image.data), {
              access: "public",
              token: blobReadWriteToken,
              contentType: image.mimeType,
              addRandomSuffix: false,
            });
            return { storageUrl: uploaded.url, storagePath: uploaded.pathname };
          }
        : undefined,
    }
  };
const app = createServer(
  serverOptions,
  Fastify(createFastifyOptions())
);
registerAdminRoutes(app, {
  repository: adminRepository,
  serviceToken: process.env.ADMIN_SERVICE_TOKEN ?? ""
});
const serverlessHandler = createServerlessHandler(app);

if (!process.env.VERCEL) {
  const shutdown = createShutdown(app, {
    async end() {
      await Promise.all(aiContentPool === pool
        ? [pool.end()]
        : [pool.end(), aiContentPool.end()]);
    },
  });
  const handleShutdown = (signal: NodeJS.Signals) => {
    void shutdown(signal).catch(() => {
      logShutdownFailure(app.log, signal);
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", () => handleShutdown("SIGTERM"));
  process.once("SIGINT", () => handleShutdown("SIGINT"));

  try {
    await app.listen({ port, host });
    if (runtimeConfig.schedulerEnabled) {
      startLocalScheduler(repository);
    console.log("모종 local scheduler enabled");
    }
  console.log(`모종 API listening on http://${host}:${port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

export default serverlessHandler;
