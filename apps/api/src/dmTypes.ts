export type DmDecision = "answer" | "fallback" | "ignore" | "error";

export interface DmWorkerResult {
  decision: DmDecision;
  answer: string | null;
  wikiChunkIds: string[];
  confidence: number | null;
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
  const confidence = candidate.confidence === null || (
    typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence) && candidate.confidence >= 0 && candidate.confidence <= 1
  )
    ? candidate.confidence
    : (() => { throw new Error("dm_confidence_invalid"); })();

  if (decision === "answer") {
    if (wikiChunkIds.length === 0) throw new Error("dm_answer_sources_required");
    return {
      decision,
      answer: requiredString(candidate.answer, "dm_answer_required"),
      wikiChunkIds,
      confidence,
      reason,
    };
  }

  if (candidate.answer !== null) throw new Error("dm_non_answer_must_not_include_answer");
  if (wikiChunkIds.length > 0) throw new Error("dm_non_answer_must_not_include_sources");
  return { decision, answer: null, wikiChunkIds, confidence, reason };
}
