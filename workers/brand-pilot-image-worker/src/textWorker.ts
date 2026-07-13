import type { CodexTextGenerator } from "./codexTextRunner.js";
import { readRepresentativeSource, type SourceReadResult } from "./sourceReader.js";
import { buildThreadsPrompt, parseThreadsTextPayload } from "./threadsPrompt.js";
import type { ThreadsTextResult } from "./threadsResult.js";

export interface ClaimedTextJob {
  id: string;
  workspaceId: string;
  brandId: string;
  channelOutputId: string;
  leaseToken: string;
  attemptCount: number;
  payload: Record<string, unknown>;
}

type Lease = { workerId: string; leaseToken: string };
type Failure = Lease & { error: string; retryable: boolean; retryAfterMs: number };

export interface TextWorkerClient {
  claim(workerId: string): Promise<ClaimedTextJob | null>;
  heartbeat(jobId: string, input: Lease): Promise<unknown>;
  complete(jobId: string, input: Lease & { result: ThreadsTextResult }): Promise<unknown>;
  fail(jobId: string, input: Failure): Promise<unknown>;
}

function startHeartbeat({
  job,
  workerId,
  client,
  heartbeatIntervalMs
}: {
  job: ClaimedTextJob;
  workerId: string;
  client: TextWorkerClient;
  heartbeatIntervalMs: number;
}) {
  const intervalMs = Math.max(1, Math.min(heartbeatIntervalMs, 5 * 60 * 1000));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = Promise.resolve();
  const schedule = () => {
    timer = setTimeout(() => {
      if (stopped) return;
      active = Promise.resolve()
        .then(() => client.heartbeat(job.id, { workerId, leaseToken: job.leaseToken }))
        .catch(() => undefined)
        .then(() => {
          if (!stopped) schedule();
        });
    }, intervalMs);
  };
  schedule();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await active;
  };
}

function isRetryableTextError(message: string) {
  return /^(codex_text_|worker_api_failed:5)/.test(message);
}

export type TextRunResult =
  | { status: "idle" }
  | { status: "completed"; jobId: string }
  | { status: "failed"; jobId: string };

export async function runTextOnce({
  workerId,
  client,
  generator,
  readSource = readRepresentativeSource,
  buildPrompt = buildThreadsPrompt,
  heartbeatIntervalMs = 5 * 60 * 1000,
  retryDelayMs = 5 * 60 * 1000
}: {
  workerId: string;
  client: TextWorkerClient;
  generator: CodexTextGenerator;
  readSource?: (url: string | null | undefined) => Promise<SourceReadResult>;
  buildPrompt?: typeof buildThreadsPrompt;
  heartbeatIntervalMs?: number;
  retryDelayMs?: number;
}): Promise<TextRunResult> {
  const job = await client.claim(workerId);
  if (!job) return { status: "idle" };
  const stopHeartbeat = startHeartbeat({ job, workerId, client, heartbeatIntervalMs });
  try {
    const payload = parseThreadsTextPayload(job.payload);
    const source = await readSource(payload.representativeUrl).catch((): SourceReadResult => ({
      sourceMode: "url_unavailable",
      fetchStatus: "source_fetch_failed",
      sourceText: null
    }));
    const prompt = buildPrompt({ payload, source, model: generator.model });
    const result = await generator.generate({ prompt, source });
    await client.complete(job.id, { workerId, leaseToken: job.leaseToken, result });
    return { status: "completed", jobId: job.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "text_worker_failed";
    await client.fail(job.id, {
      workerId,
      leaseToken: job.leaseToken,
      error: message,
      retryable: isRetryableTextError(message),
      retryAfterMs: Math.max(1000, retryDelayMs)
    }).catch(() => undefined);
    return { status: "failed", jobId: job.id };
  } finally {
    await stopHeartbeat();
  }
}
