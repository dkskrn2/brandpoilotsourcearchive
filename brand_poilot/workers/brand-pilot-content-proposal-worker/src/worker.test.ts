import { describe, expect, it, vi } from "vitest";
import { ContentProposalApiError, type ContentProposalModelClient } from "./client.js";
import {
  ContentProposalContractError,
  parseContentProposalJob,
  type ContentProposalV1,
  type ContentProposalJobV2,
  type ContentProposalSetV2,
  type ContentProposalWorkerClient,
} from "./contracts.js";
import {
  createContentProposalRunner,
  processContentProposalJob,
  runContentProposalOnce,
  runContentProposalWatchIteration,
  type ContentProposalRunner,
} from "./worker.js";

const job = parseContentProposalJob({
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
});

function proposal(title: string, strategy: "how_to" | "insight"): ContentProposalV1 {
  return {
    contractVersion: "content-proposal.v1",
    title,
    reasonToCreateNow: "최근 근거가 확보됨",
    contentFamily: "informational",
    topic: title,
    target: {},
    messageStrategy: strategy,
    hook: `${title} hook`,
    keyMessage: `${title} message`,
    evidence: [],
    outline: [{ heading: "점검", purpose: "실행 안내" }],
    outputFormat: "blog",
    channelTargets: ["blog_export"],
    recommendedReferenceQuery: { strategies: [strategy], formats: ["blog"], tags: [] },
  };
}
const validResult = [proposal("A", "how_to"), proposal("B", "insight")];

function api(overrides: Partial<ContentProposalWorkerClient> = {}): ContentProposalWorkerClient {
  return {
    heartbeatWorker: vi.fn(async () => undefined),
    claim: vi.fn(async () => job),
    heartbeat: vi.fn(async () => undefined),
    completeResearch: vi.fn(async () => { throw new Error("unexpected_v2_research"); }),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("content proposal worker", () => {
  it("builds the frozen prompt, strictly parses all proposals, and completes once", async () => {
    const model: ContentProposalModelClient = { generate: vi.fn(async () => validResult) };
    const client = api();
    const runner = createContentProposalRunner(model);

    await expect(processContentProposalJob({
      client, runner, job, leaseSeconds: 180, heartbeatMs: 100_000,
    })).resolves.toEqual({ status: "completed", jobId: job.id });
    expect(model.generate).toHaveBeenCalledWith(
      expect.stringContaining("<trusted_frozen_request>"),
      expect.any(AbortSignal),
    );
    expect(client.complete).toHaveBeenCalledTimes(1);
    expect(client.complete).toHaveBeenCalledWith(job, validResult);
  });

  it("fails the whole job without completing when any proposal is invalid", async () => {
    const client = api();
    const runner = createContentProposalRunner({
      generate: vi.fn(async () => [validResult[0], { ...validResult[1], outputFormat: "card_news" }]),
    });

    await expect(processContentProposalJob({
      client, runner, job, leaseSeconds: 180, heartbeatMs: 100_000,
    })).resolves.toEqual({ status: "failed", jobId: job.id });
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith(job, expect.objectContaining({
      errorCode: "content_proposal_result_invalid",
      retryable: false,
    }));
  });

  it("heartbeats during model work and stops without completion after lease loss", async () => {
    let rejectModel: ((error: Error) => void) | undefined;
    const model: ContentProposalModelClient = {
      generate: vi.fn((_prompt: string, signal?: AbortSignal) => new Promise((_resolve, reject) => {
        rejectModel = reject;
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })),
    };
    const client = api({
      heartbeat: vi.fn(async () => {
        throw new ContentProposalApiError("content_proposal_job_lease_invalid", 409);
      }),
    });
    const result = await processContentProposalJob({
      client,
      runner: createContentProposalRunner(model),
      job,
      leaseSeconds: 180,
      heartbeatMs: 1,
    });

    expect(result).toEqual({ status: "lease_lost", jobId: job.id });
    expect(client.heartbeat).toHaveBeenCalled();
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).not.toHaveBeenCalled();
    rejectModel?.(new Error("cleanup"));
  });

  it("marks transient failures retryable only while attempts remain", async () => {
    const runner: ContentProposalRunner = {
      run: vi.fn(async () => { throw new ContentProposalApiError("model_unavailable", 503); }),
    };
    const firstClient = api();
    await processContentProposalJob({
      client: firstClient, runner, job, leaseSeconds: 180, heartbeatMs: 100_000,
    });
    expect(firstClient.fail).toHaveBeenCalledWith(job, expect.objectContaining({ retryable: true }));

    const finalJob = { ...job, attemptCount: job.maxAttempts };
    const finalClient = api();
    await processContentProposalJob({
      client: finalClient, runner, job: finalJob, leaseSeconds: 180, heartbeatMs: 100_000,
    });
    expect(finalClient.fail).toHaveBeenCalledWith(finalJob, expect.objectContaining({ retryable: false }));
  });

  it("does not claim another job after graceful shutdown begins", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = api();

    await expect(runContentProposalOnce({
      client,
      runner: { run: vi.fn(async () => validResult) },
      workerId: "proposal-worker-1",
      leaseSeconds: 180,
      signal: controller.signal,
    })).resolves.toEqual({ status: "stopped" });
    expect(client.claim).not.toHaveBeenCalled();
  });

  it("keeps watch mode alive after a transient claim failure", async () => {
    const wait = vi.fn(async () => undefined);
    const onError = vi.fn();
    await expect(runContentProposalWatchIteration({
      runOnce: vi.fn(async () => {
        throw new ContentProposalApiError("content_proposal_api_timeout", 0);
      }),
      pollMs: 250,
      wait,
      onError,
    })).resolves.toEqual({ status: "retrying" });
    expect(wait).toHaveBeenCalledWith(250, undefined);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: "content_proposal_api_timeout",
    }));
  });

  it("interrupts a retry wait when graceful shutdown begins", async () => {
    const controller = new AbortController();
    const wait = vi.fn(async (_ms: number, signal?: AbortSignal) => {
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
    });
    const iteration = runContentProposalWatchIteration({
      runOnce: vi.fn(async () => {
        throw new ContentProposalApiError("content_proposal_api_timeout", 0);
      }),
      pollMs: 60_000,
      wait,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(wait).toHaveBeenCalled());
    expect(wait).toHaveBeenCalledWith(60_000, controller.signal);
    controller.abort();
    await expect(iteration).resolves.toEqual({ status: "stopped" });
  });

  it("does not call generation or publishing APIs for either queue origin", () => {
    const clientSource = String(createContentProposalRunner);
    expect(clientSource).not.toContain("/generate");
    expect(clientSource).not.toContain("/publish");
    expect(() => {
      throw new ContentProposalContractError("content_proposal_result_invalid");
    }).toThrow("content_proposal_result_invalid");
  });
});

const searchedEvidence = {
  contractVersion: "research-evidence.v1" as const,
  decision: "searched" as const,
  reason: "최신 근거 필요",
  queries: ["운영 최신 동향"],
  capturedAt: "2026-08-01T04:00:00.000Z",
  items: [{
    id: "70000000-0000-4000-8000-000000000007", title: "근거",
    url: "https://source.example/a", publisher: null, publishedAt: null,
    capturedAt: "2026-08-01T04:00:00.000Z", claimSummary: "근거 요약",
    contentHash: "a".repeat(64),
  }],
};

function v2Snapshot(
  purpose: "informational" | "marketing",
  contractVersion: "proposal-base-input.v2" | "proposal-input.v2",
  evidence = searchedEvidence,
) {
  return {
    contractVersion,
    brandCore: {
      versionId: "40000000-0000-4000-8000-000000000004", companyOverview: "개요",
      businessDescription: "사업", primaryCategory: "교육", detailedCategory: "온라인",
      primaryTarget: "창업자", differentiator: "실전", coreAppeal: "적용",
    },
    subject: { kind: "topic_text", title: "운영" }, contentInstruction: "실무 중심",
    product: purpose === "marketing" ? {
      id: "60000000-0000-4000-8000-000000000006", versionId: "61000000-0000-4000-8000-000000000006",
      kind: "product", name: "제품", description: "설명", features: ["특징"], benefits: ["장점"],
      cautions: ["한계"], evergreenPurchaseInfo: "문의", images: [],
    } : null,
    references: [],
    ...(contractVersion === "proposal-input.v2" ? { researchEvidence: evidence } : {}),
    outputSettings: {
      outputFormat: "card_news", channelTargets: ["instagram"], aspectRatio: "4:5",
      outputCount: 1, purpose,
    }, capturedAt: "2026-08-01T03:00:00.000Z",
  };
}

function v2Job(
  purpose: "informational" | "marketing" = "informational",
  composed = false,
  evidence = searchedEvidence,
): ContentProposalJobV2 {
  return parseContentProposalJob({
    ...job,
    request: {
      contractVersion: "content-proposal-request.v2", purpose, outputFormat: "card_news",
      channelTargets: ["instagram"], requestFingerprint: "fp",
    },
    inputSnapshot: v2Snapshot(purpose, composed ? "proposal-input.v2" : "proposal-base-input.v2", evidence),
    ...(composed ? { researchEvidence: evidence } : {}),
  }) as ContentProposalJobV2;
}

function v2Proposal(key: string) {
  return {
    conceptKey: key, title: `제목 ${key}`, informationalType: "how_to" as const,
    oneLineIntent: `의도 ${key}`, differentiator: `차별 ${key}`,
    differentiationAxes: ["target" as const], target: `타깃 ${key}`,
    customerContext: `상황 ${key}`, keyMessage: `메시지 ${key}`, hook: `훅 ${key}`,
    selectionReason: `이유 ${key}`, evidenceIds: [searchedEvidence.items[0].id], referenceIds: [],
    outputFormat: "card_news" as const, channelTargets: ["instagram"] as ["instagram"],
    assetCount: 2,
    outline: [
      { index: 1, role: "hook", headline: `제목1 ${key}`, purpose: `목적1 ${key}` },
      { index: 2, role: "body", headline: `제목2 ${key}`, purpose: `목적2 ${key}` },
    ],
    purposeDetails: {
      kind: "informational" as const, question: `질문 ${key}`, value: `가치 ${key}`,
      whyNow: `시점 ${key}`, learningPoints: [`학습 ${key}`],
    },
  };
}

const v2Set: ContentProposalSetV2 = {
  contractVersion: "content-proposal.v2",
  proposals: [v2Proposal("a"), v2Proposal("b"), v2Proposal("c")],
};

describe("content proposal V2 worker", () => {
  it("freezes required research before the network-disabled model and completes exactly three", async () => {
    const activeJob = v2Job();
    const order: string[] = [];
    const research = { run: vi.fn(async () => { order.push("search"); return searchedEvidence; }) };
    const client = api({
      completeResearch: vi.fn(async () => { order.push("freeze"); return v2Snapshot("informational", "proposal-input.v2") as never; }),
      complete: vi.fn(async () => { order.push("complete"); }),
    });
    const model: ContentProposalModelClient = {
      generate: vi.fn(async () => { order.push("model"); return v2Set; }),
    };

    await expect(processContentProposalJob({
      client, research, runner: createContentProposalRunner(model), job: activeJob,
      leaseSeconds: 180, heartbeatMs: 100_000,
    })).resolves.toEqual({ status: "completed", jobId: activeJob.id });

    expect(order).toEqual(["search", "freeze", "model", "complete"]);
    expect(research.run).toHaveBeenCalledTimes(1);
    expect(client.completeResearch).toHaveBeenCalledWith(activeJob, searchedEvidence);
    expect(model.generate).toHaveBeenCalledWith(
      expect.stringContaining('"contractVersion":"proposal-input.v2"'),
      expect.any(AbortSignal),
    );
    expect(client.complete).toHaveBeenCalledWith(activeJob, v2Set);
  });

  it("reuses frozen research and composed input on a retry claim", async () => {
    const activeJob = v2Job("informational", true);
    const client = api();
    const research = { run: vi.fn(async () => searchedEvidence) };
    const model = { generate: vi.fn(async () => v2Set) };
    await processContentProposalJob({
      client, research, runner: createContentProposalRunner(model), job: activeJob,
      leaseSeconds: 180, heartbeatMs: 100_000,
    });
    expect(research.run).not.toHaveBeenCalled();
    expect(client.completeResearch).not.toHaveBeenCalled();
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it("persists marketing not_needed without a second worker-side search", async () => {
    const notNeeded = {
      contractVersion: "research-evidence.v1" as const, decision: "not_needed" as const,
      reason: "검색 불필요", queries: [], capturedAt: "2026-08-01T04:00:00.000Z", items: [],
    };
    const activeJob = v2Job("marketing", false, notNeeded as never);
    const marketingSet = {
      contractVersion: "content-proposal.v2" as const,
      proposals: v2Set.proposals.map((proposal, index) => ({
        ...proposal,
        informationalType: null,
        evidenceIds: [],
        purposeDetails: {
          kind: "marketing" as const, campaignObjective: `목표 ${index}`, situationAndNeed: `니즈 ${index}`,
          productId: "60000000-0000-4000-8000-000000000006", targetSegment: `세그먼트 ${index}`,
          strengths: ["강점"], limitations: ["한계"], appeal: `소구 ${index}`,
          buyingBarriers: ["장벽"], cta: `CTA ${index}`,
        },
      })) as never,
    };
    const research = { run: vi.fn(async () => notNeeded) };
    const client = api({
      completeResearch: vi.fn(async () => v2Snapshot("marketing", "proposal-input.v2", notNeeded as never) as never),
    });
    await processContentProposalJob({
      client, research, runner: createContentProposalRunner({ generate: vi.fn(async () => marketingSet) }),
      job: activeJob, leaseSeconds: 180, heartbeatMs: 100_000,
    });
    expect(research.run).toHaveBeenCalledTimes(1);
    expect(client.completeResearch).toHaveBeenCalledWith(activeJob, notNeeded);
  });

  it("repairs a V2 contract failure exactly once with the code and first raw output", async () => {
    const activeJob = v2Job("informational", true);
    const invalid = { contractVersion: "content-proposal.v2", proposals: v2Set.proposals.slice(0, 2) };
    const model = { generate: vi.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce(v2Set) };
    const client = api();
    await processContentProposalJob({
      client, research: { run: vi.fn() }, runner: createContentProposalRunner(model),
      job: activeJob, leaseSeconds: 180, heartbeatMs: 100_000,
    });
    expect(model.generate).toHaveBeenCalledTimes(2);
    const repairPrompt = model.generate.mock.calls[1]?.[0] ?? "";
    expect(repairPrompt).toContain("content_proposal_result_invalid");
    const encodedRaw = repairPrompt.split("<first_raw_output>\n")[1]?.split("\n</first_raw_output>")[0];
    expect(JSON.parse(encodedRaw ?? "null")).toBe(JSON.stringify(invalid));
    expect(repairPrompt.match(/^<first_raw_output>$/gm)).toHaveLength(1);
    expect(repairPrompt.match(/^<\/first_raw_output>$/gm)).toHaveLength(1);
    expect(client.complete).toHaveBeenCalledWith(activeJob, v2Set);
  });

  it("fails non-retryably after one invalid repair without padding or a third call", async () => {
    const activeJob = v2Job("informational", true);
    const invalid = { contractVersion: "content-proposal.v2", proposals: [] };
    const model = { generate: vi.fn(async () => invalid) };
    const client = api();
    await processContentProposalJob({
      client, research: { run: vi.fn() }, runner: createContentProposalRunner(model),
      job: activeJob, leaseSeconds: 180, heartbeatMs: 100_000,
    });
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith(activeJob, expect.objectContaining({
      errorCode: "content_proposal_result_invalid",
      retryable: false,
    }));
  });

  it("keeps V1 on its existing single model call", async () => {
    const model = { generate: vi.fn(async () => validResult) };
    await processContentProposalJob({
      client: api(), research: { run: vi.fn() }, runner: createContentProposalRunner(model),
      job, leaseSeconds: 180, heartbeatMs: 100_000,
    });
    expect(model.generate).toHaveBeenCalledTimes(1);
  });
});
