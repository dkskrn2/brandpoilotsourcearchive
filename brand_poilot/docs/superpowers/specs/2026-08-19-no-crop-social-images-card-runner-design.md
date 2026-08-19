# No-crop social images and card runner design

## Goal

Prevent the image worker from cutting generated Card News or Reel content while preserving the current square and vertical delivery contracts, and prevent a Card News worker image from being rolled out with a stale planner command.

## Scope

- Card News visual-session images: replace the square center crop with a no-crop square canvas.
- Reel visual-session images: replace the 9:16 center crop with a no-crop 1080x1920 canvas.
- Card News deployment: fail before worker mutation when the live worker env does not select `run-codex-card-manuscript-plan.mjs`.
- The production rollout procedure may update the one known stale live env declaration after backing it up, but application code never falls back to a removed runner.

Out of scope: OCR, image regeneration, retry-policy changes, API or DB contract changes, UI changes, and changes to Blog or automatic-content behavior.

## Image normalization

The CLI PNG remains the semantic image source. The worker validates that it is a non-empty PNG, scales it proportionally with `fit: contain`, and places the entire source on a fixed delivery canvas. It must not use `extract`, `crop`, `fit: cover`, or independent width/height stretching for Card News or Reel visual sessions.

- Card News result: 1080x1080.
- Reel result: 1080x1920.
- Background: an opaque neutral canvas. The first implementation does not create a blurred duplicate because that could introduce ghost text.
- All original content remains visible. Scaling can reduce or enlarge the image but must preserve its aspect ratio.

The Blob asset remains the normalized delivery image rather than a variable-size raw artifact. This keeps the existing render completion, manifest, finalizer, UI, download, and Instagram contracts unchanged. FFmpeg receives already-normalized 9:16 scenes and performs no crop.

## Card planner command deployment invariant

The Card News worker has exactly one supported planner runner: `scripts/run-codex-card-manuscript-plan.mjs`. The repository examples and image already contain that runner. Worker rollout must additionally inspect the actual host env file before replacing a Card News container and require exactly:

```text
CARD_NEWS_CODEX_PLAN_COMMAND=node scripts/run-codex-card-manuscript-plan.mjs --job "{{jobFile}}" --output "{{outputDir}}"
```

An absent, duplicate, stale Deck command, or any other value aborts before `docker compose up`. No compatibility fallback is added.

## Verification

- RED/GREEN tests use asymmetric source PNGs with colored edge and corner markers.
- The Card News output is 1080x1080 and retains all four edge colors.
- The Reel output is 1080x1920 and retains all four edge colors.
- Multiple source aspect ratios retain their complete foreground without distortion.
- Existing visual-session failure, diagnostic, Reel renderer, storage, and manifest suites remain green.
- Deployment contract proves the live Card News env check occurs before the rollout mutation.
- Image-worker build and deployment static checks pass.

## Side effects and limits

When the generated source is not square or 9:16, background bands will appear and the foreground may be smaller than the previous cropped result. This is intentional: preserving content takes priority over edge-to-edge filling. The change prevents worker-induced clipping but cannot correct text already malformed by the image model.
