import { Pool, type PoolConfig } from "pg";
import type {
  ClaimedWikiValidationItem,
  FinalizedWikiChunk,
  WikiPageForFinalization,
} from "./compiledWikiFinalize.js";
import type { CompiledWikiSourceUnit } from "./compiledWikiTypes.js";
import type { CompiledWikiSearchPacket } from "./compiledWikiTypes.js";

const offeringQuestionPattern = /(제품|상품|서비스|제공|판매|구매|도입|상세\s*정보|자세한\s*정보|어디(?:서|에서)?\s*확인|무엇을\s*(?:하|제공)|뭘\s*(?:하|제공))/i;
const offeringLocationQuestionPattern = /(어디(?:서|에서)?\s*(?:확인|보|찾)|자세한\s*(?:제품|상품|서비스)?\s*정보|상세\s*(?:제품|상품|서비스)?\s*정보)/i;
const productQuestionPattern = /(제품|상품)/i;

export function isOfferingQuestion(question: string) {
  return offeringQuestionPattern.test(question.normalize("NFKC"));
}

export function isOfferingLocationQuestion(question: string) {
  return offeringLocationQuestionPattern.test(question.normalize("NFKC"));
}

export function isProductQuestion(question: string) {
  return productQuestionPattern.test(question.normalize("NFKC"));
}
import type { ClaimedWikiCompilationItem } from "./compiledWikiWorker.js";
import {
  createWikiCompilationGroups,
  type CompiledWikiPage,
  type CompiledWikiSourceRecord,
} from "./wikiCompiler.js";
import type { ClaimedWikiBuildItem, WikiBuildDocument, WikiBuildSource } from "./wikiRefresh.js";
import type { WikiMaintenanceContext, WikiMaintenanceOutput } from "./wikiMaintenance.js";

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

export function resolveDmPoolConfig(connectionString: string): PoolConfig {
  const url = new URL(connectionString);
  if (url.hostname.endsWith(".supabase.com")) {
    url.searchParams.delete("sslmode");
    return { connectionString: url.toString(), ssl: { rejectUnauthorized: false } };
  }
  return { connectionString };
}

export function createDmWorkerDb(connectionString: string) {
  const pool = new Pool(resolveDmPoolConfig(connectionString));
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
        await client.query(
          `update wiki_build_items
           set status = 'pending', started_at = null,
               error_message = 'wiki_build_item_lease_recovered', updated_at = now()
           where status = 'processing' and started_at < now() - interval '15 minutes'
             and attempt_count < 3`,
        );
        await client.query(
          `with exhausted as (
             update wiki_build_items
             set status = 'failed', error_message = 'wiki_build_item_attempts_exhausted',
                 completed_at = now(), updated_at = now()
             where status = 'processing' and started_at < now() - interval '15 minutes'
               and attempt_count >= 3
             returning wiki_version_id
           )
           update wiki_versions version
           set status = 'failed', error_message = 'wiki_build_item_attempts_exhausted',
               completed_at = now(), updated_at = now()
            where version.id in (select wiki_version_id from exhausted) and version.status = 'building'`,
        );
        await client.query(
          `update wiki_build_requests request
           set status = 'failed', error_message = 'wiki_build_item_attempts_exhausted',
               completed_at = now(), updated_at = now()
           where request.status = 'building'
             and exists (
               select 1
               from wiki_versions version
               where version.workspace_id = request.workspace_id
                 and version.brand_id = request.brand_id
                 and version.status = 'failed'
                 and version.error_message = 'wiki_build_item_attempts_exhausted'
                 and version.completed_at >= request.started_at
             )`,
        );
        let claimed = await claimPending();
        if (!claimed.rowCount) {
          const request = await client.query(
            `with candidate as (
               select id from wiki_build_requests
               where status = 'pending' and quiet_until <= now()
               order by created_at asc for update skip locked limit 1
             )
             update wiki_build_requests request
             set status = 'building', building_revision = requested_revision,
                 rebuild_requested = false, started_at = now(), completed_at = null,
                 error_message = null, updated_at = now()
             from candidate where request.id = candidate.id
             returning request.id, request.workspace_id, request.brand_id`,
          );
          if (request.rowCount) {
            const { workspace_id: workspaceId, brand_id: brandId } = request.rows[0];
            const version = await client.query(
              `insert into wiki_versions (
                 workspace_id, brand_id, status, build_stage,
                 prompt_version, embedding_model, embedding_version
               ) values ($1::uuid, $2::uuid, 'building', 'collecting', $3, $4, $5)
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
            claimed = await claimPending();
            if (!claimed.rowCount) {
              await client.query(
                `update wiki_versions
                 set status = 'failed', error_message = 'wiki_source_units_missing',
                     completed_at = now(), updated_at = now()
                 where id = $1::uuid`,
                [versionId],
              );
              await client.query(
                `update wiki_build_requests
                 set status = 'failed', error_message = 'wiki_source_units_missing',
                     completed_at = now(), updated_at = now()
                 where workspace_id = $1::uuid and brand_id = $2::uuid and status = 'building'`,
                [workspaceId, brandId],
              );
            }
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
    async completeWikiSourceItem(
      item: ClaimedWikiBuildItem,
      units: CompiledWikiSourceUnit[],
    ) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          `delete from wiki_source_units
           where wiki_version_id = $1::uuid and workspace_id = $2::uuid and brand_id = $3::uuid
             and source_kind = $4 and source_id = $5::uuid`,
          [item.wiki_version_id, item.workspace_id, item.brand_id, item.source_kind, item.source_id],
        );
        for (const unit of units) {
          await client.query(
            `insert into wiki_source_units (
               workspace_id, brand_id, wiki_version_id, source_kind, source_id,
               unit_type, stable_key, title, content, content_hash, keywords, aliases,
               structured_data, source_url, destination_url, source_quote, valid_from, valid_until
             ) values (
               $1::uuid, $2::uuid, $3::uuid, $4, $5::uuid,
               $6, $7, $8, $9, $10, $11::text[], $12::text[],
               $13::jsonb, $14, $15, $16, $17::date, $18::date
             )`,
            [
              item.workspace_id,
              item.brand_id,
              item.wiki_version_id,
              unit.sourceKind,
              unit.sourceId,
              unit.unitType,
              unit.stableKey,
              unit.title,
              unit.content,
              unit.contentHash,
              unit.keywords,
              unit.aliases,
              JSON.stringify(unit.structuredData),
              unit.sourceUrl,
              unit.destinationUrl,
              unit.sourceQuote,
              unit.validFrom,
              unit.validUntil,
            ],
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
        const collectionComplete = !remaining.rows[0].has_remaining;
        if (collectionComplete) {
          const unitCount = await client.query(
            `select count(*)::integer as count
             from wiki_source_units where wiki_version_id = $1::uuid`,
            [item.wiki_version_id],
          );
          if (Number(unitCount.rows[0].count) === 0) {
            await client.query(
              `update wiki_versions
               set status = 'failed', error_message = 'wiki_source_units_missing',
                   completed_at = now(), updated_at = now()
               where id = $1::uuid and status = 'building'`,
              [item.wiki_version_id],
            );
            await client.query(
              `update wiki_build_requests
               set status = 'failed', error_message = 'wiki_source_units_missing',
                   completed_at = now(), updated_at = now()
               where workspace_id = $1::uuid and brand_id = $2::uuid and status = 'building'`,
              [item.workspace_id, item.brand_id],
            );
          } else {
            await client.query(
              `with item_keys as (
                 select 'brand_core_pages'::text as item_type, 'brand-overview'::text as stable_key
                 union all select 'brand_core_pages', 'catalog'
                 union all
                 select distinct 'detail_page', unit.stable_key
                 from wiki_source_units unit
                 where unit.wiki_version_id = $1::uuid and unit.unit_type in ('product', 'service')
                   and (
                     unit.source_kind = 'product'
                     or (
                       unit.source_kind = 'owned_snapshot'
                       and unit.source_url is not null
                       and lower(unit.source_url) !~ '/(article|articles|blog|content|insight|insights|news|resource|resources)(/|\\?|#|$)'
                     )
                   )
                 union all
                 select distinct 'policy_page', unit.stable_key
                 from wiki_source_units unit
                 where unit.wiki_version_id = $1::uuid and unit.unit_type = 'policy'
                 union all
                 select distinct 'faq_guide_page', unit.stable_key
                 from wiki_source_units unit
                 where unit.wiki_version_id = $1::uuid
                   and unit.unit_type in ('faq', 'guide_section')
                 union all select 'validate', 'validate'
               )
               insert into wiki_compilation_items (
                 workspace_id, brand_id, wiki_version_id, item_type, stable_key,
                 idempotency_key, status
               )
               select $2::uuid, $3::uuid, $1::uuid, item_type, stable_key,
                      concat($1::text, ':', item_type, ':', stable_key), 'pending'
               from item_keys
               on conflict (wiki_version_id, item_type, stable_key) do nothing`,
              [item.wiki_version_id, item.workspace_id, item.brand_id],
            );
            await client.query(
              `update wiki_versions
               set build_stage = 'compiling', updated_at = now()
               where id = $1::uuid and status = 'building'`,
              [item.wiki_version_id],
            );
          }
        }
        await client.query("commit");
        return { collectionComplete };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async claimWikiCompilationItem(workerId: string) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          `update wiki_compilation_items
           set status = 'pending', lease_owner = null, lease_token = null,
               lease_expires_at = null, available_at = now(),
               error_message = 'wiki_compilation_lease_recovered', updated_at = now()
           where status = 'processing' and lease_expires_at < now()
             and attempt_count < max_attempts`,
        );
        const exhausted = await client.query(
          `update wiki_compilation_items
           set status = 'failed', lease_owner = null, lease_token = null,
               lease_expires_at = null, error_message = 'wiki_compilation_attempts_exhausted',
               completed_at = now(), updated_at = now()
           where status = 'processing' and lease_expires_at < now()
             and attempt_count >= max_attempts
           returning wiki_version_id`,
        );
        if (exhausted.rowCount) {
          await client.query(
            `update wiki_versions
             set status = 'failed', error_message = 'wiki_compilation_attempts_exhausted',
                 completed_at = now(), updated_at = now()
             where id = any($1::uuid[]) and status = 'building'`,
            [exhausted.rows.map((row) => row.wiki_version_id)],
          );
        }
        const dmBacklog = await client.query(
          `select exists(
             select 1 from jobs
             where job_type = 'instagram_dm_reply' and status = 'queued' and run_at <= now()
           ) as waiting`,
        );
        if (dmBacklog.rows[0].waiting) {
          await client.query("commit");
          return null;
        }
        const claimed = await client.query(
          `with candidate as (
             select item.id
             from wiki_compilation_items item
             join wiki_versions version on version.id = item.wiki_version_id
             where item.status = 'pending'
               and item.item_type <> 'validate'
               and item.available_at <= now()
               and item.attempt_count < item.max_attempts
               and version.status = 'building'
               and version.build_stage = 'compiling'
               and (
                 item.item_type <> 'brand_core_pages'
                 or not exists (
                   select 1 from wiki_compilation_items dependency
                   where dependency.wiki_version_id = item.wiki_version_id
                     and dependency.item_type in ('detail_page', 'policy_page', 'faq_guide_page')
                     and dependency.status <> 'succeeded'
                 )
               )
             order by
               case item.item_type
                 when 'detail_page' then 1
                 when 'policy_page' then 2
                 when 'faq_guide_page' then 3
                 else 4
               end,
               item.created_at,
               item.id
             for update of item skip locked
             limit 1
           )
           update wiki_compilation_items item
           set status = 'processing', attempt_count = attempt_count + 1,
               lease_owner = $1, lease_token = gen_random_uuid(),
               lease_expires_at = now() + interval '3 minutes',
               started_at = coalesce(started_at, now()), error_message = null,
               updated_at = now()
           from candidate
           where item.id = candidate.id
           returning item.id,
                     item.workspace_id as "workspaceId",
                     item.brand_id as "brandId",
                     item.wiki_version_id as "wikiVersionId",
                     item.item_type as "itemType",
                     item.stable_key as "stableKey",
                     item.lease_token::text as "leaseToken"`,
          [workerId],
        );
        await client.query("commit");
        return claimed.rowCount ? claimed.rows[0] as ClaimedWikiCompilationItem : null;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async getWikiCompilationGroup(item: ClaimedWikiCompilationItem) {
      const result = await pool.query(
        `select id, source_kind as "sourceKind", source_id as "sourceId",
                unit_type as "unitType", stable_key as "stableKey", title, content,
                content_hash as "contentHash", keywords, aliases,
                structured_data as "structuredData", source_url as "sourceUrl",
                destination_url as "destinationUrl", source_quote as "sourceQuote",
                valid_from::text as "validFrom", valid_until::text as "validUntil"
         from wiki_source_units
         where workspace_id = $1::uuid and brand_id = $2::uuid
           and wiki_version_id = $3::uuid
         order by stable_key, id`,
        [item.workspaceId, item.brandId, item.wikiVersionId],
      );
      const sourceUnits = result.rows as CompiledWikiSourceRecord[];
      const maintenance = await pool.query(
        `select result_json from wiki_maintenance_runs
         where workspace_id = $1::uuid and brand_id = $2::uuid and status = 'succeeded'
         order by completed_at asc, id asc`,
        [item.workspaceId, item.brandId],
      );
      const aliases = new Map<string, Set<string>>();
      const linkUpdates: Array<{ from: string; to: string }> = [];
      for (const row of maintenance.rows) {
        const output = row.result_json as Partial<WikiMaintenanceOutput>;
        for (const update of output.aliasUpdates ?? []) {
          const values = aliases.get(update.stableKey) ?? new Set<string>();
          update.aliases.forEach((alias) => values.add(alias));
          aliases.set(update.stableKey, values);
        }
        for (const update of output.linkUpdates ?? []) linkUpdates.push(update);
      }
      for (const unit of sourceUnits) {
        unit.aliases = [...new Set([...unit.aliases, ...(aliases.get(unit.stableKey) ?? [])])];
      }
      const groups = createWikiCompilationGroups(sourceUnits);
      for (const group of groups) {
        group.requiredLinkedStableKeys = [...new Set([
          ...group.requiredLinkedStableKeys,
          ...linkUpdates.filter((link) => link.from === group.stableKey).map((link) => link.to),
        ])].sort();
      }
      const group = groups.find((candidate) => candidate.stableKey === item.stableKey);
      if (!group) throw new Error("wiki_compilation_group_not_found");
      return group;
    },
    async completeWikiCompilationItem(item: ClaimedWikiCompilationItem, page: CompiledWikiPage) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const locked = await client.query(
          `select id from wiki_compilation_items
           where id = $1::uuid and wiki_version_id = $2::uuid
             and status = 'processing' and lease_token = $3::uuid
             and lease_expires_at > now()
           for update`,
          [item.id, item.wikiVersionId, item.leaseToken],
        );
        if (!locked.rowCount) throw new Error("wiki_compilation_lease_lost");
        const persisted = await client.query(
          `insert into wiki_pages (
             workspace_id, brand_id, wiki_version_id, page_type, stable_key,
             title, summary, content_markdown, content_json, structured_data,
             content_hash, prompt_version, source_count, is_core, is_active
           ) values (
             $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text,
             $6::text, $7::text, $8::text, $9::jsonb, $10::jsonb,
             md5(concat_ws(E'\\n', $4, $5, $6, $7, $8, $9)),
             $11::text, $12::integer, $13::boolean, false
           )
           on conflict (wiki_version_id, stable_key) do update
           set page_type = excluded.page_type, title = excluded.title,
               summary = excluded.summary, content_markdown = excluded.content_markdown,
               content_json = excluded.content_json, structured_data = excluded.structured_data,
               content_hash = excluded.content_hash, prompt_version = excluded.prompt_version,
               source_count = excluded.source_count, is_core = excluded.is_core,
               updated_at = now()
           returning id`,
          [
            item.workspaceId,
            item.brandId,
            item.wikiVersionId,
            page.pageType,
            page.stableKey,
            page.title,
            page.summary,
            page.contentMarkdown,
            JSON.stringify(page.contentJson),
            JSON.stringify({ links: page.links }),
            process.env.WIKI_COMPILER_PROMPT_VERSION?.trim() || "v1",
            new Set(page.sections.flatMap((section) => section.sourceUnitIds)).size,
            page.pageType === "brand_overview" || page.pageType === "catalog",
          ],
        );
        const pageId = persisted.rows[0].id as string;
        await client.query("delete from wiki_page_sources where wiki_page_id = $1::uuid", [pageId]);
        for (const section of page.sections) {
          await client.query(
            `insert into wiki_page_sources (
               workspace_id, brand_id, wiki_version_id, wiki_page_id,
               wiki_source_unit_id, section_key, source_kind, source_id,
               source_url, destination_url, source_quote
             )
             select $1::uuid, $2::uuid, $3::uuid, $4::uuid,
                    unit.id, $5, unit.source_kind, unit.source_id,
                    unit.source_url,
                    case when unit.id = $7::uuid then unit.destination_url else null end,
                    unit.source_quote
             from wiki_source_units unit
             where unit.workspace_id = $1::uuid and unit.brand_id = $2::uuid
               and unit.wiki_version_id = $3::uuid
               and unit.id = any($6::uuid[])`,
            [
              item.workspaceId,
              item.brandId,
              item.wikiVersionId,
              pageId,
              section.sectionKey,
              section.sourceUnitIds,
              section.destinationUrlId,
            ],
          );
        }
        await client.query(
          `update wiki_compilation_items
           set status = 'succeeded', result_json = $4::jsonb,
               lease_owner = null, lease_token = null, lease_expires_at = null,
               error_message = null, completed_at = now(), updated_at = now()
           where id = $1::uuid and wiki_version_id = $2::uuid and lease_token = $3::uuid`,
          [item.id, item.wikiVersionId, item.leaseToken, JSON.stringify({ pageId, links: page.links })],
        );
        const remaining = await client.query(
          `select exists(
             select 1 from wiki_compilation_items
             where wiki_version_id = $1::uuid and item_type <> 'validate'
               and status <> 'succeeded'
           ) as has_remaining`,
          [item.wikiVersionId],
        );
        if (!remaining.rows[0].has_remaining) {
          await client.query("delete from wiki_page_links where wiki_version_id = $1::uuid", [item.wikiVersionId]);
          await client.query(
            `insert into wiki_page_links (
               workspace_id, brand_id, wiki_version_id, from_page_id, to_page_id, relation
             )
             select $2::uuid, $3::uuid, $1::uuid, source_page.id, target_page.id,
                    link ->> 'relation'
             from wiki_compilation_items item
             join wiki_pages source_page
               on source_page.id = (item.result_json ->> 'pageId')::uuid
              and source_page.wiki_version_id = item.wiki_version_id
             cross join lateral jsonb_array_elements(item.result_json -> 'links') link
             join wiki_pages target_page
               on target_page.wiki_version_id = item.wiki_version_id
              and target_page.stable_key = link ->> 'targetStableKey'
             where item.wiki_version_id = $1::uuid and item.status = 'succeeded'
               and source_page.id <> target_page.id
             on conflict (wiki_version_id, from_page_id, to_page_id, relation) do nothing`,
            [item.wikiVersionId, item.workspaceId, item.brandId],
          );
          await client.query(
            `update wiki_versions set build_stage = 'embedding', updated_at = now()
             where id = $1::uuid and status = 'building'`,
            [item.wikiVersionId],
          );
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async failWikiCompilationItem(item: ClaimedWikiCompilationItem, error: string) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const failed = await client.query(
          `update wiki_compilation_items
           set status = case when attempt_count >= max_attempts then 'failed' else 'pending' end,
               available_at = case when attempt_count >= max_attempts
                 then available_at else now() + make_interval(secs => least(300, attempt_count * 30)) end,
               lease_owner = null, lease_token = null, lease_expires_at = null,
               error_message = $4,
               completed_at = case when attempt_count >= max_attempts then now() else null end,
               updated_at = now()
           where id = $1::uuid and wiki_version_id = $2::uuid
             and status = 'processing' and lease_token = $3::uuid
           returning status`,
          [item.id, item.wikiVersionId, item.leaseToken, error.slice(0, 2000)],
        );
        if (failed.rows[0]?.status === "failed") {
          await client.query(
            `update wiki_versions
             set status = 'failed', error_message = $2, completed_at = now(), updated_at = now()
             where id = $1::uuid and status = 'building'`,
            [item.wikiVersionId, error.slice(0, 2000)],
          );
          await client.query(
            `update wiki_build_requests
             set status = 'failed', error_message = $3, completed_at = now(), updated_at = now()
             where workspace_id = $1::uuid and brand_id = $2::uuid and status = 'building'`,
            [item.workspaceId, item.brandId, error.slice(0, 2000)],
          );
        }
        await client.query("commit");
      } catch (failure) {
        await client.query("rollback");
        throw failure;
      } finally {
        client.release();
      }
    },
    async claimWikiValidationItem(workerId: string) {
      const claimed = await pool.query(
        `with candidate as (
           select item.id
           from wiki_compilation_items item
           join wiki_versions version on version.id = item.wiki_version_id
           where item.item_type = 'validate'
             and item.status = 'pending'
             and item.available_at <= now()
             and item.attempt_count < item.max_attempts
             and version.status = 'building'
             and version.build_stage = 'embedding'
             and not exists (
               select 1 from wiki_compilation_items dependency
               where dependency.wiki_version_id = item.wiki_version_id
                 and dependency.item_type <> 'validate'
                 and dependency.status <> 'succeeded'
             )
             and not exists (
               select 1 from jobs
               where job_type = 'instagram_dm_reply' and status = 'queued' and run_at <= now()
             )
           order by item.created_at, item.id
           for update of item skip locked
           limit 1
         )
         update wiki_compilation_items item
         set status = 'processing', attempt_count = attempt_count + 1,
             lease_owner = $1, lease_token = gen_random_uuid(),
             lease_expires_at = now() + interval '15 minutes',
             started_at = coalesce(started_at, now()), error_message = null,
             updated_at = now()
         from candidate
         where item.id = candidate.id
         returning item.id,
                   item.workspace_id as "workspaceId",
                   item.brand_id as "brandId",
                   item.wiki_version_id as "wikiVersionId",
                   item.lease_token::text as "leaseToken"`,
        [workerId],
      );
      return claimed.rowCount ? claimed.rows[0] as ClaimedWikiValidationItem : null;
    },
    async getWikiPagesForFinalization(item: ClaimedWikiValidationItem) {
      const result = await pool.query(
        `select page.id, page.page_type as "pageType", page.stable_key as "stableKey", page.title, page.summary,
                 content_markdown as "contentMarkdown", content_hash as "contentHash",
                 coalesce(prompt_version, '') as "promptVersion",
                 case when page.page_type not in ('product', 'service') then true else exists (
                   select 1 from wiki_page_sources source
                   where source.wiki_page_id = page.id
                     and (
                       source.source_kind = 'product'
                       or (
                         source.source_kind = 'owned_snapshot'
                         and source.source_url is not null
                         and lower(source.source_url) !~ '/(article|articles|blog|content|insight|insights|news|resource|resources)(/|\\?|#|$)'
                       )
                     )
                 ) end as "brandCoreEligible"
         from wiki_pages page
         where page.workspace_id = $1::uuid and page.brand_id = $2::uuid
           and page.wiki_version_id = $3::uuid
         order by is_core desc, page_type, stable_key`,
        [item.workspaceId, item.brandId, item.wikiVersionId],
      );
      return result.rows as WikiPageForFinalization[];
    },
    async getReusablePageEmbeddings(
      brandId: string,
      contentHashes: string[],
      embeddingModel: string,
      embeddingVersion: string,
      promptVersion: string,
    ) {
      if (!contentHashes.length) return [];
      const result = await pool.query(
        `select distinct on (chunk.content_hash)
                chunk.content_hash as "contentHash", chunk.embedding::text as embedding
         from wiki_page_chunks chunk
         join wiki_pages page on page.id = chunk.wiki_page_id
         where chunk.brand_id = $1::uuid and chunk.enabled and chunk.embedding is not null
           and chunk.content_hash = any($2::text[])
           and chunk.embedding_model = $3 and chunk.embedding_version = $4
           and coalesce(page.prompt_version, '') = $5
         order by chunk.content_hash, chunk.updated_at desc`,
        [brandId, contentHashes, embeddingModel, embeddingVersion, promptVersion],
      );
      return result.rows.map((row) => ({
        contentHash: row.contentHash as string,
        embedding: String(row.embedding)
          .replace(/^\[/, "").replace(/\]$/, "")
          .split(",").map(Number),
      }));
    },
    async completeWikiValidationItem(
      item: ClaimedWikiValidationItem,
      chunks: FinalizedWikiChunk[],
      brandCore: string,
    ) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const locked = await client.query(
          `select id from wiki_compilation_items
           where id = $1::uuid and wiki_version_id = $2::uuid
             and item_type = 'validate' and status = 'processing'
             and lease_token = $3::uuid and lease_expires_at > now()
           for update`,
          [item.id, item.wikiVersionId, item.leaseToken],
        );
        if (!locked.rowCount) throw new Error("wiki_validation_lease_lost");
        await client.query(
          `update wiki_versions set build_stage = 'validating', updated_at = now()
           where id = $1::uuid and status = 'building'`,
          [item.wikiVersionId],
        );
        await client.query("delete from wiki_page_chunks where wiki_version_id = $1::uuid", [item.wikiVersionId]);
        for (const chunk of chunks) {
          if (chunk.embedding.length !== 1536 || chunk.embedding.some((value) => !Number.isFinite(value))) {
            throw new Error("wiki_embedding_invalid");
          }
          await client.query(
            `insert into wiki_page_chunks (
               workspace_id, brand_id, wiki_version_id, wiki_page_id, chunk_index,
               content, content_hash, embedding, embedding_model, embedding_version, enabled
             ) values (
               $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
               $6, $7, $8::vector, $9, $10, true
             )`,
            [
              item.workspaceId,
              item.brandId,
              item.wikiVersionId,
              chunk.pageId,
              chunk.chunkIndex,
              chunk.content,
              chunk.contentHash,
              `[${chunk.embedding.join(",")}]`,
              chunk.embeddingModel,
              chunk.embeddingVersion,
            ],
          );
        }
        await client.query(
          `update wiki_pages
           set structured_data = structured_data || jsonb_build_object('brandCore', $2::text),
               updated_at = now()
           where wiki_version_id = $1::uuid and page_type = 'brand_overview'`,
          [item.wikiVersionId, brandCore],
        );
        const validation = await client.query(
          `select
             exists(select 1 from wiki_pages where wiki_version_id = $1::uuid and page_type = 'brand_overview') as has_overview,
             exists(select 1 from wiki_pages where wiki_version_id = $1::uuid and page_type = 'catalog') as has_catalog,
             exists(
               select 1 from wiki_pages page
               where page.wiki_version_id = $1::uuid
                 and (jsonb_array_length(page.content_json -> 'sections') = 0
                   or not exists (select 1 from wiki_page_sources source where source.wiki_page_id = page.id)
                   or not exists (select 1 from wiki_page_chunks chunk where chunk.wiki_page_id = page.id and chunk.enabled and chunk.embedding is not null))
             ) as has_incomplete_page,
             exists(
               select 1 from wiki_pages offering
               where offering.wiki_version_id = $1::uuid
                 and offering.page_type in ('product', 'service')
                 and not exists (
                   select 1 from wiki_pages catalog
                   join wiki_page_links link on link.from_page_id = catalog.id and link.to_page_id = offering.id
                   where catalog.wiki_version_id = $1::uuid and catalog.page_type = 'catalog'
                 )
             ) as has_unlinked_offering`,
          [item.wikiVersionId],
        );
        const state = validation.rows[0];
        if (!state.has_overview) throw new Error("wiki_brand_overview_missing");
        if (!state.has_catalog) throw new Error("wiki_catalog_missing");
        if (state.has_incomplete_page) throw new Error("wiki_page_validation_failed");
        if (state.has_unlinked_offering) throw new Error("wiki_catalog_item_missing");
        await client.query(
          `update wiki_compilation_items
           set status = 'succeeded', result_json = jsonb_build_object('chunkCount', $4::integer),
               lease_owner = null, lease_token = null, lease_expires_at = null,
               error_message = null, completed_at = now(), updated_at = now()
           where id = $1::uuid and wiki_version_id = $2::uuid and lease_token = $3::uuid`,
          [item.id, item.wikiVersionId, item.leaseToken, chunks.length],
        );
        await client.query(
          `update wiki_versions
           set status = 'ready', build_stage = null, error_message = null,
               source_count = (select count(*)::integer from wiki_source_units where wiki_version_id = $1::uuid),
               document_count = (select count(*)::integer from wiki_pages where wiki_version_id = $1::uuid),
               chunk_count = (select count(*)::integer from wiki_page_chunks where wiki_version_id = $1::uuid and enabled),
               completed_at = now(), updated_at = now()
           where id = $1::uuid and status = 'building'`,
          [item.wikiVersionId],
        );
        await client.query(
          `update wiki_build_requests
           set status = case
                 when requested_revision > coalesce(building_revision, 0) or rebuild_requested then 'pending'
                 else 'succeeded'
               end,
               quiet_until = case
                 when requested_revision > coalesce(building_revision, 0) or rebuild_requested
                   then now() + interval '2 minutes'
                 else quiet_until
               end,
               building_revision = null, rebuild_requested = false,
               completed_at = case
                 when requested_revision > coalesce(building_revision, 0) or rebuild_requested then null
                 else now()
               end,
               error_message = null, updated_at = now()
           where workspace_id = $1::uuid and brand_id = $2::uuid and status = 'building'`,
          [item.workspaceId, item.brandId],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async failWikiValidationItem(item: ClaimedWikiValidationItem, error: string) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          `update wiki_compilation_items
           set status = 'failed', lease_owner = null, lease_token = null,
               lease_expires_at = null, error_message = $4,
               completed_at = now(), updated_at = now()
           where id = $1::uuid and wiki_version_id = $2::uuid
             and status = 'processing' and lease_token = $3::uuid`,
          [item.id, item.wikiVersionId, item.leaseToken, error.slice(0, 2000)],
        );
        await client.query(
          `update wiki_versions
           set status = 'failed', error_message = $2, completed_at = now(), updated_at = now()
           where id = $1::uuid and status = 'building'`,
          [item.wikiVersionId, error.slice(0, 2000)],
        );
        await client.query(
          `update wiki_build_requests
           set status = 'failed', error_message = $3, completed_at = now(), updated_at = now()
           where workspace_id = $1::uuid and brand_id = $2::uuid and status = 'building'`,
          [item.workspaceId, item.brandId, error.slice(0, 2000)],
        );
        await client.query("commit");
      } catch (failure) {
        await client.query("rollback");
        throw failure;
      } finally {
        client.release();
      }
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
          `update wiki_build_requests
           set status = 'failed', error_message = $3, completed_at = now(), updated_at = now()
           where workspace_id = $1::uuid and brand_id = $2::uuid and status = 'building'`,
          [item.workspace_id, item.brand_id, error.slice(0, 2000)],
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
    async searchCompiledWiki(workspaceId: string, brandId: string, question: string, embedding: number[]) {
      const version = await pool.query(
        `select version.id,
                coalesce(overview.structured_data ->> 'brandCore', overview.summary, '') as brand_core
         from wiki_versions version
         join wiki_pages overview
           on overview.wiki_version_id = version.id and overview.page_type = 'brand_overview'
         where version.workspace_id = $1::uuid and version.brand_id = $2::uuid
           and version.status = 'active'
         order by version.activated_at desc nulls last
         limit 1`,
        [workspaceId, brandId],
      );
      if (!version.rowCount) return null;
      const wikiVersionId = version.rows[0].id as string;
      const vector = `[${embedding.join(",")}]`;
      const result = isOfferingQuestion(question)
        ? await pool.query(
          `select chunk.id as page_chunk_id, page.id as wiki_page_id,
                  page.page_type, page.title, chunk.content,
                  coalesce((
                    select array_agg(source.id order by source.id::text)
                    from wiki_page_sources source
                    where source.wiki_page_id = page.id
                      and source.workspace_id = $1::uuid and source.brand_id = $2::uuid
                      and source.wiki_version_id = $3::uuid
                  ), '{}'::uuid[]) as source_link_ids,
                  (1 - (chunk.embedding <=> $4::vector))::double precision as cosine_similarity,
                  ts_rank_cd(chunk.search_vector, websearch_to_tsquery('simple', coalesce($5::text, '')))::double precision as keyword_match,
                  (1 - (chunk.embedding <=> $4::vector))::double precision as rrf_score
           from wiki_page_chunks chunk
           join wiki_pages page on page.id = chunk.wiki_page_id
           where chunk.workspace_id = $1::uuid and chunk.brand_id = $2::uuid
             and chunk.wiki_version_id = $3::uuid and chunk.enabled and chunk.embedding is not null
             and page.page_type in ('product', 'service')
             and exists (
               select 1 from wiki_page_sources source
               where source.wiki_page_id = page.id
                 and (
                   source.source_kind = 'product'
                   or (
                     source.source_kind = 'owned_snapshot'
                     and source.source_url is not null
                     and lower(source.source_url) !~ '/(article|articles|blog|content|insight|insights|news|resource|resources)(/|\\?|#|$)'
                   )
                 )
             )
           order by
             case when $7::boolean and exists (
               select 1 from wiki_page_sources source
               where source.wiki_page_id = page.id and source.source_kind = 'product'
             ) then 0 else 1 end,
             case when $6::boolean then coalesce((
               select min(length(source.destination_url))
               from wiki_page_sources source
               where source.wiki_page_id = page.id and source.destination_url is not null
             ), 2147483647) else 0 end,
             chunk.embedding <=> $4::vector, page.stable_key, chunk.chunk_index
           limit 3`,
          [
            workspaceId, brandId, wikiVersionId, vector, question,
            isOfferingLocationQuestion(question), isProductQuestion(question),
          ],
        )
        : await pool.query(
          `select * from search_brand_compiled_wiki(
             $1::uuid, $2::uuid, $3::uuid, $4::vector, $5, 3
           )`,
          [workspaceId, brandId, wikiVersionId, vector, question],
        );
      const sourceIds = [...new Set(result.rows.flatMap((row) => row.source_link_ids as string[]))];
      const destinationResult = sourceIds.length
        ? await pool.query(
          `select source.id, coalesce(page.title, unit.title) as label, source.destination_url as url
           from wiki_page_sources source
           join wiki_pages page on page.id = source.wiki_page_id
           join wiki_source_units unit on unit.id = source.wiki_source_unit_id
           where source.workspace_id = $1::uuid and source.brand_id = $2::uuid
             and source.wiki_version_id = $3::uuid
             and source.id = any($4::uuid[])
             and source.destination_url is not null
           order by page.is_core desc, page.title, source.id`,
          [workspaceId, brandId, wikiVersionId, sourceIds],
        )
        : { rows: [] };
      return {
        wikiVersionId,
        brandCore: String(version.rows[0].brand_core ?? ""),
        chunks: result.rows.map((row) => ({
          chunkId: row.page_chunk_id,
          pageId: row.wiki_page_id,
          pageType: row.page_type,
          title: row.title,
          content: row.content,
          cosineSimilarity: Number(row.cosine_similarity),
          keywordMatch: Number(row.keyword_match),
          rrfScore: Number(row.rrf_score),
        })),
        destinationUrls: destinationResult.rows.map((row) => ({
          id: row.id,
          label: row.label,
          url: row.url,
        })),
      } satisfies CompiledWikiSearchPacket;
    },
    async recordCompiledWikiRetrieval(input: {
      workspaceId: string;
      brandId: string;
      question: string;
      packet: CompiledWikiSearchPacket | null;
      result: import("./worker.js").DmWorkerResult;
      retrievalLatencyMs: number;
      totalLatencyMs: number;
    }) {
      const usedChunks = new Set(input.result.wikiChunkIds);
      const usedPages = input.packet?.chunks
        .filter((chunk) => usedChunks.has(chunk.chunkId))
        .map((chunk) => chunk.pageId) ?? [];
      await pool.query(
        `insert into wiki_retrieval_runs (
           workspace_id, brand_id, wiki_version_id, question,
           selected_page_ids, selected_chunk_ids, selected_scores,
           used_page_ids, used_destination_url_ids, route, reason_code,
           retrieval_latency_ms, total_latency_ms
         ) values (
           $1::uuid, $2::uuid, $3::uuid, $4,
           $5::uuid[], $6::uuid[], $7::jsonb,
           $8::uuid[], $9::uuid[], $10, $11,
           $12, $13
         )`,
        [
          input.workspaceId,
          input.brandId,
          input.packet?.wikiVersionId ?? null,
          input.question,
          input.packet?.chunks.map((chunk) => chunk.pageId) ?? [],
          input.packet?.chunks.map((chunk) => chunk.chunkId) ?? [],
          JSON.stringify(input.packet?.chunks.map((chunk) => ({
            chunkId: chunk.chunkId,
            cosineSimilarity: chunk.cosineSimilarity,
            keywordMatch: chunk.keywordMatch,
            rrfScore: chunk.rrfScore,
          })) ?? []),
          [...new Set(usedPages)],
          input.result.destinationUrlIds ?? [],
          input.result.reasonCode === "direct_faq" ? "direct_faq"
            : input.result.decision === "answer" ? "wiki_answer" : "fallback",
          input.result.reasonCode,
          Math.max(0, input.retrievalLatencyMs),
          Math.max(0, input.totalLatencyMs),
        ],
      );
    },
    async claimWikiMaintenance() {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          `update wiki_maintenance_runs
           set status = 'failed', error_message = 'wiki_maintenance_timeout',
               completed_at = now(), updated_at = now()
           where status = 'processing' and started_at < now() - interval '15 minutes'`,
        );
        const run = await client.query(
          `with eligible as (
             select version.workspace_id, version.brand_id, version.id as wiki_version_id,
                    count(*)::integer as question_count
             from wiki_versions version
             join wiki_retrieval_runs retrieval
               on retrieval.workspace_id = version.workspace_id
              and retrieval.brand_id = version.brand_id
              and retrieval.created_at > greatest(
                coalesce(version.activated_at, version.created_at),
                coalesce((
                  select max(previous.created_at)
                  from wiki_maintenance_runs previous
                  where previous.workspace_id = version.workspace_id
                    and previous.brand_id = version.brand_id
                    and previous.status in ('succeeded', 'failed')
                ), '-infinity'::timestamptz)
              )
             where version.status = 'active'
               and retrieval.reason_code in ('knowledge_gap', 'low_confidence')
               and ($1::boolean or extract(hour from now() at time zone 'Asia/Seoul') = 3)
               and not exists (
                 select 1 from wiki_maintenance_runs existing
                 where existing.workspace_id = version.workspace_id
                   and existing.brand_id = version.brand_id
                   and existing.status in ('pending', 'processing')
               )
               and not exists (
                 select 1 from wiki_maintenance_runs completed
                 where completed.workspace_id = version.workspace_id
                   and completed.brand_id = version.brand_id
                   and completed.created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
               )
             group by version.workspace_id, version.brand_id, version.id
             having count(*) >= 5
           ), candidate as (
             select eligible.*
             from eligible
             join wiki_versions version on version.id = eligible.wiki_version_id
             order by eligible.question_count desc, version.brand_id
             for update of version skip locked
             limit 1
           )
           insert into wiki_maintenance_runs (
             workspace_id, brand_id, source_wiki_version_id, status,
             target_question_count, started_at
           )
           select workspace_id, brand_id, wiki_version_id, 'processing', question_count, now()
           from candidate
           returning id, workspace_id, brand_id, source_wiki_version_id`,
          [process.env.WIKI_MAINTENANCE_FORCE?.trim().toLowerCase() === "true"],
        );
        if (!run.rowCount) {
          await client.query("commit");
          return null;
        }
        const row = run.rows[0];
        const questions = await client.query(
          `select distinct question
           from wiki_retrieval_runs
           where workspace_id = $1::uuid and brand_id = $2::uuid
             and reason_code in ('knowledge_gap', 'low_confidence')
           order by question limit 20`,
          [row.workspace_id, row.brand_id],
        );
        const pages = await client.query(
          `select stable_key from wiki_pages
           where wiki_version_id = $1::uuid order by stable_key`,
          [row.source_wiki_version_id],
        );
        const units = await client.query(
          `select stable_key as "stableKey", title, left(content, 2000) as content
           from wiki_source_units where wiki_version_id = $1::uuid
           order by stable_key, id limit 200`,
          [row.source_wiki_version_id],
        );
        await client.query("commit");
        return {
          runId: row.id,
          workspaceId: row.workspace_id,
          brandId: row.brand_id,
          wikiVersionId: row.source_wiki_version_id,
          questions: questions.rows.map((entry) => entry.question),
          stableKeys: pages.rows.map((entry) => entry.stable_key),
          sourceUnits: units.rows,
        } satisfies WikiMaintenanceContext;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async completeWikiMaintenance(context: WikiMaintenanceContext, output: WikiMaintenanceOutput) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        for (const issue of output.missingKnowledge) {
          await client.query(
            `insert into wiki_issues (
               workspace_id, brand_id, wiki_version_id, issue_type, severity,
               status, question, detail_json
             ) values ($1::uuid, $2::uuid, $3::uuid, 'knowledge_gap', 'warning', 'open', $4, $5::jsonb)`,
            [context.workspaceId, context.brandId, context.wikiVersionId, issue.question, JSON.stringify({ reason: issue.reason })],
          );
        }
        const changedStableKeys = [...new Set([
          ...output.aliasUpdates.map((entry) => entry.stableKey),
          ...output.linkUpdates.flatMap((entry) => [entry.from, entry.to]),
          ...output.regenerateStableKeys,
        ])];
        await client.query(
          `update wiki_maintenance_runs
           set status = 'succeeded', changed_stable_keys = $2::text[],
               issue_count = $3, result_json = $4::jsonb,
               completed_at = now(), updated_at = now()
           where id = $1::uuid and status = 'processing'`,
          [context.runId, changedStableKeys, output.missingKnowledge.length, JSON.stringify(output)],
        );
        if (changedStableKeys.length) {
          await client.query(
            `insert into wiki_build_requests (
               workspace_id, brand_id, requested_revision, status, quiet_until
             ) values ($1::uuid, $2::uuid, 1, 'pending', now())
             on conflict (workspace_id, brand_id)
             where status in ('pending', 'building')
             do update set requested_revision = wiki_build_requests.requested_revision + 1,
               rebuild_requested = wiki_build_requests.rebuild_requested or wiki_build_requests.status = 'building',
               quiet_until = now(), updated_at = now()`,
            [context.workspaceId, context.brandId],
          );
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async failWikiMaintenance(context: WikiMaintenanceContext, error: string) {
      await pool.query(
        `update wiki_maintenance_runs
         set status = 'failed', error_message = $2, completed_at = now(), updated_at = now()
         where id = $1::uuid and status = 'processing'`,
        [context.runId, error.slice(0, 2000)],
      );
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
