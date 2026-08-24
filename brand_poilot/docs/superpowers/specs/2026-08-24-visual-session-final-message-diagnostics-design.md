# Visual session final-message diagnostics

## Problem

The shared image session runner currently converts JSON parse failures, top-level contract failures, and scene/index failures into the same `ai_content_asset_final_message_invalid` diagnostic. This prevents an exact production diagnosis after the ephemeral Codex workspace is removed.

## Approved design

- Keep the strict `ai-content-visual-session-render.v1` final contract unchanged.
- Do not accept prose, code fences, missing scenes, reordered scenes, or additional fields.
- Do not add retries and do not persist the raw model response.
- Classify only safe structural outcomes:
  - `ai_content_visual_session_final_message_json_invalid`
  - `ai_content_visual_session_final_message_contract_invalid`
  - `ai_content_visual_session_final_message_scene_invalid`
- Preserve the existing per-asset/blog final-message behavior.
- Store the safe diagnostic through the existing render-job failure path; no API or DB contract change is required.

## Deployment scope

- API: product image upload URL canonicalization fix already validated locally.
- Image worker: final-message diagnostic classification.
- No UI, DB migration, or other worker changes.

## Verification

- Unit tests for valid JSON and each failure category.
- Image-worker runtime/build tests.
- API upload regression tests and API typecheck/build.
- Production API canary then primary; replace only the image worker.
- Create a new generation with the same input as the failed generation; do not alter old rows.
