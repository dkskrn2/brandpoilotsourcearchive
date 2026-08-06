import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ContentOrchestrationV2 } from "@brand-pilot/content-contracts";
import { createAiContentProposalV2Service } from "./aiContentProposalV2Service.js";
import { createAiContentProposalV2Repository, createAiContentRepository } from "./aiContentRepository.js";
import {
  createContentProposalJobsRepository,
  type ContentProposalModelClaim,
  type ContentProposalResearchClaim,
} from "./contentProposalJobs.js";

const ids = {
  actor: "10000000-0000-4000-8000-000000000001",
  workspace: "20000000-0000-4000-8000-000000000002",
  brand: "30000000-0000-4000-8000-000000000003",
  core: "40000000-0000-4000-8000-000000000004",
  evidence: "70000000-0000-4000-8000-000000000007",
};

async function applyMigrationsThrough075(pool: Pool) {
  const directory = resolve(process.cwd(), "../../db/migrations");
  const skipped = new Set([
    "021_dm_wiki_pgvector.sql",
    "027_wiki_search_v2.sql",
    "033_compounding_wiki_pgvector.sql",
  ]);
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".sql") && name <= "075_ai_content_three_format_cutover.sql")
    .sort();
  for (const file of files) {
    if (skipped.has(file)) continue;
    let sql = await readFile(resolve(directory, file), "utf8");
    if (file === "075_ai_content_three_format_cutover.sql") {
      const start = sql.indexOf("-- 075_FENCE_REGISTRATION_BEGIN");
      const endMarker = "-- 075_FENCE_REGISTRATION_END";
      const end = sql.indexOf(endMarker);
      if (start < 0 || end <= start) throw new Error("cutover_075_fence_markers_missing");
      sql = `${sql.slice(0, start)}${sql.slice(end + endMarker.length)}`;
    }
    await pool.query(sql);
  }
}

function request(): ContentOrchestrationV2 {
  return {
    contractVersion: "content-orchestration.v2",
    brandId: ids.brand,
    purpose: "informational",
    seed: { kind: "topic_text", title: "선택 lineage" },
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

function baseInput() {
  return {
    contractVersion: "proposal-base-input.v2" as const,
    brandCore: {
      versionId: ids.core,
      companyOverview: "브랜드 개요",
      businessDescription: "사업 설명",
      primaryCategory: "패션",
      detailedCategory: "지속가능 패션",
      primaryTarget: "의식 있는 소비자",
      differentiator: "검증된 공급망",
      coreAppeal: "투명성",
    },
    subject: { kind: "topic_text" as const, title: "선택 lineage" },
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
    capturedAt: "2026-08-06T00:00:00.000Z",
  };
}

function evidence() {
  const observed = {
    title: "검증 자료",
    url: "https://source.example/article",
    publisher: "Source",
    publishedAt: null,
    claimSummary: "실무 적용 근거",
  };
  return {
    contractVersion: "research-evidence.v1" as const,
    decision: "searched" as const,
    reason: "최신 근거 필요",
    queries: ["브랜드 운영 최신 동향"],
    capturedAt: "2026-08-06T01:00:00.000Z",
    items: [{
      id: ids.evidence,
      ...observed,
      capturedAt: "2026-08-06T01:00:00.000Z",
      contentHash: createHash("sha256").update(JSON.stringify(observed)).digest("hex"),
    }],
  };
}

function proposal(index: number) {
  return {
    conceptKey: `selection-${index}`,
    title: `선택안 ${index}`,
    informationalType: "how_to",
    oneLineIntent: `의도 ${index}`,
    differentiator: `차별점 ${index}`,
    differentiationAxes: ["narrative"],
    target: "운영자",
    customerContext: "운영 시작",
    keyMessage: `메시지 ${index}`,
    hook: `훅 ${index}`,
    selectionReason: `이유 ${index}`,
    evidenceIds: [ids.evidence],
    referenceIds: [],
    outputFormat: "reel",
    channelTargets: ["instagram"],
    assetCount: 1,
    outline: [{ index: 1, role: "hook", headline: `제목 ${index}`, purpose: `목적 ${index}` }],
    purposeDetails: {
      kind: "informational",
      question: `질문 ${index}`,
      value: `가치 ${index}`,
      whyNow: `시점 ${index}`,
      learningPoints: [`학습 ${index}`],
    },
  };
}

describe.skipIf(process.env.RUN_POSTGRES_INTEGRATION !== "true")(
  "proposal selection lineage on PostgreSQL 16 final migrations",
  () => {
    let container: StartedPostgreSqlContainer | null = null;
    let pool: Pool;

    beforeAll(async () => {
      container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("brand_pilot_selection")
        .withUsername("brand_pilot")
        .withPassword("brand_pilot")
        .start();
      pool = new Pool({ connectionString: container.getConnectionUri(), max: 4 });
      await pool.query("create extension if not exists pgcrypto");
      await applyMigrationsThrough075(pool);
      await pool.query("insert into app_users(id,email) values($1,'selection@example.com')", [ids.actor]);
      await pool.query(
        "insert into workspaces(id,name,slug,created_by_user_id) values($1,'Selection','selection',$2)",
        [ids.workspace, ids.actor],
      );
      await pool.query(
        "insert into workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active')",
        [ids.workspace, ids.actor],
      );
      await pool.query(
        "insert into brands(id,workspace_id,name,created_by_user_id) values($1,$2,'Selection Brand',$3)",
        [ids.brand, ids.workspace, ids.actor],
      );
    }, 180_000);

    afterAll(async () => {
      await pool?.end();
      await container?.stop();
    });

    it("binds the completed parser-valid attempt and creates only one exact V2 draft", async () => {
      const proposalRepository = createAiContentProposalV2Repository(pool);
      const created = await createAiContentProposalV2Service({
        ...proposalRepository,
        assertReady: async () => undefined,
        resolve: async () => ({ request: request(), baseInput: baseInput(), sourceSnapshots: [] }),
      }).create({
        source: "manual",
        workspaceId: ids.workspace,
        brandId: ids.brand,
        actorUserId: ids.actor,
        idempotencyKey: "selection-lineage",
        request: request(),
      });
      const jobs = createContentProposalJobsRepository(pool);
      const research = await jobs.claimContentProposalJob({
        workerId: "selection-research", leaseSeconds: 180,
      }) as ContentProposalResearchClaim;
      await jobs.completeContentProposalResearch({
        jobId: research.id,
        workerId: research.workerId,
        leaseToken: research.leaseToken,
        researchAttemptId: research.researchAttemptId,
        evidence: evidence(),
      });
      const model = await jobs.claimContentProposalJob({
        workerId: "selection-model", leaseSeconds: 180,
      }) as ContentProposalModelClaim;
      await jobs.startContentProposalInvocation({
        jobId: model.id, workerId: model.workerId, leaseToken: model.leaseToken,
        modelAttemptId: model.modelAttemptId, invocationOrdinal: 1,
      });
      await jobs.completeContentProposalJob({
        jobId: model.id, workerId: model.workerId, leaseToken: model.leaseToken,
        modelAttemptId: model.modelAttemptId, invocationOrdinal: 1,
        transcriptSha256: "1".repeat(64), outputSha256: "2".repeat(64),
        parserSha256: "3".repeat(64),
        proposalSet: { contractVersion: "content-proposal.v2", proposals: [proposal(1), proposal(2), proposal(3)] },
      });
      const proposalRow = await pool.query(
        "select id from ai_content_proposals where batch_id=$1 and position=1",
        [created.proposalBatchId],
      );
      const proposalId = String(proposalRow.rows[0]?.id);
      const selected = await createAiContentRepository(pool).selectAiContentProposal({
        workspaceId: ids.workspace,
        brandId: ids.brand,
        actorUserId: ids.actor,
        proposalId,
        idempotencyKey: "selection-lineage-draft",
      });
      expect(selected).toMatchObject({ outputFormat: "reel", purpose: "informational", status: "draft" });

      const graph = await pool.query(
        `select proposal.successful_model_attempt_id,proposal.successful_proposal_job_id,
                proposal.final_invocation_ordinal,generation.draft_json,
                (select count(*)::int from ai_content_approved_proposal_versions) approved_versions,
                (select count(*)::int from ai_content_generation_references) copied_references,
                (select count(*)::int from ai_content_generation_input_snapshots) input_snapshots
           from ai_content_proposals proposal
           join ai_content_generations generation on generation.id=proposal.generation_id
          where proposal.id=$1`,
        [proposalId],
      );
      expect(graph.rows[0]).toEqual({
        successful_model_attempt_id: model.modelAttemptId,
        successful_proposal_job_id: model.id,
        final_invocation_ordinal: 1,
        draft_json: {
          origin: "proposal-v2",
          proposalBatchId: created.proposalBatchId,
          proposalId,
          finalization: {
            contractVersion: "content-finalization-draft.v2",
            avatarStyleImageId: null,
            userImageInstruction: null,
            attachmentIds: [],
          },
        },
        approved_versions: 0,
        copied_references: 0,
        input_snapshots: 0,
      });
    }, 30_000);
  },
);
