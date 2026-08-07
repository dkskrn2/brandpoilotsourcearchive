import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as runner from "./migrationRunner.mjs";
import {
  applyRoleBootstrap,
  buildAndSign075Allowlist,
  createRoleBootstrapPlan,
  installProvider074EnforcementBundle,
  signBootstrap074Authorization,
} from "./ai-content-database-roles.mjs";
import * as databaseRoles from "./ai-content-database-roles.mjs";

function identity(keyId) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const publicKeySha256 = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
  return { keyId, privateKey, publicKeyPem, publicKeySha256 };
}

const authorization = identity("authorization-2026-08");
const provider = identity("provider-2026-08");
const testPreservedRelationOwners = Object.fromEntries(
  databaseRoles.sharedOwnerTransferSecurityCatalog.map(({ relationName }) => [relationName, "postgres"]),
);
const testSharedRelationAclBefore = {
  relationAclRows: databaseRoles.sharedOwnerTransferSecurityCatalog.flatMap(({ relationName, preservedPrivileges }) => (
    preservedPrivileges.map((privilege) => ({
      relationName,
      grantorRoleName: "postgres",
      granteeRoleName: "postgres",
      privilege,
      grantable: false,
    }))
  )),
  columnAclRows: [],
};
const createTestRoleBootstrapPlan = (input = {}) => createRoleBootstrapPlan({
  databaseName: "postgres",
  preservedRelationOwners: testPreservedRelationOwners,
  sharedRelationAclBefore: testSharedRelationAclBefore,
  migrationHistoryOwnerRoleName: "postgres",
  ...input,
});

test("role bootstrap plan is closed over five distinct least-privilege identities", () => {
  const plan = createTestRoleBootstrapPlan({
    roleNames: {
      schemaOwnerRoleName: "content_schema_owner", applicationRoleName: "content_application",
      operatorRoleName: "content_operator", migrationRoleName: "content_migration",
      cleanupRoleName: "content_cleanup",
    },
  });
  assert.equal(plan.contractVersion, "ai-content-database-role-plan.v1");
  assert.deepEqual(plan.relations, runner.bootstrapFenceRelations);
  assert.ok(Array.isArray(plan.applicationRelationGrants));
  assert.deepEqual(
    plan.applicationRelationGrants.find(({ relationName }) => relationName === "ai_content_generations"),
    { relationName: "ai_content_generations", privileges: ["INSERT", "SELECT", "UPDATE"] },
  );
  assert.deepEqual(
    plan.applicationRelationGrants.find(({ relationName }) => relationName === "workspace_members"),
    { relationName: "workspace_members", privileges: ["SELECT"] },
  );
  assert.deepEqual(plan.applicationSequenceGrants, []);
  assert.deepEqual(plan.applicationSchemaPrivileges, ["USAGE"]);
  assert.deepEqual(
    plan.schemaOwnerRelationGrants.find(({ relationName }) => relationName === "product_service_versions"),
    { relationName: "product_service_versions", privileges: ["SELECT"] },
  );
  assert.deepEqual(
    plan.schemaOwnerRelationGrants.find(({ relationName }) => relationName === "schema_migrations"),
    { relationName: "schema_migrations", privileges: ["INSERT", "SELECT"] },
  );
  assert.deepEqual(plan.migrationRelationGrants, [
    { relationName: "schema_migrations", privileges: ["SELECT"] },
  ]);
  assert.equal(plan.migrationHistoryOwnerRoleName, "postgres");
  assert.deepEqual(
    plan.schemaOwnerRelationGrants.find(({ relationName }) => relationName === "brands"),
    { relationName: "brands", privileges: ["REFERENCES"] },
  );
  assert.deepEqual(
    plan.sharedOwnerTransfers.find(({ relationName }) => relationName === "worker_instances"),
    {
      relationName: "worker_instances",
      preservedOwnerRoleName: "postgres",
      preservedPrivileges: ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"],
    },
  );
  assert.equal(plan.exclusiveOwnedRelations.every((relationName) => relationName.startsWith("ai_content_")), true);
  assert.deepEqual(plan.sharedRelationAclBefore, testSharedRelationAclBefore);
  assert.match(plan.sharedRelationAclBeforeSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(plan.applicationOwnedFunctions, [
    "public.select_ai_content_proposal(uuid,uuid,uuid,uuid)",
    "public.start_ai_content_orchestration(uuid,uuid,uuid,jsonb,jsonb,uuid)",
  ]);
  assert.equal(new Set(Object.values(plan.roleNames)).size, 5);
  assert.match(plan.planSha256, /^[0-9a-f]{64}$/);
  assert.equal(typeof databaseRoles.readSharedRelationAclCatalog, "function");
  assert.equal(typeof databaseRoles.restoreSharedRelationOwners, "function");
  assert.ok(runner.providerEnforcementBundle.functions.includes(
    "public.read_ai_content_cutover_control_state(uuid)",
  ));
  assert.throws(
    () => createTestRoleBootstrapPlan({ roleNames: { ...plan.roleNames, cleanupRoleName: plan.roleNames.applicationRoleName } }),
    /ai_content_role_names_invalid/,
  );
});

test("preserved runtime schema CREATE is accepted only for the managed database-owner topology", () => {
  assert.equal(typeof databaseRoles.preservedRuntimeSchemaAclIsValid, "function");
  assert.equal(databaseRoles.preservedRuntimeSchemaAclIsValid({
    usage_allowed: true, create_allowed: false,
    schema_owner_role_name: "content_schema_owner", database_owner_role_name: "postgres",
  }, "postgres"), true);
  assert.equal(databaseRoles.preservedRuntimeSchemaAclIsValid({
    usage_allowed: true, create_allowed: true,
    schema_owner_role_name: "pg_database_owner", database_owner_role_name: "postgres",
  }, "postgres"), true);
  assert.equal(databaseRoles.preservedRuntimeSchemaAclIsValid({
    usage_allowed: true, create_allowed: true,
    schema_owner_role_name: "postgres", database_owner_role_name: "postgres",
  }, "postgres"), false);
  assert.equal(databaseRoles.preservedRuntimeSchemaAclIsValid({
    usage_allowed: true, create_allowed: true,
    schema_owner_role_name: "pg_database_owner", database_owner_role_name: "another_owner",
  }, "postgres"), false);
});

test("role database URLs preserve the Supabase pooler tenant suffix", () => {
  assert.equal(typeof databaseRoles.roleDatabaseUrl, "function");
  assert.equal(
    databaseRoles.roleDatabaseUrl(
      "postgresql://postgres.project_ref:admin@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require",
      "content_operator",
      "operator-password",
    ),
    "postgresql://content_operator.project_ref:operator-password@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require",
  );
  assert.equal(
    databaseRoles.roleDatabaseUrl(
      "postgresql://postgres:admin@db.example.test:5432/postgres",
      "content_operator",
      "operator-password",
    ),
    "postgresql://content_operator:operator-password@db.example.test:5432/postgres",
  );
  assert.throws(
    () => databaseRoles.roleDatabaseUrl(
      "postgresql://unexpected.user:admin@db.example.test/postgres",
      "content_operator",
      "operator-password",
    ),
    /ai_content_role_database_url_invalid/,
  );
});

test("074 provider enforcement rejects a non-platform-postgres identity before any mutation", async () => {
  const plan = createTestRoleBootstrapPlan();
  const calls = [];
  const client = { query: async (sql) => {
    calls.push(String(sql));
    return { rows: [{ session_user: "content_operator", current_user: "content_operator", rolsuper: false }] };
  } };
  await assert.rejects(installProvider074EnforcementBundle({
    client, migration: {}, plan, authorization: {}, installRequest: {},
    authorizationIdentity: {}, providerIdentity: {},
  }), /bootstrap_074_provider_identity_invalid/);
  assert.equal(calls.some((sql) => /^\s*begin\s*$/i.test(sql)), false);
});

test("074 provider recovery uses the sealed schema and a real migration-role connection", async () => {
  const [source, migration, cutover] = await Promise.all([
    readFile(new URL("./ai-content-database-roles.mjs", import.meta.url), "utf8"),
    readFile(new URL("../db/migrations/074_ai_content_maintenance_write_fence.sql", import.meta.url), "utf8"),
    readFile(new URL("../deploy/scripts/ai-content-cutover.sh", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /authorization_request_id text not null/);
  assert.match(migration, /authorization_sha256 text not null/);
  assert.doesNotMatch(migration, /authorization_json/);
  assert.match(source, /select authorization_request_id,authorization_sha256,install_request_json/);
  assert.doesNotMatch(source, /select authorization_json,install_request_json/);
  assert.doesNotMatch(source, /set session authorization/);
  assert.match(source, /connectFromFile\(args\["migration-url-file"\]\)/);
  assert.match(source, /await probeProvider074Capability\(client\);[\s\S]*?validateBootstrapRoleAuthorization\(authorization,[\s\S]*?allowExpiredSealed: true,[\s\S]*?const interim/);
  assert.match(source, /bootstrap_074_provider_owner_membership[\s\S]*?grant [\s\S]*?schemaOwnerRoleName[\s\S]*?preservedRuntimeRoleName[\s\S]*?with set true[\s\S]*?alter function[\s\S]*?revoke [\s\S]*?schemaOwnerRoleName[\s\S]*?preservedRuntimeRoleName/);
  assert.match(source, /bootstrap_074_provider_owner_membership[\s\S]*?with set true, inherit true, admin false/);
  assert.match(cutover, /migration_file="\$\(option migration-url-file\)"/);
  assert.match(cutover, /mount_readonly "\$migration_file" \/run\/secrets\/migration-database-url/);
  assert.match(cutover, /--migration-url-file \/run\/secrets\/migration-database-url/);
});

test("075 provider inheritance bridge grants one exact managed edge and revokes it", async () => {
  const plan = createTestRoleBootstrapPlan();
  const cutoverId = "7b7c8ed7-e046-4bcd-8592-38606f547493";
  let transient = false;
  let cutoverState = { status: "maintenance_verified", maintenance_enabled: true, marker_present: false };
  const baseline = {
    grantor_role_name: "supabase_admin", set_option: false, inherit_option: false, admin_option: true,
  };
  const client = { query: async (sql) => {
    const text = String(sql);
    if (text.includes("ai_content_075_provider_membership_identity")) {
      return { rows: [{ session_user: "postgres", current_user: "postgres", is_superuser: false, inherit: true }] };
    }
    if (text.includes("ai_content_075_provider_membership_cutover")) {
      return { rows: [cutoverState] };
    }
    if (text.includes("ai_content_075_provider_membership_catalog")) {
      return { rows: [baseline, ...(transient ? [{
        grantor_role_name: "postgres", set_option: true, inherit_option: true, admin_option: false,
      }] : [])] };
    }
    if (/^\s*grant\s+"content_schema_owner"\s+to\s+"postgres"\s+with inherit true\s*$/i.test(text)) transient = true;
    if (/^\s*revoke\s+"content_schema_owner"\s+from\s+"postgres"\s+granted by\s+"postgres"\s*$/i.test(text)) transient = false;
    return { rows: [] };
  } };
  const enabled = await databaseRoles.setProvider075SchemaOwnerMembership(client, plan, cutoverId, true);
  assert.equal(enabled.transientMembershipEnabled, true);
  const disabled = await databaseRoles.setProvider075SchemaOwnerMembership(client, plan, cutoverId, false);
  assert.equal(disabled.transientMembershipEnabled, false);
  cutoverState = { status: "migration_body_complete", maintenance_enabled: true, marker_present: true };
  const restoreEnabled = await databaseRoles.setProvider075SchemaOwnerMembership(client, plan, cutoverId, true);
  assert.equal(restoreEnabled.transientMembershipEnabled, true);
  const restoreDisabled = await databaseRoles.setProvider075SchemaOwnerMembership(client, plan, cutoverId, false);
  assert.equal(restoreDisabled.transientMembershipEnabled, false);
  assert.equal(transient, false);
});

test("075 cutover brackets migration execution with the provider membership bridge", async () => {
  const [rolesSource, cutoverSource] = await Promise.all([
    readFile(new URL("./ai-content-database-roles.mjs", import.meta.url), "utf8"),
    readFile(new URL("../deploy/scripts/ai-content-cutover.sh", import.meta.url), "utf8"),
  ]);
  assert.match(rolesSource, /--enable-075-provider-membership[\s\S]*setProvider075SchemaOwnerMembership\([\s\S]*mode === "--enable-075-provider-membership"/);
  assert.match(rolesSource, /--disable-075-provider-membership[\s\S]*setProvider075SchemaOwnerMembership\([\s\S]*mode === "--enable-075-provider-membership"/);
  const run075 = cutoverSource.slice(cutoverSource.indexOf("run_075()"), cutoverSource.indexOf("run_proposal_preflight()"));
  const enable = run075.indexOf("--enable-075-provider-membership");
  const migration = run075.indexOf("/app/scripts/migrate.mjs");
  const disable = run075.lastIndexOf("--disable-075-provider-membership");
  assert.ok(enable >= 0 && enable < migration && migration < disable);
  assert.match(run075, /trap[\s\S]*disable-075-provider-membership/);
});

test("shared-owner restore drops inherited provider access outside the ownership mutation", async () => {
  const source = await readFile(new URL("./ai-content-database-roles.mjs", import.meta.url), "utf8");
  const restore = source.slice(
    source.indexOf("export async function restoreSharedRelationOwners"),
    source.indexOf("export async function setProvider075SchemaOwnerMembership"),
  );
  const firstDisable = restore.indexOf("setProviderSchemaOwnerMembershipInTransaction(client, plan, false)");
  const preflight = restore.indexOf("sharedOwnerState: \"transferred\"");
  const enable = restore.indexOf("setProviderSchemaOwnerMembershipInTransaction(client, plan, true)");
  const ownerMutation = restore.indexOf("alter table public.${quoteIdentifier(relationName)} owner to");
  const finalDisable = restore.lastIndexOf("setProviderSchemaOwnerMembershipInTransaction(client, plan, false)");
  const finalVerification = restore.indexOf("verifyRestoredSharedRelationSecurity(client, plan)");
  assert.ok(firstDisable >= 0 && firstDisable < preflight);
  assert.ok(preflight < enable && enable < ownerMutation);
  assert.ok(ownerMutation < finalDisable && finalDisable < finalVerification);
});

test("role bootstrap applies only the closed role/schema/relation ownership plan", async () => {
  const plan = createTestRoleBootstrapPlan();
  const calls = [];
  let bootstrapCommitted = false;
  const client = { query: async (sql, values = []) => {
    calls.push({ sql: String(sql), values });
    if (/^\s*commit\s*$/i.test(String(sql))) bootstrapCommitted = true;
    if (String(sql).includes("ai_content_shared_relation_owner_before_transfer")) {
      return { rows: plan.sharedOwnerTransfers.map(({ relationName, preservedOwnerRoleName }) => ({
        relation_name: relationName,
        owner_role_name: bootstrapCommitted ? plan.roleNames.schemaOwnerRoleName : preservedOwnerRoleName,
      })) };
    }
    if (String(sql).includes("ai_content_shared_relation_acl_snapshot")) {
      return { rows: plan.sharedRelationAclBefore.relationAclRows.map((row) => ({
        relation_name: row.relationName,
        column_name: null,
        grantor_role_name: row.grantorRoleName,
        grantee_role_name: row.granteeRoleName,
        privilege: row.privilege,
        grantable: row.grantable,
        acl_level: "relation",
      })) };
    }
    if (String(sql).includes("ai_content_exclusive_acl_grantees_to_scrub")) {
      return { rows: [{ relation_name: "ai_content_generations", grantee_role_name: "anon" }] };
    }
    if (String(sql).includes("ai_content_controlled_column_acl_to_scrub")) {
      return { rows: [{ relation_name: "ai_content_generations", column_name: "title", grantee_role_name: "anon" }] };
    }
    if (String(sql).includes("ai_content_schema_owner_relation_acl")) {
      return { rows: plan.schemaOwnerRelationGrants.map(({ relationName, privileges }) => ({
        relation_name: relationName,
        privileges,
        grantable: false,
      })) };
    }
    if (String(sql).includes("ai_content_migration_relation_acl")) {
      return { rows: plan.migrationRelationGrants.map(({ relationName, privileges }) => ({
        relation_name: relationName,
        owner_role_name: plan.migrationHistoryOwnerRoleName,
        privileges,
        grantable: false,
      })) };
    }
    if (String(sql).includes("ai_content_shared_relation_owner_acl")) {
      return { rows: plan.sharedOwnerTransfers.map(({ relationName, preservedOwnerRoleName, preservedPrivileges }) => ({
        relation_name: relationName,
        owner_role_name: plan.roleNames.schemaOwnerRoleName,
        preserved_owner_role_name: preservedOwnerRoleName,
        privileges: preservedPrivileges,
        grantable: false,
      })) };
    }
    if (String(sql).includes("ai_content_exclusive_relation_acl")) {
      return { rows: plan.exclusiveOwnedRelations.flatMap((relationName) => {
        const grant = plan.applicationRelationGrants.find((candidate) => candidate.relationName === relationName);
        return (grant?.privileges ?? []).map((privilege) => ({
          relation_name: relationName,
          grantee_role_name: plan.roleNames.applicationRoleName,
          privilege,
          grantable: false,
        }));
      }) };
    }
    if (String(sql).includes("ai_content_exclusive_column_acl")) return { rows: [] };
    if (String(sql).includes("ai_content_exclusive_preserved_runtime_write_acl")) return { rows: [] };
    if (String(sql).includes("ai_content_preserved_runtime_schema_acl")) {
      return { rows: [{ usage_allowed: true, create_allowed: false }] };
    }
    if (String(sql).includes("to_regclass")) return { rows: values[0].map((relation_name) => ({ relation_name })) };
    if (String(sql).includes("ai_content_application_owned_function_catalog")) {
      return { rows: plan.applicationOwnedFunctions.map((identity) => ({ identity })) };
    }
    if (String(sql).includes("ai_content_application_relation_acl")) {
      return { rows: plan.applicationRelationGrants.map(({ relationName, privileges }) => ({ relation_name: relationName, privileges, column_acl_count: 0 })) };
    }
    if (String(sql).includes("ai_content_application_sequence_acl")) return { rows: [] };
    if (String(sql).includes("ai_content_application_schema_acl")) {
      return { rows: [{ schema_name: "public", privileges: plan.applicationSchemaPrivileges }] };
    }
    if (String(sql).includes("ai_content_application_function_owner")) {
      return { rows: plan.applicationOwnedFunctions.map((identity) => ({ identity, owner_role_name: plan.roleNames.schemaOwnerRoleName })) };
    }
    if (String(sql).includes("from pg_roles")) return { rows: [] };
    if (String(sql).includes("pg_get_triggerdef")) return { rows: [] };
    return { rows: [], rowCount: 1 };
  } };
  const passwords = {
    content_application: "app-password", content_operator: "operator-password",
    content_migration: "migration-password", content_cleanup: "cleanup-password",
  };
  const firstResult = await applyRoleBootstrap(client, plan, passwords);
  const mutationCountAfterFirstApply = calls.filter(({ sql }) => /alter table public\."[^"]+" owner to/i.test(sql)).length;
  const replayResult = await applyRoleBootstrap(client, plan, passwords);
  const sql = calls.map(({ sql }) => sql).join("\n");
  assert.match(sql, /create role "content_schema_owner" nologin nosuperuser nobypassrls/i);
  assert.match(sql, /create role "content_migration" login noinherit/i);
  assert.doesNotMatch(sql, /alter role "content_(?:schema_owner|application|operator|migration|cleanup)"[^;\n]*nosuperuser/i);
  assert.match(sql, /grant "content_schema_owner" to "content_migration" with set true, inherit false, admin false/i);
  assert.match(sql, /grant "content_schema_owner" to "postgres" with set true, inherit false, admin false/i);
  assert.match(sql, /revoke "content_schema_owner" from "postgres"/i);
  assert.match(sql, /revoke create on schema public from public/i);
  assert.doesNotMatch(sql, /revoke all on schema public from public/i);
  assert.match(sql, /revoke all on table public\."ai_content_generations" from "content_application"/i);
  assert.match(sql, /grant insert,select,update on table public\."ai_content_generations" to "content_application"/i);
  assert.match(sql, /grant select on table public\."workspace_members" to "content_application"/i);
  assert.match(sql, /grant select on table public\."product_service_versions" to "content_schema_owner"/i);
  assert.match(sql, /grant insert,select on table public\."schema_migrations" to "content_schema_owner"/i);
  assert.match(sql, /grant select on table public\."schema_migrations" to "content_migration"/i);
  assert.match(sql, /alter table public\."worker_instances" owner to "content_schema_owner"/i);
  assert.match(sql, /grant delete,insert,references,select,trigger,truncate,update on table public\."worker_instances" to "postgres"/i);
  assert.match(sql, /alter function public\.select_ai_content_proposal\(uuid,uuid,uuid,uuid\) owner to "content_schema_owner"/i);
  const providerSetGrantIndex = calls.findIndex(({ sql: statement }) => /grant "content_schema_owner" to "postgres" with set true/i.test(statement));
  const firstOwnerTransferIndex = calls.findIndex(({ sql: statement }) => /alter table public\."[^\"]+" owner to/i.test(statement));
  const lastFunctionTransferIndex = calls.findLastIndex(({ sql: statement }) => /alter function .* owner to "content_schema_owner"/i.test(statement));
  const setSchemaOwnerIndex = calls.findIndex(({ sql: statement }) => /set local role "content_schema_owner"/i.test(statement));
  const resetRoleIndex = calls.findIndex(({ sql: statement }) => /^reset role$/i.test(statement));
  const transferredApplicationGrantIndex = calls.findIndex(({ sql: statement }) => /grant insert,select,update on table public\."ai_content_generations" to "content_application"/i.test(statement));
  const externalApplicationGrantIndex = calls.findIndex(({ sql: statement }) => /grant select on table public\."workspace_members" to "content_application"/i.test(statement));
  const preservedOwnerGrantIndex = calls.findIndex(({ sql: statement }) => /grant delete,insert,references,select,trigger,truncate,update on table public\."worker_instances" to "postgres"/i.test(statement));
  const exclusiveThirdPartyRevokeIndex = calls.findIndex(({ sql: statement }) => /revoke all privileges on table public\."ai_content_generations" from "anon"/i.test(statement));
  const exclusiveColumnRevokeIndex = calls.findIndex(({ sql: statement }) => /revoke all privileges \("title"\) on table public\."ai_content_generations" from "anon"/i.test(statement));
  const providerSetRevokeIndex = calls.findIndex(({ sql: statement }) => /revoke "content_schema_owner" from "postgres"/i.test(statement));
  assert.ok(providerSetGrantIndex >= 0 && providerSetGrantIndex < firstOwnerTransferIndex);
  assert.ok(externalApplicationGrantIndex > firstOwnerTransferIndex && externalApplicationGrantIndex < setSchemaOwnerIndex);
  assert.ok(setSchemaOwnerIndex > lastFunctionTransferIndex);
  assert.ok(transferredApplicationGrantIndex > setSchemaOwnerIndex && transferredApplicationGrantIndex < resetRoleIndex);
  assert.ok(preservedOwnerGrantIndex > setSchemaOwnerIndex && preservedOwnerGrantIndex < resetRoleIndex);
  assert.ok(exclusiveThirdPartyRevokeIndex > setSchemaOwnerIndex && exclusiveThirdPartyRevokeIndex < resetRoleIndex);
  assert.ok(exclusiveColumnRevokeIndex > setSchemaOwnerIndex && exclusiveColumnRevokeIndex < resetRoleIndex);
  assert.ok(providerSetRevokeIndex > resetRoleIndex);
  assert.doesNotMatch(sql, /alter function public\.set_updated_at\(\) owner/i);
  assert.equal(
    mutationCountAfterFirstApply,
    plan.exclusiveOwnedRelations.length + plan.sharedOwnerTransfers.length,
  );
  assert.equal(
    calls.filter(({ sql: statement }) => /alter table public\."[^"]+" owner to/i.test(statement)).length,
    mutationCountAfterFirstApply,
  );
  assert.deepEqual(replayResult, firstResult);
  assert.match(firstResult.securityCatalogSha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(sql, /drop role|drop table|reassign owned/i);
});

test("role bootstrap rejects shared relation ACL drift before ownership transfer", async () => {
  const plan = createTestRoleBootstrapPlan();
  const calls = [];
  const client = { query: async (sql, values = []) => {
    calls.push(String(sql));
    if (String(sql).includes("ai_content_shared_relation_acl_snapshot")) return { rows: [] };
    if (String(sql).includes("ai_content_shared_relation_owner_before_transfer")) {
      return { rows: plan.sharedOwnerTransfers.map(({ relationName, preservedOwnerRoleName }) => ({
        relation_name: relationName, owner_role_name: preservedOwnerRoleName,
      })) };
    }
    if (String(sql).includes("to_regclass")) return { rows: values[0].map((relation_name) => ({ relation_name })) };
    if (String(sql).includes("from pg_roles")) return { rows: [] };
    return { rows: [], rowCount: 1 };
  } };
  await assert.rejects(applyRoleBootstrap(client, plan, {
    content_application: "app-password", content_operator: "operator-password",
    content_migration: "migration-password", content_cleanup: "cleanup-password",
  }), /ai_content_shared_relation_acl_drift/);
  assert.equal(calls.some((sql) => /alter table public\./i.test(sql)), false);
});

test("application runtime grant verification rejects a missing direct relation privilege", async () => {
  assert.equal(typeof databaseRoles.verifyApplicationRuntimeSecurity, "function");
  const plan = createTestRoleBootstrapPlan();
  const client = {
    query: async (sql) => {
      if (String(sql).includes("ai_content_application_relation_acl")) {
        return {
          rows: plan.applicationRelationGrants.map((grant) => ({
            relation_name: grant.relationName,
            privileges: grant.relationName === "ai_content_generations"
              ? grant.privileges.filter((privilege) => privilege !== "UPDATE")
              : grant.privileges,
            column_acl_count: 0,
          })),
        };
      }
      if (String(sql).includes("ai_content_application_sequence_acl")) return { rows: [] };
      if (String(sql).includes("ai_content_application_function_owner")) {
        return { rows: plan.applicationOwnedFunctions.map((identity) => ({ identity, owner_role_name: plan.roleNames.schemaOwnerRoleName })) };
      }
      throw new Error(`unexpected_query:${String(sql)}`);
    },
  };
  await assert.rejects(
    databaseRoles.verifyApplicationRuntimeSecurity(client, plan),
    /ai_content_application_relation_acl_invalid/,
  );
});

test("074 authorization is signed by the authorization key and pins the provider identity", async () => {
  const migration = (await runner.loadMigrations()).find(({ id }) => id === "074_ai_content_maintenance_write_fence.sql");
  const plan = createTestRoleBootstrapPlan();
  const eventBefore = { catalogSha256: "a".repeat(64), count: 0 };
  const signed = signBootstrap074Authorization({
    migration, roleNames: plan.roleNames,
    roleCatalogSha256: "b".repeat(64), objectCatalogSha256: "c".repeat(64),
    eventTriggerFunctionSha256: "d".repeat(64), eventBefore,
    imageDigest: `sha256:${"e".repeat(64)}`, imageSourceLabel: "f".repeat(40),
    requestId: "bootstrap-074-production", issuedAt: "2026-08-06T00:00:00.000Z",
    authorizationIdentity: authorization, providerIdentity: provider,
  });
  assert.equal(runner.validateBootstrapRoleAuthorization(signed, {
    migration, roleCatalogSha256: "b".repeat(64), objectCatalogSha256: "c".repeat(64),
    eventTriggerCatalogBeforeSha256: eventBefore.catalogSha256,
    eventTriggerCatalogBeforeCount: 0,
    imageDigest: `sha256:${"e".repeat(64)}`, imageSourceLabel: "f".repeat(40),
    authorizationVerification: {
      publicKeyPem: authorization.publicKeyPem, expectedKeyId: authorization.keyId,
      expectedPublicKeySha256: authorization.publicKeySha256,
    },
    providerAttestationVerification: {
      publicKeyPem: provider.publicKeyPem, expectedKeyId: provider.keyId,
      expectedPublicKeySha256: provider.publicKeySha256,
    },
    now: new Date("2026-08-06T00:01:00.000Z"),
  }).requestId, "bootstrap-074-production");
});

test("075 provider artifacts contain the exact migration-derived allowlist and distinct signatures", async () => {
  const migration = (await runner.loadMigrations()).find(({ id }) => id === "075_ai_content_three_format_cutover.sql");
  const plan = createTestRoleBootstrapPlan();
  const sealed = buildAndSign075Allowlist({
    migration, roleNames: plan.roleNames,
    cutoverId: "11111111-1111-4111-8111-111111111111",
    enforcementCatalogSha256: "a".repeat(64), beforeRows: [],
    requestId: "22222222-2222-4222-8222-222222222222",
    issuedAt: "2026-08-06T00:00:00.000Z",
    authorizationIdentity: authorization, providerIdentity: provider,
  });
  const validated = runner.validateCutoverAllowlistAuthorization(sealed.authorization, {
    migration, roleNames: plan.roleNames, cutoverId: sealed.authorization.cutoverId,
    enforcementCatalogSha256: "a".repeat(64),
    authorizationVerification: { publicKeyPem: authorization.publicKeyPem, expectedKeyId: authorization.keyId, expectedPublicKeySha256: authorization.publicKeySha256 },
    providerAttestationVerification: { publicKeyPem: provider.publicKeyPem, expectedKeyId: provider.keyId, expectedPublicKeySha256: provider.publicKeySha256 },
    now: new Date("2026-08-06T00:01:00.000Z"),
  });
  assert.deepEqual(validated.rows, runner.buildCutover075ExactDdlAllowlist(migration, plan.roleNames));
  assert.equal(runner.validateCutoverAllowlistAttestation(sealed.attestation, {
    authorization: validated,
    providerAttestationVerification: { publicKeyPem: provider.publicKeyPem, expectedKeyId: provider.keyId, expectedPublicKeySha256: provider.publicKeySha256 },
    now: new Date("2026-08-06T00:01:00.000Z"),
  }).afterSha256, sealed.authorization.rowsSha256);
});

test("075 provider signs exact live legacy ACL revocations", async () => {
  const migration = (await runner.loadMigrations()).find(({ id }) => id === "075_ai_content_three_format_cutover.sql");
  const plan = createTestRoleBootstrapPlan();
  const legacyAclRevocations = [{
    commandTag: "REVOKE",
    objectIdentityPattern: "function:public.start_ai_content_orchestration(uuid,uuid,uuid,jsonb,jsonb,uuid)|service_role|ALL",
  }];
  const sealed = buildAndSign075Allowlist({
    migration, roleNames: plan.roleNames,
    cutoverId: "11111111-1111-4111-8111-111111111111",
    enforcementCatalogSha256: "a".repeat(64), beforeRows: [], legacyAclRevocations,
    requestId: "22222222-2222-4222-8222-222222222222",
    issuedAt: "2026-08-06T00:00:00.000Z",
    authorizationIdentity: authorization, providerIdentity: provider,
  });
  assert.ok(sealed.authorization.rows.some((row) =>
    row.commandTag === legacyAclRevocations[0].commandTag
      && row.objectIdentityPattern === legacyAclRevocations[0].objectIdentityPattern));
  assert.doesNotThrow(() => runner.validateCutoverAllowlistAttestation(sealed.attestation, {
    authorization: sealed.authorization,
    providerAttestationVerification: { publicKeyPem: provider.publicKeyPem, expectedKeyId: provider.keyId, expectedPublicKeySha256: provider.publicKeySha256 },
    now: new Date("2026-08-06T00:00:00.000Z"),
  }), "an attestation must be valid immediately when its signed artifacts are created");
  assert.doesNotThrow(() => runner.validateCutoverAllowlistAuthorization(sealed.authorization, {
    migration, roleNames: plan.roleNames, cutoverId: sealed.authorization.cutoverId,
    enforcementCatalogSha256: "a".repeat(64),
    authorizationVerification: { publicKeyPem: authorization.publicKeyPem, expectedKeyId: authorization.keyId, expectedPublicKeySha256: authorization.publicKeySha256 },
    providerAttestationVerification: { publicKeyPem: provider.publicKeyPem, expectedKeyId: provider.keyId, expectedPublicKeySha256: provider.publicKeySha256 },
    now: new Date("2026-08-06T00:01:00.000Z"),
  }));
});

test("075 provider derives revocations from every live protected ACL grantee", async () => {
  let queryParameters;
  const rows = await databaseRoles.readCutover075LegacyAclRevocations({
    async query(sql, parameters) {
      assert.match(sql, /cutover_075_live_legacy_acl_revocations_v1/);
      queryParameters = parameters;
      return { rows: [{
        command_tag: "REVOKE",
        object_identity_pattern: "function:public.start_ai_content_orchestration(uuid,uuid,uuid,jsonb,jsonb,uuid)|service_role|ALL",
      }] };
    },
  });
  assert.ok(queryParameters[0].includes("ai_content_generation_operations"));
  assert.ok(queryParameters[1].includes("public.start_ai_content_orchestration(uuid,uuid,uuid,jsonb,jsonb,uuid)"));
  assert.deepEqual(rows, [{
    commandTag: "REVOKE",
    objectIdentityPattern: "function:public.start_ai_content_orchestration(uuid,uuid,uuid,jsonb,jsonb,uuid)|service_role|ALL",
  }]);
});
