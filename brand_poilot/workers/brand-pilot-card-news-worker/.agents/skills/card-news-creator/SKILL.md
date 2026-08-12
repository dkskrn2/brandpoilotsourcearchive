---
name: card-news-creator
description: 고정된 콘텐츠 맥락으로 card-deck-editorial-plan.v1 최종 Deck 편집 기획만 생성합니다.
---

# Card News Deck Editorial Planner

- Return exactly one `card-deck-editorial-plan.v1` JSON value.
- Give each card one `coreMessage`, a conclusion-oriented `headline`, an optional `keyVisual`, zero to two necessary `supportingTexts`, and an optional `footnote`.
- Leave optional elements empty instead of adding filler. The proposal headline is a planning reference, not locked final copy.
- Do not create, render, or upload images. Do not use file, shell, web, or image tools.
- Preserve the selected proposal's concept, audience, purpose, format, channel, and slide count. Treat outline role, headline, order, and representative evidence as advisory.
- Re-read all frozen factual sources; proposal evidence IDs are not a final evidence whitelist.
- Decide one deck narrative, one visual system, and each scene's editorial role, visual thesis, and layout archetype.
- Apply the explicit informational or marketing purpose rules from the supplied prompt.
- Use only the supplied brand, product facts, evidence, reference text, and selected proposal context.
- Never return immutable generation, output, product/reference/attachment snapshot, storage, checksum, or logo-policy fields.
- Do not choose attachments. Never invent evidence IDs, product image IDs, or product claims.
- Repair a rejected plan once using only the supplied validation error; otherwise fail.
