import { Pool } from "pg";

export interface WikiSearchChunk {
  id: string;
  content: string;
  score: number;
}

export interface ConversationHistoryItem {
  direction: string;
  body: string | null;
}

export function createDmWorkerDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return {
    async claimWikiRefreshJob(workerId: string) {
      const result = await pool.query(
        `with candidate as (
           select id from jobs
           where job_type = 'wiki_refresh' and attempt_count < max_attempts and run_at <= now()
             and (status = 'queued' or (status = 'running' and locked_until < now()))
           order by priority desc, created_at asc for update skip locked limit 1
         )
         update jobs job
         set status = 'running', locked_by = $1, locked_until = now() + interval '5 minutes',
             lease_token = gen_random_uuid(), attempt_count = attempt_count + 1,
             started_at = coalesce(started_at, now()), updated_at = now()
         from candidate where job.id = candidate.id
         returning job.id, job.workspace_id, job.brand_id, job.lease_token`,
        [workerId],
      );
      return result.rowCount ? result.rows[0] as { id: string; workspace_id: string; brand_id: string; lease_token: string } : null;
    },
    async getWikiSources(workspaceId: string, brandId: string) {
      const result = await pool.query(
        "select source_kind, source_id, title, content, content_hash from get_wiki_refresh_sources($1::uuid, $2::uuid)",
        [workspaceId, brandId],
      );
      return result.rows as Array<{ source_kind: "faq" | "owned_snapshot"; source_id: string; title: string; content: string; content_hash: string }>;
    },
    async replaceWiki(workspaceId: string, brandId: string, documents: unknown[]) {
      await pool.query("select replace_wiki_refresh_result($1::uuid, $2::uuid, $3::jsonb)", [workspaceId, brandId, JSON.stringify(documents)]);
    },
    async completeWikiRefreshJob(jobId: string, workerId: string, leaseToken: string, chunkCount: number) {
      await pool.query(
        `update jobs set status = 'succeeded', result_json = $4::jsonb, locked_by = null, locked_until = null,
           lease_token = null, finished_at = now(), updated_at = now()
         where id = $1 and job_type = 'wiki_refresh' and status = 'running' and locked_by = $2 and lease_token = $3::uuid`,
        [jobId, workerId, leaseToken, JSON.stringify({ chunkCount })],
      );
    },
    async failWikiRefreshJob(jobId: string, workerId: string, leaseToken: string, error: string) {
      await pool.query(
        `update jobs set status = 'failed', last_error = $4, locked_by = null, locked_until = null,
           lease_token = null, finished_at = now(), updated_at = now()
         where id = $1 and job_type = 'wiki_refresh' and status = 'running' and locked_by = $2 and lease_token = $3::uuid`,
        [jobId, workerId, leaseToken, error.slice(0, 2000)],
      );
    },
    async searchWiki(workspaceId: string, brandId: string, question: string, embedding: number[]) {
      const result = await pool.query(
        "select id, content, score from search_brand_wiki($1::uuid, $2::uuid, $3::vector, $4, 8)",
        [workspaceId, brandId, `[${embedding.join(",")}]`, question],
      );
      return result.rows as WikiSearchChunk[];
    },
    async conversationHistory(workspaceId: string, brandId: string, conversationId: string) {
      const result = await pool.query(
        "select direction, body from get_dm_conversation_history($1::uuid, $2::uuid, $3::uuid, 6)",
        [workspaceId, brandId, conversationId],
      );
      return result.rows as ConversationHistoryItem[];
    },
    async close() { await pool.end(); },
  };
}
