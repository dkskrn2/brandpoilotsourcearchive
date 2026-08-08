# Three-Format API and Customer UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every first-party content-generation entry point to Proposal V2, freeze canonical V3 input only at start, settle quota exactly once, and expose exactly three formats plus two independent purposes in the customer UI.

**Architecture:** One transaction-aware Proposal V2 service serves manual Studio, performance experiments, and automated card-news. Proposal selection creates only a draft. Start owns immutable input assembly, prompt binding, reservation, and first-job creation. API and UI import the canonical contract package and reject retired values; they do not guess, alias, or repair them.

**Tech Stack:** TypeScript, Fastify, React 18, PostgreSQL/PGlite repositories, Vitest, Playwright, `@brand-pilot/content-contracts`.

**Prerequisites:** Complete Phases 1 and 2. Do not add DDL here. Do not run any non-content worker.

---

## Task 1: Introduce the transaction-aware Proposal V2 service

**Files:**

- Create: `apps/api/src/aiContentProposalV2Service.ts`
- Create: `apps/api/src/aiContentProposalV2Service.test.ts`
- Create: `apps/api/src/aiContentProposalV2Repository.pglite.test.ts`
- Create: `apps/api/src/aiContentProposalV2Repository.postgres.integration.test.ts`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Modify: `apps/api/src/contentOrchestration.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.aiContentCustomer.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `scripts/run-content-orchestration-postgres-tests.mjs`
- Create: `scripts/run-content-orchestration-postgres-tests.test.mjs`

- [ ] **Step 1: Write RED service and repository tests**

Cover manual, performance, and scheduled commands; caller-owned transactions; nullable system actor replay with `IS NOT DISTINCT FROM`; same-key/same-fingerprint replay; changed-fingerprint conflict; replay-before-mutable-resolution; and the common proposal-enabled/worker-heartbeat readiness gate. Exact committed replay is allowed after its frozen source later disappears; a genuinely new write fails closed when current sources/readiness are unavailable. Add a named `incident_unexpected_proposal_409` regression in `aiContentProposalV2Service.test.ts`: its legacy fake writer reproduces the old same-key/same-payload concurrent `409`, while the new locked/rechecked service must return one created identity plus exact replays; only the changed-fingerprint control remains `409`. Phase 5 links exported request/fingerprint evidence to this test rather than inventing a new production-only reproduction.

Pin the existing manual customer HTTP contract: exact request body and seed-resolution behavior, exact idempotency header name/requirement, exact response body/status, and selected-proposal identity remain unchanged; only readiness ordering changes. Add a server test that submits the current manual payload twice with one stable key, receives the same batch identity/response shape, and then selects the same stored proposal without a body/header adapter. Missing readiness fails before source resolution or mutation, while exact committed replay still returns. No new V2 migration may force the browser to send frozen snapshots, evidence internals, worker requests, or a renamed header.

Repository tests require enqueue to insert exactly one immutable proposal-job contract row from the verified catalog with request/base hashes but no fabricated composed-input hash. Prevalidated performance seals its already-evidenced composition in the same transaction. Manual/scheduled claims first return `research_required`; after canonical research evidence is committed, the server composer exclusive-inserts the one composition row, returns the persisted job to `queued`, and makes the next claim DTO derive `composition_ready` from that sealed row. Claim/model start then returns that contract/composition plus attempt number; completion/failure requires matching append-only attempt events and commits the terminal event atomically with proposal/job state. PostgreSQL concurrency fixtures cover two simultaneous composition seals, prevention of research reclaim once composition exists, lease expiry, stale token, exact completion replay, and model/schema/command/composed-hash mismatch. Selection/start can use only the successful attested attempt and sealed composition recorded by the selected proposal.

```ts
type CreateProposalBatchV2Command = {
  workspaceId: string;
  brandId: string;
} & (
  | { source: "manual"; actorUserId: string; request: ContentOrchestrationV2; idempotencyKey: string }
  | { source: "performance_experiment"; actorUserId: string; experimentId: string; evidenceVersion: string }
  | {
      source: "scheduled_crawl";
      callerOperationKey: string;
      contentTopicId: string;
      sourceSnapshotIds: string[];
      legacySourceOutputId: string | null;
      request: ContentOrchestrationV2;
    }
);
```

- [ ] **Step 2: Prove RED**

```powershell
npm test --workspace @brand-pilot/api -- src/aiContentProposalV2Service.test.ts
npm test --workspace @brand-pilot/api -- src/aiContentProposalV2Repository.pglite.test.ts
npm test --workspace @brand-pilot/api -- src/server.aiContentCustomer.test.ts -t "preserves the manual Proposal V2 HTTP contract"
```

Expected: missing service/transaction port and failed nullable-actor/concurrency assertions.

- [ ] **Step 3: Implement one service boundary**

```ts
interface AiContentProposalV2Service {
  create(
    command: CreateProposalBatchV2Command,
    options?: { tx?: ProposalV2Transaction },
  ): Promise<{
    disposition: "created" | "replayed";
    proposalRunId: string | null;
    proposalBatchId: string;
    status: "proposal_pending";
  }>;
}
```

Manual/performance open exactly one transaction; scheduled uses the caller's transaction. Probe committed replay before mutable resolution, check readiness, acquire the scoped key lock, recheck, then validate and insert. Retain the exact stored Proposal V2 worker request separately for audit. In that same transaction insert the canonical proposal-job enqueue contract described in Phase 2 Task 3B; no caller supplies its hashes/model/command identity. Insert a composition at enqueue only when server-owned evidence is already frozen; otherwise expose the authenticated research-complete boundary that persists evidence and invokes the deterministic server composer exactly once. Claim, attempt events, completion, failure, and replay use the sealed composition's final aggregate hash. On reads, reconstruct a safe exact-parser-valid `resumeInput` projection from `input_snapshot_json`: `contractVersion`, required batch `brandId`, `seed`, `contentInstruction`, `productId`, `purpose`, and `outputSettings` only. It must not expose frozen brand core, raw performance metrics, internal evidence, reference snapshots, attachments, prompt bindings, or the worker request itself. There is no canary-only bypass and every source creates exactly one batch/job or returns the same committed identity.

Add the direct `@brand-pilot/content-contracts` dependency. Update the API package `pretest`/`prebuild` lifecycle to build it before API compilation (while preserving its existing worker-runtime pretest). Refactor `scripts/run-content-orchestration-postgres-tests.mjs` to own an exported, explicit test-file registry and add `aiContentProposalV2Repository.postgres.integration.test.ts`; the runner test asserts that file is actually passed to Vitest with `RUN_POSTGRES_INTEGRATION=true`. Later tasks extend the same registry rather than creating unexecuted integration files.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm install
npm test --workspace @brand-pilot/api -- src/aiContentProposalV2Service.test.ts src/aiContentProposalV2Repository.pglite.test.ts
npm test --workspace @brand-pilot/api -- src/server.aiContentCustomer.test.ts -t "preserves the manual Proposal V2 HTTP contract"
npm run test:content-orchestration-postgres --workspace @brand-pilot/api
node --test scripts/run-content-orchestration-postgres-tests.test.mjs
git add apps/api/package.json apps/api/src/aiContentProposalV2Service.ts apps/api/src/aiContentProposalV2Service.test.ts apps/api/src/aiContentProposalV2Repository.pglite.test.ts apps/api/src/aiContentProposalV2Repository.postgres.integration.test.ts apps/api/src/contentOrchestration.ts apps/api/src/aiContentRepository.ts apps/api/src/index.ts apps/api/src/httpServer.ts apps/api/src/server.aiContentCustomer.test.ts apps/api/src/types.ts scripts/run-content-orchestration-postgres-tests.mjs scripts/run-content-orchestration-postgres-tests.test.mjs package-lock.json
git commit -m "feat(api): centralize proposal v2 creation"
```

## Task 2: Migrate performance experiments to Proposal V2

**Files:**

- Create: `apps/api/src/performanceProposalAdapter.ts`
- Create: `apps/api/src/performanceProposalAdapter.test.ts`
- Modify: `apps/api/src/performanceInsights.ts`
- Modify: `apps/api/src/performanceInsights.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.performanceInsightsCustomer.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/aiContentProposalV2Service.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentProposalV2Repository.pglite.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/customer-ui/src/features/performance/performanceGateway.ts`
- Modify: `apps/customer-ui/src/features/performance/performanceGateway.test.ts`
- Modify: `apps/customer-ui/src/types.ts`

- [ ] **Step 1: Write RED tests for identifier-only input and stale evidence**

The browser request is exactly `{ experimentId, evidenceVersion }`. The server reloads authoritative 30-day data, reruns the same experiment builder, and computes `evidenceVersion` from the explicit experiment-definition version plus a canonical sorted projection of every selected snapshot's immutable ID, mutable evidence fields, and normalized update/capture version. It rejects drift with `412 performance_evidence_stale`.

Fixtures pin the complete evidence policy: every qualifying snapshot remains in the internal audit; worker evidence groups by published content, keeps the latest completed snapshot per content, requires a normalized real HTTPS public URL, deduplicates by normalized URL and content hash, sorts exposure descending → capture time descending → UUID ascending, and takes at most eight. Zero valid public rows creates no research-snapshot row and leaves the normal controlled-search step responsible for evidence; one through eight creates `decision="searched"` with exactly those rows. The server hypothesis/pattern remains in `contentInstruction`. Cover ownership, incomplete/duplicate snapshots, changed metric hashes, zero/one/eight/more-than-eight, URL/hash dedupe, and deterministic ties.

Tests also distinguish the stored `proposal-base-input.v2` from the composed worker `proposal-input.v2`: the optional validated research row is inserted atomically and completion verifies the identical base+research pair. Full metrics/IDs/hashes/capture times stay only in the internal performance audit; customer output is exactly `provenance: { kind: "performance_experiment", experimentId, evidenceVersion, snapshotCount, capturedFrom, capturedTo }` with no raw evidence.

- [ ] **Step 2: Prove RED**

```powershell
npm test --workspace @brand-pilot/api -- src/performanceInsights.test.ts src/performanceProposalAdapter.test.ts src/server.performanceInsightsCustomer.test.ts
```

- [ ] **Step 3: Add the adapter and route**

```http
POST /brands/:brandId/performance-experiments/proposal-batches
Content-Type: application/json

{ "experimentId": "...", "evidenceVersion": "..." }
```

Build a fixed `informational/card_news/instagram/1:1` V2 request. Persist database `origin="manual"` plus the authenticated actor; performance identity lives only in the internal audit/safe provenance. Use ordinary replay key `performance:${actorUserId}:${experimentId}:${evidenceVersion}`. Before mutable resolution, hash scope+actor+source+experiment+submitted evidence version as the replay fingerprint so an exact committed replay can return without reloading disappeared evidence. For a new write, separately hash the normalized V2 request, sorted snapshot IDs/content hashes, and final frozen input as the resolved-input fingerprint. Store the audit row, base snapshot, optional research row, batch, and job in the same Proposal V2 transaction; same key/replay fingerprint replays, and only a changed replay fingerprint conflicts. Phase 5 Task 2B may add a server-authenticated, loopback-only canary outer operation context without changing this browser body or ordinary key: it namespaces the replay identity by exact cutover/attempt, while the ordinary API can neither supply nor accept that context.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/performanceInsights.test.ts src/performanceProposalAdapter.test.ts src/server.performanceInsightsCustomer.test.ts
git add apps/api/src/performanceProposalAdapter.ts apps/api/src/performanceProposalAdapter.test.ts apps/api/src/performanceInsights.ts apps/api/src/performanceInsights.test.ts apps/api/src/httpServer.ts apps/api/src/server.performanceInsightsCustomer.test.ts apps/api/src/repository.ts
git commit -m "feat(api): route performance experiments through proposal v2"
```

## Task 3: Migrate automated card-news and carousel regeneration

**Files:**

- Modify: `apps/api/src/automatedCardNews.ts`
- Modify: `apps/api/src/automatedCardNews.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/repository.regression-1.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/contentProposalJobs.ts`
- Modify: `apps/api/src/contentProposalJobs.test.ts`

- [ ] **Step 1: Write RED atomicity, replay, and artifact-absence tests**

Assert that topic reservation plus run/batch/job creation is one transaction; no `master_draft`, `topic_publish_group`, or placeholder `channel_output` is created before selection; carousel regeneration does not mutate the source artifact; and Story/Reel delivery regeneration is unchanged. Persist scheduled work with exact `origin="scheduled_crawl"`, system execution context, and `created_by_user_id=null`; reject any topic/source snapshot/source output/run identity outside the same workspace+brand. State transitions are only `queued → ready → selected|dismissed` or `queued → failed`; no transition leaves `failed`, `selected`, or `dismissed`, and a late completion replay preserves the terminal/user state. Cover the global lock order (topic → batch → run for new work, batch → run for replay/transitions and job → batch → run when worker completion already owns the job lock), concurrent completion/selection/dismissal without deadlock, exact terminal failure and attempts-exhaustion mirroring from `contentProposalJobs.ts`, late completion replay, three simultaneous dismissals, topic-reservation rollback after `topic_rows` has been consumed, scheduled-topic operation-key replay, topic exclusion after any linked run, rollback at every insert boundary, and stable caller-operation-to-run-to-proposal identity. Selecting/replaying a scheduled proposal must return the same generation ID and perform the batch → run → proposal lock order. A proposal-only topic remains selected/awaiting review and never becomes `generating` or `generated`.

List/inbox DTO tests require the explicit Proposal V2 contract discriminator, `origin="scheduled_crawl"`, purpose, canonical output format, exact V2 `title`, `selectionReason`, `oneLineIntent`, and a server-resolved safe evidence preview from the frozen evidence IDs. The API resolves and scope-checks the preview in the batch query; the UI neither fetches arbitrary evidence IDs nor guesses V1/V2 or field names from optional properties. Missing/malformed V2 presentation fields are a contract error, not a V1 fallback.

- [ ] **Step 2: Prove RED**

```powershell
npm test --workspace @brand-pilot/api -- src/automatedCardNews.test.ts src/contentProposalJobs.test.ts src/repository.test.ts src/repository.regression-1.test.ts
```

- [ ] **Step 3: Replace direct SQL with the common service**

Always build a complete exact `ContentOrchestrationV2` (values shown are fixtures; `brandId`, topic-derived `seed.title`, and optional instruction come from the scheduled operation inside the same transaction):

```ts
{
  contractVersion: "content-orchestration.v2",
  brandId,
  purpose: "informational",
  seed: { kind: "topic_text", title: scheduledTopicTitle },
  contentInstruction: scheduledInstruction,
  productId: null,
  outputSettings: {
    outputFormat: "card_news",
    channelTargets: ["instagram"],
    aspectRatio: "1:1",
    outputCount: 1,
  },
}
```

Use `regenerate-output:${sourceOutputId}:${clientIdempotencyKey}` and return a discriminator. Scheduled list/inbox DTOs also carry an explicit Proposal V2 discriminator:

```ts
type RegenerateContentResponse =
  | { kind: "output"; id: string; status: "generating" }
  | { kind: "proposal"; proposalRunId: string; proposalBatchId: string; status: "proposal_pending" };
```

For topic creation the caller-operation key is exactly `scheduled-topic:${contentTopicId}:instagram:card_news`. After that key is locked and the run UUID is reserved, the proposal idempotency key is exactly `scheduled-proposal:${runId}`. Probe a scope-authenticated exact existing run replay first. Only when no run exists, check `AUTOMATED_CONTENT_ENABLED` before reserving/mutating a topic or creating a run/batch/job; disabled must produce zero rows and cannot be treated as enqueue success. Recheck under the caller-operation lock before insertion. Pass the scheduled origin/system-null actor explicitly to the common service and persist/read the exact discriminator+origin+purpose DTO fields; no default-manual origin is allowed.

This task stops when the scheduled/card-news adapter has created or replayed a valid Proposal V2 batch/run and that run reaches its normal reviewable state. It does not implement new topic discovery, automatic proposal selection, automatic draft start, or automatic final generation. Existing topic input is merely converted into the normal V2 request; a user selection then follows the same draft/start path as manual Studio.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/automatedCardNews.test.ts src/contentProposalJobs.test.ts src/repository.test.ts src/repository.regression-1.test.ts
git add apps/api/src/automatedCardNews.ts apps/api/src/automatedCardNews.test.ts apps/api/src/contentProposalJobs.ts apps/api/src/contentProposalJobs.test.ts apps/api/src/repository.ts apps/api/src/repository.test.ts apps/api/src/repository.regression-1.test.ts apps/api/src/types.ts apps/api/src/httpServer.ts
git commit -m "refactor(api): adapt scheduled card news to proposal v2"
```

## Task 4: Make selection draft-only and start atomic

**Files:**

- Create: `apps/api/src/aiContentFixedInputAssembler.ts`
- Create: `apps/api/src/aiContentFixedInputAssembler.test.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRepository.test.ts`
- Modify: `apps/api/src/contentOrchestrationRepository.pglite.test.ts`
- Modify: `apps/api/src/contentOrchestrationRepository.postgres.integration.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write RED transaction-boundary tests**

Selection must create only one draft generation with `output_format`, `purpose`, and exact `draft_json.origin="proposal-v2"`; performance and scheduled selection/replay must persist and return that origin, never infer it from optional fields. The existing manual selection request/response identity remains unchanged. Selection must not create V3, binding, job, reservation, output placeholder, or copied mutable data. Start requires a scoped client idempotency key and canonical request fingerprint. Exact replay returns the same started generation/V3 hash/reservation/job identity; the same key with a changed fingerprint conflicts. Start must lock the draft, reload all approved scoped inputs, canonicalize/hash them, and atomically insert V3, immutable binding, exactly one reservation, queued state, and first job. Inject failure after every insert/state boundary; every failure fully rolls back and leaves the same draft restartable with the same key.

- [ ] **Step 2: Prove RED**

```powershell
npm test --workspace @brand-pilot/api -- src/aiContentFixedInputAssembler.test.ts src/aiContentRepository.test.ts src/contentOrchestrationRepository.pglite.test.ts
npm run test:content-orchestration-postgres --workspace @brand-pilot/api
```

- [ ] **Step 3: Implement the server-owned assembler**

```ts
interface FixedInputAssembly {
  input: ContentGenerationInputV3;
  canonicalJson: string;
  contentHash: string;
  binding: ContentPromptBinding;
}
```

The assembler is the sole owner of the complete start-time source list: selected Proposal V2 row and batch identity; approved brand core and brand rules; approved product/service version when marketing requires it; frozen research-evidence rows; approved immutable reference versions selected by the proposal; selected brand/avatar assets; finalized, virus-scanned generation attachments; and the draft's canonical seed, instruction, purpose, output settings, actor/scope, and provenance. It re-reads all of them under the owning transaction, records their immutable IDs/versions/hashes, and never queries a worker to fill a gap. PGlite and direct PostgreSQL tests run two simultaneous starts, every rollback injection, exact replay after success, and changed-fingerprint conflict.

The `ContentPromptBinding` is constructed only from the verified generated catalog and records its binding/source versions, format, purpose, fixed Terra planner model, all four Proposal V2 boundary versions plus prompt/schema hash, V3 and format-plan schema hashes, planner/image prompt versions, and image-package/manifest versions. Before construction, compare the selected proposal job's stored request/base/composed/output/prompt/schema metadata to the same catalog. Require final `outputCount=1` separately; derive multi-slide/scene asset count from the plan and compare it only with image package/render/manifest. Reject stale, deleted, cross-tenant, unapproved, purpose-mismatched, format-mismatched, evidence-ownership, selected-proposal, plan-derived asset-count, version, or hash mismatches. Do not accept a generic caller-provided `schemaHash`, default a missing format to blog, or infer marketing from reel/product.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/aiContentFixedInputAssembler.test.ts src/aiContentRepository.test.ts src/contentOrchestrationRepository.pglite.test.ts
npm run test:content-orchestration-postgres --workspace @brand-pilot/api
git add apps/api/src/aiContentFixedInputAssembler.ts apps/api/src/aiContentFixedInputAssembler.test.ts apps/api/src/aiContentRepository.ts apps/api/src/aiContentRepository.test.ts apps/api/src/contentOrchestrationRepository.pglite.test.ts apps/api/src/contentOrchestrationRepository.postgres.integration.test.ts apps/api/src/httpServer.ts apps/api/src/index.ts
git commit -m "feat(api): bind immutable v3 input at generation start"
```

## Task 5: Reserve and settle generation allowance exactly once

**Files:**

- Create: `apps/api/src/aiContentUsageRepository.ts`
- Create: `apps/api/src/aiContentUsageRepository.pglite.test.ts`
- Create: `apps/api/src/aiContentUsageRepository.postgres.integration.test.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRenderJobs.ts`
- Modify: `apps/api/src/aiContentRenderJobs.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/adminRepository.ts`
- Modify: `apps/api/src/adminRepository.test.ts`
- Modify: `apps/api/src/adminRepository.pglite.test.ts`
- Modify: `apps/api/src/server.aiContentCustomer.test.ts`
- Modify: `scripts/run-content-orchestration-postgres-tests.mjs`
- Modify: `scripts/run-content-orchestration-postgres-tests.test.mjs`

- [ ] **Step 1: Write RED concurrency and calendar-boundary tests**

Cover start reservation, all planner/render permanent failures, attempts/lease exhaustion, cancellation, completion, two concurrent terminal callbacks, reversal on the original `usage_date`, same-generation automatic retry, and post-reversal child retry with an operation idempotency key. Preserve one global reservation lock per `(brandId, usage_date)` before reading the net ledger/counting remaining allowance and before inserting a reservation; use the repository's existing `pg_advisory_xact_lock('ai-content-usage:<brand>:<date>')` order rather than a per-generation lock. Test two different drafts racing when one unit remains, reversal racing a distinct new start, and child retry racing parent settlement: only the valid single reservation wins and every customer/admin view reports the same net result.

Pin a normal customer boundary `POST /brands/:brandId/ai-content/generations/:generationId/retry` with exact closed body `{ clientIdempotencyKey, reason }` and response `{ kind:"generation", generationId, parentGenerationId, status:"queued", replayed }`. It requires the ordinary session/brand scope, maintenance check before mutation, a terminal zero-output failed parent, completed reversal, non-empty bounded reason, and exact replay fingerprint; changed reason/parent under one key is `409`. Customer used/remaining, limit enforcement, and admin usage summaries must all compute the same net `reservation + reversal` aggregate; none may count raw reservation rows alone. Assert one unique reversal reference per original reservation and call the one locked settlement routine from every terminal path.

- [ ] **Step 2: Prove RED**

```powershell
npm test --workspace @brand-pilot/api -- src/aiContentUsageRepository.pglite.test.ts src/aiContentRenderJobs.test.ts src/adminRepository.test.ts src/adminRepository.pglite.test.ts src/server.aiContentCustomer.test.ts
```

- [ ] **Step 3: Implement one locked settlement routine**

Remove completion-time charging. `aiContentUsageRepository.reserve` first takes the exact brand/date advisory lock, then computes the net aggregate and inserts/replays one reservation; every reversal/new-start/retry path follows that same lock order. Zero successful outputs is `failed`; `partial_failed` requires at least one success. A reversal is the exact negative reservation quantity, uses its original date, references its reservation under a unique constraint, and is inserted at most once. A retry after reversal requires `clientIdempotencyKey` and calls the new normal customer route above. It creates/replays a child generation with a new reservation and exact copied prompt binding. Because V3 contains required `generationId`, construct a new canonical child V3 whose `generationId` alone is rebound to the child; every captured source/evidence/reference/product/output field and timestamp is byte-equal to the parent. Persist `parent_generation_id`, `parent_v3_sha256`, derivation version, and new child V3 SHA-256; the generation↔V3 constraint must pass. Exact replay returns that child/reservation; changed payload under the same key conflicts. Extend the PostgreSQL test runner registry with `aiContentUsageRepository.postgres.integration.test.ts` and prove the runner executes it.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/aiContentUsageRepository.pglite.test.ts src/aiContentRenderJobs.test.ts src/adminRepository.test.ts src/adminRepository.pglite.test.ts src/server.aiContentCustomer.test.ts
npm run test:content-orchestration-postgres --workspace @brand-pilot/api
node --test scripts/run-content-orchestration-postgres-tests.test.mjs
git add apps/api/src/aiContentUsageRepository.ts apps/api/src/aiContentUsageRepository.pglite.test.ts apps/api/src/aiContentUsageRepository.postgres.integration.test.ts apps/api/src/aiContentRepository.ts apps/api/src/aiContentRenderJobs.ts apps/api/src/aiContentRenderJobs.test.ts apps/api/src/httpServer.ts apps/api/src/types.ts apps/api/src/adminRepository.ts apps/api/src/adminRepository.test.ts apps/api/src/adminRepository.pglite.test.ts apps/api/src/server.aiContentCustomer.test.ts scripts/run-content-orchestration-postgres-tests.mjs scripts/run-content-orchestration-postgres-tests.test.mjs
git commit -m "feat(api): settle generation quota exactly once"
```

## Task 6: Enforce canonical routing and preserve delivery namespaces

**Files:**

- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.aiContentWorker.test.ts`
- Modify: `apps/api/src/server.aiContentRenderWorker.test.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRenderJobs.ts`
- Modify: `apps/api/src/channelCatalog.ts`
- Modify: `apps/api/src/channelCatalog.test.ts`
- Modify: `apps/api/src/channelCapabilities.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/channelCapabilities.test.ts`

- [ ] **Step 1: Write RED routing/capability tests**

Require only `/worker/ai-content-jobs/card_news|blog|reel/claim`; reject `card-news`, `marketing`, missing format, V2-less jobs, and binding mismatch. Split `studioOutputFormats`, internal `channelOutputGenerationReady`, and `publishModes`. Pin the Studio capability values: Instagram advertises exactly `card_news,reel`; Threads advertises none; blog remains the separate `blog_export` path rather than a social delivery capability. Preserve `instagram_story`, `instagram_reel`, their render jobs, and trend-media `reel`.

- [ ] **Step 2: Prove RED**

```powershell
npm test --workspace @brand-pilot/api -- src/server.aiContentWorker.test.ts src/server.aiContentRenderWorker.test.ts src/channelCatalog.test.ts src/channelCapabilities.test.ts src/aiContentRenderJobs.test.ts
```

Expected: legacy claim aliases/local capability sets still violate the canonical routing fixtures.

- [ ] **Step 3: Implement exhaustive catalog routing and run GREEN**

```powershell
npm test --workspace @brand-pilot/api -- src/server.aiContentWorker.test.ts src/server.aiContentRenderWorker.test.ts src/channelCatalog.test.ts src/channelCapabilities.test.ts src/aiContentRenderJobs.test.ts
npm run typecheck --workspace @brand-pilot/api
git add apps/api/src/httpServer.ts apps/api/src/server.aiContentWorker.test.ts apps/api/src/server.aiContentRenderWorker.test.ts apps/api/src/aiContentRepository.ts apps/api/src/aiContentRenderJobs.ts apps/api/src/channelCatalog.ts apps/api/src/channelCatalog.test.ts apps/api/src/channelCapabilities.ts apps/api/src/types.ts apps/api/src/channelCapabilities.test.ts
git commit -m "refactor(api): enforce format purpose worker routing"
```

## Task 7: Replace API-local contracts and manifest adapters

**Files:**

- Modify: `apps/api/package.json`
- Modify: `apps/api/src/aiContentContracts.ts`
- Modify: `apps/api/src/aiContentGenerationInputV3.ts`
- Modify: `apps/api/src/aiContentGenerationInputV3.test.ts`
- Modify: `apps/api/src/aiContentPlanContracts.ts`
- Modify: `apps/api/src/aiContentPlanContracts.test.ts`
- Modify: `apps/api/src/aiContentManifest.ts`
- Modify: `apps/api/src/aiContentManifest.test.ts`
- Modify: `apps/api/src/aiContentDownload.ts`
- Modify: `apps/api/src/aiContentDownload.test.ts`
- Modify: `apps/api/src/aiContentPublish.ts`
- Modify: `apps/api/src/aiContentPublish.test.ts`
- Modify: `apps/api/src/aiContentPublish.pglite.test.ts`
- Modify: `apps/api/src/aiContentRenderJobs.ts`
- Modify: `apps/api/src/aiContentRenderJobs.pglite.test.ts`
- Modify: `apps/api/src/aiContentRenderJobs.test.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRepository.test.ts`
- Modify: `apps/api/src/aiContentRepository.pglite.test.ts`
- Modify: `apps/api/src/aiContentV2Migration.pglite.test.ts`
- Modify: `apps/api/src/server.aiContentV2Customer.test.ts`
- Modify: `package-lock.json`

- [ ] **Step 1: Write RED canonical-boundary tests**

Require direct imports from `@brand-pilot/content-contracts`; exact Proposal V2/V3/plan parsers; `version: "ai-content.v3"`; `outputFormat` and purpose agreement; and absence of Studio manifest `type`. Reject V1/V2 Studio manifests and `marketing_content` after the execution-graph cutover. Keep only API-specific HTML/download/publish validation that cannot live in the browser-safe package. For reference seeds, accept only exact `card_news|blog|reel` queries and return only rows whose explicit current Studio eligibility matches that exact format; legacy `single_image|channel_text|marketing_content` values in `reference_items.format`, `metadata.outputFormat`, pattern JSON, or performance-derived metadata are excluded, never relabeled. Trend-media `_trendKind=reel` remains an explicit reel observation, not a generic legacy mapping.

- [ ] **Step 2: Prove RED**

```powershell
npm install
npm test --workspace @brand-pilot/api -- src/aiContentGenerationInputV3.test.ts src/aiContentPlanContracts.test.ts src/aiContentManifest.test.ts src/aiContentDownload.test.ts src/aiContentPublish.test.ts src/aiContentPublish.pglite.test.ts src/aiContentRenderJobs.test.ts src/aiContentRenderJobs.pglite.test.ts src/aiContentRepository.test.ts src/aiContentRepository.pglite.test.ts src/aiContentV2Migration.pglite.test.ts src/server.aiContentV2Customer.test.ts
```

- [ ] **Step 3: Replace local sources and read-side guessing**

Delete locally authored format/purpose/V2/V3/plan/manifest unions and parsers. Do not keep aliases. Content Studio result/list/download/publish DTOs expose `outputFormat`, not a duplicate `type`. Preserved published channel paths remain accessible through their publication/storage records rather than a resurrected legacy generation parser. Replace the active reference-seed whitelist/query with the canonical catalog and exact-match eligibility logic; keep legacy reference values only as inert historical library metadata.

Rewrite `aiContentPublish.pglite.test.ts` to prove V3 publication succeeds and V1/V2 Studio manifests are explicit rejection fixtures; it must not use an old manifest as a positive runtime path. Rewrite `aiContentV2Migration.pglite.test.ts` as cutover/pre-marker historical-fixture coverage only, with named fixture objects and no imported V1/V2 writer/parser. The active source guard must distinguish these rejection/migration fixtures from executable adapters.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/aiContentGenerationInputV3.test.ts src/aiContentPlanContracts.test.ts src/aiContentManifest.test.ts src/aiContentDownload.test.ts src/aiContentPublish.test.ts src/aiContentPublish.pglite.test.ts src/aiContentRenderJobs.test.ts src/aiContentRenderJobs.pglite.test.ts src/aiContentRepository.test.ts src/aiContentRepository.pglite.test.ts src/aiContentV2Migration.pglite.test.ts src/server.aiContentV2Customer.test.ts
npm run typecheck --workspace @brand-pilot/api
git add apps/api/package.json apps/api/src/aiContentContracts.ts apps/api/src/aiContentGenerationInputV3.ts apps/api/src/aiContentGenerationInputV3.test.ts apps/api/src/aiContentPlanContracts.ts apps/api/src/aiContentPlanContracts.test.ts apps/api/src/aiContentManifest.ts apps/api/src/aiContentManifest.test.ts apps/api/src/aiContentDownload.ts apps/api/src/aiContentDownload.test.ts apps/api/src/aiContentPublish.ts apps/api/src/aiContentPublish.test.ts apps/api/src/aiContentPublish.pglite.test.ts apps/api/src/aiContentRenderJobs.ts apps/api/src/aiContentRenderJobs.pglite.test.ts apps/api/src/aiContentRenderJobs.test.ts apps/api/src/aiContentRepository.ts apps/api/src/aiContentRepository.test.ts apps/api/src/aiContentRepository.pglite.test.ts apps/api/src/aiContentV2Migration.pglite.test.ts apps/api/src/server.aiContentV2Customer.test.ts package-lock.json
git commit -m "refactor(api): adopt canonical content contracts"
```

## Task 8: Move the customer UI to the exact 3x2 contract

**Files:**

- Modify: `apps/customer-ui/package.json`
- Modify: `package-lock.json`
- Modify: `apps/customer-ui/src/features/performance/performanceGateway.ts`
- Modify: `apps/customer-ui/src/features/performance/performanceGateway.test.ts`
- Modify: `apps/customer-ui/src/pages/PerformanceInsightsPage.tsx`
- Create: `apps/customer-ui/src/pages/PerformanceInsightsPage.test.tsx`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/features/ai-content/types.ts`
- Create: `apps/customer-ui/src/features/ai-content/constants.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts`
- Modify: `apps/customer-ui/src/pages/AiContentWizardPage.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalFlow.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalFlow.test.tsx`
- Rename: `apps/customer-ui/src/components/ai-content/ContentFamilyStep.tsx` → `apps/customer-ui/src/components/ai-content/ContentPurposeStep.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentStrategyStep.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentStrategyStep.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalCard.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalInbox.tsx`
- Create: `apps/customer-ui/src/components/ai-content/ContentProposalInbox.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalComparison.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentGenerationPage.tsx`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentJobList.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiGenerationOutputList.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentArtifactPreview.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentArtifactPreview.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentPublishPanel.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentPublishPanel.test.tsx`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentPublishTargets.ts`
- Modify: `apps/customer-ui/src/features/channels/channelCapabilityGateway.ts`
- Modify: `apps/customer-ui/src/features/channels/channelCapabilityGateway.test.ts`
- Modify: `apps/customer-ui/src/features/channels/channelCapabilityViewModel.ts`
- Modify: `apps/customer-ui/src/features/channels/channelCapabilityViewModel.test.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.test.ts`
- Modify: `apps/customer-ui/src/routes.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/ProductServiceEditor.tsx`
- Create: `apps/customer-ui/src/pages/ProductServiceAnalysisPage.tsx`
- Create: `apps/customer-ui/src/__tests__/productServiceAnalysis.test.tsx`

- [ ] **Step 1: Write RED UI and gateway tests**

Assert separate purpose and format selectors; changing purpose preserves the currently selected format, and changing format preserves the currently selected purpose. Format labels are `카드뉴스|블로그|릴스`; purpose labels are `정보성|마케팅성`; capability presentation shows Instagram `card_news,reel`, Threads no Studio formats, and blog only through `blog_export`. Require exact prefill `?format=card_news|blog|reel&purpose=informational|marketing`; rejection of legacy `type=marketing`; exact safe `resumeInput` hydration; informational product clearing; marketing approved-product requirement; identifier-only performance POST; and carousel proposal navigation. Reference-seed gateway/types accept only the three canonical query values, reject `single_image|channel_text|marketing_content` before fetch, and never relabel a returned legacy record.

`ContentProposalFlow` recoverable network/timeout/503/proposal errors must preserve the full ordinary wizard input: seed/source, content instruction, purpose, format, approved product when marketing, channel target, aspect ratio, and output count. Retry reuses the same idempotency key/request fingerprint until a definitive response; it never resets, falls back, or remaps reel to blog. Failed-result UI displays both selected Korean format and purpose labels for every cell. Add fake-timer/remount tests that fail once then succeed with byte-identical request body/header and retained visible controls. `ContentProposalInbox.test.tsx` renders the scheduled V2 `title`, `selectionReason`, `oneLineIntent`, Korean canonical format/purpose labels, and server evidence preview; deleting any required field or substituting a V1-shaped optional field fails instead of guessing. `PublishQueuePage` similarly creates one per-output idempotency key and keeps it stable across recoverable timeout/network retries until a definitive response; a `{kind:"proposal"}` response navigates to the returned proposal batch and never polls a replacement output. Existing Story/Reel delivery regeneration continues to use `{kind:"output"}` unchanged.

- [ ] **Step 2: Prove RED**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/features/performance/performanceGateway.test.ts src/pages/PerformanceInsightsPage.test.tsx
npm test --workspace @brand-pilot/customer-ui -- src/features/ai-content/aiContentApiGateway.test.ts src/components/ai-content/ContentProposalFlow.test.tsx src/components/ai-content/ContentProposalInbox.test.tsx src/components/ai-content/ContentStrategyStep.test.tsx src/components/ai-content/AiGenerationOutputList.test.tsx src/components/ai-content/AiContentArtifactPreview.test.tsx src/components/ai-content/AiContentPublishPanel.test.tsx src/features/channels/channelCapabilityGateway.test.ts src/features/channels/channelCapabilityViewModel.test.ts src/lib/apiClient.test.ts src/__tests__/productServiceAnalysis.test.tsx src/__tests__/publishQueue.test.tsx
```

- [ ] **Step 3: Implement the UI contract and dedicated analysis route**

Use `/product-analysis/new` for the already independent subject-analysis APIs. Rename `ContentFamilyStep` and its imports/state labels to `ContentPurposeStep`; no active UI symbol or DTO calls purpose a family. Move `DEFAULT_BRAND_COLOR` and any other surviving non-draft constants out of the soon-deleted `useAiContentDraft.ts` into `features/ai-content/constants.ts`, then update gateway imports. On performance `412`, refetch evidence while retaining the chosen card and scroll position. Add canonical-contract `pretest` and `prebuild` lifecycle scripts before UI test/build so a clean checkout never relies on ignored `dist/`. Do not expose or alter downstream Story/Reel publish behavior.

- [ ] **Step 4: Run GREEN and commit in reviewable slices**

```powershell
npm install
npm test --workspace @brand-pilot/customer-ui -- src/features/performance/performanceGateway.test.ts src/pages/PerformanceInsightsPage.test.tsx src/features/ai-content/aiContentApiGateway.test.ts src/components/ai-content/ContentProposalFlow.test.tsx src/components/ai-content/ContentProposalInbox.test.tsx src/components/ai-content/ContentStrategyStep.test.tsx src/components/ai-content/AiGenerationOutputList.test.tsx src/components/ai-content/AiContentArtifactPreview.test.tsx src/components/ai-content/AiContentPublishPanel.test.tsx src/features/channels/channelCapabilityGateway.test.ts src/features/channels/channelCapabilityViewModel.test.ts src/lib/apiClient.test.ts src/__tests__/productServiceAnalysis.test.tsx src/__tests__/publishQueue.test.tsx
npm run build --workspace @brand-pilot/customer-ui
$task8Files = @(
  "apps/customer-ui/package.json",
  "apps/customer-ui/src/features/performance/performanceGateway.ts", "apps/customer-ui/src/features/performance/performanceGateway.test.ts",
  "apps/customer-ui/src/pages/PerformanceInsightsPage.tsx", "apps/customer-ui/src/pages/PerformanceInsightsPage.test.tsx",
  "apps/customer-ui/src/types.ts", "apps/customer-ui/src/features/ai-content/types.ts", "apps/customer-ui/src/features/ai-content/constants.ts",
  "apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts", "apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts",
  "apps/customer-ui/src/pages/AiContentWizardPage.tsx", "apps/customer-ui/src/components/ai-content/ContentProposalFlow.tsx",
  "apps/customer-ui/src/components/ai-content/ContentProposalFlow.test.tsx", "apps/customer-ui/src/components/ai-content/ContentFamilyStep.tsx",
  "apps/customer-ui/src/components/ai-content/ContentPurposeStep.tsx", "apps/customer-ui/src/components/ai-content/ContentStrategyStep.tsx",
  "apps/customer-ui/src/components/ai-content/ContentStrategyStep.test.tsx", "apps/customer-ui/src/components/ai-content/ContentProposalCard.tsx",
  "apps/customer-ui/src/components/ai-content/ContentProposalInbox.tsx", "apps/customer-ui/src/components/ai-content/ContentProposalInbox.test.tsx",
  "apps/customer-ui/src/components/ai-content/ContentProposalComparison.tsx",
  "apps/customer-ui/src/pages/AiContentGenerationPage.tsx", "apps/customer-ui/src/pages/PublishQueuePage.tsx",
  "apps/customer-ui/src/__tests__/publishQueue.test.tsx", "apps/customer-ui/src/components/ai-content/AiContentJobList.tsx",
  "apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx", "apps/customer-ui/src/components/ai-content/AiGenerationOutputList.test.tsx",
  "apps/customer-ui/src/components/ai-content/AiContentArtifactPreview.tsx", "apps/customer-ui/src/components/ai-content/AiContentArtifactPreview.test.tsx",
  "apps/customer-ui/src/components/ai-content/AiContentPublishPanel.tsx", "apps/customer-ui/src/components/ai-content/AiContentPublishPanel.test.tsx",
  "apps/customer-ui/src/features/ai-content/aiContentPublishTargets.ts", "apps/customer-ui/src/features/channels/channelCapabilityGateway.ts",
  "apps/customer-ui/src/features/channels/channelCapabilityGateway.test.ts", "apps/customer-ui/src/features/channels/channelCapabilityViewModel.ts",
  "apps/customer-ui/src/features/channels/channelCapabilityViewModel.test.ts", "apps/customer-ui/src/lib/apiClient.ts",
  "apps/customer-ui/src/lib/apiClient.test.ts", "apps/customer-ui/src/routes.tsx",
  "apps/customer-ui/src/components/brand-center/ProductServiceEditor.tsx", "apps/customer-ui/src/pages/ProductServiceAnalysisPage.tsx",
  "apps/customer-ui/src/__tests__/productServiceAnalysis.test.tsx", "package-lock.json"
)
git add -- $task8Files
git commit -m "feat(ui): expose three formats and two purposes"
```

## Task 9: Delete all first-party V1 and legacy wizard paths

**Files:**

- Modify: `apps/api/src/aiContentContracts.ts`
- Modify: `apps/api/src/contentOrchestration.ts`
- Modify: `apps/api/src/contentProposalJobs.ts`
- Modify: `apps/api/src/contentProposalJobs.test.ts`
- Modify: `apps/api/src/contentOrchestration.test.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRepository.test.ts`
- Modify: `apps/api/src/aiContentRepository.postgres.integration.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/api/src/server.aiContentCustomer.test.ts`
- Modify: `apps/api/src/aiContentRepository.subjectSnapshot.test.ts`
- Modify: `apps/api/src/aiContentSubjectMigrationBackfill.pglite.test.ts`
- Modify: `apps/api/src/types.ts`
- Delete: `apps/api/src/aiContentGenerationInput.ts`
- Delete: `apps/api/src/aiContentGenerationInput.test.ts`
- Modify: `apps/api/src/legacyDataCompatibility.test.ts`
- Create: `scripts/ai-content-contract.test.mjs`
- Modify: `scripts/repository-contract.test.mjs`
- Modify: `scripts/run-content-orchestration-postgres-tests.mjs`
- Modify: `scripts/run-content-orchestration-postgres-tests.test.mjs`
- Delete: `apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx`
- Delete: `apps/customer-ui/src/components/ai-content/GenerationPromptStep.tsx`
- Delete: `apps/customer-ui/src/components/ai-content/GenerationPromptStep.test.tsx`
- Delete: `apps/customer-ui/src/components/ai-content/TargetAppealStep.tsx`
- Delete: `apps/customer-ui/src/components/ai-content/TargetAppealStep.test.tsx`
- Delete: `apps/customer-ui/src/features/ai-content/useAiContentDraft.ts`
- Delete: `apps/customer-ui/src/features/ai-content/useAiContentDraft.test.ts`
- Delete: `apps/customer-ui/src/components/ai-content/SubjectAnalysisStep.test.tsx`
- Delete: `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/legacyRoutes.regression.test.tsx`

- [ ] **Step 1: Add RED static ownership guards before deletion**

Create a content-only guard that, in Phase 3, scans only active production roots under `apps/api/src` and `apps/customer-ui/src`—not workers/deploy, tests, historical migrations/docs, or the separate delivery/trend namespace. It rejects the applicable retired set: `ContentProposalV1`, `content-proposal-request.v1`, `content-generation-input.v1|v2`, Studio manifest `ai-content.v1|v2`, direct proposal INSERTs outside the repository, V1 API job/read branches, `marketing_content`, `single_image`, `channel_text`, `/card-news|/marketing` claim aliases, generation `type`, active relational `content_family`/job `content_type`, missing-version fallback, read-side reconstruction, and default/catch-all format routing. Tests may retain legacy literals only as explicit rejection fixtures. Phase 4 expands this same guard to content-worker roots and then adds `marketing-worker`/`marketing-plan.v2`; Phase 3 does not claim those still-live worker paths are already gone.

Run `node --test scripts/ai-content-contract.test.mjs` now and record the expected RED API/UI retired references before deleting anything. In `repository-contract.test.mjs`, update and prefix only the canonical root-workspace list (`["packages/*","apps/*","workers/*"]`), migration registry through exact `074`/`075`, and PostgreSQL content-test registry (orchestration, Proposal V2, usage, and `aiContentRepository`) with literal `[ai-content-cutover]`. Delete—do not invert or skip—the obsolete `ApiRepository` method/actor regex, positive V1 plus deleted `aiContentGenerationInput.ts` plus marketing-worker smoke, old scheduler smoke, and old 13-flow/Reel-rejection marker assertions; their replacements live in service/unit/harness/real Playwright tests. Preserve the historical migration `060` assertions byte-for-byte and untagged, including its retired literals. Run only `^\[ai-content-cutover\]` via Node's test-name filter. Do not run the broad repository contract suite because it includes unrelated worker checks; `ai-content-contract.test.mjs` must fail if exact deleted active anchors return (`createAiContentAnalysis`, `updateAiContentDraft`, legacy `startAiContentGeneration(`, the deleted input file/marketing-worker paths, or the old smoke/E2E markers) without globally banning historical fixture text.

- [ ] **Step 2: Delete producers, parsers, read adapters, and fallback routes**

Keep the independent subject-analysis routes backed by `aiContentSubjectContracts.ts`. Delete the old combined AI-content analysis/create route that imports `parseCreateAiContentAnalysisInput`, plus its repository/type method; the dedicated `/product-analysis/new` UI calls only the independent subject-analysis API. Rewrite `legacyDataCompatibility.test.ts` to test the surviving unrelated legacy data adapter without importing the deleted `parseCreateAiContentAnalysisInput`/`parseContentOrchestrationV1`; delete the obsolete `SubjectAnalysisStep.test.tsx` together with the dead hook test because the dedicated route is covered by `productServiceAnalysis.test.tsx`. Proposal-worker V1 parsing and the old marketing worker `analyze` branch are deleted in Phase 4 after their replacement contract tests are green.

Rewrite `aiContentRepository.subjectSnapshot.test.ts` and `aiContentSubjectMigrationBackfill.pglite.test.ts` to cover only the independent subject snapshot/backfill boundary. Remove imports or positive construction of the deleted generation V1/V2 contract; any unavoidable historical row is a named inert rejection/migration fixture and cannot be accepted by an active parser. Extend the PostgreSQL runner's explicit registry with `aiContentRepository.postgres.integration.test.ts`, then extend its runner test to prove the file is passed to Vitest with a dedicated Testcontainer.

- [ ] **Step 3: Verify absence and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/contentProposalJobs.test.ts src/contentOrchestration.test.ts src/aiContentRepository.test.ts
npm test --workspace @brand-pilot/api -- src/legacyDataCompatibility.test.ts src/aiContentRepository.subjectSnapshot.test.ts src/aiContentSubjectMigrationBackfill.pglite.test.ts src/server.aiContentCustomer.test.ts
npm test --workspace @brand-pilot/api -- src/server.test.ts -t "does not swallow disabled publication after AI content preparation|returns service unavailable when AI content preparation rejects before mutation"
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/productServiceAnalysis.test.tsx src/__tests__/legacyRoutes.regression.test.tsx
npm run build --workspace @brand-pilot/customer-ui
node --test scripts/ai-content-contract.test.mjs
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/repository-contract.test.mjs
npm run test:content-orchestration-postgres --workspace @brand-pilot/api
node --test scripts/run-content-orchestration-postgres-tests.test.mjs
```

Expected: focused tests/build and the scope-aware active-source guard pass; legacy rejection fixtures remain allowed.

```powershell
$task9Files = @(
  "apps/api/src/aiContentContracts.ts", "apps/api/src/contentOrchestration.ts", "apps/api/src/contentProposalJobs.ts",
  "apps/api/src/contentProposalJobs.test.ts", "apps/api/src/contentOrchestration.test.ts", "apps/api/src/aiContentRepository.ts",
  "apps/api/src/aiContentRepository.test.ts", "apps/api/src/aiContentRepository.postgres.integration.test.ts", "apps/api/src/httpServer.ts",
  "apps/api/src/server.test.ts", "apps/api/src/server.aiContentCustomer.test.ts", "apps/api/src/aiContentRepository.subjectSnapshot.test.ts",
  "apps/api/src/aiContentSubjectMigrationBackfill.pglite.test.ts", "apps/api/src/types.ts", "apps/api/src/aiContentGenerationInput.ts",
  "apps/api/src/aiContentGenerationInput.test.ts", "apps/api/src/legacyDataCompatibility.test.ts",
  "scripts/ai-content-contract.test.mjs", "scripts/repository-contract.test.mjs",
  "scripts/run-content-orchestration-postgres-tests.mjs", "scripts/run-content-orchestration-postgres-tests.test.mjs",
  "apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx", "apps/customer-ui/src/components/ai-content/GenerationPromptStep.tsx",
  "apps/customer-ui/src/components/ai-content/GenerationPromptStep.test.tsx", "apps/customer-ui/src/components/ai-content/TargetAppealStep.tsx",
  "apps/customer-ui/src/components/ai-content/TargetAppealStep.test.tsx", "apps/customer-ui/src/features/ai-content/useAiContentDraft.ts",
  "apps/customer-ui/src/features/ai-content/useAiContentDraft.test.ts", "apps/customer-ui/src/components/ai-content/SubjectAnalysisStep.test.tsx",
  "apps/customer-ui/src/__tests__/aiContentWizard.test.tsx", "apps/customer-ui/src/__tests__/legacyRoutes.regression.test.tsx"
)
git add -- $task9Files
git commit -m "refactor(content): remove proposal v1 and legacy wizard paths"
```

## Task 10: Add repository and focused browser regression guards

**Files:**

- Modify: `scripts/ai-content-contract.test.mjs`
- Modify: `apps/customer-ui/e2e/d-hybrid-content-wizard.spec.ts`
- Modify: `apps/customer-ui/e2e/d-hybrid-accessibility.spec.ts`
- Modify: `apps/customer-ui/e2e/d-hybrid-operations.spec.ts`
- Modify: `apps/customer-ui/playwright.config.ts`

- [ ] **Step 1: Reconcile, do not overwrite, the pre-existing local E2E/config edits**

Preserve their updated mocks/text, resume behavior, and 180-second startup timeout. Inspect `git diff` before editing and again before staging. Prefix only the five cutover-owned accessibility tests (setup, proposal/reference, generating, review, supported controls) and the three cutover-owned operations tests (channel capability, content-result publish, performance proposal) with `[ai-content-cutover]`; do not tag or execute schedule, DM, Wiki, feedback, or other shared-file cases.

- [ ] **Step 2: Add static guards**

Reject direct proposal inserts, all V1 symbols, `marketing_content`, format defaults/catch-alls, selection-time V3/job/reservation, completion-time charging, carousel placeholder artifacts, browser-supplied performance metrics/snapshot IDs, and accidental removal of Story/Reel delivery or trend-reel namespaces.

- [ ] **Step 3: Run only focused content-generation verification**

```powershell
node --test scripts/ai-content-contract.test.mjs
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/repository-contract.test.mjs
npm run typecheck --workspace @brand-pilot/api
npm test --workspace @brand-pilot/content-proposal-worker
npm run build --workspace @brand-pilot/content-proposal-worker
npm run build --workspace @brand-pilot/customer-ui
npm run e2e --workspace @brand-pilot/customer-ui -- d-hybrid-content-wizard.spec.ts
npm run e2e --workspace @brand-pilot/customer-ui -- d-hybrid-accessibility.spec.ts -g "\[ai-content-cutover\]"
npm run e2e --workspace @brand-pilot/customer-ui -- d-hybrid-operations.spec.ts -g "\[ai-content-cutover\]"
npm run test:content-orchestration-postgres --workspace @brand-pilot/api
```

Before these aggregate guards, rerun the exact focused API/UI test commands from Tasks 1–9. Do not run the whole API/UI unit suite, the whole Playwright suite, or any unrelated worker suite.

- [ ] **Step 4: Commit the guards**

```powershell
git add scripts/ai-content-contract.test.mjs apps/customer-ui/e2e/d-hybrid-content-wizard.spec.ts apps/customer-ui/e2e/d-hybrid-accessibility.spec.ts apps/customer-ui/e2e/d-hybrid-operations.spec.ts apps/customer-ui/playwright.config.ts
git commit -m "test(content): guard v2 routing and draft start lifecycle"
```

## Phase 3 verification

Require all targeted API/UI commands above to pass, all six `{format,purpose}` request cells to round-trip, exact replay to return the same IDs, changed fingerprints to conflict, and no unrelated worker to start. This phase is not independently deployable.
