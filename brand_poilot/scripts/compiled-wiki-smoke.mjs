import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import pg from "pg";
import {
  decodeCaCertificate,
  resolveVerifiedTlsConfig,
} from "./databaseTls.mjs";

export { decodeCaCertificate };

const trustedCompiledWikiSourceKinds = new Set([
  "faq",
  "product",
  "product_service",
  "service",
  "policy",
  "guide",
  "owned_snapshot",
]);

export function assertTrustedCompiledWikiSources(sources) {
  for (const source of sources) {
    const sourceKind = source?.sourceKind ?? source?.source_kind;
    const sourceId = source?.sourceId ?? source?.source_id;
    if (!trustedCompiledWikiSourceKinds.has(sourceKind) || typeof sourceId !== "string" || !sourceId) {
      throw new Error("compiled_wiki_untrusted_source");
    }
  }
  return sources;
}

function argument(name, argv = process.argv) {
  const prefix = `--${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

export function resolveSmokePoolConfig(
  connectionString,
  { caCertificate } = {},
) {
  return resolveVerifiedTlsConfig(connectionString, { caCertificate });
}

export async function runLocalCompiledWikiContractSmoke() {
  const [{ PGlite }, { pgcrypto }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite/contrib/pgcrypto"),
  ]);
  const database = await PGlite.create({ extensions: { pgcrypto } });
  const ids = {
    user: randomUUID(),
    workspace: randomUUID(),
    brand: randomUUID(),
    faq: randomUUID(),
  };
  try {
    const migrationDirectory = resolve(process.cwd(), "db/migrations");
    for (const file of (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort()) {
      const sql = await readFile(resolve(migrationDirectory, file), "utf8");
      if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
      await database.exec(sql);
    }
    await database.query(
      "insert into app_users(id,email) values($1,'compiled-wiki-smoke@example.com')",
      [ids.user],
    );
    await database.query(
      `insert into workspaces(id,name,slug,created_by_user_id)
       values($1,'Compiled Wiki Smoke',$2,$3)`,
      [ids.workspace, `compiled-wiki-smoke-${ids.workspace}`, ids.user],
    );
    await database.query(
      `insert into workspace_members(workspace_id,user_id,role,status)
       values($1,$2,'owner','active')`,
      [ids.workspace, ids.user],
    );
    await database.query(
      `insert into brands(id,workspace_id,name,created_by_user_id)
       values($1,$2,'Compiled Wiki Smoke Brand',$3)`,
      [ids.brand, ids.workspace, ids.user],
    );
    await database.query(
      `insert into knowledge_entries(
         id,workspace_id,brand_id,entry_type,normalized_question,question,answer,title,content,
         direct_reply_enabled,enabled,origin,status,created_by_user_id,approved_by_user_id,approved_at
       ) values(
         $1,$2,$3,'faq','배송은 언제 시작하나요?','배송은 언제 시작하나요?',
         '영업일 기준 이틀 안에 시작합니다.','배송은 언제 시작하나요?',
         '영업일 기준 이틀 안에 시작합니다.',true,true,'manual','active',$4,$4,now()
       )`,
      [ids.faq, ids.workspace, ids.brand, ids.user],
    );
    const external = await database.query(
      `insert into source_urls(
         workspace_id,brand_id,source_type,url,url_hash,domain,status,enabled,content_purpose
       ) values($1,$2,'reference','https://outside.example/claim',$3,
         'outside.example','crawled',true,'marketing') returning id`,
      [ids.workspace, ids.brand, `outside-${ids.brand}`],
    );
    await database.query(
      `insert into reference_items(
         workspace_id,brand_id,kind,source_url_id,title,metadata,created_by_user_id
       ) values($1,$2,'external_url',$3,'외부의 검증되지 않은 주장',
         '{"unsupportedClaim":"질병을 치료한다"}',$4)`,
      [ids.workspace, ids.brand, external.rows[0].id, ids.user],
    );
    const refreshSources = await database.query(
      "select source_kind,source_id,title,content from get_wiki_refresh_sources($1,$2)",
      [ids.workspace, ids.brand],
    );
    assertTrustedCompiledWikiSources(refreshSources.rows);
    if (
      !refreshSources.rows.some((source) => source.source_id === ids.faq)
      || JSON.stringify(refreshSources.rows).includes("질병을 치료한다")
    ) {
      throw new Error("compiled_wiki_local_trust_boundary_failed");
    }
    const version = await database.query(
      `insert into wiki_versions(workspace_id,brand_id,status,activated_at)
       values($1,$2,'active',now()) returning id`,
      [ids.workspace, ids.brand],
    );
    const sourceUnit = await database.query(
      `insert into wiki_source_units(
         workspace_id,brand_id,wiki_version_id,source_kind,source_id,unit_type,stable_key,
         title,content,content_hash,source_quote
       ) values($1,$2,$3,'faq',$4,'faq','shipping-start',$5,$6,md5($6),$6)
       returning id`,
      [
        ids.workspace,
        ids.brand,
        version.rows[0].id,
        ids.faq,
        "배송은 언제 시작하나요?",
        "영업일 기준 이틀 안에 시작합니다.",
      ],
    );
    const page = await database.query(
      `insert into wiki_pages(
         workspace_id,brand_id,wiki_version_id,page_type,stable_key,title,summary,
         content_markdown,content_json,source_count,is_active
       ) values(
         $1,$2,$3,'faq','shipping-start',$4,$5,$6,
         jsonb_build_object(
           'sections',
           jsonb_build_array(
             jsonb_build_object(
               'sectionKey','answer',
               'sourceUnitIds',jsonb_build_array($7::text)
             )
           )
         ),
         1,true
       ) returning id`,
      [
        ids.workspace,
        ids.brand,
        version.rows[0].id,
        "배송은 언제 시작하나요?",
        "배송 시작 안내",
        "배송은 언제 시작하나요? 영업일 기준 이틀 안에 시작합니다.",
        sourceUnit.rows[0].id,
      ],
    );
    const chunk = await database.query(
      `insert into wiki_page_chunks(
         workspace_id,brand_id,wiki_version_id,wiki_page_id,chunk_index,
         content,content_hash,enabled
       ) values($1,$2,$3,$4,0,$5,md5($5),true)
       returning id`,
      [
        ids.workspace,
        ids.brand,
        version.rows[0].id,
        page.rows[0].id,
        "배송은 언제 시작하나요? 영업일 기준 이틀 안에 시작합니다.",
      ],
    );
    await database.query(
      `insert into wiki_page_sources(
         workspace_id,brand_id,wiki_version_id,wiki_page_id,wiki_source_unit_id,
         section_key,source_kind,source_id,source_quote
       ) values($1,$2,$3,$4,$5,'answer','faq',$6,$7)`,
      [
        ids.workspace,
        ids.brand,
        version.rows[0].id,
        page.rows[0].id,
        sourceUnit.rows[0].id,
        ids.faq,
        "영업일 기준 이틀 안에 시작합니다.",
      ],
    );
    const retrieved = await database.query(
      "select * from search_brand_wiki_lexical($1,$2,$3,$4)",
      [ids.workspace, ids.brand, "배송 시작", 3],
    );
    const sourceLinkIds = [...new Set(
      retrieved.rows.flatMap((row) => Array.isArray(row.source_link_ids) ? row.source_link_ids : []),
    )];
    const retrievedSources = sourceLinkIds.length
      ? await database.query(
        `select source_kind,source_id
           from wiki_page_sources
          where workspace_id=$1 and brand_id=$2 and wiki_version_id=$3
            and id=any($4::uuid[])`,
        [ids.workspace, ids.brand, version.rows[0].id, sourceLinkIds],
      )
      : { rows: [] };
    assertTrustedCompiledWikiSources(retrievedSources.rows);
    if (
      retrieved.rows.length !== 1
      || retrieved.rows[0].page_chunk_id !== chunk.rows[0].id
      || retrievedSources.rows.length !== 1
      || retrievedSources.rows[0].source_id !== ids.faq
    ) {
      throw new Error("compiled_wiki_local_retrieval_failed");
    }
    const result = {
      mode: "local-contract",
      versionId: version.rows[0].id,
      retrievalMode: "search_brand_wiki_lexical",
      retrievedChunkCount: retrieved.rows.length,
      activeSourceKinds: retrievedSources.rows.map((source) => source.source_kind),
      unsupportedReferenceExcluded: true,
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await database.close();
  }
}

async function loadCompiledWikiVersion(database, versionId, forUpdate = false) {
  const version = await database.query(
    `select id, workspace_id, brand_id, status
       from wiki_versions
      where id = $1::uuid
      ${forUpdate ? "for update" : ""}`,
    [versionId],
  );
  if (!version.rowCount) throw new Error("wiki_version_not_found");
  return version.rows[0];
}

async function assertDatabaseCompiledWikiSmoke(database, version, versionId, questions) {
  const results = [];
  for (const question of questions) {
    const found = await database.query(
      `select page_type, title, source_link_ids, cosine_similarity, keyword_match, rrf_score
         from search_brand_wiki_lexical($1::uuid, $2::uuid, $3, $4)`,
      [version.workspace_id, version.brand_id, question, 3],
    );
    const sourceLinkIds = [...new Set(
      found.rows.flatMap((row) => Array.isArray(row.source_link_ids) ? row.source_link_ids : []),
    )];
    if (found.rows.length && !sourceLinkIds.length) {
      throw new Error("compiled_wiki_untrusted_source");
    }
    if (sourceLinkIds.length) {
      const sources = await database.query(
        `select source.id, source.source_kind, source.source_id
           from wiki_page_sources source
          where source.workspace_id = $1::uuid
            and source.brand_id = $2::uuid
            and source.wiki_version_id = $3::uuid
            and source.id = any($4::uuid[])`,
        [
          version.workspace_id,
          version.brand_id,
          versionId,
          sourceLinkIds,
        ],
      );
      if (sources.rowCount !== sourceLinkIds.length) {
        throw new Error("compiled_wiki_untrusted_source");
      }
      assertTrustedCompiledWikiSources(sources.rows);
    }
    results.push({ question, pages: found.rows });
  }
  const emptyQuestions = results
    .filter((result) => result.pages.length === 0)
    .map((result) => result.question);
  if (emptyQuestions.length) throw new Error("compiled_wiki_smoke_empty_results");
  return { emptyQuestions, results };
}

export async function runDatabaseCompiledWikiSmoke({
  pool,
  versionId,
  activate,
  questions,
}) {
  const observedVersion = await loadCompiledWikiVersion(pool, versionId);
  if (observedVersion.status === "active") {
    const verified = await assertDatabaseCompiledWikiSmoke(
      pool,
      observedVersion,
      versionId,
      questions,
    );
    return { ...verified, status: "active", activated: false };
  }
  if (observedVersion.status !== "ready" || !activate) {
    throw new Error("wiki_version_not_active");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const version = await loadCompiledWikiVersion(client, versionId, true);
    if (version.status !== "ready") throw new Error("wiki_version_not_ready");
    const activated = await client.query(
      "select activate_compiled_wiki_version($1::uuid) as activated",
      [versionId],
    );
    if (!activated.rows[0]?.activated) throw new Error("compiled_wiki_activation_failed");
    const verified = await assertDatabaseCompiledWikiSmoke(
      client,
      { ...version, status: "active" },
      versionId,
      questions,
    );
    await client.query("commit");
    return { ...verified, status: "active", activated: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function main() {
  config({ path: "apps/api/.env" });
  config({ path: "workers/brand-pilot-dm-worker/.env", override: true });

  const versionId = argument("version");
  const activate = process.argv.includes("--activate");
  const connectionString = process.env.DM_WORKER_DATABASE_URL
    || process.env.SUPABASE_DATABASE_URL
    || process.env.DATABASE_URL;

  if (!versionId && !connectionString) {
    return runLocalCompiledWikiContractSmoke();
  }
  if (!versionId) throw new Error("usage: npm run smoke:compiled-wiki -- --version=<uuid> [--activate]");
  if (!connectionString) throw new Error("DM_WORKER_DATABASE_URL_required");

  const caCertificate = decodeCaCertificate(process.env.DB_SSL_CA_BASE64);
  const pool = new pg.Pool(resolveSmokePoolConfig(connectionString, {
    caCertificate,
  }));

  try {
    const questions = JSON.parse(await readFile(new URL("./fixtures/dm-wiki-questions.json", import.meta.url), "utf8"));
    const result = await runDatabaseCompiledWikiSmoke({
      pool,
      versionId,
      activate,
      questions,
    });
    if (result.activated) console.log(JSON.stringify({ versionId, activated: true }));
    console.log(JSON.stringify({
      versionId,
      status: result.status,
      emptyQuestions: result.emptyQuestions,
      results: result.results,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "compiled_wiki_smoke_failed");
    process.exitCode = 1;
  });
}
