FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @brand-pilot/content-proposal-worker
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    CODEX_HOME=/codex
RUN apt-get update \
    && apt-get install --yes --no-install-recommends bubblewrap ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --omit=dev @openai/codex@0.145.0 \
    && ln -s /usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-resources/bwrap /usr/local/bin/bwrap \
    && mkdir --parents /codex \
    && chown node:node /codex
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/brand-pilot-content-contracts/package.json ./packages/brand-pilot-content-contracts/package.json
COPY --from=build --chown=node:node /app/packages/brand-pilot-content-contracts/dist ./packages/brand-pilot-content-contracts/dist
COPY --from=build --chown=node:node /app/packages/brand-pilot-content-contracts/generated ./packages/brand-pilot-content-contracts/generated
COPY --from=build --chown=node:node /app/workers/brand-pilot-worker-runtime/package.json ./workers/brand-pilot-worker-runtime/package.json
COPY --from=build --chown=node:node /app/workers/brand-pilot-worker-runtime/dist ./workers/brand-pilot-worker-runtime/dist
COPY --from=build --chown=node:node /app/workers/brand-pilot-content-proposal-worker/package.json ./workers/brand-pilot-content-proposal-worker/package.json
COPY --from=build --chown=node:node /app/workers/brand-pilot-content-proposal-worker/dist ./workers/brand-pilot-content-proposal-worker/dist

USER node
CMD ["node", "workers/brand-pilot-content-proposal-worker/dist/main.js", "watch"]
