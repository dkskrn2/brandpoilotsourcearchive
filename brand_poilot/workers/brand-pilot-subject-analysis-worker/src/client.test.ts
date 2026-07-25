import { describe, expect, it, vi } from "vitest";
import { createClient, SubjectAnalysisApiError } from "./client.js";
import type { SubjectAnalysisJobV2, SubjectAnalysisResultV2, SubjectAppealJobV2, SubjectAppealResultV2 } from "./contracts.js";

describe("subject analysis API client", () => {
  it("adds a timeout signal to every worker request", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ job: null }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = createClient("https://api.example.com", "token", fetchImpl as typeof fetch);
    await client.claim("worker-1", 900);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled API request and marks it retryable", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    const client = createClient("https://api.example.com", "token", fetchImpl as typeof fetch, 5);
    await expect(client.claim("worker-1", 900)).rejects.toMatchObject({ retryable: true, status: 503 } satisfies Partial<SubjectAnalysisApiError>);
  });

  it("allows a page extraction request to run longer than fifteen seconds by default", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response(JSON.stringify({ job: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })), 20_000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }));
      const client = createClient("https://api.example.com", "token", fetchImpl as typeof fetch);
      const request = client.claim("worker-1", 900);

      await vi.advanceTimersByTimeAsync(20_000);

      await expect(request).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends phase-compatible analysis and appeal results unchanged", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(null, { status: 204 });
    });
    const client = createClient("https://api.example.com", "token", fetchImpl as typeof fetch);
    const identity = {
      analysisId: "analysis-v2",
      workerId: "worker-1",
      leaseToken: "lease-v2",
      leaseExpiresAt: "2026-07-22T00:03:00.000Z",
      contractVersion: "subject-analysis.v2" as const,
      brandContext: {},
      subject: {
        type: "product" as const,
        sourceUrl: "https://example.com/product",
        attachmentIds: [],
        manualInput: { name: "제품", promotionOrTerms: "", description: "설명" },
      },
      sourcePriority: ["manual_input", "attachments", "source_url", "brand_context", "public_research"] as SubjectAnalysisJobV2["sourcePriority"],
    };
    const analysisResult = {
      contractVersion: "subject-analysis-result.v2",
      phase: "analysis",
      subjectType: "product",
    } as SubjectAnalysisResultV2;
    const analysisJob = {
      ...identity,
      phase: "analysis",
      extracted: { documents: [], images: [], sourcePage: null, sourceGaps: [] },
    } as SubjectAnalysisJobV2;
    const appealResult = {
      contractVersion: "subject-appeal-result.v2",
      phase: "appeal",
      targets: [],
      appealsByTarget: {},
    } as unknown as SubjectAppealResultV2;
    const appealJob = {
      ...identity,
      phase: "appeal",
      analysisResult,
    } as SubjectAppealJobV2;

    await client.complete(analysisJob, analysisResult, 900);
    await client.complete(appealJob, appealResult, 900);

    expect(requests.map(({ result }) => result)).toEqual([analysisResult, appealResult]);
  });

  it("rejects a phase-incompatible completion before making a request", async () => {
    const fetchImpl = vi.fn();
    const client = createClient("https://api.example.com", "token", fetchImpl as typeof fetch);
    const appealJob = {
      analysisId: "analysis-v2",
      workerId: "worker-1",
      leaseToken: "lease-v2",
      leaseExpiresAt: "2026-07-22T00:03:00.000Z",
      contractVersion: "subject-analysis.v2",
      phase: "appeal",
      brandContext: {},
      subject: {
        type: "product",
        sourceUrl: "https://example.com/product",
        attachmentIds: [],
        manualInput: { name: "제품", promotionOrTerms: "", description: "설명" },
      },
      analysisResult: {},
      sourcePriority: ["manual_input", "attachments", "source_url", "brand_context", "public_research"],
    } as unknown as SubjectAppealJobV2;
    const wrongResult = {
      contractVersion: "subject-analysis-result.v2",
      phase: "analysis",
    } as SubjectAnalysisResultV2;

    await expect(client.complete(appealJob, wrongResult, 900)).rejects.toThrow("subject_analysis_completion_phase_mismatch");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
