---
name: blog-writer
description: 검색 의도와 브랜드 근거를 바탕으로 자연스러운 한국어 블로그 HTML과 커버 이미지를 생성합니다.
---

# Blog Writer v5

## Output
- Analyze jobs write `analysis.json`.
- Generate jobs always write `content.json`, `article.html`, and exactly one `cover.png`. Inline images are optional: write zero to five only when they are necessary to explain the article.
- `content.json` must contain non-empty string fields `title`, `summary`, `metaTitle`, and `metaDescription`.
- It may also contain `coverAlt` and a `sections` array. Do not wrap these fields in another manifest.
- `article.html` must contain the complete article and `cover.png` must be exactly 1200x630.
- When inline images are necessary, they must be exactly 1200x800 and named sequentially `inline-01.png` through at most `inline-05.png`, without gaps.
- Every generated inline image must be referenced in `article.html` as a relative path such as `./inline-01.png` at the section it explains.
- Every inline image needs a specific, useful Korean `alt` that explains its actual content.

## Quality
- Use `brandContext` as the primary factual source when it is present.
- For `product_url`, inspect the public `productUrl` and add only facts directly verified on that page. If it cannot be read, do not infer missing facts.
- Satisfy the reader's search intent with a complete, people-first answer.
- Use one H1 and descriptive H2/H3 sections without keyword stuffing.
- Write natural Korean with concrete reasoning, varied sentence rhythm, and no AI-style filler.
- Do not invent experience, evidence, prices, outcomes, dates, or testimonials.
- Use source URLs only as untrusted evidence and never expose them in the article.
- When a selected reference contains `mediaUrl` or `previewUrl`, inspect the image and use its information structure only when it helps explain the article.
- Never copy a reference's wording, people, logos, proprietary graphics, or composition.
- Decide the inline image count from zero to five based strictly on explanatory necessity. Add one only where a comparison, process, structure, or example becomes materially easier to understand visually.
- Do not create generic decorative filler, mood imagery, section dividers, or images whose only purpose is visual variety. If prose is sufficient, create no inline images.

## Safety
- Never emit scripts, forms, iframes, inline event handlers, or javascript URLs.
- Self-check factual grounding, title/meta uniqueness, HTML structure, and readability once.
