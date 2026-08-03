# Safe Incremental CI/CD Implementation Plan

> Implement in the production-baseline worktree only. Do not deploy production or register credentials as part of this plan.

**Goal:** Replace unconditional server-image publishing with fail-closed impact detection, component provenance, serialized release coordination, and a credential-gated deployment handoff.

**Architecture:** A tested Node impact detector compares the deployed SHA to the candidate. GitHub Actions verifies affected workspaces and builds an affected-image matrix. A complete schema-2 manifest carries an immutable digest and source revision for every component, reusing unchanged entries from the deployed manifest. Ubuntu scripts validate schema 1 for rollback and schema 2 for incremental releases. Production mutation stays disabled unless required environment credentials and authenticated-canary material exist.

**Tech stack:** GitHub Actions, Node.js test runner, Docker Buildx/GHCR, Bash deployment scripts, Docker Compose.

---

## Task 1: Add the fail-closed impact detector

**Files:**

- Create: `scripts/release-impact.mjs`
- Create: `scripts/release-impact.test.mjs`
- Modify: `package.json`

1. Add failing tests for UI-only, API-only, each worker, shared runtime, DM/Wiki sharing, root lockfile, deploy-only, migration, docs-only, unknown runtime path, empty input, and deduplicated output.
2. Run `node --test scripts/release-impact.test.mjs` and confirm the missing module/behavior failure.
3. Implement a pure classifier plus a CLI that accepts newline-delimited paths or a Git base/head.
4. Emit stable JSON and GitHub output fields for tests, builds, migration gate, and deploy bundle.
5. Re-run the focused test.

## Task 2: Introduce schema-2 component provenance without breaking schema 1 rollback

**Files:**

- Modify: `deploy/scripts/lib.sh`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `deploy/scripts/deploy.sh`
- Modify: `deploy/scripts/promote.sh`
- Modify: `deploy/scripts/rollback.sh`
- Modify: `deploy/release.env.example`
- Modify: `scripts/deployment-contract.test.mjs`

1. Add failing deployment-contract tests for schema-2 image/source/change triplets, schema-1 readability, per-component revision verification, and complete-manifest fingerprints.
2. Run only the matching deployment-contract tests and confirm the expected failure.
3. Extend manifest parsing with explicit allowed keys. Keep schema 1 accepted.
4. Verify schema-2 images against their component source revision, not the aggregate release SHA.
5. Include all component provenance in preparation fingerprints and rollback validation.
6. Re-run focused deployment-contract tests and shellcheck.

## Task 3: Build the complete release manifest from changed and reused components

**Files:**

- Create: `scripts/assemble-release-manifest.mjs`
- Create: `scripts/assemble-release-manifest.test.mjs`
- Modify: `package.json`

1. Add failing tests for full bootstrap, selective reuse, missing current component, malformed digest, wrong revision, migration gate, and deterministic output.
2. Confirm the tests fail because the assembler is absent.
3. Implement the assembler with no shell evaluation and strict key validation.
4. Generate `release.env` and its checksum from explicit inputs only.
5. Re-run focused tests.

## Task 4: Replace unconditional image publishing with a tested matrix

**Files:**

- Modify: `../.github/workflows/publish-brand-pilot-server-images.yml`
- Modify: `scripts/deployment-contract.test.mjs`

1. Add failing workflow contract tests requiring:
   - `main`-only publishing;
   - no hotfix-branch exception;
   - impact job and affected-image matrix;
   - production-SHA comparison rather than previous-commit comparison;
   - one DM/Wiki build with two repository tags;
   - Buildx registry cache;
   - schema-2 manifest assembly;
   - unknown-change full-build fallback;
   - migration deployment block;
   - production concurrency with `cancel-in-progress: false`;
   - stale-main and ancestry checks;
   - credential and authenticated-canary gates.
2. Run the focused workflow contract test and confirm failure.
3. Refactor the workflow into impact, verify, matrix-build, manifest, and gated deploy-handoff jobs.
4. Keep automatic production mutation disabled when environment credentials are absent.
5. Re-run workflow contracts.

## Task 5: Add selective worker rollout contracts

**Files:**

- Create: `deploy/scripts/rollout-workers.sh`
- Modify: `deploy/scripts/lib.sh`
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `docs/operations/DEVELOPMENT_AND_RELEASE_FLOW.md`

1. Add failing tests for changed-worker allowlists, unchanged-worker non-restart, digest pinning, lock reuse, heartbeat verification, and previous-manifest recovery.
2. Confirm focused tests fail.
3. Implement the minimal rollout script using explicit service names and the existing server lock.
4. Document that migrations remain separately approved and that absent CD credentials leave a release ready but undeployed.
5. Re-run focused tests and shellcheck.

## Task 6: Converge source history safely without deploying it

**Files:**

- Git history only; resolve conflicts only in files changed by the production and main-only deployment lines.

1. Fetch and record the exact production and `main` SHAs.
2. Create a convergence candidate from the production baseline.
3. Merge `origin/main` into the candidate without committing automatically.
4. Audit every conflict against both histories and preserve production behavior plus main-only deployment fixes.
5. Run the CI/CD focused suite and directly affected application tests.
6. Do not merge to `main`, push, create a PR, or deploy until the diff and evidence are reviewed.

## Task 7: Verification

Run only directly related checks:

```bash
node --test scripts/release-impact.test.mjs
node --test scripts/assemble-release-manifest.test.mjs
node --test scripts/deployment-contract.test.mjs
shellcheck --exclude=SC1091,SC2016,SC2034,SC2317 deploy/scripts/*.sh
npm run build --workspace @brand-pilot/api
```

The API build is included because the conservative first impact map treats the shared runtime and root dependency graph as server-wide. Do not run unrelated browser E2E or all workspace tests.

## Operational activation deferred from code implementation

- Create a dedicated Ubuntu deployment identity and restricted key.
- Register GitHub `Production` environment secrets/variables.
- Provision and rotate the authenticated canary session material.
- Configure exact Vercel customer-UI promotion credentials.
- Perform the first full schema-2 bootstrap release and canary.
- Enable incremental reuse only after that baseline is promoted.

These actions mutate external production controls and require a separate explicit approval.
