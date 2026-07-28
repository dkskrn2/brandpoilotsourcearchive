import { describe, expect, it, vi } from "vitest";
import {
  ContentProposalApiError,
  createContentProposalApiClient,
  createOpenAiContentProposalModel,
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

  it("requests strict 2-3 proposal JSON and extracts the model response", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      output: [{ content: [{ type: "output_text", text: JSON.stringify(proposals) }] }],
    }), { status: 200 }));
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const model = createOpenAiContentProposalModel("openai-key", "proposal-model", fetchImpl);

    await expect(model.generate("frozen prompt")).resolves.toEqual(proposals);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer openai-key" }),
      }),
    );
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body).toMatchObject({
      model: "proposal-model",
      input: "frozen prompt",
      text: { format: { type: "json_schema", strict: false } },
    });
    expect(body.text.format.schema).toMatchObject({ type: "array", minItems: 2, maxItems: 3 });
  });
});
