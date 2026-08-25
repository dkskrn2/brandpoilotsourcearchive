# Publish Management Safe Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the current publish-management UX first, then add weekly automatic scheduling, and only then activate a singleton publishing scheduler without changing unrelated services.

**Architecture:** The work ships as one branch, one PR, one CI/CD run, and one production release SHA. Implementation remains ordered as operational truth/UX, weekly settings/allocation, and scheduler/expiry so tests stay understandable; within the single deployment, migration, API, UI, and a stopped scheduler are verified before the scheduler is activated.

**Tech Stack:** React 18, TypeScript, Fastify, PostgreSQL/PGlite, Vitest, Playwright, Docker Compose, Ubuntu release scripts.

---

## Work order and stop gates

1. [Workstream 1 — operational truth and UX](2026-08-25-publish-operations-truth-and-ux.md)
2. [Workstream 2 — weekly automatic publishing settings](2026-08-25-weekly-auto-publishing-settings.md)
3. [Workstream 3 — singleton scheduler and expiry](2026-08-25-publish-scheduler-and-expiry.md)

All three workstreams use the current isolated branch and are combined into one PR. Intermediate commits and focused test gates remain, but there is no intermediate merge, CI/CD deployment, or production release.

- Workstream 1 changes the publish read model and customer UI without writing operating data.
- Workstream 2 adds migration `091_publish_calendar_weekly_schedule.sql`, settings, and allocation. Automatic posting remains OFF during verification.
- Workstream 3 adds the API publishing transaction and the new publish-scheduler image/service. The scheduler is deployed stopped and activated only after the same release's API/UI checks pass.
- Do not test or deploy DM, FAQ, crawl, Wiki, content generation workers, Caddy, or automatic-response settings.
- Before every production deployment, re-read `origin/main`, Ubuntu `state/current`, GitHub `PRODUCTION_RELEASE_SHA`, active service digests, and any hotfix/digest drift. If they no longer share the expected baseline, stop and rebuild the candidate from the new confirmed main.
- The single rollback baseline is the pre-release operating SHA and its existing service digests. Stop the new scheduler first, restore only changed API/UI/scheduler components, never drop migration 091, and never delete, reassign, or backfill customer reservations automatically.

## Integrated acceptance

- The same `PublishItem` is visible in list and calendar with the same title, operational status, date, channel progress, and available actions.
- Past active reservations never appear as ordinary upcoming reservations.
- Today-delayed reservations can be rescheduled only before provider execution starts; previous-day stale reservations are action-required until Workstream 3 expires them.
- Completed, upcoming, delayed, failed, and cancelled states use green, blue, orange, red, and gray respectively, plus text labels.
- Weekly schedule rows allow multiple times per day and duplicate times without a 30-minute rule.
- Publication-unit quota uses subscription-start weeks and counts a shared multi-channel slot once.
- Scheduler calls primary API only, once per minute, without overlap; API advisory lock prevents duplicate mutation.
