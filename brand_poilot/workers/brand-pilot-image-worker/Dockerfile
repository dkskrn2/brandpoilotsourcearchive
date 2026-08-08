FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @brand-pilot/image-worker
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    CODEX_HOME=/codex-accounts/primary \
    CODEX_ACCOUNT_POOL_ROOT=/codex-accounts \
    CODEX_ACCOUNT_PROFILES=primary,secondary \
    CODEX_GENERATED_IMAGES_DIR=/codex-accounts/primary/generated_images \
    PYTHON=python3 \
    IMAGE_RENDER_COMMAND="node /app/workers/brand-pilot-image-worker/scripts/run-codex-image-render.mjs --job \"{{jobFile}}\" --output \"{{outputDir}}\" --workspace \"{{workspaceDir}}\""
RUN apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap ca-certificates python3 ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --omit=dev @openai/codex@0.145.0 \
    && ln -s /usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-resources/bwrap /usr/local/bin/bwrap \
    && mkdir -p /codex-accounts/primary/generated_images /codex-accounts/secondary/generated_images \
    && chown -R node:node /codex-accounts

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/brand-pilot-content-contracts/package.json ./packages/brand-pilot-content-contracts/package.json
COPY --from=build --chown=node:node /app/packages/brand-pilot-content-contracts/dist ./packages/brand-pilot-content-contracts/dist
COPY --from=build --chown=node:node /app/workers/brand-pilot-worker-runtime/package.json ./workers/brand-pilot-worker-runtime/package.json
COPY --from=build --chown=node:node /app/workers/brand-pilot-worker-runtime/dist ./workers/brand-pilot-worker-runtime/dist
COPY --from=build --chown=node:node /app/workers/brand-pilot-image-worker/package.json ./workers/brand-pilot-image-worker/package.json
COPY --from=build --chown=node:node /app/workers/brand-pilot-image-worker/dist ./workers/brand-pilot-image-worker/dist
COPY --from=build --chown=node:node /app/workers/brand-pilot-image-worker/scripts/run-codex-image-render.mjs ./workers/brand-pilot-image-worker/scripts/run-codex-image-render.mjs
COPY --from=build --chown=node:node /app/workers/brand-pilot-image-worker/scripts/run-codex-ai-content-asset.mjs ./workers/brand-pilot-image-worker/scripts/run-codex-ai-content-asset.mjs
COPY --from=build --chown=node:node /app/workers/brand-pilot-image-worker/scripts/render-reel.py ./workers/brand-pilot-image-worker/scripts/render-reel.py
COPY --from=build --chown=node:node /app/workers/brand-pilot-image-worker/AGENTS.md ./workers/brand-pilot-image-worker/AGENTS.md
COPY --from=build --chown=node:node /app/workers/brand-pilot-image-worker/.codex/skills/image-render/SKILL.md ./workers/brand-pilot-image-worker/.codex/skills/image-render/SKILL.md
COPY --from=build --chown=node:node /app/workers/brand-pilot-image-worker/.codex/skills/threads-text/SKILL.md ./workers/brand-pilot-image-worker/.codex/skills/threads-text/SKILL.md

USER node
CMD ["node", "workers/brand-pilot-image-worker/dist/index.js", "watch"]
