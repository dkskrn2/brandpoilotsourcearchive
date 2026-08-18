# Card Manuscript Plan v1 Design

> Status: approved architecture and approved D2-double-prime visual-session experiment, awaiting
> implementation-plan approval. This document replaces the active
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
- make each Production Research Evidence item one independently usable claim, allow distinct claims
  from the same source URL, and carry machine-readable source-acquisition completeness into the
  Research worker;
- require audited supplemental search queries when the primary source body is incomplete;
- keep `CardManuscriptPlanV1` as the single semantic source of truth;
- add no planning-model call, service, database migration, UI change, or page-number-triggered render
  retry;
- apply the approved shared visual-session and primary-medium rules to both Card News and Reel image
  rendering while leaving the Reel manuscript/storyboard contract itself unchanged;
- leave Blog, publishing, downloads, completed history, and the separately owned automatic generation
  project unchanged.

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

TEST 0 also proved that the Production Research runtime collapses model output by normalized URL.
`research-evidence.v1` and the database already allow different item IDs to share a URL, but
`controlledSearch.ts` keeps only one item in a `Map<url, item>`. Several independently useful claims
from one article are therefore compressed into one broad `claimSummary` before Proposal or
Manuscript planning begins. The seed resolver can also substitute fallback text when the article body
is unavailable or incomplete, but that condition is not carried as structured data into Research.
The Research prompt consequently cannot enforce supplemental investigation from a reliable
completeness signal.

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

### Production Research: independent claims and acquisition completeness

`research-evidence.v1` keeps its existing external shape and maximum of eight items. Its Production
meaning is made explicit:

- one Evidence item is one independently usable claim;
- the maximum of eight is a claim limit, not a source-URL limit;
- two items may share the same normalized URL when their normalized claim summaries differ;
- network fetch deduplication may still operate by URL, but post-extraction Evidence deduplication
  operates by claim identity;
- claim identity is deterministically derived from source identity plus the exact normalized claim,
  so distinct same-source claims receive distinct stable IDs;
- identical claims from the same source are still deduplicated.

Newly created proposal jobs carry this private, immutable sidecar in the existing batch input JSON:

```ts
type ResearchSourceAcquisitionV1 = {
  contractVersion: "research-source-acquisition.v1";
  status:
    | "complete_body"
    | "partial_body"
    | "metadata_only"
    | "access_failed"
    | "indeterminate"
    | "not_applicable";
  requestedUrl: string | null;
  canonicalUrl: string | null;
  contentHash: string | null;
  capturedAt: string | null;
};
```

The sidecar describes acquisition, not truth quality. `complete_body` means the primary body was
captured sufficiently for direct claim extraction. `partial_body`, `metadata_only`, `access_failed`,
and `indeterminate` require supplemental public research. `not_applicable` is used for non-URL
subjects. A localized fallback sentence is never parsed to infer this state.

The current resolver branches map directly: a crawl with a nonempty body that passes the content-page
and unambiguous-article checks is `complete_body`; a nonempty body rejected as non-content or
ambiguous is `partial_body`; a title/meta fallback without body is `metadata_only`; explicit publisher
402/403/429 is `access_failed`; other bounded crawl/parse failures that still provide a safe URL/topic
hint are `indeterminate`. Invalid user URL input remains an error rather than being converted into a
Research subject.

For an incomplete URL source, the Production Research run must observe at least one actual search
query event in the controlled Codex audit. The persisted `researchEvidence.queries` value is built
from those audited executed queries, not from the model's final JSON wording. A run that merely opens
the source URL, claims it searched, or returns no audited query fails before the Evidence snapshot is
committed. This adds no second model call: the existing search-enabled Research invocation extracts
available primary claims and performs supplemental search in the same bounded run.

The Research Worker selects this behavior only when the exact manual Card/Reel acquisition sidecar is
present and sets its internal granularity to `independent_claim`. Markerless scheduled/automatic jobs
do not silently inherit claim-level deduplication or the new supplemental requirement; their owner can
adopt it separately without sharing a hidden fallback.

The acquisition sidecar is frozen in `ai_content_proposal_batches.input_snapshot_json`; the resulting
actual query strings and claim items remain frozen in the existing
`ai_content_proposal_research_snapshots.evidence_json`. Together they show whether supplemental
research was required and which queries actually ran without adding a database column or table.

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

`editorial illustration`, photography, 3D, collage, and any other medium are choices, not product
defaults. The illustration medium observed in the D2-double-prime experiment must never be hardcoded
as the Production default.

The visual-reference precedence is:

1. mandatory explicit user image direction and mandatory brand rules;
2. approved brand-style reference images, when present;
3. selected product/avatar images and supporting attachments according to their existing roles;
4. free image-model judgment when no brand-style reference exists.

When at least one approved brand-style image exists, those images are the primary visual reference
for medium, material, color behavior, type treatment, and graphic language. The model may vary scene
composition, but it must not replace the reference medium merely to create variety. When no approved
brand-style image exists, the model chooses one primary medium appropriate for the whole Card deck or
Reel storyboard and retains that medium across every generated scene. Layout diversity never
authorizes switching among photography, 3D, and illustration inside one content unit.

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
One output-scoped visual render session
                  +
Approved brand style, selected product/avatar, attachments
                  ↓
One shared Codex context retains the complete manuscript/storyboard
                  ↓
Image model chooses one primary medium and renders scenes sequentially
with one image_generation call per scene
```

The complete Production flow begins one step earlier:

```text
Primary subject acquisition
        ↓
ResearchSourceAcquisitionV1
        +
available frozen source body/title/URLs
        ↓
one search-enabled Research invocation
        ├─ independent primary-source Claims
        └─ required supplemental search when acquisition is incomplete
        ↓
research-evidence.v1 (maximum eight Claims; same URL allowed)
        ↓
Proposal as Editorial Lens
        ↓
Card Manuscript planning and rendering flow above
```

The same output-scoped visual-session rule applies to Reel. Reel keeps `reel-storyboard.v1` as its
semantic source; it is not converted to `CardManuscriptPlanV1`. The Reel scene images are rendered in
one shared Codex context and the existing video finalizer still uses the first scene as the cover.

The API keeps the existing `image_asset` rows and storage paths. A batch-claim operation atomically
leases every queued image row for one newly created Card or Reel output before any image tool call.
The worker heartbeats those leases as one group and never mixes rows from different outputs. This
changes claim/execution grouping, not the database schema or customer API.

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

`related_facts` is new in `card-manuscript-plan.v1`; it does not change or alias the existing
canonical image-plan relationship types. It remains in the versioned Manuscript sidecar and visual
session. The existing canonical plan receives only the deterministic flat-copy projection, while the
Image Worker receives the exact typed relation from the Manuscript. No projection converts it into a
direct numeric comparison or a before/after claim. Future relationship additions require an explicit
contract version.

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
- `informationRelation` entries are flattened in their original order into the canonical compatibility
  `copy`, while the typed relation remains only in the Manuscript source and visual-session payload;
- every relation label and value stays unchanged;
- `supportingTexts` and `footnote` stay unchanged;
- `evidenceIds`, product IDs, and avatar IDs stay unchanged;
- legacy flat `copy` is produced by one deterministic flatten function and the required canonical
  `visualDirection` is a fixed code-authored compatibility sentence, never a second design source;
- the proposal outline role is added only as a compatibility slot and does not replace
  `editorialRole`.

The existing canonical customer-facing `card-news-plan.v2`, image manifest, storage layout, download,
and publishing contracts do not change. `CardManuscriptPlanV1` remains the source from which the API
can always recompute and verify those derived values.

## Image-render input

Each Card visual session receives the complete manuscript once. Every sequential scene tool call
receives the shared context plus this scene-specific projection:

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

The Deck Editorial Context gives every scene awareness of the complete manuscript without becoming a
planner-authored design system. The shared Codex execution retains the selected primary medium and
reference interpretation across scene calls. The image prompt states that:

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
- the prompt instructs the image model to reproduce every locked current-scene string and relation
  without rewriting;
- only the current scene's `headline`, `supportingTexts`, `footnote`, `informationRelation` labels and
  values, and mandatory brand text are permitted display strings;
- the model must not add unsupported facts, explanatory copy, paraphrases, speech bubbles, sticker
  copy, pseudo-UI labels, decorative English, or other model-invented text;
- a repeated relation type may use a different composition, but that diversity must not change the
  content unit's primary visual medium;
- page or scene numbering remains prohibited, but its accidental appearance never triggers OCR,
  retry, or job failure.

These are prompt and input-contract guarantees, not pixel-level OCR guarantees. The system guarantees
that only locked copy is supplied and permitted as display text and that no downstream compiler
rewrites it. Because the approved path adds no OCR judge or image retry, it does not claim that every
glyph in the generated pixels is character-for-character correct. Production quality review uses the
approved D2-double-prime standard of preserving core meaning and numeric facts, with manual visual
inspection for text rendering.

Approved brand-style images use the existing owned-file and checksum validation, then are staged as
read-only local files. They bypass the manuscript planner and are visible directly to the image model.
If no approved style image exists, the image model designs freely within the existing explicit user
direction and brand rules, choosing one primary medium for the complete content unit rather than one
medium per scene.

Reel uses the same reference precedence, primary-medium consistency, no-invented-display-text, and
layout-diversity rules. Its locked display fields continue to come from `reel-storyboard.v1`; this
project does not rename or project Reel through the Card manuscript contract. The full storyboard
scene index, editorial role, and core message form non-display context for each sequential Reel scene
call.

User attachments remain exactly on the current manual-generation path. The existing
`product_image`, `visual_reference`, and `supporting_image` roles, upload/freeze contract, ownership and
checksum validation, attachment index, and read-only local staging are unchanged. Every selected
attachment continues to be provided to every manual card render as an optional visual reference. The
manuscript does not select, filter, require, or allocate attachments per scene, and this project adds no
new attachment field, fallback, or mandatory-use rule.

## Private contract and schema changes

### Research acquisition and Evidence runtime

Add one shared private exact parser/type for `research-source-acquisition.v1` in content-contracts
without registering it as a new customer Evidence version or canonical catalog artifact. API and
Proposal Worker import the same parser; separate copies plus fixture parity are not sufficient. Modify:

- `apps/api/src/aiContentSeedResolver.ts` and its tests to return the structured acquisition status
  together with the existing frozen subject;
- `apps/api/src/contentOrchestration.ts`, `apps/api/src/aiContentRepository.ts`, and their focused
  tests to freeze the sidecar as a fourth key in the new proposal batch input envelope;
- `apps/api/src/contentProposalJobs.ts` and its route/repository tests to validate the new-job
  envelope, expose the sidecar only to the authenticated leased Research worker, and keep the
  canonical `ProposalBaseInputSnapshotV2` unchanged;
- `workers/brand-pilot-content-proposal-worker/src/contracts.ts`, `client.ts`, `research.ts`, and
  their tests to receive the sidecar and the available public subject text in the untrusted Research
  context;
- `workers/brand-pilot-worker-runtime/src/controlledSearch.ts` and its tests to extract independent
  claims, deduplicate by claim identity, require an audited query for incomplete acquisition, and
  persist audited executed query strings.

The acquisition parser is private because it governs collection execution, not customer-visible
Evidence semantics. It is exported as a package sidecar but excluded from generated catalog/source
hash input. The existing Evidence item contract, Proposal input versions, output schema, customer API,
database relations, and DB-pinned content-catalog hashes do not change.

Claim identity is deterministic canonical source identity plus normalized claim summary. Canonical
source identity removes tracking parameters; claim text normalization is NFC, trim, and whitespace
collapse only. It does not use semantic similarity or keywords. The existing full observed-field
`contentHash` remains unchanged because API completion already verifies it exactly.

The authority gate is server-owned `batch.origin=manual`, an exact supported acquisition sidecar,
and Card/Reel format. Worker payload alone cannot enable independent-claim mode. Missing, null,
unsupported, or orphan sidecar state on a new manual row fails closed; markerless scheduled and
automatic jobs keep their current URL-deduplication branch.

### Content contracts

Add:

- `src/researchSourceAcquisition.ts` and tests;
- `src/cardManuscriptPlan.ts`;
- `src/cardManuscriptPlanNode.ts`;
- `src/cardManuscriptPlan.test.ts`;
- `src/visualRenderSession.ts` and tests;
- package exports and private-sidecar exclusion/hash-stability checks.

These are private sidecars. Do not add them to `src/catalog.ts` or
`generated/content-catalog.json`, and do not generate a public manuscript schema under
`packages/.../generated`. `generateArtifacts.ts` must explicitly exclude the sidecar and Node helper
files so the API/075-pinned canonical catalog and source hashes remain byte-identical. The provider
output schema is packaged only with the Card Worker under `scripts/card-manuscript-plan-v1.schema.json`.

Do not rename the shared Reel structured-copy contract. Card manuscript code uses a new
card-specific `informationRelation` type and maps it deterministically where the existing canonical
card plan still needs the older internal shape.

Remove the active card-news dependency on:

- `cardDeckEditorialPlan.ts` and its Node/hash export;
- Deck-specific package exports, worker runner/schema, runtime command defaults, Docker packaging,
  environment examples, skills, and active tests.

No global generated Deck schema exists today, so the cutover must not invent a generated-schema
delete step. Static verification instead proves that active runtime/packaging/env no longer names the
Deck command or contract while completed-history readers still work.

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
`src/index.ts`, Dockerfile, worker environment command, runtime packaging tests, and the Card creator
skill move to the `scripts/run-codex-card-manuscript-plan.mjs` runner and its colocated `scripts/`
schema in the same coordinated cutover. A stale production command override is a deployment blocker.

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

The API continues to store one `image_asset` row per asset, but Card and Reel workers claim all rows
for one eligible output as an exact output-scoped batch. The render payload contains the complete
manuscript or Reel storyboard contract, its hash binding, the ordered current-scene projections, the
existing canonical plan and image package, and existing frozen input. The Deck prompt compiler is
removed and replaced by a manuscript visual-session compiler with no generated design fields. The
Reel prompt compiler retains the existing storyboard semantics but moves visual-medium selection to
the shared session and ignores storyboard-authored medium changes for render authority.

One Codex process is started for the claimed output. It stages references once and calls
`image_generation` sequentially exactly once per ordered scene. It does not pass previously generated
scene images as references. Each returned PNG is checked against its expected index and dimensions;
page-number presence and OCR never trigger another image call.

The visual-session projection retains per-scene product and avatar asset-ID bindings. The API checks
their exact ownership and union against the frozen image package. Existing attachments remain
available to every scene. Product, avatar, and supporting-image references are content references,
not primary-medium authority. Only approved non-avatar brand-style references select
`brand_style_reference`; avatar-tagged style images alone do not.

The existing one-image runner contract is not stretched implicitly. Add an exact
`ai-content-visual-session-render.v1` runner input/output contract that binds each expected scene index
to one result file. It rejects missing, duplicate, extra, out-of-order, or dimension-invalid outputs
and never infers scene identity from file modification time. The runner consumes JSONL tool events
while the process is live. A duplicate image-generation call for one scene, an extra call, or any call
after a failed scene terminates the process. If the runtime cannot expose sufficient events to enforce
this boundary, no-retry is prompt-only and deployment remains blocked rather than overstating a
system guarantee.

Batch API requests carry `outputId`, `workerId`, and the exact ordered vector of
`{jobId, assetIndex, leaseToken}` plus a canonical body hash. Every token must be current, unexpired,
same-tenant, same-generation, and same-output; any mismatch returns conflict with zero mutation.
Claim, heartbeat, complete, fail, and expiry use one lock order: generation, output, then all image
jobs by asset index. The batch-aware expiry path runs before and excludes these rows from generic
per-row expiry/requeue. Two concurrent claimers can yield the complete output to only one caller.
`package_finalize` and Blog remain on their existing single-job routes.

Completion transport replay sends only the same canonical body and never re-runs Codex, image
generation, or upload. Same-body committed replay is idempotent; a changed body conflicts. Per-scene
prompt/tool diagnostics are part of the completion body and commit atomically with asset success.

### Deployment and static tooling

Update private-sidecar exclusion tests, runtime schema selection, worker image packaging,
release-impact classification, incremental CI assertions, and static cutover checks to require the
manuscript runner and reject the removed Deck command/schema. The actual incremental test is
`scripts/incremental-cicd-contract.test.mjs`; Card provider schemas live under the worker's `scripts/`
directory. Canonical generated catalog files must have zero diff.

Run release-impact against the complete real changed-path set from the current production SHA. It
must produce exactly API, Content Proposal Worker, Card News Worker, and Image Worker with
`unknownPaths=[]`, `migration=false`, `customerUi=false`; it must not select Reel Worker merely because
private content-contract sidecars changed.

## Existing data and compatibility

### Completed generations

Completed card-news results remain readable, downloadable, and publishable. Those paths use stored
canonical plans, manifests, and artifacts and do not require reparsing the private historical Deck
contract. No existing row is backfilled or rewritten.

Historical Research snapshots and completed proposals keep their existing Evidence IDs and broad
claim summaries. They are not re-extracted or backfilled. The new independent-claim semantics and
acquisition sidecar apply only to newly created manual Card/Reel proposal jobs after the coordinated
deployment. Markerless scheduled/automatic proposal jobs remain on their separately owned path.

Existing JSONB relations already store arrays/objects and do not impose URL uniqueness. The proposal
input envelope gains the private sidecar only for new manual jobs, so no database migration is required.
Readers that serve completed history continue to accept the historical three-key envelope. New
Research claims require the four-key envelope and do not consume old queued proposal jobs.

Every exact envelope reader is updated deliberately: proposal claim, selection, reselection,
generation start, fixed-input lineage, and completed-history load. A new manual job accepts only the
four-key envelope. Historical completed and markerless scheduled/automatic readers accept only their
current three-key shape. The fourth key is not made globally optional because that would blur the
authority boundary.

### Nonterminal Deck jobs

New binaries do not parse or render `card-deck-editorial-plan.v1`. No legacy reader, translation,
fallback, or compatibility route is added.

Before deployment, card-news creation is paused and nonterminal Deck planning/render jobs are
inventoried. They are terminated rather than connected to the manuscript path; content still needed
is recreated as a new manuscript generation.

Termination is not an ad-hoc direct database update. If an approved scoped dry-run/apply operation
does not exist, deployment requires an exact inventory of zero nonterminal Deck rows and stops on any
match. Building a new termination operation is a separate operational approval, not an implicit part
of this implementation.

### Rolling compatibility

The API, Card News Worker, Image Worker, and content-contract runtime form one coordinated private
contract set. Mixed versions can reject each other's exact payloads. Deployment therefore requires a
paused and drained card-news window and coordinated replacement. UI, database, Blog, publishing, and
unrelated workers are excluded. Reel Worker planning output is unchanged, but the API/Image Worker
render grouping and prompt policy for Reel are part of the same coordinated deployment.

No database migration is required because the private contract and bindings are stored in existing
JSON fields. No old contract is kept active merely for rollback. Rollback after manuscript jobs exist
requires pausing card news and draining or terminating those jobs before restoring the older set.

## Expected side effects and safeguards

### Design consistency

Removing model-authored Deck design rules can increase variation. The shared context, one primary
medium per output, direct brand-style references, and complete non-display editorial context mitigate
that variation without restoring an upstream design lock. Composition may vary by scene; medium,
reference interpretation, and mandatory brand rules remain coherent.

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

### Generation time and failure radius

Image-model call count remains one per scene, so there is no extra image generation or retry. Planning
call count is unchanged. Card/Reel scene calls move from independent jobs to one output-scoped
sequential session. Production currently has one Image Worker and already processes those jobs
sequentially, so removing repeated Codex startup and reference staging may reduce wall-clock time; this
is measured, not guaranteed. The design gives up future scene-level parallelism if Image Workers are
horizontally scaled. The pre-deployment performance gate records proposal, manuscript/storyboard,
staging, each image call, upload, and finalization durations separately. The current one-asset
20-minute child timeout is not silently reused: the N-scene session budget is explicit and covered by
boundary tests.

A visual session is an all-or-nothing render attempt. All scene files are generated and validated in
temporary storage before any render row is marked succeeded. If scene `k` fails after scenes
`1..k-1` succeeded locally, the worker:

1. aborts scene calls `k+1..N`;
2. discards the successful local files from this attempt;
3. sends one batch failure with stable non-retryable code `ai_content_visual_session_failed`;
4. atomically terminalizes every image row in the output; and
5. never starts a replacement Codex session or image-generation call automatically.

Successful earlier images are not reused in a new session, because doing so would mix two Codex
contexts and violate the approved shared-medium baseline. The complete session is also not restarted
automatically, because that would charge again for every successful image and could conflict with
immutable deterministic asset paths. A user-requested retry creates a new generation and a new full
visual session.

The cost of an automatic failure at scene `k` is exactly `k` image calls and no retry calls. Its
additional automatic wait is zero. A later user-requested full retry costs `N` new image calls and the
full sequential render time. The trade-off is intentional: no partially mixed visual unit is
published, and provider cost never grows silently through automatic session regeneration.

Failure handling distinguishes rendering from transport:

- an exact `completeBatch` response loss retries only the same HTTP completion body through the new
  explicitly bounded batch-completion transport replay; it performs no Codex or image call;
- a lease loss or worker crash aborts the session and the batch-aware expiry sweep terminalizes the
  whole output without requeueing individual scenes;
- a crash after some provider files were uploaded but before atomic DB completion leaves no succeeded
  render rows. There is no proven rendered-asset cleanup owner today; the implementation records the
  partial-upload paths in audit/metrics and never uses them as a continuation anchor. Adding durable
  cleanup is a separate storage-lifecycle scope and automatic image retry remains disabled;
- page numbering, OCR quality, style preference, or subjective image quality never triggers failure
  or retry.

Research adds no model-call count. Incomplete acquisition can add search-tool work inside the existing
Research invocation and can therefore increase Research latency and external page reads. The timing
audit records source acquisition, executed supplemental queries, claim extraction, Proposal,
Manuscript, and rendering separately so that this cost is observable.

The Research behavior change has one deliberate availability side effect: publisher blocks and
bounded crawl failures that previously stopped subject resolution may now continue to audited public
supplemental research. This does not relax URL/auth/tenant validation and does not permit an empty
Evidence result for informational content. It can change which sources and claims appear in newly
created proposals, which is the intended quality correction. Completed history and existing
nonterminal jobs are not rewritten or resumed through the new boundary.

Passing the available frozen source body into Research increases input tokens compared with the
current title/URL-only context, but it remains bounded by the existing 50,000-character subject
snapshot limit and does not add a call. The source body is untrusted external text: it is serialized
inside the existing closed escaped data envelope, explicitly labeled non-instructional, and never
interpolated into the Research instruction section. Prompt-injection regression fixtures cover tag,
ampersand, Unicode-separator, and instruction-like source strings.

Claim-level selection can allow one information-rich source to occupy several of the eight slots.
That is intentional when the claims are independently useful, but the prompt must rank claim value
globally and avoid near-duplicate paraphrases. It must not enforce an arbitrary one-claim-per-source
quota or fabricate source diversity. Supplemental results compete for the same eight Claim slots on
information value and grounding.

## Pre-implementation experiment

Formal contract, worker, API, or render-path implementation must not start until this experiment is
complete and the user has approved its results. The experiment uses isolated files and one-off model
and image runs; it does not mutate the production contract, queue, database schema, active worker
configuration, or customer-visible result.

### Production Research scope promoted after TEST 0

TEST 0 validated the Research bottleneck and the one-off manuscript/image experiments depended on
the expanded eight-claim pool. The Production implementation scope therefore includes the
independent-Claim and acquisition-completeness boundary defined above. It does not hardcode the
claims or figures observed in the experiment, does not change Proposal count, and does not add a
second Research-model invocation.

The Evidence item schema remains `research-evidence.v1`; only the runtime deduplication semantics are
corrected to match what the schema and JSONB storage already permit. The new acquisition sidecar is a
private versioned envelope for newly created jobs. Completed historical snapshots remain readable,
and old nonterminal proposal jobs are not connected to the new path.

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

The completed extensions to TEST 2 are part of the approved experiment record:

- D2 used one shared Codex context and one sequential `image_generation` call per scene, with no prior
  scene image used as a reference;
- D2-prime strengthened relation non-layout and composition-diversity rules, but showed that visual
  diversity can accidentally become mixed media and can introduce extra explanatory text;
- D2-double-prime retained one primary medium across the deck, varied only composition, and closed
  display text to the manuscript allowlist;
- the D2-double-prime editorial-illustration result is an observed model choice, not an approved
  Production default. Production chooses from brand-style references first, or freely chooses one
  coherent medium only when those references are absent.

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

### Research boundary tests

- resolver emits a structured status for complete, partial, metadata-only, access-failed,
  indeterminate, and non-URL acquisition without parsing fallback prose;
- new manual Card/Reel proposal jobs freeze the exact acquisition sidecar and Research claims receive
  it unchanged;
- same URL plus four distinct claims produces four distinct Evidence IDs;
- same URL plus an identical normalized claim produces one item;
- the maximum of eight is applied after claim-level deduplication;
- incomplete acquisition without an audited executed query fails before snapshot commit;
- a query written only in model JSON but absent from tool audit fails;
- persisted `researchEvidence.queries` equals audited executed queries;
- primary-source and supplemental-source Claims coexist in the existing Evidence schema;
- completed historical three-key proposal envelopes remain readable while new manual queued jobs
  require the four-key acquisition envelope; markerless scheduled/automatic jobs do not enter the
  new Research branch.
- API and Proposal Worker import one shared private acquisition parser; no duplicated parser/schema
  implementation exists.
- selection, reselection, generation start, fixed-input lineage, and completed-history exact envelope
  readers each cover their intended three-key or four-key branch.

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
- per-scene product/avatar reference bindings exactly match the frozen image package, while shared
  attachments retain current all-scene behavior;
- avatar-only references do not select brand-style primary-medium mode;
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
- one Card output and one Reel output each use one Codex process with ordered, sequential scene tool
  calls and no previous output image as a reference;
- the exact visual-session runner contract rejects missing, duplicate, extra, out-of-order, and
  dimension-invalid results without using file modification time as scene identity;
- live tool-event audit enforces one image-generation call per scene and prevents calls after the
  first failed scene; absence of enforceable tool events blocks deployment;
- brand-style references present: the prompt makes them the primary medium reference and does not
  hardcode editorial illustration;
- brand-style references absent: the prompt permits free initial medium selection but requires that
  one selected medium across the output;
- repeated relation types may vary composition without changing medium;
- only locked scene copy, relation label/value, and mandatory brand text are permitted display text;
- every scene records the shared compiled-session prompt hash and its scene-block hash; actual tool
  arguments are hashed only when the runner really emits them and are otherwise marked unobserved;
- those diagnostics commit atomically in the exact batch completion transaction;
- page-number instruction remains generation-only and triggers no OCR or retry.

### Batch concurrency and transport tests

- candidate selection locks one output before per-row LIMIT and locks generation, output, and ordered
  image jobs in one documented order;
- two real PostgreSQL clients racing to claim one output yield the entire batch to exactly one client;
- batch-aware expiry runs before generic expiry and never requeues one scene independently;
- heartbeat/complete/fail require the exact ordered `{jobId, assetIndex, leaseToken}` set; stale,
  missing, duplicate, wrong-tenant, or changed-body requests produce zero mutation;
- a committed response loss replays only the same completion body and creates no additional image,
  upload, diagnostic, or succeeded-row write;
- fail versus complete and expiry versus complete races settle to one terminal graph.

### Regression and release checks

- full content-contract, Worker Runtime, Content Proposal Worker, Card News Worker, Image Worker, and
  focused API suites and builds;
- completed card result read, download, ZIP, manifest, and publishing tests unchanged;
- protected diff for UI, Reel planner/storyboard producer, Blog, automatic generation, migrations,
  and unrelated workers;
- real changed-path release-impact result selects only intended services;
- pre-deployment inventory proves no nonterminal Deck job will be claimed by new binaries;
- actual Card Worker environment command/schema point to packaged manuscript files before creation is
  resumed;
- production Research verification uses separate evidence-rich and incomplete-acquisition cases, or
  records explicit approval to replace the latter with integration evidence;
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
- Card and Reel each render all scenes in one output-scoped shared Codex context, with one existing
  image-model call per scene and no previous scene image reference.
- Batch claim/heartbeat/complete/fail use exact token vectors, one lock order, atomic settlement, and
  same-body completion replay only.
- Approved brand-style references are the primary visual-medium authority; without them the image
  model freely chooses one coherent medium for the complete output.
- Editorial illustration is not a hardcoded default.
- Layout composition may vary without changing the selected primary medium.
- The prompt and render contract permit only locked scene copy, relation labels/values, and mandatory
  brand text as display text; pixel-level character accuracy is not automatically guaranteed or
  OCR-gated.
- Production Research stores independently useful same-source Claims, and incomplete acquisition
  cannot complete without an audited supplemental query.
- A middle-scene visual failure never reuses successful images, restarts the full session, or
  requeues individual rows automatically; only the exact batch-completion transport body may replay.
- There is no new planning/model call, page-number-triggered render retry, database migration, UI
  change, Blog change, or automatic-path change.
