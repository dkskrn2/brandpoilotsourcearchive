import { readFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ContentOrchestrationV2 } from "@brand-pilot/content-contracts";
import { createAiContentProposalV2Repository } from "./aiContentRepository.js";
import { createAiContentProposalV2Service } from "./aiContentProposalV2Service.js";
import { parseProposalInputSnapshotV2 } from "./aiContentGenerationInputV3.js";
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

function proposalResearchEvidence() {
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
    capturedAt: "2026-08-05T01:00:00.000Z",
    items: [{
      id: "70000000-0000-4000-8000-000000000007",
      ...observed,
      capturedAt: "2026-08-05T01:00:00.000Z",
      contentHash: createHash("sha256").update(JSON.stringify(observed)).digest("hex"),
    }],
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
    evidenceIds: ["70000000-0000-4000-8000-000000000007"],
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

    it("commits a performance audit, research snapshot, and composition under the real 075 constraints", async () => {
      const repository = createAiContentProposalV2Repository(pool);
      const requestValue: ContentOrchestrationV2 = {
        ...request(),
        seed: { kind: "topic_text" as const, title: "성과 패턴을 활용한 다음 구성안" },
        contentInstruction: "관측된 메시지 구조를 새 주제에 적용합니다.",
        outputSettings: {
          outputFormat: "card_news" as const,
          channelTargets: ["instagram" as const],
          aspectRatio: "1:1" as const,
          outputCount: 1 as const,
        },
      };
      const base = resolved(requestValue).baseInput;
      const evidence = {
        contractVersion: "research-evidence.v1" as const,
        decision: "searched" as const,
        reason: "승인된 공개 성과 근거",
        queries: [],
        capturedAt: "2026-08-05T00:00:00.000Z",
        items: [{
          id: "70000000-0000-4000-8000-000000000007",
          title: "공개 게시물",
          url: "https://example.test/performance",
          publisher: "example.test",
          publishedAt: "2026-08-01T00:00:00.000Z",
          capturedAt: "2026-08-05T00:00:00.000Z",
          claimSummary: "공개된 성과 근거",
          contentHash: "a".repeat(64),
        }],
      };
      const { contractVersion: _baseVersion, ...baseFields } = base;
      const service = createAiContentProposalV2Service({
        ...repository,
        assertReady: async () => undefined,
        resolve: async () => ({
          request: requestValue,
          baseInput: base,
          sourceSnapshots: [],
          performanceAudit: {
            experimentId: "6f7772c4-7c03-4e2a-86f4-7c6bf3f65ef1",
            evidenceVersion: "b".repeat(64),
            experimentDefinition: { version: "reuse-performing-pattern.v2" },
            resolvedInputFingerprint: "c".repeat(64),
            snapshotAudit: {
              policyVersion: "performance-evidence.v2",
              snapshots: [{ id: "80000000-0000-4000-8000-000000000008" }],
            },
            capturedFrom: "2026-08-05T00:00:00.000Z",
            capturedTo: "2026-08-05T00:00:00.000Z",
            researchEvidence: evidence,
            composedInput: parseProposalInputSnapshotV2({
              ...baseFields,
              contractVersion: "proposal-input.v2",
              researchEvidence: evidence,
            }),
          },
        }),
      });

      await service.create({
        source: "performance_experiment",
        workspaceId: ids.workspace,
        brandId: ids.brand,
        actorUserId: ids.actor,
        experimentId: "6f7772c4-7c03-4e2a-86f4-7c6bf3f65ef1",
        evidenceVersion: "b".repeat(64),
      });

      const graph = await pool.query(`select
        (select count(*)::int from ai_content_proposal_batches) batches,
        (select count(*)::int from ai_content_proposal_jobs) jobs,
        (select count(*)::int from ai_content_proposal_job_contracts) contracts,
        (select count(*)::int from ai_content_proposal_performance_audits) audits,
        (select count(*)::int from ai_content_proposal_research_snapshots) research,
        (select count(*)::int from ai_content_proposal_compositions) compositions`);
      expect(graph.rows[0]).toEqual({
        batches: 1, jobs: 1, contracts: 1, audits: 1, research: 1, compositions: 1,
      });
    }, 30_000);

    async function enqueueManualProposal(label: string) {
      const creationRepository = createAiContentProposalV2Repository(pool);
      const service = createAiContentProposalV2Service({
        ...creationRepository,
        assertReady: async () => undefined,
        resolve: async () => resolved(),
      });
      return service.create({
        source: "manual",
        workspaceId: ids.workspace,
        brandId: ids.brand,
        actorUserId: ids.actor,
        idempotencyKey: `${label}:${randomUUID()}`,
        request: request(),
      });
    }

    async function claimThroughComposition(label: string, modelLeaseSeconds = 180) {
      const created = await enqueueManualProposal(label);
      const jobs = createContentProposalJobsRepository(pool);
      const research = await jobs.claimContentProposalJob({
        workerId: `${label}-research-worker`,
        leaseSeconds: 180,
      }) as ContentProposalResearchClaim;
      expect(research.stage).toBe("research_required");
      const seal = await jobs.completeContentProposalResearch({
        jobId: research.id,
        workerId: research.workerId,
        leaseToken: research.leaseToken,
        researchAttemptId: research.researchAttemptId,
        evidence: proposalResearchEvidence(),
      });
      const model = await jobs.claimContentProposalJob({
        workerId: `${label}-model-worker`,
        leaseSeconds: modelLeaseSeconds,
      }) as ContentProposalModelClaim;
      expect(model.stage).toBe("composition_ready");
      return { created, jobs, research, seal, model };
    }

    async function raceBehindModelAttemptLock(
      modelAttemptId: string,
      start: () => [Promise<unknown>, Promise<unknown>],
    ) {
      const gate = await pool.connect();
      try {
        await gate.query("begin");
        await gate.query(
          "select id from ai_content_proposal_model_attempts where id=$1 for update",
          [modelAttemptId],
        );
        const pending = start();
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
        await gate.query("commit");
        return await Promise.allSettled(pending);
      } catch (error) {
        await gate.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        gate.release();
      }
    }

    function expectNoDeadlock(results: PromiseSettledResult<unknown>[]) {
      for (const result of results) {
        if (result.status === "rejected") {
          expect(String(result.reason)).not.toContain("deadlock detected");
        }
      }
    }

    it("runs manual research through a valid repaired model completion with exact replays", async () => {
      const fixture = await claimThroughComposition("proposal-worker-success");
      const staleResearchHeartbeat = await fixture.jobs.heartbeatContentProposalJob({
        jobId: fixture.research.id,
        workerId: fixture.research.workerId,
        leaseToken: fixture.research.leaseToken,
        leaseSeconds: 180,
        stage: "research_required",
        attemptId: fixture.research.researchAttemptId,
      });
      expect(staleResearchHeartbeat).toBe(false);

      const replayedSeal = await fixture.jobs.completeContentProposalResearch({
        jobId: fixture.research.id,
        workerId: fixture.research.workerId,
        leaseToken: fixture.research.leaseToken,
        researchAttemptId: fixture.research.researchAttemptId,
        evidence: proposalResearchEvidence(),
      });
      expect(replayedSeal).toEqual(fixture.seal);

      const firstStart = await fixture.jobs.startContentProposalInvocation({
        jobId: fixture.model.id,
        workerId: fixture.model.workerId,
        leaseToken: fixture.model.leaseToken,
        modelAttemptId: fixture.model.modelAttemptId,
        invocationOrdinal: 1,
      });
      await expect(fixture.jobs.startContentProposalInvocation({
        jobId: fixture.model.id,
        workerId: fixture.model.workerId,
        leaseToken: fixture.model.leaseToken,
        modelAttemptId: fixture.model.modelAttemptId,
        invocationOrdinal: 1,
      })).resolves.toEqual(firstStart);

      const invalidFirst = {
        jobId: fixture.model.id,
        workerId: fixture.model.workerId,
        leaseToken: fixture.model.leaseToken,
        modelAttemptId: fixture.model.modelAttemptId,
        invocationOrdinal: 1 as const,
        eventType: "invocation_completed" as const,
        transcriptSha256: "1".repeat(64),
        outputSha256: "2".repeat(64),
        parserSha256: "3".repeat(64),
        parserValid: false,
      };
      const invalidTerminal = await fixture.jobs.recordContentProposalInvocationTerminal(invalidFirst);
      expect(invalidTerminal.status).toBe("processing");
      await expect(fixture.jobs.recordContentProposalInvocationTerminal(invalidFirst))
        .resolves.toEqual(invalidTerminal);

      await fixture.jobs.startContentProposalInvocation({
        jobId: fixture.model.id,
        workerId: fixture.model.workerId,
        leaseToken: fixture.model.leaseToken,
        modelAttemptId: fixture.model.modelAttemptId,
        invocationOrdinal: 2,
      });
      const identity = {
        jobId: fixture.model.id,
        workerId: fixture.model.workerId,
        leaseToken: fixture.model.leaseToken,
        modelAttemptId: fixture.model.modelAttemptId,
        invocationOrdinal: 2 as const,
        transcriptSha256: "4".repeat(64),
        outputSha256: "5".repeat(64),
        parserSha256: "6".repeat(64),
        proposalSet: proposalSet(),
      };
      const completed = await fixture.jobs.completeContentProposalJob(identity);
      await expect(fixture.jobs.completeContentProposalJob(identity)).resolves.toEqual(completed);
      await expect(fixture.jobs.completeContentProposalJob({
        ...identity,
        leaseToken: randomUUID(),
      })).rejects.toThrow("content_proposal_completion_conflict");

      const graph = await pool.query(
        `select job.status job_status,batch.status batch_status,job.attempt_count,
                (select count(*)::int from ai_content_proposals proposal where proposal.batch_id=batch.id) proposals,
                (select array_agg(event_type order by event_sequence)
                   from ai_content_proposal_attempt_events event
                  where event.model_attempt_id=$2) events
           from ai_content_proposal_jobs job
           join ai_content_proposal_batches batch on batch.id=job.batch_id
          where job.id=$1`,
        [fixture.model.id, fixture.model.modelAttemptId],
      );
      expect(graph.rows[0]).toEqual({
        job_status: "completed",
        batch_status: "ready",
        attempt_count: 1,
        proposals: 3,
        events: [
          "invocation_started", "invocation_completed", "invocation_started",
          "invocation_completed", "attempt_succeeded",
        ],
      });
    }, 30_000);

    it("terminalizes a parser-invalid second invocation without persisting proposals", async () => {
      const fixture = await claimThroughComposition("proposal-worker-invalid-repair");
      await fixture.jobs.startContentProposalInvocation({
        jobId: fixture.model.id, workerId: fixture.model.workerId,
        leaseToken: fixture.model.leaseToken, modelAttemptId: fixture.model.modelAttemptId,
        invocationOrdinal: 1,
      });
      await fixture.jobs.recordContentProposalInvocationTerminal({
        jobId: fixture.model.id, workerId: fixture.model.workerId,
        leaseToken: fixture.model.leaseToken, modelAttemptId: fixture.model.modelAttemptId,
        invocationOrdinal: 1, eventType: "invocation_completed",
        transcriptSha256: "1".repeat(64), outputSha256: "2".repeat(64),
        parserSha256: "3".repeat(64), parserValid: false,
      });
      await fixture.jobs.startContentProposalInvocation({
        jobId: fixture.model.id, workerId: fixture.model.workerId,
        leaseToken: fixture.model.leaseToken, modelAttemptId: fixture.model.modelAttemptId,
        invocationOrdinal: 2,
      });
      await expect(fixture.jobs.recordContentProposalInvocationTerminal({
        jobId: fixture.model.id, workerId: fixture.model.workerId,
        leaseToken: fixture.model.leaseToken, modelAttemptId: fixture.model.modelAttemptId,
        invocationOrdinal: 2, eventType: "invocation_completed",
        transcriptSha256: "4".repeat(64), outputSha256: "5".repeat(64),
        parserSha256: "6".repeat(64), parserValid: false,
      })).resolves.toMatchObject({ status: "failed" });

      const graph = await pool.query(
        `select job.status job_status,batch.status batch_status,
                (select count(*)::int from ai_content_proposals proposal where proposal.batch_id=batch.id) proposals,
                (select array_agg(event_type order by event_sequence)
                   from ai_content_proposal_attempt_events event
                  where event.model_attempt_id=$2) events
           from ai_content_proposal_jobs job
           join ai_content_proposal_batches batch on batch.id=job.batch_id
          where job.id=$1`,
        [fixture.model.id, fixture.model.modelAttemptId],
      );
      expect(graph.rows[0]).toEqual({
        job_status: "failed",
        batch_status: "failed",
        proposals: 0,
        events: [
          "invocation_started", "invocation_completed", "invocation_started",
          "invocation_completed", "attempt_failed",
        ],
      });
    }, 30_000);

    it("projects an expired unresolved invocation to manual review instead of reclaiming it", async () => {
      const fixture = await claimThroughComposition("proposal-worker-expiry", 1);
      await fixture.jobs.startContentProposalInvocation({
        jobId: fixture.model.id,
        workerId: fixture.model.workerId,
        leaseToken: fixture.model.leaseToken,
        modelAttemptId: fixture.model.modelAttemptId,
        invocationOrdinal: 1,
      });
      await pool.query("select pg_sleep(1.2)");

      await expect(fixture.jobs.claimContentProposalJob({
        workerId: "proposal-worker-reclaimer",
        leaseSeconds: 180,
      })).resolves.toBeNull();

      const state = await pool.query(
        `select job.status job_status,job.error_code,batch.status batch_status,batch.error_code batch_error_code
           from ai_content_proposal_jobs job
           join ai_content_proposal_batches batch on batch.id=job.batch_id
          where job.id=$1`,
        [fixture.model.id],
      );
      expect(state.rows[0]).toEqual({
        job_status: "manual_review_required",
        error_code: "invocation_indeterminate",
        batch_status: "failed",
        batch_error_code: "invocation_indeterminate",
      });
    }, 30_000);

    it("serializes completion against expiry reclaim with one attempt terminal", async () => {
      const fixture = await claimThroughComposition("proposal-worker-complete-reclaim-race");
      await fixture.jobs.startContentProposalInvocation({
        jobId: fixture.model.id,
        workerId: fixture.model.workerId,
        leaseToken: fixture.model.leaseToken,
        modelAttemptId: fixture.model.modelAttemptId,
        invocationOrdinal: 1,
      });
      const invalid = {
        jobId: fixture.model.id,
        workerId: fixture.model.workerId,
        leaseToken: fixture.model.leaseToken,
        modelAttemptId: fixture.model.modelAttemptId,
        invocationOrdinal: 1 as const,
        eventType: "invocation_completed" as const,
        transcriptSha256: "1".repeat(64),
        outputSha256: "2".repeat(64),
        parserSha256: "3".repeat(64),
        parserValid: false,
      };
      await fixture.jobs.recordContentProposalInvocationTerminal(invalid);
      await pool.query(
        "update ai_content_proposal_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
        [fixture.model.id],
      );

      const results = await raceBehindModelAttemptLock(fixture.model.modelAttemptId, () => [
        fixture.jobs.completeContentProposalJob({
          jobId: fixture.model.id,
          workerId: fixture.model.workerId,
          leaseToken: fixture.model.leaseToken,
          modelAttemptId: fixture.model.modelAttemptId,
          invocationOrdinal: 1,
          transcriptSha256: invalid.transcriptSha256,
          outputSha256: invalid.outputSha256,
          parserSha256: invalid.parserSha256,
          proposalSet: proposalSet(),
        }),
        fixture.jobs.claimContentProposalJob({ workerId: "complete-race-reclaimer", leaseSeconds: 180 }),
      ]);

      expectNoDeadlock(results);
      expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
      const state = await pool.query(
        `select job.status,
                count(*) filter(where event.event_type in
                  ('attempt_succeeded','attempt_failed','pre_invocation_failed'))::integer terminal_count,
                array_agg(event.event_type order by event.event_sequence) events
           from ai_content_proposal_jobs job
           join ai_content_proposal_attempt_events event on event.job_id=job.id
          where job.id=$1
          group by job.id`,
        [fixture.model.id],
      );
      expect(state.rows[0]).toEqual({
        status: "queued",
        terminal_count: 1,
        events: ["invocation_started", "invocation_completed", "attempt_failed"],
      });
    }, 30_000);

    it("serializes worker failure against expiry reclaim with one pre-invocation terminal", async () => {
      const fixture = await claimThroughComposition("proposal-worker-fail-reclaim-race");
      await pool.query(
        "update ai_content_proposal_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
        [fixture.model.id],
      );

      const results = await raceBehindModelAttemptLock(fixture.model.modelAttemptId, () => [
        fixture.jobs.failContentProposalJob({
          jobId: fixture.model.id,
          workerId: fixture.model.workerId,
          leaseToken: fixture.model.leaseToken,
          stage: "composition_ready",
          attemptId: fixture.model.modelAttemptId,
          errorCode: "worker_failed_before_model_start",
          errorMessage: "worker stopped before model invocation",
          retryable: false,
        }),
        fixture.jobs.claimContentProposalJob({ workerId: "failure-race-reclaimer", leaseSeconds: 180 }),
      ]);

      expectNoDeadlock(results);
      expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
      const state = await pool.query(
        `select job.status,
                count(*) filter(where event.event_type='pre_invocation_failed')::integer terminal_count,
                array_agg(event.event_type order by event.event_sequence) events
           from ai_content_proposal_jobs job
           join ai_content_proposal_attempt_events event on event.job_id=job.id
          where job.id=$1
          group by job.id`,
        [fixture.model.id],
      );
      expect(state.rows[0]).toEqual({
        status: "queued",
        terminal_count: 1,
        events: ["pre_invocation_failed"],
      });
    }, 30_000);

    it("records bounded research expiry evidence for nonfinal and final attempts", async () => {
      const jobs = createContentProposalJobsRepository(pool);
      await enqueueManualProposal("proposal-worker-expired-research-retry");
      const retry = await jobs.claimContentProposalJob({
        workerId: "expired-research-retry", leaseSeconds: 180,
      }) as ContentProposalResearchClaim;
      await pool.query(
        "update ai_content_proposal_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
        [retry.id],
      );
      await expect(jobs.claimContentProposalJob({ workerId: "research-reclaimer", leaseSeconds: 180 }))
        .resolves.toBeNull();

      await enqueueManualProposal("proposal-worker-expired-research-final");
      const final = await jobs.claimContentProposalJob({
        workerId: "expired-research-final", leaseSeconds: 180,
      }) as ContentProposalResearchClaim;
      await pool.query(
        "update ai_content_proposal_research_attempts set attempt_number=3 where id=$1",
        [final.researchAttemptId],
      );
      await pool.query(
        "update ai_content_proposal_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
        [final.id],
      );
      await expect(jobs.claimContentProposalJob({ workerId: "research-final-reclaimer", leaseSeconds: 180 }))
        .resolves.toBeNull();

      const states = await pool.query(
        `select job.id,job.status,event.error_code,event.error_message,event.retryable,event.terminal
           from ai_content_proposal_jobs job
           join ai_content_proposal_research_attempt_events event on event.job_id=job.id
          where job.id=any($1::uuid[]) and event.event_type='attempt_failed'
          order by job.id`,
        [[retry.id, final.id]],
      );
      expect(states.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: retry.id, status: "queued", error_code: "research_lease_expired",
          error_message: "research lease expired before evidence commit", retryable: true, terminal: false,
        }),
        expect.objectContaining({
          id: final.id, status: "failed", error_code: "research_lease_expired",
          error_message: "research lease expired before evidence commit", retryable: false, terminal: true,
        }),
      ]));
    }, 30_000);

    it("records bounded zero-event model expiry evidence for nonfinal and final attempts", async () => {
      const retry = await claimThroughComposition("proposal-worker-expired-model-retry");
      await pool.query(
        "update ai_content_proposal_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
        [retry.model.id],
      );
      await expect(retry.jobs.claimContentProposalJob({ workerId: "model-reclaimer", leaseSeconds: 180 }))
        .resolves.toBeNull();

      const final = await claimThroughComposition("proposal-worker-expired-model-final");
      await pool.query(
        "update ai_content_proposal_model_attempts set attempt_number=3 where id=$1",
        [final.model.modelAttemptId],
      );
      await pool.query(
        `update ai_content_proposal_jobs set attempt_count=max_attempts,
           lease_expires_at=clock_timestamp()-interval '1 second' where id=$1`,
        [final.model.id],
      );
      await expect(final.jobs.claimContentProposalJob({ workerId: "model-final-reclaimer", leaseSeconds: 180 }))
        .resolves.toBeNull();

      const states = await pool.query(
        `select job.id,job.status,event.error_code,event.error_message,event.retryable,event.terminal
           from ai_content_proposal_jobs job
           join ai_content_proposal_attempt_events event on event.job_id=job.id
          where job.id=any($1::uuid[]) and event.event_type='pre_invocation_failed'`,
        [[retry.model.id, final.model.id]],
      );
      expect(states.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: retry.model.id, status: "queued", error_code: "model_lease_expired",
          error_message: "model lease expired before invocation start", retryable: true, terminal: false,
        }),
        expect.objectContaining({
          id: final.model.id, status: "failed", error_code: "model_lease_expired",
          error_message: "model lease expired before invocation start", retryable: false, terminal: true,
        }),
      ]));
    }, 30_000);

    it("reclaims parser-invalid orphans and sends parser-valid orphans to manual review", async () => {
      const invalid = await claimThroughComposition("proposal-worker-expired-invalid");
      await invalid.jobs.startContentProposalInvocation({
        jobId: invalid.model.id, workerId: invalid.model.workerId,
        leaseToken: invalid.model.leaseToken, modelAttemptId: invalid.model.modelAttemptId,
        invocationOrdinal: 1,
      });
      await invalid.jobs.recordContentProposalInvocationTerminal({
        jobId: invalid.model.id, workerId: invalid.model.workerId,
        leaseToken: invalid.model.leaseToken, modelAttemptId: invalid.model.modelAttemptId,
        invocationOrdinal: 1, eventType: "invocation_completed",
        transcriptSha256: "1".repeat(64), outputSha256: "2".repeat(64),
        parserSha256: "3".repeat(64), parserValid: false,
      });
      await pool.query(
        "update ai_content_proposal_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
        [invalid.model.id],
      );
      await expect(invalid.jobs.claimContentProposalJob({ workerId: "invalid-reclaimer", leaseSeconds: 180 }))
        .resolves.toBeNull();

      const valid = await claimThroughComposition("proposal-worker-expired-valid");
      await valid.jobs.startContentProposalInvocation({
        jobId: valid.model.id, workerId: valid.model.workerId,
        leaseToken: valid.model.leaseToken, modelAttemptId: valid.model.modelAttemptId,
        invocationOrdinal: 1,
      });
      await pool.query(
        `select append_ai_content_proposal_attempt_event(
           attempt.id,$2,2,1,'invocation_completed',attempt.aggregate_contract_sha256,
           attempt.model_sha256,attempt.command_descriptor_sha256,attempt.composed_input_sha256,
           $3,$4,$5,true)
           from ai_content_proposal_model_attempts attempt where attempt.id=$1`,
        [valid.model.modelAttemptId, valid.model.leaseToken, "4".repeat(64), "5".repeat(64), "6".repeat(64)],
      );
      await pool.query(
        "update ai_content_proposal_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
        [valid.model.id],
      );
      await expect(valid.jobs.claimContentProposalJob({ workerId: "valid-reclaimer", leaseSeconds: 180 }))
        .resolves.toBeNull();

      const state = await pool.query(
        `select job.id,job.status,job.error_code,
                (select array_agg(event_type order by event_sequence)
                   from ai_content_proposal_attempt_events event
                  where event.job_id=job.id) events
           from ai_content_proposal_jobs job where job.id=any($1::uuid[])`,
        [[invalid.model.id, valid.model.id]],
      );
      expect(state.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: invalid.model.id, status: "queued",
          events: ["invocation_started", "invocation_completed", "attempt_failed"],
        }),
        expect.objectContaining({
          id: valid.model.id, status: "manual_review_required",
          error_code: "proposal_completion_indeterminate",
          events: ["invocation_started", "invocation_completed"],
        }),
      ]));
    }, 30_000);

    it("bounds model cost to maxAttempts times two invocations", async () => {
      const fixture = await claimThroughComposition("proposal-worker-cost-cap");
      let model = fixture.model;
      for (let attemptNumber = 1; attemptNumber <= model.maxAttempts; attemptNumber += 1) {
        for (const ordinal of [1, 2] as const) {
          await fixture.jobs.startContentProposalInvocation({
            jobId: model.id, workerId: model.workerId, leaseToken: model.leaseToken,
            modelAttemptId: model.modelAttemptId, invocationOrdinal: ordinal,
          });
          await fixture.jobs.recordContentProposalInvocationTerminal({
            jobId: model.id, workerId: model.workerId, leaseToken: model.leaseToken,
            modelAttemptId: model.modelAttemptId, invocationOrdinal: ordinal,
            eventType: "invocation_completed", transcriptSha256: `${attemptNumber}`.repeat(64),
            outputSha256: `${ordinal + 3}`.repeat(64), parserSha256: `${ordinal + 5}`.repeat(64),
            parserValid: false,
          });
        }
        if (attemptNumber < model.maxAttempts) {
          await pool.query("update ai_content_proposal_jobs set available_at=clock_timestamp() where id=$1", [model.id]);
          model = await fixture.jobs.claimContentProposalJob({
            workerId: `cost-cap-model-${attemptNumber + 1}`, leaseSeconds: 180,
          }) as ContentProposalModelClaim;
          expect(model.modelAttemptNumber).toBe(attemptNumber + 1);
        }
      }
      await expect(fixture.jobs.claimContentProposalJob({ workerId: "cost-cap-overflow", leaseSeconds: 180 }))
        .resolves.toBeNull();
      const counts = await pool.query(
        `select job.status,
                (select count(*)::int from ai_content_proposal_model_attempts attempt where attempt.job_id=job.id) attempts,
                (select count(*)::int from ai_content_proposal_attempt_events event
                  where event.job_id=job.id and event.event_type='invocation_started') starts
           from ai_content_proposal_jobs job where job.id=$1`,
        [model.id],
      );
      expect(counts.rows[0]).toEqual({ status: "failed", attempts: 3, starts: 6 });
    }, 30_000);

    it("fences late heartbeat and invocation start while reclaiming an expired lease", async () => {
      const fixture = await claimThroughComposition("proposal-worker-reclaim-race");
      await pool.query(
        "update ai_content_proposal_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
        [fixture.model.id],
      );
      const [reclaim, heartbeat, start] = await Promise.allSettled([
        fixture.jobs.claimContentProposalJob({ workerId: "race-reclaimer", leaseSeconds: 180 }),
        fixture.jobs.heartbeatContentProposalJob({
          jobId: fixture.model.id, workerId: fixture.model.workerId,
          leaseToken: fixture.model.leaseToken, leaseSeconds: 180,
          stage: "composition_ready", attemptId: fixture.model.modelAttemptId,
        }),
        fixture.jobs.startContentProposalInvocation({
          jobId: fixture.model.id, workerId: fixture.model.workerId,
          leaseToken: fixture.model.leaseToken, modelAttemptId: fixture.model.modelAttemptId,
          invocationOrdinal: 1,
        }),
      ]);
      expect(reclaim).toEqual({ status: "fulfilled", value: null });
      expect(heartbeat).toEqual({ status: "fulfilled", value: false });
      expect(start.status).toBe("rejected");
      const evidence = await pool.query(
        `select event_type,error_code,retryable from ai_content_proposal_attempt_events
          where model_attempt_id=$1 order by event_sequence`,
        [fixture.model.modelAttemptId],
      );
      expect(evidence.rows).toEqual([{
        event_type: "pre_invocation_failed", error_code: "model_lease_expired", retryable: true,
      }]);
    }, 30_000);

    it("projects permanent research failure through the authorized research event ledger", async () => {
      await enqueueManualProposal("proposal-worker-research-failure");
      const jobs = createContentProposalJobsRepository(pool);
      const research = await jobs.claimContentProposalJob({
        workerId: "proposal-worker-research-failure",
        leaseSeconds: 180,
      }) as ContentProposalResearchClaim;

      await expect(jobs.failContentProposalJob({
        jobId: research.id,
        workerId: research.workerId,
        leaseToken: research.leaseToken,
        stage: "research_required",
        attemptId: research.researchAttemptId,
        errorCode: "research_unavailable",
        errorMessage: "provider unavailable",
        retryable: false,
      })).resolves.toMatchObject({ status: "failed" });

      const state = await pool.query(
        `select job.status job_status,job.error_code,batch.status batch_status,
                event.event_type,event.error_code event_error_code,event.retryable,event.terminal
           from ai_content_proposal_jobs job
           join ai_content_proposal_batches batch on batch.id=job.batch_id
           join ai_content_proposal_research_attempt_events event on event.job_id=job.id
          where job.id=$1 and event.event_type='attempt_failed'`,
        [research.id],
      );
      expect(state.rows[0]).toEqual({
        job_status: "failed",
        error_code: "research_unavailable",
        batch_status: "failed",
        event_type: "attempt_failed",
        event_error_code: "research_unavailable",
        retryable: false,
        terminal: true,
      });
    }, 30_000);

    it("projects final pre-spawn model exhaustion without an invocation event", async () => {
      const fixture = await claimThroughComposition("proposal-worker-final-pre-spawn");
      await pool.query(
        "update ai_content_proposal_jobs set attempt_count=max_attempts where id=$1",
        [fixture.model.id],
      );

      await expect(fixture.jobs.failContentProposalJob({
        jobId: fixture.model.id,
        workerId: fixture.model.workerId,
        leaseToken: fixture.model.leaseToken,
        stage: "composition_ready",
        attemptId: fixture.model.modelAttemptId,
        errorCode: "model_spawn_failed",
        errorMessage: "worker could not start model",
        retryable: true,
      })).resolves.toMatchObject({ status: "failed" });

      const state = await pool.query(
        `select job.status job_status,job.error_code,batch.status batch_status,
                event.event_type,event.invocation_ordinal,event.error_code event_error_code,
                event.retryable,event.terminal,
                (select count(*)::int from ai_content_proposal_attempt_events invocation
                  where invocation.model_attempt_id=event.model_attempt_id
                    and invocation.event_type='invocation_started') invocation_starts
           from ai_content_proposal_jobs job
           join ai_content_proposal_batches batch on batch.id=job.batch_id
           join ai_content_proposal_attempt_events event on event.job_id=job.id
          where job.id=$1 and event.event_type='pre_invocation_failed'`,
        [fixture.model.id],
      );
      expect(state.rows[0]).toEqual({
        job_status: "failed",
        error_code: "model_spawn_failed",
        batch_status: "failed",
        event_type: "pre_invocation_failed",
        invocation_ordinal: null,
        event_error_code: "model_spawn_failed",
        retryable: true,
        terminal: true,
        invocation_starts: 0,
      });
    }, 30_000);
  },
);
