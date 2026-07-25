# Image Worker and Central Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Instagram image rendering from the Brand Pilot API into an independently runnable worker that reports validated Blob artifacts back to the API.

**Architecture:** The API remains the only authority for PostgreSQL/Supabase, content decisions, Meta credentials, and publishing. It inserts durable `instagram_render` jobs and exposes token-protected lease endpoints. The worker claims one job, runs its configured renderer, uploads files and a manifest to Vercel Blob, then calls the API completion endpoint. The API validates the manifest before it may schedule Instagram publishing.

**Tech Stack:** Fastify, PostgreSQL/Supabase, TypeScript, Vitest, Vercel Blob, `tsx` CLI worker.

---

### Task 1: Durable render-job contract

**Files:**
- Create: `db/migrations/005_image_render_jobs.sql`
- Create: `apps/api/src/imageRenderJobs.test.ts`
- Create: `apps/api/src/imageRenderJobs.ts`
- Modify: `apps/api/src/types.ts`

- [ ] Write failing tests for a normalized job payload and manifest validation.
- [ ] Add job metadata, active-job idempotency, lease, result, and channel-output lookup indexes.
- [ ] Implement job payload construction and manifest validation without Meta/DB dependencies.
- [ ] Run the focused Vitest suite.

### Task 2: Central API job lifecycle

**Files:**
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/server.test.ts`

- [ ] Write failing repository and route tests for worker authentication, atomic claim, completion, retry, and artifact linking.
- [ ] Add worker API token validation and claim/heartbeat/complete/fail routes.
- [ ] Replace inline OpenAI image generation with render-job insertion.
- [ ] Prevent Instagram scheduling until a validated artifact exists.
- [ ] Run API tests and type check.

### Task 3: Standalone image worker

**Files:**
- Create: `apps/image-worker/package.json`
- Create: `apps/image-worker/tsconfig.json`
- Create: `apps/image-worker/.env.example`
- Create: `apps/image-worker/src/config.ts`
- Create: `apps/image-worker/src/client.ts`
- Create: `apps/image-worker/src/renderer.ts`
- Create: `apps/image-worker/src/storage.ts`
- Create: `apps/image-worker/src/index.ts`
- Create: `apps/image-worker/src/worker.test.ts`

- [ ] Write failing tests for claim/complete and deterministic fixture rendering.
- [ ] Implement `run-once` and `watch` commands, command-based renderer, fixture renderer, Blob upload, and completion reporting.
- [ ] Keep the worker free of database and Meta configuration.
- [ ] Run worker tests and type check.

### Task 4: Operational configuration and independent-process verification

**Files:**
- Create: `docs/IMAGE_WORKER_SETUP.md`
- Modify: `apps/api/.env.example`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/types.ts`

- [ ] Document the separate worker-PC environment and Codex CLI authentication requirement.
- [ ] Show Instagram image-job state in the publish queue.
- [ ] Apply migration to local PostgreSQL and Supabase.
- [ ] Start the API and worker as independent processes and run one fixture render through Blob upload and completion.
- [ ] Run full tests, builds, and a UI smoke check.
