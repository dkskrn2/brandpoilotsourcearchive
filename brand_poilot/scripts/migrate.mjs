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
  if (Object.keys(env).some((key) => /^AI_CONTENT_074_/.test(key)
    && (/(?:PRIVATE|SIGNING)/.test(key) || /(?<!PUBLIC_)KEY_FILE$/.test(key)))) {
    throw new Error("private_key_input_forbidden");
  }
  if (env.AI_CONTENT_074_AUTHORIZATION_FILE) {
    const requiredPublicConfig = [
      env.AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_FILE,
      env.AI_CONTENT_074_AUTHORIZATION_KEY_ID,
      env.AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_SHA256,
      env.AI_CONTENT_074_PROVIDER_ATTESTATION_PUBLIC_KEY_FILE,
      env.AI_CONTENT_074_PROVIDER_ATTESTATION_KEY_ID,
      env.AI_CONTENT_074_PROVIDER_ATTESTATION_PUBLIC_KEY_SHA256,
    ];
    if (requiredPublicConfig.some((value) => typeof value !== "string" || value.length === 0)
      || !/^[A-Za-z0-9._:-]{1,128}$/.test(env.AI_CONTENT_074_AUTHORIZATION_KEY_ID)
      || !/^[A-Za-z0-9._:-]{1,128}$/.test(env.AI_CONTENT_074_PROVIDER_ATTESTATION_KEY_ID)
      || !/^[0-9a-f]{64}$/.test(env.AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_SHA256)
      || !/^[0-9a-f]{64}$/.test(env.AI_CONTENT_074_PROVIDER_ATTESTATION_PUBLIC_KEY_SHA256)) {
      throw new Error("bootstrap_074_public_key_config_required");
    }
  }
  const caCertificate = decodeCaCertificate(env.DB_SSL_CA_BASE64);
  return {
    connectionString: env.SUPABASE_DATABASE_URL || env.DATABASE_URL,
    baselineUpTo: env.MIGRATION_BASELINE_UP_TO,
    dryRun: argv.includes("--dry-run"),
    ...(caCertificate ? { caCertificate } : {}),
    ...(env.AI_CONTENT_074_AUTHORIZATION_FILE ? {
      bootstrap074Files: {
        authorizationFile: env.AI_CONTENT_074_AUTHORIZATION_FILE,
        authorizationPublicKeyFile: env.AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_FILE,
        authorizationKeyId: env.AI_CONTENT_074_AUTHORIZATION_KEY_ID,
        authorizationPublicKeySha256: env.AI_CONTENT_074_AUTHORIZATION_PUBLIC_KEY_SHA256,
        providerAttestationFile: env.AI_CONTENT_074_PROVIDER_ATTESTATION_FILE,
        providerAttestationPublicKeyFile: env.AI_CONTENT_074_PROVIDER_ATTESTATION_PUBLIC_KEY_FILE,
        providerAttestationKeyId: env.AI_CONTENT_074_PROVIDER_ATTESTATION_KEY_ID,
        providerAttestationPublicKeySha256: env.AI_CONTENT_074_PROVIDER_ATTESTATION_PUBLIC_KEY_SHA256,
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
  const authorization = JSON.parse(await readFile(files.authorizationFile, "utf8"));
  const authorizationPublicKeyPem = await readFile(files.authorizationPublicKeyFile, "utf8");
  const providerAttestationPublicKeyPem = await readFile(files.providerAttestationPublicKeyFile, "utf8");
  let providerAttestation;
  if (files.providerAttestationFile) {
    providerAttestation = JSON.parse(await readFile(files.providerAttestationFile, "utf8"));
  }
  return {
    authorization,
    authorizationVerification: {
      publicKeyPem: authorizationPublicKeyPem,
      expectedKeyId: files.authorizationKeyId,
      expectedPublicKeySha256: files.authorizationPublicKeySha256,
    },
    providerAttestation,
    providerAttestationVerification: {
      publicKeyPem: providerAttestationPublicKeyPem,
      expectedKeyId: files.providerAttestationKeyId,
      expectedPublicKeySha256: files.providerAttestationPublicKeySha256,
    },
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
