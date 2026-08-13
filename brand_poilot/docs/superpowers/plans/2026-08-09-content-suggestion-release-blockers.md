# Content Suggestion Release Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every pre-deployment blocker in the scheduled content suggestion branch without deploying or activating schedules.

**Architecture:** Apply schema 076 through a provider-only post-075 migration mode that preserves the sealed 074/075 path. Replace the unsupported shared secret with a generic OAuth 2.1 resource-server verifier backed by an external issuer, then make UI failures recoverable and align operations with the runtime contract.

**Tech Stack:** Node.js, PostgreSQL, Fastify, MCP TypeScript SDK, `jose`, TypeScript, React, Vitest, Node test runner.

---

### Task 1: Post-075 provider migration path

**Files:**
- Modify: `scripts/migrationRunner.test.mjs`
- Modify: `scripts/migrationRunner.mjs`
- Modify: `scripts/migrate.test.mjs`
- Modify: `scripts/migrate.mjs`
- Modify: `db/migrations/077_content_suggestion_batches.sql`

- [ ] Add tests proving an applied 075 plus pending 076 is accepted only in provider post-075 mode, while the ordinary and cutover paths still reject it.
- [ ] Run the focused tests and confirm they fail with `bootstrap_075_present_forbidden` or missing post-075 configuration.
- [ ] Add provider identity/history validation and transactional execution for manifest entries after 075.
- [ ] Add secure CLI configuration using an owner-only DB URL file and an exact expected provider role.
- [ ] Add dynamic table ownership and least-privilege application grants to migration 076.
- [ ] Run focused runner and migration tests to green.

### Task 2: OAuth-protected MCP resource server

**Files:**
- Create: `apps/api/src/contentSuggestionOAuth.ts`
- Create: `apps/api/src/contentSuggestionOAuth.test.ts`
- Modify: `apps/api/src/contentSuggestionMcp.test.ts`
- Modify: `apps/api/src/contentSuggestionMcp.ts`
- Modify: `apps/api/src/contentSuggestionHttp.test.ts`
- Modify: `apps/api/src/contentSuggestionHttp.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`

- [ ] Add failing tests for JWT issuer/audience/scope verification, protected-resource metadata, OAuth challenge headers, tool security metadata, and scope enforcement.
- [ ] Run focused API tests and confirm failures are caused by the shared-secret implementation.
- [ ] Implement a `jose`-backed token verifier and MCP `AuthInfo` propagation.
- [ ] Publish protected-resource metadata and per-tool OAuth scopes.
- [ ] Replace the shared token route option and keep customer routes available when MCP OAuth is disabled outside production.
- [ ] Run focused API tests to green.

### Task 3: Runtime, request size, and observability

**Files:**
- Modify: `apps/api/src/runtimeConfig.test.ts`
- Modify: `apps/api/src/runtimeConfig.ts`
- Modify: `apps/api/src/contentSuggestionHttp.test.ts`
- Modify: `apps/api/src/contentSuggestionHttp.ts`
- Modify: `deploy/env/api.env.example`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `docs/operations/gpt-scheduled-content-suggestions.md`

- [ ] Add failing tests for production OAuth config requirements and a contract-valid payload larger than 256 KiB.
- [ ] Require and parse HTTPS issuer, JWKS, resource and audience settings in production.
- [ ] Raise the MCP request body limit to 1 MiB without changing item limits.
- [ ] Add structured success logging and update env/preflight/runbook contracts.
- [ ] Run runtime and HTTP tests to green.

### Task 4: Recoverable customer UI

**Files:**
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalFlow.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentProposalFlow.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentSubjectStep.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ContentSubjectStep.tsx`
- Modify: `apps/customer-ui/src/__tests__/dashboard.test.tsx`
- Modify: `apps/customer-ui/src/pages/DashboardPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentWizardPage.tsx`
- Modify: `apps/customer-ui/src/styles/content-wizard.css`

- [ ] Add failing tests for stale IDs, retained lists, completion validity, dashboard retry, and URL alias compatibility.
- [ ] Separate list and single-item errors, clear phantom selection, and require the selected topic text.
- [ ] Add dashboard error/retry state and accept both URL values while emitting `view=today`.
- [ ] Replace the flow-scoped card border variable with the global line token.
- [ ] Run focused UI tests to green.

### Task 5: Verification without deployment

**Files:**
- Modify: `docs/operations/gpt-scheduled-content-suggestions.md`

- [ ] Run API content-suggestion tests, runtime tests, typecheck, and build.
- [ ] Run migration runner, migration registry, and task-definition tests.
- [ ] Run focused UI tests and production UI build.
- [ ] Run `git diff --check` and inspect the final diff for secrets or deployment changes.
- [ ] Confirm no production deployment, DB migration execution, plugin registration, or schedule activation occurred.
