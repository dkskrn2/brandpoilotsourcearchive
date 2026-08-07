import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { decodeCaCertificate, resolveVerifiedTlsConfig } from "./databaseTls.mjs";
import {
  bootstrapFenceRelations,
  buildCutover075Pg17AclCompatibility,
  buildMembershipRevocationRequest,
  buildProviderEventTriggerInstallRequest,
  buildCutover075ExactDdlAllowlist,
  cutover075RelationSecurityCatalog,
  cutover075SecurityFunctions,
  canonicalBootstrapAuthorizationPayload,
  canonicalCutoverAllowlistAttestationPayload,
  canonicalCutoverAllowlistAuthorizationPayload,
  canonicalProviderAttestationPayload,
  createCutover075ProviderJournal,
  hashCutoverAllowlistAuthorizationEnvelope,
  hashCutoverDdlAllowlist,
  hashEventTriggerDefinition,
  hashMembershipRevocationEnvelope,
  hashProviderAttestationEnvelope,
  installCutover075AllowlistWithProvider,
  loadMigrations,
  providerEnforcementBundle,
  providerEnforcementBundleSha256,
  readCanonicalBootstrapCatalogs,
  readCanonicalBootstrapRoleCatalog,
  readCanonicalEventTriggerCatalog,
  readFenceSecurityCatalog,
  unwrapFileTransaction,
  validateBootstrapRoleAuthorization,
  validateEventTriggerCatalogDelta,
  validateMembershipRevocationEvidence,
  validateCutover075Pg17AclCompatibilityCatalog,
  validateProviderEventTriggerAttestation,
} from "./migrationRunner.mjs";

const defaultNames = Object.freeze({
  schemaOwnerRoleName: "content_schema_owner",
  applicationRoleName: "content_application",
  operatorRoleName: "content_operator",
  migrationRoleName: "content_migration",
  cleanupRoleName: "content_cleanup",
});
const roleNameKeys = Object.freeze(Object.keys(defaultNames));

const applicationRelationGrant = (relationName, privileges) => Object.freeze({
  relationName,
  privileges: Object.freeze([...privileges]),
});

// This catalog is intentionally closed over the relations read or mutated by the
// customer AI-content V3 request path before migration 074 installs its provider
// controls. Adding a repository query without updating this list makes bootstrap
// verification fail instead of silently falling back to the database owner.
export const applicationRuntimeRelationSecurityCatalog = Object.freeze([
  applicationRelationGrant("ai_content_attachment_deletion_jobs", ["INSERT", "SELECT", "UPDATE"]),
  applicationRelationGrant("ai_content_attachment_upload_sessions", ["INSERT", "SELECT", "UPDATE"]),
  applicationRelationGrant("ai_content_generation_attachments", ["INSERT", "SELECT", "UPDATE"]),
  applicationRelationGrant("ai_content_generation_input_snapshots", ["INSERT", "SELECT"]),
  applicationRelationGrant("ai_content_generation_jobs", ["INSERT", "SELECT", "UPDATE"]),
  applicationRelationGrant("ai_content_generation_outputs", ["INSERT", "SELECT", "UPDATE"]),
  applicationRelationGrant("ai_content_generation_references", ["DELETE", "INSERT", "SELECT"]),
  applicationRelationGrant("ai_content_generation_render_jobs", ["INSERT", "SELECT", "UPDATE"]),
  applicationRelationGrant("ai_content_generations", ["INSERT", "SELECT", "UPDATE"]),
  applicationRelationGrant("ai_content_output_research_snapshots", ["INSERT", "SELECT"]),
  applicationRelationGrant("ai_content_proposal_batches", ["INSERT", "SELECT", "UPDATE"]),
  applicationRelationGrant("ai_content_proposal_jobs", ["INSERT", "SELECT", "UPDATE"]),
  applicationRelationGrant("ai_content_proposal_research_snapshots", ["INSERT", "SELECT"]),
  applicationRelationGrant("ai_content_proposals", ["INSERT", "SELECT", "UPDATE"]),
  applicationRelationGrant("ai_content_subject_analyses", ["INSERT", "SELECT", "UPDATE"]),
  applicationRelationGrant("ai_content_subject_appeal_regeneration_keys", ["INSERT", "SELECT"]),
  applicationRelationGrant("ai_content_subject_images", ["INSERT", "SELECT", "UPDATE"]),
  applicationRelationGrant("ai_content_usage_ledger", ["INSERT", "SELECT"]),
  applicationRelationGrant("brand_appeals", ["INSERT", "SELECT"]),
  applicationRelationGrant("brand_audiences", ["INSERT", "SELECT"]),
  applicationRelationGrant("brand_avatar_images", ["SELECT"]),
  applicationRelationGrant("brand_avatars", ["SELECT"]),
  applicationRelationGrant("brand_channels", ["SELECT"]),
  applicationRelationGrant("brand_core_versions", ["SELECT"]),
  applicationRelationGrant("brand_profiles", ["SELECT"]),
  applicationRelationGrant("brand_rule_sets", ["SELECT"]),
  applicationRelationGrant("brand_trend_saved_media", ["SELECT"]),
  applicationRelationGrant("brands", ["SELECT"]),
  applicationRelationGrant("channel_credentials", ["SELECT"]),
  applicationRelationGrant("channel_outputs", ["INSERT", "SELECT", "UPDATE"]),
  applicationRelationGrant("content_performance_snapshots", ["SELECT"]),
  applicationRelationGrant("content_topics", ["INSERT", "SELECT"]),
  applicationRelationGrant("instagram_trend_media", ["SELECT"]),
  applicationRelationGrant("jobs", ["INSERT"]),
  applicationRelationGrant("master_drafts", ["INSERT", "SELECT"]),
  applicationRelationGrant("product_service_assets", ["SELECT"]),
  applicationRelationGrant("product_service_versions", ["SELECT"]),
  applicationRelationGrant("product_services", ["SELECT"]),
  applicationRelationGrant("publish_attempts", ["SELECT"]),
  applicationRelationGrant("publish_queue", ["INSERT", "SELECT", "UPDATE"]),
  applicationRelationGrant("reference_items", ["SELECT"]),
  applicationRelationGrant("reference_pattern_versions", ["SELECT"]),
  applicationRelationGrant("reference_snapshots", ["SELECT"]),
  applicationRelationGrant("source_crawl_runs", ["INSERT"]),
  applicationRelationGrant("source_snapshots", ["SELECT"]),
  applicationRelationGrant("source_urls", ["SELECT"]),
  applicationRelationGrant("storage_artifacts", ["INSERT", "SELECT"]),
  applicationRelationGrant("topic_publish_groups", ["INSERT", "SELECT"]),
  applicationRelationGrant("wiki_versions", ["SELECT"]),
  applicationRelationGrant("workspace_members", ["SELECT"]),
]);

// All V3 identifiers are UUIDs generated by the application or gen_random_uuid;
// there are no application-owned SERIAL/IDENTITY sequences before migration 074.
export const applicationRuntimeSequenceSecurityCatalog = Object.freeze([]);
export const applicationRuntimeSchemaSecurityCatalog = Object.freeze(["USAGE"]);

// Migration 075 replaces these pre-existing functions while running as the
// schema owner. Their ownership must therefore be transferred before 074 closes
// the DDL boundary; relying on CREATE OR REPLACE to preserve a provider owner is
// both deployment-order dependent and unsafe.
export const applicationRuntimeFunctionOwnershipCatalog = Object.freeze([
  "public.select_ai_content_proposal(uuid,uuid,uuid,uuid)",
  "public.start_ai_content_orchestration(uuid,uuid,uuid,jsonb,jsonb,uuid)",
]);

// Migration 075 runs as the no-login schema owner. These are shared product or
// reference relations that the cutover only reads, plus the external parents on
// which it creates foreign keys. Ownership deliberately stays with the existing
// application principal.
export const schemaOwnerCutoverRelationSecurityCatalog = Object.freeze([
  applicationRelationGrant("audit_events", ["DELETE", "SELECT"]),
  applicationRelationGrant("brand_avatar_images", ["SELECT"]),
  applicationRelationGrant("brands", ["REFERENCES"]),
  applicationRelationGrant("product_service_assets", ["SELECT"]),
  applicationRelationGrant("product_service_versions", ["SELECT"]),
  applicationRelationGrant("reference_items", ["SELECT"]),
  applicationRelationGrant("reference_pattern_versions", ["SELECT"]),
  applicationRelationGrant("reference_snapshots", ["SELECT"]),
  applicationRelationGrant("schema_migrations", ["INSERT", "SELECT"]),
  applicationRelationGrant("workspaces", ["REFERENCES"]),
]);

// The login migration role reads history before SET ROLE. Marker writes happen
// only after SET ROLE to the schema owner, so the login itself gets SELECT only.
// Ownership deliberately remains with the sealed provider/runtime principal.
export const migrationRuntimeRelationSecurityCatalog = Object.freeze([
  applicationRelationGrant("schema_migrations", ["SELECT"]),
]);

const postCutoverApplicationRelationSecurityCatalog = Object.freeze([
  applicationRelationGrant("ai_content_maintenance_state", ["SELECT"]),
  ...cutover075RelationSecurityCatalog.flatMap(({ relationName, grants }) => grants
    .filter(({ role }) => role === "application")
    .map(({ privileges }) => applicationRelationGrant(relationName, privileges))),
].sort((left, right) => left.relationName < right.relationName ? -1 : left.relationName > right.relationName ? 1 : 0));

const postCutoverSchemaOwnerRelationSecurityCatalog = Object.freeze([
  applicationRelationGrant("ai_content_bootstrap_state", ["SELECT"]),
  applicationRelationGrant("ai_content_cutovers", ["REFERENCES"]),
]);

// The 074 fence requires schema-owner ownership for its shared execution tables;
// worker_instances is added because 075 alters its worker-type constraint. Each
// sealed previous owner keeps the complete ordinary table privilege set it had
// implicitly as owner, so unrelated API and worker DML does not regress.
const preservedOwnerPrivileges = Object.freeze([
  "DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE",
]);
const sharedOwnerTransfer = (relationName) => Object.freeze({
  relationName,
  preservedPrivileges: preservedOwnerPrivileges,
});
export const sharedOwnerTransferSecurityCatalog = Object.freeze([
  sharedOwnerTransfer("auto_approval_checks"),
  sharedOwnerTransfer("automation_runs"),
  sharedOwnerTransfer("brand_format_rotation_states"),
  sharedOwnerTransfer("channel_outputs"),
  sharedOwnerTransfer("content_topics"),
  sharedOwnerTransfer("jobs"),
  sharedOwnerTransfer("llm_runs"),
  sharedOwnerTransfer("master_drafts"),
  sharedOwnerTransfer("publish_attempts"),
  sharedOwnerTransfer("publish_queue"),
  sharedOwnerTransfer("regeneration_requests"),
  sharedOwnerTransfer("review_events"),
  sharedOwnerTransfer("source_crawl_runs"),
  sharedOwnerTransfer("storage_artifacts"),
  sharedOwnerTransfer("topic_publish_groups"),
  sharedOwnerTransfer("topic_rows"),
  sharedOwnerTransfer("topic_uploads"),
  sharedOwnerTransfer("worker_instances"),
]);
const sharedFenceRelationNames = new Set(
  sharedOwnerTransferSecurityCatalog.map(({ relationName }) => relationName),
);
export const exclusiveBootstrapOwnedRelations = Object.freeze(
  bootstrapFenceRelations.filter((relationName) => !sharedFenceRelationNames.has(relationName)),
);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  return value;
}

function canonicalJson(value) { return JSON.stringify(normalize(value)); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function sha256Json(value) { return sha256(canonicalJson(value)); }
function quoteIdentifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
    throw new Error("ai_content_role_names_invalid");
  }
  return `"${value.replaceAll('"', '""')}"`;
}
function quoteLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function lexicalCompare(left, right) { return left < right ? -1 : left > right ? 1 : 0; }

export function roleDatabaseUrl(connectionString, roleName, password) {
  if (typeof connectionString !== "string" || !connectionString
    || typeof roleName !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(roleName)
    || typeof password !== "string" || !password) {
    throw new Error("ai_content_role_database_url_invalid");
  }
  let value;
  let sourceUsername;
  try {
    value = new URL(connectionString);
    sourceUsername = decodeURIComponent(value.username);
  } catch {
    throw new Error("ai_content_role_database_url_invalid");
  }
  const match = /^postgres(\.[A-Za-z0-9_-]+)?$/.exec(sourceUsername);
  if (!match) throw new Error("ai_content_role_database_url_invalid");
  value.username = `${roleName}${match[1] ?? ""}`;
  value.password = password;
  return value.toString();
}

function validateRoleNames(names) {
  if (!record(names) || JSON.stringify(Object.keys(names).sort()) !== JSON.stringify([...roleNameKeys].sort())
    || Object.values(names).some((name) => typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name))
    || new Set(Object.values(names)).size !== roleNameKeys.length) {
    throw new Error("ai_content_role_names_invalid");
  }
  return Object.freeze({ ...names });
}

function validatePreservedRelationOwners(preservedRelationOwners, names) {
  const expectedKeys = sharedOwnerTransferSecurityCatalog.map(({ relationName }) => relationName).sort();
  if (!record(preservedRelationOwners)
    || canonicalJson(Object.keys(preservedRelationOwners).sort()) !== canonicalJson(expectedKeys)
    || Object.values(preservedRelationOwners).some((name) => typeof name !== "string"
      || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)
      || Object.values(names).includes(name))
    || new Set(Object.values(preservedRelationOwners)).size !== 1) {
    throw new Error("ai_content_preserved_relation_owners_invalid");
  }
  return preservedRelationOwners;
}

const relationAclPrivileges = new Set([
  "DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE",
]);
const columnAclPrivileges = new Set(["INSERT", "REFERENCES", "SELECT", "UPDATE"]);
const aclRoleNameIsValid = (value, { publicAllowed = false } = {}) => (
  typeof value === "string" && value.length > 0 && value.length <= 63
  && (publicAllowed || value !== "PUBLIC")
);
const relationAclSortKey = (row) => [
  row.relationName, row.grantorRoleName, row.granteeRoleName, row.privilege,
  row.grantable ? "1" : "0",
].join("\0");
const columnAclSortKey = (row) => [
  row.relationName, row.columnName, row.grantorRoleName, row.granteeRoleName,
  row.privilege, row.grantable ? "1" : "0",
].join("\0");

function validateSharedRelationAclBefore(value) {
  if (!record(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([
    "columnAclRows", "relationAclRows",
  ])) throw new Error("ai_content_shared_relation_acl_plan_invalid");
  const relationNames = new Set(sharedOwnerTransferSecurityCatalog.map(({ relationName }) => relationName));
  const validateRows = (rows, { column }) => {
    if (!Array.isArray(rows)) throw new Error("ai_content_shared_relation_acl_plan_invalid");
    const expectedKeys = column
      ? ["columnName", "grantable", "granteeRoleName", "grantorRoleName", "privilege", "relationName"]
      : ["grantable", "granteeRoleName", "grantorRoleName", "privilege", "relationName"];
    const privilegeSet = column ? columnAclPrivileges : relationAclPrivileges;
    const sortKey = column ? columnAclSortKey : relationAclSortKey;
    if (rows.some((row) => !record(row)
      || canonicalJson(Object.keys(row).sort()) !== canonicalJson(expectedKeys)
      || !relationNames.has(row.relationName)
      || (column && (typeof row.columnName !== "string" || !row.columnName || row.columnName.length > 63))
      || !aclRoleNameIsValid(row.grantorRoleName)
      || !aclRoleNameIsValid(row.granteeRoleName, { publicAllowed: true })
      || !privilegeSet.has(row.privilege)
      || typeof row.grantable !== "boolean")) {
      throw new Error("ai_content_shared_relation_acl_plan_invalid");
    }
    const keys = rows.map(sortKey);
    if (new Set(keys).size !== keys.length
      || canonicalJson(keys) !== canonicalJson([...keys].sort(lexicalCompare))) {
      throw new Error("ai_content_shared_relation_acl_plan_invalid");
    }
  };
  validateRows(value.relationAclRows, { column: false });
  validateRows(value.columnAclRows, { column: true });
  if (canonicalJson([...new Set(value.relationAclRows.map(({ relationName }) => relationName))].sort(lexicalCompare))
    !== canonicalJson([...relationNames].sort(lexicalCompare))) {
    throw new Error("ai_content_shared_relation_acl_plan_invalid");
  }
  return {
    relationAclRows: value.relationAclRows.map((row) => ({ ...row })),
    columnAclRows: value.columnAclRows.map((row) => ({ ...row })),
  };
}

export async function readSharedRelationAclCatalog(client, relationNames = sharedOwnerTransferSecurityCatalog.map(
  ({ relationName }) => relationName,
)) {
  if (!Array.isArray(relationNames) || relationNames.length === 0
    || new Set(relationNames).size !== relationNames.length
    || relationNames.some((name) => typeof name !== "string" || !name)) {
    throw new Error("ai_content_shared_relation_acl_catalog_invalid");
  }
  const result = await client.query(
    `/* ai_content_shared_relation_acl_snapshot */
     with requested(relation_name) as (
       select unnest($1::text[])
     ), requested_relations as (
       select requested.relation_name,relation.oid,relation.relowner,relation.relacl
         from requested
         join pg_class relation on relation.oid=to_regclass('public.'||requested.relation_name)
        where relation.relkind in ('r','p')
     ), relation_acl as (
       select relation.relation_name,null::text column_name,
              pg_get_userbyid(acl.grantor)::text grantor_role_name,
              case acl.grantee when 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee)::text end grantee_role_name,
              acl.privilege_type::text privilege,acl.is_grantable grantable,'relation'::text acl_level
         from requested_relations relation
         cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
     ), column_acl as (
       select relation.relation_name,attribute.attname::text column_name,
              pg_get_userbyid(acl.grantor)::text grantor_role_name,
              case acl.grantee when 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee)::text end grantee_role_name,
              acl.privilege_type::text privilege,acl.is_grantable grantable,'column'::text acl_level
         from requested_relations relation
         join pg_attribute attribute on attribute.attrelid=relation.oid
          and attribute.attnum>0 and not attribute.attisdropped
         cross join lateral aclexplode(attribute.attacl) acl
     )
     select * from (
       select * from relation_acl union all select * from column_acl
     ) acl_catalog
      order by relation_name collate "C",acl_level collate "C",column_name collate "C" nulls first,
               grantor_role_name collate "C",grantee_role_name collate "C",privilege collate "C",grantable`,
    [relationNames],
  );
  if (!Array.isArray(result.rows)) throw new Error("ai_content_shared_relation_acl_catalog_invalid");
  const relationAclRows = [];
  const columnAclRows = [];
  for (const row of result.rows) {
    const base = {
      relationName: String(row.relation_name),
      grantorRoleName: String(row.grantor_role_name),
      granteeRoleName: String(row.grantee_role_name),
      privilege: String(row.privilege),
      grantable: Boolean(row.grantable),
    };
    if (row.acl_level === "relation") relationAclRows.push(base);
    else if (row.acl_level === "column") columnAclRows.push({
      ...base, columnName: String(row.column_name),
    });
    else throw new Error("ai_content_shared_relation_acl_catalog_invalid");
  }
  relationAclRows.sort((left, right) => lexicalCompare(relationAclSortKey(left), relationAclSortKey(right)));
  columnAclRows.sort((left, right) => lexicalCompare(columnAclSortKey(left), columnAclSortKey(right)));
  return validateSharedRelationAclBefore({ relationAclRows, columnAclRows });
}

export function createRoleBootstrapPlan({
  databaseName,
  roleNames = defaultNames,
  preservedRelationOwners,
  sharedRelationAclBefore,
  migrationHistoryOwnerRoleName,
} = {}) {
  if (typeof databaseName !== "string" || !databaseName || databaseName.length > 63) {
    throw new Error("ai_content_database_name_invalid");
  }
  const names = validateRoleNames(roleNames);
  if (!aclRoleNameIsValid(migrationHistoryOwnerRoleName)
    || Object.values(names).includes(migrationHistoryOwnerRoleName)) {
    throw new Error("ai_content_migration_history_owner_invalid");
  }
  const owners = validatePreservedRelationOwners(preservedRelationOwners, names);
  const sharedAcl = validateSharedRelationAclBefore(sharedRelationAclBefore);
  const body = {
    contractVersion: "ai-content-database-role-plan.v1",
    databaseName,
    roleNames: names,
    preservedRuntimeRoleName: Object.values(owners)[0],
    migrationHistoryOwnerRoleName,
    relations: [...bootstrapFenceRelations],
    exclusiveOwnedRelations: [...exclusiveBootstrapOwnedRelations],
    applicationRelationGrants: applicationRuntimeRelationSecurityCatalog.map(({ relationName, privileges }) => ({
      relationName,
      privileges: [...privileges],
    })),
    applicationSequenceGrants: applicationRuntimeSequenceSecurityCatalog.map(({ sequenceName, privileges }) => ({
      sequenceName,
      privileges: [...privileges],
    })),
    applicationSchemaPrivileges: [...applicationRuntimeSchemaSecurityCatalog],
    applicationOwnedFunctions: [...applicationRuntimeFunctionOwnershipCatalog],
    schemaOwnerRelationGrants: schemaOwnerCutoverRelationSecurityCatalog.map(({ relationName, privileges }) => ({
      relationName,
      privileges: [...privileges],
    })),
    migrationRelationGrants: migrationRuntimeRelationSecurityCatalog.map(({ relationName, privileges }) => ({
      relationName,
      privileges: [...privileges],
    })),
    sharedOwnerTransfers: sharedOwnerTransferSecurityCatalog.map(({ relationName, preservedPrivileges }) => ({
      relationName,
      preservedOwnerRoleName: owners[relationName],
      preservedPrivileges: [...preservedPrivileges],
    })),
    sharedRelationAclBefore: sharedAcl,
    sharedRelationAclBeforeSha256: sha256Json(sharedAcl),
    migrationFloor: "073a_legacy_trigger_function_search_path.sql",
    prerequisiteMigration: "073_ai_content_generation_v2_render_pipeline.sql",
    fenceMigration: "074_ai_content_maintenance_write_fence.sql",
    cutoverMigration: "075_ai_content_three_format_cutover.sql",
  };
  return Object.freeze({ ...body, planSha256: sha256Json(body) });
}

function validatePlan(plan) {
  if (!record(plan) || plan.contractVersion !== "ai-content-database-role-plan.v1") throw new Error("ai_content_role_plan_invalid");
  const { planSha256, ...body } = plan;
  if (planSha256 !== sha256Json(body)
    || canonicalJson(plan.relations) !== canonicalJson(bootstrapFenceRelations)
    || canonicalJson(plan.exclusiveOwnedRelations) !== canonicalJson(exclusiveBootstrapOwnedRelations)
    || canonicalJson(plan.applicationRelationGrants) !== canonicalJson(applicationRuntimeRelationSecurityCatalog)
    || canonicalJson(plan.applicationSequenceGrants) !== canonicalJson(applicationRuntimeSequenceSecurityCatalog)
    || canonicalJson(plan.applicationSchemaPrivileges) !== canonicalJson(applicationRuntimeSchemaSecurityCatalog)
    || canonicalJson(plan.applicationOwnedFunctions) !== canonicalJson(applicationRuntimeFunctionOwnershipCatalog)
    || canonicalJson(plan.schemaOwnerRelationGrants) !== canonicalJson(schemaOwnerCutoverRelationSecurityCatalog)
    || canonicalJson(plan.migrationRelationGrants) !== canonicalJson(migrationRuntimeRelationSecurityCatalog)
    || canonicalJson(plan.sharedOwnerTransfers?.map(({ relationName, preservedPrivileges }) => ({
      relationName,
      preservedPrivileges,
    }))) !== canonicalJson(sharedOwnerTransferSecurityCatalog)) {
    throw new Error("ai_content_role_plan_invalid");
  }
  const names = validateRoleNames(plan.roleNames);
  const preservedOwners = validatePreservedRelationOwners(Object.fromEntries(plan.sharedOwnerTransfers.map((transfer) => [
    transfer.relationName,
    transfer.preservedOwnerRoleName,
  ])), names);
  if (plan.preservedRuntimeRoleName !== Object.values(preservedOwners)[0]) {
    throw new Error("ai_content_role_plan_invalid");
  }
  if (!aclRoleNameIsValid(plan.migrationHistoryOwnerRoleName)
    || Object.values(names).includes(plan.migrationHistoryOwnerRoleName)) {
    throw new Error("ai_content_role_plan_invalid");
  }
  const sharedAcl = validateSharedRelationAclBefore(plan.sharedRelationAclBefore);
  if (plan.sharedRelationAclBeforeSha256 !== sha256Json(sharedAcl)) {
    throw new Error("ai_content_role_plan_invalid");
  }
  return plan;
}

function compareCatalogRows(actual, expected, errorCode) {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(errorCode);
}

export function preservedRuntimeSchemaAclIsValid(row, preservedRuntimeRoleName) {
  if (!record(row) || row.usage_allowed !== true) return false;
  if (row.create_allowed === false) return true;
  return row.create_allowed === true
    && row.schema_owner_role_name === "pg_database_owner"
    && row.database_owner_role_name === preservedRuntimeRoleName;
}

export async function verifyApplicationRuntimeSecurity(client, rawPlan, {
  sharedOwnerState = "transferred",
  cutoverSecurityState = "pre-cutover",
} = {}) {
  const plan = validatePlan(rawPlan);
  if (!["transferred", "restored"].includes(sharedOwnerState)) {
    throw new Error("ai_content_shared_relation_owner_state_invalid");
  }
  if (!["pre-cutover", "post-cutover"].includes(cutoverSecurityState)) {
    throw new Error("ai_content_cutover_security_state_invalid");
  }
  const applicationRoleName = plan.roleNames.applicationRoleName;
  const applicationRelationGrants = [
    ...plan.applicationRelationGrants,
    ...(cutoverSecurityState === "post-cutover" ? postCutoverApplicationRelationSecurityCatalog : []),
  ].sort((left, right) => lexicalCompare(left.relationName, right.relationName));
  const schemaOwnerRelationGrants = [
    ...plan.schemaOwnerRelationGrants,
    ...(cutoverSecurityState === "post-cutover" ? postCutoverSchemaOwnerRelationSecurityCatalog : []),
  ].sort((left, right) => lexicalCompare(left.relationName, right.relationName));
  const relationNames = applicationRelationGrants.map(({ relationName }) => relationName);
  const relationAcl = await client.query(
    `/* ai_content_application_relation_acl */
     with application_role as (
       select oid from pg_roles where rolname=$2::name
     ), requested(relation_name) as (
       select unnest($1::text[])
     ), direct_relation_acl as (
       select relation.relname::text relation_name,
              array_agg(distinct acl.privilege_type order by acl.privilege_type)::text[] privileges
         from pg_class relation
         join pg_namespace namespace on namespace.oid=relation.relnamespace and namespace.nspname='public'
         cross join application_role
         cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
        where relation.relkind in ('r','p','v','m','f') and acl.grantee=application_role.oid
        group by relation.relname
     ), direct_column_acl as (
       select relation.relname::text relation_name,count(*)::integer column_acl_count
         from pg_class relation
         join pg_namespace namespace on namespace.oid=relation.relnamespace and namespace.nspname='public'
         join pg_attribute attribute on attribute.attrelid=relation.oid and attribute.attnum>0 and not attribute.attisdropped
         cross join application_role
         cross join lateral aclexplode(attribute.attacl) acl
        where relation.relkind in ('r','p','v','m','f') and acl.grantee=application_role.oid
        group by relation.relname
     ), all_relation_names as (
       select relation_name from requested
       union select relation_name from direct_relation_acl
       union select relation_name from direct_column_acl
     )
     select names.relation_name,
            coalesce(relation_acl.privileges,array[]::text[]) privileges,
            coalesce(column_acl.column_acl_count,0)::integer column_acl_count
       from all_relation_names names
       left join direct_relation_acl relation_acl using(relation_name)
       left join direct_column_acl column_acl using(relation_name)
      order by names.relation_name`,
    [relationNames, applicationRoleName],
  );
  const actualRelationAcl = relationAcl.rows.map((row) => ({
    relation_name: String(row.relation_name),
    privileges: Array.isArray(row.privileges) ? row.privileges.map(String) : [],
    column_acl_count: Number(row.column_acl_count),
  }));
  const expectedRelationAcl = applicationRelationGrants.map(({ relationName, privileges }) => ({
    relation_name: relationName,
    privileges: [...privileges],
    column_acl_count: 0,
  }));
  compareCatalogRows(actualRelationAcl, expectedRelationAcl, "ai_content_application_relation_acl_invalid");

  const sequenceNames = plan.applicationSequenceGrants.map(({ sequenceName }) => sequenceName);
  const sequenceAcl = await client.query(
    `/* ai_content_application_sequence_acl */
     with application_role as (
       select oid from pg_roles where rolname=$2::name
     ), requested(sequence_name) as (
       select unnest($1::text[])
     ), direct_sequence_acl as (
       select sequence.relname::text sequence_name,
              array_agg(distinct acl.privilege_type order by acl.privilege_type)::text[] privileges
         from pg_class sequence
         join pg_namespace namespace on namespace.oid=sequence.relnamespace and namespace.nspname='public'
         cross join application_role
         cross join lateral aclexplode(coalesce(sequence.relacl,acldefault('s',sequence.relowner))) acl
        where sequence.relkind='S' and acl.grantee=application_role.oid
        group by sequence.relname
     ), all_sequence_names as (
       select sequence_name from requested
       union select sequence_name from direct_sequence_acl
     )
     select names.sequence_name,coalesce(sequence_acl.privileges,array[]::text[]) privileges
       from all_sequence_names names
       left join direct_sequence_acl sequence_acl using(sequence_name)
      order by names.sequence_name`,
    [sequenceNames, applicationRoleName],
  );
  const actualSequenceAcl = sequenceAcl.rows.map((row) => ({
    sequence_name: String(row.sequence_name),
    privileges: Array.isArray(row.privileges) ? row.privileges.map(String) : [],
  }));
  const expectedSequenceAcl = plan.applicationSequenceGrants.map(({ sequenceName, privileges }) => ({
    sequence_name: sequenceName,
    privileges: [...privileges],
  }));
  compareCatalogRows(actualSequenceAcl, expectedSequenceAcl, "ai_content_application_sequence_acl_invalid");

  const schemaAcl = await client.query(
    `/* ai_content_application_schema_acl */
     select namespace.nspname::text schema_name,
            array_agg(distinct acl.privilege_type order by acl.privilege_type)::text[] privileges
       from pg_namespace namespace
       cross join (select oid from pg_roles where rolname=$1::name) application_role
       cross join lateral aclexplode(coalesce(namespace.nspacl,acldefault('n',namespace.nspowner))) acl
      where namespace.nspname='public' and acl.grantee=application_role.oid
      group by namespace.nspname`,
    [applicationRoleName],
  );
  const actualSchemaAcl = schemaAcl.rows.map((row) => ({
    schema_name: String(row.schema_name),
    privileges: Array.isArray(row.privileges) ? row.privileges.map(String) : [],
  }));
  compareCatalogRows(actualSchemaAcl, [{
    schema_name: "public",
    privileges: [...plan.applicationSchemaPrivileges],
  }], "ai_content_application_schema_acl_invalid");

  const schemaOwnerAcl = await client.query(
    `/* ai_content_schema_owner_relation_acl */
     with schema_owner as (
       select oid from pg_roles where rolname=$2::name
     ), requested(relation_name) as (
       select unnest($1::text[])
     ), direct_relation_acl as (
       select relation.relname::text relation_name,
              array_agg(distinct acl.privilege_type order by acl.privilege_type)::text[] privileges,
              bool_or(acl.is_grantable) grantable
         from pg_class relation
         join pg_namespace namespace on namespace.oid=relation.relnamespace and namespace.nspname='public'
         cross join schema_owner
         cross join lateral aclexplode(relation.relacl) acl
        where relation.relkind in ('r','p','v','m','f')
          and relation.relowner<>schema_owner.oid and acl.grantee=schema_owner.oid
        group by relation.relname
     ), all_relation_names as (
       select relation_name from requested
       union select relation_name from direct_relation_acl
     )
     select names.relation_name,coalesce(relation_acl.privileges,array[]::text[]) privileges,
            coalesce(relation_acl.grantable,false) grantable
       from all_relation_names names
       left join direct_relation_acl relation_acl using(relation_name)
      order by names.relation_name`,
    [schemaOwnerRelationGrants.map(({ relationName }) => relationName), plan.roleNames.schemaOwnerRoleName],
  );
  const actualSchemaOwnerAcl = schemaOwnerAcl.rows.map((row) => ({
    relation_name: String(row.relation_name),
    privileges: Array.isArray(row.privileges) ? row.privileges.map(String) : [],
    grantable: Boolean(row.grantable),
  }));
  const expectedSchemaOwnerAcl = schemaOwnerRelationGrants.map(({ relationName, privileges }) => ({
    relation_name: relationName,
    privileges: [...privileges],
    grantable: false,
  }));
  compareCatalogRows(actualSchemaOwnerAcl, expectedSchemaOwnerAcl, "ai_content_schema_owner_relation_acl_invalid");

  const migrationAcl = await client.query(
    `/* ai_content_migration_relation_acl */
     with migration_role as (
       select oid from pg_roles where rolname=$2::name
     ), requested(relation_name) as (
       select unnest($1::text[])
     )
     select requested.relation_name,
            pg_get_userbyid(relation.relowner)::text owner_role_name,
            coalesce(array_agg(distinct acl.privilege_type order by acl.privilege_type)
              filter(where acl.grantee=migration_role.oid),array[]::text[])::text[] privileges,
            coalesce(bool_or(acl.is_grantable)
              filter(where acl.grantee=migration_role.oid),false) grantable
       from requested
       join pg_class relation on relation.oid=to_regclass('public.'||requested.relation_name)
       cross join migration_role
       left join lateral aclexplode(relation.relacl) acl on true
      group by requested.relation_name,relation.relowner
      order by requested.relation_name`,
    [plan.migrationRelationGrants.map(({ relationName }) => relationName), plan.roleNames.migrationRoleName],
  );
  const actualMigrationAcl = migrationAcl.rows.map((row) => ({
    relation_name: String(row.relation_name),
    owner_role_name: String(row.owner_role_name),
    privileges: Array.isArray(row.privileges) ? row.privileges.map(String) : [],
    grantable: Boolean(row.grantable),
  }));
  const expectedMigrationAcl = plan.migrationRelationGrants.map(({ relationName, privileges }) => ({
    relation_name: relationName,
    owner_role_name: plan.migrationHistoryOwnerRoleName,
    privileges: [...privileges],
    grantable: false,
  }));
  compareCatalogRows(actualMigrationAcl, expectedMigrationAcl, "ai_content_migration_relation_acl_invalid");

  const sharedOwnerAcl = await client.query(
    `/* ai_content_shared_relation_owner_acl */
     with requested(relation_name,preserved_owner_role_name) as (
       select * from unnest($1::text[],$2::text[])
     )
     select requested.relation_name,
            pg_get_userbyid(relation.relowner)::text owner_role_name,
            requested.preserved_owner_role_name,
            coalesce(array_agg(distinct acl.privilege_type order by acl.privilege_type)
              filter(where acl.grantee=preserved_owner.oid),array[]::text[])::text[] privileges,
            coalesce(bool_or(acl.is_grantable)
              filter(where acl.grantee=preserved_owner.oid),false) grantable
       from requested
       join pg_class relation on relation.oid=to_regclass('public.'||requested.relation_name)
       join pg_roles preserved_owner on preserved_owner.rolname=requested.preserved_owner_role_name
       left join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl on true
      group by requested.relation_name,relation.relowner,requested.preserved_owner_role_name
      order by requested.relation_name`,
    [
      plan.sharedOwnerTransfers.map(({ relationName }) => relationName),
      plan.sharedOwnerTransfers.map(({ preservedOwnerRoleName }) => preservedOwnerRoleName),
    ],
  );
  const actualSharedOwnerAcl = sharedOwnerAcl.rows.map((row) => ({
    relation_name: String(row.relation_name),
    owner_role_name: String(row.owner_role_name),
    preserved_owner_role_name: String(row.preserved_owner_role_name),
    privileges: Array.isArray(row.privileges) ? row.privileges.map(String) : [],
    grantable: Boolean(row.grantable),
  }));
  const expectedSharedOwnerAcl = plan.sharedOwnerTransfers.map(({
    relationName, preservedOwnerRoleName, preservedPrivileges,
  }) => ({
    relation_name: relationName,
    owner_role_name: sharedOwnerState === "transferred"
      ? plan.roleNames.schemaOwnerRoleName
      : preservedOwnerRoleName,
    preserved_owner_role_name: preservedOwnerRoleName,
    privileges: [...preservedPrivileges],
    grantable: false,
  }));
  compareCatalogRows(actualSharedOwnerAcl, expectedSharedOwnerAcl, "ai_content_shared_relation_owner_acl_invalid");

  const exclusiveAcl = await client.query(
    `/* ai_content_exclusive_relation_acl */
     with requested(relation_name) as (
       select unnest($1::text[])
     )
     select * from (
       select requested.relation_name,
              case acl.grantee when 0 then 'PUBLIC' else grantee.rolname::text end grantee_role_name,
              acl.privilege_type::text privilege,acl.is_grantable grantable
         from requested
         join pg_class relation on relation.oid=to_regclass('public.'||requested.relation_name)
         cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
         left join pg_roles grantee on grantee.oid=acl.grantee
        where acl.grantee<>relation.relowner
     ) exclusive_acl
      order by relation_name collate "C",grantee_role_name collate "C",
               privilege collate "C",grantable`,
    [plan.exclusiveOwnedRelations],
  );
  const actualExclusiveAcl = exclusiveAcl.rows.map((row) => ({
    relation_name: String(row.relation_name),
    grantee_role_name: String(row.grantee_role_name),
    privilege: String(row.privilege),
    grantable: Boolean(row.grantable),
  }));
  const exclusiveNames = new Set(plan.exclusiveOwnedRelations);
  const expectedExclusiveAcl = plan.applicationRelationGrants
    .filter(({ relationName }) => exclusiveNames.has(relationName))
    .flatMap(({ relationName, privileges }) => privileges.map((privilege) => ({
      relation_name: relationName,
      grantee_role_name: plan.roleNames.applicationRoleName,
      privilege,
      grantable: false,
    }))).sort((left, right) => lexicalCompare(
      `${left.relation_name}\0${left.grantee_role_name}\0${left.privilege}\0${left.grantable}`,
      `${right.relation_name}\0${right.grantee_role_name}\0${right.privilege}\0${right.grantable}`,
    ));
  compareCatalogRows(actualExclusiveAcl, expectedExclusiveAcl, "ai_content_exclusive_relation_acl_invalid");

  const exclusiveColumnAcl = await client.query(
    `/* ai_content_exclusive_column_acl */
     select * from (
       select relation.relname::text relation_name,attribute.attname::text column_name,
              case acl.grantee when 0 then 'PUBLIC' else grantee.rolname::text end grantee_role_name,
              acl.privilege_type::text privilege,acl.is_grantable grantable
         from pg_class relation
         join pg_namespace namespace on namespace.oid=relation.relnamespace and namespace.nspname='public'
         join pg_attribute attribute on attribute.attrelid=relation.oid
          and attribute.attnum>0 and not attribute.attisdropped
         cross join lateral aclexplode(attribute.attacl) acl
         left join pg_roles grantee on grantee.oid=acl.grantee
        where relation.relname=any($1::text[])
     ) exclusive_column_acl
      order by relation_name collate "C",column_name collate "C",
               grantee_role_name collate "C",privilege collate "C",grantable`,
    [plan.exclusiveOwnedRelations],
  );
  compareCatalogRows(exclusiveColumnAcl.rows, [], "ai_content_exclusive_column_acl_invalid");

  const preservedRuntimeWrites = await client.query(
    `/* ai_content_exclusive_preserved_runtime_write_acl */
     with requested(relation_name) as (select unnest($1::text[])),
          write_privileges(privilege) as (
            values ('DELETE'),('INSERT'),('REFERENCES'),('TRIGGER'),('TRUNCATE'),('UPDATE')
          )
     select requested.relation_name,write_privileges.privilege
       from requested
       join pg_class relation on relation.oid=to_regclass('public.'||requested.relation_name)
       cross join write_privileges
      where has_table_privilege($2::name,relation.oid,write_privileges.privilege)
      order by requested.relation_name collate "C",write_privileges.privilege collate "C"`,
    [plan.exclusiveOwnedRelations, plan.preservedRuntimeRoleName],
  );
  compareCatalogRows(preservedRuntimeWrites.rows, [], "ai_content_exclusive_preserved_runtime_write_acl_invalid");

  const runtimeSchemaAcl = await client.query(
    `/* ai_content_preserved_runtime_schema_acl */
     select pg_get_userbyid(namespace.nspowner)::text schema_owner_role_name,
            pg_get_userbyid(database.datdba)::text database_owner_role_name,
            has_schema_privilege($1::name,'public','USAGE') usage_allowed,
            has_schema_privilege($1::name,'public','CREATE') create_allowed
       from pg_namespace namespace cross join pg_database database
      where namespace.nspname='public' and database.datname=current_database()`,
    [plan.preservedRuntimeRoleName],
  );
  if (runtimeSchemaAcl.rows.length !== 1
    || !preservedRuntimeSchemaAclIsValid(runtimeSchemaAcl.rows[0], plan.preservedRuntimeRoleName)) {
    throw new Error("ai_content_preserved_runtime_schema_acl_invalid");
  }

  const functionOwners = await client.query(
    `/* ai_content_application_function_owner */
     select requested.identity,
            owner.rolname::text owner_role_name
       from unnest($1::text[]) requested(identity)
       left join pg_proc function on function.oid=to_regprocedure(requested.identity)
       left join pg_roles owner on owner.oid=function.proowner
      order by requested.identity`,
    [plan.applicationOwnedFunctions],
  );
  const actualFunctionOwners = functionOwners.rows.map((row) => ({
    identity: String(row.identity),
    owner_role_name: row.owner_role_name == null ? null : String(row.owner_role_name),
  }));
  const expectedFunctionOwners = plan.applicationOwnedFunctions.map((identity) => ({
    identity,
    owner_role_name: plan.roleNames.schemaOwnerRoleName,
  }));
  compareCatalogRows(actualFunctionOwners, expectedFunctionOwners, "ai_content_application_function_owner_invalid");
}

export async function applyRoleBootstrap(client, rawPlan, passwords) {
  const plan = validatePlan(rawPlan);
  const names = plan.roleNames;
  const loginNames = [names.applicationRoleName, names.operatorRoleName, names.migrationRoleName, names.cleanupRoleName];
  if (!record(passwords) || loginNames.some((name) => typeof passwords[name] !== "string" || passwords[name].length < 12)) {
    throw new Error("ai_content_role_passwords_invalid");
  }
  await client.query("begin");
  try {
    const sharedOwners = await client.query(
      `/* ai_content_shared_relation_owner_before_transfer */
       select requested.relation_name,pg_get_userbyid(relation.relowner)::text owner_role_name
         from unnest($1::text[]) requested(relation_name)
         join pg_class relation on relation.oid=to_regclass('public.'||requested.relation_name)
        order by requested.relation_name`,
      [plan.sharedOwnerTransfers.map(({ relationName }) => relationName)],
    );
    const expectedSharedOwners = plan.sharedOwnerTransfers.map(({ relationName, preservedOwnerRoleName }) => ({
      relation_name: relationName,
      owner_role_name: preservedOwnerRoleName,
    }));
    const transferredSharedOwners = plan.sharedOwnerTransfers.map(({ relationName }) => ({
      relation_name: relationName,
      owner_role_name: plan.roleNames.schemaOwnerRoleName,
    }));
    const allPreserved = canonicalJson(sharedOwners.rows) === canonicalJson(expectedSharedOwners);
    const allTransferred = canonicalJson(sharedOwners.rows) === canonicalJson(transferredSharedOwners);
    if (!allPreserved && !allTransferred) {
      throw new Error("ai_content_shared_relation_owner_drift");
    }
    if (allTransferred) {
      await verifyApplicationRuntimeSecurity(client, plan, { sharedOwnerState: "transferred" });
      await client.query("commit");
      return Object.freeze({
        contractVersion: "ai-content-database-role-apply-result.v1",
        planSha256: plan.planSha256,
        securityCatalogSha256: sha256Json({
          applicationRelationGrants: plan.applicationRelationGrants,
          applicationSequenceGrants: plan.applicationSequenceGrants,
          applicationSchemaPrivileges: plan.applicationSchemaPrivileges,
          applicationOwnedFunctions: plan.applicationOwnedFunctions,
          schemaOwnerRelationGrants: plan.schemaOwnerRelationGrants,
          migrationRelationGrants: plan.migrationRelationGrants,
          sharedOwnerTransfers: plan.sharedOwnerTransfers,
        }),
      });
    }
    let sharedAclBefore;
    try {
      sharedAclBefore = await readSharedRelationAclCatalog(
        client,
        plan.sharedOwnerTransfers.map(({ relationName }) => relationName),
      );
    } catch {
      throw new Error("ai_content_shared_relation_acl_drift");
    }
    if (canonicalJson(sharedAclBefore) !== canonicalJson(plan.sharedRelationAclBefore)) {
      throw new Error("ai_content_shared_relation_acl_drift");
    }
    const existing = await client.query("select rolname from pg_roles where rolname=any($1::name[])", [Object.values(names)]);
    const present = new Set(existing.rows.map((row) => String(row.rolname)));
    const create = async (name, attributes) => {
      if (!present.has(name)) await client.query(`create role ${quoteIdentifier(name)} ${attributes}`);
      const alterAttributes = attributes.split(" ").filter((attribute) => attribute !== "nosuperuser").join(" ");
      await client.query(`alter role ${quoteIdentifier(name)} ${alterAttributes}`);
    };
    await create(names.schemaOwnerRoleName, "nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication inherit");
    await create(names.applicationRoleName, "login inherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication");
    await create(names.operatorRoleName, "login inherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication");
    await create(names.migrationRoleName, "login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication");
    await create(names.cleanupRoleName, "login inherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication");
    for (const name of loginNames) await client.query(`alter role ${quoteIdentifier(name)} password ${quoteLiteral(passwords[name])}`);
    await client.query(`alter role ${quoteIdentifier(names.schemaOwnerRoleName)} set search_path=public,pg_catalog,pg_temp`);
    await client.query(`alter role ${quoteIdentifier(names.migrationRoleName)} set search_path=public,pg_catalog,pg_temp`);
    for (const name of [names.applicationRoleName, names.operatorRoleName, names.cleanupRoleName]) {
      await client.query(`alter role ${quoteIdentifier(name)} set search_path=pg_catalog,public,pg_temp`);
    }
    await client.query("revoke create on schema public from public");
    await client.query(`grant usage,create on schema public to ${quoteIdentifier(names.schemaOwnerRoleName)}`);
    await client.query(`revoke all on schema public from ${quoteIdentifier(names.applicationRoleName)}`);
    await client.query(`grant usage on schema public to ${quoteIdentifier(names.applicationRoleName)}`);
    await client.query(`grant usage on schema public to ${[names.operatorRoleName, names.migrationRoleName, names.cleanupRoleName].map(quoteIdentifier).join(",")}`);
    await client.query(`grant usage on schema public to ${quoteIdentifier(plan.preservedRuntimeRoleName)}`);
    await client.query(`grant ${quoteIdentifier(names.schemaOwnerRoleName)} to ${quoteIdentifier(names.migrationRoleName)} with set true, inherit false, admin false`);
    const runtimeRelations = [...new Set([
      ...plan.relations,
      ...plan.applicationRelationGrants.map(({ relationName }) => relationName),
      ...plan.schemaOwnerRelationGrants.map(({ relationName }) => relationName),
      ...plan.migrationRelationGrants.map(({ relationName }) => relationName),
      ...plan.sharedOwnerTransfers.map(({ relationName }) => relationName),
    ])].sort();
    const existingRelations = await client.query(
      "select requested.relation_name from unnest($1::text[]) requested(relation_name) where to_regclass('public.' || requested.relation_name) is not null order by requested.relation_name",
      [runtimeRelations],
    );
    if (existingRelations.rows.length !== runtimeRelations.length) throw new Error("ai_content_role_relation_catalog_incomplete");
    for (const controlledRoleName of [
      names.applicationRoleName, names.operatorRoleName, names.migrationRoleName, names.cleanupRoleName,
    ]) {
      await client.query(`revoke all privileges on all tables in schema public from ${quoteIdentifier(controlledRoleName)}`);
      await client.query(`revoke all privileges on all sequences in schema public from ${quoteIdentifier(controlledRoleName)}`);
    }
    for (const { relationName, privileges } of plan.schemaOwnerRelationGrants) {
      await client.query(`revoke all on table public.${quoteIdentifier(relationName)} from ${quoteIdentifier(names.schemaOwnerRoleName)}`);
      await client.query(`grant ${privileges.map((privilege) => privilege.toLowerCase()).join(",")} on table public.${quoteIdentifier(relationName)} to ${quoteIdentifier(names.schemaOwnerRoleName)}`);
    }
    for (const { relationName, privileges } of plan.migrationRelationGrants) {
      await client.query(`revoke all on table public.${quoteIdentifier(relationName)} from ${quoteIdentifier(names.migrationRoleName)}`);
      await client.query(`grant ${privileges.map((privilege) => privilege.toLowerCase()).join(",")} on table public.${quoteIdentifier(relationName)} to ${quoteIdentifier(names.migrationRoleName)}`);
    }
    if (plan.applicationSequenceGrants.length > 0) {
      const existingSequences = await client.query(
        "select requested.sequence_name from unnest($1::text[]) requested(sequence_name) where to_regclass('public.' || requested.sequence_name) is not null order by requested.sequence_name",
        [plan.applicationSequenceGrants.map(({ sequenceName }) => sequenceName)],
      );
      if (existingSequences.rows.length !== plan.applicationSequenceGrants.length) {
        throw new Error("ai_content_role_sequence_catalog_incomplete");
      }
      for (const { sequenceName, privileges } of plan.applicationSequenceGrants) {
        await client.query(`revoke all on sequence public.${quoteIdentifier(sequenceName)} from ${quoteIdentifier(names.applicationRoleName)}`);
        await client.query(`grant ${privileges.map((privilege) => privilege.toLowerCase()).join(",")} on sequence public.${quoteIdentifier(sequenceName)} to ${quoteIdentifier(names.applicationRoleName)}`);
      }
    }
    // PostgreSQL 16 gives a CREATEROLE principal ADMIN but not SET on roles it
    // creates. Managed providers therefore require a transaction-scoped SET
    // membership before ownership can be transferred to the no-login owner.
    // REVOKE below removes this self-granted SET edge while retaining the
    // provider-managed ADMIN edge.
    await client.query(
      `grant ${quoteIdentifier(names.schemaOwnerRoleName)} to ${quoteIdentifier(plan.preservedRuntimeRoleName)} with set true, inherit false, admin false`,
    );
    for (const relationName of plan.exclusiveOwnedRelations) {
      await client.query(`alter table public.${quoteIdentifier(relationName)} owner to ${quoteIdentifier(names.schemaOwnerRoleName)}`);
    }
    for (const { relationName } of plan.sharedOwnerTransfers) {
      await client.query(`alter table public.${quoteIdentifier(relationName)} owner to ${quoteIdentifier(names.schemaOwnerRoleName)}`);
    }
    const exclusiveRelationNames = new Set(plan.exclusiveOwnedRelations);
    const exclusiveAclGrantees = await client.query(
      `/* ai_content_exclusive_acl_grantees_to_scrub */
       select * from (
         select distinct relation.relname::text relation_name,
                case acl.grantee when 0 then 'PUBLIC' else grantee.rolname::text end grantee_role_name
           from pg_class relation
           join pg_namespace namespace on namespace.oid=relation.relnamespace and namespace.nspname='public'
           cross join lateral aclexplode(relation.relacl) acl
           left join pg_roles grantee on grantee.oid=acl.grantee
          where relation.relname=any($1::text[]) and acl.grantee<>relation.relowner
       ) exclusive_grantees
        order by relation_name collate "C",grantee_role_name collate "C"`,
      [plan.exclusiveOwnedRelations],
    );
    const controlledColumnAcl = await client.query(
      `/* ai_content_controlled_column_acl_to_scrub */
       select * from (
         select distinct relation.relname::text relation_name,attribute.attname::text column_name,
                case acl.grantee when 0 then 'PUBLIC' else grantee.rolname::text end grantee_role_name
           from pg_class relation
           join pg_namespace namespace on namespace.oid=relation.relnamespace and namespace.nspname='public'
           join pg_attribute attribute on attribute.attrelid=relation.oid
            and attribute.attnum>0 and not attribute.attisdropped
           cross join lateral aclexplode(attribute.attacl) acl
           left join pg_roles grantee on grantee.oid=acl.grantee
          where relation.relname=any($1::text[])
            and (relation.relname=any($2::text[]) or grantee.rolname=any($3::text[]))
       ) controlled_column_acl
        order by relation_name collate "C",column_name collate "C",grantee_role_name collate "C"`,
      [runtimeRelations, plan.exclusiveOwnedRelations, Object.values(names)],
    );
    for (const row of controlledColumnAcl.rows
      .filter(({ relation_name: relationName }) => !exclusiveRelationNames.has(String(relationName)))) {
      const grantee = row.grantee_role_name === "PUBLIC" ? "public" : quoteIdentifier(String(row.grantee_role_name));
      await client.query(`revoke all privileges (${quoteIdentifier(String(row.column_name))}) on table public.${quoteIdentifier(String(row.relation_name))} from ${grantee}`);
    }
    const transferredRelationNames = new Set([
      ...plan.exclusiveOwnedRelations,
      ...plan.sharedOwnerTransfers.map(({ relationName }) => relationName),
    ]);
    for (const { relationName, privileges } of plan.applicationRelationGrants
      .filter(({ relationName }) => !transferredRelationNames.has(relationName))) {
      await client.query(`revoke all on table public.${quoteIdentifier(relationName)} from ${quoteIdentifier(names.applicationRoleName)}`);
      await client.query(`grant ${privileges.map((privilege) => privilege.toLowerCase()).join(",")} on table public.${quoteIdentifier(relationName)} to ${quoteIdentifier(names.applicationRoleName)}`);
    }
    const existingOwnedFunctions = await client.query(
      `/* ai_content_application_owned_function_catalog */
       select requested.identity
         from unnest($1::text[]) requested(identity)
        where to_regprocedure(requested.identity) is not null
        order by requested.identity`,
      [plan.applicationOwnedFunctions],
    );
    if (existingOwnedFunctions.rows.length !== plan.applicationOwnedFunctions.length) {
      throw new Error("ai_content_role_function_catalog_incomplete");
    }
    for (const identity of plan.applicationOwnedFunctions) {
      await client.query(`alter function ${identity} owner to ${quoteIdentifier(names.schemaOwnerRoleName)}`);
    }
    // Grants issued while the provider merely has SET membership are dependent
    // on that membership and PostgreSQL removes them when the edge is revoked.
    // Issue grants on transferred objects as the durable no-login owner instead.
    await client.query(`set local role ${quoteIdentifier(names.schemaOwnerRoleName)}`);
    for (const row of exclusiveAclGrantees.rows) {
      const grantee = row.grantee_role_name === "PUBLIC" ? "public" : quoteIdentifier(String(row.grantee_role_name));
      await client.query(`revoke all privileges on table public.${quoteIdentifier(String(row.relation_name))} from ${grantee}`);
    }
    for (const row of controlledColumnAcl.rows
      .filter(({ relation_name: relationName }) => exclusiveRelationNames.has(String(relationName)))) {
      const grantee = row.grantee_role_name === "PUBLIC" ? "public" : quoteIdentifier(String(row.grantee_role_name));
      await client.query(`revoke all privileges (${quoteIdentifier(String(row.column_name))}) on table public.${quoteIdentifier(String(row.relation_name))} from ${grantee}`);
    }
    for (const { relationName, preservedOwnerRoleName, preservedPrivileges } of plan.sharedOwnerTransfers) {
      await client.query(`grant ${preservedPrivileges.map((privilege) => privilege.toLowerCase()).join(",")} on table public.${quoteIdentifier(relationName)} to ${quoteIdentifier(preservedOwnerRoleName)}`);
    }
    for (const { relationName, privileges } of plan.applicationRelationGrants
      .filter(({ relationName }) => transferredRelationNames.has(relationName))) {
      await client.query(`revoke all on table public.${quoteIdentifier(relationName)} from ${quoteIdentifier(names.applicationRoleName)}`);
      await client.query(`grant ${privileges.map((privilege) => privilege.toLowerCase()).join(",")} on table public.${quoteIdentifier(relationName)} to ${quoteIdentifier(names.applicationRoleName)}`);
    }
    await client.query("reset role");
    await client.query(
      `revoke ${quoteIdentifier(names.schemaOwnerRoleName)} from ${quoteIdentifier(plan.preservedRuntimeRoleName)}`,
    );
    await verifyApplicationRuntimeSecurity(client, plan);
    await client.query("commit");
    return Object.freeze({
      contractVersion: "ai-content-database-role-apply-result.v1",
      planSha256: plan.planSha256,
      securityCatalogSha256: sha256Json({
        applicationRelationGrants: plan.applicationRelationGrants,
        applicationSequenceGrants: plan.applicationSequenceGrants,
        applicationSchemaPrivileges: plan.applicationSchemaPrivileges,
        applicationOwnedFunctions: plan.applicationOwnedFunctions,
        schemaOwnerRelationGrants: plan.schemaOwnerRelationGrants,
        migrationRelationGrants: plan.migrationRelationGrants,
        sharedOwnerTransfers: plan.sharedOwnerTransfers,
      }),
    });
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

function sharedAclWithoutControlledGrantees(snapshot, roleNames) {
  const controlled = new Set(Object.values(roleNames));
  return {
    relationAclRows: snapshot.relationAclRows.filter(({ granteeRoleName }) => !controlled.has(granteeRoleName)),
    columnAclRows: snapshot.columnAclRows.filter(({ granteeRoleName }) => !controlled.has(granteeRoleName)),
  };
}

function sharedApplicationAclRows(snapshot, applicationRoleName) {
  return snapshot.relationAclRows.filter(({ granteeRoleName }) => granteeRoleName === applicationRoleName)
    .map(({ relationName, privilege, grantable }) => ({ relationName, privilege, grantable }))
    .sort((left, right) => lexicalCompare(
      `${left.relationName}\0${left.privilege}\0${left.grantable}`,
      `${right.relationName}\0${right.privilege}\0${right.grantable}`,
    ));
}

function expectedSharedApplicationAclRows(plan) {
  const sharedNames = new Set(plan.sharedOwnerTransfers.map(({ relationName }) => relationName));
  return plan.applicationRelationGrants
    .filter(({ relationName }) => sharedNames.has(relationName))
    .flatMap(({ relationName, privileges }) => privileges.map((privilege) => ({
      relationName, privilege, grantable: false,
    }))).sort((left, right) => lexicalCompare(
      `${left.relationName}\0${left.privilege}\0${left.grantable}`,
      `${right.relationName}\0${right.privilege}\0${right.grantable}`,
    ));
}

async function verifyRestoredSharedRelationSecurity(client, plan) {
  await verifyApplicationRuntimeSecurity(client, plan, {
    sharedOwnerState: "restored",
    cutoverSecurityState: "post-cutover",
  });
  const restoredAcl = await readSharedRelationAclCatalog(
    client,
    plan.sharedOwnerTransfers.map(({ relationName }) => relationName),
  );
  const originalThirdPartyAcl = sharedAclWithoutControlledGrantees(
    plan.sharedRelationAclBefore,
    plan.roleNames,
  );
  const restoredThirdPartyAcl = sharedAclWithoutControlledGrantees(restoredAcl, plan.roleNames);
  if (canonicalJson(restoredThirdPartyAcl) !== canonicalJson(originalThirdPartyAcl)) {
    throw new Error("ai_content_shared_relation_acl_restore_invalid");
  }
  const expectedApplicationAcl = expectedSharedApplicationAclRows(plan);
  const controlledRoleNames = new Set(Object.values(plan.roleNames));
  const unexpectedControlledAcl = [
    ...restoredAcl.relationAclRows,
    ...restoredAcl.columnAclRows,
  ].filter(({ granteeRoleName }) => controlledRoleNames.has(granteeRoleName)
    && granteeRoleName !== plan.roleNames.applicationRoleName);
  if (canonicalJson(sharedApplicationAclRows(restoredAcl, plan.roleNames.applicationRoleName))
    !== canonicalJson(expectedApplicationAcl)
    || restoredAcl.columnAclRows.some(({ granteeRoleName }) => granteeRoleName === plan.roleNames.applicationRoleName)
    || unexpectedControlledAcl.length !== 0) {
    throw new Error("ai_content_shared_relation_application_acl_restore_invalid");
  }
  const ownerResult = await client.query(
    `/* ai_content_shared_relation_owner_after_restore */
     select requested.relation_name,pg_get_userbyid(relation.relowner)::text owner_role_name
       from unnest($1::text[]) requested(relation_name)
       join pg_class relation on relation.oid=to_regclass('public.'||requested.relation_name)
      order by requested.relation_name`,
    [plan.sharedOwnerTransfers.map(({ relationName }) => relationName)],
  );
  const expectedOwnerRows = plan.sharedOwnerTransfers.map(({ relationName, preservedOwnerRoleName }) => ({
    relation_name: relationName, owner_role_name: preservedOwnerRoleName,
  }));
  compareCatalogRows(ownerResult.rows, expectedOwnerRows, "ai_content_shared_relation_owner_restore_invalid");
  return {
    ownerRows: ownerResult.rows,
    originalThirdPartyAcl,
    restoredThirdPartyAcl,
    expectedApplicationAcl,
  };
}

export async function restoreSharedRelationOwners(client, rawPlan, { now = new Date() } = {}) {
  const plan = validatePlan(rawPlan);
  const identity = await client.query(
    `/* ai_content_shared_owner_restore_identity */
     select session_user::text session_user,current_user::text current_user`,
  );
  if (identity.rows.length !== 1 || identity.rows[0]?.session_user !== "postgres"
    || identity.rows[0]?.current_user !== "postgres") {
    throw new Error("ai_content_shared_owner_restore_provider_identity_invalid");
  }
  const migration = await migrationById(plan.cutoverMigration);
  await client.query("begin");
  try {
    const marker = await client.query(
      `/* ai_content_shared_owner_restore_cutover_marker */
       select id,checksum from public.schema_migrations where id=$1`,
      [migration.id],
    );
    if (marker.rows.length !== 1 || marker.rows[0]?.id !== migration.id
      || marker.rows[0]?.checksum !== migration.checksum) {
      throw new Error("ai_content_shared_owner_restore_cutover_marker_invalid");
    }
    const ownerState = await client.query(
      `/* ai_content_shared_relation_owner_restore_state */
       select requested.relation_name,pg_get_userbyid(relation.relowner)::text owner_role_name,
              requested.preserved_owner_role_name
         from unnest($1::text[],$2::text[]) requested(relation_name,preserved_owner_role_name)
         join pg_class relation on relation.oid=to_regclass('public.'||requested.relation_name)
        order by requested.relation_name`,
      [
        plan.sharedOwnerTransfers.map(({ relationName }) => relationName),
        plan.sharedOwnerTransfers.map(({ preservedOwnerRoleName }) => preservedOwnerRoleName),
      ],
    );
    const allTransferred = ownerState.rows.length === plan.sharedOwnerTransfers.length
      && ownerState.rows.every((row) => row.owner_role_name === plan.roleNames.schemaOwnerRoleName);
    const allRestored = ownerState.rows.length === plan.sharedOwnerTransfers.length
      && ownerState.rows.every((row) => row.owner_role_name === row.preserved_owner_role_name);
    if (!allTransferred && !allRestored) throw new Error("ai_content_shared_relation_owner_restore_state_invalid");
    if (allTransferred) {
      await verifyApplicationRuntimeSecurity(client, plan, {
        sharedOwnerState: "transferred",
        cutoverSecurityState: "post-cutover",
      });
      for (const { relationName, preservedOwnerRoleName } of plan.sharedOwnerTransfers) {
        await client.query(`alter table public.${quoteIdentifier(relationName)} owner to ${quoteIdentifier(preservedOwnerRoleName)}`);
        await client.query(`revoke all privileges on table public.${quoteIdentifier(relationName)} from ${quoteIdentifier(plan.roleNames.schemaOwnerRoleName)}`);
      }
    }
    const schemaOwnerColumnAcl = await client.query(
      `/* ai_content_restored_schema_owner_column_acl_to_scrub */
       select * from (
         select distinct relation.relname::text relation_name,attribute.attname::text column_name
           from pg_class relation
           join pg_namespace namespace on namespace.oid=relation.relnamespace and namespace.nspname='public'
           join pg_attribute attribute on attribute.attrelid=relation.oid
            and attribute.attnum>0 and not attribute.attisdropped
           cross join lateral aclexplode(attribute.attacl) acl
           join pg_roles grantee on grantee.oid=acl.grantee
          where relation.relname=any($1::text[]) and grantee.rolname=$2::name
       ) schema_owner_column_acl
        order by relation_name collate "C",column_name collate "C"`,
      [plan.sharedOwnerTransfers.map(({ relationName }) => relationName), plan.roleNames.schemaOwnerRoleName],
    );
    for (const row of schemaOwnerColumnAcl.rows) {
      await client.query(`revoke all privileges (${quoteIdentifier(String(row.column_name))}) on table public.${quoteIdentifier(String(row.relation_name))} from ${quoteIdentifier(plan.roleNames.schemaOwnerRoleName)}`);
    }
    const { ownerRows, originalThirdPartyAcl, restoredThirdPartyAcl, expectedApplicationAcl } =
      await verifyRestoredSharedRelationSecurity(client, plan);
    const evidence = {
      contractVersion: "ai-content-shared-owner-restore-evidence.v1",
      planSha256: plan.planSha256,
      cutoverMigrationId: migration.id,
      cutoverMigrationSha256: migration.checksum,
      providerSessionUser: "postgres",
      restoredRuntimeRoleName: plan.preservedRuntimeRoleName,
      restoredRelationCount: ownerRows.length,
      restoredOwnerCatalogSha256: sha256Json(ownerRows),
      originalThirdPartyAclSha256: sha256Json(originalThirdPartyAcl),
      restoredThirdPartyAclSha256: sha256Json(restoredThirdPartyAcl),
      applicationAclSha256: sha256Json(expectedApplicationAcl),
    };
    if (evidence.originalThirdPartyAclSha256 !== evidence.restoredThirdPartyAclSha256) {
      throw new Error("ai_content_shared_relation_acl_restore_invalid");
    }
    await client.query("commit");
    return Object.freeze(evidence);
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function setProvider075SchemaOwnerMembership(client, rawPlan, cutoverId, enabled) {
  const plan = validatePlan(rawPlan);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cutoverId)
    || typeof enabled !== "boolean") {
    throw new Error("cutover_075_provider_membership_input_invalid");
  }
  const identity = await client.query(`/* ai_content_075_provider_membership_identity */
    select session_user::text session_user,current_user::text current_user,
           role.rolsuper as is_superuser,role.rolinherit as inherit
      from pg_roles role where role.rolname=session_user`);
  const provider = identity.rows[0];
  if (!provider || provider.session_user !== plan.preservedRuntimeRoleName
    || provider.current_user !== plan.preservedRuntimeRoleName || provider.inherit !== true) {
    throw new Error("cutover_075_provider_membership_identity_invalid");
  }
  const state = await client.query(`/* ai_content_075_provider_membership_cutover */
    select cutover.status,maintenance.enabled as maintenance_enabled,
           exists(select 1 from public.schema_migrations where id=$2) as marker_present
      from public.ai_content_cutovers cutover
      join public.ai_content_maintenance_state maintenance
        on maintenance.singleton and maintenance.cutover_id=cutover.id
     where cutover.id=$1`, [cutoverId, plan.cutoverMigration]);
  const cutover = state.rows[0];
  const enablePhaseValid = (cutover?.status === "maintenance_verified" && cutover?.marker_present === false)
    || (cutover?.status === "migration_body_complete" && cutover?.marker_present === true);
  if (!cutover || cutover.maintenance_enabled !== true
    || (enabled && !enablePhaseValid)
    || (!enabled && !["maintenance_verified", "migration_body_complete"].includes(cutover.status))) {
    throw new Error("cutover_075_provider_membership_state_invalid");
  }
  if (provider.is_superuser === true) {
    return Object.freeze({
      contractVersion: "ai-content-075-provider-membership-evidence.v1",
      cutoverId, transientMembershipRequired: false, transientMembershipEnabled: false,
    });
  }
  const readMembership = async () => (await client.query(`/* ai_content_075_provider_membership_catalog */
    select grantor.rolname as grantor_role_name,membership.set_option,
           membership.inherit_option,membership.admin_option
      from pg_auth_members membership
      join pg_roles member on member.oid=membership.member
      join pg_roles parent on parent.oid=membership.roleid
      join pg_roles grantor on grantor.oid=membership.grantor
     where member.rolname=$1 and parent.rolname=$2
     order by grantor.rolname,membership.set_option,membership.inherit_option,membership.admin_option`,
  [plan.preservedRuntimeRoleName, plan.roleNames.schemaOwnerRoleName])).rows;
  const classify = (rows) => {
    const baseline = rows.filter((row) => row.grantor_role_name !== plan.preservedRuntimeRoleName
      && row.set_option === false && row.inherit_option === false && row.admin_option === true);
    const transient = rows.filter((row) => row.grantor_role_name === plan.preservedRuntimeRoleName
      && row.set_option === true && row.inherit_option === true && row.admin_option === false);
    if (baseline.length !== 1 || rows.length !== baseline.length + transient.length || transient.length > 1) {
      throw new Error("cutover_075_provider_membership_catalog_invalid");
    }
    return { baseline, transient };
  };
  await client.query("begin");
  try {
    const before = await readMembership();
    const beforeState = classify(before);
    if (enabled) {
      if (beforeState.transient.length === 0) {
        await client.query(`grant ${quoteIdentifier(plan.roleNames.schemaOwnerRoleName)}
          to ${quoteIdentifier(plan.preservedRuntimeRoleName)} with inherit true`);
      }
    } else if (beforeState.transient.length === 1) {
      await client.query(`revoke ${quoteIdentifier(plan.roleNames.schemaOwnerRoleName)}
        from ${quoteIdentifier(plan.preservedRuntimeRoleName)}
        granted by ${quoteIdentifier(plan.preservedRuntimeRoleName)}`);
    }
    const after = await readMembership();
    const afterState = classify(after);
    if (afterState.transient.length !== (enabled ? 1 : 0)) {
      throw new Error("cutover_075_provider_membership_transition_invalid");
    }
    await client.query("commit");
    return Object.freeze({
      contractVersion: "ai-content-075-provider-membership-evidence.v1",
      cutoverId, transientMembershipRequired: true, transientMembershipEnabled: enabled,
      baselineCatalogSha256: sha256Json(beforeState.baseline),
      resultCatalogSha256: sha256Json(after),
    });
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

const cleanupRetirementCommentPrefix = "ai-content-cleanup-retirement:";
const cleanupRetirementPayloadKeys = Object.freeze([
  "contractVersion", "planSha256", "cutoverId", "cutoverMigrationId", "cutoverMigrationSha256",
  "providerSessionUser", "cleanupRoleName", "retiredAt", "outboxRowCount", "outboxStatusCatalogSha256",
  "sharedOwnerCatalogSha256", "sharedThirdPartyAclSha256", "cleanupRoleCatalogSha256",
  "cleanupAclCatalogSha256", "cleanupMembershipCatalogSha256",
]);

function exactIsoTimestamp(value, errorCode) {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(timestamp.getTime())) throw new Error(errorCode);
  const iso = timestamp.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso)) throw new Error(errorCode);
  return iso;
}

function validateCleanupRetirementEvidence(value, plan, cutoverId, migration) {
  if (!record(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...cleanupRetirementPayloadKeys, "evidenceSha256"].sort())
    || value.contractVersion !== "ai-content-cleanup-role-retirement-evidence.v1"
    || value.planSha256 !== plan.planSha256
    || value.cutoverId !== cutoverId
    || value.cutoverMigrationId !== migration.id
    || value.cutoverMigrationSha256 !== migration.checksum
    || value.cleanupRoleName !== plan.roleNames.cleanupRoleName
    || value.providerSessionUser !== "postgres"
    || !Number.isInteger(value.outboxRowCount) || value.outboxRowCount < 0
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.retiredAt ?? "")
    || ["cutoverMigrationSha256", "outboxStatusCatalogSha256", "sharedOwnerCatalogSha256",
      "sharedThirdPartyAclSha256", "cleanupRoleCatalogSha256", "cleanupAclCatalogSha256",
      "cleanupMembershipCatalogSha256", "evidenceSha256"].some((key) => !/^[0-9a-f]{64}$/.test(value[key] ?? ""))) {
    throw new Error("ai_content_cleanup_role_retirement_evidence_invalid");
  }
  const payload = Object.fromEntries(cleanupRetirementPayloadKeys.map((key) => [key, value[key]]));
  if (value.evidenceSha256 !== sha256Json(payload)) {
    throw new Error("ai_content_cleanup_role_retirement_evidence_invalid");
  }
  return value;
}

async function readCleanupRoleSecurityCatalog(client, cleanupRoleName) {
  const role = await client.query(
    `/* ai_content_cleanup_role_retirement_role_catalog */
     select role.rolname::text role_name,role.rolcanlogin can_login,role.rolsuper is_superuser,
            role.rolbypassrls bypass_rls,role.rolcreatedb can_create_db,
            role.rolcreaterole can_create_role,role.rolreplication can_replicate,
            role.rolinherit inherit,role.rolconfig config,
            auth.rolpassword is null password_is_null,
            shobj_description(role.oid,'pg_authid') role_comment
       from pg_roles role join pg_authid auth on auth.oid=role.oid
      where role.rolname=$1::name`,
    [cleanupRoleName],
  );
  const acl = await client.query(
    `/* ai_content_cleanup_role_retirement_acl_catalog */
     with cleanup_role as (select oid from pg_roles where rolname=$1::name), acl_rows as (
       select 'relation'::text object_kind,namespace.nspname||'.'||relation.relname object_identity,
              null::text column_name,acl.privilege_type::text privilege,acl.is_grantable grantable
         from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
         cross join cleanup_role cross join lateral aclexplode(relation.relacl) acl
        where acl.grantee=cleanup_role.oid
       union all
       select 'column',namespace.nspname||'.'||relation.relname,attribute.attname::text,
              acl.privilege_type::text,acl.is_grantable
         from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
         join pg_attribute attribute on attribute.attrelid=relation.oid
          and attribute.attnum>0 and not attribute.attisdropped
         cross join cleanup_role cross join lateral aclexplode(attribute.attacl) acl
        where acl.grantee=cleanup_role.oid
       union all
       select 'function',namespace.nspname||'.'||function.proname||'('||pg_get_function_identity_arguments(function.oid)||')',
              null::text,acl.privilege_type::text,acl.is_grantable
         from pg_proc function join pg_namespace namespace on namespace.oid=function.pronamespace
         cross join cleanup_role cross join lateral aclexplode(function.proacl) acl
        where acl.grantee=cleanup_role.oid
       union all
       select 'schema',namespace.nspname,null::text,acl.privilege_type::text,acl.is_grantable
         from pg_namespace namespace cross join cleanup_role
         cross join lateral aclexplode(namespace.nspacl) acl where acl.grantee=cleanup_role.oid
       union all
       select 'database',database.datname,null::text,acl.privilege_type::text,acl.is_grantable
         from pg_database database cross join cleanup_role
         cross join lateral aclexplode(database.datacl) acl where acl.grantee=cleanup_role.oid
     ) select * from acl_rows
      order by object_kind collate "C",object_identity collate "C",column_name collate "C" nulls first,
               privilege collate "C",grantable`,
    [cleanupRoleName],
  );
  const memberships = await client.query(
    `/* ai_content_cleanup_role_retirement_membership_catalog */
     select member.rolname::text member_role_name,parent.rolname::text parent_role_name,
            membership.admin_option,membership.inherit_option,membership.set_option
       from pg_auth_members membership
       join pg_roles member on member.oid=membership.member
       join pg_roles parent on parent.oid=membership.roleid
      where member.rolname=$1::name or parent.rolname=$1::name
      order by member.rolname collate "C",parent.rolname collate "C"`,
    [cleanupRoleName],
  );
  return { roleRows: role.rows, aclRows: acl.rows, membershipRows: memberships.rows };
}

function assertCleanupRoleRetiredCatalog(catalog, cleanupRoleName) {
  if (catalog.roleRows.length !== 1) throw new Error("ai_content_cleanup_role_retirement_role_invalid");
  const role = catalog.roleRows[0];
  if (role.role_name !== cleanupRoleName || role.can_login !== false || role.is_superuser !== false
    || role.bypass_rls !== false || role.can_create_db !== false || role.can_create_role !== false
    || role.can_replicate !== false || role.inherit !== true || role.password_is_null !== true
    || (role.config != null && (!Array.isArray(role.config) || role.config.length !== 0))
    || catalog.aclRows.length !== 0 || catalog.membershipRows.length !== 0) {
    throw new Error("ai_content_cleanup_role_retirement_role_invalid");
  }
}

export async function retireCleanupRole(client, rawPlan, cutoverId) {
  const plan = validatePlan(rawPlan);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cutoverId ?? "")) {
    throw new Error("ai_content_cleanup_role_retirement_cutover_id_invalid");
  }
  const identity = await client.query(
    `/* ai_content_cleanup_role_retirement_identity */
     select session_user::text session_user,current_user::text current_user`,
  );
  if (identity.rows.length !== 1 || identity.rows[0]?.session_user !== "postgres"
    || identity.rows[0]?.current_user !== "postgres") {
    throw new Error("ai_content_cleanup_role_retirement_provider_identity_invalid");
  }
  const migration = await migrationById(plan.cutoverMigration);
  await client.query("begin");
  try {
    const marker = await client.query(
      `/* ai_content_cleanup_role_retirement_cutover_marker */
       select id,checksum from public.schema_migrations where id=$1`,
      [migration.id],
    );
    if (marker.rows.length !== 1 || marker.rows[0]?.checksum !== migration.checksum) {
      throw new Error("ai_content_cleanup_role_retirement_cutover_marker_invalid");
    }
    const cutover = await client.query(
      `/* ai_content_cleanup_role_retirement_cutover_state */
       select status,cleanup_credential_revoked_at,cleanup_revocation_evidence_sha256
         from public.ai_content_cutovers where id=$1::uuid for update`,
      [cutoverId],
    );
    if (cutover.rows.length !== 1 || !["backend_verified", "completed"].includes(cutover.rows[0]?.status)) {
      throw new Error("ai_content_cleanup_role_retirement_cutover_state_invalid");
    }
    const cleanupSealPresent = cutover.rows[0].cleanup_credential_revoked_at != null
      && cutover.rows[0].cleanup_revocation_evidence_sha256 != null;
    if ((cutover.rows[0].cleanup_credential_revoked_at == null) !==
      (cutover.rows[0].cleanup_revocation_evidence_sha256 == null)
      || (cutover.rows[0].status === "completed" && !cleanupSealPresent)) {
      throw new Error("ai_content_cleanup_role_retirement_cutover_state_invalid");
    }
    const sharedSecurity = await verifyRestoredSharedRelationSecurity(client, plan);
    const outbox = await client.query(
      `/* ai_content_cleanup_role_retirement_outbox_catalog */
       select status,count(*)::integer row_count
         from public.ai_content_storage_cleanup_outbox where cutover_id=$1::uuid
        group by status order by status collate "C"`,
      [cutoverId],
    );
    if (outbox.rows.some((row) => !["deleted", "retained_reference"].includes(String(row.status)))) {
      throw new Error("ai_content_cleanup_role_retirement_outbox_not_terminal");
    }
    const cleanupRoleName = plan.roleNames.cleanupRoleName;
    const beforeCatalog = await readCleanupRoleSecurityCatalog(client, cleanupRoleName);
    const existingComment = beforeCatalog.roleRows[0]?.role_comment;
    if (typeof existingComment === "string" && existingComment.startsWith(cleanupRetirementCommentPrefix)) {
      const evidence = validateCleanupRetirementEvidence(
        JSON.parse(existingComment.slice(cleanupRetirementCommentPrefix.length)),
        plan,
        cutoverId,
        migration,
      );
      assertCleanupRoleRetiredCatalog(beforeCatalog, cleanupRoleName);
      const revokedAt = cleanupSealPresent
        ? exactIsoTimestamp(
          cutover.rows[0].cleanup_credential_revoked_at,
          "ai_content_cleanup_role_retirement_replay_invalid",
        )
        : null;
      const liveOutboxRowCount = outbox.rows.reduce((total, row) => total + Number(row.row_count), 0);
      const liveRoleRows = beforeCatalog.roleRows.map(({ role_comment, ...role }) => role);
      if (!cleanupSealPresent || revokedAt !== evidence.retiredAt
        || cutover.rows[0].cleanup_revocation_evidence_sha256 !== evidence.evidenceSha256
        || evidence.outboxRowCount !== liveOutboxRowCount
        || evidence.outboxStatusCatalogSha256 !== sha256Json(outbox.rows)
        || evidence.sharedOwnerCatalogSha256 !== sha256Json(sharedSecurity.ownerRows)
        || evidence.sharedThirdPartyAclSha256 !== sha256Json(sharedSecurity.restoredThirdPartyAcl)
        || evidence.cleanupRoleCatalogSha256 !== sha256Json(liveRoleRows)
        || evidence.cleanupAclCatalogSha256 !== sha256Json(beforeCatalog.aclRows)
        || evidence.cleanupMembershipCatalogSha256 !== sha256Json(beforeCatalog.membershipRows)) {
        throw new Error("ai_content_cleanup_role_retirement_replay_invalid");
      }
      await client.query("commit");
      return Object.freeze(evidence);
    }
    if (existingComment != null) throw new Error("ai_content_cleanup_role_retirement_comment_conflict");
    if (cutover.rows[0].status !== "backend_verified" || cleanupSealPresent) {
      throw new Error("ai_content_cleanup_role_retirement_cutover_state_invalid");
    }
    const ownedObjects = await client.query(
      `/* ai_content_cleanup_role_retirement_owned_objects */
       with cleanup_role as (select oid from pg_roles where rolname=$1::name)
       select (select count(*) from pg_class,cleanup_role where relowner=cleanup_role.oid)::integer relation_count,
              (select count(*) from pg_proc,cleanup_role where proowner=cleanup_role.oid)::integer function_count,
              (select count(*) from pg_namespace,cleanup_role where nspowner=cleanup_role.oid)::integer schema_count,
              (select count(*) from pg_database,cleanup_role where datdba=cleanup_role.oid)::integer database_count`,
      [cleanupRoleName],
    );
    if (!ownedObjects.rows[0] || Object.values(ownedObjects.rows[0]).some((count) => Number(count) !== 0)) {
      throw new Error("ai_content_cleanup_role_retirement_owned_objects_invalid");
    }
    for (const membership of beforeCatalog.membershipRows) {
      if (membership.member_role_name === cleanupRoleName) {
        await client.query(`revoke ${quoteIdentifier(String(membership.parent_role_name))} from ${quoteIdentifier(cleanupRoleName)}`);
      } else {
        await client.query(`revoke ${quoteIdentifier(cleanupRoleName)} from ${quoteIdentifier(String(membership.member_role_name))}`);
      }
    }
    const columnAcl = await client.query(
      `/* ai_content_cleanup_role_retirement_column_acl_to_revoke */
       select * from (
         select distinct namespace.nspname::text schema_name,relation.relname::text relation_name,
                attribute.attname::text column_name
           from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
           join pg_attribute attribute on attribute.attrelid=relation.oid
            and attribute.attnum>0 and not attribute.attisdropped
           cross join lateral aclexplode(attribute.attacl) acl
           join pg_roles grantee on grantee.oid=acl.grantee
          where grantee.rolname=$1::name
       ) cleanup_column_acl
        order by schema_name collate "C",relation_name collate "C",column_name collate "C"`,
      [cleanupRoleName],
    );
    for (const row of columnAcl.rows) {
      await client.query(`revoke all privileges (${quoteIdentifier(String(row.column_name))}) on table ${quoteIdentifier(String(row.schema_name))}.${quoteIdentifier(String(row.relation_name))} from ${quoteIdentifier(cleanupRoleName)}`);
    }
    await client.query(`revoke all privileges on all tables in schema public from ${quoteIdentifier(cleanupRoleName)}`);
    await client.query(`revoke all privileges on all sequences in schema public from ${quoteIdentifier(cleanupRoleName)}`);
    await client.query(`revoke all privileges on all functions in schema public from ${quoteIdentifier(cleanupRoleName)}`);
    await client.query(`revoke all privileges on schema public from ${quoteIdentifier(cleanupRoleName)}`);
    await client.query(`revoke all privileges on database ${quoteIdentifier(plan.databaseName)} from ${quoteIdentifier(cleanupRoleName)}`);
    await client.query(`alter role ${quoteIdentifier(cleanupRoleName)} nologin inherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication password null`);
    await client.query(`alter role ${quoteIdentifier(cleanupRoleName)} reset all`);
    const retiredCatalog = await readCleanupRoleSecurityCatalog(client, cleanupRoleName);
    assertCleanupRoleRetiredCatalog(retiredCatalog, cleanupRoleName);
    const transactionClock = await client.query(
      `/* ai_content_cleanup_role_retirement_transaction_clock */
       select transaction_timestamp() retired_at`,
    );
    const retiredAt = exactIsoTimestamp(
      transactionClock.rows[0]?.retired_at,
      "ai_content_cleanup_role_retirement_timestamp_invalid",
    );
    const payload = {
      contractVersion: "ai-content-cleanup-role-retirement-evidence.v1",
      planSha256: plan.planSha256,
      cutoverId,
      cutoverMigrationId: migration.id,
      cutoverMigrationSha256: migration.checksum,
      providerSessionUser: "postgres",
      cleanupRoleName,
      retiredAt,
      outboxRowCount: outbox.rows.reduce((total, row) => total + Number(row.row_count), 0),
      outboxStatusCatalogSha256: sha256Json(outbox.rows),
      sharedOwnerCatalogSha256: sha256Json(sharedSecurity.ownerRows),
      sharedThirdPartyAclSha256: sha256Json(sharedSecurity.restoredThirdPartyAcl),
      cleanupRoleCatalogSha256: sha256Json(retiredCatalog.roleRows.map(({ role_comment, ...role }) => role)),
      cleanupAclCatalogSha256: sha256Json(retiredCatalog.aclRows),
      cleanupMembershipCatalogSha256: sha256Json(retiredCatalog.membershipRows),
    };
    const evidence = Object.freeze({ ...payload, evidenceSha256: sha256Json(payload) });
    await client.query(`comment on role ${quoteIdentifier(cleanupRoleName)} is ${quoteLiteral(`${cleanupRetirementCommentPrefix}${canonicalJson(evidence)}`)}`);
    const seal = await client.query(
      `/* ai_content_cleanup_role_retirement_cutover_seal */
       update public.ai_content_cutovers
          set cleanup_credential_revoked_at=$2::timestamptz,
              cleanup_revocation_evidence_sha256=$3::text
        where id=$1::uuid and status='backend_verified'
          and cleanup_credential_revoked_at is null
          and cleanup_revocation_evidence_sha256 is null
      returning cleanup_credential_revoked_at,cleanup_revocation_evidence_sha256`,
      [cutoverId, retiredAt, evidence.evidenceSha256],
    );
    if (seal.rows.length !== 1) {
      throw new Error("ai_content_cleanup_role_retirement_cutover_seal_invalid");
    }
    const sealedAt = exactIsoTimestamp(
      seal.rows[0].cleanup_credential_revoked_at,
      "ai_content_cleanup_role_retirement_cutover_seal_invalid",
    );
    if (sealedAt !== retiredAt
      || seal.rows[0]?.cleanup_revocation_evidence_sha256 !== evidence.evidenceSha256) {
      throw new Error("ai_content_cleanup_role_retirement_cutover_seal_invalid");
    }
    const sealedCatalog = await readCleanupRoleSecurityCatalog(client, cleanupRoleName);
    assertCleanupRoleRetiredCatalog(sealedCatalog, cleanupRoleName);
    if (sealedCatalog.roleRows[0]?.role_comment !==
      `${cleanupRetirementCommentPrefix}${canonicalJson(evidence)}`) {
      throw new Error("ai_content_cleanup_role_retirement_comment_invalid");
    }
    await client.query("commit");
    return evidence;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

function privateKey(identity) {
  const key = identity?.privateKey?.type ? identity.privateKey : createPrivateKey(identity?.privateKeyPem ?? "");
  if (key.asymmetricKeyType !== "ed25519") throw new Error("ai_content_signing_key_invalid");
  return key;
}

function validateSigningIdentity(identity) {
  if (!identity || !/^[A-Za-z0-9._:-]{1,128}$/.test(identity.keyId ?? "")
    || !/^[0-9a-f]{64}$/.test(identity.publicKeySha256 ?? "")) throw new Error("ai_content_signing_identity_invalid");
  privateKey(identity);
  return identity;
}

function signedEnvelope(payload, identity, canonicalize) {
  validateSigningIdentity(identity);
  const unsigned = { ...payload, algorithm: "Ed25519", keyId: identity.keyId };
  return { ...unsigned, signature: sign(null, Buffer.from(canonicalize(unsigned)), privateKey(identity)).toString("base64") };
}

export function signBootstrap074Authorization({
  migration, roleNames, roleCatalogSha256, objectCatalogSha256,
  eventTriggerFunctionSha256, eventBefore, imageDigest, imageSourceLabel,
  requestId, issuedAt, authorizationIdentity, providerIdentity,
}) {
  validateRoleNames(roleNames);
  validateSigningIdentity(authorizationIdentity);
  validateSigningIdentity(providerIdentity);
  const base = {
    contractVersion: "ai-content-bootstrap-role-authorization.v4", requestId,
    migrationId: migration.id, migrationSha256: migration.checksum,
    imageDigest, imageSourceLabel, roleCatalogSha256, objectCatalogSha256,
    ...roleNames,
    eventTriggerName: "ai_content_ddl_guard_074",
    eventTriggerFunction: "public.enforce_ai_content_ddl_allowlist",
    eventTriggerFunctionSha256,
    eventTriggerEvent: "ddl_command_end", eventTriggerOwner: "postgres", eventTriggerTags: [],
    eventTriggerDefinitionSha256: "0".repeat(64),
    eventTriggerCatalogBeforeSha256: eventBefore.catalogSha256,
    eventTriggerCatalogBeforeCount: eventBefore.count,
    issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + 10 * 60_000).toISOString(),
    algorithm: "Ed25519", keyId: authorizationIdentity.keyId,
    providerAttestationKeyId: providerIdentity.keyId,
    providerAttestationPublicKeySha256: providerIdentity.publicKeySha256,
    providerEnforcementBundleSha256,
  };
  base.eventTriggerDefinitionSha256 = hashEventTriggerDefinition({ ...base, eventTriggerEnabled: "enabled" });
  return {
    ...base,
    signature: sign(null, Buffer.from(canonicalBootstrapAuthorizationPayload(base)), privateKey(authorizationIdentity)).toString("base64"),
  };
}

export function buildAndSign075Allowlist({
  migration, roleNames, cutoverId, enforcementCatalogSha256, beforeRows,
  legacyAclRevocations = [], requestId, issuedAt, authorizationIdentity, providerIdentity,
}) {
  const rows = buildCutover075ExactDdlAllowlist(
    migration, validateRoleNames(roleNames), legacyAclRevocations,
  );
  const rowsSha256 = hashCutoverDdlAllowlist(rows);
  const authorizationBase = {
    contractVersion: "ai-content-075-ddl-allowlist-authorization.v1",
    requestId, cutoverId, migrationId: migration.id, migrationSha256: migration.checksum,
    rows, rowsSha256, enforcementCatalogSha256, issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + 10 * 60_000).toISOString(),
    providerAttestationKeyId: providerIdentity.keyId,
    providerAttestationPublicKeySha256: providerIdentity.publicKeySha256,
  };
  const authorization = signedEnvelope(
    authorizationBase, authorizationIdentity, canonicalCutoverAllowlistAuthorizationPayload,
  );
  const requestSha256 = hashCutoverAllowlistAuthorizationEnvelope(authorization);
  const attestation = signedEnvelope({
    contractVersion: "ai-content-075-ddl-allowlist-attestation.v1",
    action: "install_verify_075_ddl_allowlist", requestId, requestSha256,
    cutoverId, migrationId: migration.id, migrationSha256: migration.checksum, rowsSha256,
    beforeCount: beforeRows.length, beforeSha256: hashCutoverDdlAllowlist(beforeRows),
    afterCount: rows.length, afterSha256: rowsSha256,
    issuedAt,
  }, providerIdentity, canonicalCutoverAllowlistAttestationPayload);
  return { authorization, attestation };
}

export async function readCutover075LegacyAclRevocations(client) {
  const relationNames = cutover075RelationSecurityCatalog.map(({ relationName }) => relationName);
  const functionIdentities = cutover075SecurityFunctions.map(({ identity }) => identity);
  const result = await client.query(
    `/* cutover_075_live_legacy_acl_revocations_v1 */
     with relation_acl as (
       select 'table:public.'||expected.relation_name as object_identity,grantee.rolname as grantee
         from unnest($1::text[]) as expected(relation_name)
         join pg_class relation on relation.oid=to_regclass('public.'||expected.relation_name)
         cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
         join pg_roles grantee on grantee.oid=acl.grantee
        where acl.grantee<>relation.relowner
     ), function_acl as (
       select 'function:'||expected.identity as object_identity,grantee.rolname as grantee
         from unnest($2::text[]) as expected(identity)
         join pg_proc function on function.oid=to_regprocedure(expected.identity)
         cross join lateral aclexplode(coalesce(function.proacl,acldefault('f',function.proowner))) acl
         join pg_roles grantee on grantee.oid=acl.grantee
        where acl.grantee<>function.proowner
     )
     select distinct 'REVOKE' as command_tag,object_identity||'|'||grantee||'|ALL' as object_identity_pattern
       from (select * from relation_acl union all select * from function_acl) live_acl
      order by command_tag,object_identity_pattern`,
    [relationNames, functionIdentities],
  );
  return result.rows.map((row) => ({
    commandTag: String(row.command_tag),
    objectIdentityPattern: String(row.object_identity_pattern),
  }));
}

export async function ensureCutover075Pg17AclCompatibility({
  client, migration074, roleNames, sealedCatalog, sealedCatalogSha256,
}) {
  const version = await client.query("select current_setting('server_version_num')::integer as server_version_num");
  const serverVersionNum = Number(version.rows[0]?.server_version_num);
  if (serverVersionNum < 170000) return { applied: false, serverVersionNum };
  const readLive = () => readFenceSecurityCatalog(client, roleNames, { ownerRoleName: "postgres" });
  let liveFence = await readLive();
  if (liveFence.catalogSha256 === sealedCatalogSha256) {
    const compatibility = buildCutover075Pg17AclCompatibility(migration074);
    await client.query("begin");
    try {
      await client.query(compatibility.sql);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    liveFence = await readLive();
  }
  const compatibility = validateCutover075Pg17AclCompatibilityCatalog({
    liveFence, sealedCatalog, migration074, serverVersionNum,
  });
  return {
    applied: true, serverVersionNum,
    sourceSha256: compatibility.sourceSha256,
    catalogSha256: liveFence.catalogSha256,
    stableCoreSha256: liveFence.stableCoreSha256,
  };
}

export async function buildBootstrap074AuthorizationFromDatabase({
  client, migration, plan: rawPlan, imageDigest, imageSourceLabel, requestId,
  issuedAt, authorizationIdentity, providerIdentity,
}) {
  const plan = validatePlan(rawPlan);
  const catalogs = await readCanonicalBootstrapCatalogs(client, plan.roleNames);
  const eventBefore = await readCanonicalEventTriggerCatalog(client);
  await client.query("begin");
  let eventTriggerFunctionSha256;
  try {
    await client.query(`set local role ${quoteIdentifier(plan.roleNames.schemaOwnerRoleName)}`);
    await client.query(unwrapFileTransaction(migration.sql));
    const definition = await client.query(
      "select pg_get_functiondef('public.enforce_ai_content_ddl_allowlist()'::regprocedure) as definition",
    );
    eventTriggerFunctionSha256 = sha256(String(definition.rows[0]?.definition ?? ""));
  } finally {
    await client.query("rollback");
  }
  if (!/^[0-9a-f]{64}$/.test(eventTriggerFunctionSha256)) throw new Error("bootstrap_074_event_function_missing");
  return signBootstrap074Authorization({
    migration, roleNames: plan.roleNames,
    roleCatalogSha256: catalogs.roleCatalogSha256,
    objectCatalogSha256: catalogs.objectCatalogSha256,
    eventTriggerFunctionSha256, eventBefore, imageDigest, imageSourceLabel,
    requestId, issuedAt, authorizationIdentity, providerIdentity,
  });
}

function exactJson(left, right) { return canonicalJson(left) === canonicalJson(right); }

async function probeProvider074Capability(client) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const functionName = `ai_content_074_capability_${suffix}`;
  const triggerName = `ai_content_074_capability_${suffix}`;
  await client.query("begin");
  try {
    await client.query(
      `create function public.${quoteIdentifier(functionName)}() returns event_trigger
         language plpgsql set search_path=pg_catalog,public as 'begin end'`,
    );
    await client.query(
      `create event trigger ${quoteIdentifier(triggerName)} on ddl_command_end
         execute function public.${quoteIdentifier(functionName)}()`,
    );
    await client.query(`drop event trigger ${quoteIdentifier(triggerName)}`);
    await client.query(`drop function public.${quoteIdentifier(functionName)}()`);
  } catch {
    throw new Error("bootstrap_074_provider_capability_required");
  } finally {
    await client.query("rollback");
  }
}

export async function installProvider074EnforcementBundle({
  client, migrationClient, migration, plan: rawPlan, authorization, installRequest,
  authorizationIdentity, providerIdentity, now = new Date(),
}) {
  const plan = validatePlan(rawPlan);
  const authorizationVerification = {
    publicKeyPem: authorizationIdentity.publicKeyPem,
    expectedKeyId: authorizationIdentity.keyId,
    expectedPublicKeySha256: authorizationIdentity.publicKeySha256,
  };
  const providerVerification = {
    publicKeyPem: providerIdentity.publicKeyPem,
    expectedKeyId: providerIdentity.keyId,
    expectedPublicKeySha256: providerIdentity.publicKeySha256,
  };
  const identity = await client.query("select session_user,current_user");
  if (identity.rows[0]?.session_user !== "postgres"
    || identity.rows[0]?.current_user !== "postgres") {
    throw new Error("bootstrap_074_provider_identity_invalid");
  }
  const recoveryResult = await client.query(
    `/* provider_074_artifact_recovery_v1 */
     select authorization_request_id,authorization_sha256,install_request_json,install_request_sha256,
            final_fence_security_catalog_sha256,event_trigger_catalog_after_sha256,
            event_trigger_catalog_after_count,provider_attestation_json,
            provider_attestation_sha256,revocation_request_json,revocation_request_sha256
       from ai_content_bootstrap_state where singleton`,
  );
  const recovery = recoveryResult.rows[0];
  if (!recovery) throw new Error("bootstrap_074_provider_state_missing");
  const { signature: _authorizationSignature, ...authorizationPayload } = authorization;
  const authorizationSha256 = sha256(canonicalBootstrapAuthorizationPayload(authorizationPayload));
  if (recovery.authorization_request_id !== authorization.requestId
    || recovery.authorization_sha256 !== authorizationSha256
    || !exactJson(recovery.install_request_json, installRequest)
    || recovery.install_request_sha256 !== installRequest.requestSha256) {
    throw new Error("bootstrap_074_install_request_mismatch");
  }
  const recoveryFields = [
    recovery.provider_attestation_json, recovery.provider_attestation_sha256,
    recovery.revocation_request_json, recovery.revocation_request_sha256,
    recovery.final_fence_security_catalog_sha256, recovery.event_trigger_catalog_after_sha256,
    recovery.event_trigger_catalog_after_count,
  ];
  const recoveryPresent = recoveryFields.some((value) => value !== null && value !== undefined);
  if (recoveryPresent && recoveryFields.some((value) => value === null || value === undefined)) {
    throw new Error("bootstrap_074_provider_artifact_state_incomplete");
  }
  const catalogs = await readCanonicalBootstrapCatalogs(migrationClient, plan.roleNames);
  if (recoveryPresent) {
    validateBootstrapRoleAuthorization(authorization, {
      migration, roleCatalogSha256: catalogs.roleCatalogSha256,
      objectCatalogSha256: catalogs.objectCatalogSha256,
      eventTriggerCatalogBeforeSha256: authorization.eventTriggerCatalogBeforeSha256,
      eventTriggerCatalogBeforeCount: authorization.eventTriggerCatalogBeforeCount,
      imageDigest: authorization.imageDigest, imageSourceLabel: authorization.imageSourceLabel,
      authorizationVerification, providerAttestationVerification: providerVerification, now,
      allowExpiredSealed: true,
    });
    const finalFence = await readFenceSecurityCatalog(client, plan.roleNames, { ownerRoleName: "postgres" });
    const eventAfter = await readCanonicalEventTriggerCatalog(client);
    const eventDelta = validateEventTriggerCatalogDelta(
      JSON.stringify(installRequest.eventTriggerCatalogBefore), eventAfter.rows, authorization,
    );
    if (finalFence.catalogSha256 !== installRequest.expectedFinalFenceSecurityCatalogSha256
      || finalFence.catalogSha256 !== recovery.final_fence_security_catalog_sha256
      || eventDelta.catalogSha256 !== eventAfter.catalogSha256
      || eventDelta.count !== eventAfter.count
      || eventAfter.catalogSha256 !== recovery.event_trigger_catalog_after_sha256
      || eventAfter.count !== recovery.event_trigger_catalog_after_count) {
      throw new Error("bootstrap_074_provider_recovery_live_state_mismatch");
    }
    const attestation = validateProviderEventTriggerAttestation(recovery.provider_attestation_json, {
      authorization, installRequest, providerAttestationVerification: providerVerification,
      finalFenceSecurityCatalogSha256: finalFence.catalogSha256, now, allowExpiredSealed: true,
    });
    const attestationSha256 = hashProviderAttestationEnvelope(attestation);
    if (attestationSha256 !== recovery.provider_attestation_sha256) {
      throw new Error("provider_attestation_envelope_hash_mismatch");
    }
    const revocation = buildMembershipRevocationRequest(authorization, installRequest, attestationSha256);
    validateMembershipRevocationEvidence(
      recovery.revocation_request_json, revocation, recovery.revocation_request_sha256,
    );
    return { attestation, revocation };
  }
  await probeProvider074Capability(client);
  const eventBefore = await readCanonicalEventTriggerCatalog(client);
  validateBootstrapRoleAuthorization(authorization, {
    migration, roleCatalogSha256: catalogs.roleCatalogSha256,
    objectCatalogSha256: catalogs.objectCatalogSha256,
    eventTriggerCatalogBeforeSha256: eventBefore.catalogSha256,
    eventTriggerCatalogBeforeCount: eventBefore.count,
    imageDigest: authorization.imageDigest, imageSourceLabel: authorization.imageSourceLabel,
    authorizationVerification, providerAttestationVerification: providerVerification, now,
    allowExpiredSealed: true,
  });
  const interim = await readFenceSecurityCatalog(client, plan.roleNames);
  const expectedInstall = buildProviderEventTriggerInstallRequest(authorization, {
    fenceSecurityCatalogSha256: interim.catalogSha256,
    fenceSecurityCatalogCanonicalJson: interim.canonicalJson,
    eventTriggerCatalogBeforeCanonicalJson: eventBefore.canonicalJson,
  });
  if (!exactJson(expectedInstall, installRequest)) throw new Error("bootstrap_074_install_request_mismatch");
  await client.query("begin");
  try {
    await client.query(
      `/* bootstrap_074_provider_owner_membership */
       grant ${quoteIdentifier(plan.roleNames.schemaOwnerRoleName)}
          to ${quoteIdentifier(plan.preservedRuntimeRoleName)}
        with set true, inherit true, admin false`,
    );
    const allRoles = ["public", ...Object.values(plan.roleNames)];
    for (const functionIdentity of providerEnforcementBundle.functions) {
      await client.query(`alter function ${functionIdentity} owner to postgres`);
      await client.query(`revoke all on function ${functionIdentity} from ${allRoles.map((name) => name === "public" ? "public" : quoteIdentifier(name)).join(",")}`);
      if (functionIdentity.includes("assert_ai_content_writable")) {
        await client.query(`grant execute on function ${functionIdentity} to ${quoteIdentifier(plan.roleNames.applicationRoleName)}`);
      }
      if (/prepare_ai_content_cutover|set_ai_content_maintenance/.test(functionIdentity)) {
        await client.query(`grant execute on function ${functionIdentity} to ${quoteIdentifier(plan.roleNames.operatorRoleName)}`);
      }
      if (functionIdentity.includes("read_ai_content_cutover_control_state")) {
        await client.query(`grant execute on function ${functionIdentity} to ${quoteIdentifier(plan.roleNames.operatorRoleName)}`);
      }
      if (functionIdentity.includes("transition_ai_content_cutover_status")) {
        await client.query(`grant execute on function ${functionIdentity} to ${quoteIdentifier(plan.roleNames.operatorRoleName)},${quoteIdentifier(plan.roleNames.migrationRoleName)}`);
      }
      if (functionIdentity.includes("register_ai_content_075_fence_relations")) {
        await client.query(`grant execute on function ${functionIdentity} to ${quoteIdentifier(plan.roleNames.migrationRoleName)},${quoteIdentifier(plan.roleNames.schemaOwnerRoleName)}`);
      }
      if (/ai_content_cutover_bypass_allowed|lock_ai_content_cutover_transaction_state|verify_ai_content_(?:cutover_preflight_identity|write_fence_catalog)|consume_ai_content_provider_attestation|read_ai_content_cutover_migration_body_evidence/.test(functionIdentity)) {
        await client.query(`grant execute on function ${functionIdentity} to ${quoteIdentifier(plan.roleNames.migrationRoleName)}`);
      }
    }
    for (const relationName of providerEnforcementBundle.controlRelations) {
      await client.query(`alter table public.${quoteIdentifier(relationName)} owner to postgres`);
      await client.query(`revoke all on table public.${quoteIdentifier(relationName)} from ${allRoles.map((name) => name === "public" ? "public" : quoteIdentifier(name)).join(",")}`);
      if (relationName === "ai_content_cutovers") {
        await client.query(`grant references on table public.ai_content_cutovers to ${quoteIdentifier(plan.roleNames.schemaOwnerRoleName)}`);
      }
      if (relationName === "ai_content_maintenance_state") {
        await client.query(`grant select on table public.${quoteIdentifier(relationName)} to ${quoteIdentifier(plan.roleNames.applicationRoleName)}`);
      }
      if (["ai_content_bootstrap_state", "ai_content_ddl_allowlist", "ai_content_write_fence_catalog"].includes(relationName)) {
        await client.query(`grant select on table public.${quoteIdentifier(relationName)} to ${quoteIdentifier(plan.roleNames.migrationRoleName)}`);
      }
      if (relationName === "ai_content_bootstrap_state") {
        await client.query(`grant select on table public.${quoteIdentifier(relationName)} to ${quoteIdentifier(plan.roleNames.schemaOwnerRoleName)}`);
      }
    }
    await client.query(
      `revoke ${quoteIdentifier(plan.roleNames.schemaOwnerRoleName)}
          from ${quoteIdentifier(plan.preservedRuntimeRoleName)}`,
    );
    await client.query("create event trigger ai_content_ddl_guard_074 on ddl_command_end execute function public.enforce_ai_content_ddl_allowlist()");
    await client.query("alter event trigger ai_content_ddl_guard_074 enable");
    const finalFence = await readFenceSecurityCatalog(client, plan.roleNames, { ownerRoleName: "postgres" });
    const eventAfter = await readCanonicalEventTriggerCatalog(client);
    const eventDelta = validateEventTriggerCatalogDelta(eventBefore.canonicalJson, eventAfter.rows, authorization);
    if (finalFence.catalogSha256 !== expectedInstall.expectedFinalFenceSecurityCatalogSha256) {
      throw new Error("bootstrap_074_final_fence_catalog_mismatch");
    }
    if (eventDelta.catalogSha256 !== eventAfter.catalogSha256 || eventDelta.count !== eventAfter.count) {
      throw new Error("bootstrap_074_event_trigger_catalog_mismatch");
    }
    const attestation = signedEnvelope({
      contractVersion: "ai-content-074-provider-attestation.v4",
      providerRequestSha256: expectedInstall.requestSha256,
      authorizationRequestId: authorization.requestId,
      action: expectedInstall.action,
      eventTriggerName: authorization.eventTriggerName,
      eventTriggerFunction: authorization.eventTriggerFunction,
      eventTriggerFunctionSha256: authorization.eventTriggerFunctionSha256,
      eventTriggerEvent: authorization.eventTriggerEvent,
      eventTriggerTags: authorization.eventTriggerTags,
      eventTriggerDefinitionSha256: authorization.eventTriggerDefinitionSha256,
      eventTriggerOwner: "postgres", eventTriggerEnabled: "enabled",
      migrationId: migration.id, migrationSha256: migration.checksum,
      imageDigest: authorization.imageDigest, imageSourceLabel: authorization.imageSourceLabel,
      roleCatalogSha256: catalogs.roleCatalogSha256,
      objectCatalogSha256: catalogs.objectCatalogSha256,
      fenceSecurityCatalogSha256: interim.catalogSha256,
      finalFenceSecurityCatalogSha256: finalFence.catalogSha256,
      eventTriggerCatalogBeforeSha256: eventBefore.catalogSha256,
      eventTriggerCatalogBeforeCount: eventBefore.count,
      eventTriggerCatalogAfterSha256: eventAfter.catalogSha256,
      eventTriggerCatalogAfterCount: eventAfter.count,
      issuedAt: new Date(now).toISOString(),
    }, providerIdentity, canonicalProviderAttestationPayload);
    const attestationSha256 = hashProviderAttestationEnvelope(attestation);
    const revocation = buildMembershipRevocationRequest(authorization, expectedInstall, attestationSha256);
    await client.query(
      `update ai_content_bootstrap_state set
         final_fence_security_catalog_sha256=$1,event_trigger_catalog_after_sha256=$2,
         event_trigger_catalog_after_count=$3,provider_attestation_json=$4::jsonb,
         provider_attestation_sha256=$5,revocation_request_json=$6::jsonb,
         revocation_request_sha256=$7 where singleton`,
      [finalFence.catalogSha256, eventAfter.catalogSha256, eventAfter.count,
        JSON.stringify(attestation), attestationSha256, JSON.stringify(revocation),
        hashMembershipRevocationEnvelope(revocation)],
    );
    await client.query("commit");
    return { attestation, revocation };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function secureRead(fileName, { maxBytes = 1024 * 1024 } = {}) {
  const inputMetadata = await lstat(fileName);
  if (inputMetadata.isSymbolicLink()) throw new Error("ai_content_secure_file_invalid");
  const resolved = await realpath(fileName);
  const metadata = await stat(resolved);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > maxBytes
    || (process.platform !== "win32" && ((metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid?.()))) {
    throw new Error("ai_content_secure_file_invalid");
  }
  return await readFile(resolved, "utf8");
}

async function exclusiveJson(fileName, value) {
  const handle = await open(fileName, "wx", 0o600);
  try { await handle.writeFile(`${canonicalJson(value)}\n`); await handle.sync(); } finally { await handle.close(); }
}

async function optionalSecureJson(fileName) {
  try { return JSON.parse(await secureRead(fileName)); }
  catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeOrVerifyExactJson(fileName, value, errorCode) {
  const existing = await optionalSecureJson(fileName);
  if (existing === undefined) await exclusiveJson(fileName, value);
  else if (!exactJson(existing, value)) throw new Error(errorCode);
}

export async function readOrCreate075ProviderArtifacts({
  journalDirectory, authorizationOutput, attestationOutput, createArtifacts,
}) {
  if (typeof journalDirectory !== "string" || !journalDirectory
    || typeof authorizationOutput !== "string" || !authorizationOutput
    || typeof attestationOutput !== "string" || !attestationOutput
    || authorizationOutput === attestationOutput || typeof createArtifacts !== "function") {
    throw new Error("cutover_075_provider_artifact_paths_invalid");
  }
  const bundleFile = path.join(journalDirectory, "provider-artifacts.json");
  let bundle = await optionalSecureJson(bundleFile);
  if (bundle === undefined) {
    const created = await createArtifacts();
    bundle = { authorization: created?.authorization, attestation: created?.attestation };
    if (!bundle.authorization || !bundle.attestation) {
      throw new Error("cutover_075_provider_artifacts_invalid");
    }
    await exclusiveJson(bundleFile, bundle);
  }
  if (!bundle || JSON.stringify(Object.keys(bundle).sort()) !== JSON.stringify(["attestation", "authorization"])) {
    throw new Error("cutover_075_provider_artifacts_invalid");
  }
  for (const [fileName, value] of [
    [authorizationOutput, bundle.authorization], [attestationOutput, bundle.attestation],
  ]) {
    const existing = await optionalSecureJson(fileName);
    if (existing === undefined) await exclusiveJson(fileName, value);
    else if (!exactJson(existing, value)) throw new Error("cutover_075_provider_artifact_replay_mismatch");
  }
  return structuredClone(bundle);
}

async function connectFromFile(fileName) {
  const connectionString = (await secureRead(fileName, { maxBytes: 32 * 1024 })).trim();
  const client = new Client(resolveVerifiedTlsConfig(connectionString, {
    caCertificate: decodeCaCertificate(process.env.DB_SSL_CA_BASE64),
  }));
  await client.connect();
  return { client, connectionString };
}

function parseArgs(argv) {
  const mode = argv[2];
  const args = {};
  for (let index = 3; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error("ai_content_database_roles_cli_invalid");
    args[argv[index].slice(2)] = argv[index + 1];
  }
  return { mode, args };
}

async function signingIdentity(privateKeyFile, keyId, expectedPublicKeySha256) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(keyId ?? "")
    || !/^[0-9a-f]{64}$/.test(expectedPublicKeySha256 ?? "")) {
    throw new Error("ai_content_signing_identity_invalid");
  }
  const privateKeyPem = await secureRead(privateKeyFile, { maxBytes: 64 * 1024 });
  const publicKey = createPublicKey(createPrivateKey(privateKeyPem));
  const publicKeySha256 = sha256(publicKey.export({ type: "spki", format: "der" }));
  if (publicKey.asymmetricKeyType !== "ed25519" || publicKeySha256 !== expectedPublicKeySha256) {
    throw new Error("ai_content_signing_identity_invalid");
  }
  return {
    keyId, privateKeyPem,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    publicKeySha256,
  };
}

async function verificationIdentity(publicKeyFile, keyId, expectedPublicKeySha256) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(keyId ?? "")
    || !/^[0-9a-f]{64}$/.test(expectedPublicKeySha256 ?? "")) {
    throw new Error("ai_content_signing_identity_invalid");
  }
  const publicKeyPem = await secureRead(publicKeyFile, { maxBytes: 64 * 1024 });
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519"
    || sha256(publicKey.export({ type: "spki", format: "der" })) !== expectedPublicKeySha256) {
    throw new Error("ai_content_signing_identity_invalid");
  }
  return { keyId, publicKeyPem, publicKeySha256: expectedPublicKeySha256 };
}

async function migrationById(id) {
  const migration = (await loadMigrations()).find((value) => value.id === id);
  if (!migration) throw new Error("ai_content_migration_missing");
  return migration;
}

async function assertRoleBootstrapFloor(client, plan) {
  const expectedMigrations = await Promise.all([
    migrationById(plan.prerequisiteMigration), migrationById(plan.migrationFloor),
  ]);
  const result = await client.query(
    `select id,checksum from schema_migrations
      where id=any($1::text[]) order by id collate "C"`,
    [[plan.migrationFloor, plan.prerequisiteMigration, plan.fenceMigration, plan.cutoverMigration]],
  );
  const expectedRows = expectedMigrations.map(({ id, checksum }) => ({ id, checksum }))
    .sort((left, right) => lexicalCompare(left.id, right.id));
  if (canonicalJson(result.rows) !== canonicalJson(expectedRows)) {
    throw new Error("ai_content_role_bootstrap_migration_floor_invalid");
  }
}

async function main(argv = process.argv) {
  const { mode, args } = parseArgs(argv);
  if (mode === "--plan") {
    const { client } = await connectFromFile(args["admin-url-file"]);
    try {
      const database = await client.query(
        `select current_database() as database_name,session_user::text session_user,
                current_user::text current_user,
                pg_get_userbyid(history.relowner)::text migration_history_owner_role_name
           from pg_class history
           join pg_namespace namespace on namespace.oid=history.relnamespace
          where namespace.nspname='public' and history.relname='schema_migrations'`,
      );
      if (database.rows.length !== 1) throw new Error("ai_content_migration_history_owner_invalid");
      const preservedOwners = await client.query(
        `select requested.relation_name,pg_get_userbyid(relation.relowner)::text owner_role_name
           from unnest($1::text[]) requested(relation_name)
           join pg_class relation on relation.oid=to_regclass('public.'||requested.relation_name)
          order by requested.relation_name`,
        [sharedOwnerTransferSecurityCatalog.map(({ relationName }) => relationName)],
      );
      if (preservedOwners.rows.length !== sharedOwnerTransferSecurityCatalog.length) {
        throw new Error("ai_content_preserved_relation_owner_catalog_incomplete");
      }
      const ownerRoleNames = new Set(preservedOwners.rows.map((row) => String(row.owner_role_name)));
      if (ownerRoleNames.size !== 1
        || !ownerRoleNames.has(String(database.rows[0]?.session_user))
        || database.rows[0]?.migration_history_owner_role_name !== database.rows[0]?.session_user
        || database.rows[0]?.session_user !== database.rows[0]?.current_user) {
        throw new Error("ai_content_preserved_relation_owner_session_invalid");
      }
      const sharedRelationAclBefore = await readSharedRelationAclCatalog(
        client,
        sharedOwnerTransferSecurityCatalog.map(({ relationName }) => relationName),
      );
      await exclusiveJson(args.output, createRoleBootstrapPlan({
        databaseName: database.rows[0].database_name,
        preservedRelationOwners: Object.fromEntries(preservedOwners.rows.map((row) => [
          String(row.relation_name),
          String(row.owner_role_name),
        ])),
        sharedRelationAclBefore,
        migrationHistoryOwnerRoleName: String(database.rows[0].migration_history_owner_role_name),
      }));
    } finally { await client.end(); }
    return;
  }
  const plan = validatePlan(JSON.parse(await secureRead(args.plan)));
  const connectionFile = ["--authorize-074", "--verify"].includes(mode)
    ? args["migration-url-file"]
    : args["admin-url-file"];
  const { client, connectionString } = await connectFromFile(connectionFile);
  try {
    if (mode === "--apply") {
      await assertRoleBootstrapFloor(client, plan);
      await mkdir(args["secret-output-dir"], { recursive: false, mode: 0o700 });
      const passwords = Object.fromEntries([
        plan.roleNames.applicationRoleName, plan.roleNames.operatorRoleName,
        plan.roleNames.migrationRoleName, plan.roleNames.cleanupRoleName,
      ].map((name) => [name, randomBytes(32).toString("base64url")]));
      await applyRoleBootstrap(client, plan, passwords);
      const urls = {};
      for (const [key, name] of Object.entries(plan.roleNames)) {
        if (key === "schemaOwnerRoleName") continue;
        const value = roleDatabaseUrl(connectionString, name, passwords[name]);
        const target = path.join(args["secret-output-dir"], `${key.replace(/RoleName$/, "")}-database-url`);
        const handle = await open(target, "wx", 0o600);
        try { await handle.writeFile(`${value}\n`); await handle.sync(); } finally { await handle.close(); }
        urls[key] = { fileName: path.basename(target), sha256: sha256(`${value}\n`) };
      }
      await exclusiveJson(args.evidence, { contractVersion: "ai-content-database-role-apply-evidence.v1", planSha256: plan.planSha256, urls });
      return;
    }
    if (mode === "--restore-shared-owners") {
      const evidence = await restoreSharedRelationOwners(client, plan);
      await exclusiveJson(args.evidence, evidence);
      return;
    }
    if (mode === "--retire-cleanup-role") {
      const evidence = await retireCleanupRole(client, plan, args["cutover-id"]);
      await exclusiveJson(args.evidence, evidence);
      return;
    }
    if (["--enable-075-provider-membership", "--disable-075-provider-membership"].includes(mode)) {
      const evidence = await setProvider075SchemaOwnerMembership(
        client, plan, args["cutover-id"], mode === "--enable-075-provider-membership",
      );
      await writeOrVerifyExactJson(
        args.evidence, evidence, "cutover_075_provider_membership_evidence_mismatch",
      );
      return;
    }
    if (mode === "--verify") {
      const identity = await client.query("select session_user,current_user");
      if (identity.rows[0]?.session_user !== plan.roleNames.migrationRoleName
        || identity.rows[0]?.current_user !== plan.roleNames.migrationRoleName) {
        throw new Error("ai_content_database_role_verification_identity_invalid");
      }
      await verifyApplicationRuntimeSecurity(client, plan);
      const catalogs = await readCanonicalBootstrapCatalogs(client, plan.roleNames);
      await exclusiveJson(args.evidence, {
        contractVersion: "ai-content-database-role-verification.v1", planSha256: plan.planSha256,
        roleCatalogSha256: catalogs.roleCatalogSha256, objectCatalogSha256: catalogs.objectCatalogSha256,
      });
      return;
    }
    if (mode === "--authorize-074") {
      const identity = await client.query("select session_user,current_user");
      if (identity.rows[0]?.session_user !== plan.roleNames.migrationRoleName
        || identity.rows[0]?.current_user !== plan.roleNames.migrationRoleName) {
        throw new Error("bootstrap_074_authorization_identity_invalid");
      }
      if (!/^sha256:[0-9a-f]{64}$/.test(args["image-digest"] ?? "")
        || !/^[0-9a-f]{40}$/.test(args["image-source-label"] ?? "")) {
        throw new Error("bootstrap_074_image_identity_invalid");
      }
      const migration = await migrationById(plan.fenceMigration);
      const authorizationIdentity = await signingIdentity(
        args["authorization-private-key-file"], args["authorization-key-id"],
        args["authorization-public-key-sha256"],
      );
      const providerIdentity = await signingIdentity(
        args["provider-private-key-file"], args["provider-key-id"],
        args["provider-public-key-sha256"],
      );
      const authorization = await buildBootstrap074AuthorizationFromDatabase({
        client, migration, plan,
        imageDigest: args["image-digest"], imageSourceLabel: args["image-source-label"],
        requestId: randomUUID(), issuedAt: new Date().toISOString(),
        authorizationIdentity, providerIdentity,
      });
      await exclusiveJson(args.output, authorization);
      return;
    }
    if (mode === "--install-074-enforcement-bundle") {
      const migration = await migrationById(plan.fenceMigration);
      const authorization = JSON.parse(await secureRead(args.authorization));
      const installRequest = JSON.parse(await secureRead(args["install-request"]));
      const authorizationIdentity = await verificationIdentity(
        args["authorization-public-key-file"], args["authorization-key-id"],
        args["authorization-public-key-sha256"],
      );
      const providerIdentity = await signingIdentity(
        args["provider-private-key-file"], args["provider-key-id"],
        args["provider-public-key-sha256"],
      );
      const { client: migrationClient } = await connectFromFile(args["migration-url-file"]);
      let evidence;
      try {
        evidence = await installProvider074EnforcementBundle({
          client, migrationClient, migration, plan, authorization, installRequest,
          authorizationIdentity, providerIdentity,
        });
      } finally {
        await migrationClient.end();
      }
      await writeOrVerifyExactJson(
        args["attestation-output"], evidence.attestation, "bootstrap_074_provider_attestation_replay_mismatch",
      );
      await writeOrVerifyExactJson(
        args["revocation-output"], evidence.revocation, "bootstrap_074_provider_revocation_replay_mismatch",
      );
      return;
    }
    if (mode === "--install-075-ddl-allowlist") {
      const migration = await migrationById(plan.cutoverMigration);
      const migration074 = await migrationById("074_ai_content_maintenance_write_fence.sql");
      const state = await client.query(
        `select final_fence_security_catalog_sha256,attestation_consumed_at,
                provider_attestation_sha256,revocation_request_sha256,install_request_json
           from ai_content_bootstrap_state where singleton`,
      );
      if (!state.rows[0]?.attestation_consumed_at
        || !/^[0-9a-f]{64}$/.test(state.rows[0]?.provider_attestation_sha256 ?? "")
        || !/^[0-9a-f]{64}$/.test(state.rows[0]?.revocation_request_sha256 ?? "")) {
        throw new Error("ai_content_074_attestation_not_consumed");
      }
      await ensureCutover075Pg17AclCompatibility({
        client, migration074, roleNames: plan.roleNames,
        sealedCatalog: state.rows[0]?.install_request_json?.expectedFinalFenceSecurityCatalog,
        sealedCatalogSha256: state.rows[0]?.final_fence_security_catalog_sha256,
      });
      const before = await client.query(
        "select command_tag as \"commandTag\",object_identity_pattern as \"objectIdentityPattern\" from ai_content_ddl_allowlist where migration_id=$1 order by command_tag,object_identity_pattern",
        [migration.id],
      );
      const legacyAclRevocations = await readCutover075LegacyAclRevocations(client);
      const authIdentity = await signingIdentity(
        args["authorization-private-key-file"], args["authorization-key-id"],
        args["authorization-public-key-sha256"],
      );
      const providerIdentity = await signingIdentity(
        args["provider-private-key-file"], args["provider-key-id"],
        args["provider-public-key-sha256"],
      );
      const artifacts = await readOrCreate075ProviderArtifacts({
        journalDirectory: args["journal-dir"],
        authorizationOutput: args["authorization-output"],
        attestationOutput: args["attestation-output"],
        createArtifacts: () => buildAndSign075Allowlist({
          migration, roleNames: plan.roleNames, cutoverId: args["cutover-id"],
          enforcementCatalogSha256: state.rows[0]?.final_fence_security_catalog_sha256,
          beforeRows: before.rows, legacyAclRevocations,
          requestId: randomUUID(), issuedAt: new Date().toISOString(),
          authorizationIdentity: authIdentity, providerIdentity,
        }),
      });
      const journal = createCutover075ProviderJournal({ directory: args["journal-dir"] });
      const attestation = await installCutover075AllowlistWithProvider({
        client, migration, ...artifacts, journal,
        authorizationVerification: { publicKeyPem: authIdentity.publicKeyPem, expectedKeyId: authIdentity.keyId, expectedPublicKeySha256: authIdentity.publicKeySha256 },
        providerAttestationVerification: { publicKeyPem: providerIdentity.publicKeyPem, expectedKeyId: providerIdentity.keyId, expectedPublicKeySha256: providerIdentity.publicKeySha256 },
      });
      if (!exactJson(attestation, artifacts.attestation)) {
        throw new Error("cutover_075_provider_attestation_replay_mismatch");
      }
      return;
    }
    throw new Error("ai_content_database_roles_cli_invalid");
  } finally { await client.end(); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "ai_content_database_roles_failed"}\n`);
    process.exitCode = 1;
  });
}
