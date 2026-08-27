import { createHash } from "node:crypto";
import { sha256CanonicalJson } from "./ai-content-cutover-evidence.mjs";

export const PRESERVED_ROW_HASH_ENCODING = "sha256-grouped-count-length-prefixed-postgres-jsonb-text.v1";

export const PRESERVED_DATASETS = Object.freeze([
  Object.freeze({
    key: "brands",
    relations: Object.freeze([
      "brands",
      "brand_profiles",
      "brand_channels",
      "brand_content_formats",
      "brand_format_rotation_states",
      "brand_profile_subcategories",
      "brand_trend_searches",
      "brand_trend_saved_media",
      "brand_audiences",
      "brand_appeals",
      "brand_avatars",
      "brand_avatar_images",
    ]),
  }),
  Object.freeze({ key: "brand_core", relations: Object.freeze(["brand_core_versions"]) }),
  Object.freeze({ key: "brand_rules", relations: Object.freeze(["brand_rule_sets"]) }),
  Object.freeze({
    key: "visual_styles",
    relations: Object.freeze([
      "brand_design_styles",
      "brand_design_style_references",
      "brand_design_style_analysis_jobs",
      "brand_style_presets",
    ]),
  }),
  Object.freeze({
    key: "users",
    relations: Object.freeze(["app_users", "user_identities", "user_sessions", "workspaces", "workspace_members"]),
  }),
  Object.freeze({
    key: "products",
    relations: Object.freeze(["product_services", "product_service_legacy_mappings"]),
  }),
  Object.freeze({ key: "product_versions", relations: Object.freeze(["product_service_versions"]) }),
  Object.freeze({ key: "product_assets", relations: Object.freeze(["product_service_assets"]) }),
  Object.freeze({
    key: "analyses",
    relations: Object.freeze([
      "ai_content_subject_analyses",
      "ai_content_subject_images",
      "brand_analysis_runs",
      "brand_analysis_uploads",
      "brand_analysis_stage_runs",
      "brand_analysis_cli_calls",
      "brand_analysis_cli_attempts",
      "brand_analysis_upload_attempts",
      "brand_offerings",
    ]),
  }),
  Object.freeze({
    key: "source_library",
    relations: Object.freeze([
      "source_urls",
      "source_content_items",
      "source_snapshots",
      "source_crawl_runs",
      "knowledge_imports",
      "knowledge_entries",
      "wiki_documents",
      "wiki_chunks",
      "wiki_versions",
      "wiki_build_items",
      "wiki_build_requests",
      "wiki_source_units",
      "wiki_pages",
      "wiki_page_sources",
      "wiki_page_links",
      "wiki_page_chunks",
      "wiki_compilation_items",
      "wiki_retrieval_runs",
      "wiki_maintenance_runs",
      "wiki_issues",
      "wiki_refresh_outbox",
    ]),
  }),
  Object.freeze({
    key: "reference_library",
    relations: Object.freeze([
      "reference_brands",
      "reference_items",
      "reference_item_source_url_provenance",
      "reference_upload_sessions",
      "reference_upload_cancellation_receipts",
      "reference_patterns",
      "reference_snapshots",
      "reference_pattern_versions",
    ]),
  }),
  Object.freeze({ key: "published_outputs", relations: Object.freeze(["channel_outputs"]) }),
  Object.freeze({
    key: "publication_history",
    relations: Object.freeze(["publish_slots", "publish_queue", "publish_attempts"]),
  }),
  Object.freeze({ key: "storage_artifacts", relations: Object.freeze(["storage_artifacts"]) }),
]);

const DECLARED_RELATIONS = Object.freeze(PRESERVED_DATASETS.flatMap(({ relations }) => relations));
const DECLARED_RELATION_SET = new Set(DECLARED_RELATIONS);

const RELATION_SELECTORS = Object.freeze({
  ai_content_subject_analyses: `
    where preserved_row.generation_id is null
       or exists (
         select 1 from public.product_service_versions preserved_product_version
         where preserved_product_version.source_analysis_id=preserved_row.id
       )
       or exists (
         select 1
         from public.ai_content_subject_images preserved_image
         join public.product_service_assets preserved_asset
           on preserved_asset.source_image_id=preserved_image.id
         where preserved_image.analysis_id=preserved_row.id
       )`,
  ai_content_subject_images: `
    where exists (
      select 1 from public.ai_content_subject_analyses preserved_analysis
      where preserved_analysis.id=preserved_row.analysis_id
        and (
          preserved_analysis.generation_id is null
          or exists (
            select 1 from public.product_service_versions preserved_product_version
            where preserved_product_version.source_analysis_id=preserved_analysis.id
          )
        )
    )
    or exists (
      select 1 from public.product_service_assets preserved_asset
      where preserved_asset.source_image_id=preserved_row.id
    )`,
});

function sortedRows(rows, relation) {
  if (!Array.isArray(rows)) throw new Error(`preserved_relation_rows_invalid:${relation}`);
  if (rows.some((row) => typeof row !== "string")) throw new Error(`preserved_relation_exact_text_required:${relation}`);
  return [...rows].sort((left, right) => {
    const leftJson = left;
    const rightJson = right;
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  });
}

function updateExactRowHash(hash, rowText, duplicateCount = 1n) {
  if (typeof rowText !== "string") throw new Error("preserved_row_json_text_invalid");
  const bytes = Buffer.from(rowText, "utf8");
  const countText = duplicateCount.toString();
  hash.update(Buffer.concat([
    Buffer.from(`${countText.length}:${countText}${bytes.length}:`, "ascii"),
    bytes,
  ]));
}

function exactRowsManifest(rows, relation) {
  const hash = createHash("sha256");
  hash.update(`${PRESERVED_ROW_HASH_ENCODING}\0`, "utf8");
  let previous;
  let duplicateCount = 0n;
  for (const row of rows) {
    const rowText = row;
    if (previous !== undefined && rowText !== previous) {
      updateExactRowHash(hash, previous, duplicateCount);
      duplicateCount = 0n;
    }
    previous = rowText;
    duplicateCount += 1n;
  }
  if (previous !== undefined) updateExactRowHash(hash, previous, duplicateCount);
  return { status: "found", count: String(rows.length), sha256: hash.digest("hex"), hash_encoding: PRESERVED_ROW_HASH_ENCODING };
}

function relationManifest(relationRows, relation) {
  if (!Object.hasOwn(relationRows, relation)) return { status: "not_found" };
  const rows = sortedRows(relationRows[relation], relation);
  return exactRowsManifest(rows, relation);
}

function buildCatalogFromManifests(relationManifests) {
  const datasets = Object.fromEntries(PRESERVED_DATASETS.map(({ key, relations }) => {
    const manifests = Object.fromEntries(relations.map((relation) => [
      relation,
      relationManifests[relation] ?? { status: "not_found" },
    ]));
    const allFound = Object.values(manifests).every(({ status }) => status === "found");
    const dataset = {
      status: allFound ? "found" : "incomplete",
      count: Object.values(manifests).reduce((total, manifest) =>
        total + (manifest.status === "found" ? BigInt(manifest.count) : 0n), 0n).toString(),
      relations: manifests,
    };
    dataset.sha256 = sha256CanonicalJson({ relations: manifests });
    return [key, dataset];
  }));

  const catalog = {
    schema_version: "ai-content-preserved-data-catalog.v2",
    row_encoding: "postgres-jsonb-text.v1",
    hash_encoding: PRESERVED_ROW_HASH_ENCODING,
    datasets,
  };
  return { ...catalog, catalog_sha256: sha256CanonicalJson(catalog) };
}

export function buildPreservedDataCatalog(relationRows = {}) {
  if (relationRows === null || typeof relationRows !== "object" || Array.isArray(relationRows)) {
    throw new Error("preserved_relation_rows_invalid");
  }
  for (const relation of Object.keys(relationRows)) {
    if (!DECLARED_RELATION_SET.has(relation)) throw new Error(`preserved_relation_not_declared:${relation}`);
  }
  return buildCatalogFromManifests(Object.fromEntries(
    DECLARED_RELATIONS.filter((relation) => Object.hasOwn(relationRows, relation))
      .map((relation) => [relation, relationManifest(relationRows, relation)]),
  ));
}

function quoteIdentifier(identifier) {
  if (!DECLARED_RELATION_SET.has(identifier)) throw new Error(`preserved_relation_not_declared:${identifier}`);
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function collectPreservedDataCatalog(queryable, { failOnMissingRelations = true, pageSize = 1000 } = {}) {
  if (!queryable || typeof queryable.query !== "function") throw new Error("preserved_catalog_queryable_invalid");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10_000) throw new Error("preserved_catalog_page_size_invalid");
  const acquiredSession = typeof queryable.connect === "function" ? await queryable.connect() : null;
  const session = acquiredSession ?? queryable;
  if (!session || typeof session.query !== "function") {
    acquiredSession?.release?.();
    throw new Error("preserved_catalog_session_invalid");
  }
  const relationManifests = {};
  let cleanupNeeded = false;
  let rollbackFailure;
  try {
    cleanupNeeded = true;
    await session.query({
      name: "ai-content-preserved-begin",
      text: "begin transaction isolation level repeatable read read only",
      values: [],
    });
    for (const [relationIndex, relation] of DECLARED_RELATIONS.entries()) {
    const existence = await session.query({
      name: "ai-content-preserved-relation-exists",
      text: `select format('%I.%I',namespace.nspname,relation.relname) as relation_name,
                    relation.relkind as relation_kind
               from pg_class relation
               join pg_namespace namespace on namespace.oid=relation.relnamespace
              where namespace.nspname='public' and relation.relname=$1`,
      values: [relation],
    });
    if (!existence.rows[0]?.relation_name) {
      if (failOnMissingRelations) throw new Error(`preserved_relation_not_found:${relation}`);
      continue;
    }
    if (!new Set(["r", "p"]).has(existence.rows[0].relation_kind)) {
      throw new Error(`preserved_relation_kind_invalid:${relation}:${existence.rows[0].relation_kind}`);
    }
    const identifier = quoteIdentifier(relation);
      const cursorName = `ai_content_preserved_${String(relationIndex).padStart(2, "0")}`;
      await session.query({
        name: `ai-content-preserved-declare-${relationIndex}`,
        text: `declare ${cursorName} no scroll cursor for
          select to_jsonb(preserved_row)::text as row_json_text
          from public.${identifier} preserved_row${RELATION_SELECTORS[relation] ?? ""}
          order by to_jsonb(preserved_row)::text collate "C"`,
        values: [],
      });
      const hash = createHash("sha256");
      hash.update(`${PRESERVED_ROW_HASH_ENCODING}\0`, "utf8");
      let count = 0n;
      let pendingText;
      let pendingCount = 0n;
      while (true) {
        const result = await session.query({
          text: `fetch forward ${pageSize} from ${cursorName}`,
          values: [],
        });
        for (const row of result.rows) {
          if (typeof row.row_json_text !== "string") throw new Error(`preserved_relation_page_invalid:${relation}`);
          if (pendingText !== undefined && row.row_json_text !== pendingText) {
            updateExactRowHash(hash, pendingText, pendingCount);
            pendingCount = 0n;
          }
          pendingText = row.row_json_text;
          pendingCount += 1n;
          count += 1n;
        }
        if (result.rows.length < pageSize) break;
      }
      if (pendingText !== undefined) updateExactRowHash(hash, pendingText, pendingCount);
      await session.query({
        name: `ai-content-preserved-close-${relationIndex}`,
        text: `close ${cursorName}`,
        values: [],
      });
    relationManifests[relation] = {
      status: "found",
      count: count.toString(),
      sha256: hash.digest("hex"),
      hash_encoding: PRESERVED_ROW_HASH_ENCODING,
    };
    }
    const catalog = buildCatalogFromManifests(relationManifests);
    await session.query({ name: "ai-content-preserved-commit", text: "commit", values: [] });
    cleanupNeeded = false;
    return catalog;
  } catch (error) {
    if (cleanupNeeded) {
      try {
        await session.query({ name: "ai-content-preserved-rollback", text: "rollback", values: [] });
        cleanupNeeded = false;
      } catch (rollbackError) {
        rollbackFailure = rollbackError;
      }
    }
    if (rollbackFailure) {
      throw new AggregateError(
        [error, rollbackFailure],
        "preserved_catalog_transaction_cleanup_failed",
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (rollbackFailure) acquiredSession?.release?.(rollbackFailure);
    else acquiredSession?.release?.();
  }
}
