import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "pg";
import {
  applicationRuntimeFunctionOwnershipCatalog,
  schemaOwnerCutoverRelationSecurityCatalog,
  sharedOwnerTransferSecurityCatalog,
} from "./ai-content-database-roles.mjs";
import * as migrationRunner from "./migrationRunner.mjs";
import { resolveMigrationRuntimeConfig, validateSecureCutoverFileMetadata } from "./migrate.mjs";

const noProviderRoleCapabilities = Object.freeze({
  is_superuser: false,
  bypass_rls: false,
  can_create_db: false,
  can_create_role: false,
  can_replicate: false,
});
const safeBootstrapRoleConfig = Object.freeze(["search_path=pg_catalog,public,pg_temp"]);
const publicFirstBootstrapRoleConfig = Object.freeze(["search_path=public,pg_catalog,pg_temp"]);
const bootstrapRoleConfig = (roleName) => ["content_schema_owner", "content_migration"].includes(roleName)
  ? publicFirstBootstrapRoleConfig : safeBootstrapRoleConfig;
const stableBootstrapRoleEnvironment = (overrides = {}) => ({
  database_name: "ai_content_test",
  database_owner_role_name: "postgres",
  public_schema_owner_role_name: "pg_database_owner",
  public_schema_acl: [
    { grantee: "pg_database_owner", privilege: "CREATE", grantable: false },
    { grantee: "pg_database_owner", privilege: "USAGE", grantable: false },
    { grantee: "content_schema_owner", privilege: "CREATE", grantable: false },
    { grantee: "content_schema_owner", privilege: "USAGE", grantable: false },
    ...["content_application", "content_operator", "content_migration", "content_cleanup"]
      .map((grantee) => ({ grantee, privilege: "USAGE", grantable: false })),
  ],
  database_settings: [],
  session_user_name: "content_migration",
  current_user_name: "content_migration",
  effective_search_path: "public,pg_catalog,pg_temp",
  ...overrides,
});
const stableBootstrapRoleCatalog = (roles, membershipEdges) => {
  const environment = stableBootstrapRoleEnvironment();
  return {
    roles,
    membershipEdges,
    databaseSettings: environment.database_settings,
    database: { database_name: environment.database_name, owner_role_name: environment.database_owner_role_name },
    publicSchema: { owner_role_name: environment.public_schema_owner_role_name, acl: environment.public_schema_acl },
  };
};
const prerequisiteRoleNames = Object.freeze({
  schemaOwnerRoleName: "content_schema_owner",
  applicationRoleName: "content_application",
  operatorRoleName: "content_operator",
  migrationRoleName: "content_migration",
  cleanupRoleName: "content_cleanup",
});

const { buildMigrationPlan } = migrationRunner;

const stableRelationShape = (ownerRoleName, acl = []) => ({
  relation_kind: "r",
  relation_persistence: "p",
  replica_identity: "d",
  is_partition: false,
  partition_bound: null,
  inheritance_parents: [],
  internal_constraint_triggers: [],
  row_security: false,
  force_row_security: false,
  owner_role_name: ownerRoleName,
  acl,
  columns: [],
  constraints: [],
  indexes: [],
  rules: [],
  policies: [],
});

const stableStoredRelationShape = (ownerRoleName, acl = []) => ({
  relationKind: "r",
  relationPersistence: "p",
  replicaIdentity: "d",
  isPartition: false,
  partitionBound: null,
  inheritanceParents: [],
  internalConstraintTriggers: [],
  rowSecurity: false,
  forceRowSecurity: false,
  ownerRoleName,
  acl,
  columns: [],
  constraints: [],
  indexes: [],
  rules: [],
  policies: [],
});

const stableTriggerFunctionCatalog = (identity = "public.set_updated_at()", overrides = {}) => ({
  identity,
  definition_sha256: "1".repeat(64),
  source_sha256: "2".repeat(64),
  owner_role_name: "content_schema_owner",
  security_definer: false,
  language_name: "plpgsql",
  function_kind: "f",
  volatility: "v",
  parallel_safety: "u",
  leakproof: false,
  strict: false,
  return_set: false,
  return_type_identity: "pg_catalog.trigger",
  config: [],
  acl: [{ grantee: "PUBLIC", privilege: "EXECUTE", grantable: false }],
  dependency_functions: [],
  ...overrides,
});

const stableEventFunctionCatalog = (identity, definitionSha256, ownerRoleName = "postgres", overrides = {}) => ({
  ...stableTriggerFunctionCatalog(identity, {
    definition_sha256: definitionSha256,
    source_sha256: createHash("sha256").update(identity).digest("hex"),
    owner_role_name: ownerRoleName,
    security_definer: true,
    return_type_identity: "pg_catalog.event_trigger",
    config: ["search_path=pg_catalog,public"],
    acl: [{ grantee: ownerRoleName, privilege: "EXECUTE", grantable: false }],
    dependency_functions: undefined,
  }),
  ...overrides,
});

test("074 seals one no-argument 075 fence registration primitive and its exact relation set", async () => {
  assert.deepEqual(migrationRunner.bootstrapTriggerFunctionDependencies, [{
    triggerFunctionIdentity: "public.revoke_ai_content_one_time_avatar_on_attachment_unavailable()",
    dependencyFunctionIdentities: ["public.revoke_ai_content_one_time_avatar_receipt(uuid,text)"],
  }]);
  assert.deepEqual(migrationRunner.cutover075FenceCatalog, [
    ["ai_content_cutover_release_adoption_events", "cutover_control"],
    ["ai_content_cutover_release_adoptions", "cutover_control"],
    ["ai_content_generation_operations", "customer_execution"],
    ["ai_content_generation_prompt_bindings", "customer_execution"],
    ["ai_content_proposal_attempt_events", "customer_execution"],
    ["ai_content_proposal_compositions", "customer_execution"],
    ["ai_content_proposal_job_contracts", "customer_execution"],
    ["ai_content_proposal_model_attempts", "customer_execution"],
    ["ai_content_proposal_performance_audits", "customer_execution"],
    ["ai_content_proposal_research_attempt_events", "customer_execution"],
    ["ai_content_proposal_research_attempts", "customer_execution"],
    ["ai_content_storage_cleanup_outbox", "cutover_control"],
    ["automated_content_proposal_runs", "customer_execution"],
  ].map(([relation_name, relation_class]) => ({
    relation_name, relation_class, row_classifier: "whole_relation",
  })));
  assert.ok(
    migrationRunner.providerEnforcementBundle.functions.includes(
      "public.register_ai_content_075_fence_relations()",
    ),
  );
  assert.ok(
    migrationRunner.providerEnforcementBundle.functions.includes(
      "public.enforce_ai_content_075_registration_seal_cleared()",
    ),
  );
  const sql = await readFile("db/migrations/074_ai_content_maintenance_write_fence.sql", "utf8");
  assert.match(sql, /create function register_ai_content_075_fence_relations\(\)/i);
  assert.match(sql, /create constraint trigger ai_content_bootstrap_075_registration_must_clear[\s\S]*deferrable initially deferred[\s\S]*enforce_ai_content_075_registration_seal_cleared\(\)/i);
  assert.doesNotMatch(sql, /register_ai_content_075_fence_relations\([^)]*[a-z_][^)]*\)/i);
  assert.match(sql, /0064a071335735af54bc80a84524fed783e5db72bf19055555a6b1c64d398c7a/);
  assert.match(sql, /22ebe515247269120f8996bc63f335f27b7f767c36fcf667011312cfb03f3661/);
  assert.match(sql, /app\.ai_content_cutover_id/i);
  assert.match(sql, /app\.ai_content_cutover_token/i);
  assert.match(sql, /app\.ai_content_migration_id/i);
  assert.match(sql, /ai_content_write_fence_relation_structure_mismatch/i);
  assert.match(sql, /relrowsecurity[\s\S]*relforcerowsecurity[\s\S]*pg_rewrite[\s\S]*pg_policy/i);
  assert.match(sql, /075_ai_content_three_format_cutover\.sql/i);
  assert.match(sql, /schema_migrations[\s\S]*075_ai_content_three_format_cutover\.sql/i);
});

test("075 post-cutover security catalog is closed over 13 relations, 37 functions, and 32 domain triggers", () => {
  assert.equal(migrationRunner.cutover075RelationSecurityCatalog.length, 13);
  assert.equal(migrationRunner.cutover075SecurityFunctions.length, 37);
  assert.equal(migrationRunner.cutover075DomainTriggers.length, 32);
  assert.deepEqual(
    migrationRunner.cutover075SecurityFunctions.filter(({ identity }) => [
      "public.transition_ai_content_generation_operation(uuid,text,text)",
      "public.create_ai_content_generation_prompt_binding(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)",
      "public.select_ai_content_proposal(uuid,uuid,uuid,uuid)",
    ].includes(identity)).map(({ identity, securityDefiner, execute }) => ({
      identity, securityDefiner, execute,
    })),
    [{
      identity: "public.transition_ai_content_generation_operation(uuid,text,text)",
      securityDefiner: true,
      execute: ["application"],
    }, {
      identity: "public.select_ai_content_proposal(uuid,uuid,uuid,uuid)",
      securityDefiner: false,
      execute: ["application"],
    }, {
      identity: "public.create_ai_content_generation_prompt_binding(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)",
      securityDefiner: true,
      execute: ["application"],
    }],
  );
  assert.deepEqual(
    migrationRunner.cutover075SecurityFunctions.filter(({ identity }) => [
      "public.complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)",
      "public.enforce_ai_content_proposal_research_completion_pair()",
    ].includes(identity)),
    [{
      identity: "public.enforce_ai_content_proposal_research_completion_pair()",
      securityDefiner: true,
      owner: "schemaOwner",
      execute: [],
      language: "plpgsql",
      kind: "f",
      volatility: "v",
      parallel: "u",
      leakproof: false,
      strict: false,
      returnType: "pg_catalog.trigger",
      returnSet: false,
      config: ["search_path=pg_catalog,public,pg_temp"],
    }, {
      identity: "public.complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)",
      securityDefiner: true,
      owner: "schemaOwner",
      execute: ["application"],
      language: "plpgsql",
      kind: "f",
      volatility: "v",
      parallel: "u",
      leakproof: false,
      strict: false,
      returnType: "public.ai_content_proposal_compositions",
      returnSet: false,
      config: ["search_path=pg_catalog,public,pg_temp"],
    }],
  );
  assert.deepEqual(
    migrationRunner.cutover075DomainTriggers.filter(({ triggerName }) => (
      triggerName === "ai_content_proposal_research_attempt_events_completion_pair"
    )),
    [{
      relationName: "ai_content_proposal_research_attempt_events",
      triggerName: "ai_content_proposal_research_attempt_events_completion_pair",
      triggerType: 21,
      functionIdentity: "public.enforce_ai_content_proposal_research_completion_pair()",
      enabled: "O",
      deferrable: true,
      initiallyDeferred: true,
      updateColumns: [],
      whenClause: null,
      definition: "CREATE CONSTRAINT TRIGGER ai_content_proposal_research_attempt_events_completion_pair AFTER INSERT OR UPDATE ON ai_content_proposal_research_attempt_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_ai_content_proposal_research_completion_pair()",
    }],
  );
  assert.deepEqual(
    migrationRunner.cutover075DomainTriggers.find(({ triggerName }) => (
      triggerName === "automated_content_proposal_runs_identity_immutable"
    ))?.updateColumns,
    ["workspace_id", "brand_id", "caller_operation_key", "request_fingerprint_sha256",
      "caller_transaction_id", "frozen_source_snapshot_ids", "proposal_batch_id"],
  );
  assert.deepEqual(
    migrationRunner.cutover075DomainTriggers.filter(({ relationName }) => relationName === "ai_content_proposal_jobs"),
    [{
      relationName: "ai_content_proposal_jobs",
      triggerName: "ai_content_proposal_jobs_contract_required",
      triggerType: 5,
      functionIdentity: "public.reject_ai_content_cutover_record_mutation()",
      enabled: "O",
      deferrable: true,
      initiallyDeferred: true,
      updateColumns: [],
      whenClause: null,
      definition: "CREATE CONSTRAINT TRIGGER ai_content_proposal_jobs_contract_required AFTER INSERT ON ai_content_proposal_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_ai_content_cutover_record_mutation()",
    }, {
      relationName: "ai_content_proposal_jobs",
      triggerName: "ai_content_proposal_jobs_invocation_evidence_guard",
      triggerType: 21,
      functionIdentity: "public.reject_ai_content_cutover_record_mutation()",
      enabled: "O",
      deferrable: true,
      initiallyDeferred: true,
      updateColumns: [],
      whenClause: null,
      definition: "CREATE CONSTRAINT TRIGGER ai_content_proposal_jobs_invocation_evidence_guard AFTER INSERT OR UPDATE ON ai_content_proposal_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_ai_content_cutover_record_mutation()",
    }, {
      relationName: "ai_content_proposal_jobs",
      triggerName: "ai_content_proposal_jobs_invocation_reclaim_guard",
      triggerType: 23,
      functionIdentity: "public.reject_ai_content_cutover_record_mutation()",
      enabled: "O",
      deferrable: false,
      initiallyDeferred: false,
      updateColumns: [],
      whenClause: null,
      definition: "CREATE TRIGGER ai_content_proposal_jobs_invocation_reclaim_guard BEFORE INSERT OR UPDATE ON ai_content_proposal_jobs FOR EACH ROW EXECUTE FUNCTION reject_ai_content_cutover_record_mutation()",
    }],
  );

  const names = {
    schemaOwnerRoleName: "content_schema_owner", applicationRoleName: "content_application",
    operatorRoleName: "content_operator", migrationRoleName: "content_migration", cleanupRoleName: "content_cleanup",
  };
  const roleFor = (key) => key === "provider" ? "postgres" : names[`${key}RoleName`];
  const sourceSha256ByIdentity = Object.fromEntries(migrationRunner.cutover075SecurityFunctions
    .map(({ identity }) => [identity, createHash("sha256").update(`source:${identity}`).digest("hex")]));
  const functionRows = migrationRunner.cutover075SecurityFunctions.map((expected) => ({
    identity: expected.identity,
    definition_sha256: createHash("sha256").update(expected.identity).digest("hex"),
    source_sha256: sourceSha256ByIdentity[expected.identity],
    owner_role_name: roleFor(expected.owner), security_definer: expected.securityDefiner,
    language_name: expected.language, function_kind: expected.kind, volatility: expected.volatility,
    parallel_safety: expected.parallel, leakproof: expected.leakproof, strict: expected.strict,
    return_set: expected.returnSet, return_type_identity: expected.returnType,
    config: expected.config,
    acl: [
      { grantee: roleFor(expected.owner), privilege: "EXECUTE", grantable: false },
      ...(expected.execute ?? []).filter((key) => roleFor(key) !== roleFor(expected.owner))
        .map((key) => ({ grantee: roleFor(key), privilege: "EXECUTE", grantable: false })),
    ],
  }));
  const relationRows = migrationRunner.cutover075RelationSecurityCatalog.map((expected) => ({
    ...stableRelationShape(roleFor(expected.owner)), relation_name: expected.relationName,
    columns: [{ ordinal_position: 1, column_name: "id", type_identity: "uuid", not_null: true,
      default_definition: "gen_random_uuid()", identity_kind: "", generated_kind: "",
      collation_identity: null, acl: [] }],
    constraints: [{ constraint_name: `${expected.relationName}_pkey`, constraint_type: "p",
      definition: "PRIMARY KEY (id)", validated: true, deferrable: false, initially_deferred: false }],
    indexes: [{ index_name: `${expected.relationName}_pkey`,
      definition: `CREATE UNIQUE INDEX ${expected.relationName}_pkey ON public.${expected.relationName} USING btree (id)`,
      primary: true, unique: true, valid: true, ready: true, live: true }],
    acl: [
      ...["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]
        .map((privilege) => ({ grantee: roleFor(expected.owner), privilege, grantable: false })),
      ...(expected.grants ?? []).flatMap(({ role, privileges }) => privileges
        .map((privilege) => ({ grantee: roleFor(role), privilege, grantable: false }))),
    ],
  }));
  const triggerRows = migrationRunner.cutover075DomainTriggers.map((expected) => ({
    relation_name: expected.relationName, trigger_name: expected.triggerName,
    trigger_type: expected.triggerType, enabled: "O", deferrable: expected.deferrable,
    initially_deferred: expected.initiallyDeferred, function_identity: expected.functionIdentity,
    update_columns: expected.updateColumns, when_clause: expected.whenClause,
    definition: expected.definition,
  }));
  const valid = { functionRows, relationRows, triggerRows };
  const postCatalog = migrationRunner.validateCutover075PostCatalog(
    valid, names, "postgres", sourceSha256ByIdentity,
  );
  assert.equal(JSON.parse(postCatalog.canonicalJson).contractVersion, "ai-content-075-post-security-catalog.v7");
  assert.match(postCatalog.catalogSha256, /^[0-9a-f]{64}$/);
  assert.equal(
    createHash("sha256").update(postCatalog.canonicalJson).digest("hex"),
    postCatalog.catalogSha256,
  );
  const reorderedPostCatalog = migrationRunner.validateCutover075PostCatalog({
    functionRows: structuredClone(functionRows).reverse().map((row) => ({ ...row, acl: row.acl.toReversed() })),
    relationRows: structuredClone(relationRows).reverse().map((row) => ({
      ...row, acl: row.acl.toReversed(), columns: row.columns.toReversed().map((column) => ({
        ...column, acl: column.acl.toReversed(),
      })),
      constraints: row.constraints.toReversed(), indexes: row.indexes.toReversed(),
    })),
    triggerRows: structuredClone(triggerRows).reverse(),
  }, names, "postgres", sourceSha256ByIdentity);
  assert.equal(reorderedPostCatalog.catalogSha256, postCatalog.catalogSha256);
  for (const tamper of [
    (row) => { row.columns[0].default_definition = "uuid_generate_v4()"; },
    (row) => { row.columns[0].acl.push({ grantee: "content_application", privilege: "UPDATE", grantable: false }); },
    (row) => { row.columns[0].collation_identity = "pg_catalog.C"; },
    (row) => { row.constraints[0].validated = false; },
    (row) => { row.indexes[0].definition += " WHERE id IS NOT NULL"; },
    (row) => { row.row_security = true; },
    (row) => { row.force_row_security = true; },
    (row) => { row.rules.push({ rule_name: "deny_update", event: "2", enabled: "O", instead: true,
      definition: "CREATE RULE deny_update AS ON UPDATE TO x DO INSTEAD NOTHING" }); },
    (row) => { row.policies.push({ policy_name: "tenant", permissive: true, roles: ["PUBLIC"], command: "r",
      qual: "true", with_check: null }); },
  ]) {
    const tampered = structuredClone(valid);
    tamper(tampered.relationRows[0]);
    const tamperedCatalog = migrationRunner.validateCutover075PostCatalog(
      tampered, names, "postgres", sourceSha256ByIdentity,
    );
    assert.notEqual(tamperedCatalog.catalogSha256, postCatalog.catalogSha256);
  }

  const attacks = [
    (catalog) => catalog.functionRows.pop(),
    (catalog) => { catalog.functionRows[0].owner_role_name = "content_application"; },
    (catalog) => { catalog.functionRows[1].security_definer = !catalog.functionRows[1].security_definer; },
    (catalog) => { catalog.functionRows[2].config = ["search_path=public"]; },
    (catalog) => { catalog.functionRows[3].source_sha256 = "0".repeat(64); },
    (catalog) => { catalog.functionRows[4].volatility = "s"; },
    (catalog) => { catalog.functionRows[5].strict = true; },
    (catalog) => catalog.relationRows.pop(),
    (catalog) => catalog.relationRows.push(structuredClone(catalog.relationRows[0])),
    (catalog) => { catalog.relationRows[0].owner_role_name = "content_schema_owner"; },
    (catalog) => { catalog.relationRows[1].acl.push({ grantee: "PUBLIC", privilege: "SELECT", grantable: false }); },
    (catalog) => { delete catalog.relationRows[0].columns[0].acl; },
    (catalog) => { delete catalog.relationRows[0].constraints; },
    (catalog) => catalog.triggerRows.pop(),
    (catalog) => catalog.triggerRows.push({ ...catalog.triggerRows[0], trigger_name: "rogue_trigger" }),
    (catalog) => { catalog.triggerRows[0].function_identity = "public.set_updated_at()"; },
    (catalog) => { catalog.triggerRows[0].update_columns = "{}"; },
    (catalog) => { catalog.triggerRows.find((row) => row.update_columns.length > 0).update_columns.pop(); },
    (catalog) => { catalog.triggerRows[0].when_clause = "(true)"; },
    (catalog) => { catalog.triggerRows[0].definition = `${catalog.triggerRows[0].definition} /* inert TG_ARGV */`; },
  ];
  for (const attack of attacks) {
    const tampered = structuredClone(valid);
    attack(tampered);
    assert.throws(
      () => migrationRunner.validateCutover075PostCatalog(tampered, names, "postgres", sourceSha256ByIdentity),
      /cutover_075_post_(?:function|relation|trigger)_catalog_mismatch/,
    );
  }
  const triggerDiagnostic = structuredClone(valid);
  triggerDiagnostic.triggerRows[0].trigger_type = 99;
  assert.throws(
    () => migrationRunner.validateCutover075PostCatalog(triggerDiagnostic, names, "postgres", sourceSha256ByIdentity),
    (error) => /cutover_075_post_trigger_catalog_mismatch:index=0/.test(error.message)
      && error.message.includes('"triggerType":99') && error.message.includes('"expected"'),
  );
});

test("075 proposal preflight identity is a closed immutable cutover contract", () => {
  const migrationSha256 = "7".repeat(64);
  const identity = {
    preflightCandidateSha: "1".repeat(40),
    contentProposalWorkerImageDigest: `sha256:${"2".repeat(64)}`,
    proposalWorkerSourceSha: "3".repeat(40),
    proposalWorkerTreeSha: "4".repeat(40),
    proposalContractSourceSha256: "5".repeat(64),
    proposalSchemaSha256: "6".repeat(64),
    proposalCatalogSha256: "8".repeat(64),
    proposalModelId: "gpt-5.6-terra",
    proposalCommandDescriptorSha256: "9".repeat(64),
    migrationSha256,
  };
  const row = {
    proposal_preflight_identity_json: identity,
    proposal_preflight_identity_sha256: "a".repeat(64),
    live_proposal_preflight_identity_sha256: "a".repeat(64),
    proposal_preflight_transfer_sha256: "b".repeat(64),
  };
  assert.deepEqual(migrationRunner.validateProposalPreflightIdentity(row, migrationSha256), {
    proposalPreflightIdentity: identity,
    proposalPreflightIdentitySha256: "a".repeat(64),
    proposalPreflightTransferSha256: "b".repeat(64),
  });
  for (const mutate of [
    (candidate) => { candidate.proposal_preflight_identity_json.unexpected = true; },
    (candidate) => { candidate.proposal_preflight_identity_json.proposalModelId = "gpt-4"; },
    (candidate) => { candidate.proposal_preflight_identity_json.migrationSha256 = "0".repeat(64); },
    (candidate) => { candidate.live_proposal_preflight_identity_sha256 = "0".repeat(64); },
    (candidate) => { candidate.proposal_preflight_transfer_sha256 = "bad"; },
  ]) {
    const candidate = structuredClone(row);
    mutate(candidate);
    assert.throws(() => migrationRunner.validateProposalPreflightIdentity(candidate, migrationSha256), /cutover_075_preflight_identity_invalid/);
  }
});

test("075 function source hashes bind the exact loaded migration instead of the default directory", async () => {
  const migration = (await migrationRunner.loadMigrations())
    .find(({ id }) => id === "075_ai_content_three_format_cutover.sql");
  assert.ok(migration);
  const hashes = migrationRunner.buildCutover075FunctionSourceHashes(migration);
  assert.deepEqual(Object.keys(hashes).sort(), migrationRunner.cutover075SecurityFunctions
    .map(({ identity }) => identity).sort());
  assert.ok(Object.values(hashes).every((value) => /^[0-9a-f]{64}$/.test(value)));
  assert.throws(
    () => migrationRunner.buildCutover075FunctionSourceHashes({ ...migration, sql: `${migration.sql}\n-- drift` }),
    /cutover_075_function_source_migration_invalid/,
  );
});

test("075 live trigger reader casts name[] update columns to driver-safe text[]", async () => {
  const source = await readFile("scripts/migrationRunner.mjs", "utf8");
  assert.match(source, /array_agg\(attribute\.attname::text order by selected\.ordinality\)/);
});

function createEd25519Identity(keyId) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const publicKeySha256 = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
  return {
    keyId,
    privateKey,
    verification: { publicKeyPem, expectedKeyId: keyId, expectedPublicKeySha256: publicKeySha256 },
    publicKeySha256,
  };
}

const authorizationIdentity = createEd25519Identity("authorization-2026-08");
const providerIdentity = createEd25519Identity("provider-attestation-2026-08");

function signAuthorization(payload, identity = authorizationIdentity) {
  const unsigned = {
    ...payload,
    algorithm: "Ed25519",
    keyId: identity.keyId,
    providerAttestationKeyId: providerIdentity.keyId,
    providerAttestationPublicKeySha256: providerIdentity.publicKeySha256,
    providerEnforcementBundleSha256: migrationRunner.providerEnforcementBundleSha256,
  };
  return {
    ...unsigned,
    signature: sign(null, Buffer.from(migrationRunner.canonicalBootstrapAuthorizationPayload(unsigned)), identity.privateKey).toString("base64"),
  };
}

function signProviderAttestation(payload, identity = providerIdentity) {
  const unsigned = { ...payload, algorithm: "Ed25519", keyId: identity.keyId };
  return {
    ...unsigned,
    signature: sign(null, Buffer.from(migrationRunner.canonicalProviderAttestationPayload(unsigned)), identity.privateKey).toString("base64"),
  };
}

function signCutoverAllowlistAuthorization(payload, identity = authorizationIdentity) {
  const unsigned = {
    ...payload,
    algorithm: "Ed25519",
    keyId: identity.keyId,
    providerAttestationKeyId: providerIdentity.keyId,
    providerAttestationPublicKeySha256: providerIdentity.publicKeySha256,
  };
  return {
    ...unsigned,
    signature: sign(
      null,
      Buffer.from(migrationRunner.canonicalCutoverAllowlistAuthorizationPayload(unsigned)),
      identity.privateKey,
    ).toString("base64"),
  };
}

function signCutoverAllowlistAttestation(payload, identity = providerIdentity) {
  const unsigned = { ...payload, algorithm: "Ed25519", keyId: identity.keyId };
  return {
    ...unsigned,
    signature: sign(
      null,
      Buffer.from(migrationRunner.canonicalCutoverAllowlistAttestationPayload(unsigned)),
      identity.privateKey,
    ).toString("base64"),
  };
}

const cutover075RoleNames = Object.freeze({
  schemaOwnerRoleName: "content_schema_owner",
  applicationRoleName: "content_application",
  operatorRoleName: "content_operator",
  migrationRoleName: "content_migration",
  cleanupRoleName: "content_cleanup",
});

function makeInterimFenceSecurityCatalog(schemaOwnerRoleName = "content_schema_owner") {
  const ownerAcl = [{ grantee: schemaOwnerRoleName, privilege: "EXECUTE", grantable: false }];
  return {
    contractVersion: "ai-content-074-fence-security-catalog.v5",
    functions: migrationRunner.providerEnforcementBundle.functions.map((identity) => ({
      identity,
      definitionSha256: createHash("sha256").update(identity).digest("hex"),
      ownerRoleName: schemaOwnerRoleName,
      securityDefiner: true,
      config: ["search_path=pg_catalog,public"],
      acl: ownerAcl,
    })),
    ordinaryTriggers: [],
    controlTriggers: [{
      relationName: "ai_content_bootstrap_state",
      triggerName: "ai_content_bootstrap_075_registration_must_clear",
      triggerType: 21,
      functionIdentity: "public.enforce_ai_content_075_registration_seal_cleared()",
      enabled: "O",
      deferrable: true,
      initiallyDeferred: true,
      definition: "CREATE CONSTRAINT TRIGGER ai_content_bootstrap_075_registration_must_clear AFTER INSERT OR UPDATE ON ai_content_bootstrap_state DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_ai_content_075_registration_seal_cleared()",
    }, {
      relationName: "ai_content_cutover_status_events",
      triggerName: "ai_content_cutover_status_events_immutable",
      triggerType: 27,
      functionIdentity: "public.forbid_ai_content_cutover_event_mutation()",
      enabled: "O",
      deferrable: false,
      initiallyDeferred: false,
      definition: "CREATE TRIGGER ai_content_cutover_status_events_immutable BEFORE DELETE OR UPDATE ON ai_content_cutover_status_events FOR EACH ROW EXECUTE FUNCTION forbid_ai_content_cutover_event_mutation()",
    }],
    fenceCatalog: [],
    controlRelations: migrationRunner.providerEnforcementBundle.controlRelations.map((relationName) => {
      const extras = [];
      if (relationName === "ai_content_maintenance_state") {
        extras.push({ grantee: "content_application", privilege: "SELECT", grantable: false });
      }
      if (["ai_content_bootstrap_state", "ai_content_ddl_allowlist", "ai_content_write_fence_catalog"].includes(relationName)) {
        extras.push({ grantee: "content_migration", privilege: "SELECT", grantable: false });
      }
      if (relationName === "ai_content_bootstrap_state" && schemaOwnerRoleName !== "content_schema_owner") {
        extras.push({ grantee: "content_schema_owner", privilege: "SELECT", grantable: false });
      }
      return {
        relationName,
        ...stableStoredRelationShape(schemaOwnerRoleName, [
          ...["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]
            .map((privilege) => ({ grantee: schemaOwnerRoleName, privilege, grantable: false })),
          ...extras,
        ]),
      };
    }),
  };
}

test("074 standalone PostgreSQL dependency bootstrap pins verified pgvector source", async () => {
  const source = await readFile(new URL("./ai-content-074.postgres.integration.test.mjs", import.meta.url), "utf8");
  assert.match(source, /778dacf20c07caf904557a88705142631818d8cb/);
  assert.match(source, /4c33cf053329784ba6d992d05c9588b93789e907a7511f20ff5a5a5b8a0703c1/i);
  assert.match(source, /sha256sum\s+-c/);
  assert.match(source, /pgvector-778dacf20c07caf904557a88705142631818d8cb/);
  assert.doesNotMatch(source, /git\s+clone|refs\/tags\/v0\.8\.1/);
  assert.ok(source.indexOf("sha256sum -c") < source.indexOf("tar -xzf"), "archive must be verified before extraction");
});

test("074 runner exposes no signing primitive or private-key input", () => {
  assert.equal(migrationRunner.signBootstrapRoleAuthorization, undefined);
  assert.equal(migrationRunner.signProviderEventTriggerAttestation, undefined);
  assert.equal("privateKey" in authorizationIdentity.verification, false);
  assert.equal("privateKey" in providerIdentity.verification, false);
});

test("075 derives one closed exact DDL allowlist and rejects wildcard or lookalike rows", async () => {
  const migration = (await migrationRunner.loadMigrations())
    .find(({ id }) => id === "075_ai_content_three_format_cutover.sql");
  assert.ok(migration);

  const rows = migrationRunner.buildCutover075ExactDdlAllowlist(migration, cutover075RoleNames);
  assert.ok(rows.length > migrationRunner.cutover075OwnerAuthorizationRows.length);
  assert.equal(rows.some(({ objectIdentityPattern }) => objectIdentityPattern.includes("%")), false);
  assert.ok(rows.some(({ commandTag, objectIdentityPattern }) => commandTag === "CREATE TABLE"
    && objectIdentityPattern === "public.ai_content_generation_operations"));
  assert.ok(rows.some(({ commandTag, objectIdentityPattern }) => commandTag === "CREATE INDEX"
    && objectIdentityPattern === "public.ai_content_generations_operation_unique"));
  for (const implicitIndex of [
    "ai_content_generation_operations_pkey",
    "ai_content_generation_operations_scope_unique",
    "ai_content_proposal_research_attempt_events_event_sha256_key",
    "ai_content_cutover_release_adoptions_caller_id_key",
    "ai_content_cutover_release_adoptions_pkey",
    "ai_content_proposals_batch_scope_unique",
  ]) {
    assert.ok(rows.some(({ commandTag, objectIdentityPattern }) => commandTag === "CREATE INDEX"
      && objectIdentityPattern === `public.${implicitIndex}`), implicitIndex);
  }
  assert.ok(rows.some(({ commandTag, objectIdentityPattern }) => commandTag === "CREATE TRIGGER"
    && objectIdentityPattern === "ai_content_generation_operations_identity_immutable on public.ai_content_generation_operations"));
  for (const triggerName of [
    "ai_content_proposal_jobs_invocation_reclaim_guard",
    "ai_content_proposal_jobs_invocation_evidence_guard",
  ]) {
    assert.ok(rows.some(({ commandTag, objectIdentityPattern }) => commandTag === "CREATE TRIGGER"
      && objectIdentityPattern === `${triggerName} on public.ai_content_proposal_jobs`));
  }
  assert.ok(rows.some(({ commandTag, objectIdentityPattern }) => commandTag === "CREATE TRIGGER"
    && objectIdentityPattern === "ai_content_proposal_research_attempt_events_completion_pair on public.ai_content_proposal_research_attempt_events"));
  assert.ok(rows.some(({ commandTag, objectIdentityPattern }) => commandTag === "CREATE FUNCTION"
    && objectIdentityPattern === "public.complete_ai_content_proposal_research(pg_catalog.uuid,pg_catalog.uuid,pg_catalog.jsonb,pg_catalog.text,pg_catalog.jsonb,pg_catalog.text,pg_catalog.text)"));
  assert.ok(rows.some(({ commandTag, objectIdentityPattern }) => commandTag === "CREATE FUNCTION"
    && objectIdentityPattern === "public.select_ai_content_proposal(pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid)"));
  assert.ok(rows.some(({ commandTag, objectIdentityPattern }) => commandTag === "REVOKE"
    && objectIdentityPattern === "function:public.select_ai_content_proposal(uuid,uuid,uuid,uuid)|PUBLIC|ALL"));
  assert.ok(rows.some(({ commandTag, objectIdentityPattern }) => commandTag === "GRANT"
    && objectIdentityPattern === "function:public.select_ai_content_proposal(uuid,uuid,uuid,uuid)|content_application|EXECUTE"));
  assert.ok(rows.some(({ commandTag, objectIdentityPattern }) => commandTag === "REVOKE"
    && objectIdentityPattern === "function:public.complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)|PUBLIC|ALL"));
  assert.ok(rows.some(({ commandTag, objectIdentityPattern }) => commandTag === "GRANT"
    && objectIdentityPattern === "function:public.complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)|content_application|EXECUTE"));
  assert.ok(rows.some(({ commandTag, objectIdentityPattern }) => commandTag === "REVOKE"
    && objectIdentityPattern === "function:public.enforce_ai_content_proposal_research_completion_pair()|PUBLIC|ALL"));
  assert.equal(rows.some(({ commandTag, objectIdentityPattern }) => commandTag === "GRANT"
    && objectIdentityPattern.startsWith("function:public.enforce_ai_content_proposal_research_completion_pair()|")), false);
  assert.ok(rows.some(({ commandTag, objectIdentityPattern }) => commandTag === "REVOKE"
    && objectIdentityPattern === "table:public.ai_content_storage_cleanup_outbox|PUBLIC|ALL"));
  assert.doesNotThrow(() => migrationRunner.validateCutover075ExactDdlAllowlist(
    rows, migration, cutover075RoleNames,
  ));

  const replace = (predicate, replacement) => rows.map((row) => predicate(row) ? replacement(row) : row);
  assert.throws(
    () => migrationRunner.validateCutover075ExactDdlAllowlist(replace(
      (row) => row.commandTag === "CREATE TABLE" && row.objectIdentityPattern === "public.ai_content_generation_operations",
      (row) => ({ ...row, objectIdentityPattern: "public.ai_content_%" }),
    ), migration, cutover075RoleNames),
    /cutover_075_exact_allowlist_rows_invalid/,
  );
  assert.throws(
    () => migrationRunner.validateCutover075ExactDdlAllowlist(replace(
      (row) => row.commandTag === "CREATE TABLE" && row.objectIdentityPattern === "public.ai_content_generation_operations",
      (row) => ({ ...row, objectIdentityPattern: "public.ai_content_generation_operation_" }),
    ), migration, cutover075RoleNames),
    /cutover_075_exact_allowlist_rows_invalid/,
  );
  assert.throws(
    () => migrationRunner.validateCutover075ExactDdlAllowlist([...rows, {
      commandTag: "CREATE TABLE", objectIdentityPattern: "public.aiXcontent_generation_operations",
    }], migration, cutover075RoleNames),
    /cutover_075_exact_allowlist_rows_invalid/,
  );
  assert.throws(
    () => migrationRunner.validateCutover075ExactDdlAllowlist(rows.slice(1), migration, cutover075RoleNames),
    /cutover_075_exact_allowlist_rows_invalid/,
  );
  const withExtraStatement = (statement) => {
    const sql = migration.sql.replace(/\ncommit;\s*$/i, `\n${statement};\ncommit;`);
    return { ...migration, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  };
  assert.throws(
    () => migrationRunner.buildCutover075ExactDdlAllowlist(withExtraStatement(
      `create table ${"a".repeat(55)} (${"b".repeat(20)} uuid unique)`,
    ), cutover075RoleNames),
    /cutover_075_implicit_index_name_requires_explicit_constraint/,
  );
  assert.throws(
    () => migrationRunner.buildCutover075ExactDdlAllowlist(withExtraStatement(
      "create unique index ai_content_generation_operations_pkey on ai_content_generation_operations(id)",
    ), cutover075RoleNames),
    /cutover_075_implicit_index_collision/,
  );
});

test("075 allowlist authorization and provider attestation are closed signed contracts", async () => {
  const migration = (await migrationRunner.loadMigrations())
    .find(({ id }) => id === "075_ai_content_three_format_cutover.sql");
  assert.ok(migration);
  const rows = migrationRunner.buildCutover075ExactDdlAllowlist(migration, cutover075RoleNames);
  const rowsSha256 = migrationRunner.hashCutoverDdlAllowlist(rows);
  assert.equal(migrationRunner.cutover075OwnerAuthorizationRows.length, 11);
  assert.ok(migrationRunner.cutover075OwnerAuthorizationRows
    .filter(({ commandTag }) => commandTag === "ALTER FUNCTION")
    .every(({ objectIdentityPattern }) => !/(?<!pg_catalog\.)\b(?:uuid|text|jsonb)\b/.test(objectIdentityPattern)
      && !/pg_catalog\.(?:integer|boolean)\b/.test(objectIdentityPattern)));
  const omittedOwnerRow = migrationRunner.cutover075OwnerAuthorizationRows[0];
  assert.throws(
    () => migrationRunner.validateCutover075OwnerAuthorizationRows(rows.filter((row) => !(
      row.commandTag === omittedOwnerRow.commandTag
      && row.objectIdentityPattern === omittedOwnerRow.objectIdentityPattern
    ))),
    /cutover_075_owner_authorization_rows_invalid/,
  );
  assert.throws(
    () => migrationRunner.validateCutover075OwnerAuthorizationRows([...rows, {
      commandTag: "ALTER FUNCTION", objectIdentityPattern: "public.transition_ai_content_generation_operation(pg_catalog.uuid,pg_catalog.text,pg_catalog.text)",
    }]),
    /cutover_075_owner_authorization_rows_invalid/,
  );
  const unsignedAuthorization = {
    contractVersion: "ai-content-075-ddl-allowlist-authorization.v1",
    requestId: "4c1758c0-633a-43cf-9a1b-6e1c9517d816",
    cutoverId: "7b7c8ed7-e046-4bcd-8592-38606f547493",
    migrationId: migration.id,
    migrationSha256: migration.checksum,
    rows,
    rowsSha256,
    enforcementCatalogSha256: "8".repeat(64),
    issuedAt: "2026-08-05T00:00:00.000Z",
    expiresAt: "2026-08-05T00:10:00.000Z",
  };
  const authorization = signCutoverAllowlistAuthorization(unsignedAuthorization);
  const requestSha256 = migrationRunner.hashCutoverAllowlistAuthorizationEnvelope(authorization);
  const emptyRowsSha256 = migrationRunner.hashCutoverDdlAllowlist([]);
  const attestation = signCutoverAllowlistAttestation({
    contractVersion: "ai-content-075-ddl-allowlist-attestation.v1",
    action: "install_verify_075_ddl_allowlist",
    requestId: authorization.requestId,
    requestSha256,
    cutoverId: authorization.cutoverId,
    migrationId: migration.id,
    migrationSha256: migration.checksum,
    rowsSha256,
    beforeCount: 0,
    beforeSha256: emptyRowsSha256,
    afterCount: rows.length,
    afterSha256: rowsSha256,
    issuedAt: "2026-08-05T00:00:01.000Z",
  });
  const context = {
    migration,
    cutoverId: authorization.cutoverId,
    enforcementCatalogSha256: authorization.enforcementCatalogSha256,
    authorizationVerification: authorizationIdentity.verification,
    providerAttestationVerification: providerIdentity.verification,
    roleNames: cutover075RoleNames,
    now: new Date("2026-08-05T00:02:00.000Z"),
  };

  const validatedAuthorization = migrationRunner.validateCutoverAllowlistAuthorization(authorization, context);
  assert.deepEqual(validatedAuthorization.rows, rows);
  assert.equal(
    migrationRunner.validateCutoverAllowlistAttestation(attestation, {
      authorization: validatedAuthorization,
      providerAttestationVerification: providerIdentity.verification,
      now: context.now,
    }).requestSha256,
    requestSha256,
  );

  assert.throws(
    () => migrationRunner.validateCutoverAllowlistAuthorization(
      { ...authorization, rows: rows.toReversed() },
      context,
    ),
    /cutover_075_allowlist_(?:signature|rows)_invalid/,
  );
  assert.throws(
    () => migrationRunner.validateCutoverAllowlistAuthorization(
      signCutoverAllowlistAuthorization({ ...unsignedAuthorization, expiresAt: "2026-08-05T00:01:00.000Z" }),
      context,
    ),
    /cutover_075_allowlist_authorization_expired/,
  );
  assert.throws(
    () => migrationRunner.validateCutoverAllowlistAttestation(
      { ...attestation, afterCount: 1 },
      { authorization, providerAttestationVerification: providerIdentity.verification, now: context.now },
    ),
    /cutover_075_allowlist_attestation_signature_invalid/,
  );
  assert.throws(
    () => {
      const { signature: _signature, ...attestationPayload } = attestation;
      return migrationRunner.validateCutoverAllowlistAttestation(
        signCutoverAllowlistAttestation({ ...attestationPayload, requestId: "reused-request" }),
        { authorization, providerAttestationVerification: providerIdentity.verification, now: context.now },
      );
    },
    /cutover_075_allowlist_attestation_requestId_mismatch/,
  );
});

test("075 atomic execution rejects an unsealed direct caller before transaction mutation", async () => {
  const migration = { id: "075_ai_content_three_format_cutover.sql", checksum: "7".repeat(64), sql: "select cutover_body" };
  const calls = [];
  const client = { async query(sql) { calls.push(String(sql)); return { rows: [] }; } };
  await assert.rejects(
    migrationRunner.executeAtomicCutoverMigration({ client, migration, cutover: {
      cutoverId: "7b7c8ed7-e046-4bcd-8592-38606f547493", bypassToken: "never-log-this-token",
      expectedDatabaseRole: "content_migration", schemaOwnerRoleName: "content_schema_owner",
      allowlistAuthorization: { migrationId: migration.id, migrationSha256: migration.checksum,
        cutoverId: "7b7c8ed7-e046-4bcd-8592-38606f547493" },
      allowlistRowsSha256: "8".repeat(64), allowlistAuthorizationSha256: "a".repeat(64),
      allowlistAttestationSha256: "b".repeat(64), enforcementCatalogSha256: "c".repeat(64),
      provider074AttestationSha256: "d".repeat(64),
    } }),
    /cutover_075_config_invalid/,
  );
  assert.equal(calls.some((sql) => sql.includes("select cutover_body")), false);
  assert.equal(calls.length, 0);
});

test("075 migration body evidence seals the exact post-075 protected object catalog", () => {
  const migration = {
    id: "075_ai_content_three_format_cutover.sql",
    checksum: "7".repeat(64),
  };
  const cutover = {
    cutoverId: "7b7c8ed7-e046-4bcd-8592-38606f547493",
    expectedDatabaseRole: "content_migration",
    schemaOwnerRoleName: "content_schema_owner",
    allowlistRowsSha256: "1".repeat(64),
    allowlistAuthorizationSha256: "2".repeat(64),
    allowlistAttestationSha256: "3".repeat(64),
    enforcementCatalogSha256: "4".repeat(64),
    enforcementStableCoreSha256: "b".repeat(64),
    provider074AttestationSha256: "5".repeat(64),
    post075CatalogSha256: "6".repeat(64),
    post075BootstrapObjectCatalogSha256: "8".repeat(64),
    proposalPreflightIdentity: { contract: "sealed" },
    proposalPreflightIdentitySha256: "9".repeat(64),
    proposalPreflightTransferSha256: "a".repeat(64),
  };
  const sealed = migrationRunner.buildCutoverBodyEvidence(migration, cutover);
  assert.deepEqual(Object.keys(sealed.evidence), [
    "contractVersion", "cutoverId", "migrationId", "migrationSha256", "databaseRoleName",
    "schemaOwnerRoleName", "allowlistRowsSha256", "allowlistAuthorizationSha256",
    "allowlistAttestationSha256", "enforcementCatalogSha256", "enforcementStableCoreSha256",
    "provider074AttestationSha256",
    "post075CatalogSha256", "post075BootstrapObjectCatalogSha256", "proposalPreflightIdentity",
    "proposalPreflightIdentitySha256", "proposalPreflightTransferSha256",
  ]);
  assert.equal(sealed.evidence.contractVersion, "ai-content-075-migration-body-evidence.v3");
  assert.equal(sealed.evidence.enforcementStableCoreSha256, "b".repeat(64));
  assert.equal(sealed.evidence.post075BootstrapObjectCatalogSha256, "8".repeat(64));
  assert.match(sealed.evidenceSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    migrationRunner.validateCutoverBodyEvidence(sealed.evidence, sealed.evidenceSha256, migration, cutover),
    sealed,
  );
  const { post075BootstrapObjectCatalogSha256: _missing, ...missing } = sealed.evidence;
  assert.throws(
    () => migrationRunner.validateCutoverBodyEvidence(missing, sealed.evidenceSha256, migration, cutover),
    /cutover_075_body_evidence_invalid/,
  );
  assert.throws(
    () => migrationRunner.validateCutoverBodyEvidence(
      { ...sealed.evidence, unexpected: true }, sealed.evidenceSha256, migration, cutover,
    ),
    /cutover_075_body_evidence_invalid/,
  );
  assert.throws(
    () => migrationRunner.validateCutoverBodyEvidence(
      { ...sealed.evidence, post075BootstrapObjectCatalogSha256: "b".repeat(64) },
      sealed.evidenceSha256, migration, cutover,
    ),
    /cutover_075_body_evidence_invalid/,
  );
  assert.throws(
    () => migrationRunner.validateCutoverBodyEvidence(
      sealed.evidence, "b".repeat(64), migration, cutover,
    ),
    /cutover_075_body_evidence_invalid/,
  );
  assert.deepEqual(migrationRunner.validatePersistedCutoverBodyEvidenceRows([{
    evidence_sha256: sealed.evidenceSha256,
    post_075_bootstrap_object_catalog_sha256: "8".repeat(64),
    event_sha256: "c".repeat(64),
  }]), {
    evidenceSha256: sealed.evidenceSha256,
    post075BootstrapObjectCatalogSha256: "8".repeat(64),
    statusEventSha256: "c".repeat(64),
  });
  for (const rows of [[], [{
    evidence_sha256: sealed.evidenceSha256,
    post_075_bootstrap_object_catalog_sha256: null,
    event_sha256: "c".repeat(64),
  }], [{
    evidence_sha256: "not-a-hash",
    post_075_bootstrap_object_catalog_sha256: "8".repeat(64),
    event_sha256: "c".repeat(64),
  }], [{
    evidence_sha256: sealed.evidenceSha256,
    post_075_bootstrap_object_catalog_sha256: "8".repeat(64),
    event_sha256: null,
  }]]) {
    assert.throws(
      () => migrationRunner.validatePersistedCutoverBodyEvidenceRows(rows),
      /cutover_075_recovery_body_evidence_missing/,
    );
  }
});

test("075 recovery reads sealed body evidence only through the provider-owned accessor", async () => {
  const sql = await readFile("db/migrations/074_ai_content_maintenance_write_fence.sql", "utf8");
  const runner = await readFile("scripts/migrationRunner.mjs", "utf8");
  const postgresHarness = await readFile("scripts/ai-content-074.postgres.integration.test.mjs", "utf8");
  const identity = "public.read_ai_content_cutover_migration_body_evidence(uuid)";
  assert.ok(migrationRunner.providerEnforcementBundle.functions.includes(identity));
  assert.match(
    sql,
    /create function read_ai_content_cutover_migration_body_evidence\(p_cutover_id uuid\)[\s\S]*returns table\s*\(\s*evidence_sha256 text,\s*post_075_bootstrap_object_catalog_sha256 text,\s*event_sha256 text\s*\)[\s\S]*security definer set search_path=pg_catalog,public/i,
  );
  assert.match(sql, /session_user<>bootstrap\.migration_role_name::text/i);
  assert.match(sql, /current_setting\('role',true\)[\s\S]*ai_content_cutover_migration_body_evidence_role_invalid/i);
  assert.match(sql, /app\.ai_content_cutover_id[\s\S]*app\.ai_content_cutover_token[\s\S]*app\.ai_content_migration_id/i);
  assert.match(sql, /verify_ai_content_cutover_status_chain_locked\(cutover_row\)/i);
  assert.match(sql, /latest_status_event_sha256[\s\S]*migration_body_complete/i);
  assert.match(
    runner,
    /select \* from public\.read_ai_content_cutover_migration_body_evidence\(\$1\)/i,
  );
  const readerStart = runner.indexOf("async function readPersistedCutoverBodyEvidence");
  const readerEnd = runner.indexOf("export async function recoverAtomicCutoverMigration", readerStart);
  assert.doesNotMatch(runner.slice(readerStart, readerEnd), /from public\.ai_content_cutover_status_events/i);
  assert.match(
    postgresHarness,
    /content_schema_owner", "content_application", "content_operator", "content_cleanup"[\s\S]*permission denied for function read_ai_content_cutover_migration_body_evidence/i,
  );
});

test("075 atomic source verifies and binds the shared exact post catalog before marker, transition and commit", async () => {
  const source = await readFile("scripts/migrationRunner.mjs", "utf8");
  const begin = source.indexOf('await client.query("begin")', source.indexOf("export async function executeAtomicCutoverMigration"));
  const revalidate = source.indexOf("revalidateAtomicCutoverDatabaseState", begin);
  const role = source.indexOf("set local role", revalidate);
  const body = source.indexOf("unwrapFileTransaction(migration.sql)", role);
  const resetRole = source.indexOf('await client.query("reset role")', body);
  const postRevalidate = source.indexOf("cutover075Applied: true", resetRole);
  const evidence = source.indexOf("buildCutoverBodyEvidence", resetRole);
  const marker = source.indexOf("insert into schema_migrations", evidence);
  const transition = source.indexOf("transition_ai_content_cutover_status", marker);
  const commit = source.indexOf('await client.query("commit")', transition);
  assert.ok(begin < revalidate && revalidate < role && role < body && body < resetRole
    && resetRole < postRevalidate && postRevalidate < evidence && evidence < marker
    && marker < transition && transition < commit);
  assert.match(
    source.slice(source.indexOf("function buildCutoverBodyEvidence"), source.indexOf("const proposalPreflightIdentityKeys")),
    /post075CatalogSha256[\s\S]*post075BootstrapObjectCatalogSha256/,
  );
  const sql = await readFile("db/migrations/074_ai_content_maintenance_write_fence.sql", "utf8");
  assert.match(sql, /ai_content_cutover_status_events[\s\S]*post_075_bootstrap_object_catalog_sha256 text/i);
  assert.match(sql, /migration_body_complete[\s\S]*p_post_075_bootstrap_object_catalog_sha256/i);
  assert.match(sql, /post_075_bootstrap_object_catalog_sha256[\s\S]*is true\)/i);
  assert.match(
    source,
    /recovering075\s*\?\s*await readCanonicalBootstrapRoleCatalog[\s\S]*!recovering075[\s\S]*authorization\.objectCatalogSha256/i,
  );
  const recoveryStart = source.indexOf("export async function recoverAtomicCutoverMigration");
  const persistedEvidence = source.indexOf("readPersistedCutoverBodyEvidence", recoveryStart);
  const recoveryRevalidation = source.indexOf("revalidateAtomicCutoverDatabaseState", persistedEvidence);
  const livePostObjectComparison = source.indexOf(
    "cutover_075_recovery_post_bootstrap_object_catalog_mismatch",
    source.indexOf("async function revalidateAtomicCutoverDatabaseState"),
  );
  assert.ok(recoveryStart < persistedEvidence && persistedEvidence < recoveryRevalidation);
  assert.ok(livePostObjectComparison >= 0);
});

test("075 ACL blocker: migration identity has an authorized migration_body_complete transition path", async () => {
  const sql = await readFile("db/migrations/074_ai_content_maintenance_write_fence.sql", "utf8");
  const runner = await readFile("scripts/migrationRunner.mjs", "utf8");
  assert.match(
    sql,
    /session_user\s*=\s*bootstrap\.migration_role_name[\s\S]*maintenance_verified[\s\S]*migration_body_complete/i,
    "074 transition function must restrict the migration session to the one approved edge",
  );
  assert.match(
    runner,
    /grant execute on function transition_ai_content_cutover_status\([^;]+to \$\{migrationRole\}/i,
    "074 runner must grant only the guarded transition function to migration",
  );
  assert.ok(migrationRunner.providerEnforcementBundle.functions.includes(
    "public.transition_ai_content_cutover_status(uuid,text,text,text,text,uuid,timestamp with time zone,text,text)",
  ));
});

test("075 PostgreSQL harness uses the unmodified loaded migration and authentic post catalog", async () => {
  const source = await readFile(new URL("./migrationRunner.test.mjs", import.meta.url), "utf8");
  const harnessStart = source.lastIndexOf('test("075 PostgreSQL harness applies 074 ACLs');
  const harness = source.slice(harnessStart, source.indexOf('test("075 CLI config accepts', harnessStart));
  assert.match(harness, /Promise\.allSettled/);
  assert.match(harness, /AggregateError\(teardownFailures/);
  assert.match(harness, /finally\s*\{[\s\S]*container\.stop\(\)/);
  assert.match(harness, /migration075\s*=\s*migrations\.find\(\(\{\s*id\s*\}\)\s*=>\s*id\s*===\s*"075_ai_content_three_format_cutover\.sql"\)/);
  assert.match(harness, /buildCutover075ExactDdlAllowlist\(migration075,\s*names\)/);
  assert.doesNotMatch(harness, /synthetic075|withSyntheticPostCatalog|migration075\s*=\s*\{/);
  assert.doesNotMatch(harness, /migration075\.sql\.(?:slice|substring)|migration075\.sql\s*=/);
  assert.match(harness, /migration073a[\s\S]*bootstrap074PrerequisiteMode:\s*true[\s\S]*bootstrap074RestartRequired/);
  assert.match(harness, /alter role content_schema_owner set search_path=public,pg_catalog,pg_temp/);
  assert.match(harness, /alter role content_migration set search_path=public,pg_catalog,pg_temp/);
  assert.match(harness, /alter role content_application set search_path=pg_catalog,public,pg_temp/);
  assert.match(harness, /select id from schema_migrations where id>= \$1 order by id/);
  assert.match(harness, /post_075_bootstrap_object_catalog_sha256/);
  assert.match(harness, /set session_replication_role=replica[\s\S]*assert\.rejects[\s\S]*set session_replication_role=replica/i);
  assert.match(harness, /drop constraint ai_content_proposal_performance_audits_capture_check/);
  assert.match(harness, /drop index ai_content_proposal_research_attempt_events_started_uq[\s\S]*event_type='research_started' and research_attempt_id is not null/i);
  assert.match(harness, /create trigger task3i_topic_uploads_extra_trigger[\s\S]*drop trigger task3i_topic_uploads_extra_trigger/i);
  assert.match(harness, /grant update on table topic_uploads to public[\s\S]*revoke update on table topic_uploads from public/i);
  assert.match(
    harness,
    /drop trigger ai_content_proposal_performance_audits_immutable on ai_content_proposal_performance_audits[\s\S]*reject_ai_content_cutover_record_mutation\('task3n-inert'\)[\s\S]*drop trigger ai_content_proposal_performance_audits_immutable on ai_content_proposal_performance_audits[\s\S]*reject_ai_content_cutover_record_mutation\(\)/i,
  );
  assert.match(harness, /drop constraint ai_content_maintenance_state_pair_check[\s\S]*add constraint ai_content_maintenance_state_pair_check/i);
  assert.match(harness, /create rule task3o_topic_uploads_deny_update[\s\S]*do instead nothing[\s\S]*drop rule task3o_topic_uploads_deny_update/i);
  assert.match(harness, /for \(const relationName of \[[\s\S]*ai_content_create_idempotency_records[\s\S]*ai_content_proposal_performance_audits[\s\S]*alter table \$\{relationName\} enable row level security[\s\S]*alter table \$\{relationName\} disable row level security/i);
  assert.match(harness, /alter column client_request_id type text collate "C"[\s\S]*alter column client_request_id type text collate "default"/i);
  assert.match(harness, /ai_content_attachment_storage_path_guards set unlogged[\s\S]*ai_content_attachment_storage_path_guards set logged/i);
  assert.match(harness, /topic_uploads replica identity full[\s\S]*topic_uploads replica identity default/i);
  assert.match(harness, /internalGenerationFkTrigger[\s\S]*disable trigger[\s\S]*enable trigger/i);
  assert.match(harness, /internalCutoverFkTrigger[\s\S]*enable replica trigger[\s\S]*enable trigger/i);
  assert.match(harness, /alter role content_application set search_path=public[\s\S]*bootstrap_role_catalog_invalid/i);
  assert.match(harness, /alter role content_application in database[\s\S]*bootstrap_role_database_settings_invalid/i);
  assert.match(harness, /alter database[\s\S]*set search_path='public'[\s\S]*bootstrap_role_database_settings_invalid/i);
  assert.match(harness, /grant create on schema public to public[\s\S]*bootstrap_role_public_schema_acl_invalid/i);
  assert.match(harness, /alter schema public owner to content_schema_owner[\s\S]*bootstrap_role_database_boundary_invalid/i);
  assert.match(harness, /assertEventFunctionTamper[\s\S]*owner to content_schema_owner[\s\S]*grant execute[\s\S]*set search_path=public[\s\S]*security invoker[\s\S]*create or replace function public\.enforce_ai_content_ddl_allowlist/i);
  assert.match(harness, /pg_get_functiondef\('public\.reject_ai_content_analyzed_subject_snapshot_mutation\(\)'::regprocedure\)[\s\S]*create or replace function public\.reject_ai_content_analyzed_subject_snapshot_mutation\(\)[\s\S]*return new[\s\S]*originalAnalyzedSubjectSnapshotRejectDefinition/i);
  assert.match(harness, /pg_get_functiondef\('public\.revoke_ai_content_one_time_avatar_receipt\(uuid,text\)'::regprocedure\)[\s\S]*create or replace function public\.revoke_ai_content_one_time_avatar_receipt\([\s\S]*target_receipt_id uuid,target_reason text[\s\S]*return null[\s\S]*originalAvatarRevocationDefinition/i);
  assert.match(
    harness,
    /drop trigger ai_content_fence_content_topics_ad6255354fc4 on content_topics[\s\S]*create trigger ai_content_fence_content_topics_ad6255354fc4[\s\S]*when \(false\)[\s\S]*drop trigger ai_content_fence_content_topics_ad6255354fc4 on content_topics[\s\S]*create trigger ai_content_fence_content_topics_ad6255354fc4[\s\S]*enable always trigger[\s\S]*ai_content_fence_content_topics_ad6255354fc4/i,
  );
  assert.match(
    harness,
    /drop trigger ai_content_cutover_status_events_immutable on ai_content_cutover_status_events[\s\S]*create trigger ai_content_cutover_status_events_immutable[\s\S]*when \(false\)[\s\S]*drop trigger ai_content_cutover_status_events_immutable on ai_content_cutover_status_events[\s\S]*create trigger ai_content_cutover_status_events_immutable[\s\S]*enable trigger[\s\S]*ai_content_cutover_status_events_immutable/i,
  );
  assert.match(
    harness,
    /drop trigger ai_content_bootstrap_075_registration_must_clear on ai_content_bootstrap_state[\s\S]*create constraint trigger ai_content_bootstrap_075_registration_must_clear[\s\S]*deferrable initially deferred[\s\S]*when \(false\)[\s\S]*drop trigger ai_content_bootstrap_075_registration_must_clear on ai_content_bootstrap_state[\s\S]*create constraint trigger ai_content_bootstrap_075_registration_must_clear[\s\S]*deferrable initially deferred[\s\S]*enable trigger[\s\S]*ai_content_bootstrap_075_registration_must_clear/i,
  );
  assert.match(harness, /grant references\(status\) on table ai_content_generation_operations to content_application/i);
  assert.match(harness, /revoke references\(status\) on table ai_content_generation_operations from content_application/i);
  assert.match(harness, /has_column_privilege\('content_application','ai_content_generation_operations','status','REFERENCES'\)/i);
  assert.match(
    harness,
    /grant\s+select\s+on\s+table\s+schema_migrations\s+to\s+content_migration/i,
  );
  assert.match(
    harness,
    /grant\s+select\s*,\s*insert\s+on\s+table\s+schema_migrations\s+to\s+content_schema_owner/i,
  );
  assert.doesNotMatch(
    harness,
    /grant\s+(?:all|delete|insert|references|trigger|truncate|update)[^;]*on\s+table\s+schema_migrations\s+to\s+content_migration/i,
  );
  const consume074 = harness.indexOf("client: migrationClient, migrations, bootstrap074: bootstrap074Config");
  const begin075 = harness.indexOf('const cutoverId = "7b7c8ed7-e046-4bcd-8592-38606f547493"');
  assert.ok(consume074 >= 0 && consume074 < begin075);
  assert.match(harness.slice(consume074, begin075), /provider_evidence_consumed[\s\S]*attestation_consumed_at[\s\S]*cutover_075_config_required/);
  assert.match(harness, /const productionMigrations = migrations/);
});

test("075 PostgreSQL harness applies 074 ACLs and proves atomic rollback and recovery", { timeout: 600_000 }, async (t) => {
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  let container;
  let client;
  let migrationClient;
  let recoveryClient;
  try {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withUsername("postgres")
      .withPassword("postgres")
      .withDatabase("ai_content_075_harness")
      .withEnvironment("POSTGRES_INITDB_ARGS", "--locale=C")
      .start();
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    const result = await client.query(
      "select current_setting('server_version_num')::integer as version_num, to_regclass('public.workspaces') as workspaces",
    );
    assert.ok(result.rows[0].version_num >= 160000 && result.rows[0].version_num < 170000);
    assert.equal(result.rows[0].workspaces, null);
    const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
    await client.query("create extension pgcrypto");
    await client.query("create extension vector");
    await client.query(`
      create role content_schema_owner nologin;
      create role content_application login password 'application-secret';
      create role content_operator login password 'operator-secret';
      create role content_migration login noinherit password 'migration-secret';
      create role content_cleanup login password 'cleanup-secret';
      alter role content_schema_owner set search_path=public,pg_catalog,pg_temp;
      alter role content_application set search_path=pg_catalog,public,pg_temp;
      alter role content_operator set search_path=pg_catalog,public,pg_temp;
      alter role content_migration set search_path=public,pg_catalog,pg_temp;
      alter role content_cleanup set search_path=pg_catalog,public,pg_temp;
      grant content_schema_owner to content_migration with set true;
      grant content_schema_owner to content_migration with inherit false;
      grant content_schema_owner to content_migration with admin false;
      revoke all on schema public from public;
      grant usage,create on schema public to content_schema_owner;
      grant usage on schema public to content_application,content_operator,content_migration,content_cleanup;
    `);
    const migrations = await migrationRunner.loadMigrations();
    const migration073a = migrations.find(({ id }) => id === "073a_legacy_trigger_function_search_path.sql");
    const migration074 = migrations.find(({ id }) => id === "074_ai_content_maintenance_write_fence.sql");
    const migration075 = migrations.find(({ id }) => id === "075_ai_content_three_format_cutover.sql");
    assert.ok(migration073a && migration074 && migration075);
    const pre074Migrations = migrations.filter(({ id }) => id < migration073a.id);
    await migrationRunner.runMigrationsWithClient({ client, migrations: pre074Migrations });
    await client.query("grant select on table schema_migrations to content_migration");
    await client.query("grant select, insert on table schema_migrations to content_schema_owner");
    const migrationHistoryPrivileges = await client.query(`
      select privilege_type
        from information_schema.role_table_grants
       where table_schema='public'
         and table_name='schema_migrations'
         and grantee='content_migration'
       order by privilege_type
    `);
    assert.deepEqual(migrationHistoryPrivileges.rows, [{ privilege_type: "SELECT" }]);
    const migrationUri = new URL(container.getConnectionUri());
    migrationUri.username = "content_migration";
    migrationUri.password = "migration-secret";
    migrationClient = new Client({ connectionString: migrationUri.toString() });
    await migrationClient.connect();
    const prerequisite = await migrationRunner.runMigrationsWithClient({
      client,
      migrations,
      bootstrap074PrerequisiteMode: true,
      bootstrap074PrerequisiteProviderRoleName: "postgres",
    });
    assert.deepEqual(prerequisite.pending, [migration073a.id]);
    assert.equal(prerequisite.bootstrap074RestartRequired, true);
    assert.deepEqual((await client.query(
      "select id from schema_migrations where id>= $1 order by id",
      [migration073a.id],
    )).rows, [{ id: migration073a.id }]);
    for (const relationName of new Set([
      ...migrationRunner.bootstrapFenceRelations,
      ...sharedOwnerTransferSecurityCatalog.map(({ relationName }) => relationName),
    ])) {
      await client.query(`alter table public.${quote(relationName)} owner to content_schema_owner`);
    }
    for (const { relationName, privileges } of schemaOwnerCutoverRelationSecurityCatalog) {
      await client.query(`grant ${privileges.join(",")} on table public.${quote(relationName)} to content_schema_owner`);
    }
    for (const identity of applicationRuntimeFunctionOwnershipCatalog) {
      await client.query(`alter function ${identity} owner to content_schema_owner`);
    }
    const names = {
      schemaOwnerRoleName: "content_schema_owner", applicationRoleName: "content_application",
      operatorRoleName: "content_operator", migrationRoleName: "content_migration", cleanupRoleName: "content_cleanup",
    };
    const bootstrapCatalogs = await migrationRunner.readCanonicalBootstrapCatalogs(migrationClient, names);
    const assertRoleBoundaryTamper = async (applySql, restoreSql, expectedError) => {
      await client.query(applySql);
      await assert.rejects(
        migrationRunner.readCanonicalBootstrapCatalogs(migrationClient, names),
        expectedError,
      );
      await client.query(restoreSql);
    };
    await assertRoleBoundaryTamper(
      "alter role content_application set search_path=public",
      "alter role content_application set search_path=pg_catalog,public,pg_temp",
      /bootstrap_role_catalog_invalid/,
    );
    await assertRoleBoundaryTamper(
      `alter role content_application in database ${quote("ai_content_075_harness")} set statement_timeout='1s'`,
      `alter role content_application in database ${quote("ai_content_075_harness")} reset statement_timeout`,
      /bootstrap_role_database_settings_invalid/,
    );
    await assertRoleBoundaryTamper(
      `alter database ${quote("ai_content_075_harness")} set search_path='public'`,
      `alter database ${quote("ai_content_075_harness")} reset search_path`,
      /bootstrap_role_database_settings_invalid/,
    );
    await assertRoleBoundaryTamper(
      "grant create on schema public to public",
      "revoke create on schema public from public",
      /bootstrap_role_public_schema_acl_invalid/,
    );
    await assertRoleBoundaryTamper(
      "alter schema public owner to content_schema_owner",
      "alter schema public owner to pg_database_owner; grant usage,create on schema public to content_schema_owner",
      /bootstrap_role_database_boundary_invalid/,
    );
    const eventBaseline = await migrationRunner.readCanonicalEventTriggerCatalog(client);
    assert.equal(eventBaseline.count, 0);
    await client.query("begin");
    let eventFunctionSha256;
    try {
      await client.query("set local role content_schema_owner");
      await client.query("set local search_path=public,pg_catalog,pg_temp");
      assert.equal((await client.query("select current_setting('search_path') as search_path")).rows[0].search_path,
        "public, pg_catalog, pg_temp");
      assert.equal((await client.query("select current_schema() as schema_name")).rows[0].schema_name, "public");
      await client.query("create table ai_content_074_search_path_probe(id integer)");
      await client.query("drop table ai_content_074_search_path_probe");
      try {
        await client.query(migrationRunner.unwrapFileTransaction(migration074.sql));
      } catch (error) {
        t.diagnostic(JSON.stringify({
          code: error.code, position: error.position, internalPosition: error.internalPosition,
          where: error.where, schema: error.schema, table: error.table, routine: error.routine,
        }));
        throw error;
      }
      eventFunctionSha256 = (await client.query(
        "select encode(digest(pg_get_functiondef('public.enforce_ai_content_ddl_allowlist()'::regprocedure),'sha256'),'hex') as sha256",
      )).rows[0].sha256;
    } finally {
      await client.query("rollback");
    }
    const bootstrapIssued = new Date(Date.now()-60_000);
    const bootstrapAuthorizationBase = {
      contractVersion: "ai-content-bootstrap-role-authorization.v4", requestId: "bootstrap-074-harness",
      migrationId: migration074.id, migrationSha256: migration074.checksum,
      imageDigest: `sha256:${"2".repeat(64)}`, imageSourceLabel: "3".repeat(40),
      roleCatalogSha256: bootstrapCatalogs.roleCatalogSha256,
      objectCatalogSha256: bootstrapCatalogs.objectCatalogSha256,
      migrationRoleName: names.migrationRoleName, schemaOwnerRoleName: names.schemaOwnerRoleName,
      applicationRoleName: names.applicationRoleName, operatorRoleName: names.operatorRoleName,
      cleanupRoleName: names.cleanupRoleName, eventTriggerName: "ai_content_ddl_guard_074",
      eventTriggerFunction: "public.enforce_ai_content_ddl_allowlist",
      eventTriggerFunctionSha256: eventFunctionSha256, eventTriggerEvent: "ddl_command_end",
      eventTriggerOwner: "postgres", eventTriggerTags: migrationRunner.required074DdlGuardTags,
      eventTriggerDefinitionSha256: "0".repeat(64),
      eventTriggerCatalogBeforeSha256: eventBaseline.catalogSha256,
      eventTriggerCatalogBeforeCount: eventBaseline.count,
      issuedAt: bootstrapIssued.toISOString(), expiresAt: new Date(bootstrapIssued.getTime()+10*60_000).toISOString(),
    };
    bootstrapAuthorizationBase.eventTriggerDefinitionSha256 = migrationRunner.hashEventTriggerDefinition({
      ...bootstrapAuthorizationBase, eventTriggerEnabled: "enabled",
    });
    const bootstrapAuthorization = signAuthorization(bootstrapAuthorizationBase);
    const bootstrap074Stage = {
      authorization: bootstrapAuthorization,
      authorizationVerification: authorizationIdentity.verification,
      providerAttestationVerification: providerIdentity.verification,
      imageDigest: bootstrapAuthorization.imageDigest,
      imageSourceLabel: bootstrapAuthorization.imageSourceLabel,
    };
    const stageOne = await migrationRunner.runMigrationsWithClient({
      client: migrationClient,
      migrations,
      bootstrap074: bootstrap074Stage,
    });
    assert.deepEqual(stageOne.pending, [migration074.id]);
    assert.equal(stageOne.bootstrap074RestartRequired, true);
    assert.equal(stageOne.bootstrap074Stage, "provider_install_required");
    assert.equal(stageOne.cutover075Deferred, true);
    assert.equal((await client.query(
      "select to_regclass('public.ai_content_proposal_performance_audits') as relation",
    )).rows[0].relation, null);
    const providerInstallRequest = stageOne.providerInstallRequest;
    assert.equal(providerInstallRequest?.action, "install_verify_074_enforcement_bundle");
    const interimFence = {
      catalogSha256: providerInstallRequest.fenceSecurityCatalogSha256,
      canonicalJson: JSON.stringify(providerInstallRequest.interimFenceSecurityCatalog),
    };
    for (const identity of migrationRunner.providerEnforcementBundle.functions) {
      await client.query(`alter function ${identity} owner to postgres`);
      await client.query(`revoke all on function ${identity} from public,content_schema_owner,content_application,content_operator,content_migration,content_cleanup`);
      if (identity.includes("assert_ai_content_writable")) await client.query(`grant execute on function ${identity} to content_application`);
      if (/prepare_ai_content_cutover|set_ai_content_maintenance/.test(identity)) await client.query(`grant execute on function ${identity} to content_operator`);
      if (identity.includes("read_ai_content_cutover_control_state")) await client.query(`grant execute on function ${identity} to content_operator`);
      if (identity.includes("transition_ai_content_cutover_status")) await client.query(`grant execute on function ${identity} to content_operator,content_migration`);
      if (identity.includes("register_ai_content_075_fence_relations")) {
        await client.query(`grant execute on function ${identity} to content_migration,content_schema_owner`);
      }
      if (/ai_content_cutover_bypass_allowed|lock_ai_content_cutover_transaction_state|verify_ai_content_(?:cutover_preflight_identity|write_fence_catalog)|consume_ai_content_provider_attestation|read_ai_content_cutover_migration_body_evidence/.test(identity)) {
        await client.query(`grant execute on function ${identity} to content_migration`);
      }
    }
    for (const relation of migrationRunner.providerEnforcementBundle.controlRelations) {
      await client.query(`alter table public.${quote(relation)} owner to postgres`);
      await client.query(`revoke all on table public.${quote(relation)} from public,content_schema_owner,content_application,content_operator,content_migration,content_cleanup`);
      if (relation === "ai_content_cutovers") await client.query("grant references on table public.ai_content_cutovers to content_schema_owner");
      if (relation === "ai_content_maintenance_state") await client.query(`grant select on table public.${quote(relation)} to content_application`);
      if (["ai_content_bootstrap_state", "ai_content_ddl_allowlist", "ai_content_write_fence_catalog"].includes(relation)) {
        await client.query(`grant select on table public.${quote(relation)} to content_migration`);
      }
      if (relation === "ai_content_bootstrap_state") {
        await client.query(`grant select on table public.${quote(relation)} to content_schema_owner`);
      }
    }
    const liveRoles = await migrationRunner.readCanonicalBootstrapRoleCatalog(migrationClient, names);
    const finalFence = await migrationRunner.readFenceSecurityCatalog(client, names, { ownerRoleName: "postgres" });
    await client.query("create event trigger ai_content_ddl_guard_074 on ddl_command_end execute function public.enforce_ai_content_ddl_allowlist()");
    await client.query("alter event trigger ai_content_ddl_guard_074 enable");
    const liveEvents = await migrationRunner.readCanonicalEventTriggerCatalog(client);
    assert.equal(liveEvents.count, 1);
    const originalEventFunctionDefinition = (await client.query(
      "select pg_get_functiondef('public.enforce_ai_content_ddl_allowlist()'::regprocedure) as definition",
    )).rows[0].definition;
    const assertEventFunctionTamper = async (applySql, restoreSql) => {
      await client.query("alter event trigger ai_content_ddl_guard_074 disable");
      try {
        await client.query(applySql);
      } finally {
        await client.query("alter event trigger ai_content_ddl_guard_074 enable");
      }
      const attacked = await migrationRunner.readCanonicalEventTriggerCatalog(client);
      assert.notEqual(attacked.catalogSha256, liveEvents.catalogSha256);
      await client.query("alter event trigger ai_content_ddl_guard_074 disable");
      try {
        await client.query(restoreSql);
      } finally {
        await client.query("alter event trigger ai_content_ddl_guard_074 enable");
      }
      assert.equal((await migrationRunner.readCanonicalEventTriggerCatalog(client)).catalogSha256, liveEvents.catalogSha256);
    };
    await assertEventFunctionTamper(
      "alter function public.enforce_ai_content_ddl_allowlist() owner to content_schema_owner",
      "alter function public.enforce_ai_content_ddl_allowlist() owner to postgres",
    );
    await assertEventFunctionTamper(
      "grant execute on function public.enforce_ai_content_ddl_allowlist() to public",
      "revoke execute on function public.enforce_ai_content_ddl_allowlist() from public",
    );
    await assertEventFunctionTamper(
      "alter function public.enforce_ai_content_ddl_allowlist() set search_path=public",
      "alter function public.enforce_ai_content_ddl_allowlist() set search_path=pg_catalog,public",
    );
    await assertEventFunctionTamper(
      "alter function public.enforce_ai_content_ddl_allowlist() security invoker",
      "alter function public.enforce_ai_content_ddl_allowlist() security definer",
    );
    await assertEventFunctionTamper(
      `create or replace function public.enforce_ai_content_ddl_allowlist() returns event_trigger
        language plpgsql security definer set search_path=pg_catalog,public as $$ begin return; end; $$`,
      originalEventFunctionDefinition,
    );
    const restoredFence = await migrationRunner.readFenceSecurityCatalog(client, names, { ownerRoleName: "postgres" });
    if (restoredFence.catalogSha256 !== finalFence.catalogSha256) {
      const targetIdentity = "public.enforce_ai_content_ddl_allowlist()";
      t.diagnostic(JSON.stringify({
        expectedFenceSha256: finalFence.catalogSha256,
        actualFenceSha256: restoredFence.catalogSha256,
        expectedFunction: finalFence.functions.find((row) => row.identity === targetIdentity),
        actualFunction: restoredFence.functions.find((row) => row.identity === targetIdentity),
      }));
    }
    assert.equal(restoredFence.catalogSha256, finalFence.catalogSha256);
    assert.equal(finalFence.catalogSha256, providerInstallRequest.expectedFinalFenceSecurityCatalogSha256);
    const providerAttestation074 = signProviderAttestation({
      contractVersion: "ai-content-074-provider-attestation.v4",
      providerRequestSha256: providerInstallRequest.requestSha256,
      authorizationRequestId: bootstrapAuthorization.requestId,
      action: providerInstallRequest.action,
      eventTriggerName: bootstrapAuthorization.eventTriggerName,
      eventTriggerFunction: bootstrapAuthorization.eventTriggerFunction,
      eventTriggerFunctionSha256: bootstrapAuthorization.eventTriggerFunctionSha256,
      eventTriggerEvent: bootstrapAuthorization.eventTriggerEvent,
      eventTriggerTags: bootstrapAuthorization.eventTriggerTags,
      eventTriggerDefinitionSha256: bootstrapAuthorization.eventTriggerDefinitionSha256,
      eventTriggerOwner: "postgres", eventTriggerEnabled: "enabled",
      migrationId: migration074.id, migrationSha256: migration074.checksum,
      imageDigest: bootstrapAuthorization.imageDigest, imageSourceLabel: bootstrapAuthorization.imageSourceLabel,
      roleCatalogSha256: bootstrapCatalogs.roleCatalogSha256,
      objectCatalogSha256: bootstrapCatalogs.objectCatalogSha256,
      fenceSecurityCatalogSha256: interimFence.catalogSha256,
      finalFenceSecurityCatalogSha256: finalFence.catalogSha256,
      eventTriggerCatalogBeforeSha256: eventBaseline.catalogSha256,
      eventTriggerCatalogBeforeCount: eventBaseline.count,
      eventTriggerCatalogAfterSha256: liveEvents.catalogSha256,
      eventTriggerCatalogAfterCount: liveEvents.count,
      issuedAt: new Date(bootstrapIssued.getTime()+1_000).toISOString(),
    });
    const provider074Sha = migrationRunner.hashProviderAttestationEnvelope(providerAttestation074);
    const revocation074 = migrationRunner.buildMembershipRevocationRequest(
      bootstrapAuthorization, providerInstallRequest, provider074Sha,
    );
    await client.query(`update ai_content_bootstrap_state set
      final_fence_security_catalog_sha256=$1,event_trigger_catalog_after_sha256=$2,
      event_trigger_catalog_after_count=$3,provider_attestation_json=$4::jsonb,
      provider_attestation_sha256=$5,revocation_request_json=$6::jsonb,
      revocation_request_sha256=$7 where singleton`, [
      finalFence.catalogSha256, liveEvents.catalogSha256, liveEvents.count,
      JSON.stringify(providerAttestation074), provider074Sha, JSON.stringify(revocation074),
      migrationRunner.hashMembershipRevocationEnvelope(revocation074),
    ]);
    const bootstrap074Config = {
      authorization: bootstrapAuthorization,
      authorizationVerification: authorizationIdentity.verification,
      providerAttestation: providerAttestation074,
      providerAttestationVerification: providerIdentity.verification,
      imageDigest: bootstrapAuthorization.imageDigest,
      imageSourceLabel: bootstrapAuthorization.imageSourceLabel,
    };
    const consumed074 = await migrationRunner.runMigrationsWithClient({
      client: migrationClient, migrations, bootstrap074: bootstrap074Config,
    });
    assert.deepEqual(consumed074.pending, []);
    assert.equal(consumed074.bootstrap074RestartRequired, true);
    assert.equal(consumed074.bootstrap074Stage, "provider_evidence_consumed");
    assert.equal(consumed074.cutover075Deferred, true);
    assert.ok((await client.query(
      "select attestation_consumed_at from ai_content_bootstrap_state where singleton",
    )).rows[0]?.attestation_consumed_at);
    await assert.rejects(
      migrationRunner.runMigrationsWithClient({
        client: migrationClient, migrations, bootstrap074: bootstrap074Config,
      }),
      /cutover_075_config_required/,
    );
    assert.equal((await client.query(
      "select to_regclass('public.ai_content_proposal_performance_audits') as relation",
    )).rows[0].relation, null);
    const cutoverId = "7b7c8ed7-e046-4bcd-8592-38606f547493";
    const bypassToken = "harness-never-log-token";
    const tokenSha = createHash("sha256").update(bypassToken).digest("hex");
    const preparedPreflightIdentityValue = {
      preflightCandidateSha: "f".repeat(40), contentProposalWorkerImageDigest: `sha256:${"e".repeat(64)}`,
      proposalWorkerSourceSha: "f".repeat(40), proposalWorkerTreeSha: "d".repeat(40),
      proposalContractSourceSha256: "e".repeat(64), proposalSchemaSha256: "e".repeat(64),
      proposalCatalogSha256: "e".repeat(64), proposalModelId: "gpt-5.6-terra",
      proposalCommandDescriptorSha256: "e".repeat(64), migrationSha256: migration075.checksum,
    };
    const preparedPreflightIdentity = JSON.stringify(preparedPreflightIdentityValue);
    const preparedPreflightIdentitySha256 = createHash("sha256").update(JSON.stringify(
      Object.fromEntries(Object.entries(preparedPreflightIdentityValue).sort(([left], [right]) => left.localeCompare(right))),
    )).digest("hex");
    assert.equal(Object.keys(JSON.parse(preparedPreflightIdentity)).length, 10);
    await client.query("set session authorization content_operator");
    await client.query(`select prepare_ai_content_cutover($1,'content_schema_owner','content_application','content_operator',
      'content_migration','content_cleanup',$2,$2,$3,'backup',now(),$4,$4,$6::jsonb,$7,$4,$5,$4)`,
    [cutoverId, tokenSha, liveRoles.roleCatalogSha256, "e".repeat(64), "f".repeat(40),
      preparedPreflightIdentity, preparedPreflightIdentitySha256]);
    await client.query("select set_ai_content_maintenance($1,true)", [cutoverId]);
    await client.query("select transition_ai_content_cutover_status($1,'prepared','maintenance_verified',$2)", [cutoverId, "f".repeat(64)]);
    await client.query("reset session authorization");
    const preparedPreflight = (await client.query(
      `select proposal_preflight_identity_json,proposal_preflight_identity_sha256,
              proposal_preflight_transfer_sha256
         from ai_content_cutovers where id=$1`,
      [cutoverId],
    )).rows[0];
    const rows = migrationRunner.buildCutover075ExactDdlAllowlist(migration075, names);
    const issued = new Date(Date.now()-60_000);
    const authorization = signCutoverAllowlistAuthorization({
      contractVersion: "ai-content-075-ddl-allowlist-authorization.v1", requestId: "4c1758c0-633a-43cf-9a1b-6e1c9517d816",
      cutoverId, migrationId: migration075.id, migrationSha256: migration075.checksum, rows,
      rowsSha256: migrationRunner.hashCutoverDdlAllowlist(rows), enforcementCatalogSha256: finalFence.catalogSha256,
      issuedAt: issued.toISOString(), expiresAt: new Date(issued.getTime()+10*60_000).toISOString(),
    });
    const attestation = signCutoverAllowlistAttestation({
      contractVersion: "ai-content-075-ddl-allowlist-attestation.v1", action: "install_verify_075_ddl_allowlist",
      requestId: authorization.requestId, requestSha256: migrationRunner.hashCutoverAllowlistAuthorizationEnvelope(authorization),
      cutoverId, migrationId: migration075.id, migrationSha256: migration075.checksum,
      rowsSha256: authorization.rowsSha256, beforeCount: 0,
      beforeSha256: migrationRunner.hashCutoverDdlAllowlist([]), afterCount: rows.length,
      afterSha256: authorization.rowsSha256, issuedAt: new Date(issued.getTime()+1_000).toISOString(),
    });
    const records = new Map();
    const journal = {
      async read(id) { return records.get(id); },
      async prepare(id, value) { records.set(id, { state: "prepared", value }); },
      async commit(id, value) { records.set(id, { state: "committed", value }); },
    };
    const providerOptions = {
      client, migration: migration075, authorization, attestation,
      authorizationVerification: authorizationIdentity.verification,
      providerAttestationVerification: providerIdentity.verification, journal,
    };
    for (const row of rows) {
      await client.query("insert into ai_content_ddl_allowlist values($1,$2,$3)", [
        migration075.id, row.commandTag, row.objectIdentityPattern,
      ]);
    }
    await assert.rejects(migrationRunner.installCutover075AllowlistWithProvider(providerOptions), /direct_allowlist_insert_forbidden/);
    await client.query("delete from ai_content_ddl_allowlist");
    const journalValue = {
      contractVersion: "ai-content-075-provider-journal.v1",
      requestSha256: migrationRunner.hashCutoverAllowlistAuthorizationEnvelope(authorization),
      attestationSha256: migrationRunner.hashCutoverAllowlistAttestationEnvelope(attestation),
    };
    records.set(authorization.requestId, { state: "prepared", value: journalValue });
    await client.query(`insert into ai_content_ddl_allowlist values($1,'CREATE TABLE','public.rogue')`, [migration075.id]);
    await assert.rejects(migrationRunner.installCutover075AllowlistWithProvider(providerOptions), /partial_or_extra/);
    await client.query("delete from ai_content_ddl_allowlist");
    records.clear();
    await migrationRunner.installCutover075AllowlistWithProvider(providerOptions);

    const cutoverInput = {
      cutoverId, bypassToken, expectedDatabaseRole: "content_migration",
      allowlistAuthorization: authorization, allowlistAttestation: attestation,
      authorizationVerification: authorizationIdentity.verification,
      providerAttestationVerification: providerIdentity.verification,
      proposalPreflightIdentity: preparedPreflight.proposal_preflight_identity_json,
      proposalPreflightIdentitySha256: preparedPreflight.proposal_preflight_identity_sha256,
      proposalPreflightTransferSha256: preparedPreflight.proposal_preflight_transfer_sha256,
    };
    const productionMigrations = migrations;
    await client.query("create role content_rogue login");
    await client.query("grant content_schema_owner to content_rogue with set true");
    await client.query("grant content_schema_owner to content_rogue with inherit false");
    await client.query("grant content_schema_owner to content_rogue with admin false");
    await assert.rejects(
      migrationRunner.runMigrationsWithClient({ client: migrationClient, migrations: productionMigrations,
        bootstrap074: bootstrap074Config, cutover: cutoverInput }),
      /bootstrap_(?:role_catalog|074_live_catalog|074_live)_|cutover_075_live_role_catalog_mismatch/,
    );
    await client.query("revoke content_schema_owner from content_rogue");
    await client.query("drop role content_rogue");
    const failurePoints = [
      ["inner-lock", (sql) => sql.startsWith("select lock_ai_content_cutover_transaction_state")],
      ["body", (sql) => sql.includes("create table ai_content_generation_operations")],
      ["post-catalog", (sql) => sql.includes("cutover_075_security_functions_v1")],
      ["marker", (sql) => sql.startsWith("insert into schema_migrations")],
      ["transition", (sql) => sql.startsWith("select transition_ai_content_cutover_status")],
    ];
    for (const [label, matches] of failurePoints) {
      let injected = false;
      const failureClient = {
        async query(sql, parameters) {
          const normalized = String(sql).replace(/\s+/g, " ").trim();
          let result;
          try {
            result = await migrationClient.query(sql, parameters);
          } catch (error) {
            t.diagnostic(JSON.stringify({
              failurePoint: label, code: error.code, position: error.position,
              internalPosition: error.internalPosition, where: error.where,
              queryPrefix: normalized.slice(0, 160),
            }));
            throw error;
          }
          if (!injected && matches(normalized)) {
            injected = true;
            throw new Error(`injected-${label}`);
          }
          return result;
        },
      };
      await assert.rejects(
        migrationRunner.runMigrationsWithClient({ client: failureClient, migrations: productionMigrations,
          bootstrap074: bootstrap074Config, cutover: cutoverInput }),
        new RegExp(`injected-${label}`),
      );
      assert.equal(injected, true, label);
      assert.equal((await client.query("select to_regclass('public.ai_content_generation_operations') as relation")).rows[0].relation, null, label);
      assert.equal((await client.query("select exists(select 1 from schema_migrations where id=$1) as marker", [migration075.id])).rows[0].marker, false, label);
      assert.equal((await client.query("select status from ai_content_cutovers where id=$1", [cutoverId])).rows[0].status, "maintenance_verified", label);
    }

    const commitLossClient = {
      async query(sql, parameters) {
        const result = await migrationClient.query(sql, parameters);
        if (String(sql).trim().toLowerCase() === "commit") throw new Error("commit_response_lost");
        return result;
      },
    };
    await assert.rejects(
      migrationRunner.runMigrationsWithClient({ client: commitLossClient, migrations: productionMigrations,
        bootstrap074: bootstrap074Config, cutover: cutoverInput }),
      /commit_response_lost/,
    );
    assert.equal((await client.query("select exists(select 1 from schema_migrations where id=$1) as marker", [migration075.id])).rows[0].marker, true);
    assert.equal((await client.query("select status from ai_content_cutovers where id=$1", [cutoverId])).rows[0].status, "migration_body_complete");
    const sealedBodyEvent = (await client.query(
      `select post_075_bootstrap_object_catalog_sha256
         from ai_content_cutover_status_events
        where cutover_id=$1
          and from_status='maintenance_verified'
          and to_status='migration_body_complete'`,
      [cutoverId],
    )).rows[0];
    assert.match(sealedBodyEvent.post_075_bootstrap_object_catalog_sha256, /^[0-9a-f]{64}$/);
    await client.query("set session_replication_role=replica");
    try {
      await client.query(
        `update ai_content_cutover_status_events
            set post_075_bootstrap_object_catalog_sha256=$2
          where cutover_id=$1 and to_status='migration_body_complete'`,
        [cutoverId, "0".repeat(64)],
      );
    } finally {
      await client.query("set session_replication_role=origin");
    }
    await assert.rejects(
      migrationRunner.runMigrationsWithClient({ client: migrationClient, migrations: productionMigrations,
        bootstrap074: bootstrap074Config, cutover: cutoverInput }),
      /ai_content_cutover_status_chain_hash_invalid|cutover_075_recovery_post_bootstrap_object_catalog_mismatch/,
    );
    await client.query("set session_replication_role=replica");
    try {
      await client.query(
        `update ai_content_cutover_status_events
            set post_075_bootstrap_object_catalog_sha256=$2
          where cutover_id=$1 and to_status='migration_body_complete'`,
        [cutoverId, sealedBodyEvent.post_075_bootstrap_object_catalog_sha256],
      );
    } finally {
      await client.query("set session_replication_role=origin");
    }
    const mutatePostSchema = async (statements) => {
      await client.query("alter event trigger ai_content_ddl_guard_074 disable");
      try {
        for (const statement of statements) await client.query(statement);
      } finally {
        await client.query("alter event trigger ai_content_ddl_guard_074 enable");
      }
    };
    const assertPostSchemaTamperRejected = async ({ apply, restore, expectedError }) => {
      await mutatePostSchema(apply);
      await assert.rejects(
        migrationRunner.runMigrationsWithClient({ client: migrationClient, migrations: productionMigrations,
          bootstrap074: bootstrap074Config, cutover: cutoverInput }),
        expectedError,
      );
      await mutatePostSchema(restore);
    };
    await assertPostSchemaTamperRejected({
      apply: [
        "drop trigger ai_content_fence_content_topics_ad6255354fc4 on content_topics",
        `create trigger ai_content_fence_content_topics_ad6255354fc4
          before insert or update or delete on content_topics
          for each row when (false) execute function public.enforce_ai_content_write_fence()`,
        `alter table content_topics enable always trigger
          ai_content_fence_content_topics_ad6255354fc4`,
      ],
      restore: [
        "drop trigger ai_content_fence_content_topics_ad6255354fc4 on content_topics",
        `create trigger ai_content_fence_content_topics_ad6255354fc4
          before insert or update or delete on content_topics
          for each row execute function public.enforce_ai_content_write_fence()`,
        `alter table content_topics enable always trigger
          ai_content_fence_content_topics_ad6255354fc4`,
      ],
      expectedError: /ai_content_write_fence_catalog_mismatch|cutover_075_enforcement_catalog_mismatch/,
    });
    await assertPostSchemaTamperRejected({
      apply: [
        "drop trigger ai_content_cutover_status_events_immutable on ai_content_cutover_status_events",
        `create trigger ai_content_cutover_status_events_immutable
          before update or delete on ai_content_cutover_status_events
          for each row when (false) execute function public.forbid_ai_content_cutover_event_mutation()`,
        `alter table ai_content_cutover_status_events enable trigger
          ai_content_cutover_status_events_immutable`,
      ],
      restore: [
        "drop trigger ai_content_cutover_status_events_immutable on ai_content_cutover_status_events",
        `create trigger ai_content_cutover_status_events_immutable
          before update or delete on ai_content_cutover_status_events
          for each row execute function public.forbid_ai_content_cutover_event_mutation()`,
        `alter table ai_content_cutover_status_events enable trigger
          ai_content_cutover_status_events_immutable`,
      ],
      expectedError: /ai_content_write_fence_control_trigger_mismatch|cutover_075_enforcement_catalog_mismatch/,
    });
    await assertPostSchemaTamperRejected({
      apply: [
        "drop trigger ai_content_bootstrap_075_registration_must_clear on ai_content_bootstrap_state",
        `create constraint trigger ai_content_bootstrap_075_registration_must_clear
          after insert or update on ai_content_bootstrap_state
          deferrable initially deferred for each row when (false)
          execute function public.enforce_ai_content_075_registration_seal_cleared()`,
        `alter table ai_content_bootstrap_state enable trigger
          ai_content_bootstrap_075_registration_must_clear`,
      ],
      restore: [
        "drop trigger ai_content_bootstrap_075_registration_must_clear on ai_content_bootstrap_state",
        `create constraint trigger ai_content_bootstrap_075_registration_must_clear
          after insert or update on ai_content_bootstrap_state
          deferrable initially deferred for each row
          execute function public.enforce_ai_content_075_registration_seal_cleared()`,
        `alter table ai_content_bootstrap_state enable trigger
          ai_content_bootstrap_075_registration_must_clear`,
      ],
      expectedError: /ai_content_write_fence_control_trigger_mismatch|cutover_075_enforcement_catalog_mismatch/,
    });
    await assertPostSchemaTamperRejected({
      apply: ["grant update on table topic_uploads to public"],
      restore: ["revoke update on table topic_uploads from public"],
      expectedError: /cutover_075_recovery_post_bootstrap_object_catalog_mismatch/,
    });
    await assertPostSchemaTamperRejected({
      apply: [
        "drop trigger ai_content_proposal_performance_audits_immutable on ai_content_proposal_performance_audits",
        `create trigger ai_content_proposal_performance_audits_immutable
          before update or delete on ai_content_proposal_performance_audits
          for each row execute function public.reject_ai_content_cutover_record_mutation('task3n-inert')`,
      ],
      restore: [
        "drop trigger ai_content_proposal_performance_audits_immutable on ai_content_proposal_performance_audits",
        `create trigger ai_content_proposal_performance_audits_immutable
          before update or delete on ai_content_proposal_performance_audits
          for each row execute function public.reject_ai_content_cutover_record_mutation()`,
      ],
      expectedError: /cutover_075_post_trigger_catalog_mismatch/,
    });
    assert.equal((await client.query(
      "select has_column_privilege('content_application','ai_content_generation_operations','status','REFERENCES') as allowed",
    )).rows[0].allowed, false);
    await mutatePostSchema([
      "grant references(status) on table ai_content_generation_operations to content_application",
    ]);
    assert.equal((await client.query(
      "select has_column_privilege('content_application','ai_content_generation_operations','status','REFERENCES') as allowed",
    )).rows[0].allowed, true);
    await assert.rejects(
      client.query("select verify_ai_content_075_acl_final_catalog()"),
      /ai_content_075_acl_final_catalog_invalid/,
    );
    await assert.rejects(
      migrationRunner.runMigrationsWithClient({ client: migrationClient, migrations: productionMigrations,
        bootstrap074: bootstrap074Config, cutover: cutoverInput }),
      /cutover_075_recovery_(?:body_evidence|post_bootstrap_object_catalog)_mismatch|cutover_075_post_relation_catalog_mismatch/,
    );
    await mutatePostSchema([
      "revoke references(status) on table ai_content_generation_operations from content_application",
    ]);
    assert.equal((await client.query(
      "select has_column_privilege('content_application','ai_content_generation_operations','status','REFERENCES') as allowed",
    )).rows[0].allowed, false);
    await assertPostSchemaTamperRejected({
      apply: [`alter table ai_content_proposal_performance_audits
        drop constraint ai_content_proposal_performance_audits_capture_check`],
      restore: [`alter table ai_content_proposal_performance_audits
        add constraint ai_content_proposal_performance_audits_capture_check
        check (captured_to>=captured_from)`],
      expectedError: /cutover_075_recovery_body_evidence_mismatch/,
    });
    await assertPostSchemaTamperRejected({
      apply: [
        "drop index ai_content_proposal_research_attempt_events_started_uq",
        `create unique index ai_content_proposal_research_attempt_events_started_uq
           on ai_content_proposal_research_attempt_events(research_attempt_id)
          where event_type='research_started' and research_attempt_id is not null`,
      ],
      restore: [
        "drop index ai_content_proposal_research_attempt_events_started_uq",
        `create unique index ai_content_proposal_research_attempt_events_started_uq
           on ai_content_proposal_research_attempt_events(research_attempt_id)
          where event_type='research_started'`,
      ],
      expectedError: /cutover_075_recovery_body_evidence_mismatch/,
    });
    await assertPostSchemaTamperRejected({
      apply: [`create trigger task3i_topic_uploads_extra_trigger
        before update on topic_uploads for each row execute function set_updated_at()`],
      restore: ["drop trigger task3i_topic_uploads_extra_trigger on topic_uploads"],
      expectedError: /cutover_075_recovery_post_bootstrap_object_catalog_mismatch/,
    });
    await assertPostSchemaTamperRejected({
      apply: [
        "alter table ai_content_maintenance_state drop constraint ai_content_maintenance_state_pair_check",
      ],
      restore: [`alter table ai_content_maintenance_state
        add constraint ai_content_maintenance_state_pair_check check (
          (not enabled and cutover_id is null and enabled_at is null)
          or (enabled and cutover_id is not null and enabled_at is not null)
        )`],
      expectedError: /bootstrap_074_final_fence_security_catalog_mismatch|cutover_075_enforcement_catalog_mismatch/,
    });
    await assertPostSchemaTamperRejected({
      apply: [
        "create rule task3o_topic_uploads_deny_update as on update to topic_uploads do instead nothing",
      ],
      restore: ["drop rule task3o_topic_uploads_deny_update on topic_uploads"],
      expectedError: /ai_content_write_fence_relation_structure_mismatch/,
    });
    for (const relationName of [
      "ai_content_create_idempotency_records",
      "ai_content_proposal_performance_audits",
    ]) {
      await assertPostSchemaTamperRejected({
        apply: [`alter table ${relationName} enable row level security`],
        restore: [`alter table ${relationName} disable row level security`],
        expectedError: /ai_content_write_fence_relation_structure_mismatch/,
      });
    }
    await assertPostSchemaTamperRejected({
      apply: [`alter table ai_content_create_idempotency_records
        alter column client_request_id type text collate "C"`],
      restore: [`alter table ai_content_create_idempotency_records
        alter column client_request_id type text collate "default"`],
      expectedError: /cutover_075_recovery_post_bootstrap_object_catalog_mismatch/,
    });
    await assertPostSchemaTamperRejected({
      apply: ["alter table ai_content_attachment_storage_path_guards set unlogged"],
      restore: ["alter table ai_content_attachment_storage_path_guards set logged"],
      expectedError: /bootstrap_object_catalog_invalid:ai_content_attachment_storage_path_guards/,
    });
    await assertPostSchemaTamperRejected({
      apply: ["alter table topic_uploads replica identity full"],
      restore: ["alter table topic_uploads replica identity default"],
      expectedError: /ai_content_write_fence_relation_structure_mismatch/,
    });
    const internalGenerationFkTrigger = (await client.query(`
      select trigger.tgname
        from pg_trigger trigger
        join pg_constraint constraint_record on constraint_record.oid=trigger.tgconstraint
       where trigger.tgrelid='public.ai_content_generations'::regclass
         and trigger.tgisinternal and constraint_record.contype='f'
       order by trigger.tgname limit 1
    `)).rows[0]?.tgname;
    assert.ok(internalGenerationFkTrigger);
    await assertPostSchemaTamperRejected({
      apply: [`alter table ai_content_generations disable trigger ${quote(internalGenerationFkTrigger)}`],
      restore: [`alter table ai_content_generations enable trigger ${quote(internalGenerationFkTrigger)}`],
      expectedError: /bootstrap_object_catalog_invalid:ai_content_generations/,
    });
    const internalCutoverFkTrigger = (await client.query(`
      select trigger.tgname
        from pg_trigger trigger
        join pg_constraint constraint_record on constraint_record.oid=trigger.tgconstraint
       where trigger.tgrelid='public.ai_content_cutovers'::regclass
         and trigger.tgisinternal and constraint_record.contype='f'
       order by trigger.tgname limit 1
    `)).rows[0]?.tgname;
    assert.ok(internalCutoverFkTrigger);
    await assertPostSchemaTamperRejected({
      apply: [`alter table ai_content_cutovers enable replica trigger ${quote(internalCutoverFkTrigger)}`],
      restore: [`alter table ai_content_cutovers enable trigger ${quote(internalCutoverFkTrigger)}`],
      expectedError: /cutover_075_recovery_post_bootstrap_object_catalog_mismatch/,
    });
    const originalAnalyzedSubjectSnapshotRejectDefinition = (await client.query(
      "select pg_get_functiondef('public.reject_ai_content_analyzed_subject_snapshot_mutation()'::regprocedure) as definition",
    )).rows[0].definition;
    await assertPostSchemaTamperRejected({
      apply: [`create or replace function public.reject_ai_content_analyzed_subject_snapshot_mutation() returns trigger
        language plpgsql set search_path=pg_catalog,public,pg_temp as $$
        begin
          return new;
        end;
        $$`],
      restore: [originalAnalyzedSubjectSnapshotRejectDefinition],
      expectedError: /cutover_075_recovery_post_bootstrap_object_catalog_mismatch/,
    });
    const originalAvatarRevocationDefinition = (await client.query(
      "select pg_get_functiondef('public.revoke_ai_content_one_time_avatar_receipt(uuid,text)'::regprocedure) as definition",
    )).rows[0].definition;
    await assertPostSchemaTamperRejected({
      apply: [`create or replace function public.revoke_ai_content_one_time_avatar_receipt(
        target_receipt_id uuid,target_reason text)
        returns uuid language plpgsql as $$
        begin
          return null;
        end;
        $$`],
      restore: [originalAvatarRevocationDefinition],
      expectedError: /cutover_075_recovery_post_bootstrap_object_catalog_mismatch/,
    });
    await migrationClient.end();
    migrationClient = undefined;
    const recoveryPgClient = new Client({ connectionString: migrationUri.toString() });
    await recoveryPgClient.connect();
    recoveryClient = recoveryPgClient;
    const recovered = await migrationRunner.runMigrationsWithClient({ client: recoveryClient,
      migrations: productionMigrations, bootstrap074: bootstrap074Config, cutover: cutoverInput });
    assert.equal(recovered.cutover.status, "migration_body_complete");
    assert.equal((await client.query("select status from ai_content_cutovers where id=$1", [cutoverId])).rows[0].status, "migration_body_complete");
    await client.query("begin");
    let livePostCatalog;
    try {
      await client.query("set local search_path=public,pg_catalog,pg_temp");
      livePostCatalog = await migrationRunner.readCutover075PostCatalog(client, names, {
        ownerRoleName: "postgres", cutover075Migration: migration075,
      });
    } finally {
      await client.query("rollback");
    }
    assert.equal(livePostCatalog.relations.length, 13);
    assert.equal(livePostCatalog.functions.length, 37);
    assert.equal(livePostCatalog.triggers.length, 32);
    assert.equal(recovered.cutover.post075CatalogSha256, livePostCatalog.catalogSha256);
  } finally {
    const teardownFailures = [];
    try {
      const clientResults = await Promise.allSettled(
        [recoveryClient, migrationClient, client].filter(Boolean).map((activeClient) => activeClient.end()),
      );
      teardownFailures.push(...clientResults
        .filter(({ status }) => status === "rejected")
        .map(({ reason }) => reason));
    } finally {
      if (container) {
        try { await container.stop(); } catch (error) { teardownFailures.push(error); }
      }
    }
    if (teardownFailures.length > 0) throw new AggregateError(teardownFailures, "075_harness_teardown_failed");
  }
});

test("075 CLI config accepts only file-backed token and pinned public verification material", () => {
  const config = resolveMigrationRuntimeConfig({
    DATABASE_URL: "postgresql://content_migration:secret@localhost/postgres",
    AI_CONTENT_075_CUTOVER_ID: "7b7c8ed7-e046-4bcd-8592-38606f547493",
    AI_CONTENT_075_BYPASS_TOKEN_FILE: "C:/sealed/cutover-token",
    AI_CONTENT_075_EXPECTED_DATABASE_ROLE: "content_migration",
    AI_CONTENT_075_ALLOWLIST_AUTHORIZATION_FILE: "C:/sealed/075-authorization.json",
    AI_CONTENT_075_ALLOWLIST_ATTESTATION_FILE: "C:/sealed/075-attestation.json",
    AI_CONTENT_075_PREFLIGHT_EVIDENCE_FILE: "C:/sealed/075-preflight-evidence.json",
    AI_CONTENT_075_AUTHORIZATION_PUBLIC_KEY_FILE: "C:/sealed/authorization-public.pem",
    AI_CONTENT_075_AUTHORIZATION_KEY_ID: authorizationIdentity.keyId,
    AI_CONTENT_075_AUTHORIZATION_PUBLIC_KEY_SHA256: authorizationIdentity.publicKeySha256,
    AI_CONTENT_075_PROVIDER_ATTESTATION_PUBLIC_KEY_FILE: "C:/sealed/provider-public.pem",
    AI_CONTENT_075_PROVIDER_ATTESTATION_KEY_ID: providerIdentity.keyId,
    AI_CONTENT_075_PROVIDER_ATTESTATION_PUBLIC_KEY_SHA256: providerIdentity.publicKeySha256,
  }, ["node", "scripts/migrate.mjs"]);

  assert.equal(config.cutover075Files.bypassTokenFile, "C:/sealed/cutover-token");
  assert.equal(config.cutover075Files.preflightEvidenceFile, "C:/sealed/075-preflight-evidence.json");
  assert.equal("bypassToken" in config.cutover075Files, false);
  assert.throws(
    () => resolveMigrationRuntimeConfig({
      AI_CONTENT_075_CUTOVER_ID: "7b7c8ed7-e046-4bcd-8592-38606f547493",
      AI_CONTENT_075_BYPASS_TOKEN: "plaintext-forbidden",
    }),
    /private_key_input_forbidden|cutover_075_secret_input_forbidden/,
  );
});

test("075 secret and public files fail closed on symlink owner mode size and Windows ambiguity", () => {
  const regular = { isFile: () => true, isSymbolicLink: () => false, uid: 1000, mode: 0o100600, size: 64 };
  assert.doesNotThrow(() => validateSecureCutoverFileMetadata(regular, { platform: "linux", uid: 1000, maxBytes: 128 }));
  for (const metadata of [
    { ...regular, isFile: () => false },
    { ...regular, isSymbolicLink: () => true },
    { ...regular, uid: 1001 },
    { ...regular, mode: 0o100640 },
    { ...regular, size: 129 },
  ]) {
    assert.throws(
      () => validateSecureCutoverFileMetadata(metadata, { platform: "linux", uid: 1000, maxBytes: 128 }),
      /cutover_075_secure_file_invalid/,
    );
  }
  assert.throws(
    () => validateSecureCutoverFileMetadata(regular, { platform: "win32", uid: undefined, maxBytes: 128 }),
    /cutover_075_secure_file_platform_unsupported/,
  );
});

test("075 runner rejects a harness-only allowlist insert without signed provider attestation before body execution", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push(normalized);
      if (normalized === "select id, checksum from schema_migrations order by id asc") {
        return { rows: [{ id: "074_ai_content_maintenance_write_fence.sql", checksum: "6".repeat(64) }] };
      }
      if (normalized.includes("to_regclass('public.schema_migrations')")) {
        return { rows: [{ relation: "schema_migrations" }] };
      }
      if (normalized.includes("to_regclass('public.workspaces')")) return { rows: [{ relation: null }] };
      if (normalized.includes("bootstrap_role_catalog_v4")) {
        return { rows: [
          { role_name: "content_schema_owner", can_login: false, ...noProviderRoleCapabilities, inherit: true, config: publicFirstBootstrapRoleConfig },
          { role_name: "content_application", can_login: true, ...noProviderRoleCapabilities, inherit: true, config: safeBootstrapRoleConfig },
          { role_name: "content_operator", can_login: true, ...noProviderRoleCapabilities, inherit: true, config: safeBootstrapRoleConfig },
          { role_name: "content_migration", can_login: true, ...noProviderRoleCapabilities, inherit: false, config: publicFirstBootstrapRoleConfig },
          { role_name: "content_cleanup", can_login: true, ...noProviderRoleCapabilities, inherit: true, config: safeBootstrapRoleConfig },
        ] };
      }
      if (normalized.includes("bootstrap_role_membership_catalog_v2")) {
        return { rows: [{
          member_role_name: "content_migration", parent_role_name: "content_schema_owner",
          set_option: true, inherit_option: false, admin_option: false,
        }] };
      }
      if (normalized.includes("bootstrap_role_environment_catalog_v1")) {
        return { rows: [stableBootstrapRoleEnvironment()] };
      }
      return { rows: [] };
    },
  };
  await assert.rejects(
    migrationRunner.runMigrationsWithClient({
      client,
      migrations: [
        {
          id: "074_ai_content_maintenance_write_fence.sql",
          checksum: "6".repeat(64),
          sql: "select fence_body",
        },
        {
          id: "075_ai_content_three_format_cutover.sql",
          checksum: "7".repeat(64),
          sql: "select cutover_body",
        },
      ],
      bootstrap074: { authorization: prerequisiteRoleNames },
      cutover: {
        cutoverId: "7b7c8ed7-e046-4bcd-8592-38606f547493",
        bypassToken: "never-log-this-token",
        expectedDatabaseRole: "content_migration",
      },
    }),
    /cutover_075_allowlist_attestation_required/,
  );
  assert.equal(calls.includes("select cutover_body"), false);
  assert.equal(calls.includes("begin"), false);
});

test("075 provider journal uses exclusive durable files and rejects corrupt or linked records", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "ai-content-075-journal-"));
  const directory = path.join(temporaryRoot, "journal");
  await mkdir(directory);
  const requestId = "f7071995-0efc-4930-a6ac-9b29d5557460";
  const linkedRequestId = "f7071995-0efc-4930-a6ac-9b29d5557461";
  const corruptRequestId = "f7071995-0efc-4930-a6ac-9b29d5557462";
  const linkedFile = path.join(directory, `${linkedRequestId}.prepared.json`);
  const value = { contractVersion: "ai-content-075-provider-journal.v1", requestSha256: "a".repeat(64), attestationSha256: "b".repeat(64) };
  let fileSyncCount = 0;
  let directorySyncCount = 0;
  const filesystem = {
    lstat: async (target) => {
      const metadata = await lstat(target);
      if (target === linkedFile) return { isSymbolicLink: () => true };
      if (target === directory) return {
        isDirectory: () => true, isSymbolicLink: () => false, uid: 0, mode: 0o40700,
      };
      return metadata;
    },
    open: async (target, flags, mode) => {
      if (target === directory) return {
        sync: async () => { directorySyncCount += 1; }, close: async () => {},
      };
      const handle = await open(target, flags, mode);
      return {
        writeFile: (...args) => handle.writeFile(...args),
        readFile: (...args) => handle.readFile(...args),
        sync: async () => { fileSyncCount += 1; await handle.sync(); }, close: () => handle.close(),
        stat: async () => {
          const metadata = await handle.stat();
          return { isFile: () => metadata.isFile(), uid: 0, mode: 0o100600, size: metadata.size };
        },
      };
    },
    link, unlink,
  };
  try {
    const journal = migrationRunner.createCutover075ProviderJournal({ directory, platform: "linux", uid: 0, filesystem });
    await journal.prepare(requestId, value);
    assert.ok(fileSyncCount > 0, "journal record must be fsynced before publication");
    assert.ok(directorySyncCount > 0, "journal directory must be fsynced after publication");
    assert.deepEqual(await journal.read(requestId), { state: "prepared", value });
    assert.equal((await readdir(directory)).some((name) => name.endsWith(".tmp")), false);
    await assert.rejects(journal.prepare(requestId, value), (error) => error?.code === "EEXIST");
    await journal.commit(requestId, value);
    assert.deepEqual(await journal.read(requestId), { state: "committed", value });
    await journal.commit(requestId, value);
    await assert.rejects(journal.commit(requestId, { ...value, requestSha256: "c".repeat(64) }), /cutover_075_journal_reused/);

    await writeFile(linkedFile, `${JSON.stringify(value)}\n`, "utf8");
    await assert.rejects(journal.read(linkedRequestId), /cutover_075_secure_journal_record_invalid/);
    await writeFile(path.join(directory, `${corruptRequestId}.prepared.json`), "{", "utf8");
    await assert.rejects(journal.read(corruptRequestId), SyntaxError);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("075 provider action installs only a signed exact allowlist and replays committed response loss", async () => {
  const migration = (await migrationRunner.loadMigrations())
    .find(({ id }) => id === "075_ai_content_three_format_cutover.sql");
  assert.ok(migration);
  const rows = migrationRunner.buildCutover075ExactDdlAllowlist(migration, cutover075RoleNames);
  const unsignedAuthorization = {
    contractVersion: "ai-content-075-ddl-allowlist-authorization.v1",
    requestId: "4c1758c0-633a-43cf-9a1b-6e1c9517d816",
    cutoverId: "7b7c8ed7-e046-4bcd-8592-38606f547493",
    migrationId: migration.id,
    migrationSha256: migration.checksum,
    rows,
    rowsSha256: migrationRunner.hashCutoverDdlAllowlist(rows),
    enforcementCatalogSha256: "8".repeat(64),
    issuedAt: "2026-08-05T00:00:00.000Z",
    expiresAt: "2026-08-05T00:10:00.000Z",
  };
  const authorization = signCutoverAllowlistAuthorization(unsignedAuthorization);
  const attestation = signCutoverAllowlistAttestation({
    contractVersion: "ai-content-075-ddl-allowlist-attestation.v1",
    action: "install_verify_075_ddl_allowlist",
    requestId: authorization.requestId,
    requestSha256: migrationRunner.hashCutoverAllowlistAuthorizationEnvelope(authorization),
    cutoverId: authorization.cutoverId,
    migrationId: migration.id,
    migrationSha256: migration.checksum,
    rowsSha256: authorization.rowsSha256,
    beforeCount: 0,
    beforeSha256: migrationRunner.hashCutoverDdlAllowlist([]),
    afterCount: rows.length,
    afterSha256: authorization.rowsSha256,
    issuedAt: "2026-08-05T00:00:01.000Z",
  });
  let liveRows = [];
  let markerPresent = false;
  let providerIdentityAllowed = true;
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, parameters });
      if (normalized === "select session_user,current_user") {
        return { rows: [{ session_user: "postgres", current_user: providerIdentityAllowed ? "postgres" : "content_operator" }] };
      }
      if (normalized.includes("provider_075_sealed_state_v1")) return { rows: [{
         final_fence_security_catalog_sha256: "8".repeat(64),
        schema_owner_role_name: cutover075RoleNames.schemaOwnerRoleName,
        application_role_name: cutover075RoleNames.applicationRoleName,
        operator_role_name: cutover075RoleNames.operatorRoleName,
        migration_role_name: cutover075RoleNames.migrationRoleName,
        cleanup_role_name: cutover075RoleNames.cleanupRoleName,
        cutover_status: "maintenance_verified",
        cutover_migration_id: migration.id,
        marker_present: markerPresent,
      }] };
      if (normalized.startsWith("select command_tag,object_identity_pattern")) {
        return { rows: liveRows.map((row) => ({ command_tag: row.commandTag, object_identity_pattern: row.objectIdentityPattern })) };
      }
      if (normalized.startsWith("insert into public.ai_content_ddl_allowlist")) {
        liveRows = rows.map((row) => ({ ...row }));
        return { rows: [], rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const records = new Map();
  const journal = {
    async read(requestId) { return records.get(requestId); },
    async prepare(requestId, value) {
      if (records.has(requestId)) throw new Error("journal_exists");
      records.set(requestId, { state: "prepared", value });
    },
    async commit(requestId, value) { records.set(requestId, { state: "committed", value }); },
  };
  const options = {
    client, migration, authorization, attestation,
    authorizationVerification: authorizationIdentity.verification,
    providerAttestationVerification: providerIdentity.verification,
    now: new Date("2026-08-05T00:02:00.000Z"), journal,
  };

  const installed = await migrationRunner.installCutover075AllowlistWithProvider(options);
  assert.equal(installed.requestSha256, attestation.requestSha256);
  assert.deepEqual(liveRows, rows);
  assert.equal(records.get(authorization.requestId).state, "committed");
  assert.ok(calls.some(({ sql }) => sql === "lock table public.ai_content_ddl_allowlist in access exclusive mode"));

  const inserts = calls.filter(({ sql }) => sql.startsWith("insert into public.ai_content_ddl_allowlist")).length;
  const replay = await migrationRunner.installCutover075AllowlistWithProvider(options);
  assert.deepEqual(replay, installed);
  assert.equal(calls.filter(({ sql }) => sql.startsWith("insert into public.ai_content_ddl_allowlist")).length, inserts);

  markerPresent = true;
  await assert.rejects(
    migrationRunner.installCutover075AllowlistWithProvider(options),
    /cutover_075_provider_state_invalid/,
  );
  markerPresent = false;

  records.clear();
  await assert.rejects(
    migrationRunner.installCutover075AllowlistWithProvider(options),
    /cutover_075_direct_allowlist_insert_forbidden/,
  );

  records.set(authorization.requestId, { state: "prepared", value: {
    contractVersion: "ai-content-075-provider-journal.v1",
    requestSha256: migrationRunner.hashCutoverAllowlistAuthorizationEnvelope(authorization),
    attestationSha256: migrationRunner.hashCutoverAllowlistAttestationEnvelope(attestation),
  } });
  liveRows = [...rows, { commandTag: "CREATE TABLE", objectIdentityPattern: "public.rogue" }];
  await assert.rejects(
    migrationRunner.installCutover075AllowlistWithProvider(options),
    /cutover_075_provider_allowlist_partial_or_extra/,
  );

  records.set(authorization.requestId, { state: "prepared", value: { reused: true } });
  liveRows = rows;
  await assert.rejects(
    migrationRunner.installCutover075AllowlistWithProvider(options),
    /cutover_075_journal_reused/,
  );

  providerIdentityAllowed = false;
  await assert.rejects(
    migrationRunner.installCutover075AllowlistWithProvider(options),
    /cutover_075_provider_identity_invalid/,
  );
  providerIdentityAllowed = true;

  const journalValue = {
    contractVersion: "ai-content-075-provider-journal.v1",
    requestSha256: migrationRunner.hashCutoverAllowlistAuthorizationEnvelope(authorization),
    attestationSha256: migrationRunner.hashCutoverAllowlistAttestationEnvelope(attestation),
  };
  records.set(authorization.requestId, { state: "committed", value: journalValue });
  liveRows = [];
  await assert.rejects(
    migrationRunner.installCutover075AllowlistWithProvider(options),
    /cutover_075_committed_journal_live_state_invalid/,
  );

  const mismatchedBeforeAttestation = signCutoverAllowlistAttestation({
    ...Object.fromEntries(Object.entries(attestation).filter(([key]) => !["signature", "algorithm", "keyId"].includes(key))),
    beforeCount: rows.length,
    beforeSha256: authorization.rowsSha256,
  });
  records.clear();
  await assert.rejects(
    migrationRunner.installCutover075AllowlistWithProvider({ ...options, attestation: mismatchedBeforeAttestation }),
    /cutover_075_allowlist_attestation_before_live_mismatch/,
  );
});

test("074 canonical live role and object catalog hashes are order-independent and drift-sensitive", () => {
  const roles = [
    { role_name: "content_schema_owner", can_login: false, ...noProviderRoleCapabilities, inherit: true, config: publicFirstBootstrapRoleConfig },
    { role_name: "content_migration", can_login: true, ...noProviderRoleCapabilities, inherit: false, config: publicFirstBootstrapRoleConfig },
    { role_name: "content_application", can_login: true, ...noProviderRoleCapabilities, inherit: true, config: safeBootstrapRoleConfig },
    { role_name: "content_operator", can_login: true, ...noProviderRoleCapabilities, inherit: true, config: safeBootstrapRoleConfig },
    { role_name: "content_cleanup", can_login: true, ...noProviderRoleCapabilities, inherit: true, config: safeBootstrapRoleConfig },
  ];
  const membershipEdges = [{
    member_role_name: "content_migration", parent_role_name: "content_schema_owner",
    set_option: true, inherit_option: false, admin_option: false,
  }];
  const objects = [
    { schema_name: "public", relation_name: "ai_content_generations", relation_kind: "r",
      relation_persistence: "p", replica_identity: "d", is_partition: false, partition_bound: null,
      inheritance_parents: [], internal_constraint_triggers: [{
        constraint_identity: "public.ai_content_generations.ai_content_generations_brand_id_fkey",
        trigger_name: "RI_ConstraintTrigger_c_fixture", trigger_type: 5, enabled: "O",
        deferrable: false, initially_deferred: false,
        function_identity: "pg_catalog.RI_FKey_check_ins()",
        definition: "CREATE CONSTRAINT TRIGGER fixture AFTER INSERT ON public.ai_content_generations FOR EACH ROW EXECUTE FUNCTION pg_catalog.\"RI_FKey_check_ins\"()",
      }], owner_role_name: "content_schema_owner",
      row_security: false, force_row_security: false,
      acl: [{ grantee: "content_schema_owner", privilege: "SELECT", grantable: false }], columns: [
      { ordinal_position: 2, column_name: "brand_id", type_identity: "uuid", not_null: true,
        default_definition: null, identity_kind: "", generated_kind: "", collation_identity: null, acl: [] },
      { ordinal_position: 1, column_name: "id", type_identity: "uuid", not_null: true,
        default_definition: "gen_random_uuid()", identity_kind: "", generated_kind: "", collation_identity: null, acl: [] },
    ], constraints: [{ constraint_name: "ai_content_generations_pkey", constraint_type: "p",
      definition: "PRIMARY KEY (id)", validated: true, deferrable: false, initially_deferred: false }],
    indexes: [{ index_name: "ai_content_generations_pkey",
      definition: "CREATE UNIQUE INDEX ai_content_generations_pkey ON public.ai_content_generations USING btree (id)",
      primary: true, unique: true, valid: true, ready: true, live: true }],
    triggers: [{ trigger_name: "preexisting_generation_trigger",
      definition: "CREATE TRIGGER preexisting_generation_trigger BEFORE UPDATE ON public.ai_content_generations FOR EACH ROW EXECUTE FUNCTION set_updated_at()",
      enabled: "O", deferrable: false, initially_deferred: false,
      function_identity: "public.set_updated_at()",
      function_catalog: stableTriggerFunctionCatalog() }, {
      trigger_name: "ai_content_generation_attachments_revoke_one_time_avatar",
      definition: "CREATE TRIGGER ai_content_generation_attachments_revoke_one_time_avatar AFTER INSERT OR DELETE OR UPDATE ON public.ai_content_generations FOR EACH ROW EXECUTE FUNCTION revoke_ai_content_one_time_avatar_on_attachment_unavailable()",
      enabled: "O", deferrable: false, initially_deferred: false,
      function_identity: "public.revoke_ai_content_one_time_avatar_on_attachment_unavailable()",
      function_catalog: stableTriggerFunctionCatalog(
        "public.revoke_ai_content_one_time_avatar_on_attachment_unavailable()",
        { dependency_functions: [stableTriggerFunctionCatalog(
          "public.revoke_ai_content_one_time_avatar_receipt(uuid,text)",
          { return_type_identity: "pg_catalog.uuid", dependency_functions: undefined },
        )] },
      ) }], rules: [], policies: [] },
    { schema_name: "public", relation_name: "topic_rows", relation_kind: "r",
      relation_persistence: "p", replica_identity: "d", is_partition: false, partition_bound: null,
      inheritance_parents: [], internal_constraint_triggers: [], owner_role_name: "content_schema_owner",
      row_security: false, force_row_security: false,
      acl: [{ grantee: "content_schema_owner", privilege: "SELECT", grantable: false }], columns: [
      { ordinal_position: 1, column_name: "id", type_identity: "uuid", not_null: true,
        default_definition: null, identity_kind: "", generated_kind: "", collation_identity: null, acl: [] },
    ], constraints: [], indexes: [], triggers: [], rules: [], policies: [] },
  ];

  const roleHash = migrationRunner.hashBootstrapRoleCatalog(stableBootstrapRoleCatalog(roles, membershipEdges));
  assert.equal(
    JSON.parse(migrationRunner.canonicalBootstrapRoleCatalog(stableBootstrapRoleCatalog(roles, membershipEdges))).contractVersion,
    "ai-content-bootstrap-role-catalog.v5",
  );
  const objectHash = migrationRunner.hashBootstrapObjectCatalog(objects);
  assert.equal(
    JSON.parse(migrationRunner.canonicalBootstrapObjectCatalog(objects)).contractVersion,
    "ai-content-bootstrap-object-catalog.v7",
  );
  for (const [field, value] of Object.entries({
    identity: "public.rogue_trigger_function()",
    source_sha256: "3".repeat(64),
    owner_role_name: "content_application",
    security_definer: true,
    language_name: "sql",
    function_kind: "p",
    volatility: "s",
    parallel_safety: "s",
    leakproof: true,
    strict: true,
    return_set: true,
    return_type_identity: "pg_catalog.void",
    config: ["search_path=public"],
    acl: [],
  })) {
    const attacked = structuredClone(objects);
    attacked[0].triggers[0].function_catalog[field] = value;
    assert.notEqual(
      migrationRunner.hashBootstrapObjectCatalog(attacked),
      objectHash,
      `trigger function catalog must bind ${field}`,
    );
  }
  assert.equal(migrationRunner.hashBootstrapRoleCatalog(stableBootstrapRoleCatalog(roles.toReversed(), membershipEdges.toReversed())), roleHash);
  assert.equal(migrationRunner.hashBootstrapObjectCatalog(objects.toReversed().map((row) => ({
    ...row, columns: row.columns.toReversed(), constraints: row.constraints.toReversed(),
    indexes: row.indexes.toReversed(), triggers: row.triggers.toReversed(),
  }))), objectHash);
  assert.notEqual(migrationRunner.hashBootstrapRoleCatalog(stableBootstrapRoleCatalog(roles.map((row) => row.role_name === "content_application" ? { ...row, bypass_rls: true } : row), membershipEdges)), roleHash);
  assert.notEqual(migrationRunner.hashBootstrapRoleCatalog(stableBootstrapRoleCatalog(roles.map((row) => row.role_name === "content_operator" ? { ...row, can_create_role: true } : row), membershipEdges)), roleHash);
  assert.notEqual(migrationRunner.hashBootstrapRoleCatalog(stableBootstrapRoleCatalog(roles, membershipEdges.map((edge) => ({ ...edge, inherit_option: true })))), roleHash);
  assert.notEqual(migrationRunner.hashBootstrapRoleCatalog(stableBootstrapRoleCatalog(
    roles.map((row) => row.role_name === "content_application" ? { ...row, config: ["search_path=public"] } : row),
    membershipEdges,
  )), roleHash);
  for (const attacked of [
    { ...stableBootstrapRoleCatalog(roles, membershipEdges), databaseSettings: [{ role_name: "content_application", database_name: null, settings: ["search_path=public"] }] },
    { ...stableBootstrapRoleCatalog(roles, membershipEdges), database: { database_name: "ai_content_test", owner_role_name: "content_application" } },
    { ...stableBootstrapRoleCatalog(roles, membershipEdges), publicSchema: { owner_role_name: "content_schema_owner", acl: stableBootstrapRoleEnvironment().public_schema_acl } },
    { ...stableBootstrapRoleCatalog(roles, membershipEdges), publicSchema: { owner_role_name: "pg_database_owner", acl: [...stableBootstrapRoleEnvironment().public_schema_acl, { grantee: "PUBLIC", privilege: "USAGE", grantable: false }] } },
  ]) assert.notEqual(migrationRunner.hashBootstrapRoleCatalog(attacked), roleHash);
  assert.notEqual(migrationRunner.hashBootstrapObjectCatalog(objects.map((row) => row.relation_name === "topic_rows" ? { ...row, owner_role_name: "content_application" } : row)), objectHash);
  assert.notEqual(migrationRunner.hashBootstrapObjectCatalog(objects.map((row) => row.relation_name === "topic_rows" ? {
    ...row, acl: [...row.acl, { grantee: "PUBLIC", privilege: "UPDATE", grantable: false }],
  } : row)), objectHash);
  for (const tamper of [
    (row) => ({ ...row, relation_persistence: "u" }),
    (row) => ({ ...row, replica_identity: "f" }),
    (row) => ({ ...row, is_partition: true, partition_bound: "FOR VALUES FROM (1) TO (2)" }),
    (row) => ({ ...row, inheritance_parents: ["public.parent_generations"] }),
    (row) => ({ ...row, internal_constraint_triggers: row.internal_constraint_triggers.map((trigger) => ({
      ...trigger, enabled: "D",
    })) }),
    (row) => ({ ...row, columns: row.columns.map((column) => column.column_name === "id"
      ? { ...column, default_definition: "uuid_generate_v4()" } : column) }),
    (row) => ({ ...row, columns: row.columns.map((column) => column.column_name === "brand_id"
      ? { ...column, acl: [{ grantee: "content_application", privilege: "UPDATE", grantable: false }] }
      : column) }),
    (row) => ({ ...row, columns: row.columns.map((column) => column.column_name === "brand_id"
      ? { ...column, collation_identity: "pg_catalog.C" } : column) }),
    (row) => ({ ...row, constraints: row.constraints.map((constraint) => ({ ...constraint, validated: false })) }),
    (row) => ({ ...row, indexes: row.indexes.map((index) => ({ ...index, definition: `${index.definition} WHERE id IS NOT NULL` })) }),
    (row) => ({ ...row, triggers: [...row.triggers, { trigger_name: "rogue_trigger",
      definition: "CREATE TRIGGER rogue_trigger BEFORE UPDATE ON public.ai_content_generations FOR EACH ROW EXECUTE FUNCTION set_updated_at()",
      enabled: "O", deferrable: false, initially_deferred: false, function_identity: "public.set_updated_at()",
      function_catalog: stableTriggerFunctionCatalog() }] }),
    (row) => ({ ...row, triggers: row.triggers.map((trigger) => ({
      ...trigger,
      function_catalog: { ...trigger.function_catalog, definition_sha256: "9".repeat(64) },
    })) }),
    (row) => ({ ...row, triggers: row.triggers.map((trigger) => ({
      ...trigger,
      function_catalog: {
        ...trigger.function_catalog,
        dependency_functions: (trigger.function_catalog.dependency_functions ?? []).map((dependency) => ({
          ...dependency,
          source_sha256: "8".repeat(64),
        })),
      },
    })) }),
    (row) => ({ ...row, row_security: true }),
    (row) => ({ ...row, force_row_security: true }),
    (row) => ({ ...row, rules: [{ rule_name: "deny_update", event: "2", enabled: "O", instead: true,
      definition: "CREATE RULE deny_update AS ON UPDATE TO x DO INSTEAD NOTHING" }] }),
    (row) => ({ ...row, policies: [{ policy_name: "tenant", permissive: true, roles: ["PUBLIC"], command: "r",
      qual: "true", with_check: null }] }),
  ]) {
    assert.notEqual(migrationRunner.hashBootstrapObjectCatalog(objects.map((row) => (
      row.relation_name === "ai_content_generations" ? tamper(row) : row
    ))), objectHash);
  }
});

test("074 bootstrap object catalog excludes only the separately sealed managed fence trigger", async () => {
  const source = await readFile(new URL("./migrationRunner.mjs", import.meta.url), "utf8");
  const catalogStart = source.indexOf("/* bootstrap_object_catalog_v7 */");
  const catalogEnd = source.indexOf("[bootstrapFenceRelations]", catalogStart);
  const catalogQuery = source.slice(catalogStart, catalogEnd);
  const projectionStart = source.indexOf("const relationStructureProjectionSql");
  const projectionEnd = source.indexOf("function normalizeCatalogTriggers", projectionStart);
  const relationProjection = source.slice(projectionStart, projectionEnd);
  const functionProjectionStart = source.indexOf("const functionCatalogJsonSql");
  const functionProjectionEnd = source.indexOf("function normalizeCatalogTriggers", functionProjectionStart);
  const functionProjection = source.slice(functionProjectionStart, functionProjectionEnd);
  assert.match(catalogQuery, /trigger\.tgname='ai_content_fence_'/);
  assert.match(catalogQuery, /function_namespace\.nspname='public'/);
  assert.match(catalogQuery, /function\.proname='enforce_ai_content_write_fence'/);
  assert.match(catalogQuery, /pg_get_function_identity_arguments\(function\.oid\)=''/);
  assert.match(catalogQuery, /function_catalog[\s\S]*dependency_functions/i);
  assert.match(functionProjection, /pg_get_functiondef[\s\S]*\.prosrc/i);
  assert.match(catalogQuery, /function_owner[\s\S]*function_language/i);
  assert.match(functionProjection, /return_type_identity/i);
  assert.match(relationProjection, /aclexplode\(coalesce\(relation\.relacl,acldefault\('r',relation\.relowner\)\)\)/);
  assert.match(relationProjection, /relrowsecurity/);
  assert.match(relationProjection, /relpersistence/);
  assert.match(relationProjection, /relreplident/);
  assert.match(relationProjection, /relispartition/);
  assert.match(relationProjection, /relpartbound/);
  assert.match(relationProjection, /pg_inherits/);
  assert.match(relationProjection, /internal_constraint_triggers/);
  assert.match(relationProjection, /tgisinternal/);
  assert.match(relationProjection, /pg_get_triggerdef/);
  assert.match(relationProjection, /collation_identity/);
  assert.match(relationProjection, /pg_get_ruledef/);
  assert.match(relationProjection, /pg_policy/);
  assert.doesNotMatch(catalogQuery, /trigger\.tgname\s+like\s+'ai_content_fence_%'/i);
});

test("074 bootstraps a sealed core SHA-256 compatibility function for managed pgcrypto schemas", async () => {
  const [migration, runner] = await Promise.all([
    readFile("db/migrations/074_ai_content_maintenance_write_fence.sql", "utf8"),
    readFile(new URL("./migrationRunner.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /to_regprocedure\('public\.digest\(text,text\)'\)/);
  assert.match(migration, /pg_depend[\s\S]*pg_extension[\s\S]*extname='pgcrypto'/);
  assert.match(migration, /create or replace function public\.digest\(p_value text,p_algorithm text\)/);
  assert.match(migration, /return sha256\(convert_to\(p_value,'UTF8'\)\)/);
  assert.match(runner, /encode\(sha256\(convert_to\(pg_get_functiondef/);
  assert.doesNotMatch(runner, /encode\(digest\(pg_get_functiondef/);
});

test("074 role safety seals both directions and rejects every non-approved PG16 membership edge", () => {
  const names = {
    schemaOwnerRoleName: "content_schema_owner",
    applicationRoleName: "content_application",
    operatorRoleName: "content_operator",
    migrationRoleName: "content_migration",
    cleanupRoleName: "content_cleanup",
  };
  const safe = [
    { role_name: names.schemaOwnerRoleName, can_login: false, ...noProviderRoleCapabilities, inherit: true, config: bootstrapRoleConfig(names.schemaOwnerRoleName) },
    { role_name: names.applicationRoleName, can_login: true, ...noProviderRoleCapabilities, inherit: true, config: safeBootstrapRoleConfig },
    { role_name: names.operatorRoleName, can_login: true, ...noProviderRoleCapabilities, inherit: true, config: safeBootstrapRoleConfig },
    { role_name: names.migrationRoleName, can_login: true, ...noProviderRoleCapabilities, inherit: false, config: bootstrapRoleConfig(names.migrationRoleName) },
    { role_name: names.cleanupRoleName, can_login: true, ...noProviderRoleCapabilities, inherit: true, config: safeBootstrapRoleConfig },
  ];
  const soleEdge = [{ member_role_name: names.migrationRoleName, parent_role_name: names.schemaOwnerRoleName,
    set_option: true, inherit_option: false, admin_option: false }];
  const roleCatalog = (roles, membershipEdges, environment = stableBootstrapRoleEnvironment()) => {
    return {
      ...stableBootstrapRoleCatalog(roles, membershipEdges),
      databaseSettings: environment.database_settings,
      database: { database_name: environment.database_name, owner_role_name: environment.database_owner_role_name },
      publicSchema: { owner_role_name: environment.public_schema_owner_role_name, acl: environment.public_schema_acl },
      session: {
        session_user_name: environment.session_user_name,
        current_user_name: environment.current_user_name,
        effective_search_path: environment.effective_search_path,
      },
    };
  };
  assert.doesNotThrow(() => migrationRunner.validateBootstrapRoleSafety(roleCatalog(safe, soleEdge), names));
  const providerEdges = safe.map(({ role_name: parent_role_name }) => ({
    member_role_name: "postgres", parent_role_name,
    set_option: false, inherit_option: false, admin_option: true,
  }));
  const managedEnvironment = stableBootstrapRoleEnvironment({
    public_schema_acl: [
      ...stableBootstrapRoleEnvironment().public_schema_acl,
      ...["PUBLIC", "anon", "authenticated", "postgres", "service_role"]
        .map((grantee) => ({ grantee, privilege: "USAGE", grantable: false })),
    ],
    database_settings: [{ role_name: null, database_name: "ai_content_test", settings: ["app.settings.jwt_exp=3600"] }],
  });
  assert.doesNotThrow(() => migrationRunner.validateBootstrapRoleSafety(
    roleCatalog(safe, [...soleEdge, ...providerEdges], managedEnvironment), names,
  ));
  assert.throws(() => migrationRunner.validateBootstrapRoleSafety(
    roleCatalog(safe, [...soleEdge, { ...providerEdges[0], set_option: true }], managedEnvironment), names,
  ), /bootstrap_role_catalog_invalid/);
  assert.throws(() => migrationRunner.validateBootstrapRoleSafety(roleCatalog(safe, soleEdge,
    stableBootstrapRoleEnvironment({
      public_schema_acl: [...managedEnvironment.public_schema_acl,
        { grantee: "rogue_login", privilege: "CREATE", grantable: false }],
    })), names), /bootstrap_role_public_schema_acl_invalid/);
  assert.throws(() => migrationRunner.validateBootstrapRoleSafety(roleCatalog(safe, soleEdge,
    stableBootstrapRoleEnvironment({
      database_settings: [{ role_name: null, database_name: "ai_content_test", settings: ["search_path=public"] }],
    })), names), /bootstrap_role_database_settings_invalid/);
  for (const capability of ["can_create_db", "can_create_role", "can_replicate"]) {
    for (const roleName of safe.map((row) => row.role_name)) {
      const attacked = safe.map((row) => row.role_name === roleName ? { ...row, [capability]: true } : row);
      assert.throws(() => migrationRunner.validateBootstrapRoleSafety(roleCatalog(attacked, soleEdge), names), /bootstrap_role_catalog_invalid/);
    }
  }
  const missingCapability = safe.map((row) => ({ ...row }));
  delete missingCapability[0].can_create_role;
  assert.throws(() => migrationRunner.validateBootstrapRoleSafety(roleCatalog(missingCapability, soleEdge), names), /bootstrap_role_catalog_invalid/);
  for (const target of [names.schemaOwnerRoleName, names.operatorRoleName, names.migrationRoleName, names.cleanupRoleName, names.applicationRoleName]) {
    const attacked = [...soleEdge, { member_role_name: "rogue_login", parent_role_name: target,
      set_option: true, inherit_option: false, admin_option: false }];
    assert.throws(() => migrationRunner.validateBootstrapRoleSafety(roleCatalog(safe, attacked), names), /bootstrap_role_catalog_invalid/);
  }
  for (const option of ["set_option", "inherit_option", "admin_option"]) {
    const wrongOptions = soleEdge.map((edge) => ({ ...edge, [option]: option !== "set_option" }));
    assert.throws(() => migrationRunner.validateBootstrapRoleSafety(roleCatalog(safe, wrongOptions), names), /bootstrap_role_catalog_invalid/);
  }
  const indirectInbound = [...soleEdge,
    { member_role_name: "rogue_login", parent_role_name: "rogue_intermediate", set_option: true, inherit_option: false, admin_option: false },
    { member_role_name: "rogue_intermediate", parent_role_name: names.schemaOwnerRoleName, set_option: true, inherit_option: false, admin_option: false },
  ];
  assert.throws(() => migrationRunner.validateBootstrapRoleSafety(roleCatalog(safe, indirectInbound), names), /bootstrap_role_catalog_invalid/);
  assert.throws(() => migrationRunner.validateBootstrapRoleSafety(roleCatalog([...safe, safe[0]], soleEdge), names), /bootstrap_role_catalog_invalid/);
});

test("074 event-trigger definition hash binds event owner enabled state function and sorted WHEN tags", () => {
  assert.deepEqual(migrationRunner.required074DdlGuardTags, [],
    "the hard gate must observe every ddl_command_end tag and allowlist inside the guard");
  const definition = {
    eventTriggerName: "ai_content_ddl_guard_074",
    eventTriggerEvent: "ddl_command_end",
    eventTriggerEnabled: "enabled",
    eventTriggerFunction: "public.enforce_ai_content_ddl_allowlist",
    eventTriggerFunctionSha256: "6".repeat(64),
    eventTriggerOwner: "postgres",
    eventTriggerTags: ["CREATE TABLE", "ALTER TABLE"],
  };
  const expected = migrationRunner.hashEventTriggerDefinition(definition);
  assert.equal(migrationRunner.hashEventTriggerDefinition({ ...definition, eventTriggerTags: definition.eventTriggerTags.toReversed() }), expected);
  for (const altered of [
    { ...definition, eventTriggerEvent: "sql_drop" },
    { ...definition, eventTriggerEnabled: "disabled" },
    { ...definition, eventTriggerOwner: "content_schema_owner" },
    { ...definition, eventTriggerTags: ["DROP TABLE"] },
  ]) assert.notEqual(migrationRunner.hashEventTriggerDefinition(altered), expected);
});

test("074 post-migration security catalog binds function trigger catalog owner and ACL properties", () => {
  const catalog = {
    functions: [{ identity: "public.assert_ai_content_writable()", definition_sha256: "1".repeat(64), owner_role_name: "content_schema_owner", security_definer: true, config: ["search_path=pg_catalog, public"], acl: [{ grantee: "content_application", privilege: "EXECUTE", grantable: false }] }],
    ordinaryTriggers: [{ relation_name: "ai_content_generations", trigger_name: "ai_content_fence_ai_content_generation_deadbeef", trigger_type: 31, function_identity: "public.enforce_ai_content_write_fence()", enabled: "A",
      definition: "CREATE TRIGGER ai_content_fence_ai_content_generation_deadbeef BEFORE INSERT OR DELETE OR UPDATE ON ai_content_generations FOR EACH ROW EXECUTE FUNCTION enforce_ai_content_write_fence()" }],
    controlTriggers: [
      { relation_name: "ai_content_bootstrap_state", trigger_name: "ai_content_bootstrap_075_registration_must_clear", trigger_type: 21, function_identity: "public.enforce_ai_content_075_registration_seal_cleared()", enabled: "O", deferrable: true, initially_deferred: true,
        definition: "CREATE CONSTRAINT TRIGGER ai_content_bootstrap_075_registration_must_clear AFTER INSERT OR UPDATE ON ai_content_bootstrap_state DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_ai_content_075_registration_seal_cleared()" },
      { relation_name: "ai_content_cutover_status_events", trigger_name: "ai_content_cutover_status_events_immutable", trigger_type: 27, function_identity: "public.forbid_ai_content_cutover_event_mutation()", enabled: "O", deferrable: false, initially_deferred: false,
        definition: "CREATE TRIGGER ai_content_cutover_status_events_immutable BEFORE DELETE OR UPDATE ON ai_content_cutover_status_events FOR EACH ROW EXECUTE FUNCTION forbid_ai_content_cutover_event_mutation()" },
    ],
    fenceCatalog: [{ relation_name: "ai_content_generations", relation_class: "customer_execution", row_classifier: "whole_relation" }],
    controlRelations: [{ relation_name: "ai_content_maintenance_state",
      ...stableRelationShape("content_schema_owner", [{ grantee: "content_application", privilege: "SELECT", grantable: false }]) }],
  };
  const expected = migrationRunner.hashFenceSecurityCatalog(catalog);
  assert.equal(
    JSON.parse(migrationRunner.canonicalFenceSecurityCatalog(catalog)).contractVersion,
    "ai-content-074-fence-security-catalog.v5",
  );
  for (const attacked of [
    { ...catalog, functions: [{ ...catalog.functions[0], definition_sha256: "2".repeat(64) }] },
    { ...catalog, functions: [{ ...catalog.functions[0], owner_role_name: "content_application" }] },
    { ...catalog, functions: [{ ...catalog.functions[0], config: ["search_path=public"] }] },
    { ...catalog, functions: [{ ...catalog.functions[0], security_definer: false }] },
    { ...catalog, ordinaryTriggers: [{ ...catalog.ordinaryTriggers[0], enabled: "D" }] },
    { ...catalog, ordinaryTriggers: [{ ...catalog.ordinaryTriggers[0], definition:
      "CREATE TRIGGER ai_content_fence_ai_content_generation_deadbeef BEFORE INSERT OR DELETE OR UPDATE ON ai_content_generations FOR EACH ROW WHEN (false) EXECUTE FUNCTION enforce_ai_content_write_fence()" }] },
    { ...catalog, controlTriggers: [{ ...catalog.controlTriggers[0], enabled: "D" }, catalog.controlTriggers[1]] },
    { ...catalog, controlTriggers: [{ ...catalog.controlTriggers[0], definition:
      "CREATE CONSTRAINT TRIGGER ai_content_bootstrap_075_registration_must_clear AFTER INSERT OR UPDATE ON ai_content_bootstrap_state DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (false) EXECUTE FUNCTION enforce_ai_content_075_registration_seal_cleared()" }, catalog.controlTriggers[1]] },
    { ...catalog, controlTriggers: [catalog.controlTriggers[0], { ...catalog.controlTriggers[1], definition:
      "CREATE TRIGGER ai_content_cutover_status_events_immutable BEFORE DELETE OR UPDATE ON ai_content_cutover_status_events FOR EACH ROW WHEN (false) EXECUTE FUNCTION forbid_ai_content_cutover_event_mutation()" }] },
    { ...catalog, controlTriggers: [{ ...catalog.controlTriggers[0], function_identity: "public.enforce_ai_content_write_fence()" }, catalog.controlTriggers[1]] },
    { ...catalog, functions: [{ ...catalog.functions[0], acl: [] }] },
    { ...catalog, controlRelations: [{ ...catalog.controlRelations[0], row_security: true }] },
    { ...catalog, controlRelations: [{ ...catalog.controlRelations[0], force_row_security: true }] },
    { ...catalog, controlRelations: [{ ...catalog.controlRelations[0], relation_persistence: "u" }] },
    { ...catalog, controlRelations: [{ ...catalog.controlRelations[0], replica_identity: "f" }] },
    { ...catalog, controlRelations: [{ ...catalog.controlRelations[0], inheritance_parents: ["public.parent"] }] },
    { ...catalog, controlRelations: [{ ...catalog.controlRelations[0], internal_constraint_triggers: [{
      constraint_identity: "public.ai_content_maintenance_state.fixture_fkey", trigger_name: "fixture",
      trigger_type: 5, enabled: "D", deferrable: false, initially_deferred: false,
      function_identity: "pg_catalog.RI_FKey_check_ins()", definition: "CREATE CONSTRAINT TRIGGER fixture",
    }] }] },
    { ...catalog, controlRelations: [{ ...catalog.controlRelations[0], constraints: [{ constraint_name: "pair", constraint_type: "c",
      definition: "CHECK (false)", validated: true, deferrable: false, initially_deferred: false }] }] },
    { ...catalog, controlRelations: [{ ...catalog.controlRelations[0], rules: [{ rule_name: "deny", event: "2", enabled: "O",
      instead: true, definition: "CREATE RULE deny AS ON UPDATE TO x DO INSTEAD NOTHING" }] }] },
  ]) assert.notEqual(migrationRunner.hashFenceSecurityCatalog(attacked), expected);
});

test("075 stable fence core excludes only legitimate inbound FK trigger additions", () => {
  const catalog = {
    functions: [{ identity: "public.assert_ai_content_writable()", definition_sha256: "1".repeat(64), owner_role_name: "postgres", security_definer: true, config: ["search_path=pg_catalog,public"], acl: [] }],
    ordinaryTriggers: [], controlTriggers: [], fenceCatalog: [],
    controlRelations: [{ relation_name: "ai_content_cutovers", ...stableRelationShape("postgres", []) }],
  };
  const expected = migrationRunner.hashFenceSecurityStableCore(catalog);
  const withInboundForeignKeyTrigger = {
    ...catalog,
    controlRelations: [{ ...catalog.controlRelations[0], internal_constraint_triggers: [{
      constraint_identity: "public.ai_content_generation_operations.cutover_id_fkey",
      trigger_name: "RI_ConstraintTrigger_a_fixture", trigger_type: 9, enabled: "O",
      deferrable: false, initially_deferred: false,
      function_identity: "pg_catalog.RI_FKey_noaction_del()",
      definition: "CREATE CONSTRAINT TRIGGER RI_ConstraintTrigger_a_fixture",
    }] }],
  };
  assert.equal(migrationRunner.hashFenceSecurityStableCore(withInboundForeignKeyTrigger), expected);
  assert.equal(
    JSON.parse(migrationRunner.canonicalFenceSecurityStableCore(catalog)).contractVersion,
    "ai-content-074-fence-security-stable-core.v1",
  );
  for (const attacked of [
    { ...catalog, functions: [{ ...catalog.functions[0], definition_sha256: "2".repeat(64) }] },
    { ...catalog, controlRelations: [{ ...catalog.controlRelations[0], owner_role_name: "content_schema_owner" }] },
    { ...catalog, controlRelations: [{ ...catalog.controlRelations[0], acl: [{ grantee: "PUBLIC", privilege: "SELECT", grantable: false }] }] },
    { ...catalog, controlRelations: [{ ...catalog.controlRelations[0], columns: [{
      ordinal_position: 1, column_name: "tampered", type_identity: "text", collation_identity: null,
      not_null: false, default_definition: null, identity_kind: "", generated_kind: "", acl: [],
    }] }] },
  ]) assert.notEqual(migrationRunner.hashFenceSecurityStableCore(attacked), expected);
});

test("075 protected object catalog combines bootstrap objects with exactly six full control structures", () => {
  const bootstrapObjectRows = [{
    schema_name: "public", relation_name: "ai_content_generations",
    ...stableRelationShape("content_schema_owner", []), triggers: [],
  }];
  const controlRelations = migrationRunner.providerEnforcementBundle.controlRelations.map((relation_name) => ({
    relation_name, ...stableRelationShape("postgres", []),
  }));
  const expected = migrationRunner.hashPost075ProtectedObjectCatalog({ bootstrapObjectRows, controlRelations });
  const canonical = JSON.parse(migrationRunner.canonicalPost075ProtectedObjectCatalog({
    bootstrapObjectRows, controlRelations,
  }));
  assert.equal(canonical.contractVersion, "ai-content-075-protected-object-catalog.v1");
  assert.equal(canonical.bootstrapObjectCatalog.objects.length, 1);
  assert.equal(canonical.controlStructures.length, 6);
  assert.throws(
    () => migrationRunner.hashPost075ProtectedObjectCatalog({ bootstrapObjectRows, controlRelations: controlRelations.slice(1) }),
    /cutover_075_post_control_structure_catalog_invalid/,
  );
  assert.notEqual(migrationRunner.hashPost075ProtectedObjectCatalog({
    bootstrapObjectRows,
    controlRelations: controlRelations.map((row, index) => index === 0
      ? { ...row, internal_constraint_triggers: [{
        constraint_identity: "public.child.parent_fkey", trigger_name: "RI_fixture", trigger_type: 9,
        enabled: "O", deferrable: false, initially_deferred: false,
        function_identity: "pg_catalog.RI_FKey_noaction_del()", definition: "CREATE CONSTRAINT TRIGGER RI_fixture",
      }] }
      : row),
  }), expected);
  assert.notEqual(migrationRunner.hashPost075ProtectedObjectCatalog({
    bootstrapObjectRows: bootstrapObjectRows.map((row) => ({ ...row, replica_identity: "f" })),
    controlRelations,
  }), expected);
});

test("074 full event-trigger catalog is order-independent and binds arbitrary preexisting triggers", () => {
  const rows = [
    { event_trigger_name: "supabase_guard", event_trigger_event: "ddl_command_end", event_trigger_tags: ["ALTER TABLE", "CREATE TABLE"], event_trigger_enabled: "enabled", event_trigger_owner: "postgres", event_trigger_function: "extensions.guard", event_trigger_function_sha256: "1".repeat(64), function_catalog: stableEventFunctionCatalog("extensions.guard()", "1".repeat(64)) },
    { event_trigger_name: "audit_drop", event_trigger_event: "sql_drop", event_trigger_tags: [], event_trigger_enabled: "enabled", event_trigger_owner: "postgres", event_trigger_function: "public.audit_drop", event_trigger_function_sha256: "2".repeat(64), function_catalog: stableEventFunctionCatalog("public.audit_drop()", "2".repeat(64)) },
  ];
  const expected = migrationRunner.hashEventTriggerCatalog(rows);
  assert.equal(migrationRunner.hashEventTriggerCatalog(rows.toReversed().map((row) => ({ ...row, event_trigger_tags: row.event_trigger_tags.toReversed() }))), expected);
  assert.notEqual(migrationRunner.hashEventTriggerCatalog([...rows, { ...rows[0], event_trigger_name: "wrapper_guard" }]), expected);
  assert.notEqual(migrationRunner.hashEventTriggerCatalog(rows.map((row) => row.event_trigger_name === "supabase_guard" ? { ...row, event_trigger_function_sha256: "3".repeat(64), function_catalog: { ...row.function_catalog, definition_sha256: "3".repeat(64) } } : row)), expected);
  for (const mutate of [
    (catalog) => ({ ...catalog, owner_role_name: "content_schema_owner" }),
    (catalog) => ({ ...catalog, acl: [{ grantee: "PUBLIC", privilege: "EXECUTE", grantable: false }] }),
    (catalog) => ({ ...catalog, config: ["search_path=public"] }),
    (catalog) => ({ ...catalog, source_sha256: "f".repeat(64) }),
    (catalog) => ({ ...catalog, security_definer: false }),
  ]) assert.notEqual(migrationRunner.hashEventTriggerCatalog(rows.map((row) => row.event_trigger_name === "supabase_guard"
    ? { ...row, function_catalog: mutate(row.function_catalog) } : row)), expected);
});

test("074 bootstrap role authorization rejects unsigned, stale, wrong image, and wrong migration requests", () => {
  const now = new Date("2026-08-05T00:00:00.000Z");
  const base = {
    contractVersion: "ai-content-bootstrap-role-authorization.v4",
    requestId: "bootstrap-074-1",
    migrationId: "074_ai_content_maintenance_write_fence.sql",
    migrationSha256: "1".repeat(64),
    imageDigest: `sha256:${"2".repeat(64)}`,
    imageSourceLabel: "3".repeat(40),
    roleCatalogSha256: "4".repeat(64),
    objectCatalogSha256: "5".repeat(64),
    migrationRoleName: "content_migration",
    schemaOwnerRoleName: "content_schema_owner",
    applicationRoleName: "content_application",
    operatorRoleName: "content_operator",
    cleanupRoleName: "content_cleanup",
    eventTriggerName: "ai_content_ddl_guard_074",
    eventTriggerFunction: "public.enforce_ai_content_ddl_allowlist",
    eventTriggerFunctionSha256: "6".repeat(64),
    eventTriggerEvent: "ddl_command_end",
    eventTriggerOwner: "postgres",
    eventTriggerTags: migrationRunner.required074DdlGuardTags,
    eventTriggerDefinitionSha256: "7".repeat(64),
    eventTriggerCatalogBeforeSha256: migrationRunner.hashEventTriggerCatalog([]),
    eventTriggerCatalogBeforeCount: 0,
    issuedAt: "2026-08-04T23:59:00.000Z",
    expiresAt: "2026-08-05T00:01:00.000Z",
  };
  base.eventTriggerDefinitionSha256 = migrationRunner.hashEventTriggerDefinition({
    ...base,
    eventTriggerEnabled: "enabled",
  });
  const authorization = signAuthorization(base);
  const context = {
    authorizationVerification: authorizationIdentity.verification,
    providerAttestationVerification: providerIdentity.verification,
    now,
    migration: { id: base.migrationId, checksum: base.migrationSha256 },
    imageDigest: base.imageDigest,
    imageSourceLabel: base.imageSourceLabel,
    roleCatalogSha256: base.roleCatalogSha256,
    objectCatalogSha256: base.objectCatalogSha256,
    eventTriggerCatalogBeforeSha256: base.eventTriggerCatalogBeforeSha256,
    eventTriggerCatalogBeforeCount: base.eventTriggerCatalogBeforeCount,
    usedRequestIds: new Set(),
  };

  assert.equal(migrationRunner.validateBootstrapRoleAuthorization(authorization, context).requestId, base.requestId);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization(signAuthorization({ ...base, contractVersion: "ai-content-bootstrap-role-authorization.v3" }), context), /bootstrap_role_authorization_contract_invalid/);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization(signAuthorization({ ...base, contractVersion: "ai-content-bootstrap-role-authorization.v2" }), context), /bootstrap_role_authorization_contract_invalid/);
  const { signature: _signature, ...exactUnsigned } = authorization;
  assert.throws(() => migrationRunner.canonicalBootstrapAuthorizationPayload({ ...exactUnsigned, unexpected: true }), /bootstrap_role_authorization_envelope_invalid/);
  assert.throws(() => migrationRunner.canonicalBootstrapAuthorizationPayload(Object.assign(Object.create({ inherited: true }), exactUnsigned)), /bootstrap_role_authorization_envelope_invalid/);
  const unsignedMissing = { ...exactUnsigned };
  delete unsignedMissing.expiresAt;
  assert.throws(() => migrationRunner.canonicalBootstrapAuthorizationPayload(unsignedMissing), /bootstrap_role_authorization_envelope_invalid/);
  assert.throws(() => migrationRunner.canonicalBootstrapAuthorizationPayload(authorization), /bootstrap_role_authorization_envelope_invalid/);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization({ ...authorization, unexpected: true }, context), /bootstrap_role_authorization_envelope_invalid/);
  const signedMissing = { ...authorization };
  delete signedMissing.cleanupRoleName;
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization(signedMissing, context), /bootstrap_role_authorization_envelope_invalid/);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization({ ...authorization, signature: "not-base64" }, context), /bootstrap_role_authorization_signature_shape_invalid/);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization({ ...authorization, signature: Buffer.alloc(64).toString("base64") }, context), /bootstrap_role_authorization_signature_invalid/);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization({ ...authorization, algorithm: "RSA" }, context), /bootstrap_role_authorization_identity_invalid/);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization({ ...authorization, keyId: "wrong-key" }, context), /bootstrap_role_authorization_identity_invalid/);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization(authorization, {
    ...context,
    authorizationVerification: { ...authorizationIdentity.verification, expectedPublicKeySha256: "0".repeat(64) },
  }), /bootstrap_role_authorization_fingerprint_invalid/);
  const wrongAuthorizationIdentity = createEd25519Identity(authorizationIdentity.keyId);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization(authorization, {
    ...context,
    authorizationVerification: wrongAuthorizationIdentity.verification,
  }), /bootstrap_role_authorization_signature_invalid/);
  const swappedProviderIdentity = createEd25519Identity(providerIdentity.keyId);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization(authorization, {
    ...context,
    providerAttestationVerification: {
      ...providerIdentity.verification,
      publicKeyPem: swappedProviderIdentity.verification.publicKeyPem,
    },
  }), /bootstrap_role_authorization_provider_fingerprint_invalid/);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization(authorization, { ...context, now: new Date("2026-08-05T00:02:00.000Z") }), /bootstrap_role_authorization_expired/);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization(authorization, { ...context, imageDigest: `sha256:${"9".repeat(64)}` }), /bootstrap_role_authorization_image_mismatch/);
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization(authorization, { ...context, migration: { id: "075_ai_content_three_format_cutover.sql", checksum: base.migrationSha256 } }), /bootstrap_role_authorization_migration_mismatch/);
  const inconsistent = { ...base, eventTriggerDefinitionSha256: "7".repeat(64) };
  assert.throws(() => migrationRunner.validateBootstrapRoleAuthorization(signAuthorization(inconsistent), context), /bootstrap_role_authorization_event_trigger_invalid/);
});

test("074 bootstrap role authorization seals provider install and consumes exact one-shot trigger evidence", () => {
  const base = {
    contractVersion: "ai-content-bootstrap-role-authorization.v4",
    requestId: "bootstrap-074-provider",
    migrationId: "074_ai_content_maintenance_write_fence.sql",
    migrationSha256: "1".repeat(64),
    imageDigest: `sha256:${"2".repeat(64)}`,
    imageSourceLabel: "3".repeat(40),
    roleCatalogSha256: "4".repeat(64),
    objectCatalogSha256: "5".repeat(64),
    migrationRoleName: "content_migration",
    schemaOwnerRoleName: "content_schema_owner",
    applicationRoleName: "content_application",
    operatorRoleName: "content_operator",
    cleanupRoleName: "content_cleanup",
    eventTriggerName: "ai_content_ddl_guard_074",
    eventTriggerFunction: "public.enforce_ai_content_ddl_allowlist",
    eventTriggerFunctionSha256: "6".repeat(64),
    eventTriggerEvent: "ddl_command_end",
    eventTriggerOwner: "postgres",
    eventTriggerTags: migrationRunner.required074DdlGuardTags,
    eventTriggerDefinitionSha256: "7".repeat(64),
    eventTriggerCatalogBeforeSha256: migrationRunner.hashEventTriggerCatalog([]),
    eventTriggerCatalogBeforeCount: 0,
    issuedAt: "2026-08-04T23:59:00.000Z",
    expiresAt: "2026-08-05T00:01:00.000Z",
  };
  base.eventTriggerDefinitionSha256 = migrationRunner.hashEventTriggerDefinition({
    ...base,
    eventTriggerEnabled: "enabled",
  });
  const authorization = signAuthorization(base);
  const interimFenceSecurityCatalog = makeInterimFenceSecurityCatalog();
  interimFenceSecurityCatalog.controlRelations[0].columns = [{
    ordinalPosition: 1,
    columnName: "singleton",
    typeIdentity: "boolean",
    collationIdentity: null,
    notNull: true,
    defaultDefinition: "true",
    identityKind: "",
    generatedKind: "",
    acl: [],
  }];
  const interimFenceSecurityCatalogCanonicalJson = migrationRunner.canonicalFenceSecurityCatalog(interimFenceSecurityCatalog);
  const install = migrationRunner.buildProviderEventTriggerInstallRequest(authorization, {
    fenceSecurityCatalogSha256: createHash("sha256").update(interimFenceSecurityCatalogCanonicalJson).digest("hex"),
    fenceSecurityCatalogCanonicalJson: interimFenceSecurityCatalogCanonicalJson,
    eventTriggerCatalogBeforeCanonicalJson: migrationRunner.canonicalEventTriggerCatalog([]),
  });
  const registrationFunction = install.expectedFinalFenceSecurityCatalog.functions.find(
    (row) => row.identity === "public.register_ai_content_075_fence_relations()",
  );
  assert.ok(registrationFunction.acl.some(
    (entry) => entry.grantee === "content_schema_owner" && entry.privilege === "EXECUTE",
  ), "provider catalog must preserve the no-login schema-owner registration execute edge");
  const cutoversRelation = install.expectedFinalFenceSecurityCatalog.controlRelations.find(
    (row) => row.relationName === "ai_content_cutovers",
  );
  assert.deepEqual(
    cutoversRelation.acl.filter((entry) => entry.grantee === "content_schema_owner"),
    [{ grantee: "content_schema_owner", privilege: "REFERENCES", grantable: false }],
    "provider catalog must grant schema-owner only the REFERENCES edge required by 075 foreign keys",
  );
  assert.equal(cutoversRelation.acl.some(
    (entry) => entry.grantee === "PUBLIC"
      || (entry.grantee === "content_schema_owner" && ["SELECT", "UPDATE", "INSERT", "DELETE", "TRUNCATE"].includes(entry.privilege)),
  ), false);
  assert.equal(install.eventTriggerOwner, "postgres");
  assert.equal(install.eventTriggerEnabled, "enabled");
  assert.deepEqual(install.eventTriggerTags, migrationRunner.required074DdlGuardTags);
  assert.equal(install.providerAttestationKeyId, providerIdentity.keyId);
  assert.equal(install.providerAttestationPublicKeySha256, providerIdentity.publicKeySha256);
  const { requestSha256: installRequestSha256, ...jsonbReorderedInstall } = structuredClone(install);
  for (const catalog of [
    jsonbReorderedInstall.interimFenceSecurityCatalog,
    jsonbReorderedInstall.expectedFinalFenceSecurityCatalog,
  ]) {
    const column = catalog.controlRelations[0].columns[0];
    catalog.controlRelations[0].columns[0] = Object.fromEntries(Object.entries(column).toReversed());
  }
  assert.equal(
    migrationRunner.hashProviderEventTriggerInstallRequest(jsonbReorderedInstall),
    installRequestSha256,
    "JSONB object-key reordering must not invalidate a canonically identical nested relation schema",
  );
  const unsigned = {
    contractVersion: "ai-content-074-provider-attestation.v4",
    providerRequestSha256: install.requestSha256,
    authorizationRequestId: authorization.requestId,
    action: "install_verify_074_enforcement_bundle",
    eventTriggerName: authorization.eventTriggerName,
    eventTriggerFunction: authorization.eventTriggerFunction,
    eventTriggerFunctionSha256: authorization.eventTriggerFunctionSha256,
    eventTriggerEvent: authorization.eventTriggerEvent,
    eventTriggerTags: authorization.eventTriggerTags,
    eventTriggerDefinitionSha256: authorization.eventTriggerDefinitionSha256,
    eventTriggerOwner: "postgres",
    eventTriggerEnabled: "enabled",
    migrationId: authorization.migrationId,
    migrationSha256: authorization.migrationSha256,
    imageDigest: authorization.imageDigest,
    imageSourceLabel: authorization.imageSourceLabel,
    roleCatalogSha256: authorization.roleCatalogSha256,
    objectCatalogSha256: authorization.objectCatalogSha256,
    fenceSecurityCatalogSha256: install.fenceSecurityCatalogSha256,
    finalFenceSecurityCatalogSha256: install.expectedFinalFenceSecurityCatalogSha256,
    eventTriggerCatalogBeforeSha256: install.eventTriggerCatalogBeforeSha256,
    eventTriggerCatalogBeforeCount: install.eventTriggerCatalogBeforeCount,
    eventTriggerCatalogAfterSha256: migrationRunner.hashEventTriggerCatalog([{
      event_trigger_name: authorization.eventTriggerName,
      event_trigger_event: authorization.eventTriggerEvent,
      event_trigger_tags: authorization.eventTriggerTags,
      event_trigger_enabled: "enabled",
      event_trigger_owner: authorization.eventTriggerOwner,
      event_trigger_function: authorization.eventTriggerFunction,
      event_trigger_function_sha256: authorization.eventTriggerFunctionSha256,
      function_catalog: stableEventFunctionCatalog(`${authorization.eventTriggerFunction}()`, authorization.eventTriggerFunctionSha256),
    }]),
    eventTriggerCatalogAfterCount: 1,
    issuedAt: "2026-08-05T00:00:00.000Z",
  };
  const attestation = signProviderAttestation(unsigned);
  const context = {
    authorization,
    installRequest: install,
    providerAttestationVerification: providerIdentity.verification,
    finalFenceSecurityCatalogSha256: install.expectedFinalFenceSecurityCatalogSha256,
    now: new Date("2026-08-05T00:00:00.000Z"),
  };

  assert.equal(migrationRunner.validateProviderEventTriggerAttestation(attestation, context).eventTriggerOwner, "postgres");
  const expiredSealedAttestation = signProviderAttestation({
    ...unsigned,
    issuedAt: "2026-08-05T00:02:00.000Z",
  });
  const expiredSealedContext = { ...context, now: new Date("2026-08-05T00:02:00.000Z") };
  assert.throws(
    () => migrationRunner.validateProviderEventTriggerAttestation(expiredSealedAttestation, expiredSealedContext),
    /provider_attestation_stale/,
  );
  assert.equal(migrationRunner.validateProviderEventTriggerAttestation(expiredSealedAttestation, {
    ...expiredSealedContext,
    allowExpiredSealed: true,
  }).eventTriggerOwner, "postgres");
  assert.throws(() => migrationRunner.validateProviderEventTriggerAttestation(signProviderAttestation({ ...unsigned, contractVersion: "ai-content-074-provider-attestation.v3" }), context), /provider_attestation_contract_invalid/);
  assert.throws(() => migrationRunner.validateProviderEventTriggerAttestation(signProviderAttestation({ ...unsigned, contractVersion: "ai-content-074-provider-attestation.v2" }), context), /provider_attestation_contract_invalid/);
  assert.throws(() => migrationRunner.validateProviderEventTriggerAttestation({ ...attestation, action: "arbitrary_sql" }, context), /provider_attestation_signature_invalid|provider_attestation_action_mismatch/);
  assert.throws(() => migrationRunner.validateProviderEventTriggerAttestation({ ...attestation, eventTriggerOwner: "content_schema_owner" }, context), /provider_attestation_signature_invalid|provider_attestation_eventTriggerOwner_mismatch/);
  assert.throws(() => migrationRunner.validateProviderEventTriggerAttestation({ ...attestation, eventTriggerTags: ["DROP TABLE"] }, context), /provider_attestation_signature_invalid/);
  assert.throws(() => migrationRunner.validateProviderEventTriggerAttestation({ ...attestation, algorithm: "RSA" }, context), /provider_attestation_identity_invalid/);
  assert.throws(() => migrationRunner.validateProviderEventTriggerAttestation({ ...attestation, keyId: "wrong-provider" }, context), /provider_attestation_identity_invalid/);
  assert.throws(() => migrationRunner.validateProviderEventTriggerAttestation(attestation, {
    ...context,
    providerAttestationVerification: { ...providerIdentity.verification, expectedPublicKeySha256: "0".repeat(64) },
  }), /provider_attestation_fingerprint_invalid/);
  assert.throws(() => migrationRunner.validateProviderEventTriggerAttestation(signProviderAttestation({
    ...unsigned,
    issuedAt: "2026-08-04T22:00:00.000Z",
  }), context), /provider_attestation_stale/);
});

test("074 migration source contains no provider-only event-trigger DDL", async () => {
  const migration = (await migrationRunner.loadMigrations()).find(({ id }) => id === "074_ai_content_maintenance_write_fence.sql");
  assert.ok(migration);
  const completionFunctionIdentity =
    "public.complete_ai_content_proposal_research(uuid,uuid,jsonb,text,jsonb,text,text)";
  const completionPairFunctionIdentity =
    "public.enforce_ai_content_proposal_research_completion_pair()";
  assert.equal(
    migration.sql.split(completionFunctionIdentity).length - 1,
    8,
    "074 must register the application completion function in every protected-ACL and scrub/grant catalog",
  );
  assert.equal(
    migration.sql.split(completionPairFunctionIdentity).length - 1,
    6,
    "074 must register the completion-pair trigger function in protected-ACL and scrub catalogs only",
  );
  assert.equal(
    migration.sql.split("public.select_ai_content_proposal(uuid,uuid,uuid,uuid)").length - 1,
    8,
    "074 must register proposal selection in every protected-ACL and scrub/grant catalog",
  );
  assert.match(migration.sql, /if protected_object_count<>50 then/i);
  assert.match(migration.sql, /ai_content_proposal_model_attempts'[\s\S]*'INSERT,SELECT,UPDATE'/i);
  assert.match(migration.sql, /ai_content_proposal_research_attempts'[\s\S]*'INSERT,SELECT,UPDATE'/i);
  assert.match(migration.sql, /ai_content_generation_operations'[\s\S]*'INSERT,SELECT,UPDATE'/i);
  assert.doesNotMatch(migration.sql, /^\s*(?:create|alter)\s+event\s+trigger\b/im);
  assert.match(migration.sql, /create function consume_ai_content_provider_attestation\(\)/i);
  assert.match(migration.sql, /current_setting\('role',\s*true\)/i);
  assert.doesNotMatch(migration.sql, /current_user<>bootstrap\.schema_owner_role_name/i);
  assert.match(migration.sql, /ai_content_cutovers_schema_owner_references_acl_invalid/);
  assert.match(migration.sql, /grantee\.rolname=bootstrap\.schema_owner_role_name::text[\s\S]*acl\.privilege_type='REFERENCES'[\s\S]*not acl\.is_grantable/i);
  const runnerSource = await readFile(new URL("./migrationRunner.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(runnerSource, /update ai_content_bootstrap_state[\s\S]{0,500}provider_attestation_json/i);
  assert.match(runnerSource, /select consume_ai_content_provider_attestation\(\)/i);
});

test("074 bootstrap role authorization applies stage one then independently consumes provider evidence", async () => {
  const fullSourceMigrations = await migrationRunner.loadMigrations();
  const migration = fullSourceMigrations.find(({ id }) => id === "074_ai_content_maintenance_write_fence.sql");
  assert.ok(migration);
  const stageRoleRows = [
    { role_name: "content_schema_owner", can_login: false, ...noProviderRoleCapabilities, inherit: true, config: publicFirstBootstrapRoleConfig },
    { role_name: "content_application", can_login: true, ...noProviderRoleCapabilities, inherit: true, config: safeBootstrapRoleConfig },
    { role_name: "content_operator", can_login: true, ...noProviderRoleCapabilities, inherit: true, config: safeBootstrapRoleConfig },
    { role_name: "content_migration", can_login: true, ...noProviderRoleCapabilities, inherit: false, config: publicFirstBootstrapRoleConfig },
    { role_name: "content_cleanup", can_login: true, ...noProviderRoleCapabilities, inherit: true, config: safeBootstrapRoleConfig },
  ];
  const stageMembershipEdges = [{ member_role_name: "content_migration", parent_role_name: "content_schema_owner",
    set_option: true, inherit_option: false, admin_option: false }];
  const stageObjectRows = migrationRunner.bootstrapFenceRelations.map((relation_name) => ({
    schema_name: "public", relation_name,
    ...stableRelationShape("content_schema_owner",
      ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]
        .map((privilege) => ({ grantee: "content_schema_owner", privilege, grantable: false }))),
    triggers: [],
  }));
  const stageEventDefinition = {
    eventTriggerName: "ai_content_ddl_guard_074", eventTriggerEvent: "ddl_command_end",
    eventTriggerOwner: "postgres", eventTriggerEnabled: "enabled",
    eventTriggerFunction: "public.enforce_ai_content_ddl_allowlist",
    eventTriggerFunctionSha256: "6".repeat(64), eventTriggerTags: migrationRunner.required074DdlGuardTags,
  };
  const preexistingEvent = {
    event_trigger_name: "provider_preexisting_guard", event_trigger_event: "ddl_command_end",
    event_trigger_tags: ["ALTER TABLE", "CREATE TABLE"], event_trigger_owner: "postgres", event_trigger_enabled: "enabled",
    event_trigger_function: "extensions.preexisting_guard", event_trigger_function_sha256: "9".repeat(64),
    function_catalog: stableEventFunctionCatalog("extensions.preexisting_guard()", "9".repeat(64)),
  };
  const unsignedAuthorization = {
    contractVersion: "ai-content-bootstrap-role-authorization.v4", requestId: "stage-074",
    migrationId: migration.id, migrationSha256: migration.checksum,
    imageDigest: `sha256:${"2".repeat(64)}`, imageSourceLabel: "3".repeat(40),
    roleCatalogSha256: migrationRunner.hashBootstrapRoleCatalog(stableBootstrapRoleCatalog(stageRoleRows, stageMembershipEdges)),
    objectCatalogSha256: migrationRunner.hashBootstrapObjectCatalog(stageObjectRows),
    migrationRoleName: "content_migration", schemaOwnerRoleName: "content_schema_owner",
    applicationRoleName: "content_application", operatorRoleName: "content_operator",
    cleanupRoleName: "content_cleanup", eventTriggerName: "ai_content_ddl_guard_074",
    eventTriggerFunction: "public.enforce_ai_content_ddl_allowlist",
    eventTriggerFunctionSha256: "6".repeat(64), eventTriggerEvent: "ddl_command_end",
    eventTriggerOwner: "postgres", eventTriggerTags: migrationRunner.required074DdlGuardTags,
    eventTriggerDefinitionSha256: migrationRunner.hashEventTriggerDefinition(stageEventDefinition),
    eventTriggerCatalogBeforeSha256: migrationRunner.hashEventTriggerCatalog([preexistingEvent]),
    eventTriggerCatalogBeforeCount: 1,
    issuedAt: "2026-08-04T23:59:00.000Z", expiresAt: "2026-08-05T00:01:00.000Z",
  };
  const authorization = signAuthorization(unsignedAuthorization);
  const calls = [];
  const appliedHistory = fullSourceMigrations
    .filter(({ id }) => id < migration.id)
    .map(({ id, checksum }) => ({ id, checksum }));
  let sealedState = null;
  const approvedLiveEvent = {
    event_trigger_name: authorization.eventTriggerName,
    event_trigger_event: authorization.eventTriggerEvent,
    event_trigger_tags: authorization.eventTriggerTags,
    event_trigger_owner: authorization.eventTriggerOwner,
    event_trigger_enabled: "enabled",
    event_trigger_function: authorization.eventTriggerFunction,
    event_trigger_function_sha256: authorization.eventTriggerFunctionSha256,
    function_catalog: stableEventFunctionCatalog(`${authorization.eventTriggerFunction}()`, authorization.eventTriggerFunctionSha256),
  };
  let liveEventRows = [preexistingEvent];
  let securityAttack = null;
  let providerBundleInstalled = false;
  let localSchemaOwner = false;
  const client = {
    async query(sql, parameters = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, parameters });
      if (normalized === 'set local role "content_schema_owner"') localSchemaOwner = true;
      if (["commit", "rollback"].includes(normalized)) localSchemaOwner = false;
      if (normalized.includes("select id, checksum from schema_migrations")) {
        return { rows: appliedHistory };
      }
      if (normalized.includes("to_regclass('public.schema_migrations')")) return { rows: [{ relation: "schema_migrations" }] };
      if (normalized.includes("to_regclass('public.workspaces')")) return { rows: [{ relation: null }] };
      if (normalized === "select session_user, current_user") {
        return { rows: [{ session_user: authorization.migrationRoleName, current_user: authorization.migrationRoleName }] };
      }
      if (normalized.includes("bootstrap_role_catalog_v4")) return { rows: stageRoleRows };
      if (normalized.includes("bootstrap_role_membership_catalog_v2")) return { rows: stageMembershipEdges };
      if (normalized.includes("bootstrap_role_environment_catalog_v1")) return { rows: [stableBootstrapRoleEnvironment()] };
      if (normalized.includes("bootstrap_session_environment_v1")) return { rows: [stableBootstrapRoleEnvironment({
        current_user_name: localSchemaOwner ? "content_schema_owner" : "content_migration",
      })] };
      if (normalized.includes("bootstrap_object_catalog_v7")) return { rows: stageObjectRows };
      if (normalized.includes("full_event_trigger_catalog_v2")) return { rows: liveEventRows };
      if (normalized.includes("fence_security_functions_v1")) {
        const bundleOwner = providerBundleInstalled ? "postgres" : "content_schema_owner";
        const ownerAcl = [{ grantee: bundleOwner, privilege: "EXECUTE", grantable: false }];
        return { rows: parameters[0].map((identity) => {
          const extra = identity.includes("assert_ai_content_writable")
            ? [{ grantee: "content_application", privilege: "EXECUTE", grantable: false }]
            : identity.includes("transition_ai_content_cutover_status")
              ? [{ grantee: "content_migration", privilege: "EXECUTE", grantable: false }, { grantee: "content_operator", privilege: "EXECUTE", grantable: false }]
              : identity.includes("register_ai_content_075_fence_relations")
                ? [{ grantee: "content_migration", privilege: "EXECUTE", grantable: false },
                  ...(providerBundleInstalled ? [{ grantee: "content_schema_owner", privilege: "EXECUTE", grantable: false }] : [])]
              : identity.includes("prepare_ai_content_cutover")
                || identity.includes("read_ai_content_cutover_control_state")
                || identity.includes("set_ai_content_maintenance")
              ? [{ grantee: "content_operator", privilege: "EXECUTE", grantable: false }]
              : identity.includes("ai_content_cutover_bypass_allowed") || identity.includes("lock_ai_content_cutover_transaction_state") || identity.includes("verify_ai_content_cutover_preflight_identity") || identity.includes("verify_ai_content_write_fence_catalog") || identity.includes("consume_ai_content_provider_attestation") || identity.includes("read_ai_content_cutover_migration_body_evidence")
                ? [{ grantee: "content_migration", privilege: "EXECUTE", grantable: false }]
                : [];
          const invoker = identity.includes("ai_content_fence_trigger_name") || identity.includes("forbid_ai_content_cutover_event_mutation");
          const target = identity.includes("assert_ai_content_writable");
          return { identity, definition_sha256: target && securityAttack === "function_body" ? "f".repeat(64) : createHash("sha256").update(identity).digest("hex"),
            owner_role_name: target && securityAttack === "function_owner" ? "content_application" : bundleOwner,
            security_definer: target && securityAttack === "security_definer" ? false : !invoker,
            config: target && securityAttack === "search_path" ? ["search_path=public"] : [identity.includes("ai_content_fence_trigger_name") ? "search_path=pg_catalog" : "search_path=pg_catalog,public"],
            acl: [...ownerAcl, ...extra, ...(target && securityAttack === "grant" ? [{ grantee: "PUBLIC", privilege: "EXECUTE", grantable: false }] : [])] };
        }) };
      }
      if (normalized.includes("fence_security_ordinary_triggers_v2")) return { rows: migrationRunner.bootstrapFenceRelations.map((relation_name) => {
        const trigger_name = `ai_content_fence_${relation_name.slice(0, 30)}_${createHash("md5").update(relation_name).digest("hex").slice(0, 12)}`;
        return {
          relation_name, trigger_name,
          trigger_type: 31, enabled: relation_name === "ai_content_generations" && securityAttack === "trigger" ? "D" : "A",
          function_identity: "public.enforce_ai_content_write_fence()",
          definition: `CREATE TRIGGER ${trigger_name} BEFORE INSERT OR DELETE OR UPDATE ON ${relation_name} FOR EACH ROW EXECUTE FUNCTION enforce_ai_content_write_fence()`,
        };
      }) };
      if (normalized.includes("fence_security_control_triggers_v2")) {
        if (securityAttack === "control_trigger_drop") return { rows: [] };
        const rows = [{
          relation_name: "ai_content_bootstrap_state",
          trigger_name: "ai_content_bootstrap_075_registration_must_clear",
          trigger_type: 21,
          enabled: securityAttack === "control_trigger_disable" ? "D" : "O",
          deferrable: true,
          initially_deferred: true,
          function_identity: securityAttack === "control_trigger_function"
            ? "public.enforce_ai_content_write_fence()"
            : "public.enforce_ai_content_075_registration_seal_cleared()",
          definition: "CREATE CONSTRAINT TRIGGER ai_content_bootstrap_075_registration_must_clear AFTER INSERT OR UPDATE ON ai_content_bootstrap_state DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_ai_content_075_registration_seal_cleared()",
        }, {
          relation_name: "ai_content_cutover_status_events",
          trigger_name: "ai_content_cutover_status_events_immutable",
          trigger_type: 27,
          enabled: "O",
          deferrable: false,
          initially_deferred: false,
          function_identity: "public.forbid_ai_content_cutover_event_mutation()",
          definition: "CREATE TRIGGER ai_content_cutover_status_events_immutable BEFORE DELETE OR UPDATE ON ai_content_cutover_status_events FOR EACH ROW EXECUTE FUNCTION forbid_ai_content_cutover_event_mutation()",
        }];
        if (securityAttack === "control_trigger_rogue") rows.push({
          relation_name: "ai_content_maintenance_state",
          trigger_name: "ai_content_control_rogue",
          trigger_type: 19,
          enabled: "O",
          deferrable: false,
          initially_deferred: false,
          function_identity: "public.forbid_ai_content_cutover_event_mutation()",
          definition: "CREATE TRIGGER ai_content_control_rogue BEFORE UPDATE ON ai_content_maintenance_state FOR EACH ROW EXECUTE FUNCTION forbid_ai_content_cutover_event_mutation()",
        });
        return { rows };
      }
      if (normalized.includes("fence_security_catalog_rows_v1")) return { rows: migrationRunner.bootstrapFenceCatalog };
      if (normalized.includes("fence_security_control_relations_v3")) return { rows: parameters[0].map((relation_name) => ({
        ...stableRelationShape(providerBundleInstalled ? "postgres" : "content_schema_owner"), relation_name,
        acl: ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"].map((privilege) => ({ grantee: providerBundleInstalled ? "postgres" : "content_schema_owner", privilege, grantable: false })).concat(
          providerBundleInstalled && relation_name === "ai_content_cutovers"
            ? [{ grantee: "content_schema_owner", privilege: "REFERENCES", grantable: false }]
            : relation_name === "ai_content_maintenance_state" ? [{ grantee: "content_application", privilege: "SELECT", grantable: false }]
            : ["ai_content_bootstrap_state", "ai_content_ddl_allowlist", "ai_content_write_fence_catalog"].includes(relation_name)
              ? [
                { grantee: "content_migration", privilege: "SELECT", grantable: false },
                ...(providerBundleInstalled && relation_name === "ai_content_bootstrap_state"
                  ? [{ grantee: "content_schema_owner", privilege: "SELECT", grantable: false }]
                  : []),
              ] : [],
        ),
      })) };
      if (normalized.startsWith("insert into ai_content_bootstrap_state")) {
        sealedState = {
          authorization_request_id: parameters[0], authorization_sha256: parameters[1],
          migration_role_name: parameters[2], schema_owner_role_name: parameters[3],
          application_role_name: parameters[4], operator_role_name: parameters[5], cleanup_role_name: parameters[6],
          migration_sha256: parameters[7], role_catalog_sha256: parameters[8], object_catalog_sha256: parameters[9],
          fence_security_catalog_sha256: parameters[10], event_trigger_catalog_before_json: JSON.parse(parameters[11]),
          final_fence_security_catalog_sha256: null,
          event_trigger_catalog_before_sha256: parameters[12], event_trigger_catalog_before_count: parameters[13],
          event_trigger_catalog_after_sha256: null, event_trigger_catalog_after_count: null,
          install_request_json: JSON.parse(parameters[14]), install_request_sha256: parameters[15],
          provider_attestation_json: null, provider_attestation_sha256: null, attestation_consumed_at: null,
          revocation_request_json: null, revocation_request_sha256: null,
        };
        return { rows: [], rowCount: 1 };
      }
      if (normalized.includes("bootstrap_durable_state_v1")) return { rows: sealedState ? [sealedState] : [] };
      if (normalized.includes("bootstrap_application_privileges_v1")) {
        return { rows: [{ app_owns_fenced_relation: false, app_control_dml: false, app_missing_minimum: false, app_forbidden_execute: false }] };
      }
      if (normalized.includes("bootstrap_event_trigger_catalog_v2")) {
        const rows = liveEventRows.filter((row) => row.event_trigger_name === authorization.eventTriggerName);
        return { rowCount: rows.length, rows };
      }
      if (normalized === "select consume_ai_content_provider_attestation() as consumed") {
        if (sealedState.attestation_consumed_at) return { rows: [{ consumed: false }], rowCount: 1 };
        sealedState.attestation_consumed_at = "2026-08-05T00:00:00.000Z";
        return { rows: [{ consumed: true }], rowCount: 1 };
      }
      if (normalized.startsWith("insert into schema_migrations")) {
        appliedHistory.push({ id: parameters[0], checksum: parameters[1] });
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const bootstrap = {
    authorization,
    authorizationVerification: authorizationIdentity.verification,
    providerAttestationVerification: providerIdentity.verification,
    now: new Date("2026-08-05T00:00:00.000Z"),
    imageDigest: authorization.imageDigest, imageSourceLabel: authorization.imageSourceLabel,
    roleCatalogSha256: authorization.roleCatalogSha256, objectCatalogSha256: authorization.objectCatalogSha256,
  };
  const stageOne = await migrationRunner.runMigrationsWithClient({
    client, migrations: fullSourceMigrations, bootstrap074: bootstrap,
  });
  assert.deepEqual(stageOne.pending, [migration.id]);
  assert.equal(stageOne.bootstrap074RestartRequired, true);
  assert.equal(stageOne.bootstrap074Stage, "provider_install_required");
  assert.equal(stageOne.cutover075Deferred, true);
  assert.equal(calls.some(({ sql }) => sql.includes("create table ai_content_proposal_performance_audits")), false);
  assert.equal(stageOne.providerInstallRequest.action, "install_verify_074_enforcement_bundle");
  assert.ok(calls.some(({ sql }) => sql === 'set local role "content_schema_owner"'));
  assert.ok(calls.some(({ sql }) => sql === "select verify_ai_content_write_fence_catalog()"));
  assert.ok(calls.some(({ sql }) => sql.includes("authorization_sha256") && sql.includes("install_request_json")));
  assert.ok(calls.some(({ sql }) => sql === 'grant select on table ai_content_bootstrap_state,ai_content_ddl_allowlist,ai_content_write_fence_catalog to "content_migration"'));
  assert.ok(calls.some(({ sql }) => sql === 'grant select on table ai_content_bootstrap_state to "content_schema_owner"'));

  const install = stageOne.providerInstallRequest;
  const bootstrapInsertCount = () => calls.filter(({ sql }) => sql.startsWith("insert into ai_content_bootstrap_state")).length;
  const insertsAfterStageOne = bootstrapInsertCount();
  const recoveredInstall = await migrationRunner.runMigrationsWithClient({
    client, migrations: fullSourceMigrations, bootstrap074: bootstrap,
  });
  assert.deepEqual(recoveredInstall.pending, []);
  assert.equal(recoveredInstall.bootstrap074Stage, "provider_install_required");
  assert.equal(recoveredInstall.cutover075Deferred, true);
  assert.deepEqual(recoveredInstall.providerInstallRequest, install);
  assert.equal(bootstrapInsertCount(), insertsAfterStageOne);
  const exactStageOneRecovery = () => migrationRunner.runMigrationsWithClient({ client, migrations: [migration], bootstrap074: bootstrap });
  const sealedStageOne = () => structuredClone(sealedState);
  const restoreStageOne = (saved) => { sealedState = saved; };
  const reorderedJsonb = sealedStageOne();
  sealedState.install_request_json = Object.fromEntries(Object.entries(sealedState.install_request_json).reverse());
  sealedState.event_trigger_catalog_before_json = Object.fromEntries(Object.entries(sealedState.event_trigger_catalog_before_json).reverse());
  sealedState.event_trigger_catalog_before_json.eventTriggers = sealedState.event_trigger_catalog_before_json.eventTriggers
    .map((row) => ({
      ...row,
      functionCatalog: {
        ...Object.fromEntries(Object.entries(row.functionCatalog).reverse()),
        acl: row.functionCatalog.acl.map((entry) => Object.fromEntries(Object.entries(entry).reverse())),
      },
    }));
  assert.deepEqual((await exactStageOneRecovery()).providerInstallRequest, install);
  restoreStageOne(reorderedJsonb);
  for (const mutate of [
    () => { sealedState.install_request_json.unexpected = true; },
    () => { delete sealedState.install_request_json.requestSha256; },
    () => { sealedState.install_request_json.requestSha256 = "0".repeat(64); },
    () => { sealedState.install_request_sha256 = "0".repeat(64); },
    () => { sealedState.event_trigger_catalog_before_json.unexpected = true; },
    () => { delete sealedState.event_trigger_catalog_before_json.contractVersion; },
    () => { sealedState.event_trigger_catalog_before_json.eventTriggers[0].unexpected = true; },
    () => { delete sealedState.event_trigger_catalog_before_json.eventTriggers[0].eventTriggerTags; },
    () => { sealedState.event_trigger_catalog_before_json.eventTriggers[0].eventTriggerTags.reverse(); },
    () => { sealedState.event_trigger_catalog_before_count += 1; },
    () => { sealedState.event_trigger_catalog_before_sha256 = "0".repeat(64); },
  ]) {
    const saved = sealedStageOne();
    mutate();
    await assert.rejects(exactStageOneRecovery(), /bootstrap_074_(?:state|install|event_trigger_baseline)/);
    restoreStageOne(saved);
  }
  const sealedInstallJson = sealedState.install_request_json;
  sealedState.install_request_json = { ...sealedInstallJson, action: "arbitrary_sql" };
  await assert.rejects(migrationRunner.runMigrationsWithClient({ client, migrations: [migration], bootstrap074: bootstrap }), /bootstrap_074_(?:state_mismatch|install_request_invalid)/);
  sealedState.install_request_json = sealedInstallJson;
  const alteredUnsignedAuthorization = { ...unsignedAuthorization, requestId: "stage-074-altered" };
  const alteredAuthorization = signAuthorization(alteredUnsignedAuthorization);
  await assert.rejects(migrationRunner.runMigrationsWithClient({
    client,
    migrations: [migration],
    bootstrap074: { ...bootstrap, authorization: alteredAuthorization },
  }), /bootstrap_074_state_mismatch/);
  providerBundleInstalled = true;
  bootstrap.now = new Date("2026-08-05T00:02:00.000Z");
  const finalFenceSecurityCatalog = await migrationRunner.readFenceSecurityCatalog(client, authorization, { ownerRoleName: "postgres" });
  assert.equal(finalFenceSecurityCatalog.catalogSha256, install.expectedFinalFenceSecurityCatalogSha256);
  const unsignedAttestation = {
    contractVersion: "ai-content-074-provider-attestation.v4",
    providerRequestSha256: install.requestSha256, authorizationRequestId: authorization.requestId,
    action: install.action, eventTriggerName: authorization.eventTriggerName,
    eventTriggerFunction: authorization.eventTriggerFunction,
    eventTriggerFunctionSha256: authorization.eventTriggerFunctionSha256,
    eventTriggerEvent: authorization.eventTriggerEvent,
    eventTriggerTags: authorization.eventTriggerTags,
    eventTriggerDefinitionSha256: authorization.eventTriggerDefinitionSha256,
    eventTriggerOwner: "postgres", eventTriggerEnabled: "enabled",
    migrationId: authorization.migrationId, migrationSha256: authorization.migrationSha256,
    imageDigest: authorization.imageDigest, imageSourceLabel: authorization.imageSourceLabel,
    roleCatalogSha256: authorization.roleCatalogSha256, objectCatalogSha256: authorization.objectCatalogSha256,
    fenceSecurityCatalogSha256: install.fenceSecurityCatalogSha256,
    finalFenceSecurityCatalogSha256: install.expectedFinalFenceSecurityCatalogSha256,
    eventTriggerCatalogBeforeSha256: install.eventTriggerCatalogBeforeSha256,
    eventTriggerCatalogBeforeCount: install.eventTriggerCatalogBeforeCount,
    eventTriggerCatalogAfterSha256: migrationRunner.hashEventTriggerCatalog([preexistingEvent, approvedLiveEvent]),
    eventTriggerCatalogAfterCount: 2,
    issuedAt: "2026-08-05T00:02:00.000Z",
  };
  const providerAttestation = signProviderAttestation(unsignedAttestation);
  const providerAttestationSha256 = migrationRunner.hashProviderAttestationEnvelope(providerAttestation);
  const stagedRevocation = migrationRunner.buildMembershipRevocationRequest(authorization, install, providerAttestationSha256);
  sealedState.provider_attestation_json = structuredClone(providerAttestation);
  sealedState.provider_attestation_sha256 = providerAttestationSha256;
  sealedState.revocation_request_json = structuredClone(stagedRevocation);
  sealedState.revocation_request_sha256 = migrationRunner.hashMembershipRevocationEnvelope(stagedRevocation);
  sealedState.final_fence_security_catalog_sha256 = install.expectedFinalFenceSecurityCatalogSha256;
  sealedState.event_trigger_catalog_after_sha256 = unsignedAttestation.eventTriggerCatalogAfterSha256;
  sealedState.event_trigger_catalog_after_count = unsignedAttestation.eventTriggerCatalogAfterCount;
  sealedState.attestation_consumed_at = null;
  const exactProviderEvidence = structuredClone(sealedState);
  securityAttack = "function_body";
  const replacedBodyCatalog = await migrationRunner.readFenceSecurityCatalog(client, authorization, { ownerRoleName: "postgres" });
  const replacedBodyAttestation = signProviderAttestation({
    ...unsignedAttestation,
    finalFenceSecurityCatalogSha256: replacedBodyCatalog.catalogSha256,
  });
  const replacedBodyAttestationSha256 = migrationRunner.hashProviderAttestationEnvelope(replacedBodyAttestation);
  const replacedBodyRevocation = migrationRunner.buildMembershipRevocationRequest(authorization, install, replacedBodyAttestationSha256);
  sealedState.provider_attestation_json = replacedBodyAttestation;
  sealedState.provider_attestation_sha256 = replacedBodyAttestationSha256;
  sealedState.revocation_request_json = replacedBodyRevocation;
  sealedState.revocation_request_sha256 = migrationRunner.hashMembershipRevocationEnvelope(replacedBodyRevocation);
  sealedState.final_fence_security_catalog_sha256 = replacedBodyCatalog.catalogSha256;
  liveEventRows = [preexistingEvent, approvedLiveEvent];
  await assert.rejects(migrationRunner.runMigrationsWithClient({
    client, migrations: [migration], bootstrap074: { ...bootstrap, providerAttestation: replacedBodyAttestation },
  }), /bootstrap_074_final_fence_security_catalog_mismatch/);
  sealedState = exactProviderEvidence;
  securityAttack = null;
  liveEventRows = [preexistingEvent, approvedLiveEvent, { ...approvedLiveEvent, event_trigger_name: "ai_content_ddl_guard_conflict" }];
  await assert.rejects(migrationRunner.runMigrationsWithClient({
    client, migrations: [migration], bootstrap074: { ...bootstrap, providerAttestation },
  }), /bootstrap_074_event_trigger_delta_invalid/);
  assert.equal(sealedState.attestation_consumed_at, null);
  liveEventRows = [preexistingEvent, approvedLiveEvent];
  for (const attack of ["function_body", "function_owner", "search_path", "security_definer", "trigger", "control_trigger_drop", "control_trigger_disable", "control_trigger_function", "control_trigger_rogue", "grant"]) {
    securityAttack = attack;
    await assert.rejects(migrationRunner.runMigrationsWithClient({
      client, migrations: [migration], bootstrap074: { ...bootstrap, providerAttestation },
    }), /bootstrap_074_(?:fence_security|final_fence_security)_/);
    assert.equal(sealedState.attestation_consumed_at, null);
  }
  securityAttack = null;
  const stageTwo = await migrationRunner.runMigrationsWithClient({
    client, migrations: fullSourceMigrations, bootstrap074: {
      ...bootstrap, providerAttestation,
    },
  });
  assert.equal(stageTwo.pending.length, 0);
  assert.equal(stageTwo.bootstrap074RestartRequired, true);
  assert.equal(stageTwo.bootstrap074Stage, "provider_evidence_consumed");
  assert.equal(stageTwo.cutover075Deferred, true);
  assert.equal(stageTwo.revocationRequest.migrationRoleName, authorization.migrationRoleName);
  assert.ok(calls.some(({ sql }) => sql === "select consume_ai_content_provider_attestation() as consumed"));
  assert.equal(calls.filter(({ sql }) => sql === 'set local role "content_schema_owner"').length, 1);
  const durableConsumes = () => calls.filter(({ sql }) => sql === "select consume_ai_content_provider_attestation() as consumed").length;
  const consumesAfterConsumption = durableConsumes();
  await assert.rejects(migrationRunner.runMigrationsWithClient({
    client, migrations: fullSourceMigrations, bootstrap074: { ...bootstrap, providerAttestation },
  }), /cutover_075_config_required/);
  assert.equal(calls.some(({ sql }) => sql.includes("create table ai_content_proposal_performance_audits")), false);
  const recovered = await migrationRunner.runMigrationsWithClient({
    client, migrations: [migration], bootstrap074: { ...bootstrap, providerAttestation },
  });
  assert.deepEqual(recovered.revocationRequest, stageTwo.revocationRequest);
  assert.equal(durableConsumes(), consumesAfterConsumption);
  const exactRecovery = () => migrationRunner.runMigrationsWithClient({
    client, migrations: [migration], bootstrap074: { ...bootstrap, providerAttestation },
  });
  const sealedEvidence = () => ({
    attestation: structuredClone(sealedState.provider_attestation_json),
    attestationSha256: sealedState.provider_attestation_sha256,
    revocation: structuredClone(sealedState.revocation_request_json),
    revocationSha256: sealedState.revocation_request_sha256,
  });
  const restoreEvidence = (saved) => {
    sealedState.provider_attestation_json = saved.attestation;
    sealedState.provider_attestation_sha256 = saved.attestationSha256;
    sealedState.revocation_request_json = saved.revocation;
    sealedState.revocation_request_sha256 = saved.revocationSha256;
  };
  for (const mutate of [
    () => { sealedState.provider_attestation_json.issuedAt = "2026-08-05T00:00:01.000Z"; },
    () => { sealedState.provider_attestation_json.signature = "0".repeat(64); },
    () => { sealedState.provider_attestation_json.unexpected = true; },
    () => { delete sealedState.provider_attestation_json.eventTriggerCatalogAfterSha256; },
    () => { sealedState.provider_attestation_sha256 = "0".repeat(64); },
    () => { sealedState.revocation_request_json.migrationRoleName = "content_application"; },
    () => { sealedState.revocation_request_json.evidenceSha256 = "f".repeat(64); },
    () => { sealedState.revocation_request_json.requestSha256 = "0".repeat(64); },
    () => { sealedState.revocation_request_json.unexpected = true; },
    () => { sealedState.revocation_request_sha256 = "0".repeat(64); },
  ]) {
    const saved = sealedEvidence();
    mutate();
    await assert.rejects(exactRecovery(), /provider_attestation|bootstrap_074_revocation_evidence/);
    restoreEvidence(saved);
  }
  for (const attack of ["function_body", "function_owner", "search_path", "security_definer", "trigger", "control_trigger_drop", "control_trigger_disable", "control_trigger_function", "control_trigger_rogue", "grant"]) {
    securityAttack = attack;
    await assert.rejects(migrationRunner.runMigrationsWithClient({
      client, migrations: [migration], bootstrap074: { ...bootstrap, providerAttestation },
    }), /bootstrap_074_(?:fence_security|final_fence_security)_/);
  }
  securityAttack = null;
  liveEventRows = [preexistingEvent, approvedLiveEvent, { ...approvedLiveEvent, event_trigger_name: "unrelated_wrapper" }];
  await assert.rejects(migrationRunner.runMigrationsWithClient({
    client, migrations: [migration], bootstrap074: { ...bootstrap, providerAttestation },
  }), /bootstrap_074_event_trigger_delta_invalid/);
  liveEventRows = [preexistingEvent, { ...approvedLiveEvent, event_trigger_function_sha256: "9".repeat(64) }];
  await assert.rejects(migrationRunner.runMigrationsWithClient({
    client, migrations: [migration], bootstrap074: { ...bootstrap, providerAttestation },
  }), /bootstrap_074_event_trigger_delta_invalid/);
  liveEventRows = [preexistingEvent, approvedLiveEvent];
  const alteredAttestation = signProviderAttestation({ ...unsignedAttestation, issuedAt: "2026-08-05T00:00:01.000Z" });
  await assert.rejects(migrationRunner.runMigrationsWithClient({
    client, migrations: [migration], bootstrap074: { ...bootstrap, providerAttestation: alteredAttestation },
  }), /provider_attestation_(?:replayed|stale)/);
  await assert.rejects(
    migrationRunner.runMigrationsWithClient({
      client,
      migrations: [migration, { id: "075_ai_content_three_format_cutover.sql", checksum: "8".repeat(64), sql: "select forbidden_075" }],
      bootstrap074: { ...bootstrap, providerAttestation },
    }),
    /bootstrap_075_present_forbidden/,
  );
  assert.equal(calls.some(({ sql }) => sql.includes("select forbidden_075")), false);
});

test("074 bootstrap rejects an earlier or extra pending migration and any 075 presence before mutation", async () => {
  const migration074 = { id: "074_ai_content_maintenance_write_fence.sql", checksum: "7".repeat(64), sql: "select 74" };
  const mutationPattern = /^(?:create|alter|insert|update|delete|begin|commit|rollback)\b/i;
  const makeClient = (history) => {
    const calls = [];
    let localSchemaOwner = false;
    return {
      calls,
      async query(sql) {
        const normalized = sql.replace(/\s+/g, " ").trim();
        calls.push(normalized);
        if (normalized === 'set local role "content_schema_owner"') localSchemaOwner = true;
        if (["commit", "rollback"].includes(normalized)) localSchemaOwner = false;
        if (normalized.includes("bootstrap_role_catalog_v4")) return { rows: [
          { role_name: "content_schema_owner", can_login: false, ...noProviderRoleCapabilities, inherit: true, config: publicFirstBootstrapRoleConfig },
          { role_name: "content_application", can_login: true, ...noProviderRoleCapabilities, inherit: true, config: safeBootstrapRoleConfig },
          { role_name: "content_operator", can_login: true, ...noProviderRoleCapabilities, inherit: true, config: safeBootstrapRoleConfig },
          { role_name: "content_migration", can_login: true, ...noProviderRoleCapabilities, inherit: false, config: publicFirstBootstrapRoleConfig },
          { role_name: "content_cleanup", can_login: true, ...noProviderRoleCapabilities, inherit: true, config: safeBootstrapRoleConfig },
        ] };
        if (normalized.includes("bootstrap_role_membership_catalog_v2")) return { rows: [{
          member_role_name: "content_migration", parent_role_name: "content_schema_owner",
          set_option: true, inherit_option: false, admin_option: false,
        }] };
        if (normalized.includes("bootstrap_role_environment_catalog_v1")) return { rows: [stableBootstrapRoleEnvironment()] };
        if (normalized.includes("bootstrap_session_environment_v1")) return { rows: [stableBootstrapRoleEnvironment({
          current_user_name: localSchemaOwner ? "content_schema_owner" : "content_migration",
        })] };
        if (normalized.startsWith("select pg_advisory_lock") || normalized.startsWith("select pg_advisory_unlock")) return { rows: [] };
        if (normalized.includes("to_regclass('public.schema_migrations')")) return { rows: [{ relation: "schema_migrations" }] };
        if (normalized.includes("select id, checksum from schema_migrations")) return { rows: history };
        return { rows: [] };
      },
    };
  };

  const earlier = { id: "073_before.sql", checksum: "3".repeat(64), sql: "select 73" };
  const earlierClient = makeClient([]);
  await assert.rejects(
    migrationRunner.runMigrationsWithClient({ client: earlierClient, migrations: [earlier, migration074], bootstrap074: {}, bootstrap074Prerequisite: prerequisiteRoleNames }),
    /bootstrap_074_pending_set_invalid/,
  );
  assert.equal(earlierClient.calls.some((sql) => mutationPattern.test(sql)), false);

  const unknown = { id: "073b_unknown.sql", checksum: "b".repeat(64), sql: "select unknown" };
  const fullSourceUnknownClient = makeClient([]);
  await assert.rejects(
    migrationRunner.runMigrationsWithClient({
      client: fullSourceUnknownClient,
      migrations: [
        { id: "073a_legacy_trigger_function_search_path.sql", checksum: "a".repeat(64), sql: "select prerequisite_073a" },
        unknown,
        migration074,
        { id: "075_ai_content_three_format_cutover.sql", checksum: "8".repeat(64), sql: "select 75" },
      ],
      cutover: {},
      bootstrap074Prerequisite: prerequisiteRoleNames,
      bootstrap074PrerequisiteMode: true,
      bootstrap074PrerequisiteProviderRoleName: "postgres",
    }),
    /bootstrap_074_pending_set_invalid/,
  );
  assert.equal(fullSourceUnknownClient.calls.some((sql) => mutationPattern.test(sql)), false);

  const prerequisite = {
    id: "073a_legacy_trigger_function_search_path.sql",
    checksum: "5acce238ce19656738aff6e311d7f3db4a9763c5aee8a3ea1d6e338ce6f84001",
    sql: "select prerequisite_073a",
  };
  const tamperedPrerequisiteClient = makeClient([]);
  await assert.rejects(migrationRunner.runMigrationsWithClient({
    client: tamperedPrerequisiteClient,
    migrations: [{ ...prerequisite, checksum: "a".repeat(64) }, migration074],
    bootstrap074Prerequisite: prerequisiteRoleNames,
    bootstrap074PrerequisiteMode: true,
    bootstrap074PrerequisiteProviderRoleName: "postgres",
  }), /bootstrap_074_prerequisite_source_invalid/);
  assert.equal(tamperedPrerequisiteClient.calls.some((sql) => mutationPattern.test(sql)), false);
  const prerequisiteClient = makeClient([]);
  const originalQuery = prerequisiteClient.query.bind(prerequisiteClient);
  prerequisiteClient.query = async (sql, parameters) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.includes("legacy_trigger_search_path_provider_owner_v1")) {
      prerequisiteClient.calls.push(normalized);
      return { rows: [{
        owner_role_name: "postgres", function_count: 19, owner_count: 1,
        session_user_name: "postgres", current_user_name: "postgres",
      }] };
    }
    return originalQuery(sql, parameters);
  };
  const prerequisiteResult = await migrationRunner.runMigrationsWithClient({
    client: prerequisiteClient,
    migrations: [prerequisite, migration074],
    bootstrap074Prerequisite: prerequisiteRoleNames,
    bootstrap074PrerequisiteMode: true,
    bootstrap074PrerequisiteProviderRoleName: "postgres",
  });
  assert.deepEqual(prerequisiteResult.pending, [prerequisite.id]);
  assert.equal(prerequisiteResult.bootstrap074RestartRequired, true);
  assert.equal(prerequisiteResult.bootstrap074PrerequisiteMigrationId, prerequisite.id);
  const prerequisiteSqlIndex = prerequisiteClient.calls.indexOf("select prerequisite_073a");
  const prerequisiteCommitIndex = prerequisiteClient.calls.indexOf("commit");
  assert.equal(prerequisiteClient.calls.some((sql) => sql.startsWith("set local role")), false);
  assert.equal(prerequisiteClient.calls.some((sql) => sql.includes("bootstrap_role_catalog_v4")), false);
  assert.ok(prerequisiteSqlIndex < prerequisiteCommitIndex);
  assert.equal(prerequisiteClient.calls.some((sql) => sql === "select 74"), false);
  assert.equal(prerequisiteClient.calls.some((sql) => sql.includes("bootstrap_object_catalog_v7")), false);
  assert.equal(prerequisiteClient.calls.some((sql) => sql.includes("bootstrap_event_trigger_catalog_v2")), false);
  assert.equal(prerequisiteClient.calls.some((sql) => sql.startsWith("insert into ai_content_bootstrap_state")), false);

  const missingIdentityClient = makeClient([]);
  const missingIdentityOriginalQuery = missingIdentityClient.query.bind(missingIdentityClient);
  missingIdentityClient.query = async (sql, parameters) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.includes("legacy_trigger_search_path_provider_owner_v1")) {
      missingIdentityClient.calls.push(normalized);
      return { rows: [{
        owner_role_name: "postgres", function_count: 18, owner_count: 1,
        session_user_name: "postgres", current_user_name: "postgres",
      }] };
    }
    return missingIdentityOriginalQuery(sql, parameters);
  };
  await assert.rejects(
    migrationRunner.runMigrationsWithClient({
      client: missingIdentityClient,
      migrations: [prerequisite, migration074],
      bootstrap074Prerequisite: prerequisiteRoleNames,
      bootstrap074PrerequisiteMode: true,
      bootstrap074PrerequisiteProviderRoleName: "postgres",
    }),
    /legacy_trigger_search_path_provider_owner_invalid/,
  );
  assert.equal(missingIdentityClient.calls.some((sql) => mutationPattern.test(sql)), false);

  for (const invalidOwnerEvidence of [{
    owner_role_name: "content_rogue", function_count: 19, owner_count: 1,
    session_user_name: "postgres", current_user_name: "postgres",
  }, {
    owner_role_name: "postgres", function_count: 19, owner_count: 1,
    session_user_name: "content_migration", current_user_name: "content_migration",
  }]) {
    const unsafeClient = makeClient([]);
    const unsafeOriginalQuery = unsafeClient.query.bind(unsafeClient);
    unsafeClient.query = async (sql, parameters) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized.includes("legacy_trigger_search_path_provider_owner_v1")) {
        unsafeClient.calls.push(normalized);
        return { rows: [invalidOwnerEvidence] };
      }
      return unsafeOriginalQuery(sql, parameters);
    };
    await assert.rejects(migrationRunner.runMigrationsWithClient({
      client: unsafeClient,
      migrations: [prerequisite, migration074],
      bootstrap074Prerequisite: prerequisiteRoleNames,
      bootstrap074PrerequisiteMode: true,
      bootstrap074PrerequisiteProviderRoleName: "postgres",
    }), /legacy_trigger_search_path_provider_owner_invalid/);
    assert.equal(unsafeClient.calls.some((sql) => mutationPattern.test(sql)), false);
  }

  const migration075 = { id: "075_ai_content_three_format_cutover.sql", checksum: "8".repeat(64), sql: "select 75" };
  const presentClient = makeClient([{ id: migration074.id, checksum: migration074.checksum }]);
  await assert.rejects(
    migrationRunner.runMigrationsWithClient({ client: presentClient, migrations: [migration074, migration075], bootstrap074: {}, bootstrap074Prerequisite: prerequisiteRoleNames }),
    /bootstrap_075_present_forbidden/,
  );
  assert.equal(presentClient.calls.some((sql) => mutationPattern.test(sql)), false);
});

const migrations = [
  { id: "001_initial.sql", checksum: "first", sql: "create table first_table();" },
  { id: "002_second.sql", checksum: "second", sql: "create table second_table();" },
];

const legacyInstagramDeliveryChecksum =
  "7e45bc297cf35128368700b49f34974690d699198e465ecfb608ac9922cb1882";
const currentInstagramDeliveryChecksum =
  "db4ef9edcccd8f882ade789b1a2b0bc595c7f5c101fb3c9337b02576928e4a05";

const loadInstagramDeliveryMigrations = async () => {
  const loaded = await migrationRunner.loadMigrations();
  const instagramMigrations = loaded.filter((migration) =>
    [
      "014_instagram_delivery_formats.sql",
      "015_delivery_format_legacy_channels.sql",
    ].includes(migration.id),
  );
  assert.equal(instagramMigrations[0]?.checksum, currentInstagramDeliveryChecksum);
  return instagramMigrations;
};

const createRecordingClient = ({ failMigration = false } = {}) => {
  const calls = [];
  return {
    calls,
    async query(sql, parameters = []) {
      const normalizedSql = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: normalizedSql, parameters });

      if (normalizedSql === "select id, checksum from schema_migrations order by id asc") {
        return { rows: [] };
      }
      if (normalizedSql.includes("to_regclass('public.workspaces')")) {
        return { rows: [{ relation: null }] };
      }
      if (normalizedSql === "select migration_body" && failMigration) {
        throw new Error("migration_execution_failed");
      }
      return { rows: [], rowCount: 0 };
    },
  };
};

test("migration client uses verified TLS without sslmode conflicts", () => {
  const config = migrationRunner.resolveMigrationClientConfig(
    "postgresql://user:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require",
  );

  assert.doesNotMatch(config.connectionString, /sslmode=/);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("migration client includes a provided CA in verified TLS", () => {
  const config = migrationRunner.resolveMigrationClientConfig(
    "postgresql://user:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require",
    { caCertificate: "test-ca" },
  );

  assert.deepEqual(config.ssl, {
    rejectUnauthorized: true,
    ca: "test-ca",
  });
});

test("migration client uses verified TLS for direct Supabase database hosts", () => {
  const config = migrationRunner.resolveMigrationClientConfig(
    "postgresql://postgres:secret@db.project.supabase.co:5432/postgres?sslmode=require",
  );

  assert.doesNotMatch(config.connectionString, /sslmode=/);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("migration client keeps local PostgreSQL free of TLS overrides", () => {
  const connectionString = "postgresql://user:password@127.0.0.1:5432/brand_pilot";

  assert.deepEqual(
    migrationRunner.resolveMigrationClientConfig(connectionString),
    { connectionString },
  );
});

test("migration client strips duplicate case-insensitive SSL query overrides before pg parses them", () => {
  const config = migrationRunner.resolveMigrationClientConfig(
    "postgresql://postgres:secret@db.project.supabase.co:5432/postgres"
      + "?ssl=0&SSL=no-verify&ssl=no-verify&sslmode=disable&SSLMODE=no-verify"
      + "&sslcert=ignored&sslkey=ignored&sslrootcert=ignored"
      + "&sslnegotiation=direct&uselibpqcompat=true",
    { caCertificate: "test-ca" },
  );
  const overrideKeys = [...new URL(config.connectionString).searchParams.keys()]
    .filter((key) => key.toLowerCase().startsWith("ssl")
      || key.toLowerCase() === "uselibpqcompat");

  assert.deepEqual(overrideKeys, []);
  const client = new Client(config);
  assert.deepEqual(client.connectionParameters.ssl, {
    rejectUnauthorized: true,
    ca: "test-ca",
  });
});

test("migration client does not classify lookalike domains as Supabase", () => {
  const connectionString = "postgresql://user:secret@db.project.supabase.co.evil.example/postgres?ssl=no-verify";

  assert.deepEqual(
    migrationRunner.resolveMigrationClientConfig(connectionString),
    { connectionString },
  );
});

test("legacy 014 fixture has the exact allowlisted checksum", async () => {
  const fixture = await readFile(
    "scripts/fixtures/014_instagram_delivery_formats.legacy.sql",
  );
  assert.equal(
    createHash("sha256").update(fixture).digest("hex"),
    legacyInstagramDeliveryChecksum,
  );
});

test("Wiki refresh includes owned sources regardless of their enabled state", async () => {
  const sql = await readFile(
    "db/migrations/023_wiki_include_disabled_owned_sources.sql",
    "utf8",
  );

  assert.match(sql, /source\.source_type = 'owned'/);
  assert.doesNotMatch(sql, /source\.enabled/);
});

test("Wiki refresh indexes the latest snapshot for every owned-site content page", async () => {
  const sql = await readFile(
    "db/migrations/024_wiki_index_all_owned_pages.sql",
    "utf8",
  );

  assert.match(sql, /from source_content_items item/);
  assert.match(sql, /latest\.source_content_item_id = item\.id/);
  assert.doesNotMatch(sql, /source\.enabled/);
});

test("DM conversation operations migration defines the operational schema in one transaction", async () => {
  const sql = await readFile(
    "db/migrations/025_dm_conversation_operations.sql",
    "utf8",
  );

  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /alter table instagram_dm_conversations/);
  assert.match(sql, /automation_status text not null default 'active'/);
  assert.match(sql, /attention_status text not null default 'none'/);
  assert.match(sql, /unread_count integer not null default 0/);
  assert.match(sql, /check \(automation_status in \('active', 'paused'\)\)/);
  assert.match(sql, /check \(attention_status in \('none', 'open', 'resolved'\)\)/);
  assert.match(sql, /check \(unread_count >= 0\)/);
  assert.match(sql, /create table dm_turns/);
  assert.match(sql, /create table dm_attention_items/);
  assert.match(sql, /create table dm_delivery_attempts/);
  assert.match(sql, /alter table instagram_dm_messages[\s\S]*add column turn_id/);
  assert.match(sql, /add column decision/);
  assert.match(sql, /add column reason_code/);
  assert.match(sql, /add column delivery_attempt_id/);
});

test("DM conversation operations migration enforces lifecycle, dedupe, and JSON constraints", async () => {
  const sql = await readFile(
    "db/migrations/025_dm_conversation_operations.sql",
    "utf8",
  );

  assert.match(sql, /check \(status in \('collecting', 'queued', 'processing', 'completed', 'skipped'\)\)/);
  assert.match(sql, /create unique index dm_turns_collecting_conversation_unique[\s\S]*where status = 'collecting'/);
  assert.match(sql, /check \(attention_type in \('restricted_action', 'complaint', 'knowledge_gap', 'delivery_unknown', 'processing_error'\)\)/);
  assert.match(sql, /check \(reason_code in \('direct_faq', 'wiki_answer', 'restricted_action', 'complaint', 'knowledge_gap', 'low_confidence', 'processing_error', 'system_event'\)\)/);
  assert.match(sql, /check \(jsonb_typeof\(detail_json\) = 'object'\)/);
  assert.match(sql, /job_id uuid not null/);
  assert.match(sql, /constraint dm_delivery_attempts_job_unique unique \(job_id\)/);
  assert.match(sql, /create unique index dm_delivery_attempts_dedupe_unique[\s\S]*on dm_delivery_attempts\(dedupe_key\)/);
  assert.match(sql, /check \(status in \('prepared', 'sending', 'sent', 'unknown', 'failed'\)\)/);
});

test("DM conversation operations migration enforces composite tenant ownership", async () => {
  const sql = await readFile(
    "db/migrations/025_dm_conversation_operations.sql",
    "utf8",
  );

  assert.match(sql, /constraint instagram_dm_conversations_tenant_identity_unique\s+unique \(id, workspace_id, brand_id\)/);
  assert.match(sql, /constraint instagram_dm_messages_tenant_identity_unique\s+unique \(id, workspace_id, brand_id, conversation_id\)/);
  assert.match(sql, /constraint jobs_tenant_identity_unique\s+unique \(id, workspace_id, brand_id\)/);
  assert.match(sql, /constraint instagram_dm_messages_conversation_ownership_fk\s+foreign key \(conversation_id, workspace_id, brand_id\)\s+references instagram_dm_conversations\(id, workspace_id, brand_id\)/);
  assert.match(sql, /constraint dm_turns_tenant_identity_unique\s+unique \(id, workspace_id, brand_id, conversation_id\)/);
  assert.match(sql, /constraint dm_turns_conversation_ownership_fk\s+foreign key \(conversation_id, workspace_id, brand_id\)\s+references instagram_dm_conversations\(id, workspace_id, brand_id\)/);
  assert.match(sql, /constraint dm_attention_items_conversation_ownership_fk\s+foreign key \(conversation_id, workspace_id, brand_id\)\s+references instagram_dm_conversations\(id, workspace_id, brand_id\)/);
  assert.match(sql, /constraint dm_attention_items_trigger_message_ownership_fk\s+foreign key \(trigger_message_id, workspace_id, brand_id, conversation_id\)\s+references instagram_dm_messages\(id, workspace_id, brand_id, conversation_id\)/);
  assert.match(sql, /constraint dm_attention_items_trigger_turn_ownership_fk\s+foreign key \(trigger_turn_id, workspace_id, brand_id, conversation_id\)\s+references dm_turns\(id, workspace_id, brand_id, conversation_id\)/);
  assert.match(sql, /constraint dm_delivery_attempts_conversation_ownership_fk\s+foreign key \(conversation_id, workspace_id, brand_id\)\s+references instagram_dm_conversations\(id, workspace_id, brand_id\)/);
  assert.match(sql, /constraint dm_delivery_attempts_tenant_identity_unique\s+unique \(id, workspace_id, brand_id, conversation_id\)/);
  assert.match(sql, /constraint dm_delivery_attempts_job_ownership_fk\s+foreign key \(job_id, workspace_id, brand_id\)\s+references jobs\(id, workspace_id, brand_id\)\s+on delete restrict/);
  assert.match(sql, /constraint instagram_dm_messages_turn_ownership_fk\s+foreign key \(turn_id, workspace_id, brand_id, conversation_id\)\s+references dm_turns\(id, workspace_id, brand_id, conversation_id\)/);
  assert.match(sql, /constraint instagram_dm_messages_delivery_ownership_fk\s+foreign key \(delivery_attempt_id, workspace_id, brand_id, conversation_id\)\s+references dm_delivery_attempts\(id, workspace_id, brand_id, conversation_id\)/);
});

test("DM delivery attempts survive job cleanup", async () => {
  const sql = await readFile(
    "db/migrations/025_dm_conversation_operations.sql",
    "utf8",
  );

  assert.doesNotMatch(sql, /job_id uuid not null references jobs\(id\) on delete cascade/);
  assert.match(sql, /dm_delivery_attempts_job_ownership_fk[\s\S]*references jobs\(id, workspace_id, brand_id\)\s+on delete restrict/);
});

test("DM conversation operations migration preserves job types and limits updated_at triggers", async () => {
  const sql = await readFile(
    "db/migrations/025_dm_conversation_operations.sql",
    "utf8",
  );
  const expectedJobTypes = [
    "daily_generation_enqueue", "source_crawl", "topic_select", "master_draft_generate",
    "channel_output_generate", "auto_approval_check", "instagram_feed_render",
    "instagram_story_render", "instagram_reel_render", "threads_text_render",
    "artifact_upload", "instagram_publish", "threads_publish", "token_health_check",
    "storage_cleanup", "wiki_refresh", "instagram_dm_reply", "instagram_dm_profile_refresh",
  ];

  for (const jobType of expectedJobTypes) {
    assert.match(sql, new RegExp(`'${jobType}'`));
  }
  assert.match(sql, /create trigger dm_turns_set_updated_at\s+before update on dm_turns/);
  assert.match(sql, /create trigger dm_attention_items_set_updated_at\s+before update on dm_attention_items/);
  assert.match(sql, /create trigger dm_delivery_attempts_set_updated_at\s+before update on dm_delivery_attempts/);
  assert.doesNotMatch(sql, /instagram_dm_messages_set_updated_at/);
});

test("admin API foundation migration adds external actors and idempotent mutations", async () => {
  const sql = await readFile(
    "db/migrations/045_admin_api_foundation.sql",
    "utf8",
  );

  assert.match(sql, /alter table audit_events[\s\S]*add column actor_external_id text null/i);
  assert.match(sql, /audit_events_actor_type_check[\s\S]*'admin'/i);
  assert.match(sql, /create table admin_idempotency_keys/i);
  assert.match(sql, /request_hash text not null/i);
  assert.match(sql, /response_json jsonb not null/i);
  assert.match(sql, /unique \(actor_external_id, idempotency_key\)/i);
});

test("versioned Wiki migration expands knowledge entries with conditional item contracts", async () => {
  const sql = await readFile(
    "db/migrations/026_wiki_versions_and_knowledge_items.sql",
    "utf8",
  );

  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /add column entry_type text not null default 'faq'/);
  assert.match(sql, /add column title text/);
  assert.match(sql, /add column content text/);
  assert.match(sql, /add column aliases text\[\] not null default '\{\}'/);
  assert.match(sql, /add column structured_data jsonb not null default '\{\}'::jsonb/);
  assert.match(sql, /add column direct_reply_enabled boolean not null default true/);
  assert.match(sql, /set title = question,\s*content = answer/);
  assert.match(sql, /drop not null/);
  assert.match(sql, /entry_type in \('faq', 'product', 'policy'\)/);
  assert.match(sql, /entry_type <> 'faq'[\s\S]*question is not null[\s\S]*answer is not null/);
  assert.match(sql, /entry_type not in \('product', 'policy'\)[\s\S]*title is not null[\s\S]*content is not null/);
  assert.match(sql, /normalized_question is not null[\s\S]*length\(trim\(normalized_question\)\) > 0/);
  assert.match(sql, /jsonb_typeof\(structured_data\) = 'object'/);
});

test("versioned Wiki migration creates build tables and version-scoped documents", async () => {
  const sql = await readFile(
    "db/migrations/026_wiki_versions_and_knowledge_items.sql",
    "utf8",
  );

  assert.match(sql, /create table wiki_versions/);
  assert.match(sql, /status in \('building', 'active', 'failed', 'superseded'\)/);
  assert.match(sql, /source_count integer not null default 0/);
  assert.match(sql, /document_count integer not null default 0/);
  assert.match(sql, /chunk_count integer not null default 0/);
  assert.match(sql, /prompt_version text/);
  assert.match(sql, /embedding_model text/);
  assert.match(sql, /embedding_version text/);
  assert.match(sql, /create table wiki_build_items/);
  assert.match(sql, /status in \('pending', 'processing', 'succeeded', 'failed'\)/);
  assert.match(sql, /add column wiki_version_id uuid/);
  assert.match(sql, /constraint wiki_documents_version_ownership_fk\s+foreign key \(wiki_version_id, workspace_id, brand_id\)\s+references wiki_versions\(id, workspace_id, brand_id\) on delete cascade/);
  assert.match(sql, /add column normalized_json jsonb not null default '\{\}'::jsonb/);
  assert.match(sql, /add column source_url text/);
  assert.match(sql, /source_kind in \('faq', 'product', 'policy', 'owned_snapshot'\)/);
  assert.match(sql, /insert into wiki_versions[\s\S]*'active'/);
  assert.match(sql, /count\(distinct document\.id\)::integer,[\s\S]*count\(distinct document\.id\)::integer,[\s\S]*count\(distinct chunk\.id\)::integer/);
  assert.match(sql, /update wiki_documents document[\s\S]*set wiki_version_id = version\.id/);
  assert.match(sql, /drop index if exists wiki_documents_active_faq_unique/);
  assert.match(sql, /drop index if exists wiki_documents_active_snapshot_unique/);
  assert.match(sql, /create unique index wiki_documents_version_knowledge_entry_unique[\s\S]*wiki_version_id, knowledge_entry_id/);
  assert.match(sql, /create unique index wiki_documents_version_snapshot_unique[\s\S]*wiki_version_id, source_snapshot_id/);
});

test("Wiki activation validates completed items and preserves the current active version on failure", async () => {
  const sql = await readFile(
    "db/migrations/026_wiki_versions_and_knowledge_items.sql",
    "utf8",
  );
  const activation = sql.slice(sql.indexOf("create or replace function activate_wiki_version"));

  assert.match(activation, /returns boolean/);
  assert.match(activation, /item\.status <> 'succeeded'/);
  assert.match(activation, /from wiki_documents document/);
  assert.match(activation, /join wiki_chunks chunk/);
  assert.match(activation, /chunk\.enabled/);
  assert.match(activation, /set status = 'failed'/);
  assert.match(activation, /return false/);
  assert.match(activation, /set status = 'superseded'/);
  assert.match(activation, /set status = 'active'/);
  assert.match(activation, /set is_active = false/);
  assert.match(activation, /set is_active = true/);
  assert.ok(
    activation.indexOf("set status = 'failed'") < activation.indexOf("set status = 'superseded'"),
    "validation failure must be handled before the current active version is superseded",
  );
});

test("Wiki search v2 exposes absolute and ranking scores from only the active enabled Wiki", async () => {
  const sql = await readFile("db/migrations/027_wiki_search_v2.sql", "utf8");

  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /create or replace function search_brand_wiki_v2/);
  assert.match(sql, /chunk_id uuid/);
  assert.match(sql, /wiki_document_id uuid/);
  assert.match(sql, /knowledge_entry_id uuid/);
  assert.match(sql, /source_kind text/);
  assert.match(sql, /title text/);
  assert.match(sql, /content text/);
  assert.match(sql, /direct_answer text/);
  assert.match(sql, /cosine_similarity double precision/);
  assert.match(sql, /keyword_match double precision/);
  assert.match(sql, /rrf_score double precision/);
  assert.match(sql, /chunk\.embedding <=> p_query_embedding/);
  assert.match(sql, /1 - distance/);
  assert.match(sql, /version\.status = 'active'/);
  assert.match(sql, /chunk\.enabled/);
});

test("compiled Wiki migrations define a brand-scoped core and pgvector boundary", async () => {
  const core = await readFile("db/migrations/032_compounding_wiki_core.sql", "utf8");
  const vector = await readFile("db/migrations/033_compounding_wiki_pgvector.sql", "utf8");

  assert.match(core, /add column build_stage text/);
  assert.match(core, /status in \('building', 'ready', 'active', 'failed', 'superseded'\)/);
  for (const table of [
    "wiki_build_requests", "wiki_source_units", "wiki_pages", "wiki_page_sources",
    "wiki_page_links", "wiki_page_chunks", "wiki_compilation_items",
    "wiki_retrieval_runs", "wiki_maintenance_runs", "wiki_issues",
  ]) {
    assert.match(core, new RegExp(`create table ${table}`));
  }
  assert.doesNotMatch(core, /\bvector\s*\(/);
  assert.doesNotMatch(core, /\bwiki_engine\b|\blegacy_rag\b|\bcompiled_wiki\b/);

  assert.match(vector, /^-- requires: pgvector/);
  assert.match(vector, /add column embedding vector\(1536\)/);
  assert.match(vector, /create or replace function search_brand_compiled_wiki/);
  assert.match(vector, /create or replace function activate_compiled_wiki_version/);
  assert.match(vector, /jsonb_array_elements_text\(section -> 'sourceUnitIds'\)/);
  assert.match(vector, /source\.wiki_source_unit_id::text = listed_source\.source_unit_id/);
  assert.match(vector, /wiki_compilation_items_missing/);
  assert.doesNotMatch(vector, /\bwiki_engine\b|\blegacy_rag\b/);
});

test("070 adds bounded lexical compiled Wiki retrieval without a query vector", async () => {
  const sql = await readFile(
    "db/migrations/070_remove_embedding_runtime.sql",
    "utf8",
  );

  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
  assert.match(
    sql,
    /create or replace function search_brand_wiki_lexical\(\s*p_workspace_id uuid,\s*p_brand_id uuid,\s*p_query text,\s*p_limit integer default 12,\s*p_is_offering_question boolean default false,\s*p_is_product_question boolean default false,\s*p_is_offering_location_question boolean default false\s*\)/i,
  );
  for (const field of [
    "page_chunk_id uuid",
    "wiki_page_id uuid",
    "page_type text",
    "title text",
    "content text",
    "source_link_ids uuid[]",
    "cosine_similarity double precision",
    "keyword_match double precision",
    "rrf_score double precision",
  ]) {
    assert.match(sql, new RegExp(field.replace("[]", "\\[\\]"), "i"));
  }
  assert.match(sql, /websearch_to_tsquery\('simple'/i);
  assert.match(sql, /chunk\.search_vector/i);
  assert.match(sql, /version\.status = 'active'/i);
  assert.match(sql, /chunk\.enabled/i);
  assert.match(sql, /normalized_phrase_match/i);
  assert.match(sql, /token_overlap/i);
  assert.match(sql, /title_match/i);
  assert.match(sql, /stable_key_match/i);
  assert.match(sql, /alias_match/i);
  assert.match(sql, /keyword_array_match/i);
  assert.match(
    sql,
    /limit greatest\(1, least\(coalesce\(p_limit, 12\), 12\)\)/i,
  );
  assert.doesNotMatch(sql, /p_query_embedding/i);
  assert.doesNotMatch(sql, /<=>/);
});

test("070 preserves trusted offering filtering and product/location priorities before lexical rank", async () => {
  const sql = await readFile(
    "db/migrations/070_remove_embedding_runtime.sql",
    "utf8",
  );

  assert.match(
    sql,
    /not coalesce\(p_is_offering_question,\s*false\)[\s\S]*page\.page_type in \('product',\s*'service'\)[\s\S]*source\.source_kind in \('product',\s*'product_service',\s*'service'\)/i,
  );
  assert.match(
    sql,
    /source\.source_kind = 'owned_snapshot'[\s\S]*source\.source_url is not null[\s\S]*lower\(source\.source_url\) !~\s*'\/\(article\|articles\|blog\|content\|insight\|insights\|news\|resource\|resources\)/i,
  );

  const ordering = sql.slice(sql.lastIndexOf("order by"));
  const productPriority = ordering.indexOf("p_is_product_question");
  const locationPriority = ordering.indexOf("p_is_offering_location_question");
  const lexicalPriority = ordering.indexOf("lexical_score desc");
  assert.ok(productPriority >= 0, "product intent priority must be present");
  assert.ok(locationPriority > productPriority, "location priority must follow product priority");
  assert.ok(lexicalPriority > locationPriority, "lexical relevance must follow intent priorities");
});

test("070 returns no lexical Wiki chunks for blank or zero-signal queries", async () => {
  const sql = await readFile(
    "db/migrations/070_remove_embedding_runtime.sql",
    "utf8",
  );

  assert.match(
    sql,
    /query_input as \([\s\S]*where regexp_replace\(coalesce\(p_query, ''\), '\[\[:space:\]\]\+', '', 'g'\) <> ''[\s\S]*\), query_tokens as/i,
  );
  assert.match(
    sql,
    /from ranked\s+where lexical_score > 0\s+order by/i,
  );
});

test("070 makes enabled chunks sufficient for compiled Wiki activation and resumes validation", async () => {
  const sql = await readFile(
    "db/migrations/070_remove_embedding_runtime.sql",
    "utf8",
  );
  const activation = sql.slice(
    sql.indexOf("create or replace function activate_compiled_wiki_version"),
  );

  assert.match(
    sql,
    /set build_stage = 'validating'[\s\S]*status = 'building'[\s\S]*build_stage = 'embedding'/i,
  );
  assert.match(activation, /chunk\.enabled/i);
  assert.doesNotMatch(activation, /chunk\.embedding/i);
});

test("070 preserves exact FAQ and vector rollback surfaces", async () => {
  const sql = await readFile(
    "db/migrations/070_remove_embedding_runtime.sql",
    "utf8",
  );

  assert.doesNotMatch(sql, /create or replace function find_direct_faq_exact/i);
  assert.doesNotMatch(sql, /drop\s+function\s+(?:if exists\s+)?search_brand_compiled_wiki/i);
  assert.doesNotMatch(sql, /drop\s+(?:column\s+)?embedding/i);
  assert.doesNotMatch(sql, /update\s+wiki_page_chunks[\s\S]*embedding\s*=/i);
});

test("exact direct FAQ lookup returns one unique match or a knowledge conflict marker", async () => {
  const sql = await readFile("db/migrations/027_wiki_search_v2.sql", "utf8");
  const exactLookup = sql.slice(sql.indexOf("create or replace function find_direct_faq_exact"));

  assert.match(exactLookup, /entry\.entry_type = 'faq'/);
  assert.match(exactLookup, /entry\.enabled/);
  assert.match(exactLookup, /entry\.direct_reply_enabled/);
  assert.match(exactLookup, /entry\.normalized_question/);
  assert.match(exactLookup, /unnest\(entry\.keywords\)/);
  assert.match(exactLookup, /unnest\(entry\.aliases\)/);
  assert.match(exactLookup, /count\(\*\)/);
  assert.doesNotMatch(exactLookup, /min\(id\)/, "PostgreSQL does not provide min(uuid)");
  assert.match(exactLookup, /array_agg\(id order by id::text\)/);
  assert.match(exactLookup, /when match_count = 1 then/);
  assert.match(exactLookup, /when match_count > 1 then 'knowledge_conflict'/);
});

test("migration runner applies only migrations absent from history", () => {
  const plan = buildMigrationPlan(migrations, [{ id: "001_initial.sql", checksum: "first" }]);
  assert.deepEqual(plan.pending.map((migration) => migration.id), ["002_second.sql"]);
});

test("migration runner rejects history whose checksum differs from disk", () => {
  assert.throws(
    () => buildMigrationPlan(migrations, [{ id: "001_initial.sql", checksum: "changed" }]),
    /migration_checksum_mismatch:001_initial\.sql/,
  );
});

test("migration runner rejects an applied migration with an empty checksum", () => {
  assert.throws(
    () => buildMigrationPlan(migrations, [{ id: "001_initial.sql", checksum: "" }]),
    /migration_checksum_mismatch:001_initial\.sql/,
  );
});

test("migration runner accepts the exact legacy 014 checksum without rewriting history", async () => {
  const instagramDeliveryMigrations = await loadInstagramDeliveryMigrations();
  const applied = [
    {
      id: "014_instagram_delivery_formats.sql",
      checksum: legacyInstagramDeliveryChecksum,
    },
  ];

  const plan = buildMigrationPlan(instagramDeliveryMigrations, applied);

  assert.deepEqual(plan.pending.map((migration) => migration.id), [
    "015_delivery_format_legacy_channels.sql",
  ]);
  assert.equal(applied[0].checksum, legacyInstagramDeliveryChecksum);
});

test("migration runner rejects an unknown checksum mismatch for 014", async () => {
  const instagramDeliveryMigrations = await loadInstagramDeliveryMigrations();
  assert.throws(
    () =>
      buildMigrationPlan(instagramDeliveryMigrations, [
        {
          id: "014_instagram_delivery_formats.sql",
          checksum: "unknown-014-checksum",
        },
      ]),
    /migration_checksum_mismatch:014_instagram_delivery_formats\.sql/,
  );
});

test("migration runner accepts the exact current checksum for 014", async () => {
  const instagramDeliveryMigrations = await loadInstagramDeliveryMigrations();
  const plan = buildMigrationPlan(instagramDeliveryMigrations, [
    {
      id: "014_instagram_delivery_formats.sql",
      checksum: instagramDeliveryMigrations[0].checksum,
    },
  ]);

  assert.deepEqual(plan.pending.map((migration) => migration.id), [
    "015_delivery_format_legacy_channels.sql",
  ]);
});

test("legacy 014 compatibility does not permit a different current file checksum", async () => {
  const instagramDeliveryMigrations = await loadInstagramDeliveryMigrations();
  assert.throws(
    () =>
      buildMigrationPlan(
        [
          {
            ...instagramDeliveryMigrations[0],
            checksum: "unexpected-new-014-checksum",
          },
          instagramDeliveryMigrations[1],
        ],
        [
          {
            id: "014_instagram_delivery_formats.sql",
            checksum: legacyInstagramDeliveryChecksum,
          },
        ],
      ),
    /migration_checksum_mismatch:014_instagram_delivery_formats\.sql/,
  );
});

test("unwrapFileTransaction removes only the outer BEGIN and COMMIT lines", () => {
  const sql = [
    "-- migration header",
    "",
    "  BEGIN;  ",
    "select migration_body;",
    "-- migration body comment",
    " COMMIT;",
    "-- migration footer",
  ].join("\n");

  const unwrapped = migrationRunner.unwrapFileTransaction(sql);

  assert.match(unwrapped, /^-- migration header/);
  assert.match(unwrapped, /select migration_body;/);
  assert.match(unwrapped, /-- migration body comment/);
  assert.match(unwrapped, /-- migration footer$/);
  assert.doesNotMatch(unwrapped, /^\s*(?:begin|commit)\s*;\s*$/im);
});

test("unwrapFileTransaction rejects nested and unwrapped transaction control", () => {
  for (const sql of [
    "BEGIN;\nselect 1;\nCOMMIT;\nROLLBACK;\nCOMMIT;",
    "select 1;\nROLLBACK;",
    "select 1;\nCOMMIT; -- transaction control remains forbidden",
  ]) {
    assert.throws(
      () => migrationRunner.unwrapFileTransaction(sql),
      (error) => error.code === "migration_nested_transaction_control",
    );
  }
});

test("unwrapFileTransaction rejects top-level COMMIT after another statement on the same line", () => {
  assert.throws(
    () => migrationRunner.unwrapFileTransaction(
      "BEGIN;\nselect 1; COMMIT;\nCOMMIT;",
    ),
    (error) => error.code === "migration_nested_transaction_control",
  );
});

test("unwrapFileTransaction rejects top-level COMMIT after a block comment", () => {
  assert.throws(
    () => migrationRunner.unwrapFileTransaction(
      "BEGIN;\n/* transaction guard */ COMMIT;\nCOMMIT;",
    ),
    (error) => error.code === "migration_nested_transaction_control",
  );
});

test("unwrapFileTransaction ignores transaction words inside quoted values, identifiers, comments, and dollar quotes", () => {
  const sql = [
    "select 'BEGIN; COMMIT; ROLLBACK;', \"COMMIT;\";",
    "-- ROLLBACK;",
    "/* BEGIN; COMMIT; */",
    "do $migration_body$",
    "begin",
    "  perform 'ROLLBACK;';",
    "end;",
    "$migration_body$;",
  ].join("\n");

  assert.equal(migrationRunner.unwrapFileTransaction(sql), sql);
});

test("unwrapFileTransaction rejects PostgreSQL transaction-control variants", () => {
  for (const statement of [
    "START TRANSACTION;",
    "PREPARE TRANSACTION 'migration';",
    "COMMIT AND CHAIN;",
    "END;",
    "ABORT;",
  ]) {
    assert.throws(
      () => migrationRunner.unwrapFileTransaction(`select 1;\n${statement}`),
      (error) => error.code === "migration_nested_transaction_control",
      statement,
    );
  }
});

test("unwrapFileTransaction treats backslashes as ordinary characters in standard strings", () => {
  for (const sql of [
    String.raw`select '\'; COMMIT;`,
    String.raw`select '\\'; COMMIT;`,
  ]) {
    assert.throws(
      () => migrationRunner.unwrapFileTransaction(sql),
      (error) => error.code === "migration_nested_transaction_control",
    );
  }
});

test("unwrapFileTransaction applies backslash escapes only to PostgreSQL E strings", () => {
  for (const prefix of ["E", "e"]) {
    const sql = String.raw`select ${prefix}'escaped quote: \'; COMMIT;';`;
    assert.equal(migrationRunner.unwrapFileTransaction(sql), sql);
  }
});

test("unwrapFileTransaction does not start a dollar quote inside an unquoted identifier", () => {
  assert.throws(
    () => migrationRunner.unwrapFileTransaction(
      "select foo$tag$; COMMIT;",
    ),
    (error) => error.code === "migration_nested_transaction_control",
  );
});

test("migration runner executes the unwrapped body, records history, then commits", async () => {
  const client = createRecordingClient();

  await migrationRunner.runMigrationsWithClient({
    client,
    migrations: [
      {
        id: "001_wrapped.sql",
        checksum: "checksum-of-raw-wrapped-sql",
        sql: "BEGIN;\nselect migration_body;\nCOMMIT;",
      },
    ],
  });

  const transactionCalls = client.calls.filter((call) =>
    ["begin", "select migration_body;", "commit"].includes(call.sql)
    || call.sql.startsWith("insert into schema_migrations"),
  );
  assert.deepEqual(transactionCalls, [
    { sql: "begin", parameters: [] },
    { sql: "select migration_body;", parameters: [] },
    {
      sql: "insert into schema_migrations (id, checksum) values ($1, $2)",
      parameters: ["001_wrapped.sql", "checksum-of-raw-wrapped-sql"],
    },
    { sql: "commit", parameters: [] },
  ]);
});

test("migration runner holds one advisory lock before history read and migration application", async () => {
  const client = createRecordingClient();

  await migrationRunner.runMigrationsWithClient({
    client,
    migrations: [
      {
        id: "001_lock_test.sql",
        checksum: "lock-test",
        sql: "select migration_body",
      },
    ],
  });

  const lockIndex = client.calls.findIndex((call) => call.sql.includes("pg_advisory_lock"));
  const historyIndex = client.calls.findIndex((call) =>
    call.sql.startsWith("select id, checksum from schema_migrations"),
  );
  const migrationIndex = client.calls.findIndex((call) => call.sql === "select migration_body");
  const unlockIndex = client.calls.findIndex((call) => call.sql.includes("pg_advisory_unlock"));

  assert.ok(lockIndex >= 0 && lockIndex < historyIndex);
  assert.ok(lockIndex < migrationIndex);
  assert.equal(unlockIndex, client.calls.length - 1);
  assert.deepEqual(client.calls[lockIndex].parameters, ["brand-pilot:schema-migrations:v1"]);
  assert.deepEqual(client.calls[unlockIndex].parameters, ["brand-pilot:schema-migrations:v1"]);
});

test("migration runner unlocks its advisory lock in finally when migration application fails", async () => {
  const client = createRecordingClient({ failMigration: true });

  await assert.rejects(
    () =>
      migrationRunner.runMigrationsWithClient({
        client,
        migrations: [
          {
            id: "001_lock_error.sql",
            checksum: "lock-error",
            sql: "select migration_body",
          },
        ],
      }),
    /migration_execution_failed/,
  );

  const rollbackIndex = client.calls.findIndex((call) => call.sql === "rollback");
  const unlockIndex = client.calls.findIndex((call) => call.sql.includes("pg_advisory_unlock"));
  assert.ok(rollbackIndex >= 0 && rollbackIndex < unlockIndex);
  assert.equal(unlockIndex, client.calls.length - 1);
});

test("support request repair migration restores the table when migration history is stale", async () => {
  const sql = await readFile("db/migrations/040_restore_support_requests.sql", "utf8");

  assert.match(sql, /^begin;/);
  assert.match(sql, /create table if not exists support_requests/);
  assert.match(sql, /support_requests_brand_created_idx/);
  assert.match(sql, /support_requests_set_updated_at/);
  assert.match(sql, /commit;\s*$/);
  assert.doesNotMatch(sql, /drop table/);
});

test("subject analysis migration defines cached analyses, archived images, and generation snapshots", async () => {
  const sql = await readFile(
    "db/migrations/047_ai_content_subject_analysis.sql",
    "utf8",
  );

  assert.match(sql, /^begin;/);
  assert.match(sql, /create table if not exists ai_content_subject_analyses/i);
  assert.match(sql, /create table if not exists ai_content_subject_images/i);
  assert.match(sql, /subject_type in \('product', 'service'\)/i);
  assert.match(
    sql,
    /status in \([\s\S]*'queued'[\s\S]*'extracting'[\s\S]*'researching'[\s\S]*'ready'[\s\S]*'partial'[\s\S]*'failed'[\s\S]*\)/i,
  );
  assert.match(sql, /where superseded_at is null/i);
  assert.match(sql, /lease_expires_at/i);
  assert.match(
    sql,
    /ai_content_subject_claim_idx[\s\S]*where status in \('queued', 'extracting', 'researching'\)/i,
  );
  assert.match(sql, /ai_content_subject_selected_image_fk/i);
  assert.match(sql, /subject_analysis_snapshot/i);
  assert.doesNotMatch(sql, /is_selected/i);
  assert.match(sql, /ai_content_subject_analyses_workspace_idx/i);
  assert.match(sql, /ai_content_subject_images_workspace_idx/i);
  assert.match(sql, /ai_content_subject_images_brand_workspace_idx/i);
  assert.match(sql, /ai_content_subject_images_analysis_ownership_idx/i);
  assert.match(
    sql,
    /drop constraint if exists ai_content_subject_selected_image_fk/i,
  );
  assert.match(
    sql,
    /drop constraint if exists ai_content_generations_subject_analysis_snapshot_object_check/i,
  );
  assert.match(
    sql,
    /drop trigger if exists ai_content_subject_analyses_set_updated_at/i,
  );
  assert.match(sql, /commit;\s*$/);
});

test("an installation applied through 064 has every later migration pending", async () => {
  const loaded = await migrationRunner.loadMigrations();
  const applied = loaded
    .filter((migration) => migration.id <= "064_reference_upload_finalization.sql")
    .map(({ id, checksum }) => ({ id, checksum }));

  const plan = buildMigrationPlan(loaded, applied);

  assert.deepEqual(
    plan.pending.map((migration) => migration.id),
    [
      "065_ai_content_attachment_upload_sessions.sql",
      "066_ai_content_analyzed_subject_orchestration.sql",
      "067_wiki_refresh_outbox.sql",
      "068_brand_core_one_draft.sql",
      "069_brand_analysis_one_open_workflow.sql",
      "070_remove_embedding_runtime.sql",
      "071_brand_intelligence_onboarding_worker_v2.sql",
      "072_faq_suggestion_worker.sql",
      "073_ai_content_generation_v2_render_pipeline.sql",
      "073a_legacy_trigger_function_search_path.sql",
      "074_ai_content_maintenance_write_fence.sql",
      "075_ai_content_three_format_cutover.sql",
    ],
  );
});
