#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  open,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  canonicalJson,
  collectIncidentEvidence,
  writeChecksummedJson,
} from "./ai-content-cutover-evidence.mjs";
import { collectPreservedDataCatalog } from "./ai-content-database-catalog.mjs";
import {
  decodeCaCertificate,
  resolveVerifiedTlsConfig,
} from "./databaseTls.mjs";

const { Client } = pg;

export const INCIDENT_OUTPUT_FILE = "incident-evidence.json";
export const PRESERVED_OUTPUT_FILE = "preserved-data-catalog.json";

const BEGIN_SQL = "begin transaction isolation level repeatable read read only";
const INLINE_DATABASE_URL_KEYS = Object.freeze([
  "SUPABASE_DATABASE_URL",
  "DATABASE_URL",
  "AI_CONTENT_DATABASE_URL",
]);

function requiredOption(options, key) {
  const value = options[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`collector_required_option_missing:${key}`);
  }
  return value;
}

export function parseCollectorArguments(argv = process.argv) {
  if (!Array.isArray(argv)) throw new Error("collector_arguments_invalid");
  const options = new Map();
  const executionGraphRoots = [];
  const allowed = new Set([
    "--admin-url-file",
    "--output-directory",
    "--execution-graph-root",
    "--incident-metadata-file",
    "--page-size",
  ]);
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new Error(`collector_option_unknown:${String(key)}`);
    }
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw new Error(`collector_option_value_missing:${key}`);
    }
    if (key === "--execution-graph-root") {
      if (executionGraphRoots.includes(value)) throw new Error(`collector_option_duplicate:${key}`);
      executionGraphRoots.push(value);
      continue;
    }
    if (options.has(key)) throw new Error(`collector_option_duplicate:${key}`);
    options.set(key, value);
  }
  const adminUrlFile = requiredOption(Object.fromEntries(options), "--admin-url-file");
  const outputDirectory = requiredOption(Object.fromEntries(options), "--output-directory");
  const rawPageSize = options.get("--page-size") ?? "1000";
  if (!/^[1-9][0-9]{0,4}$/.test(rawPageSize)) throw new Error("collector_page_size_invalid");
  const pageSize = Number(rawPageSize);
  if (!Number.isSafeInteger(pageSize) || pageSize > 10_000) throw new Error("collector_page_size_invalid");
  return {
    adminUrlFile,
    outputDirectory,
    executionGraphRoots: executionGraphRoots.length ? executionGraphRoots : ["/app"],
    pageSize,
    ...(options.has("--incident-metadata-file")
      ? { incidentMetadataFile: options.get("--incident-metadata-file") }
      : {}),
  };
}

export function validateSecureOwnedFileMetadata(metadata, {
  platform = process.platform,
  uid = process.getuid?.(),
  maxBytes,
} = {}) {
  if (platform !== "linux" || !Number.isInteger(uid)) {
    throw new Error("collector_secure_file_platform_unsupported");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("collector_secure_file_limit_invalid");
  }
  if (!metadata?.isFile?.()
    || metadata.isSymbolicLink?.()
    || metadata.uid !== uid
    || (metadata.mode & 0o777) !== 0o600
    || !Number.isSafeInteger(metadata.size)
    || metadata.size < 1
    || metadata.size > maxBytes) {
    throw new Error("collector_secure_file_invalid");
  }
}

export async function readSecureOwnedFile(fileName, {
  maxBytes,
  platform = process.platform,
  uid = process.getuid?.(),
} = {}) {
  if (typeof fileName !== "string" || !isAbsolute(fileName)) {
    throw new Error("collector_secure_file_path_invalid");
  }
  if (platform !== "linux" || !Number.isInteger(uid)) {
    throw new Error("collector_secure_file_platform_unsupported");
  }
  const handle = await open(fileName, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    validateSecureOwnedFileMetadata(metadata, { platform, uid, maxBytes });
    const contents = await handle.readFile("utf8");
    if (Buffer.byteLength(contents, "utf8") !== metadata.size || contents.includes("\0")) {
      throw new Error("collector_secure_file_changed");
    }
    return contents;
  } finally {
    await handle.close();
  }
}

function normalizeDatabaseUrl(contents) {
  if (typeof contents !== "string") throw new Error("collector_database_url_file_invalid");
  const value = contents.endsWith("\r\n")
    ? contents.slice(0, -2)
    : contents.endsWith("\n")
      ? contents.slice(0, -1)
      : contents;
  if (!value || value !== value.trim() || /[\r\n\0]/.test(value)) {
    throw new Error("collector_database_url_file_invalid");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("collector_database_url_file_invalid");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)
    || !parsed.hostname
    || !parsed.username
    || parsed.hash) {
    throw new Error("collector_database_url_file_invalid");
  }
  return value;
}

function createCatalogTransactionAdapter(session) {
  let beginSeen = false;
  let terminalBoundary;
  return {
    async query(command) {
      if (!command || typeof command !== "object" || Array.isArray(command)) {
        throw new Error("collector_catalog_query_invalid");
      }
      if (command.name === "ai-content-preserved-begin") {
        if (beginSeen || terminalBoundary
          || command.text !== BEGIN_SQL
          || !Array.isArray(command.values)
          || command.values.length !== 0) {
          throw new Error("collector_catalog_begin_invalid");
        }
        beginSeen = true;
        return { rows: [] };
      }
      if (command.name === "ai-content-preserved-commit") {
        if (!beginSeen || terminalBoundary
          || command.text !== "commit"
          || !Array.isArray(command.values)
          || command.values.length !== 0) {
          throw new Error("collector_catalog_commit_invalid");
        }
        terminalBoundary = "commit";
        return { rows: [] };
      }
      if (command.name === "ai-content-preserved-rollback") {
        if (terminalBoundary
          || command.text !== "rollback"
          || !Array.isArray(command.values)
          || command.values.length !== 0) {
          throw new Error("collector_catalog_rollback_invalid");
        }
        terminalBoundary = "rollback";
        return { rows: [] };
      }
      if (!beginSeen || terminalBoundary) throw new Error("collector_catalog_query_outside_boundary");
      return session.query(command);
    },
    assertCommitted() {
      if (!beginSeen || terminalBoundary !== "commit") {
        throw new Error("collector_catalog_transaction_boundary_incomplete");
      }
    },
  };
}

export async function collectPrepareEvidenceSnapshot(session, {
  metadata = {},
  pageSize = 1000,
  collectIncidentEvidenceImpl = collectIncidentEvidence,
  collectPreservedDataCatalogImpl = collectPreservedDataCatalog,
} = {}) {
  if (!session || typeof session.query !== "function") throw new Error("collector_database_session_invalid");
  let transactionCleanupNeeded = false;
  let rollbackFailure;
  try {
    transactionCleanupNeeded = true;
    await session.query({ name: "ai-content-prepare-begin", text: BEGIN_SQL, values: [] });
    const characteristics = await session.query({
      name: "ai-content-prepare-transaction-characteristics",
      text: `select current_setting('transaction_read_only') as read_only,
                    current_setting('transaction_isolation') as isolation`,
      values: [],
    });
    if (characteristics.rows?.length !== 1
      || characteristics.rows[0]?.read_only !== "on"
      || characteristics.rows[0]?.isolation !== "repeatable read") {
      throw new Error("collector_transaction_characteristics_invalid");
    }

    const incidentBundle = await collectIncidentEvidenceImpl(session, { metadata });
    // The catalog library owns a transaction when used alone. Here its boundary
    // is absorbed so both collectors observe this one verified outer snapshot.
    const catalogAdapter = createCatalogTransactionAdapter(session);
    const preservedCatalog = await collectPreservedDataCatalogImpl(catalogAdapter, {
      failOnMissingRelations: true,
      pageSize,
    });
    catalogAdapter.assertCommitted();
    await session.query({ name: "ai-content-prepare-commit", text: "commit", values: [] });
    transactionCleanupNeeded = false;
    return { incidentBundle, preservedCatalog };
  } catch (error) {
    if (transactionCleanupNeeded) {
      try {
        await session.query({ name: "ai-content-prepare-rollback", text: "rollback", values: [] });
        transactionCleanupNeeded = false;
      } catch (rollbackError) {
        rollbackFailure = rollbackError;
      }
    }
    if (rollbackFailure) {
      throw new AggregateError(
        [error, rollbackFailure],
        "collector_transaction_cleanup_failed",
        { cause: error },
      );
    }
    throw error;
  }
}

function validateOwnedOutputDirectory({ stat }, {
  platform = process.platform,
  uid = process.getuid?.(),
} = {}) {
  return platform === "linux"
    && Number.isInteger(uid)
    && stat.uid === uid
    && (stat.mode & 0o777) === 0o700;
}

async function validateOwnedArtifactFile(path, {
  platform = process.platform,
  uid = process.getuid?.(),
} = {}) {
  if (platform !== "linux" || !Number.isInteger(uid)) return false;
  const metadata = await lstat(path);
  return metadata.isFile()
    && !metadata.isSymbolicLink()
    && metadata.uid === uid
    && (metadata.mode & 0o777) === 0o600;
}

async function syncDirectory(directory) {
  if (process.platform !== "linux") return;
  const handle = await open(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writePrepareEvidenceArtifacts({
  outputDirectory,
  executionGraphRoots,
  incidentBundle,
  preservedCatalog,
  verifyModeRestricted = validateOwnedOutputDirectory,
  verifyArtifactFile = validateOwnedArtifactFile,
  writeChecksummedJsonImpl = writeChecksummedJson,
  linkImpl = link,
  unlinkImpl = unlink,
  syncDirectoryImpl = syncDirectory,
}) {
  if (typeof outputDirectory !== "string" || !isAbsolute(outputDirectory)) {
    throw new Error("output_directory_must_be_absolute");
  }
  const outputMetadata = await lstat(outputDirectory).catch((error) => {
    if (error?.code === "ENOENT") throw new Error("output_directory_not_found");
    throw error;
  });
  if (!outputMetadata.isDirectory() || outputMetadata.isSymbolicLink()) {
    throw new Error("output_directory_invalid");
  }
  const resolvedOutput = await realpath(outputDirectory);
  if (!await verifyModeRestricted({ directory: resolvedOutput, stat: outputMetadata })) {
    throw new Error("output_directory_not_mode_restricted");
  }
  const stagingDirectory = await mkdtemp(join(resolvedOutput, ".prepare-evidence-"));
  await chmod(stagingDirectory, 0o700);
  const staged = [];
  const published = [];
  try {
    const incident = await writeChecksummedJsonImpl({
      outputDirectory: stagingDirectory,
      fileName: INCIDENT_OUTPUT_FILE,
      value: incidentBundle,
      executionGraphRoots,
      verifyModeRestricted,
    });
    staged.push(incident.jsonPath, incident.checksumPath);

    const preserved = await writeChecksummedJsonImpl({
      outputDirectory: stagingDirectory,
      fileName: PRESERVED_OUTPUT_FILE,
      value: preservedCatalog,
      executionGraphRoots,
      verifyModeRestricted,
    });
    staged.push(preserved.jsonPath, preserved.checksumPath);

    const publication = [
      [incident.jsonPath, join(resolvedOutput, INCIDENT_OUTPUT_FILE)],
      [incident.checksumPath, join(resolvedOutput, `${INCIDENT_OUTPUT_FILE}.sha256`)],
      [preserved.jsonPath, join(resolvedOutput, PRESERVED_OUTPUT_FILE)],
      [preserved.checksumPath, join(resolvedOutput, `${PRESERVED_OUTPUT_FILE}.sha256`)],
    ];
    for (const [source, target] of publication) {
      try {
        await linkImpl(source, target);
      } catch (error) {
        if (error?.code === "EEXIST") throw new Error("output_file_exists", { cause: error });
        throw error;
      }
      published.push(target);
      if (!await verifyArtifactFile(target)) throw new Error("collector_output_file_not_mode_restricted");
    }
    await syncDirectoryImpl(resolvedOutput);

    for (const path of [...staged].reverse()) await unlinkImpl(path);
    staged.length = 0;
    await rmdir(stagingDirectory);
    await syncDirectoryImpl(resolvedOutput);
    return {
      incident: {
        ...incident,
        jsonPath: join(resolvedOutput, INCIDENT_OUTPUT_FILE),
        checksumPath: join(resolvedOutput, `${INCIDENT_OUTPUT_FILE}.sha256`),
      },
      preserved: {
        ...preserved,
        jsonPath: join(resolvedOutput, PRESERVED_OUTPUT_FILE),
        checksumPath: join(resolvedOutput, `${PRESERVED_OUTPUT_FILE}.sha256`),
      },
    };
  } catch (error) {
    const cleanupFailures = [];
    for (const path of [...published, ...staged].reverse()) {
      try {
        await unlinkImpl(path);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") cleanupFailures.push(cleanupError);
      }
    }
    try {
      await rmdir(stagingDirectory);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") cleanupFailures.push(cleanupError);
    }
    if (cleanupFailures.length) {
      throw new AggregateError(
        [error, ...cleanupFailures],
        "collector_output_cleanup_failed",
        { cause: error },
      );
    }
    throw error;
  }
}

async function collectWithClient(client, options) {
  let primaryError;
  let value;
  try {
    await client.connect();
    value = await options.collectPrepareEvidenceSnapshotImpl(client, options.snapshotOptions);
  } catch (error) {
    primaryError = error;
  }
  try {
    await client.end();
  } catch (endError) {
    if (primaryError) {
      throw new AggregateError([primaryError, endError], "collector_database_close_failed", { cause: primaryError });
    }
    throw endError;
  }
  if (primaryError) throw primaryError;
  return value;
}

export async function main({
  argv = process.argv,
  env = process.env,
  readSecureFileImpl = readSecureOwnedFile,
  createClientImpl = (config) => new Client(config),
  collectPrepareEvidenceSnapshotImpl = collectPrepareEvidenceSnapshot,
  writePrepareEvidenceArtifactsImpl = writePrepareEvidenceArtifacts,
  logger = console,
} = {}) {
  if (INLINE_DATABASE_URL_KEYS.some((key) => typeof env[key] === "string" && env[key].length > 0)) {
    throw new Error("collector_inline_database_url_forbidden");
  }
  const options = parseCollectorArguments(argv);
  const databaseUrl = normalizeDatabaseUrl(await readSecureFileImpl(options.adminUrlFile, {
    maxBytes: 32 * 1024,
  }));
  let metadata = {};
  if (options.incidentMetadataFile) {
    try {
      metadata = JSON.parse(await readSecureFileImpl(options.incidentMetadataFile, {
        maxBytes: 1024 * 1024,
      }));
    } catch (error) {
      throw new Error("collector_incident_metadata_file_invalid", { cause: error });
    }
  }
  const caCertificate = decodeCaCertificate(env.DB_SSL_CA_BASE64);
  const client = createClientImpl({
    ...resolveVerifiedTlsConfig(databaseUrl, { caCertificate }),
    application_name: "ai-content-prepare-evidence-collector",
    connectionTimeoutMillis: 15_000,
    query_timeout: 15 * 60_000,
    statement_timeout: 15 * 60_000,
  });
  const { incidentBundle, preservedCatalog } = await collectWithClient(client, {
    collectPrepareEvidenceSnapshotImpl,
    snapshotOptions: { metadata, pageSize: options.pageSize },
  });
  const artifacts = await writePrepareEvidenceArtifactsImpl({
    outputDirectory: options.outputDirectory,
    executionGraphRoots: options.executionGraphRoots,
    incidentBundle,
    preservedCatalog,
  });
  const result = {
    contractVersion: "ai-content-prepare-evidence-collection.v1",
    incidentFile: INCIDENT_OUTPUT_FILE,
    incidentSha256: artifacts.incident.sha256,
    preservedFile: PRESERVED_OUTPUT_FILE,
    preservedSha256: artifacts.preserved.sha256,
  };
  logger.log(canonicalJson(result));
  return result;
}

function safeCliError(error) {
  const message = error instanceof Error ? error.message : "";
  const safePrefixes = [
    "collector_",
    "incident_",
    "preserved_relation_not_found:",
    "preserved_relation_kind_invalid:",
  ];
  if (/^[A-Za-z0-9_.:-]+$/.test(message)
    && safePrefixes.some((prefix) => message.startsWith(prefix))) return message;
  return "ai_content_prepare_evidence_collection_failed";
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(safeCliError(error));
    process.exitCode = 1;
  });
}
