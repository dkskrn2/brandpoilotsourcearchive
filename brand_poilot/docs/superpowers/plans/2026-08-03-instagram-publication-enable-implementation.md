# Instagram Publication Enable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkboxes so progress can be tracked explicitly.

**Goal:** Restore the Instagram card-news upload option and make actual Instagram publication available in production without changing the public API address or unrelated product behavior.

**Architecture:** Keep `https://api.danbammsg.co.kr` and the existing provider-backed Instagram publishing path. Make the shared production API environment file authoritative for `INSTAGRAM_PUBLISH_ENABLED`, allow that flag in production while retaining every other production safety guard, and keep the local scheduler disabled. Existing channel capability evaluation and UI behavior then expose Instagram only for connected, publish-capable accounts.

**Tech Stack:** TypeScript, Node.js, Vitest, Docker Compose, Bash, jq, GitHub Actions, Ubuntu/Caddy deployment.

---

### Task 1: Permit provider-backed publishing in the production runtime contract

**Files:**
- Modify: `apps/api/src/runtimeConfig.test.ts`
- Modify: `apps/api/src/runtimeConfig.ts`

- [ ] Add a focused production test that sets `INSTAGRAM_PUBLISH_ENABLED=true` and `LOCAL_SCHEDULER_ENABLED=false`, then expects publishing readiness to be enabled and scheduler readiness to remain disabled.
- [ ] Run `npm run test --workspace @brand-pilot/api -- src/runtimeConfig.test.ts` and confirm the new test fails because production currently rejects the publishing flag.
- [ ] Remove only the `INSTAGRAM_PUBLISH_ENABLED` production rejection from `loadApiRuntimeConfig`; preserve cookie, development-auth, scheduler, worker, attachment-upload, and credential guards.
- [ ] Run the focused runtime-config test again and confirm it passes.
- [ ] Review `git diff -- apps/api/src/runtimeConfig.ts apps/api/src/runtimeConfig.test.ts` for the two-file scope.
- [ ] Commit with `git commit -am "fix(api): allow provider-backed Instagram publishing"`.

Expected test shape:

```ts
it("allows Instagram publishing in production while the local scheduler stays off", () => {
  const env = validProductionEnv();
  env.INSTAGRAM_PUBLISH_ENABLED = "true";
  env.LOCAL_SCHEDULER_ENABLED = "false";

  expect(loadApiRuntimeConfig(env)).toMatchObject({
    schedulerEnabled: false,
    instagramPublishEnabled: true,
    readiness: {
      schedulerEnabled: false,
      publishingEnabled: true,
    },
  });
});
```

### Task 2: Make the production deployment contract explicitly enable publication

**Files:**
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `deploy/compose.production.yml`
- Modify: `deploy/env/api.env.example`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `deploy/scripts/verify-canary.sh`

- [ ] Add deployment-contract assertions requiring one `INSTAGRAM_PUBLISH_ENABLED=true` entry in the API environment example, no API service-level override for that key, an exact preflight expectation of `true`, and canary verification of publishing `enabled` while scheduler remains `disabled`.
- [ ] Run `npm run test:deployment` and confirm the new assertions fail against the current forced-off contract.
- [ ] Remove only `INSTAGRAM_PUBLISH_ENABLED: "false"` from `api-primary` and `api-canary`; leave the forced-off scheduler and attachment-upload settings in both services.
- [ ] Change only the API environment example's publication flag from `false` to `true`.
- [ ] Generalize the preflight helper to validate an expected boolean, require publishing `true`, and continue requiring every other dark feature flag to be `false`.
- [ ] Change canary readiness verification to require `.features.publishing == "enabled"` while preserving the scheduler-disabled assertion.
- [ ] Run `npm run test:deployment` and confirm it passes.
- [ ] Inspect the five-file diff and commit with `git commit -am "fix(deploy): enable Instagram publication capability"`.

The preflight contract must remain exact, rejecting missing, duplicate, or misspelled values:

```bash
require_exact_boolean "LOCAL_SCHEDULER_ENABLED" "false" "$API_ENV_FILE"
require_exact_boolean "INSTAGRAM_PUBLISH_ENABLED" "true" "$API_ENV_FILE"
require_exact_boolean "AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED" "false" "$API_ENV_FILE"
```

### Task 3: Document the bounded production activation and rollback

**Files:**
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `docs/operations/UBUNTU_DEPLOYMENT.md`

- [ ] Add a runbook contract test requiring a dated `Instagram publication activation (2026-08-03)` section, the enabled publication flag, the disabled scheduler flag, the prohibition on unsolicited live posts, and restoration of the backed-up `api.env` during rollback.
- [ ] Run `npm run test:deployment` and confirm the documentation contract fails.
- [ ] Add the current activation procedure without rewriting historical initial-release controls that record the old forced-off baseline.
- [ ] Include secret-safe validation commands, an exact backup path under `/opt/brand-pilot/state`, canary-first promotion, and rollback to the prior release plus backed-up environment file.
- [ ] Run `npm run test:deployment` and confirm it passes.
- [ ] Review the documentation-only diff and commit with `git commit -am "docs: add Instagram publication activation runbook"`.

### Task 4: Verify the complete local change set

**Files:**
- Verify all modified files from Tasks 1–3.

- [ ] Run `npm run test --workspace @brand-pilot/api -- src/runtimeConfig.test.ts src/channelCapabilities.test.ts src/instagramPublisher.test.ts src/repository.test.ts src/server.test.ts`.
- [ ] Run `npm run test:deployment`.
- [ ] Run `npm run test:contract`.
- [ ] Run `npm run typecheck --workspace @brand-pilot/api`.
- [ ] Run `npm run build --workspace @brand-pilot/api`.
- [ ] Run Bash syntax checks for `deploy/scripts/preflight.sh` and `deploy/scripts/verify-canary.sh`; run ShellCheck when installed.
- [ ] Confirm `git diff 964a17d658865c0eba8c513a08a83fec23dd020a --name-status` lists only the design, plan, runtime-config, deployment-contract, and runbook files in this hotfix.
- [ ] Confirm no frontend, OAuth, database schema, channel capability algorithm, publisher implementation, or worker file changed.

### Task 5: Deliver through verification-only CI and a canary-first production rollout

**Files:**
- Deploy the verified commit; do not add further source changes during rollout.

- [ ] Fetch `main`, verify it has not diverged incompatibly from the production base, and re-run focused verification if a rebase is required.
- [ ] Push `codex/instagram-generation-capability-hotfix` to `dkskrn2/main`.
- [ ] Dispatch `publish-brand-pilot-server-images.yml` on the branch and wait for the verification job to succeed; the branch run must not publish images.
- [ ] Open and merge a focused pull request into `main` only after required checks succeed.
- [ ] Wait for the `main` image publication workflow and download the release artifact for the merged commit.
- [ ] On the production server, verify `/opt/brand-pilot/shared/env/api.env` owner/mode and the exact existing publication-key count without printing the file.
- [ ] Back up that file under `/opt/brand-pilot/state`, mode `0600`, then atomically set exactly one `INSTAGRAM_PUBLISH_ENABLED=true` entry while leaving `LOCAL_SCHEDULER_ENABLED=false`.
- [ ] Run server preflight, deploy the new image to canary only, and verify `/ready` reports configuration/database OK, publishing enabled, and scheduler disabled.
- [ ] Exercise authenticated canary capability/readiness checks without creating an unsolicited live Instagram post.
- [ ] Promote the same image to primary, verify external `/ready`, and confirm the existing connected Instagram account now exposes card-news publication.
- [ ] If any verification fails, keep primary on the prior image or roll it back, restore the backed-up API environment file, and verify publishing returns to disabled.

No API hostname change is part of this plan. No live content is published unless the user separately approves a specific generated artifact and caption.
