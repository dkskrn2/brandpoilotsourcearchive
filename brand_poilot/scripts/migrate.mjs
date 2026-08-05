import process from "node:process";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
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
    ...(env.AI_CONTENT_074_AUTHORIZATION_FILE ? {
      bootstrap074Files: {
        authorizationFile: env.AI_CONTENT_074_AUTHORIZATION_FILE,
        authorizationKeyFile: env.AI_CONTENT_074_AUTHORIZATION_KEY_FILE,
        providerAttestationFile: env.AI_CONTENT_074_PROVIDER_ATTESTATION_FILE,
        providerAttestationKeyFile: env.AI_CONTENT_074_PROVIDER_ATTESTATION_KEY_FILE,
        imageDigest: env.AI_CONTENT_F_API_IMAGE_DIGEST,
        imageSourceLabel: env.AI_CONTENT_F_API_SOURCE_LABEL,
        roleCatalogSha256: env.AI_CONTENT_DATABASE_ROLE_CATALOG_SHA256,
        objectCatalogSha256: env.AI_CONTENT_074_OBJECT_CATALOG_SHA256,
      },
    } : {}),
  };
}

async function loadBootstrap074(files) {
  if (!files) return undefined;
  if (!files.authorizationKeyFile) throw new Error("bootstrap_role_authorization_key_file_required");
  const authorization = JSON.parse(await readFile(files.authorizationFile, "utf8"));
  const signingKey = (await readFile(files.authorizationKeyFile, "utf8")).trim();
  let providerAttestation;
  let providerSigningKey;
  if (files.providerAttestationFile) {
    if (!files.providerAttestationKeyFile) throw new Error("provider_attestation_key_file_required");
    providerAttestation = JSON.parse(await readFile(files.providerAttestationFile, "utf8"));
    providerSigningKey = (await readFile(files.providerAttestationKeyFile, "utf8")).trim();
  }
  return {
    authorization,
    signingKey,
    providerAttestation,
    providerSigningKey,
    imageDigest: files.imageDigest,
    imageSourceLabel: files.imageSourceLabel,
    roleCatalogSha256: files.roleCatalogSha256,
    objectCatalogSha256: files.objectCatalogSha256,
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
  const runtimeConfig = resolveMigrationRuntimeConfig(env, argv);
  const { bootstrap074Files, ...migrationConfig } = runtimeConfig;
  const bootstrap074 = await loadBootstrap074(bootstrap074Files);
  const result = await runMigrationsImpl({
    ...migrationConfig,
    ...(bootstrap074 ? { bootstrap074 } : {}),
  });

  logger.log(JSON.stringify({
    applied: result.pending,
    migrationCount: result.migrations.length,
    baselineRequired: result.baselineRequired,
    ...(result.providerInstallRequest ? { providerInstallRequest: result.providerInstallRequest } : {}),
    ...(result.revocationRequest ? { revocationRequest: result.revocationRequest } : {}),
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
