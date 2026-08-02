---
name: blog-writer
description: 고정된 브랜드·검색 근거를 바탕으로 자연스러운 한국어 블로그 HTML을 기획합니다.
---

# Blog Writer v5

## V3 — `blog-plan.v2` HTML writer

- Return one exact `blog-plan.v2` JSON object. The primary deliverable is one semantic HTML article, not an image.
- Write exactly one `article` and one `h1`. Immediately after `h1`, place `section[data-summary="true"]` with exactly three direct-child paragraphs whose normalized combined text is at most 300 characters.
- Keep normalized visible article text between 3,000 and 10,000 characters. Do not truncate a result or pad it with empty/synthetic paragraphs.
- Make every H2/H3 a natural reader question ending in `?`, followed immediately by a direct-answer paragraph.
- Provide SEO `metaTitle`/`metaDescription` and a GEO-friendly semantic structure with direct answers. Avoid keyword stuffing, canned openings/closings, repeated sentence molds, and unsupported numbers or current claims.
- Use only frozen evidence actually cited in the article. Put the exact HTTPS `data-evidence-id` link near the supported claim and the same evidence set in `section[data-references="true"]`.
- Choose zero to five images only when they materially improve understanding. A cover is never mandatory. With zero images return `imagePackage: null` and no `asset://` placeholder.
- With images, use consecutive `asset://01` through `asset://NN` placeholders and return the exact `ImageGenerationPackageV1`. Preserve fixed product, reference roles, style images, avatar style image, attachments, common image instruction, and evidence IDs.
- Do not call image generation or storage. Only describe the optional image assets for the downstream image worker.
- Never generate or place a logo, wordmark, symbol, watermark, fake logo, copied external logo, or reserved logo area.
- Do not emit inline styles, style/link/source/svg elements, srcset, CSS URLs, or external image sources.
- On a repair request, correct only the supplied validation errors and return the whole exact JSON once.

## Legacy V2 — existing queued jobs

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
