FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY . .
RUN npm ci
RUN ./node_modules/.bin/tsc -p workers/brand-pilot-content-proposal-worker/tsconfig.json --noEmit false
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/workers/brand-pilot-content-proposal-worker/package.json ./workers/brand-pilot-content-proposal-worker/package.json
COPY --from=build --chown=node:node /app/workers/brand-pilot-content-proposal-worker/dist ./workers/brand-pilot-content-proposal-worker/dist

USER node
CMD ["node", "workers/brand-pilot-content-proposal-worker/dist/main.js", "watch"]
