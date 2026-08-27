import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAiContentProposalV2Repository,
  type ProposalV2Repository,
} from "./aiContentRepository.js";
import type { EnqueueProposalV2Input } from "./aiContentProposalV2Service.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  brand: "20000000-0000-4000-8000-000000000002",
  actor: "30000000-0000-4000-8000-000000000003",
};

function pglitePool(database: PGlite): Pool {
  async function query(sql: string, values: unknown[] = []) {
    const result = await database.query(sql, values as never[]);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.rows.length || Number(result.affectedRows ?? 0),
    };
  }
  return {
    query,
    async connect() {
      return { query, release() {} };
    },
  } as unknown as Pool;
}

function enqueueInput(overrides: Partial<EnqueueProposalV2Input> = {}): EnqueueProposalV2Input {
  const replayFingerprint = "a".repeat(64);
  return {
    source: "manual",
    workspaceId: ids.workspace,
    brandId: ids.brand,
    actorUserId: ids.actor,
    idempotencyKey: "proposal-v2-pglite",
    replayFingerprint,
    request: {
      contractVersion: "content-orchestration.v2",
      brandId: ids.brand,
      purpose: "informational",
      seed: { kind: "topic_text", title: "릴스 주제" },
      contentInstruction: null,
      productId: null,
      outputSettings: {
        outputFormat: "reel",
        channelTargets: ["instagram"],
        aspectRatio: "9:16",
        outputCount: 1,
      },
    },
    workerRequest: {
      contractVersion: "content-proposal-request.v2",
      purpose: "informational",
      outputFormat: "reel",
      channelTargets: ["instagram"],
      requestFingerprint: replayFingerprint,
    },
    baseInput: {
      contractVersion: "proposal-base-input.v2",
      brandCore: {
        versionId: "40000000-0000-4000-8000-000000000004",
        companyOverview: "브랜드 개요",
        businessDescription: "사업 설명",
        primaryCategory: "패션",
        detailedCategory: "지속가능 패션",
        primaryTarget: "의식 있는 소비자",
        differentiator: "검증된 공급망",
        coreAppeal: "투명성",
      },
      subject: { kind: "topic_text", title: "릴스 주제" },
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
    },
    sourceSnapshots: [],
    researchSourceAcquisition: {
      contractVersion: "research-source-acquisition.v1",
      status: "not_applicable",
      requestedUrl: null,
      canonicalUrl: null,
      contentHash: null,
      capturedAt: "2026-08-05T00:00:00.000Z",
    },
    proposalRunId: null,
    performanceAudit: null,
    ...overrides,
  };
}

describe("Proposal V2 repository on the final purpose/job-contract schema", () => {
  let database: PGlite;
  let repository: ProposalV2Repository;

  beforeEach(async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    await database.exec(`
      create extension if not exists pgcrypto;
      create table app_users(id uuid primary key);
      create table workspaces(id uuid primary key);
      create table brands(id uuid primary key, workspace_id uuid not null, unique(id,workspace_id));
      create table workspace_members(
        workspace_id uuid not null,user_id uuid not null,status text not null,deleted_at timestamptz null
      );
      create function assert_ai_content_writable() returns void language plpgsql as $$ begin return; end $$;
      create table ai_content_proposal_batches(
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        origin text not null check(origin in ('manual','scheduled_crawl')),
        purpose text not null check(purpose in ('informational','marketing')),
        request_json jsonb not null, source_snapshot_json jsonb not null,
        input_snapshot_json jsonb not null, status text not null default 'queued',
        idempotency_key text not null, created_by_user_id uuid null,
        error_code text null,error_message text null,created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(workspace_id,brand_id,idempotency_key), unique(id,workspace_id,brand_id)
      );
      create table ai_content_proposal_jobs(
        id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
        batch_id uuid not null,status text not null default 'queued',attempt_count int not null default 0,
        max_attempts int not null default 3,available_at timestamptz not null default now(),
        created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
        unique(id,batch_id,workspace_id,brand_id)
      );
      create table ai_content_proposal_job_contracts(
        id uuid primary key default gen_random_uuid(), job_id uuid not null unique,batch_id uuid not null,
        workspace_id uuid not null,brand_id uuid not null,request_contract_version text not null,
        base_input_contract_version text not null,research_contract_version text not null,
        proposal_contract_version text not null,proposal_prompt_version text not null,
        proposal_output_schema_sha256 text not null,proposal_model_id text not null,
        command_descriptor_sha256 text not null,request_sha256 text not null,
        base_input_sha256 text not null,contract_source_sha256 text not null,
        catalog_sha256 text not null,enqueue_contract_sha256 text not null
      );
      create table ai_content_proposal_performance_audits(
        id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
        batch_id uuid not null unique,experiment_id uuid not null,experiment_definition_json jsonb not null,
        evidence_version text not null,resolved_input_fingerprint_sha256 text not null,
        snapshot_audit_json jsonb not null,captured_from timestamptz not null,captured_to timestamptz not null
      );
      create table ai_content_proposal_research_snapshots(
        id uuid primary key default gen_random_uuid(),workspace_id uuid not null,brand_id uuid not null,
        batch_id uuid not null unique,evidence_json jsonb not null
      );
      create table ai_content_proposal_compositions(
        id uuid primary key default gen_random_uuid(),job_id uuid not null unique,batch_id uuid not null,
        contract_id uuid not null unique,performance_audit_id uuid null,workspace_id uuid not null,brand_id uuid not null,
        research_evidence_json jsonb not null,research_evidence_set_sha256 text not null,
        composed_input_json jsonb not null,composed_input_sha256 text not null,
        final_invocation_aggregate_sha256 text not null
      );
      create table automated_content_proposal_runs(
        id uuid primary key,proposal_batch_id uuid null,workspace_id uuid not null,brand_id uuid not null
      );
      insert into app_users values('${ids.actor}');
      insert into workspaces values('${ids.workspace}');
      insert into brands values('${ids.brand}','${ids.workspace}');
      insert into workspace_members values('${ids.workspace}','${ids.actor}','active',null);
    `);
    repository = createAiContentProposalV2Repository(pglitePool(database));
  }, 30_000);

  afterEach(async () => {
    await database?.close();
  }, 30_000);

  it("atomically enqueues one purpose batch, one job, and one immutable catalog contract", async () => {
    const created = await repository.withTransaction(async (tx) => {
      const input = enqueueInput();
      await repository.lockIdempotencyKey(tx, input);
      return repository.enqueue(tx, input);
    });

    expect(created).toMatchObject({ disposition: "created", status: "proposal_pending" });
    const graph = await database.query(`
      select batch.purpose,batch.request_json,batch.input_snapshot_json,
             job.id job_id,contract.*
        from ai_content_proposal_batches batch
        join ai_content_proposal_jobs job on job.batch_id=batch.id
        join ai_content_proposal_job_contracts contract on contract.job_id=job.id
    `);
    const row = graph.rows[0] as Record<string, unknown>;
    expect(graph.rows).toHaveLength(1);
    expect(row).toMatchObject({
      purpose: "informational",
      request_contract_version: "content-proposal-request.v2",
      base_input_contract_version: "proposal-base-input.v2",
      research_contract_version: "research-evidence.v1",
      proposal_contract_version: "content-proposal.v2",
      proposal_prompt_version: "proposal.writer.v5",
      proposal_model_id: "gpt-5.6-terra",
      proposal_output_schema_sha256: "54bf063cf32926874af6b098272df08d41a9e7d7f578ee6560debe44428cf5f3",
      contract_source_sha256: "e3ed513595242c4f79c1e5f50856d7df9ec16f722bb009c14c0fdc927710e727",
      catalog_sha256: "065400eafd2521fb096f36b8709da842b91823876c7fca11ba276a8283b7265f",
    });
    expect(row).not.toHaveProperty("content_family");
    expect(row.request_json).toEqual(enqueueInput().workerRequest);
    expect(row.input_snapshot_json).toMatchObject({
      replayFingerprint: enqueueInput().replayFingerprint,
      baseInput: enqueueInput().baseInput,
      resumeInput: enqueueInput().request,
      researchSourceAcquisition: enqueueInput().researchSourceAcquisition,
    });
    expect(Object.keys(row.input_snapshot_json as object).sort()).toEqual([
      "baseInput",
      "replayFingerprint",
      "researchSourceAcquisition",
      "resumeInput",
    ]);
    for (const field of [
      "command_descriptor_sha256", "request_sha256", "base_input_sha256", "enqueue_contract_sha256",
    ]) {
      expect(row[field]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("replays a scheduled batch with a null system actor using IS NOT DISTINCT FROM", async () => {
    const input = enqueueInput({
      source: "scheduled_crawl",
      actorUserId: null,
      idempotencyKey: "scheduled-v2-pglite",
      replayFingerprint: "b".repeat(64),
      workerRequest: { ...enqueueInput().workerRequest, requestFingerprint: "b".repeat(64) },
      researchSourceAcquisition: undefined,
    });
    await repository.withTransaction((tx) => repository.enqueue(tx, input));

    const scheduled = await database.query(
      "select input_snapshot_json from ai_content_proposal_batches where idempotency_key='scheduled-v2-pglite'",
    );
    expect(Object.keys((scheduled.rows[0] as Record<string, unknown>).input_snapshot_json as object).sort()).toEqual([
      "baseInput",
      "replayFingerprint",
      "resumeInput",
    ]);

    await expect(repository.findCommittedReplay(input)).resolves.toMatchObject({
      disposition: "replayed",
      status: "proposal_pending",
    });
    await expect(repository.findCommittedReplay({ ...input, replayFingerprint: "c".repeat(64) }))
      .rejects.toThrow("ai_content_proposal_batch_conflict");
  });

  it("stores a performance audit and precomposed public evidence in the same transaction", async () => {
    const input = enqueueInput();
    const researchEvidence = {
      contractVersion: "research-evidence.v1" as const,
      decision: "searched" as const,
      reason: "성과 근거",
      queries: [],
      capturedAt: input.baseInput.capturedAt,
      items: [{
        id: "70000000-0000-4000-8000-000000000007",
        title: "게시물",
        url: "https://example.test/post",
        publisher: "example.test",
        publishedAt: input.baseInput.capturedAt,
        capturedAt: input.baseInput.capturedAt,
        claimSummary: "성과가 확인된 공개 게시물",
        contentHash: "b".repeat(64),
      }],
    };
    const { contractVersion: _contractVersion, ...baseFields } = input.baseInput;
    const performanceInput = enqueueInput({
      source: "performance_experiment",
      idempotencyKey: "performance-v2-pglite",
      performanceAudit: {
        experimentId: "6f7772c4-7c03-4e2a-86f4-7c6bf3f65ef1",
        evidenceVersion: "c".repeat(64),
        experimentDefinition: { version: "reuse-performing-pattern.v2" },
        resolvedInputFingerprint: "d".repeat(64),
        snapshotAudit: { policyVersion: "performance-evidence.v2", snapshots: [{ id: researchEvidence.items[0].id }] },
        capturedFrom: input.baseInput.capturedAt,
        capturedTo: input.baseInput.capturedAt,
        researchEvidence,
        composedInput: {
          ...baseFields,
          contractVersion: "proposal-input.v2",
          researchEvidence,
        } as never,
      },
    });

    await repository.withTransaction((tx) => repository.enqueue(tx, performanceInput));

    const graph = await database.query(`
      select audit.snapshot_audit_json,research.evidence_json,composition.research_evidence_json,
             composition.research_evidence_set_sha256,composition.composed_input_sha256
      from ai_content_proposal_performance_audits audit
      join ai_content_proposal_research_snapshots research on research.batch_id=audit.batch_id
      join ai_content_proposal_compositions composition on composition.performance_audit_id=audit.id
    `);
    expect(graph.rows).toHaveLength(1);
    const row = graph.rows[0] as Record<string, unknown>;
    expect(row.research_evidence_json).toEqual([row.snapshot_audit_json]);
    expect(row.evidence_json).toMatchObject({ contractVersion: "research-evidence.v1", decision: "searched" });
    expect(row.research_evidence_set_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.composed_input_sha256).toMatch(/^[0-9a-f]{64}$/);

    const mismatch = {
      ...performanceInput,
      idempotencyKey: "performance-v2-mismatch",
      performanceAudit: {
        ...performanceInput.performanceAudit!,
        composedInput: {
          ...performanceInput.performanceAudit!.composedInput!,
          contentInstruction: "research와 결합되지 않은 다른 입력",
        },
      },
    };
    await expect(repository.withTransaction((tx) => repository.enqueue(tx, mismatch)))
      .rejects.toThrow("ai_content_proposal_performance_composition_mismatch");
    const counts = await database.query(`
      select (select count(*)::int from ai_content_proposal_batches) batches,
             (select count(*)::int from ai_content_proposal_performance_audits) audits,
             (select count(*)::int from ai_content_proposal_compositions) compositions
    `);
    expect(counts.rows[0]).toMatchObject({ batches: 1, audits: 1, compositions: 1 });
  });
});
