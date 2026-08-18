FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @brand-pilot/worker-runtime \
    && npm run build --workspace @brand-pilot/card-news-worker
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    CODEX_HOME=/codex-accounts/primary \
    CODEX_ACCOUNT_POOL_ROOT=/codex-accounts \
    CODEX_ACCOUNT_PROFILES=primary,secondary
RUN apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --omit=dev @openai/codex@0.145.0 \
    && ln -s /usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-resources/bwrap /usr/local/bin/bwrap \
    && mkdir -p /codex-accounts/primary /codex-accounts/secondary \
    && chown -R node:node /codex-accounts

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/brand-pilot-content-contracts/package.json ./packages/brand-pilot-content-contracts/package.json
COPY --from=build --chown=node:node /app/packages/brand-pilot-content-contracts/dist ./packages/brand-pilot-content-contracts/dist
COPY --from=build --chown=node:node /app/packages/brand-pilot-content-contracts/generated ./packages/brand-pilot-content-contracts/generated
COPY --from=build --chown=node:node /app/workers/brand-pilot-worker-runtime/package.json ./workers/brand-pilot-worker-runtime/package.json
COPY --from=build --chown=node:node /app/workers/brand-pilot-worker-runtime/dist ./workers/brand-pilot-worker-runtime/dist
COPY --from=build --chown=node:node /app/workers/brand-pilot-card-news-worker/package.json ./workers/brand-pilot-card-news-worker/package.json
COPY --from=build --chown=node:node /app/workers/brand-pilot-card-news-worker/dist ./workers/brand-pilot-card-news-worker/dist
COPY --from=build --chown=node:node /app/workers/brand-pilot-card-news-worker/scripts/codex-runtime.mjs ./workers/brand-pilot-card-news-worker/scripts/codex-runtime.mjs
COPY --from=build --chown=node:node /app/workers/brand-pilot-card-news-worker/scripts/run-codex-card-manuscript-plan.mjs ./workers/brand-pilot-card-news-worker/scripts/run-codex-card-manuscript-plan.mjs
COPY --from=build --chown=node:node /app/workers/brand-pilot-card-news-worker/scripts/card-manuscript-plan-v1.schema.json ./workers/brand-pilot-card-news-worker/scripts/card-manuscript-plan-v1.schema.json
COPY --from=build --chown=node:node /app/workers/brand-pilot-card-news-worker/.agents/skills/card-news-creator/SKILL.md ./workers/brand-pilot-card-news-worker/.agents/skills/card-news-creator/SKILL.md

WORKDIR /app/workers/brand-pilot-card-news-worker
USER node
CMD ["node", "/app/workers/brand-pilot-card-news-worker/dist/index.js", "watch"]
