# Safe Incremental CI/CD Design

**Date:** 2026-08-04  
**Status:** Approved in conversation  
**Production baseline:** `e818aaa198cf5ffcef1aece1248bb12e86cab55f`

## Goal

Make `main` the only production source, serialize production releases, build and restart only affected components, and retain exact rollback provenance for every component. Unknown or shared changes fail closed to a full server-image build.

## Current risks

- Production and `main` have diverged. A release built from current `main` can omit production content-generation changes.
- The workflow publishes API and nine worker images for every qualifying run, even when only one component changed.
- DM and Wiki are built twice from the same Dockerfile.
- `RELEASE_SCHEMA=1` assumes every image was built at `RELEASE_SHA`, so an unchanged image cannot be reused safely.
- GitHub Actions stops after publishing images and a manifest. Ubuntu canary/promotion, worker rollout, and customer UI promotion are manual and disconnected.
- Production deployment is not serialized at the GitHub workflow level.
- Authenticated canary verification is skipped when the managed canary session cookie is absent.
- Database migrations are intentionally manual and must remain outside automatic deployment.

## Source convergence

Create a convergence candidate from the production baseline and merge the current `main` history into it. Resolve conflicts by preserving the deployed behavior while retaining the two main-only deployment fixes. Verify the candidate before merging it to `main`. Do not deploy a branch SHA directly.

After convergence:

- only a SHA reachable from `main` may become a release candidate;
- a candidate must descend from the current production release;
- direct session-branch publishing is removed;
- an older queued candidate is skipped if it is no longer the current `main` head;
- rollback is a separate operation that selects an existing immutable manifest.

## Impact detection

The comparison base is the current production `RELEASE_SHA`, not the previous Git commit. This captures several merged sessions in one release.

Deterministic rules:

| Change | Impact |
| --- | --- |
| `apps/customer-ui/**` | customer UI only |
| `apps/api/**` | API |
| one worker directory | that worker image |
| DM worker directory | one shared DM/Wiki image build |
| `workers/brand-pilot-worker-runtime/**` | all server images during the conservative first version |
| root `package.json` or `package-lock.json` | UI and all server images |
| a component Dockerfile | that component |
| `deploy/**` | deployment bundle only |
| `db/migrations/**` or migration runner | migration gate; no automatic production deployment |
| docs and non-runtime tests | no image build |
| any unclassified runtime-capable path | all server images |

The detector must be a versioned script with unit tests. Empty and malformed bases fail closed. Workflow-only changes bootstrap a full build when they alter build or manifest behavior.

## Release manifest v2

`RELEASE_SCHEMA=2` remains a complete release description. Each component stores:

- immutable image reference by digest;
- the source revision recorded in that image;
- whether the component changed in this release.

Unchanged components copy their digest and component revision from the current production manifest. Changed components use the new digest and candidate SHA. Preflight verifies every image against its own component revision. Schema 1 remains readable so the current production release can still be rolled back.

The complete manifest, deployment scripts, Compose file, Caddy files, and checksums form one immutable release bundle. Reusing a digest never means omitting it from the bundle.

## Build and verification flow

1. Resolve the current production manifest read-only.
2. Verify the candidate is the current `main` head and descends from production.
3. Detect impact from production to candidate.
4. Run focused tests/builds for affected components and mandatory deployment-contract tests.
5. Build affected images in a matrix with registry cache.
6. Build the DM/Wiki image once and publish it to both repositories.
7. Reuse unchanged digests from the production manifest.
8. Assemble and checksum the complete schema-2 release bundle.
9. Refuse automatic deployment when a migration changed.

The first schema-2 release is a full build. Incremental reuse begins only after that full baseline is verified and promoted.

## Deployment flow

Production jobs use one concurrency group with `cancel-in-progress: false`. After waiting for the lock they re-check that the candidate is still the current `main` head.

1. Transfer the exact release bundle to Ubuntu.
2. Acquire the existing server-side `flock` deployment lock.
3. Verify bundle checksums, manifest provenance, and ancestry gate.
4. Pull changed images only.
5. Start the API canary only when the API changed; otherwise verify the existing API.
6. Run public health/ready checks and the managed authenticated canary check. Missing authenticated-canary credentials fail the production deployment instead of silently skipping it.
7. Prepare backups and promote the API when applicable.
8. Replace only changed worker services and verify their process/heartbeat contract.
9. Promote the exact customer UI deployment only after backend and workers are healthy.
10. Commit the current-release pointer only after all selected components pass.

If any selected component fails, restore the previous complete manifest. Unchanged services are never restarted.

## Database migrations

Automatic migration remains prohibited. A migration change runs migration tests and produces a release marked `migration_approval_required`. Production deployment stops until a separately approved dry run, backup/PITR evidence, compatibility review, and migration execution are recorded.

## Failure policy

- Unknown impact: full server build.
- Missing production manifest: full bootstrap build, no automatic promotion.
- Missing digest or component revision: fail.
- Candidate not descending from production: fail.
- Candidate not current `main`: skip as stale.
- Missing authenticated canary credential: fail before promotion.
- Migration changed without approval evidence: fail before production mutation.
- Partial rollout failure: restore previous complete manifest.

## Scoped implementation

This change is limited to CI/CD impact detection, release manifest/provenance validation, deployment orchestration contracts, release documentation, and directly related tests. It does not change API business logic, UI behavior, onboarding, DM behavior, publishing behavior, or content-generation prompts.
