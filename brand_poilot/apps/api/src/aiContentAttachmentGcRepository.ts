import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export interface AiContentGcDbBudget {
  remainingBudgetMs: number;
  statementTimeoutMs: number;
}

export interface AiContentAttachmentDeletionClaim {
  jobId: string;
  workspaceId: string;
  brandId: string;
  generationId: string;
  attachmentId: string | null;
  uploadSessionId: string | null;
  storageUrl: string | null;
  storagePath: string;
  reason: string;
  attemptCount: number;
  maxAttempts: number;
  leaseToken: string;
  leaseExpiresAt: string;
}

export interface AiContentAttachmentGcRepository {
  prepareAiContentAttachmentGc(input: {
    limit: number;
  } & AiContentGcDbBudget): Promise<{
    sessionsScanned: number;
    sessionsClaimed: number;
    sessionsConfirmed: number;
    sessionsExpired: number;
    jobsCreated: number;
    leasesReclaimed: number;
  }>;
  claimAiContentAttachmentDeletionJobs(input: {
    workerId: string;
    batchSize: number;
    leaseSeconds: number;
  } & AiContentGcDbBudget): Promise<AiContentAttachmentDeletionClaim[]>;
  beginAiContentAttachmentDeletionAttempt(input: {
    jobId: string;
    leaseToken: string;
  } & AiContentGcDbBudget): Promise<number | null>;
  releaseUnstartedAiContentAttachmentDeletions(input: {
    claims: Array<{ jobId: string; leaseToken: string }>;
  } & AiContentGcDbBudget): Promise<number>;
  completeAiContentAttachmentDeletion(input: {
    jobId: string;
    leaseToken: string;
    outcome: "deleted" | "not_found";
  } & AiContentGcDbBudget): Promise<boolean>;
  failAiContentAttachmentDeletion(input: {
    jobId: string;
    leaseToken: string;
    errorCategory: string;
    errorMessage: string;
    retryDelaySeconds: number | null;
  } & AiContentGcDbBudget): Promise<"retry" | "dead_letter" | "stale">;
  getAiContentAttachmentGcMetrics(input: AiContentGcDbBudget): Promise<{
    eligibleQueueDepth: number;
    oldestEligiblePendingAgeSeconds: number | null;
    heldJobCount: number;
    oldestHeldAgeSeconds: number | null;
    holdReasonCounts: Record<string, number>;
    attemptCountBuckets: Record<string, number>;
    deadLetterCount: number;
  }>;
}

interface Queryable {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: any[]; rowCount: number | null }>;
}

interface Options {
  createId?: () => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BATCH = 250;
const MAX_LEASE_SECONDS = 15 * 60;
const MAX_ERROR_CATEGORY = 64;
const MAX_ERROR_MESSAGE = 512;

function requireUuid(value: string, code: string) {
  if (!UUID.test(value)) throw new Error(code);
  return value.toLowerCase();
}

function positiveBoundedInteger(value: number, maximum: number, code: string) {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) throw new Error(code);
  return value;
}

function count(value: unknown) {
  return Number(value ?? 0);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function iso(value: unknown) {
  return new Date(value as string | Date).toISOString();
}

function asRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, Number(item)]),
  );
}

function connectionError(error: unknown) {
  return error instanceof Error ? error : new Error("ai_content_gc_database_connection_failed");
}

function validateBudget(input: AiContentGcDbBudget) {
  if (!Number.isFinite(input.remainingBudgetMs) || input.remainingBudgetMs <= 0) {
    throw new Error("ai_content_gc_budget_exhausted");
  }
  if (!Number.isFinite(input.statementTimeoutMs) || input.statementTimeoutMs <= 0) {
    throw new Error("ai_content_gc_statement_timeout_invalid");
  }
  return {
    remainingBudgetMs: Math.max(1, Math.floor(input.remainingBudgetMs)),
    statementTimeoutMs: Math.max(
      1,
      Math.floor(Math.min(input.statementTimeoutMs, input.remainingBudgetMs)),
    ),
  };
}

async function acquireWithinBudget(pool: Pool, remainingBudgetMs: number): Promise<PoolClient> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const connection = pool.connect().then((client) => {
    if (timedOut) {
      client.release();
      throw new Error("ai_content_gc_budget_exhausted");
    }
    return client;
  });
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("ai_content_gc_budget_exhausted"));
    }, remainingBudgetMs);
  });
  try {
    return await Promise.race([connection, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    // A late connection remains observed and releases itself in the continuation.
    void connection.catch(() => undefined);
  }
}

async function inBudgetTransaction<T>(
  pool: Pool,
  budgetInput: AiContentGcDbBudget,
  operation: (client: Queryable) => Promise<T>,
): Promise<T> {
  const budget = validateBudget(budgetInput);
  const startedAt = Date.now();
  const deadlineAt = startedAt + budget.remainingBudgetMs;
  const client = await acquireWithinBudget(pool, budget.remainingBudgetMs);
  let releaseError: Error | undefined;
  let began = false;
  let committing = false;
  try {
    if (Date.now() - startedAt >= budget.remainingBudgetMs) {
      throw new Error("ai_content_gc_budget_exhausted");
    }
    await client.query("BEGIN");
    began = true;
    const setDeadlineTimeout = async () => {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) throw new Error("ai_content_gc_budget_exhausted");
      const statementTimeout = Math.max(1, Math.min(budget.statementTimeoutMs, remaining));
      await client.query(`set local statement_timeout = '${Math.floor(statementTimeout)}ms'`);
      if (deadlineAt - Date.now() <= 0) throw new Error("ai_content_gc_budget_exhausted");
    };
    const budgetedClient: Queryable = {
      async query(sql: string, values?: unknown[]) {
        await setDeadlineTimeout();
        let result: Awaited<ReturnType<Queryable["query"]>>;
        try {
          result = await client.query(sql, values);
        } catch (error) {
          if (
            deadlineAt - Date.now() <= 0
            || (
              error
              && typeof error === "object"
              && "code" in error
              && error.code === "57014"
            )
          ) {
            throw new Error("ai_content_gc_budget_exhausted");
          }
          throw error;
        }
        if (deadlineAt - Date.now() <= 0) throw new Error("ai_content_gc_budget_exhausted");
        return result;
      },
    };
    const result = await operation(budgetedClient);
    await setDeadlineTimeout();
    committing = true;
    await client.query("COMMIT");
    committing = false;
    began = false;
    return result;
  } catch (error) {
    if (began) {
      if (committing) releaseError = connectionError(error);
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        releaseError = connectionError(rollbackError);
      }
    } else {
      releaseError = connectionError(error);
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

export function redactAiContentAttachmentGcError(value: unknown, maximum = MAX_ERROR_MESSAGE) {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  return raw
    .replace(/\b(https?:\/\/[^\s?]+)\?[^\s]*/gi, "$1")
    .replace(/([?&](?:token|nonce|signature|authorization|auth|key)=[^&\s]*)/gi, "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(authorization|token|nonce|signature|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, Math.max(1, maximum));
}

function normalizedUrl(sqlExpression: string) {
  return `split_part(${sqlExpression}, '?', 1)`;
}

/**
 * The predicate is intentionally shared by candidate selection, post-lock
 * revalidation, and metrics. A job may be selected only when every durable
 * consumer has released the exact (query-insensitive) attachment URL.
 */
function eligibilityPredicate(jobAlias: string) {
  const url = normalizedUrl(`${jobAlias}.storage_url`);
  return `
    ${jobAlias}.next_attempt_at <= now()
    and ${jobAlias}.attempt_count < ${jobAlias}.max_attempts
    and (
      ${jobAlias}.status in ('pending', 'failed')
      or (${jobAlias}.status = 'deleting' and ${jobAlias}.lease_expires_at <= now())
    )
    and not exists (
      select 1 from ai_content_attachment_upload_sessions live_session
       where live_session.id = ${jobAlias}.upload_session_id
         and live_session.token_expires_at > now()
    )
    and not exists (
      select 1 from ai_content_generations retained_generation
       where retained_generation.id = ${jobAlias}.generation_id
         and retained_generation.terminal_at is not null
         and retained_generation.retryable_until > now()
    )
    and not exists (
      select 1
        from ai_content_subject_analyses subject
        cross join lateral jsonb_path_query(subject.input_json, '$.**.storageUrl') subject_url(value)
       where subject.generation_id = ${jobAlias}.generation_id
         and subject.status in ('queued','extracting','researching','analyzing','generating_appeals')
         and ${normalizedUrl("trim(both '\"' from subject_url.value::text)")} = ${url}
    )
    and not exists (
      select 1
        from ai_content_generation_jobs generation_job
        cross join lateral jsonb_path_query(generation_job.payload_json, '$.**.storageUrl') job_url(value)
       where generation_job.generation_id = ${jobAlias}.generation_id
         and generation_job.status in ('queued','processing')
         and ${normalizedUrl("trim(both '\"' from job_url.value::text)")} = ${url}
    )
    and not exists (
      select 1
        from ai_content_generation_outputs completed_output
        left join lateral jsonb_array_elements(
          case when jsonb_typeof(completed_output.artifact_manifest_json->'assets') = 'array'
            then completed_output.artifact_manifest_json->'assets' else '[]'::jsonb end
        ) artifact_asset on true
       where completed_output.generation_id = ${jobAlias}.generation_id
         and completed_output.status = 'completed'
         and (
           ${normalizedUrl("completed_output.manifest_url")} = ${url}
           or ${normalizedUrl("artifact_asset->>'url'")} = ${url}
         )
    )
    and not exists (
      select 1
        from channel_outputs channel_output
        left join publish_queue publish_queue
          on publish_queue.channel_output_id = channel_output.id
        left join lateral jsonb_array_elements(
          case when jsonb_typeof(channel_output.output_json->'cards') = 'array'
            then channel_output.output_json->'cards' else '[]'::jsonb end
        ) channel_card on true
       where channel_output.ai_content_generation_output_id in (
         select linked_output.id
           from ai_content_generation_outputs linked_output
          where linked_output.generation_id = ${jobAlias}.generation_id
       )
         and (
           ${normalizedUrl("channel_card->>'url'")} = ${url}
           or ${normalizedUrl("channel_output.output_json#>>'{story,url}'")} = ${url}
         )
    )`;
}

function holdReason(jobAlias: string) {
  return `
    case
      when exists (
        select 1 from ai_content_attachment_upload_sessions s
         where s.id = ${jobAlias}.upload_session_id and s.token_expires_at > now()
      ) then 'live_upload_token'
      when exists (
        select 1 from ai_content_generations g
         where g.id = ${jobAlias}.generation_id and g.terminal_at is not null
           and g.retryable_until > now()
      ) then 'retry_retention'
      when exists (
        select 1 from ai_content_subject_analyses s
        cross join lateral jsonb_path_query(s.input_json, '$.**.storageUrl') u(value)
        where s.generation_id = ${jobAlias}.generation_id
          and s.status in ('queued','extracting','researching','analyzing','generating_appeals')
          and ${normalizedUrl("trim(both '\"' from u.value::text)")} = ${normalizedUrl(`${jobAlias}.storage_url`)}
      ) then 'subject_snapshot'
      when exists (
        select 1 from ai_content_generation_jobs j
        cross join lateral jsonb_path_query(j.payload_json, '$.**.storageUrl') u(value)
        where j.generation_id = ${jobAlias}.generation_id and j.status in ('queued','processing')
          and ${normalizedUrl("trim(both '\"' from u.value::text)")} = ${normalizedUrl(`${jobAlias}.storage_url`)}
      ) then 'generation_job_snapshot'
      when exists (
        select 1 from ai_content_generation_outputs o
        left join lateral jsonb_array_elements(
          case when jsonb_typeof(o.artifact_manifest_json->'assets') = 'array'
            then o.artifact_manifest_json->'assets' else '[]'::jsonb end
        ) a on true
        where o.generation_id = ${jobAlias}.generation_id and o.status = 'completed'
          and (${normalizedUrl("o.manifest_url")} = ${normalizedUrl(`${jobAlias}.storage_url`)}
            or ${normalizedUrl("a->>'url'")} = ${normalizedUrl(`${jobAlias}.storage_url`)})
      ) then 'artifact_reference'
      when exists (
        select 1 from channel_outputs co
        left join publish_queue pq on pq.channel_output_id = co.id
        left join lateral jsonb_array_elements(
          case when jsonb_typeof(co.output_json->'cards') = 'array'
            then co.output_json->'cards' else '[]'::jsonb end
        ) card on true
        where co.ai_content_generation_output_id in (
          select o.id from ai_content_generation_outputs o where o.generation_id = ${jobAlias}.generation_id
        )
          and (${normalizedUrl("card->>'url'")} = ${normalizedUrl(`${jobAlias}.storage_url`)}
            or ${normalizedUrl("co.output_json#>>'{story,url}'")} = ${normalizedUrl(`${jobAlias}.storage_url`)})
      ) then 'channel_publish_reference'
      else null
    end`;
}

function mapClaim(row: Record<string, unknown>): AiContentAttachmentDeletionClaim {
  return {
    jobId: String(row.id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    generationId: String(row.generation_id),
    attachmentId: row.attachment_id ? String(row.attachment_id) : null,
    uploadSessionId: row.upload_session_id ? String(row.upload_session_id) : null,
    storageUrl: row.storage_url ? String(row.storage_url) : null,
    storagePath: String(row.storage_path),
    reason: String(row.reason),
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    leaseToken: String(row.lease_token),
    leaseExpiresAt: iso(row.lease_expires_at),
  };
}

export function createAiContentAttachmentGcRepository(
  pool: Pool,
  options: Options = {},
): AiContentAttachmentGcRepository {
  const createId = options.createId ?? randomUUID;

  return {
    async prepareAiContentAttachmentGc(input) {
      const limit = positiveBoundedInteger(input.limit, MAX_BATCH, "ai_content_gc_limit_invalid");
      return inBudgetTransaction(pool, input, async (client) => {
        const result = await client.query(
          `with expired_sessions as materialized (
             select session.*
               from ai_content_attachment_upload_sessions session
              where session.status in ('pending', 'failed', 'cancelled')
                and session.token_expires_at <= now()
                and not exists (
                  select 1 from ai_content_attachment_deletion_jobs existing_session_job
                   where existing_session_job.upload_session_id = session.id
                )
              order by session.token_expires_at, session.created_at, session.id
              limit $1
              for update skip locked
           ),
           transitioned_sessions as (
             update ai_content_attachment_upload_sessions session
                set status = case when session.status = 'pending' then 'expired' else session.status end,
                    expired_at = case when session.status = 'pending' then now() else session.expired_at end,
                    updated_at = now()
               from expired_sessions candidate
              where session.id = candidate.id
              returning session.*
           ),
           session_jobs as (
             insert into ai_content_attachment_deletion_jobs (
               workspace_id, brand_id, generation_id, attachment_id, upload_session_id,
               storage_url, storage_path, reason, status, next_attempt_at
             )
             select session.workspace_id, session.brand_id, session.generation_id,
                    session.confirmed_attachment_id, session.id, session.storage_url,
                    session.storage_path,
                    case session.status when 'expired' then 'upload_session_expired'
                      when 'failed' then 'upload_session_failed' else 'upload_session_cancelled' end,
                    'pending', greatest(now(), session.token_expires_at)
               from transitioned_sessions session
             on conflict (workspace_id, storage_path) do nothing
             returning id
           ),
           attachment_candidates as materialized (
              select attachment.*, generation.terminal_at, generation.retryable_until,
                    session.token_expires_at, session.status as upload_session_status
               from ai_content_generation_attachments attachment
               join ai_content_generations generation on generation.id = attachment.generation_id
              left join ai_content_attachment_upload_sessions session
                 on session.id = attachment.upload_session_id
              where attachment.physically_deleted_at is null
                and attachment.physical_delete_status in ('none','pending','failed')
                and not exists (
                  select 1 from ai_content_attachment_deletion_jobs existing_attachment_job
                   where existing_attachment_job.attachment_id = attachment.id
                )
                and (
                  attachment.deleted_at is not null
                  or (
                    generation.terminal_at is not null
                    and generation.retryable_until <= now()
                  )
                )
              order by coalesce(attachment.deleted_at, generation.retryable_until),
                       attachment.created_at, attachment.id
              limit $1
              for update of attachment skip locked
           ),
           marked_attachments as (
             update ai_content_generation_attachments attachment
                set deleted_at = coalesce(attachment.deleted_at, now()),
                    deletion_reason = coalesce(attachment.deletion_reason, 'terminal_retention_expired'),
                    physical_delete_status = 'pending'
               from attachment_candidates candidate
              where attachment.id = candidate.id
              returning attachment.*, candidate.retryable_until, candidate.token_expires_at,
                        candidate.upload_session_status
           ),
           attachment_jobs as (
             insert into ai_content_attachment_deletion_jobs (
               workspace_id, brand_id, generation_id, attachment_id, upload_session_id,
               storage_url, storage_path, reason, status, next_attempt_at
             )
             select attachment.workspace_id, attachment.brand_id, attachment.generation_id,
                    attachment.id, attachment.upload_session_id, attachment.storage_url,
                    attachment.storage_path, attachment.deletion_reason, 'pending',
                    greatest(
                      now(),
                      coalesce(attachment.retryable_until, now()),
                      coalesce(attachment.token_expires_at, now())
                    )
               from marked_attachments attachment
             on conflict (workspace_id, storage_path) do nothing
             returning id
           ),
           expired_leases as materialized (
             select job.id, job.lease_token, job.attempt_count, job.max_attempts
               from ai_content_attachment_deletion_jobs job
              where job.status = 'deleting' and job.lease_expires_at <= now()
              order by job.lease_expires_at, job.id
              limit $1
              for update skip locked
           ),
           dead_lettered_expired as (
             update ai_content_attachment_deletion_jobs job
                set status = 'dead_letter', lease_token = null, lease_expires_at = null,
                    last_error_category = 'lease_exhausted',
                    last_error_message = 'Deletion lease expired after the final attempt',
                    updated_at = now()
               from expired_leases expired
              where job.id = expired.id
                and job.lease_token = expired.lease_token
                and job.status = 'deleting'
                and job.lease_expires_at <= now()
                and job.attempt_count >= job.max_attempts
              returning job.attachment_id
           ),
           reclaimed as (
             update ai_content_attachment_deletion_jobs job
                set status = 'pending', lease_token = null, lease_expires_at = null,
                    next_attempt_at = now(), updated_at = now()
               from expired_leases expired
              where job.id = expired.id
                and job.lease_token = expired.lease_token
                and job.status = 'deleting' and job.lease_expires_at <= now()
                and job.attempt_count < job.max_attempts
              returning job.attachment_id
           ),
           reclaimed_attachments as (
             update ai_content_generation_attachments attachment
                set physical_delete_status = 'pending'
               from reclaimed
              where attachment.id = reclaimed.attachment_id
              returning attachment.id
           ),
           dead_lettered_attachments as (
             update ai_content_generation_attachments attachment
                set physical_delete_status = 'dead_letter',
                    physically_deleted_at = null
               from dead_lettered_expired
              where attachment.id = dead_lettered_expired.attachment_id
              returning attachment.id
           )
           select
             (select count(*) from expired_sessions)::integer as sessions_scanned,
             (select count(*) from transitioned_sessions)::integer as sessions_claimed,
             (select count(*) from marked_attachments where upload_session_status = 'confirmed')::integer
               as sessions_confirmed,
             (select count(*) from transitioned_sessions where status = 'expired')::integer as sessions_expired,
             ((select count(*) from session_jobs) + (select count(*) from attachment_jobs))::integer as jobs_created,
             (select count(*) from reclaimed)::integer as leases_reclaimed`,
          [limit],
        );
        const row = result.rows[0] ?? {};
        return {
          sessionsScanned: count(row.sessions_scanned),
          sessionsClaimed: count(row.sessions_claimed),
          sessionsConfirmed: count(row.sessions_confirmed),
          sessionsExpired: count(row.sessions_expired),
          jobsCreated: count(row.jobs_created),
          leasesReclaimed: count(row.leases_reclaimed),
        };
      });
    },

    async claimAiContentAttachmentDeletionJobs(input) {
      const batchSize = positiveBoundedInteger(input.batchSize, MAX_BATCH, "ai_content_gc_batch_size_invalid");
      const leaseSeconds = positiveBoundedInteger(
        input.leaseSeconds,
        MAX_LEASE_SECONDS,
        "ai_content_gc_lease_seconds_invalid",
      );
      if (!/^[A-Za-z0-9._:-]{1,100}$/.test(input.workerId)) {
        throw new Error("ai_content_gc_worker_id_invalid");
      }
      const startedAt = Date.now();
      const claims: AiContentAttachmentDeletionClaim[] = [];
      let cursor: { nextAttemptAt: string; createdAt: string; id: string } | null = null;
      scan: while (claims.length < batchSize) {
        const elapsed = Date.now() - startedAt;
        const remainingBudgetMs = input.remainingBudgetMs - elapsed;
        if (remainingBudgetMs <= 0) break;
        let candidates: Array<Record<string, unknown>>;
        try {
          candidates = await inBudgetTransaction(pool, {
            remainingBudgetMs,
            statementTimeoutMs: Math.min(input.statementTimeoutMs, remainingBudgetMs),
          }, async (client) => {
            const result = await client.query(
              `with exhausted_leases as materialized (
                 select job.id, job.attachment_id, job.lease_token
                   from ai_content_attachment_deletion_jobs job
                  where job.status = 'deleting'
                    and job.lease_expires_at <= now()
                    and job.attempt_count >= job.max_attempts
                  order by job.lease_expires_at, job.created_at, job.id
                  limit $1
                  for update skip locked
               ),
               dead_lettered as (
                 update ai_content_attachment_deletion_jobs job
                    set status = 'dead_letter', lease_token = null, lease_expires_at = null,
                        last_error_category = 'lease_exhausted',
                        last_error_message = 'Deletion lease expired after the final attempt',
                        updated_at = now()
                   from exhausted_leases exhausted
                  where job.id = exhausted.id
                    and job.lease_token = exhausted.lease_token
                    and job.status = 'deleting'
                    and job.lease_expires_at <= now()
                    and job.attempt_count >= job.max_attempts
                  returning job.attachment_id
               ),
               mirrored_dead_letters as (
                 update ai_content_generation_attachments attachment
                    set physical_delete_status = 'dead_letter',
                        physically_deleted_at = null
                   from dead_lettered
                  where attachment.id = dead_lettered.attachment_id
                  returning attachment.id
               ),
               gc_candidate_jobs as materialized (
                 select job.id, job.generation_id, job.workspace_id, job.brand_id,
                        job.next_attempt_at, job.created_at
                   from ai_content_attachment_deletion_jobs job
                  where ${eligibilityPredicate("job")}
                    and (
                      $2::timestamptz is null
                      or (job.next_attempt_at, job.created_at, job.id)
                         > ($2::timestamptz, $3::timestamptz, $4::uuid)
                    )
                  order by job.next_attempt_at, job.created_at, job.id
                  limit $1
               )
               select id, generation_id, workspace_id, brand_id, next_attempt_at, created_at
                 from gc_candidate_jobs`,
              [
                batchSize - claims.length,
                cursor?.nextAttemptAt ?? null,
                cursor?.createdAt ?? null,
                cursor?.id ?? null,
              ],
            );
            return result.rows as Array<Record<string, unknown>>;
          });
        } catch (error) {
          if (claims.length === 0) throw error;
          break;
        }
        if (candidates.length === 0) break;

        let hasStableCursor = true;
        for (const candidate of candidates) {
          if (
            candidate.next_attempt_at === undefined
            || candidate.created_at === undefined
            || candidate.id === undefined
          ) {
            hasStableCursor = false;
          } else {
            cursor = {
              nextAttemptAt: iso(candidate.next_attempt_at),
              createdAt: iso(candidate.created_at),
              id: String(candidate.id),
            };
          }
          const candidateElapsed = Date.now() - startedAt;
          const candidateBudgetMs = input.remainingBudgetMs - candidateElapsed;
          if (candidateBudgetMs <= 0) break scan;
          const leaseToken = requireUuid(createId(), "ai_content_gc_lease_token_invalid");
          let claim: AiContentAttachmentDeletionClaim | null;
          try {
            claim = await inBudgetTransaction(pool, {
              remainingBudgetMs: candidateBudgetMs,
              statementTimeoutMs: Math.min(input.statementTimeoutMs, candidateBudgetMs),
            }, async (client) => {
              if (candidate.generation_id) {
                const generation = await client.query(
                  `select id from ai_content_generations
                    where id = $1 and workspace_id = $2 and brand_id = $3
                    for update`,
                  [candidate.generation_id, candidate.workspace_id, candidate.brand_id],
                );
                // A parent may disappear between candidate read and lock. Such
                // a durable orphan is still claimable by locking only the job.
                if (!generation.rowCount) {
                  // no-op
                }
              }
              const locked = await client.query(
                `select job.*
                   from ai_content_attachment_deletion_jobs job
                  where job.id = $1
                    and ${eligibilityPredicate("job")}
                  for update skip locked`,
                [candidate.id],
              );
              if (!locked.rowCount) return null;
              const leased = await client.query(
                `update ai_content_attachment_deletion_jobs
                    set status = 'deleting', lease_token = $2::uuid,
                        lease_expires_at = now() + ($3::text || ' seconds')::interval,
                        updated_at = now()
                  where id = $1
                    and attempt_count < max_attempts
                    and (
                      status in ('pending','failed')
                      or (status = 'deleting' and lease_expires_at <= now())
                    )
                  returning *`,
                [candidate.id, leaseToken, leaseSeconds],
              );
              if (!leased.rowCount) return null;
              const row = leased.rows[0] as Record<string, unknown>;
              if (row.attachment_id) {
                await client.query(
                  `update ai_content_generation_attachments
                      set physical_delete_status = 'deleting',
                          physically_deleted_at = null
                    where id = $1`,
                  [row.attachment_id],
                );
              }
              return mapClaim(row);
            });
          } catch (error) {
            if (claims.length === 0) throw error;
            break scan;
          }
          if (claim) claims.push(claim);
          if (claims.length >= batchSize) break scan;
        }
        if (!hasStableCursor) break;
      }
      return claims;
    },

    async beginAiContentAttachmentDeletionAttempt(input) {
      const jobId = requireUuid(input.jobId, "ai_content_gc_job_id_invalid");
      const leaseToken = requireUuid(input.leaseToken, "ai_content_gc_lease_token_invalid");
      return inBudgetTransaction(pool, input, async (client) => {
        const result = await client.query(
          `update ai_content_attachment_deletion_jobs
              set attempt_count = attempt_count + 1, updated_at = now()
            where id = $1 and status = 'deleting' and lease_token = $2::uuid
              and lease_expires_at > now() and attempt_count < max_attempts
            returning attempt_count`,
          [jobId, leaseToken],
        );
        return result.rowCount ? Number(result.rows[0].attempt_count) : null;
      });
    },

    async releaseUnstartedAiContentAttachmentDeletions(input) {
      if (!input.claims.length) return 0;
      if (input.claims.length > MAX_BATCH) throw new Error("ai_content_gc_release_batch_invalid");
      const jobIds = input.claims.map((claim) => requireUuid(claim.jobId, "ai_content_gc_job_id_invalid"));
      const leaseTokens = input.claims.map((claim) => requireUuid(claim.leaseToken, "ai_content_gc_lease_token_invalid"));
      return inBudgetTransaction(pool, input, async (client) => {
        const result = await client.query(
          `with claim_pairs as (
             select * from unnest($1::uuid[], $2::uuid[]) pair(job_id, lease_token)
           ),
           released as (
             update ai_content_attachment_deletion_jobs job
                set status = 'pending', lease_token = null, lease_expires_at = null,
                    next_attempt_at = now(), updated_at = now()
               from claim_pairs pair
              where job.id = pair.job_id and job.status = 'deleting'
                and job.lease_token = pair.lease_token
              returning job.attachment_id
           ),
           mirrored as (
             update ai_content_generation_attachments attachment
                set physical_delete_status = 'pending', physically_deleted_at = null
               from released
              where attachment.id = released.attachment_id
              returning attachment.id
           )
           select count(*)::integer as released_count from released`,
          [jobIds, leaseTokens],
        );
        return count(result.rows[0]?.released_count);
      });
    },

    async completeAiContentAttachmentDeletion(input) {
      const jobId = requireUuid(input.jobId, "ai_content_gc_job_id_invalid");
      const leaseToken = requireUuid(input.leaseToken, "ai_content_gc_lease_token_invalid");
      if (input.outcome !== "deleted" && input.outcome !== "not_found") {
        throw new Error("ai_content_gc_outcome_invalid");
      }
      return inBudgetTransaction(pool, input, async (client) => {
        const completed = await client.query(
          `update ai_content_attachment_deletion_jobs
              set status = 'deleted', completed_at = now(), lease_token = null,
                  lease_expires_at = null, last_error_category = null,
                  last_error_message = null, updated_at = now()
            where id = $1 and status = 'deleting' and lease_token = $2::uuid
            returning attachment_id`,
          [jobId, leaseToken],
        );
        if (!completed.rowCount) return false;
        const attachmentId = completed.rows[0].attachment_id;
        if (attachmentId) {
          await client.query(
            `update ai_content_generation_attachments
                set physical_delete_status = 'deleted', physically_deleted_at = now()
              where id = $1`,
            [attachmentId],
          );
        }
        return true;
      });
    },

    async failAiContentAttachmentDeletion(input) {
      const jobId = requireUuid(input.jobId, "ai_content_gc_job_id_invalid");
      const leaseToken = requireUuid(input.leaseToken, "ai_content_gc_lease_token_invalid");
      const category = redactAiContentAttachmentGcError(input.errorCategory, MAX_ERROR_CATEGORY)
        .toLowerCase()
        .replace(/[^a-z0-9_:-]/g, "_");
      const message = redactAiContentAttachmentGcError(input.errorMessage);
      const retryDelay = input.retryDelaySeconds === null
        ? null
        : positiveBoundedInteger(input.retryDelaySeconds, 24 * 60 * 60, "ai_content_gc_retry_delay_invalid");
      return inBudgetTransaction(pool, input, async (client) => {
        const failed = await client.query(
          `update ai_content_attachment_deletion_jobs
              set status = case when $3 in ('authorization','authentication','permanent')
                                  or $5::integer is null or attempt_count >= max_attempts
                                then 'dead_letter' else 'failed' end,
                  next_attempt_at = case when $3 in ('authorization','authentication','permanent')
                                           or $5::integer is null or attempt_count >= max_attempts
                                         then next_attempt_at
                                         else now() + ($5::text || ' seconds')::interval end,
                  lease_token = null, lease_expires_at = null,
                  last_error_category = $3, last_error_message = $4, updated_at = now()
            where id = $1 and status = 'deleting' and lease_token = $2::uuid
            returning case when status = 'dead_letter' then 'dead_letter' else 'retry' end as disposition,
                      attachment_id`,
          [jobId, leaseToken, category, message, retryDelay],
        );
        if (!failed.rowCount) return "stale";
        const row = failed.rows[0] as Record<string, unknown>;
        const disposition = String(row.disposition) as "retry" | "dead_letter";
        if (row.attachment_id) {
          await client.query(
            `update ai_content_generation_attachments
                set physical_delete_status = $2, physically_deleted_at = null
              where id = $1`,
            [row.attachment_id, disposition === "retry" ? "failed" : "dead_letter"],
          );
        }
        return disposition;
      });
    },

    async getAiContentAttachmentGcMetrics(input) {
      return inBudgetTransaction(pool, input, async (client) => {
        const result = await client.query(
          `with classified as (
             select job.*,
                    (${eligibilityPredicate("job")}) as eligible,
                    ${holdReason("job")} as hold_reason
               from ai_content_attachment_deletion_jobs job
              where job.status in ('pending','failed','deleting')
           ),
           eligible as (
             select * from classified where eligible
           ),
           held as (
             select * from classified where not eligible and hold_reason is not null
           ),
           hold_counts as (
             select coalesce(jsonb_object_agg(hold_reason, count), '{}'::jsonb) as counts
               from (select hold_reason, count(*)::integer as count from held group by hold_reason) grouped
           ),
           attempt_buckets as (
             select jsonb_build_object(
               '0', count(*) filter (where attempt_count = 0),
               '1-3', count(*) filter (where attempt_count between 1 and 3),
               '4-9', count(*) filter (where attempt_count between 4 and 9),
               '10+', count(*) filter (where attempt_count >= 10)
             ) as counts
             from ai_content_attachment_deletion_jobs
              where status not in ('deleted')
           )
           select
             (select count(*) from eligible)::integer as eligible_queue_depth,
             (select extract(epoch from now() - min(created_at)) from eligible)
               as oldest_eligible_pending_age_seconds,
             (select count(*) from held)::integer as held_job_count,
             (select extract(epoch from now() - min(created_at)) from held)
               as oldest_held_age_seconds,
             (select counts from hold_counts) as hold_reason_counts,
             (select counts from attempt_buckets) as attempt_count_buckets,
             (select count(*) from ai_content_attachment_deletion_jobs where status = 'dead_letter')::integer
               as dead_letter_count`,
        );
        const row = result.rows[0] ?? {};
        return {
          eligibleQueueDepth: count(row.eligible_queue_depth),
          oldestEligiblePendingAgeSeconds: nullableNumber(row.oldest_eligible_pending_age_seconds),
          heldJobCount: count(row.held_job_count),
          oldestHeldAgeSeconds: nullableNumber(row.oldest_held_age_seconds),
          holdReasonCounts: asRecord(row.hold_reason_counts),
          attemptCountBuckets: asRecord(row.attempt_count_buckets),
          deadLetterCount: count(row.dead_letter_count),
        };
      });
    },
  };
}
