import { createHash } from "node:crypto";

export const AI_CONTENT_VISUAL_RENDER_POLICY_VERSION = "visual-render-policy.d2pp.v4";

export const AI_CONTENT_VISUAL_RENDER_POLICY = Object.freeze({
  execution: [
    "Generate every scene in this visual session in ascending index order within this single execution.",
    "Call image_generation exactly once per scene. Do not retry a scene. Stop immediately if any scene fails.",
    "For Scene N, the image_generation tool prompt MUST begin with the exact first line BRAND_PILOT_SCENE_INDEX=N followed by a newline. This is an execution binding, not display copy.",
    "Do not use a previously generated scene as a reference image for a later scene.",
  ],
  primaryMedium: {
    brandStyleReference: "Use the approved brand-style reference files as the primary visual medium authority for the complete output.",
    freeOnce: "Choose one primary visual medium once before Scene 1, then keep that medium consistent for the complete output. Do not default to editorial illustration or any named medium.",
  },
  canvas: {
    cardNews: "Every Card News scene must be composed directly on a native 1:1 square canvas. Do not generate a portrait or landscape canvas and convert it afterward. Do not crop, letterbox, pillarbox, pad, or add white bands to reach 1:1.",
    reel: "Every Reel scene must be composed directly on a native 1080x1920 pixel 9:16 portrait canvas. Do not generate a different aspect ratio and convert it afterward. Do not crop, letterbox, pillarbox, pad, or add white bands to reach 9:16.",
  },
  editorial: [
    "Treat every scene as one page in a cohesive social editorial card series, not as an isolated cinematic poster, magazine cover, or presentation slide. Use clear modular information hierarchy while preserving per-scene composition freedom.",
    "Vary composition without changing the primary medium. Repeated semantic relation types must not force repeated layouts.",
    "Keep the font family or closest available font style, weight system, and typographic character as consistent as possible across every scene in this complete output. Vary size and weight only when needed for information hierarchy.",
    "informationRelation is semantic meaning only, never a chart, split-screen, column, or composition instruction.",
    "related_facts groups related independent claims. Never depict it as before/after, equal-denominator KPIs, or direct numeric comparison unless the locked relation says so.",
    "Only render substantive text from headline, supportingTexts, footnote, relation label/value, and mandatory brand text.",
    "Short structural labels are allowed only when they clarify the existing information hierarchy without adding content: Step 1, 핵심, 사례, 포인트, relation-valid Before/After, and simple list or step numbering. These labels must not add substantive meaning.",
    "Do not add new facts, claims, numbers, dates, conditions, sources, or quotes beyond locked display copy.",
    "Do not add CTA or button copy, invented brands, products, logos, decorative slogans, speech bubbles, or pseudo-UI copy.",
    "Do not add long explanatory text outside locked display copy.",
    "Do not add page counters, pagination, or progress markers. Page numbers, slide counters, 1/5 labels, pagination badges, and sequence numerals used only as page numbering are forbidden.",
    "Page numbers, slide counters, 1/5 labels, pagination badges, and sequence numerals used only as page markers are forbidden. Their presence is not a reason to retry; generate only once.",
    "Preserve locked copy meaning and numbers. Pixel-level OCR equality is not automatically judged.",
    "The complete editorial context is non-display context. Never print it unless the same text is also in the current scene locked display.",
  ],
});

const canonicalPolicyJson = JSON.stringify(AI_CONTENT_VISUAL_RENDER_POLICY);
export const AI_CONTENT_VISUAL_RENDER_POLICY_SHA256 = createHash("sha256")
  .update(canonicalPolicyJson)
  .digest("hex");

export function compileAiContentVisualRenderPolicy({ outputFormat, primaryMediumMode }) {
  const medium = primaryMediumMode === "brand_style_reference"
    ? AI_CONTENT_VISUAL_RENDER_POLICY.primaryMedium.brandStyleReference
    : AI_CONTENT_VISUAL_RENDER_POLICY.primaryMedium.freeOnce;
  const canvas = outputFormat === "reel"
    ? AI_CONTENT_VISUAL_RENDER_POLICY.canvas.reel
    : AI_CONTENT_VISUAL_RENDER_POLICY.canvas.cardNews;
  return [
    `CANONICAL_D2PP_RENDER_POLICY_VERSION=${AI_CONTENT_VISUAL_RENDER_POLICY_VERSION}`,
    `CANONICAL_D2PP_RENDER_POLICY_SHA256=${AI_CONTENT_VISUAL_RENDER_POLICY_SHA256}`,
    ...AI_CONTENT_VISUAL_RENDER_POLICY.execution,
    medium,
    ...(canvas ? [canvas] : []),
    ...AI_CONTENT_VISUAL_RENDER_POLICY.editorial,
  ];
}
