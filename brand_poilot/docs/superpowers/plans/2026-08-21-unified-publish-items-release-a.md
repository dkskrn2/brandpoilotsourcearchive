# Unified Publish Items Release A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the forward-compatible publish-calendar schema and API behavior required for same-time reservations without changing Release A customer behavior.

**Architecture:** Release A is an expand/compatibility release. Operating migration `084` remains unchanged; migration `085` adds durable idempotency and output-level uniqueness with transaction-local lock and statement timeouts. API A stops depending on the current brand/time and generation unique indexes, but customer manual/batch/settings validation continues to enforce the current 30-minute policy. The internal automatic path is already permissive so API A remains a safe rollback target after Release B creates duplicate/near settings and same-time rows.

**Tech Stack:** PostgreSQL, PGlite, Fastify, TypeScript, Vitest, Node test runner, Bash deployment gates

---

## File map

- `db/migrations/085_publish_calendar_idempotency_expand.sql`: additive idempotency column, CHECK constraint and unique indexes with transaction-local safety timeouts; no index drops or replacements.
- `scripts/migrationRunner.mjs`: preserve operating migration 084 and append migration 085 with its exact checksum.
- `scripts/deployment-contract.test.mjs`, `deploy/scripts/deploy.sh`: preserve operating 084 evidence and make 085 the new image/evidence gate.
- `apps/api/src/publishCalendarIdempotency.ts`: canonical manual, batch and automatic keys.
- `apps/api/src/publishCalendarRepository.ts`: durable replay, legacy no-key compatibility, source and quota identity.
- `apps/api/src/publishCalendarAllocator.ts`: deterministic occurrence keys and immutable existing automatic slots.
- `apps/api/src/types.ts`, `apps/api/src/httpServer.ts`: DTO and unchanged legacy request contract.
- Focused `publishCalendar*.test.ts`, PGlite and actual PostgreSQL application-role tests: behavioral proof.
- `docs/operations/DEVELOPMENT_AND_RELEASE_FLOW.md`: two-release operating boundary.

### Task 1: Add migration 085 as an additive schema expansion

**Files:**
- Create: `db/migrations/085_publish_calendar_idempotency_expand.sql`
- Create: `apps/api/src/publishCalendarMigration085.pglite.test.ts`
- Modify: `scripts/migrationRunner.mjs`
- Modify: `scripts/migrationRunner.test.mjs`

- [ ] **Step 1: Refresh and verify the implementation baseline**

```powershell
git fetch origin
git status --short
git merge-base --is-ancestor f9cf909a84a3ad43420450e35b8f3ded9bfb3fb9 origin/main
git diff --name-status f9cf909a84a3ad43420450e35b8f3ded9bfb3fb9..origin/main -- apps/api/src/publishCalendarRepository.ts apps/api/src/publishCalendarAllocator.ts apps/api/src/repository.ts apps/api/src/httpServer.ts db/migrations scripts/migrationRunner.mjs deploy/scripts/deploy.sh
```

Expected: clean worktree and no unreviewed relevant-source change. If the last command prints a relevant change, reread it and revise the design/plan before code.

- [ ] **Step 2: Write failing migration-order and schema tests**

Add this runner assertion after the existing 083 check:

```js
const migration085Index = ids.indexOf("085_publish_calendar_idempotency_expand.sql");
assert.equal(migration085Index, ids.indexOf("084_ai_content_usage_reversal_identity_invoker.sql") + 1);
assert.match(
  migrationRunner.post075SchemaMigrationChecksums["085_publish_calendar_idempotency_expand.sql"],
  /^[0-9a-f]{64}$/,
);
```

Create the PGlite test from the existing migration 079 fixture. Load 079 and 085, then assert the new column and indexes exist while the two old unique indexes remain:

```ts
expect(columns).toContain("idempotency_key");
expect(indexes).toEqual(expect.arrayContaining([
  "publish_calendar_slots_brand_idempotency_unique",
  "publish_calendar_slots_generation_output_unique",
  "publish_calendar_slots_active_brand_time_unique",
  "publish_calendar_slots_generation_unique",
]));
```

Also prove duplicate `(brand_id,idempotency_key)` and duplicate active `(brand_id,generation_output_id)` inserts reject.

- [ ] **Step 3: Run RED**

```powershell
node --test scripts/migrationRunner.test.mjs
npm test --workspace @brand-pilot/api -- src/publishCalendarMigration085.pglite.test.ts
```

Expected: missing migration 085 failures.

- [ ] **Step 4: Create the exact additive migration**

```sql
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table publish_calendar_slots
  add column idempotency_key text null;

alter table publish_calendar_slots
  add constraint publish_calendar_slots_idempotency_key_check
  check (
    idempotency_key is null
    or (char_length(idempotency_key) between 1 and 200 and idempotency_key = btrim(idempotency_key))
  );

create unique index publish_calendar_slots_brand_idempotency_unique
  on publish_calendar_slots(brand_id,idempotency_key)
  where idempotency_key is not null;

create unique index publish_calendar_slots_generation_output_unique
  on publish_calendar_slots(brand_id,generation_output_id)
  where generation_output_id is not null and status <> 'cancelled';

commit;
```

Do not drop or replace any index in 085.

- [ ] **Step 5: Compute and register the exact checksum**

```powershell
node -e "const{createHash}=require('node:crypto');const{readFileSync}=require('node:fs');const p='db/migrations/085_publish_calendar_idempotency_expand.sql';console.log(createHash('sha256').update(readFileSync(p)).digest('hex'))"
```

Append 085 after operating 084 in both migration arrays and add the printed checksum to `post075SchemaMigrationChecksums`. Preserve every earlier checksum.

- [ ] **Step 6: Run GREEN and commit**

```powershell
node --test scripts/migrationRunner.test.mjs
npm test --workspace @brand-pilot/api -- src/publishCalendarMigration085.pglite.test.ts
git add db/migrations/085_publish_calendar_idempotency_expand.sql apps/api/src/publishCalendarMigration085.pglite.test.ts scripts/migrationRunner.mjs scripts/migrationRunner.test.mjs
git commit -m "feat: expand publish calendar idempotency schema"
```

Expected: all focused tests exit 0.

### Task 2: Add canonical idempotency keys

**Files:**
- Create: `apps/api/src/publishCalendarIdempotency.ts`
- Create: `apps/api/src/publishCalendarIdempotency.test.ts`

- [ ] **Step 1: Write deterministic-key RED tests**

```ts
expect(manualSlotKey(" request-1 ")).toMatch(/^manual:v1:[0-9a-f]{64}$/);
expect(batchSlotKey("a:b", "c")).not.toBe(batchSlotKey("a", "b:c"));
expect(automaticSlotKey({ kstDate: "2026-08-21", time: "11:30", occurrence: 0 }))
  .not.toBe(automaticSlotKey({ kstDate: "2026-08-21", time: "11:30", occurrence: 1 }));
expect(normalizeCalendarChannels(["instagram", "instagram"])).toEqual(["instagram"]);
```

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- src/publishCalendarIdempotency.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the helper**

```ts
import { createHash } from "node:crypto";
import type { Channel } from "./types.js";

function digest(namespace: string, values: unknown[]) {
  const hash = createHash("sha256").update(JSON.stringify(values)).digest("hex");
  return `${namespace}:v1:${hash}`;
}

export function normalizeCalendarChannels(channels: Channel[]) {
  return [...new Set(channels)].sort();
}

export function manualSlotKey(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) throw new Error("publish_calendar_idempotency_key_invalid");
  return digest("manual", [normalized]);
}

export function batchSlotKey(batchKey: string, clientRowId: string) {
  return digest("batch", [batchKey.trim(), clientRowId.trim()]);
}

export function automaticSlotKey(input: { kstDate: string; time: string; occurrence: number }) {
  return digest("automatic", [input.kstDate, input.time, input.occurrence]);
}
```

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/publishCalendarIdempotency.test.ts
git add apps/api/src/publishCalendarIdempotency.ts apps/api/src/publishCalendarIdempotency.test.ts
git commit -m "feat: add publish calendar idempotency keys"
```

### Task 3: Persist keyed manual and batch replay before mutable policy checks

**Files:**
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/publishCalendarRepository.test.ts`
- Modify: `apps/api/src/publishCalendarProvisioning.pglite.test.ts`

- [ ] **Step 1: Write RED tests for replay order and equality**

Assert repository statement order:

```ts
expect(lockIndex).toBeLessThan(replayIndex);
expect(replayIndex).toBeLessThan(futureIndex);
expect(replayIndex).toBeLessThan(channelIndex);
expect(replayIndex).toBeLessThan(quotaIndex);
```

Add PGlite cases for replay after the scheduled time passes, after the channel is disabled and after quota becomes zero. Add one mismatch case for each of assignment mode, recommendation kind, normalized channels, format, timestamp, source kind and source ID.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- src/publishCalendarRepository.test.ts src/publishCalendarProvisioning.pglite.test.ts
```

Expected: current code evaluates time/channel/quota before replay or creates another row.

- [ ] **Step 3: Add idempotency metadata and keyed lookup**

Add to `PublishCalendarSlotDto` and `mapSlot`:

```ts
idempotencyKey: string | null;
// mapSlot
idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
```

Under the existing brand advisory lock, query by `(workspace_id,brand_id,idempotency_key)` before time, channel and quota checks. Compare:

```ts
{
  assignmentMode,
  recommendationKind,
  channels: normalizeCalendarChannels(channels),
  contentFormat,
  scheduledFor: scheduledFor.toISOString(),
  sourceKind,
  sourceId,
}
```

Return the stored row only when all fields match; otherwise throw `publish_calendar_idempotency_conflict` without mutation.

- [ ] **Step 4: Store namespaced keys**

Add `idempotency_key` to manual and automatic insert columns. Use `manualSlotKey(input.idempotencyKey)` for one manual request and `batchSlotKey(input.idempotencyKey,row.clientRowId)` for each batch row. Keep the existing single batch transaction.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/publishCalendarIdempotency.test.ts src/publishCalendarRepository.test.ts src/publishCalendarProvisioning.pglite.test.ts
git add apps/api/src/publishCalendarRepository.ts apps/api/src/types.ts apps/api/src/publishCalendarRepository.test.ts apps/api/src/publishCalendarProvisioning.pglite.test.ts
git commit -m "feat: persist publish calendar replay keys"
```

### Task 4: Make automatic allocation immutable and rollback-compatible

**Files:**
- Modify: `apps/api/src/publishCalendarAllocator.ts`
- Modify: `apps/api/src/publishCalendarAllocator.test.ts`
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/publishCalendarRepository.test.ts`

- [ ] **Step 1: Write occurrence and settings-change RED tests**

Cover duplicate settings `['11:30','11:30']`, format/channel changes and a simulated API B rollback whose first missing date is beyond the existing seven-day horizon. Assert deterministic keys are distinct, old rows are immutable and `brandsFailed` remains zero.

```ts
expect(created.map((slot) => slot.idempotencyKey).length)
  .toBe(new Set(created.map((slot) => slot.idempotencyKey)).size);
expect(existingSlotAfterReplay).toEqual(existingSlotBeforeReplay);
expect(result.brandsFailed).toBe(0);
```

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- src/publishCalendarAllocator.test.ts src/publishCalendarRepository.test.ts
```

Expected: the timestamp `Set` skips duplicate occurrences or spacing rejects the rollback horizon.

- [ ] **Step 3: Replace timestamp identity with occurrence identity**

For each day, create a new `occurrenceByTime` map before iterating the sorted settings times, then count same-time occurrences:

```ts
const occurrence = occurrenceByTime.get(value) ?? 0;
occurrenceByTime.set(value, occurrence + 1);
const idempotencyKey = automaticSlotKey({
  kstDate: kstDateKey(scheduledFor),
  time: value,
  occurrence,
});
```

If `listSlots` already contains that key, preserve the row without comparing current settings. For pre-085 rows with null keys, consume one matching timestamp as occurrence zero so the allocator does not duplicate them.

- [ ] **Step 4: Add an internal automatic spacing bypass only**

Pass the key to `createSlot`. Skip `assertSlotSpacing` and exact-time conflict only when `assignmentMode==='automatic'` and the key starts with `automatic:v1:`. Keep customer manual, batch and settings spacing validation unchanged in Release A.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/publishCalendarAllocator.test.ts src/publishCalendarRepository.test.ts
git add apps/api/src/publishCalendarAllocator.ts apps/api/src/publishCalendarAllocator.test.ts apps/api/src/publishCalendarRepository.ts apps/api/src/publishCalendarRepository.test.ts
git commit -m "feat: make calendar allocator rollback compatible"
```

### Task 5: Preserve legacy no-key semantics with multiple same-time rows

**Files:**
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/publishCalendarRepository.test.ts`
- Modify: `apps/api/src/publishCalendarProvisioning.pglite.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.test.ts`

- [ ] **Step 1: Write RED compatibility tests**

Keep the legacy HTTP body exact:

```ts
expect(Object.keys(capturedBody).sort()).toEqual(["channels", "contentFormat", "scheduledFor"]);
```

In PGlite, drop only the time unique index in the fixture, create two active rows at one timestamp and make the second row the matching legacy-open payload. Assert the no-key request returns the second row. Cancel it and assert the same request creates a new row.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- src/server.test.ts src/publishCalendarRepository.test.ts src/publishCalendarProvisioning.pglite.test.ts
```

Expected: current code compares only the first same-time row.

- [ ] **Step 3: Compare all exact rows canonically**

For no-key open-slot requests, select every active same-time row ordered by `id`. Match only a source-less row with `assignment_mode='manual'`, null recommendation, normalized channels, equal format and timestamp. Return the first matching row; throw `publish_calendar_slot_time_conflict` only when rows exist but none match. Leave `idempotency_key` null. Perform this replay scan before the Release A spacing query so B-created nearby rows do not hide an exact replay.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/server.test.ts src/publishCalendarRepository.test.ts src/publishCalendarProvisioning.pglite.test.ts
git add apps/api/src/publishCalendarRepository.ts apps/api/src/publishCalendarRepository.test.ts apps/api/src/publishCalendarProvisioning.pglite.test.ts apps/api/src/httpServer.ts apps/api/src/server.test.ts
git commit -m "fix: preserve legacy calendar replay semantics"
```

### Task 6: Prepare source-level uniqueness and canonical quota units

**Files:**
- Modify: `apps/api/src/publishCalendarRepository.ts`
- Modify: `apps/api/src/publishCalendarRepository.test.ts`
- Modify: `apps/api/src/publishCalendarProvisioning.pglite.test.ts`

- [ ] **Step 1: Write RED source and quota tests**

Prove: two completed outputs from one generation remain distinct candidates; the same output cannot own two active slots; a generation-level slot with no output blocks a competing output reservation; two null-group legacy content topics count as two units; two channel targets for one legacy content topic count as one unit; an AI output with a synthetic content topic still uses the output unit key.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/api -- src/publishCalendarRepository.test.ts src/publishCalendarProvisioning.pglite.test.ts
```

Expected: parent-generation OR matching blocks the second output and null groups collapse into one quota unit.

- [ ] **Step 3: Make duplicate lookup source-specific**

For `existing_generation`, match active generation rows only where `generation_output_id is null`. For `existing_output`, match its exact output ID or an active generation-level slot for the same parent where `generation_output_id is null`. Never match another completed output merely because it has the same parent.

- [ ] **Step 4: Use one canonical direct publication key**

Join `publish_queue` to `channel_outputs` and group direct usage by:

```sql
coalesce(
  'ai-output:' || output.ai_content_generation_output_id::text,
  'topic:' || output.content_topic_id::text,
  'group:' || queue.topic_publish_group_id::text,
  'channel-output:' || output.id::text,
  'queue:' || queue.id::text
) as publication_unit_key
```

Keep the current exclusion for non-cancelled calendar-linked groups.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/publishCalendarRepository.test.ts src/publishCalendarProvisioning.pglite.test.ts
git add apps/api/src/publishCalendarRepository.ts apps/api/src/publishCalendarRepository.test.ts apps/api/src/publishCalendarProvisioning.pglite.test.ts
git commit -m "fix: align publish source and quota identity"
```

### Task 7: Register deployment evidence and application-role verification

**Files:**
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `deploy/scripts/deploy.sh`
- Modify: `scripts/migrationRunner.mjs`
- Modify: `scripts/content-suggestion-schema-migration.test.mjs`
- Create: `apps/api/src/publishCalendarMigration085.postgres.integration.test.ts`
- Modify: `docs/operations/DEVELOPMENT_AND_RELEASE_FLOW.md`

- [ ] **Step 1: Write deployment RED tests**

```js
assert.match(deploy, /POST_075_SCHEMA_MIGRATION_ID="085_publish_calendar_idempotency_expand\.sql"/);
assert.doesNotMatch(deploy, /086_publish_calendar_same_time_contract/);
```

Require both operating 084 and new 085 in the image migration list, and preserve the operating 084 evidence fixture while verifying the new 085 checksum.
Require transaction-local `lock_timeout='5s'` and `statement_timeout='60s'`. Add a negative catalog test that rejects drift in the 085 nullable text column, exact CHECK expression, brand/idempotency unique index or generation-output unique index.

- [ ] **Step 2: Run RED**

```powershell
node --test scripts/deployment-contract.test.mjs
```

Expected: deploy evidence still names 083.

- [ ] **Step 3: Update the evidence gate**

Set `POST_075_SCHEMA_MIGRATION_ID` to 085 and `POST_075_SCHEMA_MIGRATION_SHA256` to the checksum computed in Task 1. Update all deployment fixtures and required migration lists while preserving 077-084 checks.
Extend `verifyPublishCalendarSchemaCatalog` so the normal runner verifies the exact 085 column, CHECK and both unique-index definitions before accepting the schema.

- [ ] **Step 4: Add actual PostgreSQL application-role verification**

The integration test creates a schema-owner and production-equivalent application role, applies the calendar base 079 then expansion 085 as owner, switches to the app role and executes slot INSERT plus keyed SELECT. It then asserts ALTER TABLE and DROP INDEX are denied. A skipped app-role test means Release A is not ready. Operating migration 084 is preserved and covered by its own migration contract.

- [ ] **Step 5: Document the release split**

Record that 085/API A and 086/API/UI B are separate PRs and promotions, 086 cannot be pending before A is fully promoted, no-key caller observation is mandatory, and API A is the B rollback image.

- [ ] **Step 6: Run GREEN and commit**

```powershell
node --test scripts/deployment-contract.test.mjs
node --test scripts/content-suggestion-schema-migration.test.mjs
npm test --workspace @brand-pilot/api -- src/publishCalendarMigration085.postgres.integration.test.ts
git add scripts/deployment-contract.test.mjs deploy/scripts/deploy.sh scripts/migrationRunner.mjs scripts/content-suggestion-schema-migration.test.mjs apps/api/src/publishCalendarMigration085.postgres.integration.test.ts docs/operations/DEVELOPMENT_AND_RELEASE_FLOW.md
git commit -m "chore: gate publish calendar release a"
```

### Task 8: Verify and stop at the Release A approval boundary

**Files:**
- No product files except direct fixes from the affected checks.

- [ ] **Step 1: Run affected verification only**

```powershell
npm test --workspace @brand-pilot/api -- src/publishCalendarIdempotency.test.ts src/publishCalendarMigration085.pglite.test.ts src/publishCalendarRepository.test.ts src/publishCalendarProvisioning.pglite.test.ts src/publishCalendarAllocator.test.ts src/server.test.ts
node --test scripts/migrationRunner.test.mjs scripts/content-suggestion-schema-migration.test.mjs scripts/deployment-contract.test.mjs scripts/repository-contract.test.mjs
npm run typecheck --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/api
git diff --check
```

Expected: all commands exit 0. Do not run DM, FAQ, crawl, wiki or unrelated worker tests.

- [ ] **Step 2: Run the real PostgreSQL application-role test without skip**

Use the project-approved PostgreSQL integration environment for `publishCalendarMigration085.postgres.integration.test.ts`. Expected: app-role DML passes and schema DDL is denied.

- [ ] **Step 3: Audit Release A impact**

Confirm the diff contains only migration/API/deployment/docs files. Customer UI, provider workers and unrelated workers must be absent. Query production read-only for null-group quota divergence and invalid duplicate/near settings; if applying the canonical quota key changes an active brand's allowance, stop for user approval rather than altering data.

- [ ] **Step 4: Review and commit only scoped corrections**

Run spec and quality review on the exact SHA. Fix only Release A P0/P1/P2 findings. Inspect `git status --short` and stage each actual corrected file by its exact name; never stage a directory. Then commit with:

```powershell
git commit -m "fix: close publish calendar release a review"
```

Skip the commit when no files changed.

- [ ] **Step 5: Stop before production mutation**

Report the exact Release A SHA, 085 checksum, affected test evidence, production impact query and rollback API digest requirement. Do not create 086, enable same-time customer behavior or deploy without separate authorization.
