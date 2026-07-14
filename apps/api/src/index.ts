import "dotenv/config";
import Fastify from "fastify";
import { createPool } from "./db.js";
import { createRepository } from "./repository.js";
import { resolveServerHost } from "./runtime.js";
import { createFastifyOptions, createServer } from "./httpServer.js";
import { createServerlessHandler } from "./serverlessHandler.js";
import { createKakaoAuthStore } from "./kakaoAuth.js";
import { startLocalScheduler } from "./scheduler.js";

const port = Number(process.env.PORT ?? 4000);
const host = resolveServerHost();
const pool = createPool();
const app = createServer(
  {
    repository: createRepository(pool),
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
    }
  },
  Fastify(createFastifyOptions())
);
const serverlessHandler = createServerlessHandler(app);

if (!process.env.VERCEL) {
  try {
    await app.listen({ port, host });
    if (process.env.LOCAL_SCHEDULER_ENABLED === "true") {
      startLocalScheduler(createRepository(pool));
      console.log("Brand Pilot local scheduler enabled");
    }
    console.log(`Brand Pilot API listening on http://${host}:${port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

export default serverlessHandler;
