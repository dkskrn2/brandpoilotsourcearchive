import pg from "pg";

const { Pool } = pg;

const localDatabaseUrl = "postgresql://brand_pilot:brand_pilot_dev@127.0.0.1:54329/brand_pilot";

function removeSslQueryOverrides(url: URL) {
  for (const key of [...url.searchParams.keys()]) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.startsWith("ssl")
      || normalizedKey === "uselibpqcompat"
    ) {
      url.searchParams.delete(key);
    }
  }
}

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
  {
    max = 3,
    idleTimeoutMillis = 10_000,
    connectionTimeoutMillis = 10_000,
    caCertificate,
  }: {
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    caCertificate?: string;
  } = {}
): pg.PoolConfig {
  const url = new URL(connectionString);
  const poolConfig = {
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
  };

  if (
    url.hostname.endsWith(".supabase.com")
    || url.hostname.endsWith(".supabase.co")
  ) {
    removeSslQueryOverrides(url);
    return {
      connectionString: url.toString(),
      ssl: {
        rejectUnauthorized: true,
        ...(caCertificate ? { ca: caCertificate } : {}),
      },
      ...poolConfig
    };
  }

  return { connectionString, ...poolConfig };
}

export function createPool(options: {
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  caCertificate?: string;
} = {}) {
  return new Pool(resolvePoolConfig(resolveDatabaseUrl(), options));
}
