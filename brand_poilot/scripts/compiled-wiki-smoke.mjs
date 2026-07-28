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
    await database.query(
      `insert into wiki_source_units(
         workspace_id,brand_id,wiki_version_id,source_kind,source_id,unit_type,stable_key,
         title,content,content_hash,source_quote
       ) values($1,$2,$3,'faq',$4,'faq','shipping-start',$5,$6,md5($6),$6)`,
      [
        ids.workspace,
        ids.brand,
        version.rows[0].id,
        ids.faq,
        "배송은 언제 시작하나요?",
        "영업일 기준 이틀 안에 시작합니다.",
      ],
    );
    const retrieved = await database.query(
      `select source_kind,source_id,title,content
         from wiki_source_units
        where workspace_id=$1 and brand_id=$2 and wiki_version_id=$3
          and content ilike '%이틀%'`,
      [ids.workspace, ids.brand, version.rows[0].id],
    );
    assertTrustedCompiledWikiSources(retrieved.rows);
    if (retrieved.rows.length !== 1 || retrieved.rows[0].source_id !== ids.faq) {
      throw new Error("compiled_wiki_local_retrieval_failed");
    }
    const result = {
      mode: "local-contract",
      versionId: version.rows[0].id,
      activeSourceKinds: retrieved.rows.map((source) => source.source_kind),
      unsupportedReferenceExcluded: true,
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await database.close();
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
  const apiKey = process.env.OPENAI_API_KEY;
  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

  if (!versionId && !connectionString && !apiKey) {
    return runLocalCompiledWikiContractSmoke();
  }
  if (!versionId) throw new Error("usage: npm run smoke:compiled-wiki -- --version=<uuid> [--activate]");
  if (!connectionString) throw new Error("DM_WORKER_DATABASE_URL_required");
  if (!apiKey) throw new Error("OPENAI_API_KEY_required");

  const caCertificate = decodeCaCertificate(process.env.DB_SSL_CA_BASE64);
  const pool = new pg.Pool(resolveSmokePoolConfig(connectionString, {
    caCertificate,
  }));

  async function embedding(text) {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: embeddingModel, input: text, dimensions: 1536 }),
    });
    const payload = await response.json();
    const vector = payload.data?.[0]?.embedding;
    if (!response.ok || !Array.isArray(vector) || vector.length !== 1536) {
      throw new Error(`embedding_request_failed:${response.status}`);
    }
    return vector;
  }

  try {
    const version = await pool.query(
      `select id, workspace_id, brand_id, status from wiki_versions where id = $1::uuid`,
      [versionId],
    );
    if (!version.rowCount) throw new Error("wiki_version_not_found");
    if (!["ready", "active"].includes(version.rows[0].status)) throw new Error("wiki_version_not_searchable");
    const questions = JSON.parse(await readFile(new URL("./fixtures/dm-wiki-questions.json", import.meta.url), "utf8"));
    const results = [];
    for (const question of questions) {
      const vector = await embedding(question);
      const found = await pool.query(
        `select page_type, title, source_link_ids, cosine_similarity, keyword_match, rrf_score
         from search_brand_compiled_wiki($1::uuid, $2::uuid, $3::uuid, $4::vector, $5, 3)`,
        [version.rows[0].workspace_id, version.rows[0].brand_id, versionId, `[${vector.join(",")}]`, question],
      );
      const sourceLinkIds = [...new Set(
        found.rows.flatMap((row) => Array.isArray(row.source_link_ids) ? row.source_link_ids : []),
      )];
      if (found.rows.length && !sourceLinkIds.length) {
        throw new Error("compiled_wiki_untrusted_source");
      }
      if (sourceLinkIds.length) {
        const sources = await pool.query(
          `select source.id, source.source_kind, source.source_id
             from wiki_page_sources source
            where source.workspace_id = $1::uuid
              and source.brand_id = $2::uuid
              and source.wiki_version_id = $3::uuid
              and source.id = any($4::uuid[])`,
          [
            version.rows[0].workspace_id,
            version.rows[0].brand_id,
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
    const emptyQuestions = results.filter((result) => result.pages.length === 0).map((result) => result.question);
    console.log(JSON.stringify({ versionId, status: version.rows[0].status, emptyQuestions, results }, null, 2));
    if (emptyQuestions.length) throw new Error("compiled_wiki_smoke_empty_results");
    if (activate) {
      const activated = await pool.query(
        "select activate_compiled_wiki_version($1::uuid) as activated",
        [versionId],
      );
      if (!activated.rows[0]?.activated) throw new Error("compiled_wiki_activation_failed");
      console.log(JSON.stringify({ versionId, activated: true }));
    }
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
