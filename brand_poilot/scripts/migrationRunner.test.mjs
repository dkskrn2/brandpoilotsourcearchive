import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Client } from "pg";
import * as migrationRunner from "./migrationRunner.mjs";

const noProviderRoleCapabilities = Object.freeze({
  is_superuser: false,
  bypass_rls: false,
  can_create_db: false,
  can_create_role: false,
  can_replicate: false,
});

const { buildMigrationPlan } = migrationRunner;

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

function makeInterimFenceSecurityCatalog(schemaOwnerRoleName = "content_schema_owner") {
  const ownerAcl = [{ grantee: schemaOwnerRoleName, privilege: "EXECUTE", grantable: false }];
  return {
    contractVersion: "ai-content-074-fence-security-catalog.v1",
    functions: migrationRunner.providerEnforcementBundle.functions.map((identity) => ({
      identity,
      definitionSha256: createHash("sha256").update(identity).digest("hex"),
      ownerRoleName: schemaOwnerRoleName,
      securityDefiner: true,
      config: ["search_path=pg_catalog,public"],
      acl: ownerAcl,
    })),
    ordinaryTriggers: [],
    fenceCatalog: [],
    controlRelations: migrationRunner.providerEnforcementBundle.controlRelations.map((relationName) => {
      const extras = relationName === "ai_content_maintenance_state"
        ? [{ grantee: "content_application", privilege: "SELECT", grantable: false }]
        : ["ai_content_bootstrap_state", "ai_content_ddl_allowlist", "ai_content_write_fence_catalog"].includes(relationName)
          ? [{ grantee: "content_migration", privilege: "SELECT", grantable: false }] : [];
      return {
        relationName,
        ownerRoleName: schemaOwnerRoleName,
        acl: [
          ...["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]
            .map((privilege) => ({ grantee: schemaOwnerRoleName, privilege, grantable: false })),
          ...extras,
        ],
      };
    }),
  };
}

test("074 runner exposes no signing primitive or private-key input", () => {
  assert.equal(migrationRunner.signBootstrapRoleAuthorization, undefined);
  assert.equal(migrationRunner.signProviderEventTriggerAttestation, undefined);
  assert.equal("privateKey" in authorizationIdentity.verification, false);
  assert.equal("privateKey" in providerIdentity.verification, false);
});

test("074 canonical live role and object catalog hashes are order-independent and drift-sensitive", () => {
  const roles = [
    { role_name: "content_schema_owner", can_login: false, ...noProviderRoleCapabilities, inherit: true },
    { role_name: "content_migration", can_login: true, ...noProviderRoleCapabilities, inherit: false },
    { role_name: "content_application", can_login: true, ...noProviderRoleCapabilities, inherit: true },
    { role_name: "content_operator", can_login: true, ...noProviderRoleCapabilities, inherit: true },
    { role_name: "content_cleanup", can_login: true, ...noProviderRoleCapabilities, inherit: true },
  ];
  const membershipEdges = [{
    member_role_name: "content_migration", parent_role_name: "content_schema_owner",
    set_option: true, inherit_option: false, admin_option: false,
  }];
  const objects = [
    { schema_name: "public", relation_name: "ai_content_generations", relation_kind: "r", owner_role_name: "content_schema_owner", columns: [
      { ordinal_position: 2, column_name: "brand_id", type_identity: "uuid", not_null: true },
      { ordinal_position: 1, column_name: "id", type_identity: "uuid", not_null: true },
    ] },
    { schema_name: "public", relation_name: "topic_rows", relation_kind: "r", owner_role_name: "content_schema_owner", columns: [
      { ordinal_position: 1, column_name: "id", type_identity: "uuid", not_null: true },
    ] },
  ];

  const roleHash = migrationRunner.hashBootstrapRoleCatalog({ roles, membershipEdges });
  const objectHash = migrationRunner.hashBootstrapObjectCatalog(objects);
  assert.equal(migrationRunner.hashBootstrapRoleCatalog({ roles: roles.toReversed(), membershipEdges: membershipEdges.toReversed() }), roleHash);
  assert.equal(migrationRunner.hashBootstrapObjectCatalog(objects.toReversed().map((row) => ({ ...row, columns: row.columns.toReversed() }))), objectHash);
  assert.notEqual(migrationRunner.hashBootstrapRoleCatalog({ roles: roles.map((row) => row.role_name === "content_application" ? { ...row, bypass_rls: true } : row), membershipEdges }), roleHash);
  assert.notEqual(migrationRunner.hashBootstrapRoleCatalog({ roles: roles.map((row) => row.role_name === "content_operator" ? { ...row, can_create_role: true } : row), membershipEdges }), roleHash);
  assert.notEqual(migrationRunner.hashBootstrapRoleCatalog({ roles, membershipEdges: membershipEdges.map((edge) => ({ ...edge, inherit_option: true })) }), roleHash);
  assert.notEqual(migrationRunner.hashBootstrapObjectCatalog(objects.map((row) => row.relation_name === "topic_rows" ? { ...row, owner_role_name: "content_application" } : row)), objectHash);
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
    { role_name: names.schemaOwnerRoleName, can_login: false, ...noProviderRoleCapabilities, inherit: true },
    { role_name: names.applicationRoleName, can_login: true, ...noProviderRoleCapabilities, inherit: true },
    { role_name: names.operatorRoleName, can_login: true, ...noProviderRoleCapabilities, inherit: true },
    { role_name: names.migrationRoleName, can_login: true, ...noProviderRoleCapabilities, inherit: false },
    { role_name: names.cleanupRoleName, can_login: true, ...noProviderRoleCapabilities, inherit: true },
  ];
  const soleEdge = [{ member_role_name: names.migrationRoleName, parent_role_name: names.schemaOwnerRoleName,
    set_option: true, inherit_option: false, admin_option: false }];
  assert.doesNotThrow(() => migrationRunner.validateBootstrapRoleSafety({ roles: safe, membershipEdges: soleEdge }, names));
  for (const capability of ["can_create_db", "can_create_role", "can_replicate"]) {
    for (const roleName of safe.map((row) => row.role_name)) {
      const attacked = safe.map((row) => row.role_name === roleName ? { ...row, [capability]: true } : row);
      assert.throws(() => migrationRunner.validateBootstrapRoleSafety({ roles: attacked, membershipEdges: soleEdge }, names), /bootstrap_role_catalog_invalid/);
    }
  }
  const missingCapability = safe.map((row) => ({ ...row }));
  delete missingCapability[0].can_create_role;
  assert.throws(() => migrationRunner.validateBootstrapRoleSafety({ roles: missingCapability, membershipEdges: soleEdge }, names), /bootstrap_role_catalog_invalid/);
  for (const target of [names.schemaOwnerRoleName, names.operatorRoleName, names.migrationRoleName, names.cleanupRoleName, names.applicationRoleName]) {
    const attacked = [...soleEdge, { member_role_name: "rogue_login", parent_role_name: target,
      set_option: true, inherit_option: false, admin_option: false }];
    assert.throws(() => migrationRunner.validateBootstrapRoleSafety({ roles: safe, membershipEdges: attacked }, names), /bootstrap_role_catalog_invalid/);
  }
  for (const option of ["set_option", "inherit_option", "admin_option"]) {
    const wrongOptions = soleEdge.map((edge) => ({ ...edge, [option]: option !== "set_option" }));
    assert.throws(() => migrationRunner.validateBootstrapRoleSafety({ roles: safe, membershipEdges: wrongOptions }, names), /bootstrap_role_catalog_invalid/);
  }
  const indirectInbound = [...soleEdge,
    { member_role_name: "rogue_login", parent_role_name: "rogue_intermediate", set_option: true, inherit_option: false, admin_option: false },
    { member_role_name: "rogue_intermediate", parent_role_name: names.schemaOwnerRoleName, set_option: true, inherit_option: false, admin_option: false },
  ];
  assert.throws(() => migrationRunner.validateBootstrapRoleSafety({ roles: safe, membershipEdges: indirectInbound }, names), /bootstrap_role_catalog_invalid/);
  assert.throws(() => migrationRunner.validateBootstrapRoleSafety({ roles: [...safe, safe[0]], membershipEdges: soleEdge }, names), /bootstrap_role_catalog_invalid/);
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
    ordinaryTriggers: [{ relation_name: "ai_content_generations", trigger_name: "ai_content_fence_ai_content_generation_deadbeef", trigger_type: 31, function_identity: "public.enforce_ai_content_write_fence()", enabled: "A" }],
    fenceCatalog: [{ relation_name: "ai_content_generations", relation_class: "customer_execution", row_classifier: "whole_relation" }],
    controlRelations: [{ relation_name: "ai_content_maintenance_state", owner_role_name: "content_schema_owner", acl: [{ grantee: "content_application", privilege: "SELECT", grantable: false }] }],
  };
  const expected = migrationRunner.hashFenceSecurityCatalog(catalog);
  for (const attacked of [
    { ...catalog, functions: [{ ...catalog.functions[0], definition_sha256: "2".repeat(64) }] },
    { ...catalog, functions: [{ ...catalog.functions[0], owner_role_name: "content_application" }] },
    { ...catalog, functions: [{ ...catalog.functions[0], config: ["search_path=public"] }] },
    { ...catalog, functions: [{ ...catalog.functions[0], security_definer: false }] },
    { ...catalog, ordinaryTriggers: [{ ...catalog.ordinaryTriggers[0], enabled: "D" }] },
    { ...catalog, functions: [{ ...catalog.functions[0], acl: [] }] },
  ]) assert.notEqual(migrationRunner.hashFenceSecurityCatalog(attacked), expected);
});

test("074 full event-trigger catalog is order-independent and binds arbitrary preexisting triggers", () => {
  const rows = [
    { event_trigger_name: "supabase_guard", event_trigger_event: "ddl_command_end", event_trigger_tags: ["ALTER TABLE", "CREATE TABLE"], event_trigger_enabled: "enabled", event_trigger_owner: "postgres", event_trigger_function: "extensions.guard", event_trigger_function_sha256: "1".repeat(64) },
    { event_trigger_name: "audit_drop", event_trigger_event: "sql_drop", event_trigger_tags: [], event_trigger_enabled: "enabled", event_trigger_owner: "postgres", event_trigger_function: "public.audit_drop", event_trigger_function_sha256: "2".repeat(64) },
  ];
  const expected = migrationRunner.hashEventTriggerCatalog(rows);
  assert.equal(migrationRunner.hashEventTriggerCatalog(rows.toReversed().map((row) => ({ ...row, event_trigger_tags: row.event_trigger_tags.toReversed() }))), expected);
  assert.notEqual(migrationRunner.hashEventTriggerCatalog([...rows, { ...rows[0], event_trigger_name: "wrapper_guard" }]), expected);
  assert.notEqual(migrationRunner.hashEventTriggerCatalog(rows.map((row) => row.event_trigger_name === "supabase_guard" ? { ...row, event_trigger_function_sha256: "3".repeat(64) } : row)), expected);
});

test("074 bootstrap role authorization rejects unsigned, stale, wrong image, and wrong migration requests", () => {
  const now = new Date("2026-08-05T00:00:00.000Z");
  const base = {
    contractVersion: "ai-content-bootstrap-role-authorization.v3",
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
    contractVersion: "ai-content-bootstrap-role-authorization.v3",
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
  const interimFenceSecurityCatalogCanonicalJson = migrationRunner.canonicalFenceSecurityCatalog(interimFenceSecurityCatalog);
  const install = migrationRunner.buildProviderEventTriggerInstallRequest(authorization, {
    fenceSecurityCatalogSha256: createHash("sha256").update(interimFenceSecurityCatalogCanonicalJson).digest("hex"),
    fenceSecurityCatalogCanonicalJson: interimFenceSecurityCatalogCanonicalJson,
    eventTriggerCatalogBeforeCanonicalJson: migrationRunner.canonicalEventTriggerCatalog([]),
  });
  assert.equal(install.eventTriggerOwner, "postgres");
  assert.equal(install.eventTriggerEnabled, "enabled");
  assert.deepEqual(install.eventTriggerTags, migrationRunner.required074DdlGuardTags);
  assert.equal(install.providerAttestationKeyId, providerIdentity.keyId);
  assert.equal(install.providerAttestationPublicKeySha256, providerIdentity.publicKeySha256);
  const unsigned = {
    contractVersion: "ai-content-074-provider-attestation.v3",
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
  assert.doesNotMatch(migration.sql, /^\s*(?:create|alter)\s+event\s+trigger\b/im);
  assert.match(migration.sql, /create function consume_ai_content_provider_attestation\(\)/i);
  assert.match(migration.sql, /current_setting\('role',\s*true\)/i);
  assert.doesNotMatch(migration.sql, /current_user<>bootstrap\.schema_owner_role_name/i);
  const runnerSource = await readFile(new URL("./migrationRunner.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(runnerSource, /update ai_content_bootstrap_state[\s\S]{0,500}provider_attestation_json/i);
  assert.match(runnerSource, /select consume_ai_content_provider_attestation\(\)/i);
});

test("074 bootstrap role authorization applies stage one then independently consumes provider evidence", async () => {
  const migration = { id: "074_ai_content_maintenance_write_fence.sql", checksum: "1".repeat(64), sql: "select 1" };
  const stageRoleRows = [
    { role_name: "content_schema_owner", can_login: false, ...noProviderRoleCapabilities, inherit: true },
    { role_name: "content_application", can_login: true, ...noProviderRoleCapabilities, inherit: true },
    { role_name: "content_operator", can_login: true, ...noProviderRoleCapabilities, inherit: true },
    { role_name: "content_migration", can_login: true, ...noProviderRoleCapabilities, inherit: false },
    { role_name: "content_cleanup", can_login: true, ...noProviderRoleCapabilities, inherit: true },
  ];
  const stageMembershipEdges = [{ member_role_name: "content_migration", parent_role_name: "content_schema_owner",
    set_option: true, inherit_option: false, admin_option: false }];
  const stageObjectRows = migrationRunner.bootstrapFenceRelations.map((relation_name) => ({
    schema_name: "public", relation_name, relation_kind: "r", owner_role_name: "content_schema_owner", columns: [],
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
  };
  const unsignedAuthorization = {
    contractVersion: "ai-content-bootstrap-role-authorization.v3", requestId: "stage-074",
    migrationId: migration.id, migrationSha256: migration.checksum,
    imageDigest: `sha256:${"2".repeat(64)}`, imageSourceLabel: "3".repeat(40),
    roleCatalogSha256: migrationRunner.hashBootstrapRoleCatalog({ roles: stageRoleRows, membershipEdges: stageMembershipEdges }),
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
  let applied = false;
  let sealedState = null;
  const approvedLiveEvent = {
    event_trigger_name: authorization.eventTriggerName,
    event_trigger_event: authorization.eventTriggerEvent,
    event_trigger_tags: authorization.eventTriggerTags,
    event_trigger_owner: authorization.eventTriggerOwner,
    event_trigger_enabled: "enabled",
    event_trigger_function: authorization.eventTriggerFunction,
    event_trigger_function_sha256: authorization.eventTriggerFunctionSha256,
  };
  let liveEventRows = [preexistingEvent];
  let securityAttack = null;
  let providerBundleInstalled = false;
  const client = {
    async query(sql, parameters = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, parameters });
      if (normalized.includes("select id, checksum from schema_migrations")) {
        return { rows: applied ? [{ id: migration.id, checksum: migration.checksum }] : [] };
      }
      if (normalized.includes("to_regclass('public.schema_migrations')")) return { rows: [{ relation: "schema_migrations" }] };
      if (normalized.includes("to_regclass('public.workspaces')")) return { rows: [{ relation: null }] };
      if (normalized === "select session_user, current_user") {
        return { rows: [{ session_user: authorization.migrationRoleName, current_user: authorization.migrationRoleName }] };
      }
      if (normalized.includes("bootstrap_role_catalog_v3")) return { rows: stageRoleRows };
      if (normalized.includes("bootstrap_role_membership_catalog_v2")) return { rows: stageMembershipEdges };
      if (normalized.includes("bootstrap_object_catalog_v1")) return { rows: stageObjectRows };
      if (normalized.includes("full_event_trigger_catalog_v1")) return { rows: liveEventRows };
      if (normalized.includes("fence_security_functions_v1")) {
        const bundleOwner = providerBundleInstalled ? "postgres" : "content_schema_owner";
        const ownerAcl = [{ grantee: bundleOwner, privilege: "EXECUTE", grantable: false }];
        return { rows: parameters[0].map((identity) => {
          const extra = identity.includes("assert_ai_content_writable")
            ? [{ grantee: "content_application", privilege: "EXECUTE", grantable: false }]
            : identity.includes("prepare_ai_content_cutover") || identity.includes("set_ai_content_maintenance") || identity.includes("transition_ai_content_cutover_status")
              ? [{ grantee: "content_operator", privilege: "EXECUTE", grantable: false }]
              : identity.includes("ai_content_cutover_bypass_allowed") || identity.includes("verify_ai_content_write_fence_catalog") || identity.includes("consume_ai_content_provider_attestation")
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
      if (normalized.includes("fence_security_ordinary_triggers_v1")) return { rows: migrationRunner.bootstrapFenceRelations.map((relation_name) => ({
        relation_name, trigger_name: `ai_content_fence_${relation_name.slice(0, 30)}_${createHash("md5").update(relation_name).digest("hex").slice(0, 12)}`,
        trigger_type: 31, enabled: relation_name === "ai_content_generations" && securityAttack === "trigger" ? "D" : "A", function_identity: "public.enforce_ai_content_write_fence()",
      })) };
      if (normalized.includes("fence_security_catalog_rows_v1")) return { rows: migrationRunner.bootstrapFenceCatalog };
      if (normalized.includes("fence_security_control_relations_v1")) return { rows: parameters[0].map((relation_name) => ({
        relation_name, owner_role_name: providerBundleInstalled ? "postgres" : "content_schema_owner",
        acl: ["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"].map((privilege) => ({ grantee: providerBundleInstalled ? "postgres" : "content_schema_owner", privilege, grantable: false })).concat(
          relation_name === "ai_content_maintenance_state" ? [{ grantee: "content_application", privilege: "SELECT", grantable: false }]
            : ["ai_content_bootstrap_state", "ai_content_ddl_allowlist", "ai_content_write_fence_catalog"].includes(relation_name)
              ? [{ grantee: "content_migration", privilege: "SELECT", grantable: false }] : [],
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
      if (normalized.includes("bootstrap_event_trigger_catalog_v1")) {
        const rows = liveEventRows.filter((row) => row.event_trigger_name === authorization.eventTriggerName);
        return { rowCount: rows.length, rows };
      }
      if (normalized === "select consume_ai_content_provider_attestation() as consumed") {
        if (sealedState.attestation_consumed_at) return { rows: [{ consumed: false }], rowCount: 1 };
        sealedState.attestation_consumed_at = "2026-08-05T00:00:00.000Z";
        return { rows: [{ consumed: true }], rowCount: 1 };
      }
      if (normalized.startsWith("insert into schema_migrations")) applied = true;
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
  const stageOne = await migrationRunner.runMigrationsWithClient({ client, migrations: [migration], bootstrap074: bootstrap });
  assert.equal(stageOne.providerInstallRequest.action, "install_verify_074_enforcement_bundle");
  assert.ok(calls.some(({ sql }) => sql === 'set local role "content_schema_owner"'));
  assert.ok(calls.some(({ sql }) => sql === "select verify_ai_content_write_fence_catalog()"));
  assert.ok(calls.some(({ sql }) => sql.includes("authorization_sha256") && sql.includes("install_request_json")));
  assert.ok(calls.some(({ sql }) => sql === 'grant select on table ai_content_bootstrap_state,ai_content_ddl_allowlist,ai_content_write_fence_catalog to "content_migration"'));

  const install = stageOne.providerInstallRequest;
  const bootstrapInsertCount = () => calls.filter(({ sql }) => sql.startsWith("insert into ai_content_bootstrap_state")).length;
  const insertsAfterStageOne = bootstrapInsertCount();
  const recoveredInstall = await migrationRunner.runMigrationsWithClient({ client, migrations: [migration], bootstrap074: bootstrap });
  assert.deepEqual(recoveredInstall.providerInstallRequest, install);
  assert.equal(bootstrapInsertCount(), insertsAfterStageOne);
  const exactStageOneRecovery = () => migrationRunner.runMigrationsWithClient({ client, migrations: [migration], bootstrap074: bootstrap });
  const sealedStageOne = () => structuredClone(sealedState);
  const restoreStageOne = (saved) => { sealedState = saved; };
  const reorderedJsonb = sealedStageOne();
  sealedState.install_request_json = Object.fromEntries(Object.entries(sealedState.install_request_json).reverse());
  sealedState.event_trigger_catalog_before_json = Object.fromEntries(Object.entries(sealedState.event_trigger_catalog_before_json).reverse());
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
  const finalFenceSecurityCatalog = await migrationRunner.readFenceSecurityCatalog(client, authorization, { ownerRoleName: "postgres" });
  assert.equal(finalFenceSecurityCatalog.catalogSha256, install.expectedFinalFenceSecurityCatalogSha256);
  const unsignedAttestation = {
    contractVersion: "ai-content-074-provider-attestation.v3",
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
    issuedAt: "2026-08-05T00:00:00.000Z",
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
  for (const attack of ["function_body", "function_owner", "search_path", "security_definer", "trigger", "grant"]) {
    securityAttack = attack;
    await assert.rejects(migrationRunner.runMigrationsWithClient({
      client, migrations: [migration], bootstrap074: { ...bootstrap, providerAttestation },
    }), /bootstrap_074_(?:fence_security|final_fence_security)_/);
    assert.equal(sealedState.attestation_consumed_at, null);
  }
  securityAttack = null;
  const stageTwo = await migrationRunner.runMigrationsWithClient({
    client, migrations: [migration], bootstrap074: {
      ...bootstrap, providerAttestation,
    },
  });
  assert.equal(stageTwo.pending.length, 0);
  assert.equal(stageTwo.revocationRequest.migrationRoleName, authorization.migrationRoleName);
  assert.ok(calls.some(({ sql }) => sql === "select consume_ai_content_provider_attestation() as consumed"));
  assert.equal(calls.filter(({ sql }) => sql === 'set local role "content_schema_owner"').length, 1);
  const durableConsumes = () => calls.filter(({ sql }) => sql === "select consume_ai_content_provider_attestation() as consumed").length;
  const consumesAfterConsumption = durableConsumes();
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
  for (const attack of ["function_body", "function_owner", "search_path", "security_definer", "trigger", "grant"]) {
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
    return {
      calls,
      async query(sql) {
        const normalized = sql.replace(/\s+/g, " ").trim();
        calls.push(normalized);
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
    migrationRunner.runMigrationsWithClient({ client: earlierClient, migrations: [earlier, migration074], bootstrap074: {} }),
    /bootstrap_074_pending_set_invalid/,
  );
  assert.equal(earlierClient.calls.some((sql) => mutationPattern.test(sql)), false);

  const migration075 = { id: "075_ai_content_three_format_cutover.sql", checksum: "8".repeat(64), sql: "select 75" };
  const presentClient = makeClient([{ id: migration074.id, checksum: migration074.checksum }]);
  await assert.rejects(
    migrationRunner.runMigrationsWithClient({ client: presentClient, migrations: [migration074, migration075], bootstrap074: {} }),
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
      "074_ai_content_maintenance_write_fence.sql",
    ],
  );
});
