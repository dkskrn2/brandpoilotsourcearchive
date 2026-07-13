const prohibitedCtaPattern = /(자세히\s*확인하기|더\s*알아보기|문의하기|상담\s*신청|지금\s*확인)/i;

function normalizeParagraphs(caption: string) {
  return caption
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

function normalizeHashtags(hashtags: unknown) {
  if (!Array.isArray(hashtags)) throw new Error("instagram_caption_hashtags_invalid");
  const normalized = hashtags.map((tag) => typeof tag === "string" ? tag.trim() : "");
  if (
    normalized.length !== 5 ||
    normalized.some((tag) => !/^#[^\s#]+$/.test(tag)) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new Error("instagram_caption_hashtags_invalid");
  }
  return normalized;
}

export function containsProhibitedInstagramCta(value: string) {
  return prohibitedCtaPattern.test(value);
}

export function formatInstagramCaption(caption: string, hashtags: unknown) {
  const paragraphs = normalizeParagraphs(caption);
  if (containsProhibitedInstagramCta(caption)) throw new Error("instagram_caption_prohibited_cta");
  if (paragraphs.length < 2) throw new Error("instagram_caption_paragraphs_invalid");
  return `${paragraphs.join("\n\n")}\n\n${normalizeHashtags(hashtags).join(" ")}`;
}
