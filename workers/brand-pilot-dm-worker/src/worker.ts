import type { ClaimedDmJob } from "./client.js";
import type { WikiSearchChunk } from "./db.js";
import { createEmbedding } from "./embeddings.js";
import { buildDmPrompt } from "./prompts.js";

export type DmReasonCode =
  | "direct_faq"
  | "wiki_answer"
  | "restricted_action"
  | "complaint"
  | "knowledge_gap"
  | "low_confidence"
  | "processing_error"
  | "system_event";

export type DmWorkerResult = {
  decision: "answer" | "fallback" | "ignore" | "error";
  answer: string | null;
  wikiChunkIds: string[];
  knowledgeEntryId: string | null;
  confidence: number | null;
  reasonCode: DmReasonCode;
  needsAttention: boolean;
  reason: string;
};

export interface DmWorkerClient {
  claim(workerId: string): Promise<ClaimedDmJob | null>;
  heartbeat(jobId: string, workerId: string, leaseToken: string): Promise<unknown>;
  complete(jobId: string, workerId: string, leaseToken: string, result: DmWorkerResult): Promise<unknown>;
  fail(jobId: string, workerId: string, leaseToken: string, error: string, retryable: boolean, retryAfterMs: number): Promise<unknown>;
  heartbeatWorker(workerId: string): Promise<unknown>;
}

export interface DmWorkerDb {
  searchWiki(workspaceId: string, brandId: string, question: string, embedding: number[]): Promise<WikiSearchChunk[]>;
  conversationHistory(workspaceId: string, brandId: string, conversationId: string): Promise<Array<{ direction: string; body: string | null }>>;
}

export async function runWorkerCycle<
  DmResult extends { status: string },
  ProfileResult extends { status: string },
  WikiResult extends { status: string },
>({
  runDm,
  runProfile,
  runWiki,
}: {
  runDm: () => Promise<DmResult>;
  runProfile: () => Promise<ProfileResult>;
  runWiki: () => Promise<WikiResult>;
}): Promise<DmResult | ProfileResult | WikiResult> {
  const dm = await runDm();
  if (dm.status !== "idle") return dm;
  const profile = await runProfile();
  if (profile.status !== "idle") return profile;
  return runWiki();
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unitInterval(name: string, value: string | undefined, fallback: number) {
  if (value === undefined || !value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error(`${name}_invalid`);
  return parsed;
}

export function readDirectFaqThresholds(env: Record<string, string | undefined>) {
  const similarity = env.DM_DIRECT_FAQ_MIN_SIMILARITY ?? env.DM_DIRECT_FAQ_SIMILARITY_THRESHOLD;
  const margin = env.DM_DIRECT_FAQ_MIN_MARGIN ?? env.DM_DIRECT_FAQ_MARGIN_THRESHOLD;
  return {
    similarity: unitInterval(
      "DM_DIRECT_FAQ_MIN_SIMILARITY",
      similarity,
      0.88,
    ),
    margin: unitInterval("DM_DIRECT_FAQ_MIN_MARGIN", margin, 0.05),
  };
}

function requiredString(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(errorCode);
  return value.trim();
}

export function validateResult(value: unknown): DmWorkerResult {
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
  const confidence = candidate.confidence === null || (
    typeof candidate.confidence === "number"
    && Number.isFinite(candidate.confidence)
    && candidate.confidence >= 0
    && candidate.confidence <= 1
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

  if (decision === "answer") {
    if (wikiChunkIds.length === 0 && knowledgeEntryId === null) {
      throw new Error("dm_answer_sources_required");
    }
    return {
      decision,
      answer: requiredString(candidate.answer, "dm_answer_required"),
      wikiChunkIds,
      knowledgeEntryId,
      confidence,
      reasonCode,
      needsAttention: candidate.needsAttention,
      reason,
    };
  }

  if (candidate.answer !== null) throw new Error("dm_non_answer_must_not_include_answer");
  if (wikiChunkIds.length > 0 || knowledgeEntryId !== null) {
    throw new Error("dm_non_answer_must_not_include_sources");
  }
  return {
    decision,
    answer: null,
    wikiChunkIds,
    knowledgeEntryId,
    confidence,
    reasonCode,
    needsAttention: candidate.needsAttention,
    reason,
  };
}

function fixedFallbackResult(reasonCode: DmReasonCode): DmWorkerResult {
  return {
    decision: "fallback",
    answer: null,
    wikiChunkIds: [],
    knowledgeEntryId: null,
    confidence: null,
    reasonCode,
    needsAttention: true,
    reason: `server_policy:${reasonCode}`,
  };
}

function directFaqResult(knowledgeEntryId: string, confidence: number, reason: string): DmWorkerResult {
  if (!uuidPattern.test(knowledgeEntryId)) throw new Error("dm_exact_faq_id_invalid");
  return {
    decision: "answer",
    answer: null,
    wikiChunkIds: [],
    knowledgeEntryId,
    confidence,
    reasonCode: "direct_faq",
    needsAttention: false,
    reason,
  };
}

export async function runDmWorkerOnce({
  workerId,
  api,
  db,
  apiKey,
  embeddingModel = "text-embedding-3-small",
  directFaqSimilarityThreshold = 0.88,
  directFaqMarginThreshold = 0.05,
  runtimeDirectory,
  timeoutMs = 10_000,
  embed = createEmbedding,
  runCodex,
}: {
  workerId: string;
  api: DmWorkerClient;
  db: DmWorkerDb;
  apiKey: string;
  embeddingModel?: string;
  directFaqSimilarityThreshold?: number;
  directFaqMarginThreshold?: number;
  runtimeDirectory: string;
  timeoutMs?: number;
  embed?: typeof createEmbedding;
  runCodex: (input: { prompt: string; runtimeDirectory: string; timeoutMs: number }) => Promise<unknown>;
}) {
  await api.heartbeatWorker(workerId);
  const job = await api.claim(workerId);
  if (!job) return { status: "idle" as const };
  try {
    if (job.payload.route === "fixed_fallback") {
      const result = fixedFallbackResult(job.payload.policyReasonCode);
      await api.complete(job.id, workerId, job.leaseToken, result);
      return { status: "completed" as const, jobId: job.id, decision: result.decision };
    }

    if (job.payload.exactFaqId) {
      const result = directFaqResult(job.payload.exactFaqId, 1, "payload_exact_faq");
      await api.complete(job.id, workerId, job.leaseToken, result);
      return { status: "completed" as const, jobId: job.id, decision: result.decision };
    }

    const embedding = await embed({ text: job.payload.question, apiKey, model: embeddingModel });
    const chunks = await db.searchWiki(job.workspaceId, job.brandId, job.payload.question, embedding);
    if (chunks.length === 0) {
      const result = fixedFallbackResult("knowledge_gap");
      result.reason = "wiki_no_basis";
      await api.complete(job.id, workerId, job.leaseToken, result);
      return { status: "completed" as const, jobId: job.id, decision: result.decision };
    }

    const top = chunks[0];
    const secondSimilarity = chunks[1]?.cosineSimilarity ?? 0;
    if (
      top.sourceKind === "faq"
      && top.directAnswer !== null
      && top.knowledgeEntryId !== null
      && top.cosineSimilarity >= directFaqSimilarityThreshold
      && top.cosineSimilarity - secondSimilarity >= directFaqMarginThreshold
    ) {
      const result = directFaqResult(top.knowledgeEntryId, top.cosineSimilarity, "embedding_direct_faq");
      await api.complete(job.id, workerId, job.leaseToken, result);
      return { status: "completed" as const, jobId: job.id, decision: result.decision };
    }

    const history = await db.conversationHistory(job.workspaceId, job.brandId, job.payload.conversationId);
    const rawResult = await runCodex({
      prompt: buildDmPrompt({ question: job.payload.question, history, chunks }),
      runtimeDirectory,
      timeoutMs,
    });
    const result = validateResult(rawResult);
    await api.complete(job.id, workerId, job.leaseToken, result);
    return { status: "completed" as const, jobId: job.id, decision: result.decision };
  } catch (error) {
    const message = error instanceof Error ? error.message : "dm_worker_unknown_error";
    const retryable = message === "fetch failed" || /^(codex_timeout|embedding_request_failed:5|worker_api_failed:5)/.test(message);
    await api.fail(job.id, workerId, job.leaseToken, message, retryable, retryable ? 5_000 : 0);
    return { status: "failed" as const, jobId: job.id };
  }
}
