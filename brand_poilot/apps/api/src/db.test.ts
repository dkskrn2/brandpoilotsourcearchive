import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  assertDatabaseIdentity,
  readDatabaseUrlSecret,
  resolveDatabaseUrl,
  resolvePoolConfig,
} from "./db";

describe("resolvePoolConfig", () => {
  it("accepts only the sealed content-application session identity", async () => {
    await expect(assertDatabaseIdentity({
      query: async () => ({ rows: [{ session_user: "content_application", current_user: "content_application" }] }),
    }, "content_application")).resolves.toBeUndefined();
    await expect(assertDatabaseIdentity({
      query: async () => ({ rows: [{ session_user: "postgres", current_user: "postgres" }] }),
    }, "content_application")).rejects.toThrow("database_identity_invalid");
  });

  it("reads one database URL from the dedicated secret without returning surrounding whitespace", () => {
    const reads: string[] = [];
    const value = readDatabaseUrlSecret("/run/secrets/ai_content_application_database_url", {
      readFile(path) {
        reads.push(path);
        return "postgresql://content_application:secret@database.example/brand_pilot\n";
      },
    });

    expect(reads).toEqual(["/run/secrets/ai_content_application_database_url"]);
    expect(value).toBe("postgresql://content_application:secret@database.example/brand_pilot");
  });

  it("rejects an empty, passwordless, or non-PostgreSQL database secret", () => {
    expect(() => readDatabaseUrlSecret("/run/secrets/ai_content_application_database_url", {
      readFile: () => "\n",
    })).toThrow("database_url_secret_invalid");
    expect(() => readDatabaseUrlSecret("/run/secrets/ai_content_application_database_url", {
      readFile: () => "https://database.example/brand_pilot\n",
    })).toThrow("database_url_secret_invalid");
    expect(() => readDatabaseUrlSecret("/run/secrets/ai_content_application_database_url", {
      readFile: () => "postgresql://content_application@database.example/brand_pilot\n",
    })).toThrow("database_url_secret_invalid");
  });

  it("uses verified TLS and bounded defaults for a Supabase pooler URL", () => {
    const config = resolvePoolConfig(
      "postgresql://postgres.project:secret@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require"
    );

    expect(config.connectionString).not.toContain("sslmode=");
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(config).toMatchObject({
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  });

  it("bounds local Docker Postgres connections without adding TLS", () => {
    const connectionString = "postgresql://brand_pilot:brand_pilot_dev@127.0.0.1:54329/brand_pilot";

    expect(resolvePoolConfig(connectionString)).toEqual({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  });

  it("adds a provided CA certificate to verified Supabase TLS", () => {
    const config = resolvePoolConfig(
      "postgresql://postgres.project:secret@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require",
      { caCertificate: "test-ca" },
    );

    expect(config.ssl).toEqual({
      rejectUnauthorized: true,
      ca: "test-ca",
    });
  });

  it("uses verified TLS for direct Supabase database hosts", () => {
    const config = resolvePoolConfig(
      "postgresql://postgres:secret@db.project.supabase.co:5432/postgres?sslmode=require",
    );

    expect(config.connectionString).not.toContain("sslmode=");
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("removes duplicate case-insensitive SSL overrides before pg parses them", () => {
    const config = resolvePoolConfig(
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
    const config = resolvePoolConfig(connectionString);

    expect(config.connectionString).toBe(connectionString);
    expect(config.ssl).toBeUndefined();
  });

  it("prefers the explicit Supabase URL for the central API", () => {
    expect(resolveDatabaseUrl({
      supabaseDatabaseUrl: "postgresql://supabase.example/postgres",
      databaseUrl: "postgresql://127.0.0.1/local",
      nodeEnv: "production"
    })).toBe("postgresql://supabase.example/postgres");
  });

  it("refuses to use the local fallback in production", () => {
    expect(() => resolveDatabaseUrl({ nodeEnv: "production" })).toThrow("database_url_required");
  });

  it("applies explicit central API pool limits outside Vercel", () => {
    const config = resolvePoolConfig(
      "postgresql://127.0.0.1/brand_pilot",
      {
        max: 4,
        idleTimeoutMillis: 12_000,
        connectionTimeoutMillis: 8_000,
        caCertificate: "test-ca",
      },
    );

    expect(config).toEqual({
      connectionString: "postgresql://127.0.0.1/brand_pilot",
      max: 4,
      idleTimeoutMillis: 12_000,
      connectionTimeoutMillis: 8_000,
    });
  });
});
