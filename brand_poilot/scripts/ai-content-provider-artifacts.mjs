import { createHash } from "node:crypto";
import { lstat, open, readFile, realpath, stat } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  canonicalMembershipRevocationEnvelope,
  hashProviderEventTriggerInstallRequest,
} from "./migrationRunner.mjs";

const roleNames = Object.freeze({
  schemaOwnerRoleName: "content_schema_owner",
  applicationRoleName: "content_application",
  operatorRoleName: "content_operator",
  migrationRoleName: "content_migration",
  cleanupRoleName: "content_cleanup",
});
const stageEvidenceKeys = Object.freeze([
  "applied", "migrationCount", "baselineRequired", "bootstrap074RestartRequired",
  "bootstrap074Stage", "cutover075Deferred", "providerInstallRequest",
]);
const consumeEvidenceKeys = Object.freeze([...stageEvidenceKeys, "revocationRequest"]);
const roleEvidenceKeys = Object.freeze([
  "contractVersion", "planSha256", "roleCatalogSha256", "objectCatalogSha256",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function exactHash(value, size = 64) {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${size}}$`).test(value);
}

function exactUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

// JSON.parse accepts duplicate keys and silently keeps the last one. Deployment evidence is a
// trust boundary, so this small recursive parser rejects duplicates before JSON.parse is used.
export function parseStrictJson(source) {
  if (typeof source !== "string") throw new Error("ai_content_artifact_json_invalid");
  let offset = 0;
  const whitespace = () => { while (/\s/u.test(source[offset] ?? "")) offset += 1; };
  const fail = (code = "ai_content_artifact_json_invalid") => { throw new Error(code); };
  const parseString = () => {
    if (source[offset] !== '"') fail();
    const start = offset++;
    while (offset < source.length) {
      const character = source[offset++];
      if (character === '"') {
        try { return JSON.parse(source.slice(start, offset)); } catch { fail(); }
      }
      if (character === "\\") {
        const escape = source[offset++];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(offset, offset + 4))) fail();
          offset += 4;
        } else if (!'"\\/bfnrt'.includes(escape ?? "")) fail();
      } else if (character.charCodeAt(0) < 0x20) fail();
    }
    fail();
  };
  const parseValue = () => {
    whitespace();
    if (source[offset] === "{") {
      offset += 1;
      whitespace();
      const keys = new Set();
      if (source[offset] === "}") { offset += 1; return; }
      while (offset < source.length) {
        const key = parseString();
        if (keys.has(key)) fail("ai_content_artifact_json_duplicate_key");
        keys.add(key);
        whitespace();
        if (source[offset++] !== ":") fail();
        parseValue();
        whitespace();
        const separator = source[offset++];
        if (separator === "}") return;
        if (separator !== ",") fail();
        whitespace();
      }
      fail();
    }
    if (source[offset] === "[") {
      offset += 1;
      whitespace();
      if (source[offset] === "]") { offset += 1; return; }
      while (offset < source.length) {
        parseValue();
        whitespace();
        const separator = source[offset++];
        if (separator === "]") return;
        if (separator !== ",") fail();
      }
      fail();
    }
    if (source[offset] === '"') { parseString(); return; }
    const scalar = source.slice(offset).match(/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/u)?.[0];
    if (!scalar) fail();
    offset += scalar.length;
  };
  parseValue();
  whitespace();
  if (offset !== source.length) fail();
  try { return JSON.parse(source); } catch { throw new Error("ai_content_artifact_json_invalid"); }
}

function validateInstallRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)
    || !exactHash(request.requestSha256)) {
    throw new Error("ai_content_074_install_request_invalid");
  }
  const { requestSha256, ...payload } = request;
  if (hashProviderEventTriggerInstallRequest(payload) !== requestSha256) {
    throw new Error("ai_content_074_install_request_invalid");
  }
  return request;
}

export function parse074StageEvidence(raw, { validateInstallRequest: validate = validateInstallRequest } = {}) {
  const evidence = parseStrictJson(raw);
  if (!exactKeys(evidence, stageEvidenceKeys)
    || !Array.isArray(evidence.applied)
    || !Number.isInteger(evidence.migrationCount) || evidence.migrationCount < 1
    || evidence.baselineRequired !== false
    || evidence.bootstrap074RestartRequired !== true
    || evidence.bootstrap074Stage !== "provider_install_required"
    || evidence.cutover075Deferred !== true) {
    throw new Error("ai_content_074_stage_evidence_invalid");
  }
  return structuredClone(validate(evidence.providerInstallRequest));
}

export function parse074ConsumeEvidence(raw, expectedRevocation, {
  canonicalRevocation = canonicalMembershipRevocationEnvelope,
} = {}) {
  const evidence = parseStrictJson(raw);
  if (!exactKeys(evidence, consumeEvidenceKeys)
    || !Array.isArray(evidence.applied)
    || !Number.isInteger(evidence.migrationCount) || evidence.migrationCount < 1
    || evidence.baselineRequired !== false
    || evidence.bootstrap074RestartRequired !== true
    || !["provider_evidence_consumed", "provider_evidence_already_consumed"].includes(evidence.bootstrap074Stage)
    || evidence.cutover075Deferred !== true) {
    throw new Error("ai_content_074_consume_evidence_invalid");
  }
  let actualCanonical;
  let expectedCanonical;
  try {
    actualCanonical = canonicalRevocation(evidence.revocationRequest);
    expectedCanonical = canonicalRevocation(expectedRevocation);
  } catch {
    throw new Error("ai_content_074_revocation_mismatch");
  }
  if (actualCanonical !== expectedCanonical) throw new Error("ai_content_074_revocation_mismatch");
  return structuredClone(evidence.revocationRequest);
}

async function secureBuffer(fileName, maxBytes = 1024 * 1024) {
  if (typeof fileName !== "string" || !fileName) throw new Error("ai_content_secure_file_invalid");
  const inputMetadata = await lstat(fileName);
  if (inputMetadata.isSymbolicLink()) throw new Error("ai_content_secure_file_invalid");
  const resolved = await realpath(fileName);
  const metadata = await stat(resolved);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > maxBytes
    || (process.platform !== "win32"
      && ((metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid?.()))) {
    throw new Error("ai_content_secure_file_invalid");
  }
  return readFile(resolved);
}

async function secureJson(fileName) {
  return parseStrictJson((await secureBuffer(fileName)).toString("utf8"));
}

export async function buildPrepareBody({
  cutoverId, releaseSha, bypassTokenFile, cleanupTokenFile, roleVerificationFile,
  providerBackupId, providerSnapshotCreatedAt, incidentBundleFile,
  preservedDataManifestFile, proposalPreflightFile,
}) {
  if (!exactUuid(cutoverId) || !exactHash(releaseSha, 40)
    || typeof providerBackupId !== "string" || !/^[A-Za-z0-9._:/-]{1,256}$/.test(providerBackupId)
    || typeof providerSnapshotCreatedAt !== "string"
    || Number.isNaN(Date.parse(providerSnapshotCreatedAt))
    || new Date(providerSnapshotCreatedAt).toISOString() !== providerSnapshotCreatedAt) {
    throw new Error("ai_content_prepare_body_input_invalid");
  }
  const [bypassToken, cleanupToken, roleEvidence, incidentBundle, preservedDataManifest, preflight] = await Promise.all([
    secureBuffer(bypassTokenFile, 1024), secureBuffer(cleanupTokenFile, 1024), secureJson(roleVerificationFile),
    secureBuffer(incidentBundleFile), secureBuffer(preservedDataManifestFile), secureJson(proposalPreflightFile),
  ]);
  if (!/^[a-f0-9]{64}$/.test(bypassToken.toString("utf8"))
    || !/^[a-f0-9]{64}$/.test(cleanupToken.toString("utf8"))) {
    throw new Error("ai_content_cutover_token_invalid");
  }
  if (!exactKeys(roleEvidence, roleEvidenceKeys)
    || roleEvidence.contractVersion !== "ai-content-database-role-verification.v1"
    || !exactHash(roleEvidence.planSha256) || !exactHash(roleEvidence.roleCatalogSha256)
    || !exactHash(roleEvidence.objectCatalogSha256)) {
    throw new Error("ai_content_role_verification_evidence_invalid");
  }
  if (preflight?.contractVersion !== "ai-content-075-proposal-preflight-evidence.v1"
    || preflight.cutoverId !== cutoverId
    || preflight.proposalPreflightIdentity?.preflightCandidateSha !== releaseSha) {
    throw new Error("ai_content_proposal_preflight_binding_invalid");
  }
  return {
    contractVersion: "ai-content-cutover-prepare-evidence.v1",
    cutoverId,
    roleNames: structuredClone(roleNames),
    bypassTokenSha256: sha256(bypassToken),
    cleanupTokenSha256: sha256(cleanupToken),
    databaseRoleCatalogSha256: roleEvidence.roleCatalogSha256,
    providerBackupId,
    providerSnapshotCreatedAt,
    incidentBundleSha256: sha256(incidentBundle),
    preservedDataManifestSha256: sha256(preservedDataManifest),
    proposalPreflight: preflight,
    intendedReleaseSha: releaseSha,
  };
}

async function exclusiveJson(fileName, value) {
  const handle = await open(fileName, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); } finally { await handle.close(); }
}

function parseCli(argv) {
  const mode = argv[2];
  const args = {};
  for (let index = 3; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--") || argv[index + 1] === undefined || args[key.slice(2)] !== undefined) {
      throw new Error("ai_content_provider_artifacts_cli_invalid");
    }
    args[key.slice(2)] = argv[index + 1];
  }
  const required = {
    "--extract-074-install-request": ["stage-evidence-file", "output"],
    "--parse-074-consume-evidence": ["consume-evidence-file", "revocation-file", "output"],
    "--create-prepare-body": [
      "cutover-id", "release-sha", "bypass-token-file", "cleanup-token-file",
      "role-verification-file", "provider-backup-id", "provider-snapshot-created-at",
      "incident-bundle-file", "preserved-data-manifest-file", "proposal-preflight-file", "output",
    ],
  }[mode];
  if (!required || JSON.stringify(Object.keys(args).sort()) !== JSON.stringify([...required].sort())) {
    throw new Error("ai_content_provider_artifacts_cli_invalid");
  }
  return { mode, args };
}

async function main(argv = process.argv) {
  const { mode, args } = parseCli(argv);
  if (mode === "--extract-074-install-request") {
    const value = parse074StageEvidence((await secureBuffer(args["stage-evidence-file"])).toString("utf8"));
    await exclusiveJson(args.output, value);
    return;
  }
  if (mode === "--parse-074-consume-evidence") {
    const expected = await secureJson(args["revocation-file"]);
    const value = parse074ConsumeEvidence(
      (await secureBuffer(args["consume-evidence-file"])).toString("utf8"), expected,
    );
    await exclusiveJson(args.output, value);
    return;
  }
  const value = await buildPrepareBody({
    cutoverId: args["cutover-id"], releaseSha: args["release-sha"],
    bypassTokenFile: args["bypass-token-file"], cleanupTokenFile: args["cleanup-token-file"],
    roleVerificationFile: args["role-verification-file"], providerBackupId: args["provider-backup-id"],
    providerSnapshotCreatedAt: args["provider-snapshot-created-at"],
    incidentBundleFile: args["incident-bundle-file"],
    preservedDataManifestFile: args["preserved-data-manifest-file"],
    proposalPreflightFile: args["proposal-preflight-file"],
  });
  await exclusiveJson(args.output, value);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "ai_content_provider_artifacts_failed"}\n`);
    process.exitCode = 1;
  });
}
