import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createContentProposalJobsRepository,
  parseContentProposalResult,
} from "./contentProposalJobs.js";
import type { ResearchEvidenceSnapshotV1 } from "./aiContentContracts.js";

function proposal(title: string) {
  return {
    contractVersion: "content-proposal.v1",
    title,
    reasonToCreateNow: "최근 근거가 확보됨",
    contentFamily: "informational",
    topic: "운영 체크리스트",
    target: {},
    messageStrategy: "how_to",
    hook: "먼저 확인할 것",
    keyMessage: "순서대로 점검하세요",
    evidence: [],
    outline: [{ heading: "점검", purpose: "실행 안내" }],
    outputFormat: "blog",
    channelTargets: ["blog_export"],
    recommendedReferenceQuery: { strategies: ["how_to"], formats: ["blog"], tags: [] },
  };
}

function setup(options: {
  status?: "queued" | "processing" | "completed" | "failed";
  attemptCount?: number;
  maxAttempts?: number;
  leaseExpired?: boolean;
} = {}) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const job = {
    id: "10000000-0000-4000-8000-000000000001",
    workspace_id: "20000000-0000-4000-8000-000000000002",
    brand_id: "30000000-0000-4000-8000-000000000003",
    batch_id: "40000000-0000-4000-8000-000000000004",
    status: options.status ?? "queued",
    attempt_count: options.attemptCount ?? 0,
    max_attempts: options.maxAttempts ?? 3,
    lease_owner: options.status === "processing" ? "expired-worker" : null as string | null,
    lease_token: options.status === "processing" ? "50000000-0000-4000-8000-000000000005" : null as string | null,
    lease_expires_at: options.status === "processing"
      ? new Date(options.leaseExpired === false ? "2099-07-28T00:03:00Z" : "2020-07-28T00:03:00Z")
      : null as Date | null,
    available_at: new Date("2026-07-28T00:00:00Z"),
    content_family: "informational",
    request_json: {
      contractVersion: "content-proposal-request.v1",
      contentFamily: "informational",
      channelTargets: ["blog_export"],
      outputFormats: ["blog"],
      sourceSnapshotIds: ["source-1"],
      performanceSnapshotIds: [],
    },
    source_snapshot_json: [{
      sourceId: "source-1",
      url: "https://example.com/source",
      crawledAt: "2026-07-28T00:00:00.000Z",
      contentHash: "a".repeat(64),
      summary: "evidence",
    }],
    completion_lease_owner: null as string | null,
    completion_lease_token: null as string | null,
  };
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql.includes("set status='queued'") && sql.includes("attempt_count < max_attempts")) {
        if (job.status === "processing" && options.leaseExpired !== false && job.attempt_count < job.max_attempts) {
          Object.assign(job, {
            status: "queued",
            lease_owner: null,
            lease_token: null,
            lease_expires_at: null,
          });
          return { rows: [{ ...job }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("attempt_count >= max_attempts")) return { rows: [], rowCount: 0 };
      if (sql.includes("select job.id") && sql.includes("skip locked")) {
        return job.status === "queued" ? { rows: [{ id: job.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("set status = 'processing'") && sql.includes("returning")) {
        Object.assign(job, {
          status: "processing",
          attempt_count: Number(job.attempt_count) + 1,
          lease_owner: params[1],
          lease_token: params[2],
          lease_expires_at: new Date("2026-07-28T00:03:00Z"),
        });
        return { rows: [{ ...job }], rowCount: 1 };
      }
      if (sql.includes("set (lease_expires_at, updated_at)")) {
        const valid = job.status === "processing" && job.lease_owner === params[1] && job.lease_token === params[2];
        return { rows: valid ? [{ id: job.id }] : [], rowCount: valid ? 1 : 0 };
      }
      if (sql.includes("from ai_content_proposal_jobs job") && sql.includes("for update")) {
        return { rows: [{ ...job, lease_expired: false }], rowCount: 1 };
      }
      if (sql.includes("insert into ai_content_proposals")) return { rows: [], rowCount: 2 };
      if (sql.includes("update ai_content_proposal_batches")) return { rows: [], rowCount: 1 };
      if (sql.includes("set status = 'completed'")) {
        job.status = "completed";
        Object.assign(job, {
          lease_owner: null,
          lease_token: null,
          lease_expires_at: null,
          completion_lease_owner: params[1],
          completion_lease_token: params[2],
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("set status = $2")) {
        job.status = String(params[1]) as typeof job.status;
        Object.assign(job, { lease_owner: null, lease_token: null, lease_expires_at: null });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client), query: client.query };
  return { repository: createContentProposalJobsRepository(pool as never), statements, job };
}

describe("content proposal jobs", () => {
  it("claims a queued job with a bounded lease and server-owned tenant context", async () => {
    const { repository, statements } = setup();

    const claimed = await repository.claimContentProposalJob({
      workerId: "proposal-worker-1",
      leaseSeconds: 180,
    });

    expect(claimed).toMatchObject({
      workspaceId: "20000000-0000-4000-8000-000000000002",
      brandId: "30000000-0000-4000-8000-000000000003",
      attemptCount: 1,
      workerId: "proposal-worker-1",
    });
    expect(statements.some(({ sql }) => sql.includes("skip locked"))).toBe(true);
    expect(statements.some(({ sql }) => sql.includes("least($4::integer, 900)"))).toBe(true);
  });

  it("reclaims an expired processing lease without incrementing attempts until claim", async () => {
    const { repository, statements } = setup({
      status: "processing",
      attemptCount: 1,
      leaseExpired: true,
    });

    const claimed = await repository.claimContentProposalJob({
      workerId: "proposal-worker-2",
      leaseSeconds: 180,
    });

    expect(claimed).toMatchObject({ attemptCount: 2, workerId: "proposal-worker-2" });
    expect(statements.some(({ sql }) => sql.includes("set status='queued'")
      && sql.includes("attempt_count < max_attempts")
      && sql.includes("lease_expires_at <= clock_timestamp()"))).toBe(true);
  });

  it("does not reclaim an unexpired processing lease", async () => {
    const { repository } = setup({
      status: "processing",
      attemptCount: 1,
      leaseExpired: false,
    });

    await expect(repository.claimContentProposalJob({
      workerId: "proposal-worker-2",
      leaseSeconds: 180,
    })).resolves.toBeNull();
  });

  it("marks the parent batch building when a job is claimed", async () => {
    const { repository, statements } = setup();

    await repository.claimContentProposalJob({ workerId: "proposal-worker-1", leaseSeconds: 180 });

    expect(statements.some(({ sql }) => sql.includes("update ai_content_proposal_batches")
      && sql.includes("status='building'"))).toBe(true);
  });

  it("marks exhausted jobs and their parent batches failed", async () => {
    const { repository, statements } = setup({
      status: "processing",
      attemptCount: 3,
      maxAttempts: 3,
      leaseExpired: true,
    });

    await expect(repository.claimContentProposalJob({
      workerId: "proposal-worker-2",
      leaseSeconds: 180,
    })).resolves.toBeNull();

    expect(statements.some(({ sql }) => sql.includes("update ai_content_proposal_batches")
      && sql.includes("content_proposal_attempts_exhausted")
      && sql.includes("status='failed'"))).toBe(true);
  });

  it("heartbeats only the matching unexpired lease", async () => {
    const { repository } = setup();
    const claimed = await repository.claimContentProposalJob({ workerId: "proposal-worker-1", leaseSeconds: 180 });

    await expect(repository.heartbeatContentProposalJob({
      jobId: claimed!.id,
      workerId: "proposal-worker-1",
      leaseToken: claimed!.leaseToken!,
      leaseSeconds: 180,
    })).resolves.toBe(true);
    await expect(repository.heartbeatContentProposalJob({
      jobId: claimed!.id,
      workerId: "other-worker",
      leaseToken: claimed!.leaseToken!,
      leaseSeconds: 180,
    })).resolves.toBe(false);
  });

  it("completes idempotently and persists only validated 2-3 proposals", async () => {
    const { repository, statements } = setup();
    const claimed = await repository.claimContentProposalJob({ workerId: "proposal-worker-1", leaseSeconds: 180 });
    const proposals = [proposal("A"), proposal("B")];

    await repository.completeContentProposalJob({
      jobId: claimed!.id,
      workerId: "proposal-worker-1",
      leaseToken: claimed!.leaseToken!,
      proposals,
    });
    await expect(repository.completeContentProposalJob({
      jobId: claimed!.id,
      workerId: "proposal-worker-1",
      leaseToken: claimed!.leaseToken!,
      proposals,
    })).resolves.toMatchObject({ status: "completed" });
    await expect(repository.completeContentProposalJob({
      jobId: claimed!.id,
      workerId: "other-worker",
      leaseToken: "60000000-0000-4000-8000-000000000006",
      proposals,
    })).rejects.toThrow("content_proposal_job_lease_invalid");

    const insert = statements.find(({ sql }) => sql.includes("insert into ai_content_proposals"));
    expect(insert?.sql).toContain("job.workspace_id");
    expect(insert?.sql).toContain("job.brand_id");
    expect(insert?.params).toEqual(expect.arrayContaining([JSON.stringify(proposals)]));
    expect(statements.some(({ sql }) => sql.includes("from ai_content_proposals")
      && sql.includes("order by position"))).toBe(false);
  });

  it("keeps completed V1 proposalSet validation eager while ignoring a valid V2-shaped set", async () => {
    const { repository } = setup();
    const claimed = await repository.claimContentProposalJob({ workerId: "proposal-worker-1", leaseSeconds: 180 });
    const identity = {
      jobId: claimed!.id,
      workerId: "proposal-worker-1",
      leaseToken: claimed!.leaseToken!,
    };
    await repository.completeContentProposalJob({ ...identity, proposals: [proposal("A"), proposal("B")] });

    await expect(repository.completeContentProposalJob({
      ...identity,
      proposalSet: { contractVersion: "content-proposal.v2", proposals: [] },
    })).rejects.toThrow("content_proposal_result_invalid");
    await expect(repository.completeContentProposalJob({
      ...identity,
      proposalSet: proposalSet(),
    })).resolves.toMatchObject({ status: "completed" });
  });

  it("rejects completion payloads outside the 2-3 proposal bound", async () => {
    const { repository } = setup();
    await expect(repository.completeContentProposalJob({
      jobId: "10000000-0000-4000-8000-000000000001",
      workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
      proposals: [{ contractVersion: "content-proposal.v1" }],
    })).rejects.toThrow("content_proposal_result_invalid");
  });

  it("rejects structurally incomplete worker proposals", async () => {
    const { repository } = setup();
    const claimed = await repository.claimContentProposalJob({
      workerId: "proposal-worker-1",
      leaseSeconds: 180,
    });
    await expect(repository.completeContentProposalJob({
      jobId: claimed!.id,
      workerId: "proposal-worker-1",
      leaseToken: claimed!.leaseToken!,
      proposals: [
        { contractVersion: "content-proposal.v1", title: "A" },
        { contractVersion: "content-proposal.v1", title: "B" },
      ],
    })).rejects.toThrow("content_proposal_result_invalid");
  });

  it.each([
    ["channel target", { channelTargets: ["email"] }],
    ["recommended strategy", { recommendedReferenceQuery: { strategies: ["unknown"], formats: ["blog"], tags: [] } }],
    ["recommended format", { recommendedReferenceQuery: { strategies: ["how_to"], formats: ["pdf"], tags: [] } }],
    ["recommended tag", { recommendedReferenceQuery: { strategies: ["how_to"], formats: ["blog"], tags: [""] } }],
    ["extra field", { unexpected: true }],
  ])("rejects an invalid exact proposal %s", (_label, patch) => {
    expect(() => parseContentProposalResult([
      { ...proposal("A"), ...patch },
      proposal("B"),
    ])).toThrow("content_proposal_result_invalid");
  });

  it.each([
    ["family", { contentFamily: "marketing" }],
    ["format", { outputFormat: "card_news" }],
    ["channel", { channelTargets: ["instagram"] }],
    ["evidence", { evidence: [{ sourceSnapshotId: "other-source", summary: "foreign" }] }],
  ])("rejects a proposal whose %s escapes the locked batch request", async (_label, patch) => {
    const { repository, statements } = setup();
    const claimed = await repository.claimContentProposalJob({
      workerId: "proposal-worker-1",
      leaseSeconds: 180,
    });

    await expect(repository.completeContentProposalJob({
      jobId: claimed!.id,
      workerId: "proposal-worker-1",
      leaseToken: claimed!.leaseToken!,
      proposals: [
        { ...proposal("A"), ...patch },
        proposal("B"),
      ],
    })).rejects.toThrow("content_proposal_batch_mismatch");

    expect(statements.some(({ sql }) => sql.includes("insert into ai_content_proposals"))).toBe(false);
    expect(statements.map(({ sql }) => sql)).toContain("ROLLBACK");
  });

  it("requeues retryable failures only while attempts remain", async () => {
    const { repository, statements } = setup();
    const claimed = await repository.claimContentProposalJob({ workerId: "proposal-worker-1", leaseSeconds: 180 });

    const failed = await repository.failContentProposalJob({
      jobId: claimed!.id,
      workerId: "proposal-worker-1",
      leaseToken: claimed!.leaseToken!,
      errorCode: "proposal_generation_timeout",
      errorMessage: "timeout",
      retryable: true,
    });

    expect(failed.status).toBe("queued");
    expect(statements.some(({ sql }) => sql.includes("attempt_count < max_attempts"))).toBe(true);
  });
});

const v2BaseInput = {
  contractVersion: "proposal-base-input.v2",
  brandCore: {
    versionId: "40000000-0000-4000-8000-000000000004",
    companyOverview: "브랜드 개요", businessDescription: "사업 설명",
    primaryCategory: "교육", detailedCategory: "온라인 교육", primaryTarget: "창업자",
    differentiator: "실전형", coreAppeal: "바로 적용",
  },
  subject: { kind: "topic_text", title: "운영 체크리스트" },
  contentInstruction: "실무 중심",
  product: null,
  references: [],
  outputSettings: {
    outputFormat: "card_news", channelTargets: ["instagram"], aspectRatio: "4:5",
    outputCount: 1, purpose: "informational",
  },
  capturedAt: "2026-08-01T03:00:00.000Z",
};

function researchItem(url = "https://source.example/article") {
  const value = {
    title: "검증 자료", url, publisher: "Source",
    publishedAt: "2026-07-31T00:00:00.000Z", claimSummary: "실무 적용 근거",
  };
  const contentHash = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return {
    id: "7a000000-0000-4000-8000-000000000007",
    ...value,
    capturedAt: "2026-08-01T04:00:00.000Z",
    contentHash,
  };
}

function evidence(overrides: Record<string, unknown> = {}): ResearchEvidenceSnapshotV1 {
  return {
    contractVersion: "research-evidence.v1",
    decision: "searched",
    reason: "최신 근거 필요",
    queries: ["브랜드 운영 최신 동향"],
    capturedAt: "2026-08-01T04:00:00.000Z",
    items: [researchItem()],
    ...overrides,
  } as ResearchEvidenceSnapshotV1;
}

function v2Proposal(conceptKey: string, patch: Record<string, unknown> = {}) {
  const suffix = conceptKey.at(-1) ?? "A";
  return {
    conceptKey,
    title: `구성안 ${suffix}`,
    informationalType: "how_to",
    oneLineIntent: `의도 ${suffix}`,
    differentiator: `차별점 ${suffix}`,
    differentiationAxes: ["narrative"],
    target: "초기 창업자",
    customerContext: "운영 시작",
    keyMessage: `핵심 ${suffix}`,
    hook: `훅 ${suffix}`,
    selectionReason: `이유 ${suffix}`,
    evidenceIds: ["7a000000-0000-4000-8000-000000000007"],
    referenceIds: [],
    outputFormat: "card_news",
    channelTargets: ["instagram"],
    assetCount: 1,
    outline: [{ index: 1, role: "hook", headline: `제목 ${suffix}`, purpose: `목적 ${suffix}` }],
    purposeDetails: {
      kind: "informational", question: `질문 ${suffix}`, value: `가치 ${suffix}`,
      whyNow: `시점 ${suffix}`, learningPoints: [`학습 ${suffix}`],
    },
    ...patch,
  };
}

function proposalSet(...proposals: ReturnType<typeof v2Proposal>[]) {
  return {
    contractVersion: "content-proposal.v2",
    proposals: proposals.length ? proposals : [v2Proposal("concept-a"), v2Proposal("concept-b"), v2Proposal("concept-c")],
  };
}

function setupV2(options: { expired?: boolean; version?: "v1" | "v2" } = {}) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let storedEvidence: Record<string, unknown> | null = null;
  const storedProposals: Array<{ position: number; proposal_json: Record<string, unknown> }> = [];
  const job: Record<string, unknown> = {
    id: "10000000-0000-4000-8000-000000000001",
    workspace_id: "20000000-0000-4000-8000-000000000002",
    brand_id: "30000000-0000-4000-8000-000000000003",
    batch_id: "40000000-0000-4000-8000-000000000004",
    status: "processing", attempt_count: 1, max_attempts: 3,
    lease_owner: "proposal-worker-1", lease_token: "50000000-0000-4000-8000-000000000005",
    lease_expires_at: new Date("2099-08-01T05:00:00.000Z"),
    lease_expired: options.expired ?? false,
    available_at: new Date("2026-08-01T03:00:00.000Z"),
    content_family: "informational",
    request_json: options.version === "v1"
      ? { contractVersion: "content-proposal-request.v1", contentFamily: "informational" }
      : { contractVersion: "content-proposal-request.v2", purpose: "informational", outputFormat: "card_news", channelTargets: ["instagram"] },
    source_snapshot_json: [],
    input_snapshot_json: options.version === "v1" ? null : v2BaseInput,
    completion_lease_owner: null, completion_lease_token: null,
  };
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql.includes("attempt_count >= max_attempts")
        || sql.includes("set status='queued'") && sql.includes("attempt_count < max_attempts")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("select job.id") && sql.includes("skip locked")) {
        return job.status === "queued" ? { rows: [{ id: job.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("set status = 'processing'") && sql.includes("returning")) {
        job.status = "processing";
        job.attempt_count = Number(job.attempt_count) + 1;
        job.lease_owner = params[1];
        job.lease_token = params[2];
        return { rows: [{ ...job, evidence_json: storedEvidence }], rowCount: 1 };
      }
      if (sql.includes("insert into ai_content_proposal_research_snapshots")) {
        if (storedEvidence) return { rows: [], rowCount: 0 };
        storedEvidence = JSON.parse(String(params[1]));
        return { rows: [{ evidence_json: storedEvidence }], rowCount: 1 };
      }
      if (sql.includes("insert into ai_content_proposals")) {
        const proposals = JSON.parse(String(params[1])) as Record<string, unknown>[];
        storedProposals.push(...proposals.map((storedProposal, index) => ({
          position: index + 1,
          proposal_json: storedProposal,
        })));
        return { rows: [], rowCount: proposals.length };
      }
      if (sql.includes("from ai_content_proposals") && sql.includes("order by position")) {
        const normalizedSql = sql.replace(/\s+/g, " ").trim();
        const expectedSql = "select position,proposal_json from ai_content_proposals "
          + "where batch_id=$1 and workspace_id=$2 and brand_id=$3 order by position";
        const expectedParams = [job.batch_id, job.workspace_id, job.brand_id];
        if (normalizedSql !== expectedSql
          || params.length !== expectedParams.length
          || params.some((param, index) => param !== expectedParams[index])) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: storedProposals.map((stored) => ({ ...stored })), rowCount: storedProposals.length };
      }
      if (sql.includes("set status = 'completed'")) {
        job.status = "completed";
        job.completion_lease_owner = params[1];
        job.completion_lease_token = params[2];
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("update ai_content_proposal_batches")) return { rows: [], rowCount: 1 };
      if (sql.includes("from ai_content_proposal_jobs job") && sql.includes("for update")) {
        return { rows: [{ ...job, evidence_json: storedEvidence }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return {
    repository: createContentProposalJobsRepository({ connect: async () => client, query: client.query } as never),
    statements,
    job,
    getStoredEvidence: () => storedEvidence,
    storedProposals,
  };
}

describe("V2 proposal research and completion", () => {
  it("stores one immutable research snapshot and returns the composed proposal input", async () => {
    const fixture = setupV2();
    const input = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005", evidence: evidence(),
    };
    const first = await fixture.repository.completeContentProposalResearch(input);
    const replay = await fixture.repository.completeContentProposalResearch(input);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      contractVersion: "proposal-input.v2",
      researchEvidence: { contractVersion: "research-evidence.v1", decision: "searched" },
    });
    expect(fixture.statements.filter(({ sql }) => sql.includes("insert into ai_content_proposal_research_snapshots"))).toHaveLength(1);
    expect(fixture.getStoredEvidence()).toEqual(evidence());
  });

  it("rejects changed evidence after the immutable snapshot exists", async () => {
    const fixture = setupV2();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });
    await expect(fixture.repository.completeContentProposalResearch({
      ...identity, evidence: evidence({ reason: "변경된 근거" }),
    })).rejects.toThrow("content_proposal_research_snapshot_conflict");
  });

  it.each([
    ["wrong lease", {}, "other-worker", "content_proposal_job_lease_invalid"],
    ["expired lease", { expired: true }, "proposal-worker-1", "content_proposal_job_lease_invalid"],
    ["V1 batch", { version: "v1" as const }, "proposal-worker-1", "content_proposal_research_v2_required"],
  ])("rejects research for %s", async (_label, options, workerId, code) => {
    const fixture = setupV2(options);
    await expect(fixture.repository.completeContentProposalResearch({
      jobId: String(fixture.job.id), workerId,
      leaseToken: "50000000-0000-4000-8000-000000000005", evidence: evidence(),
    })).rejects.toThrow(code);
  });

  it.each([
    ["informational not-needed", evidence({ decision: "not_needed", queries: [], items: [] })],
    ["more than eight items", evidence({ items: Array.from({ length: 9 }, (_, index) => researchItem(`https://source.example/${index}`)) })],
    ["non-HTTPS URL", evidence({ items: [researchItem("http://source.example/article")] })],
    ["unobserved/altered URL", evidence({ items: [{ ...researchItem(), url: "https://invented.example/article" }] })],
  ])("rejects invalid research: %s", async (_label, invalidEvidence) => {
    const fixture = setupV2();
    await expect(fixture.repository.completeContentProposalResearch({
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005", evidence: invalidEvidence as never,
    })).rejects.toThrow("content_proposal_research_invalid");
  });

  it("includes stored research and composed input on a V2 claim retry without changing V1 shape", async () => {
    const fixture = setupV2();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });
    fixture.job.status = "queued";
    // The SQL fixture returns the stored evidence on the next claim row.
    const claimed = await fixture.repository.claimContentProposalJob({ workerId: "proposal-worker-2", leaseSeconds: 180 });
    expect(claimed).toMatchObject({
      inputSnapshot: { contractVersion: "proposal-input.v2" },
      researchEvidence: { contractVersion: "research-evidence.v1" },
    });

    const v1 = setup();
    const v1Claim = await v1.repository.claimContentProposalJob({ workerId: "proposal-worker-1", leaseSeconds: 180 });
    expect(v1Claim).not.toHaveProperty("inputSnapshot");
    expect(v1Claim).not.toHaveProperty("researchEvidence");
  });

  it("persists exactly three cross-checked V2 proposal rows at positions 1 to 3", async () => {
    const fixture = setupV2();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });
    await fixture.repository.completeContentProposalJob({ ...identity, proposalSet: proposalSet() });

    const insert = fixture.statements.find(({ sql }) => sql.includes("insert into ai_content_proposals"))!;
    expect(insert.sql).toContain("with ordinality");
    expect(insert.params[1]).toBe(JSON.stringify(proposalSet().proposals));
  });

  it("accepts only the same canonical V2 completion on retry without inserting duplicates", async () => {
    const fixture = setupV2();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    const normalizedFirst = proposalSet(
      Object.fromEntries(Object.entries(v2Proposal("concept-a", {
          conceptKey: " concept-a ",
          title: " 구성안 a ",
          evidenceIds: ["7a000000-0000-4000-8000-000000000007".toUpperCase()],
        })).reverse()) as ReturnType<typeof v2Proposal>,
      v2Proposal("concept-b"),
      v2Proposal("concept-c"),
    );

    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });
    await fixture.repository.completeContentProposalJob({ ...identity, proposalSet: normalizedFirst });
    await expect(fixture.repository.completeContentProposalJob({
      ...identity,
      proposalSet: proposalSet(),
    })).resolves.toMatchObject({ status: "completed" });

    expect(fixture.statements.filter(({ sql }) => sql.includes("insert into ai_content_proposals"))).toHaveLength(1);
    expect(fixture.storedProposals).toHaveLength(3);
    const storedRead = fixture.statements.find(({ sql }) => sql.includes("from ai_content_proposals")
      && sql.includes("order by position"));
    expect(storedRead?.sql.replace(/\s+/g, " ").trim()).toBe(
      "select position,proposal_json from ai_content_proposals "
        + "where batch_id=$1 and workspace_id=$2 and brand_id=$3 order by position",
    );
    expect(storedRead?.params).toEqual([
      fixture.job.batch_id,
      fixture.job.workspace_id,
      fixture.job.brand_id,
    ]);
    expect(storedRead?.sql).not.toMatch(/select\s+(?:proposal\.)?id/i);
  });

  it.each([
    ["unknown explicit version", { contractVersion: "content-proposal-request.v3" }],
    ["missing version", { purpose: "informational" }],
    ["non-object metadata", []],
  ])("rejects a completed replay with %s instead of classifying it as V1", async (_label, requestJson) => {
    const fixture = setupV2();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });
    await fixture.repository.completeContentProposalJob({ ...identity, proposalSet: proposalSet() });
    fixture.job.request_json = requestJson;

    await expect(fixture.repository.completeContentProposalJob({
      ...identity,
      proposalSet: { arbitrary: true },
    })).rejects.toThrow("content_proposal_completion_conflict");
  });

  it.each([
    ["title", proposalSet(v2Proposal("concept-a", { title: "변경된 제목" }), v2Proposal("concept-b"), v2Proposal("concept-c"))],
    ["concept key", proposalSet(v2Proposal("concept-z"), v2Proposal("concept-b"), v2Proposal("concept-c"))],
    ["outline", proposalSet(v2Proposal("concept-a", {
      outline: [{ index: 1, role: "hook", headline: "변경된 개요", purpose: "목적 a" }],
    }), v2Proposal("concept-b"), v2Proposal("concept-c"))],
    ["differentiation", proposalSet(v2Proposal("concept-a", { differentiator: "변경된 차별점" }), v2Proposal("concept-b"), v2Proposal("concept-c"))],
    ["proposal position", proposalSet(v2Proposal("concept-b"), v2Proposal("concept-a"), v2Proposal("concept-c"))],
  ])("rejects a completed V2 retry with changed %s without mutating stored output", async (_label, changed) => {
    const fixture = setupV2();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });
    await fixture.repository.completeContentProposalJob({ ...identity, proposalSet: proposalSet() });
    const original = structuredClone(fixture.storedProposals);

    await expect(fixture.repository.completeContentProposalJob({
      ...identity,
      proposalSet: changed,
    })).rejects.toThrow("content_proposal_completion_conflict");

    expect(fixture.storedProposals).toEqual(original);
    expect(fixture.statements.filter(({ sql }) => sql.includes("insert into ai_content_proposals"))).toHaveLength(1);
    expect(fixture.statements.filter(({ sql }) => sql.includes("set status = 'completed'"))).toHaveLength(1);
  });

  it.each([
    ["missing", (rows: Array<{ position: number; proposal_json: Record<string, unknown> }>) => rows.pop()],
    ["extra", (rows: Array<{ position: number; proposal_json: Record<string, unknown> }>) => (
      rows.push({ position: 4, proposal_json: v2Proposal("concept-d") })
    )],
    ["out-of-order position", (rows: Array<{ position: number; proposal_json: Record<string, unknown> }>) => {
      rows[1]!.position = 3;
    }],
  ])("rejects completed V2 output with %s stored proposal rows", async (_label, corrupt) => {
    const fixture = setupV2();
    const setupRows = fixture.storedProposals;
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });
    await fixture.repository.completeContentProposalJob({ ...identity, proposalSet: proposalSet() });
    corrupt(setupRows);

    await expect(fixture.repository.completeContentProposalJob({
      ...identity,
      proposalSet: proposalSet(),
    })).rejects.toThrow("content_proposal_completion_conflict");
  });

  it.each([
    ["worker", { workerId: "other-worker" }],
    ["lease token", { leaseToken: "60000000-0000-4000-8000-000000000006" }],
  ])("keeps an invalid completed retry %s error ahead of stored proposal comparison", async (_label, invalidIdentity) => {
    const fixture = setupV2();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });
    await fixture.repository.completeContentProposalJob({ ...identity, proposalSet: proposalSet() });

    await expect(fixture.repository.completeContentProposalJob({
      ...identity,
      ...invalidIdentity,
      proposalSet: proposalSet(v2Proposal("concept-z"), v2Proposal("concept-b"), v2Proposal("concept-c")),
    })).rejects.toThrow("content_proposal_job_lease_invalid");
  });

  it.each([
    ["worker", { workerId: "other-worker" }],
    ["lease token", { leaseToken: "60000000-0000-4000-8000-000000000006" }],
  ])("checks an invalid completed retry %s before parsing malformed V2 output", async (_label, invalidIdentity) => {
    const fixture = setupV2();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });
    await fixture.repository.completeContentProposalJob({ ...identity, proposalSet: proposalSet() });

    await expect(fixture.repository.completeContentProposalJob({
      ...identity,
      ...invalidIdentity,
      proposalSet: { contractVersion: "content-proposal.v2", proposals: [] },
    })).rejects.toThrow("content_proposal_job_lease_invalid");
  });

  it.each([
    ["malformed proposal count", { contractVersion: "content-proposal.v2", proposals: [] }],
    ["unknown key", { ...proposalSet(), unexpected: true }],
    ["wrong proposal shape", { contractVersion: "content-proposal.v2", proposals: {} }],
  ])("maps a valid completed retry with %s to the stable completion conflict", async (_label, malformed) => {
    const fixture = setupV2();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });
    await fixture.repository.completeContentProposalJob({ ...identity, proposalSet: proposalSet() });

    await expect(fixture.repository.completeContentProposalJob({
      ...identity,
      proposalSet: malformed,
    })).rejects.toThrow("content_proposal_completion_conflict");
  });

  it.each([
    ["legacy proposals arm", { proposals: [] }],
    ["missing proposal set", {}],
  ])("maps a valid completed V2 retry with %s to the stable completion conflict", async (_label, body) => {
    const fixture = setupV2();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });
    await fixture.repository.completeContentProposalJob({ ...identity, proposalSet: proposalSet() });

    await expect(fixture.repository.completeContentProposalJob({
      ...identity,
      ...body,
    })).rejects.toThrow("content_proposal_completion_conflict");
  });

  it.each([
    ["worker with legacy proposals arm", { workerId: "other-worker" }, { proposals: [] }],
    ["lease token with missing proposal set", { leaseToken: "60000000-0000-4000-8000-000000000006" }, {}],
  ])("checks an invalid completed retry %s before its wrong V2 completion arm", async (_label, invalidIdentity, body) => {
    const fixture = setupV2();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });
    await fixture.repository.completeContentProposalJob({ ...identity, proposalSet: proposalSet() });

    await expect(fixture.repository.completeContentProposalJob({
      ...identity,
      ...invalidIdentity,
      ...body,
    })).rejects.toThrow("content_proposal_job_lease_invalid");
  });

  it("keeps malformed V2 output invalid on the first processing completion", async () => {
    const fixture = setupV2();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });

    await expect(fixture.repository.completeContentProposalJob({
      ...identity,
      proposalSet: { ...proposalSet(), unexpected: true },
    })).rejects.toThrow("content_proposal_result_invalid");
  });

  it.each([
    ["worker", () => setupV2(), { workerId: "other-worker" }],
    ["lease token", () => setupV2(), { leaseToken: "60000000-0000-4000-8000-000000000006" }],
    ["expired lease", () => setupV2({ expired: true }), {}],
  ])("keeps malformed processing V2 output ahead of an invalid %s", async (_label, createFixture, invalidIdentity) => {
    const fixture = createFixture();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };

    await expect(fixture.repository.completeContentProposalJob({
      ...identity,
      ...invalidIdentity,
      proposalSet: { ...proposalSet(), unexpected: true },
    })).rejects.toThrow("content_proposal_result_invalid");
  });

  it.each([
    ["legacy proposals arm", { proposals: [] }],
    ["missing proposal set", {}],
  ])("keeps a processing V2 %s invalid", async (_label, body) => {
    const fixture = setupV2();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });

    await expect(fixture.repository.completeContentProposalJob({
      ...identity,
      ...body,
    })).rejects.toThrow("content_proposal_result_invalid");
  });

  it("rejects a V2 batch request that diverges from its immutable input snapshot", async () => {
    const fixture = setupV2();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });
    fixture.job.request_json = {
      contractVersion: "content-proposal-request.v2",
      purpose: "informational",
      outputFormat: "reel",
      channelTargets: ["instagram"],
    };

    await expect(fixture.repository.completeContentProposalJob({
      ...identity, proposalSet: proposalSet(),
    })).rejects.toThrow("content_proposal_batch_mismatch");
  });

  it.each([
    ["format", v2Proposal("concept-a", { outputFormat: "reel", assetCount: 1 })],
    ["channel", v2Proposal("concept-a", { channelTargets: ["threads"] })],
    ["evidence", v2Proposal("concept-a", { evidenceIds: ["80000000-0000-4000-8000-000000000008"] })],
    ["reference", v2Proposal("concept-a", { referenceIds: ["80000000-0000-4000-8000-000000000008"] })],
  ])("rejects V2 proposal %s that escapes the snapshot", async (_label, invalid) => {
    const fixture = setupV2();
    const identity = {
      jobId: String(fixture.job.id), workerId: "proposal-worker-1",
      leaseToken: "50000000-0000-4000-8000-000000000005",
    };
    await fixture.repository.completeContentProposalResearch({ ...identity, evidence: evidence() });
    await expect(fixture.repository.completeContentProposalJob({
      ...identity, proposalSet: proposalSet(invalid, v2Proposal("concept-b"), v2Proposal("concept-c")),
    })).rejects.toThrow("content_proposal_batch_mismatch");
  });
});
