# AI Content Usage Reversal Lock Repair Design

## Goal

Make the repository migration history match the safe production definition of
`public.enforce_ai_content_usage_reversal_identity()` so the least-privilege
`content_application` role can insert a valid usage reversal without receiving
`UPDATE` on the immutable usage ledger.

## Scope

- Add one forward-only post-075 schema migration after 083.
- Replace only `public.enforce_ai_content_usage_reversal_identity()`.
- Keep the function security-invoker, its owner, trigger, search path, validation
  predicates, exception code, relation ACL, and application transaction flow.
- Remove only the row-locking clause from the reservation lookup.
- Do not edit migration 075, backfill data, add compatibility code, or change API,
  worker, UI, quota, retry, or generation behavior.

## Integrity and concurrency

The reservation row is immutable because `ai_content_usage_ledger_immutable`
rejects update and delete. The reversal trigger still validates the reservation
type, workspace, brand, generation, operation, reservation identity, usage date,
and exact negated quantity. The partial unique index on
`reversal_of_ledger_id` still permits only one reversal for a reservation.
Application flows additionally serialize on generation and operation rows before
inserting a reversal. Concurrent direct inserts therefore cannot create two
reversals: one commits and the other receives the existing unique violation, or
the second proceeds if the first transaction rolls back.

## Migration and deployment

- Register migration 084 in the sealed post-075 schema manifest and checksum
  catalog.
- Pin the deployment gate to migration 084 and preserve exact evidence.
- Treat the change as a migration release, not an API-only hotfix.
- Apply the migration before any service rollout. No application image needs a
  behavioral code change.
- Keep the existing production function definition as the expected pre-deploy
  state; migration application is an idempotent semantic replacement.

## Verification

- A static contract test proves the new function has no locking clause and keeps
  all identity checks.
- Migration-runner tests prove 084 is ordered, checksum-pinned, replay-safe, and
  present in the deployment image/gate.
- PostgreSQL 16 integration runs as `content_application`, which retains only
  `SELECT, INSERT` on the ledger, and exercises terminal planner failure and final
  lease exhaustion through the real repository transaction.
- A direct two-session reversal race proves exactly one reversal is stored and
  the loser receives unique violation `23505` without granting `UPDATE`.

## Rollback

The migration changes no data and removes no object. If deployment tooling fails
before the migration commit, the transaction rolls back. Once applied, reverting
to the locking definition would reintroduce the application-role failure and is
not a safe rollback; service images remain independently rollbackable because
their runtime behavior is unchanged.
