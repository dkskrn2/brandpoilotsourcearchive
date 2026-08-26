# Publish Management Safe Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the current publish-management UX first, then add weekly automatic scheduling, and only then activate a singleton publishing scheduler without changing unrelated services.

**Architecture:** The work ships as one branch, one PR, one server-image CI/CD run, and one production release SHA. Implementation remains ordered as operational truth/UX, weekly settings/allocation, and scheduler/expiry so tests stay understandable. The Vercel UI build is staged and verified against canary before its production domain is promoted; migration, backward-compatible API, staged UI, and a stopped scheduler are verified before the scheduler is activated.

**Tech Stack:** React 18, TypeScript, Fastify, PostgreSQL/PGlite, Vitest, Playwright, Docker Compose, Ubuntu release scripts.

---

## Work order and stop gates

1. [Workstream 1 — operational truth and UX](2026-08-25-publish-operations-truth-and-ux.md)
2. [Workstream 2 — weekly automatic publishing settings](2026-08-25-weekly-auto-publishing-settings.md)
3. [Workstream 3 — singleton scheduler and expiry](2026-08-25-publish-scheduler-and-expiry.md)

All three workstreams use the current isolated branch and are combined into one PR. Intermediate commits and focused test gates remain, but there is no intermediate merge, CI/CD deployment, or production release.

- Workstream 1 changes the publish read model and customer UI without writing operating data.
- Workstream 2 adds settings and allocation. Migration `092_publish_calendar_weekly_schedule.sql` is required by the normalized weekday/time design but remains an explicit approval gate because an earlier requirement said to proceed without another migration.
- Workstream 3 adds the API publishing transaction and the new publish-scheduler image/service. The scheduler is deployed stopped and activated only after the same release's API/UI checks pass.
- Do not test or deploy DM, FAQ, crawl, Wiki, content generation workers, Caddy, or automatic-response settings.
- Before every production deployment, fetch and re-read `codex-deploy/main` from `https://github.com/dkskrn2/main.git`, Ubuntu `state/current`, GitHub `PRODUCTION_RELEASE_SHA`, active service digests, and any hotfix/digest drift. This worktree's `origin` points to the separate `brandpoilotsourcearchive` history and must not be used as the production main baseline. If the operating sources no longer share the expected baseline, stop and rebuild the candidate from the new confirmed main.
- The single rollback baseline is the pre-release operating SHA and its existing service digests. Stop the new scheduler first, restore only changed API/UI/scheduler components, never drop migration 092, and never delete, reassign, or backfill customer reservations automatically.

## Integrated acceptance

- The same `PublishItem` is visible in list and calendar with the same title, operational status, date, channel progress, and available actions.
- Past active reservations never appear as ordinary upcoming reservations.
- Today-delayed reservations can be rescheduled only before provider execution starts; previous-day stale reservations are action-required until Workstream 3 expires them.
- Completed, upcoming, delayed, failed, and cancelled states use green, blue, orange, red, and gray respectively, plus text labels.
- Weekly schedule rows allow multiple times per day and duplicate times without a 30-minute rule.
- Publication-unit quota uses subscription-start weeks and counts a shared multi-channel slot once.
- Scheduler calls primary API only, once per minute, without overlap; API advisory lock prevents duplicate mutation.

## Open approval gate

The current `publish_calendar_settings.slot_times time[]` column cannot represent a weekday. A normalized Monday-Sunday schedule therefore needs migration 092. Do not start implementation until one of these two outcomes is explicitly confirmed:

1. Approve additive migration 092. This preserves the full weekly requirement and does not alter or delete existing reservations.
2. Keep the no-migration constraint. In that case, remove weekday-specific recurring schedules from this release; do not encode weekdays into `time[]`, reuse dated slots as templates, or hide schedule data in an unrelated JSON column.

## What already exists

| Need | Existing path | Plan decision |
|---|---|---|
| Common list/calendar source | `GET /brands/:brandId/publish-items`, `publishItemState.ts` | Extend the existing `PublishItem` read model; do not create a second calendar repository. |
| Reservation create/change/cancel | Existing publish-calendar repository and slot schedule route | Reuse and expose the existing safe server validation. |
| Automatic slot allocator | `publishCalendarAllocator.ts` and authenticated `POST /internal/cron/publish-calendar-allocate` | Extend its input to weekly rows and give it an explicit scheduler cadence. |
| Due posting | `runDuePublishing` and authenticated `/internal/cron/publish-due` | Refactor claim/expiry boundaries; do not add a parallel publishing engine. |
| Provider publication claim | Existing queue transition and `publishQueueItemInternal` | Preserve its one-target claim and result recovery contract. |
| Subscription-week quota | Existing subscription-start window and publication-unit count | Reuse for manual and automatic slots. |
| Release manifest preservation | `release-impact.mjs`, `assemble-release-manifest.mjs`, release bundle scripts | Add only the scheduler component and preserve all unchanged digests. |

## Corrected release data flow

```text
one merged main SHA
        |
        +--> GitHub Actions: verify + API image + publish-scheduler image + release bundle
        |
        +--> Vercel: build STAGED customer UI, no production-domain assignment yet
                         |
                         v
[migration 092 approval] -> migrate -> API canary -> staged UI against canary
                                              |
                                              v
                                  promote API primary
                                  (state/current changes here in existing tooling)
                                              |
                                              v
                                  promote staged UI domain
                                              |
                                              v
                                  preview allocation + expiry + due IDs
                                              |
                                              v
                                  start exactly one scheduler
                                              |
                                              v
                                  verify ticks/attempts/health
                                              |
                                              v
                                  set PRODUCTION_RELEASE_SHA
```

The existing `promote.sh` writes `state/current` when API primary is promoted. The plan must not claim that `state/current` stays on the old SHA until scheduler verification. If a later activation gate fails, stop the scheduler, roll back the staged UI alias and API primary, and let the existing rollback path restore `state/current`.

## Zero-downtime API/UI transition

- Keep the existing `/publish-calendar/settings` contract for the currently served UI during this release.
- Add a versioned weekly contract such as `/publish-calendar/settings/weekly`; the new UI uses it only after a capability/read succeeds.
- The staged new UI must still render and preserve the old settings path while production API is old.
- The new API must accept the old UI contract until the production UI alias has moved and old-revision writes are no longer observed.
- Do not dual-write old `slot_times` into weekly rows and do not let the allocator fall back to `slot_times`.
- Remove the compatibility endpoint in a later cleanup PR after evidence shows no old-client writes. That cleanup is not a second feature release and must not be bundled into the activation cutover.

## NOT in scope

- DM, FAQ, crawl, Wiki, content-generation workers, Caddy, provider adapters, and automatic-response settings: no changed dependency or runtime path.
- Server-side pagination for the canonical `PublishItem[]`: 30-at-a-time DOM rendering fixes the measured UI problem without changing the shared list/calendar API in this release.
- Deleting the legacy `slot_times` column: kept for database rollback compatibility until a separately approved contract migration.
- Cancelling or rewriting already materialized future reservations after settings changes: would change customer intent.
- Automatic retry on the next day after a provider call started: preserves existing explicit retry/result-unknown policy.

## Failure gates

| Failure mode | Required handling | Required test/evidence |
|---|---|---|
| New UI reaches old API | Capability-gated old UI path, no destructive write | Staged UI E2E against old primary |
| Old UI reaches new API | Legacy endpoint remains isolated | API contract test with exact old payload |
| Duplicate scheduler/caller | Non-overlap in worker plus short DB claim lock | Two concurrent execution tests |
| Provider call exceeds one minute | No open DB transaction; bounded batch and in-flight-aware health | Slow-provider integration test |
| Recommendation batch is late | Allocation cadence catches up idempotently | Allocation-after-late-recommendation test |
| Scheduler secret file absent or wrong mode | Preflight rejects activation | Deployment contract test |
| Scheduler image addition rebuilds unrelated workers | Release impact identifies only API/UI/scheduler | Release-impact and manifest-preservation tests |
| API promotion succeeds, scheduler activation fails | Stop scheduler, roll back UI alias/API, restore state | Runbook rehearsal with exact SHA/digests |

Any row above without a passing test blocks the PR. Any production preview candidate not explained by read-only DB evidence blocks scheduler activation.

## Implementation lanes

| Lane | Modules | Depends on |
|---|---|---|
| A | `apps/api` read model, status and reservation contracts | — |
| B | `apps/customer-ui` presentation, calendar/list/dialog/mobile | A contract types |
| C | weekly settings storage/API/allocator | migration approval |
| D | scheduler worker and release tooling | execution HTTP contract |
| E | due expiry/claim/provider dispatch | existing publish queue contract |

Use one worktree and one branch as requested. Lanes describe implementation order, not separate PRs or deployments. A and the UI skeleton may proceed together after DTOs are fixed; C, D, and E must merge sequentially through the shared API/release-tooling tests to avoid false green builds.

## Test coverage plan

```text
CODE PATHS                                             USER FLOWS
[EXISTING] canonical PublishItem repository            [PLANNED E2E] list == calendar item/status/actions
  +-- [PLANNED] future / delayed / stale / published      +-- desktop 1280 and 1024
  +-- [PLANNED] failed / result unknown / cancelled       +-- mobile 390 agenda
  +-- [PLANNED] cancelled + expiry reason

[EXISTING] reservation create/change/cancel            [PLANNED E2E] reserve and safely reschedule
  +-- [PLANNED] valid future default                      +-- today defaults to a future time
  +-- [PLANNED] delayed-today safe branch                 +-- same action in list/calendar/modal
  +-- [PLANNED] provider-started rejection

[NEW] weekly settings contract                         [PLANNED E2E] automatic settings
  +-- [PLANNED] legacy UI <-> new API                     +-- master OFF/ON with preserved channel choices
  +-- [PLANNED] new UI <-> old API                        +-- weekday multiple/duplicate times
  +-- [PLANNED] weekly ID/tenant/rollback                  +-- quota and validation recovery

[EXISTING+CHANGED] allocator                           [PLANNED integration] daily recommendation assignment
  +-- [PLANNED] seven-day KST occurrence                  +-- informational/trend default mix
  +-- [PLANNED] replay and same-time duplicate             +-- extra slots remain open
  +-- [PLANNED] late recommendation catch-up               +-- quota exhaustion is explained

[EXISTING+CHANGED] due publishing                      [PLANNED integration] late publish and expiry
  +-- [PLANNED] short lock -> claim -> commit               +-- before 23:59 publishes late
  +-- [PLANNED] bounded provider dispatch                  +-- at 23:59 unstarted target cancels
  +-- [PLANNED] partial/result-unknown recovery             +-- original/effective/cancel times visible

[NEW] scheduler and release component                  [PLANNED deployment test] one-release activation
  +-- [PLANNED] no overlap, auth, timeout, heartbeat       +-- staged UI -> canary -> primary -> UI alias
  +-- [PLANNED] allocation cadence/catch-up                +-- preview exact candidate IDs
  +-- [PLANNED] immutable scheduler-only digest             +-- changed-service-only rollback
```

All new branches above require the named test before implementation is marked complete. The migration application-role PostgreSQL test, staged old/new API-UI matrix, slow-provider test, release-impact preservation test, and production preview-ID comparison are release blockers, not optional smoke tests.

## Review completion summary

- Step 0 Scope Challenge: one PR/release retained; scheduler reduced to a dependency-free artifact and existing repositories/routes are reused.
- Architecture Review: 8 issues found and 7 resolved in the plan; migration approval remains open.
- Code Quality Review: legacy/new contracts isolated, duplicate status vocabulary removed, and release-tooling ownership made explicit.
- Test Review: coverage diagram produced; 8 previously implicit failure paths are now mandatory tests.
- Performance Review: provider calls moved outside DB transactions; fair bounded dispatch and long in-flight health behavior added.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: none; no vague deferred work added.
- Failure modes: 1 critical gap remains, explicit migration approval.
- Outside voice: skipped; review is based on current repository and official PostgreSQL/Vercel deployment behavior.
- Parallelization: 5 logical lanes, one shared worktree/branch, release-critical API/tooling work sequential.
- Lake Score: 7/8 findings have the complete fix; 1/8 awaits the user's migration decision.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | NOT RUN | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | NOT RUN | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 21 issues, 1 critical gap |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | NOT RUN | Repository/browser UX findings are already incorporated, but no formal design review is logged. |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | NOT RUN | — |

- **UNRESOLVED:** 1, explicit approval or rejection of additive migration 092.
- **VERDICT:** ENG NOT CLEARED. Do not implement Workstream 2 or deploy until the migration decision is made.
