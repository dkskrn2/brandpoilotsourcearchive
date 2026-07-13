import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl, resolvePoolConfig } from "./db";

describe("resolvePoolConfig", () => {
  it("uses TLS without certificate verification for a Supabase pooler URL", () => {
    const config = resolvePoolConfig(
      "postgresql://postgres.project:secret@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require"
    );

    expect(config.connectionString).not.toContain("sslmode=");
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("keeps local Docker Postgres configuration unchanged", () => {
    const connectionString = "postgresql://brand_pilot:brand_pilot_dev@127.0.0.1:54329/brand_pilot";

    expect(resolvePoolConfig(connectionString)).toEqual({ connectionString });
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

  it("limits the pool inside a Vercel function instance", () => {
    const config = resolvePoolConfig(
      "postgresql://postgres.project:secret@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require",
      { serverless: true }
    );

    expect(config).toMatchObject({
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000
    });
  });
});
