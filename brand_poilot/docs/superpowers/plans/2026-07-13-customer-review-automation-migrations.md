# Customer Review, Automation, and Migration Plan

> Scope: implement tasks 1, 2, 4, and 5. Worker local/production environment separation is deliberately deferred.

## Goals

1. Restore the customer-facing `/content` review route and persist its review actions through the existing API.
2. Run generation once per brand at 10:00 KST, assign approved outputs to the four policy slots, and publish only when a slot is due.
3. Give failed source URLs an explicit retry and enable/disable control in the customer UI.
4. Track applied SQL migrations and apply pending migrations safely to Supabase or a fresh database.

## Execution

- [ ] Add failing UI tests for content review routing/actions and source retry/disable controls.
- [ ] Add failing API tests for source state changes and cron endpoints.
- [ ] Add pure scheduling tests for KST generation time and policy slot assignment.
- [ ] Implement `ContentPage`, route, and navigation entry using `GET /content-outputs` and `POST /review`.
- [ ] Extend source update/retry API and source table UI without falling back to local-only state.
- [ ] Add scheduler run persistence, generation/publish repository operations, protected cron endpoints, and local scheduler opt-in.
- [ ] Remove the auto-approved Instagram immediate-publish path so all output uses policy scheduling.
- [ ] Add migration runner, migration history table, a new automation-run migration, scripts, and documentation.
- [ ] Run migration history baseline and pending migration against the configured Supabase database only after runner verification.
- [ ] Run API/UI tests, contract tests, builds, and a live health/scheduler route smoke check.

## Safety Decisions

- Scheduler execution is idempotent through a unique per-brand/per-KST-date run key.
- The local scheduler remains disabled unless `LOCAL_SCHEDULER_ENABLED=true`; production cron uses `CRON_SECRET`.
- An existing database with schema but no migration history requires an explicit one-time baseline flag, preventing accidental replay of historical migrations.
- No changes are made under `workers/brand-pilot-image-worker` in this task.
