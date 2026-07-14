import { Pool } from "pg";
import type { ClaimedWikiBuildItem, WikiBuildDocument, WikiBuildSource } from "./wikiRefresh.js";

export interface WikiSearchChunk {
  chunkId: string;
  wikiDocumentId: string;
  knowledgeEntryId: string | null;
  sourceKind: string;
  title: string | null;
  content: string;
  directAnswer: string | null;
  cosineSimilarity: number;
  keywordMatch: number;
  rrfScore: number;
}

export interface ConversationHistoryItem {
  direction: string;
  body: string | null;
}

export function createDmWorkerDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return {
    async claimWikiBuildItem(workerId: string, versions: {
      curatorPromptVersion: string;
      embeddingModel: string;
      embeddingVersion: string;
    }) {
      const client = await pool.connect();
      const claimPending = () => client.query(
        `with candidate as (
           select item.id
           from wiki_build_items item
           join wiki_versions version on version.id = item.wiki_version_id
           where item.status = 'pending' and version.status = 'building'
           order by item.created_at, item.id
           for update of item skip locked
           limit 1
         )
         update wiki_build_items item
         set status = 'processing', attempt_count = attempt_count + 1,
             started_at = now(), error_message = null, updated_at = now()
         from candidate
         where item.id = candidate.id
         returning item.id, item.workspace_id, item.brand_id, item.wiki_version_id,
                   item.source_kind, item.source_id`,
      );
      try {
        await client.query("begin");
        let claimed = await claimPending();
        if (!claimed.rowCount) {
          const job = await client.query(
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
             returning job.id, job.workspace_id, job.brand_id`,
            [workerId],
          );
          if (job.rowCount) {
            const { id: jobId, workspace_id: workspaceId, brand_id: brandId } = job.rows[0];
            const version = await client.query(
              `insert into wiki_versions (
                 workspace_id, brand_id, status, prompt_version, embedding_model, embedding_version
               ) values ($1::uuid, $2::uuid, 'building', $3, $4, $5)
               returning id`,
              [workspaceId, brandId, versions.curatorPromptVersion, versions.embeddingModel, versions.embeddingVersion],
            );
            const versionId = version.rows[0].id as string;
            await client.query(
              `insert into wiki_build_items (
                 workspace_id, brand_id, wiki_version_id, source_kind, source_id, status
               )
               select $1::uuid, $2::uuid, $3::uuid, source.source_kind, source.source_id, 'pending'
               from (
                 select entry.entry_type as source_kind, entry.id as source_id
                 from knowledge_entries entry
                 where entry.workspace_id = $1::uuid and entry.brand_id = $2::uuid and entry.enabled
                 union all
                 select refresh.source_kind, refresh.source_id
                 from get_wiki_refresh_sources($1::uuid, $2::uuid) refresh
                 where refresh.source_kind = 'owned_snapshot'
               ) source
               on conflict (wiki_version_id, source_kind, source_id) do nothing`,
              [workspaceId, brandId, versionId],
            );
            await client.query(
              `update wiki_versions
               set source_count = (select count(*)::integer from wiki_build_items where wiki_version_id = $1::uuid)
               where id = $1::uuid`,
              [versionId],
            );
            await client.query(
              `update jobs
               set status = 'succeeded', result_json = $2::jsonb, locked_by = null,
                   locked_until = null, lease_token = null, finished_at = now(), updated_at = now()
               where id = $1::uuid`,
              [jobId, JSON.stringify({ wikiVersionId: versionId })],
            );
            claimed = await claimPending();
            if (!claimed.rowCount) await client.query("select activate_wiki_version($1::uuid)", [versionId]);
          }
        }
        await client.query("commit");
        return claimed.rowCount ? claimed.rows[0] as ClaimedWikiBuildItem : null;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async getWikiBuildSource(item: ClaimedWikiBuildItem) {
      const result = await pool.query(
        `select entry.entry_type as source_kind, entry.id as source_id,
                coalesce(entry.title, entry.question) as title,
                case when entry.entry_type = 'faq'
                  then concat('질문: ', entry.question, E'\n\n답변: ', entry.answer)
                  else entry.content end as content,
                md5(concat_ws(E'\n', entry.entry_type, entry.normalized_question,
                  entry.title, entry.content, entry.question, entry.answer,
                  array_to_string(entry.aliases, ','), array_to_string(entry.keywords, ','),
                  entry.structured_data::text)) as content_hash,
                entry.aliases, entry.keywords, entry.structured_data, null::text as source_url
         from knowledge_entries entry
         where entry.id = $1::uuid and entry.workspace_id = $2::uuid and entry.brand_id = $3::uuid
           and entry.entry_type = $4 and entry.enabled
         union all
         select 'owned_snapshot', snapshot.id,
                coalesce(snapshot.extracted_title, content_item.title, source.title, source.url),
                coalesce(snapshot.extracted_text, snapshot.raw_text, snapshot.summary, ''),
                coalesce(snapshot.content_hash, md5(coalesce(snapshot.extracted_text, snapshot.raw_text, snapshot.summary, ''))),
                '{}'::text[], '{}'::text[], '{}'::jsonb,
                coalesce(content_item.canonical_url, content_item.content_url, source.url)
         from source_snapshots snapshot
         join source_urls source on source.id = snapshot.source_url_id
         left join source_content_items content_item
           on content_item.id = snapshot.source_content_item_id and content_item.deleted_at is null
         where snapshot.id = $1::uuid and snapshot.workspace_id = $2::uuid and snapshot.brand_id = $3::uuid
           and $4 = 'owned_snapshot' and snapshot.status = 'succeeded' and source.source_type = 'owned'`,
        [item.source_id, item.workspace_id, item.brand_id, item.source_kind],
      );
      if (!result.rowCount) throw new Error("wiki_build_source_not_found");
      return result.rows[0] as WikiBuildSource;
    },
    async getExistingEmbeddings(brandId: string, contentHashes: string[]) {
      if (!contentHashes.length) return [];
      const result = await pool.query(
        `select chunk.content_hash, chunk.embedding::text as embedding,
                chunk.embedding_model, chunk.embedding_version,
                coalesce(version.prompt_version, '') as curator_prompt_version
         from wiki_chunks chunk
         join wiki_documents document on document.id = chunk.wiki_document_id
         join wiki_versions version on version.id = document.wiki_version_id
         where chunk.brand_id = $1::uuid and chunk.enabled and chunk.embedding is not null
           and chunk.content_hash = any($2::text[])`,
        [brandId, contentHashes],
      );
      return result.rows as Array<{
        content_hash: string;
        embedding: string;
        embedding_model: string;
        embedding_version: string;
        curator_prompt_version: string;
      }>;
    },
    async completeWikiBuildItem(item: ClaimedWikiBuildItem, document: WikiBuildDocument | null) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        if (document) {
          const inserted = await client.query(
            `insert into wiki_documents (
               workspace_id, brand_id, wiki_version_id, source_kind,
               knowledge_entry_id, source_snapshot_id, title, content, content_hash,
               is_active, normalized_json, source_url, refreshed_at
             ) values (
               $1::uuid, $2::uuid, $3::uuid, $4,
               case when $4 in ('faq', 'product', 'policy') then $5::uuid end,
               case when $4 = 'owned_snapshot' then $5::uuid end,
               $6, $7, $8, false, $9::jsonb, $10, now()
             ) returning id`,
            [
              item.workspace_id, item.brand_id, item.wiki_version_id, document.source_kind,
              document.source_id, document.title, document.content, document.content_hash,
              JSON.stringify(document.normalized_json), document.source_url,
            ],
          );
          await client.query(
            `insert into wiki_chunks (
               workspace_id, brand_id, wiki_document_id, chunk_index, content, content_hash,
               search_vector, embedding, embedding_model, embedding_version, enabled
             )
             select $1::uuid, $2::uuid, $3::uuid, chunk.chunk_index, chunk.content, chunk.content_hash,
                    to_tsvector('simple', chunk.content), nullif(chunk.embedding, '')::vector,
                    chunk.embedding_model, chunk.embedding_version, true
             from jsonb_to_recordset($4::jsonb) as chunk(
               chunk_index integer, content text, content_hash text, embedding text,
               embedding_model text, embedding_version text
             )`,
            [item.workspace_id, item.brand_id, inserted.rows[0].id, JSON.stringify(document.chunks)],
          );
        }
        const completed = await client.query(
          `update wiki_build_items
           set status = 'succeeded', error_message = null, completed_at = now(), updated_at = now()
           where id = $1::uuid and wiki_version_id = $2::uuid and status = 'processing'`,
          [item.id, item.wiki_version_id],
        );
        if (!completed.rowCount) throw new Error("wiki_build_item_not_processing");
        const remaining = await client.query(
          `select exists(
             select 1 from wiki_build_items
             where wiki_version_id = $1::uuid and status <> 'succeeded'
           ) as has_remaining`,
          [item.wiki_version_id],
        );
        let activated = false;
        if (!remaining.rows[0].has_remaining) {
          const activation = await client.query(
            "select activate_wiki_version($1::uuid) as activated",
            [item.wiki_version_id],
          );
          activated = activation.rows[0].activated === true;
        }
        await client.query("commit");
        return { activated };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async failWikiBuildItem(item: ClaimedWikiBuildItem, error: string) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          `update wiki_build_items
           set status = 'failed', error_message = $3, completed_at = now(), updated_at = now()
           where id = $1::uuid and wiki_version_id = $2::uuid`,
          [item.id, item.wiki_version_id, error.slice(0, 2000)],
        );
        await client.query(
          `update wiki_versions
           set status = 'failed', error_message = $2, completed_at = now(), updated_at = now()
           where id = $1::uuid and status = 'building'`,
          [item.wiki_version_id, error.slice(0, 2000)],
        );
        await client.query(
          "update wiki_documents set is_active = false, refreshed_at = now() where wiki_version_id = $1::uuid",
          [item.wiki_version_id],
        );
        await client.query("commit");
      } catch (failure) {
        await client.query("rollback");
        throw failure;
      } finally {
        client.release();
      }
    },
    async searchWiki(workspaceId: string, brandId: string, question: string, embedding: number[]) {
      const result = await pool.query(
        "select * from search_brand_wiki_v2($1::uuid, $2::uuid, $3::vector, $4, 8)",
        [workspaceId, brandId, `[${embedding.join(",")}]`, question],
      );
      return result.rows.map((row) => ({
        chunkId: row.chunk_id,
        wikiDocumentId: row.wiki_document_id,
        knowledgeEntryId: row.knowledge_entry_id,
        sourceKind: row.source_kind,
        title: row.title,
        content: row.content,
        directAnswer: row.direct_answer,
        cosineSimilarity: Number(row.cosine_similarity),
        keywordMatch: Number(row.keyword_match),
        rrfScore: Number(row.rrf_score),
      })) as WikiSearchChunk[];
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
