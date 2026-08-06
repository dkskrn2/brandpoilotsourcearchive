import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import {
  parseContentProposalRequestV2,
  parseProposalBaseInputSnapshotV2,
  type ContentProposalRequestV2,
  type ProposalBaseInputSnapshotV2,
} from "@brand-pilot/content-contracts";
import type {
  ContentProposalSetV2,
  ProposalInputSnapshotV2,
  ResearchEvidenceSnapshotV1,
} from "./aiContentContracts.js";
import {
  parseContentProposalSetV2,
  parseProposalInputSnapshotV2,
  parseResearchEvidenceSnapshotV1,
} from "./aiContentGenerationInputV3.js";
import { canonicalProposalJson, proposalSha256 } from "./aiContentProposalV2Service.js";

export type ContentProposalClaimStage = "research_required" | "composition_ready";

export interface ContentProposalJobContractRecord {
  id: string;
  requestContractVersion: string;
  baseInputContractVersion: string;
  researchContractVersion: string;
  proposalContractVersion: string;
  proposalPromptVersion: string;
  proposalOutputSchemaSha256: string;
  modelId: string;
  commandDescriptorSha256: string;
  requestSha256: string;
  baseInputSha256: string;
  contractSourceSha256: string;
  catalogSha256: string;
  enqueueContractSha256: string;
}

interface ContentProposalClaimBase {
  id: string;
  workspaceId: string;
  brandId: string;
  batchId: string;
  status: "processing";
  stage: ContentProposalClaimStage;
  attemptCount: number;
  maxAttempts: number;
  workerId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  availableAt: string;
  request: ContentProposalRequestV2;
  contract: ContentProposalJobContractRecord;
}

export interface ContentProposalResearchClaim extends ContentProposalClaimBase {
  stage: "research_required";
  researchAttemptId: string;
  researchAttemptNumber: number;
  baseInput: ProposalBaseInputSnapshotV2;
}

export interface ContentProposalModelClaim extends ContentProposalClaimBase {
  stage: "composition_ready";
  modelAttemptId: string;
  modelAttemptNumber: number;
  compositionId: string;
  composedInput: ProposalInputSnapshotV2;
  evidenceSetSha256: string;
  composedInputSha256: string;
  finalInvocationAggregateSha256: string;
  modelSha256: string;
}

export type ContentProposalJobRecord = ContentProposalResearchClaim | ContentProposalModelClaim;

type WorkerLeaseIdentity = {
  jobId: string;
  workerId: string;
  leaseToken: string;
};

export interface ContentProposalJobsRepository {
  claimContentProposalJob(input: { workerId: string; leaseSeconds: number }): Promise<ContentProposalJobRecord | null>;
  heartbeatContentProposalJob(input: WorkerLeaseIdentity & {
    leaseSeconds: number;
    stage: ContentProposalClaimStage;
    attemptId: string;
  }): Promise<boolean>;
  completeContentProposalResearch(input: WorkerLeaseIdentity & {
    researchAttemptId: string;
    evidence: ResearchEvidenceSnapshotV1;
  }): Promise<{
    jobId: string;
    batchId: string;
    status: "queued";
    compositionId: string;
    composedInput: ProposalInputSnapshotV2;
    evidenceSetSha256: string;
    composedInputSha256: string;
    finalInvocationAggregateSha256: string;
  }>;
  startContentProposalInvocation(input: WorkerLeaseIdentity & {
    modelAttemptId: string;
    invocationOrdinal: 1 | 2;
  }): Promise<{ eventSha256: string }>;
  recordContentProposalInvocationTerminal(input: WorkerLeaseIdentity & {
    modelAttemptId: string;
    invocationOrdinal: 1 | 2;
    eventType: "invocation_completed" | "invocation_failed" | "invocation_indeterminate";
    transcriptSha256: string | null;
    outputSha256: string | null;
    parserSha256: string | null;
    parserValid: boolean | null;
  }): Promise<{
    eventSha256: string;
    status: "processing" | "queued" | "failed" | "manual_review_required";
  }>;
  completeContentProposalJob(input: WorkerLeaseIdentity & {
    modelAttemptId: string;
    invocationOrdinal: 1 | 2;
    transcriptSha256: string;
    outputSha256: string;
    parserSha256: string;
    proposalSet: unknown;
  }): Promise<{
    jobId: string;
    batchId: string;
    status: "completed";
    invocationEventSha256: string;
    attemptEventSha256: string;
  }>;
  failContentProposalJob(input: WorkerLeaseIdentity & {
    stage: ContentProposalClaimStage;
    attemptId: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
  }): Promise<{ id: string; batchId: string; status: "queued" | "failed" }>;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function iso(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== "string") throw new Error("content_proposal_job_invalid");
  const result = new Date(value).toISOString();
  if (result === "Invalid Date") throw new Error("content_proposal_job_invalid");
  return result;
}

function contractFromRow(row: Record<string, unknown>): ContentProposalJobContractRecord {
  return {
    id: String(row.contract_id),
    requestContractVersion: String(row.request_contract_version),
    baseInputContractVersion: String(row.base_input_contract_version),
    researchContractVersion: String(row.research_contract_version),
    proposalContractVersion: String(row.proposal_contract_version),
    proposalPromptVersion: String(row.proposal_prompt_version),
    proposalOutputSchemaSha256: String(row.proposal_output_schema_sha256),
    modelId: String(row.proposal_model_id),
    commandDescriptorSha256: String(row.command_descriptor_sha256),
    requestSha256: String(row.request_sha256),
    baseInputSha256: String(row.base_input_sha256),
    contractSourceSha256: String(row.contract_source_sha256),
    catalogSha256: String(row.catalog_sha256),
    enqueueContractSha256: String(row.enqueue_contract_sha256),
  };
}

function frozenBaseInput(row: Record<string, unknown>): ProposalBaseInputSnapshotV2 {
  const envelope = object(row.input_snapshot_json);
  if (Object.keys(envelope).sort().join("\0") !== ["baseInput", "replayFingerprint", "resumeInput"].sort().join("\0")) {
    throw new Error("content_proposal_input_envelope_invalid");
  }
  return parseProposalBaseInputSnapshotV2(envelope.baseInput);
}

function validatedClaimBoundary(row: Record<string, unknown>): {
  request: ContentProposalRequestV2;
  baseInput: ProposalBaseInputSnapshotV2;
  contract: ContentProposalJobContractRecord;
} {
  const request = parseContentProposalRequestV2(row.request_json);
  const baseInput = frozenBaseInput(row);
  const contract = contractFromRow(row);
  if (proposalSha256(request) !== contract.requestSha256
    || proposalSha256(baseInput) !== contract.baseInputSha256
    || request.contractVersion !== contract.requestContractVersion
    || baseInput.contractVersion !== contract.baseInputContractVersion
    || request.purpose !== baseInput.outputSettings.purpose
    || request.outputFormat !== baseInput.outputSettings.outputFormat
    || request.channelTargets[0] !== baseInput.outputSettings.channelTargets[0]
    || row.purpose !== request.purpose) {
    throw new Error("content_proposal_claim_contract_mismatch");
  }
  return { request, baseInput, contract };
}

function validateResearchEvidence(value: unknown): ResearchEvidenceSnapshotV1 {
  let evidence: ResearchEvidenceSnapshotV1;
  try { evidence = parseResearchEvidenceSnapshotV1(value); }
  catch { throw new Error("content_proposal_research_invalid"); }
  if (evidence.queries.length > 4 || evidence.items.some((item) => {
    try {
      if (new URL(item.url).protocol !== "https:") return true;
    } catch {
      return true;
    }
    const observedFields = {
      title: item.title,
      url: item.url,
      publisher: item.publisher,
      publishedAt: item.publishedAt,
      claimSummary: item.claimSummary,
    };
    const expectedHash = createHash("sha256")
      .update(JSON.stringify(observedFields))
      .digest("hex");
    return item.contentHash !== expectedHash;
  })) throw new Error("content_proposal_research_invalid");
  return evidence;
}

function composeProposalInput(
  base: ProposalBaseInputSnapshotV2,
  evidence: ResearchEvidenceSnapshotV1,
): ProposalInputSnapshotV2 {
  const { contractVersion: _contractVersion, ...fields } = base;
  return parseProposalInputSnapshotV2({
    ...fields,
    contractVersion: "proposal-input.v2",
    researchEvidence: evidence,
  });
}

function assertProposalSetMatchesClaim(
  proposalSet: ContentProposalSetV2,
  input: ProposalInputSnapshotV2,
  request: ContentProposalRequestV2,
  purpose: unknown,
): void {
  const settings = input.outputSettings;
  if (purpose !== settings.purpose
    || request.purpose !== settings.purpose
    || request.outputFormat !== settings.outputFormat
    || request.channelTargets[0] !== settings.channelTargets[0]) {
    throw new Error("content_proposal_batch_mismatch");
  }
  const evidenceIds = new Set(input.researchEvidence.items.map((item) => item.id));
  const referenceIds = new Set(input.references.map((reference) => reference.referenceItemId));
  for (const proposal of proposalSet.proposals) {
    if (proposal.outputFormat !== settings.outputFormat
      || proposal.channelTargets.length !== 1
      || proposal.channelTargets[0] !== settings.channelTargets[0]
      || proposal.purposeDetails.kind !== settings.purpose
      || proposal.evidenceIds.some((id) => !evidenceIds.has(id))
      || proposal.referenceIds.some((id) => !referenceIds.has(id))
      || (settings.purpose === "marketing"
        && (input.product === null
          || proposal.purposeDetails.kind !== "marketing"
          || proposal.purposeDetails.productId !== input.product.id))
      || (settings.purpose === "informational"
        && (input.product !== null || proposal.purposeDetails.kind !== "informational"))) {
      throw new Error("content_proposal_batch_mismatch");
    }
  }
}

function contentProposalRepositoryError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (/^proposal_(?:research|model).*lease_mismatch$/.test(message)) {
    return new Error("content_proposal_job_lease_invalid");
  }
  if (message === "proposal_invocation_already_started") {
    return new Error("content_proposal_invocation_already_started");
  }
  if (message.endsWith("_replay_conflict")) {
    return new Error("content_proposal_event_replay_conflict");
  }
  return error;
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw contentProposalRepositoryError(error);
  } finally {
    client.release();
  }
}

const claimColumns = `
  job.*,batch.purpose,batch.request_json,batch.input_snapshot_json,
  contract.id contract_id,contract.request_contract_version,contract.base_input_contract_version,
  contract.research_contract_version,contract.proposal_contract_version,
  contract.proposal_prompt_version,contract.proposal_output_schema_sha256,
  contract.proposal_model_id,contract.command_descriptor_sha256,contract.request_sha256,
  contract.base_input_sha256,contract.contract_source_sha256,contract.catalog_sha256,
  contract.enqueue_contract_sha256,
  composition.id composition_id,composition.research_evidence_set_sha256,
  composition.composed_input_json,composition.composed_input_sha256,
  composition.final_invocation_aggregate_sha256`;

async function reclaimExpiredResearchAttempts(client: PoolClient): Promise<void> {
  const candidates = await client.query(
    `select attempt.id
       from ai_content_proposal_research_attempts attempt
       join ai_content_proposal_jobs job on job.id=attempt.job_id
      where job.status='processing' and job.active_stage='research'
        and job.lease_expires_at<=clock_timestamp()
        and attempt.worker_id=job.lease_owner
        and attempt.lease_token_sha256=encode(digest(job.lease_token::text,'sha256'),'hex')
        and exists(
          select 1 from ai_content_proposal_research_attempt_events event
           where event.research_attempt_id=attempt.id and event.event_type='research_started'
        )
        and not exists(
          select 1 from ai_content_proposal_research_attempt_events event
           where event.research_attempt_id=attempt.id and event.event_type<>'research_started'
        )
      order by job.lease_expires_at,attempt.id`,
  );
  for (const candidate of candidates.rows) {
    await client.query(
      "select id from ai_content_proposal_research_attempts where id=$1 for update",
      [candidate.id],
    );
    const current = await client.query(
      `select job.lease_token,job.max_attempts,attempt.attempt_number
         from ai_content_proposal_research_attempts attempt
         join ai_content_proposal_jobs job on job.id=attempt.job_id
        where attempt.id=$1 and job.status='processing' and job.active_stage='research'
          and job.lease_expires_at<=clock_timestamp()
          and attempt.worker_id=job.lease_owner
          and attempt.lease_token_sha256=encode(digest(job.lease_token::text,'sha256'),'hex')
          and exists(
            select 1 from ai_content_proposal_research_attempt_events event
             where event.research_attempt_id=attempt.id and event.event_type='research_started'
          )
          and not exists(
            select 1 from ai_content_proposal_research_attempt_events event
             where event.research_attempt_id=attempt.id and event.event_type<>'research_started'
          )
        for update of job`,
      [candidate.id],
    );
    const row = current.rows[0];
    if (!row) continue;
    const failure = canonicalProposalJson({
      errorCode: "research_lease_expired",
      errorMessage: "research lease expired before evidence commit",
      retryable: Number(row.attempt_number) < Number(row.max_attempts),
    });
    await client.query(
      `select append_ai_content_proposal_research_attempt_event(
         $1,$2,2,'attempt_failed',null,$3::jsonb,
         encode(digest(($3::jsonb)::text,'sha256'),'hex'),null) event_sha256`,
      [candidate.id, row.lease_token, failure],
    );
  }
}

async function reclaimExpiredModelAttempts(client: PoolClient): Promise<void> {
  const candidates = await client.query(
    `select attempt.id
       from ai_content_proposal_model_attempts attempt
       join ai_content_proposal_jobs job on job.id=attempt.job_id
      where job.status='processing' and job.active_stage='model'
        and job.lease_expires_at<=clock_timestamp()
        and attempt.worker_id=job.lease_owner
        and attempt.lease_token_sha256=encode(digest(job.lease_token::text,'sha256'),'hex')
      order by job.lease_expires_at,attempt.id`,
  );
  for (const candidate of candidates.rows) {
    await client.query(
      "select id from ai_content_proposal_model_attempts where id=$1 for update",
      [candidate.id],
    );
    const current = await client.query(
      `select job.id job_id,job.lease_token,job.max_attempts,
              attempt.id attempt_id,attempt.attempt_number,attempt.worker_id,
              previous.event_sequence,previous.event_type,previous.invocation_ordinal,
              previous.transcript_sha256,previous.output_sha256,
              previous.parser_sha256,previous.parser_valid
         from ai_content_proposal_model_attempts attempt
         join ai_content_proposal_jobs job on job.id=attempt.job_id
         left join lateral (
           select event.* from ai_content_proposal_attempt_events event
            where event.model_attempt_id=attempt.id
            order by event.event_sequence desc limit 1
         ) previous on true
        where attempt.id=$1 and job.status='processing' and job.active_stage='model'
          and job.lease_expires_at<=clock_timestamp()
          and attempt.worker_id=job.lease_owner
          and attempt.lease_token_sha256=encode(digest(job.lease_token::text,'sha256'),'hex')
        for update of job`,
      [candidate.id],
    );
    const row = current.rows[0];
    if (!row) continue;
    if (row.event_sequence == null) {
      await client.query(
        `select append_ai_content_proposal_attempt_event(
           attempt.id,$2,1,0,'pre_invocation_failed',attempt.aggregate_contract_sha256,
           attempt.model_sha256,attempt.command_descriptor_sha256,attempt.composed_input_sha256,
           'model_lease_expired','model lease expired before invocation start',null,$3) event_sha256
           from ai_content_proposal_model_attempts attempt where attempt.id=$1`,
        [candidate.id, row.lease_token, Number(row.attempt_number) < Number(row.max_attempts)],
      );
      continue;
    }
    if (row.event_type === "invocation_completed" && row.parser_valid === false) {
      await client.query(
        `select append_ai_content_proposal_attempt_event(
           attempt.id,$2,$3,$4,'attempt_failed',attempt.aggregate_contract_sha256,
           attempt.model_sha256,attempt.command_descriptor_sha256,attempt.composed_input_sha256,
           $5,$6,$7,false) event_sha256
           from ai_content_proposal_model_attempts attempt where attempt.id=$1`,
        [
          candidate.id, row.lease_token, Number(row.event_sequence) + 1,
          Number(row.invocation_ordinal), row.transcript_sha256,
          row.output_sha256, row.parser_sha256,
        ],
      );
    }
  }
}

export function createContentProposalJobsRepository(pool: Pool): ContentProposalJobsRepository {
  return {
    async claimContentProposalJob(input) {
      return transaction(pool, async (client) => {
        await reclaimExpiredResearchAttempts(client);
        await reclaimExpiredModelAttempts(client);
        const expired = await client.query(
          `update ai_content_proposal_jobs
              set status='queued',active_stage=null,available_at=clock_timestamp(),
                  lease_owner=null,lease_token=null,lease_started_at=null,lease_expires_at=null,
                  updated_at=now()
            where status='processing' and lease_expires_at<=clock_timestamp()
            returning id,batch_id,status,error_code,error_message`,
        );
        const terminalExpired = expired.rows.filter((row) => row.status === "manual_review_required");
        for (const row of terminalExpired) {
          await client.query(
            `update ai_content_proposal_batches
                set status='failed',error_code=$2,error_message=$3,updated_at=now()
              where id=$1`,
            [row.batch_id, row.error_code, row.error_message],
          );
        }

        const selected = await client.query(
          `select ${claimColumns}
             from ai_content_proposal_jobs job
             join ai_content_proposal_batches batch
               on batch.id=job.batch_id and batch.workspace_id=job.workspace_id and batch.brand_id=job.brand_id
             join ai_content_proposal_job_contracts contract
               on contract.job_id=job.id and contract.batch_id=job.batch_id
              and contract.workspace_id=job.workspace_id and contract.brand_id=job.brand_id
             left join ai_content_proposal_compositions composition
               on composition.job_id=job.id and composition.batch_id=job.batch_id
              and composition.workspace_id=job.workspace_id and composition.brand_id=job.brand_id
            where job.status='queued' and job.available_at<=clock_timestamp()
              and (composition.id is null or job.attempt_count<job.max_attempts)
            order by job.available_at,job.created_at,job.id
            for update of job,batch skip locked limit 1`,
        );
        if (!selected.rowCount) return null;
        const initial = selected.rows[0] as Record<string, unknown>;
        const boundary = validatedClaimBoundary(initial);
        const stage: ContentProposalClaimStage = initial.composition_id
          ? "composition_ready"
          : "research_required";
        const activeStage = stage === "composition_ready" ? "model" : "research";
        const leaseToken = randomUUID();
        const claimed = await client.query(
          `update ai_content_proposal_jobs
              set status='processing',active_stage=$2,
                  attempt_count=attempt_count+case when $2='model' then 1 else 0 end,
                  lease_owner=$3,lease_token=$4,lease_started_at=clock_timestamp(),
                  lease_expires_at=clock_timestamp()+(least($5::integer,300)::text||' seconds')::interval,
                  updated_at=now()
            where id=$1
            returning *`,
          [initial.id, activeStage, input.workerId, leaseToken, input.leaseSeconds],
        );
        const job = claimed.rows[0] as Record<string, unknown>;
        await client.query(
          `update ai_content_proposal_batches set status='building',error_code=null,error_message=null,updated_at=now()
            where id=$1 and workspace_id=$2 and brand_id=$3`,
          [job.batch_id, job.workspace_id, job.brand_id],
        );
        const common = {
          id: String(job.id), workspaceId: String(job.workspace_id), brandId: String(job.brand_id),
          batchId: String(job.batch_id), status: "processing" as const, stage,
          attemptCount: Number(job.attempt_count), maxAttempts: Number(job.max_attempts),
          workerId: String(job.lease_owner), leaseToken: String(job.lease_token),
          leaseExpiresAt: iso(job.lease_expires_at), availableAt: iso(job.available_at),
          request: boundary.request, contract: boundary.contract,
        };

        if (stage === "research_required") {
          const attempt = await client.query(
            `insert into ai_content_proposal_research_attempts(
               job_id,contract_id,workspace_id,brand_id,attempt_number,worker_id,
               lease_token_sha256,enqueue_contract_sha256,base_input_sha256,claimed_at,lease_expires_at
             ) select job.id,$2,job.workspace_id,job.brand_id,
                    coalesce((select max(prior.attempt_number) from ai_content_proposal_research_attempts prior where prior.job_id=job.id),0)+1,
                    job.lease_owner,encode(digest(job.lease_token::text,'sha256'),'hex'),$3,$4,
                    job.lease_started_at,job.lease_expires_at
                 from ai_content_proposal_jobs job where job.id=$1
             returning id,attempt_number`,
            [job.id, boundary.contract.id, boundary.contract.enqueueContractSha256, boundary.contract.baseInputSha256],
          );
          const row = attempt.rows[0] as Record<string, unknown>;
          await client.query(
            `select append_ai_content_proposal_research_attempt_event(
               $1,$2,1,'research_started',null,null,null,null)`,
            [row.id, leaseToken],
          );
          return {
            ...common, stage: "research_required", researchAttemptId: String(row.id),
            researchAttemptNumber: Number(row.attempt_number), baseInput: boundary.baseInput,
          };
        }

        const composedInput = parseProposalInputSnapshotV2(initial.composed_input_json);
        const modelSha256 = proposalSha256({ modelId: boundary.contract.modelId });
        const attempt = await client.query(
          `insert into ai_content_proposal_model_attempts(
             job_id,contract_id,composition_id,workspace_id,brand_id,attempt_number,
             worker_id,lease_token_sha256,aggregate_contract_sha256,model_id,model_sha256,
             command_descriptor_sha256,proposal_output_schema_sha256,composed_input_sha256,claimed_at
           ) select job.id,$2,$3,job.workspace_id,job.brand_id,
                    coalesce((select max(prior.attempt_number) from ai_content_proposal_model_attempts prior where prior.job_id=job.id),0)+1,
                    job.lease_owner,encode(digest(job.lease_token::text,'sha256'),'hex'),$4,$5,$6,$7,$8,$9,
                    job.lease_started_at
               from ai_content_proposal_jobs job where job.id=$1
           returning id,attempt_number`,
          [
            job.id, boundary.contract.id, initial.composition_id,
            initial.final_invocation_aggregate_sha256, boundary.contract.modelId, modelSha256,
            boundary.contract.commandDescriptorSha256, boundary.contract.proposalOutputSchemaSha256,
            initial.composed_input_sha256,
          ],
        );
        const row = attempt.rows[0] as Record<string, unknown>;
        return {
          ...common, stage: "composition_ready", modelAttemptId: String(row.id),
          modelAttemptNumber: Number(row.attempt_number), compositionId: String(initial.composition_id),
          composedInput, evidenceSetSha256: String(initial.research_evidence_set_sha256),
          composedInputSha256: String(initial.composed_input_sha256),
          finalInvocationAggregateSha256: String(initial.final_invocation_aggregate_sha256),
          modelSha256,
        };
      });
    },

    async heartbeatContentProposalJob(input) {
      const activeStage = input.stage === "research_required" ? "research" : "model";
      const attemptTable = input.stage === "research_required"
        ? "ai_content_proposal_research_attempts"
        : "ai_content_proposal_model_attempts";
      const result = await pool.query(
        `update ai_content_proposal_jobs job
            set lease_expires_at=least(
                  clock_timestamp()+(least($6::integer,300)::text||' seconds')::interval,
                  job.lease_started_at+interval '15 minutes'
                ),updated_at=now()
          where job.id=$1 and job.status='processing' and job.active_stage=$5
            and job.lease_owner=$2 and job.lease_token=$3 and job.lease_expires_at>clock_timestamp()
            and exists(select 1 from ${attemptTable} attempt where attempt.id=$4 and attempt.job_id=job.id)
          returning job.id`,
        [input.jobId, input.workerId, input.leaseToken, input.attemptId, activeStage, input.leaseSeconds],
      );
      return Boolean(result.rowCount);
    },

    async completeContentProposalResearch(input) {
      const evidence = validateResearchEvidence(input.evidence);
      return transaction(pool, async (client) => {
        const result = await client.query(
          `select ${claimColumns},attempt.id research_attempt_id,attempt.attempt_number,
                  attempt.worker_id research_worker_id,
                  attempt.lease_token_sha256=encode(digest($3::uuid::text,'sha256'),'hex') token_matches,
                  research.evidence_json
             from ai_content_proposal_jobs job
             join ai_content_proposal_batches batch
               on batch.id=job.batch_id and batch.workspace_id=job.workspace_id and batch.brand_id=job.brand_id
             join ai_content_proposal_job_contracts contract on contract.job_id=job.id
             join ai_content_proposal_research_attempts attempt
               on attempt.id=$2 and attempt.job_id=job.id
             left join ai_content_proposal_compositions composition on composition.job_id=job.id
             left join ai_content_proposal_research_snapshots research on research.batch_id=job.batch_id
            where job.id=$1 for update of job,batch,attempt`,
          [input.jobId, input.researchAttemptId, input.leaseToken],
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (!row) throw new Error("content_proposal_job_not_found");
        const boundary = validatedClaimBoundary(row);
        if (row.research_worker_id !== input.workerId || row.token_matches !== true) {
          throw new Error("content_proposal_job_lease_invalid");
        }
        if (row.composition_id) {
          if (!isDeepStrictEqual(row.evidence_json, evidence)) {
            throw new Error("content_proposal_research_snapshot_conflict");
          }
          return {
            jobId: String(row.id), batchId: String(row.batch_id), status: "queued" as const,
            compositionId: String(row.composition_id),
            composedInput: parseProposalInputSnapshotV2(row.composed_input_json),
            evidenceSetSha256: String(row.research_evidence_set_sha256),
            composedInputSha256: String(row.composed_input_sha256),
            finalInvocationAggregateSha256: String(row.final_invocation_aggregate_sha256),
          };
        }
        if (row.status !== "processing" || row.active_stage !== "research"
          || row.lease_owner !== input.workerId || String(row.lease_token) !== input.leaseToken
          || new Date(String(row.lease_expires_at)).getTime() <= Date.now()) {
          throw new Error("content_proposal_job_lease_invalid");
        }
        if (boundary.request.purpose === "informational"
          && (evidence.decision !== "searched" || evidence.items.length === 0)) {
          throw new Error("content_proposal_research_invalid");
        }
        const composedInput = composeProposalInput(boundary.baseInput, evidence);
        const evidenceSetJson = canonicalProposalJson([evidence]);
        const composedInputJson = canonicalProposalJson(composedInput);
        const hashes = await client.query(
          `select encode(digest(($1::jsonb)::text,'sha256'),'hex') evidence_sha256,
                  encode(digest(($2::jsonb)::text,'sha256'),'hex') composed_sha256`,
          [evidenceSetJson, composedInputJson],
        );
        const evidenceSetSha256 = String(hashes.rows[0]?.evidence_sha256);
        const composedInputSha256 = String(hashes.rows[0]?.composed_sha256);
        const finalInvocationAggregateSha256 = proposalSha256({
          enqueueContractSha256: boundary.contract.enqueueContractSha256,
          modelId: boundary.contract.modelId,
          commandDescriptorSha256: boundary.contract.commandDescriptorSha256,
          proposalOutputSchemaSha256: boundary.contract.proposalOutputSchemaSha256,
          evidenceSetSha256,
          composedInputSha256,
        });
        const insertedResearch = await client.query(
          `insert into ai_content_proposal_research_snapshots(workspace_id,brand_id,batch_id,evidence_json)
           values($1,$2,$3,$4::jsonb) on conflict(batch_id) do nothing returning id`,
          [row.workspace_id, row.brand_id, row.batch_id, canonicalProposalJson(evidence)],
        );
        if (!insertedResearch.rowCount) {
          const frozen = await client.query(
            "select evidence_json from ai_content_proposal_research_snapshots where batch_id=$1",
            [row.batch_id],
          );
          if (!isDeepStrictEqual(frozen.rows[0]?.evidence_json, evidence)) {
            throw new Error("content_proposal_research_snapshot_conflict");
          }
        }
        const sealed = await client.query(
          `select (complete_ai_content_proposal_research(
             $1,$2,$3::jsonb,$4,$5::jsonb,$6,$7)).*`,
          [
            input.researchAttemptId, input.leaseToken, evidenceSetJson, evidenceSetSha256,
            composedInputJson, composedInputSha256, finalInvocationAggregateSha256,
          ],
        );
        const composition = sealed.rows[0] as Record<string, unknown>;
        return {
          jobId: String(row.id), batchId: String(row.batch_id), status: "queued" as const,
          compositionId: String(composition.id), composedInput,
          evidenceSetSha256, composedInputSha256, finalInvocationAggregateSha256,
        };
      });
    },

    async startContentProposalInvocation(input) {
      const sequence = input.invocationOrdinal === 1 ? 1 : 3;
      try {
        const result = await pool.query(
          `select append_ai_content_proposal_attempt_event(
             attempt.id,$3,$4,$5,'invocation_started',attempt.aggregate_contract_sha256,
             attempt.model_sha256,attempt.command_descriptor_sha256,attempt.composed_input_sha256,
             null,null,null,null) event_sha256
             from ai_content_proposal_model_attempts attempt
            where attempt.id=$2 and attempt.job_id=$1 and attempt.worker_id=$6`,
          [input.jobId, input.modelAttemptId, input.leaseToken, sequence, input.invocationOrdinal, input.workerId],
        );
        if (!result.rowCount) throw new Error("content_proposal_job_not_found");
        return { eventSha256: String(result.rows[0]?.event_sha256) };
      } catch (error) {
        throw contentProposalRepositoryError(error);
      }
    },

    async recordContentProposalInvocationTerminal(input) {
      return transaction(pool, async (client) => {
        const sequence = input.invocationOrdinal === 1 ? 2 : 4;
        const result = await client.query(
          `select append_ai_content_proposal_attempt_event(
             attempt.id,$3,$4,$5,$6,attempt.aggregate_contract_sha256,
             attempt.model_sha256,attempt.command_descriptor_sha256,attempt.composed_input_sha256,
             $7,$8,$9,$10) event_sha256,attempt.job_id
             from ai_content_proposal_model_attempts attempt
            where attempt.id=$2 and attempt.job_id=$1 and attempt.worker_id=$11`,
          [
            input.jobId, input.modelAttemptId, input.leaseToken, sequence, input.invocationOrdinal,
            input.eventType, input.transcriptSha256, input.outputSha256, input.parserSha256,
            input.parserValid, input.workerId,
          ],
        );
        if (!result.rowCount) throw new Error("content_proposal_job_not_found");
        const terminalizesAttempt = input.eventType === "invocation_failed"
          || (input.invocationOrdinal === 2
            && input.eventType === "invocation_completed"
            && input.parserValid === false);
        if (terminalizesAttempt) {
          await client.query(
            `select append_ai_content_proposal_attempt_event(
               attempt.id,$3,$4,$5,'attempt_failed',attempt.aggregate_contract_sha256,
               attempt.model_sha256,attempt.command_descriptor_sha256,attempt.composed_input_sha256,
               $6,$7,$8,$9)
               from ai_content_proposal_model_attempts attempt
              where attempt.id=$2 and attempt.job_id=$1`,
            [
              input.jobId, input.modelAttemptId, input.leaseToken, sequence + 1,
              input.invocationOrdinal, input.transcriptSha256, input.outputSha256,
              input.parserSha256, input.parserValid,
            ],
          );
        }
        const status = await client.query("select status from ai_content_proposal_jobs where id=$1", [input.jobId]);
        const projectedStatus = status.rows[0]?.status as "processing" | "queued" | "failed" | "manual_review_required";
        if (projectedStatus === "failed" || projectedStatus === "manual_review_required") {
          await client.query(
            `update ai_content_proposal_batches batch
                set status='failed',error_code=job.error_code,error_message=job.error_message,updated_at=now()
               from ai_content_proposal_jobs job
              where job.id=$1 and batch.id=job.batch_id
                and batch.workspace_id=job.workspace_id and batch.brand_id=job.brand_id`,
            [input.jobId],
          );
        }
        return {
          eventSha256: String(result.rows[0]?.event_sha256),
          status: projectedStatus,
        };
      });
    },

    async completeContentProposalJob(input) {
      let proposalSet: ContentProposalSetV2;
      try { proposalSet = parseContentProposalSetV2(input.proposalSet); }
      catch { throw new Error("content_proposal_result_invalid"); }
      return transaction(pool, async (client) => {
        const result = await client.query(
          `select ${claimColumns},attempt.id model_attempt_id,attempt.worker_id model_worker_id,
                  terminal.event_sequence terminal_event_sequence,
                  terminal.invocation_ordinal terminal_invocation_ordinal,
                  terminal.transcript_sha256 terminal_transcript_sha256,
                  terminal.output_sha256 terminal_output_sha256,
                  terminal.parser_sha256 terminal_parser_sha256,
                  terminal.parser_valid terminal_parser_valid,
                  terminal.event_sha256 terminal_event_sha256,
                  succeeded.id succeeded_event_id,
                  succeeded.event_sha256 succeeded_event_sha256
             from ai_content_proposal_jobs job
             join ai_content_proposal_batches batch on batch.id=job.batch_id
             join ai_content_proposal_job_contracts contract on contract.job_id=job.id
             join ai_content_proposal_compositions composition on composition.job_id=job.id
             join ai_content_proposal_model_attempts attempt
               on attempt.id=$2 and attempt.job_id=job.id and attempt.composition_id=composition.id
             left join lateral (
               select event.* from ai_content_proposal_attempt_events event
                where event.model_attempt_id=attempt.id
                  and event.event_type='invocation_completed'
                  and event.invocation_ordinal=$3
                limit 1
             ) terminal on true
             left join ai_content_proposal_attempt_events succeeded
               on succeeded.model_attempt_id=attempt.id and succeeded.event_type='attempt_succeeded'
            where job.id=$1 for update of job,batch,attempt`,
          [input.jobId, input.modelAttemptId, input.invocationOrdinal],
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (!row) throw new Error("content_proposal_job_not_found");
        const boundary = validatedClaimBoundary(row);
        const composedInput = parseProposalInputSnapshotV2(row.composed_input_json);
        assertProposalSetMatchesClaim(proposalSet, composedInput, boundary.request, row.purpose);
        if (row.status === "completed") {
          if (row.completion_lease_owner !== input.workerId
            || String(row.completion_lease_token) !== input.leaseToken
            || !row.succeeded_event_id
            || row.terminal_parser_valid !== true
            || row.terminal_transcript_sha256 !== input.transcriptSha256
            || row.terminal_output_sha256 !== input.outputSha256
            || row.terminal_parser_sha256 !== input.parserSha256) {
            throw new Error("content_proposal_completion_conflict");
          }
          const stored = await client.query(
            "select position,proposal_json from ai_content_proposals where batch_id=$1 order by position",
            [row.batch_id],
          );
          const replay = parseContentProposalSetV2({
            contractVersion: "content-proposal.v2",
            proposals: stored.rows.map((item) => item.proposal_json),
          });
          if (!isDeepStrictEqual(replay, proposalSet)) throw new Error("content_proposal_completion_conflict");
          return {
            jobId: String(row.id), batchId: String(row.batch_id), status: "completed" as const,
            invocationEventSha256: String(row.terminal_event_sha256),
            attemptEventSha256: String(row.succeeded_event_sha256),
          };
        }
        if (row.status !== "processing" || row.active_stage !== "model"
          || row.lease_owner !== input.workerId || String(row.lease_token) !== input.leaseToken
          || row.model_worker_id !== input.workerId || row.terminal_event_sequence) {
          throw new Error("content_proposal_job_lease_invalid");
        }
        const terminalSequence = input.invocationOrdinal === 1 ? 2 : 4;
        const invocation = await client.query(
          `select append_ai_content_proposal_attempt_event(
             attempt.id,$3,$4,$5,'invocation_completed',attempt.aggregate_contract_sha256,
             attempt.model_sha256,attempt.command_descriptor_sha256,attempt.composed_input_sha256,
             $6,$7,$8,true) event_sha256
             from ai_content_proposal_model_attempts attempt
            where attempt.id=$2 and attempt.job_id=$1 and attempt.worker_id=$9`,
          [
            input.jobId, input.modelAttemptId, input.leaseToken, terminalSequence,
            input.invocationOrdinal, input.transcriptSha256, input.outputSha256,
            input.parserSha256, input.workerId,
          ],
        );
        if (!invocation.rowCount) throw new Error("content_proposal_job_lease_invalid");
        const inserted = await client.query(
          `insert into ai_content_proposals(workspace_id,brand_id,batch_id,position,proposal_json)
           select job.workspace_id,job.brand_id,job.batch_id,item.ordinality::integer,item.value
             from ai_content_proposal_jobs job
             cross join jsonb_array_elements($2::jsonb) with ordinality item(value,ordinality)
            where job.id=$1 on conflict(batch_id,position) do nothing`,
          [input.jobId, canonicalProposalJson(proposalSet.proposals)],
        );
        if (inserted.rowCount !== 3) throw new Error("content_proposal_completion_conflict");
        await client.query(
          `update ai_content_proposal_jobs set completion_lease_owner=$2,completion_lease_token=$3 where id=$1`,
          [input.jobId, input.workerId, input.leaseToken],
        );
        const succeeded = await client.query(
          `select append_ai_content_proposal_attempt_event(
             attempt.id,$3,$4,$5,'attempt_succeeded',attempt.aggregate_contract_sha256,
             attempt.model_sha256,attempt.command_descriptor_sha256,attempt.composed_input_sha256,
             $6,$7,$8,true) event_sha256
             from ai_content_proposal_model_attempts attempt where attempt.id=$2 and attempt.job_id=$1`,
          [
            input.jobId, input.modelAttemptId, input.leaseToken,
            terminalSequence + 1, input.invocationOrdinal,
            input.transcriptSha256, input.outputSha256, input.parserSha256,
          ],
        );
        await client.query(
          `update ai_content_proposal_batches set status='ready',error_code=null,error_message=null,updated_at=now()
            where id=$1 and workspace_id=$2 and brand_id=$3`,
          [row.batch_id, row.workspace_id, row.brand_id],
        );
        return {
          jobId: String(row.id), batchId: String(row.batch_id), status: "completed" as const,
          invocationEventSha256: String(invocation.rows[0]?.event_sha256),
          attemptEventSha256: String(succeeded.rows[0]?.event_sha256),
        };
      });
    },

    async failContentProposalJob(input) {
      return transaction(pool, async (client) => {
        const activeStage = input.stage === "research_required" ? "research" : "model";
        const attemptTable = input.stage === "research_required"
          ? "ai_content_proposal_research_attempts"
          : "ai_content_proposal_model_attempts";
        const result = await client.query(
          `select job.*,attempt.id attempt_id,attempt.attempt_number,
                  attempt.worker_id attempt_worker_id,
                  attempt.lease_token_sha256=encode(digest($3::uuid::text,'sha256'),'hex') token_matches,
                  ${input.stage === "composition_ready" ? `exists(
                    select 1 from ai_content_proposal_attempt_events event
                     where event.model_attempt_id=attempt.id
                  )` : "false"} model_event_exists,
                  ${input.stage === "composition_ready" ? `exists(
                    select 1 from ai_content_proposal_attempt_events event
                     where event.model_attempt_id=attempt.id and event.event_type='pre_invocation_failed'
                  )` : `exists(
                    select 1 from ai_content_proposal_research_attempt_events event
                     where event.research_attempt_id=attempt.id and event.event_type='attempt_failed'
                  )`} failure_event_exists,
                  ${input.stage === "composition_ready" ? `(
                    select event.terminal from ai_content_proposal_attempt_events event
                     where event.model_attempt_id=attempt.id and event.event_type='pre_invocation_failed'
                     limit 1
                  )` : `(
                    select event.terminal from ai_content_proposal_research_attempt_events event
                     where event.research_attempt_id=attempt.id and event.event_type='attempt_failed'
                     limit 1
                  )`} failure_terminal
             from ai_content_proposal_jobs job
             join ${attemptTable} attempt on attempt.id=$2 and attempt.job_id=job.id
            where job.id=$1 for update of job`,
          [input.jobId, input.attemptId, input.leaseToken],
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (!row) throw new Error("content_proposal_job_not_found");
        if (row.attempt_worker_id !== input.workerId || row.token_matches !== true) {
          throw new Error("content_proposal_job_lease_invalid");
        }
        if (row.failure_event_exists !== true
          && (row.status !== "processing" || row.active_stage !== activeStage
            || row.lease_owner !== input.workerId || String(row.lease_token) !== input.leaseToken
            || new Date(String(row.lease_expires_at)).getTime() <= Date.now())) {
          throw new Error("content_proposal_job_lease_invalid");
        }
        if (input.stage === "composition_ready" && row.model_event_exists === true
          && row.failure_event_exists !== true) {
          throw new Error("content_proposal_invocation_already_started");
        }

        let expectedStatus: "queued" | "failed";
        if (input.stage === "research_required") {
          const failureEnvelope = canonicalProposalJson({
            errorCode: input.errorCode,
            errorMessage: input.errorMessage,
            retryable: input.retryable,
          });
          await client.query(
            `select append_ai_content_proposal_research_attempt_event(
               $1,$2,2,'attempt_failed',null,$3::jsonb,
               encode(digest(($3::jsonb)::text,'sha256'),'hex'),null) event_sha256`,
            [input.attemptId, input.leaseToken, failureEnvelope],
          );
          expectedStatus = row.failure_event_exists === true
            ? row.failure_terminal === true ? "failed" : "queued"
            : input.retryable ? "queued" : "failed";
        } else {
          const appended = await client.query(
            `select append_ai_content_proposal_attempt_event(
               attempt.id,$3,1,$4,'pre_invocation_failed',attempt.aggregate_contract_sha256,
               attempt.model_sha256,attempt.command_descriptor_sha256,attempt.composed_input_sha256,
               $5,$6,null,$7) event_sha256
               from ai_content_proposal_model_attempts attempt
              where attempt.id=$2 and attempt.job_id=$1 and attempt.worker_id=$8`,
            [
              input.jobId, input.attemptId, input.leaseToken, 0,
              input.errorCode, input.errorMessage, input.retryable, input.workerId,
            ],
          );
          if (!appended.rowCount) throw new Error("content_proposal_job_not_found");
          expectedStatus = row.failure_event_exists === true
            ? row.failure_terminal === true ? "failed" : "queued"
            : !input.retryable || Number(row.attempt_number) >= Number(row.max_attempts)
              ? "failed"
              : "queued";
        }
        const projected = await client.query(
          "select id,batch_id,status from ai_content_proposal_jobs where id=$1",
          [input.jobId],
        );
        const projectedStatus = projected.rows[0]?.status;
        if (row.failure_event_exists !== true && projectedStatus !== expectedStatus) {
          throw new Error("content_proposal_failure_projection_conflict");
        }
        return {
          id: String(row.id),
          batchId: String(row.batch_id),
          status: expectedStatus,
        };
      });
    },
  };
}
