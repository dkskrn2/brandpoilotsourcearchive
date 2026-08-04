# Three-Format Purpose-Routed Content Workers Design

**Date:** 2026-08-04
**Status:** Direction and model policy approved in conversation; independently reviewed written specification awaiting user review
**Scope:** Replace the overloaded marketing generation lane with three format-owned workers whose prompts are selected by content purpose.

## 1. Decision

Content generation has two independent axes:

```text
output format = card_news | blog | reel
purpose       = informational | marketing
```

The output format selects the planning worker. The purpose never selects a worker; it selects one of two explicit prompt policies inside that format worker.

| Output format | Informational purpose | Marketing purpose | Planner service | Final renderer |
|---|---|---|---|---|
| `card_news` | card-news informational prompt | card-news marketing prompt | `card-news-worker` | `image-worker` |
| `blog` | blog informational prompt | blog marketing prompt | `blog-worker` | `image-worker` |
| `reel` | reel informational prompt | reel marketing prompt | `reel-worker` | `image-worker` + FFmpeg |

The current `brand-pilot-marketing-worker` becomes `brand-pilot-reel-worker` in code, package metadata, environment variables, Docker images, Compose, CI/CD, API routing, database queue types, tests, and operational documentation. It does not remain as an alias.

## 2. Why the Current Structure Fails

The current source uses `marketing` for three unrelated concepts:

1. content purpose: `informational | marketing`;
2. output format: `reel | marketing_content`;
3. generation, queue, manifest, worker, and deployment type: `marketing`.

That overlap permits format drift and misleading fallbacks. In particular, proposal selection currently defaults a missing format to `blog` and maps every non-card/non-blog value to `marketing`. A malformed, old, or missing value can therefore reach the wrong worker instead of failing at the contract boundary.

Card-news and blog V3 prompts also receive `purpose` in their fixed JSON but do not select an explicit informational or marketing prompt block. The old marketing worker does branch on purpose, but also handles both `reel` and `marketing_content` plus legacy `single_image` and `channel_text` jobs. A directory rename alone would leave broken queues, retry paths, result labels, deploy manifests, and orphan worker processes.

## 3. Goals

After this change:

- new proposal and generation writes accept exactly `card_news | blog | reel`;
- `informational | marketing` remains a required, orthogonal purpose value;
- every one of the six format-purpose combinations has an explicit prompt policy;
- a job's `outputFormat` alone determines `card_news-worker`, `blog-worker`, or `reel-worker`;
- retry and partial regeneration reuse the frozen V3 `purpose` and never infer purpose from output format or worker identity;
- `marketing_content`, legacy `single_image`, legacy `channel_text`, and the retired technical format value `marketing` cannot be used by an active AI Content Studio write, claim, retry, regeneration, publish, or render path;
- performance experiments and automated card-news stop writing Proposal V1 and use the common Proposal V2 assembly service;
- all fixed generation input is assembled and frozen server-side before a planner claims the job;
- generation usage is reserved exactly once at start and reversed exactly once after a permanent failure;
- the old marketing service, image reference, environment variables, API claim slug, and deployment automation are absent from the active repository and production release;
- malformed or retired values fail explicitly instead of falling back to another format;
- the implementation is complete only after deterministic harness coverage and successful production canaries for all six combinations.

## 4. Non-Goals

- DM, Wiki, FAQ, profile refresh, customer-support, brand-intelligence, and subject-analysis worker behavior is not changed or runtime-tested.
- Automated topic discovery, topic ranking, and automatic proposal selection are not introduced.
- A separate worker per purpose is explicitly rejected.
- A purpose-specific model is explicitly rejected. Models belong to format workers, not to informational or marketing prompts.
- Existing Instagram delivery contracts such as `instagram_story`, `instagram_reel`, `instagram_story_render`, and `instagram_reel_render` are not the retired marketing planning worker and remain supported. This cutover does not newly expose Reel as a direct-publish UI option; it preserves the accepted backend/regeneration contract.
- Trend-media kind `reel` is also outside the Studio generation union and remains unchanged.
- Historical Git commits and already-applied migration files are not rewritten. A new migration establishes the final schema.
- Old registry image blobs may remain under registry retention policy, but no release manifest, Compose service, script, or environment file may be capable of launching them.

## 5. Canonical Contracts

### 5.1 Domain types

The active write-side contracts use one canonical format union:

```ts
type ContentStudioOutputFormat = "card_news" | "blog" | "reel";
type ContentPurpose = "informational" | "marketing";
type ContentWorkerType = ContentStudioOutputFormat;
```

The single source of these values is a new browser-safe TypeBox workspace package at `packages/brand-pilot-content-contracts` named `@brand-pilot/content-contracts`. It has no Node-only dependency; TypeScript types derive from the authored runtime schemas. The package owns:

- `CONTENT_OUTPUT_FORMATS`, `CONTENT_PURPOSES`, and their exact runtime parsers;
- the exhaustive format descriptor map containing domain value, plan contract, worker service/package name, claim-route slug, release component key, and Korean label;
- contract-version constants used by orchestration, proposal, V3 input, planner, image package, and manifest parsers;
- deterministic generators for the complete orchestration, proposal, V3 input, three plan, image-package, and manifest JSON schemas plus `generated/content-catalog.json`.

Authored modules are `src/catalog.ts`, `orchestration.ts`, `proposal.ts`, `generation.ts`, `plans.ts`, `manifest.ts`, and `validators.ts`; `src/generateArtifacts.ts` is the only artifact writer. Semantic cross-field validators for purpose/product, selected-proposal, evidence ownership, plan/format, and asset count live beside the schemas rather than being reimplemented by consumers.

The root workspace adds `packages/*`. Customer UI, API, worker runtime, proposal worker, image worker, and all three format workers import the package instead of declaring local unions or sets. Worker-local plan-schema copies are deleted; Codex runners resolve the generated schemas from the canonical package. Generated schema/deploy artifacts carry a source hash and are regenerated into a temporary directory in CI for byte comparison; any drift fails the build. SQL migrations necessarily contain literal checks, so the migration harness reads the generated catalog and final database catalog and compares them exactly. Docker build/runtime tests prove the canonical package and schemas exist in every affected image.

Domain and transport names are distinct but owned by the same exhaustive map:

| Domain format | Worker service | Claim slug | Plan contract |
|---|---|---|---|
| `card_news` | `card-news-worker` | `card_news` | `card-news-plan.v2` |
| `blog` | `blog-worker` | `blog` | `blog-plan.v2` |
| `reel` | `reel-worker` | `reel` | `reel-plan.v2` |

The claim route parameter is renamed to `:outputFormat` and parsed directly: `/worker/ai-content-jobs/card_news/claim`, `/blog/claim`, or `/reel/claim`. `card-news` is not accepted as a protocol alias; it remains only the conventional package/process name. The clean-cut migration drops redundant `ai_content_generations.type`, keeps `ai_content_generations.output_format` as the sole generation-format column, and renames `ai_content_generation_jobs.content_type` to `output_format`. API/UI DTOs expose `outputFormat` directly rather than persisting or returning a second `type` field. Manifest format fields use only the domain format. No adapter maps `reel` to `marketing`, and no consumer maintains a catch-all mapping.

Contract versions retain their existing meanings:

- orchestration request: `content-orchestration.v2`;
- proposal: `content-proposal.v2`;
- final frozen input: `content-generation-input.v3`;
- card-news plan: `card-news-plan.v2`;
- blog plan: `blog-plan.v2`;
- reel plan: `reel-plan.v2`;
- final artifact manifest: `ai-content.v3`.

The numbers describe independent contract generations; they are not application releases and are not renamed merely to make every suffix equal. The artifact manifest advances from V2 to V3 for a concrete breaking reason: V3 removes the redundant manifest `type` field and keeps only `outputFormat`.

### 5.2 Strict routing

Routing is exhaustive and has no default branch:

```ts
switch (outputFormat) {
  case "card_news": return "card_news";
  case "blog": return "blog";
  case "reel": return "reel";
  default: throw new Error("content_output_format_unsupported");
}
```

The following behavior is forbidden:

- `outputFormat ?? "blog"`;
- `else -> marketing`;
- accepting an arbitrary string and choosing a worker later;
- deriving purpose from worker type, product presence, channel, or old manifest data.

The API validates the request, proposal, approved proposal snapshot, final V3 input, job `output_format`, returned plan, image package, and manifest against the same format and purpose before advancing state.

### 5.3 Purpose invariants

The following rules preserve the current approved V2/V3 contract; they are not a new worker split or purpose-specific service:

For all three formats:

- informational input requires `product = null` and a non-empty, frozen research-evidence set;
- marketing input requires one approved, frozen product snapshot;
- proposal `purposeDetails.kind`, orchestration purpose, V3 output purpose, prompt selection, image-package purpose, and manifest purpose must be identical;
- a mismatch is terminal contract failure and is not repaired by changing format or purpose.

## 6. Prompt Ownership

Each format worker owns three prompt components:

1. common grounding and format-contract rules;
2. informational-purpose rules;
3. marketing-purpose rules.

The worker performs an exhaustive `purpose` switch before spawning Codex. The opposite purpose block must not be included.

### 6.1 Informational policy

- optimize for education, problem solving, comparison, checklist, Q&A, or useful insight;
- use frozen research evidence for factual and time-sensitive claims;
- prohibit product promotion, purchase pressure, sales claims, and purchase CTA;
- allow only non-sales engagement such as save, share, or a question;
- preserve known limitations and evidence gaps instead of inventing certainty.

### 6.2 Marketing policy

- use only the approved product snapshot for product facts;
- connect a verified strength to the selected target, situation, barrier, and campaign objective;
- retain limitations and buying barriers instead of hiding them;
- allow an explicit conversion CTA appropriate to the selected channel;
- prohibit invented price, performance, testimonial, urgency, discount, or guarantee claims.

### 6.3 Format policy

- card-news owns slide hierarchy, square package structure, mobile copy density, and caption rules;
- blog owns search intent, semantic HTML, evidence links, metadata, inline-image necessity, and readability;
- reel owns 9:16 scenes, hook-to-payoff sequence, per-scene copy, caption, hashtags, and CTA;
- video duration, scene assembly, FFmpeg execution, codec verification, upload, and manifest creation remain image-worker finalizer responsibilities.

Common validation code may be shared, but prompt prose is explicit per format and purpose. There is no generic marketing prompt shared across workers.

## 7. Model Policy

Per the explicit user decision on 2026-08-04, purpose does not alter the model and card-news, blog, and reel planners all use `gpt-5.6-terra`. Every production planner command passes `--model gpt-5.6-terra` before `exec` and ignores user-level default model configuration. The implementation must not introduce a marketing-purpose model or choose a model from `purpose`.

Visual asset generation remains `gpt-image-2` through image-worker, and reel MP4 assembly remains local FFmpeg. The immutable prompt binding records `gpt-5.6-terra` for all three planner formats so retry, canary evidence, and result diagnostics can prove which model ran.

## 8. Worker and Package Refactor

The old package is renamed and narrowed:

```text
workers/brand-pilot-marketing-worker
  -> workers/brand-pilot-reel-worker

@brand-pilot/marketing-worker
  -> @brand-pilot/reel-worker

marketing-plan.v2
  -> reel-plan.v2
```

All related names change together:

- `MARKETING_*` -> `REEL_*` environment variables;
- marketing command and schema filenames -> reel filenames;
- marketing skill identity -> reel planning skill identity;
- marketing worker IDs and error-code prefixes -> reel equivalents;
- `/worker/ai-content-jobs/card-news/claim` -> `/worker/ai-content-jobs/card_news/claim`;
- `/worker/ai-content-jobs/marketing/claim` -> `/worker/ai-content-jobs/reel/claim`;
- `marketing-worker-1` -> `reel-worker-1`;
- marketing image/release component keys -> reel component keys;
- npm scripts, package-lock workspace entry, repository contracts, release-impact mapping, Compose profile, preflight, rollout, and operations documentation -> reel names.

The reel worker accepts only V3 `outputFormat = reel`. Legacy V2 `single_image | channel_text`, `marketing_content`, and `marketing-plan.v2` branches are deleted rather than commented out.

## 9. Image Worker and Finalization

Image-worker continues as the common render/finalize service, but its accepted contracts are narrowed:

- image assets accept only `card_news | blog | reel`;
- the reel finalizer accepts only `reel-plan.v2` with `outputFormat = reel`;
- the `ai-content.v3` reel manifest has `outputFormat = reel` and the frozen purpose, with no second `type` discriminator;
- card-news and blog finalizers verify their format-specific plan versions;
- the `marketing_content` social-manifest branch is removed;
- no output can be finalized when plan format, V3 format, generation `output_format`, asset package, or manifest disagrees.

The image-worker keeps dedicated `reelRenderer` and FFmpeg code. A separate rendering service is unnecessary because this worker already owns render jobs, storage checksums, final package upload, and manifest completion.

### 9.1 Studio generation versus channel delivery

The refactor does not perform a global replacement of `reel` or delete image-worker delivery behavior. Three namespaces remain deliberately distinct:

| Namespace | Values relevant here | Meaning |
|---|---|---|
| Content Studio | `card_news | blog | reel` | user-selected generated artifact format |
| Instagram delivery | `instagram_story | instagram_reel` and corresponding render-job types | downstream publication/regeneration format |
| trend media | `reel` | observed source-media classification |

The Studio planner contract becomes `reel-plan.v2` and its final manifest uses only Studio `outputFormat = reel`. The existing image-worker delivery prompt/manifest version `worker-reel.v3` remains unchanged because it belongs to the separate Instagram delivery lane; its `v3` is not `content-generation-input.v3` or `ai-content.v3` and does not indicate a newer application release.

Channel capability data is split so it cannot conflate generation with delivery:

- `studioOutputFormats` advertises only Studio formats; Instagram supports `card_news` and `reel`, Threads supports none, and blog export remains the blog path;
- internal `channelOutputGenerationReady` continues to describe downstream scheduling/regeneration readiness;
- `publishModes` remains typed by delivery formats and its current UI exposure is unchanged.

The old marketing worker's `analyze` job branch is deleted only after repository/API contract tests prove that the independent subject-analysis and product-library promotion routes remain connected. No subject-analysis worker process is started by this change's harness.

Reference-library rows are not blindly relabeled. Retired `single_image`, `channel_text`, or `marketing_content` format eligibility is archived/excluded from active Studio seed queries; `channel_text` is never converted to blog, and no record becomes `card_news` without an explicit separately reviewed semantic migration.

## 10. Proposal V2 Writers and Server-Owned Assembly

This design incorporates the approved requirements in `2026-08-04-proposal-v2-writer-migration-design.md`.

### 10.1 Performance experiment

The performance UI stops constructing `content-proposal-request.v1`. It sends only experiment identity and evidence version to a server-owned adapter. The server reloads and validates the experiment, freezes evidence, constructs a normal V2 orchestration request, and calls the common Proposal V2 service.

The currently implemented experiment is informational card-news. Future marketing experiments must provide an approved product identity before they can use marketing purpose; they may not infer a product from performance data.

### 10.2 Automated card-news

Automated card-news uses the resolved topic to call the same Proposal V2 assembly service with:

```text
purpose       = informational
outputFormat  = card_news
channel       = instagram
aspectRatio   = 1:1
product       = null
```

It does not directly insert proposal batches or proposal jobs and does not create an empty channel output before a proposal is selected.

### 10.3 Removal order

Within the implementation branch, the V2 adapters and their tests are created first. Only after static and repository tests prove that no first-party V1 producer remains are the V1 writer DTOs, API parser branches, content-proposal-worker V1 parser/model branch, direct SQL, legacy wizard route, legacy result/read adapters, and legacy card-news/blog/reel worker generation branches deleted. Because the migration clears the affected execution data, the final release does not retain a historical read alias. The final release contains no compatibility alias.

### 10.4 Server-owned fixed-input assembly

A single API service, `apps/api/src/aiContentFixedInputAssembler.ts`, owns generation-time assembly. UI code and workers submit identities; they never assemble mutable brand, product, research, reference, or attachment data themselves. Selection and start remain two explicit operations:

- the idempotent selection transaction marks one Proposal V2 row selected and creates/returns a draft generation row containing the canonical `output_format` and `purpose`, but creates no V3 snapshot, prompt binding, planner/render job, or usage reservation;
- the idempotent start transaction locks that draft generation, verifies it has not started or changed, then runs the assembler and advances it to queued.

Inside the start transaction the assembler:

1. reloads the selected Proposal V2 row and its approved batch snapshot under workspace/brand scope;
2. reloads the approved brand core/rules, approved product version when required, frozen research-evidence rows, approved reference versions, selected brand/avatar assets, and finalized attachments;
3. rejects missing, stale, cross-tenant, unapproved, deleted, purpose-mismatched, or format-mismatched inputs;
4. canonicalizes array order and JSON representation, constructs `content-generation-input.v3`, and computes a SHA-256 hash over the exact immutable JSON;
5. inserts the V3 snapshot and prompt binding once, in the same transaction as the generation start-state transition, first job creation, and allowance reservation.

If any start step fails, the whole start transaction rolls back: the selected draft remains restartable, with no snapshot, job, or charge. Exact start replay returns the same started operation; a changed key/fingerprint conflicts. Selection never consumes allowance.

The six format-purpose prompt bindings are owned by `@brand-pilot/content-contracts`, for example `planner.card_news.informational.v1` and `planner.card_news.marketing.v1`. The assembler writes the exact proposal, planner, image, schema, and model binding versions into the orchestration `promptDefinitionVersions` and an immutable `ai_content_generation_prompt_bindings` row keyed to the generation. The row also stores format, purpose, plan contract, schema hash, and model ID. A worker claim returns the frozen V3 snapshot plus this binding; the worker validates both against the canonical descriptor and may not substitute a local default. Retry and regeneration reuse the binding, while a deliberately new retry operation creates a new generation/reservation identity but retains the same frozen inputs unless the user starts a new proposal flow.

The V3 JSON and binding row are the only planner inputs. A format worker cannot query current product, research, reference, or attachment tables to repair a missing field. Any binding/hash disagreement is a terminal contract error before the model starts.

## 11. Database Migration and Data Disposal

The user authorized deletion of existing AI content proposal/generation execution data when required for the schema change. The deletion scope is limited to AI content execution state; brands, brand core, approved products, product/service analysis, reference libraries, source libraries, and user accounts are preserved.

### 11.1 Maintenance cutover

The migration runs during an explicit content-generation maintenance window. `CONTENT_PROPOSALS_ENABLED` is not a maintenance gate: the current create path writes before that check, while selection, start, retry, and regeneration have separate entry points.

Before the destructive cutover, a compatibility-safe write-fence change is deployed to every API instance without enabling any new writer or schema. It adds one common `assertAiContentWritable` guard at the first line of create, proposal-create, select, start, retry, regenerate, automated-run, and internal content-generation mutations. The same central maintenance state is checked inside the repository transaction. A database write-fence on the proposal/generation root tables blocks a stale process that bypasses HTTP; only the dedicated migration role with a transaction-local cutover token may bypass it. Maintenance responses are `503 ai_content_maintenance` and create no rows or state transitions.

The exact sequence is:

1. export the targeted incident bundle described below and checksum it;
2. create a fresh provider database snapshot, record its provider backup ID, current migration version, running release SHA/image digests, and counts/hashes for every preserved table;
3. verify every API instance runs the write-fence SHA, enable maintenance, disable autoscaling/old-image restart, and prove create/select/start/retry/regenerate all return 503 with unchanged row counts;
4. stop content-proposal, card-news, blog, old marketing, and image workers, then wait for claims/leases to drain or expire;
5. enable the database write-fence and record row counts by status and old format;
6. run the transactional schema/data migration with the explicit migration bypass;
7. verify final database objects, storage-cleanup outbox, and zero old runnable jobs;
8. deploy the pinned new API, UI, and content-worker release in irreversible-cutover mode;
9. explicitly stop/remove `marketing-worker-1`, start `reel-worker-1` regardless of the old running-service name, and verify the other content workers;
10. disable maintenance only after deterministic health checks pass, then run the approved production canaries.

The provider snapshot is a disaster-recovery restore point for an incorrectly scoped but syntactically successful migration. It does not authorize restarting an old application binary after the new schema commits. If preserved-table counts/hashes disagree, maintenance remains enabled and the operator either restores the provider snapshot or rolls forward with a corrected migration.

Before any execution rows are deleted, the cutover exports the full available request, batch/proposal, V3 input, generation/job/output, error, idempotency, manifest, log-correlation, and release metadata for generation IDs `26998aec-b8c4-4abb-a1d8-a7204c1b6226` and `71565421-d205-4627-8ea5-84633ac879cb`. It also exports the observed proposal-batch `409`, `invalid_json_schema` incidents, and the running release SHA/image/migration evidence needed to compare today's intended commits with production. A missing record is recorded as `not_found`; it is not silently omitted. This checksummed evidence bundle lives outside the deletion graph and is retained with the final completion report.

### 11.2 Transactional cleanup

The migration clears the existing AI content proposal/generation execution graph so no frozen V1, legacy V2, `marketing`, or `marketing_content` record can enter retry, regeneration, or result adapters after the compatibility code is removed. It does not use `TRUNCATE ... CASCADE` or an unconstrained delete that could reach unrelated product, reference, brand, channel-output, or user data.

Before deletion, it creates transaction-local target-ID sets and a durable, checksummed `ai_content_storage_cleanup_outbox` outside the deleted graph. The outbox records cutover ID, storage path, object kind, source row, checksum when known, status, attempts, and completion timestamp. It is committed atomically with the graph deletion, so a crash after commit cannot lose the cleanup list.

`channel_outputs.ai_content_generation_output_id` is set to null for linked output rows. Channel publication history remains; only its link to the retired generation row is detached. Any manifest, render, image, or attachment path still reachable from preserved `channel_outputs.output_json`, `storage_artifacts`, publish queues/history, or reference-library rows is marked `retained_reference` and excluded from physical deletion. A published output fixture proves that its preview/download remains valid after cutover.

The migration temporarily drops only the immutable delete triggers that block dependency-ordered cleanup, then recreates the identical trigger definitions before commit. These include the V2 proposal-research, generation-input, output-research, approved-proposal-version, generation-brief, one-time-avatar receipt/revocation, and analyzed-subject snapshot immutability triggers. A missing or mismatched trigger definition aborts the migration.

The execution graph includes, where present:

- proposal research snapshots, proposal jobs, approved proposal versions, generation briefs, proposals, proposal batches, and proposal idempotency/audit rows;
- generation input and output research snapshots, prompt bindings, render jobs, generation jobs, outputs, references, attachments, upload sessions, usage ledger, generation idempotency rows, and generations;
- automated proposal-run and performance-audit tables introduced by the Proposal V2 writer migration.

Preflight separately detects generation-bound `ai_content_subject_analyses` referenced by preserved `product_service_versions.source_analysis_id`. `ON DELETE RESTRICT` is treated as preserved provenance, not an obstacle to bypass. If any exist, the cutover aborts with exact IDs; it does not null the product provenance or delete the dependent product version without a separately recorded user decision.

Deletion proceeds from immutable briefs/snapshots and proposal approvals through proposal batches, output snapshots/render state, avatar/analyzed-subject snapshots, and finally generations. Normal generation cascades may then remove outputs, jobs, attachments, upload sessions, references, usage rows, unreferenced subject-analysis rows, and reference-migration audits. Attachment deletion triggers remain active so storage cleanup jobs are enqueued.

Attachment deletion jobs are not deleted with the graph. Before graph deletion, existing jobs for target paths are reconciled: expired `deleting`, `failed`, or `dead_letter` rows are reset to a new pending attempt under an explicit cutover operation; already `deleted` rows are complete; active leases are drained or cause abort. The unique path constraint may not turn a trigger conflict into silent success. After commit, cleanup is incomplete until every unprotected attachment path is `deleted` and every manifest/render outbox row is `deleted` or explicitly `retained_reference`. Both processors are idempotent and safe to resume.

The implementation plan must derive and assert the complete list from database foreign keys and maintain an explicit catalog of non-FK logical links, including `ai_content_create_idempotency_records.resource_id` and attachment-deletion job identifiers. Post-migration assertions reject any replay that resolves to a deleted ID and any orphan logical reference. A missing dependent table or logical-link rule makes the migration fail and roll back; it must never be bypassed with a broad `CASCADE`. Migration-time removal of old usage-ledger rows counts as disposal of the old reservation state; it must not also insert reversals, which would double-return usage.

### 11.3 Final schema

The migration replaces active constraints and validation functions so that:

```text
ai_content_generation_jobs.output_format
  NOT NULL AND IN ('card_news', 'blog', 'reel')

ai_content_generations.output_format
  NOT NULL AND IN ('card_news', 'blog', 'reel')

ai_content_generations.purpose
  NOT NULL AND IN ('informational', 'marketing')

ai_content_proposal_batches.purpose
  NOT NULL AND IN ('informational', 'marketing')
```

`ai_content_generations.type` is dropped after execution-data cleanup, and active SQL/API/UI code may not reconstruct it as a stored alias. The misleading `content_family` columns on active proposal/generation tables are renamed to `purpose`; every active relational purpose column is `NOT NULL` with the exact two-purpose check. JSON validators, request fingerprints, seed/reference format filters, channel capabilities, indexes, and database helper functions use the same three-format union. Fresh databases may pass through historical migrations that introduced old values, but the newest migration always leaves the canonical final schema.

The migration ends with database assertions that deprecated generation/job format values, proposal/request formats, frozen input formats, plan versions, and manifest versions have zero runnable rows and that `pg_constraint` contains the exact final format/purpose checks and nullability. It also scans `pg_proc`, `pg_trigger`, `pg_views`, column defaults, index definitions/predicates, and RLS policies against an allowlisted historical-migration boundary; any active database object that can default, validate, route, expose, or claim a retired value fails the cutover. Reference-library metadata is not execution state and is not deleted merely because a historical item recorded an old format; active seed queries simply exclude unsupported formats.

## 12. Usage Reservation and Reversal

Generation allowance is reserved exactly once when a selected draft generation starts. The reservation, frozen V3 input, prompt binding, generation start-state transition, and first job share the same transaction and idempotency key. Selection itself does not reserve. The current completion-time charge is removed.

- a retry or request replay does not reserve again;
- a successful or partially successful generation keeps the reservation;
- a terminal failure that produces no successful output inserts one reversal exactly once;
- transient worker failure and queued retry do not reverse early;
- retry after a terminal reversal requires a client idempotency key, creates a new child generation operation with a new reservation identity, and never resurrects the reversed job row;
- database and concurrency tests prove that simultaneous failure paths cannot double-reverse.

One locked database routine is the only terminal usage-settlement path. Planner terminal failure, attempt exhaustion, lease exhaustion, render terminal failure, cancellation, and successful completion all call it after updating output state. The routine locks the generation/reservation, derives success from persisted outputs, and inserts at most one reversal referencing the exact reservation. A zero-success run is `failed`, not `partial_failed`; `partial_failed` requires at least one successful output.

The reversal copies the original reservation's `usage_date` and negates its exact quantity, even if failure occurs on a later day. A unique reservation-reference constraint makes double reversal impossible. The usage ledger remains append-only; reservation rows are never mutated. Limit checks and customer-visible remaining/used counts both use the same net `reservation + reversal` aggregate.

A transient retry of the same non-terminal operation retains its reservation and frozen input. A post-reversal retry endpoint requires `clientIdempotencyKey`; exact replay returns the same child generation, while changed input under the same key is a conflict. This distinction is covered under simultaneous retry/settlement tests.

## 13. Retry, Regeneration, and Failure Semantics

Retry and partial regeneration read the immutable `content-generation-input.v3` snapshot. They never reconstruct purpose from output format, worker identity, channel, or product presence.

| Failure | Behavior |
|---|---|
| unsupported or missing format | reject before persistence; no fallback |
| purpose/product mismatch | reject before proposal or generation job creation |
| planner returns wrong purpose/format/contract | terminal contract failure |
| invalid structured-output schema | preflight/build gate failure; do not deploy |
| transient planner or render failure | retry the same frozen job within attempt policy |
| terminal planner/render failure | fail output/generation and reverse reservation when no output succeeded |
| old marketing claim request | route absent; cannot claim work |
| old marketing container survives deploy | deployment verification fails and removes it before canary |
| same idempotency key, same request | return existing operation |
| same idempotency key, changed request | explicit conflict |

Error messages shown to users retain their selected Korean format and purpose. A reel failure may not be displayed as blog or generic marketing content.

## 14. UI Behavior

The creation screen keeps purpose and format as separate controls:

- purpose: information or marketing;
- format: card-news, blog, or reel.

Changing purpose preserves the selected format when the combination is valid. Changing format preserves purpose. Marketing purpose requires product selection; informational purpose clears and prohibits product selection.

The fourth `marketing_content` option is removed. The old direct-generation `?type=card_news|blog|marketing` wizard is replaced by V2 format prefill for `card_news|blog|reel`; `type=marketing` is not recognized. Product-library analysis navigation is preserved through an explicit analysis route rather than a legacy generation path.

Proposal cards, inbox, job list, retry UI, result page, preview, download, and publish UI use shared Korean labels derived from `outputFormat`. The generation DTO has no second `type` field, so no UI can use `generation.type = marketing` as a display proxy.

## 15. CI/CD and Deployment Contract

The release is a coordinated, non-backward-compatible content-generation cutover. Old API and worker binaries are below the rollback floor once the migration commits.

Required release changes include:

- build and publish `brand-pilot-reel-worker`;
- bump the release manifest to schema 3 with an explicit reel component and make schema 3 the only normal writer/reader format;
- include reel-worker in release impact, manifest assembly, incremental rebuild, image-key validation, CLI-only contract, local-environment checks, Compose, preflight, deploy, rollout, and operations docs;
- remove every active marketing-worker component and environment file;
- explicitly stop/remove the old Compose service so it cannot remain as an orphan;
- fail preflight if the new release references the old image key, lacks the reel image, or contains both services;
- deploy API, UI, and all changed content-worker images from one pinned release manifest;
- do not roll back to an API or worker that writes `marketing` after the final schema migration.

A one-time, read-only manifest conversion command accepts previous schema 1/2 solely to record the old component, stop/remove it, and produce the desired schema-3 state. It has no code path that starts a legacy image. The cutover runner starts reel-worker from the schema-3 desired set even though no same-named service was previously running; it does not derive this decision from `running_before`. After production cutover evidence is captured, the one-time legacy reader and retired-name exception are deleted in the cleanup commit.

Deployment scripts add an explicit irreversible AI-content cutover mode. The authoritative cutover marker is the new `schema_migrations` row inserted in the same database transaction as the destructive schema/data changes; there is no later external marker and therefore no post-commit/pre-marker crash gap. Every recovery handler queries the database marker before choosing a branch. Once present, handlers may keep maintenance enabled, stop new content workers, and roll forward only; they may not invoke the existing previous-worker recreation or previous-API transition-recovery branches. An injected-failure deployment test proves that old API and marketing-worker containers are not recreated and that the write fence remains enabled.

Rollback after migration means keep content generation in maintenance mode and roll forward to a corrected three-format release. It does not restart the old marketing worker. Provider-snapshot restore is reserved for data-corruption disaster recovery and restores the database and pinned pre-cutover release together under full downtime; it is not an automated rollout fallback.

## 16. Dead-Code and Reintroduction Guards

Production source uses deletion, not commented-out code. Comments are reserved for explaining a current invariant or migration boundary.

Repository contract tests reject active-runtime references to:

- `brand-pilot-marketing-worker`;
- `@brand-pilot/marketing-worker`;
- `MARKETING_WORKER_*` and `MARKETING_CODEX_*`;
- `marketing-worker-1` and the old release image key;
- `/worker/ai-content-jobs/card-news/claim`;
- `/worker/ai-content-jobs/marketing/claim`;
- `marketing-plan.v2`;
- `ai-content.v2` or a manifest `type` field in active Studio manifest code;
- `marketing_content` in active API, UI, worker, manifest, publish, or render code;
- V1 proposal construction in performance UI or automated card-news;
- direct proposal batch/job inserts from automated card-news;
- output-format fallback to blog or a catch-all worker;
- a persisted or DTO-level generation `type` alias alongside `outputFormat`;
- active proposal/generation `content_family` columns or DTO fields in place of `purpose`;
- legacy `single_image | channel_text` in active content-generation write contracts.

Historical SQL migrations, historical design documents, and Git history are excluded from string bans, but database-catalog tests prove the final schema rejects old values.

## 17. Harness and Test Scope

Only the API/UI and content-generation workers affected by this flow are tested. No unrelated worker process starts.

### 17.1 Static and type harness

- every active TypeScript consumer imports the canonical three-format/two-purpose parsers and descriptor map from `@brand-pilot/content-contracts`; no local union/set/mapping remains;
- generated JSON-schema and deployment contract artifacts match the canonical package source hash;
- claim routes accept only `card_news | blog | reel` and explicitly reject `card-news`, `marketing`, and `marketing_content`;
- no active deprecated identifier or first-party V1 writer;
- incremental CI maps every reel-worker path to the reel image;
- release manifest contains reel-worker and not marketing-worker.

### 17.2 Six-cell contract matrix

For each of the six format-purpose combinations, deterministic fixtures pass through:

```text
UI request
 -> orchestration parser
 -> frozen Proposal V2 input
 -> exactly three proposals
 -> proposal selection
 -> draft generation
 -> generation start
 -> frozen ContentGenerationInputV3
 -> format queue claim
 -> purpose prompt selector
 -> plan parser
 -> render/finalizer parser
 -> manifest parser
```

Every fixture asserts selected prompt included, opposite prompt excluded, exact worker queue, exact purpose/format preservation, product invariant, and absence of fallback.

### 17.3 Database harness

PGlite and direct PostgreSQL coverage includes:

- migration from the current schema with old-format rows and immutable triggers;
- atomic cleanup with no unrelated brand/product/reference loss;
- fresh provider-backup/cutover metadata requirement and preserved-table before/after hashes;
- maintenance fence returning 503 and blocking direct stale-process writes without mutations;
- final CHECK/nullability constraints accepting six valid combinations and rejecting old types, old purpose aliases, and null format/purpose;
- relational generation/job format and purpose must equal the frozen V3 JSON and immutable prompt binding;
- Studio constraint replacement leaves `channel_outputs.delivery_format` and Story/Reel render-job constraints unchanged;
- catalog scan of constraints, functions, triggers, views, defaults, index predicates, and RLS policies;
- preflight abort when a preserved product version references a generation-bound analysis;
- durable cleanup outbox survival across a simulated post-commit crash and idempotent resume;
- attachment cleanup reconciliation for pending, expired-deleting, failed, dead-letter, deleted, and path-conflict cases;
- published `channel_outputs`/`storage_artifacts` paths retained with working preview/download;
- FK and non-FK logical-reference orphan/replay assertions;
- proposal/generation/job idempotency and concurrent replay;
- start-transaction usage reservation, original-date/exact-quantity reversal, net customer usage, and exactly-once settlement from every terminal path;
- concurrent post-reversal retry with a required operation key and exactly one new reservation;
- retry and regeneration preserving frozen purpose and format;
- zero queued/processing jobs claimable by an old marketing consumer.

### 17.4 Worker harness

Use fake deterministic runners for content-proposal, card-news, blog, reel, and image-worker contracts. Do not start DM, Wiki, FAQ, profile, customer-support, brand-intelligence, or subject-analysis workers.

Worker tests verify:

- card-news, blog, and reel purpose selection;
- frozen prompt/model/schema binding agreement and rejection before model execution on any mismatch;
- exact `ai-content.v3` manifest parsing with `outputFormat` and no redundant `type` field;
- exact schema and repair behavior;
- reel-plan validation and MP4 finalizer handoff;
- image package and final manifest agreement;
- Studio finalizer rejects `marketing_content`, while existing `instagram_story` and `instagram_reel` claim/render/complete/regeneration fixtures still preserve their delivery format;
- terminal and transient failure classification;
- shutdown, heartbeat, and lease-loss behavior for renamed reel worker.

### 17.5 One schema-only Codex preflight

Preserve the previously approved cost boundary: exactly one model call against the production content-proposal-worker's exact Proposal V2 output schema. It creates no application rows, proposal batches, generation jobs, images, HTML, or video. Card-news, blog, and reel plan schemas are validated deterministically and then exercised by the already-authorized production canary; this design does not silently add three extra schema-only model calls.

### 17.6 Targeted UI harness

Mocked component/Playwright coverage verifies the six combinations, V2 prefill, product requirement, Korean summaries, result labels, retry display, removal of marketing content, split Studio/delivery capabilities, and preservation of current inputs after a recoverable error. Repository/API tests verify the explicit product-analysis route still reaches subject analysis without the marketing worker's legacy `analyze` branch; they do not start that worker.

Whole-workspace E2E and unrelated worker suites are excluded.

### 17.7 Additive Proposal V2 writer gates

The six-cell matrix does not replace the linked Proposal V2 writer migration gates. Sections 5 through 16 of that design remain additive except only where its top amendment explicitly supersedes a decision. The final implementation must therefore also satisfy the common-service readiness gate, performance-evidence ownership/cardinality and safe provenance, automated-run state and lock-order tests, terminal failure/attempt-exhaustion mirroring, exact `resumeInput`, scheduled-inbox discriminator, carousel-regeneration discriminated response with unchanged delivery Story/Reel behavior, exact V1-zero static/database evidence, UI/static harness, 20-repeat adapter/idempotency loops, concurrency harness, and performance/automated production canaries. Both test groups are required.

### 17.8 Prior-incident closure matrix

The migration may not erase the evidence for the failures that motivated it. Each row requires a concrete cause, linked code change, deterministic regression, and production evidence:

| Incident | Pre-delete evidence | Required regression | Production closure |
|---|---|---|---|
| proposal-batch unexpected `409` | request IDs, idempotency key, normalized payload/fingerprint, batch/job rows, response/log correlation | same key + same fingerprint under replay/concurrency returns the same batch; same key + changed fingerprint alone returns conflict | replay every canary start and both migrated writers with no unexpected conflict |
| reel selection displayed/failed as blog (`26998aec-b8c4-4abb-a1d8-a7204c1b6226`, `71565421-d205-4627-8ea5-84633ac879cb`) | original orchestration request, proposal, selected format, V3 input, generation/job format fields including retired columns, claimed worker, error code, manifest, release SHA | a reel input can reach only reel-worker; missing/unknown/mismatched format fails before persistence; Korean result label stays reel | informational and marketing reel canaries show reel queue, plan, manifest, label, and artifact |
| `invalid_json_schema` | exact submitted schema, command/model, repair attempt, error body, release image | generated schema validation plus exact parser tests; the approved one-call Proposal V2 preflight uses the production schema | no schema error in the six-cell run, migrated-writer canaries, or observation window |
| intended commit/image/migration missing or overwritten in CI/CD | today's intended commit inventory, deployed release SHA, image labels/digests, migration table, release manifest | release-impact tests rebuild every affected component; manifest provenance rejects mixed SHA or missing migration | running containers, API/UI headers, DB migration version, and digests all match one approved manifest |

An incident row is not closed with a generic explanation. If the original row/log is unavailable, the evidence bundle records that fact and the deterministic reproduction must demonstrate the old failure before the fix and pass after it.

### 17.9 Cutover deployment harness

Fixture releases cover manifest schema 1, 2, and 3. The one-time conversion test proves an old marketing service is detected and stopped, reel-worker is started even though it was absent from `running_before`, and the normal schema-3 parser never accepts a legacy component. Inject failures before migration, after migration SQL and the atomic `schema_migrations` insert commit but before deployment-runner state persistence, during API replacement, and during worker startup. When the database marker is absent, the normal safe rollback remains available; when it is present, every case keeps maintenance enabled and proves no old API or marketing worker is recreated.

## 18. Production Verification

The user authorized production deployment and testing because there are currently no customers. Production verification still uses a designated test brand and explicit operation IDs.

After the coordinated cutover:

1. verify the provider backup ID, cutover evidence checksum, database catalog, preserved-data hashes, and zero old runnable jobs;
2. verify the running API/UI SHA, image digests, and migration version all match the pinned manifest and today's approved commit inventory;
3. verify old marketing container/service is absent and reel-worker is healthy;
4. create one proposal batch for each of the six combinations;
5. require exactly three valid proposals in each batch;
6. select one proposal from each batch and start normal V3 generation;
7. require the exact format worker and image-worker only;
8. require every generation to reach a successful terminal state with the correct purpose, format, prompt binding, manifest, Korean label, and downloadable artifact;
9. replay each start request and confirm idempotent identity;
10. exercise one controlled permanent-failure fixture and verify exactly one original-date usage reversal, then retry with one operation key and verify exactly one new reservation;
11. run the linked performance-experiment and automated-card-news canaries, including reopen/inbox/selection behavior;
12. require all unprotected cleanup paths complete while a preserved published output still previews/downloads;
13. observe logs and queues for at least 30 minutes after the final run.

Any `invalid_json_schema`, format fallback, `409` on an exact replay, wrong worker claim, blog/reel label mismatch, stuck queue, duplicate reservation, missing reversal, or surviving marketing service fails the completion gate. After a fix, the affected deterministic suite and the full six-cell production canary restart.

## 19. Completion Evidence

The final report must include:

- migration ID, before/after row counts, and final catalog constraints;
- provider backup ID, cutover evidence checksum, and preserved-table hashes;
- static deprecated-reference scan;
- targeted test and harness commands with results;
- schema-only preflight evidence and model-call count;
- six proposal batch IDs and six generation IDs;
- queue/worker identity for each generation;
- final manifest purpose/format for each output;
- usage reservation/reversal evidence;
- storage cleanup outbox totals plus retained-reference proof;
- release manifest and container list proving reel-worker present and marketing-worker absent;
- intended-commit versus deployed-SHA/image/migration reconciliation;
- completed prior-incident closure matrix, including both requested generation IDs;
- relevant error counts during the observation window;
- confirmation that no unrelated worker was tested.

The feature is complete only when the system repeatedly generates the correct artifacts without the recurring schema, routing, idempotency, retry, or deployment failures that motivated this work.
