export type DmDecision = "answer" | "fallback" | "ignore" | "error";
export type DmReasonCode =
  | "direct_faq"
  | "wiki_answer"
  | "restricted_action"
  | "complaint"
  | "knowledge_gap"
  | "low_confidence"
  | "processing_error"
  | "system_event";
export type DmAttentionType =
  | "restricted_action"
  | "complaint"
  | "knowledge_gap"
  | "delivery_unknown"
  | "processing_error";
export type DmJobRoute = "fixed_fallback" | "knowledge" | "ignore";

export interface DmWorkerResult {
  decision: DmDecision;
  answer: string | null;
  wikiChunkIds: string[];
  destinationUrlIds?: string[];
  knowledgeEntryId: string | null;
  confidence: number | null;
  reasonCode: DmReasonCode;
  needsAttention: boolean;
  reason: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredString(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(errorCode);
  return value.trim();
}

export function parseDmWorkerResult(value: unknown): DmWorkerResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("dm_result_invalid");
  }

  const candidate = value as Record<string, unknown>;
  const decision = candidate.decision;
  if (decision !== "answer" && decision !== "fallback" && decision !== "ignore" && decision !== "error") {
    throw new Error("dm_decision_invalid");
  }

  const reason = requiredString(candidate.reason, "dm_reason_required");
  const wikiChunkIds = Array.isArray(candidate.wikiChunkIds) && candidate.wikiChunkIds.every(
    (id) => typeof id === "string" && uuidPattern.test(id),
  )
    ? candidate.wikiChunkIds
    : (() => { throw new Error("dm_wiki_chunk_ids_invalid"); })();
  const knowledgeEntryId = candidate.knowledgeEntryId === null || (
    typeof candidate.knowledgeEntryId === "string" && uuidPattern.test(candidate.knowledgeEntryId)
  )
    ? candidate.knowledgeEntryId
    : (() => { throw new Error("dm_knowledge_entry_id_invalid"); })();
  const destinationUrlIds = candidate.destinationUrlIds === undefined
    ? []
    : Array.isArray(candidate.destinationUrlIds) && candidate.destinationUrlIds.length <= 2
      && candidate.destinationUrlIds.every((id) => typeof id === "string" && uuidPattern.test(id))
      ? [...new Set(candidate.destinationUrlIds as string[])]
      : (() => { throw new Error("dm_destination_url_ids_invalid"); })();
  const confidence = candidate.confidence === null || (
    typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence) && candidate.confidence >= 0 && candidate.confidence <= 1
  )
    ? candidate.confidence
    : (() => { throw new Error("dm_confidence_invalid"); })();
  const reasonCode = candidate.reasonCode;
  if (
    reasonCode !== "direct_faq"
    && reasonCode !== "wiki_answer"
    && reasonCode !== "restricted_action"
    && reasonCode !== "complaint"
    && reasonCode !== "knowledge_gap"
    && reasonCode !== "low_confidence"
    && reasonCode !== "processing_error"
    && reasonCode !== "system_event"
  ) {
    throw new Error("dm_reason_code_invalid");
  }
  if (typeof candidate.needsAttention !== "boolean") {
    throw new Error("dm_needs_attention_invalid");
  }
  const needsAttention = candidate.needsAttention;

  if (decision === "answer" && reasonCode === "direct_faq") {
    if (wikiChunkIds.length > 0 || destinationUrlIds.length > 0 || knowledgeEntryId === null) throw new Error("dm_direct_faq_source_invalid");
    const answer = candidate.answer === null ? null : requiredString(candidate.answer, "dm_answer_required");
    return {
      decision,
      answer,
      wikiChunkIds,
      knowledgeEntryId,
      confidence,
      reasonCode,
      needsAttention,
      reason,
    };
  }

  if (decision === "answer") {
    if (wikiChunkIds.length === 0 && knowledgeEntryId === null) throw new Error("dm_answer_sources_required");
    const answer = requiredString(candidate.answer, "dm_answer_required");
    if (/https?:\/\//i.test(answer)) throw new Error("dm_answer_raw_url_forbidden");
    return {
      decision,
      answer,
      wikiChunkIds,
      knowledgeEntryId,
      confidence,
      reasonCode,
      needsAttention,
      reason,
      ...(candidate.destinationUrlIds === undefined ? {} : { destinationUrlIds }),
    };
  }

  if (candidate.answer !== null) throw new Error("dm_non_answer_must_not_include_answer");
  if (wikiChunkIds.length > 0 || destinationUrlIds.length > 0 || knowledgeEntryId !== null) throw new Error("dm_non_answer_must_not_include_sources");
  return {
    decision,
    answer: null,
    wikiChunkIds,
    knowledgeEntryId,
    confidence,
    reasonCode,
    needsAttention,
    reason,
  };
}
