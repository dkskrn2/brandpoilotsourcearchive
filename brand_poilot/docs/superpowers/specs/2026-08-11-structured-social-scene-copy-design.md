# Structured Social Scene Copy Design

## Goal

Improve the editorial quality of Instagram card-news cards and Reel scene images by having each planner produce an explicit information hierarchy instead of one undifferentiated `copy` string.

## Scope

- Change only `brand-pilot-card-news-worker` and `brand-pilot-reel-worker`.
- Keep the API completion payload on the existing private draft contracts: `card-news-plan-draft.v1` and `reel-plan-draft.v1`.
- Keep canonical `card-news-plan.v2`, `reel-plan.v2`, `image-generation-package.v1`, render jobs, manifests, publishing, progress, database schema, UI, and image-worker behavior unchanged.
- Do not change blog planning or blog supporting images. Blog HTML is already structured, and its supporting images must not become text-heavy social cards.

## Local Structured Draft

Each social planner emits a worker-local v2 draft. Its asset has these creative fields:

- `index` and `role`: the existing selected-proposal locks.
- `coreMessage`: one internal message the viewer should remember. It is not rendered.
- `headline`: the final conclusion-oriented headline.
- `keyVisual`: `{ type, texts }`, where `type` is `none`, `number`, `before_after`, `comparison`, `steps`, or `quote`, and `texts` contains zero to four display strings.
- `supportingTexts`: zero to two necessary display strings.
- `footnote`: a display string or `null`.
- `visualDirection`: model-authored layout and visual guidance.
- `evidenceIds` and `productImageAssetIds`: the existing evidence and product-image references.

All keys are required by the output schema. Optional creative content uses `[]` or `null`. The schema stays simple and does not use `uniqueItems`, conditionals, or other keywords that have previously caused structured-output rejection. Semantic checks remain intentionally narrow: exact keys and types, bounded text, locked count/index/role, and duplicate-free allowed IDs. The server does not score writing quality.

## Worker-Local Adapter

The worker converts the local v2 draft to the existing v1 completion contract before calling the API.

For each asset:

1. `copy` is the trimmed non-empty display strings joined with `\n` in this order: `headline`, `keyVisual.texts`, `supportingTexts`, `footnote`.
2. `coreMessage` is excluded from visible copy.
3. `visualDirection` preserves the model direction and adds deterministic non-display hierarchy metadata containing the key-visual type and element counts.
4. `index`, `role`, `evidenceIds`, and `productImageAssetIds` pass through unchanged.
5. The constructed v1 draft is parsed once more with the existing shared v1 contract before API submission.

This keeps rolling deployment safe: old and new worker containers both send the same v1 API shape.

## Prompt Changes

- Keep selected card/scene count, order, role, purpose, available facts, evidence, and brand prohibitions fixed.
- Treat proposal outline headlines as planning references, not final copy.
- Require one core message per card or scene.
- Separate important numbers, comparisons, or steps from prose when useful.
- Allow empty optional fields. Do not add filler to make a card look substantial.
- Remove the card-news instruction that says a card must not look sparse.
- Keep caption, hashtags, CTA, attachment handling, and purpose branches unchanged.

## Versioning and Deployment

- Bump only the worker audit versions to `card-news-plan-skill.v4` and `reel-plan-skill.v4`.
- Do not change canonical prompt-binding catalog versions because that would invalidate already frozen generation inputs.
- Package and run a local `*-plan-draft-v2.schema.json` in each worker image.
- Release impact must contain only `cardNewsWorker` and `reelWorker`.

## Error Handling

- The existing two-attempt planner/repair loop remains unchanged.
- A local v2 shape or lock failure enters the existing single repair opportunity.
- Conversion failure uses the existing format-specific `*_plan_invalid` error path.
- No new API error class, retry policy, or database state is introduced.

## Verification

- RED/GREEN tests for both local v2 parsers and deterministic adapters.
- Prompt tests for one-message hierarchy, reference-only proposal headlines, optional fields, and removal of filler pressure.
- Worker tests prove API completion still sends the existing v1 draft.
- Runner/Docker/skill tests prove the v2 schema is packaged and selected.
- Full card-news and Reel worker suites and builds pass.
- `release-impact.mjs` reports only card-news and Reel workers.
- `git diff --name-only` contains no API, UI, image-worker, blog-worker, database, or canonical-contract files.

## Expected Limitations

The image worker still receives canonical `copy + visualDirection`, not the structured JSON itself. This change improves editorial hierarchy without expanding the image contract, but it does not address image anatomy, cross-scene visual consistency, or total generation time.
