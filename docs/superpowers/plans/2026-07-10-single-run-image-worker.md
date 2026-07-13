# Single-Run Image Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and superpowers:verification-before-completion.

**Goal:** Generate one Instagram card-news job with one Codex CLI invocation, let Codex choose one to five separate PNG files, upload them to Vercel Blob, and report the manifest to the central API.

**Architecture:** The central API loads brand profile, master draft, and Instagram output context from Supabase and stores a self-contained render prompt in `jobs.payload_json`. The worker claims that job, invokes Codex once, validates one to five generated PNG files, uploads them and a manifest to Blob, then completes the central job. The worker never receives database or Meta credentials.

**Tech Stack:** TypeScript, Fastify, PostgreSQL/Supabase, Codex CLI, Vercel Blob, Vitest.

---

### Task 1: Central image job contract

**Files:**
- Modify: `apps/api/src/instagramImageGenerator.ts`
- Modify: `apps/api/src/imageRenderJobs.ts`
- Test: `apps/api/src/instagramImageGenerator.test.ts`
- Test: `apps/api/src/imageRenderJobs.test.ts`

- [x] Replace per-slide prompts with one complete job prompt.
- [x] Include brand profile, master draft, and final Instagram metadata without the brand name or logo.
- [x] Set `maxImages` to 5 and remove preselected render slides from the worker contract.
- [x] Verify the prompt requires separate PNG files, meaningful insight, and no invented facts.

### Task 2: Repository context loading

**Files:**
- Modify: `apps/api/src/repository.ts`
- Test: `apps/api/src/repository.test.ts`

- [x] Load the complete render context inside the existing transaction.
- [x] Build the render job from persisted DB rows for both manual and automatic approval paths.
- [x] Verify the inserted job payload contains the persisted context and no credentials.

### Task 3: Master-draft writing quality

**Files:**
- Modify: `apps/api/src/contentGenerator.ts`
- Test: `apps/api/src/contentGenerator.test.ts`

- [x] Add concise rules derived from dumbify, viral-hooks, anti-ai-writing, and conditional storytelling.
- [x] Keep accuracy and source-grounding rules higher priority than style.
- [x] Verify the system prompt contains the new rules.

### Task 4: One-command worker renderer

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/worker.ts`
- Modify: `workers/brand-pilot-image-worker/src/renderer.ts`
- Modify: `workers/brand-pilot-image-worker/scripts/run-codex-image-render.mjs`
- Modify: `workers/brand-pilot-image-worker/src/codexImageOutput.mjs`
- Modify: `workers/brand-pilot-image-worker/.codex/skills/image-render/SKILL.md`
- Modify: `workers/brand-pilot-image-worker/AGENTS.md`
- Test: worker Vitest files

- [x] Replace `renderSlide` with `renderJob` returning one to five images.
- [x] Invoke the configured command exactly once for each claimed job.
- [x] Detect all newly generated PNG files, normalize them to sequential slide filenames, and reject zero or more than five files.
- [x] Keep retry and heartbeat behavior around the whole render operation.

### Task 5: Storage and documentation

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/storage.ts`
- Modify: `workers/brand-pilot-image-worker/README.md`
- Modify: `workers/brand-pilot-image-worker/SETUP_OTHER_PC.md`
- Modify: `workers/brand-pilot-image-worker/.env.example`
- Modify: `db/README.md`

- [x] Upload sequential PNG assets and a manifest using the job storage prefix.
- [x] Remove stale per-slide and image-API rate-limit instructions.
- [x] Document migration 005 and the exact worker-PC handoff requirements.

### Task 6: Verification

**Files:**
- No production file changes.

- [x] Run full API tests and TypeScript build.
- [x] Run full worker tests and TypeScript build.
- [ ] Run a real Codex CLI render with a bounded test prompt.
- [ ] Upload the generated PNG files and manifest to the configured Blob store without publishing to Instagram.

Integration blockers observed on 2026-07-10:

- Standalone Codex CLI 0.144.1 is logged in and has `image_generation` enabled, but non-interactive `codex exec` returns without an `image_gen` tool call or PNG output.
- The configured Vercel Blob token is rejected with `Access denied` during an isolated image and manifest upload check.
- [ ] Inspect the public manifest and image responses.
