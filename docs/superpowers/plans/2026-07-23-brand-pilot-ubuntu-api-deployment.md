# Brand Pilot Ubuntu API Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Publish one tested, immutable Brand Pilot API image and deploy it behind Caddy on Ubuntu with a canary, deterministic rollback, and a DNS-only production cutover.

**Architecture:** GitHub Actions builds the API once for linux/amd64, pushes it to GHCR, and emits a release manifest containing exact image digests. Ubuntu never builds application source; it checks out only the matching deployment configuration, validates host and secret contracts, pulls the manifest images, and exposes only Caddy on TCP 80/443. The existing Vercel API remains the production and rollback target until the Ubuntu canary and production smoke gates pass.

**Tech Stack:** GitHub Actions, GHCR, Docker Buildx, Docker Compose, Caddy, Ubuntu 24.04 LTS, Tailscale, OpenSSH, Bash.

---

## Scope and release rule

This plan starts only after every gate in 2026-07-23-brand-pilot-repository-and-api-hardening.md passes. It deploys Caddy and the API only. It does not run db:migrate, move Supabase data, enable LOCAL_SCHEDULER_ENABLED, enable INSTAGRAM_PUBLISH_ENABLED, expose port 4000, start DM/Wiki workers, or delete the Vercel API.

The commits are:

1. test: define API deployment contracts
2. build: add the production API image
3. ops: add Caddy and API-only Compose
4. ops: add preflight deploy and rollback scripts
5. ci: publish digest-pinned API releases
6. docs: add Ubuntu bootstrap and cutover runbook

### Task 1: Define deployment contracts before artifacts

**Files:**
- Create: brand_poilot/scripts/deployment-contract.test.mjs
- Modify: brand_poilot/package.json

**Working directory:** brand_poilot

- [ ] **Step 1: Write the failing file-contract test**

Create deployment-contract.test.mjs:

~~~javascript
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("production deployment artifacts exist", () => {
  for (const path of [
    ".dockerignore",
    "apps/api/Dockerfile",
    "deploy/compose.production.yml",
    "deploy/Caddyfile",
    "deploy/release.env.example",
    "deploy/env/api.env.example",
    "deploy/scripts/preflight.sh",
    "deploy/scripts/deploy.sh",
    "deploy/scripts/rollback.sh",
  ]) {
    assert.ok(existsSync(path), path);
  }
});

test("only Caddy publishes host ports", () => {
  const compose = read("deploy/compose.production.yml");
  const apiBlock = compose.slice(
    compose.indexOf("  api:"),
    compose.indexOf("  caddy:"),
  );
  assert.doesNotMatch(apiBlock, /\n\s+ports:/);
  assert.match(apiBlock, /LOCAL_SCHEDULER_ENABLED:\s*"false"/);
  assert.match(apiBlock, /INSTAGRAM_PUBLISH_ENABLED:\s*"false"/);
  assert.match(compose, /"80:80"/);
  assert.match(compose, /"443:443"/);
});

test("release images are digest pinned and Caddy checks readiness", () => {
  const compose = read("deploy/compose.production.yml");
  const caddy = read("deploy/Caddyfile");
  assert.match(compose, /API_IMAGE:\?API_IMAGE/);
  assert.match(compose, /CADDY_IMAGE:\?CADDY_IMAGE/);
  assert.match(compose, /CANARY_HOST:\?CANARY_HOST/);
  assert.match(compose, /PRIMARY_HOST:\?PRIMARY_HOST/);
  assert.match(caddy, /\{\$CANARY_HOST\}, \{\$PRIMARY_HOST\}/);
  assert.match(caddy, /\/ready/);
  assert.doesNotMatch(caddy, /\blog\s*\{/);
});

test("deployment scripts never enable shell tracing", () => {
  for (const path of [
    "deploy/scripts/preflight.sh",
    "deploy/scripts/deploy.sh",
    "deploy/scripts/rollback.sh",
  ]) {
    assert.doesNotMatch(read(path), /set\s+-[^\n]*x/);
  }
});
~~~

- [ ] **Step 2: Add the package script**

~~~json
"test:deployment": "node --test scripts/deployment-contract.test.mjs"
~~~

- [ ] **Step 3: Run and verify failure**

~~~powershell
npm run test:deployment
~~~

Expected: failure lists the missing deployment files.

- [ ] **Step 4: Commit the red deployment contract**

~~~powershell
git add scripts/deployment-contract.test.mjs package.json
git commit -m "test: define API deployment contracts"
~~~

Expected: the commit contains only the failing contract and its package script. It is allowed to be red until Tasks 2–4 add the named artifacts.

### Task 2: Build a production API image and graceful shutdown

**Files:**
- Create: brand_poilot/.dockerignore
- Create: brand_poilot/apps/api/Dockerfile
- Create: brand_poilot/apps/api/src/shutdown.ts
- Create: brand_poilot/apps/api/src/shutdown.test.ts
- Modify: brand_poilot/apps/api/src/index.ts

**Working directory:** brand_poilot

- [ ] **Step 1: Write the shutdown unit test**

~~~typescript
import { describe, expect, it, vi } from "vitest";
import { createShutdown } from "./shutdown";

describe("createShutdown", () => {
  it("closes Fastify and the pool once", async () => {
    const app = { close: vi.fn(async () => undefined) };
    const pool = { end: vi.fn(async () => undefined) };
    const shutdown = createShutdown(app, pool);
    await Promise.all([shutdown("SIGTERM"), shutdown("SIGTERM")]);
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
~~~

- [ ] **Step 2: Implement idempotent shutdown**

~~~typescript
export function createShutdown(
  app: { close(): Promise<unknown> },
  pool: { end(): Promise<unknown> },
) {
  let pending: Promise<void> | undefined;
  return (signal: NodeJS.Signals) => {
    pending ??= (async () => {
      console.info("api_shutdown_started", { signal });
      await app.close();
      await pool.end();
      console.info("api_shutdown_completed", { signal });
    })();
    return pending;
  };
}
~~~

In index.ts, register handlers only in the non-Vercel server branch:

~~~typescript
const shutdown = createShutdown(app, pool);
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
~~~

- [ ] **Step 3: Add the Docker ignore contract**

Create .dockerignore:

~~~text
**/.env
**/.env.*
!**/.env.example
**/node_modules
**/dist
**/.vercel
**/.git
**/coverage
**/playwright-report
**/test-results
**/*.log
pnpm-lock.yaml
docs/prototypes
~~~

Do not exclude package.json, package-lock.json, TypeScript sources, or workspace package manifests.

- [ ] **Step 4: Add the multi-stage API Dockerfile**

~~~dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build --workspace @brand-pilot/api
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 CMD ["node", "-e", "fetch('http://127.0.0.1:4000/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/api/dist/index.js"]
~~~

No secret or real .env is copied into either stage.

- [ ] **Step 5: Run unit, build, and image checks**

~~~powershell
npm exec --workspace @brand-pilot/api -- vitest run src/shutdown.test.ts --maxWorkers=1
npm run build --workspace @brand-pilot/api
docker build --platform linux/amd64 -f apps/api/Dockerfile -t brand-pilot-api:local .
docker image inspect brand-pilot-api:local --format '{{.Config.User}}'
~~~

Expected: tests/build pass and the image user is node.

- [ ] **Step 6: Commit**

~~~powershell
git add .dockerignore apps/api/Dockerfile apps/api/src/shutdown.ts apps/api/src/shutdown.test.ts apps/api/src/index.ts
git commit -m "build: add the production API image"
~~~

### Task 3: Add API-only Compose, Caddy, and environment contracts

**Files:**
- Create: brand_poilot/deploy/compose.production.yml
- Create: brand_poilot/deploy/Caddyfile
- Create: brand_poilot/deploy/caddy-image.env
- Create: brand_poilot/deploy/release.env.example
- Create: brand_poilot/deploy/env/api.env.example

**Working directory:** brand_poilot

- [ ] **Step 1: Resolve and record the Caddy digest**

Run:

~~~powershell
$caddyDigest = docker buildx imagetools inspect caddy:2.11.4-alpine --format '{{json .Manifest.Digest}}' | ConvertFrom-Json
$caddyDigest
~~~

Expected: sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648. Create caddy-image.env with this immutable multi-platform manifest value:

~~~dotenv
CADDY_IMAGE=docker.io/library/caddy@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648
~~~

Re-run the inspect command during implementation. If the immutable version tag resolves to a different digest, stop and investigate rather than silently accepting the change.

- [ ] **Step 2: Create the production Compose file**

~~~yaml
name: brand-pilot

services:
  api:
    image: ${API_IMAGE:?API_IMAGE is required}
    env_file:
      - ${API_ENV_FILE:-/opt/brand-pilot/shared/env/api.env}
    environment:
      LOCAL_SCHEDULER_ENABLED: "false"
      INSTAGRAM_PUBLISH_ENABLED: "false"
    restart: unless-stopped
    init: true
    read_only: true
    tmpfs:
      - /tmp:size=64m,mode=1777
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    expose:
      - "4000"
    stop_grace_period: 30s
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4000/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      start_period: 20s
      retries: 4
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "5"

  caddy:
    image: ${CADDY_IMAGE:?CADDY_IMAGE is required}
    environment:
      CANARY_HOST: ${CANARY_HOST:?CANARY_HOST is required}
      PRIMARY_HOST: ${PRIMARY_HOST:?PRIMARY_HOST is required}
      ACME_EMAIL: ${ACME_EMAIL:?ACME_EMAIL is required}
    restart: unless-stopped
    depends_on:
      api:
        condition: service_healthy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "5"

volumes:
  caddy_data:
  caddy_config:
~~~

Only Caddy has ports. API port 4000 is reachable only on the Compose network.

- [ ] **Step 3: Create the Caddyfile**

~~~caddyfile
{$CANARY_HOST}, {$PRIMARY_HOST} {
  tls {$ACME_EMAIL}
  encode zstd gzip
  reverse_proxy api:4000 {
    health_uri /ready
    health_interval 10s
    health_timeout 3s
  }
}
~~~

Do not enable access logging during the migration because OAuth query strings must not be copied into general logs.

- [ ] **Step 4: Create non-secret manifest and secret-template contracts**

release.env.example:

~~~dotenv
RELEASE_SCHEMA=1
RELEASE_SHA=required-at-deploy-time
API_IMAGE=required-at-deploy-time
CADDY_IMAGE=required-at-deploy-time
CANARY_HOST=canary-api.danbammsg.co.kr
PRIMARY_HOST=api.danbammsg.co.kr
ACME_EMAIL=ops@danbammsg.co.kr
API_ENV_FILE=/opt/brand-pilot/shared/env/api.env
~~~

api.env.example contains the complete variable names but safe sentinels only. Its enforced safety values are:

~~~dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=4000
COOKIE_SECURE=true
CORS_ALLOWED_ORIGINS=https://app.danbammsg.co.kr,https://www.danbammsg.co.kr
DEV_AUTH_ENABLED=false
LOCAL_SCHEDULER_ENABLED=false
INSTAGRAM_PUBLISH_ENABLED=false
DB_POOL_MAX=3
DB_POOL_IDLE_TIMEOUT_MS=10000
DB_POOL_CONNECTION_TIMEOUT_MS=10000
~~~

All secret values use required-at-deploy-time. No real credential enters Git.

- [ ] **Step 5: Run contract and Compose validation**

~~~powershell
$env:API_IMAGE = "ghcr.io/dkskrn2/main/brand-pilot-api@sha256:$('1' * 64)"
$env:CADDY_IMAGE = (Get-Content deploy/caddy-image.env).Split('=')[1]
$env:CANARY_HOST = "canary-api.danbammsg.co.kr"
$env:PRIMARY_HOST = "api.danbammsg.co.kr"
$env:ACME_EMAIL = "ops@danbammsg.co.kr"
$env:API_ENV_FILE = (Resolve-Path deploy/env/api.env.example)
docker compose -f deploy/compose.production.yml config --quiet
npm run test:deployment
~~~

Expected: both commands exit 0. Never run docker compose config without --quiet on a machine containing real env values.

- [ ] **Step 6: Commit**

~~~powershell
git add deploy
git commit -m "ops: add Caddy and API-only Compose"
~~~

### Task 4: Implement preflight, deploy, and rollback

**Files:**
- Create: brand_poilot/deploy/scripts/lib.sh
- Create: brand_poilot/deploy/scripts/preflight.sh
- Create: brand_poilot/deploy/scripts/deploy.sh
- Create: brand_poilot/deploy/scripts/verify-canary.sh
- Create: brand_poilot/deploy/scripts/promote.sh
- Create: brand_poilot/deploy/scripts/rollback.sh
- Modify: brand_poilot/scripts/deployment-contract.test.mjs

**Working directory:** brand_poilot

- [ ] **Step 1: Extend the failing deployment tests**

Assert that every script begins with strict mode, deploy and rollback use flock, deploy calls compose config --quiet before pull/up, image variables contain @sha256, and state/current plus state/previous are updated through temporary files followed by mv.

~~~javascript
for (const path of [
  "deploy/scripts/preflight.sh",
  "deploy/scripts/deploy.sh",
  "deploy/scripts/rollback.sh",
]) {
  assert.match(read(path), /^#!\/usr\/bin\/env bash\nset -Eeuo pipefail/m);
}
assert.match(read("deploy/scripts/deploy.sh"), /flock/);
assert.match(read("deploy/scripts/deploy.sh"), /config --quiet/);
assert.match(read("deploy/scripts/deploy.sh"), /@sha256:/);
assert.match(read("deploy/scripts/rollback.sh"), /flock/);
~~~

- [ ] **Step 2: Implement shared validation helpers**

lib.sh exports fail, require_command, require_file_mode_600, require_digest_image, wait_for_url, and atomic_write. The image validator is:

~~~bash
require_digest_image() {
  local value="$1"
  [[ "$value" =~ ^[a-zA-Z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] ||
    fail "image_must_be_digest_pinned"
}
~~~

atomic_write creates a file in the destination directory, chmods it, and renames it with mv so current/previous never contain partial content.

- [ ] **Step 3: Implement preflight fail-closed checks**

preflight.sh checks:

~~~text
Ubuntu VERSION_ID is 24.04
dpkg architecture is amd64
Docker and docker compose are usable
Compose version is at least 2.24
timedatectl reports System clock synchronized: yes
/opt/brand-pilot and /var/lib/docker have at least 10 GiB free
ports 80 and 443 are not owned by another stack
api.env exists, owner is bpdeploy, and mode is 600
scheduler and publication values are exactly false
release SHA is 40 lowercase hex characters
API and Caddy images are digest pinned
compose config --quiet passes
~~~

It prints key names and status only, never env values.

- [ ] **Step 4: Implement deploy ordering**

deploy.sh accepts a release.env path and --phase canary or production. Both immutable hostnames are always present in the manifest and Caddyfile; phase selects the URL used for acceptance and never rewrites the release manifest. Its order is fixed:

~~~text
acquire /opt/brand-pilot/state/deploy.lock with flock
verify release manifest mode/checksum/schema/SHA/digests
copy Compose, Caddyfile, scripts, and manifest into releases/$RELEASE_SHA
run preflight
run docker compose config --quiet
pull both images before changing containers
verify API OCI revision label equals RELEASE_SHA
start API and Caddy
poll the selected external /ready for at most 120 seconds
write state/candidate for canary
move current to previous and candidate to current only on promote --commit
if current exists, restore that complete release automatically on failure
if current does not exist, stop the failed candidate and leave Vercel production untouched
~~~

The script never evaluates the env file as shell code. It parses only an allowlisted KEY=VALUE manifest and rejects duplicate or unknown keys.

- [ ] **Step 5: Implement rollback**

rollback.sh supports --previous and --release RELEASE_SHA plus an explicit --phase canary|production. Both modes validate the selected release again, pull its exact digests, apply its Compose/Caddy/manifests, and wait for the phase URL. Canary mode preserves state/candidate and never writes state/current; production mode updates current only after readiness. The first-canary rehearsal uses --release with state/candidate because no previous production release exists yet. It does not modify the database or secrets.

- [ ] **Step 6: Run shell and contract checks**

~~~bash
shellcheck deploy/scripts/*.sh
npm run test:deployment
~~~

Expected: both exit 0. Also run a disposable local test that gives deploy.sh an invalid tag-only image and prove it stops before docker compose up.

- [ ] **Step 7: Commit**

~~~bash
git add deploy/scripts scripts/deployment-contract.test.mjs
git commit -m "ops: add preflight deploy and rollback scripts"
~~~

### Task 5: Publish immutable API releases from GitHub Actions

**Files:**
- Create: .github/workflows/publish-brand-pilot-server-images.yml

**Working directory:** repository root

- [ ] **Step 1: Add the workflow**

~~~yaml
name: Publish Brand Pilot server images

on:
  workflow_dispatch:
  push:
    branches: [main]
    paths:
      - "brand_poilot/**"
      - ".github/workflows/publish-brand-pilot-server-images.yml"

permissions:
  contents: read
  packages: write

env:
  REGISTRY: ghcr.io
  API_IMAGE_NAME: ${{ github.repository_owner }}/brand-pilot-api

jobs:
  verify-and-publish:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: brand_poilot/package-lock.json

      - name: Install
        working-directory: brand_poilot
        run: npm ci

      - name: Verify
        working-directory: brand_poilot
        run: |
          npm run test:contract
          node --test scripts/migrationRunner.test.mjs
          npm run test:migrations
          npm run test --workspace @brand-pilot/api
          npm run test --workspace @brand-pilot/dm-worker
          npm run build --workspace @brand-pilot/api
          shellcheck deploy/scripts/*.sh
          npm run test:deployment

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Compute image name
        id: image
        shell: bash
        run: echo "name=${REGISTRY}/${API_IMAGE_NAME,,}" >> "$GITHUB_OUTPUT"

      - name: Build and push API
        id: api
        uses: docker/build-push-action@v6
        with:
          context: brand_poilot
          file: brand_poilot/apps/api/Dockerfile
          platforms: linux/amd64
          push: true
          tags: ${{ steps.image.outputs.name }}:sha-${{ github.sha }}
          labels: |
            org.opencontainers.image.revision=${{ github.sha }}
            org.opencontainers.image.source=https://github.com/${{ github.repository }}

      - name: Create release manifest
        working-directory: brand_poilot
        shell: bash
        run: |
          source deploy/caddy-image.env
          {
            echo "RELEASE_SCHEMA=1"
            echo "RELEASE_SHA=${GITHUB_SHA}"
            echo "API_IMAGE=${{ steps.image.outputs.name }}@${{ steps.api.outputs.digest }}"
            echo "CADDY_IMAGE=${CADDY_IMAGE}"
            echo "CANARY_HOST=canary-api.danbammsg.co.kr"
            echo "PRIMARY_HOST=api.danbammsg.co.kr"
            echo "ACME_EMAIL=ops@danbammsg.co.kr"
            echo "API_ENV_FILE=/opt/brand-pilot/shared/env/api.env"
          } > release.env
          sha256sum release.env > release.env.sha256

      - uses: actions/upload-artifact@v4
        with:
          name: brand-pilot-api-release-${{ github.sha }}
          path: |
            brand_poilot/release.env
            brand_poilot/release.env.sha256
          if-no-files-found: error
          retention-days: 30
~~~

The workflow publishes images and an artifact but never logs into Ubuntu or deploys production automatically.

- [ ] **Step 2: Run a branch workflow and inspect the artifact**

Expected:

~~~text
all verify steps green
linux/amd64 image pushed
release.env API_IMAGE contains @sha256
OCI revision label equals the 40-character commit SHA
release.env contains no secret values
~~~

- [ ] **Step 3: Commit**

~~~powershell
git add .github/workflows/publish-brand-pilot-server-images.yml
git commit -m "ci: publish digest-pinned API releases"
~~~

### Task 6: Write and execute the Ubuntu bootstrap and cutover runbook

**Files:**
- Create: brand_poilot/docs/operations/UBUNTU_DEPLOYMENT.md
- Create: brand_poilot/deploy/scripts/bootstrap-ubuntu.sh

**Working directory:** brand_poilot for file changes; Ubuntu or Windows as explicitly labeled for operator commands.

- [ ] **Step 1: Document the stable-hostname preparation**

Before Ubuntu receives production traffic:

~~~text
attach api.danbammsg.co.kr to the current Vercel API
set VITE_API_BASE_URL=https://api.danbammsg.co.kr
set Kakao callback to https://api.danbammsg.co.kr/auth/kakao/callback
set Instagram callback to https://api.danbammsg.co.kr/auth/meta/callback
set trends callback to https://api.danbammsg.co.kr/auth/meta/trends/callback
set Meta webhook to https://api.danbammsg.co.kr/webhooks/meta/instagram
test all four paths while DNS still targets Vercel
~~~

This makes the final server move a DNS-target change rather than an application/configuration rewrite.

- [ ] **Step 2: Document one-time Tailscale and OpenSSH setup**

Ubuntu console:

~~~bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=brand-pilot-ubuntu
sudo adduser --disabled-password --gecos "" bpdeploy
sudo install -d -m 700 -o bpdeploy -g bpdeploy /home/bpdeploy/.ssh
~~~

Windows:

~~~powershell
ssh-keygen -t ed25519 -a 100 -f "$env:USERPROFILE\.ssh\brand-pilot-ubuntu" -C "brand-pilot-ubuntu"
~~~

After key login works, configure OpenSSH:

~~~text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers bpdeploy
~~~

Validate and reload before closing the current console:

~~~bash
sudo sshd -t
sudo systemctl reload ssh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
~~~

Compare that fingerprint with the first Windows SSH prompt. Then expose SSH only on tailscale0:

~~~bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0 to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
~~~

The router forwards only TCP 80/443 and never port 22.

- [ ] **Step 3: Install Docker from the official Ubuntu repository**

~~~bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" |
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker bpdeploy
~~~

Open a new bpdeploy SSH session so the group change applies, then verify:

~~~bash
docker version
docker compose version
docker run --rm hello-world
~~~

Membership in the docker group is root-equivalent; protect the SSH key accordingly.

- [ ] **Step 4: Bootstrap directories and permissions**

bootstrap-ubuntu.sh creates:

~~~text
/opt/brand-pilot/repo
/opt/brand-pilot/incoming
/opt/brand-pilot/releases
/opt/brand-pilot/state
/opt/brand-pilot/shared/env
~~~

shared is mode 0700 and actual env files are mode 0600, owned by bpdeploy. Create api.env from the example and enter each existing production value deliberately. Preserve CREDENTIAL_ENCRYPTION_KEY; use the newly rotated OpenAI key only where a later worker requires it. Do not copy a developer .env wholesale.

- [ ] **Step 5: Run the canary**

Create an A record:

~~~text
canary-api.danbammsg.co.kr -> Ubuntu public IPv4, TTL 300
~~~

Download the workflow artifact, verify release.env.sha256, and deploy:

~~~bash
cd /opt/brand-pilot/repo/brand_poilot/deploy
./scripts/deploy.sh /opt/brand-pilot/incoming/release.env --phase canary
./scripts/verify-canary.sh https://canary-api.danbammsg.co.kr https://app.danbammsg.co.kr
~~~

Canary acceptance:

~~~bash
curl --fail https://canary-api.danbammsg.co.kr/health
curl --fail https://canary-api.danbammsg.co.kr/ready
curl -sS -D - -o /dev/null -H 'Origin: https://app.danbammsg.co.kr' https://canary-api.danbammsg.co.kr/health
curl -sS -D - -o /dev/null -H 'Origin: https://evil.example' https://canary-api.danbammsg.co.kr/health
curl -sS -o /dev/null -w '%{http_code}\n' https://canary-api.danbammsg.co.kr/auth/meta/dev-complete
~~~

Expected: health and ready 200, allowed origin exact, evil origin has no allow-origin header, and dev-complete is 404. Reboot Ubuntu and repeat. Exercise the first-release rollback path without inventing a previous release:

~~~bash
candidate_sha="$(cat /opt/brand-pilot/state/candidate)"
./scripts/rollback.sh --release "$candidate_sha" --phase canary
curl --fail https://canary-api.danbammsg.co.kr/ready
~~~

- [ ] **Step 6: Perform the DNS-only cutover**

At least 24 hours earlier, lower api.danbammsg.co.kr TTL to 300 and record the exact Vercel DNS value. During the maintenance window:

~~~text
confirm scheduler and publication remain false
confirm no old PC worker is processing a lease
run promote.sh --prepare to verify the immutable candidate contains both canary and primary hosts
change the API DNS target to Ubuntu
verify through 1.1.1.1 and 8.8.8.8
wait for https://api.danbammsg.co.kr/ready and its certificate
run Kakao, both Meta callbacks, webhook, admin health, and customer-app smoke
observe API 5xx, restart count, and DB pool errors for 60 minutes
run promote.sh --commit to move candidate to current atomically
~~~

promote.sh --prepare only validates candidate state, hostnames, digests, and rollback data; it does not rewrite the manifest or Caddyfile. promote.sh --commit polls the primary hostname again, moves the existing current value to previous when present, and then atomically moves candidate to current.

If any callback fails, readiness fails for five minutes, credential decryption fails, pool exhaustion appears, or any unexpected scheduler/publication mutation occurs, restore the recorded Vercel DNS value and demote Ubuntu back to canary. Keep the Vercel API for at least 48 hours.

- [ ] **Step 7: Run final evidence commands**

~~~bash
release_sha="$(cat /opt/brand-pilot/state/current)"
release_dir="/opt/brand-pilot/releases/$release_sha"
docker compose -f "$release_dir/compose.production.yml" --env-file "$release_dir/release.env" ps
docker compose -f "$release_dir/compose.production.yml" --env-file "$release_dir/release.env" ps -q api |
  xargs docker inspect --format '{{json .Config.Image}}'
curl --fail https://api.danbammsg.co.kr/ready
sudo ss -lntp
~~~

Expected: only TCP 80/443 are publicly bound by the stack, the API image is digest pinned, readiness is green, scheduler/publication are false, and no database migration was run.

- [ ] **Step 8: Commit documentation**

~~~powershell
git add docs/operations/UBUNTU_DEPLOYMENT.md deploy/scripts/bootstrap-ubuntu.sh
git commit -m "docs: add Ubuntu bootstrap and cutover runbook"
~~~

## Plan completion gate

The API migration is complete only when:

~~~text
the exact ec40164 source is reachable in the archive and imported into main
all repository/API/migration/deployment tests exit 0
the GitHub artifact records exact API and Caddy digests
canary passes from an external network before and after reboot
rollback has been rehearsed successfully
api.danbammsg.co.kr passes OAuth, webhook, admin, and customer smoke
no scheduler, publication, worker, or DDL activity occurred
the existing Vercel API remains available for the 48-hour rollback window
~~~

After that window, create a separate DM/Wiki worker production-runtime plan covering emitted JavaScript, pinned Codex/model runtime, explicit child environment, fixed worker IDs, graceful SIGTERM drain, worker image, Compose profiles, lease-drain tests, and DM1 → DM2 → Wiki activation. Do not add those changes back into this API cutover.
