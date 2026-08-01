# Brand Intelligence Output-Schema Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore production brand analysis by removing the invalid generic Codex output schema while preserving stage validation and exposing bounded CLI failure diagnostics.

**Architecture:** The runner will continue requesting JSON in each stage prompt, reading the last message, parsing JSON, and applying the existing stage-specific validators. It will stop passing the incompatible global `--output-schema`; on CLI failure it will persist a bounded stderr-or-stdout diagnostic through the existing error path.

**Tech Stack:** Node.js ESM runner, TypeScript, Vitest, Codex CLI, Docker Compose, GitHub Actions/GHCR.

---

### Task 1: Lock the regression with a failing test

**Files:**
- Modify: `workers/brand-pilot-brand-intelligence-worker/src/worker.test.ts`
- Test: `workers/brand-pilot-brand-intelligence-worker/src/worker.test.ts`

- [ ] **Step 1: Replace the obsolete output-schema assertion**

In `keeps external research fail-closed and isolates every Codex stage`, require the runner not to pass or generate a generic schema and require bounded stdout fallback diagnostics:

```ts
expect(script).not.toContain('"--output-schema"');
expect(script).not.toContain("outputSchemaFile");
expect(script).not.toContain("additionalProperties: true");
expect(script).toContain("(stderr.trim() || stdout.trim()).slice(0, 500)");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test --workspace @brand-pilot/brand-intelligence-worker -- --run src/worker.test.ts
```

Expected: FAIL because the runner still contains `--output-schema`, `outputSchemaFile`, and `additionalProperties: true`, and does not yet fall back to stdout diagnostics.

### Task 2: Remove the incompatible schema and preserve diagnostics

**Files:**
- Modify: `workers/brand-pilot-brand-intelligence-worker/scripts/run-codex-brand-intelligence.mjs`
- Test: `workers/brand-pilot-brand-intelligence-worker/src/worker.test.ts`

- [ ] **Step 1: Remove generic schema creation and invocation arguments**

Delete `outputSchemaFile`, its initial `writeFile`, and these Codex arguments:

```js
"--output-schema", outputSchemaFile,
```

Keep `--output-last-message`, JSON stage prompts, `extractJson`, and every downstream contract check unchanged.

- [ ] **Step 2: Add a bounded stdout fallback on non-zero exit**

Replace the non-zero exit branch with:

```js
if (code !== 0) {
  const diagnostic = (stderr.trim() || stdout.trim()).slice(0, 500);
  reject(new Error(`brand_intelligence_codex_failed:${code}:${diagnostic}`));
  return;
}
```

- [ ] **Step 3: Run the focused test and verify GREEN**

Run:

```powershell
npm test --workspace @brand-pilot/brand-intelligence-worker -- --run src/worker.test.ts
```

Expected: all tests in `src/worker.test.ts` PASS.

- [ ] **Step 4: Run worker regression tests and build**

Run:

```powershell
npm test --workspace @brand-pilot/brand-intelligence-worker
npm run build --workspace @brand-pilot/brand-intelligence-worker
git diff --check
```

Expected: worker suite PASS, TypeScript build exits 0, and `git diff --check` emits no errors.

- [ ] **Step 5: Commit the implementation**

```powershell
git add -- workers/brand-pilot-brand-intelligence-worker/scripts/run-codex-brand-intelligence.mjs workers/brand-pilot-brand-intelligence-worker/src/worker.test.ts docs/superpowers/plans/2026-08-01-brand-intelligence-output-schema-hotfix.md
git commit -m "fix: remove invalid brand analysis output schema"
```

### Task 3: Publish and deploy only the brand-intelligence worker

**Files:**
- Read: `../.github/workflows/publish-brand-pilot-server-images.yml`
- Read: `deploy/compose.production.yml`
- Deploy artifact: generated release manifest for the implementation commit

- [ ] **Step 1: Push `main` and monitor the matching image workflow**

```powershell
git push origin main
gh run list --branch main --limit 10 --json databaseId,headSha,status,conclusion,workflowName,url
```

Expected: the workflow for the implementation commit completes successfully and publishes an immutable brand-intelligence worker digest.

- [ ] **Step 2: Install a release directory and recreate only the worker**

Set `RELEASE_COMMIT` to the full implementation commit SHA. Upload the verified release manifest and exact-commit `deploy/compose.production.yml` as `/opt/brand-pilot/releases/$RELEASE_COMMIT/compose.production.yml`, verify checksums, pull the immutable worker digest, and run:

```sh
docker compose -p brand-pilot -f "/opt/brand-pilot/releases/$RELEASE_COMMIT/compose.production.yml" --env-file "/opt/brand-pilot/releases/$RELEASE_COMMIT/release.env" --profile brand-intelligence-worker-1 up -d --no-deps --pull never --force-recreate brand-intelligence-worker-1
```

Expected: only `brand-pilot-brand-intelligence-worker-1-1` is recreated.

- [ ] **Step 3: Verify the live container and real CLI boundary**

Confirm the container is running with restart count 0, its OCI revision equals the implementation commit, and its script contains neither `--output-schema` nor `additionalProperties: true`. Run a minimal `codex exec --json --output-last-message` request without `--output-schema` inside the container.

Expected: the request is not rejected with `invalid_json_schema`; if an independent quota/auth error appears, report it separately without treating the schema hotfix as failed.

- [ ] **Step 4: Retry the existing failed analysis and verify progression**

Use the existing product/API retry flow, then inspect `brand_analysis_stage_runs` and worker logs.

Expected: the new attempt progresses beyond the previous immediate `owned_facts_1` schema failure. Claim end-to-end success only if the analysis reaches `review_ready` or `confirmed`; otherwise report the new exact blocker.
