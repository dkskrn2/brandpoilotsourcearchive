# Editorial Render Contracts — Final Runtime Boundary

## Active format routes

- Card News: `card-deck-editorial-plan.v1` → deterministic compilation → `ai-content-card-deck-render-job.v1`.
- Reel: `reel-storyboard.v1` → deterministic compilation → `ai-content-reel-storyboard-render-job.v1`.
- Blog: the existing independent `ai-content-render-job.v2` supporting-image route.
- Package finalization: `ai-content-render-job.v1` with `jobKind=package_finalize`; this is not an image-generation fallback.

No card or Reel image job can be enqueued without its corresponding authoritative editorial contract. There is no old-card or old-Reel retry/fallback translation.

## Shared guarantees for Card and Reel

Each format has exactly one model-authored editorial source. Code deterministically derives the public canonical plan and legacy display copy from that source. API validation requires exact compilation equality before storing or enqueuing anything.

Render rows store only the named render version, source SHA-256, scene index, and immutable identity. Claim hydration reloads the full frozen input, canonical public plan, authoritative editorial source, and selected current scene. It recomputes every binding before returning the job.

The image worker stages the authoritative source, current scene, and deterministic compiled prompt as read-only files. It may prepare references and invoke the image tool but must not rewrite editorial copy, numeric relationships, visual thesis, layout archetype, or visual-system invariants.

After a successful asset completion it appends an idempotent private `ai-content-editorial-render-diagnostic.v1` audit event for both Card and Reel. The event binds the source SHA, scene index, compiled prompt version/hash, and only an observed tool-argument hash when the runner actually emits one.

## Explicit non-goals

- Do not reconnect card v2/v3/v4 or Reel v3 image routes.
- Do not translate already queued obsolete Card/Reel image jobs.
- Do not force Blog into the Card/Reel editorial contracts.
- Do not add model calls, sequential image dependencies, DB columns, or migrations.
- Do not change automatic-card source code as part of this delivery.
