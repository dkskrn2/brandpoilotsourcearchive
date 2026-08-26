# Card/Reel Editorial Prompt Text ON/OFF Test Plan

> **Execution mode:** Run inline in the current task. Use `superpowers:executing-plans`. Stop after the comparison report and wait for user approval before production implementation.

**Goal:** Test whether the agreed editorial prompt rules improve informational and marketing Card News/Reel outputs before changing production code.

**Boundary:** This phase is text-only. It must not edit production prompt builders, API contracts, DB schema, prompt-version lineage, deployment files, or worker images. All generated prompts, fixtures, model outputs, and reports live under ignored `.tmp/card-reel-editorial-prompt-onoff/`.

**Controlled comparison:** OFF is the exact current prompt compiled from the checked-out production-equivalent builders. ON is that same compiled prompt with only the agreed editorial rules replaced or inserted by a one-off overlay. Model, reasoning level, schema, permissions, frozen input, selected Proposal, and Evidence pool remain identical within each pair.

---

## Approved ON treatment

### Proposal stage

- Apply to informational/marketing Card News and Reel only; do not change Blog behavior.
- Internally identify the reader/customer situation, concrete payoff, why the content matters now, and the strongest useful change, number, contrast, case, process, problem, or product decision.
- Internally select a suitable editorial progression such as change, data, case, problem-solution, comparison, tutorial, myth correction, product decision, or brand case. Do not add a schema field or impose one fixed scene formula.
- Make the three proposals materially different in starting point, central evidence, progression, and closing judgment.
- Preserve the existing meanings of `conceptKey`, `title`, `informationalType`, `hook`, `keyMessage`, `evidenceIds`, `outline`, and CTA metadata. Natural overlap is allowed, but superficial rephrasing of the same sentence across fields is discouraged.
- Keep Proposal Evidence representative rather than exhaustive; the full pool remains available to the final planner.

### Final Card/Reel planner stage

- Treat Proposal fields as editable direction, not mandatory literal scene copy.
- Choose the central payoff and editorial progression internally without adding output fields.
- Use first/middle/final rules only. There is no dedicated Scene 2 rule.
- The first Scene establishes interest or a useful promise rather than merely repeating the topic/title.
- Middle Scenes each add a necessary fact, relationship, interpretation, or judgment.
- The final Scene answers the opening with a result, judgment, meaning, or practical use rather than paraphrasing it.
- Review the full Evidence pool, but include only Evidence necessary for the central question, claim, payoff, and logical bridges. Do not place strong but narrative-unnecessary Evidence merely because it exists.
- Separate verification metadata from display obligations. Still display subject identity, the core claim/change, decisive numbers/facts/comparisons, meaning-changing conditions/scope/timing/audience, and bridge information needed to understand the conclusion.
- Do not introduce copy-density, simplicity, first-glance, or three-second limits.
- For marketing, CTA is optional supporting copy/Scene only when useful, with at most one CTA Scene. Existing `content.cta` candidate metadata remains unchanged and does not automatically require a CTA Scene.

---

## Phase 1 — Pre-implementation ON/OFF validation

### Task 1: Freeze the exact OFF baseline and fixtures

- [ ] Record commit SHA and the current Proposal/Card/Reel prompt and skill versions.
- [ ] Compile exact OFF prompts from the checked-out builders.
- [ ] Use the frozen informational generation bundle already captured for generation `8eed...`.
- [ ] Retrieve or reconstruct only from verified production records the marketing generation bundle for `743a7abc-15f8-4763-b291-bfcb89db634e`.
- [ ] Record immutable hashes for each input, selection, Evidence pool, and OFF prompt.

### Task 2: Build the ignored ON overlay compiler

- [ ] Create `.tmp/card-reel-editorial-prompt-onoff/` only.
- [ ] Import the real prompt builders and compile OFF normally.
- [ ] Apply exact, asserted string replacements/insertions for ON. Fail if a target is missing or occurs more than once.
- [ ] Assert that OFF and ON differ only in the approved instruction blocks.
- [ ] Assert that contract schemas, input/selection/Evidence, model settings, and tool permissions are identical within each pair.

### Task 3: Run Track A — Proposal isolation

- [ ] Run OFF and ON for informational Card.
- [ ] Run OFF and ON for informational Reel.
- [ ] Run OFF and ON for marketing Card.
- [ ] Run OFF and ON for marketing Reel.
- [ ] Validate every output against the unchanged Proposal schema.

### Task 4: Run Track B — final planner isolation

- [ ] Hold the selected Proposal and Evidence pool constant.
- [ ] Run Card OFF/ON for informational and marketing fixtures.
- [ ] Run Reel OFF/ON for informational and marketing fixtures.
- [ ] Validate every output against the unchanged Card/Reel schemas.

### Task 5: Run Track C — complete text flow

- [ ] Feed each Track A OFF Proposal into the corresponding OFF planner.
- [ ] Feed each Track A ON Proposal into the corresponding ON planner.
- [ ] Do not call image generation, video rendering, BGM, APIs, DB writes, or deployment systems.

### Task 6: Compare and report

- [ ] Compare reader/customer payoff clarity, first-Scene hook quality, middle progression, final payoff, Evidence necessity, essential-information retention, Proposal-field usefulness, and CTA restraint.
- [ ] Report schema validity and any unsupported claims or lost essential information.
- [ ] Distinguish actual observations from judgment.
- [ ] Stop and request user approval. Do not begin Phase 2 automatically.

---

## Phase 2 — Production implementation (approval required)

Only after the user approves the ON behavior, execute `2026-08-26-card-reel-editorial-prompt-quality.md`: update the Proposal/Card/Reel prompt builders and tests, advance Proposal lineage to v4, add the DB CHECK migration and application-role PostgreSQL verification, run the full repository verification matrix, then deploy only the changed services under the repository deployment rules.

If the ON result is rejected or needs adjustment, revise only the ignored overlay and repeat the affected comparison cells before any production implementation.
