import { parseFaqUtterances } from "./faqUtterancePolicy.js";

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

export type FaqSuggestionRunStatus =
  | "queued"
  | "running"
  | "review_ready"
  | "partial"
  | "failed"
  | "completed";

export type FaqSuggestionItemStatus =
  | "review"
  | "approved"
  | "dismissed"
  | "duplicate";

export type FaqSuggestionSourceType =
  | "brand_core"
  | "product_service"
  | "owned_snapshot"
  | "document"
  | "faq";

export interface FaqSuggestionEvidenceDto {
  sourceType: FaqSuggestionSourceType;
  sourceId: string;
  label: string;
}

export interface FaqSuggestionItemDto {
  id: string;
  workspaceId: string;
  brandId: string;
  runId: string;
  position: number;
  category: FaqSuggestionCategory;
  question: string;
  answer: string;
  exampleUtterances: string[];
  evidence: FaqSuggestionEvidenceDto[];
  confidence: number;
  status: FaqSuggestionItemStatus;
  duplicateOfKnowledgeEntryId: string | null;
  approvedKnowledgeEntryId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FaqSuggestionRunDto {
  id: string;
  workspaceId: string;
  brandId: string;
  status: FaqSuggestionRunStatus;
  errorCode: string | null;
  createdByUserId: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: FaqSuggestionItemDto[];
}

export interface FaqAliasSuggestionRunDto {
  id: string;
  workspaceId: string;
  brandId: string;
  status: FaqSuggestionRunStatus;
  errorCode: string | null;
  targetKnowledgeEntryId: string;
  targetKnowledgeEntryUpdatedAt: string;
  exampleUtterances: string[] | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface FaqAliasSuggestionApply {
  expectedUpdatedAt: string;
  exampleUtterances?: string[];
}

export interface FaqSuggestionItemUpdate {
  category: FaqSuggestionCategory;
  question: string;
  answer: string;
  exampleUtterances?: string[];
  expectedUpdatedAt: string;
}

export interface FaqSuggestionReviewAction {
  expectedUpdatedAt: string;
}

const categorySet = new Set<FaqSuggestionCategory>(faqSuggestionCategories);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("faq_suggestion_validation_failed:root");
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowedFields: readonly string[],
): void {
  const unknownField = Object.keys(value).find((field) => !allowedFields.includes(field));
  if (unknownField) {
    throw new Error(`faq_suggestion_validation_failed:${unknownField}`);
  }
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new Error(`faq_suggestion_validation_failed:${field}`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`faq_suggestion_validation_failed:${field}`);
  }
  return normalized;
}

function expectedTimestamp(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("faq_suggestion_validation_failed:expectedUpdatedAt");
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== value) {
    throw new Error("faq_suggestion_validation_failed:expectedUpdatedAt");
  }
  return value;
}

export function parseFaqSuggestionItemUpdate(value: unknown): FaqSuggestionItemUpdate {
  const input = record(value);
  rejectUnknownFields(input, [
    "category",
    "question",
    "answer",
    "exampleUtterances",
    "expectedUpdatedAt",
  ]);

  if (typeof input.category !== "string"
    || !categorySet.has(input.category as FaqSuggestionCategory)) {
    throw new Error("faq_suggestion_validation_failed:category");
  }

  return {
    category: input.category as FaqSuggestionCategory,
    question: requiredText(input.question, "question", 500),
    answer: requiredText(input.answer, "answer", 2_000),
    ...(input.exampleUtterances === undefined
      ? {}
      : { exampleUtterances: parseProposalFaqUtterances(input.exampleUtterances) }),
    expectedUpdatedAt: expectedTimestamp(input.expectedUpdatedAt),
  };
}

export function parseFaqSuggestionReviewAction(value: unknown): FaqSuggestionReviewAction {
  const input = record(value);
  rejectUnknownFields(input, ["expectedUpdatedAt"]);
  return { expectedUpdatedAt: expectedTimestamp(input.expectedUpdatedAt) };
}

export function parseFaqAliasSuggestionApply(value: unknown): FaqAliasSuggestionApply {
  const input = record(value);
  rejectUnknownFields(input, ["expectedUpdatedAt", "exampleUtterances"]);
  return {
    expectedUpdatedAt: expectedTimestamp(input.expectedUpdatedAt),
    ...(input.exampleUtterances === undefined
      ? {}
      : { exampleUtterances: parseProposalFaqUtterances(input.exampleUtterances) }),
  };
}

function parseProposalFaqUtterances(value: unknown): string[] {
  const utterances = parseFaqUtterances(value);
  if (utterances.length < 3) throw new Error("faq_utterance_validation_failed:min");
  return utterances;
}
