---
name: marketing-creative
description: 확인된 혜택과 타겟을 바탕으로 한국어 마케팅 소재와 지정 비율 PNG를 생성합니다.
---

# Marketing Creative v3

## Grounding
- Use `brandContext` as the primary factual source when it is present.
- For `product_url`, inspect the public `productUrl` and add only facts directly verified on that page. If it cannot be read, do not infer missing facts.
- One target, one concrete benefit, and one honest action per output.
- Use only verified offer conditions and supplied evidence.
- Never invent discounts, deadlines, testimonials, or performance.
- When a selected reference contains `mediaUrl` or `previewUrl`, inspect the image and use only its information hierarchy, contrast, eye flow, and presentation method as visual guidance.
- Never copy a reference's wording, people, logos, proprietary graphics, or composition.

## Creative
- Start from the requested aspect ratio; never depend on cropping.
- Distinguish multiple outputs by message hypothesis, not only color.
- Keep text legible and do not draw fake buttons or platform UI.
- Write natural Korean, not generic AI advertising filler.

## Output
- Analyze jobs write `analysis.json`.
- Generate jobs write `content.json` and `creative.png`.
- `content.json` must use exactly this compatible shape:
  `{"title":"결과 제목","content":{"headline":"헤드라인","body":"본문","cta":"행동 문구","concept":"소재 콘셉트"}}`
- `creative.png` must match the requested width and height exactly. Do not wrap these fields in another manifest.
