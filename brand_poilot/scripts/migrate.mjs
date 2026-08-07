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
      env.AI_CONTENT_075_PREFLIGHT_EVIDENCE_FILE,
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
  const prerequisiteRoleValues = [
    env.AI_CONTENT_074_SCHEMA_OWNER_ROLE,
    env.AI_CONTENT_074_APPLICATION_ROLE,
    env.AI_CONTENT_074_OPERATOR_ROLE,
    env.AI_CONTENT_074_MIGRATION_ROLE,
    env.AI_CONTENT_074_CLEANUP_ROLE,
  ];
  const hasBootstrapPrerequisiteRoles = prerequisiteRoleValues.some(Boolean);
  const bootstrap074PrerequisiteMode = argv.includes("--bootstrap-074-prerequisite");
  const bootstrap074PrerequisiteProviderRoleName = env.AI_CONTENT_074_PREREQUISITE_PROVIDER_ROLE;
  const allowConsumedRecovery = env.AI_CONTENT_074_ALLOW_CONSUMED_RECOVERY;
  if (allowConsumedRecovery !== undefined && !["true", "false"].includes(allowConsumedRecovery)) {
    throw new Error("bootstrap_074_consumed_recovery_flag_invalid");
  }
  if (hasBootstrapPrerequisiteRoles && (
    prerequisiteRoleValues.some((value) => !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value ?? ""))
    || new Set(prerequisiteRoleValues).size !== prerequisiteRoleValues.length
  )) throw new Error("bootstrap_074_prerequisite_roles_invalid");
  if (bootstrap074PrerequisiteMode
    && !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(bootstrap074PrerequisiteProviderRoleName ?? "")) {
    throw new Error("bootstrap_074_prerequisite_provider_role_required");
  }
  return {
    connectionString: env.SUPABASE_DATABASE_URL || env.DATABASE_URL,
    baselineUpTo: env.MIGRATION_BASELINE_UP_TO,
    dryRun: argv.includes("--dry-run"),
    ...(caCertificate ? { caCertificate } : {}),
    ...(hasBootstrapPrerequisiteRoles ? {
      bootstrap074Prerequisite: {
        schemaOwnerRoleName: env.AI_CONTENT_074_SCHEMA_OWNER_ROLE,
        applicationRoleName: env.AI_CONTENT_074_APPLICATION_ROLE,
        operatorRoleName: env.AI_CONTENT_074_OPERATOR_ROLE,
        migrationRoleName: env.AI_CONTENT_074_MIGRATION_ROLE,
        cleanupRoleName: env.AI_CONTENT_074_CLEANUP_ROLE,
      },
    } : {}),
    ...(bootstrap074PrerequisiteMode ? {
      bootstrap074PrerequisiteMode: true,
      bootstrap074PrerequisiteProviderRoleName,
    } : {}),
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
        allowConsumedRecovery: allowConsumedRecovery === "true",
      },
    } : {}),
    ...(hasCutover075Config ? {
      cutover075Files: {
        cutoverId: env.AI_CONTENT_075_CUTOVER_ID,
        bypassTokenFile: env.AI_CONTENT_075_BYPASS_TOKEN_FILE,
        expectedDatabaseRole: env.AI_CONTENT_075_EXPECTED_DATABASE_ROLE,
        authorizationFile: env.AI_CONTENT_075_ALLOWLIST_AUTHORIZATION_FILE,
        attestationFile: env.AI_CONTENT_075_ALLOWLIST_ATTESTATION_FILE,
        preflightEvidenceFile: env.AI_CONTENT_075_PREFLIGHT_EVIDENCE_FILE,
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
    allowConsumedRecovery: files.allowConsumedRecovery === true,
  };
}

const cutover075PreflightEvidenceKeys = Object.freeze([
  "contractVersion", "cutoverId", "proposalPreflightIdentity",
  "proposalPreflightIdentitySha256", "proposalPreflightTransferSha256",
]);
const proposalPreflightIdentityKeys = Object.freeze([
  "preflightCandidateSha", "contentProposalWorkerImageDigest", "proposalWorkerSourceSha",
  "proposalWorkerTreeSha", "proposalContractSourceSha256", "proposalSchemaSha256",
  "proposalCatalogSha256", "proposalModelId", "proposalCommandDescriptorSha256", "migrationSha256",
]);

export function parseCutover075PreflightEvidence(value, { cutoverId, migrationSha256 }) {
  const keys = value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort() : [];
  const identity = value?.proposalPreflightIdentity;
  const identityKeys = identity && typeof identity === "object" && !Array.isArray(identity)
    ? Object.keys(identity).sort() : [];
  const exactKeys = (actual, expected) => actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index]);
  const hex = (input, length) => new RegExp(`^[0-9a-f]{${length}}$`).test(input ?? "");
  if (!exactKeys(keys, cutover075PreflightEvidenceKeys)
    || !exactKeys(identityKeys, proposalPreflightIdentityKeys)
    || value.contractVersion !== "ai-content-075-proposal-preflight-evidence.v1"
    || value.cutoverId !== cutoverId
    || !hex(identity.preflightCandidateSha, 40)
    || !/^sha256:[0-9a-f]{64}$/.test(identity.contentProposalWorkerImageDigest ?? "")
    || !hex(identity.proposalWorkerSourceSha, 40)
    || !hex(identity.proposalWorkerTreeSha, 40)
    || !hex(identity.proposalContractSourceSha256, 64)
    || !hex(identity.proposalSchemaSha256, 64)
    || !hex(identity.proposalCatalogSha256, 64)
    || identity.proposalModelId !== "gpt-5.6-terra"
    || !hex(identity.proposalCommandDescriptorSha256, 64)
    || identity.migrationSha256 !== migrationSha256
    || !hex(value.proposalPreflightIdentitySha256, 64)
    || !hex(value.proposalPreflightTransferSha256, 64)) {
    throw new Error("cutover_075_preflight_evidence_invalid");
  }
  return {
    proposalPreflightIdentity: identity,
    proposalPreflightIdentitySha256: value.proposalPreflightIdentitySha256,
    proposalPreflightTransferSha256: value.proposalPreflightTransferSha256,
  };
}

async function loadCutover075(files) {
  if (!files) return undefined;
  const [bypassToken, authorizationText, attestationText, authorizationPublicKeyPem,
    providerAttestationPublicKeyPem, preflightEvidenceText] = await Promise.all([
    readSecureCutoverFile(files.bypassTokenFile, { kind: "token", maxBytes: 4096 }),
    readSecureCutoverFile(files.authorizationFile, { kind: "json", maxBytes: 1024*1024 }),
    readSecureCutoverFile(files.attestationFile, { kind: "json", maxBytes: 1024*1024 }),
    readSecureCutoverFile(files.authorizationPublicKeyFile, { kind: "public-key", maxBytes: 64*1024 }),
    readSecureCutoverFile(files.providerAttestationPublicKeyFile, { kind: "public-key", maxBytes: 64*1024 }),
    readSecureCutoverFile(files.preflightEvidenceFile, { kind: "json", maxBytes: 1024*1024 }),
  ]);
  if (!bypassToken) throw new Error("cutover_075_bypass_token_empty");
  const allowlistAuthorization = JSON.parse(authorizationText);
  const proposalPreflight = parseCutover075PreflightEvidence(JSON.parse(preflightEvidenceText), {
    cutoverId: files.cutoverId,
    migrationSha256: allowlistAuthorization?.migrationSha256,
  });
  return {
    cutoverId: files.cutoverId,
    bypassToken,
    expectedDatabaseRole: files.expectedDatabaseRole,
    allowlistAuthorization,
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
    ...proposalPreflight,
  };
}

export async function main({
  env = process.env,
  argv = process.argv,
  loadEnvironment = loadEnvironmentFiles,
  readDatabaseUrlFileImpl = (fileName) => readSecureCutoverFile(fileName, {
    kind: "database-url", maxBytes: 32 * 1024,
  }),
  runMigrationsImpl = runMigrations,
  logger = console,
} = {}) {
  loadEnvironment();
  const databaseUrlFiles = [env.SUPABASE_DATABASE_URL_FILE, env.DATABASE_URL_FILE].filter(Boolean);
  const inlineDatabaseUrls = [env.SUPABASE_DATABASE_URL, env.DATABASE_URL].filter(Boolean);
  if (databaseUrlFiles.length > 1 || (databaseUrlFiles.length > 0 && inlineDatabaseUrls.length > 0)) {
    throw new Error("migration_database_url_input_ambiguous");
  }
  const effectiveEnv = { ...env };
  if (databaseUrlFiles.length === 1) {
    const connectionString = String(await readDatabaseUrlFileImpl(databaseUrlFiles[0])).trim();
    if (!connectionString || connectionString.includes("\0")) {
      throw new Error("migration_database_url_file_invalid");
    }
    effectiveEnv.SUPABASE_DATABASE_URL = connectionString;
    delete effectiveEnv.SUPABASE_DATABASE_URL_FILE;
    delete effectiveEnv.DATABASE_URL_FILE;
  }
  const runtimeConfig = resolveMigrationRuntimeConfig(effectiveEnv, argv);
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
    ...(result.bootstrap074RestartRequired ? {
      bootstrap074RestartRequired: true,
      ...(result.bootstrap074PrerequisiteMigrationId
        ? { bootstrap074PrerequisiteMigrationId: result.bootstrap074PrerequisiteMigrationId }
        : {}),
      ...(result.bootstrap074PrerequisiteProviderRoleName
        ? { bootstrap074PrerequisiteProviderRoleName: result.bootstrap074PrerequisiteProviderRoleName }
        : {}),
      ...(result.bootstrap074Stage ? { bootstrap074Stage: result.bootstrap074Stage } : {}),
      ...(result.cutover075Deferred ? { cutover075Deferred: true } : {}),
    } : {}),
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
