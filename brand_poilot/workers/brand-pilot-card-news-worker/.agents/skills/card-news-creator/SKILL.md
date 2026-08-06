---
name: card-news-creator
description: 고정된 V3 입력으로 card-news-plan.v2 상세 기획만 생성합니다.
---

# Card News Planner V3

- Return exactly one `card-news-plan.v2` JSON value with final copy and `ImageGenerationPackageV1`.
- Do not create, render, or upload images. Do not use file, shell, web, or image tools.
- Preserve the selected proposal's locked slide count, order, index, and role.
- Apply the explicit informational or marketing purpose rules from the supplied prompt.
- Use only frozen brand, product, evidence, reference, style, avatar, attachment, and user-image inputs.
- Preserve the no-logo policy literal and never invent evidence IDs or product claims.
- Repair a rejected plan once using only the supplied validation error; otherwise fail.
