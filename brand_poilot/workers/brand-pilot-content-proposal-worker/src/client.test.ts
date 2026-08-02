import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  ContentProposalApiError,
  createContentProposalApiClient,
} from "./client.js";
import { parseContentProposalJob } from "./contracts.js";

const rawJob = {
  id: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000002",
  brandId: "30000000-0000-4000-8000-000000000003",
  batchId: "40000000-0000-4000-8000-000000000004",
  status: "processing",
  request: {
    contractVersion: "content-proposal-request.v1",
    contentFamily: "informational",
    subjectInput: { topic: "운영" },
    channelTargets: ["blog_export"],
    outputFormats: ["blog"],
    sourceSnapshotIds: [],
    performanceSnapshotIds: [],
    performanceEvidence: [],
  },
  sourceSnapshots: [],
  attemptCount: 1,
  maxAttempts: 3,
  workerId: "proposal-worker-1",
  leaseToken: "50000000-0000-4000-8000-000000000005",
  leaseExpiresAt: "2026-07-28T00:03:00.000Z",
  availableAt: "2026-07-28T00:00:00.000Z",
};
const job = parseContentProposalJob(rawJob);
const proposals = [{
  contractVersion: "content-proposal.v1" as const,
  title: "A",
  reasonToCreateNow: "now",
  contentFamily: "informational" as const,
  topic: "운영",
  target: {},
  messageStrategy: "how_to" as const,
  hook: "hook",
  keyMessage: "message",
  evidence: [],
  outline: [{ heading: "h", purpose: "p" }],
  outputFormat: "blog" as const,
  channelTargets: ["blog_export" as const],
  recommendedReferenceQuery: {
    strategies: ["how_to" as const],
    formats: ["blog" as const],
    tags: [],
  },
}, {
  contractVersion: "content-proposal.v1" as const,
  title: "B",
  reasonToCreateNow: "now",
  contentFamily: "informational" as const,
  topic: "운영 2",
  target: {},
  messageStrategy: "insight" as const,
  hook: "hook 2",
  keyMessage: "message 2",
  evidence: [],
  outline: [{ heading: "h", purpose: "p" }],
  outputFormat: "blog" as const,
  channelTargets: ["blog_export" as const],
  recommendedReferenceQuery: {
    strategies: ["insight" as const],
    formats: ["blog" as const],
    tags: [],
  },
}];

describe("content proposal clients", () => {
  it("uses only dedicated worker endpoints and bearer token", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/claim")) return new Response(JSON.stringify({ job: rawJob }), { status: 200 });
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const client = createContentProposalApiClient(
      "https://api.example/",
      "proposal-token",
      fetchImpl,
    );

    await expect(client.claim("proposal-worker-1", 180)).resolves.toEqual(job);
    await client.heartbeatWorker("content-proposal-worker-1");
    await client.heartbeat(job, 180);
    await client.complete(job, proposals);
    await client.fail(job, { errorCode: "model_timeout", errorMessage: "timeout", retryable: true });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.example/worker/content-proposal-jobs/claim",
      "https://api.example/worker/content-proposal-jobs/heartbeat",
      `https://api.example/worker/content-proposal-jobs/${job.id}/heartbeat`,
      `https://api.example/worker/content-proposal-jobs/${job.id}/complete`,
      `https://api.example/worker/content-proposal-jobs/${job.id}/fail`,
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({ authorization: "Bearer proposal-token" });
    }
  });

  it("completes V2 research with the exact lease body and parses the composed snapshot", async () => {
    const evidence = {
      contractVersion: "research-evidence.v1" as const,
      decision: "not_needed" as const,
      reason: "시장 맥락 보충이 필요하지 않음",
      queries: [],
      capturedAt: "2026-08-01T04:00:00.000Z",
      items: [],
    };
    const composed = {
      contractVersion: "proposal-input.v2",
      brandCore: {
        versionId: "40000000-0000-4000-8000-000000000004",
        companyOverview: "개요", businessDescription: "사업", primaryCategory: "교육",
        detailedCategory: "온라인", primaryTarget: "창업자", differentiator: "실전",
        coreAppeal: "적용",
      },
      subject: { kind: "topic_text", title: "캠페인" },
      contentInstruction: null,
      product: {
        id: "60000000-0000-4000-8000-000000000006",
        versionId: "61000000-0000-4000-8000-000000000006",
        kind: "service", name: "컨설팅", description: "설명", features: ["진단"],
        benefits: ["정리"], cautions: ["결과는 상황별 상이"], evergreenPurchaseInfo: "문의",
        images: [],
      },
      references: [], researchEvidence: evidence,
      outputSettings: {
        outputFormat: "marketing_content", channelTargets: ["instagram"],
        aspectRatio: "4:5", outputCount: 1, purpose: "marketing",
      },
      capturedAt: "2026-08-01T03:00:00.000Z",
    };
    const rawV2Job = {
      ...rawJob,
      request: {
        contractVersion: "content-proposal-request.v2", purpose: "marketing",
        outputFormat: "marketing_content", channelTargets: ["instagram"],
        requestFingerprint: "fingerprint",
      },
      inputSnapshot: { ...composed, contractVersion: "proposal-base-input.v2", researchEvidence: undefined },
    };
    const v2Job = parseContentProposalJob(JSON.parse(JSON.stringify(rawV2Job)));
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/research-complete")) {
        return new Response(JSON.stringify(composed), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    });
    const client = createContentProposalApiClient(
      "https://api.example", "token", fetchMock as unknown as typeof fetch,
    );

    await expect(client.completeResearch(v2Job, evidence)).resolves.toEqual(composed);
    await client.complete(v2Job, {
      contractVersion: "content-proposal.v2",
      proposals: [],
    } as never);

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `https://api.example/worker/content-proposal-jobs/${v2Job.id}/research-complete`,
      `https://api.example/worker/content-proposal-jobs/${v2Job.id}/complete`,
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      workerId: v2Job.workerId,
      leaseToken: v2Job.leaseToken,
      evidence,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      workerId: v2Job.workerId,
      leaseToken: v2Job.leaseToken,
      proposalSet: { contractVersion: "content-proposal.v2", proposals: [] },
    });
  });

  it("marks lease loss terminal while keeping timeout and 5xx retryable", async () => {
    const leaseClient = createContentProposalApiClient(
      "https://api.example",
      "token",
      vi.fn(async () => new Response(
        JSON.stringify({ error: "content_proposal_job_lease_invalid" }),
        { status: 409 },
      )) as unknown as typeof fetch,
    );
    const timeoutClient = createContentProposalApiClient(
      "https://api.example",
      "token",
      vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }) as unknown as typeof fetch,
      1,
    );
    await expect(leaseClient.heartbeat(job, 180)).rejects.toMatchObject({
      leaseLost: true,
      retryable: false,
    });
    await expect(timeoutClient.claim("worker", 180)).rejects.toMatchObject({
      retryable: true,
    });
  });

  it("keeps the API client while startup uses only Codex CLI model configuration", async () => {
    const [clientSource, mainSource] = await Promise.all([
      readFile(new URL("./client.ts", import.meta.url), "utf8"),
      readFile(new URL("./main.ts", import.meta.url), "utf8"),
    ]);

    expect(clientSource).not.toContain("api.openai.com");
    expect(clientSource).not.toContain("createOpenAiContentProposalModel");
    expect(mainSource).not.toContain("OPENAI_API_KEY");
    expect(mainSource).toContain("createCodexContentProposalModel");
    expect(mainSource).toContain("CONTENT_PROPOSAL_CODEX_COMMAND");
    expect(mainSource).toContain("CONTENT_PROPOSAL_CODEX_MODEL");
    expect(mainSource).toContain("CONTENT_PROPOSAL_CODEX_TIMEOUT_MS");
  });
});
