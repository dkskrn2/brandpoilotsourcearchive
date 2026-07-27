import { describe, expect, it, vi } from "vitest";
import {
  BlobAccessError,
  BlobNotFoundError,
  BlobRequestAbortedError,
  BlobServiceNotAvailable,
  BlobServiceRateLimited,
} from "@vercel/blob";
import type {
  AiContentAttachmentDeletionClaim,
  AiContentAttachmentGcRepository,
  AiContentGcDbBudget,
} from "./aiContentAttachmentGcRepository.js";
import {
  classifyAiContentAttachmentDeletionError,
  runAiContentAttachmentGc,
} from "./aiContentAttachmentGc.js";

const claim = (id: number): AiContentAttachmentDeletionClaim => ({
  jobId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  workspaceId: "00000000-0000-4000-8000-000000000100",
  brandId: "00000000-0000-4000-8000-000000000101",
  generationId: "00000000-0000-4000-8000-000000000102",
  attachmentId: null,
  uploadSessionId: null,
  storageUrl: id % 2 ? `https://blob.example/${id}?token=secret` : null,
  storagePath: `attachments/${id}`,
  reason: "retention_expired",
  attemptCount: 0,
  maxAttempts: 10,
  leaseToken: `00000000-0000-4000-9000-${String(id).padStart(12, "0")}`,
  leaseExpiresAt: "2026-07-28T00:00:00.000Z",
});

function repository(overrides: Partial<AiContentAttachmentGcRepository> = {}) {
  let next = 1;
  const base: AiContentAttachmentGcRepository = {
    prepareAiContentAttachmentGc: vi.fn(async () => ({
      sessionsScanned: 2,
      sessionsClaimed: 2,
      sessionsConfirmed: 1,
      sessionsExpired: 1,
      jobsCreated: 2,
      leasesReclaimed: 3,
    })),
    claimAiContentAttachmentDeletionJobs: vi.fn(async ({ batchSize }) =>
      Array.from({ length: batchSize }, () => claim(next++))),
    beginAiContentAttachmentDeletionAttempt: vi.fn(async () => 1),
    releaseUnstartedAiContentAttachmentDeletions: vi.fn(async ({ claims }) => claims.length),
    completeAiContentAttachmentDeletion: vi.fn(async () => true),
    failAiContentAttachmentDeletion: vi.fn(async ({ retryDelaySeconds }) =>
      retryDelaySeconds === null ? "dead_letter" : "retry"),
    getAiContentAttachmentGcMetrics: vi.fn(async () => ({
      eligibleQueueDepth: 7,
      oldestEligiblePendingAgeSeconds: 61,
      heldJobCount: 4,
      oldestHeldAgeSeconds: 120,
      holdReasonCounts: { retry_retention: 4 },
      attemptCountBuckets: { "0": 2, "1-3": 5 },
      deadLetterCount: 1,
    })),
    ...overrides,
  };
  return base;
}

describe("runAiContentAttachmentGc", () => {
  it("uses safe defaults, caps the batch at 100, and returns structured metrics", async () => {
    const repo = repository({
      claimAiContentAttachmentDeletionJobs: vi.fn(async () => []),
    });
    const result = await runAiContentAttachmentGc(repo, {
      workerId: "gc-worker",
      batchSize: 999,
      deleteBlob: vi.fn(),
    });

    expect(repo.prepareAiContentAttachmentGc).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    expect(repo.claimAiContentAttachmentDeletionJobs).toHaveBeenCalledWith(
      expect.objectContaining({ batchSize: 4, leaseSeconds: 90 }),
    );
    expect(result).toEqual(expect.objectContaining({
      sessions: { scanned: 2, claimed: 2, confirmed: 1, expired: 1 },
      deletions: {
        claimed: 0,
        started: 0,
        succeeded: 0,
        failed: 0,
        retried: 0,
        releasedUnstarted: 0,
      },
      leasesReclaimed: 3,
      eligibleQueueDepth: 7,
      deadLetterCount: 1,
      providerErrorCategories: {},
    }));
  });

  it("limits provider calls to 15 seconds and leaves two seconds for cleanup", async () => {
    vi.useFakeTimers();
    try {
      const repo = repository({
        claimAiContentAttachmentDeletionJobs: vi.fn()
          .mockResolvedValueOnce([claim(1)])
          .mockResolvedValue([]),
      });
      const deleteBlob = vi.fn((_target, { abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          abortSignal.addEventListener("abort", () => reject(
            Object.assign(new Error("provider timeout"), { name: "AbortError" }),
          ), { once: true });
        }));
      const run = runAiContentAttachmentGc(repo, {
        workerId: "gc-worker",
        deleteBlob,
        random: () => 0,
      });
      await vi.advanceTimersByTimeAsync(15_001);
      const result = await run;

      expect(deleteBlob).toHaveBeenCalledOnce();
      expect(repo.failAiContentAttachmentDeletion).toHaveBeenCalledWith(
        expect.objectContaining({ errorCategory: "timeout", retryDelaySeconds: 24 }),
      );
      expect(result.durationMs).toBeLessThanOrEqual(45_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries as timeout when the provider ignores abort", async () => {
    vi.useFakeTimers();
    try {
      const repo = repository({
        claimAiContentAttachmentDeletionJobs: vi.fn()
          .mockResolvedValueOnce([claim(1)])
          .mockResolvedValue([]),
      });
      const run = runAiContentAttachmentGc(repo, {
        workerId: "gc-worker",
        deleteBlob: async () => new Promise<void>(() => undefined),
        random: () => 0,
      });
      await vi.advanceTimersByTimeAsync(15_001);
      await run;
      expect(repo.failAiContentAttachmentDeletion).toHaveBeenCalledWith(
        expect.objectContaining({ errorCategory: "timeout", retryDelaySeconds: 24 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not begin provider I/O when a claim is considered at second 44", async () => {
    let now = 0;
    const firstClaim = claim(1);
    const repo = repository({
      prepareAiContentAttachmentGc: vi.fn(async () => {
        return {
          sessionsScanned: 0, sessionsClaimed: 0, sessionsConfirmed: 0,
          sessionsExpired: 0, jobsCreated: 0, leasesReclaimed: 0,
        };
      }),
      claimAiContentAttachmentDeletionJobs: vi.fn(async () => {
        now = 44_000;
        return [firstClaim];
      }),
      getAiContentAttachmentGcMetrics: vi.fn(async () => ({
        eligibleQueueDepth: 0, oldestEligiblePendingAgeSeconds: null,
        heldJobCount: 0, oldestHeldAgeSeconds: null, holdReasonCounts: {},
        attemptCountBuckets: {}, deadLetterCount: 0,
      })),
    });
    const deleteBlob = vi.fn();
    await runAiContentAttachmentGc(repo, {
      workerId: "gc-worker",
      deleteBlob,
      monotonicNow: () => now,
    });

    expect(repo.beginAiContentAttachmentDeletionAttempt).not.toHaveBeenCalled();
    expect(deleteBlob).not.toHaveBeenCalled();
    expect(repo.releaseUnstartedAiContentAttachmentDeletions).toHaveBeenCalledOnce();
  });

  it("claims only free concurrency slots and bulk releases every unstarted lease without attempts", async () => {
    let now = 0;
    const claimed = Array.from({ length: 4 }, (_, index) => claim(index + 1));
    const budgetCalls: AiContentGcDbBudget[] = [];
    const repo = repository({
      prepareAiContentAttachmentGc: vi.fn(async (input) => {
        budgetCalls.push(input);
        return {
          sessionsScanned: 0, sessionsClaimed: 0, sessionsConfirmed: 0,
          sessionsExpired: 0, jobsCreated: 0, leasesReclaimed: 0,
        };
      }),
      claimAiContentAttachmentDeletionJobs: vi.fn(async (input) => {
        budgetCalls.push(input);
        now = 44_000;
        return claimed;
      }),
      releaseUnstartedAiContentAttachmentDeletions: vi.fn(async (input) => {
        budgetCalls.push(input);
        return input.claims.length;
      }),
      getAiContentAttachmentGcMetrics: vi.fn(async (input) => {
        budgetCalls.push(input);
        return {
          eligibleQueueDepth: 4, oldestEligiblePendingAgeSeconds: 1,
          heldJobCount: 0, oldestHeldAgeSeconds: null, holdReasonCounts: {},
          attemptCountBuckets: { "0": 4 }, deadLetterCount: 0,
        };
      }),
    });

    const result = await runAiContentAttachmentGc(repo, {
      workerId: "gc-worker",
      batchSize: 100,
      concurrency: 4,
      deleteBlob: vi.fn(),
      monotonicNow: () => now,
    });

    expect(repo.claimAiContentAttachmentDeletionJobs).toHaveBeenCalledWith(
      expect.objectContaining({ batchSize: 4 }),
    );
    expect(repo.releaseUnstartedAiContentAttachmentDeletions).toHaveBeenCalledWith(
      expect.objectContaining({
        claims: claimed.map(({ jobId, leaseToken }) => ({ jobId, leaseToken })),
      }),
    );
    expect(repo.beginAiContentAttachmentDeletionAttempt).not.toHaveBeenCalled();
    expect(result.deletions.releasedUnstarted).toBe(4);
    expect(budgetCalls.every((call) =>
      call.remainingBudgetMs > 0
      && call.statementTimeoutMs === Math.min(2_000, call.remainingBudgetMs))).toBe(true);
    expect(result.durationMs).toBe(44_000);
  });

  it.each([
    [{ status: 404 }, { kind: "success", category: "not_found" }],
    [{ code: "BlobNotFound" }, { kind: "success", category: "not_found" }],
    [{ status: 403, code: "BlobNotFound" }, { kind: "dead_letter", category: "authorization" }],
    [{ status: 429 }, { kind: "retry", category: "rate_limit" }],
    [{ status: 503 }, { kind: "retry", category: "service" }],
    [{ code: "ECONNRESET" }, { kind: "retry", category: "network" }],
    [{ name: "AbortError" }, { kind: "retry", category: "timeout" }],
    [{ status: 401 }, { kind: "dead_letter", category: "authorization" }],
    [{ statusCode: 403 }, { kind: "dead_letter", category: "authorization" }],
    [{ code: "AccessDenied" }, { kind: "dead_letter", category: "authorization" }],
  ])("classifies provider failure %#", (error, expected) => {
    expect(classifyAiContentAttachmentDeletionError(Object.assign(new Error("provider"), error)))
      .toEqual(expected);
  });

  it.each([
    [new BlobNotFoundError(), { kind: "success", category: "not_found" }],
    [new BlobServiceRateLimited(), { kind: "retry", category: "rate_limit" }],
    [new BlobServiceNotAvailable(), { kind: "retry", category: "service" }],
    [new BlobRequestAbortedError(), { kind: "retry", category: "timeout" }],
    [new BlobAccessError(), { kind: "dead_letter", category: "authorization" }],
    [
      Object.assign(new BlobAccessError(), { code: "BlobNotFound" }),
      { kind: "dead_letter", category: "authorization" },
    ],
  ])("classifies Vercel Blob SDK failure %#", (error, expected) => {
    expect(classifyAiContentAttachmentDeletionError(error)).toEqual(expected);
  });

  it("isolates provider failures and uses storage path when URL is absent", async () => {
    const repo = repository({
      claimAiContentAttachmentDeletionJobs: vi.fn()
        .mockResolvedValueOnce([claim(1), claim(2)])
        .mockResolvedValue([]),
    });
    const deleteBlob = vi.fn(async (target: string) => {
      if (target.includes("/1")) throw Object.assign(new Error("busy"), { status: 503 });
    });
    const result = await runAiContentAttachmentGc(repo, {
      workerId: "gc-worker",
      deleteBlob,
      random: () => 0,
    });

    expect(deleteBlob).toHaveBeenCalledWith("attachments/2", expect.any(Object));
    expect(result.deletions).toEqual(expect.objectContaining({
      started: 2, succeeded: 1, failed: 1, retried: 1,
    }));
    expect(repo.completeAiContentAttachmentDeletion).toHaveBeenCalledOnce();
  });

  it("does not misclassify a finalize database failure as a provider failure", async () => {
    const repo = repository({
      claimAiContentAttachmentDeletionJobs: vi.fn()
        .mockResolvedValueOnce([claim(1), claim(2)])
        .mockResolvedValue([]),
      completeAiContentAttachmentDeletion: vi.fn()
        .mockRejectedValueOnce(new Error("database unavailable"))
        .mockResolvedValueOnce(true),
    });
    const result = await runAiContentAttachmentGc(repo, {
      workerId: "gc-worker",
      deleteBlob: vi.fn(async () => undefined),
    });

    expect(repo.failAiContentAttachmentDeletion).not.toHaveBeenCalled();
    expect(repo.completeAiContentAttachmentDeletion).toHaveBeenCalledTimes(2);
    expect(result.deletions.succeeded).toBe(1);
    expect(result.providerErrorCategories).toEqual({});
  });

  it("does not treat a provider rejection without an Error value as success", async () => {
    const repo = repository({
      claimAiContentAttachmentDeletionJobs: vi.fn()
        .mockResolvedValueOnce([claim(1)])
        .mockResolvedValue([]),
    });
    await runAiContentAttachmentGc(repo, {
      workerId: "gc-worker",
      deleteBlob: async () => Promise.reject(undefined),
    });
    expect(repo.completeAiContentAttachmentDeletion).not.toHaveBeenCalled();
    expect(repo.failAiContentAttachmentDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ errorCategory: "permanent", retryDelaySeconds: null }),
    );
  });

  it("uses the exact capped jittered backoff", async () => {
    const repo = repository({
      claimAiContentAttachmentDeletionJobs: vi.fn()
        .mockResolvedValueOnce([claim(1)])
        .mockResolvedValue([]),
      beginAiContentAttachmentDeletionAttempt: vi.fn(async () => 20),
    });
    await runAiContentAttachmentGc(repo, {
      workerId: "gc-worker",
      deleteBlob: async () => { throw Object.assign(new Error("busy"), { status: 429 }); },
      random: () => 1,
    });
    expect(repo.failAiContentAttachmentDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ retryDelaySeconds: 3_600 }),
    );
  });

  it.each(["null", "throw"] as const)(
    "stops claiming after an unstarted begin returns %s and bulk releases once",
    async (mode) => {
      const firstChunk = Array.from({ length: 4 }, (_, index) => claim(index + 1));
      const repo = repository({
        claimAiContentAttachmentDeletionJobs: vi.fn()
          .mockResolvedValueOnce(firstChunk)
          .mockResolvedValueOnce(Array.from({ length: 4 }, (_, index) => claim(index + 5)))
          .mockResolvedValue([]),
        beginAiContentAttachmentDeletionAttempt: mode === "null"
          ? vi.fn(async () => null)
          : vi.fn(async () => { throw new Error("database unavailable"); }),
      });

      const result = await runAiContentAttachmentGc(repo, {
        workerId: "gc-worker",
        batchSize: 100,
        concurrency: 4,
        deleteBlob: vi.fn(),
      });

      expect(repo.claimAiContentAttachmentDeletionJobs).toHaveBeenCalledOnce();
      expect(repo.beginAiContentAttachmentDeletionAttempt).toHaveBeenCalledTimes(4);
      expect(repo.releaseUnstartedAiContentAttachmentDeletions).toHaveBeenCalledOnce();
      expect(repo.releaseUnstartedAiContentAttachmentDeletions).toHaveBeenCalledWith(
        expect.objectContaining({
          claims: firstChunk.map(({ jobId, leaseToken }) => ({ jobId, leaseToken })),
        }),
      );
      expect(result.deletions.claimed).toBe(4);
      expect(result.deletions.releasedUnstarted).toBe(4);
    },
  );

  it("returns by 45 seconds when the single bulk release hangs and observes its late rejection", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    let rejectRelease!: (error: unknown) => void;
    const hungRelease = new Promise<number>((_resolve, reject) => {
      rejectRelease = reject;
    });
    try {
      const firstChunk = Array.from({ length: 4 }, (_, index) => claim(index + 1));
      const repo = repository({
        claimAiContentAttachmentDeletionJobs: vi.fn(async () => {
          vi.setSystemTime(44_000);
          return firstChunk;
        }),
        beginAiContentAttachmentDeletionAttempt: vi.fn(async () => null),
        releaseUnstartedAiContentAttachmentDeletions: vi.fn(async () => hungRelease),
      });

      const run = runAiContentAttachmentGc(repo, {
        workerId: "gc-worker",
        batchSize: 100,
        concurrency: 4,
        deleteBlob: vi.fn(),
        monotonicNow: () => Date.now(),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(repo.releaseUnstartedAiContentAttachmentDeletions).toHaveBeenCalledOnce();
      expect(repo.beginAiContentAttachmentDeletionAttempt).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_001);
      const result = await run;
      expect(result.durationMs).toBe(45_000);
      expect(result.deletions.releasedUnstarted).toBe(0);

      rejectRelease(new Error("late release failure token=secret"));
      await Promise.resolve();
      await Promise.resolve();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      vi.useRealTimers();
    }
  });

  it("reports actual monotonic elapsed time instead of clamping the duration metric", async () => {
    let now = 0;
    const repo = repository({
      prepareAiContentAttachmentGc: vi.fn(async () => {
        now = 50_250;
        return {
          sessionsScanned: 0, sessionsClaimed: 0, sessionsConfirmed: 0,
          sessionsExpired: 0, jobsCreated: 0, leasesReclaimed: 0,
        };
      }),
    });
    const result = await runAiContentAttachmentGc(repo, {
      workerId: "gc-worker",
      deleteBlob: vi.fn(),
      monotonicNow: () => now,
    });
    expect(result.durationMs).toBe(50_250);
  });
});
