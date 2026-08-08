# Three-Format Content Generation Cutover Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overloaded marketing/V1 content-generation runtime with one fail-closed three-format pipeline (`card_news | blog | reel`) whose informational/marketing purpose changes the format worker's prompt but never its worker, queue, or model routing.

**Architecture:** A browser-safe canonical contract package feeds API, UI, workers, generated JSON Schema, database assertions, and deployment catalogs. Selection creates a draft only; start atomically freezes V3 input and prompt binding, reserves allowance, and enqueues the first format job. A maintenance-gated, forward-only production cutover clears incompatible execution data, preserves referenced publication artifacts, replaces marketing-worker with reel-worker, and verifies all six format-purpose cells.

**Tech Stack:** TypeScript, TypeBox, React 18, Fastify, PostgreSQL 16/PGlite, Vitest, Playwright, Node.js 20+, Codex CLI, `gpt-5.6-terra`, built-in `gpt-image-2`, Python/FFmpeg/ffprobe, Docker Compose, Bash, GitHub Actions, Vercel Blob.

---

## Authoritative documents

- `docs/superpowers/specs/2026-08-04-three-format-purpose-routed-content-workers-design.md`
- `docs/superpowers/specs/2026-08-04-proposal-v2-writer-migration-design.md`
- `docs/superpowers/specs/2026-08-04-safe-incremental-cicd-design.md`
- `docs/superpowers/plans/2026-08-04-safe-incremental-cicd.md`

This plan suite supersedes `docs/superpowers/plans/2026-07-31-ai-content-generation-flow-worker-contract-implementation.md`. In particular, do not preserve its V1 writers/read adapters, `marketing_content`, `single_image`, `channel_text`, `generation.type`, manifest V2, or marketing-worker compatibility branches. The approved safe incremental CI/CD design remains authoritative for component reuse, per-component provenance, serialization, and fail-closed unknown/shared changes. Phase 5 adds schema 3 and a narrowly proven content-cutover impact classifier; it supersedes only schema-1/2 parsing and post-marker rollback. Mixed per-component source SHAs are valid for intentionally unchanged reused images, while every changed component must match the candidate SHA/digest and every unrelated reused component must remain byte-identical.

## Ordered plan suite

| Phase | Plan | Production-deployable after phase? |
|---|---|---|
| 1 | `2026-08-04-three-format-content-cutover-01-contracts.md` | No; package and deterministic artifacts only |
| 2 | `2026-08-04-three-format-content-cutover-02-database.md` | No; migrations and cleanup primitives are authored/tested but destructive migration is not applied |
| 3 | `2026-08-04-three-format-content-cutover-03-api-ui.md` | No; API/UI now require the coordinated worker/schema release |
| 4 | `2026-08-04-three-format-content-cutover-04-workers.md` | No; all local gates must pass before the write-fence release |
| 5 | `2026-08-04-three-format-content-cutover-05-deployment.md` | Yes, only after its backup, incident-export, maintenance, cutover, canary, and observation gates pass |

Execute phases in order. Do not cherry-pick an API/UI or worker commit into production independently.

Keep every Phase 1–5 implementation commit local and unpushed until Phase 5 Task 1's verified content-cutover classifier and focused command registry are present at the same branch head. Do not open an intermediate PR or trigger remote CI from a head that could select generic worker jobs. The first remote pipeline runs only from the reconciled candidate head and must prove it selected API/UI plus content-proposal/card-news/blog/reel/image tests and no unrelated worker test; any other job selection cancels the release.

## Current-worktree preservation rule

The worktree already contains related, uncommitted edits in these files:

- `apps/customer-ui/e2e/d-hybrid-content-wizard.spec.ts`
- `apps/customer-ui/playwright.config.ts`
- `workers/brand-pilot-blog-worker/scripts/blog-plan-v2.schema.json`
- `workers/brand-pilot-blog-worker/src/productionRuntime.test.ts`
- `workers/brand-pilot-marketing-worker/scripts/marketing-plan-v2.schema.json`
- `workers/brand-pilot-marketing-worker/src/productionRuntime.test.ts`

The JSON-schema edits add explicit `type` beside `const`, and their tests reject untyped constants; preserve that behavior when the hand-written files become canonical generated schemas. The Playwright edits repair current mocks/text and extend server startup timeout; preserve their intent while replacing legacy scenarios. Never reset, checkout, or overwrite these changes.

### Mandatory per-task staging guard

Every implementation commit stages only the exact file paths named in that commit step, and each such path must be a member of the owning task's `Files` block. Directory operands, `git add .`, `git add -A`, and path globs are forbidden, except for the one outer tracked marketing-worker directory move in Phase 4 Task 5; its two nested renames use exact file operands. New files are added by exact path. Immediately before every commit, capture `git status --short`, `git diff --cached --no-renames --name-status`, and `git diff --cached --check`; compare the staged HEAD-to-final name-status set with the commit step's explicit subset and abort on any extra or missing path. By the end of each task, the union of its commits must cover every path that task actually changes, and no undeclared dirty path may be carried forward.

For Phase 4 Task 5, record `git ls-files workers/brand-pilot-marketing-worker` and build one deterministic HEAD-to-final map before the first move: every old tracked path is a deletion; every retained destination is an addition under the reel prefix; the skill and runner receive explicit final-path overrides; planned removals have no destination; and the two new tests are explicit additions. Seal that map and its expected content hashes. The final `git diff --cached --no-renames --name-status` path set must equal the map plus the declared root package/lock modifications. Do not expect intermediate rename paths or heuristic `R` records. Also compare the six pre-existing dirty-file hashes from Task 0: before their owning task they must remain unstaged and byte-identical, and in their owning task their previously recorded intent must be present in the staged diff. The planning documents are committed before implementation begins and therefore are not part of that dirty-source baseline. A task may not use `git commit -a` or amend an earlier commit to hide a staging mismatch.

### Task 0: Verify the execution baseline

**Files:** None.

- [ ] **Step 1: Confirm the exact worktree and branch**

Run:

```powershell
Get-Location
git status --short --branch
$implementationGitRoot = git rev-parse --show-toplevel
$implementationGitRoot
Set-Location (Join-Path $implementationGitRoot "brand_poilot")
git rev-parse --show-prefix
Test-Path package.json
```

Expected: the Git root ends in `fix-blog-schema-unique-items`, the branch is `codex/fix-blog-schema-unique-items`, `git rev-parse --show-prefix` returns `brand_poilot/`, and the application `package.json` exists. From this point through Phase 4 and the local-authoring portion of Phase 5, run every unqualified plan command from this `brand_poilot` application directory; `../.github/...` paths intentionally address the Git-root workflow. Only the six known source files plus later plan changes are dirty.

- [ ] **Step 2: Record the baseline without mutating it**

Run:

```powershell
git diff --check
git diff --name-only
git merge-base --is-ancestor f32e0ac HEAD
git log -1 --oneline
```

Expected: `git diff --check` exits 0; the source-file list matches the preservation list; `git merge-base --is-ancestor` exits 0 and therefore proves the approved design commit `f32e0ac` is in branch history.

- [ ] **Step 3: Read local worker instructions before image-worker tasks**

Run:

```powershell
Get-Content -Raw workers/brand-pilot-image-worker/AGENTS.md
```

Expected: implementation preserves built-in image generation and does not introduce an external image API or `OPENAI_API_KEY`.

## Final-state invariants and temporary phase boundaries

The completed cutover must satisfy these exact invariants:

```ts
export const CONTENT_OUTPUT_FORMATS = ["card_news", "blog", "reel"] as const;
export const CONTENT_PURPOSES = ["informational", "marketing"] as const;
```

- format alone selects card-news-worker, blog-worker, or reel-worker;
- purpose alone selects the informational or marketing prompt inside that worker and never selects a worker, queue, or model; the separately approved input invariant still requires informational `product=null` and marketing one approved frozen product;
- all three planner commands pass `--model gpt-5.6-terra`;
- selection creates a draft and consumes no allowance;
- start atomically writes V3 input, prompt binding, reservation, and first job;
- `output_format` is the only persisted generation/job format field and `purpose` is the only relational purpose field;
- Studio manifest is exact `ai-content.v3` with `outputFormat` and no `type`;
- Instagram delivery `instagram_story`/`instagram_reel` and trend-media `reel` are unchanged;
- no first-party Proposal V1 writer/parser/read adapter or old Studio format remains runnable;
- no unrelated worker process is started by local or production verification.

Phases are intentionally non-deployable until Phase 5. Phase 1 may coexist with worker-local authored schemas while only generating/verifying the canonical replacement; Phase 3 may coexist with worker-runtime/worker V1 branches until Phase 4; and Phase 4 may coexist with schema-1/2 release conversion only until the one-time cutover in Phase 5. These temporary states may exist only on the implementation branch, may not be deployed independently, and must be removed by the named later task before its phase handoff.

## Approved-requirement traceability

| Approved requirement | Owning implementation tasks | Required proof |
|---|---|---|
| One TypeBox authority, generated provider schemas/catalog, typed `const`, no `oneOf`/`uniqueItems` | Phase 1 Tasks 1–4; Phase 4 Tasks 1, 7 | package tests, byte comparison, static ownership and Docker checks |
| Exactly `card_news|blog|reel` and `informational|marketing`; no default/alias | Phase 1 Tasks 1–3; Phase 2 Task 5; Phase 3 Tasks 6–10 | catalog equality, DB checks, claim/UI/parser rejection tests |
| Proposal V2 for performance and automated card-news; no direct V1 writer/placeholder artifacts | Phase 3 Tasks 1–3, 9–10; Phase 4 Task 2 | PGlite/PostgreSQL replay tests, safe-provenance UI tests, static INSERT/V1 guards |
| Selection draft-only; start freezes V3/binding/reservation/job atomically | Phase 2 Task 3B; Phase 3 Task 4 | rollback/replay/concurrency tests in PGlite and PostgreSQL |
| Reserve once, exact permanent-failure reversal, idempotent child retry | Phase 2 Task 3B; Phase 3 Task 5; Phase 5 Task 10 | calendar/concurrency tests and controlled production failure |
| Card/blog/reel workers own two prompt policies and all use `gpt-5.6-terra` | Phase 4 Tasks 3–5, 8 | marker isolation, CLI argument, six-cell harness/canary evidence |
| Marketing worker becomes reel worker with no active alias/dead branch | Phase 4 Task 5; Phase 5 Tasks 1–5, 11 | absence scans, release/Compose tests, running-container evidence |
| Exact `ai-content.v3` manifest with no `type`; Story/Reel delivery and trend reel preserved | Phase 1 Task 2; Phase 3 Tasks 6–7; Phase 4 Task 6 | parser/finalizer/download/publish plus delivery namespace fixtures |
| Existing execution data may be cleared but business/provenance/publication data is preserved | Phase 2 Tasks 2, 4–6 | FK/non-FK catalog, provenance aborts, hashes, retained preview/download |
| Legacy reference eligibility is excluded without semantic relabeling | Phase 2 Tasks 4–5; Phase 3 Tasks 7–8 | unchanged reference hashes plus query/UI/static rejection fixtures |
| Compatibility fence, incident export, provider backup, atomic marker, roll-forward-only recovery | Phase 2 Tasks 1–3B; Phase 5 Tasks 5–9 | failure injection before/after marker and checksummed evidence |
| Today’s commits cannot be omitted/overwritten by CI/CD | Phase 5 Tasks 1, 4, 7 | release-impact mapping and SHA/digest/migration reconciliation |
| Exactly one schema-only Proposal V2 Codex preflight | Phase 4 Task 8; Phase 5 Task 7 | crash-safe fake-child gate, then candidate/image/catalog/schema-bound evidence with model-call count `1` |
| Six production cells, both migrated writers, controlled failure, cleanup, 30-minute observation | Phase 5 Tasks 9–10 | IDs, state rows, artifacts, logs/queue error counts |
| Four known incident classes are closed with cause/change/regression/production evidence | Phase 4 Task 8; Phase 5 Tasks 7, 10 | completed four-row closure matrix; `not_found` plus deterministic reproduction when source evidence is absent |
| Temporary release converter is not executable after completion | Phase 5 Task 11 | converter-free cleanup release promoted and obsolete executable release retired |
| No unrelated worker tests | Every phase scope gate | exact command inventory and explicit final confirmation |

## Phase handoff gates

### Task 1: Accept Phase 1 only with canonical-artifact evidence

- [ ] Run the package tests, build, and generated-artifact byte comparison listed in Phase 1; consumer clean-build/typecheck gates begin when each consumer is migrated in Phases 3–4.
- [ ] Confirm generated canonical artifacts are deterministic and no new consumer treats a worker-local schema as authoritative; the existing worker-local files remain temporary until their explicit Phase 4 deletion.
- [ ] Confirm the generated catalog contains exactly three formats, two purposes, three claim slugs, three planner models, and three plan versions.
- [ ] Commit only the Phase 1 files before starting Phase 2.

### Task 2: Accept Phase 2 only with real PostgreSQL cleanup evidence

- [ ] Run both PGlite and PostgreSQL 16 migration suites listed in Phase 2.
- [ ] Confirm the maintenance fence rejects stale writes without mutation.
- [ ] Confirm provider-backup metadata and incident-export checks fail closed when absent.
- [ ] Confirm cleanup survives a post-commit crash and preserves published artifact paths.
- [ ] Do not apply either new migration to production in this phase.

### Task 3: Accept Phase 3 only with the six-cell API/UI matrix

- [ ] Run the common Proposal V2, performance, automated-card-news, selection/start, quota, retry, manifest, and UI tests listed in Phase 3.
- [ ] Run only the named content-wizard file plus the content-specific grep cases in accessibility/operations; do not run the whole E2E suite.
- [ ] Confirm exact replay returns the same identity and changed fingerprint conflicts.
- [ ] Confirm no UI or API fallback maps missing format to blog or arbitrary format to reel.

### Task 4: Accept Phase 4 only with content-worker harness evidence

- [ ] Run only content-proposal, card-news, blog, reel, image-worker, and canonical contract tests.
- [ ] Confirm each worker includes its selected purpose prompt and excludes the opposite prompt.
- [ ] Confirm Story/Reel delivery tests still pass and no subject-analysis/DM/Wiki/FAQ worker starts.
- [ ] Prove the schema-only Proposal V2 preflight gate is crash-safe with fake children; do not make the real model call until Phase 5 has immutable candidate/image/catalog/schema identity.

### Task 5: Enter production only through Phase 5 gates

- [ ] Reconcile today's intended commits with one pinned release manifest and image digests.
- [ ] Run the schema-only Proposal V2 preflight exactly once against that pinned identity and preserve its checksummed evidence; production canary model calls are separate authorized generation calls.
- [ ] Deploy and verify the compatibility-safe write-fence before destructive migration.
- [ ] Require a fresh provider backup ID and checksummed incident export containing both requested generation IDs.
- [ ] Stop/drain only content-generation workers, enable DB fence, and apply the atomic cutover migration.
- [ ] Query the atomic `schema_migrations` marker before every recovery decision.
- [ ] Prove old API/marketing-worker cannot be restarted after the marker.
- [ ] Run all six production cells, migrated-writer canaries, one controlled terminal failure/reversal/retry, storage cleanup, and a 30-minute observation window.

## Final evidence bundle

The implementing agent must return:

- ordered commit list for all five phases;
- exact targeted commands and pass/fail counts;
- generated-contract source hash;
- migration IDs and before/after database counts/hashes;
- provider backup ID and incident-export checksum;
- six Studio proposal batch/generation IDs, three performance batch IDs, three automated batch/run IDs, and the two selected migrated-writer generation IDs/V3 hashes;
- worker/queue/model/prompt binding and manifest for every canary;
- usage reservation/reversal/retry rows and cumulative authorized/net canary charges for every attempt;
- controlled-failure parent/child generation IDs and exact terminal/reversal/retry evidence;
- storage cleanup/retained-reference totals;
- pinned release manifest, running image digests, API/UI SHA, and final migration marker;
- Proposal V2 preflight hash-chain/Phase-5 transfer checksum and exactly-one completed-call proof;
- staged and promoted customer-UI deployment IDs proving promotion did not rebuild;
- observation sample count, maximum gap, elapsed monotonic duration, and sealed summary checksum;
- confirmation that no unrelated worker was tested.
