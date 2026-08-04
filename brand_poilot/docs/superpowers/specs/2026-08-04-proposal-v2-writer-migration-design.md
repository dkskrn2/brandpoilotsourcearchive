# Proposal V2 Writer Migration Design

**Date:** 2026-08-04
**Status:** Approved as amended by the three-format design on 2026-08-04
**Scope:** Convert the performance experiment and automated card-news proposal writers from V1 to the existing Proposal V2 pipeline.

> **2026-08-04 architecture amendment:** The downstream worker/model-routing non-goals, `marketing` worker/type references, active relational `content_family` naming, artifact-manifest V2 assumptions, selection-time V3 assembly/start timing, broader V1 read/parser compatibility non-goal, generation-quota reservation/reversal deferral, server-owned fixed-data assembly deferral, data-preserving rollout assumptions, compatibility-release A/writer-release B deployment split, and card-news-only completion canary in this document are superseded by `2026-08-04-three-format-purpose-routed-content-workers-design.md`. The replacement is one maintenance-gated, forward-only three-format cutover, preceded only by a compatibility-safe write-fence deployment; it is not the writer A/B rollout described below. Sections 5 through 16 otherwise remain binding and additive, including the common-service readiness gate, exact adapters, safe performance provenance, automated-run state/locking, transaction/idempotency/failure semantics, `resumeInput`, scheduled-inbox discriminator, carousel regeneration response, UI/static harness, deterministic repetition/concurrency, and performance/automated production canaries. The newer document may strengthen those gates but may not silently omit them.

## 1. Context

The repository currently has two first-party producers of new `content-proposal-request.v1` jobs:

1. `apps/customer-ui/src/features/performance/performanceGateway.ts`
2. `apps/api/src/automatedCardNews.ts`

The normal content creation screen already writes Proposal V2 jobs and, after proposal selection, creates `content-generation-input.v3`. Proposal V1 and Proposal V2 use the same proposal queue and the same proposal worker, but their request, frozen input, result, and finalization expectations differ.

The production database audit performed on 2026-08-04 found no V1 proposal batches. It contained only Proposal V2 batches: 13 ready and 3 failed. This means the two V1 writers can be migrated without rewriting existing V1 production rows. Legacy V1 read/parser compatibility is outside this change and may remain temporarily.

## 2. Goal

After this change:

- performance experiments create Proposal V2 batches;
- automated card-news creates Proposal V2 batches through the same orchestration service used by normal topic-based creation;
- neither production writer constructs `content-proposal-request.v1`;
- automated card-news no longer inserts proposal batches and proposal jobs directly;
- performance and scheduled V2 batches can be reopened, listed, rendered, and selected without a V1-shaped UI fallback;
- selecting a proposal continues through the existing `content-generation-input.v3` path;
- repeated valid proposal requests do not produce schema errors, contract errors, format drift, duplicate rows, unintended idempotency conflicts, or permanently stuck proposal batches.

## 3. Non-goals

The following work is explicitly deferred:

- automated topic discovery, ranking, or scheduling policy;
- automatic proposal selection;
- fully automatic generation after a proposal becomes ready;
- renaming all contracts to one global V3 version;
- generation quota reservation and reversal;
- generation retry/revise polling repair;
- final generation status recalculation;
- planner fixed-data server assembly;
- worker runtime consolidation;
- image-worker lane separation;
- downstream card-news, blog, marketing, or image model-routing changes;
- removal of every V1 parser or historical read adapter;
- tests for DM, Wiki, FAQ, brand-intelligence, subject-analysis, or customer-support workers.

## 4. Design Principles

1. **One Proposal V2 write service.** Manual, performance, and scheduled callers adapt their input into one service instead of writing batches or jobs themselves.
2. **Server-owned evidence.** Clients send identifiers, not trusted metrics, source text, or frozen evidence.
3. **No worker specialization by origin.** The proposal worker receives standard V2 frozen input and does not branch on `performance` or `scheduled`.
4. **Strict failure over silent fallback.** Missing or incompatible output formats are rejected and never defaulted to blog or another format.
5. **One readiness gate.** V1 and V2 may not disagree about whether proposal creation is enabled or whether the proposal worker is available.
6. **Atomic persistence.** A proposal batch and its job are committed together or not at all.
7. **Canonical idempotency.** A repeated equivalent request returns the existing batch; a reused key for different content is a conflict.
8. **Outcome-based completion.** The change is not complete merely because tests pass. Repeated production-matched executions must stop reproducing the observed failure classes.

## 5. Common Proposal V2 Service

The existing V2 orchestration logic will be refactored behind one internal entry point.

```ts
type CreateProposalBatchV2Command = {
  workspaceId: string;
  brandId: string;
} & (
  | {
      source: "manual";
      actorUserId: string;
      request: ContentOrchestrationV2;
      idempotencyKey: string;
    }
  | {
      source: "performance_experiment";
      actorUserId: string;
      experimentId: string;
      evidenceVersion: string;
    }
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

The performance command accepts only identifiers. Its request, idempotency key, and evidence are built by the service-owned resolver; adapters cannot inject a ready-made `ResearchEvidenceSnapshotV1` or bypass evidence ownership and URL checks. Scheduled input accepts the already-resolved topic as a normal V2 request plus the identifiers needed to validate and atomically link its topic, source snapshots, optional legacy source output, and proposal run. The service persists user-triggered manual and performance batches with database `origin = manual`, and distinguishes performance in the server-owned audit snapshot. `origin = scheduled_crawl` remains reserved for system-created batches. This avoids adding an origin value that older API/UI binaries reject while preserving the execution-source audit trail.

The service owns:

- the global proposal feature kill switch and proposal-worker readiness check;
- actor authorization appropriate to the execution context;
- brand, product, reference, experiment, topic, and snapshot ownership checks;
- approved brand-core resolution;
- seed resolution;
- evidence freezing;
- output format and channel validation;
- request fingerprint calculation;
- idempotent batch lookup;
- atomic V2 batch and job creation.

Adapters may not call the proposal repository's batch/job INSERT methods directly.

After authentication and scope checks, an exact existing replay may be returned without requiring the feature or worker to remain online. For a missing key, the readiness check runs before seed crawling, model work, or any new persistence. The current HTTP ordering, where top-level `content-orchestration.v2` is handled before `CONTENT_PROPOSALS_ENABLED` and worker-health checks, is removed. `CONTENT_PROPOSALS_ENABLED` becomes the real kill switch for all new Proposal V2 writes. `AUTOMATED_CONTENT_ENABLED` remains an additional, narrower kill switch for new scheduled creation only; it never substitutes for proposal-worker readiness.

## 6. Normal Manual Flow

The normal creation screen keeps its current request, response, seed, idempotency, and selection contracts. Its one deliberate behavior change is that it no longer bypasses the common proposal readiness gate.

```text
ContentOrchestrationV2 HTTP body
  -> authenticated user execution context
  -> common Proposal V2 service
  -> Proposal V2 batch/job
```

The refactor must preserve the current request body, response body, idempotency header, seed resolution, and selected-proposal behavior.

## 7. Performance Experiment Adapter

### 7.1 Current experiment identity

Performance experiments are currently calculated response objects, not persisted experiment rows. The ID `reuse-performing-pattern` can therefore recur while its underlying snapshot set changes. Treating `experimentId` as a durable database identity, or using only the first snapshot ID and item count, would create false idempotency replays or unexpected 409 responses.

The performance-insights response gains a server-generated `evidenceVersion`. It is a SHA-256 hash over an explicit experiment-definition version plus a canonical, sorted projection of every selected snapshot's immutable ID, mutable evidence fields, and update/capture version. Canonical JSON uses sorted object keys, sorted snapshot IDs, and normalized UTC timestamps. Changing metrics in an upserted snapshot or changing the experiment algorithm/output mapping therefore changes `evidenceVersion` even when the snapshot UUID remains the same.

### 7.2 Public request

The UI calls `POST /brands/{brandId}/performance-experiments/proposal-batches` with identifiers only. The route parameter supplies the required brand ID:

```json
{
  "experimentId": "reuse-performing-pattern",
  "evidenceVersion": "<server-generated-sha256>"
}
```

It does not send performance metrics, evidence summaries, output settings, or a caller-generated snapshot hash. This keeps the general `ContentSeedV2` contract unchanged and prevents a specialized performance variant from leaking into the proposal worker.

### 7.3 Server resolution

The server reloads the current 30-day performance snapshots, reruns the same experiment builder used by the insights page, resolves `experimentId`, recomputes `evidenceVersion`, and verifies:

- workspace and brand ownership;
- experiment availability;
- the submitted evidence version exactly matches the currently resolved snapshot set;
- every performance snapshot belongs to the same scope;
- snapshots are complete and usable;
- duplicate or missing snapshot identifiers are rejected;
- the experiment's output settings map to one valid V2 output.

The server normalizes the experiment into:

- a standard `content-orchestration.v2` request containing the route brand ID and a `topic_text` subject;
- a server-owned `ResearchEvidenceSnapshotV1` containing only validated evidence with real source URLs;
- the normal `proposal-base-input.v2` plus an optional validated research row that existing job mapping composes for the proposal worker.

Performance evidence uses an explicit cardinality policy. All qualifying snapshots remain in the internal audit. For worker evidence, the server groups by published content, keeps the latest completed snapshot per content, requires a real normalized HTTPS public URL, deduplicates by URL/content hash, orders by exposure descending then capture time descending then UUID ascending, and takes at most eight. If one to eight items remain, it stores `decision = searched` with those items. If none remain, it stores no research row and lets the existing controlled-research step produce the required one-to-eight external evidence items; the server-generated experiment hypothesis/pattern remains in `contentInstruction` so the performance intent is not lost.

Performance with prevalidated evidence still stores `proposal-base-input.v2`, not a precomposed batch snapshot. The service atomically inserts the matching proposal research-snapshot row. Existing job mapping composes the worker DTO as `proposal-input.v2`, while completion continues to verify the stored base snapshot plus the identical research row. Manual, zero-public-URL performance, and automated topic inputs store only the base snapshot and use the controlled-research step. The worker never branches on performance origin.

Full performance metrics, snapshot IDs, capture times, and content hashes are stored in a dedicated internal performance-audit row keyed to the batch. They are not placed in legacy `source_snapshot_json`, whose items require source URLs and are returned to customers. The customer DTO exposes only a safe provenance projection containing experiment ID, evidence version, snapshot count, and capture range. Evidence without a real source URL remains internal audit data and is never disguised as web research with a fabricated URL.

If the page is stale because evidence changed between display and click, the API returns `412 performance_evidence_stale`. The UI refreshes the insights and preserves the user's position; it does not retry with the old version or fall back to V1.

### 7.4 Performance idempotency

After successful server resolution, the adapter derives the logical key itself:

```text
performance:{actorUserId}:{experimentId}:{evidenceVersion}
```

The browser does not invent this identity. Including the actor prevents two users in the same brand from colliding on one actor-bound batch. Equivalent clicks by the same actor against the same evidence version replay the same batch; changed evidence produces a new key instead of an accidental same-key/different-input 409.

Performance keeps two hashes with different purposes:

- the replay fingerprint is computed before mutable resource resolution from scope, actor, execution source, experiment ID, and submitted `evidenceVersion`;
- the resolved-input fingerprint is computed for a new write from the normalized V2 request, sorted snapshot IDs/content hashes, and final frozen input, then stored in the server-owned audit snapshot.

Because `evidenceVersion` already commits to the experiment-definition version and snapshot contents, the replay fingerprint can safely identify an existing frozen batch without rerunning the mutable experiment resolver. The resolved-input fingerprint proves what was actually frozen but does not make an old replay depend on current source availability.

Together the fingerprints cover:

- contract version;
- workspace and brand;
- execution source and persisted origin;
- experiment ID;
- evidence version and sorted performance snapshot IDs/content hashes;
- normalized purpose, output format, channel, aspect ratio, and instruction.

The same key and same replay fingerprint returns the existing batch. The same key and a different replay fingerprint is a conflict. Only a missing batch proceeds to current evidence resolution and resolved-input hashing.

## 8. Automated Card-news Adapter

Automated card-news does not get a special proposal contract or a parallel generation pipeline. It takes the topic already available at the call site and creates the same V2 request that a normal user-selected topic would create.

```json
{
  "contractVersion": "content-orchestration.v2",
  "brandId": "<brand-id>",
  "purpose": "informational",
  "seed": {
    "kind": "topic_text",
    "title": "<resolved topic>"
  },
  "contentInstruction": "<existing notes or null>",
  "productId": null,
  "outputSettings": {
    "outputFormat": "card_news",
    "channelTargets": ["instagram"],
    "aspectRatio": "1:1",
    "outputCount": 1
  }
}
```

If the current source already provides a canonical topic URL and the existing normal V2 flow supports it, the adapter may use the existing `topic_url` seed. It must not introduce a `scheduled_topic` worker contract.

The adapter uses:

- `origin = scheduled_crawl`;
- a system execution context;
- `created_by_user_id = null`;
- a durable automated proposal-run identity created for the topic or regeneration action;
- proposal idempotency key `scheduled-proposal:{automatedProposalRunId}`, derived only after the caller-operation key has been locked and its run ID reserved.

The common service performs the V2 batch/job write. The current V1 request construction and direct SQL INSERT statements are removed.

The current code creates a `channel_outputs.status = generating` placeholder before it knows whether proposal creation is enabled or successful. It also marks the topic generated and inserts `master_drafts` and `topic_publish_groups` rows before a carousel artifact exists. Proposal-ready is not a generated artifact, so retaining those side effects would leave false workflow state. The migrated carousel proposal lane branches immediately after topic selection and before generated-artifact assembly. It creates an `automated_content_proposal_run` linked to the topic and Proposal V2 batch instead:

```text
queued -> ready -> selected
   |        |
   +------> failed
            dismissed
```

- `queued`: batch and job exist;
- `ready`: exactly three Proposal V2 choices are available for review;
- `failed`: proposal creation ended with a terminal error code;
- `selected`: a user selection created the normal Proposal V2 generation and the run stores its generation ID;
- `dismissed`: all proposals were deliberately dismissed.

Run transitions are monotonic and serialized. Worker completion locks job, batch, then run and may update only `queued -> ready`. Both the explicit terminal-failure endpoint and the attempts-exhausted claim-housekeeping CTE update the linked run in the same transaction with `queued -> failed` and the exact error. Selection/dismissal lock batch, run, then proposal rows; selection permits only `ready -> selected`, while dismissal recounts all three proposal states under the run lock and permits only `ready -> dismissed` after the last suggestion is dismissed. `ready`, `failed`, `selected`, and `dismissed` are never overwritten by a late completion/failure replay except for the two explicit ready-to-user-terminal transitions. Completion replay preserves the current run state. Selection replay must still lock and verify that the run's stored generation ID equals the proposal's existing generation ID before returning it.

After resolving an exact existing run replay, the scheduled caller checks `AUTOMATED_CONTENT_ENABLED` before creating a new run or mutating the topic. When disabled, a new carousel proposal lane creates no run, batch, job, or placeholder output. When enabled, the run, Proposal V2 batch, job, and their association are written with the caller's existing database transaction. Proposal-worker completion/failure and proposal selection update the linked run in their own existing transactions. A typed `created` or `replayed` result is required; `disabled`, `null`, or a swallowed exception is never accepted as successful enqueue.

For a proposal-only carousel operation, the content topic remains selected/awaiting proposal review; the proposal run and selected generation draft are the authoritative states. When the source is a `topic_rows` item, that source row moves to `used` only in the same transaction that commits the run/batch/job, and rollback leaves it available. Topic selection queries exclude every content topic already linked to an automated proposal run, so the scheduler cannot pick it again and create a second run. A proposal-only run does not create or consume `master_drafts`, `topic_publish_groups`, or `channel_outputs` rows. If the same operation also starts other real generation lanes, the content topic and artifact tables may follow those lanes' existing lifecycle, but carousel readiness still comes only from the proposal run. Transitioning a proposal-only legacy content topic to generation/artifact-complete state belongs to the later automatic-final-generation design, not this writer migration.

Scheduled creation and regeneration each provide a stable caller operation key. The run row is looked up by that key before insertion, so a transport retry reuses the same run ID and therefore the same `scheduled-proposal:{automatedProposalRunId}` key. An intentional regeneration uses a new caller operation key and creates a new run; it does not manufacture an empty replacement channel output.

The caller operation keys are explicit:

```text
scheduled-topic:{contentTopicId}:instagram:card_news
regenerate-output:{sourceOutputId}:{clientIdempotencyKey}
```

The regeneration HTTP/UI path supplies and reuses `clientIdempotencyKey` until the request receives a definitive response. Carousel regeneration returns a discriminated proposal response:

```ts
type RegenerateContentResponse =
  | { kind: "output"; id: string; status: "generating" }
  | { kind: "proposal"; proposalRunId: string; proposalBatchId: string; status: "proposal_pending" };
```

Story/Reel behavior retains the output response. For carousel, the UI navigates to `proposalBatchId` instead of replacing the old output ID and polling an artifact endpoint. Creating, readying, selecting, failing, or dismissing the proposal run does not mutate the legacy source output or its publish group; they remain reviewable and require no rollback restoration. A later successful V3 artifact handoff may supersede them, but that is outside this migration.

This change stops when a valid Proposal V2 batch and reviewable run have been created. Topic discovery, automatic proposal selection, and automatic final generation are deferred. Manual selection continues through the normal Proposal V2 selection and `content-generation-input.v3` path.

## 9. Shared Read and Resume Compatibility

Changing the writers without changing their consumers would create a new failure: the batch API returns stored `content-proposal-request.v2`, while the wizard currently hydrates its V2 branch only from `content-orchestration.v2`; the scheduled proposal inbox also assumes V1 proposal fields.

The shared read contract is corrected as part of this migration:

- Proposal V2 batch responses retain the stored worker request for audit and add an explicit, safe `resumeInput` projection reconstructed from `input_snapshot_json`.
- `resumeInput.contractVersion` is `content-orchestration.v2` and contains the required batch brand ID plus only the seed, instruction, product ID, purpose, and output settings required to restore the wizard. It passes the existing exact V2 parser and does not expose the full frozen brand core or internal evidence payload.
- Performance batch responses add `provenance: { kind: "performance_experiment", experimentId, evidenceVersion, snapshotCount, capturedFrom, capturedTo }`; no raw metrics are returned.
- The UI hydrates V2 state from `resumeInput`, never by pretending `content-proposal-request.v2` is an orchestration request.
- Batch DTO origin parsing remains `manual | scheduled_crawl`; performance provenance comes from the safe audit projection, not a third persistence origin.
- The scheduled proposal-list response carries an explicit proposal contract-version discriminator plus batch origin and purpose. It does not infer V1 versus V2 from optional proposal fields.
- The inbox renders V2 `title`, `selectionReason`/`oneLineIntent`, output format, and server-resolved evidence preview. V1 rendering remains only as temporary read compatibility.
- Selecting either migrated V2 proposal creates/returns the selected run and draft generation only. A separate idempotent start locks that draft and atomically produces `content-generation-input.v3`, freezes its prompt binding, reserves allowance, and creates the first job.

Targeted tests cover a performance batch reopen, a scheduled V2 inbox item, and selection from both. This is migration compatibility work, not a redesign of the wizard or inbox.

## 10. Database Changes

The proposal batch origin constraint remains `manual | scheduled_crawl`. No existing rows are rewritten. `created_by_user_id` is already nullable and continues to distinguish user-created from system-created scheduled batches together with `origin`.

An additive `ai_content_proposal_performance_audits` table stores one internal-only row per performance batch: experiment definition/ID, evidence version, resolved-input fingerprint, complete scoped snapshot audit JSON, and capture bounds. It has a scope-consistent batch foreign key and is never returned as legacy `sourceSnapshots`; API mapping emits only the safe provenance projection.

An additive `automated_content_proposal_runs` table records the pre-generation lifecycle without pretending that a channel artifact is already generating. It contains scoped foreign keys to workspace, brand, content topic, Proposal V2 batch, an optional source output for legacy regeneration, the caller operation key and replay fingerprint, the frozen source-snapshot ID list, status, selected generation ID, and terminal error fields. Required uniqueness is:

- one run per workspace/brand/caller operation key;
- one run per proposal batch;
- scope-consistent foreign keys for the topic, batch, source output, and generation.

Database CHECK constraints enforce `queued|ready|failed|selected|dismissed`, `selected => selected_generation_id is not null and error_code is null`, `failed => error_code is not null and selected_generation_id is null`, and null generation/error fields for other states. Every transition checks an affected-row count of exactly one; zero is accepted only after an explicit idempotent-replay verification.

Existing placeholder outputs are not rewritten by the migration. New migrated traffic no longer creates them.

The repository input type must allow:

- a required user ID for manual and performance execution sources, both persisted as `origin = manual`;
- no user ID for `scheduled_crawl`;
- one shared request fingerprint comparison independent of actor type.

The migration is additive, but binaries predating run-transition mirroring are not a safe rollback target after the first run exists. Deployment therefore establishes a compatibility-release rollback floor before enabling either migrated writer.

## 11. Transaction and Idempotency Semantics

The persistence port exposes transaction-aware operations; it does not always open a private connection. The HTTP manual/performance adapters ask the repository to open one transaction. The automated adapter supplies the `PoolClient` already owned by `generateContent` or regeneration. Nested, independently committed V2 transactions are forbidden because an outer rollback would otherwise leave an orphan proposal batch.

Every command first performs an authenticated, scope-bound replay probe using its pre-resolution replay identity. An exact committed replay returns immediately. A missing probe runs the feature/worker new-write preflight, then enters the write transaction and repeats the lookup under a lock so a concurrent commit cannot create a duplicate.

Manual and performance writes lock the scoped proposal idempotency key, recheck the batch fingerprint/actor, and then validate current resources before insertion. A new performance write inserts its performance-audit row and, when public evidence is available, its research snapshot in the same transaction as its base snapshot, batch, and job.

Scheduled writes use a strict two-lock order:

1. take a transaction-scoped advisory lock on `workspace + brand + callerOperationKey`;
2. look up the automated run without taking its row lock;
3. if it exists, lock the linked batch first and the run second, re-read both, compare replay identity, and return;
4. if it does not exist, lock/reserve the content topic, generate the run UUID, and derive `scheduled-proposal:{automatedProposalRunId}` while holding the caller-operation advisory lock;
5. take the scoped proposal-key advisory lock and recheck run/batch absence;
6. validate current topic, source snapshots, optional legacy source output, and V2 request;
7. insert the Proposal V2 batch and job;
8. insert the automated run with its batch association;
9. commit by the transaction owner.

Global row-lock order is explicit: new scheduled work locks topic before creating batch/run; scheduled replay locks batch then run; worker transitions lock job then batch then run; selection/dismissal lock batch then run then proposal/generation. No code path locks a run row and then waits for its batch or job, preventing the run↔batch deadlock.

An equivalent replay does not fail merely because a source used by the already-frozen batch was later disabled or deleted. A new write still fails closed on unavailable resources. No worker may claim the job before commit. Failure at any write rolls back the whole unit: automated run, batch, job, and association.

Actor equality uses PostgreSQL `IS NOT DISTINCT FROM`, not `=`, so two system-actor nulls compare equal while a user ID and null never do. Repository coverage includes scheduled null-actor replay and null/non-null mismatch cases.

Replay rules:

```text
same scope + same actor + same key + same replay fingerprint
  -> return the existing batch

same scope + same key + different actor or replay fingerprint
  -> conflict

new key
  -> create one new batch and one new job
```

Automated card-news uses `scheduled-proposal:{automatedProposalRunId}`. A retry first resolves the stable caller operation key to the same run ID and reuses the same proposal key. A genuine regeneration has a new caller operation key and run ID.

## 12. Failure Semantics

| Failure | Result | Retry policy |
|---|---|---|
| Invalid V2 contract or incompatible format/channel | Reject before batch creation | Not retryable |
| Missing or foreign experiment/topic/snapshot | Reject before batch creation | Not retryable |
| Stale performance evidence version | Refresh performance insights; create nothing | Retry only with refreshed version |
| New proposal request while proposals are disabled or the worker is unavailable | Return explicit unavailable response; create nothing | Retry after readiness recovers |
| Same key with different fingerprint | Conflict | New key only after intentional input change |
| Transient database error | Full rollback | Retry with same key |
| Proposal worker contract failure | Batch and linked automated run fail with the exact error code | Explicit retry policy |
| Proposal worker transient failure | Existing worker retry policy | Same job |
| Proposal attempts exhausted during claim housekeeping | Job, batch, and linked run fail atomically with `content_proposal_attempts_exhausted` | New explicit retry/run only |

The adapters do not fall back to V1. Missing formats are never defaulted to blog or marketing. Automated callers must inspect the V2 service result and may not treat `disabled`, `null`, or a swallowed error as successful enqueue. Automated V2 failure is represented by the proposal run's terminal error; no empty channel output is left in `generating`.

## 13. Harness Design

### 13.1 Contract fixture harness

Fixtures cover:

- normal `topic_text` V2;
- performance-experiment V2;
- automated card-news V2.

Each fixture passes through the API parser, seed resolver, V2 orchestration, frozen-input parser, and proposal-worker parser. The harness asserts exact version, format, channel, evidence IDs, and absence of mutation or fallback.

### 13.2 Adapter harness

Performance cases include ownership, incomplete snapshots, duplicate snapshots, stable fingerprint ordering, changed metric hashes, zero/one/eight/more-than-eight public evidence candidates, deterministic evidence ranking, controlled-search fallback, safe audit projection, and rejection of client-supplied evidence.

Automated cases assert topic/source/run ownership, topic preservation, fixed card-news settings, scheduled origin, system actor behavior, caller-operation-first lock ordering, stable run/proposal key reuse, absence of premature artifact records, and absence of V1 construction or direct batch/job INSERT calls.

### 13.3 Repository harness

PGlite covers transaction behavior and ordinary replay. Direct PostgreSQL covers the concurrency lock.

Required cases:

1. batch and job, plus performance audit/research rows when applicable, are created together;
2. automated run, batch, job, and association commit or roll back together on the caller-owned transaction;
3. same key/hash returns one row;
4. same key/different hash conflicts;
5. concurrent identical requests create one batch;
6. performance source persists manual origin, the user ID, and its audit provenance;
7. scheduled origin stores a null user ID and null-actor replay succeeds via `IS NOT DISTINCT FROM`;
8. a user/null actor mismatch conflicts;
9. an already-created equivalent batch replays after its source is later disabled, while a new batch does not;
10. V2 request and base input snapshots round-trip exactly, and internal performance metrics never leak through `sourceSnapshots`;
11. neither migrated writer creates a V1 row;
12. automated proposal creation creates no premature `channel_outputs`, `master_drafts`, or `topic_publish_groups` row;
13. a proposal-only topic is not marked `generating` or `generated`, while mixed real-generation lanes retain their own state;
14. concurrent calls with one caller-operation key reserve one run before deriving one proposal key;
15. explicit failure and attempts-exhausted housekeeping both fail the linked run exactly once;
16. late completion/failure replays cannot regress `selected`, `dismissed`, or `failed`;
17. three concurrent dismissals serialize and transition the run to `dismissed` exactly once;
18. completion, scheduled replay, selection, and dismissal concurrency follows the global lock order without deadlock;
19. source `topic_rows` consumption commits and rolls back atomically with the run, and content-topic selection excludes a topic already linked to any automated proposal run;
20. legacy carousel regeneration preserves the source output and publish group through run ready/failure/dismissal/selection.

### 13.4 Proposal-worker protocol harness

A deterministic fake model claims and completes jobs from both adapters. It verifies both use the standard V2 worker path, save exactly three proposals, preserve output format/channel, reject malformed results, and transition a linked automated run monotonically to `ready` or `failed`. It then verifies manual selection creates a draft generation without V3/job/reservation side effects and exercises the start service with fake persistence to build/validate `content-generation-input.v3`, prompt binding, reservation, and first queued job atomically.

No real card-news, blog, reel, image, DM, Wiki, FAQ, brand-intelligence, or subject-analysis worker is started by this deterministic harness. The later production canary separately exercises only the content-generation workers required by the selected cases.

### 13.5 One schema-only Codex preflight

After deterministic contract tests pass, run exactly one schema-only Codex preflight with the production proposal worker's exact model, command, and JSON Schema. It creates no content row, proposal batch, job, or database state. Its only purpose is to prove that the provider accepts the exact schema shipped to production and that the response passes the local V2 parser. The command and cost-bearing invocation are recorded in the completion evidence. It is not repeated as a substitute for deterministic tests.

### 13.6 UI harness

The performance UI test verifies identifier-only adapter requests, stable replay for an unchanged `evidenceVersion`, refreshed identity after evidence changes, stale-evidence handling, preservation of page state on error, and absence of V1 fallback. Resume/inbox tests verify the explicit V2 discriminator and exact-parser-valid `resumeInput` projection rather than V1 field guessing. Carousel-regeneration UI tests require the discriminated proposal response, navigation to the proposal batch, no replacement-output polling, and unchanged Story/Reel behavior.

### 13.7 Static regression guard

CI rejects production references that reintroduce:

- `content-proposal-request.v1` in `performanceGateway.ts`;
- `content-proposal-request.v1` in `automatedCardNews.ts`;
- direct `ai_content_proposal_batches` INSERT in `automatedCardNews.ts`;
- direct `ai_content_proposal_jobs` INSERT in `automatedCardNews.ts`.

A targeted regression test also rejects restoration of the carousel behavior that marks the topic generated or inserts `master_drafts`, `topic_publish_groups`, or an empty `channel_outputs.status = generating` row before a proposal has been selected.

Legacy parser/read compatibility elsewhere remains outside this guard.

## 14. Test Scope

Run only:

- targeted API V2 orchestration unit tests;
- targeted PGlite repository tests;
- the direct PostgreSQL idempotency/concurrency harness;
- content-proposal-worker fake-model protocol tests;
- one approved schema-only Codex preflight for the proposal worker;
- performance gateway/component tests;
- targeted regeneration HTTP/client and `PublishQueuePage` contract tests, including per-output idempotency-key reuse until a definitive response;
- related contract tests and TypeScript builds.

Do not run unrelated worker suites, whole-workspace E2E, or non-content worker processes.

## 15. Deployment and Rollback

Deployment order:

1. apply the additive performance-audit and automated proposal-run migrations;
2. explicitly start the optional content-proposal worker profile/service instead of relying on the rollout script that skips stopped services, then require a fresh heartbeat;
3. run the one approved schema-only proposal-worker preflight;
4. atomically deploy compatibility release A with `CONTENT_PROPOSALS_ENABLED=true`: client-bound V2 persistence, common V1/V2 readiness gate, all run transition mirrors (completion, explicit failure, attempts exhausted, selection, selection replay, dismissal), and V2 resume/inbox decoding, while neither migrated writer is enabled and the proposal worker is confirmed online;
5. canary the unchanged normal V2 path through the new common gate;
6. record release A's image/SHA as the minimum rollback floor;
7. deploy writer release B: performance adapter/UI and automated-card-news V2 adapter, keeping `AUTOMATED_CONTENT_ENABLED=false` on ordinary replicas;
8. run repeated production-matched canaries on a designated test brand through the isolated canary replica;
9. perform read-only database and log verification before declaring completion.

Deployment configuration and `deploy/scripts/preflight.sh` must no longer hard-code `CONTENT_PROPOSALS_ENABLED=false`. They validate an explicit boolean, while API readiness requires the proposal worker to be online whenever the value is true. Both feature flags are process environment, so changing them requires an explicit container recreation/roll and post-restart readiness check. No hidden V2 bypass or canary-only bypass is introduced.

The automated feature remains disabled on ordinary production API replicas. A dedicated production canary replica uses the same image, production database/queue, and normal adapter with `AUTOMATED_CONTENT_ENABLED=true`, but has no customer ingress, no external cron, operator-only access, and an enforced designated test-brand allowlist at the ingress/operator command boundary. The flag is returned to false and the replica removed after observation. This exercises the real gate and adapter without exposing non-test brands; no canary-only code bypass, topic-discovery path, or scheduler path is introduced.

Rollback:

- the additive database migration remains in place;
- API canary failure stops deployment before UI promotion;
- `CONTENT_PROPOSALS_ENABLED=false` stops every new Proposal V2 write during rollback or worker outage;
- release B may roll back only to compatibility release A, whose API/UI understand V2 reads and continue every run transition;
- after the first automated run exists, no API binary older than release A is allowed because it would leave run state divergent from batch/job/proposal state;
- the automated path remains dormant while its production flag is disabled;
- valid V2 canary batches are not deleted or rewritten.

## 16. Operational Completion Gate

Passing unit tests alone is insufficient. The change is complete only when the recurring failures stop under repeated execution.

### 16.1 Deterministic repetition

- run each adapter fixture 20 consecutive times with stable results;
- run the targeted suite from a fresh process three consecutive times;
- run 20 concurrent identical requests per adapter case and confirm one batch/job;
- replay the same request multiple times and confirm no 409 and no new rows;
- change the request while reusing the key and confirm a deliberate conflict rather than silent reuse;
- observe zero V1 writes from both migrated producers.

### 16.2 Production-matched canary repetition

On a designated test brand:

- create three distinct performance V2 batches;
- create three distinct automated-topic V2 batches by invoking the adapter directly without enabling the scheduler;
- replay each request and confirm the same batch ID is returned;
- repeat automated topic selection and confirm the linked topic is excluded rather than producing another run;
- require every fresh batch to reach `ready` with exactly three proposals within the proposal-worker timeout window;
- require each automated run to reach `ready`, point to exactly one matching batch, and create no premature `master_drafts`, `topic_publish_groups`, or `channel_outputs` row;
- require the stored request, frozen input, proposal output format, and worker job contract to remain V2 and mutually consistent;
- reopen at least one performance batch through `resumeInput`, list at least one scheduled V2 inbox item, and select one proposal from each path;
- confirm both selections return generation IDs with `draft_json.origin = proposal-v2`, and the scheduled selection moves its linked run to `selected`;
- manually finalize and start those two card-news generations through the normal V3 API, require exact `content-generation-input.v3`, require only the card-news and required image-render content workers to run, and require both generations to reach their normal successful terminal state;
- confirm no blog or marketing job is created for either card-news generation and no DM/Wiki/FAQ/brand-intelligence/subject-analysis worker is exercised;
- confirm no `invalid_json_schema`, `content_proposal_job_invalid`, format fallback, duplicate row, or stuck `queued/building` state;
- with fresh unique keys, confirm the normal, performance, and automated paths all fail closed without rows when the common proposal gate is disabled; verify worker-unavailable behavior with the readiness harness rather than stopping the production worker;
- observe proposal queue and logs for 30 minutes after the final run.

If any unexpected failure occurs, the change is not complete. The cause must be fixed and the full repeated-canary window restarted. One successful run after a failure is not sufficient evidence.

### 16.3 Final evidence

The completion report must include:

- targeted harness commands and results;
- canary batch IDs;
- replay batch-ID equality;
- reopened/listed batch evidence, the two selected generation IDs, their V3 input contract hashes, and successful terminal statuses;
- row counts proving no duplicate batches, jobs, or automated runs and no premature automated `master_drafts`, `topic_publish_groups`, or `channel_outputs` rows;
- database counts proving no new V1 batches/jobs;
- relevant proposal-worker log error counts;
- confirmation that no unrelated worker was tested.

## 17. Deferred Follow-up

After this migration is stable, separate designs may cover:

1. automated topic discovery and ranking;
2. automatic proposal selection and final generation;
3. generation quota reservation and reversal;
4. generation status/retry polling repair;
5. server-side fixed-data package assembly;
6. broader V1 compatibility removal;
7. worker runtime and readiness consolidation.
