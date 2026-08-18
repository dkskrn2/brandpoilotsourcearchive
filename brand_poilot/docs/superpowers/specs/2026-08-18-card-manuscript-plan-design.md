# Card Manuscript Plan v1 Design

> Status: approved architecture awaiting written-spec review. This document replaces the active
> card-news design authority of `card-deck-editorial-plan.v1` for newly created manual card news.
> It does not authorize implementation or deployment by itself.

## Goal

Replace the current mixed editorial-and-design Deck contract with one private, versioned manuscript
contract. The manuscript planner must recover and preserve the strongest relevant facts from the
complete frozen Research Evidence Pool, while the image model receives approved brand-style images
directly and makes the visual-design decisions.

The change must:

- preserve `deckNarrative`, final display copy, scene-level semantic relationships, evidence
  bindings, product selection, avatar selection, caption, hashtags, and CTA;
- remove model-authored palette, typography, graphic-language, imagery, layout, and visual-thesis
  decisions;
- treat the selected Proposal as an Editorial Lens, never as an evidence whitelist or final
  storyboard;
- keep `CardManuscriptPlanV1` as the single semantic source of truth;
- add no model call, queue, service, database migration, UI change, or render retry;
- leave Reel, Blog, publishing, downloads, completed history, and the separately owned automatic
  generation project unchanged.

## Problem

`card-deck-editorial-plan.v1` currently asks one model response to author both the manuscript and the
design system. It contains the final caption and scene copy, but also palette, typography, graphic
language, imagery direction, deck-wide design invariants, per-scene visual thesis, and layout
archetype. Those design decisions can overconstrain the downstream image model and turn strong source
facts into a generic infographic system.

The current plan binds evidence per scene, but it does not prove that the complete Research Evidence
Pool was considered. Proposal evidence can therefore behave like an accidental whitelist, and a
factual body scene can be replaced by ungrounded generic advice. The system also cannot distinguish
evidence intentionally excluded from evidence silently ignored.

## Locked responsibility boundary

### Proposal: Editorial Lens

The selected Proposal supplies:

- chosen angle;
- target audience;
- content purpose;
- output format and channels;
- fixed card count;
- concept and intent.

Proposal `evidenceIds`, outline headlines, outline roles, and outline evidence allocations are
advisory context only. They do not limit the evidence available to the manuscript planner and do not
become the final manuscript by expansion.

The existing proposal outline slots remain private compatibility identifiers where the canonical
`card-news-plan.v2` requires them. They are assigned deterministically by index and are not presented
as final editorial decisions.

### Research Evidence Pool: factual authority

For informational card news, the complete frozen `researchEvidence.items` collection is the factual
authority used for final claims, comparisons, explanations, analysis, changes, effects, gaps, dates,
conditions, applicability, and concrete values. The frozen subject supplies topic identity and primary
context, but it does not allow an informational factual scene to bypass evidence binding.

For marketing card news, frozen product facts remain their existing independent authority. Search
evidence cannot invent or extend product properties.

### Card Manuscript Plan: semantic source of truth

`CardManuscriptPlanV1` is the only model-authored source for:

- the complete narrative;
- final display copy;
- scene roles and purpose;
- scene core messages;
- semantic information relationships;
- evidence selection and scene evidence bindings;
- product and avatar use;
- social caption, hashtags, and CTA.

No downstream model may rewrite, summarize, reinterpret, or reselect this information.

### Image model: visual-design authority

The image model decides:

- composition and layout;
- background and color use;
- typography treatment;
- icon, illustration, photography, and graphic treatment;
- visual emphasis and spacing.

It receives approved brand-style images directly as staged local references. The manuscript planner
does not convert those images into a palette, typography direction, layout system, or other design
instructions.

## Runtime flow

```text
Frozen subject + complete Research Evidence Pool
                  +
Selected Proposal as Editorial Lens
                  ↓
Existing card manuscript model call (one call, unchanged count)
                  ↓
CardManuscriptPlanV1
                  ↓ deterministic projection only
CardNewsPlanDraftV1 / existing canonical card-news-plan.v2
                  ↓
Per-scene manuscript render payload
                  +
Approved brand style, selected product/avatar, attachments
                  ↓
Image model chooses visual design and renders one image per scene
```

The `CardManuscriptPlanV1 → CardNewsPlanDraftV1 → card-news-plan.v2` path is a pure deterministic
projection. It must contain:

- no LLM or provider call;
- no summarization or rewriting;
- no evidence selection or reallocation;
- no copy similarity heuristic;
- no second semantic source;
- no fallback to the removed Deck contract.

The API independently recomputes the projection and requires exact deep equality with the submitted
draft before storing or enqueueing renders.

## CardManuscriptPlanV1 contract

```ts
type CardEditorialRoleV1 =
  | "cover"
  | "hook"
  | "context"
  | "fact"
  | "comparison"
  | "explanation"
  | "analysis"
  | "action"
  | "transition"
  | "cta"
  | "closing";

type CardInformationRelationV1 = {
  type:
    | "none"
    | "number"
    | "before_after"
    | "comparison"
    | "related_facts"
    | "steps"
    | "quote";
  entries: Array<{
    role: string;
    label: string | null;
    value: string;
  }>;
};

type CardManuscriptSceneV1 = {
  index: number;
  editorialRole: CardEditorialRoleV1;
  purpose: string;
  coreMessage: string;
  headline: string;
  informationRelation: CardInformationRelationV1;
  supportingTexts: string[];
  footnote: string | null;
  evidenceIds: string[];
  productImageAssetIds: string[];
  avatarImageAssetIds: string[];
};

type CardManuscriptPlanV1 = {
  contractVersion: "card-manuscript-plan.v1";
  content: {
    caption: string;
    hashtags: string[];
    cta: string;
  };
  deckNarrative: string;
  evidenceSelection: {
    selectedEvidenceIds: string[];
    excludedEvidenceIds: string[];
  };
  scenes: CardManuscriptSceneV1[];
};
```

The contract contains no design fields. Specifically, it has no `visualSystem`,
`paletteDirection`, `typographyDirection`, `graphicLanguage`, `imageryDirection`, `invariants`,
`visualThesis`, or `layoutArchetype`.

`informationRelation` replaces `keyVisual` in the manuscript contract. It names the semantic
relationship between locked pieces of information. It never specifies a chart, component, layout,
orientation, position, size, or rendering technique.

The relationship type is selected by meaning, not by the number of entries or the desired visual
arrangement:

- `before_after` is allowed only for a real earlier/later or prior/subsequent state of the same
  subject and the same metric, under compatible measurement conditions;
- `comparison` is allowed only when the entries are directly comparable values in the same semantic
  dimension, with compatible populations, denominators, time windows, and units where those
  conditions apply;
- `related_facts` is used when independently grounded claims belong in one editorial scene because
  together they explain a topic, mechanism, consequence, or gap, but treating their values as a
  direct comparison or temporal transition would be misleading;
- `number` expresses one primary quantitative fact and its necessary scope or denominator;
- `steps` requires an actual ordered process or sequence supported by the manuscript authority;
- `quote` requires one attributable quoted statement;
- `none` is used when no structured semantic relation is necessary.

The planner must decide among these types from the evidence semantics. It must not infer
`before_after`, `comparison`, or `related_facts` from a fixed scene index, editorial role, topic,
keyword, number count, or preferred layout. The validator enforces structural shape and exact
evidence binding; semantic misuse remains a prompt rule and stored quality-review signal without an
additional model judge.

`related_facts` is a new candidate in `card-manuscript-plan.v1`; it does not change or alias the
existing canonical image-plan relationship types. Its deterministic projection must preserve the
entries and their roles without converting the relation into a direct numeric comparison or a
before/after claim. Future relationship additions require an explicit contract version.

## Evidence selection and validation

### Exact pool partition

For the set of frozen Research Evidence Pool IDs:

```text
pool = selectedEvidenceIds union excludedEvidenceIds
selectedEvidenceIds intersection excludedEvidenceIds = empty
selectedEvidenceIds = union of every scene.evidenceIds
```

Validation rejects:

- missing pool IDs;
- unknown IDs;
- duplicates within either selection list or a scene;
- overlap between selected and excluded IDs;
- selected evidence unused by all scenes;
- a scene referencing excluded evidence;
- a scene referencing evidence outside the frozen pool.

The same selected evidence may be used in more than one scene when each use advances the narrative.

### Informational scene evidence requirement

Only these informational roles may have an empty `evidenceIds` array:

- `transition`;
- `cta`.

Every other informational role requires at least one evidence ID, including `cover`, `hook`,
`context`, `fact`, `comparison`, `explanation`, `analysis`, `action`, and `closing`.

This deliberately favors grounding over a special evidence-free question hook. Marketing scenes keep
their existing product-fact authority and are not forced to invent Research Evidence IDs when the
pool is empty.

For `cover`, evidence binds only the factual claim actually present in the cover headline or promise.
It does not require every detail from that evidence item to appear on the cover, and it must not be
used as a reason to overload the cover with body-scene facts. For example, a cover claim equivalent to
"10명 중 8명이 사용한다" requires the supporting 80% evidence, while the remaining methodology,
segments, caveats, and comparisons stay available for the appropriate later scenes.

### Evidence information-value priority

The manuscript prompt instructs the planner to prioritize evidence containing:

- the core discovery or new development;
- a meaningful contrast or before/after change;
- an effect or consequence;
- an identified gap;
- concrete numbers, dates, thresholds, conditions, and applicability;
- information that makes the subject worth publishing.

The planner must not exclude stronger source evidence in order to fill space with generic guidance,
background advice, a checklist, or a CTA. A CTA cannot displace a substantive source-backed scene.
When the subject's defining change is present in the evidence, it must not be generalized into advice
that loses the change.

This priority rule does not prohibit editorial framing. Questions, implications, self-check prompts,
and action language derived from the selected Proposal's Editorial Lens remain allowed, including in
grounded scenes and the CTA. They do not require a separate Evidence item when they are clearly
presented as editorial guidance rather than as a factual claim. They must not add a new external fact,
number, causal claim, product capability, policy condition, or source attribution that is absent from
the frozen authority, and they must not displace stronger source-backed information from the fixed
scene count.

The simple audit structure records only selected and excluded IDs. It does not store exclusion
reasons. This is intentional and accepted; semantic selection quality remains observable through the
stored manuscript and generation-quality review.

## Deck-level narrative rules

`deckNarrative` is authored only after the planner reviews and partitions the complete Research
Evidence Pool. It describes the information progression, not a design system.

Each scene must add at least one of:

- new source-backed information;
- a new relationship between established facts;
- a supported interpretation or consequence;
- a distinct next action grounded in the prior scenes.

Scenes must not repeat the same evidence as a paraphrase of the prior headline or supporting text.
When evidence is reused, the new scene must add a distinct relationship, comparison, interpretation,
condition, consequence, or action. Reading the ordered `coreMessage` values must show information
advancing through the manuscript rather than a set of disconnected tips.

The contract additionally rejects exact normalized duplicates of `coreMessage` and `headline`.
Semantic advancement is a planner rule and quality-review signal; no second LLM judge or heuristic
semantic classifier is added.

## Deterministic projection

The projection is implemented as pure functions conceptually equivalent to:

```ts
parseCardManuscriptPlanV1(value, frozenInput)
compileCardManuscriptSceneV1(scene, compatibilityRole)
compileCardManuscriptPlanDraftV1(plan, selectedProposalOutline)
cardManuscriptPlanSha256(plan)
```

For each scene it performs exact field mapping:

- `headline` stays unchanged;
- `informationRelation` is mapped structurally to the existing private structured relation required
  by the canonical image-package projection;
- every relation label and value stays unchanged;
- `supportingTexts` and `footnote` stay unchanged;
- `evidenceIds`, product IDs, and avatar IDs stay unchanged;
- legacy flat `copy` is produced by one deterministic flatten function;
- the proposal outline role is added only as a compatibility slot and does not replace
  `editorialRole`.

The existing canonical customer-facing `card-news-plan.v2`, image manifest, storage layout, download,
and publishing contracts do not change. `CardManuscriptPlanV1` remains the source from which the API
can always recompute and verify those derived values.

## Image-render input

Each independently rendered card receives:

```text
[MANUSCRIPT NARRATIVE]
deckNarrative

[DECK EDITORIAL CONTEXT - NON-DISPLAY]
all scenes: index + editorialRole + coreMessage

[CURRENT SCENE ROLE - NON-DISPLAY]
editorialRole + purpose + coreMessage

[HEADLINE - VERBATIM]
headline

[INFORMATION RELATION - SEMANTIC, NOT LAYOUT]
informationRelation

[SUPPORTING TEXT - VERBATIM]
supportingTexts

[FOOTNOTE - VERBATIM]
footnote

[REFERENCE FILES]
approved brand-style images
selected product images
selected avatar images
user attachments and explicit image direction

[RENDERING RULES]
```

The Deck Editorial Context gives each independent image awareness of the complete manuscript without
becoming a shared design system. The image prompt states that:

- other scenes' `editorialRole` and `coreMessage` are context only;
- they are not display copy;
- they are not design, palette, typography, layout, or composition instructions;
- only the current scene's locked display fields may appear as text;
- `informationRelation.type` describes meaning only;
- `before_after` never means a visual left/right split and is valid only for the same subject and
  metric across a real state or time transition;
- `comparison` never authorizes visual comparison of values that differ in dimension, denominator,
  population, time window, or unit;
- `related_facts` preserves the association between independently grounded claims without implying
  that their values are directly comparable or temporally ordered;
- the model chooses whether that relation is expressed through typography, illustration, spatial
  grouping, symbolic objects, or another visual technique;
- the model must not infer a mandated chart, left/right split, sequence component, or template from
  the relation name;
- every locked current-scene string and relation must remain exact;
- the model must not add unsupported facts or copy;
- page or scene numbering remains prohibited, but its accidental appearance never triggers OCR,
  retry, or job failure.

Approved brand-style images use the existing owned-file and checksum validation, then are staged as
read-only local files. They bypass the manuscript planner and are visible directly to the image model.
If no approved style image exists, the image model designs freely within the existing explicit user
direction and brand rules.

User attachments remain exactly on the current manual-generation path. The existing
`product_image`, `visual_reference`, and `supporting_image` roles, upload/freeze contract, ownership and
checksum validation, attachment index, and read-only local staging are unchanged. Every selected
attachment continues to be provided to every manual card render as an optional visual reference. The
manuscript does not select, filter, require, or allocate attachments per scene, and this project adds no
new attachment field, fallback, or mandatory-use rule.

## Private contract and schema changes

### Content contracts

Add:

- `src/cardManuscriptPlan.ts`;
- `src/cardManuscriptPlanNode.ts`;
- `src/cardManuscriptPlan.test.ts`;
- generated `card-manuscript-plan-v1.schema.json`;
- package exports, catalog entries, generated-artifact registration, and hash checks.

Do not rename the shared Reel structured-copy contract. Card manuscript code uses a new
card-specific `informationRelation` type and maps it deterministically where the existing canonical
card plan still needs the older internal shape.

Remove the active card-news dependency on:

- `cardDeckEditorialPlan.ts` and its Node/hash export;
- generated `card-deck-editorial-plan-v1.schema.json`;
- Deck-specific package exports and active catalog entries.

Historical JSON already stored in the database is not rewritten.

### Card News Worker

Replace the Deck output and loader with:

- `card-manuscript-plan.json`;
- a manuscript-only prompt;
- full Evidence Pool partition rules;
- deterministic manuscript parsing, compilation, and hashing.

The planner source bundle retains the frozen subject, complete Research Evidence Pool, Proposal lens,
product facts, references, brand rules, and the minimum product/avatar availability metadata needed
for asset selection. Brand-style images are removed from planner design reasoning and retained in the
downstream image package.

The existing one repair opportunity remains. No additional planning or quality-judge call is added.

### API

Replace the private completion field and binding:

```text
cardDeckContract       -> cardManuscriptContract
deckSha256             -> manuscriptSha256
cardDeckBinding        -> cardManuscriptBinding
cardDeckCurrentScene   -> cardManuscriptCurrentScene
```

The API reparses the manuscript, validates evidence partition and role requirements, recomputes the
hash, recompiles the canonical draft, and requires exact equality before persisting or enqueueing.
Customer routes and response bodies remain unchanged.

### Image Worker

Replace:

```text
ai-content-card-deck-render-job.v1
```

with:

```text
ai-content-card-manuscript-render-job.v1
```

The render payload contains the complete manuscript contract, its hash binding, the current scene,
the full non-display Deck Editorial Context projection, the existing canonical plan and image package,
and existing frozen input. The Deck prompt compiler is removed and replaced by a manuscript prompt
compiler with no generated design fields.

### Deployment and static tooling

Update generated-schema checks, runtime schema selection, worker image packaging, release-impact
classification, incremental CI assertions, and static cutover checks to require the manuscript
contract and reject the removed Deck command/schema.

## Existing data and compatibility

### Completed generations

Completed card-news results remain readable, downloadable, and publishable. Those paths use stored
canonical plans, manifests, and artifacts and do not require reparsing the private historical Deck
contract. No existing row is backfilled or rewritten.

### Nonterminal Deck jobs

New binaries do not parse or render `card-deck-editorial-plan.v1`. No legacy reader, translation,
fallback, or compatibility route is added.

Before deployment, card-news creation is paused and nonterminal Deck planning/render jobs are
inventoried. They are terminated rather than connected to the manuscript path; content still needed
is recreated as a new manuscript generation.

### Rolling compatibility

The API, Card News Worker, Image Worker, and content-contract runtime form one coordinated private
contract set. Mixed versions can reject each other's exact payloads. Deployment therefore requires a
paused and drained card-news window and coordinated replacement. UI, database, Reel, Blog, publishing,
and unrelated workers are excluded.

No database migration is required because the private contract and bindings are stored in existing
JSON fields. No old contract is kept active merely for rollback. Rollback after manuscript jobs exist
requires pausing card news and draining or terminating those jobs before restoring the older set.

## Expected side effects and safeguards

### Design consistency

Removing model-authored Deck design rules can increase variation between independently rendered
cards. Direct brand-style references and complete non-display Deck Editorial Context mitigate this,
but do not guarantee identical visual systems. This is an accepted trade-off: design freedom moves to
the image model instead of preserving an upstream design lock.

### Text leakage

Providing all scenes' core messages could cause other-scene text to appear in the current image. The
compiled prompt therefore marks Deck Editorial Context as non-display and permits only the current
scene's locked display fields. Tests require that no other scene copy is included in a display-copy
section.

### Evidence selection quality

The exact selected/excluded partition proves that every frozen item was classified, not that the
classification was editorially optimal. The information-value priority, narrative advancement rules,
stored manuscript, scene bindings, and production quality captures make regressions reviewable. No
extra LLM judge is added.

### Generation time

Network call count and render parallelism remain unchanged. The manuscript response becomes smaller
because design fields are removed. Local parsing, set validation, hashing, and deterministic
projection add negligible time relative to image generation.

## Pre-implementation experiment

Formal contract, worker, API, or render-path implementation must not start until this experiment is
complete and the user has approved its results. The experiment uses isolated files and one-off model
and image runs; it does not mutate the production contract, queue, database schema, active worker
configuration, or customer-visible result.

### Deferred Production Research design candidate

TEST 0 showed that the current source-level evidence model can compress several independent claims
from one article into one `claimSummary`. The following is a design candidate only. It records the
Research boundary that must be reviewed separately after the manuscript experiments and does not
authorize a Production Research contract or worker change:

- one Evidence item represents one independently usable Claim, not one source URL;
- multiple Evidence items may share the same normalized source URL when their claims are distinct;
- acquisition must pass a machine-readable completeness result from the source collector into the
  Research decision, rather than exposing only the title and URL;
- completeness must distinguish at least complete body, partial body, metadata only, access failure,
  and indeterminate acquisition;
- partial, metadata-only, failed, or indeterminate acquisition triggers supplemental public research
  unless a separately approved policy proves the available source material sufficient;
- source deduplication remains available for network acquisition and citation display, but it must
  not collapse distinct claims after extraction;
- the Evidence limit is defined and enforced as a claim limit, with a separate source-fetch limit if
  one is operationally required;
- the frozen result must retain enough source identity and acquisition provenance to audit which
  claims came from direct body reading and which came from supplemental research.

No field names, schema version, maximums, migration, rollout, or compatibility behavior for this
candidate are approved yet. The existing Production `research-evidence.v1` remains unchanged during
TEST 1 and TEST 2.

### TEST 0 — inspect the actual Evidence Pool

For the chosen existing production generation:

1. read the exact frozen generation input and Research Evidence Pool used by that generation;
2. output every evidence item's ID, title, URL, publisher, published time, and complete claim summary;
3. separately output the frozen subject and selected Proposal lens;
4. verify whether the strongest expected discoveries, contrasts, changes, effects, gaps, and concrete
   figures exist in the pool before evaluating the manuscript planner;
5. stop for user review.

Missing facts at this stage are a Research/Evidence collection limitation. The manuscript experiment
must not be credited with recovering facts that are absent from the frozen pool and must not fetch or
invent substitute facts during the manuscript run.

### TEST 1 — one-off manuscript planner

Without changing any production contract or worker path:

1. run the new manuscript prompt rules once against the exact frozen TEST 0 input;
2. write a one-off `card-manuscript-plan.v1` JSON artifact outside the production queue;
3. validate the proposed evidence partition, scene evidence union, role requirements, and information
   relations with an experiment-only validator;
4. compare the existing stored Deck Plan with the one-off Manuscript Plan, including evidence
   selection, information retained or lost, narrative progression, copy density, and repeated facts;
5. stop for user review and manuscript approval.

The production Deck Plan, canonical plan, job payload, database row, and generated images remain
unchanged. TEST 1 does not authorize schema implementation.

### TEST 2 — controlled image comparison

Only after the user approves the TEST 1 manuscript, create five isolated experimental images using
the approved source generation and its frozen brand-style references. Compare:

1. existing Deck manuscript plus existing Deck design instructions;
2. existing Deck manuscript with free image-model design and direct brand-style references;
3. approved new Manuscript with free image-model design and direct brand-style references.

All three variants must use the same scene count, image model, aspect ratio, owned reference bytes,
and generation settings wherever the existing runtime permits. Store the exact input JSON, compiled
prompt, output image, elapsed time, and model/tool result for every scene. Present aligned screenshots
and downloadable artifacts to the user. Do not publish, attach the images to the production
generation, or mutate production render jobs.

If the existing baseline cannot be reproduced exactly because the original provider output is
nondeterministic, use the existing stored image as baseline A and clearly label which comparisons are
new runs rather than claiming byte-equivalent regeneration.

### TEST 3 — implementation gate

Formal `CardManuscriptPlanV1` implementation begins only after the user approves:

- the sufficiency of the actual TEST 0 Evidence Pool;
- the TEST 1 manuscript and evidence decisions;
- the TEST 2 image quality and brand-style behavior;
- the intended hard-cutover trade-offs documented here.

If any stage is rejected, revise only the relevant experiment prompt or design section and rerun from
that stage. Do not hide a rejected result behind a compatibility route or proceed with the hard
cutover.

## Verification plan

### Contract tests

- exact schema keys and version;
- absence of all removed design fields;
- fixed editorial-role enum;
- information-relation structural rules;
- exact pool partition and no overlap;
- scene-evidence union exactly equals selected evidence;
- informational evidence required for every role except `transition` and `cta`;
- exact normalized headline and core-message duplicates rejected;
- product/avatar/evidence ownership preserved;
- canonical manuscript SHA stable.

### Planner tests

- complete frozen Research Evidence Pool is present;
- Proposal is labeled and used only as an Editorial Lens;
- non-Proposal evidence can be selected;
- Proposal evidence can be excluded;
- defining discoveries, contrasts, changes, effects, gaps, and numbers receive priority over generic
  advice and CTA filler;
- relation selection is meaning-based: true same-metric transitions use `before_after`, directly
  comparable same-dimension values use `comparison`, and associated but non-comparable claims use
  `related_facts`;
- fixtures vary subjects, scene indices, roles, and number counts so relation types cannot be selected
  by hardcoded scene or keyword rules;
- `deckNarrative` is composed after the complete pool is partitioned;
- repeated evidence must advance the manuscript rather than restate it;
- no brand-style design interpretation or removed design output field appears;
- repair remains limited to the existing one opportunity.

### Deterministic projection tests

- no model/client dependency is reachable from the compiler;
- exact copy and relation projection;
- no evidence reselection or allocation change;
- API recomputation exactly equals worker draft;
- any changed manuscript field or hash fails before render enqueue;
- proposal compatibility role is added without replacing manuscript editorial role.

### Image-worker tests

- complete Deck Editorial Context contains only every scene's index, editorial role, and core message;
- context is explicitly non-display and non-design;
- only current-scene copy appears in locked display sections;
- `informationRelation` is explicitly semantic, not layout;
- no global visual system, visual thesis, or layout archetype is present;
- approved brand-style images are staged and referenced exactly as existing frozen assets;
- product, avatar, attachment, and explicit user direction behavior remains unchanged;
- all current manual attachments remain available to every scene without manuscript-side filtering;
- page-number instruction remains generation-only and triggers no OCR or retry.

### Regression and release checks

- full content-contract, Card News Worker, Image Worker, and focused API suites and builds;
- completed card result read, download, ZIP, manifest, and publishing tests unchanged;
- protected diff for UI, Reel, Blog, automatic generation, migrations, and unrelated workers;
- real changed-path release-impact result selects only intended services;
- pre-deployment inventory proves no nonterminal Deck job will be claimed by new binaries;
- production generation and visual-quality review require a separate explicit deployment approval.

## Acceptance criteria

- Every new manual card-news manuscript uses `card-manuscript-plan.v1` and no active Deck fallback.
- Proposal acts only as the Editorial Lens; the complete Research Evidence Pool remains available for
  final manuscript decisions.
- Selected and excluded evidence exactly partition the pool, and selected evidence exactly equals the
  union of scene evidence.
- Informational body, factual, comparative, explanatory, analytical, and closing scenes cannot be
  evidence-free.
- Strong source findings are not displaced by generic advice or CTA filler.
- Each scene advances the ordered narrative rather than merely repeating the preceding scene.
- Manuscript-to-canonical-plan conversion is deterministic and lossless, with no LLM call or evidence
  reselection.
- `informationRelation` carries meaning without dictating a visual layout.
- Every image sees the full non-display Deck Editorial Context and the current scene's locked copy.
- Approved brand-style images reach the image model directly without an upstream model-authored
  design system.
- There is no new model call, render retry, database migration, UI change, or Reel/Blog/automatic-path
  change.
