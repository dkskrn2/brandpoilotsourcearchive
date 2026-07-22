import type { ClaimedDmJob } from "./client.js";
import type { CompiledWikiSearchPacket } from "./compiledWikiTypes.js";
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
  destinationUrlIds?: string[];
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
  searchCompiledWiki(workspaceId: string, brandId: string, question: string, embedding: number[]): Promise<CompiledWikiSearchPacket | null>;
  conversationHistory(workspaceId: string, brandId: string, conversationId: string): Promise<Array<{ direction: string; body: string | null }>>;
  recordCompiledWikiRetrieval?(input: {
    workspaceId: string;
    brandId: string;
    question: string;
    packet: CompiledWikiSearchPacket | null;
    result: DmWorkerResult;
    retrievalLatencyMs: number;
    totalLatencyMs: number;
  }): Promise<void>;
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

function requiredString(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(errorCode);
  return value.trim();
}

export function validateResult(value: unknown, packet?: CompiledWikiSearchPacket): DmWorkerResult {
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
    if (packet) {
      const allowedChunks = new Set(packet.chunks.map((chunk) => chunk.chunkId));
      const allowedUrls = new Set(packet.destinationUrls.map((entry) => entry.id));
      if (wikiChunkIds.some((id) => !allowedChunks.has(id))) throw new Error("dm_wiki_chunk_not_provided");
      if (destinationUrlIds.some((id) => !allowedUrls.has(id))) throw new Error("dm_destination_url_not_provided");
    }
    const answer = requiredString(candidate.answer, "dm_answer_required");
    if (/https?:\/\//i.test(answer)) throw new Error("dm_answer_raw_url_forbidden");
    return {
      decision,
      answer,
      wikiChunkIds,
      knowledgeEntryId,
      confidence,
      reasonCode,
      needsAttention: candidate.needsAttention,
      reason,
      ...(candidate.destinationUrlIds === undefined ? {} : { destinationUrlIds }),
    };
  }

  if (candidate.answer !== null) throw new Error("dm_non_answer_must_not_include_answer");
  if (wikiChunkIds.length > 0 || knowledgeEntryId !== null || destinationUrlIds.length > 0) {
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
  runtimeDirectory,
  timeoutMs = 10_000,
  embed = createEmbedding,
  withCodexLease,
  heartbeatIntervalMs = 5_000,
  runCodex,
}: {
  workerId: string;
  api: DmWorkerClient;
  db: DmWorkerDb;
  apiKey: string;
  embeddingModel?: string;
  runtimeDirectory: string;
  timeoutMs?: number;
  embed?: typeof createEmbedding;
  withCodexLease?: <T>(task: () => Promise<T>, onWait: () => Promise<unknown>) => Promise<T>;
  heartbeatIntervalMs?: number;
  runCodex: (input: { prompt: string; runtimeDirectory: string; timeoutMs: number }) => Promise<unknown>;
}) {
  await api.heartbeatWorker(workerId);
  const job = await api.claim(workerId);
  if (!job) return { status: "idle" as const };
  let stopped = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  const heartbeat = () => api.heartbeat(job.id, workerId, job.leaseToken);
  const scheduleHeartbeat = () => {
    heartbeatTimer = setTimeout(() => {
      if (stopped) return;
      void heartbeat().catch(() => undefined).finally(() => {
        if (!stopped) scheduleHeartbeat();
      });
    }, Math.max(1_000, Math.min(heartbeatIntervalMs, 10_000)));
  };
  scheduleHeartbeat();
  const startedAt = Date.now();
  try {
    if (job.payload.route === "fixed_fallback") {
      const result = fixedFallbackResult(job.payload.policyReasonCode);
      await api.complete(job.id, workerId, job.leaseToken, result);
      return { status: "completed" as const, jobId: job.id, decision: result.decision };
    }

    if (job.payload.exactFaqId) {
      const result = directFaqResult(job.payload.exactFaqId, 1, "payload_exact_faq");
      await api.complete(job.id, workerId, job.leaseToken, result);
      void db.recordCompiledWikiRetrieval?.({
        workspaceId: job.workspaceId,
        brandId: job.brandId,
        question: job.payload.question,
        packet: null,
        result,
        retrievalLatencyMs: 0,
        totalLatencyMs: Date.now() - startedAt,
      }).catch((error) => console.error("wiki_retrieval_telemetry_failed", error));
      return { status: "completed" as const, jobId: job.id, decision: result.decision };
    }

    const retrievalStartedAt = Date.now();
    const embedding = await embed({ text: job.payload.question, apiKey, model: embeddingModel });
    const packet = await db.searchCompiledWiki(job.workspaceId, job.brandId, job.payload.question, embedding);
    const retrievalLatencyMs = Date.now() - retrievalStartedAt;
    if (!packet || (!packet.brandCore && packet.chunks.length === 0)) {
      const result = fixedFallbackResult("knowledge_gap");
      result.reason = "wiki_no_basis";
      await api.complete(job.id, workerId, job.leaseToken, result);
      void db.recordCompiledWikiRetrieval?.({
        workspaceId: job.workspaceId, brandId: job.brandId, question: job.payload.question,
        packet, result, retrievalLatencyMs, totalLatencyMs: Date.now() - startedAt,
      }).catch((error) => console.error("wiki_retrieval_telemetry_failed", error));
      return { status: "completed" as const, jobId: job.id, decision: result.decision };
    }

    const history = await db.conversationHistory(job.workspaceId, job.brandId, job.payload.conversationId);
    const executeCodex = () => runCodex({
        prompt: buildDmPrompt({ question: job.payload.question, history, packet }),
        runtimeDirectory,
        timeoutMs,
      });
    const rawResult = withCodexLease
      ? await withCodexLease(executeCodex, heartbeat)
      : await executeCodex();
    const result = validateResult(rawResult, packet);
    await api.complete(job.id, workerId, job.leaseToken, result);
    void db.recordCompiledWikiRetrieval?.({
      workspaceId: job.workspaceId, brandId: job.brandId, question: job.payload.question,
      packet, result, retrievalLatencyMs, totalLatencyMs: Date.now() - startedAt,
    }).catch((error) => console.error("wiki_retrieval_telemetry_failed", error));
    return { status: "completed" as const, jobId: job.id, decision: result.decision };
  } catch (error) {
    const message = error instanceof Error ? error.message : "dm_worker_unknown_error";
    const retryable = message === "fetch failed" || /^(codex_timeout|embedding_request_failed:5|worker_api_failed:5)/.test(message);
    await api.fail(job.id, workerId, job.leaseToken, message, retryable, retryable ? 5_000 : 0);
    return { status: "failed" as const, jobId: job.id };
  } finally {
    stopped = true;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
  }
}
