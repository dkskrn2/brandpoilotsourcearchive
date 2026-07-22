export interface InstagramTrendRelevanceInput {
  hashtag: string;
  caption: string | null;
  categoryTerms: string[];
}

export interface InstagramTrendRelevanceResult {
  relevant: boolean;
  score: number;
  reason: "relevant" | "caption_missing" | "hashtag_mismatch" | "ambiguous_hashtag_without_category_context";
  matchedTerms: string[];
}

const AMBIGUOUS_SHORT_TAGS = new Set(["ai", "it", "x", "ad", "pr"]);

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/^#+/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function hashtagTokens(value: string) {
  return [...value.normalize("NFKC").toLocaleLowerCase().matchAll(/#([\p{L}\p{N}_]+)/gu)]
    .map((match) => normalize(match[1] ?? ""));
}

export function assessInstagramTrendRelevance(input: InstagramTrendRelevanceInput): InstagramTrendRelevanceResult {
  const caption = input.caption?.trim();
  if (!caption) return { relevant: false, score: 0, reason: "caption_missing", matchedTerms: [] };
  const hashtag = normalize(input.hashtag);
  const normalizedCaption = normalize(caption);
  const exactHashtag = hashtagTokens(caption).includes(hashtag);
  const categoryTerms = [...new Set(input.categoryTerms.map(normalize).filter((term) => term.length >= 2 && term !== hashtag))];
  const matchedTerms = categoryTerms.filter((term) => normalizedCaption.includes(term));
  const hashtagMention = hashtag.length >= 3 && normalizedCaption.includes(hashtag);
  const score = Math.min(1, (exactHashtag ? 0.55 : hashtagMention ? 0.35 : 0) + Math.min(0.45, matchedTerms.length * 0.15));
  if (AMBIGUOUS_SHORT_TAGS.has(hashtag) && matchedTerms.length === 0) {
    return { relevant: false, score, reason: "ambiguous_hashtag_without_category_context", matchedTerms };
  }
  if (!exactHashtag && !hashtagMention && matchedTerms.length === 0) {
    return { relevant: false, score, reason: "hashtag_mismatch", matchedTerms };
  }
  return { relevant: score >= 0.35, score, reason: score >= 0.35 ? "relevant" : "hashtag_mismatch", matchedTerms };
}
