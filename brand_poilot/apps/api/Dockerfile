FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @brand-pilot/worker-runtime \
    && npm run build --workspace @brand-pilot/api
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/packages/brand-pilot-content-contracts/package.json ./packages/brand-pilot-content-contracts/package.json
COPY --from=build --chown=node:node /app/packages/brand-pilot-content-contracts/dist ./packages/brand-pilot-content-contracts/dist
COPY --from=build --chown=node:node /app/packages/brand-pilot-content-contracts/generated ./packages/brand-pilot-content-contracts/generated
COPY --from=build --chown=node:node /app/db/migrations ./db/migrations
COPY --from=build --chown=node:node /app/scripts/migrationRunner.mjs ./scripts/migrationRunner.mjs
COPY --from=build --chown=node:node /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build --chown=node:node /app/scripts/databaseTls.mjs ./scripts/databaseTls.mjs
COPY --from=build --chown=node:node /app/scripts/ai-content-cutover-control.mjs ./scripts/ai-content-cutover-control.mjs
COPY --from=build --chown=node:node /app/scripts/ai-content-cutover-floor-probe.mjs ./scripts/ai-content-cutover-floor-probe.mjs
COPY --from=build --chown=node:node /app/scripts/ai-content-cutover-evidence.mjs ./scripts/ai-content-cutover-evidence.mjs
COPY --from=build --chown=node:node /app/scripts/ai-content-database-catalog.mjs ./scripts/ai-content-database-catalog.mjs
COPY --from=build --chown=node:node /app/scripts/ai-content-database-roles.mjs ./scripts/ai-content-database-roles.mjs
COPY --from=build --chown=node:node /app/scripts/ai-content-provider-artifacts.mjs ./scripts/ai-content-provider-artifacts.mjs
COPY --from=build --chown=node:node /app/scripts/collect-ai-content-prepare-evidence.mjs ./scripts/collect-ai-content-prepare-evidence.mjs
RUN chmod -R a+rX /app

USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 CMD ["node", "-e", "fetch('http://127.0.0.1:4000/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/api/dist/index.js"]
