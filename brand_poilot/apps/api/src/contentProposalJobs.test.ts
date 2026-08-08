import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  createContentProposalJobsRepository,
  type ContentProposalJobRecord,
} from "./contentProposalJobs.js";
import { proposalSha256 } from "./aiContentProposalV2Service.js";

const ids = {
  job: "10000000-0000-4000-8000-000000000001",
  workspace: "20000000-0000-4000-8000-000000000002",
  brand: "30000000-0000-4000-8000-000000000003",
  batch: "40000000-0000-4000-8000-000000000004",
  contract: "50000000-0000-4000-8000-000000000005",
  lease: "60000000-0000-4000-8000-000000000006",
  researchAttempt: "70000000-0000-4000-8000-000000000007",
  evidence: "80000000-0000-4000-8000-000000000008",
  composition: "90000000-0000-4000-8000-000000000009",
  modelAttempt: "a0000000-0000-4000-8000-00000000000a",
};
const sha = "a".repeat(64);

const request = {
  contractVersion: "content-proposal-request.v2" as const,
  purpose: "informational" as const,
  outputFormat: "reel" as const,
  channelTargets: ["instagram" as const],
  requestFingerprint: "f".repeat(64),
};

const baseInput = {
  contractVersion: "proposal-base-input.v2" as const,
  brandCore: {
    versionId: "b0000000-0000-4000-8000-00000000000b",
    companyOverview: "브랜드 개요",
    businessDescription: "사업 설명",
    primaryCategory: "패션",
    detailedCategory: "지속가능 패션",
    primaryTarget: "의식 있는 소비자",
    differentiator: "검증된 공급망",
    coreAppeal: "투명성",
  },
  subject: { kind: "topic_text" as const, title: "브랜드 운영 체크리스트" },
  contentInstruction: null,
  product: null,
  references: [],
  outputSettings: {
    outputFormat: "reel" as const,
    channelTargets: ["instagram" as const],
    aspectRatio: "9:16" as const,
    outputCount: 1 as const,
    purpose: "informational" as const,
  },
  capturedAt: "2026-08-05T00:00:00.000Z",
};

function evidenceItem(contentHash?: string) {
  const fields = {
    title: "검증 자료",
    url: "https://source.example/article",
    publisher: "Source",
    publishedAt: null,
    claimSummary: "실무 적용 근거",
  };
  return {
    id: ids.evidence,
    ...fields,
    capturedAt: "2026-08-05T01:00:00.000Z",
    contentHash: contentHash ?? createHash("sha256").update(JSON.stringify(fields)).digest("hex"),
  };
}

function evidence(contentHash?: string) {
  return {
    contractVersion: "research-evidence.v1" as const,
    decision: "searched" as const,
    reason: "최신 근거 필요",
    queries: ["브랜드 운영 최신 동향"],
    capturedAt: "2026-08-05T01:00:00.000Z",
    items: [evidenceItem(contentHash)],
  };
}

function composedInput() {
  const { contractVersion: _contractVersion, ...fields } = baseInput;
  return {
    ...fields,
    contractVersion: "proposal-input.v2" as const,
    researchEvidence: evidence(),
  };
}

function proposal(conceptKey: string) {
  const suffix = conceptKey.at(-1) ?? "a";
  return {
    conceptKey,
    title: `구성안 ${suffix}`,
    informationalType: "how_to",
    oneLineIntent: `의도 ${suffix}`,
    differentiator: `차별점 ${suffix}`,
    differentiationAxes: ["narrative"],
    target: "창업자",
    customerContext: "운영 시작",
    keyMessage: `메시지 ${suffix}`,
    hook: `훅 ${suffix}`,
    selectionReason: `이유 ${suffix}`,
    evidenceIds: [ids.evidence],
    referenceIds: [],
    outputFormat: "reel",
    channelTargets: ["instagram"],
    assetCount: 1,
    outline: [{ index: 1, role: "hook", headline: `제목 ${suffix}`, purpose: `목적 ${suffix}` }],
    purposeDetails: {
      kind: "informational",
      question: `질문 ${suffix}`,
      value: `가치 ${suffix}`,
      whyNow: `시점 ${suffix}`,
      learningPoints: [`학습 ${suffix}`],
    },
  };
}

function proposalSet() {
  return {
    contractVersion: "content-proposal.v2",
    proposals: [proposal("concept-a"), proposal("concept-b"), proposal("concept-c")],
  };
}

function contractColumns(overrides: Record<string, unknown> = {}) {
  return {
    contract_id: ids.contract,
    request_contract_version: "content-proposal-request.v2",
    base_input_contract_version: "proposal-base-input.v2",
    research_contract_version: "research-evidence.v1",
    proposal_contract_version: "content-proposal.v2",
    proposal_prompt_version: "proposal.writer.v2",
    proposal_output_schema_sha256: sha,
    proposal_model_id: "gpt-5.6-terra",
    command_descriptor_sha256: sha,
    request_sha256: proposalSha256(request),
    base_input_sha256: proposalSha256(baseInput),
    contract_source_sha256: sha,
    catalog_sha256: sha,
    enqueue_contract_sha256: sha,
    ...overrides,
  };
}

function claimRow(stage: "research" | "model", overrides: Record<string, unknown> = {}) {
  return {
    id: ids.job,
    workspace_id: ids.workspace,
    brand_id: ids.brand,
    batch_id: ids.batch,
    status: "queued",
    active_stage: null,
    attempt_count: 0,
    max_attempts: 3,
    lease_owner: null,
    lease_token: null,
    lease_started_at: null,
    lease_expires_at: null,
    available_at: new Date("2026-08-05T00:00:00.000Z"),
    purpose: "informational",
    request_json: request,
    input_snapshot_json: {
      baseInput,
      replayFingerprint: request.requestFingerprint,
      resumeInput: {},
    },
    composition_id: stage === "model" ? ids.composition : null,
    research_evidence_set_sha256: stage === "model" ? sha : null,
    composed_input_json: stage === "model" ? composedInput() : null,
    composed_input_sha256: stage === "model" ? sha : null,
    final_invocation_aggregate_sha256: stage === "model" ? sha : null,
    ...contractColumns(),
    ...overrides,
  };
}

function claimFixture(stage: "research" | "model", overrides: Record<string, unknown> = {}) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const initial = claimRow(stage, overrides);
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    statements.push({ sql, params });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
    if (sql.includes("set status='queued'") && sql.includes("lease_expires_at<=clock_timestamp()")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("for update of job,batch skip locked")) return { rows: [{ ...initial }], rowCount: 1 };
    if (sql.includes("set status='processing'") && sql.includes("returning *")) {
      const model = params[1] === "model";
      return {
        rows: [{
          ...initial,
          status: "processing",
          active_stage: params[1],
          attempt_count: model ? 1 : 0,
          lease_owner: params[2],
          lease_token: params[3],
          lease_started_at: new Date("2026-08-05T00:01:00.000Z"),
          lease_expires_at: new Date("2026-08-05T00:04:00.000Z"),
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("insert into ai_content_proposal_research_attempts")) {
      return { rows: [{ id: ids.researchAttempt, attempt_number: 1 }], rowCount: 1 };
    }
    if (sql.includes("insert into ai_content_proposal_model_attempts")) {
      return { rows: [{ id: ids.modelAttempt, attempt_number: 1 }], rowCount: 1 };
    }
    if (sql.includes("append_ai_content_proposal_research_attempt_event")) {
      return { rows: [{ event_sha256: sha }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn(async () => client), query } as unknown as Pool;
  return { repository: createContentProposalJobsRepository(pool), statements };
}

describe("content proposal job V2 claim protocol", () => {
  it("contains no planner-dependent job-first append prelocks", () => {
    const source = readFileSync(new URL("./contentProposalJobs.ts", import.meta.url), "utf8");
    const jobFirstLocks = [...source.matchAll(/for update of\s+job[^\n`]*/gi)].map(([match]) => match);
    expect(jobFirstLocks).toEqual(["for update of job,batch skip locked limit 1"]);
  });

  it("claims research without consuming a model attempt and returns the frozen base input", async () => {
    const fixture = claimFixture("research");

    const claimed = await fixture.repository.claimContentProposalJob({
      workerId: "proposal-worker-1",
      leaseSeconds: 180,
    });

    expect(claimed).toMatchObject({
      id: ids.job,
      stage: "research_required",
      attemptCount: 0,
      researchAttemptId: ids.researchAttempt,
      researchAttemptNumber: 1,
      baseInput,
      request,
      contract: { id: ids.contract, modelId: "gpt-5.6-terra" },
    });
    const claimUpdate = fixture.statements.find(({ sql }) => sql.includes("set status='processing'"));
    expect(claimUpdate?.sql).toContain("case when $2='model' then 1 else 0 end");
    expect(claimUpdate?.sql).toContain("least($5::integer,300)");
  });

  it("claims a sealed composition as a model attempt with all aggregate hashes", async () => {
    const fixture = claimFixture("model");

    const claimed = await fixture.repository.claimContentProposalJob({
      workerId: "proposal-worker-1",
      leaseSeconds: 180,
    }) as Extract<ContentProposalJobRecord, { stage: "composition_ready" }>;

    expect(claimed).toMatchObject({
      stage: "composition_ready",
      attemptCount: 1,
      modelAttemptId: ids.modelAttempt,
      modelAttemptNumber: 1,
      compositionId: ids.composition,
      composedInput: { contractVersion: "proposal-input.v2" },
      evidenceSetSha256: sha,
      composedInputSha256: sha,
      finalInvocationAggregateSha256: sha,
      modelSha256: proposalSha256({ modelId: "gpt-5.6-terra" }),
    });
  });

  it("rejects a tampered frozen request before creating an attempt", async () => {
    const fixture = claimFixture("research", {
      request_json: { ...request, requestFingerprint: "e".repeat(64) },
    });

    await expect(fixture.repository.claimContentProposalJob({
      workerId: "proposal-worker-1",
      leaseSeconds: 180,
    })).rejects.toThrow("content_proposal_claim_contract_mismatch");

    expect(fixture.statements.some(({ sql }) => sql.includes("insert into ai_content_proposal_research_attempts")))
      .toBe(false);
  });

  it("writes bounded failure evidence before reclaiming expired research and zero-event model leases", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("from ai_content_proposal_research_attempts attempt")
        && sql.includes("order by job.lease_expires_at")) {
        return { rows: [{ id: ids.researchAttempt }], rowCount: 1 };
      }
      if (sql.includes("select job.lease_token,job.max_attempts,attempt.attempt_number")) {
        return { rows: [{ lease_token: ids.lease, max_attempts: 3, attempt_number: 1 }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_proposal_model_attempts attempt")
        && sql.includes("order by job.lease_expires_at")) {
        return { rows: [{ id: ids.modelAttempt }], rowCount: 1 };
      }
      if (sql.includes("select attempt.id,attempt.job_id") && sql.includes("for update")) {
        const attemptId = String(params[0]);
        return { rows: [{ id: attemptId, job_id: ids.job }], rowCount: 1 };
      }
      if (sql.includes("select id,batch_id,workspace_id,brand_id") && sql.includes("for update")) {
        return { rows: [{ id: ids.job, batch_id: ids.batch, workspace_id: ids.workspace, brand_id: ids.brand }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_proposal_batches") && sql.includes("for update")) {
        return { rows: [{ id: ids.batch }], rowCount: 1 };
      }
      if (sql.includes("select job.id job_id,job.lease_token")) {
        return {
          rows: [{
            lease_token: ids.lease, max_attempts: 3, attempt_number: 2,
            event_sequence: null, event_type: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("for update of job,batch skip locked")) return { rows: [], rowCount: 0 };
      if (sql.includes("for update")) return { rows: [{ id: params[0] }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() };
    const repository = createContentProposalJobsRepository({
      connect: vi.fn(async () => client), query,
    } as unknown as Pool);

    await expect(repository.claimContentProposalJob({
      workerId: "proposal-worker-reclaimer", leaseSeconds: 180,
    })).resolves.toBeNull();

    const researchAppend = statements.find(({ sql }) =>
      sql.includes("append_ai_content_proposal_research_attempt_event"));
    const researchFailure = JSON.parse(String(researchAppend?.params[2]));
    expect(researchFailure).toEqual({
      errorCode: "research_lease_expired",
      errorMessage: "research lease expired before evidence commit",
      retryable: true,
    });
    const modelAppend = statements.find(({ sql }) =>
      sql.includes("'pre_invocation_failed'") && sql.includes("model_lease_expired"));
    expect(modelAppend?.params).toEqual([ids.modelAttempt, ids.lease, true]);
    const modelAttemptLock = statements.findIndex(({ sql }) => (
      sql.includes("from ai_content_proposal_model_attempts") && sql.includes("for update")
    ));
    const modelAdvisoryLock = statements.findIndex(({ sql }, index) => (
      index > modelAttemptLock && sql.includes("pg_advisory_xact_lock")
    ));
    const modelJobLock = statements.findIndex(({ sql }, index) => (
      index > modelAdvisoryLock && sql.includes("from ai_content_proposal_jobs") && sql.includes("for update")
    ));
    const modelBatchLock = statements.findIndex(({ sql }, index) => (
      index > modelJobLock && sql.includes("from ai_content_proposal_batches") && sql.includes("for update")
    ));
    const modelAppendIndex = statements.indexOf(modelAppend!);
    expect(modelAttemptLock).toBeGreaterThanOrEqual(0);
    expect(modelAdvisoryLock).toBeGreaterThan(modelAttemptLock);
    expect(modelJobLock).toBeGreaterThan(modelAdvisoryLock);
    expect(modelBatchLock).toBeGreaterThan(modelJobLock);
    expect(modelAppendIndex).toBeGreaterThan(modelBatchLock);
    const broadReclaim = statements.findIndex(({ sql }) =>
      sql.includes("set status='queued'") && sql.includes("lease_expires_at<=clock_timestamp()"));
    expect(broadReclaim).toBeGreaterThan(statements.indexOf(researchAppend!));
    expect(broadReclaim).toBeGreaterThan(statements.indexOf(modelAppend!));
  });

  it("terminalizes an expired parser-invalid invocation using the stored terminal hashes", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("from ai_content_proposal_research_attempts attempt")
        && sql.includes("order by job.lease_expires_at")) return { rows: [], rowCount: 0 };
      if (sql.includes("from ai_content_proposal_model_attempts attempt")
        && sql.includes("order by job.lease_expires_at")) {
        return { rows: [{ id: ids.modelAttempt }], rowCount: 1 };
      }
      if (sql.includes("select job.id job_id,job.lease_token")) {
        return {
          rows: [{
            lease_token: ids.lease, max_attempts: 3, attempt_number: 3,
            event_sequence: 2, event_type: "invocation_completed", invocation_ordinal: 1,
            transcript_sha256: "b".repeat(64), output_sha256: "c".repeat(64),
            parser_sha256: "d".repeat(64), parser_valid: false,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("for update of job,batch skip locked")) return { rows: [], rowCount: 0 };
      if (sql.includes("for update")) return { rows: [{ id: params[0] }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() };
    const repository = createContentProposalJobsRepository({
      connect: vi.fn(async () => client), query,
    } as unknown as Pool);

    await expect(repository.claimContentProposalJob({
      workerId: "proposal-worker-reclaimer", leaseSeconds: 180,
    })).resolves.toBeNull();

    const append = statements.find(({ sql }) => sql.includes("'attempt_failed'")
      && sql.includes("ai_content_proposal_model_attempts"));
    expect(append?.params).toEqual([
      ids.modelAttempt, ids.lease, 3, 1,
      "b".repeat(64), "c".repeat(64), "d".repeat(64),
    ]);
  });
});

describe("content proposal research boundary", () => {
  it("rejects a research item whose contentHash does not match its canonical observed fields", async () => {
    const connect = vi.fn(async () => { throw new Error("unexpected_database_access"); });
    const repository = createContentProposalJobsRepository({ connect } as unknown as Pool);

    await expect(repository.completeContentProposalResearch({
      jobId: ids.job,
      workerId: "proposal-worker-1",
      leaseToken: ids.lease,
      researchAttemptId: ids.researchAttempt,
      evidence: evidence("0".repeat(64)),
    })).rejects.toThrow("content_proposal_research_invalid");

    expect(connect).not.toHaveBeenCalled();
  });

  it("seals research through the 075 function and returns the immutable composition identity", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const row = claimRow("research", {
      status: "processing",
      active_stage: "research",
      lease_owner: "proposal-worker-1",
      lease_token: ids.lease,
      lease_started_at: new Date("2026-08-05T00:00:00.000Z"),
      lease_expires_at: new Date("2099-08-05T00:05:00.000Z"),
      research_attempt_id: ids.researchAttempt,
      attempt_number: 1,
      research_worker_id: "proposal-worker-1",
      token_matches: true,
      evidence_json: null,
    });
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("select attempt.id,attempt.job_id") && sql.includes("for update")) {
        return { rows: [{ id: ids.researchAttempt, job_id: ids.job }], rowCount: 1 };
      }
      if (sql.includes("select id,batch_id,workspace_id,brand_id") && sql.includes("for update")) {
        return { rows: [{ id: ids.job, batch_id: ids.batch, workspace_id: ids.workspace, brand_id: ids.brand }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_proposal_batches") && sql.includes("for update")) {
        return { rows: [{ id: ids.batch }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_proposal_jobs job") && sql.includes("research_attempt_id")) {
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes("evidence_sha256") && sql.includes("composed_sha256")) {
        return { rows: [{ evidence_sha256: "b".repeat(64), composed_sha256: "c".repeat(64) }], rowCount: 1 };
      }
      if (sql.includes("insert into ai_content_proposal_research_snapshots")) {
        return { rows: [{ id: "d0000000-0000-4000-8000-00000000000d" }], rowCount: 1 };
      }
      if (sql.includes("complete_ai_content_proposal_research")) {
        return { rows: [{ id: ids.composition }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const repository = createContentProposalJobsRepository({
      connect: vi.fn(async () => client), query,
    } as unknown as Pool);

    const result = await repository.completeContentProposalResearch({
      jobId: ids.job,
      workerId: "proposal-worker-1",
      leaseToken: ids.lease,
      researchAttemptId: ids.researchAttempt,
      evidence: evidence(),
    });

    expect(result).toMatchObject({
      jobId: ids.job,
      batchId: ids.batch,
      status: "queued",
      compositionId: ids.composition,
      composedInput: { contractVersion: "proposal-input.v2" },
      evidenceSetSha256: "b".repeat(64),
      composedInputSha256: "c".repeat(64),
    });
    expect(statements.some(({ sql }) => sql.includes("complete_ai_content_proposal_research"))).toBe(true);
    const attemptLock = statements.findIndex(({ sql }) => (
      sql.includes("from ai_content_proposal_research_attempts") && sql.includes("for update")
    ));
    const advisoryLock = statements.findIndex(({ sql }) => sql.includes("pg_advisory_xact_lock"));
    const jobLock = statements.findIndex(({ sql }, index) => (
      index > advisoryLock && sql.includes("from ai_content_proposal_jobs") && sql.includes("for update")
    ));
    const batchLock = statements.findIndex(({ sql }, index) => (
      index > jobLock && sql.includes("from ai_content_proposal_batches") && sql.includes("for update")
    ));
    expect(attemptLock).toBeGreaterThanOrEqual(0);
    expect(advisoryLock).toBeGreaterThan(attemptLock);
    expect(jobLock).toBeGreaterThan(advisoryLock);
    expect(batchLock).toBeGreaterThan(jobLock);
  });
});

describe("content proposal model terminal protocol", () => {
  it("maps stored-function lease failures to the worker lease domain error", async () => {
    const query = vi.fn(async () => {
      throw new Error("proposal_model_lease_mismatch");
    });
    const repository = createContentProposalJobsRepository({ query } as unknown as Pool);

    await expect(repository.startContentProposalInvocation({
      jobId: ids.job,
      workerId: "proposal-worker-1",
      leaseToken: ids.lease,
      modelAttemptId: ids.modelAttempt,
      invocationOrdinal: 1,
    })).rejects.toThrow("content_proposal_job_lease_invalid");
  });

  it("atomically terminalizes a parser-invalid repair invocation and projects the batch failure", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    let appendCount = 0;
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("append_ai_content_proposal_attempt_event")) {
        appendCount += 1;
        return { rows: [{ event_sha256: appendCount === 1 ? "b".repeat(64) : "c".repeat(64), job_id: ids.job }], rowCount: 1 };
      }
      if (sql === "select status from ai_content_proposal_jobs where id=$1") {
        return { rows: [{ status: "failed" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const repository = createContentProposalJobsRepository({
      connect: vi.fn(async () => client),
      query,
    } as unknown as Pool);

    await expect(repository.recordContentProposalInvocationTerminal({
      jobId: ids.job,
      workerId: "proposal-worker-1",
      leaseToken: ids.lease,
      modelAttemptId: ids.modelAttempt,
      invocationOrdinal: 2,
      eventType: "invocation_completed",
      transcriptSha256: "d".repeat(64),
      outputSha256: "e".repeat(64),
      parserSha256: "f".repeat(64),
      parserValid: false,
    })).resolves.toMatchObject({ status: "failed" });

    const appends = statements.filter(({ sql }) => sql.includes("append_ai_content_proposal_attempt_event"));
    expect(appends).toHaveLength(2);
    expect(appends[1]?.sql).toContain("'attempt_failed'");
    expect(appends[1]?.params).toEqual(expect.arrayContaining([
      "d".repeat(64), "e".repeat(64), "f".repeat(64), false,
    ]));
    expect(statements.some(({ sql }) => sql.includes("update ai_content_proposal_batches")
      && sql.includes("status='failed'"))).toBe(true);
  });

  it("completes only from a parser-valid invocation and persists exactly three suggestions", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const row = claimRow("model", {
      status: "processing",
      active_stage: "model",
      lease_owner: "proposal-worker-1",
      lease_token: ids.lease,
      model_attempt_id: ids.modelAttempt,
      model_worker_id: "proposal-worker-1",
      terminal_event_sequence: null,
      terminal_invocation_ordinal: null,
      terminal_transcript_sha256: null,
      terminal_output_sha256: null,
      terminal_parser_sha256: null,
      terminal_parser_valid: null,
      succeeded_event_id: null,
      completion_lease_owner: null,
      completion_lease_token: null,
    });
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("select attempt.id,attempt.job_id") && sql.includes("for update")) {
        return { rows: [{ id: ids.modelAttempt, job_id: ids.job }], rowCount: 1 };
      }
      if (sql.includes("select id,batch_id,workspace_id,brand_id") && sql.includes("for update")) {
        return { rows: [{ id: ids.job, batch_id: ids.batch, workspace_id: ids.workspace, brand_id: ids.brand }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_proposal_batches") && sql.includes("for update")) {
        return { rows: [{ id: ids.batch }], rowCount: 1 };
      }
      if (sql.includes("terminal_event_sequence") && sql.includes("from ai_content_proposal_jobs job")) {
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes("insert into ai_content_proposals")) return { rows: [], rowCount: 3 };
      return { rows: [{ event_sha256: sha }], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const repository = createContentProposalJobsRepository({
      connect: vi.fn(async () => client), query,
    } as unknown as Pool);

    await expect(repository.completeContentProposalJob({
      jobId: ids.job,
      workerId: "proposal-worker-1",
      leaseToken: ids.lease,
      modelAttemptId: ids.modelAttempt,
      invocationOrdinal: 1,
      transcriptSha256: "b".repeat(64),
      outputSha256: "c".repeat(64),
      parserSha256: "d".repeat(64),
      proposalSet: proposalSet(),
    })).resolves.toEqual({
      jobId: ids.job,
      batchId: ids.batch,
      status: "completed",
      invocationEventSha256: sha,
      attemptEventSha256: sha,
    });

    const insert = statements.find(({ sql }) => sql.includes("insert into ai_content_proposals"));
    expect(insert?.sql).toContain("with ordinality");
    expect(JSON.parse(String(insert?.params[1]))).toHaveLength(3);
    const eventAppends = statements.filter(({ sql }) => sql.includes("append_ai_content_proposal_attempt_event"));
    expect(eventAppends).toHaveLength(2);
    expect(eventAppends[0]?.sql).toContain("'invocation_completed'");
    expect(statements.some(({ sql }) => sql.includes("'attempt_succeeded'"))).toBe(true);
    expect(statements.some(({ sql }) => sql.includes("update ai_content_proposal_batches")
      && sql.includes("status='ready'"))).toBe(true);
    const attemptLock = statements.findIndex(({ sql }) => (
      sql.includes("from ai_content_proposal_model_attempts") && sql.includes("for update")
    ));
    const advisoryLock = statements.findIndex(({ sql }) => sql.includes("pg_advisory_xact_lock"));
    const jobLock = statements.findIndex(({ sql }, index) => (
      index > advisoryLock && sql.includes("from ai_content_proposal_jobs") && sql.includes("for update")
    ));
    const batchLock = statements.findIndex(({ sql }, index) => (
      index > jobLock && sql.includes("from ai_content_proposal_batches") && sql.includes("for update")
    ));
    expect(attemptLock).toBeGreaterThanOrEqual(0);
    expect(advisoryLock).toBeGreaterThan(attemptLock);
    expect(jobLock).toBeGreaterThan(advisoryLock);
    expect(batchLock).toBeGreaterThan(jobLock);
  });

  it("replays an exact atomic completion and rejects changed completion evidence", async () => {
    const invocationEventSha256 = "e".repeat(64);
    const attemptEventSha256 = "f".repeat(64);
    const row = claimRow("model", {
      status: "completed",
      active_stage: null,
      lease_owner: null,
      lease_token: null,
      model_attempt_id: ids.modelAttempt,
      model_worker_id: "proposal-worker-1",
      terminal_event_sequence: 2,
      terminal_invocation_ordinal: 1,
      terminal_transcript_sha256: "b".repeat(64),
      terminal_output_sha256: "c".repeat(64),
      terminal_parser_sha256: "d".repeat(64),
      terminal_parser_valid: true,
      terminal_event_sha256: invocationEventSha256,
      succeeded_event_id: "f0000000-0000-4000-8000-00000000000f",
      succeeded_event_sha256: attemptEventSha256,
      completion_lease_owner: "proposal-worker-1",
      completion_lease_token: ids.lease,
    });
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("select attempt.id,attempt.job_id") && sql.includes("for update")) {
        return { rows: [{ id: params[0], job_id: ids.job }], rowCount: 1 };
      }
      if (sql.includes("select id,batch_id,workspace_id,brand_id") && sql.includes("for update")) {
        return { rows: [{ id: ids.job, batch_id: ids.batch, workspace_id: ids.workspace, brand_id: ids.brand }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_proposal_batches") && sql.includes("for update")) {
        return { rows: [{ id: ids.batch }], rowCount: 1 };
      }
      if (sql.includes("terminal_event_sequence") && sql.includes("from ai_content_proposal_jobs job")) {
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes("select position,proposal_json")) {
        return {
          rows: proposalSet().proposals.map((item, index) => ({ position: index + 1, proposal_json: item })),
          rowCount: 3,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() };
    const repository = createContentProposalJobsRepository({
      connect: vi.fn(async () => client), query,
    } as unknown as Pool);
    const identity = {
      jobId: ids.job, workerId: "proposal-worker-1", leaseToken: ids.lease,
      modelAttemptId: ids.modelAttempt, invocationOrdinal: 1 as const,
      transcriptSha256: "b".repeat(64), outputSha256: "c".repeat(64),
      parserSha256: "d".repeat(64), proposalSet: proposalSet(),
    };

    await expect(repository.completeContentProposalJob(identity)).resolves.toEqual({
      jobId: ids.job, batchId: ids.batch, status: "completed",
      invocationEventSha256, attemptEventSha256,
    });
    await expect(repository.completeContentProposalJob({
      ...identity, outputSha256: "9".repeat(64),
    })).rejects.toThrow("content_proposal_completion_conflict");
  });
});

describe("content proposal pre-invocation failure protocol", () => {
  function failureFixture(
    stage: "research" | "model",
    attemptCount = 1,
    modelEventExists = false,
    failureTerminal: boolean | null = null,
  ) {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    let projectedStatus: "queued" | "failed" = "queued";
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("select attempt.id,attempt.job_id") && sql.includes("for update")) {
        return { rows: [{ id: params[0], job_id: ids.job }], rowCount: 1 };
      }
      if (sql.includes("select id,batch_id,workspace_id,brand_id") && sql.includes("for update")) {
        return { rows: [{ id: ids.job, batch_id: ids.batch, workspace_id: ids.workspace, brand_id: ids.brand }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_proposal_batches") && sql.includes("for update")) {
        return { rows: [{ id: ids.batch }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_proposal_jobs job") && sql.includes("attempt_id")) {
        return {
          rows: [{
            id: ids.job,
            batch_id: ids.batch,
            status: "processing",
            active_stage: stage,
            lease_owner: "proposal-worker-1",
            lease_token: ids.lease,
            lease_expires_at: new Date("2099-08-05T00:05:00.000Z"),
            attempt_count: attemptCount,
            attempt_number: attemptCount,
            max_attempts: 3,
            attempt_worker_id: "proposal-worker-1",
            token_matches: true,
            model_event_exists: modelEventExists,
            failure_event_exists: failureTerminal !== null,
            failure_terminal: failureTerminal,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("append_ai_content_proposal_research_attempt_event")) {
        const envelope = JSON.parse(String(params.find((value) => typeof value === "string" && value.startsWith("{"))));
        if (failureTerminal === null) projectedStatus = envelope.retryable ? "queued" : "failed";
        return { rows: [{ event_sha256: sha }], rowCount: 1 };
      }
      if (sql.includes("append_ai_content_proposal_attempt_event")) {
        const retryable = params.includes(true);
        if (failureTerminal === null) projectedStatus = retryable && attemptCount < 3 ? "queued" : "failed";
        return { rows: [{ event_sha256: sha }], rowCount: 1 };
      }
      if (sql.includes("select id,batch_id,status") && sql.includes("ai_content_proposal_jobs")) {
        return { rows: [{ id: ids.job, batch_id: ids.batch, status: projectedStatus }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const repository = createContentProposalJobsRepository({
      connect: vi.fn(async () => client), query,
    } as unknown as Pool);
    return { repository, statements };
  }

  it("records a permanent research failure with the exact canonical failure envelope", async () => {
    const fixture = failureFixture("research");

    await expect(fixture.repository.failContentProposalJob({
      jobId: ids.job,
      workerId: "proposal-worker-1",
      leaseToken: ids.lease,
      stage: "research_required",
      attemptId: ids.researchAttempt,
      errorCode: "research_unavailable",
      errorMessage: "provider unavailable",
      retryable: false,
    })).resolves.toEqual({ id: ids.job, batchId: ids.batch, status: "failed" });

    const append = fixture.statements.find(({ sql }) => sql.includes("append_ai_content_proposal_research_attempt_event"));
    expect(append?.sql).toContain("'attempt_failed'");
    expect(append?.sql).toContain("digest");
    expect(append?.params).toContain(JSON.stringify({
      errorCode: "research_unavailable",
      errorMessage: "provider unavailable",
      retryable: false,
    }));
  });

  it("records final retryable model pre-spawn exhaustion without fabricating an invocation", async () => {
    const fixture = failureFixture("model", 3);

    await expect(fixture.repository.failContentProposalJob({
      jobId: ids.job,
      workerId: "proposal-worker-1",
      leaseToken: ids.lease,
      stage: "composition_ready",
      attemptId: ids.modelAttempt,
      errorCode: "model_spawn_failed",
      errorMessage: "worker could not start model",
      retryable: true,
    })).resolves.toEqual({ id: ids.job, batchId: ids.batch, status: "failed" });

    const append = fixture.statements.find(({ sql }) => sql.includes("append_ai_content_proposal_attempt_event"));
    expect(append?.sql).toContain("'pre_invocation_failed'");
    expect(append?.params).toEqual(expect.arrayContaining([
      0, "model_spawn_failed", "worker could not start model", true,
    ]));
    expect(fixture.statements.some(({ sql }) => sql.includes("'invocation_started'"))).toBe(false);
  });

  it("rejects pre-spawn failure as soon as any model event may have landed", async () => {
    const fixture = failureFixture("model", 1, true);

    await expect(fixture.repository.failContentProposalJob({
      jobId: ids.job,
      workerId: "proposal-worker-1",
      leaseToken: ids.lease,
      stage: "composition_ready",
      attemptId: ids.modelAttempt,
      errorCode: "model_spawn_failed",
      errorMessage: "uncertain start",
      retryable: true,
    })).rejects.toThrow("content_proposal_invocation_already_started");

    expect(fixture.statements.some(({ sql }) => sql.includes("append_ai_content_proposal_attempt_event")))
      .toBe(false);
  });

  it("replays the original nonterminal failure outcome after later attempts consume the retry budget", async () => {
    const fixture = failureFixture("model", 3, true, false);

    await expect(fixture.repository.failContentProposalJob({
      jobId: ids.job,
      workerId: "proposal-worker-1",
      leaseToken: ids.lease,
      stage: "composition_ready",
      attemptId: ids.modelAttempt,
      errorCode: "model_spawn_failed",
      errorMessage: "retry later",
      retryable: true,
    })).resolves.toEqual({ id: ids.job, batchId: ids.batch, status: "queued" });
  });
});
