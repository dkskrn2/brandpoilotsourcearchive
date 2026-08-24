# Card News Attachment Reference Design

## Goal

Prevent card manuscript planning from treating generation-scoped attachment IDs as registered product image asset IDs while preserving both image sources for the downstream image worker.

## Confirmed production failure

Generation `da0bcf7e-1a7c-46ce-aab6-3716acd2096d` had no registered product images and one confirmed `product_image` attachment. The card manuscript planner returned a non-empty `productImageAssetIds` value, so validation failed with `card_news_plan_invalid:product_image_id_unknown` before any render job was created.

## Design

- Registered product images remain scene-level bindings through `productImageAssetIds`.
- Only IDs from `factualSources.product.availableImages` may appear in `productImageAssetIds`.
- Generation-scoped attachments remain separate `visualReferences.attachments`.
- Attachment IDs must never be copied into `productImageAssetIds`.
- The image worker continues staging all confirmed attachments and exposing them under `REFERENCE FILES`.
- An attachment with role `product_image` is described as a product-appearance reference for relevant scenes.
- Existing validation continues rejecting unknown product image IDs. No coercion or silent removal is added.

## Scope

Modify only the card-news planner prompt, its auditable skill version, and card-news regression tests. Do not change API contracts, database schema, render-session contracts, image-worker staging, Reel, Blog, or publishing.

## Error handling

The existing single repair opportunity remains. Its prompt receives the same explicit namespace rules and the closed creative context containing registered image IDs and attachment IDs separately.

## Verification

- Registered product image only: registered ID is allowed.
- Product attachment only: planner is instructed to leave `productImageAssetIds` empty while the attachment remains in `visualReferences.attachments`.
- Both sources: registered IDs remain selectable and attachment IDs remain separate.
- An attachment ID returned in `productImageAssetIds` is still rejected.
- Card-news worker tests and build pass without API, DB, or image-worker changes.
