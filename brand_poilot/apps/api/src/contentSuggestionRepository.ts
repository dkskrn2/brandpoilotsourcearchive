import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  CONTENT_SUGGESTION_PUBLISH_RESULT_VERSION,
  CONTENT_SUGGESTION_SCOPE_VERSION,
  parseContentSuggestionBatch,
  parseContentSuggestionCategoryCode,
  type ContentSuggestionBatchInput,
  type ContentSuggestionItemDto,
  type ContentSuggestionListDto,
  type ContentSuggestionPublishResultDto,
  type ContentSuggestionScopeDto,
} from "./contentSuggestionContracts.js";
import { kstDateKey } from "./publishSchedule.js";

export interface ContentSuggestionRepository {
  getScope(categoryCode: string, now?: Date): Promise<ContentSuggestionScopeDto>;
  publish(input: ContentSuggestionBatchInput, now?: Date): Promise<ContentSuggestionPublishResultDto>;
  listForBrand(brandId: string): Promise<ContentSuggestionListDto>;
  getForBrand(brandId: string, suggestionId: string): Promise<ContentSuggestionItemDto | null>;
}

type CategoryRow = { id: string; code: string; name: string };
type SubcategoryRow = { id: string; code: string; name: string; sort_order: number };

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const value = await action(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function canonicalPayload(input: ContentSuggestionBatchInput): ContentSuggestionBatchInput {
  return {
    ...input,
    items: [...input.items]
      .map((item) => ({
        ...item,
        sources: [...item.sources].sort((left, right) => (
          left.url.localeCompare(right.url)
          || left.title.localeCompare(right.title)
          || left.publisher.localeCompare(right.publisher)
          || String(left.publishedAt).localeCompare(String(right.publishedAt))
        )),
      }))
      .sort((left, right) => (
        left.subcategoryCode.localeCompare(right.subcategoryCode)
        || left.intent.localeCompare(right.intent)
        || left.position - right.position
      )),
  };
}

function payloadHash(input: ContentSuggestionBatchInput): string {
  return createHash("sha256").update(JSON.stringify(canonicalPayload(input))).digest("hex");
}

function itemDto(row: Record<string, unknown>): ContentSuggestionItemDto {
  return {
    id: String(row.id),
    subcategoryCode: String(row.subcategory_code),
    subcategoryName: String(row.subcategory_name),
    intent: row.intent === "trend" ? "trend" : "informational",
    title: String(row.title),
    whyNow: String(row.why_now),
    contentBrief: String(row.content_brief),
  };
}

function emptyList(category: ContentSuggestionListDto["category"] = null): ContentSuggestionListDto {
  return { category, personal: [], general: [] };
}

export function createContentSuggestionRepository(pool: Pool): ContentSuggestionRepository {
  return {
    async getScope(categoryCodeInput, now = new Date()) {
      const categoryCode = parseContentSuggestionCategoryCode(categoryCodeInput);
      const categoryResult = await pool.query(
        `select id, code, name
           from content_categories
          where code = $1 and active = true`,
        [categoryCode],
      );
      if (!categoryResult.rowCount) throw new Error("content_suggestion_category_unavailable");
      const category = categoryResult.rows[0] as CategoryRow;
      const subcategories = await pool.query(
        `select id, code, name, sort_order
           from content_subcategories
          where category_id = $1::uuid and active = true
          order by sort_order, code`,
        [category.id],
      );
      return {
        contractVersion: CONTENT_SUGGESTION_SCOPE_VERSION,
        generationDate: kstDateKey(now),
        timezone: "Asia/Seoul",
        category: { code: category.code, name: category.name },
        subcategories: subcategories.rows.map((row) => ({
          code: String(row.code),
          name: String(row.name),
        })),
        intents: ["informational", "trend"],
        maxItemsPerSubcategoryIntent: 2,
        maxSourcesPerItem: 3,
      };
    },

    async publish(rawInput, now = new Date()) {
      const input = parseContentSuggestionBatch(rawInput);
      if (input.generationDate !== kstDateKey(now)) {
        throw new Error("content_suggestion_generation_date_mismatch");
      }
      const hash = payloadHash(input);
      const runKey = `${input.categoryCode}:${input.generationDate}`;
      return transaction(pool, async (client) => {
        const categoryResult = await client.query(
          `select id, code, name
             from content_categories
            where code = $1 and active = true
            for share`,
          [input.categoryCode],
        );
        if (!categoryResult.rowCount) throw new Error("content_suggestion_category_unavailable");
        const category = categoryResult.rows[0] as CategoryRow;
        const subcategoryResult = await client.query(
          `select id, code, name, sort_order
             from content_subcategories
            where category_id = $1::uuid and active = true
            order by sort_order, code
            for share`,
          [category.id],
        );
        const subcategories = new Map(
          subcategoryResult.rows.map((row) => [String(row.code), row as SubcategoryRow]),
        );
        for (const item of input.items) {
          if (!subcategories.has(item.subcategoryCode)) {
            throw new Error("content_suggestion_subcategory_unavailable");
          }
        }

        await client.query("select pg_advisory_xact_lock(hashtext($1))", [runKey]);
        const existing = await client.query(
          `select id, payload_hash, item_count
             from content_suggestion_batches
            where category_id = $1::uuid and generation_date = $2::date
            for update`,
          [category.id, input.generationDate],
        );
        if (existing.rowCount && String(existing.rows[0].payload_hash) === hash) {
          return {
            contractVersion: CONTENT_SUGGESTION_PUBLISH_RESULT_VERSION,
            status: "published",
            batchId: String(existing.rows[0].id),
            savedCount: Number(existing.rows[0].item_count),
            generationDate: input.generationDate,
          };
        }

        const batchResult = await client.query(
          `insert into content_suggestion_batches (
             category_id, generation_date, timezone, run_key, payload_hash,
             item_count, published_at
           ) values ($1::uuid, $2::date, 'Asia/Seoul', $3, $4, $5, now())
           on conflict (category_id, generation_date) do update
             set run_key = excluded.run_key,
                 payload_hash = excluded.payload_hash,
                 item_count = excluded.item_count,
                 published_at = now(),
                 updated_at = now()
           returning id`,
          [category.id, input.generationDate, runKey, hash, input.items.length],
        );
        const batchId = String(batchResult.rows[0].id);
        const retainedIds: string[] = [];
        for (const item of input.items) {
          const subcategory = subcategories.get(item.subcategoryCode)!;
          const saved = await client.query(
            `insert into content_suggestions (
               batch_id, category_id, subcategory_id, intent, position,
               title, why_now, content_brief, sources_json
             ) values (
               $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::jsonb
             )
             on conflict (batch_id, subcategory_id, intent, position) do update
               set title = excluded.title,
                   why_now = excluded.why_now,
                   content_brief = excluded.content_brief,
                   sources_json = excluded.sources_json,
                   updated_at = now()
             returning id`,
            [
              batchId,
              category.id,
              subcategory.id,
              item.intent,
              item.position,
              item.title,
              item.whyNow,
              item.contentBrief,
              JSON.stringify(item.sources),
            ],
          );
          retainedIds.push(String(saved.rows[0].id));
        }
        await client.query(
          `delete from content_suggestions
            where batch_id = $1::uuid and not (id = any($2::uuid[]))`,
          [batchId, retainedIds],
        );
        await client.query(
          `update content_suggestion_batches
              set payload_hash = $2, item_count = $3, published_at = now(), updated_at = now()
            where id = $1::uuid`,
          [batchId, hash, retainedIds.length],
        );
        return {
          contractVersion: CONTENT_SUGGESTION_PUBLISH_RESULT_VERSION,
          status: "published",
          batchId,
          savedCount: retainedIds.length,
          generationDate: input.generationDate,
        };
      });
    },

    async listForBrand(brandId) {
      const categoryResult = await pool.query(
        `select category.id, category.code, category.name
           from brand_profiles profile
           join content_categories category
             on category.id = profile.primary_category_id and category.active = true
          where profile.brand_id = $1::uuid
          order by profile.updated_at desc
          limit 1`,
        [brandId],
      );
      if (!categoryResult.rowCount) return emptyList();
      const category = categoryResult.rows[0] as CategoryRow;
      const categoryDto = { code: category.code, name: category.name };
      const batchResult = await pool.query(
        `select id
           from content_suggestion_batches
          where category_id = $1::uuid
          order by generation_date desc, published_at desc, id desc
          limit 1`,
        [category.id],
      );
      if (!batchResult.rowCount) return emptyList(categoryDto);
      const suggestions = await pool.query(
        `select suggestion.id, subcategory.code as subcategory_code,
                subcategory.name as subcategory_name,
                subcategory.sort_order as subcategory_sort_order,
                suggestion.intent, suggestion.position, suggestion.title,
                suggestion.why_now, suggestion.content_brief,
                exists (
                  select 1
                    from brand_profile_subcategories selected
                   where selected.brand_profile_id = profile.id
                     and selected.subcategory_id = suggestion.subcategory_id
                ) as selected
           from content_suggestions suggestion
           join content_subcategories subcategory
             on subcategory.id = suggestion.subcategory_id and subcategory.active = true
           join brand_profiles profile
             on profile.brand_id = $2::uuid and profile.primary_category_id = suggestion.category_id
          where suggestion.batch_id = $1::uuid
          order by subcategory.sort_order,
                   suggestion.position,
                   case suggestion.intent when 'informational' then 0 else 1 end,
                   suggestion.id`,
        [batchResult.rows[0].id, brandId],
      );
      const rows = suggestions.rows as Array<Record<string, unknown>>;
      const personalRows = rows.filter((row) => row.selected === true).slice(0, 6);
      const personalIds = new Set(personalRows.map((row) => String(row.id)));
      return {
        category: categoryDto,
        personal: personalRows.map(itemDto),
        general: rows.filter((row) => !personalIds.has(String(row.id))).map(itemDto),
      };
    },

    async getForBrand(brandId, suggestionId) {
      const result = await pool.query(
        `select suggestion.id, subcategory.code as subcategory_code,
                subcategory.name as subcategory_name, suggestion.intent,
                suggestion.title, suggestion.why_now, suggestion.content_brief
           from content_suggestions suggestion
           join content_suggestion_batches batch on batch.id = suggestion.batch_id
           join content_subcategories subcategory
             on subcategory.id = suggestion.subcategory_id and subcategory.active = true
           join brand_profiles profile
             on profile.brand_id = $2::uuid
            and profile.primary_category_id = batch.category_id
          where suggestion.id = $1::uuid
          order by profile.updated_at desc
          limit 1`,
        [suggestionId, brandId],
      );
      return result.rowCount ? itemDto(result.rows[0] as Record<string, unknown>) : null;
    },
  };
}
