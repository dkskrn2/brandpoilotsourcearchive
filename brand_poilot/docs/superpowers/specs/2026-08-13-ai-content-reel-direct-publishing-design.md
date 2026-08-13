# AI Content Reel Direct Publishing Design

**Date:** 2026-08-13
**Status:** Approved
**Scope:** Unified result page for card news, Reel, and blog; completed manual Reel results published directly to Instagram

## Goal

Unify the completed-result experience, show Reel media in its correct 9:16 frame, and publish the already-generated Reel MP4 without rendering another video. Preserve current download, status, failure, and card-news publishing behavior; reuse the production Instagram publisher and publish queue; and remove the unreachable AI-content path that converted card images into a new Reel.

## Result Page UI Scope

The result page for all three output formats—card news, Reel, and blog—no longer presents `기획 근거`, `완성본`, and `게시` as separate tabs. Those tabs split one result into artificial views and separate publishing or download actions from the artifact they act on.

The unified result page contains, in order:

1. generation status and progress;
2. each completed, failed, or in-progress output;
3. the artifact preview;
4. download controls;
5. supported direct-publish controls and their states.

The planning-evidence UI is hidden, but its stored data, API fields, and generation contracts are not deleted or changed. Existing URLs, routing, polling, output selection, ZIP download, retry retention, empty states, partial failure, total failure, and completed-result behavior remain connected to their current handlers.

Reel media uses the actual output aspect ratio:

- a 9:16 player;
- a bounded desktop width of approximately 420px;
- responsive width on smaller screens;
- no square or arbitrary result frame around the video.

Each format retains its own artifact presentation inside the shared result shell:

- card news: ordered image carousel/cards, download controls, and the existing feed/Story publishing controls;
- Reel: the final 9:16 MP4 player, download controls, and the new direct Instagram Reel publishing control;
- blog: the final HTML/article preview and download controls, with no unsupported social-publish action.

The UI work is a shared shell and information-hierarchy change, not a new content or generation feature.

## Current State

- A completed Reel manifest already contains the final `video/mp4`, generated caption, hashtags, and CTA.
- The customer UI marks only `card_news` results as directly publishable.
- The AI-content publish repository accepts only card-news manifests before it creates publish records.
- The repository still contains an unreachable legacy branch that enqueues an `instagram_reel_render` job from card images.
- The production Instagram publisher already supports `instagram_reel` by sending a public `video_url` and caption to Meta.
- The generic publish worker currently reads a top-level `manifest.video`, while the canonical AI-content manifest stores the video in `manifest.assets[]` with `role: "video"`.

## Product Behavior

### Completed card-news result

The existing behavior remains unchanged:

- Instagram feed/carousel remains available.
- Instagram Story remains available.
- Card images are not converted into a Reel.

### Completed Reel result

- The result screen continues to show the generated 9:16 MP4 player.
- The screen offers one supported direct-publish target: Instagram Reel.
- There is no pre-publish caption editor.
- Publishing uses the generated caption and hashtags already sealed in the manifest.
- The existing MP4 is published as-is. No render job, image generation, video assembly, or model call occurs.
- Existing publish states, queue links, actionable errors, retry policy, and reconciliation behavior remain visible through the common publish panel.

### Blog result

Direct social publishing remains unsupported.

## Architecture

```text
completed ai-content Reel output
  -> canonical ai-content.v3 manifest
       - assets[]: exactly one role=video, mimeType=video/mp4
       - content: caption, hashtags, cta
  -> AI-content publish adapter
       - verifies output ownership and completed status
       - verifies generation/manifest format and purpose binding
       - verifies one publishable Reel video
       - creates or reuses topic, draft, group, channel output, and queue
  -> existing publish queue
  -> existing Instagram publisher
       - reads canonical AI video asset
       - sends media_type=REELS, video_url, caption
  -> Meta
```

The AI-content adapter owns the conversion from the canonical AI manifest to the common publishing records. The Instagram publisher remains format-agnostic with respect to the source of the Reel and continues to own the Meta API call.

## Format Matrix

The customer UI and API use the same exact matrix:

| AI output format | Supported direct-publish targets |
|---|---|
| `card_news` | `instagram_feed_carousel`, `instagram_story` |
| `reel` | `instagram_reel` |
| `blog` | none |

The API is authoritative. A manually crafted request cannot publish a card-news result as a Reel or a Reel result as a feed/Story.

## Manifest and Copy Contract

### Card news

The existing card-news manifest validation and output mapping stay byte-for-value compatible.

### Reel

Before any publishing records are written, the adapter requires:

- output status is `completed`;
- generation output format is `reel`;
- manifest output format is `reel` and matches the generation;
- manifest purpose matches the generation;
- manifest content is the social content shape;
- exactly one asset has `role: "video"` and `mimeType: "video/mp4"`;
- the video uses the already-validated canonical asset metadata;
- manifest URL and asset ownership remain tenant-bound and public-storage validated.

The created channel output contains:

- `deliveryFormat: "instagram_reel"`;
- generated caption and hashtags;
- the canonical video descriptor;
- the existing AI-content output binding and request idempotency key.

CTA remains part of the canonical source data but is not newly appended to Instagram copy, matching the current card-news publisher behavior.

## Common Publisher Integration

The common publish worker gains a canonical video extractor:

1. Preserve the existing top-level `manifest.video` extraction used by current non-AI Reel jobs.
2. When absent, read exactly one `role: "video"`, `mimeType: "video/mp4"` asset from the canonical AI manifest `assets[]`.
3. Reject missing, duplicate, or malformed video assets with the stable `reel_video_required` failure.

This is an input adapter, not a compatibility path for the deleted AI re-render flow. It lets the current publisher consume the current canonical Reel artifact directly.

## Idempotency and State

- Target identity remains `(aiContentOutputId, channel, deliveryFormat)`.
- Request identity remains the current target-scoped idempotency key.
- Repeating the same active or published request returns the existing queue result.
- A new request may reschedule an existing failed or cancelled queue only through the current retry rules.
- External success followed by uncertain local persistence continues to use `publish_delivery_unknown` and reconciliation; it must not blindly republish.
- The AI-content-specific `rendering` result state is removed because direct publishing has no render stage.

## Deleted Code

Remove only the obsolete AI-content conversion path:

- `enqueueReelRenderJob` from the AI-content publish repository;
- imports and payload construction used only by that function;
- the `instagram_reel` branch that returns an AI-content `rendering` result without a publish queue;
- API target behavior that permits card-news-to-Reel conversion;
- UI and tests that describe generated Reel as download-only;
- tests that preserve the old AI-content render handoff.

Do not remove:

- the common Instagram Reel publisher;
- generic `instagram_reel_render` support used by current non-AI publishing flows;
- the common publish queue and reconciliation machinery;
- current Reel generation/finalization workers.

## Failure Handling

| Failure | Handling | User outcome |
|---|---|---|
| Output not completed | Reject before transaction writes | Existing clear publish error |
| Manifest/generation mismatch | Roll back | Stable invalid-result error |
| Missing or duplicate MP4 | Roll back before queue creation | Reel cannot be published; no partial records |
| OAuth channel unavailable | Roll back | Connection-required message |
| Public asset unavailable or invalid | Existing publisher failure | Failed target with actionable error |
| Meta container timeout/provider error | Existing queue failure behavior | Failed target and existing retry policy |
| Delivery result unknown | Existing reconciliation state | No automatic duplicate publish |
| Duplicate click/request | Existing idempotency lookup | Reuse existing target/queue |

## Testing

### API unit and repository tests

- Reel manifest creates one `instagram_reel` channel output and one scheduled publish queue.
- The inserted Reel output uses the canonical MP4 and generated caption/hashtags.
- No `jobs` row and no Reel render payload is created.
- Missing, duplicate, or non-MP4 video is rejected before mutations.
- Card-news feed and Story fixtures retain their current SQL and output shape.
- Card-news-to-Reel and Reel-to-feed/Story requests are rejected.
- Repeated and failed-target retry requests preserve current idempotency behavior.

### Common publisher tests

- Existing top-level generic Reel manifests still publish.
- Canonical AI manifests publish their `assets[]` video.
- Missing or ambiguous video assets fail without calling Meta.
- Caption and hashtags reach the current Reel caption formatter unchanged in meaning.

### Customer UI tests

- Card-news, Reel, and blog result pages have no planning/final/publish tab controls.
- Planning-evidence presentation is absent while the generation API shape and route remain unchanged.
- Reel media renders at a 9:16 ratio with the bounded desktop frame.
- Card-news, blog, loading, empty, partial-failure, total-failure, and completed states retain their controls and messages.
- Completed Reel results remain a video preview and expose only Instagram Reel publishing.
- Reel results do not expose caption editing, feed, Story, or card-to-Reel conversion.
- Card-news publish options remain feed/carousel and Story.
- Blog remains unsupported.
- Scheduled, publishing, published, failed, retry, and reconciliation states render through the common panel.

### Route tests

- The existing publish route accepts a valid Reel target and reports its queue result.
- Per-target provider failures remain isolated and observable.
- Unsupported cross-format targets return the existing safe error response.

## Deployment

No database migration and no worker image change are required.

Deployment order:

1. Deploy API canary and verify card-news plus direct Reel publish preparation.
2. Promote API primary.
3. Deploy the customer UI that exposes the Reel publish action.
4. Verify the unified result page, 9:16 Reel frame, one production Reel publish, queue state, Meta result, container revisions, and recent error logs.

API-first deployment keeps the old UI functional. UI-first deployment is prohibited because it could expose a Reel action before the API accepts the new format.

Rollback changes only API and customer UI to their prior immutable digests. No stored AI output or generated MP4 is modified.

## Performance

Direct publishing removes the old render stage. It adds no model call and no media generation. The only long-running operation remains Meta's existing media-container processing and polling.

## Not in Scope

- Caption or hashtag editing before publish: not requested and would introduce a second content source.
- Re-rendering or transcoding the completed Reel: the canonical MP4 is already final.
- Blog publishing: no supported social artifact contract exists for it.
- New database tables, statuses, migrations, or queues: the current queue is sufficient.
- Changes to automatic generation or unrelated publish screens: they use the current common publisher independently.
- Restoring or reading obsolete AI-content card-to-Reel jobs: the path is intentionally deleted.

## Completion Criteria

The work is complete when:

- a completed AI Reel can be published directly from its existing video preview;
- the card-news, Reel, and blog result pages have no planning/final/publish tabs and retain all current state-specific actions;
- the Reel preview matches the final 9:16 media ratio;
- no second Reel is rendered;
- card-news publishing is unchanged;
- the obsolete AI-content render handoff is absent from production source and tests;
- focused API/UI/publisher tests and builds pass;
- API canary precedes the UI in any production rollout.
