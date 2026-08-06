import { describe, expect, it, vi } from "vitest";
import type {
  ContentOrchestrationV2,
  ProposalBaseInputSnapshotV2,
} from "@brand-pilot/content-contracts";
import {
  createAiContentProposalV2Service,
  proposalSha256,
  type ProposalV2CreationPorts,
  type ProposalV2Transaction,
} from "./aiContentProposalV2Service.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const brandId = "00000000-0000-4000-8000-000000000002";
const actorUserId = "00000000-0000-4000-8000-000000000003";

function request(): ContentOrchestrationV2 {
  return {
    contractVersion: "content-orchestration.v2",
    brandId,
    purpose: "informational",
    seed: { kind: "topic_text", title: "브랜드가 지금 답해야 할 질문" },
    contentInstruction: null,
    productId: null,
    outputSettings: {
      outputFormat: "reel",
      channelTargets: ["instagram"],
      aspectRatio: "9:16",
      outputCount: 1,
    },
  };
}

function baseInput(): ProposalBaseInputSnapshotV2 {
  return {
    contractVersion: "proposal-base-input.v2",
    brandCore: {
      versionId: "00000000-0000-4000-8000-000000000010",
      companyOverview: "브랜드 개요",
      businessDescription: "사업 설명",
      primaryCategory: "패션",
      detailedCategory: "지속가능 패션",
      primaryTarget: "의식 있는 소비자",
      differentiator: "검증된 공급망",
      coreAppeal: "투명성",
    },
    subject: { kind: "topic_text", title: "브랜드가 지금 답해야 할 질문" },
    contentInstruction: null,
    product: null,
    references: [],
    outputSettings: {
      outputFormat: "reel",
      channelTargets: ["instagram"],
      aspectRatio: "9:16",
      outputCount: 1,
      purpose: "informational",
    },
    capturedAt: "2026-08-05T00:00:00.000Z",
  };
}

function ports(overrides: Partial<ProposalV2CreationPorts> = {}) {
  const events: string[] = [];
  const tx = { query: vi.fn() } as unknown as ProposalV2Transaction;
  const result = {
    disposition: "created" as const,
    proposalRunId: null,
    proposalBatchId: "00000000-0000-4000-8000-000000000020",
    status: "proposal_pending" as const,
  };
  const defaults: ProposalV2CreationPorts = {
    findCommittedReplay: vi.fn(async () => {
      events.push("committed-replay");
      return null;
    }),
    assertReady: vi.fn(async () => {
      events.push("readiness");
    }),
    withTransaction: vi.fn(async (work) => {
      events.push("transaction");
      return work(tx);
    }),
    lockIdempotencyKey: vi.fn(async () => {
      events.push("lock");
    }),
    findReplay: vi.fn(async () => {
      events.push("locked-replay");
      return null;
    }),
    resolve: vi.fn(async () => {
      events.push("resolve");
      return { request: request(), baseInput: baseInput(), sourceSnapshots: [] };
    }),
    enqueue: vi.fn(async () => {
      events.push("enqueue");
      return result;
    }),
    ...overrides,
  };
  return { events, tx, result, ports: defaults };
}

function manualCommand() {
  return {
    source: "manual" as const,
    workspaceId,
    brandId,
    actorUserId,
    request: request(),
    idempotencyKey: "manual-proposal-1",
  };
}

describe("Proposal V2 creation service", () => {
  it("orders committed replay, readiness, lock/recheck, mutable resolution, and atomic enqueue", async () => {
    const fixture = ports();
    const service = createAiContentProposalV2Service(fixture.ports);

    await expect(service.create(manualCommand())).resolves.toEqual(fixture.result);

    expect(fixture.events).toEqual([
      "committed-replay",
      "readiness",
      "transaction",
      "lock",
      "locked-replay",
      "resolve",
      "enqueue",
    ]);
    expect(fixture.ports.enqueue).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({
        source: "manual",
        actorUserId,
        request: request(),
        baseInput: baseInput(),
      }),
    );
  });

  it("returns exact committed replay before readiness or mutable source resolution", async () => {
    const replay = {
      disposition: "replayed" as const,
      proposalRunId: null,
      proposalBatchId: "00000000-0000-4000-8000-000000000021",
      status: "proposal_pending" as const,
    };
    const fixture = ports({ findCommittedReplay: vi.fn(async () => replay) });

    await expect(createAiContentProposalV2Service(fixture.ports).create(manualCommand()))
      .resolves.toEqual(replay);

    expect(fixture.ports.assertReady).not.toHaveBeenCalled();
    expect(fixture.ports.withTransaction).not.toHaveBeenCalled();
    expect(fixture.ports.resolve).not.toHaveBeenCalled();
    expect(fixture.ports.enqueue).not.toHaveBeenCalled();
  });

  it.each(["content_proposals_disabled", "content_proposal_worker_not_ready"])(
    "fails a new write on %s before transaction, resolution, or mutation",
    async (code) => {
      const fixture = ports({ assertReady: vi.fn(async () => { throw new Error(code); }) });

      await expect(createAiContentProposalV2Service(fixture.ports).create(manualCommand()))
        .rejects.toThrow(code);

      expect(fixture.ports.withTransaction).not.toHaveBeenCalled();
      expect(fixture.ports.resolve).not.toHaveBeenCalled();
      expect(fixture.ports.enqueue).not.toHaveBeenCalled();
    },
  );

  it("uses the caller-owned transaction for scheduled work and a nullable system actor", async () => {
    const fixture = ports();
    const callerTx = { query: vi.fn() } as unknown as ProposalV2Transaction;
    const scheduledRequest = request();

    await createAiContentProposalV2Service(fixture.ports).create({
      source: "scheduled_crawl",
      workspaceId,
      brandId,
      callerOperationKey: "scheduled-operation-1",
      contentTopicId: "00000000-0000-4000-8000-000000000030",
      sourceSnapshotIds: ["00000000-0000-4000-8000-000000000031"],
      legacySourceOutputId: null,
      request: scheduledRequest,
    }, { tx: callerTx });

    expect(fixture.ports.withTransaction).not.toHaveBeenCalled();
    expect(fixture.ports.lockIdempotencyKey).toHaveBeenCalledWith(
      callerTx,
      expect.objectContaining({ actorUserId: null }),
    );
    expect(fixture.ports.enqueue).toHaveBeenCalledWith(
      callerTx,
      expect.objectContaining({ source: "scheduled_crawl", actorUserId: null }),
    );
  });

  it("routes performance experiments through the same transaction and server resolver", async () => {
    const fixture = ports();

    await createAiContentProposalV2Service(fixture.ports).create({
      source: "performance_experiment",
      workspaceId,
      brandId,
      actorUserId,
      experimentId: "00000000-0000-4000-8000-000000000050",
      evidenceVersion: "evidence-v7",
    });

    expect(fixture.ports.withTransaction).toHaveBeenCalledTimes(1);
    expect(fixture.ports.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ source: "performance_experiment", evidenceVersion: "evidence-v7" }),
      fixture.tx,
    );
    expect(fixture.ports.enqueue).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({
        source: "performance_experiment",
        actorUserId,
        idempotencyKey: `performance:${actorUserId}:00000000-0000-4000-8000-000000000050:evidence-v7`,
      }),
    );
  });

  it("hashes canonically regardless of object key insertion order", () => {
    expect(proposalSha256({ z: 1, nested: { b: 2, a: 1 } }))
      .toBe(proposalSha256({ nested: { a: 1, b: 2 }, z: 1 }));
  });

  it("rejects a caller-owned transaction for non-scheduled sources", async () => {
    const fixture = ports();
    const callerTx = { query: vi.fn() } as unknown as ProposalV2Transaction;

    await expect(createAiContentProposalV2Service(fixture.ports)
      .create(manualCommand(), { tx: callerTx }))
      .rejects.toThrow("proposal_v2_caller_transaction_invalid");
  });

  it("incident_unexpected_proposal_409 rechecks after the scoped lock and returns one identity", async () => {
    const stored = new Map<string, Awaited<ReturnType<ProposalV2CreationPorts["enqueue"]>>>();
    let lockTail = Promise.resolve();
    const releaseByTx = new WeakMap<object, () => void>();
    const fixture = ports({
      withTransaction: vi.fn(async (work) => {
        const tx = {} as ProposalV2Transaction;
        try {
          return await work(tx);
        } finally {
          releaseByTx.get(tx as object)?.();
        }
      }),
      lockIdempotencyKey: vi.fn(async (tx) => {
        const previous = lockTail;
        let release!: () => void;
        lockTail = new Promise<void>((resolve) => { release = resolve; });
        releaseByTx.set(tx as object, release);
        await previous;
      }),
      findReplay: vi.fn(async (_tx, identity) => stored.get(identity.replayFingerprint) ?? null),
      enqueue: vi.fn(async (_tx, input) => {
        const created = {
          disposition: "created" as const,
          proposalRunId: null,
          proposalBatchId: "00000000-0000-4000-8000-000000000040",
          status: "proposal_pending" as const,
        };
        stored.set(input.replayFingerprint, { ...created, disposition: "replayed" });
        return created;
      }),
    });
    const service = createAiContentProposalV2Service(fixture.ports);

    const [first, second] = await Promise.all([
      service.create(manualCommand()),
      service.create(manualCommand()),
    ]);

    expect([first.disposition, second.disposition].sort()).toEqual(["created", "replayed"]);
    expect(first.proposalBatchId).toBe(second.proposalBatchId);
    expect(fixture.ports.enqueue).toHaveBeenCalledTimes(1);
  });

  it("treats only a changed fingerprint behind the same key as conflict", async () => {
    const fixture = ports({
      findCommittedReplay: vi.fn(async (_identity) => {
        throw new Error("ai_content_proposal_batch_conflict");
      }),
    });
    const changed = manualCommand();
    changed.request = { ...changed.request, contentInstruction: "다른 요청" };

    await expect(createAiContentProposalV2Service(fixture.ports).create(changed))
      .rejects.toThrow("ai_content_proposal_batch_conflict");
  });
});
