# All-CLI Worker Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every direct OpenAI API dependency and run all Brand Pilot AI jobs through a persisted ChatGPT-authenticated Codex CLI runtime on Ubuntu.

**Architecture:** Existing API job, lease, and snapshot contracts remain intact. Content proposals switch their model adapter to a spawned Codex CLI process; DM/Wiki remove embeddings and use deterministic lexical retrieval before the existing grounded Codex answer. Every production worker image contains a pinned Codex CLI and uses the same protected persistent `CODEX_HOME`.

**Tech Stack:** TypeScript, Node.js 22, Vitest, PostgreSQL 15/pgvector-compatible migrations, Docker Compose, GitHub Actions, Codex CLI 0.145.0.

---

### Task 1: Add repository guardrails against direct model APIs

**Files:**
- Create: `scripts/worker-cli-only-contract.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing contract test**

```js
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

test("production workers do not call model APIs or require OPENAI_API_KEY", async () => {
  const roots = ["workers", "deploy"];
  const files = await collectSourceFiles(roots);
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /api\.openai\.com/);
  assert.doesNotMatch(source, /OPENAI_API_KEY/);
});
```

- [ ] **Step 2: Run the contract and verify RED**

Run: `node --test scripts/worker-cli-only-contract.test.mjs`

Expected: FAIL on content-proposal Responses API and DM/Wiki embeddings.

- [ ] **Step 3: Register the contract in the root verification script**

Add `node --test scripts/worker-cli-only-contract.test.mjs` to the bounded deployment/contract test command.

- [ ] **Step 4: Leave the test red until Tasks 2–4 remove every forbidden reference**

### Task 2: Convert content proposals from Responses API to Codex CLI

**Files:**
- Create: `workers/brand-pilot-content-proposal-worker/src/codexModel.ts`
- Create: `workers/brand-pilot-content-proposal-worker/src/codexModel.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/client.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/client.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/main.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/worker.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing Codex adapter tests**

Test that the adapter:

```ts
expect(spawn).toHaveBeenCalledWith("codex", expect.arrayContaining([
  "exec", "--ignore-user-config", "-m", "gpt-5.4",
  "--skip-git-repo-check", "--ephemeral", "--json",
  "--sandbox", "read-only",
]), expect.objectContaining({ shell: false }));
expect(childEnv).not.toHaveProperty("OPENAI_API_KEY");
expect(childEnv).not.toHaveProperty("CONTENT_PROPOSAL_WORKER_API_TOKEN");
```

Also cover valid final JSON, invalid JSON, non-zero exit, timeout, abort/lease loss, bounded stderr, and process-tree termination.

- [ ] **Step 2: Verify RED**

Run: `npm run test --workspace @brand-pilot/content-proposal-worker -- codexModel.test.ts`

Expected: FAIL because `createCodexContentProposalModel` does not exist.

- [ ] **Step 3: Implement the minimal CLI model adapter**

Implement:

```ts
export function createCodexContentProposalModel(input: {
  command: string;
  model: string;
  timeoutMs: number;
}): ContentProposalModelClient;
```

The adapter writes no secrets, sends the frozen prompt on stdin, parses the last valid Codex JSONL text item, and uses the existing `parseContentProposalResult` contract. Keep the current 2–3 proposal runtime parser; do not use the incompatible root-array `--output-schema`.

- [ ] **Step 4: Wire startup without API-key configuration**

Replace:

```ts
createOpenAiContentProposalModel(
  required("OPENAI_API_KEY"),
  required("CONTENT_PROPOSAL_MODEL"),
)
```

with:

```ts
createCodexContentProposalModel({
  command: process.env.CONTENT_PROPOSAL_CODEX_COMMAND?.trim() || "codex",
  model: process.env.CONTENT_PROPOSAL_CODEX_MODEL?.trim() || "gpt-5.4",
  timeoutMs: boundedNumber("CONTENT_PROPOSAL_CODEX_TIMEOUT_MS", 300_000, 1_000, 900_000),
})
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm run test --workspace @brand-pilot/content-proposal-worker
npm run build --workspace @brand-pilot/content-proposal-worker
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add workers/brand-pilot-content-proposal-worker package-lock.json
git commit -m "fix(content): run proposals through Codex CLI"
```

### Task 3: Add keyword-only Wiki retrieval and activation migration

**Files:**
- Create: `db/migrations/070_remove_embedding_runtime.sql`
- Modify: `scripts/migrationRunner.test.mjs`
- Modify: `scripts/migrations.integration.test.mjs`
- Modify: `scripts/repository-contract.test.mjs`

- [ ] **Step 1: Write failing migration assertions**

Assert migration 070:

```js
assert.match(sql, /search_brand_wiki_lexical/);
assert.match(sql, /websearch_to_tsquery/);
assert.match(sql, /build_stage = 'validating'/);
assert.doesNotMatch(sql, /p_query_embedding/);
```

Integration cases must activate a Wiki whose enabled chunks have null embeddings and return stable Korean keyword/title matches.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test scripts/migrationRunner.test.mjs scripts/repository-contract.test.mjs
```

Expected: FAIL because migration 070 is absent.

- [ ] **Step 3: Implement the forward-only migration**

Create a function with this external shape:

```sql
search_brand_wiki_lexical(
  p_workspace_id uuid,
  p_brand_id uuid,
  p_query text,
  p_limit integer default 12
)
```

Rank enabled active-version chunks by full-text rank, normalized phrase/token overlap, page title/key/alias signals, and deterministic tie breakers. Replace activation checks so enabled chunks, not embeddings, define readiness. Move in-flight `building/embedding` versions to `validating`. Retain vector columns and historical values.

- [ ] **Step 4: Verify GREEN**

Run the migration inventory/contracts and the focused PostgreSQL Wiki integration test.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/070_remove_embedding_runtime.sql scripts/migrationRunner.test.mjs scripts/migrations.integration.test.mjs scripts/repository-contract.test.mjs
git commit -m "feat(wiki): add embedding-free lexical retrieval"
```

### Task 4: Remove embeddings from DM/Wiki workers

**Files:**
- Delete: `workers/brand-pilot-dm-worker/src/embeddings.ts`
- Delete: `workers/brand-pilot-dm-worker/src/embeddings.test.ts`
- Modify: `workers/brand-pilot-dm-worker/src/index.ts`
- Modify: `workers/brand-pilot-dm-worker/src/worker.ts`
- Modify: `workers/brand-pilot-dm-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-dm-worker/src/db.ts`
- Modify: `workers/brand-pilot-dm-worker/src/compiledWikiFinalize.ts`
- Modify: `workers/brand-pilot-dm-worker/src/compiledWikiFinalize.test.ts`
- Modify: `workers/brand-pilot-dm-worker/src/compiledWikiSource.ts`
- Modify: `workers/brand-pilot-dm-worker/src/compiledWikiTypes.ts`
- Modify/Delete dead path: `workers/brand-pilot-dm-worker/src/wikiRefresh.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.dmWiki.test.ts`
- Modify: `apps/api/src/repository.dmWebhook.test.ts`
- Modify: `scripts/compiled-wiki-smoke.mjs`
- Modify: `scripts/compiled-wiki-smoke.test.mjs`

- [ ] **Step 1: Write failing worker behavior tests**

Prove:

```ts
expect(embed).not.toBeDefined();
expect(db.searchCompiledWiki).toHaveBeenCalledWith(workspaceId, brandId, question);
expect(runCodex).toHaveBeenCalledTimes(1);
```

Retain exact FAQ behavior before retrieval/history/Codex, fixed fallback, source-ID validation, no-ground fallback, lease heartbeat, and invalid-Codex-result rejection.

- [ ] **Step 2: Verify RED**

Run: `npm run test --workspace @brand-pilot/dm-worker -- worker.test.ts compiledWikiFinalize.test.ts`

Expected: FAIL because the worker still requires and calls `embed`.

- [ ] **Step 3: Remove embedding runtime**

Change DB contract to:

```ts
searchCompiledWiki(
  workspaceId: string,
  brandId: string,
  question: string,
): Promise<CompiledWikiSearchPacket | null>;
```

Finalize Wiki chunks with searchable content and null legacy embeddings, then validate/activate. Remove `OPENAI_API_KEY`, embedding model/version startup requirements, retry codes, and dead legacy execution paths.

- [ ] **Step 4: Update API readiness**

Replace every active-Wiki check requiring `chunk.embedding is not null` with enabled-chunk readiness. Preserve the exact FAQ bypass and ownership checks.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm run test --workspace @brand-pilot/dm-worker
npm run build --workspace @brand-pilot/dm-worker
npm run test --workspace @brand-pilot/api -- repository.dmWiki.test.ts repository.dmWebhook.test.ts
node --test scripts/compiled-wiki-smoke.test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add workers/brand-pilot-dm-worker apps/api/src scripts/compiled-wiki-smoke*
git commit -m "fix(wiki): remove OpenAI embedding dependency"
```

### Task 5: Containerize every CLI worker safely

**Files:**
- Modify: `workers/brand-pilot-dm-worker/Dockerfile`
- Modify: `workers/brand-pilot-content-proposal-worker/Dockerfile`
- Create: `workers/brand-pilot-brand-intelligence-worker/Dockerfile`
- Create: `workers/brand-pilot-subject-analysis-worker/Dockerfile`
- Create: `workers/brand-pilot-image-worker/Dockerfile`
- Create: `workers/brand-pilot-card-news-worker/Dockerfile`
- Create: `workers/brand-pilot-blog-worker/Dockerfile`
- Create: `workers/brand-pilot-marketing-worker/Dockerfile`
- Modify: worker TypeScript build configurations and runtime imports as required
- Modify: `scripts/deployment-contract.test.mjs`

- [ ] **Step 1: Change deployment contracts to require all worker images**

Tests must require a Dockerfile for every worker, pinned `@openai/codex@0.145.0`, non-root execution, no API key, no Docker socket, bounded tmpfs work paths, and minimal child environments.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/deployment-contract.test.mjs`

Expected: FAIL because six Dockerfiles are missing and the old test forbids these Ubuntu services.

- [ ] **Step 3: Add production builds**

Compile each worker and `@brand-pilot/worker-runtime` into copied runtime output. Copy only required scripts, schemas, skills, and render dependencies. Remove production reliance on `tsx/esm/api`. Install Python/ffmpeg only in the image worker.

- [ ] **Step 4: Harden Codex execution**

All content workers use a job-specific tmpfs workspace, `workspace-write` rather than unrestricted host access, and an explicit environment allowlist that excludes worker/API/DB/Blob credentials. Generated images go to tmpfs, not `CODEX_HOME`.

- [ ] **Step 5: Verify GREEN**

Run worker builds/tests, deployment contracts, and Docker builds for all images.

- [ ] **Step 6: Commit**

```bash
git add workers scripts/deployment-contract.test.mjs package-lock.json
git commit -m "build(workers): containerize Codex CLI runtimes"
```

### Task 6: Extend Compose, release manifests, and image publishing

**Files:**
- Modify: `deploy/compose.production.yml`
- Modify: `deploy/release.env.example`
- Modify: `deploy/scripts/bootstrap-ubuntu.sh`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `deploy/scripts/lib.sh`
- Modify: `deploy/scripts/deploy.sh`
- Modify: `deploy/env/dm-worker.env.example`
- Modify: `deploy/env/wiki-worker.env.example`
- Modify: `deploy/env/content-proposal-worker.env.example`
- Create: deploy env examples for six omitted workers
- Modify: `../.github/workflows/publish-brand-pilot-server-images.yml`
- Modify: `scripts/deployment-contract.test.mjs`

- [ ] **Step 1: Write failing Compose/release assertions**

Require all eight worker image keys/services/profiles and:

```yaml
environment:
  CODEX_HOME: /codex
volumes:
  - ${CODEX_HOME_PATH:-/opt/brand-pilot/shared/codex}:/codex
```

Require no worker env example to contain `OPENAI_API_KEY`.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/deployment-contract.test.mjs`

- [ ] **Step 3: Implement release plumbing**

Add image/digest keys for brand intelligence, subject analysis, image, card news, blog, and marketing. Build/publish them in the workflow and validate OCI revision/digests during preflight. Preserve explicit profiles so no duplicate worker starts automatically.

- [ ] **Step 4: Implement auth preflight**

Bootstrap creates `/opt/brand-pilot/shared/codex` without following symlinks. Preflight verifies owner, mode, `auth.json`, and a bounded `codex login status` container command without printing credentials.

- [ ] **Step 5: Verify GREEN**

Run deployment contracts and `docker compose config` for all profiles.

- [ ] **Step 6: Commit**

```bash
git add deploy ../.github/workflows/publish-brand-pilot-server-images.yml scripts/deployment-contract.test.mjs
git commit -m "feat(deploy): publish all Codex CLI workers"
```

### Task 7: Regression, login, and production rollout

**Files:**
- Modify: `docs/operations/UBUNTU_DEPLOYMENT.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `README.md`
- Modify: `docs/quality/d-hybrid-regression-matrix.md`

- [ ] **Step 1: Complete Ubuntu ChatGPT login**

Use a temporary Codex CLI container with host networking and:

```bash
CODEX_HOME=/opt/brand-pilot/shared/codex codex login
```

Complete Google authentication in Ubuntu Chrome. Verify `codex login status` reports ChatGPT login while printing no credential.

- [ ] **Step 2: Run bounded local regression**

Run the touched worker suites, API DM/Wiki and content-proposal suites, migration contracts/integration, deployment contracts, TypeScript builds, `git diff --check`, and the CLI-only source scan.

- [ ] **Step 3: Push and merge only after checks pass**

Publish the branch and merge its PR after required checks succeed.

- [ ] **Step 4: Deploy without starting duplicate workers**

Deploy API/images/Compose definitions first. Start only `brand-intelligence-worker-1`.

- [ ] **Step 5: Verify real onboarding**

In the production browser, submit one URL/file onboarding run and record timestamps for:

```text
queued -> running -> completed
```

Confirm Brand Core draft output, saved progress, loader duration, and re-entry behavior.

- [ ] **Step 6: Enable remaining profiles incrementally**

Verify subject analysis, content proposal, Wiki build, DM answer, and one content generation job before enabling the next profile.

- [ ] **Step 7: Record operational evidence**

Document deployed SHA, image digests, worker IDs, login method (`ChatGPT`, no secret), job IDs/status/durations, and rollback target.

