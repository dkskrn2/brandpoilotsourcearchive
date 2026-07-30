# Brand-Scoped Compounding Wiki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace source-chunk-first DM retrieval with a brand-isolated, Codex CLI-compiled Wiki that always supplies core brand/catalog context, preserves verified source and destination URLs, and improves retrieval from recorded knowledge gaps.

**Architecture:** Keep immutable crawl snapshots and uploaded knowledge as truth. Compile source units into canonical, brand-scoped pages with page-level jobs, embed only compiled page chunks, verify a ready version against an offline legacy baseline, then replace the general-question retrieval path in one cutover. Keep exact FAQ as a permanent fast path. Run DM and Wiki maintenance as independent lanes in the existing DM worker process so long Wiki jobs do not block replies.

**Tech Stack:** TypeScript, Node.js, PostgreSQL/Supabase, pgvector, Fastify, React, Vitest, Node test runner, Codex CLI, OpenAI Embeddings API

---

## File Structure

New files:

- `db/migrations/032_compounding_wiki_core.sql`: tenant-scoped source units, canonical pages, build requests, compilation items, source links, quality logs and version metadata.
- `db/migrations/033_compounding_wiki_pgvector.sql`: page-chunk embeddings, compiled Wiki search functions and atomic activation.
- `workers/brand-pilot-dm-worker/src/compiledWikiTypes.ts`: strict source-unit, canonical-page, section and search packet contracts.
- `workers/brand-pilot-dm-worker/src/compiledWikiDb.ts`: claim, persist, activate, search and maintenance DB operations.
- `workers/brand-pilot-dm-worker/src/wikiCompiler.ts`: strict Codex output validation and canonical page compilation.
- `workers/brand-pilot-dm-worker/src/wikiCompiler.test.ts`: compiler contract tests.
- `workers/brand-pilot-dm-worker/src/wikiMaintenance.ts`: knowledge-gap lint and rebuild-request logic.
- `workers/brand-pilot-dm-worker/src/wikiMaintenance.test.ts`: maintenance trigger tests.
- `workers/brand-pilot-dm-worker/runtime/.agents/skills/wiki-compiler/SKILL.md`: source-grounded page compilation instructions.
- `workers/brand-pilot-dm-worker/runtime/.agents/skills/wiki-linter/SKILL.md`: search-gap analysis instructions.
- `scripts/compiled-wiki-smoke.mjs`: Growthline build, search and URL verification smoke test.

Modified files:

- `scripts/migrationRunner.test.mjs`, `scripts/migrations.integration.test.mjs`, `scripts/repository-contract.test.mjs`: migration and repository contracts.
- `apps/api/src/types.ts`, `apps/api/src/repository.ts`: Wiki status, refresh coalescing, result source ownership and deterministic URL appending.
- `apps/api/src/repository.dmWiki.test.ts`, `apps/api/src/repository.dmOperations.test.ts`: DM source and Wiki status tests.
- `workers/brand-pilot-dm-worker/src/knowledgeCurator.ts`, `wikiRefresh.ts`, `db.ts`: emit and store source units while preserving the exact FAQ fast path.
- `workers/brand-pilot-dm-worker/src/codexRunner.ts`, `codexRunner.test.ts`: role-specific Codex settings.
- `workers/brand-pilot-dm-worker/src/worker.ts`, `worker.test.ts`, `prompts.ts`: compiled search packet and destination URL ID output.
- `workers/brand-pilot-dm-worker/src/index.ts`: independent DM and Wiki lanes.
- `workers/brand-pilot-dm-worker/.env.example`, `README.md`: Wiki Codex settings and operations.
- `apps/customer-ui/src/types.ts`, `components/dm/DmKnowledgePanel.tsx`, `__tests__/dmAutomation.test.tsx`: compiled Wiki build stage and issue counts.

## Task 1: Add the Versioned Compiled Wiki Schema

**Files:**
- Create: `db/migrations/032_compounding_wiki_core.sql`
- Create: `db/migrations/033_compounding_wiki_pgvector.sql`
- Modify: `scripts/migrationRunner.test.mjs`
- Modify: `scripts/migrations.integration.test.mjs`

- [ ] **Step 1: Write failing migration contract tests**

Add assertions that migration 032 creates:

```js
assert.match(sql, /add column build_stage text/);
assert.match(sql, /create table wiki_build_requests/);
assert.match(sql, /create table wiki_source_units/);
assert.match(sql, /create table wiki_pages/);
assert.match(sql, /create table wiki_page_sources/);
assert.match(sql, /create table wiki_page_links/);
assert.match(sql, /create table wiki_page_chunks/);
assert.match(sql, /create table wiki_compilation_items/);
assert.match(sql, /create table wiki_retrieval_runs/);
assert.match(sql, /create table wiki_maintenance_runs/);
assert.match(sql, /create table wiki_issues/);
```

Add assertions that migration 033 is pgvector-gated and defines `search_brand_compiled_wiki` and `activate_compiled_wiki_version`.

- [ ] **Step 2: Run the migration contract tests and verify RED**

Run:

```powershell
node --test scripts/migrationRunner.test.mjs
```

Expected: FAIL because migrations 032 and 033 do not exist.

- [ ] **Step 3: Implement migration 032**

Use `wiki_versions` as the shared version owner:

```sql
alter table wiki_versions add column build_stage text null;
alter table wiki_versions drop constraint wiki_versions_status_check;
alter table wiki_versions add constraint wiki_versions_status_check
  check (status in ('building', 'ready', 'active', 'failed', 'superseded'));
```

Every new table must contain `workspace_id`, `brand_id`, appropriate composite ownership FKs, and indexes beginning with `brand_id` or `(workspace_id, brand_id)`. `wiki_pages` must enforce `unique(wiki_version_id, stable_key)`. `wiki_page_sources` must include `section_key`, `source_url`, `destination_url` and `source_quote`. `wiki_compilation_items` must enforce one item per `(wiki_version_id, item_type, stable_key)`.

- [ ] **Step 4: Implement migration 033**

Add `embedding vector(1536)` and an HNSW index to `wiki_page_chunks`. Define a search function with this contract:

```sql
search_brand_compiled_wiki(
  p_workspace_id uuid,
  p_brand_id uuid,
  p_wiki_version_id uuid,
  p_query_embedding vector(1536),
  p_query text,
  p_limit integer default 3
)
```

It must validate workspace, brand and version status (`ready|active`) and return page/chunk IDs, page type, title, content, source-link IDs, cosine similarity, keyword score and RRF score.

`activate_compiled_wiki_version` must lock the target and current active versions, validate completed compilation items, source-backed page sections and embedded chunks, supersede the previous active version and activate the target in one transaction.

- [ ] **Step 5: Run migration tests and verify GREEN**

Run:

```powershell
node --test scripts/migrationRunner.test.mjs
npm run test:migrations
```

Expected: all migration tests pass; pgvector migration is explicitly deferred by PGlite and covered by contract assertions.

- [ ] **Step 6: Commit Task 1**

```powershell
git add db/migrations/032_compounding_wiki_core.sql db/migrations/033_compounding_wiki_pgvector.sql scripts/migrationRunner.test.mjs scripts/migrations.integration.test.mjs
git commit -m "feat: add brand-scoped compiled wiki schema"
```

## Task 2: Add Source-Unit Curation Without Breaking Legacy Wiki

**Files:**
- Create: `workers/brand-pilot-dm-worker/src/compiledWikiTypes.ts`
- Create: `workers/brand-pilot-dm-worker/src/compiledWikiDb.ts`
- Modify: `workers/brand-pilot-dm-worker/src/knowledgeCurator.ts`
- Modify: `workers/brand-pilot-dm-worker/src/knowledgeCurator.test.ts`
- Modify: `workers/brand-pilot-dm-worker/src/wikiRefresh.ts`
- Modify: `workers/brand-pilot-dm-worker/src/wikiRefresh.test.ts`

- [ ] **Step 1: Write failing curator tests**

Cover these behaviors:

```ts
expect(unit.unitType).toBe("service");
expect(unit.sourceUrl).toBe("https://brand.example/product");
expect(unit.destinationUrl).toBe("https://brand.example/product/brand-pilot");
expect(() => validateCuratedKnowledge(modelOutputWithRawUrl, normalizedSource))
  .toThrow("curator_unit_shape_invalid");
```

The final assertion proves URLs are injected from DB source metadata after Codex validation and are never accepted as model-controlled fields.

- [ ] **Step 2: Run worker tests and verify RED**

```powershell
npm test --workspace @brand-pilot/dm-worker -- knowledgeCurator.test.ts wikiRefresh.test.ts
```

Expected: FAIL because `service` and source-unit persistence do not exist.

- [ ] **Step 3: Define strict compiled Wiki types**

Create contracts equivalent to:

```ts
export type WikiUnitType = "faq" | "product" | "service" | "policy" | "fact" | "guide_section";

export interface WikiSourceUnit {
  id: string;
  workspaceId: string;
  brandId: string;
  wikiVersionId: string;
  unitType: WikiUnitType;
  stableKey: string;
  title: string;
  content: string;
  sourceUrl: string | null;
  destinationUrl: string | null;
  sourceQuote: string;
  keywords: string[];
  aliases: string[];
  structuredData: Record<string, string | number | null>;
}
```

- [ ] **Step 4: Extend curation and persist source units**

Persist validated units to `wiki_source_units` and stop creating new legacy documents once the compiled build path is enabled. Derive `stable_key` deterministically from normalized unit type and title; resolve collisions by source-backed structured identifiers, not random suffixes.

Map product URLs from `structured_data.productUrl` when explicitly uploaded. For crawled pages, use the canonical owned URL as both `source_url` and fallback `destination_url`.

- [ ] **Step 5: Run tests and verify GREEN**

```powershell
npm test --workspace @brand-pilot/dm-worker -- knowledgeCurator.test.ts wikiRefresh.test.ts
```

- [ ] **Step 6: Commit Task 2**

```powershell
git add workers/brand-pilot-dm-worker/src/compiledWikiTypes.ts workers/brand-pilot-dm-worker/src/compiledWikiDb.ts workers/brand-pilot-dm-worker/src/knowledgeCurator.ts workers/brand-pilot-dm-worker/src/knowledgeCurator.test.ts workers/brand-pilot-dm-worker/src/wikiRefresh.ts workers/brand-pilot-dm-worker/src/wikiRefresh.test.ts
git commit -m "feat: curate source-backed wiki units"
```

## Task 3: Compile Canonical Pages with Codex CLI

**Files:**
- Create: `workers/brand-pilot-dm-worker/src/wikiCompiler.ts`
- Create: `workers/brand-pilot-dm-worker/src/wikiCompiler.test.ts`
- Create: `workers/brand-pilot-dm-worker/runtime/.agents/skills/wiki-compiler/SKILL.md`
- Modify: `workers/brand-pilot-dm-worker/src/compiledWikiDb.ts`

- [ ] **Step 1: Write failing compiler contract tests**

Test that:

- every section contains at least one existing source-unit ID;
- unknown source-unit IDs are rejected;
- model-supplied raw URLs are rejected;
- duplicate stable keys are rejected;
- `catalog` includes every enabled product and service stable key;
- one compilation call receives only one page group.

Use the desired output contract:

```ts
interface WikiCompilerOutput {
  pageType: "brand_overview" | "catalog" | "product" | "service" | "policy" | "faq" | "guide";
  stableKey: string;
  title: string;
  summary: string;
  sections: Array<{
    sectionKey: string;
    heading: string;
    body: string;
    sourceUnitIds: string[];
    destinationUrlId: string | null;
  }>;
  links: Array<{ targetStableKey: string; relation: string }>;
}
```

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @brand-pilot/dm-worker -- wikiCompiler.test.ts
```

- [ ] **Step 3: Add the `wiki-compiler` Skill**

The Skill must require Korean, source-only synthesis, section-level citations, no invented price/policy/URL, compact catalog entries and strict JSON output. It must explicitly say that existing Wiki text is organizational context only and never a fact source.

- [ ] **Step 4: Implement page-group creation and validation**

Group deterministically:

```text
brand_overview: fact + top-level guide units
catalog: all product and service units
product/service: one stable key per item
policy: one normalized policy category per page
faq/guide: one normalized topic per page
```

Call Codex once per group and validate every source ID before persistence. Generate Markdown in server code from validated sections.

- [ ] **Step 5: Add `brand_core` generation**

Generate `brand_core` without another LLM call by concatenating the active `brand_overview.summary` and compact catalog item summaries, capped at 3,000 characters with deterministic truncation at item boundaries.

- [ ] **Step 6: Run tests and verify GREEN**

```powershell
npm test --workspace @brand-pilot/dm-worker -- wikiCompiler.test.ts
```

- [ ] **Step 7: Commit Task 3**

```powershell
git add workers/brand-pilot-dm-worker/src/wikiCompiler.ts workers/brand-pilot-dm-worker/src/wikiCompiler.test.ts workers/brand-pilot-dm-worker/src/compiledWikiDb.ts workers/brand-pilot-dm-worker/runtime/.agents/skills/wiki-compiler/SKILL.md
git commit -m "feat: compile canonical brand wiki pages"
```

## Task 4: Embed, Validate and Activate Compiled Wiki Versions

**Files:**
- Modify: `workers/brand-pilot-dm-worker/src/compiledWikiDb.ts`
- Modify: `workers/brand-pilot-dm-worker/src/wikiCompiler.ts`
- Modify: `workers/brand-pilot-dm-worker/src/wikiCompiler.test.ts`
- Modify: `workers/brand-pilot-dm-worker/src/db.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Cover:

```text
collecting -> compiling -> embedding -> validating -> ready
expired processing item -> pending when attempts remain
exhausted item -> failed version
new source during build -> rebuild_requested
failed validation -> old active version unchanged
unchanged content hash -> embedding reused
```

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @brand-pilot/dm-worker -- wikiCompiler.test.ts db.test.ts
```

- [ ] **Step 3: Implement page-chunk embedding**

Keep a short product, service, catalog or policy page as one chunk. Split only guide pages over 800 characters with 120-character overlap. Reuse embeddings only when page content hash, embedding model, embedding version and compiler prompt version all match.

- [ ] **Step 4: Implement validation and ready transition**

Reject a version when:

- no brand overview or catalog exists;
- an enabled product/service stable key is absent from catalog;
- a section has no source mapping;
- a destination URL does not belong to the current brand's registered or uploaded allowlist;
- any page chunk lacks an embedding.

Successful validation sets `status=ready`, not `active`.

- [ ] **Step 5: Run tests and verify GREEN**

```powershell
npm test --workspace @brand-pilot/dm-worker -- wikiCompiler.test.ts db.test.ts
```

- [ ] **Step 6: Commit Task 4**

```powershell
git add workers/brand-pilot-dm-worker/src/compiledWikiDb.ts workers/brand-pilot-dm-worker/src/wikiCompiler.ts workers/brand-pilot-dm-worker/src/wikiCompiler.test.ts workers/brand-pilot-dm-worker/src/db.test.ts
git commit -m "feat: validate and stage compiled wiki versions"
```

## Task 5: Switch DM Retrieval to `brand_core + Top 3`

**Files:**
- Modify: `workers/brand-pilot-dm-worker/src/compiledWikiTypes.ts`
- Modify: `workers/brand-pilot-dm-worker/src/compiledWikiDb.ts`
- Modify: `workers/brand-pilot-dm-worker/src/db.ts`
- Modify: `workers/brand-pilot-dm-worker/src/worker.ts`
- Modify: `workers/brand-pilot-dm-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-dm-worker/src/prompts.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.dmWiki.test.ts`

- [ ] **Step 1: Write failing DM retrieval tests**

Verify:

- exact FAQ still bypasses embeddings and Codex;
- the compiled Wiki always sends `brandCore` even if vector results are weak;
- at most three detailed chunks are sent;
- Codex returns destination URL IDs, not URL strings;
- API rejects URL IDs from another brand or inactive version;
- API appends at most two verified URLs after the answer body.

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @brand-pilot/dm-worker -- worker.test.ts
npm test --workspace @brand-pilot/api -- repository.dmWiki.test.ts
```

- [ ] **Step 3: Add the compiled search packet**

Use this shape:

```ts
interface CompiledWikiSearchPacket {
  wikiVersionId: string;
  brandCore: string;
  chunks: CompiledWikiSearchChunk[];
  destinationUrls: Array<{ id: string; label: string; url: string }>;
}
```

Query exact FAQ first. Otherwise embed once, load `brand_core`, call compiled search with limit 3, then call Codex once.

- [ ] **Step 4: Change the DM output contract**

Add `wikiPageChunkIds` and `destinationUrlIds`. Do not allow the model to emit raw URLs. Update validation so every answer source and URL ID must exist in the provided packet.

- [ ] **Step 5: Append URLs deterministically in the API**

Validate IDs inside the same transaction that prepares the DM delivery. Append links as:

```text
{answer body}

{label}
{verified URL}
```

Preserve the existing delivery idempotency key and unknown-delivery behavior.

- [ ] **Step 6: Persist retrieval telemetry**

Insert one `wiki_retrieval_runs` row containing question, selected page/chunk IDs, scores, final route, reason code and latency. Do not block the DM reply if telemetry persistence fails; log the error after the authoritative delivery state is stored.

- [ ] **Step 7: Run tests and verify GREEN**

```powershell
npm test --workspace @brand-pilot/dm-worker -- worker.test.ts
npm test --workspace @brand-pilot/api -- repository.dmWiki.test.ts
```

- [ ] **Step 8: Commit Task 5**

```powershell
git add workers/brand-pilot-dm-worker/src/compiledWikiTypes.ts workers/brand-pilot-dm-worker/src/compiledWikiDb.ts workers/brand-pilot-dm-worker/src/db.ts workers/brand-pilot-dm-worker/src/worker.ts workers/brand-pilot-dm-worker/src/worker.test.ts workers/brand-pilot-dm-worker/src/prompts.ts apps/api/src/types.ts apps/api/src/repository.ts apps/api/src/repository.dmWiki.test.ts
git commit -m "feat: answer DMs from compiled brand wiki"
```

## Task 6: Coalesce Rebuilds and Add Automatic Maintenance

**Files:**
- Create: `workers/brand-pilot-dm-worker/src/wikiMaintenance.ts`
- Create: `workers/brand-pilot-dm-worker/src/wikiMaintenance.test.ts`
- Create: `workers/brand-pilot-dm-worker/runtime/.agents/skills/wiki-linter/SKILL.md`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.dmWiki.test.ts`
- Modify: `workers/brand-pilot-dm-worker/src/compiledWikiDb.ts`

- [ ] **Step 1: Write failing rebuild and maintenance tests**

Cover:

- many URL crawl completions create one brand build request;
- automatic changes wait for a two-minute quiet period;
- manual refresh bypasses quiet period;
- a change during a running build sets `rebuild_requested`;
- five new `knowledge_gap|low_confidence` results make a brand lint-eligible;
- the linter may add aliases/links or request missing-page regeneration but cannot add facts from DM text.

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @brand-pilot/dm-worker -- wikiMaintenance.test.ts
npm test --workspace @brand-pilot/api -- repository.dmWiki.test.ts
```

- [ ] **Step 3: Implement build-request coalescing**

Replace refresh job fan-out with one `wiki_build_requests` upsert per brand. Convert existing `wiki_refresh` entry points to this request path.

- [ ] **Step 4: Implement the `wiki-linter` path**

Pass only failed questions, selected-page metadata and current source units. Accept only:

```json
{
  "aliasUpdates": [{"stableKey":"string","aliases":["string"]}],
  "linkUpdates": [{"from":"string","to":"string","relation":"string"}],
  "regenerateStableKeys": ["string"],
  "missingKnowledge": [{"question":"string","reason":"string"}]
}
```

Validate every stable key against the current brand Wiki. Store true source gaps in `wiki_issues`; create a new Wiki version for valid alias/link/page changes.

- [ ] **Step 5: Run tests and verify GREEN**

```powershell
npm test --workspace @brand-pilot/dm-worker -- wikiMaintenance.test.ts
npm test --workspace @brand-pilot/api -- repository.dmWiki.test.ts
```

- [ ] **Step 6: Commit Task 6**

```powershell
git add workers/brand-pilot-dm-worker/src/wikiMaintenance.ts workers/brand-pilot-dm-worker/src/wikiMaintenance.test.ts workers/brand-pilot-dm-worker/runtime/.agents/skills/wiki-linter/SKILL.md workers/brand-pilot-dm-worker/src/compiledWikiDb.ts apps/api/src/repository.ts apps/api/src/repository.dmWiki.test.ts
git commit -m "feat: maintain brand wiki from retrieval gaps"
```

## Task 7: Separate DM and Wiki Execution Lanes

**Files:**
- Modify: `workers/brand-pilot-dm-worker/src/codexRunner.ts`
- Modify: `workers/brand-pilot-dm-worker/src/codexRunner.test.ts`
- Modify: `workers/brand-pilot-dm-worker/src/index.ts`
- Create: `workers/brand-pilot-dm-worker/src/index.test.ts`
- Modify: `workers/brand-pilot-dm-worker/.env.example`
- Modify: `README.md`

- [ ] **Step 1: Write failing runner and lane tests**

Verify role-specific model settings and these concurrency rules:

```text
DM CLI maximum: 1
Wiki CLI maximum: 1
process-wide CLI maximum: 2
Wiki does not claim another item while DM backlog exists
Wiki timeout does not stop DM polling
```

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @brand-pilot/dm-worker -- codexRunner.test.ts index.test.ts
```

- [ ] **Step 3: Make Codex settings explicit by role**

Use:

```ts
type CodexRole = "dm" | "wiki";
```

DM reads `DM_CODEX_*`; Wiki reads `WIKI_CODEX_*`. Keep `--ephemeral`, `--json`, `--sandbox read-only`, the dedicated runtime directory and `--ignore-user-config` for both.

- [ ] **Step 4: Run independent loops**

Start one DM loop and one maintenance loop in the same Node process. Use separate semaphores and an aggregate maximum of two child processes. Heartbeats and errors must be isolated per loop.

- [ ] **Step 5: Update env documentation**

Add:

```env
WIKI_CODEX_MODEL=gpt-5.4
WIKI_CODEX_REASONING_EFFORT=low
WIKI_CODEX_FAST_MODE=true
WIKI_CODEX_TIMEOUT_MS=120000
WIKI_MAINTENANCE_GAP_THRESHOLD=5
WIKI_MAINTENANCE_HOUR_KST=3
WIKI_BUILD_QUIET_PERIOD_MS=120000
```

- [ ] **Step 6: Run tests and verify GREEN**

```powershell
npm test --workspace @brand-pilot/dm-worker -- codexRunner.test.ts index.test.ts
```

- [ ] **Step 7: Commit Task 7**

```powershell
git add workers/brand-pilot-dm-worker/src/codexRunner.ts workers/brand-pilot-dm-worker/src/codexRunner.test.ts workers/brand-pilot-dm-worker/src/index.ts workers/brand-pilot-dm-worker/src/index.test.ts workers/brand-pilot-dm-worker/.env.example README.md
git commit -m "feat: separate DM and wiki Codex lanes"
```

## Task 8: Expose Wiki Build and Quality Status

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.dmOperations.test.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/components/dm/DmKnowledgePanel.tsx`
- Modify: `apps/customer-ui/src/__tests__/dmAutomation.test.tsx`

- [ ] **Step 1: Write failing API and UI tests**

Require the status response and panel to show:

- build stage when building;
- canonical page, source unit and page chunk counts;
- unresolved Wiki issue count;
- active version remains visible after a failed build.

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @brand-pilot/api -- repository.dmOperations.test.ts
npm test --workspace @brand-pilot/customer-ui -- dmAutomation.test.tsx
```

- [ ] **Step 3: Extend the status DTO and query**

Do not return page content or raw source text. Return counts and lifecycle metadata only.

- [ ] **Step 4: Update the existing knowledge panel**

Keep the current FAQ/product upload and `Wiki 다시 만들기` actions. Add compact status rows instead of a new page or nested card.

- [ ] **Step 5: Run tests and verify GREEN**

```powershell
npm test --workspace @brand-pilot/api -- repository.dmOperations.test.ts
npm test --workspace @brand-pilot/customer-ui -- dmAutomation.test.tsx
```

- [ ] **Step 6: Commit Task 8**

```powershell
git add apps/api/src/types.ts apps/api/src/repository.ts apps/api/src/repository.dmOperations.test.ts apps/customer-ui/src/types.ts apps/customer-ui/src/components/dm/DmKnowledgePanel.tsx apps/customer-ui/src/__tests__/dmAutomation.test.tsx
git commit -m "feat: show compiled wiki health"
```

## Task 9: Baseline-Test Growthline and Cut Over

**Files:**
- Create: `scripts/fixtures/dm-wiki-legacy-baseline.json`
- Create: `scripts/compiled-wiki-smoke.mjs`
- Modify: `package.json`
- Modify: `docs/operations/instagram-dm-operations-runbook.md`

- [ ] **Step 1: Capture the legacy baseline before replacing retrieval**

Save 20–30 representative real questions with the current selected chunks, answer, URLs, fallback result and latency in `scripts/fixtures/dm-wiki-legacy-baseline.json`. Include at least:

```text
여기는 무엇을 제공하나요?
어떤 서비스가 있나요?
어떤 제품이 있나요?
Brand Pilot은 어떤 서비스인가요?
가격은 얼마인가요?
결제는 어떻게 하나요?
환불할 수 있나요?
제품 페이지 링크를 알려주세요.
```

Do not run two engines in the live worker. The baseline file is the comparison contract and rollback evidence.

- [ ] **Step 2: Add the compiled Wiki smoke script**

The script must execute the same baseline questions against a specified ready Wiki version and print selected page titles, source URLs, destination URLs, fallback result and latency without sending Instagram DMs.

- [ ] **Step 3: Run build, tests and contracts**

```powershell
npm run build
npm test
npm run test:contract
npm run test:migrations
```

Expected: all pass.

- [ ] **Step 4: Build a Growthline compiled Wiki**

Start the API and DM worker, enqueue one manual Wiki refresh, wait until the compiled version is `ready`, then run:

```powershell
npm run smoke:compiled-wiki
```

Do not activate when any expected catalog/product page is absent, a URL is unverified, another brand's data appears, or unknown questions do not fallback.

- [ ] **Step 5: Activate Growthline atomically**

Call the repository activation path for the verified ready version. Confirm the previous version remains recoverable as `superseded` and the application general-question path uses only compiled Wiki search.

- [ ] **Step 6: Send one real DM test**

Ask `어떤 제품이 있나요?` and verify the response uses the catalog and includes only a registered product URL. Confirm one inbound message, one reply job and one delivery attempt.

- [ ] **Step 7: Update the runbook and commit**

Document build recovery, Git rollback, previous-version inspection, Codex authentication, environment variables and the smoke command.

```powershell
git add scripts/fixtures/dm-wiki-legacy-baseline.json scripts/compiled-wiki-smoke.mjs package.json docs/operations/instagram-dm-operations-runbook.md
git commit -m "test: verify Growthline compiled wiki cutover"
```

## Final Verification

- [ ] Run focused Wiki and DM suites:

```powershell
npm test --workspace @brand-pilot/dm-worker
npm test --workspace @brand-pilot/api -- repository.dmWiki.test.ts repository.dmOperations.test.ts
npm test --workspace @brand-pilot/customer-ui -- dmAutomation.test.tsx
```

- [ ] Run repository and migration contracts:

```powershell
npm run test:contract
npm run test:migrations
```

- [ ] Run workspace build:

```powershell
npm run build
```

- [ ] Confirm the final diff contains no `.env`, access token, Codex session or database credential files:

```powershell
git status --short
git diff --check
git diff --name-only HEAD~9..HEAD | Select-String -Pattern '(\.env$|token|credential|auth\.json)' -CaseSensitive:$false
```

- [ ] Request code review before pushing or deploying.
