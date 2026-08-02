import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { BrandScope } from "./brandCoreRepository.js";
import type {
  FaqSuggestionEvidenceDto,
  FaqSuggestionItemDto,
  FaqSuggestionItemUpdate,
  FaqSuggestionReviewAction,
  FaqSuggestionRunDto,
  FaqSuggestionSourceType,
} from "./faqSuggestionContracts.js";
import type { WikiManagementItem } from "./wikiManagementContracts.js";

export type BrandActorScope = BrandScope & { actorUserId: string };

export interface FaqSuggestionRepository {
  createFaqSuggestionRun(input: BrandActorScope): Promise<{
    run: FaqSuggestionRunDto;
    created: boolean;
  }>;
  getLatestFaqSuggestionRun(input: BrandScope): Promise<FaqSuggestionRunDto | null>;
  getFaqSuggestionRun(input: BrandScope & { runId: string }): Promise<FaqSuggestionRunDto | null>;
  updateFaqSuggestionItem(input: BrandActorScope & {
    runId: string;
    itemId: string;
  } & FaqSuggestionItemUpdate): Promise<FaqSuggestionItemDto>;
  approveFaqSuggestionItem(input: BrandActorScope & {
    runId: string;
    itemId: string;
  } & FaqSuggestionReviewAction): Promise<{
    item: FaqSuggestionItemDto;
    wikiItem: WikiManagementItem | null;
  }>;
  dismissFaqSuggestionItem(input: BrandActorScope & {
    runId: string;
    itemId: string;
  } & FaqSuggestionReviewAction): Promise<FaqSuggestionItemDto>;
}

interface SourceDescriptor {
  sourceType: FaqSuggestionSourceType;
  sourceId: string;
  contentHash: string;
  label: string;
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function iso(value: unknown): string {
  return new Date(value as string | number | Date).toISOString();
}

function nullableIso(value: unknown): string | null {
  return value ? iso(value) : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function hash(value: unknown): string {
  return crypto.createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function itemDto(row: Record<string, unknown>): FaqSuggestionItemDto {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    runId: String(row.run_id),
    position: Number(row.position),
    category: row.category as FaqSuggestionItemDto["category"],
    question: String(row.question),
    answer: String(row.answer),
    evidence: json<FaqSuggestionEvidenceDto[]>(row.evidence_json),
    confidence: Number(row.confidence),
    status: row.status as FaqSuggestionItemDto["status"],
    duplicateOfKnowledgeEntryId: row.duplicate_of_knowledge_entry_id
      ? String(row.duplicate_of_knowledge_entry_id)
      : null,
    approvedKnowledgeEntryId: row.approved_knowledge_entry_id
      ? String(row.approved_knowledge_entry_id)
      : null,
    reviewedByUserId: row.reviewed_by_user_id ? String(row.reviewed_by_user_id) : null,
    reviewedAt: nullableIso(row.reviewed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function runDto(
  row: Record<string, unknown>,
  items: FaqSuggestionItemDto[],
): FaqSuggestionRunDto {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    status: row.status as FaqSuggestionRunDto["status"],
    errorCode: row.error_code ? String(row.error_code) : null,
    createdByUserId: String(row.created_by_user_id),
    startedAt: nullableIso(row.started_at),
    completedAt: nullableIso(row.completed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    items,
  };
}

function wikiItem(row: Record<string, unknown> | undefined): WikiManagementItem | null {
  if (!row) return null;
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    itemType: "faq",
    title: String(row.question),
    content: String(row.answer),
    status: row.status === "active" ? "active" : "draft",
    origin: "manual",
    provenance: json<Record<string, unknown>>(row.provenance_json ?? {}),
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    approvedByUserId: row.approved_by_user_id ? String(row.approved_by_user_id) : null,
    approvedAt: nullableIso(row.approved_at),
    sourceKind: "faq",
    sourceId: String(row.id),
    activeVersionId: null,
    lastBuiltAt: null,
    buildStatus: "idle",
  };
}

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await action(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function requireMember(
  client: Pick<PoolClient, "query">,
  scope: BrandActorScope,
  approval = false,
): Promise<void> {
  const result = await client.query(
    `select member.role
       from workspace_members member
       join brands brand
         on brand.id = $3::uuid and brand.workspace_id = member.workspace_id
      where member.workspace_id = $1::uuid
        and member.user_id = $2::uuid
        and member.status = 'active'
        and member.deleted_at is null
        and brand.status = 'active'
        and brand.deleted_at is null`,
    [scope.workspaceId, scope.actorUserId, scope.brandId],
  );
  if (!result.rowCount) throw new Error("faq_suggestion_access_forbidden");
  if (approval && !["owner", "admin"].includes(String(result.rows[0].role))) {
    throw new Error("faq_suggestion_approval_forbidden");
  }
}

async function collectSources(
  client: Pick<PoolClient, "query">,
  scope: BrandScope,
): Promise<SourceDescriptor[]> {
  const sources: SourceDescriptor[] = [];
  const core = await client.query(
    `select version.id, version.core_json,
            coalesce(version.core_json->'summary'->>'oneLine', brand.name) as label
       from brands brand
       join brand_profiles profile
         on profile.workspace_id = brand.workspace_id and profile.brand_id = brand.id
       join brand_core_versions version
         on version.id = profile.active_brand_core_id
        and version.workspace_id = brand.workspace_id
        and version.brand_id = brand.id
      where brand.workspace_id = $1::uuid and brand.id = $2::uuid
        and brand.status = 'active' and brand.deleted_at is null
        and version.status = 'approved'`,
    [scope.workspaceId, scope.brandId],
  );
  for (const row of core.rows) {
    const payload = json(row.core_json);
    sources.push({
      sourceType: "brand_core",
      sourceId: String(row.id),
      contentHash: hash(payload),
      label: String(row.label || "브랜드 코어"),
    });
  }

  const products = await client.query(
    `select version.id, version.profile_json, item.display_name
       from product_services item
       join product_service_versions version
         on version.id = item.active_version_id
        and version.workspace_id = item.workspace_id
        and version.brand_id = item.brand_id
      where item.workspace_id = $1::uuid and item.brand_id = $2::uuid
        and item.status = 'active' and version.status = 'approved'`,
    [scope.workspaceId, scope.brandId],
  );
  for (const row of products.rows) {
    sources.push({
      sourceType: "product_service",
      sourceId: String(row.id),
      contentHash: hash(json(row.profile_json)),
      label: String(row.display_name),
    });
  }

  const snapshots = await client.query(
    `select distinct on (snapshot.source_url_id)
            snapshot.id, snapshot.content_hash, snapshot.extracted_text,
            coalesce(snapshot.extracted_title, source.title, source.url) as label
       from source_snapshots snapshot
       join source_urls source
         on source.id = snapshot.source_url_id
        and source.workspace_id = snapshot.workspace_id
        and source.brand_id = snapshot.brand_id
      where snapshot.workspace_id = $1::uuid and snapshot.brand_id = $2::uuid
        and snapshot.status = 'succeeded'
        and length(trim(coalesce(snapshot.extracted_text, ''))) > 0
        and source.source_type = 'owned' and source.enabled = true
        and source.deleted_at is null
      order by snapshot.source_url_id, snapshot.fetched_at desc`,
    [scope.workspaceId, scope.brandId],
  );
  for (const row of snapshots.rows) {
    sources.push({
      sourceType: "owned_snapshot",
      sourceId: String(row.id),
      contentHash: String(row.content_hash || hash(String(row.extracted_text))),
      label: String(row.label),
    });
  }

  const documents = await client.query(
    `select unit.source_kind, unit.source_id,
            string_agg(unit.content, E'\n' order by unit.stable_key) as content,
            min(unit.title) as label
       from wiki_source_units unit
       join wiki_versions version
         on version.id = unit.wiki_version_id
        and version.workspace_id = unit.workspace_id
        and version.brand_id = unit.brand_id
      where unit.workspace_id = $1::uuid and unit.brand_id = $2::uuid
        and version.status = 'active'
        and unit.source_kind in ('policy', 'guide')
      group by unit.source_kind, unit.source_id`,
    [scope.workspaceId, scope.brandId],
  );
  for (const row of documents.rows) {
    sources.push({
      sourceType: "document",
      sourceId: String(row.source_id),
      contentHash: hash(String(row.content)),
      label: String(row.label),
    });
  }

  const faqs = await client.query(
    `select id, question, answer
       from knowledge_entries
      where workspace_id = $1::uuid and brand_id = $2::uuid
        and entry_type = 'faq' and status = 'active' and enabled = true`,
    [scope.workspaceId, scope.brandId],
  );
  for (const row of faqs.rows) {
    sources.push({
      sourceType: "faq",
      sourceId: String(row.id),
      contentHash: hash({ question: row.question, answer: row.answer }),
      label: String(row.question),
    });
  }

  return sources.sort((left, right) => (
    left.sourceType.localeCompare(right.sourceType)
    || left.sourceId.localeCompare(right.sourceId)
  ));
}

async function selectRun(
  client: Pick<Pool, "query">,
  scope: BrandScope & { runId: string },
): Promise<FaqSuggestionRunDto | null> {
  const result = await client.query(
    `select * from faq_suggestion_runs
      where id = $1::uuid and workspace_id = $2::uuid and brand_id = $3::uuid`,
    [scope.runId, scope.workspaceId, scope.brandId],
  );
  if (!result.rowCount) return null;
  const items = await client.query(
    `select * from faq_suggestion_items
      where run_id = $1::uuid and workspace_id = $2::uuid and brand_id = $3::uuid
      order by position`,
    [scope.runId, scope.workspaceId, scope.brandId],
  );
  return runDto(
    result.rows[0] as Record<string, unknown>,
    items.rows.map((row) => itemDto(row as Record<string, unknown>)),
  );
}

function sameTimestamp(left: unknown, right: string): boolean {
  return new Date(left as string | number | Date).getTime() === new Date(right).getTime();
}

function normalizeQuestion(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR");
}

function isActiveRunConflict(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string; message?: string };
  return pgError.code === "23505"
    && (pgError.constraint === "faq_suggestion_runs_one_active_per_brand_uq"
      || pgError.message?.includes("faq_suggestion_runs_one_active_per_brand_uq") === true);
}

async function completeRunIfReviewed(
  client: Pick<PoolClient, "query">,
  scope: BrandScope & { runId: string },
): Promise<void> {
  await client.query(
    `update faq_suggestion_runs run
        set status = 'completed', completed_at = coalesce(completed_at, now())
      where run.id = $1::uuid and run.workspace_id = $2::uuid and run.brand_id = $3::uuid
        and run.status in ('review_ready', 'partial')
        and not exists (
          select 1 from faq_suggestion_items item
           where item.run_id = run.id and item.status = 'review'
        )`,
    [scope.runId, scope.workspaceId, scope.brandId],
  );
}

export function createFaqSuggestionRepository(pool: Pool): FaqSuggestionRepository {
  return {
    async createFaqSuggestionRun(scope) {
      try {
        return await transaction(pool, async (client) => {
          await requireMember(client, scope);
          const active = await client.query(
            `select id from faq_suggestion_runs
              where workspace_id = $1::uuid and brand_id = $2::uuid
                and status in ('queued', 'running')
              order by created_at desc limit 1`,
            [scope.workspaceId, scope.brandId],
          );
          if (active.rowCount) {
            return {
              run: (await selectRun(client, { ...scope, runId: String(active.rows[0].id) }))!,
              created: false,
            };
          }

          const sources = await collectSources(client, scope);
          if (!sources.length) throw new Error("faq_suggestion_sources_missing");
          const sourceSnapshot = {
            contractVersion: "faq-suggestion-sources.v1",
            sources,
          };
          const created = await client.query(
            `insert into faq_suggestion_runs (
               workspace_id, brand_id, input_fingerprint, source_snapshot_json,
               created_by_user_id
             ) values ($1::uuid, $2::uuid, $3, $4::jsonb, $5::uuid)
             returning id`,
            [
              scope.workspaceId,
              scope.brandId,
              hash(sources.map(({ sourceType, sourceId, contentHash }) => ({
                sourceType,
                sourceId,
                contentHash,
              }))),
              JSON.stringify(sourceSnapshot),
              scope.actorUserId,
            ],
          );
          return {
            run: (await selectRun(client, { ...scope, runId: String(created.rows[0].id) }))!,
            created: true,
          };
        });
      } catch (error) {
        if (!isActiveRunConflict(error)) throw error;
        const active = await pool.query(
          `select id from faq_suggestion_runs
            where workspace_id = $1::uuid and brand_id = $2::uuid
              and status in ('queued', 'running')
            order by created_at desc limit 1`,
          [scope.workspaceId, scope.brandId],
        );
        if (!active.rowCount) throw error;
        return {
          run: (await selectRun(pool, { ...scope, runId: String(active.rows[0].id) }))!,
          created: false,
        };
      }
    },

    async getLatestFaqSuggestionRun(scope) {
      const result = await pool.query(
        `select id from faq_suggestion_runs
          where workspace_id = $1::uuid and brand_id = $2::uuid
          order by created_at desc limit 1`,
        [scope.workspaceId, scope.brandId],
      );
      return result.rowCount
        ? selectRun(pool, { ...scope, runId: String(result.rows[0].id) })
        : null;
    },

    getFaqSuggestionRun(scope) {
      return selectRun(pool, scope);
    },

    async updateFaqSuggestionItem(input) {
      return transaction(pool, async (client) => {
        await requireMember(client, input);
        const current = await client.query(
          `select item.* from faq_suggestion_items item
            join faq_suggestion_runs run
              on run.id = item.run_id
             and run.workspace_id = item.workspace_id
             and run.brand_id = item.brand_id
           where item.id = $1::uuid and item.run_id = $2::uuid
             and item.workspace_id = $3::uuid and item.brand_id = $4::uuid
           for update of item`,
          [input.itemId, input.runId, input.workspaceId, input.brandId],
        );
        if (!current.rowCount) throw new Error("faq_suggestion_item_not_found");
        if (current.rows[0].status !== "review"
          || !sameTimestamp(current.rows[0].updated_at, input.expectedUpdatedAt)) {
          throw new Error("faq_suggestion_item_conflict");
        }
        const updated = await client.query(
          `update faq_suggestion_items
              set category = $1, question = $2, answer = $3, updated_at = clock_timestamp()
            where id = $4::uuid
            returning *`,
          [input.category, input.question, input.answer, input.itemId],
        );
        return itemDto(updated.rows[0] as Record<string, unknown>);
      });
    },

    async approveFaqSuggestionItem(input) {
      return transaction(pool, async (client) => {
        await requireMember(client, input, true);
        await client.query(
          `select id from faq_suggestion_runs
            where id = $1::uuid and workspace_id = $2::uuid and brand_id = $3::uuid
            for update`,
          [input.runId, input.workspaceId, input.brandId],
        );
        const current = await client.query(
          `select * from faq_suggestion_items
            where id = $1::uuid and run_id = $2::uuid
              and workspace_id = $3::uuid and brand_id = $4::uuid
            for update`,
          [input.itemId, input.runId, input.workspaceId, input.brandId],
        );
        if (!current.rowCount) throw new Error("faq_suggestion_item_not_found");
        const row = current.rows[0] as Record<string, unknown>;
        if (row.status === "approved" || row.status === "duplicate") {
          const knowledgeId = row.approved_knowledge_entry_id
            || row.duplicate_of_knowledge_entry_id;
          const knowledge = knowledgeId
            ? await client.query(
              `select * from knowledge_entries
                where id = $1::uuid and workspace_id = $2::uuid and brand_id = $3::uuid`,
              [knowledgeId, input.workspaceId, input.brandId],
            )
            : { rows: [] };
          return { item: itemDto(row), wikiItem: wikiItem(knowledge.rows[0]) };
        }
        if (row.status !== "review"
          || !sameTimestamp(row.updated_at, input.expectedUpdatedAt)) {
          throw new Error("faq_suggestion_item_conflict");
        }

        const normalizedQuestion = normalizeQuestion(String(row.question));
        const duplicate = await client.query(
          `select * from knowledge_entries
            where workspace_id = $1::uuid and brand_id = $2::uuid
              and entry_type = 'faq' and normalized_question = $3
            order by created_at limit 1
            for update`,
          [input.workspaceId, input.brandId, normalizedQuestion],
        );
        if (duplicate.rowCount) {
          const updated = await client.query(
            `update faq_suggestion_items
                set status = 'duplicate', duplicate_of_knowledge_entry_id = $1::uuid,
                    reviewed_by_user_id = $2::uuid, reviewed_at = now(),
                    updated_at = clock_timestamp()
              where id = $3::uuid returning *`,
            [duplicate.rows[0].id, input.actorUserId, input.itemId],
          );
          await completeRunIfReviewed(client, input);
          return {
            item: itemDto(updated.rows[0] as Record<string, unknown>),
            wikiItem: wikiItem(duplicate.rows[0]),
          };
        }

        const evidence = json<FaqSuggestionEvidenceDto[]>(row.evidence_json);
        const knowledge = await client.query(
          `insert into knowledge_entries (
             workspace_id, brand_id, normalized_question, question, answer,
             entry_type, title, content, origin, provenance_json, status,
             enabled, direct_reply_enabled, created_by_user_id,
             approved_by_user_id, approved_at
           ) values (
             $1::uuid, $2::uuid, $3, $4, $5, 'faq', $4, $5, 'manual',
             $6::jsonb, 'active', true, true, $7::uuid, $7::uuid, now()
           ) on conflict (brand_id, normalized_question) do nothing
           returning *`,
          [
            input.workspaceId,
            input.brandId,
            normalizedQuestion,
            row.question,
            row.answer,
            JSON.stringify({
              source: "faq_suggestion",
              runId: input.runId,
              itemId: input.itemId,
              evidence,
            }),
            input.actorUserId,
          ],
        );
        if (!knowledge.rowCount) {
          const concurrentDuplicate = await client.query(
            `select * from knowledge_entries
              where workspace_id = $1::uuid and brand_id = $2::uuid
                and entry_type = 'faq' and normalized_question = $3
              order by created_at limit 1`,
            [input.workspaceId, input.brandId, normalizedQuestion],
          );
          if (!concurrentDuplicate.rowCount) {
            throw new Error("faq_suggestion_approval_conflict");
          }
          const updated = await client.query(
            `update faq_suggestion_items
                set status = 'duplicate', duplicate_of_knowledge_entry_id = $1::uuid,
                    reviewed_by_user_id = $2::uuid, reviewed_at = now(),
                    updated_at = clock_timestamp()
              where id = $3::uuid returning *`,
            [concurrentDuplicate.rows[0].id, input.actorUserId, input.itemId],
          );
          await completeRunIfReviewed(client, input);
          return {
            item: itemDto(updated.rows[0] as Record<string, unknown>),
            wikiItem: wikiItem(concurrentDuplicate.rows[0]),
          };
        }
        const updated = await client.query(
          `update faq_suggestion_items
              set status = 'approved', approved_knowledge_entry_id = $1::uuid,
                  reviewed_by_user_id = $2::uuid, reviewed_at = now(),
                  updated_at = clock_timestamp()
            where id = $3::uuid returning *`,
          [knowledge.rows[0].id, input.actorUserId, input.itemId],
        );
        await completeRunIfReviewed(client, input);
        return {
          item: itemDto(updated.rows[0] as Record<string, unknown>),
          wikiItem: wikiItem(knowledge.rows[0]),
        };
      });
    },

    async dismissFaqSuggestionItem(input) {
      return transaction(pool, async (client) => {
        await requireMember(client, input);
        await client.query(
          `select id from faq_suggestion_runs
            where id = $1::uuid and workspace_id = $2::uuid and brand_id = $3::uuid
            for update`,
          [input.runId, input.workspaceId, input.brandId],
        );
        const current = await client.query(
          `select * from faq_suggestion_items
            where id = $1::uuid and run_id = $2::uuid
              and workspace_id = $3::uuid and brand_id = $4::uuid
            for update`,
          [input.itemId, input.runId, input.workspaceId, input.brandId],
        );
        if (!current.rowCount) throw new Error("faq_suggestion_item_not_found");
        const row = current.rows[0] as Record<string, unknown>;
        if (row.status === "dismissed") return itemDto(row);
        if (row.status !== "review"
          || !sameTimestamp(row.updated_at, input.expectedUpdatedAt)) {
          throw new Error("faq_suggestion_item_conflict");
        }
        const updated = await client.query(
          `update faq_suggestion_items
              set status = 'dismissed', reviewed_by_user_id = $1::uuid,
                  reviewed_at = now(), updated_at = clock_timestamp()
            where id = $2::uuid returning *`,
          [input.actorUserId, input.itemId],
        );
        await completeRunIfReviewed(client, input);
        return itemDto(updated.rows[0] as Record<string, unknown>);
      });
    },
  };
}
