# Brand Pilot Admin API Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authenticated Brand Pilot Admin API foundation with operational read models, safe brand pause/resume, idempotency, and audit logging.

**Architecture:** Keep admin contracts and SQL in a separate `AdminRepository` so the existing customer `ApiRepository` does not expand further. Register `/admin/v1` routes in the existing Fastify server, authenticate with a dedicated service token, and perform every admin mutation through one database transaction that also writes the idempotency result and audit event.

**Tech Stack:** TypeScript, Fastify 5, PostgreSQL, Vitest, existing migration runner.

---

### Task 1: Add the admin persistence contract

**Files:**
- Create: `db/migrations/045_admin_api_foundation.sql`
- Create: `apps/api/src/adminTypes.ts`
- Create: `apps/api/src/adminRepository.ts`
- Create: `apps/api/src/adminRepository.test.ts`
- Modify: `scripts/migrationRunner.test.mjs`

- [x] Write a failing migration contract test that requires `audit_events.actor_external_id`, `admin_idempotency_keys`, request hash uniqueness, and the `admin` actor type.
- [x] Run `node --test scripts/migrationRunner.test.mjs` and verify failure because migration 045 does not exist.
- [x] Add migration 045 without changing existing customer tables beyond the audit actor extension.
- [x] Write failing repository tests for overview mapping, brand listing, channel listing, system health, and idempotent brand status mutation.
- [x] Run `npm test --workspace @brand-pilot/api -- adminRepository.test.ts` and verify failure because the repository does not exist.
- [x] Implement `AdminRepository` with typed DTOs, cursor pagination helpers, allowlisted status transitions, row locking, audit insert, and idempotency replay.
- [x] Re-run focused tests and verify they pass.

### Task 2: Add service authentication and admin routes

**Files:**
- Create: `apps/api/src/adminServer.ts`
- Create: `apps/api/src/adminServer.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/.env.example`

- [x] Write failing route tests for missing token, invalid token, missing actor, overview, list endpoints, brand detail, and brand status mutation.
- [x] Verify route tests fail because `/admin/v1` is not registered.
- [x] Implement timing-safe bearer authentication and required request headers.
- [x] Register overview, brands, channels, system health, workers, audit events, and brand status endpoints.
- [x] Require UUID `Idempotency-Key` and a non-empty reason for brand status changes.
- [x] Construct `AdminRepository` from the existing pool in `index.ts` and add `ADMIN_SERVICE_TOKEN` to `.env.example`.
- [x] Re-run route tests and verify they pass.

### Task 3: Protect the contract against regressions

**Files:**
- Modify: `scripts/repository-contract.test.mjs`
- Modify: `docs/PRE_LAUNCH_REQUIRED.md`

- [x] Add a failing contract test that checks the separate admin namespace, service token environment variable, and absence of credential payload fields from admin DTOs.
- [x] Add the implementation contract and pre-launch token rotation instructions.
- [x] Run API typecheck and focused contract tests.

### Task 4: Verify the first admin API slice

**Files:**
- Verify: `apps/api/src/adminRepository.ts`
- Verify: `apps/api/src/adminServer.ts`
- Verify: `db/migrations/045_admin_api_foundation.sql`

- [x] Run `npm test --workspace @brand-pilot/api -- adminRepository.test.ts adminServer.test.ts`.
- [x] Run `npm run typecheck --workspace @brand-pilot/api`.
- [x] Run `node --test scripts/migrationRunner.test.mjs scripts/repository-contract.test.mjs`.
- [x] Run `git diff --check` for the touched files.
