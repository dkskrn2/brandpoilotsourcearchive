import {
  BlobAccessError,
  BlobNotFoundError,
  BlobRequestAbortedError,
  BlobServiceNotAvailable,
  BlobServiceRateLimited,
} from "@vercel/blob";
import {
  redactAiContentAttachmentGcError,
  type AiContentAttachmentDeletionClaim,
  type AiContentAttachmentGcRepository,
  type AiContentGcDbBudget,
} from "./aiContentAttachmentGcRepository.js";

export type DeleteAiContentAttachmentBlob = (
  urlOrPath: string,
  options: { abortSignal: AbortSignal },
) => Promise<void>;

export interface AiContentAttachmentGcRunResult {
  sessions: {
    scanned: number;
    claimed: number;
    confirmed: number;
    expired: number;
  };
  deletions: {
    claimed: number;
    started: number;
    succeeded: number;
    failed: number;
    retried: number;
    releasedUnstarted: number;
  };
  leasesReclaimed: number;
  eligibleQueueDepth: number;
  oldestEligiblePendingAgeSeconds: number | null;
  heldJobCount: number;
  oldestHeldAgeSeconds: number | null;
  holdReasonCounts: Record<string, number>;
  attemptCountBuckets: Record<string, number>;
  deadLetterCount: number;
  durationMs: number;
  providerErrorCategories: Record<string, number>;
}

interface RunOptions {
  workerId: string;
  batchSize?: number;
  leaseSeconds?: number;
  concurrency?: number;
  providerTimeoutMs?: number;
  budgetMs?: number;
  cleanupReserveMs?: number;
  dbStatementTimeoutMaxMs?: number;
  deleteBlob: DeleteAiContentAttachmentBlob;
  random?: () => number;
  monotonicNow?: () => number;
}

type ProviderDisposition = {
  kind: "success" | "retry" | "dead_letter";
  category: string;
};

function providerStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const source = error as { status?: unknown; statusCode?: unknown };
  const value = source.status ?? source.statusCode;
  return typeof value === "number" ? value : undefined;
}

function providerCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const source = error as { code?: unknown; name?: unknown; message?: unknown };
  return `${String(source.code ?? "")} ${String(source.name ?? "")} ${String(source.message ?? "")}`
    .toLowerCase();
}

export function classifyAiContentAttachmentDeletionError(error: unknown): ProviderDisposition {
  const status = providerStatus(error);
  const code = providerCode(error);
  if (
    error instanceof BlobNotFoundError
    || status === 404
    || code.includes("blobnotfound")
    || code.includes("not_found")
  ) {
    return { kind: "success", category: "not_found" };
  }
  if (
    error instanceof BlobAccessError
    || status === 401
    || status === 403
    || /access.?denied|unauthori|forbidden/.test(code)
  ) {
    return { kind: "dead_letter", category: "authorization" };
  }
  if (error instanceof BlobServiceRateLimited || status === 429) {
    return { kind: "retry", category: "rate_limit" };
  }
  if (error instanceof BlobServiceNotAvailable || (status !== undefined && status >= 500)) {
    return { kind: "retry", category: "service" };
  }
  if (error instanceof BlobRequestAbortedError || /abort|timeout|timedout/.test(code)) {
    return { kind: "retry", category: "timeout" };
  }
  if (/econn|enet|eai_again|socket|network|fetch/.test(code)) {
    return { kind: "retry", category: "network" };
  }
  return { kind: "dead_letter", category: "permanent" };
}

function positiveInteger(value: number | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value)));
}

function timeoutPromise<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  if (timeoutMs <= 0) return Promise.reject(new Error(code));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
    void promise.catch(() => undefined);
  });
}

export async function runAiContentAttachmentGc(
  repository: AiContentAttachmentGcRepository,
  options: RunOptions,
): Promise<AiContentAttachmentGcRunResult> {
  const now = options.monotonicNow ?? (() => performance.now());
  const random = options.random ?? Math.random;
  const batchSize = positiveInteger(options.batchSize, 25, 100);
  const leaseSeconds = positiveInteger(options.leaseSeconds, 90, 15 * 60);
  const concurrency = positiveInteger(options.concurrency, 4, 100);
  const providerTimeoutMs = positiveInteger(options.providerTimeoutMs, 15_000, 15_000);
  const budgetMs = positiveInteger(options.budgetMs, 45_000, 45_000);
  const cleanupReserveMs = positiveInteger(options.cleanupReserveMs, 2_000, budgetMs);
  const dbStatementTimeoutMaxMs = positiveInteger(
    options.dbStatementTimeoutMaxMs,
    2_000,
    budgetMs,
  );
  const startedAt = now();
  const deadline = startedAt + budgetMs;
  const remaining = () => Math.max(0, deadline - now());
  const dbBudget = (): AiContentGcDbBudget => {
    const remainingBudgetMs = remaining();
    return {
      remainingBudgetMs,
      statementTimeoutMs: Math.min(dbStatementTimeoutMaxMs, remainingBudgetMs),
    };
  };
  const dbCall = <T>(operation: (budget: AiContentGcDbBudget) => Promise<T>) => {
    const budget = dbBudget();
    return timeoutPromise(operation(budget), budget.remainingBudgetMs, "ai_content_gc_budget_exhausted");
  };

  const result: AiContentAttachmentGcRunResult = {
    sessions: { scanned: 0, claimed: 0, confirmed: 0, expired: 0 },
    deletions: {
      claimed: 0,
      started: 0,
      succeeded: 0,
      failed: 0,
      retried: 0,
      releasedUnstarted: 0,
    },
    leasesReclaimed: 0,
    eligibleQueueDepth: 0,
    oldestEligiblePendingAgeSeconds: null,
    heldJobCount: 0,
    oldestHeldAgeSeconds: null,
    holdReasonCounts: {},
    attemptCountBuckets: {},
    deadLetterCount: 0,
    durationMs: 0,
    providerErrorCategories: {},
  };
  const unstarted = new Map<string, AiContentAttachmentDeletionClaim>();

  const preparation = await dbCall((budget) =>
    repository.prepareAiContentAttachmentGc({ limit: batchSize, ...budget }));
  result.sessions = {
    scanned: preparation.sessionsScanned,
    claimed: preparation.sessionsClaimed,
    confirmed: preparation.sessionsConfirmed,
    expired: preparation.sessionsExpired,
  };
  result.leasesReclaimed = preparation.leasesReclaimed;

  const processClaim = async (current: AiContentAttachmentDeletionClaim) => {
    unstarted.set(current.jobId, current);
    if (remaining() <= cleanupReserveMs + dbStatementTimeoutMaxMs) return;
    let attemptCount: number | null;
    try {
      attemptCount = await dbCall((budget) =>
        repository.beginAiContentAttachmentDeletionAttempt({
          jobId: current.jobId,
          leaseToken: current.leaseToken,
          ...budget,
        }));
    } catch {
      return;
    }
    if (attemptCount === null) return;
    unstarted.delete(current.jobId);
    result.deletions.started += 1;

    const providerBudget = Math.min(providerTimeoutMs, remaining() - cleanupReserveMs);
    if (providerBudget <= 0) {
      const disposition = await dbCall((budget) =>
        repository.failAiContentAttachmentDeletion({
          jobId: current.jobId,
          leaseToken: current.leaseToken,
          errorCategory: "timeout",
          errorMessage: "provider call budget exhausted",
          retryDelaySeconds: Math.min(
            3_600,
            Math.ceil(30 * 2 ** (attemptCount - 1) * (0.8 + random() * 0.4)),
          ),
          ...budget,
        }));
      result.deletions.failed += 1;
      if (disposition === "retry") result.deletions.retried += 1;
      return;
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let providerError: unknown;
    let providerFailed = false;
    try {
      timer = setTimeout(() => controller.abort(), providerBudget);
      await timeoutPromise(
        options.deleteBlob(current.storageUrl ?? current.storagePath, {
          abortSignal: controller.signal,
        }),
        providerBudget,
        "ai_content_gc_provider_timeout",
      );
    } catch (error) {
      providerFailed = true;
      providerError = error;
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (remaining() <= 0) return;
    if (!providerFailed) {
      const completed = await dbCall((budget) =>
        repository.completeAiContentAttachmentDeletion({
          jobId: current.jobId,
          leaseToken: current.leaseToken,
          outcome: "deleted",
          ...budget,
        }));
      if (completed) result.deletions.succeeded += 1;
      return;
    }

    const classification = classifyAiContentAttachmentDeletionError(providerError);
    result.providerErrorCategories[classification.category] =
      (result.providerErrorCategories[classification.category] ?? 0) + 1;
    if (classification.kind === "success") {
      const completed = await dbCall((budget) =>
        repository.completeAiContentAttachmentDeletion({
          jobId: current.jobId,
          leaseToken: current.leaseToken,
          outcome: "not_found",
          ...budget,
        }));
      if (completed) result.deletions.succeeded += 1;
      return;
    }
    result.deletions.failed += 1;
    const retryDelaySeconds = classification.kind === "retry"
      ? Math.min(
        3_600,
        Math.ceil(30 * 2 ** (attemptCount - 1) * (0.8 + random() * 0.4)),
      )
      : null;
    const disposition = await dbCall((budget) =>
      repository.failAiContentAttachmentDeletion({
        jobId: current.jobId,
        leaseToken: current.leaseToken,
        errorCategory: classification.category,
        errorMessage: redactAiContentAttachmentGcError(providerError),
        retryDelaySeconds,
        ...budget,
      }));
    if (disposition === "retry") result.deletions.retried += 1;
  };

  while (
    result.deletions.claimed < batchSize
    && remaining() > cleanupReserveMs + dbStatementTimeoutMaxMs
  ) {
    const claimSize = Math.min(concurrency, batchSize - result.deletions.claimed);
    const claims = await dbCall((budget) =>
      repository.claimAiContentAttachmentDeletionJobs({
        workerId: options.workerId,
        batchSize: claimSize,
        leaseSeconds,
        ...budget,
      }));
    if (claims.length === 0) break;
    result.deletions.claimed += claims.length;
    await Promise.all(claims.map((current) => processClaim(current).catch(() => undefined)));
  }

  if (unstarted.size > 0 && remaining() > 0) {
    try {
      result.deletions.releasedUnstarted = await dbCall((budget) =>
        repository.releaseUnstartedAiContentAttachmentDeletions({
          claims: [...unstarted.values()].map(({ jobId, leaseToken }) => ({ jobId, leaseToken })),
          ...budget,
        }));
    } catch {
      // Lease expiry is the durable fallback when the bounded cleanup call cannot finish.
    }
  }

  if (remaining() > 0) {
    try {
      const metrics = await dbCall((budget) =>
        repository.getAiContentAttachmentGcMetrics(budget));
      Object.assign(result, metrics);
    } catch {
      // Returning by the absolute runner deadline is more important than optional queue health.
    }
  }
  result.durationMs = Math.min(budgetMs, Math.max(0, now() - startedAt));
  return result;
}
