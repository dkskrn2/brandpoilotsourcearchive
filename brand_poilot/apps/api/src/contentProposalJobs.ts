import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ContentProposalV1 } from "./aiContentContracts.js";

export interface ContentProposalJobRecord {
  id: string;
  workspaceId: string;
  brandId: string;
  batchId: string;
  status: "queued" | "processing" | "completed" | "failed";
  request: Record<string, unknown>;
  sourceSnapshots: Record<string, unknown>[];
  attemptCount: number;
  maxAttempts: number;
  workerId: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  availableAt: string;
}

export interface ContentProposalJobsRepository {
  claimContentProposalJob(input: {
    workerId: string;
    leaseSeconds: number;
  }): Promise<ContentProposalJobRecord | null>;
  heartbeatContentProposalJob(input: {
    jobId: string;
    workerId: string;
    leaseToken: string;
    leaseSeconds: number;
  }): Promise<boolean>;
  completeContentProposalJob(input: {
    jobId: string;
    workerId: string;
    leaseToken: string;
    proposals: unknown[];
  }): Promise<{ id: string; batchId: string; status: "completed" }>;
  failContentProposalJob(input: {
    jobId: string;
    workerId: string;
    leaseToken: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
  }): Promise<{ id: string; batchId: string; status: "queued" | "failed" }>;
}

function iso(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  return new Date(value).toISOString();
}

function mapJob(row: Record<string, unknown>): ContentProposalJobRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    batchId: String(row.batch_id),
    status: row.status as ContentProposalJobRecord["status"],
    request: row.request_json as Record<string, unknown>,
    sourceSnapshots: Array.isArray(row.source_snapshot_json)
      ? row.source_snapshot_json as Record<string, unknown>[]
      : [],
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    workerId: row.lease_owner ? String(row.lease_owner) : null,
    leaseToken: row.lease_token ? String(row.lease_token) : null,
    leaseExpiresAt: iso(row.lease_expires_at),
    availableAt: iso(row.available_at) ?? "",
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseContentProposalResult(value: unknown[]): ContentProposalV1[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) {
    throw new Error("content_proposal_result_invalid");
  }
  for (const proposal of value) {
    if (!isObject(proposal)
      || proposal.contractVersion !== "content-proposal.v1"
      || !nonEmptyText(proposal.title)
      || !nonEmptyText(proposal.reasonToCreateNow)
      || !["informational", "marketing"].includes(String(proposal.contentFamily))
      || !nonEmptyText(proposal.topic)
      || !isObject(proposal.target)
      || !["problem_solution", "how_to", "comparison", "faq", "insight", "benefit", "social_proof", "brand_story", "cta"].includes(String(proposal.messageStrategy))
      || !nonEmptyText(proposal.hook)
      || !nonEmptyText(proposal.keyMessage)
      || !Array.isArray(proposal.evidence)
      || proposal.evidence.some((evidence) => !isObject(evidence)
        || !nonEmptyText(evidence.sourceSnapshotId)
        || !nonEmptyText(evidence.summary))
      || !Array.isArray(proposal.outline)
      || proposal.outline.length === 0
      || proposal.outline.some((item) => !isObject(item)
        || !nonEmptyText(item.heading)
        || !nonEmptyText(item.purpose))
      || !["card_news", "blog", "single_image", "channel_text"].includes(String(proposal.outputFormat))
      || !Array.isArray(proposal.channelTargets)
      || proposal.channelTargets.some((channel) => !nonEmptyText(channel))
      || !isObject(proposal.recommendedReferenceQuery)
      || !Array.isArray(proposal.recommendedReferenceQuery.strategies)
      || !Array.isArray(proposal.recommendedReferenceQuery.formats)
      || !Array.isArray(proposal.recommendedReferenceQuery.tags)) {
      throw new Error("content_proposal_result_invalid");
    }
  }
  return value as ContentProposalV1[];
}

export function createContentProposalJobsRepository(pool: Pool): ContentProposalJobsRepository {
  return {
    async claimContentProposalJob(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `update ai_content_proposal_jobs
              set status='failed', error_code='content_proposal_attempts_exhausted',
                  error_message='proposal job attempts exhausted', completed_at=now(),
                  lease_owner=null, lease_token=null, lease_started_at=null, lease_expires_at=null,
                  updated_at=now()
            where status in ('queued','processing')
              and attempt_count >= max_attempts
              and (status='queued' or lease_expires_at <= clock_timestamp())`,
        );
        const selected = await client.query(
          `select job.id
             from ai_content_proposal_jobs job
            where job.status='queued' and job.available_at <= clock_timestamp()
              and job.attempt_count < job.max_attempts
            order by job.available_at, job.created_at, job.id
            for update skip locked
            limit 1`,
        );
        if (!selected.rowCount) {
          await client.query("COMMIT");
          return null;
        }
        const leaseToken = randomUUID();
        const claimed = await client.query(
          `update ai_content_proposal_jobs job
              set status = 'processing',
                  attempt_count = attempt_count + 1,
                  lease_owner = $2,
                  lease_token = $3,
                  lease_started_at = clock_timestamp(),
                  lease_expires_at = clock_timestamp()
                    + (least($4::integer, 900)::text || ' seconds')::interval,
                  updated_at = now()
             from ai_content_proposal_batches batch
            where job.id = $1
              and batch.id = job.batch_id
              and batch.workspace_id = job.workspace_id
              and batch.brand_id = job.brand_id
            returning job.*, batch.request_json, batch.source_snapshot_json`,
          [selected.rows[0]?.id, input.workerId, leaseToken, input.leaseSeconds],
        );
        await client.query("COMMIT");
        return claimed.rowCount ? mapJob(claimed.rows[0]) : null;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async heartbeatContentProposalJob(input) {
      const result = await pool.query(
        `update ai_content_proposal_jobs
            set (lease_expires_at, updated_at) = (
                  select heartbeat.at
                           + (least($4::integer, 900)::text || ' seconds')::interval,
                         heartbeat.at
                    from (select clock_timestamp() at) heartbeat
                )
          where id=$1 and status='processing' and lease_owner=$2 and lease_token=$3
            and lease_expires_at > clock_timestamp()
          returning id`,
        [input.jobId, input.workerId, input.leaseToken, input.leaseSeconds],
      );
      return Boolean(result.rowCount);
    },

    async completeContentProposalJob(input) {
      const proposals = parseContentProposalResult(input.proposals);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `select job.*, lease_expires_at <= clock_timestamp() as lease_expired
             from ai_content_proposal_jobs job
            where job.id=$1
            for update`,
          [input.jobId],
        );
        const job = result.rows[0] as Record<string, unknown> | undefined;
        if (!job) throw new Error("content_proposal_job_not_found");
        if (job.status === "completed") {
          if (job.completion_lease_owner !== input.workerId
            || String(job.completion_lease_token) !== input.leaseToken) {
            throw new Error("content_proposal_job_lease_invalid");
          }
          await client.query("COMMIT");
          return { id: String(job.id), batchId: String(job.batch_id), status: "completed" };
        }
        if (job.status !== "processing"
          || job.lease_owner !== input.workerId
          || String(job.lease_token) !== input.leaseToken
          || job.lease_expired === true) {
          throw new Error("content_proposal_job_lease_invalid");
        }
        await client.query(
          `insert into ai_content_proposals (
             workspace_id, brand_id, batch_id, position, proposal_json
           )
           select job.workspace_id, job.brand_id, job.batch_id,
                  proposal.ordinality::integer, proposal.value
             from ai_content_proposal_jobs job
             cross join jsonb_array_elements($2::jsonb) with ordinality proposal(value, ordinality)
            where job.id=$1
           on conflict (batch_id,position) do nothing`,
          [input.jobId, JSON.stringify(proposals)],
        );
        await client.query(
          `update ai_content_proposal_batches batch
              set status='ready', updated_at=now()
             from ai_content_proposal_jobs job
            where job.id=$1 and batch.id=job.batch_id
              and batch.workspace_id=job.workspace_id and batch.brand_id=job.brand_id`,
          [input.jobId],
        );
        await client.query(
          `update ai_content_proposal_jobs
              set status = 'completed', lease_owner=null, lease_token=null,
                  lease_started_at=null, lease_expires_at=null,
                  completion_lease_owner=$2,completion_lease_token=$3,
                  completed_at=now(), updated_at=now()
            where id=$1`,
          [input.jobId, input.workerId, input.leaseToken],
        );
        await client.query("COMMIT");
        return { id: String(job.id), batchId: String(job.batch_id), status: "completed" };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async failContentProposalJob(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `select job.*, lease_expires_at <= clock_timestamp() as lease_expired
             from ai_content_proposal_jobs job
            where job.id=$1
            for update`,
          [input.jobId],
        );
        const job = result.rows[0] as Record<string, unknown> | undefined;
        if (!job) throw new Error("content_proposal_job_not_found");
        if (job.status !== "processing"
          || job.lease_owner !== input.workerId
          || String(job.lease_token) !== input.leaseToken
          || job.lease_expired === true) {
          throw new Error("content_proposal_job_lease_invalid");
        }
        const retry = input.retryable && Number(job.attempt_count) < Number(job.max_attempts);
        await client.query(
          `update ai_content_proposal_jobs
              set status = $2,
                  available_at = case when $2='queued' then now() + interval '60 seconds' else available_at end,
                  lease_owner=null, lease_token=null, lease_started_at=null, lease_expires_at=null,
                  error_code = case when $2='failed' then $3 else null end,
                  error_message = case when $2='failed' then $4 else null end,
                  completed_at = case when $2='failed' then now() else null end,
                  updated_at=now()
            where id=$1 and attempt_count < max_attempts + 1`,
          [input.jobId, retry ? "queued" : "failed", input.errorCode, input.errorMessage],
        );
        if (!retry) {
          await client.query(
            `update ai_content_proposal_batches batch
                set status='failed', error_code=$2, error_message=$3, updated_at=now()
               from ai_content_proposal_jobs job
              where job.id=$1 and batch.id=job.batch_id
                and batch.workspace_id=job.workspace_id and batch.brand_id=job.brand_id`,
            [input.jobId, input.errorCode, input.errorMessage],
          );
        }
        await client.query("COMMIT");
        return {
          id: String(job.id),
          batchId: String(job.batch_id),
          status: retry ? "queued" : "failed",
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
