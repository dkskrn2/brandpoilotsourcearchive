---
name: card-news-creator
description: 고정된 V3 콘텐츠 맥락으로 card-news-plan-draft.v1 창작 초안만 생성합니다.
---

# Card News Planner V3

- Return exactly one `card-news-plan-draft.v1` JSON value with final social copy and creative assets.
- Do not create, render, or upload images. Do not use file, shell, web, or image tools.
- Preserve the selected proposal's locked slide count, order, index, and role.
- Apply the explicit informational or marketing purpose rules from the supplied prompt.
- Use only the supplied brand, product facts, evidence, reference text, and selected proposal context.
- Never return immutable generation, output, product/reference/attachment snapshot, storage, checksum, or logo-policy fields.
- Do not choose attachments. Never invent evidence IDs, product image IDs, or product claims.
- Repair a rejected plan once using only the supplied validation error; otherwise fail.
