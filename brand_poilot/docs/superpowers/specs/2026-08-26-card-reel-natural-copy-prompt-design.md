# Card/Reel Natural Copy Prompt Design

Date: 2026-08-26

Status: approved in conversation as a prompt-only addition and included in the complete Production option 1A; implementation pending

## 1. Decision

The previously tested Card News/Reel editorial ON behavior is accepted as the quality baseline for implementation. Add a compact natural-copy instruction to the final Card News manuscript prompt and Reel storyboard prompt.

This addition changes wording guidance only. It does not add a validation step, model call, retry, post-processing pass, schema field, API field, DB change, or image-worker rule.

## 2. Copy scope

Apply the guidance to user-visible manuscript copy:

- `headline`;
- `informationRelation` labels and values;
- `supportingTexts`;
- `footnote`;
- `content.caption`;
- `content.cta`.

Internal planning fields such as `purpose`, `coreMessage`, `deckNarrative`, and `storyNarrative` remain useful reasoning context and do not need to sound conversational.

## 3. Prompt guidance

The Card News and Reel prompts will instruct the model to:

- follow approved brand rules and the content's purpose before applying any general tone preference;
- prefer concrete subjects and actions over abstract nominalizations and report-like phrasing;
- use familiar Korean expressions and natural word order;
- avoid repeatedly using formulaic endings and frames such as `~해야 합니다`, `~할 수 있습니다`, `~의 근거가 됐습니다`, `핵심은 ~입니다`, and `확인해 보세요` when a more direct sentence fits;
- vary sentence endings, lengths, and structures only where natural, instead of making every Scene use the same polished conclusion pattern;
- remove redundant summaries, restatements, inflated transitions, and forced three-part lists that add no information;
- keep necessary names, numbers, conditions, source qualifications, legal notices, and product facts intact;
- avoid forcing slang, banmal, exaggerated informality, or a single universal conversational persona;
- treat the listed expressions as examples of repetitive habits, not absolute forbidden phrases.

The instruction is part of the existing single model prompt. It does not introduce a separate self-check or acceptance gate.

## 4. Change surface

- Card News final manuscript prompt and its prompt test;
- Reel final storyboard prompt and its prompt test;
- Card/Reel prompt skill-version values so generated jobs record the changed prompt lineage.

No public contract, API, DB, UI, Proposal output shape, image prompt, or rendering policy changes are required for this natural-copy addition.

The broader deployment surface needed to promote the previously tested editorial ON baseline remains governed by `2026-08-26-card-reel-editorial-prompt-quality-design.md` and its implementation plan.

## 5. Operating-quality expectation

After the accepted ON prompt behavior and this natural-copy addition are implemented, built into the Card News/Reel worker images, and deployed by verified digest, Production will use the same prompt logic as the accepted test path.

That provides parity of rules and expected quality direction, not byte-for-byte or sentence-for-sentence reproduction. Model generation is stochastic, so individual wording and images can differ between runs. The earlier ON image run also bypassed the Production API/DB queue; it demonstrated worker-path compatibility but was not itself a Production deployment.

## 6. Completion boundary

Implementation is complete when both prompt builders contain the agreed natural-copy guidance, their prompt lineage versions advance, and focused prompt tests plus the existing Card/Reel worker tests pass. Deployment and a Production-path sample run remain separate operational steps.
