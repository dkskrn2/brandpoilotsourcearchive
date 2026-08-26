# Card/Reel Editorial Prompt Quality Design

Date: 2026-08-26

Status: corrected ON accepted and option 1A approved for Production implementation; not yet implemented, merged, or deployed

## 1. Goal

Improve the Proposal and final manuscript/storyboard decisions used by manual Card News and Reel generation so that outputs read as one coherent social editorial narrative instead of a collection of individually accurate infographics.

The change applies to all four combinations:

| Purpose | Card News | Reel |
| --- | --- | --- |
| Informational | included | included |
| Marketing | included | included |

The main change is prompt behavior, not a new content architecture. Existing Research, Proposal selection, Card Manuscript, Reel Storyboard, and shared visual-session stages remain in place.

## 2. Confirmed Product Decisions

- The change is not limited to the first-scene hook.
- The planner uses a `first scene -> middle scenes -> final scene` model. Scene 2 has no dedicated role or payoff rule.
- The Proposal model does not make the final Evidence partition. It identifies Evidence representative of each Proposal angle; each marketing Proposal must bind at least one directly relevant Evidence claim to visible Proposal meaning rather than attach an ID as a compliance marker.
- The Card/Reel planner reviews the complete frozen Subject and Evidence Pool and makes the final selected/excluded partition.
- Proposal fields keep their current meanings. The prompt only discourages near-identical repetition across `title`, `hook`, `oneLineIntent`, and `keyMessage`; it does not impose strict independent roles.
- The planner internally chooses a suitable editorial progression before writing an outline or scenes, but does not emit a new mode field or follow a fixed slide formula.
- Verification data and displayed copy are treated separately, while content-defining facts remain visible.
- No new density limit is introduced. Existing contract limits and existing overload review remain unchanged.
- A marketing CTA is an optional supporting scene/copy element, not a required final-scene center. The existing required `content.cta` field remains a candidate action string and is not automatically promoted into a Scene.
- Marketing keeps Subject, Product, Brand Core, References, and Research Evidence as separate authorities, preserves exact marketing purpose/product identity, and never invents a relationship among them.
- A directly relevant Evidence item used to justify the selected marketing Proposal remains visible in a non-CTA Scene even when approved product facts can otherwise complete the purchase explanation. It is not transferred into proof of product performance.
- User-visible Card/Reel copy receives natural-Korean prompt guidance. Internal planning fields are excluded, factual names/numbers/conditions/source qualifiers remain intact, and no naturalness score or runtime validation stage is added.
- No new model call, retry, schema field, scene-count rule, image call, or image policy is introduced.

## 3. AS-IS

### 3.1 Proposal

The current Proposal prompt already:

- returns three materially differentiated Proposals;
- supports target, situation, question, appeal, narrative, and informational-type differentiation;
- preserves Subject identity and core facts;
- treats Proposal Evidence as representative rather than a final whitelist;
- lets the model choose one to five visual assets.

However, it does not consistently require the model to decide the reader/customer payoff and the most suitable editorial progression before producing the three Proposals. `informationalType` can become a label without materially determining the outline. Marketing performs an internal customer-value analysis, but the selected story shape is still implicit.

### 3.2 Card/Reel planner

The current planners already:

- treat the Proposal as an Editorial Lens;
- reread the full Subject and Evidence Pool;
- determine a central outcome;
- use one primary Editorial Point per Scene;
- check scene connection and information progression;
- run Delete, Missing-link, Headline-only, and Adjacent-scene checks;
- partition the Evidence Pool and attach IDs only to claims actually used.

The conflicting priority is Evidence preservation. Current instructions strongly prefer retaining every relevant strong Evidence item and resolving overload through regrouping or redistribution. This can pull a strong but narratively unnecessary fact into a deck. The Fanta AI-angle experiment demonstrated this when the `10 billion impressions` fact was inserted into an AI-production narrative even though it did not directly answer that angle's central question.

The current prompts also do not explicitly require the final Scene to answer the opening interest or promise. Display-copy selection is performed after a large amount of factual material has already been preserved, so the result can remain a set of connected but independently complete infographics.

## 4. TO-BE Design

## 4.1 Proposal pre-editing

For Card News and Reel Proposals only, each Proposal is internally planned in this order:

1. identify a concrete reader or customer situation;
2. decide what the reader should understand, discover, judge, or be able to do after finishing;
3. identify why the content is worth viewing now;
4. identify the strongest change, number, contrast, case, process, problem, or product decision available in the frozen sources;
5. choose a suitable editorial progression;
6. select the provisional Editorial Points and order needed to reach the payoff;
7. write the existing Proposal fields and provisional outline.

This reasoning is internal. It creates no new output field and is not a fixed Scene formula.

The three Proposals must differ materially in at least one of:

- reader/customer situation;
- central payoff;
- opening angle;
- central Evidence or factual focus;
- editorial progression;
- final judgment or use.

The existing `title`, `hook`, `oneLineIntent`, and `keyMessage` semantics remain unchanged. Overlap is allowed when it improves coherence. The only new rule is that all four should not restate the same sentence with superficial wording changes.

The new Proposal rules are guarded by `outputFormat !== "blog"`. Blog prompt behavior remains unchanged, although the global Proposal prompt lineage advances to v4.

## 4.2 Internal editorial progression selection

The model first identifies what makes the frozen material editorially useful, then selects an appropriate progression. Examples are reasoning options, not enums or mandatory templates.

Informational examples:

- change-led: change -> background -> meaning;
- data-led: surprising result -> explanation -> interpretation;
- case-led: concrete result -> operating method -> applicable judgment;
- problem-solving: problem -> cause -> response -> caution;
- comparison: relevant difference -> conditions -> selection criteria;
- tutorial/checklist: goal -> necessary actions -> failure points -> completion criteria;
- myth correction: common belief -> contrary Evidence -> corrected judgment.

Marketing examples:

- customer-situation-led;
- buying-barrier-led;
- approved-value proof;
- use-case-led;
- comparison or selection-criteria-led;
- product-mechanism-led;
- brand-case or brand-story-led.

The current marketing reasoning ingredients remain available: customer situation, job to be done, buying barrier, approved value, product or Subject fact, proof, limitation, judgment, and optional action. They are not copied into a fixed Scene order.

## 4.3 Evidence responsibility and selection

### Proposal stage

- Evidence IDs are representative of the Proposal angle.
- They are not a final whitelist or final selection.
- For marketing, every Proposal includes at least one directly relevant Evidence item and makes its actual claim meaning visible in the Proposal. An Evidence ID by itself does not satisfy this rule.
- The complete frozen Evidence Pool continues downstream.

### Card/Reel planner stage

- Review the complete Subject and Evidence Pool.
- Decide the central payoff again using the selected Proposal as a Lens.
- Select Evidence required to understand or substantiate the chosen question, claim, and payoff.
- Prefer bridge Evidence when omitting it would create a logical jump.
- Allow a strong Evidence item to be excluded when it is not needed by the selected narrative.
- Combine multiple Evidence items in one Scene only when they directly support the same Editorial Point.
- Do not place an Evidence item merely because it remains unused.
- Preserve the exact selected/excluded partition and Scene-union invariants.

This change relaxes the current instruction that nearly every strong relevant Evidence item must be preserved. It does not weaken factual grounding or allow unsupported claims.

## 4.4 Verification data and displayed information

Evidence IDs and full source details support verification and audit. They do not require every supporting detail to appear on screen.

The following content-defining information must remain visible in `headline`, `informationRelation`, `supportingTexts`, or `footnote` when it is needed to understand the claim:

- subject identity and named entities;
- the core change or claim that makes the content meaningful;
- decisive numbers, comparisons, or facts supporting the conclusion;
- conditions, scope, timing, and affected audience when omission would change meaning;
- bridge information whose omission would create a logical jump.

The following may remain in Evidence/audit context or move to caption/footnote when it does not alter the displayed claim:

- additional proof repeating the same conclusion;
- secondary examples that do not change the payoff;
- source-tracking metadata;
- details already represented by another displayed statement;
- strong facts unrelated to the chosen narrative.

The planner runs an Essential-information check:

> If removing a fact from displayed copy changes the claim's meaning, credibility, scope, condition, or logical continuity, keep the fact visible.

No new density or character-count limit is added as part of this rule.

## 4.5 Scene editing

### First Scene

- Avoid a cover that merely repeats the topic or article title.
- Establish the opening interest through a suitable claim, change, number, contrast, question, or benefit.
- Establish the central interest or promise that the remaining content will answer.
- Do not force one universal hook formula.

### Middle Scenes

- Use as many middle Scenes as the existing locked `assetCount` provides.
- Add a necessary fact, relationship, interpretation, or judgment in each Scene.
- Maintain an understandable relationship to the preceding Scene or the central outcome.
- Do not require a special Scene 2 role.
- Do not add `Scene-2 payoff` or `second hook` tests.
- Do not force narratively unnecessary Evidence into a Scene.

### Final Scene

- Do not merely paraphrase the first Scene.
- Answer the opening interest with a new judgment, result, implication, or practical use.
- For informational content, complete the understanding or application payoff.
- For marketing content, complete the fit/value/condition judgment.
- Add CTA copy or a CTA Scene only when it naturally follows from the completed payoff.
- Keep the existing maximum of one CTA Scene and do not introduce a minimum.

Existing Delete, Missing-link, Headline-only, and Adjacent-scene checks remain. The added checks are limited to:

- Reader-payoff: the complete content provides a concrete reason to finish;
- Topic-label: the first Scene does more than identify the topic;
- Promise-payoff: the final Scene answers the opening interest;
- Scene-progression: middle Scenes add necessary information;
- Evidence-necessity: selected Evidence contributes to the chosen narrative;
- Essential-information: content-defining facts remain displayed.

No First-glance, Simplicity, Scene-2 payoff, new word-count, new number-count, or new three-second-density acceptance gate is introduced.

## 4.6 Purpose-specific boundaries

### Informational

- Optimize for understanding, discovery, judgment, or practical application.
- Keep sales pressure and unsupported product claims out.
- Use Evidence required to explain the central question and implication.
- Keep existing non-sales CTA rules; a CTA Scene remains optional.

### Marketing

- Optimize for a grounded customer decision, not a sequence of product adjectives or CTA Scenes.
- Use concrete customer situation and buying-barrier claims only when supported by Subject, Evidence, or approved product context.
- Use the approved product snapshot as authority for product attributes.
- Keep Subject facts and product facts separately attributed when they describe different entities.
- Do not turn a product subject into an unrelated Brand Core product/service case or invent a relationship absent from the frozen inputs.
- Preserve `purposeDetails.kind="marketing"` and the exact frozen product ID in every Proposal.
- Do not use unrelated Research Evidence as proof of product performance.
- Preserve directly relevant Evidence supporting the selected Proposal in an actual non-CTA Scene, even when product facts alone can explain the purchase decision.
- Preserve meaningful conditions and limitations.
- Complete the value/fit judgment before any optional CTA.
- Keep `content.cta` as the existing required candidate action field, but do not force it into displayed Scene copy.

## 5. Contracts, API, and DB

No public contract shape changes:

- `content-proposal.v2` remains;
- `card-manuscript-plan.v1` remains;
- `reel-storyboard.v2` remains;
- `content-generation-input.v3` remains;
- existing Scene and Evidence fields remain;
- no API request or response field changes;
- no UI changes;
- no data rewrite or backfill.

The Proposal prompt change must not be recorded under the existing lineage. Therefore:

- advance `proposal.writer.v3` to `proposal.writer.v4`;
- regenerate canonical catalog/hash artifacts;
- add a DB migration that preserves the existing v2/v3 tuples and allows the exact v4 prompt/catalog/hash tuple in Proposal job contracts and generation prompt bindings;
- deploy the API with the v4 catalog because the API creates those bindings;
- deploy the matching Content Proposal Worker.

This DB change is CHECK-constraint-only:

- no table or column addition;
- no existing-row mutation;
- no permission change;
- no removal of historical lineage tuples.

Card and Reel planner prompt changes advance their worker `skillVersion` values. Their output contracts and DB schema do not change.

## 6. Failure and Retry Behavior

- Keep the existing model-call count.
- Keep the existing single repair opportunity for contract-invalid planner output.
- Add no quality-judge model call.
- Add no automatic quality retry.
- Add no fallback Proposal, generic deck, or legacy planner path.
- Keep existing Evidence partition, entity-attribution, marketing grounding, and CTA-count validation.

## 7. ON/OFF Validation Design

The initial text ON/OFF and corrected marketing retest are complete. The corrected ON was then rendered through the running operating Image Worker: four decks, 18 Scenes, 18 audited image calls, and zero image retries. `.tmp/card-reel-editorial-prompt-onoff/IMAGE-REPORT.md` is the accepted source of truth; the earlier uncorrected ON draft is not an implementation target. This evidence used operating containers but intentionally bypassed API/DB queues, so it proves worker-path compatibility rather than a deployed Production-path run.

### 7.1 Test matrix

Run all four cells:

| Case | Purpose | Format |
| --- | --- | --- |
| I-C | informational | card_news |
| I-R | informational | reel |
| M-C | marketing | card_news |
| M-R | marketing | reel |

Use production-shaped frozen inputs without Production DB writes:

- informational: the frozen Fanta source/Evidence bundle already used by the earlier experiment;
- marketing: a frozen production-shaped marketing case that contains Subject, approved product facts, Research Evidence, customer context, limitations, and CTA candidates. Prefer the previously investigated generation `743a7abc-15f8-4763-b291-bfcb89db634e` if its exact frozen bundle is available; do not reconstruct missing production facts from memory.

Within each ON/OFF pair, hold constant:

- frozen Subject and Evidence;
- brand and product snapshot;
- purpose and output format;
- model and reasoning effort;
- schema and parser;
- tool permissions;
- attempt policy;
- scene count for planner-isolation tests.

Only the target prompt rules differ.

### 7.2 Track A: Proposal isolation

- OFF: current `proposal.writer.v3` prompt.
- ON: proposed `proposal.writer.v4` prompt.
- Run one Proposal response per purpose/format pair under the same frozen input.
- Compare all three Proposals for meaningful differentiation, editorial progression fit, field redundancy, and unsupported promises.
- Do not run final planners in this track.

### 7.3 Track B: planner isolation

- Freeze one valid Proposal Lens per input and pass the exact same Lens to OFF and ON.
- OFF: current Card/Reel planner prompt.
- ON: proposed Card/Reel planner prompt.
- Keep identical `assetCount` and Evidence Pool.
- Compare Evidence partition, first/middle/final progression, final payoff, essential displayed information, entity attribution, and CTA use.

This track identifies planner effects without Proposal variance.

### 7.4 Track C: complete text flow

- OFF: current Proposal followed by current planner.
- ON: revised Proposal followed by revised planner.
- Record which Proposal was selected and why; do not pretend two materially different lenses are the same treatment.
- Compare the complete Proposal-to-manuscript behavior after Tracks A and B make the source of differences understandable.

### 7.5 Evaluation rubric

For each result, report evidence rather than a single opaque score:

- Are the three Proposals materially different?
- Does the selected editorial progression fit the frozen source and purpose?
- Do Proposal fields avoid superficial repetition without being forced into artificial independence?
- Does the first Scene do more than label the topic?
- Do middle Scenes add necessary information without a special Scene 2 formula?
- Does the final Scene answer the opening interest?
- Is every selected Evidence item necessary to the chosen narrative?
- Are content-defining names, numbers, conditions, timing, and scope still displayed?
- Are verification-only details prevented from overcrowding or diverting the narrative without applying a new density limit?
- For marketing, are Subject and product facts separately attributed?
- For marketing, is CTA subordinate to a completed value/fit judgment and omitted from Scenes when unnecessary?
- Do all existing schemas and deterministic validators pass?

Explicitly record regressions, neutral differences, and stochastic uncertainty. Do not claim that a single stochastic output proves universal improvement.

### 7.6 Stop boundary

Stop after complete text results and a side-by-side report. Do not change Production state, merge, deploy, generate images, or relax a failed contract gate without a separate decision based on the observed results.

## 8. Expected Change Surface

- Content Proposal Worker prompt and tests;
- Card News Worker prompt, skill version, and tests;
- Reel Worker prompt, skill version, and tests;
- shared content-contract catalog prompt version and regenerated catalog/hash artifacts;
- DB prompt-lineage CHECK migration and PostgreSQL application-role integration test;
- API/catalog lineage fixtures required by the v4 tuple;
- scoped release-impact and preflight checks that enumerate the new migration, avoid unrelated Blog/Image Worker recreation, and fence the Proposal v3/v4 transition.

Out of scope:

- Image Worker and visual render policy;
- Research algorithm changes;
- public API shapes;
- UI;
- Blog prompt behavior;
- automatic content;
- existing generated artifacts or data backfill.

## 9. Verification and Deployment

Before implementation is considered complete:

1. Proposal prompt tests cover informational/marketing Card/Reel and verify Blog exclusion.
2. Card/Reel prompt tests cover both purposes, first/middle/final progression, Evidence necessity, essential-information preservation, optional CTA Scenes, the corrected marketing Evidence rule, and natural user-visible copy guidance.
3. Tests verify the absence of a new Scene 2 rule and new density gate.
4. Existing Proposal, Card Manuscript, Reel Storyboard, Evidence, marketing, and entity-attribution validators pass unchanged unless a test expectation directly encodes the superseded Evidence-preservation prompt.
5. Canonical generated catalog integrity passes with `proposal.writer.v4`.
6. The DB migration is executed against real PostgreSQL using the production-equivalent application role.
7. Existing v2/v3 prompt-lineage tuples remain valid, the exact v4 tuple succeeds, and invalid mixed tuples fail.
8. Tracked Production builders reproduce every corrected ON rule and pass the four operating-equivalent text/image flows without adding a runtime quality gate.

The user approved option 1A. Deployment uses a short Proposal-only creation window because queued Proposal jobs are bound to an exact prompt version:

1. build digest-pinned API, Proposal, Card, and Reel images while preserving the current Blog/Image digests;
2. deploy the v4 API canary and append-only migration with new Proposal creation disabled;
3. promote the v4 API with Proposal creation still disabled;
4. let the old v3 Proposal worker finish all queued/processing v3 jobs through the v4 API;
5. after the v3 queue and leases reach zero, replace Proposal, Card, and Reel workers and verify fresh heartbeats;
6. re-enable Proposal creation only after the v4 API/Proposal-worker pair is healthy;
7. verify external health, actual container digests, restart counts, recent errors, and any explicitly authorized Production generation.

Image Worker, UI, Research Worker, and Blog Worker are not deployment targets.

Rollback restores the API and affected workers to their previous verified digests. Before a v4-to-v3 Proposal rollback, disable new Proposal creation and drain all v4-bound jobs with the v4 worker. The DB migration remains because it only permits the additional exact v4 tuple and continues to preserve v2/v3.

## 10. Completion Boundary

This design is complete when the corrected ON semantics, natural-copy guidance, prompt lineage, scoped deployment fence, tests, operating-equivalent four-cell retest, and option 1A Production verification are all evidenced. A synthetic Production write is never implied; only a user-authorized Production generation may be used for the final path sample.
