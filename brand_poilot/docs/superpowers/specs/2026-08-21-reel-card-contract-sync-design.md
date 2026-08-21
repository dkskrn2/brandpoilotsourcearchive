# Reel/Card manuscript contract synchronization

## Goal

Bring new manual Reel planning to the same editorial trust boundary as Card News without changing research, proposals, the shared image session, references, image generation, or FFmpeg assembly.

## Contract boundary

- New Reel planning emits `reel-storyboard.v2`.
- `reel-storyboard.v1` is not mutated. Existing persisted v1 payloads remain readable, but no new job is created or retried through v1 after cutover.
- No database migration is required; the versioned contract is stored inside the existing JSON payload.

## Reel v2 shape

- Keep `content`, `storyNarrative`, scene editorial copy, Evidence IDs, and product/avatar bindings.
- Add `evidenceSelection.selectedEvidenceIds` and `excludedEvidenceIds`.
- Rename scene `keyVisual` to semantic `informationRelation`.
- Remove `visualSystem`, `visualThesis`, and `layoutArchetype`.
- Use the same information-relation schema and semantic validation as Card News.

## Validation

- The selected/excluded lists exactly partition the complete frozen Evidence pool.
- Selected Evidence exactly equals the union of all scene Evidence IDs.
- Informational scenes require Evidence except exact `transition` and `cta` roles.
- Scene headline and core message values are unique.
- Relation types enforce the Card rules for `none`, `number`, `before_after`, `comparison`, `steps`, `quote`, and `related_facts`.
- Scene count and deterministic compatibility projection stay bound to the frozen Proposal asset count/outline roles; the outline is not returned to the model.

## Rendering

- `informationRelation` is projected unchanged into the existing visual-session `lockedDisplay.relation`.
- Brand style, avatar, product and attachment reference handling remains unchanged.
- Shared Codex/image session, 1080x1920 canvas, one image call per scene, and FFmpeg assembly remain unchanged.

## Deployment boundary

API, Reel Worker, and Image Worker must be deployed as one maintenance-fenced contract cutover after new v1 work is drained or discarded. The Image Worker behavior is unchanged, but its accepted visual-session source-version union must include Reel v2. DB and customer UI are unchanged. The existing coordinated release profile conservatively rebuilds Content Proposal and Card News images because the versioned content-contract package is shared; those two services receive no behavior change in this patch.
