import { describe, expect, it } from "vitest";
import { resolveDmPoolConfig } from "./db.js";

describe("resolveDmPoolConfig", () => {
  it("uses explicit Supabase TLS settings without sslmode conflicts", () => {
    const config = resolveDmPoolConfig("postgresql://user:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require");

    expect(config.connectionString).not.toContain("sslmode=");
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("keeps local PostgreSQL connections unchanged", () => {
    const connectionString = "postgresql://user:password@127.0.0.1:5432/brand_pilot";

    expect(resolveDmPoolConfig(connectionString)).toEqual({ connectionString });
  });
});
