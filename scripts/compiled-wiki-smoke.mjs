import { readFile } from "node:fs/promises";
import process from "node:process";
import { config } from "dotenv";
import pg from "pg";

config({ path: "apps/api/.env" });
config({ path: "workers/brand-pilot-dm-worker/.env", override: true });

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

const versionId = argument("version");
const activate = process.argv.includes("--activate");
const connectionString = process.env.DM_WORKER_DATABASE_URL || process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
const apiKey = process.env.OPENAI_API_KEY;
const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

if (!versionId) throw new Error("usage: npm run smoke:compiled-wiki -- --version=<uuid> [--activate]");
if (!connectionString) throw new Error("DM_WORKER_DATABASE_URL_required");
if (!apiKey) throw new Error("OPENAI_API_KEY_required");

const url = new URL(connectionString);
url.searchParams.delete("sslmode");
const pool = new pg.Pool({
  connectionString: url.toString(),
  ssl: url.hostname.endsWith(".supabase.com") ? { rejectUnauthorized: false } : undefined,
});

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
  if (!['ready', 'active'].includes(version.rows[0].status)) throw new Error("wiki_version_not_searchable");
  const questions = JSON.parse(await readFile(new URL("./fixtures/dm-wiki-questions.json", import.meta.url), "utf8"));
  const results = [];
  for (const question of questions) {
    const vector = await embedding(question);
    const found = await pool.query(
      `select page_type, title, cosine_similarity, keyword_match, rrf_score
       from search_brand_compiled_wiki($1::uuid, $2::uuid, $3::uuid, $4::vector, $5, 3)`,
      [version.rows[0].workspace_id, version.rows[0].brand_id, versionId, `[${vector.join(",")}]`, question],
    );
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
