import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

import { decodeCaCertificate, resolveVerifiedTlsConfig } from "./databaseTls.mjs";
import { loadMigrations } from "./migrationRunner.mjs";

const PREPARE_CONTRACT_VERSION = "ai-content-cutover-prepare-evidence.v1";
const PREFLIGHT_CONTRACT_VERSION = "ai-content-075-proposal-preflight-evidence.v1";
const MODEL_ID = "gpt-5.6-terra";

const prepareBodyKeys = Object.freeze([
  "contractVersion", "cutoverId", "roleNames", "bypassTokenSha256", "cleanupTokenSha256",
  "databaseRoleCatalogSha256", "providerBackupId", "providerSnapshotCreatedAt",
  "incidentBundleSha256", "preservedDataManifestSha256", "proposalPreflight",
  "intendedReleaseSha",
]);
const prepareEvidenceKeys = Object.freeze([...prepareBodyKeys, "prepareEvidenceSha256"]);
const roleNameKeys = Object.freeze([
  "schemaOwnerRoleName", "applicationRoleName", "operatorRoleName", "migrationRoleName",
  "cleanupRoleName",
]);
const preflightKeys = Object.freeze([
  "contractVersion", "cutoverId", "proposalPreflightIdentity",
  "proposalPreflightIdentitySha256", "proposalPreflightTransferSha256",
]);
const preflightIdentityKeys = Object.freeze([
  "preflightCandidateSha", "contentProposalWorkerImageDigest", "proposalWorkerSourceSha",
  "proposalWorkerTreeSha", "proposalContractSourceSha256", "proposalSchemaSha256",
  "proposalCatalogSha256", "proposalModelId", "proposalCommandDescriptorSha256",
  "migrationSha256",
]);
const cleanupRetirementBodyKeys = Object.freeze([
  "contractVersion", "planSha256", "cutoverId", "cutoverMigrationId",
  "cutoverMigrationSha256", "providerSessionUser", "cleanupRoleName", "retiredAt",
  "outboxRowCount", "outboxStatusCatalogSha256", "sharedOwnerCatalogSha256",
  "sharedThirdPartyAclSha256", "cleanupRoleCatalogSha256", "cleanupAclCatalogSha256",
  "cleanupMembershipCatalogSha256",
]);
const cleanupRetirementEvidenceKeys = Object.freeze([
  ...cleanupRetirementBodyKeys, "evidenceSha256",
]);
const backendEvidenceBodyKeys = Object.freeze([
  "contractVersion", "cutoverId", "candidateReleaseSha",
  "sharedOwnerRestoreEvidenceSha256", "maintenanceEnabled", "apiServices", "workers",
  "verifiedAt",
]);
const backendEvidenceKeys = Object.freeze([...backendEvidenceBodyKeys, "evidenceSha256"]);
const backendApiKeys = Object.freeze([
  "serviceName", "imageDigest", "databaseSessionUser",
  "databaseCurrentUser", "readiness", "health", "verifiedAt",
]);
const backendWorkerKeys = Object.freeze([
  "serviceName", "imageDigest", "verificationKind", "observedStatus",
  "observedAt", "observationEvidenceSha256",
]);
const backendApiServices = Object.freeze(["api-canary", "api-primary"]);
const backendWorkerServices = Object.freeze([
  "content-proposal-worker-1", "image-worker-1",
  "card-news-worker-1", "blog-worker-1", "reel-worker-1",
]);
const preMarkerStatuses = Object.freeze(new Set([
  "prepared", "maintenance_verified", "abandoned_pre_marker",
]));
const postMarkerStatuses = Object.freeze(new Set([
  "migration_body_complete", "backend_verified", "completed",
]));
const activeStatuses = Object.freeze(new Set([
  "prepared", "maintenance_verified", "migration_body_complete", "backend_verified",
]));

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (record(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Canonical(value) {
  return sha256(canonicalJson(value));
}

function hasExactKeys(value, keys) {
  return record(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function exactUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function exactHash(value, length = 64) {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
}

function exactIsoTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function normalizeDatabaseTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return exactIsoTimestamp(value) ? value : null;
}

function validateRoleNames(value) {
  if (!hasExactKeys(value, roleNameKeys)
    || Object.values(value).some((name) => typeof name !== "string"
      || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name))
    || new Set(Object.values(value)).size !== roleNameKeys.length) {
    throw new Error("ai_content_cutover_prepare_evidence_invalid");
  }
}

function expectedCommandDescriptorSha256(proposalSchemaSha256) {
  return sha256Canonical({
    runner: "codex-exec",
    modelId: MODEL_ID,
    promptVersion: "proposal.writer.v3",
    outputSchemaSha256: proposalSchemaSha256,
    proposalContractVersion: "content-proposal.v2",
    baseInputContractVersion: "proposal-base-input.v2",
  });
}

function validateProposalPreflight(value, cutoverId) {
  const identity = value?.proposalPreflightIdentity;
  if (!hasExactKeys(value, preflightKeys)
    || value.contractVersion !== PREFLIGHT_CONTRACT_VERSION
    || value.cutoverId !== cutoverId
    || !hasExactKeys(identity, preflightIdentityKeys)
    || !exactHash(identity.preflightCandidateSha, 40)
    || !/^sha256:[0-9a-f]{64}$/.test(identity.contentProposalWorkerImageDigest ?? "")
    || !exactHash(identity.proposalWorkerSourceSha, 40)
    || !exactHash(identity.proposalWorkerTreeSha, 40)
    || !exactHash(identity.proposalContractSourceSha256)
    || !exactHash(identity.proposalSchemaSha256)
    || !exactHash(identity.proposalCatalogSha256)
    || identity.proposalModelId !== MODEL_ID
    || !exactHash(identity.proposalCommandDescriptorSha256)
    || identity.proposalCommandDescriptorSha256
      !== expectedCommandDescriptorSha256(identity.proposalSchemaSha256)
    || !exactHash(identity.migrationSha256)
    || value.proposalPreflightIdentitySha256 !== sha256Canonical(identity)
    || !exactHash(value.proposalPreflightTransferSha256)) {
    throw new Error("ai_content_cutover_prepare_evidence_invalid");
  }
}

function validatePrepareBody(value) {
  if (!hasExactKeys(value, prepareBodyKeys)
    || value.contractVersion !== PREPARE_CONTRACT_VERSION
    || !exactUuid(value.cutoverId)
    || !exactHash(value.bypassTokenSha256)
    || !exactHash(value.cleanupTokenSha256)
    || !exactHash(value.databaseRoleCatalogSha256)
    || typeof value.providerBackupId !== "string"
    || !/^[A-Za-z0-9._:/-]{1,256}$/.test(value.providerBackupId)
    || typeof value.providerSnapshotCreatedAt !== "string"
    || Number.isNaN(Date.parse(value.providerSnapshotCreatedAt))
    || new Date(value.providerSnapshotCreatedAt).toISOString() !== value.providerSnapshotCreatedAt
    || !exactHash(value.incidentBundleSha256)
    || !exactHash(value.preservedDataManifestSha256)
    || !exactHash(value.intendedReleaseSha, 40)
    || value.proposalPreflight?.proposalPreflightIdentity?.preflightCandidateSha
      !== value.intendedReleaseSha) {
    throw new Error("ai_content_cutover_prepare_evidence_invalid");
  }
  validateRoleNames(value.roleNames);
  validateProposalPreflight(value.proposalPreflight, value.cutoverId);
  return value;
}

export function createPrepareEvidence(rawBody) {
  const body = structuredClone(validatePrepareBody(rawBody));
  return Object.freeze({ ...body, prepareEvidenceSha256: sha256Canonical(body) });
}

export function parsePrepareEvidence(rawEvidence) {
  let evidence = rawEvidence;
  if (typeof evidence === "string") {
    try { evidence = JSON.parse(evidence); }
    catch { throw new Error("ai_content_cutover_prepare_evidence_invalid"); }
  }
  if (!hasExactKeys(evidence, prepareEvidenceKeys) || !exactHash(evidence.prepareEvidenceSha256)) {
    throw new Error("ai_content_cutover_prepare_evidence_invalid");
  }
  const { prepareEvidenceSha256, ...body } = evidence;
  validatePrepareBody(body);
  if (prepareEvidenceSha256 !== sha256Canonical(body)) {
    throw new Error("ai_content_cutover_prepare_evidence_checksum_invalid");
  }
  return Object.freeze(structuredClone(evidence));
}

export async function parseCleanupRoleRetirementEvidence(rawEvidence) {
  let evidence = rawEvidence;
  if (typeof evidence === "string") {
    try { evidence = JSON.parse(evidence); }
    catch { throw new Error("ai_content_cleanup_role_retirement_evidence_invalid"); }
  }
  if (!hasExactKeys(evidence, cleanupRetirementEvidenceKeys)
    || evidence.contractVersion !== "ai-content-cleanup-role-retirement-evidence.v1"
    || !exactHash(evidence.planSha256)
    || !exactUuid(evidence.cutoverId)
    || evidence.cutoverMigrationId !== "075_ai_content_three_format_cutover.sql"
    || !exactHash(evidence.cutoverMigrationSha256)
    || evidence.providerSessionUser !== "postgres"
    || evidence.cleanupRoleName !== "content_cleanup"
    || !exactIsoTimestamp(evidence.retiredAt)
    || !Number.isInteger(evidence.outboxRowCount) || evidence.outboxRowCount < 0
    || [
      "outboxStatusCatalogSha256", "sharedOwnerCatalogSha256",
      "sharedThirdPartyAclSha256", "cleanupRoleCatalogSha256", "cleanupAclCatalogSha256",
      "cleanupMembershipCatalogSha256", "evidenceSha256",
    ].some((key) => !exactHash(evidence[key]))) {
    throw new Error("ai_content_cleanup_role_retirement_evidence_invalid");
  }
  const body = Object.fromEntries(cleanupRetirementBodyKeys.map((key) => [key, evidence[key]]));
  if (evidence.evidenceSha256 !== sha256Canonical(body)) {
    throw new Error("ai_content_cleanup_role_retirement_evidence_invalid");
  }
  const migration = (await loadMigrations()).find(({ id }) => id === evidence.cutoverMigrationId);
  if (!migration || migration.checksum !== evidence.cutoverMigrationSha256) {
    throw new Error("ai_content_cleanup_role_retirement_migration_identity_invalid");
  }
  return Object.freeze(structuredClone(evidence));
}

export function parseBackendVerificationEvidence(rawEvidence, expected = {}) {
  let evidence = rawEvidence;
  if (typeof evidence === "string") {
    try { evidence = JSON.parse(evidence); }
    catch { throw new Error("ai_content_cutover_backend_evidence_invalid"); }
  }
  const expectedServices = [...backendApiServices, ...backendWorkerServices];
  if (!hasExactKeys(expected, [
    "cutoverId", "candidateReleaseSha", "sharedOwnerRestoreEvidenceSha256", "imageDigests",
  ])
    || !exactUuid(expected.cutoverId) || !exactHash(expected.candidateReleaseSha, 40)
    || !exactHash(expected.sharedOwnerRestoreEvidenceSha256)
    || !hasExactKeys(expected.imageDigests, expectedServices)
    || Object.values(expected.imageDigests).some((value) => !/^sha256:[0-9a-f]{64}$/.test(value))) {
    throw new Error("ai_content_cutover_backend_expected_identity_invalid");
  }
  if (!hasExactKeys(evidence, backendEvidenceKeys)
    || evidence.contractVersion !== "ai-content-backend-verification-evidence.v1"
    || evidence.cutoverId !== expected.cutoverId
    || evidence.candidateReleaseSha !== expected.candidateReleaseSha
    || evidence.sharedOwnerRestoreEvidenceSha256 !== expected.sharedOwnerRestoreEvidenceSha256
    || evidence.maintenanceEnabled !== true
    || !exactIsoTimestamp(evidence.verifiedAt)
    || !Array.isArray(evidence.apiServices)
    || evidence.apiServices.length !== backendApiServices.length
    || !Array.isArray(evidence.workers)
    || evidence.workers.length !== backendWorkerServices.length
    || !exactHash(evidence.evidenceSha256)) {
    throw new Error("ai_content_cutover_backend_evidence_invalid");
  }
  const verifiedAt = Date.parse(evidence.verifiedAt);
  for (let index = 0; index < evidence.apiServices.length; index += 1) {
    const service = evidence.apiServices[index];
    const expectedServiceName = backendApiServices[index];
    if (!hasExactKeys(service, backendApiKeys)
      || service.serviceName !== expectedServiceName
      || service.imageDigest !== expected.imageDigests[expectedServiceName]
      || service.databaseSessionUser !== "content_application"
      || service.databaseCurrentUser !== "content_application"
      || service.readiness !== "ready" || service.health !== "healthy"
      || !exactIsoTimestamp(service.verifiedAt) || Date.parse(service.verifiedAt) > verifiedAt) {
      throw new Error("ai_content_cutover_backend_evidence_invalid");
    }
  }
  for (let index = 0; index < evidence.workers.length; index += 1) {
    const worker = evidence.workers[index];
    const expectedServiceName = backendWorkerServices[index];
    const proposalWorker = expectedServiceName === "content-proposal-worker-1";
    if (!hasExactKeys(worker, backendWorkerKeys)
      || worker.serviceName !== expectedServiceName
      || worker.imageDigest !== expected.imageDigests[expectedServiceName]
      || worker.verificationKind !== (proposalWorker
        ? "maintenance_safe_idle_heartbeat"
        : "authenticated_claim_maintenance_fence")
      || worker.observedStatus !== (proposalWorker
        ? "heartbeat_verified"
        : "ai_content_maintenance_503")
      || !exactIsoTimestamp(worker.observedAt)
      || Date.parse(worker.observedAt) > verifiedAt
      || !exactHash(worker.observationEvidenceSha256)) {
      throw new Error("ai_content_cutover_backend_evidence_invalid");
    }
  }
  const body = Object.fromEntries(backendEvidenceBodyKeys.map((key) => [key, evidence[key]]));
  if (evidence.evidenceSha256 !== sha256Canonical(body)) {
    throw new Error("ai_content_cutover_backend_evidence_invalid");
  }
  return Object.freeze(structuredClone(evidence));
}

export function createBackendVerificationEvidence(rawBody, expected = {}) {
  const body = structuredClone(rawBody);
  return parseBackendVerificationEvidence({
    ...body,
    evidenceSha256: sha256Canonical(body),
  }, expected);
}

function requireEventHash(value) {
  if (!exactHash(value)) throw new Error("ai_content_cutover_database_result_invalid");
  return value;
}

export async function prepareCutover(client, rawEvidence) {
  const evidence = parsePrepareEvidence(rawEvidence);
  const cutoverMigration = (await loadMigrations()).find(
    ({ id }) => id === "075_ai_content_three_format_cutover.sql",
  );
  if (!cutoverMigration
    || evidence.proposalPreflight.proposalPreflightIdentity.migrationSha256
      !== cutoverMigration.checksum) {
    throw new Error("ai_content_cutover_migration_identity_invalid");
  }
  const before = await readControlStateRow(client, evidence.cutoverId);
  if (before.requested_cutover_exists !== false || before.cutover_status !== null
    || before.marker_present !== false || before.maintenance_enabled !== false
    || before.maintenance_cutover_id !== null || controlCount(before.active_cutover_count) !== 0
    || before.active_cutover_id !== null) {
    throw new Error("ai_content_cutover_prepare_state_invalid");
  }
  const roles = evidence.roleNames;
  const result = await client.query(
    `select public.prepare_ai_content_cutover(
       $1::uuid,$2::name,$3::name,$4::name,$5::name,$6::name,
       $7::text,$8::text,$9::text,$10::text,$11::timestamptz,$12::text,$13::text,
       $14::jsonb,$15::text,$16::text,$17::text,$18::text
     ) as event_sha256`,
    [
      evidence.cutoverId,
      roles.schemaOwnerRoleName,
      roles.applicationRoleName,
      roles.operatorRoleName,
      roles.migrationRoleName,
      roles.cleanupRoleName,
      evidence.bypassTokenSha256,
      evidence.cleanupTokenSha256,
      evidence.databaseRoleCatalogSha256,
      evidence.providerBackupId,
      evidence.providerSnapshotCreatedAt,
      evidence.incidentBundleSha256,
      evidence.preservedDataManifestSha256,
      JSON.stringify(evidence.proposalPreflight.proposalPreflightIdentity),
      evidence.proposalPreflight.proposalPreflightIdentitySha256,
      evidence.proposalPreflight.proposalPreflightTransferSha256,
      evidence.intendedReleaseSha,
      evidence.prepareEvidenceSha256,
    ],
  );
  return Object.freeze({
    cutoverId: evidence.cutoverId,
    status: "prepared",
    eventSha256: requireEventHash(result.rows[0]?.event_sha256),
    prepareEvidenceSha256: evidence.prepareEvidenceSha256,
  });
}

export async function enableCutoverMaintenance(client, cutoverId) {
  if (!exactUuid(cutoverId)) throw new Error("ai_content_cutover_id_invalid");
  await client.query("select public.set_ai_content_maintenance($1::uuid,true)", [cutoverId]);
  return Object.freeze({ cutoverId, maintenanceEnabled: true });
}

export async function transitionCutoverToMaintenanceVerified(client, { cutoverId, evidenceSha256 } = {}) {
  if (!exactUuid(cutoverId)) throw new Error("ai_content_cutover_id_invalid");
  if (!exactHash(evidenceSha256)) throw new Error("ai_content_cutover_maintenance_evidence_invalid");
  const before = await readCutoverStatus(client, cutoverId);
  if (before.markerPresent || !["prepared", "maintenance_verified"].includes(before.status)
    || !before.maintenanceEnabled || before.maintenanceCutoverId !== cutoverId) {
    throw new Error("ai_content_cutover_maintenance_not_verified");
  }
  const result = await client.query(
    `select public.transition_ai_content_cutover_status(
       $1::uuid,'prepared','maintenance_verified',$2::text,null,null,null,null,null
     ) as event_sha256`,
    [cutoverId, evidenceSha256],
  );
  return Object.freeze({
    cutoverId,
    status: "maintenance_verified",
    eventSha256: requireEventHash(result.rows[0]?.event_sha256),
    evidenceSha256,
  });
}

const PRE_MARKER_ABORT_REASON = "operator_requested_pre_marker_abort";

export async function abortCutoverPreMarker(client, {
  cutoverId, fromStatus, evidenceSha256,
} = {}) {
  if (!exactUuid(cutoverId)) throw new Error("ai_content_cutover_id_invalid");
  if (!exactHash(evidenceSha256)) throw new Error("ai_content_cutover_abort_evidence_invalid");
  if (!["prepared", "maintenance_verified"].includes(fromStatus)) {
    throw new Error("ai_content_cutover_abort_from_status_invalid");
  }
  const transitionSql = fromStatus === "prepared"
    ? `select public.transition_ai_content_cutover_status(
         $1::uuid,'prepared','abandoned_pre_marker',$2::text,$3::text,null,null,null,null
       ) as event_sha256`
    : `select public.transition_ai_content_cutover_status(
         $1::uuid,'maintenance_verified','abandoned_pre_marker',$2::text,$3::text,null,null,null,null
       ) as event_sha256`;

  await client.query("begin");
  try {
    const before = await readCutoverStatus(client, cutoverId);
    if (before.markerPresent) throw new Error("ai_content_cutover_roll_forward_only");
    if (![fromStatus, "abandoned_pre_marker"].includes(before.status)) {
      throw new Error("ai_content_cutover_abort_state_invalid");
    }
    if (before.status === "abandoned_pre_marker"
      && (before.activeCutoverCount !== 0 || before.activeCutoverId !== null
        || before.maintenanceEnabled || before.maintenanceCutoverId !== null)) {
      throw new Error("ai_content_cutover_abort_state_invalid");
    }
    const transition = await client.query(transitionSql, [
      cutoverId, evidenceSha256, PRE_MARKER_ABORT_REASON,
    ]);
    const eventSha256 = requireEventHash(transition.rows[0]?.event_sha256);
    await client.query("select public.set_ai_content_maintenance($1::uuid,false)", [cutoverId]);
    const after = await readCutoverStatus(client, cutoverId);
    if (after.status !== "abandoned_pre_marker" || after.markerPresent
      || after.activeCutoverCount !== 0 || after.activeCutoverId !== null
      || after.maintenanceEnabled || after.maintenanceCutoverId !== null) {
      throw new Error("ai_content_cutover_abort_verification_failed");
    }
    await client.query("commit");
    return Object.freeze({
      cutoverId,
      status: "abandoned_pre_marker",
      markerPresent: false,
      maintenanceEnabled: false,
      eventSha256,
      evidenceSha256,
    });
  } catch (error) {
    try {
      await client.query("rollback");
    } catch (rollbackError) {
      throw new Error("ai_content_cutover_abort_rollback_failed", {
        cause: { error, rollbackError },
      });
    }
    throw error;
  }
}

export async function transitionCutoverToBackendVerified(client, {
  cutoverId, evidenceSha256,
} = {}) {
  if (!exactUuid(cutoverId)) throw new Error("ai_content_cutover_id_invalid");
  if (!exactHash(evidenceSha256)) throw new Error("ai_content_cutover_backend_evidence_invalid");
  await client.query("begin");
  try {
    const before = await readCutoverStatus(client, cutoverId);
    if (!before.markerPresent
      || !["migration_body_complete", "backend_verified"].includes(before.status)
      || before.activeCutoverCount !== 1 || before.activeCutoverId !== cutoverId
      || !before.maintenanceEnabled || before.maintenanceCutoverId !== cutoverId) {
      throw new Error("ai_content_cutover_backend_verification_state_invalid");
    }
    const transition = await client.query(
      `select public.transition_ai_content_cutover_status(
         $1::uuid,'migration_body_complete','backend_verified',$2::text,null,null,null,null,null
       ) as event_sha256`,
      [cutoverId, evidenceSha256],
    );
    const eventSha256 = requireEventHash(transition.rows[0]?.event_sha256);
    const after = await readCutoverStatus(client, cutoverId);
    if (after.status !== "backend_verified" || !after.markerPresent
      || after.activeCutoverCount !== 1 || after.activeCutoverId !== cutoverId
      || !after.maintenanceEnabled || after.maintenanceCutoverId !== cutoverId) {
      throw new Error("ai_content_cutover_backend_verification_failed");
    }
    await client.query("commit");
    return Object.freeze({
      cutoverId,
      status: "backend_verified",
      markerPresent: true,
      maintenanceEnabled: true,
      eventSha256,
      evidenceSha256,
    });
  } catch (error) {
    try {
      await client.query("rollback");
    } catch (rollbackError) {
      throw new Error("ai_content_cutover_backend_verification_rollback_failed", {
        cause: { error, rollbackError },
      });
    }
    throw error;
  }
}

export async function completeCutover(client, {
  cutoverId,
  evidenceSha256,
  cleanupCredentialRevokedAt,
  cleanupRevocationEvidenceSha256,
} = {}) {
  if (!exactUuid(cutoverId)) throw new Error("ai_content_cutover_id_invalid");
  if (!exactHash(evidenceSha256) || !exactHash(cleanupRevocationEvidenceSha256)) {
    throw new Error("ai_content_cutover_cleanup_revocation_evidence_invalid");
  }
  if (evidenceSha256 !== cleanupRevocationEvidenceSha256) {
    throw new Error("ai_content_cutover_completion_evidence_mismatch");
  }
  if (!exactIsoTimestamp(cleanupCredentialRevokedAt)) {
    throw new Error("ai_content_cutover_cleanup_revocation_timestamp_invalid");
  }

  await client.query("begin");
  try {
    const before = await readCutoverStatus(client, cutoverId);
    if (!before.markerPresent || !["backend_verified", "completed"].includes(before.status)) {
      throw new Error("ai_content_cutover_completion_state_invalid");
    }
    if (before.status === "backend_verified"
      && (before.activeCutoverCount !== 1 || before.activeCutoverId !== cutoverId
        || !before.maintenanceEnabled || before.maintenanceCutoverId !== cutoverId
        || before.cleanupCredentialRevokedAt !== cleanupCredentialRevokedAt
        || before.cleanupRevocationEvidenceSha256 !== cleanupRevocationEvidenceSha256)) {
      throw new Error("ai_content_cutover_completion_state_invalid");
    }
    if (before.status === "completed"
      && (before.activeCutoverCount !== 0 || before.activeCutoverId !== null
        || before.maintenanceEnabled || before.maintenanceCutoverId !== null
        || before.cleanupCredentialRevokedAt !== cleanupCredentialRevokedAt
        || before.cleanupRevocationEvidenceSha256 !== cleanupRevocationEvidenceSha256)) {
      throw new Error("ai_content_cutover_completion_state_invalid");
    }
    const transition = await client.query(
      `select public.transition_ai_content_cutover_status(
         $1::uuid,'backend_verified','completed',$2::text,null,null,$3::timestamptz,$4::text,null
       ) as event_sha256`,
      [
        cutoverId,
        evidenceSha256,
        cleanupCredentialRevokedAt,
        cleanupRevocationEvidenceSha256,
      ],
    );
    const eventSha256 = requireEventHash(transition.rows[0]?.event_sha256);
    await client.query("select public.set_ai_content_maintenance($1::uuid,false)", [cutoverId]);
    const after = await readCutoverStatus(client, cutoverId);
    if (after.status !== "completed" || !after.markerPresent
      || after.activeCutoverCount !== 0 || after.activeCutoverId !== null
      || after.maintenanceEnabled || after.maintenanceCutoverId !== null
      || after.cleanupCredentialRevokedAt !== cleanupCredentialRevokedAt
      || after.cleanupRevocationEvidenceSha256 !== cleanupRevocationEvidenceSha256) {
      throw new Error("ai_content_cutover_completion_verification_failed");
    }
    await client.query("commit");
    return Object.freeze({
      cutoverId,
      status: "completed",
      markerPresent: true,
      maintenanceEnabled: false,
      eventSha256,
      evidenceSha256,
      cleanupCredentialRevokedAt,
      cleanupRevocationEvidenceSha256,
    });
  } catch (error) {
    try {
      await client.query("rollback");
    } catch (rollbackError) {
      throw new Error("ai_content_cutover_completion_rollback_failed", {
        cause: { error, rollbackError },
      });
    }
    throw error;
  }
}

function controlCount(value) {
  if (value === 0 || value === "0" || value === 0n) return 0;
  if (value === 1 || value === "1" || value === 1n) return 1;
  return Number.NaN;
}

export function validateCutoverControlState(state, cutoverId) {
  if (!exactUuid(cutoverId)) throw new Error("ai_content_cutover_id_invalid");
  if (!record(state) || typeof state.requested_cutover_exists !== "boolean"
    || typeof state.marker_present !== "boolean"
    || typeof state.maintenance_enabled !== "boolean") {
    throw new Error("ai_content_cutover_status_snapshot_invalid");
  }
  if (!state.requested_cutover_exists) throw new Error("ai_content_cutover_status_missing");
  const activeCutoverCount = controlCount(state.active_cutover_count);
  if (![0, 1].includes(activeCutoverCount)
    || (activeCutoverCount === 0 && state.active_cutover_id !== null)
    || (activeCutoverCount === 1 && !exactUuid(state.active_cutover_id))
    || (state.maintenance_enabled
      ? !exactUuid(state.maintenance_cutover_id)
      : state.maintenance_cutover_id !== null)) {
    throw new Error("ai_content_cutover_status_snapshot_invalid");
  }
  const markerPresent = state.marker_present;
  const cleanupCredentialRevokedAt = normalizeDatabaseTimestamp(
    state.cleanup_credential_revoked_at ?? null,
  );
  const cleanupRevocationEvidenceSha256 = state.cleanup_revocation_evidence_sha256 ?? null;
  const cleanupRevocationAbsent = state.cleanup_credential_revoked_at == null
    && state.cleanup_revocation_evidence_sha256 == null;
  const cleanupRevocationPresent = cleanupCredentialRevokedAt !== null
    && exactHash(cleanupRevocationEvidenceSha256);
  if ((markerPresent && !postMarkerStatuses.has(state.cutover_status))
    || (!markerPresent && !preMarkerStatuses.has(state.cutover_status))) {
    throw new Error("ai_content_cutover_marker_status_invalid");
  }
  if (activeStatuses.has(state.cutover_status)
    && (activeCutoverCount !== 1 || state.active_cutover_id !== cutoverId)) {
    throw new Error("ai_content_cutover_active_state_invalid");
  }
  if (activeStatuses.has(state.cutover_status) && state.maintenance_enabled
    && state.maintenance_cutover_id !== cutoverId) {
    throw new Error("ai_content_cutover_maintenance_state_invalid");
  }
  if (["maintenance_verified", "migration_body_complete", "backend_verified"].includes(state.cutover_status)
    && (!state.maintenance_enabled || state.maintenance_cutover_id !== cutoverId)) {
    throw new Error("ai_content_cutover_maintenance_state_invalid");
  }
  if (["completed", "abandoned_pre_marker"].includes(state.cutover_status)
    && (activeCutoverCount !== 0 || state.active_cutover_id !== null
      || state.maintenance_enabled || state.maintenance_cutover_id !== null)) {
    throw new Error("ai_content_cutover_terminal_state_invalid");
  }
  if ((state.cutover_status === "completed" && !cleanupRevocationPresent)
    || (state.cutover_status === "backend_verified"
      && !cleanupRevocationAbsent && !cleanupRevocationPresent)
    || (!["backend_verified", "completed"].includes(state.cutover_status)
      && !cleanupRevocationAbsent)) {
    throw new Error("ai_content_cutover_cleanup_revocation_state_invalid");
  }
  return Object.freeze({
    cutoverId,
    status: state.cutover_status,
    markerPresent,
    activeCutoverCount,
    activeCutoverId: state.active_cutover_id,
    maintenanceEnabled: state.maintenance_enabled,
    maintenanceCutoverId: state.maintenance_cutover_id,
    cleanupCredentialRevokedAt,
    cleanupRevocationEvidenceSha256,
  });
}

async function readControlStateRow(client, cutoverId) {
  const result = await client.query(
    "select * from public.read_ai_content_cutover_control_state($1::uuid)",
    [cutoverId],
  );
  if (result.rows.length !== 1 || !record(result.rows[0])) {
    throw new Error("ai_content_cutover_status_snapshot_invalid");
  }
  return result.rows[0];
}

export async function readCutoverStatus(client, cutoverId) {
  if (!exactUuid(cutoverId)) throw new Error("ai_content_cutover_id_invalid");
  return validateCutoverControlState(await readControlStateRow(client, cutoverId), cutoverId);
}

export async function readActiveContentLeaseCount(client) {
  const result = await client.query(
    `select (
       (select count(*) from public.ai_content_proposal_jobs
         where status='processing' and lease_expires_at>clock_timestamp())+
       (select count(*) from public.ai_content_generation_jobs
         where status='processing' and lease_expires_at>clock_timestamp())+
       (select count(*) from public.ai_content_generation_render_jobs
         where status='processing' and lease_expires_at>clock_timestamp())
     )::text as active_lease_count`,
  );
  const value = result.rows?.length === 1 ? String(result.rows[0]?.active_lease_count ?? "") : "";
  if (!/^\d+$/.test(value)) throw new Error("ai_content_active_lease_count_invalid");
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("ai_content_active_lease_count_invalid");
  return count;
}

export async function assertRollbackAllowed(client, cutoverId) {
  const status = await readCutoverStatus(client, cutoverId);
  if (status.markerPresent) throw new Error("ai_content_cutover_roll_forward_only");
  if (!preMarkerStatuses.has(status.status)) throw new Error("ai_content_cutover_rollback_state_invalid");
  return Object.freeze({ ...status, rollbackAllowed: true });
}

async function secureRead(fileName, maxBytes) {
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
  return await readFile(resolved, "utf8");
}

function validateDatabaseUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error("ai_content_database_url_invalid"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !url.hostname || !url.username || !url.password || !url.pathname || url.pathname === "/"
    || url.hash) {
    throw new Error("ai_content_database_url_invalid");
  }
  return value;
}

export async function readSecureDatabaseUrl(fileName) {
  return validateDatabaseUrl((await secureRead(fileName, 32 * 1024)).trim());
}

export function verifiedDatabaseClientConfig(connectionString, { caBase64 } = {}) {
  validateDatabaseUrl(connectionString);
  return resolveVerifiedTlsConfig(connectionString, {
    caCertificate: decodeCaCertificate(caBase64),
  });
}

async function connectFromFile(fileName) {
  const connectionString = await readSecureDatabaseUrl(fileName);
  const client = new Client(verifiedDatabaseClientConfig(connectionString, {
    caBase64: process.env.DB_SSL_CA_BASE64,
  }));
  await client.connect();
  return client;
}

function parseCli(argv) {
  const mode = argv[2];
  const args = {};
  for (let index = 3; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--") || argv[index + 1] === undefined || args[key.slice(2)] !== undefined) {
      throw new Error("ai_content_cutover_control_cli_invalid");
    }
    args[key.slice(2)] = argv[index + 1];
  }
  const required = {
    "--create-prepare-evidence": ["body-file"],
    "--create-backend-evidence": ["body-file", "expected-file"],
    "--prepare": ["database-url-file", "evidence-file"],
    "--enable-maintenance": ["database-url-file", "cutover-id"],
    "--verify-maintenance": ["database-url-file", "cutover-id", "evidence-sha256"],
    "--verify-backend": [
      "database-url-file", "cutover-id", "evidence-file", "candidate-release-sha",
      "shared-owner-restore-evidence-sha256", "api-image-digest",
      "content-proposal-worker-image-digest", "image-worker-image-digest",
      "card-news-worker-image-digest", "blog-worker-image-digest", "reel-worker-image-digest",
    ],
    "--complete": [
      "database-url-file", "cutover-id", "cleanup-revocation-evidence-file",
    ],
    "--abort-pre-marker": ["database-url-file", "cutover-id", "from-status", "evidence-sha256"],
    "--count-active-content-leases": ["database-url-file"],
    "--validate-database-url-file": ["database-url-file"],
    "--status": ["database-url-file", "cutover-id"],
    "--assert-rollback-allowed": ["database-url-file", "cutover-id"],
  }[mode];
  if (!required || JSON.stringify(Object.keys(args).sort()) !== JSON.stringify([...required].sort())) {
    throw new Error("ai_content_cutover_control_cli_invalid");
  }
  return { mode, args };
}

async function main(argv = process.argv) {
  const { mode, args } = parseCli(argv);
  if (mode === "--validate-database-url-file") {
    await readSecureDatabaseUrl(args["database-url-file"]);
    process.stdout.write(`${canonicalJson({ status: "database_url_valid" })}\n`);
    return;
  }
  if (mode === "--create-prepare-evidence" || mode === "--create-backend-evidence") {
    let body;
    try { body = JSON.parse(await secureRead(args["body-file"], 1024 * 1024)); }
    catch { throw new Error(mode === "--create-prepare-evidence"
      ? "ai_content_cutover_prepare_evidence_invalid"
      : "ai_content_cutover_backend_evidence_invalid"); }
    let result;
    if (mode === "--create-prepare-evidence") {
      result = createPrepareEvidence(body);
    } else {
      let expected;
      try { expected = JSON.parse(await secureRead(args["expected-file"], 1024 * 1024)); }
      catch { throw new Error("ai_content_cutover_backend_expected_identity_invalid"); }
      result = createBackendVerificationEvidence(body, expected);
    }
    process.stdout.write(`${canonicalJson(result)}\n`);
    return;
  }
  const client = await connectFromFile(args["database-url-file"]);
  try {
    let result;
    if (mode === "--count-active-content-leases") {
      process.stdout.write(`${await readActiveContentLeaseCount(client)}\n`);
      return;
    } else if (mode === "--prepare") {
      const evidence = await secureRead(args["evidence-file"], 1024 * 1024);
      result = await prepareCutover(client, evidence);
    } else if (mode === "--enable-maintenance") {
      result = await enableCutoverMaintenance(client, args["cutover-id"]);
    } else if (mode === "--verify-maintenance") {
      result = await transitionCutoverToMaintenanceVerified(client, {
        cutoverId: args["cutover-id"], evidenceSha256: args["evidence-sha256"],
      });
    } else if (mode === "--verify-backend") {
      const backendEvidence = parseBackendVerificationEvidence(
        await secureRead(args["evidence-file"], 1024 * 1024),
        {
          cutoverId: args["cutover-id"],
          candidateReleaseSha: args["candidate-release-sha"],
          sharedOwnerRestoreEvidenceSha256: args["shared-owner-restore-evidence-sha256"],
          imageDigests: {
            "api-canary": args["api-image-digest"],
            "api-primary": args["api-image-digest"],
            "content-proposal-worker-1": args["content-proposal-worker-image-digest"],
            "image-worker-1": args["image-worker-image-digest"],
            "card-news-worker-1": args["card-news-worker-image-digest"],
            "blog-worker-1": args["blog-worker-image-digest"],
            "reel-worker-1": args["reel-worker-image-digest"],
          },
        },
      );
      result = await transitionCutoverToBackendVerified(client, {
        cutoverId: args["cutover-id"], evidenceSha256: backendEvidence.evidenceSha256,
      });
    } else if (mode === "--complete") {
      const cleanupEvidence = await parseCleanupRoleRetirementEvidence(
        await secureRead(args["cleanup-revocation-evidence-file"], 1024 * 1024),
      );
      if (cleanupEvidence.cutoverId !== args["cutover-id"]) {
        throw new Error("ai_content_cleanup_role_retirement_cutover_id_mismatch");
      }
      result = await completeCutover(client, {
        cutoverId: args["cutover-id"],
        evidenceSha256: cleanupEvidence.evidenceSha256,
        cleanupCredentialRevokedAt: cleanupEvidence.retiredAt,
        cleanupRevocationEvidenceSha256: cleanupEvidence.evidenceSha256,
      });
    } else if (mode === "--abort-pre-marker") {
      result = await abortCutoverPreMarker(client, {
        cutoverId: args["cutover-id"], fromStatus: args["from-status"],
        evidenceSha256: args["evidence-sha256"],
      });
    } else if (mode === "--status") {
      result = await readCutoverStatus(client, args["cutover-id"]);
    } else {
      result = await assertRollbackAllowed(client, args["cutover-id"]);
    }
    process.stdout.write(`${canonicalJson(result)}\n`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "ai_content_cutover_control_failed"}\n`);
    process.exitCode = 1;
  });
}
