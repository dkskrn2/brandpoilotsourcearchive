import type { ClaimedDmJob } from "./client.js";
import { createEmbedding } from "./embeddings.js";
import { buildDmPrompt } from "./prompts.js";

export type DmWorkerResult = {
  decision: "answer" | "fallback" | "ignore" | "error";
  answer: string | null;
  wikiChunkIds: string[];
  confidence: number | null;
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
  searchWiki(workspaceId: string, brandId: string, question: string, embedding: number[]): Promise<Array<{ id: string; content: string; score: number }>>;
  conversationHistory(workspaceId: string, brandId: string, conversationId: string): Promise<Array<{ direction: string; body: string | null }>>;
}

function validateResult(value: unknown): DmWorkerResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("dm_result_invalid");
  const candidate = value as Record<string, unknown>;
  if (!["answer", "fallback", "ignore", "error"].includes(String(candidate.decision))) throw new Error("dm_decision_invalid");
  const decision = candidate.decision as DmWorkerResult["decision"];
  const answer = typeof candidate.answer === "string" && candidate.answer.trim() ? candidate.answer.trim() : null;
  const wikiChunkIds = Array.isArray(candidate.wikiChunkIds) && candidate.wikiChunkIds.every((id) => typeof id === "string") ? candidate.wikiChunkIds : [];
  const confidence = typeof candidate.confidence === "number" && candidate.confidence >= 0 && candidate.confidence <= 1 ? candidate.confidence : null;
  const reason = typeof candidate.reason === "string" && candidate.reason.trim() ? candidate.reason.trim() : "worker_result";
  if (decision === "answer" && (!answer || wikiChunkIds.length === 0)) throw new Error("dm_answer_contract_invalid");
  return { decision, answer: decision === "answer" ? answer : null, wikiChunkIds: decision === "answer" ? wikiChunkIds : [], confidence, reason };
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
  runCodex: (input: { prompt: string; runtimeDirectory: string; timeoutMs: number }) => Promise<unknown>;
}) {
  await api.heartbeatWorker(workerId);
  const job = await api.claim(workerId);
  if (!job) return { status: "idle" as const };
  try {
    const embedding = await embed({ text: job.payload.question, apiKey, model: embeddingModel });
    const [chunks, history] = await Promise.all([
      db.searchWiki(job.workspaceId, job.brandId, job.payload.question, embedding),
      db.conversationHistory(job.workspaceId, job.brandId, job.payload.conversationId),
    ]);
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
    const retryable = /^(codex_timeout|embedding_request_failed:5|worker_api_failed:5)/.test(message);
    await api.fail(job.id, workerId, job.leaseToken, message, retryable, retryable ? 5_000 : 0);
    return { status: "failed" as const, jobId: job.id };
  }
}
