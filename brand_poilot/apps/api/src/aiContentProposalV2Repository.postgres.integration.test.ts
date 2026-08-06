import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ContentOrchestrationV2 } from "@brand-pilot/content-contracts";
import { createAiContentProposalV2Repository } from "./aiContentRepository.js";
import { createAiContentProposalV2Service } from "./aiContentProposalV2Service.js";

const ids = {
  actor: "10000000-0000-4000-8000-000000000001",
  workspace: "20000000-0000-4000-8000-000000000002",
  brand: "30000000-0000-4000-8000-000000000003",
  core: "40000000-0000-4000-8000-000000000004",
  topic: "50000000-0000-4000-8000-000000000005",
  snapshot: "60000000-0000-4000-8000-000000000006",
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

function request(contentInstruction: string | null = null): ContentOrchestrationV2 {
  return {
    contractVersion: "content-orchestration.v2" as const,
    brandId: ids.brand,
    purpose: "informational" as const,
    seed: { kind: "topic_text" as const, title: "동시성 릴스" },
    contentInstruction,
    productId: null,
    outputSettings: {
      outputFormat: "reel" as const,
      channelTargets: ["instagram" as const],
      aspectRatio: "9:16" as const,
      outputCount: 1 as const,
    },
  };
}

function resolved(requestValue: ContentOrchestrationV2 = request()) {
  return {
    request: requestValue,
    sourceSnapshots: [],
    baseInput: {
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
      subject: { kind: "topic_text" as const, title: "동시성 릴스" },
      contentInstruction: requestValue.contentInstruction,
      product: null,
      references: [],
      outputSettings: {
        ...requestValue.outputSettings,
        channelTargets: ["instagram" as const],
        purpose: "informational" as const,
      },
      capturedAt: "2026-08-05T00:00:00.000Z",
    },
  };
}

describe.skipIf(process.env.RUN_POSTGRES_INTEGRATION !== "true")(
  "Proposal V2 repository on PostgreSQL 16 final migrations",
  () => {
    let container: StartedPostgreSqlContainer | null = null;
    let pool: Pool;

    beforeAll(async () => {
      container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("brand_pilot_proposal_v2")
        .withUsername("brand_pilot")
        .withPassword("brand_pilot")
        .start();
      pool = new Pool({
        connectionString: container.getConnectionUri(),
        max: 8,
        application_name: "proposal-v2-concurrency",
      });
      await pool.query("create extension if not exists pgcrypto");
      await applyMigrationsThrough075(pool);
      await pool.query(
        "insert into app_users(id,email) values($1,'proposal-v2@example.com')",
        [ids.actor],
      );
      await pool.query(
        "insert into workspaces(id,name,slug,created_by_user_id) values($1,'Proposal V2','proposal-v2',$2)",
        [ids.workspace, ids.actor],
      );
      await pool.query(
        "insert into workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active')",
        [ids.workspace, ids.actor],
      );
      await pool.query(
        "insert into brands(id,workspace_id,name,created_by_user_id) values($1,$2,'Proposal V2 Brand',$3)",
        [ids.brand, ids.workspace, ids.actor],
      );
    }, 180_000);

    beforeEach(async () => {
      await pool.query(`truncate table
        ai_content_proposal_attempt_events,
        ai_content_proposal_model_attempts,
        ai_content_proposal_research_attempt_events,
        ai_content_proposal_research_attempts,
        ai_content_proposal_compositions,
        ai_content_proposal_job_contracts,
        ai_content_proposal_jobs,
        ai_content_proposals,
        ai_content_proposal_batches cascade`);
    });

    afterAll(async () => {
      await pool?.end();
      await container?.stop();
    });

    it("serializes same-key manual creates into one batch/job/contract and conflicts only on changed fingerprint", async () => {
      const repository = createAiContentProposalV2Repository(pool);
      const service = createAiContentProposalV2Service({
        ...repository,
        assertReady: async () => undefined,
        resolve: async (command) => resolved(command.source === "performance_experiment" ? request() : command.request),
      });
      const command = {
        source: "manual" as const,
        workspaceId: ids.workspace,
        brandId: ids.brand,
        actorUserId: ids.actor,
        idempotencyKey: "postgres-concurrent-manual",
        request: request(),
      };

      const [first, second] = await Promise.all([service.create(command), service.create(command)]);

      expect([first.disposition, second.disposition].sort()).toEqual(["created", "replayed"]);
      expect(first.proposalBatchId).toBe(second.proposalBatchId);
      const graph = await pool.query(`select
        (select count(*)::int from ai_content_proposal_batches) batches,
        (select count(*)::int from ai_content_proposal_jobs) jobs,
        (select count(*)::int from ai_content_proposal_job_contracts) contracts`);
      expect(graph.rows[0]).toEqual({ batches: 1, jobs: 1, contracts: 1 });

      await expect(service.create({ ...command, request: request("변경된 요청") }))
        .rejects.toThrow("ai_content_proposal_batch_conflict");
    }, 30_000);

    it("replays scheduled work with a null actor inside caller-owned transactions", async () => {
      const repository = createAiContentProposalV2Repository(pool);
      const service = createAiContentProposalV2Service({
        ...repository,
        assertReady: async () => undefined,
        resolve: async (command) => resolved(command.source === "performance_experiment" ? request() : command.request),
      });
      const command = {
        source: "scheduled_crawl" as const,
        workspaceId: ids.workspace,
        brandId: ids.brand,
        callerOperationKey: "postgres-scheduled-operation",
        contentTopicId: ids.topic,
        sourceSnapshotIds: [ids.snapshot],
        legacySourceOutputId: null,
        request: request(),
      };
      const first = await repository.withTransaction((tx) => service.create(command, { tx }));
      const second = await repository.withTransaction((tx) => service.create(command, { tx }));

      expect(first.disposition).toBe("created");
      expect(second).toMatchObject({
        disposition: "replayed",
        proposalBatchId: first.proposalBatchId,
      });
      const stored = await pool.query(
        "select created_by_user_id,purpose from ai_content_proposal_batches where id=$1",
        [first.proposalBatchId],
      );
      expect(stored.rows[0]).toEqual({ created_by_user_id: null, purpose: "informational" });
    }, 30_000);
  },
);
