import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildPrepareBody,
  parse074ConsumeEvidence,
  parse074StageEvidence,
  parseStrictJson,
} from "./ai-content-provider-artifacts.mjs";
import { readOrCreate075ProviderArtifacts } from "./ai-content-database-roles.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const cutoverId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const releaseSha = "1".repeat(40);

function proposalPreflight() {
  const identity = {
    preflightCandidateSha: releaseSha,
    contentProposalWorkerImageDigest: `sha256:${"2".repeat(64)}`,
    proposalWorkerSourceSha: "3".repeat(40),
    proposalWorkerTreeSha: "4".repeat(40),
    proposalContractSourceSha256: "5".repeat(64),
    proposalSchemaSha256: "6".repeat(64),
    proposalCatalogSha256: "7".repeat(64),
    proposalModelId: "gpt-5.6-terra",
    proposalCommandDescriptorSha256: "8".repeat(64),
    migrationSha256: "9".repeat(64),
  };
  return {
    contractVersion: "ai-content-075-proposal-preflight-evidence.v1",
    cutoverId,
    proposalPreflightIdentity: identity,
    proposalPreflightIdentitySha256: hash(JSON.stringify(identity)),
    proposalPreflightTransferSha256: "a".repeat(64),
  };
}

test("strict JSON rejects duplicate object keys instead of accepting the last value", () => {
  assert.throws(
    () => parseStrictJson('{"providerInstallRequest":{"action":"first"},"providerInstallRequest":{"action":"second"}}'),
    /ai_content_artifact_json_duplicate_key/,
  );
  assert.deepEqual(parseStrictJson('{"nested":{"left":1,"right":[true,null,"ok"]}}'), {
    nested: { left: 1, right: [true, null, "ok"] },
  });
});

test("074 stage extraction accepts exactly one sealed install object and rejects top-level drift", () => {
  const installRequest = { requestSha256: "b".repeat(64), action: "install_verify_074_enforcement_bundle" };
  const evidence = {
    applied: ["074_ai_content_maintenance_write_fence.sql"],
    migrationCount: 75,
    baselineRequired: false,
    bootstrap074RestartRequired: true,
    bootstrap074Stage: "provider_install_required",
    cutover075Deferred: true,
    providerInstallRequest: installRequest,
  };
  assert.deepEqual(parse074StageEvidence(JSON.stringify(evidence), {
    validateInstallRequest: (value) => value,
  }), installRequest);
  assert.throws(
    () => parse074StageEvidence(JSON.stringify({ ...evidence, unexpected: true }), {
      validateInstallRequest: (value) => value,
    }),
    /ai_content_074_stage_evidence_invalid/,
  );
  const duplicate = JSON.stringify(evidence).replace(
    '"providerInstallRequest":',
    '"providerInstallRequest":{"requestSha256":"0","action":"forged"},"providerInstallRequest":',
  );
  assert.throws(() => parse074StageEvidence(duplicate, {
    validateInstallRequest: (value) => value,
  }), /ai_content_artifact_json_duplicate_key/);
});

test("074 consume evidence must carry the exact provider revocation artifact", () => {
  const revocation = {
    contractVersion: "ai-content-074-membership-revocation-request.v2",
    authorizationRequestId: "request-1",
    providerRequestSha256: "c".repeat(64),
    migrationRoleName: "content_migration",
    schemaOwnerRoleName: "content_schema_owner",
    evidenceSha256: "d".repeat(64),
    requestSha256: "e".repeat(64),
  };
  const evidence = {
    applied: [], migrationCount: 75, baselineRequired: false,
    bootstrap074RestartRequired: true,
    bootstrap074Stage: "provider_evidence_consumed",
    cutover075Deferred: true,
    providerInstallRequest: { requestSha256: "c".repeat(64) },
    revocationRequest: revocation,
  };
  assert.deepEqual(parse074ConsumeEvidence(JSON.stringify(evidence), revocation, {
    canonicalRevocation: JSON.stringify,
  }), revocation);
  assert.deepEqual(parse074ConsumeEvidence(JSON.stringify({
    ...evidence, bootstrap074Stage: "provider_evidence_already_consumed",
  }), revocation, { canonicalRevocation: JSON.stringify }), revocation);
  assert.throws(() => parse074ConsumeEvidence(JSON.stringify(evidence), {
    ...revocation, evidenceSha256: "f".repeat(64),
  }, { canonicalRevocation: JSON.stringify }), /ai_content_074_revocation_mismatch/);
});

test("prepare body hashes raw no-newline credentials and binds exact files, cutover, roles, and release", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "brand-pilot-prepare-artifacts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = Object.fromEntries(["bypass", "cleanup", "roles", "incident", "preserved", "preflight"]
    .map((name) => [name, join(directory, name)]));
  await writeFile(paths.bypass, "b".repeat(64));
  await writeFile(paths.cleanup, "c".repeat(64));
  await writeFile(paths.roles, JSON.stringify({
    contractVersion: "ai-content-database-role-verification.v1",
    planSha256: "d".repeat(64), roleCatalogSha256: "e".repeat(64),
    objectCatalogSha256: "f".repeat(64),
  }));
  await writeFile(paths.incident, "incident-bytes\n");
  await writeFile(paths.preserved, "preserved-bytes\n");
  await writeFile(paths.preflight, JSON.stringify(proposalPreflight()));

  const body = await buildPrepareBody({
    cutoverId, releaseSha,
    bypassTokenFile: paths.bypass, cleanupTokenFile: paths.cleanup,
    roleVerificationFile: paths.roles,
    providerBackupId: "logical:backup-2026-08-07",
    providerSnapshotCreatedAt: "2026-08-07T00:00:00.000Z",
    incidentBundleFile: paths.incident,
    preservedDataManifestFile: paths.preserved,
    proposalPreflightFile: paths.preflight,
  });
  assert.deepEqual(body.roleNames, {
    schemaOwnerRoleName: "content_schema_owner",
    applicationRoleName: "content_application",
    operatorRoleName: "content_operator",
    migrationRoleName: "content_migration",
    cleanupRoleName: "content_cleanup",
  });
  assert.equal(body.bypassTokenSha256, hash("b".repeat(64)));
  assert.equal(body.cleanupTokenSha256, hash("c".repeat(64)));
  assert.equal(body.databaseRoleCatalogSha256, "e".repeat(64));
  assert.equal(body.incidentBundleSha256, hash("incident-bytes\n"));
  assert.equal(body.preservedDataManifestSha256, hash("preserved-bytes\n"));
  assert.equal(body.proposalPreflight.cutoverId, cutoverId);
  assert.equal(body.intendedReleaseSha, releaseSha);

  await writeFile(paths.bypass, `${"b".repeat(64)}\n`);
  await assert.rejects(() => buildPrepareBody({
    cutoverId, releaseSha,
    bypassTokenFile: paths.bypass, cleanupTokenFile: paths.cleanup,
    roleVerificationFile: paths.roles,
    providerBackupId: "logical:backup-2026-08-07",
    providerSnapshotCreatedAt: "2026-08-07T00:00:00.000Z",
    incidentBundleFile: paths.incident,
    preservedDataManifestFile: paths.preserved,
    proposalPreflightFile: paths.preflight,
  }), /ai_content_cutover_token_invalid/);
  assert.equal((await readFile(paths.cleanup)).length, 64);
});

test("cutover shell exposes phase-bound artifact modes without logging or env-injecting secrets", async () => {
  const source = await readFile(new URL("../deploy/scripts/ai-content-cutover.sh", import.meta.url), "utf8");
  for (const mode of [
    "--initialize-provider-artifacts", "--verify-and-authorize-074",
    "--install-074-enforcement-bundle", "--install-075-ddl-allowlist",
    "--collect-prepare-inputs", "--create-prepare-evidence",
  ]) assert.match(source, new RegExp(mode.replaceAll("-", "\\-")));
  assert.match(source, /provider-artifacts/);
  assert.match(source, /openssl genpkey -algorithm ED25519/);
  assert.match(source, /mount_readonly "\$PROVIDER_PRIVATE_KEY_FILE" \/run\/secrets\/provider-private\.pem/);
  assert.match(source, /mount_readonly "\$AUTHORIZATION_PRIVATE_KEY_FILE" \/run\/secrets\/authorization-private\.pem/);
  assert.doesNotMatch(source, /--env [^\n]*(?:PRIVATE_KEY|BYPASS_TOKEN|CLEANUP_TOKEN)=\$/);
  assert.doesNotMatch(source, /printf[^\n]*\$(?:bypass_token|cleanup_token)/);
  const init = source.slice(source.indexOf("run_initialize_provider_artifacts()"), source.indexOf("run_verify_and_authorize_074()"));
  assert.match(init, /require_command openssl/);
  assert.doesNotMatch(source.slice(source.indexOf("run_verify_and_authorize_074()")), /require_command openssl/);
  const install075 = source.slice(source.indexOf("run_install_075_ddl_allowlist()"), source.indexOf("run_create_prepare_evidence()"));
  assert.match(install075, /require_active_cutover/);
  assert.match(install075, /parse-074-consume-evidence/);
  assert.match(install075, /for existing_provider_output in "\$authorization_file" "\$attestation_file"/);
  assert.doesNotMatch(install075, /ai_content_075_provider_artifact_state_incomplete/);
  const providerLifecycle = source.slice(
    source.indexOf("remove_provider_temporary_directory()"),
    source.indexOf("run_role_plan()"),
  );
  assert.match(providerLifecycle, /readlink -f -- "\$parent"/);
  assert.match(providerLifecycle, /readlink -f -- "\$directory"/);
  assert.doesNotMatch(providerLifecycle, /rm -rf -- "\$temporary_directory"/);
  const collectPrepare = source.slice(
    source.indexOf("run_collect_prepare_inputs()"),
    source.indexOf("run_create_prepare_evidence()"),
  );
  assert.match(collectPrepare, /load_runtime_release/);
  assert.match(collectPrepare, /require_pre_marker_inactive_phase/);
  assert.match(collectPrepare, /mount_readonly "\$admin_file" \/run\/secrets\/provider-admin-database-url/);
  assert.match(collectPrepare, /collect-ai-content-prepare-evidence\.mjs/);
  assert.match(collectPrepare, /--execution-graph-root \/app/);
  assert.match(collectPrepare, /incident-evidence\.json\.sha256/);
  assert.match(collectPrepare, /preserved-data-catalog\.json\.sha256/);
  assert.match(collectPrepare, /copy_durable_evidence "\$incident_file" "\$incident_output"/);
  assert.match(collectPrepare, /copy_durable_evidence "\$preserved_file" "\$preserved_output"/);
});

test("provider database CLI recovers 074 response loss and seals 075 artifacts before provider mutation", async () => {
  const source = await readFile(new URL("./ai-content-database-roles.mjs", import.meta.url), "utf8");
  const cutoverShell = await readFile(new URL("../deploy/scripts/ai-content-cutover.sh", import.meta.url), "utf8");
  assert.match(source, /async function signingIdentity\(privateKeyFile, keyId, expectedPublicKeySha256\)/);
  assert.match(source, /publicKeySha256 !== expectedPublicKeySha256/);
  assert.match(cutoverShell, /--authorization-public-key-sha256 "\$AUTHORIZATION_KEY_SHA256"/);
  assert.match(cutoverShell, /--provider-public-key-sha256 "\$PROVIDER_KEY_SHA256"/);
  const install074 = source.slice(
    source.indexOf("export async function installProvider074EnforcementBundle"),
    source.indexOf("async function secureRead"),
  );
  assert.match(install074, /provider_074_artifact_recovery_v1/);
  assert.match(install074, /validateProviderEventTriggerAttestation/);
  assert.match(install074, /validateMembershipRevocationEvidence/);
  assert.match(install074, /allowExpiredSealed:\s*true/);
  assert.ok(
    install074.indexOf("provider_074_artifact_recovery_v1") < install074.indexOf("probeProvider074Capability"),
    "a replay must recover the committed provider artifacts before attempting another event-trigger install",
  );

  const cli075Start = source.indexOf('if (mode === "--install-075-ddl-allowlist")');
  const cli075 = source.slice(
    cli075Start,
    source.indexOf('throw new Error("ai_content_database_roles_cli_invalid")', cli075Start),
  );
  assert.match(cli075, /attestation_consumed_at/);
  assert.match(cli075, /ai_content_074_attestation_not_consumed/);
  assert.match(cli075, /readOrCreate075ProviderArtifacts/);
  assert.ok(
    cli075.indexOf("readOrCreate075ProviderArtifacts") < cli075.indexOf("installCutover075AllowlistWithProvider"),
    "authorization and attestation must be durable before the provider transaction begins",
  );
});

test("075 provider artifact bundle restores a missing response file without issuing a new signed request", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "brand-pilot-075-provider-response-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const authorizationOutput = join(directory, "authorization.json");
  const attestationOutput = join(directory, "attestation.json");
  let createCount = 0;
  const createArtifacts = () => {
    createCount += 1;
    return {
      authorization: { requestId: "11111111-1111-4111-8111-111111111111", signature: "auth" },
      attestation: { requestId: "11111111-1111-4111-8111-111111111111", signature: "provider" },
    };
  };
  const first = await readOrCreate075ProviderArtifacts({
    journalDirectory: directory, authorizationOutput, attestationOutput, createArtifacts,
  });
  await rm(authorizationOutput);
  const recovered = await readOrCreate075ProviderArtifacts({
    journalDirectory: directory, authorizationOutput, attestationOutput, createArtifacts,
  });
  assert.deepEqual(recovered, first);
  assert.equal(createCount, 1);
  assert.deepEqual(JSON.parse(await readFile(authorizationOutput, "utf8")), first.authorization);
});

test("explicit 074 consume mode can recover a committed response loss without weakening ordinary migration runs", async () => {
  const [cutover, migrate, runner] = await Promise.all([
    readFile(new URL("../deploy/scripts/ai-content-cutover.sh", import.meta.url), "utf8"),
    readFile(new URL("./migrate.mjs", import.meta.url), "utf8"),
    readFile(new URL("./migrationRunner.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(cutover, /AI_CONTENT_074_ALLOW_CONSUMED_RECOVERY=true/);
  assert.match(migrate, /AI_CONTENT_074_ALLOW_CONSUMED_RECOVERY/);
  assert.match(runner, /bootstrap074Stage === "provider_evidence_already_consumed"[\s\S]{0,180}!bootstrap074\?\.allowConsumedRecovery/);
});
