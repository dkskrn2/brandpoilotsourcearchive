FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @brand-pilot/worker-runtime \
    && npm run build --workspace @brand-pilot/blog-worker
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    CODEX_HOME=/codex
RUN apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --omit=dev @openai/codex@0.145.0 \
    && mkdir -p /codex \
    && chown node:node /codex

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/workers/brand-pilot-worker-runtime/package.json ./workers/brand-pilot-worker-runtime/package.json
COPY --from=build --chown=node:node /app/workers/brand-pilot-worker-runtime/dist ./workers/brand-pilot-worker-runtime/dist
COPY --from=build --chown=node:node /app/workers/brand-pilot-blog-worker/package.json ./workers/brand-pilot-blog-worker/package.json
COPY --from=build --chown=node:node /app/workers/brand-pilot-blog-worker/dist ./workers/brand-pilot-blog-worker/dist
COPY --from=build --chown=node:node /app/workers/brand-pilot-blog-worker/scripts/run-codex-blog.mjs ./workers/brand-pilot-blog-worker/scripts/run-codex-blog.mjs
COPY --from=build --chown=node:node /app/workers/brand-pilot-blog-worker/.agents/skills/blog-writer/SKILL.md ./workers/brand-pilot-blog-worker/.agents/skills/blog-writer/SKILL.md

WORKDIR /app/workers/brand-pilot-blog-worker
USER node
CMD ["node", "/app/workers/brand-pilot-blog-worker/dist/index.js", "watch"]
