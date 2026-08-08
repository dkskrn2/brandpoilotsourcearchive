import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  abortCutoverPreMarker,
  assertRollbackAllowed,
  completeCutover,
  createBackendVerificationEvidence,
  createPrepareEvidence,
  enableCutoverMaintenance,
  parseBackendVerificationEvidence,
  parseCleanupRoleRetirementEvidence,
  parsePrepareEvidence,
  prepareCutover,
  readActiveContentLeaseCount,
  readCutoverStatus,
  readSecureDatabaseUrl,
  transitionCutoverToBackendVerified,
  transitionCutoverToMaintenanceVerified,
  validateCutoverControlState,
  verifiedDatabaseClientConfig,
} from "./ai-content-cutover-control.mjs";
import { loadMigrations } from "./migrationRunner.mjs";

function canonicalJson(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => JSON.parse(canonicalJson(item))));
  if (value && typeof value === "object") {
    const sorted = Object.fromEntries(Object.keys(value).sort().map((key) => [key, JSON.parse(canonicalJson(value[key]))]));
    return JSON.stringify(sorted);
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const hash = (letter) => letter.repeat(64);
const sourceSha = (letter) => letter.repeat(40);
const cutoverMigrationSha256 = (await loadMigrations()).find(
  ({ id }) => id === "075_ai_content_three_format_cutover.sql",
)?.checksum;
assert.match(cutoverMigrationSha256, /^[0-9a-f]{64}$/);

test("active content lease count covers proposal, generation, and render workers", async () => {
  const client = {
    async query(sql) {
      assert.match(sql, /ai_content_proposal_jobs/);
      assert.match(sql, /ai_content_generation_jobs/);
      assert.match(sql, /ai_content_generation_render_jobs/);
      assert.equal((sql.match(/lease_expires_at>clock_timestamp\(\)/g) ?? []).length, 3);
      return { rows: [{ active_lease_count: "2" }] };
    },
  };
  assert.equal(await readActiveContentLeaseCount(client), 2);
  await assert.rejects(
    readActiveContentLeaseCount({ query: async () => ({ rows: [{ active_lease_count: "invalid" }] }) }),
    /ai_content_active_lease_count_invalid/,
  );
});

function proposalPreflight(cutoverId) {
  const identity = {
    preflightCandidateSha: sourceSha("a"),
    contentProposalWorkerImageDigest: `sha256:${hash("b")}`,
    proposalWorkerSourceSha: sourceSha("c"),
    proposalWorkerTreeSha: sourceSha("d"),
    proposalContractSourceSha256: hash("e"),
    proposalSchemaSha256: hash("f"),
    proposalCatalogSha256: hash("1"),
    proposalModelId: "gpt-5.6-terra",
    proposalCommandDescriptorSha256: "",
    migrationSha256: cutoverMigrationSha256,
  };
  identity.proposalCommandDescriptorSha256 = sha256(canonicalJson({
    runner: "codex-exec",
    modelId: "gpt-5.6-terra",
    promptVersion: "proposal.writer.v2",
    outputSchemaSha256: identity.proposalSchemaSha256,
    proposalContractVersion: "content-proposal.v2",
    baseInputContractVersion: "proposal-base-input.v2",
  }));
  return {
    contractVersion: "ai-content-075-proposal-preflight-evidence.v1",
    cutoverId,
    proposalPreflightIdentity: identity,
    proposalPreflightIdentitySha256: sha256(canonicalJson(identity)),
    proposalPreflightTransferSha256: hash("3"),
  };
}

function prepareBody(cutoverId = randomUUID()) {
  return {
    contractVersion: "ai-content-cutover-prepare-evidence.v1",
    cutoverId,
    roleNames: {
      schemaOwnerRoleName: "content_schema_owner",
      applicationRoleName: "content_application",
      operatorRoleName: "content_operator",
      migrationRoleName: "content_migration",
      cleanupRoleName: "content_cleanup",
    },
    bypassTokenSha256: hash("4"),
    cleanupTokenSha256: hash("5"),
    databaseRoleCatalogSha256: hash("6"),
    providerBackupId: "backup:production/2026-08-06T12-00-00Z",
    providerSnapshotCreatedAt: "2026-08-06T03:00:00.000Z",
    incidentBundleSha256: hash("7"),
    preservedDataManifestSha256: hash("8"),
    proposalPreflight: proposalPreflight(cutoverId),
    intendedReleaseSha: sourceSha("a"),
  };
}

function cleanupRetirementEvidence(cutoverId = randomUUID()) {
  const body = {
    contractVersion: "ai-content-cleanup-role-retirement-evidence.v1",
    planSha256: hash("0"),
    cutoverId,
    cutoverMigrationId: "075_ai_content_three_format_cutover.sql",
    cutoverMigrationSha256,
    providerSessionUser: "postgres",
    cleanupRoleName: "content_cleanup",
    retiredAt: "2026-08-07T01:02:03.000Z",
    outboxRowCount: 2,
    outboxStatusCatalogSha256: hash("1"),
    sharedOwnerCatalogSha256: hash("2"),
    sharedThirdPartyAclSha256: hash("3"),
    cleanupRoleCatalogSha256: hash("4"),
    cleanupAclCatalogSha256: hash("5"),
    cleanupMembershipCatalogSha256: hash("6"),
  };
  return { ...body, evidenceSha256: sha256(canonicalJson(body)) };
}

const backendWorkerServices = Object.freeze([
  "content-proposal-worker-1",
  "image-worker-1",
  "card-news-worker-1",
  "blog-worker-1",
  "reel-worker-1",
]);

function backendVerificationEvidence(cutoverId = randomUUID()) {
  const candidateReleaseSha = sourceSha("a");
  const imageDigests = Object.fromEntries([
    "api-primary", "api-canary", ...backendWorkerServices,
  ].map((serviceName, index) => [serviceName, `sha256:${String(index + 1).repeat(64).slice(0, 64)}`]));
  const body = {
    contractVersion: "ai-content-backend-verification-evidence.v1",
    cutoverId,
    candidateReleaseSha,
    sharedOwnerRestoreEvidenceSha256: hash("7"),
    maintenanceEnabled: true,
    apiServices: ["api-canary", "api-primary"].map((serviceName) => ({
      serviceName,
      imageDigest: imageDigests[serviceName],
      databaseSessionUser: "content_application",
      databaseCurrentUser: "content_application",
      readiness: "ready",
      health: "healthy",
      verifiedAt: "2026-08-07T01:01:00.000Z",
    })),
    workers: backendWorkerServices.map((serviceName) => ({
      serviceName,
      imageDigest: imageDigests[serviceName],
      verificationKind: serviceName === "content-proposal-worker-1"
        ? "maintenance_safe_idle_heartbeat"
        : "authenticated_claim_maintenance_fence",
      observedStatus: serviceName === "content-proposal-worker-1"
        ? "heartbeat_verified"
        : "ai_content_maintenance_503",
      observedAt: "2026-08-07T01:01:30.000Z",
      observationEvidenceSha256: sha256(serviceName),
    })),
    verifiedAt: "2026-08-07T01:02:00.000Z",
  };
  return {
    evidence: { ...body, evidenceSha256: sha256(canonicalJson(body)) },
    expected: {
      cutoverId,
      candidateReleaseSha,
      sharedOwnerRestoreEvidenceSha256: body.sharedOwnerRestoreEvidenceSha256,
      imageDigests,
    },
  };
}

test("backend evidence distinguishes the proposal heartbeat from four maintenance-fenced claims", () => {
  const { evidence, expected } = backendVerificationEvidence();
  assert.deepEqual(parseBackendVerificationEvidence(JSON.stringify(evidence), expected), evidence);

  const missingWorker = structuredClone(evidence);
  missingWorker.workers.pop();
  const { evidenceSha256: _missingDigest, ...missingBody } = missingWorker;
  missingWorker.evidenceSha256 = sha256(canonicalJson(missingBody));
  assert.throws(
    () => parseBackendVerificationEvidence(JSON.stringify(missingWorker), expected),
    /ai_content_cutover_backend_evidence_invalid/,
  );

  const wrongIdentity = structuredClone(evidence);
  wrongIdentity.apiServices[0].databaseCurrentUser = "postgres";
  const { evidenceSha256: _identityDigest, ...wrongIdentityBody } = wrongIdentity;
  wrongIdentity.evidenceSha256 = sha256(canonicalJson(wrongIdentityBody));
  assert.throws(
    () => parseBackendVerificationEvidence(JSON.stringify(wrongIdentity), expected),
    /ai_content_cutover_backend_evidence_invalid/,
  );

  const falseHeartbeat = structuredClone(evidence);
  falseHeartbeat.workers[1].verificationKind = "maintenance_safe_idle_heartbeat";
  falseHeartbeat.workers[1].observedStatus = "heartbeat_verified";
  const { evidenceSha256: _heartbeatDigest, ...heartbeatBody } = falseHeartbeat;
  falseHeartbeat.evidenceSha256 = sha256(canonicalJson(heartbeatBody));
  assert.throws(
    () => parseBackendVerificationEvidence(JSON.stringify(falseHeartbeat), expected),
    /ai_content_cutover_backend_evidence_invalid/,
  );
});

test("backend evidence creator hashes and revalidates the exact observed body", () => {
  const { evidence, expected } = backendVerificationEvidence();
  const { evidenceSha256: _discarded, ...body } = evidence;
  assert.deepEqual(createBackendVerificationEvidence(body, expected), evidence);

  const invalid = structuredClone(body);
  invalid.workers[4].observedStatus = "heartbeat_verified";
  assert.throws(
    () => createBackendVerificationEvidence(invalid, expected),
    /ai_content_cutover_backend_evidence_invalid/,
  );
});

test("evidence-only CLI modes create sealed evidence without opening a database connection", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-content-evidence-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = path.resolve("scripts/ai-content-cutover-control.mjs");

  const backend = backendVerificationEvidence();
  const { evidenceSha256: _discarded, ...backendBody } = backend.evidence;
  const backendBodyFile = path.join(directory, "backend-body.json");
  const backendExpectedFile = path.join(directory, "backend-expected.json");
  await writeFile(backendBodyFile, JSON.stringify(backendBody), { mode: 0o600 });
  await writeFile(backendExpectedFile, JSON.stringify(backend.expected), { mode: 0o600 });
  const backendResult = spawnSync(process.execPath, [
    script, "--create-backend-evidence",
    "--body-file", backendBodyFile,
    "--expected-file", backendExpectedFile,
  ], { encoding: "utf8" });
  assert.equal(backendResult.status, 0, backendResult.stderr);
  assert.deepEqual(JSON.parse(backendResult.stdout), backend.evidence);

  const prepare = prepareBody();
  const prepareBodyFile = path.join(directory, "prepare-body.json");
  await writeFile(prepareBodyFile, JSON.stringify(prepare), { mode: 0o600 });
  const prepareResult = spawnSync(process.execPath, [
    script, "--create-prepare-evidence", "--body-file", prepareBodyFile,
  ], { encoding: "utf8" });
  assert.equal(prepareResult.status, 0, prepareResult.stderr);
  assert.deepEqual(JSON.parse(prepareResult.stdout), createPrepareEvidence(prepare));

  const databaseUrlFile = path.join(directory, "database-url");
  await writeFile(databaseUrlFile, "postgresql://app:secret@db.example.test/content\n", { mode: 0o600 });
  const databaseUrlResult = spawnSync(process.execPath, [
    script, "--validate-database-url-file", "--database-url-file", databaseUrlFile,
  ], { encoding: "utf8" });
  assert.equal(databaseUrlResult.status, 0, databaseUrlResult.stderr);
  assert.deepEqual(JSON.parse(databaseUrlResult.stdout), { status: "database_url_valid" });
  assert.doesNotMatch(databaseUrlResult.stdout, /secret|postgres/);
});

test("cleanup retirement evidence is exact, checksum-bound, and migration-bound", async () => {
  const evidence = cleanupRetirementEvidence();
  assert.deepEqual(
    await parseCleanupRoleRetirementEvidence(JSON.stringify(evidence)),
    evidence,
  );
  await assert.rejects(
    parseCleanupRoleRetirementEvidence(JSON.stringify({ ...evidence, outboxRowCount: 3 })),
    /ai_content_cleanup_role_retirement_evidence_invalid/,
  );
  await assert.rejects(
    parseCleanupRoleRetirementEvidence(JSON.stringify({ ...evidence, unexpected: true })),
    /ai_content_cleanup_role_retirement_evidence_invalid/,
  );
  const wrongMigration = cleanupRetirementEvidence();
  wrongMigration.cutoverMigrationSha256 = hash("f");
  const { evidenceSha256: _discarded, ...wrongBody } = wrongMigration;
  wrongMigration.evidenceSha256 = sha256(canonicalJson(wrongBody));
  await assert.rejects(
    parseCleanupRoleRetirementEvidence(JSON.stringify(wrongMigration)),
    /ai_content_cleanup_role_retirement_migration_identity_invalid/,
  );
});

test("prepare evidence is exact, checksum-bound, and tied to one preflight cutover", () => {
  const evidence = createPrepareEvidence(prepareBody());
  assert.match(evidence.prepareEvidenceSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(parsePrepareEvidence(JSON.stringify(evidence)), evidence);

  assert.throws(
    () => parsePrepareEvidence({ ...evidence, unexpected: true }),
    /ai_content_cutover_prepare_evidence_invalid/,
  );
  assert.throws(
    () => parsePrepareEvidence({ ...evidence, incidentBundleSha256: hash("b") }),
    /ai_content_cutover_prepare_evidence_checksum_invalid/,
  );
  assert.throws(
    () => createPrepareEvidence({
      ...prepareBody(),
      roleNames: {
        ...prepareBody().roleNames,
        cleanupRoleName: "content_operator",
      },
    }),
    /ai_content_cutover_prepare_evidence_invalid/,
  );
  const mismatchedPreflight = prepareBody();
  mismatchedPreflight.proposalPreflight = proposalPreflight(randomUUID());
  assert.throws(
    () => createPrepareEvidence(mismatchedPreflight),
    /ai_content_cutover_prepare_evidence_invalid/,
  );
  assert.throws(
    () => createPrepareEvidence({ ...prepareBody(), intendedReleaseSha: sourceSha("b") }),
    /ai_content_cutover_prepare_evidence_invalid/,
  );
});

test("prepare invokes only the closed 074 function with all validated values", async () => {
  const evidence = createPrepareEvidence(prepareBody());
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("read_ai_content_cutover_control_state")) {
        return { rows: [{
          requested_cutover_exists: false,
          cutover_status: null,
          marker_present: false,
          maintenance_enabled: false,
          maintenance_cutover_id: null,
          active_cutover_count: "0",
          active_cutover_id: null,
        }] };
      }
      return { rows: [{ event_sha256: hash("a") }] };
    },
  };

  const result = await prepareCutover(client, evidence);

  assert.deepEqual(result, {
    cutoverId: evidence.cutoverId,
    status: "prepared",
    eventSha256: hash("a"),
    prepareEvidenceSha256: evidence.prepareEvidenceSha256,
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /read_ai_content_cutover_control_state/);
  assert.match(calls[1].sql, /select public\.prepare_ai_content_cutover\(/);
  assert.equal(calls[1].values.length, 18);
  assert.deepEqual(calls[1].values, [
    evidence.cutoverId,
    evidence.roleNames.schemaOwnerRoleName,
    evidence.roleNames.applicationRoleName,
    evidence.roleNames.operatorRoleName,
    evidence.roleNames.migrationRoleName,
    evidence.roleNames.cleanupRoleName,
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
  ]);

  const wrongMigrationBody = prepareBody();
  wrongMigrationBody.proposalPreflight.proposalPreflightIdentity.migrationSha256 = hash("0");
  wrongMigrationBody.proposalPreflight.proposalPreflightIdentitySha256 = sha256(canonicalJson(
    wrongMigrationBody.proposalPreflight.proposalPreflightIdentity,
  ));
  await assert.rejects(
    prepareCutover(client, createPrepareEvidence(wrongMigrationBody)),
    /ai_content_cutover_migration_identity_invalid/,
  );
  assert.equal(calls.length, 2, "migration identity mismatch must fail before database mutation");

  const markerClientCalls = [];
  const markerClient = {
    async query(sql, values) {
      markerClientCalls.push({ sql, values });
      return { rows: [{
        requested_cutover_exists: false,
        cutover_status: null,
        marker_present: true,
        maintenance_enabled: false,
        maintenance_cutover_id: null,
        active_cutover_count: "0",
        active_cutover_id: null,
      }] };
    },
  };
  await assert.rejects(
    prepareCutover(markerClient, createPrepareEvidence(prepareBody())),
    /ai_content_cutover_prepare_state_invalid/,
  );
  assert.equal(markerClientCalls.length, 1);
  assert.match(markerClientCalls[0].sql, /read_ai_content_cutover_control_state/);
});

test("maintenance enable and verification use only fixed transitions and parameterized evidence", async () => {
  const cutoverId = randomUUID();
  const calls = [];
  const controlState = preparedControlState(cutoverId);
  controlState.maintenance_enabled = true;
  controlState.maintenance_cutover_id = cutoverId;
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("read_ai_content_cutover_control_state")) return { rows: [controlState] };
      if (sql.includes("transition_ai_content_cutover_status")) {
        controlState.cutover_status = "maintenance_verified";
        return { rows: [{ event_sha256: hash("b") }] };
      }
      return { rows: [{ enabled: null }] };
    },
  };

  assert.deepEqual(await enableCutoverMaintenance(client, cutoverId), {
    cutoverId,
    maintenanceEnabled: true,
  });
  assert.deepEqual(await transitionCutoverToMaintenanceVerified(client, {
    cutoverId,
    evidenceSha256: hash("c"),
  }), {
    cutoverId,
    status: "maintenance_verified",
    eventSha256: hash("b"),
    evidenceSha256: hash("c"),
  });

  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /select public\.set_ai_content_maintenance\(\$1::uuid,true\)/);
  assert.deepEqual(calls[0].values, [cutoverId]);
  assert.match(calls[1].sql, /read_ai_content_cutover_control_state/);
  assert.match(calls[2].sql, /'prepared','maintenance_verified'/);
  assert.deepEqual(calls[2].values, [cutoverId, hash("c")]);
  await assert.rejects(
    transitionCutoverToMaintenanceVerified(client, { cutoverId, evidenceSha256: "not-a-hash" }),
    /ai_content_cutover_maintenance_evidence_invalid/,
  );

  const blockedCalls = [];
  const blockedClient = {
    async query(sql, values) {
      blockedCalls.push({ sql, values });
      return { rows: [preparedControlState(cutoverId)] };
    },
  };
  await assert.rejects(
    transitionCutoverToMaintenanceVerified(blockedClient, { cutoverId, evidenceSha256: hash("d") }),
    /ai_content_cutover_maintenance_not_verified/,
  );
  assert.equal(blockedCalls.length, 1);
  assert.match(blockedCalls[0].sql, /read_ai_content_cutover_control_state/);
});

test("pre-marker abort atomically abandons the exact cutover and reopens writes", async () => {
  const cutoverId = randomUUID();
  const evidenceSha256 = hash("d");
  const calls = [];
  const state = preparedControlState(cutoverId);
  state.maintenance_enabled = true;
  state.maintenance_cutover_id = cutoverId;
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql === "begin" || sql === "commit" || sql === "rollback") return { rows: [] };
      if (sql.includes("read_ai_content_cutover_control_state")) return { rows: [state] };
      if (sql.includes("transition_ai_content_cutover_status")) {
        state.cutover_status = "abandoned_pre_marker";
        state.active_cutover_count = "0";
        state.active_cutover_id = null;
        return { rows: [{ event_sha256: hash("e") }] };
      }
      if (sql.includes("set_ai_content_maintenance")) {
        state.maintenance_enabled = false;
        state.maintenance_cutover_id = null;
        return { rows: [{ set_ai_content_maintenance: null }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  assert.deepEqual(await abortCutoverPreMarker(client, {
    cutoverId, fromStatus: "prepared", evidenceSha256,
  }), {
    cutoverId,
    status: "abandoned_pre_marker",
    markerPresent: false,
    maintenanceEnabled: false,
    eventSha256: hash("e"),
    evidenceSha256,
  });
  assert.equal(calls.length, 6);
  assert.equal(calls[0].sql, "begin");
  assert.match(calls[1].sql, /read_ai_content_cutover_control_state/);
  assert.match(calls[2].sql, /'prepared','abandoned_pre_marker'/);
  assert.deepEqual(calls[2].values, [cutoverId, evidenceSha256, "operator_requested_pre_marker_abort"]);
  assert.match(calls[3].sql, /set_ai_content_maintenance\(\$1::uuid,false\)/);
  assert.deepEqual(calls[3].values, [cutoverId]);
  assert.match(calls[4].sql, /read_ai_content_cutover_control_state/);
  assert.equal(calls[5].sql, "commit");

  calls.length = 0;
  assert.equal((await abortCutoverPreMarker(client, {
    cutoverId, fromStatus: "prepared", evidenceSha256,
  })).eventSha256, hash("e"));
  assert.equal(calls[0].sql, "begin");
  assert.equal(calls.at(-1).sql, "commit");
  assert.equal(calls.some(({ sql }) => sql === "rollback"), false);

  const blockedState = {
    ...preparedControlState(cutoverId),
    cutover_status: "migration_body_complete",
    marker_present: true,
    maintenance_enabled: true,
    maintenance_cutover_id: cutoverId,
  };
  const blockedCalls = [];
  const blockedClient = {
    async query(sql, values) {
      blockedCalls.push({ sql, values });
      if (sql.includes("read_ai_content_cutover_control_state")) return { rows: [blockedState] };
      return { rows: [] };
    },
  };
  await assert.rejects(
    abortCutoverPreMarker(blockedClient, {
      cutoverId, fromStatus: "maintenance_verified", evidenceSha256,
    }),
    /ai_content_cutover_roll_forward_only/,
  );
  assert.deepEqual(blockedCalls.map(({ sql }) => sql), [
    "begin",
    blockedCalls[1].sql,
    "rollback",
  ]);
  assert.match(blockedCalls[1].sql, /read_ai_content_cutover_control_state/);
});

test("backend verification atomically advances only the exact post-marker active cutover", async () => {
  const cutoverId = randomUUID();
  const evidenceSha256 = hash("9");
  const calls = [];
  const state = {
    ...preparedControlState(cutoverId),
    cutover_status: "migration_body_complete",
    marker_present: true,
    maintenance_enabled: true,
    maintenance_cutover_id: cutoverId,
  };
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql)) return { rows: [] };
      if (sql.includes("read_ai_content_cutover_control_state")) return { rows: [state] };
      if (sql.includes("transition_ai_content_cutover_status")) {
        state.cutover_status = "backend_verified";
        return { rows: [{ event_sha256: hash("a") }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  assert.deepEqual(await transitionCutoverToBackendVerified(client, {
    cutoverId, evidenceSha256,
  }), {
    cutoverId,
    status: "backend_verified",
    markerPresent: true,
    maintenanceEnabled: true,
    eventSha256: hash("a"),
    evidenceSha256,
  });
  assert.deepEqual(calls.map(({ sql }) => sql === "begin" || sql === "commit" ? sql : true), [
    "begin", true, true, true, "commit",
  ]);
  assert.match(calls[2].sql, /'migration_body_complete','backend_verified'/);
  assert.deepEqual(calls[2].values, [cutoverId, evidenceSha256]);

  const invalidCalls = [];
  const invalidClient = {
    async query(sql, values) {
      invalidCalls.push({ sql, values });
      if (["begin", "rollback"].includes(sql)) return { rows: [] };
      if (sql.includes("read_ai_content_cutover_control_state")) {
        return { rows: [{ ...state, marker_present: false, cutover_status: "maintenance_verified" }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    transitionCutoverToBackendVerified(invalidClient, { cutoverId, evidenceSha256 }),
    /ai_content_cutover_backend_verification_state_invalid/,
  );
  assert.equal(invalidCalls.some(({ sql }) => sql.includes("transition_ai_content_cutover_status")), false);
  assert.equal(invalidCalls.at(-1).sql, "rollback");
});

test("completion carries cleanup revocation evidence and disables maintenance in one transaction", async () => {
  const cutoverId = randomUUID();
  const cleanupRevocationEvidenceSha256 = hash("b");
  const cleanupCredentialRevokedAt = "2026-08-07T01:02:03.000Z";
  const calls = [];
  const state = {
    ...preparedControlState(cutoverId),
    cutover_status: "backend_verified",
    marker_present: true,
    maintenance_enabled: true,
    maintenance_cutover_id: cutoverId,
    cleanup_credential_revoked_at: new Date(cleanupCredentialRevokedAt),
    cleanup_revocation_evidence_sha256: cleanupRevocationEvidenceSha256,
  };
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql)) return { rows: [] };
      if (sql.includes("read_ai_content_cutover_control_state")) return { rows: [state] };
      if (sql.includes("transition_ai_content_cutover_status")) {
        state.cutover_status = "completed";
        state.active_cutover_count = "0";
        state.active_cutover_id = null;
        state.cleanup_credential_revoked_at = new Date(cleanupCredentialRevokedAt);
        state.cleanup_revocation_evidence_sha256 = cleanupRevocationEvidenceSha256;
        return { rows: [{ event_sha256: hash("c") }] };
      }
      if (sql.includes("set_ai_content_maintenance")) {
        state.maintenance_enabled = false;
        state.maintenance_cutover_id = null;
        return { rows: [{ set_ai_content_maintenance: null }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  assert.deepEqual(await completeCutover(client, {
    cutoverId,
    evidenceSha256: cleanupRevocationEvidenceSha256,
    cleanupCredentialRevokedAt,
    cleanupRevocationEvidenceSha256,
  }), {
    cutoverId,
    status: "completed",
    markerPresent: true,
    maintenanceEnabled: false,
    eventSha256: hash("c"),
    evidenceSha256: cleanupRevocationEvidenceSha256,
    cleanupCredentialRevokedAt,
    cleanupRevocationEvidenceSha256,
  });
  assert.equal(calls[0].sql, "begin");
  assert.match(calls[2].sql, /'backend_verified','completed'/);
  assert.deepEqual(calls[2].values, [
    cutoverId,
    cleanupRevocationEvidenceSha256,
    cleanupCredentialRevokedAt,
    cleanupRevocationEvidenceSha256,
  ]);
  assert.match(calls[3].sql, /set_ai_content_maintenance\(\$1::uuid,false\)/);
  assert.equal(calls[5].sql, "commit");

  await assert.rejects(
    completeCutover(client, {
      cutoverId,
      evidenceSha256: hash("d"),
      cleanupCredentialRevokedAt,
      cleanupRevocationEvidenceSha256,
    }),
    /ai_content_cutover_completion_evidence_mismatch/,
  );
  await assert.rejects(
    completeCutover(client, {
      cutoverId,
      evidenceSha256: cleanupRevocationEvidenceSha256,
      cleanupCredentialRevokedAt: "2026-08-07 01:02:03Z",
      cleanupRevocationEvidenceSha256,
    }),
    /ai_content_cutover_cleanup_revocation_timestamp_invalid/,
  );
});

function preparedControlState(cutoverId = randomUUID()) {
  return {
    requested_cutover_exists: true,
    cutover_status: "prepared",
    marker_present: false,
    maintenance_enabled: false,
    maintenance_cutover_id: null,
    active_cutover_count: "1",
    active_cutover_id: cutoverId,
    cleanup_credential_revoked_at: null,
    cleanup_revocation_evidence_sha256: null,
  };
}

test("operator control-state validation enforces exact marker, maintenance, and active-row pairs", () => {
  const cutoverId = randomUUID();
  const state = preparedControlState(cutoverId);
  assert.deepEqual(validateCutoverControlState(state, cutoverId), {
    cutoverId,
    status: "prepared",
    markerPresent: false,
    activeCutoverCount: 1,
    activeCutoverId: cutoverId,
    maintenanceEnabled: false,
    maintenanceCutoverId: null,
    cleanupCredentialRevokedAt: null,
    cleanupRevocationEvidenceSha256: null,
  });

  assert.throws(
    () => validateCutoverControlState({ ...state, marker_present: true }, cutoverId),
    /ai_content_cutover_marker_status_invalid/,
  );
  assert.throws(
    () => validateCutoverControlState({ ...state, active_cutover_count: "0", active_cutover_id: null }, cutoverId),
    /ai_content_cutover_active_state_invalid/,
  );
  assert.throws(
    () => validateCutoverControlState({ ...state, requested_cutover_exists: false, cutover_status: null }, cutoverId),
    /ai_content_cutover_status_missing/,
  );

  const retiredBackend = {
    ...state,
    cutover_status: "backend_verified",
    marker_present: true,
    maintenance_enabled: true,
    maintenance_cutover_id: cutoverId,
    cleanup_credential_revoked_at: new Date("2026-08-07T01:02:03.000Z"),
    cleanup_revocation_evidence_sha256: hash("a"),
  };
  assert.equal(
    validateCutoverControlState(retiredBackend, cutoverId).cleanupCredentialRevokedAt,
    "2026-08-07T01:02:03.000Z",
  );
  assert.throws(
    () => validateCutoverControlState({
      ...retiredBackend, cleanup_revocation_evidence_sha256: null,
    }, cutoverId),
    /ai_content_cutover_cleanup_revocation_state_invalid/,
  );
});

test("status and rollback checks are read-only and become roll-forward-only after marker", async () => {
  const cutoverId = randomUUID();
  const state = preparedControlState(cutoverId);
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("public.read_ai_content_cutover_control_state")) return { rows: [state] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  const status = await readCutoverStatus(client, cutoverId);
  assert.equal(status.status, "prepared");
  assert.equal((await assertRollbackAllowed(client, cutoverId)).rollbackAllowed, true);
  assert.ok(calls.every(({ sql }) => !/^\s*(?:insert|update|delete|alter|create|drop)\b/i.test(sql)));
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ sql }) => /select \* from public\.read_ai_content_cutover_control_state\(\$1::uuid\)/.test(sql)));
  assert.ok(calls.every(({ values }) => values[0] === cutoverId));

  state.marker_present = true;
  state.cutover_status = "migration_body_complete";
  state.maintenance_enabled = true;
  state.maintenance_cutover_id = cutoverId;
  await assert.rejects(
    assertRollbackAllowed(client, cutoverId),
    /ai_content_cutover_roll_forward_only/,
  );
});

test("database URL files reject non-database URLs and verified TLS strips URL overrides", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-content-cutover-control-"));
  try {
    const validFile = path.join(directory, "operator-url");
    await writeFile(validFile, "postgresql://operator:secret@db.example.test:5432/postgres\n", { mode: 0o600 });
    assert.equal(
      await readSecureDatabaseUrl(validFile),
      "postgresql://operator:secret@db.example.test:5432/postgres",
    );

    const invalidFile = path.join(directory, "invalid-url");
    await writeFile(invalidFile, "https://db.example.test/not-a-database\n", { mode: 0o600 });
    await assert.rejects(readSecureDatabaseUrl(invalidFile), /ai_content_database_url_invalid/);

    const config = verifiedDatabaseClientConfig(
      "postgresql://operator:secret@project.supabase.co/postgres?sslmode=disable",
      { caBase64: Buffer.from("test-ca").toString("base64") },
    );
    assert.equal(new URL(config.connectionString).searchParams.has("sslmode"), false);
    assert.deepEqual(config.ssl, { rejectUnauthorized: true, ca: "test-ca" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
