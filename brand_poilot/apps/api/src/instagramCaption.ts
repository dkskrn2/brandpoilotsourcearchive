const prohibitedCtaPattern = /(자세히\s*확인하기|더\s*알아보기|문의하기|상담\s*신청|지금\s*확인)/i;

function normalizeParagraphs(caption: string) {
  return caption
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

function normalizeHashtags(hashtags: unknown) {
  if (!Array.isArray(hashtags)) throw new Error("instagram_caption_hashtags_invalid");
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const tag of hashtags) {
    if (typeof tag !== "string") throw new Error("instagram_caption_hashtags_invalid");
    const value = tag.trim().replace(/^#/, "");
    if (!value || /[\s#]/.test(value)) throw new Error("instagram_caption_hashtags_invalid");
    const canonical = `#${value}`;
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(canonical);
  }
  return normalized.slice(0, 5);
}

export function containsProhibitedInstagramCta(value: string) {
  return prohibitedCtaPattern.test(value);
}

export function formatInstagramCaption(caption: string, hashtags: unknown) {
  const paragraphs = normalizeParagraphs(caption);
  if (containsProhibitedInstagramCta(caption)) throw new Error("instagram_caption_prohibited_cta");
  if (paragraphs.length === 0) throw new Error("instagram_caption_paragraphs_invalid");
  return `${paragraphs.join("\n\n")}\n\n${normalizeHashtags(hashtags).join(" ")}`;
}
