export const CONTENT_SUGGESTION_BATCH_VERSION = "content-suggestion-batch.v1" as const;
export const CONTENT_SUGGESTION_SCOPE_VERSION = "content-suggestion-scope.v1" as const;
export const CONTENT_SUGGESTION_PUBLISH_RESULT_VERSION = "content-suggestion-publish-result.v1" as const;

export type ContentSuggestionIntent = "informational" | "trend";

export interface ContentSuggestionSource {
  url: string;
  title: string;
  publisher: string;
  publishedAt: string | null;
}

export interface ContentSuggestionBatchItemInput {
  subcategoryCode: string;
  intent: ContentSuggestionIntent;
  position: 1 | 2;
  title: string;
  whyNow: string;
  contentBrief: string;
  sources: ContentSuggestionSource[];
}

export interface ContentSuggestionBatchInput {
  contractVersion: typeof CONTENT_SUGGESTION_BATCH_VERSION;
  categoryCode: string;
  generationDate: string;
  items: ContentSuggestionBatchItemInput[];
}

export interface ContentSuggestionScopeDto {
  contractVersion: typeof CONTENT_SUGGESTION_SCOPE_VERSION;
  generationDate: string;
  timezone: "Asia/Seoul";
  category: { code: string; name: string };
  subcategories: Array<{ code: string; name: string }>;
  intents: ContentSuggestionIntent[];
  maxItemsPerSubcategoryIntent: 2;
  maxSourcesPerItem: 3;
}

export interface ContentSuggestionPublishResultDto {
  contractVersion: typeof CONTENT_SUGGESTION_PUBLISH_RESULT_VERSION;
  status: "published";
  batchId: string;
  savedCount: number;
  generationDate: string;
}

export interface ContentSuggestionItemDto {
  id: string;
  subcategoryCode: string;
  subcategoryName: string;
  intent: ContentSuggestionIntent;
  title: string;
  whyNow: string;
  contentBrief: string;
}

export interface ContentSuggestionListDto {
  category: { code: string; name: string } | null;
  personal: ContentSuggestionItemDto[];
  general: ContentSuggestionItemDto[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("content_suggestion_unknown_field");
  }
}

function normalizedString(
  value: unknown,
  error: string,
  maxLength: number,
  tooLongError = error,
): string {
  if (typeof value !== "string") throw new Error(error);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error(error);
  if (normalized.length > maxLength) throw new Error(tooLongError);
  return normalized;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseContentSuggestionCategoryCode(value: unknown): string {
  if (typeof value !== "string") throw new Error("content_suggestion_category_code_invalid");
  const code = value.trim();
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(code) || code.length > 64) {
    throw new Error("content_suggestion_category_code_invalid");
  }
  return code;
}

function parseSource(value: unknown): ContentSuggestionSource {
  if (!isRecord(value)) throw new Error("content_suggestion_source_invalid");
  assertExactKeys(value, ["url", "title", "publisher", "publishedAt"]);
  const url = normalizedString(value.url, "content_suggestion_source_url_invalid", 2048);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("content_suggestion_source_url_invalid");
    }
  } catch {
    throw new Error("content_suggestion_source_url_invalid");
  }
  if (value.publishedAt !== null && !isIsoDate(value.publishedAt)) {
    throw new Error("content_suggestion_source_published_at_invalid");
  }
  return {
    url,
    title: normalizedString(value.title, "content_suggestion_source_title_invalid", 300),
    publisher: normalizedString(value.publisher, "content_suggestion_source_publisher_invalid", 120),
    publishedAt: value.publishedAt,
  };
}

function parseItem(value: unknown): ContentSuggestionBatchItemInput {
  if (!isRecord(value)) throw new Error("content_suggestion_item_invalid");
  assertExactKeys(value, [
    "subcategoryCode",
    "intent",
    "position",
    "title",
    "whyNow",
    "contentBrief",
    "sources",
  ]);
  if (value.intent !== "informational" && value.intent !== "trend") {
    throw new Error("content_suggestion_intent_invalid");
  }
  if (value.position !== 1 && value.position !== 2) {
    throw new Error("content_suggestion_position_invalid");
  }
  if (!Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 3) {
    throw new Error("content_suggestion_sources_invalid");
  }
  return {
    subcategoryCode: parseContentSuggestionCategoryCode(value.subcategoryCode),
    intent: value.intent,
    position: value.position,
    title: normalizedString(
      value.title,
      "content_suggestion_title_invalid",
      120,
      "content_suggestion_title_too_long",
    ),
    whyNow: normalizedString(
      value.whyNow,
      "content_suggestion_why_now_invalid",
      300,
      "content_suggestion_why_now_too_long",
    ),
    contentBrief: normalizedString(
      value.contentBrief,
      "content_suggestion_content_brief_invalid",
      500,
      "content_suggestion_content_brief_too_long",
    ),
    sources: value.sources.map(parseSource),
  };
}

export function parseContentSuggestionBatch(value: unknown): ContentSuggestionBatchInput {
  if (!isRecord(value)) throw new Error("content_suggestion_batch_invalid");
  assertExactKeys(value, ["contractVersion", "categoryCode", "generationDate", "items"]);
  if (value.contractVersion !== CONTENT_SUGGESTION_BATCH_VERSION) {
    throw new Error("content_suggestion_contract_version_invalid");
  }
  if (!isIsoDate(value.generationDate)) {
    throw new Error("content_suggestion_generation_date_invalid");
  }
  if (!Array.isArray(value.items) || value.items.length === 0) {
    throw new Error("content_suggestion_items_required");
  }
  if (value.items.length > 28) {
    throw new Error("content_suggestion_items_limit_exceeded");
  }
  const items = value.items.map(parseItem);
  const slots = new Set<string>();
  for (const item of items) {
    const slot = `${item.subcategoryCode}\0${item.intent}\0${item.position}`;
    if (slots.has(slot)) throw new Error("content_suggestion_duplicate_slot");
    slots.add(slot);
  }
  return {
    contractVersion: CONTENT_SUGGESTION_BATCH_VERSION,
    categoryCode: parseContentSuggestionCategoryCode(value.categoryCode),
    generationDate: value.generationDate,
    items,
  };
}
