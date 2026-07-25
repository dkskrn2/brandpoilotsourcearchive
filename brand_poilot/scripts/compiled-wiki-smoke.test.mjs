import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";

const smokeModule = await import("./compiled-wiki-smoke.mjs");

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
