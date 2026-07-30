import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";

const smokeModule = await import("./compiled-wiki-smoke.mjs");

function remoteSmokeHarness({ status = "ready", searchRows = [] } = {}) {
  const poolQueries = [];
  const transactionQueries = [];
  let connectCount = 0;
  const version = {
    id: "version-1",
    workspace_id: "workspace-1",
    brand_id: "brand-1",
    status,
  };
  const queryResult = async (sql, values, calls) => {
    calls.push({ sql: String(sql), values });
    if (/^\s*(begin|commit|rollback)\s*$/i.test(sql)) return { rowCount: null, rows: [] };
    if (String(sql).includes("from wiki_versions")) return { rowCount: 1, rows: [{ ...version }] };
    if (String(sql).includes("activate_compiled_wiki_version")) {
      return { rowCount: 1, rows: [{ activated: true }] };
    }
    if (String(sql).includes("search_brand_wiki_lexical")) {
      return { rowCount: searchRows.length, rows: searchRows };
    }
    if (String(sql).includes("from wiki_page_sources source")) {
      return {
        rowCount: 1,
        rows: [{ id: "source-link-1", source_kind: "faq", source_id: "faq-1" }],
      };
    }
    throw new Error(`unexpected_query:${sql}`);
  };
  const client = {
    query: (sql, values) => queryResult(sql, values, transactionQueries),
    release() {},
  };
  return {
    pool: {
      query: (sql, values) => queryResult(sql, values, poolQueries),
      async connect() {
        connectCount += 1;
        return client;
      },
    },
    poolQueries,
    transactionQueries,
    connectCount: () => connectCount,
  };
}

test("importing the compiled Wiki smoke module does not execute it", async () => {
  await assert.doesNotReject(() => import("./compiled-wiki-smoke.mjs"));
});

test("compiled Wiki smoke uses verified TLS for Supabase pooler hosts", () => {
  assert.equal(typeof smokeModule.resolveSmokePoolConfig, "function");
  const config = smokeModule.resolveSmokePoolConfig(
    "postgresql://user:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require",
  );

  assert.doesNotMatch(config.connectionString, /sslmode=/);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("compiled Wiki smoke uses verified TLS for direct Supabase hosts", () => {
  assert.equal(typeof smokeModule.resolveSmokePoolConfig, "function");
  const config = smokeModule.resolveSmokePoolConfig(
    "postgresql://postgres:secret@db.project.supabase.co:5432/postgres?sslmode=require",
  );

  assert.doesNotMatch(config.connectionString, /sslmode=/);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("compiled Wiki smoke includes a provided CA in verified TLS", () => {
  assert.equal(typeof smokeModule.resolveSmokePoolConfig, "function");
  const config = smokeModule.resolveSmokePoolConfig(
    "postgresql://user:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require",
    { caCertificate: "test-ca" },
  );

  assert.deepEqual(config.ssl, {
    rejectUnauthorized: true,
    ca: "test-ca",
  });
});

test("compiled Wiki smoke preserves non-Supabase connection behavior", () => {
  assert.equal(typeof smokeModule.resolveSmokePoolConfig, "function");
  const connectionString = "postgresql://user:password@127.0.0.1:5432/brand_pilot";

  assert.deepEqual(
    smokeModule.resolveSmokePoolConfig(connectionString),
    { connectionString },
  );
});

test("compiled Wiki smoke strips duplicate case-insensitive SSL overrides before pg parses them", () => {
  const config = smokeModule.resolveSmokePoolConfig(
    "postgresql://postgres:secret@db.project.supabase.co:5432/postgres"
      + "?ssl=0&SSL=no-verify&ssl=no-verify&sslmode=disable&SSLMODE=no-verify"
      + "&sslcert=ignored&sslkey=ignored&sslrootcert=ignored"
      + "&sslnegotiation=direct&uselibpqcompat=true",
    { caCertificate: "test-ca" },
  );
  const overrideKeys = [...new URL(config.connectionString).searchParams.keys()]
    .filter((key) => key.toLowerCase().startsWith("ssl")
      || key.toLowerCase() === "uselibpqcompat");

  assert.deepEqual(overrideKeys, []);
  const pool = new pg.Pool(config);
  const client = new pg.Client(pool.options);
  assert.deepEqual(client.connectionParameters.ssl, {
    rejectUnauthorized: true,
    ca: "test-ca",
  });
});

test("compiled Wiki smoke does not classify lookalike domains as Supabase", () => {
  const connectionString = "postgresql://user:secret@db.project.supabase.co.evil.example/postgres?ssl=no-verify";

  assert.deepEqual(
    smokeModule.resolveSmokePoolConfig(connectionString),
    { connectionString },
  );
});

test("compiled Wiki smoke strictly decodes the optional CA environment value", () => {
  assert.equal(typeof smokeModule.decodeCaCertificate, "function");
  const certificate = "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----";

  assert.equal(
    smokeModule.decodeCaCertificate(Buffer.from(certificate).toString("base64")),
    certificate,
  );
  assert.equal(smokeModule.decodeCaCertificate(undefined), undefined);
  assert.throws(
    () => smokeModule.decodeCaCertificate("not%%%base64"),
    /DB_SSL_CA_BASE64/,
  );
});

test("compiled Wiki smoke source contains no disabled certificate verification", async () => {
  const source = await readFile(
    new URL("./compiled-wiki-smoke.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /rejectUnauthorized\s*:\s*false/);
});

test("compiled Wiki smoke searches lexically without an OpenAI key or embedding call", async () => {
  const source = await readFile(
    new URL("./compiled-wiki-smoke.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /OPENAI_API_KEY|OPENAI_EMBEDDING_MODEL|api\.openai\.com/);
  assert.doesNotMatch(source, /search_brand_compiled_wiki/);
  assert.match(source, /search_brand_wiki_lexical/);
});

test("keyless local compiled Wiki smoke executes lexical chunk retrieval", async () => {
  const result = await smokeModule.runLocalCompiledWikiContractSmoke();

  assert.equal(result.retrievalMode, "search_brand_wiki_lexical");
  assert.equal(result.retrievedChunkCount, 1);
  assert.deepEqual(result.activeSourceKinds, ["faq"]);
});

test("ready activation rolls back when lexical smoke assertions fail", async () => {
  const harness = remoteSmokeHarness({ searchRows: [] });

  await assert.rejects(
    smokeModule.runDatabaseCompiledWikiSmoke({
      pool: harness.pool,
      versionId: "version-1",
      activate: true,
      questions: ["검색 실패 질문"],
    }),
    /compiled_wiki_smoke_empty_results/,
  );

  const statements = harness.transactionQueries.map(({ sql }) => sql.trim().toLowerCase());
  assert.equal(statements[0], "begin");
  assert.ok(statements.some((sql) => sql.includes("activate_compiled_wiki_version")));
  assert.ok(statements.some((sql) => sql.includes("search_brand_wiki_lexical")));
  assert.equal(statements.at(-1), "rollback");
  assert.equal(statements.includes("commit"), false);
});

test("ready activation commits only after lexical and source assertions pass", async () => {
  const harness = remoteSmokeHarness({
    searchRows: [{
      page_type: "faq",
      title: "운영 시간",
      source_link_ids: ["source-link-1"],
      cosine_similarity: 0,
      keyword_match: 0.8,
      rrf_score: 4.2,
    }],
  });

  const result = await smokeModule.runDatabaseCompiledWikiSmoke({
    pool: harness.pool,
    versionId: "version-1",
    activate: true,
    questions: ["운영 시간"],
  });

  const statements = harness.transactionQueries.map(({ sql }) => sql.trim().toLowerCase());
  const activationIndex = statements.findIndex((sql) => sql.includes("activate_compiled_wiki_version"));
  const retrievalIndex = statements.findIndex((sql) => sql.includes("search_brand_wiki_lexical"));
  const sourceIndex = statements.findIndex((sql) => sql.includes("from wiki_page_sources source"));
  assert.equal(result.activated, true);
  assert.ok(activationIndex < retrievalIndex);
  assert.ok(retrievalIndex < sourceIndex);
  assert.ok(sourceIndex < statements.indexOf("commit"));
  assert.equal(statements.includes("rollback"), false);
});

test("active-version smoke remains read-only and does not acquire a transaction client", async () => {
  const harness = remoteSmokeHarness({
    status: "active",
    searchRows: [{
      page_type: "faq",
      title: "운영 시간",
      source_link_ids: ["source-link-1"],
      cosine_similarity: 0,
      keyword_match: 0.8,
      rrf_score: 4.2,
    }],
  });

  const result = await smokeModule.runDatabaseCompiledWikiSmoke({
    pool: harness.pool,
    versionId: "version-1",
    activate: false,
    questions: ["운영 시간"],
  });

  assert.equal(result.activated, false);
  assert.equal(harness.connectCount(), 0);
  assert.equal(
    harness.poolQueries.some(({ sql }) => /\b(begin|commit|rollback|activate_compiled_wiki_version)\b/i.test(sql)),
    false,
  );
});
