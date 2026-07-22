import "dotenv/config";
import Fastify from "fastify";
import { del as deleteBlob, put as putBlob } from "@vercel/blob";
import { createPool } from "./db.js";
import { createRepository } from "./repository.js";
import { resolveServerHost } from "./runtime.js";
import { createFastifyOptions, createServer } from "./httpServer.js";
import { createServerlessHandler } from "./serverlessHandler.js";
import { createKakaoAuthStore } from "./kakaoAuth.js";
import { startLocalScheduler } from "./scheduler.js";
import { createBrandLogoService, createPostgresBrandLogoStore, createSupabaseBrandLogoStorage } from "./brandLogo.js";
import { createAdminRepository } from "./adminRepository.js";
import { registerAdminRoutes } from "./adminServer.js";
import { createBrandIntelligenceRepository } from "./brandIntelligenceRepository.js";

const port = Number(process.env.PORT ?? 4000);
const host = resolveServerHost();
const pool = createPool();
const blobReadWriteToken = process.env.BLOB_READ_WRITE_TOKEN ?? "";
const repository = createRepository(pool, {
  deleteAiContentAttachments: blobReadWriteToken
    ? (urls) => deleteBlob(urls, { token: blobReadWriteToken })
    : undefined,
});
const adminRepository = createAdminRepository(pool);
const brandIntelligenceRepository = createBrandIntelligenceRepository(pool);
const brandLogoService = createBrandLogoService({
  storage: createSupabaseBrandLogoStorage(),
  store: createPostgresBrandLogoStore(pool, (brandId) => repository.getBrandProfile(brandId))
});
const app = createServer(
  {
    repository,
    brandLogoService,
    workerApiToken: process.env.WORKER_API_TOKEN,
    cronSecret: process.env.CRON_SECRET,
    kakaoAuth: createKakaoAuthStore(pool),
    kakao: {
      restApiKey: process.env.KAKAO_REST_API_KEY ?? "",
      clientSecret: process.env.KAKAO_CLIENT_SECRET,
      redirectUri: process.env.KAKAO_REDIRECT_URI ?? "",
      frontendUrl: process.env.AUTH_FRONTEND_URL ?? "http://localhost:5173"
    },
    instagramLogin: {
      appId: process.env.META_APP_ID ?? "",
      appSecret: process.env.META_APP_SECRET ?? "",
      redirectUri: process.env.META_OAUTH_REDIRECT_URI ?? "",
      frontendUrl: process.env.AUTH_FRONTEND_URL ?? "http://localhost:5173"
    },
    facebookLogin: {
      appId: process.env.META_APP_ID ?? "",
      appSecret: process.env.META_APP_SECRET ?? "",
      redirectUri: process.env.META_TRENDS_OAUTH_REDIRECT_URI
        ?? (process.env.VERCEL ? "" : "http://localhost:4000/auth/meta/trends/callback"),
      frontendUrl: process.env.AUTH_FRONTEND_URL ?? "http://localhost:5173"
    },
    metaWebhook: {
      appSecret: process.env.META_APP_SECRET ?? "",
      verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? ""
    },
    aiContentUpload: {
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
  },
  Fastify(createFastifyOptions())
);
registerAdminRoutes(app, {
  repository: adminRepository,
  serviceToken: process.env.ADMIN_SERVICE_TOKEN ?? ""
});
const serverlessHandler = createServerlessHandler(app);

if (!process.env.VERCEL) {
  try {
    await app.listen({ port, host });
    if (process.env.LOCAL_SCHEDULER_ENABLED === "true") {
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
