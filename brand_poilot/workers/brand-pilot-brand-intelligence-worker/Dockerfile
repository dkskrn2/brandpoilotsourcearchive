FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @brand-pilot/brand-intelligence-worker
RUN npm prune --omit=dev --workspaces

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    CODEX_HOME=/codex \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update \
    && apt-get install --yes --no-install-recommends bubblewrap ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --omit=dev @openai/codex@0.145.0 \
    && ln -s /usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-resources/bwrap /usr/local/bin/bwrap \
    && mkdir --parents /codex \
    && chown node:node /codex
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/workers/brand-pilot-worker-runtime/package.json ./workers/brand-pilot-worker-runtime/package.json
COPY --from=build --chown=node:node /app/workers/brand-pilot-worker-runtime/dist ./workers/brand-pilot-worker-runtime/dist
COPY --from=build --chown=node:node /app/workers/brand-pilot-brand-intelligence-worker/package.json ./workers/brand-pilot-brand-intelligence-worker/package.json
COPY --from=build --chown=node:node /app/workers/brand-pilot-brand-intelligence-worker/dist ./workers/brand-pilot-brand-intelligence-worker/dist
COPY --from=build --chown=node:node /app/workers/brand-pilot-brand-intelligence-worker/scripts/codex-output.mjs ./workers/brand-pilot-brand-intelligence-worker/scripts/codex-output.mjs
COPY --from=build --chown=node:node /app/workers/brand-pilot-brand-intelligence-worker/scripts/run-codex-brand-intelligence.mjs ./workers/brand-pilot-brand-intelligence-worker/scripts/run-codex-brand-intelligence.mjs
COPY --from=build --chown=node:node /app/workers/brand-pilot-brand-intelligence-worker/.agents/skills/brand-intelligence/SKILL.md ./workers/brand-pilot-brand-intelligence-worker/.agents/skills/brand-intelligence/SKILL.md
RUN node node_modules/playwright/cli.js install --with-deps chromium \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /var/lib/apt/lists/*

USER node
CMD ["node", "workers/brand-pilot-brand-intelligence-worker/dist/index.js", "watch"]
