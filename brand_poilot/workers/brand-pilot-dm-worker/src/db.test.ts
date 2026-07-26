import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import pg from "pg";
import * as database from "./db.js";

const { resolveDmPoolConfig } = database;

describe("resolveDmPoolConfig", () => {
  it("uses verified Supabase TLS and bounded worker defaults", () => {
    const config = resolveDmPoolConfig("postgresql://user:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require");

    expect(config.connectionString).not.toContain("sslmode=");
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(config).toMatchObject({
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  });

  it("bounds local PostgreSQL worker connections without adding TLS", () => {
    const connectionString = "postgresql://user:password@127.0.0.1:5432/brand_pilot";

    expect(resolveDmPoolConfig(connectionString)).toEqual({
      connectionString,
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  });

  it("adds a provided CA certificate to verified Supabase TLS", () => {
    const config = resolveDmPoolConfig(
      "postgresql://user:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require",
      { caCertificate: "test-ca" },
    );

    expect(config.ssl).toEqual({
      rejectUnauthorized: true,
      ca: "test-ca",
    });
  });

  it("uses verified TLS for direct Supabase database hosts", () => {
    const config = resolveDmPoolConfig(
      "postgresql://postgres:secret@db.project.supabase.co:5432/postgres?sslmode=require",
    );

    expect(config.connectionString).not.toContain("sslmode=");
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("removes duplicate case-insensitive SSL overrides before pg parses them", () => {
    const config = resolveDmPoolConfig(
      "postgresql://postgres:secret@db.project.supabase.co:5432/postgres"
        + "?ssl=0&SSL=no-verify&ssl=no-verify&sslmode=disable&SSLMODE=no-verify"
        + "&sslcert=ignored&sslkey=ignored&sslrootcert=ignored"
        + "&sslnegotiation=direct&uselibpqcompat=true",
      { caCertificate: "test-ca" },
    );
    const overrideKeys = [...new URL(config.connectionString!).searchParams.keys()]
      .filter((key) => key.toLowerCase().startsWith("ssl")
        || key.toLowerCase() === "uselibpqcompat");

    expect(overrideKeys).toEqual([]);
    const client = new pg.Client(config);
    const parsedClient = client as typeof client & {
      connectionParameters: { ssl: unknown };
    };
    expect(parsedClient.connectionParameters.ssl).toEqual({
      rejectUnauthorized: true,
      ca: "test-ca",
    });
  });

  it("does not classify lookalike domains as Supabase", () => {
    const connectionString = "postgresql://user:secret@db.project.supabase.co.evil.example/postgres?ssl=no-verify";
    const config = resolveDmPoolConfig(connectionString);

    expect(config.connectionString).toBe(connectionString);
    expect(config.ssl).toBeUndefined();
  });

  it("honors explicit worker pool limits", () => {
    const config = resolveDmPoolConfig(
      "postgresql://user:password@127.0.0.1:5432/brand_pilot",
      {
        max: 4,
        idleTimeoutMillis: 12_000,
        connectionTimeoutMillis: 8_000,
      },
    );

    expect(config).toEqual({
      connectionString: "postgresql://user:password@127.0.0.1:5432/brand_pilot",
      max: 4,
      idleTimeoutMillis: 12_000,
      connectionTimeoutMillis: 8_000,
    });
  });
});

describe("resolveDmWorkerDatabaseConfig", () => {
  it("strictly decodes the optional CA for the shared DM and Wiki database", () => {
    expect(typeof database.resolveDmWorkerDatabaseConfig).toBe("function");
    const certificate = "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----";

    expect(database.resolveDmWorkerDatabaseConfig!({
      DM_WORKER_DATABASE_URL: "  postgresql://worker.example/brand_pilot  ",
      DB_SSL_CA_BASE64: Buffer.from(certificate).toString("base64"),
    })).toEqual({
      connectionString: "postgresql://worker.example/brand_pilot",
      options: { caCertificate: certificate },
    });
  });

  it("fails closed on invalid CA input before returning database options", () => {
    expect(typeof database.resolveDmWorkerDatabaseConfig).toBe("function");

    expect(() => database.resolveDmWorkerDatabaseConfig!({
      DM_WORKER_DATABASE_URL: "postgresql://worker.example/brand_pilot",
      DB_SSL_CA_BASE64: "not%%%base64",
    })).toThrow("DB_SSL_CA_BASE64");
  });

  it("wires one CA-aware database instance into both worker lanes", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

    expect(source).toContain("resolveDmWorkerDatabaseConfig(process.env)");
    expect(source).toContain(
      "createDmWorkerDb(databaseConfig.connectionString, databaseConfig.options)",
    );
    expect(source.match(/createDmWorkerDb\(/g)).toHaveLength(1);
    expect(source).toMatch(/runDmWorkerOnce\(common\)/);
    expect(source).toMatch(/runCompiledWikiSourceItemOnce\(\{[\s\S]*?\bdb,/);
  });

  it("documents the optional CA environment input for worker deployment", async () => {
    const example = await readFile(
      new URL("../.env.example", import.meta.url),
      "utf8",
    );

    expect(example).toMatch(/^DB_SSL_CA_BASE64=$/m);
  });

  it("collects approved product-service records and parses every source-kind row", async () => {
    const source = await readFile(new URL("./db.ts", import.meta.url), "utf8");

    expect(source).toMatch(
      /select 'product_service' as source_kind, item\.id as source_id[\s\S]*from product_services item[\s\S]*join product_service_versions active/,
    );
    expect(source).toMatch(/entry\.status <> 'legacy_projection'/);
    expect(source).toMatch(
      /case when \$4 in \('faq', 'product', 'service', 'policy', 'guide'\) then \$5::uuid end/,
    );
    expect(source).toMatch(
      /case when \$4 = 'product_service' then \$5::uuid end/,
    );
    expect(source.match(/source_kind in \('product', 'product_service', 'service'\)/g))
      .toHaveLength(3);
    expect(source.match(/parseWikiSourceKind\(/g)).toHaveLength(2);
  });
});
