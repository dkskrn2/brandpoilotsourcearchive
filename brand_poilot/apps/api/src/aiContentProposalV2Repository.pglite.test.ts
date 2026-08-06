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
      proposal_prompt_version: "proposal.writer.v2",
      proposal_model_id: "gpt-5.6-terra",
      proposal_output_schema_sha256: "54bf063cf32926874af6b098272df08d41a9e7d7f578ee6560debe44428cf5f3",
      contract_source_sha256: "f1e754cb2c2664ef21f41597a45b2ed424ebc040b949f5bf4cece251195ab5f8",
      catalog_sha256: "94c6622ce5c5ef74b9d011dd0d35035f0f0b5580160dc2a2264b08030a5724fb",
    });
    expect(row).not.toHaveProperty("content_family");
    expect(row.request_json).toEqual(enqueueInput().workerRequest);
    expect(row.input_snapshot_json).toMatchObject({
      replayFingerprint: enqueueInput().replayFingerprint,
      baseInput: enqueueInput().baseInput,
      resumeInput: enqueueInput().request,
    });
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
    });
    await repository.withTransaction((tx) => repository.enqueue(tx, input));

    await expect(repository.findCommittedReplay(input)).resolves.toMatchObject({
      disposition: "replayed",
      status: "proposal_pending",
    });
    await expect(repository.findCommittedReplay({ ...input, replayFingerprint: "c".repeat(64) }))
      .rejects.toThrow("ai_content_proposal_batch_conflict");
  });
});
