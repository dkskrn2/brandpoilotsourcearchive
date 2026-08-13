# GPT Scheduled Content Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add daily category-scoped informational and trend content suggestions that a ChatGPT Scheduled task can publish through a narrow Brand Pilot MCP app, then show them on the dashboard and the existing V3 “오늘의 주제” flow.

**Architecture:** The production API hosts a stateless Streamable HTTP MCP endpoint with two tools: scope lookup and atomic batch publication. A dedicated repository owns validation-aware persistence and brand-scoped reads; the customer UI consumes a source-free/date-free DTO and feeds selected suggestions into the existing V3 proposal flow. This branch prepares code, tests, plugin instructions, and 15 schedule definitions only—no production deployment, database migration execution, ChatGPT app registration, or Scheduled task activation.

**Tech Stack:** TypeScript, Fastify 5, PostgreSQL, `@modelcontextprotocol/sdk`, Zod, React 18, React Router, Vitest, Testing Library, Vite.

---

## File map

- `db/migrations/077_content_suggestion_batches.sql`: batch/item tables, constraints, indexes, and update triggers.
- `apps/api/src/contentSuggestionContracts.ts`: strict tool inputs, public DTOs, and stable validation errors.
- `apps/api/src/contentSuggestionContracts.test.ts`: contract limits and unknown-field rejection.
- `apps/api/src/contentSuggestionRepository.ts`: scope lookup, atomic/idempotent publish, latest brand-scoped reads.
- `apps/api/src/contentSuggestionRepository.test.ts`: SQL boundary, ordering, privacy, and transaction behavior.
- `apps/api/src/contentSuggestionMcp.ts`: stateless MCP server with exactly two tools and accurate annotations.
- `apps/api/src/contentSuggestionMcp.test.ts`: MCP metadata, authentication, and tool result tests.
- `apps/api/src/contentSuggestionHttp.ts`: MCP transport plus authenticated/customer HTTP routes.
- `apps/api/src/httpServer.ts`: register the focused content suggestion routes.
- `apps/api/src/index.ts`: create the repository and pass the dedicated plugin token.
- `apps/api/src/server.test.ts`: route authentication, tenancy, hidden fields, and error mapping.
- `apps/api/package.json`, `package-lock.json`: MCP SDK and Zod runtime dependencies.
- `apps/customer-ui/src/features/content-suggestions/contentSuggestionGateway.ts`: customer API DTOs and fetch methods.
- `apps/customer-ui/src/features/content-suggestions/contentSuggestionGateway.test.ts`: URL and response contract tests.
- `apps/customer-ui/src/components/content-suggestions/ContentSuggestionCards.tsx`: reusable card list without date/source UI.
- `apps/customer-ui/src/components/content-suggestions/ContentSuggestionCards.test.tsx`: card/button rendering tests.
- `apps/customer-ui/src/components/ai-content/ContentSubjectStep.tsx`: enable the “오늘의 주제” mode.
- `apps/customer-ui/src/components/ai-content/ContentSubjectStep.test.tsx`: immediate personal cards, filters, and hidden metadata.
- `apps/customer-ui/src/components/ai-content/ContentProposalFlow.tsx`: load/select/deep-link suggestions into V3 inputs.
- `apps/customer-ui/src/components/ai-content/ContentProposalFlow.test.tsx`: selection and V3 regression tests.
- `apps/customer-ui/src/pages/AiContentWizardPage.tsx`: read `suggestionId` and `view=suggestions` query parameters.
- `apps/customer-ui/src/pages/DashboardPage.tsx`: load and show up to six suggestion cards.
- `apps/customer-ui/src/__tests__/dashboard.test.tsx`: max-six, navigation, empty, and metadata privacy tests.
- `apps/customer-ui/src/styles/content-wizard.css`, `apps/customer-ui/src/styles/dashboard.css`: current production visual treatment.
- `docs/operations/gpt-scheduled-content-suggestions.md`: MCP registration, permission, manual test, and rollback procedure.
- `docs/operations/gpt-scheduled-content-suggestion-tasks.json`: deterministic 15-task names, category codes, KST schedules, and prompts.

### Task 1: Lock the database contract

**Files:**
- Create: `db/migrations/077_content_suggestion_batches.sql`
- Modify: `scripts/migrations.integration.test.mjs`

- [ ] **Step 1: Add a failing migration assertion**

Add assertions that migration 076 creates both tables, the two uniqueness boundaries, the 1–28 batch count check, the two allowed intents, and the 1–2 position check:

```js
assert.match(sql076, /create table content_suggestion_batches/i);
assert.match(sql076, /unique \(category_id, generation_date\)/i);
assert.match(sql076, /item_count between 1 and 28/i);
assert.match(sql076, /create table content_suggestions/i);
assert.match(sql076, /intent in \('informational', 'trend'\)/i);
assert.match(sql076, /position between 1 and 2/i);
assert.match(sql076, /unique \(batch_id, subcategory_id, intent, position\)/i);
```

- [ ] **Step 2: Run the migration contract and verify RED**

Run: `node --test scripts/migrations.integration.test.mjs`

Expected: FAIL because `077_content_suggestion_batches.sql` does not exist.

- [ ] **Step 3: Create the migration**

Create UUID-keyed batch and suggestion tables with category/subcategory foreign keys, `sources_json jsonb`, explicit named checks, `updated_at` triggers using the existing `set_updated_at()` function, and indexes for latest category batch plus batch item ordering. Use `on delete cascade` only from items to batches; catalog deletion remains restricted by the foreign keys.

```sql
create table content_suggestion_batches (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references content_categories(id),
  generation_date date not null,
  timezone text not null default 'Asia/Seoul',
  run_key text not null unique,
  payload_hash text not null,
  item_count integer not null constraint content_suggestion_batches_item_count_check
    check (item_count between 1 and 28),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, generation_date)
);
```

- [ ] **Step 4: Run migration tests and verify GREEN**

Run: `node --test scripts/migrations.integration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/077_content_suggestion_batches.sql scripts/migrations.integration.test.mjs
git commit -m "feat(db): add content suggestion batches"
```

### Task 2: Implement strict content suggestion contracts

**Files:**
- Create: `apps/api/src/contentSuggestionContracts.ts`
- Create: `apps/api/src/contentSuggestionContracts.test.ts`

- [ ] **Step 1: Write failing contract tests**

Cover a valid batch and reject: unknown root/item/source fields, wrong contract version, non-KST date shape, empty items, more than 28 items, unknown intent, duplicate slot, position outside 1–2, title/why/brief overflow, 0 or 4 sources, and non-HTTP(S) URLs.

```ts
expect(() => parseContentSuggestionBatch({ ...validBatch, extra: true })).toThrow("content_suggestion_unknown_field");
expect(() => parseContentSuggestionBatch({ ...validBatch, items: [] })).toThrow("content_suggestion_items_required");
expect(() => parseContentSuggestionBatch(batchWithDuplicateSlot)).toThrow("content_suggestion_duplicate_slot");
expect(() => parseContentSuggestionBatch(batchWithFileUrl)).toThrow("content_suggestion_source_url_invalid");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test --workspace @brand-pilot/api -- src/contentSuggestionContracts.test.ts`

Expected: FAIL because the contract module does not exist.

- [ ] **Step 3: Implement exact parsers and DTO types**

Export `ContentSuggestionIntent`, `ContentSuggestionSource`, `ContentSuggestionBatchInput`, `ContentSuggestionScopeDto`, `ContentSuggestionItemDto`, `ContentSuggestionListDto`, `parseContentSuggestionCategoryCode`, and `parseContentSuggestionBatch`. Normalize whitespace but do not invent missing content, reject unknown fields via exact key sets, and preserve source `publishedAt: null`.

```ts
export type ContentSuggestionIntent = "informational" | "trend";
export const CONTENT_SUGGESTION_BATCH_VERSION = "content-suggestion-batch.v1" as const;
export const CONTENT_SUGGESTION_SCOPE_VERSION = "content-suggestion-scope.v1" as const;
export const CONTENT_SUGGESTION_PUBLISH_RESULT_VERSION = "content-suggestion-publish-result.v1" as const;
```

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm run test --workspace @brand-pilot/api -- src/contentSuggestionContracts.test.ts && npm run typecheck --workspace @brand-pilot/api`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/contentSuggestionContracts.ts apps/api/src/contentSuggestionContracts.test.ts
git commit -m "feat(api): validate content suggestion contracts"
```

### Task 3: Add atomic persistence and brand-scoped reads

**Files:**
- Create: `apps/api/src/contentSuggestionRepository.ts`
- Create: `apps/api/src/contentSuggestionRepository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Use a scripted `Pool`/`PoolClient` double to assert: active category scope with sorted active subcategories; unavailable category rejection; catalog mismatch before writes; `begin`/advisory lock/upsert/item upsert/delete-missing/commit order; rollback on any failure; same payload returns the existing batch ID; latest successful batch fallback; personal suggestions are selected system subcategories only and capped at six; general excludes personal IDs; single read hides a cross-category suggestion.

```ts
expect(await repository.getScope("travel_tourism", fixedNow)).toMatchObject({
  generationDate: "2026-08-09",
  intents: ["informational", "trend"],
  maxItemsPerSubcategoryIntent: 2,
});
expect(result.personal).toHaveLength(6);
expect(result.general.some((item) => personalIds.has(item.id))).toBe(false);
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test --workspace @brand-pilot/api -- src/contentSuggestionRepository.test.ts`

Expected: FAIL because the repository module does not exist.

- [ ] **Step 3: Implement repository interfaces and mapping**

Expose a focused repository, not general SQL access:

```ts
export interface ContentSuggestionRepository {
  getScope(categoryCode: string, now?: Date): Promise<ContentSuggestionScopeDto>;
  publish(input: ContentSuggestionBatchInput): Promise<ContentSuggestionPublishResultDto>;
  listForBrand(brandId: string): Promise<ContentSuggestionListDto>;
  getForBrand(brandId: string, suggestionId: string): Promise<ContentSuggestionItemDto | null>;
}
export function createContentSuggestionRepository(pool: Pool): ContentSuggestionRepository;
```

Canonicalize the parsed payload before SHA-256 hashing. Inside one transaction, validate active catalog membership, call `pg_advisory_xact_lock(hashtext(run_key))`, reuse an identical payload, upsert the batch, upsert stable slots, delete disappeared slots, then update the count/hash/published time. Customer queries join `brand_profiles`, active category/subcategory catalog, selected system subcategories, and the newest batch by `generation_date desc, published_at desc`; never select `sources_json` into public DTOs.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm run test --workspace @brand-pilot/api -- src/contentSuggestionRepository.test.ts && npm run typecheck --workspace @brand-pilot/api`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/contentSuggestionRepository.ts apps/api/src/contentSuggestionRepository.test.ts
git commit -m "feat(api): persist and query content suggestions"
```

### Task 4: Expose the two-tool MCP app and customer routes

**Files:**
- Create: `apps/api/src/contentSuggestionMcp.ts`
- Create: `apps/api/src/contentSuggestionMcp.test.ts`
- Create: `apps/api/src/contentSuggestionHttp.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add dependencies**

Run: `npm install --workspace @brand-pilot/api @modelcontextprotocol/sdk zod`

Expected: `package-lock.json` records both runtime dependencies.

- [ ] **Step 2: Write failing MCP and HTTP tests**

Assert the MCP list contains exactly `get_content_suggestion_scope` and `publish_content_suggestion_batch`; scope is read-only; publish is a non-destructive write; missing/wrong `CONTENT_SUGGESTION_PLUGIN_TOKEN` is 401; `CRON_SECRET` and `WORKER_API_TOKEN` are rejected; valid tool calls return structured content; customer list/single routes use the existing authenticated brand boundary; date/source fields are absent; a missing single item is 404.

```ts
expect(toolNames).toEqual(["get_content_suggestion_scope", "publish_content_suggestion_batch"]);
expect(scopeTool.annotations?.readOnlyHint).toBe(true);
expect(publishTool.annotations?.readOnlyHint).toBe(false);
expect(response.json()).not.toHaveProperty("generationDate");
expect(JSON.stringify(response.json())).not.toContain("sources");
```

- [ ] **Step 3: Run and verify RED**

Run: `npm run test --workspace @brand-pilot/api -- src/contentSuggestionMcp.test.ts src/server.test.ts`

Expected: FAIL because routes and MCP server do not exist.

- [ ] **Step 4: Implement MCP server factory**

Create a new `McpServer` per stateless request. Register only the two tools, use Zod schemas that mirror `contentSuggestionContracts.ts`, set `openWorldHint: false`, and return stable `structuredContent` plus a short Korean text result. The publish tool must call the same strict parser before the repository.

```ts
const server = new McpServer(
  { name: "brand-pilot-content-suggestions", version: "1.0.0" },
  { instructions: "항상 분야 스코프를 먼저 조회한 뒤 유효한 배치만 게시합니다. 게시 성공 응답 전에는 완료로 보고하지 않습니다." },
);
```

- [ ] **Step 5: Implement focused route registration**

Register `POST /plugins/content-suggestions/mcp` using stateless Streamable HTTP, constant-time bearer comparison, and a 256 KiB body limit. Register customer `GET /brands/:brandId/content-suggestions` and `GET /brands/:brandId/content-suggestions/:suggestionId` routes that rely on the existing global session/brand authorization pre-handler. Map stable content-suggestion validation errors to 400, plugin auth to 401, unavailable category to 404, and unexpected storage errors to 500 without echoing request data.

- [ ] **Step 6: Wire production composition without touching workers**

In `index.ts`, create one repository from the existing PostgreSQL pool and pass `process.env.CONTENT_SUGGESTION_PLUGIN_TOKEN`. Do not edit onboarding, brand-intelligence, FAQ, subject-analysis, or content-proposal worker code.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `npm run test --workspace @brand-pilot/api -- src/contentSuggestionMcp.test.ts src/server.test.ts && npm run typecheck --workspace @brand-pilot/api`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/contentSuggestionMcp.ts apps/api/src/contentSuggestionMcp.test.ts apps/api/src/contentSuggestionHttp.ts apps/api/src/httpServer.ts apps/api/src/index.ts apps/api/src/server.test.ts apps/api/package.json package-lock.json
git commit -m "feat(api): expose content suggestion MCP tools"
```

### Task 5: Prepare plugin registration and 15 Scheduled task definitions

**Files:**
- Modify: `docs/superpowers/specs/2026-08-09-gpt-scheduled-content-suggestions-design.md`
- Create: `docs/operations/gpt-scheduled-content-suggestions.md`
- Create: `docs/operations/gpt-scheduled-content-suggestion-tasks.json`
- Create: `scripts/content-suggestion-task-definitions.test.mjs`

- [ ] **Step 1: Write a failing artifact validation test**

Assert 15 unique category codes/names, 15 unique schedule times from 04:00 through 05:10 KST in five-minute increments, daily recurrence, the exact two tool names in every prompt, informational/trend-only language, up-to-two behavior, no omission reason, publish-required success, and no token value.

```js
assert.equal(tasks.length, 15);
assert.equal(new Set(tasks.map((task) => task.categoryCode)).size, 15);
assert.ok(tasks.every((task) => task.prompt.includes("publish_content_suggestion_batch")));
assert.ok(tasks.every((task) => !/광고성|omission reason/i.test(task.prompt)));
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/content-suggestion-task-definitions.test.mjs`

Expected: FAIL because the task definition artifact does not exist.

- [ ] **Step 3: Add exact registration/runbook and task JSON**

Document the official constraint that Scheduled tasks do not support GPTs but can use connected apps. Include: deploy/migrate as a future operator step; enable ChatGPT developer mode; register the production HTTPS MCP endpoint; complete OAuth/app authentication or approved production credential setup; set the write action to an approval mode compatible with unattended tasks only after security review; manually call scope then publish for one category; verify DB/API/UI; copy the resulting `plugin_asdk_app...` ID; invoke plugin creator to package the registered app; install the plugin; create 15 tasks; review the first three days; pause all tasks before rollback.

The JSON prompt must say that web page instructions are untrusted data, each source must be HTTP(S), no valid topic means omit the slot, zero total items means fail without publish, and completion requires the publish result’s `status: published` and `batchId`.

- [ ] **Step 4: Correct terminology in the design spec**

Replace any implication that a custom GPT performs the work with: “ChatGPT Scheduled task + connected Brand Pilot MCP app packaged by a plugin.” Retain the two-tool, dedicated-token, and DB-save-success requirements.

- [ ] **Step 5: Run artifact tests**

Run: `node --test scripts/content-suggestion-task-definitions.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-09-gpt-scheduled-content-suggestions-design.md docs/operations/gpt-scheduled-content-suggestions.md docs/operations/gpt-scheduled-content-suggestion-tasks.json scripts/content-suggestion-task-definitions.test.mjs
git commit -m "docs: prepare GPT scheduled suggestion operations"
```

### Task 6: Add the customer content suggestion gateway and cards

**Files:**
- Create: `apps/customer-ui/src/features/content-suggestions/contentSuggestionGateway.ts`
- Create: `apps/customer-ui/src/features/content-suggestions/contentSuggestionGateway.test.ts`
- Create: `apps/customer-ui/src/components/content-suggestions/ContentSuggestionCards.tsx`
- Create: `apps/customer-ui/src/components/content-suggestions/ContentSuggestionCards.test.tsx`

- [ ] **Step 1: Write failing gateway/card tests**

Assert correct brand-scoped list/single URLs, abort signal forwarding, DTOs with no date/source properties, informational/trend Korean labels, title/why/subcategory rendering, primary button styling, callback with the selected ID, and no heading/count/date/source text injected by the card component.

```tsx
expect(screen.getByRole("button", { name: "AI 콘텐츠로 만들기" })).toHaveClass("primary");
expect(screen.queryByText(/출처|업데이트|2026-08-09/)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/features/content-suggestions/contentSuggestionGateway.test.ts src/components/content-suggestions/ContentSuggestionCards.test.tsx`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the gateway and reusable cards**

Export `ContentSuggestion`, `ContentSuggestionList`, `ContentSuggestionGateway`, and `contentSuggestionGateway`. Implement cards as semantic articles with an intent badge, subcategory, title, why-now copy, and configurable button label/callback. Keep list headings outside this reusable component.

- [ ] **Step 4: Run focused tests and build typecheck**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/features/content-suggestions/contentSuggestionGateway.test.ts src/components/content-suggestions/ContentSuggestionCards.test.tsx && npm run build --workspace @brand-pilot/customer-ui`

Expected: PASS with only the existing large-chunk warning.

- [ ] **Step 5: Commit**

```bash
git add apps/customer-ui/src/features/content-suggestions apps/customer-ui/src/components/content-suggestions
git commit -m "feat(ui): add content suggestion gateway and cards"
```

### Task 7: Enable “오늘의 주제” in the current V3 new-content flow

**Files:**
- Modify: `apps/customer-ui/src/components/ai-content/ContentSubjectStep.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentSubjectStep.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalFlow.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalFlow.test.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentWizardPage.tsx`
- Modify: `apps/customer-ui/src/features/ai-content/types.ts`
- Modify: `apps/customer-ui/src/styles/content-wizard.css`

- [ ] **Step 1: Write failing UI flow tests**

Cover: enabled “오늘의 주제” tab; immediate personal cards without “내 세부분야 추천” or “6개”; no date/source; general section with intent and subcategory filters; loading/error/retry/empty states that preserve direct input; selecting a card sets topic title and content brief, forces informational purpose, completes source validity; `suggestionId` fetch initializes the same values; `view=suggestions` opens the tab; direct/URL/reference and card-news/blog/reel tests remain green.

```tsx
await user.click(screen.getByRole("button", { name: "오늘의 주제" }));
expect(await screen.findByText("장마철에도 실패 없는 서울 실내 여행 코스")).toBeVisible();
expect(screen.queryByText("내 세부분야 추천")).not.toBeInTheDocument();
expect(screen.queryByText("6개")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/components/ai-content/ContentSubjectStep.test.tsx src/components/ai-content/ContentProposalFlow.test.tsx --maxWorkers=1`

Expected: FAIL because `suggestion` is not a valid mode and the tab is disabled.

- [ ] **Step 3: Implement suggestion state and rendering**

Extend `ContentSubjectMode` with `"suggestion"`. Pass suggestion data/loading/error/retry/filter/select props into `ContentSubjectStep`; show personal cards immediately, then a `분야 전체 추천` section. Personal IDs must be removed from general cards. A selected suggestion makes material valid and updates topic/instruction through callbacks.

- [ ] **Step 4: Wire async loading and deep-link initialization**

Add optional `suggestionGateway`, `initialSuggestionId`, and `initialSuggestionView` props to `ContentProposalFlow`. Abort stale requests on brand change/unmount. On select, call `setFamily("informational")`, `setSubjectMode("suggestion")`, `setTopic(item.title)`, `setContentInstruction(item.contentBrief)`, and clear product/reference/URL state. Update the input summary to use the selected topic title. `AiContentWizardPage` passes `params.get("suggestionId")` and `params.get("view") === "suggestions"`.

- [ ] **Step 5: Style within the current production system**

Use existing tokens, radii, borders, focus states, and button classes. Add responsive grids only under content-suggestion class names. Do not copy the old prototype layout.

- [ ] **Step 6: Run focused tests and build**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/components/ai-content/ContentSubjectStep.test.tsx src/components/ai-content/ContentProposalFlow.test.tsx --maxWorkers=1 && npm run build --workspace @brand-pilot/customer-ui`

Expected: PASS with only the existing large-chunk warning.

- [ ] **Step 7: Commit**

```bash
git add apps/customer-ui/src/components/ai-content apps/customer-ui/src/pages/AiContentWizardPage.tsx apps/customer-ui/src/features/ai-content/types.ts apps/customer-ui/src/styles/content-wizard.css
git commit -m "feat(ui): use suggested topics in V3 content flow"
```

### Task 8: Add dashboard recommendations

**Files:**
- Modify: `apps/customer-ui/src/pages/DashboardPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/dashboard.test.tsx`
- Modify: `apps/customer-ui/src/styles/dashboard.css`

- [ ] **Step 1: Write failing dashboard tests**

Mock the focused suggestion gateway and verify: personal first, general fill to six, no seventh card, section hidden when both lists are empty, fetch failure does not break the existing dashboard, primary button navigates to `/ai-content/new?suggestionId=<uuid>`, “분야 전체 추천 보기” navigates to `/ai-content/new?view=suggestions`, and date/source are absent.

```tsx
expect(await screen.findAllByRole("button", { name: "AI 콘텐츠로 만들기" })).toHaveLength(6);
expect(screen.queryByText(/출처|업데이트|2026-08-09/)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/dashboard.test.tsx --maxWorkers=1`

Expected: FAIL because the recommendation section does not exist.

- [ ] **Step 3: Load and render up to six cards**

Add an optional `suggestionGateway` prop for tests. Load suggestions independently from dashboard data with an `AbortController`; compute `personal.concat(general).slice(0, 6)` while deduplicating by ID. Render after current operational content, hide on empty/error, and navigate using `useNavigate`.

- [ ] **Step 4: Apply the current dashboard design**

Use the current dashboard section spacing, typography, and responsive breakpoints. Keep the CTA as a real filled button rather than the old text-link treatment.

- [ ] **Step 5: Run focused tests and build**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/dashboard.test.tsx --maxWorkers=1 && npm run build --workspace @brand-pilot/customer-ui`

Expected: PASS with only the existing large-chunk warning.

- [ ] **Step 6: Commit**

```bash
git add apps/customer-ui/src/pages/DashboardPage.tsx apps/customer-ui/src/__tests__/dashboard.test.tsx apps/customer-ui/src/styles/dashboard.css
git commit -m "feat(ui): show dashboard content suggestions"
```

### Task 9: Run local end-to-end verification without deployment

**Files:**
- Modify only files required by defects discovered during verification.

- [ ] **Step 1: Run API verification**

Run: `npm run test --workspace @brand-pilot/api -- src/contentSuggestionContracts.test.ts src/contentSuggestionRepository.test.ts src/contentSuggestionMcp.test.ts src/server.test.ts && npm run typecheck --workspace @brand-pilot/api`

Expected: all tests PASS and typecheck exits 0.

- [ ] **Step 2: Run UI verification**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/features/content-suggestions/contentSuggestionGateway.test.ts src/components/content-suggestions/ContentSuggestionCards.test.tsx src/components/ai-content/ContentSubjectStep.test.tsx src/components/ai-content/ContentProposalFlow.test.tsx src/__tests__/dashboard.test.tsx --maxWorkers=1`

Expected: all focused tests PASS.

- [ ] **Step 3: Run migration and task artifact verification**

Run: `node --test scripts/migrations.integration.test.mjs scripts/content-suggestion-task-definitions.test.mjs`

Expected: PASS.

- [ ] **Step 4: Build production bundles**

Run: `npm run build --workspace @brand-pilot/api && $env:VITE_API_BASE_URL='https://api.danbammsg.co.kr'; npm run build --workspace @brand-pilot/customer-ui`

Expected: both builds PASS; the UI may report the existing chunk-size warning.

- [ ] **Step 5: Inspect the local MCP endpoint**

Start the local API with a disposable local DB and a test-only `CONTENT_SUGGESTION_PLUGIN_TOKEN`, then use MCP Inspector to initialize, list the exact two tools, call scope, reject a bad publish, and verify an authorized valid publish against the local database. Do not point the inspector or migration script at production.

- [ ] **Step 6: Browser-check dashboard and new-content page**

Run the local UI/API and use Playwright against local URLs. Capture screenshots showing: dashboard cards with no date/source and filled CTA; “오늘의 주제” personal cards with no personal heading/count; general filters; selecting a topic updates the current V3 summary. Check desktop and narrow viewport, keyboard focus, and console errors.

- [ ] **Step 7: Review diff and confirm production remains untouched**

Run: `git status --short --branch && git diff codex-deploy/main...HEAD --check && git log --oneline --decorate -12`

Expected: clean diff check, only intended files, no production push/deploy/migration/task activation.

- [ ] **Step 8: Commit verification-only fixes if any**

```bash
git add <only-files-fixed-during-verification>
git commit -m "fix: address content suggestion verification findings"
```

Skip this commit when verification required no changes.

## Explicit non-goals for this branch

- Do not deploy API or UI.
- Do not execute migration 076 against production.
- Do not register the production MCP URL in ChatGPT developer mode.
- Do not create, enable, pause, or edit ChatGPT Scheduled tasks.
- Do not fabricate a `plugin_asdk_app...` ID or commit production credentials.
- Do not modify onboarding, brand-intelligence, subject-analysis, FAQ, proposal, card-news, blog, or reel worker behavior.
- Do not add advertising suggestions, omission reasons, dates, or source UI.
