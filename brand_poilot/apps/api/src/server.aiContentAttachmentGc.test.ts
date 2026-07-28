import { describe, expect, it, vi } from "vitest";
import {
  createServer,
  parseAiContentAttachmentGcRequestBody,
} from "./httpServer.js";
import type { AiContentAttachmentGcRunResult } from "./aiContentAttachmentGc.js";

const result: AiContentAttachmentGcRunResult = {
  sessions: { scanned: 1, claimed: 1, confirmed: 0, expired: 1 },
  deletions: { claimed: 1, started: 1, succeeded: 1, failed: 0, retried: 0, releasedUnstarted: 0 },
  leasesReclaimed: 0,
  eligibleQueueDepth: 0,
  oldestEligiblePendingAgeSeconds: null,
  heldJobCount: 0,
  oldestHeldAgeSeconds: null,
  holdReasonCounts: {},
  attemptCountBuckets: { "0": 1 },
  deadLetterCount: 0,
  durationMs: 12,
  providerErrorCategories: {},
};

function gcRepository(includeUploadLifecycle = false) {
  const value: Record<string, unknown> = {
    prepareAiContentAttachmentGc: vi.fn(),
    claimAiContentAttachmentDeletionJobs: vi.fn(),
    beginAiContentAttachmentDeletionAttempt: vi.fn(),
    releaseUnstartedAiContentAttachmentDeletions: vi.fn(),
    completeAiContentAttachmentDeletion: vi.fn(),
    failAiContentAttachmentDeletion: vi.fn(),
    getAiContentAttachmentGcMetrics: vi.fn(),
  };
  if (includeUploadLifecycle) {
    Object.assign(value, {
      assertAiContentAttachmentUploadMutable: vi.fn(),
      createAiContentUploadSession: vi.fn(),
      failAiContentUploadSession: vi.fn(),
      confirmAiContentUploadSession: vi.fn(),
      cancelAiContentUploadSession: vi.fn(),
      confirmLegacyAiContentAttachment: vi.fn(),
    });
  }
  return value as never;
}

describe("POST /internal/cron/ai-content-attachment-gc", () => {
  it("accepts only undefined or an exact plain-object body", () => {
    expect(parseAiContentAttachmentGcRequestBody(undefined)).toEqual({ batchSize: 25 });
    expect(parseAiContentAttachmentGcRequestBody({})).toEqual({ batchSize: 25 });
    expect(parseAiContentAttachmentGcRequestBody({ batchSize: 100 })).toEqual({ batchSize: 100 });
    expect(() => parseAiContentAttachmentGcRequestBody({ batchSize: undefined }))
      .toThrow("ai_content_attachment_gc_batch_size_invalid");

    class RequestBody {
      batchSize = 25;
    }
    const nullPrototype = Object.assign(Object.create(null) as object, { batchSize: 25 });
    const inherited = Object.create({ batchSize: 25 }) as object;
    for (const body of [
      null,
      [],
      "body",
      25,
      new RequestBody(),
      nullPrototype,
      inherited,
      { batch_size: 25 },
      { batchSize: 25, token: "body-secret" },
    ]) {
      expect(() => parseAiContentAttachmentGcRequestBody(body))
        .toThrow("ai_content_attachment_gc_request_body_invalid");
    }
  });

  it("uses constant-time bearer auth and does not expose the secret", async () => {
    const runGc = vi.fn(async () => result);
    const app = createServer({
      repository: gcRepository(),
      cronSecret: "cron-top-secret",
      aiContentAttachmentGc: { deleteBlob: vi.fn(), runGc },
      logger: false,
    });
    const malformed = await app.inject({
      method: "POST",
      url: "/internal/cron/ai-content-attachment-gc",
      headers: { authorization: "Bearer short" },
    });
    const valid = await app.inject({
      method: "POST",
      url: "/internal/cron/ai-content-attachment-gc",
      headers: { authorization: "Bearer cron-top-secret" },
    });
    expect(malformed.statusCode).toBe(401);
    expect(malformed.body).not.toContain("cron-top-secret");
    expect(valid.statusCode).toBe(200);
    expect(runGc).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects missing dependencies and invalid batch sizes", async () => {
    const withoutDependency = createServer({
      repository: {} as never,
      cronSecret: "secret",
      logger: false,
    });
    const missing = await withoutDependency.inject({
      method: "POST",
      url: "/internal/cron/ai-content-attachment-gc",
      headers: { authorization: "Bearer secret" },
    });
    expect(missing.statusCode).toBe(503);
    expect(missing.json()).toEqual({ error: "ai_content_attachment_gc_not_configured" });
    await withoutDependency.close();

    const runGc = vi.fn(async () => result);
    const app = createServer({
      repository: gcRepository(),
      cronSecret: "secret",
      aiContentAttachmentGc: { deleteBlob: vi.fn(), runGc },
      logger: false,
    });
    for (const body of [{ batchSize: 0 }, { batchSize: 101 }, { batchSize: 1.5 }, { batchSize: "25" }]) {
      const response = await app.inject({
        method: "POST",
        url: "/internal/cron/ai-content-attachment-gc",
        headers: { authorization: "Bearer secret" },
        payload: body,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "ai_content_attachment_gc_batch_size_invalid" });
    }
    expect(runGc).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects non-object and unknown-key bodies without calling or leaking to the runner", async () => {
    const runGc = vi.fn(async () => result);
    const logLines: string[] = [];
    const app = createServer({
      repository: gcRepository(),
      cronSecret: "secret",
      aiContentAttachmentGc: { deleteBlob: vi.fn(), runGc },
      logger: {
        level: "info",
        stream: { write: (line: string) => logLines.push(line) },
      },
    });
    for (const input of [
      { payload: "null", json: true },
      { payload: [], json: false },
      { payload: "\"body-secret\"", json: true },
      { payload: "25", json: true },
      { payload: { batch_size: 25 }, json: false },
      { payload: { batchSize: 25, token: "body-secret" }, json: false },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/internal/cron/ai-content-attachment-gc",
        headers: {
          authorization: "Bearer secret",
          ...(input.json ? { "content-type": "application/json" } : {}),
        },
        payload: input.payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "ai_content_attachment_gc_request_body_invalid",
      });
      expect(response.body).not.toContain("body-secret");
    }
    expect(runGc).not.toHaveBeenCalled();
    expect(logLines.join("\n")).not.toContain("body-secret");
    await app.close();
  });

  it("defaults batch size to 25, returns the safe result, and is flag-independent", async () => {
    const runGc = vi.fn(async () => result);
    const app = createServer({
      repository: gcRepository(true),
      cronSecret: "secret",
      aiContentUpload: { readWriteToken: "", uploadSessionsEnabled: false },
      aiContentAttachmentGc: { deleteBlob: vi.fn(), workerId: "cron-worker", runGc },
      logger: false,
    });
    const response = await app.inject({
      method: "POST",
      url: "/internal/cron/ai-content-attachment-gc",
      headers: { authorization: "Bearer secret" },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(runGc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ batchSize: 25, workerId: "cron-worker" }),
    );
    await app.close();
  });

  it("drops unexpected provider credentials and storage metadata from the response", async () => {
    const runGc = vi.fn(async () => ({
      ...result,
      nonce: "nonce-secret",
      token: "blob-secret",
      storageUrl: "https://blob.example/file?token=query-secret",
      userMetadata: { email: "private@example.com" },
    }) as AiContentAttachmentGcRunResult);
    const app = createServer({
      repository: gcRepository(),
      cronSecret: "secret",
      aiContentAttachmentGc: { deleteBlob: vi.fn(), runGc },
      logger: false,
    });
    const response = await app.inject({
      method: "POST",
      url: "/internal/cron/ai-content-attachment-gc",
      headers: { authorization: "Bearer secret" },
      payload: {},
    });
    expect(response.json()).toEqual(result);
    expect(response.body).not.toContain("secret");
    expect(response.body).not.toContain("storageUrl");
    expect(response.body).not.toContain("userMetadata");
    await app.close();
  });
});
