# Three-Format Database Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separately deployable content-write fence, then author and prove a forward-only migration that removes incompatible execution data, preserves business/publication data, and leaves the exact three-format/two-purpose database contract.

**Architecture:** Migration `074` is additive, defaults off, and is the only migration in the compatibility-fence release. Migration `075` performs the destructive graph cleanup and final schema change in one transaction; the existing migration runner writes its `schema_migrations` row before that same transaction commits, making `075_ai_content_three_format_cutover.sql` the authoritative rollback-floor marker. Durable cutover/evidence/cleanup state lives outside the deleted graph.

**Tech Stack:** PostgreSQL 16, PGlite, Node.js, `pg`, Vitest/Node test runner, Vercel Blob cleanup repositories.

**Safety:** Existing AI-content execution data may be deleted. Brand, approved product/service, product analysis/provenance, reference/source libraries, users, and published channel paths may not be deleted or silently detached except the explicit generation-output link described below.

---

## Task 1: Add the compatibility-safe maintenance write fence

**Files:**

- Create: `db/migrations/074_ai_content_maintenance_write_fence.sql`
- Create: `apps/api/src/aiContentMaintenance.ts`
- Create: `apps/api/src/aiContentMaintenance.test.ts`
- Modify: `apps/api/Dockerfile`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRepository.test.ts`
- Modify: `apps/api/src/aiContentDownload.ts`
- Modify: `apps/api/src/aiContentDownload.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.aiContentCustomer.test.ts`
- Modify: `apps/api/src/server.aiContentV2Customer.test.ts`
- Modify: `apps/api/src/automatedCardNews.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/runtimeConfig.ts`
- Modify: `scripts/migrations.integration.test.mjs`
- Modify: `scripts/migrationRunner.mjs`
- Modify: `scripts/migrationRunner.test.mjs`
- Modify: `scripts/migrate.mjs`
- Modify: `scripts/deployment-contract.test.mjs`

- [ ] **Step 1: Write RED migration/API tests**

Tests must prove default-off compatibility; HTTP `503 ai_content_maintenance` before mutation; the same guard as the first statement in the owning transaction; unchanged row counts for create, proposal-create, select, start, retry, regenerate, automated-run, attachment/render/finalization, download, and internal mutations; and direct stale-process writes blocked at the database root. A download request must fail before remote asset fetch or ZIP construction, and `runDailyGeneration()` must check maintenance before its first brand query even when invoked outside HTTP. Build the exact current AI-content execution-relation catalog from the Phase 2 deletion-graph enumerator, including shared topic/draft/output/publication/artifact/automation relations mutated by automated content. Every catalogued relation must have either the common whole-relation fence or an explicitly tested shared-table row classifier; classifiers inspect `NEW` for INSERT, `OLD` for DELETE, and both `OLD` and `NEW` for UPDATE, block every operation or reclassification on an in-scope row, and preserve unrelated rows. In particular the scheduled completion bridge's `storage_artifacts` and `publish_queue` writes and `automation_runs` rows with `run_type='daily_generation'` require explicit classifiers. An uncatalogued writable edge or classifier that permits a fresh or existing legacy automated row mutation fails `074`. Docker/release tests require the fence API image built from this commit to contain the migration runner plus migrations through exact `074_ai_content_maintenance_write_fence.sql`, and to fail if `075_ai_content_three_format_cutover.sql` is present.

The F runner must already support the signed two-stage `074` bootstrap protocol. Stage one validates the unused authorization file/image/migration/role-catalog hashes against canonical hashes recomputed from the live database, verifies `session_user` is the migration login, uses `SET LOCAL ROLE` only for the no-login schema owner, and applies exact `074` without executing `CREATE EVENT TRIGGER` or `ALTER EVENT TRIGGER`. Exactly one migration may be pending and it must be `074`; any earlier missing migration, existing/pending `075`, or extra pending file fails before mutation. It independently reads and seals a canonical post-`074` security catalog containing the exact fence/catalog/control function definitions, owners, `SECURITY DEFINER` state, fixed `search_path`, ordinary trigger relation/name/tgtype/function/ENABLE ALWAYS set, control-table owners/ACLs, and complete PUBLIC/app/operator/migration/cleanup function/table grant equality; calling the migration-owned verifier alone is insufficient. It emits and durably records a sealed provider-admin install request bound to the pre-`074` role/object hashes and this post-`074` security-catalog hash. Stage two consumes a one-shot attestation produced only by the serialized Supabase platform-`postgres` workflow: that workflow may create/enable exactly the one approved `074` DDL event trigger, pointing at the exact schema-owner-owned function, and must prove its name, event, tag filter, definition, function identity/hash, `postgres` ownership, enabled state, full before/after event-trigger catalog hashes, source authorization, and non-replay. The runner durably consumes the authorization/attestation, rejects any unapproved event-trigger catalog delta including a differently named wrapper-function trigger, independently recomputes the full live role/object/post-`074` security/event-trigger catalogs, and emits a sealed revocation request only when every hash and exact property still matches. Exact crash recovery may return the already sealed identical result without repeating a provider mutation only after performing the same fresh live recomputation; altered catalog/evidence or unconsumed replay fails. It must reject an arbitrary migration or provider DDL, direct owner/provider credentials, missing or altered provider evidence, stale/replayed authorization, any application membership in the schema-owner/operator/migration/cleanup roles, or any other role edge. Bootstrap state binds all five exact live roles; `prepare_ai_content_cutover` must accept only those sealed roles, so the application identity can never be substituted as the migration bypass identity. Task 3 extends this same runner with the prepared-row/token-bound `075` branch; it does not retrofit F later, and `075` is forbidden until the sealed event-trigger attestation verifies.

- [ ] **Step 2: Prove RED**

```powershell
node --test --test-name-pattern="074|maintenance write fence" scripts/migrations.integration.test.mjs
node --test --test-name-pattern="074|bootstrap role authorization" scripts/migrationRunner.test.mjs
npm test --workspace @brand-pilot/api -- src/aiContentMaintenance.test.ts src/aiContentRepository.test.ts src/aiContentDownload.test.ts src/server.aiContentCustomer.test.ts src/server.aiContentV2Customer.test.ts
node --test --test-name-pattern="fence API image contains 074 and excludes 075" scripts/deployment-contract.test.mjs
```

Expected: migration/table/functions and common guard are absent.

- [ ] **Step 3: Add durable cutover and maintenance state**

```sql
create table ai_content_cutovers (
  id uuid primary key,
  status text not null check (status in (
    'prepared','maintenance_verified','migration_body_complete',
    'backend_verified','completed','abandoned_pre_marker'
  )),
  migration_id text not null,
  schema_owner_role_name name not null,
  application_role_name name not null,
  operator_role_name name not null,
  migration_role_name name not null,
  cleanup_role_name name not null,
  bypass_token_sha256 text not null check (bypass_token_sha256 ~ '^[0-9a-f]{64}$'),
  cleanup_token_sha256 text not null check (cleanup_token_sha256 ~ '^[0-9a-f]{64}$'),
  database_role_catalog_sha256 text not null check (database_role_catalog_sha256 ~ '^[0-9a-f]{64}$'),
  provider_backup_id text not null,
  provider_snapshot_created_at timestamptz not null,
  incident_bundle_sha256 text not null check (incident_bundle_sha256 ~ '^[0-9a-f]{64}$'),
  preserved_data_manifest_sha256 text not null check (preserved_data_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  proposal_preflight_transfer_sha256 text not null check (proposal_preflight_transfer_sha256 ~ '^[0-9a-f]{64}$'),
  intended_release_sha text not null check (intended_release_sha ~ '^[0-9a-f]{40}$'),
  abandoned_reason text null,
  successor_cutover_id uuid null references ai_content_cutovers(id) on delete restrict deferrable initially deferred,
  cleanup_credential_revoked_at timestamptz null,
  cleanup_revocation_evidence_sha256 text null check (cleanup_revocation_evidence_sha256 is null or cleanup_revocation_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  latest_status_event_sha256 text not null check (latest_status_event_sha256 ~ '^[0-9a-f]{64}$'),
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint ai_content_cutover_abandonment_check check (
    (status = 'abandoned_pre_marker' and abandoned_reason is not null)
    or (status <> 'abandoned_pre_marker' and abandoned_reason is null and successor_cutover_id is null)
  ),
  constraint ai_content_cutover_cleanup_revocation_check check (
    (status = 'completed' and cleanup_credential_revoked_at is not null and cleanup_revocation_evidence_sha256 is not null)
    or (status <> 'completed' and cleanup_credential_revoked_at is null and cleanup_revocation_evidence_sha256 is null)
  ),
  constraint ai_content_cutover_roles_distinct_check check (
    schema_owner_role_name <> application_role_name
    and schema_owner_role_name <> operator_role_name
    and schema_owner_role_name <> migration_role_name
    and schema_owner_role_name <> cleanup_role_name
    and application_role_name <> operator_role_name
    and application_role_name <> migration_role_name
    and application_role_name <> cleanup_role_name
    and operator_role_name <> migration_role_name
    and operator_role_name <> cleanup_role_name
    and migration_role_name <> cleanup_role_name
  )
);

create unique index ai_content_cutovers_one_active_idx
on ai_content_cutovers ((true))
where status not in ('completed','abandoned_pre_marker');

create table ai_content_cutover_status_events (
  cutover_id uuid not null references ai_content_cutovers(id) on delete restrict,
  sequence_number integer not null check (sequence_number >= 0),
  from_status text null,
  to_status text not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  previous_event_sha256 text null check (previous_event_sha256 is null or previous_event_sha256 ~ '^[0-9a-f]{64}$'),
  event_sha256 text not null unique check (event_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (cutover_id, sequence_number)
);

create table ai_content_maintenance_state (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  cutover_id uuid null references ai_content_cutovers(id) on delete restrict,
  enabled_at timestamptz null,
  constraint ai_content_maintenance_state_pair_check check (
    (not enabled and cutover_id is null and enabled_at is null)
    or (enabled and cutover_id is not null and enabled_at is not null)
  )
);

insert into ai_content_maintenance_state (singleton, enabled, cutover_id, enabled_at)
values (true, false, null, null)
on conflict (singleton) do nothing;
```

Insert the prepared row together with sequence `0` status event (`from_status=null`, `to_status=prepared`) and set `latest_status_event_sha256` to that event hash. The prepared/event evidence binds the exact role catalog, all five distinct role names, and the separate migration/cleanup token digests. Add immutability triggers forbidding event UPDATE/DELETE. `transition_ai_content_cutover_status(...)` locks the row selected by exact immutable `cutover_id` plus its latest event, requires exact current status/evidence, appends the next hash-chained event, then updates only status/latest-event pointer/time and the narrowly allowed completion-time cleanup-revocation fields. It recomputes `event_sha256` from canonical fields and rejects a broken sequence/previous hash; retry with identical transition/evidence returns the same event, while different evidence conflicts. The partial unique index defines only whether another cutover may start; recovery always looks up the cutover ID sealed in host/release evidence. A referenced completed row is valid even though there are zero in-progress rows.

Add `assert_ai_content_writable()`, `ai_content_cutover_bypass_allowed()`, and `enforce_ai_content_write_fence()`. Split the generated catalog into `customer_execution` and `cutover_control`. Install an `ENABLE ALWAYS` `BEFORE INSERT OR UPDATE OR DELETE` fence on every `customer_execution` relation. That class includes generation/proposal/job/output/usage/research/render/attachment/subject-snapshot/idempotency state and every shared topic/draft/output relation the legacy automated path can mutate; shared-table coverage may be scoped only when fixtures prove both a fresh legacy automated write is rejected and an unrelated row remains allowed. Migration `075` attaches the same fence to every new customer-execution/audit relation in its creation transaction. Cutover status/event/catalog/storage-cleanup control relations are not writable through that general app path: they are owner-restricted and expose only the narrow transition functions described below. Final assertions require exact class/catalog/trigger/grant equality. Missing, disabled, ordinary-only, or extra unreviewed coverage aborts.

Make the database boundary role-safe. A no-login schema owner owns the state tables, catalog, ordinary row triggers, and `SECURITY DEFINER`/event-trigger functions with a fixed `search_path`; the sole ownership exception is the DDL event-trigger object itself, which Supabase requires the platform `postgres` role to create and own. The runtime application role must be a non-owner, non-superuser, non-`BYPASSRLS` role with no membership in the migration/operator/cleanup roles. Revoke application/PUBLIC DML on `ai_content_cutovers`, `ai_content_cutover_status_events`, `ai_content_maintenance_state`, the fence catalog, and cutover cleanup relations; grant the app only the minimum reads and `EXECUTE` on `assert_ai_content_writable()`. Grant transition/maintenance/bypass execution only to the dedicated operator/migration identities. `074` fails if the configured app role owns any fenced relation or can alter/disable its trigger, update maintenance/cutover state, invoke a transition/bypass function, or assume a privileged role. App-role integration fixtures attempt state tampering and direct SQL DML on every catalogued relation during maintenance; all fail with unchanged rows. The scoped `075` migration role plus exact transaction-local cutover/token is the sole general fence bypass and is separately proven to work.

DDL ownership is explicit: the migration login is `NOINHERIT` and normally has no effective owner privileges. It has revocable `SET ROLE` membership in the no-login schema owner. The restricted database operator cannot grant roles; only the serialized provider-admin role tool may activate/revoke that one exact membership from a signed migration request, and it cannot grant any other edge. Separately, its Supabase platform-`postgres` mode is a closed one-shot operation that can create, enable, verify, or marker-absent recover only the single named `074` event-trigger object with the preauthorized function/definition hash; it exposes no arbitrary SQL or general provider-admin action.

Migration `074` has a separate bootstrap authorization because no cutover row/maintenance token exists yet: exact `074` migration ID and source SHA-256, exact F API image digest/source label, marker absence, verified role-catalog/bootstrap attestation, exact event-trigger name/function/definition hash, and one unused signed request. The provider-admin tool grants membership; the runner verifies `session_user=migration_role`, uses `SET LOCAL ROLE schema_owner`, applies only exact `074`, and commits the schema-owner-owned tables/functions/catalog/ordinary triggers without any `CREATE EVENT TRIGGER` or `ALTER EVENT TRIGGER`. The runner emits a sealed install request only after those exact objects verify. The serialized provider-admin tool then authenticates as the Supabase platform `postgres` role, validates the same authorization/image/migration/role/object hashes, creates and enables exactly that one DDL event-trigger object pointing to the reviewed schema-owner-owned function, and seals canonical catalog evidence proving `owner=postgres`. The runner consumes that evidence, independently verifies the trigger read-only, and only then emits the membership-revocation request; the tool revokes membership and seals the completed one-shot request. Any other migration/body/image/function/trigger/DDL/provider action, missing evidence, or reused request fails. A marker-absent recovery may remove only a partially installed trigger matching the same authorization; it may not mutate any other object.

For `075`, the installed platform-`postgres`-owned DDL event trigger calls the schema-owner-owned function, which checks `session_user=migration_role`, `current_user=schema_owner`, maintenance/status, exact transaction-local cutover/token, migration ID, and the reviewed DDL object/command allowlist. Before accepting `075`, the runner requires the sealed non-replayed `074` provider attestation and independently verifies the exact trigger name, definition/function hash, `owner=postgres`, and enabled state. It executes body, final catalog/hash assertions, marker, and status event in the same transaction; any unexpected DDL/object/catalog delta aborts. Before activation, without token, after revoke, and after marker, migration-role DDL/trigger-disable attempts fail; neither the migration nor schema-owner role can alter/disable the platform-owned event trigger. Crash recovery first revokes stale membership or resumes only the same signed runner identity; it never leaves an owner-capable login available. After `075`, close/terminate migration sessions, remove URL/token files, revoke membership, and rotate/`NOLOGIN` the temporary migration login before customer runtime starts. PostgreSQL fixtures prove both branches, altered/out-of-window DDL denial, stale-membership recovery, and post-marker credential retirement.

Storage cleanup after the marker uses no general bypass. Create a distinct least-privilege `cutover_cleanup` login/credential that has no table DML and may execute only fixed-`search_path` `SECURITY DEFINER` functions for claim/lease/complete/fail transitions on the exact prepared cutover's cleanup-outbox/linked attachment rows. Those functions require maintenance on, marker present, the immutable cutover ID, status `migration_body_complete|backend_verified`, `processor_kind='cutover_storage_gc'`, the legal state-machine edge, and a transaction-local cleanup token whose digest is sealed in the cutover row. They cannot insert/delete arbitrary paths, touch customer-execution rows, transition the cutover, or invoke the migration bypass. Marker-present maintenance-on integration tests drain to terminal through this role while ordinary app DML remains fenced; wrong cutover/path/state/token/role has zero writes. After every API has drained its cleanup pool and unmounted all three secrets, the serialized provider-admin workflow revokes/rotates the cleanup login and proves zero sessions; `--open-writes` only verifies and consumes that sealed attestation while recording it in the completion transition. A completed row with a usable cleanup login is impossible.

The transition function checks the authoritative `schema_migrations` marker and permits only `prepared → maintenance_verified → migration_body_complete → backend_verified → completed`. `prepared|maintenance_verified → abandoned_pre_marker` is idempotent only when the marker is absent and requires reason plus optional successor; a marker-present path can never abandon. No backward/skip transition or evidence loss is accepted. For `075`, the runner order is exact: `BEGIN`/transaction-local cutover identity → execute the SQL body while status remains `maintenance_verified` → insert the `schema_migrations` marker → call the transition with the body-evidence hash to set `migration_body_complete` → `COMMIT`. Thus body, marker, status, and event all roll back together, while the marker-aware transition never runs before the marker exists. Post-schema/backend verification changes it to `backend_verified`; the final write-opening transaction changes it to `completed`. Tests inject failure after body, marker, transition-event insert, and pointer update and recover by DB marker plus full event chain, never by host files alone.

Bypass requires enabled maintenance, a distinct prepared migration role, the exact immutable cutover ID sealed by the signed authorization/host evidence in `maintenance_verified`, and a transaction-local token whose SHA-256 matches the stored digest. It never discovers an active/latest row. It authorizes the SQL body only; after marker insertion the runner performs the exact status transition before commit. A token without a distinct database identity is insufficient.

- [ ] **Step 4: Add the common application guard**

```ts
export async function assertAiContentWritable(
  queryable: Pick<Pool | PoolClient, "query">,
): Promise<void>;
```

Invoke it at the first request/service mutation line and again inside the owning transaction. Do not use `CONTENT_PROPOSALS_ENABLED` as maintenance state.

Extend the API Dockerfile at this fence commit to copy `db/migrations`, `scripts/migrationRunner.mjs`, `scripts/migrate.mjs`, and `scripts/databaseTls.mjs` into the immutable runtime image with the existing Node dependencies. Build the image from this exact commit and inspect it with a no-network container command that proves all three scripts/`074` exist and `075` does not. The production fence operation invokes `node /app/scripts/migrate.mjs` inside that digest with the protected migration-role URL; it never mounts a newer working tree or host migration directory.

- [ ] **Step 5: Run GREEN and create the independently deployable fence commit**

```powershell
node --test --test-name-pattern="074|maintenance write fence" scripts/migrations.integration.test.mjs
node --test --test-name-pattern="074|bootstrap role authorization" scripts/migrationRunner.test.mjs
npm test --workspace @brand-pilot/api -- src/aiContentMaintenance.test.ts src/aiContentRepository.test.ts src/aiContentDownload.test.ts src/server.aiContentCustomer.test.ts src/server.aiContentV2Customer.test.ts
node --test --test-name-pattern="fence API image contains 074 and excludes 075" scripts/deployment-contract.test.mjs
git add -- db/migrations/074_ai_content_maintenance_write_fence.sql apps/api/Dockerfile apps/api/src/aiContentMaintenance.ts apps/api/src/aiContentMaintenance.test.ts apps/api/src/aiContentRepository.ts apps/api/src/aiContentRepository.test.ts apps/api/src/aiContentDownload.ts apps/api/src/aiContentDownload.test.ts apps/api/src/httpServer.ts apps/api/src/server.aiContentCustomer.test.ts apps/api/src/server.aiContentV2Customer.test.ts apps/api/src/automatedCardNews.ts apps/api/src/repository.ts apps/api/src/repository.test.ts apps/api/src/runtimeConfig.ts scripts/migrations.integration.test.mjs scripts/migrationRunner.mjs scripts/migrationRunner.test.mjs scripts/migrate.mjs scripts/deployment-contract.test.mjs
git commit -m "feat(db): add AI content maintenance write fence"
```

Record this exact commit SHA. Phase 5 deploys this compatibility release before it ever makes migration `075` available to the production migrator.

## Task 2: Build checksummed incident and preserved-data evidence

**Files:**

- Create: `scripts/ai-content-cutover-evidence.mjs`
- Create: `scripts/ai-content-cutover-evidence.test.mjs`
- Create: `scripts/ai-content-database-catalog.mjs`
- Create: `scripts/ai-content-database-catalog.test.mjs`

- [ ] **Step 1: Write RED deterministic export tests**

Hard-code both required incident IDs:

```js
export const REQUIRED_INCIDENT_GENERATION_IDS = [
  "26998aec-b8c4-4abb-a1d8-a7204c1b6226",
  "71565421-d205-4627-8ea5-84633ac879cb",
];
```

Each record must include available request/orchestration, proposal batch/proposal/approval, V3 input, generation/jobs/outputs/render state, errors, idempotency, manifest, attachment paths, log correlation, release SHA/images, and migration version. Every missing section is emitted as `{ "status": "not_found" }`; it is never omitted.

- [ ] **Step 2: Prove RED**

```powershell
node --test scripts/ai-content-cutover-evidence.test.mjs scripts/ai-content-database-catalog.test.mjs
```

- [ ] **Step 3: Implement stable JSON, SHA-256, and preserved-table manifests**

The output directory is explicit, created mode-restricted by the operator, and outside the execution graph. Collect deterministic counts/hashes for brands, brand core/rules, users, products, product versions/assets, analyses, source/reference libraries, published channel output/history, and storage artifacts.

- [ ] **Step 4: Run GREEN and commit**

```powershell
node --test scripts/ai-content-cutover-evidence.test.mjs scripts/ai-content-database-catalog.test.mjs
git add scripts/ai-content-cutover-evidence.mjs scripts/ai-content-cutover-evidence.test.mjs scripts/ai-content-database-catalog.mjs scripts/ai-content-database-catalog.test.mjs
git commit -m "feat(db): add AI content cutover evidence tools"
```

## Task 3: Bind the cutover runner to the atomic migration marker

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/migrationRunner.mjs`
- Modify: `scripts/migrationRunner.test.mjs`
- Modify: `scripts/migrate.mjs`

- [ ] **Step 1: Write RED cutover-runner tests before creating `075`**

```ts
cutover?: {
  migrationId: "075_ai_content_three_format_cutover.sql";
  cutoverId: string;
  bypassToken: string;
  expectedDatabaseRole: string;
};
```

Verify the distinct role, set cutover ID/token transaction-locally, never log the token, execute the SQL body, insert the `schema_migrations` row, transition the locked cutover row from `maintenance_verified` to `migration_body_complete` with the body-evidence hash, then commit. Body, marker, and status must roll back together; failure injection covers every gap.

Add `@testcontainers/postgresql@12.0.4` to the root development dependencies. Every root-level PostgreSQL integration script in this phase must start its own `postgres:16-alpine` `PostgreSqlContainer`, wait for readiness, verify `160000 <= server_version_num < 170000` and `to_regclass('public.workspaces') IS NULL`, and stop it from `finally` after closing all clients/pools. Docker unavailable, a pre-existing application schema, startup failure, or teardown failure is a hard test failure; no script accepts or falls back to a persistent developer database URL.

- [ ] **Step 2: Prove RED**

```powershell
npm install
node --test scripts/migrationRunner.test.mjs
```

Expected: the runner does not yet bind the distinct role/token, marker insert, and cutover transition in one rollback-safe transaction.

- [ ] **Step 3: Implement the runner support, run GREEN, and commit it first**

```powershell
npm install
node --test scripts/migrationRunner.test.mjs
git add package.json package-lock.json scripts/migrationRunner.mjs scripts/migrationRunner.test.mjs scripts/migrate.mjs
git commit -m "feat(db): bind cutover token to atomic migration marker"
```

## Task 3B: Add final Proposal V2, prompt-binding, usage, and cleanup persistence

**Files:**

- Create: `db/migrations/075_ai_content_three_format_cutover.sql`
- Create: `scripts/ai-content-three-format-cutover.postgres.integration.test.mjs`
- Modify: `scripts/migrations.integration.test.mjs`

- [ ] **Step 1: Write RED schema tests before the migration body**

Require scope-consistent rows for `ai_content_proposal_performance_audits`, `automated_content_proposal_runs`, immutable `ai_content_proposal_job_contracts`, exclusive immutable `ai_content_proposal_compositions`, immutable research-stage headers/events, immutable model-invocation attempt headers, append-only `ai_content_proposal_attempt_events`, immutable `ai_content_generation_prompt_bindings`, retry lineage/operation idempotency, idempotent topic-upload identity, append-only cutover release adoptions, and `ai_content_storage_cleanup_outbox`. Automated run states are exactly `queued|ready|failed|selected|dismissed`, with state-dependent generation/error checks. Add immutability triggers and test that UPDATE/DELETE of proposal contracts, compositions, research/model attempt headers/events, prompt bindings, or release-adoption records fails outside the narrowly scoped owner functions.

- [ ] **Step 2: Prove RED**

```powershell
node --test --test-name-pattern="075|proposal audit|automated run|prompt binding|usage reservation|cleanup outbox|topic upload idempotency" scripts/migrations.integration.test.mjs
node --test scripts/ai-content-three-format-cutover.postgres.integration.test.mjs
```

- [ ] **Step 3: Add the durable tables at the start of `075`**

The outbox identity is unique by `(cutover_id, workspace_id, storage_path)` and has statuses `pending|deleting|failed|deleted|dead_letter|retained_reference`. Proposal performance audit data is internal-only. Automated runs carry caller-operation/fingerprint identity and caller-owned transaction linkage.

Each proposal job gets exactly one immutable contract row in the same transaction as enqueue. It stores job/batch/scope, all four declared boundary versions, proposal prompt version, Proposal V2 output-schema SHA-256, exact proposal model ID, sanitized command-descriptor SHA-256, request/base-input SHA-256 values, contract-source/catalog hashes, and a canonical enqueue-contract hash. It does not pretend the composed-input hash exists yet.

After controlled research is durably committed, the API—not the worker—uses the canonical deterministic composer and exclusive-inserts one `ai_content_proposal_compositions` row with job/contract identity, research-evidence row/hash set, composed-input canonical JSON/SHA-256, composed contract version, and final invocation aggregate hash. A prevalidated-performance command may insert this row in the enqueue transaction because its evidence is already frozen; manual/scheduled work must complete the research boundary first. Claim returns either `research_required` with immutable base contract or `composition_ready` with the exclusive sealed composition. No model invocation is allowed until `composition_ready`.

Research and model invocation are two different leased stages. A `research_required` claim creates only an immutable `ai_content_proposal_research_attempts` header and append-only research events; it cannot create a model-attempt row because composed-input/final aggregate hashes do not exist yet. Submitting frozen evidence, exclusive-inserting the composition, marking the research attempt terminal, returning the job to persisted `queued`, and releasing that lease are one transaction. `composition_ready` is a claim-DTO discriminator derived from that job's exclusive sealed composition, not a stored job status. The claim query treats queued-without-composition as research work and queued-with-composition as model work, so the same job cannot be reclaimed into the wrong stage. An expired/crashed research lease may be reclaimed with a new research-attempt number, but never consumes a model attempt, invocation ordinal, repair allowance, or model-call budget.

Only a `composition_ready` claim atomically creates one immutable model-attempt header keyed by `(job_id, attempt_number)` with worker/lease-token hash, aggregate contract/model/command/schema/composed hashes, and claim time. Model-attempt state is represented only by append-only hash-chained event rows with a monotonic event sequence plus `invocation_ordinal`. Ordinal `1` is the initial model call; ordinal `2` is the single allowed repair and may start only after ordinal 1 has a completed, parser-invalid output under the same contract/schema/model. Invocation events are exactly `invocation_started|invocation_completed|invocation_failed|invocation_indeterminate`; attempt-terminal events are exactly `attempt_succeeded|attempt_failed` and reference the final invocation/output/parser hash. No ordinal above 2 is valid and every started call has at most one terminal event. An `invocation_started` without a proven terminal result changes the whole job to non-claimable `manual_review_required`; it may not be reclaimed as a later automatic attempt and can never spend another call under that job/operation. Only a definitely pre-spawn failure recorded before `invocation_started` may requeue. Any user-authorized retry after manual review is a new caller operation/job/call budget, never a continuation. Every event stores previous/event SHA-256, time, command/model/schema/composed/contract hashes and applicable transcript/output/parser hashes. No event/header is updated or deleted.

Job completion/failure appends the attempt-terminal event in the same transaction as job/proposal state and rejects a missing start, invalid repair precondition, or mismatched lease/contract; exact replay returns the existing identical event, while different hashes/outcome conflict. The selected proposal records the successful model attempt plus final invocation ordinal. PostgreSQL tests cover research crash/reclaim before and after evidence submission, exclusive composition under concurrent research completion, proof that research-only claims consume zero model attempts/calls, two model terminal callbacks, concurrent composition-ready claim, lease expiry before spawn, stale token, initial+repair hash chain and cost count, forbidden third call, crash/lease expiry after `invocation_started` becoming non-claimable manual review with zero additional spawn, exact replay, altered model/schema/command/composed/output hash, and selection/start against a non-successful or mismatched attempt.

Extend `topic_uploads` with nullable `operation_key` and canonical request fingerprint plus a unique `(brand_id, operation_key)` predicate. When the canary supplies `Idempotency-Key: cutover-canary:<cutoverId>:<canaryAttemptId>:topics`, validate both immutable UUIDs, create the upload and ordered topic rows in one transaction, and return the upload plus the exact ordered valid topic-row UUIDs. Exact same-attempt replay locks and returns the same upload/UUIDs; a different fingerprint conflicts; a new attempt ID creates a distinct upload/three-row set; calls without a key preserve the ordinary UI contract. This is the durable boundary used by Phase 5's crash-safe three-topic bootstrap and full-rerun isolation.

Add append-only `ai_content_cutover_release_adoptions` keyed by exact `cutover_id` and monotonic sequence. A narrow begin function exclusive-inserts the in-progress row and reserves its sequence before any adoption-scoped UI attestation/promotion; its immutable request binds exact parent release, descendant source SHA, reviewed ancestry/provenance hash, reason, operator, and a caller UUID. It cannot change runtime/current/UI or start a second in-progress adoption. Manifest/UI/runtime/pointer evidence columns are nullable only in the initial `requested` state; append-only stage events seal them in order, and state-dependent CHECK/transition guards require the complete exact field set before leaving each stage or reaching `completed`. They can never be cleared or replaced. Each completed adoption binds parent/adopted release SHA and ancestry proof, immutable manifest/evidence hashes, API/content image digests, staged/current customer-UI deployment ID, catalog/migration hashes, `PREFLIGHT_CANDIDATE_SHA`, preflight transfer hash, control/current-pointer evidence, reason, previous/event hash, and operator identity/time. An exclusive in-progress adoption record plus append-only state events makes request/start/runtime/UI/pointer/complete crash-recoverable. A pre-rollout request that cannot produce valid final evidence becomes append-only `abandoned_before_rollout`; its sequence/evidence is never deleted or reused. Only a reviewed descendant with byte-identical proposal-worker digest/source/tree, Proposal V2 schema/catalog/model/command, and the original transfer may reuse the one preflight; drift blocks adoption pending explicit user approval for a different call policy. The original `intended_release_sha` remains immutable. Tests reserve/adopt during `migration_body_complete`, `backend_verified`, and after `completed`, recover each begin/attestation boundary and later crash boundary, reject a non-descendant/different UI or preflight dimension/sequence, and prove completed-cutover lookup by exact ID rather than the active partial index.

Prompt bindings store the exact canonical closed binding: binding version, output format, purpose, four Proposal V2 boundary versions, proposal prompt/schema hash, V3 version/schema hash, format-plan version/schema hash, planner/image prompt versions, image-package/manifest versions, contract source hash, and `gpt-5.6-terra`. The row is created from the generated catalog rather than free-form application strings, and start compares it to the selected proposal job contract plus successful attempt attestation rather than trusting the proposal row alone.

- [ ] **Step 4: Encode reservation/reversal/retry identity without double charging**

Evolve the existing `ai_content_usage_ledger` so one start reservation and at most one exact negative reversal can be identified and locked. Preserve the original `usage_date`. A post-reversal retry points to its parent operation but receives a new generation/reservation identity. Deleting old ledger rows in the cutover must not insert reversals.

The migration is valid at this checkpoint but still non-deployable: it creates only the final durable persistence needed by later API work, and Tasks 4 and 5 extend the same transaction with deletion-graph validation, cleanup, final renames/checks, and marker assertions. Run the focused fresh-PostgreSQL tests and commit this exact subset so no task leaves unrelated dirty files:

```powershell
node --test --test-name-pattern="075|proposal audit|automated run|prompt binding|usage reservation|cleanup outbox|topic upload idempotency" scripts/migrations.integration.test.mjs
node --test scripts/ai-content-three-format-cutover.postgres.integration.test.mjs
git add -- db/migrations/075_ai_content_three_format_cutover.sql scripts/ai-content-three-format-cutover.postgres.integration.test.mjs scripts/migrations.integration.test.mjs
git commit -m "feat(db): add three-format cutover persistence"
```

## Task 4: Catalog the complete deletion graph and protected storage paths

**Files:**

- Modify: `db/migrations/075_ai_content_three_format_cutover.sql`
- Modify: `scripts/ai-content-three-format-cutover.postgres.integration.test.mjs`
- Modify: `scripts/migrations.integration.test.mjs`

- [ ] **Step 1: Write RED FK/non-FK and provenance fixtures**

Build fixtures for every incoming FK under generation, output, proposal, approved proposal, subject analysis/image, and circular upload/attachment links. Add explicit non-FK fixtures for create idempotency, deletion-job IDs, `channel_outputs.ai_content_generation_output_id`, JSON IDs/paths, audit entity IDs, automated-run identity, and path-guard rows.

- [ ] **Step 2: Prove RED before modifying the migration graph**

```powershell
node --test --test-name-pattern="075|deletion graph|protected path|attachment reconciliation|provenance" scripts/migrations.integration.test.mjs
node --test scripts/ai-content-three-format-cutover.postgres.integration.test.mjs
```

Expected: the current migration does not yet satisfy the new graph, provenance, and protected-path fixtures.

- [ ] **Step 3: Require the migration to derive and compare the graph**

Materialize expected FK rows, compare to `pg_constraint`, and abort on missing or unexpected inbound edges. Never use `TRUNCATE ... CASCADE`. Before deletion, abort with exact IDs if preserved `product_service_versions.source_analysis_id` or `product_service_assets.source_image_id` reaches a generation-bound analysis/image.

- [ ] **Step 4: Protect public/reference storage**

Materialize attachment, manifest, render, plan, and artifact paths. Mark a path `retained_reference` when still reachable from preserved `channel_outputs.output_json`, `storage_artifacts`, publish request/response history, or active references. Abort on conflicting known checksums. Set only `channel_outputs.ai_content_generation_output_id = NULL`; preserve the publication/history/artifact rows and prove preview/download still works.

Choose exclusion, not semantic relabeling, for reference-library eligibility. Snapshot/hash fixtures containing `reference_items.format`, `metadata.outputFormat`, latest `reference_pattern_versions.pattern_json.outputFormat`, and performance-derived formats `single_image|channel_text|marketing_content`; migration `075` must preserve those historical values and rows byte-for-byte. Its final assertions prove no migration expression maps `channel_text` to `blog` or any retired value to `card_news`. Phase 3 changes the active Studio seed query to exact canonical-format eligibility, so these retained legacy records become ineligible without being rewritten.

- [ ] **Step 5: Reconcile attachment jobs without losing cleanup**

Active unexpired `deleting` leases abort. Expired `deleting`, `failed`, and `dead_letter` reset under the cutover operation; `pending` is reused; `deleted` maps to outbox `deleted`; cross-source path conflicts abort. Keep attachment deletion triggers active.

- [ ] **Step 6: Prove the catalog/protection GREEN and commit this exact slice**

```powershell
node --test --test-name-pattern="075|deletion graph|protected path|attachment reconciliation|provenance" scripts/migrations.integration.test.mjs
node --test scripts/ai-content-three-format-cutover.postgres.integration.test.mjs
git add -- db/migrations/075_ai_content_three_format_cutover.sql scripts/ai-content-three-format-cutover.postgres.integration.test.mjs scripts/migrations.integration.test.mjs
git commit -m "test(db): guard three-format cutover deletion graph"
```

## Task 5: Complete the destructive cleanup and exact final schema

**Files:**

- Modify: `db/migrations/075_ai_content_three_format_cutover.sql`
- Modify: `scripts/ai-content-three-format-cutover.postgres.integration.test.mjs`
- Modify: `scripts/migrations.integration.test.mjs`

- [ ] **Step 1: Write RED final cleanup/schema and immutable-trigger fixtures**

Add fixtures that compare relation, function, enabled state, timing/events, and `pg_get_triggerdef` for the eight proposal/V3/output/approval/brief/avatar/analyzed-subject immutability triggers named in the approved design. Missing or changed definitions abort. Add the exact final-column/check/index/constraint/catalog and zero-old-row expectations before changing the migration body.

- [ ] **Step 2: Prove RED**

```powershell
node --test --test-name-pattern="075|three-format|final schema|immutable trigger|zero old runnable" scripts/migrations.integration.test.mjs
node --test scripts/ai-content-three-format-cutover.postgres.integration.test.mjs
```

Expected: the checkpoint migration still lacks the destructive dependency order and exact final schema/catalog assertions.

- [ ] **Step 3: Validate triggers, then delete only the targeted execution graph in dependency order**

Validate the recorded trigger definitions before temporarily dropping them, then delete performance/run state and replay/audit links; research snapshots; briefs and approved proposals; avatar/analyzed-subject snapshots; proposal batches; generation input snapshots; then generations and normal cascades. Assert every target and replayable logical reference is gone. Preserve brand/product/reference/user/publication data and durable cleanup rows. Recreate byte-equivalent trigger behavior and recheck before commit.

- [ ] **Step 4: Replace the final relational schema**

```sql
alter table ai_content_generations drop column type;
alter table ai_content_generations rename column content_family to purpose;
alter table ai_content_proposal_batches rename column content_family to purpose;
alter table ai_content_generation_jobs rename column content_type to output_format;
```

Both `output_format` columns become `NOT NULL CHECK (output_format IN ('card_news','blog','reel'))`; relational purpose becomes `NOT NULL CHECK (purpose IN ('informational','marketing'))`. Rebuild the claim index on `(output_format, status, available_at, created_at)`. Replace `ai_content_proposal_jobs.status` with exact `queued|processing|completed|failed|manual_review_required`; the new terminal state requires cleared lease fields, `error_code='invocation_indeterminate'`, terminal time, immutable started-invocation evidence, and a failed/manual-review batch projection. It is excluded from every available/active claim index and claim query. Only a separately authorized new caller operation can create a new job; the old row never leaves this state. Replace active JSON validators/helpers with Proposal V2, V3 input, three plan V2, and manifest V3 rules. Add deferred constraint triggers that reject a generation/job whose relational `output_format` or `purpose` differs from its frozen V3 JSON or immutable prompt-binding row, while allowing the draft-before-start state in which neither V3 nor binding exists. Extend—not replace—the `worker_instances.worker_type` check with exact `content_proposal|card_news|blog|reel|ai_content_image` types while preserving existing non-content values. The content-proposal worker may no longer masquerade as `worker_type='dm'`; final catalog tests require one explicit type per content worker heartbeat.

- [ ] **Step 5: End with internal catalog assertions**

Assert no generation `type`, no active `content_family`/job `content_type`, exact nullability/checks, restored triggers, no orphan/replay references, preserved hashes, unchanged Story/Reel delivery constraints, and zero old runnable rows. Scan active Studio constraints, functions, triggers, views, defaults, index definitions/predicates, and RLS policies for retired values while explicitly allowing delivery/trend namespaces and historical migration text.

The PostgreSQL fixture must also prove the reference-library before/after hashes are unchanged, a legacy `channel_text` row is not changed to blog, a legacy `single_image|marketing_content` row is not changed to card-news/reel, and no retired-format reference becomes eligible through a database helper or view. Insert mismatch fixtures for generation↔V3, job↔generation/V3, and binding↔V3 format/purpose; each must fail at commit. Expire a lease after `invocation_started` and prove the job/batch becomes terminal manual review, every claim/index path returns zero, and no additional invocation event can start. Catalog assertions require the new equality and prompt-binding immutability triggers to exist with the expected definitions. Role fixtures exercise all ten pairwise role collisions and require each prepared-row insert to fail.

- [ ] **Step 6: Run PGlite and PostgreSQL 16 GREEN, then commit**

```powershell
node --test --test-name-pattern="074|075|three-format|cutover" scripts/migrations.integration.test.mjs
node --test scripts/ai-content-three-format-cutover.postgres.integration.test.mjs
git add -- db/migrations/075_ai_content_three_format_cutover.sql scripts/migrations.integration.test.mjs scripts/ai-content-three-format-cutover.postgres.integration.test.mjs
git commit -m "feat(db): add forward-only three-format cutover"
```

## Task 6: Make storage cleanup resumable after commit/crash

**Files:**

- Create: `apps/api/src/aiContentStorageCleanupOutboxRepository.ts`
- Create: `apps/api/src/aiContentStorageCleanupOutboxRepository.test.ts`
- Create: `apps/api/src/aiContentStorageCleanupOutbox.ts`
- Create: `apps/api/src/aiContentStorageCleanupOutbox.test.ts`
- Create: `apps/api/src/aiContentStorageCleanupDatabase.ts`
- Create: `apps/api/src/aiContentStorageCleanupDatabase.test.ts`
- Modify: `apps/api/src/aiContentAttachmentGcRepository.ts`
- Modify: `apps/api/src/aiContentAttachmentGcRepository.test.ts`
- Modify: `apps/api/src/aiContentAttachmentGc.postgres.integration.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/runtimeConfig.ts`
- Modify: `apps/api/src/runtimeConfig.test.ts`
- Modify: `apps/api/src/server.aiContentAttachmentGc.test.ts`
- Modify: `scripts/attachment-lifecycle.postgres.integration.test.mjs`

- [ ] **Step 1: Write RED claim/lease/retry/protection tests**

The new repository/runner claims only `processor_kind='cutover_storage_gc'`; attachment GC remains the owner of attachment jobs. Completion/failure mirrors linked outbox state. A retained path is protected directly from durable outbox state even after generation/output rows are gone. Add the exact cron-secret-protected `POST /internal/cron/ai-content-cutover-storage-gc` batch endpoint so the cutover script can drain this processor while customer content writes remain fenced. Its response exposes bounded aggregate counts and `done`; it never returns storage credentials or an invented cutover ID. The request supplies no cutover ID: the server uses the immutable prepared-state ID configured at rollout and cross-checks that exact DB row; it never discovers identity from the active partial index.

Create a separate short-lived cleanup `Pool` from `AI_CONTENT_CUTOVER_CLEANUP_DATABASE_URL_FILE`, `AI_CONTENT_CUTOVER_CLEANUP_TOKEN_FILE`, and immutable `AI_CONTENT_CUTOVER_ID_FILE`. Startup opens it only when maintenance/cutover configuration is present, verifies file ownership/mode, `current_user` equals the sealed cleanup role, and marker/status/cutover/token match, and refuses a URL equal to the main app URL. Only the cleanup endpoint/repository receives this pool; ordinary repositories and requests cannot access it. The pool invokes only the narrow security-definer cleanup functions, is drained/closed before `--open-writes`, and a completed/revoked cutover cannot recreate it. Unit/integration tests prove missing/wrong/equal URL, wrong role/token/cutover ID, non-maintenance startup, post-completion use, and accidental main-pool use fail with zero writes.

Refactor `attachment-lifecycle.postgres.integration.test.mjs` to own the same dedicated PostgreSQL 16 Testcontainer lifecycle as the new cutover test. Remove its `RUN_POSTGRES_INTEGRATION`/`POSTGRES_INTEGRATION_DATABASE_URL` skip and configuration path entirely. API Vitest PostgreSQL files continue to own their existing dedicated Testcontainers; do not point them at the Compose/developer database.

- [ ] **Step 2: Prove RED**

```powershell
npm test --workspace @brand-pilot/api -- src/aiContentStorageCleanupOutboxRepository.test.ts src/aiContentStorageCleanupOutbox.test.ts src/aiContentStorageCleanupDatabase.test.ts src/aiContentAttachmentGcRepository.test.ts src/runtimeConfig.test.ts src/server.aiContentAttachmentGc.test.ts
npm test --workspace @brand-pilot/api -- src/aiContentAttachmentGc.postgres.integration.test.ts
node --test scripts/attachment-lifecycle.postgres.integration.test.mjs
```

Expected: the cutover outbox repository/processor/endpoint and always-run PostgreSQL lifecycle do not yet exist.

- [ ] **Step 3: Implement idempotent processors and run GREEN**

```powershell
npm test --workspace @brand-pilot/api -- src/aiContentStorageCleanupOutboxRepository.test.ts src/aiContentStorageCleanupOutbox.test.ts src/aiContentStorageCleanupDatabase.test.ts src/aiContentAttachmentGcRepository.test.ts src/runtimeConfig.test.ts src/server.aiContentAttachmentGc.test.ts
npm test --workspace @brand-pilot/api -- src/aiContentAttachmentGc.postgres.integration.test.ts
node --test scripts/attachment-lifecycle.postgres.integration.test.mjs
git add apps/api/src/aiContentStorageCleanupOutboxRepository.ts apps/api/src/aiContentStorageCleanupOutboxRepository.test.ts apps/api/src/aiContentStorageCleanupOutbox.ts apps/api/src/aiContentStorageCleanupOutbox.test.ts apps/api/src/aiContentStorageCleanupDatabase.ts apps/api/src/aiContentStorageCleanupDatabase.test.ts apps/api/src/aiContentAttachmentGcRepository.ts apps/api/src/aiContentAttachmentGcRepository.test.ts apps/api/src/aiContentAttachmentGc.postgres.integration.test.ts apps/api/src/httpServer.ts apps/api/src/runtimeConfig.ts apps/api/src/runtimeConfig.test.ts apps/api/src/server.aiContentAttachmentGc.test.ts scripts/attachment-lifecycle.postgres.integration.test.mjs
git commit -m "feat(storage): make cutover cleanup resumable"
```

## Phase 2 verification

Run:

```powershell
node --test scripts/migrationRunner.test.mjs scripts/ai-content-cutover-evidence.test.mjs scripts/ai-content-database-catalog.test.mjs
node --test --test-name-pattern="074|075|three-format|cutover" scripts/migrations.integration.test.mjs
npm test --workspace @brand-pilot/api -- src/aiContentMaintenance.test.ts src/aiContentStorageCleanupOutboxRepository.test.ts src/aiContentStorageCleanupOutbox.test.ts src/aiContentAttachmentGcRepository.test.ts src/server.aiContentAttachmentGc.test.ts
npm test --workspace @brand-pilot/api -- src/aiContentAttachmentGc.postgres.integration.test.ts
node --test scripts/ai-content-three-format-cutover.postgres.integration.test.mjs
node --test scripts/attachment-lifecycle.postgres.integration.test.mjs
```

Expected: all targeted tests pass, simulated post-commit cleanup resumes, and the final catalog equals the Phase 1 generated catalog. Do not apply either migration to production in this phase.
