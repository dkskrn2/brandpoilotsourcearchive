# Editorial Architecture and Structural Render Labels Design

## Goal

Improve Card News and Reel narrative quality without changing their persisted contracts, scene count, Evidence pool, model-call count, or image-call count. The change also permits short structural labels such as `Step 1` when they improve reading, while continuing to prevent the image stage from inventing substantive content.

The implementation covers all four manual generation paths:

| Output format | Informational | Marketing |
| --- | --- | --- |
| Card News | included | included |
| Reel | included | included |

The four paths share the same narrative-architecture and scene-connection principles. Existing purpose-specific fact boundaries remain in force so that an informational explanation is not imposed on marketing content and marketing claims are not introduced into informational content.

## Context

The Vogue one-off comparison used the same Proposal Lens, five Evidence items, five scenes, planner model, and shared image-session execution. The revised manuscript recovered the missing explanatory bridge about social media weakening traditional scarcity and produced a clearer sequence:

1. central claim;
2. why the shift occurred;
3. operating examples;
4. economic scale;
5. practical design principle.

All five Evidence items remained useful and each scene used one. This result does not support increasing scene count or weakening Evidence grounding. The primary content defect was narrative architecture: the planner could connect sentences without first selecting the explanatory roles needed to reach the final conclusion.

The render experiment also showed that a generic structural label such as `Step 1` can improve scanning and is not itself a factual defect. The current render policy rejects every non-locked string, which is stricter than the desired product behavior.

## Approaches Considered

### A. Bounded structural-label allowance — selected

Permit only short, non-factual labels used to organize locked content. Continue to forbid invented facts, numbers, claims, sources, CTA copy, brands, decorative slogans, and page counters.

This preserves factual authority while allowing the image model to create readable social cards.

### B. Keep locked-copy-only rendering

This maximizes literal control but treats harmless labels as defects and can make steps, examples, and grouped facts harder to scan. It is rejected because the one-off output showed that `Step 1/2/3` did not damage meaning.

### C. Allow unrestricted supporting copy

This gives the image model broad editorial freedom but reintroduces factual drift and makes it impossible to distinguish planner quality from render improvisation. It is rejected.

## Planner Design

The same rules apply to Card News and Reel planners. They run inside the existing single planner call and do not add output fields.

Before writing scenes, the planner internally performs this sequence:

1. review the complete Subject, Evidence pool, and Proposal Lens;
2. decide one central reader outcome for the complete content;
3. identify the `why`, `how`, and `so what` questions that must be answered to reach that outcome;
4. select Evidence by explanatory necessity and editorial value, not merely by how easily it connects to another scene;
5. identify bridge Evidence whose omission would create a logical jump;
6. order the selected Editorial Points;
7. allocate one primary Editorial Point to each scene;
8. write the manuscript;
9. run Delete, Missing-link, and Headline-only self-checks before returning the existing JSON contract.

The planner does not mechanically force all three questions into every content type. They are diagnostic questions used to find missing logical links. Marketing, list, FAQ, comparison, and other formats keep their selected Proposal Lens and may use a different narrative shape.

### Purpose-specific planning

The shared internal sequence does not erase the existing purpose rules.

- **Informational:** optimize for understanding, explanation, analysis, or problem solving. Select the Evidence required to explain the central claim and its implications. Do not introduce sales pressure or unsupported product claims.
- **Marketing:** optimize for a coherent movement from the target customer's situation and need through buying barrier, approved appeal, product or service value, and appropriate action. This is not a fixed scene order. The planner chooses the order that best fits the Proposal Lens and available facts.
- Marketing content continues to keep Subject/Research Evidence and approved product facts as separate factual authorities. A related topic may frame the product, but its claims must not be transferred into product performance, features, price, or outcomes.
- The selected Proposal remains an Editorial Lens for every path. Its outline does not fix final scene order, copy, role, or Evidence allocation.

### Scene-to-scene connection

Scene 1 performs the hook or cover function by establishing the central tension, question, change, promise, or claim. It does not need to use a single fixed role string when the existing contract distinguishes `hook` and `cover`.

From Scene 2 onward, the planner internally decides how each scene relates to the immediately preceding scene. Possible relationships include explanation, expansion, proof, contrast, concretization, deepening, resolution, or a necessary change of perspective. These are reasoning examples, not a new enum, schema field, or mandatory story template.

A change of perspective or subtopic is allowed only when the displayed copy makes its connection to the preceding scene or the central outcome understandable. An unexplained topic switch is forbidden. Each scene must both connect and add a new Editorial Point; grammatical connectors alone do not satisfy this rule.

The relationship should be expressed through information order and, when needed, `supportingTexts`. The planner must not weaken the headline into a transition-only sentence merely to make adjacent scenes sound connected.

### Headline rule

A headline should carry the scene's new claim, fact, question, change, or conclusion. It should not spend its main information budget on connective wording such as “그렇지만” or “경제적 이유도 분명합니다.” Connection should emerge from the ordered information and, when needed, supporting text.

### Self-check rules

- **Delete test:** if removing a scene leaves understanding, persuasion, and tension essentially unchanged, regroup or replace it.
- **Missing-link test:** if the sequence raises an unanswered `why`, `how`, or `so what`, reconsider whether required Evidence was omitted or misplaced.
- **Headline-only test:** headlines alone should communicate progression and new information, not only grammatical continuity.
- **Adjacent-scene test:** from Scene 2 onward, read each scene directly after the previous scene. If the new topic appears without an understandable relationship, revise the order or displayed copy without turning the headline into a connector-only sentence.

These checks do not require equal scene density and do not require excluding strong Evidence when several items support the same Editorial Point.

## Shared Render Design

The Card News and Reel image paths continue to use the same shared visual-session compiler and one image call per scene.

### Artifact identity

Each output is described as one page in a cohesive social editorial card series, not an isolated cinematic poster, magazine cover, or presentation slide. The image model should use readable modular hierarchy while keeping the Deck's selected primary medium consistent. It remains free to choose scene-specific composition and must not repeat a fixed template.

Brand-style references keep their existing priority. When no brand-style reference exists, the image model still chooses one primary medium once for the complete Deck; no specific medium is hardcoded.

### Allowed non-locked text

The image model may add short structural or classification labels only when they organize locked content without adding meaning. Examples include:

- `Step 1`, `Step 2`, `Step 3`;
- `핵심`, `사례`, `포인트`;
- `Before`, `After` when the locked semantic relation is a real before/after relation;
- short numbering used to identify content steps or list items.

These labels are display aids, not new claims. They may not introduce a new factual category, causal interpretation, product promise, or recommendation.

### Text that remains forbidden

- facts, claims, numbers, dates, conditions, sources, or quotations not present in locked display copy;
- invented CTA copy or button labels;
- page numbers, slide counters, pagination badges, or progress markers such as `1/5`;
- invented brand names, product names, logos, or certifications;
- decorative English taglines, slogans, speech bubbles, pseudo-UI copy, or long explanatory text.

Locked copy remains the authority for substantive text, meaning, and numbers. Pixel-level OCR equality remains outside automatic validation and does not trigger retries.

## Contract and Versioning

- No DB migration.
- No API contract change.
- No change to `card-manuscript-plan.v1`, `reel-storyboard.v2`, or `ai-content-visual-session.v1`.
- No new planner or image-model call.
- No retry-policy change.
- No change to scene count, image dimensions, shared-session behavior, or reference-file staging.

Because canonical render-policy content changes, its version must advance from `visual-render-policy.d2pp.v3` to `visual-render-policy.d2pp.v4`. The release manifest is append-only: the v1-v3 entries remain byte-for-byte unchanged and a new v4/hash entry is appended.

Planner skill versions advance independently because their prompt behavior changes. Existing stored plans and completed artifacts are not rewritten.

## Files Expected to Change

- `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`
- `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`
- `workers/brand-pilot-reel-worker/src/promptBuilder.ts`
- `workers/brand-pilot-reel-worker/src/promptBuilder.test.ts`
- `workers/brand-pilot-image-worker/src/aiContentVisualRenderPolicy.mjs`
- `workers/brand-pilot-image-worker/src/aiContentVisualRenderPolicy.releases.json`
- `workers/brand-pilot-image-worker/src/aiContentVisualSessionPromptCompiler.test.ts`
- `workers/brand-pilot-image-worker/src/skillContract.test.ts`
- `workers/brand-pilot-image-worker/.codex/skills/image-render/SKILL.md`

Production contracts and database files are out of scope.

## Verification

1. Card and Reel prompt tests assert the central-outcome, bridge-Evidence, first-scene hook/cover, adjacent-scene relationship, explained-transition, Delete, Missing-link, Adjacent-scene, and information-bearing-headline rules.
2. Render prompt tests assert that short structural labels are allowed while substantive invented text, CTA, page counters, decorative slogans, and new facts remain forbidden.
3. The canonical policy verification script must pass with an appended v4 release entry and fail if an existing v1-v3 entry is modified.
4. Purpose coverage uses four planner fixtures: informational Card News, marketing Card News, informational Reel, and marketing Reel. Each fixture verifies scene progression while preserving its existing purpose-specific fact and CTA boundaries.
5. Marketing fixtures verify that target situation, buying barrier, approved appeal, and product facts may be rearranged into a coherent narrative without transferring unrelated Subject Evidence into product claims.
6. Card News and Reel contract, prompt, shared-session, and image-worker unit suites must pass.
7. A planner-only Vogue regression should preserve the explanatory bridge and the direct `2% / 45%` headline without hardcoding the Vogue topic or exact Evidence.
8. Before merge or deployment, repeat the approved one-off quality check with the same frozen Vogue input and show the result to the user. The A/B harness is validation tooling, not a production runtime path.
9. No stochastic OCR or automatic image retry is added.

## Side Effects

- **Content variation:** planner wording and Evidence order may change because it now prioritizes explanatory necessity. Scene count and fact authority do not change.
- **Render variation:** structural labels may appear even when not present in locked copy. Their bounded semantics prevent them from becoming a second editorial source.
- **Cost and time:** no additional calls; prompt length increases slightly and should have negligible impact compared with model and image-generation time.
- **Existing results:** no backfill or regeneration.
- **Card/Reel parity:** both planners receive the same narrative principles and both formats consume the same v4 render policy.
- **Purpose parity:** informational and marketing paths receive the same connection checks, while their current factual authority and CTA rules remain purpose-specific.

## Completion Boundary

Implementation is complete when the prompt and policy tests pass, the v4 policy release entry is append-only, and the relevant Card, Reel, and Image Worker suites pass. Merge and production deployment require a separate user instruction after reviewing implementation results.
