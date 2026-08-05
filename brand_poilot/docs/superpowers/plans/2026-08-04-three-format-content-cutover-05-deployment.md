# Three-Format Production Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one pinned schema-3 release, retire marketing-worker so it cannot restart, execute the fenced forward-only database cutover, and prove the repaired pipeline in production across all six format-purpose cells and both migrated Proposal V2 writers.

**Architecture:** The compatibility fence is deployed first from the exact Phase 2 fence commit, without migration `075`. The final candidate is assembled from one release SHA and immutable image digests. A temporary read-only converter records/removes a legacy marketing component but can never start it. Once the atomic `075_ai_content_three_format_cutover.sql` marker exists, every recovery path keeps maintenance enabled and rolls forward only.

**Tech Stack:** GitHub Actions, Docker/Compose, Bash, PostgreSQL, Node.js, Vercel deployment/storage, production content workers.

**Production scope:** Only API/UI and content-proposal, card-news, blog, reel, and image workers are cut over/canaried. Do not start, stop for testing, or run suites for unrelated workers.

---

## Task 1: Make release manifest schema 3 the only normal contract

**Files:**

- Modify: `scripts/assemble-release-manifest.mjs`
- Modify: `scripts/assemble-release-manifest.test.mjs`
- Modify: `scripts/release-impact.mjs`
- Modify: `scripts/release-impact.test.mjs`
- Create: `scripts/content-cutover-impact.mjs`
- Create: `scripts/content-cutover-impact.test.mjs`
- Create: `scripts/reconcile-intended-commits.mjs`
- Create: `scripts/reconcile-intended-commits.test.mjs`
- Modify: `scripts/incremental-cicd-contract.test.mjs`
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `scripts/check-local-env.mjs`
- Modify: `scripts/worker-cli-only-contract.test.mjs`
- Modify: `scripts/ai-content-contract.test.mjs`
- Create: `scripts/run-ai-content-ci.mjs`
- Create: `scripts/run-ai-content-ci.test.mjs`
- Create: `scripts/customer-ui-deployment-evidence.mjs`
- Create: `scripts/customer-ui-deployment-evidence.test.mjs`
- Create: `scripts/customer-ui-promotion.mjs`
- Create: `scripts/customer-ui-promotion.test.mjs`
- Modify: `apps/customer-ui/package.json`
- Modify: `vercel.json`
- Delete: `apps/customer-ui/vercel.json`
- Modify: `apps/customer-ui/vite.config.ts`
- Create: `apps/customer-ui/src/releaseMetadata.ts`
- Create: `apps/customer-ui/src/releaseMetadata.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `../.github/workflows/publish-brand-pilot-server-images.yml`

- [ ] **Step 1: Write RED schema-3 and release-impact tests**

Normal assembly/parsing must require:

```text
RELEASE_SCHEMA=3
RELEASE_SHA
REQUIRED_MIGRATION_ID=075_ai_content_three_format_cutover.sql
CONTENT_CATALOG_SHA256
CUSTOMER_UI_SOURCE_SHA
CUSTOMER_UI_DEPLOYMENT_ID
CUSTOMER_UI_STAGED_URL
CUSTOMER_UI_DEPLOYMENT_EVIDENCE_SHA256
CUSTOMER_UI_CHANGED
CUSTOMER_UI_CONTRACT_VERSION
CUSTOMER_UI_REQUIRED_MIGRATION_ID
CONTENT_PROPOSAL_MODEL_ID
PREFLIGHT_CANDIDATE_SHA
PROPOSAL_V2_PREFLIGHT_IDENTITY_SHA256
API_IMAGE / API_SOURCE_SHA
CONTENT_PROPOSAL_WORKER_IMAGE / CONTENT_PROPOSAL_WORKER_SOURCE_SHA
CARD_NEWS_WORKER_IMAGE / CARD_NEWS_WORKER_SOURCE_SHA
BLOG_WORKER_IMAGE / BLOG_WORKER_SOURCE_SHA
REEL_WORKER_IMAGE / REEL_WORKER_SOURCE_SHA
IMAGE_WORKER_IMAGE / IMAGE_WORKER_SOURCE_SHA
DM_WORKER_IMAGE / DM_WORKER_SOURCE_SHA
WIKI_WORKER_IMAGE / WIKI_WORKER_SOURCE_SHA
BRAND_INTELLIGENCE_WORKER_IMAGE / BRAND_INTELLIGENCE_WORKER_SOURCE_SHA
SUBJECT_ANALYSIS_WORKER_IMAGE / SUBJECT_ANALYSIS_WORKER_SOURCE_SHA
```

Preserve every unrelated schema-2 component, immutable digest, per-component source SHA, changed flag, and static deployment value byte-for-byte. Remove only the marketing component and add reel. `RELEASE_SHA` identifies the assembly operation; unchanged components may intentionally retain older source SHAs. Require only components classified as changed to have candidate source SHA, and reject a changed component with stale provenance. `CONTENT_PROPOSAL_MODEL_ID` equals the exact production proposal-worker model. `PREFLIGHT_CANDIDATE_SHA` is initially the same source SHA as the candidate on which the one model call is authorized; a later reviewed descendant may retain that older value only under the common append-only release-adoption byte-identity/ancestry proof, of which Task 11 is one consumer. The preflight identity is the deterministic SHA-256 of `PREFLIGHT_CANDIDATE_SHA`, immutable proposal-worker image digest/source SHA/tree SHA, canonical contract source/catalog/proposal-schema hashes, model, and sanitized command descriptor. The completed preflight transfer is produced later on the host and is bound to this precommitted identity, avoiding a circular release-manifest hash.

- [ ] **Step 2: Prove RED**

```powershell
node --test scripts/assemble-release-manifest.test.mjs scripts/release-impact.test.mjs scripts/content-cutover-impact.test.mjs scripts/reconcile-intended-commits.test.mjs scripts/ai-content-contract.test.mjs scripts/run-ai-content-ci.test.mjs scripts/customer-ui-deployment-evidence.test.mjs scripts/customer-ui-promotion.test.mjs
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/incremental-cicd-contract.test.mjs scripts/deployment-contract.test.mjs
npm test --workspace @brand-pilot/customer-ui -- src/releaseMetadata.test.ts
```

- [ ] **Step 3: Replace marketing with reel across release production**

Keep the existing unknown/shared-path fail-closed rule: unrecognized `packages/**`, root dependency changes, worker-runtime changes, or workflow changes still select all server components. Add a separate content-cutover classifier that may narrow this one approved branch only after it semantically verifies all of the following against the base commit:

- the root `package.json` delta is limited to the `packages/*` workspace, canonical-contract/content-only CI scripts, marketing→reel scripts, and pinned `@testcontainers/postgresql@12.0.4`; no unrelated root command/dependency changes;
- the lockfile delta is limited to the canonical workspace/TypeBox, direct API/UI/content-worker consumers, exact Testcontainers `12.0.4` subtree, exact Vercel `58.5.1` subtree, and marketing→reel workspace rename; every unrelated worker/application dependency subtree hashes identically;
- worker-runtime changes are limited to its direct canonical dependency/lifecycle, `controlledSearch` type import, removal of the content schema façade/tests/re-exports, and corresponding index assertions; exported process/search/resource helper signatures and implementation hashes remain identical;
- the workflow delta is an exact reviewed allowlist: marketing→reel component mapping; canonical/content-only build and test gates; generic-job skip only after verified content scope; source-commit reconciliation; staged Production Vercel build/evidence artifact; schema-3 manifest/converter coordination; serialized promotion/cutover evidence; and the later converter-removal cleanup profile. Every unrelated job, permission, secret reference, trigger, and step subtree hashes identically;
- deleted paths are included in classification.

The classifier returns three states: not applicable; applicable+unverified with a stable reason; or applicable+verified with a named profile. `initial_three_format_cutover` selects exactly `customerUi|api|contentProposalWorker|cardNewsWorker|blogWorker|reelWorker|imageWorker`. `remove_legacy_converter` accepts only Task 11's exact converter deletions, workflow/deploy/runbook/static-test changes, and removal of the three temporary cleanup-secret declarations/mounts from `deploy/compose.production.yml`, `deploy/env/api.env.example`, `deploy/env/ai-content-cutover-roles.env.example`, and `deploy/release.env.example`. It selects no runtime image/UI rebuild, reuses every observed component digest and UI deployment ID byte-for-byte, and runs only its exact deployment/static/provenance tests. Any other source/config hunk makes the profile unverified. If an applicable proof fails, the impact job exits `content_cutover_scope_unverified` before any broad or component test job; it does not fall back to testing unrelated workers. For the initial profile, `packages/brand-pilot-content-contracts/**`, the proven root/lock/runtime extraction, and the exact workflow change rebuild/test UI, API, content-proposal, image, card-news, blog, and reel only. `workers/brand-pilot-reel-worker/**` maps to `REEL_WORKER_IMAGE`; deletion of marketing maps to reel/deployment impact. Migration `075` rebuilds API because that pinned image owns migrations/tools, but no migration auto-deploys outside the explicit cutover workflow. Unit fixtures snapshot every allowed shared-file hunk for both profiles and fail on an added/removed workflow edge, secret, package subtree, runtime helper change, or changed cleanup-release digest.

Do not execute the broad `worker-cli-only-contract.test.mjs`; it contains unrelated-worker cases. Update only its marketing→reel expectation for future full-repository CI, and make the focused `ai-content-contract.test.mjs` parse/assert that content-only slice so this plan verifies it without exercising DM/Wiki/brand-intelligence/subject-analysis cases. In shared `deployment-contract.test.mjs` and `incremental-cicd-contract.test.mjs`, prefix every content-cutover case this plan creates or changes with literal `[ai-content-cutover]`; every plan/CI invocation of those shared files must use Node's exact `^\[ai-content-cutover\]` test-name filter. Their unit guards reject an untagged content-cutover case or an unfiltered registry/plan command. Dedicated content-only test files run separately. Static release-manifest tests may assert unrelated component keys/digests are preserved byte-for-byte, but they must not import, build, start, or run those worker packages.

Add root `test:contract:ai-content` and `test:ci:ai-content` scripts backed by `run-ai-content-ci.mjs`. Its exported argument-array registry contains only the exact Phase 1–4 canonical/API/UI/content-proposal/card-news/blog/reel/image focused commands and tagged repository/Playwright cases; it rejects shell strings, `--workspaces`, whole API/UI suites, `test:contract`, `worker-cli-only-contract.test.mjs`, and any DM/Wiki/FAQ/profile/support/brand-intelligence/subject-analysis workspace or smoke. Given base/head, it also enumerates every changed `*.test.*`/E2E file inside the approved content roots and fails if the file is neither explicitly in the registry nor deleted, preventing another modified-but-unexecuted test. Its unit fixture covers every plan file and snapshots the exact allowlist.

The impact job exports `content_cutover_applicable` and `content_cutover_verified`. Verified content cutover runs `npm run test:contract:ai-content` plus `npm run test:ci:ai-content`; the existing generic API/UI/worker steps all add `content_cutover_verified != 'true'`. Not-applicable changes keep the existing full `npm run test:contract` and component jobs. Applicable-but-unverified stops before either branch. The focused registry runs PostgreSQL 16 cutover/runner tests, canonical contracts, targeted Phase 3 API/UI units, tagged repository/E2E, the fake six-cell/preflight harness, focused worker-runtime `controlledSearch/index` tests, and only the five content-worker suites/builds. This both honors the current cutover restriction and keeps future normal full CI viable.

Add a read-only commit-reconciliation tool that accepts an explicit KST cutoff, candidate SHA, current-production manifest, all fetched refs, and a reviewed exclusions file. It enumerates every commit touching `brand_poilot/**` or the release workflow since the cutoff across local/remote refs, plus the deployed release ancestry even when it predates the cutoff. Each entry must resolve to exactly one of: candidate ancestor; stable patch-equivalent change with exact affected-path/component proof; or an explicit user-approved `supersededBy`/`excludedReason` record. “Looks intentional,” missing ref, commit subject similarity, or a later whole-file hash alone is never an exclusion. For overlapping patches it compares the before/after hunks and final semantic guard/test ownership so a later overwrite cannot masquerade as inclusion. Unknown, ambiguous, reverted-without-approval, or partially retained changes fail `intended_commit_unreconciled`. Unit fixtures cover a missing commit, squash/cherry-pick equivalence, partial overwrite, revert, unrelated intentional exclusion, and two branches touching the same file.

Pin `vercel@58.5.1` in the customer-UI dev dependencies. The checked-in production project authority is application-root `vercel.json` (its current build command/output directory and operations documentation prove this), so set `git.deploymentEnabled=false` there and delete the misleading nested `apps/customer-ui/vercel.json`. Before build, query the authenticated Vercel project API and require its configured root directory to resolve to this application root plus the same framework/build/output contract; any different project/root blocks for user review. This prevents a push to `main` from independently publishing an API-incompatible UI and prevents staging from reading the wrong config.

Add a Vite emit-only release metadata module that writes uncommitted `dist/release.json` with exact schema, 40-hex source SHA, catalog SHA-256, `requiredMigrationId="075_ai_content_three_format_cutover.sql"`, and `aiContentContract="ai-content.v3"`; non-release local builds use an explicit all-zero sentinel, while `VERCEL_ENV=production` rejects missing real values. Configure `/release.json` as `Cache-Control: no-store, max-age=0` in application-root `vercel.json`. For a verified main candidate, add a serialized `stage-customer-ui` job before manifest assembly. With environment-scoped `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`, it runs from the `brand_poilot` application root:

```bash
npx --no-install vercel pull --yes --environment=production --token "$VERCEL_TOKEN" --scope "$VERCEL_ORG_ID"
VITE_RELEASE_SHA="$GITHUB_SHA" \
VITE_CONTENT_CATALOG_SHA256="$CONTENT_CATALOG_SHA256" \
  npx --no-install vercel build --prod --token "$VERCEL_TOKEN" --scope "$VERCEL_ORG_ID"
npx --no-install vercel deploy --prebuilt --prod --skip-domain --yes \
  --meta "githubCommitSha=$GITHUB_SHA" \
  --meta "brandPilotReleaseSha=$GITHUB_SHA" \
  --token "$VERCEL_TOKEN" --scope "$VERCEL_ORG_ID" > staged-ui-url.txt
```

`customer-ui-deployment-evidence.mjs` queries the authenticated Vercel deployment API and records exact deployment ID, immutable staged production URL, project/team IDs, `READY` state, `target=production`, commit/release metadata, previous production deployment ID, and a checksum. It rejects a Preview target, missing `--skip-domain` evidence, an already assigned production domain, metadata mismatch, or a URL/ID that does not belong to the configured project. Upload this evidence as an immutable workflow artifact, download it in manifest assembly, and set every required `CUSTOMER_UI_*` field from the verified evidence plus release metadata. It also implements a separate model-incapable `--attest-current-reuse` mode for a later unchanged-UI descendant: that mode requires the exact cutover ID and reserved adoption sequence, binds both plus the descendant release SHA to the exact already-Current deployment/project/team, its immutable original UI source SHA, and a fresh no-cache production-domain `/release.json` read; it never stages, promotes, or rewrites UI metadata. The strict assembler accepts this evidence only for the same adoption sequence with `CUSTOMER_UI_CHANGED=false` and byte-identical prior UI identity. Nothing promotes the domain in this task.

Before accepting the staged artifact, fetch `/release.json` from that deployment with authenticated `npx --no-install vercel curl --deployment` and require the candidate SHA, catalog hash, migration, and V3 contract. `customer-ui-promotion.mjs` later accepts only the checksummed release manifest/evidence, invokes pinned `npx --no-install vercel promote` for this staged-production URL, then proves through Vercel REST plus the production-domain `/release.json` that the production deployment ID is still the exact staged ID. A new ID indicates an accidental Preview/rebuild path and fails. It also records the previous production ID and refuses any post-`075` rollback target whose own `/release.json` is not V3/`075`; the initial cutover is roll-forward-only after the marker.

- [ ] **Step 4: Run GREEN and commit**

```powershell
node --test scripts/assemble-release-manifest.test.mjs scripts/release-impact.test.mjs scripts/content-cutover-impact.test.mjs scripts/reconcile-intended-commits.test.mjs scripts/ai-content-contract.test.mjs scripts/run-ai-content-ci.test.mjs scripts/customer-ui-deployment-evidence.test.mjs scripts/customer-ui-promotion.test.mjs
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/incremental-cicd-contract.test.mjs scripts/deployment-contract.test.mjs
npm test --workspace @brand-pilot/customer-ui -- src/releaseMetadata.test.ts
git add -- scripts/assemble-release-manifest.mjs scripts/assemble-release-manifest.test.mjs scripts/release-impact.mjs scripts/release-impact.test.mjs scripts/content-cutover-impact.mjs scripts/content-cutover-impact.test.mjs scripts/reconcile-intended-commits.mjs scripts/reconcile-intended-commits.test.mjs scripts/incremental-cicd-contract.test.mjs scripts/deployment-contract.test.mjs scripts/check-local-env.mjs scripts/worker-cli-only-contract.test.mjs scripts/ai-content-contract.test.mjs scripts/run-ai-content-ci.mjs scripts/run-ai-content-ci.test.mjs scripts/customer-ui-deployment-evidence.mjs scripts/customer-ui-deployment-evidence.test.mjs scripts/customer-ui-promotion.mjs scripts/customer-ui-promotion.test.mjs apps/customer-ui/package.json vercel.json apps/customer-ui/vercel.json apps/customer-ui/vite.config.ts apps/customer-ui/src/releaseMetadata.ts apps/customer-ui/src/releaseMetadata.test.ts package.json package-lock.json ../.github/workflows/publish-brand-pilot-server-images.yml
git commit -m "feat(release): publish schema 3 reel worker release"
```

## Task 2: Remove the runnable marketing service from deployment configuration

**Files:**

- Modify: `deploy/compose.production.yml`
- Create: `deploy/env/reel-worker.env.example`
- Delete: `deploy/env/marketing-worker.env.example`
- Modify: `deploy/release.env.example`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `deploy/scripts/deploy.sh`
- Modify: `deploy/scripts/promote.sh`
- Modify: `deploy/scripts/rollout-workers.sh`
- Modify: `deploy/scripts/lib.sh`
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `scripts/incremental-cicd-contract.test.mjs`

- [ ] **Step 1: Write RED configuration guards**

Require `reel-worker-1`, `REEL_WORKER_IMAGE`, `REEL_WORKER_1_ENV_FILE`, and `REEL_*`; reject `marketing-worker-1`, `MARKETING_WORKER_*`, `MARKETING_CODEX_*`, or both services. Reel must start from the schema-3 desired set even if no reel service was present in `running_before`. Remove the current hard-coded `CONTENT_PROPOSALS_ENABLED=false`: release/env/preflight require an explicit boolean, and API readiness requires a fresh proposal-worker heartbeat whenever it is true. Ordinary production keeps `AUTOMATED_CONTENT_ENABLED=false`.

Run the guards now and require RED before changing deployment configuration:

```powershell
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/deployment-contract.test.mjs scripts/incremental-cicd-contract.test.mjs
```

Expected: the runnable marketing service/keys remain and reel is not yet a required desired component.

- [ ] **Step 2: Replace the service and fail closed on stale configuration**

Do not retain an alias, compatibility profile, commented service, old env example, or old image key. Preflight rejects a stale marketing container and missing reel digest. Because feature flags are process environment, every flag change must recreate/roll the affected API container and then recheck readiness; editing an env file alone is not an applied change.

- [ ] **Step 3: Run GREEN and commit**

```powershell
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/deployment-contract.test.mjs scripts/incremental-cicd-contract.test.mjs
git add deploy/compose.production.yml deploy/env/reel-worker.env.example deploy/env/marketing-worker.env.example deploy/release.env.example deploy/scripts/preflight.sh deploy/scripts/deploy.sh deploy/scripts/promote.sh deploy/scripts/rollout-workers.sh deploy/scripts/lib.sh scripts/deployment-contract.test.mjs scripts/incremental-cicd-contract.test.mjs
git commit -m "refactor(deploy): replace marketing service with reel worker"
```

## Task 2B: Build the isolated production canary control plane and measurable worker health

**Files:**

- Create: `apps/api/src/aiContentCanaryPolicy.ts`
- Create: `apps/api/src/aiContentCanaryPolicy.test.ts`
- Modify: `apps/api/src/runtimeConfig.ts`
- Modify: `apps/api/src/runtimeConfig.test.ts`
- Modify: `apps/api/src/automatedCardNews.ts`
- Modify: `apps/api/src/automatedCardNews.test.ts`
- Modify: `apps/api/src/performanceProposalAdapter.ts`
- Modify: `apps/api/src/performanceProposalAdapter.test.ts`
- Modify: `apps/api/src/performanceInsights.ts`
- Modify: `apps/api/src/performanceInsights.test.ts`
- Modify: `apps/api/src/aiContentProposalV2Service.ts`
- Modify: `apps/api/src/aiContentProposalV2Service.test.ts`
- Modify: `apps/api/src/aiContentProposalV2Repository.pglite.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/types.ts`
- Create: `apps/api/src/server.aiContentCanary.test.ts`
- Modify: `apps/api/src/server.aiContentWorker.test.ts`
- Modify: `apps/api/src/server.performanceInsightsCustomer.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/client.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/client.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/client.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/client.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/index.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/productionRuntime.test.ts`
- Modify: `workers/brand-pilot-blog-worker/src/client.ts`
- Modify: `workers/brand-pilot-blog-worker/src/client.test.ts`
- Modify: `workers/brand-pilot-blog-worker/src/index.ts`
- Modify: `workers/brand-pilot-blog-worker/src/productionRuntime.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/client.ts`
- Modify: `workers/brand-pilot-reel-worker/src/client.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/index.ts`
- Modify: `workers/brand-pilot-reel-worker/src/productionRuntime.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentRenderClient.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentRenderClient.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/index.ts`
- Modify: `workers/brand-pilot-image-worker/src/productionRuntime.test.ts`
- Create: `scripts/ai-content-production-canary.mjs`
- Create: `scripts/ai-content-production-canary.test.mjs`
- Create: `scripts/ai-content-production-observer.mjs`
- Create: `scripts/ai-content-production-observer.test.mjs`
- Create: `deploy/scripts/ai-content-production-canary.sh`
- Modify: `deploy/compose.production.yml`
- Create: `deploy/env/api-content-canary.env.example`
- Modify: `deploy/env/api.env.example`
- Modify: `deploy/release.env.example`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `deploy/scripts/lib.sh`
- Create: `apps/customer-ui/playwright.production.config.ts`
- Create: `apps/customer-ui/e2e/ai-content-cutover.production.spec.ts`
- Modify: `scripts/run-ai-content-ci.mjs`
- Modify: `scripts/run-ai-content-ci.test.mjs`
- Modify: `scripts/deployment-contract.test.mjs`

- [ ] **Step 1: Write RED policy, heartbeat, failure-probe, driver, and observer tests**

Ordinary production is exact `AI_CONTENT_CANARY_MODE=false` and `AUTOMATED_CONTENT_ENABLED=false`. The isolated loopback replica has two strict startup phases. Both require `AI_CONTENT_CANARY_MODE=true`, one UUID `AI_CONTENT_CANARY_ATTEMPT_ID`, one UUID `AI_CONTENT_CANARY_BRAND_ID`, one approved UUID `AI_CONTENT_CANARY_PRODUCT_ID`, exactly three distinct UUIDs in `AI_CONTENT_CANARY_EXPERIMENT_IDS`, the immutable prepared cutover ID, a dedicated `AI_CONTENT_CANARY_SECRET`, `CONTENT_PROPOSALS_ENABLED=true`, and `LOCAL_SCHEDULER_ENABLED=false`. `AI_CONTENT_CANARY_PHASE=topic_bootstrap` additionally requires no topic IDs and `AUTOMATED_CONTENT_ENABLED=false`; it exposes only authenticated safe reads and the exact topic-upload mutation. `AI_CONTENT_CANARY_PHASE=full` requires the same attempt/cutover IDs, exactly three distinct UUIDs in `AI_CONTENT_CANARY_TOPIC_IDS`, and `AUTOMATED_CONTENT_ENABLED=true`. A missing/duplicate/malformed/cross-brand/cross-attempt value prevents startup.

In canary mode, a common first prevalidation guards every driver ingress mutation before repository access. It requires the designated brand, the one approved product for marketing cells, one of the three experiments for performance, one of the three topics for scheduled work, and exact `cutover-canary:<cutoverId>:<canaryAttemptId>:` request/operation/idempotency-key prefix. The only derived-key exception is inside the normal scheduled adapter after that check: for the three sealed attempt-specific topic IDs it must continue deriving exactly `scheduled-topic:${contentTopicId}:instagram:card_news` and `scheduled-proposal:${runId}`. Those production keys cannot authorize another topic/attempt or bypass the loopback request. Wrong brand/product/experiment/topic/attempt/prefix or a mutation not explicitly allowlisted returns `ai_content_canary_scope_forbidden` with zero rows across proposals, jobs, generations, usage, topics, attachments, and outputs. Every customer/cron/internal mutation made by the driver goes through the loopback replica; the production UI mapping spec intercepts its POSTs and performs no mutation.

The performance browser body remains exactly `{experimentId,evidenceVersion}`. Only the full loopback canary route requires an `Idempotency-Key: cutover-canary:<cutoverId>:<canaryAttemptId>:performance:<ordinal>` header that the global canary prevalidation converts into a branded, sealed server-internal outer operation context. `performanceProposalAdapter` passes that optional context into the common `AiContentProposalV2Service.create(command)`; it does not lock, replay, or persist around the service. Inside the service's existing key/fingerprint/transaction boundary, the performance branch combines the context with the ordinary performance identity to derive the canary replay key/fingerprint before acquiring the same scoped lock. Same attempt/header/body returns the same batch, while a new attempt ID creates a distinct batch even for the same experiment/evidence. Ordinary production continues using exactly `performance:${actorUserId}:${experimentId}:${evidenceVersion}`, cannot construct the branded context, and rejects a cutover-prefixed header before repository access. Service/PGlite concurrency tests cover same-attempt replay, successor-attempt separation, changed fingerprint `409`, one common transaction/job per batch, ordinary-body/key stability, and wrong mode/brand/experiment/attempt zero writes.

The topic bootstrap sends `Idempotency-Key: cutover-canary:<cutoverId>:<canaryAttemptId>:topics` to the ordinary authenticated topic-upload route. The Phase 2 durable upload contract returns the same upload plus the same ordered three valid topic-row UUIDs on exact replay and conflicts on a changed CSV/fingerprint. The script then stops bootstrap and starts full phase with the same sealed attempt ID and those topic IDs. In full phase, one explicit scheduler call has one attempt-prefixed request key, makes `runDailyGeneration()` enumerate the three sealed topic IDs in their sealed order, and invokes the normal `enqueueAutomatedCardNews()` V2 adapter exactly once per topic. Each adapter call derives the unchanged production `scheduled-topic`/`scheduled-proposal` identities from its attempt-specific topic/run rows; partial failure/resume replays completed topics and creates only the missing batch. The single call must end with exactly three batch/run identities. Normal non-canary key derivation, daily selection, and cardinality remain byte-for-byte unchanged; there is no discovery, selection, or generation branch.

Add `POST /worker/ai-content-workers/heartbeat` with exact closed body `{workerId,kind,state,bootId,containerId}` where kind is `content_proposal|card_news|blog|reel|ai_content_image`, state is `running|stopping`, and boot/container identities are non-empty immutable process identities. Content-proposal authenticates only with `CONTENT_PROPOSAL_WORKER_API_TOKEN`; card-news/blog/reel/image authenticate only with `WORKER_API_TOKEN`. The API stores server receipt time and explicit Phase 2 worker type, rejecting token/kind/ID/boot drift; content-proposal may no longer report as DM. Each client sends 30-second `running` heartbeats and one best-effort `stopping` heartbeat. Readiness/observer accept only `state=running`, expected manifest kind/container/boot identity, and a receipt after that container's recorded start; an old container's fresh `stopping` event can never satisfy a replacement. Fake-clock/client tests cover old-shutdown/new-start without starting a process or model.

Register `POST /internal/canary/ai-content/failure-probes` only in full canary mode and on loopback. The global customer-session preHandler skips authentication for this exact route only after runtime config proves full canary mode; the route itself then requires `AI_CONTENT_CANARY_SECRET`. Ordinary API returns 404 and no other `/internal/canary/*` path is exempt. It accepts the designated brand, an exact `cutover-canary:<cutoverId>:<canaryAttemptId>:` operation key, an already prepared Proposal V2 selection command, and expected format/purpose. In one transaction it calls the same selection/start services, verifies the normal reservation, locks the exact resulting first planner job by generation ID, leases only that job to fixed worker ID `ai-content-cutover-failure`, and returns the lease once. It contains no alternate generation or settlement implementation. The driver then calls the existing `/worker/ai-content-jobs/:jobId/fail` with `retryable:false` and `canary_forced_permanent_failure`, so terminal state/reversal still traverse the production `failAiContentJob()` path. Tests require ordinary-API 404, non-loopback/secret/session-hook mistakes, wrong brand/topic/attempt/prefix zero writes, no normal-worker race, one reversal under replay/concurrency, refusal after any successful output, same retry child on exact replay, and an expected 409 only for changed fingerprint.

- [ ] **Step 2: Prove RED without starting a worker, browser, or model**

```powershell
npm test --workspace @brand-pilot/api -- src/aiContentCanaryPolicy.test.ts src/runtimeConfig.test.ts src/automatedCardNews.test.ts src/performanceProposalAdapter.test.ts src/performanceInsights.test.ts src/aiContentProposalV2Service.test.ts src/aiContentProposalV2Repository.pglite.test.ts src/repository.test.ts src/server.aiContentCanary.test.ts src/server.aiContentWorker.test.ts src/server.performanceInsightsCustomer.test.ts
npm test --workspace @brand-pilot/content-proposal-worker -- src/client.test.ts src/worker.test.ts
npm test --workspace @brand-pilot/card-news-worker -- src/client.test.ts src/productionRuntime.test.ts
npm test --workspace @brand-pilot/blog-worker -- src/client.test.ts src/productionRuntime.test.ts
npm test --workspace @brand-pilot/reel-worker -- src/client.test.ts src/productionRuntime.test.ts
npm test --workspace @brand-pilot/image-worker -- src/aiContentRenderClient.test.ts src/productionRuntime.test.ts
node --test scripts/ai-content-production-canary.test.mjs scripts/ai-content-production-observer.test.mjs scripts/run-ai-content-ci.test.mjs
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/deployment-contract.test.mjs
npx --no-install playwright test --config apps/customer-ui/playwright.production.config.ts apps/customer-ui/e2e/ai-content-cutover.production.spec.ts --list
```

Expected: the strict phase/scope/session/heartbeat drivers and production spec/registry entries do not yet exist. `--list` only loads the spec; it opens no browser or network.

- [ ] **Step 3: Add the private replica and evidence-only drivers**

`api-content-canary` uses the candidate API image and production database/queue, profile `ai-content-canary`, ordinary API env plus a mode-`0600` canary env, local bind `127.0.0.1:${AI_CONTENT_CANARY_PORT:-4400}:4000`, `restart: "no"`, and no Caddy label/domain/public network/external cron. Preflight rejects the profile on ordinary rollout and rejects starting it without the exact phase allowlist. `ai-content-production-canary.sh` is the only operator entry point; it reads secrets/IDs from prepared mode-`0600` state, never accepts them as CLI values, and exposes only `--start-replica`, `--run-studio-matrix`, `--run-migrated-writers`, `--run-controlled-failure`, `--observe`, and `--stop-replica`.

Reuse the managed `CANARY_SESSION_COOKIE`/`CANARY_BRAND_ID` already supplied by serialized CI/CD. The workflow rotates/refreshes the session if needed, writes it as root-owned mode-`0600` `CANARY_SESSION_COOKIE_FILE`, and requires `CANARY_BRAND_ID == AI_CONTENT_CANARY_BRAND_ID`. Before any mutation, the bootstrap driver sends that cookie to an authenticated session/brand read and proves the live session's user can access the exact brand, approved product, and three completed experiments. Missing/expired/wrong-brand access aborts with zero writes. The cookie is never logged, hashed into general evidence, embedded in release metadata, or passed on a CLI. For the real production page only, create an ephemeral mode-`0600` Playwright `storageState` with the `bp_session` cookie/domain/security attributes, then delete it after the mapping test.

The Node driver calls normal customer/cron/worker HTTP boundaries, records correlation/operation IDs, hashes secrets instead of storing them, and uses no SQL mutation. All customer/cron/internal mutations target the loopback replica; real format/image workers consume the shared queue only through their normal authenticated worker boundaries. The production Playwright spec visits only `/ai-content/new` with the real authenticated page, installs `page.route` before interaction, captures and aborts/fulfills every proposal POST for all six cells, and asserts zero proposal/batch/job/generation/usage deltas before/after. It proves independent `outputFormat`/`purpose` mapping and touches no other page/worker/domain. The observer is read-only: authenticated health/read APIs, read-only SQL, Docker state/digests, and content-service logs only. Every evidence file is exclusive-created; `/opt/brand-pilot/state/cutovers/<cutover-id>/canary` is `0700`, in-progress files `0600`, sealed evidence `0400`, and `SHA256SUMS` covers all non-secret outputs.

Extend `run-ai-content-ci.mjs` and its registry test in this task with the exact Task 2B unit commands and a safe static `playwright ... --list` entry for the production spec. The focused CI never executes the production E2E or a live canary, but it must recognize every Task 2B changed test/E2E path so the final candidate cannot reject its own content-only test files.

- [ ] **Step 4: Run focused GREEN and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/aiContentCanaryPolicy.test.ts src/runtimeConfig.test.ts src/automatedCardNews.test.ts src/performanceProposalAdapter.test.ts src/performanceInsights.test.ts src/aiContentProposalV2Service.test.ts src/aiContentProposalV2Repository.pglite.test.ts src/repository.test.ts src/server.aiContentCanary.test.ts src/server.aiContentWorker.test.ts src/server.performanceInsightsCustomer.test.ts
npm test --workspace @brand-pilot/content-proposal-worker -- src/client.test.ts src/worker.test.ts
npm test --workspace @brand-pilot/card-news-worker -- src/client.test.ts src/productionRuntime.test.ts
npm test --workspace @brand-pilot/blog-worker -- src/client.test.ts src/productionRuntime.test.ts
npm test --workspace @brand-pilot/reel-worker -- src/client.test.ts src/productionRuntime.test.ts
npm test --workspace @brand-pilot/image-worker -- src/aiContentRenderClient.test.ts src/productionRuntime.test.ts
node --test scripts/ai-content-production-canary.test.mjs scripts/ai-content-production-observer.test.mjs scripts/run-ai-content-ci.test.mjs
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/deployment-contract.test.mjs
npx --no-install playwright test --config apps/customer-ui/playwright.production.config.ts apps/customer-ui/e2e/ai-content-cutover.production.spec.ts --list
git add apps/api/src/aiContentCanaryPolicy.ts apps/api/src/aiContentCanaryPolicy.test.ts apps/api/src/runtimeConfig.ts apps/api/src/runtimeConfig.test.ts apps/api/src/automatedCardNews.ts apps/api/src/automatedCardNews.test.ts apps/api/src/performanceProposalAdapter.ts apps/api/src/performanceProposalAdapter.test.ts apps/api/src/performanceInsights.ts apps/api/src/performanceInsights.test.ts apps/api/src/aiContentProposalV2Service.ts apps/api/src/aiContentProposalV2Service.test.ts apps/api/src/aiContentProposalV2Repository.pglite.test.ts apps/api/src/repository.ts apps/api/src/repository.test.ts apps/api/src/httpServer.ts apps/api/src/types.ts apps/api/src/server.aiContentCanary.test.ts apps/api/src/server.aiContentWorker.test.ts apps/api/src/server.performanceInsightsCustomer.test.ts workers/brand-pilot-content-proposal-worker/src/client.ts workers/brand-pilot-content-proposal-worker/src/client.test.ts workers/brand-pilot-content-proposal-worker/src/worker.test.ts workers/brand-pilot-card-news-worker/src/client.ts workers/brand-pilot-card-news-worker/src/client.test.ts workers/brand-pilot-card-news-worker/src/index.ts workers/brand-pilot-card-news-worker/src/productionRuntime.test.ts workers/brand-pilot-blog-worker/src/client.ts workers/brand-pilot-blog-worker/src/client.test.ts workers/brand-pilot-blog-worker/src/index.ts workers/brand-pilot-blog-worker/src/productionRuntime.test.ts workers/brand-pilot-reel-worker/src/client.ts workers/brand-pilot-reel-worker/src/client.test.ts workers/brand-pilot-reel-worker/src/index.ts workers/brand-pilot-reel-worker/src/productionRuntime.test.ts workers/brand-pilot-image-worker/src/aiContentRenderClient.ts workers/brand-pilot-image-worker/src/aiContentRenderClient.test.ts workers/brand-pilot-image-worker/src/index.ts workers/brand-pilot-image-worker/src/productionRuntime.test.ts scripts/ai-content-production-canary.mjs scripts/ai-content-production-canary.test.mjs scripts/ai-content-production-observer.mjs scripts/ai-content-production-observer.test.mjs deploy/scripts/ai-content-production-canary.sh deploy/compose.production.yml deploy/env/api-content-canary.env.example deploy/env/api.env.example deploy/release.env.example deploy/scripts/preflight.sh deploy/scripts/lib.sh apps/customer-ui/playwright.production.config.ts apps/customer-ui/e2e/ai-content-cutover.production.spec.ts scripts/run-ai-content-ci.mjs scripts/run-ai-content-ci.test.mjs scripts/deployment-contract.test.mjs
git commit -m "test(content): add isolated production canary control plane"
```

## Task 3: Add a temporary, read-only legacy manifest converter

**Files:**

- Create: `scripts/convert-legacy-release-manifest.mjs`
- Create: `scripts/convert-legacy-release-manifest.test.mjs`
- Modify: `scripts/deployment-contract.test.mjs`

- [ ] **Step 1: Write RED schema-1/2 retirement tests**

The converter is the only code allowed to read release schema 1/2. It accepts no candidate reel/API/UI/source/changed-set/migration/catalog/preflight/final-release input. It emits only a candidate-free schema-3 baseline containing byte-identical unrelated component/static values plus a separate `marketing-worker-1` retirement record; the baseline deliberately leaves every changed candidate field for the strict assembler and exposes no start/recreate command for the legacy image.

It is a release-coordinator build-time tool only. Tests cover every schema-1/2 input shape, reject candidate fields, and pass its baseline/retirement outputs through `assemble-release-manifest.mjs`, which alone supplies and verifies all changed artifacts and final identity. Deployment tests must prove no Dockerfile copies it, no `release_file_specs` entry stages it, and no host/runtime bundle contains it. The serialized coordinator invokes it before calculating the immutable candidate bundle checksum; only the assembler-produced schema-3 `release.env` and non-executable retirement JSON enter the bundle.

- [ ] **Step 2: Prove RED**

```powershell
node --test scripts/convert-legacy-release-manifest.test.mjs
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/deployment-contract.test.mjs
```

Expected: the one-time read-only converter and its non-staging/retirement guarantees do not yet exist.

- [ ] **Step 3: Implement and run GREEN**

```powershell
node --test scripts/convert-legacy-release-manifest.test.mjs
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/deployment-contract.test.mjs
git add scripts/convert-legacy-release-manifest.mjs scripts/convert-legacy-release-manifest.test.mjs scripts/deployment-contract.test.mjs
git commit -m "feat(deploy): add one-time marketing retirement reader"
```

## Task 4: Pin migration/evidence tooling into the API image

**Files:**

- Modify: `apps/api/Dockerfile`
- Modify: `workers/brand-pilot-content-proposal-worker/Dockerfile`
- Modify: `scripts/deployment-contract.test.mjs`

- [ ] **Step 1: Write RED image-content tests**

Require the production API image to contain `db/migrations`, migration runner/CLI, cutover evidence/catalog scripts, production canary/observer drivers, the executable storage-cleanup outbox repository/processor/internal route from Phase 2, and the canonical generated catalog. Require the content-proposal-worker image to contain the crash-safe preflight entry point, production invocation builder, canonical Proposal V2 schema/parser, and no card/blog/reel preflight mode. Both image labels/source SHAs and release manifest must agree. A container-level fake-child permission fixture inspects the image's `node` UID:GID, mounts a disposable Codex home at `/codex` and invocation directory at the exact `/app/artifacts/ai-content-cutover/075_ai_content_three_format_cutover/proposal-v2-preflight` target, runs as the image's non-root user, and proves journal fsync/write/final root sealing without a model/network call.

- [ ] **Step 2: Prove RED**

```powershell
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/deployment-contract.test.mjs
```

Expected: one or both images omit required immutable cutover/preflight files or labels.

- [ ] **Step 3: Update the Dockerfile and verify only the two content-cutover images**

```powershell
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/deployment-contract.test.mjs
docker build -f apps/api/Dockerfile -t brand-pilot-api:three-format-cutover .
docker run --rm --entrypoint sh brand-pilot-api:three-format-cutover -c "test -f /app/db/migrations/075_ai_content_three_format_cutover.sql && test -f /app/packages/brand-pilot-content-contracts/generated/content-catalog.json"
docker build -f workers/brand-pilot-content-proposal-worker/Dockerfile -t brand-pilot-content-proposal-worker:three-format-cutover .
docker run --rm --entrypoint sh brand-pilot-content-proposal-worker:three-format-cutover -c "test -f /app/scripts/ai-content-proposal-schema-preflight.mjs && test -f /app/packages/brand-pilot-content-contracts/generated/content-proposal-v2.schema.json"
git add apps/api/Dockerfile workers/brand-pilot-content-proposal-worker/Dockerfile scripts/deployment-contract.test.mjs
git commit -m "build(api): pin cutover migrator in runtime image"
```

## Task 5: Enforce the irreversible database rollback floor

**Files:**

- Create: `deploy/scripts/ai-content-cutover.sh`
- Create: `deploy/scripts/verify-ai-content-cutover.sh`
- Modify: `deploy/scripts/lib.sh`
- Modify: `deploy/scripts/deploy.sh`
- Modify: `deploy/scripts/promote.sh`
- Modify: `deploy/scripts/rollback.sh`
- Modify: `deploy/scripts/rollout-workers.sh`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `deploy/scripts/backup-state.sh`
- Modify: `deploy/scripts/restore-state.sh`
- Create: `scripts/ai-content-database-roles.mjs`
- Create: `scripts/ai-content-database-roles.test.mjs`
- Modify: `scripts/customer-ui-promotion.mjs`
- Modify: `scripts/customer-ui-promotion.test.mjs`
- Create: `deploy/env/ai-content-cutover-roles.env.example`
- Modify: `deploy/env/api.env.example`
- Modify: `deploy/compose.production.yml`
- Modify: `../.github/workflows/publish-brand-pilot-server-images.yml`
- Modify: `scripts/deployment-contract.test.mjs`

- [ ] **Step 1: Write RED marker/recovery failure-injection tests**

Inject failure before/after database-role bootstrap/catalog seal, API credential switch, prepared-row insert, maintenance enable, F maintenance verification, candidate control-plane activation, migration SQL plus atomic marker/status commit, API replacement, content-worker startup, final-C maintenance verification, initial and adoption-scoped Vercel promotion intent/request/pending resolution/domain switch/evidence, descendant adoption, current-pointer finalization, cleanup-credential revocation, and write opening. Before the marker, only the candidate script may perform an explicit `--abort-pre-marker`: it transitions the DB row to `abandoned_pre_marker`, preserves evidence, and may restore the recorded fence pointer/runtime after proving marker absence. After the marker, maintenance stays enabled, old API/marketing worker/schema-2 UI are never restored by normal tooling, and commands report `ai_content_cutover_roll_forward_only`.

- [ ] **Step 2: Prove RED**

```powershell
node --test scripts/ai-content-database-roles.test.mjs scripts/customer-ui-promotion.test.mjs
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/deployment-contract.test.mjs scripts/incremental-cicd-contract.test.mjs
```

Expected: marker-aware cutover/recovery modes and their crash-state fixtures do not yet exist.

- [ ] **Step 3: Implement database-authoritative recovery helpers**

Implement `ai_content_cutover_marker_present` and `enforce_ai_content_roll_forward_floor` in `deploy/scripts/lib.sh`. The first validates ownership/mode of the operator database-URL file, runs a fail-on-SQL-error scalar query for exactly `075_ai_content_three_format_cutover.sql`, and returns distinct present/absent/query-error statuses without logging the URL. Every host state file carries immutable `cutover_id`; the second looks up that exact row/status and separately asserts zero-or-one in-progress row. Marker absent permits only `prepared|maintenance_verified|abandoned_pre_marker`; marker present permits `migration_body_complete|backend_verified|completed`. A referenced completed row with zero active rows is valid. Any impossible pair fails before mutation. Do not source `api.env`. Every recovery-capable entry point, cleanup-release guard, and `reconcile_transition` calls this exact-ID guard before Docker/Vercel/current-pointer mutation; marker-present rollback exits before previous API/worker recreation.

`ai-content-database-roles.mjs` is a provider-admin-only, model-incapable bootstrap/audit tool. It creates or verifies one no-login schema owner and distinct restricted app/operator/migration/cleanup logins, transfers/validates ownership and grants for the exact database catalog, proves all ten role pairs distinct, writes no plaintext credential to evidence, and emits a canonical role/grant/owner SHA-256. It supports `--plan`, `--apply`, `--verify`, exact Ed25519-signed `--activate-migration-membership`/`--revoke-migration-membership`, `--install-074-enforcement-bundle`/`--verify-074-enforcement-bundle`, `--retire-cleanup-login`, and marker-absent `--restore-pre-bootstrap` from an exclusive checksummed grant snapshot. The Supabase platform-`postgres` enforcement modes validate the same unused authorization, image, migration, role-catalog, interim-security-catalog, final fixed bundle manifest, ACL, function-body, definition, and object-name hashes; in one transaction they may transfer/lock only the approved guard/control functions and control tables to `postgres`, fix their exact ACLs, and create/enable/verify only the approved `074` event trigger. They must prove the complete final provider-owned security catalog and expose no arbitrary SQL or other provider-admin action. Marker-absent recovery may revert only the exact partially installed bundle matching that authorization and interim catalog. Only the provider-admin workflow can grant/revoke the migration login's one schema-owner membership, perform that closed enforcement-bundle operation, or retire/terminate cleanup; the database operator cannot. The serialized workflow alone holds separate Ed25519 private keys for authorization and provider attestation. Release/runner images receive only pinned read-only public-key files and expected key IDs/fingerprints; no private key is staged in a release, container, host runner state, log, or evidence. The serialized workflow writes app/operator/migration/cleanup URLs to separate root-owned mode-`0600` files. Production API receives only the restricted app URL as `SUPABASE_DATABASE_URL`; candidate API additionally sees the cleanup URL, distinct cleanup token, and immutable cutover ID through read-only Docker secrets at `/run/secrets/ai_content_cleanup_database_url`, `/run/secrets/ai_content_cleanup_token`, and `/run/secrets/ai_content_cutover_id`, named by `AI_CONTENT_CUTOVER_CLEANUP_DATABASE_URL_FILE`, `AI_CONTENT_CUTOVER_CLEANUP_TOKEN_FILE`, and `AI_CONTENT_CUTOVER_ID_FILE`. Their hashes/ID are bound to the prepared row. Preflight/runtime tests require the API's non-root UID can read exactly those mounts and cannot print them. Cutover scripts read operator/migration files directly. The provider-admin URL and both signing private keys are never staged into a release/container.

Before `074`, recreate every API instance onto the app login, verify live `current_user`/session inventory from each instance, remove the previous privileged URL from runtime env, and terminate its old API sessions. If the old credential is dedicated, rotate/revoke it; if it is shared and safe rotation cannot be proven, stop for user review rather than guessing. Tests exercise real connections for every role: app cannot own/alter/state-tamper, operator can only transition, migration can perform only the exact signed `074` authorization or the exact token-bound `075` cutover, cleanup can only invoke cleanup transitions, and schema owner cannot log in. Marker-absent bootstrap failure restores the exact grant/credential snapshot before any `074`; once `074` is applied, the restricted role layout remains the recovery floor.

- [ ] **Step 4: Implement fail-closed cutover orchestration**

`--run-proposal-preflight` is the only model-capable cutover mode. It resolves the exact proposal-worker image digest/source label and precommitted `PREFLIGHT_CANDIDATE_SHA` identity from schema 3. Before the call it inspects and verifies the image's fixed non-root `node` UID:GID; creates a private runtime Codex-home copy and only the invocation subdirectory with that UID:GID and mode `0700`; bind-mounts them exactly at `/codex` and `/app/artifacts/ai-content-cutover/075_ai_content_three_format_cutover/proposal-v2-preflight`; sets `CODEX_HOME=/codex`; and runs the Phase 4 entry point as that non-root UID with no other writable mount. A root-owned parent remains non-readable to other users. The preflight refuses an existing claim; an indeterminate claim blocks the candidate and requires user direction rather than deletion/retry. After exit it fsyncs files/directories, verifies no secret entered transcripts/evidence, chowns the completed evidence tree to root, and seals it mode `0400`; the temporary Codex-home copy is removed and never included in checksums. A permission failure before `claim.json` is provably zero-call/unclaimed; any failure after claim follows the crash-safe state rules. On `passed`, it seals `phase5-transfer.json` and records no content/DB row.

Pre-marker role/fence modes are model-incapable. `--switch-fence-api-app-role` verifies the provider-admin role attestation and recreates only currently running/F API instances on the restricted app URL. `--apply-fence-074` requires the one Ed25519-signed authorization plus pinned authorization/provider public-key files and performs the exact UID-readable secret mounts/network/image command in Task 8; the runner applies the interim schema-owner-owned `074` objects and emits the sealed provider install request. The serialized provider-admin workflow then performs exact `--install-074-enforcement-bundle` and `--verify-074-enforcement-bundle`; `--apply-fence-074` consumes the separately Ed25519-signed attestation, independently verifies the full live provider-owned enforcement catalog read-only, and only then seals the complete `074` result and requests membership revocation. It cannot sign or mint either envelope, cannot see/run `075`, and `075` is ineligible while any stage/evidence is missing or mismatched. `--prepare-open-writes` later drains every cleanup pool, removes all three API cutover secret mounts, recreates APIs, and produces the host half of cleanup-retirement evidence without database-role admin authority.

`--prepare` is model-incapable and has no Vercel token/network client. Immediately beforehand, the serialized Production workflow runs `customer-ui-deployment-evidence.mjs --revalidate-staged` with Vercel secrets and proves the staged deployment is still `READY`, Production-targeted, unaliased, and exact while the production domain still resolves to the recorded previous deployment. It seals a short-lived checksummed attestation and securely copies only that artifact to host prepared state. `--prepare` requires its age to be at most five minutes and validates it with the schema-3 manifest, retirement record, provider snapshot freshness/ID, incident and preserved hashes, exact passed preflight hash chain/transfer/identity, candidate/running SHA/image/migration evidence, all five pairwise-distinct role identities, live `session_user/current_user` probes, exact role/grant/owner catalog hash, separate migration/cleanup token digests, and every API instance on fence SHA/app login. Stale/early promotion fails. It records all of those values with the transfer SHA and initial evidence hash in the one `prepared` DB row/event and proves host evidence = release identity = prepared DB row. It does not claim maintenance is enabled or tested.

`--enable-maintenance` requires the prepared row, disables content autoscaling/old-image restart first, enables DB maintenance for that cutover, and changes no cutover status. `--verify-maintenance` runs the F-compatible HTTP mutation and direct stale-process DB probes, compares before/after counts, seals the evidence, and atomically transitions `prepared → maintenance_verified`. `--execute-migration` refuses a missing/invalid verification seal or any status other than `maintenance_verified`; `--execute-runtime` refuses until the exact marker/status and provider-admin migration-retirement attestation exist. After C is live, `--verify-final-maintenance` exercises every C customer-execution mutation boundary—including Proposal V2 manual/performance/scheduled create, select, start, retry/regenerate, topic upload/scheduler, and worker completion/failure—plus direct app-role writes against every final `075` customer-execution relation. It requires maintenance rejection (or the route's stricter disabled/404 result before repository access), zero DB/queue/blob/model/external delta, exact ENABLE ALWAYS catalog coverage, and seals `final-maintenance-verified`; storage cleanup's narrowly authorized endpoint is tested separately and remains usable. UI confirmation and `--open-writes` refuse without this post-C seal.

After content claims drain, `--activate-cutover-control` writes a separate sealed `control-release-sha=C` transition pointer and an active-cutover registry bound to the exact `cutover_id`; it does not repurpose `/opt/brand-pilot/state/current`, which remains F while F is still the running runtime. Before the marker it inventories every `/opt/brand-pilot/releases/*`, rollback manifest, cached launch descriptor, and referenced image. Any schema-1/2 or marketing-capable bundle is removed from normal discovery. F's complete pre-marker restoration unit is packed as one checksum-bound opaque, non-launchable archive under candidate-controlled state; all loose Compose/env/manifest/script files are removed, so even root cannot point Docker Compose at a quarantine descriptor. Older legacy bundles are sealed as evidence or removed and are never eligible for restore; the separately approved provider-snapshot DR unit remains offline/outside host release discovery. All normal deploy/reconcile entry points detect the active registry and stop or delegate only to C's marker-aware control script. Tests attempt every old wrapper, direct script, rollback manifest, and `docker compose -f` path for every inventoried release and prove descriptor resolution fails before Docker/Vercel/DB mutation.

If and only if the marker remains absent, `--abort-pre-marker` may use C's guarded code to verify/unpack the exact F restoration archive, transition the row to `abandoned_pre_marker`, atomically restore F's complete bundle/modes, tombstone the active registry/control pointer, verify normal deployment tooling works again under the restricted app role, and re-open writes; `/opt/brand-pilot/state/current` stays F throughout. It never restores any older legacy release and never deletes the abandoned row/evidence. After C's backend is actually verified, `--execute-runtime` atomically advances `state/current` to C before it seals DB status `backend_verified`; crash recovery handles either intermediate pair by marker, running digests, control pointer, and status.

`--execute-migration` confirms C is the active control release and every legacy launch bundle is non-launchable, stops/drains only content workers, arms cutover ID/token digest, and invokes migration `075` from the pinned API image. Migration `075` atomically writes its marker and transitions `maintenance_verified → migration_body_complete`; the runner immediately queries both and returns without starting customer runtime. Once the marker is durable, normal recovery can never use the F archive: delete its host restoration archive, remove the exact retired legacy image digests after proving no running container references them, and retain only checksums plus the separately offline provider-snapshot DR unit.

The serialized provider-admin workflow then revokes migration→owner membership, closes/terminates migration-role sessions, removes the migration URL/bypass-token files, rotates the credential/sets `NOLOGIN`, and transfers a fresh checksummed zero-membership/zero-session attestation. `--execute-runtime` consumes that attestation, verifies catalog/hashes/zero old runnable jobs, explicitly stops/removes marketing, replaces only the API, starts proposal/card-news/blog/reel/image workers from desired schema 3, and verifies them. Once running digests and `state=running` post-container-start heartbeats match C, it advances `/opt/brand-pilot/state/current` from F to C with fsync/rename, then atomically transitions `migration_body_complete → backend_verified`; either half-completed pair is recoverable/idempotent and cannot open writes. It writes `backend_ready_for_customer_ui` and returns with maintenance still enabled. Neither mode calls Vercel or claims the UI is live.

`--drain-storage-cleanup` reads the immutable cutover ID and root-owned cron/cleanup-token files from prepared state, verifies the dedicated cleanup pool reports the exact sealed cleanup role/current cutover, then repeatedly calls `POST /internal/cron/ai-content-cutover-storage-gc` through the local API with a bounded batch and timeout. It stops successfully only when every unprotected cutover-outbox/attachment row is `deleted`, every protected row is `retained_reference`, and the endpoint reports `done=true`. Any `failed|dead_letter`, active lease past timeout, retained-path checksum conflict, non-2xx response, role/token/status mismatch, or residual pending row fails closed with maintenance still enabled. It never discovers an active row, accepts a hand-entered cutover ID, or prints a secret.

The serialized workflow runs `customer-ui-promotion.mjs` against the staged-production URL as a durable idempotent state machine. Before any provider submission it exclusive-creates and fsyncs the initial intent under the exact cutover's root-owned `promotions/initial/` state via the serialized SSH handoff, then reads back/verifies its checksum; the record binds cutover/effective release/deployment/project/team/previous-domain identity and attempt `1`. It also uploads the same checksum as an immutable workflow artifact. After submission it append-writes provider correlation/status events to that host chain. On every run it reads this durable intent and queries Vercel Current/pending/status first: an exact in-flight request is polled to terminal and never resubmitted; exact Current plus matching production `/release.json` seals the summary; absence of intent plus no matching pending/current permits the one initial submit. Existing intent with no safely correlatable pending/current state is indeterminate and stops—never resubmits. A terminal failure or another deployment's pending/Current state also blocks for review; timeout never means cancellation. Tests crash before/after durable intent write, after request acceptance while pending, before provider-correlation write, pending-to-success, terminal failure, another deployment pending, after domain switch, and before evidence, and assert submit count at most one. It copies only the checksummed promotion summary—not tokens/raw response—into prepared state. `--confirm-customer-ui` verifies the production domain resolves to the exact manifest deployment ID and `/release.json` matches source SHA/catalog/V3/`075`; a rebuilt/different ID fails closed.

`--begin-adoption` is the only way to reserve a post-marker release-substitution sequence. From the currently effective release, it verifies a signed reviewed descendant D's exact cutover ID, parent/descendant ancestry, source-only provenance/classifier output, reason, and caller UUID, then exclusive-creates the append-only in-progress Phase 2 row/sequence and matching root-owned host directory. It performs no runtime, pointer, Vercel, or model action. Exact replay returns the same sequence; a different request conflicts; a second in-progress request blocks. `--adopt-descendant` resumes only that sequence and requires the final manifest/API/content/UI evidence plus byte-identical preflight dimensions/transfer when retaining `PREFLIGHT_CANDIDATE_SHA`. It serializes staged-UI verification when UI changed or a fresh descendant-`RELEASE_SHA`/adoption-sequence-bound `current_reuse` attestation when UI is unchanged, then the required runtime/host rollout. Task 11's cleanup release is one unchanged-UI consumer, not a special contract. For changed UI, the serialized workflow uses a distinct root-owned `adoptions/<sequence>/customer-ui-promotion-intent.json` bound exactly to `(cutoverId, adoptionSequence, deploymentId, projectId, teamId, parentCurrentDeploymentId)`. It verifies that intent on host before submission, queries provider Current/pending/status first on every run, submits at most once for that adoption, polls an exact in-flight request, and seals the same deployment ID's Current plus production `/release.json`; the initial intent or another adoption's intent/evidence can never satisfy it. The host state machine consumes that sealed summary before control/current-pointer change and adoption completion. Unchanged UI requires byte-identical deployment/source identity, consumes `current_reuse`, and makes zero promotion submission. A provably pre-rollout request with invalid/unobtainable evidence may only append `abandoned_before_rollout`; its sequence can never be reused. Crash recovery resumes the same adoption/intent and cannot create a second event or provider request. Tests cover multiple adoption sequences before/after `completed`, crashes at every begin/attestation/intent/submit/pending/Current/handoff/pointer boundary, initial-intent mismatch, another deployment Current, and exact submit count `0` for reuse or at most `1` for changed UI. A changed proposal-worker/schema/catalog/model/command or a second schema-preflight need stops for explicit user direction. `--confirm-customer-ui`, `--open-writes`, completed-cutover guards, and Task 11 use the latest completed adoption for that exact cutover rather than mutating the original intended release row.

`--open-writes` is the only mode that disables maintenance. The effective release is immutable base C when there is no adoption, otherwise the latest completed adoption; tests cover base-only and multiple descendant sequences. It requires marker, exact-ID DB status `backend_verified`, effective release/current/control identity, all-legacy retirement evidence, backend-ready, `final-maintenance-verified`, cleanup-complete, exact UI-confirmed, five expected `state=running` heartbeats newer than container starts, and zero failure rows. Host orchestration commands every API replica to drain/close the cleanup pool, removes all three cutover Docker-secret mounts, and recreates/verifies replicas cannot reopen it. The serialized provider-admin workflow—not the host/operator role—then revokes/rotates the cleanup login, terminates/proves zero cleanup-role backends, and transfers a fresh checksummed attestation. `--open-writes` verifies/consumes that attestation and in one database transaction records its evidence, disables maintenance, and transitions `backend_verified → completed`. If a crash occurs after this DB commit, rerun accepts the exact consistent completed row/attestation, reconstructs/seals missing host completion evidence, tombstones the active-cutover registry/control pointer into immutable completed history, and enables normal deployment only for schema-3/`075` descendants; it never reruns the transition or revives cleanup credentials. Tests cover every pool-drain/secret-removal/session-termination/attestation/DB-commit/host-finalization boundary and forbid completed+maintenance-on, writes-open+noncompleted, a live cleanup login/backend/secret, or a lingering active registry. After `075`, rollback/promotion scripts refuse the pre-cutover UI; only the effective completed reviewed descendant or already adopted V3/`075` UI is eligible.

The only exception is a separately documented provider-snapshot disaster-recovery procedure for confirmed data corruption: explicit user/operator approval, full application/worker/UI downtime, restoration of the pre-cutover database snapshot and its exact pinned offline DR bundle together, and marker-absence/schema verification before any service starts. Pre-cutover code is removed from normal release discovery and kept non-executable/offline; it is never an automated rollback, never mixed with the post-marker database, and cannot be activated by these cutover modes.

Extend the existing release `release_file_specs` so `deploy/scripts/ai-content-cutover.sh`, `deploy/scripts/verify-ai-content-cutover.sh`, and `deploy/scripts/ai-content-production-canary.sh` are installed into the flat immutable bundle as `$release_dir/scripts/<name>`, with expected owner/mode/checksum in release integrity. Include the model-incapable customer-UI promotion/evidence utilities in the workflow artifact only, not the host bundle. Tests fail when a staged host script is missing/stale/nested incorrectly, or when the preflight model-capable module is reachable from any cutover mode except `--run-proposal-preflight`.

- [ ] **Step 5: Run GREEN and commit**

```powershell
node --test scripts/ai-content-database-roles.test.mjs scripts/customer-ui-promotion.test.mjs
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/deployment-contract.test.mjs scripts/incremental-cicd-contract.test.mjs
git add deploy/scripts/ai-content-cutover.sh deploy/scripts/verify-ai-content-cutover.sh deploy/scripts/lib.sh deploy/scripts/deploy.sh deploy/scripts/promote.sh deploy/scripts/rollback.sh deploy/scripts/rollout-workers.sh deploy/scripts/preflight.sh deploy/scripts/backup-state.sh deploy/scripts/restore-state.sh scripts/ai-content-database-roles.mjs scripts/ai-content-database-roles.test.mjs scripts/customer-ui-promotion.mjs scripts/customer-ui-promotion.test.mjs deploy/env/ai-content-cutover-roles.env.example deploy/env/api.env.example deploy/compose.production.yml ../.github/workflows/publish-brand-pilot-server-images.yml scripts/deployment-contract.test.mjs
git commit -m "feat(deploy): add forward-only AI content cutover"
```

Linux CI additionally runs:

```bash
shellcheck --exclude=SC1091,SC2016,SC2034,SC2317 deploy/scripts/ai-content-cutover.sh deploy/scripts/verify-ai-content-cutover.sh deploy/scripts/ai-content-production-canary.sh deploy/scripts/lib.sh deploy/scripts/deploy.sh deploy/scripts/promote.sh deploy/scripts/rollback.sh deploy/scripts/rollout-workers.sh deploy/scripts/preflight.sh deploy/scripts/backup-state.sh deploy/scripts/restore-state.sh
```

## Task 6: Add the operator runbook and exact evidence gates

**Files:**

- Create: `docs/operations/AI_CONTENT_THREE_FORMAT_CUTOVER.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/operations/UBUNTU_DEPLOYMENT.md`
- Modify: `docs/operations/DEVELOPMENT_AND_RELEASE_FLOW.md`
- Modify: `docs/prd/brand-pilot-feature-preservation-ledger.md`
- Modify: `docs/quality/d-hybrid-regression-matrix.md`
- Modify: `README.md`

- [ ] **Step 1: Document two immutable releases**

Release F is the recorded Phase 2 fence commit and contains migration `074` but not `075`. Release C is the final schema-3 candidate containing `075` and all evidence/cutover scripts. Follow the repository's real release layout: resolve `fence_sha="$(cat /opt/brand-pilot/state/current)"` and require F at `/opt/brand-pilot/releases/$fence_sha`; stage C under `/opt/brand-pilot/releases/$candidate_sha` without changing that pointer. The release coordinator writes the verified `candidate_sha` to root-owned `/opt/brand-pilot/state/cutovers/candidate-release-sha`; every cutover command resolves C from that file and verifies its manifest/integrity before execution. No `/opt/brand-pilot/current` symlink or ad-hoc checkout is introduced, and no cutover command is invoked from F's release directory.

- [ ] **Step 2: Document exact production commands using fail-closed state files**

```bash
candidate_sha="$(sudo cat /opt/brand-pilot/state/cutovers/candidate-release-sha)"
candidate_dir="/opt/brand-pilot/releases/$candidate_sha"

sudo "$candidate_dir/scripts/ai-content-cutover.sh" \
  --run-proposal-preflight \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers

# Serialized provider-admin workflow: bootstrap roles and seal redacted evidence.
node scripts/ai-content-database-roles.mjs --plan \
  --admin-url-file "$PROVIDER_ADMIN_DATABASE_URL_FILE" \
  --output role-bootstrap-plan.json
node scripts/ai-content-database-roles.mjs --apply \
  --admin-url-file "$PROVIDER_ADMIN_DATABASE_URL_FILE" \
  --plan role-bootstrap-plan.json \
  --secret-output-dir role-secrets \
  --evidence role-bootstrap-applied.json
node scripts/ai-content-database-roles.mjs --verify \
  --admin-url-file "$PROVIDER_ADMIN_DATABASE_URL_FILE" \
  --plan role-bootstrap-plan.json \
  --evidence role-bootstrap-verified.json

# After the four URL files/evidence are securely installed in host state:
sudo "$candidate_dir/scripts/ai-content-cutover.sh" \
  --switch-fence-api-app-role \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers

# Serialized workflow activates the one signed 074 owner-membership request.
node scripts/ai-content-database-roles.mjs --activate-migration-membership \
  --admin-url-file "$PROVIDER_ADMIN_DATABASE_URL_FILE" \
  --request 074-membership-request.json \
  --evidence 074-membership-active.json
sudo "$candidate_dir/scripts/ai-content-cutover.sh" \
  --apply-fence-074 \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers
node scripts/ai-content-database-roles.mjs --revoke-migration-membership \
  --admin-url-file "$PROVIDER_ADMIN_DATABASE_URL_FILE" \
  --request 074-membership-request.json \
  --evidence 074-membership-revoked.json

# Serialized Production workflow, with Vercel secrets; copy only the sealed output to host state.
node scripts/customer-ui-deployment-evidence.mjs \
  --revalidate-staged \
  --release-manifest release.env \
  --output customer-ui-staged-revalidation.json

sudo "$candidate_dir/scripts/ai-content-cutover.sh" \
  --prepare \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers

sudo "$candidate_dir/scripts/ai-content-cutover.sh" \
  --enable-maintenance \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers

sudo "$candidate_dir/scripts/ai-content-cutover.sh" \
  --verify-maintenance \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers

sudo "$candidate_dir/scripts/ai-content-cutover.sh" \
  --activate-cutover-control \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers

node scripts/ai-content-database-roles.mjs --activate-migration-membership \
  --admin-url-file "$PROVIDER_ADMIN_DATABASE_URL_FILE" \
  --request 075-membership-request.json \
  --evidence 075-membership-active.json
sudo "$candidate_dir/scripts/ai-content-cutover.sh" \
  --execute-migration \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers
node scripts/ai-content-database-roles.mjs --revoke-migration-membership \
  --admin-url-file "$PROVIDER_ADMIN_DATABASE_URL_FILE" \
  --request 075-membership-request.json \
  --retire-login \
  --evidence 075-migration-retired.json
sudo "$candidate_dir/scripts/ai-content-cutover.sh" \
  --execute-runtime \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers

sudo "$candidate_dir/scripts/ai-content-cutover.sh" \
  --verify-final-maintenance \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers

sudo "$candidate_dir/scripts/ai-content-cutover.sh" \
  --drain-storage-cleanup \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers

```

After the workflow receives `backend_ready_for_customer_ui` and `cleanup_complete`, its Production environment runs the model-incapable promotion tool with Vercel secrets, uploads a checksummed summary, and copies that summary to the prepared state without exposing the token:

```bash
node scripts/customer-ui-promotion.mjs \
  --promote \
  --release-manifest release.env \
  --evidence-file customer-ui-promotion.json
```

The host then resumes:

```bash
sudo "$candidate_dir/scripts/ai-content-cutover.sh" \
  --confirm-customer-ui \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers

sudo "$candidate_dir/scripts/ai-content-cutover.sh" \
  --prepare-open-writes \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers

# Serialized provider-admin workflow; transfer only its sealed attestation to host.
node scripts/ai-content-database-roles.mjs --retire-cleanup-login \
  --admin-url-file "$PROVIDER_ADMIN_DATABASE_URL_FILE" \
  --request cleanup-retirement-request.json \
  --evidence cleanup-retired.json

sudo "$candidate_dir/scripts/ai-content-cutover.sh" \
  --open-writes \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers

sudo "$candidate_dir/scripts/verify-ai-content-cutover.sh" \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers
```

Every command reads the same exact immutable `cutover_id` that `--prepare` sealed into the candidate manifest and root-owned state; no script discovers "the active cutover," selects the newest row, or accepts a pasted replacement ID. It looks up that exact DB row/status and separately asserts there is at most one in-progress row. `--run-proposal-preflight` is run once only after deterministic tests and immutable identity exist; if its state is anything except `passed`, no later command may delete/reset/reinvoke it. The runbook separately documents `--abort-pre-marker` for a marker-absent abandoned candidate and the provider-snapshot full-downtime DR exception; neither command appears in or is callable from the normal happy-path workflow.

If a reviewed forward fix D is required after the marker, stop this happy path and invoke `--begin-adoption` from the currently effective release with D's signed ancestry/source-provenance request. Use its sealed sequence to produce D's final checksummed manifest and adoption-scoped UI evidence, then invoke `--adopt-descendant` for that exact sequence. The mode re-proves ancestry, exact cutover ID, changed-component provenance, UI state, catalog/V3/`075`, and byte-identical preflight dimensions. If UI changed, the serialized workflow must complete that sequence's distinct durable promotion intent and return the exact same-deployment Current evidence; if unchanged, it must return a fresh `current_reuse` attestation with zero submission. Only then may the host write `effective-release-sha` and complete adoption. Resume after re-reading that sealed SHA, rebuilding `candidate_dir=/opt/brand-pilot/releases/<effective-sha>`, and re-running the current step's preconditions. No command keeps using C's directory after D becomes effective.

The provider-snapshot DR section is manual/operator-only and requires a declared data-corruption incident, explicit user approval recorded with the snapshot/bundle checksums, complete ingress/UI/API/worker shutdown, and restoration of the database snapshot plus its exact pinned pre-cutover offline bundle as one recovery unit. Before any service starts, verify the restored database has no `075` marker, its schema/catalog matches that bundle, and the normal post-cutover release directory remains inaccessible. A mixed old-runtime/post-marker-database state aborts. The offline bundle is never in `/opt/brand-pilot/releases`, normal rollback inventory, or executable mode; activation occurs only inside the documented full-downtime recovery procedure.

- [ ] **Step 3: Commit documentation**

```powershell
git add docs/operations/AI_CONTENT_THREE_FORMAT_CUTOVER.md docs/ARCHITECTURE.md docs/operations/UBUNTU_DEPLOYMENT.md docs/operations/DEVELOPMENT_AND_RELEASE_FLOW.md docs/prd/brand-pilot-feature-preservation-ledger.md docs/quality/d-hybrid-regression-matrix.md README.md
git commit -m "docs: add three-format content cutover runbook"
```

## Task 7: Reconcile today's intended source with the pinned candidate

**Files:** None; this is evidence collection.

- [ ] **Step 1: Freeze the intended commit inventory**

Fetch every configured remote/tag without pruning, then run the tested reconciliation tool with cutoff `2026-08-04T00:00:00+09:00`, the exact candidate source SHA, the checksum-verified current-production manifest, and every local/remote ref. Start with an empty exclusions document. This first seal is source-only: record the approved design commit, every discovered same-day commit, every Phase 1–5 implementation commit, merge/squash/cherry-pick equivalence, final source SHA, exact touched paths/hunks/semantic owners, expected changed-component set, catalog/migration source hashes, and current production component identities. Do not claim candidate UI/image digests before they are built. Compare every changed path against `release-impact` output; any changed component missing from the expected set blocks release.

The sealed inventory contains commit/ref/author-time/subject, exact touched paths/components, candidate-ancestor result, stable patch ID, before/after hunk hashes, final semantic-guard owners, resolution, and evidence checksum. If the tool finds an ambiguous, overwritten, reverted, partially retained, or apparently intentional omission, stop and ask the user to review that exact row. Only a separately checksummed user-approved exclusions file naming the commit, concrete reason, and optional `supersededBy` commit can resolve it; the implementing agent may not infer intent. Rerun and seal the inventory after approval. No image build, preflight call, migration, or deployment proceeds until every row is reconciled.

```bash
git fetch --all --tags
node scripts/reconcile-intended-commits.mjs \
  --cutoff "2026-08-04T00:00:00+09:00" \
  --candidate "$GITHUB_SHA" \
  --production-manifest "$CURRENT_RELEASE_MANIFEST" \
  --exclusions "$REVIEWED_COMMIT_EXCLUSIONS" \
  --output intended-commit-inventory.json
sha256sum intended-commit-inventory.json > intended-commit-inventory.json.sha256
```

- [ ] **Step 2: Verify CI did not omit or overwrite a component**

Only after the source inventory is sealed may the focused content CI build API/content images and stage the Production-targeted UI. Require workflow artifact provenance to show each affected image was built from the pinned source SHA and the content-cutover impact proof selected no DM/Wiki/FAQ/brand-intelligence/subject-analysis test job. Seal a second deployment-provenance supplement containing UI deployment evidence, registry labels/digests, per-component source/tree SHAs, migration/catalog hashes, and bundle checksum; bind it to the source-inventory checksum. Compare both seals against the candidate bundle. Before execution, migration `075` must exist in the pinned candidate image/bundle but must be absent from production `schema_migrations`; an already-present marker indicates an interrupted cutover and switches immediately to the roll-forward recovery path. An unreconciled/partially overwritten intended commit, changed component with stale SHA, altered unrelated component, missing image, stale candidate UI, missing candidate migration, stale marketing key, or unrelated-worker test selection blocks cutover. After Task 9 executes, the same reconciliation requires the production DB marker and running API/UI/container provenance to match schema 3.

- [ ] **Step 3: Produce the schema-3 candidate and retirement record**

Use the one-time converter in the serialized release-coordinator workspace only if the downloaded, checksum-verified current production manifest is schema 1/2. It emits only a schema-3 baseline containing byte-identical unrelated component/static values plus a separate stop/remove marketing retirement record; it does not choose or copy any candidate API/UI/content image, source SHA, changed flag, migration/catalog/preflight field, or final release SHA. Record the input checksum, converter commit, baseline checksum, and retirement checksum. Verify no converter source/entry point enters the staged host bundle.

The coordinator defines `CURRENT_RELEASE_MANIFEST`, `SCHEMA3_BASELINE_MANIFEST`, and `MARKETING_RETIREMENT_RECORD`, then runs exactly:

```bash
node scripts/convert-legacy-release-manifest.mjs \
  --input "$CURRENT_RELEASE_MANIFEST" \
  --baseline-output "$SCHEMA3_BASELINE_MANIFEST" \
  --retirement-output "$MARKETING_RETIREMENT_RECORD"

node scripts/assemble-release-manifest.mjs \
  --schema3-baseline "$SCHEMA3_BASELINE_MANIFEST" \
  --candidate-provenance deployment-provenance.json \
  --customer-ui-evidence customer-ui-deployment-evidence.json \
  --retirement-record "$MARKETING_RETIREMENT_RECORD" \
  --output release.env
```

Schema-3 input itself is the baseline and skips only the converter; every path always goes through the same strict assembler. The final initial candidate's changed set is exactly `customerUi|api|contentProposalWorker|cardNewsWorker|blogWorker|reelWorker|imageWorker`; all unrelated digests/source SHAs/flags/static values equal the downloaded production baseline byte-for-byte. Missing/duplicate/stale candidate artifacts, an old changed component, or a converter-produced candidate field fails. The converter never runs on the production host.

- [ ] **Step 4: Execute the approved schema-only Proposal V2 preflight exactly once**

After the candidate bundle, proposal-worker immutable digest/source label, staged UI evidence, catalog, Proposal V2 schema, worker tree, production proposal model, and sanitized command identity all match schema 3, stage C without promotion and run only:

```bash
candidate_sha="$(sudo cat /opt/brand-pilot/state/cutovers/candidate-release-sha)"
candidate_dir="/opt/brand-pilot/releases/$candidate_sha"
sudo "$candidate_dir/scripts/ai-content-cutover.sh" \
  --run-proposal-preflight \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers
```

This is the plan's single schema-only model invocation. It uses the production proposal-worker invocation builder/output schema in that exact immutable image but creates no content, database row, image, HTML, or video. Verify `phase5-transfer.json` has a valid append-only chain, exact precommitted identity, canonical parse projection, and completed call count `1`; record its SHA-256 for Phase 2's cutover row. Never rerun this command during later verification. A `claimed_incomplete`, `invocation_indeterminate`, corrupt, failed, or mismatched state stops the candidate and is reported to the user; no agent deletes evidence or spends a second model call. Later production generation canaries are separately authorized content calls and do not change this schema-preflight counter.

## Task 8: Bootstrap database roles, deploy, and prove the compatibility fence

**Files:** None; production operation using Task 6 scripts.

- [ ] **Step 0: Bootstrap roles and move every API onto the restricted app login**

From the serialized provider-admin workflow workspace, with the admin URL supplied only as a protected file, run:

```bash
node scripts/ai-content-database-roles.mjs --plan \
  --admin-url-file "$PROVIDER_ADMIN_DATABASE_URL_FILE" \
  --output role-bootstrap-plan.json
node scripts/ai-content-database-roles.mjs --apply \
  --admin-url-file "$PROVIDER_ADMIN_DATABASE_URL_FILE" \
  --plan role-bootstrap-plan.json \
  --secret-output-dir role-secrets \
  --evidence role-bootstrap-applied.json
node scripts/ai-content-database-roles.mjs --verify \
  --admin-url-file "$PROVIDER_ADMIN_DATABASE_URL_FILE" \
  --plan role-bootstrap-plan.json \
  --evidence role-bootstrap-verified.json
```

Securely transfer only the app/operator/migration/cleanup URL files plus redacted checksummed role evidence to root-owned mode-`0600` cutover state. Using C's model-incapable cutover script, recreate every currently running pre-F API instance with the app URL, verify each live `session_user/current_user` and health, remove the prior privileged URL from runtime env, terminate its old API sessions, and seal the exact role-catalog hash. No migration has run yet. If any step fails while `074` is absent, run `--restore-pre-bootstrap` with the sealed snapshot and verify the original grant/session catalog; ambiguity or a shared credential that cannot safely rotate stops for user review.

- [ ] **Step 1: Deploy the exact fence code and apply only `074`**

First deploy every API instance at exact F while `074` is absent; default-off compatibility and the restricted app login must pass health, and neither migrated writer is enabled. Confirm F contains runner/migrate/database-TLS tooling plus `074` and cannot see `075`. The serialized provider-admin workflow creates one Ed25519-signed unused `074` request, activates only migration→schema-owner membership, and transfers its checksum plus the two pinned public-key files/key IDs/fingerprints to host state; both private keys remain outside all host/release/container state. Resolve `F_API_IMAGE` only from F's checksummed manifest, verify the real Compose network, and run that digest with the root-owned mode-`0600` migration URL/authorization/public-key files—never host source. This first runner invocation applies `074` without any provider ownership transfer or `CREATE EVENT TRIGGER`/`ALTER EVENT TRIGGER`, verifies the interim schema-owner-owned catalog/ordinary triggers, and emits the sealed platform-install request:

```bash
f_network="$(sudo docker network inspect brand-pilot_default --format '{{.Name}}')"
test "$f_network" = "brand-pilot_default"
f_uid="$(sudo docker run --rm --entrypoint id "$F_API_IMAGE" -u node)"
f_gid="$(sudo docker run --rm --entrypoint id "$F_API_IMAGE" -g node)"
sudo install -o "$f_uid" -g "$f_gid" -m 0400 \
  /opt/brand-pilot/state/cutovers/roles/migration-database-url \
  /opt/brand-pilot/state/cutovers/074-migration-database-url.container
sudo install -o "$f_uid" -g "$f_gid" -m 0400 \
  /opt/brand-pilot/state/cutovers/074-authorization.json \
  /opt/brand-pilot/state/cutovers/074-authorization.container.json
cleanup_f_migration_mounts() {
  sudo rm -f -- \
    /opt/brand-pilot/state/cutovers/074-migration-database-url.container \
    /opt/brand-pilot/state/cutovers/074-authorization.container.json
}
trap cleanup_f_migration_mounts EXIT INT TERM
sudo docker run --rm \
  --network "$f_network" \
  --env-file /opt/brand-pilot/shared/fence-migration.env \
  --env MIGRATION_DATABASE_URL_FILE=/run/secrets/migration_database_url \
  --env AI_CONTENT_074_AUTHORIZATION_FILE=/run/secrets/074_authorization.json \
  --env AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_FILE=/run/secrets/074_authorization_public.pem \
  --env AI_CONTENT_074_AUTHORIZATION_KEY_ID="$AI_CONTENT_074_AUTHORIZATION_KEY_ID" \
  --env AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_SHA256="$AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_SHA256" \
  --env AI_CONTENT_074_PROVIDER_ATTESTATION_PUBLIC_KEY_FILE=/run/secrets/074_provider_attestation_public.pem \
  --env AI_CONTENT_074_PROVIDER_ATTESTATION_KEY_ID="$AI_CONTENT_074_PROVIDER_ATTESTATION_KEY_ID" \
  --env AI_CONTENT_074_PROVIDER_ATTESTATION_PUBLIC_KEY_SHA256="$AI_CONTENT_074_PROVIDER_ATTESTATION_PUBLIC_KEY_SHA256" \
  --mount type=bind,src=/opt/brand-pilot/state/cutovers/074-migration-database-url.container,dst=/run/secrets/migration_database_url,readonly \
  --mount type=bind,src=/opt/brand-pilot/state/cutovers/074-authorization.container.json,dst=/run/secrets/074_authorization.json,readonly \
  --mount type=bind,src=/opt/brand-pilot/state/cutovers/074-authorization-public.pem,dst=/run/secrets/074_authorization_public.pem,readonly \
  --mount type=bind,src=/opt/brand-pilot/state/cutovers/074-provider-attestation-public.pem,dst=/run/secrets/074_provider_attestation_public.pem,readonly \
  "$F_API_IMAGE" node /app/scripts/migrate.mjs
cleanup_f_migration_mounts
trap - EXIT INT TERM
```

Require JSON `applied` to contain exactly `074_ai_content_maintenance_write_fence.sql`, the sealed provider-install request, and no secret; the trap removes the container-readable URL/authorization copies on success, error, or interruption, while public keys may remain only as checksummed read-only public material. If a database CA file is required, add it to the same exact-path trap, mount a UID-readable read-only copy, and point the existing TLS file variable to its container path; never put CA/URL/authorization contents in `--env`. The serialized provider-admin workflow, using its separately protected Supabase platform-`postgres` connection and both private keys outside all release/container state, runs exact signed `--install-074-enforcement-bundle` followed by `--verify-074-enforcement-bundle`. Transfer only the redacted one-shot attestation to host state. Re-run the pinned F runner in verification-only mode to consume it with the pinned provider public key and independently prove `074` present/`075` absent plus the exact provider-owned guard/control tables/functions, owners/ACLs/body hashes, event-trigger definition/enabled state, ordinary fence/role catalog, authorization non-replay, and no extra provider-admin action from every real role. Run the env-gated real-PostgreSQL exploit suite as migration→schema-owner and require guard replacement, control-state/allowlist tampering, ordinary-trigger disable/drop, and arbitrary DDL attempts all fail with unchanged state. Run its 43-trigger bulk-DML benchmark with maintenance off/on and require the reviewed threshold. Only after those checks may the serialized provider-admin workflow revoke migration membership and seal zero-membership/session evidence. Any missing or altered stage leaves `074` incomplete and blocks `075`. Leave maintenance disabled during ordinary F health verification. Do not enable either migrated writer.

- [ ] **Step 2: Export incidents and create provider backup**

Export both required generation IDs and the observed `409`/`invalid_json_schema` evidence. Record explicit `not_found` sections. Create a fresh provider snapshot and record provider backup ID/time, current migration, running releases/digests, incident SHA-256, and preserved-data manifest SHA-256 under `/opt/brand-pilot/state/cutovers/` mode `0600`.

- [ ] **Step 3: Enable and prove maintenance**

Run model-incapable `--prepare` only after backup/incident/preserved/preflight/UI-staging evidence exists; it freshly re-attests Vercel state and inserts the exact preflight transfer SHA into the one `prepared` row. Then run `--enable-maintenance` to disable autoscaling/old-image restart and enable the DB fence. Run `--verify-maintenance`; require create/proposal-create/select/start/retry/regenerate/automated mutation probes to return `503 ai_content_maintenance`, direct stale-process writes to fail, before/after row counts to match, and the DB row to transition exactly to `maintenance_verified`.

- [ ] **Step 4: Stop/drain content workers only**

Stop content-proposal, card-news, blog, old marketing, and image workers. Wait for proposal/generation/render/attachment claims and leases to drain or expire. An active lease aborts; unrelated workers remain untouched.

- [ ] **Step 5: Activate candidate-controlled recovery before the marker**

Run `--activate-cutover-control`. Require `/opt/brand-pilot/state/current` still equals the actually running F and the separate sealed control pointer equals C. Inventory every release/rollback/cached descriptor; remove all schema-1/2 or marketing-capable loose bundles from normal discovery, retain only F's checksummed opaque pre-marker restore archive plus non-launchable evidence, and keep the provider-snapshot DR unit offline. Attempt every old wrapper/script/rollback path and direct `docker compose -f` resolution for every inventoried release and prove descriptor/image resolution fails before Docker/Vercel/DB mutation. Only then may Task 9 begin.

## Task 9: Execute the atomic cutover and schema-3 rollout

**Files:** None; production operation using the pinned candidate.

- [ ] **Step 1: Execute `075` with the dedicated migration identity**

Require exact-ID DB status `maintenance_verified`, C as current control release, and the all-legacy non-launchable seal. The serialized provider-admin workflow validates the signed `075` request and temporarily activates only migration→schema-owner membership. Arm the stored token digest/cutover ID, run the pinned API image migrator, and immediately query `schema_migrations` plus that exact cutover row/event. The same transaction must have produced marker + `migration_body_complete`; if the marker exists, every subsequent failure is roll-forward-only. Then the provider-admin workflow revokes membership, terminates migration sessions, rotates/`NOLOGIN`s the migration credential, and produces a zero-membership/session attestation; remove its URL/token files and require that attestation before Step 2.

- [ ] **Step 2: Verify data/schema/storage before application rollout**

Require exact final catalog, preserved hashes, protected path set, durable cleanup outbox, no orphan/replay logical ID, no target execution rows, zero old runnable jobs, and unchanged Story/Reel delivery constraints. A product-provenance edge, path conflict, trigger drift, unexpected FK, hash mismatch, or missing backup/evidence leaves maintenance enabled.

- [ ] **Step 3: Roll forward the pinned schema-3 runtime**

Explicitly stop/remove `marketing-worker-1`; prove it is absent; replace the API only with all three cutover cleanup secrets mounted; start content-proposal first and require a fresh `state=running` `content_proposal` heartbeat whose boot/container identity and server receipt follow that container start; set `CONTENT_PROPOSALS_ENABLED=true`, recreate/roll every ordinary API instance, and require readiness; then start card-news, blog, reel, and image workers. Require the same exact running-heartbeat rule for each kind within 90 seconds; a stopping/old-boot event never counts. Prove `reel-worker-1` is healthy even though it was absent from `running_before`, keep ordinary `AI_CONTENT_CANARY_MODE=false` and `AUTOMATED_CONTENT_ENABLED=false`, and compare every digest/SHA to the manifest. Transition the DB row exactly `migration_body_complete → backend_verified`, then record `backend_ready_for_customer_ui`; do not promote UI or open writes yet. Immediately run `--verify-final-maintenance` against C and require every final HTTP/direct-DB mutation probe, final `075` fence, zero external side effect, and zero row/queue/blob/model delta to pass. This proof makes no generation reservation and is mandatory before cleanup, UI confirmation, or write opening.

- [ ] **Step 4: Complete cleanup before UI promotion**

Run the exact `--drain-storage-cleanup` operation until every unprotected row is `deleted` and every protected row is `retained_reference`; any failed/dead-letter/residual row blocks progress. Prove one preserved published output still previews/downloads. Run backend/catalog/digest health checks and write `cleanup_complete`, with maintenance still enabled.

- [ ] **Step 5: Promote the exact staged-production UI without a rebuild**

The serialized Production workflow runs the durable `customer-ui-promotion.mjs` state machine for `CUSTOMER_UI_STAGED_URL`. Persist the pre-submit intent/provider correlation as an immutable workflow artifact and transfer its checksum to host/DB evidence before accepting success; a missing/indeterminate correlation stops and never resubmits. Require promotion to retain the exact `CUSTOMER_UI_DEPLOYMENT_ID`; a new deployment ID is a rebuild/Preview-path error. Verify the production domain and no-cache `/release.json` expose the manifest source SHA, catalog hash, V3 contract, and `075`. Copy the sealed summary into prepared state and run `--confirm-customer-ui`. After the database marker, never roll back to the recorded schema-2 previous deployment. For a reviewed descendant D, first prove ancestry/source provenance and reserve its sequence with `--begin-adoption`; only then assemble/stage/revalidate sequence-bound final evidence and resume through `--adopt-descendant`. No D manifest may become effective outside that append-only handoff.

- [ ] **Step 6: Open writes only after every cross-system identity agrees**

Run the provider-admin cleanup-retirement step only after every API replica has drained its cleanup pool and unmounted all three secrets; it revokes/rotates cleanup login, terminates its sessions, and emits a fresh checksummed zero-session attestation. Then run `--open-writes`; it rechecks exact-ID DB status `backend_verified`, effective base/adopted release, preflight transfer, current/control identities, all-legacy retirement, backend/image digests, five qualifying running heartbeats, cleanup terminal counts, Vercel deployment ID, production `/release.json`, migration/cleanup credential retirement, and zero old service. It consumes the attestation, disables maintenance/transitions to `completed`, and finalizes/tombstones the registry idempotently. Do not create/select/start content here: prove route/readiness/config only with zero proposal/generation/usage deltas, ordinary `AUTOMATED_CONTENT_ENABLED=false`, and no canary replica. Task 10 is the first post-open customer mutation; its initial and automatic canary authorization is exactly nine net units. Never edit the product plan limit or usage ledger. Only a separately recorded explicit user authorization under Task 10's failure rule may replace the cumulative canary cap before a successor attempt.

## Task 10: Run production canaries and close the incidents

**Execution:** Use only the Task 2B canary policy, private replica, production Playwright spec, driver, observer, and the flat release script. No ad-hoc SQL mutation or unlisted worker command is allowed.

- [ ] **Step 0: Start the allowlisted no-ingress replica and UI mapping proof**

```bash
sudo "$candidate_dir/scripts/ai-content-production-canary.sh" \
  --start-replica \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers
```

Before any mutation, obtain the authoritative `usage_date`, reset boundary/time zone, and remaining net allowance from the same server/database view used by reservation. Require at least nine remaining units and at least 75 minutes before that exact reset boundary; otherwise abort with zero canary mutation and resume after the boundary under a new attempt. Seal the date/boundary in attempt evidence and require every reservation/reversal/recheck in the attempt to use it. The initial attempt may consume at most nine net units: six Studio successes, two migrated-writer successes, and one successful retry after the controlled failure is reversed. Before every successor, enforce both the newly recorded cumulative canary cap (if the user explicitly authorized one) and the authoritative product allowance; authorization never edits the product plan or ledger. If either remaining amount is below nine, the authoritative date changes, or another actor changes the count during the run, stop and ask the user.

For one immutable `canaryAttemptId`, `--start-replica` starts the loopback `topic_bootstrap` phase first, validates the managed session/brand/product/three experiments, and uploads the prepared three-row CSV through that replica's ordinary authenticated topic-upload API with `cutover-canary:<cutoverId>:<canaryAttemptId>:topics`. It replays once and requires the same three ordered topic UUIDs, stops bootstrap, seals the IDs into mode-`0600` state/env, then starts exactly one full-phase local `api-content-canary` on the candidate API digest. Any ambiguity/partial result aborts and same-attempt recovery uses the same upload key/IDs. A later full rerun permitted by the budget rule below creates a new immutable attempt ID, new upload key, and three new topic rows; prior attempt evidence/rows remain and cannot satisfy the rerun. Require the designated brand/IDs, no Caddy route/external cron, and ordinary production still `AI_CONTENT_CANARY_MODE=false/AUTOMATED_CONTENT_ENABLED=false`. From the serialized workflow, run only:

```bash
npx --no-install playwright test \
  --config apps/customer-ui/playwright.production.config.ts \
  apps/customer-ui/e2e/ai-content-cutover.production.spec.ts \
  --project=desktop
```

It visits `/ai-content/new`, intercepts and aborts/fulfills all six setup POSTs before API delivery, proves format/purpose independence, asserts zero content/usage row delta, and touches no unrelated page/worker.

- [ ] **Step 1: Run all six Studio cells on the designated test brand**

Through the full loopback replica, for each `card_news|blog|reel × informational|marketing`, create one Proposal V2 batch, require exactly three valid proposals, select one, start V3 generation, and require the exact format worker plus image-worker only. Verify prompt binding/model/schema, both Korean format and purpose labels, exact `ai-content.v3` purpose/format with no `type`, successful artifact, replay identity, and one net reservation. Recheck remaining allowance before each atomic start; any unexpected concurrent consumption stops the attempt.

```bash
sudo "$candidate_dir/scripts/ai-content-production-canary.sh" \
  --run-studio-matrix \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers
```

- [ ] **Step 2: Run the two migrated-writer canaries**

Create three distinct performance batches through the full loopback replica's normal adapter with three fresh attempt-prefixed operation keys; replay every key and require the identical batch identity. Each performance request body is exactly `{experimentId,evidenceVersion}` for one pre-verified completed allowlisted experiment; metrics, snapshot IDs, output settings, format, purpose, and product are forbidden because the server resolves/freeze-checks them. One explicit operator scheduler call uses one fresh attempt-prefixed request key, processes exactly the three attempt-specific uploaded/allowlisted topics, and returns their three automated batch/run identities. Replay that scheduler request and require the same three identities; inside it, the per-topic operation/proposal keys remain the exact production-derived `scheduled-topic`/`scheduled-proposal` forms. No discovery, auto-selection, final generation, customer ingress, or external cron is added.

For all six migrated-writer batches require exactly three proposals, exactly one proposal job per batch, one-to-one run↔batch cardinality where a run applies, stable scheduled topic key, topic exclusion after any linked run, and zero premature `master_draft`, `topic_publish_group`, or `channel_output`. Reopen at least one performance batch through safe `resumeInput`; list one automated V2 inbox item and verify exact V2 title, selection reason, one-line intent, canonical card-news/informational labels, and server evidence preview. Select one proposal from each path through loopback, require the same generation ID on selection replay, then start both through the ordinary V3 path and wait for terminal success. The performance selection must route only to its selected canonical format+image worker; the automated selection must route only to card-news+image, never blog/reel, and both require successful artifacts plus two distinct V3 hashes. Query zero V1 request/job/proposal rows and zero direct-writer artifacts. Verify `draft_json.origin="proposal-v2"`, identifier-only safe provenance, scheduled discriminator, failure/attempt mirroring, and no placeholder artifact. The deterministic Phase 3 readiness/disabled-flag tests remain the proof for negative feature states; do not stop the production proposal worker or mutate ordinary flags during canary.

```bash
sudo "$candidate_dir/scripts/ai-content-production-canary.sh" \
  --run-migrated-writers \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers
```

- [ ] **Step 3: Prove terminal failure, reversal, and retry**

Through the loopback replica use the canary-only exact-job lease endpoint once, then the ordinary worker `/fail` endpoint once. Require zero successful outputs → `failed`, both selected Korean format/purpose labels in the failure result, exactly one reversal on the original reservation date/quantity, then retry once through the normal customer retry route with one operation idempotency key and require exactly one child generation/new reservation processed by the real format/image workers. Replay the same retry key and prove the same identity; changed fingerprint is the single expected 409. Store only the lease-token hash.

```bash
sudo "$candidate_dir/scripts/ai-content-production-canary.sh" \
  --run-controlled-failure \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers
```

- [ ] **Step 4: Observe for 30 minutes**

Run a monotonic-clock observation for at least 1,800 seconds at 30-second intervals, first and final included (minimum 61 valid samples). A sample gap over 45 seconds, process restart, unreadable source, or missing sample invalidates the run from its beginning.

```bash
sudo "$candidate_dir/scripts/ai-content-production-canary.sh" \
  --observe \
  --duration-seconds 1800 \
  --interval-seconds 30 \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers
```

Every sample requires: health/readiness 200 and `database=ok`; ordinary proposals on, ordinary automation/canary mode off; production UI deployment ID/SHA/catalog/V3/`075` exact; content-proposal/card-news/blog/reel/image containers running on manifest digests and explicit heartbeats at most 90 seconds old; zero marketing service/container; zero expired proposal/generation/render leases; zero available content jobs queued over five minutes; cleanup outbox/attachment rows scoped to the prepared cutover ID or these canary generations only are `deleted|retained_reference` with no residual state; zero canary generation↔worker/format/purpose/binding/model/schema mismatch; exactly one reservation and zero reversal per successful generation; exactly one equal-and-opposite original-date reversal for the controlled failure; exactly one retry child/new reservation; and zero content-correlated `invalid_json_schema`, unexpected proposal conflict/409, format fallback, wrong worker, label mismatch, cleanup failure, or 5xx log event. Unrelated attachment/cleanup rows are neither queried for pass/fail nor mutated. The driver's named changed-fingerprint request is the only allowed 409 and is matched by correlation ID.

On success, seal `studio-matrix.json`, `migrated-writers.json`, `controlled-failure.json`, `observation.jsonl`, `observation-summary.json`, scoped content logs, and `SHA256SUMS`, then stop/remove only the isolated replica:

```bash
sudo "$candidate_dir/scripts/ai-content-production-canary.sh" \
  --stop-replica \
  --release-manifest "$candidate_dir/release.env" \
  --state-dir /opt/brand-pilot/state/cutovers
```

An observation-process restart, unreadable sample, or gap invalidates that observation window from its beginning; if every functional invariant and sealed canary result still passes, restart only the 30-minute read-only observation in the same attempt and spend no generation unit. Any functional threshold failure requires stopping the replica, fixing forward, and rerunning the affected deterministic content suite. A fresh full canary attempt is automatic only when the failed attempt has zero net successful reservations after legitimate terminal-failure reversals. If even one successful non-reversible charge remains, stop and request explicit user authorization for a new cumulative generation budget; never fabricate a reversal, edit the ledger/product limit, reuse old success evidence, or exceed the currently recorded cumulative cap. Once that authorization is recorded and the authoritative allowance check passes, a successor uses a new attempt ID and three-topic upload/run keys and reruns the full UI mapping, six Studio cells, 3+3 writer batches, controlled failure, and entire observation window. Crash/resume inside one attempt reuses its IDs; a failed attempt never supplies success evidence to its successor. Never repeat the schema-only preflight. No unrelated worker is queried, stopped, started, or tested.

- [ ] **Step 5: Close every prior incident with a four-part evidence row**

Do not close an incident with a generic explanation. Complete this exact matrix; every row needs (1) original cause from exported request/DB/log/release evidence, (2) linked implementation commit/file, (3) a deterministic regression that first reproduces the captured old failure and then passes, and (4) production evidence. If any original source/log is unavailable, record `not_found` and still reproduce the old failure deterministically.

| Incident | Required deterministic before/after regression | Required production closure |
|---|---|---|
| unexpected proposal-batch `409` | Phase 3 `incident_unexpected_proposal_409` reproduces the legacy conflict, then returns one batch under replay/concurrency; changed fingerprint alone conflicts | replay all six Studio starts and all six migrated-writer keys with no unexpected `409` |
| reel displayed or failed as blog for `26998aec-b8c4-4abb-a1d8-a7204c1b6226` and `71565421-d205-4627-8ea5-84633ac879cb` | captured missing/mismatched format reproduces blog fallback, then fails before persistence; valid reel reaches only reel queue/plan/manifest/Korean reel label | informational and marketing reel cells show reel worker, label, artifact, V3 format, and no blog job |
| `invalid_json_schema` | Phase 1 `incident_invalid_json_schema` rejects the checksummed legacy schema deterministically, then canonical generated schemas/exact parsers pass; the single approved Proposal V2 preflight adds provider acceptance without a second old-schema call | zero schema errors in all content canaries and 30-minute window |
| intended commit/image/migration omitted or overwritten by CI/CD | release-impact fixture reproduces the missing changed component, then schema-3 provenance rejects stale/missing changed content while preserving intentionally reused unrelated components | changed API/UI/content images, source SHAs, digests, catalog, and DB marker match the approved manifest; unrelated components remain byte-identical |

## Task 11: Remove the temporary legacy reader after evidence is complete

**Files:**

- Delete: `scripts/convert-legacy-release-manifest.mjs`
- Delete: `scripts/convert-legacy-release-manifest.test.mjs`
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `scripts/incremental-cicd-contract.test.mjs`
- Modify: `../.github/workflows/publish-brand-pilot-server-images.yml`
- Modify: `deploy/compose.production.yml`
- Modify: `deploy/env/api.env.example`
- Modify: `deploy/env/ai-content-cutover-roles.env.example`
- Modify: `deploy/release.env.example`
- Modify: `deploy/scripts/ai-content-cutover.sh`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `deploy/scripts/promote.sh`
- Modify: `docs/operations/AI_CONTENT_THREE_FORMAT_CUTOVER.md`

- [ ] **Step 1: Add RED absence tests**

Reject all normal or one-time schema 1/2 readers, retired-name exceptions, and any marketing image/service reference. Reject all three temporary cleanup secret declarations, Docker mounts, environment keys, release source specs, or completed-cutover remount paths. Keep only immutable non-executable evidence outside source. Regression fixtures prove the converter was never part of a Docker image, `release_file_specs`, staged host bundle, or allowed rollback manifest; prove a normal completed descendant starts with no cleanup pool and cannot recreate it; and snapshot the exact `remove_legacy_converter` classifier path/hunk set.

```powershell
node --test scripts/content-cutover-impact.test.mjs scripts/assemble-release-manifest.test.mjs scripts/customer-ui-deployment-evidence.test.mjs
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/deployment-contract.test.mjs scripts/incremental-cicd-contract.test.mjs
```

Expected: RED because the converter/workflow exception and temporary cleanup-secret wiring still exist.

- [ ] **Step 2: Implement deletion, promotion, and runbook changes; run GREEN; commit once**

Delete the converter and every exception. Remove `AI_CONTENT_CUTOVER_CLEANUP_DATABASE_URL_FILE`, `AI_CONTENT_CUTOVER_CLEANUP_TOKEN_FILE`, and `AI_CONTENT_CUTOVER_ID_FILE` from normal Compose/env/release wiring and remove their three mounts/source specs. The API cleanup code remains inert audit/recovery code: without those settings it creates no pool, and both its completed-cutover database guard and deployment preflight reject any later remount. Do not remove the immutable historical cutover ID, cleanup revocation attestation, or non-secret cleanup totals. Update promotion and the runbook to reject any staged converter/legacy reader and any live cleanup credential while retaining only checksummed non-executable retirement/revocation evidence. Document the exact cleanup-release sequence before producing it; no production action precedes this commit.

```powershell
node --test scripts/content-cutover-impact.test.mjs scripts/assemble-release-manifest.test.mjs scripts/customer-ui-deployment-evidence.test.mjs
node --test --test-name-pattern="^\[ai-content-cutover\]" scripts/deployment-contract.test.mjs scripts/incremental-cicd-contract.test.mjs
git add -- scripts/convert-legacy-release-manifest.mjs scripts/convert-legacy-release-manifest.test.mjs scripts/deployment-contract.test.mjs scripts/incremental-cicd-contract.test.mjs ../.github/workflows/publish-brand-pilot-server-images.yml deploy/compose.production.yml deploy/env/api.env.example deploy/env/ai-content-cutover-roles.env.example deploy/release.env.example deploy/scripts/ai-content-cutover.sh deploy/scripts/preflight.sh deploy/scripts/promote.sh docs/operations/AI_CONTENT_THREE_FORMAT_CUTOVER.md
git commit -m "chore(deploy): retire cutover-only execution paths"
```

- [ ] **Step 3: Publish, promote, and verify the converter-free cleanup release**

Build source-only cleanup provenance from the exact Step 2 commit. The verified `remove_legacy_converter` profile runs only its static/deployment/provenance tests, selects no runtime image or customer-UI build, and requires every API/content/unrelated image digest and per-component source SHA to equal the already observed effective release. From the currently effective release, run `--begin-adoption` with the cleanup SHA, parent, reviewed classifier/provenance hash, reason, and caller UUID; seal the returned sequence. Before manifest assembly, the serialized Production workflow runs `customer-ui-deployment-evidence.mjs --attest-current-reuse` with that exact cutover ID/sequence, cleanup SHA, and prior UI evidence. It freshly queries Vercel Current plus the no-cache production `/release.json` and seals the same deployment/project/team ID, original UI source SHA, catalog SHA, `ai-content.v3`, and `075` against the cleanup SHA/sequence. Missing/stale/different Current state or any stage/promote request fails closed.

Assemble with the existing current schema-3 manifest as baseline, the source-only cleanup provenance, the fresh `current_reuse` attestation, and the retained non-executable retirement checksum. Require `RELEASE_SHA=<cleanup SHA>`, `CUSTOMER_UI_CHANGED=false`, byte-identical `CUSTOMER_UI_SOURCE_SHA`/deployment ID, unchanged `PREFLIGHT_CANDIDATE_SHA`/identity/transfer, and no changed runtime component. Stage only the flat checksummed cleanup host bundle; do not invoke Vercel build/deploy/promote and do not build/push an API/UI/worker image.

From the previously effective release script, invoke the common `--adopt-descendant` state machine with this manifest, the reserved adoption sequence, and the exact completed cutover ID sealed in completed history—never an active-row lookup. It verifies Git ancestry, cleanup-profile diff, fresh sequence-bound `current_reuse`, unchanged component/preflight identities, converter/secret absence, and append-only adoption uniqueness; then it installs the cleanup bundle and atomically advances `/opt/brand-pilot/state/current` without changing the already-completed cutover status or maintenance state. Before marking the adoption complete, it identifies the exact predecessor effective bundle from the adoption record, proves no running container/process/current pointer uses it, removes its launch descriptors from every normal release/rollback discovery path, and either deletes its executable files or seals only checksum/non-secret evidence in a mode-`0400` non-launchable quarantine. The separately offline provider-snapshot DR unit is explicitly excluded and remains governed only by the approved full-downtime procedure. Only after predecessor retirement evidence is fsynced does it complete the one adoption record. Failure injection covers begin/attestation, intent write, bundle install, current-pointer rename, predecessor inventory/quarantine/delete, and adoption completion; rerun resumes the same adoption and cannot create a second row, restore the predecessor to normal discovery, or perform a Vercel/model call.

The converter never entered the cutover candidate's staged file list or any runtime image, so no running image is replaced. Verify this against the prior candidate's signed file-list/checksum evidence. Final verification searches the current release, every remaining executable host/rollback bundle, workflow checkout/artifact entry point, running container/config, and normal deployment environment and finds zero converter/schema-1/2 reader, marketing runtime, cleanup secret/mount, or usable cleanup login/session. It also proves the exact predecessor bundle is absent from normal discovery and its retirement checksum matches the adoption record. Only mode-`0400` retirement/revocation/predecessor checksums and non-executable evidence remain under `/opt/brand-pilot/state/cutovers`; Git history may retain reviewable source but no current command or release may execute it.

After adoption, rerun content API readiness, queue/worker health, catalog/DB-marker/provenance, Current UI identity, completed-cutover/cleanup-revocation guards, and old-name/secret absence checks. Prove all running API/UI/content image digests and per-component source SHAs are identical to the already observed release and record the focused post-adoption health result. Any runtime/UI identity change invalidates the source-only profile and requires explicit user review plus the full six-cell canary and 30-minute observation gate; it may not silently broaden this step. There is no source commit after this production operation.

## Final completion evidence

Return migration ID and database catalog; provider backup ID; incident/pre-delete bundle checksum; the completed four-row incident matrix; preserved counts/hashes; storage deleted/retained totals and preview proof; intended commits versus deployed API/UI/image/migration provenance; six Studio batch and generation IDs; exact queue/worker/model/prompt/manifest per cell; three performance plus three automated batch/run IDs and all replay/cardinality evidence; two migrated-writer V3 hashes; usage reservation/reversal/retry rows and cumulative authorized/net canary charges across every attempt; old marketing and converter absence/new reel health; cleanup-release SHA, fresh `current_reuse` checksum, completed adoption sequence/hash, predecessor-retirement checksum, and zero cleanup-secret/login/session proof; 30-minute error counts; and explicit confirmation that no unrelated worker was tested.
