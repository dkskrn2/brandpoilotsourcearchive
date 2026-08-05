import process from "node:process";
import { constants as fsConstants } from "node:fs";
import { pathToFileURL } from "node:url";
import { open, readFile } from "node:fs/promises";
import { config } from "dotenv";
import { decodeCaCertificate } from "./databaseTls.mjs";
import { runMigrations } from "./migrationRunner.mjs";

function loadEnvironmentFiles() {
  config({ path: ".env" });
  config({ path: ".env.local", override: true });
  config({ path: "apps/api/.env", override: true });
  config({ path: "apps/api/.env.local", override: true });
}

export function validateSecureCutoverFileMetadata(metadata, { platform, uid, maxBytes }) {
  if (platform === "win32" || !Number.isInteger(uid)) {
    throw new Error("cutover_075_secure_file_platform_unsupported");
  }
  if (!metadata?.isFile?.() || metadata.isSymbolicLink?.() || metadata.uid !== uid
    || (metadata.mode & 0o077) !== 0 || !Number.isInteger(metadata.size)
    || metadata.size <= 0 || metadata.size > maxBytes) {
    throw new Error("cutover_075_secure_file_invalid");
  }
}

async function readSecureCutoverFile(fileName, {
  kind,
  maxBytes,
  platform = process.platform,
  uid = process.getuid?.(),
}) {
  if (platform === "win32" || !Number.isInteger(uid)) {
    throw new Error("cutover_075_secure_file_platform_unsupported");
  }
  const handle = await open(fileName, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    validateSecureCutoverFileMetadata(metadata, { platform, uid, maxBytes });
    const contents = await handle.readFile("utf8");
    if (Buffer.byteLength(contents) !== metadata.size || contents.includes("\0")) {
      throw new Error("cutover_075_secure_file_changed");
    }
    if (kind === "token" && (contents.includes("\r") || contents.includes("\n"))) {
      throw new Error("cutover_075_bypass_token_ambiguous");
    }
    return contents;
  } finally {
    await handle.close();
  }
}

export function resolveMigrationRuntimeConfig(
  env = process.env,
  argv = process.argv,
) {
  if (env.AI_CONTENT_075_BYPASS_TOKEN
    || Object.keys(env).some((key) => /^AI_CONTENT_07[45]_/.test(key)
    && (/(?:PRIVATE|SIGNING)/.test(key) || /(?<!PUBLIC_)KEY_FILE$/.test(key)))) {
    throw new Error(env.AI_CONTENT_075_BYPASS_TOKEN
      ? "cutover_075_secret_input_forbidden"
      : "private_key_input_forbidden");
  }
  const hasCutover075Config = Object.keys(env).some((key) => /^AI_CONTENT_075_/.test(key));
  if (hasCutover075Config) {
    const required = [
      env.AI_CONTENT_075_CUTOVER_ID,
      env.AI_CONTENT_075_BYPASS_TOKEN_FILE,
      env.AI_CONTENT_075_EXPECTED_DATABASE_ROLE,
      env.AI_CONTENT_075_ALLOWLIST_AUTHORIZATION_FILE,
      env.AI_CONTENT_075_ALLOWLIST_ATTESTATION_FILE,
      env.AI_CONTENT_075_AUTHORIZATION_PUBLIC_KEY_FILE,
      env.AI_CONTENT_075_AUTHORIZATION_KEY_ID,
      env.AI_CONTENT_075_AUTHORIZATION_PUBLIC_KEY_SHA256,
      env.AI_CONTENT_075_PROVIDER_ATTESTATION_PUBLIC_KEY_FILE,
      env.AI_CONTENT_075_PROVIDER_ATTESTATION_KEY_ID,
      env.AI_CONTENT_075_PROVIDER_ATTESTATION_PUBLIC_KEY_SHA256,
    ];
    if (required.some((value) => typeof value !== "string" || value.length === 0)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(env.AI_CONTENT_075_CUTOVER_ID)
      || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(env.AI_CONTENT_075_EXPECTED_DATABASE_ROLE)
      || !/^[A-Za-z0-9._:-]{1,128}$/.test(env.AI_CONTENT_075_AUTHORIZATION_KEY_ID)
      || !/^[A-Za-z0-9._:-]{1,128}$/.test(env.AI_CONTENT_075_PROVIDER_ATTESTATION_KEY_ID)
      || !/^[0-9a-f]{64}$/.test(env.AI_CONTENT_075_AUTHORIZATION_PUBLIC_KEY_SHA256)
      || !/^[0-9a-f]{64}$/.test(env.AI_CONTENT_075_PROVIDER_ATTESTATION_PUBLIC_KEY_SHA256)) {
      throw new Error("cutover_075_public_config_required");
    }
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
    ...(hasCutover075Config ? {
      cutover075Files: {
        cutoverId: env.AI_CONTENT_075_CUTOVER_ID,
        bypassTokenFile: env.AI_CONTENT_075_BYPASS_TOKEN_FILE,
        expectedDatabaseRole: env.AI_CONTENT_075_EXPECTED_DATABASE_ROLE,
        authorizationFile: env.AI_CONTENT_075_ALLOWLIST_AUTHORIZATION_FILE,
        attestationFile: env.AI_CONTENT_075_ALLOWLIST_ATTESTATION_FILE,
        authorizationPublicKeyFile: env.AI_CONTENT_075_AUTHORIZATION_PUBLIC_KEY_FILE,
        authorizationKeyId: env.AI_CONTENT_075_AUTHORIZATION_KEY_ID,
        authorizationPublicKeySha256: env.AI_CONTENT_075_AUTHORIZATION_PUBLIC_KEY_SHA256,
        providerAttestationPublicKeyFile: env.AI_CONTENT_075_PROVIDER_ATTESTATION_PUBLIC_KEY_FILE,
        providerAttestationKeyId: env.AI_CONTENT_075_PROVIDER_ATTESTATION_KEY_ID,
        providerAttestationPublicKeySha256: env.AI_CONTENT_075_PROVIDER_ATTESTATION_PUBLIC_KEY_SHA256,
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

async function loadCutover075(files) {
  if (!files) return undefined;
  const [bypassToken, authorizationText, attestationText, authorizationPublicKeyPem,
    providerAttestationPublicKeyPem] = await Promise.all([
    readSecureCutoverFile(files.bypassTokenFile, { kind: "token", maxBytes: 4096 }),
    readSecureCutoverFile(files.authorizationFile, { kind: "json", maxBytes: 1024*1024 }),
    readSecureCutoverFile(files.attestationFile, { kind: "json", maxBytes: 1024*1024 }),
    readSecureCutoverFile(files.authorizationPublicKeyFile, { kind: "public-key", maxBytes: 64*1024 }),
    readSecureCutoverFile(files.providerAttestationPublicKeyFile, { kind: "public-key", maxBytes: 64*1024 }),
  ]);
  if (!bypassToken) throw new Error("cutover_075_bypass_token_empty");
  return {
    cutoverId: files.cutoverId,
    bypassToken,
    expectedDatabaseRole: files.expectedDatabaseRole,
    allowlistAuthorization: JSON.parse(authorizationText),
    allowlistAttestation: JSON.parse(attestationText),
    authorizationVerification: {
      publicKeyPem: authorizationPublicKeyPem,
      expectedKeyId: files.authorizationKeyId,
      expectedPublicKeySha256: files.authorizationPublicKeySha256,
    },
    providerAttestationVerification: {
      publicKeyPem: providerAttestationPublicKeyPem,
      expectedKeyId: files.providerAttestationKeyId,
      expectedPublicKeySha256: files.providerAttestationPublicKeySha256,
    },
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
  const { bootstrap074Files, cutover075Files, ...migrationConfig } = runtimeConfig;
  const bootstrap074 = await loadBootstrap074(bootstrap074Files);
  const cutover = await loadCutover075(cutover075Files);
  const result = await runMigrationsImpl({
    ...migrationConfig,
    ...(bootstrap074 ? { bootstrap074 } : {}),
    ...(cutover ? { cutover } : {}),
  });

  logger.log(JSON.stringify({
    applied: result.pending,
    migrationCount: result.migrations.length,
    baselineRequired: result.baselineRequired,
    ...(result.providerInstallRequest ? { providerInstallRequest: result.providerInstallRequest } : {}),
    ...(result.revocationRequest ? { revocationRequest: result.revocationRequest } : {}),
    ...(result.cutover ? { cutover: result.cutover } : {}),
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
