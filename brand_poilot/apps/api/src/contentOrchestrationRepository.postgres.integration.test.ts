import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type QueryResult } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ids = {
  actor: "10000000-0000-4000-8000-000000000001",
  competingActor: "10000000-0000-4000-8000-000000000002",
  workspace: "20000000-0000-4000-8000-000000000002",
  brand: "30000000-0000-4000-8000-000000000003",
  core: "40000000-0000-4000-8000-000000000004",
  rules: "50000000-0000-4000-8000-000000000005",
  batch: "60000000-0000-4000-8000-000000000006",
  firstProposal: "70000000-0000-4000-8000-000000000007",
  secondProposal: "70000000-0000-4000-8000-000000000008",
  approvedProposal: "80000000-0000-4000-8000-000000000008",
  generation: "90000000-0000-4000-8000-000000000009",
};

async function applyRealMigrations(pool: Pool) {
  const directory = resolve(process.cwd(), "../../db/migrations");
  const skippedVectorMigrations = new Set([
    "021_dm_wiki_pgvector.sql",
    "027_wiki_search_v2.sql",
    "033_compounding_wiki_pgvector.sql",
  ]);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    if (skippedVectorMigrations.has(file)) continue;
    await pool.query(await readFile(resolve(directory, file), "utf8"));
  }
}

async function waitForBlockedBackends(pool: Pool, blockerPid: number, expected: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ waiting_count: number; blocked_by_gate: boolean }>(
      `select
         count(*) filter (
           where wait_event_type='Lock'
             and application_name='content-orchestration-concurrency'
         )::integer as waiting_count,
         coalesce(bool_or($1 = any(pg_blocking_pids(pid))),false) as blocked_by_gate
       from pg_stat_activity
       where datname=current_database()
         and pid <> $1`,
      [blockerPid],
    );
    if (
      Number(result.rows[0]?.waiting_count) >= expected
      && result.rows[0]?.blocked_by_gate === true
    ) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  return false;
}

const approvalSnapshot = {
  contractVersion: "approved-proposal.v1",
  sourceProposalId: ids.firstProposal,
  revision: 1,
  effectiveProposal: { contractVersion: "content-proposal.v1" },
  editPatch: [],
  validationResultId: "postgres-concurrency-validation",
  approvedBy: ids.actor,
  approvedAt: "2026-07-28T00:00:00.000Z",
};

const generationBrief = {
  contractVersion: "generation-brief.v1",
  proposalId: ids.firstProposal,
  approvedProposalVersionId: ids.approvedProposal,
  approvedProposalSnapshot: approvalSnapshot,
  brandCoreVersionId: ids.core,
  ruleSetVersionId: ids.rules,
  subject: {
    kind: "brand_topic",
    topic: "Concurrent orchestration",
    brandCoreEvidenceIds: [],
  },
  wikiSnapshots: [],
  references: [],
  avatar: null,
  outputFormat: "blog",
  channels: ["blog"],
  promptDefinitionVersions: { generation: "generation.v1" },
};

describe.skipIf(process.env.RUN_POSTGRES_INTEGRATION !== "true")(
  "content orchestration on PostgreSQL 16 real migrations",
  () => {
    let container: StartedPostgreSqlContainer | null = null;
    let pool: Pool;

    beforeAll(async () => {
      container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("brand_pilot_content_orchestration")
        .withUsername("brand_pilot")
        .withPassword("brand_pilot")
        .start();
      pool = new Pool({
        connectionString: container.getConnectionUri(),
        max: 8,
        application_name: "content-orchestration-concurrency",
      });
      await applyRealMigrations(pool);
      await pool.query(
        `insert into app_users (id,email) values
           ($1,'orchestration-owner@example.com'),
           ($2,'orchestration-member@example.com')`,
        [ids.actor, ids.competingActor],
      );
      await pool.query(
        `insert into workspaces (id,name,slug,created_by_user_id)
         values ($1,'Orchestration','orchestration-postgres',$2)`,
        [ids.workspace, ids.actor],
      );
      await pool.query(
        `insert into workspace_members (workspace_id,user_id,role,status) values
           ($1,$2,'owner','active'),($1,$3,'member','active')`,
        [ids.workspace, ids.actor, ids.competingActor],
      );
      await pool.query(
        `insert into brands (id,workspace_id,name,created_by_user_id)
         values ($1,$2,'Orchestration Brand',$3)`,
        [ids.brand, ids.workspace, ids.actor],
      );
      await pool.query(
        "insert into brand_profiles (workspace_id,brand_id) values ($1,$2)",
        [ids.workspace, ids.brand],
      );
      await pool.query(
        `insert into brand_core_versions (
           id,workspace_id,brand_id,version,status,core_json,created_by,approved_at
         ) values ($1,$2,$3,1,'approved','{}','user','2026-07-28T00:00:00Z')`,
        [ids.core, ids.workspace, ids.brand],
      );
      await pool.query(
        `insert into brand_rule_sets (
           id,workspace_id,brand_id,version,status,rules_json,created_by,approved_at
         ) values ($1,$2,$3,1,'approved','{}','user','2026-07-28T00:00:00Z')`,
        [ids.rules, ids.workspace, ids.brand],
      );
      await pool.query(
        `update brand_profiles
            set active_brand_core_id=$1,active_brand_rule_set_id=$2
          where workspace_id=$3 and brand_id=$4`,
        [ids.core, ids.rules, ids.workspace, ids.brand],
      );
    }, 120_000);

    beforeEach(async () => {
      await pool.query(
        `truncate table ai_content_generation_briefs,
                        ai_content_approved_proposal_versions,
                        ai_content_proposal_jobs,
                        ai_content_proposals,
                        ai_content_proposal_batches,
                        ai_content_generations cascade`,
      );
      await pool.query(
        `insert into ai_content_proposal_batches (
           id,workspace_id,brand_id,origin,content_family,request_json,
           source_snapshot_json,status,idempotency_key,created_by_user_id
         ) values ($1,$2,$3,'manual','informational','{}','[]','ready','postgres-batch',$4)`,
        [ids.batch, ids.workspace, ids.brand, ids.actor],
      );
      await pool.query(
        `insert into ai_content_proposals (
           id,workspace_id,brand_id,batch_id,position,proposal_json
         ) values
           ($1,$3,$4,$2,1,'{}'),
           ($5,$3,$4,$2,2,'{}')`,
        [ids.firstProposal, ids.batch, ids.workspace, ids.brand, ids.secondProposal],
      );
      await pool.query(
        `insert into ai_content_generations (
           id,workspace_id,brand_id,type,title,analysis_idempotency_key,
           content_family,output_format,subject_mode,generation_input_snapshot
         ) values (
           $1,$2,$3,'blog','PostgreSQL concurrency','postgres-concurrency-generation',
           'informational','blog','brand_topic',
           '{"contractVersion":"content-generation-input.v2","contentType":"blog"}'
         )`,
        [ids.generation, ids.workspace, ids.brand],
      );
    }, 30_000);

    afterAll(async () => {
      try {
        await pool?.end();
      } finally {
        await container?.stop();
      }
    }, 120_000);

    it("blocks competing selections on the batch row and commits exactly one winner", async () => {
      const gate = await pool.connect();
      try {
        await gate.query("begin");
        await gate.query(
          "select id from ai_content_proposal_batches where id=$1 for update",
          [ids.batch],
        );
        const blockerPid = Number((await gate.query("select pg_backend_pid() pid")).rows[0]?.pid);
        const selections = Promise.allSettled([
          pool.query("select select_ai_content_proposal($1,$2,$3,$4)", [
            ids.firstProposal, ids.workspace, ids.brand, ids.actor,
          ]),
          pool.query("select select_ai_content_proposal($1,$2,$3,$4)", [
            ids.secondProposal, ids.workspace, ids.brand, ids.competingActor,
          ]),
        ]);
        expect(await waitForBlockedBackends(pool, blockerPid, 2)).toBe(true);
        await gate.query("commit");

        const settled = await selections;
        expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
        const rows = await pool.query(
          `select status,count(*)::integer count
             from ai_content_proposals
            where batch_id=$1
            group by status`,
          [ids.batch],
        );
        expect(Object.fromEntries(rows.rows.map((row) => [row.status, row.count]))).toEqual({
          dismissed: 1,
          selected: 1,
        });
      } finally {
        await gate.query("rollback").catch(() => undefined);
        gate.release();
      }
    }, 30_000);

    it("blocks concurrent starts on the generation row and creates one immutable brief", async () => {
      await pool.query("select select_ai_content_proposal($1,$2,$3,$4)", [
        ids.firstProposal, ids.workspace, ids.brand, ids.actor,
      ]);
      await pool.query(
        `insert into ai_content_approved_proposal_versions (
           id,workspace_id,brand_id,proposal_id,revision,approved_proposal_snapshot,
           validation_result_id,approved_by_user_id,approved_at
         ) values ($1,$2,$3,$4,1,$5,$6,$7,$8)`,
        [
          ids.approvedProposal,
          ids.workspace,
          ids.brand,
          ids.firstProposal,
          JSON.stringify(approvalSnapshot),
          approvalSnapshot.validationResultId,
          ids.actor,
          approvalSnapshot.approvedAt,
        ],
      );

      const gate = await pool.connect();
      try {
        await gate.query("begin");
        await gate.query("select id from ai_content_generations where id=$1 for update", [
          ids.generation,
        ]);
        const blockerPid = Number((await gate.query("select pg_backend_pid() pid")).rows[0]?.pid);
        const parameters = [
          ids.generation,
          ids.workspace,
          ids.brand,
          JSON.stringify(generationBrief),
          JSON.stringify(null),
          ids.actor,
        ];
        const starts = Promise.all([
          pool.query("select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)", parameters),
          pool.query("select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)", parameters),
        ]);
        expect(await waitForBlockedBackends(pool, blockerPid, 2)).toBe(true);
        await gate.query("commit");

        const results = await starts;
        expect(results.map((result) => result.rows[0]?.start_ai_content_orchestration)).toEqual([
          ids.generation,
          ids.generation,
        ]);
        const stored = await pool.query(
          `select count(*)::integer count,min(brief_json::text) brief
             from ai_content_generation_briefs
            where generation_id=$1`,
          [ids.generation],
        );
        expect(stored.rows[0]?.count).toBe(1);
      } finally {
        await gate.query("rollback").catch(() => undefined);
        gate.release();
      }
    }, 30_000);

    it("orders start behind selection's batch lock without deadlocking on the proposal", async () => {
      await pool.query("select select_ai_content_proposal($1,$2,$3,$4)", [
        ids.firstProposal, ids.workspace, ids.brand, ids.actor,
      ]);
      await pool.query(
        `insert into ai_content_approved_proposal_versions (
           id,workspace_id,brand_id,proposal_id,revision,approved_proposal_snapshot,
           validation_result_id,approved_by_user_id,approved_at
         ) values ($1,$2,$3,$4,1,$5,$6,$7,$8)`,
        [
          ids.approvedProposal,
          ids.workspace,
          ids.brand,
          ids.firstProposal,
          JSON.stringify(approvalSnapshot),
          approvalSnapshot.validationResultId,
          ids.actor,
          approvalSnapshot.approvedAt,
        ],
      );

      const gate = await pool.connect();
      let start: Promise<QueryResult> | undefined;
      try {
        await gate.query("begin");
        await gate.query("set local statement_timeout = '5s'");
        await gate.query(
          "select id from ai_content_proposal_batches where id=$1 for update",
          [ids.batch],
        );
        const blockerPid = Number((await gate.query("select pg_backend_pid() pid")).rows[0]?.pid);
        const parameters = [
          ids.generation,
          ids.workspace,
          ids.brand,
          JSON.stringify(generationBrief),
          JSON.stringify(null),
          ids.actor,
        ];
        start = pool.query(
          "select start_ai_content_orchestration($1,$2,$3,$4,$5,$6)",
          parameters,
        );
        expect(await waitForBlockedBackends(pool, blockerPid, 1)).toBe(true);

        const selected = await gate.query(
          "select select_ai_content_proposal($1,$2,$3,$4) selected_id",
          [ids.firstProposal, ids.workspace, ids.brand, ids.actor],
        );
        expect(selected.rows[0]?.selected_id).toBe(ids.firstProposal);
        await gate.query("commit");

        const started = await start!;
        expect(started.rows[0]?.start_ai_content_orchestration).toBe(ids.generation);
      } finally {
        await gate.query("rollback").catch(() => undefined);
        gate.release();
        if (start) await start.catch(() => undefined);
      }
    }, 30_000);
  },
);
