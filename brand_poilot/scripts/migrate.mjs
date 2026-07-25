import process from "node:process";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import { decodeCaCertificate } from "./databaseTls.mjs";
import { runMigrations } from "./migrationRunner.mjs";

function loadEnvironmentFiles() {
  config({ path: ".env" });
  config({ path: ".env.local", override: true });
  config({ path: "apps/api/.env", override: true });
  config({ path: "apps/api/.env.local", override: true });
}

export function resolveMigrationRuntimeConfig(
  env = process.env,
  argv = process.argv,
) {
  const caCertificate = decodeCaCertificate(env.DB_SSL_CA_BASE64);
  return {
    connectionString: env.SUPABASE_DATABASE_URL || env.DATABASE_URL,
    baselineUpTo: env.MIGRATION_BASELINE_UP_TO,
    dryRun: argv.includes("--dry-run"),
    ...(caCertificate ? { caCertificate } : {}),
  };
}

export async function main({
  env = process.env,
  argv = process.argv,
  loadEnvironment = loadEnvironmentFiles,
  runMigrationsImpl = runMigrations,
  logger = console,
} = {}) {
  loadEnvironment();
  const result = await runMigrationsImpl(
    resolveMigrationRuntimeConfig(env, argv),
  );

  logger.log(JSON.stringify({
    applied: result.pending,
    migrationCount: result.migrations.length,
    baselineRequired: result.baselineRequired,
  }, null, 2));
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "migration_failed");
    process.exitCode = 1;
  });
}
