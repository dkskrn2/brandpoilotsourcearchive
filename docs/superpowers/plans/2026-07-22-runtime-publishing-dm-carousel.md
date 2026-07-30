# Runtime Publishing, DM, and Carousel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make carousel previews visibly move and preserve actionable Instagram publishing and manual-DM failure evidence.

**Architecture:** Keep Meta transport generic. Add publishing-stage context in `instagramPublisher.ts`, classify it at the repository boundary, and store only non-sensitive fields in existing JSONB metadata. Move DM audit creation before credential readiness checks for existing conversations.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Fastify, PostgreSQL.

---

### Task 1: Visible carousel movement

**Files:**
- Modify: `apps/customer-ui/src/components/ai-content/ArtifactCarousel.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ArtifactCarousel.test.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Test: `apps/customer-ui/e2e/ai-content-runtime.spec.ts`

- [ ] Write a failing component test asserting `.artifact-carousel__track` contains every asset and changes from `translateX(0%)` to `translateX(-100%)` after Next.
- [ ] Run `npm test --workspace @brand-pilot/customer-ui -- ArtifactCarousel.test.tsx`; expect failure because the track does not exist.
- [ ] Render one slide element per asset inside a track, use a stable URL/index key, set `loading="eager"` only on the first image and `decoding="async"` on all images, and derive transform from the current index.
- [ ] Add track/slide CSS with `display:flex`, `transition:transform 180ms ease`, and `flex:0 0 100%` while preserving stage aspect ratio and arrow positioning.
- [ ] Add a browser assertion that the known three-image fixture changes track transform and keeps counter/dot state synchronized.
- [ ] Run the component test and `npm run build --workspace @brand-pilot/customer-ui`; expect success.

### Task 2: Preserve Instagram publish failure stage

**Files:**
- Modify: `apps/api/src/instagramPublisher.ts`
- Modify: `apps/api/src/instagramPublisher.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.regression-1.test.ts`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentPublishPanel.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentPublishPanel.test.tsx`

- [ ] Add failing publisher tests for `child_container_create`, `child_container_status`, `carousel_container_create`, `carousel_container_status`, and `media_publish`; each must expose the stage while retaining the original `MetaGraphRequestError` as `cause`.
- [ ] Run `npm test --workspace @brand-pilot/api -- instagramPublisher.test.ts`; expect stage assertions to fail.
- [ ] Add a small `InstagramPublishStageError` and a helper that wraps only the five stage boundaries. Do not change `MetaGraphRequestError` or persist provider response bodies.
- [ ] Add a failing repository test asserting failed attempt metadata equals `{stage,httpStatus,metaCode,metaSubcode,retryable}` and excludes tokens/messages.
- [ ] Update repository failure persistence to use the stage-aware classifier and preserve the stable public error code.
- [ ] Add UI message cases for `instagram_media_invalid`, `meta_permission_denied`, `meta_token_invalid`, and container timeouts.
- [ ] Run targeted API/UI tests and both workspace builds; expect success.

### Task 3: Audit manual DM preflight failures

**Files:**
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.dmOperations.test.ts`
- Modify: `apps/api/src/server.dmOperations.test.ts`
- Modify: `apps/customer-ui/src/__tests__/dmAutomation.test.tsx`

- [ ] Write failing repository tests proving an existing conversation with a missing/invalid credential creates one manual attempt with `failed` status, while a missing conversation creates none and returns not found.
- [ ] Add failing tests for Meta 4xx=`failed`, Meta 5xx/network ambiguity=`unknown`, success linkage, and repeated idempotency key=no second send.
- [ ] Move attempt creation immediately after the conversation/channel target query. Update that row on every credential/provider termination path.
- [ ] Keep ambiguous delivery non-retryable and preserve the existing successful-message idempotency response.
- [ ] Verify API response mapping and UI error copy distinguish connection readiness, definite failure, and unknown delivery.
- [ ] Run `npm test --workspace @brand-pilot/api -- repository.dmOperations.test.ts server.dmOperations.test.ts` and the DM UI test; expect success.

### Task 4: Plan A verification

- [ ] Run `npm test --workspace @brand-pilot/api -- instagramPublisher.test.ts repository.regression-1.test.ts repository.dmOperations.test.ts server.dmOperations.test.ts`.
- [ ] Run `npm test --workspace @brand-pilot/customer-ui -- ArtifactCarousel.test.tsx AiContentPublishPanel.test.tsx dmAutomation.test.tsx`.
- [ ] Run both workspace builds.
- [ ] Do not retry the historical failed Instagram post automatically; manually retry only with explicit user action after diagnostics ship.

## Failure modes

- Image decode delay: first slide is eager; remaining slides decode asynchronously and retain counter/track consistency.
- Meta timeout or 4xx/5xx: stage and non-sensitive codes are tested and shown as a clear failure; no automatic duplicate publish.
- DM uncertain delivery: stored as `unknown`, tested, and never automatically resent.

## NOT in scope

- Automatically retrying the historical failed carousel.
- Replacing all channel publishers with a new state machine.
- Persisting provider response bodies or credentials.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | CLEAR | Stage-aware errors, DM audit boundary, carousel browser regression |

**UNRESOLVED:** 0

**VERDICT:** ENG CLEARED — ready to implement after Plans A → B → C are executed sequentially.
