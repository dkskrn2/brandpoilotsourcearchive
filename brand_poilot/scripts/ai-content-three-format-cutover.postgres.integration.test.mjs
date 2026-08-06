import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Client } from "pg";
import {
  cutover075RelationSecurityCatalog,
  cutover075SecurityFunctions,
  loadMigrations,
  readCutover075PostCatalog,
} from "./migrationRunner.mjs";

const excludedMigrationIds = new Set([
  "021_dm_wiki_pgvector.sql",
  "027_wiki_search_v2.sql",
  "033_compounding_wiki_pgvector.sql",
]);
const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

test("075 real PostgreSQL enforces exclusive proposal composition and append-only model attempt events", { timeout: 180_000 }, async () => {
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  let container;
  const clients = [];
  let testError;
  try {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withUsername("postgres")
      .withPassword("postgres")
      .withDatabase("ai_content_three_format_cutover")
      .withEnvironment("POSTGRES_INITDB_ARGS", "--locale=C")
      .start();
    const admin = new Client({ connectionString: container.getConnectionUri() });
    clients.push(admin);
    await admin.connect();
    const identity = await admin.query(
      "select current_setting('server_version_num')::integer as version_num, to_regclass('public.workspaces') as workspaces",
    );
    assert.ok(identity.rows[0].version_num >= 160000 && identity.rows[0].version_num < 170000);
    assert.equal(identity.rows[0].workspaces, null);
    await admin.query("create extension if not exists pgcrypto");

    const migrations = (await loadMigrations()).filter(
      (migration) => !excludedMigrationIds.has(migration.id)
        && migration.id <= "075_ai_content_three_format_cutover.sql",
    );
    const migration075 = migrations.find((migration) => migration.id === "075_ai_content_three_format_cutover.sql");
    assert.ok(migration075);
    for (const migration of migrations) {
      if (migration.id !== "075_ai_content_three_format_cutover.sql") {
        await admin.query(migration.sql);
        continue;
      }
      const start = migration.sql.indexOf("-- 075_FENCE_REGISTRATION_BEGIN");
      const end = migration.sql.indexOf("-- 075_FENCE_REGISTRATION_END");
      assert.ok(start > 0 && end > start);
      await admin.query(`${migration.sql.slice(0, start)}${migration.sql.slice(
        end + "-- 075_FENCE_REGISTRATION_END".length,
      )}`);
    }

    const workspace = await admin.query(
      "insert into workspaces(name,slug) values('075 PG',$1) returning id",
      [`cutover-${randomUUID()}`],
    );
    const brand = await admin.query(
      "insert into brands(workspace_id,name) values($1,'075 PG') returning id",
      [workspace.rows[0].id],
    );
    const hash = "a".repeat(64);
    const proposalSchema = "54bf063cf32926874af6b098272df08d41a9e7d7f578ee6560debe44428cf5f3";
    const contractSource = "f1e754cb2c2664ef21f41597a45b2ed424ebc040b949f5bf4cece251195ab5f8";
    const catalogSha = "94c6622ce5c5ef74b9d011dd0d35035f0f0b5580160dc2a2264b08030a5724fb";
    const createProposalJobFixture = async (label) => {
      const fixtureBatch = await admin.query(
        `insert into ai_content_proposal_batches(
           workspace_id,brand_id,origin,purpose,request_json,source_snapshot_json,idempotency_key
         ) values($1,$2,'manual','informational','{}'::jsonb,'[]'::jsonb,$3) returning id`,
        [workspace.rows[0].id, brand.rows[0].id, `${label}:${randomUUID()}`],
      );
      await admin.query("begin");
      try {
        const fixtureJob = await admin.query(
          `insert into ai_content_proposal_jobs(workspace_id,brand_id,batch_id)
           values($1,$2,$3) returning id`,
          [workspace.rows[0].id, brand.rows[0].id, fixtureBatch.rows[0].id],
        );
        const fixtureContract = await admin.query(
          `insert into ai_content_proposal_job_contracts(
             job_id,batch_id,workspace_id,brand_id,request_contract_version,
             base_input_contract_version,research_contract_version,proposal_contract_version,
             proposal_prompt_version,proposal_output_schema_sha256,proposal_model_id,
             command_descriptor_sha256,request_sha256,base_input_sha256,
             contract_source_sha256,catalog_sha256,enqueue_contract_sha256
           ) values($1,$2,$3,$4,'content-proposal-request.v2','proposal-base-input.v2',
             'research-evidence.v1','content-proposal.v2','proposal.writer.v2',$5,
             'gpt-5.6-terra',$6,$6,$6,$7,$8,$6) returning id`,
          [fixtureJob.rows[0].id, fixtureBatch.rows[0].id,
            workspace.rows[0].id, brand.rows[0].id, proposalSchema, hash, contractSource, catalogSha],
        );
        await admin.query("commit");
        return { batch: fixtureBatch.rows[0], job: fixtureJob.rows[0], contract: fixtureContract.rows[0] };
      } catch (error) {
        await admin.query("rollback");
        throw error;
      }
    };
    const batch = await admin.query(
      `insert into ai_content_proposal_batches(
         workspace_id,brand_id,origin,purpose,request_json,source_snapshot_json,idempotency_key
       ) values($1,$2,'manual','informational','{}'::jsonb,'[]'::jsonb,$3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, randomUUID()],
    );
    await admin.query("begin");
    await admin.query(
      `insert into ai_content_proposal_jobs(workspace_id,brand_id,batch_id)
       values($1,$2,$3)`,
      [workspace.rows[0].id, brand.rows[0].id, batch.rows[0].id],
    );
    await assert.rejects(admin.query("commit"), /ai_content_proposal_job_contract_required/);
    await admin.query("rollback");

    await admin.query("begin");
    const job = await admin.query(
      `insert into ai_content_proposal_jobs(workspace_id,brand_id,batch_id)
       values($1,$2,$3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, batch.rows[0].id],
    );
    const contract = await admin.query(
      `insert into ai_content_proposal_job_contracts(
         job_id,batch_id,workspace_id,brand_id,request_contract_version,
         base_input_contract_version,research_contract_version,proposal_contract_version,
         proposal_prompt_version,proposal_output_schema_sha256,proposal_model_id,
         command_descriptor_sha256,request_sha256,base_input_sha256,
         contract_source_sha256,catalog_sha256,enqueue_contract_sha256
       ) values($1,$2,$3,$4,'content-proposal-request.v2','proposal-base-input.v2',
         'research-evidence.v1','content-proposal.v2','proposal.writer.v2',$5,
         'gpt-5.6-terra',$6,$6,$6,$7,$8,$6) returning id`,
      [job.rows[0].id, batch.rows[0].id, workspace.rows[0].id, brand.rows[0].id,
        proposalSchema, hash, contractSource, catalogSha],
    );
    await admin.query("commit");
    await assert.rejects(
      admin.query(
        `update ai_content_proposal_jobs set status='completed',active_stage=null,
           lease_owner=null,lease_token=null,lease_started_at=null,lease_expires_at=null,
           error_code=null,error_message=null,completed_at=now() where id=$1`,
        [job.rows[0].id],
      ),
      /proposal_job_terminal_event_missing/,
    );
    const otherBatch = await admin.query(
      `insert into ai_content_proposal_batches(
         workspace_id,brand_id,origin,purpose,request_json,source_snapshot_json,idempotency_key
       ) values($1,$2,'manual','informational','{}'::jsonb,'[]'::jsonb,$3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, randomUUID()],
    );
    const invalidContractBatch = await admin.query(
      `insert into ai_content_proposal_batches(
         workspace_id,brand_id,origin,purpose,request_json,source_snapshot_json,idempotency_key
       ) values($1,$2,'manual','informational','{}'::jsonb,'[]'::jsonb,$3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, randomUUID()],
    );
    const invalidVersionBatch = await admin.query(
      `insert into ai_content_proposal_batches(
         workspace_id,brand_id,origin,purpose,request_json,source_snapshot_json,idempotency_key
       ) values($1,$2,'manual','informational','{}'::jsonb,'[]'::jsonb,$3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, randomUUID()],
    );
    await admin.query("begin");
    const wrongBatchJob = await admin.query(
      `insert into ai_content_proposal_jobs(workspace_id,brand_id,batch_id)
       values($1,$2,$3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, invalidContractBatch.rows[0].id],
    );
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposal_job_contracts(
           job_id,batch_id,workspace_id,brand_id,request_contract_version,
           base_input_contract_version,research_contract_version,proposal_contract_version,
           proposal_prompt_version,proposal_output_schema_sha256,proposal_model_id,
           command_descriptor_sha256,request_sha256,base_input_sha256,
           contract_source_sha256,catalog_sha256,enqueue_contract_sha256
         ) values($1,$2,$3,$4,'content-proposal-request.v2','proposal-base-input.v2',
           'research-evidence.v1','content-proposal.v2','proposal.writer.v2',$5,
           'gpt-5.6-terra',$6,$6,$6,$7,$8,$6)`,
        [wrongBatchJob.rows[0].id, otherBatch.rows[0].id, workspace.rows[0].id, brand.rows[0].id,
          proposalSchema, hash, contractSource, catalogSha],
      ),
      /ai_content_proposal_job_contracts_job_fk/,
    );
    await admin.query("rollback");

    await admin.query("begin");
    const wrongVersionJob = await admin.query(
      `insert into ai_content_proposal_jobs(workspace_id,brand_id,batch_id)
       values($1,$2,$3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, invalidVersionBatch.rows[0].id],
    );
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposal_job_contracts(
           job_id,batch_id,workspace_id,brand_id,request_contract_version,
           base_input_contract_version,research_contract_version,proposal_contract_version,
           proposal_prompt_version,proposal_output_schema_sha256,proposal_model_id,
           command_descriptor_sha256,request_sha256,base_input_sha256,
           contract_source_sha256,catalog_sha256,enqueue_contract_sha256
         ) values($1,$2,$3,$4,'content-proposal-request.v2','proposal-base-input.v2',
           'research-evidence.v1','content-proposal.v2','proposal.writer.v2',$5,
           'gpt-5.6-terra',$6,$6,$6,$7,$8,$6)`,
        [wrongVersionJob.rows[0].id, invalidVersionBatch.rows[0].id, workspace.rows[0].id, brand.rows[0].id,
          proposalSchema, hash, contractSource, "f".repeat(64)],
      ),
      /ai_content_proposal_job_contracts_versions_check/,
    );
    await admin.query("rollback");

    await admin.query("begin");
    try {
      await assert.rejects(
        admin.query(
          `update ai_content_proposal_jobs set status='processing',active_stage='research',
             lease_owner=null,lease_token=$2,lease_started_at=now(),
             lease_expires_at=now()+interval '5 minutes' where id=$1`,
          [job.rows[0].id, randomUUID()],
        ),
        /ai_content_proposal_jobs_lease_check/,
      );
    } finally {
      await admin.query("rollback");
    }

    const researchLease = randomUUID();
    const researchLeaseHash = (await admin.query(
      "select encode(digest($1::uuid::text,'sha256'),'hex') as hash",
      [researchLease],
    )).rows[0].hash;
    await admin.query(
      `update ai_content_proposal_jobs set status='processing',active_stage='research',
         lease_owner='research-worker',lease_token=$2,lease_started_at=now(),
         lease_expires_at=now()+interval '5 minutes' where id=$1`,
      [job.rows[0].id, researchLease],
    );
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposal_research_attempts(
           job_id,contract_id,workspace_id,brand_id,attempt_number,worker_id,
           lease_token_sha256,enqueue_contract_sha256,base_input_sha256,lease_expires_at
         ) select $1,$2,$3,$4,98,'wrong-worker',$5,$6,$6,lease_expires_at
             from ai_content_proposal_jobs where id=$1`,
        [job.rows[0].id, contract.rows[0].id, workspace.rows[0].id, brand.rows[0].id,
          researchLeaseHash, hash],
      ),
      /proposal_research_attempt_contract_or_lease_mismatch/,
    );
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposal_research_attempts(
           job_id,contract_id,workspace_id,brand_id,attempt_number,worker_id,
           lease_token_sha256,enqueue_contract_sha256,base_input_sha256,lease_expires_at
         ) select $1,$2,$3,$4,99,'research-worker',$5,$6,$7,lease_expires_at
             from ai_content_proposal_jobs where id=$1`,
        [job.rows[0].id, contract.rows[0].id, workspace.rows[0].id, brand.rows[0].id,
          researchLeaseHash, hash, "e".repeat(64)],
      ),
      /proposal_research_attempt_contract_or_lease_mismatch/,
    );
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposal_research_attempts(
           job_id,contract_id,workspace_id,brand_id,attempt_number,worker_id,
           lease_token_sha256,enqueue_contract_sha256,base_input_sha256,lease_expires_at
         ) select $1,$2,$3,$4,2,'research-worker',$5,$6,$6,lease_expires_at
             from ai_content_proposal_jobs where id=$1`,
        [job.rows[0].id, contract.rows[0].id, workspace.rows[0].id, brand.rows[0].id,
          researchLeaseHash, hash],
      ),
      /proposal_research_attempt_contract_or_lease_mismatch/,
    );
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposal_research_attempts(
           job_id,contract_id,workspace_id,brand_id,attempt_number,worker_id,
           lease_token_sha256,enqueue_contract_sha256,base_input_sha256,claimed_at,lease_expires_at
         ) select $1,$2,$3,$4,1,'research-worker',$5,$6,$6,now()+interval '1 minute',lease_expires_at
             from ai_content_proposal_jobs where id=$1`,
        [job.rows[0].id, contract.rows[0].id, workspace.rows[0].id, brand.rows[0].id,
          researchLeaseHash, hash],
      ),
      /proposal_research_attempt_contract_or_lease_mismatch/,
    );
    await admin.query(
      `update ai_content_proposal_jobs set lease_started_at=now()-interval '10 minutes',
         lease_expires_at=now()-interval '1 minute' where id=$1`,
      [job.rows[0].id],
    );
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposal_research_attempts(
           job_id,contract_id,workspace_id,brand_id,attempt_number,worker_id,
           lease_token_sha256,enqueue_contract_sha256,base_input_sha256,claimed_at,lease_expires_at
         ) select $1,$2,$3,$4,1,'research-worker',$5,$6,$6,lease_started_at,lease_expires_at
             from ai_content_proposal_jobs where id=$1`,
        [job.rows[0].id, contract.rows[0].id, workspace.rows[0].id, brand.rows[0].id,
          researchLeaseHash, hash],
      ),
      /proposal_research_attempt_contract_or_lease_mismatch/,
    );
    await admin.query(
      `update ai_content_proposal_jobs set lease_started_at=now(),
         lease_expires_at=now()+interval '5 minutes' where id=$1`,
      [job.rows[0].id],
    );
    const contender = new Client({ connectionString: container.getConnectionUri() });
    clients.push(contender);
    await contender.connect();
    const researchAttemptInsert = `insert into ai_content_proposal_research_attempts(
         job_id,contract_id,workspace_id,brand_id,attempt_number,worker_id,
         lease_token_sha256,enqueue_contract_sha256,base_input_sha256,lease_expires_at
       ) select $1,$2,$3,$4,1,'research-worker',$5,$6,$6,lease_expires_at
           from ai_content_proposal_jobs where id=$1
       returning id`;
    const researchAttemptArgs = [job.rows[0].id, contract.rows[0].id,
      workspace.rows[0].id, brand.rows[0].id, researchLeaseHash, hash];
    const concurrentAttempts = await Promise.allSettled([
      admin.query(researchAttemptInsert, researchAttemptArgs),
      contender.query(researchAttemptInsert, researchAttemptArgs),
    ]);
    assert.equal(concurrentAttempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrentAttempts.filter((result) => result.status === "rejected").length, 1);
    assert.match(
      concurrentAttempts.find((result) => result.status === "rejected").reason.message,
      /proposal_research_attempt_contract_or_lease_mismatch/,
    );
    const researchAttempt = concurrentAttempts.find((result) => result.status === "fulfilled").value;
    await assert.rejects(
      admin.query(
        "select append_ai_content_proposal_research_attempt_event($1,$2,1,'research_started',null,null,null,null)",
        [researchAttempt.rows[0].id, randomUUID()],
      ),
      /proposal_research_lease_mismatch/,
    );
    const researchStarted = await admin.query(
      "select append_ai_content_proposal_research_attempt_event($1,$2,1,'research_started',null,null,null,null) as event_sha256",
      [researchAttempt.rows[0].id, researchLease],
    );
    const researchFailureEnvelope = JSON.stringify({
      errorCode: "research_failed", errorMessage: "research failed", retryable: true,
    });
    const researchFailureEnvelopeHash = (await admin.query(
      "select encode(digest($1::jsonb::text,'sha256'),'hex') as hash",
      [researchFailureEnvelope],
    )).rows[0].hash;
    await admin.query(
      `update ai_content_proposal_jobs set lease_started_at=now()-interval '10 minutes',
         lease_expires_at=now()-interval '1 second' where id=$1`,
      [job.rows[0].id],
    );
    await assert.rejects(
      admin.query(
        "select append_ai_content_proposal_research_attempt_event($1,$2,2,'attempt_failed',null,$3::jsonb,$4,null)",
        [researchAttempt.rows[0].id, researchLease, researchFailureEnvelope, researchFailureEnvelopeHash],
      ),
      /proposal_research_lease_mismatch/,
    );
    await admin.query(
      `update ai_content_proposal_jobs set lease_started_at=now(),
         lease_expires_at=now()+interval '5 minutes' where id=$1`,
      [job.rows[0].id],
    );
    const evidence = JSON.stringify([{ id: randomUUID(), sha256: "b".repeat(64) }]);
    const evidenceHash = (await admin.query(
      "select encode(digest($1::jsonb::text,'sha256'),'hex') as hash",
      [evidence],
    )).rows[0].hash;
    await assert.rejects(
      admin.query(
        "select append_ai_content_proposal_research_attempt_event($1,$2,2,'evidence_committed',null,$3::jsonb,$4,null)",
        [researchAttempt.rows[0].id, researchLease, evidence, "b".repeat(64)],
      ),
      /proposal_research_evidence_hash_mismatch/,
    );
    await admin.query("begin");
    await admin.query(
      "select append_ai_content_proposal_research_attempt_event($1,$2,2,'evidence_committed',null,$3::jsonb,$4,null)",
      [researchAttempt.rows[0].id, researchLease, evidence, evidenceHash],
    );
    await assert.rejects(admin.query("commit"), /proposal_research_completion_pair_missing/);
    assert.equal((await admin.query(
      "select count(*)::integer as count from ai_content_proposal_research_attempt_events where research_attempt_id=$1",
      [researchAttempt.rows[0].id],
    )).rows[0].count, 1);

    await admin.query("begin");
    await admin.query(
      `insert into ai_content_proposal_research_attempt_events(
         research_attempt_id,job_id,workspace_id,brand_id,event_sequence,event_type,
         evidence_json,evidence_sha256,event_sha256
       ) values($1,$2,$3,$4,2,'evidence_committed',$5::jsonb,$6,$7)`,
      [researchAttempt.rows[0].id, job.rows[0].id, workspace.rows[0].id,
        brand.rows[0].id, evidence, evidenceHash, "1".repeat(64)],
    );
    await admin.query(
      `insert into ai_content_proposal_research_attempt_events(
         research_attempt_id,job_id,workspace_id,brand_id,event_sequence,event_type,
         evidence_json,evidence_sha256,composition_sha256,previous_event_sha256,event_sha256
       ) values($1,$2,$3,$4,3,'attempt_succeeded',$5::jsonb,$6,$7,$8,$9)`,
      [researchAttempt.rows[0].id, job.rows[0].id, workspace.rows[0].id,
        brand.rows[0].id, evidence, evidenceHash, "2".repeat(64), "1".repeat(64), "3".repeat(64)],
    );
    await assert.rejects(admin.query("commit"), /proposal_research_success_composition_missing/);

    await admin.query("begin");
    await admin.query(
      `insert into ai_content_proposal_research_attempt_events(
         research_attempt_id,job_id,workspace_id,brand_id,event_sequence,event_type,
         evidence_json,evidence_sha256,event_sha256
       ) values($1,$2,$3,$4,2,'evidence_committed',$5::jsonb,$6,$7)`,
      [researchAttempt.rows[0].id, job.rows[0].id, workspace.rows[0].id,
        brand.rows[0].id, evidence, evidenceHash, "4".repeat(64)],
    );
    await admin.query(
      `insert into ai_content_proposal_research_attempt_events(
         research_attempt_id,job_id,workspace_id,brand_id,event_sequence,event_type,
         evidence_json,evidence_sha256,error_code,error_message,retryable,terminal,
         previous_event_sha256,event_sha256
       ) values($1,$2,$3,$4,3,'attempt_failed',$5::jsonb,$6,'research_failed',
         'research failed',true,false,$7,$8)`,
      [researchAttempt.rows[0].id, job.rows[0].id, workspace.rows[0].id,
        brand.rows[0].id, researchFailureEnvelope, researchFailureEnvelopeHash,
        "4".repeat(64), "5".repeat(64)],
    );
    await assert.rejects(admin.query("commit"), /proposal_research_failure_after_evidence_invalid/);

    const cutoverId = randomUUID();
    const canaryAttemptId = randomUUID();
    const operationKey = `cutover-canary:${cutoverId}:${canaryAttemptId}:topics`;
    const topicPayload = JSON.stringify([
      { title: "첫 주제", angle: "첫 관점" },
      { title: "둘째 주제", angle: "둘째 관점" },
      { title: "셋째 주제", angle: "셋째 관점" },
    ]);
    const topicCreate = await admin.query(
      "select * from create_ai_content_cutover_topic_upload($1,$2,null,$3,$4,$5::jsonb)",
      [workspace.rows[0].id, brand.rows[0].id, operationKey, "d".repeat(64), topicPayload],
    );
    const topicReplay = await admin.query(
      "select * from create_ai_content_cutover_topic_upload($1,$2,null,$3,$4,$5::jsonb)",
      [workspace.rows[0].id, brand.rows[0].id, operationKey, "d".repeat(64), topicPayload],
    );
    assert.deepEqual(topicReplay.rows, topicCreate.rows);
    const paddedTopicReplay = await admin.query(
      "select * from create_ai_content_cutover_topic_upload($1,$2,null,$3,$4,$5::jsonb)",
      [workspace.rows[0].id, brand.rows[0].id, operationKey, "d".repeat(64), JSON.stringify([
        { title: "  첫 주제 ", angle: "첫 관점  " },
        { title: "둘째 주제", angle: "둘째 관점" },
        { title: "셋째 주제", angle: "셋째 관점" },
      ])],
    );
    assert.deepEqual(paddedTopicReplay.rows, topicCreate.rows);
    await assert.rejects(
      admin.query(
        "select * from create_ai_content_cutover_topic_upload($1,$2,null,$3,$4,$5::jsonb)",
        [workspace.rows[0].id, brand.rows[0].id, operationKey, "d".repeat(64), JSON.stringify([
          { title: "변경된 주제", angle: "첫 관점" },
          { title: "둘째 주제", angle: "둘째 관점" },
          { title: "셋째 주제", angle: "셋째 관점" },
        ])],
      ),
      /topic_upload_operation_conflict/,
    );
    assert.equal(topicCreate.rows[0].topic_row_ids.length, 3);
    const otherWorkspace = await admin.query(
      "insert into workspaces(name,slug) values('075 PG replay conflict',$1) returning id",
      [`cutover-replay-conflict-${randomUUID()}`],
    );
    await assert.rejects(
      admin.query(
        "select * from create_ai_content_cutover_topic_upload($1,$2,null,$3,$4,$5::jsonb)",
        [otherWorkspace.rows[0].id, brand.rows[0].id, operationKey, "d".repeat(64), topicPayload],
      ),
      /topic_upload_operation_conflict/,
    );
    await assert.rejects(
      admin.query(
        `insert into topic_uploads(
           workspace_id,brand_id,file_name,file_mime_type,status,total_rows,valid_rows,
           duplicate_rows,invalid_rows,operation_key,request_fingerprint
         ) values($1,$2,'pair.json','application/json','validated',3,3,0,0,$3,null)`,
        [workspace.rows[0].id, brand.rows[0].id, `${operationKey}:pair`],
      ),
      /topic_uploads_operation_identity_check/,
    );
    for (const [invalidOperationKey, invalidFingerprint, invalidTopics] of [
      [null, "d".repeat(64), topicPayload],
      [operationKey, null, topicPayload],
      [operationKey, "d".repeat(64), null],
      [operationKey, "d".repeat(64), "[]"],
    ]) {
      await assert.rejects(
        admin.query(
          "select * from create_ai_content_cutover_topic_upload($1,$2,null,$3,$4,$5::jsonb)",
          [workspace.rows[0].id, brand.rows[0].id, invalidOperationKey,
            invalidFingerprint, invalidTopics],
        ),
        /topic_upload_operation_invalid/,
      );
    }
    await assert.rejects(
      admin.query(
        "select * from create_ai_content_cutover_topic_upload($1,$2,null,$3,$4,$5::jsonb)",
        [workspace.rows[0].id, brand.rows[0].id, operationKey, "e".repeat(64), topicPayload],
      ),
      /topic_upload_operation_conflict/,
    );

    const invalidFailedRun = await admin.query(
      `insert into automated_content_proposal_runs(
         workspace_id,brand_id,caller_operation_key,request_fingerprint_sha256,caller_transaction_id
       ) values($1,$2,$3,$4,$5) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, `failed-shape:${randomUUID()}`, hash, randomUUID()],
    );
    await assert.rejects(
      admin.query(
        `insert into automated_content_proposal_runs(
           workspace_id,brand_id,caller_operation_key,request_fingerprint_sha256,
           caller_transaction_id,status,error_code,error_message,terminal_at
         ) values($1,$2,$3,$4,$5,'failed','forged','forged terminal state',now())`,
        [workspace.rows[0].id, brand.rows[0].id, `forged-terminal:${randomUUID()}`, hash, randomUUID()],
      ),
      /automated_content_proposal_run_initial_status_invalid/,
    );
    await assert.rejects(
      admin.query(
        `select transition_automated_content_proposal_run(
           $1,'queued','failed',null,$2,null,'fixture_failed','fixture failed'
         )`,
        [invalidFailedRun.rows[0].id, randomUUID()],
      ),
      /automated_content_proposal_run_transition_arguments_invalid/,
    );
    const queuedFailedRun = await admin.query(
      `insert into automated_content_proposal_runs(
         workspace_id,brand_id,caller_operation_key,request_fingerprint_sha256,caller_transaction_id
       ) values($1,$2,$3,$4,$5) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, `queued-failed-batch:${randomUUID()}`, hash, randomUUID()],
    );
    await assert.rejects(
      admin.query(
        "select transition_automated_content_proposal_run($1,'queued','failed',$2,null,null,'fixture_failed','fixture failed')",
        [queuedFailedRun.rows[0].id, otherBatch.rows[0].id],
      ),
      /automated_content_proposal_run_transition_arguments_invalid/,
    );
    const dismissedProposal = await admin.query(
      `insert into ai_content_proposals(
         workspace_id,brand_id,batch_id,position,proposal_json,status
       ) values($1,$2,$3,3,'{}'::jsonb,'suggested') returning id`,
      [workspace.rows[0].id, brand.rows[0].id, otherBatch.rows[0].id],
    );
    const invalidDismissedRun = await admin.query(
      `insert into automated_content_proposal_runs(
         workspace_id,brand_id,caller_operation_key,request_fingerprint_sha256,caller_transaction_id
       ) values($1,$2,$3,$4,$5) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, `dismissed-shape:${randomUUID()}`, hash, randomUUID()],
    );
    await admin.query(
      "select transition_automated_content_proposal_run($1,'queued','ready',$2,null,null,null,null)",
      [invalidDismissedRun.rows[0].id, otherBatch.rows[0].id],
    );
    await assert.rejects(
      admin.query(
        "update automated_content_proposal_runs set proposal_batch_id=$2 where id=$1",
        [invalidDismissedRun.rows[0].id, batch.rows[0].id],
      ),
      /automated_content_proposal_run_batch_immutable/,
    );
    await assert.rejects(
      admin.query(
        "select transition_automated_content_proposal_run($1,'ready','dismissed',$2,null,null,null,null)",
        [invalidDismissedRun.rows[0].id, batch.rows[0].id],
      ),
      /automated_content_proposal_run_batch_conflict/,
    );
    await assert.rejects(
      admin.query(
        `select transition_automated_content_proposal_run(
           $1,'ready','dismissed',$2,$3,null,null,null
         )`,
        [invalidDismissedRun.rows[0].id, otherBatch.rows[0].id, dismissedProposal.rows[0].id],
      ),
      /automated_content_proposal_run_transition_arguments_invalid/,
    );

    const composedInput = JSON.stringify({ contractVersion: "proposal-input.v2" });
    const composedInputHash = (await admin.query(
      "select encode(digest($1::jsonb::text,'sha256'),'hex') as hash",
      [composedInput],
    )).rows[0].hash;
    await assert.rejects(
      admin.query(
        `select * from complete_ai_content_proposal_research(
           $1,$2,$3::jsonb,$4,$5::jsonb,$6,$7
         )`,
        [researchAttempt.rows[0].id, researchLease, evidence, evidenceHash,
          composedInput, "c".repeat(64), hash],
      ),
      /proposal_research_composed_input_hash_mismatch/,
    );
    assert.equal((await admin.query(
      "select count(*)::integer as count from ai_content_proposal_research_attempt_events where research_attempt_id=$1",
      [researchAttempt.rows[0].id],
    )).rows[0].count, 1);
    assert.equal((await admin.query(
      "select count(*)::integer as count from ai_content_proposal_compositions where job_id=$1",
      [job.rows[0].id],
    )).rows[0].count, 0);

    const completionSql = `select * from complete_ai_content_proposal_research(
      $1,$2,$3::jsonb,$4,$5::jsonb,$6,$7
    )`;
    const completionArgs = [researchAttempt.rows[0].id, researchLease, evidence,
      evidenceHash, composedInput, composedInputHash, hash];
    const concurrentCompletions = await Promise.allSettled([
      admin.query(completionSql, completionArgs),
      contender.query(completionSql, completionArgs),
    ]);
    assert.equal(concurrentCompletions.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrentCompletions.filter((result) => result.status === "rejected").length, 1);
    assert.match(
      concurrentCompletions.find((result) => result.status === "rejected").reason.message,
      /proposal_research_completion_(?:lease_mismatch|already_terminal)/,
    );
    const composition = concurrentCompletions.find((result) => result.status === "fulfilled").value;
    const researchEvents = await admin.query(
      `select event_sequence,event_type,event_sha256 from ai_content_proposal_research_attempt_events
        where research_attempt_id=$1 order by event_sequence`,
      [researchAttempt.rows[0].id],
    );
    assert.deepEqual(researchEvents.rows.map((row) => row.event_type), [
      "research_started", "evidence_committed", "attempt_succeeded",
    ]);
    const researchCommitted = { rows: [researchEvents.rows[1]] };
    const researchSucceeded = { rows: [researchEvents.rows[2]] };
    assert.notEqual(researchStarted.rows[0].event_sha256, researchCommitted.rows[0].event_sha256);
    assert.notEqual(researchCommitted.rows[0].event_sha256, researchSucceeded.rows[0].event_sha256);
    assert.deepEqual((await admin.query(
      `select status,active_stage,lease_owner,lease_token,lease_started_at,lease_expires_at
         from ai_content_proposal_jobs where id=$1`,
      [job.rows[0].id],
    )).rows, [{
      status: "queued", active_stage: null, lease_owner: null, lease_token: null,
      lease_started_at: null, lease_expires_at: null,
    }]);
    assert.equal((await admin.query(
      "select count(*)::integer as count from ai_content_proposal_compositions where job_id=$1",
      [job.rows[0].id],
    )).rows[0].count, 1);
    assert.deepEqual(
      (await admin.query(
        "select append_ai_content_proposal_research_attempt_event($1,$2,3,'attempt_succeeded',$3,$4::jsonb,$5,$6) as event_sha256",
        [researchAttempt.rows[0].id, researchLease, composition.rows[0].id,
          evidence, evidenceHash, composedInputHash],
      )).rows,
      [{ event_sha256: researchSucceeded.rows[0].event_sha256 }],
    );
    await assert.rejects(
      admin.query(
        "select append_ai_content_proposal_research_attempt_event($1,$2,3,'attempt_succeeded',$3,$4::jsonb,$5,$6)",
        [researchAttempt.rows[0].id, researchLease, composition.rows[0].id,
          evidence, evidenceHash, "e".repeat(64)],
      ),
      /proposal_research_event_replay_conflict/,
    );
    await assert.rejects(
      admin.query(
        "select append_ai_content_proposal_research_attempt_event($1,$2,4,'attempt_failed',null,$3::jsonb,$4,null)",
        [researchAttempt.rows[0].id, researchLease, researchFailureEnvelope, researchFailureEnvelopeHash],
      ),
      /proposal_research_attempt_terminal/,
    );
    await assert.rejects(
      admin.query(
        "update ai_content_proposal_research_attempt_events set event_type='attempt_failed' where research_attempt_id=$1 and event_sequence=3",
        [researchAttempt.rows[0].id],
      ),
      /ai_content_cutover_record_immutable/,
    );

    const modelLease = randomUUID();
    const modelLeaseHash = (await admin.query(
      "select encode(digest($1::uuid::text,'sha256'),'hex') as hash",
      [modelLease],
    )).rows[0].hash;
    await admin.query(
      `update ai_content_proposal_jobs set status='processing',active_stage='model',
         lease_owner='worker-1',lease_token=$2,lease_started_at=now(),
         lease_expires_at=now()+interval '5 minutes',completed_at=null,error_code=null,error_message=null
       where id=$1`,
      [job.rows[0].id, modelLease],
    );
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposal_model_attempts(
           job_id,contract_id,composition_id,workspace_id,brand_id,attempt_number,
           worker_id,lease_token_sha256,aggregate_contract_sha256,model_id,
           model_sha256,command_descriptor_sha256,proposal_output_schema_sha256,composed_input_sha256
         ) values($1,$2,$3,$4,$5,99,'bad-worker',$6,$7,'gpt-5.6-terra',$7,$7,$8,$7)`,
        [job.rows[0].id, contract.rows[0].id, composition.rows[0].id,
          workspace.rows[0].id, brand.rows[0].id, modelLeaseHash, hash, proposalSchema],
      ),
      /proposal_model_attempt_contract_or_lease_mismatch/,
    );
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposal_model_attempts(
           job_id,contract_id,composition_id,workspace_id,brand_id,attempt_number,
           worker_id,lease_token_sha256,aggregate_contract_sha256,model_id,
           model_sha256,command_descriptor_sha256,proposal_output_schema_sha256,composed_input_sha256
         ) values($1,$2,$3,$4,$5,2,'worker-1',$6,$7,'gpt-5.6-terra',$7,$7,$8,$9)`,
        [job.rows[0].id, contract.rows[0].id, composition.rows[0].id,
          workspace.rows[0].id, brand.rows[0].id, modelLeaseHash, hash,
          proposalSchema, composedInputHash],
      ),
      /proposal_model_attempt_contract_or_lease_mismatch/,
    );
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposal_model_attempts(
           job_id,contract_id,composition_id,workspace_id,brand_id,attempt_number,
           worker_id,lease_token_sha256,aggregate_contract_sha256,model_id,
           model_sha256,command_descriptor_sha256,proposal_output_schema_sha256,composed_input_sha256,
           claimed_at
         ) values($1,$2,$3,$4,$5,1,'worker-1',$6,$7,'gpt-5.6-terra',$7,$7,$8,$9,
           now()+interval '1 minute')`,
        [job.rows[0].id, contract.rows[0].id, composition.rows[0].id,
          workspace.rows[0].id, brand.rows[0].id, modelLeaseHash, hash,
          proposalSchema, composedInputHash],
      ),
      /proposal_model_attempt_contract_or_lease_mismatch/,
    );
    const modelAttemptInsert = `insert into ai_content_proposal_model_attempts(
         job_id,contract_id,composition_id,workspace_id,brand_id,attempt_number,
         worker_id,lease_token_sha256,aggregate_contract_sha256,model_id,
         model_sha256,command_descriptor_sha256,proposal_output_schema_sha256,composed_input_sha256
       ) values($1,$2,$3,$4,$5,1,'worker-1',$6,$7,'gpt-5.6-terra',$7,$7,$8,$9)
       returning id`;
    const modelAttemptArgs = [job.rows[0].id, contract.rows[0].id, composition.rows[0].id,
      workspace.rows[0].id, brand.rows[0].id, modelLeaseHash, hash,
      proposalSchema, composedInputHash];
    const concurrentModelAttempts = await Promise.allSettled([
      admin.query(modelAttemptInsert, modelAttemptArgs),
      contender.query(modelAttemptInsert, modelAttemptArgs),
    ]);
    assert.equal(concurrentModelAttempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrentModelAttempts.filter((result) => result.status === "rejected").length, 1);
    assert.match(
      concurrentModelAttempts.find((result) => result.status === "rejected").reason.message,
      /proposal_model_attempt_contract_or_lease_mismatch/,
    );
    const attempt = concurrentModelAttempts.find((result) => result.status === "fulfilled").value;
    await assert.rejects(
      admin.query(
        `select append_ai_content_proposal_attempt_event(
           $1,$2,1,1,'invocation_started',$3,$3,$3,$4,null,null,null
         )`,
        [attempt.rows[0].id, randomUUID(), hash, composedInputHash],
      ),
      /proposal_model_lease_mismatch/,
    );
    const started = await admin.query(
      `select append_ai_content_proposal_attempt_event(
         $1,$2,1,1,'invocation_started',$3,$3,$3,$4,null,null,null
       ) as event_sha256`,
      [attempt.rows[0].id, modelLease, hash, composedInputHash],
    );
    const activeLeaseBefore = (await admin.query(
      `select status,active_stage,lease_owner,lease_token,lease_started_at
         from ai_content_proposal_jobs where id=$1`,
      [job.rows[0].id],
    )).rows[0];
    await assert.rejects(
      admin.query(
        `update ai_content_proposal_jobs set lease_owner='takeover-worker',lease_token=$2,
           lease_started_at=now(),lease_expires_at=now()+interval '5 minutes',updated_at=now()
         where id=$1`,
        [job.rows[0].id, randomUUID()],
      ),
      /proposal_active_invocation_lease_takeover_invalid/,
    );
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposal_model_attempts(
           job_id,contract_id,composition_id,workspace_id,brand_id,attempt_number,
           worker_id,lease_token_sha256,aggregate_contract_sha256,model_id,
           model_sha256,command_descriptor_sha256,proposal_output_schema_sha256,composed_input_sha256
         ) values($1,$2,$3,$4,$5,2,'worker-1',$6,$7,'gpt-5.6-terra',$7,$7,$8,$9)`,
        modelAttemptArgs,
      ),
      /proposal_model_attempt_unresolved_invocation/,
    );
    await admin.query(
      `update ai_content_proposal_jobs
          set lease_expires_at=clock_timestamp()+interval '5 minutes',updated_at=now()
        where id=$1`,
      [job.rows[0].id],
    );
    assert.deepEqual((await admin.query(
      `select status,active_stage,lease_owner,lease_token,lease_started_at
         from ai_content_proposal_jobs where id=$1`,
      [job.rows[0].id],
    )).rows[0], activeLeaseBefore);
    assert.equal((await admin.query(
      "select count(*)::integer as count from ai_content_proposal_attempt_events where job_id=$1 and event_type='invocation_started'",
      [job.rows[0].id],
    )).rows[0].count, 1);
    const completed = await admin.query(
      `select append_ai_content_proposal_attempt_event(
         $1,$2,2,1,'invocation_completed',$3,$3,$3,$4,$5,$5,$5,false
       ) as event_sha256`,
      [attempt.rows[0].id, modelLease, hash, composedInputHash, "b".repeat(64)],
    );
    assert.notEqual(started.rows[0].event_sha256, completed.rows[0].event_sha256);
    await assert.rejects(
      admin.query(
        `select append_ai_content_proposal_attempt_event(
           $1,$2,3,1,'attempt_succeeded',$3,$3,$3,$4,$5,$5,$5,false
         )`,
        [attempt.rows[0].id, modelLease, hash, composedInputHash, "b".repeat(64)],
      ),
      /proposal_attempt_success_precondition_invalid/,
    );
    await assert.rejects(
      admin.query(
        `select append_ai_content_proposal_attempt_event(
           $1,$2,3,3,'invocation_started',$3,$3,$3,$4,null,null,null
         )`,
        [attempt.rows[0].id, modelLease, hash, composedInputHash],
      ),
      /proposal_invocation_ordinal_invalid/,
    );
    await admin.query(
      `select append_ai_content_proposal_attempt_event(
         $1,$2,3,2,'invocation_started',$3,$3,$3,$4,null,null,null
       )`,
      [attempt.rows[0].id, modelLease, hash, composedInputHash],
    );
    await assert.rejects(
      admin.query(
        `select append_ai_content_proposal_attempt_event(
           $1,$2,4,1,'attempt_failed',$3,$3,$3,$4,$5,$5,$5,false
         )`,
        [attempt.rows[0].id, modelLease, hash, composedInputHash, "b".repeat(64)],
      ),
      /proposal_attempt_latest_invocation_not_terminal/,
    );
    const repairOutput = "d".repeat(64);
    await admin.query(
      `select append_ai_content_proposal_attempt_event(
         $1,$2,4,2,'invocation_completed',$3,$3,$3,$4,$5,$5,$5,true
       )`,
      [attempt.rows[0].id, modelLease, hash, composedInputHash, repairOutput],
    );
    const succeeded = await admin.query(
      `select append_ai_content_proposal_attempt_event(
         $1,$2,5,2,'attempt_succeeded',$3,$3,$3,$4,$5,$5,$5,true
       ) as event_sha256`,
      [attempt.rows[0].id, modelLease, hash, composedInputHash, repairOutput],
    );
    assert.deepEqual((await admin.query(
      `select append_ai_content_proposal_attempt_event(
         $1,$2,5,2,'attempt_succeeded',$3,$3,$3,$4,$5,$5,$5,true
       ) as event_sha256`,
      [attempt.rows[0].id, modelLease, hash, composedInputHash, repairOutput],
    )).rows, succeeded.rows);
    await assert.rejects(
      admin.query(
        `select append_ai_content_proposal_attempt_event(
           $1,$2,5,2,'attempt_succeeded',$3,$3,$3,$4,$5,$5,$6,true
         )`,
        [attempt.rows[0].id, modelLease, hash, composedInputHash, repairOutput, "e".repeat(64)],
      ),
      /proposal_attempt_event_replay_conflict/,
    );
    await assert.rejects(
      admin.query("update ai_content_proposal_model_attempts set worker_id='changed' where id=$1", [attempt.rows[0].id]),
      /ai_content_cutover_record_immutable/,
    );

    const draftGeneration = await admin.query(
      `insert into ai_content_generations(
         workspace_id,brand_id,purpose,output_format,title,status,current_stage,analysis_idempotency_key
       ) values($1,$2,'informational','blog','operation-less draft','draft','draft',$3)
       returning id,status,current_stage,operation_id`,
      [workspace.rows[0].id, brand.rows[0].id, randomUUID()],
    );
    assert.deepEqual(draftGeneration.rows, [{
      id: draftGeneration.rows[0].id, status: "draft", current_stage: "draft", operation_id: null,
    }]);
    await assert.rejects(
      admin.query(
        "update ai_content_generations set status='queued' where id=$1",
        [draftGeneration.rows[0].id],
      ),
      /ai_content_generation_operation_required_before_start/,
    );
    await assert.rejects(
      admin.query(
        "update ai_content_generations set generation_idempotency_key=$2 where id=$1",
        [draftGeneration.rows[0].id, randomUUID()],
      ),
      /ai_content_generation_operation_required_before_start/,
    );
    const generationId = randomUUID();
    const operationId = randomUUID();
    await assert.rejects(
      admin.query(
        `insert into ai_content_generation_operations(
           workspace_id,brand_id,operation_key,request_fingerprint_sha256,generation_id,status
         ) values($1,$2,$3,$4,$5,'completed')`,
        [workspace.rows[0].id, brand.rows[0].id, randomUUID(), hash, randomUUID()],
      ),
      /ai_content_generation_operation_initial_status_invalid/,
    );
    await admin.query("begin");
    await admin.query(
      `insert into ai_content_generation_operations(
         id,workspace_id,brand_id,operation_key,request_fingerprint_sha256,generation_id
       ) values($1,$2,$3,$4,$5,$6)`,
      [operationId, workspace.rows[0].id, brand.rows[0].id, randomUUID(), hash, generationId],
    );
    await admin.query(
      `insert into ai_content_generations(
         id,workspace_id,brand_id,purpose,output_format,title,analysis_idempotency_key,operation_id
       ) values($1,$2,$3,'informational','blog','bound generation',$4,$5)`,
      [generationId, workspace.rows[0].id, brand.rows[0].id, randomUUID(), operationId],
    );
    await admin.query("commit");

    const crossedGenerationA = randomUUID();
    const crossedGenerationB = randomUUID();
    const crossedOperationA = randomUUID();
    const crossedOperationB = randomUUID();
    await admin.query("begin");
    await admin.query(
      `insert into ai_content_generation_operations(
         id,workspace_id,brand_id,operation_key,request_fingerprint_sha256,generation_id
       ) values($1,$5,$6,$2,$7,$3),($4,$5,$6,$8,$7,$9)`,
      [crossedOperationA, randomUUID(), crossedGenerationA, crossedOperationB,
        workspace.rows[0].id, brand.rows[0].id, hash, randomUUID(), crossedGenerationB],
    );
    await admin.query(
      `insert into ai_content_generations(
         id,workspace_id,brand_id,purpose,output_format,title,analysis_idempotency_key,operation_id
       ) values($1,$3,$4,'informational','blog','cross-a',$5,$2),($6,$3,$4,'informational','blog','cross-b',$7,$8)`,
      [crossedGenerationA, crossedOperationB, workspace.rows[0].id, brand.rows[0].id,
        randomUUID(), crossedGenerationB, randomUUID(), crossedOperationA],
    );
    await assert.rejects(admin.query("commit"), /ai_content_generation_operation_identity_mismatch/);
    await admin.query("rollback");

    await assert.rejects(
      admin.query(
        `insert into ai_content_usage_ledger(
           workspace_id,brand_id,generation_id,usage_type,quantity,idempotency_key
         ) values($1,$2,$3,'generation',1,$4)`,
        [workspace.rows[0].id, brand.rows[0].id, generationId, randomUUID()],
      ),
      /ai_content_usage_ledger_new_identity_required/,
    );
    const reservationId = randomUUID();
    await admin.query(
      `insert into ai_content_usage_ledger(
         id,workspace_id,brand_id,generation_id,usage_type,quantity,usage_date,idempotency_key,
         operation_id,reservation_id
       ) values($1,$2,$3,$4,'generation',1,current_date,$5,$6,$1)`,
      [reservationId, workspace.rows[0].id, brand.rows[0].id, generationId, randomUUID(), operationId],
    );
    await assert.rejects(
      admin.query(
        "select transition_ai_content_generation_operation($1,'reserved','reversed')",
        [operationId],
      ),
      /ai_content_generation_operation_reversal_missing/,
    );
    await admin.query(
      `insert into ai_content_usage_ledger(
         workspace_id,brand_id,generation_id,usage_type,quantity,usage_date,idempotency_key,
         operation_id,reservation_id,reversal_of_ledger_id
       ) values($1,$2,$3,'reversal',-1,current_date,$4,$5,$6,$6)`,
      [workspace.rows[0].id, brand.rows[0].id, generationId, randomUUID(), operationId, reservationId],
    );
    await admin.query(
      "select transition_ai_content_generation_operation($1,'reserved','reversed')",
      [operationId],
    );

    const otherGenerationId = randomUUID();
    const otherOperationId = randomUUID();
    await admin.query("begin");
    await admin.query(
      `insert into ai_content_generation_operations(
         id,workspace_id,brand_id,operation_key,request_fingerprint_sha256,generation_id
       ) values($1,$2,$3,$4,$5,$6)`,
      [otherOperationId, workspace.rows[0].id, brand.rows[0].id, randomUUID(), hash, otherGenerationId],
    );
    await admin.query(
      `insert into ai_content_generations(
         id,workspace_id,brand_id,purpose,output_format,title,analysis_idempotency_key,operation_id
       ) values($1,$2,$3,'informational','blog','other parent',$4,$5)`,
      [otherGenerationId, workspace.rows[0].id, brand.rows[0].id, randomUUID(), otherOperationId],
    );
    await admin.query("commit");

    const badRetryGeneration = randomUUID();
    const badRetryOperation = randomUUID();
    await admin.query("begin");
    await admin.query(
      `insert into ai_content_generation_operations(
         id,workspace_id,brand_id,operation_key,request_fingerprint_sha256,generation_id,parent_operation_id
       ) values($1,$2,$3,$4,$5,$6,$7)`,
      [badRetryOperation, workspace.rows[0].id, brand.rows[0].id, randomUUID(), hash,
        badRetryGeneration, operationId],
    );
    await admin.query(
      `insert into ai_content_generations(
         id,workspace_id,brand_id,purpose,output_format,title,analysis_idempotency_key,operation_id,parent_generation_id
       ) values($1,$2,$3,'informational','blog','bad retry',$4,$5,$6)`,
      [badRetryGeneration, workspace.rows[0].id, brand.rows[0].id, randomUUID(),
        badRetryOperation, otherGenerationId],
    );
    await assert.rejects(admin.query("commit"), /ai_content_generation_retry_parent_invalid/);
    await admin.query("rollback");

    const actor = await admin.query(
      "insert into app_users(email) values($1) returning id",
      [`binding-${randomUUID()}@example.com`],
    );
    const informationalBlogProposal = {
      conceptKey: "blog-guide",
      title: "실전 가이드",
      informationalType: "how_to",
      oneLineIntent: "독자가 바로 실행할 수 있게 설명한다",
      differentiator: "근거와 실행 순서를 함께 제시한다",
      differentiationAxes: ["target"],
      target: "처음 시작하는 독자",
      customerContext: "정확한 실행 순서가 필요하다",
      keyMessage: "검증된 순서를 따르면 시행착오를 줄일 수 있다",
      hook: "무엇부터 시작해야 할까요?",
      selectionReason: "정보성 블로그 목적과 형식에 맞는다",
      evidenceIds: [randomUUID()],
      referenceIds: [],
      outputFormat: "blog",
      channelTargets: ["blog_export"],
      assetCount: null,
      outline: [{ index: 1, role: "article", headline: "실행 순서", purpose: "단계별 안내" }],
      purposeDetails: {
        kind: "informational",
        question: "어떻게 시작해야 하나요?",
        value: "실행 가능한 단계별 답변",
        whyNow: "지금 바로 적용할 수 있다",
        learningPoints: ["첫 단계를 선택하는 법"],
      },
    };
    const selectedProposal = await admin.query(
      `insert into ai_content_proposals(
         workspace_id,brand_id,batch_id,position,proposal_json,status,generation_id,
         selected_by_user_id,selected_at,successful_model_attempt_id,
         successful_proposal_job_id,final_invocation_ordinal
       ) values($1,$2,$3,1,$8::jsonb,'selected',$4,$5,now(),$6,$7,2) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, batch.rows[0].id, generationId,
        actor.rows[0].id, attempt.rows[0].id, job.rows[0].id,
        JSON.stringify(informationalBlogProposal)],
    );
    const binding = {
      contractVersion: "content-prompt-binding.v1", outputFormat: "blog", purpose: "informational",
      proposalRequestVersion: "content-proposal-request.v2", proposalBaseInputVersion: "proposal-base-input.v2",
      proposalComposedInputVersion: "proposal-input.v2", proposalOutputVersion: "content-proposal.v2",
      proposalPromptVersion: "proposal.writer.v2", proposalSchemaSha256: proposalSchema,
      generationInputVersion: "content-generation-input.v3",
      generationSchemaSha256: "9977b52a0b15d581cf529c3c034eb2670c361fd03434f5c3231a798c6f668ffd",
      planContractVersion: "blog-plan.v2",
      planSchemaSha256: "03ceeed94fdda02f3935a37868a5c159a456d467200486236ecc968163794c82",
      plannerPromptVersion: "planner.blog.informational.v1",
      imagePackageVersion: "image-generation-package.v1",
      imagePromptVersion: "image.blog.informational.v1", manifestVersion: "ai-content.v3",
      contractSourceHash: contractSource, model: "gpt-5.6-terra",
    };
    const unselectedProposal = await admin.query(
      `insert into ai_content_proposals(
         workspace_id,brand_id,batch_id,position,proposal_json,status
       ) values($1,$2,$3,1,'{}'::jsonb,'suggested') returning id`,
      [workspace.rows[0].id, brand.rows[0].id, otherBatch.rows[0].id],
    );
    await assert.rejects(
      admin.query(
        `update ai_content_proposals set status='selected',generation_id=$2,
           selected_by_user_id=$3,selected_at=now() where id=$1`,
        [unselectedProposal.rows[0].id, otherGenerationId, actor.rows[0].id],
      ),
      /ai_content_proposal_success_binding_required/,
    );
    await assert.rejects(
      admin.query(
        "select create_ai_content_generation_prompt_binding($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
        [generationId, workspace.rows[0].id, brand.rows[0].id, unselectedProposal.rows[0].id,
          job.rows[0].id, contract.rows[0].id, attempt.rows[0].id, JSON.stringify(binding)],
      ),
      /ai_content_prompt_binding_source_mismatch/,
    );
    await assert.rejects(
      admin.query(
        "select create_ai_content_generation_prompt_binding($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
        [generationId, workspace.rows[0].id, brand.rows[0].id, selectedProposal.rows[0].id,
          job.rows[0].id, contract.rows[0].id, attempt.rows[0].id,
          JSON.stringify({
            ...binding, outputFormat: "reel", planContractVersion: "reel-plan.v2",
            planSchemaSha256: "bcefb5d1810d43c8e6d36561000711240783892cb79ac8b62c64936fb49f55aa",
            plannerPromptVersion: "planner.reel.informational.v1",
            imagePromptVersion: "image.reel.informational.v1",
          })],
      ),
      /ai_content_prompt_binding_source_mismatch/,
    );
    await assert.rejects(
      admin.query(
        "select create_ai_content_generation_prompt_binding($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
        [generationId, workspace.rows[0].id, brand.rows[0].id, selectedProposal.rows[0].id,
          job.rows[0].id, contract.rows[0].id, attempt.rows[0].id,
          JSON.stringify({ ...binding, generationSchemaSha256: "e".repeat(64) })],
      ),
      /generation_schema_sha256_check/,
    );
    await assert.rejects(
      admin.query(
        "select create_ai_content_generation_prompt_binding($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
        [generationId, workspace.rows[0].id, brand.rows[0].id, selectedProposal.rows[0].id,
          job.rows[0].id, contract.rows[0].id, attempt.rows[0].id,
          JSON.stringify({ ...binding, extra: true })],
      ),
      /ai_content_generation_prompt_bindings_json_check/,
    );
    const requiredBindingKeys = [
      "contractVersion", "outputFormat", "purpose", "proposalRequestVersion",
      "proposalBaseInputVersion", "proposalComposedInputVersion", "proposalOutputVersion",
      "proposalPromptVersion", "proposalSchemaSha256", "generationInputVersion",
      "generationSchemaSha256", "planContractVersion", "planSchemaSha256",
      "plannerPromptVersion", "imagePackageVersion", "imagePromptVersion",
      "manifestVersion", "contractSourceHash", "model",
    ];
    const directBindingInsert = `insert into ai_content_generation_prompt_bindings(
      generation_id,workspace_id,brand_id,selected_proposal_id,proposal_job_id,
      proposal_contract_id,successful_model_attempt_id,final_invocation_ordinal,
      contract_version,output_format,purpose,proposal_request_version,
      proposal_base_input_version,proposal_composed_input_version,proposal_output_version,
      proposal_prompt_version,proposal_schema_sha256,generation_input_version,
      generation_schema_sha256,plan_contract_version,plan_schema_sha256,
      planner_prompt_version,image_package_version,image_prompt_version,manifest_version,
      contract_source_hash,model,binding_json,binding_sha256
    ) values($1,$2,$3,$4,$5,$6,$7,2,
      $8::jsonb->>'contractVersion',$8::jsonb->>'outputFormat',$8::jsonb->>'purpose',
      $8::jsonb->>'proposalRequestVersion',$8::jsonb->>'proposalBaseInputVersion',
      $8::jsonb->>'proposalComposedInputVersion',$8::jsonb->>'proposalOutputVersion',
      $8::jsonb->>'proposalPromptVersion',$8::jsonb->>'proposalSchemaSha256',
      $8::jsonb->>'generationInputVersion',$8::jsonb->>'generationSchemaSha256',
      $8::jsonb->>'planContractVersion',$8::jsonb->>'planSchemaSha256',
      $8::jsonb->>'plannerPromptVersion',$8::jsonb->>'imagePackageVersion',
      $8::jsonb->>'imagePromptVersion',$8::jsonb->>'manifestVersion',
      $8::jsonb->>'contractSourceHash',$8::jsonb->>'model',$9::jsonb,
      encode(digest($9::jsonb::text,'sha256'),'hex'))`;
    for (const key of requiredBindingKeys) {
      const withNull = { ...binding, [key]: null };
      await assert.rejects(
        admin.query(directBindingInsert, [
          generationId, workspace.rows[0].id, brand.rows[0].id, selectedProposal.rows[0].id,
          job.rows[0].id, contract.rows[0].id, attempt.rows[0].id,
          JSON.stringify(binding), JSON.stringify(withNull),
        ]),
        /ai_content_generation_prompt_bindings_json_check/,
        `${key}=null must fail closed`,
      );
    }
    const bindingCreated = await admin.query(
      "select create_ai_content_generation_prompt_binding($1,$2,$3,$4,$5,$6,$7,$8::jsonb) as id",
      [generationId, workspace.rows[0].id, brand.rows[0].id, selectedProposal.rows[0].id,
        job.rows[0].id, contract.rows[0].id, attempt.rows[0].id, JSON.stringify(binding)],
    );
    assert.match(bindingCreated.rows[0].id, /^[0-9a-f-]{36}$/);

    const childGenerationId = randomUUID();
    const childOperationId = randomUUID();
    await admin.query("begin");
    await admin.query(
      `insert into ai_content_generation_operations(
         id,workspace_id,brand_id,operation_key,request_fingerprint_sha256,generation_id,parent_operation_id
       ) values($1,$2,$3,$4,$5,$6,$7)`,
      [childOperationId, workspace.rows[0].id, brand.rows[0].id, randomUUID(), hash,
        childGenerationId, operationId],
    );
    await admin.query(
      `insert into ai_content_generations(
         id,workspace_id,brand_id,purpose,output_format,title,analysis_idempotency_key,
         operation_id,parent_generation_id
       ) values($1,$2,$3,'informational','blog','retry child',$4,$5,$6)`,
      [childGenerationId, workspace.rows[0].id, brand.rows[0].id, randomUUID(),
        childOperationId, generationId],
    );
    await admin.query("commit");
    const childBinding = await admin.query(
      "select create_ai_content_generation_prompt_binding($1,$2,$3,$4,$5,$6,$7,$8::jsonb) as id",
      [childGenerationId, workspace.rows[0].id, brand.rows[0].id, selectedProposal.rows[0].id,
        job.rows[0].id, contract.rows[0].id, attempt.rows[0].id, JSON.stringify(binding)],
    );
    assert.deepEqual((await admin.query(
      `select parent_binding_id,selected_proposal_id,proposal_job_id,proposal_contract_id,
              successful_model_attempt_id,final_invocation_ordinal,binding_json,binding_sha256
         from ai_content_generation_prompt_bindings where id=$1`,
      [childBinding.rows[0].id],
    )).rows, [{
      parent_binding_id: bindingCreated.rows[0].id,
      selected_proposal_id: selectedProposal.rows[0].id,
      proposal_job_id: job.rows[0].id,
      proposal_contract_id: contract.rows[0].id,
      successful_model_attempt_id: attempt.rows[0].id,
      final_invocation_ordinal: 2,
      binding_json: binding,
      binding_sha256: (await admin.query(
        "select encode(digest($1::jsonb::text,'sha256'),'hex') as hash",
        [JSON.stringify(binding)],
      )).rows[0].hash,
    }]);

    const indeterminateBatch = await admin.query(
      `insert into ai_content_proposal_batches(
         workspace_id,brand_id,origin,purpose,request_json,source_snapshot_json,idempotency_key
       ) values($1,$2,'manual','informational','{}'::jsonb,'[]'::jsonb,$3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, randomUUID()],
    );
    await admin.query("begin");
    const indeterminateJob = await admin.query(
      "insert into ai_content_proposal_jobs(workspace_id,brand_id,batch_id) values($1,$2,$3) returning id",
      [workspace.rows[0].id, brand.rows[0].id, indeterminateBatch.rows[0].id],
    );
    const indeterminateContract = await admin.query(
      `insert into ai_content_proposal_job_contracts(
         job_id,batch_id,workspace_id,brand_id,request_contract_version,
         base_input_contract_version,research_contract_version,proposal_contract_version,
         proposal_prompt_version,proposal_output_schema_sha256,proposal_model_id,
         command_descriptor_sha256,request_sha256,base_input_sha256,
         contract_source_sha256,catalog_sha256,enqueue_contract_sha256
       ) values($1,$2,$3,$4,'content-proposal-request.v2','proposal-base-input.v2',
         'research-evidence.v1','content-proposal.v2','proposal.writer.v2',$5,
         'gpt-5.6-terra',$6,$6,$6,$7,$8,$6) returning id`,
      [indeterminateJob.rows[0].id, indeterminateBatch.rows[0].id,
        workspace.rows[0].id, brand.rows[0].id, proposalSchema, hash, contractSource, catalogSha],
    );
    await admin.query("commit");
    const performanceAudit = await admin.query(
      `insert into ai_content_proposal_performance_audits(
         workspace_id,brand_id,batch_id,experiment_id,experiment_definition_json,
         evidence_version,resolved_input_fingerprint_sha256,snapshot_audit_json,captured_from,captured_to
       ) values($1,$2,$3,$4,'{}'::jsonb,'performance-evidence.v1',$5,'{}'::jsonb,now(),now()) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, indeterminateBatch.rows[0].id, randomUUID(), hash],
    );
    const performanceEvidenceHash = (await admin.query(
      "select encode(digest('[{}]'::jsonb::text,'sha256'),'hex') as hash",
    )).rows[0].hash;
    assert.notEqual(performanceEvidenceHash, hash);
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposal_compositions(
           job_id,batch_id,contract_id,performance_audit_id,workspace_id,brand_id,research_evidence_json,
           research_evidence_set_sha256,composed_input_json,composed_input_sha256,
           final_invocation_aggregate_sha256
         ) values($1,$2,$3,$4,$5,$6,'[{}]'::jsonb,$7,'{}'::jsonb,$8,$9)`,
        [indeterminateJob.rows[0].id, indeterminateBatch.rows[0].id,
          indeterminateContract.rows[0].id, performanceAudit.rows[0].id,
          workspace.rows[0].id, brand.rows[0].id, performanceEvidenceHash, composedInputHash, hash],
      ),
      /ai_content_proposal_compositions_input_contract_check/,
    );
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposal_compositions(
           job_id,batch_id,contract_id,performance_audit_id,workspace_id,brand_id,research_evidence_json,
           research_evidence_set_sha256,composed_input_json,composed_input_sha256,
           final_invocation_aggregate_sha256
         ) values($1,$2,$3,$4,$5,$6,'[{"rogue":true}]'::jsonb,$7,
           '{"contractVersion":"proposal-input.v2"}'::jsonb,$8,$9)`,
        [indeterminateJob.rows[0].id, indeterminateBatch.rows[0].id,
          indeterminateContract.rows[0].id, performanceAudit.rows[0].id,
          workspace.rows[0].id, brand.rows[0].id, "e".repeat(64), composedInputHash, hash],
      ),
      /proposal_composition_performance_audit_mismatch/,
    );
    const indeterminateComposition = await admin.query(
      `insert into ai_content_proposal_compositions(
         job_id,batch_id,contract_id,performance_audit_id,workspace_id,brand_id,research_evidence_json,
         research_evidence_set_sha256,composed_input_json,composed_input_sha256,
         final_invocation_aggregate_sha256
       ) values($1,$2,$3,$4,$5,$6,'[{}]'::jsonb,$7,
         '{"contractVersion":"proposal-input.v2"}'::jsonb,$8,$9) returning id`,
      [indeterminateJob.rows[0].id, indeterminateBatch.rows[0].id,
        indeterminateContract.rows[0].id, performanceAudit.rows[0].id,
        workspace.rows[0].id, brand.rows[0].id, performanceEvidenceHash, composedInputHash, hash],
    );
    const indeterminateLease = randomUUID();
    const indeterminateLeaseHash = (await admin.query(
      "select encode(digest($1::uuid::text,'sha256'),'hex') as hash",
      [indeterminateLease],
    )).rows[0].hash;
    await admin.query(
      `update ai_content_proposal_jobs set status='processing',active_stage='model',
         lease_owner='indeterminate-worker',lease_token=$2,lease_started_at=now(),
         lease_expires_at=clock_timestamp()+interval '1 second' where id=$1`,
      [indeterminateJob.rows[0].id, indeterminateLease],
    );
    const indeterminateAttempt = await admin.query(
      `insert into ai_content_proposal_model_attempts(
         job_id,contract_id,composition_id,workspace_id,brand_id,attempt_number,
         worker_id,lease_token_sha256,aggregate_contract_sha256,model_id,
         model_sha256,command_descriptor_sha256,proposal_output_schema_sha256,composed_input_sha256
       ) values($1,$2,$3,$4,$5,1,'indeterminate-worker',$6,$7,'gpt-5.6-terra',$7,$7,$8,$9)
       returning id`,
      [indeterminateJob.rows[0].id, indeterminateContract.rows[0].id,
        indeterminateComposition.rows[0].id, workspace.rows[0].id, brand.rows[0].id,
        indeterminateLeaseHash, hash, proposalSchema, composedInputHash],
    );
    await admin.query(
      `select append_ai_content_proposal_attempt_event(
         $1,$2,1,1,'invocation_started',$3,$3,$3,$4,null,null,null
       )`,
      [indeterminateAttempt.rows[0].id, indeterminateLease, hash, composedInputHash],
    );
    await admin.query("select pg_sleep(1.1)");
    await admin.query(
      `update ai_content_proposal_jobs
          set status='queued',available_at=clock_timestamp(),active_stage=null,
              lease_owner=null,lease_token=null,lease_started_at=null,lease_expires_at=null,
              updated_at=now()
        where id=$1 and status='processing' and lease_expires_at<=clock_timestamp()`,
      [indeterminateJob.rows[0].id],
    );
    assert.deepEqual((await admin.query(
      `select status,active_stage,lease_token,error_code,error_message,completed_at is not null as completed
         from ai_content_proposal_jobs where id=$1`,
      [indeterminateJob.rows[0].id],
    )).rows, [{
      status: "manual_review_required", active_stage: null, lease_token: null,
      error_code: "invocation_indeterminate",
      error_message: "model invocation outcome is indeterminate",
      completed: true,
    }]);
    assert.deepEqual((await admin.query(
      `select event_type,invocation_ordinal
         from ai_content_proposal_attempt_events
        where model_attempt_id=$1 order by event_sequence`,
      [indeterminateAttempt.rows[0].id],
    )).rows, [{ event_type: "invocation_started", invocation_ordinal: 1 }]);
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposal_model_attempts(
           job_id,contract_id,composition_id,workspace_id,brand_id,attempt_number,
           worker_id,lease_token_sha256,aggregate_contract_sha256,model_id,
           model_sha256,command_descriptor_sha256,proposal_output_schema_sha256,composed_input_sha256
         ) values($1,$2,$3,$4,$5,2,'future-worker',$6,$7,'gpt-5.6-terra',$7,$7,$8,$9)`,
        [indeterminateJob.rows[0].id, indeterminateContract.rows[0].id,
          indeterminateComposition.rows[0].id, workspace.rows[0].id, brand.rows[0].id,
          indeterminateLeaseHash, hash, proposalSchema, composedInputHash],
      ),
      /proposal_model_attempt_(?:unresolved_invocation|contract_or_lease_mismatch)/,
    );
    await assert.rejects(
      admin.query(
        `select append_ai_content_proposal_attempt_event(
           $1,$2,2,2,'invocation_started',$3,$3,$3,$4,null,null,null
         )`,
        [indeterminateAttempt.rows[0].id, indeterminateLease, hash, composedInputHash],
      ),
      /proposal_model_lease_mismatch/,
    );
    assert.equal((await admin.query(
      "select count(*)::integer as count from ai_content_proposal_model_attempts where job_id=$1",
      [indeterminateJob.rows[0].id],
    )).rows[0].count, 1);
    await assert.rejects(
      admin.query(
        `update ai_content_proposal_jobs set status='queued',error_code=null,error_message=null,
           completed_at=null where id=$1`,
        [indeterminateJob.rows[0].id],
      ),
      /proposal_invocation_manual_review_immutable/,
    );

    const preSpawnBatch = await admin.query(
      `insert into ai_content_proposal_batches(
         workspace_id,brand_id,origin,purpose,request_json,source_snapshot_json,idempotency_key
       ) values($1,$2,'manual','informational','{}'::jsonb,'[]'::jsonb,$3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, randomUUID()],
    );
    await admin.query("begin");
    const preSpawnJob = await admin.query(
      "insert into ai_content_proposal_jobs(workspace_id,brand_id,batch_id) values($1,$2,$3) returning id",
      [workspace.rows[0].id, brand.rows[0].id, preSpawnBatch.rows[0].id],
    );
    await admin.query(
      `insert into ai_content_proposal_job_contracts(
         job_id,batch_id,workspace_id,brand_id,request_contract_version,
         base_input_contract_version,research_contract_version,proposal_contract_version,
         proposal_prompt_version,proposal_output_schema_sha256,proposal_model_id,
         command_descriptor_sha256,request_sha256,base_input_sha256,
         contract_source_sha256,catalog_sha256,enqueue_contract_sha256
       ) values($1,$2,$3,$4,'content-proposal-request.v2','proposal-base-input.v2',
         'research-evidence.v1','content-proposal.v2','proposal.writer.v2',$5,
         'gpt-5.6-terra',$6,$6,$6,$7,$8,$6)`,
      [preSpawnJob.rows[0].id, preSpawnBatch.rows[0].id,
        workspace.rows[0].id, brand.rows[0].id, proposalSchema, hash, contractSource, catalogSha],
    );
    await admin.query("commit");
    await admin.query(
      `update ai_content_proposal_jobs set status='processing',active_stage='model',
         lease_owner='pre-spawn-worker',lease_token=$2,lease_started_at=now()-interval '10 minutes',
         lease_expires_at=now()-interval '1 second' where id=$1`,
      [preSpawnJob.rows[0].id, randomUUID()],
    );
    await admin.query(
      `update ai_content_proposal_jobs set status='queued',available_at=clock_timestamp(),active_stage=null,
         lease_owner=null,lease_token=null,lease_started_at=null,lease_expires_at=null,updated_at=now()
       where id=$1 and status='processing' and lease_expires_at<=clock_timestamp()`,
      [preSpawnJob.rows[0].id],
    );
    assert.deepEqual((await admin.query(
      "select status,error_code,completed_at from ai_content_proposal_jobs where id=$1",
      [preSpawnJob.rows[0].id],
    )).rows, [{ status: "queued", error_code: null, completed_at: null }]);

    const forgedManualBatch = await admin.query(
      `insert into ai_content_proposal_batches(
         workspace_id,brand_id,origin,purpose,request_json,source_snapshot_json,idempotency_key
       ) values($1,$2,'manual','informational','{}'::jsonb,'[]'::jsonb,$3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, randomUUID()],
    );
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposal_jobs(
           workspace_id,brand_id,batch_id,status,error_code,error_message,completed_at
         ) values($1,$2,$3,'manual_review_required','invocation_indeterminate',
           'model invocation outcome is indeterminate',now())`,
        [workspace.rows[0].id, brand.rows[0].id, forgedManualBatch.rows[0].id],
      ),
      /proposal_invocation_manual_review_evidence_missing/,
    );
    await assert.rejects(
      admin.query(
        `insert into ai_content_proposals(
           workspace_id,brand_id,batch_id,position,proposal_json,status,generation_id,
           selected_by_user_id,selected_at,successful_model_attempt_id,
           successful_proposal_job_id,final_invocation_ordinal
         ) values($1,$2,$3,1,$8::jsonb,'selected',$4,$5,now(),$6,$7,1)`,
        [workspace.rows[0].id, brand.rows[0].id, indeterminateBatch.rows[0].id,
          otherGenerationId, actor.rows[0].id, indeterminateAttempt.rows[0].id,
          indeterminateJob.rows[0].id,
          JSON.stringify(informationalBlogProposal)],
      ),
      /ai_content_proposal_success_event_missing/,
    );

    const researchFailureFixture = await createProposalJobFixture("research-terminal");
    const researchFailureLease = randomUUID();
    const researchFailureLeaseHash = (await admin.query(
      "select encode(digest($1::uuid::text,'sha256'),'hex') as hash",
      [researchFailureLease],
    )).rows[0].hash;
    await admin.query(
      `update ai_content_proposal_batches set status='building' where id=$1`,
      [researchFailureFixture.batch.id],
    );
    await admin.query(
      `update ai_content_proposal_jobs set status='processing',active_stage='research',
         lease_owner='research-failure-worker',lease_token=$2,lease_started_at=now(),
         lease_expires_at=now()+interval '5 minutes' where id=$1`,
      [researchFailureFixture.job.id, researchFailureLease],
    );
    const researchFailureAttempt = await admin.query(
      `insert into ai_content_proposal_research_attempts(
         job_id,contract_id,workspace_id,brand_id,attempt_number,worker_id,
         lease_token_sha256,enqueue_contract_sha256,base_input_sha256,lease_expires_at
       ) select $1,$2,$3,$4,1,'research-failure-worker',$5,$6,$6,lease_expires_at
           from ai_content_proposal_jobs where id=$1 returning id`,
      [researchFailureFixture.job.id, researchFailureFixture.contract.id,
        workspace.rows[0].id, brand.rows[0].id, researchFailureLeaseHash, hash],
    );
    await admin.query(
      "select append_ai_content_proposal_research_attempt_event($1,$2,1,'research_started',null,null,null,null)",
      [researchFailureAttempt.rows[0].id, researchFailureLease],
    );
    const terminalResearchFailure = JSON.stringify({
      errorCode: "research_unavailable", errorMessage: "provider unavailable", retryable: false,
    });
    const terminalResearchFailureHash = (await admin.query(
      "select encode(digest($1::jsonb::text,'sha256'),'hex') as hash",
      [terminalResearchFailure],
    )).rows[0].hash;
    await assert.rejects(
      admin.query(
        `select append_ai_content_proposal_research_attempt_event(
           $1,$2,2,'attempt_failed',null,$3::jsonb,$4,null)`,
        [researchFailureAttempt.rows[0].id, randomUUID(),
          terminalResearchFailure, terminalResearchFailureHash],
      ),
      /proposal_research_lease_mismatch/,
    );
    const researchFailureEvent = await admin.query(
      `select append_ai_content_proposal_research_attempt_event(
         $1,$2,2,'attempt_failed',null,$3::jsonb,$4,null) as event_sha256`,
      [researchFailureAttempt.rows[0].id, researchFailureLease,
        terminalResearchFailure, terminalResearchFailureHash],
    );
    const researchFailure = await admin.query(
      "select status,error_code,error_message from ai_content_proposal_jobs where id=$1",
      [researchFailureFixture.job.id],
    );
    assert.deepEqual(researchFailure.rows, [{
      status: "failed", error_code: "research_unavailable", error_message: "provider unavailable",
    }]);
    assert.deepEqual((await admin.query(
      `select append_ai_content_proposal_research_attempt_event(
         $1,$2,2,'attempt_failed',null,$3::jsonb,$4,null) as event_sha256`,
      [researchFailureAttempt.rows[0].id, researchFailureLease,
        terminalResearchFailure, terminalResearchFailureHash],
    )).rows, researchFailureEvent.rows);
    const changedTerminalResearchFailure = JSON.stringify({
      errorCode: "research_unavailable", errorMessage: "changed message", retryable: false,
    });
    const changedTerminalResearchFailureHash = (await admin.query(
      "select encode(digest($1::jsonb::text,'sha256'),'hex') as hash",
      [changedTerminalResearchFailure],
    )).rows[0].hash;
    await assert.rejects(
      admin.query(
        `select append_ai_content_proposal_research_attempt_event(
           $1,$2,2,'attempt_failed',null,$3::jsonb,$4,null)`,
        [researchFailureAttempt.rows[0].id, researchFailureLease,
          changedTerminalResearchFailure, changedTerminalResearchFailureHash],
      ),
      /proposal_research_event_replay_conflict/,
    );
    assert.deepEqual((await admin.query(
      `select error_code,error_message,retryable,terminal
         from ai_content_proposal_research_attempt_events
        where research_attempt_id=$1 and event_type='attempt_failed'`,
      [researchFailureAttempt.rows[0].id],
    )).rows, [{
      error_code: "research_unavailable", error_message: "provider unavailable",
      retryable: false, terminal: true,
    }]);
    assert.deepEqual((await admin.query(
      `select event_type from ai_content_proposal_research_attempt_events
        where research_attempt_id=$1 order by event_sequence`,
      [researchFailureAttempt.rows[0].id],
    )).rows, [{ event_type: "research_started" }, { event_type: "attempt_failed" }]);
    assert.deepEqual((await admin.query(
      "select status,error_code,error_message from ai_content_proposal_batches where id=$1",
      [researchFailureFixture.batch.id],
    )).rows, [{
      status: "failed", error_code: "research_unavailable", error_message: "provider unavailable",
    }]);

    const researchRetryFixture = await createProposalJobFixture("research-retry");
    const researchRetryLease = randomUUID();
    const researchRetryLeaseHash = (await admin.query(
      "select encode(digest($1::uuid::text,'sha256'),'hex') as hash",
      [researchRetryLease],
    )).rows[0].hash;
    await admin.query("update ai_content_proposal_batches set status='building' where id=$1", [researchRetryFixture.batch.id]);
    await admin.query(
      `update ai_content_proposal_jobs set status='processing',active_stage='research',
         lease_owner='research-retry-worker',lease_token=$2,lease_started_at=now(),
         lease_expires_at=now()+interval '5 minutes' where id=$1`,
      [researchRetryFixture.job.id, researchRetryLease],
    );
    const researchRetryAttempt = await admin.query(
      `insert into ai_content_proposal_research_attempts(
         job_id,contract_id,workspace_id,brand_id,attempt_number,worker_id,
         lease_token_sha256,enqueue_contract_sha256,base_input_sha256,lease_expires_at
       ) select $1,$2,$3,$4,1,'research-retry-worker',$5,$6,$6,lease_expires_at
           from ai_content_proposal_jobs where id=$1 returning id`,
      [researchRetryFixture.job.id, researchRetryFixture.contract.id,
        workspace.rows[0].id, brand.rows[0].id, researchRetryLeaseHash, hash],
    );
    await admin.query(
      "select append_ai_content_proposal_research_attempt_event($1,$2,1,'research_started',null,null,null,null)",
      [researchRetryAttempt.rows[0].id, researchRetryLease],
    );
    const retryableResearchFailure = JSON.stringify({
      errorCode: "research_timeout", errorMessage: "retry research later", retryable: true,
    });
    const retryableResearchFailureHash = (await admin.query(
      "select encode(digest($1::jsonb::text,'sha256'),'hex') as hash",
      [retryableResearchFailure],
    )).rows[0].hash;
    await admin.query(
      `select append_ai_content_proposal_research_attempt_event(
         $1,$2,2,'attempt_failed',null,$3::jsonb,$4,null)`,
      [researchRetryAttempt.rows[0].id, researchRetryLease,
        retryableResearchFailure, retryableResearchFailureHash],
    );
    assert.deepEqual((await admin.query(
      "select status,error_code,completed_at from ai_content_proposal_jobs where id=$1",
      [researchRetryFixture.job.id],
    )).rows, [{ status: "queued", error_code: null, completed_at: null }]);
    assert.deepEqual((await admin.query(
      "select status,error_code,error_message from ai_content_proposal_batches where id=$1",
      [researchRetryFixture.batch.id],
    )).rows, [{ status: "building", error_code: null, error_message: null }]);

    const modelFailureFixture = await createProposalJobFixture("model-final-pre-spawn");
    const modelFailureAudit = await admin.query(
      `insert into ai_content_proposal_performance_audits(
         workspace_id,brand_id,batch_id,experiment_id,experiment_definition_json,
         evidence_version,resolved_input_fingerprint_sha256,snapshot_audit_json,captured_from,captured_to
       ) values($1,$2,$3,$4,'{}'::jsonb,'performance-evidence.v1',$5,'{}'::jsonb,now(),now())
       returning id`,
      [workspace.rows[0].id, brand.rows[0].id, modelFailureFixture.batch.id, randomUUID(), hash],
    );
    const modelFailureEvidenceHash = (await admin.query(
      "select encode(digest('[{}]'::jsonb::text,'sha256'),'hex') as hash",
    )).rows[0].hash;
    const modelFailureComposition = await admin.query(
      `insert into ai_content_proposal_compositions(
         job_id,batch_id,contract_id,performance_audit_id,workspace_id,brand_id,research_evidence_json,
         research_evidence_set_sha256,composed_input_json,composed_input_sha256,
         final_invocation_aggregate_sha256
       ) values($1,$2,$3,$4,$5,$6,'[{}]'::jsonb,$7,
         '{"contractVersion":"proposal-input.v2"}'::jsonb,$8,$9) returning id`,
      [modelFailureFixture.job.id, modelFailureFixture.batch.id, modelFailureFixture.contract.id,
        modelFailureAudit.rows[0].id, workspace.rows[0].id, brand.rows[0].id,
        modelFailureEvidenceHash, composedInputHash, hash],
    );
    const modelFailureLease = randomUUID();
    const modelFailureLeaseHash = (await admin.query(
      "select encode(digest($1::uuid::text,'sha256'),'hex') as hash",
      [modelFailureLease],
    )).rows[0].hash;
    await admin.query("update ai_content_proposal_batches set status='building' where id=$1", [modelFailureFixture.batch.id]);
    await admin.query(
      `update ai_content_proposal_jobs set status='processing',active_stage='model',attempt_count=max_attempts,
         lease_owner='model-failure-worker',lease_token=$2,lease_started_at=now(),
         lease_expires_at=now()+interval '5 minutes' where id=$1`,
      [modelFailureFixture.job.id, modelFailureLease],
    );
    const modelFailureAttempt = await admin.query(
      `insert into ai_content_proposal_model_attempts(
         job_id,contract_id,composition_id,workspace_id,brand_id,attempt_number,
         worker_id,lease_token_sha256,aggregate_contract_sha256,model_id,
         model_sha256,command_descriptor_sha256,proposal_output_schema_sha256,composed_input_sha256
       ) values($1,$2,$3,$4,$5,1,'model-failure-worker',$6,$7,'gpt-5.6-terra',$7,$7,$8,$9)
       returning id`,
      [modelFailureFixture.job.id, modelFailureFixture.contract.id, modelFailureComposition.rows[0].id,
        workspace.rows[0].id, brand.rows[0].id, modelFailureLeaseHash, hash,
        proposalSchema, composedInputHash],
    );
    // 074 fixes this function identity. For the explicit pre-invocation event only,
    // ordinal 0 is a compatibility sentinel and the final four payload arguments are
    // mapped as errorCode, errorMessage, NULL, retryable. The stored row uses proper
    // failure columns and a NULL invocation_ordinal, so no invocation is fabricated.
    const modelFailureEvent = await admin.query(
      `select append_ai_content_proposal_attempt_event(
         $1,$2,1,0,'pre_invocation_failed',$3,$3,$3,$4,$5,$6,null,true) as event_sha256`,
      [modelFailureAttempt.rows[0].id, modelFailureLease, hash, composedInputHash,
        "model_spawn_failed", "worker could not start model"],
    );
    const modelFailure = await admin.query(
      "select status,error_code,error_message from ai_content_proposal_jobs where id=$1",
      [modelFailureFixture.job.id],
    );
    assert.deepEqual(modelFailure.rows, [{
      status: "failed", error_code: "model_spawn_failed", error_message: "worker could not start model",
    }]);
    assert.deepEqual((await admin.query(
      `select append_ai_content_proposal_attempt_event(
         $1,$2,1,0,'pre_invocation_failed',$3,$3,$3,$4,$5,$6,null,true) as event_sha256`,
      [modelFailureAttempt.rows[0].id, modelFailureLease, hash, composedInputHash,
        "model_spawn_failed", "worker could not start model"],
    )).rows, modelFailureEvent.rows);
    await assert.rejects(
      admin.query(
        `select append_ai_content_proposal_attempt_event(
           $1,$2,1,0,'pre_invocation_failed',$3,$3,$3,$4,$5,$6,null,true)`,
        [modelFailureAttempt.rows[0].id, modelFailureLease, hash, composedInputHash,
          "model_spawn_failed", "changed message"],
      ),
      /proposal_attempt_event_replay_conflict/,
    );
    assert.equal((await admin.query(
      `select count(*)::integer count from ai_content_proposal_attempt_events
        where model_attempt_id=$1 and event_type like 'invocation_%'`,
      [modelFailureAttempt.rows[0].id],
    )).rows[0].count, 0, "pre-spawn exhaustion must not fabricate an invocation event");
    assert.deepEqual((await admin.query(
      `select event_type,invocation_ordinal,error_code,error_message,retryable,terminal
         from ai_content_proposal_attempt_events where model_attempt_id=$1`,
      [modelFailureAttempt.rows[0].id],
    )).rows, [{
      event_type: "pre_invocation_failed", invocation_ordinal: null,
      error_code: "model_spawn_failed", error_message: "worker could not start model",
      retryable: true, terminal: true,
    }]);
    assert.deepEqual((await admin.query(
      "select status,error_code,error_message from ai_content_proposal_batches where id=$1",
      [modelFailureFixture.batch.id],
    )).rows, [{
      status: "failed", error_code: "model_spawn_failed", error_message: "worker could not start model",
    }]);

    const operatorRole = `cutover_operator_${randomUUID().replaceAll("-", "")}`;
    const cleanupRole = `cutover_cleanup_${randomUUID().replaceAll("-", "")}`;
    const appRole = `cutover_app_${randomUUID().replaceAll("-", "")}`;
    const schemaOwnerRole = `cutover_schema_owner_${randomUUID().replaceAll("-", "")}`;
    const migrationRole = `cutover_migration_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`create role ${quoteIdentifier(operatorRole)} login password 'operator-test-secret'`);
    await admin.query(`create role ${quoteIdentifier(cleanupRole)} login password 'cleanup-test-secret'`);
    await admin.query(`create role ${quoteIdentifier(appRole)} login password 'app-test-secret'`);
    await admin.query(`create role ${quoteIdentifier(schemaOwnerRole)} nologin`);
    await admin.query(`create role ${quoteIdentifier(migrationRole)} nologin`);
    const postCatalogNames = {
      schemaOwnerRoleName: schemaOwnerRole, applicationRoleName: appRole,
      operatorRoleName: operatorRole, migrationRoleName: migrationRole, cleanupRoleName: cleanupRole,
    };
    const roleByKey = {
      schemaOwner: schemaOwnerRole, application: appRole, operator: operatorRole,
      migration: migrationRole, cleanup: cleanupRole,
    };
    const allCatalogRoles = ["postgres", schemaOwnerRole, appRole, operatorRole, migrationRole, cleanupRole];
    for (const descriptor of cutover075SecurityFunctions) {
      const owner = descriptor.owner === "provider" ? "postgres" : schemaOwnerRole;
      await admin.query(`alter function ${descriptor.identity} owner to ${quoteIdentifier(owner)}`);
      const scrubRoles = allCatalogRoles.filter((role) => role !== owner).map(quoteIdentifier);
      await admin.query(`revoke all on function ${descriptor.identity} from public,${scrubRoles.join(",")}`);
      for (const roleKey of descriptor.execute) {
        const grantee = roleByKey[roleKey];
        if (grantee !== owner) {
          await admin.query(`grant execute on function ${descriptor.identity} to ${quoteIdentifier(grantee)}`);
        }
      }
    }
    for (const descriptor of cutover075RelationSecurityCatalog) {
      const owner = descriptor.owner === "provider" ? "postgres" : schemaOwnerRole;
      await admin.query(`alter table public.${quoteIdentifier(descriptor.relationName)} owner to ${quoteIdentifier(owner)}`);
      const scrubRoles = allCatalogRoles.filter((role) => role !== owner).map(quoteIdentifier);
      await admin.query(`revoke all on table public.${quoteIdentifier(descriptor.relationName)} from public,${scrubRoles.join(",")}`);
      for (const { role, privileges } of descriptor.grants) {
        const grantee = roleByKey[role];
        if (grantee !== owner) {
          await admin.query(`grant ${privileges.join(",")} on table public.${quoteIdentifier(descriptor.relationName)} to ${quoteIdentifier(grantee)}`);
        }
      }
    }
    const postCatalog = await readCutover075PostCatalog(admin, postCatalogNames, {
      ownerRoleName: "postgres", cutover075Migration: migration075,
    });
    assert.equal(postCatalog.functions.length, 35);
    assert.equal(postCatalog.relations.length, 13);
    assert.equal(postCatalog.triggers.length, 32);
    await admin.query("begin");
    await admin.query(
      `revoke execute on function public.create_ai_content_cutover_topic_upload(uuid,uuid,uuid,text,text,jsonb)
       from ${quoteIdentifier(appRole)}`,
    );
    await assert.rejects(
      readCutover075PostCatalog(admin, postCatalogNames, {
        ownerRoleName: "postgres", cutover075Migration: migration075,
      }),
      /cutover_075_post_function_catalog_mismatch/,
    );
    await admin.query("rollback");
    await admin.query(
      `grant execute on function
         begin_ai_content_cutover_release_adoption(uuid,uuid,text,text,text,text,text,text),
         append_ai_content_cutover_release_adoption_event(uuid,integer,integer,text,jsonb,text)
       to ${quoteIdentifier(operatorRole)}`,
    );
    await admin.query(
      `grant execute on function
         claim_ai_content_storage_cleanup(uuid,uuid,text,text,uuid,integer),
         complete_ai_content_storage_cleanup(uuid,text,text,uuid,text,text),
         fail_ai_content_storage_cleanup(uuid,text,text,uuid,text,text)
       to ${quoteIdentifier(cleanupRole)}`,
    );
    await admin.query(`grant select on ai_content_storage_cleanup_outbox to ${quoteIdentifier(cleanupRole)}`);
    await admin.query(
      `grant execute on function is_ai_content_storage_path_protected(uuid,text) to ${quoteIdentifier(appRole)}`,
    );
    const releaseCutoverId = randomUUID();
    const cleanupToken = `cleanup-${randomUUID()}`;
    const cleanupTokenHash = (await admin.query(
      "select encode(digest($1,'sha256'),'hex') as hash",
      [cleanupToken],
    )).rows[0].hash;
    const preflightTransfer = "6".repeat(64);
    const parentRelease = "7".repeat(40);
    const adoptedRelease = "8".repeat(40);
    const preflightIdentity = {
      preflightCandidateSha: "c".repeat(40),
      contentProposalWorkerImageDigest: `sha256:${"c".repeat(64)}`,
      proposalWorkerSourceSha: "a".repeat(40), proposalWorkerTreeSha: "b".repeat(40),
      proposalContractSourceSha256: contractSource, proposalSchemaSha256: proposalSchema,
      proposalCatalogSha256: catalogSha, proposalModelId: "gpt-5.6-terra",
      proposalCommandDescriptorSha256: hash, migrationSha256: hash,
    };
    const preflightIdentityHash = (await admin.query(
      "select encode(digest($1::jsonb::text,'sha256'),'hex') as hash",
      [JSON.stringify(preflightIdentity)],
    )).rows[0].hash;
    await admin.query(
      `insert into ai_content_cutovers(
         id,status,migration_id,schema_owner_role_name,application_role_name,operator_role_name,
         migration_role_name,cleanup_role_name,bypass_token_sha256,cleanup_token_sha256,
         database_role_catalog_sha256,provider_backup_id,provider_snapshot_created_at,
         incident_bundle_sha256,preserved_data_manifest_sha256,proposal_preflight_identity_json,
         proposal_preflight_identity_sha256,proposal_preflight_transfer_sha256,
         intended_release_sha,latest_status_event_sha256
       ) values($1,'migration_body_complete','075_ai_content_three_format_cutover.sql',
         'schema_owner_fixture',$10,$2,'migration_fixture',$3,$4,$5,$4,
         'backup',now(),$4,$4,$6::jsonb,$7,$8,$9,$4)`,
      [releaseCutoverId, operatorRole, cleanupRole, hash, cleanupTokenHash,
        JSON.stringify(preflightIdentity), preflightIdentityHash, preflightTransfer, parentRelease, appRole],
    );
    await admin.query(
      `insert into ai_content_bootstrap_state(
         singleton,authorization_request_id,authorization_sha256,migration_role_name,
         schema_owner_role_name,application_role_name,operator_role_name,cleanup_role_name,
         migration_sha256,role_catalog_sha256,object_catalog_sha256,fence_security_catalog_sha256,
         event_trigger_catalog_before_json,event_trigger_catalog_before_sha256,
         event_trigger_catalog_before_count,install_request_json,install_request_sha256
       ) values(true,'075-pg16-fixture',$1,'migration_fixture','schema_owner_fixture',$2,$3,$4,
         $1,$1,$1,$1,'{}'::jsonb,$1,0,'{}'::jsonb,$1)`,
      [hash, appRole, operatorRole, cleanupRole],
    );
    await admin.query(
      "update ai_content_maintenance_state set enabled=true,cutover_id=$1,enabled_at=now() where singleton",
      [releaseCutoverId],
    );
    await admin.query(
      `create table if not exists schema_migrations(
         id text primary key,checksum text not null,applied_at timestamptz not null default now()
       )`,
    );
    await admin.query(
      `insert into schema_migrations(id,checksum) values('075_ai_content_three_format_cutover.sql',$1)
       on conflict(id) do update set checksum=excluded.checksum`,
      [hash],
    );
    const operatorUri = new URL(container.getConnectionUri());
    operatorUri.username = operatorRole;
    operatorUri.password = "operator-test-secret";
    const operatorClient = new Client({ connectionString: operatorUri.toString() });
    clients.push(operatorClient);
    await operatorClient.connect();
    const adoptionCaller = randomUUID();
    const ancestryHash = "9".repeat(64);
    const adoption = await operatorClient.query(
      `select * from begin_ai_content_cutover_release_adoption(
         $1,$2,$3,$4,$5,$6,'reviewed descendant',$7)`,
      [releaseCutoverId, adoptionCaller, parentRelease, adoptedRelease, ancestryHash,
        preflightTransfer, operatorRole],
    );
    assert.deepEqual((await operatorClient.query(
      `select * from begin_ai_content_cutover_release_adoption(
         $1,$2,$3,$4,$5,$6,'  reviewed descendant  ',$7)`,
      [releaseCutoverId, adoptionCaller, parentRelease, adoptedRelease, ancestryHash,
        preflightTransfer, `  ${operatorRole}  `],
    )).rows, adoption.rows);
    await assert.rejects(
      operatorClient.query(
        `select * from begin_ai_content_cutover_release_adoption(
           $1,$2,$3,$4,$5,$6,null,$7)`,
        [releaseCutoverId, adoptionCaller, parentRelease, adoptedRelease, ancestryHash,
          preflightTransfer, operatorRole],
      ),
      /ai_content_release_adoption_caller_conflict/,
    );
    const sequence = adoption.rows[0].adoption_sequence;
    const manifestEvidence = {
      manifestSha256: "a".repeat(64), apiImageDigest: `sha256:${"b".repeat(64)}`,
      contentProposalImageDigest: preflightIdentity.contentProposalWorkerImageDigest,
      cardNewsImageDigest: `sha256:${"d".repeat(64)}`,
      blogImageDigest: `sha256:${"e".repeat(64)}`,
      reelImageDigest: `sha256:${"f".repeat(64)}`,
      proposalWorkerSourceSha: preflightIdentity.proposalWorkerSourceSha,
      proposalWorkerTreeSha: preflightIdentity.proposalWorkerTreeSha,
      proposalContractSourceSha256: preflightIdentity.proposalContractSourceSha256,
      proposalSchemaSha256: preflightIdentity.proposalSchemaSha256,
      proposalCatalogSha256: preflightIdentity.proposalCatalogSha256,
      proposalModelId: preflightIdentity.proposalModelId,
      proposalCommandDescriptorSha256: preflightIdentity.proposalCommandDescriptorSha256,
      migrationSha256: preflightIdentity.migrationSha256,
      preflightCandidateSha: preflightIdentity.preflightCandidateSha,
      preflightTransferSha256: preflightTransfer,
    };
    await assert.rejects(
      operatorClient.query(
        "select append_ai_content_cutover_release_adoption_event($1,$2,2,'manifest_sealed',$3::jsonb,$4)",
        [releaseCutoverId, sequence, JSON.stringify({ ...manifestEvidence, extra: true }), operatorRole],
      ),
      /ai_content_release_adoption_manifest_evidence_invalid/,
    );
    for (const [field, value] of [
      ["contentProposalImageDigest", `sha256:${"0".repeat(64)}`],
      ["proposalWorkerSourceSha", "0".repeat(40)],
      ["proposalWorkerTreeSha", "0".repeat(40)],
      ["proposalContractSourceSha256", "0".repeat(64)],
      ["proposalSchemaSha256", "0".repeat(64)],
      ["proposalCatalogSha256", "0".repeat(64)],
      ["proposalModelId", "gpt-5.6-sol"],
      ["proposalCommandDescriptorSha256", "0".repeat(64)],
      ["migrationSha256", "0".repeat(64)],
      ["preflightCandidateSha", "0".repeat(40)],
    ]) {
      await assert.rejects(
        operatorClient.query(
          "select append_ai_content_cutover_release_adoption_event($1,$2,2,'manifest_sealed',$3::jsonb,$4)",
          [releaseCutoverId, sequence, JSON.stringify({ ...manifestEvidence, [field]: value }), operatorRole],
        ),
        /ai_content_release_adoption_manifest_evidence_invalid/,
        field,
      );
    }
    await assert.rejects(
      operatorClient.query(
        "select append_ai_content_cutover_release_adoption_event($1,$2,2,'manifest_sealed',$3::jsonb,$4)",
        [releaseCutoverId, sequence,
          JSON.stringify({ ...manifestEvidence, proposalWorkerTreeSha: null }), operatorRole],
      ),
      /ai_content_release_adoption_manifest_evidence_invalid/,
    );
    await operatorClient.query(
      "select append_ai_content_cutover_release_adoption_event($1,$2,2,'manifest_sealed',$3::jsonb,$4)",
      [releaseCutoverId, sequence, JSON.stringify(manifestEvidence), operatorRole],
    );
    const uiEvidence = {
      customerUiChanged: true, stagedCustomerUiDeploymentId: "ui-new",
      currentCustomerUiDeploymentId: "ui-old", customerUiSourceSha: "d".repeat(40),
      customerUiEvidenceSha256: "1".repeat(64),
    };
    await assert.rejects(
      operatorClient.query(
        "select append_ai_content_cutover_release_adoption_event($1,$2,3,'ui_evidence_sealed',$3::jsonb,$4)",
        [releaseCutoverId, sequence,
          JSON.stringify({ ...uiEvidence, stagedCustomerUiDeploymentId: null }), operatorRole],
      ),
      /ai_content_release_adoption_ui_evidence_invalid/,
    );
    await operatorClient.query(
      "select append_ai_content_cutover_release_adoption_event($1,$2,3,'ui_evidence_sealed',$3::jsonb,$4)",
      [releaseCutoverId, sequence, JSON.stringify(uiEvidence), operatorRole],
    );
    const runtimeEvidence = {
      apiImageDigest: manifestEvidence.apiImageDigest,
      contentProposalImageDigest: manifestEvidence.contentProposalImageDigest,
      cardNewsImageDigest: manifestEvidence.cardNewsImageDigest,
      blogImageDigest: manifestEvidence.blogImageDigest,
      reelImageDigest: manifestEvidence.reelImageDigest,
      runtimeEvidenceSha256: "2".repeat(64),
    };
    await assert.rejects(
      operatorClient.query(
        "select append_ai_content_cutover_release_adoption_event($1,$2,4,'runtime_installed',$3::jsonb,$4)",
        [releaseCutoverId, sequence,
          JSON.stringify({ ...runtimeEvidence, runtimeEvidenceSha256: null }), operatorRole],
      ),
      /ai_content_release_adoption_runtime_evidence_invalid/,
    );
    await operatorClient.query(
      "select append_ai_content_cutover_release_adoption_event($1,$2,4,'runtime_installed',$3::jsonb,$4)",
      [releaseCutoverId, sequence, JSON.stringify(runtimeEvidence), operatorRole],
    );
    const pointerEvidence = {
      controlEvidenceSha256: "3".repeat(64), currentPointerEvidenceSha256: "4".repeat(64),
      currentReleaseSha: adoptedRelease, currentCustomerUiDeploymentId: "ui-new",
    };
    await assert.rejects(
      operatorClient.query(
        "select append_ai_content_cutover_release_adoption_event($1,$2,5,'pointer_advanced',$3::jsonb,$4)",
        [releaseCutoverId, sequence,
          JSON.stringify({ ...pointerEvidence, controlEvidenceSha256: null }), operatorRole],
      ),
      /ai_content_release_adoption_pointer_evidence_invalid/,
    );
    await assert.rejects(
      operatorClient.query(
        "select append_ai_content_cutover_release_adoption_event($1,$2,5,'pointer_advanced',$3::jsonb,$4)",
        [releaseCutoverId, sequence,
          JSON.stringify({ ...pointerEvidence, currentCustomerUiDeploymentId: "ui-old" }), operatorRole],
      ),
      /ai_content_release_adoption_pointer_evidence_invalid/,
    );
    await operatorClient.query(
      "select append_ai_content_cutover_release_adoption_event($1,$2,5,'pointer_advanced',$3::jsonb,$4)",
      [releaseCutoverId, sequence, JSON.stringify(pointerEvidence), operatorRole],
    );
    const completedEvidence = {
      parentReleaseSha: parentRelease, adoptedReleaseSha: adoptedRelease,
      ancestryProvenanceSha256: ancestryHash, preflightTransferSha256: preflightTransfer,
      manifestEvidenceSha256: (await admin.query(
        "select evidence_sha256 from ai_content_cutover_release_adoption_events where cutover_id=$1 and adoption_sequence=$2 and stage='manifest_sealed'",
        [releaseCutoverId, sequence],
      )).rows[0].evidence_sha256,
      uiEvidenceSha256: (await admin.query(
        "select evidence_sha256 from ai_content_cutover_release_adoption_events where cutover_id=$1 and adoption_sequence=$2 and stage='ui_evidence_sealed'",
        [releaseCutoverId, sequence],
      )).rows[0].evidence_sha256,
      runtimeEvidenceSha256: runtimeEvidence.runtimeEvidenceSha256,
      controlEvidenceSha256: pointerEvidence.controlEvidenceSha256,
      currentPointerEvidenceSha256: pointerEvidence.currentPointerEvidenceSha256,
      manifestSha256: manifestEvidence.manifestSha256,
      apiImageDigest: manifestEvidence.apiImageDigest,
      contentProposalImageDigest: manifestEvidence.contentProposalImageDigest,
      cardNewsImageDigest: manifestEvidence.cardNewsImageDigest,
      blogImageDigest: manifestEvidence.blogImageDigest,
      reelImageDigest: manifestEvidence.reelImageDigest,
      proposalWorkerSourceSha: manifestEvidence.proposalWorkerSourceSha,
      proposalWorkerTreeSha: manifestEvidence.proposalWorkerTreeSha,
      customerUiChanged: uiEvidence.customerUiChanged,
      stagedCustomerUiDeploymentId: uiEvidence.stagedCustomerUiDeploymentId,
      currentCustomerUiDeploymentId: uiEvidence.stagedCustomerUiDeploymentId,
      customerUiSourceSha: uiEvidence.customerUiSourceSha,
      customerUiEvidenceSha256: uiEvidence.customerUiEvidenceSha256,
      proposalContractSourceSha256: manifestEvidence.proposalContractSourceSha256,
      proposalSchemaSha256: manifestEvidence.proposalSchemaSha256,
      proposalCatalogSha256: manifestEvidence.proposalCatalogSha256,
      proposalModelId: manifestEvidence.proposalModelId,
      proposalCommandDescriptorSha256: manifestEvidence.proposalCommandDescriptorSha256,
      migrationSha256: manifestEvidence.migrationSha256,
      preflightCandidateSha: manifestEvidence.preflightCandidateSha,
      reason: "reviewed descendant",
    };
    await assert.rejects(
      operatorClient.query(
        "select append_ai_content_cutover_release_adoption_event($1,$2,6,'completed',$3::jsonb,$4)",
        [releaseCutoverId, sequence,
          JSON.stringify({ ...completedEvidence, proposalWorkerTreeSha: undefined }), operatorRole],
      ),
      /ai_content_release_adoption_completion_mismatch/,
    );
    await assert.rejects(
      operatorClient.query(
        "select append_ai_content_cutover_release_adoption_event($1,$2,6,'completed',$3::jsonb,$4)",
        [releaseCutoverId, sequence,
          JSON.stringify({ ...completedEvidence, customerUiEvidenceSha256: null }), operatorRole],
      ),
      /ai_content_release_adoption_completion_mismatch/,
    );
    const completion = await operatorClient.query(
      "select append_ai_content_cutover_release_adoption_event($1,$2,6,'completed',$3::jsonb,$4) as event_sha256",
      [releaseCutoverId, sequence, JSON.stringify(completedEvidence), operatorRole],
    );
    assert.deepEqual((await operatorClient.query(
      "select append_ai_content_cutover_release_adoption_event($1,$2,6,'completed',$3::jsonb,$4) as event_sha256",
      [releaseCutoverId, sequence, JSON.stringify(completedEvidence), operatorRole],
    )).rows, completion.rows);
    await assert.rejects(
      admin.query(
        "update ai_content_cutover_release_adoptions set reason='changed' where cutover_id=$1 and adoption_sequence=$2",
        [releaseCutoverId, sequence],
      ),
      /ai_content_cutover_record_immutable/,
    );
    const abandonedRelease = "9".repeat(40);
    const abandonedCaller = randomUUID();
    const abandoned = await operatorClient.query(
      `select * from begin_ai_content_cutover_release_adoption(
         $1,$2,$3,$4,$5,$6,'cannot obtain rollout evidence',$7)`,
      [releaseCutoverId, abandonedCaller, adoptedRelease, abandonedRelease,
        "5".repeat(64), preflightTransfer, operatorRole],
    );
    await assert.rejects(
      operatorClient.query(
        "select append_ai_content_cutover_release_adoption_event($1,$2,2,'abandoned_before_rollout',$3::jsonb,$4)",
        [releaseCutoverId, abandoned.rows[0].adoption_sequence,
          JSON.stringify({ reason: null, abandonmentEvidenceSha256: "6".repeat(64) }), operatorRole],
      ),
      /ai_content_release_adoption_abandonment_evidence_invalid/,
    );
    await operatorClient.query(
      "select append_ai_content_cutover_release_adoption_event($1,$2,2,'abandoned_before_rollout',$3::jsonb,$4)",
      [releaseCutoverId, abandoned.rows[0].adoption_sequence,
        JSON.stringify({ reason: "evidence unavailable", abandonmentEvidenceSha256: "6".repeat(64) }), operatorRole],
    );
    await assert.rejects(
      admin.query(
        "delete from ai_content_cutover_release_adoption_events where cutover_id=$1 and adoption_sequence=$2",
        [releaseCutoverId, sequence],
      ),
      /ai_content_cutover_record_immutable/,
    );

    const cleanupUri = new URL(container.getConnectionUri());
    cleanupUri.username = cleanupRole;
    cleanupUri.password = "cleanup-test-secret";
    const cleanupClient = new Client({ connectionString: cleanupUri.toString() });
    clients.push(cleanupClient);
    await cleanupClient.connect();
    const insertOutbox = async (path, overrides = {}) => (await admin.query(
      `insert into ai_content_storage_cleanup_outbox(
         cutover_id,workspace_id,processor_kind,storage_path,object_kind,source_relation,
         source_row_id,known_checksum_sha256,status,attempt_count,available_at,
         lease_owner,lease_token,lease_expires_at
       ) values($1,$2,'cutover_storage_gc',$3,'artifact','storage_artifacts',$4,$5,$6,$7,
         coalesce($8,now()),$9,$10,$11) returning id`,
      [releaseCutoverId, workspace.rows[0].id, path, randomUUID(), hash,
        overrides.status ?? "pending", overrides.attemptCount ?? 0,
        overrides.availableAt ?? null, overrides.leaseOwner ?? null,
        overrides.leaseToken ?? null, overrides.leaseExpiresAt ?? null],
    )).rows[0];
    const pendingCleanup = await insertOutbox("cleanup/pending.png");
    await assert.rejects(
      insertOutbox("  cleanup/padded.png  "),
      /ai_content_storage_cleanup_outbox_storage_path_check/,
    );
    await assert.rejects(
      cleanupClient.query("insert into ai_content_storage_cleanup_outbox select * from ai_content_storage_cleanup_outbox where false"),
      /permission denied/,
    );
    const callAsCleanup = async (callback) => {
      await cleanupClient.query("begin");
      try {
        await cleanupClient.query(
          "select set_config('app.ai_content_cutover_id',$1,true),set_config('app.ai_content_cleanup_token',$2,true)",
          [releaseCutoverId, cleanupToken],
        );
        const result = await callback();
        await cleanupClient.query("commit");
        return result;
      } catch (error) {
        await cleanupClient.query("rollback").catch(() => {});
        throw error;
      }
    };
    const firstCleanupLease = randomUUID();
    await assert.rejects(
      callAsCleanup(() => cleanupClient.query(
        "select id from claim_ai_content_storage_cleanup($1,$2,$3,null,$4,10)",
        [releaseCutoverId, workspace.rows[0].id, cleanupToken, firstCleanupLease],
      )),
      /ai_content_storage_cleanup_claim_invalid/,
    );
    assert.equal((await admin.query(
      "select status from ai_content_storage_cleanup_outbox where id=$1",
      [pendingCleanup.id],
    )).rows[0].status, "pending");
    const firstClaim = await callAsCleanup(() => cleanupClient.query(
      "select id,status,attempt_count,lease_owner,lease_token from claim_ai_content_storage_cleanup($1,$2,$3,'gc-1',$4,10)",
      [releaseCutoverId, workspace.rows[0].id, cleanupToken, firstCleanupLease],
    ));
    assert.deepEqual(firstClaim.rows, [{
      id: pendingCleanup.id, status: "deleting", attempt_count: 1,
      lease_owner: "gc-1", lease_token: firstCleanupLease,
    }]);
    await assert.rejects(
      callAsCleanup(() => cleanupClient.query(
        "select complete_ai_content_storage_cleanup($1,$2,'wrong-owner',$3,'deleted',null)",
        [pendingCleanup.id, cleanupToken, firstCleanupLease],
      )),
      /ai_content_storage_cleanup_complete_conflict/,
    );
    const completedCleanup = await callAsCleanup(() => cleanupClient.query(
      "select complete_ai_content_storage_cleanup($1,$2,'gc-1',$3,'deleted',null)",
      [pendingCleanup.id, cleanupToken, firstCleanupLease],
    ));
    assert.deepEqual((await callAsCleanup(() => cleanupClient.query(
      "select complete_ai_content_storage_cleanup($1,$2,'gc-1',$3,'deleted',null)",
      [pendingCleanup.id, cleanupToken, firstCleanupLease],
    ))).rows, completedCleanup.rows);
    await assert.rejects(
      callAsCleanup(() => cleanupClient.query(
        "select complete_ai_content_storage_cleanup($1,$2,'gc-1',$3,'retained_reference',$4)",
        [pendingCleanup.id, cleanupToken, firstCleanupLease, hash],
      )),
      /ai_content_storage_cleanup_complete_conflict/,
    );
    await admin.query(
      "update ai_content_maintenance_state set enabled=false,cutover_id=null,enabled_at=null where singleton",
    );
    await assert.rejects(
      callAsCleanup(() => cleanupClient.query(
        "select complete_ai_content_storage_cleanup($1,$2,'gc-1',$3,'deleted',null)",
        [pendingCleanup.id, cleanupToken, firstCleanupLease],
      )),
      /ai_content_storage_cleanup_complete_conflict/,
    );
    await admin.query(
      "update ai_content_maintenance_state set enabled=true,cutover_id=$1,enabled_at=now() where singleton",
      [releaseCutoverId],
    );
    const expiredLease = randomUUID();
    const expiredCleanup = await insertOutbox("cleanup/expired.png", {
      status: "deleting", attemptCount: 1, leaseOwner: "dead-worker", leaseToken: expiredLease,
      leaseExpiresAt: new Date(Date.now() - 60_000),
    });
    const reclaimedLease = randomUUID();
    const reclaimed = await callAsCleanup(() => cleanupClient.query(
      "select id,attempt_count,lease_owner,lease_token from claim_ai_content_storage_cleanup($1,$2,$3,'gc-2',$4,10)",
      [releaseCutoverId, workspace.rows[0].id, cleanupToken, reclaimedLease],
    ));
    assert.deepEqual(reclaimed.rows, [{
      id: expiredCleanup.id, attempt_count: 2, lease_owner: "gc-2", lease_token: reclaimedLease,
    }]);
    const failedCleanup = await callAsCleanup(() => cleanupClient.query(
      "select fail_ai_content_storage_cleanup($1,$2,'gc-2',$3,'storage_error','temporary failure')",
      [expiredCleanup.id, cleanupToken, reclaimedLease],
    ));
    assert.deepEqual((await callAsCleanup(() => cleanupClient.query(
      "select fail_ai_content_storage_cleanup($1,$2,'gc-2',$3,'storage_error','temporary failure')",
      [expiredCleanup.id, cleanupToken, reclaimedLease],
    ))).rows, failedCleanup.rows);
    await assert.rejects(
      callAsCleanup(() => cleanupClient.query(
        "select fail_ai_content_storage_cleanup($1,$2,'gc-2',$3,'changed_error','temporary failure')",
        [expiredCleanup.id, cleanupToken, reclaimedLease],
      )),
      /ai_content_storage_cleanup_fail_conflict/,
    );
    assert.deepEqual((await admin.query(
      "select status,attempt_count from ai_content_storage_cleanup_outbox where id=$1",
      [expiredCleanup.id],
    )).rows, [{ status: "failed", attempt_count: 2 }]);
    assert.deepEqual((await callAsCleanup(() => cleanupClient.query(
      "select id from claim_ai_content_storage_cleanup($1,$2,$3,'gc-backoff',$4,10)",
      [releaseCutoverId, workspace.rows[0].id, cleanupToken, randomUUID()],
    ))).rows, []);
    const deadCleanup = await insertOutbox("cleanup/dead.png", {
      status: "deleting", attemptCount: 10, leaseOwner: "dead-worker", leaseToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() - 60_000),
    });
    await callAsCleanup(() => cleanupClient.query(
      "select id from claim_ai_content_storage_cleanup($1,$2,$3,'gc-3',$4,10)",
      [releaseCutoverId, workspace.rows[0].id, cleanupToken, randomUUID()],
    ));
    assert.deepEqual((await admin.query(
      "select status,error_code,completed_at is not null as completed from ai_content_storage_cleanup_outbox where id=$1",
      [deadCleanup.id],
    )).rows, [{ status: "dead_letter", error_code: "lease_expired", completed: true }]);
    assert.deepEqual((await callAsCleanup(() => cleanupClient.query(
      "select id from claim_ai_content_storage_cleanup($1,$2,$3,'gc-dead-letter',$4,10)",
      [releaseCutoverId, workspace.rows[0].id, cleanupToken, randomUUID()],
    ))).rows, []);
    await admin.query(
      `insert into ai_content_storage_cleanup_outbox(
         cutover_id,workspace_id,processor_kind,storage_path,object_kind,source_relation,
         source_row_id,known_checksum_sha256,status,attempt_count,retention_evidence_sha256,
         last_transition_request_sha256,completed_at
       ) values($1,$2,'cutover_storage_gc','cleanup/retained.png','artifact','storage_artifacts',
         $3,$4,'retained_reference',1,$4,$4,now())`,
      [releaseCutoverId, workspace.rows[0].id, randomUUID(), hash],
    );
    const appUri = new URL(container.getConnectionUri());
    appUri.username = appRole;
    appUri.password = "app-test-secret";
    const appClient = new Client({ connectionString: appUri.toString() });
    clients.push(appClient);
    await appClient.connect();
    await assert.rejects(
      appClient.query("select * from ai_content_storage_cleanup_outbox limit 1"),
      /permission denied/,
    );
    assert.equal((await appClient.query(
      "select is_ai_content_storage_path_protected($1,'cleanup/retained.png') as protected",
      [workspace.rows[0].id],
    )).rows[0].protected, true);
    assert.equal((await appClient.query(
      "select is_ai_content_storage_path_protected($1,'  cleanup/retained.png  ') as protected",
      [workspace.rows[0].id],
    )).rows[0].protected, true);
    assert.equal((await appClient.query(
      "select is_ai_content_storage_path_protected($1,'cleanup/missing.png') as protected",
      [workspace.rows[0].id],
    )).rows[0].protected, false);
    await assert.rejects(
      appClient.query("select is_ai_content_storage_path_protected($1,null)", [workspace.rows[0].id]),
      /ai_content_storage_path_protection_lookup_invalid/,
    );

  } catch (error) {
    testError = error;
    throw error;
  } finally {
    const teardownFailures = [];
    const settled = await Promise.allSettled(clients.map((client) => client.end()));
    for (const result of settled) if (result.status === "rejected") teardownFailures.push(result.reason);
    if (container) {
      try {
        await container.stop();
      } catch (error) {
        teardownFailures.push(error);
      }
    }
    if (!testError && teardownFailures.length) {
      throw new AggregateError(teardownFailures, "075 PostgreSQL harness teardown failed");
    }
  }
});

test("075 real PostgreSQL reconciles only generation storage candidates and fails closed on unsafe pre-cutover state", { timeout: 180_000 }, async () => {
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  let container;
  let admin;
  let testError;
  try {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withUsername("postgres")
      .withPassword("postgres")
      .withDatabase("ai_content_storage_reconciliation")
      .withEnvironment("POSTGRES_INITDB_ARGS", "--locale=C")
      .start();
    admin = new Client({ connectionString: container.getConnectionUri() });
    await admin.connect();
    const identity = await admin.query("select current_setting('server_version_num')::integer as version_num");
    assert.ok(identity.rows[0].version_num >= 160000 && identity.rows[0].version_num < 170000);
    await admin.query("create extension if not exists pgcrypto");

    const migrations = (await loadMigrations()).filter(
      (migration) => !excludedMigrationIds.has(migration.id)
        && migration.id <= "075_ai_content_three_format_cutover.sql",
    );
    const migration075 = migrations.find((migration) => migration.id === "075_ai_content_three_format_cutover.sql");
    assert.ok(migration075);
    for (const migration of migrations) {
      if (migration.id === migration075.id) break;
      await admin.query(migration.sql);
    }
    const registrationStart = migration075.sql.indexOf("-- 075_FENCE_REGISTRATION_BEGIN");
    const registrationEnd = migration075.sql.indexOf("-- 075_FENCE_REGISTRATION_END");
    assert.ok(registrationStart > 0 && registrationEnd > registrationStart);
    const migration075WithoutProviderRegistration = `${migration075.sql.slice(0, registrationStart)}${migration075.sql.slice(
      registrationEnd + "-- 075_FENCE_REGISTRATION_END".length,
    )}`;

    const workspace = await admin.query(
      "insert into workspaces(name,slug) values('075 storage reconciliation',$1) returning id",
      [`storage-reconciliation-${randomUUID()}`],
    );
    const brand = await admin.query(
      "insert into brands(workspace_id,name) values($1,'075 storage reconciliation') returning id",
      [workspace.rows[0].id],
    );
    const generation = await admin.query(
      `insert into ai_content_generations(
         workspace_id,brand_id,type,title,status,analysis_idempotency_key
       ) values($1,$2,'blog','Storage reconciliation','completed',$3) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, `storage-reconciliation-${randomUUID()}`],
    );
    const paths = Object.freeze({
      boundSubject: "semantic/subject-bound.png",
      unrelatedSubject: "semantic/subject-unrelated.png",
      manifestUrl: "semantic/output-manifest.json",
      renderResult: "semantic/render-result.mp4",
      storageArtifact: "semantic/retained-storage-artifact.png",
      channel: "semantic/retained-channel.png",
      reference: "semantic/retained-reference.png",
      checksumConflict: "semantic/checksum-conflict.png",
      expiredDeleting: "semantic/expired-deleting.png",
      failed: "semantic/failed.png",
      deadLetter: "semantic/dead-letter.png",
      deleted: "semantic/deleted.png",
    });
    const output = await admin.query(
      `insert into ai_content_generation_outputs(
         generation_id,workspace_id,brand_id,output_index,title,status,
         artifact_manifest_json,manifest_url
       ) values($1,$2,$3,1,'Storage output','completed',$4::jsonb,$5) returning id`,
      [generation.rows[0].id, workspace.rows[0].id, brand.rows[0].id, JSON.stringify({ assets: [
        { storagePath: paths.storageArtifact },
        { storagePath: paths.channel },
        { storagePath: paths.reference },
      ] }), `https://storage.example.test/${paths.manifestUrl}?download=1`],
    );
    await admin.query(
      `insert into ai_content_generation_render_jobs(
         generation_id,output_id,workspace_id,brand_id,job_kind,status,payload_json,result_json,completed_at
       ) values($1,$2,$3,$4,'package_finalize','succeeded','{}'::jsonb,$5::jsonb,now())`,
      [generation.rows[0].id, output.rows[0].id, workspace.rows[0].id, brand.rows[0].id,
        JSON.stringify({ video: { path: paths.renderResult } })],
    );

    const boundAnalysis = await admin.query(
      `insert into ai_content_subject_analyses(
         workspace_id,brand_id,generation_id,contract_version,subject_type,status,idempotency_key
       ) values($1,$2,$3,'subject-analysis.v2','product','ready',$4) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, generation.rows[0].id, `bound-${randomUUID()}`],
    );
    const unrelatedAnalysis = await admin.query(
      `insert into ai_content_subject_analyses(
         workspace_id,brand_id,contract_version,subject_type,source_url,normalized_url,status,idempotency_key
       ) values($1,$2,'subject-analysis.v1','product',$3,$3,'ready',$4) returning id`,
      [workspace.rows[0].id, brand.rows[0].id,
        `https://example.test/unrelated-${randomUUID()}`, `unrelated-${randomUUID()}`],
    );
    await admin.query(
      `insert into ai_content_subject_images(
         analysis_id,workspace_id,brand_id,source_url,storage_url,storage_path,mime_type,role
       ) values
       ($1,$3,$4,$5,$6,$7,'image/png','product'),
       ($2,$3,$4,$8,$9,$10,'image/png','product')`,
      [boundAnalysis.rows[0].id, unrelatedAnalysis.rows[0].id,
        workspace.rows[0].id, brand.rows[0].id,
        "https://source.example.test/bound.png", `https://storage.example.test/${paths.boundSubject}`,
        paths.boundSubject, "https://source.example.test/unrelated.png",
        `https://storage.example.test/${paths.unrelatedSubject}`, paths.unrelatedSubject],
    );

    const retainedArtifact = await admin.query(
      `insert into storage_artifacts(
         workspace_id,brand_id,artifact_type,bucket,path,checksum
       ) values($1,$2,'rendered_image','semantic',$3,$4) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, paths.storageArtifact, "b".repeat(64)],
    );
    assert.ok(retainedArtifact.rows[0].id);
    const topic = await admin.query(
      "insert into content_topics(workspace_id,brand_id,title,angle) values($1,$2,'Semantic retained channel','test') returning id",
      [workspace.rows[0].id, brand.rows[0].id],
    );
    const draft = await admin.query(
      `insert into master_drafts(workspace_id,brand_id,content_topic_id,prompt_version)
       values($1,$2,$3,'semantic-test') returning id`,
      [workspace.rows[0].id, brand.rows[0].id, topic.rows[0].id],
    );
    const retainedChannel = await admin.query(
      `insert into channel_outputs(
         workspace_id,brand_id,content_topic_id,master_draft_id,channel,title,delivery_format,
         output_json,ai_content_generation_output_id
       ) values($1,$2,$3,$4,'instagram','Semantic channel','instagram_feed_carousel',$5::jsonb,$6)
       returning id`,
      [workspace.rows[0].id, brand.rows[0].id, topic.rows[0].id, draft.rows[0].id,
        JSON.stringify({ publishedAsset: paths.channel }), output.rows[0].id],
    );
    const referenceSource = await admin.query(
      `insert into source_urls(workspace_id,brand_id,source_type,url,url_hash)
       values($1,$2,'reference',$3,$4) returning id`,
      [workspace.rows[0].id, brand.rows[0].id,
        `https://reference.example.test/${randomUUID()}`, randomUUID().replaceAll("-", "")],
    );
    await admin.query(
      `insert into reference_items(
         workspace_id,brand_id,kind,source_url_id,preview_url,title
       ) values($1,$2,'external_url',$3,$4,'Semantic reference')`,
      [workspace.rows[0].id, brand.rows[0].id, referenceSource.rows[0].id, paths.reference],
    );

    const knownChecksum = "c".repeat(64);
    await admin.query(
      `insert into ai_content_generation_attachments(
         generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
         checksum,storage_url,storage_path
       ) values($1,$2,$3,'visual_reference','checksum-conflict.png','image/png',1,$4,$5,$6)`,
      [generation.rows[0].id, workspace.rows[0].id, brand.rows[0].id,
        knownChecksum, `https://storage.example.test/${paths.checksumConflict}`, paths.checksumConflict],
    );
    const conflictingArtifact = await admin.query(
      `insert into storage_artifacts(
         workspace_id,brand_id,artifact_type,bucket,path,checksum
       ) values($1,$2,'rendered_image','semantic-conflict',$3,$4) returning id`,
      [workspace.rows[0].id, brand.rows[0].id, paths.checksumConflict, "d".repeat(64)],
    );

    const deletionFixtures = [
      [paths.expiredDeleting, "deleting", 4, randomUUID(), "10 minutes"],
      [paths.failed, "failed", 3, null, null],
      [paths.deadLetter, "dead_letter", 10, null, null],
      [paths.deleted, "deleted", 2, null, null],
    ];
    const deletionIds = new Map();
    for (const [storagePath, status, attemptCount, leaseToken, leaseOffset] of deletionFixtures) {
      const inserted = await admin.query(
        `insert into ai_content_attachment_deletion_jobs(
           workspace_id,brand_id,generation_id,storage_url,storage_path,reason,status,
           attempt_count,lease_token,lease_expires_at,last_error_category,last_error_message,completed_at
         ) values($1,$2,$3,$4,$5,'semantic_fixture',$6,$7,$8,
           case when $9::text is null then null else now()+$9::interval end,
           case when $6 in ('failed','dead_letter') then 'fixture' end,
           case when $6 in ('failed','dead_letter') then 'fixture failure' end,
           case when $6='deleted' then now() end) returning id`,
        [workspace.rows[0].id, brand.rows[0].id, generation.rows[0].id,
          `https://storage.example.test/${storagePath}`, storagePath, status,
          attemptCount, leaseToken, leaseOffset],
      );
      deletionIds.set(storagePath, inserted.rows[0].id);
    }

    await assert.rejects(
      admin.query(migration075WithoutProviderRegistration),
      /ai_content_attachment_deletion_lease_active/,
    );
    await admin.query("rollback");
    assert.equal((await admin.query("select to_regclass('public.ai_content_storage_cleanup_outbox') as relation")).rows[0].relation, null);

    await admin.query(
      `update ai_content_attachment_deletion_jobs set lease_expires_at=now()-interval '1 minute'
        where id=$1`,
      [deletionIds.get(paths.expiredDeleting)],
    );
    await assert.rejects(
      admin.query(migration075WithoutProviderRegistration),
      /ai_content_storage_checksum_conflict/,
    );
    await admin.query("rollback");
    assert.equal((await admin.query("select to_regclass('public.ai_content_storage_cleanup_outbox') as relation")).rows[0].relation, null);
    await admin.query("update storage_artifacts set checksum=$1 where id=$2", [knownChecksum, conflictingArtifact.rows[0].id]);

    const cutoverId = randomUUID();
    const hash = "e".repeat(64);
    const preflightIdentity = {
      preflightCandidateSha: "f".repeat(40),
      contentProposalWorkerImageDigest: `sha256:${"1".repeat(64)}`,
      proposalWorkerSourceSha: "2".repeat(40),
      proposalWorkerTreeSha: "3".repeat(40),
      proposalContractSourceSha256: "4".repeat(64),
      proposalSchemaSha256: "5".repeat(64),
      proposalCatalogSha256: "6".repeat(64),
      proposalModelId: "gpt-5.6-terra",
      proposalCommandDescriptorSha256: "7".repeat(64),
      migrationSha256: migration075.checksum,
    };
    await admin.query(
      `insert into ai_content_cutovers(
         id,status,migration_id,schema_owner_role_name,application_role_name,operator_role_name,
         migration_role_name,cleanup_role_name,bypass_token_sha256,cleanup_token_sha256,
         database_role_catalog_sha256,provider_backup_id,provider_snapshot_created_at,
         incident_bundle_sha256,preserved_data_manifest_sha256,proposal_preflight_identity_json,
         proposal_preflight_identity_sha256,proposal_preflight_transfer_sha256,
         intended_release_sha,latest_status_event_sha256
       ) values($1,'maintenance_verified','075_ai_content_three_format_cutover.sql',
         'semantic_schema_owner','semantic_application','semantic_operator','semantic_migration',
         'semantic_cleanup',$2,$2,$2,'semantic-backup',now(),$2,$2,$3::jsonb,$2,$2,$4,$2)`,
      [cutoverId, hash, JSON.stringify(preflightIdentity), "8".repeat(40)],
    );
    await admin.query(
      "update ai_content_maintenance_state set enabled=true,cutover_id=$1,enabled_at=now() where singleton",
      [cutoverId],
    );
    await admin.query("select set_config('app.ai_content_cutover_id',$1,false)", [cutoverId]);
    // This supplemental harness isolates 075's reconciliation transaction. The exact
    // provider-owned 074 fence lifecycle is covered by migrationRunner.test.mjs.
    const writeFenceTriggers = (await admin.query(
      `select relation.relname as relation_name,trigger.tgname as trigger_name
         from pg_trigger trigger
         join pg_class relation on relation.oid=trigger.tgrelid
         join pg_namespace namespace on namespace.oid=relation.relnamespace
        where namespace.nspname='public' and not trigger.tgisinternal
          and trigger.tgfoid='public.enforce_ai_content_write_fence()'::regprocedure
        order by relation.relname,trigger.tgname`,
    )).rows;
    assert.ok(writeFenceTriggers.length > 0);
    for (const trigger of writeFenceTriggers) {
      await admin.query(
        `alter table ${quoteIdentifier(trigger.relation_name)} disable trigger ${quoteIdentifier(trigger.trigger_name)}`,
      );
    }
    try {
      await admin.query(migration075WithoutProviderRegistration);
    } catch (error) {
      await admin.query("rollback");
      error.message = [error.message, error.where, error.detail].filter(Boolean).join(": ");
      throw error;
    } finally {
      for (const trigger of writeFenceTriggers) {
        await admin.query(
          `alter table ${quoteIdentifier(trigger.relation_name)} enable always trigger ${quoteIdentifier(trigger.trigger_name)}`,
        );
      }
    }

    const outbox = (await admin.query(
      `select storage_path,status,known_checksum_sha256,
              retention_evidence_sha256 is not null as has_retention_evidence,
              completed_at is not null as completed
         from ai_content_storage_cleanup_outbox
        where workspace_id=$1 order by storage_path`,
      [workspace.rows[0].id],
    )).rows;
    const byPath = new Map(outbox.map((row) => [row.storage_path, row]));
    assert.equal(byPath.get(paths.boundSubject)?.status, "pending");
    assert.equal(byPath.has(paths.unrelatedSubject), false);
    assert.equal(byPath.get(paths.manifestUrl)?.status, "pending");
    assert.equal(byPath.get(paths.renderResult)?.status, "pending");
    for (const storagePath of [paths.storageArtifact, paths.channel, paths.reference]) {
      assert.deepEqual(byPath.get(storagePath), {
        storage_path: storagePath,
        status: "retained_reference",
        known_checksum_sha256: null,
        has_retention_evidence: true,
        completed: true,
      });
    }
    assert.deepEqual(byPath.get(paths.checksumConflict), {
      storage_path: paths.checksumConflict,
      status: "retained_reference",
      known_checksum_sha256: knownChecksum,
      has_retention_evidence: true,
      completed: true,
    });
    for (const storagePath of [paths.expiredDeleting, paths.failed, paths.deadLetter]) {
      assert.equal(byPath.get(storagePath)?.status, "pending");
    }
    assert.deepEqual(byPath.get(paths.deleted), {
      storage_path: paths.deleted,
      status: "deleted",
      known_checksum_sha256: null,
      has_retention_evidence: false,
      completed: true,
    });
    const resetDeletionRows = (await admin.query(
      `select storage_path,status,attempt_count,lease_token,lease_expires_at,
              last_error_category,last_error_message,completed_at,reason
         from ai_content_attachment_deletion_jobs
        where storage_path=any($1::text[]) order by storage_path`,
      [[paths.expiredDeleting, paths.failed, paths.deadLetter]],
    )).rows;
    for (const row of resetDeletionRows) {
      assert.deepEqual(row, {
        storage_path: row.storage_path,
        status: "pending",
        attempt_count: 0,
        lease_token: null,
        lease_expires_at: null,
        last_error_category: null,
        last_error_message: null,
        completed_at: null,
        reason: "three_format_cutover",
      });
    }
    assert.equal(
      Number((await admin.query("select count(*) count from ai_content_generations")).rows[0].count),
      0,
    );
    assert.deepEqual(
      (await admin.query(
        "select ai_content_generation_output_id,output_json from channel_outputs where id=$1",
        [retainedChannel.rows[0].id],
      )).rows,
      [{ ai_content_generation_output_id: null, output_json: { publishedAsset: paths.channel } }],
      "publication history and preview payload must survive while only the retired output FK is detached",
    );
  } catch (error) {
    testError = error;
    throw error;
  } finally {
    const teardownFailures = [];
    if (admin) {
      try {
        await admin.end();
      } catch (error) {
        teardownFailures.push(error);
      }
    }
    if (container) {
      try {
        await container.stop();
      } catch (error) {
        teardownFailures.push(error);
      }
    }
    if (!testError && teardownFailures.length) {
      throw new AggregateError(teardownFailures, "075 storage reconciliation harness teardown failed");
    }
  }
});
