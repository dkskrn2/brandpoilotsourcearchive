# Publish Management Safe Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the current publish-management UX first, then add weekly automatic scheduling, and only then activate a singleton publishing scheduler without changing unrelated services.

**Architecture:** The work is split into three independently reviewable releases. Release A changes only the publish read model and customer UI; Release B adds an additive weekly-schedule table, compatible API, allocator, and UI while automatic posting remains OFF; Release C adds the single execution caller and 23:59 expiry after dry-run verification.

**Tech Stack:** React 18, TypeScript, Fastify, PostgreSQL/PGlite, Vitest, Playwright, Docker Compose, Ubuntu release scripts.

---

## Release order and stop gates

1. [Release A — operational truth and UX](2026-08-25-publish-operations-truth-and-ux.md)
2. [Release B — weekly automatic publishing settings](2026-08-25-weekly-auto-publishing-settings.md)
3. [Release C — singleton scheduler and expiry](2026-08-25-publish-scheduler-and-expiry.md)

Each release gets its own branch commit set and PR. Do not combine the three PRs.

- Release A has no migration, scheduler, worker, Caddy, or provider change.
- Release B uses migration `091_publish_calendar_weekly_schedule.sql`; automatic posting remains OFF and no scheduler is started.
- Release C changes only the API publishing transaction, the new publish-scheduler image/service, and its release/runbook definitions.
- Do not test or deploy DM, FAQ, crawl, Wiki, content generation workers, Caddy, or automatic-response settings.
- Before every production deployment, re-read `origin/main`, Ubuntu `state/current`, GitHub `PRODUCTION_RELEASE_SHA`, active service digests, and any hotfix/digest drift. If they no longer share the expected baseline, stop and rebuild the candidate from the new confirmed main.
- Roll back only services changed by that release. Never drop migration 091 during rollback and never delete, reassign, or backfill customer reservations automatically.

## Cross-release acceptance

- The same `PublishItem` is visible in list and calendar with the same title, operational status, date, channel progress, and available actions.
- Past active reservations never appear as ordinary upcoming reservations.
- Today-delayed reservations can be rescheduled only before provider execution starts; previous-day stale reservations are action-required until Release C expires them.
- Completed, upcoming, delayed, failed, and cancelled states use green, blue, orange, red, and gray respectively, plus text labels.
- Weekly schedule rows allow multiple times per day and duplicate times without a 30-minute rule.
- Publication-unit quota uses subscription-start weeks and counts a shared multi-channel slot once.
- Scheduler calls primary API only, once per minute, without overlap; API advisory lock prevents duplicate mutation.

