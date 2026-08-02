import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";
import type {
  ContentProposalSetV2,
  ContentProposalV1,
  ProposalInputSnapshotV2,
  ResearchEvidenceSnapshotV1,
} from "./aiContentContracts.js";
import {
  parseContentProposalSetV2,
  parseProposalInputSnapshotV2,
  parseResearchEvidenceSnapshotV1,
} from "./aiContentGenerationInputV3.js";

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
  inputSnapshot?: Record<string, unknown> | ProposalInputSnapshotV2;
  researchEvidence?: ResearchEvidenceSnapshotV1;
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
    proposals?: unknown[];
    proposalSet?: unknown;
  }): Promise<{ id: string; batchId: string; status: "completed" }>;
  completeContentProposalResearch(input: {
    jobId: string;
    workerId: string;
    leaseToken: string;
    evidence: ResearchEvidenceSnapshotV1;
  }): Promise<ProposalInputSnapshotV2>;
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
  const inputSnapshot = isObject(row.input_snapshot_json) ? row.input_snapshot_json : null;
  const evidence = isObject(row.evidence_json) ? validateResearchEvidence(row.evidence_json) : null;
  const composed = inputSnapshot?.contractVersion === "proposal-base-input.v2" && evidence
    ? composeProposalInput(inputSnapshot, evidence)
    : inputSnapshot;
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
    ...(composed ? { inputSnapshot: composed } : {}),
    ...(evidence ? { researchEvidence: evidence } : {}),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function evidenceItemHash(item: ResearchEvidenceSnapshotV1["items"][number]): string {
  return createHash("sha256").update(JSON.stringify({
    title: item.title,
    url: item.url,
    publisher: item.publisher,
    publishedAt: item.publishedAt,
    claimSummary: item.claimSummary,
  })).digest("hex");
}

function validateResearchEvidence(value: unknown): ResearchEvidenceSnapshotV1 {
  let parsed: ResearchEvidenceSnapshotV1;
  try {
    parsed = parseResearchEvidenceSnapshotV1(value);
  } catch {
    throw new Error("content_proposal_research_invalid");
  }
  if (parsed.queries.length > 4 || parsed.items.some((item) => {
    try {
      return new URL(item.url).protocol !== "https:" || evidenceItemHash(item) !== item.contentHash;
    } catch {
      return true;
    }
  })) {
    throw new Error("content_proposal_research_invalid");
  }
  return parsed;
}

function composeProposalInput(
  base: Record<string, unknown>,
  evidence: ResearchEvidenceSnapshotV1,
): ProposalInputSnapshotV2 {
  try {
    const { contractVersion: _contractVersion, ...fields } = base;
    return parseProposalInputSnapshotV2({
      ...fields,
      contractVersion: "proposal-input.v2",
      researchEvidence: evidence,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("content_proposal_")) throw error;
    throw new Error("content_proposal_research_invalid");
  }
}

function nonEmptyText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const contentFamilies = ["informational", "marketing"] as const;
const messageStrategies = [
  "problem_solution", "how_to", "comparison", "faq", "insight",
  "benefit", "social_proof", "brand_story", "cta",
] as const;
const outputFormats = ["card_news", "blog", "single_image", "channel_text"] as const;
const channelTargets = [
  "instagram", "threads", "x", "linkedin", "youtube", "tiktok", "blog_export",
] as const;
const proposalKeys = [
  "contractVersion", "title", "reasonToCreateNow", "contentFamily", "topic",
  "target", "messageStrategy", "hook", "keyMessage", "evidence", "outline",
  "outputFormat", "channelTargets", "recommendedReferenceQuery",
].sort();

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function isUniqueStringArray(value: unknown, allowed?: readonly string[]): value is string[] {
  return Array.isArray(value)
    && value.every((item) => nonEmptyText(item) && (!allowed || allowed.includes(String(item))))
    && new Set(value).size === value.length;
}

export function parseContentProposalResult(value: unknown[]): ContentProposalV1[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) {
    throw new Error("content_proposal_result_invalid");
  }
  for (const proposal of value) {
    if (!isObject(proposal)
      || !hasExactKeys(proposal, proposalKeys)
      || proposal.contractVersion !== "content-proposal.v1"
      || !nonEmptyText(proposal.title)
      || !nonEmptyText(proposal.reasonToCreateNow)
      || !contentFamilies.includes(proposal.contentFamily as typeof contentFamilies[number])
      || !nonEmptyText(proposal.topic)
      || !isObject(proposal.target)
      || !messageStrategies.includes(proposal.messageStrategy as typeof messageStrategies[number])
      || !nonEmptyText(proposal.hook)
      || !nonEmptyText(proposal.keyMessage)
      || !Array.isArray(proposal.evidence)
      || proposal.evidence.some((evidence) => !isObject(evidence)
        || !hasExactKeys(evidence, ["sourceSnapshotId", "summary"])
        || !nonEmptyText(evidence.sourceSnapshotId)
        || !nonEmptyText(evidence.summary))
      || !Array.isArray(proposal.outline)
      || proposal.outline.length === 0
      || proposal.outline.some((item) => !isObject(item)
        || !hasExactKeys(item, ["heading", "purpose"])
        || !nonEmptyText(item.heading)
        || !nonEmptyText(item.purpose))
      || !outputFormats.includes(proposal.outputFormat as typeof outputFormats[number])
      || !isUniqueStringArray(proposal.channelTargets, channelTargets)
      || proposal.channelTargets.length === 0
      || !isObject(proposal.recommendedReferenceQuery)
      || !hasExactKeys(proposal.recommendedReferenceQuery, ["strategies", "formats", "tags"])
      || !isUniqueStringArray(proposal.recommendedReferenceQuery.strategies, messageStrategies)
      || !isUniqueStringArray(proposal.recommendedReferenceQuery.formats, outputFormats)
      || !isUniqueStringArray(proposal.recommendedReferenceQuery.tags)) {
      throw new Error("content_proposal_result_invalid");
    }
  }
  return value as ContentProposalV1[];
}

function parseContentProposalSetResult(
  value: unknown,
  errorCode: "content_proposal_result_invalid" | "content_proposal_completion_conflict",
): ContentProposalSetV2 {
  try {
    return parseContentProposalSetV2(value);
  } catch {
    throw new Error(errorCode);
  }
}

type ContentProposalRequestContract = "v1" | "v2" | "invalid";

function classifyContentProposalRequest(value: unknown): ContentProposalRequestContract {
  if (!isObject(value)) return "invalid";
  if (value.contractVersion === "content-proposal-request.v1") return "v1";
  if (value.contractVersion === "content-proposal-request.v2") return "v2";
  return "invalid";
}

type DeferredParse<T> =
  | { status: "absent" }
  | { status: "valid"; value: T }
  | { status: "invalid" };

function deferParse<T>(value: unknown, parser: (input: unknown) => T): DeferredParse<T> {
  if (value === undefined) return { status: "absent" };
  try {
    return { status: "valid", value: parser(value) };
  } catch {
    return { status: "invalid" };
  }
}

function assertProposalsMatchBatch(
  proposals: ContentProposalV1[],
  job: Record<string, unknown>,
): void {
  const request = isObject(job.request_json) ? job.request_json : {};
  const requestedFormats = new Set(Array.isArray(request.outputFormats) ? request.outputFormats : []);
  const requestedChannels = new Set(Array.isArray(request.channelTargets) ? request.channelTargets : []);
  const requestedSourceIds = new Set(Array.isArray(request.sourceSnapshotIds) ? request.sourceSnapshotIds : []);
  const frozenSourceIds = new Set(
    Array.isArray(job.source_snapshot_json)
      ? job.source_snapshot_json.flatMap((snapshot) => {
          const sourceId = isObject(snapshot) ? snapshot.sourceId : null;
          return nonEmptyText(sourceId) ? [sourceId as string] : [];
        })
      : [],
  );
  const family = String(job.content_family ?? "");
  if (request.contentFamily !== family
    || [...requestedSourceIds].some((id) => !frozenSourceIds.has(id))
    || proposals.some((proposal) => proposal.contentFamily !== family
      || !requestedFormats.has(proposal.outputFormat)
      || proposal.channelTargets.some((channel) => !requestedChannels.has(channel))
      || proposal.evidence.some((evidence) => !requestedSourceIds.has(evidence.sourceSnapshotId)
        || !frozenSourceIds.has(evidence.sourceSnapshotId)))) {
    throw new Error("content_proposal_batch_mismatch");
  }
}

function assertProposalSetMatchesBatch(
  proposalSet: ContentProposalSetV2,
  snapshot: ProposalInputSnapshotV2,
  request: Record<string, unknown>,
  contentFamily: unknown,
): void {
  const settings = snapshot.outputSettings;
  if (contentFamily !== settings.purpose
    || request.purpose !== settings.purpose
    || request.outputFormat !== settings.outputFormat
    || !Array.isArray(request.channelTargets)
    || request.channelTargets.length !== 1
    || request.channelTargets[0] !== settings.channelTargets[0]) {
    throw new Error("content_proposal_batch_mismatch");
  }
  const evidenceIds = new Set(snapshot.researchEvidence.items.map((item) => item.id));
  const referenceIds = new Set(snapshot.references.map((reference) => reference.referenceItemId));
  for (const proposal of proposalSet.proposals) {
    if (proposal.outputFormat !== settings.outputFormat
      || proposal.channelTargets.length !== 1
      || proposal.channelTargets[0] !== settings.channelTargets[0]
      || proposal.purposeDetails.kind !== settings.purpose
      || proposal.evidenceIds.some((id) => !evidenceIds.has(id))
      || proposal.referenceIds.some((id) => !referenceIds.has(id))
      || (settings.purpose === "marketing"
        && (snapshot.product === null
          || proposal.purposeDetails.kind !== "marketing"
          || proposal.purposeDetails.productId !== snapshot.product.id))
      || (settings.purpose === "informational"
        && (snapshot.product !== null || proposal.purposeDetails.kind !== "informational"))) {
      throw new Error("content_proposal_batch_mismatch");
    }
  }
}

export function createContentProposalJobsRepository(pool: Pool): ContentProposalJobsRepository {
  return {
    async claimContentProposalJob(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `with exhausted as (
             update ai_content_proposal_jobs
                set status='failed', error_code='content_proposal_attempts_exhausted',
                    error_message='proposal job attempts exhausted', completed_at=now(),
                    lease_owner=null, lease_token=null, lease_started_at=null, lease_expires_at=null,
                    updated_at=now()
              where status in ('queued','processing')
                and attempt_count >= max_attempts
                and (status='queued' or lease_expires_at <= clock_timestamp())
              returning batch_id,workspace_id,brand_id
           )
           update ai_content_proposal_batches batch
              set status='failed',error_code='content_proposal_attempts_exhausted',
                  error_message='proposal job attempts exhausted',updated_at=now()
             from exhausted
            where batch.id=exhausted.batch_id
              and batch.workspace_id=exhausted.workspace_id
              and batch.brand_id=exhausted.brand_id`,
        );
        await client.query(
          `update ai_content_proposal_jobs
              set status='queued',available_at=clock_timestamp(),
                  lease_owner=null,lease_token=null,lease_started_at=null,lease_expires_at=null,
                  updated_at=now()
            where status='processing'
              and attempt_count < max_attempts
              and lease_expires_at <= clock_timestamp()`,
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
            returning job.*, batch.request_json, batch.source_snapshot_json,
                      batch.input_snapshot_json,
                      (select research.evidence_json
                         from ai_content_proposal_research_snapshots research
                        where research.batch_id=batch.id
                          and research.workspace_id=batch.workspace_id
                          and research.brand_id=batch.brand_id) evidence_json`,
          [selected.rows[0]?.id, input.workerId, leaseToken, input.leaseSeconds],
        );
        if (claimed.rowCount) {
          await client.query(
            `update ai_content_proposal_batches batch
                set status='building',error_code=null,error_message=null,updated_at=now()
               from ai_content_proposal_jobs job
              where job.id=$1 and batch.id=job.batch_id
                and batch.workspace_id=job.workspace_id and batch.brand_id=job.brand_id`,
            [selected.rows[0]?.id],
          );
        }
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

    async completeContentProposalResearch(input) {
      const evidence = validateResearchEvidence(input.evidence);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `select job.*,batch.content_family,batch.request_json,batch.source_snapshot_json,
                  batch.input_snapshot_json,research.evidence_json,
                  job.lease_expires_at <= clock_timestamp() as lease_expired
             from ai_content_proposal_jobs job
             join ai_content_proposal_batches batch
               on batch.id=job.batch_id and batch.workspace_id=job.workspace_id
              and batch.brand_id=job.brand_id
             left join ai_content_proposal_research_snapshots research
               on research.batch_id=batch.id and research.workspace_id=batch.workspace_id
              and research.brand_id=batch.brand_id
            where job.id=$1
            for update of job,batch`,
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
        const request = isObject(job.request_json) ? job.request_json : {};
        const base = isObject(job.input_snapshot_json) ? job.input_snapshot_json : null;
        if (request.contractVersion !== "content-proposal-request.v2"
          || base?.contractVersion !== "proposal-base-input.v2") {
          throw new Error("content_proposal_research_v2_required");
        }
        if (job.content_family === "informational"
          && (evidence.decision !== "searched" || evidence.items.length === 0)) {
          throw new Error("content_proposal_research_invalid");
        }
        const existing = isObject(job.evidence_json)
          ? validateResearchEvidence(job.evidence_json)
          : null;
        if (existing && !isDeepStrictEqual(existing, evidence)) {
          throw new Error("content_proposal_research_snapshot_conflict");
        }
        if (!existing) {
          await client.query(
            `insert into ai_content_proposal_research_snapshots (
               workspace_id,brand_id,batch_id,evidence_json
             ) select job.workspace_id,job.brand_id,job.batch_id,$2::jsonb
                 from ai_content_proposal_jobs job
                where job.id=$1`,
            [input.jobId, JSON.stringify(evidence)],
          );
        }
        const snapshot = composeProposalInput(base, evidence);
        await client.query("COMMIT");
        return snapshot;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async completeContentProposalJob(input) {
      const parsedV1 = deferParse(input.proposals, (value) => {
        if (!Array.isArray(value)) throw new Error("content_proposal_result_invalid");
        return parseContentProposalResult(value);
      });
      const parsedV2 = deferParse(input.proposalSet, parseContentProposalSetV2);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `select job.*,batch.content_family,batch.request_json,batch.source_snapshot_json,
                  batch.input_snapshot_json,research.evidence_json,
                  job.lease_expires_at <= clock_timestamp() as lease_expired
             from ai_content_proposal_jobs job
             join ai_content_proposal_batches batch
               on batch.id=job.batch_id and batch.workspace_id=job.workspace_id
              and batch.brand_id=job.brand_id
             left join ai_content_proposal_research_snapshots research
               on research.batch_id=batch.id and research.workspace_id=batch.workspace_id
              and research.brand_id=batch.brand_id
            where job.id=$1
            for update of job,batch`,
          [input.jobId],
        );
        const job = result.rows[0] as Record<string, unknown> | undefined;
        if (!job) throw new Error("content_proposal_job_not_found");
        const requestContract = classifyContentProposalRequest(job.request_json);
        const request = isObject(job.request_json) ? job.request_json : {};
        if (requestContract === "v1"
          && (parsedV1.status === "invalid" || parsedV2.status === "invalid")) {
          throw new Error("content_proposal_result_invalid");
        }
        if (job.status === "completed") {
          if (job.completion_lease_owner !== input.workerId
            || String(job.completion_lease_token) !== input.leaseToken) {
            throw new Error("content_proposal_job_lease_invalid");
          }
          if (requestContract === "invalid") {
            throw new Error("content_proposal_completion_conflict");
          }
          if (requestContract === "v2") {
            if (input.proposals !== undefined || input.proposalSet === undefined) {
              throw new Error("content_proposal_completion_conflict");
            }
            if (parsedV2.status !== "valid") throw new Error("content_proposal_completion_conflict");
            const retryProposalSet = parsedV2.value;
            const stored = await client.query(
              `select position,proposal_json
                 from ai_content_proposals
                where batch_id=$1 and workspace_id=$2 and brand_id=$3
                order by position`,
              [job.batch_id, job.workspace_id, job.brand_id],
            );
            if (stored.rows.length !== 3
              || stored.rows.some((row, index) => Number(row.position) !== index + 1)) {
              throw new Error("content_proposal_completion_conflict");
            }
            const storedProposalSet = parseContentProposalSetResult(
              {
                contractVersion: "content-proposal.v2",
                proposals: stored.rows.map((row) => row.proposal_json),
              },
              "content_proposal_completion_conflict",
            );
            if (!isDeepStrictEqual(storedProposalSet, retryProposalSet)) {
              throw new Error("content_proposal_completion_conflict");
            }
          }
          await client.query("COMMIT");
          return { id: String(job.id), batchId: String(job.batch_id), status: "completed" };
        }
        if (requestContract === "v2"
          && (parsedV1.status === "invalid" || parsedV2.status === "invalid")) {
          throw new Error("content_proposal_result_invalid");
        }
        if (job.status !== "processing"
          || job.lease_owner !== input.workerId
          || String(job.lease_token) !== input.leaseToken
          || job.lease_expired === true) {
          throw new Error("content_proposal_job_lease_invalid");
        }
        if (requestContract === "invalid") throw new Error("content_proposal_result_invalid");
        let proposals: ContentProposalV1[] | ContentProposalSetV2["proposals"];
        if (requestContract === "v2") {
          if (input.proposals !== undefined || input.proposalSet === undefined) {
            throw new Error("content_proposal_result_invalid");
          }
          if (parsedV2.status !== "valid") throw new Error("content_proposal_result_invalid");
          const proposalSet = parsedV2.value;
          const base = isObject(job.input_snapshot_json) ? job.input_snapshot_json : null;
          const evidence = isObject(job.evidence_json) ? validateResearchEvidence(job.evidence_json) : null;
          if (!base || base.contractVersion !== "proposal-base-input.v2" || !evidence) {
            throw new Error("content_proposal_research_required");
          }
          const snapshot = composeProposalInput(base, evidence);
          assertProposalSetMatchesBatch(proposalSet, snapshot, request, job.content_family);
          proposals = proposalSet.proposals;
        } else {
          if (input.proposalSet !== undefined || !Array.isArray(input.proposals)) {
            throw new Error("content_proposal_result_invalid");
          }
          if (parsedV1.status !== "valid") throw new Error("content_proposal_result_invalid");
          assertProposalsMatchBatch(parsedV1.value, job);
          proposals = parsedV1.value;
        }
        const inserted = await client.query(
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
        if (requestContract === "v2" && inserted.rowCount !== 3) {
          throw new Error("content_proposal_result_invalid");
        }
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
