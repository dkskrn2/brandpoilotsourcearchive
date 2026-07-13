import pg from "pg";

const { Pool } = pg;

const localDatabaseUrl = "postgresql://brand_pilot:brand_pilot_dev@127.0.0.1:54329/brand_pilot";

export function resolveDatabaseUrl({
  supabaseDatabaseUrl = process.env.SUPABASE_DATABASE_URL,
  databaseUrl = process.env.DATABASE_URL,
  nodeEnv = process.env.NODE_ENV
}: {
  supabaseDatabaseUrl?: string;
  databaseUrl?: string;
  nodeEnv?: string;
} = {}) {
  const configuredUrl = supabaseDatabaseUrl?.trim() || databaseUrl?.trim();
  if (configuredUrl) return configuredUrl;
  if (nodeEnv === "production") throw new Error("database_url_required");
  return localDatabaseUrl;
}

export function resolvePoolConfig(
  connectionString = resolveDatabaseUrl(),
  { serverless = false }: { serverless?: boolean } = {}
): pg.PoolConfig {
  const url = new URL(connectionString);
  const serverlessConfig = serverless ? {
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000
  } : {};

  if (url.hostname.endsWith(".supabase.com")) {
    // node-postgres treats sslmode=require as certificate verification. Supavisor
    // uses a chain not available in this local runtime, so configure TLS explicitly.
    url.searchParams.delete("sslmode");
    return {
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: false },
      ...serverlessConfig
    };
  }

  return { connectionString, ...serverlessConfig };
}

export function createPool() {
  return new Pool(resolvePoolConfig(resolveDatabaseUrl(), { serverless: Boolean(process.env.VERCEL) }));
}
