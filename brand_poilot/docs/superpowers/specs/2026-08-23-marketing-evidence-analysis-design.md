# Marketing Evidence Analysis Design

Date: 2026-08-23

Status: implemented and verified locally, not merged or deployed

## 1. Problem

Manual marketing content can currently complete with an empty Research Evidence Pool. The final Card Manuscript validator requires evidence for informational factual scenes, but does not impose the same floor on marketing. A marketing planner can therefore label every scene as `cta`, avoid concrete claims, and still pass.

Production generation `743a7abc-15f8-4763-b291-bfcb89db634e` demonstrated the failure:

- the subject described a Holinen coffee-and-cookie gift product;
- the frozen selected product was the unrelated `GROWTHLINE` service;
- marketing research completed with `decision=not_needed` and zero evidence items;
- the final five scenes were all `editorialRole=cta` with empty `evidenceIds`;
- concrete subject facts were replaced by generic advice before image generation.

The image model was not the content-loss origin. It received already-thin locked copy.

## 2. Goals

- Keep the existing manual `Research -> Proposal -> Manuscript/Storyboard -> Render` architecture.
- Keep the current external API, DB schema, stored Proposal shape, Card Manuscript shape, and Reel Storyboard shape.
- Let marketing research decide whether supplemental public web research is needed.
- Require at least one real Evidence item before a manual marketing Proposal is composed.
- Treat topic URL, topic text, and selected references as subject inputs for both informational and marketing card news/reels. A subject must not be discarded merely because it differs from the selected product.
- Use the selected product snapshot and subject information without transferring one entity's facts to another entity.
- Preserve the existing marketing Proposal fields and improve how `target`, `customerContext`, `strengths`, `limitations`, `appeal`, `buyingBarriers`, and `cta` are derived.
- Prevent an all-CTA or generic-advice deck from passing as a successful marketing manuscript.
- Apply the same semantic rules to manual card news and reels.

### Purpose and format scope

Purpose and output format are separate axes:

| Purpose | Card news | Reel |
| --- | --- | --- |
| Informational | URL, text, and selected-reference subjects supported | URL, text, and selected-reference subjects supported |
| Marketing | URL, text, and selected-reference subjects supported, plus the marketing analysis rules in this document | URL, text, and selected-reference subjects supported, plus the marketing analysis rules in this document |

The common subject-acquisition and subject-preservation rules apply to all four cells. The target, buying-barrier, appeal, product-fact, and CTA reasoning rules apply only when `purpose=marketing`. Output-format-specific scene planning remains Card Manuscript for card news and Reel Storyboard for reels.

## 3. Non-goals

- No DB table, column, row, or permission change. Migration 087 only extends the immutable prompt-lineage CHECK constraints with the exact v3 prompt/source/catalog tuple while retaining exact historical v2 tuples.
- No public API request or response shape change.
- No new planner service or extra relationship-classifier model call.
- No Evidence v2, `sourceKind`, or non-HTTP synthetic Evidence URL in this change.
- No change to the current Evidence maximum of eight items.
- No image-model, shared visual-session, image-reference, style, avatar, attachment, or rendering change.
- No automated-content or historical-queue compatibility work.
- No blog manuscript redesign in this change. Shared Proposal behavior must be scoped so existing blog behavior is not changed accidentally.

## 4. Existing Contract Constraint

`research-evidence.v1` requires every Evidence item to contain an HTTP URL. A topic-text-only input cannot itself be converted into a v1 Evidence item without inventing a URL. Therefore:

- a topic URL can produce one or more independent-Claim Evidence items from the same URL;
- a selected reference can support Evidence through its existing source URL;
- a topic-text-only request needs at least one genuine public source found by the existing research path;
- if no genuine URL-backed Evidence can be obtained, generation fails instead of fabricating Evidence.

The frozen product snapshot remains a separate authoritative factual source. It is not converted into fake Research Evidence and does not receive a synthetic Evidence ID.

## 5. Source Roles and Authority

The planner must treat inputs by role, not by superficial similarity.

### 5.1 User instruction

Defines the requested marketing outcome and any explicit relationship between subject and selected product. It cannot create new facts.

### 5.2 Subject

The subject is the mandatory editorial topic. It may be a URL, direct text, or selected reference content. The planner must inspect it completely and must not exclude it because it appears unrelated to the selected product.

### 5.3 Selected product snapshot

The only authority for claims specifically attributed to the selected product, including its features, benefits, cautions, evergreen purchase information, and approved product images.

### 5.4 Research Evidence

Supports public market context, customer needs, buying barriers, statistics, comparisons, or subject claims confirmed from URL-backed sources. Evidence items remain independent Claims, and the same URL may produce multiple items.

### 5.5 Brand context

Controls brand perspective, required and forbidden language, exaggeration limits, and CTA rules. It is not a source of subject or product facts unless a fact is explicitly present in the approved brand snapshot.

### 5.6 Visual references

Attachments, brand style images, avatars, and other visual references remain visual inputs. The manuscript planner must not infer product facts from their pixels or filenames.

## 6. Subject and Product Relationship Rules

The existing model call performs an internal relationship assessment before writing the Proposal. It does not emit a new schema field.

### Same entity

When the subject and selected product clearly describe the same entity, their non-conflicting facts may complement each other. The approved product snapshot remains authoritative for selected-product attributes. Subject information can add campaign context and URL-backed details.

### Different entities with an explicit relationship

Keep both identities separate and use only the relationship stated in the user instruction, such as case study, campaign subject, comparison, collaboration, application example, or reference.

### Different or unclear entities without an explicit relationship

Do not discard the subject and do not transfer its claims to the selected product. Treat the subject as mandatory editorial reference and the selected product snapshot as a separate product-fact source. If a useful marketing direction cannot be produced without inventing a relationship, fail rather than silently replacing the subject with generic product copy.

In every mode, a fact about entity A must not be rewritten as a fact about entity B.

## 7. Research Semantics

`automatic` means supplemental web research is selected automatically. It does not mean the worker may return no Evidence and continue.

### Topic URL

1. Inspect the requested URL first, with the canonical URL fallback already supported by the runtime.
2. Extract independent Claims instead of one source-level summary.
3. Allow multiple Evidence items from the same URL.
4. Run supplemental public research only when the source is incomplete or additional market/customer grounding is needed.
5. Require at least one valid Evidence item at composition time.

### Topic text

1. Preserve the complete topic text as mandatory subject input.
2. Decide which public context requires grounding.
3. Use the existing controlled research path to find at least one genuine URL-backed source.
4. If no valid Evidence is found, fail without changing or generalizing the topic.

### Selected references

1. Preserve the selected reference text as subject/editorial material.
2. Use its existing source URL when it supports an independent Claim.
3. Supplement only when the reference is incomplete or the requested marketing analysis needs additional public context.

### Evidence floor

Before Proposal composition, both informational and marketing card/reel requests must have:

- `decision=searched`;
- at least one Evidence item;
- Evidence items that pass the existing audit, URL, content-hash, and independent-Claim validation.

An empty `not_needed` result is no longer a valid input for manual marketing card/reel Proposal composition.

## 8. Marketing Analysis Method

This section defines the planner's internal reasoning order. It is not UI display order, Proposal-card field order, or final card/reel Scene order. No screen layout or response-field order changes.

The existing Proposal output fields remain unchanged. Within the same Proposal model invocation, analysis must follow this internal sequence:

1. Read the full user instruction and full subject.
2. Read the selected product snapshot without treating it as the subject by default.
3. Assess the subject-product relationship under Section 6.
4. Review every Evidence item and identify the strongest factual marketing points.
5. Identify the concrete customer situation and job to be done.
6. Identify the customer's friction, uncertainty, or buying barrier.
7. Connect an approved product or subject fact to a customer value.
8. Attach the relevant proof source and preserve limitations.
9. Produce an honest CTA that follows from the preceding facts.
10. Generate three Proposals that differ materially by target, situation, appeal, narrative, or question rather than title wording alone.

After this analysis, the existing Proposal fields are populated. The selected Proposal is later expanded by Card Manuscript or Reel Storyboard planning, which independently determines the final narrative and Scene order from the complete frozen inputs. The internal analysis sequence must not be copied mechanically into a fixed slide sequence such as `target -> barrier -> appeal -> CTA`.

The core reasoning chain is:

```text
subject situation
-> concrete audience
-> job to be done
-> buying barrier
-> approved product/subject value
-> factual proof
-> limitation
-> CTA
```

### Field derivation

- `target`: a concrete group present in or reasonably connected to the subject and instruction, not a generic demographic.
- `customerContext`: the specific situation and decision the target faces.
- `strengths`: approved product-snapshot facts or clearly attributed subject facts, never unsupported adjectives.
- `limitations`: explicit snapshot cautions, subject conditions, evidence constraints, or known information gaps.
- `appeal`: the connection between a factual capability and the target's problem.
- `buyingBarriers`: barriers supported by the subject or Evidence; unsupported psychological claims are forbidden.
- `cta`: the next action the available facts legitimately support.

Strong subject facts must not be removed merely to make room for generic advice, emotional filler, or a CTA.

## 9. Manuscript and Storyboard Rules

Card Manuscript and Reel Storyboard keep their current schemas and deterministic projections.

### Deterministic checks

- The frozen Research Evidence Pool must contain at least one item.
- `selectedEvidenceIds` and `excludedEvidenceIds` must still partition the complete pool.
- Scene Evidence union must still exactly equal `selectedEvidenceIds`.
- A marketing deck must contain at least one non-CTA scene with Evidence.
- A marketing deck may contain at most one `editorialRole=cta` scene.
- A marketing deck consisting entirely of `cta` or `transition` scenes is invalid.
- Existing unique headline and core-message checks remain.

### Prompt invariants and regression fixtures

The current schema cannot deterministically prove semantic claims such as "this scene contains a useful product fact" or "these two sentences are generic advice" without adding provenance fields or a second judge. Those properties are enforced through planner instructions and fixed regression scenarios, not claimed as perfect deterministic validation.

The planner must:

- include at least one concrete product or subject factual point;
- include at least one customer-situation, barrier, or value connection;
- prevent repeated generic advice scenes;
- preserve subject facts even when the subject differs from the product;
- keep entity attribution separate;
- avoid using Research Evidence as false proof of an unrelated product claim.

## 10. Failure Handling

The worker must fail rather than produce generic fallback content when:

- no valid URL-backed Evidence exists;
- the only possible output would require transferring facts between unrelated entities;
- the model returns an all-CTA marketing plan;
- a marketing factual scene uses an unknown Evidence ID;
- selected and excluded Evidence no longer form an exact partition;
- a required subject is omitted or replaced with a different topic in a regression fixture.

Failures remain terminal Proposal or planner failures through the existing customer error envelope. No fallback Proposal, legacy planner, fabricated Evidence, or generic default deck is added.

## 11. Data Flow

```text
User instruction
+ Subject (URL | text | selected references)
+ Selected product snapshot
+ Brand context
        |
        v
Existing controlled research
- source-first Evidence extraction
- optional supplemental public research
- Evidence >= 1
        |
        v
Existing Proposal model invocation
- internal relationship assessment
- marketing reasoning chain
- unchanged content-proposal.v2 output
        |
        v
User selection
        |
        v
Existing Card Manuscript / Reel Storyboard model invocation
- unchanged output schemas
- marketing evidence and CTA rules
        |
        v
Existing deterministic projection and shared visual session
```

## 12. Compatibility and Side Effects

### Preserved

- Existing Proposal, generation input, Manuscript, Storyboard, render-job, and image-package storage shapes.
- Existing URL, topic-text, reference, product, attachment, style, and avatar inputs.
- Existing image and video rendering behavior.
- Existing completed data; no backfill or correction.

### Expected behavior changes

- Marketing card/reel creation fails instead of completing with zero Evidence.
- Topic-text-only marketing can take longer because a genuine public source must be found.
- Requests with weak or inaccessible sources can fail more often, by design.
- Proposal and manuscript prompt/hash versions must be bumped because canonical behavior changes.
- Same-URL multi-Claim Evidence can increase Evidence density up to the existing limit of eight.
- Migration 087 must be applied before API/Proposal Worker v3 traffic; otherwise the operating v2-only lineage CHECK rejects new proposal contracts.

### Main regression risks

- Unnecessarily forcing public research for simple private product campaigns.
- Treating an unrelated public source as proof of a selected product claim.
- Accidentally changing blog behavior through shared Proposal code.
- Rejecting useful non-CTA editorial roles because role checks are too narrow.
- Increasing generation latency through avoidable supplemental searches.

Mitigations are source-role separation, format-scoped guards, exact Evidence attribution, no synthetic URLs, and one-off quality verification before production deployment.

## 13. Expected Change Surface

The implementation plan should confirm exact files, but the expected services are:

- Content Proposal Worker: research floor and marketing analysis instructions.
- Worker Runtime controlled research: source-first and automatic supplemental-research behavior if current code cannot guarantee it.
- Card News Worker: marketing Manuscript instructions and checks.
- Reel Worker: matching Storyboard instructions and checks.
- Shared content contracts/API consumers: only validator logic and canonical prompt/catalog version updates; no schema shape change.
- DB migration 087: CHECK-constraint-only prompt lineage extension; no data rewrite or privilege grant.

No UI, DB migration, Image Worker, publishing, or automatic-content deployment is included.

Expected deployment scope is DB migration 087 + API + Content Proposal Worker + Card News Worker + Reel Worker only if the shared validator/catalog change requires all four runtime consumers. The implementation plan must prove the final image list from the actual diff rather than assume it.

## 14. Verification

### Contract and unit fixtures

- marketing Proposal composition rejects zero Evidence;
- informational behavior remains unchanged;
- topic URL yields one or more independent Claims;
- one URL may yield multiple Evidence items;
- topic text is preserved while public Evidence is added;
- no public Evidence produces a controlled failure;
- same-product subject and snapshot complement without conflict;
- different products with explicit relationship remain separately attributed;
- different or unclear inputs do not lose the subject or transfer facts;
- marketing Manuscript/Storyboard rejects all-CTA output;
- marketing Manuscript/Storyboard rejects more than one CTA scene;
- marketing Manuscript/Storyboard accepts a grounded non-CTA narrative with one CTA;
- card and reel apply equivalent semantic rules;
- blog fixtures remain unchanged.

### Production-shaped one-off test before deployment

Use the frozen input from generation `743a7abc-15f8-4763-b291-bfcb89db634e` without writing Production DB state:

1. run the revised Research path;
2. show the Evidence Pool;
3. run Proposal generation;
4. verify that Holinen subject facts are not discarded and are not attributed to GROWTHLINE;
5. select the same Proposal lens;
6. run Card Manuscript only;
7. compare old and new headlines, Evidence distribution, CTA count, and concrete factual density;
8. stop for user review before image generation or deployment.

### Pre-deployment regression

- affected worker tests;
- shared content-contract tests;
- API typecheck and build;
- actual PostgreSQL application-role tests only if any DB-reading or DB-writing code changes, otherwise explicitly mark DB-role testing not applicable;
- release-manifest and changed-service calculation.

## 15. Approval Boundary

The minimal implementation and regression verification are complete locally. Merge, one-off Production-shaped execution, and Production deployment still require explicit user approval.
