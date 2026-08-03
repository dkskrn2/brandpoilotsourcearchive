# Instagram generation capability hotfix design

## Context

The production API is the Ubuntu/Caddy deployment at `api.danbammsg.co.kr`,
not the similarly named Vercel API project. The current Ubuntu release, API
image label, and sparse deployment checkout all resolve to commit
`964a17d658865c0eba8c513a08a83fec23dd020a` from `dkskrn2/main`.

The active `GROWTHLINE` Instagram channel is connected and enabled. Its active
Instagram Login credential is valid and has the required Business scopes,
including `instagram_business_basic` and
`instagram_business_content_publish`. The production source already accepts
those Business scope names.

The production API nevertheless reports Instagram as
`readiness = not_supported` with `reasonCode = publishing_disabled`, because
the Ubuntu API deliberately runs with `INSTAGRAM_PUBLISH_ENABLED=false`. The
customer AI-content setup currently treats that publication kill switch as a
generation failure, so `card_news` has no selectable upload/channel target.

## Goal

Allow a connected, enabled Instagram channel to be selected for AI card-news
generation and allow the user to publish an approved generated result to that
Instagram account.

## Strict change boundary

Only the Instagram publication runtime gate and its deployment safety contract
may change:

- production runtime configuration validation for
  `INSTAGRAM_PUBLISH_ENABLED=true`;
- the API primary/canary Compose handling of that flag;
- preflight validation and the production env example/runbook;
- focused runtime and deployment-contract tests.

The following must remain unchanged:

- channel capability, generation, and customer UI source code;
- `LOCAL_SCHEDULER_ENABLED=false`;
- publish preparation, provider request, publish queue, retry, and cron logic;
- OAuth, credentials, scopes, database rows, migrations, and schemas;
- channel settings/status presentation apart from reflecting that publication
  is now available;
- generation and publication behavior for Threads and every other channel;
- workers, billing, navigation, brand intelligence, and unrelated APIs/UI.

## Design

The production API will run with `INSTAGRAM_PUBLISH_ENABLED=true` and
`LOCAL_SCHEDULER_ENABLED=false`.

The API runtime policy will continue to reject a production-local scheduler,
but it will no longer reject the independently enabled Instagram publication
flag. Literal boolean validation, all other production requirements, and every
other feature flag remain unchanged.

The production Compose file will stop hard-coding the Instagram publication
flag in the service-level `environment` block. Both API services will read the
authoritative value from the existing mode-600
`/opt/brand-pilot/shared/env/api.env` file. Preflight will require exactly one
`INSTAGRAM_PUBLISH_ENABLED=true` entry and still require exactly one
`LOCAL_SCHEDULER_ENABLED=false` entry.

Before the candidate starts, the operator will back up `api.env`, replace only
that one flag with `true`, and verify owner/mode without printing any secret.
The currently running release is unaffected because its Compose file still
overrides the value to `false`. The new canary then reads `true`; the existing
primary remains on the previous false-gated container until promotion.

Once promoted, the existing source behavior becomes active without UI or
capability rewrites:

- the capability response reports Instagram `readiness = ready` and exposes
  supported feed publish modes when the existing credential checks pass;
- card-news generation can select Instagram through the existing predicates;
- the explicit AI-content publish action prepares a queue item and calls the
  existing Instagram Login Graph API adapter;
- local periodic scheduling stays disabled.

The authenticated internal cron route remains unchanged and still requires
`CRON_SECRET`; this hotfix does not create or enable a cron caller.

## Non-goals and rejected approaches

The earlier generation-only eligibility exception is rejected because the
required outcome includes real publication. It would have allowed generation
while leaving the final publish action blocked.

Enabling `LOCAL_SCHEDULER_ENABLED` is rejected because the user did not request
automatic/due publication and it would expand runtime behavior beyond an
explicit publish action.

Hard-coding `INSTAGRAM_PUBLISH_ENABLED=true` in Compose while leaving
`api.env` and preflight at false is rejected because the effective production
state would contradict its audited source of truth.

Changing OAuth data, credential rows, or scope metadata is rejected because
the current production credential already passes the source's Business-scope
checks.

## Tests

Test-driven implementation will add failing cases first:

1. Production runtime configuration accepts literal
   `INSTAGRAM_PUBLISH_ENABLED=true` while
   `LOCAL_SCHEDULER_ENABLED=false`.
2. Production runtime configuration still rejects
   `LOCAL_SCHEDULER_ENABLED=true`, invalid booleans, and all existing unsafe
   production configuration.
3. Deployment-contract tests require API services to inherit the publication
   flag from `api.env` instead of overriding it.
4. Preflight tests accept exactly one true publication flag and reject false,
   missing, duplicated, or malformed values.
5. Existing repository and HTTP tests continue proving that the disabled path
   fails closed and the enabled path uses the provider adapter.

Required verification before release:

- focused runtime configuration and deployment-contract tests;
- existing Instagram capability, publisher, repository, and HTTP publish
  tests;
- API TypeScript check and production build;
- full relevant workspace tests where execution time permits;
- Compose rendering, shell syntax, and shellcheck for the changed preflight;
- a file-level diff audit proving that only publication configuration,
  deployment safety tests/docs, and this design/implementation documentation
  changed.

## Deployment and canary

The API candidate must be built from production commit `964a17d...` plus only
this hotfix, verified on the Ubuntu canary host, and then promoted using the
existing immutable release flow. Existing worker image digests are reused; no
customer UI or worker artifact changes.

Canary checks:

- current primary `/health` and `/ready` stay healthy while the canary is
  prepared;
- canary `/ready` reports publication enabled and scheduler disabled;
- the authenticated GROWTHLINE capability response changes only in the
  Instagram readiness/publish fields expected from the existing implementation;
- Card News now shows Instagram as the selectable target;
- proposal creation passes the server-side capability guard;
- provider-backed publication tests pass before release;
- unrelated channel capability fixtures and one unrelated read-only screen
  remain unchanged.

No unsolicited live Instagram post is created during deployment. The first
real end-to-end post requires an operator-approved generated output after
promotion.

## Rollback

Rollback restores Ubuntu API release
`964a17d658865c0eba8c513a08a83fec23dd020a` and restores the backed-up
`api.env` with `INSTAGRAM_PUBLISH_ENABLED=false`. The previous release also
hard-codes the false value, so publication is fail-closed even if env-file
restoration is delayed. The hotfix has no schema, business-data, or credential
mutation.
