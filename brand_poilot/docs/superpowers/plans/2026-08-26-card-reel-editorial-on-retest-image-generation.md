# Card/Reel Editorial ON Retest and Operating Image Generation Plan

> **Execution mode:** Run this plan in the current isolated worktree. Do not deploy or write API/DB state.

**Goal:** Correct the two marketing regressions found in the editorial prompt ON test, rerun only the affected ON cells, and render the accepted informational and marketing card/reel manuscripts through the same operating image-worker path used in production.

**Scope:** The prompt correction remains an ignored test overlay under `.tmp/card-reel-editorial-prompt-onoff`. Production prompt source, API, DB schema, worker contracts, and deployments are unchanged. Image generation uses one shared visual session per deck and exactly one audited image call per scene.

## Task 1: Strengthen the marketing Proposal ON overlay

**Files:**

- Modify: `.tmp/card-reel-editorial-prompt-onoff/prepare-prompts.mts`
- Modify: `.tmp/card-reel-editorial-prompt-onoff/run-proposals.mjs`
- Modify: `.tmp/card-reel-editorial-prompt-onoff/prepare-track-c.mts`
- Modify: `.tmp/card-reel-editorial-prompt-onoff/run-planners.mjs`

1. Make `proposalOn` purpose-aware.
2. For marketing only, prohibit inventing a relationship between the subject/product and an unrelated brand/service in the supplied context.
3. Require every offered marketing Proposal to contain at least one directly relevant Research Evidence ID; unsupported angles must not be offered.
4. Add narrow CLI filters so only `marketing-valid`, Track C, ON can be rerun.
5. Regenerate prompts and verify the intended prompt delta is isolated to ON.

## Task 2: Rerun affected ON text generation in operating containers

1. Run marketing-valid Proposal ON for card news and reel in the operating Proposal container.
2. Reject any Proposal without directly relevant evidence or with invented subject/brand linkage.
3. Rebuild Track C from the accepted Proposal.
4. Run marketing-valid Track C planner ON in the operating Card and Reel containers.
5. Run schema and semantic validation; both cells must pass before image generation.
6. Preserve transcripts, timings, model/container metadata, and tool-call counts.

## Task 3: Compile render-ready visual sessions

**Files:**

- Add: `.tmp/card-reel-editorial-prompt-onoff/prepare-operating-image-sessions.mts`
- Add: `.tmp/card-reel-editorial-prompt-onoff/run-operating-image-sessions.mjs`

1. Select four ON manuscripts: informational card, informational reel, corrected marketing card, corrected marketing reel.
2. Parse them with the current production content contracts.
3. Project each manuscript/storyboard with `projectCardVisualRenderSession` or `projectReelVisualRenderSession`.
4. Compile the exact current image-worker prompt and stage the worker `AGENTS.md`, image-render skill, content input, content plan, visual session, and required reference list.
5. Record hashes and expected scene counts in an image manifest.

## Task 4: Render in the operating image worker

1. Reconfirm the running image container, image digest, source revision, Codex CLI version, and relevant source equality.
2. Copy each staged workspace to an isolated `/tmp` path in the running operating image-worker container.
3. Invoke `run-codex-ai-content-asset.mjs` once per deck so scenes share a single Codex visual session.
4. Verify the audit reports exactly one image-generation call per scene and no hidden retry.
5. Normalize with the production dimensions: card news 1080×1080 and reel 1080×1920. Because the user specifically requested vertical cards for this comparison, also produce non-authoritative 1080×1920 card review copies without altering the operating raw/normalized artifacts.
6. Copy outputs and diagnostics back to `.tmp/card-reel-editorial-prompt-onoff/images` and remove only the exact temporary remote/container paths.

## Task 5: Compare and report

1. Verify every output is a valid PNG with the expected dimensions and scene count.
2. Create deterministic contact sheets for review; do not use them as substitutes for individual operating artifacts.
3. Compare the accepted ON text against the existing OFF text for hook, progression, evidence fidelity, subject/brand identity, CTA use, and final payoff.
4. State clearly that this is an operating-container test without API/DB queueing or deployment, and distinguish production-normalized card dimensions from optional vertical review copies.

