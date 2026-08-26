FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --chown=node:node workers/brand-pilot-publish-scheduler/src ./src

USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "src/healthcheck.mjs"]
CMD ["node", "src/index.mjs"]
