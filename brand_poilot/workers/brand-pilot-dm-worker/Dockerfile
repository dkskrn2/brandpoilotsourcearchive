FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY . .
RUN npm ci
RUN ./node_modules/.bin/tsc -p workers/brand-pilot-dm-worker/tsconfig.json --noEmit false
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    CODEX_HOME=/tmp/codex
RUN npm install --global --omit=dev @openai/codex@0.145.0
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/workers/brand-pilot-dm-worker/package.json ./workers/brand-pilot-dm-worker/package.json
COPY --from=build --chown=node:node /app/workers/brand-pilot-dm-worker/dist ./workers/brand-pilot-dm-worker/dist
COPY --from=build --chown=node:node /app/workers/brand-pilot-dm-worker/runtime ./workers/brand-pilot-dm-worker/runtime

USER node
CMD ["node", "workers/brand-pilot-dm-worker/dist/index.js", "watch"]
