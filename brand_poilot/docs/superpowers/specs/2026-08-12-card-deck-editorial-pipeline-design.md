# Card Deck Editorial Pipeline Design

> Final runtime scope (2026-08-12): Card News uses `card-deck-editorial-plan.v1` →
> `ai-content-card-deck-render-job.v1`; Reels use `reel-storyboard.v1` →
> `ai-content-reel-storyboard-render-job.v1`. The previously discussed card v2/v3/v4
> and Reel v3 image routes are not connected. Blog keeps its independent v2 route.

## Goal

Improve card-news quality by preserving the strongest source facts through one deck-level editorial decision and one deterministic render handoff. New manual and future automatic card-news generations use the same card deck engine; proposal selection is the only intentional difference between them.

## Problem

The current card-news flow performs more work than a direct ChatGPT request but can produce weaker results because strong source material is progressively reduced:

1. Proposal generation turns concrete changes, numbers, dates, and audiences into broad concepts.
2. The selected proposal outline is then treated as a locked final storyboard. The card planner must preserve its count, order, and role even when the full frozen evidence supports a stronger edit.
3. Each scene carries useful structured copy, but there is no deck-level narrative or shared visual system.
4. The image worker asks Codex to create the final `image_generation` prompt. This can compress editorial intent into generic instructions even when the upstream data is strong.
5. Automatic card-news proposals are created with `origin='scheduled_crawl'`, but their image jobs are intentionally routed to the old `ai-content-render-job.v1` path. The current repository has no complete automatic proposal-selection-to-generation path worth preserving.

The YouTube example exposed the combined effect: values such as `4,000시간 → 8,000시간`, `1,000만 → 2,000만`, applicability, and timing disappeared before rendering, leaving generic checklist copy that naturally produced generic infographic imagery.

## Locked scope

### Included

- New card-news proposal quality rules for both manual and scheduled proposal batches.
- One card-level `CardDeckEditorialPlanV1` authored by the existing card-news planner call.
- Deterministic compilation from the deck plan into the existing canonical `card-news-plan.v2` and image package.
- A deterministic image-render prompt compiler.
- Card image-worker staging and prompt handoff.
- Render diagnostics sufficient to compare the compiled prompt with the observable Codex tool call.
- A future automatic-selection seam that feeds the same deck engine.

### Excluded

- Customer UI changes.
- Blog and Reel planning or rendering changes.
- New model calls, queues, services, or sequential image generation.
- Rebuilding the automatic scheduler, source crawler, or automatic proposal selector.
- Database schema migrations.
- Repairing or translating old nonterminal card-news jobs.
- Changing completed historical result download, publication, or display contracts.

## Core decisions

### One authored source

`CardDeckEditorialPlanV1` is the only model-authored source for a new card deck. The model does not separately author legacy `copy`, legacy `visualDirection`, or a second image prompt.

```text
LLM-authored CardDeckEditorialPlanV1
        ↓ deterministic compiler
StructuredSceneCopyV1-compatible scene
        ↓ existing flattenStructuredScene()
legacy copy
        ↓ canonical API assembler
card-news-plan.v2
```

The API recomputes these derivatives and requires exact equality. It never compares whether two strings are merely similar.

### Proposal is a concept, not a storyboard

The selected proposal locks:

- selected proposal identity;
- content purpose;
- target audience and chosen angle;
- output format and channel;
- card count.

It does not lock final scene headlines, information allocation, evidence allocation, scene purpose, or layout. The deck planner re-reads the complete frozen subject, research evidence, references, attachments, brand rules, and selected proposal, then edits the final deck within the selected angle and fixed count.

Existing proposal outline `index` and `role` remain compatibility identifiers in the canonical plan. They are not presented to the deck model as immutable editorial decisions. The deterministic compiler maps each final scene to the same continuous index and compatible role slot so the current canonical API, progress UI, manifests, and publishing pipeline remain unchanged.

### Manual and automatic use the same engine

Manual card news obtains the selected proposal from the user. Automatic card news will obtain it from the automatic selector when that subsystem is repaired. From the selected proposal forward, both use the same frozen input, deck planner, compiler, render payload, and image worker.

New render behavior is selected by the presence of a valid `card-deck-editorial-plan.v1` binding, not by `batch.origin === 'manual'`. The current origin-based fallback that forces scheduled card news to render job v1 is removed for new deck-bound jobs.

The current automatic scheduling and proposal enqueue behavior remains available, but this project does not claim to make automatic generation end-to-end functional. It only prevents the new quality architecture from creating another manual-only fork.

## Input architecture

The deck planner must not become URL-specific. It receives a code-derived `CardDeckSourceBundleV1` view of the existing immutable `ContentGenerationInputV3`:

```ts
type CardDeckSourceBundleV1 = {
  intent: {
    purpose: "informational" | "marketing";
    contentInstruction: string | null;
    selectedAngle: string;
    target: string;
  };
  subject: ContentGenerationInputV3["subject"];
  factualSources: {
    frozenResearchEvidence: ContentGenerationInputV3["researchEvidence"];
    productFacts: ContentGenerationInputV3["product"];
  };
  editorialReferences: ContentGenerationInputV3["references"]["selected"];
  visualReferences: {
    brandStyleImages: ContentGenerationInputV3["references"]["brandStyleImages"];
    avatarStyleImageId: string | null;
    attachments: ContentGenerationInputV3["references"]["attachments"];
    userImageInstruction: string | null;
  };
  brandContext: {
    brandCore: ContentGenerationInputV3["brandCore"];
    brandRules: ContentGenerationInputV3["brandRules"];
  };
};
```

This is a worker-local normalized view, not a new public API. A future topic, multiple URL, document, saved reference, or image-reference input extends the existing frozen input and is routed into the appropriate bundle collection. `keyVisual.type` never identifies an input source; it only describes a visual relationship inside one final scene.

## CardDeckEditorialPlanV1

The new persistent private contract is:

```ts
type CardDeckEditorialPlanV1 = {
  contractVersion: "card-deck-editorial-plan.v1";
  content: {
    caption: string;
    hashtags: string[];
    cta: string;
  };
  deckNarrative: string;
  visualSystem: {
    paletteDirection: string;
    typographyDirection: string;
    graphicLanguage: string;
    imageryDirection: string;
    invariants: string[];
  };
  scenes: CardDeckSceneV1[];
};

type CardDeckSceneV1 = {
  index: number;
  editorialRole: string;
  purpose: string;
  coreMessage: string;
  headline: string;
  keyVisual: StructuredKeyVisualV1;
  supportingTexts: string[];
  footnote: string | null;
  visualThesis: string;
  layoutArchetype:
    | "cover_editorial"
    | "stat_focus"
    | "before_after"
    | "comparison"
    | "sequence"
    | "checklist"
    | "quote"
    | "editorial_freeform";
  evidenceIds: string[];
  productImageAssetIds: string[];
};
```

The existing `StructuredKeyVisualV1` relation matrix remains unchanged. New visual types such as timeline or ranking require a future version rather than silent additions.

`visualSystem` is resolved from inputs in this fixed order before the model is asked to write the deck:

1. explicit user image direction;
2. mandatory attachment/reference guidance;
3. approved brand style and brand rules;
4. visual cues present in the content subject;
5. model judgment where the previous inputs are silent.

The prompt receives both the resolved context and this precedence. The model may express the resulting system, but cannot reverse a higher-priority instruction.

## Editorial rules

For information and news content, the deck planner evaluates novelty, numeric change, before/after differences, applicability, timing, and action impact when they support the selected angle. If the subject or title contains the change that makes the content newsworthy, the planner must not replace it with generic background guidance.

Proposal `evidenceIds` are representative evidence for why that concept was proposed. They are not a whitelist for the final deck. Each final scene may use any evidence item from the complete frozen research set and must bind the exact IDs it used.

Scene rules:

- The headline is a concise form of `coreMessage` and cannot introduce a new claim.
- `supportingTexts` adds information not already stated by the headline or key visual. It remains empty when unnecessary.
- Reading only the headlines in order must reveal the deck's core flow and scene relationships without requiring one fixed narrative template.
- `visualThesis` names the visual fact or relationship that should dominate the scene.
- `layoutArchetype` describes arrangement, while `keyVisual` carries the underlying data relationship.
- The first scene may combine a hook with one short content promise.

## Deterministic compilation

Pure functions perform all downstream transformations:

```ts
parseCardDeckEditorialPlanV1(value)
compileCardDeckScene(plan, scene)
compileCardDeckPlan(plan, input)
compileCardRenderPrompt(plan, scene, renderContext)
```

`compileCardDeckScene` derives:

- a `StructuredSceneCopyV1`-compatible scene;
- its persisted compatibility `role` from the selected proposal outline slot at the same index, while preserving the model-authored `editorialRole` only in the deck sidecar;
- `visualDirection` from the deck visual system, scene purpose, visual thesis, and layout archetype;
- legacy `copy` through the existing `flattenStructuredScene()` function.

`compileCardDeckPlan` emits the existing `card-news-plan-draft.v1`, which the API assembles into the existing canonical `card-news-plan.v2`. Card count, continuous indices, evidence ownership, product-image ownership, and all frozen input bindings remain server-validated.

## Image handoff

For every new card deck, the API stores one authoritative deck plan in the existing generation-job JSON and stores only a version, SHA-256, and scene index binding in each render job. Claim hydration recomputes the hash, selects the current scene, recompiles it, and compares it with the canonical image-package asset before returning the job.

The image worker stages read-only files:

```text
inputs/content-generation-input.json
inputs/content-plan.json
inputs/card-deck-editorial-plan.json
inputs/card-deck-current-scene.json
inputs/render-contract.json
inputs/attachments/index.json
inputs/attachments/*
inputs/compiled-render-prompt.txt
```

`compileCardRenderPrompt()` creates the complete image prompt skeleton in code:

```text
[GLOBAL VISUAL SYSTEM]
[SCENE PURPOSE]
[HEADLINE - VERBATIM]
[KEY VISUAL RELATION]
[VISUAL THESIS]
[LAYOUT ARCHETYPE]
[SUPPORTING TEXT - VERBATIM]
[FOOTNOTE - VERBATIM]
[REFERENCE FILES]
[RENDERING RULES]
```

The Codex agent reads the files, prepares references, passes the compiled prompt to `image_generation`, verifies the PNG, and returns the existing completion JSON. It does not summarize, rewrite, translate, or creatively reinterpret the editorial prompt.

Preservation rules are explicit:

- headline, all key-visual labels and values, supporting text, and footnote: character-level preservation;
- key-visual type and relation: structural preservation;
- visual thesis, layout archetype, and visual-system invariants: semantic preservation without dropping or contradicting them;
- `coreMessage`: never displayed.

## Diagnostics

Every card render computes and reports:

- deck contract version and SHA-256;
- scene index;
- compiled render prompt version and SHA-256;
- whether the Codex JSONL stream exposed a stable `image_generation` tool-argument event;
- actual tool-argument SHA-256 when observable;
- an explicit `not_emitted_by_runner` state when it is not observable.

The implementation first captures representative Codex JSONL and proves the stable event shape. It must not fabricate `actualToolArguments`. Render diagnostics use the existing private worker completion and audit-event storage; they must not change customer manifest or asset contracts, and audit failure must not fail an otherwise valid image.

## Error handling

- Invalid deck output uses the existing one repair opportunity; no additional model call is added.
- Contract, relation, evidence, or deterministic-derivation mismatch fails before render enqueue.
- Render claim hash or scene mismatch is terminal for that render job and never falls back to the old renderer.
- New deck-bound card jobs cannot use render job v1, v2, or v3 accidentally.
- Existing historical completed outputs remain readable and publishable through their stored manifests.
- Old nonterminal card jobs are not translated. During cutover they are terminated and recreated under the new contract when needed.
- Automatic proposal batches may continue to reach their current incomplete state. No compatibility code is added to preserve their old rendering behavior.

## Runtime impact

The call graph does not grow:

```text
proposal model call: unchanged
card planning model call: unchanged; output becomes deck-level
repair allowance: unchanged; at most one
image_generation calls: unchanged; one per scene, still parallel
queues and services: unchanged
```

Added work is local parsing, compilation, hashing, and small read-only files. Prompt tokens increase, but no new network round trip or serial dependency is introduced.

## Deployment

This is a coordinated private-contract cutover for:

- content contracts;
- API;
- content-proposal worker;
- card-news worker;
- image worker.

UI, blog worker, Reel worker, marketing worker, and database migrations are excluded unless the actual implementation diff proves a required dependency. A release profile must hard-stop on any unexpected component.

Before deployment:

1. pause new manual and automatic card-news creation;
2. inventory nonterminal card planning and render jobs;
3. terminate obsolete nonterminal card jobs rather than translate them;
4. deploy all API replicas and relevant workers as one contract set;
5. resume card-news creation;
6. run a manual production canary using the Growthline account;
7. verify the stored deck, compiled prompt, render diagnostics, images, download, and publication.

Automatic generation is not a canary acceptance dependency because its selection/start subsystem is currently incomplete. Once repaired, it must connect to the same deck-start boundary and must not introduce a second automatic-only card planner or renderer.

Rollback after new deck jobs exist requires pausing new card-news work and draining or terminating deck-bound jobs before restoring an older API or worker set. An old binary must never claim a new deck-bound job.

## Verification

- Shared contract tests for exact keys, limits, relation types, derivation, and hashes.
- Proposal tests proving card proposals may bind representative evidence independently while remaining within the full frozen set; blog and Reel proposal behavior remains unchanged.
- Planner tests proving full frozen evidence is available, proposal outline text/order is advisory, card count remains fixed, and strong facts survive.
- API tests proving exact compiler equality, atomic persistence, success replay, and no old-render fallback.
- Image-worker tests proving read-only staging, deterministic prompt bytes, exact text preservation, reference inclusion, and diagnostic availability handling.
- PGlite/PostgreSQL tests for render binding, retry, and claim hydration where the existing harness supports them.
- Full content-contract, proposal-worker, card-worker, image-worker, and focused API suites and builds.
- Protected-path check for UI, blog, Reel, marketing worker, and migrations.
- Production canary only after a separate explicit deployment instruction.

## Acceptance criteria

- A card deck can preserve and foreground the strongest relevant frozen facts instead of inheriting a generic proposal outline.
- The selected angle and count remain intact while final scene content and ordering are deck-editorial decisions.
- Manual and future automatic card news share the same post-selection engine.
- The rendered copy exactly equals the deterministic flattening of the authored scene.
- The image worker receives a complete deterministic prompt and cannot silently reduce it to a generic infographic request without leaving diagnostic evidence.
- No additional model call or serial render dependency is introduced.
- UI, blog, Reel, existing completed history, download, and publication behavior remain unchanged.
