export const faqSuggestionCategories = [
  "service",
  "product",
  "price_payment",
  "location_visit",
  "hours",
  "shipping",
  "exchange_refund",
  "reservation_usage",
  "account_membership",
  "other",
] as const;

export type FaqSuggestionCategory = typeof faqSuggestionCategories[number];
export type FaqSuggestionSourceType =
  | "brand_core"
  | "product_service"
  | "owned_snapshot"
  | "document"
  | "faq";

export interface FaqSuggestionWorkerSource {
  sourceType: FaqSuggestionSourceType;
  sourceId: string;
  label: string;
  content: string;
  contentHash: string;
}

export interface FaqSuggestionWorkerInput {
  contractVersion: "faq-suggestion-input.v1";
  runId: string;
  workspaceId: string;
  brandId: string;
  leaseToken: string;
  sources: FaqSuggestionWorkerSource[];
  existingFaqs: Array<{ id: string; question: string; answer: string }>;
}

export interface ValidFaqSuggestion {
  category: FaqSuggestionCategory;
  question: string;
  answer: string;
  evidence: Array<{
    sourceType: FaqSuggestionSourceType;
    sourceId: string;
    label: string;
  }>;
  confidence: number;
}

export interface FaqSuggestionWorkerResult {
  suggestions: ValidFaqSuggestion[];
  rejections: Array<{ index: number; code: string }>;
}

const categorySet = new Set<string>(faqSuggestionCategories);
const rawUrlPattern = /(?:https?:\/\/|www\.)\S+/iu;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactFields(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((field) => allowed.includes(field));
}

function validateItem(
  value: unknown,
  sources: Map<string, FaqSuggestionWorkerSource>,
): { suggestion?: ValidFaqSuggestion; code?: string } {
  const item = record(value);
  if (!item || !hasExactFields(item, [
    "category", "question", "answer", "evidence", "confidence",
  ])) return { code: "faq_suggestion_item_contract_invalid" };
  if (typeof item.category !== "string" || !categorySet.has(item.category)) {
    return { code: "faq_suggestion_category_invalid" };
  }
  const question = typeof item.question === "string" ? item.question.trim() : "";
  if (!question || question.length > 500) return { code: "faq_suggestion_question_invalid" };
  const answer = typeof item.answer === "string" ? item.answer.trim() : "";
  if (!answer || answer.length > 2_000) return { code: "faq_suggestion_answer_invalid" };
  if (rawUrlPattern.test(answer)) return { code: "faq_suggestion_answer_url_forbidden" };
  if (typeof item.confidence !== "number"
    || !Number.isFinite(item.confidence)
    || item.confidence < 0
    || item.confidence > 1) {
    return { code: "faq_suggestion_confidence_invalid" };
  }
  if (!Array.isArray(item.evidence)
    || item.evidence.length < 1
    || item.evidence.length > 5) {
    return { code: "faq_suggestion_evidence_invalid" };
  }

  const evidence: ValidFaqSuggestion["evidence"] = [];
  const seen = new Set<string>();
  for (const rawEvidence of item.evidence) {
    const candidate = record(rawEvidence);
    if (!candidate
      || !hasExactFields(candidate, ["sourceType", "sourceId"])
      || typeof candidate.sourceType !== "string"
      || typeof candidate.sourceId !== "string") {
      return { code: "faq_suggestion_evidence_invalid" };
    }
    const key = `${candidate.sourceType.trim().toLowerCase()}:${candidate.sourceId.trim().toLowerCase()}`;
    if (seen.has(key)) return { code: "faq_suggestion_evidence_duplicate" };
    seen.add(key);
    const source = sources.get(key);
    if (!source) return { code: "faq_suggestion_evidence_not_provided" };
    evidence.push({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      label: source.label,
    });
  }

  return {
    suggestion: {
      category: item.category as FaqSuggestionCategory,
      question,
      answer,
      evidence,
      confidence: item.confidence,
    },
  };
}

export function validateFaqSuggestionResult(
  value: unknown,
  input: FaqSuggestionWorkerInput,
): FaqSuggestionWorkerResult {
  const result = record(value);
  if (!result
    || !hasExactFields(result, ["contractVersion", "suggestions"])
    || result.contractVersion !== "faq-suggestion-result.v1"
    || !Array.isArray(result.suggestions)) {
    throw new Error("faq_suggestion_result_contract_invalid");
  }
  if (result.suggestions.length > 20) throw new Error("faq_suggestion_limit_exceeded");

  const sources = new Map(input.sources.map((source) => [
    `${source.sourceType.toLowerCase()}:${source.sourceId.toLowerCase()}`,
    source,
  ]));
  const suggestions: ValidFaqSuggestion[] = [];
  const rejections: FaqSuggestionWorkerResult["rejections"] = [];
  for (const [index, rawSuggestion] of result.suggestions.entries()) {
    const validated = validateItem(rawSuggestion, sources);
    if (validated.suggestion) suggestions.push(validated.suggestion);
    else rejections.push({ index, code: validated.code ?? "faq_suggestion_item_contract_invalid" });
  }
  if (!suggestions.length) {
    throw new Error(rejections[0]?.code ?? "faq_suggestion_result_empty");
  }
  return { suggestions, rejections };
}
