# Reference Library Repair Design

## Goal

Close the four Task 9 review gaps without weakening tenant isolation, upload cleanup,
snapshot fidelity, lazy loading, or accessibility.

## Reference Upload Lifecycle

Reference uploads receive their own cancellation model in migration 064. A
`reference_upload_cancellation_receipts` row records the upload session, workspace,
brand, actor, exact reference reservation prefix, optional exact blob path, token
expiry, cancellation reason, retry schedule, attempt count, and terminal status.
Avatar receipts remain unchanged and migrations 059/060 remain reserved.

Reference confirm, user cancellation, and expiry finalization serialize on the same
session advisory lock followed by the session row lock. A confirm that wins consumes
the session and preserves the resulting reference and storage artifact. A cancel that
wins marks the session cancelled and creates a durable receipt; later confirm attempts
fail. Cleanup is not considered terminal until the token expiry grace has elapsed and
both the exact path and any blobs under the exact reservation prefix have been
removed. Legacy rows without a stored exact path are cleaned by the validated prefix.
The due index and bounded worker selection preserve fairness.

Cleanup must re-check whether a storage artifact under the prefix is referenced by a
consumed reference item. Such content is preserved and the obsolete session/receipt
is finalized without deleting the artifact. Cleanup functions validate reference and
avatar prefixes independently.

## List and Detail Data

`GET /brands/:brandId/references` returns card data only: stable identity, origin,
title, thumbnail, format, purpose, favorite state, timestamps, reference-brand
identity, a pattern-availability flag, and upload file metadata where relevant. It
does not return full captions, artifact bodies, source text, or pattern analysis.

`GET /brands/:brandId/references/:referenceId` is tenant- and brand-scoped and
returns the full detail only when a dialog opens. For external URL references, the
read-only query selects the latest successful `source_snapshots` row using the real
schema: `extracted_title`, `summary`, `extracted_text`, and `metadata`. It falls back
to the stored reference snapshot, including legacy migration 058's
`metadata.description`, and retains the stored original link when the live source is
disabled or its latest crawl fails.

GET requests never mutate `reference_items.metadata`. Snapshot normalization belongs
to a crawl or explicit idempotent maintenance write path. This repair adds a defined
write-path contract test for persisted normalized fields. If the current crawler
cannot be safely extended in this task, live detail uses the latest successful
snapshot while legacy stored metadata remains the retention fallback.

## UI Behavior

The direct-add view accepts only the server reference allowlist. It hashes each file,
rejects checksum duplicates, requests a reference upload token, uploads with progress,
and confirms the session. Remove, dialog cancellation, retry, and unmount cancel any
unconsumed session. Failed cleanup remains visible and retryable rather than claiming
success. Uploaded images display their actual object URL thumbnail; other accepted
files display actual name, MIME type, and byte size.

Reference detail opens by fetching the detail endpoint, then optionally loads pattern
analysis from its dedicated endpoint only when the card advertises availability.
Saved-brand content cards open this same dialog. Both reference dialogs trap focus,
close on Escape, close on backdrop interaction, and restore the prior focus.

Every card visibly displays favorite state. Writable collections expose a safe
favorite toggle; read-only cards show a textual favorite/not-favorite state and do
not imply mutation.

## Errors and Recovery

Validation errors identify unsupported types and size limits before token issuance.
Upload errors distinguish local validation, hashing, transfer, confirmation, and
cleanup failure in user-facing state. A retry first cancels the previous unconsumed
session, then reuses the checksum for a fresh reservation. API scope or actor mismatch
is reported as not found/forbidden through existing stable HTTP mappings without
revealing cross-tenant records.

## Verification

Tests are written and observed failing before implementation. Coverage includes
migration registration and constraints, exact-prefix cleanup, late uploads, pathless
legacy rows, fairness, tenant/actor mismatch, confirm/cancel races, consumed reference
preservation, summary/detail separation, real snapshot fallbacks, route scope,
hash/duplicate/retry/remove/dialog cancellation, detail laziness, favorite visibility,
and dialog keyboard/focus behavior. Final verification runs focused API, UI, migration,
contract, build, and diff checks.
