# Content Worker Codex Account Failover Design

**Status:** Approved in conversation on 2026-08-08.

## Goal

Keep Brand Pilot's manual content generation pipeline available when one owned
ChatGPT account reaches its Codex usage limit. The proposal, card-news, blog,
reel, and image workers automatically retry a safe invocation with a second
authenticated account. No other worker or automated card-news flow is changed
or tested.

## Scope

The account pool applies only to these production services:

- `content-proposal-worker-1`;
- `card-news-worker-1`;
- `blog-worker-1`;
- `reel-worker-1`;
- `image-worker-1`.

The initial ordered profiles are `primary` and `secondary`. The profile names
are operational aliases and are the only account identifiers allowed in source,
configuration, status, and logs. Email addresses and credential contents are
not stored by the application.

Automated card news, DM, Wiki, FAQ, brand-intelligence, subject-analysis,
publishing, and unrelated workers are outside this change.

## Approaches considered

### Shared account-pool runtime in each content worker — selected

A shared worker-runtime component selects an account for every Codex child
process. It retries the same bounded invocation with the next account only after
a proven account-usage exhaustion failure. This retains the current API job,
claim, lease, parser, and completion contracts.

Each worker process keeps a small in-memory cooldown table. Separate workers may
probe a newly exhausted account once before learning its state. That bounded
extra call is preferable to a shared writable state service or cross-container
lock and cannot create an additional application job.

### Central Codex gateway — rejected

A privileged service could own all account state and serialize Codex calls. It
would add a network protocol, a single failure domain, deployment health rules,
and a new secret-bearing service. The current sequential job workers do not need
that complexity.

### One worker replica per account — rejected

The API queue does not schedule claims according to account availability. An
exhausted-account replica could claim a job and fail it before the healthy
replica can act. Fixing that would require queue and lease changes outside the
approved scope.

## Authentication layout

Production stores the two independent Codex homes outside Git and release
directories:

```text
/opt/brand-pilot/shared/codex-accounts/
  primary/
    auth.json
  secondary/
    auth.json
```

The parent directory and both profile directories are regular, non-symlink
directories owned by `bpdeploy:bpdeploy` with mode `0700`. Each `auth.json` is a
regular, non-symlink file owned by `bpdeploy:bpdeploy` with mode `0600`.
Containers run with the matching numeric UID/GID and receive a writable bind
mount because Codex may refresh its authentication tokens.

The five in-scope services receive the parent at `/codex-accounts`. Each Codex
child receives exactly one selected profile directory as `CODEX_HOME`. The
profile list is an ordered, validated setting containing only the aliases
`primary,secondary`. The old single `/codex` mount is removed from these five
services. Other services retain their current authentication configuration.

Provisioning performs device authentication once per profile. Preflight checks
the path boundary, ownership, modes, regular-file requirements, and a suppressed
`codex login status` for both profiles. It never prints, parses, copies, hashes,
or logs `auth.json`.

## Shared account-pool boundary

The worker runtime owns one account-pool abstraction with these responsibilities:

1. validate the ordered profile aliases and their resolved directories;
2. reject traversal, symlinks, duplicate aliases, missing profiles, and paths
   outside `/codex-accounts`;
3. select the first profile whose cooldown has expired;
4. construct a minimal child environment with that profile as `CODEX_HOME`;
5. classify a bounded Codex failure transcript;
6. mark only proven usage-exhausted profiles unavailable;
7. allow at most one attempt per configured profile for one invocation;
8. return the successful profile alias and home to output-aware callers;
9. return `codex_accounts_exhausted` when no profile remains.

The runtime captures bounded stderr and the Codex JSON event stream required by
the caller. It does not log raw model output or authentication data. Existing
child-environment allowlists remain in force, and DB, API, Blob, and worker
tokens never enter the Codex child.

## Failure classification

Failover is deliberately narrower than generic retry.

The runtime may move to the next account only when all of these are true:

- the Codex process exits non-zero;
- no valid final model message or generated asset has been accepted;
- the bounded diagnostic matches the maintained usage-exhaustion classifier;
- the parent abort signal is not set;
- another configured profile has not yet been attempted for this invocation.

Rate limits, timeouts, aborts, spawn errors, malformed output, schema failures,
parser failures, tool failures, and ordinary non-zero exits do not switch
accounts. An invocation that has emitted an accepted final message is never
replayed even if later cleanup fails.

When the diagnostic contains an unambiguous future reset time, the profile is
excluded until that time plus a five-minute safety margin. Otherwise it receives
a one-hour cooldown. Cooldown state is process-local and contains only profile
aliases and timestamps. A worker restart may probe the primary once again, but
one invocation still attempts each profile at most once.

## Worker integration

### Proposal worker

`createCodexContentProposalModel` delegates process execution to the account
pool while preserving its current transcript and output hashes, timeout,
process-tree termination, temporary runtime directory, and
`ContentProposalModelInvocationError` semantics. Failover happens inside one
server-recorded invocation ordinal, so the API does not create another job or
consume the repair ordinal.

### Card-news, blog, and reel workers

The three plan scripts use the same account-pool executor instead of independently
spawning Codex with inherited stderr. The executor replays the identical prompt,
arguments, schema, and output directory only after a classified usage failure.
Before a retry it removes only that invocation's incomplete output-last-message
file. Existing plan validation and worker job retry rules remain unchanged.

### Image worker

The image worker runs Codex under the selected profile and resolves
`generated_images` from that selected Codex home. An exhausted attempt must have
no accepted final message or selected output before failover. Attempt-scoped
generated-image directories are cleaned before retry. The successful profile
home is used to locate and copy the final asset; the credential file is never
read by application code.

## Data flow

1. An existing worker claims one existing application job and starts its lease.
2. The account pool chooses `primary` unless it is cooling down.
3. The worker starts an ephemeral Codex child with `primary`'s isolated home.
4. On success, the existing parser and completion path run unchanged.
5. On a proven usage-exhaustion failure with no accepted output, the pool marks
   `primary` unavailable and starts the identical invocation with `secondary`.
6. On secondary success, the existing parser and completion path run once.
7. If both profiles are unavailable or exhausted, the worker returns the stable
   `codex_accounts_exhausted` failure and does not loop.

No new database row, proposal batch, generation job, invocation ordinal, or
quota reservation is created by account failover.

## Deployment changes

Deployment and cutover checks are updated for the two-profile directory without
reapplying migrations 074 or 075. Release preflight validates both logins using
the same immutable worker image and suppressed command output. Compose mounts
the account parent only into the five in-scope workers and explicitly denies the
entire `/codex-accounts` tree in Codex filesystem permissions.

Rollout order is:

1. create and permission the profile directories;
2. preserve the current login as `primary` without printing its contents;
3. authenticate `secondary` through device login;
4. run deterministic account-pool and five-worker contract tests;
5. build and publish the affected worker images;
6. run production preflight for both profiles;
7. restart the five content workers only;
8. verify worker heartbeats;
9. run one manual content-generation browser flow;
10. perform final code review;
11. consider automatic deployment only after production verification succeeds.

## Testing

Shared runtime tests prove:

- ordered primary selection;
- usage-exhaustion classification and secondary failover;
- reset-time and fallback cooldown behavior;
- no failover for rate limit, timeout, abort, spawn, parser, schema, or generic
  failures;
- no replay after an accepted final output;
- one attempt per profile and stable all-accounts-exhausted behavior;
- profile-path validation and secret-free child environments.

Worker tests prove the proposal, card-news, blog, reel, and image execution paths
use the shared account pool without changing prompts, schemas, model selection,
job IDs, invocation ordinals, output hashes, or asset counts. Image tests prove
the successful profile's generated-image directory is used and failed-attempt
files cannot leak into the result.

Deployment contract tests prove only the five in-scope services mount the pool,
both profiles are preflighted without credential output, filesystem permissions
deny `/codex-accounts`, and migrations 074/075 are not invoked.

No automated-card-news, DM, Wiki, FAQ, brand-intelligence, subject-analysis, or
unrelated worker test is run as part of this change.

## Success criteria

- With `primary` returning a usage-exhaustion error, the same manual content job
  completes through `secondary` without user action.
- A generic or indeterminate failure is not replayed under another account.
- One application job produces at most one accepted proposal, plan, or asset.
- Exhausting both accounts terminates with `codex_accounts_exhausted` and no
  retry loop.
- Production credentials remain outside Git, images, release artifacts, logs,
  and application data.
- Only the five approved manual-content workers change or restart.
