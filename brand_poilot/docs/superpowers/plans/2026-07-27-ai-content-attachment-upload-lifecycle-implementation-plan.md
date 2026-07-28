# AI Content Attachment Upload Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every production change and `superpowers:verification-before-completion` before every completion claim. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 콘텐츠 생성 임시 첨부를 upload session부터 물리 삭제까지 추적하고, terminal 시점부터 15일 동안 immutable retry input을 보존하며, 같은 파일의 새 업로드 시도와 충돌하지 않는 durable GC를 구현한다.

**Architecture:** migration `065`가 upload session, generation/attachment lifecycle 열, parent-independent deletion job을 additive하게 추가한다. 새 발급 경로는 DB reservation을 먼저 만들고 provider token을 나중에 발급하며, confirm은 `sessionId + nonce`로 DB에 저장된 metadata를 검증한다. 주제 분석은 선택 첨부만 `input_json.attachmentSnapshot`에 고정하고 generation 전체 첨부 잠금은 하지 않는다. 최종 생성 시작 transaction이 `generation_input_snapshot`과 `attachments_locked_at`을 기록하고, generate/retry worker는 live attachment row가 아니라 job payload의 snapshot만 소비한다. GC는 worker claim과 분리하고 generation → deletion job 순서로 잠근 뒤 fenced lease를 commit하고 provider 삭제를 transaction 밖에서 수행한다.

**Tech Stack:** PostgreSQL 16, PGlite, Fastify, TypeScript, React, Vitest, Testing Library, Playwright, Testcontainers, Vercel Blob.

---

## Source of truth and boundaries

- Approved design: `docs/superpowers/specs/2026-07-27-ai-content-attachment-upload-lifecycle-design.md`
- Parent program: `docs/superpowers/plans/2026-07-24-d-hybrid-program-implementation-plan.md`
- Content plan resumed after this work: `docs/superpowers/plans/2026-07-24-d-hybrid-content-creation-implementation-plan.md`
- Preservation baseline: `docs/prd/brand-pilot-feature-preservation-ledger.md`
- Starting commit: `f72667b`
- Existing completed Content Task 1 commits to preserve: `c304ca3`, `ad1a857`, `385e3a8`

This plan covers only temporary AI-content attachments stored through `ai_content_generation_attachments`:

- subject-analysis product images and documents
- generation-prompt images and documents
- upload reservation, confirmation, logical removal, immutable consumption, retention, and physical GC

This plan does not change:

- reference, avatar, product/service, or Wiki library assets
- generated artifacts, ZIP files, manifests, publish media, or crawler images
- the Blob provider or public/private access model
- the existing `card_news | blog | marketing` worker mapping
- daily generation/download limits or download charging
- the actual Ubuntu environment, secrets, running services, cron, systemd timers, deployment, SSH, or DNS

## Compatibility decision required by the existing wizard

The current wizard uploads subject evidence before subject analysis, then allows generation-prompt attachments later. A generation-wide lock at subject-analysis request time would silently remove that existing capability.

Therefore:

- subject-analysis request snapshots only its selected attachment rows into `ai_content_subject_analyses.input_json.attachmentSnapshot`
- that snapshot creates a GC hold but does **not** set `ai_content_generations.attachments_locked_at`
- later prompt attachments remain addable/removable
- subject-analysis request and final generation start return `409 ai_content_attachment_upload_in_progress` while any non-expired pending session exists, so an in-flight file is never silently omitted
- `startAiContentGeneration()` creates the canonical generation snapshot and sets the generation-wide lock
- after that lock, token issuance, session confirm/cancel that changes the active set, remove, and attachment-bearing draft changes return `409 ai_content_attachments_locked`

This is the preservation-safe interpretation of “first consuming snapshot”: each consumer receives an immutable snapshot, while the generation-wide active set is frozen only when final generation starts.

## Non-negotiable invariants

1. `deleted_at` means logical removal only; only `physically_deleted_at` proves provider deletion/not-found convergence.
2. Legacy actor identity is never guessed. New pending sessions require an actor; migration-created legacy confirmed sessions may have `created_by_user_id is null`.
3. New object identity uses a unique session/attempt path. Checksum remains verification metadata.
4. Five-file enforcement counts non-expired `pending` reservations plus confirmed, non-deleted attachments while holding the generation row lock.
5. Subject and generation workers never rebuild attachment input from live rows after enqueue.
6. Retry before `retryable_until` copies the exact prior generate-job input snapshot in the same transaction.
7. Retry at or after `retryable_until` returns `410 ai_content_attachment_retention_expired`.
8. GC cannot claim data referenced by queued/processing subject or generation work.
9. Retry and GC both lock generation before output/deletion job. Once GC commits `deleting`, retry loses.
10. A deletion job has no cascading FK to workspace, generation, attachment, or upload session.
11. Provider I/O never runs inside the GC claim transaction.
12. Feature issuance defaults OFF. Cleanup remains runnable regardless of the issuance flag.
13. The first rollout adds no production scheduler/timer and does not edit `/opt/brand-pilot/shared/env`.

## Execution and review protocol

Tasks are sequential because migration shape, lock order, DTOs, and dual-contract rollout share invariants. Do not parallelize implementation tasks that edit the same repository or contract files.

For every task:

1. Write the listed failing test and run the narrow RED command.
2. Confirm failure is caused by the missing behavior, not a fixture/type/setup error.
3. Implement the smallest GREEN change.
4. Run the narrow suite and related regressions.
5. Request a fresh specification review against this plan and the approved design. Fix and re-run until `PASS`.
6. Only after specification `PASS`, request a different fresh code-quality review. Fix and re-run until `PASS`.
7. Run `git diff --check`, inspect `git status --short`, then create only the task’s commit.

A skipped PostgreSQL concurrency suite is not a pass. If Docker remains unavailable, record the task as implementation-complete but verification-blocked and do not claim this lifecycle complete.

The PostgreSQL 16 suites must replace hand-written attachment schemas with the real migration loader. Because the existing local/Testcontainers image is `postgres:16-alpine`, reuse the repository’s compatibility rule that skips only `021_dm_wiki_pgvector.sql`, `027_wiki_search_v2.sql`, and `033_compounding_wiki_pgvector.sql`; never skip `065`. The migration integration suite remains responsible for the pgvector migrations.

---

## Task 1: Add migration 065 and prove fresh/upgrade convergence

**Files:**

- Create: `db/migrations/065_ai_content_attachment_upload_sessions.sql`
- Modify: `scripts/migrations.integration.test.mjs`
- Modify: `scripts/migrationRunner.test.mjs`
- Modify: `scripts/repository-contract.test.mjs`

- [ ] Add RED migration tests for a fresh database and an upgrade fixture stopped at `064`.
- [ ] Assert both paths converge on the same columns, constraints, indexes, upload sessions, legacy backfill, and deletion obligations.
- [ ] Assert the pending migration tail contains exactly `065_ai_content_attachment_upload_sessions.sql`; `059` and `060` remain optional/reserved dependencies.
- [ ] Assert terminal legacy generations use `coalesce(completed_at, updated_at)` and exactly 15 days:

```sql
terminal_at = coalesce(completed_at, updated_at)
retryable_until = coalesce(completed_at, updated_at) + interval '15 days'
```

- [ ] Assert nonterminal generations keep both fields null.
- [ ] Assert existing `subject_analysis_snapshot` objects backfill `generation_input_snapshot` without changing their JSON value.
- [ ] Assert queued/processing generation jobs receive the stored `contentGenerationInput` when one is available.
- [ ] Assert active V2 subject-analysis rows receive an ordered `input_json.attachmentSnapshot`. Store missing requested legacy IDs in `input_json.attachmentSnapshotMissingIds`; the worker must fail deterministically when that array is non-empty rather than reading live state.
- [ ] Assert every legacy active/deleted attachment gets a deterministic legacy confirmed upload-session row. Actor remains null; do not invent a user.
- [ ] Assert legacy `deleted_at is not null` rows become physical `pending`/unknown with `physically_deleted_at is null` and one durable deletion job.
- [ ] Assert deleting a generation/workspace after migration leaves the deletion obligation row.
- [ ] Run RED:

```powershell
npm run test:migrations
npm run test:contract
```

Expected RED: migration `065`, lifecycle tables/columns, and the expected migration list do not exist.

- [ ] Implement additive generation columns:

```sql
alter table ai_content_generations
  add column if not exists attachments_locked_at timestamptz,
  add column if not exists generation_input_snapshot jsonb,
  add column if not exists terminal_at timestamptz,
  add column if not exists retryable_until timestamptz;
```

- [ ] Add `generation_input_snapshot is null or jsonb_typeof(generation_input_snapshot) = 'object'` and a retention pair constraint requiring `retryable_until > terminal_at` when populated.
- [ ] Implement `ai_content_attachment_upload_sessions` with tenant/generation composite ownership, immutable expected metadata, `nonce`, exact `storage_path`, 10-minute DB expiry, `confirmed_at | cancelled_at | expired_at | failed_at`, redacted `last_error_code`, `is_legacy_backfill boolean not null default false`, and exact state checks for `pending | confirmed | cancelled | expired | failed`.
- [ ] Make `created_by_user_id` nullable only for migration-created confirmed legacy rows:

```sql
check (
  (
    created_by_user_id is not null
    or (
      is_legacy_backfill
      and status = 'confirmed'
      and confirmed_attachment_id is not null
    )
  )
  and (
    not is_legacy_backfill
    or (
      created_by_user_id is null
      and status = 'confirmed'
      and confirmed_attachment_id is not null
    )
  )
)
```

- [ ] Reuse `(workspace_id, created_by_user_id) -> workspace_members(workspace_id, user_id)` for non-null actors.
- [ ] Add unique `nonce`, unique `storage_path`, one attachment per session, pending-expiry, and generation-reservation indexes. Add tenant-scoped unique keys `(id, workspace_id, brand_id)` to both sessions and attachments so both composite foreign keys have exact referenced keys.
- [ ] Avoid an undeclared circular delete contract. Add both tenant-scoped links as `DEFERRABLE INITIALLY DEFERRED ... ON DELETE NO ACTION`: attachment `(upload_session_id, workspace_id, brand_id)` → session and session `(confirmed_attachment_id, workspace_id, brand_id)` → attachment. Confirm inserts the attachment and then updates the session in one transaction; generation/workspace cascades remove both before deferred checks run.
- [ ] Extend `ai_content_generation_attachments`:

```sql
upload_session_id uuid null,
deletion_reason text null,
physical_delete_status text not null default 'none',
physically_deleted_at timestamptz null
```

- [ ] Constrain physical status to `none | pending | deleting | failed | deleted | dead_letter` and require `physically_deleted_at` only for `deleted`. Keep attempt, retry, error, and lease fields solely on the authoritative parent-independent deletion job.
- [ ] Implement `ai_content_attachment_deletion_jobs` with copied tenant/parent IDs, nullable URL, non-null path, reason, `status`, attempt/max-attempt, next-attempt, lease token/expiry, last error category/message, and completion timestamp.
- [ ] Constrain deletion-job status to `pending | deleting | failed | deleted | dead_letter`. Require lease token/expiry only for `deleting`, completion only for `deleted`, and no claimable index entry for terminal states.
- [ ] Give deletion jobs **no** FK to workspace, generation, attachment, or session. Add unique `(workspace_id, storage_path)` as the exact obligation dedupe key.
- [ ] Add `BEFORE DELETE` triggers for attachments and upload sessions. The attachment trigger inserts an obligation unless the row is physically deleted; the session trigger inserts one for unconfirmed `pending | cancelled | failed | expired` paths. A session obligation is not due before `token_expires_at`, because a previously issued token may still upload. These triggers preserve cascade cleanup on generation/workspace deletion.
- [ ] Add due-job, expired-lease, pending-session, and terminal-retention indexes.
- [ ] Make backfill idempotent with deterministic IDs or `on conflict do nothing`; never infer physical deletion from `deleted_at`.
- [ ] Re-run GREEN:

```powershell
npm run test:migrations
npm run test:contract
node --test scripts/migrationRunner.test.mjs
```

- [ ] Specification review: schema/backfill/15-day/no-cascade/059–060 independence must be `PASS`.
- [ ] Code-quality review: SQL lock/index/check/idempotency/migration-cost review must be `PASS`.
- [ ] Commit:

```powershell
git add db/migrations/065_ai_content_attachment_upload_sessions.sql scripts/migrations.integration.test.mjs scripts/migrationRunner.test.mjs scripts/repository-contract.test.mjs
git commit -m "feat(db): add AI content attachment lifecycle schema"
```

## Task 2: Define dual upload contracts and unique provider paths

**Files:**

- Modify: `apps/api/src/aiContentContracts.ts`
- Modify: `apps/api/src/aiContentUpload.ts`
- Modify: `apps/api/src/aiContentUpload.test.ts`

- [ ] Add RED tests for strict UUID parsing before SQL:
  - invalid generation → `ai_content_generation_id_invalid`
  - invalid attachment → `ai_content_attachment_id_invalid`
  - invalid session → `ai_content_upload_session_id_invalid`
- [ ] Add RED tests proving two attempts for the same checksum/file have different paths.
- [ ] Add RED tests proving the DB session expiry is 10 minutes and provider `validUntil` is exactly the DB-returned expiry minus 60 seconds, including API clocks skewed two minutes before/after the DB.
- [ ] Add RED parser tests for new confirm/cancel bodies and the retained legacy confirm body.
- [ ] Run RED:

```powershell
npm run test --workspace @brand-pilot/api -- aiContentUpload.test.ts
```

Expected RED: session request types and unique path builder are missing.

- [ ] Split the current confirm type without removing legacy skew support:

```ts
export interface ConfirmUploadSessionInput {
  sessionId: string;
  nonce: string;
}

export interface CancelUploadSessionInput {
  sessionId: string;
  nonce: string;
}

export interface LegacyConfirmAttachmentInput
  extends AttachmentUploadTokenInput {
  storageUrl: string;
  storagePath: string;
}

export type ConfirmAttachmentInput =
  | ConfirmUploadSessionInput
  | LegacyConfirmAttachmentInput;
```

- [ ] Require an exact object shape for the new session body. Do not accept client-supplied role, checksum, URL, path, tenant, or retention fields in session confirm/cancel.
- [ ] Replace checksum identity for new issuance:

```ts
buildAiContentAttachmentPath({
  workspaceId,
  brandId,
  generationId,
  sessionId,
  attemptId,
  fileName,
})
// workspaces/{workspaceId}/brands/{brandId}/ai-content/{generationId}/
// attachments/{sessionId}/{attemptId}/{safeFileName}
```

- [ ] Preserve the existing MIME, role, filename, checksum, and 5/10MB validation helpers.
- [ ] Keep `addRandomSuffix: false` and `allowOverwrite: false`; uniqueness now comes from IDs.
- [ ] For the new session contract, issue the provider token only for the DB-stored pathname/content type/maximum size. Derive `validUntil` from `session.tokenExpiresAt - 60_000`, validate the returned timestamp, and never calculate the new-session expiry from API `Date.now()`. Keep the flag-OFF legacy issuer unchanged for deployment skew.
- [ ] Verify new uploads with `head(session.storagePath, { abortSignal })` and use the provider-returned `url`; never trust a client URL.
- [ ] Distinguish provider unavailable/rate-limit/timeout (`503 ai_content_attachment_storage_unavailable`) from not-found (`422 ai_content_attachment_blob_unavailable`) and metadata mismatch (`422`).
- [ ] Preserve legacy path/URL validation functions until a later release removes old confirm.
- [ ] Run GREEN:

```powershell
npm run test --workspace @brand-pilot/api -- aiContentUpload.test.ts
npm run typecheck --workspace @brand-pilot/api
```

- [ ] Specification review: metadata trust boundary, 9/10-minute ordering, unique attempts, legacy compatibility must be `PASS`.
- [ ] Code-quality review: parser exactness, URL/path normalization, error classification, secret-safe behavior must be `PASS`.
- [ ] Commit:

```powershell
git add apps/api/src/aiContentContracts.ts apps/api/src/aiContentUpload.ts apps/api/src/aiContentUpload.test.ts
git commit -m "feat(api): define attachment upload session contracts"
```

## Task 3: Implement the upload-session repository state machine

**Files:**

- Create: `apps/api/src/aiContentAttachmentRepository.ts`
- Create: `apps/api/src/aiContentAttachmentRepository.test.ts`
- Create: `apps/api/src/aiContentAttachmentRepository.pglite.test.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRepository.test.ts`
- Modify: `apps/api/src/aiContentRepository.postgres.integration.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.ts`

- [ ] Add RED unit/PGlite tests for this interface:

```ts
interface AiContentAttachmentLifecycleRepository {
  assertAiContentAttachmentUploadMutable(
    input: BrandGenerationScope,
  ): Promise<void>;
  createAiContentUploadSession(input: BrandGenerationScope & {
    createdByUserId: string;
    attachment: AttachmentUploadTokenInput;
  }): Promise<AiContentUploadSessionRecord>;
  failAiContentUploadSession(input: BrandGenerationScope & {
    sessionId: string;
    createdByUserId: string;
    errorCode: string;
  }): Promise<void>;
  confirmAiContentUploadSession(
    input: BrandGenerationScope & {
      sessionId: string;
      nonce: string;
      createdByUserId: string;
    },
    verify: (
      session: AiContentUploadSessionRecord,
      abortSignal: AbortSignal,
    ) =>
      Promise<VerifiedAiContentAttachmentBlob>,
  ): Promise<AiContentAttachmentRecord>;
  cancelAiContentUploadSession(input: BrandGenerationScope & {
    sessionId: string;
    nonce: string;
    createdByUserId: string;
  }): Promise<{ id: string }>;
  confirmLegacyAiContentAttachment(
    input: BrandGenerationScope & LegacyConfirmAttachmentInput,
  ): Promise<AiContentAttachmentRecord>;
  removeAiContentAttachment(
    input: BrandGenerationScope & { attachmentId: string },
  ): Promise<{ id: string }>;
}
```

- [ ] Cover:
  - pending non-expired sessions + active confirmed attachments reach exactly five
  - exactly one of two concurrent reservations succeeds when four slots exist
  - actor and tenant isolation
  - foreign tenant/session returns the same not-found error as missing
  - with upload-session issuance enabled, the same file after removal gets a new session/path
  - provider-token failure leaves a diagnosable `failed` session and delayed cleanup obligation
  - same `sessionId + nonce` confirm replay returns the same attachment, including after the generation becomes locked
  - wrong nonce/conflicting replay returns `ai_content_upload_confirmation_conflict`
  - expired/cancelled sessions return `ai_content_upload_session_expired`
  - confirm one DB instant before session expiry may proceed; exact equality is expired
  - confirm versus expiry/cancel performs one state transition
  - a hung verifier is aborted at 15 seconds, rolls back, releases locks, and leaves the pending session retryable
  - locked generation rejects create, pending-session confirm, and remove
  - the legacy upload-mutability assertion locks the generation and rejects a locked generation
  - legacy confirm still observes the aggregate five-file limit and lock
- [ ] Run unit/PGlite RED:

```powershell
npm run test --workspace @brand-pilot/api -- aiContentAttachmentRepository.test.ts aiContentAttachmentRepository.pglite.test.ts aiContentRepository.test.ts
```

Expected RED: repository and methods do not exist.

- [ ] In `createAiContentUploadSession()`, begin transaction, lock the tenant-scoped generation, reject `attachments_locked_at`, count reservations, generate session/attempt IDs and nonce, and insert the pending row before returning it.
- [ ] Implement the legacy `assertAiContentAttachmentUploadMutable()` with the same tenant-scoped generation lock and `attachments_locked_at` check. It creates no reservation and exists only for flag-OFF deployment skew.
- [ ] Count only `status='pending' and token_expires_at > now()` plus confirmed `deleted_at is null`.
- [ ] Generate nonce with cryptographic entropy; never return it from list/generation DTOs and never log it.
- [ ] In confirm, lock generation then the tenant/actor-scoped session. If the session is already confirmed and the nonce/actor match, return its existing attachment regardless of token expiry and before applying the generation-lock rejection. For a pending session, decide expiry at that lock statement’s DB timestamp (`token_expires_at > statement_timestamp()`); equality is expired, and a locked generation rejects confirmation. Use only the session’s stored expected metadata.
- [ ] Hold those locks during the injected `head` verifier so confirm and expiry cannot both win. Pass an `AbortSignal` to the verifier, bound it with `AbortController` at 15 seconds, clear its timer in `finally`, and let timeout rollback release both locks while the session remains pending and retryable.
- [ ] On a transient verifier error, leave the session pending until retry/expiry. On success, insert one attachment, set the session confirmed, and commit atomically.
- [ ] Make cancel and token-issuance failure use the same generation → session lock order as confirm; never introduce a session → generation path.
- [ ] Cancel transitions pending → cancelled and schedules cleanup no earlier than `token_expires_at`, because a previously issued provider token can still upload.
- [ ] Token issuance failure transitions pending → failed and retains a delayed cleanup obligation for ambiguous provider outcomes.
- [ ] Logical remove sets `deleted_at`, `deletion_reason='user_removed'`, physical status pending, and creates/deduplicates the deletion job. It never calls Blob delete.
- [ ] Move the old direct confirm into the explicitly named legacy method. Do not resurrect a logically deleted row by path.
- [ ] Compose the lifecycle repository through `createRepository()` and `ApiRepository`.
- [ ] Run GREEN:

```powershell
npm run test --workspace @brand-pilot/api -- aiContentAttachmentRepository.test.ts aiContentAttachmentRepository.pglite.test.ts aiContentRepository.test.ts
npm run typecheck --workspace @brand-pilot/api
```

- [ ] With Docker running, replace the hand-written schema in the relevant PostgreSQL suite with real migrations and run:

```powershell
$env:RUN_POSTGRES_INTEGRATION = "true"
npm run test --workspace @brand-pilot/api -- aiContentRepository.postgres.integration.test.ts --maxWorkers=1
Remove-Item Env:RUN_POSTGRES_INTEGRATION
```

Expected GREEN: the five-slot concurrent reservation test has one success/one limit failure and no duplicate session transition.

- [ ] Specification review: state machine, actor/tenant scope, limit, replay, cancel timing, legacy skew must be `PASS`.
- [ ] Code-quality review: transaction boundaries, lock order, verifier failure behavior, nonce handling, SQL parameterization must be `PASS`.
- [ ] Commit:

```powershell
git add apps/api/src/aiContentAttachmentRepository.ts apps/api/src/aiContentAttachmentRepository.test.ts apps/api/src/aiContentAttachmentRepository.pglite.test.ts apps/api/src/aiContentRepository.ts apps/api/src/aiContentRepository.test.ts apps/api/src/aiContentRepository.postgres.integration.test.ts apps/api/src/types.ts apps/api/src/repository.ts
git commit -m "feat(api): persist attachment upload reservations"
```

## Task 4: Serve the dual HTTP contract behind a fail-closed flag

**Files:**

- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.aiContentCustomer.test.ts`
- Modify: `apps/api/src/runtimeConfig.ts`
- Modify: `apps/api/src/runtimeConfig.test.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/.env.example`

- [ ] Add RED runtime tests for a strict boolean `AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED`, default `false`.
- [ ] Add RED HTTP tests for disabled legacy issuance and enabled session issuance.
- [ ] Add RED tests proving both flag-OFF legacy token requests and flag-ON session token requests return `409 ai_content_attachments_locked` after final generation lock.
- [ ] Add RED tests proving confirm accepts both bodies regardless of issuance flag.
- [ ] Add RED tests for enabled issuance order: DB session first, provider token second, then mark failed if provider issuance fails.
- [ ] Add RED tests for the actor requirement and session cancel endpoint.
- [ ] Assert exact status/error mapping:
  - malformed IDs → 400
  - missing/foreign generation/session → 404
  - conflict/limit/lock/upload-in-progress → 409
  - session/retry expiry → 410
  - unavailable/mismatch → 422
  - provider service outage → 503
- [ ] Run RED:

```powershell
npm run test --workspace @brand-pilot/api -- server.aiContentCustomer.test.ts runtimeConfig.test.ts
```

- [ ] Extend runtime config:

```ts
export interface ApiRuntimeConfig {
  // existing fields
  aiContentAttachmentUploadSessionsEnabled: boolean;
}
```

- [ ] Parse only literal `true`/`false`, default false. Do not forbid a future approved production `true` in code; current deployment contracts will keep it false.
- [ ] Pass it as `aiContentUpload.uploadSessionsEnabled` in `CreateServerOptions`; do not read `process.env` inside request handlers.
- [ ] When enabled, token route:
  1. validates brand/generation UUID
  2. requires `aiContentActorUserId(request)`
  3. creates the DB session
  4. issues a provider token for its exact path
  5. marks the session failed if issuance throws
  6. returns `{ contractVersion, sessionId, nonce, pathname, clientToken, uploadExpiresAt, sessionExpiresAt }`, where the two timestamps expose the DB-minus-60-second provider boundary and the DB session boundary without ambiguity
- [ ] When disabled, call `assertAiContentAttachmentUploadMutable()` before provider issuance, then return the unchanged legacy `{ pathname, clientToken }`. Document the unavoidable legacy token race: this path has no reservation and its abandoned Blob is not discoverable until session issuance is enabled.
- [ ] Route new confirm through the actor-bound repository verifier; route legacy confirm through existing validation and legacy repository method.
- [ ] Add:

```text
POST /brands/:brandId/ai-content/generations/:generationId/attachments/cancel
body: {
  "sessionId": "30000000-0000-4000-8000-000000000001",
  "nonce": "Q01Wb0J3bG9iVXBsb2FkTm9uY2UyMDI2"
}
```

- [ ] Validate all route UUIDs before they reach PostgreSQL. Keep foreign-tenant IDs indistinguishable from missing IDs.
- [ ] Add `AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED=false` only to the repository example file; do not edit any local/Ubuntu secret-bearing env.
- [ ] Run GREEN:

```powershell
npm run test --workspace @brand-pilot/api -- server.aiContentCustomer.test.ts runtimeConfig.test.ts aiContentUpload.test.ts
npm run typecheck --workspace @brand-pilot/api
```

- [ ] Specification review: dual skew, flag default OFF, actor binding, exact errors, no env mutation must be `PASS`.
- [ ] Code-quality review: route parsing, provider/repository dependency injection, constant-time auth unaffected, error leakage must be `PASS`.
- [ ] Commit:

```powershell
git add apps/api/src/httpServer.ts apps/api/src/server.aiContentCustomer.test.ts apps/api/src/runtimeConfig.ts apps/api/src/runtimeConfig.test.ts apps/api/src/index.ts apps/api/.env.example
git commit -m "feat(api): serve dual attachment upload contracts"
```

## Task 5: Freeze subject and generation worker inputs

**Files:**

- Modify: `apps/api/src/aiContentSubjectContracts.ts`
- Modify: `apps/api/src/aiContentSubjectRepository.ts`
- Modify: `apps/api/src/aiContentSubjectRepository.test.ts`
- Modify: `apps/api/src/aiContentSubjectRepository.postgres.integration.test.ts`
- Modify: `apps/api/src/aiContentSubjectHttp.ts`
- Modify: `apps/api/src/aiContentSubjectHttp.test.ts`
- Modify: `apps/api/src/aiContentSubjectEvidence.ts`
- Modify: `apps/api/src/aiContentSubjectEvidence.test.ts`
- Modify: `apps/api/src/aiContentGenerationInput.ts`
- Modify: `apps/api/src/aiContentGenerationInput.test.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRepository.subjectSnapshot.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/index.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/worker.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-blog-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-blog-worker/src/index.ts`
- Modify: `workers/brand-pilot-blog-worker/src/worker.ts`
- Create: `workers/brand-pilot-blog-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-blog-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-marketing-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-marketing-worker/src/index.ts`
- Modify: `workers/brand-pilot-marketing-worker/src/worker.ts`
- Create: `workers/brand-pilot-marketing-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-marketing-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-worker-runtime/src/index.ts`
- Modify: `workers/brand-pilot-worker-runtime/src/index.test.ts`

- [ ] Define one structural snapshot:

```ts
export interface AiContentAttachmentSnapshot {
  id: string;
  generationId: string;
  role: AiContentAttachmentRole;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  storageUrl: string;
  storagePath: string;
  createdAt: string;
}
```

- [ ] Define the subject-job envelope explicitly:

```ts
export interface SubjectAttachmentSnapshotEnvelope {
  attachmentSnapshot: AiContentAttachmentSnapshot[];
  attachmentSnapshotMissingIds: string[];
}
```

- [ ] Add RED subject tests proving `requestSubjectAnalysis()` stores exactly the requested confirmed attachments in stable `(created_at, id)` order.
- [ ] Prove later logical removal/metadata mutation cannot change the claimed subject job.
- [ ] Prove subject snapshotting does not set the generation-wide lock and a later prompt attachment can still be reserved.
- [ ] Add RED generation tests proving `startAiContentGeneration()` writes `generation_input_snapshot`, sets `attachments_locked_at`, and puts the same attachment snapshot into analyze/generate job state.
- [ ] Add RED tests proving a queued generate claim performs no live attachment/reference lookup.
- [ ] Add RED tests proving attachment-bearing draft mutations after lock fail while a read/idempotent replay remains safe.
- [ ] Add RED tests proving subject request and final generation start return `ai_content_attachment_upload_in_progress` when a non-expired pending session exists.
- [ ] Add worker parser tests requiring every attachment snapshot field instead of accepting `unknown[]`.
- [ ] Add subject-evidence and generation-worker RED tests proving:
  - Blob not-found becomes non-retryable `ai_content_attachment_blob_unavailable`
  - provider/network timeout becomes retryable `ai_content_attachment_storage_unavailable`
  - mixed not-found plus timeout resolves deterministically to terminal not-found regardless of completion order
  - preflight runs before any Codex command
  - one missing snapshot Blob prevents partial generation
- [ ] Run RED:

```powershell
npm run test --workspace @brand-pilot/api -- aiContentSubjectRepository.test.ts aiContentSubjectHttp.test.ts aiContentGenerationInput.test.ts aiContentRepository.subjectSnapshot.test.ts
npm run test --workspace @brand-pilot/worker-runtime
npm run test --workspace @brand-pilot/card-news-worker
npm run test --workspace @brand-pilot/blog-worker
npm run test --workspace @brand-pilot/marketing-worker
```

- [ ] In the subject request transaction, lock generation, validate all requested IDs in tenant scope, store the full snapshot in `input_json`, and preserve `attachment_ids_json` for compatibility.
- [ ] Make `prepareV2Job()` and `loadSubjectEvidence()` consume `claim.input.attachmentSnapshot`; remove the live `listSubjectEvidenceAttachments()` read for new and backfilled V2 rows. Reject a non-empty `attachmentSnapshotMissingIds` before worker processing.
- [ ] In subject preparation, map retained Blob 404/not-found and snapshot/ID gaps to non-retryable `ai_content_attachment_blob_unavailable`; map timeout/network/5xx to retryable `ai_content_attachment_storage_unavailable`. Do not absorb either class into `sourceGaps`.
- [ ] Add a bounded worker-runtime snapshot preflight with injectable provider `head`. Wire each worker `index.ts` to call `head(storagePath, { token: BLOB_READ_WRITE_TOKEN, abortSignal })` using its existing Blob credential, then validate every snapshot path before launching Codex. Map not-found to terminal and transient provider failures to retryable storage-unavailable. Update `isRetryableContentWorkerError()` with these explicit codes, bound the whole at-most-five-Blob preflight to 15 seconds with one abort signal, and never log signed URLs.
- [ ] Use the same deterministic aggregate rule for subject and generation preflight: reject structural snapshot gaps first; otherwise collect all availability outcomes, let any confirmed not-found/mismatch terminal result outrank transient failures, choose the first terminal result in snapshot order, and return transient storage-unavailable only when no terminal result exists.
- [ ] At final generation start, build `ContentGenerationInputV2` once from active confirmed attachments/references, store it in `generation_input_snapshot`, and set `attachments_locked_at` in the same transaction.
- [ ] Keep `subject_analysis_snapshot` readable and populate it for legacy consumers without letting it replace a newer canonical snapshot.
- [ ] When the analyze job completes, derive the finalized `contentGenerationInput` from stored `generation_input_snapshot` plus the finalized quality brief and write that exact JSON into every generate job payload.
- [ ] Change `claimAiContentJob()` so a generate claim returns the stored payload only. It must not rebuild attachments, references, brand context, or content input from current rows.
- [ ] Compare attachment identities when updating a locked draft. Return `ai_content_attachments_locked` only when the attachment-bearing portion changes; do not silently rewrite the worker snapshot.
- [ ] Reject subject request/final start while a pending upload reservation is active; do not cancel or omit it implicitly.
- [ ] Run GREEN:

```powershell
npm run test --workspace @brand-pilot/api -- aiContentSubjectRepository.test.ts aiContentSubjectHttp.test.ts aiContentGenerationInput.test.ts aiContentRepository.subjectSnapshot.test.ts aiContentRepository.test.ts
npm run test --workspace @brand-pilot/worker-runtime
npm run test --workspace @brand-pilot/card-news-worker
npm run test --workspace @brand-pilot/blog-worker
npm run test --workspace @brand-pilot/marketing-worker
npm run typecheck --workspace @brand-pilot/api
```

- [ ] With Docker running:

```powershell
$env:RUN_POSTGRES_INTEGRATION = "true"
npm run test --workspace @brand-pilot/api -- aiContentSubjectRepository.postgres.integration.test.ts aiContentRepository.postgres.integration.test.ts --maxWorkers=1
Remove-Item Env:RUN_POSTGRES_INTEGRATION
```

- [ ] Specification review: both consumer snapshots, later prompt uploads, final lock, no live worker reads, terminal-not-found versus retryable-provider failure must be `PASS`.
- [ ] Code-quality review: snapshot parsing, stable ordering, payload size, bounded preflight/abort cleanup, legacy fallback, deterministic failure must be `PASS`.
- [ ] Commit:

```powershell
git add apps/api/src/aiContentSubjectContracts.ts apps/api/src/aiContentSubjectRepository.ts apps/api/src/aiContentSubjectRepository.test.ts apps/api/src/aiContentSubjectRepository.postgres.integration.test.ts apps/api/src/aiContentSubjectHttp.ts apps/api/src/aiContentSubjectHttp.test.ts apps/api/src/aiContentSubjectEvidence.ts apps/api/src/aiContentSubjectEvidence.test.ts apps/api/src/aiContentGenerationInput.ts apps/api/src/aiContentGenerationInput.test.ts apps/api/src/aiContentRepository.ts apps/api/src/aiContentRepository.subjectSnapshot.test.ts workers/brand-pilot-worker-runtime/src/index.ts workers/brand-pilot-worker-runtime/src/index.test.ts workers/brand-pilot-card-news-worker/src/contracts.ts workers/brand-pilot-card-news-worker/src/index.ts workers/brand-pilot-card-news-worker/src/worker.ts workers/brand-pilot-card-news-worker/src/worker.test.ts workers/brand-pilot-blog-worker/src/contracts.ts workers/brand-pilot-blog-worker/src/index.ts workers/brand-pilot-blog-worker/src/worker.ts workers/brand-pilot-blog-worker/src/worker.test.ts workers/brand-pilot-blog-worker/src/promptBuilder.test.ts workers/brand-pilot-marketing-worker/src/contracts.ts workers/brand-pilot-marketing-worker/src/index.ts workers/brand-pilot-marketing-worker/src/worker.ts workers/brand-pilot-marketing-worker/src/worker.test.ts workers/brand-pilot-marketing-worker/src/promptBuilder.test.ts
git commit -m "feat(api): freeze AI content attachment inputs"
```

## Task 6: Enforce 15-day retention and atomic retry arbitration

**Files:**

- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRepository.test.ts`
- Modify: `apps/api/src/aiContentRepository.postgres.integration.test.ts`
- Modify: `apps/api/src/server.aiContentCustomer.test.ts`
- Modify: `apps/api/src/types.ts`

- [ ] Add DTO fields:

```ts
attachmentsLockedAt: string | null;
terminalAt: string | null;
retryableUntil: string | null;
```

- [ ] Keep `generation_input_snapshot` internal to repository/job contracts. Never expose the snapshot, storage URLs/paths, or brand-context payload through the public generation DTO.
- [ ] Add RED tests for every terminal path: completed, partial failed, total failed, non-retryable analysis failure, and exhausted lease.
- [ ] Add RED boundary tests with DB time:
  - one instant before expiry succeeds
  - exact equality fails
  - after expiry fails
- [ ] Add RED tests proving retry uses the latest failed generate job’s `payload_json.contentGenerationInput` with canonical JSON semantic equality (stable-key deep equality or an equivalent canonical hash). Do not assert textual `jsonb` byte order.
- [ ] Add RED tests proving an approved retry creates its job/hold in the same transaction.
- [ ] Add RED concurrency tests for retry versus GC committed `deleting`.
- [ ] Run RED:

```powershell
npm run test --workspace @brand-pilot/api -- aiContentRepository.test.ts server.aiContentCustomer.test.ts
```

- [ ] Update terminal state only on a nonterminal → terminal transition so idempotent completion does not extend retention:

```sql
terminal_at = case
  when $4::boolean and status not in ('completed','partial_failed','failed')
    then now()
  else terminal_at
end,
retryable_until = case
  when $4::boolean and status not in ('completed','partial_failed','failed')
    then now() + interval '15 days'
  else retryable_until
end
```

- [ ] A retried generation may keep its previous timestamps while queued/processing; active jobs are the hold. When it transitions to terminal again, overwrite with the new terminal instant plus 15 days.
- [ ] In retry, lock generation first, then output, then inspect deletion jobs.
- [ ] Require `retryable_until > now()`; equality is expired.
- [ ] Reject if any snapshot path already has a committed `deleting` or `deleted` job.
- [ ] Insert the retry job with the exact stored generate payload before releasing locks. Do not query live attachments.
- [ ] Return `ai_content_attachment_retention_expired` through the existing output retry route as HTTP 410.
- [ ] Remove every call to immediate terminal Blob deletion; physical cleanup belongs only to Task 7/8.
- [ ] Run GREEN:

```powershell
npm run test --workspace @brand-pilot/api -- aiContentRepository.test.ts server.aiContentCustomer.test.ts
npm run typecheck --workspace @brand-pilot/api
```

- [ ] With Docker running:

```powershell
$env:RUN_POSTGRES_INTEGRATION = "true"
npm run test --workspace @brand-pilot/api -- aiContentRepository.postgres.integration.test.ts --maxWorkers=1
Remove-Item Env:RUN_POSTGRES_INTEGRATION
```

- [ ] Specification review: exact 15 days, no idempotent extension, canonically equivalent retry payload, DB boundary, lock order must be `PASS`.
- [ ] Code-quality review: all terminal paths, transaction rollback, timestamp semantics, error mapping must be `PASS`.
- [ ] Commit:

```powershell
git add apps/api/src/aiContentRepository.ts apps/api/src/aiContentRepository.test.ts apps/api/src/aiContentRepository.postgres.integration.test.ts apps/api/src/server.aiContentCustomer.test.ts apps/api/src/types.ts
git commit -m "feat(api): enforce attachment retry retention"
```

## Task 7: Implement durable GC preparation, claims, leases, and fencing

**Files:**

- Create: `apps/api/src/aiContentAttachmentGcRepository.ts`
- Create: `apps/api/src/aiContentAttachmentGcRepository.test.ts`
- Create: `apps/api/src/aiContentAttachmentGc.postgres.integration.test.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRepository.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.ts`

- [ ] Add RED tests for:
  - pending/failed/cancelled session expiry creates one deletion job
  - logical deletion without a consumer hold becomes due
  - terminal attachment becomes due only after `retryable_until`
  - queued/processing subject snapshot blocks its paths
  - queued/processing generation job snapshot blocks its paths
  - a completed output `manifest_url` or `artifact_manifest_json.assets[*].url` reference blocks its attachment
  - a linked channel output/publish reference blocks its attachment until an independent artifact replaces that URL
  - legacy-backfilled deletion obligations honor the same completed-artifact/publish holds
  - generation/workspace cascade with a still-valid upload token creates a job due at `token_expires_at`; GC cannot claim before that instant, a provider-mock upload may land meanwhile, and GC can claim/delete it after expiry
  - two GC callers never claim the same job
  - expired lease gets a fresh token
  - stale token cannot complete/fail a reclaimed lease
  - a budget-skipped claim is fenced back to pending without incrementing its attempt or reaching dead letter
  - provider not-found finalization counts as deleted
  - transient failure schedules retry using DB `now()`
  - auth/permanent error or max attempts reaches dead letter
  - parent deletion leaves a claimable job
  - a partial batch failure does not roll back successful jobs
  - an older permanently held job never blocks a younger eligible job
  - eligible queue depth/age excludes held jobs while held count/age/reason metrics remain observable
- [ ] Run unit RED:

```powershell
npm run test --workspace @brand-pilot/api -- aiContentAttachmentGcRepository.test.ts
```

- [ ] Implement:

```ts
interface AiContentGcDbBudget {
  remainingBudgetMs: number;
  statementTimeoutMs: number;
}

interface AiContentAttachmentGcRepository {
  prepareAiContentAttachmentGc(input: {
    limit: number;
  } & AiContentGcDbBudget): Promise<{
    sessionsScanned: number;
    sessionsClaimed: number;
    sessionsConfirmed: number;
    sessionsExpired: number;
    jobsCreated: number;
    leasesReclaimed: number;
  }>;
  claimAiContentAttachmentDeletionJobs(input: {
    workerId: string;
    batchSize: number;
    leaseSeconds: number;
  } & AiContentGcDbBudget): Promise<AiContentAttachmentDeletionClaim[]>;
  beginAiContentAttachmentDeletionAttempt(input: {
    jobId: string;
    leaseToken: string;
  } & AiContentGcDbBudget): Promise<number | null>;
  releaseUnstartedAiContentAttachmentDeletions(input: {
    claims: Array<{ jobId: string; leaseToken: string }>;
  } & AiContentGcDbBudget): Promise<number>;
  completeAiContentAttachmentDeletion(input: {
    jobId: string;
    leaseToken: string;
    outcome: "deleted" | "not_found";
  } & AiContentGcDbBudget): Promise<boolean>;
  failAiContentAttachmentDeletion(input: {
    jobId: string;
    leaseToken: string;
    errorCategory: string;
    errorMessage: string;
    retryDelaySeconds: number | null;
  } & AiContentGcDbBudget): Promise<"retry" | "dead_letter" | "stale">;
  getAiContentAttachmentGcMetrics(
    input: AiContentGcDbBudget,
  ): Promise<{
    eligibleQueueDepth: number;
    oldestEligiblePendingAgeSeconds: number | null;
    heldJobCount: number;
    oldestHeldAgeSeconds: number | null;
    holdReasonCounts: Record<string, number>;
    attemptCountBuckets: Record<string, number>;
    deadLetterCount: number;
  }>;
}
```

- [ ] Preparation uses DB `now()`, bounded rows, idempotent job insertion, and marks session/attachment physical state without remote I/O.
- [ ] Preserve the current generated-result safety rule: exact/canonically normalized attachment URL references from completed output `manifest_url`, `artifact_manifest_json.assets[*].url`, linked `channel_outputs.output_json.cards[*].url`, or `output_json.story.url` (and therefore its publish queue/attempts) are durable holds. GC may proceed only after the reference is removed or replaced by an independently stored generated artifact; never infer promotion from status alone.
- [ ] Apply retention/job/artifact/publish anti-hold predicates **before** candidate `order by/limit`, then recheck them after locking. Held rows cannot occupy the bounded claim window. Use the same eligibility predicate for `eligibleQueueDepth` and `oldestEligiblePendingAgeSeconds`; report held rows separately by age and reason.
- [ ] For jobs with a live generation, claim each candidate using this lock order:
  1. lock tenant generation row
  2. lock deletion job `for update skip locked`
  3. re-evaluate retention and subject/generation job holds
  4. write `deleting` with a fresh lease token/expiry without incrementing the attempt
  5. commit
- [ ] For orphaned parent rows, lock only the deletion job and claim it after the same due-state checks.
- [ ] Use a bounded candidate read followed by per-candidate transactions so planner lock ordering cannot invert generation → job.
- [ ] Immediately before provider I/O, `beginAiContentAttachmentDeletionAttempt()` increments the attempt with a lease-token CAS and returns the new count. One set-based `releaseUnstartedAiContentAttachmentDeletions()` call uses `(job_id, lease_token)` pairs to return all budget-skipped claims to `pending`, clear leases, set `next_attempt_at = now()`, and consume no attempts.
- [ ] Every repository operation receives the runner’s freshly computed remaining budget and a no-larger statement timeout. A shared transaction helper bounds pool acquisition, executes `set local statement_timeout`, rejects work after the budget, and releases a connection that arrives after timeout; lease recovery remains the crash fallback.
- [ ] Use compare-and-set finalize/fail:

```sql
where id = $1
  and status = 'deleting'
  and lease_token = $2::uuid
```

- [ ] In the same compare-and-set transaction, mirror only the summary `physical_delete_status` (and final `physically_deleted_at`) onto the attachment when it still exists for claim, release, retry failure, dead letter, and completion. Attempt/lease/error state exists only on the authoritative deletion job.
- [ ] Use capped exponential retry metadata, but accept the actual jittered delay from the runner so tests can inject randomness.
- [ ] Persist only a bounded, redacted provider error category/message. Strip authorization values, nonce/token-like text, and URL query strings before writing deletion jobs as well as before logging.
- [ ] Remove `deleteTerminalGenerationAttachments()` and `retryPendingTerminalAttachmentCleanup()` and remove cleanup side effects from `claimAiContentJob()`.
- [ ] Run unit GREEN:

```powershell
npm run test --workspace @brand-pilot/api -- aiContentAttachmentGcRepository.test.ts aiContentRepository.test.ts
npm run typecheck --workspace @brand-pilot/api
```

- [ ] Run real PostgreSQL RED/GREEN with Docker:

```powershell
$env:RUN_POSTGRES_INTEGRATION = "true"
npm run test --workspace @brand-pilot/api -- aiContentAttachmentGc.postgres.integration.test.ts aiContentRepository.postgres.integration.test.ts --maxWorkers=1
Remove-Item Env:RUN_POSTGRES_INTEGRATION
```

Expected GREEN: `SKIP LOCKED`, expired lease reclaim, fencing, retention, retry-vs-GC, and parent deletion tests all pass against PostgreSQL 16.

- [ ] Specification review: due classes, retry/job/artifact/publish holds, parent independence, generation-first lock, fencing, no worker side effect must be `PASS`.
- [ ] Code-quality review: starvation/fair ordering, lease duration, retry caps, JSON-reference query plans, partial batch behavior must be `PASS`.
- [ ] Commit:

```powershell
git add apps/api/src/aiContentAttachmentGcRepository.ts apps/api/src/aiContentAttachmentGcRepository.test.ts apps/api/src/aiContentAttachmentGc.postgres.integration.test.ts apps/api/src/aiContentRepository.ts apps/api/src/aiContentRepository.test.ts apps/api/src/types.ts apps/api/src/repository.ts
git commit -m "feat(api): add durable attachment deletion leases"
```

## Task 8: Add the provider GC runner and secret internal endpoint

**Files:**

- Create: `apps/api/src/aiContentAttachmentGc.ts`
- Create: `apps/api/src/aiContentAttachmentGc.test.ts`
- Create: `apps/api/src/server.aiContentAttachmentGc.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/index.ts`

- [ ] Add RED runner tests for default batch 25, hard max 100, provider timeout 15 seconds, hard runner budget 45 seconds, a call considered at second 44, and structured metrics.
- [ ] Add a RED `batchSize=100`/slow-DB test proving claims are acquired only up to current worker concurrency, all unstarted leases use one bounded bulk release, DB calls receive the remaining deadline, and the runner returns by its deadline without consuming/dead-lettering unstarted attempts.
- [ ] Add RED provider classification tests:
  - deleted and not-found → success
  - rate limit/service/network/timeout → retry
  - 401/403/access error → dead letter
  - one failure does not cancel other claims
- [ ] Add RED endpoint tests for constant-time bearer auth, missing dependencies, invalid batch sizes, defaults, result body, and secret-safe logs.
- [ ] Run RED:

```powershell
npm run test --workspace @brand-pilot/api -- aiContentAttachmentGc.test.ts server.aiContentAttachmentGc.test.ts
```

- [ ] Implement the runner with injectable monotonic clock/random/delete function:

```ts
type DeleteAiContentAttachmentBlob = (
  urlOrPath: string,
  options: { abortSignal: AbortSignal },
) => Promise<void>;

runAiContentAttachmentGc(repository, {
  workerId,
  batchSize: 25,
  leaseSeconds: 90,
  concurrency: 4,
  providerTimeoutMs: 15_000,
  budgetMs: 45_000,
  cleanupReserveMs: 2_000,
  dbStatementTimeoutMaxMs: 2_000,
  deleteBlob,
  random,
});
```

- [ ] Return a structured, secret-safe result that combines preparation, deletion, and queue health:

```ts
interface AiContentAttachmentGcRunResult {
  sessions: {
    scanned: number;
    claimed: number;
    confirmed: number;
    expired: number;
  };
  deletions: {
    claimed: number;
    started: number;
    succeeded: number;
    failed: number;
    retried: number;
    releasedUnstarted: number;
  };
  leasesReclaimed: number;
  eligibleQueueDepth: number;
  oldestEligiblePendingAgeSeconds: number | null;
  heldJobCount: number;
  oldestHeldAgeSeconds: number | null;
  holdReasonCounts: Record<string, number>;
  attemptCountBuckets: Record<string, number>;
  deadLetterCount: number;
  durationMs: number;
  providerErrorCategories: Record<string, number>;
}
```

- [ ] Claim commits before any provider call. Claim just-in-time chunks of at most the free concurrency slots instead of claiming the whole requested batch. Do not claim/begin new work when `remainingMs <= cleanupReserveMs + dbStatementTimeoutMaxMs`. Process against one absolute deadline, reserving the final 2 seconds for fenced finalize/release; do not start provider I/O when `remainingMs <= 2_000`, and give every started call `min(providerTimeoutMs, remainingMs - 2_000)` before aborting it.
- [ ] Immediately before prepare/claim/begin/finalize/fail/metrics, recompute and pass `remainingBudgetMs` plus `min(dbStatementTimeoutMaxMs, remainingBudgetMs)`. Call the fenced begin-attempt method immediately before each provider call and use its returned attempt count for backoff.
- [ ] Collect every claim that was not started and release the array with one bulk fenced repository call inside the cleanup reserve. If that bounded DB call times out, return by the hard deadline and rely on lease expiry; because begin-attempt was never called, retry budget is still untouched.
- [ ] Use this jittered exponential backoff with an exact 3,600-second cap:

```ts
Math.min(
  3600,
  Math.ceil(
    30 * 2 ** (attemptCount - 1)
      * (0.8 + random() * 0.4),
  ),
)
```

- [ ] Add:

```text
POST /internal/cron/ai-content-attachment-gc
Authorization: Bearer ${CRON_SECRET}
body: { "batchSize": 25 } // optional
```

- [ ] Reuse `matchesBearerSecret()`. Do not gate cleanup behind upload-session issuance.
- [ ] Return/log only:
  - sessions scanned/claimed/confirmed/expired
  - deletion claimed/succeeded/failed/retried
  - leases reclaimed
  - eligible queue depth/oldest eligible age
  - held count/oldest held age/reason buckets
  - attempt buckets/dead letters
  - duration/provider error category
- [ ] Never log nonce, Blob token, cron secret, complete storage URL query strings, or user metadata.
- [ ] Wire `@vercel/blob.del` through `index.ts`; do not register the route with local scheduler or any deployment timer.
- [ ] Delete by `claim.storageUrl ?? claim.storagePath`; Vercel Blob accepts either, which also covers never-confirmed uploads that have no stored URL.
- [ ] Run GREEN:

```powershell
npm run test --workspace @brand-pilot/api -- aiContentAttachmentGc.test.ts server.aiContentAttachmentGc.test.ts
npm run typecheck --workspace @brand-pilot/api
```

- [ ] Specification review: claim-before-I/O, time/batch bounds, not-found idempotency, metrics, endpoint auth, flag independence must be `PASS`.
- [ ] Code-quality review: abort handling, promise cleanup, error taxonomy, log redaction, budget behavior must be `PASS`.
- [ ] Commit:

```powershell
git add apps/api/src/aiContentAttachmentGc.ts apps/api/src/aiContentAttachmentGc.test.ts apps/api/src/server.aiContentAttachmentGc.test.ts apps/api/src/httpServer.ts apps/api/src/index.ts
git commit -m "feat(api): expose fenced attachment gc endpoint"
```

## Task 9: Consume the dual upload contract and preserve failed drafts in the UI

**Files:**

- Modify: `apps/customer-ui/src/features/ai-content/types.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts`
- Create: `apps/customer-ui/src/features/ai-content/attachmentErrors.ts`
- Create: `apps/customer-ui/src/features/ai-content/attachmentErrors.test.ts`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentAttachmentUploader.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentAttachmentUploader.test.tsx`
- Modify: `apps/customer-ui/src/components/ui/FileUploadButton.tsx`
- Modify: `apps/customer-ui/src/components/ui/FileUploadButton.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/SubjectAnalysisStep.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/SubjectAnalysisStep.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/GenerationPromptStep.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/GenerationPromptStep.test.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentWizardPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`

- [ ] Add RED gateway tests for:
  - legacy token → legacy confirm body
  - session token → `{ sessionId, nonce }` confirm body only
  - one ambiguous/lost confirm response → same confirm body replayed, Blob put called once
  - explicit 4xx → no automatic confirm retry
  - Blob put failure → best-effort session cancel
- [ ] Add RED uploader tests for exact guidance:
  - limit → existing “최대 5개” copy
  - session expiry → select the file again
  - lock → start a new generation
  - storage outage → keep current draft/file and offer retry
- [ ] Add RED tests proving an active visible duplicate remains rejected, while—when the gateway receives the session contract—a failed or previously removed same file starts a fresh upload attempt.
- [ ] Add RED gateway/page tests proving pending/failed local placeholders, `File`, `uploadStatus`, session ID, and nonce are never serialized into create/update draft bodies; only confirmed server attachment records are persisted.
- [ ] Run RED:

```powershell
npm run test --workspace @brand-pilot/customer-ui -- aiContentApiGateway.test.ts attachmentErrors.test.ts AiContentAttachmentUploader.test.tsx FileUploadButton.test.tsx SubjectAnalysisStep.test.tsx GenerationPromptStep.test.tsx aiContentWizard.test.tsx
```

- [ ] Discriminate token responses by `sessionId` and `nonce`; do not add a Vite/customer feature flag.
- [ ] Retry only an ambiguous transport/5xx confirm once with the identical session pair. Never upload the Blob twice for that attempt.
- [ ] Keep nonce/session details inside the gateway flow rather than persisting them in the public generation draft.
- [ ] On a definite Blob put failure, call session cancel best-effort and surface the original storage error.
- [ ] Extend file upload item status with `failed` and add `onRetry(id)`.
- [ ] Add `uploadStatus?: "pending" | "failed" | "confirmed"` to the local `GenerationAttachment` UI model. Add the local file to draft state before direct upload, replace it with the confirmed record on success, and retain its `File` after failure.
- [ ] Make both `serializableDraft()` and gateway `serializeDraft()` filter attachment arrays to confirmed server records and strip all local-only fields. Rehydrated API drafts contain confirmed records only.
- [ ] Disable subject-analysis and final-generation actions while any local attachment is pending/failed, and map a server race returning `ai_content_attachment_upload_in_progress` to the same finish-or-retry guidance.
- [ ] A failed item’s retry asks the server for a fresh session/attempt.
- [ ] Preserve the feature-ledger duplicate rule for an already active visible attachment. Do not apply it to failed/removed items.
- [ ] Map lifecycle errors in one focused helper and keep unrelated input intact.
- [ ] Render locked/expired guidance in both subject and generation-prompt attachment locations.
- [ ] Run GREEN:

```powershell
npm run test --workspace @brand-pilot/customer-ui -- aiContentApiGateway.test.ts attachmentErrors.test.ts AiContentAttachmentUploader.test.tsx FileUploadButton.test.tsx SubjectAnalysisStep.test.tsx GenerationPromptStep.test.tsx aiContentWizard.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

- [ ] Specification review: dual skew, one put, confirm replay, cancel, draft preservation, existing duplicate/limit behavior must be `PASS`.
- [ ] Code-quality review: error classification, state races, refs, accessibility, retry control, unmount safety must be `PASS`.
- [ ] Commit:

```powershell
git add apps/customer-ui/src/features/ai-content/types.ts apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts apps/customer-ui/src/features/ai-content/attachmentErrors.ts apps/customer-ui/src/features/ai-content/attachmentErrors.test.ts apps/customer-ui/src/components/ai-content/AiContentAttachmentUploader.tsx apps/customer-ui/src/components/ai-content/AiContentAttachmentUploader.test.tsx apps/customer-ui/src/components/ui/FileUploadButton.tsx apps/customer-ui/src/components/ui/FileUploadButton.test.tsx apps/customer-ui/src/components/ai-content/SubjectAnalysisStep.tsx apps/customer-ui/src/components/ai-content/SubjectAnalysisStep.test.tsx apps/customer-ui/src/components/ai-content/GenerationPromptStep.tsx apps/customer-ui/src/components/ai-content/GenerationPromptStep.test.tsx apps/customer-ui/src/pages/AiContentWizardPage.tsx apps/customer-ui/src/__tests__/aiContentWizard.test.tsx
git commit -m "feat(customer-ui): support attachment upload sessions"
```

## Task 10: Show and enforce retry retention in the UI

**Files:**

- Modify: `apps/customer-ui/src/features/ai-content/types.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts`
- Modify: `apps/customer-ui/src/features/ai-content/mockAiContentGateway.ts`
- Modify: `apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentGenerationPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx`
- Modify: `apps/customer-ui/e2e/ai-content-runtime.spec.ts`

- [ ] Map `attachmentsLockedAt`, `terminalAt`, and `retryableUntil` from API generation DTOs.
- [ ] With a fixed clock, add RED tests:
  - before deadline: show deadline and retry form
  - exact deadline: hide/disable retry and show new-generation/file-reupload guidance
  - after deadline: same expired state
  - stale UI receives API 410: replace retry form with expired guidance
- [ ] Add an E2E route fixture proving an expired failed output cannot trigger a retry request.
- [ ] Run RED:

```powershell
npm run test --workspace @brand-pilot/customer-ui -- aiContentApiGateway.test.ts aiContentGeneration.test.tsx
npm run e2e --workspace @brand-pilot/customer-ui -- --grep "attachment retry retention"
```

- [ ] Add nullable lifecycle fields without changing existing status/type/output mappings.
- [ ] Treat the boundary as expired when `Date.now() >= Date.parse(retryableUntil)`.
- [ ] Treat `retryableUntil: null` as legacy/unknown and preserve the existing retry form until the API adjudicates it; only a concrete expired timestamp or API 410 hides retry.
- [ ] Before expiry, show the Korean-localized deadline and existing reason input.
- [ ] At/after expiry, remove the actionable retry control and explain that a new generation and file re-upload are required.
- [ ] Catch `ai_content_attachment_retention_expired` in `AiContentGenerationPage`, invalidate stale retry availability, and retain other output/download/publish state.
- [ ] Run GREEN:

```powershell
npm run test --workspace @brand-pilot/customer-ui -- aiContentApiGateway.test.ts aiContentGeneration.test.tsx
npm run e2e --workspace @brand-pilot/customer-ui -- --grep "attachment retry retention"
npm run build --workspace @brand-pilot/customer-ui
```

- [ ] Specification review: before/equal/after semantics, API 410 convergence, honest guidance, unrelated actions preserved must be `PASS`.
- [ ] Code-quality review: clock/timezone parsing, state update, accessibility, mock compatibility must be `PASS`.
- [ ] Commit:

```powershell
git add apps/customer-ui/src/features/ai-content/types.ts apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts apps/customer-ui/src/features/ai-content/mockAiContentGateway.ts apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx apps/customer-ui/src/pages/AiContentGenerationPage.tsx apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx apps/customer-ui/e2e/ai-content-runtime.spec.ts
git commit -m "feat(customer-ui): enforce attachment retry retention"
```

## Task 11: Lock the first rollout OFF and run the attachment-preservation regression

**Files:**

- Modify: `deploy/env/api.env.example`
- Modify: `deploy/compose.production.yml`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `docs/operations/UBUNTU_DEPLOYMENT.md`
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `docs/prd/brand-pilot-feature-preservation-ledger.md`

- [ ] Add deployment-contract RED assertions that:
  - `AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED=false` is present in the reviewed example
  - both canary and primary API services force the safe false value for this rollout
  - preflight accepts only exact false
  - the runbook lists it in safe-value and final evidence checks
  - no deploy script calls `/internal/cron/ai-content-attachment-gc`
  - no systemd service/timer or local scheduler registration is added
  - no checked-in value enables the flag
- [ ] Run RED:

```powershell
npm run test:deployment
```

- [ ] Update only version-controlled examples/contracts/runbook. Do not edit a real `.env`, `/opt/brand-pilot/shared/env/api.env`, a running container, or Ubuntu host.
- [ ] Document the endpoint as implemented-but-not-scheduled and state that activation requires a later Operations/rollout approval.
- [ ] Document the flag-OFF residual risk: abandoned legacy uploads remain undiscoverable because no session row exists. State that the discoverability guarantee begins only after approved session issuance and a full legacy-token TTL drain.
- [ ] Document emitted metrics and the future Operations alert thresholds: nonzero dead letters, oldest eligible pending age over 24 hours, or repeated provider failures for five consecutive scheduled runs. Implement metric fields and runbook response steps now, but explicitly defer alert-rule wiring and activation until GC scheduling is approved.
- [ ] Keep migration forward-only; application rollback means flag OFF, while deletion obligations remain.
- [ ] Update the preservation ledger’s content attachment row with:
  - total five
  - MIME/size limits
  - active duplicate warning
  - removed/failed same-file fresh attempt when upload-session issuance is enabled
  - immutable worker snapshot
  - 15-day retry boundary
  - draft preservation on storage failure
  - exact automated test commands
- [ ] Run the complete non-PostgreSQL regression:

```powershell
npm test
npm run test:migrations
npm run test:contract
npm run test:deployment
npm run test --workspace @brand-pilot/api
npm run typecheck --workspace @brand-pilot/api
npm run test --workspace @brand-pilot/customer-ui
npm run build --workspace @brand-pilot/customer-ui
npm run test --workspace @brand-pilot/subject-analysis-worker
npm run test --workspace @brand-pilot/card-news-worker
npm run test --workspace @brand-pilot/blog-worker
npm run test --workspace @brand-pilot/marketing-worker
npm run build
```

- [ ] Run all attachment-related PostgreSQL 16 suites with Docker:

```powershell
$env:RUN_POSTGRES_INTEGRATION = "true"
npm run test --workspace @brand-pilot/api -- aiContentSubjectRepository.postgres.integration.test.ts aiContentRepository.postgres.integration.test.ts aiContentAttachmentGc.postgres.integration.test.ts --maxWorkers=1
Remove-Item Env:RUN_POSTGRES_INTEGRATION
```

- [ ] Run the full AI-content E2E:

```powershell
npm run e2e --workspace @brand-pilot/customer-ui -- --grep "AI content|attachment|generation"
```

- [ ] Confirm `git diff --check`, no secret-like value, and no actual env/Ubuntu mutation.
- [ ] Final specification review against every acceptance criterion in design §14 and the preservation ledger must be `PASS`.
- [ ] Final code-quality review across migration/API/worker/UI/operations, with special focus on SQL concurrency and rollback behavior, must be `PASS`.
- [ ] Commit:

```powershell
git add deploy/env/api.env.example deploy/compose.production.yml deploy/scripts/preflight.sh docs/operations/UBUNTU_DEPLOYMENT.md scripts/deployment-contract.test.mjs docs/prd/brand-pilot-feature-preservation-ledger.md
git commit -m "chore(deploy): dark-launch attachment lifecycle"
```

## Dark-launch implementation completion gate

The lifecycle implementation is ready for dark launch only when all of the following are true:

- migration fresh/upgrade/backfill/convergence tests pass
- new and legacy HTTP contracts pass during deployment skew
- with upload-session issuance enabled in tests, same-file fresh attempts never overwrite retained snapshot Blobs
- subject and generation jobs prove immutable attachment input
- missing retained Blob is terminal while transient provider failure remains retryable
- retry before 15 days succeeds and exact/after boundary fails
- two real PostgreSQL GC callers, lease reclaim, stale fencing, and retry-vs-GC tests pass
- completed manifest/channel/publish references remain protected from GC
- provider failure/not-found/dead-letter behavior passes
- UI preserves failed drafts and displays honest expiry/lock guidance
- the feature flag remains false in the first rollout contract
- the runbook states that flag-OFF abandoned legacy uploads remain undiscoverable until session activation plus token drain
- there is no new scheduler/timer and no production deployment/env change
- the feature-preservation regression stays green

This gate does **not** claim production garbage collection is active or that eventual deletion has occurred. Actual GC alert activation, scheduling, issuance-flag enablement, and operational deletion evidence remain deferred to the later Operations integration and explicit rollout approval. After this gate, return to Content Creation plan Task 2.
